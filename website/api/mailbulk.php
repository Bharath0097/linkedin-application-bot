<?php
declare(strict_types=1);
require_once __DIR__ . '/aws.php';
/*
 * v34: email at scale (Email › Sending setup and Email › Deliverability).
 *
 *  - Two more ways to send next to Mailgun: Amazon SES through its HTTPS API (signed with AWS Signature V4, raw MIME,
 *    parallel calls within the account's per-second rate) and Postal, the free open-source mail server you run on
 *    your own server ("your own Mailgun"), through its HTTP API.
 *  - Delivery events come back from all three: Postal webhooks (RSA-signed; checked against the key the server
 *    publishes), Amazon SES through SNS (signed messages; the subscription is confirmed automatically) and Mailgun's
 *    webhooks. Bounces and spam complaints stop future sends to that address and update the campaign, and a campaign
 *    whose bounce or complaint rate goes over the limit pauses itself before it hurts the domain's reputation.
 *  - Safety while sending: a warm-up schedule for a new server or IP, a cap per receiving domain per hour, a
 *    per-second rate, daily limits per team member, and a check that each receiving domain takes email at all.
 *  - Before sending: list cleaning (typos, throwaway domains, addresses that bounced before, domains without a mail
 *    server) and an inbox check of the message itself.
 *  - Deliverability: SPF, DKIM, DMARC, MX, reverse DNS and blocklists for the sending domain and server (DNS over
 *    HTTPS when the host's own lookups are switched off), and the bounce and complaint rates of the last 30 days
 *    against the limits Gmail, Yahoo and Microsoft set for bulk senders.
 */

// Daily caps for a new server or IP address (day 1 = the day warm-up was switched on); no cap after the last day.
const MAIL_WARMUP = [50, 100, 150, 250, 400, 600, 800, 1000, 1300, 1600, 2000, 2500, 3000, 3700, 4500, 5500, 6500, 8000, 10000, 12000, 15000, 18000, 22000, 27000, 33000, 40000, 50000, 60000, 75000, 100000];
// The SPF include each service needs on the sending domain (Amazon SES passes DMARC through DKIM instead).
const MAIL_SPF_INC = [
    'gmail' => '_spf.google.com',
    'workspace' => '_spf.google.com',
    'mailgun' => 'mailgun.org',
    'sendgrid' => 'sendgrid.net',
    'brevo' => 'spf.brevo.com',
];
// Where each service usually publishes its DKIM key (tried along with any selectors the administrator adds).
const MAIL_DKIM_SEL = [
    'workspace' => ['google'],
    'mailgun' => ['mx', 'k1', 'smtp', 'pic', 'krs', 'mailo', 'email'],
    'sendgrid' => ['s1', 's2'],
    'brevo' => ['mail', 'brevo1', 'brevo2'],
    'host' => ['default', 'x'],
    'smtp' => ['default', 'selector1', 'selector2', 'zmail'],
];
const MAIL_DKIM_COMMON = ['default', 'google', 'selector1', 'selector2', 'k1', 's1', 's2', 'mail', 'dkim'];
// IP blocklists (each answers its RFC 5782 test entry 127.0.0.2, which tells whether it can be asked from here)
const MAIL_DNSBL = [
    'zen.spamhaus.org' => 'Spamhaus ZEN',
    'b.barracudacentral.org' => 'Barracuda',
    'bl.spamcop.net' => 'SpamCop',
    'bl.mailspike.net' => 'Mailspike',
    'psbl.surriel.com' => 'PSBL',
];
// Domain blocklists, with the test name each one always lists
const MAIL_DOMBL = [
    'dbl.spamhaus.org' => ['Spamhaus DBL', 'dbltest.com'],
    'multi.surbl.org' => ['SURBL', 'test.surbl.org'],
];
const MAIL_SPAMMY = [
    'act now', 'click here', 'buy now', 'order now', 'limited time', 'risk-free', 'risk free', '100% free', 'no cost',
    'free money', 'cash bonus', 'you have won', 'you\'ve won', 'winner', 'congratulations', 'guaranteed', 'once in a lifetime',
    'double your', 'earn money', 'make money', 'extra income', 'work from home and earn', 'no obligation', 'special promotion',
    'this is not spam', 'not junk', 'lowest price', 'best price', 'call now', 'what are you waiting for', 'while supplies last',
    'miracle', 'incredible deal', 'dear friend', 'urgent!!', '$$$', 'viagra', 'casino', 'crypto giveaway',
];
const MAIL_PHISHY = ['verify your account', 'confirm your password', 'account has been suspended', 'login immediately', 'update your payment', 'reset your password now', 'unusual sign-in activity'];
const MAIL_SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'tiny.cc', 'rb.gy', 'shorte.st', 'adf.ly'];

/* ---------- DNS (the host's resolver, or DNS over HTTPS when lookups are switched off) ---------- */

const DNS_TYPE_NUM = ['A' => 1, 'NS' => 2, 'CNAME' => 5, 'PTR' => 12, 'MX' => 15, 'TXT' => 16, 'AAAA' => 28];

/**
 * Looks up a name. Returns the answers ([] when the name has none) or null when no lookup was possible.
 * MX answers are ['pri' => n, 'host' => name]; TXT answers are the joined strings; A/AAAA are addresses;
 * PTR/CNAME/NS are host names. SE_DOH_BASE (tests) sends every lookup to that DNS-over-HTTPS address.
 */
function dnsLookup(string $name, string $type): ?array
{
    static $memo = [];
    $name = rtrim(strtolower(trim($name)), '.');
    $type = strtoupper($type);
    $key = $type . ' ' . $name;
    if ($name === '' || !isset(DNS_TYPE_NUM[$type])) {
        return null;
    }
    if (array_key_exists($key, $memo)) {
        return $memo[$key];
    }
    $doh = (string) getenv('SE_DOH_BASE');
    $out = null;
    if ($doh === '' && function_exists('dns_get_record')) {
        $flag = ['A' => DNS_A, 'NS' => DNS_NS, 'CNAME' => DNS_CNAME, 'PTR' => DNS_PTR, 'MX' => DNS_MX, 'TXT' => DNS_TXT, 'AAAA' => DNS_AAAA][$type];
        $r = @dns_get_record($name, $flag);
        if (is_array($r)) {
            $out = [];
            foreach ($r as $x) {
                if (($x['type'] ?? '') !== $type) {
                    continue;
                }
                $out[] = match ($type) {
                    'A' => (string) ($x['ip'] ?? ''),
                    'AAAA' => (string) ($x['ipv6'] ?? ''),
                    'MX' => ['pri' => (int) ($x['pri'] ?? 0), 'host' => rtrim(strtolower((string) ($x['target'] ?? '')), '.')],
                    'TXT' => isset($x['entries']) && is_array($x['entries']) ? implode('', $x['entries']) : (string) ($x['txt'] ?? ''),
                    default => rtrim(strtolower((string) ($x['target'] ?? '')), '.'),
                };
            }
        }
    }
    if ($out === null) {
        $out = dnsOverHttps($name, $type, $doh);
    }
    return $memo[$key] = $out;
}
/** DNS over HTTPS (JSON): Cloudflare, then Google; or the test resolver. */
function dnsOverHttps(string $name, string $type, string $base = ''): ?array
{
    if (!function_exists('curl_init')) {
        return null;
    }
    $bases = $base !== '' ? [rtrim($base, '/')] : ['https://cloudflare-dns.com/dns-query', 'https://dns.google/resolve'];
    foreach ($bases as $b) {
        $ch = curl_init($b . '?name=' . rawurlencode($name) . '&type=' . $type);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 6, CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_HTTPHEADER => ['Accept: application/dns-json'], CURLOPT_FOLLOWLOCATION => false]);
        $resp = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        $j = $code === 200 ? json_decode((string) $resp, true) : null;
        if (!is_array($j) || !isset($j['Status'])) {
            continue;
        }
        if ((int) $j['Status'] === 3) {
            return []; // no such name
        }
        if ((int) $j['Status'] !== 0) {
            return null;
        }
        $out = [];
        foreach ((array) ($j['Answer'] ?? []) as $a) {
            if ((int) ($a['type'] ?? 0) !== DNS_TYPE_NUM[$type]) {
                continue;
            }
            $d = trim((string) ($a['data'] ?? ''));
            if ($type === 'TXT') {
                // "part one" "part two" -> part onepart two
                $d = preg_match_all('/"((?:[^"\\\\]|\\\\.)*)"/', $d, $m) ? implode('', array_map('stripcslashes', $m[1])) : $d;
                $out[] = $d;
            } elseif ($type === 'MX') {
                [$pri, $host] = array_pad(preg_split('/\s+/', $d, 2) ?: [], 2, '');
                $out[] = ['pri' => (int) $pri, 'host' => rtrim(strtolower($host), '.')];
            } elseif ($type === 'A' || $type === 'AAAA') {
                $out[] = $d;
            } else {
                $out[] = rtrim(strtolower($d), '.');
            }
        }
        return $out;
    }
    return null;
}
/** The registrable domain, roughly (mail.example.co.uk -> example.co.uk), for the DMARC fallback lookup. */
function dnsOrgDomain(string $dom): string
{
    $p = explode('.', $dom);
    $n = count($p);
    if ($n <= 2) {
        return $dom;
    }
    $keep = strlen($p[$n - 1]) === 2 && in_array($p[$n - 2], ['co', 'com', 'org', 'net', 'gov', 'ac', 'edu'], true) ? 3 : 2;
    return implode('.', array_slice($p, -$keep));
}
function dnsIsPublicIp(string $ip): bool
{
    return (bool) filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE);
}

/**
 * Does the domain accept email at all? Remembered for 30 days. true/false, or null when no lookup was possible.
 * A "null MX" (RFC 7505: MX 0 .) means the domain takes no email. $lookup = false only reads what is remembered.
 */
function mailDomainOk(string $dom, bool $lookup = true): ?bool
{
    $pdo = mdb();
    static $ready = false;
    if (!$ready) {
        $ready = true;
        $pdo->exec('CREATE TABLE IF NOT EXISTS mail_domains (domain VARCHAR(190) PRIMARY KEY, ok TINYINT NOT NULL, at BIGINT NOT NULL)');
    }
    $dom = strtolower(trim($dom));
    $s = $pdo->prepare('SELECT ok, at FROM mail_domains WHERE domain = ?');
    $s->execute([$dom]);
    if (($r = $s->fetch()) && (int) $r['at'] > now() - 30 * 86400000) {
        return (bool) $r['ok'];
    }
    if (!$lookup) {
        return null;
    }
    $mx = dnsLookup($dom, 'MX');
    if ($mx === null) {
        return null;
    }
    if ($mx) {
        $ok = (bool) array_filter($mx, fn($x) => ($x['host'] ?? '') !== '' && $x['host'] !== '.');
    } else {
        $a = dnsLookup($dom, 'A');
        if ($a === null) {
            return null;
        }
        $ok = (bool) $a || (bool) (dnsLookup($dom, 'AAAA') ?? []);
    }
    $pdo->prepare('DELETE FROM mail_domains WHERE domain = ?')->execute([$dom]);
    $pdo->prepare('INSERT INTO mail_domains (domain, ok, at) VALUES (?,?,?)')->execute([$dom, $ok ? 1 : 0, now()]);
    return $ok;
}

/* ---------- delivery safety settings ---------- */

/** Email › Deliverability › Delivery safety. */
function mailSafety(): array
{
    $s = mkvGet('safety', []);
    $s = is_array($s) ? $s : [];
    $caps = [];
    foreach ((array) ($s['caps'] ?? []) as $uid => $n) {
        if (is_string($uid) && $uid !== '') {
            $caps[$uid] = max(0, (int) $n);
        }
    }
    return [
        'warm' => !empty($s['warm']),
        'warmStart' => (int) ($s['warmStart'] ?? 0),
        'warmPace' => in_array($s['warmPace'] ?? '', ['careful', 'normal', 'fast'], true) ? (string) $s['warmPace'] : 'normal',
        'domHour' => max(0, (int) ($s['domHour'] ?? 0)),
        'bounceMax' => max(0.5, min(50.0, (float) ($s['bounceMax'] ?? 5))),
        'complaintMax' => max(0.05, min(5.0, (float) ($s['complaintMax'] ?? 0.3))),
        'clean' => !array_key_exists('clean', $s) || !empty($s['clean']),
        'userDay' => max(0, (int) ($s['userDay'] ?? 0)),
        'caps' => $caps,
    ];
}
/** Where warm-up stands today: on, day number, today's cap (0 = no cap) and the whole schedule. */
function mailWarmCap(?array $s = null): array
{
    $s = $s ?? mailSafety();
    $mult = ['careful' => 0.5, 'normal' => 1.0, 'fast' => 2.0][$s['warmPace']] ?? 1.0;
    $plan = array_map(fn($n) => (int) round($n * $mult), MAIL_WARMUP);
    if (!$s['warm'] || $s['warmStart'] <= 0) {
        return ['on' => false, 'day' => 0, 'cap' => 0, 'done' => false, 'days' => count($plan), 'plan' => $plan, 'pace' => $s['warmPace']];
    }
    $day = (int) floor((now() - $s['warmStart']) / 86400000) + 1;
    $done = $day > count($plan);
    return ['on' => true, 'day' => $day, 'cap' => $done ? 0 : $plan[max(0, $day - 1)], 'done' => $done, 'days' => count($plan), 'plan' => $plan, 'pace' => $s['warmPace'], 'start' => $s['warmStart']];
}
/** A team member's daily limit on mass-email recipients (0 = no limit). Administrators have none. */
function mailUserCap(array $u): int
{
    if (hasRole($u, 'admin')) {
        return 0;
    }
    $s = mailSafety();
    return (int) ($s['caps'][(string) $u['id']] ?? $s['userDay']);
}
/** Recipients queued by this person's campaigns in the last 24 hours (cancelled and skipped ones don't count). */
function mailUserUsed(string $uid): int
{
    $st = mdb()->prepare("SELECT COUNT(*) FROM mail_queue q JOIN mail_campaigns c ON c.id = q.campaign WHERE c.by_uid = ? AND c.created > ? AND q.status NOT IN ('cancelled', 'skipped')");
    $st->execute([$uid, now() - 86400000]);
    return (int) $st->fetchColumn();
}
/** The secret part of the delivery-event addresses given to Postal and Amazon SNS. */
function mailHookKey(): string
{
    $k = (string) mkvGet('hook_key', '');
    if ($k === '') {
        $k = rid(12);
        mkvSet('hook_key', $k);
    }
    return $k;
}
function mailHookUrl(string $route): string
{
    return siteUrl() . 'api/index.php?r=' . $route . '&k=' . mailHookKey();
}
/** Emails sent to each receiving domain since $since (for the per-domain hourly cap). */
function mailDomainCounts(int $since): array
{
    $st = mdb()->prepare("SELECT LOWER(SUBSTR(to_email, INSTR(to_email, '@') + 1)) AS d, COUNT(*) AS n FROM mail_log WHERE at > ? AND status IN ('sent', 'delivered', 'bounced', 'complained') GROUP BY LOWER(SUBSTR(to_email, INSTR(to_email, '@') + 1))");
    $st->execute([$since]);
    $out = [];
    foreach ($st->fetchAll() as $r) {
        $out[(string) $r['d']] = (int) $r['n'];
    }
    return $out;
}
/** Gives a big campaign room to be read and queued (up to 200,000 people) on hosts with small defaults. */
function mailRoom(): void
{
    $cur = trim((string) ini_get('memory_limit'));
    if ($cur !== '-1') {
        $n = (int) $cur;
        $u = strtolower(substr($cur, -1));
        $bytes = $u === 'g' ? $n * 1073741824 : ($u === 'm' ? $n * 1048576 : ($u === 'k' ? $n * 1024 : $n));
        if ($bytes < 512 * 1048576) {
            @ini_set('memory_limit', '512M');
        }
    }
    @set_time_limit(300);
}

/* ---------- sending engines: Amazon SES (HTTPS API) and Postal (your own server) ---------- */

/** One message as a complete RFC 5322 message, and everyone it goes to (Postal and Amazon SES take it as is). */
function mailRawMessage(array $c, array $m): array
{
    $to = strtolower(trim((string) ($m['to'] ?? '')));
    $cc = (string) ($m['cc'] ?? '');
    [$headers, $body] = buildMime(
        (string) (($m['from_name'] ?? '') ?: $c['from_name']),
        (string) $c['from'],
        $to,
        (string) ($m['name'] ?? ''),
        (string) ($m['subject'] ?? ''),
        (string) ($m['text'] ?? ''),
        (string) ($m['html'] ?? ''),
        $m['atts'] ?? [],
        (string) ($m['reply'] ?? ''),
        $cc,
        $m['headers'] ?? [],
    );
    $rcpts = [$to];
    foreach (explode(',', $cc) as $x) {
        $x = strtolower(trim($x));
        if ($x !== '' && filter_var($x, FILTER_VALIDATE_EMAIL) && !in_array($x, $rcpts, true)) {
            $rcpts[] = $x;
        }
    }
    return [$headers . "\r\n" . $body, $rcpts];
}

/* ---------- v41: Microsoft 365 through Microsoft Graph (the company mailbox, connected with Microsoft) ---------- */

/** The company mailbox's access token: kept for its hour, then renewed with the saved refresh token (Microsoft hands
 *  out a new one each time, which replaces the saved one). '' when the connection is gone. */
function m365Token(array $c, bool $fresh = false): string
{
    $t = mkvGet('m365_tok');
    if (!$fresh && is_array($t) && (int) ($t['exp'] ?? 0) > now() && (string) ($t['a'] ?? '') !== '' && (string) ($t['u'] ?? $c['user']) === $c['user']) {
        return mailUnseal((string) $t['a']);
    }
    require_once __DIR__ . '/sso.php';
    [$acc, $exp, $newRefresh, $err] = ssoRefresh('microsoft', (string) $c['pass'], MSSYS_SCOPES, $c['msApp'] ?? null);
    if ($acc === '') {
        mailLog('Microsoft 365: the mailbox could not be renewed: ' . $err);
        return '';
    }
    mkvSet('m365_tok', ['a' => mailSeal($acc), 'exp' => $exp, 'u' => $c['user']]);
    if ($newRefresh !== '' && empty($c['viaProvider'])) {
        $saved = mkvGet('settings', []);
        if (is_array($saved) && ($saved['provider'] ?? '') === 'm365') {
            $saved['pass'] = mailSeal($newRefresh);
            mkvSet('settings', $saved);
        }
    }
    return $acc;
}
/** One message as Graph's sendMail wants it: the whole MIME message, base64, sent as the connected mailbox. */
function m365Opts(array $c, array $m): array
{
    [$raw] = mailRawMessage($c, $m);
    require_once __DIR__ . '/sso.php';
    return [
        CURLOPT_URL => extUrl(GRAPH_API . 'me/sendMail'),
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => base64_encode($raw),
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . m365Token($c), 'Content-Type: text/plain', 'Accept: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 40,
        CURLOPT_CONNECTTIMEOUT => 10,
    ];
}
/** Reads Graph's answer: 202 is accepted; 'why' says what to do (addr, throttle, quota, account, temp). */
function m365Result($resp, int $code, string $cerr): array
{
    if ($code === 0 || $resp === false) {
        return ['ok' => false, 'err' => 'Could not reach Microsoft 365: ' . ($cerr !== '' ? $cerr : 'no response'), 'code' => 0, 'why' => 'temp'];
    }
    if ($code === 202 || $code === 200) {
        return ['ok' => true, 'err' => '', 'code' => $code, 'id' => '', 'why' => ''];
    }
    $j = json_decode((string) $resp, true);
    $ec = is_array($j) ? (string) ($j['error']['code'] ?? '') : '';
    $msg = is_array($j) ? (string) ($j['error']['message'] ?? '') : mb_substr(trim(strip_tags((string) $resp)), 0, 300);
    $why = 'account';
    if ($code === 429 || $ec === 'ApplicationThrottled' || $ec === 'ErrorExceededMessageLimit' || stripos($msg, 'throttl') !== false) {
        $why = 'throttle';
    } elseif ($code >= 500) {
        $why = 'temp';
    } elseif (in_array($ec, ['ErrorInvalidRecipients', 'ErrorInvalidRecipient', 'ErrorRecipientNotFound'], true)) {
        $why = 'addr';
    } elseif ($ec === 'ErrorQuotaExceeded' || $ec === 'ErrorSubmissionQuotaExceeded') {
        $why = 'quota';
    }
    $hint = $code === 401 ? ' Connect the mailbox again under Email › Sending setup.' : ($ec === 'ErrorSendAsDenied' ? ' The From address must be the connected mailbox (or one it may send as).' : '');
    return ['ok' => false, 'err' => 'Microsoft 365 said: ' . ($ec !== '' ? $ec . ': ' : '') . mb_substr($msg !== '' ? $msg : 'HTTP ' . $code, 0, 300) . $hint, 'code' => $code, 'why' => $why];
}

/** Amazon SES API address for the account's region (SE_SES_BASE points tests at a stand-in). */
function sesBase(array $c): string
{
    $o = (string) getenv('SE_SES_BASE');
    return $o !== '' ? rtrim($o, '/') : 'https://email.' . $c['region'] . '.amazonaws.com';
}
/** A signed Amazon SES API v2 request as curl options. */
function sesOpts(array $c, string $method, string $path, string $query = '', ?string $body = null, int $timeout = 30): array
{
    $url = sesBase($c) . $path . ($query !== '' ? '?' . $query : '');
    $hdr = awsSign($method, $url, (string) $c['region'], 'ses', (string) $c['user'], (string) $c['pass'], $body !== null ? ['content-type' => 'application/json'] : [], hash('sha256', $body ?? ''));
    $hdr[] = 'Expect:';
    $o = [CURLOPT_URL => $url, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => $hdr, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_FOLLOWLOCATION => false];
    if ($body !== null) {
        $o[CURLOPT_POSTFIELDS] = $body;
    }
    return $o;
}
/** SendEmail (raw content) for one message. Tags carry the kind of email and the campaign for delivery events. */
function sesSendOpts(array $c, array $m): array
{
    [$raw, $rcpts] = mailRawMessage($c, $m);
    $tag = fn($v) => mb_substr((string) preg_replace('/[^A-Za-z0-9_-]/', '_', (string) $v), 0, 250);
    $tags = [['Name' => 'kind', 'Value' => $tag(($m['kind'] ?? '') ?: 'portal')]];
    if (!empty($m['ref'])) {
        $tags[] = ['Name' => 'campaign', 'Value' => $tag($m['ref'])];
    }
    $req = [
        'FromEmailAddress' => (string) $c['from'],
        'Destination' => ['ToAddresses' => [$rcpts[0]]] + (count($rcpts) > 1 ? ['CcAddresses' => array_slice($rcpts, 1)] : []),
        'Content' => ['Raw' => ['Data' => base64_encode($raw)]],
        'EmailTags' => $tags,
    ];
    if (($c['cset'] ?? '') !== '') {
        $req['ConfigurationSetName'] = (string) $c['cset'];
    }
    return sesOpts($c, 'POST', '/v2/email/outbound-emails', '', (string) json_encode($req, JSON_UNESCAPED_SLASHES));
}
/** Reads an Amazon SES answer. 'why' says what to do: addr (this address), throttle, quota, account, temp. */
function sesResult($resp, int $code, string $cerr, array $hdrs): array
{
    if ($code === 0 || $resp === false) {
        return ['ok' => false, 'err' => 'Could not reach Amazon SES: ' . ($cerr !== '' ? $cerr : 'no response'), 'code' => 0, 'why' => 'temp'];
    }
    $j = json_decode((string) $resp, true);
    if ($code >= 200 && $code < 300) {
        return ['ok' => true, 'err' => '', 'code' => $code, 'id' => (string) ($j['MessageId'] ?? ''), 'why' => ''];
    }
    $type = (string) ($hdrs['x-amzn-errortype'] ?? '');
    if ($type === '' && is_array($j)) {
        $type = (string) ($j['__type'] ?? ($j['code'] ?? ($j['Code'] ?? '')));
    }
    $type = (string) preg_replace('/^.*#/', '', (string) preg_replace('/:.*$/', '', $type));
    $msg = is_array($j) ? (string) ($j['message'] ?? ($j['Message'] ?? '')) : '';
    $msg = $msg !== '' ? $msg : mb_substr(trim(strip_tags((string) $resp)), 0, 300);
    $err = 'Amazon SES said: ' . ($type !== '' ? $type . ': ' : '') . mb_substr($msg !== '' ? $msg : 'HTTP ' . $code, 0, 300);
    $why = 'account';
    if ($code >= 500) {
        $why = 'temp';
    } elseif ($type === 'TooManyRequestsException' || $type === 'Throttling' || $code === 429) {
        $why = stripos($msg, 'daily') !== false || stripos($msg, '24 hour') !== false ? 'quota' : 'throttle';
    } elseif ($type === 'LimitExceededException') {
        $why = 'quota';
    } elseif ($type === 'BadRequestException' && preg_match('/address|recipient|domain|missing final|illegal/i', $msg) && !preg_match('/from|source|sender/i', $msg)) {
        $why = 'addr';
    }
    return ['ok' => false, 'err' => $err, 'code' => $code, 'why' => $why, 'type' => $type];
}
/** The SES account: sandbox or production, the 24-hour quota and the per-second rate. Remembered for the pages. */
function sesAccount(array $c): array
{
    $ch = curl_init();
    $hd = [];
    curl_setopt_array($ch, sesOpts($c, 'GET', '/v2/email/account', '', null, 20) + [CURLOPT_HEADERFUNCTION => function ($h, $line) use (&$hd) {
        $p = strpos($line, ':');
        if ($p !== false) {
            $hd[strtolower(trim(substr($line, 0, $p)))] = trim(substr($line, $p + 1));
        }
        return strlen($line);
    }]);
    $resp = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $cerr = curl_error($ch);
    curl_close($ch);
    if ($code !== 200) {
        $r = sesResult($resp, $code, $cerr, $hd);
        return ['ok' => false, 'err' => $r['err']];
    }
    $j = json_decode((string) $resp, true) ?: [];
    $q = (array) ($j['SendQuota'] ?? []);
    $out = [
        'ok' => true,
        'at' => now(),
        'production' => !empty($j['ProductionAccessEnabled']),
        'enabled' => !array_key_exists('SendingEnabled', $j) || !empty($j['SendingEnabled']),
        'status' => (string) ($j['EnforcementStatus'] ?? ''),
        'max24' => (int) ($q['Max24HourSend'] ?? 0),
        'rate' => (float) ($q['MaxSendRate'] ?? 0),
        'sent24' => (int) ($q['SentLast24Hours'] ?? 0),
    ];
    mkvSet('ses_account', $out);
    return $out;
}

/** Postal's send-raw call for one message. The X-Postal-Tag header carries the campaign for delivery events. */
function postalOpts(array $c, array $m): array
{
    [$raw, $rcpts] = mailRawMessage($c, $m);
    $body = json_encode(['mail_from' => (string) $c['from'], 'rcpt_to' => $rcpts, 'data' => base64_encode($raw)], JSON_UNESCAPED_SLASHES);
    return [
        CURLOPT_URL => rtrim((string) $c['host'], '/') . '/api/v1/send/raw',
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json', 'X-Server-API-Key: ' . $c['pass'], 'Expect:'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_FOLLOWLOCATION => false,
    ];
}
function postalResult($resp, int $code, string $cerr): array
{
    if ($code === 0 || $resp === false) {
        return ['ok' => false, 'err' => 'Could not reach your Postal server: ' . ($cerr !== '' ? $cerr : 'no response'), 'code' => 0, 'why' => 'temp'];
    }
    $j = json_decode((string) $resp, true);
    if (!is_array($j)) {
        return ['ok' => false, 'err' => 'Postal answered HTTP ' . $code . ' without a usable reply. Check the server address.', 'code' => $code, 'why' => $code === 429 ? 'throttle' : ($code >= 500 ? 'temp' : 'account')];
    }
    if (($j['status'] ?? '') === 'success') {
        return ['ok' => true, 'err' => '', 'code' => $code, 'id' => (string) ($j['data']['message_id'] ?? ''), 'why' => ''];
    }
    $pc = (string) ($j['data']['code'] ?? '');
    $msg = (string) ($j['data']['message'] ?? ($j['message'] ?? 'Postal refused the message.'));
    $why = in_array($pc, ['ValidationError', 'NoRecipients', 'TooManyToAddresses', 'InvalidRecipient'], true) ? 'addr' : ($code === 429 ? 'throttle' : ($code >= 500 ? 'temp' : 'account'));
    return ['ok' => false, 'err' => 'Postal said: ' . ($pc !== '' ? $pc . ': ' : '') . mb_substr($msg, 0, 300), 'code' => $code, 'why' => $why, 'type' => $pc];
}

/** curl options for one message on the API transport in use (Mailgun, Postal or Amazon SES). */
function mailApiOpts(array $c, array $m): array
{
    if ($c['provider'] === 'm365') {
        return m365Opts($c, $m);
    }
    if ($c['provider'] === 'postal') {
        return postalOpts($c, $m);
    }
    if ($c['provider'] === 'ses_api') {
        return sesSendOpts($c, $m);
    }
    return mailgunCurlParts($c, mailgunFields($c, $m))['opts'];
}
function mailApiResult(array $c, $resp, int $code, string $cerr, array $hdrs): array
{
    if ($c['provider'] === 'm365') {
        return m365Result($resp, $code, $cerr);
    }
    if ($c['provider'] === 'postal') {
        return postalResult($resp, $code, $cerr);
    }
    if ($c['provider'] === 'ses_api') {
        return sesResult($resp, $code, $cerr, $hdrs);
    }
    $r = mailgunResult($resp, $code, $cerr);
    $r['why'] = $r['ok'] ? '' : ($code === 400 ? 'addr' : ($code === 429 ? 'throttle' : ($code === 0 || $code >= 500 ? 'temp' : 'account')));
    return $r;
}
/**
 * Sends several messages over parallel connections, $parallel at a time, keeping under $rate messages a second when
 * set. Returns one result per key: ok, err, code, id, why (addr | throttle | quota | account | temp).
 */
function mailApiSendMany(array $c, array $msgs, int $parallel = 8, float $rate = 0.0): array
{
    $out = [];
    foreach (array_chunk($msgs, max(1, $parallel), true) as $chunk) {
        $t0 = microtime(true);
        $mh = curl_multi_init();
        $hs = [];
        $hd = [];
        foreach ($chunk as $k => $m) {
            $h = curl_init();
            $hd[$k] = [];
            $opts = mailApiOpts($c, $m);
            $opts[CURLOPT_HEADERFUNCTION] = function ($ch, $line) use (&$hd, $k) {
                $p = strpos($line, ':');
                if ($p !== false) {
                    $hd[$k][strtolower(trim(substr($line, 0, $p)))] = trim(substr($line, $p + 1));
                }
                return strlen($line);
            };
            curl_setopt_array($h, $opts);
            curl_multi_add_handle($mh, $h);
            $hs[$k] = $h;
        }
        do {
            $st = curl_multi_exec($mh, $running);
            if ($running) {
                curl_multi_select($mh, 1.0);
            }
        } while ($running && $st === CURLM_OK);
        foreach ($hs as $k => $h) {
            $code = (int) curl_getinfo($h, CURLINFO_RESPONSE_CODE);
            $resp = curl_multi_getcontent($h);
            $out[$k] = mailApiResult($c, $code === 0 ? false : $resp, $code, curl_error($h), $hd[$k]);
            curl_multi_remove_handle($mh, $h);
            curl_close($h);
        }
        curl_multi_close($mh);
        if ($rate > 0) {
            $min = count($chunk) / $rate;
            $took = microtime(true) - $t0;
            if ($took < $min) {
                usleep((int) (($min - $took) * 1000000));
            }
        }
    }
    return $out;
}
function mailApiSend(array $c, array $m): array
{
    return mailApiSendMany($c, ['one' => $m], 1)['one'];
}

/* ---------- delivery events: delivered, bounced, complained, delayed, unsubscribed ---------- */

/**
 * One delivery event from the sending service. Finds the campaign recipient it belongs to (by the queue token, the
 * campaign, or the newest send to that address), moves it on (sent -> delivered / bounced / complained), keeps the
 * campaign's counts, stops future sends after a bounce or complaint, and lets the campaign guard pause a campaign
 * that bounces or draws complaints over the limit.
 */
function mailEvent(string $email, string $type, string $why = '', string $camp = '', string $src = '', string $tok = ''): void
{
    $email = strtolower(trim($email));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return;
    }
    $pdo = mdb();
    $row = null;
    if ($tok !== '' && preg_match('/^[a-f0-9]{32}$/', $tok)) {
        $st = $pdo->prepare('SELECT id, campaign, status FROM mail_queue WHERE tok = ? AND email = ?');
        $st->execute([$tok, $email]);
        $row = $st->fetch() ?: null;
    }
    if (!$row && preg_match('/^[a-f0-9]{16}$/', $camp)) {
        $st = $pdo->prepare('SELECT id, campaign, status FROM mail_queue WHERE campaign = ? AND email = ? LIMIT 1');
        $st->execute([$camp, $email]);
        $row = $st->fetch() ?: null;
    }
    if (!$row) {
        $st = $pdo->prepare("SELECT id, campaign, status FROM mail_queue WHERE email = ? AND status IN ('sent', 'delivered') AND at > ? ORDER BY at DESC LIMIT 1");
        $st->execute([$email, now() - 30 * 86400000]);
        $row = $st->fetch() ?: null;
    }
    $why = mb_substr(trim((string) preg_replace('/\s+/', ' ', $why)), 0, 300);
    if ($type === 'delivered') {
        if ($row && $row['status'] === 'sent') {
            $u = $pdo->prepare("UPDATE mail_queue SET status = 'delivered' WHERE id = ? AND status = 'sent'");
            $u->execute([$row['id']]);
            if ($u->rowCount() === 1) {
                $pdo->prepare('UPDATE mail_campaigns SET delivered = delivered + 1 WHERE id = ?')->execute([$row['campaign']]);
            }
        }
        $l = $pdo->prepare("SELECT id FROM mail_log WHERE to_email = ? AND status = 'sent' AND at > ? ORDER BY at DESC LIMIT 1");
        $l->execute([$email, now() - 7 * 86400000]);
        if ($id = $l->fetchColumn()) {
            $pdo->prepare("UPDATE mail_log SET status = 'delivered' WHERE id = ?")->execute([$id]);
        }
    } elseif ($type === 'bounced' || $type === 'complained') {
        require_once __DIR__ . '/tools.php';
        mailAddrBounced($email, $type === 'complained' ? 'Spam complaint' . ($why !== '' ? ' (' . $why . ')' : '') : ($why !== '' ? $why : 'Bounced'), $src !== '' ? $src : 'events');
        if ($row && in_array($row['status'], ['sent', 'delivered'], true)) {
            $u = $pdo->prepare("UPDATE mail_queue SET status = ?, err = ? WHERE id = ? AND status IN ('sent', 'delivered')");
            $u->execute([$type, $type === 'complained' ? 'Marked as spam' : mb_substr($why !== '' ? $why : 'Bounced', 0, 500), $row['id']]);
            if ($u->rowCount() === 1) {
                $pdo->prepare('UPDATE mail_campaigns SET ' . $type . ' = ' . $type . ' + 1' . ($row['status'] === 'delivered' ? ', delivered = delivered - 1' : '') . ' WHERE id = ?')->execute([$row['campaign']]);
                mailCampaignGuard((string) $row['campaign']);
            }
        } elseif ($row && $row['status'] === 'bounced' && $type === 'complained') {
            // already counted as a bounce; the suppression above is what matters
        }
    } elseif ($type === 'soft') {
        if ($row && $row['status'] === 'sent') {
            $pdo->prepare('UPDATE mail_queue SET err = ? WHERE id = ?')->execute([mb_substr('Delayed: ' . ($why !== '' ? $why : 'the receiving server asked to try later'), 0, 500), $row['id']]);
        }
    } elseif ($type === 'unsub') {
        $pdo->prepare('REPLACE INTO mail_suppress (email, at, why) VALUES (?, ?, ?)')->execute([$email, now(), 'unsubscribed']);
    }
}
/** Remembers the last event each service sent, so the setup page can show the webhooks are working. */
function mailHookSeen(string $src, string $what): void
{
    $seen = mkvGet('hook_seen', []);
    $seen = is_array($seen) ? $seen : [];
    $prev = (array) ($seen[$src] ?? []);
    $seen[$src] = ['at' => now(), 'what' => mb_substr($what, 0, 160), 'n' => (int) ($prev['n'] ?? 0) + 1];
    mkvSet('hook_seen', $seen);
}
function mailCampaignMeta(array $c): array
{
    $m = json_decode((string) ($c['meta'] ?? ''), true);
    return is_array($m) ? $m : [];
}
function mailCampaignMetaSet(string $id, array $meta): void
{
    mdb()->prepare('UPDATE mail_campaigns SET meta = ? WHERE id = ?')->execute([json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $id]);
}
/**
 * Pauses a sending campaign whose bounce or complaint rate is over the limit (Email › Deliverability › Delivery
 * safety). Counts start again from where they were when someone resumed it. Returns the reason, or ''.
 */
function mailCampaignGuard(string $id): string
{
    $c = mailCampaignGet($id);
    if (!$c || !in_array($c['status'], ['queued', 'sending'], true)) {
        return '';
    }
    $s = mailSafety();
    $meta = mailCampaignMeta($c);
    $from = (array) ($meta['guardFrom'] ?? []);
    $base = (int) $c['sent'] + (int) $c['failed'] - (int) ($from['base'] ?? 0);
    $bnc = (int) $c['bounced'] + (int) $c['failed'] - (int) ($from['bnc'] ?? 0);
    $cmp = (int) $c['complained'] - (int) ($from['cmp'] ?? 0);
    $why = '';
    if ($base >= 100 && $bnc * 100 / $base > $s['bounceMax']) {
        $why = sprintf('%s%% of %s emails bounced (the limit is %s%%)', rtrim(rtrim(number_format($bnc * 100 / $base, 1), '0'), '.'), number_format($base), rtrim(rtrim(number_format($s['bounceMax'], 2), '0'), '.'));
    } elseif ($base >= 300 && $cmp * 100 / $base > $s['complaintMax']) {
        $why = sprintf('%s people marked it as spam out of %s (%s%%; the limit is %s%%)', number_format($cmp), number_format($base), rtrim(rtrim(number_format($cmp * 100 / $base, 2), '0'), '.'), rtrim(rtrim(number_format($s['complaintMax'], 2), '0'), '.'));
    }
    if ($why === '') {
        return '';
    }
    $u = mdb()->prepare("UPDATE mail_campaigns SET status = 'paused', note = ? WHERE id = ? AND status IN ('queued', 'sending')");
    $u->execute(['Paused automatically: ' . $why . '. Clean the list (Check & bounces), then resume.', $id]);
    if ($u->rowCount() !== 1) {
        return '';
    }
    $meta['auto'] = ['at' => now(), 'why' => $why];
    mailCampaignMetaSet($id, $meta);
    mailLog("Campaign $id paused automatically: $why");
    try {
        $owner = userRow((string) $c['by_uid']);
        if ($owner && filter_var((string) $owner['email'], FILTER_VALIDATE_EMAIL)) {
            $roles = rolesOf($owner);
            $sp = in_array('admin', $roles, true) ? 'admin/mail' : (in_array('hr', $roles, true) ? 'hr/mail' : (in_array('acct', $roles, true) ? 'acct/mail' : 'employee/rec/mail'));
            $link = siteUrl() . '#/portal/' . $sp . '?tab=campaigns';
            sendMail(
                (string) $owner['email'],
                (string) $owner['name'],
                'Your email campaign was paused: ' . mb_substr((string) $c['subject'], 0, 80),
                "Your campaign \"{$c['subject']}\" was paused automatically: $why.\n\nSending more would hurt the reputation of the address it goes out from, and the next emails would start landing in spam. Remove the addresses that bounced (Email > Check & bounces), then resume the campaign.\n\n$link",
                emailHtml('Your email campaign was paused', [
                    "\"{$c['subject']}\" was paused automatically: $why.",
                    'Sending more would hurt the reputation of the address it goes out from, and the next emails would start landing in spam.',
                    'Remove the addresses that bounced (Email › Check & bounces), then resume the campaign.',
                ], ['Open the campaign', $link]),
            );
        }
    } catch (Throwable $e) {
        // the pause is what matters
    }
    return $why;
}

/* ---------- before sending: list cleaning and the inbox check ---------- */

/**
 * Takes out addresses that would bounce or hurt: typos of big mail services, throwaway domains, addresses that
 * bounced or checked bad before, and domains that take no email. DNS lookups stop at $budgetMs (0 = only what is
 * remembered); the rest are checked as the campaign sends.
 */
function mailHygiene(array $list, int $budgetMs = 6000): array
{
    require_once __DIR__ . '/tools.php';
    if (!defined('FW_DISPOSABLE')) {
        require_once __DIR__ . '/firewall.php';
    }
    $removed = ['typo' => 0, 'disposable' => 0, 'known' => 0, 'nomx' => 0];
    $examples = [];
    $disp = array_flip(defined('FW_DISPOSABLE') ? FW_DISPOSABLE : []);
    $known = [];
    foreach (array_chunk(array_column($list, 'email'), 2000) as $chunk) {
        foreach (mailAddrGet($chunk) as $e => $k) {
            if ($k['st'] === 'bad') {
                $known[$e] = $k['bounceWhy'] !== '' ? 'bounced before: ' . $k['bounceWhy'] : $k['why'];
            }
        }
    }
    $deadline = now() + $budgetMs;
    $doms = [];
    $out = [];
    $unchecked = 0;
    foreach ($list as $p) {
        $e = (string) $p['email'];
        $d = substr($e, strrpos($e, '@') + 1);
        $why = '';
        $kind = '';
        if (isset(MAIL_TYPOS[$d])) {
            [$kind, $why] = ['typo', 'looks like a typo of ' . MAIL_TYPOS[$d]];
        } elseif (isset($disp[$d])) {
            [$kind, $why] = ['disposable', 'throwaway email service'];
        } elseif (isset($known[$e])) {
            [$kind, $why] = ['known', mb_substr($known[$e], 0, 120)];
        } else {
            if (!array_key_exists($d, $doms)) {
                $doms[$d] = mailDomainOk($d, $budgetMs > 0 && now() < $deadline);
                if ($doms[$d] === null) {
                    $unchecked++;
                }
            }
            if ($doms[$d] === false) {
                [$kind, $why] = ['nomx', 'no mail server for ' . $d];
            }
        }
        if ($kind !== '') {
            $removed[$kind]++;
            if (count($examples) < 8) {
                $examples[] = $e . ' (' . $why . ')';
            }
            continue;
        }
        $out[] = $p;
    }
    return ['list' => $out, 'removed' => $removed, 'n' => array_sum($removed), 'examples' => $examples, 'unchecked' => $unchecked];
}

/**
 * Reads a message the way spam filters do and says what to change. Returns a 0-100 score, a grade and the findings
 * (st: ok | warn | fail, t: what, fix: what to do).
 */
function mailContentCheck(string $subject, string $body, string $btnText = '', string $btnUrl = '', int $atts = 0, string $fromName = ''): array
{
    $items = [];
    $add = function (string $st, string $t, string $fix = '') use (&$items) {
        $items[] = ['st' => $st, 't' => $t, 'fix' => $fix];
    };
    $subject = trim($subject);
    $all = mb_strtolower($subject . "\n" . $body . "\n" . $btnText);
    // subject
    $len = mb_strlen($subject);
    if ($len === 0) {
        $add('fail', 'No subject', 'Write a short, specific subject.');
    } elseif ($len > 78) {
        $add('warn', "The subject is long ($len characters)", 'Keep it under about 60 characters so it isn\'t cut off on phones.');
    }
    $letters = (string) preg_replace('/[^A-Za-z]/', '', $subject);
    $caps = preg_match_all('/\b[A-Z]{4,}\b/', $subject);
    if (strlen($letters) >= 8 && (strlen((string) preg_replace('/[^A-Z]/', '', $letters)) / strlen($letters) > 0.5 || $caps >= 2)) {
        $add('warn', 'The subject uses a lot of capital letters', 'Write it in normal sentence case; shouting is a classic spam sign.');
    }
    if (substr_count($subject, '!') > 1 || str_contains($subject, '!!') || substr_count($body, '!!!') > 0) {
        $add('warn', 'Several exclamation marks', 'Use one at most.');
    }
    if (preg_match('/^\s*(re|fw|fwd)\s*:/i', $subject)) {
        $add('fail', 'The subject starts with "' . trim((string) strtok($subject, ':')) . ':" but this isn\'t a reply', 'Fake reply or forward subjects are deceptive (CAN-SPAM) and filters punish them.');
    }
    if (preg_match_all('/[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]/u', $subject) > 2) {
        $add('warn', 'More than two emoji in the subject', 'One at most, or none.');
    }
    // words
    $hits = array_values(array_filter(MAIL_SPAMMY, fn($w) => str_contains($all, $w)));
    if ($hits) {
        $add(count($hits) > 2 ? 'fail' : 'warn', 'Words spam filters look for: ' . implode(', ', array_map(fn($w) => '"' . $w . '"', array_slice($hits, 0, 6))), 'Say the same thing plainly, the way you would write to one person.');
    }
    $phish = array_values(array_filter(MAIL_PHISHY, fn($w) => str_contains($all, $w)));
    if ($phish) {
        $add('fail', 'Phrases that look like phishing: ' . implode(', ', array_map(fn($w) => '"' . $w . '"', $phish)), 'Never ask people to sign in or confirm details in a mass email.');
    }
    // links
    preg_match_all('~https?://[^\s<>"\')\]]+~i', $body . ' ' . $btnUrl, $m);
    $links = array_values(array_unique($m[0]));
    $hosts = array_map(fn($u) => strtolower((string) parse_url($u, PHP_URL_HOST)), $links);
    if (count($links) > 8) {
        $add('warn', count($links) . ' links in one email', 'Keep it to a few; many links read like a spam list.');
    }
    $short = array_values(array_unique(array_filter($hosts, fn($h) => in_array(preg_replace('/^www\./', '', $h), MAIL_SHORTENERS, true))));
    if ($short) {
        $add('fail', 'Shortened links (' . implode(', ', $short) . ')', 'Spammers hide behind link shorteners; use the full address on your own site.');
    }
    if (array_filter($hosts, fn($h) => (bool) filter_var($h, FILTER_VALIDATE_IP))) {
        $add('fail', 'A link points to a bare IP address', 'Link to a domain name instead.');
    }
    if (array_filter($links, fn($u) => stripos($u, 'http://') === 0)) {
        $add('warn', 'A link starts with http:// (not secure)', 'Use https:// links.');
    }
    // body
    $words = str_word_count(strip_tags($body));
    if ($words < 25) {
        $add('warn', "A very short message ($words words)", 'A few sentences of real text make a link-only email look less like phishing.');
    } elseif ($words > 1200) {
        $add('warn', "A long message ($words words)", 'Long emails are clipped by Gmail and read less; link to the details.');
    }
    if (!preg_match('/\{(first_name|name|company|title)\}/i', $subject . ' ' . $body)) {
        $add('warn', 'Not personal', 'Start with "Hi {first_name}," - personal emails get more replies and fewer spam reports.');
    } else {
        $add('ok', 'Personal greeting or details');
    }
    if ($atts > 0) {
        $add('warn', 'Attachments on a mass email', 'Filters treat attachments on bulk email with suspicion; link to the file on your site instead.');
    }
    $fn = mb_strtolower(trim($fromName));
    if ($fn !== '' && preg_match('/no-?reply|do not reply/', $fn)) {
        $add('warn', 'The sender name says no-reply', 'Use a person\'s or the company\'s name; replies help your reputation.');
    }
    $add('ok', 'Unsubscribe link and one-click unsubscribe header added automatically');
    $add('ok', 'Company postal address added at the bottom');
    $score = 100;
    foreach ($items as $i) {
        $score -= $i['st'] === 'fail' ? 20 : ($i['st'] === 'warn' ? 7 : 0);
    }
    $score = max(0, $score);
    return ['score' => $score, 'grade' => $score >= 85 ? 'good' : ($score >= 60 ? 'fair' : 'poor'), 'items' => $items];
}

/* ---------- delivery events from Postal (signed webhooks) ---------- */

function mbDerLen(int $n): string
{
    if ($n < 128) {
        return chr($n);
    }
    $s = '';
    while ($n > 0) {
        $s = chr($n & 0xff) . $s;
        $n >>= 8;
    }
    return chr(0x80 | strlen($s)) . $s;
}
function mbDerInt(string $bytes): string
{
    $bytes = ltrim($bytes, "\0");
    if ($bytes === '' || ord($bytes[0]) > 0x7f) {
        $bytes = "\0" . $bytes;
    }
    return "\x02" . mbDerLen(strlen($bytes)) . $bytes;
}
function b64urlDecode(string $s): string
{
    return (string) base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4));
}
/** An RSA public key from a JSON Web Key (n, e) as PEM. */
function jwkToPem(array $k): string
{
    $rsa = mbDerInt(b64urlDecode((string) ($k['n'] ?? ''))) . mbDerInt(b64urlDecode((string) ($k['e'] ?? '')));
    $rsa = "\x30" . mbDerLen(strlen($rsa)) . $rsa;
    $alg = "\x30\x0d\x06\x09\x2a\x86\x48\x86\xf7\x0d\x01\x01\x01\x05\x00";
    $bits = "\x03" . mbDerLen(strlen($rsa) + 1) . "\x00" . $rsa;
    $spki = "\x30" . mbDerLen(strlen($alg . $bits)) . $alg . $bits;
    return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($spki), 64, "\n") . "-----END PUBLIC KEY-----\n";
}
/** A public key pasted as PEM, as a DKIM-style "p=" value, or bare base64. '' when it isn't one. */
function pemFromAny(string $s): string
{
    $s = trim($s);
    if ($s === '') {
        return '';
    }
    if (!str_contains($s, '-----BEGIN')) {
        if (preg_match('/(?:^|;)\s*p=([A-Za-z0-9+\/=\s]+)/', $s, $m)) {
            $s = $m[1];
        }
        $b = (string) preg_replace('/\s+/', '', $s);
        $s = "-----BEGIN PUBLIC KEY-----\n" . chunk_split($b, 64, "\n") . "-----END PUBLIC KEY-----\n";
    }
    return openssl_pkey_get_public($s) ? $s : '';
}
/** The keys Postal signs webhooks with: the one pasted in the settings, and the server's published key set. */
function postalKeys(array $c, bool $refresh = false): array
{
    $out = [];
    if (($c['pkey'] ?? '') !== '' && ($p = pemFromAny((string) $c['pkey'])) !== '') {
        $out[] = $p;
    }
    $host = rtrim((string) $c['host'], '/');
    if ($host === '') {
        return $out;
    }
    $cache = mkvGet('postal_jwks', []);
    $cache = is_array($cache) && ($cache['host'] ?? '') === $host ? $cache : [];
    $age = now() - (int) ($cache['at'] ?? 0);
    // fresh for 15 minutes; a failed check may fetch again, at most once a minute
    if ($cache && ($age < 900000 && !$refresh || $age < 60000)) {
        return array_merge($out, (array) ($cache['pems'] ?? []));
    }
    $ch = curl_init($host . '/.well-known/jwks.json');
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10, CURLOPT_CONNECTTIMEOUT => 6, CURLOPT_FOLLOWLOCATION => false, CURLOPT_HTTPHEADER => ['Accept: application/json']]);
    $resp = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    $pems = [];
    $j = $code === 200 ? json_decode((string) $resp, true) : null;
    foreach ((array) ($j['keys'] ?? []) as $k) {
        if (is_array($k) && ($k['kty'] ?? '') === 'RSA' && !empty($k['n']) && !empty($k['e'])) {
            $pem = jwkToPem($k);
            if (openssl_pkey_get_public($pem)) {
                $pems[] = $pem;
            }
        }
    }
    if ($pems || !$cache) {
        mkvSet('postal_jwks', ['host' => $host, 'at' => now(), 'pems' => $pems, 'ok' => (bool) $pems]);
    }
    return array_merge($out, $pems ?: (array) ($cache['pems'] ?? []));
}
/** Checks a Postal webhook: X-Postal-Signature-256 (RSA-SHA256) or the older X-Postal-Signature (RSA-SHA1) over the raw body. */
function postalVerify(array $c, string $raw): bool
{
    $s256 = (string) ($_SERVER['HTTP_X_POSTAL_SIGNATURE_256'] ?? '');
    $s1 = (string) ($_SERVER['HTTP_X_POSTAL_SIGNATURE'] ?? '');
    if ($s256 === '' && $s1 === '') {
        return false;
    }
    foreach ([false, true] as $refresh) {
        foreach (postalKeys($c, $refresh) as $pem) {
            if ($s256 !== '' && openssl_verify($raw, (string) base64_decode($s256), $pem, OPENSSL_ALGO_SHA256) === 1) {
                return true;
            }
            if ($s1 !== '' && openssl_verify($raw, (string) base64_decode($s1), $pem, OPENSSL_ALGO_SHA1) === 1) {
                return true;
            }
        }
    }
    return false;
}
/**
 * Postal › Routes › HTTP endpoint (format Hash, i.e. JSON) posts incoming email here: replies to campaigns and to
 * service desk tickets, and anything else sent to the domain's route addresses, land in the portal Inbox as with
 * Mailgun's inbound route. Signed by the Postal server like its webhooks.
 */
function mailPostalInbound(): never
{
    if (!hash_equals(mailHookKey(), (string) ($_GET['k'] ?? ''))) {
        fail(403, 'forbidden', 'Unknown address.');
    }
    $c = mailSettings();
    $raw = (string) file_get_contents('php://input');
    if ($c['provider'] !== 'postal' || !postalVerify($c, $raw)) {
        mailLog('Postal inbound email refused: ' . ($c['provider'] !== 'postal' ? 'Postal is not the sending service' : 'the signature did not match'));
        fail(403, 'bad_request', 'Signature check failed.');
    }
    $j = json_decode($raw, true);
    if (!is_array($j)) {
        mailLog('Postal inbound email refused: not JSON (set the HTTP endpoint format to Hash).');
        fail(400, 'bad_request', 'Set the HTTP endpoint format to Hash (JSON).');
    }
    $files = [];
    foreach (array_slice((array) ($j['attachments'] ?? []), 0, 10) as $a) {
        $data = is_array($a) ? base64_decode((string) ($a['data'] ?? ''), true) : false;
        if (is_string($data) && $data !== '') {
            $files[] = ['name' => (string) ($a['filename'] ?? 'attachment'), 'size' => strlen($data), 'data' => $data];
        }
    }
    // the From header names the person; mail_from is the envelope sender (it can be a bounce address)
    $from = (string) ($j['from'] ?? '');
    mailInboundTake(
        $from !== '' ? $from : (string) ($j['mail_from'] ?? ''),
        '',
        (string) ($j['rcpt_to'] ?? ($j['to'] ?? '')),
        (string) ($j['subject'] ?? ''),
        (string) ($j['plain_body'] ?? ''),
        (string) ($j['html_body'] ?? ''),
        $files,
        (string) ($j['message_id'] ?? ''),
        (string) ($j['in_reply_to'] ?? '')
    );
    mailHookSeen('postalIn', 'Email received');
    ok(['ok' => true]);
}
/** Postal › Webhooks posts here: delivered, bounced, failed, delayed, held; DNS problems and send limits. */
function mailPostalHook(): never
{
    if (!hash_equals(mailHookKey(), (string) ($_GET['k'] ?? ''))) {
        fail(403, 'forbidden', 'Unknown webhook address.');
    }
    $c = mailSettings();
    $raw = (string) file_get_contents('php://input');
    if ($c['provider'] !== 'postal' || !postalVerify($c, $raw)) {
        mailLog('Postal webhook refused: ' . ($c['provider'] !== 'postal' ? 'Postal is not the sending service' : 'the signature did not match'));
        fail(403, 'bad_request', 'Signature check failed.');
    }
    $j = json_decode($raw, true);
    if (!is_array($j)) {
        fail(400, 'bad_request', 'Not JSON.');
    }
    $ev = (string) ($j['event'] ?? '');
    $p = is_array($j['payload'] ?? null) ? $j['payload'] : $j;
    if ($ev === '') {
        $ev = isset($p['original_message'], $p['bounce']) ? 'MessageBounced' : (['Sent' => 'MessageSent', 'SoftFail' => 'MessageDelayed', 'HardFail' => 'MessageDeliveryFailed', 'Held' => 'MessageHeld'][(string) ($p['status'] ?? '')] ?? '');
    }
    $msg = (array) ($p['message'] ?? ($p['original_message'] ?? []));
    $to = strtolower((string) ($msg['to'] ?? ''));
    $tag = (string) ($msg['tag'] ?? '');
    $detail = trim((string) ($p['details'] ?? '') . ' ' . (string) ($p['output'] ?? ''));
    switch ($ev) {
        case 'MessageSent':
            mailEvent($to, 'delivered', '', $tag, 'postal');
            break;
        case 'MessageDeliveryFailed':
            mailEvent($to, 'bounced', $detail !== '' ? $detail : 'The receiving server refused it', $tag, 'postal');
            break;
        case 'MessageBounced':
            mailEvent($to, 'bounced', 'A bounce message came back' . (!empty($p['bounce']['subject']) ? ': ' . $p['bounce']['subject'] : ''), $tag, 'postal');
            break;
        case 'MessageDelayed':
            mailEvent($to, 'soft', $detail, $tag, 'postal');
            break;
        case 'MessageHeld':
            mailEvent($to, 'soft', 'Held by your Postal server' . ($detail !== '' ? ': ' . $detail : ''), $tag, 'postal');
            break;
        case 'DomainDNSError':
            mkvSet('postal_dns', ['at' => now(), 'domain' => (string) ($p['domain'] ?? ''), 'spf' => (string) ($p['spf_status'] ?? ''), 'dkim' => (string) ($p['dkim_status'] ?? ''), 'mx' => (string) ($p['mx_status'] ?? ''), 'rp' => (string) ($p['return_path_status'] ?? ''), 'err' => mb_substr(trim(implode(' ', array_filter([(string) ($p['spf_error'] ?? ''), (string) ($p['dkim_error'] ?? ''), (string) ($p['mx_error'] ?? ''), (string) ($p['return_path_error'] ?? '')]))), 0, 400)]);
            break;
        case 'SendLimitApproaching':
        case 'SendLimitExceeded':
            mkvSet('postal_limit', ['at' => now(), 'ev' => $ev, 'volume' => (int) ($p['volume'] ?? 0), 'limit' => (int) ($p['limit'] ?? 0)]);
            if ($ev === 'SendLimitExceeded') {
                metaSet('mail_wait', now() + 1800000);
                mkvSet('wait_reason', 'Your Postal server reached its send limit' . (!empty($p['limit']) ? ' (' . (int) $p['limit'] . ')' : '') . '.');
                mkvSet('wait_hint', 'Raise the limit in Postal (the mail server\'s settings > Send limit) or wait for it to reset; queued email continues automatically.');
            }
            break;
    }
    mailHookSeen('postal', $ev . ($to !== '' ? ' for ' . $to : ''));
    ok(['ok' => true]);
}

/* ---------- delivery events from Amazon SES (through Amazon SNS) ---------- */

/** Only Amazon's own SNS addresses (or the tests' stand-in) are trusted for certificates and confirmations. */
function snsUrlOk(string $url, bool $cert): bool
{
    $dev = (string) getenv('SE_SNS_BASE');
    if ($dev !== '' && str_starts_with($url, rtrim($dev, '/') . '/')) {
        return true;
    }
    $p = parse_url($url);
    if (($p['scheme'] ?? '') !== 'https' || !preg_match('/^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/', strtolower((string) ($p['host'] ?? ''))) || isset($p['port'])) {
        return false;
    }
    return !$cert || str_ends_with((string) ($p['path'] ?? ''), '.pem');
}
function snsCert(string $url): string
{
    $k = 'sns_cert_' . substr(sha1($url), 0, 20);
    $c = mkvGet($k, []);
    if (is_array($c) && ($c['pem'] ?? '') !== '' && (int) ($c['at'] ?? 0) > now() - 7 * 86400000) {
        return (string) $c['pem'];
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10, CURLOPT_CONNECTTIMEOUT => 6, CURLOPT_FOLLOWLOCATION => false]);
    $pem = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($code !== 200 || !@openssl_x509_read($pem)) {
        return '';
    }
    mkvSet($k, ['at' => now(), 'pem' => $pem]);
    return $pem;
}
/** Verifies an SNS message signature (SignatureVersion 1: SHA1, 2: SHA256). Returns '' or what was wrong. */
function snsVerify(array $m): string
{
    $type = (string) ($m['Type'] ?? '');
    $certUrl = (string) ($m['SigningCertURL'] ?? ($m['SigningCertUrl'] ?? ''));
    if (!in_array($type, ['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation'], true)) {
        return 'unknown message type';
    }
    if (!snsUrlOk($certUrl, true)) {
        return 'the signing certificate is not from Amazon SNS';
    }
    $pem = snsCert($certUrl);
    if ($pem === '') {
        return 'the signing certificate could not be fetched';
    }
    $keys = $type === 'Notification' ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'] : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
    $s = '';
    foreach ($keys as $k) {
        if (isset($m[$k]) && is_string($m[$k])) {
            $s .= $k . "\n" . $m[$k] . "\n";
        }
    }
    $alg = (string) ($m['SignatureVersion'] ?? '1') === '2' ? OPENSSL_ALGO_SHA256 : OPENSSL_ALGO_SHA1;
    return openssl_verify($s, (string) base64_decode((string) ($m['Signature'] ?? '')), $pem, $alg) === 1 ? '' : 'the signature did not match';
}
/** The SNS topics this site takes SES events from (set in the settings, or the first one confirmed). */
function mailSesTopics(array $c): array
{
    return array_values(array_filter(array_map('trim', preg_split('/[\s,]+/', (string) ($c['topic'] ?? '')) ?: [])));
}
/** Amazon SNS posts here: the subscription confirmation, then SES bounce, complaint and delivery notifications. */
function mailSesHook(): never
{
    if (!hash_equals(mailHookKey(), (string) ($_GET['k'] ?? ''))) {
        fail(403, 'forbidden', 'Unknown webhook address.');
    }
    $m = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($m)) {
        fail(400, 'bad_request', 'Not an SNS message.');
    }
    $bad = snsVerify($m);
    if ($bad !== '') {
        mailLog('SES (SNS) message refused: ' . $bad);
        fail(403, 'bad_request', 'Signature check failed.');
    }
    $c = mailSettings();
    $topics = mailSesTopics($c);
    $arn = (string) ($m['TopicArn'] ?? '');
    if ($topics && !in_array($arn, $topics, true)) {
        mailLog('SES (SNS) message from an unknown topic refused: ' . $arn);
        fail(403, 'forbidden', 'This topic is not set up on the site.');
    }
    $type = (string) $m['Type'];
    if ($type === 'SubscriptionConfirmation') {
        $url = (string) ($m['SubscribeURL'] ?? '');
        if (!snsUrlOk($url, false)) {
            fail(400, 'bad_request', 'Unexpected confirmation address.');
        }
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10, CURLOPT_FOLLOWLOCATION => false]);
        curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if ($code !== 200) {
            fail(502, 'unavailable', 'The confirmation did not go through.');
        }
        if (!$topics && preg_match('/^arn:aws[a-z-]*:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_.-]{1,256}$/', $arn)) {
            // the first topic confirmed is the one trusted from now on
            $saved = mkvGet('settings', []);
            if (is_array($saved) && ($saved['provider'] ?? '') === 'ses_api') {
                $saved['topic'] = $arn;
                mkvSet('settings', $saved);
                mailSettings(true);
            }
        }
        mailHookSeen('ses', 'Subscription confirmed for ' . $arn);
        ok(['ok' => true]);
    }
    if ($type === 'UnsubscribeConfirmation') {
        mailHookSeen('ses', 'Unsubscribed from ' . $arn);
        ok(['ok' => true]);
    }
    $n = json_decode((string) ($m['Message'] ?? ''), true);
    if (!is_array($n)) {
        ok(['ok' => true]);
    }
    $kind = (string) ($n['notificationType'] ?? ($n['eventType'] ?? ''));
    $mail = (array) ($n['mail'] ?? []);
    $camp = (string) (((array) ($mail['tags']['campaign'] ?? []))[0] ?? '');
    $count = 0;
    if ($kind === 'Bounce') {
        $b = (array) ($n['bounce'] ?? []);
        $perm = (string) ($b['bounceType'] ?? '') === 'Permanent';
        foreach ((array) ($b['bouncedRecipients'] ?? []) as $r) {
            $why = trim((string) ($r['diagnosticCode'] ?? '') ?: (string) ($b['bounceSubType'] ?? 'Bounced'));
            mailEvent((string) ($r['emailAddress'] ?? ''), $perm ? 'bounced' : 'soft', $why, $camp, 'ses');
            $count++;
        }
    } elseif ($kind === 'Complaint') {
        $cp = (array) ($n['complaint'] ?? []);
        if ((string) ($cp['complaintFeedbackType'] ?? '') !== 'not-spam') {
            foreach ((array) ($cp['complainedRecipients'] ?? []) as $r) {
                mailEvent((string) ($r['emailAddress'] ?? ''), 'complained', (string) ($cp['complaintFeedbackType'] ?? ''), $camp, 'ses');
                $count++;
            }
        }
    } elseif ($kind === 'Delivery') {
        foreach ((array) ($n['delivery']['recipients'] ?? []) as $r) {
            mailEvent((string) $r, 'delivered', '', $camp, 'ses');
            $count++;
        }
    }
    mailHookSeen('ses', $kind . ($count ? ' (' . $count . ')' : ''));
    ok(['ok' => true]);
}
/**
 * Brings in bounces and complaints from the SES account-level suppression list (for sites without the SNS
 * notifications, and as a catch-up). Returns [count, error].
 */
function sesSuppressionSync(array $c, int $since): array
{
    $n = 0;
    $token = '';
    for ($page = 0; $page < 20; $page++) {
        $q = 'PageSize=1000&StartDate=' . rawurlencode(gmdate('Y-m-d\TH:i:s\Z', (int) ($since / 1000))) . ($token !== '' ? '&NextToken=' . rawurlencode($token) : '');
        $ch = curl_init();
        $hd = [];
        curl_setopt_array($ch, sesOpts($c, 'GET', '/v2/email/suppression/addresses', $q, null, 30) + [CURLOPT_HEADERFUNCTION => function ($h, $line) use (&$hd) {
            $p = strpos($line, ':');
            if ($p !== false) {
                $hd[strtolower(trim(substr($line, 0, $p)))] = trim(substr($line, $p + 1));
            }
            return strlen($line);
        }]);
        $resp = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $cerr = curl_error($ch);
        curl_close($ch);
        if ($code !== 200) {
            return [$n, sesResult($resp, $code, $cerr, $hd)['err']];
        }
        $j = json_decode((string) $resp, true) ?: [];
        foreach ((array) ($j['SuppressedDestinationSummaries'] ?? []) as $s) {
            $email = (string) ($s['EmailAddress'] ?? '');
            $reason = (string) ($s['Reason'] ?? 'BOUNCE');
            mailEvent($email, $reason === 'COMPLAINT' ? 'complained' : 'bounced', $reason === 'COMPLAINT' ? '' : 'On the Amazon SES suppression list (bounced)', '', 'ses');
            $n++;
        }
        $token = (string) ($j['NextToken'] ?? '');
        if ($token === '') {
            break;
        }
    }
    return [$n, ''];
}

/* ---------- deliverability: the sending domain, the server and the numbers ---------- */

/** Sent, delivered, bounced and complained in the last $days days, from the sent log. */
function mailRepStats(int $days = 30): array
{
    $st = mdb()->prepare('SELECT status, COUNT(*) AS n FROM mail_log WHERE at > ? GROUP BY status');
    $st->execute([now() - $days * 86400000]);
    $n = ['sent' => 0, 'delivered' => 0, 'bounced' => 0, 'complained' => 0, 'failed' => 0];
    foreach ($st->fetchAll() as $r) {
        if (isset($n[$r['status']])) {
            $n[$r['status']] = (int) $r['n'];
        }
    }
    $out = $n['sent'] + $n['delivered'] + $n['bounced'] + $n['complained'];
    return $n + [
        'out' => $out,
        'days' => $days,
        'bounceRate' => $out ? round($n['bounced'] * 100 / $out, 2) : 0.0,
        'complaintRate' => $out ? round($n['complained'] * 100 / $out, 3) : 0.0,
        'deliveredRate' => $out ? round($n['delivered'] * 100 / $out, 1) : 0.0,
    ];
}
function dvCheck(string $id, string $grp, string $st, string $t, string $d = '', string $fix = ''): array
{
    return ['id' => $id, 'grp' => $grp, 'st' => $st, 't' => $t, 'd' => $d, 'fix' => $fix];
}
/** The sending server's address, for reverse DNS and blocklists (own servers only). '' when there is none to check. */
function mailServerIp(array $c): string
{
    if (($c['ip'] ?? '') !== '' && filter_var($c['ip'], FILTER_VALIDATE_IP)) {
        return (string) $c['ip'];
    }
    $host = $c['provider'] === 'postal' ? (string) parse_url((string) $c['host'], PHP_URL_HOST) : (in_array($c['provider'], ['smtp', 'host'], true) ? (string) $c['host'] : '');
    if ($host === '') {
        return '';
    }
    if (filter_var($host, FILTER_VALIDATE_IP)) {
        return $host;
    }
    $a = dnsLookup($host, 'A');
    return $a ? (string) $a[0] : '';
}
/**
 * Checks what decides whether bulk email reaches the inbox: SPF, DKIM and DMARC on the sending domain, a mailbox for
 * replies, the server's reverse DNS and blocklists (own servers), domain blocklists, the bounce and complaint rates,
 * and warm-up. $extraSel: DKIM selectors to try besides the usual ones.
 */
function mailDelivCheck(string $extraSel = ''): array
{
    $c = mailSettings();
    $p = $c['provider'];
    $from = strtolower((string) $c['from']);
    $dom = str_contains($from, '@') ? substr($from, strrpos($from, '@') + 1) : '';
    $out = [];
    $own = in_array($p, ['postal', 'smtp', 'host', 'php'], true);
    if ($dom === '') {
        return ['at' => now(), 'domain' => '', 'checks' => [dvCheck('from', 'Domain', 'fail', 'No From address is set', '', 'Set it under Email › Sending setup.')], 'sum' => ['ok' => 0, 'warn' => 0, 'fail' => 1], 'score' => 0];
    }
    $free = in_array($dom, ['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'aol.com', 'icloud.com'], true);
    if ($free) {
        $out[] = dvCheck('freemail', 'Domain', 'warn', 'Email goes out from a personal ' . $dom . ' address', 'Gmail and others limit personal accounts and won\'t let you set SPF, DKIM or DMARC for them.', 'Send bulk email from your own domain (for example news@yourcompany.com) through Amazon SES, Mailgun or your own Postal server.');
    }
    if (!$free) {
        $txt = dnsLookup($dom, 'TXT');
        if ($txt === null) {
            $out[] = dvCheck('dns', 'Domain', 'warn', 'DNS lookups failed from this server, so the domain was not checked', $dom, 'Try again later, or check the records with your DNS provider.');
        } else {
            // where replies go (and DMARC reports)
            $mx = dnsLookup($dom, 'MX') ?? [];
            $out[] = $mx ? dvCheck('mx', 'Domain', 'ok', $dom . ' can receive replies', implode(', ', array_map(fn($x) => $x['host'], array_slice($mx, 0, 3)))) : dvCheck('mx', 'Domain', 'warn', $dom . ' has no mail server (MX) for replies', '', 'Add the MX records of the mailbox service you use for this domain, so replies and bounce reports arrive.');
            // SPF
            $spfs = array_values(array_filter($txt, fn($t) => stripos($t, 'v=spf1') === 0));
            if (!$spfs) {
                $out[] = dvCheck('spf', 'Domain', in_array($p, ['ses', 'ses_api'], true) ? 'warn' : 'fail', 'No SPF record on ' . $dom, '', 'Add one TXT record on ' . $dom . ', for example: v=spf1 ' . (isset(MAIL_SPF_INC[$p]) ? 'include:' . MAIL_SPF_INC[$p] . ' ' : '') . ($p === 'postal' ? 'include:spf.' . parse_url((string) $c['host'], PHP_URL_HOST) . ' ' : '') . '~all');
            } elseif (count($spfs) > 1) {
                $out[] = dvCheck('spf', 'Domain', 'fail', $dom . ' has ' . count($spfs) . ' SPF records', implode(' | ', $spfs), 'Merge them into one record: receivers treat two SPF records as an error and SPF fails.');
            } else {
                $spf = $spfs[0];
                $lookups = preg_match_all('/(?:^|\s)[+~?-]?(include:|a\b|a:|mx\b|mx:|ptr|exists:|redirect=)/i', $spf);
                $phost = $p === 'postal' ? strtolower((string) parse_url((string) $c['host'], PHP_URL_HOST)) : '';
                if ($p === 'postal' && (filter_var($phost, FILTER_VALIDATE_IP) || $phost === 'localhost' || (($c['ip'] ?? '') !== '' && stripos($spf, 'ip4:' . $c['ip']) !== false))) {
                    $phost = ''; // a bare address (or the sending IP named in SPF): no include to look for
                }
                $need = MAIL_SPF_INC[$p] ?? $phost;
                if (preg_match('/\+all\b/i', $spf)) {
                    $out[] = dvCheck('spf', 'Domain', 'fail', 'SPF allows anyone to send as ' . $dom . ' (+all)', $spf, 'Change +all to ~all.');
                } elseif ($lookups > 10) {
                    $out[] = dvCheck('spf', 'Domain', 'fail', 'SPF needs more than 10 DNS lookups', $spf, 'Remove services you no longer use; over 10 lookups and SPF fails.');
                } elseif ($p === 'mailgun') {
                    $sub = (string) $c['host'];
                    $subSpf = array_values(array_filter(dnsLookup($sub, 'TXT') ?? [], fn($t) => stripos($t, 'v=spf1') === 0));
                    $out[] = $subSpf && stripos($subSpf[0], 'mailgun.org') !== false ? dvCheck('spf', 'Domain', 'ok', 'SPF lets Mailgun send for ' . $sub, $subSpf[0]) : dvCheck('spf', 'Domain', 'warn', 'The Mailgun domain ' . $sub . ' has no SPF record with include:mailgun.org', $subSpf[0] ?? '', 'Add the TXT record Mailgun shows for ' . $sub . ' (v=spf1 include:mailgun.org ~all).');
                } elseif ($need !== '' && stripos($spf, $need) === false) {
                    $out[] = dvCheck('spf', 'Domain', 'warn', 'SPF on ' . $dom . ' does not name ' . $need, $spf, 'Add include:' . ($p === 'postal' ? 'spf.' . $need : $need) . ' before the ~all, so receivers know this service may send for you.');
                } else {
                    $out[] = dvCheck('spf', 'Domain', 'ok', 'SPF is set for ' . $dom, $spf . (in_array($p, ['ses', 'ses_api'], true) ? ' · Amazon SES passes DMARC through DKIM; for SPF alignment too, set a custom MAIL FROM domain in SES.' : ''));
                }
            }
            // DKIM
            $sels = array_merge(preg_split('/[\s,]+/', strtolower($extraSel . ' ' . (string) ($c['dkimSel'] ?? ''))) ?: [], MAIL_DKIM_SEL[$p] ?? [], MAIL_DKIM_COMMON);
            $sels = array_values(array_unique(array_filter($sels, fn($s) => preg_match('/^[a-z0-9._-]{1,63}$/', $s))));
            $doms = $p === 'mailgun' && (string) $c['host'] !== '' && (string) $c['host'] !== $dom ? [$dom, (string) $c['host']] : [$dom];
            $found = [];
            $revoked = [];
            foreach ($doms as $d) {
                foreach (array_slice($sels, 0, 16) as $sel) {
                    foreach (dnsLookup($sel . '._domainkey.' . $d, 'TXT') ?? [] as $t) {
                        if (stripos($t, 'p=') !== false) {
                            if (preg_match('/(?:^|;)\s*p=\s*(;|$)/i', $t)) {
                                $revoked[] = $sel . '._domainkey.' . $d;
                            } else {
                                $found[] = $sel . '._domainkey.' . $d;
                            }
                            break;
                        }
                    }
                }
            }
            if ($found) {
                $out[] = dvCheck('dkim', 'Domain', 'ok', 'DKIM key published', implode(', ', $found));
            } elseif ($revoked) {
                $out[] = dvCheck('dkim', 'Domain', 'fail', 'The DKIM key is empty (revoked)', implode(', ', $revoked), 'Publish the current key from your email service.');
            } else {
                $how = ['ses' => 'In SES › Identities › ' . $dom . ' › Authentication, publish the three Easy DKIM CNAME records, then enter one selector (the part before ._domainkey) here.', 'ses_api' => 'In SES › Identities › ' . $dom . ' › Authentication, publish the three Easy DKIM CNAME records, then enter one selector (the part before ._domainkey) here.', 'postal' => 'In Postal › Domains › ' . $dom . ' › DNS records, publish the DKIM TXT record (postal-xxxxxx._domainkey), then enter that selector here.'][$p] ?? 'Publish the DKIM record your email service gives you, then enter its selector (the part before ._domainkey) here.';
                $out[] = dvCheck('dkim', 'Domain', 'warn', 'No DKIM key found for ' . $dom . ' (selectors tried: ' . implode(', ', array_slice($sels, 0, 8)) . ')', '', $how);
            }
            // DMARC
            $dm = '';
            foreach (array_unique([$dom, dnsOrgDomain($dom)]) as $d) {
                foreach (dnsLookup('_dmarc.' . $d, 'TXT') ?? [] as $t) {
                    if (stripos($t, 'v=DMARC1') === 0) {
                        $dm = $t;
                        break 2;
                    }
                }
            }
            if ($dm === '') {
                $out[] = dvCheck('dmarc', 'Domain', 'fail', 'No DMARC record', 'Gmail, Yahoo and Microsoft require one from anyone sending more than about 5,000 emails a day.', 'Add TXT _dmarc.' . dnsOrgDomain($dom) . ': v=DMARC1; p=none; rua=mailto:dmarc@' . dnsOrgDomain($dom) . ' - move to p=quarantine once the reports show only your own services.');
            } else {
                $pol = preg_match('/\bp=(\w+)/i', $dm, $mm) ? strtolower($mm[1]) : 'none';
                $out[] = dvCheck('dmarc', 'Domain', 'ok', 'DMARC is published (policy: ' . $pol . ')', $dm, $pol === 'none' ? 'This meets the bulk-sender rule. When the reports look clean, p=quarantine also stops others from sending as you.' : '');
            }
            // domain blocklists
            foreach (MAIL_DOMBL as $zone => [$label, $test]) {
                $probe = dnsLookup($test . '.' . $zone, 'A');
                if (!$probe || !array_filter($probe, fn($ip) => str_starts_with($ip, '127.0.') || str_starts_with($ip, '127.0.1.'))) {
                    $out[] = dvCheck('dbl_' . $zone, 'Reputation', 'warn', $label . ' could not be asked from this server', 'Lists like this refuse lookups through public DNS resolvers.', 'Check ' . $dom . ' on the list\'s own website.');
                    continue;
                }
                $hit = array_values(array_filter(dnsLookup($dom . '.' . $zone, 'A') ?? [], fn($ip) => str_starts_with($ip, '127.') && !str_starts_with($ip, '127.255.')));
                $out[] = $hit ? dvCheck('dbl_' . $zone, 'Reputation', 'fail', $dom . ' is listed on ' . $label, implode(', ', $hit), 'Find out why on the list\'s website and ask for removal; links and senders on listed domains go to spam.') : dvCheck('dbl_' . $zone, 'Reputation', 'ok', $dom . ' is not on ' . $label);
            }
        }
    }
    // the server: reverse DNS and IP blocklists (only when you run it)
    if ($own) {
        $ip = mailServerIp($c);
        if ($ip === '') {
            $out[] = dvCheck('ptr', 'Server', 'warn', 'The sending server\'s address is not known', '', 'Enter the server\'s IP address under Sending setup to check its reverse DNS and blocklists.');
        } elseif (!dnsIsPublicIp($ip)) {
            $out[] = dvCheck('ptr', 'Server', 'warn', 'The sending server has a private address (' . $ip . '), so reverse DNS and blocklists were not checked', '', 'Enter the server\'s public IP address under Sending setup.');
        } else {
            $rev = filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) ? implode('.', array_reverse(explode('.', $ip))) : implode('.', array_reverse(str_split(bin2hex((string) inet_pton($ip)))));
            $ptr = dnsLookup($rev . (str_contains($ip, ':') ? '.ip6.arpa' : '.in-addr.arpa'), 'PTR') ?? [];
            if (!$ptr) {
                $out[] = dvCheck('ptr', 'Server', 'fail', 'No reverse DNS (PTR) for ' . $ip, 'Gmail and Microsoft reject or junk email from addresses without one.', 'Ask your server provider to set the reverse DNS of ' . $ip . ' to the server\'s name (for example mail.' . dnsOrgDomain($dom) . '), and point that name back to ' . $ip . '.');
            } else {
                $name = $ptr[0];
                $fwd = array_merge(dnsLookup($name, 'A') ?? [], dnsLookup($name, 'AAAA') ?? []);
                $out[] = in_array($ip, $fwd, true) ? dvCheck('ptr', 'Server', 'ok', 'Reverse DNS matches: ' . $ip . ' ↔ ' . $name) : dvCheck('ptr', 'Server', 'fail', 'Reverse DNS does not point back: ' . $ip . ' → ' . $name . ' → ' . ($fwd ? implode(', ', $fwd) : 'nothing'), '', 'Add an A record for ' . $name . ' pointing to ' . $ip . '.');
            }
            if (!str_contains($ip, ':')) {
                foreach (MAIL_DNSBL as $zone => $label) {
                    $probe = dnsLookup('2.0.0.127.' . $zone, 'A');
                    if (!$probe || !array_filter($probe, fn($x) => str_starts_with($x, '127.0.0.'))) {
                        $out[] = dvCheck('bl_' . $zone, 'Server', 'warn', $label . ' could not be asked from this server', '', 'Check ' . $ip . ' on the list\'s own website.');
                        continue;
                    }
                    $hit = array_values(array_filter(dnsLookup($rev . '.' . $zone, 'A') ?? [], fn($x) => str_starts_with($x, '127.') && !str_starts_with($x, '127.255.')));
                    $out[] = $hit ? dvCheck('bl_' . $zone, 'Server', 'fail', $ip . ' is listed on ' . $label, implode(', ', $hit), 'Stop sending from this address, find out why on the list\'s website, fix it and request removal.') : dvCheck('bl_' . $zone, 'Server', 'ok', $ip . ' is not on ' . $label);
                }
            }
        }
    }
    // how sending goes
    $sec = $c['transport'] === 'api' || in_array($c['secure'], ['ssl', 'tls'], true);
    $out[] = $sec ? dvCheck('tls', 'Sending', 'ok', 'The site hands email over encrypted (' . ($c['transport'] === 'api' ? 'HTTPS API' : strtoupper((string) $c['secure'])) . ')') : dvCheck('tls', 'Sending', 'fail', 'Email is handed over without encryption', '', 'Choose SSL or STARTTLS under Sending setup.');
    $out[] = dvCheck('unsub', 'Sending', 'ok', 'Every mass email has a one-click unsubscribe (RFC 8058) and an unsubscribe link', 'Unsubscribes stop further sends at once (the rule is within 2 days).');
    $out[] = dvCheck('fbl', 'Sending', 'ok', 'Mass email carries a Feedback-ID header for Gmail\'s complaint reports');
    $hooks = mkvGet('hook_seen', []);
    $evSrc = ['postal' => 'postal', 'ses_api' => 'ses', 'mailgun' => 'mailgun'][$p] ?? '';
    if ($evSrc !== '') {
        $seen = (array) ($hooks[$evSrc] ?? []);
        $out[] = !empty($seen['at']) && (int) $seen['at'] > now() - 14 * 86400000 ? dvCheck('events', 'Sending', 'ok', 'Delivery events arrive (last: ' . gmdate('M j, H:i', (int) ($seen['at'] / 1000)) . ' UTC)', (string) ($seen['what'] ?? '')) : dvCheck('events', 'Sending', 'warn', 'No delivery events received yet', 'Without them bounces and spam complaints are not stopped automatically.', 'Set up the webhook shown under Sending setup.');
    }
    if ($p === 'postal') {
        $pd = mkvGet('postal_dns', []);
        if (is_array($pd) && !empty($pd['at']) && (int) $pd['at'] > now() - 7 * 86400000) {
            $out[] = dvCheck('postaldns', 'Sending', 'fail', 'Postal reported a DNS problem for ' . (string) ($pd['domain'] ?? 'a domain'), (string) ($pd['err'] ?? ''), 'Open Postal › Domains and fix the records it marks.');
        }
    }
    $w = mailWarmCap();
    if ($own && $p !== 'php') {
        $out[] = $w['on'] ? dvCheck('warm', 'Sending', 'ok', $w['done'] ? 'Warm-up finished' : 'Warm-up: day ' . $w['day'] . ' of ' . $w['days'] . ', up to ' . number_format($w['cap']) . ' emails today') : dvCheck('warm', 'Sending', 'warn', 'Warm-up is off', 'A new server or IP address that suddenly sends thousands of emails is treated as a spammer.', 'Turn on warm-up under Delivery safety for the first weeks.');
    }
    // the numbers
    $r = mailRepStats(30);
    if ($r['out'] < 100) {
        $out[] = dvCheck('rates', 'Reputation', 'ok', 'Too few emails in the last 30 days to judge (' . $r['out'] . ')');
    } else {
        $cr = $r['complaintRate'];
        $out[] = $cr <= 0.1 ? dvCheck('complaints', 'Reputation', 'ok', 'Spam complaints ' . $cr . '% (keep under 0.1%)') : dvCheck('complaints', 'Reputation', $cr <= 0.3 ? 'warn' : 'fail', 'Spam complaints ' . $cr . '% in 30 days', 'Gmail and Yahoo start filtering or rejecting above 0.3%.', 'Email only people who expect it, make the unsubscribe easy to find, and remove inactive addresses.');
        $br = $r['bounceRate'];
        $out[] = $br <= 2 ? dvCheck('bounces', 'Reputation', 'ok', 'Bounces ' . $br . '% (keep under 2%)') : dvCheck('bounces', 'Reputation', $br <= 5 ? 'warn' : 'fail', 'Bounces ' . $br . '% in 30 days', '', 'Clean lists under Check & bounces before sending; old purchased lists bounce the most.');
    }
    $sum = ['ok' => 0, 'warn' => 0, 'fail' => 0];
    foreach ($out as $x) {
        $sum[$x['st']]++;
    }
    $res = ['at' => now(), 'domain' => $dom, 'provider' => $p, 'checks' => $out, 'sum' => $sum, 'score' => $out ? (int) round(100 * ($sum['ok'] + 0.5 * $sum['warn']) / count($out)) : 0];
    mkvSet('deliv_check', $res);
    return $res;
}

/* ---------- routes ---------- */

function mailBulkRoute(string $r, string $method, array $b): never
{
    switch ($r) {
        case 'mail_postal_hook':
            mailPostalHook();

        case 'mail_postal_inbound':
            mailPostalInbound();

        case 'mail_ses_hook':
            mailSesHook();

        case 'mail_content_check':
            mailUser();
            ok(mailContentCheck(str($b, 'subject', 250), str($b, 'body', 20000), str($b, 'btnText', 60), str($b, 'btnUrl', 500), max(0, (int) ($b['atts'] ?? 0)), str($b, 'fromName', 100)));

        case 'mail_deliv':
            $u = mailUser();
            $owner = hasRole($u, 'admin');
            $c = mailSettings();
            $s = mailSafety();
            $cap = mailUserCap($u);
            $out = [
                'owner' => $owner,
                'staff' => userLevel($u) >= 2,
                'provider' => $c['provider'],
                'from' => $c['from'],
                'stats30' => mailRepStats(30),
                'stats7' => mailRepStats(7),
                'check' => mkvGet('deliv_check'),
                'warm' => mailWarmCap($s),
                'safety' => array_diff_key($s, ['caps' => 1]),
                'hooks' => mkvGet('hook_seen', []),
                'postalDns' => $c['provider'] === 'postal' ? mkvGet('postal_dns') : null,
                'postalLimit' => $c['provider'] === 'postal' ? mkvGet('postal_limit') : null,
                'ses' => $c['provider'] === 'ses_api' ? mkvGet('ses_account') : null,
                'me' => ['cap' => $cap, 'used' => $cap > 0 ? mailUserUsed((string) $u['id']) : 0],
            ];
            if ($owner) {
                $team = [];
                $used = [];
                $st = mdb()->prepare("SELECT c.by_uid, COUNT(*) AS n FROM mail_queue q JOIN mail_campaigns c ON c.id = q.campaign WHERE c.created > ? AND q.status NOT IN ('cancelled', 'skipped') GROUP BY c.by_uid");
                $st->execute([now() - 86400000]);
                foreach ($st->fetchAll() as $row) {
                    $used[(string) $row['by_uid']] = (int) $row['n'];
                }
                foreach (db()->query("SELECT id, email, name, role, status, access FROM users WHERE status = 'active' ORDER BY name")->fetchAll() as $row) {
                    try {
                        if (!mailCanUse($row)) {
                            continue;
                        }
                    } catch (Throwable $e) {
                        continue;
                    }
                    $admin = hasRole($row, 'admin');
                    $team[] = ['id' => $row['id'], 'name' => $row['name'], 'email' => $row['email'], 'admin' => $admin, 'cap' => $admin ? 0 : (int) ($s['caps'][$row['id']] ?? $s['userDay']), 'own' => isset($s['caps'][$row['id']]), 'used' => $used[$row['id']] ?? 0];
                }
                $out['team'] = $team;
                $out['caps'] = $s['caps'];
            }
            ok($out);

        case 'mail_deliv_check':
            $u = mailUser();
            if (userLevel($u) < 2) {
                fail(403, 'forbidden', 'Staff access is required.');
            }
            session_write_close();
            @set_time_limit(90);
            ok(mailDelivCheck(str($b, 'sel', 200)));

        case 'mail_safety_save':
            mailOwner();
            $old = mailSafety();
            $warm = array_key_exists('warm', $b) ? !empty($b['warm']) : (bool) $old['warm'];
            $start = $old['warmStart'];
            $day = (int) ($b['warmDay'] ?? 0);
            if ($warm && ($day > 0 || !$old['warm'] || $start <= 0)) {
                // day 1 starts at midnight UTC today, or earlier when an administrator says sending began before
                $today = (int) (floor(now() / 86400000) * 86400000);
                $start = $today - (max(1, min(count(MAIL_WARMUP) + 1, $day ?: 1)) - 1) * 86400000;
            }
            $caps = $old['caps'];
            if (is_array($b['caps'] ?? null)) {
                $caps = [];
                foreach ($b['caps'] as $uid => $n) {
                    if (is_string($uid) && preg_match('/^[A-Za-z0-9_-]{1,40}$/', $uid) && $n !== null && $n !== '') {
                        $caps[$uid] = max(0, min(1000000, (int) $n));
                    }
                }
            }
            mkvSet('safety', [
                'warm' => $warm,
                'warmStart' => $warm ? $start : 0,
                'warmPace' => in_array(str($b, 'warmPace', 10), ['careful', 'normal', 'fast'], true) ? str($b, 'warmPace', 10) : $old['warmPace'],
                'domHour' => max(0, min(100000, (int) ($b['domHour'] ?? $old['domHour']))),
                'bounceMax' => max(0.5, min(50.0, (float) ($b['bounceMax'] ?? $old['bounceMax']))),
                'complaintMax' => max(0.05, min(5.0, (float) ($b['complaintMax'] ?? $old['complaintMax']))),
                'clean' => array_key_exists('clean', $b) ? !empty($b['clean']) : $old['clean'],
                'userDay' => max(0, min(1000000, (int) ($b['userDay'] ?? $old['userDay']))),
                'caps' => $caps,
            ]);
            if (function_exists('audit')) {
                $ns = mailSafety();
                audit('settings', 'Email delivery safety changed', '', ['warm' => $ns['warm'], 'domHour' => $ns['domHour'], 'bounceMax' => $ns['bounceMax'], 'complaintMax' => $ns['complaintMax'], 'clean' => $ns['clean'], 'userDay' => $ns['userDay'], 'caps' => count($ns['caps'])]);
            }
            ok(['safety' => array_diff_key(mailSafety(), ['caps' => 1]), 'warm' => mailWarmCap()]);
    }
    fail(404, 'not_found', 'Unknown action.');
}
