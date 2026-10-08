<?php
declare(strict_types=1);
/*
 * v44 Goals & reviews. Goals with measurable key results, check-ins (progress, on track / at risk / off track, a
 * note), comments, and alignment to team and company goals; review cycles with a self review, the manager's review,
 * sharing it with the person and their acknowledgement, and a summary for HR (completion and how ratings spread).
 * Documents: pfg/<id> goals, pfc/<id> review cycles, pfr/<cycle>_<uid> reviews.
 * Who sees a personal goal: its owner, the people above them (r/<uid>.mgrId, up the chain), HR and administrators;
 * team and company goals, and goals their owner shares with everyone, are seen by everyone in the company (client
 * contacts, students and outside consultants are not part of it).
 */

const PF_HEALTH = ['on' => 'On track', 'risk' => 'At risk', 'off' => 'Off track'];
const PF_KIND = ['mine' => 'Personal', 'team' => 'Team', 'company' => 'Company'];
const PF_GST = ['active' => 'Active', 'done' => 'Achieved', 'dropped' => 'Dropped'];
const PF_RST = ['self' => 'Self review', 'mgr' => 'Manager review', 'shared' => 'Shared with the person', 'ack' => 'Acknowledged'];
const PF_SCALE = ['1' => 'Below expectations', '2' => 'Partly meets', '3' => 'Meets expectations', '4' => 'Exceeds', '5' => 'Outstanding'];
const PF_QS = [
    ['id' => 'q1', 'q' => 'What went well this period? Name the results you are proudest of.'],
    ['id' => 'q2', 'q' => 'What was hard, or could have gone better?'],
    ['id' => 'q3', 'q' => 'What should the focus be next period, and what support would help?'],
];

function pfIsHR(array $u): bool
{
    return hasRole($u, 'admin') || hasRole($u, 'hr');
}
/** Part of the company: staff, managers, employees, recruiting team and consultants paid through it. */
function pfIn(array $row): bool
{
    if ((string) ($row['status'] ?? 'active') !== 'active') {
        return false;
    }
    if (array_intersect(rolesOf($row), ['admin', 'hr', 'acct', 'manager'])) {
        return true;
    }
    $p = portalOf((string) $row['id']);
    if (!in_array($p, ['employee', 'consultant', 'bench'], true)) {
        return false;
    }
    if ($p === 'consultant') {
        require_once __DIR__ . '/rules.php';
        return ruleCtOf((string) $row['id']) !== 'outside';
    }
    return true;
}
function pfMgrOf(string $uid): string
{
    $r = myR($uid);
    return $r && is_string($r->mgrId ?? null) ? (string) $r->mgrId : '';
}
/** This person is above $uid (their manager, or their manager's manager, ...). */
function pfAbove(array $u, string $uid): bool
{
    $seen = [];
    $x = $uid;
    for ($i = 0; $i < 8 && $x !== '' && !isset($seen[$x]); $i++) {
        $seen[$x] = true;
        $x = pfMgrOf($x);
        if ($x === $u['id']) {
            return true;
        }
    }
    return false;
}
/** Everyone in the company, by id: [id => ['id', 'n', 'e', 'mgr']]. */
function pfPeople(): array
{
    static $out = null;
    if ($out !== null) {
        return $out;
    }
    $out = [];
    foreach (db()->query("SELECT * FROM users WHERE status = 'active' ORDER BY name LIMIT 2000")->fetchAll() as $r) {
        if (pfIn($r)) {
            $out[(string) $r['id']] = ['id' => (string) $r['id'], 'n' => (string) $r['name'], 'e' => (string) $r['email'], 'mgr' => pfMgrOf((string) $r['id'])];
        }
    }
    return $out;
}
/** The people below this person (direct and further down), by id. */
function pfBelow(array $u): array
{
    $out = [];
    foreach (pfPeople() as $id => $p) {
        if ($id !== $u['id'] && pfAbove($u, $id)) {
            $out[$id] = $p;
        }
    }
    return $out;
}
function pfName(string $uid): string
{
    if ($uid === '') {
        return '';
    }
    $p = pfPeople()[$uid] ?? null;
    if ($p) {
        return $p['n'];
    }
    $r = userRow($uid);
    return $r ? (string) $r['name'] : 'Someone';
}

/* ---------------------------------------------------------------- goals */

function pfShared(stdClass $g): bool
{
    return in_array((string) $g->kind, ['team', 'company'], true) || (string) ($g->vis ?? '') === 'all';
}
function pfMaySee(array $u, stdClass $g): bool
{
    if (pfIsHR($u) || (string) $g->owner === $u['id']) {
        return true;
    }
    if (pfShared($g)) {
        return pfIn($u + ['status' => 'active']);
    }
    return pfAbove($u, (string) $g->owner);
}
function pfMayEdit(array $u, stdClass $g): bool
{
    if (pfIsHR($u)) {
        return true;
    }
    if ((string) $g->kind === 'company') {
        return false;
    }
    return (string) $g->owner === $u['id'] || pfAbove($u, (string) $g->owner);
}
function pfGoal(string $id, array $u): stdClass
{
    $id = preg_replace('/[^a-z0-9]/', '', $id);
    $g = $id !== '' ? docGet('pfg/' . $id) : null;
    if (!$g || !pfMaySee($u, $g)) {
        fail(404, 'not_found', 'No such goal.');
    }
    $g->id = $id;
    return $g;
}
/** A key result's progress, 0..1. */
function pfKrProg(array $k): float
{
    if (($k['t'] ?? '') === 'done') {
        return !empty($k['cur']) ? 1.0 : 0.0;
    }
    $from = (float) ($k['from'] ?? 0);
    $to = (float) ($k['to'] ?? 0);
    $cur = (float) ($k['cur'] ?? $from);
    if ($to == $from) {
        return ($to >= $from ? $cur >= $to : $cur <= $to) ? 1.0 : 0.0;
    }
    return max(0.0, min(1.0, ($cur - $from) / ($to - $from)));
}
/** The goal's progress in percent: the average of its key results, or the figure given by hand when it has none. */
function pfProg(stdClass $g): int
{
    $krs = json_decode((string) json_encode($g->krs ?? []), true) ?: [];
    if (!$krs) {
        return max(0, min(100, (int) ($g->prog ?? 0)));
    }
    $t = 0.0;
    foreach ($krs as $k) {
        $t += pfKrProg($k);
    }
    return (int) round($t / count($krs) * 100);
}
function pfView(stdClass $g, array $u, bool $full = false): array
{
    $out = [
        'id' => (string) $g->id, 'kind' => (string) $g->kind, 'owner' => (string) $g->owner, 'ownerN' => (string) $g->owner === '' ? 'Company' : pfName((string) $g->owner),
        'title' => (string) $g->title, 'why' => (string) ($g->why ?? ''), 'start' => (string) ($g->start ?? ''), 'due' => (string) ($g->due ?? ''), 'parent' => (string) ($g->parent ?? ''),
        'vis' => (string) ($g->vis ?? 'mgr'), 'st' => (string) ($g->st ?? 'active'), 'health' => (string) ($g->health ?? ''), 'prog' => pfProg($g), 'krs' => array_values(json_decode((string) json_encode($g->krs ?? []), true) ?: []),
        'ciAt' => (int) ($g->ciAt ?? 0), 'at' => (int) ($g->at ?? 0), 'u' => (int) ($g->u ?? 0), 'by' => (string) ($g->by ?? ''), 'canEdit' => pfMayEdit($u, $g), 'nCm' => count((array) ($g->cm ?? [])),
    ];
    foreach ($out['krs'] as &$k) {
        $k['p'] = (int) round(pfKrProg($k) * 100);
    }
    unset($k);
    if ($full) {
        $out['ci'] = array_reverse(array_values(json_decode((string) json_encode($g->ci ?? []), true) ?: []));
        $out['cm'] = array_values(json_decode((string) json_encode($g->cm ?? []), true) ?: []);
        $out['log'] = array_reverse(array_values(json_decode((string) json_encode($g->log ?? []), true) ?: []));
    }
    return $out;
}
function pfLog(stdClass $g, array $u, string $ev): void
{
    $log = (array) ($g->log ?? []);
    $log[] = (object) ['t' => now(), 'who' => (string) $u['name'], 'ev' => mb_substr($ev, 0, 300)];
    $g->log = array_slice($log, -100);
}
/** Every goal this person may see, as views. */
function pfAll(array $u): array
{
    $rows = [];
    foreach (colAll('pfg') as [$id, $g]) {
        $g->id = $id;
        if (pfMaySee($u, $g)) {
            $rows[] = pfView($g, $u);
        }
    }
    usort($rows, fn($a, $b) => [$a['st'] !== 'active', $a['due'] === '' ? '9999' : $a['due'], $a['title']] <=> [$b['st'] !== 'active', $b['due'] === '' ? '9999' : $b['due'], $b['title']]);
    return $rows;
}
/** The key results sent by the page, cleaned: up to 8, each with a name, a kind, start and target, and a unit. */
function pfKrsIn($in, array $old): array
{
    $byId = [];
    foreach ($old as $k) {
        $byId[(string) ($k['id'] ?? '')] = $k;
    }
    $out = [];
    foreach (array_slice((array) $in, 0, 8) as $k) {
        $k = (array) $k;
        $n = mb_substr(trim((string) ($k['n'] ?? '')), 0, 160);
        if ($n === '') {
            continue;
        }
        $t = in_array($k['t'] ?? '', ['num', 'pct', 'done'], true) ? (string) $k['t'] : 'num';
        $id = preg_replace('/[^a-z0-9]/', '', (string) ($k['id'] ?? '')) ?: rid(6);
        $was = $byId[$id] ?? null;
        $from = $t === 'done' ? 0.0 : round((float) ($k['from'] ?? 0), 2);
        $to = $t === 'done' ? 1.0 : round((float) ($k['to'] ?? 0), 2);
        if ($t === 'pct') {
            $from = max(0.0, min(100.0, $from));
            $to = max(0.0, min(100.0, $to));
        }
        if ($t !== 'done' && $to == $from) {
            fail(400, 'invalid_argument', 'Give "' . $n . '" a target different from where it starts.');
        }
        $cur = $was && ($was['t'] ?? '') === $t ? $was['cur'] : ($t === 'done' ? false : $from);
        $out[] = ['id' => $id, 'n' => $n, 't' => $t, 'from' => $from, 'to' => $to, 'cur' => $t === 'done' ? (bool) $cur : (float) $cur, 'unit' => $t === 'pct' ? '%' : mb_substr(trim((string) ($k['unit'] ?? '')), 0, 16)];
    }
    return $out;
}
function pfMail(string $uid, string $subject, string $body, string $link = ''): void
{
    $row = userRow($uid);
    if (!$row || !filter_var((string) $row['email'], FILTER_VALIDATE_EMAIL)) {
        return;
    }
    try {
        sendMail((string) $row['email'], (string) $row['name'], $subject, $body . ($link !== '' ? "\n\n" . siteUrl() . $link : ''), emailHtml($subject, preg_split('/\n{2,}/', $body), $link !== '' ? ['Open it', siteUrl() . $link] : null));
    } catch (Throwable $e) {
        // the change stands; the email can be missed
    }
}
function pfDate(string $d): string
{
    return preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) ? $d : '';
}

/* ---------------------------------------------------------------- reviews */

function pfCycle(string $id): stdClass
{
    $id = preg_replace('/[^a-z0-9]/', '', $id);
    $c = $id !== '' ? docGet('pfc/' . $id) : null;
    if (!$c) {
        fail(404, 'not_found', 'No such review cycle.');
    }
    $c->id = $id;
    return $c;
}
/** Who writes the manager part: the person's manager when the review was opened, else HR and administrators. */
function pfIsReviewer(array $u, stdClass $r): bool
{
    if ((string) $r->uid === $u['id']) {
        return false;
    }
    if ((string) ($r->mgr ?? '') !== '') {
        return (string) $r->mgr === $u['id'] || hasRole($u, 'admin');
    }
    return pfIsHR($u);
}
function pfReview(string $id, array $u): stdClass
{
    $id = preg_replace('/[^a-z0-9_]/', '', $id);
    $r = $id !== '' ? docGet('pfr/' . $id) : null;
    if (!$r || !((string) $r->uid === $u['id'] || pfIsReviewer($u, $r) || pfIsHR($u))) {
        fail(404, 'not_found', 'No such review.');
    }
    $r->id = $id;
    return $r;
}
function pfRView(stdClass $r, array $u, bool $full = false): array
{
    $mine = (string) $r->uid === $u['id'];
    $st = (string) $r->st;
    $out = [
        'id' => (string) $r->id, 'cyc' => (string) $r->cyc, 'cycN' => (string) ($r->cycN ?? ''), 'uid' => (string) $r->uid, 'n' => pfName((string) $r->uid), 'mgr' => (string) ($r->mgr ?? ''),
        'mgrN' => (string) ($r->mgr ?? '') !== '' ? pfName((string) $r->mgr) : 'HR', 'st' => $st, 'selfDue' => (string) ($r->selfDue ?? ''), 'mgrDue' => (string) ($r->mgrDue ?? ''), 'u' => (int) ($r->u ?? 0),
        'mine' => $mine, 'reviewer' => pfIsReviewer($u, $r), 'closed' => !empty($r->closed),
    ];
    // what each side sees: the person sees the manager's part once it is shared; the manager sees the self review once it is sent
    $seeSelf = $mine || $st !== 'self';
    $seeMgr = !$mine || in_array($st, ['shared', 'ack'], true);
    $out['selfRating'] = $seeSelf ? (string) ($r->self->rating ?? '') : '';
    $out['mgrRating'] = $seeMgr ? (string) ($r->mgrPart->rating ?? '') : '';
    if ($full) {
        $out['qs'] = json_decode((string) json_encode($r->qs ?? PF_QS), true);
        $out['goals'] = json_decode((string) json_encode($r->goals ?? []), true) ?: [];
        // a part not written yet is null (never an empty list)
        $out['self'] = $seeSelf && isset($r->self) ? json_decode((string) json_encode($r->self), true) : null;
        $out['mgrPart'] = $seeMgr && isset($r->mgrPart) ? json_decode((string) json_encode($r->mgrPart), true) : null;
        $out['ack'] = json_decode((string) json_encode($r->ack ?? null), true);
        $out['log'] = array_reverse(array_values(json_decode((string) json_encode($r->log ?? []), true) ?: []));
    }
    return $out;
}
/** The answers sent by the page for one part: text per question, a rating per goal, an overall rating. */
function pfPartIn(array $b, stdClass $r): stdClass
{
    $qs = json_decode((string) json_encode($r->qs ?? PF_QS), true);
    $ans = [];
    foreach ($qs as $q) {
        $ans[$q['id']] = mb_substr(trim((string) ($b['ans'][$q['id']] ?? '')), 0, 6000);
    }
    $gr = [];
    foreach ((array) ($r->goals ?? []) as $g) {
        $v = (string) ($b['goals'][(string) $g->id] ?? '');
        if (isset(PF_SCALE[$v])) {
            $gr[(string) $g->id] = $v;
        }
    }
    $rating = (string) ($b['rating'] ?? '');
    return (object) ['ans' => (object) $ans, 'goals' => (object) $gr, 'rating' => isset(PF_SCALE[$rating]) ? $rating : '', 'at' => now()];
}
function pfRLog(stdClass $r, array $u, string $ev): void
{
    $log = (array) ($r->log ?? []);
    $log[] = (object) ['t' => now(), 'who' => (string) $u['name'], 'ev' => mb_substr($ev, 0, 300)];
    $r->log = array_slice($log, -60);
}
/** The goals a review looks back on: the person's goals due in the period (or still active when it starts). */
function pfGoalsFor(string $uid, string $from, string $to, ?array $all = null): array
{
    $out = [];
    foreach ($all ?? colAll('pfg') as [$id, $g]) {
        if ((string) $g->owner !== $uid || (string) $g->kind === 'company' || (string) ($g->st ?? '') === 'dropped') {
            continue;
        }
        $due = (string) ($g->due ?? '');
        $start = (string) ($g->start ?? '');
        if (($due === '' || $due >= $from) && ($start === '' || $start <= $to)) {
            $g->id = $id;
            $out[] = (object) ['id' => $id, 'title' => (string) $g->title, 'prog' => pfProg($g), 'st' => (string) ($g->st ?? 'active'), 'due' => $due];
        }
    }
    return $out;
}

function pfRoute(string $r, array $b): never
{
    $u = requireUser();
    $str = fn(string $k, int $max) => mb_substr(trim((string) ($b[$k] ?? '')), 0, $max);
    $inCo = pfIsHR($u) || pfIn($u + ['status' => 'active']);
    if (!$inCo) {
        fail(403, 'forbidden', 'Goals and reviews are for the people of the company.');
    }
    switch ($r) {
        case 'pf_home':
            // my goals, what is waiting for me in reviews, whether I see a team, the names to show
            $all = pfAll($u);
            $mine = array_values(array_filter($all, fn($g) => $g['owner'] === $u['id']));
            $below = pfBelow($u);
            $todo = ['self' => 0, 'mgr' => 0, 'ack' => 0];
            foreach (colAll('pfr') as [$id, $rv]) {
                if (!empty($rv->closed)) {
                    continue;
                }
                $rv->id = $id;
                if ((string) $rv->uid === $u['id'] && (string) $rv->st === 'self') {
                    $todo['self']++;
                } elseif ((string) $rv->uid === $u['id'] && (string) $rv->st === 'shared') {
                    $todo['ack']++;
                } elseif ((string) $rv->st === 'mgr' && pfIsReviewer($u, $rv) && ((string) ($rv->mgr ?? '') === $u['id'] || (string) ($rv->mgr ?? '') === '')) {
                    $todo['mgr']++;
                }
            }
            ok([
                'mine' => $mine, 'shared' => array_values(array_filter($all, fn($g) => in_array($g['kind'], ['team', 'company'], true))), 'todo' => $todo, 'team' => count($below) > 0 || pfIsHR($u),
                'hr' => pfIsHR($u), 'mayTeam' => count($below) > 0 || pfIsHR($u) || hasRole($u, 'manager'), 'me' => $u['id'], 'health' => PF_HEALTH, 'kinds' => PF_KIND, 'gst' => PF_GST, 'scale' => PF_SCALE, 'rst' => PF_RST,
            ]);

        case 'pf_people':
            // whom this person may set goals for: themselves, the people below them; HR and administrators everyone
            $list = pfIsHR($u) ? pfPeople() : [$u['id'] => ['id' => $u['id'], 'n' => (string) $u['name'], 'e' => (string) $u['email'], 'mgr' => pfMgrOf($u['id'])]] + pfBelow($u);
            ok(['people' => array_values($list)]);

        case 'pf_team':
            // the people below me (everyone for HR and administrators) with their goals
            $people = pfIsHR($u) ? pfPeople() : pfBelow($u);
            unset($people[$u['id']]);
            $goals = [];
            foreach (colAll('pfg') as [$id, $g]) {
                $g->id = $id;
                if ((string) $g->kind !== 'company' && isset($people[(string) $g->owner])) {
                    $goals[] = pfView($g, $u);
                }
            }
            $rows = [];
            foreach ($people as $id => $p) {
                $gs = array_values(array_filter($goals, fn($g) => $g['owner'] === $id));
                $act = array_values(array_filter($gs, fn($g) => $g['st'] === 'active'));
                $rows[] = [
                    'id' => $id, 'n' => $p['n'], 'mgrN' => $p['mgr'] !== '' ? pfName($p['mgr']) : '', 'direct' => $p['mgr'] === $u['id'], 'goals' => $gs, 'active' => count($act),
                    'avg' => $act ? (int) round(array_sum(array_column($act, 'prog')) / count($act)) : null, 'risk' => count(array_filter($act, fn($g) => in_array($g['health'], ['risk', 'off'], true))),
                    'stale' => count(array_filter($act, fn($g) => $g['ciAt'] < now() - 30 * 86400000)),
                ];
            }
            usort($rows, fn($a, $b2) => [!$a['direct'], $a['n']] <=> [!$b2['direct'], $b2['n']]);
            ok(['people' => $rows]);

        case 'pf_company':
            // company and team goals (and goals shared with everyone), each with the goals aligned to it that I may see
            $all = pfAll($u);
            $kids = [];
            foreach ($all as $g) {
                if ($g['parent'] !== '') {
                    $kids[$g['parent']][] = ['id' => $g['id'], 'title' => $g['title'], 'ownerN' => $g['ownerN'], 'prog' => $g['prog'], 'health' => $g['health'], 'st' => $g['st'], 'kind' => $g['kind']];
                }
            }
            $rows = [];
            foreach ($all as $g) {
                if (in_array($g['kind'], ['team', 'company'], true) || $g['vis'] === 'all') {
                    $rows[] = $g + ['kids' => $kids[$g['id']] ?? []];
                }
            }
            ok(['goals' => $rows]);

        case 'pf_goal_get':
            $g = pfGoal($str('id', 30), $u);
            $v = pfView($g, $u, true);
            $v['kids'] = [];
            foreach (colAll('pfg') as [$id, $k]) {
                $k->id = $id;
                if ((string) ($k->parent ?? '') === (string) $g->id && pfMaySee($u, $k)) {
                    $v['kids'][] = ['id' => $id, 'title' => (string) $k->title, 'ownerN' => (string) $k->owner === '' ? 'Company' : pfName((string) $k->owner), 'prog' => pfProg($k), 'health' => (string) ($k->health ?? ''), 'st' => (string) ($k->st ?? 'active')];
                }
            }
            $p = $v['parent'] !== '' ? docGet('pfg/' . $v['parent']) : null;
            $v['parentT'] = $p && pfMaySee($u, (object) ((array) $p + ['id' => $v['parent']])) ? (string) $p->title : '';
            ok(['goal' => $v]);

        case 'pf_goal_save':
            if (throttleHit('pfsave:' . $u['id'], 240, 3600)) {
                fail(429, 'slow_down', 'Too many changes in an hour. Try again later.');
            }
            $id = $str('id', 30);
            $g = $id !== '' ? pfGoal($id, $u) : null;
            if ($g && !pfMayEdit($u, $g)) {
                fail(403, 'forbidden', 'Only the goal\'s owner, the people above them, HR and administrators change it.');
            }
            $kind = $g ? (string) $g->kind : (in_array($b['kind'] ?? '', ['mine', 'team', 'company'], true) ? (string) $b['kind'] : 'mine');
            $owner = $g ? (string) $g->owner : ($kind === 'company' ? '' : ($str('owner', 30) ?: $u['id']));
            if (!$g) {
                if ($kind === 'company' && !pfIsHR($u)) {
                    fail(403, 'forbidden', 'HR and administrators set the company\'s goals.');
                }
                if ($kind !== 'company') {
                    if (!isset(pfPeople()[$owner]) && $owner !== $u['id']) {
                        fail(400, 'invalid_argument', 'Choose someone in the company.');
                    }
                    if ($owner !== $u['id'] && !pfIsHR($u) && !pfAbove($u, $owner)) {
                        fail(403, 'forbidden', 'You set goals for yourself and for the people who report to you.');
                    }
                }
                if ($kind === 'team' && !pfIsHR($u) && !hasRole($u, 'manager') && !pfBelow($u)) {
                    fail(403, 'forbidden', 'Team goals are set by managers, HR and administrators.');
                }
            }
            $title = $str('title', 200);
            if ($title === '') {
                fail(400, 'invalid_argument', 'Give the goal a title.');
            }
            $start = pfDate($str('start', 10));
            $due = pfDate($str('due', 10));
            if ($start !== '' && $due !== '' && $due < $start) {
                fail(400, 'invalid_argument', 'The due date is before the start.');
            }
            $parent = preg_replace('/[^a-z0-9]/', '', $str('parent', 30));
            if ($parent !== '') {
                $pg = docGet('pfg/' . $parent);
                if (!$pg || !pfMaySee($u, (object) ((array) $pg + ['id' => $parent])) || !pfShared($pg)) {
                    fail(400, 'invalid_argument', 'A goal can be aligned to a team or company goal (or one shared with everyone).');
                }
                // no loops: walking up from the parent must not reach this goal
                $x = $parent;
                for ($i = 0; $i < 10 && $x !== ''; $i++) {
                    if ($g && $x === (string) $g->id) {
                        fail(400, 'invalid_argument', 'That would align the goal to itself.');
                    }
                    $xg = docGet('pfg/' . $x);
                    $x = $xg ? (string) ($xg->parent ?? '') : '';
                }
            }
            $isNew = !$g;
            if (!$g) {
                $g = (object) ['id' => rid(10), 'kind' => $kind, 'owner' => $owner, 'by' => $u['id'], 'at' => now(), 'st' => 'active', 'health' => '', 'ci' => [], 'cm' => [], 'ciAt' => 0];
            }
            $oldKrs = json_decode((string) json_encode($g->krs ?? []), true) ?: [];
            $g->title = $title;
            $g->why = $str('why', 4000);
            $g->start = $start;
            $g->due = $due;
            $g->parent = $parent;
            $g->vis = $kind === 'mine' && ($b['vis'] ?? '') === 'all' ? 'all' : ($kind === 'mine' ? 'mgr' : 'all');
            $g->krs = pfKrsIn($b['krs'] ?? [], $oldKrs);
            if (!$g->krs) {
                $g->prog = max(0, min(100, (int) ($b['prog'] ?? ($g->prog ?? 0))));
            }
            $st = (string) ($b['st'] ?? ($g->st ?? 'active'));
            if (isset(PF_GST[$st]) && $st !== (string) ($g->st ?? 'active')) {
                pfLog($g, $u, 'Marked ' . strtolower(PF_GST[$st]));
                $g->st = $st;
            }
            pfLog($g, $u, $isNew ? 'Set the goal' : 'Changed the goal');
            $g->u = now();
            $gid = (string) $g->id;
            unset($g->id);
            docSet('pfg/' . $gid, $g);
            $g->id = $gid;
            if ($isNew && $owner !== '' && $owner !== $u['id']) {
                pfMail($owner, 'A new goal for you: ' . $title, $u['name'] . ' set a goal for you: "' . $title . '"' . ($due !== '' ? ', due ' . $due : '') . '.', '#/portal/goals');
            }
            ok(['goal' => pfView($g, $u, true)]);

        case 'pf_checkin':
            $g = pfGoal($str('id', 30), $u);
            if (!pfMayEdit($u, $g)) {
                fail(403, 'forbidden', 'Check-ins are made by the goal\'s owner and the people above them.');
            }
            if ((string) ($g->st ?? 'active') !== 'active') {
                fail(409, 'conflict', 'This goal is closed. Reopen it to check in.');
            }
            $health = (string) ($b['health'] ?? '');
            if (!isset(PF_HEALTH[$health])) {
                fail(400, 'invalid_argument', 'Say whether the goal is on track, at risk or off track.');
            }
            $krs = json_decode((string) json_encode($g->krs ?? []), true) ?: [];
            $vals = (array) ($b['vals'] ?? []);
            $moved = [];
            foreach ($krs as &$k) {
                if (!array_key_exists($k['id'], $vals)) {
                    continue;
                }
                $nv = $k['t'] === 'done' ? (bool) $vals[$k['id']] : round((float) $vals[$k['id']], 2);
                if ($k['t'] === 'pct') {
                    $nv = max(0.0, min(100.0, $nv));
                }
                if ($k['t'] === 'done' ? $nv !== (bool) $k['cur'] : abs($nv - (float) $k['cur']) > 0.0001) {
                    $moved[$k['id']] = [$k['cur'], $nv];
                    $k['cur'] = $nv;
                }
            }
            unset($k);
            $was = pfProg($g);
            $g->krs = $krs;
            if (!$krs && isset($b['prog'])) {
                $g->prog = max(0, min(100, (int) $b['prog']));
            }
            $now = pfProg($g);
            $note = $str('note', 2000);
            $ci = (array) ($g->ci ?? []);
            $ci[] = (object) ['t' => now(), 'by' => $u['id'], 'who' => (string) $u['name'], 'health' => $health, 'prog' => $now, 'was' => $was, 'note' => $note, 'moved' => (object) $moved];
            $g->ci = array_slice($ci, -200);
            $hWas = (string) ($g->health ?? '');
            $g->health = $health;
            $g->ciAt = now();
            $g->u = now();
            $gid = (string) $g->id;
            unset($g->id);
            docSet('pfg/' . $gid, $g);
            $g->id = $gid;
            // the manager hears when a personal goal turns off track
            if ($health === 'off' && $hWas !== 'off' && (string) $g->owner !== '') {
                $m = pfMgrOf((string) $g->owner);
                if ($m !== '' && $m !== $u['id']) {
                    pfMail($m, 'Off track: ' . (string) $g->title, pfName((string) $g->owner) . '\'s goal "' . (string) $g->title . '" is off track (' . $now . '% done).' . ($note !== '' ? "\n\n" . $note : ''), '#/portal/mgr/goals');
                }
            }
            ok(['goal' => pfView($g, $u, true)]);

        case 'pf_comment':
            $g = pfGoal($str('id', 30), $u);
            $txt = $str('txt', 2000);
            if ($txt === '') {
                fail(400, 'invalid_argument', 'Write the comment first.');
            }
            if (throttleHit('pfcm:' . $u['id'], 120, 3600)) {
                fail(429, 'slow_down', 'Too many comments in an hour.');
            }
            $cm = (array) ($g->cm ?? []);
            $cm[] = (object) ['t' => now(), 'by' => $u['id'], 'who' => (string) $u['name'], 'txt' => $txt];
            $g->cm = array_slice($cm, -200);
            $gid = (string) $g->id;
            unset($g->id);
            docSet('pfg/' . $gid, $g);
            $g->id = $gid;
            if ((string) $g->owner !== '' && (string) $g->owner !== $u['id']) {
                pfMail((string) $g->owner, 'A comment on your goal: ' . (string) $g->title, $u['name'] . ' wrote: ' . $txt, '#/portal/goals');
            }
            ok(['goal' => pfView($g, $u, true)]);

        case 'pf_goal_delete':
            $g = pfGoal($str('id', 30), $u);
            $mayDel = pfIsHR($u) || ((string) $g->by === $u['id'] && !count((array) ($g->ci ?? [])));
            if (!$mayDel) {
                fail(403, 'forbidden', 'A goal with check-ins stays on record: mark it achieved or dropped instead.');
            }
            foreach (colAll('pfg') as [$id, $k]) {
                if ((string) ($k->parent ?? '') === (string) $g->id) {
                    $k->parent = '';
                    docSet('pfg/' . $id, $k);
                }
            }
            docDelete('pfg/' . (string) $g->id);
            audit('data', 'Goal deleted', (string) $g->title, [], $u);
            ok(['ok' => true]);

        /* ------------------------------------------------ reviews */

        case 'pf_reviews':
            // my own reviews, the ones I write as the manager, and (HR, administrators) the cycles
            $mine = [];
            $toDo = [];
            foreach (colAll('pfr') as [$id, $rv]) {
                $rv->id = $id;
                if ((string) $rv->uid === $u['id']) {
                    $mine[] = pfRView($rv, $u);
                } elseif (pfIsReviewer($u, $rv) && ((string) ($rv->mgr ?? '') === $u['id'] || (string) ($rv->mgr ?? '') === '')) {
                    $toDo[] = pfRView($rv, $u);
                }
            }
            $cycles = [];
            if (pfIsHR($u)) {
                foreach (colAll('pfc') as [$id, $c]) {
                    $cycles[] = ['id' => $id, 'n' => (string) $c->n, 'from' => (string) $c->from, 'to' => (string) $c->to, 'st' => (string) $c->st, 'selfDue' => (string) ($c->selfDue ?? ''), 'mgrDue' => (string) ($c->mgrDue ?? ''), 'at' => (int) ($c->at ?? 0), 'n2' => (int) ($c->count ?? 0)];
                }
                usort($cycles, fn($a, $b2) => $b2['at'] <=> $a['at']);
            }
            $sort = fn($a, $b2) => [$a['closed'], $b2['u']] <=> [$b2['closed'], $a['u']];
            usort($mine, $sort);
            usort($toDo, $sort);
            ok(['mine' => $mine, 'toDo' => $toDo, 'cycles' => $cycles, 'hr' => pfIsHR($u), 'rst' => PF_RST, 'scale' => PF_SCALE]);

        case 'pf_cycle_save':
            if (!pfIsHR($u)) {
                fail(403, 'forbidden', 'HR and administrators run review cycles.');
            }
            $id = $str('id', 30);
            $c = $id !== '' ? pfCycle($id) : (object) ['id' => rid(10), 'st' => 'draft', 'at' => now(), 'by' => $u['id']];
            if ((string) $c->st !== 'draft') {
                fail(409, 'conflict', 'A cycle that has started keeps its questions and people.');
            }
            $n = $str('n', 80);
            $from = pfDate($str('from', 10));
            $to = pfDate($str('to', 10));
            if ($n === '' || $from === '' || $to === '' || $to < $from) {
                fail(400, 'invalid_argument', 'Give the cycle a name and the period it looks back on.');
            }
            $qs = [];
            foreach (array_slice((array) ($b['qs'] ?? []), 0, 10) as $q) {
                $t = mb_substr(trim((string) (((array) $q)['q'] ?? '')), 0, 300);
                if ($t !== '') {
                    $qs[] = ['id' => preg_replace('/[^a-z0-9]/', '', (string) (((array) $q)['id'] ?? '')) ?: 'q' . rid(4), 'q' => $t];
                }
            }
            $who = ($b['who'] ?? '') === 'pick' ? 'pick' : 'all';
            $people = [];
            foreach ((array) ($b['people'] ?? []) as $p) {
                if (isset(pfPeople()[(string) $p])) {
                    $people[] = (string) $p;
                }
            }
            if ($who === 'pick' && !$people) {
                fail(400, 'invalid_argument', 'Pick the people this cycle is for.');
            }
            $c->n = $n;
            $c->from = $from;
            $c->to = $to;
            $c->selfDue = pfDate($str('selfDue', 10));
            $c->mgrDue = pfDate($str('mgrDue', 10));
            $c->qs = $qs ?: PF_QS;
            $c->who = $who;
            $c->people = array_values(array_unique($people));
            $c->u = now();
            $cid = (string) $c->id;
            unset($c->id);
            docSet('pfc/' . $cid, $c);
            ok(['id' => $cid]);

        case 'pf_cycle_launch':
            if (!pfIsHR($u)) {
                fail(403, 'forbidden', 'HR and administrators run review cycles.');
            }
            $c = pfCycle($str('id', 30));
            if ((string) $c->st !== 'draft') {
                fail(409, 'conflict', 'This cycle has already started.');
            }
            $who = (string) $c->who === 'pick' ? array_values(array_filter((array) $c->people, fn($p) => isset(pfPeople()[(string) $p]))) : array_keys(pfPeople());
            $n = 0;
            $allGoals = colAll('pfg');
            foreach ($who as $uid) {
                $uid = (string) $uid;
                $rid = (string) $c->id . '_' . $uid;
                if (docGet('pfr/' . $rid)) {
                    continue;
                }
                $mgr = pfMgrOf($uid);
                $rv = (object) [
                    'cyc' => (string) $c->id, 'cycN' => (string) $c->n, 'uid' => $uid, 'mgr' => $mgr !== '' && isset(pfPeople()[$mgr]) ? $mgr : '', 'st' => 'self', 'qs' => $c->qs, 'from' => (string) $c->from, 'to' => (string) $c->to,
                    'selfDue' => (string) ($c->selfDue ?? ''), 'mgrDue' => (string) ($c->mgrDue ?? ''), 'goals' => pfGoalsFor($uid, (string) $c->from, (string) $c->to, $allGoals), 'at' => now(), 'u' => now(),
                ];
                pfRLog($rv, $u, 'Review opened');
                docSet('pfr/' . $rid, $rv);
                $n++;
                pfMail($uid, 'Your self review is open: ' . (string) $c->n, 'The ' . (string) $c->n . ' review is open. Look back on ' . (string) $c->from . ' to ' . (string) $c->to . ', rate your goals and answer a few questions' . ((string) ($c->selfDue ?? '') !== '' ? ' by ' . (string) $c->selfDue : '') . '.', '#/portal/goals?t=reviews');
            }
            $c->st = 'open';
            $c->count = $n;
            $c->launched = now();
            $c->u = now();
            $cid = (string) $c->id;
            unset($c->id);
            docSet('pfc/' . $cid, $c);
            audit('settings', 'Review cycle started', (string) $c->n, ['people' => $n], $u);
            ok(['n' => $n]);

        case 'pf_cycle_get':
            if (!pfIsHR($u)) {
                fail(403, 'forbidden', 'HR and administrators run review cycles.');
            }
            $c = pfCycle($str('id', 30));
            $rows = [];
            $dist = ['1' => 0, '2' => 0, '3' => 0, '4' => 0, '5' => 0];
            $byst = array_fill_keys(array_keys(PF_RST), 0);
            foreach (colAll('pfr') as [$id, $rv]) {
                if ((string) $rv->cyc !== (string) $c->id) {
                    continue;
                }
                $rv->id = $id;
                $v = pfRView($rv, $u);
                $rows[] = $v;
                $byst[$v['st']] = ($byst[$v['st']] ?? 0) + 1;
                if (isset($dist[$v['mgrRating']])) {
                    $dist[$v['mgrRating']]++;
                }
            }
            usort($rows, fn($a, $b2) => $a['n'] <=> $b2['n']);
            ok(['cycle' => ['id' => (string) $c->id, 'n' => (string) $c->n, 'from' => (string) $c->from, 'to' => (string) $c->to, 'st' => (string) $c->st, 'selfDue' => (string) ($c->selfDue ?? ''), 'mgrDue' => (string) ($c->mgrDue ?? ''), 'qs' => $c->qs ?? PF_QS, 'who' => (string) ($c->who ?? 'all'), 'people' => (array) ($c->people ?? [])], 'reviews' => $rows, 'dist' => $dist, 'byst' => $byst]);

        case 'pf_cycle_close':
            if (!pfIsHR($u)) {
                fail(403, 'forbidden', 'HR and administrators run review cycles.');
            }
            $c = pfCycle($str('id', 30));
            if ((string) $c->st === 'draft') {
                docDelete('pfc/' . (string) $c->id);
                ok(['deleted' => true]);
            }
            $c->st = 'closed';
            $c->u = now();
            foreach (colAll('pfr') as [$id, $rv]) {
                if ((string) $rv->cyc === (string) $c->id && empty($rv->closed)) {
                    $rv->closed = now();
                    docSet('pfr/' . $id, $rv);
                }
            }
            $cid = (string) $c->id;
            unset($c->id);
            docSet('pfc/' . $cid, $c);
            audit('settings', 'Review cycle closed', (string) $c->n, [], $u);
            ok(['ok' => true]);

        case 'pf_review_get':
            $rv = pfReview($str('id', 60), $u);
            ok(['review' => pfRView($rv, $u, true), 'scale' => PF_SCALE, 'rst' => PF_RST]);

        case 'pf_review_save':
            // part self (the person, while it waits for them) or mgr (the reviewer, once the self review is in)
            $rv = pfReview($str('id', 60), $u);
            if (!empty($rv->closed)) {
                fail(409, 'conflict', 'This review cycle is closed.');
            }
            $part = ($b['part'] ?? '') === 'mgr' ? 'mgr' : 'self';
            $send = !empty($b['send']);
            if ($part === 'self') {
                if ((string) $rv->uid !== $u['id'] || (string) $rv->st !== 'self') {
                    fail(409, 'conflict', 'The self review can be changed by its person until it is sent.');
                }
                $rv->self = pfPartIn($b, $rv);
                if ($send) {
                    if ($rv->self->rating === '') {
                        fail(400, 'invalid_argument', 'Give yourself an overall rating before sending it.');
                    }
                    $rv->st = 'mgr';
                    $rv->self->sent = now();
                    pfRLog($rv, $u, 'Self review sent');
                    $to = (string) ($rv->mgr ?? '') !== '' ? [(string) $rv->mgr] : array_keys(array_filter(pfPeople(), fn($p) => hasRole(userRow($p['id']), 'hr')));
                    foreach (array_slice($to, 0, 10) as $m) {
                        pfMail($m, 'Self review in: ' . pfName((string) $rv->uid), pfName((string) $rv->uid) . ' sent their self review for ' . (string) $rv->cycN . '. Your part is next' . ((string) ($rv->mgrDue ?? '') !== '' ? ', by ' . (string) $rv->mgrDue : '') . '.', '#/portal/goals?t=reviews');
                    }
                }
            } else {
                if (!pfIsReviewer($u, $rv)) {
                    fail(403, 'forbidden', 'The manager part is written by the person\'s manager (HR when they have none).');
                }
                if ((string) $rv->st !== 'mgr') {
                    fail(409, 'conflict', (string) $rv->st === 'self' ? 'The self review comes first.' : 'This review was already shared.');
                }
                $rv->mgrPart = pfPartIn($b, $rv);
                $rv->mgrPart->by = $u['id'];
                if ($send) {
                    if ($rv->mgrPart->rating === '') {
                        fail(400, 'invalid_argument', 'Give an overall rating before sharing it.');
                    }
                    $rv->st = 'shared';
                    $rv->mgrPart->sent = now();
                    pfRLog($rv, $u, 'Manager review shared');
                    pfMail((string) $rv->uid, 'Your review is ready: ' . (string) $rv->cycN, $u['name'] . ' shared your ' . (string) $rv->cycN . ' review. Read it and acknowledge it in the portal.', '#/portal/goals?t=reviews');
                }
            }
            $rv->u = now();
            $id = (string) $rv->id;
            unset($rv->id);
            docSet('pfr/' . $id, $rv);
            $rv->id = $id;
            ok(['review' => pfRView($rv, $u, true), 'scale' => PF_SCALE, 'rst' => PF_RST]);

        case 'pf_review_ack':
            $rv = pfReview($str('id', 60), $u);
            if ((string) $rv->uid !== $u['id'] || (string) $rv->st !== 'shared') {
                fail(409, 'conflict', 'A review is acknowledged by its person once it is shared.');
            }
            $rv->ack = (object) ['t' => now(), 'note' => $str('note', 2000)];
            $rv->st = 'ack';
            $rv->u = now();
            pfRLog($rv, $u, 'Acknowledged');
            $id = (string) $rv->id;
            unset($rv->id);
            docSet('pfr/' . $id, $rv);
            $rv->id = $id;
            $m = (string) ($rv->mgrPart->by ?? ($rv->mgr ?? ''));
            if ($m !== '') {
                pfMail($m, 'Review acknowledged: ' . pfName((string) $rv->uid), pfName((string) $rv->uid) . ' acknowledged their ' . (string) $rv->cycN . ' review.' . ($rv->ack->note !== '' ? "\n\n" . $rv->ack->note : ''), '#/portal/goals?t=reviews');
            }
            ok(['review' => pfRView($rv, $u, true), 'scale' => PF_SCALE, 'rst' => PF_RST]);

        case 'pf_review_reopen':
            // HR and administrators send a review back a step (to the person, or to the manager)
            if (!pfIsHR($u)) {
                fail(403, 'forbidden', 'HR and administrators reopen reviews.');
            }
            $rv = pfReview($str('id', 60), $u);
            if (!empty($rv->closed)) {
                fail(409, 'conflict', 'This review cycle is closed.');
            }
            $to = ($b['to'] ?? '') === 'mgr' ? 'mgr' : 'self';
            if ($to === 'mgr' && (string) $rv->st === 'self') {
                fail(409, 'conflict', 'The self review has not been sent yet.');
            }
            $rv->st = $to;
            unset($rv->ack);
            $rv->u = now();
            pfRLog($rv, $u, 'Reopened for the ' . ($to === 'mgr' ? 'manager' : 'person'));
            $id = (string) $rv->id;
            unset($rv->id);
            docSet('pfr/' . $id, $rv);
            $rv->id = $id;
            ok(['review' => pfRView($rv, $u, true), 'scale' => PF_SCALE, 'rst' => PF_RST]);
    }
    fail(404, 'not_found', 'Unknown request.');
}
