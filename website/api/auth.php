<?php
declare(strict_types=1);
/*
 * v34 sign-in: passwords (NIST SP 800-63B-4 rules, common and breached password checks, Argon2id hashes), two-step
 * sign-in (authenticator app codes, passkeys, email codes for members, one-time backup codes, remembered devices),
 * passkey sign-in without a password, account lockout, password reset and invitation links, new-device and unusual
 * sign-in alerts. The session register and the settings are in sessions.php.
 *
 * A sign-in happens in two steps when the person has two-step sign-in (or must set it up): the password (or Google,
 * LinkedIn, Microsoft) only opens a "pending" state in the PHP session; the portal session starts after the second
 * step. Nothing else in the API treats a pending person as signed in.
 */
require_once __DIR__ . '/webauthn.php';

/* ---------- passwords ---------- */
function pwAlgo()
{
    return defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT;
}
function pwHash(string $pw): string
{
    return password_hash($pw, pwAlgo());
}
/** bcrypt reads only 72 bytes, so without Argon2 the limit is 72 (NIST: never cut a password short silently). */
function pwMaxLen(): int
{
    return defined('PASSWORD_ARGON2ID') ? 128 : 72;
}
function pwCommonSet(): array
{
    static $s = null;
    if ($s === null) {
        $s = [];
        foreach (@file(__DIR__ . '/data/common-passwords.txt', FILE_IGNORE_NEW_LINES) ?: [] as $l) {
            if ($l !== '' && $l[0] !== '#') {
                $s[$l] = true;
            }
        }
    }
    return $s;
}
/** How often a password appears in known breaches (Have I Been Pwned range API, k-anonymity); -1 when unknown. */
function pwBreachCount(string $pw): int
{
    $h = strtoupper(sha1($pw));
    $base = rtrim((string) (getenv('SE_HIBP_BASE') ?: 'https://api.pwnedpasswords.com'), '/');
    $ch = curl_init($base . '/range/' . substr($h, 0, 5));
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 4, CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_FOLLOWLOCATION => false, CURLOPT_HTTPHEADER => ['Add-Padding: true', 'User-Agent: StratEdge-portal-password-check']]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($code !== 200 || !is_string($body)) {
        return -1;
    }
    $suf = substr($h, 5);
    foreach (preg_split('/\r?\n/', $body) ?: [] as $line) {
        $p = explode(':', trim($line));
        if (count($p) === 2 && strtoupper($p[0]) === $suf) {
            return (int) $p[1];
        }
    }
    return 0;
}
/** The shortest password allowed: with two-step sign-in pwMin (8), used alone pwMinSolo (15). */
function pwMinFor(bool $mfa): int
{
    $c = authCfg();
    return $mfa ? max(8, (int) $c['pwMin']) : max(8, (int) $c['pwMinSolo']);
}
/** What is wrong with a new password ('' when fine). ctx: email, name, mfa (bool), check (bool: run the breach check). */
function pwProblem(string $pw, array $ctx): string
{
    $c = authCfg();
    $len = mb_strlen($pw);
    $min = pwMinFor(!empty($ctx['mfa']));
    if ($len < $min) {
        return 'Use at least ' . $min . ' characters. A passphrase of a few unrelated words is strong and easy to remember.';
    }
    if (strlen($pw) > pwMaxLen()) {
        return 'Use at most ' . pwMaxLen() . ' characters.';
    }
    $low = mb_strtolower($pw);
    $common = pwCommonSet();
    $core = (string) preg_replace('/[^\p{L}]+$/u', '', (string) preg_replace('/^[^\p{L}]+/u', '', $low));
    if (isset($common[$low]) || (mb_strlen($core) >= 6 && isset($common[$core]) && $len - mb_strlen($core) <= 6)) {
        return 'That password is on lists of commonly used passwords. Choose something less predictable.';
    }
    if (count(array_unique(mb_str_split($pw))) <= 3) {
        return 'Use more variety than a few repeated characters.';
    }
    foreach (['01234567890123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiopasdfghjklzxcvbnm', '98765432109876543210', 'zyxwvutsrqponmlkjihgfedcba'] as $q) {
        if (str_contains($q . $q, $low)) {
            return 'Avoid simple sequences like 12345678 or abcdefgh.';
        }
    }
    $words = ['stratedge', 'strat', 'edge', 'consulting', 'password', 'passw0rd', 'portal', 'welcome', 'qwerty', 'admin'];
    $email = mb_strtolower((string) ($ctx['email'] ?? ''));
    foreach (preg_split('/[^\p{L}]+/u', (string) strstr($email . '@', '@', true)) ?: [] as $w) {
        $words[] = $w;
    }
    foreach (preg_split('/[^\p{L}]+/u', mb_strtolower((string) ($ctx['name'] ?? ''))) ?: [] as $w) {
        $words[] = $w;
    }
    $rest = $low;
    foreach (array_unique(array_filter($words, fn($w) => mb_strlen($w) >= 3)) as $w) {
        $rest = str_replace($w, '', $rest);
    }
    if ($rest !== $low && mb_strlen((string) preg_replace('/[^\p{L}]/u', '', $rest)) < 5) {
        return 'Don\'t build the password from your name, your email or the company name.';
    }
    if (!empty($ctx['check']) && !empty($c['breached'])) {
        $n = pwBreachCount($pw);
        if ($n > 0) {
            return 'This password has appeared in known data breaches (' . number_format($n) . ' times). Choose a different one.';
        }
    }
    return '';
}
/** Whether the shorter 'with two-step sign-in' password length applies: the person has a second step, or must set one
 *  up at their next sign-in. v83: not while the grace period is open (they could then sign in with the password alone). */
function pwMfaApplies(array $u): bool
{
    $u += ['roles' => rolesOf($u)];
    return (bool) mfaMethods($u) || (authMfaRequired($u) && now() >= authMfaDue());
}
/** For the forms: how long a password must be for this person (or a new account). */
function pwPolicyFor(?array $u): array
{
    $mfa = $u ? pwMfaApplies($u) : false;
    return ['min' => pwMinFor($mfa), 'minMfa' => pwMinFor(true), 'minSolo' => pwMinFor(false), 'max' => pwMaxLen(), 'breached' => !empty(authCfg()['breached'])];
}

/* ---------- per-account state (lockout, forced password change) ---------- */
function authUser(string $uid): array
{
    $s = secdb()->prepare('SELECT * FROM auth_user WHERE uid = ?');
    $s->execute([$uid]);
    $r = $s->fetch();
    return $r ?: ['uid' => $uid, 'must_pw' => 0, 'why' => '', 'locked_until' => 0, 'fails' => 0, 'fails_at' => 0, 'pw_at' => 0, 'pw_check' => 0, 'mfa_reset' => 0, 'data' => '{}'];
}
function authUserSet(string $uid, array $set): void
{
    $r = array_merge(authUser($uid), $set);
    secdb()->prepare('REPLACE INTO auth_user (uid, must_pw, why, locked_until, fails, fails_at, pw_at, pw_check, mfa_reset, data) VALUES (?,?,?,?,?,?,?,?,?,?)')
        ->execute([$uid, (int) $r['must_pw'], mb_substr((string) $r['why'], 0, 40), (int) $r['locked_until'], (int) $r['fails'], (int) $r['fails_at'], (int) $r['pw_at'], (int) $r['pw_check'], (int) $r['mfa_reset'], (string) $r['data']]);
}
/** A message when the account is locked, else ''. */
function authLocked(array $u): string
{
    $a = authUser((string) $u['id']);
    $left = (int) $a['locked_until'] - now();
    if ($left <= 0) {
        return '';
    }
    return 'This account is locked for ' . max(1, (int) ceil($left / 60000)) . ' more minutes after too many wrong passwords. Use "Forgot your password?" to unlock it now, or ask an administrator.';
}
/** A wrong password for an existing account: counted; enough of them in a day lock the account for a while. */
function authFailed(array $u, string $what = 'password'): void
{
    $uid = (string) $u['id'];
    $a = authUser($uid);
    $now = now();
    $fails = $now - (int) $a['fails_at'] > 86400000 ? 1 : (int) $a['fails'] + 1;
    $set = ['fails' => $fails, 'fails_at' => $now];
    $c = authCfg();
    if ($fails >= max(5, (int) $c['lockAfter']) && (int) $a['locked_until'] < $now) {
        $min = max(5, (int) $c['lockMin']);
        $set['locked_until'] = $now + $min * 60000;
        $set['fails'] = 0;
        audit('auth', 'Account locked', (string) $u['email'], ['fails' => $fails, 'minutes' => $min, 'what' => $what], $u);
        authMail($u, 'Your StratEdge account was locked', ['Hi ' . authFirst($u) . ',', 'There were ' . $fails . ' wrong ' . ($what === 'code' ? 'sign-in codes' : 'passwords') . ' for your account today, so it is locked for ' . $min . ' minutes.', 'If that was you, wait or reset your password. If it was not you, reset your password now and tell StratEdge.'], ['Reset my password', siteUrl() . '#/forgot']);
        secAlertAdmins('lock:' . $uid, 'Account locked: ' . $u['name'], $u['name'] . ' (' . $u['email'] . ') was locked after ' . $fails . ' wrong ' . ($what === 'code' ? 'codes' : 'passwords') . ' (last from ' . clientIp() . ').');
    }
    authUserSet($uid, $set);
}
function authFirst(array $u): string
{
    $n = trim((string) ($u['name'] ?? ''));
    return $n !== '' ? explode(' ', $n)[0] : 'there';
}
/** An email about the person's own account (no tracking, plain language). */
function authMail(array $u, string $subject, array $paras, ?array $button = null): bool
{
    try {
        $GLOBALS['mailKind'] = 'security';
        return sendMail((string) $u['email'], (string) $u['name'], $subject, implode("\n\n", $paras) . ($button ? "\n\n" . $button[0] . ': ' . $button[1] : '') . "\n\nStratEdge IT Consulting", emailHtml($subject, $paras, $button, 'This is a security notice about your StratEdge account.'));
    } catch (Throwable $e) {
        return false;
    }
}
/** Tells the security contacts about something unusual (at most once an hour per key). */
function secAlertAdmins(string $key, string $subject, string $text): void
{
    try {
        audit('alert', $subject, $key, ['text' => $text]);
        if (throttleHit('secalert:' . $key, 1, 3600)) {
            return;
        }
        $c = authCfg();
        $uids = array_values(array_filter(array_map('strval', (array) $c['alertUids'])));
        $rows = $uids
            ? array_filter(array_map(fn($id) => userRow($id), $uids))
            : db()->query("SELECT id, email, name, role, status, access FROM users WHERE status = 'active'")->fetchAll();
        $GLOBALS['mailKind'] = 'security';
        foreach ($rows as $r) {
            if (!$r || ($r['status'] ?? '') !== 'active' || (!$uids && !hasRole($r, 'admin'))) {
                continue;
            }
            sendMail((string) $r['email'], (string) $r['name'], 'Security alert: ' . $subject, $text . "\n\nSee Admin > Security center for details.", emailHtml('Security alert', [$subject, $text, 'Details are under Admin > Security center > Activity.'], ['Open the Security center', siteUrl() . '#/portal/admin/trust']));
        }
    } catch (Throwable $e) {
        // an alert never blocks a sign-in
    }
}

/* ---------- authenticator app codes (TOTP, RFC 6238: 30-second steps, 6 digits, SHA-1) ---------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32enc(string $b): string
{
    $bits = '';
    foreach (str_split($b) as $ch) {
        $bits .= str_pad(decbin(ord($ch)), 8, '0', STR_PAD_LEFT);
    }
    $o = '';
    foreach (str_split($bits, 5) as $g) {
        $o .= B32[bindec(str_pad($g, 5, '0'))];
    }
    return $o;
}
function b32dec(string $s): string
{
    $s = strtoupper((string) preg_replace('/[^A-Za-z2-7]/', '', $s));
    $bits = '';
    foreach (str_split($s) as $ch) {
        $bits .= str_pad(decbin((int) strpos(B32, $ch)), 5, '0', STR_PAD_LEFT);
    }
    $o = '';
    foreach (str_split($bits, 8) as $g) {
        if (strlen($g) === 8) {
            $o .= chr(bindec($g));
        }
    }
    return $o;
}
function totpAt(string $key, int $step): string
{
    $h = hash_hmac('sha1', pack('N', 0) . pack('N', $step), $key, true);
    $o = ord($h[19]) & 0x0f;
    $v = ((ord($h[$o]) & 0x7f) << 24 | ord($h[$o + 1]) << 16 | ord($h[$o + 2]) << 8 | ord($h[$o + 3])) % 1000000;
    return str_pad((string) $v, 6, '0', STR_PAD_LEFT);
}
/** The step a code matches (one step either side for clock drift), never a step already used; -1 when wrong. */
function totpMatch(string $key, string $code, int $lastStep): int
{
    $code = (string) preg_replace('/\D/', '', $code);
    if (strlen($code) !== 6) {
        return -1;
    }
    $now = intdiv(time(), 30);
    for ($d = -1; $d <= 1; $d++) {
        $st = $now + $d;
        if ($st > $lastStep && hash_equals(totpAt($key, $st), $code)) {
            return $st;
        }
    }
    return -1;
}

/* ---------- the second-step methods a person has ---------- */
function mfaRow(string $uid): ?array
{
    $s = secdb()->prepare('SELECT * FROM auth_mfa WHERE uid = ?');
    $s->execute([$uid]);
    $r = $s->fetch();
    return $r ?: null;
}
function mfaSave(string $uid, array $set): void
{
    $r = array_merge(['totp' => '', 'totp_at' => 0, 'totp_step' => 0, 'email_on' => 0, 'codes' => '', 'codes_at' => 0], mfaRow($uid) ?? [], $set);
    secdb()->prepare('REPLACE INTO auth_mfa (uid, totp, totp_at, totp_step, email_on, codes, codes_at, u) VALUES (?,?,?,?,?,?,?,?)')
        ->execute([$uid, (string) $r['totp'], (int) $r['totp_at'], (int) $r['totp_step'], (int) $r['email_on'], (string) $r['codes'], (int) $r['codes_at'], now()]);
}
function pkRows(string $uid): array
{
    $s = secdb()->prepare('SELECT * FROM auth_keys WHERE uid = ? ORDER BY at');
    $s->execute([$uid]);
    return $s->fetchAll();
}
function mfaEmailAllowed(array $u): bool
{
    $e = (string) authCfg()['email'];
    return $e === 'everyone' || ($e === 'members' && !authMfaRequired($u));
}
/** Methods usable right now for the second step. Backup codes count only next to a real method. */
function mfaMethods(array $u): array
{
    $c = authCfg();
    $uid = (string) $u['id'];
    $m = mfaRow($uid);
    $out = [];
    if (!empty($c['totp']) && $m && $m['totp'] !== '') {
        $out[] = 'totp';
    }
    if (!empty($c['passkey']) && pkRows($uid)) {
        $out[] = 'passkey';
    }
    if ($m && (int) $m['email_on'] && mfaEmailAllowed($u)) {
        $out[] = 'email';
    }
    if ($out && $m && count(json_decode((string) $m['codes'], true) ?: []) > 0) {
        $out[] = 'backup';
    }
    return $out;
}
/** Ten one-time backup codes (shown once; only their HMACs are kept). */
function mfaCodesNew(string $uid): array
{
    $al = 'abcdefghjkmnpqrstuvwxyz23456789';
    $codes = [];
    $macs = [];
    for ($i = 0; $i < 10; $i++) {
        $c = '';
        for ($j = 0; $j < 10; $j++) {
            $c .= $al[random_int(0, strlen($al) - 1)];
        }
        $c = substr($c, 0, 5) . '-' . substr($c, 5);
        $codes[] = $c;
        $macs[] = secMac('codes', $uid . '|' . str_replace('-', '', $c));
    }
    mfaSave($uid, ['codes' => json_encode($macs), 'codes_at' => now()]);
    return $codes;
}
function mfaCodeUse(string $uid, string $code): bool
{
    $m = mfaRow($uid);
    $list = $m ? (json_decode((string) $m['codes'], true) ?: []) : [];
    $mac = secMac('codes', $uid . '|' . strtolower((string) preg_replace('/[^A-Za-z0-9]/', '', $code)));
    foreach ($list as $i => $x) {
        if (hash_equals((string) $x, $mac)) {
            array_splice($list, $i, 1);
            mfaSave($uid, ['codes' => json_encode(array_values($list))]);
            return true;
        }
    }
    return false;
}
function mailMask(string $e): string
{
    if (!str_contains($e, '@')) {
        return $e;
    }
    [$a, $d] = explode('@', $e, 2);
    return mb_substr($a, 0, 2) . str_repeat('•', max(1, min(6, mb_strlen($a) - 2))) . '@' . $d;
}

/* ---------- one-time tokens (reset links, invitations, email codes) ---------- */
function tokNew(string $kind, string $uid, int $ttlMs, array $data = []): string
{
    $t = b64uEnc(random_bytes(32));
    secdb()->prepare('INSERT INTO auth_tokens (h, kind, uid, exp, used, at, data) VALUES (?,?,?,?,?,?,?)')
        ->execute([secMac('tok', $t), $kind, $uid, now() + $ttlMs, 0, now(), json_encode($data)]);
    if (random_int(1, 20) === 1) {
        secdb()->prepare('DELETE FROM auth_tokens WHERE exp < ?')->execute([now() - 86400000]);
    }
    return $t;
}
function tokGet(string $kind, string $t): ?array
{
    if ($t === '' || strlen($t) > 100) {
        return null;
    }
    $s = secdb()->prepare('SELECT * FROM auth_tokens WHERE h = ? AND kind = ?');
    $s->execute([secMac('tok', $t), $kind]);
    $r = $s->fetch();
    return $r && (int) $r['used'] === 0 && (int) $r['exp'] > now() ? $r : null;
}
function tokUse(string $h): void
{
    secdb()->prepare('UPDATE auth_tokens SET used = ? WHERE h = ?')->execute([now(), $h]);
}

/* ---------- email codes (members only by default) ---------- */
function mfaEmailSend(array $u): void
{
    $uid = (string) $u['id'];
    if (throttleHit('mfaem1:' . $uid, 1, 45) || throttleHit('mfaemh:' . $uid, 6, 3600)) {
        fail(429, 'rate_limited', 'A code was sent a moment ago. Check your inbox (and spam folder) or wait a minute.');
    }
    secdb()->prepare("DELETE FROM auth_tokens WHERE uid = ? AND kind = 'mfa_email'")->execute([$uid]);
    $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    secdb()->prepare('INSERT INTO auth_tokens (h, kind, uid, exp, used, at, data) VALUES (?,?,?,?,?,?,?)')
        ->execute([secMac('mfa_email', $uid . '|' . $code), 'mfa_email', $uid, now() + 600000, 0, now(), '{}']);
    authMail($u, 'Your StratEdge sign-in code: ' . $code, ['Hi ' . authFirst($u) . ',', 'Your sign-in code is ' . $code . '. It works for 10 minutes.', 'If you did not try to sign in, someone has your password: change it now.']);
}
function mfaEmailCheck(string $uid, string $code): bool
{
    $code = (string) preg_replace('/\D/', '', $code);
    $s = secdb()->prepare("SELECT h FROM auth_tokens WHERE h = ? AND kind = 'mfa_email' AND uid = ? AND used = 0 AND exp > ?");
    $s->execute([secMac('mfa_email', $uid . '|' . $code), $uid, now()]);
    $h = $s->fetchColumn();
    if (!$h) {
        return false;
    }
    tokUse((string) $h);
    return true;
}

/* ---------- v35: an emailed code to confirm it is you before a sensitive action ----------
   Offered to people whose role may use email codes, and to anyone without an authenticator app or passkey (for
   example an account that only signs in with Google or LinkedIn and has no password of its own). */
function reauthEmailOffered(array $u): bool
{
    return mfaEmailAllowed($u) || !array_intersect(mfaMethods($u), ['totp', 'passkey']);
}
function reauthEmailSend(array $u): void
{
    $uid = (string) $u['id'];
    if (throttleHit('reauthem1:' . $uid, 1, 45) || throttleHit('reauthemh:' . $uid, 6, 3600)) {
        fail(429, 'rate_limited', 'A code was sent a moment ago. Check your inbox (and spam folder) or wait a minute.');
    }
    secdb()->prepare("DELETE FROM auth_tokens WHERE uid = ? AND kind = 'reauth_email'")->execute([$uid]);
    $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    secdb()->prepare('INSERT INTO auth_tokens (h, kind, uid, exp, used, at, data) VALUES (?,?,?,?,?,?,?)')
        ->execute([secMac('reauth_email', $uid . '|' . $code), 'reauth_email', $uid, now() + 600000, 0, now(), '{}']);
    authMail($u, 'Your StratEdge confirmation code: ' . $code, ['Hi ' . authFirst($u) . ',', 'Your code to confirm a change in the portal is ' . $code . '. It works for 10 minutes.', 'If you did not ask for it, someone may be using your signed-in session: sign out everywhere under Sign-in & security and change your password.']);
}
function reauthEmailCheck(string $uid, string $code): bool
{
    $code = (string) preg_replace('/\D/', '', $code);
    if (strlen($code) !== 6) {
        return false;
    }
    $s = secdb()->prepare("SELECT h FROM auth_tokens WHERE h = ? AND kind = 'reauth_email' AND uid = ? AND used = 0 AND exp > ?");
    $s->execute([secMac('reauth_email', $uid . '|' . $code), $uid, now()]);
    $h = $s->fetchColumn();
    if (!$h) {
        return false;
    }
    tokUse((string) $h);
    return true;
}

/** Removes someone's two-step sign-in (authenticator, passkeys, backup codes, remembered devices) and their sessions;
 *  they set it up again at their next sign-in. Security center > people, or a reset request ticket (v35). */
function authMfaResetFor(array $me, array $t, string $why): void
{
    if (!authMayManage($me, $t)) {
        fail(403, 'forbidden', 'Only an administrator can change the sign-in of staff accounts.');
    }
    $uid = (string) $t['id'];
    secdb()->prepare('DELETE FROM auth_keys WHERE uid = ?')->execute([$uid]);
    secdb()->prepare('DELETE FROM auth_mfa WHERE uid = ?')->execute([$uid]);
    secdb()->prepare('UPDATE auth_devices SET trust = 0 WHERE uid = ?')->execute([$uid]);
    $n = sessRevokeAll($uid, 'two-step sign-in reset by ' . $me['name']);
    audit('auth', 'Two-step sign-in reset for someone else', (string) $t['email'], ['sessions' => $n] + ($why !== '' ? ['why' => mb_substr($why, 0, 300)] : []), $me);
    authMail($t, 'Your two-step sign-in was reset', ['Hi ' . authFirst($t) . ',', $me['name'] . ' reset the two-step sign-in of your StratEdge account. At your next sign-in you set it up again (and save the new backup codes).', 'If you did not ask for this, contact StratEdge right away.']);
}
/* v35: "Can't use any of these?" at the sign-in code step: after the password, a code emailed to the account address
   confirms the request, which becomes a service desk ticket for the administrators (desk.php deskMfaRequest). */
function mfaHelpSend(array $u): void
{
    $uid = (string) $u['id'];
    if (throttleHit('mfahelp1:' . $uid, 1, 45) || throttleHit('mfahelph:' . $uid, 5, 3600)) {
        fail(429, 'rate_limited', 'A code was sent a moment ago. Check your inbox (and spam folder) or wait a minute.');
    }
    secdb()->prepare("DELETE FROM auth_tokens WHERE uid = ? AND kind = 'mfa_help'")->execute([$uid]);
    $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    secdb()->prepare('INSERT INTO auth_tokens (h, kind, uid, exp, used, at, data) VALUES (?,?,?,?,?,?,?)')
        ->execute([secMac('mfa_help', $uid . '|' . $code), 'mfa_help', $uid, now() + 600000, 0, now(), '{}']);
    authMail($u, 'Your code to ask for a two-step sign-in reset: ' . $code, ['Hi ' . authFirst($u) . ',', 'Someone signed in with your password and asked to reset your two-step sign-in. If that was you, enter ' . $code . ' on the sign-in page (it works for 10 minutes). An administrator will then contact you to confirm it is you before anything changes.', 'If it was not you, someone knows your password: change it now with "Forgot your password?" on the login page, and tell us by replying to this email.']);
}
function mfaHelpCheck(string $uid, string $code): bool
{
    $code = (string) preg_replace('/\D/', '', $code);
    if (strlen($code) !== 6) {
        return false;
    }
    $s = secdb()->prepare("SELECT h FROM auth_tokens WHERE h = ? AND kind = 'mfa_help' AND uid = ? AND used = 0 AND exp > ?");
    $s->execute([secMac('mfa_help', $uid . '|' . $code), $uid, now()]);
    $h = $s->fetchColumn();
    $s->closeCursor();
    if (!$h) {
        return false;
    }
    tokUse((string) $h);
    return true;
}

/* ---------- devices ---------- */
function devTrusted(array $u): bool
{
    $c = authCfg();
    if ((int) $c['remember'] <= 0 || (sessPrivileged($u) && empty($c['rememberStaff']))) {
        return false;
    }
    $dev = sessDevice(false);
    if ($dev === '') {
        return false;
    }
    $s = secdb()->prepare('SELECT trust FROM auth_devices WHERE uid = ? AND dev = ?');
    $s->execute([(string) $u['id'], $dev]);
    return (int) $s->fetchColumn() > now();
}
/** Records the device; returns true when it was new for this person. $trustDays > 0 remembers it for the second step. */
function devSeen(string $uid, string $dev, string $geo, int $trustDays = 0): bool
{
    if ($dev === '') {
        return false;
    }
    $s = secdb()->prepare('SELECT * FROM auth_devices WHERE uid = ? AND dev = ?');
    $s->execute([$uid, $dev]);
    $r = $s->fetch();
    $now = now();
    $trust = $trustDays > 0 ? $now + $trustDays * 86400000 : (int) ($r['trust'] ?? 0);
    secdb()->prepare('REPLACE INTO auth_devices (uid, dev, at, seen, ua, geo, ip, trust) VALUES (?,?,?,?,?,?,?,?)')
        ->execute([$uid, $dev, (int) ($r['at'] ?? $now), $now, sessUa(), mb_substr($geo, 0, 160), mb_substr(clientIp(), 0, 64), $trust]);
    return !$r;
}

/* ---------- the sign-in itself ---------- */
function mfaPending(): ?array
{
    $p = $_SESSION['mfa'] ?? null;
    if (!is_array($p) || now() - (int) ($p['at'] ?? 0) > 900000) {
        unset($_SESSION['mfa']);
        return null;
    }
    return $p;
}
function mfaPendingUser(): ?array
{
    $p = mfaPending();
    if (!$p) {
        return null;
    }
    $s = db()->prepare('SELECT * FROM users WHERE id = ?');
    $s->execute([(string) $p['uid']]);
    $u = $s->fetch();
    if (!$u || $u['status'] !== 'active') {
        unset($_SESSION['mfa']);
        return null;
    }
    $u['roles'] = rolesOf($u);
    return $u;
}
/** What the sign-in page needs to show the second step (or the set-up of one). */
function mfaPublic(array $u, array $p): array
{
    $c = authCfg();
    $rem = (int) $c['remember'] > 0 && !(sessPrivileged($u) && empty($c['rememberStaff'])) ? (int) $c['remember'] : 0;
    return [
        'need' => (string) $p['need'],
        'methods' => mfaMethods($u),
        'email' => mailMask((string) $u['email']),
        'first' => authFirst($u),
        'remember' => $rem,
        'can' => ['totp' => !empty($c['totp']), 'passkey' => !empty($c['passkey']) && waRpId() !== '', 'email' => mfaEmailAllowed($u)],
        'as' => (string) ($p['as'] ?? ''),
    ];
}
/**
 * After the password (or Google / LinkedIn / Microsoft / a reset) proved who it is: the session opens now, or the
 * second step comes first. Returns ['go' => ...] or ['mfa' => ...].
 */
function authBegin(array $u, string $how, string $asKey, string $go, string $password = ''): array
{
    $u['roles'] = $u['roles'] ?? rolesOf($u);
    $uid = (string) $u['id'];
    // v35: staff accounts sign in only from the staff networks (when the Security center lists them)
    if (function_exists('guardNetGate')) {
        guardNetGate($u);
    }
    // break-glass: an administrator who lost every second step names their email in config.php mfa_reset_email
    $bg = strtolower(trim((string) cfg('mfa_reset_email')));
    if ($bg !== '' && $bg === strtolower((string) $u['email']) && str_starts_with($how, 'password')) {
        $a = authUser($uid);
        if ((int) $a['mfa_reset'] < now() - 3600000) {
            secdb()->prepare('DELETE FROM auth_keys WHERE uid = ?')->execute([$uid]);
            secdb()->prepare('DELETE FROM auth_mfa WHERE uid = ?')->execute([$uid]);
            authUserSet($uid, ['mfa_reset' => now()]);
            audit('auth', 'Two-step sign-in reset from config.php', (string) $u['email'], [], $u);
            secAlertAdmins('bg:' . $uid, 'Two-step sign-in was reset through config.php', 'The mfa_reset_email line in api/config.php removed the second steps of ' . $u['email'] . ' at their sign-in. Remove that line from config.php now.');
        }
    }
    // v83: the administrator password from config.php (shipped in the package) is never kept: an install made before
    // the first-sign-in rule still has to replace it
    $cfgPw = (string) cfg('admin_password');
    if ($password !== '' && $cfgPw !== '' && hash_equals($cfgPw, $password)) {
        authUserSet($uid, ['must_pw' => 1, 'why' => 'first']);
    }
    // a password seen in a breach since it was set must be changed (checked at most once a month)
    if ($password !== '' && !empty(authCfg()['breached'])) {
        $a = authUser($uid);
        if ((int) $a['pw_check'] < now() - 30 * 86400000) {
            $n = pwBreachCount($password);
            authUserSet($uid, ['pw_check' => now()] + ($n > 0 ? ['must_pw' => 1, 'why' => 'breached'] : []));
            if ($n > 0) {
                audit('auth', 'Password found in breach lists', (string) $u['email'], ['n' => $n], $u);
            }
        }
    }
    $methods = mfaMethods($u);
    $required = authMfaRequired($u) && now() >= authMfaDue();
    if ($methods && !devTrusted($u)) {
        $need = 'verify';
    } elseif (!$methods && $required) {
        $need = 'enroll';
    } else {
        return authFinish($u, $how, $asKey, $methods ? 1 : 0, $go);
    }
    session_regenerate_id(true);
    unset($_SESSION['uid'], $_SESSION['sk'], $_SESSION['wa'], $_SESSION['totp_new']);
    $_SESSION['mfa'] = ['uid' => $uid, 'need' => $need, 'how' => $how, 'as' => $asKey, 'go' => $go, 'at' => now(), 'n' => 0];
    return ['mfa' => mfaPublic($u, $_SESSION['mfa'])];
}
/** Opens the portal session: register, device, sign-in log, alerts. $mfa: 0 none, 1 remembered device, 2 second step now. */
function authFinish(array $u, string $how, string $asKey, int $mfa, string $go, bool $remember = false): array
{
    $u['roles'] = $u['roles'] ?? rolesOf($u);
    $uid = (string) $u['id'];
    if (function_exists('guardNetGate')) {
        guardNetGate($u);
    }
    session_regenerate_id(true);
    unset($_SESSION['mfa'], $_SESSION['wa'], $_SESSION['totp_new']);
    $_SESSION['uid'] = $uid;
    $geo = geoLookup(clientIp());
    $geoLabel = (string) ($geo['label'] ?? '');
    $dev = sessDevice(true);
    $_SESSION['sk'] = sessNew($u, $how, $mfa, $geoLabel);
    $_SESSION['auth_at'] = now();
    $prev = docGet("log/$uid");
    $c = authCfg();
    $trustDays = $remember && $mfa === 2 && (int) $c['remember'] > 0 && !(sessPrivileged($u) && empty($c['rememberStaff'])) ? (int) $c['remember'] : 0;
    $new = devSeen($uid, $dev, $geoLabel, $trustDays);
    $a = authUser($uid);
    authUserSet($uid, ['fails' => 0, 'locked_until' => 0]);
    if ((int) $a['must_pw']) {
        $_SESSION['must_pw'] = (string) ($a['why'] ?: 'reset');
    } else {
        unset($_SESSION['must_pw']);
    }
    // the person is accountable from here on (their own sign-in is the first entry of the session)
    $GLOBALS['secUser'] = $u;
    audit('auth', 'Signed in', (string) $u['email'], ['how' => $how, 'mfa' => $mfa, 'device' => sessUaLabel(sessUa()), 'where' => $geoLabel], $u);
    if ($new && $prev && !empty($c['newDevice'])) {
        authMail($u, 'New sign-in to your StratEdge account', ['Hi ' . authFirst($u) . ',', 'Your account was just used to sign in from a device we have not seen before:', sessUaLabel(sessUa()) . ($geoLabel !== '' ? ', near ' . $geoLabel : '') . ', network address ' . clientIp() . ', ' . gmdate('j M Y H:i') . ' UTC.', 'If this was you, there is nothing to do. If it was not, change your password now and sign out the other sessions under Sign-in & security.'], ['Review my sign-ins', siteUrl() . '#/portal/security']);
    }
    if (!empty($c['unusual'])) {
        authUnusual($u, is_array($geo) ? $geo : [], $prev, (int) $a['fails'], (int) $a['fails_at']);
    }
    recordLogin($u, $how);
    return ['go' => $go, 'user' => publicUser($u)];
}
/** Signs of a sign-in that someone should look at: a new country, impossible travel, success after many failures. */
function authUnusual(array $u, array $geo, ?stdClass $prev, int $fails, int $failsAt): void
{
    try {
        $who = $u['name'] . ' (' . $u['email'] . ')';
        $priv = sessPrivileged($u);
        if ($fails >= 5 && now() - $failsAt < 3600000) {
            secAlertAdmins('afterfails:' . $u['id'], 'Sign-in after ' . $fails . ' failed attempts: ' . $u['name'], $who . ' signed in from ' . clientIp() . ' after ' . $fails . ' wrong passwords in the last hour. Check that it was them.');
        }
        $country = (string) ($geo['country'] ?? '');
        if ($country === '' || !$prev) {
            return;
        }
        $seen = [];
        $last = null;
        foreach (array_slice(colAll('log/' . $u['id'] . '/items', 't', 'desc'), 0, 40) as $row) {
            $x = $row[1] ?? null;
            if (!$x instanceof stdClass || ($x->how ?? '') === 'logout') {
                continue;
            }
            $g = $x->geo ?? null;
            if ($g && !empty($g->country)) {
                $seen[(string) $g->country] = true;
                $last = $last ?? $x;
            }
        }
        if ($priv && count($seen) >= 1 && !isset($seen[$country])) {
            secAlertAdmins('country:' . $u['id'] . ':' . $country, 'Staff sign-in from a new country: ' . $u['name'], $who . ' signed in from ' . ($geo['label'] ?? $country) . ' (' . clientIp() . '), a country not seen for this account before.');
        }
        if ($last && isset($last->geo->lat, $last->geo->lng, $geo['lat'], $geo['lng'])) {
            $km = authKm((float) $last->geo->lat, (float) $last->geo->lng, (float) $geo['lat'], (float) $geo['lng']);
            $h = max(0.05, (now() - (int) $last->t) / 3600000);
            if ($km > 500 && $km / $h > 900) {
                secAlertAdmins('travel:' . $u['id'], 'Impossible travel: ' . $u['name'], $who . ' signed in from ' . ($geo['label'] ?? '?') . ' ' . round($h, 1) . ' hours after a sign-in from ' . ($last->geo->label ?? '?') . ' (' . round($km) . ' km apart).');
            }
        }
    } catch (Throwable $e) {
        // alerts never block a sign-in
    }
}
function authKm(float $a1, float $o1, float $a2, float $o2): float
{
    $r = M_PI / 180;
    $d = sin(($a2 - $a1) * $r / 2) ** 2 + cos($a1 * $r) * cos($a2 * $r) * sin(($o2 - $o1) * $r / 2) ** 2;
    return 6371 * 2 * atan2(sqrt($d), sqrt(1 - $d));
}
/** Checks a second step for the pending sign-in or a signed-in person. Fails the request when wrong. */
function mfaCheck(array $u, string $m, array $b, string $ceremony): int
{
    $uid = (string) $u['id'];
    if (throttleHit('mfa:' . $uid, 10, 900)) {
        fail(429, 'rate_limited', 'Too many codes tried. Wait 15 minutes, or ask an administrator.');
    }
    $okStep = 0;
    if ($m === 'totp') {
        $row = mfaRow($uid);
        if (!$row || $row['totp'] === '' || !in_array('totp', mfaMethods($u), true)) {
            fail(400, 'invalid_argument', 'No authenticator app is set up for this account.');
        }
        $st = totpMatch(b32dec(secUnseal((string) $row['totp'])), (string) ($b['code'] ?? ''), (int) $row['totp_step']);
        if ($st >= 0) {
            mfaSave($uid, ['totp_step' => $st]);
            $okStep = 2;
        }
    } elseif ($m === 'email') {
        if (!in_array('email', mfaMethods($u), true)) {
            fail(400, 'invalid_argument', 'Email codes are not available for this account.');
        }
        $okStep = mfaEmailCheck($uid, (string) ($b['code'] ?? '')) ? 2 : 0;
    } elseif ($m === 'backup') {
        $okStep = mfaCodeUse($uid, (string) ($b['code'] ?? '')) ? 2 : 0;
        if ($okStep) {
            audit('auth', 'Backup code used', (string) $u['email'], ['left' => count(json_decode((string) (mfaRow($uid)['codes'] ?? '[]'), true) ?: [])], $u);
        }
    } elseif ($m === 'passkey') {
        $cred = (array) ($b['cred'] ?? []);
        try {
            $ch = waTakeChallenge($ceremony);
            $row = pkFind((string) ($cred['id'] ?? ''));
            if (!$row || (string) $row['uid'] !== $uid) {
                throw new RuntimeException('That passkey is not registered for this account.');
            }
            [, $cnt] = waAssert($cred, $ch, $row, false);
            secdb()->prepare('UPDATE auth_keys SET cnt = ?, used = ? WHERE kh = ?')->execute([$cnt, now(), (string) $row['kh']]);
            $okStep = 2;
        } catch (RuntimeException $e) {
            audit('auth', 'Passkey check failed', (string) $u['email'], ['why' => $e->getMessage()], $u);
            fail(400, 'invalid_code', $e->getMessage());
        }
    } else {
        fail(400, 'invalid_argument', 'Choose how to confirm it is you.');
    }
    if (!$okStep) {
        authFailed($u, 'code');
        fwStrike('login', 'wrong second-step code for ' . $u['email']);
        audit('auth', 'Wrong second-step code', (string) $u['email'], ['method' => $m], $u);
        fail(400, 'invalid_code', $m === 'backup' ? 'That backup code is not valid (each one works once).' : 'That code is not right. Check the newest code and try again.');
    }
    throttleClear('mfa:' . $uid);
    return $okStep;
}
function pkFind(string $credId): ?array
{
    if ($credId === '') {
        return null;
    }
    $s = secdb()->prepare('SELECT * FROM auth_keys WHERE kh = ?');
    $s->execute([hash('sha256', $credId)]);
    $r = $s->fetch();
    return $r ?: null;
}
function pkOptionsCreate(array $u): array
{
    $rp = waRpId();
    if ($rp === '') {
        fail(400, 'invalid_argument', 'Passkeys need the site\'s name in the address bar (not a numeric address).');
    }
    return [
        'rp' => ['id' => $rp, 'name' => 'StratEdge'],
        'user' => ['id' => b64uEnc((string) $u['id']), 'name' => (string) $u['email'], 'displayName' => (string) $u['name']],
        'challenge' => waChallenge('reg', (string) $u['id']),
        'pubKeyCredParams' => [['type' => 'public-key', 'alg' => -7], ['type' => 'public-key', 'alg' => -8], ['type' => 'public-key', 'alg' => -257]],
        'timeout' => 120000,
        'attestation' => 'none',
        'authenticatorSelection' => ['residentKey' => 'preferred', 'requireResidentKey' => false, 'userVerification' => 'preferred'],
        'excludeCredentials' => array_map(fn($r) => ['type' => 'public-key', 'id' => (string) $r['cid']], pkRows((string) $u['id'])),
    ];
}
function pkOptionsGet(string $ceremony, ?array $u, string $uv = 'preferred'): array
{
    $rp = waRpId();
    if ($rp === '') {
        fail(400, 'invalid_argument', 'Passkeys need the site\'s name in the address bar (not a numeric address).');
    }
    return [
        'challenge' => waChallenge($ceremony, $u ? (string) $u['id'] : ''),
        'rpId' => $rp,
        'timeout' => 120000,
        'userVerification' => $uv,
        'allowCredentials' => $u ? array_map(fn($r) => ['type' => 'public-key', 'id' => (string) $r['cid']], pkRows((string) $u['id'])) : [],
    ];
}
function pkSave(array $u, array $cred, string $name): array
{
    try {
        $reg = waRegister($cred, waTakeChallenge('reg'));
    } catch (RuntimeException $e) {
        fail(400, 'invalid_argument', $e->getMessage());
    }
    if (pkFind($reg['cid'])) {
        fail(409, 'invalid_argument', 'That passkey is already registered.');
    }
    $name = mb_substr(trim($name), 0, 60) ?: sessUaLabel(sessUa());
    secdb()->prepare('INSERT INTO auth_keys (kh, cid, uid, name, pk, alg, cnt, at, used, aaguid, uv) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        ->execute([hash('sha256', $reg['cid']), $reg['cid'], (string) $u['id'], $name, $reg['pk'], $reg['alg'], $reg['cnt'], now(), 0, $reg['aaguid'], $reg['uv']]);
    audit('auth', 'Passkey added', (string) $u['email'], ['name' => $name], $u);
    return ['id' => hash('sha256', $reg['cid']), 'name' => $name];
}
/** After the first method is set up during a sign-in: backup codes, then the session opens. */
function mfaEnrolled(array $u, array $p, bool $remember): array
{
    $m = mfaRow((string) $u['id']);
    $codes = $m && count(json_decode((string) $m['codes'], true) ?: []) > 0 ? [] : mfaCodesNew((string) $u['id']);
    $r = authFinish($u, (string) $p['how'], (string) $p['as'], 2, (string) $p['go'], $remember);
    return $r + ['codes' => $codes];
}
/** Whether removing one method would leave someone who must use two-step sign-in without any. */
function mfaLastGuard(array $u, string $removing): void
{
    $left = array_values(array_diff(mfaMethods($u), [$removing, 'backup']));
    if (!$left && authMfaRequired($u)) {
        fail(400, 'invalid_argument', 'Two-step sign-in is required for your role. Add another method before removing this one.');
    }
}
/** Who may manage another person's sign-in (reset a password or two-step sign-in, end sessions): administrators for
 *  anyone; HR for people without staff roles. */
function authMayManage(array $me, array $target): bool
{
    if (hasRole($me, 'admin')) {
        return true;
    }
    $t = $target + ['roles' => rolesOf($target)];
    return hasRole($me, 'hr') && !sessPrivileged($t);
}
function authStrUid(array $b): array
{
    $uid = str($b, 'uid', 40);
    $row = $uid !== '' ? userRow($uid) : null;
    if (!$row) {
        fail(404, 'invalid_argument', 'No account with that id.');
    }
    return $row;
}
/** Sends a password reset (or invitation) link; returns ['link' => ..., 'mailed' => bool]. $as: the portal login to
 *  open afterwards (invitations). */
function authResetLink(array $u, string $kind = 'reset', ?array $by = null, string $as = ''): array
{
    $ttl = $kind === 'invite' ? 7 * 86400000 : 1800000;
    secdb()->prepare('DELETE FROM auth_tokens WHERE uid = ? AND kind = ? AND used = 0')->execute([(string) $u['id'], $kind]);
    $t = tokNew($kind, (string) $u['id'], $ttl, ['as' => preg_replace('/[^a-z]/', '', $as)]);
    $link = siteUrl() . '#/reset?t=' . $t . ($kind === 'invite' ? '&new=1' : '') . ($as !== '' ? '&as=' . rawurlencode($as) : '');
    if ($kind === 'invite') {
        $mailed = authMail($u, 'Your StratEdge portal login', ['Hi ' . authFirst($u) . ',', 'A StratEdge portal login was created for you' . ($by ? ' by ' . $by['name'] : '') . '. Choose your password with the button below; the link works for 7 days and only once.', 'Your sign-in email is ' . $u['email'] . '.'], ['Choose my password', $link]);
    } else {
        $mailed = authMail($u, 'Reset your StratEdge password', ['Hi ' . authFirst($u) . ',', ($by ? $by['name'] . ' sent you a link' : 'Someone (hopefully you) asked') . ' to reset the password of your StratEdge account. The link works for 30 minutes and only once.', 'If you did not ask for this, ignore this email; your password stays the same.'], ['Choose a new password', $link]);
    }
    return ['link' => $link, 'mailed' => $mailed];
}

/* ---------- routes ---------- */
function authRoute(string $r, array $b): never
{
    $c = authCfg();
    switch ($r) {
        /* --- the pending second step --- */
        case 'mfa_state':
            $u = mfaPendingUser();
            ok($u ? ['pending' => true] + mfaPublic($u, mfaPending()) : ['pending' => false]);
        case 'mfa_cancel':
            unset($_SESSION['mfa'], $_SESSION['wa'], $_SESSION['totp_new']);
            ok(['ok' => true]);
        case 'mfa_email_send':
            $u = mfaPendingUser() ?? currentUser();
            if (!$u) {
                fail(401, 'mfa_restart', 'Sign in again to continue.');
            }
            if (!mfaEmailAllowed($u)) {
                fail(403, 'invalid_argument', 'Email codes are not available for this account.');
            }
            $p = mfaPending();
            if ($p && $p['need'] === 'verify' && !in_array('email', mfaMethods($u), true)) {
                fail(403, 'invalid_argument', 'Email codes are not turned on for this account.');
            }
            mfaEmailSend($u);
            ok(['ok' => true, 'to' => mailMask((string) $u['email'])]);
        case 'mfa_help_send':
            $u = mfaPendingUser();
            if (!$u) {
                fail(401, 'mfa_restart', 'The sign-in timed out. Enter your password again.');
            }
            mfaHelpSend($u);
            ok(['ok' => true, 'to' => mailMask((string) $u['email'])]);
        case 'mfa_help_request':
            $u = mfaPendingUser();
            if (!$u) {
                fail(401, 'mfa_restart', 'The sign-in timed out. Enter your password again.');
            }
            if (throttleHit('mfahelpr:' . $u['id'], 6, 3600)) {
                fail(429, 'rate_limited', 'Too many tries. Wait an hour, or ask your manager to contact us.');
            }
            if (!mfaHelpCheck((string) $u['id'], str($b, 'code', 12))) {
                fail(400, 'invalid_argument', 'That code is not right or has expired. Send a new one.');
            }
            require_once __DIR__ . '/desk.php';
            $where = clientIp();
            $t = deskMfaRequest($u, str($b, 'note', 1000), $where);
            audit('auth', 'Two-step sign-in reset requested', (string) $u['email'], ['ticket' => 'SD-' . $t['num']], $u);
            ok(['num' => 'SD-' . $t['num']]);
        case 'mfa_verify':
            $u = mfaPendingUser();
            $p = mfaPending();
            if (!$u || !$p || $p['need'] !== 'verify') {
                fail(401, 'mfa_restart', 'The sign-in timed out. Enter your password again.');
            }
            $_SESSION['mfa']['n'] = (int) $p['n'] + 1;
            if ((int) $p['n'] >= 8) {
                unset($_SESSION['mfa']);
                fail(401, 'mfa_restart', 'Too many tries. Enter your password again.');
            }
            $m = str($b, 'm', 10);
            $level = mfaCheck($u, $m, $b, 'mfa');
            ok(authFinish($u, (string) $p['how'], (string) $p['as'], $level, (string) $p['go'], !empty($b['remember'])) + ['method' => $m]);
        case 'pk_auth_options':
            // passkey as the second step (pending) or to confirm a sensitive change (signed in)
            $u = mfaPendingUser();
            if ($u) {
                ok(pkOptionsGet('mfa', $u));
            }
            $u = requireUser();
            ok(pkOptionsGet('reauth', $u));

        /* --- setting up a method (during a sign-in that requires it, or later under Sign-in & security) --- */
        case 'mfa_totp_start':
            $u = mfaPendingUser() ?? requireUser();
            if (empty($c['totp'])) {
                fail(400, 'invalid_argument', 'Authenticator apps are switched off for this site.');
            }
            if (!mfaPending()) {
                requireRecentAuth();
            }
            $secret = b32enc(random_bytes(20));
            $_SESSION['totp_new'] = ['s' => $secret, 'uid' => (string) $u['id'], 'at' => now()];
            $label = rawurlencode('StratEdge:' . $u['email']);
            ok(['secret' => trim(chunk_split($secret, 4, ' ')), 'uri' => 'otpauth://totp/' . $label . '?secret=' . $secret . '&issuer=StratEdge&algorithm=SHA1&digits=6&period=30']);
        case 'mfa_totp_confirm':
            $p = mfaPending();
            $u = mfaPendingUser() ?? requireUser();
            $n = $_SESSION['totp_new'] ?? null;
            if (!is_array($n) || $n['uid'] !== (string) $u['id'] || now() - (int) $n['at'] > 900000) {
                fail(400, 'invalid_argument', 'Start the set-up again (the QR code expired).');
            }
            if (throttleHit('totpset:' . $u['id'], 10, 900)) {
                fail(429, 'rate_limited', 'Too many tries. Wait 15 minutes.');
            }
            $st = totpMatch(b32dec((string) $n['s']), (string) ($b['code'] ?? ''), 0);
            if ($st < 0) {
                fail(400, 'invalid_code', 'That code does not match. Check that your phone\'s time is set automatically and type the newest code.');
            }
            mfaSave((string) $u['id'], ['totp' => secSeal((string) $n['s']), 'totp_at' => now(), 'totp_step' => $st]);
            unset($_SESSION['totp_new']);
            audit('auth', 'Authenticator app added', (string) $u['email'], [], $u);
            if ($p && $p['need'] === 'enroll') {
                ok(mfaEnrolled($u, $p, !empty($b['remember'])));
            }
            $m = mfaRow((string) $u['id']);
            ok(['ok' => true, 'codes' => count(json_decode((string) ($m['codes'] ?? ''), true) ?: []) ? [] : mfaCodesNew((string) $u['id'])]);
        case 'pk_reg_options':
            $p = mfaPending();
            $u = mfaPendingUser() ?? requireUser();
            if (empty($c['passkey'])) {
                fail(400, 'invalid_argument', 'Passkeys are switched off for this site.');
            }
            if (!$p) {
                requireRecentAuth();
            } elseif ($p['need'] !== 'enroll') {
                fail(400, 'invalid_argument', 'Finish signing in first.');
            }
            ok(pkOptionsCreate($u));
        case 'pk_reg_finish':
            $p = mfaPending();
            $u = mfaPendingUser() ?? requireUser();
            if ($p && $p['need'] !== 'enroll') {
                fail(400, 'invalid_argument', 'Finish signing in first.');
            }
            $saved = pkSave($u, (array) ($b['cred'] ?? []), str($b, 'name', 60));
            if ($p) {
                ok(mfaEnrolled($u, $p, !empty($b['remember'])) + ['key' => $saved]);
            }
            $m = mfaRow((string) $u['id']);
            ok(['ok' => true, 'key' => $saved, 'codes' => count(json_decode((string) ($m['codes'] ?? ''), true) ?: []) ? [] : mfaCodesNew((string) $u['id'])]);

        /* --- signing in with a passkey alone (it proves both who you are and that you have the device) --- */
        case 'pk_login_options':
            if (empty($c['passkey'])) {
                fail(400, 'invalid_argument', 'Passkeys are switched off for this site.');
            }
            if (throttleHit('pklogin:' . clientIp(), 30, 900)) {
                fail(429, 'rate_limited', 'Too many attempts. Wait 15 minutes and try again.');
            }
            ok(pkOptionsGet('login', null, 'required'));
        case 'pk_login':
            $cred = (array) ($b['cred'] ?? []);
            try {
                $ch = waTakeChallenge('login');
                $row = pkFind((string) ($cred['id'] ?? ''));
                if (!$row) {
                    throw new RuntimeException('This passkey is not registered here. Sign in with your password, then add it under Sign-in & security.');
                }
                $hu = b64uDec((string) (($cred['response'] ?? [])['userHandle'] ?? ''));
                if ($hu !== '' && $hu !== (string) $row['uid']) {
                    throw new RuntimeException('The passkey belongs to another account.');
                }
                $s = db()->prepare('SELECT * FROM users WHERE id = ?');
                $s->execute([(string) $row['uid']]);
                $u = $s->fetch();
                if (!$u || $u['status'] !== 'active') {
                    throw new RuntimeException('This account is paused. Contact StratEdge HR.');
                }
                [, $cnt] = waAssert($cred, $ch, $row, true);
                secdb()->prepare('UPDATE auth_keys SET cnt = ?, used = ? WHERE kh = ?')->execute([$cnt, now(), (string) $row['kh']]);
            } catch (RuntimeException $e) {
                fwStrike('login', 'passkey sign-in refused: ' . $e->getMessage());
                fail(401, 'invalid_login', $e->getMessage());
            }
            $u['roles'] = rolesOf($u);
            if (($lock = authLocked($u)) !== '') {
                fail(429, 'locked', $lock);
            }
            $as = str($b, 'as', 12);
            $asKey = portalKeyOfLogin($as);
            if ($asKey !== '') {
                $refusal = portalLoginCheck($u, $asKey);
                if ($refusal !== null) {
                    http_response_code(403);
                    echo json_encode($refusal);
                    exit();
                }
            }
            $next = str($b, 'next', 300);
            $go = $next !== '' && preg_match('#^/[A-Za-z0-9/_\-?=&.%]*$#', $next) && !str_starts_with($next, '//') ? '#' . $next : ($asKey !== '' ? portalHome($asKey) : '#/portal/choose');
            ok(authFinish($u, 'passkey' . ($asKey !== '' ? ':' . $asKey : ''), $asKey, 2, $go, false));

        /* --- passwords: forgotten, reset links, invitations --- */
        case 'pw_policy':
            ok(pwPolicyFor(currentUser()));
        case 'pw_forgot':
            if (throttleHit('pwf:' . clientIp(), 8, 3600)) {
                fail(429, 'rate_limited', 'Too many requests from this network. Try again in an hour.');
            }
            $email = strtolower(str($b, 'email', 190));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                fail(400, 'invalid_argument', 'Enter the email address of your account.');
            }
            if (fwScreen(['email' => $email, 'website' => $b['website'] ?? '', 't0' => $b['t0'] ?? 0], 'password reset') === '' && !throttleHit('pwfe:' . $email, 3, 3600)) {
                $s = db()->prepare("SELECT * FROM users WHERE email = ? AND status = 'active'");
                $s->execute([$email]);
                $u = $s->fetch();
                if ($u) {
                    authResetLink($u);
                    audit('auth', 'Password reset requested', $email, [], $u);
                }
            }
            // the same answer whether or not the account exists
            ok(['ok' => true]);
        case 'pw_reset_check':
            $t = str($b, 't', 100);
            $row = tokGet('reset', $t) ?? tokGet('invite', $t);
            $u = $row ? userRow((string) $row['uid']) : null;
            if (!$row || !$u) {
                fail(400, 'bad_token', 'This link has expired or was already used. Ask for a new one.');
            }
            $data = json_decode((string) $row['data'], true) ?: [];
            ok(['ok' => true, 'kind' => (string) $row['kind'], 'email' => (string) $u['email'], 'name' => (string) $u['name'], 'as' => (string) ($data['as'] ?? '')] + pwPolicyFor($u + ['roles' => rolesOf($u)]));
        case 'pw_reset':
            if (throttleHit('pwr:' . clientIp(), 20, 3600)) {
                fail(429, 'rate_limited', 'Too many attempts. Try again in an hour.');
            }
            $t = str($b, 't', 100);
            $row = tokGet('reset', $t) ?? tokGet('invite', $t);
            $u = $row ? userRow((string) $row['uid']) : null;
            if (!$row || !$u || $u['status'] !== 'active') {
                fail(400, 'bad_token', 'This link has expired or was already used. Ask for a new one.');
            }
            $pw = (string) ($b['password'] ?? '');
            $why = pwProblem($pw, ['email' => $u['email'], 'name' => $u['name'], 'mfa' => pwMfaApplies($u), 'check' => true]);
            if ($why !== '') {
                fail(400, 'weak_password', $why);
            }
            db()->prepare('UPDATE users SET pass = ? WHERE id = ?')->execute([pwHash($pw), (string) $u['id']]);
            tokUse((string) $row['h']);
            // v83: the link came from the address's own mailbox, so an unconfirmed sign-up (selfReg) is confirmed now
            $ad = json_decode((string) authUser((string) $u['id'])['data'], true) ?: [];
            unset($ad['selfReg']);
            authUserSet((string) $u['id'], ['must_pw' => 0, 'why' => '', 'locked_until' => 0, 'fails' => 0, 'pw_at' => now(), 'pw_check' => now(), 'data' => json_encode((object) $ad)]);
            $n = sessRevokeAll((string) $u['id'], 'password reset');
            audit('auth', $row['kind'] === 'invite' ? 'Password chosen from invitation' : 'Password reset', (string) $u['email'], ['sessions' => $n], $u);
            if ($row['kind'] !== 'invite') {
                authMail($u, 'Your StratEdge password was changed', ['Hi ' . authFirst($u) . ',', 'The password of your StratEdge account was just reset' . ($n ? ' and ' . $n . ' signed-in session' . ($n === 1 ? ' was' : 's were') . ' ended' : '') . '.', 'If you did not do this, contact StratEdge right away.']);
            }
            ok(['ok' => true, 'email' => (string) $u['email']]);

        /* --- Sign-in & security (signed in) --- */
        case 'sec_me':
            $u = requireUser();
            $uid = (string) $u['id'];
            $m = mfaRow($uid);
            $logins = [];
            // (the person's own sign-in log: read directly, the portal's sharing rules keep log/ for staff)
            foreach (array_slice(colAll("log/$uid/items", 't', 'desc'), 0, 12) as $row) {
                $x = $row[1] ?? null;
                if ($x instanceof stdClass) {
                    $logins[] = ['t' => (int) ($x->t ?? 0), 'how' => (string) ($x->how ?? ''), 'ip' => (string) ($x->ip ?? ''), 'dev' => sessUaLabel((string) ($x->ua ?? '')), 'geo' => (string) ($x->geo->label ?? '')];
                }
            }
            $devs = [];
            $s = secdb()->prepare('SELECT * FROM auth_devices WHERE uid = ? ORDER BY seen DESC LIMIT 30');
            $s->execute([$uid]);
            $cur = sessDevice(false);
            foreach ($s->fetchAll() as $d) {
                $devs[] = ['id' => substr((string) $d['dev'], 0, 16), 'dev' => sessUaLabel((string) $d['ua']), 'geo' => (string) $d['geo'], 'at' => (int) $d['at'], 'seen' => (int) $d['seen'], 'trust' => (int) $d['trust'] > now() ? (int) $d['trust'] : 0, 'cur' => $cur !== '' && hash_equals((string) $d['dev'], $cur)];
            }
            $a = authUser($uid);
            ok([
                'methods' => mfaMethods($u),
                'totp' => $m && $m['totp'] !== '' ? (int) $m['totp_at'] : 0,
                'email' => $m ? (int) $m['email_on'] > 0 : false,
                'codes' => $m ? count(json_decode((string) $m['codes'], true) ?: []) : 0,
                'codesAt' => $m ? (int) $m['codes_at'] : 0,
                'keys' => array_map(fn($k) => ['id' => (string) $k['kh'], 'name' => (string) $k['name'], 'at' => (int) $k['at'], 'used' => (int) $k['used']], pkRows($uid)),
                'can' => ['totp' => !empty($c['totp']), 'passkey' => !empty($c['passkey']) && waRpId() !== '', 'email' => mfaEmailAllowed($u)],
                'required' => authMfaRequired($u),
                'due' => authMfaDue(),
                'remember' => (int) $c['remember'],
                'sessions' => sessList($uid),
                'devices' => $devs,
                'logins' => $logins,
                'pw' => ['at' => (int) $a['pw_at'], 'must' => (int) $a['must_pw'] ? (string) ($a['why'] ?: 'reset') : ''] + pwPolicyFor($u),
                'recent' => (int) ($_SESSION['auth_at'] ?? 0) > now() - 900000,
            ]);
        case 'auth_reauth':
            $u = requireUser();
            if (throttleHit('reauth:' . $u['id'], 8, 900)) {
                fail(429, 'rate_limited', 'Too many tries. Wait 15 minutes.');
            }
            $how = str($b, 'm', 10);
            if (in_array($how, ['passkey', 'totp', 'backup'], true)) {
                // v35: an authenticator or backup code works as well as a passkey
                mfaCheck($u, $how, $b, 'reauth');
            } elseif ($how === 'email') {
                if (!reauthEmailOffered($u) || !reauthEmailCheck((string) $u['id'], (string) ($b['code'] ?? ''))) {
                    authFailed($u, 'code');
                    fail(400, 'invalid_code', 'That code is not right, or it is more than 10 minutes old. Send a new one.');
                }
            } else {
                $s = db()->prepare('SELECT pass FROM users WHERE id = ?');
                $s->execute([(string) $u['id']]);
                if (!password_verify((string) ($b['password'] ?? ''), (string) $s->fetchColumn())) {
                    authFailed($u);
                    fail(400, 'invalid_argument', 'That password is not right.');
                }
            }
            $_SESSION['auth_at'] = now();
            audit('auth', 'Confirmed it is them', (string) $u['email'], ['how' => $how ?: 'password'], $u);
            ok(['ok' => true]);
        case 'auth_reauth_info':
            // v35: the ways this person can confirm it is them (the "Confirm it's you" window)
            $u = requireUser();
            $ms = mfaMethods($u);
            ok([
                'password' => true,
                'passkey' => in_array('passkey', $ms, true) && waRpId() !== '',
                'totp' => in_array('totp', $ms, true),
                'backup' => in_array('backup', $ms, true),
                'email' => reauthEmailOffered($u),
                'to' => mailMask((string) $u['email']),
                'min' => function_exists('guardCfg') ? (int) guardCfg()['reauthMin'] : 15,
            ]);
        case 'auth_reauth_email':
            $u = requireUser();
            if (!reauthEmailOffered($u)) {
                fail(400, 'invalid_argument', 'Use your password, passkey or authenticator app.');
            }
            reauthEmailSend($u);
            ok(['ok' => true, 'to' => mailMask((string) $u['email'])]);
        case 'auth_reauth_drop':
            // v35: the next sensitive action asks again (also used when someone steps away from a shared computer)
            requireUser();
            unset($_SESSION['auth_at']);
            ok(['ok' => true]);
        case 'mfa_totp_remove':
            $u = requireUser();
            requireRecentAuth();
            mfaLastGuard($u, 'totp');
            mfaSave((string) $u['id'], ['totp' => '', 'totp_at' => 0, 'totp_step' => 0]);
            audit('auth', 'Authenticator app removed', (string) $u['email'], [], $u);
            ok(['ok' => true]);
        case 'mfa_codes_new':
            $u = requireUser();
            requireRecentAuth();
            if (!array_diff(mfaMethods($u), ['backup'])) {
                fail(400, 'invalid_argument', 'Set up an authenticator app or a passkey first.');
            }
            $codes = mfaCodesNew((string) $u['id']);
            audit('auth', 'New backup codes', (string) $u['email'], [], $u);
            ok(['codes' => $codes]);
        case 'mfa_email_set':
            $u = requireUser();
            requireRecentAuth();
            $on = !empty($b['on']);
            if ($on && !mfaEmailAllowed($u)) {
                fail(400, 'invalid_argument', 'Email codes are not available for your role; use an authenticator app or a passkey.');
            }
            if (!$on) {
                mfaLastGuard($u, 'email');
            }
            mfaSave((string) $u['id'], ['email_on' => $on ? 1 : 0]);
            if ($on) {
                $m = mfaRow((string) $u['id']);
                $codes = count(json_decode((string) ($m['codes'] ?? ''), true) ?: []) ? [] : mfaCodesNew((string) $u['id']);
            }
            audit('auth', $on ? 'Email codes turned on' : 'Email codes turned off', (string) $u['email'], [], $u);
            ok(['ok' => true, 'codes' => $codes ?? []]);
        case 'pk_rename':
            $u = requireUser();
            secdb()->prepare('UPDATE auth_keys SET name = ? WHERE kh = ? AND uid = ?')->execute([mb_substr(str($b, 'name', 60), 0, 60) ?: 'Passkey', str($b, 'id', 64), (string) $u['id']]);
            ok(['ok' => true]);
        case 'pk_remove':
            $u = requireUser();
            requireRecentAuth();
            $keys = pkRows((string) $u['id']);
            if (count($keys) <= 1) {
                mfaLastGuard($u, 'passkey');
            }
            $s = secdb()->prepare('DELETE FROM auth_keys WHERE kh = ? AND uid = ?');
            $s->execute([str($b, 'id', 64), (string) $u['id']]);
            audit('auth', 'Passkey removed', (string) $u['email'], [], $u);
            ok(['ok' => $s->rowCount() > 0]);
        case 'sess_revoke':
            $u = requireUser();
            $id = str($b, 'id', 16);
            $s = secdb()->prepare('UPDATE auth_sessions SET out_at = ?, why = ? WHERE uid = ? AND out_at = 0 AND SUBSTR(id, 1, 16) = ?');
            $s->execute([now(), 'ended by you', (string) $u['id'], $id]);
            audit('auth', 'Session ended', (string) $u['email'], [], $u);
            ok(['ok' => $s->rowCount() > 0]);
        case 'sess_revoke_all':
            $u = requireUser();
            $n = sessRevokeAll((string) $u['id'], 'signed out everywhere', true);
            secdb()->prepare('UPDATE auth_devices SET trust = 0 WHERE uid = ?')->execute([(string) $u['id']]);
            audit('auth', 'Signed out everywhere else', (string) $u['email'], ['n' => $n], $u);
            ok(['ok' => true, 'n' => $n]);
        case 'dev_forget':
            $u = requireUser();
            $s = secdb()->prepare('DELETE FROM auth_devices WHERE uid = ? AND SUBSTR(dev, 1, 16) = ?');
            $s->execute([(string) $u['id'], str($b, 'id', 16)]);
            ok(['ok' => $s->rowCount() > 0]);

        /* --- staff managing someone else's sign-in --- */
        case 'sec_user':
            $me = requireAdmin();
            $t = authStrUid($b);
            $uid = (string) $t['id'];
            $a = authUser($uid);
            $tt = $t + ['roles' => rolesOf($t)];
            $s = secdb()->prepare('SELECT COUNT(*) FROM auth_sessions WHERE uid = ? AND out_at = 0 AND seen > ?');
            $s->execute([$uid, now() - 14 * 86400000]);
            ok([
                'methods' => mfaMethods($tt),
                'required' => authMfaRequired($tt),
                'due' => authMfaDue(),
                'locked' => (int) $a['locked_until'] > now() ? (int) $a['locked_until'] : 0,
                'must' => (int) $a['must_pw'] ? (string) $a['why'] : '',
                'sessions' => (int) $s->fetchColumn(),
                'manage' => authMayManage($me, $t),
            ]);
        case 'sec_user_mfa_reset':
        case 'sec_user_unlock':
        case 'sec_user_revoke':
        case 'sec_user_reset_link':
            $me = requireAdmin();
            $t = authStrUid($b);
            if (!authMayManage($me, $t)) {
                fail(403, 'forbidden', 'Only an administrator can change the sign-in of staff accounts.');
            }
            $uid = (string) $t['id'];
            if ($r === 'sec_user_mfa_reset') {
                requireRecentAuth();
                authMfaResetFor($me, $t, '');
                ok(['ok' => true]);
            }
            if ($r === 'sec_user_unlock') {
                authUserSet($uid, ['locked_until' => 0, 'fails' => 0]);
                audit('auth', 'Account unlocked', (string) $t['email'], [], $me);
                ok(['ok' => true]);
            }
            if ($r === 'sec_user_revoke') {
                $n = sessRevokeAll($uid, 'ended by ' . $me['name']);
                audit('auth', 'Sessions ended for someone else', (string) $t['email'], ['n' => $n], $me);
                ok(['ok' => true, 'n' => $n]);
            }
            $sent = authResetLink($t, 'reset', $me);
            audit('auth', 'Password reset link sent', (string) $t['email'], ['mailed' => $sent['mailed']], $me);
            ok(['ok' => true, 'mailed' => $sent['mailed'], 'link' => hasRole($me, 'admin') ? $sent['link'] : '']);

        /* --- Security center > Sign-in rules (administrators) --- */
        case 'sec_auth_get':
            $me = requireAdmin();
            if (!hasRole($me, 'admin')) {
                fail(403, 'forbidden', 'Only an administrator can see the sign-in rules.');
            }
            $rows = db()->query("SELECT id, email, name, role, status, access FROM users WHERE status = 'active'")->fetchAll();
            $need = 0;
            $have = 0;
            $list = [];
            foreach ($rows as $x) {
                $x['roles'] = rolesOf($x);
                if (!authMfaRequired($x)) {
                    continue;
                }
                $need++;
                $ms = mfaMethods($x);
                if ($ms) {
                    $have++;
                }
                $list[] = ['id' => $x['id'], 'n' => $x['name'], 'e' => $x['email'], 'roles' => $x['roles'], 'methods' => $ms];
            }
            ok(['cfg' => $c, 'defaults' => AUTH_DEFAULTS, 'due' => authMfaDue(), 'need' => $need, 'have' => $have, 'people' => $list, 'argon2' => defined('PASSWORD_ARGON2ID'), 'rp' => waRpId()]);
        case 'sec_auth_save':
            $me = requireAdmin();
            if (!hasRole($me, 'admin')) {
                fail(403, 'forbidden', 'Only an administrator can change the sign-in rules.');
            }
            requireRecentAuth();
            $in = (array) ($b['cfg'] ?? []);
            $saved = secKv('auth', []);
            $saved = is_array($saved) ? $saved : [];
            $num = fn($k, $lo, $hi) => max($lo, min($hi, (int) ($in[$k] ?? $c[$k])));
            $new = [
                'mfaRoles' => array_values(array_intersect(['admin', 'hr', 'acct', 'manager'], (array) ($in['mfaRoles'] ?? $c['mfaRoles']))),
                'mfaStaff' => !empty($in['mfaStaff']),
                'graceDays' => $num('graceDays', 0, 90),
                'totp' => !empty($in['totp']),
                'passkey' => !empty($in['passkey']),
                'email' => in_array($in['email'] ?? '', ['everyone', 'members', 'off'], true) ? $in['email'] : $c['email'],
                'remember' => $num('remember', 0, 90),
                'rememberStaff' => !empty($in['rememberStaff']),
                'pwMin' => $num('pwMin', 8, 64),
                'pwMinSolo' => $num('pwMinSolo', 8, 64),
                'breached' => !empty($in['breached']),
                'idleStaff' => $num('idleStaff', 5, 720),
                'idleOther' => $num('idleOther', 5, 10080),
                'absStaff' => $num('absStaff', 1, 168),
                'absOther' => $num('absOther', 1, 2160),
                'lockAfter' => $num('lockAfter', 5, 100),
                'lockMin' => $num('lockMin', 5, 1440),
                'newDevice' => !empty($in['newDevice']),
                'unusual' => !empty($in['unusual']),
                'alertUids' => array_values(array_filter(array_map('strval', (array) ($in['alertUids'] ?? [])), fn($x) => (bool) userRow($x))),
                'secEmail' => filter_var(trim((string) ($in['secEmail'] ?? '')), FILTER_VALIDATE_EMAIL) ? strtolower(trim((string) $in['secEmail'])) : '',
            ];
            if (!$new['totp'] && !$new['passkey']) {
                fail(400, 'invalid_argument', 'Keep at least one of authenticator apps and passkeys on.');
            }
            if (array_key_exists('restartGrace', $in) && !empty($in['restartGrace'])) {
                $new['mfaSince'] = now();
            }
            if (($new['secEmail'] ?? '') !== ($c['secEmail'] ?? '') || !empty($in['reviewed'])) {
                $new['secReviewed'] = now();
            }
            $changed = [];
            foreach ($new as $k => $v) {
                if (($c[$k] ?? null) !== $v) {
                    $changed[$k] = $v;
                }
            }
            secKvSet('auth', array_merge($saved, $new));
            authCfg(true);
            audit('settings', 'Sign-in rules changed', 'auth', $changed, $me);
            ok(['ok' => true, 'cfg' => authCfg()]);
    }
    fail(404, 'not_found', 'Unknown action.');
}
