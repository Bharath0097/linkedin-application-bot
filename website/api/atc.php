<?php
declare(strict_types=1);
/*
 * v80: the easy way to connect Ceipal and Oorwin (Recruiting & sales > Ceipal & Oorwin).
 *
 * One card per provider: paste the credentials, press Test, press "Pull now". A pull brings the provider's open jobs
 * into the Requirements desk (vms/req) and its candidates into the Consultant database (rec/cand), skipping anything
 * already imported. A schedule can run the pull by itself from the cron job.
 *
 *   - Ceipal: the account email, the API key and the password. The server signs in at createAuthtoken/ (the token is
 *     cached and refreshed on its own) and reads getJobPostingsList/ and getApplicantsList/.
 *   - Oorwin: an API key (sent as a header you can name). The jobs and candidates list endpoints are read.
 *
 * Every provider's base address and the four endpoint paths have sensible defaults but are editable (Advanced), so a
 * company whose account uses different paths just adjusts them - no code change. Credentials are sealed on the server
 * (AES-256-GCM, like every other secret) and never sent back to the browser. Outbound calls are HTTPS to the public
 * internet only (no private addresses), and the fields the providers return are matched to our own with the same
 * mapper the other connectors use (api/connectors.php). Nothing here touches Dice or iLabor360.
 */
require_once __DIR__ . '/connectors.php'; // cxMap / cxAutoMap / cxUrlProblem / cxGet / cxItems
require_once __DIR__ . '/vms.php';        // vmsReqSave / vmsReqFields

const ATC_CFG = 'sec/x/atc/cfg';
const ATC_PROVS = ['ceipal' => 'Ceipal', 'oorwin' => 'Oorwin'];
// the defaults a company can override under Advanced
const ATC_DEFAULTS = [
    'ceipal' => [
        'base' => 'https://api.ceipal.com/v1',
        'tokenPath' => 'createAuthtoken/',
        'jobsPath' => 'getJobPostingsList/',
        'candsPath' => 'getApplicantsList/',
    ],
    'oorwin' => [
        'base' => 'https://api.oorwin.com',
        'jobsPath' => 'api/v1/jobs',
        'candsPath' => 'api/v1/candidates',
        'keyHeader' => 'Authorization',
        'keyPrefix' => 'Bearer ',
    ],
];

/* ---------------- settings ---------------- */
function atcCfgRaw(): array
{
    $d = docGet(ATC_CFG);
    return $d ? json_decode(json_encode($d), true) : [];
}
/** The settings for one provider; with $secrets the sealed values are opened (server side only). */
function atcCfg(string $prov, bool $secrets = false): array
{
    $all = atcCfgRaw();
    $c = (array) ($all[$prov] ?? []);
    $def = ATC_DEFAULTS[$prov];
    $out = [
        'on' => !empty($c['on']),
        'base' => (string) ($c['base'] ?? $def['base']),
        'jobsPath' => (string) ($c['jobsPath'] ?? $def['jobsPath']),
        'candsPath' => (string) ($c['candsPath'] ?? $def['candsPath']),
        'jobs' => !isset($c['jobs']) || !empty($c['jobs']),   // import jobs
        'cands' => !isset($c['cands']) || !empty($c['cands']), // import candidates
        'sched' => max(0, min(48, (int) ($c['sched'] ?? 0))),  // hours between automatic pulls (0 = off)
        'pages' => max(1, min(20, (int) ($c['pages'] ?? 3))),  // pages read per list
        'size' => max(1, min(200, (int) ($c['size'] ?? 50))),  // records per page
        'at' => (int) ($c['at'] ?? 0),
        'by' => (string) ($c['by'] ?? ''),
        'last' => (array) ($c['last'] ?? []),
    ];
    if ($prov === 'ceipal') {
        $out['tokenPath'] = (string) ($c['tokenPath'] ?? $def['tokenPath']);
        $out['email'] = (string) ($c['email'] ?? '');
        $out['hasKey'] = ($c['apiKey'] ?? '') !== '';
        $out['hasPassword'] = ($c['password'] ?? '') !== '';
    } else {
        $out['keyHeader'] = (string) ($c['keyHeader'] ?? $def['keyHeader']);
        $out['keyPrefix'] = (string) ($c['keyPrefix'] ?? $def['keyPrefix']);
        $out['hasKey'] = ($c['apiKey'] ?? '') !== '';
    }
    if ($secrets) {
        require_once __DIR__ . '/mail.php';
        $out['apiKey'] = ($c['apiKey'] ?? '') !== '' ? (string) mailUnseal((string) $c['apiKey']) : '';
        $out['password'] = ($c['password'] ?? '') !== '' ? (string) mailUnseal((string) $c['password']) : '';
    }
    return $out;
}
function atcReady(string $prov): bool
{
    $c = atcCfg($prov);
    return $prov === 'ceipal'
        ? ($c['email'] !== '' && $c['hasKey'] && $c['hasPassword'])
        : $c['hasKey'];
}

/* ---------------- HTTP (HTTPS to the public internet only) ---------------- */
function atcHttp(string $method, string $url, array $headers, ?string $body, int $timeout = 30): array
{
    $why = cxUrlProblem($url);
    if ($why !== '') {
        return [0, '', $why];
    }
    $buf = '';
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_USERAGENT => 'StratEdge-portal/80 ats-connect',
        CURLOPT_WRITEFUNCTION => function ($c, $x) use (&$buf) {
            if (strlen($buf) > 8 * 1048576) {
                return 0;
            }
            $buf .= $x;
            return strlen($x);
        },
    ]);
    if ($body !== null && !in_array($method, ['GET'], true)) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
    curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_errno($ch) ? curl_error($ch) : '';
    curl_close($ch);
    return [$code, $buf, $err];
}
function atcUrl(string $base, string $path): string
{
    return preg_match('#^https?://#i', $path) ? $path : rtrim($base, '/') . '/' . ltrim($path, '/');
}
/** Pulls the token from any of the common shapes a JSON answer uses. */
function atcTokenIn($j): string
{
    if (!is_array($j)) {
        return '';
    }
    foreach (['access_token', 'accessToken', 'token', 'authtoken', 'auth_token', 'jwt'] as $k) {
        if (isset($j[$k]) && is_string($j[$k]) && $j[$k] !== '') {
            return $j[$k];
        }
    }
    foreach (['data', 'result', 'results'] as $k) {
        if (isset($j[$k]) && is_array($j[$k])) {
            $t = atcTokenIn($j[$k]);
            if ($t !== '') {
                return $t;
            }
        }
    }
    return '';
}
/** Ceipal access token (cached, refreshed on its own). Returns [token, error]. */
function atcCeipalToken(array $c, bool $fresh = false): array
{
    $cache = secKv('atc_ceipal_tok');
    $sig = hash('sha256', $c['base'] . '|' . $c['email']);
    if (!$fresh && is_array($cache) && ($cache['for'] ?? '') === $sig && (int) ($cache['exp'] ?? 0) > now() + 60000) {
        require_once __DIR__ . '/mail.php';
        return [(string) mailUnseal((string) $cache['t']), ''];
    }
    $url = atcUrl($c['base'], $c['tokenPath']);
    $body = json_encode(['email' => $c['email'], 'password' => $c['password'], 'api_key' => $c['apiKey']], JSON_UNESCAPED_SLASHES);
    [$code, $resp, $err] = atcHttp('POST', $url, ['Accept: application/json', 'Content-Type: application/json'], $body, 25);
    if ($err !== '') {
        return ['', 'Ceipal could not be reached: ' . $err];
    }
    $j = json_decode($resp, true);
    $tok = atcTokenIn($j);
    if ($code >= 400 || $tok === '') {
        return ['', 'Ceipal sign-in answered ' . $code . ': ' . (cxErrText($resp) ?: 'no access token. Check the email, API key and password.')];
    }
    require_once __DIR__ . '/mail.php';
    $ttl = is_array($j) && (int) ($j['expires_in'] ?? 0) > 0 ? (int) $j['expires_in'] : 280; // Ceipal tokens are short; refresh often
    secKvSet('atc_ceipal_tok', ['t' => mailSeal($tok), 'exp' => now() + $ttl * 1000, 'for' => $sig]);
    return [$tok, ''];
}
/** Authorization headers for a provider; for Ceipal this signs in first. Returns [headers, error]. */
function atcAuthHeaders(string $prov, array $c, bool $fresh = false): array
{
    if ($prov === 'ceipal') {
        [$tok, $err] = atcCeipalToken($c, $fresh);
        if ($tok === '') {
            return [[], $err];
        }
        return [['Authorization: Bearer ' . $tok], ''];
    }
    if ($c['apiKey'] === '') {
        return [[], 'Save the Oorwin API key first.'];
    }
    $name = preg_match('/^[A-Za-z0-9\-_]{1,60}$/', (string) $c['keyHeader']) ? (string) $c['keyHeader'] : 'Authorization';
    return [[$name . ': ' . $c['keyPrefix'] . $c['apiKey']], ''];
}
/** The list of records at a path (one page). Returns [code, rows[], error]. */
function atcList(string $prov, array $c, string $path, int $page, int $size): array
{
    [$auth, $err] = atcAuthHeaders($prov, $c, $page === 1 ? false : false);
    if ($err !== '') {
        return [0, [], $err];
    }
    $sep = str_contains($path, '?') ? '&' : '?';
    // common pagination parameters; a provider that ignores the extras simply returns its first page
    $url = atcUrl($c['base'], $path) . $sep . http_build_query(['page' => $page, 'page_size' => $size, 'per_page' => $size, 'limit' => $size, 'offset' => ($page - 1) * $size]);
    [$code, $resp, $e] = atcHttp('GET', $url, array_merge($auth, ['Accept: application/json']), null, 35);
    // a stale Ceipal token: sign in again once
    if ($prov === 'ceipal' && ($code === 401 || $code === 403)) {
        [$auth2, $err2] = atcAuthHeaders($prov, $c, true);
        if ($err2 === '') {
            [$code, $resp, $e] = atcHttp('GET', $url, array_merge($auth2, ['Accept: application/json']), null, 35);
        }
    }
    if ($e !== '') {
        return [0, [], $e];
    }
    if ($code >= 400) {
        return [$code, [], ucfirst($prov) . ' answered ' . $code . ': ' . (cxErrText($resp) ?: 'check the endpoint path under Advanced')];
    }
    $data = json_decode($resp, true);
    $rows = atcRows($data);
    return [$code, $rows, ''];
}
/** Finds the list of records in whatever shape the answer uses (results / data / rows / a bare array). */
function atcRows($data): array
{
    if (!is_array($data)) {
        return [];
    }
    if (cxIsList($data)) {
        return array_values(array_filter($data, 'is_array'));
    }
    foreach (['results', 'data', 'rows', 'items', 'records', 'jobs', 'jobPostings', 'applicants', 'candidates', 'list', 'response'] as $k) {
        if (isset($data[$k]) && is_array($data[$k])) {
            $v = $data[$k];
            if (cxIsList($v)) {
                return array_values(array_filter($v, 'is_array'));
            }
            // one level deeper (e.g. {data:{results:[...]}})
            foreach (['results', 'data', 'rows', 'items'] as $k2) {
                if (isset($v[$k2]) && is_array($v[$k2]) && cxIsList($v[$k2])) {
                    return array_values(array_filter($v[$k2], 'is_array'));
                }
            }
        }
    }
    return [];
}

/* ---------------- import ---------------- */
function atcSeen(string $prov): array
{
    $d = secKv('atc_seen_' . $prov);
    return is_array($d) ? $d : ['j' => [], 'c' => []];
}
function atcSeenSave(string $prov, array $seen): void
{
    // keep the maps bounded
    foreach (['j', 'c'] as $k) {
        if (count($seen[$k]) > 20000) {
            $seen[$k] = array_slice($seen[$k], -20000, null, true);
        }
    }
    secKvSet('atc_seen_' . $prov, $seen);
}
/** Pulls jobs and candidates for one provider and imports the new ones. Returns a plain summary. */
function atcPull(string $prov, array $u, string $how = 'manual'): array
{
    $c = atcCfg($prov, true);
    if (!atcReady($prov)) {
        return ['error' => ucfirst($prov) . ' is not fully set up yet.'];
    }
    $seen = atcSeen($prov);
    $out = ['jobs' => ['added' => 0, 'skipped' => 0, 'read' => 0], 'cands' => ['added' => 0, 'skipped' => 0, 'read' => 0], 'errors' => []];
    // --- jobs -> Requirements desk ---
    if ($c['jobs'] && $c['jobsPath'] !== '') {
        for ($page = 1; $page <= $c['pages']; $page++) {
            [$code, $rows, $err] = atcList($prov, $c, $c['jobsPath'], $page, $c['size']);
            if ($err !== '') {
                $out['errors'][] = 'Jobs: ' . $err;
                break;
            }
            if (!$rows) {
                break;
            }
            $out['jobs']['read'] += count($rows);
            foreach ($rows as $row) {
                $m = cxMap($row, [], 'reqs');
                $xid = (string) ($m['id'] ?? '');
                $key = $xid !== '' ? $xid : substr(hash('sha256', ($m['title'] ?? '') . '|' . ($m['client'] ?? '') . '|' . ($m['loc'] ?? '')), 0, 24);
                if (($m['title'] ?? '') === '') {
                    $out['jobs']['skipped']++;
                    continue;
                }
                if (isset($seen['j'][$key])) {
                    $out['jobs']['skipped']++;
                    continue;
                }
                $fields = vmsReqFields([
                    'ti' => $m['title'] ?? '', 'cl' => $m['client'] ?? '', 'ec' => $m['client'] ?? '', 'vn' => ATC_PROVS[$prov],
                    'loc' => ($m['loc'] ?? '') !== '' ? $m['loc'] : trim(implode(', ', array_filter([$m['city'] ?? '', $m['state'] ?? '']))),
                    'md' => $m['md'] ?? '', 'ty' => $m['ty'] ?? '', 'rate' => $m['rate'] ?? '', 'dur' => $m['dur'] ?? '',
                    'n' => (int) preg_replace('/\D+/', '', (string) ($m['n'] ?? '1')) ?: 1,
                    'sd' => preg_match('/\d{4}-\d{2}-\d{2}/', (string) ($m['sd'] ?? ''), $sm) ? $sm[0] : '',
                    'sk' => $m['skills'] ?? '', 'visa' => $m['visa'] ?? '', 'd' => $m['desc'] ?? '',
                    'cn' => $m['manager'] ?? '',
                ]);
                vmsReqSave($fields, ATC_PROVS[$prov], ['st' => 'new', 'xid' => $prov . ':' . $key, 'xsrc' => $prov]);
                $seen['j'][$key] = now();
                $out['jobs']['added']++;
            }
            if (count($rows) < $c['size']) {
                break;
            }
        }
    }
    // --- candidates -> Consultant database ---
    if ($c['cands'] && $c['candsPath'] !== '') {
        $have = [];
        foreach (colAll('rec/cand/items') as [$id, $cc]) {
            if (!empty($cc->e)) {
                $have['e:' . strtolower((string) $cc->e)] = true;
            }
            if (!empty($cc->xid)) {
                $have[(string) $cc->xid] = true;
            }
        }
        for ($page = 1; $page <= $c['pages']; $page++) {
            [$code, $rows, $err] = atcList($prov, $c, $c['candsPath'], $page, $c['size']);
            if ($err !== '') {
                $out['errors'][] = 'Candidates: ' . $err;
                break;
            }
            if (!$rows) {
                break;
            }
            $out['cands']['read'] += count($rows);
            foreach ($rows as $row) {
                $m = cxMap($row, [], 'search');
                $name = trim((string) ($m['name'] ?? '')) ?: trim((string) ($m['first'] ?? '') . ' ' . (string) ($m['last'] ?? ''));
                $email = strtolower(trim((string) ($m['email'] ?? '')));
                $xid = $prov . ':' . (string) ($m['id'] ?? ($email ?: substr(hash('sha256', $name . ($m['phone'] ?? '')), 0, 20)));
                if ($name === '') {
                    $out['cands']['skipped']++;
                    continue;
                }
                if (isset($seen['c'][$xid]) || isset($have[$xid]) || ($email !== '' && isset($have['e:' . $email]))) {
                    $out['cands']['skipped']++;
                    continue;
                }
                $exp = preg_match('/(\d+(?:\.\d+)?)/', (string) ($m['exp'] ?? ''), $em) ? (float) $em[1] : 0;
                $id = substr(rid(5), 0, 9) . substr(base_convert((string) time(), 10, 36), -5);
                docSet('rec/cand/items/' . $id, (object) [
                    'n' => mb_substr($name, 0, 120),
                    'e' => filter_var($email, FILTER_VALIDATE_EMAIL) ? $email : '',
                    'ph' => mb_substr((string) ($m['phone'] ?? ''), 0, 40),
                    'ti' => mb_substr((string) ($m['title'] ?? ''), 0, 120),
                    'sk' => mb_substr((string) ($m['skills'] ?? ''), 0, 1000),
                    'loc' => mb_substr(($m['loc'] ?? '') !== '' ? (string) $m['loc'] : trim(implode(', ', array_filter([$m['city'] ?? '', $m['state'] ?? '']))), 0, 120),
                    'auth' => mb_substr((string) ($m['auth'] ?? ''), 0, 40),
                    'exp' => $exp > 0 && $exp < 60 ? (string) round($exp, 1) : '',
                    'li' => preg_match('#^https?://#', (string) ($m['url'] ?? '')) ? (string) $m['url'] : '',
                    'xid' => $xid,
                    'src' => ATC_PROVS[$prov],
                    'st' => 'new',
                    'own' => (string) $u['id'],
                    'ownn' => (string) ($u['name'] ?? ''),
                    'by' => (string) $u['id'],
                    'byn' => (string) ($u['name'] ?? ''),
                    'at' => now(),
                    'u' => now(),
                ]);
                $seen['c'][$xid] = now();
                if ($email !== '') {
                    $have['e:' . $email] = true;
                }
                $out['cands']['added']++;
            }
            if (count($rows) < $c['size']) {
                break;
            }
        }
    }
    atcSeenSave($prov, $seen);
    // remember the last run on the provider's settings
    $all = atcCfgRaw();
    $all[$prov]['last'] = ['at' => now(), 'how' => $how, 'jobs' => $out['jobs']['added'], 'cands' => $out['cands']['added'], 'errors' => $out['errors']];
    docSet(ATC_CFG, json_decode(json_encode($all)));
    if ($out['jobs']['added'] || $out['cands']['added']) {
        audit('data', ATC_PROVS[$prov] . ' import', $prov, ['jobs' => $out['jobs']['added'], 'cands' => $out['cands']['added'], 'how' => $how], $u);
    }
    return $out;
}

/* ---------------- scheduled pulls ---------------- */
function atcCron(): array
{
    $ran = [];
    foreach (array_keys(ATC_PROVS) as $prov) {
        $c = atcCfg($prov);
        if (!$c['on'] || $c['sched'] <= 0 || !atcReady($prov)) {
            continue;
        }
        $lastAt = (int) ($c['last']['at'] ?? 0);
        if ($lastAt > now() - $c['sched'] * 3600000 + 120000) {
            continue;
        }
        $GLOBALS['SE_FAIL_THROWS'] = true;
        try {
            $res = atcPull($prov, ['id' => '', 'name' => ATC_PROVS[$prov] . ' schedule'], 'schedule');
            $ran[$prov] = ['jobs' => $res['jobs']['added'] ?? 0, 'cands' => $res['cands']['added'] ?? 0, 'errors' => $res['errors'] ?? []];
        } catch (Throwable $e) {
            $ran[$prov] = ['error' => mb_substr($e->getMessage(), 0, 160)];
        } finally {
            unset($GLOBALS['SE_FAIL_THROWS']);
        }
    }
    return $ran;
}

/* ---------------- routes ---------------- */
function atcStatus(): array
{
    $out = [];
    foreach (array_keys(ATC_PROVS) as $prov) {
        $out[$prov] = ['n' => ATC_PROVS[$prov], 'cfg' => atcCfg($prov), 'ready' => atcReady($prov)];
    }
    return $out;
}
function atcRoute(string $r, array $b): never
{
    $u = requireUser();
    if (!hasRole($u, 'admin') && !hasRole($u, 'hr')) {
        fail(403, 'forbidden', 'Connecting Ceipal and Oorwin is for administrators and HR.');
    }
    $prov = (string) ($b['prov'] ?? '');
    switch ($r) {
        case 'atc_get':
            ok(['providers' => atcStatus()]);
        case 'atc_save': {
            if (!isset(ATC_PROVS[$prov])) {
                fail(400, 'invalid_argument', 'Unknown provider.');
            }
            if (!hasRole($u, 'admin')) {
                fail(403, 'forbidden', 'Only an administrator can change the connection credentials.');
            }
            require_once __DIR__ . '/mail.php';
            $all = atcCfgRaw();
            $c = (array) ($all[$prov] ?? []);
            $in = (array) ($b['cfg'] ?? []);
            $def = ATC_DEFAULTS[$prov];
            if (!empty($b['clear'])) {
                unset($all[$prov]);
                docSet(ATC_CFG, json_decode(json_encode($all)));
                secKvSet('atc_ceipal_tok', []);
                secKvSet('atc_seen_' . $prov, []);
                audit('settings', ATC_PROVS[$prov] . ' connection removed', $prov, [], $u);
                ok(['providers' => atcStatus()]);
            }
            $base = trim((string) ($in['base'] ?? ($c['base'] ?? $def['base'])));
            if ($base !== '' && ($why = cxUrlProblem($base)) !== '') {
                fail(400, 'invalid_argument', 'Base address: ' . $why);
            }
            $c['base'] = mb_substr($base, 0, 300) ?: $def['base'];
            $c['jobsPath'] = mb_substr(trim((string) ($in['jobsPath'] ?? ($c['jobsPath'] ?? $def['jobsPath']))), 0, 300);
            $c['candsPath'] = mb_substr(trim((string) ($in['candsPath'] ?? ($c['candsPath'] ?? $def['candsPath']))), 0, 300);
            $c['on'] = !empty($in['on']);
            $c['jobs'] = !array_key_exists('jobs', $in) || !empty($in['jobs']);
            $c['cands'] = !array_key_exists('cands', $in) || !empty($in['cands']);
            $c['sched'] = max(0, min(48, (int) ($in['sched'] ?? ($c['sched'] ?? 0))));
            $c['pages'] = max(1, min(20, (int) ($in['pages'] ?? ($c['pages'] ?? 3))));
            $c['size'] = max(1, min(200, (int) ($in['size'] ?? ($c['size'] ?? 50))));
            if ($prov === 'ceipal') {
                $c['tokenPath'] = mb_substr(trim((string) ($in['tokenPath'] ?? ($c['tokenPath'] ?? $def['tokenPath']))), 0, 200);
                if (isset($in['email'])) {
                    $c['email'] = mb_substr(trim((string) $in['email']), 0, 190);
                }
                if (trim((string) ($in['apiKey'] ?? '')) !== '') {
                    $c['apiKey'] = mailSeal(mb_substr(trim((string) $in['apiKey']), 0, 400));
                }
                if (trim((string) ($in['password'] ?? '')) !== '') {
                    $c['password'] = mailSeal(mb_substr(trim((string) $in['password']), 0, 200));
                }
                secKvSet('atc_ceipal_tok', []); // creds changed: drop any cached token
            } else {
                $c['keyHeader'] = preg_match('/^[A-Za-z0-9\-_]{1,60}$/', (string) ($in['keyHeader'] ?? '')) ? (string) $in['keyHeader'] : ($c['keyHeader'] ?? $def['keyHeader']);
                $c['keyPrefix'] = mb_substr((string) ($in['keyPrefix'] ?? ($c['keyPrefix'] ?? $def['keyPrefix'])), 0, 40);
                if (trim((string) ($in['apiKey'] ?? '')) !== '') {
                    $c['apiKey'] = mailSeal(mb_substr(trim((string) $in['apiKey']), 0, 400));
                }
            }
            $c['at'] = now();
            $c['by'] = (string) ($u['name'] ?? '');
            $all[$prov] = $c;
            docSet(ATC_CFG, json_decode(json_encode($all)));
            audit('settings', ATC_PROVS[$prov] . ' connection changed', $prov, ['base' => $c['base'], 'on' => $c['on'], 'sched' => $c['sched']], $u);
            ok(['providers' => atcStatus()]);
        }
        case 'atc_test': {
            if (!isset(ATC_PROVS[$prov])) {
                fail(400, 'invalid_argument', 'Unknown provider.');
            }
            if (throttleHit('atc_test:' . $u['id'], 30, 3600)) {
                fail(429, 'rate_limited', 'That is a lot of tests in an hour. Try again shortly.');
            }
            if (!atcReady($prov)) {
                ok(['ok' => false, 'what' => ucfirst($prov) . ': save the credentials first.']);
            }
            session_write_close();
            @set_time_limit(60);
            $c = atcCfg($prov, true);
            if ($prov === 'ceipal') {
                [$tok, $err] = atcCeipalToken($c, true);
                if ($tok === '') {
                    ok(['ok' => false, 'what' => $err]);
                }
            }
            [$code, $rows, $err] = atcList($prov, $c, $c['jobsPath'], 1, 3);
            if ($err !== '' && $c['candsPath'] !== '') {
                // jobs path might be off for this account; try candidates before giving up
                [$code2, $rows2, $err2] = atcList($prov, $c, $c['candsPath'], 1, 3);
                if ($err2 === '') {
                    ok(['ok' => true, 'what' => ucfirst($prov) . ' connected. Read a sample of ' . count($rows2) . ' candidate record(s). (The jobs endpoint returned: ' . $err . ')']);
                }
                ok(['ok' => false, 'what' => $err]);
            }
            if ($err !== '') {
                ok(['ok' => false, 'what' => $err]);
            }
            ok(['ok' => true, 'what' => ucfirst($prov) . ' connected. Read a sample of ' . count($rows) . ' job record(s). Press "Pull now" to import.']);
        }
        case 'atc_pull': {
            if (!isset(ATC_PROVS[$prov])) {
                fail(400, 'invalid_argument', 'Unknown provider.');
            }
            if (throttleHit('atc_pull:' . $prov, 20, 3600)) {
                fail(429, 'rate_limited', 'That provider was pulled many times this hour. Try again later.');
            }
            session_write_close();
            @set_time_limit(120);
            $res = atcPull($prov, $u, 'manual');
            if (isset($res['error'])) {
                fail(400, 'invalid_argument', $res['error']);
            }
            ok(['result' => $res, 'providers' => atcStatus()]);
        }
    }
    fail(404, 'not_found', 'Unknown action.');
}
