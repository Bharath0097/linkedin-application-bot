<?php
declare(strict_types=1);
/*
 * v48 The shortlist room (CC-03): StratEdge presents candidates for a client company's talent request as consistent
 * packets, side by side, and the company decides on each.
 *
 * A packet is about the request: each must-have skill with its evidence, and whether that evidence is what the
 * candidate says, what StratEdge reviewed (a screening, a technical round) or what was independently verified (a
 * certificate, a reference); the screening (date, by whom, notes); questions still open; availability with the date it
 * was last confirmed (older than 14 days shows a warning); the bill rate StratEdge offers (never the consultant's own
 * pay); location, work arrangement and authorization; and interview evidence (requested, scheduled, completed: a
 * requested interview is never shown as one that took place).
 *
 * A packet can be shared as an anonymized preview (no name, no resume, no contact details) at any time; the name and
 * the resume are shown only for a candidate whose submission to this requirement was sent on the bench desk (so the
 * consultant approved it and the repeat checks ran). Contact details are never shown. Each share is a version; a
 * changed packet is shared again as a new version and the client always decides on the current one.
 *
 * The client can ask for an interview, ask a question, put a candidate on hold, decline with a reason, or select
 * them. Each decision is mirrored on the submission (its history, and its stage moves forward where it applies) so
 * the recruiter works from it. Who sees what: the client company's contacts see the shared packets of their own
 * requests only; StratEdge staff who work client accounts see and manage everything.
 *
 * Tables (main database): cr_sl (one candidate in one request's shortlist), cr_slver (each shared packet).
 */

const SL_ST = ['draft' => 'Not shared yet', 'shared' => 'Waiting for a decision', 'question' => 'Question asked', 'interview' => 'Interview requested', 'hold' => 'On hold', 'declined' => 'Declined', 'selected' => 'Selected', 'withdrawn' => 'Withdrawn'];
const SL_LIVE = ['shared', 'question', 'interview', 'hold'];
const SL_KIND = ['claim' => 'Candidate says', 'reviewed' => 'Reviewed by StratEdge', 'verified' => 'Verified'];
const SL_WHY = ['skills' => 'Skills do not match', 'experience' => 'Not enough experience', 'rate' => 'Rate', 'avail' => 'Not available in time', 'location' => 'Location or work arrangement', 'auth' => 'Work authorization', 'filled' => 'The role is filled', 'other' => 'Another reason'];
const SL_UNITS = ['hour' => 'per hour', 'day' => 'per day', 'year' => 'per year (salary)', 'tbd' => 'to be discussed'];
const SL_IV = ['requested' => 'Interview requested', 'scheduled' => 'Interview scheduled', 'completed' => 'Interview completed', 'cancelled' => 'Interview cancelled'];
const SL_AVAIL_DAYS = 14;

function slDb(): PDO
{
    static $ready = false;
    $p = crDb();
    if (!$ready) {
        $ready = true;
        $p->exec("CREATE TABLE IF NOT EXISTS cr_sl (id VARCHAR(20) PRIMARY KEY, req VARCHAR(20) NOT NULL, cid VARCHAR(40) NOT NULL, cand VARCHAR(40) NOT NULL DEFAULT '', sub VARCHAR(40) NOT NULL DEFAULT '', alias VARCHAR(40) NOT NULL, st VARCHAR(12) NOT NULL, ver INT NOT NULL DEFAULT 0, anon INT NOT NULL DEFAULT 1, data TEXT NOT NULL, intv TEXT NOT NULL, `dec` TEXT NOT NULL, by_uid VARCHAR(40) NOT NULL, at BIGINT NOT NULL, u BIGINT NOT NULL, shared_at BIGINT NOT NULL DEFAULT 0, dec_at BIGINT NOT NULL DEFAULT 0)");
        $p->exec('CREATE INDEX IF NOT EXISTS cr_sl_req ON cr_sl (req, st)');
        $p->exec("CREATE TABLE IF NOT EXISTS cr_slver (id VARCHAR(20) PRIMARY KEY, sl VARCHAR(20) NOT NULL, n INT NOT NULL, data TEXT NOT NULL, anon INT NOT NULL DEFAULT 1, at BIGINT NOT NULL, by_uid VARCHAR(40) NOT NULL, byn VARCHAR(120) NOT NULL DEFAULT '', note VARCHAR(500) NOT NULL DEFAULT '')");
        $p->exec('CREATE INDEX IF NOT EXISTS cr_slver_sl ON cr_slver (sl, n)');
    }
    return $p;
}
function slRow(string $id): ?array
{
    $s = slDb()->prepare('SELECT * FROM cr_sl WHERE id = ?');
    $s->execute([$id]);
    $r = $s->fetch();
    if (!$r) {
        return null;
    }
    foreach (['data', 'intv', 'dec'] as $k) {
        $r[$k] = json_decode((string) $r[$k], true) ?: [];
    }
    return $r;
}
function slVer(string $sl, int $n): ?array
{
    $s = slDb()->prepare('SELECT * FROM cr_slver WHERE sl = ? AND n = ?');
    $s->execute([$sl, $n]);
    $r = $s->fetch();
    if (!$r) {
        return null;
    }
    $r['data'] = json_decode((string) $r['data'], true) ?: [];
    return $r;
}
function slSet(string $id, array $f): void
{
    $sets = [];
    $vals = [];
    foreach ($f as $k => $v) {
        $sets[] = "`$k` = ?"; // v83: quoted (the column dec is a reserved word on MySQL/MariaDB)
        $vals[] = is_array($v) ? json_encode($v) : $v;
    }
    $sets[] = 'u = ?';
    $vals[] = now();
    $vals[] = $id;
    slDb()->prepare('UPDATE cr_sl SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($vals);
}
/** "Candidate A", "Candidate B" … in the order they join a request's shortlist. */
function slAlias(string $req): string
{
    $s = slDb()->prepare('SELECT COUNT(*) FROM cr_sl WHERE req = ?');
    $s->execute([$req]);
    $n = (int) $s->fetchColumn();
    $l = '';
    do {
        $l = chr(65 + $n % 26) . $l;
        $n = intdiv($n, 26) - 1;
    } while ($n >= 0);
    return 'Candidate ' . $l;
}
/** A packet from the page, cleaned. */
function slPacketIn($in): array
{
    $a = (array) $in;
    $s = fn($v, int $max) => mb_substr(trim((string) $v), 0, $max);
    $kind = fn($v) => isset(SL_KIND[(string) $v]) ? (string) $v : 'claim';
    $date = fn($v) => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $v) ? (string) $v : '';
    $match = [];
    foreach (array_slice((array) ($a['match'] ?? []), 0, 20) as $m) {
        $m = (array) $m;
        if ($s($m['need'] ?? '', 200) === '' && $s($m['ev'] ?? '', 600) === '') {
            continue;
        }
        $match[] = ['need' => $s($m['need'] ?? '', 200), 'ev' => $s($m['ev'] ?? '', 600), 'kind' => $kind($m['kind'] ?? '')];
    }
    $ev = [];
    foreach (array_slice((array) ($a['ev'] ?? []), 0, 20) as $m) {
        $m = (array) $m;
        if ($s($m['t'] ?? '', 600) === '') {
            continue;
        }
        $ev[] = ['t' => $s($m['t'] ?? '', 600), 'kind' => $kind($m['kind'] ?? ''), 'src' => $s($m['src'] ?? '', 120)];
    }
    $sc = (array) ($a['screen'] ?? []);
    $av = (array) ($a['avail'] ?? []);
    $rt = (array) ($a['rate'] ?? []);
    $unit = isset(SL_UNITS[(string) ($rt['unit'] ?? '')]) ? (string) $rt['unit'] : 'hour';
    $amt = is_numeric($rt['amt'] ?? null) && (float) $rt['amt'] > 0 && (float) $rt['amt'] < 10000000 ? round((float) $rt['amt'], 2) : null;
    $md = $s($a['md'] ?? '', 12);
    return [
        'name' => $s($a['name'] ?? '', 120), 'headline' => $s($a['headline'] ?? '', 200), 'summary' => $s($a['summary'] ?? '', 3000),
        'match' => $match, 'ev' => $ev,
        'screen' => ['date' => $date($sc['date'] ?? ''), 'by' => $s($sc['by'] ?? '', 120), 'notes' => $s($sc['notes'] ?? '', 2000)],
        'open' => array_values(array_filter(array_map(fn($x) => $s($x, 300), array_slice((array) ($a['open'] ?? []), 0, 10)), fn($x) => $x !== '')),
        'avail' => ['from' => $date($av['from'] ?? ''), 'note' => $s($av['note'] ?? '', 200), 'conf' => max(0, (int) ($av['conf'] ?? 0)), 'how' => $s($av['how'] ?? '', 40)],
        'rate' => ['amt' => $unit === 'tbd' ? null : $amt, 'unit' => $unit, 'cur' => in_array((string) ($rt['cur'] ?? 'USD'), CR_CURS, true) ? (string) ($rt['cur'] ?? 'USD') : 'USD'],
        'loc' => $s($a['loc'] ?? '', 160), 'md' => in_array($md, ['Onsite', 'Hybrid', 'Remote'], true) ? $md : '', 'auth' => $s($a['auth'] ?? '', 120),
    ];
}
/** A first packet from the consultant's record, the submission and the request's must-have skills. */
function slSeed(array $q, ?stdClass $c, ?stdClass $sub): array
{
    $need = array_values(array_filter(array_map('trim', preg_split('/[,;\n]+/', (string) ($q['data']['must'] ?? '')) ?: []), fn($x) => $x !== ''));
    $fr = $c ? bdFresh($c) : null;
    $conf = $fr && $fr['avail']['st'] !== 'missing' ? (int) $fr['avail']['at'] : 0;
    return slPacketIn([
        'name' => $c ? (string) ($c->n ?? '') : (string) ($sub->cn ?? ''),
        'headline' => $c ? trim((string) ($c->ti ?? '') . ((string) ($c->exp ?? '') !== '' ? ', ' . $c->exp : '')) : '',
        'match' => array_map(fn($n) => ['need' => $n, 'ev' => '', 'kind' => 'claim'], array_slice($need, 0, 20)),
        'avail' => ['from' => $c ? (string) ($c->availDate ?? '') : '', 'note' => $c ? (string) ($c->avail ?? '') : '', 'conf' => $conf, 'how' => $fr ? (string) $fr['avail']['how'] : ''],
        'rate' => ['amt' => null, 'unit' => (string) ($q['data']['bu'] ?? 'hour') === 'year' ? 'year' : 'hour', 'cur' => (string) ($q['data']['cur'] ?? 'USD')],
        'loc' => $c ? (string) ($c->loc ?? '') : '', 'md' => '', 'auth' => $c ? (string) ($c->auth ?? '') : '',
    ]);
}
/** What a packet still needs before it is shared ('' when ready). */
function slMissing(array $d): string
{
    $miss = [];
    if ($d['headline'] === '') {
        $miss[] = 'a headline';
    }
    if (!array_filter($d['match'], fn($m) => $m['ev'] !== '')) {
        $miss[] = 'the evidence for at least one must-have skill';
    }
    if ($d['rate']['unit'] !== 'tbd' && $d['rate']['amt'] === null) {
        $miss[] = 'the rate (or "to be discussed")';
    }
    if ($d['avail']['from'] === '' && $d['avail']['note'] === '') {
        $miss[] = 'the availability';
    }
    return $miss ? 'Add ' . implode(', ', $miss) . ' before sharing.' : '';
}
/** May the name and resume be shown: a linked submission to this request's requirement that was sent on the bench desk. */
function slNamedOk(array $sl, array $q): string
{
    if ((string) $sl['sub'] === '') {
        return 'Only an anonymized preview: link the candidate\'s submission first (the name and resume need the consultant\'s approval to represent them).';
    }
    $s = bdSub((string) $sl['sub']);
    if (!$s || (string) ($s->vreq ?? '') !== (string) $q['vreq']) {
        return 'The linked submission is not for this requirement.';
    }
    if (in_array((string) ($s->st ?? ''), BD_PRE, true)) {
        return 'Send the submission on the bench desk first (the consultant\'s approval and the repeat checks), then share the name and resume.';
    }
    if (in_array((string) ($s->st ?? ''), ['rejected', 'withdrawn', 'closed'], true)) {
        return 'The submission is ' . strtolower(BD_STAGES[(string) $s->st]) . '.';
    }
    return '';
}
/** The resume that went out with the submission, copied into the shortlist so a later file never changes what was shared. */
function slResumeCopy(string $slId, stdClass $s): ?array
{
    $pk = $s->pk ?? null;
    $r = $pk->resume ?? null;
    if (!$r || empty($r->id)) {
        return null;
    }
    $plain = fileRead((string) $r->id);
    if ($plain === null || $plain === '') {
        return null;
    }
    $n = preg_replace('/[^A-Za-z0-9 ._()\-]/', '_', (string) ($r->n ?? 'resume')) ?: 'resume';
    $ext = strtolower(pathinfo($n, PATHINFO_EXTENSION));
    $fid = rid(16);
    if (!fileWritePath(filePathOf($fid), $plain)) {
        return null;
    }
    $ty = MIME[$ext] ?? 'application/octet-stream';
    docSet('cr/sl/' . $slId . '/f/' . $fid, (object) ['n' => $n, 'ty' => $ty, 'sz' => strlen($plain), 'at' => now(), 'c' => 'resume']);
    return ['fid' => $fid, 'n' => $n, 'ty' => $ty];
}
/** Availability older than SL_AVAIL_DAYS (or never confirmed) shows a warning. */
function slAvailWarn(array $d): string
{
    $c = (int) ($d['avail']['conf'] ?? 0);
    if ($c <= 0) {
        return 'Availability not confirmed yet.';
    }
    $days = (int) floor((now() - $c) / 86400000);
    return $days > SL_AVAIL_DAYS ? 'Availability last confirmed ' . $days . ' days ago.' : '';
}
/** One shortlist entry as the caller may see it. */
function slView(array $sl, bool $staff, ?array $v = null): array
{
    $v = $v ?? ((int) $sl['ver'] > 0 ? slVer((string) $sl['id'], (int) $sl['ver']) : null);
    $d = $staff && !$v ? $sl['data'] : ($v ? $v['data'] : []);
    $anon = $v ? (int) $v['anon'] === 1 : true;
    if (!$staff && $anon) {
        $d['name'] = '';
        unset($d['resume']);
    }
    $out = [
        'id' => (string) $sl['id'], 'req' => (string) $sl['req'], 'alias' => (string) $sl['alias'], 'st' => (string) $sl['st'], 'ver' => (int) $sl['ver'], 'anon' => $anon,
        'data' => $d, 'intv' => array_values((array) $sl['intv']), 'dec' => $sl['dec'] ?: null, 'warn' => $d ? slAvailWarn($d) : '', 'sharedAt' => (int) $sl['shared_at'], 'u' => (int) $sl['u'],
    ];
    if ($staff) {
        $out += ['draft' => $sl['data'], 'draftWarn' => slAvailWarn($sl['data']), 'unshared' => $v && json_encode(array_diff_key($v['data'], ['resume' => 1])) !== json_encode(array_diff_key($sl['data'], ['resume' => 1])), 'cand' => (string) $sl['cand'], 'sub' => (string) $sl['sub']];
        if ((string) $sl['sub'] !== '' && ($s = bdSub((string) $sl['sub']))) {
            $out['subSt'] = (string) ($s->st ?? '');
            $out['subStN'] = BD_STAGES[(string) ($s->st ?? '')] ?? '';
        }
    }
    return $out;
}
/** A client decision mirrored on the linked submission: a line in its history, and its stage moves forward where it applies. */
function slMirror(array $sl, array $u, string $act, string $line): void
{
    if ((string) $sl['sub'] === '' || !($s = bdSub((string) $sl['sub']))) {
        return;
    }
    $st = (string) ($s->st ?? '');
    $to = '';
    if ($act === 'interview' && in_array($st, ['submitted', 'screening'], true)) {
        $to = 'interview';
    } elseif ($act === 'select' && in_array($st, ['submitted', 'screening', 'interview', 'hold'], true)) {
        $to = 'offer';
    } elseif ($act === 'decline' && !in_array($st, BD_DONE, true) && !in_array($st, BD_PRE, true)) {
        $to = 'rejected';
    } elseif ($act === 'hold' && in_array($st, ['submitted', 'screening', 'interview'], true)) {
        $to = 'hold';
    }
    bdHist($s, (string) $u['name'], 'Shortlist room: ' . $line . ($to !== '' ? ' (' . BD_STAGES[$to] . ')' : ''));
    if ($to !== '') {
        $s->st = $to;
        $s->stAt = now();
        if ($to === 'rejected') {
            $s->why = mb_substr($line, 0, 400);
            $s->next = null;
        } elseif ($to === 'interview') {
            $s->next = (object) ['what' => 'Arrange the interview ' . crCompanyName((string) $sl['cid']) . ' asked for', 'due' => date('Y-m-d', time() + 86400), 'own' => (string) (($s->own ?? '') ?: ($s->by ?? '')), 'ownn' => (string) (($s->ownn ?? '') ?: ($s->byn ?? '')), 'at' => now(), 'by' => (string) $u['name']];
        }
    }
    $s->u = now();
    docSet('rec/sub/items/' . $sl['sub'], $s);
}
/** For StratEdge: how the shortlist is going (decisions, time to the first decision, interviews asked for of those reviewed). */
function slMeasures(array $rows): array
{
    $shared = array_filter($rows, fn($r) => (int) $r['ver'] > 0);
    $decided = array_filter($shared, fn($r) => (int) $r['dec_at'] > 0);
    $waits = array_map(fn($r) => (int) $r['dec_at'] - (int) $r['shared_at'], array_filter($decided, fn($r) => (int) $r['shared_at'] > 0));
    $iv = array_filter($shared, fn($r) => array_filter((array) $r['intv'], fn($x) => ($x['k'] ?? '') === 'requested'));
    $done = array_filter($shared, fn($r) => array_filter((array) $r['intv'], fn($x) => ($x['k'] ?? '') === 'completed'));
    return ['shared' => count($shared), 'decided' => count($decided), 'firstMs' => $waits ? (int) round(array_sum($waits) / count($waits)) : 0, 'ivReq' => count($iv), 'ivDone' => count($done), 'selected' => count(array_filter($shared, fn($r) => $r['st'] === 'selected'))];
}

function slRoute(string $r, array $b, array $u, bool $staff, array $myC): never
{
    require_once __DIR__ . '/bench.php';
    $p = slDb();
    $str = fn(string $k, int $max) => mb_substr(trim((string) ($b[$k] ?? '')), 0, $max);
    $byReq = function (string $req) use ($p, $staff): array {
        $s = $p->prepare('SELECT * FROM cr_sl WHERE req = ?' . ($staff ? '' : ' AND ver > 0') . ' ORDER BY at');
        $s->execute([$req]);
        return array_map(function ($x) {
            foreach (['data', 'intv', 'dec'] as $k) {
                $x[$k] = json_decode((string) $x[$k], true) ?: [];
            }
            return $x;
        }, $s->fetchAll());
    };
    // v64: a contact's role: reading the shortlist, or deciding on candidates
    $slNeed = function (string $cid, string $need) use ($u, $staff): void {
        if (!$staff && !caMay(caAccess($u, $cid), 'shortlist', $need)) {
            fail($need === 'w' ? 403 : 404, $need === 'w' ? 'forbidden' : 'not_found', $need === 'w' ? 'Your role at ' . crCompanyName($cid) . ' reads the shortlist but does not decide on candidates.' : 'No such request.');
        }
    };
    // one entry, with its request (checked: the caller's company, or staff)
    $one = function (string $id) use ($u, $staff, $slNeed): array {
        $sl = slRow($id);
        if (!$sl || (!$staff && (int) $sl['ver'] === 0)) {
            fail(404, 'not_found', 'No such candidate in the shortlist.');
        }
        $q = crReqFor((string) $sl['req'], $u);
        $slNeed((string) $q['cid'], 'r');
        return [$sl, $q];
    };
    switch ($r) {
        case 'cr_sl_list':
            $q = crReqFor($str('req', 20), $u);
            $slNeed((string) $q['cid'], 'r');
            $rows = $byReq((string) $q['id']);
            $out = ['items' => array_map(fn($x) => slView($x, $staff), $rows), 'st' => SL_ST, 'kinds' => SL_KIND, 'why' => SL_WHY, 'units' => SL_UNITS, 'iv' => SL_IV, 'availDays' => SL_AVAIL_DAYS, 'ro' => !$staff && !caMay(caAccess($u, (string) $q['cid']), 'shortlist', 'w')];
            if ($staff) {
                $out['measures'] = slMeasures($rows);
                // candidates to add: submissions to this request's requirement on the desk, not in the shortlist yet
                $have = array_flip(array_filter(array_column($rows, 'sub')));
                $subs = [];
                if ((string) $q['vreq'] !== '') {
                    foreach (colAll('rec/sub/items') as [$sid, $s]) {
                        if ((string) ($s->vreq ?? '') === (string) $q['vreq'] && !isset($have[(string) $sid]) && !in_array((string) ($s->st ?? ''), ['rejected', 'withdrawn', 'closed'], true)) {
                            $subs[] = ['sid' => (string) $sid, 'cn' => (string) ($s->cn ?? ''), 'cand' => (string) ($s->cid ?? ''), 'st' => (string) ($s->st ?? ''), 'stN' => BD_STAGES[(string) ($s->st ?? '')] ?? '', 'sent' => !in_array((string) ($s->st ?? ''), BD_PRE, true)];
                        }
                    }
                }
                $out['subs'] = $subs;
            }
            ok($out);

        case 'cr_sl_find':
            // StratEdge: consultants by name, title or skill, to add to a shortlist as an anonymized preview
            if (!$staff) {
                fail(403, 'forbidden', 'StratEdge builds the shortlist.');
            }
            $qq = mb_strtolower($str('q', 80));
            $hits = [];
            if (mb_strlen($qq) >= 2) {
                foreach (colAll('rec/cand/items') as [$cid, $c]) {
                    $hay = mb_strtolower((string) ($c->n ?? '') . ' ' . (string) ($c->ti ?? '') . ' ' . (string) ($c->sk ?? ''));
                    if (str_contains($hay, $qq) && !in_array((string) ($c->st ?? ''), ['placed', 'inactive'], true)) {
                        $hits[] = ['cand' => (string) $cid, 'n' => (string) ($c->n ?? ''), 'ti' => (string) ($c->ti ?? ''), 'loc' => (string) ($c->loc ?? '')];
                        if (count($hits) >= 20) {
                            break;
                        }
                    }
                }
            }
            ok(['hits' => $hits]);

        case 'cr_sl_add':
            if (!$staff) {
                fail(403, 'forbidden', 'StratEdge builds the shortlist.');
            }
            $q = crReqFor($str('req', 20), $u);
            if (!in_array((string) $q['st'], ['active', 'approved', 'hold'], true)) {
                fail(409, 'conflict', 'A shortlist is for an approved request.');
            }
            $sub = null;
            $cand = null;
            $sid = $str('sub', 40);
            if ($sid !== '') {
                $sub = bdSub($sid);
                if (!$sub || (string) ($sub->vreq ?? '') === '' || (string) $sub->vreq !== (string) $q['vreq']) {
                    fail(400, 'invalid_argument', 'That submission is not for this request\'s requirement.');
                }
                $cand = !empty($sub->cid) ? bdCand((string) $sub->cid) : null;
            } else {
                $cand = bdCand($str('cand', 40));
                if (!$cand) {
                    fail(404, 'not_found', 'That consultant is no longer in the database.');
                }
            }
            $candId = $sub ? (string) ($sub->cid ?? '') : $str('cand', 40);
            $dupe = $p->prepare('SELECT COUNT(*) FROM cr_sl WHERE req = ? AND ((cand <> \'\' AND cand = ?) OR (sub <> \'\' AND sub = ?)) AND st <> \'withdrawn\'');
            $dupe->execute([(string) $q['id'], $candId, $sid]);
            if ((int) $dupe->fetchColumn() > 0) {
                fail(409, 'conflict', 'This candidate is already in the shortlist.');
            }
            $id = rid(8);
            $alias = slAlias((string) $q['id']);
            $p->prepare("INSERT INTO cr_sl (id, req, cid, cand, sub, alias, st, ver, anon, data, intv, `dec`, by_uid, at, u) VALUES (?,?,?,?,?,?,'draft',0,1,?,'[]','{}',?,?,?)")->execute([$id, (string) $q['id'], (string) $q['cid'], $candId, $sid, $alias, json_encode(slSeed($q, $cand, $sub)), $u['id'], now(), now()]);
            crEv('req', (string) $q['id'], $u, 'staff', 'note', $alias . ' (' . ($cand ? (string) ($cand->n ?? '') : (string) ($sub->cn ?? '')) . ') added to the shortlist.', false);
            ok(['id' => $id, 'alias' => $alias]);

        case 'cr_sl_save':
            if (!$staff) {
                fail(403, 'forbidden', 'StratEdge prepares the packets.');
            }
            [$sl] = $one($str('id', 20));
            if (!in_array((string) $sl['st'], array_merge(['draft'], SL_LIVE), true)) {
                fail(409, 'conflict', 'This candidate\'s decision is made: the packet is not changed any more.');
            }
            $d = slPacketIn($b['data'] ?? []);
            // the date availability was confirmed comes from the record, or from "confirmed today" here
            $d['avail']['conf'] = !empty($b['availNow']) ? now() : (int) ($sl['data']['avail']['conf'] ?? 0);
            $d['avail']['how'] = !empty($b['availNow']) ? 'recruiter' : (string) ($sl['data']['avail']['how'] ?? '');
            slSet((string) $sl['id'], ['data' => $d]);
            ok(['id' => (string) $sl['id'], 'missing' => slMissing($d), 'warn' => slAvailWarn($d)]);

        case 'cr_sl_file':
            // the resume of a named packet (the copy made when it was shared), for the client and StratEdge: a link
            // (GET, same site), so its id and version come in the address
            [$sl] = $one(mb_substr((string) ($_GET['id'] ?? ($b['id'] ?? '')), 0, 20));
            $v = slVer((string) $sl['id'], max(1, (int) ($_GET['ver'] ?? ($b['ver'] ?? $sl['ver']))));
            if (!$v || ((int) $v['anon'] === 1 && !$staff) || empty($v['data']['resume']['fid'])) {
                fail(404, 'not_found', 'No resume to show for this candidate.');
            }
            $f = filePathOf((string) $v['data']['resume']['fid']);
            if (!is_file($f)) {
                fail(404, 'not_found', 'The file is no longer there.');
            }
            $ty = (string) ($v['data']['resume']['ty'] ?? 'application/octet-stream');
            // documents count towards the data-theft guard, as other downloads do
            guardDlp($u, 'file', (string) ($v['data']['resume']['n'] ?? 'resume'));
            header('Content-Type: ' . $ty);
            header('Content-Length: ' . filePlainSize($f));
            header("Content-Security-Policy: default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox; frame-ancestors 'self'");
            header('Content-Disposition: attachment; filename="' . preg_replace('/[^A-Za-z0-9 ._()\-]/', '_', (string) ($v['data']['resume']['n'] ?? 'resume')) . '"');
            header('Cache-Control: private, max-age=60');
            crEv('req', (string) $sl['req'], $u, $staff ? 'staff' : 'client', 'note', $u['name'] . ' downloaded the resume of ' . (string) $sl['alias'] . ' (version ' . (int) $v['n'] . ').', false);
            fileServePath($f);
            exit;

        case 'cr_sl_act':
            [$sl, $q] = $one($str('id', 20));
            $id = (string) $sl['id'];
            $st = (string) $sl['st'];
            $act = (string) ($b['act'] ?? '');
            $msg = $str('msg', 2000);
            $co = crCompanyName((string) $q['cid']);
            $who = (int) $sl['ver'] > 0 && (int) (slVer($id, (int) $sl['ver'])['anon'] ?? 1) === 0 ? (string) ($sl['data']['name'] ?? $sl['alias']) . ' (' . $sl['alias'] . ')' : (string) $sl['alias'];
            $ivAdd = function (string $k, string $date, string $note) use ($sl, $u, $id) {
                $iv = array_values((array) $sl['intv']);
                $iv[] = ['k' => $k, 'date' => $date, 'note' => mb_substr($note, 0, 400), 'at' => now(), 'by' => (string) $u['name']];
                slSet($id, ['intv' => array_slice($iv, -30)]);
            };
            $clientTo = array_values(array_unique(array_filter([(string) $q['by_uid']])));
            if (in_array($act, ['share', 'reveal', 'answer', 'iv', 'withdraw', 'conf'], true) && !$staff) {
                fail(403, 'forbidden', 'StratEdge does that.');
            }
            if (in_array($act, ['interview', 'ask', 'hold', 'resume', 'decline', 'select'], true)) {
                if ($staff) {
                    fail(409, 'conflict', 'The client decides on candidates.');
                }
                $slNeed((string) $q['cid'], $act === 'ask' ? 'r' : 'w');
                if ((int) ($b['ver'] ?? 0) !== (int) $sl['ver']) {
                    fail(409, 'conflict', 'StratEdge shared a newer packet for ' . $sl['alias'] . ': review version ' . (int) $sl['ver'] . ' first.');
                }
            }
            switch ($act) {
                case 'share':
                case 'reveal':
                    if (!in_array($st, array_merge(['draft'], SL_LIVE), true)) {
                        fail(409, 'conflict', 'This candidate\'s decision is made.');
                    }
                    if ((string) $q['st'] !== 'active') {
                        fail(409, 'conflict', 'Start sourcing for the request before sharing candidates.');
                    }
                    $d = $sl['data'];
                    if (($miss = slMissing($d)) !== '') {
                        fail(400, 'invalid_argument', $miss);
                    }
                    $named = $act === 'reveal' || empty($b['anon']);
                    if ($named && ($why = slNamedOk($sl, $q)) !== '') {
                        fail(409, 'needs_submission', $why);
                    }
                    $last = (int) $sl['ver'] > 0 ? slVer($id, (int) $sl['ver']) : null;
                    if ($last && (int) $last['anon'] === ($named ? 0 : 1) && json_encode(array_diff_key($last['data'], ['resume' => 1])) === json_encode(array_diff_key($d, ['resume' => 1]))) {
                        fail(409, 'conflict', 'Nothing changed since version ' . (int) $sl['ver'] . ' was shared.');
                    }
                    if ($last && (int) $last['anon'] === 0 && !$named) {
                        fail(409, 'conflict', 'The name was already shared; a packet cannot go back to anonymous.');
                    }
                    if ($named) {
                        $copy = $last && (int) $last['anon'] === 0 && !empty($last['data']['resume']) ? $last['data']['resume'] : slResumeCopy($id, bdSub((string) $sl['sub']));
                        if ($copy) {
                            $d['resume'] = $copy;
                        }
                    } else {
                        unset($d['resume']);
                    }
                    $n = (int) $sl['ver'] + 1;
                    $p->prepare('INSERT INTO cr_slver (id, sl, n, data, anon, at, by_uid, byn, note) VALUES (?,?,?,?,?,?,?,?,?)')->execute([rid(8), $id, $n, json_encode($d), $named ? 0 : 1, now(), $u['id'], (string) $u['name'], $msg]);
                    $nextSt = $st === 'draft' || $st === 'question' ? 'shared' : $st;
                    slSet($id, ['ver' => $n, 'st' => $nextSt, 'anon' => $named ? 0 : 1, 'shared_at' => (int) $sl['shared_at'] ?: now()]);
                    $label = $named ? (string) ($d['name'] ?: $sl['alias']) . ' (' . $sl['alias'] . ')' : (string) $sl['alias'];
                    crEv('req', (string) $q['id'], $u, 'staff', 'shortlist', ($act === 'reveal' ? 'Name and resume shared for ' : ($n > 1 ? 'Updated packet (version ' . $n . ') for ' : 'Shortlisted: ')) . $label . ($named ? '' : ' (anonymized preview)') . ($msg !== '' ? '. ' . $msg : '') . '.');
                    crMail($clientTo, ($n > 1 ? 'Updated candidate for ' : 'New candidate for ') . $q['ti'], ['StratEdge ' . ($n > 1 ? 'updated the packet of ' : 'added ') . $label . ' to the shortlist for "' . $q['ti'] . '".', $msg !== '' ? $msg : 'Open the shortlist to compare the candidates and decide: ask for an interview, ask a question, hold, decline or select.'], 'sl', (string) $q['id']);
                    break;
                case 'answer':
                    if ($msg === '') {
                        fail(400, 'invalid_argument', 'Write the answer.');
                    }
                    if ($st === 'question') {
                        slSet($id, ['st' => 'shared']);
                    }
                    crEv('req', (string) $q['id'], $u, 'staff', 'msg', 'About ' . $who . ': ' . $msg);
                    crMail($clientTo, 'Answer about ' . $sl['alias'] . ': ' . $q['ti'], ['StratEdge answered your question about ' . $who . ' ("' . $q['ti'] . '"):', $msg], 'sl', (string) $q['id']);
                    break;
                case 'iv':
                    $k = (string) ($b['k'] ?? '');
                    if (!in_array($k, ['scheduled', 'completed', 'cancelled'], true) || (int) $sl['ver'] === 0) {
                        fail(400, 'invalid_argument', 'Say whether the interview is scheduled, completed or cancelled.');
                    }
                    $date = preg_match('/^\d{4}-\d{2}-\d{2}$/', $str('date', 10)) ? $str('date', 10) : '';
                    if ($k !== 'cancelled' && $date === '') {
                        fail(400, 'invalid_argument', 'Give the interview\'s date.');
                    }
                    if ($k === 'completed' && $date > date('Y-m-d')) {
                        fail(400, 'invalid_argument', 'An interview in the future cannot be completed yet.');
                    }
                    $ivAdd($k, $date, $msg);
                    crEv('req', (string) $q['id'], $u, 'staff', 'interview', SL_IV[$k] . ' for ' . $who . ($date !== '' ? ' (' . $date . ')' : '') . ($msg !== '' ? ': ' . $msg : '') . '.');
                    if ($k === 'scheduled') {
                        crMail($clientTo, 'Interview scheduled: ' . $sl['alias'] . ' for ' . $q['ti'], ['The interview with ' . $who . ' is scheduled for ' . $date . '.', $msg], 'sl', (string) $q['id']);
                    }
                    break;
                case 'withdraw':
                    if (!in_array($st, array_merge(['draft'], SL_LIVE), true)) {
                        fail(409, 'conflict', 'This candidate\'s decision is made.');
                    }
                    if ($msg === '' && (int) $sl['ver'] > 0) {
                        fail(400, 'invalid_argument', 'Say why (the client reads it).');
                    }
                    slSet($id, ['st' => 'withdrawn']);
                    crEv('req', (string) $q['id'], $u, 'staff', 'shortlist', $who . ' withdrawn from the shortlist' . ($msg !== '' ? ': ' . $msg : '') . '.', (int) $sl['ver'] > 0);
                    if ((int) $sl['ver'] > 0) {
                        crMail($clientTo, 'Candidate withdrawn: ' . $sl['alias'] . ' for ' . $q['ti'], ['StratEdge withdrew ' . $who . ' from the shortlist for "' . $q['ti'] . '":', $msg], 'sl', (string) $q['id']);
                    }
                    break;
                case 'interview':
                case 'ask':
                case 'hold':
                case 'resume':
                case 'decline':
                case 'select':
                    if (!in_array($st, SL_LIVE, true)) {
                        fail(409, 'conflict', 'This candidate is ' . strtolower(SL_ST[$st] ?? $st) . '.');
                    }
                    if ($act === 'resume' && $st !== 'hold') {
                        fail(409, 'conflict', 'Only a candidate on hold can be resumed.');
                    }
                    if (in_array($act, ['ask', 'hold'], true) && $msg === '') {
                        fail(400, 'invalid_argument', $act === 'ask' ? 'Write the question.' : 'Say why it is on hold.');
                    }
                    $why = (string) ($b['why'] ?? '');
                    if ($act === 'decline' && !isset(SL_WHY[$why])) {
                        fail(400, 'invalid_argument', 'Pick the reason.');
                    }
                    if ($act === 'decline' && $why === 'other' && $msg === '') {
                        fail(400, 'invalid_argument', 'Say what the reason is.');
                    }
                    $to = ['interview' => 'interview', 'ask' => 'question', 'hold' => 'hold', 'resume' => 'shared', 'decline' => 'declined', 'select' => 'selected'][$act];
                    $line = [
                        'interview' => $u['name'] . ' asked for an interview with ' . $who,
                        'ask' => $u['name'] . ' asked about ' . $who,
                        'hold' => $u['name'] . ' put ' . $who . ' on hold',
                        'resume' => $u['name'] . ' took ' . $who . ' off hold',
                        'decline' => $u['name'] . ' declined ' . $who . ' (' . SL_WHY[$why] . ')',
                        'select' => $u['name'] . ' selected ' . $who,
                    ][$act] . ($msg !== '' ? ': ' . $msg : '');
                    $f = ['st' => $to];
                    if (in_array($act, ['interview', 'decline', 'select'], true)) {
                        $f['dec'] = ['d' => $act, 'why' => $act === 'decline' ? $why : '', 'note' => $msg, 'n' => (string) $u['name'], 'by' => $u['id'], 'at' => now(), 'ver' => (int) $sl['ver']];
                    }
                    if ((int) $sl['dec_at'] === 0 && $act !== 'resume') {
                        $f['dec_at'] = now();
                    }
                    slSet($id, $f);
                    if ($act === 'interview') {
                        $ivAdd('requested', '', $msg);
                    }
                    crEv('req', (string) $q['id'], $u, 'client', $act === 'ask' ? 'questions' : 'shortlist', $line . '.');
                    slMirror($sl, $u, $act, $line);
                    // the account manager and the recruiter who owns the submission
                    $subDoc = (string) $sl['sub'] !== '' ? bdSub((string) $sl['sub']) : null;
                    $tell = array_values(array_unique(array_filter([(string) $q['owner'], $subDoc ? (string) (($subDoc->own ?? '') ?: ($subDoc->by ?? '')) : ''])));
                    crMail($tell ?: crStaffToTell($q), ['interview' => 'Interview requested: ', 'ask' => 'Question about a candidate: ', 'hold' => 'Candidate on hold: ', 'resume' => 'Candidate back on: ', 'decline' => 'Candidate declined: ', 'select' => 'Candidate selected: '][$act] . $sl['alias'] . ' for ' . $q['ti'], [$co . ': ' . $line . '.'], 'sl', (string) $q['id']);
                    break;
                default:
                    fail(400, 'invalid_argument', 'Unknown action.');
            }
            ok(['item' => slView(slRow($id), $staff)]);
    }
    fail(404, 'not_found', 'Unknown request.');
}
