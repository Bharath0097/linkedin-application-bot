<?php
declare(strict_types=1);
/*
 * v67 Start-readiness and buyer dependency tracker (CC-13).
 *
 * Every selected candidate gets a start plan: the planned start date, a checklist built from the account's own template
 * (each item owned by StratEdge, the consultant or the company; some items block the start), the confirmations the
 * account requires (StratEdge, the consultant, the company's hiring manager) and the plan's history. A supplied item is
 * checked by its reviewer before it counts as done. The start date is confirmed only once every required party has
 * confirmed it and no blocking item is open; a revised date keeps the earlier plan versions and asks for the
 * confirmations again. StratEdge records the actual first day and the 30- and 90-day check-ins, which the scorecard
 * reads (confirmed and on-time starts, early retention). Blocking items carry a recovery action.
 *
 * Tables (main database): cr_stcfg (the account's template and required parties), cr_start (one plan per selected
 * candidate; its history is in cr_ev with kind 'st').
 */

require_once __DIR__ . '/corpdd.php';

const ST_SIDE = ['stratedge' => 'StratEdge', 'consultant' => 'The consultant', 'client' => 'The company'];
const ST_PARTY = ['stratedge' => 'StratEdge (account owner)', 'consultant' => 'The consultant', 'client' => 'The company (hiring manager)'];
const ST_ST = ['planned' => 'Planned', 'confirmed' => 'Start confirmed', 'started' => 'Started', 'cancelled' => 'Cancelled'];
const ST_ITEM_ST = ['open' => 'Open', 'supplied' => 'Supplied, to be checked', 'done' => 'Done', 'blocked' => 'Blocked'];
/** The default template: [text, responsible side, blocks the start, needs a reviewer's check after it is supplied]. */
const ST_TPL = [
    ['Agreed terms recorded: rate, dates, engagement model, notice', 'stratedge', true, false],
    ['Consultant confirmed the start date and the terms in writing', 'consultant', true, true],
    ['Background check, I-9 or work authorization and paperwork complete', 'stratedge', true, false],
    ['Onboarding approval at the company (purchase order, work order or ticket)', 'client', true, true],
    ['Manager ready: team told, first week planned', 'client', false, false],
    ['Equipment and system access requested and working on day one', 'client', true, false],
    ['First-day instructions sent: where, when, whom to meet', 'client', false, false],
];
const ST_REQ = ['stratedge', 'consultant', 'client'];
const ST_CHECKINS = [30, 90];

function stDb(): PDO
{
    static $ready = false;
    $p = db();
    if (!$ready) {
        $ready = true;
        $p->exec('CREATE TABLE IF NOT EXISTS cr_stcfg (cid VARCHAR(40) PRIMARY KEY, data TEXT NOT NULL, u BIGINT NOT NULL)');
        $p->exec("CREATE TABLE IF NOT EXISTS cr_start (id VARCHAR(20) PRIMARY KEY, sl VARCHAR(20) NOT NULL, req VARCHAR(20) NOT NULL, cid VARCHAR(40) NOT NULL, st VARCHAR(12) NOT NULL, planned VARCHAR(10) NOT NULL DEFAULT '', confirmed VARCHAR(10) NOT NULL DEFAULT '', actual VARCHAR(10) NOT NULL DEFAULT '', data TEXT NOT NULL, at BIGINT NOT NULL, u BIGINT NOT NULL, confirmed_at BIGINT NOT NULL DEFAULT 0, started_at BIGINT NOT NULL DEFAULT 0)");
        $p->exec('CREATE UNIQUE INDEX IF NOT EXISTS cr_start_sl ON cr_start (sl)');
        $p->exec('CREATE INDEX IF NOT EXISTS cr_start_cid ON cr_start (cid, st)');
    }
    return $p;
}
/** The account's template and required parties. */
function stCfg(string $cid, bool $fresh = false): array
{
    static $memo = [];
    if (!$fresh && isset($memo[$cid])) {
        return $memo[$cid];
    }
    $s = stDb()->prepare('SELECT data FROM cr_stcfg WHERE cid = ?');
    $s->execute([$cid]);
    $d = json_decode((string) ($s->fetchColumn() ?: '{}'), true) ?: [];
    $tpl = [];
    foreach ((array) ($d['tpl'] ?? ST_TPL) as $x) {
        $x = array_values((array) $x);
        $text = mb_substr(trim((string) ($x[0] ?? '')), 0, 200);
        $side = (string) ($x[1] ?? 'client');
        if ($text !== '' && isset(ST_SIDE[$side])) {
            $tpl[] = [$text, $side, !empty($x[2]), !empty($x[3])];
        }
    }
    $req = array_values(array_filter(array_map('strval', (array) ($d['req'] ?? ST_REQ)), fn($p) => isset(ST_PARTY[$p])));
    return $memo[$cid] = ['tpl' => $tpl ?: array_map(fn($x) => $x, ST_TPL), 'req' => $req ?: ST_REQ, 'custom' => isset($d['tpl']), 'by' => (string) ($d['by'] ?? ''), 'at' => (int) ($d['at'] ?? 0)];
}
function stRow(string $id): ?array
{
    $s = stDb()->prepare('SELECT * FROM cr_start WHERE id = ?');
    $s->execute([$id]);
    $r = $s->fetch();
    if (!$r) {
        return null;
    }
    $r['data'] = json_decode((string) $r['data'], true) ?: [];
    return $r;
}
function stRowBySl(string $sl): ?array
{
    $s = stDb()->prepare('SELECT id FROM cr_start WHERE sl = ?');
    $s->execute([$sl]);
    $id = (string) $s->fetchColumn();
    return $id !== '' ? stRow($id) : null;
}
function stSet(string $id, array $f): void
{
    $f['u'] = now();
    if (isset($f['data'])) {
        $f['data'] = json_encode($f['data']);
    }
    $sets = implode(', ', array_map(fn($k) => "$k = ?", array_keys($f)));
    stDb()->prepare("UPDATE cr_start SET $sets WHERE id = ?")->execute([...array_values($f), $id]);
}
/** The plan of a selected candidate, made from the account's template the first time it is asked for. */
function stPlanFor(array $sl, array $q): array
{
    $r = stRowBySl((string) $sl['id']);
    if ($r) {
        return $r;
    }
    $cfg = stCfg((string) $q['cid']);
    $items = [];
    foreach ($cfg['tpl'] as $i => [$text, $side, $blocking, $review]) {
        $items[] = ['id' => 'i' . ($i + 1), 'text' => $text, 'side' => $side, 'blocking' => $blocking, 'review' => $review, 'st' => 'open', 'due' => '', 'note' => '', 'by' => '', 'at' => 0, 'recovery' => '', 'recoveryOwner' => ''];
    }
    $planned = (string) ($q['data']['sd'] ?? '');
    $avail = (string) ($sl['data']['avail']['from'] ?? '');
    if ($planned === '' || ($avail !== '' && $avail > $planned)) {
        $planned = $avail !== '' ? $avail : $planned;
    }
    $id = rid(7);
    $d = ['items' => $items, 'conf' => [], 'versions' => [['planned' => $planned, 'reason' => 'From the request' . ($avail !== '' && $avail === $planned && $avail !== (string) ($q['data']['sd'] ?? '') ? ' and the consultant\'s availability' : ''), 'by' => 'StratEdge', 'at' => now()]], 'checkins' => [], 'req' => $cfg['req']];
    stDb()->prepare("INSERT INTO cr_start (id, sl, req, cid, st, planned, data, at, u) VALUES (?,?,?,?,'planned',?,?,?,?)")->execute([$id, (string) $sl['id'], (string) $q['id'], (string) $q['cid'], $planned, json_encode($d), now(), now()]);
    return stRow($id);
}
/** Is the start ready to be confirmed: every required party confirmed the current date, no blocking item open. */
function stReady(array $r): array
{
    $d = $r['data'];
    $missing = [];
    foreach ((array) ($d['req'] ?? ST_REQ) as $party) {
        if (empty($d['conf'][$party])) {
            $missing[] = $party;
        }
    }
    $blocking = [];
    foreach ((array) ($d['items'] ?? []) as $it) {
        if (!empty($it['blocking']) && (string) $it['st'] !== 'done') {
            $blocking[] = $it;
        }
    }
    return [!$missing && !$blocking, $missing, $blocking];
}
function stView(array $r, array $u, bool $staff, ?array $acc): array
{
    require_once __DIR__ . '/corpsl.php';
    $sl = slRow((string) $r['sl']);
    $q = crReqRow((string) $r['req']);
    $d = $r['data'];
    [$ready, $missing, $blocking] = stReady($r);
    $st = (string) $r['st'];
    $hm = (string) ($q['data']['mgre'] ?? '');
    $isMgr = !$staff && $q && $hm !== '' && strcasecmp($hm, (string) $u['email']) === 0;
    $clientW = !$staff && $acc && caReqOk($acc, $q ?: ['data' => []], 'w');
    $can = [
        'item' => in_array($st, ['planned', 'confirmed'], true),
        'confirmStratedge' => $staff && in_array($st, ['planned'], true) && empty($d['conf']['stratedge']),
        'confirmConsultant' => $staff && in_array($st, ['planned'], true) && empty($d['conf']['consultant']),
        'confirmClient' => !$staff && $st === 'planned' && empty($d['conf']['client']) && ($isMgr || $clientW),
        'revise' => in_array($st, ['planned', 'confirmed'], true) && ($staff || $clientW),
        'started' => $staff && $st === 'confirmed',
        'checkin' => $staff && $st === 'started',
        'cancel' => $staff && in_array($st, ['planned', 'confirmed'], true),
        'addItem' => in_array($st, ['planned', 'confirmed'], true) && ($staff || $clientW),
    ];
    $items = array_map(fn($it) => $it + ['sideN' => ST_SIDE[(string) $it['side']] ?? $it['side'], 'stN' => ST_ITEM_ST[(string) $it['st']] ?? $it['st']], (array) ($d['items'] ?? []));
    return [
        'id' => (string) $r['id'], 'sl' => (string) $r['sl'], 'req' => (string) $r['req'], 'reqTi' => $q ? (string) $q['ti'] : '', 'cid' => (string) $r['cid'], 'co' => crCompanyName((string) $r['cid']),
        'alias' => $sl ? (string) $sl['alias'] : '', 'st' => $st, 'stN' => ST_ST[$st] ?? $st, 'planned' => (string) $r['planned'], 'confirmed' => (string) $r['confirmed'], 'actual' => (string) $r['actual'],
        'confirmedAt' => (int) $r['confirmed_at'], 'startedAt' => (int) $r['started_at'], 'at' => (int) $r['at'], 'u' => (int) $r['u'],
        'items' => $items, 'conf' => (array) ($d['conf'] ?? []), 'req' => array_values((array) ($d['req'] ?? ST_REQ)), 'versions' => array_values((array) ($d['versions'] ?? [])), 'checkins' => (array) ($d['checkins'] ?? []), 'cancel' => $d['cancel'] ?? null,
        'ready' => $ready, 'missing' => $missing, 'blocking' => array_map(fn($x) => ['id' => $x['id'], 'text' => $x['text'], 'side' => $x['side']], $blocking),
        'sides' => ST_SIDE, 'parties' => ST_PARTY, 'itemSt' => ST_ITEM_ST, 'hiringMgr' => (string) ($q['data']['mgr'] ?? ''), 'isMgr' => $isMgr, 'can' => $can,
        'openIssues' => stOpenIssues((string) $r['req'], (string) $r['cid']),
    ];
}
/** Open issues on the delivery desk that affect a start, for this request. */
function stOpenIssues(string $req, string $cid): int
{
    $s = ddDb()->prepare("SELECT COUNT(*) FROM cr_issue WHERE cid = ? AND req = ? AND st <> 'closed'");
    $s->execute([$cid, $req]);
    return (int) $s->fetchColumn();
}
/** The start plans of a company: for the desk and the scorecard. */
function stPlans(string $cid): array
{
    $s = stDb()->prepare('SELECT * FROM cr_start WHERE cid = ? ORDER BY planned');
    $s->execute([$cid]);
    return array_map(function ($r) {
        $r['data'] = json_decode((string) $r['data'], true) ?: [];
        return $r;
    }, $s->fetchAll());
}
/** The start measures of a period (by the confirmed date): confirmed, on time, delays by the responsible side, first-day issues. */
function stMeasures(string $cid, int $start, int $end): array
{
    $out = ['plans' => 0, 'confirmed' => 0, 'started' => 0, 'onTime' => 0, 'late' => 0, 'delaysBy' => ['stratedge' => 0, 'consultant' => 0, 'client' => 0], 'revised' => 0, 'cancelled' => 0, 'firstDayIssues' => 0];
    foreach (stPlans($cid) as $r) {
        $date = (string) ($r['confirmed'] !== '' ? $r['confirmed'] : $r['planned']);
        $ms = $date !== '' ? (int) (strtotime($date . ' 12:00:00') * 1000) : 0;
        if ($ms < $start || $ms >= $end) {
            continue;
        }
        $out['plans']++;
        $st = (string) $r['st'];
        if (in_array($st, ['confirmed', 'started'], true)) {
            $out['confirmed']++;
        }
        if ($st === 'started') {
            $out['started']++;
            if ((string) $r['actual'] !== '' && (string) $r['confirmed'] !== '' && (string) $r['actual'] <= (string) $r['confirmed']) {
                $out['onTime']++;
            } else {
                $out['late']++;
            }
        }
        if ($st === 'cancelled') {
            $out['cancelled']++;
        }
        $vers = (array) ($r['data']['versions'] ?? []);
        if (count($vers) > 1) {
            $out['revised']++;
            $last = end($vers);
            $side = (string) ($last['side'] ?? '');
            if (isset($out['delaysBy'][$side])) {
                $out['delaysBy'][$side]++;
            }
        }
        $out['firstDayIssues'] += stOpenIssues((string) $r['req'], $cid);
    }
    return $out;
}

/** The start routes (cr_st_*). */
function stRoute(string $r, array $b, array $u, bool $staff, array $myC): never
{
    require_once __DIR__ . '/corpsl.php';
    $str = fn(string $k, int $max) => mb_substr(trim((string) ($b[$k] ?? '')), 0, $max);
    if ($r === 'cr_st_cfg') {
        // the account's template and required parties (StratEdge)
        if (!$staff) {
            fail(403, 'forbidden', 'StratEdge keeps the start checklist of an account.');
        }
        $cid = $str('cid', 40);
        if (!docGet('org/admin/clients/' . $cid)) {
            fail(404, 'not_found', 'No such client company.');
        }
        if (isset($b['tpl']) || isset($b['req'])) {
            $cur = stCfg($cid, true);
            $tpl = [];
            if (isset($b['tpl'])) {
                foreach (array_slice((array) $b['tpl'], 0, 40) as $x) {
                    $x = (array) $x;
                    $text = mb_substr(trim((string) ($x['text'] ?? ($x[0] ?? ''))), 0, 200);
                    $side = (string) ($x['side'] ?? ($x[1] ?? 'client'));
                    if ($text === '' || !isset(ST_SIDE[$side])) {
                        continue;
                    }
                    $tpl[] = [$text, $side, !empty($x['blocking'] ?? ($x[2] ?? false)), !empty($x['review'] ?? ($x[3] ?? false))];
                }
                if (!$tpl) {
                    fail(400, 'invalid_argument', 'Keep at least one item on the checklist.');
                }
            } else {
                $tpl = $cur['tpl'];
            }
            $req = isset($b['req']) ? array_values(array_filter(array_map('strval', (array) $b['req']), fn($p) => isset(ST_PARTY[$p]))) : $cur['req'];
            if (!$req) {
                fail(400, 'invalid_argument', 'At least one party confirms a start.');
            }
            stDb()->prepare('REPLACE INTO cr_stcfg (cid, data, u) VALUES (?,?,?)')->execute([$cid, json_encode(['tpl' => $tpl, 'req' => $req, 'by' => (string) $u['name'], 'at' => now()]), now()]);
            audit('client', 'Start checklist changed', crCompanyName($cid), ['items' => count($tpl), 'req' => $req], $u);
        }
        ok(['cfg' => stCfg($cid, true), 'sides' => ST_SIDE, 'parties' => ST_PARTY, 'dflt' => ST_TPL]);
    }
    // every other route works on one plan, reached by its shortlist entry (the candidate) or its id
    $sl = null;
    $q = null;
    if ($str('id', 20) !== '') {
        $row = stRow($str('id', 20));
        if (!$row) {
            fail(404, 'not_found', 'No such start plan.');
        }
        $sl = slRow((string) $row['sl']);
    } else {
        $sl = slRow($str('sl', 20));
    }
    if (!$sl) {
        fail(404, 'not_found', 'No such candidate.');
    }
    $q = crReqFor((string) $sl['req'], $u); // 404 outside the contact's reach (v64)
    if ((string) $sl['st'] !== 'selected' && !stRowBySl((string) $sl['id'])) {
        fail(409, 'conflict', 'A start plan is for a selected candidate.');
    }
    $cid = (string) $q['cid'];
    $acc = $staff ? null : caAccess($u, $cid);
    if ($acc && !caMay($acc, 'shortlist')) {
        fail(404, 'not_found', 'No such candidate.');
    }
    $co = crCompanyName($cid);
    $row = stPlanFor($sl, $q);
    $id = (string) $row['id'];
    $d = $row['data'];
    $view = fn() => stView(stRow($id), $u, $staff, $acc);
    $evs = function () use ($id, $staff): array {
        $s = crDb()->prepare("SELECT * FROM cr_ev WHERE kind = 'st' AND ref = ?" . ($staff ? '' : ' AND vis = 1') . ' ORDER BY at');
        $s->execute([$id]);
        return array_map(fn($e) => ['at' => (int) $e['at'], 'byn' => (string) $e['byn'], 'side' => (string) $e['side'], 'ev' => (string) $e['ev'], 'msg' => (string) $e['msg']], $s->fetchAll());
    };
    $side = $staff ? 'staff' : 'client';
    $who = (string) $sl['alias'];
    $tellClient = function () use ($q, $cid): array {
        // the requester and the hiring manager (if a contact), within the request's reach
        $to = [(string) $q['by_uid']];
        $hm = (string) ($q['data']['mgre'] ?? '');
        if ($hm !== '') {
            foreach (crContacts($cid) as $uid => $c) {
                if (strcasecmp((string) $c['e'], $hm) === 0) {
                    $to[] = (string) $uid;
                }
            }
        }
        return caFilter($cid, array_values(array_unique($to)), 'shortlist', 'r', (string) ($q['data']['unit'] ?? ''));
    };
    $maybeConfirm = function () use ($id, $u, $who, $co, $tellClient, $cid) {
        $r = stRow($id);
        [$ready] = stReady($r);
        if ($ready && (string) $r['st'] === 'planned') {
            stSet($id, ['st' => 'confirmed', 'confirmed' => (string) $r['planned'], 'confirmed_at' => now()]);
            crEv('st', $id, $u, 'system', 'confirmed', 'Start confirmed for ' . $r['planned'] . ': every required party confirmed it and nothing blocks it.');
            crMail(array_values(array_unique(array_merge($tellClient(), ddStaffToTell($cid)))), 'Start confirmed: ' . $who . ' on ' . $r['planned'], [$who . ' starts at ' . $co . ' on ' . $r['planned'] . '. Every required confirmation is recorded and no checklist item blocks the start.'], 'start', (string) $r['sl']);
            return true;
        }
        return false;
    };
    switch ($r) {
        case 'cr_st_get':
            ok(['plan' => $view(), 'evs' => $evs()]);

        case 'cr_st_item':
            // an item: done (by its side, or StratEdge), supplied (then checked by the reviewer), blocked with a recovery action, reopened; a note; a due date
            $v = $view();
            if (!$v['can']['item']) {
                fail(409, 'conflict', 'The checklist is closed (' . strtolower($v['stN']) . ').');
            }
            $iid = $str('iid', 12);
            $act = (string) ($b['act'] ?? '');
            $note = $str('note', 1000);
            $found = null;
            foreach ($d['items'] as $i => $it) {
                if ((string) $it['id'] === $iid) {
                    $found = $i;
                }
            }
            if ($found === null) {
                fail(404, 'not_found', 'No such item.');
            }
            $it = $d['items'][$found];
            $mine = $staff || ((string) $it['side'] === 'client' && $acc && caReqOk($acc, $q, 'w'));
            $msg = '';
            switch ($act) {
                case 'done':
                    if (!$mine) {
                        fail(403, 'forbidden', 'This item is ' . strtolower(ST_SIDE[(string) $it['side']]) . '\'s to do.');
                    }
                    if (!empty($it['review']) && !$staff) {
                        // the company supplies; StratEdge checks it before it counts
                        $it['st'] = 'supplied';
                        $msg = $u['name'] . ' supplied "' . $it['text'] . '"' . ($note !== '' ? ': ' . $note : '') . '. StratEdge checks it.';
                    } else {
                        $it['st'] = 'done';
                        $msg = $u['name'] . ' marked "' . $it['text'] . '" done' . ($note !== '' ? ': ' . $note : '') . '.';
                    }
                    $it['recovery'] = '';
                    $it['recoveryOwner'] = '';
                    break;
                case 'approve':
                    if (!$staff || (string) $it['st'] !== 'supplied') {
                        fail(409, 'conflict', 'StratEdge checks an item once it was supplied.');
                    }
                    $it['st'] = 'done';
                    $msg = $u['name'] . ' checked "' . $it['text'] . '": done' . ($note !== '' ? ' (' . $note . ')' : '') . '.';
                    break;
                case 'return':
                    if (!$staff || (string) $it['st'] !== 'supplied' || $note === '') {
                        fail(400, 'invalid_argument', 'Say what is missing.');
                    }
                    $it['st'] = 'open';
                    $msg = $u['name'] . ' returned "' . $it['text'] . '": ' . $note;
                    break;
                case 'block':
                    $rec = $str('recovery', 500);
                    if ($note === '' || $rec === '') {
                        fail(400, 'invalid_argument', 'Say what blocks it and the recovery action.');
                    }
                    $it['st'] = 'blocked';
                    $it['recovery'] = $rec;
                    $it['recoveryOwner'] = $str('owner', 120) ?: (string) $u['name'];
                    $msg = $u['name'] . ' flagged "' . $it['text'] . '" as blocked: ' . $note . ' Recovery: ' . $rec . ' (' . $it['recoveryOwner'] . ').';
                    break;
                case 'reopen':
                    if (!$mine && (string) $it['st'] !== 'blocked') {
                        fail(403, 'forbidden', 'This item is ' . strtolower(ST_SIDE[(string) $it['side']]) . '\'s.');
                    }
                    $it['st'] = 'open';
                    $msg = $u['name'] . ' reopened "' . $it['text'] . '"' . ($note !== '' ? ': ' . $note : '') . '.';
                    break;
                case 'due':
                    $due = $str('due', 10);
                    if ($due !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $due)) {
                        fail(400, 'invalid_argument', 'Give the date as YYYY-MM-DD.');
                    }
                    $it['due'] = $due;
                    $msg = $u['name'] . ' set "' . $it['text'] . '" due ' . ($due !== '' ? $due : 'whenever') . '.';
                    break;
                case 'note':
                    if ($note === '') {
                        fail(400, 'invalid_argument', 'Write the note.');
                    }
                    $msg = $u['name'] . ' on "' . $it['text'] . '": ' . $note;
                    break;
                default:
                    fail(400, 'invalid_argument', 'Unknown action.');
            }
            if ($note !== '' && $act !== 'note') {
                $it['note'] = $note;
            }
            $it['by'] = (string) $u['name'];
            $it['at'] = now();
            $d['items'][$found] = $it;
            stSet($id, ['data' => $d]);
            crEv('st', $id, $u, $side, 'item', $msg);
            if ($act === 'block' || ($act === 'done' && $it['st'] === 'supplied')) {
                crMail($staff ? $tellClient() : ddStaffToTell($cid), ($act === 'block' ? 'Start blocked: ' : 'Supplied, please check: ') . $who . ' (' . $co . ')', [$msg], 'start', (string) $sl['id']);
            }
            $maybeConfirm();
            ok(['plan' => $view(), 'evs' => $evs()]);

        case 'cr_st_add':
            // an item of the plan's own (the account's needs, not a universal list)
            $v = $view();
            if (!$v['can']['addItem']) {
                fail(403, 'forbidden', 'StratEdge and the company\'s hiring side add items while the start is planned.');
            }
            $text = $str('text', 200);
            $sd = (string) ($b['side'] ?? ($staff ? 'stratedge' : 'client'));
            if (mb_strlen($text) < 3 || !isset(ST_SIDE[$sd])) {
                fail(400, 'invalid_argument', 'Say what has to be done and whose it is.');
            }
            if (!$staff && $sd !== 'client') {
                fail(403, 'forbidden', 'The company adds items for its own side.');
            }
            $n = count($d['items']) + 1;
            $d['items'][] = ['id' => 'x' . rid(3), 'text' => $text, 'side' => $sd, 'blocking' => !empty($b['blocking']), 'review' => false, 'st' => 'open', 'due' => preg_match('/^\d{4}-\d{2}-\d{2}$/', $str('due', 10)) ? $str('due', 10) : '', 'note' => '', 'by' => '', 'at' => 0, 'recovery' => '', 'recoveryOwner' => ''];
            stSet($id, ['data' => $d]);
            crEv('st', $id, $u, $side, 'item', $u['name'] . ' added "' . $text . '" (' . ST_SIDE[$sd] . (!empty($b['blocking']) ? ', blocks the start' : '') . ').');
            ok(['plan' => $view(), 'evs' => $evs()]);

        case 'cr_st_confirm':
            // a party confirms the planned date: StratEdge for itself and for the consultant (with the evidence); the company's hiring manager (or anyone who writes requests) for the company
            $party = $str('party', 12);
            $v = $view();
            $okParty = ($party === 'stratedge' && $v['can']['confirmStratedge']) || ($party === 'consultant' && $v['can']['confirmConsultant']) || ($party === 'client' && $v['can']['confirmClient']);
            if (!$okParty) {
                fail(409, 'conflict', isset(ST_PARTY[$party]) ? (empty($d['conf'][$party]) ? 'That confirmation is not yours to record, or the start is not planned.' : ST_PARTY[$party] . ' already confirmed ' . $row['planned'] . '.') : 'Choose who confirms.');
            }
            $note = $str('note', 500);
            if ($party === 'consultant' && mb_strlen($note) < 5) {
                fail(400, 'invalid_argument', 'Record how the consultant confirmed (for example: "email of Oct 7").');
            }
            $d['conf'][$party] = ['by' => $u['id'], 'n' => (string) $u['name'], 'at' => now(), 'note' => $note, 'date' => (string) $row['planned']];
            stSet($id, ['data' => $d]);
            crEv('st', $id, $u, $side, 'confirm', ST_PARTY[$party] . ' confirmed ' . $row['planned'] . ' (recorded by ' . $u['name'] . ($note !== '' ? ': ' . $note : '') . ').');
            if (!$maybeConfirm()) {
                [, $missing, $blocking] = stReady(stRow($id));
                crMail($staff ? $tellClient() : ddStaffToTell($cid), 'Start confirmation: ' . $who . ' on ' . $row['planned'], [ST_PARTY[$party] . ' confirmed the start on ' . $row['planned'] . '.', ($missing ? 'Still to confirm: ' . implode(', ', array_map(fn($p) => ST_PARTY[$p], $missing)) . '.' : '') . ($blocking ? ' Blocking: ' . implode('; ', array_map(fn($x) => $x['text'], $blocking)) . '.' : '')], 'start', (string) $sl['id']);
            }
            ok(['plan' => $view(), 'evs' => $evs()]);

        case 'cr_st_revise':
            // a new planned date with its reason and the side it comes from; the earlier versions stay; confirmations of the old date are asked again
            $v = $view();
            if (!$v['can']['revise']) {
                fail(409, 'conflict', 'The start date is revised while the start is planned or confirmed.');
            }
            $date = $str('date', 10);
            $why = $str('why', 500);
            $sd = (string) ($b['side'] ?? ($staff ? 'stratedge' : 'client'));
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || strtotime($date) === false) {
                fail(400, 'invalid_argument', 'Give the new date as YYYY-MM-DD.');
            }
            if ($date === (string) $row['planned']) {
                fail(400, 'invalid_argument', 'That is the planned date already.');
            }
            if (mb_strlen($why) < 5 || !isset(ST_SIDE[$sd])) {
                fail(400, 'invalid_argument', 'Say why the date moves and whose side it comes from.');
            }
            if (!$staff && $sd !== 'client') {
                fail(403, 'forbidden', 'The company records its own reasons.');
            }
            $old = (string) $row['planned'];
            $d['versions'][] = ['planned' => $date, 'from' => $old, 'reason' => $why, 'side' => $sd, 'by' => (string) $u['name'], 'at' => now()];
            $d['conf'] = [];
            stSet($id, ['planned' => $date, 'confirmed' => '', 'confirmed_at' => 0, 'st' => 'planned', 'data' => $d]);
            crEv('st', $id, $u, $side, 'revised', 'Start moved from ' . $old . ' to ' . $date . ' (' . ST_SIDE[$sd] . '): ' . $why . ' Confirmations are asked again.');
            crMail(array_values(array_unique(array_merge($tellClient(), ddStaffToTell($cid)))), 'Start date revised: ' . $who . ' now ' . $date, [$u['name'] . ' moved the start of ' . $who . ' at ' . $co . ' from ' . $old . ' to ' . $date . ' (' . ST_SIDE[$sd] . '): ' . $why, 'Every required party confirms the new date on the start plan.'], 'start', (string) $sl['id']);
            audit('client', 'Start date revised', $co, ['plan' => $id, 'from' => $old, 'to' => $date, 'side' => $sd], $u);
            ok(['plan' => $view(), 'evs' => $evs()]);

        case 'cr_st_started':
            $v = $view();
            if (!$v['can']['started']) {
                fail(409, 'conflict', 'A confirmed start is recorded as started (by StratEdge).');
            }
            $date = $str('date', 10) ?: (string) $row['confirmed'];
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || strtotime($date) === false) {
                fail(400, 'invalid_argument', 'Give the first day as YYYY-MM-DD.');
            }
            if ($date > date('Y-m-d')) {
                fail(400, 'invalid_argument', 'The first day is today or earlier.');
            }
            stSet($id, ['st' => 'started', 'actual' => $date, 'started_at' => now()]);
            crEv('st', $id, $u, 'staff', 'started', $who . ' started on ' . $date . ($date === (string) $row['confirmed'] ? ' as confirmed.' : ' (confirmed: ' . $row['confirmed'] . ').') . ($str('note', 500) !== '' ? ' ' . $str('note', 500) : ''));
            audit('client', 'Start recorded', $co, ['plan' => $id, 'actual' => $date, 'confirmed' => (string) $row['confirmed']], $u);
            ok(['plan' => $view(), 'evs' => $evs()]);

        case 'cr_st_checkin':
            $v = $view();
            if (!$v['can']['checkin']) {
                fail(409, 'conflict', 'Check-ins are recorded by StratEdge once the person started.');
            }
            $day = (int) ($b['day'] ?? 0);
            if (!in_array($day, ST_CHECKINS, true)) {
                fail(400, 'invalid_argument', 'Check-ins are at 30 and 90 days.');
            }
            $ok = !empty($b['ok']);
            $note = $str('note', 500);
            if (!$ok && $note === '') {
                fail(400, 'invalid_argument', 'Say what happened.');
            }
            $d['checkins'][(string) $day] = ['ok' => $ok, 'by' => (string) $u['name'], 'at' => now(), 'note' => $note];
            stSet($id, ['data' => $d]);
            crEv('st', $id, $u, 'staff', 'checkin', $day . '-day check-in: ' . ($ok ? 'still on assignment' : 'no longer on assignment') . ($note !== '' ? ' (' . $note . ')' : '') . '.');
            ok(['plan' => $view(), 'evs' => $evs()]);

        case 'cr_st_cancel':
            $v = $view();
            if (!$v['can']['cancel']) {
                fail(409, 'conflict', 'A planned or confirmed start is cancelled by StratEdge.');
            }
            $why = $str('why', 500);
            if (mb_strlen($why) < 5) {
                fail(400, 'invalid_argument', 'Say why.');
            }
            $d['cancel'] = ['why' => $why, 'by' => (string) $u['name'], 'at' => now()];
            stSet($id, ['st' => 'cancelled', 'data' => $d]);
            crEv('st', $id, $u, 'staff', 'cancelled', 'Start cancelled: ' . $why);
            crMail($tellClient(), 'Start cancelled: ' . $who . ' (' . $co . ')', [$u['name'] . ' cancelled the start of ' . $who . ': ' . $why], 'start', (string) $sl['id']);
            audit('client', 'Start cancelled', $co, ['plan' => $id, 'why' => $why], $u);
            ok(['plan' => $view(), 'evs' => $evs()]);
    }
    fail(404, 'not_found', 'Unknown request.');
}
