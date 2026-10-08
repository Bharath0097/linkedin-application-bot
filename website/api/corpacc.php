<?php
declare(strict_types=1);
/*
 * v64 Client roles, business-unit scope, delegation and access reviews (CC-18).
 *
 * Every contact of a client company used to see everything of that company. Now each contact has a role in the
 * company (full access, hiring manager, procurement, finance, executive read-only) that says which areas they use and
 * whether they act or only read: talent requests, the shortlist room, proposals, supplier documents, timesheets,
 * invoices, consultants and attendance, reports, and the company's own people. A contact may be limited to business
 * units (the request's "Business unit"); a request outside their units does not exist for them: not in lists, counts,
 * downloads, notifications or by its address. A contact with nothing set keeps full access (as before v64).
 *
 * Who approves talent requests stays the company's approver list (cr_cfg); an approver may delegate their approvals
 * to a colleague for a period (a delegation covers approvals only, within the delegator's units, and ends by itself).
 * StratEdge (whoever works client accounts) and the company's own full-access people manage roles, units and
 * delegations, revoke a colleague's access (sessions ended at once) and record access reviews. Everything is audited.
 *
 * Table (main database): cr_acc (one row per company: people, delegations, reviews).
 */

const CA_ROLES = ['full' => 'Full access', 'hiring' => 'Hiring manager', 'procurement' => 'Procurement', 'finance' => 'Finance', 'exec' => 'Executive (read-only)'];
const CA_AREAS = ['requests' => 'Talent requests', 'shortlist' => 'Shortlists and interviews', 'proposals' => 'Proposals', 'supplier' => 'Supplier documents', 'timesheets' => 'Timesheets', 'invoices' => 'Invoices', 'consultants' => 'Consultants and attendance', 'reports' => 'Reports', 'people' => 'People and access'];
/** What each role may do in each area: 'w' act, 'r' read, '' nothing. */
const CA_GRID = [
    'full' => ['requests' => 'w', 'shortlist' => 'w', 'proposals' => 'w', 'supplier' => 'w', 'timesheets' => 'w', 'invoices' => 'r', 'consultants' => 'r', 'reports' => 'r', 'people' => 'w'],
    'hiring' => ['requests' => 'w', 'shortlist' => 'w', 'proposals' => '', 'supplier' => '', 'timesheets' => 'w', 'invoices' => '', 'consultants' => 'r', 'reports' => 'r', 'people' => ''],
    'procurement' => ['requests' => 'r', 'shortlist' => '', 'proposals' => 'w', 'supplier' => 'w', 'timesheets' => '', 'invoices' => 'r', 'consultants' => '', 'reports' => 'r', 'people' => ''],
    'finance' => ['requests' => 'r', 'shortlist' => '', 'proposals' => 'r', 'supplier' => 'r', 'timesheets' => 'w', 'invoices' => 'r', 'consultants' => 'r', 'reports' => 'r', 'people' => ''],
    'exec' => ['requests' => 'r', 'shortlist' => 'r', 'proposals' => 'r', 'supplier' => 'r', 'timesheets' => 'r', 'invoices' => 'r', 'consultants' => 'r', 'reports' => 'r', 'people' => 'r'],
];
const CA_DELEG_MAX_DAYS = 90;

function caDb(): PDO
{
    static $ready = false;
    $p = db();
    if (!$ready) {
        $ready = true;
        $p->exec('CREATE TABLE IF NOT EXISTS cr_acc (cid VARCHAR(40) PRIMARY KEY, data TEXT NOT NULL, u BIGINT NOT NULL)');
    }
    return $p;
}
/** The company's access record: people (uid => role, units, at, by), delegations, reviews. */
function caData(string $cid, bool $fresh = false): array
{
    static $memo = [];
    if (!$fresh && isset($memo[$cid])) {
        return $memo[$cid];
    }
    $s = caDb()->prepare('SELECT data FROM cr_acc WHERE cid = ?');
    $s->execute([$cid]);
    $d = json_decode((string) ($s->fetchColumn() ?: '{}'), true) ?: [];
    $people = [];
    foreach ((array) ($d['people'] ?? []) as $uid => $x) {
        $x = (array) $x;
        if (isset(CA_ROLES[(string) ($x['role'] ?? '')])) {
            $people[(string) $uid] = ['role' => (string) $x['role'], 'units' => array_values(array_filter(array_map('strval', (array) ($x['units'] ?? [])))), 'at' => (int) ($x['at'] ?? 0), 'by' => (string) ($x['by'] ?? '')];
        }
    }
    return $memo[$cid] = ['people' => $people, 'deleg' => array_values((array) ($d['deleg'] ?? [])), 'reviews' => array_values((array) ($d['reviews'] ?? []))];
}
function caSave(string $cid, array $d): void
{
    caDb()->prepare('REPLACE INTO cr_acc (cid, data, u) VALUES (?,?,?)')->execute([$cid, json_encode($d), now()]);
    caData($cid, true);
}
/** A delegation in force now: from the delegator, to the delegate, for approvals, within the delegator's units. */
function caActiveDelegations(string $cid): array
{
    $t = now();
    return array_values(array_filter(caData($cid)['deleg'], fn($x) => (int) ($x['start'] ?? 0) <= $t && (int) ($x['end'] ?? 0) > $t && empty($x['ended'])));
}
/**
 * The access a person has in a company: role, units (empty = every business unit), whether anything was set, and the
 * delegators whose approvals they hold right now. Staff of StratEdge are not contacts: callers treat them apart.
 */
function caAccess(array $u, string $cid): array
{
    $d = caData($cid);
    $uid = (string) $u['id'];
    $me = $d['people'][$uid] ?? null;
    $out = ['cid' => $cid, 'role' => $me ? $me['role'] : 'full', 'units' => $me ? $me['units'] : [], 'set' => (bool) $me, 'deleg' => []];
    foreach (caActiveDelegations($cid) as $x) {
        if ((string) ($x['to'] ?? '') === $uid) {
            $out['deleg'][] = ['from' => (string) $x['from'], 'end' => (int) $x['end'], 'id' => (string) $x['id']];
        }
    }
    return $out;
}
/** 'w', 'r' or '' for an area. */
function caLevel(array $acc, string $area): string
{
    return CA_GRID[$acc['role']][$area] ?? '';
}
function caMay(array $acc, string $area, string $need = 'r'): bool
{
    $l = caLevel($acc, $area);
    return $need === 'w' ? $l === 'w' : $l !== '';
}
/** Does a record of this business unit fall within the person's units? (No unit on the record: everyone of the company.) */
function caUnitOk(array $acc, string $unit): bool
{
    $unit = trim($unit);
    if (!$acc['units'] || $unit === '') {
        return true;
    }
    foreach ($acc['units'] as $x) {
        if (strcasecmp($x, $unit) === 0) {
            return true;
        }
    }
    return false;
}
/** A request is within reach: the area, and its business unit. */
function caReqOk(array $acc, array $req, string $need = 'r'): bool
{
    return caMay($acc, 'requests', $need) && caUnitOk($acc, (string) ($req['data']['unit'] ?? ''));
}
/** The contacts of a company who may use an area (for the people to tell, the people to share with). */
function caFilter(string $cid, array $uids, string $area, string $need = 'r', string $unit = ''): array
{
    $out = [];
    foreach (array_unique(array_filter(array_map('strval', $uids))) as $uid) {
        $row = userRow($uid);
        if (!$row) {
            continue;
        }
        if (crStaff($row)) {
            $out[] = $uid;
            continue;
        }
        $acc = caAccess($row, $cid);
        if (caMay($acc, $area, $need) && caUnitOk($acc, $unit)) {
            $out[] = $uid;
        }
    }
    return $out;
}
/** For the menu and the pages: each company of a contact, with the areas they may use ('w' or 'r'). */
function caMine(array $u): array
{
    if (crStaff($u)) {
        return [];
    }
    $out = [];
    foreach (myCids((string) $u['id']) as $cid) {
        $acc = caAccess($u, $cid);
        $areas = [];
        foreach (array_keys(CA_AREAS) as $a) {
            if (caLevel($acc, $a) !== '') {
                $areas[$a] = caLevel($acc, $a);
            }
        }
        $out[$cid] = ['role' => $acc['role'], 'units' => $acc['units'], 'areas' => $areas, 'deleg' => count($acc['deleg'])];
    }
    return $out;
}
/** The approvers a person stands in for right now (their uids), from active delegations to this person. */
function caDelegatorsOf(array $u, string $cid): array
{
    return array_map(fn($x) => $x['from'], caAccess($u, $cid)['deleg']);
}

/** The company's people as the access page shows them (contacts with an account, their role, units, last sign-in). */
function caPeopleView(string $cid): array
{
    $d = caData($cid);
    $out = [];
    foreach (crContacts($cid) as $uid => $c) {
        $me = $d['people'][$uid] ?? null;
        $lg = docGet('log/' . $uid);
        $out[] = ['id' => $uid, 'n' => $c['n'], 'e' => $c['e'], 'role' => $me ? $me['role'] : 'full', 'units' => $me ? $me['units'] : [], 'set' => (bool) $me, 'seen' => (int) ($lg->seen ?? $lg->last->t ?? 0), 'setAt' => $me ? $me['at'] : 0, 'setBy' => $me ? $me['by'] : ''];
    }
    usort($out, fn($a, $b) => strcasecmp($a['n'], $b['n']));
    return $out;
}
/** The business units the company uses: the ones set on its people and on its requests. */
function caUnits(string $cid): array
{
    $set = [];
    foreach (caData($cid)['people'] as $x) {
        foreach ($x['units'] as $un) {
            $set[mb_strtolower($un)] = $un;
        }
    }
    $s = crDb()->prepare('SELECT data FROM cr_req WHERE cid = ?');
    $s->execute([$cid]);
    foreach ($s->fetchAll() as $row) {
        $un = trim((string) (json_decode((string) $row['data'], true)['unit'] ?? ''));
        if ($un !== '' && !isset($set[mb_strtolower($un)])) {
            $set[mb_strtolower($un)] = $un;
        }
    }
    $vals = array_values($set);
    sort($vals, SORT_NATURAL | SORT_FLAG_CASE);
    return $vals;
}

/** The access routes (cr_acc_*): StratEdge, or a full-access contact of the company. */
function caRoute(string $r, array $b, array $u, bool $staff, array $myC): never
{
    $str = fn(string $k, int $max) => mb_substr(trim((string) ($b[$k] ?? '')), 0, $max);
    $cid = $str('cid', 40);
    if ($cid === '' && !$staff && $myC) {
        $cid = $myC[0];
    }
    if (!docGet('org/admin/clients/' . $cid) || (!$staff && !in_array($cid, $myC, true))) {
        fail(404, 'not_found', 'No such client company.');
    }
    $acc = $staff ? null : caAccess($u, $cid);
    $manage = $staff || ($acc && caMay($acc, 'people', 'w'));
    $view = $staff || ($acc && caMay($acc, 'people', 'r'));
    if (!$view) {
        fail(403, 'forbidden', 'People and access are for the company\'s full-access people and StratEdge.');
    }
    $needManage = fn() => $manage ?: fail(403, 'forbidden', 'Only the company\'s full-access people and StratEdge change access.');
    $co = crCompanyName($cid);
    $contacts = crContacts($cid);
    $d = caData($cid);
    $nameOf = fn(string $uid) => (string) ($contacts[$uid]['n'] ?? (userRow($uid)['name'] ?? $uid));
    $delegView = fn(array $x) => ['id' => (string) $x['id'], 'from' => (string) $x['from'], 'fromN' => $nameOf((string) $x['from']), 'to' => (string) $x['to'], 'toN' => $nameOf((string) $x['to']), 'start' => (int) $x['start'], 'end' => (int) $x['end'], 'note' => (string) ($x['note'] ?? ''), 'by' => (string) ($x['by'] ?? ''), 'at' => (int) ($x['at'] ?? 0), 'ended' => (string) ($x['ended'] ?? ''), 'active' => (int) $x['start'] <= now() && (int) $x['end'] > now() && empty($x['ended'])];
    $home = function () use ($cid, $co, $staff, $manage, $delegView, $u) {
        $d = caData($cid, true);
        $cfg = crCfg($cid, true);
        ok([
            'cid' => $cid, 'co' => $co, 'staff' => $staff, 'manage' => $manage, 'me' => $u['id'],
            'people' => caPeopleView($cid), 'roles' => CA_ROLES, 'areas' => CA_AREAS, 'grid' => CA_GRID, 'units' => caUnits($cid),
            'appr' => $cfg['appr'], 'rule' => $cfg['rule'],
            'deleg' => array_map($delegView, array_reverse($d['deleg'])), 'reviews' => array_reverse($d['reviews']), 'maxDays' => CA_DELEG_MAX_DAYS,
        ]);
    };
    switch ($r) {
        case 'cr_acc_get':
            $home();

        case 'cr_acc_set':
            // a contact's role and business units
            $needManage();
            $uid = $str('uid', 40);
            if (!isset($contacts[$uid])) {
                fail(404, 'not_found', 'No such contact of this company.');
            }
            $role = $str('role', 20);
            if (!isset(CA_ROLES[$role])) {
                fail(400, 'invalid_argument', 'Choose a role.');
            }
            $units = [];
            foreach (array_slice((array) ($b['units'] ?? []), 0, 20) as $un) {
                $un = mb_substr(trim((string) $un), 0, 60);
                if ($un !== '' && !in_array($un, $units, true)) {
                    $units[] = $un;
                }
            }
            if ($role !== 'full' && !$staff && $uid === $u['id']) {
                fail(409, 'conflict', 'You cannot take full access away from yourself; ask a colleague with full access or StratEdge.');
            }
            // the company always keeps at least one full-access person with every unit
            $before = $d['people'][$uid]['role'] ?? 'full';
            if (($before === 'full' && $role !== 'full') || ($role === 'full' && $units)) {
                $others = 0;
                foreach ($contacts as $cuid => $c) {
                    if ($cuid !== $uid && (($d['people'][$cuid]['role'] ?? 'full') === 'full') && !($d['people'][$cuid]['units'] ?? [])) {
                        $others++;
                    }
                }
                if ($others === 0) {
                    fail(409, 'conflict', 'The company needs at least one person with full access to every business unit. Give that to someone else first.');
                }
            }
            $d['people'][$uid] = ['role' => $role, 'units' => $units, 'at' => now(), 'by' => (string) $u['name']];
            caSave($cid, $d);
            audit('client', 'Client contact access changed', $co, ['who' => $nameOf($uid), 'role' => $role, 'units' => implode(', ', $units), 'from' => $before], $u);
            $home();

        case 'cr_acc_deleg':
            // an approver hands their approvals to a colleague for a period (within the delegator's units)
            $needManage();
            $from = $str('from', 40);
            $to = $str('to', 40);
            if (!isset($contacts[$from]) || !isset($contacts[$to]) || $from === $to) {
                fail(400, 'invalid_argument', 'Choose who delegates and the colleague who takes over.');
            }
            if (!$staff && $from !== $u['id'] && !caMay(caAccess($u, $cid), 'people', 'w')) {
                fail(403, 'forbidden', 'You can delegate your own approvals.');
            }
            $start = (int) ($b['start'] ?? now());
            $end = (int) ($b['end'] ?? 0);
            if ($start <= 0) {
                $start = now();
            }
            if ($end <= max($start, now())) {
                fail(400, 'invalid_argument', 'Give an end date after the start.');
            }
            if ($end - $start > CA_DELEG_MAX_DAYS * 86400000) {
                fail(400, 'invalid_argument', 'A delegation lasts at most ' . CA_DELEG_MAX_DAYS . ' days; record a new one after that.');
            }
            // a delegate without the requests area cannot approve what they may not read
            $toRow = userRow($to);
            if (!$toRow || !caMay(caAccess($toRow, $cid), 'requests', 'r')) {
                fail(409, 'conflict', $nameOf($to) . ' cannot read talent requests (their role); give them a role that can first.');
            }
            $x = ['id' => rid(6), 'from' => $from, 'to' => $to, 'start' => $start, 'end' => $end, 'note' => $str('note', 300), 'by' => (string) $u['name'], 'at' => now()];
            $d['deleg'][] = $x;
            $d['deleg'] = array_slice($d['deleg'], -200);
            caSave($cid, $d);
            audit('client', 'Approvals delegated', $co, ['from' => $nameOf($from), 'to' => $nameOf($to), 'until' => gmdate('Y-m-d', (int) ($end / 1000))], $u);
            crMail([$to], 'Approvals delegated to you: ' . $co, [$nameOf($from) . ' delegated their talent request approvals at ' . $co . ' to you until ' . gmdate('j M Y', (int) ($end / 1000)) . '.', $x['note'] !== '' ? $x['note'] : 'Requests waiting for their approval now wait for yours.'], 'req', '');
            $home();

        case 'cr_acc_deleg_end':
            $needManage();
            $id = $str('id', 20);
            $found = false;
            foreach ($d['deleg'] as &$x) {
                if ((string) ($x['id'] ?? '') === $id && empty($x['ended'])) {
                    $x['ended'] = (string) $u['name'];
                    $x['endedAt'] = now();
                    $found = true;
                }
            }
            unset($x);
            if (!$found) {
                fail(404, 'not_found', 'No such delegation, or it already ended.');
            }
            caSave($cid, $d);
            audit('client', 'Delegation ended', $co, ['id' => $id], $u);
            $home();

        case 'cr_acc_revoke':
            // a colleague's access to this company ends now: their sessions are closed; a contact of this company only
            // has the account paused, a contact of several companies is detached from this one; StratEdge or a
            // full-access person of the same company; never oneself, never the last full-access person
            $needManage();
            $uid = $str('uid', 40);
            if (!isset($contacts[$uid]) || $uid === $u['id']) {
                fail(400, 'invalid_argument', 'Choose a colleague of this company (not yourself).');
            }
            $fullLeft = 0;
            foreach ($contacts as $cuid => $c) {
                if ($cuid !== $uid && (($d['people'][$cuid]['role'] ?? 'full') === 'full')) {
                    $fullLeft++;
                }
            }
            if ($fullLeft === 0) {
                fail(409, 'conflict', 'That is the company\'s last full-access person; give someone else full access first.');
            }
            require_once __DIR__ . '/sessions.php';
            $why = $str('msg', 300);
            $others = array_values(array_diff(myCids($uid), [$cid]));
            $row = userRow($uid);
            $rr = docGet('r/' . $uid) ?? new stdClass();
            if (!$others) {
                db()->prepare("UPDATE users SET status = 'inactive' WHERE id = ?")->execute([$uid]);
                $rr->st = 'inactive';
            } else {
                // keep their other companies: the primary one moves to the next, the extra list loses this one
                $a = accessOf($row);
                $a['cids'] = array_values(array_diff($a['cids'], [$cid]));
                if ((string) ($rr->cid ?? '') === $cid) {
                    $rr->cid = $others[0];
                    $a['cids'] = array_values(array_diff($a['cids'], [$others[0]]));
                }
                db()->prepare('UPDATE users SET access = ? WHERE id = ?')->execute([json_encode(['portals' => $a['portals'], 'cids' => $a['cids']]), $uid]);
            }
            $rr->u = now();
            docSet('r/' . $uid, $rr);
            $n = sessRevokeAll($uid, 'access revoked by ' . $u['name'] . ($why !== '' ? ': ' . $why : ''));
            unset($d['people'][$uid]);
            // their delegations end too
            foreach ($d['deleg'] as &$x) {
                if (((string) $x['from'] === $uid || (string) $x['to'] === $uid) && empty($x['ended'])) {
                    $x['ended'] = (string) $u['name'];
                    $x['endedAt'] = now();
                }
            }
            unset($x);
            caSave($cid, $d);
            audit('access', 'Client contact access revoked', (string) ($contacts[$uid]['e'] ?? $uid), ['company' => $co, 'why' => $why, 'sessions' => $n, 'paused' => !$others], $u);
            if ($row && filter_var((string) $row['email'], FILTER_VALIDATE_EMAIL)) {
                $paras = [$u['name'] . ' ended your access to ' . $co . ($others ? '. Your other companies are not affected.' : '; your portal account is paused.') . ($why !== '' ? ' Reason given: ' . $why : ''), 'If this is a mistake, ask ' . $co . ' or StratEdge.'];
                try {
                    sendMail((string) $row['email'], (string) $row['name'], 'Your access to ' . $co . ' on the StratEdge portal ended', implode("\n\n", $paras), emailHtml('Access ended', $paras));
                } catch (Throwable $e) {
                    // recorded either way
                }
            }
            ok(['ok' => true, 'sessions' => $n, 'paused' => !$others]);

        case 'cr_acc_review':
            // an access review: who looked, when, what was decided; the people and roles as they stood
            $needManage();
            $note = $str('msg', 2000);
            if (mb_strlen($note) < 5) {
                fail(400, 'invalid_argument', 'Write what was reviewed and decided.');
            }
            $snap = array_map(fn($x) => ['n' => $x['n'], 'role' => $x['role'], 'units' => $x['units']], caPeopleView($cid));
            $d['reviews'][] = ['at' => now(), 'by' => (string) $u['name'], 'uid' => $u['id'], 'staff' => $staff, 'note' => $note, 'people' => $snap, 'deleg' => count(caActiveDelegations($cid))];
            $d['reviews'] = array_slice($d['reviews'], -50);
            caSave($cid, $d);
            audit('access', 'Client access review recorded', $co, ['people' => count($snap), 'note' => mb_substr($note, 0, 200)], $u);
            $home();
    }
    fail(404, 'not_found', 'Unknown request.');
}
