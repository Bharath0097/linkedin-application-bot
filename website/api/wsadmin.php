<?php
declare(strict_types=1);
/*
 * v37 Workspaces, routes ws_*:
 *   The provider console (StratEdge's own admin portal, administrators): list with usage, create (with a setup link
 *   emailed to the company's first administrator), change name / contact / parts of the portal / brand / pilot end /
 *   addresses, logo, pause and switch back on, send the setup link again, check an address, run the scheduled task
 *   now, delete (the folder moves to storage/ws/.trash; nothing is erased).
 *   Inside a workspace: the setup of its first administrator (from the link), the logo, the app manifest, a ping.
 *   The registry (storage/ws/registry.json) is what requests read; StratEdge's database keeps the setup link and the
 *   scheduled-task key of each workspace (ws/items/<name>).
 */
require_once __DIR__ . '/auth.php';

function wsProvider(): array
{
    $u = requireUser();
    if (wsCurrent() !== null || !hasRole($u, 'admin')) {
        fail(403, 'forbidden', 'Workspaces are run from StratEdge\'s own admin portal, by administrators.');
    }
    return $u;
}
/** Read-modify-write of the registry under a lock (two administrators saving at once do not lose a change). */
function wsRegistryUpdate(callable $fn)
{
    $dir = wsRoot();
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    $lock = @fopen($dir . '/registry.lock', 'c');
    if ($lock) {
        flock($lock, LOCK_EX);
    }
    try {
        $reg = wsRegistry(true);
        $out = $fn($reg);
        wsRegistrySave($reg);
        return $out;
    } finally {
        if ($lock) {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }
}
function wsHostOk(string $h): bool
{
    $main = wsMainHost();
    return (bool) preg_match('/^(?=.{4,190}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/', $h) && $h !== $main && $h !== 'www.' . $main && !str_ends_with($h, '.' . $main);
}
/** A workspace's setup link (the first administrator chooses a password there). */
function wsSetupUrl(string $slug, array $e, string $tok): string
{
    return wsUrlOf($slug, $e) . '#/ws-setup?t=' . $tok;
}
function wsSendSetup(array $u, string $slug, array $e, string $tok, string $intro = ''): bool
{
    $to = (string) ($e['admin']['email'] ?? '');
    $name = (string) ($e['admin']['name'] ?? '');
    $ws = (string) ($e['name'] ?? $slug);
    $url = wsSetupUrl($slug, $e, $tok);
    $subject = 'Your ' . $ws . ' portal is ready';
    $paras = [
        'Hello ' . ($name !== '' ? explode(' ', $name)[0] : 'there') . ',',
        // v37.4: a portal someone asked for on the website says so
        $intro !== '' ? $intro : $u['name'] . ' at StratEdge IT Consulting set up the ' . $ws . ' portal for your company. You are its first administrator.',
        'Choose your password with the button below. The link works for 14 days and only once.',
        'Your portal: ' . wsUrlOf($slug, $e),
    ];
    return sendMail($to, $name, $subject, implode("\n\n", $paras) . "\n\n" . $url, emailHtml($subject, $paras, ['Choose your password', $url]), [], (string) ($u['email'] ?? ''));
}
/** Users, records, files and the last sign-in of a workspace, read from its own database (read only). */
function wsUsage(string $slug): array
{
    $d = wsDirOf($slug);
    $out = ['users' => 0, 'admins' => 0, 'people' => 0, 'last' => 0, 'mb' => 0.0, 'cron' => 0, 'cronErr' => []];
    $f = $d . '/app.sqlite';
    if (is_file($f)) {
        try {
            $p = new PDO('sqlite:' . $f, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
            $p->exec('PRAGMA busy_timeout=2000');
            $out['users'] = (int) $p->query("SELECT COUNT(*) FROM users WHERE status = 'active'")->fetchColumn();
            $out['admins'] = (int) $p->query("SELECT COUNT(*) FROM users WHERE status = 'active' AND role = 'admin'")->fetchColumn();
            $out['people'] = (int) $p->query("SELECT COUNT(*) FROM docs WHERE col IN ('ats', 'rec/cand/items')")->fetchColumn();
            try {
                $out['last'] = (int) $p->query('SELECT COALESCE(MAX(at), 0) FROM auth_sessions')->fetchColumn();
                $c = $p->query("SELECT v FROM sec_kv WHERE k = 'cron_at'")->fetchColumn();
                $c = $c ? json_decode((string) $c, true) : null;
                if (is_array($c)) {
                    $out['cron'] = (int) ($c['at'] ?? 0);
                    $out['cronErr'] = array_slice(array_values(array_map('strval', (array) ($c['err'] ?? []))), 0, 3);
                }
            } catch (Throwable $e) {
                // a workspace nobody has signed in to yet has no security tables
            }
        } catch (Throwable $e) {
            $out['err'] = 'Its database could not be read.';
        }
    }
    $bytes = 0;
    $t0 = microtime(true);
    if (is_dir($d)) {
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($d, FilesystemIterator::SKIP_DOTS));
        foreach ($it as $file) {
            $bytes += $file->isFile() ? $file->getSize() : 0;
            if (microtime(true) - $t0 > 1.5) {
                break;
            }
        }
    }
    $out['mb'] = round($bytes / 1048576, 1);
    return $out;
}
/** The row the console shows. */
function wsRow(string $slug, array $e): array
{
    $doc = docGet('ws/items/' . $slug);
    return [
        'slug' => $slug,
        'name' => (string) ($e['name'] ?? $slug),
        'status' => (string) ($e['status'] ?? 'active'),
        'created' => (int) ($e['created'] ?? 0),
        'by' => (string) ($e['by'] ?? ''),
        'admin' => (array) ($e['admin'] ?? []),
        'contact' => (string) ($e['contact'] ?? ''),
        'features' => array_values((array) ($e['features'] ?? [])),
        'brand' => ['color' => (string) ($e['brand']['color'] ?? ''), 'tagline' => (string) ($e['brand']['tagline'] ?? ''), 'addr' => (string) ($e['brand']['addr'] ?? ''), 'logo' => !empty($e['brand']['logo']), 'logoAt' => (int) ($e['brand']['logoAt'] ?? 0)],
        'plan' => (array) ($e['plan'] ?? []),
        'hosts' => array_values((array) ($e['hosts'] ?? [])),
        'sub' => !empty($e['sub']),
        'primary' => (string) ($e['primary'] ?? 'path'),
        'shareAi' => !empty($e['shareAi']),
        'notes' => (string) ($e['notes'] ?? ''),
        // v37.4: made from a sign-up request on the website
        'signup' => (string) ($e['signup'] ?? ''),
        'setupDone' => !empty($e['setupDone']),
        'setupExp' => (int) ($e['setupExp'] ?? 0),
        'setupUrl' => empty($e['setupDone']) && !empty($doc->tok) && (int) ($e['setupExp'] ?? 0) > now() ? wsSetupUrl($slug, $e, (string) $doc->tok) : '',
        'url' => wsUrlOf($slug, $e),
        'pathUrl' => rtrim((string) (cfgRaw()['site_url'] ?? ''), '/') . '/w/' . $slug . '/',
        'subUrl' => wsMainHost() !== '' ? 'https://' . $slug . '.' . wsMainHost() . '/' : '',
        'checks' => (array) ($doc->checks ?? new stdClass()),
        'usage' => wsUsage($slug),
    ];
}
/** Fields the console may change, checked. */
function wsApply(array &$e, array $b, bool $creating): void
{
    if (isset($b['name']) || $creating) {
        $n = trim(mb_substr((string) ($b['name'] ?? ''), 0, 80));
        if (mb_strlen($n) < 2) {
            fail(400, 'invalid_argument', 'Give the company\'s name.');
        }
        $e['name'] = $n;
    }
    if (array_key_exists('contact', $b)) {
        $c = mb_strtolower(trim((string) $b['contact']));
        if ($c !== '' && !filter_var($c, FILTER_VALIDATE_EMAIL)) {
            fail(400, 'invalid_argument', 'The contact email is not a valid address.');
        }
        $e['contact'] = $c;
    }
    if (isset($b['features'])) {
        $e['features'] = array_values(array_intersect(array_keys(WS_FEATURES), array_map('strval', (array) $b['features'])));
    }
    if (isset($b['color'])) {
        $col = trim((string) $b['color']);
        if ($col !== '' && !preg_match('/^#[0-9a-fA-F]{6}$/', $col)) {
            fail(400, 'invalid_argument', 'The brand color is a hex code such as #2B3993.');
        }
        $e['brand']['color'] = strtoupper($col);
    }
    if (isset($b['tagline'])) {
        $e['brand']['tagline'] = trim(mb_substr((string) $b['tagline'], 0, 120));
    }
    if (isset($b['addr'])) {
        // the company's postal address: the footer of its emails (marketing emails need one) and its pages
        $e['brand']['addr'] = trim((string) preg_replace('/\s+/', ' ', mb_substr((string) $b['addr'], 0, 200)));
    }
    if (isset($b['until'])) {
        $until = trim((string) $b['until']);
        if ($until !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $until)) {
            fail(400, 'invalid_argument', 'The pilot end date is not a date.');
        }
        $e['plan'] = ['kind' => 'pilot', 'until' => $until];
    }
    if (isset($b['sub'])) {
        $e['sub'] = !empty($b['sub']);
    }
    if (isset($b['hosts'])) {
        $hosts = [];
        foreach ((array) $b['hosts'] as $h) {
            $h = strtolower(trim((string) $h));
            $h = (string) preg_replace('#^https?://#', '', rtrim($h, '/'));
            if ($h === '') {
                continue;
            }
            if (!wsHostOk($h)) {
                fail(400, 'invalid_argument', $h . ' is not an address a workspace can use (their own domain, such as portal.theircompany.com).');
            }
            foreach (wsRegistry() as $s => $o) {
                if ($s !== ($e['_slug'] ?? '') && in_array($h, (array) ($o['hosts'] ?? []), true)) {
                    fail(409, 'invalid_argument', $h . ' already belongs to ' . ($o['name'] ?? $s) . '.');
                }
            }
            $hosts[] = $h;
        }
        $e['hosts'] = array_slice(array_values(array_unique($hosts)), 0, 5);
    }
    if (isset($b['primary'])) {
        $p = (string) $b['primary'];
        $e['primary'] = $p === 'sub' || in_array($p, (array) ($e['hosts'] ?? []), true) ? $p : 'path';
    }
    if (($e['primary'] ?? 'path') === 'sub' && empty($e['sub'])) {
        $e['primary'] = 'path';
    }
    if (($e['primary'] ?? 'path') !== 'path' && ($e['primary'] ?? '') !== 'sub' && !in_array($e['primary'], (array) ($e['hosts'] ?? []), true)) {
        $e['primary'] = 'path';
    }
    if (isset($b['shareAi'])) {
        $e['shareAi'] = !empty($b['shareAi']);
    }
    if (isset($b['notes'])) {
        $e['notes'] = trim(mb_substr((string) $b['notes'], 0, 1000));
    }
}
/** Calls a workspace's own scheduled task (a request to its address with its key). */
function wsRunCron(string $slug, array $e, int $timeout = 120): array
{
    $doc = docGet('ws/items/' . $slug);
    $key = (string) ($doc->ck ?? '');
    if ($key === '') {
        return ['ok' => false, 'err' => 'No key for its scheduled task.'];
    }
    $base = wsLoopUrl($slug);
    $ch = curl_init($base . 'api/index.php?r=ws_cron&key=' . $key);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_HTTPHEADER => ['X-Requested-With: fetch'], CURLOPT_USERAGENT => 'StratEdge-workspaces/1']);
    $body = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    $j = json_decode($body, true);
    return $code === 200 && is_array($j) ? ['ok' => true, 'lines' => (array) ($j['lines'] ?? [])] : ['ok' => false, 'err' => $err !== '' ? $err : 'The workspace answered ' . $code . '.'];
}
/** StratEdge's scheduled run, then every active workspace's own (command line: a separate PHP process per
 *  workspace when the host allows it; otherwise, and from the web link, a request to the workspace's address). */
function wsCronAll(bool $cli): array
{
    $out = [];
    $t0 = microtime(true);
    foreach (wsRegistry(true) as $slug => $e) {
        $slug = (string) $slug;
        if (($e['status'] ?? '') !== 'active' || empty($e['setupDone'])) {
            continue;
        }
        if (microtime(true) - $t0 > ($cli ? 1500 : 200)) {
            $out[] = date('c') . ' workspaces: out of time, the rest run next time';
            break;
        }
        if ($cli && function_exists('proc_open') && defined('PHP_BINARY') && PHP_BINARY !== '') {
            $p = @proc_open([PHP_BINARY, __DIR__ . '/cron.php', '--ws=' . $slug], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
            if (is_resource($p)) {
                stream_set_blocking($pipes[1], false);
                $buf = '';
                $start = microtime(true);
                while (true) {
                    $buf .= (string) stream_get_contents($pipes[1]);
                    $st = proc_get_status($p);
                    if (!$st['running']) {
                        $buf .= (string) stream_get_contents($pipes[1]);
                        break;
                    }
                    if (microtime(true) - $start > 600) {
                        proc_terminate($p);
                        $buf .= "\n(stopped after 10 minutes)";
                        break;
                    }
                    usleep(200000);
                }
                @fclose($pipes[1]);
                @fclose($pipes[2]);
                @proc_close($p);
                $lines = array_values(array_filter(array_map('trim', explode("\n", $buf))));
                $out[] = date('c') . ' workspace ' . $slug . ': ' . count($lines) . ' task line' . (count($lines) === 1 ? '' : 's') . ($lines ? ' (' . mb_substr(implode(' | ', array_slice($lines, -3)), 0, 300) . ')' : '');
                continue;
            }
        }
        $r = wsRunCron($slug, $e, 120);
        $out[] = date('c') . ' workspace ' . $slug . ': ' . ($r['ok'] ? count($r['lines']) . ' task lines' : 'failed: ' . $r['err']);
    }
    return $out;
}
/** The address this server reaches a workspace at for its scheduled task: /w/<name>/ on the site's own address. */
function wsLoopUrl(string $slug): string
{
    $main = rtrim((string) (getenv('SE_WS_LOOP') ?: (cfgRaw()['site_url'] ?? '')), '/');
    return $main . '/w/' . $slug . '/';
}

/** v37.4: makes a workspace: the console's "New workspace" and an approved sign-up request (by hand or automatic).
 *  Its own checks come back as ['err' => message, 'code' => status], so a sign-up can fall back to the review queue
 *  instead of stopping; wrong brand fields from the console still stop the request (wsApply). */
function wsMake(array $u, array $b, string $intro = ''): array
{
    $slug = strtolower(trim((string) ($b['slug'] ?? '')));
    if (!preg_match(WS_SLUG_RE, $slug) || mb_strlen($slug) < 2) {
        return ['err' => 'The short name is 2 to 30 lowercase letters, numbers and hyphens (it becomes the address: /w/' . ($slug ?: 'acme') . '/).', 'code' => 400];
    }
    if (in_array($slug, WS_RESERVED, true)) {
        return ['err' => '"' . $slug . '" is kept for the site itself. Choose another short name.', 'code' => 400];
    }
    if (isset(wsRegistry(true)[$slug]) || is_dir(wsDirOf($slug))) {
        return ['err' => 'A workspace called "' . $slug . '" exists already.', 'code' => 409];
    }
    $an = trim(mb_substr((string) ($b['adminName'] ?? ''), 0, 120));
    $ae = mb_strtolower(trim((string) ($b['adminEmail'] ?? '')));
    if (mb_strlen($an) < 2 || !filter_var($ae, FILTER_VALIDATE_EMAIL)) {
        return ['err' => 'Give the name and email of the company\'s first administrator.', 'code' => 400];
    }
    if (mb_strlen(trim((string) ($b['name'] ?? ''))) < 2) {
        return ['err' => 'Give the company\'s name.', 'code' => 400];
    }
    $preset = (string) ($b['preset'] ?? 'staffing');
    $e = [
        'name' => '', 'status' => 'active', 'created' => now(), 'by' => (string) $u['name'],
        'admin' => ['name' => $an, 'email' => $ae], 'contact' => $ae,
        'features' => WS_PRESETS[$preset]['f'] ?? WS_PRESETS['staffing']['f'],
        'brand' => ['color' => '', 'tagline' => '', 'addr' => '', 'logo' => '', 'logoAt' => 0],
        'plan' => ['kind' => 'pilot', 'until' => date('Y-m-d', time() + 86400 * max(1, min(365, (int) ($b['pilotDays'] ?? 90))))],
        'hosts' => [], 'sub' => false, 'primary' => 'path',
        // v83: a workspace StratEdge makes or approves uses its AI connection unless told otherwise; one made automatically
        // from a sign-up does not (wsjoin.php passes shareAi false) until StratEdge ticks it under Workspaces > Manage
        'shareAi' => !array_key_exists('shareAi', $b) || !empty($b['shareAi']), 'notes' => '', '_slug' => $slug,
    ];
    if (!empty($b['signup'])) {
        // the sign-up request it came from (Workspaces > Sign-up requests)
        $e['signup'] = (string) $b['signup'];
    }
    wsApply($e, ['name' => $b['name'] ?? '', 'color' => $b['color'] ?? '', 'tagline' => $b['tagline'] ?? '', 'addr' => $b['addr'] ?? ''] + (isset($b['features']) ? ['features' => $b['features']] : []) + (isset($b['notes']) ? ['notes' => $b['notes']] : []), true);
    unset($e['_slug']);
    if (!$e['features']) {
        return ['err' => 'Choose at least one part of the portal.', 'code' => 400];
    }
    $dir = wsDirOf($slug);
    if (!@mkdir($dir . '/files', 0770, true) || !@mkdir($dir . '/brand', 0770, true)) {
        return ['err' => 'The folder for the workspace could not be made (storage/ws must be writable by the web server).', 'code' => 500];
    }
    @file_put_contents($dir . '/.htaccess', "Require all denied\nDeny from all\n");
    $tok = bin2hex(random_bytes(24));
    $ck = bin2hex(random_bytes(20));
    $e['setupHash'] = hash('sha256', $tok);
    $e['setupExp'] = now() + 14 * 86400000;
    $e['ck'] = hash('sha256', $ck);
    wsRegistryUpdate(function (array &$reg) use ($slug, $e) {
        $reg[$slug] = $e;
    });
    docSet('ws/items/' . $slug, (object) ['tok' => $tok, 'ck' => $ck, 'at' => now(), 'by' => (string) ($u['id'] ?? '')]);
    $mailed = wsSendSetup($u, $slug, $e, $tok, $intro);
    audit('settings', 'Workspace created', $slug, ['name' => $e['name'], 'admin' => $ae, 'features' => $e['features']] + (isset($e['signup']) ? ['signup' => $e['signup']] : []), $u);
    return ['slug' => $slug, 'e' => wsRegistry(true)[$slug], 'mailed' => $mailed, 'tok' => $tok];
}

function wsRoute(string $r, array $b): never
{
    if (str_starts_with($r, 'ws_signup')) {
        // v37.4: companies asking for a portal on StratEdge's website, and the review of their requests
        require_once __DIR__ . '/wsjoin.php';
        wsjRoute($r, $b);
    }
    switch ($r) {
        /* ---------- anywhere ---------- */
        case 'ws_ping': {
            $ws = wsCurrent();
            ok(['ws' => $ws && empty($ws['missing']) ? (string) $ws['slug'] : null, 'name' => $ws && empty($ws['missing']) ? (string) ($ws['name'] ?? '') : '', 'provider' => $ws === null]);
        }
        /* ---------- inside a workspace ---------- */
        case 'ws_logo': {
            $ws = wsCurrent();
            $ext = $ws && empty($ws['missing']) ? (string) ($ws['brand']['logo'] ?? '') : '';
            $f = $ext !== '' ? wsDirOf((string) $ws['slug']) . '/brand/logo.' . $ext : '';
            if ($f === '' || !is_file($f)) {
                http_response_code(404);
                exit();
            }
            header('Content-Type: ' . ['png' => 'image/png', 'jpg' => 'image/jpeg', 'webp' => 'image/webp'][$ext]);
            header('Cache-Control: public, max-age=86400');
            header('Content-Length: ' . filesize($f));
            readfile($f);
            exit();
        }
        case 'ws_icon': {
            // a workspace without a logo: its first letter in white on its color, as the installed app's icon
            $ws = wsCurrent();
            $name = $ws && empty($ws['missing']) ? trim((string) ($ws['name'] ?? $ws['slug'])) : '';
            $col = $ws && preg_match('/^#[0-9A-Fa-f]{6}$/', (string) ($ws['brand']['color'] ?? '')) ? (string) $ws['brand']['color'] : '#2B3993';
            $letter = $name !== '' ? mb_strtoupper(mb_substr($name, 0, 1)) : 'P';
            header('Content-Type: image/svg+xml');
            header('Cache-Control: public, max-age=86400');
            echo '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="104" fill="' . $col . '"/><text x="256" y="270" font-family="system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif" font-size="300" font-weight="700" fill="#fff" text-anchor="middle" dominant-baseline="middle">' . htmlspecialchars($letter, ENT_XML1 | ENT_QUOTES) . '</text></svg>';
            exit();
        }
        case 'ws_manifest': {
            $p = wsPublic();
            $name = $p && empty($p['missing']) ? $p['name'] : 'StratEdge portal';
            // the manifest is read at <portal>/api/index.php, so its addresses are written from the portal's own folder
            // (/w/<name>/ or /), never relative to the API
            $path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
            $base = (string) preg_replace('#api/index\.php$#', '', $path);
            $base = str_ends_with($base, '/') ? $base : '/';
            header('Content-Type: application/manifest+json');
            echo json_encode([
                'name' => $name, 'short_name' => mb_substr($name, 0, 12), 'start_url' => $base . '#/login', 'scope' => $base, 'display' => 'standalone',
                'background_color' => '#ffffff', 'theme_color' => ($p['brand']['color'] ?? '') ?: '#2B3993',
                // its logo, or its first letter on its color (never StratEdge's icon)
                'icons' => $p && !empty($p['brand']['logo']) ? [['src' => $base . $p['brand']['logo'], 'sizes' => '192x192', 'type' => 'image/png']] : [['src' => $base . 'api/index.php?r=ws_icon', 'sizes' => 'any', 'type' => 'image/svg+xml', 'purpose' => 'any']],
            ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            exit();
        }
        case 'ws_setup_get':
        case 'ws_setup': {
            $ws = wsCurrent();
            if (!$ws || !empty($ws['missing'])) {
                fail(404, 'not_found', 'This link belongs to a company portal.');
            }
            $slug = (string) $ws['slug'];
            if (!empty($ws['setupDone'])) {
                ok(['done' => true, 'name' => (string) ($ws['name'] ?? '')]);
            }
            $tok = (string) ($b['t'] ?? '');
            if (throttleHit('wssetup:' . clientIp(), 30, 3600)) {
                fail(429, 'rate_limited', 'Too many tries. Try again in an hour.');
            }
            if ($tok === '' || !preg_match('/^[a-f0-9]{48}$/', $tok) || !hash_equals((string) ($ws['setupHash'] ?? ''), hash('sha256', $tok)) || (int) ($ws['setupExp'] ?? 0) < now()) {
                fail(403, 'bad_link', 'This setup link is not valid any more. Ask the StratEdge Workspaces team for a new one.');
            }
            $admin = (array) ($ws['admin'] ?? []);
            if ($r === 'ws_setup_get') {
                ok(['done' => false, 'name' => (string) ($ws['name'] ?? ''), 'admin' => ['name' => (string) ($admin['name'] ?? ''), 'email' => (string) ($admin['email'] ?? '')]]);
            }
            $name = trim(mb_substr((string) ($b['name'] ?? ($admin['name'] ?? '')), 0, 120));
            $email = mb_strtolower((string) ($admin['email'] ?? ''));
            $pass = (string) ($b['password'] ?? '');
            if (mb_strlen($name) < 2) {
                fail(400, 'invalid_argument', 'Add your full name.');
            }
            $weak = pwProblem($pass, ['email' => $email, 'name' => $name, 'mfa' => false, 'check' => true]);
            if ($weak !== '') {
                fail(400, 'weak_password', $weak);
            }
            // one setup only: the registry is changed first, under its lock
            $first = wsRegistryUpdate(function (array &$reg) use ($slug) {
                if (empty($reg[$slug]) || !empty($reg[$slug]['setupDone'])) {
                    return false;
                }
                $reg[$slug]['setupDone'] = true;
                $reg[$slug]['setupAt'] = now();
                unset($reg[$slug]['setupHash'], $reg[$slug]['setupExp']);
                return true;
            });
            if (!$first) {
                fail(409, 'invalid_argument', 'This portal is set up already. Log in instead.');
            }
            $p = db();
            $s = $p->prepare('SELECT id FROM users WHERE email = ?');
            $s->execute([$email]);
            $id = (string) ($s->fetchColumn() ?: '');
            if ($id === '') {
                $id = 'u_' . rid(8);
                $p->prepare('INSERT INTO users (id, email, name, pass, role, status, created) VALUES (?,?,?,?,?,?,?)')->execute([$id, $email, $name, pwHash($pass), 'admin', 'active', now()]);
            } else {
                $p->prepare("UPDATE users SET name = ?, pass = ?, role = 'admin', status = 'active' WHERE id = ?")->execute([$name, pwHash($pass), $id]);
            }
            authUserSet($id, ['pw_at' => now(), 'pw_check' => now()]);
            audit('auth', 'Workspace set up: first administrator', $email, ['ws' => $slug]);
            $res = authFinish(['id' => $id, 'name' => $name, 'email' => $email, 'role' => 'admin', 'status' => 'active', 'access' => ''], 'password:admin', 'admin', 0, '#/portal/admin');
            ok(['done' => true, 'go' => $res['go'] ?: '#/portal/admin', 'user' => $res['user']]);
        }
        case 'ws_cron': {
            // the provider's scheduled task runs each workspace's scheduled work at its own address
            $ws = wsCurrent();
            $key = (string) ($_GET['key'] ?? '');
            if (!$ws || !empty($ws['missing']) || $key === '' || !hash_equals((string) ($ws['ck'] ?? ''), hash('sha256', $key))) {
                fail(403, 'forbidden', 'Wrong key.');
            }
            session_write_close();
            @set_time_limit(280);
            ignore_user_abort(true);
            require_once __DIR__ . '/cronlib.php';
            $GLOBALS['mailKind'] = 'cron';
            ok(['ws' => (string) $ws['slug'], 'lines' => cronAll(false)]);
        }
    }

    /* ---------- the provider console ---------- */
    $u = wsProvider();
    switch ($r) {
        case 'ws_list': {
            $rows = [];
            foreach (wsRegistry(true) as $slug => $e) {
                if (($e['status'] ?? '') === 'deleted') {
                    continue;
                }
                $rows[] = wsRow((string) $slug, $e);
            }
            usort($rows, fn($a, $b2) => $b2['created'] <=> $a['created']);
            $features = [];
            foreach (WS_FEATURES as $k => $f) {
                $features[] = ['k' => $k, 'n' => $f['n'], 'd' => $f['d']];
            }
            $presets = [];
            foreach (WS_PRESETS as $k => $p) {
                $presets[] = ['k' => $k, 'n' => $p['n'], 'f' => $p['f']];
            }
            // v37.4: sign-up requests waiting (the tab's count)
            $sign = ['new' => 0, 'unverified' => 0, 'mode' => 'off'];
            foreach (colAll('ws/signup') as [, $s]) {
                $k = (string) ($s->st ?? '');
                if (isset($sign[$k])) {
                    $sign[$k]++;
                }
            }
            $sc = secKv('ws_signup_cfg', []);
            $sign['mode'] = is_array($sc) && in_array($sc['mode'] ?? '', ['review', 'auto'], true) ? (string) $sc['mode'] : 'off';
            ok(['rows' => $rows, 'features' => $features, 'presets' => $presets, 'main' => wsMainHost(), 'base' => rtrim((string) (cfgRaw()['site_url'] ?? ''), '/') . '/w/', 'writable' => is_dir(wsRoot()) ? is_writable(wsRoot()) : is_writable(dirname(wsRoot())), 'signups' => $sign]);
        }
        case 'ws_create': {
            $m = wsMake($u, $b);
            if (isset($m['err'])) {
                fail((int) $m['code'], 'invalid_argument', (string) $m['err']);
            }
            ok(['row' => wsRow($m['slug'], $m['e']), 'mailed' => $m['mailed']]);
        }
        case 'ws_save': {
            $slug = (string) ($b['slug'] ?? '');
            if (!isset(wsRegistry(true)[$slug])) {
                fail(404, 'not_found', 'No such workspace.');
            }
            $changed = wsRegistryUpdate(function (array &$reg) use ($slug, $b) {
                $e = $reg[$slug];
                $e['_slug'] = $slug;
                wsApply($e, $b, false);
                unset($e['_slug']);
                $reg[$slug] = $e;
                return $e;
            });
            audit('settings', 'Workspace changed', $slug, array_intersect_key($b, array_flip(['name', 'contact', 'features', 'until', 'sub', 'hosts', 'primary', 'shareAi', 'color', 'tagline', 'addr'])), $u);
            ok(['row' => wsRow($slug, $changed)]);
        }
        case 'ws_logo_save': {
            $slug = (string) ($_POST['slug'] ?? ($b['slug'] ?? ''));
            if (!isset(wsRegistry(true)[$slug])) {
                fail(404, 'not_found', 'No such workspace.');
            }
            $f = $_FILES['file'] ?? null;
            if (!$f || (int) ($f['error'] ?? 1) !== 0 || !is_uploaded_file((string) $f['tmp_name']) || (int) $f['size'] > 1048576) {
                fail(400, 'invalid_argument', 'Choose a PNG, JPEG or WebP picture up to 1 MB.');
            }
            $info = @getimagesize((string) $f['tmp_name']);
            $ext = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp'][$info['mime'] ?? ''] ?? '';
            if ($ext === '' || ($info[0] ?? 0) < 32 || ($info[1] ?? 0) < 32) {
                fail(400, 'invalid_argument', 'Choose a PNG, JPEG or WebP picture (at least 32 pixels).');
            }
            $dir = wsDirOf($slug) . '/brand';
            if (!is_dir($dir)) {
                @mkdir($dir, 0770, true);
            }
            foreach (glob($dir . '/logo.*') ?: [] as $old) {
                @unlink($old);
            }
            if (!move_uploaded_file((string) $f['tmp_name'], $dir . '/logo.' . $ext)) {
                fail(500, 'unavailable', 'The picture could not be stored.');
            }
            $e = wsRegistryUpdate(function (array &$reg) use ($slug, $ext) {
                $reg[$slug]['brand']['logo'] = $ext;
                $reg[$slug]['brand']['logoAt'] = now();
                return $reg[$slug];
            });
            audit('settings', 'Workspace logo changed', $slug, [], $u);
            ok(['row' => wsRow($slug, $e)]);
        }
        case 'ws_status': {
            $slug = (string) ($b['slug'] ?? '');
            $st = (string) ($b['st'] ?? '');
            if (!isset(wsRegistry(true)[$slug]) || !in_array($st, ['active', 'paused'], true)) {
                fail(400, 'invalid_argument', 'No such workspace or state.');
            }
            $e = wsRegistryUpdate(function (array &$reg) use ($slug, $st) {
                $reg[$slug]['status'] = $st;
                return $reg[$slug];
            });
            audit('settings', $st === 'paused' ? 'Workspace paused' : 'Workspace switched back on', $slug, [], $u);
            ok(['row' => wsRow($slug, $e)]);
        }
        case 'ws_invite': {
            $slug = (string) ($b['slug'] ?? '');
            $e = wsRegistry(true)[$slug] ?? null;
            if (!$e) {
                fail(404, 'not_found', 'No such workspace.');
            }
            if (!empty($e['setupDone'])) {
                fail(409, 'invalid_argument', 'Its first administrator has set it up already; they add the other people themselves.');
            }
            if (isset($b['adminEmail'])) {
                $ae = mb_strtolower(trim((string) $b['adminEmail']));
                if (!filter_var($ae, FILTER_VALIDATE_EMAIL)) {
                    fail(400, 'invalid_argument', 'Not a valid email address.');
                }
                $e['admin']['email'] = $ae;
                $e['admin']['name'] = trim(mb_substr((string) ($b['adminName'] ?? ($e['admin']['name'] ?? '')), 0, 120));
            }
            $tok = bin2hex(random_bytes(24));
            $e = wsRegistryUpdate(function (array &$reg) use ($slug, $tok, $e) {
                $reg[$slug]['admin'] = $e['admin'];
                $reg[$slug]['setupHash'] = hash('sha256', $tok);
                $reg[$slug]['setupExp'] = now() + 14 * 86400000;
                return $reg[$slug];
            });
            $doc = docGet('ws/items/' . $slug) ?? new stdClass();
            $doc->tok = $tok;
            docSet('ws/items/' . $slug, $doc);
            $mailed = wsSendSetup($u, $slug, $e, $tok);
            audit('settings', 'Workspace setup link sent again', $slug, ['to' => $e['admin']['email'] ?? ''], $u);
            ok(['row' => wsRow($slug, $e), 'mailed' => $mailed]);
        }
        case 'ws_check': {
            // does an address answer as this workspace? (DNS, then the workspace's own ping over HTTPS)
            require_once __DIR__ . '/connectors.php';
            $slug = (string) ($b['slug'] ?? '');
            $e = wsRegistry(true)[$slug] ?? null;
            if (!$e) {
                fail(404, 'not_found', 'No such workspace.');
            }
            $what = (string) ($b['what'] ?? 'path');
            $host = strtolower(trim((string) ($b['host'] ?? '')));
            if ($what === 'sub') {
                $url = 'https://' . $slug . '.' . wsMainHost() . '/';
                $dev = in_array(strtolower((string) preg_replace('/:\d+$/', '', (string) ($_SERVER['HTTP_HOST'] ?? ''))), ['localhost', '127.0.0.1'], true);
                if ($dev) {
                    $url = 'http://' . $slug . '.localhost' . (preg_match('/:(\d+)$/', (string) ($_SERVER['HTTP_HOST'] ?? ''), $pm) ? ':' . $pm[1] : '') . '/';
                }
            } elseif ($what === 'host') {
                if (!in_array($host, (array) ($e['hosts'] ?? []), true)) {
                    fail(400, 'invalid_argument', 'Add the address to the workspace first.');
                }
                $url = 'https://' . $host . '/';
            } else {
                $url = wsLoopUrl($slug);
            }
            $why = cxUrlProblem($url);
            $res = ['url' => $url, 'at' => now(), 'ok' => false, 'msg' => ''];
            if ($why !== '') {
                $res['msg'] = $why;
            } else {
                $ch = curl_init($url . 'api/index.php?r=ws_ping');
                curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_USERAGENT => 'StratEdge-workspaces/1', CURLOPT_FOLLOWLOCATION => false]);
                $body = (string) curl_exec($ch);
                $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
                $err = curl_error($ch);
                curl_close($ch);
                $j = json_decode($body, true);
                if ($err !== '') {
                    $res['msg'] = 'No answer from ' . $url . ' (' . $err . '). Check the DNS record and that the address is added on the hosting (and has a certificate).';
                } elseif ($code !== 200 || !is_array($j)) {
                    $res['msg'] = $url . ' answered ' . $code . ' but not as this portal: check that it points to this hosting account and its folder.';
                } elseif (($j['ws'] ?? null) !== $slug) {
                    $res['msg'] = $url . ' reaches this site but not this workspace' . (($j['ws'] ?? null) ? ' (it shows ' . $j['ws'] . ')' : (!empty($j['provider']) ? ' (it shows StratEdge\'s own site: switch on its address in the workspace, then check again)' : '')) . '.';
                } else {
                    $res['ok'] = true;
                    $res['msg'] = $url . ' works: it opens this portal.';
                }
            }
            $doc = docGet('ws/items/' . $slug) ?? new stdClass();
            $checks = isset($doc->checks) && $doc->checks instanceof stdClass ? $doc->checks : new stdClass();
            $checks->{$what === 'host' ? $host : $what} = (object) $res;
            $doc->checks = $checks;
            docSet('ws/items/' . $slug, $doc);
            ok($res);
        }
        case 'ws_run': {
            $slug = (string) ($b['slug'] ?? '');
            $e = wsRegistry(true)[$slug] ?? null;
            if (!$e || ($e['status'] ?? '') !== 'active') {
                fail(400, 'invalid_argument', 'Only an active workspace runs its scheduled work.');
            }
            session_write_close();
            @set_time_limit(200);
            ok(wsRunCron($slug, $e, 180));
        }
        case 'ws_delete': {
            requireRecentAuth();
            $slug = (string) ($b['slug'] ?? '');
            $e = wsRegistry(true)[$slug] ?? null;
            if (!$e) {
                fail(404, 'not_found', 'No such workspace.');
            }
            if ((string) ($b['confirm'] ?? '') !== $slug) {
                fail(400, 'invalid_argument', 'Type the workspace\'s short name to confirm.');
            }
            $trash = wsRoot() . '/.trash';
            if (!is_dir($trash)) {
                @mkdir($trash, 0770, true);
                @file_put_contents($trash . '/.htaccess', "Require all denied\nDeny from all\n");
            }
            $to = $trash . '/' . $slug . '-' . gmdate('Ymd-His');
            if (is_dir(wsDirOf($slug)) && !@rename(wsDirOf($slug), $to)) {
                fail(500, 'unavailable', 'The workspace folder could not be moved aside.');
            }
            wsRegistryUpdate(function (array &$reg) use ($slug) {
                unset($reg[$slug]);
            });
            docDelete('ws/items/' . $slug);
            audit('settings', 'Workspace deleted (folder kept in storage/ws/.trash)', $slug, ['name' => $e['name'] ?? '', 'kept' => basename($to)], $u);
            ok(['ok' => true, 'kept' => 'storage/ws/.trash/' . basename($to)]);
        }
    }
    fail(404, 'not_found', 'Unknown action.');
}
