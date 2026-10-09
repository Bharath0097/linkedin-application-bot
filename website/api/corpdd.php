<?php
declare(strict_types=1);
/*
 * v65 Client delivery and escalation desk (CC-10).
 *
 * One page for a client company: who owns the account at StratEdge (and who covers when they are away), the agreed
 * working hours and response targets (proposed by StratEdge, agreed by the company: never advertised as agreed before),
 * what waits for the company's decision, the active requests with their next step, interviews in progress, agreed starts
 * (and a start date that changed since approval), and the questions and issues the company raised: each with an impact,
 * an acknowledgement, an owner, a planned action and target, progress, a proposed resolution with its evidence, and the
 * company's confirmation. An acknowledged issue stays open until the company confirms the resolution. An issue nobody
 * acknowledged within the target is escalated to the owner and the backup, then to HR and administrators. Measures for
 * StratEdge: unowned items, acknowledgement and resolution within target, overdue buyer decisions, repeat issues, start
 * exceptions, with the account's volume beside them.
 *
 * Tables (main database): cr_dd (one row per company: the desk's settings), cr_issue (the issues); their history is in
 * cr_ev with kind 'iss' (the column holds four characters).
 */

const DD_KIND = ['question' => 'Question', 'issue' => 'Issue', 'change' => 'Change to an agreed start'];
const DD_IMPACT = ['low' => 'Low: a question, nothing waits on it', 'medium' => 'Medium: slows work down', 'high' => 'High: blocks an interview or a start', 'critical' => 'Critical: an engagement stopped or a contractual matter'];
const DD_ST = ['open' => 'Raised', 'ack' => 'Acknowledged', 'working' => 'In progress', 'resolved' => 'Resolution proposed', 'closed' => 'Resolved and confirmed', 'reopened' => 'Reopened'];
const DD_OPEN = ['open', 'ack', 'working', 'resolved', 'reopened'];
/** Proposed targets per impact: [working hours to acknowledge, working days to resolve]. */
const DD_GOALS = ['low' => [8, 5], 'medium' => [4, 3], 'high' => [2, 1], 'critical' => [1, 1]];
const DD_HOURS = ['tz' => 'America/New_York', 'days' => [1, 2, 3, 4, 5], 'from' => '09:00', 'to' => '18:00'];
/** A buyer decision counts as overdue after this many days without an answer. */
const DD_DECISION_DAYS = 5;

function ddDb(): PDO
{
    static $ready = false;
    $p = db();
    if (!$ready) {
        $ready = true;
        $p->exec('CREATE TABLE IF NOT EXISTS cr_dd (cid VARCHAR(40) PRIMARY KEY, data TEXT NOT NULL, u BIGINT NOT NULL)');
        $p->exec("CREATE TABLE IF NOT EXISTS cr_issue (id VARCHAR(20) PRIMARY KEY, cid VARCHAR(40) NOT NULL, req VARCHAR(20) NOT NULL DEFAULT '', by_uid VARCHAR(40) NOT NULL, side VARCHAR(8) NOT NULL DEFAULT 'client', kind VARCHAR(12) NOT NULL, impact VARCHAR(12) NOT NULL, st VARCHAR(12) NOT NULL, owner VARCHAR(40) NOT NULL DEFAULT '', ti VARCHAR(160) NOT NULL, data TEXT NOT NULL, at BIGINT NOT NULL, u BIGINT NOT NULL, ack_at BIGINT NOT NULL DEFAULT 0, res_at BIGINT NOT NULL DEFAULT 0, closed_at BIGINT NOT NULL DEFAULT 0, esc INT NOT NULL DEFAULT 0)");
        $p->exec('CREATE INDEX IF NOT EXISTS cr_issue_cid ON cr_issue (cid, st)');
    }
    return $p;
}
/** The desk's settings of a company: backup owner, away notice, working hours, response targets and their agreement. */
function ddCfg(string $cid, bool $fresh = false): array
{
    static $memo = [];
    if (!$fresh && isset($memo[$cid])) {
        return $memo[$cid];
    }
    $s = ddDb()->prepare('SELECT data FROM cr_dd WHERE cid = ?');
    $s->execute([$cid]);
    $d = json_decode((string) ($s->fetchColumn() ?: '{}'), true) ?: [];
    $h = (array) ($d['hours'] ?? []);
    $goals = [];
    foreach (DD_GOALS as $k => [$a, $r]) {
        $g = (array) ($d['goals'][$k] ?? []);
        $goals[$k] = [max(1, min(240, (int) ($g[0] ?? $a))), max(1, min(60, (int) ($g[1] ?? $r)))];
    }
    return $memo[$cid] = [
        'backup' => (string) ($d['backup'] ?? ''),
        'away' => ['until' => (int) ($d['away']['until'] ?? 0), 'note' => (string) ($d['away']['note'] ?? '')],
        'hours' => ['tz' => ddTz((string) ($h['tz'] ?? DD_HOURS['tz'])), 'days' => array_values(array_filter(array_map('intval', (array) ($h['days'] ?? DD_HOURS['days'])), fn($x) => $x >= 0 && $x <= 6)) ?: DD_HOURS['days'], 'from' => ddClock((string) ($h['from'] ?? DD_HOURS['from']), DD_HOURS['from']), 'to' => ddClock((string) ($h['to'] ?? DD_HOURS['to']), DD_HOURS['to'])],
        'goals' => $goals,
        'goalsSt' => ($d['goalsSt'] ?? '') === 'agreed' ? 'agreed' : 'proposed',
        'goalsBy' => (string) ($d['goalsBy'] ?? ''), 'goalsAt' => (int) ($d['goalsAt'] ?? 0), 'goalsVer' => (int) ($d['goalsVer'] ?? 1),
        'proposedBy' => (string) ($d['proposedBy'] ?? ''), 'proposedAt' => (int) ($d['proposedAt'] ?? 0),
    ];
}
function ddSaveCfg(string $cid, array $d): void
{
    ddDb()->prepare('REPLACE INTO cr_dd (cid, data, u) VALUES (?,?,?)')->execute([$cid, json_encode($d), now()]);
    ddCfg($cid, true);
}
function ddTz(string $tz): string
{
    return in_array($tz, timezone_identifiers_list(), true) ? $tz : DD_HOURS['tz'];
}
function ddClock(string $v, string $dflt): string
{
    return preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $v) ? $v : $dflt;
}
/** Who owns the account now: the account manager, or the backup while the manager is away. */
function ddOwnerNow(string $cid): array
{
    $cfg = crCfg($cid);
    $dd = ddCfg($cid);
    $owner = $cfg['owner'];
    $backup = $dd['backup'] !== '' && $dd['backup'] !== $owner ? $dd['backup'] : '';
    $away = $owner !== '' && $dd['away']['until'] > now();
    $acting = $away && $backup !== '' ? $backup : $owner;
    $n = fn(string $uid) => $uid !== '' ? (string) (userRow($uid)['name'] ?? '') : '';
    return ['owner' => $owner, 'ownerN' => $n($owner), 'backup' => $backup, 'backupN' => $n($backup), 'away' => $away, 'awayUntil' => $away ? $dd['away']['until'] : 0, 'awayNote' => $away ? $dd['away']['note'] : '', 'acting' => $acting, 'actingN' => $n($acting)];
}
/** The StratEdge people to tell about the desk: the acting owner (and the backup), else HR and administrators. */
function ddStaffToTell(string $cid): array
{
    $o = ddOwnerNow($cid);
    $out = array_values(array_unique(array_filter([$o['acting'], $o['away'] ? '' : $o['backup']])));
    if ($out) {
        return $out;
    }
    foreach (db()->query("SELECT id, email, name, role, status, access FROM users WHERE status = 'active'")->fetchAll() as $row) {
        if (hasRole($row, 'hr') || hasRole($row, 'admin')) {
            $out[] = (string) $row['id'];
        }
        if (count($out) >= 5) {
            break;
        }
    }
    return $out;
}
/** Working time: from a moment, add working hours (or whole working days) following the company's hours. */
function ddWorkAdd(int $fromMs, float $hours, array $h, bool $days = false): int
{
    $tz = new DateTimeZone($h['tz']);
    $t = (new DateTimeImmutable('@' . (int) floor($fromMs / 1000)))->setTimezone($tz);
    [$fh, $fm] = array_map('intval', explode(':', $h['from']));
    [$th, $tm] = array_map('intval', explode(':', $h['to']));
    $dayMin = max(60, ($th * 60 + $tm) - ($fh * 60 + $fm));
    $left = $days ? $hours * $dayMin : $hours * 60; // minutes of working time to add
    $guard = 0;
    while ($guard++ < 400) {
        $dow = (int) $t->format('w');
        $start = $t->setTime($fh, $fm);
        $end = $t->setTime($th, $tm);
        if (!in_array($dow, $h['days'], true) || $t >= $end) {
            $t = $t->modify('+1 day')->setTime($fh, $fm);
            continue;
        }
        if ($t < $start) {
            $t = $start;
        }
        $avail = ($end->getTimestamp() - $t->getTimestamp()) / 60;
        if ($left <= $avail) {
            return ($t->getTimestamp() + (int) round($left * 60)) * 1000;
        }
        $left -= $avail;
        $t = $t->modify('+1 day')->setTime($fh, $fm);
    }
    return $t->getTimestamp() * 1000;
}
/** Working minutes between two moments. */
function ddWorkMinutes(int $fromMs, int $toMs, array $h): int
{
    if ($toMs <= $fromMs) {
        return 0;
    }
    $tz = new DateTimeZone($h['tz']);
    $t = (new DateTimeImmutable('@' . (int) floor($fromMs / 1000)))->setTimezone($tz);
    $endAll = (new DateTimeImmutable('@' . (int) floor($toMs / 1000)))->setTimezone($tz);
    [$fh, $fm] = array_map('intval', explode(':', $h['from']));
    [$th, $tm] = array_map('intval', explode(':', $h['to']));
    $min = 0;
    $guard = 0;
    while ($t < $endAll && $guard++ < 400) {
        $dow = (int) $t->format('w');
        $start = $t->setTime($fh, $fm);
        $end = $t->setTime($th, $tm);
        if (!in_array($dow, $h['days'], true) || $t >= $end) {
            $t = $t->modify('+1 day')->setTime($fh, $fm);
            continue;
        }
        if ($t < $start) {
            $t = $start;
        }
        $stop = min($end, $endAll);
        if ($stop > $t) {
            $min += (int) floor(($stop->getTimestamp() - $t->getTimestamp()) / 60);
        }
        $t = $t->modify('+1 day')->setTime($fh, $fm);
    }
    return $min;
}
/** A moment in the company's time zone, for emails. */
function ddFmt(int $ms, array $hours, string $f = 'D j M, H:i T'): string
{
    return (new DateTimeImmutable('@' . (int) floor($ms / 1000)))->setTimezone(new DateTimeZone($hours['tz']))->format($f);
}
function ddIssueRow(string $id): ?array
{
    $s = ddDb()->prepare('SELECT * FROM cr_issue WHERE id = ?');
    $s->execute([$id]);
    $r = $s->fetch();
    if (!$r) {
        return null;
    }
    $r['data'] = json_decode((string) $r['data'], true) ?: [];
    return $r;
}
function ddIssueSet(string $id, array $f): void
{
    $f['u'] = now();
    if (isset($f['data'])) {
        $f['data'] = json_encode($f['data']);
    }
    $sets = implode(', ', array_map(fn($k) => "$k = ?", array_keys($f)));
    ddDb()->prepare("UPDATE cr_issue SET $sets WHERE id = ?")->execute([...array_values($f), $id]);
}
/** The targets of an issue: when it should be acknowledged and resolved by (the company's working hours). */
function ddTargets(array $it, array $dd): array
{
    [$ackH, $resD] = $dd['goals'][(string) $it['impact']] ?? DD_GOALS['medium'];
    // the clocks restart when the company sends a resolution back
    $from = (int) ($it['data']['reopenAt'] ?? $it['at']);
    return ['ackBy' => ddWorkAdd($from, $ackH, $dd['hours']), 'resBy' => ddWorkAdd($from, $resD, $dd['hours'], true), 'ackH' => $ackH, 'resD' => $resD];
}
function ddIssueView(array $it, array $u, bool $staff, array $dd): array
{
    $t = ddTargets($it, $dd);
    $d = $it['data'];
    $by = userRow((string) $it['by_uid']);
    $own = (string) $it['owner'] !== '' ? userRow((string) $it['owner']) : null;
    $st = (string) $it['st'];
    $now = now();
    $acked = (int) $it['ack_at'] > 0;
    $done = in_array($st, ['closed'], true);
    $out = [
        'id' => (string) $it['id'], 'cid' => (string) $it['cid'], 'co' => crCompanyName((string) $it['cid']), 'req' => (string) $it['req'], 'reqTi' => '',
        'kind' => (string) $it['kind'], 'impact' => (string) $it['impact'], 'st' => $st, 'ti' => (string) $it['ti'], 'details' => (string) ($d['details'] ?? ''), 'start' => !empty($d['start']),
        'byN' => $by ? (string) $by['name'] : '', 'by' => (string) $it['by_uid'], 'side' => (string) $it['side'], 'at' => (int) $it['at'], 'u' => (int) $it['u'],
        'owner' => (string) $it['owner'], 'ownerN' => $own ? (string) $own['name'] : '', 'ackAt' => (int) $it['ack_at'], 'ackN' => (string) ($d['ackN'] ?? ''), 'action' => (string) ($d['action'] ?? ''), 'target' => (int) ($d['target'] ?? 0),
        'resAt' => (int) $it['res_at'], 'evidence' => (string) ($d['evidence'] ?? ''), 'resN' => (string) ($d['resN'] ?? ''), 'closedAt' => (int) $it['closed_at'], 'closedN' => (string) ($d['closedN'] ?? ''), 'esc' => (int) $it['esc'],
        'ackBy' => $t['ackBy'], 'resBy' => $t['resBy'], 'ackH' => $t['ackH'], 'resD' => $t['resD'],
        'ackLate' => !$acked && $now > $t['ackBy'], 'resLate' => !$done && (int) $it['res_at'] === 0 && $now > $t['resBy'],
        'ackIn' => $acked ? ddWorkMinutes((int) $it['at'], (int) $it['ack_at'], $dd['hours']) : null,
        'resIn' => (int) $it['res_at'] > 0 ? ddWorkMinutes((int) $it['at'], (int) $it['res_at'], $dd['hours']) : null,
        'mine' => (string) $it['by_uid'] === $u['id'],
    ];
    if ((string) $it['req'] !== '') {
        $q = crReqRow((string) $it['req']);
        $out['reqTi'] = $q ? (string) $q['ti'] : '';
    }
    $can = [
        'ack' => $staff && in_array($st, ['open', 'reopened'], true),
        'note' => in_array($st, DD_OPEN, true),
        'resolve' => $staff && in_array($st, ['ack', 'working', 'reopened'], true),
        'confirm' => !$staff && $st === 'resolved' && ((string) $it['by_uid'] === $u['id'] || caMay(caAccess($u, (string) $it['cid']), 'people', 'w')),
        'reopen' => !$staff && $st === 'resolved' && ((string) $it['by_uid'] === $u['id'] || caMay(caAccess($u, (string) $it['cid']), 'people', 'w')),
        'close' => $staff && $st === 'resolved' && (string) $it['side'] === 'staff',
    ];
    $out['can'] = $can;
    return $out;
}
/** The issues of a company a person may see: all of them for staff and for contacts; one linked to a request outside the person's units only for its author. */
function ddIssues(string $cid, array $u, bool $staff, bool $openOnly = false): array
{
    $s = ddDb()->prepare('SELECT * FROM cr_issue WHERE cid = ?' . ($openOnly ? " AND st <> 'closed'" : '') . ' ORDER BY at DESC LIMIT 400');
    $s->execute([$cid]);
    $acc = $staff ? null : caAccess($u, $cid);
    $out = [];
    foreach ($s->fetchAll() as $r) {
        $r['data'] = json_decode((string) $r['data'], true) ?: [];
        if ($acc && (string) $r['req'] !== '' && (string) $r['by_uid'] !== $u['id']) {
            $q = crReqRow((string) $r['req']);
            if ($q && !caUnitOk($acc, (string) ($q['data']['unit'] ?? ''))) {
                continue;
            }
        }
        $out[] = $r;
    }
    return $out;
}
/** Issues nobody acknowledged within the target: tell the owner and the backup once, then HR and administrators. */
function ddEscalate(string $cid): int
{
    $dd = ddCfg($cid);
    $n = 0;
    $s = ddDb()->prepare("SELECT * FROM cr_issue WHERE cid = ? AND st IN ('open', 'reopened') AND ack_at = 0 AND esc < 2");
    $s->execute([$cid]);
    foreach ($s->fetchAll() as $r) {
        $r['data'] = json_decode((string) $r['data'], true) ?: [];
        $t = ddTargets($r, $dd);
        $late = now() - $t['ackBy'];
        if ($late <= 0) {
            continue;
        }
        $level = (int) $r['esc'];
        $o = ddOwnerNow($cid);
        $co = crCompanyName($cid);
        if ($level === 0) {
            // v83: the scheduled run and a desk page load can overlap: claim the level before anyone is told
            $cl = ddDb()->prepare('UPDATE cr_issue SET esc = 1, u = ? WHERE id = ? AND esc = 0');
            $cl->execute([now(), (string) $r['id']]);
            if ($cl->rowCount() !== 1) {
                continue;
            }
            $to = array_values(array_unique(array_filter([$o['acting'], $o['backup']])));
            if (!$to) {
                $to = ddStaffToTell($cid);
            }
            crMail($to, 'Unacknowledged ' . ($r['kind'] === 'question' ? 'question' : 'issue') . ' at ' . $co . ': ' . $r['ti'], [$co . ' raised this ' . ($t['ackH'] === 1 ? 'more than one working hour' : 'more than ' . $t['ackH'] . ' working hours') . ' ago (' . DD_IMPACT[$r['impact']] . ') and nobody has acknowledged it. The target to acknowledge was ' . ddFmt($t['ackBy'], $dd['hours']) . '.', 'Acknowledge it on the delivery desk: name the owner, the planned action and the target.'], 'issue', (string) $r['id']);
            crEv('iss', (string) $r['id'], ['id' => '', 'name' => 'Delivery desk'], 'staff', 'escalated', 'Not acknowledged within the target: escalated to ' . implode(', ', array_filter(array_map(fn($x) => (string) (userRow($x)['name'] ?? ''), $to))) . '.');
            $n++;
        } elseif ($level === 1 && $late > ($t['ackBy'] - (int) $r['at'])) {
            // still nothing after twice the target: HR and administrators
            $cl = ddDb()->prepare('UPDATE cr_issue SET esc = 2, u = ? WHERE id = ? AND esc = 1');
            $cl->execute([now(), (string) $r['id']]);
            if ($cl->rowCount() !== 1) {
                continue;
            }
            $to = [];
            foreach (db()->query("SELECT id, email, name, role, status, access FROM users WHERE status = 'active'")->fetchAll() as $row) {
                if (hasRole($row, 'hr') || hasRole($row, 'admin')) {
                    $to[] = (string) $row['id'];
                }
                if (count($to) >= 5) {
                    break;
                }
            }
            crMail($to, 'Escalation: ' . $co . ' is waiting on "' . $r['ti'] . '"', ['The owner and the backup were told and the ' . ($r['kind'] === 'question' ? 'question' : 'issue') . ' is still unacknowledged after twice the target (' . $t['ackH'] . ' working hours). ' . DD_IMPACT[$r['impact']] . '.', 'Please acknowledge it on the delivery desk, or name another owner for ' . $co . '.'], 'issue', (string) $r['id']);
            crEv('iss', (string) $r['id'], ['id' => '', 'name' => 'Delivery desk'], 'staff', 'escalated', 'Still unacknowledged after twice the target: escalated to HR and administrators.');
            $n++;
        }
    }
    return $n;
}
/** The measures of an account (the last $days days), with its volume beside them. */
function ddMeasures(string $cid, int $days = 90): array
{
    $since = now() - $days * 86400000;
    $dd = ddCfg($cid);
    $p = ddDb();
    $s = $p->prepare('SELECT * FROM cr_issue WHERE cid = ? AND at >= ?');
    $s->execute([$cid, $since]);
    $issues = array_map(function ($r) {
        $r['data'] = json_decode((string) $r['data'], true) ?: [];
        return $r;
    }, $s->fetchAll());
    $open = array_filter($issues, fn($r) => (string) $r['st'] !== 'closed');
    $unowned = count(array_filter($open, fn($r) => (string) $r['owner'] === ''));
    $acked = array_filter($issues, fn($r) => (int) $r['ack_at'] > 0);
    $ackOk = count(array_filter($acked, fn($r) => (int) $r['ack_at'] <= ddTargets($r, $dd)['ackBy']));
    $resolved = array_filter($issues, fn($r) => (int) $r['res_at'] > 0);
    $resOk = count(array_filter($resolved, fn($r) => (int) $r['res_at'] <= ddTargets($r, $dd)['resBy']));
    $lateNow = count(array_filter($open, fn($r) => ((int) $r['ack_at'] === 0 && now() > ddTargets($r, $dd)['ackBy']) || ((int) $r['res_at'] === 0 && now() > ddTargets($r, $dd)['resBy'])));
    // repeat issues: the same kind and a title that matches an earlier one (normalized), within the period
    $seen = [];
    $repeat = 0;
    foreach (array_reverse($issues) as $r) {
        $k = $r['kind'] . '|' . preg_replace('/[^a-z0-9]+/', ' ', mb_strtolower((string) $r['ti']));
        if (isset($seen[$k])) {
            $repeat++;
        }
        $seen[$k] = true;
    }
    // buyer decisions: requests waiting for the company (approval, questions, returned) or candidates waiting, older than DD_DECISION_DAYS
    $q = crDb()->prepare("SELECT * FROM cr_req WHERE cid = ? AND st IN ('approval', 'questions', 'returned', 'active')");
    $q->execute([$cid]);
    $overdue = 0;
    $starts = 0;
    $reqs = 0;
    $cands = 0;
    foreach ($q->fetchAll() as $r) {
        $reqs++;
        $r['data'] = json_decode((string) $r['data'], true) ?: [];
        $r['appr'] = json_decode((string) $r['appr'], true) ?: [];
        $wait = in_array((string) $r['st'], ['approval', 'questions', 'returned'], true) ? (int) $r['u'] : 0;
        if ((string) $r['st'] === 'active') {
            $c = crSlCounts((string) $r['id'], false);
            $cands += $c['n'];
            if ($c['wait'] > 0) {
                $sl = slDb()->prepare("SELECT MIN(shared_at) FROM cr_sl WHERE req = ? AND st = 'shared' AND ver > 0");
                $sl->execute([(string) $r['id']]);
                $wait = (int) $sl->fetchColumn();
            }
        }
        if ($wait > 0 && now() - $wait > DD_DECISION_DAYS * 86400000) {
            $overdue++;
        }
        if (ddStartChanged($r)) {
            $starts++;
        }
    }
    $q2 = crDb()->prepare('SELECT COUNT(*) FROM cr_req WHERE cid = ? AND at >= ?');
    $q2->execute([$cid, $since]);
    return [
        'days' => $days, 'issues' => count($issues), 'open' => count($open), 'unowned' => $unowned, 'lateNow' => $lateNow,
        'ackN' => count($acked), 'ackOk' => $ackOk, 'resN' => count($resolved), 'resOk' => $resOk, 'repeat' => $repeat,
        'overdueDecisions' => $overdue, 'startChanges' => $starts, 'volume' => ['reqsOpen' => $reqs, 'reqsNew' => (int) $q2->fetchColumn(), 'cands' => $cands],
        'escalated' => count(array_filter($issues, fn($r) => (int) $r['esc'] > 0)),
    ];
}
/** A start date changed since the approved version (visible to the buyer as a change to an agreed start). */
function ddStartChanged(array $r): bool
{
    if ((int) $r['apv_ver'] <= 0 || (int) $r['ver'] === (int) $r['apv_ver']) {
        return false;
    }
    $s = crDb()->prepare('SELECT data FROM cr_ver WHERE req = ? AND n = ?');
    $s->execute([(string) $r['id'], (int) $r['apv_ver']]);
    $apv = json_decode((string) ($s->fetchColumn() ?: '{}'), true) ?: [];
    return (string) ($apv['sd'] ?? '') !== (string) ($r['data']['sd'] ?? '');
}

/** The desk routes (cr_dd_*, cr_issue_*). */
function ddRoute(string $r, array $b, array $u, bool $staff, array $myC): never
{
    require_once __DIR__ . '/corpsl.php';
    $str = fn(string $k, int $max) => mb_substr(trim((string) ($b[$k] ?? '')), 0, $max);
    $cid = $str('cid', 40);
    if (!$staff && !in_array($cid, $myC, true)) {
        $cid = $myC[0] ?? '';
    }
    if ($r === 'cr_issue_act' || $r === 'cr_issue_get') {
        $it = ddIssueRow($str('id', 20));
        if (!$it || (!$staff && !in_array((string) $it['cid'], $myC, true))) {
            fail(404, 'not_found', 'No such issue.');
        }
        // an issue about a request outside the contact's business units exists only for its author
        if (!$staff && (string) $it['req'] !== '' && (string) $it['by_uid'] !== $u['id']) {
            $q0 = crReqRow((string) $it['req']);
            if ($q0 && !caUnitOk(caAccess($u, (string) $it['cid']), (string) ($q0['data']['unit'] ?? ''))) {
                fail(404, 'not_found', 'No such issue.');
            }
        }
        $cid = (string) $it['cid'];
    }
    if ($cid === '' || !docGet('org/admin/clients/' . $cid) || (!$staff && !in_array($cid, $myC, true))) {
        fail(404, 'not_found', 'No such client company.');
    }
    $co = crCompanyName($cid);
    $acc = $staff ? null : caAccess($u, $cid);
    $dd = ddCfg($cid);
    $cfg = crCfg($cid);
    $p = crDb();
    $issueView = fn(array $it) => ddIssueView($it, $u, $staff, $dd);
    $evs = function (string $id) use ($p, $staff): array {
        $s = $p->prepare("SELECT * FROM cr_ev WHERE kind = 'iss' AND ref = ?" . ($staff ? '' : ' AND vis = 1') . ' ORDER BY at');
        $s->execute([$id]);
        return array_map(fn($e) => ['at' => (int) $e['at'], 'byn' => (string) $e['byn'], 'side' => (string) $e['side'], 'ev' => (string) $e['ev'], 'msg' => (string) $e['msg']], $s->fetchAll());
    };
    $teamView = function () use ($cid) {
        $dd = ddCfg($cid, true);
        $cfg = crCfg($cid, true);
        $o = ddOwnerNow($cid);
        return ['owner' => $o, 'hours' => $dd['hours'], 'goals' => $dd['goals'], 'goalsSt' => $dd['goalsSt'], 'goalsBy' => $dd['goalsBy'], 'goalsAt' => $dd['goalsAt'], 'goalsVer' => $dd['goalsVer'], 'proposedBy' => $dd['proposedBy'], 'proposedAt' => $dd['proposedAt'], 'away' => $dd['away'], 'backup' => $dd['backup'], 'rule' => $cfg['rule']];
    };
    switch ($r) {
        case 'cr_dd_home':
            // the desk: the account team, decisions needed, active requests, interviews, agreed starts, issues; staff add the settings and measures
            ddEscalate($cid);
            $dd = ddCfg($cid, true);
            $reqs = [];
            $decisions = [];
            $interviews = [];
            $starts = [];
            $s = $p->prepare("SELECT * FROM cr_req WHERE cid = ? AND st IN ('review', 'questions', 'approval', 'returned', 'approved', 'active', 'hold') AND (st <> 'draft') ORDER BY u DESC LIMIT 300");
            $s->execute([$cid]);
            foreach ($s->fetchAll() as $x) {
                $x['data'] = json_decode((string) $x['data'], true) ?: [];
                $x['appr'] = json_decode((string) $x['appr'], true) ?: [];
                if ($acc && !caReqOk($acc, $x)) {
                    continue;
                }
                $v = crReqView($x, $u, $staff);
                $v['stN'] = CR_ST[(string) $x['st']] ?? (string) $x['st'];
                $v['startChanged'] = ddStartChanged($x);
                $v['sd'] = (string) ($x['data']['sd'] ?? '');
                $reqs[] = $v;
                if (!$staff && $v['mine']) {
                    $decisions[] = ['k' => 'req', 'id' => $v['id'], 'ti' => $v['ti'], 'what' => $x['st'] === 'approval' ? 'Approve or return' : ($x['st'] === 'active' ? 'Review candidates' : 'Answer StratEdge'), 'since' => (int) $x['u']];
                }
                if ((string) $x['st'] === 'active' && (!$acc || caMay($acc, 'shortlist'))) {
                    $sl = slDb()->prepare("SELECT * FROM cr_sl WHERE req = ? AND ver > 0 AND st IN ('interview', 'selected', 'question') ORDER BY u DESC");
                    $sl->execute([(string) $x['id']]);
                    foreach ($sl->fetchAll() as $c) {
                        $c['intv'] = json_decode((string) $c['intv'], true) ?: [];
                        $c['dec'] = json_decode((string) $c['dec'], true) ?: [];
                        $c['data'] = json_decode((string) $c['data'], true) ?: [];
                        $last = $c['intv'] ? end($c['intv']) : null;
                        $row = ['id' => (string) $c['id'], 'req' => (string) $x['id'], 'reqTi' => (string) $x['ti'], 'alias' => (string) $c['alias'], 'st' => (string) $c['st'], 'stage' => $last ? (string) ($last['k'] ?? '') : '', 'stageN' => $last ? (SL_IV[(string) ($last['k'] ?? '')] ?? '') : '', 'date' => $last ? (string) ($last['date'] ?? '') : '', 'u' => (int) $c['u']];
                        if ((string) $c['st'] === 'selected') {
                            // v67: the candidate's start plan (made from the account's template the first time)
                            require_once __DIR__ . '/corpst.php';
                            $pl = stPlanFor($c, $x);
                            [$ready, $missing, $blocking] = stReady($pl);
                            $starts[] = $row + ['sd' => (string) ($x['data']['sd'] ?? ''), 'availFrom' => (string) ($c['data']['avail']['from'] ?? ''), 'startChanged' => $v['startChanged'], 'decAt' => (int) ($c['dec']['at'] ?? 0), 'decN' => (string) ($c['dec']['n'] ?? ''),
                                'plan' => ['id' => (string) $pl['id'], 'st' => (string) $pl['st'], 'stN' => ST_ST[(string) $pl['st']] ?? (string) $pl['st'], 'planned' => (string) $pl['planned'], 'confirmed' => (string) $pl['confirmed'], 'actual' => (string) $pl['actual'], 'ready' => $ready, 'missing' => count($missing), 'blocking' => count($blocking), 'done' => count(array_filter((array) ($pl['data']['items'] ?? []), fn($i) => (string) $i['st'] === 'done')), 'items' => count((array) ($pl['data']['items'] ?? []))]];
                        } else {
                            $interviews[] = $row;
                        }
                    }
                }
            }
            if (!$staff) {
                if (caMay($acc, 'proposals')) {
                    foreach ($p->query('SELECT * FROM cr_prop WHERE cid = ' . $p->quote($cid) . " AND ver > 0 AND st IN ('shared', 'question') ORDER BY u DESC LIMIT 100")->fetchAll() as $x) {
                        $to = json_decode((string) $x['to_uids'], true) ?: [];
                        if (in_array($u['id'], $to, true)) {
                            $decisions[] = ['k' => 'prop', 'id' => (string) $x['id'], 'ti' => (string) $x['ti'], 'what' => caMay($acc, 'proposals', 'w') ? 'Accept or decline the proposal' : 'Read the proposal', 'since' => (int) $x['u']];
                        }
                    }
                }
                if (caMay($acc, 'supplier')) {
                    require_once __DIR__ . '/corpq.php';
                    $pk = cqPkt($cid);
                    if ($pk && (string) $pk['st'] === 'open' && (!$pk['to_uids'] || in_array($u['id'], (array) $pk['to_uids'], true))) {
                        $q2 = cqDb()->prepare("SELECT COUNT(*) FROM cq_item WHERE pkt = ? AND st = 'supplied'");
                        $q2->execute([(string) $pk['id']]);
                        $nd = (int) $q2->fetchColumn();
                        if ($nd > 0) {
                            $decisions[] = ['k' => 'pkt', 'id' => (string) $pk['id'], 'ti' => $nd . ' supplier document' . ($nd === 1 ? '' : 's') . ' to review', 'what' => 'Review and approve', 'since' => (int) $pk['u']];
                        }
                    }
                }
            }
            $issues = array_map($issueView, ddIssues($cid, $u, $staff));
            $out = [
                'cid' => $cid, 'co' => $co, 'staff' => $staff, 'me' => $u['id'], 'team' => $teamView(), 'kinds' => DD_KIND, 'impacts' => DD_IMPACT, 'st' => DD_ST,
                'reqs' => $reqs, 'decisions' => $decisions, 'interviews' => $interviews, 'starts' => $starts, 'issues' => $issues,
                'acc' => $acc ? ['role' => $acc['role'], 'units' => $acc['units'], 'manage' => caMay($acc, 'people', 'w')] : null,
                'reqs_for' => $reqs ? array_map(fn($x) => ['id' => $x['id'], 'ti' => $x['ti']], $reqs) : [],
            ];
            if ($staff) {
                $team = [];
                foreach (db()->query("SELECT id, email, name, role, status, access FROM users WHERE status = 'active' ORDER BY name")->fetchAll() as $row) {
                    if (crStaff($row)) {
                        $team[] = ['id' => (string) $row['id'], 'n' => (string) $row['name']];
                    }
                }
                $out['staffTeam'] = $team;
                $out['measures'] = ddMeasures($cid, max(7, min(365, (int) ($b['days'] ?? 90))));
                // v67: starts in the window (the period behind, and the next 60 days)
                require_once __DIR__ . '/corpst.php';
                $out['measures']['starts'] = stMeasures($cid, now() - max(7, min(365, (int) ($b['days'] ?? 90))) * 86400000, now() + 60 * 86400000);
                $out['tz'] = timezone_identifiers_list();
            }
            ok($out);

        case 'cr_dd_cfg':
            // StratEdge: the backup, the working hours and the response targets (proposed to the company), the away notice
            if (!$staff) {
                fail(403, 'forbidden', 'StratEdge sets the account team and proposes the targets.');
            }
            $s = ddDb()->prepare('SELECT data FROM cr_dd WHERE cid = ?');
            $s->execute([$cid]);
            $d = json_decode((string) ($s->fetchColumn() ?: '{}'), true) ?: [];
            $changedGoals = false;
            if (array_key_exists('backup', $b)) {
                $bk = $str('backup', 40);
                $row = $bk !== '' ? userRow($bk) : null;
                if ($bk !== '' && (!$row || !crStaff($row))) {
                    fail(400, 'invalid_argument', 'Pick someone at StratEdge as the backup.');
                }
                $d['backup'] = $bk;
            }
            if (isset($b['hours']) && is_array($b['hours'])) {
                $h = $b['hours'];
                $days = array_values(array_unique(array_filter(array_map('intval', (array) ($h['days'] ?? [])), fn($x) => $x >= 0 && $x <= 6)));
                if (!$days) {
                    fail(400, 'invalid_argument', 'Pick the working days.');
                }
                $from = ddClock((string) ($h['from'] ?? ''), '');
                $to = ddClock((string) ($h['to'] ?? ''), '');
                if ($from === '' || $to === '' || $to <= $from) {
                    fail(400, 'invalid_argument', 'Give the working hours as from and to (for example 09:00 to 18:00).');
                }
                $tz = (string) ($h['tz'] ?? '');
                if (!in_array($tz, timezone_identifiers_list(), true)) {
                    fail(400, 'invalid_argument', 'Pick a time zone.');
                }
                $new = ['tz' => $tz, 'days' => $days, 'from' => $from, 'to' => $to];
                $changedGoals = $changedGoals || $new !== $dd['hours'];
                $d['hours'] = $new;
            }
            if (isset($b['goals']) && is_array($b['goals'])) {
                $g = [];
                foreach (DD_GOALS as $k => $dflt) {
                    $x = (array) ($b['goals'][$k] ?? []);
                    $a = (int) ($x[0] ?? $dflt[0]);
                    $rr = (int) ($x[1] ?? $dflt[1]);
                    if ($a < 1 || $a > 240 || $rr < 1 || $rr > 60) {
                        fail(400, 'invalid_argument', 'Targets: 1 to 240 working hours to acknowledge, 1 to 60 working days to resolve.');
                    }
                    $g[$k] = [$a, $rr];
                }
                $changedGoals = $changedGoals || $g !== $dd['goals'];
                $d['goals'] = $g;
            }
            if (array_key_exists('away', $b)) {
                $aw = (array) ($b['away'] ?? []);
                $until = (int) ($aw['until'] ?? 0);
                if ($until > 0 && $until < now() - 3600000) {
                    fail(400, 'invalid_argument', 'The away date is in the past.');
                }
                $d['away'] = ['until' => $until, 'note' => mb_substr(trim((string) ($aw['note'] ?? '')), 0, 200)];
            }
            if ($changedGoals) {
                // a changed proposal is a proposal again: the company agrees to what it sees
                $d['goalsSt'] = 'proposed';
                $d['proposedBy'] = (string) $u['name'];
                $d['proposedAt'] = now();
                $d['goalsVer'] = (int) ($d['goalsVer'] ?? 1) + ($dd['goalsSt'] === 'agreed' ? 1 : 0);
                $d['goalsBy'] = '';
                $d['goalsAt'] = 0;
            }
            if ($dd['proposedAt'] === 0 && empty($d['proposedAt'])) {
                $d['proposedBy'] = (string) $u['name'];
                $d['proposedAt'] = now();
            }
            ddSaveCfg($cid, $d);
            audit('client', 'Delivery desk settings changed', $co, ['backup' => $d['backup'] ?? '', 'hours' => $d['hours'] ?? null, 'goals' => $d['goals'] ?? null, 'away' => $d['away'] ?? null, 'proposed' => $changedGoals], $u);
            if ($changedGoals) {
                $full = caFilter($cid, array_keys(crContacts($cid)), 'people', 'w');
                crMail($full, 'Response targets proposed for ' . $co, [$u['name'] . ' proposed the working hours and response targets StratEdge will work to for ' . $co . '. They apply as proposed until someone with full access at ' . $co . ' agrees to them on the delivery desk.'], 'issue', '');
            }
            ok(['team' => $teamView()]);

        case 'cr_dd_agree':
            // the company (full access) agrees to the proposed hours and targets
            if ($staff || !caMay($acc, 'people', 'w')) {
                fail(403, 'forbidden', 'Someone with full access at ' . $co . ' agrees to the targets.');
            }
            if ((int) ($b['ver'] ?? 0) !== $dd['goalsVer']) {
                fail(409, 'conflict', 'The targets changed since you read them; look again.');
            }
            $s = ddDb()->prepare('SELECT data FROM cr_dd WHERE cid = ?');
            $s->execute([$cid]);
            $d = json_decode((string) ($s->fetchColumn() ?: '{}'), true) ?: [];
            $d['goalsSt'] = 'agreed';
            $d['goalsBy'] = (string) $u['name'];
            $d['goalsAt'] = now();
            $d['goalsVer'] = $dd['goalsVer'];
            $d += ['goals' => $dd['goals'], 'hours' => $dd['hours']];
            ddSaveCfg($cid, $d);
            audit('client', 'Response targets agreed', $co, ['by' => $u['name'], 'ver' => $dd['goalsVer']], $u);
            crMail(ddStaffToTell($cid), $co . ' agreed to the response targets', [$u['name'] . ' agreed to the working hours and response targets for ' . $co . ' (version ' . $dd['goalsVer'] . ').'], 'issue', '');
            ok(['team' => $teamView()]);

        case 'cr_issue_add':
            // a contact raises a question, an issue or a change to an agreed start; StratEdge may record one for them
            $kind = $str('kind', 12);
            $impact = $str('impact', 12);
            $ti = $str('ti', 160);
            if (!isset(DD_KIND[$kind]) || !isset(DD_IMPACT[$impact])) {
                fail(400, 'invalid_argument', 'Choose what this is and its impact.');
            }
            if (mb_strlen($ti) < 5) {
                fail(400, 'invalid_argument', 'Give it a short title.');
            }
            $req = $str('req', 20);
            if ($req !== '') {
                $q = crReqRow($req);
                if (!$q || (string) $q['cid'] !== $cid || ($acc && !caReqOk($acc, $q))) {
                    fail(404, 'not_found', 'No such request.');
                }
            }
            $id = rid(7);
            $data = ['details' => $str('details', 4000), 'start' => !empty($b['start']) || $kind === 'change'];
            ddDb()->prepare('INSERT INTO cr_issue (id, cid, req, by_uid, side, kind, impact, st, owner, ti, data, at, u) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute([$id, $cid, $req, $u['id'], $staff ? 'staff' : 'client', $kind, $impact, 'open', '', $ti, json_encode($data), now(), now()]);
            crEv('iss', $id, $u, $staff ? 'staff' : 'client', 'raised', $u['name'] . ' raised it (' . DD_KIND[$kind] . ', ' . strtolower(explode(':', DD_IMPACT[$impact])[0]) . ' impact).' . ($data['details'] !== '' ? "\n" . $data['details'] : ''));
            $t = ddTargets(['at' => now(), 'st' => 'open', 'impact' => $impact, 'data' => []], $dd);
            $to = ddStaffToTell($cid);
            crMail($to, ucfirst(DD_KIND[$kind]) . ' from ' . $co . ': ' . $ti, [$u['name'] . ' at ' . $co . ' raised a ' . strtolower(DD_KIND[$kind]) . ' (' . DD_IMPACT[$impact] . ').', $data['details'] !== '' ? $data['details'] : '(no details)', 'Acknowledge it by ' . ddFmt($t['ackBy'], $dd['hours']) . ': name the owner, the planned action and the target.'], 'issue', $id);
            audit('client', 'Issue raised', $co, ['id' => $id, 'kind' => $kind, 'impact' => $impact, 'ti' => $ti], $u);
            ok(['issue' => $issueView(ddIssueRow($id)), 'evs' => $evs($id)]);

        case 'cr_issue_get':
            ok(['issue' => $issueView($it), 'evs' => $evs((string) $it['id'])]);

        case 'cr_issue_act':
            $id = (string) $it['id'];
            $act = (string) ($b['act'] ?? '');
            $msg = $str('msg', 4000);
            $view = $issueView($it);
            $can = $view['can'];
            $kindN = $it['kind'] === 'question' ? 'question' : 'issue';
            $tellClient = array_values(array_unique(array_filter([(string) $it['by_uid'] !== $u['id'] && (string) $it['side'] === 'client' ? (string) $it['by_uid'] : ''])));
            switch ($act) {
                case 'ack':
                    if (!$can['ack']) {
                        fail(409, 'conflict', 'Only a ' . $kindN . ' that was raised (or reopened) is acknowledged, by StratEdge.');
                    }
                    $owner = $str('owner', 40) ?: $u['id'];
                    $row = userRow($owner);
                    if (!$row || !crStaff($row)) {
                        fail(400, 'invalid_argument', 'Name who at StratEdge owns it.');
                    }
                    $action = $str('action', 1000);
                    if (mb_strlen($action) < 5) {
                        fail(400, 'invalid_argument', 'Say what will be done.');
                    }
                    $target = (int) ($b['target'] ?? 0);
                    if ($target <= 0) {
                        $target = $view['resBy'];
                    }
                    $d = $it['data'] + ['action' => $action, 'target' => $target, 'ackN' => (string) $u['name']];
                    $d['action'] = $action;
                    $d['target'] = $target;
                    $d['ackN'] = (string) $u['name'];
                    ddIssueSet($id, ['st' => 'ack', 'owner' => $owner, 'ack_at' => now(), 'data' => $d]);
                    crEv('iss', $id, $u, 'staff', 'acknowledged', $u['name'] . ' acknowledged it. Owner: ' . (string) $row['name'] . '. Planned: ' . $action . ' (by ' . ddFmt($target, $dd['hours'], 'j M') . ').');
                    crMail($tellClient, 'Acknowledged: ' . $it['ti'], ['StratEdge acknowledged your ' . $kindN . '. ' . (string) $row['name'] . ' owns it.', 'Planned: ' . $action, 'Target: ' . ddFmt($target, $dd['hours'], 'l j M Y') . '.'], 'issue', $id);
                    break;
                case 'note':
                    if (!$can['note'] || $msg === '') {
                        fail(400, 'invalid_argument', 'Write the note.');
                    }
                    $f = [];
                    if ($staff && in_array((string) $it['st'], ['ack'], true)) {
                        $f['st'] = 'working';
                    }
                    if ($f) {
                        ddIssueSet($id, $f);
                    }
                    crEv('iss', $id, $u, $staff ? 'staff' : 'client', 'note', $msg);
                    crMail($staff ? $tellClient : ddStaffToTell($cid), ($staff ? 'Progress on: ' : 'A note on: ') . $it['ti'], [$u['name'] . ' wrote:', $msg], 'issue', $id);
                    break;
                case 'resolve':
                    if (!$can['resolve']) {
                        fail(409, 'conflict', 'A resolution is proposed by StratEdge on an acknowledged ' . $kindN . '.');
                    }
                    if (mb_strlen($msg) < 10) {
                        fail(400, 'invalid_argument', 'Describe the resolution and its evidence (what changed, where it can be seen).');
                    }
                    $d = $it['data'];
                    $d['evidence'] = $msg;
                    $d['resN'] = (string) $u['name'];
                    ddIssueSet($id, ['st' => 'resolved', 'res_at' => now(), 'data' => $d]);
                    crEv('iss', $id, $u, 'staff', 'resolved', $u['name'] . ' proposed the resolution: ' . $msg);
                    crMail($tellClient ?: ($it['side'] === 'client' ? [(string) $it['by_uid']] : []), 'Resolution proposed: ' . $it['ti'], [$u['name'] . ' proposes this resolution:', $msg, 'Please confirm it on the delivery desk, or say what is still open.'], 'issue', $id);
                    break;
                case 'confirm':
                    if (!$can['confirm']) {
                        fail(409, 'conflict', 'The person who raised it (or someone with full access) confirms a proposed resolution.');
                    }
                    $d = $it['data'];
                    $d['closedN'] = (string) $u['name'];
                    ddIssueSet($id, ['st' => 'closed', 'closed_at' => now(), 'data' => $d]);
                    crEv('iss', $id, $u, 'client', 'confirmed', $u['name'] . ' confirmed the resolution.' . ($msg !== '' ? ' ' . $msg : ''));
                    crMail(array_values(array_unique(array_filter([(string) $it['owner'], ...ddStaffToTell($cid)]))), 'Resolved and confirmed: ' . $it['ti'], [$u['name'] . ' at ' . $co . ' confirmed the resolution.' . ($msg !== '' ? ' ' . $msg : '')], 'issue', $id);
                    break;
                case 'reopen':
                    if (!$can['reopen'] || $msg === '') {
                        fail(400, 'invalid_argument', 'Say what is still open.');
                    }
                    $d = $it['data'];
                    $d['reopenAt'] = now();
                    $d['evidence'] = '';
                    ddIssueSet($id, ['st' => 'reopened', 'res_at' => 0, 'ack_at' => 0, 'esc' => 0, 'data' => $d]);
                    crEv('iss', $id, $u, 'client', 'reopened', $u['name'] . ' did not confirm the resolution: ' . $msg);
                    crMail(array_values(array_unique(array_filter([(string) $it['owner'], ...ddStaffToTell($cid)]))), 'Reopened: ' . $it['ti'], [$u['name'] . ' at ' . $co . ' did not confirm the resolution:', $msg, 'Acknowledge it again with the next action.'], 'issue', $id);
                    break;
                case 'close':
                    if (!$can['close']) {
                        fail(409, 'conflict', 'StratEdge closes only what it raised itself; the company confirms its own.');
                    }
                    $d = $it['data'];
                    $d['closedN'] = (string) $u['name'];
                    ddIssueSet($id, ['st' => 'closed', 'closed_at' => now(), 'data' => $d]);
                    crEv('iss', $id, $u, 'staff', 'closed', $u['name'] . ' closed it.' . ($msg !== '' ? ' ' . $msg : ''));
                    break;
                default:
                    fail(400, 'invalid_argument', 'Unknown action.');
            }
            $it = ddIssueRow($id);
            ok(['issue' => $issueView($it), 'evs' => $evs($id)]);
    }
    fail(404, 'not_found', 'Unknown request.');
}
