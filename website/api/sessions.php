<?php
declare(strict_types=1);
/*
 * v34 sign-in policy and the session register, loaded by lib.php on every request.
 *   - Settings (Security center > Sign-in rules): who must use two-step sign-in, which methods, passwords, session
 *     time limits and alerts.
 *   - Every signed-in session is listed in auth_sessions: it ends after the idle and absolute time limits, when the
 *     person signs out everywhere, when the password changes or when an administrator ends it.
 *   - Devices: a long-lived random cookie (se_dev) recognises a browser, so sign-ins from new devices can be
 *     reported and "remember this device" can skip the second step for a while.
 * The sign-in steps themselves (passwords, codes, passkeys, resets) are in auth.php.
 */

const AUTH_DEFAULTS = [
    // two-step sign-in: required for these roles (admin, HR, accounting) after a grace period; everyone may turn it on
    'mfaRoles' => ['admin', 'hr', 'acct'],
    'mfaStaff' => false, // also managers, internal recruiters, recruiting team and every employee
    'graceDays' => 14,
    'mfaSince' => 0,
    'totp' => true,
    'passkey' => true,
    'email' => 'members', // email codes: 'everyone', 'members' (not for admin/HR/accounting), 'off'
    'remember' => 30, // days a device may skip the second step (0 = ask every time)
    'rememberStaff' => true,
    // passwords (NIST SP 800-63B-4): 15+ characters for a password used alone, 8+ with two-step sign-in
    'pwMin' => 8,
    'pwMinSolo' => 15,
    'breached' => true, // check new passwords against known breaches (k-anonymity: 5 characters of a hash leave the server)
    // sessions
    'idleStaff' => 60, // minutes without activity (admin, HR, accounting, managers)
    'idleOther' => 720,
    'absStaff' => 12, // hours from sign-in
    'absOther' => 336,
    // lockout after repeated wrong passwords on one account (on top of the per-minute limits and the firewall)
    'lockAfter' => 20,
    'lockMin' => 60,
    // alerts
    'newDevice' => true,
    'unusual' => true,
    'alertUids' => [],
    // security contact (security.txt and the public security page)
    'secEmail' => '',
    'secReviewed' => 0,
];
const SEC_POLL_ROUTES = ['batch', 'me', 'jobs_tick'];
const SEC_PRIV_ROLES = ['admin', 'hr', 'acct', 'manager'];

function authCfg(bool $fresh = false): array
{
    static $c = null;
    if ($c !== null && !$fresh) {
        return $c;
    }
    $saved = secKv('auth', []);
    $saved = is_array($saved) ? $saved : [];
    $c = array_merge(AUTH_DEFAULTS, $saved);
    $now = now();
    if (empty($c['mfaSince']) || empty($c['secReviewed'])) {
        // the grace period and the security.txt review date start the first time v34 runs
        $saved['mfaSince'] = $c['mfaSince'] = (int) ($c['mfaSince'] ?: $now);
        $saved['secReviewed'] = $c['secReviewed'] = (int) ($c['secReviewed'] ?: $now);
        secKvSet('auth', $saved);
    }
    return $c;
}
/** When two-step sign-in becomes mandatory for the required roles. */
function authMfaDue(): int
{
    $c = authCfg();
    return (int) $c['mfaSince'] + max(0, (int) $c['graceDays']) * 86400000;
}
function sessPrivileged(array $u): bool
{
    return (bool) array_intersect(rolesOf($u), SEC_PRIV_ROLES);
}
/** Whether this person must use two-step sign-in (once the grace period is over). */
function authMfaRequired(array $u): bool
{
    $c = authCfg();
    if (array_intersect(rolesOf($u), (array) $c['mfaRoles'])) {
        return true;
    }
    if (!empty($c['mfaStaff'])) {
        if (sessPrivileged($u)) {
            return true;
        }
        $portals = portalsOf($u);
        if (array_intersect($portals, ['employee', 'bench', 'admin', 'hr', 'acct', 'mgr'])) {
            return true;
        }
    }
    return false;
}
function sessSecure(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
}
/** This browser's device id (a random cookie, stored hashed), created when missing. */
function sessDevice(bool $create = true): string
{
    $raw = (string) ($_COOKIE['se_dev'] ?? '');
    if (!preg_match('/^[a-f0-9]{32}$/', $raw)) {
        if (!$create || headers_sent()) {
            return '';
        }
        $raw = rid(16);
        setcookie('se_dev', $raw, ['expires' => time() + 400 * 86400, 'path' => '/', 'secure' => sessSecure(), 'httponly' => true, 'samesite' => 'Lax']);
        $_COOKIE['se_dev'] = $raw;
    }
    return hash('sha256', 'dev:' . $raw);
}
function sessUa(): string
{
    return mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 250);
}
/** "Chrome on Windows" from a user agent. */
function sessUaLabel(string $ua): string
{
    $b = preg_match('/Edg\//', $ua) ? 'Edge' : (preg_match('/OPR\/|Opera/', $ua) ? 'Opera' : (preg_match('/Firefox\//', $ua) ? 'Firefox' : (preg_match('/Chrome\/|CriOS/', $ua) ? 'Chrome' : (preg_match('/Safari\//', $ua) ? 'Safari' : ($ua === '' ? 'Unknown browser' : 'Browser')))));
    $o = preg_match('/iPhone|iPad|iPod/', $ua) ? 'iPhone or iPad' : (preg_match('/Android/', $ua) ? 'Android' : (preg_match('/Windows/', $ua) ? 'Windows' : (preg_match('/Mac OS X|Macintosh/', $ua) ? 'Mac' : (preg_match('/CrOS/', $ua) ? 'ChromeOS' : (preg_match('/Linux/', $ua) ? 'Linux' : '')))));
    return $b . ($o !== '' ? ' on ' . $o : '');
}
function sessRow(string $sk): ?array
{
    if ($sk === '') {
        return null;
    }
    $s = secdb()->prepare('SELECT * FROM auth_sessions WHERE id = ?');
    $s->execute([hash('sha256', $sk)]);
    $r = $s->fetch();
    return $r ?: null;
}
/** Registers a new session for the signed-in person; returns the session key kept in $_SESSION['sk']. */
function sessNew(array $u, string $how, int $mfa, string $geo = '', ?int $at = null): string
{
    $sk = rid(24);
    $now = now();
    secdb()->prepare('INSERT INTO auth_sessions (id, uid, at, seen, act, ip, ua, geo, dev, how, mfa, out_at, why) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        ->execute([hash('sha256', $sk), (string) $u['id'], $at ?? $now, $now, $now, mb_substr(clientIp(), 0, 64), sessUa(), mb_substr($geo, 0, 160), sessDevice(), mb_substr($how, 0, 80), $mfa, 0, '']);
    // sessions that ended long ago are removed now and then
    if (random_int(1, 40) === 1) {
        secdb()->prepare('DELETE FROM auth_sessions WHERE (out_at > 0 AND out_at < ?) OR (out_at = 0 AND seen < ?)')->execute([$now - 30 * 86400000, $now - 60 * 86400000]);
    }
    return $sk;
}
/** Ends one session in the register (it stops working on its next request). */
function sessClose(string $idHash, string $why): void
{
    secdb()->prepare('UPDATE auth_sessions SET out_at = ?, why = ? WHERE id = ? AND out_at = 0')->execute([now(), mb_substr($why, 0, 80), $idHash]);
}
/** Ends every session of a person (optionally keeping the current one). Returns how many ended. */
function sessRevokeAll(string $uid, string $why, bool $keepCurrent = false): int
{
    $keep = $keepCurrent ? hash('sha256', (string) ($_SESSION['sk'] ?? '')) : '';
    $s = secdb()->prepare('UPDATE auth_sessions SET out_at = ?, why = ? WHERE uid = ? AND out_at = 0 AND id <> ?');
    $s->execute([now(), mb_substr($why, 0, 80), $uid, $keep]);
    return $s->rowCount();
}
/** Clears this browser's session after it ended (the next request sees a signed-out visitor). */
function sessEnd(string $why): void
{
    $GLOBALS['authEnded'] = $why;
    unset($_SESSION['uid'], $_SESSION['sk'], $_SESSION['auth_at'], $_SESSION['must_pw']);
}
/** Runs inside currentUser() for every signed-in request: the session must be registered, open and within its limits. */
function sessCheck(array $u): bool
{
    $sk = (string) ($_SESSION['sk'] ?? '');
    $now = now();
    if ($sk === '') {
        // signed in before v34 (no register entry yet): registered now, so nobody is signed out by the upgrade
        if (session_status() === PHP_SESSION_ACTIVE) {
            $_SESSION['sk'] = sessNew($u, 'earlier sign-in', 0, '', (int) ($_SESSION['seen'] ?? $now));
        }
        return true;
    }
    $row = sessRow($sk);
    if (!$row || (int) $row['out_at'] > 0 || (string) $row['uid'] !== (string) $u['id']) {
        sessEnd($row ? ((string) $row['why'] ?: 'ended') : 'ended');
        return false;
    }
    // v35: a session belongs to the browser it was opened in. Its cookie arriving from a browser without the same device
    // cookie means it was copied (stolen): the session ends at once and the person is told.
    $dev = (string) $row['dev'];
    if ($dev !== '' && !hash_equals($dev, sessDevice(false))) {
        sessClose((string) $row['id'], 'used from another browser');
        sessEnd('device');
        try {
            audit('auth', 'Session used from another browser: ended', (string) $u['email'], ['ip' => clientIp(), 'ua' => sessUaLabel(sessUa()), 'opened' => sessUaLabel((string) $row['ua'])], $u);
            require_once __DIR__ . '/auth.php';
            secAlertAdmins('stolen:' . $u['id'], 'A session was used from another browser: ' . $u['name'], 'The session of ' . $u['name'] . ' (' . $u['email'] . '), opened on ' . sessUaLabel((string) $row['ua']) . ' from ' . $row['ip'] . ', was presented by ' . sessUaLabel(sessUa()) . ' from ' . clientIp() . ' without that browser\'s device cookie, which happens when a session cookie is copied. The session was ended; ask them to change their password and check their computer for malware.');
        } catch (Throwable $e) {
            // the session is ended either way
        }
        return false;
    }
    $staff = sessPrivileged($u);
    // v35: staff accounts work only from the staff networks, when the Security center lists them
    if ($staff && function_exists('guardNetOk') && !guardNetOk($u)) {
        sessClose((string) $row['id'], 'outside the staff networks');
        sessEnd('network');
        return false;
    }
    $c = authCfg();
    $idle = max(5, (int) ($staff ? $c['idleStaff'] : $c['idleOther'])) * 60000;
    $abs = max(1, (int) ($staff ? $c['absStaff'] : $c['absOther'])) * 3600000;
    if ($now - (int) $row['act'] > $idle) {
        sessClose((string) $row['id'], 'idle');
        sessEnd('idle');
        return false;
    }
    if ($now - (int) $row['at'] > $abs) {
        sessClose((string) $row['id'], 'expired');
        sessEnd('expired');
        return false;
    }
    // activity: any request that is not a background poll, or a poll the page marks as following the person's input
    $route = (string) ($GLOBALS['secRoute'] ?? '');
    $active = !in_array($route, SEC_POLL_ROUTES, true) || ($_SERVER['HTTP_X_SE_ACTIVE'] ?? '') === '1';
    $set = [];
    if ($active && $now - (int) $row['act'] > 60000) {
        $set['act'] = $now;
    }
    if ($now - (int) $row['seen'] > 120000) {
        $set['seen'] = $now;
    }
    if ($set) {
        $cols = implode(', ', array_map(fn($k) => "$k = ?", array_keys($set)));
        secdb()->prepare("UPDATE auth_sessions SET $cols WHERE id = ?")->execute([...array_values($set), (string) $row['id']]);
    }
    return true;
}
/** The open sessions of a person, for "Where you're signed in". */
function sessList(string $uid): array
{
    $s = secdb()->prepare('SELECT * FROM auth_sessions WHERE uid = ? AND out_at = 0 ORDER BY seen DESC LIMIT 50');
    $s->execute([$uid]);
    $cur = hash('sha256', (string) ($_SESSION['sk'] ?? ''));
    $u = userRow($uid);
    $c = authCfg();
    $staff = $u ? sessPrivileged($u + ['roles' => rolesOf($u)]) : false;
    $idle = max(5, (int) ($staff ? $c['idleStaff'] : $c['idleOther'])) * 60000;
    $abs = max(1, (int) ($staff ? $c['absStaff'] : $c['absOther'])) * 3600000;
    $out = [];
    foreach ($s->fetchAll() as $r) {
        if (now() - (int) $r['act'] > $idle || now() - (int) $r['at'] > $abs) {
            continue;
        }
        $out[] = ['id' => substr((string) $r['id'], 0, 16), 'at' => (int) $r['at'], 'seen' => (int) $r['seen'], 'ip' => (string) $r['ip'], 'dev' => sessUaLabel((string) $r['ua']), 'geo' => (string) $r['geo'], 'how' => (string) $r['how'], 'mfa' => (int) $r['mfa'] > 0, 'cur' => hash_equals((string) $r['id'], $cur)];
    }
    return $out;
}
/**
 * Sensitive changes need a password, passkey or code entered in the last few minutes (v35: the window is set under
 * Security center > Protection, 15 minutes by default; the page asks and then repeats the action by itself).
 */
function requireRecentAuth(?int $sec = null): void
{
    if ($sec === null) {
        $sec = (function_exists('guardCfg') ? max(1, min(60, (int) guardCfg()['reauthMin'])) : 15) * 60;
    }
    if ((int) ($_SESSION['auth_at'] ?? 0) < now() - $sec * 1000) {
        fail(401, 'reauth', 'For your security, confirm it is you, then the change goes ahead.');
    }
}
