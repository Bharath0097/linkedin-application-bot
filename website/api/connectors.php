<?php
declare(strict_types=1);
/*
 * v34 live API connections for Dice and iLabor360 (Admin > Sourcing connections).
 *
 * Neither company publishes its API documents; each gives them to its customers. So the connection is configured, not
 * hard-coded: the base address, the sign-in (OAuth 2.0 client credentials, username and password, an API key or a
 * token), and for each operation the method, the path, the request body, where the list sits in the answer (JSON or
 * XML) and which field means what (detected automatically from a test call, adjustable). "Test call" shows exactly
 * what came back, with secrets removed.
 *   - iLabor360: requisitions are pulled onto the Requirements desk (on demand, or every few hours by the cron job);
 *     a requisition already on the desk is updated, and one the VMS shows as closed or filled is closed.
 *   - Dice: candidate search (results imported into Candidates with the source Dice, the profile and resume fetched
 *     when a profile operation is set up), and job posting, updating and closing for the careers jobs.
 * Credentials stay sealed in sec/x/src (as in v33). Every call is logged without bodies in sec/x/cxlog. Calls go to
 * https addresses on the public internet only (never to the server's own network).
 */
const CX_PROVS = ['dice' => 'Dice', 'ilabor' => 'iLabor360'];
const CX_OPS = [
    'ilabor' => ['reqs' => 'Pull requisitions'],
    'dice' => ['search' => 'Candidate search', 'profile' => 'Candidate profile', 'post' => 'Post a job', 'update' => 'Update a job', 'close' => 'Close a job'],
];
const CX_FIELDS = [
    'reqs' => ['id' => 'Requisition ID', 'title' => 'Title', 'desc' => 'Description', 'loc' => 'Location', 'city' => 'City', 'state' => 'State', 'rate' => 'Bill rate', 'ty' => 'Type', 'dur' => 'Duration', 'n' => 'Positions', 'sd' => 'Start date', 'ed' => 'End date', 'client' => 'Client', 'manager' => 'Hiring manager', 'skills' => 'Skills', 'status' => 'Status', 'url' => 'Link', 'due' => 'Submission deadline', 'visa' => 'Work authorization', 'md' => 'Remote / onsite', 'notes' => 'Notes', 'bg' => 'Background check', 'drug' => 'Drug screen', 'shiftStart' => 'Shift start', 'shiftEnd' => 'Shift end'],
    'search' => ['id' => 'Profile ID', 'name' => 'Name', 'first' => 'First name', 'last' => 'Last name', 'email' => 'Email', 'phone' => 'Phone', 'title' => 'Title', 'loc' => 'Location', 'city' => 'City', 'state' => 'State', 'skills' => 'Skills', 'exp' => 'Years of experience', 'auth' => 'Work authorization', 'url' => 'Profile link', 'resume' => 'Resume link', 'updated' => 'Last active'],
    'profile' => ['id' => 'Profile ID', 'name' => 'Name', 'first' => 'First name', 'last' => 'Last name', 'email' => 'Email', 'phone' => 'Phone', 'title' => 'Title', 'loc' => 'Location', 'skills' => 'Skills', 'exp' => 'Years of experience', 'auth' => 'Work authorization', 'url' => 'Profile link', 'resume' => 'Resume link'],
    'post' => ['id' => 'Posting ID', 'url' => 'Posting link'],
    'update' => ['id' => 'Posting ID', 'url' => 'Posting link'],
    'close' => [],
];
// names a field usually has in a VMS or job board answer (compared without case, spaces or punctuation)
const CX_ALIASES = [
    'id' => ['requisitionid', 'reqid', 'requisitionnumber', 'reqnumber', 'jobid', 'profileid', 'candidateid', 'resumeid', 'postingid', 'jobpostingid', 'id', 'uuid', 'number', 'positionid'],
    'title' => ['jobtitle', 'positiontitle', 'requisitiontitle', 'title', 'currenttitle', 'headline', 'desiredtitle', 'position', 'name'],
    'desc' => ['jobdescription', 'description', 'positiondescription', 'details', 'summary', 'body'],
    'loc' => ['location', 'worklocation', 'joblocation', 'worksite', 'currentlocation', 'address', 'locationname'],
    'city' => ['city', 'worksitecity', 'locationcity', 'town'],
    'state' => ['state', 'statecode', 'stateprovince', 'region', 'province'],
    'rate' => ['billrate', 'maxbillrate', 'billratemax', 'rate', 'payrate', 'maxrate', 'budget', 'hourlyrate'],
    'ty' => ['employmenttype', 'jobtype', 'positiontype', 'engagementtype', 'type', 'worktype'],
    'dur' => ['duration', 'assignmentlength', 'contractlength', 'contractduration', 'term'],
    'n' => ['positions', 'numberofpositions', 'numpositions', 'openings', 'quantity', 'headcount', 'positionsrequested'],
    'sd' => ['projectedstartdate', 'startdate', 'targetstartdate', 'start', 'estimatedstartdate'],
    'ed' => ['projectedenddate', 'enddate', 'targetenddate', 'estimatedenddate'],
    'client' => ['clientname', 'client', 'customer', 'customername', 'company', 'companyname', 'department', 'businessunit'],
    'manager' => ['hiringmanager', 'manager', 'hiringmanagername', 'requestor', 'contact'],
    'skills' => ['requiredskills', 'mandatoryskills', 'skills', 'skilllist', 'skillset', 'keywords', 'qualifications', 'tags'],
    'status' => ['requisitionstatus', 'jobstatus', 'status', 'state'],
    'url' => ['profileurl', 'joburl', 'detailsurl', 'postingurl', 'url', 'link', 'href', 'weburl'],
    'due' => ['submissiondeadline', 'duedate', 'closingdate', 'deadline', 'responseduedate'],
    'visa' => ['workauthorization', 'visa', 'citizenship', 'visarequirements'],
    'md' => ['workplacetype', 'remote', 'isremote', 'worksetting', 'workmode', 'telecommute'],
    'notes' => ['notes', 'requisitionnotes', 'comments'],
    'bg' => ['backgroundcheck', 'backgroundrequired', 'requiresbackgroundcheck'],
    'drug' => ['drugscreen', 'drugscreening', 'requiresdrugscreen'],
    'shiftStart' => ['shiftstarttime', 'shiftstart', 'starttime'],
    'shiftEnd' => ['shiftendtime', 'shiftend', 'endtime'],
    'name' => ['fullname', 'candidatename', 'displayname', 'name'],
    'first' => ['firstname', 'givenname', 'first'],
    'last' => ['lastname', 'familyname', 'surname', 'last'],
    'email' => ['email', 'emailaddress', 'primaryemail', 'emails'],
    'phone' => ['phone', 'phonenumber', 'mobile', 'mobilephone', 'cell', 'phones'],
    'exp' => ['yearsofexperience', 'experienceyears', 'totalexperience', 'yearsexperience', 'experience'],
    'auth' => ['workpermit', 'workauthorization', 'workauth', 'authorization', 'visa', 'citizenship'],
    'resume' => ['resumeurl', 'resumelink', 'cvurl', 'resume', 'cv'],
    'updated' => ['lastactive', 'lastactivedate', 'dateupdated', 'updated', 'lastmodified', 'modified', 'updatedat'],
];

/* ---------- settings ---------- */
function cxStore(): array
{
    $d = docGet('sec/x/src');
    $s = $d ? (json_decode(json_encode($d), true) ?: []) : [];
    $GLOBALS['CX_STORE_MAINKEY'] = null;
    // v82: a StratEdge-managed workspace with no recruiting integrations of its own inherits StratEdge's central
    // setup on demand (credentials unsealed with StratEdge's key, see cxCreds). Skipped under scheduled work
    // (SE_WS_FORCE): automated searches and pulls stay on StratEdge's own cron, so a workspace never multiplies
    // API calls against StratEdge's Dice/iLabor accounts.
    if (!$s && empty($GLOBALS['SE_WS_FORCE']) && function_exists('wsSlug') && wsSlug() !== '') {
        $m = wsMainDoc('sec/x/src');
        if (is_array($m) && $m) {
            $s = $m;
            $k = wsMainKey();
            $GLOBALS['CX_STORE_MAINKEY'] = $k !== '' ? $k : null;
        }
    }
    return $s;
}
function cxApi(string $prov): array
{
    $s = cxStore();
    $a = (array) ($s[$prov]['api'] ?? []);
    $ops = [];
    foreach (array_keys(CX_OPS[$prov]) as $op) {
        $o = (array) ($a['ops'][$op] ?? []);
        $ops[$op] = [
            'on' => !empty($o['on']),
            'method' => in_array($o['method'] ?? '', ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], true) ? $o['method'] : (in_array($op, ['post'], true) ? 'POST' : ($op === 'update' ? 'PUT' : ($op === 'close' ? 'DELETE' : 'GET'))),
            'path' => (string) ($o['path'] ?? ''),
            'body' => (string) ($o['body'] ?? ''),
            'ctype' => in_array($o['ctype'] ?? '', ['json', 'form', 'xml'], true) ? $o['ctype'] : 'json',
            'items' => (string) ($o['items'] ?? ''),
            'map' => array_filter(array_map('strval', (array) ($o['map'] ?? [])), fn($v) => $v !== ''),
            'size' => max(1, min(500, (int) ($o['size'] ?? 50))),
            'pages' => max(1, min(50, (int) ($o['pages'] ?? 5))),
        ];
    }
    return [
        'base' => (string) ($a['base'] ?? ''),
        'auth' => in_array($a['auth'] ?? '', ['oauth2', 'basic', 'apikey', 'bearer', 'none'], true) ? $a['auth'] : ($prov === 'dice' ? 'oauth2' : 'basic'),
        'tokenUrl' => (string) ($a['tokenUrl'] ?? ''),
        'scope' => (string) ($a['scope'] ?? ''),
        'clientAuth' => in_array($a['clientAuth'] ?? '', ['basic', 'form', 'json'], true) ? $a['clientAuth'] : 'basic',
        'keyName' => (string) ($a['keyName'] ?? 'x-api-key'),
        'keyIn' => ($a['keyIn'] ?? '') === 'query' ? 'query' : 'header',
        // Some recruiting APIs (including VMS deployments) require Basic/OAuth plus a separate API key.
        // Keep that as an independent switch instead of forcing administrators to choose one auth method or the other.
        'useKey' => !empty($a['useKey']),
        'headers' => (string) ($a['headers'] ?? ''),
        'sched' => max(0, min(48, (int) ($a['sched'] ?? 0))),
        'closeWords' => (string) ($a['closeWords'] ?? 'closed, filled, cancelled, canceled, on hold, inactive'),
        'ops' => $ops,
        // v35.2: what runs by itself (Dice): the candidate search for open requirements every N hours (0: off), the
        // results kept per requirement, the best ones imported, and the postings kept in step with the careers page
        'auto' => [
            'search' => in_array((int) ($a['auto']['search'] ?? 0), [0, 2, 4, 6, 12, 24, 48], true) ? (int) ($a['auto']['search'] ?? 0) : 0,
            'keep' => max(5, min(50, (int) ($a['auto']['keep'] ?? 25))),
            'import' => max(0, min(10, (int) ($a['auto']['import'] ?? 0))),
            'min' => max(30, min(95, (int) ($a['auto']['min'] ?? 70))),
            'jobs' => !empty($a['auto']['jobs']),
            'slots' => max(1, min(200, (int) ($a['auto']['slots'] ?? 10))),
            // v36.1: Dice in Talent search: searched with the same words; the people found saved into the ATS (all,
            // those who fit at least tsMin %, or none); for saved people who fit, the full profile read (at most tsDay a day)
            'tsOn' => !array_key_exists('tsOn', (array) ($a['auto'] ?? [])) || !empty($a['auto']['tsOn']),
            'tsSave' => in_array($a['auto']['tsSave'] ?? '', ['all', 'fit', 'off'], true) ? $a['auto']['tsSave'] : 'all',
            'tsMin' => max(30, min(95, (int) ($a['auto']['tsMin'] ?? 60))),
            'tsProf' => !array_key_exists('tsProf', (array) ($a['auto'] ?? [])) || !empty($a['auto']['tsProf']),
            'tsDay' => max(0, min(500, (int) ($a['auto']['tsDay'] ?? 40))),
        ],
    ];
}
/** The credentials (unsealed, server side only). */
function cxCreds(string $prov): array
{
    require_once __DIR__ . '/mail.php';
    $s = cxStore()[$prov] ?? [];
    // v82: inherited credentials were sealed with StratEdge's key, not this workspace's
    $mk = $GLOBALS['CX_STORE_MAINKEY'] ?? null;
    $un = fn($k) => !empty($s[$k]) ? (string) ($mk ? mailUnsealWith((string) $s[$k], $mk) : mailUnseal((string) $s[$k])) : '';
    return $prov === 'dice'
        ? ['id' => (string) ($s['cid'] ?? ''), 'secret' => $un('secret'), 'user' => (string) ($s['cid'] ?? ''), 'pass' => $un('secret'), 'key' => $un('secret'), 'token' => $un('token'), 'sysid' => '']
        : ['id' => (string) ($s['user'] ?? ''), 'secret' => $un('pass'), 'user' => (string) ($s['user'] ?? ''), 'pass' => $un('pass'), 'key' => $un('key'), 'token' => $un('token'), 'sysid' => (string) ($s['sysid'] ?? '')];
}

/* ---------- the call ---------- */
/** '' when the address may be called; otherwise why not. https on the public internet only (a local test server is
 *  allowed while the portal itself runs on localhost). */
function cxUrlProblem(string $url): string
{
    $p = parse_url($url);
    $host = strtolower((string) ($p['host'] ?? ''));
    $scheme = strtolower((string) ($p['scheme'] ?? ''));
    if ($host === '' || !in_array($scheme, ['https', 'http'], true)) {
        return 'Use a full address starting with https://';
    }
    $here = strtolower((string) preg_replace('/:\d+$/', '', (string) ($_SERVER['HTTP_HOST'] ?? '')));
    // a developer's own computer only (this site on localhost calling localhost, or a workspace's <name>.localhost)
    $devLocal = in_array($here, ['localhost', '127.0.0.1'], true) && (in_array($host, ['localhost', '127.0.0.1'], true) || str_ends_with($host, '.localhost'));
    if ($devLocal) {
        return '';
    }
    if ($scheme !== 'https') {
        return 'The address must start with https:// (the connection carries credentials).';
    }
    $ips = filter_var($host, FILTER_VALIDATE_IP) ? [$host] : (gethostbynamel($host) ?: []);
    if (!$ips) {
        return 'The name ' . $host . ' could not be found.';
    }
    foreach ($ips as $ip) {
        if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            return 'That address points inside a private network, which the portal does not call.';
        }
    }
    return '';
}
/** Provider-specific URL checks. Dice's public employer website can answer 200 HTML, which must never be treated as
 *  an API success. Keep private/customer API hosts configurable; only block the known human-facing Dice hosts. */
function cxProviderUrlProblem(string $prov, string $url): string
{
    $why = cxUrlProblem($url);
    if ($why !== '') {
        return $why;
    }
    if ($prov !== 'dice') {
        return '';
    }
    $p = parse_url($url);
    $host = strtolower((string) ($p['host'] ?? ''));
    $path = strtolower((string) ($p['path'] ?? ''));
    $webHosts = ['dice.com', 'www.dice.com', 'employer.dice.com', 'employers.dice.com'];
    if (in_array($host, $webHosts, true)) {
        return "That is Dice's website (" . $host . "), not a Dice API host. Use the API base address from the Dice integration documents. If Dice set your account up for Job Bot instead of a direct posting API, use the Dice job feed shown in Portal integrations.";
    }
    // A login/support page is never an API operation even when copied as an absolute URL.
    if (str_ends_with($host, '.dice.com') && preg_match('#/(?:employer|employers|login|support)(?:/|$)#', $path)) {
        return 'That Dice address is a login/support web page, not an API endpoint. Use the exact API endpoint from the Dice integration documents.';
    }
    return '';
}
/** v83: the provider's sign-in goes only to the provider's own API address (same scheme, host and port as the base
 *  address or an absolute operation path). A resume link (from an answer, or stored on a record) may point anywhere,
 *  and is then fetched without credentials. */
function cxApiHostOf(array $api, string $url): bool
{
    $origin = function (string $u): string {
        $p = parse_url($u);
        $scheme = strtolower((string) ($p['scheme'] ?? ''));
        $host = strtolower((string) ($p['host'] ?? ''));
        if ($host === '' || !in_array($scheme, ['http', 'https'], true)) {
            return '';
        }
        return $scheme . '://' . $host . ':' . (int) ($p['port'] ?? ($scheme === 'https' ? 443 : 80));
    };
    $want = $origin($url);
    if ($want === '') {
        return false;
    }
    $have = [$origin((string) $api['base'])];
    foreach ($api['ops'] as $o) {
        if (preg_match('#^https?://#i', (string) $o['path'])) {
            $have[] = $origin((string) $o['path']);
        }
    }
    return in_array($want, array_filter($have), true);
}
/** One HTTP request: [code, body, headers, ms, error]. Answers over 8 MB are cut. */
function cxHttp(string $method, string $url, array $headers, ?string $body, int $timeout = 25): array
{
    $why = cxUrlProblem($url);
    if ($why !== '') {
        return [0, '', [], 0, $why];
    }
    $t0 = microtime(true);
    $ch = curl_init($url);
    $hdrs = [];
    $buf = '';
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_USERAGENT => 'StratEdge-portal/34',
        CURLOPT_HEADERFUNCTION => function ($c, $line) use (&$hdrs) {
            $p = strpos($line, ':');
            if ($p !== false) {
                $hdrs[strtolower(trim(substr($line, 0, $p)))] = trim(substr($line, $p + 1));
            }
            return strlen($line);
        },
        CURLOPT_WRITEFUNCTION => function ($c, $chunk) use (&$buf) {
            if (strlen($buf) > 8 * 1048576) {
                return 0;
            }
            $buf .= $chunk;
            return strlen($chunk);
        },
    ]);
    if ($body !== null && !in_array($method, ['GET', 'DELETE'], true)) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    } elseif ($body !== null && $method === 'DELETE' && $body !== '') {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
    curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_errno($ch) && strlen($buf) <= 8 * 1048576 ? curl_error($ch) : '';
    curl_close($ch);
    return [$code, $buf, $hdrs, (int) round((microtime(true) - $t0) * 1000), $err];
}
/** {name} fills a value (escaped for where it sits: the URL, a JSON string, a form); {{name}} puts the raw JSON value
 *  (true, 12, ["a","b"]) for JSON bodies. */
function cxFill(string $tpl, array $vars, string $mode): string
{
    $tpl = (string) preg_replace_callback('/\{\{([a-z_]+)\}\}/', function ($m) use ($vars) {
        return array_key_exists($m[1], $vars) ? json_encode($vars[$m[1]], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) : $m[0];
    }, $tpl);
    return (string) preg_replace_callback('/\{([a-z_]+)\}/', function ($m) use ($vars, $mode) {
        if (!array_key_exists($m[1], $vars)) {
            return $m[0];
        }
        $v = $vars[$m[1]];
        $s = is_bool($v) ? ($v ? 'true' : 'false') : (is_array($v) ? implode(', ', array_map('strval', $v)) : (string) $v);
        if ($mode === 'url') {
            return rawurlencode($s);
        }
        if ($mode === 'json') {
            return substr((string) json_encode($s, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), 1, -1);
        }
        if ($mode === 'xml') {
            return htmlspecialchars($s, ENT_XML1 | ENT_QUOTES);
        }
        return $s;
    }, $tpl);
}
/** Authorization headers and query parameters for a provider; fetches (and caches) an OAuth token when needed. */
function cxAuth(string $prov, array $api, bool $fresh = false): array
{
    $c = cxCreds($prov);
    $h = [];
    $q = [];
    switch ($api['auth']) {
        case 'basic':
            if ($c['user'] === '' && $c['pass'] === '') {
                return [[], [], 'Save the username and password first.'];
            }
            $h[] = 'Authorization: Basic ' . base64_encode($c['user'] . ':' . $c['pass']);
            break;
        case 'apikey':
            if ($c['key'] === '') {
                return [[], [], 'Save the API key first.'];
            }
            if ($api['keyIn'] === 'query') {
                $q[$api['keyName'] ?: 'api_key'] = $c['key'];
            } else {
                $h[] = ($api['keyName'] ?: 'x-api-key') . ': ' . $c['key'];
            }
            break;
        case 'bearer':
            if ($c['token'] === '') {
                return [[], [], 'Save the access token first.'];
            }
            $h[] = 'Authorization: Bearer ' . $c['token'];
            break;
        case 'oauth2':
            [$tok, $err] = cxToken($prov, $api, $c, $fresh);
            if ($tok === '') {
                return [[], [], $err];
            }
            $h[] = 'Authorization: Bearer ' . $tok;
            break;
    }
    // A second API key can accompany Basic/OAuth/Bearer auth. This is intentionally separate from "auth" because
    // several VMS APIs require both credentials on every request.
    $auxKey = !empty($api['useKey']) && $api['auth'] !== 'apikey';
    if ($auxKey) {
        if ($c['key'] === '') {
            return [[], [], 'This connection is set to send an API key too. Save the API key first.'];
        }
        if ($api['keyIn'] === 'query') {
            $q[$api['keyName'] ?: 'api_key'] = $c['key'];
        } else {
            $h[] = ($api['keyName'] ?: 'x-api-key') . ': ' . $c['key'];
        }
    }
    // extra headers, one per line ("Name: value"); {sysid}, {user} and {key} are filled in
    foreach (preg_split('/\R/', $api['headers']) ?: [] as $line) {
        if (preg_match('/^\s*([A-Za-z0-9\-_]{1,60})\s*:\s*(.{1,500})$/', $line, $m)) {
            // Do not send the same API-key header twice when the dedicated switch is on.
            if ($auxKey && $api['keyIn'] === 'header' && strcasecmp($m[1], (string) ($api['keyName'] ?: 'x-api-key')) === 0) {
                continue;
            }
            $h[] = $m[1] . ': ' . cxFill(trim($m[2]), ['sysid' => $c['sysid'], 'user' => $c['user'], 'key' => $c['key']], 'plain');
        }
    }
    return [$h, $q, ''];
}
function cxToken(string $prov, array $api, array $c, bool $fresh): array
{
    if ($api['tokenUrl'] === '') {
        return ['', 'Fill in the token address (OAuth 2.0).'];
    }
    if ($c['id'] === '' || $c['secret'] === '') {
        return ['', 'Save the client ID and secret first.'];
    }
    $cache = secKv('cxtok_' . $prov);
    if (!$fresh && is_array($cache) && (int) ($cache['exp'] ?? 0) > now() + 60000 && ($cache['for'] ?? '') === hash('sha256', $api['tokenUrl'] . '|' . $c['id'])) {
        return [secUnseal((string) $cache['t']), ''];
    }
    $form = ['grant_type' => 'client_credentials'] + ($api['scope'] !== '' ? ['scope' => $api['scope']] : []);
    $hdr = ['Accept: application/json'];
    if ($api['clientAuth'] === 'basic') {
        $hdr[] = 'Authorization: Basic ' . base64_encode(rawurlencode($c['id']) . ':' . rawurlencode($c['secret']));
    } else {
        $form += ['client_id' => $c['id'], 'client_secret' => $c['secret']];
    }
    if ($api['clientAuth'] === 'json') {
        $hdr[] = 'Content-Type: application/json';
        $body = (string) json_encode($form);
    } else {
        $hdr[] = 'Content-Type: application/x-www-form-urlencoded';
        $body = http_build_query($form);
    }
    [$code, $resp, , $ms, $err] = cxHttp('POST', $api['tokenUrl'], $hdr, $body, 20);
    $j = json_decode($resp, true);
    cxLog($prov, 'token', 'POST', $api['tokenUrl'], $code, $ms, 0, $err !== '' ? $err : ($code >= 400 ? cxErrText($resp) : ''));
    if ($err !== '') {
        return ['', $err];
    }
    $tok = is_array($j) ? (string) ($j['access_token'] ?? $j['accessToken'] ?? $j['token'] ?? '') : '';
    if ($code >= 400 || $tok === '') {
        return ['', 'The token address answered ' . $code . ($tok === '' && $code < 400 ? ' without an access_token' : '') . ': ' . (cxErrText($resp) ?: 'no details')];
    }
    $ttl = max(60, (int) ($j['expires_in'] ?? $j['expiresIn'] ?? 3600));
    secKvSet('cxtok_' . $prov, ['t' => secSeal($tok), 'exp' => now() + $ttl * 1000, 'for' => hash('sha256', $api['tokenUrl'] . '|' . $c['id'])]);
    return [$tok, ''];
}
/** A short, readable error from an API answer (JSON message fields, or the first text). */
function cxErrText(string $body): string
{
    $j = json_decode($body, true);
    if (is_array($j)) {
        foreach (['error_description', 'message', 'error', 'detail', 'title', 'errorMessage'] as $k) {
            if (isset($j[$k]) && is_scalar($j[$k])) {
                return mb_substr((string) $j[$k], 0, 200);
            }
        }
    }
    return mb_substr(trim(strip_tags($body)), 0, 200);
}
/** The call log (no bodies, no secrets): newest first, 80 kept. */
function cxLog(string $prov, string $op, string $method, string $url, int $code, int $ms, int $n, string $err): void
{
    $d = docGet('sec/x/cxlog');
    $rows = $d ? (array) ($d->rows ?? []) : [];
    array_unshift($rows, (object) ['at' => now(), 'prov' => $prov, 'op' => $op, 'm' => $method, 'path' => mb_substr((string) (parse_url($url, PHP_URL_PATH) ?: ''), 0, 160), 'code' => $code, 'ms' => $ms, 'n' => $n, 'err' => mb_substr($err, 0, 240)]);
    docSet('sec/x/cxlog', (object) ['rows' => array_slice($rows, 0, 80)]);
}
/** Runs one operation. $vars fill the path and body. Returns code, ms, parsed data, a cleaned sample and an error. */
function cxCall(string $prov, string $op, array $vars = []): array
{
    $api = cxApi($prov);
    $o = $api['ops'][$op];
    if ($api['base'] === '' && !preg_match('#^https?://#', $o['path'])) {
        return ['code' => 0, 'ms' => 0, 'data' => null, 'sample' => '', 'ctype' => '', 'err' => 'Fill in the base address first.'];
    }
    if ($o['path'] === '') {
        return ['code' => 0, 'ms' => 0, 'data' => null, 'sample' => '', 'ctype' => '', 'err' => 'Fill in the path of this operation first.'];
    }
    $c = cxCreds($prov);
    $vars += ['sysid' => $c['sysid'], 'user' => $c['user']];
    $url = preg_match('#^https?://#', $o['path']) ? cxFill($o['path'], $vars, 'url') : rtrim($api['base'], '/') . '/' . ltrim(cxFill($o['path'], $vars, 'url'), '/');
    if (($why = cxProviderUrlProblem($prov, $url)) !== '') {
        cxLog($prov, $op, $o['method'], $url, 0, 0, 0, $why);
        return ['code' => 0, 'ms' => 0, 'data' => null, 'sample' => '', 'ctype' => '', 'err' => $why, 'items' => [], 'hdrs' => [], 'text' => ''];
    }
    $tries = 0;
    do {
        [$h, $q, $aerr] = cxAuth($prov, $api, $tries > 0);
        if ($aerr !== '') {
            return ['code' => 0, 'ms' => 0, 'data' => null, 'sample' => '', 'ctype' => '', 'err' => $aerr];
        }
        $u = $url . ($q ? (str_contains($url, '?') ? '&' : '?') . http_build_query($q) : '');
        $body = null;
        $h[] = 'Accept: application/json, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5';
        if ($o['body'] !== '' && !in_array($o['method'], ['GET'], true)) {
            // a form body is written like a query string (title={title}&city={city}): the values arrive URL-encoded
            $body = cxFill($o['body'], $vars, $o['ctype'] === 'form' ? 'url' : $o['ctype']);
            $h[] = 'Content-Type: ' . ['json' => 'application/json', 'form' => 'application/x-www-form-urlencoded', 'xml' => 'application/xml'][$o['ctype']];
        }
        [$code, $resp, $rh, $ms, $err] = cxHttp($o['method'], $u, $h, $body);
        $tries++;
    } while ($code === 401 && $api['auth'] === 'oauth2' && $tries < 2);
    $ct = strtolower((string) ($rh['content-type'] ?? ''));
    $data = cxParse($resp, $ct);
    $items = in_array($op, ['reqs', 'search'], true) ? cxItems($data, $o['items']) : [];
    // v37.1: a redirect is not an answer (usually a sign-in page or a wrong address). A 303 after a write is the one
    // exception: "created, see the new record over there".
    if ($err === '' && $code >= 300 && $code < 400 && !($code === 303 && in_array($op, ['post', 'update'], true))) {
        $to = (string) ($rh['location'] ?? '');
        $err = 'The API answered ' . $code . ' and pointed to ' . ($to !== '' ? mb_substr(cxRedact($to, $prov), 0, 160) : 'another address') . ' instead of answering. Usually the address or the sign-in of this call is wrong.';
    }
    cxLog($prov, $op, $o['method'], $u, $code, $ms, count($items), $err !== '' ? $err : ($code >= 400 ? cxErrText($resp) : ''));
    // the sample shown by "Test call": secrets and long values removed
    $sample = mb_substr(cxRedact($resp, $prov), 0, 6000);
    $short = trim($resp);
    return [
        'code' => $code, 'ms' => $ms, 'data' => $data, 'sample' => $sample, 'ctype' => $ct,
        'err' => $err !== '' ? $err : ($code >= 400 ? 'The API answered ' . $code . ': ' . (cxErrText($resp) ?: 'no details') : ''),
        'items' => $items,
        // v37.1: what a write answer may carry its new ID in besides the body (Location, X-Job-Id …), secrets removed
        'hdrs' => cxIdHeaders($rh, $prov),
        // a very short answer that is not JSON or XML (some APIs answer a new ID as plain text)
        'text' => $data === null && $short !== '' && strlen($short) <= 300 ? cxRedact($short, $prov) : '',
    ];
}
/** v37.1: the response headers that can name a created record, nothing else (no cookies, no tracing ids). */
function cxIdHeaders(array $rh, string $prov): array
{
    $out = [];
    foreach ($rh as $k => $v) {
        $k = strtolower((string) $k);
        if (in_array($k, ['location', 'content-location'], true) || preg_match('/^x-(dice-)?(job|posting|resource|entity|record|object)-?id$|^x-id$/', $k)) {
            $out[$k] = mb_substr(cxRedact((string) $v, $prov), 0, 300);
        }
    }
    return $out;
}
function cxRedact(string $s, string $prov): string
{
    $c = cxCreds($prov);
    foreach ([$c['secret'], $c['pass'], $c['key'], $c['token']] as $x) {
        if (strlen($x) >= 4) {
            $s = str_replace($x, '••••', $s);
        }
    }
    return (string) preg_replace('/("(?:access_token|refresh_token|password|secret|token)"\s*:\s*")[^"]*"/i', '$1••••"', $s);
}
/** JSON, or XML turned into the same nested arrays; null when neither. */
function cxParse(string $body, string $ctype): ?array
{
    $t = ltrim($body);
    if ($t === '') {
        return null;
    }
    if ($t[0] === '{' || $t[0] === '[') {
        $j = json_decode($t, true);
        return is_array($j) ? $j : null;
    }
    if ($t[0] === '<' || str_contains($ctype, 'xml')) {
        $prev = libxml_use_internal_errors(true);
        $x = simplexml_load_string($t, 'SimpleXMLElement', LIBXML_NONET | LIBXML_NOCDATA);
        libxml_use_internal_errors($prev);
        if ($x === false) {
            return null;
        }
        $j = json_decode((string) json_encode($x), true);
        return is_array($j) ? [$x->getName() => $j] : null;
    }
    return null;
}
/** A value at a dot path ("data.items.0.title"); alternatives with "|". */
function cxGet($data, string $path)
{
    foreach (explode('|', $path) as $alt) {
        $cur = $data;
        $ok = true;
        foreach (explode('.', trim($alt)) as $seg) {
            if ($seg === '') {
                continue;
            }
            if (is_array($cur) && array_key_exists($seg, $cur)) {
                $cur = $cur[$seg];
            } elseif (is_array($cur) && ctype_digit($seg) && array_key_exists((int) $seg, $cur)) {
                $cur = $cur[(int) $seg];
            } else {
                $ok = false;
                break;
            }
        }
        if ($ok && $cur !== null && $cur !== '' && $cur !== []) {
            return $cur;
        }
    }
    return null;
}
function cxIsList($a): bool
{
    return is_array($a) && $a !== [] && array_keys($a) === range(0, count($a) - 1);
}
/** The list of records in an answer: at the configured path, or the first list of objects found (3 levels deep). */
function cxItems(?array $data, string $path): array
{
    if ($data === null) {
        return [];
    }
    if ($path !== '') {
        $v = cxGet($data, $path);
        if (cxIsList($v)) {
            return array_values(array_filter($v, 'is_array'));
        }
        return is_array($v) ? [$v] : [];
    }
    $find = function ($a, int $depth) use (&$find) {
        if (cxIsList($a) && is_array($a[0] ?? null)) {
            return $a;
        }
        if (!is_array($a) || $depth > 3) {
            return null;
        }
        foreach ($a as $v) {
            if (is_array($v)) {
                $r = $find($v, $depth + 1);
                if ($r !== null) {
                    return $r;
                }
            }
        }
        return null;
    };
    $r = $find($data, 0);
    if ($r !== null) {
        return $r;
    }
    // XML with a single record comes back as an object rather than a list of one (attributes are not records)
    foreach ($data as $v) {
        if (is_array($v)) {
            foreach ($v as $kk => $vv) {
                if (is_array($vv) && !cxIsList($vv) && !str_starts_with((string) $kk, '@')) {
                    return [$vv];
                }
            }
        }
    }
    return [];
}
/** The path in which an items list was found (for the settings, after a test call). */
function cxItemsPath(?array $data): string
{
    $walk = function ($a, string $p, int $d) use (&$walk) {
        if (cxIsList($a) && is_array($a[0] ?? null)) {
            return $p;
        }
        if (!is_array($a) || $d > 3) {
            return null;
        }
        foreach ($a as $k => $v) {
            if (is_array($v) && !str_starts_with((string) $k, '@')) {
                $r = $walk($v, ltrim($p . '.' . $k, '.'), $d + 1);
                if ($r !== null) {
                    return $r;
                }
            }
        }
        return null;
    };
    return (string) ($walk($data, '', 0) ?? '');
}
/** Leaf paths of a record (3 levels), for detection and for the mapping lists. */
function cxPaths(array $item, string $pre = '', int $d = 0): array
{
    $out = [];
    foreach ($item as $k => $v) {
        $p = ltrim($pre . '.' . $k, '.');
        if (is_array($v) && !cxIsList($v) && $d < 2) {
            $out = array_merge($out, cxPaths($v, $p, $d + 1));
        } elseif (is_array($v) && cxIsList($v) && is_array($v[0] ?? null) && $d < 2) {
            $out = array_merge($out, cxPaths($v[0], $p . '.0', $d + 1));
            $out[] = $p;
        } else {
            $out[] = $p;
        }
    }
    return $out;
}
/** Suggested field -> path, from the names in the first records. */
function cxAutoMap(array $items, string $kind): array
{
    if (!$items) {
        return [];
    }
    $paths = [];
    foreach (array_slice($items, 0, 5) as $it) {
        foreach (cxPaths($it) as $p) {
            $paths[$p] = true;
        }
    }
    $norm = [];
    foreach (array_keys($paths) as $p) {
        $segs = explode('.', $p);
        $last = end($segs);
        if (ctype_digit((string) $last)) {
            $last = $segs[count($segs) - 2] ?? $last;
        }
        $norm[$p] = strtolower((string) preg_replace('/[^a-z0-9]/i', '', (string) $last));
    }
    $map = [];
    foreach (array_keys(CX_FIELDS[$kind] ?? []) as $f) {
        foreach (CX_ALIASES[$f] ?? [] as $alias) {
            // the shortest path wins (top-level "id" before "client.id")
            $hits = array_keys(array_filter($norm, fn($n) => $n === $alias));
            usort($hits, fn($a, $b) => substr_count($a, '.') <=> substr_count($b, '.'));
            if ($hits && !in_array($hits[0], $map, true)) {
                $map[$f] = $hits[0];
                break;
            }
        }
    }
    return $map;
}
/** A record's values as plain text (lists joined, objects named). */
function cxText($v): string
{
    if ($v === null) {
        return '';
    }
    if (is_bool($v)) {
        return $v ? 'true' : 'false';
    }
    if (is_scalar($v)) {
        return trim((string) $v);
    }
    if (is_array($v)) {
        if (cxIsList($v)) {
            return implode(', ', array_filter(array_map('cxText', $v), fn($s) => $s !== ''));
        }
        foreach (['name', 'value', 'text', 'label', 'title', 'address', 'number', '#text'] as $k) {
            if (isset($v[$k]) && is_scalar($v[$k])) {
                return trim((string) $v[$k]);
            }
        }
        if (isset($v['city']) || isset($v['state'])) {
            return trim(implode(', ', array_filter([cxText($v['city'] ?? null), cxText($v['state'] ?? null)])));
        }
    }
    return '';
}
function cxMap(array $item, array $map, string $kind): array
{
    $auto = $map ? [] : cxAutoMap([$item], $kind);
    $out = [];
    foreach (array_keys(CX_FIELDS[$kind] ?? []) as $f) {
        $p = $map[$f] ?? ($auto[$f] ?? '');
        $out[$f] = $p !== '' ? mb_substr(cxText(cxGet($item, $p)), 0, $f === 'desc' ? 20000 : 600) : '';
    }
    if (($out['name'] ?? '') === '' && (($out['first'] ?? '') !== '' || ($out['last'] ?? '') !== '')) {
        $out['name'] = trim(($out['first'] ?? '') . ' ' . ($out['last'] ?? ''));
    }
    if (($out['loc'] ?? '') === '' && (($out['city'] ?? '') !== '' || ($out['state'] ?? '') !== '')) {
        $out['loc'] = trim(implode(', ', array_filter([$out['city'] ?? '', $out['state'] ?? ''])));
    }
    return $out;
}

const CX_IL_IN = 'vms/ilabor/incoming';

function cxIlaborIncomingRows(): array
{
    $out = [];
    foreach (colAll(CX_IL_IN) as [$id, $x]) {
        $out[] = [
            'id' => (string) $id,
            'ref' => (string) ($x->ref ?? ''),
            'state' => (string) ($x->state ?? 'new'),
            'firstAt' => (int) ($x->firstAt ?? 0),
            'lastAt' => (int) ($x->lastAt ?? 0),
            'importedAt' => (int) ($x->importedAt ?? 0),
            'importedId' => (string) ($x->importedId ?? ''),
            'skippedAt' => (int) ($x->skippedAt ?? 0),
            'm' => isset($x->m) ? json_decode(json_encode($x->m), true) : [],
        ];
    }
    usort($out, fn($a, $b) => ($b['lastAt'] <=> $a['lastAt']) ?: strcmp($a['ref'], $b['ref']));
    return $out;
}
function cxIlaborIncomingPublic(): array
{
    $rows = cxIlaborIncomingRows();
    $counts = ['new' => 0, 'updated' => 0, 'closed' => 0, 'imported' => 0, 'skipped' => 0, 'duplicate' => 0];
    foreach ($rows as $x) {
        $st = $x['state'];
        if (!isset($counts[$st])) $counts[$st] = 0;
        $counts[$st]++;
    }
    return ['rows' => array_slice($rows, 0, 500), 'counts' => $counts, 'pending' => $counts['new'] + $counts['updated']];
}
function cxIlaborFields(array $m): array
{
    $details = trim(implode("\n", array_filter([
        (string) ($m['desc'] ?? ''),
        ($m['notes'] ?? '') !== '' ? 'iLabor notes: ' . $m['notes'] : '',
        ($m['ed'] ?? '') !== '' ? 'Projected end date: ' . $m['ed'] : '',
        ($m['shiftStart'] ?? '') !== '' || ($m['shiftEnd'] ?? '') !== '' ? 'Shift: ' . trim(($m['shiftStart'] ?? '') . ' - ' . ($m['shiftEnd'] ?? ''), ' -') : '',
        ($m['bg'] ?? '') !== '' ? 'Background check: ' . $m['bg'] : '',
        ($m['drug'] ?? '') !== '' ? 'Drug screen: ' . $m['drug'] : '',
    ])));
    return vmsReqFields([
        'ti' => (string) ($m['title'] ?? ''), 'cl' => (string) ($m['client'] ?? ''), 'ec' => (string) ($m['client'] ?? ''),
        'loc' => (string) ($m['loc'] ?? ''),
        'md' => ($m['md'] ?? '') !== '' ? (preg_match('/remote|true|yes|1/i', (string) $m['md']) ? 'Remote' : (preg_match('/hybrid/i', (string) $m['md']) ? 'Hybrid' : 'Onsite')) : (preg_match('/remote/i', ((string) ($m['loc'] ?? '')) . ' ' . ((string) ($m['title'] ?? ''))) ? 'Remote' : 'Onsite'),
        'ty' => (string) ($m['ty'] ?? ''),
        'rate' => ($m['rate'] ?? '') !== '' && is_numeric($m['rate']) ? '$' . $m['rate'] . '/hr' : (string) ($m['rate'] ?? ''),
        'dur' => (string) ($m['dur'] ?? ''), 'n' => (int) ($m['n'] ?? 0) ?: 1,
        'sd' => preg_match('/^(\d{4}-\d{2}-\d{2})/', (string) ($m['sd'] ?? ''), $mm) ? $mm[1] : '',
        'sk' => (string) ($m['skills'] ?? ''), 'visa' => (string) ($m['visa'] ?? ''), 'd' => strip_tags(str_replace(['<br>', '<br/>', '<br />', '</p>', '</li>'], "\n", $details)),
        'cn' => (string) ($m['manager'] ?? ''), 'vn' => 'iLabor360',
    ]);
}
function cxIlaborStage(string $ref, array $m, bool $closed): string
{
    $id = strtolower(preg_replace('/[^A-Za-z0-9_.-]/', '_', $ref));
    if ($id === '') $id = substr(hash('sha256', $ref), 0, 24);
    $old = docGet(CX_IL_IN . '/' . $id);
    $state = $closed ? 'closed' : ($old ? ((string) ($old->state ?? '') === 'skipped' ? 'updated' : ((string) ($old->state ?? '') === 'imported' ? 'duplicate' : 'updated')) : 'new');
    $x = (object) [
        'ref' => $ref, 'state' => $state, 'firstAt' => (int) ($old->firstAt ?? now()), 'lastAt' => now(),
        'm' => (object) $m, 'importedAt' => (int) ($old->importedAt ?? 0), 'importedId' => (string) ($old->importedId ?? ''),
        'skippedAt' => (int) ($old->skippedAt ?? 0),
    ];
    docSet(CX_IL_IN . '/' . $id, $x);
    return $id;
}
function cxIlaborAccept(array $ids, array $u): array
{
    require_once __DIR__ . '/vms.php';
    $known = [];
    foreach (colAll(VMS_REQ) as [$rid, $q]) if ((string) ($q->vms ?? '') === 'iLabor360' && (string) ($q->vref ?? '') !== '') $known[strtoupper((string) $q->vref)] = (string) $rid;
    $done = 0; $dup = 0; $bad = 0;
    foreach (array_slice(array_values(array_unique(array_filter(array_map('strval', $ids)))), 0, 200) as $id) {
        $x = docGet(CX_IL_IN . '/' . $id);
        if (!$x) { $bad++; continue; }
        $m = isset($x->m) ? json_decode(json_encode($x->m), true) : [];
        $ref = strtoupper((string) ($x->ref ?? ($m['id'] ?? '')));
        if ($ref === '' || ($m['title'] ?? '') === '') { $bad++; continue; }
        if (isset($known[$ref])) {
            $x->state = 'duplicate'; $x->importedId = $known[$ref]; $x->lastAt = now(); docSet(CX_IL_IN . '/' . $id, $x); $dup++; continue;
        }
        $fields = cxIlaborFields($m);
        $rid = vmsReqSave($fields, 'api', ['st' => 'new', 'vms' => 'iLabor360', 'vref' => $ref, 'vurl' => preg_match('#^https://#', (string) ($m['url'] ?? '')) ? mb_substr((string) $m['url'], 0, 400) : '', 'vdue' => (string) ($m['due'] ?? ''), 'via' => 'iLabor360 API']);
        $x->state = 'imported'; $x->importedAt = now(); $x->importedId = $rid; $x->lastAt = now(); docSet(CX_IL_IN . '/' . $id, $x);
        $known[$ref] = $rid; $done++;
    }
    if ($done || $dup) audit('data', 'iLabor360 incoming requisitions accepted', 'ilabor', ['imported' => $done, 'duplicates' => $dup], $u);
    return ['imported' => $done, 'duplicates' => $dup, 'invalid' => $bad, 'incoming' => cxIlaborIncomingPublic()];
}

/* ---------- iLabor360: requisitions onto the Requirements desk ---------- */
function cxPull(string $by = 'schedule'): array
{
    require_once __DIR__ . '/vms.php';
    $api = cxApi('ilabor');
    $o = $api['ops']['reqs'];
    if (!$o['on']) {
        return ['ok' => false, 'err' => 'The requisitions operation is switched off.'];
    }
    $last = secKv('cx_ilabor_pull');
    $since = is_array($last) && (int) ($last['okAt'] ?? 0) > 0 ? (int) $last['okAt'] - 86400000 : now() - 30 * 86400000;
    $res = ['ok' => true, 'fetched' => 0, 'added' => 0, 'staged' => 0, 'updated' => 0, 'closed' => 0, 'pages' => 0, 'err' => '', 'at' => now(), 'by' => $by];
    $known = [];
    foreach (colAll(VMS_REQ) as [$rid, $q]) {
        if ((string) ($q->vms ?? '') === 'iLabor360' && (string) ($q->vref ?? '') !== '') {
            $known[strtoupper((string) $q->vref)] = [(string) $rid, $q];
        }
    }
    $closeWords = array_values(array_filter(array_map('trim', explode(',', strtolower($api['closeWords'])))));
    $seen = [];
    for ($page = 1; $page <= $o['pages']; $page++) {
        $r = cxCall('ilabor', 'reqs', ['page' => $page, 'size' => $o['size'], 'offset' => ($page - 1) * $o['size'], 'since' => gmdate('Y-m-d\TH:i:s\Z', (int) ($since / 1000)), 'since_date' => gmdate('Y-m-d', (int) ($since / 1000))]);
        $res['pages'] = $page;
        if ($r['err'] !== '') {
            $res['ok'] = false;
            $res['err'] = $r['err'];
            break;
        }
        $items = $r['items'];
        $newOnPage = 0;
        foreach ($items as $it) {
            $m = cxMap($it, $o['map'], 'reqs');
            $ref = strtoupper(mb_substr($m['id'], 0, 40));
            if ($ref === '' || $m['title'] === '' || isset($seen[$ref])) {
                continue;
            }
            $seen[$ref] = true;
            $newOnPage++;
            $res['fetched']++;
            $status = strtolower($m['status']);
            $closed = $status !== '' && (bool) array_filter($closeWords, fn($w) => $w !== '' && str_contains($status, $w));
            $fields = cxIlaborFields($m);
            if (isset($known[$ref])) {
                [$rid, $q] = $known[$ref];
                $changed = [];
                foreach (['ti', 'loc', 'rate', 'dur', 'n', 'sk', 'd', 'cl'] as $k) {
                    if ($fields[$k] !== '' && $fields[$k] !== 0 && (string) ($q->$k ?? '') !== (string) $fields[$k]) {
                        $q->$k = $fields[$k];
                        $changed[] = $k;
                    }
                }
                if ($closed && !in_array((string) ($q->st ?? ''), ['closed', 'filled', 'dismissed'], true)) {
                    $q->st = preg_match('/fill/', $status) ? 'filled' : 'closed';
                    $changed[] = 'st';
                    $res['closed']++;
                }
                if ($changed) {
                    $log = (array) ($q->vlog ?? []);
                    $log[] = (object) ['t' => now(), 'ev' => 'Updated from the iLabor360 API' . ($closed ? ' (' . $m['status'] . ')' : '')];
                    $q->vlog = array_slice($log, -30);
                    $q->u = now();
                    docSet(VMS_REQ . '/' . $rid, $q);
                    $res['updated']++;
                }
                continue;
            }
            // New requisitions are staged first so recruiters can see, preview and accept them. Closed records
            // that were never imported are retained in the inbox as closed rather than silently disappearing.
            cxIlaborStage($ref, $m, $closed);
            if (!$closed) $res['staged']++;
            if ($closed) $res['closed']++;
        }
        // stop at the last page: fewer records than a page, nothing new, or no paging placeholder in the path or body
        if (count($items) < $o['size'] || $newOnPage === 0 || !preg_match('/\{(page|offset)\}/', $o['path'] . $o['body'])) {
            break;
        }
    }
    if ($res['ok']) {
        $res['okAt'] = now();
    } elseif (is_array($last)) {
        $res['okAt'] = (int) ($last['okAt'] ?? 0);
    }
    secKvSet('cx_ilabor_pull', $res);
    if ($res['staged'] || $res['updated'] || $res['closed']) {
        audit('data', 'Requisitions pulled from iLabor360', 'ilabor', ['staged' => $res['staged'], 'updated' => $res['updated'], 'closed' => $res['closed']]);
    }
    return $res;
}
/** From the cron job: the scheduled pull. */
function cxCron(): array
{
    $api = cxApi('ilabor');
    if ($api['sched'] <= 0 || !$api['ops']['reqs']['on']) {
        return ['ran' => false];
    }
    $last = secKv('cx_ilabor_pull');
    if (is_array($last) && (int) ($last['at'] ?? 0) > now() - $api['sched'] * 3600000 + 120000) {
        return ['ran' => false];
    }
    return cxPull('schedule');
}

/* ---------- Dice: candidates and job postings ---------- */
function cxJobVars(string $jid, stdClass $j): array
{
    $loc = trim((string) ($j->loc ?? ''));
    $city = $loc;
    $state = '';
    $zip = '';
    if (preg_match('/^(.*?),\s*([A-Z]{2})\b(?:\s+(\d{5}))?/', $loc, $m)) {
        $city = trim($m[1]);
        $state = $m[2];
        $zip = $m[3] ?? '';
    }
    $ty = strtolower((string) ($j->ty ?? ''));
    $md = strtolower((string) ($j->md ?? ''));
    $remote = str_contains($md, 'remote') || str_contains(strtolower($loc), 'remote');
    $desc = trim((string) ($j->d ?? ''));
    $skills = array_values(array_filter(array_map('trim', preg_split('/[,;|\n]+/', (string) ($j->sk ?? '')) ?: [])));
    return [
        'job_id' => $jid,
        'posting_id' => (string) ($j->dice->id ?? ''),
        'title' => (string) ($j->ti ?? ''),
        'description' => $desc,
        'description_html' => '<p>' . nl2br(htmlspecialchars($desc, ENT_QUOTES)) . '</p>',
        'location' => $loc,
        'city' => $city,
        'state' => $state,
        'zip' => $zip,
        'country' => 'US',
        'remote' => $remote,
        'workplace' => $remote ? 'Remote' : (str_contains($md, 'hybrid') ? 'Hybrid' : 'Onsite'),
        'type' => (string) ($j->ty ?? ''),
        'type_code' => str_contains($ty, 'full') || str_contains($ty, 'perm') ? 'FULLTIME' : (str_contains($ty, 'part') ? 'PARTTIME' : (str_contains($ty, 'c2c') || str_contains($ty, 'corp') ? 'THIRD_PARTY' : 'CONTRACTS')),
        'skills' => implode(', ', $skills),
        'skills_list' => $skills,
        'rate' => (string) ($j->rate ?? ''),
        'duration' => (string) ($j->dur ?? ''),
        'visa' => (string) ($j->visa ?? ''),
        'apply_url' => siteUrl() . 'job.php?id=' . rawurlencode($jid) . '&src=dice',
        'company' => 'StratEdge IT Consulting',
        'email' => (string) (cfg('mail_from') ?: ''),
        'posted' => gmdate('Y-m-d\TH:i:s\Z', (int) ((($j->at ?? 0) ?: now()) / 1000)),
    ];
}
/** Fetches a resume through the connection's sign-in and attaches it to a candidate; the file id or ''. */
function cxAttachResume(string $prov, string $cid, string $url, string $name): string
{
    if (!preg_match('#^https?://#', $url)) {
        return '';
    }
    $api = cxApi($prov);
    [$h] = cxApiHostOf($api, $url) ? cxAuth($prov, $api) : [[]]; // v83: credentials only to the provider's API host
    [$code, $body, $rh] = cxHttp('GET', $url, $h, null, 30);
    if ($code !== 200 || strlen($body) < 100 || strlen($body) > (int) cfg('max_upload_mb') * 1048576) {
        return '';
    }
    $ct = strtolower((string) ($rh['content-type'] ?? ''));
    $ext = str_contains($ct, 'pdf') || str_starts_with($body, '%PDF') ? 'pdf' : (str_contains($ct, 'word') || str_starts_with($body, "PK\x03\x04") ? 'docx' : (str_contains($ct, 'text') ? 'txt' : ''));
    if ($ext === '') {
        return '';
    }
    $dir = cfg('files_dir');
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    $fid = rid(16);
    if (file_put_contents("$dir/$fid", $body) === false) {
        return '';
    }
    fileSealPath("$dir/$fid");
    $fname = preg_replace('/[^A-Za-z0-9 _\-]/', '', $name) ?: 'resume';
    docSet("ats/$cid/f/$fid", (object) ['n' => mb_substr($fname, 0, 120) . ' (Dice).' . $ext, 'ty' => MIME[$ext] ?? 'application/octet-stream', 'sz' => strlen($body), 'at' => now(), 'c' => 'resume']);
    return $fid;
}

/* ---------- routes (administrators) ---------- */
function cxRoute(string $r, array $b): never
{
    if ($r === 'cx_auto' || $r === 'cx_auto_run') {
        cxRoute2($r, $b);
    }
    $u = requireAdmin();
    if (!hasRole($u, 'admin')) {
        fail(403, 'forbidden', 'Sourcing connections are for administrators.');
    }
    $prov = (string) ($b['prov'] ?? '');
    if ($r !== 'cx_get' && $r !== 'cx_log' && !isset(CX_PROVS[$prov])) {
        fail(400, 'invalid_argument', 'Choose Dice or iLabor360.');
    }
    switch ($r) {
        case 'cx_get':
            $jobs = [];
            foreach (colAll('org/site/jobs') as [$id, $j]) {
                $open = ($j->open ?? true) !== false && trim((string) ($j->ti ?? '')) !== '';
                // v37.1: a job closed here but still live on Dice stays in the list (it may need its ID to be closed there)
                if ($open || (string) ($j->dice->st ?? '') === 'live') {
                    // v37.2: open, but not meant for Dice (internal only, or Dice switched off for it on the job boards desk)
                    require_once __DIR__ . '/sources.php';
                    $off = $open && !jobOnBoard($j, 'dice');
                    $jobs[] = ['id' => (string) $id, 'code' => (string) ($j->code ?? ''), 'ti' => (string) ($j->ti ?? ''), 'loc' => (string) ($j->loc ?? ''), 'open' => $open, 'off' => $off, 'internal' => !empty($j->internal), 'dice' => isset($j->dice) ? $j->dice : null];
                }
            }
            $s = cxStore();
            ok([
                'api' => ['dice' => cxApi('dice'), 'ilabor' => cxApi('ilabor')],
                'ops' => CX_OPS,
                'fields' => CX_FIELDS,
                'creds' => [
                    'dice' => ['id' => !empty($s['dice']['cid']), 'secret' => !empty($s['dice']['secret']), 'token' => !empty($s['dice']['token'])],
                    'ilabor' => ['user' => !empty($s['ilabor']['user']), 'pass' => !empty($s['ilabor']['pass']), 'key' => !empty($s['ilabor']['key']), 'token' => !empty($s['ilabor']['token']), 'sysid' => (string) ($s['ilabor']['sysid'] ?? '')],
                ],
                'pull' => secKv('cx_ilabor_pull'),
                'incoming' => cxIlaborIncomingPublic(),
                'auto' => secKv('cx_dice_auto'),
                // v36.1: Dice in Talent search: profiles waiting to be read, read today, the last background run
                'tsd' => (function () {
                    require_once __DIR__ . '/tsdice.php';
                    return tsDicePublic() + ['today' => tsDiceDay()['n'], 'last' => secKv('ts_dice_last')];
                })(),
                'jobs' => $jobs,
                // v37.1: what Dice answered to the last posting (to choose the Posting ID path by hand)
                'lastPost' => secKv('cx_last_post'),
                'log' => (array) (docGet('sec/x/cxlog')->rows ?? []),
            ]);
        case 'cx_log':
            ok(['log' => (array) (docGet('sec/x/cxlog')->rows ?? [])]);
        case 'cx_save':
            $s = cxStore();
            $in = (array) ($b['api'] ?? []);
            $cur = cxApi($prov);
            $base = trim((string) ($in['base'] ?? $cur['base']));
            if ($base !== '' && ($why = cxProviderUrlProblem($prov, $base)) !== '') {
                fail(400, 'invalid_argument', 'Base address: ' . $why);
            }
            $tokenUrl = trim((string) ($in['tokenUrl'] ?? $cur['tokenUrl']));
            if ($tokenUrl !== '' && ($why = cxUrlProblem($tokenUrl)) !== '') {
                fail(400, 'invalid_argument', 'Token address: ' . $why);
            }
            $ops = [];
            foreach (array_keys(CX_OPS[$prov]) as $op) {
                $o = (array) ($in['ops'][$op] ?? $cur['ops'][$op]);
                $map = [];
                foreach ((array) ($o['map'] ?? []) as $k => $v) {
                    if (isset(CX_FIELDS[$op][$k]) && is_string($v) && preg_match('/^[A-Za-z0-9_\-.@#:|$ ]{0,200}$/', $v)) {
                        $map[$k] = trim($v);
                    }
                }
                $ops[$op] = [
                    'on' => !empty($o['on']),
                    'method' => in_array($o['method'] ?? '', ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], true) ? $o['method'] : 'GET',
                    'path' => mb_substr(trim((string) ($o['path'] ?? '')), 0, 600),
                    'body' => mb_substr((string) ($o['body'] ?? ''), 0, 20000),
                    'ctype' => in_array($o['ctype'] ?? '', ['json', 'form', 'xml'], true) ? $o['ctype'] : 'json',
                    'items' => mb_substr(trim((string) ($o['items'] ?? '')), 0, 200),
                    'map' => $map,
                    'size' => max(1, min(500, (int) ($o['size'] ?? 50))),
                    'pages' => max(1, min(50, (int) ($o['pages'] ?? 5))),
                ];
                if (str_starts_with($ops[$op]['path'], 'http') && !str_contains($ops[$op]['path'], '{') && ($why = cxProviderUrlProblem($prov, cxFill($ops[$op]['path'], [], 'url'))) !== '') {
                    fail(400, 'invalid_argument', CX_OPS[$prov][$op] . ': ' . $why);
                }
            }
            $s[$prov]['api'] = [
                'base' => mb_substr($base, 0, 300),
                'auth' => in_array($in['auth'] ?? '', ['oauth2', 'basic', 'apikey', 'bearer', 'none'], true) ? $in['auth'] : $cur['auth'],
                'tokenUrl' => mb_substr($tokenUrl, 0, 300),
                'scope' => mb_substr(trim((string) ($in['scope'] ?? $cur['scope'])), 0, 300),
                'clientAuth' => in_array($in['clientAuth'] ?? '', ['basic', 'form', 'json'], true) ? $in['clientAuth'] : $cur['clientAuth'],
                'keyName' => preg_match('/^[A-Za-z0-9\-_]{1,60}$/', (string) ($in['keyName'] ?? '')) ? (string) $in['keyName'] : $cur['keyName'],
                'keyIn' => ($in['keyIn'] ?? $cur['keyIn']) === 'query' ? 'query' : 'header',
                'useKey' => !empty($in['useKey'] ?? $cur['useKey']),
                'headers' => mb_substr((string) ($in['headers'] ?? $cur['headers']), 0, 2000),
                'sched' => max(0, min(48, (int) ($in['sched'] ?? $cur['sched']))),
                'closeWords' => mb_substr((string) ($in['closeWords'] ?? $cur['closeWords']), 0, 300),
                'ops' => $ops,
                'auto' => array_merge($cur['auto'], array_intersect_key((array) ($in['auto'] ?? []), $cur['auto'])),
            ];
            // an access token for "Bearer token" sign-in is kept sealed with the other credentials
            if (isset($b['token']) && trim((string) $b['token']) !== '') {
                require_once __DIR__ . '/mail.php';
                $s[$prov]['token'] = mailSeal(mb_substr(trim((string) $b['token']), 0, 4000));
            }
            docSet('sec/x/src', (object) json_decode((string) json_encode($s)));
            secKvSet('cxtok_' . $prov, []);
            audit('settings', CX_PROVS[$prov] . ' API connection changed', $prov, ['auth' => $s[$prov]['api']['auth'], 'base' => $base, 'ops' => array_keys(array_filter($ops, fn($o) => $o['on']))], $u);
            ok(['api' => cxApi($prov)]);
        case 'cx_token':
            $api = cxApi($prov);
            if ($api['auth'] !== 'oauth2') {
                fail(400, 'invalid_argument', 'Only OAuth 2.0 sign-in uses a token address.');
            }
            [$tok, $err] = cxToken($prov, $api, cxCreds($prov), true);
            $c = secKv('cxtok_' . $prov);
            ok(['ok' => $tok !== '', 'err' => $err, 'exp' => is_array($c) ? (int) ($c['exp'] ?? 0) : 0]);
        case 'cx_test':
            $op = (string) ($b['op'] ?? '');
            if (!isset(CX_OPS[$prov][$op]) || !in_array($op, ['reqs', 'search', 'profile'], true)) {
                fail(400, 'invalid_argument', 'Test calls are for the operations that read (requisitions, search, profile). Posting is tested by posting a job.');
            }
            $vars = ['page' => 1, 'size' => cxApi($prov)['ops'][$op]['size'], 'offset' => 0, 'since' => gmdate('Y-m-d\TH:i:s\Z', time() - 30 * 86400), 'since_date' => gmdate('Y-m-d', time() - 30 * 86400), 'q' => str($b, 'q', 200) ?: 'java developer', 'location' => str($b, 'location', 120), 'radius' => (int) ($b['radius'] ?? 50) ?: 50, 'skills' => str($b, 'q', 200), 'id' => str($b, 'id', 120)];
            $r = cxCall($prov, $op, $vars);
            $items = $op === 'profile' && is_array($r['data']) ? [$r['data']] : ($r['items'] ?? []);
            $kind = $op;
            $auto = cxAutoMap($items, $kind);
            $map = cxApi($prov)['ops'][$op]['map'] ?: $auto;
            $paths = $items ? array_slice(cxPaths($items[0]), 0, 200) : [];
            ok([
                'code' => $r['code'], 'ms' => $r['ms'], 'ctype' => $r['ctype'], 'err' => $r['err'], 'sample' => $r['sample'],
                'n' => count($items), 'itemsPath' => cxItemsPath($r['data']), 'auto' => $auto, 'paths' => $paths,
                'preview' => array_map(fn($it) => cxMap($it, $map, $kind), array_slice($items, 0, 3)),
            ]);
        case 'cx_pull':
            if ($prov !== 'ilabor') {
                fail(400, 'invalid_argument', 'Requisitions come from iLabor360.');
            }
            @set_time_limit(300);
            ok(cxPull('by ' . $u['name']));
        case 'cx_ilabor_incoming':
            ok(cxIlaborIncomingPublic());
        case 'cx_ilabor_accept':
            if ($prov !== 'ilabor') fail(400, 'invalid_argument', 'Incoming requisitions are from iLabor360.');
            ok(cxIlaborAccept((array) ($b['ids'] ?? []), $u));
        case 'cx_ilabor_skip':
            if ($prov !== 'ilabor') fail(400, 'invalid_argument', 'Incoming requisitions are from iLabor360.');
            $n = 0;
            foreach (array_slice((array) ($b['ids'] ?? []), 0, 200) as $id) {
                $id = (string) $id; $x = docGet(CX_IL_IN . '/' . $id); if (!$x) continue;
                $x->state = 'skipped'; $x->skippedAt = now(); $x->lastAt = now(); docSet(CX_IL_IN . '/' . $id, $x); $n++;
            }
            if ($n) audit('data', 'iLabor360 incoming requisitions skipped', 'ilabor', ['n' => $n], $u);
            ok(['skipped' => $n, 'incoming' => cxIlaborIncomingPublic()]);
        case 'cx_search':
            if ($prov !== 'dice') {
                fail(400, 'invalid_argument', 'Candidate search is a Dice operation.');
            }
            $api = cxApi('dice');
            if (!$api['ops']['search']['on']) {
                fail(400, 'invalid_argument', 'Switch on and set up the candidate search first.');
            }
            $page = max(1, (int) ($b['page'] ?? 1));
            $size = $api['ops']['search']['size'];
            $r = cxCall('dice', 'search', ['q' => str($b, 'q', 200), 'skills' => str($b, 'q', 200), 'location' => str($b, 'location', 120), 'radius' => max(0, min(500, (int) ($b['radius'] ?? 50))), 'page' => $page, 'size' => $size, 'offset' => ($page - 1) * $size]);
            if ($r['err'] !== '') {
                fail(502, 'upstream', $r['err']);
            }
            $have = [];
            foreach (colAll('ats') as [$id, $c]) {
                if (isset($c->xid)) {
                    $have[(string) $c->xid] = (string) $id;
                }
                if (!empty($c->e)) {
                    $have['e:' . strtolower((string) $c->e)] = (string) $id;
                }
            }
            $out = [];
            foreach ($r['items'] as $it) {
                $m = cxMap($it, $api['ops']['search']['map'], 'search');
                $m['have'] = $have['dice:' . $m['id']] ?? ($m['email'] !== '' ? ($have['e:' . strtolower($m['email'])] ?? '') : '');
                $out[] = $m;
            }
            ok(['results' => $out, 'page' => $page, 'more' => count($r['items']) >= $size]);
        case 'cx_import':
            if ($prov !== 'dice') {
                fail(400, 'invalid_argument', 'Imports come from Dice.');
            }
            require_once __DIR__ . '/ats.php';
            $api = cxApi('dice');
            $job = str($b, 'job', 40);
            $added = [];
            $skipped = 0;
            $have = [];
            foreach (colAll('ats') as [$id, $c]) {
                if (isset($c->xid)) {
                    $have[(string) $c->xid] = true;
                }
                if (!empty($c->e)) {
                    $have['e:' . strtolower((string) $c->e)] = true;
                }
            }
            foreach (array_slice((array) ($b['items'] ?? []), 0, 50) as $x) {
                $x = array_map(fn($v) => is_scalar($v) ? mb_substr((string) $v, 0, 600) : '', (array) $x);
                $pid = (string) ($x['id'] ?? '');
                // the full profile (email, phone, resume) when that operation is set up
                if ($pid !== '' && $api['ops']['profile']['on']) {
                    $pr = cxCall('dice', 'profile', ['id' => $pid]);
                    if ($pr['err'] === '' && is_array($pr['data'])) {
                        $rec = $api['ops']['profile']['items'] !== '' ? (cxItems($pr['data'], $api['ops']['profile']['items'])[0] ?? $pr['data']) : $pr['data'];
                        foreach (cxMap($rec, $api['ops']['profile']['map'], 'profile') as $k => $v) {
                            if ($v !== '' && ($x[$k] ?? '') === '') {
                                $x[$k] = $v;
                            }
                        }
                    }
                }
                $name = trim((string) ($x['name'] ?? '')) ?: trim(($x['first'] ?? '') . ' ' . ($x['last'] ?? ''));
                if ($name === '') {
                    $skipped++;
                    continue;
                }
                if (($pid !== '' && isset($have['dice:' . $pid])) || (($x['email'] ?? '') !== '' && isset($have['e:' . strtolower((string) $x['email'])]))) {
                    $skipped++;
                    continue;
                }
                $exp = preg_match('/(\d+(?:\.\d+)?)/', (string) ($x['exp'] ?? ''), $em) ? (float) $em[1] : 0;
                $cid = atsNewCandidate($u, ['n' => $name, 'e' => (string) ($x['email'] ?? ''), 'ph' => (string) ($x['phone'] ?? ''), 'ti' => (string) ($x['title'] ?? ''), 'sk' => (string) ($x['skills'] ?? ''), 'loc' => (string) ($x['loc'] ?? ''), 'auth' => (string) ($x['auth'] ?? ''), 'exp' => $exp, 'li' => preg_match('#^https://#', (string) ($x['url'] ?? '')) ? (string) $x['url'] : ''], 'Dice', $job, 'Imported from a Dice search', $pid !== '' ? ['xid' => 'dice:' . $pid] : []);
                $file = ($x['resume'] ?? '') !== '' ? cxAttachResume('dice', $cid, (string) $x['resume'], $name) : '';
                $added[] = ['id' => $cid, 'n' => $name, 'resume' => $file !== ''];
                $have['dice:' . $pid] = true;
                if (($x['email'] ?? '') !== '') {
                    $have['e:' . strtolower((string) $x['email'])] = true;
                }
            }
            if ($added) {
                audit('data', 'Candidates imported from Dice', 'ats', ['n' => count($added), 'job' => $job], $u);
            }
            ok(['added' => $added, 'skipped' => $skipped]);
        case 'cx_job':
            if ($prov !== 'dice') {
                fail(400, 'invalid_argument', 'Job postings go to Dice.');
            }
            $act = in_array($b['act'] ?? '', ['post', 'update', 'close'], true) ? (string) $b['act'] : 'post';
            $jid = str($b, 'job', 40);
            $j = $jid !== '' ? docGet('org/site/jobs/' . $jid) : null;
            if (!$j) {
                fail(404, 'not_found', 'No such job.');
            }
            // v35.2: one function for the button and the automation
            require_once __DIR__ . '/cxauto.php';
            $res = cxJobAct($u, $jid, $act, !empty($b['again']));
            if (isset($res['err'])) {
                $mine = str_contains($res['err'], 'first') || str_contains($res['err'], 'not posted') || str_contains($res['err'], 'already');
                fail($mine ? 400 : 502, $mine ? 'invalid_argument' : 'upstream', $res['err']);
            }
            ok(array_intersect_key($res, ['dice' => 1, 'warn' => 1, 'learned' => 1, 'note' => 1]));
        case 'cx_job_id':
            // v37.1: the Dice ID of a posting typed in by hand (Dice took the job without saying it), or the record removed
            // when the job is not on Dice after all
            if ($prov !== 'dice') {
                fail(400, 'invalid_argument', 'Job postings go to Dice.');
            }
            $jid = str($b, 'job', 40);
            $j = $jid !== '' ? docGet('org/site/jobs/' . $jid) : null;
            if (!$j) {
                fail(404, 'not_found', 'No such job.');
            }
            require_once __DIR__ . '/cxauto.php';
            if (!empty($b['clear'])) {
                $was = (string) ($j->dice->id ?? '');
                unset($j->dice);
                docSet('org/site/jobs/' . $jid, $j);
                audit('data', 'Dice record removed from a job (not on Dice)', $jid, ['posting' => $was], $u);
                ok(['dice' => null]);
            }
            $pid = trim(str($b, 'id', 120));
            if (!preg_match('/^[A-Za-z0-9][A-Za-z0-9_\-.:]{0,119}$/', $pid)) {
                fail(400, 'invalid_argument', 'Type the posting ID exactly as Dice shows it (letters, digits and - _ . : only).');
            }
            $link = trim(str($b, 'url', 400));
            if ($link !== '' && !preg_match('#^https://\S+$#', $link)) {
                fail(400, 'invalid_argument', 'The posting link must start with https://');
            }
            $d = isset($j->dice) && $j->dice instanceof stdClass ? $j->dice : new stdClass();
            $d->id = $pid;
            unset($d->noId);
            $d->idBy = 'hand';
            $d->st = (string) ($d->st ?? '') === 'closed' ? 'closed' : 'live';
            $d->postedAt = (int) ($d->postedAt ?? 0) ?: now();
            if ($link !== '') {
                $d->url = $link;
            }
            $d->h = (string) ($d->h ?? '') ?: cxJobHash($j);
            $d->at = now();
            $d->by = (string) $u['name'];
            $j->dice = $d;
            docSet('org/site/jobs/' . $jid, $j);
            audit('data', 'Dice posting ID entered by hand', $jid, ['posting' => $pid], $u);
            ok(['dice' => $d]);
    }
    fail(404, 'not_found', 'Unknown action.');
}
/** v35.2 routes: set up from documents, and run the automation now. */
function cxRoute2(string $r, array $b): never
{
    $u = requireAdmin();
    if (!hasRole($u, 'admin')) {
        fail(403, 'forbidden', 'Sourcing connections are for administrators.');
    }
    require_once __DIR__ . '/cxauto.php';
    $prov = (string) ($b['prov'] ?? ($_POST['prov'] ?? ''));
    if (!isset(CX_PROVS[$prov])) {
        fail(400, 'invalid_argument', 'Choose Dice or iLabor360.');
    }
    if ($r === 'cx_auto') {
        ok(cxAutoRoute($u, $prov, $b));
    }
    if ($r === 'cx_auto_run') {
        @set_time_limit(300);
        ok(cxAutoRun('by ' . $u['name'], 200));
    }
    fail(404, 'not_found', 'Unknown action.');
}
