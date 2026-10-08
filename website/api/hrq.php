<?php
declare(strict_types=1);
/*
 * v37.3 Profile update requests. HR asks employees and consultants to confirm or update their details and to send
 * documents; anyone can also ask HR to change details that only HR may change. HR reviews each change next to what is
 * on file and approves it field by field and file by file, sends it back for changes, or declines it.
 *   - Requests: hrms/main/hrq/{id} {uid, n, origin hr|self, secs[], docs[{k, exp, note}], note, due, st, sub, rev, log}
 *     st: open (waiting for the person) · returned (sent back to them) · submitted (waiting for HR) · approved ·
 *     partial (part of it approved) · rejected · cancelled.
 *   - Files sent with a request wait in hrms/main/hrq/{id}/f/{fid} (encrypted like every upload, HR-only). An approved
 *     one is copied into the person's Documents (u/{uid}/f) with its type and expiry date, marked verified by HR, and
 *     an older document of the same kind (an old passport) is marked replaced. The waiting copies go once HR decides.
 *   - Approved fields go where they live: the name and phone on the person's profile (u/{uid}.p), the rest on the HR
 *     record (hrms/emp/{uid}/rec). An approved passport, visa stamp, I-797, I-94 or EAD with an expiry date also
 *     updates the person's compliance dates (comp/{uid}/profile) when they keep one there.
 *   - People reach their own requests only through these routes; the records themselves are HR's.
 *   - The scheduled task reminds people a day before the date and once when it has passed, and clears the values of
 *     requests decided more than 180 days ago (what changed stays in the history).
 */

const HRQ_SECS = [
    'personal' => ['n' => 'Personal details', 'f' => [
        'name' => ['n' => 'Full legal name', 'max' => 120, 'req' => 1],
        'pname' => ['n' => 'Preferred name', 'max' => 80],
        'dob' => ['n' => 'Date of birth', 't' => 'dob', 'req' => 1],
        'pemail' => ['n' => 'Personal email', 't' => 'email', 'max' => 190],
        'phone' => ['n' => 'Mobile phone', 't' => 'tel', 'req' => 1],
    ]],
    'address' => ['n' => 'Home address', 'f' => [
        'addr1' => ['n' => 'Street address', 'max' => 160, 'req' => 1],
        'addr2' => ['n' => 'Apartment, suite or unit', 'max' => 80],
        'city' => ['n' => 'City', 'max' => 80, 'req' => 1],
        'state' => ['n' => 'State or province', 'max' => 40, 'req' => 1],
        'zip' => ['n' => 'ZIP or postal code', 'max' => 12, 'req' => 1],
        'country' => ['n' => 'Country', 'max' => 60, 'req' => 1],
    ]],
    'emergency' => ['n' => 'Emergency contact', 'f' => [
        'ecn' => ['n' => 'Contact name', 'max' => 120, 'req' => 1],
        'ecr' => ['n' => 'Relationship', 'max' => 60, 'req' => 1],
        'ecp' => ['n' => 'Contact phone', 't' => 'tel', 'req' => 1],
    ]],
    'work' => ['n' => 'Work location', 'f' => [
        'wloc' => ['n' => 'Where you work (city, state)', 'max' => 120, 'req' => 1],
        'wmode' => ['n' => 'Work mode', 't' => 'select', 'o' => ['Office', 'Hybrid', 'Remote'], 'req' => 1],
    ]],
    'education' => ['n' => 'Education', 'f' => [
        'deg' => ['n' => 'Highest degree', 'max' => 80, 'req' => 1],
        'field' => ['n' => 'Field of study', 'max' => 80],
        'school' => ['n' => 'School or university', 'max' => 120],
        'gyear' => ['n' => 'Year completed', 't' => 'year'],
    ]],
];
// where each field is kept: the profile (u/{uid}.p, key) or the HR record (hrms/emp/{uid}/rec, key)
const HRQ_WHERE = [
    'name' => ['p', 'n'], 'phone' => ['p', 'ph'],
    'pname' => ['r', 'pname'], 'dob' => ['r', 'dob'], 'pemail' => ['r', 'pemail'],
    'addr1' => ['r', 'addr1'], 'addr2' => ['r', 'addr2'], 'city' => ['r', 'city'], 'state' => ['r', 'state'], 'zip' => ['r', 'zip'], 'country' => ['r', 'country'],
    'ecn' => ['r', 'ecn'], 'ecr' => ['r', 'ecr'], 'ecp' => ['r', 'ecp'],
    'wloc' => ['r', 'loc'], 'wmode' => ['r', 'mode'],
    'deg' => ['r', 'deg'], 'field' => ['r', 'field'], 'school' => ['r', 'school'], 'gyear' => ['r', 'gyear'],
];
// documents that can be asked for: whether they usually expire, whether a newer one replaces the older, and the
// compliance date an approved one updates
const HRQ_DOCS = [
    'passport' => ['n' => 'Passport', 'exp' => 1, 'one' => 1, 'comp' => 'passExp'],
    'visa' => ['n' => 'Visa stamp', 'exp' => 1, 'one' => 1, 'comp' => 'visaExp'],
    'i797' => ['n' => 'I-797 approval notice', 'exp' => 1, 'one' => 1, 'comp' => 'h1bExp'],
    'i94' => ['n' => 'I-94 record', 'exp' => 1, 'one' => 1, 'comp' => 'i94Exp'],
    'ead' => ['n' => 'EAD card', 'exp' => 1, 'one' => 1, 'comp' => 'eadExp'],
    'gc' => ['n' => 'Green card', 'exp' => 1, 'one' => 1],
    'dl' => ['n' => "Driver's license or state ID", 'exp' => 1, 'one' => 1],
    'i9' => ['n' => 'I-9 documents', 'exp' => 0],
    'w4' => ['n' => 'Form W-4', 'exp' => 0, 'one' => 1],
    'statetax' => ['n' => 'State tax withholding form', 'exp' => 0, 'one' => 1],
    'degree' => ['n' => 'Degree or transcript', 'exp' => 0],
    'cert' => ['n' => 'Certification', 'exp' => 1],
    'resume' => ['n' => 'Resume', 'exp' => 0, 'one' => 1],
    'other' => ['n' => 'Other document', 'exp' => 0],
];
const HRQ_ST = ['open' => 'Waiting for them', 'returned' => 'Sent back for changes', 'submitted' => 'Waiting for HR', 'approved' => 'Approved', 'partial' => 'Partly approved', 'rejected' => 'Declined', 'cancelled' => 'Cancelled'];
const HRQ_MAX_FILES = 12;

/* ---------------- helpers ---------------- */
/** HR (administrators, HR, people given HRMS) for the HR side of the requests. */
function hrqStaff(): array
{
    $u = requireUser();
    if (!hasRole($u, 'admin') && !can('hrms/main/hrq/x', 'w')) {
        fail(403, 'forbidden', 'Profile update requests are for HR.');
    }
    return $u;
}
function hrqId($v): string
{
    return substr((string) preg_replace('/[^a-f0-9]/', '', (string) $v), 0, 24);
}
function hrqDef(string $k): ?array
{
    foreach (HRQ_SECS as $s) {
        if (isset($s['f'][$k])) {
            return $s['f'][$k];
        }
    }
    return null;
}
function hrqKeysOf(array $secs): array
{
    $out = [];
    foreach ($secs as $s) {
        foreach (array_keys(HRQ_SECS[$s]['f'] ?? []) as $k) {
            $out[] = $k;
        }
    }
    return $out;
}
/** One value as typed → [clean value, problem or '']. */
function hrqClean(string $k, $v): array
{
    $d = hrqDef($k);
    if (!$d) {
        return ['', 'Unknown field.'];
    }
    $v = is_scalar($v) ? trim((string) preg_replace('/\s+/u', ' ', (string) $v)) : '';
    if ($v === '') {
        return ['', !empty($d['req']) ? $d['n'] . ' is needed.' : ''];
    }
    switch ($d['t'] ?? 'text') {
        case 'dob':
            $t = preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) ? strtotime($v . ' 12:00:00') : false;
            if (!$t || date('Y-m-d', $t) !== $v) {
                return [$v, $d['n'] . ': pick the date.'];
            }
            $age = (int) floor((time() - $t) / (365.25 * 86400));
            if ($age < 14 || $age > 100) {
                return [$v, $d['n'] . ' does not look right.'];
            }
            return [$v, ''];
        case 'email':
            $v = mb_strtolower($v);
            return filter_var($v, FILTER_VALIDATE_EMAIL) && strlen($v) <= 190 ? [$v, ''] : [$v, $d['n'] . ': enter a valid email address.'];
        case 'tel':
            $digits = (string) preg_replace('/\D/', '', $v);
            if (strlen($digits) < 7 || strlen($digits) > 15 || !preg_match('/^[0-9+().\-\s]{7,30}$/', $v)) {
                return [$v, $d['n'] . ': enter a phone number.'];
            }
            return [mb_substr($v, 0, 30), ''];
        case 'select':
            return in_array($v, $d['o'], true) ? [$v, ''] : [$v, $d['n'] . ': choose one of the options.'];
        case 'year':
            return preg_match('/^\d{4}$/', $v) && (int) $v >= 1950 && (int) $v <= (int) date('Y') + 6 ? [$v, ''] : [$v, $d['n'] . ': enter the year (like 2018).'];
    }
    return [mb_substr($v, 0, (int) ($d['max'] ?? 120)), ''];
}
/** What is on file now for each field (for the form and for HR's comparison). */
function hrqCur(string $uid): array
{
    $u = docGet("u/$uid");
    $rec = docGet("hrms/emp/$uid/rec");
    $out = [];
    foreach (HRQ_WHERE as $k => [$w, $key]) {
        $src = $w === 'p' ? ($u->p ?? null) : $rec;
        $out[$k] = $src && isset($src->$key) && is_scalar($src->$key) ? (string) $src->$key : '';
    }
    // an emergency contact typed on the HR record before v37.3 (one line), to show next to the new fields
    $out['_emg'] = $rec && is_string($rec->emg ?? null) ? (string) $rec->emg : '';
    return $out;
}
function hrqTask(array $uids, string $title, string $detail, string $by): int
{
    $n = 0;
    $id = rid(6);
    foreach (array_unique(array_filter($uids)) as $uid) {
        if (!preg_match('/^u_[a-f0-9]+$/', (string) $uid)) {
            continue;
        }
        $r = docGet('r/' . $uid) ?? new stdClass();
        if (!isset($r->tasks) || !($r->tasks instanceof stdClass)) {
            $r->tasks = new stdClass();
        }
        $r->tasks->$id = (object) ['ti' => mb_substr($title, 0, 160), 'd' => mb_substr($detail, 0, 1000), 'due' => date('Y-m-d', time() + 2 * 86400), 'p' => 'normal', 'at' => now(), 'by' => $by];
        docSet('r/' . $uid, $r);
        $n++;
    }
    return $n;
}
function hrqMail(string $uid, string $subject, array $paras, string $btn, string $link, string $replyTo = ''): bool
{
    $u = userRow($uid);
    if (!$u || (string) $u['status'] !== 'active') {
        return false;
    }
    try {
        return sendMail((string) $u['email'], (string) $u['name'], $subject, implode("\n\n", $paras) . "\n\n" . $btn . ': ' . $link, emailHtml($subject, $paras, [$btn, $link]), [], $replyTo);
    } catch (Throwable $e) {
        return false;
    }
}
function hrqLog(stdClass $q, string $who, string $ev): void
{
    $log = array_values((array) ($q->log ?? []));
    $log[] = (object) ['t' => now(), 'who' => mb_substr($who, 0, 120), 'ev' => mb_substr($ev, 0, 400)];
    $q->log = array_slice($log, -100);
}
function hrqWhat(stdClass $q): string
{
    $parts = array_map(fn($s) => HRQ_SECS[$s]['n'] ?? $s, (array) ($q->secs ?? []));
    foreach ((array) ($q->docs ?? []) as $d) {
        $parts[] = HRQ_DOCS[(string) ($d->k ?? '')]['n'] ?? 'a document';
    }
    return implode(', ', $parts);
}
/** HR people to tell about a request someone sent themselves (HR first, administrators if there is no HR). */
function hrqHrPeople(int $max = 5): array
{
    $hr = [];
    $adm = [];
    foreach (db()->query("SELECT id, email, name, role, status, access FROM users WHERE status = 'active'")->fetchAll() as $r) {
        if (hasRole($r, 'hr')) {
            $hr[] = (string) $r['id'];
        } elseif (hasRole($r, 'admin')) {
            $adm[] = (string) $r['id'];
        }
    }
    return array_slice($hr ?: $adm, 0, $max);
}
/** A request as the person sees it (no HR notes beyond what is meant for them). */
function hrqMineOut(string $id, stdClass $q, ?array $cur = null): array
{
    $files = [];
    foreach (colAll("hrms/main/hrq/$id/f") as [$fid, $f]) {
        $files[] = ['id' => (string) $fid, 'n' => (string) ($f->n ?? ''), 'k' => (string) ($f->c ?? ''), 'exp' => (string) ($f->exp ?? ''), 'sz' => (int) ($f->sz ?? 0), 'at' => (int) ($f->at ?? 0)];
    }
    return [
        'id' => $id, 'origin' => (string) ($q->origin ?? 'hr'), 'secs' => array_values((array) ($q->secs ?? [])), 'docs' => array_values(array_map(fn($d) => (array) $d, (array) ($q->docs ?? []))),
        'note' => (string) ($q->note ?? ''), 'due' => (string) ($q->due ?? ''), 'st' => (string) ($q->st ?? 'open'), 'at' => (int) ($q->at ?? 0), 'byn' => (string) ($q->byn ?? ''),
        'sub' => isset($q->sub) ? ['at' => (int) ($q->sub->at ?? 0), 'vals' => (array) ($q->sub->vals ?? []), 'msg' => (string) ($q->sub->msg ?? '')] : null,
        'rev' => isset($q->rev) ? ['at' => (int) ($q->rev->at ?? 0), 'msg' => (string) ($q->rev->msg ?? ''), 'ok' => (array) ($q->rev->ok ?? []), 'fok' => (array) ($q->rev->fok ?? [])] : null,
        'files' => $files, 'cur' => $cur,
    ];
}
function hrqPortalLink(string $id): string
{
    return siteUrl() . '#/portal/profile?hrq=' . rawurlencode($id);
}
function hrqHrLink(string $id): string
{
    return siteUrl() . '#/portal/hr/hrms?tab=requests&hrq=' . rawurlencode($id);
}
/** Approved values into the profile and the HR record. Returns the labels of what changed. */
function hrqApply(string $uid, array $vals, array $keys, array $me): array
{
    $p = [];
    $r = [];
    $changed = [];
    foreach ($keys as $k) {
        if (!isset(HRQ_WHERE[$k]) || !array_key_exists($k, $vals)) {
            continue;
        }
        [$w, $key] = HRQ_WHERE[$k];
        if ($w === 'p') {
            $p[$key] = (string) $vals[$k];
        } else {
            $r[$key] = (string) $vals[$k];
        }
        $changed[] = hrqDef($k)['n'] ?? $k;
    }
    if ($p) {
        $u = docGet("u/$uid") ?? new stdClass();
        $prof = isset($u->p) && $u->p instanceof stdClass ? $u->p : new stdClass();
        foreach ($p as $k => $v) {
            if ($k === 'n' && trim($v) === '') {
                continue;
            }
            $prof->$k = $v;
        }
        $u->p = $prof;
        docSet("u/$uid", $u);
    }
    if ($r) {
        $rec = docGet("hrms/emp/$uid/rec") ?? new stdClass();
        foreach ($r as $k => $v) {
            $rec->$k = $v;
        }
        if (array_intersect(array_keys($r), ['ecn', 'ecr', 'ecp'])) {
            // the one-line emergency contact the HR record shows, kept in step
            $rec->emg = trim((string) ($rec->ecn ?? '') . ((string) ($rec->ecr ?? '') !== '' ? ' (' . $rec->ecr . ')' : '') . ((string) ($rec->ecp ?? '') !== '' ? ', ' . $rec->ecp : ''));
        }
        $rec->u = now();
        $rec->by = (string) $me['id'];
        docSet("hrms/emp/$uid/rec", $rec);
    }
    return $changed;
}
/** An approved file into the person's Documents (verified by HR); an older one of the same kind is marked replaced. */
function hrqKeepFile(string $uid, string $rid, string $fid, stdClass $meta, array $me): ?array
{
    $dir = cfg('files_dir');
    if (!preg_match('/^[a-f0-9]{32}$/', $fid) || !is_file("$dir/$fid")) {
        return null;
    }
    $new = rid(16);
    if (!@copy("$dir/$fid", "$dir/$new")) {
        return null;
    }
    fileSealPath("$dir/$new");
    $kind = isset(HRQ_DOCS[(string) ($meta->c ?? '')]) ? (string) $meta->c : 'other';
    $replaced = 0;
    if (!empty(HRQ_DOCS[$kind]['one'])) {
        foreach (colAll("u/$uid/f") as [$ofid, $of]) {
            if ((string) ($of->c ?? '') === $kind && empty($of->rep)) {
                $of->rep = (object) ['by' => $new, 'at' => now()];
                docSet("u/$uid/f/$ofid", $of);
                $replaced++;
            }
        }
    }
    $doc = (object) ['n' => (string) ($meta->n ?? 'document'), 'ty' => (string) ($meta->ty ?? 'application/octet-stream'), 'sz' => (int) ($meta->sz ?? 0), 'at' => now(), 'c' => $kind, 'src' => 'hrq', 'hrq' => $rid, 'vf' => (object) ['s' => 'verified', 'n' => 'Approved in a profile update request', 'at' => now(), 'by' => (string) $me['id']]];
    if ((string) ($meta->exp ?? '') !== '') {
        $doc->exp = (string) $meta->exp;
    }
    docSet("u/$uid/f/$new", $doc);
    return ['id' => $new, 'kind' => $kind, 'exp' => (string) ($meta->exp ?? ''), 'replaced' => $replaced];
}
function hrqDropFile(string $rid, string $fid): void
{
    if (!preg_match('/^[a-f0-9]{32}$/', $fid)) {
        return;
    }
    docDelete("hrms/main/hrq/$rid/f/$fid");
    $f = cfg('files_dir') . "/$fid";
    if (is_file($f)) {
        @unlink($f);
    }
}
/** Approved expiry dates into the person's compliance dates (only where they keep a compliance profile). */
function hrqCompDates(string $uid, array $kept): array
{
    $p = docGet("comp/$uid/profile");
    if (!$p) {
        return [];
    }
    $set = [];
    foreach ($kept as $k) {
        $field = HRQ_DOCS[$k['kind']]['comp'] ?? '';
        if ($field !== '' && $k['exp'] !== '') {
            $p->$field = $k['exp'];
            $set[] = HRQ_DOCS[$k['kind']]['n'] . ' ' . $k['exp'];
        }
    }
    if ($set) {
        $p->u = now();
        docSet("comp/$uid/profile", $p);
    }
    return $set;
}
/** For the scheduled task: reminders near the date, and old decided requests cleared of their values. */
function hrqCron(): array
{
    $last = (int) secKv('hrq_cron_at', 0);
    if ($last > now() - 6 * 3600000) {
        return ['ran' => false];
    }
    secKvSet('hrq_cron_at', now());
    $sent = 0;
    $purged = 0;
    $today = date('Y-m-d');
    $tomorrow = date('Y-m-d', time() + 86400);
    foreach (colAll('hrms/main/hrq') as [$id, $q]) {
        $id = (string) $id;
        $st = (string) ($q->st ?? 'open');
        if (in_array($st, ['open', 'returned'], true) && (string) ($q->due ?? '') !== '') {
            $due = (string) $q->due;
            $stage = $due === $tomorrow ? 'soon' : ($due < $today ? 'late' : '');
            $done = (array) ($q->auto ?? []);
            if ($stage !== '' && empty($done[$stage])) {
                $what = hrqWhat($q);
                hrqTask([(string) $q->uid], ($stage === 'soon' ? 'Due tomorrow: ' : 'Overdue: ') . 'update your details for HR', $what . "\nOpen it: " . hrqPortalLink($id), '');
                hrqMail((string) $q->uid, $stage === 'soon' ? 'Reminder: HR needs your details by tomorrow' : 'Reminder: HR is still waiting for your details', ['Hi ' . (explode(' ', trim((string) ($q->n ?? '')))[0] ?? '') . ',', 'HR asked you to update: ' . $what . '.', $stage === 'soon' ? 'It is due tomorrow.' : 'It was due on ' . date('F j', (int) strtotime($due)) . '.'], 'Open the request', hrqPortalLink($id));
                $done[$stage] = now();
                $q->auto = (object) $done;
                hrqLog($q, 'Scheduled reminder', $stage === 'soon' ? 'Reminded: due tomorrow' : 'Reminded: past the date');
                docSet("hrms/main/hrq/$id", $q);
                $sent++;
            }
        }
        if (in_array($st, ['approved', 'partial', 'rejected', 'cancelled'], true) && empty($q->purged) && (int) ($q->rev->at ?? $q->u ?? 0) < now() - 180 * 86400000) {
            if (isset($q->sub) && $q->sub instanceof stdClass) {
                $q->sub->vals = (object) array_fill_keys(array_keys((array) ($q->sub->vals ?? [])), '');
            }
            $q->purged = now();
            docSet("hrms/main/hrq/$id", $q);
            foreach (colAll("hrms/main/hrq/$id/f") as [$fid]) {
                hrqDropFile($id, (string) $fid);
            }
            $purged++;
        }
    }
    return ['ran' => true, 'sent' => $sent, 'purged' => $purged];
}

function hrqRoute(string $r, string $method, array $b): never
{
    switch ($r) {
        /* ---------- HR ---------- */
        case 'hrq_meta': {
            requireUser();
            $secs = [];
            foreach (HRQ_SECS as $k => $s) {
                $f = [];
                foreach ($s['f'] as $fk => $fd) {
                    $f[] = ['k' => $fk, 'n' => $fd['n'], 't' => $fd['t'] ?? 'text', 'o' => $fd['o'] ?? null, 'req' => !empty($fd['req']), 'max' => $fd['max'] ?? null];
                }
                $secs[] = ['k' => $k, 'n' => $s['n'], 'f' => $f];
            }
            ok(['secs' => $secs, 'docs' => array_map(fn($k, $d) => ['k' => $k, 'n' => $d['n'], 'exp' => !empty($d['exp'])], array_keys(HRQ_DOCS), HRQ_DOCS), 'st' => HRQ_ST, 'maxFiles' => HRQ_MAX_FILES]);
        }
        case 'hrq_list': {
            hrqStaff();
            $rows = [];
            $cnt = array_fill_keys(array_keys(HRQ_ST), 0);
            $late = 0;
            foreach (colAll('hrms/main/hrq') as [$id, $q]) {
                $st = (string) ($q->st ?? 'open');
                $cnt[$st] = ($cnt[$st] ?? 0) + 1;
                $isLate = in_array($st, ['open', 'returned'], true) && (string) ($q->due ?? '') !== '' && (string) $q->due < date('Y-m-d');
                $late += $isLate ? 1 : 0;
                $rows[] = ['id' => (string) $id, 'uid' => (string) ($q->uid ?? ''), 'n' => (string) ($q->n ?? ''), 'origin' => (string) ($q->origin ?? 'hr'), 'what' => hrqWhat($q), 'secs' => array_values((array) ($q->secs ?? [])), 'ndocs' => count((array) ($q->docs ?? [])), 'st' => $st, 'due' => (string) ($q->due ?? ''), 'late' => $isLate, 'at' => (int) ($q->at ?? 0), 'u' => (int) ($q->u ?? $q->at ?? 0), 'byn' => (string) ($q->byn ?? ''), 'subAt' => (int) ($q->sub->at ?? 0)];
            }
            usort($rows, fn($a, $b2) => ($b2['st'] === 'submitted') <=> ($a['st'] === 'submitted') ?: $b2['u'] <=> $a['u']);
            ok(['rows' => $rows, 'counts' => $cnt, 'late' => $late]);
        }
        case 'hrq_get': {
            hrqStaff();
            $id = hrqId($b['id'] ?? '');
            $q = $id !== '' ? docGet("hrms/main/hrq/$id") : null;
            if (!$q) {
                fail(404, 'not_found', 'That request is no longer there.');
            }
            $out = hrqMineOut($id, $q, hrqCur((string) $q->uid));
            $out['uid'] = (string) $q->uid;
            $out['n'] = (string) ($q->n ?? '');
            $out['log'] = array_values(array_map(fn($l) => (array) $l, (array) ($q->log ?? [])));
            $out['purged'] = !empty($q->purged);
            $out['comp'] = (bool) docGet('comp/' . $q->uid . '/profile');
            ok(['q' => $out]);
        }
        case 'hrq_create': {
            $u = hrqStaff();
            if (throttleHit('hrqnew:' . $u['id'], 30, 3600)) {
                fail(429, 'rate_limited', 'That is a lot of requests in an hour. Try again a little later.');
            }
            $secs = array_values(array_intersect(array_keys(HRQ_SECS), array_map('strval', is_array($b['secs'] ?? null) ? $b['secs'] : [])));
            $docs = [];
            foreach (array_slice(is_array($b['docs'] ?? null) ? $b['docs'] : [], 0, 10) as $d) {
                $k = (string) (is_array($d) ? ($d['k'] ?? '') : $d);
                if (isset(HRQ_DOCS[$k]) && !in_array($k, array_column($docs, 'k'), true)) {
                    $docs[] = ['k' => $k, 'exp' => is_array($d) && array_key_exists('exp', $d) ? !empty($d['exp']) : !empty(HRQ_DOCS[$k]['exp']), 'note' => is_array($d) ? str($d, 'note', 160) : ''];
                }
            }
            if (!$secs && !$docs) {
                fail(400, 'invalid_argument', 'Choose what to ask for: details, documents, or both.');
            }
            $uids = array_slice(array_values(array_unique(array_filter(array_map(fn($x) => preg_match('/^u_[a-f0-9]{4,40}$/', (string) $x) ? (string) $x : '', is_array($b['uids'] ?? null) ? $b['uids'] : [])))), 0, 200);
            if (!$uids) {
                fail(400, 'invalid_argument', 'Choose who to ask.');
            }
            $due = (string) ($b['due'] ?? '');
            $due = preg_match('/^\d{4}-\d{2}-\d{2}$/', $due) && strtotime($due) && $due >= date('Y-m-d') ? $due : '';
            $note = str($b, 'note', 1000);
            $made = [];
            $skipped = [];
            foreach ($uids as $uid) {
                $ur = userRow($uid);
                $pk = $ur ? portalOf($uid) : '';
                if (!$ur || (string) $ur['status'] !== 'active' || in_array($pk, ['employer'], true)) {
                    $skipped[] = $ur ? (string) $ur['name'] : $uid;
                    continue;
                }
                $id = rid(6);
                $q = (object) ['uid' => $uid, 'n' => (string) $ur['name'], 'origin' => 'hr', 'secs' => $secs, 'docs' => array_map(fn($d) => (object) $d, $docs), 'note' => $note, 'due' => $due, 'st' => 'open', 'at' => now(), 'u' => now(), 'by' => (string) $u['id'], 'byn' => (string) $u['name'], 'log' => []];
                hrqLog($q, (string) $u['name'], 'Asked for: ' . hrqWhat($q) . ($due !== '' ? ' (by ' . date('M j', (int) strtotime($due)) . ')' : ''));
                docSet("hrms/main/hrq/$id", $q);
                $what = hrqWhat($q);
                hrqTask([$uid], 'Update your details for HR' . ($due !== '' ? ' by ' . date('M j', (int) strtotime($due)) : ''), $what . ($note !== '' ? "\nFrom HR: " . $note : '') . "\nOpen it: " . hrqPortalLink($id), (string) $u['id']);
                $paras = array_values(array_filter(['Hi ' . (explode(' ', trim((string) $ur['name']))[0] ?? '') . ',', (string) $u['name'] . ' from HR asked you to update: ' . $what . '.', $note !== '' ? '"' . $note . '"' : '', $due !== '' ? 'Please send it by ' . date('l, F j', (int) strtotime($due)) . '.' : '', 'Open your portal, check what is on file, change what is out of date, and send it. HR reviews every change before it is saved.']));
                hrqMail($uid, 'Please update your details for HR', $paras, 'Open the request', hrqPortalLink($id), (string) $u['email']);
                $made[] = $id;
            }
            if ($made) {
                audit('data', 'Profile update requests sent', 'hrms/main/hrq', ['n' => count($made), 'secs' => $secs, 'docs' => array_column($docs, 'k')], $u);
            }
            ok(['made' => $made, 'skipped' => $skipped]);
        }
        case 'hrq_review': {
            $u = hrqStaff();
            $id = hrqId($b['id'] ?? '');
            $q = $id !== '' ? docGet("hrms/main/hrq/$id") : null;
            if (!$q) {
                fail(404, 'not_found', 'That request is no longer there.');
            }
            if ((string) ($q->st ?? '') !== 'submitted') {
                fail(409, 'conflict', 'Only a request the person has sent can be reviewed.');
            }
            $act = (string) ($b['act'] ?? '');
            if (!in_array($act, ['approve', 'return', 'reject'], true)) {
                fail(400, 'invalid_argument', 'Approve, send back or decline?');
            }
            $msg = str($b, 'msg', 1000);
            if ($act !== 'approve' && $msg === '') {
                fail(400, 'invalid_argument', $act === 'return' ? 'Say what they should change.' : 'Say why it is declined.');
            }
            $uid = (string) $q->uid;
            $vals = (array) ($q->sub->vals ?? []);
            $keys = array_values(array_intersect(hrqKeysOf((array) ($q->secs ?? [])), array_keys($vals)));
            $okIn = is_array($b['ok'] ?? null) ? $b['ok'] : [];
            $fokIn = is_array($b['fok'] ?? null) ? $b['fok'] : [];
            $files = colAll("hrms/main/hrq/$id/f");
            $ok = [];
            $fok = [];
            $changed = [];
            $kept = [];
            $comp = [];
            if ($act === 'return') {
                $q->st = 'returned';
                $q->rev = (object) ['at' => now(), 'by' => (string) $u['id'], 'byn' => (string) $u['name'], 'msg' => $msg, 'act' => 'return'];
                hrqLog($q, (string) $u['name'], 'Sent back: ' . mb_substr($msg, 0, 200));
            } else {
                $cur = hrqCur($uid);
                foreach ($keys as $k) {
                    // only what changed needs approving; a value left as it was is simply confirmed
                    $same = (string) ($cur[$k] ?? '') === (string) $vals[$k];
                    $ok[$k] = $act === 'approve' && ($same || !empty($okIn[$k]));
                }
                foreach ($files as [$fid]) {
                    $fok[(string) $fid] = $act === 'approve' && !empty($fokIn[(string) $fid]);
                }
                $apply = array_keys(array_filter($ok, fn($v, $k) => $v && (string) ($cur[$k] ?? '') !== (string) $vals[$k], ARRAY_FILTER_USE_BOTH));
                $changed = $apply ? hrqApply($uid, $vals, $apply, $u) : [];
                foreach ($files as [$fid, $meta]) {
                    if (!empty($fok[(string) $fid])) {
                        $k = hrqKeepFile($uid, $id, (string) $fid, $meta, $u);
                        if ($k) {
                            $kept[] = $k;
                        }
                    }
                }
                if ($kept && ($b['comp'] ?? true) !== false) {
                    $comp = hrqCompDates($uid, $kept);
                }
                foreach ($files as [$fid]) {
                    hrqDropFile($id, (string) $fid);
                }
                // what counts is what changed and the files: a confirmation with nothing changed is simply approved
                $diffKeys = array_values(array_filter($keys, fn($k) => (string) ($cur[$k] ?? '') !== (string) $vals[$k]));
                $nOk = count(array_filter($diffKeys, fn($k) => !empty($ok[$k]))) + count(array_filter($fok));
                $nAll = count($diffKeys) + count($fok);
                $q->st = $act === 'reject' ? 'rejected' : ($nAll === 0 || $nOk === $nAll ? 'approved' : ($nOk === 0 ? 'rejected' : 'partial'));
                $q->rev = (object) ['at' => now(), 'by' => (string) $u['id'], 'byn' => (string) $u['name'], 'msg' => $msg, 'act' => $act, 'ok' => (object) $ok, 'fok' => (object) $fok];
                hrqLog($q, (string) $u['name'], HRQ_ST[$q->st] . ($changed ? ': ' . implode(', ', $changed) . ' updated' : '') . ($kept ? '; ' . count($kept) . ' ' . (count($kept) === 1 ? 'document' : 'documents') . ' added to their Documents' : '') . ($comp ? '; compliance dates: ' . implode(', ', $comp) : '') . ($msg !== '' ? ' · ' . mb_substr($msg, 0, 160) : ''));
            }
            $q->u = now();
            docSet("hrms/main/hrq/$id", $q);
            $first = explode(' ', trim((string) ($q->n ?? '')))[0] ?? '';
            $outcome = ['returned' => 'HR sent your update back for changes', 'approved' => 'HR approved your update', 'partial' => 'HR approved part of your update', 'rejected' => 'HR declined your update'][$q->st];
            hrqTask([$uid], $outcome, ($msg !== '' ? 'From HR: ' . $msg . "\n" : '') . 'Open it: ' . hrqPortalLink($id), (string) $u['id']);
            hrqMail($uid, $outcome, array_values(array_filter(['Hi ' . $first . ',', $outcome . ' (' . hrqWhat($q) . ').', $msg !== '' ? 'HR wrote: "' . $msg . '"' : '', $q->st === 'returned' ? 'Open the request, make the changes and send it again.' : ''])), 'Open the request', hrqPortalLink($id), (string) $u['email']);
            audit('data', 'Profile update request ' . $q->st, "hrms/main/hrq/$id", ['uid' => $uid, 'changed' => $changed, 'files' => count($kept)], $u);
            ok(['st' => $q->st, 'changed' => $changed, 'kept' => count($kept), 'comp' => $comp]);
        }
        case 'hrq_remind': {
            $u = hrqStaff();
            $id = hrqId($b['id'] ?? '');
            $q = $id !== '' ? docGet("hrms/main/hrq/$id") : null;
            if (!$q || !in_array((string) ($q->st ?? ''), ['open', 'returned'], true)) {
                fail(404, 'not_found', 'Only a request waiting for the person can be reminded.');
            }
            if (throttleHit('hrqrem:' . $id, 1, 12 * 3600)) {
                fail(429, 'rate_limited', 'A reminder went out in the last 12 hours.');
            }
            hrqTask([(string) $q->uid], 'Reminder: update your details for HR', hrqWhat($q) . "\nOpen it: " . hrqPortalLink($id), (string) $u['id']);
            hrqMail((string) $q->uid, 'Reminder: HR needs your details', ['Hi ' . (explode(' ', trim((string) ($q->n ?? '')))[0] ?? '') . ',', (string) $u['name'] . ' from HR is waiting for: ' . hrqWhat($q) . '.', (string) ($q->due ?? '') !== '' ? 'It is due ' . date('F j', (int) strtotime((string) $q->due)) . '.' : ''], 'Open the request', hrqPortalLink($id), (string) $u['email']);
            hrqLog($q, (string) $u['name'], 'Reminded');
            $q->u = now();
            docSet("hrms/main/hrq/$id", $q);
            ok(['ok' => true]);
        }
        case 'hrq_cancel': {
            $u = requireUser();
            $id = hrqId($b['id'] ?? '');
            $q = $id !== '' ? docGet("hrms/main/hrq/$id") : null;
            if (!$q) {
                fail(404, 'not_found', 'That request is no longer there.');
            }
            $own = (string) $q->uid === $u['id'] && (string) ($q->origin ?? '') === 'self';
            if (!$own) {
                hrqStaff();
            }
            if (!in_array((string) ($q->st ?? ''), ['open', 'returned', 'submitted'], true)) {
                fail(409, 'conflict', 'A decided request cannot be cancelled.');
            }
            $q->st = 'cancelled';
            $q->u = now();
            hrqLog($q, (string) $u['name'], 'Cancelled');
            docSet("hrms/main/hrq/$id", $q);
            foreach (colAll("hrms/main/hrq/$id/f") as [$fid]) {
                hrqDropFile($id, (string) $fid);
            }
            if (!$own) {
                audit('data', 'Profile update request cancelled', "hrms/main/hrq/$id", ['uid' => (string) $q->uid], $u);
            }
            ok(['ok' => true]);
        }
        case 'hrq_expiring': {
            // documents in people's files that expire within 60 days or have expired (the newest of each kind)
            hrqStaff();
            $out = [];
            $soon = date('Y-m-d', time() + 60 * 86400);
            $s = db()->prepare("SELECT path, data FROM docs WHERE col LIKE 'u/%/f' AND data LIKE ?");
            $s->execute(['%"exp"%']);
            foreach ($s->fetchAll() as $row) {
                $d = json_decode((string) $row['data']);
                if (!($d instanceof stdClass) || empty($d->exp) || !empty($d->rep) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $d->exp) || (string) $d->exp > $soon) {
                    continue;
                }
                $parts = explode('/', (string) $row['path']);
                $uid = $parts[1] ?? '';
                $ur = userRow($uid);
                if (!$ur || (string) $ur['status'] !== 'active') {
                    continue;
                }
                $out[] = ['uid' => $uid, 'n' => (string) $ur['name'], 'fid' => (string) end($parts), 'fn' => (string) ($d->n ?? ''), 'k' => (string) ($d->c ?? ''), 'kn' => HRQ_DOCS[(string) ($d->c ?? '')]['n'] ?? 'Document', 'exp' => (string) $d->exp, 'late' => (string) $d->exp < date('Y-m-d')];
            }
            usort($out, fn($a, $b2) => strcmp($a['exp'], $b2['exp']));
            ok(['rows' => array_slice($out, 0, 300)]);
        }
        /* ---------- the person ---------- */
        case 'hrq_mine': {
            $u = requireUser();
            $rows = [];
            $cur = null;
            foreach (colAll('hrms/main/hrq') as [$id, $q]) {
                if ((string) ($q->uid ?? '') !== $u['id']) {
                    continue;
                }
                $st = (string) ($q->st ?? 'open');
                if ($st === 'cancelled' || (!in_array($st, ['open', 'returned', 'submitted'], true) && (int) ($q->u ?? 0) < now() - 60 * 86400000)) {
                    continue;
                }
                $cur = $cur ?? hrqCur($u['id']);
                $rows[] = hrqMineOut((string) $id, $q, in_array($st, ['open', 'returned'], true) ? array_intersect_key($cur, array_flip(array_merge(hrqKeysOf((array) ($q->secs ?? [])), ['_emg']))) : null);
            }
            usort($rows, fn($a, $b2) => (int) in_array($b2['st'], ['open', 'returned'], true) <=> (int) in_array($a['st'], ['open', 'returned'], true) ?: $b2['at'] <=> $a['at']);
            ok(['rows' => $rows]);
        }
        case 'hrq_self': {
            // asking HR to change details only HR may change (and sending documents with it)
            $u = requireUser();
            if (portalOf($u['id']) === 'employer') {
                fail(403, 'forbidden', 'Client contacts keep their details on their profile.');
            }
            if (throttleHit('hrqself:' . $u['id'], 6, 86400)) {
                fail(429, 'rate_limited', 'You have sent several requests today. HR will get to them; try again tomorrow.');
            }
            $secs = array_values(array_intersect(array_keys(HRQ_SECS), array_map('strval', is_array($b['secs'] ?? null) ? $b['secs'] : [])));
            $docs = [];
            foreach (array_slice(is_array($b['docs'] ?? null) ? $b['docs'] : [], 0, 10) as $k) {
                $k = (string) $k;
                if (isset(HRQ_DOCS[$k]) && !in_array($k, array_column($docs, 'k'), true)) {
                    $docs[] = (object) ['k' => $k, 'exp' => !empty(HRQ_DOCS[$k]['exp']), 'note' => ''];
                }
            }
            if (!$secs && !$docs) {
                fail(400, 'invalid_argument', 'Choose what you want to update.');
            }
            $open = 0;
            foreach (colAll('hrms/main/hrq') as [, $q]) {
                $open += (string) ($q->uid ?? '') === $u['id'] && (string) ($q->origin ?? '') === 'self' && in_array((string) ($q->st ?? ''), ['open', 'returned', 'submitted'], true) ? 1 : 0;
            }
            if ($open >= 3) {
                fail(400, 'invalid_argument', 'You have 3 updates waiting already. Finish or cancel one first.');
            }
            $id = rid(6);
            $q = (object) ['uid' => $u['id'], 'n' => (string) $u['name'], 'origin' => 'self', 'secs' => $secs, 'docs' => $docs, 'note' => '', 'due' => '', 'st' => 'open', 'at' => now(), 'u' => now(), 'by' => $u['id'], 'byn' => (string) $u['name'], 'log' => []];
            hrqLog($q, (string) $u['name'], 'Started an update: ' . hrqWhat($q));
            docSet("hrms/main/hrq/$id", $q);
            ok(['id' => $id, 'q' => hrqMineOut($id, $q, array_intersect_key(hrqCur($u['id']), array_flip(array_merge(hrqKeysOf($secs), ['_emg']))))]);
        }
        case 'hrq_upload': {
            $u = requireUser();
            $id = hrqId($_POST['id'] ?? '');
            $q = $id !== '' ? docGet("hrms/main/hrq/$id") : null;
            if (!$q || (string) $q->uid !== $u['id']) {
                fail(404, 'not_found', 'That request is no longer there.');
            }
            if (!in_array((string) ($q->st ?? ''), ['open', 'returned'], true)) {
                fail(409, 'conflict', 'This request was already sent to HR.');
            }
            if (throttleHit('hrqup:' . $u['id'], 60, 3600)) {
                fail(429, 'rate_limited', 'That is a lot of uploads in an hour. Try again a little later.');
            }
            $k = (string) ($_POST['k'] ?? '');
            if (!in_array($k, array_map(fn($d) => (string) ($d->k ?? ''), (array) ($q->docs ?? [])), true)) {
                fail(400, 'invalid_argument', 'HR did not ask for that kind of document in this request.');
            }
            if (count(colAll("hrms/main/hrq/$id/f")) >= HRQ_MAX_FILES) {
                fail(400, 'invalid_argument', 'A request can carry ' . HRQ_MAX_FILES . ' files. Remove one first.');
            }
            if (!isset($_FILES['file'])) {
                fail(400, 'invalid_argument', 'No file received.');
            }
            $exp = (string) ($_POST['exp'] ?? '');
            $exp = preg_match('/^\d{4}-\d{2}-\d{2}$/', $exp) && strtotime($exp) ? $exp : '';
            $doc = storeUpload($_FILES['file'], "hrms/main/hrq/$id", ['c' => $k]);
            if ($exp !== '') {
                $m = docGet("hrms/main/hrq/$id/f/" . $doc['id']);
                $m->exp = $exp;
                docSet("hrms/main/hrq/$id/f/" . $doc['id'], $m);
            }
            ok(['file' => ['id' => $doc['id'], 'n' => $doc['n'], 'k' => $k, 'exp' => $exp, 'sz' => $doc['sz']]]);
        }
        case 'hrq_unfile': {
            $u = requireUser();
            $id = hrqId($b['id'] ?? '');
            $q = $id !== '' ? docGet("hrms/main/hrq/$id") : null;
            if (!$q || (string) $q->uid !== $u['id'] || !in_array((string) ($q->st ?? ''), ['open', 'returned'], true)) {
                fail(404, 'not_found', 'That file can no longer be removed.');
            }
            hrqDropFile($id, (string) ($b['fid'] ?? ''));
            ok(['ok' => true]);
        }
        case 'hrq_submit': {
            $u = requireUser();
            $id = hrqId($b['id'] ?? '');
            $q = $id !== '' ? docGet("hrms/main/hrq/$id") : null;
            if (!$q || (string) $q->uid !== $u['id']) {
                fail(404, 'not_found', 'That request is no longer there.');
            }
            if (!in_array((string) ($q->st ?? ''), ['open', 'returned'], true)) {
                fail(409, 'conflict', 'This request was already sent to HR.');
            }
            $in = is_array($b['vals'] ?? null) ? $b['vals'] : [];
            $vals = [];
            $errs = [];
            foreach (hrqKeysOf((array) ($q->secs ?? [])) as $k) {
                [$v, $e] = hrqClean($k, $in[$k] ?? '');
                $vals[$k] = $v;
                if ($e !== '') {
                    $errs[$k] = $e;
                }
            }
            $files = colAll("hrms/main/hrq/$id/f");
            foreach ((array) ($q->docs ?? []) as $d) {
                $k = (string) ($d->k ?? '');
                $have = array_values(array_filter($files, fn($f) => (string) ($f[1]->c ?? '') === $k));
                if (!$have) {
                    $errs['doc:' . $k] = 'Attach the ' . mb_strtolower(HRQ_DOCS[$k]['n'] ?? 'document') . '.';
                } elseif (!empty($d->exp) && array_filter($have, fn($f) => (string) ($f[1]->exp ?? '') === '')) {
                    $errs['doc:' . $k] = 'Add the expiry date of the ' . mb_strtolower(HRQ_DOCS[$k]['n'] ?? 'document') . '.';
                }
            }
            if ($errs) {
                fail(400, 'invalid_argument', reset($errs), ['errs' => $errs]);
            }
            $cur = hrqCur($u['id']);
            $diff = array_keys(array_filter($vals, fn($v, $k) => (string) ($cur[$k] ?? '') !== (string) $v, ARRAY_FILTER_USE_BOTH));
            $q->sub = (object) ['at' => now(), 'vals' => (object) $vals, 'msg' => str($b, 'msg', 1000), 'diff' => $diff];
            $q->st = 'submitted';
            $q->u = now();
            hrqLog($q, (string) $u['name'], 'Sent to HR: ' . ($diff ? count($diff) . ' ' . (count($diff) === 1 ? 'change' : 'changes') : 'no changes to the details') . ($files ? ', ' . count($files) . ' ' . (count($files) === 1 ? 'file' : 'files') : ''));
            docSet("hrms/main/hrq/$id", $q);
            $to = (string) ($q->origin ?? '') === 'hr' && (string) ($q->by ?? '') !== '' ? [(string) $q->by] : hrqHrPeople();
            $line = (string) $u['name'] . ' sent ' . ($diff ? count($diff) . ' ' . (count($diff) === 1 ? 'change' : 'changes') : 'their details') . ($files ? ' and ' . count($files) . ' ' . (count($files) === 1 ? 'file' : 'files') : '') . ' to review (' . hrqWhat($q) . ').';
            hrqTask($to, 'Review: ' . (string) $u['name'] . "'s profile update", $line . "\nReview it: " . hrqHrLink($id), (string) $u['id']);
            foreach ($to as $hid) {
                hrqMail($hid, 'Profile update to review: ' . (string) $u['name'], [$line, 'Every change shows next to what is on file; approve it field by field.'], 'Review it', hrqHrLink($id));
            }
            ok(['st' => 'submitted', 'changes' => count($diff)]);
        }
    }
    fail(404, 'not_found', 'Unknown action.');
}
