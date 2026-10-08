<?php
declare(strict_types=1);
/*
 * v47 Corporate clients: talent requests with approval, and proposals.
 *
 * A talent request (CC-01) is a client company's structured brief for a role: business objective, skills, headcount,
 * location, dates, engagement model, budget unit and range, hiring owner, cost center. The client's contact drafts and
 * submits it; StratEdge's account manager reviews it (asks questions or confirms it); the company's approvers approve,
 * return it with questions, or put it on hold; StratEdge then starts sourcing, which makes the requirement on the
 * requirements desk. After approval, a change to an essential field (headcount, budget, must-have skills, engagement,
 * location, work arrangement) is a new version that needs approval again, with the changes shown; the approved
 * version stays with the requirement until then. A decision StratEdge records for the client carries its evidence.
 *
 * A proposal (CC-06) is a scoped offer to a client company: the service model, scope, deliverables, exclusions, the
 * client's part, commercial lines with their own units (an hourly rate, a placement fee as a share of salary, a
 * monthly fee, a milestone), assumptions, terms and a validity date. Each shared version is kept; the client sees
 * only shared versions, may ask a question, decline, or accept (an authorized person, by typed name). Viewing is
 * recorded, never as acceptance.
 *
 * Who: StratEdge staff who work client accounts (administrators, HR, recruiting team, the CRM feature) and the client
 * company's own contacts (the client portal). Tables (main database): cr_req, cr_ver, cr_prop, cr_pver, cr_ev, cr_cfg.
 */

const CR_ST = [
    'draft' => 'Draft', 'review' => 'With StratEdge', 'questions' => 'Questions for you', 'approval' => 'Waiting for approval', 'returned' => 'Returned for changes',
    'approved' => 'Approved', 'active' => 'Sourcing', 'hold' => 'On hold', 'filled' => 'Filled', 'cancelled' => 'Cancelled',
];
const CR_OPEN = ['draft', 'review', 'questions', 'approval', 'returned', 'approved', 'active', 'hold'];
const CR_ENG = ['contract' => 'Contract', 'c2h' => 'Contract to hire', 'perm' => 'Full-time (permanent)', 'sow' => 'Project (statement of work)'];
const CR_BU = ['hour' => 'per hour', 'year' => 'per year (salary)', 'fixed' => 'fixed price', 'tbd' => 'to be discussed'];
/** The fields whose change after approval needs approving again (a company may narrow the list). */
const CR_ESSENTIAL = ['n' => 'Headcount', 'must' => 'Must-have skills', 'eng' => 'Engagement', 'bu' => 'Budget unit', 'bmin' => 'Budget from', 'bmax' => 'Budget to', 'cur' => 'Currency', 'loc' => 'Location', 'md' => 'Work arrangement'];
const CR_FIELDS = [
    'ti' => 'Role', 'obj' => 'Business objective', 'must' => 'Must-have skills', 'nice' => 'Nice-to-have skills', 'resp' => 'What the person will do', 'n' => 'Headcount',
    'loc' => 'Location', 'md' => 'Work arrangement', 'sd' => 'Target start', 'dur' => 'Duration', 'eng' => 'Engagement', 'bu' => 'Budget unit', 'bmin' => 'Budget from',
    'bmax' => 'Budget to', 'cur' => 'Currency', 'mgr' => 'Hiring owner', 'mgre' => 'Hiring owner email', 'cc' => 'Cost center', 'unit' => 'Business unit',
    'intv' => 'Interview process', 'visa' => 'Work authorization', 'ext' => 'Your requisition reference',
];
const CR_PST = ['draft' => 'Draft', 'shared' => 'Shared', 'question' => 'Question from the client', 'accepted' => 'Accepted', 'declined' => 'Declined', 'withdrawn' => 'Withdrawn', 'expired' => 'Expired'];
const CR_MODELS = ['contract' => 'Contract staffing', 'c2h' => 'Contract to hire', 'perm' => 'Permanent placement', 'support' => 'Recruitment support', 'sow' => 'Project services (statement of work)'];
const CR_UNITS = ['hour' => 'per hour', 'day' => 'per day', 'month' => 'per month', 'pct' => '% of first-year salary', 'fee' => 'fee', 'milestone' => 'milestone', 'fixed' => 'fixed price'];
const CR_CURS = ['USD', 'CAD', 'EUR', 'GBP', 'INR'];

function crDb(): PDO
{
    static $ready = false;
    $p = db();
    if (!$ready) {
        $ready = true;
        $p->exec("CREATE TABLE IF NOT EXISTS cr_req (id VARCHAR(20) PRIMARY KEY, cid VARCHAR(40) NOT NULL, ti VARCHAR(160) NOT NULL, st VARCHAR(12) NOT NULL, prev_st VARCHAR(12) NOT NULL DEFAULT '', ver INT NOT NULL DEFAULT 1, apv_ver INT NOT NULL DEFAULT 0, owner VARCHAR(40) NOT NULL DEFAULT '', by_uid VARCHAR(40) NOT NULL, vreq VARCHAR(40) NOT NULL DEFAULT '', data TEXT NOT NULL, appr TEXT NOT NULL, at BIGINT NOT NULL, u BIGINT NOT NULL)");
        $p->exec('CREATE INDEX IF NOT EXISTS cr_req_cid ON cr_req (cid, st)');
        $p->exec("CREATE TABLE IF NOT EXISTS cr_ver (id VARCHAR(20) PRIMARY KEY, req VARCHAR(20) NOT NULL, n INT NOT NULL, data TEXT NOT NULL, by_uid VARCHAR(40) NOT NULL, byn VARCHAR(120) NOT NULL DEFAULT '', at BIGINT NOT NULL, note VARCHAR(500) NOT NULL DEFAULT '', apv_at BIGINT NOT NULL DEFAULT 0, apv_by VARCHAR(500) NOT NULL DEFAULT '')");
        $p->exec('CREATE INDEX IF NOT EXISTS cr_ver_req ON cr_ver (req, n)');
        $p->exec("CREATE TABLE IF NOT EXISTS cr_prop (id VARCHAR(20) PRIMARY KEY, cid VARCHAR(40) NOT NULL, req VARCHAR(20) NOT NULL DEFAULT '', ti VARCHAR(160) NOT NULL, st VARCHAR(12) NOT NULL, ver INT NOT NULL DEFAULT 0, draft TEXT NOT NULL, owner VARCHAR(40) NOT NULL, to_uids TEXT NOT NULL, viewed_at BIGINT NOT NULL DEFAULT 0, dec TEXT NOT NULL, at BIGINT NOT NULL, u BIGINT NOT NULL)");
        $p->exec('CREATE INDEX IF NOT EXISTS cr_prop_cid ON cr_prop (cid, st)');
        $p->exec("CREATE TABLE IF NOT EXISTS cr_pver (id VARCHAR(20) PRIMARY KEY, prop VARCHAR(20) NOT NULL, n INT NOT NULL, data TEXT NOT NULL, by_uid VARCHAR(40) NOT NULL, byn VARCHAR(120) NOT NULL DEFAULT '', at BIGINT NOT NULL, note VARCHAR(500) NOT NULL DEFAULT '')");
        $p->exec('CREATE INDEX IF NOT EXISTS cr_pver_prop ON cr_pver (prop, n)');
        $p->exec("CREATE TABLE IF NOT EXISTS cr_ev (id VARCHAR(20) PRIMARY KEY, kind VARCHAR(4) NOT NULL, ref VARCHAR(20) NOT NULL, at BIGINT NOT NULL, by_uid VARCHAR(40) NOT NULL, byn VARCHAR(120) NOT NULL DEFAULT '', side VARCHAR(8) NOT NULL, ev VARCHAR(16) NOT NULL, msg TEXT NOT NULL, vis INT NOT NULL DEFAULT 1)");
        $p->exec('CREATE INDEX IF NOT EXISTS cr_ev_ref ON cr_ev (kind, ref, at)');
        $p->exec('CREATE TABLE IF NOT EXISTS cr_cfg (cid VARCHAR(40) PRIMARY KEY, data TEXT NOT NULL, u BIGINT NOT NULL)');
    }
    return $p;
}
/** StratEdge people who work client accounts. */
function crStaff(array $u): bool
{
    return hasRole($u, 'admin') || hasRole($u, 'hr') || isBench((string) $u['id']) || grantOf((string) $u['id'], 'crm');
}
function crCompanyName(string $cid): string
{
    $d = docGet('org/admin/clients/' . $cid);
    return (string) ($d->n ?? $cid);
}
/** A client company's contacts (people of that company with an account), active ones: [uid => [id, n, e]]. */
function crContacts(string $cid): array
{
    // read once per request: the queue asks for the same companies many times
    static $memo = [];
    static $byCid = null;
    if (isset($memo[$cid])) {
        return $memo[$cid];
    }
    if ($byCid === null) {
        $byCid = [];
        foreach (colAll('r') as [$uid, $d]) {
            if ((string) ($d->cid ?? '') !== '') {
                $byCid[(string) $d->cid][(string) $uid] = true;
            }
        }
    }
    $ids = $byCid[$cid] ?? [];
    $s = db()->prepare('SELECT id FROM users WHERE access LIKE ?');
    $s->execute(['%"' . $cid . '"%']);
    foreach ($s->fetchAll() as $r) {
        $ids[(string) $r['id']] = true;
    }
    $out = [];
    foreach (array_keys($ids) as $uid) {
        $row = userRow($uid);
        if ($row && (string) $row['status'] === 'active' && in_array($cid, myCids($uid), true)) {
            $out[$uid] = ['id' => $uid, 'n' => (string) $row['name'], 'e' => (string) $row['email']];
        }
    }
    return $memo[$cid] = $out;
}
/** The company's settings: account manager, approvers (and whether one or all must approve), the fields that need re-approval. */
function crCfg(string $cid, bool $fresh = false): array
{
    static $memo = [];
    if (!$fresh && isset($memo[$cid])) {
        return $memo[$cid];
    }
    $s = crDb()->prepare('SELECT data FROM cr_cfg WHERE cid = ?');
    $s->execute([$cid]);
    $d = json_decode((string) ($s->fetchColumn() ?: '{}'), true) ?: [];
    return $memo[$cid] = ['owner' => (string) ($d['owner'] ?? ''), 'appr' => array_values(array_map('strval', (array) ($d['appr'] ?? []))), 'rule' => ($d['rule'] ?? 'any') === 'all' ? 'all' : 'any', 'ess' => array_values(array_intersect(array_keys(CR_ESSENTIAL), (array) ($d['ess'] ?? array_keys(CR_ESSENTIAL))))];
}
function crEv(string $kind, string $ref, array $u, string $side, string $ev, string $msg = '', bool $vis = true): void
{
    crDb()->prepare('INSERT INTO cr_ev (id, kind, ref, at, by_uid, byn, side, ev, msg, vis) VALUES (?,?,?,?,?,?,?,?,?,?)')->execute([rid(9), $kind, $ref, now(), (string) ($u['id'] ?? ''), (string) ($u['name'] ?? ''), $side, $ev, mb_substr($msg, 0, 4000), $vis ? 1 : 0]);
}
/** A brief from the page, cleaned. */
function crBriefIn($in): array
{
    $a = (array) $in;
    $s = fn(string $k, int $max) => mb_substr(trim((string) ($a[$k] ?? '')), 0, $max);
    $num = function (string $k) use ($a): string {
        $v = trim((string) ($a[$k] ?? ''));
        return $v === '' ? '' : (is_numeric($v) && (float) $v >= 0 && (float) $v < 100000000 ? (string) (0 + $v) : '');
    };
    $md = $s('md', 12);
    $d = [
        'ti' => $s('ti', 160), 'obj' => $s('obj', 2000), 'must' => $s('must', 1000), 'nice' => $s('nice', 1000), 'resp' => $s('resp', 8000),
        'n' => (string) max(1, min(99, (int) ($a['n'] ?? 1))), 'loc' => $s('loc', 160), 'md' => in_array($md, ['Onsite', 'Hybrid', 'Remote'], true) ? $md : 'Onsite',
        'sd' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($a['sd'] ?? '')) ? (string) $a['sd'] : '', 'dur' => $s('dur', 60),
        'eng' => isset(CR_ENG[(string) ($a['eng'] ?? '')]) ? (string) $a['eng'] : 'contract', 'bu' => isset(CR_BU[(string) ($a['bu'] ?? '')]) ? (string) $a['bu'] : 'tbd',
        'bmin' => $num('bmin'), 'bmax' => $num('bmax'), 'cur' => in_array((string) ($a['cur'] ?? 'USD'), CR_CURS, true) ? (string) ($a['cur'] ?? 'USD') : 'USD',
        'mgr' => $s('mgr', 120), 'mgre' => strtolower($s('mgre', 190)), 'cc' => $s('cc', 60), 'unit' => $s('unit', 120), 'intv' => $s('intv', 1000), 'visa' => $s('visa', 200), 'ext' => $s('ext', 80),
    ];
    if ($d['bu'] === 'tbd') {
        $d['bmin'] = '';
        $d['bmax'] = '';
    }
    if ($d['bmin'] !== '' && $d['bmax'] !== '' && (float) $d['bmax'] < (float) $d['bmin']) {
        fail(400, 'invalid_argument', 'The budget\'s upper end is below its lower end.');
    }
    if ($d['mgre'] !== '' && !filter_var($d['mgre'], FILTER_VALIDATE_EMAIL)) {
        fail(400, 'invalid_argument', 'The hiring owner\'s email is not valid.');
    }
    return $d;
}
/** What a brief needs before it can be submitted ('' when complete). */
function crBriefMissing(array $d): string
{
    $miss = [];
    foreach (['ti' => 'the role', 'must' => 'the must-have skills', 'loc' => 'the location', 'obj' => 'the business objective'] as $k => $n) {
        if (trim((string) $d[$k]) === '') {
            $miss[] = $n;
        }
    }
    if ($d['bu'] !== 'tbd' && $d['bmin'] === '' && $d['bmax'] === '') {
        $miss[] = 'the budget (or "to be discussed")';
    }
    return $miss ? 'Add ' . implode(', ', $miss) . ' before sending it.' : '';
}
/** The fields that differ between two briefs: [[field, label, before, after]]. */
function crDiff(array $a, array $b): array
{
    $out = [];
    foreach (CR_FIELDS as $k => $n) {
        $x = (string) ($a[$k] ?? '');
        $y = (string) ($b[$k] ?? '');
        if ($x !== $y) {
            $out[] = [$k, $n, $x, $y];
        }
    }
    return $out;
}
function crBudget(array $d): string
{
    if (($d['bu'] ?? 'tbd') === 'tbd') {
        return 'To be discussed';
    }
    $f = fn($v) => $v === '' ? '' : number_format((float) $v, (float) $v == floor((float) $v) ? 0 : 2);
    $r = $d['bmin'] !== '' && $d['bmax'] !== '' ? $f($d['bmin']) . '–' . $f($d['bmax']) : ($d['bmin'] !== '' ? 'from ' . $f($d['bmin']) : 'up to ' . $f($d['bmax']));
    return $d['cur'] . ' ' . $r . ' ' . CR_BU[$d['bu']];
}
function crReqRow(string $id): ?array
{
    $s = crDb()->prepare('SELECT * FROM cr_req WHERE id = ?');
    $s->execute([$id]);
    $r = $s->fetch();
    if (!$r) {
        return null;
    }
    $r['data'] = json_decode((string) $r['data'], true) ?: [];
    $r['appr'] = json_decode((string) $r['appr'], true) ?: [];
    return $r;
}
/** May this person see the request: StratEdge staff, or a contact of the request's company. */
function crReqFor(string $id, array $u): array
{
    $r = crReqRow($id);
    if (!$r || !(crStaff($u) || in_array((string) $r['cid'], myCids($u['id']), true)) || ((string) $r['st'] === 'draft' && (string) $r['by_uid'] !== $u['id'])) {
        fail(404, 'not_found', 'No such request.');
    }
    // v64: a contact's role and business units (a request outside them does not exist for them)
    if (!crStaff($u)) {
        require_once __DIR__ . '/corpacc.php';
        if (!caReqOk(caAccess($u, (string) $r['cid']), $r)) {
            fail(404, 'not_found', 'No such request.');
        }
    }
    return $r;
}
function crSetReq(string $id, array $f): void
{
    $sets = [];
    $vals = [];
    foreach ($f as $k => $v) {
        $sets[] = "$k = ?";
        $vals[] = is_array($v) ? json_encode($v) : $v;
    }
    $sets[] = 'u = ?';
    $vals[] = now();
    $vals[] = $id;
    crDb()->prepare('UPDATE cr_req SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($vals);
}
/** Who may change the brief now: the company's contacts while it is theirs to change (and after approval, as a new
 *  version); StratEdge while it reviews it, and after approval. Nobody while approvers decide. */
function crMayEdit(array $q, array $u, bool $staff): bool
{
    $st = (string) $q['st'];
    if ($staff) {
        return in_array($st, ['review', 'questions', 'returned', 'approved', 'active', 'hold'], true) || ($st === 'draft' && (string) $q['by_uid'] === $u['id']);
    }
    return in_array((string) $q['cid'], myCids($u['id']), true) && in_array($st, ['draft', 'questions', 'returned', 'approved', 'active', 'hold'], true);
}
/** Version 1, made when a draft first leaves its author. */
function crVerOne(array $q, array $u): void
{
    crDb()->prepare('INSERT INTO cr_ver (id, req, n, data, by_uid, byn, at, note) VALUES (?,?,?,?,?,?,?,?)')->execute([rid(8), (string) $q['id'], 1, json_encode($q['data']), $u['id'], (string) $u['name'], now(), '']);
}
/** The approvers of a request's company ([uid => contact]); none named means any contact of the company may approve.
 *  The person who wrote the request does not approve it themselves when someone else can. */
function crApprovers(array $r): array
{
    $cfg = crCfg((string) $r['cid']);
    $all = crContacts((string) $r['cid']);
    $named = array_intersect_key($all, array_flip($cfg['appr']));
    $set = $named ?: $all;
    // v64: a contact outside the request's business unit (or whose role cannot read requests) does not approve it
    require_once __DIR__ . '/corpacc.php';
    foreach ($set as $uid => $c) {
        $row = userRow((string) $uid);
        if ($row && !caReqOk(caAccess($row, (string) $r['cid']), $r)) {
            unset($set[$uid]);
        }
    }
    if (count($set) > 1) {
        unset($set[(string) $r['by_uid']]);
    }
    // v64: an active delegation lets the delegate approve for an approver who remains ('for' = the delegator); the
    // requester's own delegate never approves for them
    foreach (caActiveDelegations((string) $r['cid']) as $dg) {
        $from = (string) ($dg['from'] ?? '');
        $to = (string) ($dg['to'] ?? '');
        if (isset($set[$from]) && isset($all[$to]) && !isset($set[$to]) && $to !== (string) $r['by_uid']) {
            $row = userRow($to);
            if ($row && caReqOk(caAccess($row, (string) $r['cid']), $r)) {
                $set[$to] = ['n' => (string) $all[$to]['n'] . ' (for ' . (string) ($all[$from]['n'] ?? '') . ')'] + $all[$to] + ['for' => $from, 'forN' => (string) ($all[$from]['n'] ?? '')];
            }
        }
    }
    return [$set, $cfg['rule'], (bool) $named];
}
/** Who acts next on a request, in words, and whether that is the caller. */
/** v48: a request's shortlist: the candidates the caller sees, and those shared that wait for the client's decision. */
function crSlCounts(string $req, bool $staff): array
{
    require_once __DIR__ . '/corpsl.php';
    $s = slDb()->prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN st = 'shared' AND ver > 0 THEN 1 ELSE 0 END) AS w FROM cr_sl WHERE req = ?" . ($staff ? '' : ' AND ver > 0'));
    $s->execute([$req]);
    $x = $s->fetch() ?: [];
    return ['n' => (int) ($x['n'] ?? 0), 'wait' => (int) ($x['w'] ?? 0)];
}
function crNext(array $r, array $u, bool $staff): array
{
    $st = (string) $r['st'];
    // v48: while sourcing, candidates waiting for a decision make the requester next
    if ($st === 'active' && ($w = crSlCounts((string) $r['id'], false)['wait']) > 0) {
        $by = userRow((string) $r['by_uid']);
        return [($by ? (string) $by['name'] : 'The requester') . ' (' . $w . ' candidate' . ($w === 1 ? '' : 's') . ' to review)', (string) $r['by_uid'] === $u['id']];
    }
    if (in_array($st, ['review', 'approved', 'active'], true)) {
        $o = (string) $r['owner'];
        return ['StratEdge' . ($o !== '' ? ' (' . (string) (userRow($o)['name'] ?? '') . ')' : ''), $staff];
    }
    if (in_array($st, ['draft', 'questions', 'returned'], true)) {
        $by = userRow((string) $r['by_uid']);
        return [($by ? (string) $by['name'] : 'The requester'), (string) $r['by_uid'] === $u['id']];
    }
    if ($st === 'approval') {
        [$aps, $rule] = crApprovers($r);
        $waiting = array_filter($aps, fn($x, $k) => !isset($r['appr'][$k]) && !isset($r['appr'][(string) ($x['for'] ?? '-')]), ARRAY_FILTER_USE_BOTH);
        $names = array_map(fn($x) => $x['n'], $waiting);
        return [$names ? ($rule === 'all' ? implode(', ', $names) : implode(' or ', $names)) : 'An approver', isset($waiting[$u['id']])];
    }
    if ($st === 'hold') {
        return ['Whoever put it on hold', false];
    }
    return ['', false];
}
function crReqView(array $r, array $u, bool $staff): array
{
    [$who, $mine] = crNext($r, $u, $staff);
    $by = userRow((string) $r['by_uid']);
    return [
        'id' => (string) $r['id'], 'cid' => (string) $r['cid'], 'co' => crCompanyName((string) $r['cid']), 'ti' => (string) $r['ti'], 'st' => (string) $r['st'], 'ver' => (int) $r['ver'], 'apvVer' => (int) $r['apv_ver'],
        'owner' => (string) $r['owner'], 'ownerN' => (string) $r['owner'] !== '' ? (string) (userRow((string) $r['owner'])['name'] ?? '') : '', 'by' => (string) $r['by_uid'], 'byN' => $by ? (string) $by['name'] : '',
        'vreq' => $staff ? (string) $r['vreq'] : ((string) $r['vreq'] !== '' ? 'yes' : ''), 'n' => (int) ($r['data']['n'] ?? 1), 'loc' => (string) ($r['data']['loc'] ?? ''), 'eng' => (string) ($r['data']['eng'] ?? ''),
        'next' => $who, 'mine' => $mine, 'at' => (int) $r['at'], 'u' => (int) $r['u'],
    ];
}
/** Mail to people (uids) about a request or proposal, with the right link for each (client portal or staff page). */
function crMail(array $uids, string $subject, array $paras, string $kind, string $ref): void
{
    foreach (array_unique(array_filter($uids)) as $uid) {
        $row = userRow((string) $uid);
        if (!$row || (string) $row['status'] !== 'active' || !filter_var((string) $row['email'], FILTER_VALIDATE_EMAIL)) {
            continue;
        }
        $staff = crStaff($row);
        $roles = rolesOf($row);
        // v48: 'sl' is a request's shortlist (the request opens on its Shortlist tab)
        $tab = $kind === 'sl' ? '&tab=short' : '';
        // v49: 'pkt' is a company's supplier packet ($ref is the company)
        $page = $kind === 'pkt' ? 'supplier?c=' . $ref : ($kind === 'issue' ? 'clientreq?t=desk' . ($ref !== '' ? '&i=' . $ref : '') : ($kind === 'rv' ? 'clientreq?t=rv&v=' . $ref : ($kind === 'start' ? 'clientreq?t=desk&s=' . $ref : ($kind !== 'prop' ? 'clientreq?r=' . $ref . $tab : 'clientreq?t=props&p=' . $ref))));
        // v65: 'issue' is the delivery desk ($ref is the issue, or '' for the desk itself)
        // v66: 'rv' is a business review
        $cpage = $kind === 'pkt' ? 'supplier' : ($kind === 'issue' ? 'delivery' . ($ref !== '' ? '?i=' . $ref : '') : ($kind === 'rv' ? 'reviews?v=' . $ref : ($kind === 'start' ? 'delivery?s=' . $ref : ($kind !== 'prop' ? 'requirements?t=hiring&r=' . $ref . $tab : 'proposals?p=' . $ref))));
        $link = siteUrl() . ($staff ? '#/portal/' . (in_array('admin', $roles, true) ? 'admin/' : (in_array('hr', $roles, true) ? 'hr/' : 'tools/')) . $page : '#/portal/client/' . $cpage);
        try {
            sendMail((string) $row['email'], (string) $row['name'], $subject, implode("\n\n", $paras) . "\n\n" . $link, emailHtml($subject, $paras, ['Open it', $link]));
        } catch (Throwable $e) {
            // the work is saved either way
        }
    }
}
/** The StratEdge people to tell about a request: its account manager, else the company's, else HR and administrators who work client accounts. */
function crStaffToTell(array $r): array
{
    if ((string) $r['owner'] !== '') {
        return [(string) $r['owner']];
    }
    $cfg = crCfg((string) $r['cid']);
    if ($cfg['owner'] !== '') {
        return [$cfg['owner']];
    }
    $out = [];
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
/** The requirement on the desk, made from the approved brief (or brought up to date by a newly approved version). */
function crDeskFields(array $r): array
{
    require_once __DIR__ . '/vms.php';
    $d = $r['data'];
    $lines = array_filter([
        $d['obj'] !== '' ? "Business objective:\n" . $d['obj'] : '',
        $d['resp'] !== '' ? "What the person will do:\n" . $d['resp'] : '',
        $d['nice'] !== '' ? 'Nice to have: ' . $d['nice'] : '',
        $d['intv'] !== '' ? "Interview process:\n" . $d['intv'] : '',
        'Budget: ' . crBudget($d),
        $d['cc'] !== '' || $d['unit'] !== '' ? 'Cost center / unit: ' . trim($d['cc'] . ' ' . $d['unit']) : '',
        $d['ext'] !== '' ? 'Client requisition: ' . $d['ext'] : '',
        'Engagement: ' . (CR_ENG[$d['eng']] ?? $d['eng']) . '.',
        'From ' . crCompanyName((string) $r['cid']) . '\'s talent request, version ' . (int) $r['ver'] . '.',
    ]);
    // the desk's own engagement words (a contract's tax terms, W2 or C2C, are StratEdge's to set there)
    $ty = ['contract' => '', 'c2h' => 'Contract-to-hire', 'perm' => 'Full-time', 'sow' => 'SOW'][$d['eng']] ?? '';
    return vmsReqFields([
        // the client company is the direct client (as for a role a client contact posts in the client portal)
        'ti' => $d['ti'], 'cl' => crCompanyName((string) $r['cid']), 'vn' => crCompanyName((string) $r['cid']), 'loc' => $d['loc'], 'md' => $d['md'], 'ty' => $ty, 'rate' => $d['bu'] !== 'tbd' ? crBudget($d) : '',
        'dur' => $d['dur'], 'n' => (int) $d['n'], 'sd' => $d['sd'], 'sk' => $d['must'], 'visa' => $d['visa'], 'd' => implode("\n\n", $lines), 'cn' => $d['mgr'], 'ce' => $d['mgre'],
    ]);
}
/** Approval reached: the version is approved; the requirement on the desk (if any) takes the approved brief. */
function crApproved(array $r, array $u, string $how): void
{
    $p = crDb();
    $p->prepare('UPDATE cr_ver SET apv_at = ?, apv_by = ? WHERE req = ? AND n = ?')->execute([now(), mb_substr($how, 0, 500), (string) $r['id'], (int) $r['ver']]);
    $st = 'approved';
    if ((string) $r['vreq'] !== '') {
        require_once __DIR__ . '/vms.php';
        $q = docGet(VMS_REQ . '/' . $r['vreq']);
        if ($q) {
            foreach (crDeskFields($r) as $k => $v) {
                $q->$k = $v;
            }
            $q->cver = (int) $r['ver'];
            $q->u = now();
            docSet(VMS_REQ . '/' . $r['vreq'], $q);
            $st = 'active';
        }
    }
    crSetReq((string) $r['id'], ['st' => $st, 'apv_ver' => (int) $r['ver'], 'prev_st' => '']);
    crEv('req', (string) $r['id'], $u, 'system', 'approved', 'Version ' . (int) $r['ver'] . ' approved' . ($how !== '' ? ': ' . $how : '') . ($st === 'active' ? '. The requirement on the desk now follows it.' : '.'));
    crMail(array_merge(crStaffToTell($r), [(string) $r['by_uid']]), 'Approved: ' . $r['ti'], [crCompanyName((string) $r['cid']) . '\'s talent request "' . $r['ti'] . '" (version ' . (int) $r['ver'] . ') is approved.'], 'req', (string) $r['id']);
}

/* ---------- proposals ---------- */
/** A proposal's content from the page, cleaned. */
function crPropIn($in): array
{
    $a = (array) $in;
    $s = fn(string $k, int $max) => mb_substr(trim((string) ($a[$k] ?? '')), 0, $max);
    $list = fn(string $k) => array_values(array_filter(array_map(fn($x) => mb_substr(trim((string) $x), 0, 400), array_slice((array) ($a[$k] ?? []), 0, 30)), fn($x) => $x !== ''));
    $lines = [];
    foreach (array_slice((array) ($a['lines'] ?? []), 0, 30) as $l) {
        $l = (array) $l;
        $unit = isset(CR_UNITS[(string) ($l['unit'] ?? '')]) ? (string) $l['unit'] : 'fixed';
        $rate = is_numeric($l['rate'] ?? null) ? round((float) $l['rate'], 2) : null;
        $qty = is_numeric($l['qty'] ?? null) && (float) $l['qty'] > 0 ? round((float) $l['qty'], 2) : null;
        $d = mb_substr(trim((string) ($l['d'] ?? '')), 0, 300);
        if ($d === '' && $rate === null) {
            continue;
        }
        if ($rate === null || $rate < 0 || ($unit === 'pct' && $rate > 100)) {
            fail(400, 'invalid_argument', 'Each price line needs a rate' . ($unit === 'pct' ? ' between 0 and 100 (a percentage)' : '') . ': "' . ($d ?: 'a line') . '".');
        }
        $lines[] = ['d' => $d, 'unit' => $unit, 'rate' => $rate, 'qty' => $qty, 'cur' => in_array((string) ($l['cur'] ?? 'USD'), CR_CURS, true) ? (string) ($l['cur'] ?? 'USD') : 'USD', 'note' => mb_substr(trim((string) ($l['note'] ?? '')), 0, 300)];
    }
    return [
        'model' => isset(CR_MODELS[(string) ($a['model'] ?? '')]) ? (string) $a['model'] : 'contract', 'intro' => $s('intro', 4000),
        'scope' => $list('scope'), 'deliver' => $list('deliver'), 'excl' => $list('excl'), 'cresp' => $list('cresp'), 'lines' => $lines,
        'assume' => $s('assume', 4000), 'terms' => $s('terms', 2000), 'valid' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($a['valid'] ?? '')) ? (string) $a['valid'] : '', 'start' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($a['start'] ?? '')) ? (string) $a['start'] : '',
    ];
}
/**
 * Each line's amount and the totals per currency: a time-based line is rate × planned quantity, a fee, milestone or
 * fixed price is rate × quantity (1 when none); a share of salary has no amount (it depends on the salary), so it is
 * listed apart. Lines with no planned quantity for a time-based unit have no amount either.
 */
function crPropTotals(array $data): array
{
    $tot = [];
    $apart = [];
    $amounts = [];
    foreach ($data['lines'] as $i => $l) {
        $amt = null;
        if ($l['unit'] === 'pct') {
            $apart[] = $l['rate'] . '% of first-year salary' . ($l['d'] !== '' ? ' (' . $l['d'] . ')' : '');
        } elseif (in_array($l['unit'], ['hour', 'day', 'month'], true)) {
            $amt = $l['qty'] !== null ? round($l['rate'] * $l['qty'], 2) : null;
            if ($amt === null) {
                $apart[] = $l['cur'] . ' ' . $l['rate'] . ' ' . CR_UNITS[$l['unit']] . ($l['d'] !== '' ? ' (' . $l['d'] . ')' : '');
            }
        } else {
            $amt = round($l['rate'] * ($l['qty'] ?? 1), 2);
        }
        $amounts[$i] = $amt;
        if ($amt !== null) {
            $tot[$l['cur']] = round(($tot[$l['cur']] ?? 0) + $amt, 2);
        }
    }
    return ['amounts' => $amounts, 'tot' => $tot, 'apart' => $apart];
}
function crPropRow(string $id): ?array
{
    $s = crDb()->prepare('SELECT * FROM cr_prop WHERE id = ?');
    $s->execute([$id]);
    $r = $s->fetch();
    if (!$r) {
        return null;
    }
    $r['draft'] = json_decode((string) $r['draft'], true) ?: [];
    $r['to_uids'] = json_decode((string) $r['to_uids'], true) ?: [];
    $r['dec'] = json_decode((string) $r['dec'], true) ?: [];
    // a shared proposal past its validity date expires (an accepted or declined one keeps its decision)
    if (in_array((string) $r['st'], ['shared', 'question'], true) && (int) $r['ver'] > 0) {
        $v = crPropVer((string) $r['id'], (int) $r['ver']);
        if ($v && ($v['data']['valid'] ?? '') !== '' && $v['data']['valid'] < (new DateTimeImmutable('now', new DateTimeZone((string) (cfg('timezone') ?: 'America/New_York'))))->format('Y-m-d')) {
            crDb()->prepare("UPDATE cr_prop SET st = 'expired', u = ? WHERE id = ?")->execute([now(), (string) $r['id']]);
            crEv('prop', (string) $r['id'], ['id' => '', 'name' => ''], 'system', 'expired', 'Version ' . (int) $r['ver'] . ' passed its validity date (' . $v['data']['valid'] . ').');
            $r['st'] = 'expired';
        }
    }
    return $r;
}
function crPropVer(string $prop, int $n): ?array
{
    $s = crDb()->prepare('SELECT * FROM cr_pver WHERE prop = ? AND n = ?');
    $s->execute([$prop, $n]);
    $r = $s->fetch();
    if (!$r) {
        return null;
    }
    $r['data'] = json_decode((string) $r['data'], true) ?: [];
    return $r;
}
function crPropFor(string $id, array $u): array
{
    $r = crPropRow($id);
    $staff = crStaff($u);
    if (!$r || !($staff || (in_array((string) $r['cid'], myCids($u['id']), true) && (int) $r['ver'] > 0))) {
        fail(404, 'not_found', 'No such proposal.');
    }
    // v64: a contact whose role has no proposals does not see them
    if (!$staff) {
        require_once __DIR__ . '/corpacc.php';
        if (!caMay(caAccess($u, (string) $r['cid']), 'proposals')) {
            fail(404, 'not_found', 'No such proposal.');
        }
    }
    return $r;
}
function crPropView(array $r, bool $staff): array
{
    $v = (int) $r['ver'] > 0 ? crPropVer((string) $r['id'], (int) $r['ver']) : null;
    return [
        'id' => (string) $r['id'], 'cid' => (string) $r['cid'], 'co' => crCompanyName((string) $r['cid']), 'req' => (string) $r['req'], 'ti' => (string) $r['ti'], 'st' => (string) $r['st'], 'ver' => (int) $r['ver'],
        'model' => (string) (($v ? $v['data'] : $r['draft'])['model'] ?? ''), 'valid' => (string) (($v ? $v['data'] : [])['valid'] ?? ''), 'tot' => $v ? crPropTotals($v['data'])['tot'] : [],
        'owner' => (string) $r['owner'], 'ownerN' => (string) (userRow((string) $r['owner'])['name'] ?? ''), 'viewed' => (int) $r['viewed_at'], 'dec' => $r['dec'], 'at' => (int) $r['at'], 'u' => (int) $r['u'],
        'unshared' => $staff && (int) $r['ver'] > 0 && $v && json_encode($v['data']) !== json_encode($r['draft']),
    ];
}

function crRoute(string $r, array $b): never
{
    $u = requireUser();
    $staff = crStaff($u);
    $myC = myCids($u['id']);
    if (!$staff && !$myC) {
        fail(403, 'forbidden', 'Talent requests and proposals are for client companies and the StratEdge people who work with them.');
    }
    // v64: client roles, business units, delegation and access reviews (api/corpacc.php)
    require_once __DIR__ . '/corpacc.php';
    if (str_starts_with($r, 'cr_acc_')) {
        caRoute($r, $b, $u, $staff, $myC);
    }
    // v67: start plans of selected candidates (api/corpst.php)
    if (str_starts_with($r, 'cr_st_')) {
        require_once __DIR__ . '/corpst.php';
        stRoute($r, $b, $u, $staff, $myC);
    }
    // v66: account performance and business reviews (api/corprv.php)
    if (str_starts_with($r, 'cr_rv_')) {
        require_once __DIR__ . '/corprv.php';
        rvRoute($r, $b, $u, $staff, $myC);
    }
    // v65: the client delivery and escalation desk (api/corpdd.php)
    if (str_starts_with($r, 'cr_dd_') || str_starts_with($r, 'cr_issue_')) {
        require_once __DIR__ . '/corpdd.php';
        ddRoute($r, $b, $u, $staff, $myC);
    }
    // v48: the shortlist room of a request (api/corpsl.php)
    if (str_starts_with($r, 'cr_sl_')) {
        require_once __DIR__ . '/corpsl.php';
        slRoute($r, $b, $u, $staff, $myC);
    }
    // v50: the website's service pages and case evidence (api/corpweb.php)
    if (str_starts_with($r, 'cw_')) {
        require_once __DIR__ . '/corpweb.php';
        cwRoute($r, $b, $u, $staff);
    }
    // v49: supplier qualification (api/corpq.php)
    if (str_starts_with($r, 'cq_')) {
        require_once __DIR__ . '/corpq.php';
        cqRoute($r, $b, $u, $staff, $myC);
    }
    $p = crDb();
    $str = fn(string $k, int $max) => mb_substr(trim((string) ($b[$k] ?? '')), 0, $max);
    switch ($r) {
        case 'cr_home':
            // a client contact: their company's requests and shared proposals; staff: everything, with the companies
            $cid = $str('cid', 40);
            if (!$staff && !in_array($cid, $myC, true)) {
                $cid = $myC[0];
            }
            $where = $staff && $cid === '' ? '1 = 1' : 'cid = ' . $p->quote($cid);
            // v64: a contact sees the requests of their business units (when their role reads requests at all) and
            // proposals only when their role does
            $acc = $staff ? null : caAccess($u, $cid);
            $reqs = [];
            foreach ($p->query("SELECT * FROM cr_req WHERE $where AND (st <> 'draft' OR by_uid = " . $p->quote($u['id']) . ') ORDER BY u DESC LIMIT 500')->fetchAll() as $x) {
                $x['data'] = json_decode((string) $x['data'], true) ?: [];
                $x['appr'] = json_decode((string) $x['appr'], true) ?: [];
                if ($acc && !caReqOk($acc, $x)) {
                    continue;
                }
                $reqs[] = crReqView($x, $u, $staff);
            }
            $props = [];
            if (!$acc || caMay($acc, 'proposals')) {
                foreach ($p->query("SELECT id FROM cr_prop WHERE $where" . ($staff ? '' : ' AND ver > 0') . ' ORDER BY u DESC LIMIT 500')->fetchAll() as $x) {
                    $props[] = crPropView(crPropRow((string) $x['id']), $staff);
                }
            }
            $out = ['reqs' => $reqs, 'props' => $props, 'staff' => $staff, 'me' => $u['id'], 'st' => CR_ST, 'pst' => CR_PST, 'eng' => CR_ENG, 'bu' => CR_BU, 'fields' => CR_FIELDS, 'ess' => CR_ESSENTIAL, 'models' => CR_MODELS, 'units' => CR_UNITS, 'curs' => CR_CURS, 'acc' => $acc ? ['role' => $acc['role'], 'units' => $acc['units'], 'write' => caMay($acc, 'requests', 'w'), 'props' => caLevel($acc, 'proposals'), 'deleg' => count($acc['deleg'])] : null];
            if ($staff) {
                $cos = [];
                foreach (colAll('org/admin/clients') as [$id, $d]) {
                    $cos[] = ['id' => (string) $id, 'n' => (string) ($d->n ?? $id)];
                }
                usort($cos, fn($a, $c) => strcasecmp($a['n'], $c['n']));
                $team = [];
                foreach (db()->query("SELECT id, email, name, role, status, access FROM users WHERE status = 'active'")->fetchAll() as $row) {
                    if (crStaff($row)) {
                        $team[] = ['id' => (string) $row['id'], 'n' => (string) $row['name']];
                    }
                }
                $out += ['cos' => $cos, 'team' => $team];
            }
            if ($cid !== '') {
                // one company (a client contact's own, or StratEdge looking at the client portal of one)
                $cfg = crCfg($cid);
                $out += ['cid' => $cid, 'co' => crCompanyName($cid), 'cfg' => ['ownerN' => $cfg['owner'] !== '' ? (string) (userRow($cfg['owner'])['name'] ?? '') : '', 'rule' => $cfg['rule'], 'apprN' => array_values(array_map(fn($x) => $x['n'], array_intersect_key(crContacts($cid), array_flip($cfg['appr']))))]];
            }
            ok($out);

        case 'cr_waiting':
            // what waits for this client contact (the menu's badges and the dashboard): requests to approve or to
            // answer, and proposals shared with them that wait for a decision. Counts only.
            $cid = $str('cid', 40);
            if (!in_array($cid, $myC, true)) {
                ok(['reqs' => 0, 'props' => 0]);
            }
            // v64: only within the contact's role and business units
            $acc = caAccess($u, $cid);
            $n = 0;
            foreach ($p->query('SELECT * FROM cr_req WHERE cid = ' . $p->quote($cid) . " AND st IN ('questions', 'returned', 'approval', 'active')")->fetchAll() as $x) {
                $x['appr'] = json_decode((string) $x['appr'], true) ?: [];
                $x['data'] = json_decode((string) $x['data'], true) ?: [];
                if (caReqOk($acc, $x) && crNext($x, $u, false)[1]) {
                    $n++;
                }
            }
            $np = 0;
            foreach (caMay($acc, 'proposals') ? $p->query('SELECT id FROM cr_prop WHERE cid = ' . $p->quote($cid) . " AND ver > 0 AND st IN ('shared', 'question')")->fetchAll() : [] as $x) {
                $pr = crPropRow((string) $x['id']);
                if ($pr && in_array((string) $pr['st'], ['shared', 'question'], true) && in_array($u['id'], (array) $pr['to_uids'], true)) {
                    $np++;
                }
            }
            // v49: documents StratEdge supplied that wait for this person's review (they are among the packet's
            // people to tell, or nobody was named)
            $nd = 0;
            require_once __DIR__ . '/corpq.php';
            $pk = caMay($acc, 'supplier') ? cqPkt($cid) : null;
            if ($pk && (string) $pk['st'] === 'open' && (!$pk['to_uids'] || in_array($u['id'], (array) $pk['to_uids'], true))) {
                $s = cqDb()->prepare("SELECT COUNT(*) FROM cq_item WHERE pkt = ? AND st = 'supplied'");
                $s->execute([(string) $pk['id']]);
                $nd = (int) $s->fetchColumn();
            }
            ok(['reqs' => $n, 'props' => $np, 'docs' => $nd]);

        case 'cr_cfg_get':
        case 'cr_cfg_save':
            if (!$staff) {
                fail(403, 'forbidden', 'StratEdge sets who approves for a company.');
            }
            $cid = $str('cid', 40);
            if (!docGet('org/admin/clients/' . $cid)) {
                fail(404, 'not_found', 'No such client company.');
            }
            $contacts = crContacts($cid);
            if ($r === 'cr_cfg_save') {
                $appr = array_values(array_intersect(array_map('strval', (array) ($b['appr'] ?? [])), array_keys($contacts)));
                $owner = $str('owner', 40);
                $ow = $owner !== '' ? userRow($owner) : null;
                if ($owner !== '' && !($ow && crStaff($ow))) {
                    fail(400, 'invalid_argument', 'The account manager must be someone at StratEdge who works client accounts.');
                }
                $ess = array_values(array_intersect(array_keys(CR_ESSENTIAL), array_map('strval', (array) ($b['ess'] ?? []))));
                $data = ['owner' => $owner, 'appr' => $appr, 'rule' => ($b['rule'] ?? 'any') === 'all' ? 'all' : 'any', 'ess' => $ess];
                $p->prepare('DELETE FROM cr_cfg WHERE cid = ?')->execute([$cid]);
                $p->prepare('INSERT INTO cr_cfg (cid, data, u) VALUES (?,?,?)')->execute([$cid, json_encode($data), now()]);
                audit('client', 'Talent request settings changed', crCompanyName($cid), $data, $u);
            }
            ok(['cfg' => crCfg($cid, true), 'contacts' => array_values($contacts), 'co' => crCompanyName($cid)]);

        case 'cr_req_get':
            $q = crReqFor($str('id', 20), $u);
            $vers = [];
            $s = $p->prepare('SELECT * FROM cr_ver WHERE req = ? ORDER BY n');
            $s->execute([(string) $q['id']]);
            foreach ($s->fetchAll() as $v) {
                $vers[] = ['n' => (int) $v['n'], 'data' => json_decode((string) $v['data'], true) ?: [], 'byn' => (string) $v['byn'], 'at' => (int) $v['at'], 'note' => (string) $v['note'], 'apvAt' => (int) $v['apv_at'], 'apvBy' => (string) $v['apv_by']];
            }
            $s = $p->prepare("SELECT * FROM cr_ev WHERE kind = 'req' AND ref = ?" . ($staff ? '' : ' AND vis = 1') . ' ORDER BY at');
            $s->execute([(string) $q['id']]);
            $evs = array_map(fn($e) => ['at' => (int) $e['at'], 'byn' => (string) $e['byn'], 'side' => (string) $e['side'], 'ev' => (string) $e['ev'], 'msg' => (string) $e['msg'], 'vis' => (int) $e['vis'] === 1], $s->fetchAll());
            [$aps, $rule, $named] = crApprovers($q);
            $prog = null;
            if ((string) $q['vreq'] !== '') {
                // progress on the desk: its status and how many profiles went out (no candidate details here), and for
                // each profile the version that was in force when it went out (the latest one approved by then): a
                // later version never rewrites what a profile was sent against
                $vq = docGet('vms/req/items/' . $q['vreq']);
                $subs = 0;
                $byVer = [];
                $apv = array_values(array_filter($vers, fn($v) => $v['apvAt'] > 0));
                foreach (colAll('rec/sub/items') as [, $sd]) {
                    if ((string) ($sd->vreq ?? '') === (string) $q['vreq'] && !in_array((string) ($sd->st ?? ''), ['shortlisted', 'approval', 'ready'], true)) {
                        $subs++;
                        $sent = (int) ($sd->pk->at ?? ($sd->at ?? 0));
                        $vn = $apv ? $apv[0]['n'] : (int) $q['apv_ver'];
                        foreach ($apv as $v) {
                            if ($v['apvAt'] <= $sent) {
                                $vn = $v['n'];
                            }
                        }
                        $byVer[$vn] = ($byVer[$vn] ?? 0) + 1;
                    }
                }
                ksort($byVer);
                $prog = ['st' => (string) ($vq->st ?? ''), 'subs' => $subs, 'cver' => (int) ($vq->cver ?? 0), 'byVer' => array_map(fn($k, $n) => ['v' => (int) $k, 'n' => $n], array_keys($byVer), array_values($byVer))];
            }
            $isReq = (string) $q['by_uid'] === $u['id'];
            $isAp = isset($aps[$u['id']]) && !$staff;
            $st = (string) $q['st'];
            $can = [
                'edit' => crMayEdit($q, $u, $staff),
                'submit' => !$staff && in_array($st, ['draft', 'questions', 'returned'], true) && in_array((string) $q['cid'], $myC, true),
                'approve' => $isAp && $st === 'approval' && !isset($q['appr'][$u['id']]) && !isset($q['appr'][(string) ($aps[$u['id']]['for'] ?? '-')]),
                'confirm' => $staff && ($st === 'review' || ($st === 'draft' && $isReq)), 'ask' => $staff && in_array($st, ['review', 'approval'], true), 'record' => $staff && $st === 'approval',
                'start' => $staff && $st === 'approved' && (string) $q['vreq'] === '', 'hold' => in_array($st, ['review', 'questions', 'approval', 'returned', 'approved', 'active'], true) && ($staff || $isAp || $isReq),
                'resume' => $st === 'hold' && ($staff || $isAp || $isReq), 'close' => $staff && in_array($st, CR_OPEN, true) && $st !== 'draft', 'withdraw' => !$staff && $isReq && in_array($st, ['draft', 'review', 'questions', 'approval', 'returned', 'approved'], true),
            ];
            ok([
                'req' => crReqView($q, $u, $staff) + ['data' => $q['data'], 'appr' => array_values(array_map(fn($k, $v) => ['n' => (string) ($v['n'] ?? $aps[$k]['n'] ?? ''), 'd' => (string) $v['d'], 'at' => (int) $v['at'], 'note' => (string) ($v['note'] ?? '')], array_keys((array) $q['appr']), (array) $q['appr']))],
                'vers' => $vers, 'evs' => $evs, 'approvers' => array_values(array_map(fn($x) => $x['n'], $aps)), 'named' => $named, 'rule' => $rule, 'ess' => crCfg((string) $q['cid'])['ess'], 'can' => $can, 'prog' => $prog, 'sl' => crSlCounts((string) $q['id'], $staff),
            ]);

        case 'cr_req_save':
            // a new request (a client contact for their company, or StratEdge on a company's behalf), or a change
            if (throttleHit('crsave:' . $u['id'], 200, 3600)) {
                fail(429, 'slow_down', 'Too many changes in an hour.');
            }
            $data = crBriefIn($b['data'] ?? []);
            $id = $str('id', 20);
            $note = $str('note', 500);
            if ($id === '') {
                $cid = $str('cid', 40);
                if (!($staff ? (bool) docGet('org/admin/clients/' . $cid) : in_array($cid, $myC, true))) {
                    fail(404, 'not_found', 'No such client company.');
                }
                // v64: a contact writes requests only when their role does, and only for their business units
                if (!$staff && !caReqOk(caAccess($u, $cid), ['data' => $data], 'w')) {
                    fail(403, 'forbidden', caMay(caAccess($u, $cid), 'requests', 'w') ? 'Your access covers other business units: ' . implode(', ', caAccess($u, $cid)['units']) . '.' : 'Your role at ' . crCompanyName($cid) . ' reads talent requests but does not write them.');
                }
                if ($data['ti'] === '') {
                    fail(400, 'invalid_argument', 'Name the role.');
                }
                $id = rid(8);
                $cfg = crCfg($cid);
                $p->prepare("INSERT INTO cr_req (id, cid, ti, st, ver, owner, by_uid, data, appr, at, u) VALUES (?,?,?,'draft',1,?,?,?,'{}',?,?)")->execute([$id, $cid, $data['ti'], $cfg['owner'], $u['id'], json_encode($data), now(), now()]);
                crEv('req', $id, $u, $staff ? 'staff' : 'client', 'created', $staff ? 'Entered by ' . $u['name'] . ' at StratEdge for ' . crCompanyName($cid) . ($note !== '' ? ': ' . $note : '') : 'Draft started.');
                ok(['id' => $id]);
            }
            $q = crReqFor($id, $u);
            $st = (string) $q['st'];
            if (!crMayEdit($q, $u, $staff)) {
                fail(409, 'conflict', $st === 'approval' ? 'It is waiting for approval: an approver returns it, or StratEdge asks questions, to change it.' : ($st === 'review' ? 'StratEdge is reviewing it: send a message, or wait for their questions.' : 'This request cannot be changed now.'));
            }
            if ($data['ti'] === '') {
                fail(400, 'invalid_argument', 'Name the role.');
            }
            $diff = crDiff($q['data'], $data);
            if (!$diff) {
                ok(['id' => $id, 'changed' => 0]);
            }
            $words = implode('; ', array_map(fn($d) => $d[1] . ': ' . ($d[2] !== '' ? mb_substr($d[2], 0, 60) : '—') . ' → ' . ($d[3] !== '' ? mb_substr($d[3], 0, 60) : '—'), $diff));
            $ess = array_intersect(array_column($diff, 0), crCfg((string) $q['cid'])['ess']);
            $after = (int) $q['apv_ver'] > 0 && (int) $q['ver'] === (int) $q['apv_ver'] && in_array($st, ['approved', 'active', 'hold'], true);
            if ($after && !$ess) {
                // after approval, a change to other fields is a new version that needs no approval (kept apart, so the
                // approved one stays as it was); the requirement on the desk follows it
                $nv = (int) $q['ver'] + 1;
                $p->prepare('INSERT INTO cr_ver (id, req, n, data, by_uid, byn, at, note, apv_at, apv_by) VALUES (?,?,?,?,?,?,?,?,?,?)')->execute([rid(8), $id, $nv, json_encode($data), $u['id'], (string) $u['name'], now(), $note, now(), 'no approval needed (no essential field changed)']);
                crSetReq($id, ['ti' => $data['ti'], 'data' => $data, 'ver' => $nv, 'apv_ver' => $nv]);
                crEv('req', $id, $u, $staff ? 'staff' : 'client', 'version', 'Version ' . $nv . ' (no approval needed): ' . $words . ($note !== '' ? '. Why: ' . $note : '') . '.');
                if ((string) $q['vreq'] !== '') {
                    require_once __DIR__ . '/vms.php';
                    $vq = docGet(VMS_REQ . '/' . $q['vreq']);
                    if ($vq) {
                        foreach (crDeskFields(['data' => $data, 'ver' => $nv] + $q) as $k => $v) {
                            $vq->$k = $v;
                        }
                        $vq->cver = $nv;
                        $vq->u = now();
                        docSet(VMS_REQ . '/' . $q['vreq'], $vq);
                    }
                }
                ok(['id' => $id, 'changed' => count($diff), 'reapprove' => false, 'ver' => $nv]);
            }
            if ($after && $ess) {
                // after approval, an essential change is a new version that needs approval again
                $nv = (int) $q['ver'] + 1;
                $p->prepare('INSERT INTO cr_ver (id, req, n, data, by_uid, byn, at, note) VALUES (?,?,?,?,?,?,?,?)')->execute([rid(8), $id, $nv, json_encode($data), $u['id'], (string) $u['name'], now(), $note]);
                crSetReq($id, ['ti' => $data['ti'], 'data' => $data, 'ver' => $nv, 'st' => 'approval', 'appr' => [], 'prev_st' => '']);
                crEv('req', $id, $u, $staff ? 'staff' : 'client', 'version', 'Version ' . $nv . ' needs approval (changed after approval: ' . $words . ')' . ($note !== '' ? '. Why: ' . $note : '') . '. Version ' . (int) $q['apv_ver'] . ' stays in force until then.');
                [$aps] = crApprovers($q);
                crMail(array_keys($aps), 'Please approve version ' . $nv . ': ' . $data['ti'], ['The talent request "' . $data['ti'] . '" changed after approval: ' . $words . '.', 'Approve the new version, or return it with your questions.'], 'req', $id);
                ok(['id' => $id, 'changed' => count($diff), 'reapprove' => true, 'ver' => $nv]);
            }
            // a version not approved yet (a draft, or one being reviewed, questioned or returned) is changed in place
            $p->prepare('UPDATE cr_ver SET data = ? WHERE req = ? AND n = ?')->execute([json_encode($data), $id, (int) $q['ver']]);
            crSetReq($id, ['ti' => $data['ti'], 'data' => $data]);
            if ($st !== 'draft') {
                crEv('req', $id, $u, $staff ? 'staff' : 'client', 'changed', 'Changed: ' . $words . ($note !== '' ? '. Why: ' . $note : ''));
            }
            ok(['id' => $id, 'changed' => count($diff), 'reapprove' => false]);

        case 'cr_req_act':
            $q = crReqFor($str('id', 20), $u);
            $id = (string) $q['id'];
            $st = (string) $q['st'];
            $act = (string) ($b['act'] ?? '');
            $msg = $str('msg', 4000);
            $side = $staff ? 'staff' : 'client';
            $co = crCompanyName((string) $q['cid']);
            $mineC = in_array((string) $q['cid'], $myC, true);
            [$aps, $rule] = crApprovers($q);
            $need = fn(bool $ok, string $why) => $ok ?: fail(409, 'conflict', $why);
            // v64: approving and returning follow the approver list; everything else a contact does needs a role that writes
            if (!$staff && !in_array($act, ['approve', 'return', 'msg'], true) && !caMay(caAccess($u, (string) $q['cid']), 'requests', 'w')) {
                fail(403, 'forbidden', 'Your role at ' . $co . ' reads talent requests but does not change them.');
            }
            if (in_array($act, ['msg', 'note'], true)) {
                if ($msg === '') {
                    fail(400, 'invalid_argument', 'Write the message.');
                }
                if ($act === 'note' && !$staff) {
                    fail(403, 'forbidden', 'Internal notes are for StratEdge.');
                }
                if ($act === 'msg' && $st === 'draft') {
                    fail(409, 'conflict', 'Send the request first: it is a draft only its author sees.');
                }
                crEv('req', $id, $u, $side, $act, $msg, $act === 'msg');
                if ($act === 'msg') {
                    crMail($staff ? array_merge([(string) $q['by_uid']], $st === 'approval' ? array_keys($aps) : []) : crStaffToTell($q), 'New message: ' . $q['ti'], [$u['name'] . ' wrote about "' . $q['ti'] . '" (' . $co . '):', $msg], 'req', $id);
                }
                ok(['ok' => true]);
            }
            switch ($act) {
                case 'submit':
                    $need(!$staff && $mineC && in_array($st, ['draft', 'questions', 'returned'], true), 'This request cannot be sent now.');
                    if (($miss = crBriefMissing($q['data'])) !== '') {
                        fail(400, 'invalid_argument', $miss);
                    }
                    if ($st === 'draft') {
                        crVerOne($q, $u);
                    }
                    crSetReq($id, ['st' => 'review', 'appr' => []]);
                    crEv('req', $id, $u, 'client', $st === 'draft' ? 'submitted' : 'answered', ($st === 'draft' ? 'Sent to StratEdge.' : 'Sent back to StratEdge with the changes.') . ($msg !== '' ? ' ' . $msg : ''));
                    crMail(crStaffToTell($q), ($st === 'draft' ? 'New talent request: ' : 'Talent request answered: ') . $q['ti'], [$co . ($st === 'draft' ? ' sent a new talent request: "' . $q['ti'] . '".' : ' answered and sent back "' . $q['ti'] . '".'), $msg !== '' ? $msg : 'Review the brief and confirm it, or ask your questions.'], 'req', $id);
                    break;
                case 'ask':
                    $need($staff && in_array($st, ['review', 'approval'], true), 'Questions can be asked while StratEdge reviews the request.');
                    if ($msg === '') {
                        fail(400, 'invalid_argument', 'Write the questions.');
                    }
                    crSetReq($id, ['st' => 'questions', 'appr' => []]);
                    crEv('req', $id, $u, 'staff', 'questions', $msg);
                    crMail([(string) $q['by_uid']], 'Questions about your talent request: ' . $q['ti'], ['StratEdge has questions about "' . $q['ti'] . '":', $msg, 'Answer them (and change the brief if needed), then send it back.'], 'req', $id);
                    break;
                case 'confirm':
                    $need($staff && ($st === 'review' || ($st === 'draft' && (string) $q['by_uid'] === $u['id'])), 'Only a request with StratEdge can be confirmed.');
                    if (($miss = crBriefMissing($q['data'])) !== '') {
                        fail(400, 'invalid_argument', $miss);
                    }
                    if ($st === 'draft') {
                        crVerOne($q, $u);
                    }
                    crSetReq($id, ['st' => 'approval', 'appr' => [], 'owner' => (string) $q['owner'] !== '' ? (string) $q['owner'] : $u['id']]);
                    crEv('req', $id, $u, 'staff', 'confirmed', 'Brief confirmed by ' . $u['name'] . ($msg !== '' ? ': ' . $msg : '') . '. Waiting for approval.');
                    crMail(array_keys($aps), 'Please approve: ' . $q['ti'], ['StratEdge confirmed the brief for "' . $q['ti'] . '" (' . $co . ').', 'Approve it, return it with your questions, or put it on hold.'], 'req', $id);
                    break;
                case 'approve':
                case 'return':
                    $need(!$staff && $st === 'approval' && isset($aps[$u['id']]), 'You are not an approver for this request, or it is not waiting for approval.');
                    if (isset($q['appr'][$u['id']]) || (isset($q['appr'][(string) ($aps[$u['id']]['for'] ?? '-')]))) {
                        fail(409, 'conflict', 'You already decided on this version.');
                    }
                    if ($act === 'return') {
                        if ($msg === '') {
                            fail(400, 'invalid_argument', 'Say what needs to change.');
                        }
                        crSetReq($id, ['st' => 'returned', 'appr' => []]);
                        crEv('req', $id, $u, 'client', 'returned', 'Returned by ' . $u['name'] . ': ' . $msg);
                        crMail(array_merge([(string) $q['by_uid']], crStaffToTell($q)), 'Returned for changes: ' . $q['ti'], [$u['name'] . ' returned "' . $q['ti'] . '" for changes:', $msg], 'req', $id);
                        break;
                    }
                    $appr = (array) $q['appr'];
                    // v64: a delegate approves for the approver who delegated to them (recorded under both names)
                    $forUid = (string) ($aps[$u['id']]['for'] ?? '');
                    $forN = (string) ($aps[$u['id']]['forN'] ?? '');
                    if ($forUid !== '' && isset($appr[$forUid])) {
                        fail(409, 'conflict', $forN . ' already decided on this version.');
                    }
                    $appr[$forUid !== '' ? $forUid : $u['id']] = ['d' => 'approve', 'at' => now(), 'n' => $forUid !== '' ? $forN . ' (by ' . $u['name'] . ', delegated)' : (string) $u['name'], 'note' => $msg, 'by' => $u['id']];
                    crSetReq($id, ['appr' => $appr]);
                    crEv('req', $id, $u, 'client', 'approve', $u['name'] . ($forUid !== '' ? ' (for ' . $forN . ', delegated)' : '') . ' approved version ' . (int) $q['ver'] . ($msg !== '' ? ': ' . $msg : '') . '.');
                    $q['appr'] = $appr;
                    if ($rule === 'any' || !array_diff_key($aps, $appr)) {
                        crApproved($q, $u, implode(', ', array_map(fn($x) => $x['n'], $appr)));
                    }
                    break;
                case 'record':
                    // StratEdge records the client's decision (an email, a call) with its evidence
                    $need($staff && $st === 'approval', 'Only a request waiting for approval can have an approval recorded.');
                    $who = $str('who', 120);
                    if ($who === '' || mb_strlen($msg) < 8) {
                        fail(400, 'invalid_argument', 'Name who approved and describe the evidence (for example: "email of Oct 6 from the hiring director").');
                    }
                    crEv('req', $id, $u, 'staff', 'recorded', 'Approval recorded by ' . $u['name'] . ' for ' . $who . '. Evidence: ' . $msg);
                    crApproved($q, $u, 'recorded by ' . $u['name'] . ' for ' . $who . ' (' . mb_substr($msg, 0, 200) . ')');
                    break;
                case 'start':
                    $need($staff && $st === 'approved' && (string) $q['vreq'] === '', 'Sourcing starts once the request is approved.');
                    require_once __DIR__ . '/vms.php';
                    $vid = vmsReqSave(crDeskFields($q), 'corp', ['st' => 'open', 'creq' => $id, 'ccid' => (string) $q['cid'], 'cver' => (int) $q['apv_ver'], 'by' => $u['id']]);
                    crSetReq($id, ['st' => 'active', 'vreq' => $vid, 'owner' => (string) $q['owner'] !== '' ? (string) $q['owner'] : $u['id']]);
                    crEv('req', $id, $u, 'staff', 'started', 'Sourcing started' . ($msg !== '' ? ': ' . $msg : '') . '.');
                    crEv('req', $id, $u, 'staff', 'note', 'Requirement ' . $vid . ' is on the requirements desk.', false);
                    crMail([(string) $q['by_uid']], 'Sourcing started: ' . $q['ti'], ['StratEdge started sourcing for "' . $q['ti'] . '".'], 'req', $id);
                    break;
                case 'hold':
                    $need(in_array($st, ['review', 'questions', 'approval', 'returned', 'approved', 'active'], true) && ($staff || $mineC), 'This request cannot be put on hold now.');
                    if ($msg === '') {
                        fail(400, 'invalid_argument', 'Say why it is on hold.');
                    }
                    crSetReq($id, ['st' => 'hold', 'prev_st' => $st]);
                    crEv('req', $id, $u, $side, 'hold', 'On hold (' . $u['name'] . '): ' . $msg);
                    crMail($staff ? [(string) $q['by_uid']] : crStaffToTell($q), 'On hold: ' . $q['ti'], ['"' . $q['ti'] . '" is on hold:', $msg], 'req', $id);
                    break;
                case 'resume':
                    $need($st === 'hold' && ($staff || $mineC), 'Only a request on hold can be resumed.');
                    $back = (string) $q['prev_st'] !== '' ? (string) $q['prev_st'] : 'review';
                    crSetReq($id, ['st' => $back, 'prev_st' => '']);
                    crEv('req', $id, $u, $side, 'resumed', 'Resumed by ' . $u['name'] . ' (' . strtolower(CR_ST[$back]) . ')' . ($msg !== '' ? ': ' . $msg : '') . '.');
                    break;
                case 'withdraw':
                    $need(!$staff && (string) $q['by_uid'] === $u['id'] && in_array($st, ['draft', 'review', 'questions', 'approval', 'returned', 'approved'], true), 'Only the person who wrote it can withdraw a request before sourcing starts.');
                    crSetReq($id, ['st' => 'cancelled']);
                    crEv('req', $id, $u, 'client', 'withdrawn', 'Withdrawn by ' . $u['name'] . ($msg !== '' ? ': ' . $msg : '') . '.');
                    if ($st !== 'draft') {
                        crMail(crStaffToTell($q), 'Withdrawn: ' . $q['ti'], [$u['name'] . ' withdrew "' . $q['ti'] . '".'], 'req', $id);
                    }
                    break;
                case 'close':
                    $need($staff && in_array($st, CR_OPEN, true) && $st !== 'draft', 'This request is not open.');
                    $to = ($b['to'] ?? '') === 'filled' ? 'filled' : 'cancelled';
                    if ($msg === '') {
                        fail(400, 'invalid_argument', 'Say why it closes.');
                    }
                    crSetReq($id, ['st' => $to]);
                    crEv('req', $id, $u, 'staff', $to, ($to === 'filled' ? 'Filled' : 'Closed') . ' by ' . $u['name'] . ': ' . $msg);
                    if ((string) $q['vreq'] !== '') {
                        require_once __DIR__ . '/vms.php';
                        $vq = docGet(VMS_REQ . '/' . $q['vreq']);
                        if ($vq && !in_array((string) ($vq->st ?? ''), ['filled', 'closed'], true)) {
                            $vq->st = $to === 'filled' ? 'filled' : 'closed';
                            $vq->u = now();
                            docSet(VMS_REQ . '/' . $q['vreq'], $vq);
                        }
                    }
                    crMail([(string) $q['by_uid']], ($to === 'filled' ? 'Filled: ' : 'Closed: ') . $q['ti'], ['"' . $q['ti'] . '" is ' . ($to === 'filled' ? 'filled' : 'closed') . ':', $msg], 'req', $id);
                    break;
                case 'owner':
                    $need($staff, 'StratEdge assigns the account manager.');
                    $o = $str('owner', 40);
                    $ow = $o !== '' ? userRow($o) : null;
                    if (!$ow || !crStaff($ow)) {
                        fail(400, 'invalid_argument', 'Pick someone at StratEdge.');
                    }
                    crSetReq($id, ['owner' => $o]);
                    crEv('req', $id, $u, 'staff', 'owner', 'Account manager: ' . $ow['name'] . '.');
                    break;
                default:
                    fail(400, 'invalid_argument', 'Unknown action.');
            }
            ok(['req' => crReqView(crReqRow($id), $u, $staff)]);

        case 'cr_prop_get':
            $q = crPropFor($str('id', 20), $u);
            $vers = [];
            $s = $p->prepare('SELECT * FROM cr_pver WHERE prop = ? ORDER BY n');
            $s->execute([(string) $q['id']]);
            foreach ($s->fetchAll() as $v) {
                $d = json_decode((string) $v['data'], true) ?: [];
                $vers[] = ['n' => (int) $v['n'], 'data' => $d, 'calc' => crPropTotals($d), 'byn' => (string) $v['byn'], 'at' => (int) $v['at'], 'note' => (string) $v['note']];
            }
            if (!$staff && (int) $q['viewed_at'] === 0) {
                // the first look by someone at the client: recorded, and never taken as acceptance
                $p->prepare('UPDATE cr_prop SET viewed_at = ? WHERE id = ?')->execute([now(), (string) $q['id']]);
                crEv('prop', (string) $q['id'], $u, 'client', 'viewed', 'First opened by ' . $u['name'] . ' (version ' . (int) $q['ver'] . ').', false);
                $q['viewed_at'] = now();
            }
            $s = $p->prepare("SELECT * FROM cr_ev WHERE kind = 'prop' AND ref = ?" . ($staff ? '' : ' AND vis = 1') . ' ORDER BY at');
            $s->execute([(string) $q['id']]);
            $evs = array_map(fn($e) => ['at' => (int) $e['at'], 'byn' => (string) $e['byn'], 'side' => (string) $e['side'], 'ev' => (string) $e['ev'], 'msg' => (string) $e['msg'], 'vis' => (int) $e['vis'] === 1], $s->fetchAll());
            $st = (string) $q['st'];
            $out = ['prop' => crPropView($q, $staff), 'vers' => $vers, 'evs' => $evs, 'can' => [
                'edit' => $staff && in_array($st, ['draft', 'shared', 'question', 'expired'], true), 'share' => $staff && in_array($st, ['draft', 'shared', 'question', 'expired'], true), 'withdraw' => $staff && in_array($st, ['shared', 'question'], true),
                'accept' => !$staff && in_array($st, ['shared', 'question'], true) && caMay(caAccess($u, (string) $q['cid']), 'proposals', 'w'), 'decline' => !$staff && in_array($st, ['shared', 'question'], true) && caMay(caAccess($u, (string) $q['cid']), 'proposals', 'w'), 'ask' => !$staff && in_array($st, ['shared', 'question'], true),
            ]];
            if ($staff) {
                $out['draft'] = $q['draft'];
                $out['draftCalc'] = crPropTotals($q['draft']);
                $out['to'] = $q['to_uids'];
                $out['contacts'] = array_values(crContacts((string) $q['cid']));
            }
            ok($out);

        case 'cr_prop_save':
            if (!$staff) {
                fail(403, 'forbidden', 'StratEdge writes proposals.');
            }
            if (throttleHit('crprop:' . $u['id'], 200, 3600)) {
                fail(429, 'slow_down', 'Too many changes in an hour.');
            }
            $data = crPropIn($b['data'] ?? []);
            $ti = $str('ti', 160);
            if ($ti === '') {
                fail(400, 'invalid_argument', 'Name the proposal.');
            }
            $id = $str('id', 20);
            $reqId = $str('req', 20);
            if ($id === '') {
                $cid = $str('cid', 40);
                if (!docGet('org/admin/clients/' . $cid)) {
                    fail(404, 'not_found', 'No such client company.');
                }
                if ($reqId !== '' && (($rq = crReqRow($reqId)) === null || (string) $rq['cid'] !== $cid)) {
                    fail(400, 'invalid_argument', 'That talent request belongs to another company.');
                }
                $id = rid(8);
                $p->prepare("INSERT INTO cr_prop (id, cid, req, ti, st, ver, draft, owner, to_uids, dec, at, u) VALUES (?,?,?,?,'draft',0,?,?,'[]','{}',?,?)")->execute([$id, $cid, $reqId, $ti, json_encode($data), $u['id'], now(), now()]);
                crEv('prop', $id, $u, 'staff', 'created', 'Started by ' . $u['name'] . '.', false);
                ok(['id' => $id]);
            }
            $q = crPropFor($id, $u);
            if (!in_array((string) $q['st'], ['draft', 'shared', 'question', 'expired'], true)) {
                fail(409, 'conflict', 'An accepted, declined or withdrawn proposal is not changed: start a new one.');
            }
            $p->prepare('UPDATE cr_prop SET ti = ?, draft = ?, u = ? WHERE id = ?')->execute([$ti, json_encode($data), now(), $id]);
            ok(['id' => $id, 'calc' => crPropTotals($data)]);

        case 'cr_prop_act':
            $q = crPropFor($str('id', 20), $u);
            $id = (string) $q['id'];
            $st = (string) $q['st'];
            $act = (string) ($b['act'] ?? '');
            $msg = $str('msg', 4000);
            $co = crCompanyName((string) $q['cid']);
            switch ($act) {
                case 'share':
                    if (!$staff || !in_array($st, ['draft', 'shared', 'question', 'expired'], true)) {
                        fail(409, 'conflict', 'This proposal cannot be shared now.');
                    }
                    $d = $q['draft'];
                    if (!$d['lines'] && $d['intro'] === '' && !$d['scope']) {
                        fail(400, 'invalid_argument', 'Write the scope and the prices before sharing.');
                    }
                    if ($d['valid'] === '' || $d['valid'] < (new DateTimeImmutable('now', new DateTimeZone((string) (cfg('timezone') ?: 'America/New_York'))))->format('Y-m-d')) {
                        fail(400, 'invalid_argument', 'Set the date the proposal is valid until (today or later).');
                    }
                    $last = (int) $q['ver'] > 0 ? crPropVer($id, (int) $q['ver']) : null;
                    if ($last && json_encode($last['data']) === json_encode($d) && $st !== 'expired') {
                        fail(409, 'conflict', 'Nothing changed since version ' . (int) $q['ver'] . ' was shared.');
                    }
                    $contacts = crContacts((string) $q['cid']);
                    $to = array_values(array_intersect(array_map('strval', (array) ($b['to'] ?? [])), array_keys($contacts)));
                    // v64: only people whose role has proposals receive one
                    $to = caFilter((string) $q['cid'], $to, 'proposals');
                    if (!$to) {
                        fail(400, 'invalid_argument', 'Pick who at ' . $co . ' receives it (someone whose role has proposals).');
                    }
                    $n = (int) $q['ver'] + 1;
                    $p->prepare('INSERT INTO cr_pver (id, prop, n, data, by_uid, byn, at, note) VALUES (?,?,?,?,?,?,?,?)')->execute([rid(8), $id, $n, json_encode($d), $u['id'], (string) $u['name'], now(), $msg]);
                    $p->prepare("UPDATE cr_prop SET st = 'shared', ver = ?, to_uids = ?, viewed_at = 0, dec = '{}', u = ? WHERE id = ?")->execute([$n, json_encode($to), now(), $id]);
                    crEv('prop', $id, $u, 'staff', 'shared', 'Version ' . $n . ' shared with ' . implode(', ', array_map(fn($x) => $contacts[$x]['n'], $to)) . ($msg !== '' ? ': ' . $msg : '') . '.');
                    crMail($to, ($n > 1 ? 'Updated proposal: ' : 'Proposal: ') . $q['ti'], ['StratEdge shared ' . ($n > 1 ? 'version ' . $n . ' of ' : '') . 'the proposal "' . $q['ti'] . '" for ' . $co . '.', $msg !== '' ? $msg : 'Open it to review the scope and prices; you can ask a question, accept or decline it.'], 'prop', $id);
                    break;
                case 'withdraw':
                    if (!$staff || !in_array($st, ['shared', 'question'], true)) {
                        fail(409, 'conflict', 'Only a shared proposal can be withdrawn.');
                    }
                    $p->prepare("UPDATE cr_prop SET st = 'withdrawn', u = ? WHERE id = ?")->execute([now(), $id]);
                    crEv('prop', $id, $u, 'staff', 'withdrawn', 'Withdrawn by ' . $u['name'] . ($msg !== '' ? ': ' . $msg : '') . '.');
                    break;
                case 'ask':
                case 'answer':
                    if ($msg === '') {
                        fail(400, 'invalid_argument', 'Write the message.');
                    }
                    if ($act === 'ask') {
                        if ($staff || !in_array($st, ['shared', 'question'], true)) {
                            fail(409, 'conflict', 'Questions are for a shared proposal.');
                        }
                        $p->prepare("UPDATE cr_prop SET st = 'question', u = ? WHERE id = ?")->execute([now(), $id]);
                        crEv('prop', $id, $u, 'client', 'question', $msg);
                        crMail([(string) $q['owner']], 'Question on the proposal: ' . $q['ti'], [$u['name'] . ' (' . $co . ') asked about "' . $q['ti'] . '":', $msg], 'prop', $id);
                    } else {
                        if (!$staff) {
                            fail(403, 'forbidden', 'StratEdge answers questions.');
                        }
                        if ($st === 'question') {
                            $p->prepare("UPDATE cr_prop SET st = 'shared', u = ? WHERE id = ?")->execute([now(), $id]);
                        }
                        crEv('prop', $id, $u, 'staff', 'answer', $msg);
                        crMail((array) $q['to_uids'], 'Answer on the proposal: ' . $q['ti'], ['StratEdge answered about "' . $q['ti'] . '":', $msg], 'prop', $id);
                    }
                    break;
                case 'accept':
                case 'decline':
                    if ($staff || !in_array($st, ['shared', 'question'], true)) {
                        fail(409, 'conflict', 'Only the client decides on a shared proposal.');
                    }
                    // v64: deciding takes a role that acts on proposals (procurement, full access)
                    if (!caMay(caAccess($u, (string) $q['cid']), 'proposals', 'w')) {
                        fail(403, 'forbidden', 'Your role at ' . $co . ' reads proposals but does not decide on them.');
                    }
                    if ((int) ($b['ver'] ?? 0) !== (int) $q['ver']) {
                        fail(409, 'conflict', 'A newer version was shared: review version ' . (int) $q['ver'] . ' first.');
                    }
                    $name = $str('name', 120);
                    if ($act === 'accept' && (mb_strlen($name) < 3 || empty($b['auth']))) {
                        fail(400, 'invalid_argument', 'Type your full name and confirm you may accept on behalf of ' . $co . '.');
                    }
                    if ($act === 'decline' && $msg === '') {
                        fail(400, 'invalid_argument', 'Say why, so StratEdge can follow up.');
                    }
                    $dec = ['d' => $act === 'accept' ? 'accepted' : 'declined', 'n' => $act === 'accept' ? $name : (string) $u['name'], 'by' => $u['id'], 'at' => now(), 'ip' => clientIp(), 'note' => $msg, 'ver' => (int) $q['ver']];
                    $p->prepare('UPDATE cr_prop SET st = ?, dec = ?, u = ? WHERE id = ?')->execute([$dec['d'], json_encode($dec), now(), $id]);
                    crEv('prop', $id, $u, 'client', $dec['d'], ($act === 'accept' ? 'Version ' . (int) $q['ver'] . ' accepted by ' . $name . ' (typed name; authorized for ' . $co . ')' : 'Declined by ' . $u['name']) . ($msg !== '' ? ': ' . $msg : '') . '.');
                    crMail([(string) $q['owner']], ($act === 'accept' ? 'Accepted: ' : 'Declined: ') . $q['ti'], [$co . ($act === 'accept' ? ' accepted version ' . (int) $q['ver'] . ' of "' . $q['ti'] . '" (' . $name . ').' : ' declined "' . $q['ti'] . '".'), $msg], 'prop', $id);
                    break;
                default:
                    fail(400, 'invalid_argument', 'Unknown action.');
            }
            ok(['prop' => crPropView(crPropRow($id), $staff)]);
    }
    fail(404, 'not_found', 'Unknown request.');
}
