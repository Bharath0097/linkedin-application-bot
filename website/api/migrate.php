<?php
declare(strict_types=1);
/*
 * v41.1 Bring records from another ATS or CRM. Read-only connectors pull candidates, jobs, clients, contacts,
 * companies and leads straight from HubSpot, Pipedrive, Salesforce, Zoho CRM, Zoho Recruit, Bullhorn, Workable,
 * Greenhouse, Lever, Manatal or Recruit CRM into Import with preview: the same column matching, checks, likely
 * duplicates, decisions and undo as a spreadsheet. Nothing is written to the other system.
 * The keys are an administrator's to set (kept sealed, per workspace); a pull runs in steps of a few seconds, at most
 * IMP_MAX_ROWS records, and can bring only what changed since a date. Ceipal and JobDiva have no API a company can
 * switch on by itself: their export-and-import steps are shown instead.
 */
require_once __DIR__ . '/imports.php';
require_once __DIR__ . '/mail.php';

const MIG_SECS = 8;          // a step starts no new page after this many seconds
const MIG_SF = 'v66.0';      // Salesforce REST API version (Spring '26: every org has it)
const MIG_ZDC = ['com' => 'United States (zoho.com)', 'eu' => 'Europe (zoho.eu)', 'in' => 'India (zoho.in)', 'com.au' => 'Australia (zoho.com.au)', 'jp' => 'Japan (zoho.jp)', 'ca' => 'Canada (zohocloud.ca)', 'com.cn' => 'China (zoho.com.cn)'];

function migDb(): PDO
{
    static $ready = false;
    $p = db();
    if (!$ready) {
        $ready = true;
        $p->exec("CREATE TABLE IF NOT EXISTS mig_conn (src VARCHAR(20) PRIMARY KEY, data TEXT NOT NULL, at BIGINT NOT NULL, by_n VARCHAR(120) NOT NULL DEFAULT '', err VARCHAR(400) NOT NULL DEFAULT '', last BIGINT NOT NULL DEFAULT 0)");
        $p->exec("CREATE TABLE IF NOT EXISTS mig_pulls (id VARCHAR(24) PRIMARY KEY, uid VARCHAR(40) NOT NULL, src VARCHAR(20) NOT NULL, sset VARCHAR(20) NOT NULL, tk VARCHAR(12) NOT NULL, st VARCHAR(10) NOT NULL, n INT NOT NULL DEFAULT 0, at BIGINT NOT NULL, data TEXT NOT NULL)");
    }
    return $p;
}

/** The systems: the keys an administrator enters (key, label, type, hint), where to find them, what can be brought. */
function migSources(): array
{
    $zf = [['dc', 'Data center', 'dc', 'Where your Zoho account lives (the address you sign in at).'], ['id', 'Client ID', 'text', ''], ['secret', 'Client secret', 'secret', ''], ['code', 'Grant code', 'secret', 'Made in the API console a few minutes ago; it works once.']];
    return [
        'hubspot' => ['n' => 'HubSpot', 'what' => 'CRM', 'f' => [['token', 'Private app access token', 'secret', 'Starts with pat-']], 'help' => 'In HubSpot: Development › Legacy apps › Create legacy app › Private. Give it the read scopes crm.objects.contacts.read, crm.objects.companies.read and crm.objects.owners.read, create it, then open its Auth tab › Show token and copy it here.', 'sets' => ['contacts' => ['Contacts', 'crm'], 'companies' => ['Companies', 'crmco']]],
        'pipedrive' => ['n' => 'Pipedrive', 'what' => 'CRM', 'f' => [['domain', 'Company domain', 'text', 'yourcompany in yourcompany.pipedrive.com'], ['token', 'API token', 'secret', '']], 'help' => 'In Pipedrive: your name › Company settings › Personal preferences › API (app.pipedrive.com/settings/api) and copy your personal API token. It reads what your Pipedrive user can see.', 'sets' => ['persons' => ['People', 'crm'], 'orgs' => ['Organizations', 'crmco']]],
        'salesforce' => ['n' => 'Salesforce', 'what' => 'CRM', 'f' => [['domain', 'My Domain address', 'text', 'yourcompany.my.salesforce.com'], ['id', 'Consumer key', 'text', ''], ['secret', 'Consumer secret', 'secret', '']], 'help' => 'In Salesforce Setup: External Client App Manager › New External Client App (distribution: Local). Enable OAuth with the "api" scope and the client credentials flow; under Policies set Run As to an integration user who can read contacts, accounts and leads; then Settings › OAuth Settings shows the consumer key and secret.', 'sets' => ['contacts' => ['Contacts', 'crm'], 'accounts' => ['Accounts', 'crmco'], 'leads' => ['Leads', 'lead']]],
        'zohocrm' => ['n' => 'Zoho CRM', 'what' => 'CRM', 'f' => $zf, 'help' => 'At api-console.zoho.com (on your data center): Add client › Self Client › Create. On its Generate Code tab enter the scope ZohoCRM.modules.contacts.READ,ZohoCRM.modules.accounts.READ,ZohoCRM.modules.leads.READ, choose 10 minutes, describe it ("StratEdge import") and create it. Paste the client ID, the client secret and that code here within those minutes.', 'sets' => ['contacts' => ['Contacts', 'crm'], 'accounts' => ['Accounts', 'crmco'], 'leads' => ['Leads', 'lead']]],
        'zohorecruit' => ['n' => 'Zoho Recruit', 'what' => 'ATS', 'f' => $zf, 'help' => 'At api-console.zoho.com (on your data center): Add client › Self Client › Create. On its Generate Code tab enter the scope ZohoRECRUIT.modules.all, choose 10 minutes, describe it ("StratEdge import") and create it. Paste the client ID, the client secret and that code here within those minutes. The portal only reads.', 'sets' => ['candidates' => ['Candidates', 'ats'], 'jobs' => ['Job openings', 'req'], 'clients' => ['Clients', 'client'], 'contacts' => ['Contacts', 'crm']]],
        'bullhorn' => ['n' => 'Bullhorn', 'what' => 'ATS', 'f' => [['id', 'Client ID', 'text', ''], ['secret', 'Client secret', 'secret', ''], ['user', 'API username', 'text', ''], ['pass', 'API user password', 'secret', ''], ['redirect', 'Redirect address registered with Bullhorn (if any)', 'text', '']], 'help' => 'Bullhorn gives REST API credentials through a support case in the Bullhorn Resource Center: a client ID and secret, an API user with its password, and the redirect address registered for them. Your Bullhorn edition must include API access.', 'sets' => ['candidates' => ['Candidates', 'ats'], 'jobs' => ['Job orders', 'req'], 'clients' => ['Client corporations', 'client'], 'contacts' => ['Client contacts', 'crm']]],
        'workable' => ['n' => 'Workable', 'what' => 'ATS', 'f' => [['sub', 'Account subdomain', 'text', 'yourcompany in yourcompany.workable.com'], ['token', 'API access token', 'secret', '']], 'help' => 'In Workable: your profile › Settings › Integrations › Apps › Generate new token, with the r_candidates and r_jobs scopes (Workable shows it once). Workable allows 10 requests in 10 seconds, so a large account takes a few minutes.', 'sets' => ['candidates' => ['Candidates', 'ats'], 'jobs' => ['Jobs', 'req']]],
        'greenhouse' => ['n' => 'Greenhouse', 'what' => 'ATS', 'f' => [['id', 'Harvest V3 client ID', 'text', ''], ['secret', 'Client secret', 'secret', '']], 'help' => 'In Greenhouse: Configure › Dev Center › API Credential Management › Create new API credentials › Harvest V3 (OAuth), allowing it to read candidates and jobs. (Keys for Harvest v1 and v2 stopped working on August 31, 2026.)', 'sets' => ['candidates' => ['Candidates', 'ats'], 'jobs' => ['Jobs', 'req']]],
        'lever' => ['n' => 'Lever', 'what' => 'ATS', 'f' => [['token', 'API key', 'secret', '']], 'help' => 'In Lever: Settings › Integrations and API › API Credentials › Generate new key, with read access to opportunities and postings.', 'sets' => ['opps' => ['Candidates (opportunities)', 'ats'], 'postings' => ['Job postings', 'req']]],
        'manatal' => ['n' => 'Manatal', 'what' => 'ATS', 'f' => [['token', 'Open API token', 'secret', '']], 'help' => 'Needs Manatal\'s Enterprise Plus plan: Administration › Features › Open API › Generate new token (administrators).', 'sets' => ['candidates' => ['Candidates', 'ats'], 'jobs' => ['Jobs', 'req'], 'orgs' => ['Organizations', 'client'], 'contacts' => ['Contacts', 'crm']]],
        'recruitcrm' => ['n' => 'Recruit CRM', 'what' => 'ATS', 'f' => [['token', 'API token', 'secret', '']], 'help' => 'Needs the Business plan or higher: the account owner opens Admin Settings › API and copies the API token.', 'sets' => ['candidates' => ['Candidates', 'ats'], 'jobs' => ['Jobs', 'req'], 'companies' => ['Companies', 'client'], 'contacts' => ['Contacts', 'crm']]],
        'ceipal' => ['n' => 'Ceipal', 'what' => 'ATS', 'manual' => 'Ceipal opens its API to a company on request, so for now use its export: open Applicants (or Job Postings, Clients) in Ceipal, export them to Excel (ask your Ceipal administrator if your role does not show the export), and upload the file above. Every column is matched as with any spreadsheet.', 'kinds' => ['ats', 'req', 'client']],
        'jobdiva' => ['n' => 'JobDiva', 'what' => 'ATS', 'manual' => 'JobDiva gives API access through JobDiva support, so for now use its export: export the candidates (or jobs, companies, contacts) from JobDiva to Excel and upload the file above. Every column is matched as with any spreadsheet.', 'kinds' => ['ats', 'req', 'client', 'crm']],
    ];
}

/** A saved connection: ['cred' => [...], 'at', 'by_n', 'err', 'last'] (the keys unsealed), or null. */
function migConn(string $src): ?array
{
    $s = migDb()->prepare('SELECT * FROM mig_conn WHERE src = ?');
    $s->execute([$src]);
    $r = $s->fetch();
    if (!$r) {
        return null;
    }
    $cred = json_decode(mailUnseal((string) $r['data']), true);
    return ['cred' => is_array($cred) ? $cred : [], 'at' => (int) $r['at'], 'by' => (string) $r['by_n'], 'err' => (string) $r['err'], 'last' => (int) $r['last']];
}
function migConnSave(string $src, array $cred, string $by): void
{
    $pdo = migDb();
    $pdo->prepare('DELETE FROM mig_conn WHERE src = ?')->execute([$src]);
    $pdo->prepare('INSERT INTO mig_conn (src, data, at, by_n, err, last) VALUES (?,?,?,?,?,0)')->execute([$src, mailSeal((string) json_encode($cred)), now(), mb_substr($by, 0, 120), '']);
}
function migNote(string $src, string $err, bool $pulled = false): void
{
    migDb()->prepare('UPDATE mig_conn SET err = ?' . ($pulled ? ', last = ' . now() : '') . ' WHERE src = ?')->execute([mb_substr($err, 0, 400), $src]);
}

/* ---------------------------------------------------------------- HTTP */

/** One call: [status, decoded JSON (or the text), response headers (lower-case names)]. $body: an array is sent as JSON,
 *  ['__form' => [...]] as a form, a string as it is. */
function migHttp(string $method, string $url, array $headers = [], $body = null): array
{
    if (!function_exists('curl_init')) {
        return [0, 'PHP cURL is not available on this server.', []];
    }
    $hdrs = [];
    $ch = curl_init(extUrl($url));
    $h = array_merge(['Accept: application/json', 'User-Agent: StratEdge-Import/1.0'], $headers);
    $o = [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 40, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HEADERFUNCTION => function ($c, $line) use (&$hdrs) {
            $p = strpos($line, ':');
            if ($p !== false) {
                $hdrs[strtolower(trim(substr($line, 0, $p)))] = trim(substr($line, $p + 1));
            }
            return strlen($line);
        }];
    if ($body !== null) {
        if (is_array($body) && isset($body['__form'])) {
            $o[CURLOPT_POSTFIELDS] = http_build_query($body['__form']);
            $h[] = 'Content-Type: application/x-www-form-urlencoded';
        } elseif (is_array($body)) {
            $o[CURLOPT_POSTFIELDS] = (string) json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            $h[] = 'Content-Type: application/json';
        } else {
            $o[CURLOPT_POSTFIELDS] = (string) $body;
        }
    }
    $o[CURLOPT_HTTPHEADER] = $h;
    curl_setopt_array($ch, $o);
    $raw = curl_exec($ch);
    $st = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($raw === false) {
        return [0, $err, $hdrs];
    }
    $j = json_decode((string) $raw, true);
    return [$st, is_array($j) ? $j : (string) $raw, $hdrs];
}
/** What a refusal says, in a line. */
function migWhy($r, int $code): string
{
    if (is_array($r)) {
        foreach ([['message'], ['error_description'], ['error', 'message'], ['errors', 0, 'message'], [0, 'message'], ['detail'], ['error']] as $path) {
            $v = $r;
            foreach ($path as $k) {
                $v = is_array($v) && array_key_exists($k, $v) ? $v[$k] : null;
            }
            if (is_string($v) && $v !== '') {
                return mb_substr($v, 0, 200);
            }
        }
    }
    $t = trim(strip_tags(is_string($r) ? $r : ''));
    return $t !== '' ? mb_substr($t, 0, 160) : ($code ? 'answer ' . $code : 'no answer (the address may be wrong, or the service is down)');
}
/** Stops with a message the person can act on (and notes it on the connection). */
function migFail(string $src, $r, int $code, string $what = ''): never
{
    $n = migSources()[$src]['n'] ?? $src;
    $why = migWhy($r, $code);
    $msg = in_array($code, [401, 403], true)
        ? $n . ' did not accept the keys (' . $why . '). Check them under Connect, and that they may read ' . ($what !== '' ? $what : 'these records') . '.'
        : ($code === 429 ? $n . ' says too many requests for now. Wait a few minutes and continue.' : $n . ' did not answer as expected: ' . $why . '.');
    migNote($src, $msg);
    fail($code === 429 ? 429 : (in_array($code, [401, 403], true) ? 400 : 502), in_array($code, [401, 403], true) ? 'invalid_argument' : 'unavailable', $msg);
}

/* ---------------------------------------------------------------- reading the records */

/** A record's remaining plain values as extra columns ("<System> · field"), for mapping by hand. */
function migExtra(string $n, array $rec, array $skip, int $max = 25): array
{
    $out = [];
    foreach ($rec as $k => $v) {
        if (count($out) >= $max || in_array($k, $skip, true) || preg_match('/(^id$|_id$|Id$|^\$|^_|^hs_object|password|token|secret)/i', (string) $k)) {
            continue;
        }
        if (is_array($v)) {
            $v = isset($v['name']) && is_string($v['name']) ? $v['name'] : (array_is_list($v) ? implode(', ', array_filter(array_map(fn($x) => is_scalar($x) ? (string) $x : (is_array($x) ? (string) ($x['value'] ?? ($x['name'] ?? ($x['text'] ?? ''))) : ''), $v))) : '');
        }
        if (is_bool($v)) {
            $v = $v ? 'Yes' : 'No';
        }
        if (!is_scalar($v) || trim((string) $v) === '') {
            continue;
        }
        $label = trim((string) preg_replace('/\s+/', ' ', str_replace(['_', '__c'], [' ', ''], (string) preg_replace('/(?<=[a-z])(?=[A-Z])/', ' ', (string) $k))));
        $out[$n . ' · ' . $label] = mb_substr((string) $v, 0, IMP_CELL);
    }
    return $out;
}
function migJoin(...$parts): string
{
    return implode(', ', array_values(array_filter(array_map(fn($x) => trim(is_scalar($x) ? (string) $x : ''), $parts), fn($x) => $x !== '')));
}
/** The first of several values that is not empty. */
function migAny(...$vals): string
{
    foreach ($vals as $v) {
        if (is_array($v)) {
            $v = (string) ($v['value'] ?? ($v['name'] ?? ($v[0]['value'] ?? ($v[0] ?? ''))));
        }
        if (is_scalar($v) && trim((string) $v) !== '') {
            return trim((string) $v);
        }
    }
    return '';
}
function migIso(string $since): string
{
    return $since !== '' ? gmdate('Y-m-d\TH:i:s\Z', (int) strtotime($since . ' 00:00:00 UTC')) : '';
}

/** Zoho: the account's API addresses and a fresh access token from the saved refresh token. */
function migZohoToken(string $src, array $c, array &$st): array
{
    if (!empty($st['tok']) && (int) ($st['exp'] ?? 0) > time() + 60) {
        return [$st['tok'], $st['api']];
    }
    $acc = ($c['dc'] ?? 'com') === 'ca' ? 'https://accounts.zohocloud.ca' : 'https://accounts.zoho.' . ($c['dc'] ?? 'com');
    [$code, $r] = migHttp('POST', $acc . '/oauth/v2/token', [], ['__form' => ['refresh_token' => (string) ($c['refresh'] ?? ''), 'client_id' => (string) ($c['id'] ?? ''), 'client_secret' => (string) ($c['secret'] ?? ''), 'grant_type' => 'refresh_token']]);
    if ($code !== 200 || !is_array($r) || empty($r['access_token'])) {
        migFail($src, $r, $code === 200 ? 401 : $code);
    }
    $st['tok'] = (string) $r['access_token'];
    $st['exp'] = time() + (int) ($r['expires_in'] ?? 3600);
    $st['api'] = (string) ($r['api_domain'] ?? (($c['dc'] ?? 'com') === 'ca' ? 'https://www.zohoapis.ca' : 'https://www.zohoapis.' . ($c['dc'] ?? 'com')));
    return [$st['tok'], $st['api']];
}
/** Bullhorn: its data center, an access token (with the API user's sign-in) and the REST session. */
function migBullhorn(array $c, array &$st): array
{
    if (!empty($st['bh']) && (int) ($st['bhExp'] ?? 0) > time()) {
        return [$st['bh'], $st['rest']];
    }
    [$code, $info] = migHttp('GET', 'https://rest.bullhornstaffing.com/rest-services/loginInfo?username=' . rawurlencode((string) ($c['user'] ?? '')));
    if ($code !== 200 || !is_array($info) || empty($info['oauthUrl'])) {
        migFail('bullhorn', $info, $code === 200 ? 401 : $code);
    }
    $oauth = rtrim((string) $info['oauthUrl'], '/');
    $q = ['client_id' => (string) ($c['id'] ?? ''), 'response_type' => 'code', 'action' => 'Login', 'username' => (string) ($c['user'] ?? ''), 'password' => (string) ($c['pass'] ?? '')];
    if ((string) ($c['redirect'] ?? '') !== '') {
        $q['redirect_uri'] = (string) $c['redirect'];
    }
    [$code, $r, $h] = migHttp('GET', $oauth . '/authorize?' . http_build_query($q));
    parse_str((string) parse_url((string) ($h['location'] ?? ''), PHP_URL_QUERY), $back);
    if (empty($back['code'])) {
        migFail('bullhorn', $r, in_array($code, [200, 302], true) ? 401 : $code);
    }
    $t = ['grant_type' => 'authorization_code', 'code' => (string) $back['code'], 'client_id' => (string) ($c['id'] ?? ''), 'client_secret' => (string) ($c['secret'] ?? '')] + ((string) ($c['redirect'] ?? '') !== '' ? ['redirect_uri' => (string) $c['redirect']] : []);
    [$code, $tok] = migHttp('POST', $oauth . '/token?' . http_build_query($t));
    if ($code !== 200 || !is_array($tok) || empty($tok['access_token'])) {
        migFail('bullhorn', $tok, $code === 200 ? 401 : $code);
    }
    [$code, $lg] = migHttp('POST', rtrim((string) ($info['restUrl'] ?? ''), '/') . '/login?' . http_build_query(['version' => '2.0', 'access_token' => (string) $tok['access_token']]));
    if ($code !== 200 || !is_array($lg) || empty($lg['BhRestToken'])) {
        migFail('bullhorn', $lg, $code === 200 ? 401 : $code);
    }
    $st['bh'] = (string) $lg['BhRestToken'];
    $st['rest'] = rtrim((string) ($lg['restUrl'] ?? $info['restUrl']), '/') . '/';
    $st['bhExp'] = time() + 540; // a REST session is renewed well before it lapses
    return [$st['bh'], $st['rest']];
}

/**
 * One page of records: rows as heading => value, and $st['cur'] set to where the next page starts (null when done).
 * $st carries the cursor, tokens and look-ups between pages and steps.
 */
function migPage(string $src, string $set, array $c, array &$st): array
{
    $since = (string) ($st['since'] ?? '');
    $cur = $st['cur'] ?? '';
    $rows = [];
    $n = migSources()[$src]['n'];
    switch ($src) {
        case 'hubspot':
            $auth = ['Authorization: Bearer ' . (string) ($c['token'] ?? '')];
            if (!isset($st['owners'])) {
                $st['owners'] = [];
                [$code, $r] = migHttp('GET', 'https://api.hubapi.com/crm/v3/owners?limit=100', $auth);
                if ($code === 401) {
                    migFail($src, $r, $code);
                }
                foreach ((array) (is_array($r) ? ($r['results'] ?? []) : []) as $o) {
                    $st['owners'][(string) ($o['id'] ?? '')] = trim(((string) ($o['firstName'] ?? '')) . ' ' . ((string) ($o['lastName'] ?? ''))) ?: (string) ($o['email'] ?? '');
                }
            }
            $obj = $set === 'companies' ? 'companies' : 'contacts';
            $props = $obj === 'contacts'
                ? ['firstname', 'lastname', 'email', 'phone', 'mobilephone', 'jobtitle', 'company', 'website', 'city', 'state', 'country', 'lifecyclestage', 'hs_lead_status', 'hubspot_owner_id', 'createdate', 'lastmodifieddate']
                : ['name', 'domain', 'website', 'industry', 'type', 'city', 'state', 'country', 'description', 'hubspot_owner_id', 'createdate', 'hs_lastmodifieddate'];
            if ($since !== '') {
                $q = ['filterGroups' => [['filters' => [['propertyName' => $obj === 'contacts' ? 'lastmodifieddate' : 'hs_lastmodifieddate', 'operator' => 'GTE', 'value' => (string) (strtotime($since . ' 00:00:00 UTC') * 1000)]]]], 'properties' => $props, 'limit' => 100, 'sorts' => [['propertyName' => $obj === 'contacts' ? 'lastmodifieddate' : 'hs_lastmodifieddate', 'direction' => 'ASCENDING']]];
                if ($cur !== '') {
                    $q['after'] = (string) $cur;
                }
                [$code, $r] = migHttp('POST', 'https://api.hubapi.com/crm/v3/objects/' . $obj . '/search', $auth, $q);
            } else {
                [$code, $r] = migHttp('GET', 'https://api.hubapi.com/crm/v3/objects/' . $obj . '?' . http_build_query(['limit' => 100, 'properties' => implode(',', $props)] + ($cur !== '' ? ['after' => $cur] : [])), $auth);
            }
            if ($code !== 200 || !is_array($r)) {
                migFail($src, $r, $code, $obj);
            }
            foreach ((array) ($r['results'] ?? []) as $it) {
                $p = (array) ($it['properties'] ?? []);
                $own = $st['owners'][(string) ($p['hubspot_owner_id'] ?? '')] ?? '';
                $rows[] = $obj === 'contacts'
                    ? ['First name' => migAny($p['firstname'] ?? ''), 'Last name' => migAny($p['lastname'] ?? ''), 'Email' => migAny($p['email'] ?? ''), 'Phone' => migAny($p['phone'] ?? '', $p['mobilephone'] ?? ''), 'Title' => migAny($p['jobtitle'] ?? ''), 'Company' => migAny($p['company'] ?? ''), 'Company website' => migAny($p['website'] ?? ''), 'Location' => migJoin($p['city'] ?? '', $p['state'] ?? '', $p['country'] ?? ''), 'Owner' => $own, 'Source' => 'HubSpot', $n . ' · Lifecycle stage' => migAny($p['lifecyclestage'] ?? ''), $n . ' · Lead status' => migAny($p['hs_lead_status'] ?? ''), $n . ' ID' => (string) ($it['id'] ?? '')]
                    : ['Company' => migAny($p['name'] ?? ''), 'Website' => migAny($p['website'] ?? '', $p['domain'] ?? ''), 'Industry' => migAny($p['industry'] ?? ''), 'Company type' => migAny($p['type'] ?? ''), 'Location' => migJoin($p['city'] ?? '', $p['state'] ?? '', $p['country'] ?? ''), 'Owner' => $own, 'Source' => 'HubSpot', 'Notes' => migAny($p['description'] ?? ''), $n . ' ID' => (string) ($it['id'] ?? '')];
            }
            $next = (string) ($r['paging']['next']['after'] ?? '');
            $st['cur'] = $next !== '' && ($since === '' || (int) $next < 10000) ? $next : null;
            usleep(120000);
            return $rows;

        case 'pipedrive':
            $dom = strtolower((string) preg_replace('/[^a-z0-9-]/i', '', (string) ($c['domain'] ?? '')));
            $base = 'https://' . $dom . '.pipedrive.com/api/v2/';
            $auth = ['x-api-token: ' . (string) ($c['token'] ?? '')];
            if ($set === 'persons' && !isset($st['orgs'])) {
                // the organizations' names, once (people carry only org_id)
                $st['orgs'] = [];
                $oc = '';
                for ($i = 0; $i < 20; $i++) {
                    [$code, $r] = migHttp('GET', $base . 'organizations?' . http_build_query(['limit' => 500] + ($oc !== '' ? ['cursor' => $oc] : [])), $auth);
                    if ($code !== 200 || !is_array($r)) {
                        migFail($src, $r, $code, 'organizations');
                    }
                    foreach ((array) ($r['data'] ?? []) as $o) {
                        $st['orgs'][(string) ($o['id'] ?? '')] = (string) ($o['name'] ?? '');
                    }
                    $oc = (string) ($r['additional_data']['next_cursor'] ?? '');
                    if ($oc === '') {
                        break;
                    }
                }
            }
            $q = ['limit' => 500] + ($cur !== '' ? ['cursor' => $cur] : []) + ($since !== '' ? ['updated_since' => migIso($since)] : []);
            [$code, $r] = migHttp('GET', $base . ($set === 'orgs' ? 'organizations' : 'persons') . '?' . http_build_query($q), $auth);
            if ($code !== 200 || !is_array($r)) {
                migFail($src, $r, $code, $set === 'orgs' ? 'organizations' : 'people');
            }
            foreach ((array) ($r['data'] ?? []) as $it) {
                if ($set === 'orgs') {
                    $addr = $it['address'] ?? '';
                    $rows[] = ['Company' => migAny($it['name'] ?? ''), 'Location' => is_array($addr) ? migAny($addr['value'] ?? '', migJoin($addr['locality'] ?? '', $addr['admin_area_level_1'] ?? '', $addr['country'] ?? '')) : migAny($addr), 'Source' => 'Pipedrive', $n . ' ID' => (string) ($it['id'] ?? '')];
                    continue;
                }
                $prim = function ($list) {
                    $list = (array) $list;
                    foreach ($list as $x) {
                        if (!empty($x['primary']) && (string) ($x['value'] ?? '') !== '') {
                            return (string) $x['value'];
                        }
                    }
                    return migAny($list);
                };
                $orgId = is_array($it['org_id'] ?? null) ? (string) ($it['org_id']['value'] ?? '') : (string) ($it['org_id'] ?? '');
                $rows[] = ['Name' => migAny($it['name'] ?? ''), 'First name' => migAny($it['first_name'] ?? ''), 'Last name' => migAny($it['last_name'] ?? ''), 'Email' => $prim($it['emails'] ?? []), 'Phone' => $prim($it['phones'] ?? []), 'Title' => migAny($it['job_title'] ?? ''), 'Company' => $st['orgs'][$orgId] ?? '', 'Source' => 'Pipedrive', $n . ' ID' => (string) ($it['id'] ?? '')];
            }
            $next = (string) ($r['additional_data']['next_cursor'] ?? '');
            $st['cur'] = $next !== '' ? $next : null;
            return $rows;

        case 'salesforce':
            if (empty($st['tok'])) {
                $dom = strtolower(trim((string) preg_replace('#^https?://#i', '', (string) ($c['domain'] ?? '')), '/'));
                [$code, $r] = migHttp('POST', 'https://' . $dom . '/services/oauth2/token', [], ['__form' => ['grant_type' => 'client_credentials', 'client_id' => (string) ($c['id'] ?? ''), 'client_secret' => (string) ($c['secret'] ?? '')]]);
                if ($code !== 200 || !is_array($r) || empty($r['access_token'])) {
                    migFail($src, $r, $code === 200 || $code === 400 ? 401 : $code);
                }
                $st['tok'] = (string) $r['access_token'];
                $st['inst'] = rtrim((string) ($r['instance_url'] ?? ('https://' . $dom)), '/');
            }
            $auth = ['Authorization: Bearer ' . $st['tok'], 'Sforce-Query-Options: batchSize=500'];
            if ($cur === '') {
                $where = $since !== '' ? ' WHERE LastModifiedDate >= ' . migIso($since) : '';
                $soql = [
                    'contacts' => 'SELECT Id, FirstName, LastName, Email, Phone, MobilePhone, Title, Account.Name, Account.Website, MailingCity, MailingState, MailingCountry, LeadSource, Owner.Name FROM Contact',
                    'accounts' => 'SELECT Id, Name, Website, Industry, Type, BillingCity, BillingState, BillingCountry, Description, Owner.Name FROM Account',
                    'leads' => 'SELECT Id, FirstName, LastName, Email, Phone, Company, Title, LeadSource, Status, Industry, City, State, Country, Description, Owner.Name FROM Lead',
                ][$set] . $where . ' ORDER BY LastModifiedDate';
                $url = $st['inst'] . '/services/data/' . MIG_SF . '/query?q=' . rawurlencode($soql);
            } else {
                $url = $st['inst'] . (string) $cur;
            }
            [$code, $r] = migHttp('GET', $url, $auth);
            if ($code !== 200 || !is_array($r)) {
                migFail($src, $r, $code, $set);
            }
            foreach ((array) ($r['records'] ?? []) as $it) {
                $own = (string) ($it['Owner']['Name'] ?? '');
                $rows[] = match ($set) {
                    'contacts' => ['First name' => migAny($it['FirstName'] ?? ''), 'Last name' => migAny($it['LastName'] ?? ''), 'Email' => migAny($it['Email'] ?? ''), 'Phone' => migAny($it['Phone'] ?? '', $it['MobilePhone'] ?? ''), 'Title' => migAny($it['Title'] ?? ''), 'Company' => (string) ($it['Account']['Name'] ?? ''), 'Company website' => (string) ($it['Account']['Website'] ?? ''), 'Location' => migJoin($it['MailingCity'] ?? '', $it['MailingState'] ?? '', $it['MailingCountry'] ?? ''), 'Source' => migAny($it['LeadSource'] ?? '', 'Salesforce'), 'Owner' => $own, $n . ' ID' => (string) ($it['Id'] ?? '')],
                    'accounts' => ['Company' => migAny($it['Name'] ?? ''), 'Website' => migAny($it['Website'] ?? ''), 'Industry' => migAny($it['Industry'] ?? ''), 'Company type' => migAny($it['Type'] ?? ''), 'Location' => migJoin($it['BillingCity'] ?? '', $it['BillingState'] ?? '', $it['BillingCountry'] ?? ''), 'Owner' => $own, 'Source' => 'Salesforce', 'Notes' => migAny($it['Description'] ?? ''), $n . ' ID' => (string) ($it['Id'] ?? '')],
                    default => ['First name' => migAny($it['FirstName'] ?? ''), 'Last name' => migAny($it['LastName'] ?? ''), 'Company' => migAny($it['Company'] ?? ''), 'Title' => migAny($it['Title'] ?? ''), 'Email' => migAny($it['Email'] ?? ''), 'Phone' => migAny($it['Phone'] ?? ''), 'Source' => migAny($it['LeadSource'] ?? '', 'Salesforce'), 'Status' => migAny($it['Status'] ?? ''), 'Industry' => migAny($it['Industry'] ?? ''), 'Location' => migJoin($it['City'] ?? '', $it['State'] ?? '', $it['Country'] ?? ''), 'Owner' => $own, 'Notes' => migAny($it['Description'] ?? ''), $n . ' ID' => (string) ($it['Id'] ?? '')],
                };
            }
            $st['cur'] = empty($r['done']) && !empty($r['nextRecordsUrl']) ? (string) $r['nextRecordsUrl'] : null;
            return $rows;

        case 'zohocrm':
        case 'zohorecruit':
            [$tok, $api] = migZohoToken($src, $c, $st);
            $auth = ['Authorization: Zoho-oauthtoken ' . $tok] + ($since !== '' ? [1 => 'If-Modified-Since: ' . gmdate('Y-m-d\TH:i:s', (int) strtotime($since . ' 00:00:00 UTC')) . '+00:00'] : []);
            $page = max(1, (int) ($st['page'] ?? 1));
            if ($src === 'zohocrm') {
                $mod = ['contacts' => 'Contacts', 'accounts' => 'Accounts', 'leads' => 'Leads'][$set];
                $fields = [
                    'Contacts' => 'First_Name,Last_Name,Email,Phone,Mobile,Title,Account_Name,Mailing_City,Mailing_State,Mailing_Country,Lead_Source,Owner,Description',
                    'Accounts' => 'Account_Name,Website,Industry,Account_Type,Billing_City,Billing_State,Billing_Country,Owner,Description',
                    'Leads' => 'First_Name,Last_Name,Email,Phone,Mobile,Company,Designation,Lead_Source,Lead_Status,Industry,City,State,Country,Owner,Description',
                ][$mod];
                $q = ['fields' => $fields, 'per_page' => 200, 'sort_by' => 'Modified_Time', 'sort_order' => 'asc'] + ($cur !== '' ? ['page_token' => $cur] : ['page' => $page]);
                [$code, $r] = migHttp('GET', rtrim($api, '/') . '/crm/v8/' . $mod . '?' . http_build_query($q), array_values($auth));
            } else {
                $mod = ['candidates' => 'Candidates', 'jobs' => 'Job_Openings', 'clients' => 'Clients', 'contacts' => 'Contacts'][$set];
                $rb = ($c['dc'] ?? 'com') === 'ca' ? 'https://recruit.zohocloud.ca' : 'https://recruit.zoho.' . ($c['dc'] ?? 'com');
                [$code, $r] = migHttp('GET', $rb . '/recruit/v2/' . $mod . '?' . http_build_query(['page' => $page, 'per_page' => 200]), array_values($auth));
            }
            if ($code === 204 || ($code === 304)) {
                $st['cur'] = null; // nothing (more) changed
                return [];
            }
            if ($code !== 200 || !is_array($r)) {
                migFail($src, $r, $code, strtolower(str_replace('_', ' ', $mod)));
            }
            foreach ((array) ($r['data'] ?? []) as $it) {
                $own = migAny($it['Owner'] ?? '', $it['Candidate_Owner'] ?? '', $it['Assigned_Recruiter'] ?? '', $it['Account_Manager'] ?? '');
                $loc = migJoin(migAny($it['City'] ?? '', $it['Mailing_City'] ?? '', $it['Billing_City'] ?? ''), migAny($it['State'] ?? '', $it['Mailing_State'] ?? '', $it['Billing_State'] ?? ''), migAny($it['Country'] ?? '', $it['Mailing_Country'] ?? '', $it['Billing_Country'] ?? ''));
                $base = match ($mod) {
                    'Candidates' => ['First name' => migAny($it['First_Name'] ?? ''), 'Last name' => migAny($it['Last_Name'] ?? ''), 'Email' => migAny($it['Email'] ?? ''), 'Phone' => migAny($it['Mobile'] ?? '', $it['Phone'] ?? ''), 'Current title' => migAny($it['Current_Job_Title'] ?? ''), 'Skills' => migAny($it['Skill_Set'] ?? ''), 'Location' => $loc, 'Years of experience' => migAny($it['Experience_in_Years'] ?? ''), 'LinkedIn' => migAny($it['LinkedIn__s'] ?? '', $it['LinkedIn'] ?? ''), 'Source' => migAny($it['Source'] ?? '', 'Zoho Recruit'), $n . ' · Status' => migAny($it['Candidate_Status'] ?? ''), $n . ' · Current employer' => migAny($it['Current_Employer'] ?? ''), 'Owner' => $own],
                    'Job_Openings' => ['Job title' => migAny($it['Job_Opening_Name'] ?? '', $it['Posting_Title'] ?? ''), 'Job ID' => migAny($it['Job_Opening_ID'] ?? '', $it['id'] ?? ''), 'Client' => migAny($it['Client_Name'] ?? ''), 'Location' => $loc, 'Openings' => migAny($it['Number_of_Positions'] ?? ''), 'Skills' => migAny($it['Required_Skills'] ?? ''), 'Status' => migAny($it['Job_Opening_Status'] ?? ''), 'Description' => migAny($it['Job_Description'] ?? ''), 'Contact name' => migAny($it['Contact_Name'] ?? ''), 'Owner' => $own],
                    'Clients' => ['Client name' => migAny($it['Client_Name'] ?? ''), 'Website' => migAny($it['Website'] ?? ''), 'Location' => $loc, 'Notes' => migAny($it['About'] ?? '', $it['Description'] ?? '')],
                    'Contacts' => ['First name' => migAny($it['First_Name'] ?? ''), 'Last name' => migAny($it['Last_Name'] ?? ''), 'Email' => migAny($it['Email'] ?? ''), 'Phone' => migAny($it['Mobile'] ?? '', $it['Work_Phone'] ?? '', $it['Phone'] ?? ''), 'Title' => migAny($it['Job_Title'] ?? '', $it['Title'] ?? '', $it['Designation'] ?? ''), 'Company' => migAny($it['Client_Name'] ?? '', $it['Account_Name'] ?? ''), 'Source' => migAny($it['Lead_Source'] ?? '', $it['Source'] ?? '', $n), 'Owner' => $own, 'Notes' => migAny($it['Description'] ?? '')],
                    'Accounts' => ['Company' => migAny($it['Account_Name'] ?? ''), 'Website' => migAny($it['Website'] ?? ''), 'Industry' => migAny($it['Industry'] ?? ''), 'Company type' => migAny($it['Account_Type'] ?? ''), 'Location' => $loc, 'Owner' => $own, 'Source' => 'Zoho CRM', 'Notes' => migAny($it['Description'] ?? '')],
                    default => ['First name' => migAny($it['First_Name'] ?? ''), 'Last name' => migAny($it['Last_Name'] ?? ''), 'Company' => migAny($it['Company'] ?? ''), 'Title' => migAny($it['Designation'] ?? ''), 'Email' => migAny($it['Email'] ?? ''), 'Phone' => migAny($it['Phone'] ?? '', $it['Mobile'] ?? ''), 'Source' => migAny($it['Lead_Source'] ?? '', 'Zoho CRM'), 'Status' => migAny($it['Lead_Status'] ?? ''), 'Industry' => migAny($it['Industry'] ?? ''), 'Location' => $loc, 'Owner' => $own, 'Notes' => migAny($it['Description'] ?? '')],
                };
                $rows[] = $base + ($src === 'zohorecruit' ? migExtra($n, $it, ['First_Name', 'Last_Name', 'Email', 'Mobile', 'Phone', 'Current_Job_Title', 'Skill_Set', 'City', 'State', 'Country', 'Experience_in_Years', 'LinkedIn__s', 'Source', 'Candidate_Status', 'Current_Employer', 'Candidate_Owner', 'Job_Opening_Name', 'Posting_Title', 'Job_Opening_ID', 'Client_Name', 'Number_of_Positions', 'Required_Skills', 'Job_Opening_Status', 'Job_Description', 'Contact_Name', 'Assigned_Recruiter', 'Account_Manager', 'Website', 'About', 'Description', 'Work_Phone', 'Job_Title', 'Owner', 'Created_Time', 'Modified_Time', 'Created_By', 'Modified_By']) : []) + [$n . ' ID' => (string) ($it['id'] ?? '')];
            }
            $info = (array) ($r['info'] ?? []);
            if (empty($info['more_records'])) {
                $st['cur'] = null;
            } elseif ($src === 'zohocrm' && (string) ($info['next_page_token'] ?? '') !== '') {
                $st['cur'] = (string) $info['next_page_token'];
            } else {
                $st['page'] = $page + 1;
                $st['cur'] = '';
            }
            return $rows;

        case 'bullhorn':
            [$bh, $rest] = migBullhorn($c, $st);
            $start = (int) ($cur !== '' ? $cur : 0);
            $ent = ['candidates' => 'Candidate', 'jobs' => 'JobOrder', 'clients' => 'ClientCorporation', 'contacts' => 'ClientContact'][$set];
            $fields = [
                'Candidate' => 'id,firstName,lastName,email,phone,mobile,occupation,companyName,address,skillSet,status,source,owner,dateAdded,dateLastModified',
                'JobOrder' => 'id,title,clientCorporation,address,status,isOpen,publicDescription,numOpenings,employmentType,owner,dateAdded',
                'ClientCorporation' => 'id,name,address,status,companyURL,dateAdded',
                'ClientContact' => 'id,firstName,lastName,email,phone,occupation,clientCorporation,owner,dateAdded',
            ][$ent];
            $since8 = $since !== '' ? gmdate('Ymd', (int) strtotime($since . ' 00:00:00 UTC')) : '';
            if ($ent === 'ClientCorporation') {
                $url = $rest . 'query/ClientCorporation?' . http_build_query(['where' => 'id>0' . ($since !== '' ? ' AND dateLastModified>=' . (strtotime($since . ' 00:00:00 UTC') * 1000) : ''), 'fields' => $fields, 'orderBy' => 'id', 'start' => $start, 'count' => 200]);
            } else {
                $query = ($ent === 'Candidate' || $ent === 'ClientContact' ? 'isDeleted:0' : 'isDeleted:false') . ($since8 !== '' ? ' AND dateLastModified:[' . $since8 . ' TO *]' : '');
                $url = $rest . 'search/' . $ent . '?' . http_build_query(['query' => $query, 'fields' => $fields, 'sort' => 'id', 'start' => $start, 'count' => 200]);
            }
            [$code, $r] = migHttp('GET', $url, ['BhRestToken: ' . $bh]);
            if ($code === 401) {
                // the session lapsed: once more with a new one
                unset($st['bh']);
                [$bh, $rest] = migBullhorn($c, $st);
                [$code, $r] = migHttp('GET', $url, ['BhRestToken: ' . $bh]);
            }
            if ($code !== 200 || !is_array($r)) {
                migFail($src, $r, $code, strtolower($ent));
            }
            foreach ((array) ($r['data'] ?? []) as $it) {
                $a = (array) ($it['address'] ?? []);
                $loc = migJoin($a['city'] ?? '', $a['state'] ?? '', $a['countryName'] ?? ($a['countryCode'] ?? ''));
                $own = trim(((string) ($it['owner']['firstName'] ?? '')) . ' ' . ((string) ($it['owner']['lastName'] ?? '')));
                $rows[] = match ($ent) {
                    'Candidate' => ['First name' => migAny($it['firstName'] ?? ''), 'Last name' => migAny($it['lastName'] ?? ''), 'Email' => migAny($it['email'] ?? ''), 'Phone' => migAny($it['mobile'] ?? '', $it['phone'] ?? ''), 'Current title' => migAny($it['occupation'] ?? ''), 'Skills' => migAny($it['skillSet'] ?? ''), 'Location' => $loc, 'Source' => migAny($it['source'] ?? '', 'Bullhorn'), $n . ' · Status' => migAny($it['status'] ?? ''), $n . ' · Company' => migAny($it['companyName'] ?? ''), 'Owner' => $own, $n . ' ID' => (string) ($it['id'] ?? '')],
                    'JobOrder' => ['Job title' => migAny($it['title'] ?? ''), 'Job ID' => 'BH-' . (string) ($it['id'] ?? ''), 'Client' => (string) ($it['clientCorporation']['name'] ?? ''), 'Location' => $loc, 'Openings' => migAny($it['numOpenings'] ?? ''), 'Engagement' => migAny($it['employmentType'] ?? ''), 'Status' => !empty($it['isOpen']) ? 'Open' : migAny($it['status'] ?? '', 'Closed'), 'Description' => migAny($it['publicDescription'] ?? ''), 'Owner' => $own],
                    'ClientCorporation' => ['Client name' => migAny($it['name'] ?? ''), 'Website' => migAny($it['companyURL'] ?? ''), 'Location' => $loc, $n . ' · Status' => migAny($it['status'] ?? ''), $n . ' ID' => (string) ($it['id'] ?? '')],
                    default => ['First name' => migAny($it['firstName'] ?? ''), 'Last name' => migAny($it['lastName'] ?? ''), 'Email' => migAny($it['email'] ?? ''), 'Phone' => migAny($it['phone'] ?? ''), 'Title' => migAny($it['occupation'] ?? ''), 'Company' => (string) ($it['clientCorporation']['name'] ?? ''), 'Source' => 'Bullhorn', 'Owner' => $own, $n . ' ID' => (string) ($it['id'] ?? '')],
                };
            }
            $got = count((array) ($r['data'] ?? []));
            $total = (int) ($r['total'] ?? ($r['count'] ?? 0));
            $st['cur'] = $got > 0 && ($ent === 'ClientCorporation' ? $got >= 200 : $start + $got < $total) ? (string) ($start + $got) : null;
            return $rows;

        case 'workable':
            $sub = strtolower((string) preg_replace('/[^a-z0-9-]/i', '', (string) ($c['sub'] ?? '')));
            $auth = ['Authorization: Bearer ' . (string) ($c['token'] ?? '')];
            $url = $cur !== '' ? (string) $cur : 'https://' . $sub . '.workable.com/spi/v3/' . ($set === 'jobs' ? 'jobs?' . http_build_query(['limit' => 100, 'include_fields' => 'description']) : 'candidates?' . http_build_query(['limit' => 100] + ($since !== '' ? ['updated_after' => migIso($since)] : [])));
            if (!str_starts_with($url, 'https://' . $sub . '.workable.com/') && !str_starts_with($url, 'https://www.workable.com/')) {
                migFail($src, 'unexpected next page address', 0);
            }
            [$code, $r] = migHttp('GET', $url, $auth);
            if ($code !== 200 || !is_array($r)) {
                migFail($src, $r, $code, $set);
            }
            foreach ((array) ($r[$set === 'jobs' ? 'jobs' : 'candidates'] ?? []) as $it) {
                $l = (array) ($it['location'] ?? []);
                $rows[] = $set === 'jobs'
                    ? ['Job title' => migAny($it['title'] ?? ''), 'Job ID' => migAny($it['shortcode'] ?? ''), 'Location' => migJoin($l['city'] ?? '', $l['region'] ?? '', $l['country'] ?? ''), 'Remote / onsite' => ['remote' => 'Remote', 'hybrid' => 'Hybrid', 'on_site' => 'Onsite'][(string) ($l['workplace_type'] ?? '')] ?? '', 'Status' => migAny($it['state'] ?? ''), 'Description' => trim(html_entity_decode(strip_tags((string) preg_replace('#<(br|/p|/li)[^>]*>#i', "\n", (string) ($it['description'] ?? $it['full_description'] ?? ''))), ENT_QUOTES)), $n . ' · Department' => migAny($it['department'] ?? '')]
                    : ['First name' => migAny($it['firstname'] ?? ''), 'Last name' => migAny($it['lastname'] ?? ''), 'Name' => migAny($it['name'] ?? ''), 'Email' => migAny($it['email'] ?? ''), 'Phone' => migAny($it['phone'] ?? ''), 'Current title' => migAny($it['headline'] ?? ''), 'Location' => migAny($it['address'] ?? ''), 'Source' => 'Workable', $n . ' · Job' => migAny($it['job']['title'] ?? ''), $n . ' · Stage' => migAny($it['stage'] ?? '') . (!empty($it['disqualified']) ? ' (disqualified)' : ''), $n . ' ID' => (string) ($it['id'] ?? '')];
            }
            $st['cur'] = (string) ($r['paging']['next'] ?? '') !== '' ? (string) $r['paging']['next'] : null;
            usleep(1050000); // 10 requests in 10 seconds
            return $rows;

        case 'greenhouse':
            if (empty($st['tok']) || (int) ($st['exp'] ?? 0) < time() + 60) {
                [$code, $r] = migHttp('POST', 'https://auth.greenhouse.io/token', ['Authorization: Basic ' . base64_encode((string) ($c['id'] ?? '') . ':' . (string) ($c['secret'] ?? ''))], ['__form' => ['grant_type' => 'client_credentials']]);
                if ($code !== 200 || !is_array($r) || empty($r['access_token'])) {
                    migFail($src, $r, $code === 200 || $code === 400 ? 401 : $code);
                }
                $st['tok'] = (string) $r['access_token'];
                $st['exp'] = time() + (int) ($r['expires_in'] ?? 3600);
            }
            $url = $cur !== '' ? (string) $cur : 'https://harvest.greenhouse.io/v3/' . ($set === 'jobs' ? 'jobs' : 'candidates') . '?' . http_build_query(['per_page' => 500] + ($since !== '' ? ['updated_at' => 'gte|' . migIso($since)] : []));
            if (!str_starts_with($url, 'https://harvest.greenhouse.io/')) {
                migFail($src, 'unexpected next page address', 0);
            }
            [$code, $r, $h] = migHttp('GET', $url, ['Authorization: Bearer ' . $st['tok']]);
            if ($code !== 200 || !is_array($r)) {
                migFail($src, $r, $code, $set);
            }
            $list = array_is_list($r) ? $r : (array) ($r['data'] ?? ($r[$set] ?? []));
            foreach ($list as $it) {
                if (!is_array($it)) {
                    continue;
                }
                if ($set === 'jobs') {
                    $rows[] = ['Job title' => migAny($it['name'] ?? '', $it['title'] ?? ''), 'Job ID' => migAny($it['requisition_id'] ?? '', 'GH-' . (string) ($it['id'] ?? '')), 'Location' => migAny(array_map(fn($o) => is_array($o) ? (string) ($o['name'] ?? '') : '', (array) ($it['offices'] ?? []))), 'Status' => migAny($it['status'] ?? ''), $n . ' · Department' => migAny(array_map(fn($o) => is_array($o) ? (string) ($o['name'] ?? '') : '', (array) ($it['departments'] ?? [])))] + migExtra($n, $it, ['name', 'title', 'requisition_id', 'offices', 'departments', 'status', 'id']);
                    continue;
                }
                $mail = $it['email_addresses'] ?? ($it['emails'] ?? []);
                $tel = $it['phone_numbers'] ?? ($it['phones'] ?? []);
                $web = array_merge((array) ($it['website_addresses'] ?? []), (array) ($it['social_media_addresses'] ?? []));
                $li = '';
                foreach ($web as $w) {
                    $v = is_array($w) ? (string) ($w['value'] ?? '') : (string) $w;
                    if (stripos($v, 'linkedin.com') !== false) {
                        $li = $v;
                    }
                }
                $rows[] = ['First name' => migAny($it['first_name'] ?? ''), 'Last name' => migAny($it['last_name'] ?? ''), 'Email' => migAny($mail), 'Phone' => migAny($tel), 'Current title' => migAny($it['title'] ?? ''), 'LinkedIn' => $li, 'Tags' => is_array($it['tags'] ?? null) ? implode(', ', array_map(fn($t) => is_array($t) ? (string) ($t['name'] ?? '') : (string) $t, $it['tags'])) : '', 'Source' => 'Greenhouse', $n . ' · Company' => migAny($it['company'] ?? ''), $n . ' ID' => (string) ($it['id'] ?? '')] + migExtra($n, $it, ['first_name', 'last_name', 'email_addresses', 'emails', 'phone_numbers', 'phones', 'title', 'company', 'website_addresses', 'social_media_addresses', 'tags', 'addresses', 'attachments', 'applications', 'id', 'photo_url']);
            }
            $next = '';
            if (preg_match('/<([^>]+)>\s*;\s*rel="?next"?/i', (string) ($h['link'] ?? ''), $m)) {
                $next = $m[1];
            }
            $st['cur'] = $next !== '' ? $next : null;
            usleep(200000);
            return $rows;

        case 'lever':
            $auth = ['Authorization: Basic ' . base64_encode((string) ($c['token'] ?? '') . ':')];
            $q = $set === 'postings'
                ? 'limit=100' . ($cur !== '' ? '&offset=' . rawurlencode((string) $cur) : '')
                : 'limit=100&expand=owner&expand=stage' . ($cur !== '' ? '&offset=' . rawurlencode((string) $cur) : '') . ($since !== '' ? '&updated_at_start=' . (strtotime($since . ' 00:00:00 UTC') * 1000) : '');
            [$code, $r] = migHttp('GET', 'https://api.lever.co/v1/' . ($set === 'postings' ? 'postings' : 'opportunities') . '?' . $q, $auth);
            if ($code !== 200 || !is_array($r)) {
                migFail($src, $r, $code, $set === 'postings' ? 'postings' : 'opportunities');
            }
            foreach ((array) ($r['data'] ?? []) as $it) {
                if ($set === 'postings') {
                    $cat = (array) ($it['categories'] ?? []);
                    $rows[] = ['Job title' => migAny($it['text'] ?? ''), 'Job ID' => 'LV-' . substr((string) ($it['id'] ?? ''), 0, 8), 'Location' => migAny($cat['location'] ?? ''), 'Engagement' => migAny($cat['commitment'] ?? ''), 'Status' => migAny($it['state'] ?? ''), 'Description' => migAny($it['content']['description'] ?? '', strip_tags((string) ($it['content']['descriptionHtml'] ?? ''))), $n . ' · Team' => migAny($cat['team'] ?? '', $cat['department'] ?? '')];
                    continue;
                }
                $li = '';
                foreach ((array) ($it['links'] ?? []) as $lk) {
                    if (stripos((string) $lk, 'linkedin.com') !== false) {
                        $li = (string) $lk;
                    }
                }
                $rows[] = ['Name' => migAny($it['name'] ?? ''), 'Email' => migAny($it['emails'] ?? []), 'Phone' => migAny($it['phones'] ?? []), 'Current title' => migAny($it['headline'] ?? ''), 'Location' => migAny($it['location'] ?? ''), 'LinkedIn' => $li, 'Tags' => implode(', ', array_map('strval', (array) ($it['tags'] ?? []))), 'Source' => migAny(implode(', ', array_map('strval', (array) ($it['sources'] ?? []))), 'Lever'), $n . ' · Stage' => is_array($it['stage'] ?? null) ? (string) ($it['stage']['text'] ?? '') : '', $n . ' · Owner' => is_array($it['owner'] ?? null) ? (string) ($it['owner']['name'] ?? '') : '', $n . ' ID' => (string) ($it['id'] ?? '')];
            }
            $st['cur'] = !empty($r['hasNext']) && (string) ($r['next'] ?? '') !== '' ? (string) $r['next'] : null;
            usleep(150000);
            return $rows;

        case 'manatal':
            $auth = ['Authorization: Token ' . (string) ($c['token'] ?? '')];
            $path = ['candidates' => 'candidates', 'jobs' => 'jobs', 'orgs' => 'organizations', 'contacts' => 'contacts'][$set];
            $url = $cur !== '' ? (string) $cur : 'https://api.manatal.com/open/v3/' . $path . '/?' . http_build_query(['page_size' => 100] + ($since !== '' ? ['updated_at__gte' => migIso($since)] : []));
            if (!str_starts_with($url, 'https://api.manatal.com/')) {
                migFail($src, 'unexpected next page address', 0);
            }
            [$code, $r] = migHttp('GET', $url, $auth);
            if ($code !== 200 || !is_array($r)) {
                migFail($src, $r, $code, $path);
            }
            if ($set === 'jobs' && !isset($st['orgs'])) {
                $st['orgs'] = [];
            }
            foreach ((array) ($r['results'] ?? []) as $it) {
                $rows[] = match ($set) {
                    'candidates' => ['Name' => migAny($it['full_name'] ?? ''), 'Email' => migAny($it['email'] ?? ''), 'Phone' => migAny($it['phone_number'] ?? ''), 'Current title' => migAny($it['current_position'] ?? ''), 'Location' => migAny($it['address'] ?? ''), 'LinkedIn' => migAny($it['linkedin_url'] ?? '', $it['linkedin'] ?? ''), 'Source' => migAny($it['source_type'] ?? '', 'Manatal'), $n . ' · Company' => migAny($it['current_company'] ?? ''), $n . ' ID' => (string) ($it['id'] ?? '')],
                    'jobs' => ['Job title' => migAny($it['position_name'] ?? ''), 'Job ID' => 'MN-' . (string) ($it['id'] ?? ''), 'Client' => is_array($it['organization'] ?? null) ? (string) ($it['organization']['name'] ?? '') : '', 'Location' => migAny($it['address'] ?? '', migJoin($it['city'] ?? '', $it['state'] ?? '')), 'Remote / onsite' => !empty($it['is_remote']) ? 'Remote' : '', 'Status' => migAny($it['status'] ?? ''), 'Description' => trim(strip_tags((string) ($it['description'] ?? '')))],
                    'orgs' => ['Client name' => migAny($it['name'] ?? ''), 'Website' => migAny($it['website'] ?? ''), 'Location' => migAny($it['address'] ?? '')],
                    default => ['Name' => migAny($it['full_name'] ?? ''), 'Email' => migAny($it['email'] ?? ''), 'Phone' => migAny($it['phone_number'] ?? ''), 'Title' => migAny($it['position'] ?? '', $it['title'] ?? ''), 'Company' => is_array($it['organization'] ?? null) ? (string) ($it['organization']['name'] ?? '') : '', 'Source' => 'Manatal', $n . ' ID' => (string) ($it['id'] ?? '')],
                };
            }
            $st['cur'] = (string) ($r['next'] ?? '') !== '' ? (string) $r['next'] : null;
            usleep(650000); // 100 requests a minute
            return $rows;

        case 'recruitcrm':
            $auth = ['Authorization: Bearer ' . (string) ($c['token'] ?? '')];
            $page = max(1, (int) ($cur !== '' ? $cur : 1));
            [$code, $r] = migHttp('GET', 'https://api.recruitcrm.io/v1/' . $set . '?page=' . $page, $auth);
            if ($code !== 200 || !is_array($r)) {
                migFail($src, $r, $code, $set);
            }
            foreach ((array) ($r['data'] ?? []) as $it) {
                $rows[] = match ($set) {
                    'candidates' => ['First name' => migAny($it['first_name'] ?? ''), 'Last name' => migAny($it['last_name'] ?? ''), 'Email' => migAny($it['email'] ?? ''), 'Phone' => migAny($it['contact_number'] ?? ''), 'Current title' => migAny($it['position'] ?? ''), 'Skills' => migAny($it['skill'] ?? ''), 'Location' => migJoin($it['city'] ?? '', $it['state'] ?? '', $it['country'] ?? ''), 'LinkedIn' => migAny($it['linkedin'] ?? ''), 'Source' => migAny($it['source'] ?? '', 'Recruit CRM'), $n . ' · Company' => migAny($it['current_organization'] ?? ''), $n . ' ID' => (string) ($it['slug'] ?? '')],
                    'jobs' => ['Job title' => migAny($it['name'] ?? ''), 'Job ID' => 'RC-' . (string) ($it['slug'] ?? ''), 'Client' => migAny($it['company']['name'] ?? '', $it['company_name'] ?? ''), 'Location' => migJoin($it['city'] ?? '', $it['state'] ?? '', $it['country'] ?? ''), 'Status' => migAny($it['job_status']['label'] ?? '', $it['job_status'] ?? ''), 'Description' => migAny($it['job_description_text'] ?? '')],
                    'companies' => ['Client name' => migAny($it['company_name'] ?? '', $it['name'] ?? ''), 'Website' => migAny($it['website'] ?? ''), 'Location' => migJoin($it['city'] ?? '', $it['state'] ?? '', $it['country'] ?? ''), 'Notes' => migAny($it['about_company'] ?? '')],
                    default => ['First name' => migAny($it['first_name'] ?? ''), 'Last name' => migAny($it['last_name'] ?? ''), 'Email' => migAny($it['email'] ?? ''), 'Phone' => migAny($it['contact_number'] ?? ''), 'Title' => migAny($it['designation'] ?? '', $it['position'] ?? ''), 'Company' => migAny($it['company']['name'] ?? '', $it['company_name'] ?? ''), 'Source' => 'Recruit CRM', $n . ' ID' => (string) ($it['slug'] ?? '')],
                };
            }
            $st['cur'] = (string) ($r['next_page_url'] ?? '') !== '' && count((array) ($r['data'] ?? [])) > 0 ? (string) ($page + 1) : null;
            usleep(1050000); // 60 requests a minute
            return $rows;
    }
    fail(400, 'invalid_argument', 'That system cannot be read here.');
}

/** Checks the keys with one small read (a refusal ends the request with what is wrong). */
function migCheck(string $src, array $c): void
{
    $set = array_key_first(migSources()[$src]['sets']);
    $st = ['cur' => '', 'since' => '', 'probe' => true];
    migPage($src, $set, $c, $st);
}

/* ---------------------------------------------------------------- routes */

function migRoute(string $r, array $b): never
{
    $u = requireUser();
    if (!hasRole($u, 'admin')) {
        fail(403, 'forbidden', 'Connecting another system is for administrators.');
    }
    $S = migSources();
    switch ($r) {
        case 'mig_list':
            $allowed = impAllowed($u);
            $out = [];
            foreach ($S as $k => $s) {
                $sets = [];
                foreach ((array) ($s['sets'] ?? []) as $sk => [$sn, $tk]) {
                    if (in_array($tk, $allowed, true)) {
                        $sets[] = ['k' => $sk, 'n' => $sn, 'tk' => $tk];
                    }
                }
                $kinds = isset($s['manual']) ? array_values(array_intersect((array) $s['kinds'], $allowed)) : array_values(array_unique(array_column($sets, 'tk')));
                if (!$kinds) {
                    continue;
                }
                $c = isset($s['manual']) ? null : migConn($k);
                $out[] = [
                    'k' => $k, 'n' => $s['n'], 'what' => $s['what'], 'kinds' => $kinds, 'sets' => $sets, 'manual' => (string) ($s['manual'] ?? ''), 'help' => (string) ($s['help'] ?? ''),
                    'f' => array_map(fn($f) => ['k' => $f[0], 'l' => $f[1], 't' => $f[2], 'h' => $f[3], 'v' => $c && $f[2] !== 'secret' ? (string) ($c['cred'][$f[0]] ?? '') : '', 'has' => $c && (string) ($c['cred'][$f[0] === 'code' ? 'refresh' : $f[0]] ?? '') !== ''], (array) ($s['f'] ?? [])),
                    'conn' => $c ? ['at' => $c['at'], 'by' => $c['by'], 'err' => $c['err'], 'last' => $c['last']] : null,
                ];
            }
            ok(['sources' => $out, 'dcs' => MIG_ZDC]);

        case 'mig_save':
            $src = str($b, 'src', 20);
            if (!isset($S[$src]) || isset($S[$src]['manual'])) {
                fail(400, 'invalid_argument', 'That system cannot be connected here.');
            }
            if (throttleHit('migsave:' . $u['id'], 30, 3600)) {
                fail(429, 'rate_limited', 'Too many tries in an hour. Try again a little later.');
            }
            $old = migConn($src);
            $in = is_array($b['cred'] ?? null) ? $b['cred'] : [];
            $cred = [];
            foreach ($S[$src]['f'] as [$fk, $fl, $ft]) {
                $v = trim((string) ($in[$fk] ?? ''));
                if ($v === '' && $ft === 'secret' && $old) {
                    $v = (string) ($old['cred'][$fk] ?? '');
                }
                if ($ft === 'dc' && !isset(MIG_ZDC[$v])) {
                    $v = 'com';
                }
                $cred[$fk] = mb_substr($v, 0, 2000);
            }
            if (in_array($src, ['zohocrm', 'zohorecruit'], true)) {
                // the grant code from Zoho's API console is changed for a lasting refresh token now (it works once)
                $code = (string) ($in['code'] ?? '');
                unset($cred['code']);
                $cred['refresh'] = (string) ($old['cred']['refresh'] ?? '');
                if ($code !== '') {
                    $acc = $cred['dc'] === 'ca' ? 'https://accounts.zohocloud.ca' : 'https://accounts.zoho.' . $cred['dc'];
                    [$hc, $tr] = migHttp('POST', $acc . '/oauth/v2/token', [], ['__form' => ['grant_type' => 'authorization_code', 'client_id' => $cred['id'], 'client_secret' => $cred['secret'], 'code' => $code]]);
                    if ($hc !== 200 || !is_array($tr) || empty($tr['refresh_token'])) {
                        fail(400, 'invalid_argument', 'Zoho did not change the grant code for access (' . migWhy($tr, $hc) . '). A code works once and only for the minutes chosen: generate a new one and paste it right away, on the data center your account is on.');
                    }
                    $cred['refresh'] = (string) $tr['refresh_token'];
                }
                if ($cred['refresh'] === '') {
                    fail(400, 'invalid_argument', 'Paste the grant code from Zoho\'s API console.');
                }
            }
            foreach ($S[$src]['f'] as [$fk, $fl, $ft]) {
                if ($fk !== 'code' && $fk !== 'redirect' && ($cred[$fk] ?? '') === '') {
                    fail(400, 'invalid_argument', 'Fill in ' . strtolower($fl) . '.');
                }
            }
            migCheck($src, $cred);
            migConnSave($src, $cred, (string) $u['name']);
            audit('settings', 'Connected ' . $S[$src]['n'] . ' for importing', $src, [], $u);
            ok(['ok' => true]);

        case 'mig_check':
            $src = str($b, 'src', 20);
            $c = migConn($src);
            if (!$c || !isset($S[$src])) {
                fail(404, 'not_found', 'That system is not connected.');
            }
            migCheck($src, $c['cred']);
            migNote($src, '');
            ok(['ok' => true]);

        case 'mig_drop':
            $src = str($b, 'src', 20);
            migDb()->prepare('DELETE FROM mig_conn WHERE src = ?')->execute([$src]);
            audit('settings', 'Disconnected ' . ($S[$src]['n'] ?? $src) . ' (importing)', $src, [], $u);
            ok(['ok' => true]);

        case 'mig_pull':
        case 'mig_more':
            session_write_close();
            @set_time_limit(120);
            $pdo = migDb();
            if ($r === 'mig_pull') {
                $src = str($b, 'src', 20);
                $set = str($b, 'set', 20);
                if (!isset($S[$src]['sets'][$set])) {
                    fail(400, 'invalid_argument', 'Pick what to bring.');
                }
                $tk = $S[$src]['sets'][$set][1];
                impTarget($tk, $u);
                if (!migConn($src)) {
                    fail(404, 'not_found', 'Connect ' . $S[$src]['n'] . ' first.');
                }
                if (throttleHit('migpull:' . $u['id'], 120, 3600)) {
                    fail(429, 'rate_limited', 'That is a lot of pulls in an hour. Try again a little later.');
                }
                $since = str($b, 'since', 10);
                if ($since !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $since)) {
                    fail(400, 'invalid_argument', 'Pick the date as year-month-day.');
                }
                $id = 'g' . rid(9);
                $pdo->prepare('INSERT INTO mig_pulls (id, uid, src, sset, tk, st, n, at, data) VALUES (?,?,?,?,?,?,?,?,?)')->execute([$id, $u['id'], $src, $set, $tk, 'going', 0, now(), mailSeal((string) json_encode(['cur' => '', 'since' => $since, 'k' => 0]))]);
                // pulls left behind for a day are cleared
                $old = $pdo->prepare('SELECT id FROM mig_pulls WHERE at < ?');
                $old->execute([now() - 86400000]);
                foreach ($old->fetchAll(PDO::FETCH_COLUMN) as $oid) {
                    impDb()->prepare('DELETE FROM imp_rows WHERE run = ?')->execute([$oid]);
                    $pdo->prepare('DELETE FROM mig_pulls WHERE id = ?')->execute([$oid]);
                }
            } else {
                $id = str($b, 'id', 24);
            }
            $q = $pdo->prepare('SELECT * FROM mig_pulls WHERE id = ? AND uid = ?');
            $q->execute([$id, $u['id']]);
            $P = $q->fetch();
            if (!$P) {
                fail(404, 'not_found', 'That pull is gone. Start it again.');
            }
            if ($P['st'] !== 'going') {
                fail(409, 'conflict', 'That pull has finished.');
            }
            if (!empty($b['stop'])) {
                impDb()->prepare('DELETE FROM imp_rows WHERE run = ?')->execute([$id]);
                $pdo->prepare('DELETE FROM mig_pulls WHERE id = ?')->execute([$id]);
                ok(['stopped' => true]);
            }
            $src = (string) $P['src'];
            $set = (string) $P['sset'];
            $c = migConn($src);
            if (!$c) {
                fail(404, 'not_found', 'That system is not connected any more.');
            }
            $st = json_decode(mailUnseal((string) $P['data']), true) ?: ['cur' => '', 'since' => '', 'k' => 0];
            $n = (int) $P['n'];
            $t0 = microtime(true);
            $done = false;
            $more = false;
            while (microtime(true) - $t0 < MIG_SECS) {
                $rows = migPage($src, $set, $c['cred'], $st);
                if ($rows) {
                    $rows = array_slice($rows, 0, max(0, IMP_MAX_ROWS - $n));
                    impRowsPut($id, 'g', (int) $st['k'], $rows);
                    $st['k'] = (int) $st['k'] + 1;
                    $n += count($rows);
                }
                if ($st['cur'] === null || $n >= IMP_MAX_ROWS) {
                    $more = $st['cur'] !== null;
                    $done = true;
                    break;
                }
            }
            if (!$done) {
                $pdo->prepare('UPDATE mig_pulls SET n = ?, data = ? WHERE id = ?')->execute([$n, mailSeal((string) json_encode($st)), $id]);
                ok(['id' => $id, 'n' => $n, 'done' => false]);
            }
            // all of it: one sheet (the usual columns first, then the rest in order of use) for Import with preview
            $all = impRowsGet($id, 'g');
            impDb()->prepare('DELETE FROM imp_rows WHERE run = ?')->execute([$id]);
            $pdo->prepare('DELETE FROM mig_pulls WHERE id = ?')->execute([$id]);
            migNote($src, '', true);
            if (!$all) {
                ok(['id' => $id, 'n' => 0, 'done' => true, 'run' => null, 'none' => true]);
            }
            $use = [];
            foreach ($all as $row) {
                foreach ($row as $h => $v) {
                    if ((string) $v !== '') {
                        $use[$h] = ($use[$h] ?? 0) + 1;
                    }
                }
            }
            $heads = array_slice(array_keys($use), 0, IMP_MAX_COLS);
            // a sheet's rows are [line number, cells...], as a file's are
            $sheet = [array_merge([1], $heads)];
            foreach ($all as $i => $row) {
                $sheet[] = array_merge([$i + 2], array_map(fn($h) => mb_substr((string) ($row[$h] ?? ''), 0, IMP_CELL), $heads));
            }
            $tk = (string) $P['tk'];
            $name = $S[$src]['n'] . ' · ' . $S[$src]['sets'][$set][0] . ($st['since'] !== '' ? ' changed since ' . $st['since'] : '');
            $runId = impRunFromSheets($u, $tk, impTarget($tk, $u), [['n' => $S[$src]['sets'][$set][0], 'hidden' => false, 'rows' => $sheet, 'more' => $more]], $name, 0, false, ['from' => $src]);
            audit('data', 'Brought ' . count($all) . ' ' . strtolower($S[$src]['sets'][$set][0]) . ' from ' . $S[$src]['n'] . ' into an import (not saved yet)', $runId, [], $u);
            ok(['id' => $id, 'n' => count($all), 'done' => true, 'more' => $more, 'run' => impView(impRun($runId, $u), $u)]);
    }
    fail(404, 'not_found', 'Unknown action.');
}
