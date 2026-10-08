<?php
declare(strict_types=1);
/*
 * v42 Work boards: the team's agile pipeline. Projects are Scrum (a backlog and sprints) or Kanban (a continuous
 * board); each has its own stages (columns) with optional work-in-progress limits. Work items (stories, tasks, bugs,
 * epics) carry a rank, story points, priority, an assignee, a due date, labels, a checklist, comments and their whole
 * history; every move between stages is recorded, which gives time in stage, aging, cycle time, the cumulative flow
 * and the sprint burndown. Daily stand-ups and sprint retrospectives live with the project; "My work" gathers what is
 * assigned to a person across projects, with notes when something is assigned to them or they are mentioned.
 * Who: administrators see every project; a project's members (staff or member-portal people added to it) see and work
 * in it; administrators, managers and HR create projects; the project lead and administrators change its settings.
 */

const WK_TYPES = ['story' => 'Story', 'task' => 'Task', 'bug' => 'Bug', 'epic' => 'Epic'];
const WK_PRIO = ['highest' => 'Highest', 'high' => 'High', 'medium' => 'Medium', 'low' => 'Low'];
const WK_DAY = 86400000;

function wkDb(): PDO
{
    static $ready = false;
    $p = db();
    if (!$ready) {
        $ready = true;
        $p->exec("CREATE TABLE IF NOT EXISTS wk_proj (id VARCHAR(20) PRIMARY KEY, pkey VARCHAR(10) NOT NULL, n VARCHAR(120) NOT NULL, kind VARCHAR(8) NOT NULL, descr TEXT, cols TEXT NOT NULL, members TEXT NOT NULL, lead VARCHAR(40) NOT NULL DEFAULT '', seq INT NOT NULL DEFAULT 0, arch INT NOT NULL DEFAULT 0, at BIGINT NOT NULL, by_uid VARCHAR(40) NOT NULL, u BIGINT NOT NULL)");
        $p->exec("CREATE TABLE IF NOT EXISTS wk_item (id VARCHAR(20) PRIMARY KEY, proj VARCHAR(20) NOT NULL, num INT NOT NULL, type VARCHAR(8) NOT NULL, title VARCHAR(300) NOT NULL, descr TEXT, st VARCHAR(20) NOT NULL, rk DOUBLE NOT NULL DEFAULT 0, pts DOUBLE, prio VARCHAR(8) NOT NULL DEFAULT 'medium', who VARCHAR(40) NOT NULL DEFAULT '', due VARCHAR(10) NOT NULL DEFAULT '', labels TEXT, epic VARCHAR(20) NOT NULL DEFAULT '', sprint VARCHAR(20) NOT NULL DEFAULT '', checklist TEXT, blocked INT NOT NULL DEFAULT 0, bwhy VARCHAR(300) NOT NULL DEFAULT '', at BIGINT NOT NULL, by_uid VARCHAR(40) NOT NULL, u BIGINT NOT NULL, st_at BIGINT NOT NULL, start_at BIGINT NOT NULL DEFAULT 0, done_at BIGINT NOT NULL DEFAULT 0)");
        $p->exec('CREATE INDEX IF NOT EXISTS wk_item_proj ON wk_item (proj)');
        // every change: field changes, stage moves (f = 'st', a = from, b = to), sprint moves, comments
        $p->exec("CREATE TABLE IF NOT EXISTS wk_hist (id VARCHAR(20) PRIMARY KEY, item VARCHAR(20) NOT NULL, proj VARCHAR(20) NOT NULL, at BIGINT NOT NULL, who VARCHAR(40) NOT NULL, f VARCHAR(20) NOT NULL, a TEXT, b TEXT)");
        $p->exec('CREATE INDEX IF NOT EXISTS wk_hist_item ON wk_hist (item)');
        $p->exec('CREATE INDEX IF NOT EXISTS wk_hist_proj ON wk_hist (proj, at)');
        $p->exec("CREATE TABLE IF NOT EXISTS wk_cmt (id VARCHAR(20) PRIMARY KEY, item VARCHAR(20) NOT NULL, at BIGINT NOT NULL, who VARCHAR(40) NOT NULL, txt TEXT NOT NULL)");
        $p->exec("CREATE TABLE IF NOT EXISTS wk_sprint (id VARCHAR(20) PRIMARY KEY, proj VARCHAR(20) NOT NULL, n VARCHAR(120) NOT NULL, goal VARCHAR(500) NOT NULL DEFAULT '', st VARCHAR(8) NOT NULL, start VARCHAR(10) NOT NULL DEFAULT '', fin VARCHAR(10) NOT NULL DEFAULT '', at BIGINT NOT NULL, started BIGINT NOT NULL DEFAULT 0, ended BIGINT NOT NULL DEFAULT 0, data TEXT)");
        $p->exec("CREATE TABLE IF NOT EXISTS wk_daily (id VARCHAR(60) PRIMARY KEY, proj VARCHAR(20) NOT NULL, day VARCHAR(10) NOT NULL, uid VARCHAR(40) NOT NULL, y TEXT, t TEXT, b TEXT, at BIGINT NOT NULL)");
        $p->exec("CREATE TABLE IF NOT EXISTS wk_retro (id VARCHAR(20) PRIMARY KEY, sprint VARCHAR(20) NOT NULL, proj VARCHAR(20) NOT NULL, kind VARCHAR(6) NOT NULL, txt VARCHAR(600) NOT NULL, who VARCHAR(40) NOT NULL, votes TEXT, item VARCHAR(20) NOT NULL DEFAULT '', at BIGINT NOT NULL)");
        $p->exec("CREATE TABLE IF NOT EXISTS wk_note (id VARCHAR(20) PRIMARY KEY, uid VARCHAR(40) NOT NULL, at BIGINT NOT NULL, item VARCHAR(20) NOT NULL, txt VARCHAR(400) NOT NULL, seen INT NOT NULL DEFAULT 0)");
        $p->exec('CREATE INDEX IF NOT EXISTS wk_note_uid ON wk_note (uid, seen)');
    }
    return $p;
}

/* ---------------------------------------------------------------- projects */

function wkCols(string $kind): array
{
    return $kind === 'kanban'
        ? [['k' => 'todo', 'n' => 'To do', 'wip' => 0, 'done' => false], ['k' => 'doing', 'n' => 'In progress', 'wip' => 4, 'done' => false], ['k' => 'review', 'n' => 'Review', 'wip' => 3, 'done' => false], ['k' => 'done', 'n' => 'Done', 'wip' => 0, 'done' => true]]
        : [['k' => 'todo', 'n' => 'To do', 'wip' => 0, 'done' => false], ['k' => 'doing', 'n' => 'In progress', 'wip' => 0, 'done' => false], ['k' => 'review', 'n' => 'In review', 'wip' => 0, 'done' => false], ['k' => 'done', 'n' => 'Done', 'wip' => 0, 'done' => true]];
}
function wkProjRow(array $r): array
{
    return [
        'id' => (string) $r['id'], 'key' => (string) $r['pkey'], 'n' => (string) $r['n'], 'kind' => (string) $r['kind'], 'd' => (string) ($r['descr'] ?? ''),
        'cols' => json_decode((string) $r['cols'], true) ?: wkCols((string) $r['kind']), 'members' => json_decode((string) $r['members'], true) ?: [],
        'lead' => (string) $r['lead'], 'arch' => (int) $r['arch'] === 1, 'at' => (int) $r['at'], 'u' => (int) $r['u'],
    ];
}
function wkMayCreate(array $u): bool
{
    return featureAllowed($u, 'work', hasRole($u, 'admin') || hasRole($u, 'manager') || hasRole($u, 'hr'));
}
/** For the menu: 2 = may create projects, 1 = on at least one (or an administrator with some), 0 = nothing to show. */
function wkCap(array $u): int
{
    if (featureMode((string) $u['id'], 'work') === 'block') return 0;
    if (wkMayCreate($u)) {
        return 2;
    }
    $s = wkDb()->prepare('SELECT COUNT(*) FROM wk_proj WHERE arch = 0 AND (members LIKE ? OR lead = ?)');
    $s->execute(['%"' . $u['id'] . '"%', $u['id']]);
    return (int) $s->fetchColumn() > 0 ? 1 : 0;
}
/** The project, when this person may see it (a member, or an administrator); else a 404. */
function wkProj(string $id, array $u): array
{
    $s = wkDb()->prepare('SELECT * FROM wk_proj WHERE id = ?');
    $s->execute([$id]);
    $r = $s->fetch();
    if (!$r) {
        fail(404, 'not_found', 'No such project.');
    }
    $P = wkProjRow($r);
    if (!hasRole($u, 'admin') && !in_array($u['id'], $P['members'], true) && $P['lead'] !== $u['id']) {
        fail(404, 'not_found', 'No such project.');
    }
    return $P;
}
function wkMayManage(array $P, array $u): bool
{
    return hasRole($u, 'admin') || $P['lead'] === $u['id'];
}
function wkColOf(array $P, string $k): ?array
{
    foreach ($P['cols'] as $c) {
        if ($c['k'] === $k) {
            return $c;
        }
    }
    return null;
}
function wkDoneKeys(array $P): array
{
    return array_values(array_map(fn($c) => $c['k'], array_filter($P['cols'], fn($c) => !empty($c['done']))));
}
/** People who can be put on projects: everyone with an active portal account (name and email for the pickers). */
function wkPeople(array $ids = []): array
{
    $out = [];
    if ($ids) {
        $in = implode(',', array_fill(0, count($ids), '?'));
        $s = db()->prepare("SELECT id, name, email FROM users WHERE id IN ($in)");
        $s->execute(array_values($ids));
    } else {
        $s = db()->query("SELECT id, name, email FROM users WHERE status = 'active' ORDER BY name LIMIT 1000");
    }
    foreach ($s->fetchAll() as $r) {
        $out[(string) $r['id']] = ['id' => (string) $r['id'], 'n' => (string) $r['name'], 'e' => (string) $r['email']];
    }
    return $out;
}

/* ---------------------------------------------------------------- items */

function wkItemRow(array $r): array
{
    return [
        'id' => (string) $r['id'], 'proj' => (string) $r['proj'], 'num' => (int) $r['num'], 'type' => (string) $r['type'], 'title' => (string) $r['title'], 'd' => (string) ($r['descr'] ?? ''),
        'st' => (string) $r['st'], 'rk' => (float) $r['rk'], 'pts' => $r['pts'] === null ? null : (float) $r['pts'], 'prio' => (string) $r['prio'], 'who' => (string) $r['who'], 'due' => (string) $r['due'],
        'labels' => json_decode((string) ($r['labels'] ?? ''), true) ?: [], 'epic' => (string) $r['epic'], 'sprint' => (string) $r['sprint'], 'check' => json_decode((string) ($r['checklist'] ?? ''), true) ?: [],
        'blocked' => (int) $r['blocked'] === 1, 'bwhy' => (string) $r['bwhy'], 'at' => (int) $r['at'], 'by' => (string) $r['by_uid'], 'u' => (int) $r['u'], 'stAt' => (int) $r['st_at'], 'startAt' => (int) $r['start_at'], 'doneAt' => (int) $r['done_at'],
    ];
}
function wkItem(string $id, array $u): array
{
    $s = wkDb()->prepare('SELECT * FROM wk_item WHERE id = ?');
    $s->execute([$id]);
    $r = $s->fetch();
    if (!$r) {
        fail(404, 'not_found', 'No such work item.');
    }
    $P = wkProj((string) $r['proj'], $u);
    return [$P, wkItemRow($r)];
}
function wkHist(string $item, string $proj, string $who, string $f, $a, $b): void
{
    wkDb()->prepare('INSERT INTO wk_hist (id, item, proj, at, who, f, a, b) VALUES (?,?,?,?,?,?,?,?)')->execute([rid(9), $item, $proj, now(), $who, $f, is_scalar($a) || $a === null ? (string) $a : json_encode($a), is_scalar($b) || $b === null ? (string) $b : json_encode($b)]);
}
function wkNote(string $uid, string $item, string $txt, string $from): void
{
    if ($uid === '' || $uid === $from) {
        return;
    }
    wkDb()->prepare('INSERT INTO wk_note (id, uid, at, item, txt, seen) VALUES (?,?,?,?,?,0)')->execute([rid(9), $uid, now(), $item, mb_substr($txt, 0, 400)]);
}
/** A rank between two neighbours (the list is ordered by rank; the first item has the lowest). */
function wkRankBetween(?float $before, ?float $after): float
{
    if ($before === null && $after === null) {
        return 1000.0;
    }
    if ($before === null) {
        return $after - 1000.0;
    }
    if ($after === null) {
        return $before + 1000.0;
    }
    return ($before + $after) / 2;
}
function wkLastRank(string $proj): float
{
    $s = wkDb()->prepare('SELECT MAX(rk) FROM wk_item WHERE proj = ?');
    $s->execute([$proj]);
    return (float) ($s->fetchColumn() ?: 0) + 1000.0;
}
/** Items still counted in a column (for the work-in-progress limit). */
function wkInCol(string $proj, string $col, string $sprint, string $kind, string $skip = ''): int
{
    $q = 'SELECT COUNT(*) FROM wk_item WHERE proj = ? AND st = ? AND id <> ?' . ($kind === 'scrum' ? ' AND sprint = ?' : '');
    $s = wkDb()->prepare($q);
    $s->execute($kind === 'scrum' ? [$proj, $col, $skip, $sprint] : [$proj, $col, $skip]);
    return (int) $s->fetchColumn();
}
function wkActiveSprint(string $proj): ?array
{
    $s = wkDb()->prepare("SELECT * FROM wk_sprint WHERE proj = ? AND st = 'active' ORDER BY started DESC LIMIT 1");
    $s->execute([$proj]);
    $r = $s->fetch();
    return $r ? wkSprintRow($r) : null;
}
function wkSprintRow(array $r): array
{
    return ['id' => (string) $r['id'], 'proj' => (string) $r['proj'], 'n' => (string) $r['n'], 'goal' => (string) $r['goal'], 'st' => (string) $r['st'], 'start' => (string) $r['start'], 'fin' => (string) $r['fin'], 'at' => (int) $r['at'], 'started' => (int) $r['started'], 'ended' => (int) $r['ended'], 'data' => json_decode((string) ($r['data'] ?? ''), true) ?: []];
}
function wkSprint(string $id, array $P): array
{
    $s = wkDb()->prepare('SELECT * FROM wk_sprint WHERE id = ? AND proj = ?');
    $s->execute([$id, $P['id']]);
    $r = $s->fetch();
    if (!$r) {
        fail(404, 'not_found', 'No such sprint.');
    }
    return wkSprintRow($r);
}
/** The mentions in a comment: @First Last, @first.last (the email's name) or @First when no one else on the project
 *  shares that first name. */
function wkMentions(string $txt, array $people): array
{
    $out = [];
    $low = mb_strtolower($txt);
    $firsts = [];
    foreach ($people as $id => $p) {
        $f = mb_strtolower((string) strtok(trim($p['n']), ' '));
        if ($f !== '') {
            $firsts[$f][] = $id;
        }
    }
    foreach ($people as $id => $p) {
        $n = mb_strtolower(trim($p['n']));
        $e = mb_strtolower((string) strtok($p['e'], '@'));
        $f = mb_strtolower((string) strtok(trim($p['n']), ' '));
        $hit = ($n !== '' && str_contains($low, '@' . $n))
            || ($e !== '' && preg_match('/@' . preg_quote($e, '/') . '(?![\p{L}\p{N}._-])/u', $low))
            || ($f !== '' && count($firsts[$f] ?? []) === 1 && preg_match('/@' . preg_quote($f, '/') . '(?![\p{L}\p{N}])/u', $low));
        if ($hit) {
            $out[] = $id;
        }
    }
    return $out;
}

/* ---------------------------------------------------------------- reports */

/** Points (or a count when items carry no points) of the given items. */
function wkSum(array $items, bool $pts): float
{
    $t = 0.0;
    foreach ($items as $i) {
        $t += $pts ? (float) ($i['pts'] ?? 0) : 1;
    }
    return $t;
}
function wkReports(array $P, string $sprintId): array
{
    $pdo = wkDb();
    $s = $pdo->prepare('SELECT * FROM wk_item WHERE proj = ?');
    $s->execute([$P['id']]);
    $items = array_map('wkItemRow', $s->fetchAll());
    $byId = [];
    foreach ($items as $i) {
        $byId[$i['id']] = $i;
    }
    $done = wkDoneKeys($P);
    $now = now();
    $out = [];
    // stage moves, oldest first
    $h = $pdo->prepare("SELECT item, at, a, b FROM wk_hist WHERE proj = ? AND f = 'st' ORDER BY at");
    $h->execute([$P['id']]);
    $moves = $h->fetchAll();

    // cumulative flow: items in each column at the end of each of the last 30 days
    $days = [];
    for ($d = 29; $d >= 0; $d--) {
        $days[] = date('Y-m-d', intdiv($now - $d * WK_DAY, 1000));
    }
    $colsK = array_map(fn($c) => $c['k'], $P['cols']);
    $cfd = [];
    foreach ($days as $day) {
        $end = (strtotime($day . ' 23:59:59') ?: 0) * 1000;
        $where = [];
        foreach ($items as $i) {
            if ($i['at'] <= $end && $i['type'] !== 'epic') {
                $where[$i['id']] = $P['cols'][0]['k'];
            }
        }
        foreach ($moves as $m) {
            if ((int) $m['at'] <= $end && isset($where[(string) $m['item']])) {
                $where[(string) $m['item']] = (string) $m['b'];
            }
        }
        $row = array_fill_keys($colsK, 0);
        foreach ($where as $st) {
            if (isset($row[$st])) {
                $row[$st]++;
            }
        }
        $cfd[] = ['day' => $day, 'n' => $row];
    }
    $out['cfd'] = $cfd;

    // cycle time: from first leaving the first column to done, for items done in the last 90 days
    $cyc = [];
    foreach ($items as $i) {
        if (in_array($i['st'], $done, true) && $i['doneAt'] > $now - 90 * WK_DAY && $i['startAt'] > 0 && $i['type'] !== 'epic') {
            $cyc[] = ['id' => $i['id'], 'num' => $i['num'], 'title' => $i['title'], 'days' => round(max(0, $i['doneAt'] - $i['startAt']) / WK_DAY, 1), 'done' => $i['doneAt']];
        }
    }
    usort($cyc, fn($a, $b) => $a['done'] <=> $b['done']);
    $ds = array_column($cyc, 'days');
    sort($ds);
    $out['cycle'] = ['items' => $cyc, 'avg' => $ds ? round(array_sum($ds) / count($ds), 1) : null, 'p85' => $ds ? $ds[(int) min(count($ds) - 1, (int) ceil(0.85 * count($ds)) - 1)] : null];

    // aging work in progress: items not done (and past the first column), how long in their stage and since they started
    $aging = [];
    foreach ($items as $i) {
        if (!in_array($i['st'], $done, true) && $i['st'] !== $P['cols'][0]['k'] && $i['type'] !== 'epic') {
            $aging[] = ['id' => $i['id'], 'num' => $i['num'], 'title' => $i['title'], 'st' => $i['st'], 'who' => $i['who'], 'inStage' => round(($now - $i['stAt']) / WK_DAY, 1), 'age' => round(($now - ($i['startAt'] ?: $i['stAt'])) / WK_DAY, 1), 'blocked' => $i['blocked']];
        }
    }
    usort($aging, fn($a, $b) => $b['age'] <=> $a['age']);
    $out['aging'] = $aging;

    // throughput per week (last 8 weeks)
    $tp = [];
    for ($w = 7; $w >= 0; $w--) {
        $to = $now - $w * 7 * WK_DAY;
        $from = $to - 7 * WK_DAY;
        $tp[] = ['to' => date('Y-m-d', intdiv($to, 1000)), 'n' => count(array_filter($items, fn($i) => $i['doneAt'] > $from && $i['doneAt'] <= $to && in_array($i['st'], $done, true) && $i['type'] !== 'epic'))];
    }
    $out['throughput'] = $tp;

    if ($P['kind'] === 'scrum') {
        // velocity: the last 8 finished sprints, committed (at start) and completed
        $vs = $pdo->prepare("SELECT * FROM wk_sprint WHERE proj = ? AND st = 'done' ORDER BY ended DESC LIMIT 8");
        $vs->execute([$P['id']]);
        $out['velocity'] = array_reverse(array_map(function ($r) {
            $S = wkSprintRow($r);
            return ['id' => $S['id'], 'n' => $S['n'], 'committed' => (float) ($S['data']['committed'] ?? 0), 'done' => (float) ($S['data']['completed'] ?? 0), 'unit' => (string) ($S['data']['unit'] ?? 'points')];
        }, $vs->fetchAll()));
        // burndown of a sprint (the active one by default): what was left at the end of each day
        $S = $sprintId !== '' ? wkSprint($sprintId, $P) : wkActiveSprint($P['id']);
        if ($S && $S['started']) {
            $in = array_values(array_filter($items, fn($i) => $i['sprint'] === $S['id'] || in_array($i['id'], (array) ($S['data']['items'] ?? []), true)));
            $usePts = count(array_filter($in, fn($i) => $i['pts'] !== null)) > 0;
            $first = strtotime(date('Y-m-d', intdiv($S['started'], 1000))) ?: 0;
            $last = $S['fin'] !== '' ? (strtotime($S['fin']) ?: $first) : $first + 13 * 86400;
            $series = [];
            for ($t = $first; $t <= $last && count($series) < 60; $t += 86400) {
                $end = ($t + 86399) * 1000;
                $left = 0.0;
                if ($end <= $now + WK_DAY) {
                    foreach ($in as $i) {
                        // done by then? (its last move into a done column before the end of that day)
                        $isDone = false;
                        foreach ($moves as $m) {
                            if ((string) $m['item'] === $i['id'] && (int) $m['at'] <= $end) {
                                $isDone = in_array((string) $m['b'], $done, true);
                            }
                        }
                        if (!$isDone && $i['at'] <= $end) {
                            $left += $usePts ? (float) ($i['pts'] ?? 0) : 1;
                        }
                    }
                }
                $series[] = ['day' => date('Y-m-d', $t), 'left' => $end <= $now + WK_DAY ? $left : null];
            }
            $out['burndown'] = ['sprint' => ['id' => $S['id'], 'n' => $S['n'], 'st' => $S['st']], 'unit' => $usePts ? 'points' : 'items', 'start' => (float) ($S['data']['committed'] ?? wkSum($in, $usePts)), 'days' => $series];
        }
    }
    return $out;
}

/* ---------------------------------------------------------------- routes */

function wkRoute(string $r, array $b): never
{
    $u = requireUser();
    $pdo = wkDb();
    $str = fn(string $k, int $max) => mb_substr(trim((string) ($b[$k] ?? '')), 0, $max);
    switch ($r) {
        case 'wk_projects':
            $s = $pdo->query('SELECT * FROM wk_proj ORDER BY arch, n');
            $list = [];
            foreach ($s->fetchAll() as $row) {
                $P = wkProjRow($row);
                if (!hasRole($u, 'admin') && !in_array($u['id'], $P['members'], true) && $P['lead'] !== $u['id']) {
                    continue;
                }
                $c = $pdo->prepare('SELECT st, COUNT(*) AS n FROM wk_item WHERE proj = ? GROUP BY st');
                $c->execute([$P['id']]);
                $counts = [];
                foreach ($c->fetchAll() as $x) {
                    $counts[(string) $x['st']] = (int) $x['n'];
                }
                $P['counts'] = $counts;
                $P['sprint'] = $P['kind'] === 'scrum' ? wkActiveSprint($P['id']) : null;
                $list[] = $P;
            }
            $n = $pdo->prepare('SELECT COUNT(*) FROM wk_note WHERE uid = ? AND seen = 0');
            $n->execute([$u['id']]);
            ok(['projects' => $list, 'canCreate' => wkMayCreate($u), 'notes' => (int) $n->fetchColumn(), 'me' => $u['id']]);

        case 'wk_people':
            // whom a new project can include (for the people who create projects)
            if (!wkMayCreate($u)) {
                fail(403, 'forbidden', 'Administrators, managers and HR create projects.');
            }
            ok(['people' => array_values(wkPeople())]);

        case 'wk_project_save':
            $id = $str('id', 20);
            $name = $str('n', 120);
            if ($name === '') {
                fail(400, 'invalid_argument', 'Give the project a name.');
            }
            $old = $id !== '' ? wkProj($id, $u) : null;
            if ($old ? !wkMayManage($old, $u) : !wkMayCreate($u)) {
                fail(403, 'forbidden', $old ? 'Only the project lead or an administrator changes the project.' : 'Administrators, managers and HR create projects.');
            }
            $kind = $old ? $old['kind'] : (($b['kind'] ?? '') === 'kanban' ? 'kanban' : 'scrum');
            $key = strtoupper((string) preg_replace('/[^A-Za-z0-9]/', '', $str('key', 10)));
            if (!preg_match('/^[A-Z][A-Z0-9]{1,9}$/', $key)) {
                fail(400, 'invalid_argument', 'The project key is 2 to 10 letters or digits, starting with a letter (for example WEB).');
            }
            $dup = $pdo->prepare('SELECT COUNT(*) FROM wk_proj WHERE pkey = ? AND id <> ?');
            $dup->execute([$key, $id]);
            if ((int) $dup->fetchColumn() > 0) {
                fail(409, 'conflict', 'Another project already uses the key ' . $key . '.');
            }
            // the stages: a key, a name, an optional limit; exactly the last one(s) marked done; at least two
            $cols = [];
            $seen = [];
            foreach ((array) ($b['cols'] ?? ($old['cols'] ?? wkCols($kind))) as $c) {
                $ck = strtolower((string) preg_replace('/[^a-z0-9]/i', '', (string) ($c['k'] ?? '')));
                $cn = mb_substr(trim((string) ($c['n'] ?? '')), 0, 40);
                if ($cn === '') {
                    continue;
                }
                if ($ck === '' || isset($seen[$ck])) {
                    $ck = 'c' . rid(3);
                }
                $seen[$ck] = true;
                $cols[] = ['k' => $ck, 'n' => $cn, 'wip' => max(0, min(99, (int) ($c['wip'] ?? 0))), 'done' => !empty($c['done'])];
            }
            if (count($cols) < 2 || count($cols) > 12) {
                fail(400, 'invalid_argument', 'A board has 2 to 12 stages.');
            }
            if (!array_filter($cols, fn($c) => $c['done'])) {
                $cols[count($cols) - 1]['done'] = true;
            }
            if ($cols[0]['done']) {
                fail(400, 'invalid_argument', 'The first stage cannot be a done stage.');
            }
            if ($old) {
                // a stage that still holds items cannot be removed
                $keep = array_column($cols, 'k');
                foreach ($old['cols'] as $oc) {
                    if (!in_array($oc['k'], $keep, true)) {
                        $c = $pdo->prepare('SELECT COUNT(*) FROM wk_item WHERE proj = ? AND st = ?');
                        $c->execute([$old['id'], $oc['k']]);
                        if ((int) $c->fetchColumn() > 0) {
                            fail(409, 'conflict', 'The stage "' . $oc['n'] . '" still has work items: move them first.');
                        }
                    }
                }
            }
            $people = wkPeople();
            $members = array_values(array_unique(array_filter(array_map('strval', (array) ($b['members'] ?? [])), fn($x) => isset($people[$x]))));
            $lead = (string) ($b['lead'] ?? ($old['lead'] ?? $u['id']));
            if (!isset($people[$lead])) {
                $lead = $u['id'];
            }
            if (!in_array($lead, $members, true)) {
                $members[] = $lead;
            }
            $now = now();
            if ($old) {
                $pdo->prepare('UPDATE wk_proj SET pkey = ?, n = ?, descr = ?, cols = ?, members = ?, lead = ?, arch = ?, u = ? WHERE id = ?')->execute([$key, $name, $str('d', 4000), json_encode($cols), json_encode($members), $lead, !empty($b['arch']) ? 1 : 0, $now, $old['id']]);
                $id = $old['id'];
                foreach (array_diff($members, $old['members']) as $m) {
                    wkNote($m, '', 'You were added to the project ' . $name . ' (' . $key . ').', $u['id']);
                }
            } else {
                $id = 'p' . rid(8);
                $pdo->prepare('INSERT INTO wk_proj (id, pkey, n, kind, descr, cols, members, lead, seq, arch, at, by_uid, u) VALUES (?,?,?,?,?,?,?,?,0,0,?,?,?)')->execute([$id, $key, $name, $kind, $str('d', 4000), json_encode($cols), json_encode($members), $lead, $now, $u['id'], $now]);
                foreach ($members as $m) {
                    wkNote($m, '', 'You were added to the project ' . $name . ' (' . $key . ').', $u['id']);
                }
            }
            ok(['project' => wkProj($id, $u)]);

        case 'wk_board':
            // the board, the backlog and the sprints of one project, with the people on it
            $P = wkProj($str('id', 20), $u);
            $s = $pdo->prepare('SELECT * FROM wk_item WHERE proj = ? ORDER BY rk');
            $s->execute([$P['id']]);
            $items = [];
            $done = wkDoneKeys($P);
            $old = now() - 30 * WK_DAY;
            foreach ($s->fetchAll() as $row) {
                $i = wkItemRow($row);
                // done long ago: kept out of the board (still in reports and search)
                if (in_array($i['st'], $done, true) && $i['doneAt'] && $i['doneAt'] < $old && empty($b['all'])) {
                    continue;
                }
                $c = $pdo->prepare('SELECT COUNT(*) FROM wk_cmt WHERE item = ?');
                $c->execute([$i['id']]);
                $i['cmts'] = (int) $c->fetchColumn();
                $items[] = $i;
            }
            $sp = $pdo->prepare("SELECT * FROM wk_sprint WHERE proj = ? AND st <> 'done' ORDER BY st = 'active' DESC, at");
            $sp->execute([$P['id']]);
            $sprints = array_map('wkSprintRow', $sp->fetchAll());
            $done2 = $pdo->prepare("SELECT * FROM wk_sprint WHERE proj = ? AND st = 'done' ORDER BY ended DESC LIMIT 12");
            $done2->execute([$P['id']]);
            ok(['project' => $P, 'items' => $items, 'sprints' => $sprints, 'past' => array_map('wkSprintRow', $done2->fetchAll()), 'people' => array_values(wkPeople($P['members'])), 'manage' => wkMayManage($P, $u), 'all' => wkMayManage($P, $u) ? array_values(wkPeople()) : []]);

        case 'wk_item_get':
            [$P, $I] = wkItem($str('id', 20), $u);
            $c = $pdo->prepare('SELECT * FROM wk_cmt WHERE item = ? ORDER BY at');
            $c->execute([$I['id']]);
            $h = $pdo->prepare("SELECT * FROM wk_hist WHERE item = ? ORDER BY at DESC LIMIT 200");
            $h->execute([$I['id']]);
            ok(['item' => $I, 'project' => $P, 'comments' => array_map(fn($x) => ['id' => (string) $x['id'], 'at' => (int) $x['at'], 'who' => (string) $x['who'], 'txt' => (string) $x['txt']], $c->fetchAll()), 'hist' => array_map(fn($x) => ['at' => (int) $x['at'], 'who' => (string) $x['who'], 'f' => (string) $x['f'], 'a' => (string) $x['a'], 'b' => (string) $x['b']], $h->fetchAll()), 'people' => array_values(wkPeople($P['members']))]);

        case 'wk_item_save':
            // a new item (proj + fields) or changes to one (id + fields)
            $id = $str('id', 20);
            if ($id !== '') {
                [$P, $I] = wkItem($id, $u);
            } else {
                $P = wkProj($str('proj', 20), $u);
                $I = null;
            }
            if ($P['arch']) {
                fail(409, 'conflict', 'The project is archived.');
            }
            $f = is_array($b['f'] ?? null) ? $b['f'] : [];
            $set = [];
            if (!$I || array_key_exists('title', $f)) {
                $t = mb_substr(trim((string) ($f['title'] ?? '')), 0, 300);
                if ($t === '') {
                    fail(400, 'invalid_argument', 'Give the work item a title.');
                }
                $set['title'] = $t;
            }
            if (array_key_exists('d', $f)) {
                $set['descr'] = mb_substr((string) $f['d'], 0, 20000);
            }
            if (!$I || array_key_exists('type', $f)) {
                $set['type'] = isset(WK_TYPES[(string) ($f['type'] ?? '')]) ? (string) $f['type'] : 'task';
            }
            if (!$I || array_key_exists('prio', $f)) {
                $set['prio'] = isset(WK_PRIO[(string) ($f['prio'] ?? '')]) ? (string) $f['prio'] : 'medium';
            }
            if (array_key_exists('pts', $f)) {
                $set['pts'] = $f['pts'] === null || $f['pts'] === '' ? null : max(0, min(1000, round((float) $f['pts'], 1)));
            }
            if (array_key_exists('who', $f)) {
                $w = (string) $f['who'];
                if ($w !== '' && !in_array($w, $P['members'], true)) {
                    fail(400, 'invalid_argument', 'Assign it to someone on the project (add them under the project\'s settings first).');
                }
                $set['who'] = $w;
            }
            if (array_key_exists('due', $f)) {
                $d = (string) $f['due'];
                $set['due'] = preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) ? $d : '';
            }
            if (array_key_exists('labels', $f)) {
                $set['labels'] = json_encode(array_slice(array_values(array_unique(array_filter(array_map(fn($x) => mb_substr(trim((string) $x), 0, 30), (array) $f['labels'])))), 0, 12));
            }
            if (array_key_exists('epic', $f)) {
                $e = (string) $f['epic'];
                if ($e !== '') {
                    $c = $pdo->prepare("SELECT COUNT(*) FROM wk_item WHERE id = ? AND proj = ? AND type = 'epic'");
                    $c->execute([$e, $P['id']]);
                    if (!(int) $c->fetchColumn() || $e === $id) {
                        $e = '';
                    }
                }
                $set['epic'] = $e;
            }
            if (array_key_exists('check', $f)) {
                $set['checklist'] = json_encode(array_slice(array_values(array_filter(array_map(fn($x) => ['t' => mb_substr(trim((string) ($x['t'] ?? '')), 0, 200), 'done' => !empty($x['done'])], (array) $f['check']), fn($x) => $x['t'] !== '')), 0, 50));
            }
            if (array_key_exists('blocked', $f)) {
                $set['blocked'] = !empty($f['blocked']) ? 1 : 0;
                $set['bwhy'] = !empty($f['blocked']) ? mb_substr(trim((string) ($f['bwhy'] ?? '')), 0, 300) : '';
            }
            if (array_key_exists('sprint', $f) && $P['kind'] === 'scrum') {
                $sid = (string) $f['sprint'];
                if ($sid !== '') {
                    $S = wkSprint($sid, $P);
                    if ($S['st'] === 'done') {
                        fail(409, 'conflict', 'That sprint is finished.');
                    }
                }
                $set['sprint'] = $sid;
            }
            $now = now();
            if (!$I) {
                $pdo->beginTransaction();
                $pdo->prepare('UPDATE wk_proj SET seq = seq + 1 WHERE id = ?')->execute([$P['id']]);
                $q = $pdo->prepare('SELECT seq FROM wk_proj WHERE id = ?');
                $q->execute([$P['id']]);
                $num = (int) $q->fetchColumn();
                $st = (string) ($f['st'] ?? '');
                $st = wkColOf($P, $st) ? $st : $P['cols'][0]['k'];
                $iid = 'w' . rid(9);
                $row = $set + ['descr' => '', 'pts' => null, 'who' => '', 'due' => '', 'labels' => '[]', 'epic' => '', 'checklist' => '[]', 'blocked' => 0, 'bwhy' => '', 'sprint' => ''];
                if ($P['kind'] === 'kanban') {
                    $row['sprint'] = '';
                }
                $pdo->prepare('INSERT INTO wk_item (id, proj, num, type, title, descr, st, rk, pts, prio, who, due, labels, epic, sprint, checklist, blocked, bwhy, at, by_uid, u, st_at, start_at, done_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute([
                    $iid, $P['id'], $num, $row['type'], $row['title'], $row['descr'], $st, wkLastRank($P['id']), $row['pts'], $row['prio'], $row['who'], $row['due'], $row['labels'], $row['epic'], $row['sprint'], $row['checklist'], $row['blocked'], $row['bwhy'], $now, $u['id'], $now, $now, $st !== $P['cols'][0]['k'] ? $now : 0, in_array($st, wkDoneKeys($P), true) ? $now : 0,
                ]);
                $pdo->commit();
                wkHist($iid, $P['id'], $u['id'], 'new', '', $row['title']);
                if ($st !== $P['cols'][0]['k']) {
                    wkHist($iid, $P['id'], $u['id'], 'st', $P['cols'][0]['k'], $st);
                }
                if ($row['who'] !== '') {
                    wkNote($row['who'], $iid, $u['name'] . ' assigned you ' . $P['key'] . '-' . $num . ': ' . $row['title'], $u['id']);
                }
                [, $I] = wkItem($iid, $u);
                ok(['item' => $I]);
            }
            if (!$set) {
                ok(['item' => $I]);
            }
            $cols = [];
            $vals = [];
            $map = ['title' => 'title', 'descr' => 'd', 'type' => 'type', 'prio' => 'prio', 'pts' => 'pts', 'who' => 'who', 'due' => 'due', 'labels' => 'labels', 'epic' => 'epic', 'checklist' => 'check', 'blocked' => 'blocked', 'bwhy' => 'bwhy', 'sprint' => 'sprint'];
            foreach ($set as $k => $v) {
                $cols[] = $k . ' = ?';
                $vals[] = $v;
                $was = $I[$map[$k]] ?? null;
                $was = is_bool($was) ? ($was ? 1 : 0) : $was;
                $now2 = in_array($k, ['labels', 'checklist'], true) ? json_decode((string) $v, true) : $v;
                if (json_encode($was) !== json_encode($now2) && !($k === 'pts' && (float) $was === (float) $now2 && $was !== null && $now2 !== null)) {
                    wkHist($I['id'], $P['id'], $u['id'], $map[$k], $k === 'descr' ? '' : $was, $k === 'descr' ? '(changed)' : $now2);
                }
            }
            $cols[] = 'u = ?';
            $vals[] = $now;
            $vals[] = $I['id'];
            $pdo->prepare('UPDATE wk_item SET ' . implode(', ', $cols) . ' WHERE id = ?')->execute($vals);
            if (isset($set['who']) && $set['who'] !== '' && $set['who'] !== $I['who']) {
                wkNote($set['who'], $I['id'], $u['name'] . ' assigned you ' . $P['key'] . '-' . $I['num'] . ': ' . ($set['title'] ?? $I['title']), $u['id']);
            }
            if (isset($set['blocked']) && $set['blocked'] && !$I['blocked'] && $I['who'] !== '') {
                wkNote($I['who'], $I['id'], $P['key'] . '-' . $I['num'] . ' is marked blocked' . ($set['bwhy'] !== '' ? ': ' . $set['bwhy'] : '.'), $u['id']);
            }
            [, $I] = wkItem($I['id'], $u);
            ok(['item' => $I]);

        case 'wk_move':
            // to another stage and/or position: before = the item it goes above ('' = the end of that stage)
            [$P, $I] = wkItem($str('id', 20), $u);
            if ($P['arch']) {
                fail(409, 'conflict', 'The project is archived.');
            }
            $st = $str('st', 20) ?: $I['st'];
            $col = wkColOf($P, $st);
            if (!$col) {
                fail(400, 'invalid_argument', 'No such stage.');
            }
            if ($P['kind'] === 'scrum' && $st !== $I['st'] && $I['sprint'] === '' && $I['type'] !== 'epic') {
                fail(409, 'conflict', 'Put it in the active sprint before moving it along the board.');
            }
            if ($st !== $I['st'] && $col['wip'] > 0 && empty($b['force']) && wkInCol($P['id'], $st, $I['sprint'], $P['kind'], $I['id']) >= $col['wip']) {
                fail(409, 'wip_limit', '"' . $col['n'] . '" is at its limit of ' . $col['wip'] . '. Finish something there first, or move it anyway.', ['wip' => true]);
            }
            // the new rank: between the item before which it goes and the one above that, in the same stage
            $before = $str('before', 20);
            $q = $pdo->prepare('SELECT id, rk FROM wk_item WHERE proj = ? AND st = ? AND id <> ? ORDER BY rk');
            $q->execute([$P['id'], $st, $I['id']]);
            $list = $q->fetchAll();
            $rk = null;
            if ($before !== '') {
                $prev = null;
                foreach ($list as $x) {
                    if ((string) $x['id'] === $before) {
                        $rk = wkRankBetween($prev, (float) $x['rk']);
                        break;
                    }
                    $prev = (float) $x['rk'];
                }
            }
            if ($rk === null) {
                $rk = $st === $I['st'] && $before === '' && !empty($b['keepRank']) ? $I['rk'] : wkRankBetween($list ? (float) end($list)['rk'] : null, null);
            }
            $now = now();
            $done = wkDoneKeys($P);
            $vals = ['rk' => $rk, 'u' => $now];
            if ($st !== $I['st']) {
                $vals['st'] = $st;
                $vals['st_at'] = $now;
                if ($I['startAt'] === 0 && $st !== $P['cols'][0]['k']) {
                    $vals['start_at'] = $now;
                }
                $vals['done_at'] = in_array($st, $done, true) ? $now : 0;
                if (in_array($st, $done, true)) {
                    $vals['blocked'] = 0;
                    $vals['bwhy'] = '';
                }
            }
            $sets = implode(', ', array_map(fn($k) => $k . ' = ?', array_keys($vals)));
            $pdo->prepare('UPDATE wk_item SET ' . $sets . ' WHERE id = ?')->execute(array_merge(array_values($vals), [$I['id']]));
            if ($st !== $I['st']) {
                wkHist($I['id'], $P['id'], $u['id'], 'st', $I['st'], $st);
                if (in_array($st, $done, true) && $I['by'] !== $u['id']) {
                    wkNote($I['by'], $I['id'], $P['key'] . '-' . $I['num'] . ' is done: ' . $I['title'], $u['id']);
                }
            }
            [, $I] = wkItem($I['id'], $u);
            ok(['item' => $I]);

        case 'wk_rank':
            // the backlog's order (across stages): before = the item it goes above ('' = the end)
            [$P, $I] = wkItem($str('id', 20), $u);
            $before = $str('before', 20);
            $q = $pdo->prepare('SELECT id, rk FROM wk_item WHERE proj = ? AND id <> ? ORDER BY rk');
            $q->execute([$P['id'], $I['id']]);
            $prev = null;
            $rk = null;
            $all = $q->fetchAll();
            foreach ($all as $x) {
                if ((string) $x['id'] === $before) {
                    $rk = wkRankBetween($prev, (float) $x['rk']);
                    break;
                }
                $prev = (float) $x['rk'];
            }
            if ($rk === null) {
                $rk = wkRankBetween($all ? (float) end($all)['rk'] : null, null);
            }
            $pdo->prepare('UPDATE wk_item SET rk = ?, u = ? WHERE id = ?')->execute([$rk, now(), $I['id']]);
            ok(['rk' => $rk]);

        case 'wk_comment':
            [$P, $I] = wkItem($str('id', 20), $u);
            $txt = trim((string) ($b['txt'] ?? ''));
            if ($txt === '' || mb_strlen($txt) > 8000) {
                fail(400, 'invalid_argument', 'Write the comment (up to 8,000 characters).');
            }
            $cid = 'c' . rid(9);
            $pdo->prepare('INSERT INTO wk_cmt (id, item, at, who, txt) VALUES (?,?,?,?,?)')->execute([$cid, $I['id'], now(), $u['id'], $txt]);
            wkHist($I['id'], $P['id'], $u['id'], 'cmt', '', mb_substr($txt, 0, 120));
            $people = wkPeople($P['members']);
            $told = [];
            foreach (wkMentions($txt, $people) as $m) {
                wkNote($m, $I['id'], $u['name'] . ' mentioned you on ' . $P['key'] . '-' . $I['num'] . ': ' . mb_substr($txt, 0, 160), $u['id']);
                $told[] = $m;
            }
            if ($I['who'] !== '' && !in_array($I['who'], $told, true)) {
                wkNote($I['who'], $I['id'], $u['name'] . ' commented on ' . $P['key'] . '-' . $I['num'] . ': ' . mb_substr($txt, 0, 160), $u['id']);
            }
            ok(['id' => $cid, 'mentioned' => $told]);

        case 'wk_item_delete':
            [$P, $I] = wkItem($str('id', 20), $u);
            if (!wkMayManage($P, $u) && $I['by'] !== $u['id']) {
                fail(403, 'forbidden', 'The project lead, an administrator or whoever created it deletes a work item.');
            }
            foreach (['DELETE FROM wk_item WHERE id = ?', 'DELETE FROM wk_cmt WHERE item = ?', 'DELETE FROM wk_hist WHERE item = ?', 'DELETE FROM wk_note WHERE item = ?'] as $q) {
                $pdo->prepare($q)->execute([$I['id']]);
            }
            $pdo->prepare("UPDATE wk_item SET epic = '' WHERE epic = ?")->execute([$I['id']]);
            ok(['ok' => true]);

        case 'wk_sprint_save':
            $P = wkProj($str('proj', 20), $u);
            if ($P['kind'] !== 'scrum') {
                fail(400, 'invalid_argument', 'A Kanban board has no sprints.');
            }
            $id = $str('id', 20);
            $n = $str('n', 120);
            $start = $str('start', 10);
            $fin = $str('fin', 10);
            foreach ([$start, $fin] as $d) {
                if ($d !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) {
                    fail(400, 'invalid_argument', 'Dates are year-month-day.');
                }
            }
            if ($start !== '' && $fin !== '' && $fin < $start) {
                fail(400, 'invalid_argument', 'The sprint ends after it starts.');
            }
            if ($id !== '') {
                $S = wkSprint($id, $P);
                if ($S['st'] === 'done') {
                    fail(409, 'conflict', 'That sprint is finished.');
                }
                $pdo->prepare('UPDATE wk_sprint SET n = ?, goal = ?, start = ?, fin = ? WHERE id = ?')->execute([$n ?: $S['n'], $str('goal', 500), $start, $fin, $S['id']]);
            } else {
                $c = $pdo->prepare('SELECT COUNT(*) FROM wk_sprint WHERE proj = ?');
                $c->execute([$P['id']]);
                $id = 's' . rid(8);
                $pdo->prepare("INSERT INTO wk_sprint (id, proj, n, goal, st, start, fin, at, started, ended, data) VALUES (?,?,?,?,'plan',?,?,?,0,0,'{}')")->execute([$id, $P['id'], $n ?: $P['key'] . ' Sprint ' . ((int) $c->fetchColumn() + 1), $str('goal', 500), $start, $fin, now()]);
            }
            ok(['sprint' => wkSprint($id, $P)]);

        case 'wk_sprint_start':
            $P = wkProj($str('proj', 20), $u);
            $S = wkSprint($str('id', 20), $P);
            if (!wkMayManage($P, $u)) {
                fail(403, 'forbidden', 'The project lead or an administrator starts a sprint.');
            }
            if ($S['st'] !== 'plan') {
                fail(409, 'conflict', 'That sprint has already started.');
            }
            if (wkActiveSprint($P['id'])) {
                fail(409, 'conflict', 'Finish the active sprint first.');
            }
            $q = $pdo->prepare('SELECT * FROM wk_item WHERE sprint = ?');
            $q->execute([$S['id']]);
            $in = array_map('wkItemRow', $q->fetchAll());
            if (!$in) {
                fail(400, 'invalid_argument', 'Put some work items in the sprint first.');
            }
            $usePts = count(array_filter($in, fn($i) => $i['pts'] !== null)) > 0;
            $start = $S['start'] !== '' ? $S['start'] : date('Y-m-d');
            $fin = $S['fin'] !== '' ? $S['fin'] : date('Y-m-d', (strtotime($start) ?: time()) + 13 * 86400);
            $data = ['committed' => wkSum($in, $usePts), 'unit' => $usePts ? 'points' : 'items', 'items' => array_column($in, 'id')];
            $pdo->prepare("UPDATE wk_sprint SET st = 'active', started = ?, start = ?, fin = ?, data = ? WHERE id = ?")->execute([now(), $start, $fin, json_encode($data), $S['id']]);
            foreach ($in as $i) {
                if ($i['who'] !== '') {
                    wkNote($i['who'], $i['id'], $S['n'] . ' started: ' . $P['key'] . '-' . $i['num'] . ' is yours.', $u['id']);
                }
            }
            ok(['sprint' => wkSprint($S['id'], $P)]);

        case 'wk_sprint_complete':
            // unfinished items go back to the backlog or into another planned sprint
            $P = wkProj($str('proj', 20), $u);
            $S = wkSprint($str('id', 20), $P);
            if (!wkMayManage($P, $u)) {
                fail(403, 'forbidden', 'The project lead or an administrator completes a sprint.');
            }
            if ($S['st'] !== 'active') {
                fail(409, 'conflict', 'Only the active sprint can be completed.');
            }
            $to = $str('to', 20);
            if ($to !== '') {
                $T = wkSprint($to, $P);
                if ($T['st'] !== 'plan') {
                    fail(400, 'invalid_argument', 'Carry the unfinished work into a planned sprint.');
                }
            }
            $done = wkDoneKeys($P);
            $q = $pdo->prepare('SELECT * FROM wk_item WHERE sprint = ?');
            $q->execute([$S['id']]);
            $in = array_map('wkItemRow', $q->fetchAll());
            $fin = array_values(array_filter($in, fn($i) => in_array($i['st'], $done, true)));
            $open = array_values(array_filter($in, fn($i) => !in_array($i['st'], $done, true)));
            $unit = (string) ($S['data']['unit'] ?? 'points');
            $data = $S['data'] + ['committed' => 0];
            $data['completed'] = wkSum($fin, $unit === 'points');
            $data['doneItems'] = array_column($fin, 'id');
            $data['carried'] = array_column($open, 'id');
            $data['carriedTo'] = $to;
            $pdo->beginTransaction();
            foreach ($open as $i) {
                $pdo->prepare('UPDATE wk_item SET sprint = ?, u = ? WHERE id = ?')->execute([$to, now(), $i['id']]);
                wkHist($i['id'], $P['id'], $u['id'], 'sprint', $S['id'], $to);
            }
            $pdo->prepare("UPDATE wk_sprint SET st = 'done', ended = ?, data = ? WHERE id = ?")->execute([now(), json_encode($data), $S['id']]);
            $pdo->commit();
            ok(['sprint' => wkSprint($S['id'], $P), 'carried' => count($open), 'completed' => $data['completed'], 'unit' => $unit]);

        case 'wk_sprint_delete':
            $P = wkProj($str('proj', 20), $u);
            $S = wkSprint($str('id', 20), $P);
            if (!wkMayManage($P, $u) || $S['st'] !== 'plan') {
                fail(409, 'conflict', 'Only a planned sprint can be removed, by the project lead or an administrator.');
            }
            $pdo->prepare("UPDATE wk_item SET sprint = '' WHERE sprint = ?")->execute([$S['id']]);
            $pdo->prepare('DELETE FROM wk_sprint WHERE id = ?')->execute([$S['id']]);
            ok(['ok' => true]);

        case 'wk_reports':
            $P = wkProj($str('id', 20), $u);
            ok(wkReports($P, $str('sprint', 20)));

        case 'wk_daily':
            // a day's stand-up: everyone's yesterday / today / blockers, and the open blocked items
            $P = wkProj($str('id', 20), $u);
            $day = $str('day', 10) ?: date('Y-m-d');
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $day)) {
                fail(400, 'invalid_argument', 'Pick a day.');
            }
            $q = $pdo->prepare('SELECT * FROM wk_daily WHERE proj = ? AND day = ? ORDER BY at');
            $q->execute([$P['id'], $day]);
            $bl = $pdo->prepare('SELECT * FROM wk_item WHERE proj = ? AND blocked = 1');
            $bl->execute([$P['id']]);
            $days = $pdo->prepare('SELECT day, COUNT(*) AS n FROM wk_daily WHERE proj = ? GROUP BY day ORDER BY day DESC LIMIT 30');
            $days->execute([$P['id']]);
            ok(['day' => $day, 'entries' => array_map(fn($x) => ['uid' => (string) $x['uid'], 'y' => (string) $x['y'], 't' => (string) $x['t'], 'b' => (string) $x['b'], 'at' => (int) $x['at']], $q->fetchAll()), 'blocked' => array_map('wkItemRow', $bl->fetchAll()), 'days' => array_map(fn($x) => ['day' => (string) $x['day'], 'n' => (int) $x['n']], $days->fetchAll()), 'people' => array_values(wkPeople($P['members']))]);

        case 'wk_daily_save':
            $P = wkProj($str('id', 20), $u);
            $day = date('Y-m-d');
            $y = $str('y', 2000);
            $t = $str('t', 2000);
            $bk = $str('b', 2000);
            if ($y === '' && $t === '' && $bk === '') {
                fail(400, 'invalid_argument', 'Write at least one line.');
            }
            $key = $P['id'] . ':' . $day . ':' . $u['id'];
            $pdo->prepare('DELETE FROM wk_daily WHERE id = ?')->execute([$key]);
            $pdo->prepare('INSERT INTO wk_daily (id, proj, day, uid, y, t, b, at) VALUES (?,?,?,?,?,?,?,?)')->execute([$key, $P['id'], $day, $u['id'], $y, $t, $bk, now()]);
            if ($bk !== '' && $P['lead'] !== $u['id']) {
                wkNote($P['lead'], '', $u['name'] . ' has a blocker in ' . $P['key'] . ': ' . mb_substr($bk, 0, 200), $u['id']);
            }
            ok(['ok' => true]);

        case 'wk_retro':
            $P = wkProj($str('id', 20), $u);
            $S = wkSprint($str('sprint', 20), $P);
            $q = $pdo->prepare('SELECT * FROM wk_retro WHERE sprint = ? ORDER BY at');
            $q->execute([$S['id']]);
            $list = array_map(fn($x) => ['id' => (string) $x['id'], 'kind' => (string) $x['kind'], 'txt' => (string) $x['txt'], 'who' => (string) $x['who'], 'votes' => json_decode((string) ($x['votes'] ?? ''), true) ?: [], 'item' => (string) $x['item'], 'at' => (int) $x['at']], $q->fetchAll());
            ok(['sprint' => $S, 'notes' => $list, 'people' => array_values(wkPeople($P['members']))]);

        case 'wk_retro_save':
            $P = wkProj($str('id', 20), $u);
            $S = wkSprint($str('sprint', 20), $P);
            $act = $str('act', 8);
            if ($act === 'add') {
                $kind = in_array($b['kind'] ?? '', ['good', 'bad', 'try'], true) ? (string) $b['kind'] : 'good';
                $txt = $str('txt', 600);
                if ($txt === '') {
                    fail(400, 'invalid_argument', 'Write the note.');
                }
                $pdo->prepare("INSERT INTO wk_retro (id, sprint, proj, kind, txt, who, votes, item, at) VALUES (?,?,?,?,?,?,'[]','',?)")->execute([rid(9), $S['id'], $P['id'], $kind, $txt, $u['id'], now()]);
                ok(['ok' => true]);
            }
            $q = $pdo->prepare('SELECT * FROM wk_retro WHERE id = ? AND sprint = ?');
            $q->execute([$str('note', 20), $S['id']]);
            $N = $q->fetch();
            if (!$N) {
                fail(404, 'not_found', 'No such note.');
            }
            if ($act === 'vote') {
                $v = json_decode((string) ($N['votes'] ?? ''), true) ?: [];
                $v = in_array($u['id'], $v, true) ? array_values(array_diff($v, [$u['id']])) : array_merge($v, [$u['id']]);
                $pdo->prepare('UPDATE wk_retro SET votes = ? WHERE id = ?')->execute([json_encode($v), $N['id']]);
                ok(['votes' => $v]);
            }
            if ($act === 'del') {
                if ((string) $N['who'] !== $u['id'] && !wkMayManage($P, $u)) {
                    fail(403, 'forbidden', 'Only whoever wrote it removes it.');
                }
                $pdo->prepare('DELETE FROM wk_retro WHERE id = ?')->execute([$N['id']]);
                ok(['ok' => true]);
            }
            if ($act === 'item') {
                // an improvement to try becomes a work item in the backlog
                if ((string) $N['item'] !== '') {
                    fail(409, 'conflict', 'It is a work item already.');
                }
                $pdo->beginTransaction();
                $pdo->prepare('UPDATE wk_proj SET seq = seq + 1 WHERE id = ?')->execute([$P['id']]);
                $q2 = $pdo->prepare('SELECT seq FROM wk_proj WHERE id = ?');
                $q2->execute([$P['id']]);
                $num = (int) $q2->fetchColumn();
                $iid = 'w' . rid(9);
                $now = now();
                $pdo->prepare("INSERT INTO wk_item (id, proj, num, type, title, descr, st, rk, pts, prio, who, due, labels, epic, sprint, checklist, blocked, bwhy, at, by_uid, u, st_at, start_at, done_at) VALUES (?,?,?,'task',?,?,?,?,NULL,'medium','','','[\"retro\"]','','','[]',0,'',?,?,?,?,0,0)")->execute([$iid, $P['id'], $num, mb_substr((string) $N['txt'], 0, 300), 'From the retrospective of ' . $S['n'] . '.', $P['cols'][0]['k'], wkLastRank($P['id']), $now, $u['id'], $now, $now]);
                $pdo->prepare('UPDATE wk_retro SET item = ? WHERE id = ?')->execute([$iid, $N['id']]);
                $pdo->commit();
                wkHist($iid, $P['id'], $u['id'], 'new', '', (string) $N['txt']);
                ok(['item' => $iid, 'num' => $num]);
            }
            fail(400, 'invalid_argument', 'Unknown action.');

        case 'wk_mine':
            // My work: what is assigned to me across projects (not done), and my notes
            $s = $pdo->prepare('SELECT i.*, p.pkey, p.n AS pn, p.cols FROM wk_item i JOIN wk_proj p ON p.id = i.proj WHERE i.who = ? AND p.arch = 0 ORDER BY i.due = \'\', i.due, i.rk');
            $s->execute([$u['id']]);
            $mine = [];
            foreach ($s->fetchAll() as $row) {
                $cols = json_decode((string) $row['cols'], true) ?: [];
                $doneK = array_column(array_filter($cols, fn($c) => !empty($c['done'])), 'k');
                if (in_array((string) $row['st'], $doneK, true)) {
                    continue;
                }
                $i = wkItemRow($row);
                $i['key'] = (string) $row['pkey'];
                $i['pn'] = (string) $row['pn'];
                $i['stn'] = (string) (array_values(array_filter($cols, fn($c) => $c['k'] === $i['st']))[0]['n'] ?? $i['st']);
                $mine[] = $i;
            }
            $n = $pdo->prepare('SELECT * FROM wk_note WHERE uid = ? ORDER BY at DESC LIMIT 60');
            $n->execute([$u['id']]);
            $notes = array_map(fn($x) => ['id' => (string) $x['id'], 'at' => (int) $x['at'], 'item' => (string) $x['item'], 'txt' => (string) $x['txt'], 'seen' => (int) $x['seen'] === 1], $n->fetchAll());
            if (!empty($b['seen'])) {
                $pdo->prepare('UPDATE wk_note SET seen = 1 WHERE uid = ?')->execute([$u['id']]);
            }
            ok(['items' => $mine, 'notes' => $notes]);
    }
    fail(404, 'not_found', 'Unknown action.');
}
