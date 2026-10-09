<?php
/*
 * Email for the site and the portals.
 *
 *  - Sending settings: Gmail, Google Workspace, the web host's mailbox or any SMTP service.
 *  - Sent log: every message the site sends, with its result.
 *  - Contacts: the address book used for mass email (import, tags, unsubscribes).
 *  - Mass email: campaigns that go out one recipient at a time through a queue, within the
 *    mailbox's daily limit, while the Campaigns page is open or from the scheduled task.
 *  - v34: Amazon SES (API) and your own Postal server as sending services, delivery events, warm-up, per-domain
 *    caps, auto-pause on bounces and complaints, list cleaning and the deliverability checks (mailbulk.php).
 */
declare(strict_types=1);
require_once __DIR__ . '/mailbulk.php';

const MAIL_SCHEMA = 4; // 3: the inbox table; 4 (v34): delivery results per recipient, held-back sends, campaign notes
const MAIL_MAX_RECIPIENTS = 200000;
const MAIL_PROVIDERS = [
    'gmail' => ['host' => 'smtp.gmail.com', 'port' => 465, 'secure' => 'ssl', 'limit' => 450],
    'workspace' => ['host' => 'smtp.gmail.com', 'port' => 465, 'secure' => 'ssl', 'limit' => 1900],
    'mailgun' => ['host' => '', 'port' => 443, 'secure' => 'tls', 'limit' => 0, 'api' => true],
    // v34: your own mail server (Postal, open source) and Amazon SES through its HTTPS API
    'postal' => ['host' => '', 'port' => 443, 'secure' => 'tls', 'limit' => 0, 'api' => true],
    'ses_api' => ['host' => '', 'port' => 443, 'secure' => 'tls', 'limit' => 0, 'api' => true],
    // v41: the company's Microsoft 365 mailbox through Microsoft Graph (connected with Microsoft; no SMTP password, which
    // Microsoft switches off for Exchange Online from late December 2026). Exchange allows about 10,000 recipients a day.
    'm365' => ['host' => '', 'port' => 443, 'secure' => 'tls', 'limit' => 5000, 'api' => true],
    'sendgrid' => ['host' => 'smtp.sendgrid.net', 'port' => 587, 'secure' => 'tls', 'limit' => 0],
    'brevo' => ['host' => 'smtp-relay.brevo.com', 'port' => 587, 'secure' => 'tls', 'limit' => 0],
    'ses' => ['host' => 'email-smtp.us-east-1.amazonaws.com', 'port' => 587, 'secure' => 'tls', 'limit' => 0],
    'host' => ['host' => '', 'port' => 465, 'secure' => 'ssl', 'limit' => 0],
    'smtp' => ['host' => '', 'port' => 587, 'secure' => 'tls', 'limit' => 0],
    'php' => ['host' => '', 'port' => 0, 'secure' => '', 'limit' => 0],
];
// Mailgun's API base by region. Messages, delivery events (webhooks) and inbound routes all use it.
const MAILGUN_API = ['us' => 'https://api.mailgun.net/v3', 'eu' => 'https://api.eu.mailgun.net/v3'];

/* ---------- storage ---------- */

function mdb(): PDO
{
    static $ready = false;
    $pdo = db();
    if ($ready) {
        return $pdo;
    }
    $row = $pdo->query("SELECT v FROM meta WHERE k = 'mail_schema'")->fetch();
    $version = $row ? (int) $row['v'] : 0;
    if ($version < MAIL_SCHEMA) {
        $pdo->exec('CREATE TABLE IF NOT EXISTS mail_kv (k VARCHAR(40) PRIMARY KEY, v TEXT NOT NULL)');
        $pdo->exec('CREATE TABLE IF NOT EXISTS mail_log (id VARCHAR(24) PRIMARY KEY, at BIGINT NOT NULL, to_email VARCHAR(190) NOT NULL,
            to_name VARCHAR(190) NOT NULL, subject VARCHAR(300) NOT NULL, kind VARCHAR(30) NOT NULL, status VARCHAR(12) NOT NULL,
            err VARCHAR(500) NOT NULL, ref VARCHAR(64) NOT NULL, by_uid VARCHAR(40) NOT NULL)');
        $pdo->exec('CREATE TABLE IF NOT EXISTS mail_contacts (id VARCHAR(24) PRIMARY KEY, email VARCHAR(190) NOT NULL, name VARCHAR(190) NOT NULL,
            company VARCHAR(190) NOT NULL, title VARCHAR(190) NOT NULL, phone VARCHAR(60) NOT NULL, city VARCHAR(120) NOT NULL,
            tags VARCHAR(600) NOT NULL, source VARCHAR(80) NOT NULL, notes TEXT NOT NULL, created BIGINT NOT NULL, updated BIGINT NOT NULL,
            by_uid VARCHAR(40) NOT NULL, last_sent BIGINT NOT NULL)');
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS mail_suppress (email VARCHAR(190) PRIMARY KEY, at BIGINT NOT NULL, why VARCHAR(20) NOT NULL)',
        );
        $pdo->exec('CREATE TABLE IF NOT EXISTS mail_campaigns (id VARCHAR(24) PRIMARY KEY, subject VARCHAR(300) NOT NULL, body TEXT NOT NULL,
            btn_text VARCHAR(80) NOT NULL, btn_url VARCHAR(600) NOT NULL, from_name VARCHAR(120) NOT NULL, reply_to VARCHAR(190) NOT NULL,
            audience TEXT NOT NULL, atts TEXT NOT NULL, base VARCHAR(300) NOT NULL, status VARCHAR(12) NOT NULL, total INT NOT NULL,
            sent INT NOT NULL, failed INT NOT NULL, skipped INT NOT NULL, created BIGINT NOT NULL, started BIGINT NOT NULL,
            finished BIGINT NOT NULL, by_uid VARCHAR(40) NOT NULL, by_name VARCHAR(190) NOT NULL, note VARCHAR(500) NOT NULL)');
        $pdo->exec('CREATE TABLE IF NOT EXISTS mail_queue (id VARCHAR(24) PRIMARY KEY, campaign VARCHAR(24) NOT NULL, seq INT NOT NULL,
            email VARCHAR(190) NOT NULL, name VARCHAR(190) NOT NULL, vars TEXT NOT NULL, status VARCHAR(12) NOT NULL, tries INT NOT NULL,
            at BIGINT NOT NULL, err VARCHAR(500) NOT NULL, tok VARCHAR(32) NOT NULL)');
        $pdo->exec('CREATE TABLE IF NOT EXISTS mail_inbox (id VARCHAR(24) PRIMARY KEY, at BIGINT NOT NULL, from_email VARCHAR(190) NOT NULL,
            from_name VARCHAR(190) NOT NULL, to_email VARCHAR(190) NOT NULL, subject VARCHAR(300) NOT NULL, text LONGTEXT NOT NULL,
            html LONGTEXT NOT NULL, atts TEXT NOT NULL, msgid VARCHAR(300) NOT NULL, ref VARCHAR(64) NOT NULL, folder VARCHAR(12) NOT NULL,
            seen INT NOT NULL, starred INT NOT NULL)');
        $indexes = [
            'CREATE INDEX mail_inbox_at ON mail_inbox (folder, at)',
            'CREATE UNIQUE INDEX mail_contacts_email ON mail_contacts (email)',
            'CREATE INDEX mail_contacts_created ON mail_contacts (created)',
            'CREATE INDEX mail_log_at ON mail_log (at)',
            'CREATE INDEX mail_queue_run ON mail_queue (campaign, status, seq)',
            'CREATE UNIQUE INDEX mail_queue_tok ON mail_queue (tok)',
        ];
        foreach ($indexes as $sql) {
            try {
                $pdo->exec($sql);
            } catch (Throwable $e) {
                // already there
            }
        }
        // v34: delivered / bounced / complained per recipient and campaign, sends held back until a time (per-domain
        // caps), campaign notes (list cleaning, automatic pauses); events find recipients by address
        foreach ([
            'ALTER TABLE mail_queue ADD COLUMN nb BIGINT NOT NULL DEFAULT 0',
            'ALTER TABLE mail_campaigns ADD COLUMN delivered INT NOT NULL DEFAULT 0',
            'ALTER TABLE mail_campaigns ADD COLUMN bounced INT NOT NULL DEFAULT 0',
            'ALTER TABLE mail_campaigns ADD COLUMN complained INT NOT NULL DEFAULT 0',
            'ALTER TABLE mail_campaigns ADD COLUMN meta TEXT',
            'CREATE INDEX mail_queue_email ON mail_queue (email)',
        ] as $sql) {
            try {
                $pdo->exec($sql);
            } catch (Throwable $e) {
                // already there
            }
        }
        foreach (['mail_lock', 'mail_wait'] as $k) {
            try {
                $pdo->prepare('INSERT INTO meta (k, v) VALUES (?, 0)')->execute([$k]);
            } catch (Throwable $e) {
                // already there
            }
        }
        try {
            if ($row) {
                $pdo->prepare("UPDATE meta SET v = ? WHERE k = 'mail_schema'")->execute([MAIL_SCHEMA]);
            } else {
                $pdo->prepare("INSERT INTO meta (k, v) VALUES ('mail_schema', ?)")->execute([MAIL_SCHEMA]);
            }
        } catch (Throwable $e) {
            // another request finished the setup first
        }
    }
    $ready = true;
    return $pdo;
}

function mkvGet(string $k, $default = null)
{
    $st = mdb()->prepare('SELECT v FROM mail_kv WHERE k = ?');
    $st->execute([$k]);
    $v = $st->fetchColumn();
    if ($v === false) {
        return $default;
    }
    $d = json_decode((string) $v, true);
    return $d ?? $default;
}

function mkvSet(string $k, $v): void
{
    mdb()
        ->prepare('REPLACE INTO mail_kv (k, v) VALUES (?, ?)')
        ->execute([$k, json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
}

function metaGet(string $k): int
{
    $st = mdb()->prepare('SELECT v FROM meta WHERE k = ?');
    $st->execute([$k]);
    return (int) $st->fetchColumn();
}

function metaSet(string $k, int $v): void
{
    mdb()
        ->prepare('UPDATE meta SET v = ? WHERE k = ?')
        ->execute([$v, $k]);
}

/* ---------- the mailbox password is stored encrypted ---------- */

function mailKey(): string
{
    // v34: one key for every sealed value and file, found wherever it lives (see secKeyPath in seccore.php)
    return secKeyBytes();
}

function mailSeal(string $plain): string
{
    if ($plain === '') {
        return '';
    }
    if (!function_exists('openssl_encrypt')) {
        return 'b64:' . base64_encode($plain);
    }
    $iv = random_bytes(12);
    $tag = '';
    $cipher = openssl_encrypt($plain, 'aes-256-gcm', mailKey(), OPENSSL_RAW_DATA, $iv, $tag);
    return 'v1:' . base64_encode($iv . $tag . $cipher);
}

function mailUnseal(string $sealed): string
{
    return mailUnsealWith($sealed, mailKey());
}
/** Unseals with a given key (v37: StratEdge's own key, for the mail settings a company workspace borrows). */
function mailUnsealWith(string $sealed, string $key): string
{
    if ($sealed === '') {
        return '';
    }
    if (str_starts_with($sealed, 'b64:')) {
        return (string) base64_decode(substr($sealed, 4));
    }
    if (str_starts_with($sealed, 'v1:') && function_exists('openssl_decrypt')) {
        $raw = (string) base64_decode(substr($sealed, 3));
        $plain = openssl_decrypt(
            substr($raw, 28),
            'aes-256-gcm',
            $key,
            OPENSSL_RAW_DATA,
            substr($raw, 0, 12),
            substr($raw, 12, 16),
        );
        return $plain === false ? '' : $plain;
    }
    return '';
}

/* ---------- settings ---------- */

function mailHost(): string
{
    $h = (string) (parse_url((string) cfg('site_url'), PHP_URL_HOST) ?: $_SERVER['HTTP_HOST'] ?? '');
    $h = preg_replace('/:\d+$/', '', $h) ?? '';
    return $h !== '' ? $h : 'localhost';
}

/** v37: StratEdge's own saved mail settings and key, for a company workspace that has not connected its own email:
 *  read from StratEdge's database and key file on this server. Used to send only; never shown to the workspace. */
function wsProviderMailSaved(): ?array
{
    static $done = false;
    static $out = null;
    if ($done) {
        return $out;
    }
    $done = true;
    if (wsSlug() === '') {
        return null;
    }
    try {
        $c = cfgRaw();
        $pdo = dbConnect((string) ($c['dsn'] ?? ''), ((string) ($c['db_user'] ?? '')) ?: null, ((string) ($c['db_pass'] ?? '')) ?: null);
        $st = $pdo->prepare('SELECT v FROM mail_kv WHERE k = ?');
        $st->execute(['settings']);
        $v = $st->fetchColumn();
        $saved = $v !== false ? json_decode((string) $v, true) : null;
        if (!is_array($saved) || !isset(MAIL_PROVIDERS[$saved['provider'] ?? ''])) {
            return null;
        }
        // StratEdge's key, where secKeyCandidates() finds it on StratEdge's own site
        $hex = '';
        $dir = trim((string) ($c['key_dir'] ?? ''));
        foreach (array_unique(array_filter([$dir !== '' ? rtrim($dir, '/') . '/mail.key' : '', dirname(dirname(__DIR__)) . '/.stratedge-keys/mail.key', dirname(__DIR__) . '/storage/mail.key'])) as $f) {
            if (is_file($f)) {
                $hex = trim((string) @file_get_contents($f));
                break;
            }
        }
        $key = strlen($hex) === 64 && ctype_xdigit($hex) ? (string) hex2bin($hex) : hash('sha256', __DIR__ . (string) ($c['session_name'] ?? ''), true);
        $out = ['saved' => $saved, 'key' => $key];
        if (($saved['provider'] ?? '') === 'm365') {
            // v41: StratEdge's Microsoft 365 mailbox is renewed with StratEdge's own Microsoft app
            $st2 = $pdo->prepare('SELECT data FROM docs WHERE path = ?');
            $st2->execute(['sec/x/sso/cfg']);
            $sso = json_decode((string) $st2->fetchColumn(), true);
            $ms = is_array($sso) && is_array($sso['microsoft'] ?? null) ? $sso['microsoft'] : [];
            $out['ms'] = ['id' => (string) ($ms['id'] ?? ''), 'secret' => (string) ($ms['secret'] ?? '')];
        }
    } catch (Throwable $e) {
        $out = null;
    }
    return $out;
}

/** The settings in effect: saved under Mass email > Gmail & sending, otherwise the values in config.php. A company
 *  workspace (v37) without saved settings of its own sends through StratEdge's, under its own name. */
function mailSettings(bool $fresh = false): array
{
    static $cache = null;
    if ($cache !== null && !$fresh) {
        return $cache;
    }
    $saved = mkvGet('settings');
    $fromName = (string) (cfg('mail_from_name') ?: 'StratEdge IT Consulting');
    $prov = null;
    if (!(is_array($saved) && isset(MAIL_PROVIDERS[$saved['provider'] ?? ''])) && wsSlug() !== '') {
        $prov = wsProviderMailSaved();
        if ($prov) {
            $saved = $prov['saved'];
        }
    }
    $unseal = $prov ? fn(string $x): string => mailUnsealWith($x, $prov['key']) : fn(string $x): string => mailUnseal($x);
    if (is_array($saved) && isset(MAIL_PROVIDERS[$saved['provider'] ?? ''])) {
        $p = $saved['provider'];
        $preset = MAIL_PROVIDERS[$p];
        $google = $p === 'gmail' || $p === 'workspace';
        $user = trim((string) ($saved['user'] ?? ''));
        $port = (int) ($saved['port'] ?? 0) ?: $preset['port'];
        $region = (string) ($saved['region'] ?? '');
        $cache = [
            'provider' => $p,
            'saved' => !$prov,
            // v37: true while a company workspace borrows StratEdge's mail service
            'viaProvider' => (bool) $prov,
            'transport' => $p === 'php' ? 'php' : (!empty($preset['api']) ? 'api' : 'smtp'),
            'region' => $p === 'ses_api' ? (preg_match('/^[a-z]{2}(-[a-z]+)+-\d$/', $region) ? $region : 'us-east-1') : ($region === 'eu' ? 'eu' : 'us'),
            'whk' => $unseal((string) ($saved['whk'] ?? '')),
            'host' => $google || $preset['host'] !== '' ? $preset['host'] : trim((string) ($saved['host'] ?? '')),
            'port' => $port,
            'secure' => in_array($saved['secure'] ?? '', ['ssl', 'tls', 'none'], true)
                ? $saved['secure']
                : $preset['secure'],
            'user' => $user,
            'pass' => $unseal((string) ($saved['pass'] ?? '')),
            'from' => trim((string) ($saved['from'] ?? '')) ?: $user,
            'from_name' => $prov ? $fromName : (trim((string) ($saved['from_name'] ?? '')) ?: $fromName),
            'limit' => max(0, (int) ($saved['limit'] ?? $preset['limit'])),
            'gap' => max(0.0, min(10.0, (float) ($saved['gap'] ?? 1))),
            // v34: emails a second on the API services (0 = as fast as they accept), the Postal webhook key, the
            // SES configuration set and SNS topics, the sending server's IP and DKIM selectors for the checks
            'rate' => max(0.0, min(500.0, (float) ($saved['rate'] ?? 0))),
            'pkey' => (string) ($saved['pkey'] ?? ''),
            'cset' => (string) ($saved['cset'] ?? ''),
            'topic' => (string) ($saved['topic'] ?? ''),
            'ip' => (string) ($saved['ip'] ?? ''),
            'dkimSel' => (string) ($saved['dkimSel'] ?? ''),
            // v41: a workspace borrowing StratEdge's Microsoft 365 mailbox renews it with StratEdge's Microsoft app
            'msApp' => $prov && isset($prov['ms']) ? ['id' => $prov['ms']['id'], 'secret' => $unseal($prov['ms']['secret'])] : null,
        ];
    } else {
        $smtp = (string) cfg('mail_transport') === 'smtp' && (string) cfg('smtp_host') !== '';
        $cache = [
            'provider' => 'config',
            'saved' => false,
            'viaProvider' => false,
            'transport' => $smtp ? 'smtp' : 'php',
            'host' => (string) cfg('smtp_host'),
            'port' => (int) (cfg('smtp_port') ?: 587),
            'secure' => (string) (cfg('smtp_secure') ?: 'tls'),
            'user' => (string) cfg('smtp_user'),
            'pass' => (string) cfg('smtp_pass'),
            'from' => (string) cfg('mail_from'),
            'from_name' => $fromName,
            'limit' => 0,
            'gap' => 1.0,
            'region' => 'us',
            'whk' => '',
            'rate' => 0.0,
            'pkey' => '',
            'cset' => '',
            'topic' => '',
            'ip' => '',
            'dkimSel' => '',
        ];
    }
    if ($cache['from'] === '') {
        $cache['from'] = 'no-reply@' . preg_replace('/^www\./', '', mailHost());
    }
    return $cache;
}

function mailReady(array $c): bool
{
    if ($c['transport'] === 'api') {
        return in_array($c['provider'], ['ses_api', 'm365'], true) ? $c['user'] !== '' && $c['pass'] !== '' : $c['host'] !== '' && $c['pass'] !== '';
    }
    return $c['transport'] === 'smtp' && $c['host'] !== '' && ($c['user'] === '' || $c['pass'] !== '');
}

/* ---------- Mailgun (HTTPS API) ---------- */

/** Sends one message through the Mailgun API. Returns ['ok' => bool, 'err' => string, 'code' => int]. */
function mailgunSend(array $c, array $fields): array
{
    $h = curl_init();
    $parts = mailgunCurlParts($c, $fields);
    curl_setopt_array($h, $parts['opts']);
    $resp = curl_exec($h);
    $code = (int) curl_getinfo($h, CURLINFO_RESPONSE_CODE);
    $cerr = curl_error($h);
    curl_close($h);
    return mailgunResult($resp, $code, $cerr);
}
function mailgunCurlParts(array $c, array $fields): array
{
    $base = MAILGUN_API[$c['region']] ?? MAILGUN_API['us'];
    $post = [];
    foreach ($fields as $k => $v) {
        if (is_array($v) && $k === 'attachment') {
            foreach ($v as $i => $a) {
                $post["attachment[$i]"] = new CURLStringFile((string) $a['data'], (string) $a['name'], (string) $a['type']);
            }
        } elseif (is_array($v)) {
            foreach ($v as $i => $x) {
                $post["{$k}[$i]"] = (string) $x;
            }
        } else {
            $post[$k] = (string) $v;
        }
    }
    return [
        'opts' => [
            CURLOPT_URL => $base . '/' . rawurlencode($c['host']) . '/messages',
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $post,
            CURLOPT_USERPWD => 'api:' . $c['pass'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_CONNECTTIMEOUT => 10,
        ],
    ];
}
function mailgunResult($resp, int $code, string $cerr): array
{
    if ($resp === false || $cerr !== '') {
        return ['ok' => false, 'err' => 'Could not reach the Mailgun API: ' . ($cerr ?: 'no response'), 'code' => 0];
    }
    $j = json_decode((string) $resp, true);
    if ($code >= 200 && $code < 300) {
        return ['ok' => true, 'err' => '', 'code' => $code, 'id' => (string) ($j['id'] ?? '')];
    }
    $msg = is_array($j) && isset($j['message']) ? (string) $j['message'] : trim((string) $resp);
    return ['ok' => false, 'err' => 'Mailgun said: ' . mb_substr($msg !== '' ? $msg : 'HTTP ' . $code, 0, 300), 'code' => $code];
}
/** The API fields for a message (shared by single and parallel sending). */
function mailgunFields(array $c, array $m): array
{
    $to = strtolower(trim((string) ($m['to'] ?? '')));
    $name = (string) ($m['name'] ?? '');
    $from = (string) ($c['from']);
    $fromName = (string) ($m['from_name'] ?? '' ?: $c['from_name']);
    $f = [
        'from' => mailAddr($fromName, $from),
        'to' => mailAddr($name, $to),
        'subject' => (string) ($m['subject'] ?? ''),
        'text' => (string) ($m['text'] ?? ''),
    ];
    if (!empty($m['html'])) {
        $f['html'] = (string) $m['html'];
    }
    if (!empty($m['reply'])) {
        $f['h:Reply-To'] = (string) $m['reply'];
    }
    if (!empty($m['cc'])) {
        $f['cc'] = (string) $m['cc'];
    }
    foreach ((array) ($m['headers'] ?? []) as $k => $v) {
        if (preg_match('/^[A-Za-z0-9-]+$/', (string) $k)) {
            $f['h:' . $k] = (string) $v;
        }
    }
    if (!empty($m['atts'])) {
        $f['attachment'] = $m['atts'];
    }
    $f['o:tag'] = [mb_substr((string) ($m['kind'] ?? 'portal'), 0, 60)];
    if (!empty($m['ref'])) {
        $f['v:ref'] = (string) $m['ref'];
    }
    return $f;
}
function mailAddr(string $name, string $email): string
{
    $name = trim(str_replace(['"', "\r", "\n"], '', $name));
    return $name !== '' ? '"' . $name . '" <' . $email . '>' : $email;
}
/** Sends several messages at once over parallel connections (mass email on the API transport). */
function mailgunSendMany(array $c, array $msgs, int $parallel = 8): array
{
    $out = [];
    foreach (array_chunk($msgs, max(1, $parallel), true) as $chunk) {
        $mh = curl_multi_init();
        $hs = [];
        foreach ($chunk as $k => $m) {
            $h = curl_init();
            curl_setopt_array($h, mailgunCurlParts($c, mailgunFields($c, $m))['opts']);
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
            $out[$k] = mailgunResult(curl_multi_getcontent($h), (int) curl_getinfo($h, CURLINFO_RESPONSE_CODE), curl_error($h));
            curl_multi_remove_handle($mh, $h);
            curl_close($h);
        }
        curl_multi_close($mh);
    }
    return $out;
}
/** Verifies a Mailgun webhook or inbound-route signature (HMAC-SHA256 of timestamp + token with the signing key). */
function mailgunVerify(string $timestamp, string $token, string $signature, string $key): bool
{
    if ($key === '' || $timestamp === '' || $token === '' || $signature === '') {
        return false;
    }
    if (abs(time() - (int) $timestamp) > 900) {
        return false;
    }
    if (!hash_equals(hash_hmac('sha256', $timestamp . $token, $key), strtolower($signature))) {
        return false;
    }
    // v83: each signed Mailgun delivery is accepted once, so a captured request cannot be replayed inside the
    // freshness window (1800 s covers the 900 s either side); only a valid signature uses up its token
    return !throttleHit('mgtok:' . hash('sha256', $token), 1, 1800);
}

/** Plain-language advice for a failed send, shown next to the server's own message. */
function mailHint(string $err, string $stage, int $code, array $c): string
{
    if (!empty($c['viaProvider'])) {
        // v37: a company workspace using StratEdge's mail service: nothing for it to fix there, and nothing about that account
        return 'The mail service that sends for this portal could not deliver the message just now. Try again later, or connect your own mail service under Gmail & sending.';
    }
    $google = in_array($c['provider'], ['gmail', 'workspace'], true) || $c['host'] === 'smtp.gmail.com';
    if ($c['transport'] === 'php') {
        return 'Mail is going through the server\'s basic mail() function. Connect Gmail or your mailbox under Mass email > Gmail & sending for reliable delivery.';
    }
    if ($stage === 'api' && $c['provider'] === 'ses_api') {
        if (stripos($err, 'not verified') !== false) {
            return stripos($err, 'identities failed') !== false && stripos($err, $c['from']) === false
                ? 'Your Amazon SES account is still in the sandbox, where it can only send to verified addresses. In the SES console open Account dashboard › Request production access.'
                : 'Amazon SES has not verified the From address or its domain. In SES › Identities, verify ' . $c['from'] . ' or its domain (add the DKIM records it shows).';
        }
        if (preg_match('/UnrecognizedClient|InvalidSignature|SignatureDoesNotMatch|security token/i', $err)) {
            return 'Amazon did not accept the access key. Create an access key for an IAM user with the AmazonSESFullAccess policy (or ses:SendEmail, ses:SendRawEmail and ses:GetAccount), paste both parts, and check the region.';
        }
        if (stripos($err, 'AccessDenied') !== false) {
            return 'The access key works but is not allowed to send. Give its IAM user the ses:SendEmail and ses:SendRawEmail permissions.';
        }
        if (stripos($err, 'SendingPaused') !== false || stripos($err, 'AccountSuspended') !== false) {
            return 'Amazon has paused sending on this account, usually because of high bounce or complaint rates. Open the SES console › Account dashboard to see why and ask for a review.';
        }
        if (stripos($err, 'quota') !== false || stripos($err, 'LimitExceeded') !== false) {
            return 'The 24-hour sending quota of the SES account is used up. Queued email continues automatically; ask for a higher quota under SES › Account dashboard.';
        }
        if (stripos($err, 'ConfigurationSet') !== false || stripos($err, 'NotFound') !== false) {
            return 'Amazon SES does not know the configuration set named in the settings. Check its exact name, or leave the box empty.';
        }
        return $code === 0 ? 'The website could not reach Amazon SES over HTTPS. Ask your host whether outgoing connections to email.' . $c['region'] . '.amazonaws.com are allowed.' : 'Amazon SES refused the message. Check the From address is verified in SES and the region matches.';
    }
    if ($stage === 'api' && $c['provider'] === 'postal') {
        if (stripos($err, 'UnauthenticatedFromAddress') !== false) {
            return 'Your Postal server does not allow this From address. In Postal open the mail server › Domains, add ' . substr((string) strrchr($c['from'], '@'), 1) . ' and publish its DNS records until they show green.';
        }
        if (preg_match('/AccessDenied|InvalidServerAPIKey|ServerSuspended/i', $err)) {
            return 'Postal did not accept the API key. In Postal open the mail server › Credentials, add one with the type API, and paste its key here.';
        }
        return $code === 0 ? 'The website could not reach your Postal server. Check the address (https://postal.yourdomain.com), that the server is running, and that its certificate is valid.' : 'Postal refused the message. Open the mail server in Postal and look at Messages › Activity for the reason.';
    }
    if ($stage === 'api') {
        if ($code === 401) {
            return 'Mailgun did not accept the API key. Copy the private API key from Mailgun > API keys (it starts with "key-" or looks like a long hex string) and check the region (US or EU).';
        }
        if ($code === 404) {
            return 'Mailgun does not know that sending domain. Use the exact domain name shown under Mailgun > Sending > Domains (for a sandbox domain, add the recipient as an authorized recipient first).';
        }
        if ($code === 0) {
            return 'The website could not reach the Mailgun API over HTTPS. Ask your host whether outgoing connections to api.mailgun.net (or api.eu.mailgun.net) are allowed.';
        }
        return 'Mailgun refused the message. Check the sending domain is verified (DNS records added) and the From address uses that domain.';
    }
    if ($stage === 'connect' && $code === 0) {
        return "The website couldn't reach {$c['host']} on port {$c['port']}. Many shared hosts block outgoing mail ports: ask your host to allow outgoing SMTP to {$c['host']}, or try the other connection type (port 465 with SSL, or 587 with STARTTLS).";
    }
    if ($stage === 'tls') {
        return 'The secure connection could not be set up. Try the other connection type (port 465 with SSL, or 587 with STARTTLS).';
    }
    if ($stage === 'auth' || in_array($code, [534, 535], true)) {
        return $google
            ? 'Google did not accept the sign-in. Use the full Gmail address and a 16-character App Password (Google Account > Security > 2-Step Verification > App passwords), not the normal password.'
            : 'The mail server did not accept the username or password.';
    }
    if (
        str_contains($err, '5.4.5') ||
        stripos($err, 'quota') !== false ||
        stripos($err, 'sending limit') !== false
    ) {
        return 'This mailbox has reached its daily sending limit. Queued email continues automatically once the 24-hour window allows.';
    }
    if ($stage === 'from') {
        return $google
            ? 'Google refused the sender address. The From address has to be this Gmail address or a "Send mail as" address added in Gmail settings.'
            : 'The mail server refused the sender (From) address.';
    }
    if ($stage === 'rcpt') {
        return 'The receiving server refused this address; it may be mistyped or no longer exist.';
    }
    return '';
}

/* ---------- SMTP ---------- */

/** One connection to the mail server that can send several messages in a row (used for mass email). */
final class SmtpSession
{
    public string $error = '';
    public string $stage = '';
    public int $code = 0;
    /** @var resource|null */
    private $fp = null;

    public function __construct(private array $cfg) {}

    public function open(): bool
    {
        $host = (string) $this->cfg['host'];
        $port = (int) $this->cfg['port'];
        $secure = (string) $this->cfg['secure'];
        if ($host === '' || $port <= 0) {
            return $this->fail('connect', 0, 'No mail server is set up.');
        }
        $ctx = stream_context_create(['ssl' => ['SNI_enabled' => true, 'peer_name' => $host]]);
        $errno = 0;
        $errstr = '';
        $this->fp =
            @stream_socket_client(
                ($secure === 'ssl' ? 'ssl://' : 'tcp://') . "$host:$port",
                $errno,
                $errstr,
                20,
                STREAM_CLIENT_CONNECT,
                $ctx,
            ) ?:
            null;
        if (!$this->fp) {
            return $this->fail(
                'connect',
                0,
                "Could not connect to $host:$port" . ($errstr !== '' ? " ($errstr)" : '') . '.',
            );
        }
        stream_set_timeout($this->fp, 25);
        if (!$this->expect('', [220], 'connect') || !$this->hello()) {
            return false;
        }
        if ($secure === 'tls') {
            if (!$this->expect('STARTTLS', [220], 'tls')) {
                return false;
            }
            $method = STREAM_CRYPTO_METHOD_TLS_CLIENT;
            if (defined('STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT')) {
                $method |= STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT;
            }
            if (defined('STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT')) {
                $method |= STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT;
            }
            if (!@stream_socket_enable_crypto($this->fp, true, $method)) {
                $this->close();
                return $this->fail('tls', 0, 'The secure connection (STARTTLS) failed.');
            }
            if (!$this->hello()) {
                return false;
            }
        }
        if ((string) $this->cfg['user'] !== '') {
            if (
                !$this->expect('AUTH LOGIN', [334], 'auth') ||
                !$this->expect(base64_encode((string) $this->cfg['user']), [334], 'auth') ||
                !$this->expect(base64_encode((string) $this->cfg['pass']), [235], 'auth')
            ) {
                return false;
            }
        }
        return true;
    }

    public function send(string $from, array $rcpts, string $raw): bool
    {
        if (!$this->fp) {
            return $this->fail('connect', 0, 'The connection to the mail server was closed.');
        }
        if (!$this->expect("MAIL FROM:<$from>", [250], 'from')) {
            return $this->reset();
        }
        foreach ($rcpts as $to) {
            if (!$this->expect("RCPT TO:<$to>", [250, 251], 'rcpt')) {
                return $this->reset();
            }
        }
        if (!$this->expect('DATA', [354], 'data')) {
            return $this->reset();
        }
        $data = preg_replace('/^\./m', '..', rtrim($raw, "\r\n")) . "\r\n.";
        if (!$this->expect($data, [250], 'data')) {
            return $this->reset();
        }
        return true;
    }

    public function close(): void
    {
        if ($this->fp) {
            @fwrite($this->fp, "QUIT\r\n");
            @fclose($this->fp);
            $this->fp = null;
        }
    }

    private function hello(): bool
    {
        return $this->expect('EHLO ' . mailHost(), [250], 'connect');
    }

    /** After a refused message the connection can be used again for the next one. */
    private function reset(): bool
    {
        if ($this->fp) {
            @fwrite($this->fp, "RSET\r\n");
            if ($this->read() === '') {
                $this->close();
            }
        }
        return false;
    }

    private function read(): string
    {
        $out = '';
        while ($this->fp && ($line = fgets($this->fp, 2048)) !== false) {
            $out .= $line;
            if (strlen($line) < 4 || $line[3] !== '-') {
                break;
            }
        }
        return $out;
    }

    private function expect(string $cmd, array $codes, string $stage): bool
    {
        if (!$this->fp) {
            return $this->fail($stage, 0, 'The connection to the mail server was closed.');
        }
        if ($cmd !== '') {
            @fwrite($this->fp, $cmd . "\r\n");
        }
        $reply = $this->read();
        $code = (int) substr($reply, 0, 3);
        if (in_array($code, $codes, true)) {
            return true;
        }
        if ($reply === '') {
            $this->close();
            return $this->fail($stage, 0, 'The mail server stopped answering.');
        }
        if (!preg_match('/^[2-5]\d\d(?:[ -]|\r?\n|$)/', $reply)) {
            // v83: something that is not a mail server answered: its words are not shown back
            $this->close();
            return $this->fail($stage, 0, 'The server on that port did not answer like a mail server.');
        }
        return $this->fail($stage, $code, trim((string) preg_replace('/\s+/', ' ', $reply)));
    }

    private function fail(string $stage, int $code, string $message): bool
    {
        $this->stage = $stage;
        $this->code = $code;
        $this->error = mb_substr($message, 0, 400);
        return false;
    }
}

/**
 * Sends one message with the current settings and records it in the sent log.
 * $m: to, name, subject, text, html, atts, reply, cc, headers, kind, ref, from_name.
 * Pass an open SmtpSession to reuse one connection for many messages.
 */
function mailDeliver(array $m, ?SmtpSession $session = null): bool
{
    $c = mailSettings();
    $to = strtolower(trim((string) ($m['to'] ?? '')));
    $name = (string) ($m['name'] ?? '');
    $subject = (string) ($m['subject'] ?? '');
    $kind = (string) ($m['kind'] ?? ($GLOBALS['mailKind'] ?? ''));
    $ref = (string) ($m['ref'] ?? '');
    $GLOBALS['mailErr'] = '';
    $GLOBALS['mailFail'] = ['stage' => '', 'code' => 0];
    // v83: a security email's one-time code never goes into the logs (the sent log and mail.log are read by staff)
    $logSubject = $kind === 'security' ? (string) preg_replace('/\b\d{6,8}\b/', '******', $subject) : $subject;
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
        $GLOBALS['mailErr'] = 'Not a valid email address.';
        $GLOBALS['mailFail'] = ['stage' => 'rcpt', 'code' => 553];
        mailRecord($to, $name, $logSubject, $kind, false, $GLOBALS['mailErr'], $ref);
        return false;
    }
    // v37: in a company workspace, emails written for StratEdge's own site carry the company's name
    if (wsSlug() !== '') {
        $subject = wsBrandText($subject);
        $m['subject'] = $subject;
        $logSubject = $kind === 'security' ? (string) preg_replace('/\b\d{6,8}\b/', '******', $subject) : $subject;
        $m['text'] = wsBrandText((string) ($m['text'] ?? ''));
        $m['html'] = wsBrandText((string) ($m['html'] ?? ''), true);
    }
    $from = $c['from'];
    $fromName = (string) ($m['from_name'] ?? '' ?: $c['from_name']);
    $cc = (string) ($m['cc'] ?? '');
    // v37: a company workspace that still sends through StratEdge's mail service gets the replies at its own contact
    // address (its own mail settings, once saved, send from its own address instead)
    if ((string) ($m['reply'] ?? '') === '' && empty($c['saved'])) {
        $dr = strtolower(trim((string) (cfg('mail_reply_to') ?? '')));
        if ($dr !== '' && filter_var($dr, FILTER_VALIDATE_EMAIL) && $dr !== $to) {
            $m['reply'] = $dr;
        }
    }
    // v83: Cc and Reply-To carry only valid addresses (no line breaks into the headers); the header, the envelope
    // and the mail service's API all use the same cleaned values
    $ccList = [];
    foreach (explode(',', str_replace(["\r", "\n"], ',', $cc)) as $x) {
        $x = trim($x);
        if ($x !== '' && filter_var($x, FILTER_VALIDATE_EMAIL) && strcasecmp($x, $to) !== 0 && !in_array($x, $ccList, true)) {
            $ccList[] = $x;
        }
    }
    $cc = implode(', ', $ccList);
    $m['cc'] = $cc;
    $reply = trim(str_replace(["\r", "\n"], ' ', (string) ($m['reply'] ?? '')));
    if ($reply !== '' && !filter_var($reply, FILTER_VALIDATE_EMAIL) && !(preg_match('/^[^<>]*<([^<>\s]+)>$/', $reply, $rm) && filter_var($rm[1], FILTER_VALIDATE_EMAIL))) {
        $reply = '';
    }
    $m['reply'] = $reply;
    [$headers, $body] = buildMime(
        $fromName,
        $from,
        $to,
        $name,
        $subject,
        (string) ($m['text'] ?? ''),
        (string) ($m['html'] ?? ''),
        $m['atts'] ?? [],
        (string) ($m['reply'] ?? ''),
        $cc,
        $m['headers'] ?? [],
    );
    $rcpts = [$to];
    foreach (explode(',', $cc) as $x) {
        $x = trim($x);
        if ($x !== '' && filter_var($x, FILTER_VALIDATE_EMAIL) && !in_array($x, $rcpts, true)) {
            $rcpts[] = $x;
        }
    }
    $err = '';
    if ($c['transport'] === 'api') {
        // Mailgun, Postal or Amazon SES over HTTPS
        $res = mailApiSend($c, $m + ['to' => $to, 'name' => $name, 'subject' => $subject, 'kind' => $kind, 'ref' => $ref]);
        $ok = $res['ok'];
        if (!$ok) {
            $err = $res['err'];
            $GLOBALS['mailFail'] = ['stage' => $res['why'] === 'addr' ? 'rcpt' : 'api', 'code' => $res['code'] === 0 && $res['why'] === 'addr' ? 550 : $res['code']];
        }
    } elseif ($c['transport'] === 'smtp') {
        $own = $session === null;
        $s = $session ?? new SmtpSession($c);
        $ok = (!$own || $s->open()) && $s->send($from, $rcpts, $headers . "\r\n" . $body);
        if (!$ok) {
            $err = $s->error;
            $GLOBALS['mailFail'] = ['stage' => $s->stage, 'code' => $s->code];
        }
        if ($own) {
            $s->close();
        }
    } else {
        $ok = @mail(
            $to,
            '=?UTF-8?B?' . base64_encode($subject) . '?=',
            $body,
            (string) preg_replace('/^(To|Subject):.*\r\n/m', '', $headers),
        );
        if (!$ok) {
            $err = 'The server\'s mail() function did not accept the message.';
        }
    }
    $GLOBALS['mailErr'] = $err;
    mailLog(($ok ? 'sent' : 'FAILED') . " to $to: $logSubject" . ($ok ? '' : " ($err)"));
    mailRecord($to, $name, $logSubject, $kind, $ok, $err, $ref);
    return $ok;
}

function mailRecord(
    string $to,
    string $name,
    string $subject,
    string $kind,
    bool $ok,
    string $err,
    string $ref,
): void {
    try {
        $u = currentUser();
        mdb()
            ->prepare(
                'INSERT INTO mail_log (id, at, to_email, to_name, subject, kind, status, err, ref, by_uid) VALUES (?,?,?,?,?,?,?,?,?,?)',
            )
            ->execute([
                rid(8),
                now(),
                mb_substr($to, 0, 190),
                mb_substr($name, 0, 190),
                mb_substr($subject, 0, 300),
                mb_substr($kind, 0, 30),
                $ok ? 'sent' : 'failed',
                mb_substr($err, 0, 500),
                mb_substr($ref, 0, 64),
                (string) ($u['id'] ?? ''),
            ]);
    } catch (Throwable $e) {
        // the log never stops a message from going out
    }
}

function mailSentSince(int $since): int
{
    $st = mdb()->prepare("SELECT COUNT(*) FROM mail_log WHERE status = 'sent' AND at > ?");
    $st->execute([$since]);
    return (int) $st->fetchColumn();
}

/* ---------- who may use it ---------- */

// mailCanUse() lives in lib.php (the portal shows the menu item from the same answer)

function mailUser(string $key = ''): array
{
    $u = requireUser();
    $r = (string) ($GLOBALS['mailKind'] ?? '');
    $key = $key !== '' ? $key : featureRouteKey($r);
    $d = (function () use ($u) {
        if (userLevel($u) >= 2) return true;
        $rr = myR((string) $u['id']);
        return (bool) ($rr && ($rr->st ?? '') === 'active' && !in_array($rr->role ?? '', ['employer','consultant','ext','student'], true) && (!empty($rr->mm) || in_array('employee', portalsOf($u), true)));
    })();
    $ok = $key !== '' && str_starts_with($key, 'mail_') ? featureAllowed($u, $key, $d) : featureAllowed($u, 'mail_contacts', $d);
    if (!$ok) {
        fail(403, 'forbidden', 'This email feature is not switched on for your account. Ask an administrator under Roles & access.');
    }
    return $u;
}

// the do-not-contact reasons that come from a privacy request (privacy.php)
const MAIL_SUPPRESS_PRIVACY = ['erased', 'privacy opt-out'];
/** v83: takes an address off the do-not-contact list. A privacy erasure or opt-out comes off only by an administrator's
 *  hand; every removal is audited. */
function mailUnsuppress(string $email): void
{
    $u = currentUser();
    $st = mdb()->prepare('SELECT why FROM mail_suppress WHERE email = ?');
    $st->execute([$email]);
    $why = $st->fetchColumn();
    if ($why === false) {
        return;
    }
    if (in_array((string) $why, MAIL_SUPPRESS_PRIVACY, true) && !($u && hasRole($u, 'admin'))) {
        fail(403, 'forbidden', 'This person asked for their data to be erased or not to be contacted. Only an administrator can allow email to them again.');
    }
    mdb()->prepare('DELETE FROM mail_suppress WHERE email = ?')->execute([$email]);
    audit('mail', 'Address allowed again', $email, ['why' => (string) $why], $u);
}

function mailOwner(): array
{
    $u = requireUser();
    if (!hasRole($u, 'admin')) {
        fail(403, 'forbidden', 'Only an administrator can change how email is sent.');
    }
    return $u;
}

/* ---------- message content ---------- */

function mailFirstName(string $name): string
{
    $parts = preg_split('/\s+/', trim($name)) ?: [];
    return (string) ($parts[0] ?? '');
}

/** Fills {first_name}, {name}, {email}, {company} and {title} for one recipient. */
function mailMerge(string $s, array $v): string
{
    $name = trim((string) ($v['name'] ?? ''));
    $first = mailFirstName($name);
    $map = [
        '{first_name}' => $first !== '' ? $first : 'there',
        '{name}' => $name !== '' ? $name : 'there',
        '{email}' => (string) ($v['email'] ?? ''),
        '{company}' => (string) ($v['company'] ?? ''),
        '{title}' => (string) ($v['title'] ?? ''),
        '{signature}' => (string) ($v['signature'] ?? ''), // v69: the sender's email signature
    ];
    return str_ireplace(array_keys($map), array_values($map), $s);
}

function mailParagraphs(string $body): string
{
    $out = '';
    foreach (preg_split("/\r?\n[ \t]*\r?\n/", trim($body)) ?: [] as $para) {
        if (trim($para) === '') {
            continue;
        }
        $h = htmlspecialchars(trim($para), ENT_QUOTES, 'UTF-8');
        $h = (string) preg_replace(
            '~https?://[^\s<]+[^\s<.,;:!?)\]\'"]~i',
            '<a href="$0" style="color:#2B3993">$0</a>',
            $h,
        );
        $out .=
            '<p style="margin:0 0 14px;font:15px/1.6 Arial,Helvetica,sans-serif;color:#1f2a44">' .
            nl2br($h) .
            '</p>';
    }
    return $out;
}

function mailMassHtml(string $body, string $btnText, string $btnUrl, string $unsubUrl): string
{
    $br = emailBrand(); // v37: a company workspace's campaigns carry its own name and address
    $button = '';
    if ($btnText !== '' && $btnUrl !== '') {
        $button =
            '<p style="margin:22px 0"><a href="' .
            htmlspecialchars($btnUrl) .
            '" style="display:inline-block;background:' . $br['btn'] . ';color:#fff;' .
            'text-decoration:none;font:700 15px Arial,Helvetica,sans-serif;padding:13px 22px;border-radius:10px">' .
            htmlspecialchars($btnText) .
            '</a></p>';
    }
    $unsub =
        $unsubUrl !== ''
            ? '<br>You are receiving this email from ' . htmlspecialchars($br['name']) . '. <a href="' .
                htmlspecialchars($unsubUrl) .
                '" style="color:#7a87a6">Unsubscribe</a>'
            : '';
    return '<!doctype html><html><body style="margin:0;background:#f4f7fa;padding:24px">' .
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">' .
        '<table role="presentation" width="600" style="max-width:600px;background:#fff;border-radius:16px;border:1px solid #dce3ec" cellspacing="0" cellpadding="0">' .
        '<tr><td style="padding:26px 30px 6px">' . $br['head'] . '</td></tr>' .
        '<tr><td style="padding:14px 30px 22px">' .
        mailParagraphs($body) .
        $button .
        '</td></tr>' .
        '<tr><td style="padding:16px 30px;border-top:1px solid #dce3ec;font:12px/1.6 Arial,sans-serif;color:#7a87a6">' .
        $br['mfoot'] .
        $unsub .
        '</td></tr></table></td></tr></table></body></html>';
}

function mailMassText(string $body, string $btnText, string $btnUrl, string $unsubUrl): string
{
    $text = trim($body);
    if ($btnText !== '' && $btnUrl !== '') {
        $text .= "\n\n$btnText: $btnUrl";
    }
    $text .= "\n\n--\n" . emailBrand()['text'];
    if ($unsubUrl !== '') {
        $text .= "\nUnsubscribe: $unsubUrl";
    }
    return $text;
}

/** Builds one recipient's copy of a campaign. */
function mailCampaignMessage(array $camp, array $q): array
{
    $vars = json_decode((string) $q['vars'], true) ?: [];
    $v = ['email' => $q['email'], 'name' => $q['name']] + $vars;
    $v['signature'] = sigOf((string) ($camp['by_uid'] ?? '')); // v69
    $base = (string) ($camp['base'] ?: siteUrl());
    $page = $base . '#/unsubscribe?t=' . $q['tok'];
    $oneClick = $base . 'api/index.php?r=unsub&t=' . $q['tok'];
    $from = mailSettings()['from'];
    $body = (string) $camp['body'];
    // v31: requirement lists shared from the requirements desk; each person gets the list without the ones that came
    // from their own company ({requirements} in the message, the blocks kept with the campaign's audience)
    $reqs = null;
    if (str_contains($body, '{requirements}')) {
        $aud = json_decode((string) ($camp['audience'] ?? ''), true) ?: [];
        $reqs = mailReqBlocks((array) ($aud['reqs'] ?? []), (array) ($vars['skip'] ?? []));
        $body = str_replace('{requirements}', '%%REQUIREMENTS%%', $body);
    }
    $body = mailMerge($body, $v);
    $btnUrl = (string) $camp['btn_url'];
    $html = mailMassHtml($body, (string) $camp['btn_text'], $btnUrl, $page);
    $text = mailMassText($body, (string) $camp['btn_text'], $btnUrl, $page);
    if ($reqs !== null) {
        $html = str_replace('%%REQUIREMENTS%%', $reqs['html'], $html);
        $text = str_replace('%%REQUIREMENTS%%', $reqs['text'], $text);
    }
    $fromDom = substr($from, (int) strrpos($from, '@') + 1) ?: mailHost();
    $headers = [
        'List-Unsubscribe' => "<$oneClick>, <mailto:$from?subject=unsubscribe>",
        'List-Unsubscribe-Post' => 'List-Unsubscribe=One-Click',
        // v34: one Message-ID per recipient that names the campaign (replies and bounce reports find their way
        // back), and Gmail's feedback-loop header: campaign : kind : sender : the company's sender id
        'Message-ID' => '<' . $q['tok'] . '.' . $camp['id'] . '.mass@' . $fromDom . '>',
        'Feedback-ID' => $camp['id'] . ':mass:' . substr((string) preg_replace('/[^A-Za-z0-9]/', '', (string) $camp['by_uid']), 0, 24) . ':stratedge',
    ];
    if (mailSettings()['provider'] === 'postal') {
        $headers['X-Postal-Tag'] = $camp['id'];
    }
    // v37.5: a distribution list's email says so (its own address drops copies that come back: no loops)
    $audL = json_decode((string) ($camp['audience'] ?? ''), true) ?: [];
    $dlIds = !empty($audL['dl']) ? [(string) $audL['dl']] : array_values(array_filter((array) ($audL['spec']['lists'] ?? []), 'is_string'));
    if ($dlIds) {
        $headers['X-SE-List'] = implode(',', array_slice($dlIds, 0, 5));
        $headers['List-Id'] = '<' . $dlIds[0] . '.lists.' . $fromDom . '>';
    }
    return [
        'subject' => mailMerge((string) $camp['subject'], $v),
        'html' => $html,
        'text' => $text,
        'headers' => $headers,
    ];
}

/**
 * v31: the requirement list in a shared-requirements email, numbered, without the ones in $skip.
 * $blocks: [{id, t: text lines, h: html lines}] prepared by reqshare.php.
 */
function mailReqBlocks(array $blocks, array $skip): array
{
    $skip = array_flip(array_map('strval', $skip));
    $text = [];
    $html = [];
    $i = 0;
    foreach ($blocks as $b) {
        if (!is_array($b) || isset($skip[(string) ($b['id'] ?? '')])) {
            continue;
        }
        $i++;
        $text[] = $i . '. ' . (string) ($b['t'] ?? '');
        $html[] = '<b style="font-size:16px;color:#1f2a44">' . $i . '. </b>' . (string) ($b['h'] ?? '');
    }
    return ['text' => implode("\n\n", $text), 'html' => implode('<br><br>', $html), 'n' => $i];
}

/* ---------- recipients ---------- */

/** Reads a whole collection straight from the document store (permissions are checked by the caller). */
function docsIn(string $col): array
{
    $st = db()->prepare('SELECT path, data FROM docs WHERE col = ?');
    $st->execute([$col]);
    $out = [];
    while ($row = $st->fetch()) {
        $d = json_decode($row['data']);
        $out[substr($row['path'], strrpos($row['path'], '/') + 1)] =
            $d instanceof stdClass ? $d : new stdClass();
    }
    return $out;
}

/** Portal members by group: employees (StratEdge staff and recruiters), consultants and client contacts. */
function mailMembers(): array
{
    $users = docsIn('u');
    $out = ['employees' => [], 'consultants' => [], 'clients' => []];
    foreach (docsIn('r') as $uid => $r) {
        if (($r->st ?? '') !== 'active' || !isset($users[$uid]->p)) {
            continue;
        }
        $p = $users[$uid]->p;
        $email = strtolower(trim((string) ($p->e ?? '')));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            continue;
        }
        $role = (string) ($r->role ?? 'consultant');
        $group = $role === 'employer' ? 'clients' : ($role === 'consultant' ? 'consultants' : 'employees');
        $out[$group][] = [
            'email' => $email,
            'name' => (string) ($p->n ?? ''),
            'company' => (string) ($r->cl ?? ($p->co ?? '')),
            'title' => (string) ($p->ti ?? ''),
        ];
    }
    return $out;
}

function mailTagsNorm($tags): string
{
    $list = is_array($tags) ? $tags : explode(',', (string) $tags);
    $seen = [];
    foreach ($list as $t) {
        $t = mb_substr(trim(str_replace(',', ' ', (string) $t)), 0, 40);
        if ($t !== '' && !isset($seen[mb_strtolower($t)])) {
            $seen[mb_strtolower($t)] = $t;
        }
    }
    $out = implode(',', array_slice(array_values($seen), 0, 20));
    return $out === '' ? '' : ",$out,";
}

function mailTagsList(string $stored): array
{
    return array_values(array_filter(array_map('trim', explode(',', $stored)), fn($t) => $t !== ''));
}

/** "Name <email>", "email", "Name, email" or a pasted spreadsheet: one person per line. */
function mailParseList(string $text): array
{
    $out = [];
    foreach (preg_split('/\r?\n|;/', $text) ?: [] as $line) {
        if (!preg_match_all('/[A-Z0-9._%+\'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i', $line, $m)) {
            continue;
        }
        foreach ($m[0] as $email) {
            $name =
                count($m[0]) === 1
                    ? trim((string) preg_replace('/[<>"\'\t,]+/', ' ', str_replace($email, '', $line)))
                    : '';
            $out[] = [
                'email' => strtolower($email),
                'name' => mb_substr((string) preg_replace('/\s+/', ' ', $name), 0, 120),
            ];
        }
    }
    return $out;
}

function mailSuppressed(): array
{
    $out = [];
    foreach (mdb()->query('SELECT email FROM mail_suppress') as $row) {
        $out[$row['email']] = true;
    }
    return $out;
}

/**
 * Resolves an audience into individual recipients, without duplicates or unsubscribed addresses.
 * $a: groups[] (staff only), ats + atsStage (staff only), rec, contacts + tags[], ids[], paste.
 */
function mailAudience(array $a, array $u): array
{
    $staff = userLevel($u) >= 2;
    $found = [];
    $add = function (string $email, string $name, array $vars) use (&$found) {
        $e = strtolower(trim($email));
        if ($e === '' || !filter_var($e, FILTER_VALIDATE_EMAIL)) {
            return;
        }
        if (!isset($found[$e])) {
            $found[$e] = [
                'email' => $e,
                'name' => trim($name),
                'vars' => array_filter($vars, fn($x) => $x !== ''),
            ];
        } elseif ($found[$e]['name'] === '' && trim($name) !== '') {
            $found[$e]['name'] = trim($name);
        }
    };
    if ($staff) {
        $groups = array_values(
            array_intersect((array) ($a['groups'] ?? []), ['employees', 'consultants', 'clients']),
        );
        if ($groups) {
            foreach (mailMembers() as $g => $list) {
                if (in_array($g, $groups, true)) {
                    foreach ($list as $p) {
                        $add($p['email'], $p['name'], ['company' => $p['company'], 'title' => $p['title']]);
                    }
                }
            }
        }
        if (!empty($a['ats'])) {
            $stage = (string) ($a['atsStage'] ?? '');
            foreach (docsIn('ats') as $c) {
                $st = (string) ($c->st ?? 'new');
                if ($stage === '' ? $st === 'rejected' : $st !== $stage) {
                    continue;
                }
                $add((string) ($c->e ?? ''), (string) ($c->n ?? ''), ['title' => (string) ($c->jt ?? '')]);
            }
        }
    }
    // v31: vendor and client contacts from Vendors & clients (the requirements desk), by kind
    if (!empty($a['vms']) && ($staff || isRecruiter($u['id']) || isBench($u['id']))) {
        $types = array_values(array_filter((array) ($a['vmsTypes'] ?? []), 'is_string'));
        foreach (docsIn('vms/vendor/items') as $vid => $v) {
            if ($types && !in_array((string) ($v->type ?? 'Prime vendor'), $types, true)) {
                continue;
            }
            foreach ((array) ($v->contacts ?? []) as $c) {
                $c = (object) $c;
                $add((string) ($c->e ?? ''), (string) ($c->n ?? ''), [
                    'company' => (string) ($v->n ?? ''),
                    'title' => (string) ($c->ti ?? ''),
                    'vid' => (string) $vid,
                ]);
            }
        }
    }
    if (!empty($a['rec'])) {
        foreach (docsIn('rec/cand/items') as $c) {
            $add((string) ($c->e ?? ''), (string) ($c->n ?? ''), ['title' => (string) ($c->ti ?? '')]);
        }
    }
    if (!empty($a['contacts']) || !empty($a['ids'])) {
        $pdo = mdb();
        $ids = array_slice(array_filter((array) ($a['ids'] ?? []), 'is_string'), 0, MAIL_MAX_RECIPIENTS);
        if ($ids) {
            foreach (array_chunk($ids, 400) as $chunk) {
                $st = $pdo->prepare(
                    'SELECT email, name, company, title FROM mail_contacts WHERE id IN (' .
                        implode(',', array_fill(0, count($chunk), '?')) .
                        ')',
                );
                $st->execute($chunk);
                foreach ($st as $c) {
                    $add($c['email'], $c['name'], ['company' => $c['company'], 'title' => $c['title']]);
                }
            }
        }
        if (!empty($a['contacts'])) {
            $tags = array_values(
                array_filter(
                    array_map(fn($t) => mb_strtolower(trim((string) $t)), (array) ($a['tags'] ?? [])),
                ),
            );
            $sql = 'SELECT email, name, company, title FROM mail_contacts';
            $args = [];
            if ($tags) {
                $sql .= ' WHERE ' . implode(' OR ', array_fill(0, count($tags), 'LOWER(tags) LIKE ?'));
                foreach ($tags as $t) {
                    $args[] = '%,' . $t . ',%';
                }
            }
            $st = $pdo->prepare($sql . ' ORDER BY created LIMIT ' . MAIL_MAX_RECIPIENTS * 2);
            $st->execute($args);
            foreach ($st as $c) {
                $add($c['email'], $c['name'], ['company' => $c['company'], 'title' => $c['title']]);
            }
        }
    }
    // v37.5: distribution lists this person may send to (their members and self-updating selection, without people who
    // left the list)
    if (!empty($a['lists']) && is_array($a['lists'])) {
        require_once __DIR__ . '/maillists.php';
        foreach (dlAudience($a['lists'], $u) as $p) {
            $add($p['email'], $p['name'], $p['vars'] ?? []);
        }
    }
    $pasted = mailParseList((string) ($a['paste'] ?? ''));
    foreach ($pasted as $p) {
        $add($p['email'], $p['name'], []);
    }
    $sup = mailSuppressed();
    $list = [];
    $skipped = 0;
    foreach ($found as $e => $p) {
        if (isset($sup[$e])) {
            $skipped++;
        } else {
            $list[] = $p;
        }
    }
    return ['list' => $list, 'suppressed' => $skipped, 'pasted' => $pasted];
}

/** How many people each source would reach, for the compose screen. */
function mailSources(array $u): array
{
    $staff = userLevel($u) >= 2;
    $pdo = mdb();
    $tags = [];
    foreach ($pdo->query('SELECT tags, COUNT(*) AS n FROM mail_contacts GROUP BY tags') as $row) {
        foreach (mailTagsList((string) $row['tags']) as $t) {
            $tags[$t] = ($tags[$t] ?? 0) + (int) $row['n'];
        }
    }
    ksort($tags, SORT_NATURAL | SORT_FLAG_CASE);
    $rec = 0;
    foreach (docsIn('rec/cand/items') as $c) {
        if (filter_var((string) ($c->e ?? ''), FILTER_VALIDATE_EMAIL)) {
            $rec++;
        }
    }
    $out = [
        'staff' => $staff,
        'contacts' => (int) $pdo->query('SELECT COUNT(*) FROM mail_contacts')->fetchColumn(),
        'tags' => $tags,
        'rec' => $rec,
    ];
    // v37.5: the distribution lists this person may send to
    try {
        require_once __DIR__ . '/maillists.php';
        $out['lists'] = dlForSender($u);
    } catch (Throwable $e) {
        $out['lists'] = [];
    }
    // v31: vendor and client contacts (Vendors & clients), for people who work the requirements desk
    if ($staff || isRecruiter($u['id']) || isBench($u['id'])) {
        $vt = [];
        $vn = 0;
        foreach (docsIn('vms/vendor/items') as $v) {
            $n = 0;
            foreach ((array) ($v->contacts ?? []) as $c) {
                if (filter_var((string) (((object) $c)->e ?? ''), FILTER_VALIDATE_EMAIL)) {
                    $n++;
                }
            }
            $t = (string) ($v->type ?? 'Prime vendor');
            $vt[$t] = ($vt[$t] ?? 0) + $n;
            $vn += $n;
        }
        $out['vms'] = ['n' => $vn, 'types' => $vt];
    }
    if ($staff) {
        foreach (mailMembers() as $g => $list) {
            $out[$g] = count($list);
        }
        $ats = ['all' => 0];
        foreach (docsIn('ats') as $c) {
            if (!filter_var((string) ($c->e ?? ''), FILTER_VALIDATE_EMAIL)) {
                continue;
            }
            $st = (string) ($c->st ?? 'new');
            $ats[$st] = ($ats[$st] ?? 0) + 1;
            if ($st !== 'rejected') {
                $ats['all']++;
            }
        }
        $out['ats'] = $ats;
    }
    return $out;
}

/* ---------- contacts ---------- */

function mailContactOut(array $c): array
{
    return [
        'id' => $c['id'],
        'email' => $c['email'],
        'name' => $c['name'],
        'company' => $c['company'],
        'title' => $c['title'],
        'phone' => $c['phone'],
        'city' => $c['city'],
        'tags' => mailTagsList((string) $c['tags']),
        'source' => $c['source'],
        'notes' => $c['notes'],
        'created' => (int) $c['created'],
        'updated' => (int) $c['updated'],
        'lastSent' => (int) $c['last_sent'],
        'unsub' => $c['why'] ?? null,
    ];
}

/** Adds new addresses and fills in blanks on existing ones; tags are added, never removed. */
function mailUpsertContacts(array $rows, array $extraTags, string $source, string $uid): array
{
    $pdo = mdb();
    $now = now();
    $added = 0;
    $updated = 0;
    $invalid = 0;
    $find = $pdo->prepare('SELECT * FROM mail_contacts WHERE email = ?');
    $insert = $pdo->prepare('INSERT INTO mail_contacts (id, email, name, company, title, phone, city, tags, source, notes, created, updated, by_uid, last_sent)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0)');
    $update = $pdo->prepare(
        'UPDATE mail_contacts SET name = ?, company = ?, title = ?, phone = ?, city = ?, tags = ?, notes = ?, updated = ? WHERE id = ?',
    );
    $pdo->beginTransaction();
    try {
        foreach ($rows as $r) {
            if (!is_array($r)) {
                $invalid++;
                continue;
            }
            $email = strtolower(trim((string) ($r['email'] ?? '')));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                $invalid++;
                continue;
            }
            $f = fn(string $k, int $max) => mb_substr(trim((string) ($r[$k] ?? '')), 0, $max);
            $find->execute([$email]);
            $cur = $find->fetch();
            $tags = mailTagsNorm(
                array_merge(
                    $cur ? mailTagsList((string) $cur['tags']) : [],
                    mailTagsList(mailTagsNorm($r['tags'] ?? '')),
                    $extraTags,
                ),
            );
            if ($cur) {
                $update->execute([
                    $cur['name'] ?: $f('name', 190),
                    $cur['company'] ?: $f('company', 190),
                    $cur['title'] ?: $f('title', 190),
                    $cur['phone'] ?: $f('phone', 60),
                    $cur['city'] ?: $f('city', 120),
                    $tags,
                    $cur['notes'] ?: $f('notes', 2000),
                    $now,
                    $cur['id'],
                ]);
                $updated++;
            } else {
                $insert->execute([
                    rid(8),
                    $email,
                    $f('name', 190),
                    $f('company', 190),
                    $f('title', 190),
                    $f('phone', 60),
                    $f('city', 120),
                    $tags,
                    mb_substr($f('source', 80) ?: $source, 0, 80),
                    $f('notes', 2000),
                    $now,
                    $now,
                    $uid,
                ]);
                $added++;
            }
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    return ['added' => $added, 'updated' => $updated, 'invalid' => $invalid];
}

function mailContactsQuery(array $b): array
{
    $where = [];
    $args = [];
    $q = mb_strtolower(trim(str($b, 'q', 120)));
    if ($q !== '') {
        $where[] =
            '(LOWER(c.email) LIKE ? OR LOWER(c.name) LIKE ? OR LOWER(c.company) LIKE ? OR LOWER(c.title) LIKE ? OR LOWER(c.city) LIKE ? OR LOWER(c.tags) LIKE ?)';
        array_push($args, ...array_fill(0, 6, "%$q%"));
    }
    $tag = mb_strtolower(trim(str($b, 'tag', 40)));
    if ($tag !== '') {
        $where[] = 'LOWER(c.tags) LIKE ?';
        $args[] = "%,$tag,%";
    }
    $status = str($b, 'status', 12);
    if ($status === 'subscribed') {
        $where[] = 's.email IS NULL';
    } elseif ($status === 'unsub') {
        $where[] = 's.email IS NOT NULL';
    }
    $sql =
        ' FROM mail_contacts c LEFT JOIN mail_suppress s ON s.email = c.email' .
        ($where ? ' WHERE ' . implode(' AND ', $where) : '');
    return [$sql, $args];
}

/* ---------- campaigns ---------- */

function mailCampaignOut(array $c): array
{
    $aud = json_decode((string) $c['audience'], true) ?: [];
    $meta = mailCampaignMeta($c);
    $held = null;
    if (in_array($c['status'], ['queued', 'sending'], true)) {
        $st = mdb()->prepare("SELECT COUNT(*) AS n, MIN(nb) AS nb FROM mail_queue WHERE campaign = ? AND status = 'queued' AND nb > ?");
        $st->execute([$c['id'], now()]);
        $h = $st->fetch();
        $held = $h && (int) $h['n'] > 0 ? ['n' => (int) $h['n'], 'until' => (int) $h['nb']] : null;
    }
    return [
        'id' => $c['id'],
        'subject' => $c['subject'],
        'body' => $c['body'],
        'btnText' => $c['btn_text'],
        'btnUrl' => $c['btn_url'],
        'fromName' => $c['from_name'],
        'replyTo' => $c['reply_to'],
        'audience' => (string) ($aud['label'] ?? ''),
        'atts' => array_map(fn($x) => $x['name'], json_decode((string) $c['atts'], true) ?: []),
        'status' => $c['status'],
        'total' => (int) $c['total'],
        'sent' => (int) $c['sent'],
        'failed' => (int) $c['failed'],
        'skipped' => (int) $c['skipped'],
        'created' => (int) $c['created'],
        'started' => (int) $c['started'],
        'finished' => (int) $c['finished'],
        'by' => $c['by_name'],
        'byUid' => $c['by_uid'],
        'note' => $c['note'],
        // v34: what happened after sending, list cleaning, the inbox check, automatic pauses, held-back sends
        'delivered' => (int) ($c['delivered'] ?? 0),
        'bounced' => (int) ($c['bounced'] ?? 0),
        'complained' => (int) ($c['complained'] ?? 0),
        'clean' => $meta['clean'] ?? null,
        'score' => $meta['score'] ?? null,
        'auto' => $meta['auto'] ?? null,
        'held' => $held,
    ];
}

function mailCampaignGet(string $id): ?array
{
    $st = mdb()->prepare('SELECT * FROM mail_campaigns WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    return $row ?: null;
}

/** Recounts a campaign from its queue and marks it sent once nothing is left to send. */
function mailCampaignTally(string $id): void
{
    $pdo = mdb();
    $n = ['queued' => 0, 'sent' => 0, 'delivered' => 0, 'bounced' => 0, 'complained' => 0, 'failed' => 0, 'skipped' => 0, 'cancelled' => 0];
    $st = $pdo->prepare('SELECT status, COUNT(*) AS n FROM mail_queue WHERE campaign = ? GROUP BY status');
    $st->execute([$id]);
    foreach ($st as $row) {
        $n[$row['status']] = (int) $row['n'];
    }
    // "sent" counts everything the service accepted, whatever happened to it afterwards
    $pdo->prepare('UPDATE mail_campaigns SET sent = ?, delivered = ?, bounced = ?, complained = ?, failed = ?, skipped = ? WHERE id = ?')->execute([
        $n['sent'] + $n['delivered'] + $n['bounced'] + $n['complained'],
        $n['delivered'],
        $n['bounced'],
        $n['complained'],
        $n['failed'],
        $n['skipped'] + $n['cancelled'],
        $id,
    ]);
    if ($n['queued'] === 0) {
        $pdo->prepare(
            "UPDATE mail_campaigns SET status = 'done', finished = ? WHERE id = ? AND status IN ('queued', 'sending')",
        )->execute([now(), $id]);
    }
}

/** Reads the posted message (FormData field "data" plus attachments "att[]"). */
function mailPostedMessage(): array
{
    $d = json_decode((string) ($_POST['data'] ?? ''), true);
    if (!is_array($d)) {
        fail(400, 'invalid_argument', 'Bad request.');
    }
    $m = [
        'subject' => trim(str($d, 'subject', 250)),
        'body' => trim(str($d, 'body', 20000)),
        'btnText' => trim(str($d, 'btnText', 60)),
        'btnUrl' => trim(str($d, 'btnUrl', 500)),
        'fromName' => trim(str($d, 'fromName', 100)),
        'replyTo' => strtolower(trim(str($d, 'replyTo', 190))),
        'aud' => is_array($d['aud'] ?? null) ? $d['aud'] : [],
        'label' => trim(str($d, 'label', 300)),
    ];
    if ($m['subject'] === '' || $m['body'] === '') {
        fail(400, 'invalid_argument', 'Add a subject and a message.');
    }
    if ($m['replyTo'] !== '' && !filter_var($m['replyTo'], FILTER_VALIDATE_EMAIL)) {
        fail(400, 'invalid_argument', 'The reply-to address is not a valid email.');
    }
    if (
        ($m['btnText'] === '') !== ($m['btnUrl'] === '') ||
        ($m['btnUrl'] !== '' && !preg_match('~^https?://~i', $m['btnUrl']))
    ) {
        fail(400, 'invalid_argument', 'A button needs both its text and a link starting with https://.');
    }
    return $m;
}

/** Attachments sent with a campaign, kept on disk until the campaign is finished. */
function mailPostedFiles(string $dir): array
{
    $files = $_FILES['att'] ?? null;
    if (!$files || !is_array($files['name'] ?? null)) {
        return [];
    }
    $max = (int) (cfg('max_upload_mb') ?: 10) * 1048576;
    $total = 0;
    $out = [];
    foreach ($files['name'] as $i => $name) {
        if (($files['error'][$i] ?? 1) !== UPLOAD_ERR_OK) {
            fail(400, 'invalid_argument', 'An attachment did not upload. Try again.');
        }
        $ext = strtolower(pathinfo((string) $name, PATHINFO_EXTENSION));
        if (!isset(MIME[$ext])) {
            fail(400, 'invalid_argument', 'Attachments can be PDF, Word, Excel, CSV, text or image files.');
        }
        $size = (int) $files['size'][$i];
        $total += $size;
        if ($size > $max || $total > 15 * 1048576) {
            fail(400, 'invalid_argument', 'Attachments are too large. Keep them under 15 MB in total.');
        }
        uploadGuard((string) $files['tmp_name'][$i], basename((string) $name));
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        $safe = preg_replace('/[^A-Za-z0-9._ -]+/', '_', basename((string) $name)) ?: "file.$ext";
        $path = $dir . '/' . count($out) . '-' . $safe;
        if (!move_uploaded_file((string) $files['tmp_name'][$i], $path)) {
            fail(500, 'unavailable', 'The attachment could not be saved on the server.');
        }
        $out[] = ['name' => $safe, 'type' => MIME[$ext], 'file' => $path];
        if (count($out) >= 5) {
            break;
        }
    }
    return $out;
}

function mailLoadAtts(array $list): array
{
    $out = [];
    foreach ($list as $a) {
        $data = @file_get_contents((string) ($a['file'] ?? ''));
        if ($data !== false) {
            $out[] = ['name' => $a['name'], 'type' => $a['type'], 'data' => $data];
        }
    }
    return $out;
}

function mailCampaignCreate(array $u): array
{
    mailRoom();
    // v37: mass email from a company workspace goes through its own mail service, never StratEdge's borrowed one
    if (!empty(mailSettings()['viaProvider'])) {
        fail(400, 'invalid_argument', 'Connect your own mail service under Gmail & sending before sending mass email. Until then this portal sends only its everyday emails (sign-ins, documents, notices) for you.');
    }
    $m = mailPostedMessage();
    $aud = mailAudience($m['aud'], $u);
    $list = $aud['list'];
    if (!$list) {
        fail(
            400,
            'invalid_argument',
            $aud['suppressed']
                ? 'Everyone in this audience has unsubscribed.'
                : 'Pick at least one recipient.',
        );
    }
    // v34: list cleaning (typos, throwaway domains, addresses that bounced before, domains that take no email)
    $clean = null;
    if (mailSafety()['clean']) {
        $h = mailHygiene($list, 8000);
        if (!$h['list']) {
            fail(400, 'invalid_argument', 'None of these addresses can receive email: ' . implode('; ', array_slice($h['examples'], 0, 3)) . '.');
        }
        $list = $h['list'];
        $clean = ['n' => $h['n'], 'removed' => $h['removed'], 'examples' => $h['examples']];
    }
    // v34: each team member's daily limit (Email › Deliverability › Team limits)
    $cap = mailUserCap($u);
    if ($cap > 0) {
        $left = max(0, $cap - mailUserUsed((string) $u['id']));
        if (count($list) > $left) {
            fail(400, 'invalid_argument', 'Your limit is ' . number_format($cap) . ' emails a day and ' . ($left ? 'you have ' . number_format($left) . ' left today' : 'it is used up for today') . '. Send to fewer people, or ask an administrator to raise your limit.');
        }
    }
    if (count($list) > MAIL_MAX_RECIPIENTS) {
        fail(
            400,
            'invalid_argument',
            'One campaign can go to up to ' .
                number_format(MAIL_MAX_RECIPIENTS) .
                ' people. Split the audience by tag.',
        );
    }
    $id = rid(8);
    $atts = mailPostedFiles(rtrim((string) cfg('files_dir'), '/') . '/mail/' . $id);
    $label = $m['label'] !== '' ? $m['label'] : count($list) . ' recipients';
    if (!empty($m['aud']['save']) && $aud['pasted']) {
        $tag = trim(str($m['aud'], 'saveTag', 40));
        mailUpsertContacts($aud['pasted'], $tag !== '' ? [$tag] : [], 'Mass email', $u['id']);
    }
    $score = mailContentCheck($m['subject'], $m['body'], $m['btnText'], $m['btnUrl'], count($atts), $m['fromName']);
    mailCampaignQueue($u, $m, $list, $atts, $label, [], $id, ['clean' => $clean, 'score' => ['score' => $score['score'], 'grade' => $score['grade']]]);
    if (!empty($m['aud']['lists']) && is_array($m['aud']['lists'])) {
        // v37.5: each list's activity shows what went to it
        require_once __DIR__ . '/maillists.php';
        dlNoteSent($m['aud']['lists'], $id, $m['subject'], count($list), $u);
    }
    return ['campaign' => mailCampaignOut((array) mailCampaignGet($id)), 'skipped' => $aud['suppressed'], 'cleaned' => $clean];
}

/**
 * Stores a campaign and its queue (one row per recipient). $extra is kept with the audience (v31: the requirement
 * blocks of a shared-requirements email). Returns the campaign id.
 */
function mailCampaignQueue(array $u, array $m, array $list, array $atts, string $label, array $extra = [], string $id = '', array $meta = []): string
{
    $pdo = mdb();
    $id = $id !== '' ? $id : rid(8);
    $now = now();
    $pdo->beginTransaction();
    try {
        $pdo->prepare(
            'INSERT INTO mail_campaigns (id, subject, body, btn_text, btn_url, from_name, reply_to, audience, atts, base, status, total, sent,
            failed, skipped, created, started, finished, by_uid, by_name, note, meta) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,?,0,0,?,?,?,?)',
        )->execute([
            $id,
            $m['subject'],
            $m['body'],
            $m['btnText'] ?? '',
            $m['btnUrl'] ?? '',
            $m['fromName'] ?? '',
            $m['replyTo'] ?? '',
            json_encode(['label' => $label, 'spec' => $m['aud'] ?? []] + $extra, JSON_UNESCAPED_UNICODE),
            json_encode($atts, JSON_UNESCAPED_SLASHES),
            siteUrl(),
            'queued',
            count($list),
            $now,
            $u['id'],
            $u['name'],
            '',
            json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ]);
        // v34: 100 recipients per statement, so 200,000 people queue in seconds on MySQL too
        $one = "(?,?,?,?,?,?,'queued',0,0,'',?)";
        $sql = 'INSERT INTO mail_queue (id, campaign, seq, email, name, vars, status, tries, at, err, tok) VALUES ';
        $full = null;
        foreach (array_chunk(array_values($list), 100) as $ci => $chunk) {
            $args = [];
            foreach ($chunk as $j => $p) {
                array_push($args, rid(8), $id, $ci * 100 + $j, $p['email'], mb_substr((string) $p['name'], 0, 190), json_encode($p['vars'] ?? [], JSON_UNESCAPED_UNICODE), rid(16));
            }
            if (count($chunk) === 100) {
                $full = $full ?? $pdo->prepare($sql . implode(',', array_fill(0, 100, $one)));
                $full->execute($args);
            } else {
                $pdo->prepare($sql . implode(',', array_fill(0, count($chunk), $one)))->execute($args);
            }
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    return $id;
}

/**
 * Sends queued campaign email for up to $budgetMs: over parallel HTTPS calls on Mailgun, Postal or Amazon SES, one
 * recipient at a time over one connection on SMTP. Stops at the daily limit (and today's warm-up cap), holds back
 * email to a receiving domain that had its hourly share, skips domains that take no email, and pauses when the
 * service refuses (a wrong key, a blocked port, a quota) so a bad setting can't burn through the list. A campaign that
 * bounces or draws complaints over the limit pauses itself.
 */
function mailRun(int $budgetMs = 12000): array
{
    $pdo = mdb();
    $start = now();
    $deadline = $start + $budgetMs;
    $c = mailSettings();
    $safety = mailSafety();
    $wait = metaGet('mail_wait');
    if ($wait > $start) {
        return [
            'state' => 'waiting',
            'until' => $wait,
            'message' => (string) mkvGet('wait_reason', ''),
            'hint' => (string) mkvGet('wait_hint', ''),
        ];
    }
    $grab = $pdo->prepare("UPDATE meta SET v = ? WHERE k = 'mail_lock' AND v < ?");
    $grab->execute([$deadline + 60000, $start]);
    if ($grab->rowCount() !== 1) {
        return ['state' => 'busy'];
    }
    $sent = 0;
    $failed = 0;
    $state = 'idle';
    $message = '';
    $waitMs = 180000;
    $session = null;
    $limit = (int) $c['limit'];
    $warm = mailWarmCap($safety);
    $limitWhy = 'daily';
    if ($warm['cap'] > 0 && ($limit === 0 || $warm['cap'] < $limit)) {
        $limit = $warm['cap'];
        $limitWhy = 'warmup';
    }
    $sent24 = mailSentSince($start - 86400000);
    $domHour = (int) $safety['domHour'];
    $domN = $domHour > 0 ? mailDomainCounts($start - 3600000) : [];
    $domOk = [];
    $rate = (float) ($c['rate'] ?? 0);
    $par = $rate > 0 ? max(1, min(8, (int) floor($rate))) : 8;
    $throttled = 0;
    try {
        $camps = $pdo
            ->query("SELECT * FROM mail_campaigns WHERE status IN ('queued', 'sending') ORDER BY created")
            ->fetchAll();
        $suppressed = $camps ? mailSuppressed() : [];
        $next = $pdo->prepare(
            "SELECT * FROM mail_queue WHERE campaign = ? AND status = 'queued' AND nb <= ? ORDER BY seq LIMIT 25",
        );
        $mark = $pdo->prepare(
            'UPDATE mail_queue SET status = ?, tries = tries + 1, at = ?, err = ? WHERE id = ?',
        );
        $hold = $pdo->prepare('UPDATE mail_queue SET nb = ? WHERE id = ?');
        $touch = $pdo->prepare('UPDATE mail_contacts SET last_sent = ? WHERE email = ?');
        // what happens to one queued row before it goes out: '' send it, 'skip' (marked), 'held' (later)
        $gate = function (array $q, int $pendingToDomain) use ($suppressed, $mark, $hold, $safety, $domHour, &$domN, &$domOk): string {
            if (isset($suppressed[$q['email']])) {
                $mark->execute(['skipped', now(), 'Unsubscribed', $q['id']]);
                return 'skip';
            }
            $dom = substr((string) $q['email'], (int) strrpos((string) $q['email'], '@') + 1);
            if ($safety['clean']) {
                if (!array_key_exists($dom, $domOk)) {
                    $domOk[$dom] = mailDomainOk($dom);
                }
                if ($domOk[$dom] === false) {
                    $mark->execute(['skipped', now(), 'No mail server found for ' . $dom, $q['id']]);
                    return 'skip';
                }
            }
            if ($domHour > 0 && ($domN[$dom] ?? 0) + $pendingToDomain >= $domHour) {
                $hold->execute([now() + 900000, $q['id']]);
                return 'held';
            }
            return '';
        };
        foreach ($camps as $camp) {
            if (in_array($state, ['stopped', 'limit', 'quota'], true) || now() >= $deadline) {
                break;
            }
            $state = 'sending';
            if ($camp['status'] === 'queued') {
                $pdo->prepare(
                    "UPDATE mail_campaigns SET status = 'sending', started = ? WHERE id = ?",
                )->execute([now(), $camp['id']]);
            }
            $atts = mailLoadAtts(json_decode((string) $camp['atts'], true) ?: []);
            $batches = 0;
            while (now() < $deadline && $state === 'sending') {
                $next->execute([$camp['id'], now()]);
                $rows = $next->fetchAll();
                if (!$rows) {
                    break;
                }
                if ($c['transport'] === 'api') {
                    // Mailgun, Postal or Amazon SES: up to 25 messages over parallel connections
                    $batch = [];
                    $bdom = [];
                    foreach ($rows as $q) {
                        if ($limit > 0 && $sent24 + count($batch) >= $limit) {
                            break;
                        }
                        $dom = substr((string) $q['email'], (int) strrpos((string) $q['email'], '@') + 1);
                        if ($gate($q, $bdom[$dom] ?? 0) !== '') {
                            continue;
                        }
                        $bdom[$dom] = ($bdom[$dom] ?? 0) + 1;
                        $batch[$q['id']] =
                            mailCampaignMessage($camp, $q) + [
                                'to' => $q['email'],
                                'name' => $q['name'],
                                'kind' => 'mass',
                                'ref' => $camp['id'],
                                'reply' => $camp['reply_to'],
                                'from_name' => $camp['from_name'],
                                'atts' => $atts,
                            ];
                    }
                    if (!$batch) {
                        if ($limit > 0 && $sent24 >= $limit) {
                            $state = 'limit';
                            break;
                        }
                        continue;
                    }
                    $results = mailApiSendMany($c, $batch, $par, $rate);
                    $thr = false;
                    $why = '';
                    foreach ($batch as $qid => $m) {
                        $res = $results[$qid] ?? ['ok' => false, 'err' => 'No answer from the sending service', 'code' => 0, 'why' => 'temp'];
                        if ($res['ok']) {
                            mailRecord($m['to'], $m['name'], $m['subject'], 'mass', true, '', $camp['id']);
                            $mark->execute(['sent', now(), '', $qid]);
                            $touch->execute([now(), $m['to']]);
                            $dom = substr($m['to'], (int) strrpos($m['to'], '@') + 1);
                            $domN[$dom] = ($domN[$dom] ?? 0) + 1;
                            $sent++;
                            $sent24++;
                        } elseif ($res['why'] === 'addr') {
                            // the service refuses the address itself (bad syntax, on its own suppression list)
                            mailRecord($m['to'], $m['name'], $m['subject'], 'mass', false, $res['err'], $camp['id']);
                            $mark->execute(['failed', now(), $res['err'], $qid]);
                            $failed++;
                        } else {
                            // throttled, out of quota, or the account or server is the problem: the address stays queued
                            $pdo->prepare('UPDATE mail_queue SET tries = tries + 1, err = ? WHERE id = ?')->execute([mb_substr($res['err'], 0, 500), $qid]);
                            if ($res['why'] === 'throttle') {
                                $thr = true;
                            } elseif ($why === '' || $res['why'] === 'quota') {
                                $why = $res['why'];
                                $message = $res['err'];
                                $GLOBALS['mailFail'] = ['stage' => 'api', 'code' => $res['code']];
                            }
                        }
                    }
                    mailLog('mass ' . $camp['id'] . ': ' . count($batch) . ' handed over, ' . count(array_filter($results, fn($r) => $r['ok'])) . ' accepted');
                    if ($why !== '') {
                        $state = $why === 'quota' ? 'quota' : 'stopped';
                        break 2;
                    }
                    if ($thr) {
                        // the service asked to slow down: halve the pace, wait a moment, and give up for now if it keeps asking
                        $throttled++;
                        $par = max(1, intdiv($par, 2));
                        $rate = $rate > 0 ? max(0.5, $rate / 2) : 4.0;
                        if ($throttled >= 4) {
                            $state = 'stopped';
                            $message = 'The sending service asked the site to slow down several times.';
                            $waitMs = 60000;
                            break 2;
                        }
                        usleep(1500000);
                    }
                    if (++$batches % 4 === 0) {
                        mailCampaignTally($camp['id']);
                        if (mailCampaignGuard($camp['id']) !== '') {
                            break;
                        }
                    }
                    continue;
                }
                foreach ($rows as $q) {
                    if (now() >= $deadline) {
                        break 2;
                    }
                    if ($limit > 0 && $sent24 >= $limit) {
                        $state = 'limit';
                        break 2;
                    }
                    if ($gate($q, 0) !== '') {
                        continue;
                    }
                    if ($c['transport'] === 'smtp' && $session === null) {
                        $session = new SmtpSession($c);
                        if (!$session->open()) {
                            $message = $session->error;
                            $GLOBALS['mailFail'] = ['stage' => $session->stage, 'code' => $session->code];
                            $session->close();
                            $session = null;
                            $state = 'stopped';
                            break 2;
                        }
                    }
                    $msg = mailCampaignMessage($camp, $q);
                    $ok = mailDeliver(
                        $msg + [
                            'to' => $q['email'],
                            'name' => $q['name'],
                            'kind' => 'mass',
                            'ref' => $camp['id'],
                            'reply' => $camp['reply_to'],
                            'from_name' => $camp['from_name'],
                            'atts' => $atts,
                        ],
                        $session,
                    );
                    if ($ok) {
                        $mark->execute(['sent', now(), '', $q['id']]);
                        $touch->execute([now(), $q['email']]);
                        $dom = substr((string) $q['email'], (int) strrpos((string) $q['email'], '@') + 1);
                        $domN[$dom] = ($domN[$dom] ?? 0) + 1;
                        $sent++;
                        $sent24++;
                    } else {
                        $f = $GLOBALS['mailFail'] ?? ['stage' => '', 'code' => 0];
                        $err = (string) ($GLOBALS['mailErr'] ?? '');
                        if ($f['stage'] === 'rcpt' && $f['code'] >= 500) {
                            // this address is the problem: note it and move on
                            $mark->execute(['failed', now(), $err, $q['id']]);
                            $failed++;
                            if (preg_match('/\b5\.1\.[0-9]\b/', $err)) {
                                $pdo->prepare(
                                    'REPLACE INTO mail_suppress (email, at, why) VALUES (?, ?, ?)',
                                )->execute([$q['email'], now(), 'bounced']);
                            }
                        } else {
                            // the account or the server is the problem: keep the address queued and stop
                            $pdo->prepare(
                                'UPDATE mail_queue SET tries = tries + 1, err = ? WHERE id = ?',
                            )->execute([$err, $q['id']]);
                            $message = $err;
                            $state = 'stopped';
                            if ($session) {
                                $session->close();
                                $session = null;
                            }
                            break 2;
                        }
                    }
                    if (($sent + $failed) % 100 === 0) {
                        mailCampaignTally($camp['id']);
                        if (mailCampaignGuard($camp['id']) !== '') {
                            break 2;
                        }
                    }
                    if ($c['gap'] > 0) {
                        usleep((int) ($c['gap'] * 1000000));
                    }
                }
            }
            mailCampaignTally($camp['id']);
            mailCampaignGuard($camp['id']);
        }
        if ($state === 'stopped' || $state === 'quota') {
            $f = $GLOBALS['mailFail'] ?? ['stage' => '', 'code' => 0];
            $hint = mailHint($message, (string) $f['stage'], (int) $f['code'], $c);
            metaSet('mail_wait', now() + ($state === 'quota' ? 1800000 : $waitMs));
            mkvSet('wait_reason', $message);
            mkvSet('wait_hint', $hint);
            $pdo->prepare("UPDATE mail_campaigns SET note = ? WHERE status = 'sending'")->execute([
                mb_substr($message, 0, 500),
            ]);
            $state = 'stopped';
        } elseif ($sent > 0) {
            $pdo->exec("UPDATE mail_campaigns SET note = '' WHERE status = 'sending'");
        }
    } finally {
        if ($session) {
            $session->close();
        }
        metaSet('mail_lock', 0);
    }
    $left = (int) $pdo
        ->query(
            "SELECT COUNT(*) FROM mail_queue q JOIN mail_campaigns c ON c.id = q.campaign WHERE q.status = 'queued' AND c.status IN ('queued', 'sending')",
        )
        ->fetchColumn();
    $hq = $pdo->prepare("SELECT COUNT(*) AS n, MIN(q.nb) AS nb FROM mail_queue q JOIN mail_campaigns c ON c.id = q.campaign WHERE q.status = 'queued' AND q.nb > ? AND c.status IN ('queued', 'sending')");
    $hq->execute([now()]);
    $h = $hq->fetch() ?: ['n' => 0, 'nb' => 0];
    $held = (int) $h['n'];
    if (($state === 'idle' || $state === 'sending') && $left > 0 && $left === $held) {
        $state = 'held';
    } elseif ($state === 'sending' && $left === 0) {
        $state = 'idle';
    }
    $out = [
        'state' => $state,
        'sent' => $sent,
        'failed' => $failed,
        'left' => $left,
        'sent24' => $sent24,
        'limit' => $limit,
        'limitWhy' => $limitWhy,
        'held' => $held,
    ];
    if ($held > 0) {
        $out['heldUntil'] = (int) $h['nb'];
        $out['domHour'] = $domHour;
    }
    if ($warm['on']) {
        $out['warm'] = ['day' => $warm['day'], 'days' => $warm['days'], 'cap' => $warm['cap']];
    }
    if ($state === 'stopped') {
        $out['message'] = $message;
        $out['hint'] = (string) mkvGet('wait_hint', '');
        $out['until'] = metaGet('mail_wait');
    }
    return $out;
}

function mailStatus(): array
{
    $c = mailSettings();
    $wait = metaGet('mail_wait');
    return [
        'ready' => mailReady($c),
        'provider' => $c['provider'],
        'from' => $c['from'],
        'fromName' => $c['from_name'],
        'limit' => (int) $c['limit'],
        'sent24' => mailSentSince(now() - 86400000),
        'wait' =>
            $wait > now()
                ? [
                    'until' => $wait,
                    'message' => (string) mkvGet('wait_reason', ''),
                    'hint' => (string) mkvGet('wait_hint', ''),
                ]
                : null,
        'test' => mkvGet('last_test'),
        'warm' => mailWarmCap(),
        'rate' => (float) ($c['rate'] ?? 0),
    ];
}

/* ---------- routes ---------- */

/**
 * v34: one email that reached the site (Mailgun's inbound route or Postal's HTTP endpoint): a reply to a service desk
 * ticket goes onto the ticket, a vendor requirement onto the Requirements desk, and the message into the portal Inbox
 * (where the screening agent reads resumes and replies). $files: [name, size, and tmp (an upload) or data (bytes)].
 */
function mailInboundTake(string $fromRaw, string $fromHint, string $to, string $subject, string $text, string $html, array $files, string $msgid, string $inReply, array $headers = []): string
{
    $fromE = $fromHint;
    $fromN = '';
    if (preg_match('/^\s*"?([^"<]*)"?\s*<([^>]+)>/', $fromRaw, $mm)) {
        $fromN = trim($mm[1]);
        $fromE = $fromE !== '' ? $fromE : strtolower(trim($mm[2]));
    } elseif ($fromE === '' && filter_var(trim($fromRaw), FILTER_VALIDATE_EMAIL)) {
        $fromE = strtolower(trim($fromRaw));
    }
    if (!filter_var($fromE, FILTER_VALIDATE_EMAIL)) {
        $fromE = 'unknown@' . mailHost();
    }
    // v37.5: mail to a distribution list's own address goes to the list's members (or waits for an administrator)
    try {
        require_once __DIR__ . '/maillists.php';
        $dl = dlByAddress($to);
    } catch (Throwable $e) {
        $dl = null;
    }
    if ($dl) {
        $fl = [];
        foreach (array_slice($files, 0, 10) as $f) {
            $data = isset($f['tmp']) ? (string) @file_get_contents((string) $f['tmp']) : (string) ($f['data'] ?? '');
            $ext = strtolower(pathinfo((string) ($f['name'] ?? ''), PATHINFO_EXTENSION));
            if ($data !== '') {
                $fl[] = [(string) ($f['name'] ?? 'attachment'), MIME[$ext] ?? 'application/octet-stream', $data];
            }
        }
        $r = dlInbound($dl, ['from' => [$fromE, mimeWords($fromN)], 'subject' => mimeWords($subject), 'text' => $text !== '' ? $text : mimeHtmlText($html), 'html' => $html, 'files' => $fl, 'headers' => $headers, 'msgid' => $msgid]);
        return 'dl:' . $r['id'];
    }
    $atts = [];
    $removed = [];
    $mid = rid(8);
    require_once __DIR__ . '/guard.php';
    foreach ($files as $f) {
        $size = (int) ($f['size'] ?? 0);
        if ($size <= 0 || $size > (int) cfg('max_upload_mb') * 1048576 || count($atts) >= 10) {
            continue;
        }
        $dir = cfg('files_dir');
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        $fname = mb_substr(basename((string) ($f['name'] ?? 'attachment')), 0, 180);
        // v35: programs, scripts, web pages, macro files and viruses from outside senders are removed first
        $tmpIn = isset($f['tmp']) ? (string) $f['tmp'] : (string) tempnam(sys_get_temp_dir(), 'inb');
        if (!isset($f['tmp'])) {
            @file_put_contents($tmpIn, (string) ($f['data'] ?? ''));
        }
        $why = guardInbound($tmpIn, $fname);
        if ($why !== '') {
            $removed[] = $fname . ' (' . $why . ')';
            if (!isset($f['tmp'])) {
                @unlink($tmpIn);
            }
            continue;
        }
        $fid = rid(16);
        $okFile = isset($f['tmp']) ? @move_uploaded_file($tmpIn, "$dir/$fid") : @rename($tmpIn, "$dir/$fid");
        if (!$okFile) {
            @unlink($tmpIn);
            continue;
        }
        fileSealPath("$dir/$fid");
        $ext = strtolower(pathinfo($fname, PATHINFO_EXTENSION));
        $type = MIME[$ext] ?? 'application/octet-stream';
        docSet("inbox/m$mid/f/$fid", (object) ['n' => $fname, 'ty' => $type, 'sz' => $size, 'at' => now(), 'c' => 'inbound']);
        $atts[] = ['id' => $fid, 'n' => $fname, 's' => $size, 'base' => "inbox/m$mid"];
    }
    if ($removed) {
        // the message still arrives; the reader sees what was taken off and why
        $note = 'The StratEdge security check removed ' . (count($removed) === 1 ? 'an attachment' : count($removed) . ' attachments') . ': ' . implode('; ', $removed) . '. Ask the sender for a PDF or a normal Word file if you need it.';
        $text = '[' . $note . "]\n\n" . $text;
        $html = $html !== '' ? '<p style="padding:8px 10px;background:#fff4e5;border-radius:8px">' . htmlspecialchars($note) . '</p>' . $html : '';
        audit('data', 'Email attachment removed', mb_substr($fromE, 0, 190), ['files' => $removed, 'subject' => mb_substr($subject, 0, 120)]);
    }
    $html = preg_replace('#<(script|style|iframe|object|embed|form)[^>]*>.*?</\1>#is', '', $html) ?? '';
    $html = preg_replace('/\son[a-z]+\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)/i', '', $html) ?? '';
    $ref = '';
    if (preg_match('/<(?:[a-f0-9]{32}\.)?([a-z0-9]{8,24})\.mass@/i', $inReply, $mm)) {
        $ref = $mm[1];
    }
    // a reply to a service desk ticket ([SD-1234] in the subject) goes onto the ticket; an email to the support address
    // from someone with a portal account opens a new one
    try {
        require_once __DIR__ . '/desk.php';
        // v83: an email whose sender Mailgun's SPF check failed outright is not put on a ticket (it still reaches the
        // Inbox); any one 'fail' counts, so a 'Pass' header written into the message itself changes nothing
        $spfFail = in_array('fail', array_map(fn($v) => strtolower(trim((string) $v)), (array) ($headers['x-mailgun-spf'] ?? [])), true);
        $sd = $spfFail ? '' : deskInbound($fromE, $fromN, $to, $subject, $text);
        if ($sd !== '') {
            $ref = $sd;
        }
    } catch (Throwable $e) {
        mailLog('Service desk could not read an inbound email: ' . $e->getMessage());
    }
    // a vendor email that reads like a requirement also lands on the requirements desk
    require_once __DIR__ . '/vms.php';
    vmsMaybeRequirement($fromE, $fromN, $subject, $text, 'inbox', $msgid);
    mdb()
        ->prepare('INSERT INTO mail_inbox (id, at, from_email, from_name, to_email, subject, text, html, atts, msgid, ref, folder, seen, starred) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,0)')
        ->execute([$mid, now(), mb_substr($fromE, 0, 190), mb_substr($fromN, 0, 190), mb_substr(strtolower($to), 0, 190), mb_substr($subject !== '' ? $subject : '(no subject)', 0, 300), mb_substr($text, 0, 200000), mb_substr($html, 0, 400000), json_encode($atts), mb_substr($msgid, 0, 300), $ref, 'inbox']);
    // v33: resumes and replies for the screening agent are read right after the answer goes back (when it is on)
    try {
        require_once __DIR__ . '/agent.php';
        agSoon();
    } catch (Throwable $e) {
    }
    return $mid;
}

/** v37.5: the distribution lists an email went out to, that this address is on (to leave one from the link). */
function mailSignatureKey(string $uid): string
{
    return 'mail_signature_' . preg_replace('/[^A-Za-z0-9_\-]/', '', $uid);
}
function mailSignatureGet(array $u): array
{
    $d = secKv(mailSignatureKey((string) $u['id']), []);
    return ['text' => is_array($d) ? mb_substr(trim((string) ($d['text'] ?? '')), 0, 4000) : '', 'at' => is_array($d) ? (int) ($d['at'] ?? 0) : 0];
}
function mailSignatureSave(array $u, string $text): array
{
    $text = trim(str_replace(["\r\n", "\r"], "\n", $text));
    if (mb_strlen($text) > 4000) {
        fail(400, 'invalid_argument', 'Keep the signature under 4,000 characters.');
    }
    $d = ['text' => $text, 'at' => now()];
    secKvSet(mailSignatureKey((string) $u['id']), $d);
    audit('settings', 'Personal email signature saved', 'mail_signature', ['uid' => (string) $u['id']], $u);
    return $d;
}

function mailUnsubLists(string $campaignId, string $email): array
{
    $c = mdb()->prepare('SELECT audience FROM mail_campaigns WHERE id = ?');
    $c->execute([$campaignId]);
    $aud = json_decode((string) $c->fetchColumn(), true) ?: [];
    $ids = !empty($aud['dl']) ? [(string) $aud['dl']] : array_values(array_filter((array) ($aud['spec']['lists'] ?? []), 'is_string'));
    if (!$ids) {
        return [];
    }
    require_once __DIR__ . '/maillists.php';
    $out = [];
    foreach (array_slice(array_unique($ids), 0, 10) as $id) {
        $L = dlGet($id);
        if (!$L) {
            continue;
        }
        $q = dlDb()->prepare('SELECT st FROM mail_list_members WHERE list = ? AND email = ?');
        $q->execute([$L['id'], strtolower($email)]);
        $out[] = ['id' => $L['id'], 'name' => $L['fromName'] !== '' ? $L['fromName'] : $L['name'], 'left' => $q->fetchColumn() === 'left'];
    }
    return $out;
}

function mailRoute(string $r, string $method, array $b): never
{
    if (in_array($r, ['mail_postal_hook', 'mail_postal_inbound', 'mail_ses_hook', 'mail_content_check', 'mail_deliv', 'mail_deliv_check', 'mail_safety_save'], true)) {
        mailBulkRoute($r, $method, $b);
    }
    switch ($r) {
        case 'mail_status':
            $u = mailUser();
            $cap = mailUserCap($u);
            ok(mailStatus() + ['me' => ['cap' => $cap, 'used' => $cap > 0 ? mailUserUsed((string) $u['id']) : 0]]);

        case 'mail_signature':
            $u = mailUser();
            ok(mailSignatureGet($u));

        case 'mail_signature_save':
            $u = mailUser();
            ok(mailSignatureSave($u, str($b, 'text', 4000)));

        case 'mail_settings':
            mailOwner();
            $c = mailSettings();
            if (!empty($c['viaProvider'])) {
                // v37: a company workspace sending through StratEdge's mail service sees "not connected yet", never
                // StratEdge's account; its own settings, once saved, replace the borrowed ones
                $c = ['provider' => 'config', 'host' => '', 'port' => 465, 'secure' => 'ssl', 'user' => '', 'pass' => '', 'from' => '', 'from_name' => $c['from_name'], 'limit' => 0, 'gap' => 1.0, 'region' => 'us', 'whk' => '', 'rate' => 0.0, 'pkey' => '', 'cset' => '', 'topic' => '', 'ip' => '', 'dkimSel' => '', 'viaProvider' => true];
            }
            ok([
                'viaProvider' => !empty($c['viaProvider']),
                'provider' => $c['provider'],
                'host' => $c['host'],
                'port' => $c['port'],
                'secure' => $c['secure'],
                'user' => $c['user'],
                'hasPass' => $c['pass'] !== '',
                'from' => $c['from'],
                'fromName' => $c['from_name'],
                'limit' => $c['limit'],
                'gap' => $c['gap'],
                'region' => $c['region'],
                'hasWhk' => $c['whk'] !== '',
                'webhookUrl' => siteUrl() . 'api/index.php?r=mail_webhook',
                'inboundUrl' => siteUrl() . 'api/index.php?r=mail_inbound',
                'status' => mailStatus(),
                // v34: Postal and Amazon SES
                'rate' => $c['rate'],
                'pkey' => $c['pkey'],
                'cset' => $c['cset'],
                'topic' => $c['topic'],
                'ip' => $c['ip'],
                'dkimSel' => $c['dkimSel'],
                'postalHook' => mailHookUrl('mail_postal_hook'),
                'postalInbound' => mailHookUrl('mail_postal_inbound'),
                'sesHook' => mailHookUrl('mail_ses_hook'),
                'hooks' => mkvGet('hook_seen', []),
                'ses' => mkvGet('ses_account'),
                'jwks' => mkvGet('postal_jwks') ? ['at' => (int) (mkvGet('postal_jwks')['at'] ?? 0), 'ok' => !empty(mkvGet('postal_jwks')['ok'])] : null,
                // v41: Microsoft 365 is connected with the Microsoft app set up under Roles & access › Sign-in providers
                'msReady' => (function () {
                    require_once __DIR__ . '/sso.php';
                    return ssoConnectable('microsoft');
                })(),
            ]);

        case 'mail_settings_save':
            mailOwner();
            $p = str($b, 'provider', 12);
            if (!isset(MAIL_PROVIDERS[$p])) {
                fail(400, 'invalid_argument', 'Choose how email should be sent.');
            }
            $old = mkvGet('settings', []);
            $old = is_array($old) ? $old : [];
            $google = $p === 'gmail' || $p === 'workspace';
            $user = strtolower(trim(str($b, 'user', 190)));
            $pass = (string) preg_replace('/\s+/', '', str($b, 'pass', 300));
            $from = strtolower(trim(str($b, 'from', 190)));
            if ($google && !filter_var($user, FILTER_VALIDATE_EMAIL)) {
                fail(400, 'invalid_argument', 'Enter the full Gmail or Google Workspace address.');
            }
            if ($from !== '' && !filter_var($from, FILTER_VALIDATE_EMAIL)) {
                fail(400, 'invalid_argument', 'The From address is not a valid email.');
            }
            $host = $google || MAIL_PROVIDERS[$p]['host'] !== '' ? MAIL_PROVIDERS[$p]['host'] : strtolower(trim(str($b, 'host', 190)));
            if ($p === 'm365') {
                // v41: the mailbox is the one connected with Microsoft (its refresh token is kept); only the name, the
                // From address and the limits change here
                if (($old['provider'] ?? '') !== 'm365' || (string) ($old['pass'] ?? '') === '') {
                    fail(400, 'invalid_argument', 'Connect the company mailbox with Microsoft first (Connect with Microsoft, under Microsoft 365).');
                }
                $user = (string) ($old['user'] ?? '');
                $pass = '';
                $host = '';
            }
            if ($p === 'mailgun') {
                $host = strtolower(trim(str($b, 'domain', 190)));
                if (!preg_match('/^[a-z0-9.-]+\.[a-z]{2,}$/', $host)) {
                    fail(400, 'invalid_argument', 'Enter the Mailgun sending domain, for example mg.yourdomain.com.');
                }
                if ($pass !== '' && strlen($pass) < 20) {
                    fail(400, 'invalid_argument', 'That does not look like a Mailgun private API key.');
                }
                if ($from === '') {
                    fail(400, 'invalid_argument', 'Enter the From address (an address on the Mailgun domain, e.g. info@mg.yourdomain.com or info@yourdomain.com).');
                }
            }
            if (in_array($p, ['host', 'smtp'], true) && !preg_match('/^[a-z0-9.-]+$/', $host)) {
                fail(400, 'invalid_argument', 'Enter the mail server name, for example mail.yourdomain.com.');
            }
            if (in_array($p, ['host', 'smtp'], true)) {
                // v83: the portal never connects into a private network (the same rule as the Postal address below)
                require_once __DIR__ . '/connectors.php';
                if (cxUrlProblem('https://' . $host . '/') !== '') {
                    fail(400, 'invalid_argument', 'Enter a mail server that can be reached on the internet (not a private or internal address).');
                }
            }
            // v34: your own Postal server (its web address and an API credential) and Amazon SES (an access key)
            $region = str($b, 'region', 2) === 'eu' ? 'eu' : 'us';
            if ($p === 'postal') {
                $host = rtrim(trim(str($b, 'postalUrl', 300)), '/');
                if (!preg_match('~^https?://[^/\s?#]+(/[^\s?#]*)?$~i', $host)) {
                    fail(400, 'invalid_argument', 'Enter your Postal server\'s address, for example https://postal.yourdomain.com');
                }
                require_once __DIR__ . '/connectors.php';
                $why = cxUrlProblem($host);
                if ($why !== '') {
                    fail(400, 'invalid_argument', $why);
                }
                if ($pass !== '' && strlen($pass) < 12) {
                    fail(400, 'invalid_argument', 'That does not look like a Postal API key (Postal › Credentials, type API).');
                }
                if ($from === '') {
                    fail(400, 'invalid_argument', 'Enter the From address, on a domain added to your Postal server.');
                }
                $pk = trim(str($b, 'pkey', 4000));
                if ($pk !== '' && pemFromAny($pk) === '') {
                    fail(400, 'invalid_argument', 'The webhook public key could not be read. Paste the p= value of Postal\'s DKIM record or a PEM key, or leave it empty.');
                }
                $user = '';
            }
            if ($p === 'ses_api') {
                $host = '';
                $region = strtolower(trim(str($b, 'awsRegion', 30)));
                if (!preg_match('/^[a-z]{2}(-[a-z]+)+-\d$/', $region)) {
                    fail(400, 'invalid_argument', 'Choose the AWS region your SES account sends from, for example us-east-1.');
                }
                $user = strtoupper(trim(str($b, 'user', 128)));
                if (!preg_match('/^[A-Z0-9]{16,128}$/', $user)) {
                    fail(400, 'invalid_argument', 'Enter the access key ID (it starts with AKIA).');
                }
                if ($pass !== '' && strlen($pass) < 30) {
                    fail(400, 'invalid_argument', 'That does not look like an AWS secret access key.');
                }
                if ($from === '') {
                    fail(400, 'invalid_argument', 'Enter the From address: an address or domain verified in Amazon SES.');
                }
                if (str($b, 'cset', 64) !== '' && !preg_match('/^[A-Za-z0-9_-]{1,64}$/', str($b, 'cset', 64))) {
                    fail(400, 'invalid_argument', 'A configuration set name uses only letters, numbers, - and _.');
                }
                foreach (preg_split('/[\s,]+/', trim(str($b, 'topic', 2000))) ?: [] as $t) {
                    if ($t !== '' && !preg_match('/^arn:aws[a-z-]*:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_.-]{1,256}$/', $t)) {
                        fail(400, 'invalid_argument', 'That SNS topic ARN does not look right: ' . mb_substr($t, 0, 80));
                    }
                }
            }
            $ip = trim(str($b, 'ip', 45));
            if ($ip !== '' && !filter_var($ip, FILTER_VALIDATE_IP)) {
                fail(400, 'invalid_argument', 'The sending server\'s IP address is not valid.');
            }
            $secure = in_array(str($b, 'secure', 6), ['ssl', 'tls', 'none'], true)
                ? str($b, 'secure', 6)
                : MAIL_PROVIDERS[$p]['secure'];
            $apiP = !empty(MAIL_PROVIDERS[$p]['api']);
            $keepPass = $pass === '' && ($apiP ? ($old['provider'] ?? '') === $p && ($old['user'] ?? '') === $user : ($old['user'] ?? '') === $user) && ($old['provider'] ?? '') !== 'php';
            $whk = (string) preg_replace('/\s+/', '', str($b, 'whk', 200));
            mkvSet('settings', [
                'provider' => $p,
                'region' => $region,
                'whk' => $whk !== '' ? mailSeal($whk) : (string) ($old['whk'] ?? ''),
                'host' => $host,
                'port' => max(1, min(65535, (int) ($b['port'] ?? 0) ?: MAIL_PROVIDERS[$p]['port'])),
                'secure' => $secure,
                'user' => $p === 'php' ? '' : $user,
                'pass' => $p === 'php' ? '' : ($keepPass ? (string) ($old['pass'] ?? '') : mailSeal($pass)),
                'from' => $from,
                'from_name' => mb_substr(trim(str($b, 'fromName', 100)), 0, 100),
                'limit' => max(0, (int) ($b['limit'] ?? MAIL_PROVIDERS[$p]['limit'])),
                'gap' => max(0, min(10, (float) ($b['gap'] ?? 1))),
                'rate' => max(0, min(500, (float) ($b['rate'] ?? 0))),
                'pkey' => $p === 'postal' ? trim(str($b, 'pkey', 4000)) : (string) ($old['pkey'] ?? ''),
                'cset' => $p === 'ses_api' ? str($b, 'cset', 64) : (string) ($old['cset'] ?? ''),
                'topic' => $p === 'ses_api' ? implode("\n", array_filter(preg_split('/[\s,]+/', trim(str($b, 'topic', 2000))) ?: [])) : (string) ($old['topic'] ?? ''),
                'ip' => $ip,
                'dkimSel' => mb_substr((string) preg_replace('/[^a-z0-9._,\s-]/i', '', str($b, 'dkimSel', 200)), 0, 200),
            ]);
            if (($old['provider'] ?? '') !== $p) {
                foreach (['postal_jwks', 'ses_account', 'postal_dns', 'postal_limit'] as $k) {
                    mdb()->prepare('DELETE FROM mail_kv WHERE k = ?')->execute([$k]);
                }
            }
            metaSet('mail_wait', 0);
            mailSettings(true);
            ok(['ok' => true]);

        case 'mail_test':
            $u = mailOwner();
            session_write_close();
            @set_time_limit(60);
            $to = strtolower(trim(str($b, 'to', 190))) ?: $u['email'];
            if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
                fail(400, 'invalid_argument', 'Enter the address to send the test to.');
            }
            $c = mailSettings();
            // v37: a company workspace borrowing StratEdge's mail service sees nothing of that account
            $via = !empty($c['viaProvider']);
            // v34: Amazon SES: the account first (sandbox, quota, rate); Postal: the webhook signing key
            $extra = [];
            if ($via) {
                // no account details
            } elseif ($c['provider'] === 'ses_api') {
                $acct = sesAccount($c);
                $extra['account'] = $acct;
                if (!$acct['ok']) {
                    $res = ['ok' => false, 'to' => $to, 'at' => now(), 'error' => $acct['err'], 'hint' => mailHint($acct['err'], 'api', 403, $c), 'account' => $acct];
                    mkvSet('last_test', $res);
                    ok($res);
                }
            } elseif ($c['provider'] === 'postal') {
                $extra['keys'] = count(postalKeys($c, true));
            }
            $when = date('M j, Y g:i A');
            $html = emailHtml('Email is connected', [
                'This test message was sent by the StratEdge website on ' . $when . '.',
                'Portal email (invoices, signature requests, paystubs, daily reports) and mass email will now go out from ' .
                $c['from'] .
                '.',
            ]);
            $ok = mailDeliver([
                'to' => $to,
                'subject' => 'Test email from the StratEdge website',
                'text' => "Email is connected.\n\nThis test was sent on $when from {$c['from']}.",
                'html' => $html,
                'kind' => 'mail_test',
            ]);
            $f = $GLOBALS['mailFail'] ?? ['stage' => '', 'code' => 0];
            $err = (string) ($GLOBALS['mailErr'] ?? '');
            $res = [
                'ok' => $ok,
                'to' => $to,
                'at' => now(),
                'error' => $via && !$ok ? 'The message was not delivered.' : $err,
                'hint' => $ok ? '' : mailHint($err, (string) $f['stage'], (int) $f['code'], $c),
            ] + $extra;
            mkvSet('last_test', $res);
            if ($ok) {
                metaSet('mail_wait', 0);
            }
            ok($res);

        case 'mail_sources':
            ok(mailSources(mailUser()));

        case 'mail_audience':
            $u = mailUser();
            mailRoom();
            $aud = mailAudience(is_array($b['aud'] ?? null) ? $b['aud'] : [], $u);
            $clean = null;
            if ($aud['list'] && mailSafety()['clean']) {
                $h = mailHygiene($aud['list'], 0);
                $clean = ['n' => $h['n'], 'removed' => $h['removed'], 'examples' => array_slice($h['examples'], 0, 4), 'unchecked' => $h['unchecked']];
                $aud['list'] = $h['list'];
            }
            ok([
                'count' => count($aud['list']),
                'clean' => $clean,
                'suppressed' => $aud['suppressed'],
                'sample' => array_slice(
                    array_map(
                        fn($p) => $p['name'] !== '' ? $p['name'] . ' <' . $p['email'] . '>' : $p['email'],
                        $aud['list'],
                    ),
                    0,
                    6,
                ),
            ]);

        case 'mail_preview':
            mailUser();
            $sample = [
                'email' => 'alex.morgan@example.com',
                'name' => 'Alex Morgan',
                'company' => 'Example Corp',
                'title' => 'Network Engineer',
                'signature' => sigOf((string) (currentUser()['id'] ?? '')), // v69
            ];
            $body = mailMerge(str($b, 'body', 20000), $sample);
            ok([
                'subject' => mailMerge(str($b, 'subject', 250), $sample),
                'html' => mailMassHtml($body, str($b, 'btnText', 60), str($b, 'btnUrl', 500), '#'),
            ]);

        case 'mail_send_test':
            $u = mailUser();
            session_write_close();
            @set_time_limit(60);
            $m = mailPostedMessage();
            $dir = rtrim((string) cfg('files_dir'), '/') . '/mail/test-' . rid(4);
            $atts = mailLoadAtts(mailPostedFiles($dir));
            foreach (glob($dir . '/*') ?: [] as $f) {
                @unlink($f);
            }
            @rmdir($dir);
            $v = ['email' => $u['email'], 'name' => $u['name'], 'signature' => sigOf((string) $u['id'])]; // v69
            $body = mailMerge($m['body'], $v);
            $ok = mailDeliver([
                'to' => $u['email'],
                'name' => $u['name'],
                'subject' => '[Test] ' . mailMerge($m['subject'], $v),
                'html' => mailMassHtml($body, $m['btnText'], $m['btnUrl'], ''),
                'text' => mailMassText($body, $m['btnText'], $m['btnUrl'], ''),
                'reply' => $m['replyTo'],
                'from_name' => $m['fromName'],
                'atts' => $atts,
                'kind' => 'mass_test',
            ]);
            $f = $GLOBALS['mailFail'] ?? ['stage' => '', 'code' => 0];
            $err = (string) ($GLOBALS['mailErr'] ?? '');
            ok([
                'ok' => $ok,
                'to' => $u['email'],
                'error' => $err,
                'hint' => $ok ? '' : mailHint($err, (string) $f['stage'], (int) $f['code'], mailSettings()),
            ]);

        case 'mail_campaign_create':
            $u = mailUser();
            ok(mailCampaignCreate($u));

        case 'mail_campaign_run':
            mailUser();
            session_write_close();
            @set_time_limit(90);
            ignore_user_abort(true);
            ok(mailRun(12000));

        case 'mail_campaigns':
            $u = mailUser();
            $mine = userLevel($u) < 2;
            $st = mdb()->prepare(
                'SELECT * FROM mail_campaigns' .
                    ($mine ? ' WHERE by_uid = ?' : '') .
                    ' ORDER BY created DESC LIMIT 100',
            );
            $st->execute($mine ? [$u['id']] : []);
            ok(['campaigns' => array_map('mailCampaignOut', $st->fetchAll()), 'status' => mailStatus()]);

        case 'mail_campaign':
            $u = mailUser();
            $c = mailCampaignGet(str($b, 'id', 24));
            if (!$c || (userLevel($u) < 2 && $c['by_uid'] !== $u['id'])) {
                fail(404, 'not_found', 'That campaign is not available.');
            }
            $status = str($b, 'status', 12);
            $offset = max(0, (int) ($b['offset'] ?? 0));
            $groups = ['sent' => ['sent', 'delivered', 'bounced', 'complained'], 'bounced' => ['bounced', 'complained']];
            $set = $groups[$status] ?? ($status !== '' ? [$status] : []);
            $where = 'campaign = ?' . ($set ? ' AND status IN (' . implode(',', array_fill(0, count($set), '?')) . ')' : '');
            $args = array_merge([$c['id']], $set);
            $cnt = mdb()->prepare("SELECT COUNT(*) FROM mail_queue WHERE $where");
            $cnt->execute($args);
            $st = mdb()->prepare(
                "SELECT email, name, status, at, err, nb FROM mail_queue WHERE $where ORDER BY seq LIMIT 100 OFFSET $offset",
            );
            $st->execute($args);
            ok([
                'campaign' => mailCampaignOut($c),
                'total' => (int) $cnt->fetchColumn(),
                'rows' => $st->fetchAll(),
            ]);

        case 'mail_campaign_action':
            $u = mailUser();
            $c = mailCampaignGet(str($b, 'id', 24));
            if (!$c || (userLevel($u) < 2 && $c['by_uid'] !== $u['id'])) {
                fail(404, 'not_found', 'That campaign is not available.');
            }
            $pdo = mdb();
            $act = str($b, 'action', 12);
            if ($act === 'pause' && in_array($c['status'], ['queued', 'sending'], true)) {
                $pdo->prepare("UPDATE mail_campaigns SET status = 'paused' WHERE id = ?")->execute([
                    $c['id'],
                ]);
            } elseif ($act === 'resume' && $c['status'] === 'paused') {
                mailCampaignTally($c['id']);
                $c = (array) mailCampaignGet($c['id']);
                $meta = mailCampaignMeta($c);
                if (!empty($meta['auto'])) {
                    // after an automatic pause the bounce and complaint rates are measured again from here
                    $meta['guardFrom'] = ['base' => (int) $c['sent'] + (int) $c['failed'], 'bnc' => (int) $c['bounced'] + (int) $c['failed'], 'cmp' => (int) $c['complained']];
                    $meta['autoPrev'] = $meta['auto'];
                    unset($meta['auto']);
                    mailCampaignMetaSet($c['id'], $meta);
                }
                $pdo->prepare(
                    "UPDATE mail_campaigns SET status = 'sending', note = '' WHERE id = ?",
                )->execute([$c['id']]);
                metaSet('mail_wait', 0);
            } elseif ($act === 'cancel' && in_array($c['status'], ['queued', 'sending', 'paused'], true)) {
                $pdo->prepare(
                    "UPDATE mail_queue SET status = 'cancelled' WHERE campaign = ? AND status = 'queued'",
                )->execute([$c['id']]);
                $pdo->prepare(
                    "UPDATE mail_campaigns SET status = 'cancelled', finished = ? WHERE id = ?",
                )->execute([now(), $c['id']]);
                mailCampaignTally($c['id']);
            } elseif ($act === 'retry' && in_array($c['status'], ['queued', 'sending', 'paused', 'done'], true)) {
                // v83: a cancelled campaign stays cancelled, and a paused one stays paused (its failed addresses
                // wait in the queue for Resume, which also resets the bounce guard)
                $n = $pdo->prepare(
                    "UPDATE mail_queue SET status = 'queued', err = '' WHERE campaign = ? AND status = 'failed'",
                );
                $n->execute([$c['id']]);
                if ($n->rowCount() > 0) {
                    if ($c['status'] !== 'paused') {
                        $pdo->prepare(
                            "UPDATE mail_campaigns SET status = 'sending', finished = 0 WHERE id = ?",
                        )->execute([$c['id']]);
                    }
                    mailCampaignTally($c['id']);
                }
            } elseif ($act === 'wake') {
                metaSet('mail_wait', 0);
            } else {
                fail(400, 'invalid_argument', 'That action is not available for this campaign.');
            }
            ok(['campaign' => mailCampaignOut((array) mailCampaignGet($c['id']))]);

        case 'mail_contacts':
            mailUser();
            [$sql, $args] = mailContactsQuery($b);
            $sort =
                [
                    'name' => 'c.name ASC',
                    'email' => 'c.email ASC',
                    'company' => 'c.company ASC',
                    'created' => 'c.created DESC',
                    'sent' => 'c.last_sent DESC',
                ][str($b, 'sort', 10)] ?? 'c.created DESC';
            $limit = max(1, min(1000, (int) ($b['limit'] ?? 50)));
            $offset = max(0, (int) ($b['offset'] ?? 0));
            $cnt = mdb()->prepare('SELECT COUNT(*)' . $sql);
            $cnt->execute($args);
            $st = mdb()->prepare('SELECT c.*, s.why' . $sql . " ORDER BY $sort LIMIT $limit OFFSET $offset");
            $st->execute($args);
            $tags = [];
            foreach (mdb()->query('SELECT tags, COUNT(*) AS n FROM mail_contacts GROUP BY tags') as $row) {
                foreach (mailTagsList((string) $row['tags']) as $t) {
                    $tags[$t] = ($tags[$t] ?? 0) + (int) $row['n'];
                }
            }
            ksort($tags, SORT_NATURAL | SORT_FLAG_CASE);
            ok([
                'rows' => array_map('mailContactOut', $st->fetchAll()),
                'total' => (int) $cnt->fetchColumn(),
                'tags' => $tags,
                'all' => (int) mdb()->query('SELECT COUNT(*) FROM mail_contacts')->fetchColumn(),
            ]);

        case 'mail_contact_save':
            $u = mailUser();
            $pdo = mdb();
            $email = strtolower(trim(str($b, 'email', 190)));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                fail(400, 'invalid_argument', 'Enter a valid email address.');
            }
            $id = str($b, 'id', 24);
            $dupe = $pdo->prepare('SELECT id FROM mail_contacts WHERE email = ?');
            $dupe->execute([$email]);
            $other = $dupe->fetchColumn();
            if ($other !== false && $other !== $id) {
                fail(409, 'invalid_argument', 'A contact with that email already exists.');
            }
            $vals = [
                mb_substr(trim(str($b, 'name', 190)), 0, 190),
                mb_substr(trim(str($b, 'company', 190)), 0, 190),
                mb_substr(trim(str($b, 'title', 190)), 0, 190),
                mb_substr(trim(str($b, 'phone', 60)), 0, 60),
                mb_substr(trim(str($b, 'city', 120)), 0, 120),
                mailTagsNorm($b['tags'] ?? ''),
                mb_substr(trim(str($b, 'source', 80)), 0, 80),
                mb_substr(trim(str($b, 'notes', 2000)), 0, 2000),
            ];
            if ($id !== '') {
                $pdo->prepare(
                    'UPDATE mail_contacts SET email = ?, name = ?, company = ?, title = ?, phone = ?, city = ?, tags = ?, source = ?, notes = ?, updated = ? WHERE id = ?',
                )->execute([$email, ...$vals, now(), $id]);
            } else {
                $id = rid(8);
                $pdo->prepare(
                    'INSERT INTO mail_contacts (id, email, name, company, title, phone, city, tags, source, notes, created, updated, by_uid, last_sent) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0)',
                )->execute([$id, $email, ...$vals, now(), now(), $u['id']]);
            }
            ok(['id' => $id]);

        case 'mail_contacts_import':
            $u = mailUser();
            $rows = array_slice(is_array($b['rows'] ?? null) ? $b['rows'] : [], 0, 2000);
            $tag = trim(str($b, 'tag', 40));
            ok(
                mailUpsertContacts(
                    $rows,
                    $tag !== '' ? [$tag] : [],
                    mb_substr(trim(str($b, 'source', 80)) ?: 'Import', 0, 80),
                    $u['id'],
                ),
            );

        case 'mail_contacts_delete':
            mailUser();
            $ids = array_values(array_filter((array) ($b['ids'] ?? []), 'is_string'));
            foreach (array_chunk($ids, 400) as $chunk) {
                mdb()
                    ->prepare(
                        'DELETE FROM mail_contacts WHERE id IN (' .
                            implode(',', array_fill(0, count($chunk), '?')) .
                            ')',
                    )
                    ->execute($chunk);
            }
            ok(['deleted' => count($ids)]);

        case 'mail_contacts_tag':
            mailUser();
            $tag = trim(str($b, 'tag', 40));
            $remove = !empty($b['remove']);
            if ($tag === '') {
                fail(400, 'invalid_argument', 'Enter a tag.');
            }
            $pdo = mdb();
            $get = $pdo->prepare('SELECT tags FROM mail_contacts WHERE id = ?');
            $set = $pdo->prepare('UPDATE mail_contacts SET tags = ?, updated = ? WHERE id = ?');
            foreach (array_filter((array) ($b['ids'] ?? []), 'is_string') as $id) {
                $get->execute([$id]);
                $cur = $get->fetchColumn();
                if ($cur === false) {
                    continue;
                }
                $list = mailTagsList((string) $cur);
                $list = $remove
                    ? array_filter($list, fn($t) => mb_strtolower($t) !== mb_strtolower($tag))
                    : array_merge($list, [$tag]);
                $set->execute([mailTagsNorm($list), now(), $id]);
            }
            ok(['ok' => true]);

        case 'mail_suppress':
            mailUser();
            $email = strtolower(trim(str($b, 'email', 190)));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                fail(400, 'invalid_argument', 'Enter a valid email address.');
            }
            if (!empty($b['on'])) {
                // v83: a privacy erasure or opt-out keeps its reason (a 'manual' row could be taken off by anyone)
                $st = mdb()->prepare('SELECT why FROM mail_suppress WHERE email = ?');
                $st->execute([$email]);
                if (!in_array((string) $st->fetchColumn(), MAIL_SUPPRESS_PRIVACY, true)) {
                    mdb()
                        ->prepare('REPLACE INTO mail_suppress (email, at, why) VALUES (?, ?, ?)')
                        ->execute([$email, now(), 'manual']);
                }
            } else {
                // v83: taking an address off the do-not-contact list is Contact cleanup (the same check as mail_unsuppress)
                mailUser('mail_cleanup');
                mailUnsuppress($email);
            }
            ok(['ok' => true]);

        case 'mail_log':
            $u = requireUser();
            if (userLevel($u) < 2) {
                fail(403, 'forbidden', 'Staff access is required.');
            }
            $where = [];
            $args = [];
            $q = mb_strtolower(trim(str($b, 'q', 120)));
            if ($q !== '') {
                $where[] = '(LOWER(to_email) LIKE ? OR LOWER(to_name) LIKE ? OR LOWER(subject) LIKE ?)';
                array_push($args, "%$q%", "%$q%", "%$q%");
            }
            if (in_array(str($b, 'status', 8), ['sent', 'failed'], true)) {
                $where[] = 'status = ?';
                $args[] = str($b, 'status', 8);
            }
            if (str($b, 'kind', 30) !== '') {
                $where[] = 'kind = ?';
                $args[] = str($b, 'kind', 30);
            }
            $sql = ' FROM mail_log' . ($where ? ' WHERE ' . implode(' AND ', $where) : '');
            $limit = max(1, min(200, (int) ($b['limit'] ?? 50)));
            $offset = max(0, (int) ($b['offset'] ?? 0));
            $cnt = mdb()->prepare('SELECT COUNT(*)' . $sql);
            $cnt->execute($args);
            $st = mdb()->prepare(
                'SELECT at, to_email, to_name, subject, kind, status, err' .
                    $sql .
                    " ORDER BY at DESC LIMIT $limit OFFSET $offset",
            );
            $st->execute($args);
            $failed = mdb()->prepare("SELECT COUNT(*) FROM mail_log WHERE status = 'failed' AND at > ?");
            $failed->execute([now() - 86400000]);
            $kinds = array_column(mdb()->query('SELECT DISTINCT kind FROM mail_log')->fetchAll(), 'kind');
            ok([
                'rows' => $st->fetchAll(),
                'total' => (int) $cnt->fetchColumn(),
                'sent24' => mailSentSince(now() - 86400000),
                'failed24' => (int) $failed->fetchColumn(),
                'limit' => (int) mailSettings()['limit'],
                'kinds' => $kinds,
            ]);

        case 'unsub_info':
            $st = mdb()->prepare('SELECT email, campaign FROM mail_queue WHERE tok = ?');
            $st->execute([(string) ($_GET['t'] ?? '')]);
            $qrow = $st->fetch();
            if (!$qrow) {
                // v46: the link in a sequence email (a person's follow-ups from a recruiter's or sales person's mailbox)
                require_once __DIR__ . '/seq.php';
                $sqe = sqTokEmail((string) ($_GET['t'] ?? ''));
                $qrow = $sqe !== '' ? ['email' => $sqe, 'campaign' => ''] : null;
            }
            if (!$qrow) {
                fail(404, 'not_found', 'This unsubscribe link is not valid.');
            }
            $email = (string) $qrow['email'];
            $done = mdb()->prepare('SELECT why FROM mail_suppress WHERE email = ?');
            $done->execute([$email]);
            [$local, $domain] = explode('@', (string) $email, 2);
            ok([
                'email' =>
                    mb_substr($local, 0, 2) . str_repeat('•', max(1, mb_strlen($local) - 2)) . '@' . $domain,
                'done' => $done->fetchColumn() !== false,
                // v37.5: email from a distribution list can be left on its own
                'lists' => mailUnsubLists((string) $qrow['campaign'], $email),
            ]);

        /* ---- Mailgun delivery events: bounces, complaints and unsubscribes stop future sends to that address ---- */
        case 'mail_webhook':
            $c = mailSettings();
            $raw = json_decode((string) file_get_contents('php://input'), true);
            $sig = (array) ($raw['signature'] ?? []);
            if (!mailgunVerify((string) ($sig['timestamp'] ?? ''), (string) ($sig['token'] ?? ''), (string) ($sig['signature'] ?? ''), $c['whk'])) {
                fail(403, 'bad_request', 'Signature check failed.');
            }
            $ev = (array) ($raw['event-data'] ?? []);
            $event = (string) ($ev['event'] ?? '');
            $rcpt = strtolower(trim((string) ($ev['recipient'] ?? '')));
            if ($rcpt !== '' && filter_var($rcpt, FILTER_VALIDATE_EMAIL)) {
                // v34: delivered, bounced, complained, delayed and unsubscribed all update the campaign recipient
                $ref = (string) ($ev['user-variables']['ref'] ?? '');
                $desc = (string) (($ev['delivery-status']['description'] ?? '') ?: ($ev['delivery-status']['message'] ?? '') ?: ($ev['reason'] ?? ''));
                $perm = (string) ($ev['severity'] ?? '') === 'permanent';
                $type = match ($event) {
                    'delivered' => 'delivered',
                    'failed' => $perm ? 'bounced' : 'soft',
                    'complained' => 'complained',
                    'unsubscribed' => 'unsub',
                    default => '',
                };
                if ($type !== '') {
                    mailEvent($rcpt, $type, $desc, $ref, 'mailgun-webhook');
                    if ($type !== 'delivered' && $type !== 'soft') {
                        mailLog("Mailgun event $event for $rcpt: future sends suppressed");
                    }
                }
                mailHookSeen('mailgun', $event . ' for ' . $rcpt);
            }
            ok(['ok' => true]);

        /* ---- Mailgun inbound route: replies and mail sent to the domain land in the portal Inbox ---- */
        case 'mail_inbound':
            $c = mailSettings();
            if (!mailgunVerify((string) ($_POST['timestamp'] ?? ''), (string) ($_POST['token'] ?? ''), (string) ($_POST['signature'] ?? ''), $c['whk'])) {
                fail(403, 'bad_request', 'Signature check failed.');
            }
            $files = [];
            foreach ($_FILES as $k => $f) {
                if (is_array($f) && ($f['error'] ?? 1) === UPLOAD_ERR_OK && str_starts_with((string) $k, 'attachment')) {
                    $files[] = ['name' => (string) ($f['name'] ?? 'attachment'), 'size' => (int) ($f['size'] ?? 0), 'tmp' => (string) $f['tmp_name']];
                }
            }
            $hdrs = [];
            foreach ((array) (json_decode((string) ($_POST['message-headers'] ?? '[]'), true) ?: []) as $hv) {
                if (is_array($hv) && count($hv) === 2) {
                    $hdrs[strtolower((string) $hv[0])][] = (string) $hv[1];
                }
            }
            // v83: Mailgun adds no Authentication-Results of its own, so any found here came with the message and prove
            // nothing (a list address trusts a sender only on its receiving server's DMARC pass; see dlSenderVouched)
            unset($hdrs['authentication-results'], $hdrs['arc-authentication-results']);
            mailInboundTake(
                (string) ($_POST['from'] ?? ($_POST['sender'] ?? '')),
                strtolower(trim((string) ($_POST['sender'] ?? ''))),
                (string) ($_POST['recipient'] ?? ''),
                (string) ($_POST['subject'] ?? ''),
                (string) ($_POST['stripped-text'] ?? ($_POST['body-plain'] ?? '')),
                (string) ($_POST['stripped-html'] ?? ($_POST['body-html'] ?? '')),
                $files,
                (string) ($_POST['Message-Id'] ?? ''),
                (string) ($_POST['In-Reply-To'] ?? ''),
                $hdrs
            );
            ok(['ok' => true]);

        case 'mail_inbox':
            mailUser();
            $folder = in_array(str($b, 'folder', 12), ['inbox', 'archive', 'trash'], true) ? str($b, 'folder', 12) : 'inbox';
            $q = trim(str($b, 'q', 100));
            $sql = 'SELECT id, at, from_email, from_name, to_email, subject, atts, ref, folder, seen, starred, SUBSTR(text, 1, 160) AS preview FROM mail_inbox WHERE folder = ?';
            $args = [$folder];
            if ($q !== '') {
                $sql .= ' AND (subject LIKE ? OR from_email LIKE ? OR from_name LIKE ? OR text LIKE ?)';
                $like = '%' . $q . '%';
                array_push($args, $like, $like, $like, $like);
            }
            $sql .= ' ORDER BY at DESC LIMIT 200';
            $st = mdb()->prepare($sql);
            $st->execute($args);
            $rows = array_map(function ($r) {
                $r['atts'] = json_decode((string) $r['atts'], true) ?: [];
                $r['seen'] = (bool) $r['seen'];
                $r['starred'] = (bool) $r['starred'];
                return $r;
            }, $st->fetchAll());
            $counts = [];
            foreach (mdb()->query("SELECT folder, SUM(CASE WHEN seen = 0 THEN 1 ELSE 0 END) AS unread, COUNT(*) AS n FROM mail_inbox GROUP BY folder") as $r) {
                $counts[$r['folder']] = ['unread' => (int) $r['unread'], 'n' => (int) $r['n']];
            }
            ok(['messages' => $rows, 'counts' => $counts]);

        case 'mail_inbox_get':
            mailUser();
            $st = mdb()->prepare('SELECT * FROM mail_inbox WHERE id = ?');
            $st->execute([str($b, 'id', 24)]);
            $r = $st->fetch();
            if (!$r) {
                fail(404, 'not_found', 'That message is gone.');
            }
            mdb()->prepare('UPDATE mail_inbox SET seen = 1 WHERE id = ?')->execute([$r['id']]);
            $r['atts'] = json_decode((string) $r['atts'], true) ?: [];
            $r['seen'] = true;
            $r['starred'] = (bool) $r['starred'];
            // v33: what the screening agent did with this message
            $agd = docGet('ats/x/agent/inbox/' . $r['id']);
            if ($agd && in_array((string) ($agd->kind ?? ''), ['resume', 'reply'], true)) {
                $r['agent'] = ['kind' => (string) $agd->kind, 'cids' => (array) ($agd->cids ?? []), 'names' => (array) ($agd->names ?? (isset($agd->n) ? [$agd->n] : [])), 'src' => (string) ($agd->src ?? '')];
            }
            ok(['message' => $r]);

        case 'mail_inbox_act':
            mailUser();
            $ids = array_values(array_filter(array_map(fn($x) => is_string($x) ? mb_substr($x, 0, 24) : '', (array) ($b['ids'] ?? [])), fn($x) => $x !== ''));
            $act = str($b, 'act', 12);
            if (!$ids) {
                ok(['ok' => true]);
            }
            $in = implode(',', array_fill(0, count($ids), '?'));
            $pdo = mdb();
            switch ($act) {
                case 'seen':
                case 'unseen':
                    $pdo->prepare("UPDATE mail_inbox SET seen = ? WHERE id IN ($in)")->execute([$act === 'seen' ? 1 : 0, ...$ids]);
                    break;
                case 'star':
                case 'unstar':
                    $pdo->prepare("UPDATE mail_inbox SET starred = ? WHERE id IN ($in)")->execute([$act === 'star' ? 1 : 0, ...$ids]);
                    break;
                case 'archive':
                case 'inbox':
                case 'trash':
                    $pdo->prepare("UPDATE mail_inbox SET folder = ? WHERE id IN ($in)")->execute([$act, ...$ids]);
                    break;
                case 'delete':
                    $pdo->prepare("DELETE FROM mail_inbox WHERE id IN ($in) AND folder = 'trash'")->execute($ids);
                    break;
                default:
                    fail(400, 'invalid_argument', 'Unknown action.');
            }
            ok(['ok' => true]);

        case 'mail_inbox_reply':
            $u = mailUser();
            session_write_close();
            $st = mdb()->prepare('SELECT * FROM mail_inbox WHERE id = ?');
            $st->execute([str($b, 'id', 24)]);
            $r = $st->fetch();
            if (!$r) {
                fail(404, 'not_found', 'That message is gone.');
            }
            $text = trim(str($b, 'text', 20000));
            if ($text === '') {
                fail(400, 'invalid_argument', 'Write a reply first.');
            }
            $subject = preg_match('/^re:/i', (string) $r['subject']) ? (string) $r['subject'] : 'Re: ' . $r['subject'];
            $quoted = "\n\n---\nOn " . date('M j, Y g:i A', (int) ($r['at'] / 1000)) . ', ' . ($r['from_name'] !== '' ? $r['from_name'] : $r['from_email']) . " wrote:\n" . preg_replace('/^/m', '> ', mb_substr((string) $r['text'], 0, 4000));
            $ok = mailDeliver([
                'to' => $r['from_email'],
                'name' => $r['from_name'],
                'subject' => $subject,
                'text' => $text . $quoted,
                'html' => emailHtml($subject, array_merge(explode("\n", $text), ['---', 'In reply to your message from ' . date('M j, Y', (int) ($r['at'] / 1000)) . '.'])),
                'kind' => 'inbox_reply',
                'reply' => $u['email'],
                'headers' => $r['msgid'] !== '' ? ['In-Reply-To' => $r['msgid'], 'References' => $r['msgid']] : [],
            ]);
            if (!$ok) {
                fail(400, 'invalid_argument', 'The reply did not send: ' . ((string) ($GLOBALS['mailErr'] ?? '')));
            }
            ok(['ok' => true]);

        case 'unsub':
            $st = mdb()->prepare('SELECT email, campaign FROM mail_queue WHERE tok = ?');
            $st->execute([(string) ($_GET['t'] ?? '')]);
            $qrow = $st->fetch();
            if (!$qrow) {
                require_once __DIR__ . '/seq.php';
                $sqe = sqTokEmail((string) ($_GET['t'] ?? ''));
                $qrow = $sqe !== '' ? ['email' => $sqe, 'campaign' => ''] : null;
            }
            if (!$qrow) {
                fail(404, 'not_found', 'This unsubscribe link is not valid.');
            }
            $email = (string) $qrow['email'];
            // v37.5: email from a distribution list: "leave this list" (the page's choice, and a mail program's
            // one-click unsubscribe), or every mailing when they ask for that
            $lists = mailUnsubLists((string) $qrow['campaign'], $email);
            $want = (string) ($_GET['list'] ?? '');
            $oneClick = (string) ($_POST['List-Unsubscribe'] ?? '') === 'One-Click';
            if ($lists && empty($_GET['all']) && ($want !== '' || $oneClick)) {
                require_once __DIR__ . '/maillists.php';
                $left = [];
                foreach ($lists as $l) {
                    if ($want === '' || $want === $l['id']) {
                        dlLeave($l['id'], $email);
                        $left[] = $l['name'];
                    }
                }
                if (!$left) {
                    fail(400, 'invalid_argument', 'That list is not the one this email came from.');
                }
                ok(['ok' => true, 'left' => $left]);
            }
            mdb()
                ->prepare('REPLACE INTO mail_suppress (email, at, why) VALUES (?, ?, ?)')
                ->execute([$email, now(), 'unsubscribed']);
            // v46: and out of every sequence at once (the next step would be held back anyway)
            require_once __DIR__ . '/seq.php';
            sqUnsubscribed($email);
            ok(['ok' => true]);
    }
    fail(404, 'not_found', 'Unknown action.');
}
