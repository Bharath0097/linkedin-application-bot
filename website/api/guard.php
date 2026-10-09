<?php
declare(strict_types=1);
/*
 * v35: the second protection layer (Security center > Protection), on top of v34's sign-in rules, firewall, encryption
 * and monitoring. Loaded by api/index.php on every request.
 *
 *   1. Cross-site request blocking (Fetch Metadata): a page on another web site cannot use a visitor's signed-in browser
 *      to call the portal. Links from emails (navigations), pictures and the few public token links still work.
 *   2. Bot check (proof of work): public forms, and sign-in from an address with recent wrong passwords or while the
 *      site is under a password-guessing attack, must carry a solved puzzle: find the number n with
 *      SHA-256(salt + n) = challenge. The browser solves it in a fraction of a second without the person noticing; a bot
 *      sending thousands pays for every one. The puzzle is signed (no state on the server) and works once.
 *   3. "Confirm it's you" (requireRecentAuth in sessions.php) for sensitive actions, with the time window set here and
 *      every way of confirming (password, passkey, authenticator code, backup code, emailed code: auth.php).
 *   4. Data-theft guard: downloads, exports and candidate or consultant profiles opened are counted per person. An
 *      unusual number in an hour alerts the security contacts; three times as many pauses that person's downloads,
 *      exports and profile views until an administrator allows them again. Administrators are alerted on, never paused.
 *   5. Staff networks: administrators, HR, accounting and managers sign in (and stay signed in) only from the listed
 *      network addresses. Saving a list that leaves out the current address is refused, and staff_nets_off => true in
 *      api/config.php switches the rule off if the office address changes.
 *   6. Upload screening: a file's content must match its type, Office files with macros, archives carrying programs,
 *      unsafe paths and zip bombs are refused; ClamAV scans uploads when api/config.php names it ('clamav' =>
 *      'unix:///var/run/clamd.scan/clamd.sock' or 'tcp://127.0.0.1:3310').
 *   7. Payroll bank changes wait a few days before payroll uses them (ddHold, applied in payroll.php).
 * Settings live in the security store (secKv 'guard'); events go to the sealed audit log and the firewall log.
 */

const GUARD_DEFAULTS = [
    'reauthMin' => 15, // minutes a password, passkey or code counts as fresh for sensitive actions
    'pow' => true, // bot check on public forms
    'powLogin' => true, // ... and on sign-in after wrong passwords or during an attack
    'powIpFails' => 3, // wrong passwords from one address in 15 minutes before its sign-ins need the check
    'powAttack' => 40, // wrong passwords site-wide in 10 minutes that count as an attack (every sign-in checked for 30 minutes)
    'powLevel' => 'normal', // normal | strong (a bigger puzzle for public forms)
    'dlp' => true,
    'dlpFiles' => 150, // files downloaded per person per hour before an alert
    'dlpExports' => 15, // exports per hour
    'dlpProfiles' => 400, // candidate or consultant profiles opened per hour
    'dlpPause' => true, // at three times the hourly level, pause that person (never administrators)
    'ddHold' => 3, // days a new or changed bank account waits before payroll pays into it (0 = off)
    'staffNets' => '', // network addresses staff may sign in from (empty = anywhere)
    'av' => true, // scan uploads with ClamAV when api/config.php names it
];
// forms visitors send without signing in: each needs a solved bot check (v83: 'ai_visitor' is the site assistant)
const GUARD_POW_FORMS = ['public_contact', 'register', 'chat', 'public_share', 'priv_request', 'sec_report', 'pw_forgot', 'vms_post', 'pub_support_create', 'pub_support_reply', 'ws_signup', 'ai_visitor'];
// routes other sites may call from a visitor's browser (the autofill bookmarklet, feeds, security.txt)
const GUARD_XSITE_OK = ['apply_used', 'apply_resume', 'security_txt', 'jobs_feed'];
// services that post to the site directly (no browser): they prove themselves with a signature instead
// v83: routes that change data answer only POST (a GET carries no body, and a link on another site can open it)
const GUARD_POST_ONLY = [
    'dd_save', 'dd_release', 'dd_dispute', 'dd_prenoted', 'ach_settings_save', 'pay_nacha', 'pay_dd_register', 'my_w4_save', 'taxdep_save', 'taxdep_delete',
    'pr_settings_save', 'pr_remind', 'pr_start', 'pr_turn', 'pr_end', 'pr_drill_save', 'mail_safety_save',
];
const GUARD_HOOKS = ['unsub', 'mail_webhook', 'mail_inbound', 'mail_postal_hook', 'mail_postal_inbound', 'mail_ses_hook', 'plaid_webhook', 'stripe_webhook'];
// the size of the puzzle: the browser tries up to this many numbers (half on average)
const GUARD_POW_MAX = ['normal' => 60000, 'strong' => 300000];
// v35: actions that need "Confirm it's you" (a password, passkey or code from the last few minutes): access and
// roles, keys and connections to outside services, bank accounts and payroll files, bulk exports, data deletion
// (v83: atc_save too: the Ceipal/Oorwin addresses decide where the stored ATS credentials are sent)
const GUARD_REAUTH_ROUTES = [
    'admin_access', 'admin_feature_access', 'admin_role', 'admin_member_role', 'admin_manager', 'admin_status', 'admin_reset', 'admin_books_access',
    'mail_settings_save', 'plaid_settings_save', 'qbo_settings_save', 'sso_settings_save', 'ai_settings_save', 'bill_settings_save', 'cx_save', 'cx_auto', 'src_save', 'src_dice_feed_mode', 'oorwin_login', 'oorwin_disconnect', 'atc_save', 'oorwin_import', 'vms_settings_save', 'vms_agent_run', 'vms_agent_retry', 'sec_save',
    // v83: the import connections (mig_save/mig_drop) like the other outside keys, and finishing an access review,
    // which pauses and signs out every account marked Remove, like admin_status does for one
    'mig_save', 'mig_drop', 'gov_rev_done',
    'ach_settings_save', 'dd_save', 'dd_release', 'pay_nacha',
    'ats_export', 'books_export', 'priv_export', 'priv_send_copy', 'priv_erase', 'priv_run', 'gov_audit_csv',
];
// what the data-theft guard counts, per route (files are counted in the file route itself, pictures left out)
const GUARD_DLP_ROUTES = [
    'mkt_resume' => 'file',
    'mymail_download' => 'file',
    'ats_card' => 'profile',
    'mkt_profile' => 'profile',
    'ts_person' => 'profile',
    'apply_profile_get' => 'profile',
    'ats_export' => 'export',
    'books_export' => 'export',
    'priv_export' => 'export',
    'mymail_export' => 'export',
    'pay_dd_register' => 'export',
    'pay_nacha' => 'export',
];
const GUARD_DLP_KINDS = [
    'file' => ['dlpFiles', 'downloaded files'],
    'export' => ['dlpExports', 'exported data'],
    'profile' => ['dlpProfiles', 'opened candidate or consultant profiles'],
];

function guardCfg(bool $fresh = false): array
{
    static $c = null;
    if ($c !== null && !$fresh) {
        return $c;
    }
    $saved = secKv('guard', []);
    $c = array_merge(GUARD_DEFAULTS, is_array($saved) ? $saved : []);
    return $c;
}

/** Adds $inc to a counter that starts over after $windowSec; returns the new count ($inc 0 only reads). */
function guardCount(string $key, int $windowSec, int $inc = 1): int
{
    $p = db();
    $t = now();
    $s = $p->prepare('SELECT n, until FROM throttle WHERE k = ?');
    $s->execute([$key]);
    $r = $s->fetch();
    if (!$r || (int) $r['until'] < $t) {
        if ($inc > 0) {
            $p->prepare('REPLACE INTO throttle (k, n, until) VALUES (?,?,?)')->execute([$key, $inc, $t + $windowSec * 1000]);
            if (random_int(1, 200) === 1) {
                throttlePrune(); // v83: expired counters are removed now and then (lib.php)
            }
        }
        return max(0, $inc);
    }
    if ($inc > 0) {
        $p->prepare('UPDATE throttle SET n = n + ? WHERE k = ?')->execute([$inc, $key]);
    }
    return (int) $r['n'] + $inc;
}

/* ---------- 1. cross-site requests (Fetch Metadata) ---------- */
function guardFetchMeta(string $r, string $method): void
{
    $site = strtolower((string) ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? ''));
    // same origin, same site, a typed address or bookmark ('none'), or a browser that sends no such header
    if ($site !== 'cross-site' || in_array($r, GUARD_HOOKS, true) || in_array($r, GUARD_XSITE_OK, true) || str_starts_with($r, 'phw_')) {
        return;
    }
    $mode = strtolower((string) ($_SERVER['HTTP_SEC_FETCH_MODE'] ?? ''));
    $dest = strtolower((string) ($_SERVER['HTTP_SEC_FETCH_DEST'] ?? ''));
    // a link in an email or on another site opens a page or a file; a picture in an email loads: both fine
    if ($method === 'GET' && ($mode === 'navigate' || $dest === 'image')) {
        return;
    }
    fwLog('xsite', 'Cross-site ' . $method . ' (' . $mode . '/' . $dest . ') from ' . mb_substr((string) ($_SERVER['HTTP_ORIGIN'] ?? ($_SERVER['HTTP_REFERER'] ?? '?')), 0, 120), $r);
    fail(403, 'cross_site', 'Rejected: this request came from another web site.');
}

/* ---------- 2. the bot check (proof of work) ---------- */
/** A new puzzle. The expiry is part of the salt, so it is covered by the hash and the signature. */
function powIssue(string $level = ''): array
{
    $lv = $level !== '' ? $level : (string) guardCfg()['powLevel'];
    $max = GUARD_POW_MAX[$lv] ?? GUARD_POW_MAX['normal'];
    $salt = bin2hex(random_bytes(12)) . '.' . (now() + 10 * 60000);
    $ch = hash('sha256', $salt . random_int(0, $max));
    return ['alg' => 'SHA-256', 'salt' => $salt, 'challenge' => $ch, 'max' => $max, 'sig' => secMac('pow', $ch)];
}
/** Checks a solved puzzle (base64 of {salt, challenge, sig, n}); each one works once, for ten minutes. */
function powVerify(string $tok): bool
{
    if ($tok === '' || strlen($tok) > 600) {
        return false;
    }
    $j = json_decode((string) base64_decode(strtr($tok, '-_', '+/'), true), true);
    if (!is_array($j)) {
        return false;
    }
    $salt = (string) ($j['salt'] ?? '');
    $ch = (string) ($j['challenge'] ?? '');
    $sig = (string) ($j['sig'] ?? '');
    $n = $j['n'] ?? null;
    if (!preg_match('/^[a-f0-9]{24}\.(\d{13})$/', $salt, $m) || !preg_match('/^[a-f0-9]{64}$/', $ch) || !is_int($n) || $n < 0 || $n > GUARD_POW_MAX['strong']) {
        return false;
    }
    if ((int) $m[1] < now() || !hash_equals(secMac('pow', $ch), $sig) || !hash_equals($ch, hash('sha256', $salt . $n))) {
        return false;
    }
    // used once: a second request with the same solution is refused
    return !throttleHit('pow:' . substr($ch, 0, 40), 1, 900);
}
/** Why this request must carry a solved check ('' = it need not). */
function guardPowReason(string $r, string $method): string
{
    if ($method !== 'POST') {
        return '';
    }
    $c = guardCfg();
    $ip = fwIp();
    // networks on the firewall's allow list (the office) are trusted
    if (fwIpMatches($ip, fwLines((string) (fwSettings()['allow'] ?? '')))) {
        return '';
    }
    if (!empty($c['pow']) && in_array($r, GUARD_POW_FORMS, true) && empty($_SESSION['uid'])) {
        return 'form';
    }
    if ($r === 'login' && !empty($c['powLogin'])) {
        if ((int) secKv('guard_attack', 0) > now()) {
            return 'attack';
        }
        if (guardCount('guard:ipfail:' . ipBucket($ip), 900, 0) >= max(1, (int) $c['powIpFails'])) { // v83: per IPv6 /64
            return 'fails';
        }
    }
    return '';
}
function guardPowGate(string $r, string $method): void
{
    $why = guardPowReason($r, $method);
    if ($why === '') {
        return;
    }
    $tok = (string) ($_SERVER['HTTP_X_SE_POW'] ?? '');
    if ($tok !== '') {
        if (powVerify($tok)) {
            return;
        }
        fwStrike('bot', 'Bot check failed or reused (' . $r . ')');
    }
    fail(428, 'pow_required', 'Checking that you are a person. Try again in a moment.', ['pow' => powIssue($why === 'attack' ? 'strong' : '')]);
}
/** A wrong password: counts for the address, and site-wide for attack mode. */
function guardLoginFailed(): void
{
    $c = guardCfg();
    if (empty($c['powLogin'])) {
        return;
    }
    try {
        guardCount('guard:ipfail:' . ipBucket(fwIp()), 900); // v83: per IPv6 /64
        $n = guardCount('guard:fails', 600);
        if ($n >= max(5, (int) $c['powAttack']) && (int) secKv('guard_attack', 0) < now()) {
            secKvSet('guard_attack', now() + 30 * 60000);
            require_once __DIR__ . '/auth.php';
            secAlertAdmins('attack:' . gmdate('YmdH'), 'Many wrong passwords: every sign-in now passes the bot check', $n . ' wrong passwords in the last 10 minutes (password guessing or a list of stolen passwords). For the next 30 minutes every sign-in must pass the invisible bot check, on top of the lockouts and two-step sign-in. Watch the sign-in alerts; nothing else is needed.');
        }
    } catch (Throwable $e) {
        // counting never blocks a sign-in
    }
}

/* ---------- 4. data-theft guard ---------- */
function guardPaused(string $uid): ?array
{
    $d = secKv('dlp_pause_' . $uid);
    return is_array($d) && !empty($d['at']) ? $d : null;
}
/** Counts one download, export or profile for the signed-in person; alerts and pauses (see the file header). */
function guardDlp(array $u, string $kind, string $what = ''): void
{
    $c = guardCfg();
    if (empty($c['dlp']) || !isset(GUARD_DLP_KINDS[$kind])) {
        return;
    }
    $uid = (string) $u['id'];
    $admin = hasRole($u, 'admin');
    if (!$admin && guardPaused($uid)) {
        fail(423, 'paused', 'Downloads, exports and profile views are paused on your account after an unusual number in a short time. Ask an administrator to allow them again.');
    }
    [$key, $label] = GUARD_DLP_KINDS[$kind];
    $limit = max(5, (int) $c[$key]);
    $n = guardCount('dlp:' . $kind . ':' . $uid, 3600);
    $pauseAt = 3 * $limit;
    if ($n === $limit + 1) {
        require_once __DIR__ . '/auth.php';
        secAlertAdmins('dlp:' . $kind . ':' . $uid, 'Unusual data access by ' . $u['name'], $u['name'] . ' (' . $u['email'] . ') ' . $label . ' ' . $n . ' times in the last hour (the alert level is ' . $limit . ')' . ($what !== '' ? ', most recently ' . mb_substr($what, 0, 80) : '') . '. If this is not expected work, ask them, or pause the account under Team.' . (!$admin && !empty($c['dlpPause']) ? ' At ' . $pauseAt . ' in an hour their downloads pause on their own.' : ''));
        audit('data', 'Unusual data access', (string) $u['email'], ['kind' => $kind, 'n' => $n, 'what' => mb_substr($what, 0, 120)], $u);
    }
    if (!$admin && !empty($c['dlpPause']) && $n >= $pauseAt) {
        secKvSet('dlp_pause_' . $uid, ['at' => now(), 'kind' => $kind, 'n' => $n, 'name' => (string) $u['name'], 'email' => (string) $u['email']]);
        audit('data', 'Downloads paused automatically', (string) $u['email'], ['kind' => $kind, 'n' => $n], $u);
        require_once __DIR__ . '/auth.php';
        secAlertAdmins('dlppause:' . $uid, 'Downloads paused for ' . $u['name'], $u['name'] . ' (' . $u['email'] . ') ' . $label . ' ' . $n . ' times within an hour, so their downloads, exports and profile views are paused. Check with them (or their manager); allow them again under Security center > Protection when it was genuine work, or pause the account under Team if it was not.');
        fail(423, 'paused', 'Downloads, exports and profile views are paused on your account after an unusual number in a short time. Ask an administrator to allow them again.');
    }
}
/** The route-level part of the guard (profiles and exports; files are counted where the file is known). */
function guardDlpRoute(string $r): void
{
    if (!isset(GUARD_DLP_ROUTES[$r])) {
        return;
    }
    $u = currentUser();
    if ($u) {
        guardDlp($u, GUARD_DLP_ROUTES[$r], $r);
    }
}
/** v83: a candidate record (ats/<id>) read one at a time through the generic record routes (doc, batch) counts as a
 *  profile opened; the ATS list itself (col) is not counted. In a batch ($soft) a paused person gets false, so only
 *  that one entry is refused and the rest of the page keeps updating. */
function guardDlpDoc(string $path, bool $soft = false): bool
{
    if ($path === 'ats/x' || !preg_match('#^ats/[A-Za-z0-9_\-]+$#', $path)) {
        return true;
    }
    $u = currentUser();
    if (!$u) {
        return true;
    }
    if ($soft && !empty(guardCfg()['dlp']) && !hasRole($u, 'admin') && guardPaused((string) $u['id'])) {
        return false;
    }
    guardDlp($u, 'profile', $path);
    return true;
}

/* ---------- 5. staff networks ---------- */
function guardNetOk(array $u): bool
{
    if (cfg('staff_nets_off')) {
        return true;
    }
    $list = fwLines((string) guardCfg()['staffNets']);
    if (!$list) {
        return true;
    }
    $u['roles'] = $u['roles'] ?? rolesOf($u);
    if (!sessPrivileged($u)) {
        return true;
    }
    return fwIpMatches(fwIp(), $list);
}
/** Records and reports a staff sign-in refused outside the listed networks. */
function guardNetRefuse(array $u): void
{
    audit('auth', 'Staff sign-in refused outside the office networks', (string) $u['email'], ['ip' => fwIp()], $u);
    require_once __DIR__ . '/auth.php';
    secAlertAdmins('net:' . $u['id'], 'Staff sign-in from outside the office networks: ' . $u['name'], $u['name'] . ' (' . $u['email'] . ') proved who they are from ' . fwIp() . ', which is not one of the staff networks, so the sign-in was refused. If they are travelling, add the address under Security center > Protection; if not, change their password.');
}
/** At sign-in: a staff account outside the listed networks is refused (and the security contacts are told). */
function guardNetGate(array $u): void
{
    if (guardNetOk($u)) {
        return;
    }
    guardNetRefuse($u);
    fail(403, 'network', 'Staff accounts sign in only from the office networks. This network address is ' . fwIp() . '; ask an administrator to add it if you need to work from here.');
}

/* ---------- 6. upload screening ---------- */
/** '' when the uploaded file at $path (still unencrypted) may be kept, otherwise why it was refused. */
function guardUpload(string $path, string $name): string
{
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    $fh = @fopen($path, 'rb');
    if (!$fh) {
        return 'The file could not be read. Try again.';
    }
    $head = (string) fread($fh, 4096);
    fclose($fh);
    $size = (int) @filesize($path);
    $is = fn(string $sig, int $at = 0) => substr($head, $at, strlen($sig)) === $sig;
    $ok = match ($ext) {
        'pdf' => str_contains(substr($head, 0, 1024), '%PDF-'),
        'png' => $is("\x89PNG\r\n\x1a\n"),
        'jpg', 'jpeg' => $is("\xFF\xD8\xFF"),
        'gif' => $is('GIF87a') || $is('GIF89a'),
        'webp' => $is('RIFF') && substr($head, 8, 4) === 'WEBP',
        'zip', 'docx', 'xlsx', 'pptx' => $is("PK\x03\x04") || $is("PK\x05\x06"),
        'csv', 'txt', 'md', 'json' => !str_contains($head, "\0"),
        default => true,
    };
    if (!$ok) {
        return 'This file is not really a .' . $ext . ' file (its content is something else), so it was not accepted.';
    }
    if (in_array($ext, ['png', 'jpg', 'jpeg', 'gif', 'webp'], true) && preg_match('/<\s*(script|html|iframe)\b/i', $head)) {
        return 'This picture also carries web page code, so it was not accepted.';
    }
    if ($ext === 'pdf' && guardScanBytes($path, '/Launch')) {
        return 'This PDF tries to start a program when it is opened, so it was not accepted.';
    }
    if (in_array($ext, ['zip', 'docx', 'xlsx', 'pptx'], true)) {
        $why = guardZip($path, $ext, $size);
        if ($why !== '') {
            return $why;
        }
    }
    $av = guardAvScan($path);
    if (!empty($av['virus'])) {
        audit('alert', 'Virus refused in an upload', $name, ['virus' => $av['virus']]);
        return 'The virus scanner found ' . $av['virus'] . ' in this file, so it was not accepted.';
    }
    return '';
}
/**
 * An attachment on an email from outside (any type may arrive): programs, scripts, shortcuts, disk images, web pages
 * and Office files with macros are removed before anyone can open them; the rest is screened like an upload.
 */
function guardInbound(string $path, string $name): string
{
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    if (preg_match('/^(exe|dll|scr|pif|com|cpl|msi|msp|msc|lnk|url|hta|vbs|vbe|js|jse|mjs|wsf|wsh|ps1|psm1|psd1|bat|cmd|reg|jar|apk|app|dmg|pkg|iso|img|vhdx?|docm|xlsm|pptm|dotm|xltm|potm|ppsm|xlam|ppam|sldm|html?|xhtml|shtml|svgz?|mht|mhtml|chm|scf|inf|sct|xll|one)$/', $ext)) {
        return 'a .' . $ext . ' file can run code on a computer';
    }
    if (in_array($ext, ['doc', 'dot', 'xls', 'xlt', 'ppt', 'pps', 'pot'], true) && (guardScanBytes($path, "_\0V\0B\0A\0_\0P\0R\0O\0J\0E\0C\0T\0") || guardScanBytes($path, "M\0a\0c\0r\0o\0s\0"))) {
        return 'this Office file contains macros';
    }
    if (isset(MIME[$ext])) {
        $why = guardUpload($path, $name);
        return $why === '' ? '' : rtrim(lcfirst(preg_replace('/,? so it was not accepted.*$/', '', $why) ?? $why), '.');
    }
    $av = guardAvScan($path);
    return !empty($av['virus']) ? 'the virus scanner found ' . $av['virus'] : '';
}
/** Whether a byte string appears anywhere in the file (read in 1 MB pieces with an overlap). */
function guardScanBytes(string $path, string $needle): bool
{
    $fh = @fopen($path, 'rb');
    if (!$fh) {
        return false;
    }
    $carry = '';
    $hit = false;
    while (!feof($fh)) {
        $chunk = $carry . (string) fread($fh, 1048576);
        if (str_contains($chunk, $needle)) {
            $hit = true;
            break;
        }
        $carry = substr($chunk, -strlen($needle));
    }
    fclose($fh);
    return $hit;
}
function guardZip(string $path, string $ext, int $size): string
{
    if (!class_exists('ZipArchive')) {
        return '';
    }
    $z = new ZipArchive();
    if ($z->open($path) !== true) {
        return 'This file is damaged: it could not be opened as a .' . $ext . ' file.';
    }
    $why = '';
    $total = 0;
    $programs = '/\.(exe|dll|scr|pif|com|cpl|msi|msp|msc|lnk|hta|vbs|vbe|wsf|wsh|jse|iso|img|vhdx?|docm|xlsm|pptm|dotm|xltm|potm|ppsm|xlam|ppam|sldm)$/i';
    $n = min($z->numFiles, 20000);
    for ($i = 0; $i < $n; $i++) {
        $st = $z->statIndex($i);
        if (!$st) {
            continue;
        }
        $name = (string) $st['name'];
        $total += (int) $st['size'];
        if ($ext !== 'zip' && preg_match('#(^|/)(vbaProject\.bin|vbaData\.xml)$#i', $name)) {
            $why = 'This Office file contains macros (programs), so it was not accepted. Save it again as a normal .' . $ext . ' file without macros.';
            break;
        }
        if (preg_match($programs, $name)) {
            $why = 'This file contains a program or a file with macros (' . mb_substr(basename($name), 0, 60) . '), so it was not accepted.';
            break;
        }
        if (str_contains($name, '../') || str_starts_with($name, '/') || str_contains($name, ':\\')) {
            $why = 'This archive has unsafe file paths inside, so it was not accepted.';
            break;
        }
    }
    if ($why === '' && $z->numFiles > 20000) {
        $why = 'This archive holds more than 20,000 files, so it was not accepted.';
    }
    if ($why === '' && ($total > 2 * 1024 ** 3 || ($size > 0 && $total > 100 * 1024 ** 2 && $total / $size > 200))) {
        $why = 'This archive grows to ' . round($total / 1024 ** 2) . ' MB when unpacked (a "zip bomb"), so it was not accepted.';
    }
    if ($why === '' && $ext !== 'zip' && $z->locateName('[Content_Types].xml') === false) {
        $why = 'This is not a real .' . $ext . ' file, so it was not accepted.';
    }
    $z->close();
    return $why;
}
/** Where ClamAV listens: api/config.php 'clamav' (or the SE_CLAMAV environment variable). */
function guardAvTarget(): string
{
    return trim((string) (cfg('clamav') ?: (getenv('SE_CLAMAV') ?: '')));
}
/** ClamAV over its socket (INSTREAM). Unreachable scanners never block an upload; the Security center shows the error. */
function guardAvScan(string $path): array
{
    $target = guardAvTarget();
    if ($target === '' || empty(guardCfg()['av'])) {
        return ['ok' => true, 'skipped' => true];
    }
    $fp = @stream_socket_client($target, $errno, $errstr, 3);
    if (!$fp) {
        secKvSet('av_err', ['at' => now(), 'err' => 'Could not reach ClamAV at ' . $target . ': ' . $errstr]);
        return ['ok' => true, 'err' => $errstr];
    }
    stream_set_timeout($fp, 30);
    fwrite($fp, "zINSTREAM\0");
    $fh = @fopen($path, 'rb');
    while ($fh && !feof($fh)) {
        $chunk = (string) fread($fh, 65536);
        if ($chunk === '') {
            break;
        }
        fwrite($fp, pack('N', strlen($chunk)) . $chunk);
    }
    if ($fh) {
        fclose($fh);
    }
    fwrite($fp, pack('N', 0));
    $res = '';
    while (!feof($fp) && !str_contains($res, "\0")) {
        $part = fread($fp, 4096);
        if ($part === false || $part === '') {
            break;
        }
        $res .= $part;
    }
    fclose($fp);
    $res = trim(str_replace("\0", '', $res));
    if (preg_match('/:\s*(.+?)\s+FOUND$/', $res, $m)) {
        return ['ok' => false, 'virus' => mb_substr($m[1], 0, 120)];
    }
    if (!str_ends_with($res, 'OK')) {
        secKvSet('av_err', ['at' => now(), 'err' => 'ClamAV answered: ' . mb_substr($res, 0, 200)]);
        return ['ok' => true, 'err' => $res];
    }
    secKvSet('av_ok', now());
    return ['ok' => true];
}

/* ---------- Security center > Protection (administrators) ---------- */
function guardRoute(string $r, array $b): never
{
    $me = requireAdmin();
    if (!hasRole($me, 'admin')) {
        fail(403, 'forbidden', 'Protection settings are for administrators.');
    }
    switch ($r) {
        case 'guard_get':
            $pauses = [];
            foreach (secdb()->query("SELECT k, v FROM sec_kv WHERE k LIKE 'dlp_pause_%'")->fetchAll() as $row) {
                $v = json_decode((string) $row['v'], true);
                if (is_array($v) && !empty($v['at'])) {
                    $pauses[] = ['uid' => substr((string) $row['k'], 10)] + $v;
                }
            }
            $ev = secdb()->prepare("SELECT seq, at, act, target, detail FROM audit_log WHERE kind = 'data' OR (kind = 'alert' AND (target LIKE 'dlp%' OR target LIKE 'attack%' OR target LIKE 'net:%')) ORDER BY seq DESC LIMIT 30");
            $ev->execute();
            $fw = fwdb()->prepare("SELECT kind, COUNT(*) AS n FROM fw_log WHERE at > ? AND kind IN ('bot', 'xsite') GROUP BY kind");
            $fw->execute([now() - 7 * 86400000]);
            $counts = [];
            foreach ($fw->fetchAll() as $x) {
                $counts[$x['kind']] = (int) $x['n'];
            }
            $holds = 0;
            foreach (db()->query("SELECT data FROM docs WHERE col = 'sec/dd/items'")->fetchAll(PDO::FETCH_COLUMN) as $raw) {
                $dd = json_decode((string) $raw);
                foreach ((array) (is_object($dd) ? ($dd->accts ?? []) : []) as $a) {
                    if (is_object($a) && (int) ($a->holdUntil ?? 0) > now()) {
                        $holds++;
                        break;
                    }
                }
            }
            $att = (int) secKv('guard_attack', 0);
            ok([
                'cfg' => guardCfg(),
                'ip' => fwIp(),
                'netsOff' => (bool) cfg('staff_nets_off'),
                'pauses' => $pauses,
                'events' => $ev->fetchAll(),
                'attack' => $att > now() ? $att : 0,
                'counts' => $counts,
                'holds' => $holds,
                'av' => ['target' => guardAvTarget() !== '', 'ok' => (int) secKv('av_ok', 0), 'err' => secKv('av_err')],
                'zip' => class_exists('ZipArchive'),
            ]);
        case 'guard_save':
            requireRecentAuth();
            $in = (array) ($b['cfg'] ?? []);
            $cur = guardCfg();
            $num = fn(string $k, int $min, int $max) => max($min, min($max, (int) ($in[$k] ?? $cur[$k])));
            // v83: a switch the request leaves out keeps its saved value (before, a partial save such as {reauthMin:1}
            // turned the bot check, data-theft guard and virus scan off)
            $on = fn(string $k) => array_key_exists($k, $in) && $in[$k] !== null ? !empty($in[$k]) : !empty($cur[$k]);
            $nets = implode("\n", array_slice(fwLines((string) ($in['staffNets'] ?? $cur['staffNets'])), 0, 60));
            foreach (fwLines($nets) as $e) {
                if (!filter_var($e, FILTER_VALIDATE_IP) && !preg_match('#^[0-9a-f:.]+(/\d{1,3}|\.)$#', $e)) {
                    fail(400, 'invalid_argument', 'Staff networks: "' . $e . '" is not a network address. Use addresses like 203.0.113.9, prefixes like 203.0.113. or blocks like 203.0.113.0/24.');
                }
            }
            if ($nets !== '' && !fwIpMatches(fwIp(), fwLines($nets))) {
                fail(400, 'invalid_argument', 'Your own network address (' . fwIp() . ') is not in the staff networks, so saving would sign you out for good. Add it first.');
            }
            $new = [
                'reauthMin' => $num('reauthMin', 1, 60),
                'pow' => $on('pow'),
                'powLogin' => $on('powLogin'),
                'powIpFails' => $num('powIpFails', 1, 50),
                'powAttack' => $num('powAttack', 5, 5000),
                'powLevel' => ($in['powLevel'] ?? $cur['powLevel']) === 'strong' ? 'strong' : 'normal',
                'dlp' => $on('dlp'),
                'dlpFiles' => $num('dlpFiles', 5, 100000),
                'dlpExports' => $num('dlpExports', 5, 10000),
                'dlpProfiles' => $num('dlpProfiles', 5, 100000),
                'dlpPause' => $on('dlpPause'),
                'ddHold' => $num('ddHold', 0, 14),
                'staffNets' => $nets,
                'av' => $on('av'),
            ];
            secKvSet('guard', $new);
            guardCfg(true);
            $diff = [];
            foreach ($new as $k => $v) {
                if (($cur[$k] ?? null) !== $v) {
                    $diff[$k] = ['from' => $cur[$k] ?? null, 'to' => $v];
                }
            }
            audit('settings', 'Protection settings changed', 'guard', $diff, $me);
            ok(['cfg' => $new]);
        case 'guard_release':
            $uid = str($b, 'uid', 40);
            $p = guardPaused($uid);
            if (!$p) {
                fail(404, 'not_found', 'That person is not paused.');
            }
            secdb()->prepare('DELETE FROM sec_kv WHERE k = ?')->execute(['dlp_pause_' . $uid]);
            foreach (array_keys(GUARD_DLP_KINDS) as $k) {
                throttleClear('dlp:' . $k . ':' . $uid);
            }
            audit('data', 'Downloads allowed again', (string) ($p['email'] ?? $uid), ['note' => str($b, 'note', 300)], $me);
            ok(['ok' => true]);
        case 'guard_attack_end':
            secKvSet('guard_attack', 0);
            throttleClear('guard:fails');
            audit('settings', 'Sign-in attack mode ended', 'guard', [], $me);
            ok(['ok' => true]);
        case 'guard_av_test':
            if (guardAvTarget() === '') {
                fail(400, 'invalid_argument', 'No virus scanner is set in api/config.php (clamav).');
            }
            // the EICAR test file: harmless, and every scanner reports it
            $tmp = tempnam(sys_get_temp_dir(), 'eicar');
            file_put_contents($tmp, 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
            $res = guardAvScan($tmp);
            @unlink($tmp);
            ok(['found' => !empty($res['virus']), 'virus' => (string) ($res['virus'] ?? ''), 'err' => (string) ($res['err'] ?? '')]);
        default:
            fail(404, 'not_found', 'Unknown action.');
    }
}
