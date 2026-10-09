<?php
declare(strict_types=1);
// v37: which workspace a request belongs to (other companies' portals on this installation) and where its data is
require_once __DIR__ . '/ws.php';
// v34: the security core (keys, encrypted files, audit log) and the session register load with every request
require_once __DIR__ . '/seccore.php';
require_once __DIR__ . '/sessions.php';

const LEVELS = ['view' => 0, 'interact' => 1, 'admin' => 2];
// Who may read and write where. A rule covers its path and everything below it; a deeper rule wins.
// {self} stands for the signed-in person's own id.
const RULES = [
    ['', 'admin', 'admin'],
    ['u', 'admin', 'admin'],
    ['u/{self}', 'interact', 'interact'],
    ['r', 'admin', 'admin'],
    ['r/{self}', 'interact', 'admin'],
    ['e', 'admin', 'admin'],
    ['e/{self}', 'interact', 'interact'],
    ['pub', 'interact', 'interact'],
    ['org', 'interact', 'admin'],
    ['org/site', 'view', 'admin'],
    ['org/admin', 'admin', 'admin'],
    ['inbox', 'admin', 'admin'],
    ['inbox/{self}', 'interact', 'interact'],
    ['rec', 'interact', 'interact'],
    ['sig', 'admin', 'admin'],
    ['inv', 'admin', 'admin'],
    ['exp', 'admin', 'admin'],
    ['ats', 'admin', 'admin'],
    ['org/acct', 'admin', 'admin'],
    ['pays', 'admin', 'admin'],
    ['pays/{self}', 'interact', 'admin'],
    ['log', 'admin', 'admin'],
    ['geo', 'admin', 'admin'],
    ['crm', 'admin', 'admin'],
    ['hrms', 'admin', 'admin'],
    ['hrms/x/pub', 'interact', 'admin'],
    ['hrms/rev/{self}', 'interact', 'admin'],
    ['hrms/self/{self}', 'interact', 'interact'],
    ['hrms/emp/{self}', 'interact', 'admin'],
    ['hrms/assets/{self}', 'interact', 'admin'],
    ['ads', 'admin', 'admin'],
    ['sec', 'admin', 'admin'],
    ['vms', 'interact', 'interact'],
    ['vms/dice', 'interact', 'admin'], // v83: cached Dice search results are written by the server (vms_dice_import trusts them)
    ['org/vms', 'admin', 'admin'],
    ['org/box', 'interact', 'interact'],
    ['org/mkt', 'interact', 'interact'],
    // v30: compliance hub, learning platform, project vault and live projects (own records; HR reads everyone's)
    ['comp', 'admin', 'admin'],
    ['comp/x', 'interact', 'admin'],
    ['comp/{self}', 'interact', 'interact'],
    ['learn', 'admin', 'admin'],
    ['learn/x', 'interact', 'admin'],
    // v32: a person reads their own progress, attempts and certificates; only the server writes them (a certificate
    // written from the browser would pass the public check)
    ['learn/{self}', 'interact', 'admin'],
    ['pv', 'admin', 'admin'],
    ['pv/{self}', 'interact', 'interact'],
    ['proj', 'admin', 'admin'],
    ['proj/x', 'interact', 'admin'],
    ['proj/{self}', 'interact', 'interact'],
    // v31: tailored resumes (own records; HR and recruiting team read them); staff-made ones live under rec/tl
    ['tl', 'admin', 'admin'],
    ['tl/{self}', 'interact', 'interact'],
    // v32: the exam question bank (HR), plans and payments (a person reads their own; plans and fee terms are public)
    ['exq', 'admin', 'admin'],
    ['bill', 'admin', 'admin'],
    ['bill/{self}', 'interact', 'admin'],
    ['bill/x', 'view', 'admin'],
];
// Staff scopes: which staff roles may read / write the sensitive areas. Administrators always may.
// 'bench' means employees with the Bench desk (v63: every active employee unless the feature is blocked), 'grant:x' means a person whose Team card has the x feature switched on.
const SCOPES = [
    'org/acct' => [['acct', 'grant:accounting'], ['acct', 'grant:accounting']],
    'pays' => [['acct', 'hr', 'grant:payroll'], ['acct', 'grant:payroll']],
    'exp' => [['acct', 'grant:accounting'], ['acct', 'grant:accounting']],
    'inv' => [['acct', 'grant:accounting'], ['acct', 'grant:accounting']],
    'ats' => [['hr', 'grant:ats'], ['hr', 'grant:ats']],
    'org/hr' => [['hr', 'acct', 'manager', 'bench', 'grant:hr'], ['hr', 'grant:hr']],
    'hrms' => [['hr', 'grant:hr', 'grant:hrms'], ['hr', 'grant:hrms']],
    'crm' => [['hr', 'bench', 'grant:crm'], ['hr', 'bench', 'grant:crm']],
    'ads' => [['hr', 'grant:ads'], ['grant:ads']],
    'sec' => [[], []],
    // website ads are public to read; HR and people with the ads feature create them
    'org/site/ads' => [['hr', 'acct', 'manager', 'bench', 'grant:ads'], ['hr', 'grant:ads']],
    // v30: immigration dates and compliance tasks are HR's business only; courses, projects and the vault: HR writes, managers read
    'comp' => [['hr', 'grant:hr', 'grant:compliance'], ['hr', 'grant:hr', 'grant:compliance']],
    'learn' => [['hr', 'grant:hr', 'manager', 'grant:learning'], ['hr', 'grant:hr', 'grant:learning']],
    'pv' => [['hr', 'grant:hr', 'grant:learning'], ['hr', 'grant:hr', 'grant:learning']],
    'proj' => [['hr', 'grant:hr', 'manager', 'grant:learning'], ['hr', 'grant:hr', 'grant:learning']],
    'tl' => [['hr', 'grant:hr', 'bench', 'grant:recruiting'], ['hr', 'grant:hr', 'bench', 'grant:recruiting']],
    'exq' => [['hr', 'grant:hr', 'grant:learning'], ['hr', 'grant:hr', 'grant:learning']],
    'bill' => [['hr', 'acct', 'grant:billing'], ['hr', 'acct', 'grant:billing']],
    // v44: expense claims (v43), goals, review cycles and reviews are read and changed only through their own routes
    // (xc_, pf_), which decide who sees what (a self review stays private until it is sent); the generic record access
    // stays with administrators
    'xc' => [[], []],
    'pfg' => [[], []],
    'pfc' => [[], []],
    'pfr' => [[], []],
    // v45: immigration cases go through the im_ routes (HR, administrators and the person the case is for)
    'im' => [[], []],
    // v45.1: the attorney links (imx/<hash>) and the Visa Bulletin entered by HR
    'imx' => [[], []],
    'imvb' => [[], []],
    // v45.3: the e-signature library, its settings and the bulk sends go through the es_ routes
    'esd' => [[], []],
    'esx' => [[], []],
    'esb' => [[], []],
];
// Keys a manager may change on a direct report's record: timesheet reviews, time-off decisions, clock-in approvals and tasks.
const MANAGER_KEYS = ['rev', 'lvd', 'attA', 'tasks'];
const MIME = [
    'pdf' => 'application/pdf',
    'png' => 'image/png',
    'jpg' => 'image/jpeg',
    'jpeg' => 'image/jpeg',
    'webp' => 'image/webp',
    'gif' => 'image/gif',
    'csv' => 'text/csv',
    'txt' => 'text/plain',
    'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    // v30: project vault files
    'pptx' => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'zip' => 'application/zip',
    'md' => 'text/markdown',
    'json' => 'application/json',
];

function cfg(string $k)
{
    static $c = null;
    if ($c === null) {
        $c = cfgRaw();
        // v37: a workspace has its own database, files, key, session, address and staff email on top of config.php
        $ws = wsCurrent();
        if ($ws && empty($ws['missing'])) {
            $c = wsOverlay($c, $ws);
        }
    }
    return $c[$k] ?? null;
}
/** The language model behind the website assistant, live-project briefs, quiz writing and candidate summaries:
 *  saved under Admin > Website & messages > Assistant (sec/x/ai/cfg, key sealed), else the values in config.php. */
function aiCfg(bool $reset = false): array
{
    static $c = null;
    if ($c !== null && !$reset) {
        return $c;
    }
    $d = docGet('sec/x/ai/cfg');
    $url = trim((string) ($d->url ?? ''));
    $model = trim((string) ($d->model ?? ''));
    $sealed = (string) ($d->key ?? '');
    $at = (int) ($d->at ?? 0);
    $by = (string) ($d->by ?? '');
    $mainKey = null;
    $from = 'settings';
    // v82: a StratEdge-managed company workspace with no assistant of its own inherits StratEdge's saved assistant
    // settings (set up under Admin > Website & messages > Assistant on the main site), read from StratEdge's database
    // and unsealed with StratEdge's key. Falls through to config.php as before when StratEdge has none saved either.
    // v83: only a workspace StratEdge lets use its AI connection (Workspaces > Manage: "Let it use StratEdge's AI
    // connection"); with the switch off, config.php's values are blanked too (wsOverlay), so its AI features stay off
    if (($url === '' || $sealed === '') && function_exists('wsSlug') && wsSlug() !== '' && !empty(wsCurrent()['shareAi'])) {
        $m = wsMainDoc('sec/x/ai/cfg');
        $mk = wsMainKey();
        if ($mk !== '' && is_array($m) && trim((string) ($m['url'] ?? '')) !== '' && (string) ($m['key'] ?? '') !== '') {
            $url = trim((string) ($m['url'] ?? ''));
            $model = trim((string) ($m['model'] ?? ''));
            $sealed = (string) ($m['key'] ?? '');
            $at = (int) ($m['at'] ?? 0);
            $by = (string) ($m['by'] ?? '');
            $mainKey = $mk;
            $from = 'central';
        }
    }
    if ($url !== '' && $sealed !== '') {
        require_once __DIR__ . '/mail.php';
        $key = $mainKey ? mailUnsealWith($sealed, $mainKey) : mailUnseal($sealed);
        $c = ['url' => $url, 'key' => $key, 'model' => $model, 'from' => $from, 'at' => $at, 'by' => $by];
        return $c;
    }
    $c = ['url' => (string) cfg('assistant_api_url'), 'key' => (string) cfg('assistant_api_key'), 'model' => (string) cfg('assistant_model'), 'from' => (string) cfg('assistant_api_key') !== '' ? 'config' : '', 'at' => 0, 'by' => ''];
    return $c;
}
/** Where the assistant is used. Every feature is on by default once an assistant is set up; Admin > Website &
 *  messages > Assistant (AI) switches them (and all of them) off. Order = the order on that page. */
const AI_FEATURES = [
    'copilot' => ['StratEdge AI in every portal', 'The "StratEdge AI" button on every portal page: explains and teaches the page, answers how-to questions, drafts messages and summaries.'],
    'copilotPage' => ['Let StratEdge AI read the page it is opened on', 'Sends the visible text of the current page with the question (numbers that look like SSNs, bank accounts or card numbers are masked first). Off: it only knows the page name.'],
    // v78: StratEdge AI can do things, each one confirmed first
    'copilotAct' => ['Let StratEdge AI do things (with your confirmation)', 'Turns StratEdge AI into an agent: it can look things up and propose actions within your role — send an email, create a task, approve a timesheet, add a note, post an announcement, block an address. Every change is shown as a card you confirm first, and is written to the audit log. Off: StratEdge AI only answers and drafts.'],
    // v78: the guard around the model
    'shield' => ['AI shield (prompt-injection & data-leak guard)', 'Reads page text, emails, resumes and visitor messages for prompt-injection before the model sees them, fences them off as data, and blanks keys, tokens and account numbers in what goes in and comes out. Strongly recommended; leave on.'],
    // v32
    'mywork' => ['Plan my day and my week', 'When someone asks about their day, week or deadlines, StratEdge AI reads their own open tasks, timesheet status, clock-in, compliance deadlines, courses, tests, certifications and plan payments (only their own).'],
    'mail' => ['Email help', 'In My email and the email inbox: summarize a message, list what it asks for, and draft a reply or a follow-up.'],
    'write' => ['Write with AI in the editors', 'Emails, mass email campaigns, job descriptions, announcements, task details, e-sign messages, vendor notes and daily reports.'],
    'extract' => ['Fill forms from pasted text', 'Requirements desk: paste the vendor\'s email and the fields fill in. Consultant database: fill the card from a resume.'],
    'tailor' => ['Resume tailoring', 'Reads the resume and the job description into sections and modules and rewrites the resume for the job (Tailor & submit, Tailor my resume).'],
    'find' => ['Fit notes when ranking consultants', 'The top consultants for a job description get a short strongest-evidence / biggest-gap note.'],
    'projects' => ['Live project briefs', 'A tailored project brief for each consultant instead of the built-in templates.'],
    'courses' => ['Create courses and modules with AI', 'Learning platform: a whole course, or one more module, from a topic: lessons, quizzes and puzzles, saved as a draft to review.'],
    'quiz' => ['Quiz questions for courses', '"Write questions with AI" in the course editor.'],
    'ats' => ['Candidate summaries in the ATS', '"Score all" writes a short fit summary per candidate.'],
    'agent' => ['Screening agent', 'Reads new candidates against the job, writes the role questions, scores the answers and looks for signs of fake profiles (Recruiting › Screening agent). Off: the agent still works with the fit score and its own checks.'],
    'chat' => ['Website chat assistant', 'Open-ended questions on the public website (it answers from the built-in knowledge otherwise).'],
    // v35
    'practice' => ['Practice calls', 'Grow › Practice calls: the recruiter or interviewer words its questions naturally and reacts to each answer, and the coach writes the feedback and a stronger answer for every question. Off: the built-in questions, scoring and model answers.'],
];
function aiFeatures(bool $reset = false): array
{
    static $c = null;
    if ($c !== null && !$reset) {
        return $c;
    }
    $d = docGet('sec/x/ai/features');
    // v82: a StratEdge-managed workspace with no feature switches of its own inherits StratEdge's
    if (!$d && function_exists('wsSlug') && wsSlug() !== '') {
        $m = wsMainDoc('sec/x/ai/features');
        if (is_array($m)) {
            $d = (object) $m;
        }
    }
    $c = ['on' => !isset($d->on) || !empty($d->on)];
    foreach (array_keys(AI_FEATURES) as $k) {
        $c[$k] = !isset($d->$k) || !empty($d->$k);
    }
    return $c;
}
/** The assistant is set up (and, with a feature name, that feature and the master switch are on). */
function aiReady(string $feature = ''): bool
{
    $a = aiCfg();
    if ($a['url'] === '' || $a['key'] === '' || $a['model'] === '' || !function_exists('curl_init')) {
        return false;
    }
    if ($feature === '') {
        return true;
    }
    $f = aiFeatures();
    return $f['on'] && !empty($f[$feature]);
}
/** What the signed-in person's browser needs to know: which AI buttons to show. */
function aiClientFlags(?array $u): ?array
{
    if (!$u) {
        return null;
    }
    $staff = hasRole($u, 'admin') || hasRole($u, 'hr') || hasRole($u, 'acct') || hasRole($u, 'manager') || isRecruiter($u['id']) || isBench($u['id']);
    return [
        'copilot' => aiReady('copilot'),
        'page' => aiReady('copilotPage'),
        'work' => aiReady('mywork'),
        'mail' => aiReady('mail'),
        'write' => aiReady('write'),
        'extract' => $staff && aiReady('extract'),
        'tailor' => aiReady('tailor'),
        // v78: StratEdge AI acting on confirmation
        'act' => aiReady('copilotAct'),
    ];
}
/** One chat-completions call (OpenAI-style). Returns [httpCode, decodedJsonOrRawString, curlError]. */
function aiPost(array $payload, int $timeout = 60): array
{
    $a = aiCfg();
    $payload['model'] = $payload['model'] ?? $a['model'];
    $ch = curl_init($a['url']);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $a['key'], 'User-Agent: StratEdge-site/1.0'],
    ]);
    $resp = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = (string) curl_error($ch);
    curl_close($ch);
    $j = is_string($resp) ? json_decode($resp, true) : null;
    return [$code, is_array($j) ? $j : (is_string($resp) ? $resp : ''), $err];
}
/** A JSON answer from the assistant (system + prompt), decoded; null when it is not set up or did not answer. */
function aiJson(string $system, string $prompt, int $maxTokens = 2500): ?array
{
    if (!aiReady()) {
        return null;
    }
    $payload = ['max_tokens' => $maxTokens, 'temperature' => 0.3, 'messages' => [['role' => 'system', 'content' => $system], ['role' => 'user', 'content' => $prompt]], 'response_format' => ['type' => 'json_object']];
    [$code, $j] = aiPost($payload, 120);
    if ((!is_array($j) || empty($j['choices'])) && $code >= 400) {
        unset($payload['response_format']);
        [$code, $j] = aiPost($payload, 120);
    }
    $t = is_array($j) ? trim((string) ($j['choices'][0]['message']['content'] ?? '')) : '';
    if ($t === '') {
        return null;
    }
    $t = preg_replace('/^```(?:json)?\s*|\s*```$/m', '', $t) ?? $t;
    $d = json_decode($t, true);
    if (!is_array($d) && preg_match('/\{.*\}/s', $t, $m)) {
        $d = json_decode($m[0], true);
    }
    return is_array($d) ? $d : null;
}
/**
 * v33: several JSON answers at once (curl_multi, a few at a time). $calls = [[system, prompt, maxTokens], ...].
 * Returns the decoded answers in the same order, null where a call failed. Calls a server refused with a 4xx are tried
 * once more without response_format (some OpenAI-compatible servers do not know it).
 */
function aiJsonMulti(array $calls, int $timeout = 100, int $parallel = 4): array
{
    $calls = array_values($calls);
    $res = array_fill(0, count($calls), null);
    if (!$calls || !aiReady()) {
        return $res;
    }
    $a = aiCfg();
    $mk = function (array $c, bool $fmt) use ($a, $timeout) {
        $payload = ['model' => $a['model'], 'max_tokens' => (int) ($c[2] ?? 2500), 'temperature' => 0.3, 'messages' => [['role' => 'system', 'content' => (string) $c[0]], ['role' => 'user', 'content' => (string) $c[1]]]];
        if ($fmt) {
            $payload['response_format'] = ['type' => 'json_object'];
        }
        $ch = curl_init($a['url']);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($payload),
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $a['key'], 'User-Agent: StratEdge-site/1.0'],
        ]);
        return $ch;
    };
    $decode = function ($body): ?array {
        $j = is_string($body) ? json_decode($body, true) : null;
        $t = is_array($j) ? trim((string) ($j['choices'][0]['message']['content'] ?? '')) : '';
        if ($t === '') {
            return null;
        }
        $t = preg_replace('/^```(?:json)?\s*|\s*```$/m', '', $t) ?? $t;
        $d = json_decode($t, true);
        if (!is_array($d) && preg_match('/\{.*\}/s', $t, $m)) {
            $d = json_decode($m[0], true);
        }
        return is_array($d) ? $d : null;
    };
    $todo = array_keys($calls);
    foreach ([true, false] as $fmt) {
        $retry = [];
        foreach (array_chunk($todo, max(1, $parallel)) as $chunk) {
            $mh = curl_multi_init();
            $hs = [];
            foreach ($chunk as $i) {
                $hs[$i] = $mk($calls[$i], $fmt);
                curl_multi_add_handle($mh, $hs[$i]);
            }
            do {
                $st = curl_multi_exec($mh, $running);
                if ($running) {
                    curl_multi_select($mh, 1.0);
                }
            } while ($running && $st === CURLM_OK);
            foreach ($hs as $i => $ch) {
                $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
                $res[$i] = $decode(curl_multi_getcontent($ch));
                if ($res[$i] === null && $fmt && $code >= 400 && $code < 500 && $code !== 401 && $code !== 429) {
                    $retry[] = $i;
                }
                curl_multi_remove_handle($mh, $ch);
                curl_close($ch);
            }
            curl_multi_close($mh);
        }
        if (!$retry) {
            break;
        }
        $todo = $retry;
    }
    return $res;
}
/** v46: work done outside a request (the scheduled sequences) uses helpers that refuse with fail(); while
 *  $GLOBALS['SE_FAIL_THROWS'] is set, a refusal is thrown as a FailError instead of ending the whole run. */
final class FailError extends RuntimeException
{
}
function fail(int $status, string $code, string $msg, array $extra = []): never
{
    if (!empty($GLOBALS['SE_FAIL_THROWS'])) {
        throw new FailError($code . ': ' . $msg, $status);
    }
    http_response_code($status);
    // v35: some refusals carry what the page needs to continue (a bot-check puzzle, the ways to confirm it's you)
    echo json_encode(['error' => $code, 'message' => $msg] + $extra);
    exit();
}
function ok($data = []): never
{
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit();
}
function body(): array
{
    static $b = null;
    if ($b === null) {
        $raw = file_get_contents('php://input');
        $b = $raw === '' ? [] : (json_decode($raw, true) ?: []);
    }
    return $b;
}
function rid(int $n = 12): string
{
    return bin2hex(random_bytes($n));
}
function now(): int
{
    return (int) round(microtime(true) * 1000);
}

/* ---------- database ---------- */
/*
 * v35: SQLite (WAL) refuses a write at once with "database is locked" (no busy wait) when the same connection still
 * holds a read from before another request's write: a one-row fetch() keeps its statement, and the old snapshot,
 * open. Messages polling made such overlaps likelier (a sign-in could fail on its password-upgrade write). A write
 * refused that way closes this connection's open reads and tries again; inside an explicit transaction the error is
 * passed on (those take their write lock first). MySQL never takes this path.
 */
class SeStmt extends PDOStatement
{
    private SePDO $se;
    protected function __construct(SePDO $se)
    {
        $this->se = $se;
        $se->seTrack($this);
    }
    public function execute(?array $params = null): bool
    {
        try {
            return parent::execute($params);
        } catch (PDOException $e) {
            if (!$this->se->seBusy($e)) {
                throw $e;
            }
            $this->se->seRelease($this);
            try {
                $this->closeCursor(); // the refused run is reset before it runs again
            } catch (Throwable $x) {
                // nothing to reset
            }
            return parent::execute($params);
        }
    }
}
class SePDO extends PDO
{
    private array $seOpen = [];
    public function seTrack(PDOStatement $s): void
    {
        $this->seOpen[] = WeakReference::create($s);
        if (count($this->seOpen) > 64) {
            $this->seOpen = array_values(array_filter($this->seOpen, fn($w) => $w->get() !== null));
        }
    }
    public function seBusy(PDOException $e): bool
    {
        return (int) ($e->errorInfo[1] ?? 0) === 5 && !$this->inTransaction() && $this->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite';
    }
    /** Ends this connection's open reads (their old snapshot) before a write is tried again. */
    public function seRelease(?PDOStatement $keep): void
    {
        foreach ($this->seOpen as $w) {
            $s = $w->get();
            if ($s !== null && $s !== $keep) {
                try {
                    $s->closeCursor();
                } catch (Throwable $e) {
                    // already finished
                }
            }
        }
        usleep(random_int(2000, 20000));
    }
    public function exec(string $statement): int|false
    {
        try {
            return parent::exec($statement);
        } catch (PDOException $e) {
            if (!$this->seBusy($e)) {
                throw $e;
            }
            $this->seRelease(null);
            return parent::exec($statement);
        }
    }
}
/** A database connection with the site's settings (SQLite: busy wait, WAL, retry of stale-snapshot writes). */
function dbConnect(string $dsn, ?string $user = null, ?string $pass = null): PDO
{
    $lite = str_starts_with($dsn, 'sqlite:');
    $pdo = $lite ? new SePDO($dsn, null, null) : new PDO($dsn, $user, $pass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    if ($lite) {
        $pdo->setAttribute(PDO::ATTR_STATEMENT_CLASS, [SeStmt::class, [$pdo]]);
        $pdo->exec('PRAGMA busy_timeout=5000');
        $pdo->exec('PRAGMA journal_mode=WAL');
        // WAL already keeps the file consistent on a crash; NORMAL skips an fsync per write, which shared hosts feel
        $pdo->exec('PRAGMA synchronous=NORMAL');
        $pdo->exec('PRAGMA temp_store=MEMORY');
        $pdo->exec('PRAGMA cache_size=-8000');
    }
    return $pdo;
}
function db(): PDO
{
    static $pdo = null;
    if ($pdo) {
        return $pdo;
    }
    $dsn = cfg('dsn');
    if (str_starts_with($dsn, 'sqlite:')) {
        $f = substr($dsn, 7);
        $dir = dirname($f);
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
    }
    $pdo = dbConnect($dsn, cfg('db_user') ?: null, cfg('db_pass') ?: null);
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS users (id VARCHAR(40) PRIMARY KEY, email VARCHAR(190) NOT NULL, name VARCHAR(190) NOT NULL, pass VARCHAR(255) NOT NULL, role VARCHAR(16) NOT NULL, status VARCHAR(16) NOT NULL, created BIGINT NOT NULL)',
    );
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS docs (path VARCHAR(500) PRIMARY KEY, col VARCHAR(400) NOT NULL, data LONGTEXT NOT NULL, seq BIGINT NOT NULL, updated BIGINT NOT NULL)',
    );
    $pdo->exec('CREATE INDEX IF NOT EXISTS docs_col ON docs (col)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS docs_col_seq ON docs (col, seq)'); // versions and deltas without touching record bodies
    $pdo->exec('CREATE TABLE IF NOT EXISTS meta (k VARCHAR(32) PRIMARY KEY, v BIGINT NOT NULL)');
    // v24: which portals a person may open and which client workspaces they belong to (JSON), beside their main role
    try {
        $pdo->exec("ALTER TABLE users ADD COLUMN access TEXT NOT NULL DEFAULT ''");
    } catch (Throwable $e) {
        // the column is already there
    }
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS throttle (k VARCHAR(190) PRIMARY KEY, n INT NOT NULL, until BIGINT NOT NULL)',
    );
    if (!$pdo->query("SELECT v FROM meta WHERE k='seq'")->fetch()) {
        $pdo->exec("INSERT INTO meta (k, v) VALUES ('seq', 0)");
    }
    if (
        cfg('admin_email') &&
        cfg('admin_password') &&
        !$pdo->query('SELECT id FROM users LIMIT 1')->fetch()
    ) {
        require_once __DIR__ . '/auth.php';
        $id = 'u_' . rid(8);
        $pdo->prepare(
            'INSERT INTO users (id, email, name, pass, role, status, created) VALUES (?,?,?,?,?,?,?)',
        )->execute([
            $id,
            strtolower(trim(cfg('admin_email'))),
            cfg('admin_name') ?: 'Administrator',
            pwHash((string) cfg('admin_password')),
            'admin',
            'active',
            now(),
        ]);
        // v83: the password in config.php ships in the package: it must be replaced at the first sign-in
        authUserSet($id, ['must_pw' => 1, 'why' => 'first']);
    }
    return $pdo;
}
function nextSeq(): int
{
    $p = db();
    $p->exec("UPDATE meta SET v = v + 1 WHERE k = 'seq'");
    return (int) $p->query("SELECT v FROM meta WHERE k = 'seq'")->fetchColumn();
}

/* ---------- paths & permissions ---------- */
function validPath(string $p, ?bool $doc): bool
{
    if ($p === '' || strlen($p) > 1000) {
        return false;
    }
    $segs = explode('/', $p);
    if (count($segs) > 16) {
        return false;
    }
    foreach ($segs as $s) {
        if (
            $s === '' ||
            $s === '.' ||
            $s === '..' ||
            strlen($s) > 200 ||
            !preg_match('/^[A-Za-z0-9_\-.~:@+]+$/', $s)
        ) {
            return false;
        }
    }
    if ($doc === true && count($segs) % 2 !== 0) {
        return false;
    }
    if ($doc === false && count($segs) % 2 !== 1) {
        return false;
    }
    return true;
}
function userLevel(?array $u): int
{
    if (!$u) {
        return 0;
    }
    foreach (rolesOf($u) as $r) {
        if (in_array($r, ['admin', 'hr', 'acct'], true)) {
            return 2;
        }
    }
    return 1;
}

/* ---------- portals and access (v24) ----------
   A person has one main role (users.role) and may be given more portals under Admin > Roles & access:
   staff portals (admin, hr, acct, mgr) and member portals (employee, consultant, client, student), plus the
   client workspaces they belong to. The main role still counts; the extra portals add to it. */
const PORTAL_KEYS = ['admin', 'hr', 'acct', 'mgr', 'employee', 'consultant', 'client', 'student'];
const STAFF_PORTAL_ROLE = ['admin' => 'admin', 'hr' => 'hr', 'acct' => 'acct', 'mgr' => 'manager'];
const ROLE_PORTAL = ['admin' => 'admin', 'hr' => 'hr', 'acct' => 'acct', 'manager' => 'mgr'];
// v58: administrator-controlled per-person feature overrides. Missing = role/default behavior; "allow" adds
// the feature; "block" removes it even when the person's role normally includes it. Core privilege-management and
// security-owner pages are deliberately not delegatable through this catalog.
const FEATURE_ACCESS = [
    'mail_contacts'=>['Email & contacts','Email','Address book, inbox and normal company email'], 'mail_validation'=>['Email validation','Email','Address validation and history'], 'mail_cleanup'=>['Bounces & contact cleanup','Email','Bounce cleanup and duplicate merging'], 'mail_campaigns'=>['Campaigns','Email','Campaign creation and sending'],
    'ats'=>['Candidates / ATS','Recruiting','Candidate records and ATS pipeline'], 'screening_agent'=>['Screening Agent','Recruiting','Resume/email screening agent'], 'talent_search'=>['Talent Search','Recruiting','Candidate search and sourcing'], 'bench_sales'=>['Bench desk','Recruiting','Bench consultant desk and submission workflow for Employees'], 'recruiting_reports'=>['Recruiting dashboard & reports','Recruiting','Recruiting reports and submissions'], 'resume_tailor'=>['Resume tailoring','Recruiting','Resume tailoring'], 'job_portals'=>['Jobs & job portals','Recruiting','Jobs and job-board tools'], 'auto_apply'=>['Autofill & Auto Apply','Recruiting','Autofill and automated application tools'], 'interviews'=>['Interviews','Recruiting','Interview workflow'], 'placements'=>['Placements','Recruiting','Placement workflow'], 'requirements'=>['Requirements desk','Recruiting','Requirements'], 'vendors'=>['Vendors & marketplace','Recruiting','VMS/vendor marketplace'],
    'clients'=>['Clients','Sales','Client records'], 'crm'=>['CRM','Sales','Accounts, contacts and deals'], 'sequences'=>['Sequences','Sales','Outreach sequences'], 'client_requests'=>['Client requests','Sales','Client requests'],
    'team_directory'=>['Team & directory','People','Team and directory'], 'hrms'=>['HRMS','People','HR records'], 'onboarding'=>['Onboarding','People','Onboarding'], 'id_verification'=>['ID verification','People','Identity/document checks'], 'policies'=>['Policies','People','Policies'], 'attendance'=>['Attendance','People','Attendance'], 'approvals'=>['Approvals','People','Approvals'], 'tasks'=>['Tasks','People','Tasks'], 'announcements'=>['Announcements','People','Announcements'], 'compliance'=>['USCIS compliance','People','Compliance'], 'immigration_news'=>['Immigration live updates','People','Official immigration news'], 'immigration'=>['Immigration cases','People','Immigration cases'], 'learning'=>['Learning','People','Learning'], 'exams_practice'=>['Exams & practice','People','Tests and practice'], 'goals'=>['Goals & reviews','People','Goals'],
    'esign'=>['E-signatures','Tools','E-signatures'], 'imports'=>['Import with preview','Tools','Imports'], 'integrations'=>['Portal integrations','Tools','External connectors'], 'ai'=>['StratEdge AI','Tools','AI helpers'], 'ops_intel'=>['Intelligence & Operations','Operations','Unified command center, search, Candidate 360, data quality, integration health and analytics'], 'reports'=>['Reports','Operations','Reports'], 'storage'=>['Storage box','Operations','Storage'], 'desk'=>['Service desk','Operations','Help desk'], 'work'=>['Work boards','Operations','Projects and boards'], 'messages'=>['Messages','Communications','Messaging'], 'phone'=>['Phone & texts','Communications','Calls and texts'],
    'invoices'=>['Invoices','Finance','Invoices'], 'expenses'=>['Expenses & claims','Finance','Expenses and claims'], 'banking'=>['Bank & reconciliation','Finance','Bank feeds'], 'books'=>['Books','Finance','Books'], 'accounting_reports'=>['Accounting reports','Finance','Accounting reports'], 'accounts_chart'=>['Chart of accounts & settings','Finance','Accounting setup'], 'payroll'=>['Payroll runs & plans','Finance','Payroll'], 'payroll_setup'=>['Payroll setup','Finance','Payroll setup'], 'payroll_tax'=>['Payroll taxes','Finance','Payroll taxes'], 'billing'=>['Plans & payments','Finance','Billing'], 'ads'=>['Ads & social posts','Marketing','Ads and social posts'],
    'service_pages'=>['Service pages & cases','Marketing','The website\'s specialist service pages and case evidence'],
    /* v58 compatibility aliases: old saved overrides still remain meaningful */
    'recruiting'=>['Recruiting tools (legacy group)','Legacy','Compatibility group'], 'accounting'=>['Accounting (legacy group)','Legacy','Compatibility group'],
];
function featureAccessCatalog(): array
{
    $out = [];
    foreach (FEATURE_ACCESS as $k => $v) {
        $out[] = ['k' => $k, 'n' => $v[0], 'group' => $v[1], 'd' => $v[2]];
    }
    return $out;
}
/** Saved overrides from r/{uid}.fa as key => allow|block. */
function featureAccessOf(string $uid): array
{
    $d = myR($uid);
    $out = [];
    if ($d && isset($d->fa) && $d->fa instanceof stdClass) {
        foreach (get_object_vars($d->fa) as $k => $v) {
            $m = is_string($v) ? strtolower($v) : '';
            if (isset(FEATURE_ACCESS[$k]) && in_array($m, ['allow', 'block'], true)) {
                $out[$k] = $m;
            }
        }
    }
    return $out;
}
function featureParentKey(string $key): string
{
    $m = [
        'screening_agent'=>'recruiting','talent_search'=>'recruiting','bench_sales'=>'recruiting','recruiting_reports'=>'recruiting','resume_tailor'=>'recruiting','job_portals'=>'recruiting','auto_apply'=>'recruiting','interviews'=>'recruiting','placements'=>'recruiting',
        'vendors'=>'requirements', 'clients'=>'crm','sequences'=>'crm','client_requests'=>'crm',
        'team_directory'=>'hrms','onboarding'=>'hrms','id_verification'=>'hrms','policies'=>'hrms','attendance'=>'hrms','approvals'=>'hrms','tasks'=>'hrms','announcements'=>'hrms',
        'immigration_news'=>'compliance','exams_practice'=>'learning',
        'invoices'=>'accounting','expenses'=>'accounting','banking'=>'accounting','books'=>'accounting','accounting_reports'=>'accounting','accounts_chart'=>'accounting',
        'payroll_setup'=>'payroll','payroll_tax'=>'payroll',
    ];
    return $m[$key] ?? '';
}
function featureMode(string $uid, string $key): string
{
    $fa = featureAccessOf($uid);
    if (isset($fa[$key])) return $fa[$key];
    $p = featureParentKey($key);
    return $p !== '' && isset($fa[$p]) ? $fa[$p] : 'default';
}
/** Apply a feature override on top of the caller's normal role/default result. Administrators cannot be blocked. */
function featureAllowed(array $u, string $key, bool $default): bool
{
    if (hasRole($u, 'admin')) {
        return true;
    }
    $m = featureMode((string) $u['id'], $key);
    if ($m === 'block') return false;
    if ($m === 'allow') return true;
    return $default;
}
/** Feature that owns a private API route. Public hooks/webhooks deliberately return ''. */
function featureRouteKey(string $r): string
{
    if (in_array($r, ['mail_webhook','mail_inbound','mail_postal_hook','mail_postal_inbound','mail_ses_hook','jobs_feed','stripe_webhook'], true) || str_starts_with($r, 'phw_') || str_starts_with($r, 'imx_')) return '';
    if (preg_match('/^mail_(check|addr_)/', $r)) return 'mail_validation';
    if (in_array($r, ['mail_bounce_sync','mail_bounces','mail_unsuppress','mail_contacts_cleanup'], true)) return 'mail_cleanup';
    if (preg_match('/^mail_campaign/', $r) || in_array($r, ['mail_audience','mail_preview','mail_send_test'], true)) return 'mail_campaigns';
    if (preg_match('/^mail_(contacts|contact_|inbox|log|suppress|content_check|deliv)/', $r)) return 'mail_contacts';
    if (in_array($r, ['ai_ask','ai_write','ai_extract','ai_mail','ai_agent','ai_act'], true)) return 'ai'; // v78: the agent follows the same per-person AI block
    if (str_starts_with($r, 'intel_')) return 'ops_intel';
    if (str_starts_with($r, 'jobs_')) return 'job_portals';
    if (in_array($r, ['ats_interview','ats_my_interviews'], true)) return 'interviews';
    if (str_starts_with($r, 'ats_req_') || str_starts_with($r, 'ats_tpl_') || str_starts_with($r, 'ats_posting')) return 'requirements';
    if (str_starts_with($r, 'ats_')) return 'ats';
    if (str_starts_with($r, 'ag_')) return 'screening_agent';
    if (str_starts_with($r, 'ts_')) return 'talent_search';
    if (str_starts_with($r, 'bd_')) return 'bench_sales';
    if (str_starts_with($r, 'tl_')) return 'resume_tailor';
    if (str_starts_with($r, 'rs_')) return 'recruiting_reports';
    if (preg_match('/^(vms_|mkt_)/', $r)) return 'vendors';
    if (str_starts_with($r, 'sq_')) return 'sequences';
    if (str_starts_with($r, 'cr_') || str_starts_with($r, 'cq_')) return 'client_requests'; // v61: cq_ = supplier qualification
    if (str_starts_with($r, 'cw_')) return 'service_pages'; // v61: the website's service pages and case evidence
    if (str_starts_with($r, 'crm_')) return 'crm';
    if (str_starts_with($r, 'imp_') || str_starts_with($r, 'mig_')) return 'imports';
    if (preg_match('/^(src_|cx_|oorwin_|atc_)/', $r)) return 'integrations';
    if (str_starts_with($r, 'hrms_') || str_starts_with($r, 'hrq_')) return 'hrms';
    if (str_starts_with($r, 'onb_')) return 'onboarding';
    if (str_starts_with($r, 'ids_')) return 'id_verification';
    if (str_starts_with($r, 'comp_')) return 'compliance';
    if (str_starts_with($r, 'immnews_')) return 'immigration_news';
    if (str_starts_with($r, 'im_')) return 'immigration';
    if (preg_match('/^(ex_|pr_)/', $r)) return 'exams_practice';
    if (preg_match('/^(learn_|proj_|vault_)/', $r)) return 'learning';
    if (str_starts_with($r, 'es_')) return 'esign';
    if (str_starts_with($r, 'inv_')) return 'invoices';
    if (preg_match('/^(plaid_|qbo_)/', $r)) return 'banking';
    if (str_starts_with($r, 'books_')) return 'books';
    if (str_starts_with($r, 'acct_')) return 'accounting_reports';
    if (str_starts_with($r, 'payroll_')) return 'payroll';
    if (str_starts_with($r, 'pay_')) return 'payroll';
    if (str_starts_with($r, 'bill_')) return 'billing';
    if (str_starts_with($r, 'storage_')) return 'storage';
    if (str_starts_with($r, 'ph_')) return 'phone';
    if (str_starts_with($r, 'chat_')) return 'messages';
    if (str_starts_with($r, 'desk_')) return 'desk';
    if (str_starts_with($r, 'wk_')) return 'work';
    if (str_starts_with($r, 'pf_')) return 'goals';
    return '';
}
/** Blocks always win at the API boundary. Allow is consumed by grantOf()/module checks where supported. */
function featureRouteGuard(string $r, ?array $u): void
{
    if (!$u || hasRole($u, 'admin')) return;
    $k = featureRouteKey($r);
    if ($k !== '' && featureMode((string) $u['id'], $k) === 'block') {
        fail(403, 'feature_blocked', (FEATURE_ACCESS[$k][0] ?? 'This feature') . ' is blocked for your account. An administrator can change it under Roles & access.');
    }
}
/** The saved access entry of a users row: ['portals' => [...], 'cids' => [...]]. */
function accessOf(?array $u): array
{
    $a = $u && isset($u['access']) && is_string($u['access']) && $u['access'] !== '' ? json_decode($u['access'], true) : null;
    $portals = [];
    $cids = [];
    if (is_array($a)) {
        foreach ((array) ($a['portals'] ?? []) as $k) {
            if (!is_string($k)) continue;
            if ($k === 'bench') $k = 'employee'; // v63: the old bench sales portal is the Employee portal
            if (in_array($k, PORTAL_KEYS, true)) {
                $portals[] = $k;
            }
        }
        foreach ((array) ($a['cids'] ?? []) as $c) {
            if (is_string($c) && preg_match('/^[A-Za-z0-9_\-]{1,40}$/', $c)) {
                $cids[] = $c;
            }
        }
    }
    return ['portals' => array_values(array_unique($portals)), 'cids' => array_values(array_unique($cids))];
}
/** Every role a person acts as: the main role plus the roles of the staff portals they were given. */
function rolesOf(?array $u): array
{
    if (!$u) {
        return [];
    }
    if (isset($u['roles']) && is_array($u['roles'])) {
        return $u['roles'];
    }
    $roles = [(string) ($u['role'] ?? 'user')];
    foreach (accessOf($u)['portals'] as $k) {
        if (isset(STAFF_PORTAL_ROLE[$k])) {
            $roles[] = STAFF_PORTAL_ROLE[$k];
        }
    }
    return array_values(array_unique($roles));
}
function hasRole(?array $u, string $role): bool
{
    return in_array($role, rolesOf($u), true);
}
/** A users row by id, with the access column (cached for the request). */
function userRow(string $uid): ?array
{
    static $c = [];
    if (!array_key_exists($uid, $c)) {
        $s = db()->prepare('SELECT id, email, name, role, status, access FROM users WHERE id = ?');
        $s->execute([$uid]);
        $r = $s->fetch();
        $c[$uid] = $r ?: null;
    }
    return $c[$uid];
}
/** Every portal a person may open, staff and member alike, in menu order. */
function portalsOf(array $u): array
{
    $out = [];
    $uid = $u['id'];
    if (hasRole($u, 'admin')) {
        $out = ['admin', 'hr', 'acct', 'mgr'];
    } else {
        foreach (rolesOf($u) as $r) {
            if (isset(ROLE_PORTAL[$r])) {
                $out[] = ROLE_PORTAL[$r];
            }
        }
    }
    $member = portalOf($uid);
    if ($member !== '') {
        $out[] = $member === 'employer' ? 'client' : $member;
    }
    foreach (accessOf($u)['portals'] as $k) {
        if (!isset(STAFF_PORTAL_ROLE[$k])) {
            $out[] = $k;
        }
    }
    if ($member === '' && empty(myR($uid)->ext) && !in_array('consultant', $out, true) && !in_array('client', $out, true) && !in_array('student', $out, true)) {
        $out[] = 'employee'; // staff are StratEdge employees too: clock-ins, timesheets, their own earnings (outside bookkeepers are not)
    }
    $order = array_flip(PORTAL_KEYS);
    $out = array_values(array_unique($out));
    usort($out, fn($a, $b) => $order[$a] <=> $order[$b]);
    return $out;
}
/** v32: the consultant type for the portal (job rules, membership pages); '' for staff and employees. */
function meCt(array $u): string
{
    $role = portalOf($u['id']);
    if (!in_array($role, ['consultant', 'student'], true)) {
        return '';
    }
    require_once __DIR__ . '/rules.php';
    return ruleCtOf($u['id']);
}
/** v32: plan status for students and outside consultants (what the portal shows and unlocks). */
function meBill(array $u): ?array
{
    $ct = meCt($u);
    if ($ct !== 'student' && $ct !== 'outside') {
        return null;
    }
    require_once __DIR__ . '/billing.php';
    $a = billAccess($u['id']);
    return ['st' => $a['st'], 'active' => $a['active'], 'required' => $a['required'], 'feat' => $a['feat'], 'pt' => $a['pt'], 'plans' => $a['plans']];
}
/** v31: who may use Email, inbox & campaigns (the company mailer). */
function mailCanUse(array $u): bool
{
    if (userLevel($u) >= 2) {
        return true;
    }
    $r = myR($u['id']);
    if (!$r || ($r->st ?? '') !== 'active' || in_array($r->role ?? '', ['employer', 'consultant', 'ext', 'student'], true)) {
        return false;
    }
    // Everyone who signs in to the employee portal has Email, inbox & campaigns by default;
    // anyone else on the team when an administrator grants it
    return featureAllowed($u, 'mail_contacts', !empty($r->mm) || in_array('employee', portalsOf($u), true));
}
/** The client workspaces a person belongs to, with names, for the switcher in the client portal. */
function clientsOf(string $uid): array
{
    $out = [];
    foreach (myCids($uid) as $cid) {
        $d = docGet("org/admin/clients/$cid");
        $out[] = ['id' => $cid, 'n' => (string) ($d->n ?? $cid)];
    }
    return $out;
}
/** Client workspaces a person belongs to: the one on their record plus any added under Roles & access or Clients. */
function myCids(string $uid): array
{
    $out = [];
    $c = myCid($uid);
    if ($c !== null) {
        $out[] = $c;
    }
    $row = userRow($uid);
    if ($row) {
        foreach (accessOf($row)['cids'] as $x) {
            $out[] = $x;
        }
    }
    return array_values(array_unique($out));
}
/** v83: the client workspaces a person is a CONTACT of (one of the company's people in the client portal): a client
 *  contact's own and added workspaces, or the workspaces added to someone given the Client portal under Roles & access.
 *  A consultant, employee or student placed at a client (r/{uid}.cid from Admin > Team) works there but is not a contact. */
function clientCids(string $uid): array
{
    if (portalOf($uid) === 'employer') {
        return myCids($uid);
    }
    $row = userRow($uid);
    return $row && in_array('client', accessOf($row)['portals'], true) ? accessOf($row)['cids'] : [];
}
function ruleFor(string $path, ?string $uid): array
{
    $segs = $path === '' ? [] : explode('/', $path);
    $best = null;
    $bestLen = -1;
    foreach (RULES as [$pat, $r, $w]) {
        $ps = $pat === '' ? [] : explode('/', $pat);
        if (count($ps) > count($segs)) {
            continue;
        }
        $ok = true;
        foreach ($ps as $i => $s) {
            if ($s === '{self}') {
                if ($uid === null || $segs[$i] !== $uid) {
                    $ok = false;
                    break;
                }
            } elseif ($s !== $segs[$i]) {
                $ok = false;
                break;
            }
        }
        if ($ok && count($ps) > $bestLen) {
            $best = [$r, $w];
            $bestLen = count($ps);
        }
    }
    return $best ?? ['view', 'interact'];
}
function myR(string $uid): ?stdClass
{
    static $c = [];
    if (!array_key_exists($uid, $c)) {
        $c[$uid] = docGet("r/$uid");
    }
    return $c[$uid];
}
function myCid(string $uid): ?string
{
    $d = myR($uid);
    return $d && isset($d->cid) && is_string($d->cid) && $d->cid !== '' ? $d->cid : null;
}
// Which portal a person belongs to: 'consultant' (placed consultant), 'employee' (StratEdge staff), 'employer' (client contact) or '' when unknown.
function portalOf(string $uid): string
{
    $d = myR($uid);
    $role = (string) ($d->role ?? '');
    if ($role === '') {
        $u = docGet("u/$uid");
        $role = (string) ($u->p->role ?? '');
    }
    if ($role === 'bench') $role = 'employee'; // v63: old bench records are employees
    return in_array($role, ['consultant', 'employee', 'employer', 'student'], true) ? $role : '';
}
const PORTAL_NAMES = [
    'consultant' => 'consultant',
    'employee' => 'employee',
    'employer' => 'client',
    'client' => 'client',
    'student' => 'student',
];
const PORTAL_TITLES = ['admin' => 'Admin portal', 'hr' => 'HR portal', 'acct' => 'Accounting portal', 'mgr' => 'Manager portal', 'employee' => 'Employee portal', 'consultant' => 'Consultant portal', 'client' => 'Client portal', 'student' => 'Student portal'];
/** The login page's portal name (#/login?as=...) as a portal key, or '' when it is not one. */
function portalKeyOfLogin(string $as): string
{
    $k = $as === 'manager' ? 'mgr' : ($as === 'employer' ? 'client' : ($as === 'bench' ? 'employee' : $as));
    return in_array($k, PORTAL_KEYS, true) ? $k : '';
}
/** Where a portal opens: the staff portals and the member views each have their own address. */
function portalHome(string $k): string
{
    return '#/portal/' . $k;
}
/**
 * Every login page is for one portal. An account may only sign in through a login for a portal it has; the one
 * exception is a new account with no profile yet, which may use any member login (consultant, employee, client, student) and is then taken to set up that profile. Returns null when allowed, otherwise the refusal to send.
 */
function portalLoginCheck(array $u, string $asKey): ?array
{
    $mine = portalsOf($u);
    if (in_array($asKey, $mine, true)) {
        return null;
    }
    $member = in_array($asKey, ['employee', 'consultant', 'client', 'student'], true);
    $fresh = portalOf($u['id']) === '' && userLevel($u) < 2 && !hasRole($u, 'manager') && !accessOf($u)['portals'] && !myCids($u['id']);
    if ($member && $fresh) {
        return null;
    }
    $list = array_map(fn($k) => ['k' => $k, 'n' => PORTAL_TITLES[$k] ?? $k, 'login' => $k === 'mgr' ? 'manager' : $k], $mine);
    $first = trim(explode(' ', trim((string) $u['name']))[0] ?? '') ?: 'This';
    $names = array_map(fn($x) => $x['n'], $list);
    $msg = $first . "'s account does not have access to the " . (PORTAL_TITLES[$asKey] ?? $asKey) . '.' . ($names ? ' It can open the ' . implode(', ', $names) . '.' : ' Ask an administrator to set up your access.');
    // noted on the person's sign-in history as a refusal (not as a sign-in)
    docSet("log/{$u['id']}/items/" . rid(6), (object) ['t' => now(), 'ip' => clientIp(), 'ua' => mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 240), 'how' => 'refused:' . $asKey]);
    return ['error' => 'wrong_portal', 'asked' => $asKey, 'askedName' => PORTAL_TITLES[$asKey] ?? $asKey, 'who' => (string) $u['name'], 'email' => (string) $u['email'], 'portals' => $list, 'message' => $msg];
}
// Staff logins: #/login?as=admin, hr, acct or manager. Each accepts only that staff role (administrators can use any).
const STAFF_LOGINS = ['admin' => 'admin', 'hr' => 'hr', 'acct' => 'acct', 'manager' => 'manager'];
const STAFF_LOGIN_NAMES = ['admin' => 'admin', 'hr' => 'HR', 'acct' => 'accounting', 'manager' => 'manager'];
/** Feature grants from a person's Team card (r/{id}.ft), as a plain map. */
function grantsOf(string $uid): array
{
    $d = myR($uid);
    $out = [];
    if ($d && isset($d->ft) && $d->ft instanceof stdClass) {
        foreach (get_object_vars($d->ft) as $k => $v) {
            if ($v && preg_match('/^[a-z_]{1,24}$/', $k)) {
                $out[$k] = true;
            }
        }
    }
    foreach (featureAccessOf($uid) as $k => $m) {
        if ($m === 'allow') $out[$k] = true;
        elseif ($m === 'block') unset($out[$k]);
    }
    return $out;
}
// The recruiting workspace is for StratEdge employees (internal staff), not for placed consultants or client contacts.
function isRecruiter(string $uid): bool
{
    $d = myR($uid);
    return (bool) ($d &&
        ($d->st ?? '') === 'active' &&
        // v83: outside bookkeepers (role 'ext') have the accounting portal only, not the recruiting workspace
        !in_array($d->role ?? '', ['employer', 'consultant', 'ext', 'student'], true) &&
        empty($d->ext) &&
        empty($d->norec));
}
// v63: the bench sales role is folded into Employee. isBench() keeps its name: an active employee has the Bench desk
// (and the recruiting pages, CRM) unless an administrator blocks the "Bench desk" feature for them.
function isBench(string $uid): bool
{
    $row = userRow($uid);
    if (!$row || ($row['status'] ?? '') !== 'active') return false;
    $u = $row + ['roles' => rolesOf($row)];
    // v83: staff roles are given by an administrator; anyone else is an employee only once Team > "Approve access"
    // made their record active (a new sign-up with no approved profile has none of the recruiting workspace)
    if (userLevel($u) < 2 && !hasRole($u, 'manager')) {
        $d = myR($uid);
        if (!$d || ($d->st ?? '') !== 'active' || in_array($d->role ?? '', ['employer', 'consultant', 'ext', 'student'], true)) {
            return featureAllowed($u, 'bench_sales', false);
        }
    }
    $employee = in_array('employee', portalsOf($row), true);
    return featureAllowed($u, 'bench_sales', $employee);
}
/**
 * What is on the server versus what this version expects: the build stamps of index.html and js/app.js, the version
 * label in the bundle, and every shipped file checked against api/manifest.json (written by the build). An upload
 * that stopped halfway, or a browser running an old bundle, shows up here (Admin > System health).
 */
function siteVersionInfo(): array
{
    $root = dirname(__DIR__);
    $head = (string) @file_get_contents($root . '/js/app.js', false, null, 0, 400);
    $jsBuild = preg_match('/APP_BUILD\s*=\s*["\']([A-Za-z0-9._-]+)["\']/', $head, $m) ? $m[1] : '';
    $jsVersion = preg_match('/APP_VERSION\s*=\s*["\']([A-Za-z0-9._-]+)["\']/', $head, $m) ? $m[1] : '';
    $man = json_decode((string) @file_get_contents($root . '/api/manifest.json'), true);
    $missing = [];
    $changed = [];
    $total = 0;
    if (is_array($man) && is_array($man['files'] ?? null)) {
        foreach ($man['files'] as $rel => $size) {
            if (!is_string($rel) || str_contains($rel, '..')) {
                continue;
            }
            $total++;
            $f = $root . '/' . $rel;
            if (!is_file($f)) {
                $missing[] = $rel;
            } elseif ($size !== null && (int) @filesize($f) !== (int) $size) {
                $changed[] = $rel;
            }
            if (count($missing) + count($changed) > 40) {
                break;
            }
        }
    }
    return [
        'html' => siteBuild(),
        'js' => $jsBuild,
        'label' => $jsVersion,
        'manifest' => is_array($man) ? ['version' => (string) ($man['version'] ?? ''), 'build' => (string) ($man['build'] ?? ''), 'total' => $total] : null,
        'missing' => $missing,
        'changed' => $changed,
        'htmlAt' => (int) @filemtime($root . '/index.html'),
        'jsAt' => (int) @filemtime($root . '/js/app.js'),
        'leftovers' => siteLeftovers(),
    ];
}
/** Pre-compressed copies from versions before v30.1 (js/*.gz, css/*.gz). They are harmless once the .htaccess of this version is in place, but LiteSpeed hosts mangled them, so System health offers to delete them. */
function siteLeftovers(): array
{
    $root = dirname(__DIR__);
    $out = [];
    foreach (['js', 'js/vendor', 'js/vendor/pdfjs', 'css'] as $d) {
        foreach ((array) @glob($root . '/' . $d . '/*.gz') as $f) {
            $out[] = substr($f, strlen($root) + 1);
        }
    }
    return $out;
}
/** Counts for the upload banner: missing files, files from another version, and index.html/js/app.js mismatch. Cached briefly. */
function uploadIssues(): array
{
    static $c = null;
    if ($c !== null) {
        return $c;
    }
    $apc = function_exists('apcu_fetch');
    if ($apc) {
        $hit = apcu_fetch('se_upload_issues');
        if (is_array($hit) && (int) ($hit['at'] ?? 0) > time() - 300) {
            return $c = $hit['v'];
        }
    }
    $v = siteVersionInfo();
    $c = [
        'missing' => count($v['missing']),
        'changed' => count($v['changed']),
        'mismatch' => $v['js'] !== '' && $v['html'] !== '' && $v['js'] !== $v['html'],
    ];
    if ($apc) {
        apcu_store('se_upload_issues', ['at' => time(), 'v' => $c], 300);
    }
    return $c;
}
function siteBuild(): string
{
    static $b = null;
    if ($b !== null) {
        return $b;
    }
    $h = @file_get_contents(dirname(__DIR__) . '/index.html');
    $b = $h && preg_match('#app\.js\?v=([A-Za-z0-9._-]+)#', $h, $m) ? $m[1] : '';
    return $b;
}
function isSigner(?stdClass $d, ?string $uid): bool
{
    if (!$d || $uid === null) {
        return false;
    }
    foreach ((array) ($d->signers ?? []) as $s) {
        if (($s->uid ?? '') === $uid) {
            return true;
        }
    }
    return false;
}
function can(string $path, string $mode): bool
{
    $u = currentUser();
    $lvl = userLevel($u);
    $uid = $u['id'] ?? null;
    // v83: the Books audit log is written by the server only (auditLog), and the close date only through books_close
    // and books_settings_save: nobody, administrators included, changes or deletes them through the record routes
    if ($mode === 'w' && ($path === 'org/acct/audit' || str_starts_with($path, 'org/acct/audit/') || $path === 'org/acct/x/books' || str_starts_with($path, 'org/acct/x/books/'))) {
        return false;
    }
    if ($lvl < 2 && str_starts_with($path, 'sig')) {
        // signature requests: a signer may read their own; writes go through the signing endpoints
        if ($mode === 'w' || $uid === null) {
            return false;
        }
        $segs = explode('/', $path);
        if (count($segs) < 2 || $segs[0] !== 'sig') {
            return false;
        }
        // v45.3: also its sender (someone given the E-signatures feature) and e-signature managers
        require_once __DIR__ . '/esign.php';
        return esCanRead(docGet("sig/{$segs[1]}"), $u);
    }
    [$r, $w] = ruleFor($path, $uid);
    $base = $lvl >= LEVELS[$mode === 'r' ? $r : $w];
    $scope = scopeFor($path);
    if ($scope !== null && $uid !== null && !hasRole($u, 'admin')) {
        // a person's own records (pays/{self}, hrms/emp/{self}) and the shared HR settings stay readable for staff too;
        // writing them still needs what the rules allow a regular account (e.g. hrms/self/{self})
        $segs = explode('/', $path);
        $own =
            $base &&
            (in_array($uid, array_slice($segs, 1, 2), true) || str_starts_with($path, 'hrms/x/pub')) &&
            ($mode === 'r' || LEVELS[$w] <= 1);
        if (!($base && $lvl < 2) && !$own) {
            return scopeAllows($scope, $mode, $u, $path);
        }
    } elseif ($scope !== null && $uid === null) {
        return $base;
    }
    if (!$base) {
        return $mode === 'r' && $uid !== null && managerReads($path, $u);
    }
    if ($lvl < 2 && str_starts_with($path, 'pub')) {
        // client workspaces: only people linked to that client
        $segs = explode('/', $path);
        if (count($segs) < 2 || $uid === null || !in_array($segs[1], myCids($uid), true)) {
            return false;
        }
        // v83: someone placed at the client who is not one of its contacts (a consultant): only their own timesheet,
        // attendance and live-status mirrors
        if (!in_array($segs[1], clientCids($uid), true)) {
            $seg3 = (string) ($segs[3] ?? '');
            return count($segs) === 4 && (($segs[2] === 'live' && $seg3 === $uid) || (in_array($segs[2], ['ts', 'att'], true) && str_starts_with($seg3, $uid . '_')));
        }
        // v64: and only the areas the contact's role covers (invoices, timesheets, consultants and attendance)
        $area = ['inv' => 'invoices', 'ts' => 'timesheets', 'roster' => 'consultants', 'live' => 'consultants'][(string) ($segs[2] ?? '')] ?? '';
        if ($area !== '') {
            require_once __DIR__ . '/corp.php';
            require_once __DIR__ . '/corpacc.php';
            if (!caMay(caAccess($u, (string) $segs[1]), $area, $mode === 'w' ? 'w' : 'r')) {
                return false;
            }
        }
    }
    if ($lvl < 2 && ($path === 'rec' || str_starts_with($path, 'rec/') || $path === 'vms' || str_starts_with($path, 'vms/') || str_starts_with($path, 'org/mkt'))) {
        // recruiting workspace and the requirements desk: internal recruiters and recruiting team only
        if ($uid === null || (!isRecruiter($uid) && !isBench($uid))) {
            return false;
        }
    }
    if ($lvl < 2 && str_starts_with($path, 'org/box')) {
        // the shared box: StratEdge staff and employees, not consultants or client contacts
        if ($uid === null || !isRecruiter($uid)) {
            return false;
        }
    }
    // v83: the shared box: a note and its files are changed or removed only by the person who added it, or an
    // administrator (as storage_box_delete); a new note can still be added by anyone who may write the box
    if ($mode === 'w' && $uid !== null && !hasRole($u, 'admin') && preg_match('#^org/box/items/([^/]+)#', $path, $bm)) {
        $item = docGet('org/box/items/' . $bm[1]);
        if ($item && (string) ($item->by ?? '') !== (string) $uid) {
            return false;
        }
    }
    return true;
}

/** Records that belong to the books: invoices, bills, paystubs, payroll runs and everything under org/acct. */
function financialPath(string $path): bool
{
    foreach (['inv/', 'exp/', 'pays/', 'org/acct/'] as $p) {
        if (str_starts_with($path, $p)) {
            return !str_starts_with($path, 'org/acct/audit/') && !preg_match('#/f/[^/]+$#', $path);
        }
    }
    return false;
}
/** The books settings: close date and fiscal year start (Admin > Books > Settings). */
function booksSettings(): array
{
    static $c = null;
    if ($c === null) {
        $d = docGet('org/acct/x/books');
        $c = ['close' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($d->close ?? '')) ? (string) $d->close : '', 'fy' => max(1, min(12, (int) ($d->fy ?? 1))), 'closedBy' => (string) ($d->closedBy ?? ''), 'closedAt' => (int) ($d->closedAt ?? 0)];
    }
    return $c;
}
/** The date a financial record belongs to, for the close-the-books check. */
// v83: every date the record posts on (as booksEntries posts it), not only the first date-shaped field: a stray date
// on a bill or paystub no longer hides the one it posts on, and a bill's payment or an invoice's payments are checked too
function recordDates(string $path, ?stdClass $d): array
{
    if (!$d) {
        return [];
    }
    $out = [];
    $add = function ($v) use (&$out): void {
        if (is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) {
            $out[] = $v;
        }
    };
    if (str_starts_with($path, 'inv/')) {
        // an invoice posts on its issue date, each payment on its own date
        $add($d->issue ?? null);
        foreach ((array) ($d->pays ?? []) as $p) {
            if ($p instanceof stdClass) {
                $add($p->dt ?? null);
            }
        }
        return $out;
    }
    if (str_starts_with($path, 'exp/')) {
        // a bill posts on its date, its payment on the paid date
        $add($d->d ?? null);
        $add($d->paidOn ?? null);
        return $out;
    }
    foreach (['issue', 'd', 'dt', 'paidOn', 'payDate'] as $k) {
        $add($d->$k ?? null);
    }
    // a paystub posts on its run's pay date
    if (preg_match('#^pays/[^/]+/items/([^/]+)$#', $path, $m) && ($run = docGet('org/acct/runs/' . $m[1]))) {
        $add($run->payDate ?? null);
        $add($run->paidOn ?? null);
    }
    // older records with no date: the pay period in the path (a fallback only, so a late-June run paid in July stays open)
    if (!$out && preg_match('#^(?:pays/[^/]+/items|org/acct/runs)/(\d{4}-\d{2})(?:-(\d{1,2}))?$#', $path, $m)) {
        $out[] = $m[1] . '-' . (isset($m[2]) ? (strlen($m[2]) === 1 ? ($m[2] === '1' ? '01' : '16') : $m[2]) : '01');
    }
    return $out;
}
/** Writes to a closed period are refused unless an administrator reopens the books (Admin > Books > Settings).
 *  v83: recording a payment dated after the close on an invoice or bill from a closed period is allowed ($after = the
 *  record as it will be saved); the payment posts on its own date, so nothing in the closed period changes. */
function booksGuard(string $path, ?stdClass $d, ?stdClass $after = null): void
{
    $bs = booksSettings();
    if ($bs['close'] === '') {
        return;
    }
    $prev = docGet($path);
    $closed = false;
    // the record as it will be saved (an update's patch merged into the stored one) and as it was
    foreach (array_merge(recordDates($path, $after ?? $d), recordDates($path, $prev)) as $dt) {
        if ($dt <= $bs['close']) {
            $closed = true;
            break;
        }
    }
    if ($closed && $prev && $after && booksLatePayment($path, $prev, $after, $bs['close'])) {
        return;
    }
    if ($closed) {
        fail(423, 'books_closed', 'The books are closed through ' . fmtCloseDate($bs['close']) . '. ' . (hasRole(currentUser(), 'admin') ? 'Reopen them under Books › Settings before changing this record.' : 'An administrator can reopen them under Books › Settings.'));
    }
}
/** v83: the only change is a payment dated after the close: new pays[] entries on an invoice (earlier payments and log
 *  lines kept as they were), or an unpaid bill marked paid; every other field stays as it was. */
function booksLatePayment(string $path, stdClass $prev, stdClass $after, string $close): bool
{
    $inv = (bool) preg_match('#^inv/[^/]+$#', $path);
    if (!$inv && !preg_match('#^exp/[^/]+$#', $path)) {
        return false;
    }
    $may = $inv ? ['paid', 'st', 'pays', 'log', 'u'] : ['st', 'od', 'paidOn', 'paidAt', 'm', 'ref', 'u'];
    $same = fn($x, $y): bool => is_numeric($x) && is_numeric($y) ? abs((float) $x - (float) $y) < 0.005 : json_encode($x) === json_encode($y);
    $a = get_object_vars($after);
    $b = get_object_vars($prev);
    foreach (array_unique(array_merge(array_keys($a), array_keys($b))) as $k) {
        if (!in_array($k, $may, true) && !$same($a[$k] ?? null, $b[$k] ?? null)) {
            return false;
        }
    }
    $late = fn($v): bool => is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) === 1 && $v > $close;
    if ($inv) {
        foreach (['pays', 'log'] as $k) {
            $old = array_values((array) ($prev->$k ?? []));
            $new = array_values((array) ($after->$k ?? []));
            if (count($new) < count($old) || json_encode(array_slice($new, 0, count($old))) !== json_encode($old)) {
                return false; // earlier payments and log lines stay as they were
            }
        }
        $added = array_slice(array_values((array) ($after->pays ?? [])), count((array) ($prev->pays ?? [])));
        if (!$added) {
            return false;
        }
        $sum = 0.0;
        foreach ($added as $p) {
            if (!($p instanceof stdClass) || !$late($p->dt ?? '') || !is_numeric($p->a ?? null) || (float) $p->a <= 0) {
                return false;
            }
            $sum += (float) $p->a;
        }
        // the amount received goes up by exactly the payments added
        if (abs((float) ($after->paid ?? 0) - (float) ($prev->paid ?? 0) - $sum) >= 0.005) {
            return false;
        }
        return in_array((string) ($after->st ?? ''), ['paid', 'part'], true);
    }
    return (string) ($after->st ?? '') === 'paid' && (string) ($prev->st ?? '') !== 'paid' && $late($after->paidOn ?? '');
}
/** v83: a bank line of a finished reconciliation keeps its amount, date, account and cleared state, and is not deleted
 *  ($data null = delete; $replace = a full set, where a missing field counts as a change). Notes, receipts and
 *  categorizing stay open (books_line has its own check). */
function bankReconGuard(string $path, ?stdClass $data, bool $replace): void
{
    if (!preg_match('#^org/acct/bank/[^/]+$#', $path)) {
        return;
    }
    $prev = docGet($path);
    if (!$prev || empty($prev->recon)) {
        return;
    }
    if ($data === null) {
        fail(423, 'reconciled', 'This bank line is part of a finished reconciliation and cannot be deleted.');
    }
    $v = fn(stdClass $o, string $k) => in_array($k, ['excl', 'clr'], true) ? !empty($o->$k) : ($k === 'a' ? round((float) ($o->$k ?? 0), 2) : (string) ($o->$k ?? ''));
    foreach (['a', 'dt', 'acct', 'cur', 'excl', 'clr', 'recon'] as $k) {
        if (($replace || property_exists($data, $k)) && $v($data, $k) !== $v($prev, $k)) {
            fail(423, 'reconciled', 'This bank line is part of a finished reconciliation: its amount, date, account and cleared state cannot change.');
        }
    }
}
/** v83: a time-off request someone has decided (approved or declined, r/{uid}.lvd[id]) keeps its type, dates and note
 *  when the person writes their own record (u/{uid}); they can still withdraw it (x). New and pending requests stay
 *  editable. $before = the stored record, $data = the record as it will be saved. */
function leaveLockDecided(string $uid, ?stdClass $before, stdClass $data): void
{
    $prev = $before && ($before->lv ?? null) instanceof stdClass ? $before->lv : null;
    $dec = docGet("r/$uid")->lvd ?? null;
    if (!$prev || !($dec instanceof stdClass)) {
        return;
    }
    foreach (get_object_vars($prev) as $id => $was) {
        if (!isset($dec->$id) || !($was instanceof stdClass)) {
            continue;
        }
        if (!(($data->lv ?? null) instanceof stdClass)) {
            $data->lv = new stdClass();
        }
        $now = $data->lv->$id ?? null;
        $keep = clone $was;
        if ($now instanceof stdClass && !empty($now->x)) {
            $keep->x = 1;
        }
        $data->lv->$id = $keep;
    }
}
function fmtCloseDate(string $d): string
{
    $t = strtotime($d . ' 12:00:00');
    return $t ? date('M j, Y', $t) : $d;
}
/** The fields that changed between two versions of a record, for the audit log (values shortened). */
function auditDiff(?stdClass $before, ?stdClass $after): array
{
    $out = [];
    $b = $before ? (array) $before : [];
    $a = $after ? (array) $after : [];
    foreach (array_unique(array_merge(array_keys($b), array_keys($a))) as $k) {
        if (in_array($k, ['u', 'at', 'log', 'pays', 'lines'], true)) {
            continue;
        }
        $x = json_encode($b[$k] ?? null);
        $y = json_encode($a[$k] ?? null);
        if ($x !== $y) {
            $out[$k] = ['from' => mb_substr((string) $x, 0, 80), 'to' => mb_substr((string) $y, 0, 80)];
        }
        if (count($out) >= 12) {
            break;
        }
    }
    return $out;
}
/** Bookkeeper limits (Roles & access): r.books = full | view | reports, r.nopay = no payroll. */
function acctLimits(?array $u): array
{
    static $c = [];
    if (!$u) {
        return ['books' => 'full', 'nopay' => false];
    }
    if (!isset($c[$u['id']])) {
        $r = myR($u['id']);
        $books = (string) ($r->books ?? 'full');
        $c[$u['id']] = ['books' => in_array($books, ['view', 'reports'], true) ? $books : 'full', 'nopay' => !empty($r->nopay)];
    }
    return $c[$u['id']];
}
function payrollPath(string $path): bool
{
    return str_starts_with($path, 'pays') || str_starts_with($path, 'org/acct/runs') || str_starts_with($path, 'org/acct/taxdep') || in_array($path, ['org/acct/x/plans', 'org/acct/x/pto', 'org/acct/x/ach'], true);
}
/** The scope entry that covers a path, if any (the longest matching prefix wins). */
function scopeFor(string $path): ?array
{
    $best = null;
    $bestLen = -1;
    foreach (SCOPES as $prefix => $rw) {
        if (($path === $prefix || str_starts_with($path, $prefix . '/')) && strlen($prefix) > $bestLen) {
            $best = $rw;
            $bestLen = strlen($prefix);
        }
    }
    return $best;
}
/** A feature switched on for a person from their Team card (r/{id}.ft.{key}). */
function grantOf(string $uid, string $key): bool
{
    $fm = featureMode($uid, $key);
    if ($fm === 'block') return false;
    if ($fm === 'allow') return true;
    $d = myR($uid);
    return (bool) ($d && isset($d->ft) && $d->ft instanceof stdClass && !empty($d->ft->$key));
}
function scopeAllows(array $scope, string $mode, ?array $u, string $path = ''): bool
{
    if (!$u) {
        return false;
    }
    if (hasRole($u, 'admin')) {
        return true;
    }
    foreach ($scope[$mode === 'r' ? 0 : 1] as $who) {
        if ($who === 'bench') {
            if (isBench($u['id'])) {
                return true;
            }
        } elseif (str_starts_with($who, 'grant:')) {
            if (grantOf($u['id'], substr($who, 6))) {
                return true;
            }
        } elseif (hasRole($u, $who)) {
            if ($who === 'acct' && $path !== '') {
                // bookkeepers: view-only or reports-only books, and optionally no payroll at all
                $lim = acctLimits($u);
                if ($lim['nopay'] && payrollPath($path)) {
                    continue;
                }
                if ($mode === 'w' && $lim['books'] !== 'full' && financialPath($path)) {
                    continue;
                }
            }
            return true;
        }
    }
    return false;
}
/** Managers (Team card: staff access "Manager") read the records of the people who report to them. */
function managedBy(string $uid, string $other): bool
{
    if ($uid === $other) {
        return false;
    }
    $d = myR($other);
    return (bool) ($d && ($d->mgrId ?? '') === $uid && ($d->st ?? '') === 'active');
}
function managerReads(string $path, array $u): bool
{
    if (!hasRole($u, 'manager')) {
        return false;
    }
    $segs = explode('/', $path);
    if (count($segs) < 2 || !in_array($segs[0], ['u', 'r', 'e', 'log'], true)) {
        return false;
    }
    return managedBy($u['id'], $segs[1]);
}
/**
 * v83: an approved timesheet week is locked. The person's own writes may not change (or delete) the week record
 * u/{uid}/ts/{week} or its line in the u/{uid}.ts summary while r/{uid}.rev[week] approves that version; staff
 * (administrators, HR, accounting) still may, and a reopened or returned week is editable again.
 */
function tsLockedWeeks(string $uid, $ud, array $weeks): array
{
    $r = docGet("r/$uid");
    $out = [];
    foreach ($weeks as $w) {
        $w = (string) $w;
        $rev = $r && isset($r->rev) && $r->rev instanceof stdClass ? $r->rev->$w ?? null : null;
        $sum = $ud && isset($ud->ts) && $ud->ts instanceof stdClass ? $ud->ts->$w ?? null : null;
        if ($rev instanceof stdClass && $sum instanceof stdClass && ($rev->s ?? '') === 'approved' && ($sum->s ?? '') === 'submitted' && (int) ($rev->v ?? -1) === (int) ($sum->u ?? -2)) {
            $out[] = $w;
        }
    }
    return $out;
}
function tsApprovedTamper(string $path, $before, $after, ?array $u): bool
{
    if (!str_starts_with($path, 'u/') || userLevel($u) >= 2) {
        return false;
    }
    if (preg_match('#^u/([^/]+)/ts/([^/]+)$#', $path, $m)) {
        return tsLockedWeeks($m[1], docGet('u/' . $m[1]), [$m[2]]) && json_encode($before) !== json_encode($after);
    }
    if (preg_match('#^u/([^/]+)$#', $path, $m) && ($before->ts ?? null) instanceof stdClass) {
        $at = $after->ts ?? null;
        foreach (tsLockedWeeks($m[1], $before, array_keys(get_object_vars($before->ts))) as $w) {
            if (json_encode($before->ts->$w) !== json_encode($at instanceof stdClass ? $at->$w ?? null : null)) {
                return true;
            }
        }
    }
    return false;
}
/** A manager may merge approvals and tasks into a direct report's record, nothing else. */
function managerWrites(string $path, array $u, stdClass $patch): bool
{
    if (!hasRole($u, 'manager')) {
        return false;
    }
    $segs = explode('/', $path);
    if (count($segs) !== 2 || $segs[0] !== 'r' || !managedBy($u['id'], $segs[1])) {
        return false;
    }
    foreach (array_keys(get_object_vars($patch)) as $k) {
        if (!in_array($k, MANAGER_KEYS, true)) {
            return false;
        }
    }
    return true;
}
/**
 * Managers read their direct reports' records, but not pay, tax, bill rates or feature switches.
 * Applied to every record the API returns.
 */
function redactDoc(string $path, $d)
{
    $u = currentUser();
    // placements: bill and pay rates (and commissions) are for administrators, HR and accounting
    if ($d instanceof stdClass && str_starts_with($path, 'rec/place/items/') && !($u && (hasRole($u, 'admin') || hasRole($u, 'hr') || hasRole($u, 'acct')))) {
        unset($d->pay, $d->bill, $d->comm);
    }
    // v32: course records keep their quiz answers; learners get the quizzes through learn_course (answers removed)
    if ($d instanceof stdClass && str_starts_with($path, 'learn/x/courses/') && userLevel($u) < 2) {
        unset($d->mods);
    }
    // v45.3: a signer who is not the sender reads the request without the other signers' email links and network
    // addresses, and without its log
    if ($d instanceof stdClass && $u && userLevel($u) < 2 && preg_match('#^sig/[^/]+$#', $path) && (string) ($d->by ?? '') !== (string) $u['id']) {
        require_once __DIR__ . '/esign.php';
        if (!esMayManage($u)) {
            foreach ((array) ($d->signers ?? []) as $sg) {
                if ($sg instanceof stdClass && (string) ($sg->uid ?? '') !== (string) $u['id']) {
                    unset($sg->tok, $sg->ip, $sg->ua);
                }
            }
            unset($d->log);
        }
    }
    // only someone who is a manager and nothing more is kept from pay and tax details
    if (!$u || !hasRole($u, 'manager') || userLevel($u) >= 2 || !($d instanceof stdClass)) {
        return $d;
    }
    $segs = explode('/', $path);
    if (count($segs) === 2 && $segs[0] === 'r' && $segs[1] !== $u['id']) {
        foreach (['pay', 'tax', 'payAdj', 'ft', 'br', 'brc', 'payAt'] as $k) {
            unset($d->$k);
        }
    }
    return $d;
}
function isManager(?array $u): bool
{
    return (bool) ($u && hasRole($u, 'manager'));
}

/** Which single-sign-on providers are switched on (shown as buttons on the login page). */
/** v38: the address this request came in on, when it is one of the site's own: scheme, host and, for a workspace at
 *  /w/<name>/, that path. A sign-in with Google, LinkedIn or Microsoft starts and ends on the same address (the session
 *  cookie belongs to it), and Google's own button is verified per address. StratEdge's own site keeps its configured
 *  address (config.php site_url), as before. */
/** v41: on the developer computer only (the SE_EXT_MOCK environment variable is set there), calls to Google, Microsoft
 *  and other outside services go to the local stand-in instead: https://host/path → <stand-in>/host/path. A live site
 *  never has it set, so every address is used as written. */
function extUrl(string $url): string
{
    $m = (string) getenv('SE_EXT_MOCK');
    if ($m === '' || !preg_match('#^https://([A-Za-z0-9.-]+)(/.*)?$#', $url, $x)) {
        return $url;
    }
    return rtrim($m, '/') . '/' . strtolower($x[1]) . ($x[2] ?? '/');
}
function ssoBase(): string
{
    $main = siteUrl();
    $ws = wsCurrent();
    if (!$ws || !empty($ws['missing'])) {
        return $main;
    }
    $hostPort = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
    if ($hostPort === '' || !preg_match('/^[a-z0-9.-]+(:\d{1,5})?$/', $hostPort)) {
        return $main;
    }
    $host = (string) preg_replace('/:\d+$/', '', $hostPort);
    $local = in_array($host, ['localhost', '127.0.0.1'], true) || str_ends_with($host, '.localhost');
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    // the hosting serves the site over https; only a developer's own computer runs plain http
    $scheme = $local ? ($https ? 'https' : 'http') : ($https || str_starts_with($main, 'https://') ? 'https' : 'http');
    $mode = (string) ($ws['mode'] ?? '');
    if ($mode === 'path') {
        // /w/<name>/ on the provider's own host (with or without www.); any other host pointed here uses the main address
        $bare = str_starts_with($host, 'www.') ? substr($host, 4) : $host;
        if (!$local && $bare !== wsMainHost()) {
            return $main;
        }
        $path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
        if (!preg_match('#^(/(?:[A-Za-z0-9._-]+/)*?)w/' . preg_quote((string) $ws['slug'], '#') . '(?:/|$)#', $path, $m)) {
            return $main;
        }
        return $scheme . '://' . $hostPort . $m[1] . 'w/' . $ws['slug'] . '/';
    }
    if ($mode === 'sub' || $mode === 'host') {
        // wsCurrent() only matches the workspace's own subdomain or one of its registered hosts
        return $scheme . '://' . $hostPort . '/';
    }
    return $main;
}
/** The origin (scheme and host, no path) of a base address: what Google calls an "Authorized JavaScript origin". */
function ssoOriginOf(string $base): string
{
    $u = parse_url($base);
    return !empty($u['host']) ? ($u['scheme'] ?? 'https') . '://' . $u['host'] . (!empty($u['port']) ? ':' . $u['port'] : '') : rtrim($base, '/');
}
/** Every address people may use for this site or workspace, for registering each with the sign-in providers:
 *  [{base, origin, redirect, here, main}]. */
function ssoAddrs(): array
{
    $here = ssoBase();
    $main = siteUrl();
    $bases = [$main];
    $ws = wsCurrent();
    if ($ws && empty($ws['missing'])) {
        $slug = (string) $ws['slug'];
        $root = rtrim((string) (cfgRaw()['site_url'] ?? ''), '/');
        if ($root !== '') {
            $bases[] = $root . '/w/' . $slug . '/';
        }
        if (!empty($ws['sub']) && wsMainHost() !== '') {
            $bases[] = 'https://' . $slug . '.' . wsMainHost() . '/';
        }
        foreach ((array) ($ws['hosts'] ?? []) as $h) {
            if (is_string($h) && $h !== '') {
                $bases[] = 'https://' . $h . '/';
            }
        }
    }
    $bases[] = $here;
    $out = [];
    foreach (array_values(array_unique($bases)) as $b) {
        $out[] = ['base' => $b, 'origin' => ssoOriginOf($b), 'redirect' => $b . 'api/index.php?r=sso_cb', 'here' => $b === $here, 'main' => $b === $main];
    }
    return $out;
}
/** Whether Google's own button was verified on this address (v38: per address; before v38 one mark for the site). */
function ssoGisHere(?stdClass $g): bool
{
    if (!$g) {
        return false;
    }
    $origins = isset($g->gisOrigins) && is_array($g->gisOrigins) ? $g->gisOrigins : null;
    if ($origins !== null) {
        return in_array(ssoOriginOf(ssoBase()), $origins, true);
    }
    // a mark from before v38 was made on the site's configured address: it still counts there on StratEdge's own site;
    // a workspace verifies again, address by address
    return !empty($g->gisOk) && wsSlug() === '';
}
function ssoPublic(): array
{
    $d = docGet('sec/x/sso/cfg');
    $out = [];
    foreach (['google' => 'Google', 'linkedin' => 'LinkedIn', 'microsoft' => 'Microsoft'] as $k => $n) {
        if ($d && isset($d->$k) && $d->$k instanceof stdClass && !empty($d->$k->on) && !empty($d->$k->id)) {
            $row = ['k' => $k, 'n' => $n];
            if ($k === 'google') {
                // the client id is public by design; "gis" = draw Google's own button on the page (needs the site
                // address under Authorized JavaScript origins), otherwise the classic redirect button
                $row['cid'] = (string) $d->$k->id;
                // only once an administrator has clicked Google's button successfully in the settings test
                // (sso_gis_verify): Google draws a button even for an unregistered address, and it then does nothing
                // v38: verified on this very address (a workspace can be reached at several)
                $row['gis'] = (!isset($d->$k->gis) || !empty($d->$k->gis)) && ssoGisHere($d->$k);
            }
            $out[] = $row;
        }
    }
    return $out;
}

/* ---------- documents ---------- */
function docRow(string $path): ?array
{
    $s = db()->prepare('SELECT data, seq FROM docs WHERE path = ?');
    $s->execute([$path]);
    $r = $s->fetch();
    return $r ?: null;
}
/** v69: a person's email signature (plain text, kept on their record as u/<uid>.sig). */
function sigOf(string $uid): string
{
    if ($uid === '') {
        return '';
    }
    $d = docGet('u/' . $uid);
    return $d ? trim((string) ($d->sig ?? '')) : '';
}
/** v69: a signature made from the person's details: name, title, company, phone, email, the website. */
function sigAutoOf(array $u): string
{
    $d = docGet('u/' . (string) $u['id']);
    $p = $d->p ?? null;
    $brand = emailBrand();
    $lines = [(string) ($u['name'] ?? '')];
    $ti = trim((string) ($p->ti ?? ''));
    $co = (string) ($brand['name'] ?? 'StratEdge IT Consulting');
    $lines[] = trim($ti . ($ti !== '' && $co !== '' ? ' · ' : '') . $co);
    $ph = trim((string) ($p->ph ?? ''));
    $em = (string) ($u['email'] ?? '');
    $lines[] = trim($ph . ($ph !== '' && $em !== '' ? ' · ' : '') . $em);
    $lines[] = rtrim(siteUrl(), '/');
    return implode("\n", array_values(array_filter($lines, fn($l) => trim($l) !== '')));
}
function docGet(string $path): ?stdClass
{
    $r = docRow($path);
    if (!$r) {
        return null;
    }
    $d = json_decode($r['data']);
    return $d instanceof stdClass ? $d : new stdClass();
}
function docSet(string $path, stdClass $data): void
{
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (strlen($json) > 600000) {
        fail(400, 'invalid_argument', 'That record is too large.');
    }
    $col = substr($path, 0, (int) strrpos($path, '/'));
    $p = db();
    // v38.1: inside dbBatch() (an import writing many records) the batch's transaction is used
    $own = !$p->inTransaction();
    if ($own) {
        $p->beginTransaction();
    }
    try {
        $seq = nextSeq();
        $p->prepare('REPLACE INTO docs (path, col, data, seq, updated) VALUES (?,?,?,?,?)')->execute([
            $path,
            $col,
            $json,
            $seq,
            now(),
        ]);
        if ($own) {
            $p->commit();
        }
    } catch (Throwable $e) {
        if ($own) {
            $p->rollBack();
        }
        throw $e;
    }
}
/**
 * v38.1: many writes in one transaction (an import step): far fewer disk syncs than one per record, and either all of
 * the step is saved or none of it. On SQLite the first statement is a write, so the write lock is taken before anything
 * is read (a busy database waits here, up to the busy timeout, instead of failing half way on a stale snapshot).
 */
function dbBatch(callable $fn): mixed
{
    $p = db();
    if ($p->inTransaction()) {
        return $fn();
    }
    $p->beginTransaction();
    try {
        if ($p->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite') {
            $p->exec("UPDATE meta SET v = v WHERE k = 'seq'");
        }
        $out = $fn();
        $p->commit();
        return $out;
    } catch (Throwable $e) {
        if ($p->inTransaction()) {
            $p->rollBack();
        }
        throw $e;
    }
}
function mergeInto(stdClass $t, stdClass $patch): void
{
    foreach (get_object_vars($patch) as $k => $v) {
        if ($v instanceof stdClass && isset($t->$k) && $t->$k instanceof stdClass) {
            mergeInto($t->$k, $v);
        } else {
            $t->$k = $v;
        }
    }
}
function docDelete(string $path): void
{
    $p = db();
    $own = !$p->inTransaction();
    if ($own) {
        $p->beginTransaction();
    }
    try {
        nextSeq();
        $p->prepare('DELETE FROM docs WHERE path = ?')->execute([$path]);
        if ($own) {
            $p->commit();
        }
    } catch (Throwable $e) {
        if ($own) {
            $p->rollBack();
        }
        throw $e;
    }
}
function colVersion(string $col): string
{
    $s = db()->prepare('SELECT COALESCE(MAX(seq),0) AS m, COUNT(*) AS c FROM docs WHERE col = ?');
    $s->execute([$col]);
    $r = $s->fetch();
    return $r['m'] . '-' . $r['c'];
}
/**
 * What changed in a collection since a sequence number the client already has: the changed records (readable ones,
 * redacted like colList) and the ids of every readable record, so the client can drop deletions. Sent instead of the
 * whole collection on every change, which keeps busy admin pages light when one timesheet or clock-in changes.
 */
function colDelta(string $col, int $since, string $only = ''): array
{
    // ids first (paths only, no record bodies), then the bodies of what actually changed
    $f = colOnlySql($only);
    $s = db()->prepare('SELECT path FROM docs WHERE col = ?' . $f);
    $s->execute([$col]);
    $ids = [];
    while ($r = $s->fetch()) {
        if (can($r['path'], 'r')) {
            $ids[] = substr($r['path'], strrpos($r['path'], '/') + 1);
        }
    }
    $docs = [];
    $s = db()->prepare('SELECT path, data FROM docs WHERE col = ? AND seq > ?' . $f);
    $s->execute([$col, $since]);
    while ($r = $s->fetch()) {
        if (!can($r['path'], 'r')) {
            continue;
        }
        $d = json_decode($r['data']);
        if (!($d instanceof stdClass)) {
            $d = new stdClass();
        }
        $docs[] = [substr($r['path'], strrpos($r['path'], '/') + 1), redactDoc($r['path'], $d)];
    }
    return ['docs' => $docs, 'ids' => $ids];
}
/** Every document in a collection, unfiltered: for server-side modules that have already checked the caller (never echo this to a client as-is). */
function colAll(string $col, ?string $orderBy = null, string $dir = 'asc'): array
{
    $s = db()->prepare('SELECT path, data FROM docs WHERE col = ?');
    $s->execute([$col]);
    $out = [];
    while ($r = $s->fetch()) {
        $d = json_decode($r['data']);
        if (!($d instanceof stdClass)) {
            $d = new stdClass();
        }
        $out[] = [substr($r['path'], strrpos($r['path'], '/') + 1), $d];
    }
    if ($orderBy !== null && $orderBy !== '') {
        $f = $orderBy;
        $desc = $dir === 'desc';
        usort($out, function ($a, $b) use ($f, $desc) {
            $x = $a[1]->$f ?? null;
            $y = $b[1]->$f ?? null;
            if ($x === null && $y === null) {
                return strcmp($a[0], $b[0]);
            }
            if ($x === null) {
                return 1;
            }
            if ($y === null) {
                return -1;
            }
            $c = $x <=> $y;
            return $desc ? -$c : $c;
        });
    }
    return $out;
}
/** v36.2: a named filter a page may ask for: "nolite" leaves out records saved by a search that nobody has worked
 *  with yet (ATS: lite=1), which a big talent pool would otherwise send to every ATS page. */
function colOnlySql(string $only): string
{
    return $only === 'nolite' ? " AND data NOT LIKE '%\"lite\":1%'" : '';
}
function colList(string $col, ?string $orderBy, string $dir, int $limit, string $only = ''): array
{
    $s = db()->prepare('SELECT path, data FROM docs WHERE col = ?' . colOnlySql($only));
    $s->execute([$col]);
    $out = [];
    while ($r = $s->fetch()) {
        if (!can($r['path'], 'r')) {
            continue;
        }
        $d = json_decode($r['data']);
        if (!($d instanceof stdClass)) {
            $d = new stdClass();
        }
        $out[] = [substr($r['path'], strrpos($r['path'], '/') + 1), redactDoc($r['path'], $d)];
    }
    if ($orderBy !== null && $orderBy !== '') {
        $f = $orderBy;
        $desc = $dir === 'desc';
        usort($out, function ($a, $b) use ($f, $desc) {
            $x = $a[1]->$f ?? null;
            $y = $b[1]->$f ?? null;
            if ($x === null && $y === null) {
                return strcmp($a[0], $b[0]);
            }
            if ($x === null) {
                return 1;
            }
            if ($y === null) {
                return -1;
            }
            $c = is_numeric($x) && is_numeric($y) ? $x <=> $y : strcmp((string) $x, (string) $y);
            return $desc ? -$c : $c;
        });
    } else {
        usort($out, fn($a, $b) => strcmp($a[0], $b[0]));
    }
    if ($limit > 0) {
        $out = array_slice($out, 0, $limit);
    }
    return $out;
}

/* ---------- users & sessions ---------- */
function currentUser(): ?array
{
    static $u = false;
    if ($u !== false) {
        return $u;
    }
    $u = null;
    if (!empty($_SESSION['uid'])) {
        $s = db()->prepare('SELECT id, email, name, role, status, access FROM users WHERE id = ?');
        $s->execute([$_SESSION['uid']]);
        $r = $s->fetch();
        if ($r && $r['status'] === 'active') {
            $r['roles'] = rolesOf($r);
            // v34: the session must still be open in the register (idle and absolute limits, sign out everywhere)
            if (sessCheck($r)) {
                $u = $r;
                $GLOBALS['secUser'] = $u;
            }
        } else {
            unset($_SESSION['uid']);
        }
    }
    return $u;
}
function requireUser(): array
{
    $u = currentUser();
    if (!$u) {
        $why = (string) ($GLOBALS['authEnded'] ?? '');
        fail(401, 'unauthenticated', match ($why) {
            '' => 'Log in to continue.',
            'idle' => 'You were signed out after a while without activity. Log in again to continue.',
            'expired' => 'Your session reached its time limit. Log in again to continue.',
            // v35
            'network' => 'Staff accounts work only from the office networks. Log in again from one of them.',
            'device' => 'Your session was ended because it was used from another browser. Log in again, and change your password if that was not you.',
            default => 'Your session was ended. Log in again to continue.',
        });
    }
    return $u;
}
function requireAdmin(): array
{
    $u = requireUser();
    if (userLevel($u) < 2) {
        fail(403, 'invalid_argument', 'Staff access is required.');
    }
    return $u;
}
function requireJobsStaff(): array
{
    $u = requireUser();
    if (userLevel($u) >= 2 || isBench($u['id'])) {
        return $u;
    }
    fail(403, 'forbidden', 'Employee or staff access is required.');
}
/** v38: the portals' looks, and the one everyone starts in (an administrator's choice; Glass until one is made) */
const LOOKS = ['glass', 'classic'];
function lookDefault(): string
{
    try {
        $v = (string) secKv('look_default', 'glass');
    } catch (Throwable $e) {
        return 'glass';
    }
    return in_array($v, LOOKS, true) ? $v : 'glass';
}
function publicUser(array $u): array
{
    return [
        'id' => $u['id'],
        'name' => $u['name'],
        'email' => $u['email'],
        'role' => $u['role'],
        'roles' => rolesOf($u),
        'portals' => portalsOf($u),
        'cids' => myCids($u['id']),
        'status' => $u['status'],
    ];
}
function throttleHit(string $key, int $max, int $windowSec): bool
{
    // true when over the limit
    $p = db();
    $t = now();
    $s = $p->prepare('SELECT n, until FROM throttle WHERE k = ?');
    $s->execute([$key]);
    $r = $s->fetch();
    if (!$r || (int) $r['until'] < $t) {
        $p->prepare('REPLACE INTO throttle (k, n, until) VALUES (?,?,?)')->execute([
            $key,
            1,
            $t + $windowSec * 1000,
        ]);
        return false;
    }
    $p->prepare('UPDATE throttle SET n = n + 1 WHERE k = ?')->execute([$key]);
    return (int) $r['n'] + 1 > $max;
}
function throttleClear(string $key): void
{
    db()
        ->prepare('DELETE FROM throttle WHERE k = ?')
        ->execute([$key]);
}
/* v62: the visitor's address. Plain REMOTE_ADDR, unless the request came through Cloudflare (REMOTE_ADDR is one of its
   published networks: then CF-Connecting-IP) or through a proxy the administrator trusts (Security & spam firewall >
   Trusted proxies: then the address that proxy added to X-Forwarded-For). A forwarded header from anyone else is
   ignored, so a visitor cannot choose their own address; and behind a proxy the bans, rate limits, sign-in alerts and
   locations apply to visitors, never to the proxy. */
const CF_NETS = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22', '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'];
/** Is the address inside one of the networks (an address, a prefix ending in a dot, or a CIDR block; IPv4 and IPv6)? */
function ipInNets(string $ip, array $nets): bool
{
    $bin = @inet_pton($ip);
    if ($bin === false) {
        return false;
    }
    foreach ($nets as $n) {
        $n = trim((string) $n);
        if ($n === '') {
            continue;
        }
        if (str_ends_with($n, '.')) {
            if (str_starts_with($ip, $n)) {
                return true;
            }
            continue;
        }
        [$net, $bits] = array_pad(explode('/', $n, 2), 2, null);
        $nb = @inet_pton($net);
        if ($nb === false || strlen($nb) !== strlen($bin)) {
            continue;
        }
        $len = $bits === null ? strlen($bin) * 8 : (int) $bits;
        if ($len < 0 || $len > strlen($bin) * 8) {
            continue;
        }
        $full = intdiv($len, 8);
        $rest = $len % 8;
        if (substr($bin, 0, $full) !== substr($nb, 0, $full)) {
            continue;
        }
        if ($rest === 0 || ((ord($bin[$full]) ^ ord($nb[$full])) & (0xff << (8 - $rest)) & 0xff) === 0) {
            return true;
        }
    }
    return false;
}
/** The proxies the administrator trusts (Security & spam firewall), when the firewall module is loaded. */
function trustedProxyNets(): array
{
    if (!function_exists('fwSettings') || !function_exists('fwLines')) {
        return [];
    }
    try {
        return fwLines((string) (fwSettings()['proxies'] ?? ''));
    } catch (Throwable $e) {
        return [];
    }
}
/** How this request arrived: ['remote' => REMOTE_ADDR, 'ip' => the visitor, 'via' => direct|cloudflare|proxy, 'untrusted' => a forwarded header that was ignored]. */
function clientEdge(): array
{
    static $cached = null;
    if ($cached !== null) {
        return $cached;
    }
    $remote = (string) ($_SERVER['REMOTE_ADDR'] ?? '0');
    $edge = ['remote' => $remote, 'ip' => $remote, 'via' => 'direct', 'untrusted' => ''];
    // remembered for the request once the firewall module (the trusted list) is loaded; computed again before that
    $keep = function (array $e) use (&$cached): array {
        if (function_exists('fwSettings')) {
            $cached = $e;
        }
        return $e;
    };
    $cf = trim((string) ($_SERVER['HTTP_CF_CONNECTING_IP'] ?? ''));
    $xff = trim((string) ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? ''));
    $xri = trim((string) ($_SERVER['HTTP_X_REAL_IP'] ?? ''));
    if ($cf !== '' && filter_var($cf, FILTER_VALIDATE_IP) && ipInNets($remote, CF_NETS)) {
        $edge['ip'] = $cf;
        $edge['via'] = 'cloudflare';
        return $keep($edge);
    }
    $trusted = trustedProxyNets();
    if ($trusted && ipInNets($remote, $trusted)) {
        // the address the trusted proxy added: the last one in the list that is not a trusted proxy itself
        $parts = array_values(array_filter(array_map('trim', explode(',', $xff !== '' ? $xff : $xri)), fn($x) => $x !== ''));
        for ($i = count($parts) - 1; $i >= 0; $i--) {
            if (!ipInNets($parts[$i], $trusted)) {
                if (filter_var($parts[$i], FILTER_VALIDATE_IP)) {
                    $edge['ip'] = $parts[$i];
                    $edge['via'] = 'proxy';
                }
                break;
            }
        }
        return $keep($edge);
    }
    if ($cf !== '' || $xff !== '' || $xri !== '') {
        $edge['untrusted'] = $cf !== '' ? 'CF-Connecting-IP' : ($xff !== '' ? 'X-Forwarded-For' : 'X-Real-IP');
    }
    return $keep($edge);
}
function clientIp(): string
{
    return clientEdge()['ip'];
}
function str(array $src, string $k, int $max = 500): string
{
    $v = $src[$k] ?? '';
    if (!is_string($v)) {
        $v = is_scalar($v) ? (string) $v : '';
    }
    return mb_substr(trim($v), 0, $max);
}
function tempPassword(): string
{
    $chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    $o = '';
    for ($i = 0; $i < 10; $i++) {
        $o .= $chars[random_int(0, strlen($chars) - 1)];
    }
    return $o;
}

/* ---------- files ---------- */
/** v35: refuses an uploaded file (still in PHP's temporary folder) that fails the screening in guard.php. */
function uploadGuard(string $tmp, string $name): void
{
    require_once __DIR__ . '/guard.php';
    $why = guardUpload($tmp, $name);
    if ($why !== '') {
        if (function_exists('fwLog')) {
            fwLog('upload', 'Refused ' . mb_substr($name, 0, 80) . ': ' . $why);
        }
        $u = currentUser();
        audit('data', 'Upload refused', mb_substr($name, 0, 120), ['why' => $why], $u);
        fail(400, 'unsafe_file', $why);
    }
}
function storeUpload(array $f, string $base, array $meta): array
{
    if (($f['error'] ?? 1) !== UPLOAD_ERR_OK) {
        fail(
            400,
            'invalid_argument',
            $f['error'] === UPLOAD_ERR_INI_SIZE || $f['error'] === UPLOAD_ERR_FORM_SIZE
                ? 'That file is too large.'
                : 'The upload did not complete. Try again.',
        );
    }
    $name = mb_substr(basename((string) $f['name']), 0, 180);
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    if (!isset(MIME[$ext])) {
        fail(400, 'invalid_argument', 'Upload a PDF, image, Excel (.xlsx), Word (.docx), PowerPoint (.pptx), zip, CSV, Markdown, JSON or text file.');
    }
    $max = (int) cfg('max_upload_mb') * 1048576;
    $size = (int) $f['size'];
    if ($size <= 0) {
        fail(400, 'invalid_argument', 'That file is empty.');
    }
    if ($size > $max) {
        fail(400, 'too_large', 'That file is larger than ' . cfg('max_upload_mb') . ' MB.');
    }
    // v35: the content must match the type; macros, programs inside archives and viruses are refused
    uploadGuard((string) $f['tmp_name'], $name);
    $dir = cfg('files_dir');
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    $fid = rid(16);
    if (!move_uploaded_file($f['tmp_name'], "$dir/$fid")) {
        fail(
            500,
            'unavailable',
            'The server could not store the file. Check that the storage folder is writable.',
        );
    }
    // v34: every uploaded file is encrypted at rest (AES-256-GCM); the readers in seccore.php open it again
    fileSealPath("$dir/$fid");
    $doc = (object) ['n' => $name, 'ty' => MIME[$ext], 'sz' => $size, 'at' => now()];
    foreach (['c', 'w'] as $k) {
        if (isset($meta[$k]) && is_string($meta[$k])) {
            $doc->$k = mb_substr($meta[$k], 0, 60);
        }
    }
    docSet("$base/f/$fid", $doc);
    $a = (array) $doc;
    $a['id'] = $fid;
    return $a;
}

/* ---------- email ---------- */
function siteUrl(): string
{
    $c = (string) cfg('site_url');
    if ($c !== '') {
        return rtrim($c, '/') . '/';
    }
    $https =
        (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ||
        ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    $dir = rtrim(dirname(dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/api/index.php'))), '/');
    return ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $dir . '/';
}
function mailLog(string $line): void
{
    @error_log(date('c') . ' ' . $line . "\n", 3, storeDir() . '/mail.log');
}
/** v37: what emails carry at the top and bottom: StratEdge's own name and address, or the company workspace's name,
 *  color, postal address and contact (a workspace never sends under StratEdge's name). */
function emailBrand(): array
{
    $ws = wsCurrent();
    if ($ws && empty($ws['missing'])) {
        $name = (string) ($ws['name'] ?? $ws['slug']);
        $col = (string) ($ws['brand']['color'] ?? '');
        $col = preg_match('/^#[0-9A-Fa-f]{6}$/', $col) ? strtoupper($col) : '#2B3993';
        $addr = trim((string) ($ws['brand']['addr'] ?? ''));
        $contact = (string) ($ws['contact'] ?? '');
        return [
            'ws' => true,
            'name' => $name,
            'head' => '<div style="font:800 20px Arial,Helvetica,sans-serif;color:' . emailInkColor($col) . '">' . htmlspecialchars($name) . '</div>',
            'foot' => htmlspecialchars($name . ($addr !== '' ? ' · ' . $addr : '') . ($contact !== '' ? ' · ' . $contact : '')),
            'mfoot' => htmlspecialchars($name . ($addr !== '' ? ' · ' . $addr : '')),
            'text' => $name . ($addr !== '' ? ', ' . $addr : ''),
            'btn' => emailInkColor($col),
        ];
    }
    return [
        'ws' => false,
        'name' => 'StratEdge IT Consulting',
        'head' => '<div style="font:800 20px Arial,Helvetica,sans-serif;color:#2B3993">StratEdge <span style="color:#0E849A">IT Consulting</span></div>',
        'foot' => 'StratEdge IT Consulting Inc. · 1553 Route 27, Suite 1000, Somerset, NJ 08873 · +1 (302) 434-8889 · info@stratedgeitconsulting.com',
        'mfoot' => 'StratEdge IT Consulting Inc. · 1553 Route 27, Suite 1000, Somerset, NJ 08873 · +1 (302) 434-8889',
        'text' => 'StratEdge IT Consulting Inc., 1553 Route 27, Suite 1000, Somerset, NJ 08873',
        'btn' => '#2B3993',
    ];
}
/** A brand color dark enough for white text on a button (and for a heading on white); otherwise StratEdge's blue. */
function emailInkColor(string $hex): string
{
    if (!preg_match('/^#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$/', $hex, $m)) {
        return '#2B3993';
    }
    $lin = function (string $h): float {
        $c = hexdec($h) / 255;
        return $c <= 0.03928 ? $c / 12.92 : (($c + 0.055) / 1.055) ** 2.4;
    };
    $l = 0.2126 * $lin($m[1]) + 0.7152 * $lin($m[2]) + 0.0722 * $lin($m[3]);
    // contrast with white of at least 4.5 : 1
    return 1.05 / ($l + 0.05) >= 4.5 ? strtoupper($hex) : '#2B3993';
}
function emailHtml(string $title, array $paras, ?array $button = null, string $foot = ''): string
{
    $br = emailBrand();
    $p = implode(
        '',
        array_map(
            fn($x) => '<p style="margin:0 0 14px;font:15px/1.55 Arial,Helvetica,sans-serif;color:#1f2a44">' .
                nl2br(htmlspecialchars($x)) .
                '</p>',
            $paras,
        ),
    );
    $b = $button
        ? '<p style="margin:22px 0"><a href="' .
            htmlspecialchars($button[1]) .
            '" style="display:inline-block;background:' . $br['btn'] . ';color:#fff;text-decoration:none;font:700 15px Arial,Helvetica,sans-serif;padding:13px 22px;border-radius:10px">' .
            htmlspecialchars($button[0]) .
            '</a></p><p style="font:12px/1.5 Arial,sans-serif;color:#7a87a6;word-break:break-all">Or open this link: ' .
            htmlspecialchars($button[1]) .
            '</p>'
        : '';
    return '<!doctype html><html><body style="margin:0;background:#f4f7fa;padding:24px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="600" style="max-width:600px;background:#fff;border-radius:16px;border:1px solid #dce3ec" cellspacing="0" cellpadding="0"><tr><td style="padding:26px 30px 10px">' . $br['head'] . '</td></tr><tr><td style="padding:10px 30px 26px"><h1 style="margin:0 0 16px;font:800 22px/1.25 Arial,Helvetica,sans-serif;color:#101b35">' .
        htmlspecialchars($title) .
        '</h1>' .
        $p .
        $b .
        '</td></tr><tr><td style="padding:16px 30px;border-top:1px solid #dce3ec;font:12px/1.5 Arial,sans-serif;color:#7a87a6">' . $br['foot'] .
        ($foot !== '' ? '<br>' . htmlspecialchars($foot) : '') .
        '</td></tr></table></td></tr></table></body></html>';
}
function buildMime(
    string $fromName,
    string $from,
    string $to,
    string $toName,
    string $subject,
    string $text,
    string $html,
    array $atts,
    string $replyTo = '',
    string $cc = '',
    array $extra = [],
): array {
    $enc = fn($s) => '=?UTF-8?B?' . base64_encode($s) . '?=';
    // v34: the Message-ID names the sender's own domain (not the web server's host, which is "localhost" when the
    // scheduled task sends), or the one a caller sets (mass email: one per recipient, naming the campaign)
    $host = str_contains($from, '@') ? substr($from, (int) strrpos($from, '@') + 1) : preg_replace('/:\d+$/', '', (string) ($_SERVER['HTTP_HOST'] ?? 'localhost'));
    $mid = '';
    foreach ($extra as $k => $v) {
        if (strcasecmp((string) $k, 'Message-ID') === 0) {
            $mid = trim(str_replace(["\r", "\n"], '', (string) $v));
            unset($extra[$k]);
        }
    }
    $b1 = 'alt' . bin2hex(random_bytes(8));
    $b2 = 'mix' . bin2hex(random_bytes(8));
    $headers =
        'From: ' .
        $enc($fromName) .
        " <$from>\r\nTo: " .
        ($toName !== '' ? $enc($toName) . " <$to>" : $to) .
        "\r\n" .
        ($cc !== '' ? "Cc: $cc\r\n" : '') .
        ($replyTo !== '' ? "Reply-To: $replyTo\r\n" : '') .
        'Subject: ' .
        $enc($subject) .
        "\r\nMIME-Version: 1.0\r\nDate: " .
        date('r') .
        "\r\nMessage-ID: " .
        ($mid !== '' ? $mid : '<' . bin2hex(random_bytes(10)) . '@' . $host . '>') .
        "\r\n";
    foreach ($extra as $k => $v) {
        $headers .=
            preg_replace('/[^A-Za-z0-9-]/', '', (string) $k) .
            ': ' .
            str_replace(["\r", "\n"], '', (string) $v) .
            "\r\n";
    }
    $alt =
        "--$b1\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n" .
        // v34: real line breaks (CRLF) in the plain-text part instead of encoded =0A ones
        quoted_printable_encode(str_replace(["\r\n", "\r", "\n"], ["\n", "\n", "\r\n"], $text)) .
        "\r\n--$b1\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" .
        chunk_split(base64_encode($html)) .
        "\r\n--$b1--\r\n";
    if (!$atts) {
        return [$headers . "Content-Type: multipart/alternative; boundary=\"$b1\"\r\n", $alt];
    }
    $body = "--$b2\r\nContent-Type: multipart/alternative; boundary=\"$b1\"\r\n\r\n$alt";
    foreach ($atts as $a) {
        $n = str_replace(['"', "\r", "\n"], '', (string) $a['name']);
        $body .=
            "--$b2\r\nContent-Type: " .
            $a['type'] .
            "; name=\"" .
            $n .
            "\"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=\"" .
            $n .
            "\"\r\n\r\n" .
            chunk_split(base64_encode($a['data'])) .
            "\r\n";
    }
    return [$headers . "Content-Type: multipart/mixed; boundary=\"$b2\"\r\n", $body . "--$b2--\r\n"];
}
/* Every email the site sends goes through here: the connection set under Mass email > Gmail & sending
 (or the mail settings in config.php), with each message recorded in the sent log. */
function sendMail(
    string $to,
    string $toName,
    string $subject,
    string $text,
    string $html,
    array $atts = [],
    string $replyTo = '',
    string $cc = '',
): bool {
    require_once __DIR__ . '/mail.php';
    return mailDeliver([
        'to' => $to,
        'name' => $toName,
        'subject' => $subject,
        'text' => $text,
        'html' => $html,
        'atts' => $atts,
        'reply' => $replyTo,
        'cc' => $cc,
    ]);
}
function tokenAllows(string $path, string $tok): bool
{
    if ($tok === '' || !preg_match('/^[a-f0-9]{32}$/', $tok)) {
        return false;
    }
    $segs = explode('/', $path);
    if (count($segs) < 2) {
        return false;
    }
    if ($segs[0] === 'sig') {
        $d = docGet("sig/{$segs[1]}");
        if (!$d) {
            return false;
        }
        foreach ((array) ($d->signers ?? []) as $s) {
            if (($s->tok ?? '') === $tok) {
                return true;
            }
        }
        return false;
    }
    if ($segs[0] === 'esd') {
        // v45.3: the internal document library's files, for whoever may see the document (es_lib hands out the token)
        $d = docGet("esd/{$segs[1]}");
        return $d && ($d->tok ?? '') !== '' && hash_equals((string) $d->tok, $tok);
    }
    if ($segs[0] === 'inv') {
        $d = docGet("inv/{$segs[1]}");
        return $d && ($d->tok ?? '') === $tok;
    }
    if ($segs[0] === 'ats') {
        // interview panel members open the resume with the token the ATS hands them (ats_my_interviews)
        $d = docGet("ats/{$segs[1]}");
        return $d && ($d->tok ?? '') !== '' && ($d->tok ?? '') === $tok;
    }
    if ($segs[0] === 'xc') {
        // v43: an expense claim's receipts, for whoever the claim screens hand its token to (owner, approver, accounting)
        $d = docGet("xc/{$segs[1]}");
        return $d && ($d->tok ?? '') !== '' && ($d->tok ?? '') === $tok;
    }
    if ($segs[0] === 'im' && count($segs) >= 4 && $segs[2] === 'f') {
        // v45: an immigration case's documents: HR's token opens every file, the person's token only the files they
        // uploaded or HR shared with them
        $d = docGet("im/{$segs[1]}");
        if (!$d) {
            return false;
        }
        // v83: a case token is no bearer secret: it works only next to the session that may see the case (HR and
        // administrators now, the person the case is for, or the attorney who confirmed their emailed code in this browser)
        $me = currentUser();
        $staff = $me && (hasRole($me, 'admin') || hasRole($me, 'hr') || grantOf((string) $me['id'], 'hr'));
        if ($staff && ($d->tok ?? '') !== '' && hash_equals((string) $d->tok, $tok)) {
            return true;
        }
        if ($me && ($staff || (string) ($d->uid ?? '') === (string) $me['id']) && ($d->ptok ?? '') !== '' && hash_equals((string) $d->ptok, $tok)) {
            $f = docGet("im/{$segs[1]}/f/{$segs[3]}");
            return $f && ($f->w ?? '') === 'p';
        }
        // v45.1: the attorney's token (given after their emailed code) opens what HR shares with the attorney, while the link lives
        // (v83: and only while this browser holds the attorney's confirmed code for that link, as imxSignedIn: 8 hours)
        foreach ((array) ($d->grants ?? []) as $g) {
            if (($g->atok ?? '') !== '' && hash_equals((string) $g->atok, $tok) && empty($g->rev) && (int) ($g->exp ?? 0) > now()) {
                $signed = false;
                foreach ((array) ($_SESSION['imx'] ?? []) as $k => $until) {
                    $x = (int) $until > now() && preg_match('/^[a-f0-9]{64}$/', (string) $k) ? docGet('imx/' . $k) : null;
                    if ($x && (string) ($x->case ?? '') === (string) $segs[1] && (string) ($x->grant ?? '') === (string) $g->id) {
                        $signed = true;
                        break;
                    }
                }
                if (!$signed) {
                    return false;
                }
                $f = docGet("im/{$segs[1]}/f/{$segs[3]}");
                return $f && in_array((string) ($f->w ?? ''), ['a', 'p'], true);
            }
        }
        return false;
    }
    if ($segs[0] === 'pv' && count($segs) >= 4 && $segs[2] === 'items') {
        // recruiters open the files of a vault entry the person shared (vault_shared hands out the token)
        $d = docGet("pv/{$segs[1]}/items/{$segs[3]}");
        return $d && !empty($d->share) && ($d->tok ?? '') !== '' && ($d->tok ?? '') === $tok;
    }
    return false;
}
function invNext(): string
{
    $p = db();
    $y = date('Y');
    $k = "inv$y";
    $p->beginTransaction();
    try {
        if (!$p->query("SELECT v FROM meta WHERE k='$k'")->fetch()) {
            $p->exec("INSERT INTO meta (k, v) VALUES ('$k', 0)");
        }
        $p->exec("UPDATE meta SET v = v + 1 WHERE k = '$k'");
        $n = (int) $p->query("SELECT v FROM meta WHERE k = '$k'")->fetchColumn();
        $p->commit();
    } catch (Throwable $e) {
        $p->rollBack();
        throw $e;
    }
    // the prefix is set under Accounting settings (INV by default)
    $set = docGet('org/acct/x/settings');
    $prefix = preg_replace('/[^A-Za-z0-9\-]/', '', (string) ($set->prefix ?? '')) ?: 'INV';
    return sprintf('%s-%s-%04d', $prefix, $y, $n);
}
function money(float $n, string $cur): string
{
    return ($cur === 'INR' ? '₹' : ($cur === 'USD' ? '$' : $cur . ' ')) . number_format($n, 2);
}

/* ---------- e-signature helpers ---------- */
function sigIndexByTok(stdClass $d, string $tok): int
{
    if ($tok === '') {
        return -1;
    }
    foreach ((array) $d->signers as $i => $s) {
        if (($s->tok ?? '') === $tok) {
            return $i;
        }
    }
    return -1;
}
function sigActor(stdClass $d, array $src): ?array
{
    $tok = (string) ($src['tok'] ?? '');
    if ($tok !== '') {
        $i = sigIndexByTok($d, $tok);
        return $i >= 0 ? ['i' => $i, 'n' => $d->signers[$i]->n] : null;
    }
    $u = currentUser();
    if (!$u) {
        return null;
    }
    foreach ((array) $d->signers as $i => $s) {
        if (($s->uid ?? '') === $u['id']) {
            return ['i' => $i, 'n' => $u['name']];
        }
    }
    return null;
}
function sigNotify(stdClass $d, string $id, int $i, bool $remind = false): bool
{
    $signers = (array) $d->signers;
    if (!isset($signers[$i])) {
        return false;
    }
    $s = $signers[$i];
    $s = is_array($s) ? (object) $s : $s;
    $link = !empty($s->tok) ? siteUrl() . '#/sign/' . $id . '/' . $s->tok : siteUrl() . '#/portal/sign';
    // v45.3: the request's email options (its own subject, a copy attached, sent from the sender's mailbox)
    $mo = isset($d->mail) && $d->mail instanceof stdClass ? $d->mail : null;
    if ($mo) {
        require_once __DIR__ . '/esign.php';
    }
    $title = ($remind ? 'Reminder: ' : '') . ($mo && (string) ($mo->subj ?? '') !== '' ? esMerge((string) $mo->subj, $d, $s) : 'Please sign: ' . $d->ti);
    $paras = [
        "{$d->byn} at StratEdge IT Consulting sent you \"{$d->ti}\" to sign electronically." .
        (!empty($d->due) ? " It is due by {$d->due}." : ''),
        !empty($d->msg) ? $d->msg : '',
        !empty($s->tok)
            ? 'No account is needed: open the link, review the document, and sign on screen.'
            : 'Log in to your StratEdge portal and open "Sign documents".',
    ];
    if (!empty($d->exp)) {
        $paras[] = 'This request is open until ' . date('M j, Y', (int) ((int) $d->exp / 1000)) . '.';
    }
    $atts = $mo && !empty($mo->attach) ? esAttachment($d) : [];
    $text = "{$d->byn} sent you \"{$d->ti}\" to sign.\n\n" . (!empty($d->msg) ? ($mo ? esMerge((string) $d->msg, $d, $s) : (string) $d->msg) . "\n\n" : '') . "Review and sign: $link" . (!empty($d->exp) ? "\n\nOpen until " . date('M j, Y', (int) ((int) $d->exp / 1000)) . '.' : '');
    if ($mo && (string) ($mo->from ?? 'co') === 'me' && !empty($d->by)) {
        [$ok, $merr] = esSendFromMe((string) $d->by, (string) $s->e, $title, $text, $atts);
        $GLOBALS['mailErr'] = $merr;
    } else {
        $ok = sendMail((string) $s->e, (string) $s->n, $title, $text, emailHtml($title, array_values(array_filter($paras)), ['Review and sign', $link]), $atts, (string) ($d->bye ?? ''));
    }
    $log = (array) ($d->log ?? []);
    $log[] = (object) [
        't' => now(),
        'who' => 'System',
        'ev' => ($ok ? 'Signing request emailed to ' : 'Email could not be sent to ') . $s->e,
        'ip' => '',
    ];
    $d->log = $log;
    return $ok;
}
/** The streams of a PDF (the newest version of each object; object and cross-reference streams left out). */
function sigPdfStreams(string $pdf): array
{
    $out = [];
    if (!preg_match_all('/(?<![0-9])(\d+)\s+(\d+)\s+obj\b/', $pdf, $m, PREG_OFFSET_CAPTURE)) {
        return $out;
    }
    foreach ($m[0] as $k => $hit) {
        $end = strpos($pdf, 'endobj', $hit[1]);
        if ($end === false) {
            continue;
        }
        $body = substr($pdf, $hit[1], $end - $hit[1]);
        $num = $m[1][$k][0];
        $s = strpos($body, 'stream');
        if ($s === false || preg_match('#/Type\s*/(ObjStm|XRef)\b#', substr($body, 0, $s))) {
            unset($out[$num]);
            continue;
        }
        $s += 6;
        if (($body[$s] ?? '') === "\r") {
            $s++;
        }
        if (($body[$s] ?? '') === "\n") {
            $s++;
        }
        $e = strrpos($body, 'endstream');
        if ($e === false || $e <= $s) {
            unset($out[$num]);
            continue;
        }
        $out[$num] = rtrim(substr($body, $s, $e - $s), "\r\n");
    }
    return array_values(array_filter($out, fn($x) => $x !== ''));
}
/**
 * v83: true when the signed copy $got still carries the copy it was signed on ($was, of type $ty) byte for byte: every
 * page, image and font stream of it (the browser only adds stamps, fields and a certificate page).
 */
function sigKeepsCopy(string $was, string $ty, string $got): bool
{
    if (!str_contains(substr($got, 0, 1024), '%PDF-')) {
        return false;
    }
    if ($ty === 'image/jpeg') {
        return str_contains($got, $was); // pdf-lib embeds a JPEG unchanged
    }
    if ($ty !== 'application/pdf') {
        return true; // a PNG is re-encoded into the first page: nothing to compare
    }
    foreach (sigPdfStreams($was) as $s) {
        if (!str_contains($got, $s)) {
            return false;
        }
    }
    return true;
}
function sigComplete(stdClass $d, string $id): void
{
    $pdf = fileRead((string) $d->sfid);
    if ($pdf === null) {
        return;
    }
    $att = [['name' => (string) ($d->sfn ?? 'signed.pdf'), 'type' => 'application/pdf', 'data' => $pdf]];
    // v83: the original as sent travels with the signed copy, so every party can compare the two
    $orig = fileRead((string) $d->fid);
    if ($orig !== null) {
        $att[] = ['name' => 'original-' . (string) ($d->fn ?? 'document'), 'type' => (string) ($d->fty ?? 'application/pdf'), 'data' => $orig];
    }
    $origNote = ' The original document as sent (SHA-256 ' . (string) ($d->fh ?? '') . ') is attached too.';
    $sent = [];
    foreach ((array) $d->signers as $s) {
        if (!empty($s->e) && !isset($sent[$s->e])) {
            $sent[$s->e] = 1;
            sendMail(
                (string) $s->e,
                (string) $s->n,
                'Signed copy: ' . $d->ti,
                "All parties have signed \"{$d->ti}\". The signed copy is attached." . $origNote,
                emailHtml('Signed: ' . $d->ti, [
                    "All parties have signed \"{$d->ti}\". The signed PDF, with a signature certificate for each signer, is attached for your records." . $origNote,
                ]),
                $att,
            );
        }
    }
    // v45.3: the addresses the sender asked to get the signed copy too
    foreach ((array) ($d->mail->cc ?? []) as $cc) {
        if (is_string($cc) && filter_var($cc, FILTER_VALIDATE_EMAIL) && !isset($sent[$cc])) {
            $sent[$cc] = 1;
            sendMail($cc, '', 'Signed copy: ' . $d->ti, "\"{$d->ti}\" has been signed by everyone. The signed copy is attached." . $origNote, emailHtml('Signed: ' . $d->ti, ["\"{$d->ti}\" has been signed by everyone. The signed PDF, with a signature certificate for each signer, is attached. {$d->byn} asked for you to get a copy." . $origNote]), $att, (string) ($d->bye ?? ''));
        }
    }
    if (!empty($d->bye) && !isset($sent[$d->bye])) {
        sendMail(
            (string) $d->bye,
            (string) $d->byn,
            'Signed copy: ' . $d->ti,
            "All parties have signed \"{$d->ti}\". The signed copy is attached." . $origNote,
            emailHtml('Signed: ' . $d->ti, [
                "All parties have signed \"{$d->ti}\". The signed PDF is attached and the request is marked complete in the admin portal." . $origNote,
            ]),
            $att,
        );
    }
    $log = (array) ($d->log ?? []);
    $log[] = (object) [
        't' => now(),
        'who' => 'System',
        'ev' => 'Signed copy emailed to all parties',
        'ip' => '',
    ];
    $d->log = $log;
}
function invMirror(stdClass $d, string $id): stdClass
{
    $m = clone $d;
    unset($m->log);
    $m->id = $id;
    return $m;
}

/* ---------- sign-in activity ---------- */
function geoLookup(string $ip): ?array
{
    if (!cfg('geo_lookup')) {
        return null;
    }
    if (
        $ip === '' ||
        $ip === '0' ||
        $ip === '127.0.0.1' ||
        $ip === '::1' ||
        preg_match('/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fc|fd|fe80)/i', $ip)
    ) {
        return ['city' => '', 'region' => '', 'country' => '', 'label' => 'Local network'];
    }
    $key = 'geo/' . preg_replace('/[^a-z0-9]/i', '_', $ip);
    $c = docGet($key);
    if ($c && now() - (int) ($c->t ?? 0) < 7 * 86400 * 1000) {
        return (array) $c->g;
    }
    $ctx = stream_context_create(['http' => ['timeout' => 2.5, 'ignore_errors' => true]]);
    $raw = @file_get_contents(
        'http://ip-api.com/json/' .
            rawurlencode($ip) .
            '?fields=status,country,countryCode,regionName,city,lat,lon,isp,timezone',
        false,
        $ctx,
    );
    $j = $raw ? json_decode($raw, true) : null;
    if (!is_array($j) || ($j['status'] ?? '') !== 'success') {
        return null;
    }
    $g = [
        'city' => (string) ($j['city'] ?? ''),
        'region' => (string) ($j['regionName'] ?? ''),
        'country' => (string) ($j['country'] ?? ''),
        // v78: the two-letter code, for the firewall's blocked countries
        'cc' => strtoupper((string) ($j['countryCode'] ?? '')),
        'lat' => $j['lat'] ?? null,
        'lng' => $j['lon'] ?? null,
        'isp' => (string) ($j['isp'] ?? ''),
        'tz' => (string) ($j['timezone'] ?? ''),
    ];
    $g['label'] = implode(', ', array_values(array_filter([$g['city'], $g['region'], $g['country']])));
    docSet($key, (object) ['t' => now(), 'g' => $g]);
    return $g;
}
function recordLogin(array $u, string $how): string
{
    $ip = clientIp();
    $ua = mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 240);
    $now = now();
    $id = rid(6);
    $rec = (object) ['t' => $now, 'ip' => $ip, 'ua' => $ua, 'how' => $how, 'geo' => geoLookup($ip)];
    docSet("log/{$u['id']}/items/$id", $rec);
    $d = docGet("log/{$u['id']}") ?? (object) ['n' => 0];
    $d->n = (int) ($d->n ?? 0) + 1;
    $d->last = $rec;
    $d->lastId = $id;
    $d->seen = $now;
    $d->name = $u['name'];
    $d->email = $u['email'];
    $d->role = $u['role'];
    docSet("log/{$u['id']}", $d);
    $_SESSION['login_id'] = $id;
    $_SESSION['seen'] = $now;
    return $id;
}
function touchSeen(?array $u): void
{
    if (!$u) {
        return;
    }
    $now = now();
    if ((int) ($_SESSION['seen'] ?? 0) > $now - 300000) {
        return;
    }
    $_SESSION['seen'] = $now;
    $d = docGet("log/{$u['id']}");
    if ($d) {
        $d->seen = $now;
        docSet("log/{$u['id']}", $d);
    }
}
/** Create a login of any kind (Admin > Roles & access > Add a login; the ATS hire button). Returns id, password, mailed. */
function createLogin(array $b, array $me): array
{
    $name = str($b, 'name', 120);
    $email = strtolower(str($b, 'email', 190));
    $co = str($b, 'company', 190);
    $title = str($b, 'title', 120);
    $phone = str($b, 'phone', 60);
    $kind = str($b, 'kind', 12);
    if ($kind === 'bench') $kind = 'employee'; // v63: old bench access requests are employee requests
    // an outside bookkeeper or accountant: the accounting portal only, with a books level and no employee portal
    $ext = $kind === 'bookkeeper';
    if ($ext && !hasRole($me, 'admin')) {
        fail(403, 'forbidden', 'Only an administrator can add a bookkeeper login.');
    }
    $books = in_array(str($b, 'books', 10), ['full', 'view', 'reports'], true) ? str($b, 'books', 10) : 'view';
    $nopay = !empty($b['nopay']);
    // a vendor contact is a client-portal login tied to a vendor on the vendors list (talent marketplace, requirements)
    $vid = $kind === 'vendor' ? str($b, 'vid', 40) : '';
    $vendor = $vid !== '' && preg_match('/^[A-Za-z0-9_\-]{1,40}$/', $vid) ? docGet('vms/vendor/items/' . $vid) : null;
    if ($kind === 'vendor' && !$vendor) {
        fail(400, 'invalid_argument', 'Pick the vendor this contact belongs to.');
    }
    $memberRole = $ext ? 'ext' : (in_array($kind, ['employer', 'employee', 'consultant', 'student'], true) ? $kind : 'employer');
    $portals = [];
    foreach ((array) ($b['portals'] ?? []) as $k) {
        if (is_string($k) && in_array($k, PORTAL_KEYS, true) && (hasRole($me, 'admin') || !isset(STAFF_PORTAL_ROLE[$k]))) {
            $portals[] = $k;
        }
    }
    if ($ext) {
        $portals = ['acct'];
    }
    $cids = [];
    foreach ((array) ($b['cids'] ?? []) as $c) {
        if (is_string($c) && preg_match('/^[A-Za-z0-9_\-]{1,40}$/', $c) && docGet("org/admin/clients/$c")) {
            $cids[] = $c;
        }
    }
    if (mb_strlen($name) < 2) {
        fail(400, 'invalid_argument', 'Add the person\'s full name.');
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        fail(400, 'invalid_argument', 'Enter a valid email address.');
    }
    if ($memberRole === 'employer' && !$cids && !$vendor) {
        fail(400, 'invalid_argument', 'Pick at least one client workspace for a client contact.');
    }
    $p = db();
    $s = $p->prepare('SELECT id FROM users WHERE email = ?');
    $s->execute([$email]);
    if ($s->fetch()) {
        fail(409, 'invalid_argument', 'An account with that email already exists. Add the portal or client under Roles & access instead.');
    }
    $id = 'u_' . rid(8);
    // v34: no temporary password travels by email any more: the person chooses their own password from an invitation
    // link (7 days, one use); the random one below is never shown to anyone
    require_once __DIR__ . '/auth.php';
    $pw = rid(24);
    $p->prepare('INSERT INTO users (id, email, name, pass, role, status, created, access) VALUES (?,?,?,?,?,?,?,?)')->execute([
        $id,
        $email,
        $name,
        pwHash($pw),
        'user',
        'active',
        now(),
        json_encode(['portals' => array_values(array_unique($portals)), 'cids' => array_values(array_unique($cids))]),
    ]);
    $clientName = '';
    if ($cids) {
        $cd = docGet('org/admin/clients/' . $cids[0]);
        $clientName = (string) ($cd->n ?? '');
    } elseif ($vendor) {
        $clientName = (string) ($vendor->n ?? '');
    }
    docSet("u/$id", (object) [
        'p' => (object) array_filter([
            'n' => $name,
            'e' => $email,
            'role' => $memberRole,
            'co' => $memberRole === 'employer' ? ($co !== '' ? $co : $clientName) : $co,
            'ti' => $title,
            'ph' => $phone,
        ], fn($v) => $v !== ''),
        'u' => now(),
    ]);
    docSet("r/$id", (object) array_filter([
        'st' => 'active',
        'role' => $memberRole,
        'cid' => $cids[0] ?? null,
        'vid' => $vendor ? $vid : null,
        'cl' => $clientName !== '' ? $clientName : null,
        'ext' => $ext ? true : null,
        'books' => $ext ? $books : null,
        'nopay' => $ext && $nopay ? true : null,
        'by' => $me['id'],
        'u' => now(),
    ], fn($v) => $v !== null));
    if ($ext) {
        require_once __DIR__ . '/payroll.php';
        auditLog('access', "r/$id", 'Bookkeeper login created: ' . $name, ['books' => $books, 'nopay' => $nopay], $me);
    }
    $as = $ext ? 'acct' : ($memberRole === 'employer' ? 'client' : $memberRole);
    $inv = authResetLink(['id' => $id, 'email' => $email, 'name' => $name], 'invite', $me, $as);
    audit('access', 'Login created', $email, ['kind' => $kind !== '' ? $kind : $memberRole, 'portals' => array_values(array_unique($portals)), 'cids' => array_values(array_unique($cids))], $me);
    return ['id' => $id, 'password' => '', 'link' => $inv['link'], 'mailed' => $inv['mailed']];
}
/** v83: a CSV cell that a spreadsheet will not run as a formula: text starting with = + - @ (or a tab / carriage
 * return) gets a leading apostrophe; numbers stay numbers. */
function csvCell($c): string
{
    if (is_int($c) || is_float($c)) {
        return (string) $c;
    }
    $s = (string) $c;
    if ($s !== '' && !is_numeric($s) && preg_match('/^(\s*[=+\-@]|[\t\r])/', $s)) {
        $s = "'" . $s;
    }
    return $s;
}
/** One CSV line, every cell quoted (and never a formula, csvCell). */
function csvLine(array $cells): string
{
    return implode(',', array_map(fn($c) => '"' . str_replace('"', '""', csvCell($c)) . '"', $cells));
}
