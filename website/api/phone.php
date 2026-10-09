<?php
declare(strict_types=1);
/*
 * v39 Phone & texts (VoIP), through the company's own Twilio account: each workspace connects its own, so nothing
 * is billed to StratEdge. People an administrator switched the phone on for (Roles & access, "Phone & texts"):
 *   - call any number from the browser (or click a phone number on a candidate, consultant, vendor or contact),
 *     with a company number as caller ID;
 *   - take incoming calls on the company numbers that ring for them, with voicemail and missed-call alerts;
 *   - a call log kept by phone number (so each record shows its calls), recordings after a notice is played, live
 *     transcripts and an AI summary;
 *   - text messages from the same numbers, with STOP / START honored.
 * How it works with Twilio (no Twilio library: plain HTTPS and hand-written signatures):
 *   - the browser holds an Access Token this server signs (JWT HS256 with the API key secret, 1 hour);
 *   - a TwiML App sends each browser call to phw_out; each company number sends its calls to phw_in and its texts to
 *     phw_sms; the call legs, recordings, transcripts and text statuses report to phw_* callbacks;
 *   - every request from Twilio is checked against its X-Twilio-Signature (HMAC-SHA1 with the Auth Token);
 *   - recordings stay on Twilio and play through ph_rec (the keys never reach the browser).
 * Safety: emergency numbers are not dialed from the portal unless an administrator allows it; calls only go to the
 * countries allowed (US and Canada by default; the Caribbean "+1" areas and premium numbers are refused); calls and
 * texts per person per hour are limited.
 */

const PH_CFG = 'sec/x/phone/cfg';
// "+1" numbers that are not the US or Canada (Caribbean and Atlantic countries: international rates, a toll-fraud favorite)
const PH_NANP_ABROAD = ['242', '246', '264', '268', '284', '345', '441', '473', '649', '658', '664', '721', '758', '767', '784', '809', '829', '849', '868', '869', '876'];
// numbers that cost the caller extra (900, 976) or are not real lines
const PH_NANP_BLOCK = ['900', '976', '950', '958', '959'];
const PH_EMERGENCY = ['911', '933', '112', '999', '000', '100', '101', '102', '108', '110', '119'];
const PH_STOP = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'revoke', 'optout'];
const PH_START = ['start', 'unstop', 'yes'];

function phDb(): PDO
{
    static $ready = false;
    $p = db();
    if (!$ready) {
        $ready = true;
        $p->exec('CREATE TABLE IF NOT EXISTS ph_calls (id VARCHAR(24) PRIMARY KEY, sid VARCHAR(64) NOT NULL, at BIGINT NOT NULL, dir VARCHAR(3) NOT NULL, num VARCHAR(24) NOT NULL, other VARCHAR(32) NOT NULL, od VARCHAR(16) NOT NULL, uid VARCHAR(40) NOT NULL, st VARCHAR(16) NOT NULL, secs INT NOT NULL DEFAULT 0, rec VARCHAR(64) NOT NULL DEFAULT \'\', rsecs INT NOT NULL DEFAULT 0, vm INT NOT NULL DEFAULT 0, ref VARCHAR(80) NOT NULL DEFAULT \'\', tx LONGTEXT NOT NULL, sum LONGTEXT NOT NULL, note LONGTEXT NOT NULL, data LONGTEXT NOT NULL)');
        $p->exec('CREATE TABLE IF NOT EXISTS ph_msgs (id VARCHAR(24) PRIMARY KEY, sid VARCHAR(64) NOT NULL, at BIGINT NOT NULL, dir VARCHAR(3) NOT NULL, num VARCHAR(24) NOT NULL, other VARCHAR(32) NOT NULL, od VARCHAR(16) NOT NULL, uid VARCHAR(40) NOT NULL, body LONGTEXT NOT NULL, st VARCHAR(16) NOT NULL, err VARCHAR(120) NOT NULL DEFAULT \'\', media INT NOT NULL DEFAULT 0, ref VARCHAR(80) NOT NULL DEFAULT \'\')');
        $p->exec('CREATE TABLE IF NOT EXISTS ph_optout (od VARCHAR(16) PRIMARY KEY, at BIGINT NOT NULL, kw VARCHAR(16) NOT NULL)');
        $p->exec('CREATE TABLE IF NOT EXISTS ph_dir (od VARCHAR(16) NOT NULL, kind VARCHAR(12) NOT NULL, rid VARCHAR(80) NOT NULL, name VARCHAR(190) NOT NULL, sub VARCHAR(190) NOT NULL)');
        foreach (['CREATE INDEX IF NOT EXISTS ph_calls_od ON ph_calls (od, at)', 'CREATE INDEX IF NOT EXISTS ph_calls_sid ON ph_calls (sid)', 'CREATE INDEX IF NOT EXISTS ph_calls_at ON ph_calls (at)', 'CREATE INDEX IF NOT EXISTS ph_msgs_od ON ph_msgs (od, at)', 'CREATE INDEX IF NOT EXISTS ph_msgs_sid ON ph_msgs (sid)', 'CREATE INDEX IF NOT EXISTS ph_dir_od ON ph_dir (od)'] as $q) {
            try {
                $p->exec($q);
            } catch (Throwable $e) {
                // a database without IF NOT EXISTS for indexes: they only speed things up
            }
        }
    }
    return $p;
}

/* ---------------------------------------------------------------- settings */

/** The phone settings (secrets still sealed). */
/** True when this phone configuration document has actually been set up (a provider with its secret). Used to decide
 *  whether a workspace has its own setup or should inherit StratEdge's. */
function phDocConfigured(array $c): bool
{
    $p = (string) ($c['provider'] ?? '');
    if ($p === 'vitel') {
        return ($c['vitelPassword'] ?? '') !== '';
    }
    if ($p === 'custom') {
        return ($c['providerKey'] ?? '') !== '';
    }
    // twilio (default)
    return ($c['token'] ?? '') !== '' || ($c['keySecret'] ?? '') !== '';
}
/** The saved phone configuration. $ownOnly keeps it to this request's own store (for saving). Otherwise, v82: a
 *  StratEdge-managed company workspace that has not set up its own phone inherits StratEdge's central configuration,
 *  read from StratEdge's database; PH_CFG_MAINKEY then holds StratEdge's key so phCfg() can unseal its secrets. */
function phCfgRaw(bool $ownOnly = false): array
{
    $d = docGet(PH_CFG);
    $c = $d ? json_decode(json_encode($d), true) : [];
    $GLOBALS['PH_CFG_MAINKEY'] = null;
    if (!$ownOnly && !phDocConfigured($c) && function_exists('wsSlug') && wsSlug() !== '') {
        $m = wsMainDoc(PH_CFG);
        if (is_array($m) && phDocConfigured($m)) {
            $c = $m;
            $k = wsMainKey();
            $GLOBALS['PH_CFG_MAINKEY'] = $k !== '' ? $k : null;
        }
    }
    return $c;
}
/** The settings with defaults; $secrets unseals the API key secret and the Auth Token. */
function phCfg(bool $secrets = false): array
{
    $c = phCfgRaw();
    $out = [
        'provider' => in_array((string) ($c['provider'] ?? 'twilio'), ['twilio','vitel','custom'], true) ? (string) ($c['provider'] ?? 'twilio') : 'twilio',
        'providerLabel' => (string) ($c['providerLabel'] ?? ''),
        'providerBase' => (string) ($c['providerBase'] ?? ''),
        'providerCallPath' => (string) ($c['providerCallPath'] ?? ''),
        'providerSmsPath' => (string) ($c['providerSmsPath'] ?? ''),
        'providerFrom' => (string) ($c['providerFrom'] ?? ''),
        'hasProviderKey' => ($c['providerKey'] ?? '') !== '',
        // v77: VitelGlobal uses account credentials and fixed, documented billing.vitelglobal.com endpoints.
        // The password is sealed exactly like the Twilio/Auth and generic-provider secrets.
        'vitelUsername' => (string) ($c['vitelUsername'] ?? ''),
        'vitelDomain' => (string) ($c['vitelDomain'] ?? 'billing'),
        'vitelExtension' => (string) ($c['vitelExtension'] ?? ''),
        'vitelLine' => (string) ($c['vitelLine'] ?? 'All'),
        'hasVitelPassword' => ($c['vitelPassword'] ?? '') !== '',
        'sid' => (string) ($c['sid'] ?? ''),
        'keySid' => (string) ($c['keySid'] ?? ''),
        'app' => (string) ($c['app'] ?? ''),
        'appUrl' => (string) ($c['appUrl'] ?? ''),
        'ok' => !empty($c['ok']),
        'okAt' => (int) ($c['okAt'] ?? 0),
        'acct' => (string) ($c['acct'] ?? ''),
        'hasSecret' => ($c['keySecret'] ?? '') !== '',
        'hasToken' => ($c['token'] ?? '') !== '',
        'numbers' => array_values(array_filter((array) ($c['numbers'] ?? []), 'is_array')),
        'recOut' => !empty($c['recOut']),
        'notice' => (string) ($c['notice'] ?? 'This call may be recorded.'),
        'keepDays' => max(0, min(3650, (int) ($c['keepDays'] ?? 90))),
        'tx' => !empty($c['tx']),
        'sum' => !isset($c['sum']) || !empty($c['sum']),
        'lang' => (string) ($c['lang'] ?? 'auto'), // v68: 'auto' = any language, detected as people speak
        'e911' => ($c['e911'] ?? '') === 'allow' ? 'allow' : 'block',
        'dest' => array_values(array_intersect((array) ($c['dest'] ?? ['nanp']), ['nanp', 'in', 'other'])),
        'cc' => (string) ($c['cc'] ?? ''),
        'region' => ($c['region'] ?? '') === 'IN' ? 'IN' : 'US',
        'perHour' => max(5, min(1000, (int) ($c['perHour'] ?? 120))),
        'smsPerHour' => max(5, min(2000, (int) ($c['smsPerHour'] ?? 200))),
        'vmMail' => !isset($c['vmMail']) || !empty($c['vmMail']),
        'at' => (int) ($c['at'] ?? 0),
        'by' => (string) ($c['by'] ?? ''),
        // v82: true when this workspace is running on StratEdge's central phone setup rather than its own
        'central' => ($GLOBALS['PH_CFG_MAINKEY'] ?? null) !== null,
    ];
    if (!$out['dest']) {
        $out['dest'] = ['nanp'];
    }
    if ($secrets) {
        require_once __DIR__ . '/mail.php';
        // v82: an inherited configuration was sealed with StratEdge's key, not this workspace's
        $mk = $GLOBALS['PH_CFG_MAINKEY'] ?? null;
        $un = $mk ? fn(string $x): string => mailUnsealWith($x, $mk) : fn(string $x): string => mailUnseal($x);
        $out['keySecret'] = ($c['keySecret'] ?? '') !== '' ? $un((string) $c['keySecret']) : '';
        $out['token'] = ($c['token'] ?? '') !== '' ? $un((string) $c['token']) : '';
        $out['providerKey'] = ($c['providerKey'] ?? '') !== '' ? $un((string) $c['providerKey']) : '';
        $out['vitelPassword'] = ($c['vitelPassword'] ?? '') !== '' ? $un((string) $c['vitelPassword']) : '';
    }
    return $out;
}
function phCfgSet(array $patch, array $u): void
{
    $c = phCfgRaw(true); // save to this request's own store, never the inherited central one
    foreach ($patch as $k => $v) {
        $c[$k] = $v;
    }
    $c['at'] = now();
    $c['by'] = (string) ($u['name'] ?? '');
    docSet(PH_CFG, json_decode(json_encode($c, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)));
}
/** Connected and ready for calls (a TwiML App, the secrets, one number at least). */
function phReady(): bool
{
    $c = phCfg();
    if ($c['provider'] === 'vitel') {
        return $c['vitelUsername'] !== '' && $c['hasVitelPassword'] && $c['vitelExtension'] !== '' && $c['providerFrom'] !== '';
    }
    if ($c['provider'] === 'custom') {
        return $c['providerBase'] !== '' && $c['hasProviderKey'] && $c['providerFrom'] !== '' && ($c['providerCallPath'] !== '' || $c['providerSmsPath'] !== '');
    }
    return $c['ok'] && $c['app'] !== '' && $c['hasSecret'] && $c['hasToken'] && (bool) array_filter($c['numbers'], fn($n) => !empty($n['on']));
}
/** v39.1/v77: the setup step still missing before calls can be made: '' when ready. */
function phWhyNot(): string
{
    $c = phCfg();
    if ($c['provider'] === 'vitel') {
        if ($c['vitelUsername'] === '' || !$c['hasVitelPassword']) return 'account';
        return ($c['vitelExtension'] !== '' && $c['providerFrom'] !== '') ? '' : 'number';
    }
    if ($c['provider'] === 'custom') {
        if ($c['providerBase'] === '' || !$c['hasProviderKey']) return 'account';
        if ($c['providerFrom'] === '' || ($c['providerCallPath'] === '' && $c['providerSmsPath'] === '')) return 'number';
        return '';
    }
    if (!$c['ok'] || $c['app'] === '') {
        return 'account';
    }
    if (!$c['hasSecret'] || !$c['hasToken']) {
        return 'keys';
    }
    return array_filter($c['numbers'], fn($n) => !empty($n['on'])) ? '' : 'number';
}
/** May this person use the phone? (An administrator switched it on for them; the workspace has the part.) */
function phMay(?array $u): bool
{
    if (!$u || (function_exists('wsFeatureOn') && !wsFeatureOn('phone'))) {
        return false;
    }
    return phEligible((string) $u['id']) && grantOf($u['id'], 'phone');
}
/** The company phone is for the company's own people: not client contacts, outside students or outside bookkeepers. */
function phEligible(string $uid): bool
{
    $r = myR($uid);
    return !in_array((string) ($r->role ?? ''), ['employer', 'student', 'ext'], true);
}
function phUser(): array
{
    $u = requireUser();
    if (!phMay($u)) {
        fail(403, 'forbidden', 'The phone is not switched on for you. An administrator can switch it on under Roles & access.');
    }
    return $u;
}
function phAdmin(): array
{
    $u = requireUser();
    if (!hasRole($u, 'admin')) {
        fail(403, 'forbidden', 'Only an administrator can set up the phone.');
    }
    return $u;
}
/** The portal's public address that Twilio calls back (the workspace's main address in a workspace). */
function phBase(): string
{
    $b = rtrim((string) (getenv('SE_PHONE_BASE') ?: siteUrl()), '/') . '/';
    return $b;
}
function phHook(string $r, array $q = []): string
{
    return phBase() . 'api/index.php?r=' . $r . ($q ? '&' . http_build_query($q) : '');
}
/** What the person's browser needs: whether the phone is on, the numbers they may call from, the rules. */
function phPublic(?array $u): ?array
{
    $mine = phMay($u);
    // v39.1: an administrator sees the Phone button before having the phone: what is left to set up, "Give me the phone"
    if (!$mine && !($u && hasRole($u, 'admin') && (!function_exists('wsFeatureOn') || wsFeatureOn('phone')) && phEligible((string) $u['id']))) {
        return null;
    }
    $c = phCfg();
    $me = docGet('ph/x/me/' . $u['id']);
    $nums = [];
    if ($c['provider'] !== 'twilio' && $c['providerFrom'] !== '') {
        $sms = $c['provider'] === 'vitel' ? $c['hasVitelPassword'] : $c['providerSmsPath'] !== '';
        $nums[] = ['n' => $c['providerFrom'], 'l' => $c['providerLabel'] ?: ($c['provider'] === 'vitel' ? 'VitelGlobal' : 'Phone provider'), 'sms' => $sms, 'own' => false];
    }
    foreach ($c['provider'] === 'twilio' ? $c['numbers'] : [] as $n) {
        // v39.2: someone else's personal line is not offered
        if (phUsable($n, (string) $u['id'])) {
            $nums[] = ['n' => (string) $n['n'], 'l' => (string) ($n['label'] ?? ''), 'sms' => !empty($n['sms']), 'own' => phOwner($n) !== ''];
        }
    }
    $why = phWhyNot();
    if ($why === '' && $mine && !$nums) {
        $why = 'nonum'; // every number switched on is someone else's personal line
    }
    $from = $mine ? phFromFor($c, (string) $u['id']) : null;
    return [
        'on' => $mine && $why === '',
        // v39.1: false for an administrator who has not got the phone yet (the button shows the steps, nothing else)
        'mine' => $mine,
        // v39.1: what is still missing, so the Phone panel can say it (account | keys | number)
        'why' => $why,
        'nums' => $mine ? $nums : [],
        'cid' => $from ? (string) $from['n'] : '',
        'avail' => !isset($me->avail) || !empty($me->avail),
        'e911' => $c['e911'],
        'region' => $c['region'],
        'recOut' => $c['recOut'],
        'provider' => $c['provider'],
        'providerLabel' => $c['providerLabel'] ?: ($c['provider'] === 'vitel' ? 'VitelGlobal' : ucfirst($c['provider'])),
        'admin' => hasRole($u, 'admin'),
        'tx' => (bool) $c['tx'], // v68: the dialer offers a language for the transcript when transcripts are on
        'lang' => (string) $c['lang'],
    ];
}

/* ---------------------------------------------------------------- phone numbers */

/** A phone number as +<country><number> (E.164), from the ways people write them; '' when it is not one. */
function phE164(string $raw, string $region = 'US'): string
{
    $s = trim($raw);
    if ($s === '') {
        return '';
    }
    $s = (string) preg_replace('/\s*(?:x|ext\.?|extension|#)\s*\d+$/i', '', $s);
    $plus = str_starts_with(ltrim($s), '+');
    $d = (string) preg_replace('/\D+/', '', $s);
    if (!$plus && str_starts_with($d, '00')) {
        $d = substr($d, 2);
        $plus = true;
    }
    if ($plus) {
        return strlen($d) >= 8 && strlen($d) <= 15 ? '+' . $d : '';
    }
    if ($region === 'IN') {
        if (strlen($d) === 11 && $d[0] === '0') {
            $d = substr($d, 1);
        }
        if (strlen($d) === 10 && preg_match('/^[6-9]/', $d)) {
            return '+91' . $d;
        }
        if (strlen($d) === 12 && str_starts_with($d, '91')) {
            return '+' . $d;
        }
    }
    if (strlen($d) === 10 && preg_match('/^[2-9]\d{2}[2-9]/', $d)) {
        return '+1' . $d;
    }
    if (strlen($d) === 11 && $d[0] === '1') {
        return '+' . $d;
    }
    if (strlen($d) === 12 && str_starts_with($d, '91')) {
        return '+' . $d;
    }
    return '';
}
/** The last 10 digits: how a call is matched with the phone numbers on records (written in any format). */
function phOd(string $n): string
{
    $d = (string) preg_replace('/\D+/', '', $n);
    return strlen($d) >= 7 ? substr($d, -10) : '';
}
function phIsEmergency(string $raw): bool
{
    $d = (string) preg_replace('/\D+/', '', $raw);
    return in_array($d, PH_EMERGENCY, true) || in_array(ltrim($d, '1'), ['911', '933'], true);
}
/** May the portal call this number? '' when yes, otherwise why not. */
function phDestOk(string $e164, array $c): string
{
    if (!preg_match('/^\+\d{8,15}$/', $e164)) {
        return 'That is not a phone number the portal can call. Write it with the country code, e.g. +1 555 201 3344.';
    }
    $d = substr($e164, 1);
    if (str_starts_with($d, '1')) {
        $area = substr($d, 1, 3);
        if (in_array($area, PH_NANP_BLOCK, true)) {
            return 'Numbers starting with ' . $area . ' cost the caller extra, so the portal does not call them.';
        }
        if (in_array($area, PH_NANP_ABROAD, true)) {
            return in_array('other', $c['dest'], true) && in_array('1' . $area, phCcList($c), true) ? '' : 'The ' . $area . ' area code is outside the US and Canada (a Caribbean country). An administrator can allow it under Phone setup.';
        }
        return in_array('nanp', $c['dest'], true) ? '' : 'Calls to the US and Canada are not allowed. An administrator can allow them under Phone setup.';
    }
    if (str_starts_with($d, '91')) {
        return in_array('in', $c['dest'], true) ? '' : 'Calls to India are not allowed. An administrator can allow them under Phone setup.';
    }
    if (in_array('other', $c['dest'], true)) {
        foreach (phCcList($c) as $cc) {
            if (str_starts_with($d, $cc)) {
                return '';
            }
        }
    }
    return 'Calls to that country are not allowed. An administrator can add its country code under Phone setup.';
}
function phCcList(array $c): array
{
    return array_values(array_filter(array_map(fn($x) => (string) preg_replace('/\D+/', '', $x), preg_split('/[\s,;]+/', (string) $c['cc']) ?: []), fn($x) => $x !== '' && strlen($x) <= 4));
}
/** The company number entry (or null). */
function phNumber(array $c, string $e164): ?array
{
    foreach ($c['numbers'] as $n) {
        if ((string) ($n['n'] ?? '') === $e164) {
            return $n;
        }
    }
    return null;
}

/* ---------------------------------------------------------------- Twilio */

function phTwBase(string $which = 'api'): string
{
    $over = getenv('SE_TWILIO_BASE');
    if ($over) {
        return rtrim($over, '/') . '/' . $which;
    }
    // v39.1: Monitor (Twilio's error log) too
    return ['voice' => 'https://voice.twilio.com', 'monitor' => 'https://monitor.twilio.com'][$which] ?? 'https://api.twilio.com';
}
/**
 * One Twilio REST request with the API key (form-encoded, as Twilio wants). Returns [status, decoded JSON or raw].
 * $path is relative to /2010-04-01/Accounts/{sid}/ unless it starts with "/".
 */
function phApi(string $method, string $path, array $params = [], ?array $c = null, int $timeout = 20, string $which = 'api'): array
{
    $c = $c ?? phCfg(true);
    if ($c['sid'] === '' || $c['keySid'] === '' || ($c['keySecret'] ?? '') === '') {
        return [0, ['message' => 'The phone is not connected.']];
    }
    $url = phTwBase($which) . (str_starts_with($path, '/') ? $path : '/2010-04-01/Accounts/' . rawurlencode($c['sid']) . '/' . $path);
    if ($method === 'GET' && $params) {
        $url .= (str_contains($url, '?') ? '&' : '?') . http_build_query($params);
    }
    $ch = curl_init($url);
    $opt = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_USERPWD => $c['keySid'] . ':' . $c['keySecret'],
        CURLOPT_HTTPHEADER => ['Accept: application/json', 'User-Agent: StratEdge-portal/1.0'],
        CURLOPT_CUSTOMREQUEST => $method,
    ];
    if ($method === 'POST') {
        $opt[CURLOPT_POSTFIELDS] = http_build_query($params);
    }
    curl_setopt_array($ch, $opt);
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($raw === false) {
        return [0, ['message' => 'Twilio could not be reached: ' . $err]];
    }
    $j = json_decode((string) $raw, true);
    return [$code, is_array($j) ? $j : (string) $raw];
}
function phApiErr(array $r): string
{
    [$code, $j] = $r;
    $m = is_array($j) ? (string) ($j['message'] ?? '') : '';
    if ($code === 401 || $code === 403) {
        return 'Twilio did not accept the keys (' . ($m !== '' ? $m : 'not authorized') . '). Check the Account SID and the API key.';
    }
    return 'Twilio answered ' . $code . ($m !== '' ? ': ' . $m : '') . '.';
}
/** The Access Token the browser uses (a JWT signed here; Twilio's "twilio-fpa" format). */
function phToken(array $c, string $identity, int $ttl = 3600): string
{
    $now = time();
    $b64 = fn(string $x): string => rtrim(strtr(base64_encode($x), '+/', '-_'), '=');
    $head = ['typ' => 'JWT', 'alg' => 'HS256', 'cty' => 'twilio-fpa;v=1'];
    $body = [
        'jti' => $c['keySid'] . '-' . $now . '-' . bin2hex(random_bytes(3)),
        'iss' => $c['keySid'],
        'sub' => $c['sid'],
        'iat' => $now,
        'nbf' => $now,
        'exp' => $now + $ttl,
        'grants' => ['identity' => $identity, 'voice' => ['incoming' => ['allow' => true], 'outgoing' => ['application_sid' => $c['app']]]],
    ];
    $in = $b64((string) json_encode($head, JSON_UNESCAPED_SLASHES)) . '.' . $b64((string) json_encode($body, JSON_UNESCAPED_SLASHES));
    return $in . '.' . $b64(hash_hmac('sha256', $in, (string) $c['keySecret'], true));
}
/** The browser's identity on Twilio: the person's id (letters, digits and underscores). */
function phIdent(string $uid): string
{
    return (string) preg_replace('/[^A-Za-z0-9_]/', '_', $uid);
}
/** v83: the browser's identity on Twilio. In a company workspace running on StratEdge's central Twilio app it carries
 *  the workspace's name (hex), so StratEdge's phw_out can hand the call to the workspace. */
function phClientId(string $uid): string
{
    $s = function_exists('wsSlug') ? wsSlug() : '';
    return $s !== '' && phCfg()['central'] ? 'ws_' . bin2hex($s) . '__' . phIdent($uid) : phIdent($uid);
}
/** The person behind a Twilio "client:" address ('' for a phone number, or another workspace's browser). */
function phUidOf(string $from): string
{
    if (!str_starts_with($from, 'client:')) {
        return '';
    }
    $id = substr($from, 7);
    if (preg_match('/^ws_([0-9a-f]{2,60})__(.+)$/', $id, $m)) {
        // v83: a workspace browser on the central app: only that workspace's own site knows the person
        $s = function_exists('wsSlug') ? wsSlug() : '';
        return $s !== '' && hex2bin($m[1]) === $s ? $m[2] : '';
    }
    return $id;
}
/** The form fields Twilio posted, exactly as sent (PHP's own parsing changes some names). */
function phParams(): array
{
    static $p = null;
    if ($p !== null) {
        return $p;
    }
    $p = [];
    $raw = (string) file_get_contents('php://input');
    if ($raw === '' && $_POST) {
        $p = $_POST;
        return $p;
    }
    foreach (explode('&', $raw) as $pair) {
        if ($pair === '') {
            continue;
        }
        [$k, $v] = array_pad(explode('=', $pair, 2), 2, '');
        $p[urldecode($k)] = urldecode($v);
    }
    return $p;
}
/**
 * Was this request sent by Twilio for this workspace's account? X-Twilio-Signature = base64(HMAC-SHA1(Auth Token,
 * the URL called + each POST field name and value in name order)). The URL is tried as received and as the portal
 * gave it to Twilio (a proxy in front of the host can change the scheme or the port).
 */
function phSigOk(string $token): bool
{
    $sig = (string) ($_SERVER['HTTP_X_TWILIO_SIGNATURE'] ?? '');
    if ($sig === '' || $token === '') {
        return false;
    }
    $p = phParams();
    ksort($p, SORT_STRING);
    $data = '';
    foreach ($p as $k => $v) {
        $data .= $k . (is_array($v) ? implode('', $v) : $v);
    }
    $host = (string) ($_SERVER['HTTP_HOST'] ?? '');
    $uri = (string) ($_SERVER['REQUEST_URI'] ?? '');
    $urls = [];
    foreach (['https', 'http'] as $s) {
        $urls[] = $s . '://' . $host . $uri;
        $urls[] = $s . '://' . preg_replace('/:\d+$/', '', $host) . $uri;
    }
    $q = (string) ($_SERVER['QUERY_STRING'] ?? '');
    $urls[] = phBase() . 'api/index.php' . ($q !== '' ? '?' . $q : '');
    foreach (array_unique($urls) as $url) {
        if (hash_equals(base64_encode(hash_hmac('sha1', $url . $data, $token, true)), $sig)) {
            return true;
        }
    }
    return false;
}
function phXml(string $body): never
{
    // v39.1: only the call instructions (nothing printed before them may spoil the XML Twilio reads)
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    header('Content-Type: text/xml; charset=utf-8');
    echo '<?xml version="1.0" encoding="UTF-8"?><Response>' . $body . '</Response>';
    exit();
}
function phX(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES | ENT_XML1, 'UTF-8');
}
function phSay(string $text): string
{
    return $text === '' ? '' : '<Say>' . phX($text) . '</Say>';
}
/** v68: a transcription language as Twilio takes it: 'auto' (any language, detected as people speak: Deepgram's
 *  multi-language Nova-3 model) or a BCP-47 code (en-US, hi-IN, pa-Guru-IN, cmn-Hans-CN). */
function phLangOk(string $s): bool
{
    return $s === 'auto' || preg_match('/^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$/', $s) === 1;
}
/** v68: the language of a transcribed part, from Twilio's status callback: the provider's data when the language was
 *  detected (Deepgram: "languages" or "language" per utterance), else the LanguageCode asked for ('' for "multi" with
 *  nothing detected). */
function phTxLang(array $p): string
{
    $pd = json_decode((string) ($p['TranscriptionProviderData'] ?? ''), true);
    $found = '';
    $walk = function ($node, int $depth) use (&$walk, &$found): void {
        if ($found !== '' || $depth > 6 || !is_array($node)) {
            return;
        }
        foreach ($node as $k => $v) {
            if ($k === 'languages' && is_array($v) && isset($v[0]) && is_string($v[0])) {
                $found = $v[0];
                return;
            }
            if ($k === 'language' && is_string($v) && $v !== '' && $v !== 'multi') {
                $found = $v;
                return;
            }
            if (is_array($v)) {
                $walk($v, $depth + 1);
            }
        }
    };
    $walk(is_array($pd) ? $pd : [], 0);
    if ($found === '') {
        $lc = (string) ($p['LanguageCode'] ?? '');
        $found = $lc !== 'multi' ? $lc : '';
    }
    return preg_match('/^[a-z]{2,3}(-[A-Za-z]{2,4})?(-[A-Za-z]{2,4})?$/', $found) ? mb_substr($found, 0, 16) : '';
}
/** The transcription attributes for a language: auto-detection asks Twilio for Deepgram's multi-language model and the provider's data (the language of each part). */
function phLangAttrs(string $code): string
{
    if ($code === 'auto' || $code === '' || $code === 'multi') {
        return ' transcriptionEngine="deepgram" speechModel="nova-3" languageCode="multi" enableProviderData="true"';
    }
    return ' languageCode="' . phX($code) . '"';
}
/** Live transcription of a call (both sides, or the caller only for a voicemail), reported to phw_tx. v68: in the
 *  language asked for (the number's, or the one chosen for this call), else the account's. */
function phTranscribe(array $c, string $callId, string $inLabel, string $outLabel, string $track = 'both_tracks', string $name = 'se', string $lang = ''): string
{
    $code = $lang !== '' && phLangOk($lang) ? $lang : (string) $c['lang'];
    return '<Start><Transcription name="' . phX($name) . '" statusCallbackUrl="' . phX(phHook('phw_tx', ['c' => $callId])) . '" track="' . $track . '" inboundTrackLabel="' . phX($inLabel) . '" outboundTrackLabel="' . phX($outLabel) . '" partialResults="false"' . phLangAttrs($code) . '/></Start>';
}

/* ---------------------------------------------------------------- calls, texts and records */

function phNewId(): string
{
    return 'c' . rid(8);
}
function phCallBy(string $field, string $v): ?array
{
    $s = phDb()->prepare('SELECT * FROM ph_calls WHERE ' . ($field === 'sid' ? 'sid' : 'id') . ' = ? ORDER BY at DESC LIMIT 1');
    $s->execute([$v]);
    $r = $s->fetch();
    return $r ?: null;
}
function phCallSet(string $id, array $f): void
{
    if (!$f) {
        return;
    }
    $set = implode(', ', array_map(fn($k) => $k . ' = ?', array_keys($f)));
    phDb()->prepare("UPDATE ph_calls SET $set WHERE id = ?")->execute([...array_values($f), $id]);
}
function phCallAdd(array $f): string
{
    $id = phNewId();
    $row = array_merge(['id' => $id, 'sid' => '', 'at' => now(), 'dir' => 'out', 'num' => '', 'other' => '', 'od' => '', 'uid' => '', 'st' => 'ringing', 'secs' => 0, 'rec' => '', 'rsecs' => 0, 'vm' => 0, 'ref' => '', 'tx' => '', 'sum' => '', 'note' => '', 'data' => '{}'], $f);
    $cols = array_keys($row);
    phDb()->prepare('INSERT INTO ph_calls (' . implode(', ', $cols) . ') VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ')')->execute(array_values($row));
    return $id;
}
/** v39.2: may this person call (or text) from this company number? Switched on, and a personal line only for its person. */
function phUsable(?array $n, string $uid, bool $sms = false): bool
{
    return $n !== null && !empty($n['on']) && (!$sms || !empty($n['sms'])) && ((string) ($n['own'] ?? '') === '' || (string) $n['own'] === $uid);
}
/** v39.2: whose personal line a number is ('' for a shared number). */
function phOwner(?array $n): string
{
    return $n ? (string) ($n['own'] ?? '') : '';
}
/** v39.2: the number a person calls (or texts) from: the one asked for, their own choice, their personal line, a shared one. */
function phFromFor(array $c, string $uid, string $want = '', bool $sms = false): ?array
{
    if (($c['provider'] ?? 'twilio') !== 'twilio') {
        $canSms = ($c['provider'] ?? '') === 'vitel' ? !empty($c['hasVitelPassword']) : (($c['providerSmsPath'] ?? '') !== '');
        if (($c['providerFrom'] ?? '') === '' || ($sms && !$canSms)) return null;
        return ['n' => (string) $c['providerFrom'], 'label' => (string) ($c['providerLabel'] ?? ''), 'on' => true, 'sms' => $canSms, 'own' => ''];
    }
    $n = $want !== '' ? phNumber($c, $want) : null;
    if (phUsable($n, $uid, $sms)) {
        return $n;
    }
    $me = docGet('ph/x/me/' . $uid);
    $n = phNumber($c, (string) ($me->cid ?? ''));
    if (phUsable($n, $uid, $sms)) {
        return $n;
    }
    foreach ($c['numbers'] as $x) {
        if (phUsable($x, $uid, $sms) && phOwner($x) === $uid) {
            return $x;
        }
    }
    foreach ($c['numbers'] as $x) {
        if (phUsable($x, $uid, $sms)) {
            return $x;
        }
    }
    return null;
}
function phCallData(array $row): array
{
    $d = json_decode((string) ($row['data'] ?? '{}'), true);
    return is_array($d) ? $d : [];
}
/** People a company number rings: everyone with the phone, or the ones chosen for it (by default only those taking calls). */
function phRingList(array $num, bool $availOnly = true): array
{
    $want = array_map('strval', (array) ($num['ring'] ?? []));
    $out = [];
    $st = db()->prepare('SELECT status FROM users WHERE id = ?');
    foreach (colAll('r') as [$uid, $r]) {
        $uid = (string) $uid;
        if (!(($r->ft ?? null) instanceof stdClass) || empty($r->ft->phone)) {
            continue;
        }
        if ($want && !in_array($uid, $want, true)) {
            continue;
        }
        $st->execute([$uid]);
        if ($st->fetchColumn() !== 'active') {
            continue;
        }
        if ($availOnly) {
            $me = docGet('ph/x/me/' . $uid);
            if (isset($me->avail) && empty($me->avail)) {
                continue;
            }
        }
        $out[] = $uid;
    }
    return array_slice($out, 0, 10); // Twilio rings up to 10 browsers at once
}
/**
 * Who a phone number belongs to, from the records people can read: ATS candidates, consultants, vendor contacts,
 * CRM contacts and leads, requirement contacts, email contacts. Kept in ph_dir by the last 10 digits, rebuilt when
 * older than 10 minutes (records store numbers in any format, so they are read once rather than searched).
 */
function phDirectory(bool $force = false): void
{
    $at = (int) (secKv('ph_dir_at')['at'] ?? 0);
    if (!$force && $at > now() - 600000) {
        return;
    }
    $rows = [];
    $add = function (string $phone, string $kind, string $rid, string $name, string $sub) use (&$rows) {
        foreach (preg_split('/[,;\/]|\bor\b/i', $phone) ?: [] as $one) {
            $od = phOd($one);
            if ($od !== '' && strlen($od) === 10 && trim($name) !== '') {
                $rows[] = [$od, $kind, $rid, mb_substr(trim($name), 0, 190), mb_substr(trim($sub), 0, 190)];
            }
        }
    };
    foreach (colAll('ats') as [$id, $d]) {
        $add((string) ($d->ph ?? ''), 'ats', (string) $id, (string) ($d->n ?? ''), 'Candidate' . (!empty($d->jt) ? ' · ' . $d->jt : ''));
    }
    foreach (colAll('rec/cand/items') as [$id, $d]) {
        $add((string) ($d->ph ?? ''), 'cons', (string) $id, (string) ($d->n ?? ''), 'Consultant' . (!empty($d->ti) ? ' · ' . $d->ti : ''));
    }
    foreach (colAll('vms/vendor/items') as [$id, $d]) {
        foreach ((array) ($d->contacts ?? []) as $k => $ct) {
            $ct = (array) $ct;
            $add((string) ($ct['ph'] ?? ''), 'vendor', (string) $id, (string) ($ct['n'] ?? ''), (string) ($d->n ?? 'Vendor'));
        }
    }
    $accs = [];
    foreach (colAll('crm/main/acc') as [$id, $a]) {
        $accs[(string) $id] = (string) ($a->n ?? '');
    }
    foreach (colAll('crm/main/con') as [$id, $d]) {
        $add((string) ($d->ph ?? ''), 'crm', (string) $id, (string) ($d->n ?? ''), 'Contact' . (($accs[(string) ($d->acc ?? '')] ?? '') !== '' ? ' · ' . $accs[(string) $d->acc] : ''));
    }
    foreach (colAll('crm/main/lead') as [$id, $d]) {
        $add((string) ($d->ph ?? ''), 'lead', (string) $id, (string) ($d->n ?? ''), 'Lead' . (!empty($d->co) ? ' · ' . $d->co : ''));
    }
    foreach (colAll('vms/req/items') as [$id, $d]) {
        $add((string) ($d->cp ?? ''), 'req', (string) $id, (string) ($d->cn ?? ''), 'Requirement contact · ' . (string) ($d->ti ?? ''));
    }
    try {
        require_once __DIR__ . '/mail.php';
        foreach (mdb()->query("SELECT id, name, email, phone, company FROM mail_contacts WHERE phone <> ''") as $m) {
            $add((string) $m['phone'], 'mail', (string) $m['id'], (string) ($m['name'] !== '' ? $m['name'] : $m['email']), 'Email contact' . ($m['company'] !== '' ? ' · ' . $m['company'] : ''));
        }
    } catch (Throwable $e) {
        // no email contacts table yet
    }
    dbBatch(function () use ($rows) {
        $p = phDb();
        $p->exec('DELETE FROM ph_dir');
        $ins = $p->prepare('INSERT INTO ph_dir (od, kind, rid, name, sub) VALUES (?,?,?,?,?)');
        foreach ($rows as $r) {
            $ins->execute($r);
        }
    });
    secKvSet('ph_dir_at', ['at' => now()]);
}
/** The kinds of records this person may read (names are shown only from those). */
function phKindsFor(array $u): array
{
    $k = [];
    foreach (['ats' => 'ats/x', 'cons' => 'rec/cand/items/x', 'vendor' => 'vms/vendor/items/x', 'crm' => 'crm/main/con/x', 'lead' => 'crm/main/lead/x', 'req' => 'vms/req/items/x'] as $kind => $path) {
        if (can($path, 'r')) {
            $k[] = $kind;
        }
    }
    if (mailCanUse($u)) {
        $k[] = 'mail';
    }
    return $k;
}
/** Names for a set of numbers (by their last 10 digits): od => [[kind, id, name, sub], ...]. */
function phNames(array $ods, array $u): array
{
    $ods = array_values(array_unique(array_filter($ods, fn($x) => strlen((string) $x) === 10)));
    if (!$ods) {
        return [];
    }
    phDirectory();
    $kinds = phKindsFor($u);
    if (!$kinds) {
        return [];
    }
    $out = [];
    foreach (array_chunk($ods, 300) as $part) {
        $s = phDb()->prepare('SELECT od, kind, rid, name, sub FROM ph_dir WHERE od IN (' . implode(',', array_fill(0, count($part), '?')) . ')');
        $s->execute($part);
        foreach ($s->fetchAll() as $r) {
            if (in_array($r['kind'], $kinds, true) && count($out[$r['od']] ?? []) < 4) {
                $out[$r['od']][] = [$r['kind'], $r['rid'], $r['name'], $r['sub']];
            }
        }
    }
    return $out;
}
/** Team members' names by id. */
function phPeopleNames(array $uids): array
{
    $uids = array_values(array_unique(array_filter($uids)));
    if (!$uids) {
        return [];
    }
    $s = db()->prepare('SELECT id, name FROM users WHERE id IN (' . implode(',', array_fill(0, count($uids), '?')) . ')');
    $s->execute($uids);
    $out = [];
    foreach ($s->fetchAll() as $r) {
        $out[$r['id']] = (string) $r['name'];
    }
    return $out;
}
/** A call as the screens show it. */
function phCallView(array $r, array $names, array $people, bool $full = false): array
{
    $d = phCallData($r);
    $v = [
        'id' => (string) $r['id'], 'at' => (int) $r['at'], 'dir' => (string) $r['dir'], 'num' => (string) $r['num'], 'other' => (string) $r['other'], 'od' => (string) $r['od'],
        'uid' => (string) $r['uid'], 'who' => $people[(string) $r['uid']] ?? '', 'st' => (string) $r['st'], 'secs' => (int) $r['secs'],
        'rec' => (string) $r['rec'] !== '' && empty($d['recGone']), 'rsecs' => (int) $r['rsecs'], 'vm' => (int) $r['vm'] === 1, 'ref' => (string) $r['ref'],
        'names' => $names[(string) $r['od']] ?? [], 'hasTx' => (string) $r['tx'] !== '', 'hasSum' => (string) $r['sum'] !== '', 'note' => mb_substr((string) $r['note'], 0, $full ? 4000 : 140),
        'em' => !empty($d['em']),
    ];
    if ($full) {
        $tx = json_decode((string) $r['tx'], true);
        $v['tx'] = is_array($tx) ? $tx : [];
        $sum = json_decode((string) $r['sum'], true);
        $v['sum'] = is_array($sum) ? $sum : null;
        $v['sumDue'] = !empty($d['sumDue']);
    }
    return $v;
}
/** May this person see this call (and play its recording)? Their own, the numbers that ring for them, or an administrator. */
function phCanSee(array $u, array $row): bool
{
    if (hasRole($u, 'admin') || (string) $row['uid'] === $u['id']) {
        return true;
    }
    if ((string) $row['dir'] === 'in') {
        $n = phNumber(phCfg(), (string) $row['num']);
        $ring = (array) ($n['ring'] ?? []);
        return $n !== null && (!$ring || in_array($u['id'], $ring, true));
    }
    return false;
}
/** The calls a person may see: SQL condition and its values. */
function phScope(array $u, bool $all): array
{
    if ($all && hasRole($u, 'admin')) {
        return ['1 = 1', []];
    }
    $mine = [];
    foreach (phCfg()['numbers'] as $n) {
        $ring = (array) ($n['ring'] ?? []);
        if (!$ring || in_array($u['id'], $ring, true)) {
            $mine[] = (string) $n['n'];
        }
    }
    if (!$mine) {
        return ['uid = ?', [$u['id']]];
    }
    return ['(uid = ? OR (dir = \'in\' AND num IN (' . implode(',', array_fill(0, count($mine), '?')) . ')))', array_merge([$u['id']], $mine)];
}
/** The texts a person may read: the ones they sent, and the ones on the numbers that ring them. Administrators: every shared
 *  number; v39.2: someone else's personal line only with $all ("Everyone's texts", and on records). */
function phMsgScope(array $u, bool $all = false): array
{
    $admin = hasRole($u, 'admin');
    if ($admin && $all) {
        return ['1 = 1', []];
    }
    $mine = [];
    foreach (phCfg()['numbers'] as $n) {
        $ring = (array) ($n['ring'] ?? []);
        $own = phOwner($n);
        if ($own !== '' ? $own === (string) $u['id'] : (!$ring || in_array($u['id'], $ring, true) || $admin)) {
            $mine[] = (string) $n['n'];
        }
    }
    if (!$mine) {
        return ['uid = ?', [$u['id']]];
    }
    return ['(uid = ? OR num IN (' . implode(',', array_fill(0, count($mine), '?')) . '))', array_merge([$u['id']], $mine)];
}
/** The AI summary of a call from its transcript (or a voicemail): what was said, what to do next. */
function phSummarize(string $id): void
{
    $row = phCallBy('id', $id);
    if (!$row || (string) $row['tx'] === '') {
        return;
    }
    $d = phCallData($row);
    unset($d['sumDue']);
    $tx = json_decode((string) $row['tx'], true);
    $lines = [];
    foreach (is_array($tx) ? $tx : [] as $s) {
        $lines[] = ($s['w'] ?? '') . ': ' . ($s['s'] ?? '');
    }
    $text = mb_substr(implode("\n", $lines), 0, 24000);
    if (!aiReady() || trim($text) === '' || !phCfg()['sum']) {
        phCallSet($id, ['data' => json_encode($d)]);
        return;
    }
    $langNote = (string) ($d['lang'] ?? '') !== '' ? ' The transcript may be in ' . $d['lang'] . ' or another language: understand it and answer in English, naming the language spoken.' : ' The transcript may be in any language: understand it and answer in English, naming the language spoken if it is not English.';
    $sys = 'You summarize phone calls for a staffing company\'s recruiters and sales team.' . $langNote . ' Answer in JSON: {"summary": "2-4 sentences", "next": ["follow-up actions, each short"], "facts": {"rate": "", "availability": "", "location": "", "work authorization": "", "interview": ""}} using only what was said; leave a fact empty when it was not mentioned.';
    $j = aiJson($sys, ((int) $row['vm'] === 1 ? 'A voicemail left for the company:' : 'A call transcript (labels say who spoke):') . "\n" . $text, 700);
    if (is_array($j) && trim((string) ($j['summary'] ?? '')) !== '') {
        $facts = [];
        foreach ((array) ($j['facts'] ?? []) as $k => $v) {
            if (is_scalar($v) && trim((string) $v) !== '') {
                $facts[mb_substr((string) $k, 0, 40)] = mb_substr(trim((string) $v), 0, 200);
            }
        }
        $sum = ['s' => mb_substr(trim((string) $j['summary']), 0, 1500), 'next' => array_slice(array_values(array_filter(array_map(fn($x) => is_scalar($x) ? mb_substr(trim((string) $x), 0, 200) : '', (array) ($j['next'] ?? [])))), 0, 6), 'facts' => $facts, 'at' => now()];
        phCallSet($id, ['sum' => json_encode($sum, JSON_UNESCAPED_UNICODE), 'data' => json_encode($d)]);
    } else {
        phCallSet($id, ['data' => json_encode($d)]);
    }
}
/** Sends the response now and keeps working (LiteSpeed, PHP-FPM); elsewhere the work is done before answering. */
function phLater(callable $fn): void
{
    if (function_exists('litespeed_finish_request')) {
        litespeed_finish_request();
    } elseif (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    }
    try {
        $fn();
    } catch (Throwable $e) {
        @error_log(date('c') . ' phone: ' . $e->getMessage() . "\n", 3, storeDir() . '/error.log');
    }
}
/** Emails the people a number rings about a voicemail (the number only, no audio: they listen in the portal). */
function phMailVoicemail(array $num, array $row): void
{
    if (!phCfg()['vmMail']) {
        return;
    }
    $line = (string) ($num['label'] ?? '') !== '' ? $num['label'] . ' (' . $num['n'] . ')' : (string) $num['n'];
    $link = phBase() . '#/portal/calls?c=' . rawurlencode((string) $row['id']);
    $q = db()->prepare('SELECT email, name FROM users WHERE id = ?');
    foreach (phRingList($num, false) as $uid) {
        $q->execute([$uid]);
        $p = $q->fetch();
        if (!$p) {
            continue;
        }
        $subject = 'Voicemail from ' . $row['other'];
        $paras = ['Hi ' . explode(' ', (string) $p['name'])[0] . ',', 'A voicemail was left on ' . $line . ' by ' . $row['other'] . ((int) ($row['rsecs'] ?? 0) > 0 ? ' (' . (int) $row['rsecs'] . ' seconds)' : '') . '.', 'Listen to it, read what was said and call back in the portal.'];
        try {
            sendMail((string) $p['email'], (string) $p['name'], $subject, implode("\n\n", $paras) . "\n\n" . $link, emailHtml($subject, $paras, ['Open the voicemail', $link]));
        } catch (Throwable $e) {
            // the alert is a convenience: the voicemail is in the portal either way
        }
    }
}

/* ---------------------------------------------------------------- the scheduled job */

/** Recordings older than the kept days are deleted on Twilio; summaries left waiting are written. */
function phCron(): array
{
    $c = phCfg(true);
    $out = ['deleted' => 0, 'summaries' => 0];
    if (!$c['ok'] || $c['keepDays'] <= 0) {
        return $out;
    }
    $s = phDb()->prepare("SELECT id, rec, data FROM ph_calls WHERE rec <> '' AND at < ? AND data NOT LIKE '%\"recGone\":true%' LIMIT 100");
    $s->execute([now() - $c['keepDays'] * 86400000]);
    foreach ($s->fetchAll() as $r) {
        [$code] = phApi('DELETE', 'Recordings/' . rawurlencode((string) $r['rec']) . '.json', [], $c);
        if ($code === 204 || $code === 404) {
            $d = phCallData($r);
            $d['recGone'] = true;
            phCallSet((string) $r['id'], ['data' => json_encode($d)]);
            $out['deleted']++;
        }
    }
    $s = phDb()->query("SELECT id FROM ph_calls WHERE data LIKE '%\"sumDue\":true%' LIMIT 10");
    foreach ($s->fetchAll() as $r) {
        phSummarize((string) $r['id']);
        $out['summaries']++;
    }
    return $out;
}

/* ---------------------------------------------------------------- Twilio's requests (phw_*) */

/** Voicemail: the number's greeting, then up to 3 minutes after the tone (transcribed when transcripts are on). */
function phVoicemail(array $c, array $num, string $rowId, bool $transcribing): string
{
    $greet = trim((string) ($num['greet'] ?? '')) !== '' ? (string) $num['greet'] : 'Sorry we missed your call. Please leave your name, number and a short message after the tone.';
    $x = $c['tx'] && !$transcribing ? phTranscribe($c, $rowId, 'caller', 'staff', 'inbound_track', 'vm', (string) ($num['lang'] ?? '')) : '';
    return $x . phSay($greet) . '<Record maxLength="180" timeout="8" playBeep="true" finishOnKey="#" action="' . phX(phHook('phw_vm', ['c' => $rowId])) . '" recordingStatusCallback="' . phX(phHook('phw_rec', ['c' => $rowId, 'vm' => 1])) . '" recordingStatusCallbackEvent="completed"/>' . phSay('We did not get a message. Goodbye.') . '<Hangup/>';
}
function phHookRoute(string $r): never
{
    $c = phCfg(true);
    if (!$c['ok'] || !phSigOk($c['token'])) {
        // not from this account's Twilio: nothing is said or done
        // v39.1: one for this account whose signature did not match is noted (at most once a minute) for "Check the setup"
        $pp = phParams();
        if ($c['ok'] && ($_SERVER['HTTP_X_TWILIO_SIGNATURE'] ?? '') !== '' && (string) ($pp['AccountSid'] ?? '') === $c['sid'] && ($pp['Check'] ?? '') !== 'setup') {
            try {
                $f = secKv('ph_sigfail');
                if (!is_array($f) || (int) ($f['at'] ?? 0) < now() - 60000) {
                    secKvSet('ph_sigfail', ['at' => now(), 'r' => $r]);
                }
            } catch (Throwable $e) {
                // the note is a hint only
            }
        }
        http_response_code(403);
        header('Content-Type: text/plain');
        echo 'Forbidden';
        exit();
    }
    $p = phParams();
    $cid = preg_replace('/[^a-z0-9]/', '', (string) ($_GET['c'] ?? '')) ?? '';
    $row = $cid !== '' ? phCallBy('id', $cid) : null;
    switch ($r) {
        case 'phw_ping':
            // v39.1: "Check the setup" sends this, signed like Twilio's requests: empty call instructions
            phXml('');

        case 'phw_out':
            // a call made in the browser: who it is, where to, which company number shows
            $uid = phUidOf((string) ($p['From'] ?? ''));
            $u = null;
            if ($uid !== '') {
                $s = db()->prepare("SELECT * FROM users WHERE id = ? AND status = 'active'");
                $s->execute([$uid]);
                $u = $s->fetch() ?: null;
            }
            if (!$u || !grantOf($uid, 'phone') || !wsFeatureOn('phone')) {
                phXml(phSay('Calling from the portal is not switched on for you.') . '<Hangup/>');
            }
            $toRaw = (string) ($p['To'] ?? '');
            $base = ['sid' => (string) ($p['CallSid'] ?? ''), 'dir' => 'out', 'uid' => $uid, 'ref' => mb_substr((string) preg_replace('/[^A-Za-z0-9_:\-]/', '', (string) ($p['ref'] ?? '')), 0, 80)];
            if (phIsEmergency($toRaw) && $c['e911'] !== 'allow') {
                phCallAdd($base + ['other' => mb_substr($toRaw, 0, 32), 'od' => '', 'st' => 'blocked', 'data' => json_encode(['em' => true])]);
                phXml(phSay('This phone cannot call emergency services. Please hang up and dial from a mobile phone or a desk phone.') . '<Hangup/>');
            }
            $to = phE164($toRaw, $c['region']);
            $why = $to === '' ? 'That number could not be read.' : phDestOk($to, $c);
            if ($why !== '') {
                phCallAdd($base + ['other' => mb_substr($to !== '' ? $to : $toRaw, 0, 32), 'od' => phOd($to), 'st' => 'blocked', 'data' => json_encode(['why' => $why])]);
                phXml(phSay($why) . '<Hangup/>');
            }
            if (throttleHit('phout:' . $uid, $c['perHour'], 3600)) {
                phXml(phSay('You have made the most calls allowed in an hour. Try again later.') . '<Hangup/>');
            }
            // v39.2: the number asked for, the person's choice, their personal line or a shared one; never someone else's line
            $num = phFromFor($c, $uid, (string) ($p['cid'] ?? ''));
            if (!$num) {
                phXml(phSay('There is no company number for you to call from yet.') . '<Hangup/>');
            }
            $rec = $c['recOut'];
            // v68: the language chosen in the dialer for this call (else the account's)
            $lang = phLangOk((string) ($p['Lang'] ?? '')) ? (string) $p['Lang'] : '';
            $id = phCallAdd($base + ['num' => (string) $num['n'], 'other' => $to, 'od' => phOd($to), 'st' => 'ringing', 'data' => json_encode(['rec' => $rec] + ($lang !== '' ? ['lang' => $lang] : []))]);
            $x = $rec && $c['tx'] ? phTranscribe($c, $id, 'staff', 'other', 'both_tracks', 'se', $lang) : '';
            $x .= '<Dial callerId="' . phX((string) $num['n']) . '" answerOnBridge="true" timeLimit="14400" action="' . phX(phHook('phw_dial', ['c' => $id])) . '"'
                . ($rec ? ' record="record-from-answer-dual" recordingStatusCallback="' . phX(phHook('phw_rec', ['c' => $id])) . '" recordingStatusCallbackEvent="completed"' : '') . '>'
                . '<Number statusCallbackEvent="answered completed" statusCallback="' . phX(phHook('phw_leg', ['c' => $id])) . '"' . ($rec ? ' url="' . phX(phHook('phw_notice')) . '"' : '') . '>' . phX($to) . '</Number></Dial>';
            phXml($x);

        case 'phw_notice':
            // played to the person called, after they answer and before they are connected: recording needs consent
            phXml(phSay($c['notice']));

        case 'phw_in':
            // a call to a company number: the people it rings (in their browsers), else voicemail
            $to = (string) ($p['To'] ?? '');
            $num = phNumber($c, $to);
            if (!$num || empty($num['on'])) {
                phXml(phSay('This number is not taking calls.') . '<Hangup/>');
            }
            $from = (string) ($p['From'] ?? '');
            $rec = !empty($num['rec']);
            $id = phCallAdd(['sid' => (string) ($p['CallSid'] ?? ''), 'dir' => 'in', 'num' => $to, 'other' => mb_substr($from, 0, 32), 'od' => phOd($from), 'st' => 'ringing', 'data' => json_encode(['rec' => $rec, 'city' => mb_substr(trim((string) ($p['FromCity'] ?? '') . ', ' . (string) ($p['FromState'] ?? ''), ' ,'), 0, 80)])]);
            $x = $rec ? phSay($c['notice']) : '';
            $tx = $rec && $c['tx'];
            $x .= $tx ? phTranscribe($c, $id, 'caller', 'staff', 'both_tracks', 'se', (string) ($num['lang'] ?? '')) : ''; // v68: the number's language
            $ring = phRingList($num);
            if (!$ring) {
                phCallSet($id, ['st' => 'missed']);
                phXml($x . (!isset($num['vm']) || !empty($num['vm']) ? phVoicemail($c, $num, $id, $tx) : phSay('Sorry, nobody can take your call right now. Please call again later.') . '<Hangup/>'));
            }
            $x .= '<Dial timeout="' . max(5, min(60, (int) ($num['secs'] ?? 25))) . '" action="' . phX(phHook('phw_dial', ['c' => $id])) . '"'
                . ($rec ? ' record="record-from-answer-dual" recordingStatusCallback="' . phX(phHook('phw_rec', ['c' => $id])) . '" recordingStatusCallbackEvent="completed"' : '') . '>';
            foreach ($ring as $ruid) {
                $x .= '<Client statusCallbackEvent="answered" statusCallback="' . phX(phHook('phw_leg', ['c' => $id])) . '"><Identity>' . phX(phIdent($ruid)) . '</Identity><Parameter name="line" value="' . phX((string) ($num['label'] ?? '')) . '"/><Parameter name="callId" value="' . phX($id) . '"/><Parameter name="rec" value="' . ($rec ? '1' : '0') . '"/></Client>';
            }
            $x .= '</Dial>';
            phXml($x);

        case 'phw_dial':
            // how the dialed part ended: answered, busy, no answer...; an unanswered call to the company goes to voicemail
            if (!$row) {
                phXml('<Hangup/>');
            }
            $st = (string) ($p['DialCallStatus'] ?? '');
            $secs = (int) ($p['DialCallDuration'] ?? 0);
            $d = phCallData($row);
            if ($row['dir'] === 'out') {
                $map = ['completed' => 'done', 'answered' => 'done', 'busy' => 'busy', 'no-answer' => 'noanswer', 'failed' => 'failed', 'canceled' => 'canceled'];
                phCallSet((string) $row['id'], ['st' => $map[$st] ?? 'done', 'secs' => $secs]);
                phXml('<Hangup/>');
            }
            if ($st === 'completed' || $st === 'answered') {
                phCallSet((string) $row['id'], ['st' => 'done', 'secs' => $secs]);
                phXml('<Hangup/>');
            }
            phCallSet((string) $row['id'], ['st' => 'missed']);
            $num = phNumber($c, (string) $row['num']) ?? ['n' => (string) $row['num']];
            if (!isset($num['vm']) || !empty($num['vm'])) {
                phXml(phVoicemail($c, $num, (string) $row['id'], !empty($d['rec']) && $c['tx']));
            }
            phXml(phSay('Sorry, nobody can take your call right now. Please call again later.') . '<Hangup/>');

        case 'phw_vm':
            // the voicemail was left (or the caller hung up without one)
            if ($row && (int) ($p['RecordingDuration'] ?? 0) >= 1) {
                phCallSet((string) $row['id'], ['vm' => 1, 'st' => 'voicemail', 'rec' => mb_substr((string) ($p['RecordingSid'] ?? ''), 0, 64), 'rsecs' => (int) $p['RecordingDuration']]);
                $num = phNumber($c, (string) $row['num']);
                if ($num) {
                    header('Content-Type: text/xml; charset=utf-8');
                    echo '<?xml version="1.0" encoding="UTF-8"?><Response>' . phSay('Thank you. Goodbye.') . '<Hangup/></Response>';
                    phLater(fn() => phMailVoicemail($num, phCallBy('id', (string) $row['id']) ?? $row));
                    exit();
                }
            }
            phXml(phSay('Thank you. Goodbye.') . '<Hangup/>');

        case 'phw_rec':
            // a recording is ready (the call's, or the voicemail's)
            if ($row && ($p['RecordingStatus'] ?? 'completed') === 'completed') {
                $f = ['rec' => mb_substr((string) ($p['RecordingSid'] ?? ''), 0, 64), 'rsecs' => (int) ($p['RecordingDuration'] ?? 0)];
                if (!empty($_GET['vm']) && $f['rsecs'] >= 1) {
                    $f['vm'] = 1;
                    $f['st'] = 'voicemail';
                }
                phCallSet((string) $row['id'], $f);
            }
            http_response_code(204);
            exit();

        case 'phw_leg':
            // the person called answered (outgoing), or which browser took an incoming call
            if ($row) {
                $cs = (string) ($p['CallStatus'] ?? '');
                $uid = phUidOf((string) ($p['To'] ?? ''));
                if ($row['dir'] === 'in' && $uid !== '' && in_array($cs, ['in-progress', 'answered'], true)) {
                    phCallSet((string) $row['id'], ['uid' => $uid, 'st' => 'live']);
                } elseif ($row['dir'] === 'out' && in_array($cs, ['in-progress', 'answered'], true)) {
                    phCallSet((string) $row['id'], ['st' => 'live']);
                } elseif ($cs === 'completed') {
                    phCallSet((string) $row['id'], ['secs' => (int) ($p['CallDuration'] ?? $row['secs'])]);
                }
            }
            http_response_code(204);
            exit();

        case 'phw_status':
            // the whole call ended (the browser's call, or the caller's): anything still ringing was not answered
            $call = phCallBy('sid', (string) ($p['CallSid'] ?? ''));
            if ($call && ($p['CallStatus'] ?? '') !== '' && in_array($call['st'], ['ringing', 'live'], true) && in_array($p['CallStatus'], ['completed', 'busy', 'failed', 'no-answer', 'canceled'], true)) {
                $done = $call['st'] === 'live' ? 'done' : ($call['dir'] === 'in' ? 'missed' : 'canceled');
                phCallSet((string) $call['id'], ['st' => $done]);
            }
            http_response_code(204);
            exit();

        case 'phw_tx':
            // what was said, a sentence at a time; when the transcript ends, the summary is written
            if (!$row) {
                http_response_code(204);
                exit();
            }
            $ev = (string) ($p['TranscriptionEvent'] ?? '');
            if ($ev === 'transcription-content' && ($p['Final'] ?? 'true') !== 'false') {
                $data = json_decode((string) ($p['TranscriptionData'] ?? ''), true);
                $text = is_array($data) ? trim((string) ($data['transcript'] ?? '')) : '';
                if ($text !== '') {
                    $track = (string) ($p['Track'] ?? '');
                    $label = $track === 'inbound_track' ? (string) ($p['InboundTrackLabel'] ?? '') : (string) ($p['OutboundTrackLabel'] ?? '');
                    if ($label === '') {
                        $label = ($row['dir'] === 'out') === ($track === 'inbound_track') ? 'staff' : ($row['dir'] === 'out' ? 'other' : 'caller');
                    }
                    // a call to the company that nobody took: what the caller heard was the voicemail greeting
                    $now = phCallBy('id', (string) $row['id']) ?? $row;
                    if ($row['dir'] === 'in' && $label === 'staff' && (string) $now['uid'] === '' && in_array((string) $now['st'], ['missed', 'voicemail'], true)) {
                        $label = 'greeting';
                    }
                    // v68: the language of this part: what the provider detected (auto-detection), else the code asked for
                    $lc = phTxLang($p);
                    dbBatch(function () use ($row, $label, $text, $p, $lc) {
                        $cur = phCallBy('id', (string) $row['id']);
                        $tx = json_decode((string) ($cur['tx'] ?? ''), true);
                        $tx = is_array($tx) ? $tx : [];
                        if (count($tx) < 3000) {
                            $tx[] = ['w' => mb_substr($label, 0, 12), 's' => mb_substr($text, 0, 2000), 't' => mb_substr((string) ($p['Timestamp'] ?? ''), 0, 40)] + ($lc !== '' ? ['l' => $lc] : []);
                        }
                        phCallSet((string) $row['id'], ['tx' => json_encode($tx, JSON_UNESCAPED_UNICODE)]);
                    });
                }
            } elseif ($ev === 'transcription-stopped') {
                $d = phCallData($row);
                $d['sumDue'] = true;
                phCallSet((string) $row['id'], ['data' => json_encode($d)]);
                http_response_code(204);
                phLater(fn() => phSummarize((string) $row['id']));
                exit();
            } elseif ($ev === 'transcription-error') {
                $d = phCallData($row);
                $d['txErr'] = mb_substr((string) ($p['TranscriptionError'] ?? ''), 0, 200);
                phCallSet((string) $row['id'], ['data' => json_encode($d)]);
            }
            http_response_code(204);
            exit();

        case 'phw_sms':
            // a text to a company number; STOP and START are remembered (Twilio itself answers them)
            $to = (string) ($p['To'] ?? '');
            $from = (string) ($p['From'] ?? '');
            $body = mb_substr((string) ($p['Body'] ?? ''), 0, 4000);
            $od = phOd($from);
            $dup = phDb()->prepare('SELECT 1 FROM ph_msgs WHERE sid = ? LIMIT 1');
            $dup->execute([(string) ($p['MessageSid'] ?? '')]);
            if (!$dup->fetchColumn()) {
                phDb()->prepare('INSERT INTO ph_msgs (id, sid, at, dir, num, other, od, uid, body, st, err, media, ref) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute(['m' . rid(8), (string) ($p['MessageSid'] ?? ''), now(), 'in', $to, mb_substr($from, 0, 32), $od, '', $body, 'received', '', (int) ($p['NumMedia'] ?? 0), '']);
            }
            $kw = strtolower(trim((string) preg_replace('/[^A-Za-z]/', '', $body)));
            if ($od !== '' && (in_array($kw, PH_STOP, true) || ($p['OptOutType'] ?? '') === 'STOP')) {
                phDb()->prepare('REPLACE INTO ph_optout (od, at, kw) VALUES (?,?,?)')->execute([$od, now(), mb_substr($kw, 0, 16)]);
            } elseif ($od !== '' && (in_array($kw, PH_START, true) || ($p['OptOutType'] ?? '') === 'START')) {
                phDb()->prepare('DELETE FROM ph_optout WHERE od = ?')->execute([$od]);
            }
            phXml('');

        case 'phw_smsst':
            // a sent text was delivered, or not
            $st = (string) ($p['MessageStatus'] ?? '');
            if ($st !== '') {
                phDb()->prepare('UPDATE ph_msgs SET st = ?, err = ? WHERE sid = ?')->execute([mb_substr($st, 0, 16), mb_substr((string) ($p['ErrorCode'] ?? ''), 0, 120), (string) ($p['MessageSid'] ?? '')]);
            }
            http_response_code(204);
            exit();
    }
    http_response_code(404);
    exit();
}

/* ---------------------------------------------------------------- the portal's requests (ph_*) */

/** The calls and texts this person has not seen yet (missed calls, voicemails, texts in) since they last looked. */
function phUnseen(array $u): array
{
    $seen = docGet('ph/x/seen/' . $u['id']);
    [$w, $a] = phScope($u, false);
    $s = phDb()->prepare("SELECT COUNT(*) FROM ph_calls WHERE dir = 'in' AND st IN ('missed', 'voicemail') AND at > ? AND $w");
    $s->execute(array_merge([(int) ($seen->calls ?? 0)], $a));
    $calls = (int) $s->fetchColumn();
    $nums = [];
    foreach (phCfg()['numbers'] as $n) {
        $ring = (array) ($n['ring'] ?? []);
        $own = phOwner($n); // v39.2: someone else's personal line is not counted
        if (!empty($n['sms']) && ($own !== '' ? $own === (string) $u['id'] : (!$ring || in_array($u['id'], $ring, true) || hasRole($u, 'admin')))) {
            $nums[] = (string) $n['n'];
        }
    }
    $texts = 0;
    if ($nums) {
        $s = phDb()->prepare("SELECT COUNT(*) FROM ph_msgs WHERE dir = 'in' AND at > ? AND num IN (" . implode(',', array_fill(0, count($nums), '?')) . ')');
        $s->execute(array_merge([(int) ($seen->texts ?? 0)], $nums));
        $texts = (int) $s->fetchColumn();
    }
    return ['calls' => $calls, 'texts' => $texts];
}
function phMsgView(array $m, array $people): array
{
    return ['id' => (string) $m['id'], 'at' => (int) $m['at'], 'dir' => (string) $m['dir'], 'num' => (string) $m['num'], 'other' => (string) $m['other'], 'od' => (string) $m['od'], 'body' => (string) $m['body'], 'st' => (string) $m['st'], 'err' => (string) $m['err'], 'media' => (int) $m['media'], 'who' => $people[(string) $m['uid']] ?? ''];
}
/* ---------------------------------------------------------------- v39.1: why a call failed; checking the setup */

/** Twilio's signature for a request: base64 HMAC-SHA1 (Auth Token) of the URL and the POST fields in name order. */
function phSign(string $url, array $p, string $token): string
{
    ksort($p, SORT_STRING);
    $data = $url;
    foreach ($p as $k => $v) {
        $data .= $k . (is_array($v) ? implode('', $v) : $v);
    }
    return base64_encode(hash_hmac('sha1', $data, $token, true));
}
/** Is the saved Auth Token this account's? (Twilio signs every request it sends the portal with it.) [status, JSON] */
function phTokenCheck(array $c): array
{
    if ($c['sid'] === '' || ($c['token'] ?? '') === '') {
        return [0, ['message' => 'No Auth Token is saved.']];
    }
    $ch = curl_init(phTwBase() . '/2010-04-01/Accounts/' . rawurlencode($c['sid']) . '.json');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_USERPWD => $c['sid'] . ':' . $c['token'],
        CURLOPT_HTTPHEADER => ['Accept: application/json', 'User-Agent: StratEdge-portal/1.0'],
    ]);
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($raw === false) {
        return [0, ['message' => 'Twilio could not be reached: ' . $err]];
    }
    $j = json_decode((string) $raw, true);
    return [$code, is_array($j) ? $j : (string) $raw];
}
/** What a Twilio error code means for the person calling, and what fixes it (['', ''] when it is not one we explain). */
function phErrWords(int $code): array
{
    if ($code === 21219) {
        return ['The Twilio account is a trial account: it can only call numbers verified in the Twilio console.', 'Verify the number in the Twilio console (Phone Numbers › Verified Caller IDs), or upgrade the account.'];
    }
    if ($code === 13227 || $code === 21215) {
        return ["Twilio's geo permissions do not allow calls to that country.", 'In the Twilio console, open Voice › Settings › Geo permissions and tick the country.'];
    }
    if ($code === 13223 || $code === 13224) {
        return ['Twilio cannot call that number: it is not a valid number, or not one Twilio calls (premium-rate or shared-cost).', 'Check the number and dial it with the country code (+1…, +91…).'];
    }
    if ($code === 13225) {
        return ['Twilio blocked the call (a fraud-risk or regulated destination; calls to +1 numbers can also need the business profile in Twilio\'s Trust Hub).', 'See the details in the Twilio console under Monitor › Logs › Errors.'];
    }
    if ($code === 13214) {
        return ['Twilio did not accept the company number shown to the person called.', 'Under Phone setup, check that the number belongs to this Twilio account and is switched on.'];
    }
    if ($code >= 11200 && $code < 11300) {
        return ['Twilio could not get the call instructions from the portal: its address did not answer, or answered with an error.', 'An administrator can run "Check the setup" under Phone setup: a wrong Auth Token or a hosting firewall (ModSecurity, Imunify360) refusing Twilio are the usual causes.'];
    }
    if ($code === 12100 || $code === 12300) {
        return ["Twilio could not read the portal's call instructions.", 'An administrator can run "Check the setup" under Phone setup.'];
    }
    return ['', ''];
}
/** Twilio's alert text is often "Msg=...&ErrorCode=...&url=...": the message alone. */
function phAlertText(string $t): string
{
    $t = trim($t);
    if (str_contains($t, '=') && !str_contains($t, ' ')) {
        parse_str($t, $kv);
        $m = (string) ($kv['Msg'] ?? ($kv['msg'] ?? ''));
        if ($m !== '') {
            $t = $m;
        }
    }
    return mb_substr($t, 0, 300);
}
/** Twilio's recent errors (Monitor › Logs › Errors), newest first: ['err' => '', 'list' => [[code, at, res, text, url]]]. */
function phAlerts(array $c, int $since, int $max = 50): array
{
    $r = phApi('GET', '/v1/Alerts', ['LogLevel' => 'error', 'StartDate' => gmdate('Y-m-d\TH:i:s\Z', time() - $since), 'PageSize' => $max], $c, 15, 'monitor');
    if ($r[0] !== 200 || !is_array($r[1])) {
        return ['err' => phApiErr($r), 'list' => []];
    }
    $out = [];
    foreach ((array) ($r[1]['alerts'] ?? []) as $a) {
        if (!is_array($a)) {
            continue;
        }
        $at = strtotime((string) ($a['date_generated'] ?? ($a['date_created'] ?? '')));
        $out[] = ['code' => (int) ($a['error_code'] ?? 0), 'at' => $at ? $at * 1000 : 0, 'res' => (string) ($a['resource_sid'] ?? ''), 'text' => phAlertText((string) ($a['alert_text'] ?? '')), 'url' => (string) ($a['request_url'] ?? '')];
    }
    usort($out, fn($a, $b) => $b['at'] <=> $a['at']);
    return ['err' => '', 'list' => $out];
}
/** The same webhook address (https or http, with or without www.)? */
function phSameHook(string $a, string $b): bool
{
    $n = function (string $u): string {
        $x = parse_url($u);
        if (!is_array($x) || empty($x['host'])) {
            return '';
        }
        return preg_replace('/^www\./', '', strtolower((string) $x['host'])) . (isset($x['port']) ? ':' . $x['port'] : '') . ($x['path'] ?? '/') . (isset($x['query']) ? '?' . $x['query'] : '');
    };
    return $n($a) !== '' && $n($a) === $n($b);
}
/** A request like Twilio's (signed with the Auth Token) from the server to the portal's own call address. [ok|null, words] */
function phSelfTest(array $c): array
{
    $url = phHook('phw_ping');
    $p = ['AccountSid' => $c['sid'], 'CallSid' => 'CA' . str_repeat('0', 32), 'Check' => 'setup'];
    // development: the local server (SE_WS_LOOP) answers for the public address, signed for that address as Twilio would
    $loop = (string) getenv('SE_WS_LOOP');
    $send = $loop !== '' ? rtrim($loop, '/') . (string) parse_url($url, PHP_URL_PATH) . '?' . (string) parse_url($url, PHP_URL_QUERY) : $url;
    $ch = curl_init($send);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query($p),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded', 'X-Twilio-Signature: ' . phSign($url, $p, (string) $c['token']), 'User-Agent: TwilioProxy/1.1 (StratEdge setup check)'],
    ]);
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $type = strtolower((string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE));
    $loc = (string) curl_getinfo($ch, CURLINFO_REDIRECT_URL);
    $err = curl_error($ch);
    curl_close($ch);
    if ($raw === false) {
        return [null, 'The server could not reach its own address (' . $url . '): ' . $err . '. Some hosts never allow that, so this alone does not mean Twilio cannot; Twilio\'s errors below say for sure.'];
    }
    if ($code >= 300 && $code < 400) {
        return [false, 'The call address sends visitors on to ' . ($loc !== '' ? $loc : 'another address') . '. Twilio does not follow that: open the portal at its final https address and press Connect again.'];
    }
    if ($code === 403 && trim((string) $raw) === 'Forbidden') {
        return [false, 'The portal refused a request signed with the saved Auth Token: the token does not match the account (see the Auth Token above), or the site address changed since Connect.'];
    }
    if ($code !== 200) {
        return [false, 'The call address answered ' . ($code ?: 'nothing') . ' instead of the call instructions. A hosting firewall (ModSecurity, Imunify360, a bot shield) or a password on the site is likely refusing requests like Twilio\'s; ask the host to let Twilio\'s requests to ' . $url . ' through.'];
    }
    $xml = trim((string) $raw);
    $prev = libxml_use_internal_errors(true);
    $ok = str_starts_with($xml, '<?xml') && simplexml_load_string($xml) !== false;
    libxml_clear_errors();
    libxml_use_internal_errors($prev);
    if (!$ok || !str_contains($type, 'xml')) {
        return [false, 'The call address answers, but with other text around the call instructions (for example PHP warnings shown on pages), so Twilio cannot read them.'];
    }
    return [true, 'It answers ' . $url . ' with call instructions, as Twilio needs.'];
}
/** Every part Twilio needs, checked. sev is ok|improve|fix|info; ok stays for backward compatibility. */
function phCheckAll(array $c): array
{
    $out = [];
    $add = function (string $k, ?bool $ok, string $t, string $d, string $fix = '', string $sev = '') use (&$out) {
        if ($sev === '') $sev = $ok === true ? 'ok' : ($ok === false ? 'fix' : 'info');
        if (!in_array($sev, ['ok', 'improve', 'fix', 'info'], true)) $sev = 'info';
        $out[] = ['k' => $k, 'ok' => $ok, 'sev' => $sev, 't' => $t, 'd' => $d, 'fix' => $fix];
    };
    $acct = phApi('GET', '/2010-04-01/Accounts/' . rawurlencode($c['sid']) . '.json', [], $c, 15);
    if ($acct[0] !== 200 || !is_array($acct[1])) {
        $add('keys', false, 'The API key', phApiErr($acct), 'Enter the Account SID and the API key (SID and secret) again, then press Connect.');
        return $out;
    }
    $add('keys', true, 'The API key', 'Twilio accepts it for "' . mb_substr((string) ($acct[1]['friendly_name'] ?? $c['sid']), 0, 80) . '".');
    $status = (string) ($acct[1]['status'] ?? 'active');
    if ($status !== 'active') {
        $add('status', false, 'The Twilio account', 'The account is ' . $status . ', so calls and texts are refused.', 'Reactivate it in the Twilio console.');
    }
    $trial = strcasecmp((string) ($acct[1]['type'] ?? ''), 'Trial') === 0;
    $add(
        'trial',
        $trial ? null : true,
        $trial ? 'Twilio Trial account' : 'A paid (upgraded) account',
        $trial ? 'The connection works. A trial account can only call and text numbers verified in the Twilio console, and every call starts with a short trial message; the setup itself is complete.' : 'Calls can go to any number the geo permissions allow.',
        $trial ? 'Until the account is upgraded, calls and texts can only go to numbers verified in the Twilio console (Phone Numbers › Verified Caller IDs); upgrade the account (Billing) for unrestricted calling and texting.' : '',
        $trial ? 'improve' : 'ok'
    );
    $tok = phTokenCheck($c);
    if ($tok[0] === 200) {
        $add('token', true, 'The Auth Token', 'It is this account\'s, so the portal can tell Twilio\'s requests from anyone else\'s.');
    } elseif ($tok[0] === 401 || $tok[0] === 403) {
        $add('token', false, 'The Auth Token', 'Twilio does not accept the saved Auth Token. Twilio signs every call, text and voicemail it sends the portal with it, so the portal refuses them all: calls end at once ("ConnectionError (31005)"), and Twilio logs error 11200.', 'Copy the Auth Token again from the Twilio console (Account info on the dashboard; not the API key secret), paste it under Keys, save, then press Connect.');
    } else {
        $add('token', null, 'The Auth Token', 'It could not be checked: ' . phApiErr($tok));
    }
    $fail = secKv('ph_sigfail');
    if (is_array($fail) && (int) ($fail['at'] ?? 0) > now() - 7 * 86400000) {
        $add('sig', false, 'Requests refused', 'On ' . gmdate('M j, H:i', (int) ($fail['at'] / 1000)) . ' UTC the portal refused a request for this account (' . ($fail['r'] ?? '') . ') because its signature did not match the Auth Token.', 'If the Auth Token above is fine, the portal is answering at another address than the one Twilio calls: press Connect again from the portal\'s usual https address.');
    }
    $app = $c['app'] !== '' ? phApi('GET', 'Applications/' . rawurlencode($c['app']) . '.json', [], $c, 15) : [404, null];
    if ($app[0] === 200 && is_array($app[1])) {
        $vu = (string) ($app[1]['voice_url'] ?? '');
        $same = phSameHook($vu, phHook('phw_out'));
        $add('app', $same, 'The TwiML App', $same ? 'Calls from the browsers go to ' . $vu . '.' : 'Calls from the browsers go to ' . ($vu !== '' ? $vu : 'no address') . ', not to ' . phHook('phw_out') . '.', $same ? '' : 'Press Connect again under Keys.');
    } elseif ($app[0] === 404) {
        $add('app', false, 'The TwiML App', 'Twilio has no TwiML App for the portal (it was deleted, or Connect did not finish).', 'Press Connect again under Keys.');
    } else {
        $add('app', null, 'The TwiML App', 'It could not be checked: ' . phApiErr($app));
    }
    [$ok, $words] = phSelfTest($c);
    $add('self', $ok, "The portal's call address", $words);
    foreach ($c['numbers'] as $n) {
        if (empty($n['on']) || empty($n['sid'])) {
            continue;
        }
        $r = phApi('GET', 'IncomingPhoneNumbers/' . rawurlencode((string) $n['sid']) . '.json', [], $c, 15);
        $label = 'The number ' . $n['n'];
        if ($r[0] === 404) {
            $add('num' . $n['n'], false, $label, 'It is no longer on this Twilio account.', 'Switch it off here, or put it back on the account.');
            continue;
        }
        if ($r[0] !== 200 || !is_array($r[1])) {
            $add('num' . $n['n'], null, $label, 'It could not be checked: ' . phApiErr($r));
            continue;
        }
        $v = phSameHook((string) ($r[1]['voice_url'] ?? ''), phHook('phw_in'));
        $s = empty($n['sms']) || phSameHook((string) ($r[1]['sms_url'] ?? ''), phHook('phw_sms'));
        $add('num' . $n['n'], $v && $s, $label, $v && $s ? 'Its calls' . (empty($n['sms']) ? '' : ' and texts') . ' come to the portal.' : 'Its ' . (!$v ? 'calls' : 'texts') . ' go to ' . ((string) ($r[1][!$v ? 'voice_url' : 'sms_url'] ?? '') ?: 'nowhere') . ', not to the portal.', $v && $s ? '' : 'Open the number under Company numbers and save it again.');
    }
    $geo = [];
    if (in_array('nanp', $c['dest'], true)) {
        $geo['US'] = 'the US and Canada';
    }
    if (in_array('in', $c['dest'], true)) {
        $geo['IN'] = 'India';
    }
    foreach ($geo as $iso => $name) {
        $g = phApi('GET', '/v1/DialingPermissions/Countries/' . $iso, [], $c, 15, 'voice');
        if ($g[0] === 200 && is_array($g[1])) {
            $on = !empty($g[1]['low_risk_numbers_enabled']);
            $add('geo' . $iso, $on, 'Calls to ' . $name, $on ? 'Twilio\'s geo permissions allow them.' : 'Twilio\'s geo permissions do not allow them, so these calls fail (Twilio error 13227).', $on ? '' : 'In the Twilio console, open Voice › Settings › Geo permissions and tick ' . ($iso === 'US' ? 'United States/Canada' : $name) . '.');
        } else {
            $add('geo' . $iso, null, 'Calls to ' . $name, 'Twilio\'s geo permissions could not be read: ' . phApiErr($g));
        }
    }
    return $out;
}
/** Why the person's call failed: the portal's own log first, then Twilio's errors for the call. */
function phWhy(array $u, array $b): array
{
    $c = phCfg(true);
    $uid = (string) $u['id'];
    $admin = hasRole($u, 'admin');
    $sid = preg_match('/^CA[0-9a-f]{32}$/', (string) ($b['sid'] ?? '')) ? (string) $b['sid'] : '';
    $since = max(now() - 600000, (int) ($b['at'] ?? 0) - 60000);
    $row = $sid !== '' ? phCallBy('sid', $sid) : null;
    if ($row && (string) $row['uid'] !== $uid && !$admin) {
        // someone else's call: nothing about it
        $row = null;
        $sid = '';
    }
    if (!$row && $sid === '') {
        // the browser had no call id yet: the person's own latest call out, made around then
        $s = phDb()->prepare("SELECT * FROM ph_calls WHERE uid = ? AND dir = 'out' AND at >= ? ORDER BY at DESC LIMIT 1");
        $s->execute([$uid, $since]);
        $row = $s->fetch() ?: null;
    }
    $st = $row ? (string) $row['st'] : '';
    $d = $row ? (json_decode((string) ($row['data'] ?? ''), true) ?: []) : [];
    $say = fn(string $why, string $fix = '', bool $final = true, int $code = 0, string $more = '') => ['final' => $final, 'st' => $st, 'reason' => $why, 'fix' => $fix, 'code' => $code, 'more' => $more];
    if ($st === 'blocked') {
        return $say((string) ($d['why'] ?? 'The portal did not allow that call.'));
    }
    if ($st === 'busy') {
        return $say('The number was busy.');
    }
    if ($st === 'noanswer') {
        return $say('Nobody answered.');
    }
    if ($st === 'canceled') {
        return $say('The call was canceled before it was answered.');
    }
    if ($st === 'done' || $st === 'live') {
        return $say('The call was answered.');
    }
    // a Twilio code the browser already got with the hang-up answers at once
    $gw = (int) ($b['gw'] ?? 0);
    if ($gw >= 10000 && $gw <= 99999) {
        [$why, $fix] = phErrWords($gw);
        if ($why !== '') {
            return $say($why, $fix, true, $gw);
        }
    }
    if (throttleHit('phwhy:' . $uid, 40, 3600)) {
        return $say('Twilio could not connect the call.', 'An administrator can see why in the Twilio console under Monitor › Logs › Errors.');
    }
    if (!$row && $sid !== '') {
        // not in the portal's log: only when Twilio says the call came from this person's browser
        $call = phApi('GET', 'Calls/' . $sid . '.json', [], $c, 10);
        if (!(is_array($call[1]) && (string) ($call[1]['from'] ?? '') === 'client:' . phIdent($uid))) {
            $sid = '';
        }
    }
    $sids = array_values(array_unique(array_filter([$row ? (string) $row['sid'] : '', $sid])));
    foreach ($sids as $s1) {
        $kids = phApi('GET', 'Calls.json', ['ParentCallSid' => $s1, 'PageSize' => 5], $c, 10);
        foreach ((array) (is_array($kids[1]) ? ($kids[1]['calls'] ?? []) : []) as $k) {
            if (!empty($k['sid'])) {
                $sids[] = (string) $k['sid'];
            }
        }
    }
    $al = phAlerts($c, 1800);
    $hit = null;
    foreach ($al['list'] as $a) {
        if ($a['res'] !== '' && in_array($a['res'], $sids, true)) {
            $hit = $a;
            break;
        }
    }
    if (!$hit && !$row && $sid === '') {
        // Twilio never reached the portal: its error about the call address, for a call from this person's browser
        foreach (array_slice($al['list'], 0, 10) as $a) {
            if ($a['at'] >= $since && str_contains($a['url'], 'phw_out') && preg_match('/^CA[0-9a-f]{32}$/', $a['res'])) {
                $call = phApi('GET', 'Calls/' . $a['res'] . '.json', [], $c, 10);
                if (is_array($call[1]) && (string) ($call[1]['from'] ?? '') === 'client:' . phIdent($uid)) {
                    $hit = $a;
                    break;
                }
            }
        }
    }
    if ($hit) {
        [$why, $fix] = phErrWords($hit['code']);
        return $say($why !== '' ? $why : 'Twilio stopped the call (error ' . $hit['code'] . ').', $fix !== '' ? $fix : 'Twilio explains error ' . $hit['code'] . ' at twilio.com/docs/api/errors/' . $hit['code'] . '.', true, $hit['code'], $admin ? $hit['text'] : '');
    }
    if (!$row) {
        return $say('The call did not reach the portal.', $admin ? 'Run "Check the setup" under Phone setup: Twilio could not get the call instructions (a wrong Auth Token or a hosting firewall are the usual causes).' : 'An administrator can run "Check the setup" under Phone setup.', false);
    }
    return $say('Twilio could not connect the call.', $admin ? 'Twilio\'s reason shows here in a few seconds, or in the Twilio console under Monitor › Logs › Errors. "Check the setup" under Phone setup checks the account (a trial account only calls verified numbers).' : 'An administrator can see why in the Twilio console under Monitor › Logs › Errors.', false);
}

/** v77: VitelGlobal's documented billing API. Credentials are kept encrypted in phCfg(). */
function phVitelBase(): string
{
    return 'https://billing.vitelglobal.com';
}
function phVitelGet(string $path, array $params, int $timeout = 30): array
{
    $url = phVitelBase() . '/' . ltrim($path, '/') . '?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);
    $buf = '';
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => false,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_HTTPHEADER => ['Accept: application/xml,text/xml,text/plain,*/*', 'User-Agent: StratEdge-portal/77 VitelGlobal'],
        CURLOPT_WRITEFUNCTION => function ($cc, $x) use (&$buf) {
            if (strlen($buf) + strlen($x) > 4 * 1048576) return 0;
            $buf .= $x;
            return strlen($x);
        },
    ]);
    curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = curl_errno($ch) ? curl_error($ch) : '';
    curl_close($ch);
    if ($err !== '' || $code < 200 || $code >= 300) fail(502, 'unavailable', $err !== '' ? 'VitelGlobal could not be reached.' : ('VitelGlobal answered HTTP ' . $code . '.'));
    return [$code, trim($buf)];
}
function phVitelCall(array $c, string $to): array
{
    if (($c['vitelUsername'] ?? '') === '' || ($c['vitelExtension'] ?? '') === '') fail(409, 'not_ready', 'Save the VitelGlobal username and extension under Phone setup first.');
    [, $raw] = phVitelGet('clicktocall/index.php', ['fromnum'=>(string)$c['vitelExtension'],'tonum'=>$to,'vitelusername'=>(string)$c['vitelUsername']]);
    return ['status'=>'requested','sid'=>'vitel-'.substr(hash('sha256',$raw.'|'.microtime(true)),0,18),'raw'=>mb_substr($raw,0,1000)];
}
function phVitelSms(array $c, string $to, string $from, string $body): array
{
    if (($c['vitelUsername'] ?? '') === '' || ($c['vitelPassword'] ?? '') === '') fail(409, 'not_ready', 'Save the VitelGlobal username and password under Phone setup first.');
    [, $raw] = phVitelGet('vitelsms.php', ['username'=>(string)$c['vitelUsername'],'password'=>(string)$c['vitelPassword'],'frm'=>$from,'dst'=>$to,'message'=>$body]);
    if (preg_match('/\b(error|failed|invalid|denied|unauthori[sz]ed)\b/i', $raw)) fail(502, 'unavailable', 'VitelGlobal did not accept the SMS request. Check Phone setup and the VitelGlobal account.');
    return ['status'=>'queued','sid'=>'vitel-sms-'.substr(hash('sha256',$raw.'|'.microtime(true)),0,18),'raw'=>mb_substr($raw,0,1000)];
}
function phVitelReportRows(array $c, string $start, string $end): array
{
    if (($c['vitelUsername'] ?? '') === '' || ($c['vitelPassword'] ?? '') === '') fail(409, 'not_ready', 'Save the VitelGlobal username and password under Phone setup first.');
    [, $raw] = phVitelGet('vitelglobal_callrecords.php', ['username'=>(string)$c['vitelUsername'],'password'=>(string)$c['vitelPassword'],'line'=>(string)(($c['vitelLine']??'')?:'All'),'startdate'=>$start,'enddate'=>$end], 45);
    if ($raw === '') return [];
    if (preg_match('/\b(error|invalid|unauthori[sz]ed|authentication failed|login failed|bad password)\b/i', $raw)) fail(502, 'unavailable', 'VitelGlobal did not accept the call-report credentials. Check the saved username/password.');
    $old=libxml_use_internal_errors(true); $xml=@simplexml_load_string($raw,'SimpleXMLElement',LIBXML_NONET|LIBXML_NOCDATA); libxml_clear_errors(); libxml_use_internal_errors($old);
    if ($xml === false) fail(502, 'unavailable', 'VitelGlobal returned a call report that could not be read as XML.');
    $rows=[];
    $walk=function($node) use (&$walk,&$rows){ if(!($node instanceof SimpleXMLElement))return; $a=[]; foreach($node->children() as $k=>$v) if($v->count()===0)$a[strtolower((string)$k)]=trim((string)$v); $keys=implode('|',array_keys($a)); if($a&&preg_match('/(?:from|source|caller|src|to|destination|called|dst|duration|date|time)/',$keys))$rows[]=$a; foreach($node->children() as $v)if($v->count()>0)$walk($v); };
    $walk($xml); return array_slice($rows,0,5000);
}
function phVitelPick(array $r, array $keys): string { foreach($keys as $k)if(isset($r[$k])&&trim((string)$r[$k])!=='')return trim((string)$r[$k]); return ''; }
function phVitelTime(array $r): int { $d=phVitelPick($r,['datetime','call_datetime','calldate','call_date','date','starttime','start_time','time']); $t=$d!==''?strtotime($d):false; return $t!==false?$t*1000:now(); }
function phVitelSyncRows(array $rows, array $c, array $u): array
{
    $pdo=phDb(); $added=0; $updated=0; $skipped=0; $find=$pdo->prepare('SELECT id FROM ph_calls WHERE sid = ? LIMIT 1');
    $upd=$pdo->prepare('UPDATE ph_calls SET at=?, dir=?, num=?, other=?, od=?, st=?, secs=?, data=? WHERE sid=?');
    $ins=$pdo->prepare("INSERT INTO ph_calls (id,sid,at,dir,num,other,od,uid,st,secs,rec,rsecs,vm,ref,tx,sum,note,data) VALUES (?,?,?,?,?,?,?,?,?,?,'',0,0,'','','','',?)");
    foreach($rows as $r){ if(!is_array($r)){ $skipped++; continue; } $from=phVitelPick($r,['from','fromnum','from_number','source','src','caller','callerid','caller_id','ani']); $to=phVitelPick($r,['to','tonum','to_number','destination','dst','called','called_number','dnis']); if($from===''&&$to===''){ $skipped++; continue; } $company=(string)($c['providerFrom']??''); $dir='out'; $other=$to; $num=$from!==''?$from:$company; if($company!==''&&phOd($to)===phOd($company)){ $dir='in';$other=$from;$num=$to; } elseif($company!==''&&phOd($from)===phOd($company)){ $dir='out';$other=$to;$num=$from; } $dur=(int)preg_replace('/\D+/','',phVitelPick($r,['duration','seconds','secs','billsec','billseconds','bill_seconds'])); $status=mb_strtolower(phVitelPick($r,['status','disposition','result'])); if($status==='')$status=$dur>0?'completed':'reported'; $srcId=phVitelPick($r,['id','callid','call_id','uniqueid','uuid','recordid','record_id']); $sid='vitel-'.substr(hash('sha256',$srcId.'|'.json_encode($r,JSON_UNESCAPED_SLASHES)),0,32); $at=phVitelTime($r); $data=json_encode(['provider'=>'vitel','report'=>$r],JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE); $find->execute([$sid]); if($find->fetchColumn()){ $upd->execute([$at,$dir,$num,$other,phOd($other),mb_substr($status,0,16),$dur,$data,$sid]);$updated++; } else { $ins->execute(['v'.rid(7),$sid,$at,$dir,$num,$other,phOd($other),(string)$u['id'],mb_substr($status,0,16),$dur,$data]);$added++; } }
    return ['added'=>$added,'updated'=>$updated,'skipped'=>$skipped,'received'=>count($rows)];
}

/** v72/v77: generic REST adapter for other providers. VitelGlobal has its own fixed adapter above. */
function phProviderUrl(array $c, string $path): string
{
    $base = rtrim((string) ($c['providerBase'] ?? ''), '/');
    $path = trim($path);
    $url = preg_match('#^https://#i', $path) ? $path : $base . '/' . ltrim($path, '/');
    $p = parse_url($url);
    if (($p['scheme'] ?? '') !== 'https' || empty($p['host'])) fail(400, 'invalid_argument', 'The phone provider endpoint must be a public HTTPS address from your provider documentation.');
    $h = strtolower((string) $p['host']);
    if ($h === 'localhost' || str_ends_with($h, '.local')) fail(400, 'invalid_argument', 'The phone provider endpoint must be on the public internet.');
    $ips = [];
    if (filter_var($h, FILTER_VALIDATE_IP)) {
        $ips[] = $h;
    } else {
        foreach ((array) @dns_get_record($h, DNS_A | DNS_AAAA) as $rr) {
            $ip = (string) ($rr['ip'] ?? $rr['ipv6'] ?? '');
            if ($ip !== '') $ips[] = $ip;
        }
        if (!$ips) $ips = gethostbynamel($h) ?: [];
    }
    if (!$ips) fail(400, 'invalid_argument', 'The phone provider hostname could not be resolved.');
    foreach (array_unique($ips) as $ip) {
        if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            fail(400, 'invalid_argument', 'The phone provider endpoint resolves inside a private or reserved network, which StratEdge will not call.');
        }
    }
    return $url;
}
function phProviderRequest(array $c, string $path, array $body): array
{
    if (($c['providerKey'] ?? '') === '') fail(409, 'not_ready', 'The selected phone provider API key is not saved.');
    $url = phProviderUrl($c, $path);
    $payload = json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    $buf = ''; $ch = curl_init(extUrl($url));
    curl_setopt_array($ch, [CURLOPT_POST=>true, CURLOPT_HTTPHEADER=>['Accept: application/json','Content-Type: application/json','Authorization: Bearer ' . $c['providerKey']], CURLOPT_POSTFIELDS=>$payload, CURLOPT_FOLLOWLOCATION=>false, CURLOPT_CONNECTTIMEOUT=>10, CURLOPT_TIMEOUT=>30, CURLOPT_USERAGENT=>'StratEdge-portal/74 phone-provider', CURLOPT_WRITEFUNCTION=>function($cc,$x)use(&$buf){if(strlen($buf)>2*1048576)return 0;$buf.=$x;return strlen($x);}]);
    curl_exec($ch); $code=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE); $err=curl_errno($ch)?curl_error($ch):''; curl_close($ch);
    $j=json_decode($buf,true);
    if($err!==''||$code<200||$code>=300) fail(502,'unavailable',$err!==''?$err:('The phone provider answered HTTP '.$code.'.'));
    return is_array($j)?$j:['ok'=>true];
}

function phRoute(string $r, array $b): never
{
    if (str_starts_with($r, 'phw_')) {
        phHookRoute($r);
    }
    switch ($r) {
        case 'ph_why':
            // v39.1: why the person's call failed, in plain words (the portal's log, then Twilio's errors for the call)
            $u = phUser();
            ok(phWhy($u, $b));

        case 'ph_check':
            // v39.1: checks every part Twilio needs and lists Twilio's recent errors in plain words
            $u = phAdmin();
            $c = phCfg(true);
            if ($c['sid'] === '' || $c['keySid'] === '' || ($c['keySecret'] ?? '') === '') {
                fail(409, 'not_ready', 'Enter the Twilio keys and press Connect first.');
            }
            if (throttleHit('phcheck:' . $u['id'], 30, 3600)) {
                fail(429, 'rate_limited', 'The setup was checked many times in the last hour. Try again later.');
            }
            $checks = phCheckAll($c);
            $al = count($checks) > 1 ? phAlerts($c, 7 * 86400, 20) : ['err' => '', 'list' => []];
            $alerts = [];
            foreach (array_slice($al['list'], 0, 8) as $a) {
                [$why, $fix] = phErrWords($a['code']);
                $alerts[] = ['code' => $a['code'], 'at' => $a['at'], 'words' => $why, 'fix' => $fix, 'text' => $a['text']];
            }
            $sum = ['ok' => 0, 'improve' => 0, 'fix' => 0, 'info' => 0];
            foreach ($checks as $x) {
                $sev = (string) ($x['sev'] ?? ($x['ok'] === true ? 'ok' : ($x['ok'] === false ? 'fix' : 'info')));
                if (!isset($sum[$sev])) $sev = 'info';
                $sum[$sev]++;
            }
            audit('settings', 'Phone setup checked', 'phone', ['bad' => $sum['fix'], 'improve' => $sum['improve']], $u);
            ok(['checks' => $checks, 'sum' => $sum, 'alerts' => $alerts, 'alertsErr' => $al['err'], 'at' => now()]);

        case 'ph_me':
            // v39.1: also for an administrator who has not got the phone yet (the Phone button shows what is left to do)
            $u = requireUser();
            $me = phPublic($u);
            if (!$me) {
                phUser();
            }
            ok(['me' => $me, 'unseen' => $me['on'] ? phUnseen($u) : ['calls' => 0, 'texts' => 0]]);

        case 'ph_token':
            // the browser's pass to Twilio, for an hour (renewed before it runs out)
            $u = phUser();
            if (!phReady()) {
                fail(409, 'not_ready', 'The phone is not set up yet. An administrator connects it under Phone setup.');
            }
            if (throttleHit('phtok:' . $u['id'], 120, 3600)) {
                fail(429, 'rate_limited', 'Too many phone sign-ins in an hour. Reload the page in a few minutes.');
            }
            $c = phCfg(true);
            ok(['token' => phToken($c, phIdent($u['id'])), 'ttl' => 3600, 'ident' => phIdent($u['id'])]);

        case 'ph_avail':
            $u = phUser();
            $me = docGet('ph/x/me/' . $u['id']) ?? new stdClass();
            $me->avail = !empty($b['on']);
            $me->u = now();
            docSet('ph/x/me/' . $u['id'], $me);
            ok(['avail' => $me->avail]);

        case 'ph_cid':
            $u = phUser();
            $n = phNumber(phCfg(), str($b, 'n', 24));
            if (!phUsable($n, (string) $u['id'])) {
                fail(400, 'invalid_argument', phOwner($n) !== '' ? 'That number is someone else\'s personal line.' : 'Choose one of the company numbers.');
            }
            $me = docGet('ph/x/me/' . $u['id']) ?? new stdClass();
            $me->cid = (string) $n['n'];
            docSet('ph/x/me/' . $u['id'], $me);
            ok(['cid' => $me->cid]);

        case 'ph_seen':
            $u = phUser();
            $k = str($b, 'k', 8) === 'texts' ? 'texts' : 'calls';
            $s = docGet('ph/x/seen/' . $u['id']) ?? new stdClass();
            $s->$k = now();
            docSet('ph/x/seen/' . $u['id'], $s);
            ok(['ok' => true]);

        case 'ph_provider_call':
            $u = phUser(); $c = phCfg(true);
            if ($c['provider'] === 'twilio') fail(400, 'invalid_argument', 'Twilio calls use the native browser phone.');
            if ($c['provider'] === 'custom' && $c['providerCallPath'] === '') fail(409, 'not_ready', 'Add the provider call endpoint under Phone setup first.');
            // v83: the same toll-fraud rules as the Twilio browser call (phw_out): no emergency numbers, only the allowed
            // destinations (no premium or Caribbean numbers), and the per-person hourly limit, shared with phw_out
            $toRaw = str($b, 'to', 40);
            if (phIsEmergency($toRaw) && $c['e911'] !== 'allow') fail(400, 'invalid_argument', 'This phone cannot call emergency services. Dial from a mobile phone or a desk phone.');
            $to = phE164($toRaw, $c['region']); if ($to === '') fail(400, 'invalid_argument', 'Enter a valid phone number.');
            $why = phDestOk($to, $c); if ($why !== '') fail(400, 'invalid_argument', $why);
            if (throttleHit('phout:' . $u['id'], $c['perHour'], 3600)) fail(429, 'rate_limited', 'You have made the most calls allowed in an hour. Try again later.');
            $j = $c['provider'] === 'vitel' ? phVitelCall($c, $to) : phProviderRequest($c, $c['providerCallPath'], ['to'=>$to,'from'=>$c['providerFrom'],'reference'=>mb_substr((string)($b['ref']??''),0,80),'user'=>(string)$u['id']]);
            $id='c'.rid(8); $sid=(string)($j['id']??$j['sid']??$j['call_id']??'');
            phDb()->prepare("INSERT INTO ph_calls (id,sid,at,dir,num,other,od,uid,st,secs,rec,rsecs,vm,ref,tx,sum,note,data) VALUES (?,?,?,?,?,?,?,?,?,0,'',0,0,?,'','','',?)")->execute([$id,$sid,now(),'out',$c['providerFrom'],$to,phOd($to),$u['id'],'calling',mb_substr((string)($b['ref']??''),0,80),json_encode(['provider'=>$c['provider'],'response'=>$j],JSON_UNESCAPED_SLASHES)]);
            ok(['id'=>$id,'provider'=>$c['provider'],'status'=>(string)($j['status']??'requested')]);
        case 'ph_calls':
            $u = phUser();
            $all = !empty($b['all']) && hasRole($u, 'admin');
            [$w, $a] = phScope($u, $all);
            $f = str($b, 'f', 10);
            $where = [$w];
            if ($f === 'missed') {
                $where[] = "dir = 'in' AND st IN ('missed', 'voicemail')";
            } elseif ($f === 'vm') {
                $where[] = 'vm = 1';
            } elseif ($f === 'in' || $f === 'out') {
                $where[] = 'dir = ?';
                $a[] = $f;
            } elseif ($f === 'rec') {
                $where[] = "rec <> ''";
            }
            $od = phOd(str($b, 'od', 32));
            if ($od !== '') {
                $where[] = 'od = ?';
                $a[] = $od;
            }
            $q = trim(str($b, 'q', 60));
            if ($q !== '' && preg_match('/\d{3,}/', $q)) {
                $where[] = 'od LIKE ?';
                $a[] = '%' . substr((string) preg_replace('/\D+/', '', $q), -10) . '%';
            } elseif ($q !== '') {
                // a name: the numbers on the records this person may read with that name, the team member who took or
                // made the call, or the words in its note
                $like = '%' . str_replace(['%', '_'], '', $q) . '%';
                $or = ['note LIKE ?'];
                $oa = [$like];
                $kinds = phKindsFor($u);
                if ($kinds) {
                    phDirectory();
                    $s = phDb()->prepare('SELECT DISTINCT od FROM ph_dir WHERE name LIKE ? AND kind IN (' . implode(',', array_fill(0, count($kinds), '?')) . ') LIMIT 300');
                    $s->execute(array_merge([$like], $kinds));
                    $ods = $s->fetchAll(PDO::FETCH_COLUMN);
                    if ($ods) {
                        $or[] = 'od IN (' . implode(',', array_fill(0, count($ods), '?')) . ')';
                        $oa = array_merge($oa, $ods);
                    }
                }
                $s = db()->prepare('SELECT id FROM users WHERE name LIKE ? LIMIT 50');
                $s->execute([$like]);
                $uids = $s->fetchAll(PDO::FETCH_COLUMN);
                if ($uids) {
                    $or[] = 'uid IN (' . implode(',', array_fill(0, count($uids), '?')) . ')';
                    $oa = array_merge($oa, $uids);
                }
                $where[] = '(' . implode(' OR ', $or) . ')';
                $a = array_merge($a, $oa);
            }
            $pg = max(1, (int) ($b['pg'] ?? 1));
            $s = phDb()->prepare('SELECT * FROM ph_calls WHERE ' . implode(' AND ', $where) . ' ORDER BY at DESC LIMIT 51 OFFSET ' . (($pg - 1) * 50));
            $s->execute($a);
            $rows = $s->fetchAll();
            $more = count($rows) > 50;
            $rows = array_slice($rows, 0, 50);
            $names = phNames(array_column($rows, 'od'), $u);
            $people = phPeopleNames(array_column($rows, 'uid'));
            $list = array_map(fn($x) => phCallView($x, $names, $people), $rows);
            ok(['calls' => $list, 'more' => $more, 'pg' => $pg, 'unseen' => phUnseen($u)]);

        case 'ph_call':
            $u = phUser();
            $row = phCallBy('id', str($b, 'id', 30));
            if (!$row || !phCanSee($u, $row)) {
                fail(404, 'not_found', 'No such call.');
            }
            if (!empty(phCallData($row)['sumDue']) && aiReady()) {
                phSummarize((string) $row['id']);
                $row = phCallBy('id', (string) $row['id']) ?? $row;
            }
            $names = phNames([(string) $row['od']], $u);
            ok(['call' => phCallView($row, $names, phPeopleNames([(string) $row['uid']]), true), 'ai' => aiReady()]);

        case 'ph_note':
            // by the call's id, or (a call just made in the browser) by Twilio's CallSid
            $u = phUser();
            $id = str($b, 'id', 30);
            $sid = (string) preg_replace('/[^A-Za-z0-9]/', '', str($b, 'sid', 64));
            $row = $id !== '' ? phCallBy('id', $id) : ($sid !== '' ? phCallBy('sid', $sid) : null);
            if (!$row || !phCanSee($u, $row)) {
                fail(404, 'not_found', 'No such call.');
            }
            $f = ['note' => mb_substr(trim((string) ($b['note'] ?? '')), 0, 4000)];
            $ref = mb_substr((string) preg_replace('/[^A-Za-z0-9_:\-]/', '', (string) ($b['ref'] ?? '')), 0, 80);
            if ($ref !== '') {
                $f['ref'] = $ref;
            }
            phCallSet((string) $row['id'], $f);
            ok(['ok' => true, 'id' => (string) $row['id']]);

        case 'ph_summary':
            // writes the summary again (after the transcript is complete, or when it was not written)
            $u = phUser();
            $row = phCallBy('id', str($b, 'id', 30));
            if (!$row || !phCanSee($u, $row)) {
                fail(404, 'not_found', 'No such call.');
            }
            if (!aiReady()) {
                fail(409, 'not_ready', 'StratEdge AI is not set up (Admin › Website & messages › Assistant).');
            }
            phSummarize((string) $row['id']);
            $row = phCallBy('id', (string) $row['id']) ?? $row;
            ok(['call' => phCallView($row, phNames([(string) $row['od']], $u), phPeopleNames([(string) $row['uid']]), true)]);

        case 'ph_rec':
            // the recording, played through the portal (Twilio's link needs the keys)
            $u = phUser();
            $row = phCallBy('id', str($_GET + $b, 'id', 30));
            if (!$row || !phCanSee($u, $row) || (string) $row['rec'] === '' || !empty(phCallData($row)['recGone'])) {
                fail(404, 'not_found', 'This recording is not there any more.');
            }
            $c = phCfg(true);
            $url = phTwBase() . '/2010-04-01/Accounts/' . rawurlencode($c['sid']) . '/Recordings/' . rawurlencode((string) $row['rec']) . '.mp3';
            $ch = curl_init($url);
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 3, CURLOPT_USERPWD => $c['keySid'] . ':' . $c['keySecret']]);
            $audio = curl_exec($ch);
            $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            curl_close($ch);
            if ($audio === false || $code !== 200 || strlen((string) $audio) < 8) {
                fail(502, 'unavailable', 'Twilio did not send the recording (' . $code . ').');
            }
            $audio = (string) $audio;
            $len = strlen($audio);
            header_remove('Content-Type');
            header('Content-Type: audio/mpeg');
            header('Cache-Control: private, no-store');
            header('Accept-Ranges: bytes');
            if (preg_match('/^bytes=(\d*)-(\d*)$/', (string) ($_SERVER['HTTP_RANGE'] ?? ''), $m)) {
                $from = $m[1] === '' ? max(0, $len - (int) $m[2]) : (int) $m[1];
                $to = $m[1] !== '' && $m[2] !== '' ? min($len - 1, (int) $m[2]) : $len - 1;
                if ($from > $to || $from >= $len) {
                    http_response_code(416);
                    header('Content-Range: bytes */' . $len);
                    exit();
                }
                http_response_code(206);
                header('Content-Range: bytes ' . $from . '-' . $to . '/' . $len);
                header('Content-Length: ' . ($to - $from + 1));
                echo substr($audio, $from, $to - $from + 1);
                exit();
            }
            header('Content-Length: ' . $len);
            echo $audio;
            exit();

        case 'ph_rec_del':
            $u = phUser();
            $row = phCallBy('id', str($b, 'id', 30));
            if (!$row || !phCanSee($u, $row) || (string) $row['rec'] === '') {
                fail(404, 'not_found', 'No such recording.');
            }
            if (!hasRole($u, 'admin') && (string) $row['uid'] !== $u['id']) {
                fail(403, 'forbidden', 'Only the person on the call or an administrator can delete its recording.');
            }
            [$code, $j] = phApi('DELETE', 'Recordings/' . rawurlencode((string) $row['rec']) . '.json');
            if ($code !== 204 && $code !== 404) {
                fail(502, 'unavailable', phApiErr([$code, $j]));
            }
            $d = phCallData($row);
            $d['recGone'] = true;
            phCallSet((string) $row['id'], ['data' => json_encode($d)]);
            audit('data', 'Call recording deleted', (string) $row['id'], ['other' => (string) $row['other']], $u);
            ok(['ok' => true]);

        case 'ph_lookup':
            // who is calling (the incoming call card), or who a number belongs to
            $u = phUser();
            $od = phOd(str($b, 'n', 40));
            $names = phNames([$od], $u)[$od] ?? [];
            [$w, $a] = phScope($u, hasRole($u, 'admin'));
            $s = phDb()->prepare("SELECT COUNT(*) FROM ph_calls WHERE od = ? AND $w");
            $s->execute(array_merge([$od], $a));
            $o = phDb()->prepare('SELECT 1 FROM ph_optout WHERE od = ?');
            $o->execute([$od]);
            ok(['names' => $names, 'calls' => (int) $s->fetchColumn(), 'optout' => (bool) $o->fetchColumn()]);

        case 'ph_hist':
            // the calls and texts of a record's phone numbers (shown on the record)
            $u = phUser();
            $ods = array_values(array_unique(array_filter(array_map(fn($x) => phOd((string) $x), array_slice((array) ($b['phones'] ?? []), 0, 8)))));
            $ref = mb_substr((string) preg_replace('/[^A-Za-z0-9_:\-]/', '', (string) ($b['ref'] ?? '')), 0, 80);
            if (!$ods && $ref === '') {
                ok(['calls' => [], 'msgs' => []]);
            }
            [$w, $a] = phScope($u, hasRole($u, 'admin'));
            $cond = [];
            $args = [];
            if ($ods) {
                $cond[] = 'od IN (' . implode(',', array_fill(0, count($ods), '?')) . ')';
                $args = array_merge($args, $ods);
            }
            if ($ref !== '') {
                $cond[] = 'ref = ?';
                $args[] = $ref;
            }
            $s = phDb()->prepare('SELECT * FROM ph_calls WHERE (' . implode(' OR ', $cond) . ") AND $w ORDER BY at DESC LIMIT 30");
            $s->execute(array_merge($args, $a));
            $calls = $s->fetchAll();
            $msgs = [];
            if ($ods) {
                [$mw, $ma] = phMsgScope($u, hasRole($u, 'admin'));
                $s = phDb()->prepare('SELECT * FROM ph_msgs WHERE od IN (' . implode(',', array_fill(0, count($ods), '?')) . ") AND $mw ORDER BY at DESC LIMIT 30");
                $s->execute(array_merge($ods, $ma));
                $msgs = $s->fetchAll();
            }
            $people = phPeopleNames(array_merge(array_column($calls, 'uid'), array_column($msgs, 'uid')));
            ok(['calls' => array_map(fn($x) => phCallView($x, [], $people), $calls), 'msgs' => array_map(fn($m) => phMsgView($m, $people), $msgs)]);

        case 'ph_threads':
            // text conversations, newest first (one per number)
            $u = phUser();
            [$mw, $ma] = phMsgScope($u, !empty($b['all']));
            $s = phDb()->prepare("SELECT od, MAX(at) AS last, COUNT(*) AS n FROM ph_msgs WHERE $mw GROUP BY od ORDER BY last DESC LIMIT 100");
            $s->execute($ma);
            $th = $s->fetchAll();
            $seen = (int) (docGet('ph/x/seen/' . $u['id'])->texts ?? 0);
            $names = phNames(array_column($th, 'od'), $u);
            $out = [];
            $last = phDb()->prepare("SELECT * FROM ph_msgs WHERE od = ? AND $mw ORDER BY at DESC LIMIT 1");
            $unread = phDb()->prepare("SELECT COUNT(*) FROM ph_msgs WHERE od = ? AND dir = 'in' AND at > ? AND $mw");
            foreach ($th as $t) {
                $last->execute(array_merge([$t['od']], $ma));
                $m = $last->fetch();
                $unread->execute(array_merge([$t['od'], $seen], $ma));
                $out[] = ['od' => (string) $t['od'], 'other' => (string) $m['other'], 'num' => (string) $m['num'], 'at' => (int) $t['last'], 'n' => (int) $t['n'], 'last' => mb_substr((string) $m['body'], 0, 120), 'dir' => (string) $m['dir'], 'names' => $names[(string) $t['od']] ?? [], 'unread' => (int) $unread->fetchColumn()];
            }
            ok(['threads' => $out]);

        case 'ph_thread':
            $u = phUser();
            $od = phOd(str($b, 'od', 32));
            [$mw, $ma] = phMsgScope($u, !empty($b['all']));
            $s = phDb()->prepare("SELECT * FROM ph_msgs WHERE od = ? AND $mw ORDER BY at DESC LIMIT 200");
            $s->execute(array_merge([$od], $ma));
            $msgs = array_reverse($s->fetchAll());
            $o = phDb()->prepare('SELECT 1 FROM ph_optout WHERE od = ?');
            $o->execute([$od]);
            $people = phPeopleNames(array_column($msgs, 'uid'));
            ok(['msgs' => array_map(fn($m) => phMsgView($m, $people), $msgs), 'names' => phNames([$od], $u)[$od] ?? [], 'optout' => (bool) $o->fetchColumn()]);

        case 'ph_sms_send':
            $u = phUser();
            $c = phCfg(true);
            if (!phReady()) {
                fail(409, 'not_ready', 'The phone is not set up yet.');
            }
            $to = phE164(str($b, 'to', 40), $c['region']);
            $why = $to === '' ? 'That is not a phone number that can get texts.' : phDestOk($to, $c);
            if ($why !== '') {
                fail(400, 'invalid_argument', $why);
            }
            $body = trim(mb_substr((string) ($b['body'] ?? ''), 0, 1600));
            if ($body === '') {
                fail(400, 'invalid_argument', 'Write the message first.');
            }
            $o = phDb()->prepare('SELECT 1 FROM ph_optout WHERE od = ?');
            $o->execute([phOd($to)]);
            if ($o->fetchColumn()) {
                fail(409, 'opted_out', 'This person replied STOP, so texts cannot be sent to them until they reply START.');
            }
            // v39.2: never from someone else's personal line
            $ask = phNumber($c, str($b, 'from', 24));
            $owner = phOwner($ask);
            if ($owner !== '' && $owner !== (string) $u['id']) {
                fail(403, 'forbidden', 'That number is ' . (phPeopleNames([$owner])[$owner] ?? 'someone else') . '\'s personal line: only they text from it.');
            }
            $num = phFromFor($c, (string) $u['id'], str($b, 'from', 24), true);
            if (!$num) {
                fail(409, 'not_ready', 'No company number sends texts for you yet. An administrator switches texts on for a number under Phone setup.');
            }
            if (throttleHit('phsms:' . $u['id'], $c['smsPerHour'], 3600)) {
                fail(429, 'rate_limited', 'You have sent the most texts allowed in an hour. Try again later.');
            }
            if ($c['provider'] === 'twilio') {
                [$code, $j] = phApi('POST', 'Messages.json', ['To' => $to, 'From' => (string) $num['n'], 'Body' => $body, 'StatusCallback' => phHook('phw_smsst')], $c);
                if ($code !== 201 && $code !== 200) {
                    $m = is_array($j) ? (string) ($j['message'] ?? '') : '';
                    $ecode = is_array($j) ? (int) ($j['code'] ?? 0) : 0;
                    fail(502, 'unavailable', $ecode === 21610 ? 'This person replied STOP to your number, so Twilio does not deliver texts to them.' : ($ecode === 30034 || str_contains($m, '10DLC') ? 'Twilio blocked the text: the number is not registered for texting US phones yet (A2P 10DLC or toll-free verification).' : phApiErr([$code, $j])));
                }
            } elseif ($c['provider'] === 'vitel') {
                $j = phVitelSms($c, $to, (string) $num['n'], $body);
            } else {
                if ($c['providerSmsPath'] === '') fail(409, 'not_ready', 'Add the provider SMS endpoint under Phone setup first.');
                $j = phProviderRequest($c, $c['providerSmsPath'], ['to'=>$to,'from'=>(string)$num['n'],'text'=>$body,'reference'=>(string)($b['ref']??'')]);
            }
            $id = 'm' . rid(8);
            $ref = mb_substr((string) preg_replace('/[^A-Za-z0-9_:\-]/', '', (string) ($b['ref'] ?? '')), 0, 80);
            phDb()->prepare('INSERT INTO ph_msgs (id, sid, at, dir, num, other, od, uid, body, st, err, media, ref) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute([$id, (string) ($j['sid'] ?? ''), now(), 'out', (string) $num['n'], $to, phOd($to), $u['id'], $body, mb_substr((string) ($j['status'] ?? 'queued'), 0, 16), '', 0, $ref]);
            ok(['id' => $id, 'st' => (string) ($j['status'] ?? 'queued')]);

        /* ---------------- administrators: Phone setup ---------------- */
        case 'ph_cfg':
            $u = phAdmin();
            $c = phCfg();
            if ($c['central']) {
                // v83: StratEdge's inherited setup runs the phone here but is never shown in a workspace (README v82):
                // only what the "Who can use the phone" page needs (no account/key/app ids, ring lists or staff names)
                $c = [
                    'provider' => $c['provider'],
                    'providerLabel' => $c['providerLabel'],
                    'providerFrom' => $c['providerFrom'],
                    'ok' => $c['ok'],
                    'central' => true,
                    'numbers' => array_values(array_map(fn($n) => ['n' => (string) ($n['n'] ?? ''), 'label' => (string) ($n['label'] ?? ''), 'on' => true, 'sms' => !empty($n['sms'])], array_filter($c['numbers'], fn($n) => !empty($n['on']) && phOwner($n) === ''))),
                ];
            }
            $people = [];
            foreach (db()->query("SELECT id, name, email, role FROM users WHERE status = 'active' ORDER BY name") as $p) {
                if (phEligible((string) $p['id'])) {
                    $people[] = ['id' => (string) $p['id'], 'n' => (string) $p['name'], 'e' => (string) $p['email'], 'on' => grantOf((string) $p['id'], 'phone'), 'admin' => (string) $p['role'] === 'admin', 'avail' => (function ($uid) {
                        $me = docGet('ph/x/me/' . $uid);
                        return !isset($me->avail) || !empty($me->avail);
                    })((string) $p['id'])];
                }
            }
            ok(['cfg' => $c, 'ready' => phReady(), 'people' => $people, 'hooks' => ['voice' => phHook('phw_in'), 'app' => phHook('phw_out'), 'sms' => phHook('phw_sms'), 'status' => phHook('phw_status')], 'base' => phBase(), 'ai' => aiReady()]);

        case 'ph_cfg_save':
            $u = phAdmin();
            $patch = [];
            $secret = false;
            if (array_key_exists('sid', $b)) {
                $sid = trim(str($b, 'sid', 40));
                if ($sid !== '' && !preg_match('/^AC[0-9a-f]{32}$/', $sid)) {
                    fail(400, 'invalid_argument', 'The Account SID starts with AC and has 34 characters (Twilio console, Account info).');
                }
                $patch['sid'] = $sid;
            }
            if (array_key_exists('keySid', $b)) {
                $k = trim(str($b, 'keySid', 40));
                if ($k !== '' && !preg_match('/^SK[0-9a-f]{32}$/', $k)) {
                    fail(400, 'invalid_argument', 'The API key SID starts with SK and has 34 characters (Twilio console, API keys).');
                }
                $patch['keySid'] = $k;
            }
            require_once __DIR__ . '/mail.php';
            if (trim((string) ($b['keySecret'] ?? '')) !== '') {
                $v = trim((string) $b['keySecret']);
                if (!preg_match('/^[A-Za-z0-9]{20,64}$/', $v)) {
                    fail(400, 'invalid_argument', 'The API key secret is the long text Twilio showed once when the key was made.');
                }
                $patch['keySecret'] = mailSeal($v);
                $secret = true;
            }
            if (trim((string) ($b['token'] ?? '')) !== '') {
                $v = trim((string) $b['token']);
                if (!preg_match('/^[0-9a-f]{32}$/', $v)) {
                    fail(400, 'invalid_argument', 'The Auth Token has 32 letters and digits (Twilio console, Account info).');
                }
                $patch['token'] = mailSeal($v);
                $secret = true;
            }
            if ($secret || isset($patch['sid']) || isset($patch['keySid'])) {
                // the keys to the company's phone account: a recent sign-in, like the other outside services
                requireRecentAuth();
                $patch['ok'] = false;
            }
            if (array_key_exists('provider', $b)) {
                $patch['provider'] = in_array((string) $b['provider'], ['twilio','vitel','custom'], true) ? (string) $b['provider'] : 'twilio';
                requireRecentAuth();
            }
            foreach (['providerLabel'=>80,'providerBase'=>300,'providerCallPath'=>300,'providerSmsPath'=>300,'providerFrom'=>40] as $k=>$max) {
                if (array_key_exists($k,$b)) $patch[$k]=mb_substr(trim((string)$b[$k]),0,$max);
            }
            if (trim((string)($b['providerKey']??''))!=='') {
                $patch['providerKey']=mailSeal(mb_substr(trim((string)$b['providerKey']),0,4000)); $secret=true; requireRecentAuth();
            }
            foreach (['vitelUsername'=>190,'vitelDomain'=>80,'vitelExtension'=>40,'vitelLine'=>40] as $k=>$max) {
                if (array_key_exists($k, $b)) $patch[$k] = mb_substr(trim((string) $b[$k]), 0, $max);
            }
            if (trim((string)($b['vitelPassword']??'')) !== '') {
                $patch['vitelPassword'] = mailSeal(mb_substr((string)$b['vitelPassword'], 0, 4000)); $secret=true; requireRecentAuth();
            }
            foreach (['recOut', 'tx', 'sum', 'vmMail'] as $k) {
                if (array_key_exists($k, $b)) {
                    $patch[$k] = !empty($b[$k]);
                }
            }
            if (array_key_exists('notice', $b)) {
                $patch['notice'] = mb_substr(trim(str($b, 'notice', 300)), 0, 300) ?: 'This call may be recorded.';
            }
            if (array_key_exists('keepDays', $b)) {
                $patch['keepDays'] = max(0, min(3650, (int) $b['keepDays']));
            }
            if (array_key_exists('lang', $b)) {
                $patch['lang'] = phLangOk(str($b, 'lang', 16)) ? str($b, 'lang', 16) : 'auto'; // v68: 'auto' (any language) or a BCP-47 code
            }
            if (array_key_exists('e911', $b)) {
                $patch['e911'] = str($b, 'e911', 8) === 'allow' ? 'allow' : 'block';
            }
            if (array_key_exists('dest', $b)) {
                $patch['dest'] = array_values(array_intersect((array) $b['dest'], ['nanp', 'in', 'other'])) ?: ['nanp'];
            }
            if (array_key_exists('cc', $b)) {
                $patch['cc'] = mb_substr((string) preg_replace('/[^0-9, ]/', '', str($b, 'cc', 120)), 0, 120);
            }
            // Validate configurable REST-provider endpoints before they are persisted. This rejects loopback/private
            // destinations even when the administrator typed a hostname rather than a literal IP address.
            $candidateProvider = array_merge(phCfg(false), $patch);
            if (($candidateProvider['provider'] ?? 'twilio') === 'custom' && trim((string) ($candidateProvider['providerBase'] ?? '')) !== '') {
                if (trim((string) ($candidateProvider['providerCallPath'] ?? '')) !== '') phProviderUrl($candidateProvider, (string) $candidateProvider['providerCallPath']);
                if (trim((string) ($candidateProvider['providerSmsPath'] ?? '')) !== '') phProviderUrl($candidateProvider, (string) $candidateProvider['providerSmsPath']);
            }
            if (array_key_exists('region', $b)) {
                $patch['region'] = str($b, 'region', 4) === 'IN' ? 'IN' : 'US';
            }
            foreach (['perHour' => [5, 1000], 'smsPerHour' => [5, 2000]] as $k => [$lo, $hi]) {
                if (array_key_exists($k, $b)) {
                    $patch[$k] = max($lo, min($hi, (int) $b[$k]));
                }
            }
            phCfgSet($patch, $u);
            audit('settings', 'Phone settings changed', 'phone', ['fields' => array_values(array_diff(array_keys($patch), ['keySecret', 'token', 'providerKey', 'vitelPassword'])), 'keys' => $secret], $u);
            ok(['cfg' => phCfg(), 'ready' => phReady()]);

        case 'ph_vitel_check':
            $u = phAdmin(); $c = phCfg(true);
            if ($c['provider'] !== 'vitel') fail(409, 'not_ready', 'Choose VitelGlobal as the phone provider first.');
            if (throttleHit('phvitelcheck:' . $u['id'], 20, 3600)) fail(429, 'rate_limited', 'VitelGlobal was checked many times. Try again later.');
            $today = date('Y-m-d'); $rows = phVitelReportRows($c, $today, $today);
            ok(['ok'=>true,'message'=>'VitelGlobal credentials were accepted and the call-report API responded.','rows'=>count($rows),'ready'=>phReady()]);

        case 'ph_vitel_testcall':
            // v80: a click-to-call test from Phone setup. VitelGlobal rings the configured extension, then connects it
            // to the number entered here (usually the administrator's own phone), proving calling works end to end.
            $u = phAdmin(); $c = phCfg(true);
            if ($c['provider'] !== 'vitel') fail(409, 'not_ready', 'Choose VitelGlobal as the phone provider first.');
            if ($c['vitelUsername'] === '' || !$c['hasVitelPassword'] || $c['vitelExtension'] === '') fail(409, 'not_ready', 'Save the VitelGlobal username, password and extension first.');
            if (throttleHit('phviteltest:' . $u['id'], 10, 3600)) fail(429, 'rate_limited', 'That is a lot of test calls. Try again shortly.');
            $to = phE164(str($b, 'to', 40), $c['region']);
            if ($to === '') fail(400, 'invalid_argument', 'Enter the phone number to ring for the test (your own mobile is ideal).');
            $why = phDestOk($to, $c);
            if ($why !== '') fail(400, 'invalid_argument', $why);
            $j = phVitelCall($c, $to);
            audit('settings', 'VitelGlobal test call placed', 'phone', ['to' => phOd($to)], $u);
            ok(['ok'=>true,'status'=>(string)($j['status']??'requested'),'message'=>'VitelGlobal was asked to ring extension '.$c['vitelExtension'].' and connect it to '.$to.'. Answer the extension; it should then call that number.']);

        case 'ph_vitel_sync':
            $u = phAdmin(); $c = phCfg(true);
            if ($c['provider'] !== 'vitel') fail(409, 'not_ready', 'Choose VitelGlobal as the phone provider first.');
            if (throttleHit('phvitelsync:' . $u['id'], 30, 3600)) fail(429, 'rate_limited', 'VitelGlobal call reports were synced many times. Try again later.');
            $days=max(1,min(31,(int)($b['days']??7))); $end=date('Y-m-d'); $start=date('Y-m-d',time()-(($days-1)*86400));
            $rows=phVitelReportRows($c,$start,$end); $res=phVitelSyncRows($rows,$c,$u);
            audit('data','VitelGlobal call reports synced','phone',array_merge($res,['start'=>$start,'end'=>$end]),$u);
            ok(array_merge($res,['start'=>$start,'end'=>$end]));

        case 'ph_connect':
            // checks the keys, makes (or updates) the TwiML App the browsers call through, and lists the numbers
            $u = phAdmin();
            $c = phCfg(true);
            if ($c['sid'] === '' || $c['keySid'] === '' || $c['keySecret'] === '' || $c['token'] === '') {
                fail(400, 'invalid_argument', 'Enter the Account SID, the Auth Token and an API key (SID and secret) first.');
            }
            $acct = phApi('GET', '/2010-04-01/Accounts/' . rawurlencode($c['sid']) . '.json', [], $c);
            if ($acct[0] !== 200 || !is_array($acct[1])) {
                phCfgSet(['ok' => false], $u);
                fail(502, 'unavailable', phApiErr($acct));
            }
            if (($acct[1]['status'] ?? 'active') !== 'active') {
                fail(409, 'conflict', 'The Twilio account is ' . ($acct[1]['status'] ?? 'not active') . '.');
            }
            // v39.1: the Auth Token too (Twilio signs its requests with it: a wrong one makes every call end at once)
            $tok = phTokenCheck($c);
            if ($tok[0] === 401 || $tok[0] === 403) {
                phCfgSet(['ok' => false], $u);
                fail(400, 'invalid_argument', 'Twilio did not accept the Auth Token. Copy it again from the Twilio console (Account info on the dashboard); it is not the API key secret.');
            }
            $app = ['FriendlyName' => 'StratEdge portal phone', 'VoiceUrl' => phHook('phw_out'), 'VoiceMethod' => 'POST', 'StatusCallback' => phHook('phw_status'), 'StatusCallbackMethod' => 'POST'];
            $res = $c['app'] !== '' ? phApi('POST', 'Applications/' . rawurlencode($c['app']) . '.json', $app, $c) : [404, null];
            if ($res[0] === 404) {
                $res = phApi('POST', 'Applications.json', $app, $c);
            }
            if (!in_array($res[0], [200, 201], true) || !is_array($res[1]) || empty($res[1]['sid'])) {
                fail(502, 'unavailable', 'The TwiML App could not be made: ' . phApiErr($res));
            }
            phCfgSet(['ok' => true, 'okAt' => now(), 'app' => (string) $res[1]['sid'], 'appUrl' => phHook('phw_out'), 'acct' => mb_substr((string) ($acct[1]['friendly_name'] ?? ''), 0, 120)], $u);
            audit('settings', 'Phone connected to Twilio', 'phone', ['app' => (string) $res[1]['sid']], $u);
            ok(['cfg' => phCfg(), 'ready' => phReady()]);

        case 'ph_numbers':
            // the numbers on the Twilio account, with how the portal uses each
            $u = phAdmin();
            $c = phCfg(true);
            if (!$c['ok']) {
                fail(409, 'not_ready', 'Connect the Twilio account first.');
            }
            $res = phApi('GET', 'IncomingPhoneNumbers.json', ['PageSize' => 100], $c);
            if ($res[0] !== 200 || !is_array($res[1])) {
                fail(502, 'unavailable', phApiErr($res));
            }
            $out = [];
            foreach ((array) ($res[1]['incoming_phone_numbers'] ?? []) as $n) {
                $e = (string) ($n['phone_number'] ?? '');
                $mine = phNumber($c, $e);
                $out[] = ['n' => $e, 'sid' => (string) ($n['sid'] ?? ''), 'fn' => (string) ($n['friendly_name'] ?? ''), 'voice' => !empty($n['capabilities']['voice']), 'sms' => !empty($n['capabilities']['sms']), 'voiceUrl' => (string) ($n['voice_url'] ?? ''), 'portal' => $mine];
            }
            ok(['numbers' => $out, 'hooks' => ['voice' => phHook('phw_in'), 'sms' => phHook('phw_sms')]]);

        case 'ph_number_save':
            // a company number: on or off in the portal, its name, who it rings, voicemail, recording, texts
            $u = phAdmin();
            $c = phCfg(true);
            $e = str($b, 'n', 24);
            $sid = str($b, 'sid', 40);
            if (!preg_match('/^\+\d{8,15}$/', $e) || !preg_match('/^PN[0-9a-f]{32}$/', $sid)) {
                fail(400, 'invalid_argument', 'Choose a number from the Twilio account.');
            }
            $ring = array_values(array_filter(array_map('strval', (array) ($b['ring'] ?? [])), fn($x) => preg_match('/^u_[a-f0-9]{8,32}$/', $x) === 1));
            // v39.2: one person only (a personal line): it rings only them, and only they call and text from it
            $own = str($b, 'own', 40);
            if ($own !== '') {
                if (!preg_match('/^u_[a-f0-9]{8,32}$/', $own) || !phEligible($own) || !grantOf($own, 'phone')) {
                    fail(400, 'invalid_argument', 'Choose a person who has the phone for a personal line (give them the phone first).');
                }
                $ring = [$own];
            }
            $entry = [
                'n' => $e, 'sid' => $sid, 'on' => !empty($b['on']), 'label' => mb_substr(trim(str($b, 'label', 60)), 0, 60), 'ring' => array_slice($ring, 0, 50),
                'secs' => max(5, min(60, (int) ($b['secs'] ?? 25))), 'vm' => !array_key_exists('vm', $b) || !empty($b['vm']), 'greet' => mb_substr(trim(str($b, 'greet', 400)), 0, 400),
                'rec' => !empty($b['rec']), 'sms' => !empty($b['sms']),
                'lang' => phLangOk(str($b, 'lang', 16)) ? str($b, 'lang', 16) : '', // v68: the language callers to this number speak ('' = the account's)
            ];
            if ($own !== '') {
                $entry['own'] = $own;
                if ($entry['on']) {
                    // their new line is their caller ID (they can still pick a shared number)
                    $me = docGet('ph/x/me/' . $own) ?? new stdClass();
                    $me->cid = $e;
                    docSet('ph/x/me/' . $own, $me);
                }
            }
            if ($entry['on']) {
                $params = ['VoiceUrl' => phHook('phw_in'), 'VoiceMethod' => 'POST', 'StatusCallback' => phHook('phw_status'), 'StatusCallbackMethod' => 'POST'];
                if ($entry['sms']) {
                    $params['SmsUrl'] = phHook('phw_sms');
                    $params['SmsMethod'] = 'POST';
                }
                $res = phApi('POST', 'IncomingPhoneNumbers/' . rawurlencode($sid) . '.json', $params, $c);
                if ($res[0] !== 200) {
                    fail(502, 'unavailable', 'The number could not be pointed at the portal: ' . phApiErr($res));
                }
            }
            $nums = array_values(array_filter($c['numbers'], fn($x) => (string) ($x['n'] ?? '') !== $e));
            $nums[] = $entry;
            phCfgSet(['numbers' => $nums], $u);
            audit('settings', 'Phone number ' . ($entry['on'] ? 'set up' : 'switched off'), $e, ['label' => $entry['label'], 'rec' => $entry['rec'], 'sms' => $entry['sms'], 'rings' => $own !== '' ? 'personal line' : ($ring ? count($ring) : 'everyone'), 'own' => $own], $u);
            ok(['cfg' => phCfg(), 'ready' => phReady()]);

        case 'ph_grant':
            // the phone for one person (the same switch as Roles & access › Phone & texts)
            $u = phAdmin();
            $uid = str($b, 'uid', 40);
            if (!preg_match('/^u_[a-f0-9]{8,32}$/', $uid)) {
                fail(400, 'invalid_argument', 'Choose a person.');
            }
            if (!empty($b['on']) && !phEligible($uid)) {
                fail(400, 'invalid_argument', 'The company phone is for the company\'s own people, not client contacts or outside members.');
            }
            requireRecentAuth();
            $r = docGet('r/' . $uid) ?? new stdClass();
            if (!(($r->ft ?? null) instanceof stdClass)) {
                $r->ft = new stdClass();
            }
            $r->ft->phone = !empty($b['on']);
            docSet('r/' . $uid, $r);
            audit('access', 'Phone ' . (!empty($b['on']) ? 'switched on' : 'switched off'), $uid, [], $u);
            ok(['ok' => true]);
    }
    fail(404, 'not_found', 'Unknown action.');
}
