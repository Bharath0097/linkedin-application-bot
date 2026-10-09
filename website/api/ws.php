<?php
declare(strict_types=1);
/*
 * v37 StratEdge Workspaces: other companies get their own portal on this installation. The same code serves every
 * workspace; each has its own data folder, storage/ws/<name>/ (database, uploaded files, encryption key, search
 * index, logs, backups), so no workspace can read another's data and StratEdge's own data stays where it always was
 * (storage/). A request belongs to a workspace by its address:
 *   https://stratedgeitconsulting.com/w/<name>/    works at once (rewritten to the same files by .htaccess)
 *   https://<name>.stratedgeitconsulting.com/      once the wildcard subdomain is set up on the hosting
 *   https://portal.theircompany.com/               their own domain, pointed here and added on the hosting
 * Any other address is StratEdge's own site (the provider). The registry (storage/ws/registry.json, written by the
 * provider console in api/wsadmin.php) holds what a request needs: name, status, addresses, brand and features.
 * Settings that differ per workspace come from cfg(): the database, the files folder, the key folder, the session
 * name, the site address, who receives staff emails, the From name (see wsOverlay).
 */
const WS_SLUG_RE = '/^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/';
const WS_RESERVED = ['www', 'w', 'api', 'app', 'apps', 'admin', 'mail', 'email', 'smtp', 'imap', 'pop', 'pop3', 'ftp', 'sftp', 'cpanel', 'webmail', 'whm', 'webdisk', 'ns', 'ns1', 'ns2', 'ns3', 'mx', 'portal', 'portals', 'stratedge', 'static', 'assets', 'cdn', 'files', 'storage', 'help', 'support', 'status', 'blog', 'docs', 'test', 'dev', 'staging', 'autodiscover', 'autoconfig', 'localhost', 'cpcalendars', 'cpcontacts', 'login', 'secure', 'billing', 'careers', 'jobs'];
// parts of the portal a workspace can have, with the server routes that belong to each (matched as prefixes). Routes
// every portal needs (sign-in, records, files, settings, security, the scheduled task) belong to none and stay open.
const WS_FEATURES = [
    'recruiting' => ['n' => 'Recruiting', 'd' => 'ATS and careers page, talent search, requirements desk, bench desk, vendors and clients, marketplace, tailoring, ID checks, consultants\' job matching', 'routes' => ['ats_', 'cal_', 'ag_', 'ts_', 'cx_', 'src_', 'vms_', 'rs_', 'mkt_', 'bd_', 'tl_', 'ids_', 'idq_', 'ab_', 'rules_', 'apply_', 'eod_notify', 'job_recipients', 'job_send', 'jobs_admin', 'jobs_apply', 'jobs_apps', 'jobs_job', 'jobs_mark', 'jobs_matches', 'jobs_me', 'jobs_prefs', 'jobs_rematch', 'jobs_resume', 'jobs_tick']],
    'hr' => ['n' => 'HR', 'd' => 'Onboarding, HRMS, goals and reviews, compliance and immigration cases, document checks, policies, e-signatures', 'routes' => ['comp_', 'sig_', 'hrq_', 'pf_', 'im_', 'imx_', 'es_']],
    'time' => ['n' => 'Time', 'd' => 'Attendance, timesheets, time off and approvals', 'routes' => ['punch']],
    'payroll' => ['n' => 'Payroll', 'd' => 'Pay runs, taxes and tax forms, direct deposit', 'routes' => ['pay_', 'ach_', 'dd_', 'taxdep_', 'my_w4_save', 'my_tax_form']],
    'books' => ['n' => 'Accounting', 'd' => 'Invoices, expenses and expense claims, bank, books, QuickBooks', 'routes' => ['acct_', 'books_', 'inv_', 'plaid_', 'qbo_', 'xc_']],
    'crm' => ['n' => 'Sales', 'd' => 'CRM, clients, ads, sequences, client talent requests and proposals', 'routes' => ['crm_', 'sq_', 'cr_', 'cq_', 'cw_', 'pub_cw']],
    'learning' => ['n' => 'Learning', 'd' => 'Courses, tests, certifications, practice calls, projects and the project vault', 'routes' => ['learn_', 'ex_', 'pr_', 'proj_', 'vault_']],
    'billing' => ['n' => 'Plans and payments', 'd' => 'Paid plans for students and outside consultants', 'routes' => ['bill_']],
    // v83: the shared inbox (mail_inbox*, not mail_inbound) and the sent log belong to this part too
    'mail' => ['n' => 'Email, inbox and campaigns', 'd' => 'Mass email, contacts, deliverability checks, each person\'s inbox', 'routes' => ['mail_campaign', 'mail_contact', 'mail_audience', 'mail_preview', 'mail_sources', 'mail_deliv', 'mail_check', 'mail_suppress', 'mail_unsuppress', 'mail_bounces', 'mail_bounce_sync', 'mail_content_check', 'mail_safety_save', 'mail_inbox', 'mail_log', 'mymail_', 'dl_']],
    'chat' => ['n' => 'Team messages', 'd' => 'Channels and direct messages', 'routes' => ['chat_']],
    'desk' => ['n' => 'Service desk', 'd' => 'Tickets, knowledge base and the help box', 'routes' => ['desk_', 'pub_support']],
    // v39: calls in the browser, incoming calls, voicemail, recordings and texts, through the company's own Twilio account
    'phone' => ['n' => 'Phone & texts', 'd' => 'Calls from the browser, incoming calls with voicemail, recordings and transcripts, and texts, through the company\'s own Twilio account', 'routes' => ['ph_', 'phw_']],
    // v40: My taxes, everyone's own refund estimate (federal and state), the return filled in on the IRS forms, withholding advice
    'tax' => ['n' => 'Personal tax center', 'd' => 'My taxes for everyone: a refund or amount-owed estimate from their paystubs and answers, the federal return filled in on the IRS forms, withholding and estimated payment advice, a refund tracker', 'routes' => ['tax_']],
    // v42: the team's agile pipeline (projects with boards, backlogs and sprints, stand-ups, retrospectives, reports)
    'work' => ['n' => 'Work boards', 'd' => 'Scrum and Kanban projects: boards with work-in-progress limits, backlog and sprints, stand-ups, retrospectives, burndown, velocity, flow and cycle-time reports, My work', 'routes' => ['wk_']],
];
// what a new workspace starts with (the provider changes it per workspace)
const WS_PRESETS = [
    'staffing' => ['n' => 'Staffing company (everything)', 'f' => ['recruiting', 'hr', 'time', 'payroll', 'books', 'crm', 'learning', 'mail', 'chat', 'desk', 'phone', 'tax', 'work']],
    'recruiting' => ['n' => 'Recruiting only', 'f' => ['recruiting', 'mail', 'chat', 'desk', 'phone']],
    'hr' => ['n' => 'HR, time and payroll', 'f' => ['hr', 'time', 'payroll', 'chat', 'desk', 'tax']],
];

function wsRoot(): string
{
    return dirname(__DIR__) . '/storage/ws';
}
/** The registry: name => entry. Read once per request. */
function wsRegistry(bool $fresh = false): array
{
    static $r = null;
    if ($r !== null && !$fresh) {
        return $r;
    }
    $f = wsRoot() . '/registry.json';
    $r = is_file($f) ? (json_decode((string) @file_get_contents($f), true) ?: []) : [];
    return $r;
}
/** Writes the registry in one step (a reader never sees half a file). */
function wsRegistrySave(array $reg): void
{
    $dir = wsRoot();
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    $tmp = $dir . '/registry.' . bin2hex(random_bytes(4)) . '.tmp';
    if (@file_put_contents($tmp, json_encode($reg, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT)) === false || !@rename($tmp, $dir . '/registry.json')) {
        @unlink($tmp);
        throw new RuntimeException('The workspace list could not be written (storage/ws must be writable).');
    }
    wsRegistry(true);
}
/** config.php as written (cfg() adds the workspace's own settings on top). */
function cfgRaw(): array
{
    static $c = null;
    if ($c === null) {
        $c = require __DIR__ . '/config.php';
    }
    return $c;
}
/** The provider's own host, from config.php site_url (without www.). */
function wsMainHost(): string
{
    $h = strtolower((string) (parse_url((string) (cfgRaw()['site_url'] ?? ''), PHP_URL_HOST) ?: ''));
    return str_starts_with($h, 'www.') ? substr($h, 4) : $h;
}
/** The workspace this request belongs to: null for StratEdge's own site; ['missing' => true] for an address that
 *  looks like a workspace but is not one (or was deleted). */
function wsCurrent(): ?array
{
    static $done = false;
    static $ws = null;
    if ($done) {
        return $ws;
    }
    $done = true;
    $slug = '';
    $mode = '';
    if (isset($GLOBALS['SE_WS_FORCE'])) {
        // the scheduled task (api/cron.php --ws=<name>) and tests
        $slug = (string) $GLOBALS['SE_WS_FORCE'];
        $mode = 'cli';
    } else {
        $path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
        $host = strtolower((string) preg_replace('/:\d+$/', '', (string) ($_SERVER['HTTP_HOST'] ?? '')));
        if (preg_match('#^/w/([a-z0-9-]{1,30})(?:/|$)#', $path, $m)) {
            $slug = $m[1];
            $mode = 'path';
        } elseif ($host !== '') {
            foreach (wsRegistry() as $s => $e) {
                if (in_array($host, (array) ($e['hosts'] ?? []), true)) {
                    $slug = (string) $s;
                    $mode = 'host';
                    break;
                }
            }
            if ($slug === '') {
                // <name>.stratedgeitconsulting.com (and <name>.localhost on a developer's computer)
                foreach (array_unique(array_filter([wsMainHost(), 'localhost'])) as $base) {
                    if (str_ends_with($host, '.' . $base)) {
                        $label = substr($host, 0, -strlen($base) - 1);
                        // only a workspace's own name: any other subdomain pointed at this site stays the main site
                        if ($label !== 'www' && !str_contains($label, '.') && isset(wsRegistry()[$label])) {
                            $slug = $label;
                            $mode = 'sub';
                        }
                        break;
                    }
                }
            }
        }
    }
    if ($slug === '') {
        return null;
    }
    $e = wsRegistry()[$slug] ?? null;
    $known = is_array($e) && ($e['status'] ?? '') !== 'deleted' && ($mode !== 'sub' || !empty($e['sub']));
    $ws = $known ? $e + ['slug' => $slug, 'mode' => $mode] : ['slug' => $slug, 'mode' => $mode, 'missing' => true];
    return $ws;
}
/** The workspace's name ('' on StratEdge's own site or an unknown address). */
function wsSlug(): string
{
    $ws = wsCurrent();
    return $ws && empty($ws['missing']) ? (string) $ws['slug'] : '';
}
function wsDirOf(string $slug): string
{
    return wsRoot() . '/' . $slug;
}
/** Where this request keeps its data: the workspace's folder, or storage/ for StratEdge's own site. */
function storeDir(): string
{
    $s = wsSlug();
    return $s !== '' ? wsDirOf($s) : dirname(__DIR__) . '/storage';
}
/* ---------- v82: StratEdge-managed workspaces inherit StratEdge's central setup ----------
 *  Phone, the website assistant and the recruiting integrations (Dice/iLabor) are set up once on StratEdge's own
 *  admin side. A company workspace with none of its own inherits them: the configuration document is read straight
 *  from StratEdge's database and its secrets unsealed with StratEdge's key. The values are used to run only - they
 *  are never shown inside a workspace (the setup pages live on the main admin side). This mirrors the mail service a
 *  workspace borrows (wsProviderMailSaved). Returns null on StratEdge's own site. */
function wsMainStore(): ?array
{
    static $done = false;
    static $out = null;
    if ($done) {
        return $out;
    }
    $done = true;
    if (wsSlug() === '') {
        return null; // already StratEdge's own database
    }
    try {
        $c = cfgRaw(); // config.php without the workspace overlay: StratEdge's own database and key
        $pdo = dbConnect((string) ($c['dsn'] ?? ''), ((string) ($c['db_user'] ?? '')) ?: null, ((string) ($c['db_pass'] ?? '')) ?: null);
        // StratEdge's own key, where secKeyCandidates() finds it on StratEdge's own site
        $hex = '';
        $dir = trim((string) ($c['key_dir'] ?? ''));
        foreach (array_unique(array_filter([
            $dir !== '' ? rtrim($dir, '/') . '/mail.key' : '',
            dirname(dirname(__DIR__)) . '/.stratedge-keys/mail.key',
            dirname(__DIR__) . '/storage/mail.key',
        ])) as $f) {
            if (is_file($f)) {
                $hex = trim((string) @file_get_contents($f));
                break;
            }
        }
        $key = strlen($hex) === 64 && ctype_xdigit($hex) ? (string) hex2bin($hex) : hash('sha256', __DIR__ . (string) ($c['session_name'] ?? ''), true);
        $out = ['pdo' => $pdo, 'key' => $key];
    } catch (Throwable $e) {
        $out = null;
    }
    return $out;
}
/** A configuration document (decoded array) read from StratEdge's own database, for a workspace to inherit. Null on
 *  StratEdge's own site or when StratEdge has not saved that document. */
function wsMainDoc(string $path): ?array
{
    $m = wsMainStore();
    if (!$m) {
        return null;
    }
    try {
        $st = $m['pdo']->prepare('SELECT data FROM docs WHERE path = ?');
        $st->execute([$path]);
        $v = $st->fetchColumn();
        if ($v === false) {
            return null;
        }
        $j = json_decode((string) $v, true);
        return is_array($j) ? $j : null;
    } catch (Throwable $e) {
        return null;
    }
}
/** StratEdge's own encryption key bytes, to unseal secrets in an inherited configuration document. '' on the main
 *  site (no borrowing there) or when the key cannot be read. */
function wsMainKey(): string
{
    $m = wsMainStore();
    return $m ? (string) $m['key'] : '';
}
/** The address people use for a workspace (links in emails): its own domain, the subdomain, or /w/<name>/. */
function wsUrlOf(string $slug, array $e): string
{
    $pref = (string) ($e['primary'] ?? '');
    if ($pref !== '' && $pref !== 'path' && $pref !== 'sub' && in_array($pref, (array) ($e['hosts'] ?? []), true)) {
        return 'https://' . $pref . '/';
    }
    $main = rtrim((string) (cfgRaw()['site_url'] ?? ''), '/');
    if ($pref === 'sub' && !empty($e['sub']) && wsMainHost() !== '') {
        return 'https://' . $slug . '.' . wsMainHost() . '/';
    }
    if ($main === '') {
        $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
        $main = ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost');
    }
    return $main . '/w/' . $slug . '/';
}
/** The workspace's own settings on top of config.php. */
function wsOverlay(array $c, array $ws): array
{
    $slug = (string) $ws['slug'];
    $d = wsDirOf($slug);
    $c['dsn'] = 'sqlite:' . $d . '/app.sqlite';
    $c['db_user'] = '';
    $c['db_pass'] = '';
    $c['files_dir'] = $d . '/files';
    $c['key_dir'] = $d;
    $c['session_name'] = 'stratedge_ws_' . str_replace('-', '_', $slug);
    $c['site_url'] = wsUrlOf($slug, $ws);
    // the first administrator comes from the setup link the provider sends, never from config.php
    $c['admin_email'] = '';
    $c['admin_name'] = '';
    $c['admin_password'] = '';
    $who = (string) ($ws['contact'] ?? ($ws['admin']['email'] ?? ''));
    $c['eod_emails'] = $who;
    $c['apply_emails'] = $who;
    // until the workspace connects its own email, StratEdge's mail service sends for it, under its name
    $c['mail_from_name'] = (string) ($ws['name'] ?? $slug);
    $c['mail_reply_to'] = $who;
    if (empty($ws['shareAi'])) {
        $c['assistant_api_url'] = '';
        $c['assistant_api_key'] = '';
        $c['assistant_model'] = '';
    }
    $c['ws'] = $slug;
    return $c;
}
/** In a company workspace, text written for StratEdge's own site (emails, messages) carries the company's name
 *  instead: "StratEdge IT Consulting Inc.", "StratEdge IT Consulting" and "StratEdge" become the workspace's name;
 *  "StratEdge Workspaces" (the service it runs on) stays. Unchanged on StratEdge's own site. */
function wsBrandText(string $s, bool $isHtml = false): string
{
    $ws = wsCurrent();
    if (!$ws || !empty($ws['missing']) || $s === '' || !str_contains($s, 'StratEdge')) {
        return $s;
    }
    $name = (string) ($ws['name'] ?? $ws['slug']);
    if ($isHtml) {
        $name = htmlspecialchars($name, ENT_QUOTES);
    }
    $s = str_replace(['StratEdge IT Consulting Inc.', 'StratEdge IT Consulting'], $name, $s);
    return (string) preg_replace('/StratEdge(?! Workspaces)/', addcslashes($name, '\\$'), $s);
}
/** Is this part of the portal switched on here? (Always on StratEdge's own site.) */
function wsFeatureOn(string $f): bool
{
    $ws = wsCurrent();
    if (!$ws || !empty($ws['missing'])) {
        return true;
    }
    return in_array($f, (array) ($ws['features'] ?? []), true);
}
/** The part of the portal a route belongs to ('' when it belongs to none: always open). */
// v81/v82: setup that only ever runs on StratEdge's own admin side, never inside a tenant workspace. Provider and
// integration CONFIGURATION is centralised - a workspace inherits StratEdge's phone, assistant and recruiting-source
// setup (see wsMainDoc) and keeps its own people/role management, the requirements desk and day-to-day calling,
// texting and iLabor intake. Two lists: whole families (every sub-route) and exact routes (only the setup/connect/
// test/run actions, so usage and roles stay open).
const WS_MAIN_ONLY_PREFIX = ['atc_', 'oorwin_'];
const WS_MAIN_ONLY_EXACT = [
    // Phone - provider setup, connection test and number provisioning (calling, texting and ph_grant stay open)
    'ph_cfg_save', 'ph_connect', 'ph_check', 'ph_numbers', 'ph_number_save',
    'ph_vitel_check', 'ph_vitel_testcall', 'ph_vitel_sync',
    // Recruiting integrations - save credentials, authenticate, test, and drive pulls against StratEdge's accounts
    // (cx_ilabor_incoming/accept/skip stay open: receiving and accepting inbound requirements is desk work)
    'cx_save', 'cx_token', 'cx_test', 'cx_pull', 'cx_search', 'cx_import',
    'cx_auto', 'cx_auto_run', 'cx_job', 'cx_job_id', 'cx_last_post', 'cx_get', 'cx_log',
    // Careers-page job sources
    'src_save', 'src_run', 'src_dice_feed_mode',
    // Website assistant - model keys, feature switches and the shield configuration (the AI features themselves stay on)
    'ai_settings_save', 'ai_features_save', 'ai_test', 'ai_shield_save', 'ai_shield_test',
];
function wsRouteMainOnly(string $r): bool
{
    if (wsSlug() === '') {
        return false; // StratEdge's own site
    }
    if (in_array($r, WS_MAIN_ONLY_EXACT, true)) {
        return true;
    }
    foreach (WS_MAIN_ONLY_PREFIX as $p) {
        if (str_starts_with($r, $p)) {
            return true;
        }
    }
    return false;
}
function wsFeatureOfRoute(string $r): string
{
    foreach (WS_FEATURES as $k => $f) {
        foreach ($f['routes'] as $p) {
            if (str_starts_with($r, $p)) {
                return $k;
            }
        }
    }
    return '';
}
/** What the pages need to know about the workspace (null on StratEdge's own site). */
function wsPublic(): ?array
{
    $ws = wsCurrent();
    if (!$ws) {
        return null;
    }
    if (!empty($ws['missing'])) {
        return ['slug' => $ws['slug'], 'missing' => true];
    }
    $b = (array) ($ws['brand'] ?? []);
    return [
        'slug' => (string) $ws['slug'],
        'name' => (string) ($ws['name'] ?? $ws['slug']),
        'status' => (string) ($ws['status'] ?? 'active'),
        'setup' => !empty($ws['setupDone']),
        'features' => array_values((array) ($ws['features'] ?? [])),
        'brand' => ['color' => (string) ($b['color'] ?? ''), 'logo' => !empty($b['logo']) ? 'api/index.php?r=ws_logo&v=' . (int) ($b['logoAt'] ?? 0) : '', 'tagline' => (string) ($b['tagline'] ?? ''), 'addr' => (string) ($b['addr'] ?? '')],
        'contact' => (string) ($ws['contact'] ?? ''),
        'url' => wsUrlOf((string) $ws['slug'], $ws),
        'pilotUntil' => (string) ($ws['plan']['until'] ?? ''),
    ];
}
