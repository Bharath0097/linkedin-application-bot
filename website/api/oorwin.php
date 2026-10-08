<?php
declare(strict_types=1);
/*
 * v52 Oorwin import (Admin > Portal integrations).
 * Official Oorwin production API: https://api.oorwin.ai/api/v2
 * Login: POST /login with email, password and the client secret supplied by Oorwin.
 * The password and client secret are used only for that request and are never stored here. The returned bearer token
 * is sealed with the portal encryption key. Jobs (/jobs) become Requirements; candidates (/candidates) become ATS
 * candidates. Every import requires and makes an encrypted StratEdge database backup before any local records change.
 */

const OW_BASE = 'https://api.oorwin.ai/api/v2';
const OW_MAX = 2000;

function owCfg(): array
{
    $c = secKv('oorwin', []);
    return is_array($c) ? $c : [];
}
function owSave(array $c): void
{
    secKvSet('oorwin', $c);
}
function owMask(string $s): string
{
    $s = trim($s);
    if ($s === '') return '';
    $p = strpos($s, '@');
    if ($p !== false) {
        $u = substr($s, 0, $p);
        return (strlen($u) <= 2 ? substr($u, 0, 1) . '•' : substr($u, 0, 2) . str_repeat('•', min(7, strlen($u) - 2))) . substr($s, $p);
    }
    return strlen($s) <= 6 ? str_repeat('•', strlen($s)) : substr($s, 0, 3) . '••••••' . substr($s, -2);
}
function owToken(): string
{
    $c = owCfg();
    if (empty($c['token'])) return '';
    try { return secUnseal((string) $c['token']); } catch (Throwable $e) { return ''; }
}
/** One fixed-host Oorwin call. Returns [code, parsed JSON|null, text error]. */
function owHttp(string $path, array $body, string $token = '', string $ctype = 'json'): array
{
    if (!preg_match('#^/[A-Za-z0-9_./-]{1,160}$#', $path)) return [0, null, 'Invalid Oorwin API path.'];
    $url = extUrl(OW_BASE . $path); // v61: the development mock stands in for Oorwin; unchanged on the live site
    $headers = ['Accept: application/json'];
    if ($token !== '') $headers[] = 'Authorization: Bearer ' . $token;
    if ($ctype === 'form') {
        $headers[] = 'Content-Type: application/x-www-form-urlencoded';
        $payload = http_build_query($body);
    } else {
        $headers[] = 'Content-Type: application/json';
        $payload = (string) json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }
    $ch = curl_init($url);
    $buf = '';
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 35,
        CURLOPT_USERAGENT => 'StratEdge-portal/52 Oorwin-import',
        CURLOPT_WRITEFUNCTION => function ($c, $chunk) use (&$buf) {
            if (strlen($buf) > 8 * 1048576) return 0;
            $buf .= $chunk;
            return strlen($chunk);
        },
    ]);
    curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_errno($ch) ? curl_error($ch) : '';
    curl_close($ch);
    $j = json_decode($buf, true);
    if ($err !== '') return [$code, is_array($j) ? $j : null, $err];
    if ($code < 200 || $code >= 300) {
        $msg = '';
        if (is_array($j)) {
            foreach (['message','error','error_message','msg','detail'] as $k) if (isset($j[$k]) && is_scalar($j[$k])) { $msg = trim((string) $j[$k]); break; }
        }
        if ($msg === '') $msg = mb_substr(trim(strip_tags($buf)), 0, 300);
        return [$code, is_array($j) ? $j : null, 'Oorwin answered ' . $code . ($msg !== '' ? ': ' . $msg : '')];
    }
    if (!is_array($j)) return [$code, null, 'Oorwin answered without JSON data.'];
    return [$code, $j, ''];
}
/** Finds a token anywhere in the login response without assuming one wrapper name. */
function owFindToken($x, int $depth = 0): string
{
    if (!is_array($x) || $depth > 4) return '';
    foreach (['access_token','accessToken','token','auth_token','authToken','bearerToken'] as $k) {
        if (isset($x[$k]) && is_scalar($x[$k])) {
            $v = trim((string) $x[$k]);
            if (strlen($v) >= 16) return $v;
        }
    }
    foreach ($x as $v) {
        if (is_array($v)) { $t = owFindToken($v, $depth + 1); if ($t !== '') return $t; }
    }
    return '';
}
function owIsAssoc(array $a): bool
{
    if ($a === []) return false;
    return array_keys($a) !== range(0, count($a) - 1);
}
/** Largest nearby list of object-shaped rows in an API response. */
function owRows($x, int $depth = 0): array
{
    if (!is_array($x) || $depth > 6) return [];
    $best = [];
    if (!owIsAssoc($x)) {
        $obj = array_values(array_filter($x, fn($v) => is_array($v) && owIsAssoc($v)));
        if (count($obj) >= max(1, (int) floor(count($x) * .6))) $best = $obj;
    }
    foreach ($x as $v) {
        if (!is_array($v)) continue;
        $r = owRows($v, $depth + 1);
        if (count($r) > count($best)) $best = $r;
    }
    return $best;
}
function owNormKey(string $k): string
{
    return strtolower((string) preg_replace('/[^a-z0-9]/i', '', $k));
}
/** Flatten useful scalar values, preferring top-level fields when names repeat. */
function owFlat(array $row, int $depth = 0, array &$out = []): array
{
    foreach ($row as $k => $v) {
        $nk = owNormKey((string) $k);
        if (is_scalar($v) || $v === null) {
            if ($nk !== '' && !array_key_exists($nk, $out)) $out[$nk] = trim((string) $v);
        } elseif (is_array($v) && $depth < 3) {
            if (!owIsAssoc($v)) {
                $vals = [];
                foreach ($v as $vv) {
                    if (is_scalar($vv)) $vals[] = trim((string) $vv);
                    elseif (is_array($vv)) foreach (['name','label','value','title','skill'] as $kk) if (isset($vv[$kk]) && is_scalar($vv[$kk])) { $vals[] = trim((string) $vv[$kk]); break; }
                }
                if ($nk !== '' && $vals && !isset($out[$nk])) $out[$nk] = implode(', ', array_filter($vals));
            }
            owFlat($v, $depth + 1, $out);
        }
    }
    return $out;
}
function owPick(array $f, array $keys, int $max = 600): string
{
    foreach ($keys as $k) {
        $nk = owNormKey($k);
        if (isset($f[$nk]) && trim((string) $f[$nk]) !== '') return mb_substr(trim((string) $f[$nk]), 0, $max);
    }
    return '';
}
function owMapJob(array $row): array
{
    $f = []; owFlat($row, 0, $f);
    $city = owPick($f, ['city','jobcity','locationcity'], 100);
    $state = owPick($f, ['state','statecode','jobstate','locationstate'], 60);
    $loc = owPick($f, ['location','joblocation','worklocation','worksite','locationname'], 160);
    if ($loc === '') $loc = trim(implode(', ', array_filter([$city, $state])));
    return [
        'id' => owPick($f, ['id','jobid','job_id','encryptedid','encrypted_id','joborderid','joborder_id','requisitionid','requisition_id'], 240),
        'title' => owPick($f, ['title','jobtitle','job_title','positiontitle','position_title'], 160),
        'desc' => owPick($f, ['jobdescription','job_description','description','details','summary'], 20000),
        'loc' => $loc,
        'client' => owPick($f, ['client','clientname','client_name','customer','customername','accountname','account_name','company','companyname'], 160),
        'skills' => owPick($f, ['skills','skillset','skill_set','requiredskills','required_skills','keyskills','key_skills'], 1000),
        'status' => owPick($f, ['status','jobstatus','job_status','state'], 80),
        'type' => owPick($f, ['employmenttype','employment_type','jobtype','job_type','engagement','engagementtype'], 60),
        'rate' => owPick($f, ['billrate','bill_rate','rate','maxrate','max_rate','salary','payrate'], 60),
        'duration' => owPick($f, ['duration','contractlength','contract_length','term'], 60),
        'openings' => owPick($f, ['openings','positions','numberofpositions','number_of_positions','vacancies','headcount'], 20),
        'start' => owPick($f, ['startdate','start_date','joiningdate','joining_date'], 40),
        'remote' => owPick($f, ['workplacetype','workplace_type','remote','isremote','is_remote','workmode','work_mode'], 40),
        'url' => owPick($f, ['joburl','job_url','url','link','careerurl','career_url'], 400),
    ];
}
function owMapCandidate(array $row): array
{
    $f = []; owFlat($row, 0, $f);
    $first = owPick($f, ['firstname','first_name','givenname','given_name','first'], 60);
    $last = owPick($f, ['lastname','last_name','surname','familyname','family_name','last'], 60);
    $name = owPick($f, ['fullname','full_name','candidatename','candidate_name','name','displayname','display_name'], 120);
    if ($name === '') $name = trim($first . ' ' . $last);
    $city = owPick($f, ['city','currentcity','current_city'], 100);
    $state = owPick($f, ['state','statecode','state_code','region'], 60);
    $loc = owPick($f, ['location','currentlocation','current_location','address'], 120);
    if ($loc === '') $loc = trim(implode(', ', array_filter([$city, $state])));
    return [
        'id' => owPick($f, ['id','candidateid','candidate_id','encryptedid','encrypted_id','profileid','profile_id'], 240),
        'name' => $name,
        'email' => mb_strtolower(owPick($f, ['email','emailid','email_id','emailaddress','email_address','primaryemail','primary_email'], 190)),
        'phone' => owPick($f, ['phone','phonenumber','phone_number','mobile','mobilephone','mobile_phone','cell'], 40),
        'title' => owPick($f, ['title','jobtitle','job_title','currenttitle','current_title','designation','headline'], 120),
        'skills' => owPick($f, ['skills','skillset','skill_set','keyskills','key_skills','primaryskills','primary_skills'], 600),
        'loc' => $loc,
        'exp' => owPick($f, ['yearsofexperience','years_of_experience','experienceyears','experience_years','totalexperience','total_experience','experience'], 40),
        'auth' => owPick($f, ['workauthorization','work_authorization','workauth','work_auth','visa','visastatus','visa_status','citizenship'], 40),
        'linkedin' => owPick($f, ['linkedinurl','linkedin_url','linkedin','profileurl','profile_url'], 300),
    ];
}
/** Reads a resource page-by-page; list parsing is deliberately wrapper-agnostic. */
function owFetch(string $kind, string $token, int $max): array
{
    $path = $kind === 'jobs' ? '/jobs' : '/candidates';
    $limit = min(100, max(20, $max));
    $out = [];
    $seenPages = [];
    $pages = (int) ceil($max / $limit);
    for ($page = 1; $page <= $pages; $page++) {
        $body = ['default_search_filter' => '', 'limit' => $limit, 'order' => 'id', 'page' => $page, 'sort' => 'desc'];
        if ($kind === 'candidates') $body['view_name'] = '';
        [$code, $j, $err] = owHttp($path, $body, $token);
        if ($err !== '') {
            // A few Oorwin deployments accept form-encoded bodies; retry once before failing.
            [$code, $j, $err] = owHttp($path, $body, $token, 'form');
        }
        if ($err !== '') return ['ok' => false, 'err' => $err, 'rows' => $out, 'pages' => $page - 1];
        $rows = owRows($j);
        if (!$rows) break;
        $finger = hash('sha256', json_encode(array_slice($rows, 0, 3)) ?: '');
        if (isset($seenPages[$finger])) break;
        $seenPages[$finger] = true;
        foreach ($rows as $row) {
            $out[] = $kind === 'jobs' ? owMapJob($row) : owMapCandidate($row);
            if (count($out) >= $max) break 2;
        }
        if (count($rows) < $limit) break;
    }
    return ['ok' => true, 'err' => '', 'rows' => $out, 'pages' => count($seenPages)];
}
function owBackupReady(): array
{
    require_once __DIR__ . '/backup.php';
    $c = bkCfg();
    $ready = !empty($c['on']) && !empty($c['pk']) && function_exists('sodium_crypto_box_seal') && class_exists('ZipArchive');
    return ['ready' => $ready, 'fingerprint' => (string) ($c['fp'] ?? ''), 'last' => secKv('backup_last')];
}
function owImportJobs(array $rows, array $u): array
{
    require_once __DIR__ . '/vms.php';
    $res = ['read' => count($rows), 'added' => 0, 'updated' => 0, 'skipped' => 0, 'closed' => 0];
    $known = [];
    foreach (colAll(VMS_REQ) as [$rid, $q]) {
        $xid = (string) ($q->xid ?? '');
        $ref = (string) ($q->vref ?? '');
        if (str_starts_with($xid, 'oorwin:')) $known[$xid] = [(string) $rid, $q];
        if ((string) ($q->vms ?? '') === 'Oorwin' && $ref !== '') $known['oorwin:' . $ref] = [(string) $rid, $q];
    }
    foreach ($rows as $m) {
        $oid = trim((string) ($m['id'] ?? ''));
        $title = trim((string) ($m['title'] ?? ''));
        if ($oid === '' || $title === '') { $res['skipped']++; continue; }
        $xid = 'oorwin:' . $oid;
        $status = strtolower((string) ($m['status'] ?? ''));
        $closed = $status !== '' && preg_match('/\b(closed|filled|cancelled|canceled|inactive|archived|completed)\b/i', $status);
        $mdraw = strtolower((string) ($m['remote'] ?? ''));
        $fields = vmsReqFields([
            'ti' => $title,
            'cl' => (string) ($m['client'] ?? ''), 'ec' => (string) ($m['client'] ?? ''), 'vn' => 'Oorwin',
            'loc' => (string) ($m['loc'] ?? ''),
            'md' => str_contains($mdraw, 'remote') || in_array($mdraw, ['1','true','yes'], true) ? 'Remote' : (str_contains($mdraw, 'hybrid') ? 'Hybrid' : 'Onsite'),
            'ty' => (string) ($m['type'] ?? ''), 'rate' => (string) ($m['rate'] ?? ''), 'dur' => (string) ($m['duration'] ?? ''),
            'n' => (int) preg_replace('/[^0-9]/', '', (string) ($m['openings'] ?? '')) ?: 1,
            'sd' => preg_match('/(\d{4}-\d{2}-\d{2})/', (string) ($m['start'] ?? ''), $dm) ? $dm[1] : '',
            'sk' => (string) ($m['skills'] ?? ''), 'd' => strip_tags((string) ($m['desc'] ?? '')),
        ]);
        if (isset($known[$xid])) {
            [$rid, $q] = $known[$xid];
            $chg = [];
            foreach (['ti','cl','ec','vn','loc','md','ty','rate','dur','n','sd','sk','d'] as $k) {
                $v = $fields[$k] ?? '';
                if (($v !== '' && $v !== 0) && (string) ($q->$k ?? '') !== (string) $v) { $q->$k = $v; $chg[] = $k; }
            }
            $wantSt = $closed ? (str_contains($status, 'fill') ? 'filled' : 'closed') : '';
            if ($wantSt !== '' && (string) ($q->st ?? '') !== $wantSt) { $q->st = $wantSt; $chg[] = 'st'; $res['closed']++; }
            $q->vstatus = mb_substr((string) ($m['status'] ?? ''), 0, 80);
            $q->xid = $xid; $q->vms = 'Oorwin'; $q->u = now();
            if ($chg) {
                $log = (array) ($q->vlog ?? []);
                $log[] = (object) ['t' => now(), 'ev' => 'Updated from Oorwin API'];
                $q->vlog = array_slice($log, -30);
                docSet(VMS_REQ . '/' . $rid, $q);
                $res['updated']++;
            } else $res['skipped']++;
            continue;
        }
        if ($closed) { $res['skipped']++; continue; }
        $extra = ['st' => 'new', 'vms' => 'Oorwin', 'vref' => mb_substr($oid, 0, 40), 'xid' => $xid, 'via' => 'Oorwin API', 'vstatus' => mb_substr((string) ($m['status'] ?? ''), 0, 80)];
        if (preg_match('#^https://#', (string) ($m['url'] ?? ''))) $extra['vurl'] = mb_substr((string) $m['url'], 0, 400);
        $rid = vmsReqSave($fields, 'api', $extra);
        $known[$xid] = [$rid, docGet(VMS_REQ . '/' . $rid)];
        $res['added']++;
    }
    return $res;
}
function owImportCandidates(array $rows, array $u): array
{
    require_once __DIR__ . '/ats.php';
    $res = ['read' => count($rows), 'added' => 0, 'updated' => 0, 'skipped' => 0];
    $known = [];
    foreach (colAll('ats') as [$id, $c]) {
        if ((string) $id === 'x') continue;
        if (!empty($c->xid)) $known[(string) $c->xid] = (string) $id;
        if (!empty($c->e)) $known['email:' . mb_strtolower((string) $c->e)] = (string) $id;
    }
    foreach ($rows as $m) {
        $oid = trim((string) ($m['id'] ?? ''));
        $name = trim((string) ($m['name'] ?? ''));
        $email = mb_strtolower(trim((string) ($m['email'] ?? '')));
        if ($name === '' && $email === '') { $res['skipped']++; continue; }
        $xid = $oid !== '' ? 'oorwin:' . $oid : '';
        $id = $xid !== '' && isset($known[$xid]) ? $known[$xid] : ($email !== '' ? ($known['email:' . $email] ?? '') : '');
        $exp = 0.0;
        if (preg_match('/(\d+(?:\.\d+)?)/', (string) ($m['exp'] ?? ''), $em)) $exp = (float) $em[1];
        $fields = ['n' => $name, 'e' => $email, 'ph' => (string) ($m['phone'] ?? ''), 'ti' => (string) ($m['title'] ?? ''), 'sk' => (string) ($m['skills'] ?? ''), 'loc' => (string) ($m['loc'] ?? ''), 'auth' => (string) ($m['auth'] ?? ''), 'exp' => $exp, 'li' => preg_match('#^https://#', (string) ($m['linkedin'] ?? '')) ? (string) $m['linkedin'] : ''];
        if ($id !== '') {
            $c = docGet('ats/' . $id);
            if (!$c) { unset($known[$xid], $known['email:' . $email]); $id = ''; }
            else {
                $chg = [];
                foreach (['n','e','ph','ti','sk','loc','auth','li'] as $k) {
                    $v = trim((string) ($fields[$k] ?? ''));
                    if ($v !== '' && (string) ($c->$k ?? '') !== $v) { $c->$k = $v; $chg[] = $k; }
                }
                if ($exp > 0 && (float) ($c->exp ?? 0) !== $exp) { $c->exp = $exp; $chg[] = 'exp'; }
                if ($xid !== '' && empty($c->xid)) { $c->xid = $xid; $chg[] = 'xid'; }
                if ((string) ($c->src ?? '') === '') $c->src = 'Oorwin';
                if ($chg) {
                    $log = (array) ($c->log ?? []);
                    $log[] = (object) ['t' => now(), 'who' => (string) $u['name'], 'ev' => 'Updated from Oorwin API'];
                    $c->log = array_slice($log, -80); $c->u = now();
                    docSet('ats/' . $id, $c); $res['updated']++;
                } else $res['skipped']++;
            }
        }
        if ($id === '') {
            $extra = $xid !== '' ? ['xid' => $xid, 'tags' => ['Oorwin']] : ['tags' => ['Oorwin']];
            $id = atsNewCandidate($u, $fields, 'Oorwin', '', 'Imported from Oorwin', $extra);
            $res['added']++;
        }
        if ($xid !== '') $known[$xid] = $id;
        if ($email !== '') $known['email:' . $email] = $id;
    }
    return $res;
}

function owRoute(string $r, array $b): never
{
    $u = requireAdmin();
    if (!hasRole($u, 'admin')) fail(403, 'forbidden', 'Oorwin connections are for administrators.');
    switch ($r) {
        case 'oorwin_get': {
            $c = owCfg(); $bk = owBackupReady();
            ok([
                'connected' => owToken() !== '',
                'email' => owMask((string) ($c['email'] ?? '')),
                'at' => (int) ($c['at'] ?? 0), 'by' => (string) ($c['by'] ?? ''),
                'permissions' => (array) ($c['permissions'] ?? []),
                'last' => secKv('oorwin_last_import'),
                'backup' => $bk,
                'base' => OW_BASE,
                'developer' => 'https://app.oorwin.com/developer.html',
            ]);
        }
        case 'oorwin_login': {
            requireRecentAuth();
            $email = mb_strtolower(trim(str($b, 'email', 190)));
            $password = (string) ($b['password'] ?? '');
            $client = trim((string) ($b['clientSecret'] ?? ''));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL) || $password === '' || $client === '') fail(400, 'invalid_argument', 'Enter the Oorwin email, password and client secret.');
            [$code, $j, $err] = owHttp('/login', ['email' => $email, 'password' => $password, 'client_secret' => $client]);
            if ($err !== '') {
                [$code, $j, $err] = owHttp('/login', ['email' => $email, 'password' => $password, 'client_secret' => $client], '', 'form');
            }
            $token = $err === '' ? owFindToken($j) : '';
            $password = ''; $client = '';
            if ($err !== '' || $token === '') fail(502, 'upstream', $err !== '' ? $err : 'Oorwin accepted the login call but did not return an access token. Check the account/client secret with Oorwin.');
            $perms = ['jobs' => false, 'candidates' => false];
            foreach (['jobs' => '/jobs', 'candidates' => '/candidates'] as $k => $path) {
                $body = ['default_search_filter' => '', 'limit' => 1, 'order' => 'id', 'page' => 1, 'sort' => 'desc'];
                if ($k === 'candidates') $body['view_name'] = '';
                [, , $pe] = owHttp($path, $body, $token);
                if ($pe !== '') [, , $pe] = owHttp($path, $body, $token, 'form');
                $perms[$k] = $pe === '';
            }
            $c = ['email' => $email, 'token' => secSeal($token), 'permissions' => $perms, 'at' => now(), 'by' => (string) $u['name']];
            owSave($c);
            audit('settings', 'Oorwin connected', 'oorwin', ['email' => $email, 'permissions' => $perms], $u);
            ok(['connected' => true, 'email' => owMask($email), 'permissions' => $perms]);
        }
        case 'oorwin_disconnect': {
            requireRecentAuth();
            owSave([]);
            audit('settings', 'Oorwin disconnected', 'oorwin', [], $u);
            ok(['ok' => true]);
        }
        case 'oorwin_import': {
            requireRecentAuth();
            @set_time_limit(900);
            $token = owToken();
            if ($token === '') fail(400, 'invalid_argument', 'Connect Oorwin first.');
            $doJobs = !array_key_exists('jobs', $b) || !empty($b['jobs']);
            $doCandidates = !array_key_exists('candidates', $b) || !empty($b['candidates']);
            if (!$doJobs && !$doCandidates) fail(400, 'invalid_argument', 'Choose jobs, candidates, or both.');
            $max = max(20, min(OW_MAX, (int) ($b['max'] ?? 500)));
            $fetched = [];
            if ($doJobs) {
                $fetched['jobs'] = owFetch('jobs', $token, $max);
                if (!$fetched['jobs']['ok']) fail(502, 'upstream', 'Jobs: ' . $fetched['jobs']['err']);
            }
            if ($doCandidates) {
                $fetched['candidates'] = owFetch('candidates', $token, $max);
                if (!$fetched['candidates']['ok']) fail(502, 'upstream', 'Candidates: ' . $fetched['candidates']['err']);
            }
            // No local write until every selected Oorwin read has succeeded and a recovery backup has been written.
            $bk = owBackupReady();
            if (empty($bk['ready'])) fail(409, 'backup_required', 'Set up encrypted backups in Security center → Backups before importing from Oorwin. The import will not change local data without a recovery backup.');
            require_once __DIR__ . '/backup.php';
            $backup = bkRun(false, 'before Oorwin import by ' . $u['name']);
            if (empty($backup['ok'])) fail(500, 'backup_failed', 'The pre-import backup failed: ' . (string) ($backup['err'] ?? 'unknown error') . '. Nothing was imported.');
            $out = ['at' => now(), 'backup' => ['name' => (string) ($backup['name'] ?? ''), 'size' => (int) ($backup['size'] ?? 0)], 'jobs' => null, 'candidates' => null, 'max' => $max];
            if ($doJobs) $out['jobs'] = owImportJobs($fetched['jobs']['rows'], $u) + ['pages' => $fetched['jobs']['pages']];
            if ($doCandidates) $out['candidates'] = owImportCandidates($fetched['candidates']['rows'], $u) + ['pages' => $fetched['candidates']['pages']];
            secKvSet('oorwin_last_import', $out);
            audit('data', 'Imported from Oorwin', 'oorwin', ['backup' => $out['backup']['name'], 'jobs' => $out['jobs'], 'candidates' => $out['candidates']], $u);
            ok($out);
        }
    }
    fail(404, 'not_found', 'Unknown Oorwin action.');
}
