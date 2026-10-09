<?php
declare(strict_types=1);
/*
 * v66 Account performance and business reviews (CC-11, the basic agreed reporting).
 *
 * A scorecard per client company and period, computed from the portal's own records with every metric's clock,
 * population, denominator and treatment of holds written down beside it: time to the first shared candidate after
 * approval, time to the company's decision, interview outcomes (an interview request is not a placement), selected
 * candidates with a start in the period (a confirmed start is not recorded by the portal: shown as unknown), early
 * retention (not recorded: unknown), issue handling (the delivery desk), and the volume. Outcomes that are not known
 * yet are counted as unknown, never as failures; a period with few cases says so instead of posing as a benchmark.
 * Each metric lists the requests or candidates behind it, within what the reader may see (v64 roles and units).
 *
 * Business reviews: StratEdge prepares one for a period (the scorecard is kept as it stood, with the previous period
 * beside it), records decisions and improvement actions (owner, due date; open ones carry over as commitments), shares
 * it with the company, whose people leave feedback (a rating and words); then closes it.
 *
 * Table (main database): cr_review.
 */

require_once __DIR__ . '/corpdd.php';

const RV_ST = ['draft' => 'Being prepared', 'shared' => 'Shared with the company', 'closed' => 'Closed'];
const RV_FEW = 5;
const RV_METRICS = [
    'tts' => ['Time to the first shared candidate', 'Calendar days from a request\'s first approval to the first candidate shared on its shortlist, median. Population: requests first approved in the period. Days the request spent on hold are taken out. Requests approved but without a shared candidate yet are unknown, not slow.'],
    'ttd' => ['Time to the company\'s decision', 'Calendar days from StratEdge confirming a brief to the company\'s approval, median. Population: requests confirmed in the period. Requests still waiting are unknown.'],
    'iv' => ['Interview outcomes', 'Candidates shared in the period: how many were asked to interview, selected, declined, and how many are still open (unknown). An interview request is not a placement; selected is the company\'s decision, not a start.'],
    'starts' => ['Confirmed starts', 'Start plans whose confirmed date (else planned date) falls in the period: confirmed once every required party confirmed it and nothing blocked it; started on time when the first day is on or before the confirmed date. A selected candidate without a confirmed start is unknown, not a failure.'],
    'ret' => ['Early retention', 'People who started, still on assignment at the 30-day check-in (and the 90-day one), as recorded by StratEdge. A check-in that is due but not recorded is unknown.'],
    'issues' => ['Questions and issues', 'Raised in the period on the delivery desk: acknowledged and resolved within the agreed targets (working time), escalated, sent back by the company.'],
];

function rvDb(): PDO
{
    static $ready = false;
    $p = db();
    if (!$ready) {
        $ready = true;
        $p->exec("CREATE TABLE IF NOT EXISTS cr_review (id VARCHAR(20) PRIMARY KEY, cid VARCHAR(40) NOT NULL, st VARCHAR(12) NOT NULL, ti VARCHAR(160) NOT NULL, p_start BIGINT NOT NULL, p_end BIGINT NOT NULL, data TEXT NOT NULL, by_uid VARCHAR(40) NOT NULL, at BIGINT NOT NULL, u BIGINT NOT NULL, shared_at BIGINT NOT NULL DEFAULT 0, closed_at BIGINT NOT NULL DEFAULT 0)");
        $p->exec('CREATE INDEX IF NOT EXISTS cr_review_cid ON cr_review (cid, st)');
    }
    return $p;
}
function rvRow(string $id): ?array
{
    $s = rvDb()->prepare('SELECT * FROM cr_review WHERE id = ?');
    $s->execute([$id]);
    $r = $s->fetch();
    if (!$r) {
        return null;
    }
    $r['data'] = json_decode((string) $r['data'], true) ?: [];
    return $r;
}
function rvSet(string $id, array $f): void
{
    $f['u'] = now();
    if (isset($f['data'])) {
        $f['data'] = json_encode($f['data']);
    }
    $sets = implode(', ', array_map(fn($k) => "$k = ?", array_keys($f)));
    rvDb()->prepare("UPDATE cr_review SET $sets WHERE id = ?")->execute([...array_values($f), $id]);
}
function rvMedian(array $xs): ?float
{
    if (!$xs) {
        return null;
    }
    sort($xs);
    $n = count($xs);
    return $n % 2 ? (float) $xs[intdiv($n, 2)] : ($xs[$n / 2 - 1] + $xs[$n / 2]) / 2;
}
/** Milliseconds a request spent on hold between two moments (from its hold/resumed events). */
function rvHoldMs(string $req, int $from, int $to): int
{
    $s = crDb()->prepare("SELECT at, ev FROM cr_ev WHERE kind = 'req' AND ref = ? AND ev IN ('hold', 'resumed') ORDER BY at");
    $s->execute([$req]);
    $ms = 0;
    $open = null;
    foreach ($s->fetchAll() as $e) {
        if ((string) $e['ev'] === 'hold') {
            $open = (int) $e['at'];
        } elseif ($open !== null) {
            $ms += max(0, min((int) $e['at'], $to) - max($open, $from));
            $open = null;
        }
    }
    if ($open !== null) {
        $ms += max(0, $to - max($open, $from));
    }
    return $ms;
}
/**
 * The scorecard of a company for [$start, $end): every metric with its value, sample size, exclusions and the records
 * behind it. $acc limits the records to what a contact may see (null for staff).
 */
function rvScorecard(string $cid, int $start, int $end, ?array $acc): array
{
    $p = crDb();
    require_once __DIR__ . '/corpsl.php';
    $sl = slDb();
    $day = 86400000;
    $reqOk = fn(array $r) => !$acc || caReqOk($acc, $r);
    $reqs = [];
    foreach ($p->query('SELECT * FROM cr_req WHERE cid = ' . $p->quote($cid) . " AND st <> 'draft'")->fetchAll() as $r) {
        $r['data'] = json_decode((string) $r['data'], true) ?: [];
        $r['appr'] = json_decode((string) $r['appr'], true) ?: [];
        $reqs[(string) $r['id']] = $r;
    }
    $few = fn(int $n) => $n < RV_FEW;
    $ref = fn(array $r) => ['id' => (string) $r['id'], 'ti' => (string) $r['ti']];
    $out = [];

    // ---- time to the first shared candidate (from the first approval)
    $firstApv = [];
    if ($reqs) {
        $s = $p->prepare('SELECT req, MIN(apv_at) AS a FROM cr_ver WHERE apv_at > 0 AND req IN (' . implode(',', array_map(fn($id) => $p->quote($id), array_keys($reqs))) . ') GROUP BY req');
        $s->execute();
        foreach ($s->fetchAll() as $x) {
            $firstApv[(string) $x['req']] = (int) $x['a'];
        }
    }
    $firstShared = [];
    if ($reqs) {
        $s = $sl->prepare('SELECT req, MIN(shared_at) AS a FROM cr_sl WHERE shared_at > 0 AND ver > 0 AND req IN (' . implode(',', array_map(fn($id) => $sl->quote($id), array_keys($reqs))) . ') GROUP BY req');
        $s->execute();
        foreach ($s->fetchAll() as $x) {
            $firstShared[(string) $x['req']] = (int) $x['a'];
        }
    }
    $days = [];
    $items = [];
    $unknown = [];
    $excl = [];
    foreach ($reqs as $id => $r) {
        $a = $firstApv[$id] ?? 0;
        if ($a < $start || $a >= $end) {
            continue;
        }
        if (!$reqOk($r)) {
            $excl[] = 'a request outside your business units';
            continue;
        }
        if (in_array((string) $r['st'], ['cancelled'], true) && !isset($firstShared[$id])) {
            $excl[] = $r['ti'] . ' (cancelled before a candidate was shared)';
            continue;
        }
        if (isset($firstShared[$id])) {
            $hold = rvHoldMs($id, $a, $firstShared[$id]);
            $d = max(0, ($firstShared[$id] - $a - $hold) / $day);
            $days[] = round($d, 1);
            $items[] = $ref($r) + ['days' => round($d, 1), 'hold' => $hold > 0 ? round($hold / $day, 1) : 0];
        } else {
            $unknown[] = $ref($r) + ['waiting' => round((now() - $a) / $day, 1)];
        }
    }
    $out['tts'] = ['value' => rvMedian($days), 'unit' => 'days', 'n' => count($days), 'few' => $few(count($days)), 'items' => $items, 'unknown' => $unknown, 'excluded' => array_values(array_unique($excl))];

    // ---- time to the company's decision (confirmation -> approval)
    $days = [];
    $items = [];
    $unknown = [];
    $excl = [];
    foreach ($reqs as $id => $r) {
        $s = $p->prepare("SELECT MIN(at) FROM cr_ev WHERE kind = 'req' AND ref = ? AND ev = 'confirmed'");
        $s->execute([$id]);
        $c = (int) $s->fetchColumn();
        if ($c < $start || $c >= $end) {
            continue;
        }
        if (!$reqOk($r)) {
            $excl[] = 'a request outside your business units';
            continue;
        }
        $a = $firstApv[$id] ?? 0;
        if ($a > 0) {
            $hold = rvHoldMs($id, $c, $a);
            $d = max(0, ($a - $c - $hold) / $day);
            $days[] = round($d, 1);
            $items[] = $ref($r) + ['days' => round($d, 1)];
        } elseif (in_array((string) $r['st'], ['cancelled'], true)) {
            $excl[] = $r['ti'] . ' (withdrawn before a decision)';
        } else {
            $unknown[] = $ref($r) + ['waiting' => round((now() - $c) / $day, 1)];
        }
    }
    $out['ttd'] = ['value' => rvMedian($days), 'unit' => 'days', 'n' => count($days), 'few' => $few(count($days)), 'items' => $items, 'unknown' => $unknown, 'excluded' => array_values(array_unique($excl))];

    // ---- interview outcomes: candidates shared in the period
    $cnt = ['shared' => 0, 'interview' => 0, 'selected' => 0, 'declined' => 0, 'open' => 0];
    $items = [];
    $excl = [];
    $s = $sl->prepare('SELECT * FROM cr_sl WHERE cid = ? AND shared_at >= ? AND shared_at < ? AND ver > 0');
    $s->execute([$cid, $start, $end]);
    foreach ($s->fetchAll() as $c) {
        $r = $reqs[(string) $c['req']] ?? null;
        if (!$r) {
            continue;
        }
        if (!$reqOk($r)) {
            $excl[] = 'candidates of requests outside your business units';
            continue;
        }
        $intv = json_decode((string) $c['intv'], true) ?: [];
        $dec = json_decode((string) $c['dec'], true) ?: [];
        $st = (string) $c['st'];
        $cnt['shared']++;
        $interviewed = $st === 'interview' || $intv || (string) ($dec['d'] ?? '') === 'interview';
        if ($interviewed) {
            $cnt['interview']++;
        }
        if ($st === 'selected') {
            $cnt['selected']++;
        } elseif ($st === 'declined') {
            $cnt['declined']++;
        } elseif (in_array($st, ['shared', 'question', 'interview', 'hold'], true)) {
            $cnt['open']++;
        }
        $items[] = ['id' => (string) $c['id'], 'alias' => (string) $c['alias'], 'req' => (string) $r['id'], 'reqTi' => (string) $r['ti'], 'st' => $st, 'interviewed' => $interviewed];
    }
    $out['iv'] = ['value' => $cnt['shared'] ? round(100 * $cnt['interview'] / $cnt['shared']) : null, 'unit' => '% interviewed', 'counts' => $cnt, 'n' => $cnt['shared'], 'few' => $few($cnt['shared']), 'items' => $items, 'unknown' => $cnt['open'], 'excluded' => array_values(array_unique($excl))];

    // ---- v67: confirmed starts in the period (from the start plans), and early retention (from the check-ins)
    require_once __DIR__ . '/corpst.php';
    $items = [];
    $excl = [];
    $unknown = [];
    $confirmed = 0;
    $onTime = 0;
    $started = 0;
    $retItems = [];
    $retOk = 0;
    $retN = 0;
    $retUnknown = [];
    $plans = stPlans($cid);
    $selectedWithout = [];
    foreach ($plans as $pl) {
        $r = $reqs[(string) $pl['req']] ?? null;
        if (!$r) {
            continue;
        }
        $date = (string) ($pl['confirmed'] !== '' ? $pl['confirmed'] : $pl['planned']);
        $ms = $date !== '' ? (int) (strtotime($date . ' 12:00:00') * 1000) : 0;
        $pst = (string) $pl['st'];
        $alias = (string) (slRow((string) $pl['sl'])['alias'] ?? '');
        if ($ms >= $start && $ms < $end) {
            if (!$reqOk($r)) {
                $excl[] = 'starts of requests outside your business units';
            } elseif (in_array($pst, ['confirmed', 'started'], true)) {
                $confirmed++;
                $ok = $pst === 'started' && (string) $pl['actual'] !== '' && (string) $pl['actual'] <= (string) $pl['confirmed'];
                if ($pst === 'started') {
                    $started++;
                }
                if ($ok) {
                    $onTime++;
                }
                $items[] = ['id' => (string) $pl['id'], 'alias' => $alias, 'req' => (string) $r['id'], 'reqTi' => (string) $r['ti'], 'sd' => $date, 'confirmed' => true, 'st' => $pst === 'started' ? ($ok ? 'started on time' : 'started ' . $pl['actual'] . ' (confirmed ' . $pl['confirmed'] . ')') : 'confirmed'];
            } elseif ($pst === 'planned') {
                $unknown[] = ['id' => (string) $pl['id'], 'ti' => $alias . ' (' . (string) $r['ti'] . ')', 'waiting' => round((now() - (int) $pl['at']) / $day, 1)];
            } else {
                $excl[] = $alias . ' (start cancelled)';
            }
        }
        // retention: started people whose 30-day check-in is due
        if ($pst === 'started' && (string) $pl['actual'] !== '' && $reqOk($r)) {
            $due30 = (int) (strtotime((string) $pl['actual'] . ' +30 days 12:00:00') * 1000);
            if ($due30 >= $start && $due30 < $end) {
                $c30 = $pl['data']['checkins']['30'] ?? null;
                if ($c30) {
                    $retN++;
                    if (!empty($c30['ok'])) {
                        $retOk++;
                    }
                    $retItems[] = ['id' => (string) $pl['id'], 'alias' => $alias, 'reqTi' => (string) $r['ti'], 'st' => (!empty($c30['ok']) ? 'still on assignment at 30 days' : 'ended before 30 days') . (isset($pl['data']['checkins']['90']) ? (!empty($pl['data']['checkins']['90']['ok']) ? ', still at 90' : ', ended before 90') : '')];
                } elseif ($due30 <= now()) {
                    $retUnknown[] = ['id' => (string) $pl['id'], 'ti' => $alias . ' (' . (string) $r['ti'] . ')', 'waiting' => round((now() - $due30) / $day, 1)];
                }
            }
        }
    }
    $out['starts'] = ['value' => $confirmed, 'unit' => 'confirmed', 'counts' => ['confirmed' => $confirmed, 'started' => $started, 'onTime' => $onTime], 'n' => $confirmed, 'few' => $few($confirmed), 'items' => $items, 'unknown' => $unknown, 'unknownWhy' => count($unknown) ? 'selected, start not yet confirmed' : '', 'excluded' => array_values(array_unique($excl))];
    $out['ret'] = ['value' => $retN ? round(100 * $retOk / $retN) : null, 'unit' => '% still at 30 days', 'n' => $retN, 'few' => $few($retN), 'items' => $retItems, 'unknown' => $retUnknown, 'unknownWhy' => count($retUnknown) ? '30-day check-in due, not recorded' : '', 'excluded' => []];

    // ---- issues raised in the period
    $dd = ddCfg($cid);
    $s = ddDb()->prepare('SELECT * FROM cr_issue WHERE cid = ? AND at >= ? AND at < ?');
    $s->execute([$cid, $start, $end]);
    $ic = ['raised' => 0, 'ackN' => 0, 'ackOk' => 0, 'resN' => 0, 'resOk' => 0, 'escalated' => 0, 'reopened' => 0, 'open' => 0];
    $items = [];
    foreach ($s->fetchAll() as $it) {
        $it['data'] = json_decode((string) $it['data'], true) ?: [];
        if ($acc && (string) $it['req'] !== '' && (string) $it['by_uid'] !== ($acc['uid'] ?? '')) {
            $r = $reqs[(string) $it['req']] ?? null;
            if ($r && !caUnitOk($acc, (string) ($r['data']['unit'] ?? ''))) {
                continue;
            }
        }
        $t = ddTargets($it, $dd);
        $ic['raised']++;
        if ((int) $it['ack_at'] > 0) {
            $ic['ackN']++;
            if ((int) $it['ack_at'] <= $t['ackBy']) {
                $ic['ackOk']++;
            }
        }
        if ((int) $it['res_at'] > 0) {
            $ic['resN']++;
            if ((int) $it['res_at'] <= $t['resBy']) {
                $ic['resOk']++;
            }
        }
        if ((int) $it['esc'] > 0) {
            $ic['escalated']++;
        }
        if (!empty($it['data']['reopenAt'])) {
            $ic['reopened']++;
        }
        if ((string) $it['st'] !== 'closed') {
            $ic['open']++;
        }
        $items[] = ['id' => (string) $it['id'], 'ti' => (string) $it['ti'], 'st' => (string) $it['st'], 'impact' => (string) $it['impact']];
    }
    $out['issues'] = ['value' => $ic['ackN'] ? round(100 * $ic['ackOk'] / $ic['ackN']) : null, 'unit' => '% acknowledged in time', 'counts' => $ic, 'n' => $ic['raised'], 'few' => $few($ic['raised']), 'items' => $items, 'unknown' => $ic['open'], 'excluded' => []];

    // ---- volume
    $vol = ['sent' => 0, 'approved' => 0, 'closed' => 0, 'shared' => $cnt['shared']];
    foreach ($reqs as $id => $r) {
        if (!$reqOk($r)) {
            continue;
        }
        if ((int) $r['at'] >= $start && (int) $r['at'] < $end) {
            $vol['sent']++;
        }
        if (isset($firstApv[$id]) && $firstApv[$id] >= $start && $firstApv[$id] < $end) {
            $vol['approved']++;
        }
        if (in_array((string) $r['st'], ['filled', 'cancelled'], true) && (int) $r['u'] >= $start && (int) $r['u'] < $end) {
            $vol['closed']++;
        }
    }
    $out['volume'] = $vol;
    $out['period'] = ['start' => $start, 'end' => $end, 'days' => (int) round(($end - $start) / $day)];
    return $out;
}
/** The two periods side by side: the one asked for and the one of the same length before it. */
function rvCompare(string $cid, int $start, int $end, ?array $acc): array
{
    $len = $end - $start;
    return ['cur' => rvScorecard($cid, $start, $end, $acc), 'prev' => rvScorecard($cid, $start - $len, $start, $acc), 'defs' => RV_METRICS, 'few' => RV_FEW];
}
function rvView(array $r, bool $staff, ?array $acc = null, bool $withAgenda = true): array
{
    $d = $r['data'];
    $agenda = $withAgenda ? ($d['agenda'] ?? null) : null;
    $commit = array_values((array) ($d['commitments'] ?? []));
    if (!$staff) {
        // v83: actions of a review still being prepared are StratEdge's until it is shared
        $drafts = rvDraftIds((string) $r['cid']);
        $commit = array_values(array_filter($commit, fn($c) => !in_array((string) ($c['review'] ?? ''), $drafts, true)));
        // v83: the stored scorecard is StratEdge's, unfiltered: a contact limited to business units reads it within their units
        if ($agenda !== null && (!$acc || $acc['units'])) {
            $agenda = $acc ? rvCompare((string) $r['cid'], (int) $r['p_start'], (int) $r['p_end'], $acc) : null;
        }
    }
    return [
        'id' => (string) $r['id'], 'cid' => (string) $r['cid'], 'co' => crCompanyName((string) $r['cid']), 'st' => (string) $r['st'], 'stN' => RV_ST[(string) $r['st']] ?? (string) $r['st'], 'ti' => (string) $r['ti'],
        'start' => (int) $r['p_start'], 'end' => (int) $r['p_end'], 'at' => (int) $r['at'], 'u' => (int) $r['u'], 'sharedAt' => (int) $r['shared_at'], 'closedAt' => (int) $r['closed_at'], 'byN' => (string) (userRow((string) $r['by_uid'])['name'] ?? ''),
        'agenda' => $agenda, 'notes' => (string) ($d['notes'] ?? ''), 'decisions' => array_values((array) ($d['decisions'] ?? [])), 'actions' => array_values((array) ($d['actions'] ?? [])),
        'feedback' => array_values((array) ($d['feedback'] ?? [])), 'commitments' => $commit,
    ];
}
/** The ids of the company's reviews still being prepared (hidden from its contacts). */
function rvDraftIds(string $cid): array
{
    $s = rvDb()->prepare("SELECT id FROM cr_review WHERE cid = ? AND st = 'draft'");
    $s->execute([$cid]);
    return array_map('strval', $s->fetchAll(PDO::FETCH_COLUMN));
}
/** Improvement actions still open from earlier reviews of the company (the commitments a new review carries). */
function rvOpenActions(string $cid, string $except = '', bool $drafts = true): array
{
    $out = [];
    // v83: the company's contacts do not see the actions of a review StratEdge is still preparing
    $s = rvDb()->prepare('SELECT * FROM cr_review WHERE cid = ?' . ($drafts ? '' : " AND st <> 'draft'") . ' ORDER BY p_start');
    $s->execute([$cid]);
    foreach ($s->fetchAll() as $r) {
        if ((string) $r['id'] === $except) {
            continue;
        }
        $d = json_decode((string) $r['data'], true) ?: [];
        foreach ((array) ($d['actions'] ?? []) as $a) {
            if (($a['st'] ?? 'open') !== 'done') {
                $out[] = $a + ['review' => (string) $r['id'], 'reviewTi' => (string) $r['ti']];
            }
        }
    }
    return $out;
}

/** The review routes (cr_rv_*). */
function rvRoute(string $r, array $b, array $u, bool $staff, array $myC): never
{
    $str = fn(string $k, int $max) => mb_substr(trim((string) ($b[$k] ?? '')), 0, $max);
    $cid = $str('cid', 40);
    $row = null;
    if (in_array($r, ['cr_rv_get', 'cr_rv_save', 'cr_rv_act'], true) && $str('id', 20) !== '') {
        $row = rvRow($str('id', 20));
        if (!$row || (!$staff && !in_array((string) $row['cid'], $myC, true))) {
            fail(404, 'not_found', 'No such review.');
        }
        $cid = (string) $row['cid'];
    }
    if (!$staff && !in_array($cid, $myC, true)) {
        $cid = $myC[0] ?? '';
    }
    if ($cid === '' || !docGet('org/admin/clients/' . $cid) || (!$staff && !in_array($cid, $myC, true))) {
        fail(404, 'not_found', 'No such client company.');
    }
    $acc = $staff ? null : caAccess($u, $cid) + ['uid' => $u['id']];
    if ($acc && !caMay($acc, 'reports')) {
        fail(403, 'forbidden', 'Your role at ' . crCompanyName($cid) . ' does not cover reports.');
    }
    $co = crCompanyName($cid);
    $day = 86400000;
    $period = function () use ($b, $day): array {
        $end = (int) ($b['end'] ?? 0);
        $start = (int) ($b['start'] ?? 0);
        if ($end <= 0) {
            $end = (int) (strtotime('tomorrow') * 1000);
        }
        if ($start <= 0) {
            $start = $end - 90 * $day;
        }
        if ($end - $start < $day || $end - $start > 400 * $day) {
            fail(400, 'invalid_argument', 'A period is between a day and about a year.');
        }
        return [$start, $end];
    };
    $list = function () use ($cid, $staff, $acc) {
        $s = rvDb()->prepare('SELECT * FROM cr_review WHERE cid = ?' . ($staff ? '' : " AND st <> 'draft'") . ' ORDER BY p_start DESC, at DESC LIMIT 100');
        $s->execute([$cid]);
        return array_map(function ($x) use ($staff, $acc) {
            $x['data'] = json_decode((string) $x['data'], true) ?: [];
            return rvView($x, $staff, $acc, $staff);
        }, $s->fetchAll());
    };
    switch ($r) {
        case 'cr_rv_home':
            // the live scorecard for a period (with the one before), the reviews of the company
            [$start, $end] = $period();
            $out = ['cid' => $cid, 'co' => $co, 'staff' => $staff, 'me' => $u['id'], 'score' => rvCompare($cid, $start, $end, $acc), 'reviews' => $list(), 'st' => RV_ST, 'open' => rvOpenActions($cid, '', $staff), 'manage' => $staff, 'mayFeedback' => !$staff];
            ok($out);

        case 'cr_rv_get':
            if (!$row || (!$staff && (string) $row['st'] === 'draft')) {
                fail(404, 'not_found', 'No such review.');
            }
            ok(['review' => rvView($row, $staff, $acc), 'open' => rvOpenActions($cid, (string) $row['id'], $staff), 'defs' => RV_METRICS, 'few' => RV_FEW, 'manage' => $staff, 'me' => $u['id']]);

        case 'cr_rv_save':
            // StratEdge prepares or updates a review: the period (the scorecard is kept as it stands), notes, decisions, actions
            if (!$staff) {
                fail(403, 'forbidden', 'StratEdge prepares business reviews; the company adds its feedback.');
            }
            if ($row && (string) $row['st'] === 'closed') {
                fail(409, 'conflict', 'A closed review is not changed; prepare the next one.');
            }
            $d = $row ? $row['data'] : [];
            if (!$row) {
                [$start, $end] = $period();
                $ti = $str('ti', 160) ?: 'Business review ' . gmdate('j M Y', (int) ($start / 1000)) . ' – ' . gmdate('j M Y', (int) ($end / 1000) - 1);
                $id = rid(7);
                $d['agenda'] = rvCompare($cid, $start, $end, null);
                $d['commitments'] = rvOpenActions($cid);
                $d['decisions'] = [];
                $d['actions'] = [];
                $d['feedback'] = [];
                $d['notes'] = '';
                rvDb()->prepare("INSERT INTO cr_review (id, cid, st, ti, p_start, p_end, data, by_uid, at, u) VALUES (?,?,'draft',?,?,?,?,?,?,?)")->execute([$id, $cid, $ti, $start, $end, json_encode($d), $u['id'], now(), now()]);
                $row = rvRow($id);
                audit('client', 'Business review prepared', $co, ['id' => $id, 'ti' => $ti], $u);
            }
            $id = (string) $row['id'];
            $f = [];
            if (array_key_exists('ti', $b) && $str('ti', 160) !== '') {
                $f['ti'] = $str('ti', 160);
            }
            if (array_key_exists('notes', $b)) {
                $d['notes'] = $str('notes', 6000);
            }
            if (!empty($b['refresh'])) {
                // the scorecard as it stands now (a draft only)
                $d['agenda'] = rvCompare($cid, (int) $row['p_start'], (int) $row['p_end'], null);
            }
            if (isset($b['decision']) && $str('decision', 1000) !== '') {
                $d['decisions'][] = ['text' => $str('decision', 1000), 'by' => (string) $u['name'], 'at' => now()];
            }
            if (isset($b['action']) && is_array($b['action'])) {
                $a = $b['action'];
                $text = mb_substr(trim((string) ($a['text'] ?? '')), 0, 500);
                if (mb_strlen($text) < 5) {
                    fail(400, 'invalid_argument', 'Say what will be done.');
                }
                $d['actions'][] = ['id' => rid(5), 'text' => $text, 'owner' => mb_substr(trim((string) ($a['owner'] ?? '')), 0, 120), 'due' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($a['due'] ?? '')) ? (string) $a['due'] : '', 'st' => 'open', 'at' => now(), 'by' => (string) $u['name']];
            }
            $f['data'] = $d;
            rvSet($id, $f);
            ok(['review' => rvView(rvRow($id), true), 'open' => rvOpenActions($cid, $id)]);

        case 'cr_rv_act':
            if (!$row || (!$staff && (string) $row['st'] === 'draft')) {
                fail(404, 'not_found', 'No such review.');
            }
            $id = (string) $row['id'];
            $act = (string) ($b['act'] ?? '');
            $d = $row['data'];
            $st = (string) $row['st'];
            switch ($act) {
                case 'share':
                    if (!$staff || $st !== 'draft') {
                        fail(409, 'conflict', 'StratEdge shares a review it is preparing.');
                    }
                    rvSet($id, ['st' => 'shared', 'shared_at' => now()]);
                    $full = caFilter($cid, array_keys(crContacts($cid)), 'reports');
                    crMail($full, 'Business review: ' . $row['ti'], [$u['name'] . ' shared the business review "' . $row['ti'] . '" for ' . $co . ': the scorecard for the period, the decisions and the improvement actions. Please read it and leave your feedback.'], 'rv', $id);
                    audit('client', 'Business review shared', $co, ['id' => $id], $u);
                    break;
                case 'close':
                    if (!$staff || $st === 'closed') {
                        fail(409, 'conflict', 'StratEdge closes a review once it was held.');
                    }
                    rvSet($id, ['st' => 'closed', 'closed_at' => now()]);
                    audit('client', 'Business review closed', $co, ['id' => $id], $u);
                    break;
                case 'action':
                    // an improvement action is done (or open again); StratEdge, or the company on a shared review
                    if ($st === 'closed' && !$staff) {
                        fail(409, 'conflict', 'This review is closed.');
                    }
                    $aid = $str('aid', 10);
                    $found = false;
                    foreach ($d['actions'] as &$a) {
                        if ((string) ($a['id'] ?? '') === $aid) {
                            $a['st'] = !empty($b['done']) ? 'done' : 'open';
                            $a['doneAt'] = !empty($b['done']) ? now() : 0;
                            $a['doneBy'] = !empty($b['done']) ? (string) $u['name'] : '';
                            $found = true;
                        }
                    }
                    unset($a);
                    if (!$found && !$staff && !in_array($aid, array_map(fn($c) => (string) ($c['id'] ?? ''), rvView($row, false, null, false)['commitments']), true)) {
                        // v83: the company marks the actions and commitments of the review it reads, nothing else
                        fail(404, 'not_found', 'No such action.');
                    }
                    if (!$found) {
                        // an action carried from an earlier review lives there
                        $s = rvDb()->prepare('SELECT * FROM cr_review WHERE cid = ?' . ($staff ? '' : " AND st <> 'draft'"));
                        $s->execute([$cid]);
                        foreach ($s->fetchAll() as $x) {
                            $xd = json_decode((string) $x['data'], true) ?: [];
                            $hit = false;
                            $acts = (array) ($xd['actions'] ?? []);
                            foreach ($acts as &$a) {
                                if ((string) ($a['id'] ?? '') === $aid) {
                                    $a['st'] = !empty($b['done']) ? 'done' : 'open';
                                    $a['doneAt'] = !empty($b['done']) ? now() : 0;
                                    $a['doneBy'] = !empty($b['done']) ? (string) $u['name'] : '';
                                    $hit = true;
                                }
                            }
                            unset($a);
                            if ($hit) {
                                $xd['actions'] = array_values($acts);
                                rvSet((string) $x['id'], ['data' => $xd]);
                                $found = true;
                            }
                        }
                    } else {
                        rvSet($id, ['data' => $d]);
                    }
                    if (!$found) {
                        fail(404, 'not_found', 'No such action.');
                    }
                    break;
                case 'feedback':
                    // the company's people: a rating and words, once each per review (a later one replaces theirs)
                    if ($staff || $st !== 'shared') {
                        fail(409, 'conflict', 'Feedback is the company\'s, on a shared review.');
                    }
                    $rating = (int) ($b['rating'] ?? 0);
                    $text = $str('msg', 3000);
                    if ($rating < 1 || $rating > 5) {
                        fail(400, 'invalid_argument', 'Rate the period from 1 to 5.');
                    }
                    $d['feedback'] = array_values(array_filter((array) ($d['feedback'] ?? []), fn($x) => (string) ($x['uid'] ?? '') !== $u['id']));
                    $d['feedback'][] = ['uid' => $u['id'], 'by' => (string) $u['name'], 'rating' => $rating, 'text' => $text, 'at' => now()];
                    rvSet($id, ['data' => $d]);
                    crMail(ddStaffToTell($cid), 'Feedback on the business review: ' . $row['ti'], [$u['name'] . ' at ' . $co . ' rated the period ' . $rating . ' of 5.', $text !== '' ? $text : '(no words)'], 'rv', $id);
                    audit('client', 'Business review feedback', $co, ['id' => $id, 'rating' => $rating], $u);
                    break;
                default:
                    fail(400, 'invalid_argument', 'Unknown action.');
            }
            ok(['review' => rvView(rvRow($id), $staff, $acc), 'open' => rvOpenActions($cid, $id, $staff)]);
    }
    fail(404, 'not_found', 'Unknown request.');
}
