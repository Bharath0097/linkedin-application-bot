<?php
/* Learning platform, live projects and the project vault (v30).
   Courses live at learn/x/courses/{id} (seeded from learn_content.php, editable under Admin > Learning); a person's
   progress at learn/{uid}/p/{courseId}; certificates at learn/{uid}/certs/{id}; assignments at learn/x/assign.
   Quizzes are graded here - the answers never reach the browser. Live projects: the catalog at proj/x/items/{id},
   a person's own at proj/{uid}/items/{id}; "Create with AI" uses the assistant API from config.php when it is set
   up and the built-in templates otherwise. The vault (pv/{uid}/items/{id} with files below it) is plain records;
   recruiters see the entries a person shares through vault_shared. */
declare(strict_types=1);
require_once __DIR__ . '/learn_content.php';

const LEARN_QUIZ_TYPES = ['mc', 'multi', 'tf', 'fill', 'num', 'order', 'match', 'scramble'];

function learnStaff(bool $write = false): array
{
    $u = requireUser();
    if (!can('learn/x/courses', $write ? 'w' : 'r') || userLevel($u) < 2) {
        fail(403, 'invalid_argument', 'Learning administration is for HR and administrators.');
    }
    return $u;
}
/** A short completion from the assistant (Admin > Website & messages > Assistant, else config.php); null when not set up or it fails. */
function learnAi(string $system, string $prompt, int $maxTokens = 1200, bool $json = false, string $feature = ''): ?string
{
    if (!aiReady($feature)) {
        return null;
    }
    $payload = ['max_tokens' => $maxTokens, 'temperature' => 0.4, 'messages' => [['role' => 'system', 'content' => $system], ['role' => 'user', 'content' => $prompt]]];
    if ($json) {
        $payload['response_format'] = ['type' => 'json_object'];
    }
    [$code, $j] = aiPost($payload, 60);
    if ($json && (!is_array($j) || empty($j['choices'])) && $code >= 400) {
        // a provider that does not know response_format answers 400: ask again without it
        unset($payload['response_format']);
        [$code, $j] = aiPost($payload, 60);
    }
    $text = is_array($j) ? trim((string) ($j['choices'][0]['message']['content'] ?? '')) : '';
    return $text === '' ? null : $text;
}
function learnAiJson(string $system, string $prompt, int $maxTokens = 2500, string $feature = ''): ?array
{
    $t = learnAi($system, $prompt, $maxTokens, true, $feature);
    if ($t === null) {
        return null;
    }
    $t = preg_replace('/^```(?:json)?\s*|\s*```$/m', '', $t) ?? $t;
    $j = json_decode($t, true);
    if (!is_array($j) && preg_match('/\{.*\}/s', $t, $m)) {
        $j = json_decode($m[0], true);
    }
    return is_array($j) ? $j : null;
}

/* ---------- courses ---------- */
function learnSeed(): void
{
    // Built-in courses are added once each: on a new site all of them, on an updated site the ones this version added
    // (v34: the security awareness course). A built-in course an administrator deleted is not brought back.
    $meta = docGet('learn/x/meta');
    $defaults = learnDefaultCourses();
    $known = $meta && isset($meta->builtins) ? (array) $meta->builtins : null;
    if ($known === null && $meta && !empty($meta->seeded)) {
        // seeded before v34 kept no list: everything but the courses added since then counts as already offered
        $known = array_values(array_diff(array_column($defaults, 'id'), ['security']));
    }
    $known = $known ?? [];
    $added = false;
    foreach ($defaults as $c) {
        if (in_array($c['id'], $known, true)) {
            continue;
        }
        if (!docGet('learn/x/courses/' . $c['id'])) {
            $c['u'] = now();
            $c['builtin'] = true;
            docSet('learn/x/courses/' . $c['id'], json_decode(json_encode($c)));
        }
        $known[] = $c['id'];
        $added = true;
    }
    if ($added || !$meta || empty($meta->seeded) || !isset($meta->builtins)) {
        $meta = $meta ?? new stdClass();
        $meta->seeded = true;
        $meta->seededAt = $meta->seededAt ?? now();
        $meta->builtins = array_values(array_unique($known));
        docSet('learn/x/meta', $meta);
    }
}
function learnCourse(string $id): ?array
{
    $d = docGet('learn/x/courses/' . $id);
    return $d ? json_decode(json_encode($d), true) : null;
}
function learnCourses(): array
{
    learnSeed();
    $out = [];
    foreach (colAll('learn/x/courses') as [$id, $d]) {
        $c = json_decode(json_encode($d), true);
        $c['id'] = (string) $id;
        $out[] = $c;
    }
    usort($out, fn($a, $b) => [(int) ($a['ord'] ?? 50), $a['t'] ?? ''] <=> [(int) ($b['ord'] ?? 50), $b['t'] ?? '']);
    return $out;
}
/** Lesson count and quiz count, for the catalog. */
function learnShape(array $c): array
{
    $ls = 0;
    $qs = 0;
    foreach ((array) ($c['mods'] ?? []) as $m) {
        foreach ((array) ($m['ls'] ?? []) as $l) {
            $ls++;
            $qs += count((array) ($l['quiz'] ?? []));
        }
    }
    return ['lessons' => $ls, 'quizzes' => $qs, 'modules' => count((array) ($c['mods'] ?? []))];
}
/** One quiz item as the learner sees it: no answers; order/match options shuffled, scrambles scrambled (v32: shared
 *  by course quizzes, certification exams and the daily and weekly tests). */
function learnPublicItem(array $q, int $i): array
{
    $p = ['i' => $i, 'ty' => $q['ty'], 'q' => $q['q']];
    if (in_array($q['ty'], ['mc', 'multi'], true)) {
        $p['o'] = array_values((array) $q['o']);
    } elseif ($q['ty'] === 'order') {
        $o = array_values((array) $q['o']);
        $keys = array_keys($o);
        shuffle($keys);
        if ($keys === array_keys($o) && count($keys) > 1) {
            $keys = array_reverse($keys);
        }
        $p['o'] = array_map(fn($k) => ['k' => $k, 't' => $o[$k]], $keys);
    } elseif ($q['ty'] === 'match') {
        $pairs = array_values((array) $q['pairs']);
        $p['l'] = array_map(fn($x) => $x[0], $pairs);
        $r = array_map(fn($k, $x) => ['k' => $k, 't' => $x[1]], array_keys($pairs), $pairs);
        shuffle($r);
        $p['r'] = $r;
    } elseif ($q['ty'] === 'scramble') {
        $p['hint'] = (string) ($q['hint'] ?? '');
        $word = (string) $q['a'];
        $chars = preg_split('//u', $word, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $sh = $chars;
        for ($try = 0; $try < 5 && implode('', $sh) === $word && count($chars) > 1; $try++) {
            shuffle($sh);
        }
        $p['s'] = implode('', $sh);
        $p['len'] = count($chars);
    }
    return $p;
}
/** The course as the learner sees it: quiz items without answers, order/match options shuffled per request. */
function learnPublic(array $c): array
{
    foreach ($c['mods'] as &$m) {
        foreach ($m['ls'] as &$l) {
            $items = [];
            foreach ((array) ($l['quiz'] ?? []) as $i => $q) {
                $items[] = learnPublicItem((array) $q, (int) $i);
            }
            $l['quiz'] = $items;
        }
        unset($l);
    }
    unset($m);
    return $c;
}
function learnNorm(string $s): string
{
    $s = mb_strtolower(trim($s));
    $s = preg_replace('/[^\p{L}\p{N}]+/u', '', $s) ?? $s;
    return $s;
}
/** Grade one lesson's answers against the stored items. */
function learnGrade(array $items, array $answers): array
{
    $res = [];
    $ok = 0;
    foreach ($items as $i => $q) {
        $a = $answers[$i] ?? null;
        $right = false;
        $show = '';
        switch ($q['ty']) {
            case 'mc':
                $right = $a !== null && (int) $a === (int) $q['a'];
                $show = (string) (((array) $q['o'])[(int) $q['a']] ?? '');
                break;
            case 'multi':
                $want = array_map('intval', (array) $q['a']);
                sort($want);
                $got = array_map('intval', (array) $a);
                sort($got);
                $right = $got === $want;
                $show = implode('; ', array_map(fn($k) => (string) (((array) $q['o'])[$k] ?? ''), $want));
                break;
            case 'tf':
                $right = $a !== null && (bool) $a === (bool) $q['a'];
                $show = $q['a'] ? 'True' : 'False';
                break;
            case 'fill':
                $want = array_map('learnNorm', (array) $q['a']);
                $right = is_string($a) && in_array(learnNorm($a), $want, true);
                $show = (string) (((array) $q['a'])[0] ?? '');
                break;
            case 'num':
                $right = is_numeric($a) && abs((float) $a - (float) $q['a']) <= (float) ($q['tol'] ?? 0) + 1e-9;
                $show = (string) $q['a'];
                break;
            case 'order':
                $got = array_map('intval', (array) $a);
                $right = $got === array_keys(array_values((array) $q['o']));
                $show = implode(' → ', array_values((array) $q['o']));
                break;
            case 'match':
                $pairs = array_values((array) $q['pairs']);
                $right = is_array($a) && count($pairs) > 0;
                foreach ($pairs as $k => $pr) {
                    if (!isset($a[$k]) || (int) $a[$k] !== $k) {
                        $right = false;
                    }
                }
                $show = implode('; ', array_map(fn($pr) => $pr[0] . ' = ' . $pr[1], $pairs));
                break;
            case 'scramble':
                $right = is_string($a) && learnNorm($a) === learnNorm((string) $q['a']);
                $show = (string) $q['a'];
                break;
        }
        if ($right) {
            $ok++;
        }
        $res[] = ['i' => $i, 'ok' => $right, 'a' => $show, 'why' => (string) ($q['why'] ?? '')];
    }
    $n = count($items);
    return ['n' => $n, 'ok' => $ok, 'pct' => $n ? (int) round(($ok * 100) / $n) : 100, 'items' => $res];
}
function learnProgress(string $uid, string $cid): stdClass
{
    $p = docGet("learn/$uid/p/$cid") ?? new stdClass();
    foreach (['done', 'scores'] as $k) {
        if (!isset($p->$k) || !($p->$k instanceof stdClass)) {
            $p->$k = new stdClass();
        }
    }
    return $p;
}
function learnLessonIds(array $c): array
{
    $ids = [];
    foreach ((array) ($c['mods'] ?? []) as $m) {
        foreach ((array) ($m['ls'] ?? []) as $l) {
            $ids[] = (string) $l['id'];
        }
    }
    return $ids;
}
/** Percentage of lessons done; marks the course complete (and issues the certificate) when all are done. */
function learnRecalc(string $uid, array $c, stdClass $p): stdClass
{
    $ids = learnLessonIds($c);
    $done = 0;
    foreach ($ids as $id) {
        if (!empty($p->done->$id)) {
            $done++;
        }
    }
    $p->pct = count($ids) ? (int) round(($done * 100) / count($ids)) : 0;
    $p->u = now();
    if ($done === count($ids) && count($ids) > 0 && empty($p->completedAt)) {
        $p->completedAt = now();
        $scores = array_map(fn($s) => (int) ($s->pct ?? 0), array_values((array) $p->scores));
        $p->avg = $scores ? (int) round(array_sum($scores) / count($scores)) : 100;
        if (!empty($c['cert'])) {
            $meta = docGet('learn/x/meta') ?? new stdClass();
            $meta->certs = (int) ($meta->certs ?? 0) + 1;
            docSet('learn/x/meta', $meta);
            $no = 'SE-' . date('Y') . '-' . str_pad((string) $meta->certs, 4, '0', STR_PAD_LEFT);
            $cid = rid(8);
            $ur = userRow($uid);
            docSet("learn/$uid/certs/$cid", (object) ['course' => $c['id'], 't' => $c['t'], 'n' => (string) ($ur['name'] ?? ''), 'at' => now(), 'no' => $no, 'avg' => $p->avg, 'code' => rid(6)]);
            $p->cert = $cid;
            $p->certNo = $no;
        }
    }
    return $p;
}
function learnAssign(): array
{
    $d = docGet('learn/x/assign');
    $a = $d ? json_decode(json_encode($d), true) : [];
    $byRole = (array) ($a['byRole'] ?? []);
    if (!empty($byRole['bench'])) {
        $byRole['employee'] = array_values(array_unique(array_merge((array) ($byRole['employee'] ?? []), (array) $byRole['bench'])));
        unset($byRole['bench']);
    }
    return ['byRole' => $byRole, 'byUid' => (array) ($a['byUid'] ?? []), 'due' => (array) ($a['due'] ?? [])];
}
/** Courses required for one person: by their role and by name; plus the course's own "req" roles. */
function learnRequired(string $uid, array $courses): array
{
    $u = userRow($uid);
    $role = (string) ($u['role'] ?? '');
    $ud = docGet("u/$uid");
    $prole = (string) ($ud->p->role ?? $role);
    if ($prole === 'bench') $prole = 'employee';
    $a = learnAssign();
    $req = [];
    // v34: "staff" means everyone on StratEdge's side (administrators, HR, accounting, managers, employees, recruiting team):
    // the same people who accept the security policies
    $isStaff = null;
    foreach ($courses as $c) {
        $id = $c['id'];
        $reqRoles = array_values(array_unique(array_map(fn($x) => (string) $x === 'bench' ? 'employee' : (string) $x, (array) ($c['req'] ?? []))));
        if (in_array('staff', $reqRoles, true) && $isStaff === null) {
            $isStaff = false;
            if ($u) {
                require_once __DIR__ . '/gov.php';
                $isStaff = in_array('staff', govAudOf($u), true) || in_array($prole, ['employee'], true);
            }
        }
        if (in_array($prole, $reqRoles, true) || (in_array('staff', $reqRoles, true) && $isStaff) || in_array($id, (array) ($a['byRole'][$prole] ?? []), true) || in_array($id, (array) ($a['byUid'][$uid] ?? []), true)) {
            $req[$id] = (int) ($a['due'][$id] ?? 0);
        }
    }
    return $req;
}

/* ---------- live projects ---------- */
function projStackParts(string $stack): array
{
    $s = mb_strtolower($stack);
    $has = fn(string ...$w) => array_reduce($w, fn($c, $x) => $c || str_contains($s, $x), false);
    $fe = $has('react') ? 'React (TypeScript)' : ($has('angular') ? 'Angular' : ($has('vue') ? 'Vue' : ($has('.net', 'blazor') ? 'Blazor or React' : 'React (TypeScript)')));
    $be = $has('spring', 'java') ? 'Java 21 + Spring Boot' : ($has('.net', 'c#') ? '.NET 8 Web API (C#)' : ($has('node', 'express', 'nest') ? 'Node.js + NestJS' : ($has('django', 'python', 'fastapi', 'flask') ? 'Python + FastAPI' : ($has('go', 'golang') ? 'Go' : ($has('php', 'laravel') ? 'PHP 8 + Laravel' : ($has('salesforce', 'apex') ? 'Salesforce Apex + LWC' : ($has('ruby', 'rails') ? 'Ruby on Rails' : 'Java 21 + Spring Boot')))))));
    $db = $has('mongo') ? 'MongoDB' : ($has('mysql') ? 'MySQL' : ($has('sql server', 'mssql') ? 'SQL Server' : ($has('oracle') ? 'Oracle' : ($has('dynamo') ? 'DynamoDB' : 'PostgreSQL'))));
    $cloud = $has('azure') ? 'Azure (App Service, Azure SQL/Cosmos, Service Bus, Key Vault)' : ($has('gcp', 'google cloud') ? 'Google Cloud (Cloud Run, Cloud SQL, Pub/Sub)' : 'AWS (ECS/Fargate, RDS, SQS, S3, CloudWatch)');
    $queue = $has('kafka') ? 'Kafka' : ($has('rabbit') ? 'RabbitMQ' : ($has('azure') ? 'Azure Service Bus' : ($has('gcp', 'google cloud') ? 'Pub/Sub' : 'SQS')));
    $data = $has('spark', 'databricks', 'snowflake', 'etl', 'data engineer', 'airflow');
    $qa = $has('qa', 'selenium', 'playwright', 'test automation', 'cypress');
    $devops = $has('devops', 'kubernetes', 'terraform', 'sre');
    $ds = $has('machine learning', 'data scien', 'ml ', 'pytorch', 'tensorflow', 'llm');
    return ['fe' => $fe, 'be' => $be, 'db' => $db, 'cloud' => $cloud, 'queue' => $queue, 'data' => $data, 'qa' => $qa, 'devops' => $devops, 'ds' => $ds];
}
/** A brief from the templates: domain picked by keyword or at random; architecture and milestones adapted to the stack and hours. */
function projTemplateBrief(array $in): array
{
    $track = projTrack($in);
    $tpls = $track === 'it' ? projTemplates() : array_values(array_filter(projTemplatesMore(), fn($t) => $t['track'] === $track));
    $dom = mb_strtolower((string) ($in['domain'] ?? ''));
    $used = array_map('strval', (array) ($in['used'] ?? []));
    $pick = null;
    foreach ($tpls as $t) {
        if ($dom !== '' && (str_contains(mb_strtolower($t['domain']), $dom) || str_contains($dom, mb_strtolower($t['k'])) || str_contains(mb_strtolower($t['t']), $dom))) {
            $pick = $t;
            break;
        }
    }
    if (!$pick && $track !== 'it') {
        // the role words decide among the healthcare / business templates ("medical coder" -> the coding audit)
        $words = array_filter(preg_split('/[^a-z0-9&]+/', mb_strtolower(($in['role'] ?? '') . ' ' . ($in['skills'] ?? ''))) ?: [], fn($w) => mb_strlen($w) >= 2);
        $best = 0;
        foreach ($tpls as $t) {
            if (in_array($t['k'], $used, true)) {
                continue;
            }
            $roleWords = explode(' ', $t['roles']);
            $hit = count(array_intersect($words, $roleWords));
            if ($hit > $best) {
                $best = $hit;
                $pick = $t;
            }
        }
    }
    if (!$pick) {
        $free = array_values(array_filter($tpls, fn($t) => !in_array($t['k'], $used, true)));
        $pick = ($free ?: $tpls)[array_rand($free ?: $tpls)];
    }
    if ($track !== 'it') {
        return projTemplateBriefWork($pick, $in, $track);
    }
    $sp = projStackParts((string) ($in['stack'] ?? '') . ' ' . (string) ($in['role'] ?? '') . ' ' . (string) ($in['skills'] ?? ''));
    $hours = max(10, min(400, (int) ($in['hours'] ?? 60)));
    $level = (string) ($in['level'] ?? 'mid');
    $weeks = max(2, (int) ceil($hours / 10));
    $comps = ['API: ' . $sp['be'] . ' - REST endpoints, validation, auth (JWT/OIDC), OpenAPI spec', 'Database: ' . $sp['db'] . ' - migrations, indexes for the hot queries, seed data', 'Web app: ' . $sp['fe'] . ' - routing, forms with validation, tables with server-side paging, role-aware menus', 'Async work: ' . $sp['queue'] . ' - reminders, imports and notifications off the request path, idempotent consumers', 'Platform: ' . $sp['cloud'] . ' - containerised, infrastructure as code, CI with tests on every pull request, structured logs and metrics'];
    if ($sp['data']) {
        $comps[] = 'Data pipeline: nightly batch (Airflow or Databricks jobs) that loads events into a star schema for reporting; data-quality checks with alerts';
    }
    if ($sp['qa']) {
        $comps[] = 'Test automation: Playwright end-to-end suite for the main journeys, contract tests for the API, a nightly regression run in CI with reports';
    }
    if ($sp['devops']) {
        $comps[] = 'Operations: Kubernetes manifests (Helm), Terraform for the cloud resources, blue/green deploys, SLOs with alerting';
    }
    if ($sp['ds']) {
        $comps[] = 'Model: a baseline model (gradient boosting or a small fine-tuned transformer) for the prediction the domain needs, offline evaluation, a batch scoring job and a monitored endpoint';
    }
    $m = [];
    $m[] = ['t' => 'Week 1 - Discover and design', 'd' => max(2, (int) round($weeks * 0.2)) * 7, 'tasks' => ['Write the one-page product brief and the user list', 'Draw the architecture (C4 level 1 and 2) and the data model', 'Define the API contract (OpenAPI) and the acceptance criteria', 'Set up the repository, CI and a hello-world deploy']];
    $m[] = ['t' => 'Build the core', 'd' => max(3, (int) round($weeks * 0.35)) * 7, 'tasks' => array_slice(array_map(fn($f) => 'Implement: ' . $f, $pick['features']), 0, 4)];
    $m[] = ['t' => 'Finish the features and harden', 'd' => max(2, (int) round($weeks * 0.3)) * 7, 'tasks' => array_merge(array_map(fn($f) => 'Implement: ' . $f, array_slice($pick['features'], 4)), ['Automated tests for every acceptance criterion', 'Observability: logs, metrics, one dashboard, one alert'])];
    $m[] = ['t' => 'Demo and document', 'd' => max(1, (int) round($weeks * 0.15)) * 7, 'tasks' => ['Record a 5-minute demo walking through the acceptance criteria', 'Write the README: run instructions, architecture, decisions and trade-offs', 'Prepare the interview talking points and resume bullets', 'Upload everything to the vault']];
    $resume = [
        'Built ' . mb_strtolower($pick['t']) . ' as a practice engagement: ' . $sp['be'] . ', ' . $sp['db'] . ', ' . $sp['fe'] . ', deployed on ' . explode(' (', $sp['cloud'])[0] . ' with CI/CD',
        'Designed ' . count($pick['data']) . ' core entities and a ' . $sp['queue'] . '-based asynchronous workflow; all ' . count($pick['accept']) . ' acceptance criteria covered by automated tests',
        'Owned the full lifecycle from brief and architecture to demo and documentation in ' . $weeks . ' weeks (' . $hours . ' hours)',
    ];
    return ['t' => $pick['t'], 'tag' => $pick['k'], 'domain' => $pick['domain'], 'stack' => array_values(array_filter([$sp['be'], $sp['db'], $sp['fe'], $sp['queue'], explode(' (', $sp['cloud'])[0]])), 'level' => $level, 'hours' => $hours, 'weeks' => $weeks, 'summary' => 'A ' . $weeks . '-week, ' . $hours . '-hour practice engagement for a ' . ($in['role'] ?: 'software engineer') . ': ' . mb_strtolower($pick['t']) . ' for a ' . mb_strtolower($pick['domain']) . ' client.', 'problem' => $pick['problem'], 'users' => $pick['users'], 'features' => $pick['features'], 'arch' => ['overview' => 'A modular monolith with clear boundaries (API, domain, persistence, jobs) that can be split later; the web app talks to the API only; background work goes through the queue.', 'components' => $comps, 'data' => $pick['data']], 'nfr' => $pick['nfr'], 'accept' => $pick['accept'], 'milestones' => $m, 'stretch' => ['Add role-based access with an admin console', 'Add a second interface (mobile web or a CLI) on the same API', 'Load-test the hot path and write up the results', 'Add a feature flag system and ship one feature dark'], 'talk' => $pick['talk'], 'resume' => $resume, 'src' => 'template'];
}
/** A healthcare or business brief from a template: tools instead of a stack, deliverables instead of features,
 *  an approach and workstreams instead of an architecture; phases fitted to the hours. */
function projTemplateBriefWork(array $pick, array $in, string $track): array
{
    $hours = max(10, min(400, (int) ($in['hours'] ?? 60)));
    $level = (string) ($in['level'] ?? 'mid');
    $weeks = max(2, (int) ceil($hours / 10));
    $tools = $pick['tools'];
    foreach (array_filter(array_map('trim', preg_split('/[,;\/]+/', (string) ($in['stack'] ?? '')) ?: [])) as $extra) {
        if (count($tools) < 8 && !in_array(mb_strtolower($extra), array_map('mb_strtolower', $tools), true)) {
            $tools[] = mb_substr($extra, 0, 60);
        }
    }
    $role = $in['role'] ?: ($track === 'health' ? 'healthcare professional' : 'business professional');
    $deliv = $pick['features'];
    $m = [];
    $m[] = ['t' => 'Discover and plan', 'd' => max(2, (int) round($weeks * 0.2)) * 7, 'tasks' => ['Write the one-page charter: problem, scope, success measures and stakeholders', 'Hold a (role-played) intake with the main stakeholder and record the decisions', 'List the data and documents you need and build the synthetic dataset', 'Agree the timeline and how progress will be reported']];
    $m[] = ['t' => 'Analyze the current state', 'd' => max(3, (int) round($weeks * 0.3)) * 7, 'tasks' => array_merge(['Measure the baseline and write it down with the definitions used'], array_slice(array_map(fn($f) => 'Deliver: ' . $f, $deliv), 0, 2), ['Find the root causes and rank them by impact'])];
    $m[] = ['t' => 'Build the deliverables', 'd' => max(2, (int) round($weeks * 0.35)) * 7, 'tasks' => array_map(fn($f) => 'Deliver: ' . $f, array_slice($deliv, 2))];
    $m[] = ['t' => 'Present and hand over', 'd' => max(1, (int) round($weeks * 0.15)) * 7, 'tasks' => ['Prepare a 10-minute presentation for leadership with the results against the success measures', 'Write the hand-over: how to keep it running, owners and the review schedule', 'Check every acceptance criterion and attach the evidence', 'Write a one-page reflection: what you would do differently']];
    $stretch = $track === 'health'
        ? ['Present the project as a poster in the format quality conferences use', 'Add a second site or unit and compare the results', 'Write a policy or standard-work document from the project', 'Turn the dashboard into a monthly report for leadership']
        : ['Automate the monthly report with Power Query or a pivot-table refresh', 'Add a second scenario or location and compare the results', 'Write the standard operating procedure for the new process', 'Present the business case with costs, savings and payback'];
    return [
        't' => $pick['t'], 'tag' => $pick['k'], 'track' => $track, 'domain' => $pick['domain'], 'stack' => array_values($tools), 'level' => $level, 'hours' => $hours, 'weeks' => $weeks,
        'summary' => 'A ' . $weeks . '-week, ' . $hours . '-hour practice engagement for a ' . $role . ': ' . mb_strtolower($pick['t']) . ' for a ' . mb_strtolower($pick['domain']) . ' team. All data is synthetic or de-identified, so it can go in your portfolio.',
        'problem' => $pick['problem'], 'users' => $pick['users'], 'features' => $deliv,
        'arch' => ['overview' => $pick['approach'], 'components' => $pick['work'], 'data' => $pick['data']],
        'nfr' => $pick['nfr'], 'accept' => $pick['accept'], 'milestones' => $m, 'stretch' => $stretch, 'talk' => $pick['talk'],
        'resume' => array_merge($pick['resume'], []),
        'src' => 'template',
    ];
}
function projAiBrief(array $in): ?array
{
    $track = projTrack($in);
    $sys = [
        'it' => 'You design realistic practice projects for IT consultants so they can rehearse client work and talk about it in interviews. Answer with one JSON object only.',
        'health' => 'You design realistic practice projects for healthcare professionals (clinical staff, coding and billing, revenue cycle, health information management, quality, pharmacy, patient access, health administration and clinical informatics) so they can rehearse real work and talk about it in interviews. The work is not software development unless the role asks for it. Use synthetic or de-identified data only, never real patient information, and do not give medical advice. Answer with one JSON object only.',
        'biz' => 'You design realistic practice projects for business professionals outside IT (accounting and finance, HR and recruiting, marketing, sales, operations and supply chain, project management, customer service, administration) so they can rehearse real work and talk about it in interviews. The work is not software development. Use synthetic data only. Answer with one JSON object only.',
    ][$track];
    $prompt = "Create a live project brief for this " . ($track === 'it' ? 'consultant' : 'professional') . ".\nTarget role: " . ($in['role'] ?: ['it' => 'software engineer', 'health' => 'healthcare professional', 'biz' => 'business professional'][$track]) . "\nSkills: " . ($in['skills'] ?: '-') . "\n" . ($track === 'it' ? 'Preferred stack' : 'Tools they use') . ": " . ($in['stack'] ?: 'your choice') . "\nLevel: " . ($in['level'] ?: 'mid') . "\nIndustry/domain: " . ($in['domain'] ?: 'your choice') . "\nTime available: " . (int) ($in['hours'] ?? 60) . " hours\nGoal: " . ($in['goal'] ?: 'interview readiness') . "" . ($track === 'it' ? '' : "\nThis is a " . ($track === 'health' ? 'healthcare' : 'business (non-IT)') . " project: use the keys with these meanings - stack = the tools and systems the person would use (e.g. Excel, Power BI, an EHR, QuickBooks); features = the deliverables; arch.overview = the approach; arch.components = the workstreams; arch.data = the data sources and records (synthetic); nfr = the standards, regulations and constraints that apply (e.g. HIPAA, CMS rules, GAAP, I-9 rules); resume bullets must describe the work as a simulated or practice engagement.") . "\n\nReturn JSON with exactly these keys: t (title), domain, stack (array of 4-6 strings), summary (2 sentences), problem (one paragraph as a client would describe it), users (array of 3-5 strings), features (array of 6-8 strings), arch {overview (2 sentences), components (array of 5-7 strings naming technology and responsibility), data (array of 5-8 entity descriptions)}, nfr (array of 3-5 non-functional requirements), accept (array of 4-6 testable acceptance criteria), milestones (array of 4 objects {t, d (days), tasks (array of 3-5 strings)}), stretch (array of 3-4), talk (array of 4-6 interview questions about this project), resume (array of 3 resume bullet points, past tense, with numbers).";
    $j = learnAiJson($sys, $prompt, 3000, 'projects');
    if (!$j || empty($j['t']) || empty($j['features']) || empty($j['milestones'])) {
        return null;
    }
    $arr = fn($v, int $max) => array_slice(array_values(array_filter(array_map(fn($x) => is_string($x) ? mb_substr(trim($x), 0, 400) : (is_array($x) ? mb_substr(trim((string) ($x['t'] ?? $x['title'] ?? json_encode($x))), 0, 400) : ''), (array) $v), fn($x) => $x !== '')), 0, $max);
    $ms = [];
    foreach (array_slice((array) $j['milestones'], 0, 6) as $m) {
        $m = (array) $m;
        $ms[] = ['t' => mb_substr((string) ($m['t'] ?? $m['title'] ?? 'Milestone'), 0, 160), 'd' => max(1, min(120, (int) ($m['d'] ?? $m['days'] ?? 7))), 'tasks' => $arr($m['tasks'] ?? [], 8)];
    }
    $arch = (array) ($j['arch'] ?? []);
    $hours = max(10, min(400, (int) ($in['hours'] ?? 60)));
    return ['t' => mb_substr((string) $j['t'], 0, 160), 'tag' => 'ai', 'track' => $track, 'domain' => mb_substr((string) ($j['domain'] ?? ($in['domain'] ?: 'General')), 0, 80), 'stack' => $arr($j['stack'] ?? [], 8), 'level' => (string) ($in['level'] ?? 'mid'), 'hours' => $hours, 'weeks' => max(2, (int) ceil($hours / 10)), 'summary' => mb_substr((string) ($j['summary'] ?? ''), 0, 600), 'problem' => mb_substr((string) ($j['problem'] ?? ''), 0, 1500), 'users' => $arr($j['users'] ?? [], 6), 'features' => $arr($j['features'] ?? [], 10), 'arch' => ['overview' => mb_substr((string) ($arch['overview'] ?? ''), 0, 600), 'components' => $arr($arch['components'] ?? [], 8), 'data' => $arr($arch['data'] ?? [], 10)], 'nfr' => $arr($j['nfr'] ?? [], 6), 'accept' => $arr($j['accept'] ?? [], 8), 'milestones' => $ms, 'stretch' => $arr($j['stretch'] ?? [], 5), 'talk' => $arr($j['talk'] ?? [], 8), 'resume' => $arr($j['resume'] ?? [], 4), 'src' => 'ai'];
}
/** IT & software, healthcare, or business (non-IT) work: from the wizard, else guessed from the role and skills. */
function projTrack(array $in): string
{
    $t = (string) ($in['track'] ?? '');
    if (in_array($t, ['it', 'health', 'biz'], true)) {
        return $t;
    }
    $health = '/\b(nurs\w*|rn|lpn|cna|coder|coding|cpc|ccs|billing|biller|rcm|revenue cycle|clinical|clinician|pharmac\w*|patient|medical|health\w*|hipaa|ehr|epic|cerner|him|hedis|care coordinat\w*|physician|dental|therapist|phlebotom\w*)\b/';
    $biz = '/\b(accountant|accounting|bookkeep\w*|finance|financial|fp&a|fpa|payable|receivable|controller|auditor|tax|hr|human resources|recruit\w*|talent acquisition|sourcer|payroll|marketing|marketer|seo|content|sales|business development|account executive|account manager|supply chain|procure\w*|buyer|planner|logistic\w*|warehouse|operations|project manager|pmp|program manager|scrum master|customer service|support|call center|contact center|administrative|office manager|coordinator)\b/';
    $it = '/\b(developer|engineer|programmer|devops|sre|architect|java|python|react|angular|node|\.net|sql|cloud|aws|azure|gcp|sap|salesforce|data engineer|data scientist|qa|automation|network|cyber\w*|security analyst|it support|helpdesk|dba)\b/';
    $role = ' ' . mb_strtolower((string) ($in['role'] ?? '')) . ' ';
    // the role decides first ("Recruiter" with "healthcare staffing" skills is business work)
    if (preg_match($it, $role)) {
        return 'it';
    }
    if (preg_match($biz, $role)) {
        return 'biz';
    }
    if (preg_match($health, $role)) {
        return 'health';
    }
    $rest = ' ' . mb_strtolower(($in['skills'] ?? '') . ' ' . ($in['domain'] ?? '')) . ' ';
    if (preg_match($it, $rest)) {
        return 'it';
    }
    if (preg_match($health, $rest)) {
        return 'health';
    }
    if (preg_match($biz, $rest)) {
        return 'biz';
    }
    return 'it';
}
function projBriefIn(array $b): array
{
    $in = [];
    foreach (['role', 'skills', 'stack', 'level', 'domain', 'goal'] as $k) {
        $in[$k] = mb_substr(trim((string) ($b[$k] ?? '')), 0, 300);
    }
    $in['track'] = projTrack(['track' => (string) ($b['track'] ?? '')] + $in);
    $in['hours'] = max(10, min(400, (int) ($b['hours'] ?? 60)));
    $in['used'] = array_slice(array_map('strval', (array) ($b['used'] ?? [])), 0, 30);
    return $in;
}
/** Validate a brief coming back from the browser (saved projects, catalog edits). */
function projCleanBrief(array $x): array
{
    $arr = fn($v, int $max, int $len = 400) => array_slice(array_values(array_filter(array_map(fn($s) => mb_substr(trim((string) (is_array($s) ? ($s['t'] ?? '') : $s)), 0, $len), (array) $v), fn($s) => $s !== '')), 0, $max);
    $ms = [];
    foreach (array_slice((array) ($x['milestones'] ?? []), 0, 8) as $m) {
        $m = (array) $m;
        $ms[] = ['t' => mb_substr((string) ($m['t'] ?? 'Milestone'), 0, 160), 'd' => max(1, min(120, (int) ($m['d'] ?? 7))), 'tasks' => $arr($m['tasks'] ?? [], 10)];
    }
    $arch = (array) ($x['arch'] ?? []);
    return ['t' => mb_substr(trim((string) ($x['t'] ?? 'Untitled project')), 0, 160), 'tag' => mb_substr((string) ($x['tag'] ?? ''), 0, 40), 'track' => in_array($x['track'] ?? '', ['it', 'health', 'biz'], true) ? (string) $x['track'] : 'it', 'domain' => mb_substr((string) ($x['domain'] ?? ''), 0, 80), 'stack' => $arr($x['stack'] ?? [], 8, 80), 'level' => mb_substr((string) ($x['level'] ?? 'mid'), 0, 20), 'hours' => max(10, min(400, (int) ($x['hours'] ?? 60))), 'weeks' => max(1, min(52, (int) ($x['weeks'] ?? 6))), 'summary' => mb_substr((string) ($x['summary'] ?? ''), 0, 600), 'problem' => mb_substr((string) ($x['problem'] ?? ''), 0, 1500), 'users' => $arr($x['users'] ?? [], 8), 'features' => $arr($x['features'] ?? [], 12), 'arch' => ['overview' => mb_substr((string) ($arch['overview'] ?? ''), 0, 600), 'components' => $arr($arch['components'] ?? [], 10), 'data' => $arr($arch['data'] ?? [], 12)], 'nfr' => $arr($x['nfr'] ?? [], 8), 'accept' => $arr($x['accept'] ?? [], 10), 'milestones' => $ms, 'stretch' => $arr($x['stretch'] ?? [], 6), 'talk' => $arr($x['talk'] ?? [], 10), 'resume' => $arr($x['resume'] ?? [], 5), 'src' => in_array($x['src'] ?? '', ['ai', 'template', 'catalog', 'manual'], true) ? $x['src'] : 'manual'];
}

/** One quiz item, validated (answers in range, enough options); null when it cannot be used. */
function learnCleanQuizItem(array $q): ?array
{
    $ty = in_array($q['ty'] ?? '', LEARN_QUIZ_TYPES, true) ? $q['ty'] : 'mc';
    $item = ['ty' => $ty, 'q' => mb_substr(trim((string) ($q['q'] ?? '')), 0, 600), 'why' => mb_substr((string) ($q['why'] ?? ''), 0, 600)];
    if ($item['q'] === '') {
        return null;
    }
    $opts = array_slice(array_values(array_filter(array_map(fn($o) => mb_substr(trim((string) $o), 0, 300), (array) ($q['o'] ?? [])), fn($o) => $o !== '')), 0, 10);
    switch ($ty) {
        case 'mc':
            if (count($opts) < 2) {
                return null;
            }
            $item['o'] = $opts;
            $item['a'] = max(0, min(count($opts) - 1, (int) ($q['a'] ?? 0)));
            break;
        case 'multi':
            if (count($opts) < 2) {
                return null;
            }
            $item['o'] = $opts;
            $item['a'] = array_values(array_unique(array_filter(array_map('intval', (array) ($q['a'] ?? [])), fn($i) => $i >= 0 && $i < count($opts))));
            break;
        case 'tf':
            $item['a'] = !empty($q['a']);
            break;
        case 'fill':
            $item['a'] = array_slice(array_values(array_filter(array_map(fn($o) => mb_substr(trim((string) $o), 0, 120), (array) ($q['a'] ?? [])), fn($o) => $o !== '')), 0, 10);
            if (!$item['a']) {
                return null;
            }
            break;
        case 'num':
            $item['a'] = (float) ($q['a'] ?? 0);
            $item['tol'] = max(0, (float) ($q['tol'] ?? 0));
            break;
        case 'order':
            if (count($opts) < 2) {
                return null;
            }
            $item['o'] = $opts;
            break;
        case 'match':
            $pairs = [];
            foreach (array_slice((array) ($q['pairs'] ?? []), 0, 8) as $pr) {
                $pr = array_values((array) $pr);
                if (count($pr) >= 2 && trim((string) $pr[0]) !== '' && trim((string) $pr[1]) !== '') {
                    $pairs[] = [mb_substr(trim((string) $pr[0]), 0, 200), mb_substr(trim((string) $pr[1]), 0, 200)];
                }
            }
            if (count($pairs) < 2) {
                return null;
            }
            $item['pairs'] = $pairs;
            break;
        case 'scramble':
            $item['a'] = mb_substr(trim((string) ($q['a'] ?? '')), 0, 60);
            $item['hint'] = mb_substr((string) ($q['hint'] ?? ''), 0, 160);
            if ($item['a'] === '') {
                return null;
            }
            break;
    }
    return $item;
}

/** v32: students and outside consultants need the feature in their plan (staff, employees and StratEdge's own
 *  consultants always may); a course HR made required for the person is always open to them. */
function learnPlanGate(array $u, string $feature, ?array $course = null): void
{
    if (userLevel($u) >= 2) {
        return;
    }
    if ($course && learnRequired($u['id'], [$course])) {
        return;
    }
    require_once __DIR__ . '/billing.php';
    billGate($u, $feature);
}

/* ---------- routes ---------- */
function learnRoute(string $r, array $b): void
{
    switch ($r) {
        /* ----- learner ----- */
        case 'learn_catalog': {
            $u = requireUser();
            $uid = $u['id'];
            $courses = learnCourses();
            $staff = userLevel($u) >= 2;
            $req = learnRequired($uid, $courses);
            $out = [];
            foreach ($courses as $c) {
                if (empty($c['pub']) && !$staff) {
                    continue;
                }
                $p = learnProgress($uid, $c['id']);
                $out[] = ['id' => $c['id'], 't' => $c['t'], 'desc' => $c['desc'] ?? '', 'cat' => $c['cat'] ?? '', 'level' => $c['level'] ?? '', 'min' => (int) ($c['min'] ?? 0), 'cert' => !empty($c['cert']), 'pub' => !empty($c['pub']), 'shape' => learnShape($c), 'req' => isset($req[$c['id']]), 'dueDays' => $req[$c['id']] ?? 0, 'pct' => (int) ($p->pct ?? 0), 'completedAt' => $p->completedAt ?? null, 'certId' => $p->cert ?? null, 'started' => $p->started ?? null, 'avg' => $p->avg ?? null];
            }
            $certs = array_map(fn($x) => ['id' => (string) $x[0]] + json_decode(json_encode($x[1]), true), colAll("learn/$uid/certs"));
            ok(['courses' => $out, 'certs' => $certs]);
        }
        case 'learn_course': {
            $u = requireUser();
            $id = preg_replace('/[^a-z0-9\-]/', '', (string) ($b['id'] ?? ($_GET['id'] ?? '')));
            learnSeed();
            $c = $id !== '' ? learnCourse($id) : null;
            if (!$c || (empty($c['pub']) && userLevel($u) < 2)) {
                fail(404, 'not_found', 'That course is not available.');
            }
            learnPlanGate($u, 'learn', $c);
            $p = learnProgress($u['id'], $id);
            if (empty($p->started)) {
                $p->started = now();
                docSet("learn/{$u['id']}/p/$id", $p);
            }
            ok(['course' => learnPublic($c), 'progress' => $p]);
        }
        case 'learn_lesson_read': {
            $u = requireUser();
            $cid = preg_replace('/[^a-z0-9\-]/', '', (string) ($b['course'] ?? ''));
            $lid = preg_replace('/[^A-Za-z0-9\-_]/', '', (string) ($b['lesson'] ?? ''));
            $c = $cid !== '' ? learnCourse($cid) : null;
            if (!$c) {
                fail(404, 'not_found', 'Course not found.');
            }
            $lesson = null;
            foreach ($c['mods'] as $m) {
                foreach ($m['ls'] as $l) {
                    if ((string) $l['id'] === $lid) {
                        $lesson = $l;
                    }
                }
            }
            if (!$lesson) {
                fail(404, 'not_found', 'Lesson not found.');
            }
            if (!empty($lesson['quiz'])) {
                fail(400, 'invalid_argument', 'This lesson has a quiz; pass it to complete the lesson.');
            }
            learnPlanGate($u, 'learn', $c);
            $p = learnProgress($u['id'], $cid);
            $p->done->$lid = now();
            $p = learnRecalc($u['id'], $c, $p);
            docSet("learn/{$u['id']}/p/$cid", $p);
            ok(['progress' => $p]);
        }
        case 'learn_quiz': {
            $u = requireUser();
            $cid = preg_replace('/[^a-z0-9\-]/', '', (string) ($b['course'] ?? ''));
            $lid = preg_replace('/[^A-Za-z0-9\-_]/', '', (string) ($b['lesson'] ?? ''));
            $c = $cid !== '' ? learnCourse($cid) : null;
            if (!$c) {
                fail(404, 'not_found', 'Course not found.');
            }
            $lesson = null;
            foreach ($c['mods'] as $m) {
                foreach ($m['ls'] as $l) {
                    if ((string) $l['id'] === $lid) {
                        $lesson = $l;
                    }
                }
            }
            if (!$lesson || empty($lesson['quiz'])) {
                fail(404, 'not_found', 'Quiz not found.');
            }
            learnPlanGate($u, 'learn', $c);
            $answers = (array) ($b['answers'] ?? []);
            $g = learnGrade(array_values((array) $lesson['quiz']), $answers);
            $pass = (int) ($c['pass'] ?? 70);
            $p = learnProgress($u['id'], $cid);
            $prev = $p->scores->$lid ?? null;
            $p->scores->$lid = (object) ['pct' => max((int) $g['pct'], (int) ($prev->pct ?? 0)), 'last' => $g['pct'], 'at' => now(), 'n' => (int) ($prev->n ?? 0) + 1];
            $passed = $g['pct'] >= $pass;
            if ($passed) {
                $p->done->$lid = now();
            }
            $p = learnRecalc($u['id'], $c, $p);
            docSet("learn/{$u['id']}/p/$cid", $p);
            ok(['result' => $g, 'passed' => $passed, 'pass' => $pass, 'progress' => $p]);
        }
        case 'learn_cert': {
            $u = requireUser();
            $uid = (string) ($b['uid'] ?? ($_GET['uid'] ?? $u['id']));
            $id = preg_replace('/[^A-Za-z0-9]/', '', (string) ($b['id'] ?? ($_GET['id'] ?? '')));
            if ($uid !== $u['id']) {
                learnStaff(false);
            }
            $d = $id !== '' ? docGet("learn/$uid/certs/$id") : null;
            if (!$d) {
                fail(404, 'not_found', 'Certificate not found.');
            }
            ok(['cert' => $d, 'org' => (string) (cfg('site_name') ?: 'StratEdge IT Consulting')]);
        }
        case 'learn_cert_verify': {
            // public: a certificate number + code resolve to name, course and date (printed on the PDF)
            $no = preg_replace('/[^A-Z0-9\-]/', '', strtoupper((string) ($b['no'] ?? ($_GET['no'] ?? ''))));
            $code = preg_replace('/[^a-z0-9]/', '', strtolower((string) ($b['code'] ?? ($_GET['code'] ?? ''))));
            if ($no === '' || $code === '') {
                fail(400, 'invalid_argument', 'Enter the certificate number and code.');
            }
            $s = db()->prepare("SELECT data FROM docs WHERE path LIKE 'learn/%/certs/%'");
            $s->execute();
            while ($row = $s->fetch()) {
                $d = json_decode($row['data']);
                if ($d && ($d->no ?? '') === $no && ($d->code ?? '') === $code) {
                    // v32: certifications carry a level, the skills they cover and an expiry
                    $exp = (int) ($d->exp ?? 0);
                    ok(['valid' => true, 'n' => $d->n, 't' => $d->t, 'at' => $d->at, 'no' => $d->no, 'kind' => (string) ($d->kind ?? 'course'), 'level' => (string) ($d->level ?? ''), 'skills' => (array) ($d->skills ?? []), 'exp' => $exp, 'expired' => $exp > 0 && $exp < now(), 'pct' => $d->avg ?? null, 'org' => (string) (cfg('site_name') ?: 'StratEdge IT Consulting')]);
                }
            }
            ok(['valid' => false]);
        }
        /* ----- staff: courses ----- */
        case 'learn_courses_admin': {
            learnStaff(false);
            ok(['courses' => learnCourses(), 'assign' => learnAssign(), 'defaults' => array_map(fn($c) => ['id' => $c['id'], 't' => $c['t']], learnDefaultCourses()), 'ai' => aiReady('quiz'), 'aiCourses' => aiReady('courses')]);
        }
        case 'learn_course_save': {
            $u = learnStaff(true);
            $x = (array) ($b['course'] ?? []);
            $id = preg_replace('/[^a-z0-9\-]/', '', strtolower((string) ($x['id'] ?? '')));
            if ($id === '') {
                $id = preg_replace('/[^a-z0-9]+/', '-', strtolower(trim((string) ($x['t'] ?? '')))) ?: 'course';
                $id = trim($id, '-') ?: 'course';
                if (docGet("learn/x/courses/$id")) {
                    $id .= '-' . rid(3);
                }
            }
            if (trim((string) ($x['t'] ?? '')) === '') {
                fail(400, 'invalid_argument', 'The course needs a title.');
            }
            $mods = [];
            $seenL = [];
            foreach (array_slice((array) ($x['mods'] ?? []), 0, 30) as $mi => $m) {
                $m = (array) $m;
                $ls = [];
                foreach (array_slice((array) ($m['ls'] ?? []), 0, 40) as $li => $l) {
                    $l = (array) $l;
                    $lid = preg_replace('/[^A-Za-z0-9\-_]/', '', (string) ($l['id'] ?? ''));
                    if ($lid === '' || isset($seenL[$lid])) {
                        $lid = 'l' . rid(3);
                    }
                    $seenL[$lid] = true;
                    $quiz = [];
                    foreach (array_slice((array) ($l['quiz'] ?? []), 0, 40) as $q) {
                        $item = learnCleanQuizItem((array) $q);
                        if ($item !== null) {
                            $quiz[] = $item;
                        }
                    }
                    $ls[] = ['id' => $lid, 't' => mb_substr(trim((string) ($l['t'] ?? 'Lesson')), 0, 160), 'body' => mb_substr((string) ($l['body'] ?? ''), 0, 20000), 'quiz' => $quiz];
                }
                $mods[] = ['id' => preg_replace('/[^A-Za-z0-9\-_]/', '', (string) ($m['id'] ?? '')) ?: 'm' . ($mi + 1), 't' => mb_substr(trim((string) ($m['t'] ?? 'Module')), 0, 160), 'ls' => $ls];
            }
            $prev = learnCourse($id);
            $c = ['id' => $id, 't' => mb_substr(trim((string) $x['t']), 0, 160), 'desc' => mb_substr((string) ($x['desc'] ?? ''), 0, 1200), 'cat' => mb_substr((string) ($x['cat'] ?? ''), 0, 60), 'level' => mb_substr((string) ($x['level'] ?? ''), 0, 40), 'min' => max(0, min(2000, (int) ($x['min'] ?? 0))), 'pass' => max(0, min(100, (int) ($x['pass'] ?? 70))), 'cert' => !empty($x['cert']), 'req' => array_values(array_unique(array_filter(array_map(fn($r) => (string) $r === 'bench' ? 'employee' : (string) $r, (array) ($x['req'] ?? [])), fn($r) => in_array($r, ['consultant', 'employee', 'staff'], true)))), 'pub' => !empty($x['pub']), 'ord' => max(0, min(999, (int) ($x['ord'] ?? 50))), 'mods' => $mods, 'builtin' => (bool) ($prev['builtin'] ?? false), 'u' => now(), 'by' => $u['id']];
            docSet("learn/x/courses/$id", json_decode(json_encode($c)));
            ok(['course' => $c]);
        }
        case 'learn_course_delete': {
            learnStaff(true);
            $id = preg_replace('/[^a-z0-9\-]/', '', (string) ($b['id'] ?? ''));
            if ($id === '' || !docGet("learn/x/courses/$id")) {
                fail(404, 'not_found', 'Course not found.');
            }
            docDelete("learn/x/courses/$id");
            ok(['ok' => true]);
        }
        case 'learn_course_reset': {
            learnStaff(true);
            $id = preg_replace('/[^a-z0-9\-]/', '', (string) ($b['id'] ?? ''));
            foreach (learnDefaultCourses() as $c) {
                if ($c['id'] === $id) {
                    $c['u'] = now();
                    $c['builtin'] = true;
                    docSet("learn/x/courses/$id", json_decode(json_encode($c)));
                    ok(['course' => $c]);
                }
            }
            fail(404, 'not_found', 'No built-in course with that id.');
        }
        case 'learn_assign_save': {
            learnStaff(true);
            $byRole = [];
            foreach ((array) ($b['byRole'] ?? []) as $role => $ids) {
                $role = (string) $role === 'bench' ? 'employee' : (string) $role;
                if (in_array($role, ['consultant', 'employee'], true)) {
                    $clean = array_values(array_unique(array_map(fn($i) => preg_replace('/[^a-z0-9\-]/', '', (string) $i), (array) $ids)));
                    $byRole[$role] = array_values(array_unique(array_merge((array) ($byRole[$role] ?? []), $clean)));
                }
            }
            $byUid = [];
            foreach ((array) ($b['byUid'] ?? []) as $uid => $ids) {
                if (preg_match('/^u_[a-f0-9]{16}$/', (string) $uid)) {
                    $list = array_values(array_unique(array_map(fn($i) => preg_replace('/[^a-z0-9\-]/', '', (string) $i), (array) $ids)));
                    if ($list) {
                        $byUid[$uid] = $list;
                    }
                }
            }
            $due = [];
            foreach ((array) ($b['due'] ?? []) as $cid => $days) {
                $due[preg_replace('/[^a-z0-9\-]/', '', (string) $cid)] = max(0, min(365, (int) $days));
            }
            docSet('learn/x/assign', (object) ['byRole' => (object) $byRole, 'byUid' => (object) $byUid, 'due' => (object) $due, 'u' => now()]);
            ok(learnAssign());
        }
        case 'learn_overview': {
            learnStaff(false);
            $courses = learnCourses();
            $rows = [];
            $s = db()->query("SELECT path, data FROM docs WHERE path LIKE 'learn/u_%/p/%'");
            $byUid = [];
            while ($r = $s->fetch()) {
                [, $uid, , $cid] = explode('/', $r['path']);
                $d = json_decode($r['data']);
                $byUid[$uid][$cid] = ['pct' => (int) ($d->pct ?? 0), 'completedAt' => $d->completedAt ?? null, 'avg' => $d->avg ?? null, 'started' => $d->started ?? null, 'cert' => $d->cert ?? null];
            }
            foreach (colAll('u') as [$id, $d]) {
                $role = (string) ($d->p->role ?? '');
                if (!in_array($role, ['consultant', 'employee'], true)) {
                    continue;
                }
                $ur = userRow((string) $id);
                if (!$ur || ($ur['status'] ?? 'active') !== 'active') {
                    continue;
                }
                $req = learnRequired((string) $id, $courses);
                $rows[] = ['uid' => (string) $id, 'n' => (string) ($d->p->n ?? $ur['name'] ?? ''), 'role' => $role, 'req' => array_keys($req), 'p' => $byUid[$id] ?? []];
            }
            $stats = [];
            foreach ($courses as $c) {
                $started = 0;
                $done = 0;
                foreach ($byUid as $per) {
                    if (isset($per[$c['id']])) {
                        $started++;
                        if (!empty($per[$c['id']]['completedAt'])) {
                            $done++;
                        }
                    }
                }
                $stats[$c['id']] = ['started' => $started, 'done' => $done];
            }
            ok(['rows' => $rows, 'courses' => array_map(fn($c) => ['id' => $c['id'], 't' => $c['t'], 'pub' => !empty($c['pub']), 'req' => $c['req'] ?? []], $courses), 'stats' => $stats]);
        }
        /* ----- the course builder: an outline first, then one module per call (each call stays short) ----- */
        case 'learn_ai_outline': {
            learnStaff(true);
            if (!aiReady('courses')) {
                fail(400, 'invalid_argument', 'Creating courses with AI is switched off or no assistant is set up (Admin > Website & messages > Assistant (AI)).');
            }
            $topic = trim(mb_substr((string) ($b['topic'] ?? ''), 0, 300));
            if (mb_strlen($topic) < 3) {
                fail(400, 'invalid_argument', 'Say what the course is about.');
            }
            $nm = max(1, min(10, (int) ($b['modules'] ?? 4)));
            $nl = max(1, min(6, (int) ($b['lessons'] ?? 3)));
            $field = mb_substr(trim((string) ($b['field'] ?? '')), 0, 60);
            $aud = mb_substr(trim((string) ($b['audience'] ?? '')), 0, 120);
            $level = mb_substr(trim((string) ($b['level'] ?? '')), 0, 40);
            $goals = mb_substr(trim((string) ($b['goals'] ?? '')), 0, 1500);
            session_write_close();
            @set_time_limit(120);
            $j = learnAiJson(
                'You design practical training courses for a staffing firm\'s consultants and employees (IT, healthcare and business roles). Answer with one JSON object only.',
                "Design a course outline.\nTopic: $topic\nField: " . ($field ?: 'general') . "\nAudience: " . ($aud ?: 'consultants and employees') . "\nLevel: " . ($level ?: 'Essential') . ($goals !== '' ? "\nWhat learners must be able to do afterwards:\n$goals" : '') .
                "\n\nReturn JSON {\"t\":\"course title\",\"desc\":\"2 sentences for the catalog\",\"cat\":\"one-word category\",\"level\":\"Starter|Essential|Advanced\",\"min\":minutes to complete,\"mods\":[{\"t\":\"module title\",\"ls\":[{\"t\":\"lesson title\",\"points\":[\"3-5 key points the lesson must teach\"]}]}]} with exactly $nm modules of $nl lessons each, in a sensible learning order.",
                2500,
                'courses'
            );
            if (!$j || empty($j['mods'])) {
                fail(502, 'unavailable', 'The assistant did not answer. Try again in a minute.');
            }
            $mods = [];
            foreach (array_slice((array) $j['mods'], 0, $nm) as $m) {
                $m = (array) $m;
                $ls = [];
                foreach (array_slice((array) ($m['ls'] ?? []), 0, $nl) as $l) {
                    $l = (array) $l;
                    $t = mb_substr(trim((string) ($l['t'] ?? '')), 0, 160);
                    if ($t !== '') {
                        $ls[] = ['t' => $t, 'points' => array_slice(array_values(array_filter(array_map(fn($x) => mb_substr(trim((string) $x), 0, 200), (array) ($l['points'] ?? [])))), 0, 6)];
                    }
                }
                $mt = mb_substr(trim((string) ($m['t'] ?? '')), 0, 160);
                if ($mt !== '' && $ls) {
                    $mods[] = ['t' => $mt, 'ls' => $ls];
                }
            }
            if (!$mods) {
                fail(502, 'unavailable', 'The assistant returned an empty outline. Try again with a more specific topic.');
            }
            ok(['outline' => ['t' => mb_substr(trim((string) ($j['t'] ?? $topic)), 0, 160), 'desc' => mb_substr(trim((string) ($j['desc'] ?? '')), 0, 600), 'cat' => mb_substr(trim((string) ($j['cat'] ?? ($field ?: 'Training'))), 0, 60), 'level' => mb_substr(trim((string) ($j['level'] ?? ($level ?: 'Essential'))), 0, 40), 'min' => max(10, min(600, (int) ($j['min'] ?? ($nm * $nl * 12)))), 'mods' => $mods]]);
        }
        case 'learn_ai_module': {
            // writes the lessons (text, quiz, puzzles) of one module; the browser stitches the course together
            learnStaff(true);
            if (!aiReady('courses')) {
                fail(400, 'invalid_argument', 'Creating courses with AI is switched off or no assistant is set up.');
            }
            $c = (array) ($b['course'] ?? []);
            $m = (array) ($b['module'] ?? []);
            $mt = trim(mb_substr((string) ($m['t'] ?? ''), 0, 160));
            if ($mt === '') {
                fail(400, 'invalid_argument', 'Name the module.');
            }
            $plan = [];
            foreach (array_slice((array) ($m['ls'] ?? []), 0, 6) as $l) {
                $l = (array) $l;
                $t = trim(mb_substr((string) ($l['t'] ?? ''), 0, 160));
                if ($t !== '') {
                    $plan[] = '- ' . $t . (!empty($l['points']) ? ': ' . implode('; ', array_map(fn($x) => mb_substr((string) $x, 0, 200), array_slice((array) $l['points'], 0, 6))) : '');
                }
            }
            $nl = $plan ? count($plan) : max(1, min(6, (int) ($b['lessons'] ?? 3)));
            $nq = max(0, min(8, (int) ($b['quiz'] ?? 4)));
            $puzzles = !empty($b['puzzles']);
            session_write_close();
            @set_time_limit(150);
            $types = $puzzles ? 'mc (one answer, 4 options), multi (several answers), tf, fill (one- or two-word typed answer, list accepted spellings), num (a number, tol for tolerance), order (steps listed in the correct order), match (pairs [left,right]) and scramble (a single key word to unscramble, with a hint)' : 'mc (one answer, 4 options), multi (several answers), tf and fill';
            $j = learnAiJson(
                'You write lessons for a corporate learning platform used by a staffing firm (IT, healthcare and business roles). Lessons are practical, accurate and specific, with examples from real work. Never invent statistics, laws, form numbers or URLs; when you are not sure of a detail, describe it generally. Answer with one JSON object only.',
                'COURSE: ' . mb_substr((string) ($c['t'] ?? ''), 0, 160) . "\nCOURSE DESCRIPTION: " . mb_substr((string) ($c['desc'] ?? ''), 0, 600) . "\nLEVEL: " . mb_substr((string) ($c['level'] ?? 'Essential'), 0, 40) . "\nAUDIENCE: " . mb_substr((string) ($c['audience'] ?? 'consultants and employees'), 0, 120) .
                "\nMODULE: $mt\n" . ($plan ? "LESSONS TO WRITE:\n" . implode("\n", $plan) : "Choose $nl lesson titles that cover the module.") .
                "\n\nWrite each lesson as 250-500 words of plain text formatted with: blank lines between paragraphs, '## ' for at most 2 sub-headings, '- ' bullets, **bold** for key terms. End each lesson with a short '## Key takeaways' list." .
                ($nq > 0 ? "\nAfter each lesson add $nq quiz items testing understanding (not trivia), mixing the types $types. Every item has a one-sentence why." : "\nNo quiz items.") .
                "\n\nReturn JSON {\"t\":\"$mt\",\"ls\":[{\"t\":\"lesson title\",\"body\":\"lesson text\",\"quiz\":[{\"ty\":\"mc\",\"q\":\"...\",\"o\":[\"...\"],\"a\":0,\"why\":\"...\"},{\"ty\":\"multi\",\"q\":\"...\",\"o\":[\"...\"],\"a\":[0,2],\"why\":\"...\"},{\"ty\":\"tf\",\"q\":\"...\",\"a\":true,\"why\":\"...\"},{\"ty\":\"fill\",\"q\":\"... ______ ...\",\"a\":[\"word\"],\"why\":\"...\"},{\"ty\":\"num\",\"q\":\"...\",\"a\":10,\"tol\":0,\"why\":\"...\"},{\"ty\":\"order\",\"q\":\"Put the steps in order\",\"o\":[\"first\",\"second\",\"third\"],\"why\":\"...\"},{\"ty\":\"match\",\"q\":\"Match each term\",\"pairs\":[[\"term\",\"meaning\"]],\"why\":\"...\"},{\"ty\":\"scramble\",\"q\":\"Unscramble the term\",\"a\":\"word\",\"hint\":\"...\",\"why\":\"...\"}]}]}",
                min(9000, 900 + $nl * (1100 + $nq * 160)),
                'courses'
            );
            if (!$j || empty($j['ls'])) {
                fail(502, 'unavailable', 'The assistant did not answer for this module. Try it again.');
            }
            $ls = [];
            foreach (array_slice((array) $j['ls'], 0, 6) as $l) {
                $l = (array) $l;
                $t = mb_substr(trim((string) ($l['t'] ?? '')), 0, 160);
                $body = mb_substr(trim((string) ($l['body'] ?? '')), 0, 20000);
                if ($t === '' || $body === '') {
                    continue;
                }
                $quiz = [];
                foreach (array_slice((array) ($l['quiz'] ?? []), 0, 12) as $q) {
                    $item = learnCleanQuizItem((array) $q);
                    if ($item !== null) {
                        $quiz[] = $item;
                    }
                }
                $ls[] = ['id' => 'l' . rid(3), 't' => $t, 'body' => $body, 'quiz' => $quiz];
            }
            if (!$ls) {
                fail(502, 'unavailable', 'The assistant returned no usable lessons for this module. Try it again.');
            }
            ok(['module' => ['id' => 'm' . rid(2), 't' => $mt, 'ls' => $ls]]);
        }
        case 'learn_ai_quiz': {
            learnStaff(true);
            $text = mb_substr(trim((string) ($b['text'] ?? '')), 0, 12000);
            $n = max(2, min(10, (int) ($b['n'] ?? 5)));
            if ($text === '') {
                fail(400, 'invalid_argument', 'Paste the lesson text first.');
            }
            $j = learnAiJson('You write quiz questions for a corporate learning platform. Answer with one JSON object only.', "Write $n quiz items that test understanding of the lesson below. Mix the types mc (one correct answer, 4 options), tf, fill (one-word typed answer) and num (a number). Return JSON {\"items\":[{\"ty\":\"mc\",\"q\":\"...\",\"o\":[\"...\"],\"a\":0,\"why\":\"...\"},{\"ty\":\"tf\",\"q\":\"...\",\"a\":true,\"why\":\"...\"},{\"ty\":\"fill\",\"q\":\"... ______ ...\",\"a\":[\"word\"],\"why\":\"...\"},{\"ty\":\"num\",\"q\":\"...\",\"a\":10,\"why\":\"...\"}]}\n\nLESSON:\n$text", 2500, 'quiz');
            if (!$j || empty($j['items'])) {
                fail(502, 'unavailable', 'The assistant did not answer. Check it under Admin > Website & messages > Assistant (the Test button says why), or write the questions by hand.');
            }
            ok(['items' => array_slice((array) $j['items'], 0, $n)]);
        }
        /* ----- live projects ----- */
        case 'proj_generate': {
            $u = requireUser();
            learnPlanGate($u, 'projects');
            $in = projBriefIn($b);
            $brief = null;
            $note = '';
            if (empty($b['template'])) {
                if (throttleHit('projai:' . $u['id'], 12, 3600)) {
                    fail(429, 'rate_limited', 'That is a lot of projects for one hour. Use one of the briefs you already have, or try again later.');
                }
                $brief = projAiBrief($in);
                if (!$brief && aiReady('projects')) {
                    $note = 'The assistant did not answer; this brief comes from the built-in templates instead.';
                }
            }
            if (!$brief) {
                $brief = projTemplateBrief($in);
                // the set-up hint is for administrators only; a consultant just gets a brief
                if ($note === '' && !aiReady('projects') && hasRole($u, 'admin')) {
                    $note = 'No assistant is configured, so this brief comes from the built-in templates. Add the assistant under Admin > Website & messages > Assistant and the briefs are written for each person.';
                }
            }
            ok(['brief' => $brief, 'note' => $note]);
        }
        case 'proj_catalog': {
            requireUser();
            $items = [];
            foreach (colAll('proj/x/items') as [$id, $d]) {
                $x = json_decode(json_encode($d), true);
                $x['id'] = (string) $id;
                unset($x['milestones'], $x['arch'], $x['accept'], $x['talk'], $x['resume'], $x['nfr'], $x['stretch']);
                $items[] = $x;
            }
            usort($items, fn($a, $b) => strcmp($a['t'] ?? '', $b['t'] ?? ''));
            ok(['items' => $items]);
        }
        case 'proj_catalog_item': {
            learnPlanGate(requireUser(), 'projects');
            $id = preg_replace('/[^A-Za-z0-9\-_]/', '', (string) ($b['id'] ?? ($_GET['id'] ?? '')));
            $d = $id !== '' ? docGet("proj/x/items/$id") : null;
            if (!$d) {
                fail(404, 'not_found', 'Project not found.');
            }
            ok(['item' => $d]);
        }
        case 'proj_catalog_save': {
            $u = learnStaff(true);
            $x = (array) ($b['item'] ?? []);
            $id = preg_replace('/[^A-Za-z0-9\-_]/', '', (string) ($x['id'] ?? '')) ?: rid(8);
            $clean = projCleanBrief($x);
            $clean['src'] = 'catalog';
            $clean['u'] = now();
            $clean['by'] = $u['id'];
            docSet("proj/x/items/$id", json_decode(json_encode($clean)));
            ok(['id' => $id, 'item' => $clean]);
        }
        case 'proj_catalog_delete': {
            learnStaff(true);
            $id = preg_replace('/[^A-Za-z0-9\-_]/', '', (string) ($b['id'] ?? ''));
            if ($id === '' || !docGet("proj/x/items/$id")) {
                fail(404, 'not_found', 'Project not found.');
            }
            docDelete("proj/x/items/$id");
            ok(['ok' => true]);
        }
        case 'proj_save': {
            // a person's own project: the brief validated here, status and progress kept
            $u = requireUser();
            $uid = (string) ($b['uid'] ?? $u['id']);
            if ($uid !== $u['id']) {
                learnStaff(true);
            } else {
                learnPlanGate($u, 'projects');
            }
            $x = (array) ($b['item'] ?? []);
            $id = preg_replace('/[^A-Za-z0-9\-_]/', '', (string) ($x['id'] ?? '')) ?: rid(8);
            $prev = docGet("proj/$uid/items/$id");
            $clean = projCleanBrief($x);
            $clean['st'] = in_array($x['st'] ?? '', ['planned', 'active', 'done', 'paused'], true) ? $x['st'] : ($prev->st ?? 'planned');
            $doneIn = (array) ($x['done'] ?? ($prev->done ?? []));
            $done = [];
            foreach ($doneIn as $k => $v) {
                if (preg_match('/^\d{1,2}(\.\d{1,2})?$/', (string) $k) && $v) {
                    $done[(string) $k] = is_numeric($v) ? (int) $v : now();
                }
            }
            $clean['done'] = (object) $done;
            $clean['notes'] = mb_substr((string) ($x['notes'] ?? ''), 0, 4000);
            $clean['links'] = array_slice(array_values(array_filter(array_map(fn($l) => is_array($l) || $l instanceof stdClass ? ['t' => mb_substr((string) (((array) $l)['t'] ?? ''), 0, 120), 'u' => mb_substr((string) (((array) $l)['u'] ?? ''), 0, 400)] : null, (array) ($x['links'] ?? [])), fn($l) => $l && preg_match('#^https?://#', $l['u']))), 0, 10);
            $clean['vault'] = preg_replace('/[^A-Za-z0-9\-_]/', '', (string) ($x['vault'] ?? ($prev->vault ?? '')));
            $clean['catalog'] = preg_replace('/[^A-Za-z0-9\-_]/', '', (string) ($x['catalog'] ?? ($prev->catalog ?? '')));
            $clean['at'] = (int) ($prev->at ?? now());
            $clean['u'] = now();
            if ($clean['st'] === 'done' && empty($prev->finished)) {
                $clean['finished'] = now();
            } elseif (!empty($prev->finished)) {
                $clean['finished'] = (int) $prev->finished;
            }
            docSet("proj/$uid/items/$id", json_decode(json_encode($clean)));
            ok(['id' => $id, 'item' => $clean]);
        }
        case 'proj_overview': {
            learnStaff(false);
            $s = db()->query("SELECT path, data FROM docs WHERE path LIKE 'proj/u_%/items/%'");
            $rows = [];
            while ($r = $s->fetch()) {
                [, $uid, , $id] = explode('/', $r['path']);
                $d = json_decode($r['data']);
                $ms = count((array) ($d->milestones ?? []));
                $tasks = 0;
                foreach ((array) ($d->milestones ?? []) as $m) {
                    $tasks += count((array) ($m->tasks ?? []));
                }
                $done = count((array) ($d->done ?? []));
                $ur = userRow($uid);
                $rows[] = ['uid' => $uid, 'n' => (string) ($ur['name'] ?? $uid), 'id' => $id, 't' => (string) ($d->t ?? ''), 'domain' => (string) ($d->domain ?? ''), 'st' => (string) ($d->st ?? ''), 'src' => (string) ($d->src ?? ''), 'stack' => (array) ($d->stack ?? []), 'hours' => (int) ($d->hours ?? 0), 'tasks' => $tasks, 'done' => $done, 'pct' => $tasks ? (int) round(($done * 100) / $tasks) : 0, 'at' => (int) ($d->at ?? 0), 'u' => (int) ($d->u ?? 0), 'finished' => $d->finished ?? null];
            }
            usort($rows, fn($a, $b) => $b['u'] <=> $a['u']);
            ok(['rows' => $rows]);
        }
        /* ----- vault ----- */
        case 'vault_shared': {
            // recruiters and recruiting team see what a person chose to share; HR sees everything through the records
            $u = requireUser();
            $uid = preg_replace('/[^A-Za-z0-9_]/', '', (string) ($b['uid'] ?? ($_GET['uid'] ?? '')));
            if ($uid === '') {
                fail(400, 'invalid_argument', 'Which person?');
            }
            $staff = userLevel($u) >= 2 && can("pv/$uid/items", 'r');
            if (!$staff && !isRecruiter($u['id']) && !isBench($u['id']) && $uid !== $u['id']) {
                fail(403, 'invalid_argument', 'The vault is for the person, HR and recruiters.');
            }
            $items = [];
            foreach (colAll("pv/$uid/items", 'u', 'desc') as [$id, $d]) {
                if (!$staff && $uid !== $u['id'] && empty($d->share)) {
                    continue;
                }
                if (!empty($d->share) && ($d->tok ?? '') === '') {
                    // a shared entry gets a file token so recruiters can open its files (tokenAllows)
                    $d->tok = rid(16);
                    docSet("pv/$uid/items/$id", $d);
                }
                $tok = !empty($d->share) ? (string) ($d->tok ?? '') : '';
                $files = array_map(fn($f) => ['id' => (string) $f[0], 'n' => (string) ($f[1]->n ?? ''), 'sz' => (int) ($f[1]->sz ?? 0), 'ty' => (string) ($f[1]->ty ?? ''), 'at' => (int) ($f[1]->at ?? 0)], colAll("pv/$uid/items/$id/f"));
                $x = json_decode(json_encode($d), true);
                $x['id'] = (string) $id;
                $x['files'] = $files;
                $x['tok'] = $tok;
                $items[] = $x;
            }
            ok(['items' => $items]);
        }
    }
    fail(404, 'not_found', 'Unknown action.');
}
