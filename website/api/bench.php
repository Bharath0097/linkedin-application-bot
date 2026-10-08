<?php
declare(strict_types=1);
/*
  v36: the Bench desk (routes bd_*): one connected workflow for recruiters and recruiting team, from a consultant on the
  bench to a requirement, the consultant's approval, a checked submission, interviews and a placement.

   - Ownership: an owner and a backup per consultant and per submission, with the history of changes.
   - Freshness (MR-01): availability, rate, location and work mode, work authorization and the resume each keep their
     own "last confirmed" date and source, with a window per field. The consultant confirms by a link (or in their
     portal) only what is due, or the recruiter records a confirmation. A changed rate flags the submissions still
     being prepared; a new resume never counts as a fresh availability.
   - Submissions (rec/sub/items) as one pipeline: shortlisted → waiting for the consultant's approval → ready →
     submitted → screening → interview → offer → placed (or rejected, withdrawn, closed with a reason), each with an
     owner, a next action, a history and the packet as it was sent.
   - Representation (RTR): the consultant reads the role, the vendor chain, the rate, the scope and how long it lasts,
     and approves with their typed name or declines; they also say whether anyone else already submitted them.
   - Conflicts (MR-04): before a submission is marked sent, the same consultant to the same requirement, the same
     requisition ID, or the same end client and role (within the window) stops it; a bench manager may send it anyway
     with a reason. When an end client is unknown, or roles are only similar, the recruiter confirms they checked.
     Similar titles under different requisition IDs are never treated as the same opening.
   - The consultant's own view (MR-10): their submissions in plain words (a packet being prepared is never shown as
     sent), approvals to give and details to confirm.
  Data: rec/cand/items (consultants), rec/sub/items (submissions), rec/x/bench (settings).
*/

const BD_STAGES = [
    'shortlisted' => 'Shortlisted',
    'approval' => 'Waiting for approval',
    'ready' => 'Ready to submit',
    'submitted' => 'Submitted',
    'screening' => 'Screening',
    'interview' => 'Interview',
    'offer' => 'Offer',
    'hold' => 'On hold',
    'placed' => 'Placed',
    'rejected' => 'Rejected',
    'withdrawn' => 'Withdrawn',
    'closed' => 'Closed',
];
const BD_PRE = ['shortlisted', 'approval', 'ready'];
const BD_DONE = ['placed', 'rejected', 'withdrawn', 'closed'];
const BD_FRESH = ['avail' => 'Availability', 'rate' => 'Rate', 'loc' => 'Location and work mode', 'auth' => 'Work authorization', 'resume' => 'Resume'];
// what the consultant reads for each stage (never "submitted" for a packet still being prepared)
const BD_MINE = [
    'shortlisted' => ['Being prepared', 'Your recruiter is preparing a submission. Nothing has been sent yet.'],
    'approval' => ['Needs your approval', 'Your recruiter asks for your approval before anything is sent.'],
    'ready' => ['Approved, not sent yet', 'You approved it; your recruiter sends it next.'],
    'submitted' => ['Submitted', 'Your profile was sent for this role.'],
    'screening' => ['Under review', 'The client or vendor is reviewing your profile.'],
    'interview' => ['Interview', 'An interview is set up or being arranged.'],
    'offer' => ['Offer', 'An offer is being discussed.'],
    'hold' => ['On hold', 'The client or vendor has paused this role or your submission for now. Your recruiter tells you when it moves.'],
    'placed' => ['Placed', 'You were selected for this role.'],
    'rejected' => ['Not selected', 'The client chose someone else for this role.'],
    'withdrawn' => ['Withdrawn', 'This submission was withdrawn.'],
    'closed' => ['Closed', 'The role was filled or cancelled.'],
];

function bdSettings(): array
{
    $d = docGet('rec/x/bench');
    $f = (array) ($d->fresh ?? []);
    $win = [];
    foreach (['avail' => 14, 'rate' => 30, 'loc' => 60, 'auth' => 90, 'resume' => 90] as $k => $def) {
        $win[$k] = max(1, min(365, (int) ($f[$k] ?? $def)));
    }
    return [
        'fresh' => $win,
        'conflictDays' => max(14, min(365, (int) ($d->conflictDays ?? 90))),
        'rtrDays' => max(7, min(180, (int) ($d->rtrDays ?? 30))),
        'push' => max(3, min(60, (int) ($d->push ?? 14))),
        'managers' => array_values(array_filter(array_map('strval', (array) ($d->managers ?? [])), fn($x) => (bool) preg_match('/^u_[a-f0-9]{8,32}$/', $x))),
    ];
}
/** Who may send a submission despite a confirmed conflict: administrators, HR, managers and the named bench managers. */
function bdIsManager(array $u): bool
{
    return hasRole($u, 'admin') || hasRole($u, 'hr') || hasRole($u, 'manager') || in_array((string) $u['id'], bdSettings()['managers'], true);
}
function bdStaff(): array
{
    $u = requireUser();
    if (!featureAllowed($u, 'recruiting', userLevel($u) >= 2 || isRecruiter((string) $u['id']) || isBench((string) $u['id']))) {
        fail(403, 'forbidden', 'The bench desk is for StratEdge staff, recruiters and recruiting team.');
    }
    return $u;
}
function bdCand(string $cid): ?stdClass
{
    return preg_match('/^[A-Za-z0-9_\-]{1,40}$/', $cid) ? docGet('rec/cand/items/' . $cid) : null;
}
function bdSub(string $sid): ?stdClass
{
    return preg_match('/^[A-Za-z0-9_\-]{1,40}$/', $sid) ? docGet('rec/sub/items/' . $sid) : null;
}
/** A company name reduced to what identifies it ("Bank of America, N.A." and "bank of america" are the same). */
function bdNorm(string $s): string
{
    $s = mb_strtolower($s);
    $s = preg_replace('/\b(?:inc|llc|ltd|llp|corp|corporation|co|company|the|na|n\.a|group|holdings|limited|plc|pvt|private)\b\.?/u', ' ', $s) ?? $s;
    return trim(preg_replace('/[^a-z0-9]+/', ' ', $s) ?? '');
}
function bdRef(string $s): string
{
    return strtolower(preg_replace('/[^A-Za-z0-9]+/', '', $s) ?? '');
}
/** The words of a role title that carry meaning (seniority, work mode and filler dropped). */
function bdRoleWords(string $t): array
{
    $t = mb_strtolower(preg_replace('/\s*[(\[].*$/', '', $t) ?? $t);
    $w = array_map(fn($x) => rtrim($x, '.'), preg_split('/[^a-z0-9+#.]+/', $t) ?: []);
    $drop = ['sr', 'senior', 'jr', 'junior', 'lead', 'the', 'and', 'for', 'with', 'ii', 'iii', 'iv', 'remote', 'onsite', 'hybrid', 'contract', 'c2c', 'w2', 'c2h', 'fte', 'local', 'only', 'urgent', 'need', 'needed', 'role', 'position', 'opening'];
    return array_values(array_unique(array_filter($w, fn($x) => strlen($x) > 1 && !in_array($x, $drop, true) && !preg_match('/^\d+$/', $x))));
}
/** 2 = the same role, 1 = a similar role, 0 = different. */
function bdRoleSim(string $a, string $b): int
{
    $x = bdRoleWords($a);
    $y = bdRoleWords($b);
    if (!$x || !$y) {
        return 0;
    }
    sort($x);
    sort($y);
    if ($x === $y) {
        return 2;
    }
    return count(array_intersect($x, $y)) / max(1, min(count($x), count($y))) >= 0.67 ? 1 : 0;
}

/* ---------- freshness ---------- */
/** Each critical field's state: fresh | soon | stale | missing, with when it was last confirmed and how. */
function bdFresh(stdClass $c, ?array $set = null): array
{
    $set = $set ?? bdSettings();
    $have = [
        'avail' => trim((string) ($c->avail ?? '')) !== '' || trim((string) ($c->availDate ?? '')) !== '',
        'rate' => trim((string) ($c->rate ?? '')) !== '',
        'loc' => trim((string) ($c->loc ?? '')) !== '',
        'auth' => trim((string) ($c->auth ?? '')) !== '',
        'resume' => trim((string) ($c->rid ?? '')) !== '',
    ];
    $fr = isset($c->fresh) && $c->fresh instanceof stdClass ? $c->fresh : new stdClass();
    $out = [];
    foreach (BD_FRESH as $k => $label) {
        $e = isset($fr->$k) && $fr->$k instanceof stdClass ? $fr->$k : null;
        // without a recorded confirmation, the date the record (or the resume) was added
        $at = (int) ($e->at ?? ($k === 'resume' ? ($c->rAt ?? ($c->at ?? 0)) : ($c->at ?? 0)));
        $left = (int) floor(($at + $set['fresh'][$k] * 86400000 - now()) / 86400000);
        $st = !$have[$k] ? 'missing' : ($left < 0 ? 'stale' : ($left <= 3 ? 'soon' : 'fresh'));
        $out[$k] = ['label' => $label, 'st' => $st, 'at' => $at, 'left' => $left, 'how' => (string) ($e->how ?? 'entered'), 'by' => (string) ($e->byn ?? '')];
    }
    return $out;
}
/** Marks fields confirmed now. $how: consultant | recruiter | changed | uploaded. */
function bdConfirmFields(stdClass $c, array $fields, string $how, string $byn): void
{
    if (!isset($c->fresh) || !($c->fresh instanceof stdClass)) {
        $c->fresh = new stdClass();
    }
    foreach ($fields as $f) {
        if (isset(BD_FRESH[$f])) {
            $c->fresh->$f = (object) ['at' => now(), 'how' => $how, 'byn' => mb_substr($byn, 0, 80)];
        }
    }
}

/* ---------- conflicts ---------- */
/** Earlier submissions of the same consultant this one would repeat. kind: confirmed | possible | info.
 *  confirmed: the same requirement, the same requisition ID, or the same end client and the same role;
 *  possible:  the same end client and a similar role, or a similar role where an end client is not known;
 *  info:      the same end client for another role or another requisition ID. */
function bdConflicts(stdClass $s, string $sid = ''): array
{
    $set = bdSettings();
    $since = now() - $set['conflictDays'] * 86400000;
    $cand = !empty($s->cid) ? bdCand((string) $s->cid) : null;
    $email = mb_strtolower(trim((string) ($cand->e ?? ($s->ce ?? ''))));
    $nameKey = bdNorm((string) ($s->cn ?? ''));
    $ec = bdNorm((string) ($s->ec ?? ''));
    $ext = bdRef((string) ($s->ext ?? ''));
    $role = (string) ($s->req ?? '');
    $emails = [];
    $out = [];
    foreach (colAll('rec/sub/items') as [$id, $o]) {
        if ((string) $id === $sid || (string) ($o->st ?? '') === 'withdrawn') {
            continue;
        }
        $when = (int) ($o->at ?? 0) ?: ((strtotime((string) ($o->d ?? '')) ?: 0) * 1000);
        if ($when < $since) {
            continue;
        }
        $oe = mb_strtolower(trim((string) ($o->ce ?? '')));
        if ($oe === '' && !empty($o->cid)) {
            $oe = $emails[(string) $o->cid] ??= mb_strtolower(trim((string) (bdCand((string) $o->cid)->e ?? '')));
        }
        $same = (!empty($s->cid) && (string) ($o->cid ?? '') === (string) $s->cid)
            || ($email !== '' && $oe === $email)
            || ($nameKey !== '' && (empty($s->cid) || empty($o->cid)) && bdNorm((string) ($o->cn ?? '')) === $nameKey);
        if (!$same) {
            continue;
        }
        $oec = bdNorm((string) ($o->ec ?? ''));
        $oext = bdRef((string) ($o->ext ?? ''));
        $sim = bdRoleSim($role, (string) ($o->req ?? ''));
        [$kind, $why] = ['', ''];
        if (!empty($s->vreq) && (string) ($o->vreq ?? '') === (string) $s->vreq) {
            [$kind, $why] = ['confirmed', 'the same requirement'];
        } elseif ($ext !== '' && $ext === $oext) {
            [$kind, $why] = ['confirmed', 'the same requisition ID (' . trim((string) $s->ext) . ')'];
        } elseif ($ext !== '' && $oext !== '') {
            // two different requisition IDs are two openings, however alike the titles
            if ($ec !== '' && $ec === $oec) {
                [$kind, $why] = ['info', 'the same end client, another requisition (' . trim((string) $o->ext) . ')'];
            }
        } elseif ($ec !== '' && $ec === $oec) {
            [$kind, $why] = $sim === 2 ? ['confirmed', 'the same end client and role'] : ($sim === 1 ? ['possible', 'the same end client and a similar role'] : ['info', 'the same end client, another role']);
        } elseif (($ec === '' || $oec === '') && $sim >= 1) {
            [$kind, $why] = ['possible', $ec === '' ? 'a similar role, and this one’s end client is not known' : 'a similar role whose end client was not recorded'];
        }
        if ($kind === '') {
            continue;
        }
        $out[] = ['sid' => (string) $id, 'kind' => $kind, 'why' => $why, 'cn' => (string) ($o->cn ?? ''), 'req' => (string) ($o->req ?? ''), 'vn' => (string) ($o->vn ?? ''), 'ec' => (string) ($o->ec ?? ''), 'ext' => (string) ($o->ext ?? ''), 'd' => (string) ($o->d ?? ''), 'st' => (string) ($o->st ?? ''), 'rtr' => !empty($o->rtr), 'byn' => (string) (($o->ownn ?? '') ?: ($o->byn ?? ''))];
    }
    $rank = ['confirmed' => 0, 'possible' => 1, 'info' => 2];
    usort($out, fn($a, $b) => $rank[$a['kind']] <=> $rank[$b['kind']] ?: strcmp($b['d'], $a['d']));
    return $out;
}
/** The check before a submission goes out: stops on a confirmed conflict (a manager may send it anyway with a reason)
 *  and asks the recruiter to confirm they checked an uncertain one. Returns the history lines to keep. */
function bdSendCheck(stdClass $s, string $sid, array $u, array $b): array
{
    $conf = bdConflicts($s, $sid);
    $hard = array_values(array_filter($conf, fn($x) => $x['kind'] === 'confirmed'));
    $soft = array_values(array_filter($conf, fn($x) => $x['kind'] === 'possible'));
    $lines = [];
    $mgr = bdIsManager($u);
    if ($hard) {
        $why = str($b, 'override', 300);
        if ($why === '' || !$mgr) {
            $c0 = $hard[0];
            fail(409, 'conflict', 'This repeats an earlier submission (' . $c0['why'] . ': ' . $c0['cn'] . ' to ' . ($c0['vn'] !== '' ? $c0['vn'] : 'a vendor') . ($c0['d'] !== '' ? ' on ' . $c0['d'] : '') . '). ' . ($mgr ? 'Give a reason to send it anyway.' : 'A bench manager can send it anyway with a reason.'), ['conflicts' => $conf, 'manager' => $mgr]);
        }
        $s->ovr = (object) ['by' => (string) $u['name'], 'at' => now(), 'why' => $why, 'sids' => array_map(fn($x) => $x['sid'], $hard)];
        $lines[] = 'Sent despite an earlier submission (' . $hard[0]['why'] . '): ' . $why;
    }
    if ($soft) {
        if (str($b, 'ack', 5) !== '1') {
            fail(409, 'check', 'Check the earlier submission' . (count($soft) > 1 ? 's' : '') . ' first: ' . $soft[0]['why'] . ' (' . $soft[0]['req'] . ' to ' . ($soft[0]['vn'] !== '' ? $soft[0]['vn'] : 'a vendor') . ($soft[0]['d'] !== '' ? ' on ' . $soft[0]['d'] : '') . ').', ['conflicts' => $conf, 'manager' => $mgr]);
        }
        $s->ack = (object) ['by' => (string) $u['name'], 'at' => now(), 'sids' => array_map(fn($x) => $x['sid'], $soft)];
        $lines[] = 'Checked: a different opening from the similar earlier submission' . (count($soft) > 1 ? 's' : '');
    }
    return $lines;
}

/* ---------- small helpers ---------- */
function bdHist(stdClass $s, string $byn, string $ev): void
{
    $h = (array) ($s->hist ?? []);
    $h[] = (object) ['t' => now(), 'by' => mb_substr($byn, 0, 80), 'ev' => mb_substr($ev, 0, 400)];
    $s->hist = array_slice($h, -80);
}
/** A link token: [the token for the link, its hash for the record]. */
function bdToken(string $id): array
{
    $raw = rid(12);
    return [$id . '.' . $raw, hash('sha256', $raw)];
}
function bdTokenParts(string $t): array
{
    return preg_match('/^([A-Za-z0-9_\-]{1,40})\.([a-f0-9]{24})$/', $t, $m) ? [$m[1], hash('sha256', $m[2])] : ['', ''];
}
function bdFirst(string $n): string
{
    $p = preg_split('/\s+/', trim($n)) ?: [''];
    return trim((string) $p[0]) ?: 'there';
}
/** Consultant records that belong to a portal account (linked to it, or under the same email). */
function bdMine(array $u): array
{
    $email = mb_strtolower((string) $u['email']);
    $out = [];
    foreach (colAll('rec/cand/items') as [$id, $c]) {
        if ((string) ($c->uid ?? '') === (string) $u['id'] || ($email !== '' && mb_strtolower(trim((string) ($c->e ?? ''))) === $email)) {
            $out[(string) $id] = $c;
        }
    }
    return $out;
}
/** What a submission is for, as the consultant reads it: role, the vendor chain, location, work mode, duration. */
function bdReqInfo(stdClass $s): array
{
    $out = ['role' => (string) ($s->req ?? ''), 'client' => (string) ($s->ec ?? ''), 'vendor' => (string) ($s->vn ?? ''), 'prime' => '', 'loc' => '', 'md' => '', 'dur' => '', 'ty' => ''];
    if (!empty($s->vreq)) {
        require_once __DIR__ . '/vms.php';
        $r = vmsReqGet((string) $s->vreq);
        if ($r) {
            $out['role'] = $out['role'] !== '' ? $out['role'] : (string) ($r['ti'] ?? '');
            $out['loc'] = (string) ($r['loc'] ?? '');
            $out['md'] = (string) ($r['md'] ?? '');
            $out['dur'] = (string) ($r['dur'] ?? '');
            $out['ty'] = (string) ($r['ty'] ?? '');
            $cl = (string) ($r['cl'] ?? '');
            if ($cl !== '' && bdNorm($cl) !== bdNorm($out['vendor']) && bdNorm($cl) !== bdNorm($out['client'])) {
                $out['prime'] = $cl;
            }
            if ($out['client'] === '') {
                $out['client'] = (string) ($r['ec'] ?? '');
            }
        }
    }
    return $out;
}
function bdChain(array $info): string
{
    return implode(' → ', array_values(array_filter([$info['vendor'], $info['prime'], $info['client'] !== '' ? $info['client'] . ' (end client)' : ''])));
}
function bdNotifyOwner(stdClass $o, string $subject, array $paras): void
{
    try {
        $own = (string) ($o->own ?? '') ?: (string) ($o->by ?? '');
        $ur = $own !== '' ? userRow($own) : null;
        if ($ur && filter_var((string) $ur['email'], FILTER_VALIDATE_EMAIL)) {
            sendMail((string) $ur['email'], (string) $ur['name'], $subject, implode("\n\n", $paras), emailHtml($subject, $paras, ['Open the bench desk', siteUrl() . '#/portal/rec/bench']));
        }
    } catch (Throwable $e) {
        // the change is saved either way
    }
}
/** The packet as it goes out: kept with the submission so later changes never rewrite what was sent. */
/** v68: the one-line healthcare summary (the same line the pages draw). */
function bdHcLine(?object $hc): string
{
    if (!$hc) {
        return '';
    }
    $fac = (string) ($hc->fac ?? '') !== '' ? $hc->fac . ((string) ($hc->ftype ?? '') !== '' ? ' (' . $hc->ftype . ')' : '') : (string) ($hc->ftype ?? '');
    return implode(' · ', array_filter([(string) ($hc->disc ?? ''), (string) ($hc->spec ?? ''), $fac, (string) ($hc->atype ?? ''), (string) ($hc->shift ?? ''), (string) ($hc->hrs ?? '') !== '' ? $hc->hrs . ' h/wk' : '', (string) ($hc->len ?? '') !== '' ? $hc->len . ' wks' : '', (string) ($hc->start ?? '') !== '' ? 'from ' . $hc->start : ''], fn($x) => $x !== ''));
}
function bdPacket(stdClass $s, array $u): object
{
    $c = !empty($s->cid) ? bdCand((string) $s->cid) : null;
    $q = $s->rtr2 ?? null;
    return (object) [
        'at' => now(), 'by' => (string) $u['name'],
        'rate' => (string) ($s->rate ?? ''), 'vn' => (string) ($s->vn ?? ''), 'ec' => (string) ($s->ec ?? ''), 'ext' => (string) ($s->ext ?? ''),
        'hc' => (($s->lob ?? '') === 'hc' && isset($s->hc)) ? $s->hc : null, // v68: the healthcare details as sent
        // v45.4: the resume added to the submission itself comes first (it is the one that went out)
        'resume' => isset($s->rs->fid) ? (object) ['id' => (string) $s->rs->fid, 'n' => (string) ($s->rs->n ?? ''), 'sub' => true] : (isset($s->tl->fid) ? (object) ['id' => (string) $s->tl->fid, 'n' => (string) ($s->tl->n ?? ''), 'tailored' => true] : ($c && !empty($c->rid) ? (object) ['id' => (string) $c->rid, 'n' => (string) ($c->rn ?? '')] : null)),
        'rtr' => $q ? (object) ['st' => (string) ($q->st ?? ''), 'scope' => (string) ($q->scope ?? ''), 'until' => (string) ($q->until ?? ''), 'rate' => (string) ($q->rate ?? ''), 'name' => (string) ($q->ans->name ?? ''), 'at' => (int) ($q->ans->at ?? ($q->at ?? 0)), 'via' => (string) ($q->ans->via ?? ($q->via ?? ''))] : (!empty($s->rtr) ? (object) ['st' => 'approved', 'via' => 'recorded', 'day' => (string) ($s->rtrAt ?? '')] : null),
        'hc' => isset($s->hc) && $s->hc instanceof stdClass ? $s->hc : null,
    ];
}
function bdOwnerOk(stdClass $o, array $u): bool
{
    $id = (string) $u['id'];
    return in_array($id, [(string) ($o->own ?? ''), (string) ($o->bk ?? ''), (string) ($o->by ?? '')], true) || bdIsManager($u);
}

/* ---------- routes ---------- */
function bdRoute(string $r, array $b): never
{
    // the links in emails (no account needed)
    if (in_array($r, ['bd_rtr_get', 'bd_rtr_answer', 'bd_confirm_get', 'bd_confirm_answer'], true)) {
        bdPublic($r, $b);
    }
    // the consultant's own page
    if (in_array($r, ['bd_my', 'bd_my_rtr', 'bd_my_confirm'], true)) {
        bdSelf($r, $b, requireUser());
    }
    $u = bdStaff();
    $set = bdSettings();
    switch ($r) {
        case 'bd_boot':
            // the team a consultant or submission can be given to, and the settings
            $people = [];
            foreach (db()->query("SELECT id, name, email, role, status, access FROM users WHERE status = 'active' ORDER BY name LIMIT 800")->fetchAll() as $row) {
                $id = (string) $row['id'];
                if (userLevel($row) >= 2 || isRecruiter($id) || isBench($id)) {
                    $people[] = ['id' => $id, 'n' => (string) $row['name']];
                }
            }
            ok(['me' => (string) $u['id'], 'manager' => bdIsManager($u), 'admin' => hasRole($u, 'admin'), 'people' => $people, 'set' => $set, 'stages' => BD_STAGES, 'mine' => BD_MINE]);
        case 'bd_settings_save':
            if (!bdIsManager($u)) {
                fail(403, 'forbidden', 'Bench managers and administrators change these.');
            }
            $d = docGet('rec/x/bench') ?? new stdClass();
            $fr = (array) ($b['fresh'] ?? []);
            $win = new stdClass();
            foreach (array_keys(BD_FRESH) as $k) {
                $win->$k = max(1, min(365, (int) ($fr[$k] ?? $set['fresh'][$k])));
            }
            $d->fresh = $win;
            $d->conflictDays = max(14, min(365, (int) ($b['conflictDays'] ?? $set['conflictDays'])));
            $d->rtrDays = max(7, min(180, (int) ($b['rtrDays'] ?? $set['rtrDays'])));
            $d->push = max(3, min(60, (int) ($b['push'] ?? $set['push'])));
            if (hasRole($u, 'admin') && isset($b['managers'])) {
                $d->managers = array_values(array_filter(array_map('strval', (array) $b['managers']), fn($x) => (bool) preg_match('/^u_[a-f0-9]{8,32}$/', $x)));
            }
            docSet('rec/x/bench', $d);
            audit('settings', 'Bench desk settings changed', 'bench', ['by' => $u['name']], $u);
            ok(['set' => bdSettings()]);
        case 'bd_own':
            // the owner and backup of a consultant or a submission (the current owner, the backup or a manager)
            $kind = str($b, 'kind', 4) === 'sub' ? 'sub' : 'cand';
            $id = str($b, 'id', 40);
            $o = $kind === 'sub' ? bdSub($id) : bdCand($id);
            if (!$o) {
                fail(404, 'not_found', 'That record is no longer there.');
            }
            if (!bdOwnerOk($o, $u)) {
                fail(403, 'forbidden', 'Only the owner, the backup or a bench manager changes who looks after this.');
            }
            $own = str($b, 'own', 40);
            $bk = str($b, 'bk', 40);
            if ($own === '') {
                fail(400, 'invalid_argument', 'Pick the owner.');
            }
            $names = [];
            foreach (array_filter([$own, $bk]) as $x) {
                $row = userRow($x);
                if (!$row || (string) $row['status'] !== 'active') {
                    fail(400, 'invalid_argument', 'Pick someone from the team.');
                }
                $names[$x] = (string) $row['name'];
            }
            $hist = (array) ($o->owh ?? []);
            $hist[] = (object) ['t' => now(), 'by' => (string) $u['name'], 'from' => (string) (($o->ownn ?? '') ?: ($o->byn ?? '')), 'to' => $names[$own] ?? '', 'bk' => $names[$bk] ?? '', 'note' => str($b, 'note', 300)];
            $o->own = $own;
            $o->ownn = $names[$own] ?? '';
            $o->bk = $bk;
            $o->bkn = $names[$bk] ?? '';
            $o->owh = array_slice($hist, -30);
            $o->u = now();
            $o->un = (string) $u['name'];
            if ($kind === 'sub') {
                bdHist($o, (string) $u['name'], 'Owner: ' . ($names[$own] ?? '') . ($bk !== '' ? ', backup: ' . $names[$bk] : ''));
            }
            docSet(($kind === 'sub' ? 'rec/sub/items/' : 'rec/cand/items/') . $id, $o);
            ok(['ok' => true]);
        case 'bd_bench':
            // on the bench (available), paused with a reason, placed or not marketed; the bench date
            $cid = str($b, 'cid', 40);
            $c = bdCand($cid);
            if (!$c) {
                fail(404, 'not_found', 'That consultant is no longer in the database.');
            }
            $st = str($b, 'st', 12);
            if (!in_array($st, ['active', 'working', 'hold', 'placed', 'inactive'], true)) {
                fail(400, 'invalid_argument', 'Unknown status.');
            }
            if ($st === 'hold' && str($b, 'why', 200) === '') {
                fail(400, 'invalid_argument', 'Say why marketing is paused.');
            }
            $since = str($b, 'since', 10);
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $since)) {
                $c->benchSince = $since;
            } elseif (in_array($st, ['active', 'working'], true) && !in_array((string) ($c->st ?? ''), ['active', 'working', 'hold'], true)) {
                $c->benchSince = date('Y-m-d');
            }
            $c->st = $st;
            $c->why = $st === 'hold' ? str($b, 'why', 200) : '';
            $c->u = now();
            $c->un = (string) $u['name'];
            docSet('rec/cand/items/' . $cid, $c);
            ok(['ok' => true]);
        case 'bd_fresh':
            // the recruiter confirmed fields with the consultant (by phone, email or in person)
            $cid = str($b, 'cid', 40);
            $c = bdCand($cid);
            if (!$c) {
                fail(404, 'not_found', 'That consultant is no longer in the database.');
            }
            $fields = array_values(array_filter(array_map('strval', (array) ($b['fields'] ?? [])), fn($k) => isset(BD_FRESH[$k])));
            if (!$fields) {
                fail(400, 'invalid_argument', 'Pick what you confirmed.');
            }
            bdConfirmFields($c, $fields, 'recruiter', (string) $u['name']);
            $c->u = now();
            docSet('rec/cand/items/' . $cid, $c);
            ok(['fresh' => bdFresh($c, $set)]);
        case 'bd_confirm_send':
            // a link for the consultant to confirm (or correct) the details that are due
            $cid = str($b, 'cid', 40);
            $c = bdCand($cid);
            if (!$c) {
                fail(404, 'not_found', 'That consultant is no longer in the database.');
            }
            if (!filter_var(trim((string) ($c->e ?? '')), FILTER_VALIDATE_EMAIL)) {
                fail(400, 'invalid_argument', 'Add the consultant’s email first.');
            }
            if (throttleHit('bdconf:' . $cid, 3, 86400)) {
                fail(429, 'rate_limited', 'This consultant was already asked three times today.');
            }
            $fresh = bdFresh($c, $set);
            $ask = ['avail', 'rate', 'loc', 'auth'];
            $fields = array_values(array_filter(array_map('strval', (array) ($b['fields'] ?? [])), fn($k) => in_array($k, $ask, true)));
            if (!$fields) {
                $fields = array_values(array_filter($ask, fn($k) => $fresh[$k]['st'] !== 'fresh'));
            }
            if (!$fields) {
                $fields = ['avail'];
            }
            [$tok, $hash] = bdToken($cid);
            $c->conf = (object) ['h' => $hash, 'exp' => now() + 14 * 86400000, 'at' => now(), 'by' => (string) $u['name'], 'fields' => $fields, 'st' => 'sent'];
            docSet('rec/cand/items/' . $cid, $c);
            $link = siteUrl() . '#/my-details?t=' . rawurlencode($tok);
            $what = implode(', ', array_map(fn($k) => mb_strtolower(BD_FRESH[$k]), $fields));
            $paras = ['Hi ' . bdFirst((string) $c->n) . ',', $u['name'] . ' at StratEdge IT Consulting asks you to confirm your ' . $what . '. It takes a minute: say what is still correct and type only what changed.', 'The link works for 14 days.'];
            $sent = sendMail(trim((string) $c->e), (string) $c->n, 'Please confirm your details for StratEdge', implode("\n\n", $paras) . "\n\n" . $link, emailHtml('Please confirm your details', $paras, ['Confirm my details', $link]), [], (string) $u['email']);
            ok(['ok' => true, 'fields' => $fields, 'mailed' => $sent]);
        case 'bd_check':
            // a submission being logged by hand (RTRs & submissions, the requirements desk): what it would repeat
            $s = (object) ['cid' => str($b, 'cid', 40), 'cn' => str($b, 'cn', 120), 'ce' => str($b, 'ce', 190), 'req' => str($b, 'req', 200), 'vn' => str($b, 'vn', 160), 'ec' => str($b, 'ec', 160), 'ext' => str($b, 'ext', 60), 'vreq' => str($b, 'vreq', 80)];
            ok(['conflicts' => bdConflicts($s, str($b, 'sid', 40)), 'manager' => bdIsManager($u)]);
        case 'bd_shortlist':
            // a consultant put forward for a requirement: a submission at "shortlisted", checked for conflicts
            $cid = str($b, 'cid', 40);
            $c = bdCand($cid);
            if (!$c) {
                fail(404, 'not_found', 'That consultant is no longer in the database.');
            }
            $req = null;
            $vreq = str($b, 'vreq', 80);
            if ($vreq !== '') {
                require_once __DIR__ . '/vms.php';
                $req = vmsReqGet($vreq);
                if (!$req) {
                    fail(404, 'not_found', 'That requirement is no longer on the desk.');
                }
            }
            $vn = $req ? (string) (($req['vn'] ?? '') ?: ($req['cl'] ?? '')) : str($b, 'vn', 160);
            $s = (object) [
                'd' => date('Y-m-d'), 'cid' => $cid, 'src' => 'db', 'cn' => (string) $c->n, 'ce' => mb_strtolower(trim((string) ($c->e ?? ''))),
                'req' => $req ? (string) ($req['ti'] ?? '') : str($b, 'req', 200), 'vreq' => $vreq, 'vn' => $vn,
                'ec' => $req ? (string) ($req['ec'] ?? '') : str($b, 'ec', 160), 'ext' => $req ? (string) ($req['vref'] ?? '') : str($b, 'ext', 60),
                'rate' => str($b, 'rate', 60) ?: (string) ($c->rate ?? ''), 're' => $req ? (string) ($req['ce'] ?? '') : str($b, 're', 190), 'rn' => $req ? (string) ($req['cn'] ?? '') : str($b, 'rn', 120),
                'st' => 'shortlisted', 'rtr' => false, 'rtrAt' => '', 'by' => (string) $u['id'], 'byn' => (string) $u['name'], 'own' => (string) $u['id'], 'ownn' => (string) $u['name'],
                'at' => now(), 'u' => now(), 'un' => (string) $u['name'], 'notes' => str($b, 'note', 2000), 'stAt' => now(),
                'hc' => (object) [
                    'on' => !empty($b['hcOn']),
                    'facility' => str($b, 'hcFacility', 160),
                    'specialty' => str($b, 'hcSpecialty', 120),
                    'license' => str($b, 'hcLicense', 160),
                    'certs' => str($b, 'hcCerts', 500),
                    'shift' => str($b, 'hcShift', 120),
                    'credentialing' => str($b, 'hcCredentialing', 500),
                ],
            ];
            if ($s->req === '') {
                fail(400, 'invalid_argument', 'Pick the requirement or name the role.');
            }
            if ($s->vn === '') {
                fail(400, 'invalid_argument', 'Name the vendor or client it goes to.');
            }
            $sid = rid(8);
            bdHist($s, (string) $u['name'], 'Shortlisted');
            $conf = bdConflicts($s, $sid);
            $cf = array_values(array_filter($conf, fn($x) => $x['kind'] !== 'info'));
            if ($cf) {
                $s->cf = array_map(fn($x) => (object) ['sid' => $x['sid'], 'kind' => $x['kind'], 'why' => $x['why']], $cf);
            }
            $s->next = (object) ['what' => 'Ask ' . bdFirst((string) $c->n) . ' to approve the submission', 'due' => date('Y-m-d'), 'own' => (string) $u['id'], 'ownn' => (string) $u['name'], 'at' => now(), 'by' => (string) $u['name']];
            docSet('rec/sub/items/' . $sid, $s);
            if ((string) ($c->st ?? '') === 'active') {
                $c->st = 'working';
                $c->u = now();
                docSet('rec/cand/items/' . $cid, $c);
            }
            ok(['id' => $sid, 'conflicts' => $conf]);
        case 'bd_conflicts':
            $sid = str($b, 'sid', 40);
            $s = bdSub($sid);
            if (!$s) {
                fail(404, 'not_found', 'That submission is no longer there.');
            }
            ok(['conflicts' => bdConflicts($s, $sid), 'manager' => bdIsManager($u)]);
        case 'bd_rtr_send':
            // ask the consultant to approve the submission (by email; the answer comes back to the submission)
            $sid = str($b, 'sid', 40);
            $s = bdSub($sid);
            if (!$s) {
                fail(404, 'not_found', 'That submission is no longer there.');
            }
            $c = !empty($s->cid) ? bdCand((string) $s->cid) : null;
            $email = trim((string) ($c->e ?? ($s->ce ?? '')));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                fail(400, 'invalid_argument', 'Add the consultant’s email to their record first.');
            }
            if (!in_array((string) ($s->st ?? ''), BD_PRE, true)) {
                fail(400, 'invalid_argument', 'Approval is asked for before the submission is sent.');
            }
            if (throttleHit('bdrtr:' . $sid, 4, 86400)) {
                fail(429, 'rate_limited', 'The consultant was already asked four times today for this submission.');
            }
            $until = preg_match('/^\d{4}-\d{2}-\d{2}$/', str($b, 'until', 10)) ? str($b, 'until', 10) : date('Y-m-d', time() + $set['rtrDays'] * 86400);
            $scope = str($b, 'scope', 12) === 'client' ? 'client' : 'req';
            [$tok, $hash] = bdToken($sid);
            $rate = str($b, 'rate', 60) ?: (string) ($s->rate ?? '');
            if ($rate !== '') {
                $s->rate = $rate;
            }
            $s->rtr2 = (object) ['st' => 'requested', 'at' => now(), 'by' => (string) $u['name'], 'scope' => $scope, 'until' => $until, 'rate' => $rate, 'note' => str($b, 'note', 500), 'h' => $hash, 'exp' => now() + 7 * 86400000];
            $s->st = 'approval';
            $s->stAt = now();
            $s->u = now();
            unset($s->flag);
            bdHist($s, (string) $u['name'], 'Asked the consultant for approval (RTR)');
            $s->next = (object) ['what' => 'Waiting for ' . bdFirst((string) ($s->cn ?? '')) . '’s approval', 'due' => date('Y-m-d', time() + 86400), 'own' => (string) (($s->own ?? '') ?: $u['id']), 'ownn' => (string) (($s->ownn ?? '') ?: $u['name']), 'at' => now(), 'by' => (string) $u['name']];
            docSet('rec/sub/items/' . $sid, $s);
            $info = bdReqInfo($s);
            $link = siteUrl() . '#/rtr?t=' . rawurlencode($tok);
            $line = $info['role'] . ($info['client'] !== '' ? ' at ' . $info['client'] : '') . ($info['vendor'] !== '' ? ' (through ' . $info['vendor'] . ')' : '');
            $paras = ['Hi ' . bdFirst((string) ($s->cn ?? '')) . ',', $u['name'] . ' would like to submit you for ' . $line . '. Please read the details and approve or decline.', 'Nothing is sent without your approval. The link works for 7 days.'];
            $sent = sendMail($email, (string) ($s->cn ?? ''), 'Your approval to submit you: ' . $info['role'], implode("\n\n", $paras) . "\n\n" . $link, emailHtml('Your approval to submit you', $paras, ['Read and answer', $link]), [], (string) $u['email']);
            ok(['ok' => true, 'mailed' => $sent]);
        case 'bd_stage':
            $sid = str($b, 'sid', 40);
            $s = bdSub($sid);
            if (!$s) {
                fail(404, 'not_found', 'That submission is no longer there.');
            }
            $st = str($b, 'st', 12);
            if (!isset(BD_STAGES[$st])) {
                fail(400, 'invalid_argument', 'Unknown stage.');
            }
            $from = (string) ($s->st ?? 'submitted');
            $note = str($b, 'note', 500);
            if (in_array($st, ['rejected', 'withdrawn', 'closed'], true) && $st !== $from && $note === '') {
                fail(400, 'invalid_argument', 'Say why (it is kept with the submission).');
            }
            if (in_array($st, BD_PRE, true) && !in_array($from, BD_PRE, true)) {
                fail(400, 'invalid_argument', 'A submission that was sent cannot go back to being prepared; withdraw it instead.');
            }
            $lines = [];
            if (!empty($b['rtrHave']) && empty($s->rtr)) {
                // the recruiter has the approval in writing (an email or a signed RTR form)
                $s->rtr = true;
                $s->rtrAt = date('Y-m-d');
                $s->rtr2 = (object) ['st' => 'approved', 'at' => now(), 'by' => (string) $u['name'], 'via' => 'recorded by ' . $u['name'], 'scope' => 'req', 'until' => date('Y-m-d', time() + $set['rtrDays'] * 86400), 'rate' => (string) ($s->rate ?? '')];
                $lines[] = 'Approval (RTR) recorded by the recruiter';
            }
            if ($st === 'submitted' && in_array($from, BD_PRE, true)) {
                // the check before anything is sent
                $lines = array_merge($lines, bdSendCheck($s, $sid, $u, $b));
                if (empty($s->rtr)) {
                    if (str($b, 'nortr', 5) !== '1') {
                        fail(400, 'needs_rtr', 'The consultant has not approved this submission (RTR) yet. Ask for it, or record that you have it.');
                    }
                    $lines[] = 'Sent without an RTR (the vendor does not ask for one)';
                }
                $s->d = date('Y-m-d');
                $s->pk = bdPacket($s, $u);
                unset($s->flag);
                // the requirement on the desk moves to "submitted"
                if (!empty($s->vreq) && preg_match('/^[A-Za-z0-9_\-]{1,40}$/', (string) $s->vreq)) {
                    require_once __DIR__ . '/vms.php';
                    $q = docGet(VMS_REQ . '/' . $s->vreq);
                    if ($q && in_array((string) ($q->st ?? ''), ['new', 'open', 'working'], true)) {
                        $q->st = 'submitted';
                        $q->u = now();
                        docSet(VMS_REQ . '/' . $s->vreq, $q);
                    }
                }
            }
            if ($st === 'interview' && preg_match('/^\d{4}-\d{2}-\d{2}$/', str($b, 'intv', 10))) {
                $s->intv = str($b, 'intv', 10);
                $s->intvAt = preg_match('/^\d{2}:\d{2}$/', str($b, 'intvAt', 5)) ? str($b, 'intvAt', 5) : '';
                $s->intvTz = str($b, 'intvTz', 40);
                $s->intvKind = str($b, 'intvKind', 40);
            }
            if (str($b, 'ref', 120) !== '') {
                $s->xc = (object) ['ref' => str($b, 'ref', 120), 'at' => now(), 'by' => (string) $u['name']];
                $lines[] = 'Confirmation from the vendor or client: ' . str($b, 'ref', 120);
            }
            if ($st !== $from) {
                $lines[] = (BD_STAGES[$st] ?? $st) . ($st === 'interview' && !empty($s->intv) ? ' on ' . $s->intv . (($s->intvAt ?? '') !== '' ? ' ' . $s->intvAt : '') . (($s->intvTz ?? '') !== '' ? ' ' . $s->intvTz : '') : '') . ($note !== '' ? ': ' . $note : '');
            } elseif ($note !== '') {
                $lines[] = 'Note: ' . $note;
            }
            if ($st !== $from) {
                $s->stAt = now();
            }
            $s->st = $st;
            if ($note !== '' && in_array($st, ['rejected', 'withdrawn', 'closed'], true)) {
                $s->why = $note;
            }
            $s->u = now();
            $s->un = (string) $u['name'];
            foreach ($lines as $l) {
                bdHist($s, (string) $u['name'], $l);
            }
            $owner = [(string) (($s->own ?? '') ?: ($s->by ?? $u['id'])), (string) (($s->ownn ?? '') ?: ($s->byn ?? $u['name']))];
            if (in_array($st, BD_DONE, true)) {
                $s->next = null;
            } elseif ($st === 'submitted' && $from !== 'submitted') {
                $s->next = (object) ['what' => 'Follow up with ' . ((string) ($s->rn ?? '') !== '' ? $s->rn : ((string) ($s->vn ?? '') !== '' ? $s->vn : 'the vendor')), 'due' => date('Y-m-d', time() + 2 * 86400), 'own' => $owner[0], 'ownn' => $owner[1], 'at' => now(), 'by' => (string) $u['name']];
            } elseif ($st === 'ready' && $from !== 'ready') {
                $s->next = (object) ['what' => 'Send the submission', 'due' => date('Y-m-d'), 'own' => $owner[0], 'ownn' => $owner[1], 'at' => now(), 'by' => (string) $u['name']];
            } elseif ($st === 'interview' && !empty($s->intv) && $from !== 'interview') {
                $s->next = (object) ['what' => 'Prepare ' . bdFirst((string) ($s->cn ?? '')) . ' for the interview', 'due' => (string) $s->intv, 'own' => $owner[0], 'ownn' => $owner[1], 'at' => now(), 'by' => (string) $u['name']];
            }
            docSet('rec/sub/items/' . $sid, $s);
            // the consultant: placed comes off the bench; when the last open submission closes they are available again
            if (!empty($s->cid) && ($c = bdCand((string) $s->cid))) {
                if ($st === 'placed' && !empty($b['placeCand'])) {
                    $c->st = 'placed';
                    $c->u = now();
                    docSet('rec/cand/items/' . $s->cid, $c);
                } elseif (in_array($st, ['rejected', 'withdrawn', 'closed'], true) && (string) ($c->st ?? '') === 'working') {
                    $open = 0;
                    foreach (colAll('rec/sub/items') as [$oid, $o]) {
                        if ((string) $oid !== $sid && (string) ($o->cid ?? '') === (string) $s->cid && !in_array((string) ($o->st ?? ''), BD_DONE, true)) {
                            $open++;
                        }
                    }
                    if ($open === 0) {
                        $c->st = 'active';
                        $c->u = now();
                        docSet('rec/cand/items/' . $s->cid, $c);
                    }
                }
            }
            ok(['sub' => $s]);
        case 'bd_next':
            $sid = str($b, 'sid', 40);
            $s = bdSub($sid);
            if (!$s) {
                fail(404, 'not_found', 'That submission is no longer there.');
            }
            $what = str($b, 'what', 200);
            if ($what === '') {
                $s->next = null;
                bdHist($s, (string) $u['name'], 'Next action cleared');
            } else {
                $due = preg_match('/^\d{4}-\d{2}-\d{2}$/', str($b, 'due', 10)) ? str($b, 'due', 10) : date('Y-m-d', time() + 86400);
                $own = str($b, 'own', 40) ?: ((string) ($s->own ?? '') ?: (string) ($s->by ?? $u['id']));
                $row = userRow($own);
                if (!$row) {
                    fail(400, 'invalid_argument', 'Pick someone from the team.');
                }
                $s->next = (object) ['what' => $what, 'due' => $due, 'own' => $own, 'ownn' => (string) $row['name'], 'at' => now(), 'by' => (string) $u['name']];
                bdHist($s, (string) $u['name'], 'Next: ' . $what . ' (by ' . $due . ', ' . $row['name'] . ')');
            }
            $s->u = now();
            docSet('rec/sub/items/' . $sid, $s);
            ok(['sub' => $s]);
        case 'bd_reqs_for':
            // the open requirements this consultant fits (the desk's matcher the other way round)
            require_once __DIR__ . '/vms.php';
            $cid = str($b, 'cid', 40);
            $c = bdCand($cid);
            if (!$c) {
                fail(404, 'not_found', 'That consultant is no longer in the database.');
            }
            $listed = array_values(array_filter(array_map('trim', preg_split('/[,;|\n]+/', (string) ($c->sk ?? '')) ?: [])));
            $row = [
                'titles' => array_values(array_filter([(string) ($c->ti ?? '')])),
                'skills' => array_values(array_unique(array_merge(skillsCanon($listed), skillsIn((string) ($c->ti ?? '') . "\n" . (string) ($c->sk ?? ''), 30)))),
                'loc' => (string) ($c->loc ?? ''), 'reloc' => (string) ($c->reloc ?? ''), 'auth' => (string) ($c->auth ?? ''),
            ];
            $subs = [];
            foreach (colAll('rec/sub/items') as [$sid, $o]) {
                if ((string) ($o->cid ?? '') === $cid && !empty($o->vreq)) {
                    $subs[(string) $o->vreq] = ['sid' => (string) $sid, 'st' => (string) ($o->st ?? '')];
                }
            }
            $out = [];
            foreach (colAll(VMS_REQ) as [$rid, $q]) {
                if (!in_array((string) ($q->st ?? ''), ['open', 'working', 'submitted', 'interview'], true)) {
                    continue;
                }
                [$score, $why] = vmsScore(vmsReqProfile((array) $q), $row);
                if ($score < 35) {
                    continue;
                }
                $out[] = ['id' => (string) $rid, 'ti' => (string) ($q->ti ?? ''), 'vn' => (string) (($q->vn ?? '') ?: ($q->cl ?? '')), 'ec' => (string) ($q->ec ?? ''), 'loc' => (string) ($q->loc ?? ''), 'md' => (string) ($q->md ?? ''), 'rate' => (string) ($q->rate ?? ''), 'ty' => (string) ($q->ty ?? ''), 'st' => (string) ($q->st ?? ''), 'at' => (int) ($q->at ?? 0), 'score' => $score, 'why' => array_slice($why, 0, 3), 'sub' => $subs[(string) $rid] ?? null];
            }
            usort($out, fn($x, $y) => $y['score'] <=> $x['score'] ?: $y['at'] <=> $x['at']);
            ok(['reqs' => array_slice($out, 0, 15)]);
    }
    fail(404, 'not_found', 'Unknown action.');
}

/** The links in emails: the approval (RTR) request and the details confirmation (no account needed). */
function bdPublic(string $r, array $b): never
{
    if (throttleHit('bdpub:' . clientIp(), 60, 3600)) {
        fail(429, 'rate_limited', 'Too many tries from this network. Try again later.');
    }
    [$id, $hash] = bdTokenParts(str($b, 't', 80));
    if ($id === '') {
        fail(400, 'invalid_argument', 'This link is not complete. Open it from the email again.');
    }
    if ($r === 'bd_rtr_get' || $r === 'bd_rtr_answer') {
        $s = bdSub($id);
        $q = $s->rtr2 ?? null;
        if (!$s || !$q || !hash_equals((string) ($q->h ?? ''), $hash)) {
            fail(404, 'not_found', 'This link is no longer valid. Ask your recruiter to send a new one.');
        }
        $answered = in_array((string) ($q->st ?? ''), ['approved', 'declined'], true);
        if (!$answered && (int) ($q->exp ?? 0) < now()) {
            fail(410, 'expired', 'This link has expired. Ask your recruiter to send a new one.');
        }
        if ($r === 'bd_rtr_get') {
            ok(bdRtrView($s));
        }
        if ($answered) {
            fail(409, 'answered', 'You already answered: ' . ($q->st === 'approved' ? 'you approved it.' : 'you declined it.'));
        }
        bdRtrAnswer($s, $id, !empty($b['ok']), str($b, 'name', 120), str($b, 'note', 500), str($b, 'other', 3), str($b, 'otherWho', 200), 'email link');
        ok(bdRtrView(bdSub($id)));
    }
    // the details confirmation
    $c = bdCand($id);
    $q = $c->conf ?? null;
    if (!$c || !$q || !hash_equals((string) ($q->h ?? ''), $hash)) {
        fail(404, 'not_found', 'This link is no longer valid. Ask your recruiter to send a new one.');
    }
    if ((int) ($q->exp ?? 0) < now()) {
        fail(410, 'expired', 'This link has expired. Ask your recruiter to send a new one.');
    }
    if ($r === 'bd_confirm_get') {
        ok(bdDetailsView($c, (array) ($q->fields ?? [])) + ['done' => ($q->st ?? '') === 'answered']);
    }
    if (($q->st ?? '') === 'answered') {
        fail(409, 'answered', 'You already confirmed your details with this link. Thank you!');
    }
    bdDetailsAnswer($c, $id, (array) ($b['v'] ?? []), (array) ($b['same'] ?? []), 'email link', (array) ($q->fields ?? []));
    $c = bdCand($id);
    $c->conf->st = 'answered';
    $c->conf->ans = now();
    docSet('rec/cand/items/' . $id, $c);
    ok(bdDetailsView($c, (array) ($c->conf->fields ?? [])) + ['done' => true]);
}
/** What the consultant sees about an approval request (never the internal notes or the other people involved). */
function bdRtrView(stdClass $s): array
{
    $q = $s->rtr2;
    $info = bdReqInfo($s);
    $ans = isset($q->ans) && $q->ans instanceof stdClass ? ['at' => (int) ($q->ans->at ?? 0), 'name' => (string) ($q->ans->name ?? ''), 'other' => (string) ($q->ans->other ?? '')] : null;
    return [
        'name' => bdFirst((string) ($s->cn ?? '')),
        'full' => (string) ($s->cn ?? ''),
        'role' => $info['role'], 'client' => $info['client'], 'vendor' => $info['vendor'], 'prime' => $info['prime'], 'chain' => bdChain($info),
        'loc' => $info['loc'], 'md' => $info['md'], 'dur' => $info['dur'], 'ty' => $info['ty'],
        'rate' => (string) ($q->rate ?? ''), 'until' => (string) ($q->until ?? ''), 'scope' => (string) ($q->scope ?? 'req'), 'note' => (string) ($q->note ?? ''),
        'by' => (string) ($q->by ?? ''), 'st' => (string) ($q->st ?? ''), 'ans' => $ans, 'exp' => (int) ($q->exp ?? 0),
    ];
}
function bdRtrAnswer(stdClass $s, string $sid, bool $yes, string $name, string $note, string $other, string $otherWho, string $via): void
{
    if ($yes && mb_strlen(trim($name)) < 3) {
        fail(400, 'invalid_argument', 'Type your full name to approve.');
    }
    if ($yes && !in_array($other, ['no', 'yes'], true)) {
        fail(400, 'invalid_argument', 'Say whether anyone else already submitted you for this role.');
    }
    $q = $s->rtr2;
    $q->st = $yes ? 'approved' : 'declined';
    $q->ans = (object) ['at' => now(), 'name' => mb_substr(trim($name), 0, 120), 'note' => $note, 'other' => $yes ? $other : '', 'otherWho' => $yes && $other === 'yes' ? $otherWho : '', 'via' => $via, 'ip' => substr(hash('sha256', clientIp() . '|' . (string) cfg('app_secret')), 0, 16), 'ua' => mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 160)];
    $owner = [(string) (($s->own ?? '') ?: ($s->by ?? '')), (string) (($s->ownn ?? '') ?: ($s->byn ?? ''))];
    if ($yes) {
        $s->rtr = true;
        $s->rtrAt = date('Y-m-d');
        if ((string) ($s->st ?? '') === 'approval') {
            $s->st = 'ready';
            $s->stAt = now();
            $s->next = (object) ['what' => 'Send the submission', 'due' => date('Y-m-d'), 'own' => $owner[0], 'ownn' => $owner[1], 'at' => now(), 'by' => 'the consultant'];
        }
        if ($other === 'yes') {
            $s->flag = 'The consultant says someone else already submitted them for this role' . ($otherWho !== '' ? ' (' . $otherWho . ')' : '') . ': check before sending.';
        }
    } elseif ((string) ($s->st ?? '') === 'approval') {
        $s->st = 'shortlisted';
        $s->stAt = now();
        $s->next = (object) ['what' => 'The consultant declined: withdraw it or talk to them', 'due' => date('Y-m-d'), 'own' => $owner[0], 'ownn' => $owner[1], 'at' => now(), 'by' => 'the consultant'];
    }
    $s->u = now();
    bdHist($s, (string) ($s->cn ?? 'The consultant'), ($yes ? 'Approved the submission (RTR), typed name "' . trim($name) . '"' : 'Declined the submission') . ($other === 'yes' ? '; says they were already submitted' . ($otherWho !== '' ? ' by ' . $otherWho : '') : '') . ($note !== '' ? '. Note: ' . $note : ''));
    docSet('rec/sub/items/' . $sid, $s);
    $info = bdReqInfo($s);
    $paras = [($s->cn ?? 'The consultant') . ($yes ? ' approved' : ' declined') . ' the submission for ' . $info['role'] . ($info['client'] !== '' ? ' at ' . $info['client'] : '') . '.'];
    if ($yes && $other === 'yes') {
        $paras[] = 'They say someone else already submitted them for this role' . ($otherWho !== '' ? ': ' . $otherWho : '') . '. Check before sending.';
    }
    $paras[] = $note !== '' ? 'Their note: ' . $note : ($yes ? 'The submission is ready to send.' : 'The submission went back to shortlisted.');
    bdNotifyOwner($s, ($yes ? 'Approved: ' : 'Declined: ') . ($s->cn ?? '') . ' for ' . $info['role'], $paras);
}
/** The details the consultant confirms: their values and freshness (only the fields asked are open). */
function bdDetailsView(stdClass $c, array $fields): array
{
    $fr = bdFresh($c);
    return [
        'name' => bdFirst((string) ($c->n ?? '')),
        'fields' => array_values(array_intersect($fields ?: ['avail', 'rate', 'loc', 'auth'], ['avail', 'rate', 'loc', 'auth'])),
        'v' => ['avail' => (string) ($c->avail ?? ''), 'availDate' => (string) ($c->availDate ?? ''), 'rate' => (string) ($c->rate ?? ''), 'loc' => (string) ($c->loc ?? ''), 'md' => (string) ($c->md ?? ''), 'reloc' => (string) ($c->reloc ?? ''), 'auth' => (string) ($c->auth ?? '')],
        'fresh' => array_map(fn($x) => ['st' => $x['st'], 'at' => $x['at']], $fr),
    ];
}
/** The consultant's answer: changed values saved with their history, the rest confirmed; the owner is told and a
 *  changed rate flags the submissions still being prepared (sent ones keep the rate they went out with). */
function bdDetailsAnswer(stdClass $c, string $cid, array $v, array $same, string $via, array $allowed = []): void
{
    $map = ['avail' => ['avail', 'availDate'], 'rate' => ['rate'], 'loc' => ['loc', 'md', 'reloc'], 'auth' => ['auth']];
    $allowed = $allowed ? array_values(array_intersect($allowed, array_keys($map))) : array_keys($map);
    $changed = [];
    $confirmed = [];
    $hist = (array) ($c->fh ?? []);
    foreach ($map as $f => $keys) {
        if (!in_array($f, $allowed, true)) {
            continue;
        }
        $did = false;
        foreach ($keys as $k) {
            if (!array_key_exists($k, $v) || !is_scalar($v[$k])) {
                continue;
            }
            $nv = mb_substr(trim((string) $v[$k]), 0, 120);
            if ($k === 'availDate' && $nv !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $nv)) {
                continue;
            }
            if ($k === 'md' && !in_array($nv, ['', 'Onsite', 'Hybrid', 'Remote', 'Any'], true)) {
                continue;
            }
            if ($k === 'auth' && $nv === '') {
                continue;
            }
            if ($nv !== (string) ($c->$k ?? '')) {
                $hist[] = (object) ['t' => now(), 'f' => $k, 'from' => (string) ($c->$k ?? ''), 'to' => $nv, 'by' => 'the consultant (' . $via . ')'];
                $c->$k = $nv;
                $did = true;
            }
        }
        if ($did) {
            $changed[] = $f;
        } elseif (!empty($same[$f])) {
            $confirmed[] = $f;
        }
    }
    if (!$changed && !$confirmed) {
        fail(400, 'invalid_argument', 'Say what is still correct, or change what is not.');
    }
    bdConfirmFields($c, $changed, 'changed', 'the consultant');
    bdConfirmFields($c, $confirmed, 'consultant', 'the consultant');
    $c->fh = array_slice($hist, -60);
    $c->u = now();
    $c->un = (string) ($c->n ?? 'The consultant');
    docSet('rec/cand/items/' . $cid, $c);
    if (in_array('rate', $changed, true)) {
        foreach (colAll('rec/sub/items') as [$sid, $s]) {
            if ((string) ($s->cid ?? '') === $cid && in_array((string) ($s->st ?? ''), BD_PRE, true)) {
                $s->flag = 'The consultant changed their rate to ' . (string) ($c->rate ?? '') . ' after this was prepared: check the rate before sending.';
                bdHist($s, (string) ($c->n ?? 'The consultant'), 'Rate changed to ' . (string) ($c->rate ?? ''));
                docSet('rec/sub/items/' . $sid, $s);
            }
        }
    }
    $nm = fn(array $l) => implode(', ', array_map(fn($f) => mb_strtolower(BD_FRESH[$f]), $l));
    bdNotifyOwner($c, ($changed ? 'Details changed: ' : 'Details confirmed: ') . ($c->n ?? ''), [($c->n ?? 'The consultant') . ' ' . ($changed ? 'updated their ' . $nm($changed) : '') . ($changed && $confirmed ? ' and ' : '') . ($confirmed ? 'confirmed their ' . $nm($confirmed) : '') . '.']);
}
/** The consultant's own page: their submissions in plain words, approvals to give, details to confirm. */
function bdSelf(string $r, array $b, array $u): never
{
    $mine = bdMine($u);
    if ($r === 'bd_my') {
        $subs = [];
        $pending = [];
        foreach (colAll('rec/sub/items') as [$sid, $s]) {
            if (empty($s->cid) || !isset($mine[(string) $s->cid])) {
                continue;
            }
            $st = (string) ($s->st ?? 'submitted');
            $info = bdReqInfo($s);
            $sent = !in_array($st, BD_PRE, true);
            $asked = in_array((string) ($s->rtr2->st ?? ''), ['requested', 'approved', 'declined'], true) || !empty($s->rtr);
            $row = [
                'id' => (string) $sid, 'role' => $info['role'], 'loc' => $info['loc'], 'md' => $info['md'],
                // the vendor chain is shown once the consultant was asked to approve or the profile went out
                'client' => $asked || $sent ? $info['client'] : '', 'vendor' => $asked || $sent ? $info['vendor'] : '',
                'st' => $st, 'label' => BD_MINE[$st][0] ?? $st, 'desc' => BD_MINE[$st][1] ?? '',
                'at' => (int) ($s->stAt ?? ($s->u ?? ($s->at ?? 0))), 'd' => $sent ? (string) ($s->d ?? '') : '',
                'intv' => $st === 'interview' ? trim((string) ($s->intv ?? '') . ' ' . (string) ($s->intvAt ?? '') . (($s->intvTz ?? '') !== '' ? ' (' . $s->intvTz . ')' : '')) : '',
                'by' => (string) (($s->ownn ?? '') ?: ($s->byn ?? '')),
                'hc' => ($s->lob ?? '') === 'hc' ? bdHcLine($s->hc ?? null) : '', // v68
            ];
            if ($st === 'approval' && ($s->rtr2->st ?? '') === 'requested') {
                $pending[] = ['sid' => (string) $sid] + bdRtrView($s);
            }
            $subs[] = $row;
        }
        usort($subs, fn($a, $c2) => $c2['at'] <=> $a['at']);
        $details = null;
        if ($mine) {
            $cid = (string) array_key_first($mine);
            $details = bdDetailsView($mine[$cid], []) + ['cid' => $cid];
        }
        ok(['subs' => $subs, 'pending' => $pending, 'details' => $details, 'linked' => count($mine) > 0]);
    }
    if ($r === 'bd_my_rtr') {
        $sid = str($b, 'sid', 40);
        $s = bdSub($sid);
        if (!$s || empty($s->cid) || !isset($mine[(string) $s->cid]) || ($s->rtr2->st ?? '') !== 'requested') {
            fail(404, 'not_found', 'There is nothing to answer for this submission.');
        }
        bdRtrAnswer($s, $sid, !empty($b['ok']), str($b, 'name', 120), str($b, 'note', 500), str($b, 'other', 3), str($b, 'otherWho', 200), 'portal');
        ok(['ok' => true]);
    }
    // bd_my_confirm
    $cid = str($b, 'cid', 40);
    if (!isset($mine[$cid])) {
        fail(404, 'not_found', 'Your recruiting record was not found.');
    }
    bdDetailsAnswer($mine[$cid], $cid, (array) ($b['v'] ?? []), (array) ($b['same'] ?? []), 'portal');
    ok(['ok' => true, 'details' => bdDetailsView(bdCand($cid), []) + ['cid' => $cid]]);
}
