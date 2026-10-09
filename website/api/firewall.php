<?php
declare(strict_types=1);
/*
 * Spam and abuse firewall for the portal API.
 *
 * What it does, in order, on every request:
 *   1. Blocked network addresses get a 403 (manual blocks from Admin > Security, or automatic bans).
 *   2. Each address gets a per-minute request budget; the live-update poll ("batch") has its own larger budget.
 *   3. Public forms (contact, request talent, careers applications, registration, the assistant) are screened:
 *      honeypot field, time-to-fill, disposable or blocked email domains, blocked words, link count.
 *   4. Failed logins, rejected forms and over-limit requests count as strikes; enough strikes in an hour
 *      ban the address for a while. Allow-listed addresses are never limited or banned.
 *
 * Settings and the activity log live in the database (tables fw_kv, fw_block, fw_log) and are managed from
 * Admin > Security. Nothing here needs outside services.
 */

const FW_SCHEMA = 1;
const FW_DEFAULTS = [
    'enabled' => true,
    'api_per_min' => 600, // ordinary API calls per address per minute
    'poll_per_min' => 1200, // live-update polls per address per minute (one per open tab every few seconds)
    'form_per_hour' => 12, // public form submissions per address per hour
    'strikes' => 8, // strikes within an hour before an automatic ban
    'ban_min' => 60, // minutes an automatic ban lasts
    'honeypot' => true,
    'min_seconds' => 3, // a form filled faster than this is a bot
    'block_disposable' => true,
    'max_links' => 3, // links allowed in a message
    'words' => "casino\ncrypto giveaway\nseo services\nbacklinks\nbuy followers\nviagra\nloan approval\nguaranteed ranking\nadult dating",
    'domains' => '',
    'emails' => '',
    'allow' => '',
    'proxies' => '',
    'block_ips' => '',
    'countries' => '',
    'log_days' => 30,
];
const FW_DISPOSABLE = [
    'mailinator.com',
    'guerrillamail.com',
    'guerrillamail.net',
    '10minutemail.com',
    '10minutemail.net',
    'tempmail.com',
    'temp-mail.org',
    'throwawaymail.com',
    'yopmail.com',
    'yopmail.fr',
    'getnada.com',
    'dispostable.com',
    'trashmail.com',
    'fakeinbox.com',
    'maildrop.cc',
    'sharklasers.com',
    'mohmal.com',
    'tempr.email',
    'emailondeck.com',
    'mintemail.com',
    'spamgourmet.com',
    'mailnesia.com',
    'burnermail.io',
    'tmpmail.org',
    'moakt.com',
];
const FW_PUBLIC_FORMS = ['public_contact', 'register', 'chat', 'public_share', 'idq_send'];

function fwdb(): PDO
{
    static $ready = false;
    $pdo = db();
    if ($ready) {
        return $pdo;
    }
    $row = $pdo->query("SELECT v FROM meta WHERE k = 'fw_schema'")->fetch();
    $version = $row ? (int) $row['v'] : 0;
    if ($version < FW_SCHEMA) {
        $pdo->exec('CREATE TABLE IF NOT EXISTS fw_kv (k VARCHAR(40) PRIMARY KEY, v TEXT NOT NULL)');
        $pdo->exec('CREATE TABLE IF NOT EXISTS fw_block (k VARCHAR(190) PRIMARY KEY, kind VARCHAR(12) NOT NULL,
            until BIGINT NOT NULL, why VARCHAR(300) NOT NULL, at BIGINT NOT NULL, by_uid VARCHAR(40) NOT NULL)');
        $pdo->exec('CREATE TABLE IF NOT EXISTS fw_log (id VARCHAR(24) PRIMARY KEY, at BIGINT NOT NULL, ip VARCHAR(64) NOT NULL,
            route VARCHAR(40) NOT NULL, kind VARCHAR(16) NOT NULL, detail VARCHAR(400) NOT NULL)');
        foreach (['CREATE INDEX fw_log_at ON fw_log (at)', 'CREATE INDEX fw_log_ip ON fw_log (ip)'] as $sql) {
            try {
                $pdo->exec($sql);
            } catch (Throwable $e) {
                // index already there
            }
        }
        $pdo->exec("REPLACE INTO meta (k, v) VALUES ('fw_schema', " . FW_SCHEMA . ')');
    }
    $ready = true;
    return $pdo;
}

function fwSettings(bool $fresh = false): array
{
    static $c = null;
    if ($c !== null && !$fresh) {
        return $c;
    }
    $s = fwdb()
        ->query("SELECT v FROM fw_kv WHERE k = 'settings'")
        ->fetchColumn();
    $saved = $s ? json_decode((string) $s, true) : null;
    $c = array_merge(FW_DEFAULTS, is_array($saved) ? $saved : []);
    return $c;
}
function fwSaveSettings(array $in): array
{
    $cur = fwSettings();
    $num = fn($k, $min, $max) => max($min, min($max, (int) ($in[$k] ?? $cur[$k])));
    $text = fn($k, $max) => mb_substr(trim((string) ($in[$k] ?? $cur[$k])), 0, $max);
    $new = [
        'enabled' => !empty($in['enabled']),
        'api_per_min' => $num('api_per_min', 30, 5000),
        'poll_per_min' => $num('poll_per_min', 30, 5000),
        'form_per_hour' => $num('form_per_hour', 1, 500),
        'strikes' => $num('strikes', 2, 100),
        'ban_min' => $num('ban_min', 5, 1440),
        'honeypot' => !empty($in['honeypot']),
        'min_seconds' => $num('min_seconds', 0, 60),
        'block_disposable' => !empty($in['block_disposable']),
        'max_links' => $num('max_links', 0, 50),
        'words' => $text('words', 4000),
        'domains' => $text('domains', 4000),
        'emails' => $text('emails', 4000),
        'allow' => $text('allow', 2000),
        // v62: the proxies whose X-Forwarded-For is believed (addresses, prefixes or blocks; Cloudflare needs no entry)
        'proxies' => $text('proxies', 2000),
        'block_ips' => $text('block_ips', 4000),
        'countries' => $text('countries', 200),
        'log_days' => $num('log_days', 1, 365),
    ];
    fwdb()
        ->prepare('REPLACE INTO fw_kv (k, v) VALUES (?, ?)')
        ->execute(['settings', json_encode($new)]);
    fwSettings(true);
    return $new;
}
function fwLines(string $s): array
{
    return array_values(
        array_filter(array_map(fn($x) => strtolower(trim($x)), preg_split('/[\r\n,;]+/', $s) ?: []), fn($x) => $x !== ''),
    );
}
function fwIp(): string
{
    return clientIp();
}
/** v83: the browser says another web site made this request (a picture or link on someone else's page or in an email):
 *  it is refused or logged as usual, but it never bans or scores the visitor's address (a scanner sends no such header,
 *  a typed address sends 'none'; only GET pictures and links get this far, guardFetchMeta refuses every other kind). */
function fwCrossSite(): bool
{
    return strtolower((string) ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '')) === 'cross-site';
}
/** An address matches a list entry when equal, or when the entry is a prefix ending in a dot (e.g. 203.0.113.) or a CIDR block. */
function fwIpMatches(string $ip, array $list): bool
{
    foreach ($list as $e) {
        if ($e === $ip) {
            return true;
        }
        if (str_ends_with($e, '.') && str_starts_with($ip, $e)) {
            return true;
        }
        if (str_contains($e, '/') && fwCidr($ip, $e)) {
            return true;
        }
    }
    return false;
}
function fwCidr(string $ip, string $cidr): bool
{
    [$net, $bits] = explode('/', $cidr, 2);
    $bits = (int) $bits;
    $a = @inet_pton($ip);
    $b = @inet_pton($net);
    if ($a === false || $b === false || strlen($a) !== strlen($b)) {
        return false;
    }
    $bytes = intdiv($bits, 8);
    $rem = $bits % 8;
    if ($bytes && substr($a, 0, $bytes) !== substr($b, 0, $bytes)) {
        return false;
    }
    if ($rem) {
        $mask = 0xff << (8 - $rem) & 0xff;
        return (ord($a[$bytes]) & $mask) === (ord($b[$bytes]) & $mask);
    }
    return true;
}
function fwAllowed(string $ip): bool
{
    $c = fwSettings();
    return $ip === '127.0.0.1' || $ip === '::1' || fwIpMatches($ip, fwLines($c['allow']));
}
function fwLog(string $kind, string $detail, string $route = ''): void
{
    try {
        $r = $route !== '' ? $route : (string) ($GLOBALS['fwRoute'] ?? '');
        fwdb()
            ->prepare('INSERT INTO fw_log (id, at, ip, route, kind, detail) VALUES (?,?,?,?,?,?)')
            ->execute([rid(8), now(), mb_substr(fwIp(), 0, 64), mb_substr($r, 0, 40), $kind, mb_substr($detail, 0, 400)]);
        if (random_int(1, 50) === 1) {
            $days = (int) fwSettings()['log_days'];
            fwdb()
                ->prepare('DELETE FROM fw_log WHERE at < ?')
                ->execute([now() - $days * 86400000]);
        }
    } catch (Throwable $e) {
        // the log never blocks a request
    }
}
function fwBlocked(string $ip): ?array
{
    $c = fwSettings();
    if (fwIpMatches($ip, fwLines($c['block_ips']))) {
        return ['why' => 'Blocked address (Security settings)', 'until' => 0, 'auto' => false];
    }
    // v83: the exact address, then its IPv6 /64 (automatic bans are kept per /64), then the prefixes and CIDR blocks a
    // person added under Blocked addresses (those rows were stored but never matched before)
    $s = fwdb()->prepare('SELECT until, why, by_uid FROM fw_block WHERE k = ? AND kind = ?');
    foreach (array_values(array_unique([$ip, ipBucket($ip)])) as $k) {
        $s->execute([$k, 'ip']);
        $r = $s->fetch();
        if ($r && ((int) $r['until'] === 0 || (int) $r['until'] > now())) {
            // v83: 'auto' = banned by strikes, the attack score or the scanner trap (a person's block always names them)
            return ['why' => (string) $r['why'], 'until' => (int) $r['until'], 'auto' => (string) ($r['by_uid'] ?? '') === ''];
        }
    }
    $s = fwdb()->prepare("SELECT k, until, why, by_uid FROM fw_block WHERE kind = 'ip' AND (k LIKE '%/%' OR k LIKE '%.') AND (until = 0 OR until > ?)");
    $s->execute([now()]);
    foreach ($s->fetchAll() as $r) {
        if (fwIpMatches($ip, [(string) $r['k']])) {
            return ['why' => (string) $r['why'], 'until' => (int) $r['until'], 'auto' => (string) ($r['by_uid'] ?? '') === ''];
        }
    }
    return null;
}
function fwBlock(string $k, string $kind, int $minutes, string $why, string $by = ''): void
{
    fwdb()
        ->prepare('REPLACE INTO fw_block (k, kind, until, why, at, by_uid) VALUES (?,?,?,?,?,?)')
        ->execute([mb_substr($k, 0, 190), $kind, $minutes > 0 ? now() + $minutes * 60000 : 0, mb_substr($why, 0, 300), now(), $by]);
}
/** Records a strike against the address; enough of them within an hour ban it automatically. */
function fwStrike(string $kind, string $detail): void
{
    $c = fwSettings();
    $ip = fwIp();
    fwLog($kind, $detail);
    if (!$c['enabled'] || fwAllowed($ip) || fwCrossSite()) {
        return;
    }
    // v78: strikes also count towards the web application firewall's score for the address
    if (function_exists('wafStrike')) {
        wafStrike($kind);
    }
    $key = ipBucket($ip); // v83: an IPv6 /64 counts (and is banned) as one address
    if (throttleHit('fw:strike:' . $key, (int) $c['strikes'], 3600)) {
        fwBlock($key, 'ip', (int) $c['ban_min'], 'Automatic: repeated ' . $kind . ' problems');
        fwLog('ban', 'Banned for ' . $c['ban_min'] . ' minutes after repeated problems');
    }
}
/** Runs on every request. */
function fwGuard(string $route, string $method): void
{
    $GLOBALS['fwRoute'] = $route;
    $c = fwSettings();
    $ip = fwIp();
    if (!$c['enabled'] || fwAllowed($ip)) {
        return;
    }
    $b = fwBlocked($ip);
    // v83: an automatic ban (strikes, attack score, scanner trap) never stops someone already signed in: they are
    // accountable by name, and a ban caused by a decoy picture on another site must not lock the office out. Blocks a
    // person set (Security settings, Admin > Security, StratEdge AI) still apply to everyone.
    if ($b && (empty($b['auto']) || empty($_SESSION['uid']))) {
        header('Retry-After: 600');
        fail(403, 'blocked', 'Requests from this network address are blocked. If you think this is a mistake, email ' . (string) cfg('mail_from') . '.');
    }
    // People who are signed in are accountable by name, so only anonymous traffic is rate limited. This also saves a
    // database write on every portal request, which matters on shared hosting.
    if (!empty($_SESSION['uid'])) {
        return;
    }
    $c['api_per_min'] = max((int) $c['api_per_min'], 600);
    $c['poll_per_min'] = max((int) $c['poll_per_min'], 1200);
    $poll = $route === 'batch' || $route === 'jobs_tick' || $route === 'me';
    // v34: signed delivery events from mail and payment services arrive in bursts during a big campaign
    $hook = in_array($route, ['mail_webhook', 'mail_inbound', 'mail_postal_hook', 'mail_postal_inbound', 'mail_ses_hook', 'stripe_webhook', 'plaid_webhook'], true) || str_starts_with($route, 'phw_');
    $key = 'fw:' . ($hook ? 'hook' : ($poll ? 'poll' : 'api')) . ':' . ipBucket($ip);
    if (throttleHit($key, (int) ($hook ? max(6000, (int) $c['api_per_min']) : ($poll ? $c['poll_per_min'] : $c['api_per_min'])), 60)) {
        fwStrike('rate', 'Over the per-minute request budget (' . $route . ')');
        header('Retry-After: 30');
        fail(429, 'rate_limited', 'Too many requests from this network address. Wait a moment and try again.');
    }
    if ($method === 'POST' && in_array($route, FW_PUBLIC_FORMS, true) && !currentUser()) {
        if (throttleHit('fw:form:' . ipBucket($ip), (int) $c['form_per_hour'], 3600)) {
            fwStrike('rate', 'Over the hourly form budget (' . $route . ')');
            fail(429, 'rate_limited', 'Too many submissions from this network. Try again in an hour.');
        }
    }
}
/**
 * Screens a public form submission. Returns '' when it looks fine, otherwise a short reason; the caller
 * decides whether to reject it (a strike is recorded here).
 */
function fwScreen(array $b, string $kind): string
{
    $c = fwSettings();
    if (!$c['enabled'] || fwAllowed(fwIp())) {
        return '';
    }
    $why = '';
    if ($c['honeypot'] && trim((string) ($b['website'] ?? '')) !== '') {
        $why = 'honeypot field filled in';
    }
    $t0 = (int) ($b['t0'] ?? 0);
    if ($why === '' && $c['min_seconds'] > 0 && $t0 > 0 && now() - $t0 < $c['min_seconds'] * 1000) {
        $why = 'form sent in under ' . $c['min_seconds'] . ' seconds';
    }
    $email = strtolower(trim((string) ($b['email'] ?? ($b['e'] ?? ''))));
    if ($why === '' && $email !== '' && str_contains($email, '@')) {
        $dom = substr($email, strrpos($email, '@') + 1);
        if (in_array($email, fwLines($c['emails']), true)) {
            $why = 'blocked email address';
        } elseif (in_array($dom, fwLines($c['domains']), true)) {
            $why = 'blocked email domain ' . $dom;
        } elseif ($c['block_disposable'] && in_array($dom, FW_DISPOSABLE, true)) {
            $why = 'disposable email domain ' . $dom;
        }
        if ($why === '') {
            $s = fwdb()->prepare('SELECT until FROM fw_block WHERE k = ? AND kind = ?');
            $s->execute([$email, 'email']);
            $r = $s->fetch();
            if ($r && ((int) $r['until'] === 0 || (int) $r['until'] > now())) {
                $why = 'blocked email address';
            }
        }
    }
    $text = strtolower(implode(' ', array_map(fn($v) => is_string($v) ? $v : '', array_values($b))));
    if ($why === '' && $c['max_links'] >= 0) {
        $links = preg_match_all('#https?://|www\.#i', $text);
        if ($links > (int) $c['max_links']) {
            $why = $links . ' links in the message';
        }
    }
    if ($why === '') {
        foreach (fwLines($c['words']) as $w) {
            if ($w !== '' && str_contains($text, $w)) {
                $why = 'blocked phrase "' . $w . '"';
                break;
            }
        }
    }
    if ($why !== '') {
        fwStrike('spam', ucfirst($kind) . ' rejected: ' . $why);
    }
    return $why;
}
/** Admin > Security routes. */
function secRoute(string $r, array $b): never
{
    $me = requireUser();
    if (!hasRole($me, 'admin')) {
        fail(403, 'invalid_argument', 'Only an administrator can manage security settings.');
    }
    $pdo = fwdb();
    switch ($r) {
        case 'sec_save':
            $new = fwSaveSettings((array) ($b['settings'] ?? []));
            fwLog('settings', 'Security settings saved by ' . $me['name']);
            ok(['settings' => $new]);
        case 'sec_block':
            $k = strtolower(trim(str($b, 'k', 190)));
            $kind = str($b, 'kind', 10) === 'email' ? 'email' : 'ip';
            $min = max(0, min(525600, (int) ($b['minutes'] ?? 0)));
            if ($k === '' || ($kind === 'email' && !filter_var($k, FILTER_VALIDATE_EMAIL))) {
                fail(400, 'invalid_argument', $kind === 'email' ? 'Enter a valid email address.' : 'Enter a network address.');
            }
            if ($kind === 'ip' && !filter_var($k, FILTER_VALIDATE_IP) && !preg_match('#^[0-9a-f:.]+(/\d{1,3}|\.)$#', $k)) {
                fail(400, 'invalid_argument', 'Enter a network address like 203.0.113.9, a prefix like 203.0.113. or a block like 203.0.113.0/24.');
            }
            fwBlock($k, $kind, $min, str($b, 'why', 200) ?: 'Blocked by ' . $me['name'], $me['id']);
            fwLog('block', ucfirst($kind) . ' ' . $k . ' blocked by ' . $me['name'] . ($min ? ' for ' . $min . ' min' : ''));
            ok(['ok' => true]);
        case 'sec_unblock':
            $k = strtolower(trim(str($b, 'k', 190)));
            $pdo->prepare('DELETE FROM fw_block WHERE k = ?')->execute([$k]);
            throttleClear('fw:strike:' . $k);
            throttleClear('fw:strike:' . ipBucket($k));
            fwLog('unblock', $k . ' unblocked by ' . $me['name']);
            ok(['ok' => true]);
        case 'sec_clear':
            $pdo->exec('DELETE FROM fw_log');
            ok(['ok' => true]);
        case 'sec_test':
            // screens a sample submission with the current rules, without recording a strike
            $sample = ['name' => str($b, 'name', 100), 'email' => str($b, 'email', 190), 'message' => str($b, 'message', 2000), 't0' => now() - 20000];
            $c = fwSettings();
            $why = '';
            $email = strtolower($sample['email']);
            $dom = str_contains($email, '@') ? substr($email, strrpos($email, '@') + 1) : '';
            if ($dom !== '' && (in_array($dom, fwLines($c['domains']), true) || ($c['block_disposable'] && in_array($dom, FW_DISPOSABLE, true)))) {
                $why = 'blocked or disposable domain ' . $dom;
            } elseif (preg_match_all('#https?://|www\.#i', $sample['message']) > (int) $c['max_links']) {
                $why = 'too many links';
            } else {
                foreach (fwLines($c['words']) as $w) {
                    if ($w !== '' && str_contains(strtolower($sample['message'] . ' ' . $sample['name']), $w)) {
                        $why = 'blocked phrase "' . $w . '"';
                        break;
                    }
                }
            }
            ok(['ok' => $why === '', 'why' => $why]);
        default:
            $since = now() - 86400000;
            $counts = [];
            $s = $pdo->prepare('SELECT kind, COUNT(*) AS n FROM fw_log WHERE at > ? GROUP BY kind');
            $s->execute([$since]);
            while ($row = $s->fetch()) {
                $counts[$row['kind']] = (int) $row['n'];
            }
            $blocks = $pdo
                ->query('SELECT k, kind, until, why, at FROM fw_block ORDER BY at DESC LIMIT 500')
                ->fetchAll();
            $blocks = array_values(array_filter($blocks, fn($x) => (int) $x['until'] === 0 || (int) $x['until'] > now()));
            $log = $pdo
                ->query('SELECT at, ip, route, kind, detail FROM fw_log ORDER BY at DESC LIMIT 300')
                ->fetchAll();
            $top = $pdo->prepare(
                'SELECT ip, COUNT(*) AS n FROM fw_log WHERE at > ? GROUP BY ip ORDER BY n DESC LIMIT 12',
            );
            $top->execute([now() - 7 * 86400000]);
            ok([
                'settings' => fwSettings(),
                'counts' => $counts,
                'blocks' => $blocks,
                'log' => $log,
                'top' => $top->fetchAll(),
                'you' => fwIp(),
                // v62: how requests reach this site (direct, through Cloudflare, through a trusted proxy)
                'edge' => clientEdge() + ['server' => (string) ($_SERVER['SERVER_SOFTWARE'] ?? '')],
                'disposable' => count(FW_DISPOSABLE),
            ]);
    }
}
