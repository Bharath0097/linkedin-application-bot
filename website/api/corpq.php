<?php
declare(strict_types=1);
/*
 * v49 Supplier qualification (CC-04): StratEdge's supplier profile, its document library, and one qualification packet
 * per client company.
 *
 * The supplier profile (legal name, services, skill areas, locations, relationship owners, certifications, customer
 * references, insurance summary) is edited as a draft and approved by an administrator; client companies see only the
 * approved version. A certification shows only with current evidence (a document in the library that has not expired)
 * and only when it is meant for every client; a customer reference only with the reference's permission recorded.
 *
 * The document library keeps each document's versions (a W-9, a certificate of insurance, the MSA, an NDA, a security
 * questionnaire...), each with its expiry date; an agreement version is either a draft or the executed copy, never
 * confused. Clients never browse the library: they see the documents supplied for what their company requested.
 *
 * A packet is what one client company asks for: each item is requested (by the client or by StratEdge for them),
 * supplied (a library document), then approved or returned with a reason by the company, or marked not needed.
 * Supplying a document never marks StratEdge qualified: the company records its decision (qualified or not, with its
 * evidence). An item whose supplied document has expired, was returned, is past its due date, or has waited for the
 * company's review for more than a week shows as an exception.
 *
 * Tables (main database): cq_prof (profile versions), cq_doc (document versions), cq_pkt (one packet per company),
 * cq_item (the packet's items). Events go to the request timeline table (cr_ev, kind 'pkt').
 */

const CQ_KINDS = [
    'w9' => 'W-9 (taxpayer identification)', 'coi' => 'Certificate of insurance', 'msa' => 'Master services agreement', 'nda' => 'Non-disclosure agreement',
    'sec' => 'Security questionnaire', 'div' => 'Diversity or small-business certificate', 'lic' => 'Business registration or license', 'bank' => 'Bank letter or payment form',
    'ref' => 'Customer references', 'pol' => 'Policies (code of conduct, privacy)', 'cert' => 'Certification evidence', 'other' => 'Other',
];
const CQ_AGREE = ['msa', 'nda'];
const CQ_IST = ['requested' => 'Requested', 'supplied' => 'Supplied, waiting for review', 'returned' => 'Returned for changes', 'approved' => 'Approved', 'waived' => 'Not needed'];
const CQ_PST = ['open' => 'Collecting documents', 'qualified' => 'Qualified', 'not' => 'Not qualified', 'closed' => 'Closed'];
const CQ_REVIEW_DAYS = 7;
const CQ_STARTER = ['w9', 'coi', 'msa', 'nda', 'sec'];

function cqDb(): PDO
{
    static $ready = false;
    $p = db();
    if (!$ready) {
        $ready = true;
        $p->exec("CREATE TABLE IF NOT EXISTS cq_prof (n INT PRIMARY KEY, data TEXT NOT NULL, st VARCHAR(10) NOT NULL, by_uid VARCHAR(40) NOT NULL, byn VARCHAR(120) NOT NULL DEFAULT '', at BIGINT NOT NULL, apv_at BIGINT NOT NULL DEFAULT 0, apv_by VARCHAR(120) NOT NULL DEFAULT '')");
        $p->exec("CREATE TABLE IF NOT EXISTS cq_doc (id VARCHAR(20) PRIMARY KEY, fam VARCHAR(20) NOT NULL, kind VARCHAR(10) NOT NULL, ti VARCHAR(160) NOT NULL, n INT NOT NULL, fid VARCHAR(40) NOT NULL, fn VARCHAR(200) NOT NULL, fty VARCHAR(100) NOT NULL, sz INT NOT NULL DEFAULT 0, exp VARCHAR(10) NOT NULL DEFAULT '', ast VARCHAR(10) NOT NULL DEFAULT '', note VARCHAR(500) NOT NULL DEFAULT '', cur INT NOT NULL DEFAULT 1, by_uid VARCHAR(40) NOT NULL, byn VARCHAR(120) NOT NULL DEFAULT '', at BIGINT NOT NULL)");
        $p->exec('CREATE INDEX IF NOT EXISTS cq_doc_fam ON cq_doc (fam, n)');
        $p->exec("CREATE TABLE IF NOT EXISTS cq_pkt (id VARCHAR(20) PRIMARY KEY, cid VARCHAR(40) NOT NULL, st VARCHAR(10) NOT NULL, owner VARCHAR(40) NOT NULL DEFAULT '', to_uids TEXT NOT NULL, due VARCHAR(10) NOT NULL DEFAULT '', dec TEXT NOT NULL, done_at BIGINT NOT NULL DEFAULT 0, at BIGINT NOT NULL, u BIGINT NOT NULL)");
        $p->exec('CREATE INDEX IF NOT EXISTS cq_pkt_cid ON cq_pkt (cid)');
        $p->exec("CREATE TABLE IF NOT EXISTS cq_item (id VARCHAR(20) PRIMARY KEY, pkt VARCHAR(20) NOT NULL, kind VARCHAR(10) NOT NULL, ti VARCHAR(160) NOT NULL, note VARCHAR(1000) NOT NULL DEFAULT '', st VARCHAR(10) NOT NULL, doc VARCHAR(20) NOT NULL DEFAULT '', resp VARCHAR(40) NOT NULL DEFAULT '', due VARCHAR(10) NOT NULL DEFAULT '', req_by VARCHAR(40) NOT NULL DEFAULT '', req_side VARCHAR(8) NOT NULL DEFAULT '', sup_at BIGINT NOT NULL DEFAULT 0, rev TEXT NOT NULL, at BIGINT NOT NULL, u BIGINT NOT NULL)");
        $p->exec('CREATE INDEX IF NOT EXISTS cq_item_pkt ON cq_item (pkt)');
    }
    return $p;
}
function cqToday(): string
{
    return (new DateTimeImmutable('now', new DateTimeZone((string) (cfg('timezone') ?: 'America/New_York'))))->format('Y-m-d');
}
function cqAdmin(array $u): bool
{
    return hasRole($u, 'admin');
}

/* ---------- the supplier profile ---------- */
function cqProfIn($in): array
{
    $a = (array) $in;
    $s = fn($v, int $max) => mb_substr(trim((string) $v), 0, $max);
    $list = fn(string $k, int $n, int $max) => array_values(array_filter(array_map(fn($x) => $s($x, $max), array_slice((array) ($a[$k] ?? []), 0, $n)), fn($x) => $x !== ''));
    $date = fn($v) => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $v) ? (string) $v : '';
    $owners = [];
    foreach (array_slice((array) ($a['owners'] ?? []), 0, 10) as $o) {
        $o = (array) $o;
        if ($s($o['n'] ?? '', 120) === '') {
            continue;
        }
        $e = strtolower($s($o['e'] ?? '', 190));
        $owners[] = ['n' => $s($o['n'] ?? '', 120), 'role' => $s($o['role'] ?? '', 120), 'e' => filter_var($e, FILTER_VALIDATE_EMAIL) ? $e : '', 'ph' => $s($o['ph'] ?? '', 40)];
    }
    $certs = [];
    foreach (array_slice((array) ($a['certs'] ?? []), 0, 20) as $c) {
        $c = (array) $c;
        if ($s($c['n'] ?? '', 160) === '') {
            continue;
        }
        $certs[] = ['n' => $s($c['n'] ?? '', 160), 'by' => $s($c['by'] ?? '', 160), 'num' => $s($c['num'] ?? '', 80), 'exp' => $date($c['exp'] ?? ''), 'doc' => preg_match('/^[a-f0-9]{8,20}$/', (string) ($c['doc'] ?? '')) ? (string) $c['doc'] : '', 'all' => !empty($c['all'])];
    }
    $refs = [];
    foreach (array_slice((array) ($a['refs'] ?? []), 0, 20) as $r) {
        $r = (array) $r;
        if ($s($r['co'] ?? '', 160) === '') {
            continue;
        }
        $refs[] = ['co' => $s($r['co'] ?? '', 160), 'who' => $s($r['who'] ?? '', 160), 'what' => $s($r['what'] ?? '', 400), 'ok' => !empty($r['ok']), 'okNote' => $s($r['okNote'] ?? '', 300)];
    }
    $yr = (int) ($a['founded'] ?? 0);
    return [
        'legal' => $s($a['legal'] ?? '', 160), 'dba' => $s($a['dba'] ?? '', 160), 'founded' => $yr >= 1900 && $yr <= (int) date('Y') ? $yr : null, 'hq' => $s($a['hq'] ?? '', 300),
        'web' => $s($a['web'] ?? '', 200), 'about' => $s($a['about'] ?? '', 3000), 'ids' => $s($a['ids'] ?? '', 300), 'ins' => $s($a['ins'] ?? '', 1000),
        'locs' => $list('locs', 20, 160), 'services' => $list('services', 20, 200), 'skills' => $list('skills', 40, 120), 'owners' => $owners, 'certs' => $certs, 'refs' => $refs,
    ];
}
function cqProf(string $which): ?array
{
    $p = cqDb();
    $r = $which === 'draft' ? $p->query("SELECT * FROM cq_prof WHERE st = 'draft' ORDER BY n DESC LIMIT 1")->fetch() : $p->query("SELECT * FROM cq_prof WHERE st = 'approved' ORDER BY n DESC LIMIT 1")->fetch();
    if (!$r) {
        return null;
    }
    $r['data'] = json_decode((string) $r['data'], true) ?: [];
    return $r;
}
/** The approved profile as a client company sees it: certifications only with current evidence meant for every client;
 *  references only with permission recorded. */
function cqProfPublic(): ?array
{
    $r = cqProf('approved');
    if (!$r) {
        return null;
    }
    $d = $r['data'];
    $today = cqToday();
    $d['certs'] = array_values(array_map(fn($c) => ['n' => $c['n'], 'by' => $c['by'], 'num' => $c['num'], 'exp' => $c['exp']], array_filter($d['certs'], function ($c) use ($today) {
        if (!$c['all'] || $c['doc'] === '' || ($c['exp'] !== '' && $c['exp'] < $today)) {
            return false;
        }
        $doc = cqDocRow($c['doc']);
        return $doc && ($doc['exp'] === '' || $doc['exp'] >= $today);
    })));
    $d['refs'] = array_values(array_map(fn($x) => ['co' => $x['co'], 'who' => $x['who'], 'what' => $x['what']], array_filter($d['refs'], fn($x) => $x['ok'])));
    return ['n' => (int) $r['n'], 'data' => $d, 'apvAt' => (int) $r['apv_at']];
}

/* ---------- the document library ---------- */
function cqDocRow(string $id): ?array
{
    $s = cqDb()->prepare('SELECT * FROM cq_doc WHERE id = ?');
    $s->execute([$id]);
    return $s->fetch() ?: null;
}
function cqDocView(array $d): array
{
    $today = cqToday();
    return [
        'id' => (string) $d['id'], 'fam' => (string) $d['fam'], 'kind' => (string) $d['kind'], 'ti' => (string) $d['ti'], 'n' => (int) $d['n'], 'fn' => (string) $d['fn'], 'sz' => (int) $d['sz'],
        'exp' => (string) $d['exp'], 'expired' => (string) $d['exp'] !== '' && (string) $d['exp'] < $today, 'ast' => (string) $d['ast'], 'note' => (string) $d['note'], 'cur' => (int) $d['cur'] === 1,
        'byn' => (string) $d['byn'], 'at' => (int) $d['at'],
    ];
}

/* ---------- packets ---------- */
function cqPkt(string $cid): ?array
{
    $s = cqDb()->prepare('SELECT * FROM cq_pkt WHERE cid = ?');
    $s->execute([$cid]);
    $r = $s->fetch();
    if (!$r) {
        return null;
    }
    $r['to_uids'] = json_decode((string) $r['to_uids'], true) ?: [];
    $r['dec'] = json_decode((string) $r['dec'], true) ?: [];
    return $r;
}
function cqItems(string $pkt): array
{
    $s = cqDb()->prepare('SELECT * FROM cq_item WHERE pkt = ? ORDER BY at');
    $s->execute([$pkt]);
    return array_map(function ($r) {
        $r['rev'] = json_decode((string) $r['rev'], true) ?: [];
        return $r;
    }, $s->fetchAll());
}
/** An item's exception, if any: expired, returned, overdue, or waiting for the company's review for too long. */
function cqException(array $it, ?array $doc): string
{
    $today = cqToday();
    if (in_array($it['st'], ['supplied', 'approved'], true) && $doc && (string) $doc['exp'] !== '' && (string) $doc['exp'] < $today) {
        return 'expired';
    }
    if ($it['st'] === 'returned') {
        return 'returned';
    }
    if ($it['st'] === 'requested' && (string) $it['due'] !== '' && (string) $it['due'] < $today) {
        return 'overdue';
    }
    if ($it['st'] === 'supplied' && (int) $it['sup_at'] > 0 && now() - (int) $it['sup_at'] > CQ_REVIEW_DAYS * 86400000) {
        return 'review';
    }
    return '';
}
function cqItemView(array $it, bool $staff): array
{
    $doc = (string) $it['doc'] !== '' ? cqDocRow((string) $it['doc']) : null;
    $out = [
        'id' => (string) $it['id'], 'kind' => (string) $it['kind'], 'ti' => (string) $it['ti'], 'note' => (string) $it['note'], 'st' => (string) $it['st'], 'due' => (string) $it['due'],
        'side' => (string) $it['req_side'], 'supAt' => (int) $it['sup_at'], 'rev' => $it['rev'] ?: null, 'exc' => cqException($it, $doc), 'at' => (int) $it['at'], 'u' => (int) $it['u'],
        'doc' => $doc && in_array($it['st'], ['supplied', 'approved', 'returned'], true) ? ['id' => (string) $doc['id'], 'ti' => (string) $doc['ti'], 'n' => (int) $doc['n'], 'fn' => (string) $doc['fn'], 'exp' => (string) $doc['exp'], 'ast' => (string) $doc['ast']] : null,
    ];
    if ($staff) {
        $out['resp'] = (string) $it['resp'];
        $out['respN'] = (string) $it['resp'] !== '' ? (string) (userRow((string) $it['resp'])['name'] ?? '') : '';
    }
    return $out;
}
/** The packet's measures: days since it was opened (or until complete), items by state, exceptions, days blocked
 *  waiting for the company's review. */
function cqMeasures(array $pkt, array $items): array
{
    $exc = [];
    $blocked = 0;
    foreach ($items as $it) {
        $doc = (string) $it['doc'] !== '' ? cqDocRow((string) $it['doc']) : null;
        $e = cqException($it, $doc);
        if ($e !== '') {
            $exc[$e] = ($exc[$e] ?? 0) + 1;
        }
        if ($it['st'] === 'supplied' && (int) $it['sup_at'] > 0) {
            $blocked += (int) floor((now() - (int) $it['sup_at']) / 86400000);
        }
    }
    $by = array_count_values(array_column($items, 'st'));
    $open = array_filter($items, fn($x) => !in_array($x['st'], ['approved', 'waived'], true));
    return ['items' => count($items), 'by' => $by, 'exc' => $exc, 'blockedDays' => $blocked, 'complete' => $items && !$open, 'days' => (int) floor((((int) $pkt['done_at'] ?: now()) - (int) $pkt['at']) / 86400000)];
}
function cqPktView(array $pkt, bool $staff): array
{
    $items = cqItems((string) $pkt['id']);
    $out = [
        'id' => (string) $pkt['id'], 'cid' => (string) $pkt['cid'], 'co' => crCompanyName((string) $pkt['cid']), 'st' => (string) $pkt['st'], 'due' => (string) $pkt['due'], 'dec' => $pkt['dec'] ?: null,
        'items' => array_map(fn($x) => cqItemView($x, $staff), $items), 'm' => cqMeasures($pkt, $items), 'at' => (int) $pkt['at'], 'doneAt' => (int) $pkt['done_at'],
    ];
    if ($staff) {
        $out['owner'] = (string) $pkt['owner'];
        $out['ownerN'] = (string) $pkt['owner'] !== '' ? (string) (userRow((string) $pkt['owner'])['name'] ?? '') : '';
        $out['to'] = $pkt['to_uids'];
    }
    return $out;
}
/** When every item is approved or not needed the packet is complete (the time is kept for the measure). */
function cqCheckDone(array $pkt): void
{
    $items = cqItems((string) $pkt['id']);
    $done = $items && !array_filter($items, fn($x) => !in_array($x['st'], ['approved', 'waived'], true));
    if ($done && (int) $pkt['done_at'] === 0) {
        cqDb()->prepare('UPDATE cq_pkt SET done_at = ?, u = ? WHERE id = ?')->execute([now(), now(), (string) $pkt['id']]);
    } elseif (!$done && (int) $pkt['done_at'] > 0) {
        cqDb()->prepare('UPDATE cq_pkt SET done_at = 0, u = ? WHERE id = ?')->execute([now(), (string) $pkt['id']]);
    }
}
function cqItemRow(string $id): ?array
{
    $s = cqDb()->prepare('SELECT * FROM cq_item WHERE id = ?');
    $s->execute([$id]);
    $r = $s->fetch();
    if (!$r) {
        return null;
    }
    $r['rev'] = json_decode((string) $r['rev'], true) ?: [];
    return $r;
}
/** The company's people to tell: the packet's chosen contacts, else every contact of the company. */
function cqClientTo(array $pkt): array
{
    $to = array_values(array_intersect((array) $pkt['to_uids'], array_keys(crContacts((string) $pkt['cid']))));
    return $to ?: array_keys(crContacts((string) $pkt['cid']));
}
function cqStaffTo(array $pkt, ?array $it = null): array
{
    $t = array_filter([$it ? (string) $it['resp'] : '', (string) $pkt['owner']]);
    return $t ?: crStaffToTell(['owner' => '', 'cid' => (string) $pkt['cid']]);
}

function cqRoute(string $r, array $b, array $u, bool $staff, array $myC): never
{
    $p = cqDb();
    $str = fn(string $k, int $max) => mb_substr(trim((string) ($b[$k] ?? '')), 0, $max);
    $date = fn(string $k) => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($b[$k] ?? '')) ? (string) $b[$k] : '';
    $needStaff = fn() => $staff ?: fail(403, 'forbidden', 'StratEdge keeps the supplier profile and documents.');
    // v64: a contact's role: reading the company's packet, or acting on it (asking, approving, returning, deciding)
    $cqNeed = function (string $cid, string $need) use ($u, $staff): void {
        if (!$staff && !caMay(caAccess($u, $cid), 'supplier', $need)) {
            fail($need === 'w' ? 403 : 404, $need === 'w' ? 'forbidden' : 'not_found', $need === 'w' ? 'Your role at ' . crCompanyName($cid) . ' reads supplier documents but does not act on them.' : 'No documents were requested yet.');
        }
    };
    // a packet the caller may use: StratEdge's, or one of the caller's own company
    $pktFor = function (string $cid) use ($staff, $myC, $u): array {
        if (!$staff && !in_array($cid, $myC, true)) {
            fail(404, 'not_found', 'No such packet.');
        }
        if (!$staff && !caMay(caAccess($u, $cid), 'supplier')) {
            fail(404, 'not_found', 'No such packet.');
        }
        $pk = cqPkt($cid);
        if (!$pk) {
            fail(404, 'not_found', 'No documents were requested yet.');
        }
        return $pk;
    };
    $itemFor = function (string $id) use ($pktFor): array {
        $it = cqItemRow($id);
        if (!$it) {
            fail(404, 'not_found', 'No such item.');
        }
        $s = cqDb()->prepare('SELECT cid FROM cq_pkt WHERE id = ?');
        $s->execute([(string) $it['pkt']]);
        return [$it, $pktFor((string) $s->fetchColumn())];
    };
    switch ($r) {
        case 'cq_home':
            // a client contact: the approved profile and their company's packet; StratEdge: everything
            if (!$staff) {
                $cid = in_array($str('cid', 40), $myC, true) ? $str('cid', 40) : $myC[0];
                $acc = caAccess($u, $cid);
                if (!caMay($acc, 'supplier')) {
                    fail(403, 'forbidden', 'Your role at ' . crCompanyName($cid) . ' does not cover supplier documents.');
                }
                $pk = cqPkt($cid);
                ok(['staff' => false, 'co' => crCompanyName($cid), 'cid' => $cid, 'prof' => cqProfPublic(), 'pkt' => $pk ? cqPktView($pk, false) : null, 'kinds' => CQ_KINDS, 'ist' => CQ_IST, 'pst' => CQ_PST, 'agree' => CQ_AGREE, 'ro' => !caMay($acc, 'supplier', 'w')]);
            }
            $docs = array_map('cqDocView', $p->query('SELECT * FROM cq_doc ORDER BY kind, fam, n DESC')->fetchAll());
            $pkts = [];
            foreach ($p->query('SELECT * FROM cq_pkt ORDER BY u DESC')->fetchAll() as $x) {
                $x['to_uids'] = json_decode((string) $x['to_uids'], true) ?: [];
                $x['dec'] = json_decode((string) $x['dec'], true) ?: [];
                $pkts[] = cqPktView($x, true);
            }
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
            $draft = cqProf('draft');
            $apv = cqProf('approved');
            ok(['staff' => true, 'admin' => cqAdmin($u), 'draft' => $draft ? ['n' => (int) $draft['n'], 'data' => $draft['data'], 'byn' => (string) $draft['byn'], 'at' => (int) $draft['at']] : null, 'approved' => $apv ? ['n' => (int) $apv['n'], 'data' => $apv['data'], 'apvAt' => (int) $apv['apv_at'], 'apvBy' => (string) $apv['apv_by']] : null, 'public' => cqProfPublic(), 'docs' => $docs, 'pkts' => $pkts, 'cos' => $cos, 'team' => $team, 'kinds' => CQ_KINDS, 'ist' => CQ_IST, 'pst' => CQ_PST, 'agree' => CQ_AGREE, 'starter' => CQ_STARTER]);

        case 'cq_prof_save':
            $needStaff();
            $d = cqProfIn($b['data'] ?? []);
            if ($d['legal'] === '') {
                fail(400, 'invalid_argument', 'Give the legal name.');
            }
            foreach ($d['certs'] as $c) {
                if ($c['doc'] !== '' && !cqDocRow($c['doc'])) {
                    fail(400, 'invalid_argument', 'The evidence for "' . $c['n'] . '" is not in the document library.');
                }
            }
            $draft = cqProf('draft');
            if ($draft) {
                $p->prepare('UPDATE cq_prof SET data = ?, by_uid = ?, byn = ?, at = ? WHERE n = ?')->execute([json_encode($d), $u['id'], (string) $u['name'], now(), (int) $draft['n']]);
                $n = (int) $draft['n'];
            } else {
                $n = (int) $p->query('SELECT COALESCE(MAX(n), 0) FROM cq_prof')->fetchColumn() + 1;
                $p->prepare("INSERT INTO cq_prof (n, data, st, by_uid, byn, at) VALUES (?,?,'draft',?,?,?)")->execute([$n, json_encode($d), $u['id'], (string) $u['name'], now()]);
            }
            ok(['n' => $n]);

        case 'cq_prof_approve':
            if (!cqAdmin($u)) {
                fail(403, 'forbidden', 'An administrator approves the supplier profile.');
            }
            $draft = cqProf('draft');
            if (!$draft) {
                fail(409, 'conflict', 'There is no draft to approve.');
            }
            $p->exec("UPDATE cq_prof SET st = 'retired' WHERE st = 'approved'");
            $p->prepare("UPDATE cq_prof SET st = 'approved', apv_at = ?, apv_by = ? WHERE n = ?")->execute([now(), (string) $u['name'], (int) $draft['n']]);
            audit('client', 'Supplier profile approved', 'version ' . (int) $draft['n'], ['n' => (int) $draft['n']], $u);
            ok(['n' => (int) $draft['n']]);

        case 'cq_doc_save':
            // a new document, or a new version of one (multipart: data (JSON) and file)
            $needStaff();
            $in = !empty($_POST['data']) ? json_decode((string) $_POST['data'], true) : $b;
            $in = is_array($in) ? $in : [];
            $kind = isset(CQ_KINDS[(string) ($in['kind'] ?? '')]) ? (string) $in['kind'] : '';
            $ti = mb_substr(trim((string) ($in['ti'] ?? '')), 0, 160);
            $fam = preg_match('/^[a-f0-9]{8,20}$/', (string) ($in['fam'] ?? '')) ? (string) $in['fam'] : '';
            $prev = null;
            if ($fam !== '') {
                $s = $p->prepare('SELECT * FROM cq_doc WHERE fam = ? ORDER BY n DESC LIMIT 1');
                $s->execute([$fam]);
                $prev = $s->fetch();
                if (!$prev) {
                    fail(404, 'not_found', 'No such document.');
                }
                $kind = (string) $prev['kind'];
                $ti = $ti !== '' ? $ti : (string) $prev['ti'];
            }
            if ($kind === '' || $ti === '') {
                fail(400, 'invalid_argument', 'Pick the kind of document and give it a title.');
            }
            $exp = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($in['exp'] ?? '')) ? (string) $in['exp'] : '';
            $ast = in_array($kind, CQ_AGREE, true) ? (($in['ast'] ?? '') === 'executed' ? 'executed' : 'draft') : '';
            if (!isset($_FILES['file'])) {
                fail(400, 'invalid_argument', 'Attach the file.');
            }
            $f = storeUpload($_FILES['file'], 'cq/doc', ['c' => 'supplier']);
            $id = rid(8);
            $fam = $fam !== '' ? $fam : $id;
            $n = $prev ? (int) $prev['n'] + 1 : 1;
            $p->prepare('UPDATE cq_doc SET cur = 0 WHERE fam = ?')->execute([$fam]);
            $p->prepare('INSERT INTO cq_doc (id, fam, kind, ti, n, fid, fn, fty, sz, exp, ast, note, cur, by_uid, byn, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)')->execute([$id, $fam, $kind, $ti, $n, (string) $f['id'], (string) $f['n'], (string) $f['ty'], (int) $f['sz'], $exp, $ast, mb_substr(trim((string) ($in['note'] ?? '')), 0, 500), $u['id'], (string) $u['name'], now()]);
            ok(['doc' => cqDocView(cqDocRow($id))]);

        case 'cq_file':
            // a document: StratEdge any version; a client only one supplied for their company's packet (a link, GET)
            $id = mb_substr((string) ($_GET['id'] ?? ($b['id'] ?? '')), 0, 20);
            $doc = cqDocRow($id);
            if (!$doc) {
                fail(404, 'not_found', 'No such document.');
            }
            if (!$staff) {
                $myC = array_values(array_filter($myC, fn($c) => caMay(caAccess($u, $c), 'supplier')));
                if (!$myC) {
                    fail(404, 'not_found', 'No such document.');
                }
                $s = $p->prepare("SELECT COUNT(*) FROM cq_item i JOIN cq_pkt k ON k.id = i.pkt WHERE i.doc = ? AND i.st IN ('supplied', 'approved', 'returned') AND k.cid IN (" . implode(',', array_map(fn($c) => $p->quote($c), $myC)) . ')');
                $s->execute([$id]);
                if ((int) $s->fetchColumn() === 0) {
                    fail(404, 'not_found', 'No such document.');
                }
            }
            $fp = filePathOf((string) $doc['fid']);
            if (!is_file($fp)) {
                fail(404, 'not_found', 'The file is no longer there.');
            }
            guardDlp($u, 'file', (string) $doc['fn']);
            header('Content-Type: ' . (string) $doc['fty']);
            header('Content-Length: ' . filePlainSize($fp));
            header("Content-Security-Policy: default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox; frame-ancestors 'self'");
            header('Content-Disposition: attachment; filename="' . preg_replace('/[^A-Za-z0-9 ._()\-]/', '_', (string) $doc['fn']) . '"');
            header('Cache-Control: private, max-age=60');
            fileServePath($fp);
            exit;

        case 'cq_pkt_open':
            // StratEdge opens a company's packet (with the usual items to start from, each can be removed)
            $needStaff();
            $cid = $str('cid', 40);
            if (!docGet('org/admin/clients/' . $cid)) {
                fail(404, 'not_found', 'No such client company.');
            }
            if (cqPkt($cid)) {
                fail(409, 'conflict', 'This company already has a packet.');
            }
            $id = rid(8);
            $owner = $str('owner', 40);
            $ow = $owner !== '' ? userRow($owner) : null;
            $p->prepare("INSERT INTO cq_pkt (id, cid, st, owner, to_uids, due, dec, at, u) VALUES (?,?,'open',?,'[]',?,'{}',?,?)")->execute([$id, $cid, $ow && crStaff($ow) ? $owner : $u['id'], $date('due'), now(), now()]);
            foreach (array_intersect((array) ($b['items'] ?? []), array_keys(CQ_KINDS)) as $k) {
                $p->prepare("INSERT INTO cq_item (id, pkt, kind, ti, st, resp, due, req_by, req_side, rev, at, u) VALUES (?,?,?,?,'requested',?,?,?,'staff','{}',?,?)")->execute([rid(8), $id, $k, CQ_KINDS[$k], $ow && crStaff($ow) ? $owner : $u['id'], $date('due'), $u['id'], now(), now()]);
            }
            crEv('pkt', $id, $u, 'staff', 'opened', 'Supplier packet opened by ' . $u['name'] . '.');
            ok(['pkt' => cqPktView(cqPkt($cid), true)]);

        case 'cq_pkt_get':
            $pk = $pktFor($str('cid', 40));
            $s = $p->prepare("SELECT * FROM cr_ev WHERE kind = 'pkt' AND ref = ?" . ($staff ? '' : ' AND vis = 1') . ' ORDER BY at');
            $s->execute([(string) $pk['id']]);
            $evs = array_map(fn($e) => ['at' => (int) $e['at'], 'byn' => (string) $e['byn'], 'side' => (string) $e['side'], 'ev' => (string) $e['ev'], 'msg' => (string) $e['msg']], $s->fetchAll());
            ok(['pkt' => cqPktView($pk, $staff), 'evs' => $evs] + ($staff ? ['contacts' => array_values(crContacts((string) $pk['cid']))] : []));

        case 'cq_pkt_set':
            // StratEdge: the owner, the company's people to tell, the due date
            $needStaff();
            $pk = $pktFor($str('cid', 40));
            $f = [];
            if (isset($b['owner'])) {
                $ow = userRow($str('owner', 40));
                if (!$ow || !crStaff($ow)) {
                    fail(400, 'invalid_argument', 'Pick someone at StratEdge.');
                }
                $f['owner'] = (string) $ow['id'];
            }
            if (isset($b['to'])) {
                // v64: only people whose role covers supplier documents are told
                $f['to_uids'] = json_encode(caFilter((string) $pk['cid'], array_values(array_intersect(array_map('strval', (array) $b['to']), array_keys(crContacts((string) $pk['cid'])))), 'supplier'));
            }
            if (isset($b['due'])) {
                $f['due'] = $date('due');
            }
            foreach ($f as $k => $v) {
                $p->prepare("UPDATE cq_pkt SET $k = ?, u = ? WHERE id = ?")->execute([$v, now(), (string) $pk['id']]);
            }
            ok(['pkt' => cqPktView(cqPkt((string) $pk['cid']), true)]);

        case 'cq_item_add':
            // the company asks for a document, or StratEdge notes what the company asked for
            $pk = $pktFor($str('cid', 40));
            $cqNeed((string) $pk['cid'], 'w');
            if ((string) $pk['st'] !== 'open') {
                fail(409, 'conflict', 'The packet is ' . strtolower(CQ_PST[(string) $pk['st']]) . '.');
            }
            $kind = isset(CQ_KINDS[(string) ($b['kind'] ?? '')]) ? (string) $b['kind'] : '';
            $ti = $str('ti', 160) ?: ($kind !== '' ? CQ_KINDS[$kind] : '');
            if ($kind === '' || $ti === '') {
                fail(400, 'invalid_argument', 'Say what is needed.');
            }
            $id = rid(8);
            $p->prepare("INSERT INTO cq_item (id, pkt, kind, ti, note, st, resp, due, req_by, req_side, rev, at, u) VALUES (?,?,?,?,?,'requested',?,?,?,?,'{}',?,?)")->execute([$id, (string) $pk['id'], $kind, $ti, $str('note', 1000), $staff ? ($str('resp', 40) ?: (string) $pk['owner']) : (string) $pk['owner'], $date('due'), $u['id'], $staff ? 'staff' : 'client', now(), now()]);
            crEv('pkt', (string) $pk['id'], $u, $staff ? 'staff' : 'client', 'requested', ($staff ? 'Added' : 'Requested') . ' by ' . $u['name'] . ': ' . $ti . ($date('due') !== '' ? ' (due ' . $date('due') . ')' : '') . '.');
            if (!$staff) {
                crMail(cqStaffTo($pk), 'Document requested by ' . crCompanyName((string) $pk['cid']) . ': ' . $ti, [$u['name'] . ' at ' . crCompanyName((string) $pk['cid']) . ' asked for: ' . $ti . '.', $str('note', 1000) ?: 'Supply it from the document library.'], 'pkt', (string) $pk['cid']);
            }
            cqCheckDone(cqPkt((string) $pk['cid']));
            ok(['pkt' => cqPktView(cqPkt((string) $pk['cid']), $staff)]);

        case 'cq_item_act':
            [$it, $pk] = $itemFor($str('id', 20));
            $act = (string) ($b['act'] ?? '');
            $cqNeed((string) $pk['cid'], 'w');
            $msg = $str('msg', 1000);
            $co = crCompanyName((string) $pk['cid']);
            if ((string) $pk['st'] !== 'open' && $act !== 'note') {
                fail(409, 'conflict', 'The packet is ' . strtolower(CQ_PST[(string) $pk['st']]) . '.');
            }
            $set = fn(array $f) => cqDb()->prepare('UPDATE cq_item SET ' . implode(', ', array_map(fn($k) => "$k = ?", array_keys($f))) . ', u = ? WHERE id = ?')->execute(array_merge(array_values(array_map(fn($v) => is_array($v) ? json_encode($v) : $v, $f)), [now(), (string) $it['id']]));
            switch ($act) {
                case 'supply':
                    $needStaff();
                    if (!in_array((string) $it['st'], ['requested', 'returned', 'supplied', 'approved'], true)) {
                        fail(409, 'conflict', 'This item is not needed any more.');
                    }
                    $doc = cqDocRow($str('doc', 20));
                    if (!$doc) {
                        fail(404, 'not_found', 'Pick a document from the library.');
                    }
                    if ((string) $doc['exp'] !== '' && (string) $doc['exp'] < cqToday()) {
                        fail(409, 'conflict', 'That document expired on ' . $doc['exp'] . '. Add the current one to the library first.');
                    }
                    if ((string) $it['kind'] !== 'other' && (string) $doc['kind'] !== (string) $it['kind'] && !in_array((string) $it['kind'], ['ref', 'pol', 'cert'], true)) {
                        fail(400, 'invalid_argument', 'That is a ' . strtolower(CQ_KINDS[(string) $doc['kind']]) . ', not a ' . strtolower(CQ_KINDS[(string) $it['kind']]) . '.');
                    }
                    $set(['st' => 'supplied', 'doc' => (string) $doc['id'], 'sup_at' => now(), 'rev' => []]);
                    $label = (string) $doc['ti'] . ' (version ' . (int) $doc['n'] . (in_array((string) $doc['kind'], CQ_AGREE, true) ? ', ' . ((string) $doc['ast'] === 'executed' ? 'executed' : 'draft') : '') . ((string) $doc['exp'] !== '' ? ', valid until ' . $doc['exp'] : '') . ')';
                    crEv('pkt', (string) $pk['id'], $u, 'staff', 'supplied', 'Supplied for "' . $it['ti'] . '": ' . $label . ($msg !== '' ? '. ' . $msg : '') . '.');
                    crMail(cqClientTo($pk), 'Document supplied: ' . $it['ti'], ['StratEdge supplied ' . $label . ' for "' . $it['ti'] . '".', 'Review it: approve it, or return it with what needs to change.'], 'pkt', (string) $pk['cid']);
                    break;
                case 'approve':
                case 'return':
                    if ($staff) {
                        fail(409, 'conflict', $co . ' reviews what StratEdge supplied.');
                    }
                    if ((string) $it['st'] !== 'supplied') {
                        fail(409, 'conflict', 'Only a supplied document is reviewed.');
                    }
                    if ($act === 'return' && $msg === '') {
                        fail(400, 'invalid_argument', 'Say what needs to change.');
                    }
                    $set(['st' => $act === 'approve' ? 'approved' : 'returned', 'rev' => ['d' => $act, 'n' => (string) $u['name'], 'by' => $u['id'], 'at' => now(), 'note' => $msg, 'doc' => (string) $it['doc']]]);
                    crEv('pkt', (string) $pk['id'], $u, 'client', $act === 'approve' ? 'approved' : 'returned', ($act === 'approve' ? 'Approved by ' : 'Returned by ') . $u['name'] . ': "' . $it['ti'] . '"' . ($msg !== '' ? ': ' . $msg : '') . '.');
                    crMail(cqStaffTo($pk, $it), ($act === 'approve' ? 'Approved: ' : 'Returned: ') . $it['ti'] . ' (' . $co . ')', [$u['name'] . ' at ' . $co . ($act === 'approve' ? ' approved ' : ' returned ') . '"' . $it['ti'] . '".', $msg], 'pkt', (string) $pk['cid']);
                    break;
                case 'waive':
                    if ((string) $it['st'] === 'approved') {
                        fail(409, 'conflict', 'An approved item stays.');
                    }
                    if ($staff && (string) $it['req_side'] === 'client') {
                        fail(409, 'conflict', $co . ' asked for this item; only they can say it is not needed.');
                    }
                    $set(['st' => 'waived', 'rev' => ['d' => 'waive', 'n' => (string) $u['name'], 'by' => $u['id'], 'at' => now(), 'note' => $msg]]);
                    crEv('pkt', (string) $pk['id'], $u, $staff ? 'staff' : 'client', 'waived', '"' . $it['ti'] . '" is not needed (' . $u['name'] . ')' . ($msg !== '' ? ': ' . $msg : '') . '.');
                    break;
                case 'set':
                    $needStaff();
                    $f = [];
                    if (isset($b['resp'])) {
                        $ow = userRow($str('resp', 40));
                        if (!$ow || !crStaff($ow)) {
                            fail(400, 'invalid_argument', 'Pick someone at StratEdge.');
                        }
                        $f['resp'] = (string) $ow['id'];
                    }
                    if (isset($b['due'])) {
                        $f['due'] = $date('due');
                    }
                    if ($f) {
                        $set($f);
                    }
                    break;
                default:
                    fail(400, 'invalid_argument', 'Unknown action.');
            }
            cqCheckDone(cqPkt((string) $pk['cid']));
            ok(['pkt' => cqPktView(cqPkt((string) $pk['cid']), $staff)]);

        case 'cq_decide':
            // the company records its decision: StratEdge qualified or not, with its evidence
            $pk = $pktFor($str('cid', 40));
            $cqNeed((string) $pk['cid'], 'w');
            $d = (string) ($b['d'] ?? '');
            if ($staff) {
                // StratEdge records a decision the company gave elsewhere, with who and the evidence
                if (!in_array($d, ['qualified', 'not'], true) || $str('who', 120) === '' || mb_strlen($str('msg', 1000)) < 8) {
                    fail(400, 'invalid_argument', 'Name who decided at the company and describe the evidence (for example: "approval email of Oct 6 from procurement").');
                }
            } elseif (!in_array($d, ['qualified', 'not'], true)) {
                fail(400, 'invalid_argument', 'Qualified or not qualified?');
            }
            if ($d === 'not' && $str('msg', 1000) === '') {
                fail(400, 'invalid_argument', 'Say why, so StratEdge can follow up.');
            }
            $dec = ['d' => $d, 'n' => $staff ? $str('who', 120) : (string) $u['name'], 'by' => $u['id'], 'side' => $staff ? 'staff' : 'client', 'rec' => $staff ? (string) $u['name'] : '', 'at' => now(), 'note' => $str('msg', 1000)];
            $p->prepare('UPDATE cq_pkt SET st = ?, dec = ?, u = ? WHERE id = ?')->execute([$d === 'qualified' ? 'qualified' : 'not', json_encode($dec), now(), (string) $pk['id']]);
            crEv('pkt', (string) $pk['id'], $u, $staff ? 'staff' : 'client', $d, ($d === 'qualified' ? 'StratEdge qualified as a supplier' : 'Not qualified') . ' by ' . $dec['n'] . ($staff ? ' (recorded by ' . $u['name'] . ')' : '') . ($dec['note'] !== '' ? ': ' . $dec['note'] : '') . '.');
            crMail($staff ? cqClientTo($pk) : cqStaffTo($pk), ($d === 'qualified' ? 'Supplier qualification: approved' : 'Supplier qualification: not approved') . ' (' . crCompanyName((string) $pk['cid']) . ')', [($d === 'qualified' ? 'StratEdge is qualified as a supplier of ' : 'StratEdge is not qualified as a supplier of ') . crCompanyName((string) $pk['cid']) . ' (' . $dec['n'] . ').', $dec['note']], 'pkt', (string) $pk['cid']);
            ok(['pkt' => cqPktView(cqPkt((string) $pk['cid']), $staff)]);

        case 'cq_reopen':
            $needStaff();
            $pk = $pktFor($str('cid', 40));
            $p->prepare("UPDATE cq_pkt SET st = 'open', u = ? WHERE id = ?")->execute([now(), (string) $pk['id']]);
            crEv('pkt', (string) $pk['id'], $u, 'staff', 'reopened', 'Reopened by ' . $u['name'] . ($str('msg', 500) !== '' ? ': ' . $str('msg', 500) : '') . '.');
            ok(['pkt' => cqPktView(cqPkt((string) $pk['cid']), true)]);
    }
    fail(404, 'not_found', 'Unknown request.');
}
