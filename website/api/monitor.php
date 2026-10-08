<?php
declare(strict_types=1);
/*
 * v34 monitoring (Security center > Monitoring):
 *   - File integrity: every shipped file is compared daily with its SHA-256 from the build (api/manifest.json); files
 *     people edit (config.php, js/config.js, .user.ini) against the last accepted copy; any PHP file that should not
 *     exist (a web shell) is reported at once.
 *   - Security self-check: HTTPS and the certificate, security headers, files that must never download, PHP settings,
 *     the encryption key, encrypted files, backups, administrators and two-step sign-in, email domain records (SPF,
 *     DMARC), security.txt, the firewall and the audit chain.
 *   - A daily email to the security contacts when something needs attention.
 */

const MON_PHP_EOL = ['8.0' => '2023-11-26', '8.1' => '2025-12-31', '8.2' => '2026-12-31', '8.3' => '2027-12-31', '8.4' => '2028-12-31', '8.5' => '2029-12-31'];

/** The site folder, and the folders the integrity walk skips (data, not code). */
function monRoot(): string
{
    return dirname(__DIR__);
}
/** .htaccess without the blocks cPanel writes itself (the PHP version handler), as built. */
function monHtaccessCore(string $s): string
{
    $s = str_replace("\r\n", "\n", $s);
    $s = (string) preg_replace('/# php -- BEGIN cPanel-generated handler.*?# php -- END cPanel-generated handler[^\n]*\n?/s', '', $s);
    $s = (string) preg_replace('/# BEGIN cPanel-generated.*?# END cPanel-generated[^\n]*\n?/s', '', $s);
    return trim($s);
}
function monIntegrity(): array
{
    $root = monRoot();
    $man = json_decode((string) @file_get_contents($root . '/api/manifest.json'), true);
    $sha = is_array($man['sha'] ?? null) ? $man['sha'] : [];
    $changed = [];
    $missing = [];
    foreach ($sha as $rel => $h) {
        if ($rel === '.htaccess#core') {
            $f = $root . '/.htaccess';
            if (!is_file($f)) {
                $missing[] = '.htaccess';
            } elseif (hash('sha256', monHtaccessCore((string) file_get_contents($f))) !== $h) {
                $changed[] = '.htaccess';
            }
            continue;
        }
        $f = $root . '/' . $rel;
        if (!is_file($f)) {
            $missing[] = $rel;
        } elseif (hash_file('sha256', $f) !== $h) {
            $changed[] = $rel;
        }
    }
    // files people edit on the server: compared with the copy accepted last time
    $base = secKv('integrity_base', []);
    $base = is_array($base) ? $base : [];
    $edited = [];
    $now = [];
    foreach (['api/config.php', 'js/config.js', 'api/.user.ini', '.user.ini'] as $rel) {
        $f = $root . '/' . $rel;
        $now[$rel] = is_file($f) ? hash_file('sha256', $f) : '';
        if (isset($base[$rel]) && $base[$rel] !== $now[$rel]) {
            $edited[] = $rel;
        }
    }
    if (!$base) {
        secKvSet('integrity_base', $now);
    }
    // code that should not be there: any PHP-like file outside what was shipped (web shells, leftovers of hacks)
    $known = array_flip(array_keys($sha));
    $unexpected = [];
    $it = new RecursiveIteratorIterator(new RecursiveCallbackFilterIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), function ($cur, $key, $iter) use ($root) {
        $rel = substr($cur->getPathname(), strlen($root) + 1);
        return !in_array($rel, ['_source/node_modules', 'storage/tmp', 'storage/backups'], true);
    }));
    $n = 0;
    foreach ($it as $file) {
        if (++$n > 60000) {
            break;
        }
        $rel = substr($file->getPathname(), strlen($root) + 1);
        $name = $file->getFilename();
        if (preg_match('/\.(php[0-9]?|phtml|phar|pht|phps|inc|cgi|pl|py|sh|asp|aspx|jsp)$/i', $name) && !isset($known[$rel]) && !in_array($rel, ['api/config.php'], true) && !str_starts_with($rel, '_source/')) {
            $unexpected[] = $rel;
        } elseif (str_starts_with($rel, 'storage/files/') && preg_match('/\.(php[0-9]?|phtml|phar|htaccess|html?|svg|js)$/i', $name) && $name !== '.htaccess') {
            $unexpected[] = $rel;
        }
    }
    $res = ['at' => now(), 'version' => (string) ($man['version'] ?? ''), 'build' => (string) ($man['build'] ?? ''), 'checked' => count($sha), 'changed' => $changed, 'missing' => $missing, 'edited' => $edited, 'unexpected' => array_slice($unexpected, 0, 200), 'ok' => !$changed && !$missing && !$unexpected];
    $prev = secKv('integrity');
    secKvSet('integrity', $res);
    if (!$res['ok'] && (!is_array($prev) || ($prev['changed'] ?? []) !== $changed || ($prev['unexpected'] ?? []) !== $res['unexpected'])) {
        audit('system', 'File integrity problem', 'files', ['changed' => array_slice($changed, 0, 20), 'missing' => array_slice($missing, 0, 20), 'unexpected' => array_slice($unexpected, 0, 20)]);
    }
    return $res;
}
/** After reviewing the edited files: their current state becomes the reference. */
function monIntegrityAccept(): void
{
    $root = monRoot();
    $now = [];
    foreach (['api/config.php', 'js/config.js', 'api/.user.ini', '.user.ini'] as $rel) {
        $f = $root . '/' . $rel;
        $now[$rel] = is_file($f) ? hash_file('sha256', $f) : '';
    }
    secKvSet('integrity_base', $now);
}

/* ---------- the security self-check ---------- */
function monHttp(string $url, bool $head = false, int $timeout = 8, bool $cert = false): array
{
    $ch = curl_init($url);
    $hdrs = [];
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_NOBODY => $head,
        CURLOPT_USERAGENT => 'StratEdge-security-check',
        CURLOPT_CERTINFO => $cert,
        CURLOPT_HEADERFUNCTION => function ($c, $line) use (&$hdrs) {
            $p = strpos($line, ':');
            if ($p !== false) {
                $hdrs[strtolower(trim(substr($line, 0, $p)))] = trim(substr($line, $p + 1));
            }
            return strlen($line);
        },
    ]);
    $body = curl_exec($ch);
    $info = curl_getinfo($ch);
    $err = curl_error($ch);
    curl_close($ch);
    return ['code' => (int) ($info['http_code'] ?? 0), 'h' => $hdrs, 'body' => is_string($body) ? substr($body, 0, 200000) : '', 'err' => $err, 'cert' => $info['certinfo'] ?? []];
}
function monCheck(string $k, string $area, string $st, string $t, string $detail = '', string $fix = ''): array
{
    return ['k' => $k, 'area' => $area, 'st' => $st, 't' => $t, 'd' => $detail, 'fix' => $fix];
}
/** Runs every check against the site at $base (its public address, or the address it was opened at). */
function monScan(string $base): array
{
    $base = rtrim($base, '/') . '/';
    $out = [];
    $https = str_starts_with($base, 'https://');
    $host = (string) parse_url($base, PHP_URL_HOST);
    $home = monHttp($base);
    $reach = $home['code'] > 0;
    // --- transport ---
    $out[] = $https ? monCheck('https', 'Network', 'ok', 'The site address uses HTTPS', $base) : monCheck('https', 'Network', 'fail', 'The site address does not use HTTPS', $base, 'Install an SSL certificate (cPanel > SSL/TLS Status > Run AutoSSL) and set site_url in api/config.php to the https:// address.');
    if ($https) {
        $plain = monHttp('http://' . $host . '/', true);
        $loc = (string) ($plain['h']['location'] ?? '');
        $out[] = in_array($plain['code'], [301, 302, 307, 308], true) && str_starts_with($loc, 'https://')
            ? monCheck('redirect', 'Network', 'ok', 'Plain http:// addresses are sent to https://')
            : monCheck('redirect', 'Network', 'warn', 'Plain http:// addresses are not sent to https://', 'Answer: HTTP ' . $plain['code'], 'Upload the .htaccess from this version (it adds the HTTPS-only rule).');
        $cert = monHttp($base, true, 8, true);
        $exp = null;
        foreach ((array) $cert['cert'] as $c) {
            if (isset($c['Expire date'])) {
                $exp = strtotime((string) $c['Expire date']) ?: null;
                break;
            }
        }
        if ($exp) {
            $days = (int) floor(($exp - time()) / 86400);
            $out[] = $days > 21 ? monCheck('cert', 'Network', 'ok', 'The SSL certificate is valid for ' . $days . ' more days') : monCheck('cert', 'Network', $days > 7 ? 'warn' : 'fail', 'The SSL certificate expires in ' . $days . ' days', gmdate('j M Y', $exp), 'cPanel > SSL/TLS Status > Run AutoSSL, or renew the certificate with your host.');
        }
        $hsts = (string) ($home['h']['strict-transport-security'] ?? '');
        $out[] = $hsts !== '' ? monCheck('hsts', 'Network', 'ok', 'Browsers are told to use HTTPS only (HSTS)', $hsts) : monCheck('hsts', 'Network', 'warn', 'Browsers are not told to use HTTPS only (HSTS)', '', 'Upload the .htaccess from this version.');
    }
    // v62: behind a proxy that is not trusted, every visitor looks like the proxy: one ban or rate limit would hit everyone
    $edge = clientEdge();
    if ($edge['untrusted'] !== '') {
        $out[] = monCheck('edge', 'Network', 'warn', 'Requests carry a ' . $edge['untrusted'] . ' header from ' . $edge['remote'] . ', which is neither Cloudflare nor a trusted proxy', 'Every visitor is seen as ' . $edge['remote'] . ': a ban or a rate limit would stop everyone, and sign-in locations are wrong.', 'If ' . $edge['remote'] . ' is your own proxy or load balancer, add it under Admin > Security & spam firewall > Trusted proxies. If the site is not behind a proxy of yours, nothing is wrong: the header is ignored.');
    } else {
        $out[] = monCheck('edge', 'Network', 'ok', 'Requests arrive ' . ($edge['via'] === 'cloudflare' ? 'through Cloudflare; visitors\' own addresses are used' : ($edge['via'] === 'proxy' ? 'through a trusted proxy; visitors\' own addresses are used' : 'directly')), $edge['remote']);
    }
    if ($reach) {
        $html = $home['body'];
        $csp = (string) ($home['h']['content-security-policy'] ?? '');
        $meta = (bool) preg_match('/http-equiv="Content-Security-Policy"/i', $html);
        $out[] = $meta || $csp !== '' ? monCheck('csp', 'Web', 'ok', 'The pages carry a Content-Security-Policy (scripts only from this site, no inline scripts)') : monCheck('csp', 'Web', 'warn', 'The pages carry no Content-Security-Policy', '', 'Upload index.html and .htaccess from this version.');
        foreach (['x-content-type-options' => 'No MIME sniffing (X-Content-Type-Options)', 'referrer-policy' => 'A strict referrer policy'] as $h => $t) {
            $out[] = !empty($home['h'][$h]) ? monCheck($h, 'Web', 'ok', $t) : monCheck($h, 'Web', 'warn', $t . ' is missing', '', 'Upload the .htaccess from this version.');
        }
        $frame = !empty($home['h']['x-frame-options']) || str_contains($csp, 'frame-ancestors');
        $out[] = $frame ? monCheck('frame', 'Web', 'ok', 'Other sites cannot frame the pages (clickjacking)') : monCheck('frame', 'Web', 'warn', 'Other sites could frame the pages', '', 'Upload the .htaccess from this version.');
        if (!empty($home['h']['x-powered-by'])) {
            $out[] = monCheck('powered', 'Web', 'warn', 'The server announces its software version', (string) $home['h']['x-powered-by'], 'Upload the .htaccess from this version (it removes the X-Powered-By header).');
        }
        // files that must never download
        $leaks = [];
        foreach (['storage/app.sqlite' => 'the database', 'storage/mail.key' => 'the encryption key', 'api/config.php' => 'the settings file', 'api/manifest.json' => 'the file list', 'README.txt' => 'the setup notes', '_source/build.py' => 'the source folder', 'storage/error.log' => 'the error log', 'storage/files/' => 'the uploads folder listing'] as $p => $what) {
            $r = monHttp($base . $p, false, 6);
            if ($r['code'] === 200 && strlen($r['body']) > 0) {
                $leaks[] = $what . ' (' . $p . ')';
            }
        }
        $out[] = !$leaks ? monCheck('exposure', 'Web', 'ok', 'Private files cannot be downloaded (database, key, settings, logs, source)') : monCheck('exposure', 'Web', 'fail', 'Private files can be downloaded: ' . implode(', ', $leaks), '', 'The host is not applying the .htaccess files. Upload them again (show hidden files in cPanel), or ask the host to allow .htaccess (AllowOverride All).');
        $st = monHttp($base . '.well-known/security.txt');
        $out[] = $st['code'] === 200 && str_contains($st['body'], 'Contact:') ? monCheck('securitytxt', 'Web', 'ok', 'security.txt tells researchers how to report a problem') : monCheck('securitytxt', 'Web', 'warn', 'security.txt is not answering', 'HTTP ' . $st['code'], 'Upload the .htaccess from this version.');
    } else {
        $out[] = monCheck('reach', 'Network', 'warn', 'The site could not be reached from the server itself', $home['err'], 'Some hosts block a server from calling its own address; the web checks are skipped.');
    }
    // --- the server ---
    $ver = PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION;
    $eol = MON_PHP_EOL[$ver] ?? null;
    if ($eol && strtotime($eol) < time()) {
        $out[] = monCheck('php', 'Server', 'fail', 'PHP ' . PHP_VERSION . ' no longer gets security fixes (ended ' . $eol . ')', '', 'cPanel > MultiPHP Manager: switch the domain to PHP 8.3 or newer.');
    } elseif ($eol && strtotime($eol) < time() + 180 * 86400) {
        $out[] = monCheck('php', 'Server', 'warn', 'PHP ' . PHP_VERSION . ' stops getting security fixes on ' . $eol, '', 'Plan the switch to a newer PHP in cPanel > MultiPHP Manager.');
    } else {
        $out[] = monCheck('php', 'Server', 'ok', 'PHP ' . PHP_VERSION . ' receives security fixes' . ($eol ? ' (until ' . $eol . ')' : ''));
    }
    // v35: the scheduled task (the cron job, or the web link for hosts without cron) runs backups, the daily check
    // (file integrity, the audit seal), file encryption, retention and reminders: without it those controls never run
    $cr = secKv('cron_at');
    if (!is_array($cr)) {
        require_once __DIR__ . '/jobs.php';
        $seen = (int) jkvGet('cron_seen', 0);
        $cr = $seen ? ['at' => $seen, 'via' => ''] : null;
    }
    $cronCmd = 'php ' . str_replace('\\', '/', __DIR__) . '/cron.php';
    if (!is_array($cr)) {
        $out[] = monCheck('cron', 'Server', 'fail', 'The scheduled task (cron job) has not run yet', 'Backups, the daily security check (file integrity and the audit seal), file encryption, retention and reminders wait for it.', 'cPanel > Cron Jobs: run "' . $cronCmd . '" every 15 minutes. Admin > Job portals > Sources also shows a web link for hosts without cron.');
    } elseif ((int) $cr['at'] < now() - 3 * 3600000) {
        $out[] = monCheck('cron', 'Server', (int) $cr['at'] < now() - 26 * 3600000 ? 'fail' : 'warn', 'The scheduled task last ran ' . gmdate('j M H:i', (int) ($cr['at'] / 1000)) . ' UTC', 'It should run every 5 to 15 minutes.', 'Check the cron job in cPanel > Cron Jobs: "' . $cronCmd . '".');
    } else {
        $out[] = monCheck('cron', 'Server', 'ok', 'The scheduled task runs (last ' . gmdate('j M H:i', (int) ($cr['at'] / 1000)) . ' UTC' . (($cr['via'] ?? '') === 'web' ? ', through the web link' : '') . ')');
    }
    $out[] = in_array(strtolower((string) ini_get('display_errors')), ['', '0', 'off', 'false', 'stderr'], true) ? monCheck('display', 'Server', 'ok', 'Error details are not shown to visitors') : monCheck('display', 'Server', 'warn', 'PHP shows error details to visitors', '', 'cPanel > MultiPHP INI Editor: display_errors Off.');
    if ((string) ini_get('allow_url_include') === '1') {
        $out[] = monCheck('urlinc', 'Server', 'fail', 'PHP may include code from other web sites (allow_url_include)', '', 'cPanel > MultiPHP INI Editor: allow_url_include Off.');
    }
    $out[] = function_exists('sodium_crypto_box_seal') ? monCheck('sodium', 'Server', 'ok', 'Modern encryption (libsodium) is available for backups') : monCheck('sodium', 'Server', 'fail', 'libsodium is missing, so backups cannot be encrypted', '', 'Ask the host to enable the PHP sodium extension.');
    $free = @disk_free_space(monRoot());
    if ($free !== false) {
        $out[] = $free > 1024 ** 3 ? monCheck('disk', 'Server', 'ok', round($free / 1024 ** 3, 1) . ' GB of disk space free') : monCheck('disk', 'Server', $free > 200 * 1024 ** 2 ? 'warn' : 'fail', 'Only ' . round($free / 1024 ** 2) . ' MB of disk space left', '', 'Delete old backups and unused files (Storage box > Clean up), or ask the host for more space.');
    }
    // --- data protection ---
    $out[] = secKeyFileOk() ? monCheck('keyfile', 'Data', 'ok', 'The encryption key file is in place') : monCheck('keyfile', 'Data', 'fail', 'The encryption key file is missing or unreadable', secKeyPath(), 'Check that the storage folder is writable; restore mail.key from a backup if it was lost.');
    $out[] = !secKeyInsideSite() ? monCheck('keyplace', 'Data', 'ok', 'The encryption key is kept outside the website folder') : monCheck('keyplace', 'Data', 'warn', 'The encryption key is inside the website folder (blocked from the web, but one misconfiguration away)', '', 'Security center > Encryption > Move the key out of the website folder.');
    $fs = secKv('files_seal');
    if (is_array($fs)) {
        $out[] = (int) $fs['plain'] === 0 ? monCheck('filesenc', 'Data', 'ok', 'Every uploaded file is encrypted at rest (' . (int) $fs['total'] . ' files)') : monCheck('filesenc', 'Data', 'warn', (int) $fs['plain'] . ' older uploads are not encrypted yet', 'They are encrypted a batch at a time by the scheduled task.', 'Make sure the cron job runs (Admin > System health), or press "Encrypt now".');
    }
    $bk = secKv('backup_last');
    $bcfg = secKv('backup', []);
    if (empty($bcfg['on'])) {
        $out[] = monCheck('backup', 'Data', 'fail', 'Encrypted backups are not switched on', '', 'Security center > Backups > Set up backups.');
    } elseif (!is_array($bk) || empty($bk['ok']) || (int) $bk['at'] < now() - 48 * 3600000) {
        $out[] = monCheck('backup', 'Data', 'fail', 'No successful backup in the last 48 hours', is_array($bk) ? (string) ($bk['err'] ?? '') : '', 'Check that the cron job runs, then press "Back up now".');
    } else {
        $out[] = monCheck('backup', 'Data', 'ok', 'Last encrypted backup ' . gmdate('j M H:i', (int) ($bk['at'] / 1000)) . ' UTC' . (!empty($bk['offsite']) ? ', with an off-site copy' : ''));
        if (empty($bcfg['s3']['on'])) {
            $out[] = monCheck('offsite', 'Data', 'warn', 'Backups are only kept on this server', '', 'Add an off-site copy (Amazon S3, Backblaze B2, Wasabi) under Security center > Backups.');
        }
    }
    $vf = secKv('backup_verify');
    $out[] = is_array($vf) && !empty($vf['ok']) && (int) $vf['at'] > now() - 120 * 86400000 ? monCheck('restore', 'Data', 'ok', 'A backup was test-restored on ' . gmdate('j M Y', (int) ($vf['at'] / 1000))) : monCheck('restore', 'Data', 'warn', 'No backup was test-restored in the last 4 months', '', 'Security center > Backups > Check a backup (needs the recovery key).');
    // --- people and sign-in ---
    require_once __DIR__ . '/auth.php';
    $rows = db()->query("SELECT * FROM users WHERE status = 'active'")->fetchAll();
    $admins = 0;
    $noMfa = [];
    $stale = [];
    $cfgPw = (string) cfg('admin_password');
    $cfgPwLive = false;
    foreach ($rows as $r) {
        $r['roles'] = rolesOf($r);
        if (in_array('admin', $r['roles'], true)) {
            $admins++;
            if ($cfgPw !== '' && password_verify($cfgPw, (string) $r['pass'])) {
                $cfgPwLive = true;
            }
        }
        if (authMfaRequired($r) && !mfaMethods($r)) {
            $noMfa[] = $r['name'];
        }
        if (sessPrivileged($r)) {
            $lg = docGet('log/' . $r['id']);
            if ((int) ($lg->seen ?? $lg->last->t ?? 0) < now() - 90 * 86400000 && (int) $r['created'] < now() - 90 * 86400000) {
                $stale[] = $r['name'];
            }
        }
    }
    if ($cfgPwLive) {
        $out[] = monCheck('cfgpw', 'People', 'fail', 'An administrator still uses the first-time password written in api/config.php', '', 'Change that administrator\'s password now, then empty admin_password in api/config.php.');
    }
    $due = authMfaDue();
    $out[] = !$noMfa ? monCheck('mfa', 'People', 'ok', 'Everyone who must use two-step sign-in has it set up') : monCheck('mfa', 'People', now() >= $due ? 'fail' : 'warn', count($noMfa) . ' people still need two-step sign-in: ' . implode(', ', array_slice($noMfa, 0, 8)), now() < $due ? 'Required from ' . gmdate('j M Y', (int) ($due / 1000)) . '.' : 'They are asked to set it up at their next sign-in.', 'They set it up under Sign-in & security, or at their next sign-in.');
    $out[] = $admins <= 3 ? monCheck('admins', 'People', 'ok', $admins . ' administrator account' . ($admins === 1 ? '' : 's')) : monCheck('admins', 'People', 'warn', $admins . ' administrator accounts', '', 'Keep administrator access to the few people who need it (least privilege); review under Roles & access.');
    if ($stale) {
        $out[] = monCheck('stale', 'People', 'warn', count($stale) . ' staff accounts unused for 90+ days: ' . implode(', ', array_slice($stale, 0, 8)), '', 'Pause the ones that are no longer needed (Admin > Team), or review them in the next access review.');
    }
    // --- email domain records (inbox placement and spoofing protection) ---
    $from = (string) (cfg('mail_from') ?: '');
    if (str_contains($from, '@')) {
        $dom = strtolower(substr($from, strrpos($from, '@') + 1));
        $spf = '';
        $txt = @dns_get_record($dom, DNS_TXT);
        $any = @dns_get_record($dom, DNS_A + DNS_MX);
        if ($txt === false || ($any === false || $any === [])) {
            $out[] = monCheck('dns', 'Email', 'warn', 'DNS lookups do not work from this server, so SPF and DMARC were not checked', $dom, 'Check them with your DNS provider or an online SPF/DMARC checker.');
            $dom = '';
        }
        foreach ($dom === '' ? [] : (array) $txt as $r) {
            $t = (string) ($r['txt'] ?? '');
            if (stripos($t, 'v=spf1') === 0) {
                $spf = $t;
            }
        }
        if ($dom !== '') {
        $out[] = $spf !== '' ? monCheck('spf', 'Email', str_contains($spf, '+all') ? 'fail' : 'ok', 'SPF names who may send email for ' . $dom, $spf) : monCheck('spf', 'Email', 'warn', 'No SPF record for ' . $dom, '', 'Add the TXT record your email service gives you (e.g. v=spf1 include:mailgun.org include:amazonses.com ~all).');
        $dmarc = '';
        foreach ($dom === '' ? [] : (array) @dns_get_record('_dmarc.' . $dom, DNS_TXT) as $r) {
            $t = (string) ($r['txt'] ?? '');
            if (stripos($t, 'v=DMARC1') === 0) {
                $dmarc = $t;
            }
        }
        $out[] = $dmarc === '' ? monCheck('dmarc', 'Email', 'warn', 'No DMARC record for ' . $dom . ' (others can send email pretending to be you)', '', 'Add TXT _dmarc.' . $dom . ': v=DMARC1; p=none; rua=mailto:' . $from . ' - then move to p=quarantine once reports look clean.') : monCheck('dmarc', 'Email', preg_match('/p=(quarantine|reject)/i', $dmarc) ? 'ok' : 'warn', preg_match('/p=(quarantine|reject)/i', $dmarc) ? 'DMARC protects ' . $dom . ' from spoofing' : 'DMARC is set to monitor only (p=none)', $dmarc, preg_match('/p=(quarantine|reject)/i', $dmarc) ? '' : 'When the reports show only your own services, change p=none to p=quarantine.');
        }
    }
    // --- operations ---
    $fw = function_exists('fwSettings') ? fwSettings() : ['enabled' => true];
    $out[] = !empty($fw['enabled']) ? monCheck('firewall', 'Operations', 'ok', 'The spam and abuse firewall is on') : monCheck('firewall', 'Operations', 'fail', 'The spam and abuse firewall is off', '', 'Admin > Security & spam firewall: switch it on.');
    // v79: the web application firewall (attack signatures, threat scores, bans)
    require_once __DIR__ . '/waf.php';
    $wc = wafCfg();
    if (empty($wc['on'])) {
        $out[] = monCheck('waf', 'Operations', 'warn', 'The web application firewall is off', 'Requests are not read for SQL injection, cross-site scripting and the like before pages handle them.', 'Admin > Web application firewall: switch it on (Balanced is a safe default).');
    } elseif (($wc['mode'] ?? '') === 'watch') {
        $out[] = monCheck('waf', 'Operations', 'warn', 'The web application firewall only watches (it logs attacks but refuses nothing)', '', 'Admin > Web application firewall: switch to Balanced once the log looks right.');
    } else {
        $out[] = monCheck('waf', 'Operations', 'ok', 'The web application firewall is on (' . $wc['mode'] . '): requests are read for attacks before any page handles them' . (!empty($wc['behavior']) ? ', with the behavioral layer' : ''));
    }
    $iv = secKv('integrity');
    if (is_array($iv)) {
        $out[] = !empty($iv['ok']) ? monCheck('integrity', 'Operations', 'ok', 'All ' . (int) $iv['checked'] . ' program files match this version') : monCheck('integrity', 'Operations', $iv['unexpected'] ? 'fail' : 'warn', 'Program files differ from this version', implode(', ', array_slice(array_merge($iv['unexpected'], $iv['changed'], $iv['missing']), 0, 6)), $iv['unexpected'] ? 'Unexpected PHP files can be a break-in: download them for review, delete them, change passwords, and record an incident.' : 'Upload the full zip of this version again.');
    }
    $av = secKv('audit_verify');
    if (is_array($av)) {
        $out[] = !empty($av['ok']) ? monCheck('auditchain', 'Operations', 'ok', 'The audit log is complete and unaltered (' . (int) $av['n'] . ' entries)') : monCheck('auditchain', 'Operations', 'fail', 'The audit log was altered: ' . (string) $av['why'], '', 'Record an incident; the database may have been edited directly.');
    }
    $out[] = monCheck('pdfjs', 'Operations', 'ok', 'The PDF reader runs with scripting and eval switched off (CVE-2024-4367 cannot apply)');
    // --- v35: the second protection layer ---
    require_once __DIR__ . '/guard.php';
    {
        $gc = guardCfg();
        $out[] = monCheck('xsite', 'Protection', 'ok', 'Other web sites cannot send requests through a visitor\'s browser, and the session cookie is locked to this site');
        $out[] = monCheck('stepup', 'Protection', 'ok', 'Sensitive actions ask people to confirm it is them (within ' . (int) $gc['reauthMin'] . ' minutes)');
        $out[] = !empty($gc['pow']) ? monCheck('botcheck', 'Protection', 'ok', 'Public forms carry an invisible bot check' . (!empty($gc['powLogin']) ? ', and so does sign-in under attack' : '')) : monCheck('botcheck', 'Protection', 'warn', 'The bot check on public forms is off', '', 'Security center > Protection: switch on the bot check.');
        $out[] = !empty($gc['dlp']) ? monCheck('dlp', 'Protection', 'ok', 'Unusual downloads and exports alert the security contacts' . (!empty($gc['dlpPause']) ? ' and pause on their own' : '')) : monCheck('dlp', 'Protection', 'warn', 'The data-theft guard is off', '', 'Security center > Protection: switch on the data-theft guard.');
        $out[] = (int) $gc['ddHold'] > 0 ? monCheck('ddhold', 'Protection', 'ok', 'Changed bank accounts wait ' . (int) $gc['ddHold'] . ' days before payroll uses them') : monCheck('ddhold', 'Protection', 'warn', 'Bank account changes take effect at once (payroll diversion)', '', 'Security center > Protection: hold changed bank accounts for 3 days.');
        $avErr = secKv('av_err');
        $avOn = guardAvTarget() !== '';
        $out[] = $avOn && is_array($avErr) && (int) $avErr['at'] > (int) secKv('av_ok', 0) ? monCheck('uploads', 'Protection', 'warn', 'The virus scanner did not answer the last time', (string) $avErr['err'], 'Check the clamav line in api/config.php with your host.') : monCheck('uploads', 'Protection', 'ok', 'Uploads and email attachments are screened (type, macros, programs' . ($avOn ? ', ClamAV' : '') . ')');
    }
    // v79: the assistant's guardrails, once an assistant is configured
    require_once __DIR__ . '/ai.php';
    if (aiReady()) {
        require_once __DIR__ . '/copilot.php';
        $sh = cpShieldCfg();
        $out[] = !empty($sh['on']) ? monCheck('aishield', 'Protection', 'ok', 'StratEdge AI\'s shield reads page text, emails and messages for prompt-injection and blanks secrets before the model sees them') : monCheck('aishield', 'Protection', 'warn', 'The AI shield is off', 'Page text, emails and resumes reach the model unscreened.', 'Admin > Website & messages > Assistant (AI): switch the AI shield on.');
        if (aiReady('copilotAct')) {
            $out[] = monCheck('aiagent', 'Protection', 'ok', 'StratEdge AI can act within each person\'s role; every change is confirmed first and written to the audit log');
        }
    }
    $sum = ['ok' => 0, 'warn' => 0, 'fail' => 0];
    foreach ($out as $c) {
        $sum[$c['st']]++;
    }
    $res = ['at' => now(), 'base' => $base, 'checks' => $out, 'sum' => $sum, 'score' => count($out) ? (int) round(100 * ($sum['ok'] + 0.5 * $sum['warn']) / count($out)) : 0];
    secKvSet('scan', $res);
    return $res;
}
/** Once a day from the cron: integrity, the self-check, audit chain, file encryption progress, retention of logs,
 *  and an email to the security contacts when something needs attention. */
function monDaily(bool $force = false, string $base = ''): array
{
    $last = (int) secKv('mon_daily', 0);
    if (!$force && $last > now() - 20 * 3600000) {
        return ['ran' => false];
    }
    secKvSet('mon_daily', now());
    $iv = monIntegrity();
    $av = auditVerify();
    $scan = monScan($base !== '' ? $base : siteUrl());
    auditPrune(400);
    $bad = array_values(array_filter($scan['checks'], fn($c) => $c['st'] === 'fail'));
    $warn = array_values(array_filter($scan['checks'], fn($c) => $c['st'] === 'warn'));
    $prevKeys = (array) secKv('mon_reported', []);
    $keys = array_map(fn($c) => $c['k'] . ':' . $c['st'], array_merge($bad, $warn));
    $new = array_diff($keys, $prevKeys);
    secKvSet('mon_reported', array_values($keys));
    $monday = (int) gmdate('N') === 1;
    if ($new || ($monday && ($bad || $warn)) || !$iv['ok'] || !$av['ok']) {
        require_once __DIR__ . '/auth.php';
        $lines = [];
        foreach ($bad as $c) {
            $lines[] = 'Needs action: ' . $c['t'] . ($c['fix'] !== '' ? ' - ' . $c['fix'] : '');
        }
        foreach ($warn as $c) {
            $lines[] = 'To improve: ' . $c['t'];
        }
        if (!$iv['ok']) {
            $lines[] = 'Program files differ from the version: ' . implode(', ', array_slice(array_merge($iv['unexpected'], $iv['changed'], $iv['missing']), 0, 8));
        }
        $lines[] = 'Audit log seal: ' . substr((string) $av['head'], 0, 16) . ' (' . (int) $av['n'] . ' entries' . ($av['ok'] ? ', unaltered' : ', ALTERED: ' . $av['why']) . ')';
        secAlertAdmins('daily:' . gmdate('Ymd'), 'Daily security check: ' . count($bad) . ' to fix, ' . count($warn) . ' to improve', implode("\n", $lines));
    }
    return ['ran' => true, 'fail' => count($bad), 'warn' => count($warn), 'integrity' => $iv['ok'], 'audit' => $av['ok']];
}

/* ---------- Security center routes (administrators) ---------- */
function trustRoute(string $r, array $b): never
{
    $me = requireAdmin();
    if (!hasRole($me, 'admin')) {
        fail(403, 'forbidden', 'The Security center is for administrators.');
    }
    require_once __DIR__ . '/backup.php';
    $origin = (sessSecure() ? 'https' : 'http') . '://' . (string) ($_SERVER['HTTP_HOST'] ?? 'localhost') . rtrim(dirname(dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/api/index.php'))), '/') . '/';
    switch ($r) {
        case 'trust_overview':
            require_once __DIR__ . '/auth.php';
            $since = now() - 7 * 86400000;
            $s = secdb()->prepare("SELECT act, COUNT(*) AS n FROM audit_log WHERE kind = 'auth' AND at > ? GROUP BY act");
            $s->execute([$since]);
            $auth = [];
            foreach ($s->fetchAll() as $x) {
                $auth[$x['act']] = (int) $x['n'];
            }
            $al = secdb()->prepare("SELECT seq, at, act, target, detail FROM audit_log WHERE kind = 'alert' ORDER BY seq DESC LIMIT 15");
            $al->execute();
            $csp = (int) secdb()->query('SELECT COALESCE(SUM(n),0) FROM csp_reports WHERE at > ' . (now() - 7 * 86400000))->fetchColumn();
            $act = (int) secdb()->query('SELECT COUNT(*) FROM auth_sessions WHERE out_at = 0 AND seen > ' . (now() - 3600000))->fetchColumn();
            ok([
                'scan' => secKv('scan'),
                'integrity' => secKv('integrity'),
                'files' => secKv('files_seal'),
                'backup' => ['cfg' => array_diff_key(bkCfg(), ['s3' => 1]) + ['s3on' => !empty(bkCfg()['s3']['on'])], 'last' => secKv('backup_last'), 'ok' => secKv('backup_ok'), 'verify' => secKv('backup_verify')],
                'audit' => secKv('audit_verify'),
                'auth7' => $auth,
                'alerts' => $al->fetchAll(),
                'csp7' => $csp,
                'sessionsNow' => $act,
                'key' => ['inside' => secKeyInsideSite(), 'ok' => secKeyFileOk(), 'outsideDir' => secKeyOutsideDir()],
                'origin' => $origin,
                'site' => siteUrl(),
                'daily' => (int) secKv('mon_daily', 0),
            ]);
        case 'trust_scan':
            $base = str($b, 'where', 10) === 'site' ? siteUrl() : $origin;
            ok(monScan($base));
        case 'trust_integrity':
            ok(monIntegrity());
        case 'trust_integrity_accept':
            requireRecentAuth();
            monIntegrityAccept();
            audit('settings', 'Edited files accepted as the reference', 'integrity', [], $me);
            ok(monIntegrity());
        case 'trust_key_move':
            requireRecentAuth();
            [$okMove, $msg] = secKeyMoveOutside();
            audit('settings', $okMove ? 'Encryption key moved outside the website folder' : 'Encryption key move failed', 'key', ['msg' => $msg], $me);
            ok(['ok' => $okMove, 'message' => $msg, 'inside' => secKeyInsideSite()]);
        case 'trust_files_seal':
            ok(fileSealSweep(2000, 25));
        case 'trust_csp':
            if (!empty($b['clear'])) {
                secdb()->exec('DELETE FROM csp_reports');
            }
            ok(['rows' => secdb()->query('SELECT * FROM csp_reports ORDER BY at DESC LIMIT 200')->fetchAll()]);
        /* --- backups --- */
        case 'trust_backup_get':
            $c = bkCfg();
            $s3 = (array) $c['s3'];
            $s3['secret'] = ($s3['secret'] ?? '') !== '' ? '••••••••' : '';
            ok(['cfg' => array_merge($c, ['s3' => $s3]), 'list' => bkList(), 'last' => secKv('backup_last'), 'verify' => secKv('backup_verify'), 'sodium' => function_exists('sodium_crypto_box_seal'), 'zip' => class_exists('ZipArchive')]);
        case 'trust_backup_keygen':
            requireRecentAuth();
            $k = bkKeygen($me);
            ok($k);
        case 'trust_backup_key_saved':
            $c = bkCfg();
            $c['exported'] = true;
            secKvSet('backup', $c);
            ok(['ok' => true]);
        case 'trust_backup_cfg':
            requireRecentAuth();
            $c = bkCfg();
            $in = (array) ($b['cfg'] ?? []);
            $c['keep'] = max(3, min(90, (int) ($in['keep'] ?? $c['keep'])));
            $c['full'] = !empty($in['full']);
            $c['fullKeep'] = max(1, min(12, (int) ($in['fullKeep'] ?? $c['fullKeep'])));
            if (isset($in['s3']) && is_array($in['s3'])) {
                $s = (array) $c['s3'];
                $x = $in['s3'];
                $s['on'] = !empty($x['on']);
                foreach (['endpoint' => 200, 'region' => 40, 'bucket' => 100, 'prefix' => 120, 'akid' => 128] as $k => $max) {
                    if (array_key_exists($k, $x)) {
                        $s[$k] = mb_substr(trim((string) $x[$k]), 0, $max);
                    }
                }
                if (!empty($x['secret']) && $x['secret'] !== '••••••••') {
                    $s['secret'] = secSeal(trim((string) $x['secret']));
                }
                if ($s['endpoint'] !== '' && !preg_match('#^https://#', $s['endpoint'])) {
                    fail(400, 'invalid_argument', 'The storage address must start with https://');
                }
                $c['s3'] = $s;
            }
            secKvSet('backup', $c);
            audit('settings', 'Backup settings changed', 'backups', ['keep' => $c['keep'], 'full' => $c['full'], 's3' => !empty($c['s3']['on'])], $me);
            ok(['ok' => true]);
        case 'trust_backup_s3test':
            $s3 = bkS3(bkCfg());
            if (!$s3) {
                fail(400, 'invalid_argument', 'Fill in and switch on the off-site storage first.');
            }
            $tmp = bkDir() . '/s3test-' . rid(4) . '.txt';
            file_put_contents($tmp, 'StratEdge backup storage test ' . gmdate('c'));
            [$okUp, $msg] = s3Put($s3, rtrim((string) $s3['prefix'], '/') . '/connection-test.txt', $tmp, 'text/plain');
            @unlink($tmp);
            ok(['ok' => $okUp, 'message' => $okUp ? 'The storage accepted a test file (connection-test.txt).' : $msg]);
        case 'trust_backup_run':
            ok(bkRun(!empty($b['full']), 'by ' . $me['name']));
        case 'trust_backup_verify':
            $sk = bkSecretFrom((string) ($b['key'] ?? ''));
            if ($sk === null) {
                fail(400, 'invalid_argument', 'That is not a recovery key (it starts with SEBK-).');
            }
            $res = bkVerify(str($b, 'name', 120), $sk);
            sodium_memzero($sk);
            ok($res);
        case 'trust_backup_restore':
            requireRecentAuth(300);
            if (str($b, 'confirm', 20) !== 'RESTORE') {
                fail(400, 'invalid_argument', 'Type RESTORE to confirm.');
            }
            $sk = bkSecretFrom((string) ($b['key'] ?? ''));
            if ($sk === null) {
                fail(400, 'invalid_argument', 'That is not a recovery key (it starts with SEBK-).');
            }
            $name = str($b, 'name', 120);
            audit('system', 'Restore from backup started', $name, [], $me);
            $res = bkRestore($name, $sk);
            sodium_memzero($sk);
            if ($res['ok']) {
                // the restored database has its own audit chain: the restore is its next entry
                audit('system', 'Restored from backup', $name, ['files' => $res['files'], 'safety' => $res['safety']], $me);
            }
            ok($res);
        case 'trust_backup_download':
            requireRecentAuth();
            $name = basename(str($b, 'name', 120));
            $f = bkDir() . '/' . $name;
            if (!is_file($f) || !str_ends_with($name, '.seb')) {
                fail(404, 'not_found', 'No such backup.');
            }
            audit('data', 'Backup downloaded', $name, [], $me);
            header_remove('Content-Security-Policy');
            header('Content-Type: application/octet-stream');
            header('Content-Disposition: attachment; filename="' . $name . '"');
            header('Content-Length: ' . filesize($f));
            readfile($f);
            exit();
    }
    fail(404, 'not_found', 'Unknown action.');
}
