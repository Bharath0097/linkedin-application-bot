<?php
declare(strict_types=1);
/*
  v32: StratEdge certifications and the daily and weekly tests (Admin > Certifications & tests; members: Grow >
  Certifications, Grow > Daily & weekly tests).

  - The question bank (exq/items/{id}, HR only) holds quiz items (the course quiz types) tagged with topics and a
    level. HR adds them by hand, copies the course quizzes in, or has the assistant write a batch for a topic.
  - Certifications (learn/x/certp/{id}): a named credential ("StratEdge Certified Java Developer", Associate,
    Professional or Expert) with an exam drawn from the bank by topic: number of questions, time limit, pass mark,
    attempts in 30 days, hours between attempts, prerequisite courses, who may take it, validity in months.
    Passing issues a certificate (learn/{uid}/certs/{id}, SEC-YYYY-NNNN with a verification code): PDF, public
    verification, "Add to LinkedIn profile".
  - The daily test (a few minutes) and the weekly test (longer, once a week) are drawn from the person's chosen
    topics (or the whole bank), avoiding the questions of the last days; streaks, history, weak topics, a weekly
    leaderboard when switched on.
  Attempts live at learn/{uid}/ex/{id} (written only here): the questions' ids, the deadline, the answers and the
  result. The answers never reach the browser before an attempt is submitted.
*/
require_once __DIR__ . '/learn.php';

const EX_LEVELS = ['Associate', 'Professional', 'Expert'];
const EX_WHO = ['consultant', 'employee', 'student'];

/* ---------- the bank ---------- */

function exBankAll(): array
{
    $out = [];
    foreach (colAll('exq/items') as [$id, $d]) {
        $q = json_decode((string) json_encode($d), true) ?: [];
        $q['id'] = (string) $id;
        $out[(string) $id] = $q;
    }
    return $out;
}
function exTopicNorm(string $t): string
{
    return mb_substr(trim((string) preg_replace('/\s+/', ' ', $t)), 0, 40);
}
function exTopics(array $bank): array
{
    $n = [];
    foreach ($bank as $q) {
        foreach ((array) ($q['topics'] ?? []) as $t) {
            $k = mb_strtolower($t);
            if (!isset($n[$k])) {
                $n[$k] = ['t' => $t, 'n' => 0];
            }
            $n[$k]['n']++;
        }
    }
    usort($n, fn($a, $b) => strcasecmp($a['t'], $b['t']));
    return array_values($n);
}
/** A bank item from an editor or the assistant: the quiz item checks, plus topics and a level. */
function exCleanItem(array $x, string $src = 'manual'): ?array
{
    $q = learnCleanQuizItem($x);
    if (!$q) {
        return null;
    }
    $topics = [];
    foreach ((array) ($x['topics'] ?? []) as $t) {
        $t = exTopicNorm((string) $t);
        if ($t !== '' && !in_array(mb_strtolower($t), array_map('mb_strtolower', $topics), true)) {
            $topics[] = $t;
        }
    }
    if (!$topics) {
        return null;
    }
    $q['topics'] = array_slice($topics, 0, 6);
    $q['lvl'] = max(1, min(3, (int) ($x['lvl'] ?? 2)));
    $q['src'] = $src;
    return $q;
}
/** Copies the course quizzes into the bank once per course (topic: the course's category, else its title). */
function exImportCourses(string $by): int
{
    $n = 0;
    $meta = docGet('learn/x/meta') ?? new stdClass();
    $done = (array) ($meta->bankFrom ?? []);
    foreach (learnCourses() as $c) {
        if (in_array($c['id'], $done, true)) {
            continue;
        }
        $topic = exTopicNorm((string) ($c['cat'] ?? '') ?: (string) ($c['t'] ?? 'General'));
        foreach ((array) ($c['mods'] ?? []) as $m) {
            foreach ((array) ($m['ls'] ?? []) as $l) {
                foreach ((array) ($l['quiz'] ?? []) as $q) {
                    $item = exCleanItem(((array) $q) + ['topics' => [$topic], 'lvl' => 2], 'course:' . $c['id']);
                    if ($item) {
                        $item['at'] = now();
                        $item['by'] = $by;
                        docSet('exq/items/' . rid(6), json_decode((string) json_encode($item)));
                        $n++;
                    }
                }
            }
        }
        $done[] = $c['id'];
    }
    $meta->bankFrom = $done;
    docSet('learn/x/meta', $meta);
    return $n;
}

/* ---------- programs (certifications) ---------- */

function exProgs(bool $all = false): array
{
    $out = [];
    foreach (colAll('learn/x/certp') as [$id, $d]) {
        $p = exProgOut((string) $id, json_decode((string) json_encode($d), true) ?: []);
        if ($all || $p['pub']) {
            $out[] = $p;
        }
    }
    usort($out, fn($a, $b) => [$a['ord'], $a['t']] <=> [$b['ord'], $b['t']]);
    return $out;
}
function exProgOut(string $id, array $p): array
{
    return [
        'id' => $id,
        't' => (string) ($p['t'] ?? 'Certification'),
        'code' => (string) ($p['code'] ?? ''),
        'level' => in_array($p['level'] ?? '', EX_LEVELS, true) ? $p['level'] : 'Associate',
        'd' => (string) ($p['d'] ?? ''),
        'topics' => array_values((array) ($p['topics'] ?? [])),
        'courses' => array_values((array) ($p['courses'] ?? [])),
        'n' => max(5, min(100, (int) ($p['n'] ?? 30))),
        'min' => max(5, min(240, (int) ($p['min'] ?? 45))),
        'pass' => max(40, min(100, (int) ($p['pass'] ?? 70))),
        'tries' => max(1, min(10, (int) ($p['tries'] ?? 3))),
        'cool' => max(0, min(720, (int) ($p['cool'] ?? 24))),
        'valid' => max(0, min(120, (int) ($p['valid'] ?? 24))),
        'who' => array_values(array_intersect(EX_WHO, (array) ($p['who'] ?? EX_WHO))),
        'pub' => !empty($p['pub']),
        'ord' => (int) ($p['ord'] ?? 50),
    ];
}
function exProg(string $id): ?array
{
    if (!preg_match('/^[A-Za-z0-9_\-]{1,40}$/', $id)) {
        return null;
    }
    $d = docGet("learn/x/certp/$id");
    return $d ? exProgOut($id, json_decode((string) json_encode($d), true) ?: []) : null;
}
/** Who a person is for certifications: consultant, student or employee (everyone else on the team). */
function exWho(string $uid): string
{
    $r = myR($uid);
    $role = (string) ($r->role ?? '');
    if ($role === '') {
        $u = docGet("u/$uid");
        $role = (string) ($u->p->role ?? 'employee');
    }
    return in_array($role, ['consultant', 'student'], true) ? $role : 'employee';
}
/** The bank items of these topics (all of the bank when no topics are given). */
function exPool(array $bank, array $topics): array
{
    if (!$topics) {
        return $bank;
    }
    $want = array_map('mb_strtolower', $topics);
    return array_filter($bank, fn($q) => (bool) array_intersect($want, array_map('mb_strtolower', (array) ($q['topics'] ?? []))));
}
/** n questions from a pool, a deterministic mix for a seed, preferring ones not seen recently and the wanted level. */
function exPick(array $pool, int $n, string $seed, array $avoid = [], int $lvl = 0): array
{
    $ids = array_keys($pool);
    usort($ids, fn($a, $b) => strcmp(md5($seed . $a), md5($seed . $b)));
    $avoid = array_flip($avoid);
    $rank = function ($id) use ($pool, $avoid, $lvl) {
        $r = isset($avoid[$id]) ? 2 : 0;
        if ($lvl && (int) ($pool[$id]['lvl'] ?? 2) < $lvl) {
            $r += 1;
        }
        return $r;
    };
    $order = array_flip($ids);
    usort($ids, fn($a, $b) => [$rank($a), $order[$a]] <=> [$rank($b), $order[$b]]);
    return array_slice($ids, 0, $n);
}
function exTestsCfg(): array
{
    $d = docGet('learn/x/tests');
    $a = $d ? (json_decode((string) json_encode($d), true) ?: []) : [];
    return [
        'daily' => ['on' => !isset($a['daily']['on']) || !empty($a['daily']['on']), 'n' => max(3, min(30, (int) ($a['daily']['n'] ?? 10))), 'min' => max(2, min(60, (int) ($a['daily']['min'] ?? 10)))],
        'weekly' => ['on' => !isset($a['weekly']['on']) || !empty($a['weekly']['on']), 'n' => max(5, min(80, (int) ($a['weekly']['n'] ?? 25))), 'min' => max(5, min(180, (int) ($a['weekly']['min'] ?? 30)))],
        'board' => !isset($a['board']) || !empty($a['board']),
    ];
}
function exState(string $uid): array
{
    $d = docGet("learn/$uid/tests");
    $a = $d ? (json_decode((string) json_encode($d), true) ?: []) : [];
    return ['topics' => array_values((array) ($a['topics'] ?? [])), 'streak' => (int) ($a['streak'] ?? 0), 'best' => (int) ($a['best'] ?? 0), 'last' => (string) ($a['last'] ?? ''), 'days' => (array) ($a['days'] ?? []), 'weeks' => (array) ($a['weeks'] ?? []), 'recent' => array_values((array) ($a['recent'] ?? [])), 'wt' => (array) ($a['wt'] ?? [])];
}
function exStateSave(string $uid, array $s): void
{
    $s['u'] = now();
    docSet("learn/$uid/tests", json_decode((string) json_encode($s)));
}
function exToday(): string
{
    return (new DateTimeImmutable('now', new DateTimeZone((string) (cfg('timezone') ?: 'America/New_York'))))->format('Y-m-d');
}
function exWeek(): string
{
    return (new DateTimeImmutable('now', new DateTimeZone((string) (cfg('timezone') ?: 'America/New_York'))))->format('o-\WW');
}
/** The attempt as the browser sees it: questions without answers while it runs, the result once it is done. */
function exAttemptOut(string $aid, array $a, array $bank): array
{
    $qs = [];
    foreach ((array) $a['qids'] as $i => $qid) {
        if (isset($bank[$qid])) {
            $qs[] = learnPublicItem($bank[$qid], (int) $i) + ['topics' => (array) ($bank[$qid]['topics'] ?? [])];
        }
    }
    $out = ['id' => $aid, 'kind' => $a['kind'], 'ref' => $a['ref'], 't' => (string) ($a['t'] ?? ''), 'start' => (int) $a['start'], 'dl' => (int) $a['dl'], 'now' => now(), 'done' => (int) ($a['done'] ?? 0), 'qs' => $qs];
    if (!empty($a['done'])) {
        foreach (['pct', 'ok', 'n', 'res', 'passed', 'cert', 'topics', 'pass', 'late'] as $k) {
            if (array_key_exists($k, $a)) {
                $out[$k] = $a[$k];
            }
        }
        $out['ans'] = $a['ans'] ?? [];
    }
    return $out;
}
function exAttempts(string $uid): array
{
    $out = [];
    foreach (colAll("learn/$uid/ex") as [$id, $d]) {
        $out[(string) $id] = json_decode((string) json_encode($d), true) ?: [];
    }
    uasort($out, fn($x, $y) => (int) ($y['start'] ?? 0) <=> (int) ($x['start'] ?? 0));
    return $out;
}
/** Where a person stands with one certification: eligible, attempts left, wait, the certificate they hold. */
function exProgStatus(string $uid, array $p, array $attempts, array $certs): array
{
    $who = exWho($uid);
    $since = now() - 30 * 86400000;
    $tries = array_filter($attempts, fn($a) => ($a['kind'] ?? '') === 'cert' && ($a['ref'] ?? '') === $p['id']);
    $recent = array_filter($tries, fn($a) => (int) ($a['start'] ?? 0) >= $since);
    $last = $tries ? max(array_map(fn($a) => (int) ($a['start'] ?? 0), $tries)) : 0;
    $openId = '';
    foreach ($tries as $id => $a) {
        if (empty($a['done']) && (int) ($a['dl'] ?? 0) + 30000 > now()) {
            $openId = (string) $id;
        }
    }
    $held = null;
    foreach ($certs as $c) {
        if (($c['prog'] ?? '') === $p['id'] && (!$held || (int) $c['at'] > (int) $held['at'])) {
            $held = $c;
        }
    }
    $missing = [];
    foreach ($p['courses'] as $cid) {
        $pr = docGet("learn/$uid/p/$cid");
        if (!$pr || empty($pr->completedAt)) {
            $c = learnCourse($cid);
            $missing[] = ['id' => $cid, 't' => (string) ($c['t'] ?? $cid)];
        }
    }
    $wait = $last && $p['cool'] ? max(0, $last + $p['cool'] * 3600000 - now()) : 0;
    $best = 0;
    foreach ($tries as $a) {
        $best = max($best, (int) ($a['pct'] ?? 0));
    }
    $why = !in_array($who, $p['who'], true) ? 'This certification is not open to your account type.' : ($missing ? 'Finish the required courses first.' : (count($recent) >= $p['tries'] && $openId === '' ? 'You have used the ' . $p['tries'] . ' attempts allowed in 30 days.' : ($wait > 0 && $openId === '' ? 'You can try again in ' . (int) ceil($wait / 3600000) . ' hour' . ((int) ceil($wait / 3600000) === 1 ? '' : 's') . '.' : '')));
    $heldOk = $held && (empty($held['exp']) || (int) $held['exp'] > now());
    return [
        'can' => $why === '' && !$heldOk,
        'why' => $heldOk ? 'You hold this certification.' : $why,
        'missing' => $missing,
        'tries' => count($recent),
        'left' => max(0, $p['tries'] - count($recent)),
        'best' => $best,
        'open' => $openId,
        'held' => $held,
        'heldOk' => $heldOk,
    ];
}
function exCerts(string $uid): array
{
    return array_map(fn($x) => ['id' => (string) $x[0]] + (json_decode((string) json_encode($x[1]), true) ?: []), colAll("learn/$uid/certs"));
}
/** A certificate for a passed exam (number SEC-YYYY-NNNN, its own counter). */
function exIssue(string $uid, array $p, int $pct): array
{
    $meta = docGet('learn/x/meta') ?? new stdClass();
    $meta->pcerts = (int) ($meta->pcerts ?? 0) + 1;
    docSet('learn/x/meta', $meta);
    $no = 'SEC-' . date('Y') . '-' . str_pad((string) $meta->pcerts, 4, '0', STR_PAD_LEFT);
    $id = rid(8);
    $ur = userRow($uid);
    $exp = $p['valid'] ? (new DateTimeImmutable())->modify('+' . $p['valid'] . ' months')->getTimestamp() * 1000 : 0;
    $cert = ['kind' => 'prog', 'prog' => $p['id'], 't' => $p['t'], 'level' => $p['level'], 'n' => (string) ($ur['name'] ?? ''), 'at' => now(), 'no' => $no, 'code' => rid(6), 'avg' => $pct, 'exp' => $exp, 'skills' => $p['topics']];
    docSet("learn/$uid/certs/$id", json_decode((string) json_encode($cert)));
    return ['id' => $id] + $cert;
}
/** The assistant writes n questions for a topic (when it is set up). */
function exAiWrite(string $topic, int $n, int $lvl): array
{
    $lv = [1 => 'basic (definitions, recall)', 2 => 'intermediate (applying the concept to a work situation)', 3 => 'advanced (debugging, design trade-offs, edge cases)'][$lvl] ?? 'intermediate';
    $j = learnAiJson(
        'You write exam questions for an IT staffing company\'s certification program. Answer with one JSON object only.',
        "Write $n different questions on \"$topic\", level: $lv. Mix types: mostly \"mc\" (4 options, exactly one right, plausible distractors), some \"multi\" (4-5 options, 2-3 right), a few \"tf\" and \"fill\" (one word or short phrase answers). Questions must be unambiguous and factually correct as of 2026; no trick questions; no \"all of the above\". Give a one-sentence explanation in \"why\".\nJSON: {\"items\": [{\"ty\": \"mc|multi|tf|fill\", \"q\": \"question\", \"o\": [\"options for mc/multi\"], \"a\": answer (index for mc, array of indexes for multi, true/false for tf, array of accepted strings for fill), \"why\": \"explanation\"}]}",
        4000,
        'quiz'
    );
    $out = [];
    foreach ((array) ($j['items'] ?? []) as $x) {
        $it = exCleanItem(((array) $x) + ['topics' => [$topic], 'lvl' => $lvl], 'ai');
        if ($it) {
            $out[] = $it;
        }
    }
    return $out;
}

/* ---------- routes ---------- */

function exStaff(bool $write = false): array
{
    $u = requireUser();
    if (userLevel($u) < 2 && !in_array('hr', accessOf($u)['portals'] ?? [], true) && empty(grantsOf($u['id'])['hr'])) {
        fail(403, 'forbidden', 'Certifications and tests are run by HR and administrators.');
    }
    return $u;
}
/** Students and outside consultants need the feature in their plan (staff, employees and StratEdge's consultants do not). */
function exGate(array $u, string $feature): void
{
    require_once __DIR__ . '/billing.php';
    billGate($u, $feature);
}
function exRoute(string $r, array $b): never
{
    switch ($r) {
        /* ----- learner ----- */
        case 'ex_home': {
            // the tests page and the certifications page in one call
            $u = requireUser();
            $uid = $u['id'];
            $bank = exBankAll();
            $cfg = exTestsCfg();
            $st = exState($uid);
            $att = exAttempts($uid);
            $today = exToday();
            $week = exWeek();
            $find = function (string $kind, string $ref) use ($att) {
                foreach ($att as $id => $a) {
                    if (($a['kind'] ?? '') === $kind && ($a['ref'] ?? '') === $ref) {
                        return ['id' => $id, 'done' => (int) ($a['done'] ?? 0), 'pct' => $a['pct'] ?? null, 'dl' => (int) ($a['dl'] ?? 0), 'n' => count((array) ($a['qids'] ?? []))];
                    }
                }
                return null;
            };
            // streak: consecutive days with a daily test up to today (or yesterday when today's is not done yet)
            $streak = 0;
            $d = new DateTimeImmutable($today);
            if (!isset($st['days'][$today])) {
                $d = $d->modify('-1 day');
            }
            while (isset($st['days'][$d->format('Y-m-d')])) {
                $streak++;
                $d = $d->modify('-1 day');
            }
            $certs = exCerts($uid);
            $progs = [];
            foreach (exProgs() as $p) {
                $progs[] = $p + ['me' => exProgStatus($uid, $p, $att, $certs), 'pool' => count(exPool($bank, $p['topics']))];
            }
            $board = [];
            if ($cfg['board']) {
                // everyone's tests record is learn/{uid}/tests: read them straight from the table
                $s = db()->prepare("SELECT path, data FROM docs WHERE path LIKE 'learn/u_%/tests'");
                $s->execute();
                while ($row = $s->fetch()) {
                    $x = json_decode($row['data'], true);
                    $pct = $x['weeks'][$week] ?? null;
                    if ($pct === null) {
                        continue;
                    }
                    $pid = explode('/', $row['path'])[1];
                    $ur = userRow($pid);
                    $parts = preg_split('/\s+/', trim((string) ($ur['name'] ?? ''))) ?: [''];
                    $board[] = ['n' => $parts[0] . (isset($parts[1]) ? ' ' . mb_substr($parts[1], 0, 1) . '.' : ''), 'pct' => (int) $pct, 'me' => $pid === $uid];
                }
                usort($board, fn($a, $b) => $b['pct'] <=> $a['pct']);
                $board = array_slice($board, 0, 10);
            }
            $weak = [];
            foreach ($st['wt'] as $t => $v) {
                if (($v[1] ?? 0) >= 3) {
                    $weak[] = ['t' => $t, 'pct' => (int) round(100 * ($v[0] ?? 0) / max(1, $v[1]))];
                }
            }
            usort($weak, fn($a, $b) => $a['pct'] <=> $b['pct']);
            require_once __DIR__ . '/billing.php';
            ok([
                'cfg' => $cfg,
                'topics' => exTopics($bank),
                'mine' => $st['topics'],
                'pool' => count(exPool($bank, $st['topics'])),
                'daily' => $find('daily', $today),
                'weekly' => $find('weekly', $week),
                'today' => $today,
                'week' => $week,
                'streak' => $streak,
                'best' => max($st['best'], $streak),
                'days' => array_slice($st['days'], -30, null, true),
                'weeks' => array_slice($st['weeks'], -12, null, true),
                'weak' => array_slice($weak, 0, 5),
                'board' => $board,
                'progs' => $progs,
                'certs' => $certs,
                'can' => ['tests' => billCan($uid, 'tests'), 'cert' => billCan($uid, 'cert')],
                'org' => (string) (cfg('site_name') ?: 'StratEdge IT Consulting'),
            ]);
        }
        case 'ex_topics_save': {
            $u = requireUser();
            $st = exState($u['id']);
            $st['topics'] = array_slice(array_values(array_filter(array_map(fn($t) => exTopicNorm((string) $t), (array) ($b['topics'] ?? [])))), 0, 20);
            exStateSave($u['id'], $st);
            ok(['ok' => true, 'pool' => count(exPool(exBankAll(), $st['topics']))]);
        }
        case 'ex_start': {
            // a daily or weekly test, or a certification exam: the questions are chosen and the clock starts
            $u = requireUser();
            $uid = $u['id'];
            $kind = (string) ($b['kind'] ?? '');
            $bank = exBankAll();
            $att = exAttempts($uid);
            if ($kind === 'daily' || $kind === 'weekly') {
                exGate($u, 'tests');
                $cfg = exTestsCfg()[$kind];
                if (!$cfg['on']) {
                    fail(400, 'invalid_argument', 'The ' . $kind . ' test is switched off.');
                }
                $ref = $kind === 'daily' ? exToday() : exWeek();
                foreach ($att as $id => $a) {
                    if (($a['kind'] ?? '') === $kind && ($a['ref'] ?? '') === $ref) {
                        ok(['attempt' => exAttemptOut($id, $a, $bank)]);
                    }
                }
                $st = exState($uid);
                $pool = exPool($bank, $st['topics']);
                if (count($pool) < 3) {
                    $pool = $bank;
                }
                if (count($pool) < 3) {
                    fail(400, 'invalid_argument', 'There are not enough questions yet. HR adds them under Certifications & tests.');
                }
                $qids = exPick($pool, $cfg['n'], $uid . $ref, $st['recent']);
                $t = $kind === 'daily' ? 'Daily test · ' . date('M j', (int) strtotime($ref)) : 'Weekly test · week ' . (int) substr($ref, -2);
                $min = $cfg['min'];
                $prog = null;
            } elseif ($kind === 'cert') {
                exGate($u, 'cert');
                $prog = exProg((string) ($b['prog'] ?? ''));
                if (!$prog || !$prog['pub']) {
                    fail(404, 'not_found', 'That certification is not available.');
                }
                $ms = exProgStatus($uid, $prog, $att, exCerts($uid));
                if ($ms['open'] !== '') {
                    ok(['attempt' => exAttemptOut($ms['open'], $att[$ms['open']], $bank)]);
                }
                if (!$ms['can']) {
                    fail(400, 'invalid_argument', $ms['why']);
                }
                $pool = exPool($bank, $prog['topics']);
                if (count($pool) < min(5, $prog['n'])) {
                    fail(400, 'invalid_argument', 'This exam does not have enough questions yet. HR adds them under Certifications & tests.');
                }
                $lvl = ['Associate' => 1, 'Professional' => 2, 'Expert' => 3][$prog['level']] ?? 0;
                $qids = exPick($pool, $prog['n'], $uid . $prog['id'] . now(), [], $lvl);
                $ref = $prog['id'];
                $t = $prog['t'];
                $min = $prog['min'];
            } else {
                fail(400, 'invalid_argument', 'Unknown test.');
            }
            $aid = rid(8);
            $a = ['kind' => $kind, 'ref' => $ref, 't' => $t, 'qids' => array_values($qids), 'start' => now(), 'dl' => now() + $min * 60000];
            docSet("learn/$uid/ex/$aid", json_decode((string) json_encode($a)));
            ok(['attempt' => exAttemptOut($aid, $a, $bank)]);
        }
        case 'ex_attempt': {
            $u = requireUser();
            $uid = $u['id'];
            $aid = preg_replace('/[^a-f0-9]/', '', (string) ($b['id'] ?? ''));
            $d = $aid !== '' ? docGet("learn/$uid/ex/$aid") : null;
            if (!$d) {
                fail(404, 'not_found', 'That test is not there.');
            }
            ok(['attempt' => exAttemptOut($aid, json_decode((string) json_encode($d), true) ?: [], exBankAll())]);
        }
        case 'ex_submit': {
            $u = requireUser();
            $uid = $u['id'];
            $aid = preg_replace('/[^a-f0-9]/', '', (string) ($b['id'] ?? ''));
            $d = $aid !== '' ? docGet("learn/$uid/ex/$aid") : null;
            if (!$d) {
                fail(404, 'not_found', 'That test is not there.');
            }
            $a = json_decode((string) json_encode($d), true) ?: [];
            $bank = exBankAll();
            if (!empty($a['done'])) {
                ok(['attempt' => exAttemptOut($aid, $a, $bank)]);
            }
            // answers after the time is up (plus a short allowance for the network) are not counted
            $late = now() > (int) $a['dl'] + 45000;
            $answers = $late ? [] : (array) ($b['answers'] ?? []);
            $items = [];
            foreach ((array) $a['qids'] as $qid) {
                $items[] = $bank[$qid] ?? ['ty' => 'tf', 'q' => '(removed question)', 'a' => true];
            }
            $g = learnGrade($items, $answers);
            $topics = [];
            foreach ($g['items'] as $i => $x) {
                foreach ((array) ($items[$i]['topics'] ?? []) as $t) {
                    $topics[$t] = [($topics[$t][0] ?? 0) + ($x['ok'] ? 1 : 0), ($topics[$t][1] ?? 0) + 1];
                }
            }
            $a['done'] = now();
            $a['late'] = $late;
            $a['ans'] = $answers;
            $a['pct'] = $g['pct'];
            $a['ok'] = $g['ok'];
            $a['n'] = $g['n'];
            $a['res'] = $g['items'];
            $a['topics'] = $topics;
            $a['tabs'] = max(0, min(999, (int) ($b['tabs'] ?? 0)));
            if ($a['kind'] === 'cert') {
                $prog = exProg((string) $a['ref']);
                $a['pass'] = $prog ? $prog['pass'] : 70;
                $a['passed'] = $prog && $g['pct'] >= $prog['pass'];
                if ($a['passed']) {
                    $c = exIssue($uid, $prog, $g['pct']);
                    $a['cert'] = $c['id'];
                }
            } else {
                $st = exState($uid);
                if ($a['kind'] === 'daily') {
                    $st['days'][$a['ref']] = $g['pct'];
                    ksort($st['days']);
                    $st['days'] = array_slice($st['days'], -120, null, true);
                    // streak
                    $s = 0;
                    $day = new DateTimeImmutable((string) $a['ref']);
                    while (isset($st['days'][$day->format('Y-m-d')])) {
                        $s++;
                        $day = $day->modify('-1 day');
                    }
                    $st['streak'] = $s;
                    $st['best'] = max($st['best'], $s);
                    $st['last'] = (string) $a['ref'];
                } else {
                    $st['weeks'][$a['ref']] = $g['pct'];
                    ksort($st['weeks']);
                    $st['weeks'] = array_slice($st['weeks'], -52, null, true);
                }
                foreach ($topics as $t => $v) {
                    $st['wt'][$t] = [($st['wt'][$t][0] ?? 0) + $v[0], ($st['wt'][$t][1] ?? 0) + $v[1]];
                }
                $st['recent'] = array_slice(array_merge($st['recent'], (array) $a['qids']), -150);
                exStateSave($uid, $st);
            }
            docSet("learn/$uid/ex/$aid", json_decode((string) json_encode($a)));
            ok(['attempt' => exAttemptOut($aid, $a, $bank)]);
        }

        /* ----- staff ----- */
        case 'ex_admin': {
            exStaff();
            $bank = exBankAll();
            $meta = docGet('learn/x/meta');
            if (!$bank && empty($meta->bankFrom)) {
                // the first visit fills the bank from the course quizzes so the tests work at once
                exImportCourses('system');
                $bank = exBankAll();
            }
            $items = array_values(array_map(fn($q) => $q, $bank));
            usort($items, fn($a, $b) => (int) ($b['at'] ?? 0) <=> (int) ($a['at'] ?? 0));
            ok(['bank' => $items, 'topics' => exTopics($bank), 'progs' => exProgs(true), 'cfg' => exTestsCfg(), 'courses' => array_map(fn($c) => ['id' => $c['id'], 't' => $c['t']], learnCourses()), 'ai' => aiReady('quiz'), 'levels' => EX_LEVELS]);
        }
        case 'ex_bank_save': {
            $u = exStaff(true);
            $x = (array) ($b['item'] ?? []);
            $id = preg_match('/^[A-Za-z0-9]{1,20}$/', (string) ($x['id'] ?? '')) ? (string) $x['id'] : rid(6);
            $cur = docGet("exq/items/$id");
            $item = exCleanItem($x, (string) ($cur->src ?? 'manual'));
            if (!$item) {
                fail(400, 'invalid_argument', 'The question needs its text, a topic and a valid answer (enough options for multiple choice).');
            }
            $item['at'] = (int) ($cur->at ?? now());
            $item['by'] = (string) ($cur->by ?? $u['id']);
            $item['u'] = now();
            docSet("exq/items/$id", json_decode((string) json_encode($item)));
            ok(['item' => ['id' => $id] + $item]);
        }
        case 'ex_bank_delete': {
            exStaff(true);
            $n = 0;
            foreach (array_slice((array) ($b['ids'] ?? []), 0, 500) as $id) {
                if (is_string($id) && preg_match('/^[A-Za-z0-9]{1,20}$/', $id)) {
                    docDelete("exq/items/$id");
                    $n++;
                }
            }
            ok(['deleted' => $n]);
        }
        case 'ex_bank_import': {
            $u = exStaff(true);
            $meta = docGet('learn/x/meta') ?? new stdClass();
            if (!empty($b['again'])) {
                $meta->bankFrom = [];
                docSet('learn/x/meta', $meta);
            }
            ok(['added' => exImportCourses($u['id'])]);
        }
        case 'ex_bank_ai': {
            $u = exStaff(true);
            if (!aiReady('quiz')) {
                fail(400, 'invalid_argument', 'The assistant is not set up (Admin > Website & messages > Assistant (AI)).');
            }
            if (throttleHit('exai:' . $u['id'], 30, 3600)) {
                fail(429, 'rate_limited', 'That is a lot of questions for one hour. Try again later.');
            }
            session_write_close();
            @set_time_limit(120);
            $topic = exTopicNorm((string) ($b['topic'] ?? ''));
            if ($topic === '') {
                fail(400, 'invalid_argument', 'Name the topic.');
            }
            $items = exAiWrite($topic, max(3, min(15, (int) ($b['n'] ?? 8))), max(1, min(3, (int) ($b['lvl'] ?? 2))));
            if (!$items) {
                fail(502, 'unavailable', 'The assistant did not return usable questions. Try again, or a narrower topic.');
            }
            $saved = [];
            foreach ($items as $it) {
                $id = rid(6);
                $it['at'] = now();
                $it['by'] = $u['id'];
                docSet("exq/items/$id", json_decode((string) json_encode($it)));
                $saved[] = ['id' => $id] + $it;
            }
            ok(['items' => $saved]);
        }
        case 'ex_prog_save': {
            $u = exStaff(true);
            $x = (array) ($b['prog'] ?? []);
            $t = mb_substr(trim((string) ($x['t'] ?? '')), 0, 120);
            if ($t === '') {
                fail(400, 'invalid_argument', 'Name the certification.');
            }
            $id = preg_match('/^[A-Za-z0-9_\-]{1,40}$/', (string) ($x['id'] ?? '')) ? (string) $x['id'] : (trim((string) preg_replace('/[^a-z0-9]+/', '-', strtolower($t)), '-') ?: rid(4));
            if (empty($x['id']) && docGet("learn/x/certp/$id")) {
                $id .= '-' . rid(2);
            }
            $topics = array_values(array_filter(array_map(fn($s) => exTopicNorm((string) $s), (array) ($x['topics'] ?? []))));
            if (!$topics) {
                fail(400, 'invalid_argument', 'Pick at least one topic: the exam\'s questions come from the bank by topic.');
            }
            $doc = exProgOut($id, $x);
            unset($doc['id']);
            $doc['t'] = $t;
            $doc['code'] = mb_substr(strtoupper(trim((string) ($x['code'] ?? ''))), 0, 12);
            $doc['d'] = mb_substr(trim((string) ($x['d'] ?? '')), 0, 1500);
            $doc['topics'] = array_slice($topics, 0, 12);
            $doc['courses'] = array_values(array_filter((array) ($x['courses'] ?? []), fn($c) => is_string($c) && learnCourse($c)));
            $doc['u'] = now();
            $doc['by'] = $u['id'];
            docSet("learn/x/certp/$id", json_decode((string) json_encode($doc)));
            ok(['prog' => exProg($id)]);
        }
        case 'ex_prog_delete': {
            exStaff(true);
            $id = (string) ($b['id'] ?? '');
            if (preg_match('/^[A-Za-z0-9_\-]{1,40}$/', $id)) {
                docDelete("learn/x/certp/$id");
            }
            ok(['ok' => true]);
        }
        case 'ex_cfg_save': {
            $u = exStaff(true);
            $x = (array) ($b['cfg'] ?? []);
            $doc = [
                'daily' => ['on' => !empty($x['daily']['on']), 'n' => max(3, min(30, (int) ($x['daily']['n'] ?? 10))), 'min' => max(2, min(60, (int) ($x['daily']['min'] ?? 10)))],
                'weekly' => ['on' => !empty($x['weekly']['on']), 'n' => max(5, min(80, (int) ($x['weekly']['n'] ?? 25))), 'min' => max(5, min(180, (int) ($x['weekly']['min'] ?? 30)))],
                'board' => !empty($x['board']),
                'u' => now(),
                'by' => $u['id'],
            ];
            docSet('learn/x/tests', json_decode((string) json_encode($doc)));
            ok(['cfg' => exTestsCfg()]);
        }
        case 'ex_results': {
            // participation and scores per person, weak topics, certification attempts
            exStaff();
            $rows = [];
            $topicAgg = [];
            $s = db()->prepare("SELECT path, data FROM docs WHERE path LIKE 'learn/u_%/tests'");
            $s->execute();
            $since = (new DateTimeImmutable(exToday()))->modify('-29 days')->format('Y-m-d');
            while ($row = $s->fetch()) {
                $x = json_decode($row['data'], true) ?: [];
                $pid = explode('/', $row['path'])[1];
                $ur = userRow($pid);
                if (!$ur) {
                    continue;
                }
                $days = array_filter((array) ($x['days'] ?? []), fn($k) => $k >= $since, ARRAY_FILTER_USE_KEY);
                $weeks = (array) ($x['weeks'] ?? []);
                foreach ((array) ($x['wt'] ?? []) as $t => $v) {
                    $topicAgg[$t] = [($topicAgg[$t][0] ?? 0) + ($v[0] ?? 0), ($topicAgg[$t][1] ?? 0) + ($v[1] ?? 0)];
                }
                $rows[$pid] = ['id' => $pid, 'n' => (string) $ur['name'], 'e' => (string) $ur['email'], 'days' => count($days), 'avg' => $days ? (int) round(array_sum($days) / count($days)) : null, 'weekly' => array_slice($weeks, -4, null, true), 'streak' => (int) ($x['streak'] ?? 0), 'certs' => [], 'tries' => 0];
            }
            $s = db()->prepare("SELECT path, data FROM docs WHERE path LIKE 'learn/u_%/ex/%'");
            $s->execute();
            $tries = [];
            while ($row = $s->fetch()) {
                $x = json_decode($row['data'], true) ?: [];
                if (($x['kind'] ?? '') !== 'cert') {
                    continue;
                }
                $pid = explode('/', $row['path'])[1];
                $ur = userRow($pid);
                $tries[] = ['uid' => $pid, 'n' => (string) ($ur['name'] ?? ''), 't' => (string) ($x['t'] ?? ''), 'at' => (int) ($x['start'] ?? 0), 'done' => (int) ($x['done'] ?? 0), 'pct' => $x['pct'] ?? null, 'passed' => !empty($x['passed']), 'tabs' => (int) ($x['tabs'] ?? 0), 'late' => !empty($x['late'])];
                if (!isset($rows[$pid]) && $ur) {
                    $rows[$pid] = ['id' => $pid, 'n' => (string) $ur['name'], 'e' => (string) $ur['email'], 'days' => 0, 'avg' => null, 'weekly' => [], 'streak' => 0, 'certs' => [], 'tries' => 0];
                }
                if (isset($rows[$pid])) {
                    $rows[$pid]['tries']++;
                    if (!empty($x['passed'])) {
                        $rows[$pid]['certs'][] = (string) ($x['t'] ?? '');
                    }
                }
            }
            usort($tries, fn($a, $b) => $b['at'] <=> $a['at']);
            $topics = [];
            foreach ($topicAgg as $t => $v) {
                if (($v[1] ?? 0) > 0) {
                    $topics[] = ['t' => $t, 'n' => $v[1], 'pct' => (int) round(100 * $v[0] / $v[1])];
                }
            }
            usort($topics, fn($a, $b) => $a['pct'] <=> $b['pct']);
            $rows = array_values($rows);
            usort($rows, fn($a, $b) => [$b['days'], $b['tries']] <=> [$a['days'], $a['tries']]);
            ok(['people' => $rows, 'topics' => $topics, 'tries' => array_slice($tries, 0, 200)]);
        }
    }
    fail(404, 'not_found', 'Unknown action.');
}
