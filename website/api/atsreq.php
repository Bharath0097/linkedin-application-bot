<?php
declare(strict_types=1);
require_once __DIR__ . '/ats.php';
require_once __DIR__ . '/sources.php';

/*
 * v37.2 the Jobs module: one page per requisition and a desk for the job boards.
 *   - Job codes (J-1001, J-1002 …): a counter in meta (atsreq_code), the code on the public posting
 *     (org/site/jobs/{id}.code: shown on the careers page, searchable, in short links job.php?j=J-1001&s=qr) and an
 *     index ats/x/codes/{CODE} -> {id}. Older postings get theirs when the requisitions list loads.
 *   - A requisition is saved on the server (ats_req_save): only the fields the form edits are taken from the browser,
 *     cleaned; everything other parts of the portal keep on the posting (the Dice record, share counts, the picture,
 *     where a shared requirement came from) stays as it is. A new requisition that looks like one already open (same
 *     title, and the same client or place) is held back with the matches unless it is saved anyway.
 *   - The requisition's own history (ats/x/jobs/{id}.log): created, what changed, assignments, notes, postings.
 *   - Templates (ats/x/tpl/{id}), copies (clone), recruiter assignments with a submission target and a due date, with
 *     reminders (by hand, and from the scheduled task when someone is behind close to the date).
 *   - The job page (ats_req_view): funnel, to-do, activity, assignments with their progress, insights (similar jobs,
 *     pay and rate guidance, time to fill, which sources work), and what Boolean searches are built from.
 *   - Matching people from the talent index (ats_req_match), added to the job with Talent search's ts_tojob.
 *   - The job boards desk (ats_postings, ats_posting_act): which boards' feeds carry each job, per-board switches,
 *     refresh, the Dice record, applicants and link clicks per channel. Link clicks are counted by job.php (people
 *     only, once per address and hour, no address kept).
 */

const ATSREQ_PUB_TEXT = ['ti' => 160, 'loc' => 120, 'ty' => 40, 'md' => 20, 'sk' => 600, 'd' => 20000, 'visa' => 160, 'rate' => 80, 'dur' => 80, 'exp' => 80];
const ATSREQ_PUB_BOOL = ['open', 'internal', 'eeo', 'offBoards'];
const ATSREQ_STATUS = ['draft' => 'Draft', 'open' => 'Open', 'hold' => 'On hold', 'filled' => 'Filled', 'closed' => 'Closed'];
const ATSREQ_PRIORITY = ['urgent', 'high', 'normal', 'low'];
const ATSREQ_Q_TYPES = ['text', 'yesno', 'select', 'number'];
const ATSREQ_REFRESH_GAP = 72 * 3600000;
const ATSREQ_TPL_MAX = 100;
// what a share link can say it came through (job.php?src=…): letters only, so the careers page passes them on
const ATSREQ_CHANNELS = ['careers' => 'Careers page', 'linkedin' => 'LinkedIn', 'facebook' => 'Facebook', 'xcom' => 'X', 'whatsapp' => 'WhatsApp', 'telegram' => 'Telegram', 'email' => 'Email', 'qr' => 'QR code', 'referral' => 'Referral', 'indeed' => 'Indeed', 'dice' => 'Dice', 'ziprecruiter' => 'ZipRecruiter', 'jooble' => 'Jooble', 'glassdoor' => 'Glassdoor', 'talent' => 'Talent.com', 'adzuna' => 'Adzuna', 'monster' => 'Monster', 'careerbuilder' => 'CareerBuilder', 'direct' => 'Direct link'];
// words that do not make two job titles different ("Sr. Java Developer (Remote)" = "Java Developer")
const ATSREQ_TITLE_NOISE = ['senior', 'sr', 'junior', 'jr', 'lead', 'principal', 'staff', 'mid', 'level', 'entry', 'i', 'ii', 'iii', 'iv', 'remote', 'onsite', 'hybrid', 'contract', 'c2c', 'w2', 'fulltime', 'full', 'time', 'ft', 'fte', 'position', 'role', 'opening', 'urgent', 'hot', 'immediate', 'needed', 'requirement', 'the', 'a', 'an', 'of', 'and', 'for', 'with', 'in', 'at', 'to'];

/* ---------------- job codes ---------------- */
function atsReqPrefix(): string
{
    $p = strtoupper((string) preg_replace('/[^A-Za-z0-9]/', '', (string) (atsSettings()['codePrefix'] ?? 'J')));
    return $p !== '' ? substr($p, 0, 6) : 'J';
}
/** The next job code: one counter for the installation (the first is J-1001). */
function atsReqCodeNext(): string
{
    $p = db();
    if (!$p->query("SELECT v FROM meta WHERE k = 'atsreq_code'")->fetch()) {
        try {
            $p->exec("INSERT INTO meta (k, v) VALUES ('atsreq_code', 1000)");
        } catch (Throwable $e) {
            // another request made it a moment ago
        }
    }
    $p->beginTransaction();
    try {
        $p->exec("UPDATE meta SET v = v + 1 WHERE k = 'atsreq_code'");
        $n = (int) $p->query("SELECT v FROM meta WHERE k = 'atsreq_code'")->fetchColumn();
        $p->commit();
    } catch (Throwable $e) {
        $p->rollBack();
        throw $e;
    }
    return atsReqPrefix() . '-' . $n;
}
function atsReqCodeOk(string $code): bool
{
    return (bool) preg_match('/^[A-Z0-9]{1,6}-\d{1,9}$/', $code);
}
/** Gives a posting its code when it has none (the caller saves the posting). */
function atsReqEnsureCode(string $jid, stdClass $pub): string
{
    $code = (string) ($pub->code ?? '');
    if (atsReqCodeOk($code)) {
        return $code;
    }
    $code = atsReqCodeNext();
    $pub->code = $code;
    docSet('ats/x/codes/' . $code, (object) ['id' => $jid, 'at' => now()]);
    return $code;
}
/** Postings made elsewhere (the website editor, shared requirements, older versions) get their codes, oldest first. */
function atsReqBackfill(int $max = 200): int
{
    $n = 0;
    foreach (colAll('org/site/jobs', 'at', 'asc') as [$jid, $p]) {
        if (atsReqCodeOk((string) ($p->code ?? ''))) {
            continue;
        }
        if ($n >= $max) {
            break;
        }
        // read again right before writing: only the code is added
        $cur = docGet('org/site/jobs/' . $jid);
        if (!$cur || atsReqCodeOk((string) ($cur->code ?? ''))) {
            continue;
        }
        atsReqEnsureCode((string) $jid, $cur);
        docSet('org/site/jobs/' . $jid, $cur);
        $n++;
    }
    return $n;
}
/** The posting id for a code (the index, else a look through the postings). */
function atsReqIdOfCode(string $code): string
{
    $code = strtoupper(trim($code));
    if (!atsReqCodeOk($code)) {
        return '';
    }
    $ix = docGet('ats/x/codes/' . $code);
    if ($ix && ($id = (string) ($ix->id ?? '')) !== '' && docGet('org/site/jobs/' . $id)) {
        return $id;
    }
    foreach (colAll('org/site/jobs') as [$jid, $p]) {
        if ((string) ($p->code ?? '') === $code) {
            return (string) $jid;
        }
    }
    return '';
}

/* ---------------- small helpers ---------------- */
function atsReqId($v): string
{
    return substr((string) preg_replace('/[^A-Za-z0-9_\-]/', '', (string) $v), 0, 48);
}
function atsReqUid($v): string
{
    $v = (string) $v;
    return preg_match('/^u_[a-f0-9]{4,40}$/', $v) ? $v : '';
}
function atsReqNorm(string $s): string
{
    return trim((string) preg_replace('/\s+/', ' ', (string) preg_replace('/[^\p{L}\p{N}]+/u', ' ', mb_strtolower($s))));
}
/** A title reduced to the words that matter, for duplicates and similar jobs. */
function atsReqTitleKey(string $ti): array
{
    $words = array_values(array_filter(explode(' ', atsReqNorm(str_ireplace(['.net', 'c#', 'c++'], [' dotnet ', ' csharp ', ' cplusplus '], $ti))), fn($w) => $w !== '' && !in_array($w, ATSREQ_TITLE_NOISE, true)));
    return array_values(array_unique($words));
}
function atsReqSim(array $a, array $b): float
{
    if (!$a || !$b) {
        return 0.0;
    }
    $i = count(array_intersect($a, $b));
    $u = count(array_unique(array_merge($a, $b)));
    return $u ? $i / $u : 0.0;
}
function atsReqName(string $uid): string
{
    if ($uid === '') {
        return '';
    }
    $r = userRow($uid);
    return $r ? (string) $r['name'] : 'Team member';
}
function atsReqClientName(string $cid): string
{
    if ($cid === '' || !preg_match('/^[A-Za-z0-9_\-]{1,40}$/', $cid)) {
        return '';
    }
    $c = docGet('org/admin/clients/' . $cid);
    return $c ? (string) ($c->n ?? '') : '';
}
/** An amount as an hourly figure (a yearly one divided by 2,080 hours); null when it is not a believable rate. */
function atsReqHourly($v, string $per = ''): ?float
{
    if (is_int($v) || is_float($v) || (is_string($v) && is_numeric(trim($v)))) {
        $n = (float) $v;
    } else {
        $s = mb_strtolower((string) $v);
        if (!preg_match('/(\d[\d,]*(?:\.\d+)?)\s*(k\b)?/', $s, $m)) {
            return null;
        }
        $n = (float) str_replace(',', '', $m[1]);
        if (!empty($m[2])) {
            $n *= 1000;
        }
        if ($per === '') {
            $per = preg_match('/yr|year|annum|annual|salary|\bpa\b|\dk\b|\bk\b/', $s) ? 'year' : (preg_match('/hr|hour|\/h\b|\bph\b/', $s) ? 'hour' : '');
        }
    }
    if ($n <= 0) {
        return null;
    }
    if ($per === '') {
        $per = $n >= 1000 ? 'year' : 'hour';
    }
    $h = $per === 'year' ? $n / 2080 : $n;
    return $h >= 5 && $h <= 500 ? round($h, 2) : null;
}
function atsReqStats(array $vals): ?array
{
    $vals = array_values(array_filter($vals, fn($x) => $x !== null));
    if (!$vals) {
        return null;
    }
    sort($vals);
    $n = count($vals);
    $med = $n % 2 ? $vals[intdiv($n, 2)] : ($vals[$n / 2 - 1] + $vals[$n / 2]) / 2;
    return ['n' => $n, 'min' => round($vals[0], 2), 'med' => round($med, 2), 'max' => round($vals[$n - 1], 2)];
}
/** The link that opens a requisition in the portal (HR and administrators); others land on their own portal. */
function atsReqPortalLink(string $uid, string $jid): string
{
    $r = $uid !== '' ? userRow($uid) : null;
    $staff = $r && (hasRole($r, 'admin') || hasRole($r, 'hr'));
    return siteUrl() . ($staff ? '#/portal/hr/ats?tab=jobs&req=' . rawurlencode($jid) : '#/portal');
}
function atsReqLabel(stdClass $pub): string
{
    $code = (string) ($pub->code ?? '');
    return ($code !== '' ? $code . ' ' : '') . (string) ($pub->ti ?? 'the job');
}
/** A job's internal record as a plain array for the browser (the history is sent only where it is shown). */
function atsReqJobOut(string $jid): array
{
    $j = atsJob($jid);
    unset($j['log']);
    return $j;
}

/* ---------------- which job boards carry a job ---------------- */
/** The boards whose feeds list a job: none for an internal-only job or one taken off every board; an empty choice
 *  means every board. (sources.php keeps jobBoardsOf for the feeds and the Dice automation.) */
function atsReqBoards(stdClass $j): array
{
    return jobBoardsOf($j);
}

/* ---------------- cleaning what the form sends ---------------- */
function atsReqQs($in): array
{
    $out = [];
    $seen = [];
    foreach (array_slice(is_array($in) ? $in : [], 0, 30) as $q) {
        if (!is_array($q)) {
            continue;
        }
        $text = mb_substr(trim((string) ($q['q'] ?? '')), 0, 300);
        if ($text === '') {
            continue;
        }
        $type = in_array((string) ($q['type'] ?? ''), ATSREQ_Q_TYPES, true) ? (string) $q['type'] : 'text';
        $id = substr((string) preg_replace('/[^a-z0-9]/', '', strtolower((string) ($q['id'] ?? ''))), 0, 12);
        while ($id === '' || isset($seen[$id])) {
            $id = substr(rid(4), 0, 8);
        }
        $seen[$id] = true;
        $opts = '';
        if ($type === 'select') {
            $opts = implode('|', array_slice(array_values(array_filter(array_map(fn($x) => mb_substr(trim($x), 0, 80), explode('|', (string) ($q['opts'] ?? ''))), fn($x) => $x !== '')), 0, 20));
        }
        $out[] = (object) ['id' => $id, 'q' => $text, 'type' => $type, 'opts' => $opts, 'req' => ($q['req'] ?? true) !== false];
    }
    return $out;
}
function atsReqStrList($in, int $max, int $len): array
{
    $out = [];
    foreach (array_slice(is_array($in) ? $in : [], 0, $max * 2) as $x) {
        $x = mb_substr(trim(is_scalar($x) ? (string) $x : ''), 0, $len);
        if ($x !== '' && !in_array($x, $out, true)) {
            $out[] = $x;
        }
    }
    return array_slice($out, 0, $max);
}
function atsReqNum($v, float $max = 10000000): string
{
    if ($v === null || $v === '' || !is_numeric($v)) {
        return '';
    }
    $n = (float) $v;
    return $n < 0 || $n > $max ? '' : (string) (floor($n) == $n ? (int) $n : round($n, 2));
}
/** The posting fields the form edits, cleaned. Only keys that were sent are returned. */
function atsReqCleanPub(array $in): array
{
    $out = [];
    foreach (ATSREQ_PUB_TEXT as $k => $max) {
        if (array_key_exists($k, $in)) {
            $out[$k] = str($in, $k, $max);
        }
    }
    foreach (ATSREQ_PUB_BOOL as $k) {
        if (array_key_exists($k, $in)) {
            $out[$k] = !empty($in[$k]) && $in[$k] !== 'false';
        }
    }
    if (array_key_exists('md', $out) && !in_array($out['md'], ['Onsite', 'Hybrid', 'Remote'], true)) {
        $out['md'] = 'Onsite';
    }
    if (array_key_exists('qs', $in)) {
        $out['qs'] = atsReqQs($in['qs']);
    }
    if (array_key_exists('boards', $in)) {
        $b = array_values(array_unique(array_intersect(array_map('strval', is_array($in['boards']) ? $in['boards'] : []), array_keys(SRC_BOARDS))));
        // every board ticked is the same as none ticked: every board
        $out['boards'] = count($b) === count(SRC_BOARDS) ? [] : $b;
    }
    return $out;
}
/** The internal fields the form edits, cleaned (approvals are checked against who may change them). */
function atsReqCleanJob(array $in, array $cur, array $me): array
{
    $out = [];
    $uid = fn($v) => atsReqUid($v);
    if (array_key_exists('dept', $in)) {
        $out['dept'] = str($in, 'dept', 80);
    }
    if (array_key_exists('openings', $in)) {
        $out['openings'] = max(1, min(999, (int) $in['openings']));
    }
    if (array_key_exists('status', $in)) {
        $out['status'] = isset(ATSREQ_STATUS[(string) $in['status']]) ? (string) $in['status'] : 'open';
    }
    if (array_key_exists('priority', $in)) {
        $out['priority'] = in_array((string) $in['priority'], ATSREQ_PRIORITY, true) ? (string) $in['priority'] : 'normal';
    }
    if (array_key_exists('client', $in)) {
        $out['client'] = preg_match('/^[A-Za-z0-9_\-]{1,40}$/', (string) $in['client']) ? (string) $in['client'] : '';
    }
    foreach (['notes' => 4000, 'reqBy' => 40, 'ec' => 120, 'vendor' => 120] as $k => $max) {
        if (array_key_exists($k, $in)) {
            $out[$k] = str($in, $k, $max);
        }
    }
    if (array_key_exists('internal', $in)) {
        $out['internal'] = !empty($in['internal']);
    }
    if (array_key_exists('team', $in)) {
        $t = is_array($in['team']) ? $in['team'] : [];
        $out['team'] = (object) [
            'rec' => $uid($t['rec'] ?? ''), 'coord' => $uid($t['coord'] ?? ''), 'hm' => $uid($t['hm'] ?? ''), 'sales' => $uid($t['sales'] ?? ''),
            'intv' => array_slice(array_values(array_unique(array_filter(array_map($uid, is_array($t['intv'] ?? null) ? $t['intv'] : [])))), 0, 20),
        ];
    }
    if (array_key_exists('stages', $in)) {
        $st = [];
        $keys = [];
        foreach (array_slice(is_array($in['stages']) ? $in['stages'] : [], 0, 20) as $s) {
            if (!is_array($s)) {
                continue;
            }
            $n = mb_substr(trim((string) ($s['n'] ?? '')), 0, 60);
            $k = substr((string) preg_replace('/[^a-z0-9_\-]/', '', strtolower((string) ($s['k'] ?? ''))), 0, 40);
            if ($k === '') {
                $k = substr((string) preg_replace('/[^a-z0-9]+/', '-', strtolower($n)), 0, 40);
                $k = trim($k, '-');
            }
            if ($n === '' || $k === '' || isset($keys[$k])) {
                continue;
            }
            $keys[$k] = true;
            $st[] = (object) ['k' => $k, 'n' => $n, 'kind' => in_array((string) ($s['kind'] ?? ''), ATS_KINDS, true) ? (string) $s['kind'] : 'interview'];
        }
        if ($st) {
            $out['stages'] = $st;
        }
    }
    if (array_key_exists('attrs', $in)) {
        $out['attrs'] = atsReqStrList($in['attrs'], 20, 80);
    }
    if (array_key_exists('kit', $in)) {
        $kit = new stdClass();
        foreach ((is_array($in['kit']) ? array_slice($in['kit'], 0, 20, true) : []) as $k => $qs) {
            $k = substr((string) preg_replace('/[^a-z0-9_\-]/', '', strtolower((string) $k)), 0, 40);
            if ($k !== '') {
                $kit->$k = atsReqStrList($qs, 20, 300);
            }
        }
        $out['kit'] = $kit;
    }
    if (array_key_exists('ko', $in)) {
        $ko = new stdClass();
        foreach ((is_array($in['ko']) ? array_slice($in['ko'], 0, 30, true) : []) as $k => $v) {
            $k = substr((string) preg_replace('/[^a-z0-9]/', '', strtolower((string) $k)), 0, 12);
            $v = mb_substr(trim(is_scalar($v) ? (string) $v : ''), 0, 120);
            if ($k !== '' && $v !== '') {
                $ko->$k = $v;
            }
        }
        $out['ko'] = $ko;
    }
    if (array_key_exists('pay', $in)) {
        $p = is_array($in['pay']) ? $in['pay'] : [];
        $cur0 = strtoupper(substr((string) preg_replace('/[^A-Za-z]/', '', (string) ($p['cur'] ?? 'USD')), 0, 3));
        $out['pay'] = (object) ['min' => atsReqNum($p['min'] ?? ''), 'max' => atsReqNum($p['max'] ?? ''), 'cur' => strlen($cur0) === 3 ? $cur0 : 'USD', 'per' => ($p['per'] ?? '') === 'year' ? 'year' : 'hour'];
    }
    if (array_key_exists('bill', $in)) {
        $p = is_array($in['bill']) ? $in['bill'] : [];
        $out['bill'] = (object) ['rate' => atsReqNum($p['rate'] ?? ''), 'per' => ($p['per'] ?? '') === 'year' ? 'year' : 'hour'];
    }
    if (array_key_exists('sla', $in)) {
        $sla = new stdClass();
        foreach ((is_array($in['sla']) ? $in['sla'] : []) as $k => $v) {
            if (in_array((string) $k, ['new', 'screen', 'interview', 'offer'], true) && is_numeric($v) && (int) $v > 0) {
                $sla->$k = min(365, (int) $v);
            }
        }
        $out['sla'] = $sla;
    }
    if (array_key_exists('tags', $in)) {
        $tags = is_array($in['tags']) ? $in['tags'] : preg_split('/\s*,\s*/', (string) $in['tags']);
        $out['tags'] = atsReqStrList($tags ?: [], 12, 40);
    }
    if (array_key_exists('approvals', $in)) {
        // an approval is given or declined only by the person asked (an administrator may record one for them)
        $old = [];
        foreach ((array) ($cur['approvals'] ?? []) as $a) {
            $a = (array) $a;
            if (($u = atsReqUid($a['uid'] ?? '')) !== '') {
                $old[$u] = $a;
            }
        }
        $list = [];
        $seen = [];
        foreach (array_slice(is_array($in['approvals']) ? $in['approvals'] : [], 0, 10) as $a) {
            $a = is_array($a) ? $a : [];
            $u = atsReqUid($a['uid'] ?? '');
            if ($u === '' || isset($seen[$u])) {
                continue;
            }
            $seen[$u] = true;
            $want = in_array((string) ($a['st'] ?? ''), ['pending', 'approved', 'declined'], true) ? (string) $a['st'] : 'pending';
            $was = (string) ($old[$u]['st'] ?? 'pending');
            $mayDecide = $u === (string) $me['id'] || hasRole($me, 'admin');
            $st = $mayDecide ? $want : $was;
            $row = ['uid' => $u, 'st' => $st];
            if ($st !== $was) {
                $row['at'] = now();
                $row['by'] = (string) $me['id'];
            } elseif (isset($old[$u]['at'])) {
                $row['at'] = (int) $old[$u]['at'];
                if (isset($old[$u]['by'])) {
                    $row['by'] = (string) $old[$u]['by'];
                }
            }
            $list[] = (object) $row;
        }
        $out['approvals'] = $list;
    }
    return $out;
}

/* ---------------- what changed (the requisition's history) ---------------- */
function atsReqChanges(array $p0, array $p1, array $j0, array $j1): array
{
    $c = [];
    $s = fn($v) => is_scalar($v) ? (string) $v : json_encode($v);
    $was = fn(string $k) => $s($p0[$k] ?? '');
    $now = fn(string $k) => $s($p1[$k] ?? '');
    foreach (['ti' => 'Title', 'loc' => 'Location', 'ty' => 'Type', 'md' => 'Work mode', 'visa' => 'Work authorization', 'rate' => 'Rate shown', 'dur' => 'Duration'] as $k => $n) {
        if (array_key_exists($k, $p1) && $was($k) !== $now($k)) {
            $c[] = $n . ': ' . ($was($k) !== '' ? $was($k) : '—') . ' → ' . ($now($k) !== '' ? $now($k) : '—');
        }
    }
    if (array_key_exists('sk', $p1) && $was('sk') !== $now('sk')) {
        $c[] = 'Skills changed';
    }
    if (array_key_exists('d', $p1) && $was('d') !== $now('d')) {
        $c[] = 'Description edited';
    }
    if (array_key_exists('qs', $p1) && json_encode($p0['qs'] ?? []) !== json_encode($p1['qs'])) {
        $c[] = 'Screening questions changed';
    }
    if (array_key_exists('open', $p1) && (($p0['open'] ?? true) !== false) !== ($p1['open'] !== false)) {
        $c[] = $p1['open'] !== false ? 'Listed on the careers page (taking applications)' : 'Taken off the careers page (no new applications)';
    }
    if (array_key_exists('internal', $p1) && !empty($p0['internal']) !== !empty($p1['internal'])) {
        $c[] = !empty($p1['internal']) ? 'Internal only (direct link, no job boards)' : 'No longer internal only';
    }
    if (array_key_exists('boards', $p1) && json_encode(array_values((array) ($p0['boards'] ?? []))) !== json_encode($p1['boards'])) {
        $c[] = 'Job boards: ' . ($p1['boards'] ? implode(', ', array_map(fn($k) => SRC_BOARDS[$k] ?? $k, $p1['boards'])) : 'every board');
    }
    if (array_key_exists('offBoards', $p1) && !empty($p0['offBoards']) !== !empty($p1['offBoards'])) {
        $c[] = !empty($p1['offBoards']) ? 'Taken off every job board (careers page only)' : 'Back on the job boards';
    }
    $ws = fn(string $k) => $s($j0[$k] ?? '');
    $ns = fn(string $k) => $s($j1[$k] ?? '');
    if (array_key_exists('status', $j1) && $ws('status') !== $ns('status')) {
        $c[] = 'Status: ' . (ATSREQ_STATUS[$ws('status')] ?? ($ws('status') ?: 'Open')) . ' → ' . (ATSREQ_STATUS[$ns('status')] ?? $ns('status'));
    }
    if (array_key_exists('openings', $j1) && (int) ($j0['openings'] ?? 1) !== (int) $j1['openings']) {
        $c[] = 'Openings: ' . (int) ($j0['openings'] ?? 1) . ' → ' . (int) $j1['openings'];
    }
    if (array_key_exists('priority', $j1) && ($ws('priority') ?: 'normal') !== $ns('priority')) {
        $c[] = 'Priority: ' . ($ws('priority') ?: 'normal') . ' → ' . $ns('priority');
    }
    if (array_key_exists('client', $j1) && $ws('client') !== $ns('client')) {
        $c[] = 'Client: ' . (atsReqClientName($ws('client')) ?: '—') . ' → ' . (atsReqClientName($ns('client')) ?: '—');
    }
    if (array_key_exists('dept', $j1) && $ws('dept') !== $ns('dept')) {
        $c[] = 'Department: ' . ($ws('dept') ?: '—') . ' → ' . ($ns('dept') ?: '—');
    }
    if (array_key_exists('team', $j1)) {
        $t0 = (array) ($j0['team'] ?? []);
        $t1 = (array) $j1['team'];
        foreach (['rec' => 'Recruiter', 'hm' => 'Hiring manager', 'coord' => 'Coordinator', 'sales' => 'Sales credit'] as $k => $n) {
            if ((string) ($t0[$k] ?? '') !== (string) ($t1[$k] ?? '')) {
                $c[] = $n . ': ' . (atsReqName((string) ($t0[$k] ?? '')) ?: '—') . ' → ' . (atsReqName((string) ($t1[$k] ?? '')) ?: '—');
            }
        }
        if (json_encode(array_values((array) ($t0['intv'] ?? []))) !== json_encode(array_values((array) ($t1['intv'] ?? [])))) {
            $c[] = 'Interview panel changed';
        }
    }
    foreach (['pay' => 'Pay range', 'bill' => 'Bill rate'] as $k => $n) {
        if (array_key_exists($k, $j1) && json_encode((array) ($j0[$k] ?? [])) !== json_encode((array) $j1[$k])) {
            $v = (array) $j1[$k];
            $c[] = $n . ': ' . ($k === 'pay' ? (($v['min'] !== '' || $v['max'] !== '') ? trim($v['min'] . '–' . $v['max'], '–') . ' ' . $v['cur'] . '/' . ($v['per'] === 'year' ? 'yr' : 'hr') : 'none') : ($v['rate'] !== '' ? $v['rate'] . '/' . ($v['per'] === 'year' ? 'yr' : 'hr') : 'none'));
        }
    }
    if (array_key_exists('stages', $j1) && json_encode(array_map(fn($x) => [(string) ((array) $x)['k'], (string) ((array) $x)['n'], (string) ((array) $x)['kind']], (array) ($j0['stages'] ?? []))) !== json_encode(array_map(fn($x) => [(string) ((array) $x)['k'], (string) ((array) $x)['n'], (string) ((array) $x)['kind']], (array) $j1['stages']))) {
        $c[] = 'Pipeline stages changed';
    }
    if (array_key_exists('approvals', $j1)) {
        $old = [];
        foreach ((array) ($j0['approvals'] ?? []) as $a) {
            $a = (array) $a;
            $old[(string) ($a['uid'] ?? '')] = (string) ($a['st'] ?? 'pending');
        }
        foreach ((array) $j1['approvals'] as $a) {
            $a = (array) $a;
            $u = (string) $a['uid'];
            if (!isset($old[$u])) {
                $c[] = 'Approval asked of ' . atsReqName($u);
            } elseif ($old[$u] !== (string) $a['st']) {
                $c[] = atsReqName($u) . ' ' . ((string) $a['st'] === 'approved' ? 'approved' : ((string) $a['st'] === 'declined' ? 'declined' : 'reset the approval'));
            }
        }
    }
    if (array_key_exists('tags', $j1) && json_encode(array_values((array) ($j0['tags'] ?? []))) !== json_encode($j1['tags'])) {
        $c[] = 'Tags: ' . ($j1['tags'] ? implode(', ', $j1['tags']) : 'none');
    }
    if (array_key_exists('notes', $j1) && $ws('notes') !== $ns('notes')) {
        $c[] = 'Internal notes edited';
    }
    return $c;
}

/* ---------------- duplicates ---------------- */
/** Open (or recent) requisitions that look like this one: the same title words, and the same client or place. */
function atsReqDupes(string $skipId, string $ti, string $loc, string $client): array
{
    $key = atsReqTitleKey($ti);
    if (!$key) {
        return [];
    }
    $locN = atsReqNorm($loc);
    $out = [];
    foreach (colAll('org/site/jobs') as [$jid, $p]) {
        $jid = (string) $jid;
        if ($jid === $skipId) {
            continue;
        }
        $recent = ($p->open ?? true) !== false || (int) ($p->at ?? 0) > now() - 90 * 86400000;
        if (!$recent) {
            continue;
        }
        $k2 = atsReqTitleKey((string) ($p->ti ?? ''));
        if (!$k2 || ($k2 !== $key && atsReqSim($key, $k2) < 0.99)) {
            continue;
        }
        $ij = atsJob($jid);
        $cl2 = (string) ($ij['client'] ?? '');
        $loc2 = atsReqNorm((string) ($p->loc ?? ''));
        $sameClient = $client !== '' && $cl2 === $client;
        $samePlace = $locN !== '' && $loc2 !== '' && ($locN === $loc2 || str_contains($loc2, $locN) || str_contains($locN, $loc2));
        $neither = $client === '' && $cl2 === '' && ($locN === '' || $loc2 === '');
        if (!$sameClient && !$samePlace && !$neither) {
            continue;
        }
        $st = (string) ($ij['status'] ?? 'open');
        if (in_array($st, ['closed', 'filled'], true) && ($p->open ?? true) === false && (int) ($p->at ?? 0) < now() - 30 * 86400000) {
            continue;
        }
        $out[] = ['id' => $jid, 'code' => (string) ($p->code ?? ''), 'ti' => (string) ($p->ti ?? ''), 'loc' => (string) ($p->loc ?? ''), 'client' => atsReqClientName($cl2), 'open' => ($p->open ?? true) !== false, 'st' => $st, 'at' => (int) ($p->at ?? 0), 'why' => $sameClient ? 'same client' : ($samePlace ? 'same place' : 'same title')];
    }
    usort($out, fn($a, $b) => $b['at'] <=> $a['at']);
    return array_slice($out, 0, 8);
}

/* ---------------- saving ---------------- */
/**
 * Creates or updates a requisition: the public posting and the internal record together.
 * $pubIn / $jobIn are what the form sent; returns [id, code, changes, created].
 */
function atsReqSave(array $me, string $id, array $pubIn, array $jobIn, array $opt = []): array
{
    $create = $id === '';
    $pub = $create ? new stdClass() : docGet('org/site/jobs/' . $id);
    if (!$pub) {
        fail(404, 'not_found', 'That requisition is no longer there.');
    }
    $ijDoc = $create ? new stdClass() : (docGet('ats/x/jobs/' . $id) ?? new stdClass());
    $p0 = json_decode(json_encode($pub), true) ?: [];
    $j0 = json_decode(json_encode($ijDoc), true) ?: [];
    $p1 = atsReqCleanPub($pubIn);
    $j1 = atsReqCleanJob($jobIn, $j0, $me);
    $title = array_key_exists('ti', $p1) ? $p1['ti'] : (string) ($p0['ti'] ?? '');
    if (mb_strlen(trim($title)) < 2) {
        fail(400, 'invalid_argument', 'Add a job title.');
    }
    // a draft, closed or filled requisition is not on the careers page
    $status = (string) ($j1['status'] ?? ($j0['status'] ?? 'open'));
    $statusChanged = array_key_exists('status', $j1) && $j1['status'] !== (string) ($j0['status'] ?? 'open');
    if (in_array($status, ['draft', 'closed', 'filled'], true) && ($create || $statusChanged || ($p1['open'] ?? false))) {
        $p1['open'] = false;
    }
    if ($create && empty($opt['force'])) {
        $d = atsReqDupes('', $title, (string) ($p1['loc'] ?? ''), (string) ($j1['client'] ?? ''));
        if ($d) {
            fail(409, 'duplicate', count($d) === 1 ? 'A requisition like this one is already open: ' . ($d[0]['code'] !== '' ? $d[0]['code'] . ' ' : '') . $d[0]['ti'] . '.' : count($d) . ' requisitions like this one are already open.', ['dupes' => $d]);
        }
    }
    $changes = $create ? [] : atsReqChanges($p0, $p1, $j0, $j1);
    if ($create) {
        $id = rid(6);
        $pub->at = now();
        $pub->by = (string) $me['id'];
        $pub->u = now();
    } elseif (($p0['open'] ?? true) === false && ($p1['open'] ?? false) === true) {
        // opened again: a fresh date for the job boards
        $pub->u = now();
    }
    foreach ($p1 as $k => $v) {
        $pub->$k = $v;
    }
    foreach (['open', 'internal', 'eeo'] as $k) {
        if (!isset($pub->$k)) {
            $pub->$k = $k === 'open';
        }
    }
    if (empty($pub->offBoards)) {
        unset($pub->offBoards);
    }
    $code = atsReqEnsureCode($id, $pub);
    foreach ($j1 as $k => $v) {
        $ijDoc->$k = $v;
    }
    if ($create) {
        $ijDoc->status = $ijDoc->status ?? 'open';
        $ijDoc->openings = $ijDoc->openings ?? 1;
        $ijDoc->at = now();
        $ijDoc->by = (string) $me['id'];
        $tplN = '';
        if (!empty($opt['tpl']) && ($t = docGet('ats/x/tpl/' . atsReqId($opt['tpl'])))) {
            $tplN = (string) ($t->n ?? '');
            $t->uses = (int) ($t->uses ?? 0) + 1;
            $t->last = now();
            docSet('ats/x/tpl/' . atsReqId($opt['tpl']), $t);
        }
        atsJobLog($ijDoc, (string) $me['name'], 'Requisition ' . $code . ' created' . ($tplN !== '' ? ' from the template "' . $tplN . '"' : '') . (!empty($opt['force']) ? ' (saved although a similar one is open)' : '') . (($pub->open ?? true) !== false ? ', listed on the careers page' : ''));
    } elseif ($changes) {
        atsJobLog($ijDoc, (string) $me['name'], implode(' · ', array_slice($changes, 0, 12)));
    }
    $ijDoc->u = now();
    docSet('org/site/jobs/' . $id, $pub);
    docSet('ats/x/jobs/' . $id, $ijDoc);
    if ($create) {
        audit('data', 'Requisition created', 'ats/x/jobs/' . $id, ['code' => $code, 'ti' => mb_substr($title, 0, 120)], $me);
    } elseif ($changes) {
        audit('data', 'Requisition changed', 'ats/x/jobs/' . $id, ['code' => $code, 'changes' => array_slice($changes, 0, 12)], $me);
    }
    return [$id, $code, $changes, $create];
}

/* ---------------- one pass over the candidates ---------------- */
/**
 * Every candidate on a job, with what the job page and the insights need: per job, the candidates, how far each got,
 * sources, link channels, hires and the pay offered or asked.
 */
function atsReqScan(): array
{
    $per = [];
    $jobs = [];
    $order = ['new' => 0, 'screen' => 1, 'interview' => 2, 'offer' => 3, 'hired' => 4];
    foreach (colAll('ats') as [$cid, $c]) {
        $cid = (string) $cid;
        if ($cid === 'x' || !isset($c->n) || !empty($c->lite)) {
            continue;
        }
        $jk = (string) ($c->job ?? '');
        if ($jk === '') {
            continue;
        }
        $ij = $jobs[$jk] ??= atsJob($jk);
        $kind = atsStageKind($ij, (string) ($c->st ?? 'new'));
        $best = $kind === 'rejected' ? 0 : ($order[$kind] ?? 0);
        $hiredAt = $kind === 'hired' ? (int) ($c->stAt ?? 0) : 0;
        $subBy = [];
        foreach ((array) ($c->hist ?? []) as $h) {
            $hk = atsStageKind($ij, (string) ($h->to ?? ''));
            if (isset($order[$hk])) {
                $best = max($best, $order[$hk]);
            }
            if ($hk === 'hired' && $hiredAt === 0) {
                $hiredAt = (int) ($h->at ?? 0);
            } elseif ($hk === 'hired') {
                $hiredAt = min($hiredAt, (int) ($h->at ?? $hiredAt));
            }
            if (in_array($hk, ['interview', 'offer', 'hired'], true) && ($b = (string) ($h->by ?? '')) !== '') {
                $subBy[$b] = true;
            }
        }
        $a = &$per[$jk];
        $a = $a ?? ['n' => 0, 'hired' => 0, 'src' => [], 'ch' => [], 'first' => 0, 'hires' => [], 'pays' => [], 'asks' => [], 'cands' => []];
        $a['n']++;
        $src = (string) ($c->src ?? '') ?: 'Other';
        $a['src'][$src] = $a['src'][$src] ?? [0, 0];
        $a['src'][$src][0]++;
        if ($kind === 'hired') {
            $a['hired']++;
            $a['src'][$src][1]++;
            if ($hiredAt) {
                $a['hires'][] = $hiredAt;
            }
        }
        $ch = (string) ($c->ch ?? '');
        if ($ch !== '') {
            $a['ch'][$ch] = ($a['ch'][$ch] ?? 0) + 1;
        }
        $at = (int) ($c->at ?? 0);
        if ($at && (!$a['first'] || $at < $a['first'])) {
            $a['first'] = $at;
        }
        if (isset($c->offer) && $c->offer instanceof stdClass && ($c->offer->pay ?? '') !== '' && in_array((string) ($c->offer->st ?? ''), ['sent', 'approved', 'accepted', 'signed'], true)) {
            $h = atsReqHourly($c->offer->pay, (string) ($c->offer->per ?? ''));
            if ($h !== null) {
                $a['pays'][] = $h;
            }
        }
        if (trim((string) ($c->rate ?? '')) !== '') {
            $h = atsReqHourly((string) $c->rate);
            if ($h !== null) {
                $a['asks'][] = $h;
            }
        }
        $a['cands'][$cid] = ['c' => $c, 'kind' => $kind, 'best' => $best, 'sub' => array_keys($subBy), 'hiredAt' => $hiredAt];
        unset($a);
    }
    return $per;
}
/** How each assigned recruiter is doing on one job: added (candidates they put on it), submitted (moved by them to an
 *  interview-kind stage or beyond), hired. */
function atsReqProgress(array $assign, array $cands): array
{
    $out = [];
    foreach ($assign as $row) {
        $row = (array) $row;
        $uid = (string) ($row['uid'] ?? '');
        if ($uid === '') {
            continue;
        }
        $src = 0;
        $sub = 0;
        $hired = 0;
        foreach ($cands as $x) {
            $mine = (string) ($x['c']->by ?? '') === $uid;
            $src += $mine ? 1 : 0;
            $subbed = in_array($uid, $x['sub'], true) || ($mine && $x['best'] >= 2);
            $sub += $subbed ? 1 : 0;
            $hired += $x['kind'] === 'hired' && ($mine || $subbed) ? 1 : 0;
        }
        $due = (string) ($row['due'] ?? '');
        $daysLeft = $due !== '' && ($t = strtotime($due . ' 23:59:59')) ? (int) floor(($t - time()) / 86400) : null;
        $out[] = ['uid' => $uid, 'n' => atsReqName($uid), 'target' => (int) ($row['target'] ?? 0), 'due' => $due, 'note' => (string) ($row['note'] ?? ''), 'at' => (int) ($row['at'] ?? 0), 'by' => (string) ($row['by'] ?? ''), 'rem' => (int) ($row['rem'] ?? 0), 'src' => $src, 'sub' => $sub, 'hired' => $hired, 'left' => $daysLeft, 'behind' => (int) ($row['target'] ?? 0) > 0 && $sub < (int) ($row['target'] ?? 0) && $daysLeft !== null && $daysLeft <= 1];
    }
    return $out;
}

/* ---------------- what Boolean searches and matching are built from ---------------- */
function atsReqTitles(string $ti): array
{
    $ti = trim((string) preg_replace('/\s+/', ' ', (string) preg_replace('/\([^)]*\)|\[[^\]]*\]/', ' ', $ti)));
    $ti = trim((string) (preg_split('/\s+[-–|]\s+/u', $ti)[0] ?? $ti));
    if ($ti === '') {
        return [];
    }
    $out = [$ti];
    $base = trim((string) preg_replace('/\s+/', ' ', (string) preg_replace('/\b(senior|sr\.?|junior|jr\.?|lead|principal|staff|mid[- ]level|entry[- ]level|iii|ii|iv)(?=\s|$)/i', ' ', $ti)));
    if ($base !== '' && mb_strlen($base) >= 3 && mb_strtolower($base) !== mb_strtolower($ti)) {
        $out[] = $base;
    }
    $b = $base !== '' ? $base : $ti;
    if (preg_match('/\bdeveloper\b/i', $b)) {
        $out[] = (string) preg_replace('/\bdeveloper\b/i', 'Engineer', $b);
    } elseif (preg_match('/\b(software|java|python|\.net|dotnet|full[ -]?stack|front[ -]?end|back[ -]?end|web|mobile|ios|android|react|node|php|ruby|golang|salesforce)\b.*\bengineer\b/i', $b)) {
        $out[] = (string) preg_replace('/\bengineer\b/i', 'Developer', $b);
    }
    $uniq = [];
    foreach ($out as $t) {
        $uniq[mb_strtolower($t)] = $t;
    }
    return array_slice(array_values($uniq), 0, 4);
}
/** The skills a job asks for: the typed must-haves (else the first ones its description names), then the rest. */
function atsReqNeed(stdClass $pub): array
{
    $typed = array_values(array_filter(array_map('trim', preg_split('/[,;|\n]+/', (string) ($pub->sk ?? '')) ?: [])));
    // matching uses the index's names for skills ("Apache Spark"); Boolean searches use the words as typed ("Spark"),
    // which job boards and Google match more widely
    $must = [];
    $words = [];
    foreach ($typed as $t) {
        $c = skillsCanon([$t])[0] ?? '';
        if ($c !== '' && !in_array($c, $must, true)) {
            $must[] = $c;
            $words[] = mb_substr($t, 0, 40);
        }
    }
    $fromD = skillsIn((string) ($pub->ti ?? '') . "\n" . (string) ($pub->d ?? ''), 20);
    if (!$must) {
        $must = array_slice($fromD, 0, 5);
        $words = $must;
    }
    $lm = array_map('mb_strtolower', $must);
    $nice = array_values(array_filter($fromD, fn($s) => !in_array(mb_strtolower($s), $lm, true)));
    $years = null;
    if (preg_match('/(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?(?:years|yrs)/i', (string) ($pub->d ?? '') . ' ' . (string) ($pub->sk ?? '') . ' ' . (string) ($pub->exp ?? ''), $m)) {
        $years = (int) $m[1];
    }
    return ['must' => array_slice($must, 0, 8), 'words' => array_slice($words, 0, 8), 'nice' => array_slice($nice, 0, 8), 'titles' => atsReqTitles((string) ($pub->ti ?? '')), 'years' => $years, 'loc' => (string) ($pub->loc ?? ''), 'remote' => (string) ($pub->md ?? '') === 'Remote'];
}
/** People in the talent index who fit a job, best first (those already on it left out). */
function atsReqMatch(string $jid, stdClass $pub, int $limit = 60): array
{
    require_once __DIR__ . '/talent.php';
    $last = (int) tsMeta('at');
    if ($last < now() - 120000) {
        tsIndex($last ? 4 : 25);
    }
    $need = atsReqNeed($pub);
    $mustL = array_map('mb_strtolower', $need['must']);
    $niceL = array_map('mb_strtolower', $need['nice']);
    $titleKey = atsReqTitleKey((string) ($pub->ti ?? ''));
    // already on this job: their ATS records, emails and the database / portal records they came from
    $onJob = [];
    foreach (colAll('ats') as [$cid, $c]) {
        if ((string) ($c->job ?? '') !== $jid) {
            continue;
        }
        $onJob['ats:' . $cid] = true;
        if (($e = mb_strtolower(trim((string) ($c->e ?? '')))) !== '') {
            $onJob['e:' . $e] = true;
        }
        if (!empty($c->cand)) {
            $onJob['cand:' . $c->cand] = true;
        }
        if (!empty($c->uid)) {
            $onJob['u:' . $c->uid] = true;
        }
    }
    $locParts = array_values(array_filter(array_map(fn($x) => mb_strtolower(trim($x)), explode(',', $need['loc']))));
    $city = $locParts[0] ?? '';
    $state = isset($locParts[1]) && preg_match('/^[a-z]{2}\b/', $locParts[1], $sm) ? $sm[0] : '';
    $rows = [];
    $have = function (array $lower, string $want): ?array {
        $h = $lower[$want] ?? null;
        foreach ($lower as $k => $v) {
            if (str_starts_with($k, $want . ' ') && (!$h || $v[1] > $h[1])) {
                $h = $v;
            }
        }
        return $h;
    };
    foreach (tsdb()->query('SELECT k, kind, id, n, e, ti, loc, auth, years, upd, src, skills, lk FROM ts_people') as $r) {
        $e = mb_strtolower(trim((string) $r['e']));
        if (isset($onJob[$r['k']]) || ($e !== '' && isset($onJob['e:' . $e])) || ((string) $r['lk'] !== '' && isset($onJob[(string) $r['lk']]))) {
            continue;
        }
        $skills = json_decode((string) $r['skills'], true) ?: [];
        if (!$skills) {
            continue;
        }
        $lower = [];
        foreach ($skills as $k => $v) {
            $lower[mb_strtolower((string) $k)] = [(string) $k, (float) ($v['y'] ?? 0)];
        }
        $hits = [];
        $miss = [];
        $mHit = 0;
        foreach ($mustL as $i => $s) {
            $h = $have($lower, $s);
            if ($h) {
                $mHit++;
                $hits[] = ['s' => $need['must'][$i], 'y' => $h[1]];
            } else {
                $miss[] = $need['must'][$i];
            }
        }
        $nHit = 0;
        foreach ($niceL as $i => $s) {
            if (($h = $have($lower, $s))) {
                $nHit++;
                $hits[] = ['s' => $need['nice'][$i], 'y' => $h[1], 'nice' => 1];
            }
        }
        if ($mHit === 0 && $nHit === 0) {
            continue;
        }
        $score = ($mustL ? 60 * $mHit / count($mustL) : 0) + ($niceL ? 20 * $nHit / count($niceL) : ($mustL ? 20 * $mHit / count($mustL) : 0));
        $score += 10 * atsReqSim($titleKey, atsReqTitleKey((string) $r['ti']));
        $days = (int) $r['upd'] ? (now() - (int) $r['upd']) / 86400000 : 9999;
        $score += $days <= 30 ? 10 : ($days <= 90 ? 7 : ($days <= 365 ? 3 : 0));
        if ($need['years'] !== null && (float) $r['years'] > 0) {
            $score += (float) $r['years'] >= $need['years'] ? 4 : -6;
        }
        $rl = mb_strtolower((string) $r['loc']);
        $near = !$need['remote'] && $rl !== '' && (($city !== '' && str_contains($rl, $city)) || ($state !== '' && preg_match('/,\s*' . preg_quote($state, '/') . '\b/', $rl)));
        if ($near) {
            $score += 4;
        }
        $score = (int) round(max(0, min(100, $score)));
        if ($score < 25) {
            continue;
        }
        $rows[] = ['k' => (string) $r['k'], 'kind' => (string) $r['kind'], 'id' => (string) $r['id'], 'n' => (string) $r['n'], 'e' => (string) $r['e'], 'ti' => (string) $r['ti'], 'loc' => (string) $r['loc'], 'auth' => (string) $r['auth'], 'years' => (float) $r['years'], 'upd' => (int) $r['upd'], 'src' => (string) $r['src'], 'lk' => (string) $r['lk'], 'score' => $score, 'hits' => $hits, 'miss' => $miss, 'near' => $near];
    }
    usort($rows, fn($a, $b) => $b['score'] <=> $a['score'] ?: $b['upd'] <=> $a['upd']);
    // one row per person (the same email or linked record in the ATS, the database and a portal)
    $seen = [];
    $uniq = [];
    foreach ($rows as $row) {
        $keys = array_values(array_filter(['k:' . $row['k'], $row['lk'] !== '' ? 'k:' . $row['lk'] : '', $row['e'] !== '' ? 'e:' . mb_strtolower($row['e']) : '']));
        $dup = false;
        foreach ($keys as $kk) {
            if (isset($seen[$kk])) {
                $dup = true;
                break;
            }
        }
        foreach ($keys as $kk) {
            $seen[$kk] = true;
        }
        if (!$dup) {
            $uniq[] = $row;
        }
    }
    $buckets = ['strong' => 0, 'good' => 0, 'possible' => 0];
    foreach ($uniq as $row) {
        $buckets[$row['score'] >= 80 ? 'strong' : ($row['score'] >= 50 ? 'good' : 'possible')]++;
    }
    return ['rows' => array_slice($uniq, 0, $limit), 'total' => count($uniq), 'buckets' => $buckets, 'need' => $need, 'index' => ['n' => (int) tsdb()->query('SELECT COUNT(*) FROM ts_people')->fetchColumn(), 'at' => (int) tsMeta('at')]];
}

/* ---------------- the job page ---------------- */
function atsReqView(string $jid): array
{
    $pub = docGet('org/site/jobs/' . $jid);
    if (!$pub) {
        fail(404, 'not_found', 'That requisition is no longer there.');
    }
    $code = (string) ($pub->code ?? '');
    if (!atsReqCodeOk($code)) {
        $code = atsReqEnsureCode($jid, $pub);
        docSet('org/site/jobs/' . $jid, $pub);
    }
    $ij = atsJob($jid);
    $S = atsSettings();
    $scan = atsReqScan();
    $mine = $scan[$jid] ?? ['n' => 0, 'hired' => 0, 'src' => [], 'ch' => [], 'first' => 0, 'hires' => [], 'pays' => [], 'asks' => [], 'cands' => []];
    $cands = $mine['cands'];
    // the funnel: how many reached each step (a candidate who got to an interview went through screening)
    $kinds = ['new', 'screen', 'interview', 'offer', 'hired'];
    $reached = array_fill(0, 5, 0);
    $nowK = array_fill_keys(ATS_KINDS, 0);
    $rejected = 0;
    foreach ($cands as $x) {
        for ($i = 0; $i <= $x['best']; $i++) {
            $reached[$i]++;
        }
        $nowK[$x['kind']] = ($nowK[$x['kind']] ?? 0) + 1;
        if ($x['kind'] === 'rejected') {
            $rejected++;
        }
    }
    $funnel = [];
    foreach ($kinds as $i => $k) {
        $funnel[] = ['kind' => $k, 'n' => $reached[$i], 'now' => $nowK[$k] ?? 0, 'conv' => $i > 0 && $reached[$i - 1] > 0 ? (int) round(100 * $reached[$i] / $reached[$i - 1]) : null];
    }
    $stages = [];
    foreach ($ij['stages'] as $s) {
        $n = 0;
        foreach ($cands as $x) {
            if ((string) ($x['c']->st ?? 'new') === $s['k']) {
                $n++;
            }
        }
        $stages[] = $s + ['now' => $n];
    }
    // to do
    $todo = [];
    $sla = (array) $S['sla'];
    foreach ((array) ($ij['sla'] ?? []) as $k => $v) {
        $sla[$k] = (int) $v;
    }
    $newWaiting = 0;
    $oldestNew = 0;
    $soon = time() + 7 * 86400;
    foreach ($cands as $cid => $x) {
        $c = $x['c'];
        $days = (int) floor((now() - (int) ($c->stAt ?? $c->at ?? now())) / 86400000);
        $goal = (int) ($sla[$x['kind']] ?? 0);
        if (activeKindPhp($x['kind']) && $goal > 0 && $days > $goal) {
            $todo[] = ['t' => 'sla', 'cid' => (string) $cid, 'n' => (string) $c->n, 'msg' => (string) $c->n . ': ' . $days . ' days in ' . atsStageName($ij, (string) ($c->st ?? 'new')) . ' (goal ' . $goal . ')', 'days' => $days];
        }
        if ($x['kind'] === 'new' && $days >= 2) {
            $newWaiting++;
            $oldestNew = max($oldestNew, $days);
        }
        foreach ((array) ($c->intvs ?? []) as $iv) {
            if (!($iv instanceof stdClass) || !empty($iv->cancelled)) {
                continue;
            }
            $t = strtotime((string) ($iv->at ?? ''));
            if (!$t) {
                continue;
            }
            if ($t >= time() - 3600 && $t <= $soon) {
                $todo[] = ['t' => 'intv', 'cid' => (string) $cid, 'n' => (string) $c->n, 'msg' => (string) ($iv->kind ?? 'Interview') . ' with ' . (string) $c->n, 'at' => (string) $iv->at, 'when' => $t * 1000];
            } elseif ($t < time() - 3600 && $t > time() - 14 * 86400) {
                $cards = array_filter((array) ($c->cards ?? []), fn($k) => $k instanceof stdClass && (string) ($k->intv ?? '') === (string) ($iv->id ?? ''));
                if (!$cards && activeKindPhp($x['kind'])) {
                    $todo[] = ['t' => 'card', 'cid' => (string) $cid, 'n' => (string) $c->n, 'msg' => 'No scorecard yet for the ' . mb_strtolower((string) ($iv->kind ?? 'interview')) . ' with ' . (string) $c->n, 'when' => $t * 1000];
                }
            }
        }
        if (isset($c->offer) && $c->offer instanceof stdClass && in_array((string) ($c->offer->st ?? ''), ['sent', 'approved'], true) && $x['kind'] !== 'hired') {
            $todo[] = ['t' => 'offer', 'cid' => (string) $cid, 'n' => (string) $c->n, 'msg' => 'Offer ' . ((string) $c->offer->st === 'sent' ? 'sent to ' : 'approved for ') . (string) $c->n . ': waiting for an answer' . (!empty($c->offer->expires) ? ' (valid until ' . (string) $c->offer->expires . ')' : '')];
        }
    }
    if ($newWaiting) {
        $todo[] = ['t' => 'new', 'msg' => $newWaiting . ' new ' . ($newWaiting === 1 ? 'applicant waits' : 'applicants wait') . ' for a first look (the oldest ' . $oldestNew . ' days)', 'n' => $newWaiting];
    }
    foreach ((array) ($ij['approvals'] ?? []) as $a) {
        $a = (array) $a;
        if ((string) ($a['st'] ?? 'pending') === 'pending' && ($u = (string) ($a['uid'] ?? '')) !== '') {
            $todo[] = ['t' => 'appr', 'uid' => $u, 'msg' => 'Waiting for ' . atsReqName($u) . ' to approve the requisition'];
        }
    }
    $assign = atsReqProgress((array) ($ij['assign'] ?? []), $cands);
    foreach ($assign as $a) {
        if ($a['behind']) {
            $todo[] = ['t' => 'assign', 'uid' => $a['uid'], 'msg' => $a['n'] . ': ' . $a['sub'] . ' of ' . $a['target'] . ' submissions' . ($a['left'] < 0 ? ', ' . abs($a['left']) . ' ' . (abs($a['left']) === 1 ? 'day' : 'days') . ' past the date' : ($a['left'] === 0 ? ', due today' : ', due tomorrow'))];
        }
    }
    $age = (int) floor((now() - (int) ($pub->at ?? now())) / 86400000);
    $open = ($pub->open ?? true) !== false && !in_array((string) ($ij['status'] ?? 'open'), ['closed', 'filled'], true);
    if ($open && $age >= 14 && $reached[2] === 0) {
        $todo[] = ['t' => 'stale', 'msg' => 'Open ' . $age . ' days and nobody has reached an interview yet: try Matching people or the Boolean searches'];
    }
    // activity: the requisition's history and its candidates' events
    $act = [];
    foreach ((array) ($ij['log'] ?? []) as $l) {
        $l = (array) $l;
        $act[] = ['t' => (int) ($l['t'] ?? 0), 'who' => (string) ($l['who'] ?? ''), 'ev' => (string) ($l['ev'] ?? ''), 'kind' => (string) ($l['kind'] ?? 'job'), 'text' => (string) ($l['text'] ?? '')];
    }
    foreach ($cands as $cid => $x) {
        foreach (array_slice((array) ($x['c']->log ?? []), -40) as $l) {
            if (!($l instanceof stdClass)) {
                continue;
            }
            $act[] = ['t' => (int) ($l->t ?? 0), 'who' => (string) ($l->who ?? ''), 'ev' => (string) ($l->ev ?? ''), 'kind' => 'cand', 'cid' => (string) $cid, 'n' => (string) $x['c']->n];
        }
    }
    usort($act, fn($a, $b) => $b['t'] <=> $a['t']);
    $act = array_slice($act, 0, 150);
    // insights
    $tk = atsReqTitleKey((string) ($pub->ti ?? ''));
    $similar = [];
    $simAgg = ['hires' => [], 'pays' => $mine['pays'], 'asks' => $mine['asks'], 'src' => []];
    $client = (string) ($ij['client'] ?? '');
    $clientJobs = ['open' => 0, 'all' => 0, 'filled' => 0];
    foreach (colAll('org/site/jobs') as [$oid, $op]) {
        $oid = (string) $oid;
        if ($oid === $jid) {
            continue;
        }
        if ($client !== '') {
            $oij = docGet('ats/x/jobs/' . $oid);
            if ($oij && (string) ($oij->client ?? '') === $client) {
                $clientJobs['all']++;
                $ost = (string) ($oij->status ?? 'open');
                if ($ost === 'filled') {
                    $clientJobs['filled']++;
                } elseif (($op->open ?? true) !== false && !in_array($ost, ['closed', 'draft'], true)) {
                    $clientJobs['open']++;
                }
            }
        }
        $sim = atsReqSim($tk, atsReqTitleKey((string) ($op->ti ?? '')));
        if ($sim < 0.5) {
            continue;
        }
        $agg = $scan[$oid] ?? null;
        $days = [];
        foreach ((array) ($agg['hires'] ?? []) as $h) {
            if ((int) ($op->at ?? 0) > 0 && $h > (int) $op->at) {
                $days[] = ($h - (int) $op->at) / 86400000;
            }
        }
        $simAgg['hires'] = array_merge($simAgg['hires'], $days);
        $simAgg['pays'] = array_merge($simAgg['pays'], (array) ($agg['pays'] ?? []));
        $simAgg['asks'] = array_merge($simAgg['asks'], (array) ($agg['asks'] ?? []));
        foreach ((array) ($agg['src'] ?? []) as $s => [$n, $h]) {
            $simAgg['src'][$s] = [($simAgg['src'][$s][0] ?? 0) + $n, ($simAgg['src'][$s][1] ?? 0) + $h];
        }
        $similar[] = ['id' => $oid, 'code' => (string) ($op->code ?? ''), 'ti' => (string) ($op->ti ?? ''), 'loc' => (string) ($op->loc ?? ''), 'open' => ($op->open ?? true) !== false, 'at' => (int) ($op->at ?? 0), 'n' => (int) ($agg['n'] ?? 0), 'hired' => (int) ($agg['hired'] ?? 0), 'days' => $days ? (int) round(array_sum($days) / count($days)) : null, 'sim' => round($sim, 2)];
    }
    usort($similar, fn($a, $b) => $b['sim'] <=> $a['sim'] ?: $b['at'] <=> $a['at']);
    foreach ($mine['src'] as $s => [$n, $h]) {
        $simAgg['src'][$s] = [($simAgg['src'][$s][0] ?? 0) + $n, ($simAgg['src'][$s][1] ?? 0) + $h];
    }
    $srcBest = [];
    foreach ($simAgg['src'] as $s => [$n, $h]) {
        $srcBest[] = ['src' => (string) $s, 'n' => $n, 'hired' => $h, 'rate' => $n ? (int) round(100 * $h / $n) : 0];
    }
    usort($srcBest, fn($a, $b) => $b['hired'] <=> $a['hired'] ?: $b['n'] <=> $a['n']);
    $pay = (array) ($ij['pay'] ?? []);
    $bill = (array) ($ij['bill'] ?? []);
    $ourMin = ($pay['min'] ?? '') !== '' ? atsReqHourly($pay['min'], (string) ($pay['per'] ?? 'hour')) : null;
    $ourMax = ($pay['max'] ?? '') !== '' ? atsReqHourly($pay['max'], (string) ($pay['per'] ?? 'hour')) : null;
    $billH = ($bill['rate'] ?? '') !== '' ? atsReqHourly($bill['rate'], (string) ($bill['per'] ?? 'hour')) : null;
    $payTop = $ourMax ?? $ourMin;
    $margin = $billH !== null && $payTop !== null ? ['amt' => round($billH - $payTop, 2), 'pct' => $billH > 0 ? (int) round(100 * ($billH - $payTop) / $billH) : null] : null;
    $srcMine = [];
    foreach ($mine['src'] as $s => [$n, $h]) {
        $srcMine[] = ['src' => (string) $s, 'n' => $n, 'hired' => $h];
    }
    usort($srcMine, fn($a, $b) => $b['n'] <=> $a['n']);
    $clicks = docGet('ats/x/clicks/' . $jid);
    $insights = [
        'similar' => array_slice($similar, 0, 8),
        'pay' => ['offers' => atsReqStats($simAgg['pays']), 'asks' => atsReqStats($simAgg['asks']), 'ours' => ['min' => $ourMin, 'max' => $ourMax], 'bill' => $billH, 'margin' => $margin],
        'time' => ['age' => $age, 'first' => $mine['first'] && (int) ($pub->at ?? 0) ? max(0, (int) floor(($mine['first'] - (int) $pub->at) / 86400000)) : null, 'fill' => atsReqStats($simAgg['hires'])],
        'sources' => $srcMine,
        'best' => array_slice(array_values(array_filter($srcBest, fn($x) => $x['n'] >= 2)), 0, 6),
        'client' => $client !== '' ? ['n' => atsReqClientName($client)] + $clientJobs : null,
    ];
    $chApps = $mine['ch'];
    return [
        'id' => $jid,
        'code' => $code,
        'pub' => $pub,
        'job' => array_diff_key($ij, ['log' => 1]),
        'stages' => $stages,
        'funnel' => $funnel,
        'total' => $mine['n'],
        'rejected' => $rejected,
        'active' => count(array_filter($cands, fn($x) => activeKindPhp($x['kind']))),
        'todo' => $todo,
        'activity' => $act,
        'assign' => $assign,
        'insights' => $insights,
        'need' => atsReqNeed($pub),
        'clicks' => ['n' => (int) ($clicks->n ?? 0), 'ch' => (array) ($clicks->ch ?? []), 'last' => (int) ($clicks->last ?? 0)],
        'apps' => ['n' => $mine['n'], 'ch' => $chApps],
        'boards' => atsReqBoards($pub),
        'boardsCfg' => jobBoardsCfg($pub),
        'channels' => ATSREQ_CHANNELS,
        'boardNames' => array_map(fn($k, $n) => ['k' => $k, 'n' => $n], array_keys(SRC_BOARDS), SRC_BOARDS),
    ];
}
function activeKindPhp(string $k): bool
{
    return !in_array($k, ['hired', 'rejected'], true);
}

/* ---------------- templates ---------------- */
const ATSREQ_TPL_PUB = ['ti', 'loc', 'ty', 'md', 'sk', 'd', 'visa', 'qs', 'eeo', 'boards', 'rate', 'dur', 'exp'];
const ATSREQ_TPL_JOB = ['dept', 'openings', 'priority', 'stages', 'attrs', 'kit', 'ko', 'pay', 'bill', 'sla', 'tags'];
function atsReqTplOut(string $id, stdClass $t): array
{
    return ['id' => $id, 'n' => (string) ($t->n ?? ''), 'pub' => $t->pub ?? new stdClass(), 'job' => $t->job ?? new stdClass(), 'uses' => (int) ($t->uses ?? 0), 'at' => (int) ($t->at ?? 0), 'by' => (string) ($t->byn ?? ''), 'last' => (int) ($t->last ?? 0)];
}

/* ---------------- assignments and reminders ---------------- */
function atsReqRemindOne(array $me, string $jid, stdClass $pub, array $row, int $sub, bool $auto): bool
{
    $uid = (string) ($row['uid'] ?? '');
    $u = userRow($uid);
    if (!$u || (string) $u['status'] !== 'active') {
        return false;
    }
    $target = (int) ($row['target'] ?? 0);
    $due = (string) ($row['due'] ?? '');
    $label = atsReqLabel($pub);
    $line = $label . ': ' . $sub . ($target > 0 ? ' of ' . $target : '') . ' submissions' . ($due !== '' ? ', due ' . date('M j', (int) strtotime($due)) : '');
    atsTask([$uid], ($auto ? 'Due soon: ' : 'Reminder: ') . $label, $line . ((string) ($row['note'] ?? '') !== '' ? "\nNote: " . (string) $row['note'] : '') . "\nOpen the job: " . atsReqPortalLink($uid, $jid), (string) ($me['id'] ?? ''));
    $link = atsReqPortalLink($uid, $jid);
    $paras = array_values(array_filter([
        'Hi ' . (explode(' ', trim((string) $u['name']))[0] ?? '') . ',',
        ($auto ? 'A quick reminder about the job you are working on: ' : ($me['name'] ?? 'Your team') . ' sent a reminder about the job you are working on: ') . $label . ((string) ($pub->loc ?? '') !== '' ? ' (' . $pub->loc . ')' : '') . '.',
        'So far: ' . $sub . ($target > 0 ? ' of ' . $target : '') . ' submissions' . ($due !== '' ? ', due ' . date('l, F j', (int) strtotime($due)) : '') . '.',
        (string) ($row['note'] ?? '') !== '' ? 'Note: ' . (string) $row['note'] : '',
    ]));
    try {
        sendMail((string) $u['email'], (string) $u['name'], 'Reminder: ' . $label, implode("\n\n", $paras) . "\n\nOpen the job: " . $link, emailHtml('Reminder: ' . $label, $paras, ['Open the job', $link]), [], (string) ($me['email'] ?? ''));
    } catch (Throwable $e) {
        // the task is there either way
    }
    return true;
}
/** For the scheduled task: recruiters behind their target a day before the date (once) and the day after (once more). */
function atsReqCron(): array
{
    $last = (int) secKv('atsreq_cron_at', 0);
    if ($last > now() - 6 * 3600000) {
        return ['ran' => false];
    }
    secKvSet('atsreq_cron_at', now());
    $scan = null;
    $sent = 0;
    foreach (colAll('ats/x/jobs') as [$jid, $ijd]) {
        $jid = (string) $jid;
        $assign = (array) ($ijd->assign ?? []);
        if (!$assign || in_array((string) ($ijd->status ?? 'open'), ['closed', 'filled', 'draft'], true)) {
            continue;
        }
        $pub = docGet('org/site/jobs/' . $jid);
        if (!$pub) {
            continue;
        }
        $scan = $scan ?? atsReqScan();
        $prog = atsReqProgress($assign, $scan[$jid]['cands'] ?? []);
        $changed = false;
        foreach ($assign as $i => $row) {
            $r = (array) $row;
            $p = null;
            foreach ($prog as $x) {
                if ($x['uid'] === (string) ($r['uid'] ?? '')) {
                    $p = $x;
                }
            }
            if (!$p || !$p['behind'] || $p['left'] < -1 || (int) ($r['autoN'] ?? 0) >= 2 || (int) ($r['rem'] ?? 0) > now() - 20 * 3600000) {
                continue;
            }
            if (atsReqRemindOne(['id' => '', 'name' => 'The ATS'], $jid, $pub, $r, $p['sub'], true)) {
                $row->rem = now();
                $row->autoN = (int) ($r['autoN'] ?? 0) + 1;
                atsJobLog($ijd, 'Scheduled reminder', 'Reminded ' . $p['n'] . ': ' . $p['sub'] . ' of ' . $p['target'] . ' submissions');
                $changed = true;
                $sent++;
            }
        }
        if ($changed) {
            $ijd->assign = array_values($assign);
            docSet('ats/x/jobs/' . $jid, $ijd);
        }
    }
    return ['ran' => true, 'sent' => $sent];
}

/* ---------------- the job boards desk ---------------- */
function atsReqPostingRow(string $jid, stdClass $p, array $scanJob, ?stdClass $clicks, array $ij): array
{
    $dice = isset($p->dice) && $p->dice instanceof stdClass ? $p->dice : null;
    $src = [];
    foreach ((array) ($scanJob['src'] ?? []) as $s => [$n]) {
        $src[$s] = $n;
    }
    arsort($src);
    return [
        'id' => $jid, 'code' => (string) ($p->code ?? ''), 'ti' => (string) ($p->ti ?? ''), 'loc' => (string) ($p->loc ?? ''), 'open' => ($p->open ?? true) !== false, 'internal' => !empty($p->internal), 'offBoards' => !empty($p->offBoards),
        'boards' => array_values((array) ($p->boards ?? [])), 'on' => atsReqBoards($p), 'cfg' => jobBoardsCfg($p), 'status' => (string) ($ij['status'] ?? 'open'), 'rec' => (string) (((array) ($ij['team'] ?? []))['rec'] ?? ''),
        'dice' => $dice ? ['st' => (string) ($dice->st ?? ''), 'id' => (string) ($dice->id ?? ''), 'url' => (string) ($dice->url ?? ''), 'noId' => !empty($dice->noId), 'postedAt' => (int) ($dice->postedAt ?? 0)] : null,
        'at' => (int) ($p->at ?? 0), 'u' => (int) ($p->u ?? $p->at ?? 0), 'apps' => (int) ($scanJob['n'] ?? 0), 'src' => $src, 'chApps' => (array) ($scanJob['ch'] ?? []),
        'clicks' => (int) ($clicks->n ?? 0), 'ch' => (array) ($clicks->ch ?? []), 'shares' => (int) ($p->shares ?? 0), 'sent' => (int) ($p->sentN ?? 0),
    ];
}

function atsReqRoute(string $r, string $method, array $b): never
{
    switch ($r) {
        case 'ats_req_save': {
            $u = atsStaff(true);
            $id = atsReqId($b['id'] ?? '');
            [$id, $code, $changes, $created] = atsReqSave($u, $id, is_array($b['pub'] ?? null) ? $b['pub'] : [], is_array($b['job'] ?? null) ? $b['job'] : [], ['force' => !empty($b['force']), 'tpl' => (string) ($b['tpl'] ?? '')]);
            ok(['id' => $id, 'code' => $code, 'created' => $created, 'changes' => $changes, 'pub' => docGet('org/site/jobs/' . $id), 'job' => atsReqJobOut($id)]);
        }
        case 'ats_req_dupes': {
            atsStaff();
            ok(['dupes' => atsReqDupes(atsReqId($b['id'] ?? ''), str($b, 'ti', 160), str($b, 'loc', 120), atsReqId($b['client'] ?? ''))]);
        }
        case 'ats_req_view': {
            atsStaff();
            $jid = atsReqId($b['id'] ?? '');
            if ($jid === '') {
                fail(400, 'invalid_argument', 'Which requisition?');
            }
            ok(atsReqView($jid));
        }
        case 'ats_req_match': {
            atsStaff();
            session_write_close();
            @set_time_limit(90);
            $jid = atsReqId($b['id'] ?? '');
            $pub = $jid !== '' ? docGet('org/site/jobs/' . $jid) : null;
            if (!$pub) {
                fail(404, 'not_found', 'That requisition is no longer there.');
            }
            ok(atsReqMatch($jid, $pub, max(10, min(150, (int) ($b['limit'] ?? 60)))));
        }
        case 'ats_req_clone': {
            $u = atsStaff(true);
            $src = atsReqId($b['id'] ?? '');
            $p = $src !== '' ? docGet('org/site/jobs/' . $src) : null;
            if (!$p) {
                fail(404, 'not_found', 'That requisition is no longer there.');
            }
            $ij = atsJob($src);
            $pubIn = [];
            foreach (array_merge(array_keys(ATSREQ_PUB_TEXT), ['qs', 'eeo', 'boards', 'internal']) as $k) {
                if (isset($p->$k)) {
                    $pubIn[$k] = json_decode(json_encode($p->$k), true);
                }
            }
            $pubIn['open'] = false;
            $jobIn = [];
            foreach (['dept', 'openings', 'priority', 'client', 'team', 'stages', 'attrs', 'kit', 'ko', 'pay', 'bill', 'sla', 'tags', 'notes', 'ec', 'vendor', 'internal'] as $k) {
                if (array_key_exists($k, $ij)) {
                    $jobIn[$k] = $ij[$k];
                }
            }
            $jobIn['status'] = 'draft';
            // the approvals are asked again of the same people
            $jobIn['approvals'] = array_map(fn($a) => ['uid' => (string) (((array) $a)['uid'] ?? ''), 'st' => 'pending'], (array) ($ij['approvals'] ?? []));
            [$nid, $code] = atsReqSave($u, '', $pubIn, $jobIn, ['force' => true]);
            $nij = docGet('ats/x/jobs/' . $nid);
            $nij->log = [];
            $nij->approvals = array_values(array_filter(array_map(fn($a) => (object) ['uid' => (string) (((array) $a)['uid'] ?? ''), 'st' => 'pending'], (array) ($ij['approvals'] ?? [])), fn($a) => $a->uid !== ''));
            atsJobLog($nij, (string) $u['name'], 'Copied from ' . atsReqLabel($p) . ' (a draft: not on the careers page until it is opened)');
            docSet('ats/x/jobs/' . $nid, $nij);
            $sij = docGet('ats/x/jobs/' . $src) ?? new stdClass();
            atsJobLog($sij, (string) $u['name'], 'Copied to ' . $code);
            docSet('ats/x/jobs/' . $src, $sij);
            ok(['id' => $nid, 'code' => $code]);
        }
        case 'ats_tpl_list': {
            atsStaff();
            $rows = [];
            foreach (colAll('ats/x/tpl') as [$id, $t]) {
                $rows[] = atsReqTplOut((string) $id, $t);
            }
            usort($rows, fn($a, $b2) => ($b2['last'] ?: $b2['at']) <=> ($a['last'] ?: $a['at']));
            ok(['rows' => $rows]);
        }
        case 'ats_tpl_save': {
            $u = atsStaff(true);
            $n = str($b, 'n', 80);
            if ($n === '') {
                fail(400, 'invalid_argument', 'Name the template.');
            }
            $id = substr((string) preg_replace('/[^a-f0-9]/', '', (string) ($b['id'] ?? '')), 0, 24);
            $old = $id !== '' ? docGet('ats/x/tpl/' . $id) : null;
            if ($id !== '' && !$old) {
                fail(404, 'not_found', 'That template is no longer there.');
            }
            if (!$old && count(colAll('ats/x/tpl')) >= ATSREQ_TPL_MAX) {
                fail(400, 'invalid_argument', 'There are ' . ATSREQ_TPL_MAX . ' templates already. Delete one you no longer use.');
            }
            $from = atsReqId($b['from'] ?? '');
            $pubIn = is_array($b['pub'] ?? null) ? $b['pub'] : [];
            $jobIn = is_array($b['job'] ?? null) ? $b['job'] : [];
            if ($from !== '') {
                $p = docGet('org/site/jobs/' . $from);
                if (!$p) {
                    fail(404, 'not_found', 'That requisition is no longer there.');
                }
                $pubIn = json_decode(json_encode($p), true) ?: [];
                $jobIn = atsJob($from);
            }
            $parts = is_array($b['parts'] ?? null) ? $b['parts'] : ['post' => 1, 'qs' => 1, 'pipe' => 1, 'pay' => 1];
            $pub = atsReqCleanPub(array_intersect_key($pubIn, array_flip(ATSREQ_TPL_PUB)));
            $job = atsReqCleanJob(array_intersect_key($jobIn, array_flip(ATSREQ_TPL_JOB)), [], $u);
            if (empty($parts['qs'])) {
                unset($pub['qs'], $job['ko']);
            }
            if (empty($parts['pipe'])) {
                unset($job['stages'], $job['attrs'], $job['kit'], $job['sla']);
            }
            if (empty($parts['pay'])) {
                unset($job['pay'], $job['bill']);
            }
            if (empty($parts['post'])) {
                // v83: leave out everything the "The posting" box names (title, type, work mode, skills too)
                foreach (['ti', 'ty', 'md', 'sk', 'loc', 'd', 'rate', 'dur'] as $k) {
                    unset($pub[$k]);
                }
            }
            if ($old && $from === '' && !$pubIn && !$jobIn) {
                // a rename
                $old->n = $n;
                $old->u = now();
                docSet('ats/x/tpl/' . $id, $old);
                ok(['tpl' => atsReqTplOut($id, $old)]);
            }
            $id = $id !== '' ? $id : rid(6);
            $t = (object) ['n' => $n, 'pub' => (object) $pub, 'job' => (object) $job, 'at' => (int) ($old->at ?? now()), 'by' => (string) ($old->by ?? $u['id']), 'byn' => (string) ($old->byn ?? $u['name']), 'uses' => (int) ($old->uses ?? 0), 'last' => (int) ($old->last ?? 0), 'u' => now()];
            docSet('ats/x/tpl/' . $id, $t);
            audit('data', $old ? 'Requisition template changed' : 'Requisition template saved', 'ats/x/tpl/' . $id, ['n' => $n], $u);
            if ($from !== '') {
                $sij = docGet('ats/x/jobs/' . $from) ?? new stdClass();
                atsJobLog($sij, (string) $u['name'], 'Saved as the template "' . $n . '"');
                docSet('ats/x/jobs/' . $from, $sij);
            }
            ok(['tpl' => atsReqTplOut($id, $t)]);
        }
        case 'ats_tpl_delete': {
            $u = atsStaff(true);
            $id = substr((string) preg_replace('/[^a-f0-9]/', '', (string) ($b['id'] ?? '')), 0, 24);
            $t = $id !== '' ? docGet('ats/x/tpl/' . $id) : null;
            if ($t) {
                docDelete('ats/x/tpl/' . $id);
                audit('data', 'Requisition template deleted', 'ats/x/tpl/' . $id, ['n' => (string) ($t->n ?? '')], $u);
            }
            ok(['ok' => true]);
        }
        case 'ats_req_assign': {
            $u = atsStaff(true);
            $jid = atsReqId($b['id'] ?? '');
            $pub = $jid !== '' ? docGet('org/site/jobs/' . $jid) : null;
            if (!$pub) {
                fail(404, 'not_found', 'That requisition is no longer there.');
            }
            $ijd = docGet('ats/x/jobs/' . $jid) ?? new stdClass();
            $old = [];
            foreach ((array) ($ijd->assign ?? []) as $a) {
                $a = (array) $a;
                $old[(string) ($a['uid'] ?? '')] = $a;
            }
            $rows = [];
            $added = [];
            $log = [];
            foreach (array_slice(is_array($b['rows'] ?? null) ? $b['rows'] : [], 0, 20) as $a) {
                $a = is_array($a) ? $a : [];
                $uid = atsReqUid($a['uid'] ?? '');
                if ($uid === '' || isset($rows[$uid])) {
                    continue;
                }
                $ur = userRow($uid);
                if (!$ur || (string) $ur['status'] !== 'active') {
                    fail(400, 'invalid_argument', 'One of the people chosen no longer has an active login.');
                }
                $due = (string) ($a['due'] ?? '');
                $due = preg_match('/^\d{4}-\d{2}-\d{2}$/', $due) && strtotime($due) ? $due : '';
                $row = ['uid' => $uid, 'target' => max(0, min(999, (int) ($a['target'] ?? 0))), 'due' => $due, 'note' => str($a, 'note', 200)];
                $prev = $old[$uid] ?? null;
                $row['at'] = (int) ($prev['at'] ?? now());
                $row['by'] = (string) ($prev['by'] ?? $u['id']);
                if (isset($prev['rem'])) {
                    $row['rem'] = (int) $prev['rem'];
                }
                if ($prev && ((int) ($prev['target'] ?? 0) !== $row['target'] || (string) ($prev['due'] ?? '') !== $due)) {
                    $row['autoN'] = 0;
                    $log[] = (string) $ur['name'] . ': target ' . $row['target'] . ($due !== '' ? ' by ' . date('M j', (int) strtotime($due)) : '');
                } elseif ($prev && isset($prev['autoN'])) {
                    $row['autoN'] = (int) $prev['autoN'];
                }
                if (!$prev) {
                    $added[] = [$uid, $ur, $row];
                    $log[] = 'Assigned ' . (string) $ur['name'] . ($row['target'] ? ' (target ' . $row['target'] . ' submissions' . ($due !== '' ? ' by ' . date('M j', (int) strtotime($due)) : '') . ')' : '');
                }
                $rows[$uid] = (object) $row;
            }
            foreach ($old as $uid => $a) {
                if ($uid !== '' && !isset($rows[$uid])) {
                    $log[] = 'Unassigned ' . atsReqName($uid);
                }
            }
            $ijd->assign = array_values($rows);
            if ($log) {
                atsJobLog($ijd, (string) $u['name'], implode(' · ', $log));
            }
            $ijd->u = now();
            docSet('ats/x/jobs/' . $jid, $ijd);
            $label = atsReqLabel($pub);
            $mailed = 0;
            foreach ($added as [$uid, $ur, $row]) {
                $link = atsReqPortalLink($uid, $jid);
                $line = $label . ((string) ($pub->loc ?? '') !== '' ? ' · ' . $pub->loc : '') . ($row['target'] ? ' · target ' . $row['target'] . ' submissions' : '') . ($row['due'] !== '' ? ' by ' . date('M j', (int) strtotime($row['due'])) : '');
                atsTask([$uid], 'Assigned: ' . $label, $line . ($row['note'] !== '' ? "\nNote: " . $row['note'] : '') . "\nOpen the job: " . $link, (string) $u['id']);
                if (!empty($b['notify']) && $uid !== $u['id']) {
                    $paras = array_values(array_filter(['Hi ' . (explode(' ', trim((string) $ur['name']))[0] ?? '') . ',', (string) $u['name'] . ' assigned you to ' . $label . ((string) ($pub->loc ?? '') !== '' ? ' (' . $pub->loc . ')' : '') . '.', $row['target'] ? 'Target: ' . $row['target'] . ' submissions' . ($row['due'] !== '' ? ' by ' . date('l, F j', (int) strtotime($row['due'])) : '') . '.' : '', $row['note'] !== '' ? 'Note: ' . $row['note'] : '']));
                    try {
                        if (sendMail((string) $ur['email'], (string) $ur['name'], 'Assigned to you: ' . $label, implode("\n\n", $paras) . "\n\nOpen the job: " . $link, emailHtml('Assigned to you: ' . $label, $paras, ['Open the job', $link]), [], (string) $u['email'])) {
                            $mailed++;
                        }
                    } catch (Throwable $e) {
                        // the task is there either way
                    }
                }
            }
            if ($log) {
                audit('data', 'Requisition assignments changed', 'ats/x/jobs/' . $jid, ['changes' => $log], $u);
            }
            $scan = atsReqScan();
            ok(['assign' => atsReqProgress($ijd->assign, $scan[$jid]['cands'] ?? []), 'added' => count($added), 'mailed' => $mailed]);
        }
        case 'ats_req_remind': {
            $u = atsStaff(true);
            $jid = atsReqId($b['id'] ?? '');
            $uid = atsReqUid($b['uid'] ?? '');
            $pub = $jid !== '' ? docGet('org/site/jobs/' . $jid) : null;
            $ijd = $pub ? docGet('ats/x/jobs/' . $jid) : null;
            $row = null;
            foreach ((array) ($ijd->assign ?? []) as $a) {
                if ((string) (((array) $a)['uid'] ?? '') === $uid) {
                    $row = $a;
                }
            }
            if (!$pub || !$row) {
                fail(404, 'not_found', 'That person is not assigned to this job.');
            }
            if (throttleHit('atsrem:' . $jid . ':' . $uid, 1, 6 * 3600)) {
                fail(429, 'rate_limited', 'A reminder went to them in the last few hours. Give them a little time.');
            }
            $scan = atsReqScan();
            $prog = atsReqProgress([$row], $scan[$jid]['cands'] ?? []);
            if (!atsReqRemindOne($u, $jid, $pub, (array) $row, $prog[0]['sub'] ?? 0, false)) {
                fail(400, 'invalid_argument', 'That person no longer has an active login.');
            }
            $row->rem = now();
            atsJobLog($ijd, (string) $u['name'], 'Reminded ' . ($prog[0]['n'] ?? 'the recruiter') . ': ' . ($prog[0]['sub'] ?? 0) . ' of ' . ($prog[0]['target'] ?? 0) . ' submissions');
            docSet('ats/x/jobs/' . $jid, $ijd);
            ok(['ok' => true, 'at' => now()]);
        }
        case 'ats_req_note': {
            $u = atsStaff(true);
            $jid = atsReqId($b['id'] ?? '');
            $pub = $jid !== '' ? docGet('org/site/jobs/' . $jid) : null;
            if (!$pub) {
                fail(404, 'not_found', 'That requisition is no longer there.');
            }
            $text = str($b, 'text', 2000);
            if ($text === '') {
                fail(400, 'invalid_argument', 'Write the note first.');
            }
            // only people with an active login are told
            $to = array_slice(array_values(array_unique(array_filter(array_map(fn($x) => atsReqUid($x), is_array($b['to'] ?? null) ? $b['to'] : []), fn($x) => $x !== '' && ($r0 = userRow($x)) && (string) $r0['status'] === 'active'))), 0, 10);
            $ijd = docGet('ats/x/jobs/' . $jid) ?? new stdClass();
            atsJobLog($ijd, (string) $u['name'], 'Note' . ($to ? ' for ' . implode(', ', array_map('atsReqName', $to)) : ''), ['kind' => 'note', 'text' => $text]);
            docSet('ats/x/jobs/' . $jid, $ijd);
            $tasks = $to ? atsTask(array_values(array_filter($to, fn($x) => $x !== $u['id'])), 'Note on ' . atsReqLabel($pub) . ' from ' . $u['name'], mb_substr($text, 0, 900), (string) $u['id']) : 0;
            ok(['ok' => true, 'tasks' => $tasks]);
        }
        case 'ats_postings': {
            atsStaff();
            $scan = atsReqScan();
            $rows = [];
            $all = !empty($b['all']);
            foreach (colAll('org/site/jobs', 'at', 'desc') as [$jid, $p]) {
                $jid = (string) $jid;
                $ij = atsJob($jid);
                $live = isset($p->dice) && $p->dice instanceof stdClass && (string) ($p->dice->st ?? '') === 'live';
                $open = ($p->open ?? true) !== false;
                if (!$all && !$open && !$live && (int) ($p->u ?? $p->at ?? 0) < now() - 30 * 86400000) {
                    continue;
                }
                if (trim((string) ($p->ti ?? '')) === '') {
                    continue;
                }
                $rows[] = atsReqPostingRow($jid, $p, $scan[$jid] ?? [], docGet('ats/x/clicks/' . $jid), $ij);
            }
            $base = siteUrl() . 'api/index.php?r=jobs_feed';
            $dice = ['ready' => false, 'auto' => false, 'can' => false];
            try {
                require_once __DIR__ . '/connectors.php';
                $api = cxApi('dice');
                $dice = ['ready' => !empty($api['ops']['post']['on']), 'auto' => !empty($api['auto']['jobs']), 'can' => hasRole(currentUser(), 'admin')];
            } catch (Throwable $e) {
                // the Dice connection is optional
            }
            ok(['rows' => $rows, 'boards' => array_map(fn($k, $n) => ['k' => $k, 'n' => $n, 'url' => $base . '&board=' . $k], array_keys(SRC_BOARDS), SRC_BOARDS), 'feed' => $base, 'dice' => $dice, 'gap' => ATSREQ_REFRESH_GAP, 'channels' => ATSREQ_CHANNELS]);
        }
        case 'ats_posting_act': {
            $u = atsStaff(true);
            $act = (string) ($b['act'] ?? '');
            if (!in_array($act, ['refresh', 'board_on', 'board_off', 'boards_all', 'boards_none'], true)) {
                fail(400, 'invalid_argument', 'Unknown action.');
            }
            $board = (string) ($b['board'] ?? '');
            if (in_array($act, ['board_on', 'board_off'], true) && !isset(SRC_BOARDS[$board])) {
                fail(400, 'invalid_argument', 'Which job board?');
            }
            $ids = array_slice(array_values(array_unique(array_filter(array_map('atsReqId', is_array($b['ids'] ?? null) ? $b['ids'] : [])))), 0, 200);
            if (!$ids) {
                fail(400, 'invalid_argument', 'Choose the jobs first.');
            }
            $done = [];
            $skipped = [];
            $diceLive = [];
            $all = array_keys(SRC_BOARDS);
            foreach ($ids as $jid) {
                $p = docGet('org/site/jobs/' . $jid);
                if (!$p) {
                    continue;
                }
                $label = atsReqLabel($p);
                $ev = '';
                if ($act === 'refresh') {
                    if (($p->open ?? true) === false) {
                        $skipped[] = ['id' => $jid, 'why' => $label . ': not open'];
                        continue;
                    }
                    if (!jobBoardsOf($p)) {
                        $skipped[] = ['id' => $jid, 'why' => $label . ': on no job board'];
                        continue;
                    }
                    $last = (int) ($p->u ?? $p->at ?? 0);
                    if ($last > now() - ATSREQ_REFRESH_GAP) {
                        $h = max(1, (int) round((now() - $last) / 3600000));
                        $skipped[] = ['id' => $jid, 'why' => $label . ': refreshed ' . ($h < 48 ? $h . ($h === 1 ? ' hour' : ' hours') : (int) round($h / 24) . ' days') . ' ago (once every 3 days)'];
                        continue;
                    }
                    $p->u = now();
                    $ev = 'Refreshed on the job boards (a new date in the feeds)';
                } else {
                    $before = jobBoardsCfg($p);
                    if ($act === 'boards_all') {
                        unset($p->offBoards);
                        $p->boards = [];
                        $ev = 'On every job board';
                    } elseif ($act === 'boards_none') {
                        $p->offBoards = true;
                        $ev = 'Taken off every job board (careers page only)';
                    } else {
                        $cur = !empty($p->offBoards) ? [] : (array) ($p->boards ?? []);
                        $cur = array_values(array_intersect(array_map('strval', $cur), $all));
                        if (!empty($p->offBoards)) {
                            $set = $act === 'board_on' ? [$board] : [];
                        } else {
                            $set = $cur ?: $all;
                            $set = $act === 'board_on' ? array_values(array_unique(array_merge($set, [$board]))) : array_values(array_diff($set, [$board]));
                        }
                        if (!$set) {
                            $p->offBoards = true;
                            $p->boards = [];
                        } else {
                            unset($p->offBoards);
                            $p->boards = count($set) === count($all) ? [] : array_values(array_intersect($all, $set));
                        }
                        $ev = SRC_BOARDS[$board] . ($act === 'board_on' ? ' switched on' : ' switched off') . ' for this job';
                    }
                    if (json_encode(jobBoardsCfg($p)) === json_encode($before)) {
                        $skipped[] = ['id' => $jid, 'why' => $label . ': no change'];
                        continue;
                    }
                    if (!in_array('dice', jobBoardsOf($p), true) && isset($p->dice) && $p->dice instanceof stdClass && (string) ($p->dice->st ?? '') === 'live') {
                        $diceLive[] = ['id' => $jid, 'code' => (string) ($p->code ?? ''), 'ti' => (string) ($p->ti ?? ''), 'noId' => !empty($p->dice->noId)];
                    }
                }
                docSet('org/site/jobs/' . $jid, $p);
                $ijd = docGet('ats/x/jobs/' . $jid) ?? new stdClass();
                atsJobLog($ijd, (string) $u['name'], $ev);
                docSet('ats/x/jobs/' . $jid, $ijd);
                $done[] = $jid;
            }
            if ($done) {
                audit('data', 'Job postings: ' . $act . ($board !== '' ? ' ' . $board : ''), 'org/site/jobs', ['n' => count($done)], $u);
            }
            ok(['done' => $done, 'skipped' => $skipped, 'diceLive' => $diceLive]);
        }
    }
    fail(404, 'not_found', 'Unknown action.');
}
