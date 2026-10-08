<?php
declare(strict_types=1);
/*
 * v45 Immigration cases: HR runs each petition or application as a case with its steps and due dates (from a template
 * per case type: H-1B cap, transfer, extension, amendment, STEM OPT, H-4/H-4 EAD, PERM, I-140, I-485, EAD renewal),
 * receipt numbers, the attorney, the decision and validity dates, documents (sealed at rest) and messages. The person
 * the case is for sees it in their portal (USCIS compliance › My cases): their steps, the documents HR asks for (they
 * upload them there), the documents HR shares and the messages meant for them. Approved dates can be copied into the
 * person's compliance profile, which drives the deadline reminders. The scheduled job emails steps due within a week
 * and overdue ones (to the case owner; steps for the person to them).
 * Documents: im/<id> cases, im/<id>/f/<fid> files ('w': 's' HR only, 'a' HR and the attorney, 'p' everyone on the
 * case, the person included). The generic record access stays with administrators (SCOPES in lib.php); everyone else
 * goes through these routes.
 * v45.1: the case's attorney gets a secure link (imx/<sha256 of the token> points to the case and the grant): each
 * visit asks for a one-time code sent to their email, then they see the case (steps, receipts, the documents HR lets
 * them see, the attorney thread), tick the attorney's steps, add receipts, upload documents and write to HR. The Visa
 * Bulletin (imvb/x, entered by HR each month, seeded with October 2026) tells each green card case whether its
 * priority date is current; the H-1B clock counts each person's six years (with days abroad recaptured) against
 * their green card stage (AC21); H-1B cases keep their LCA public access file checklist (20 CFR 655.760); reports.
 * The step templates follow the rules of USCIS, DOL and SEVP as of October 2026 (see the compliance rule library in
 * comp.php for the sources); they are a checklist to adapt per case, not legal advice.
 */

const IM_ST = ['open' => 'Preparing', 'filed' => 'Filed', 'rfe' => 'Request for evidence', 'approved' => 'Approved', 'denied' => 'Denied', 'withdrawn' => 'Withdrawn', 'closed' => 'Closed'];
const IM_WHO = ['hr' => 'HR', 'person' => 'The person', 'atty' => 'Attorney'];
const IM_VIS = ['s' => 'HR only', 'a' => 'HR and the attorney', 'p' => 'Everyone on the case'];
const IM_GC_CATS = ['eb1' => 'EB-1', 'eb2' => 'EB-2', 'eb3' => 'EB-3', 'ew' => 'EB-3 other workers'];
const IM_GC_CTY = ['row' => 'All chargeability', 'cn' => 'China', 'in' => 'India', 'mx' => 'Mexico', 'ph' => 'Philippines'];
// 20 CFR 655.760(a): the public access file of an LCA (available within one working day of filing; kept one year past
// the last H-1B worker on it). Items 7 to 10 apply only in their situations.
const IM_PAF = [
    'lca' => 'Certified LCA (ETA-9035/9035E) with its cover pages',
    'wage' => 'The wage rate paid to the H-1B worker',
    'actual' => 'How the actual wage is set (the system used for that occupation)',
    'pw' => 'The prevailing wage source (OEWS level, survey or determination)',
    'notice' => 'Proof of the notice: where and when it was posted (10 business days) or sent electronically',
    'benefits' => 'Summary of the benefits offered to U.S. workers in the same occupation',
    'sworn' => 'Only after a change in corporate structure: sworn statement accepting the LCA obligations',
    'single' => 'Only if several companies count as a single employer: the list of them',
    'exempt' => 'Only for H-1B dependent employers or willful violators: the list of exempt H-1B workers',
    'recruit' => 'Only for H-1B dependent employers or willful violators: how U.S. workers were recruited',
];
const IM_PAF_CORE = ['lca', 'wage', 'actual', 'pw', 'notice', 'benefits'];
const IM_DOC_CATS = ['passport' => 'Passport', 'visa' => 'Visa stamp', 'i94' => 'I-94', 'i20' => 'I-20', 'ead' => 'EAD card', 'i797' => 'I-797 notice', 'lca' => 'LCA', 'i983' => 'Form I-983', 'degree' => 'Degree and transcripts', 'eval' => 'Credential evaluation', 'resume' => 'Resume', 'letters' => 'Experience letters', 'pay' => 'Pay stubs', 'client' => 'Client letter / SOW', 'perm' => 'PERM / recruitment', 'medical' => 'Medical exam (I-693)', 'rfe' => 'RFE and response', 'filed' => 'Filed petition copy', 'paf' => 'Public access file', 'other' => 'Other'];

/** The case types: name, what the base date means, and the steps (id, title, who, days from the base date or null). */
function imTypes(): array
{
    return [
        'h1bcap' => ['n' => 'H-1B cap (new, lottery)', 'base' => 'Registration window opens', 'hint' => 'Usually early March; the petition is filed from 1 April and work starts 1 October.', 'steps' => [
            ['docs', 'Collect passport, degree, transcripts, evaluation, resume, I-94 and I-20/EAD', 'person', -21],
            ['wage', 'Confirm job title, SOC code, worksites and the offered wage level (it sets the lottery weight)', 'hr', -14],
            ['reg', 'Submit the electronic registration (same wage level on the registration, LCA and petition)', 'hr', 14],
            ['sel', 'Record the selection result (USCIS notifies by 31 March)', 'hr', 31],
            ['lca', 'File the LCA (ETA-9035) for each worksite', 'atty', 40],
            ['post', 'Post the LCA notice for 10 business days at each worksite (or electronically)', 'hr', 40],
            ['paf', 'Put the public access file together (within one working day of filing the LCA)', 'hr', 41],
            ['file', 'File Form I-129 within the 90-day filing period (change of status for people in the U.S.)', 'atty', 75],
            ['rcpt', 'Log the receipt notice; F-1 students ask their DSO for the cap-gap I-20', 'person', 90],
            ['dec', 'Record the decision and the validity dates', 'hr', null],
            ['start', 'Start in H-1B status on 1 October: update the I-9 and payroll', 'hr', 214],
        ]],
        'h1bxfer' => ['n' => 'H-1B transfer (change of employer)', 'base' => 'Intended start date with StratEdge', 'hint' => 'Work may start once USCIS receives the petition (portability), not before.', 'steps' => [
            ['docs', 'Collect all I-797 approvals, I-94, passport, visa, the last 3 pay stubs and the resume', 'person', -30],
            ['wage', 'Confirm job title, SOC code, worksite and wage', 'hr', -28],
            ['lca', 'File the LCA (ETA-9035)', 'atty', -21],
            ['post', 'Post the LCA notice for 10 business days at the worksite', 'hr', -21],
            ['paf', 'Public access file', 'hr', -20],
            ['file', 'File Form I-129 (no lottery: the person was already counted against the cap)', 'atty', -10],
            ['rcpt', 'Log the receipt notice: work may start once USCIS has received the petition', 'hr', -2],
            ['i9', 'Form I-9 with the receipt notice on day one', 'hr', 0],
            ['dec', 'Record the decision and the validity dates', 'hr', null],
        ]],
        'h1bext' => ['n' => 'H-1B extension', 'base' => 'Current approval / I-94 end date', 'hint' => 'File up to 6 months early; filed in time, work continues up to 240 days past the end date.', 'steps' => [
            ['docs', 'Collect the latest I-94, passport, approvals and the last 3 pay stubs', 'person', -200],
            ['max', 'Check the six-year limit; beyond it the extension needs AC21 (an approved I-140, or PERM/I-140 filed 365+ days earlier)', 'hr', -190],
            ['lca', 'File the LCA (ETA-9035)', 'atty', -180],
            ['post', 'Post the LCA notice for 10 business days', 'hr', -180],
            ['file', 'File Form I-129 (and Form I-539 for H-4 dependents) before the end date', 'atty', -150],
            ['rcpt', 'Log the receipt notice; keep it with the I-9 (240-day rule)', 'hr', -140],
            ['dec', 'Record the decision and the new validity dates', 'hr', null],
        ]],
        'h1bamend' => ['n' => 'H-1B amendment (new worksite or material change)', 'base' => 'Date of the change (new client site, move, new duties)', 'hint' => 'A move outside the metropolitan area of the LCA needs a new LCA and the amended petition filed before the change.', 'steps' => [
            ['client', 'Get the client letter or statement of work for the new placement', 'hr', -30],
            ['lca', 'File a new LCA for the new worksite', 'atty', -21],
            ['post', 'Post the LCA notice for 10 business days at the new worksite', 'hr', -21],
            ['file', 'File the amended Form I-129 before the change takes effect', 'atty', -3],
            ['rcpt', 'Log the receipt notice', 'hr', 0],
            ['dec', 'Record the decision', 'hr', null],
        ]],
        'stemopt' => ['n' => 'STEM OPT extension', 'base' => 'Current OPT EAD end date', 'hint' => 'File Form I-765 within 90 days before the EAD ends and within 60 days of the DSO recommendation.', 'steps' => [
            ['i983', 'Complete and sign Form I-983 (training plan) with the supervisor', 'hr', -100],
            ['dso', 'Send the I-983 to the DSO and get the STEM OPT I-20 recommendation', 'person', -90],
            ['file', 'File Form I-765 (within 60 days of the DSO recommendation, before the EAD ends)', 'person', -60],
            ['rcpt', 'Log the receipt notice: while pending, work may continue up to 180 days past the end date', 'hr', -30],
            ['i9', 'Update the I-9 with the receipt and the STEM I-20', 'hr', 0],
            ['dec', 'Record the approval and the new EAD dates; the 6/12/18/24-month reports follow', 'hr', null],
        ]],
        'h4ead' => ['n' => 'H-4 / H-4 EAD', 'base' => 'Current H-4 EAD (or H-4) end date', 'hint' => 'Renewals no longer extend automatically: file 180 days early.', 'steps' => [
            ['docs', 'Collect the principal\'s approvals, marriage certificate, I-94s and the current EAD', 'person', -200],
            ['i539', 'File Form I-539 for H-4 status (with the principal\'s extension when there is one)', 'atty', -180],
            ['i765', 'File Form I-765 for the H-4 EAD', 'atty', -180],
            ['rcpt', 'Log the receipt notices', 'hr', -170],
            ['i9', 'Reverify the I-9 before the EAD ends (no automatic extension)', 'hr', -1],
            ['dec', 'Record the decision and the new EAD dates', 'hr', null],
        ]],
        'perm' => ['n' => 'PERM labor certification', 'base' => 'Planned PERM filing date', 'hint' => 'Recruitment runs 30 to 180 days before filing; the filing date becomes the priority date.', 'steps' => [
            ['job', 'Write the job description and the minimum requirements', 'hr', -240],
            ['pwd', 'Request the prevailing wage determination (Form ETA-9141)', 'atty', -230],
            ['pwdok', 'Record the prevailing wage determination', 'atty', -120],
            ['swa', 'Place the job order with the state workforce agency for 30 days', 'hr', -100],
            ['ad1', 'First Sunday newspaper ad', 'hr', -95],
            ['ad2', 'Second Sunday newspaper ad', 'hr', -88],
            ['extra', 'Three additional recruitment steps (professional occupations)', 'hr', -85],
            ['nof', 'Post the notice of filing for 10 business days', 'hr', -85],
            ['report', 'Recruitment report: applicants and lawful reasons for not hiring', 'atty', -40],
            ['file', 'File Form ETA-9089 after the 30-day quiet period', 'atty', 0],
            ['dec', 'Record the certification (it is valid for 180 days: the I-140 must be filed in that time)', 'hr', null],
        ]],
        'i140' => ['n' => 'I-140 immigrant petition', 'base' => 'PERM certification date', 'hint' => 'File within the 180 days the labor certification is valid; premium processing is available.', 'steps' => [
            ['docs', 'Collect degree, transcripts, evaluation and experience letters matching the PERM requirements', 'person', 14],
            ['pay', 'Ability to pay: annual report, tax return or audited statement', 'hr', 30],
            ['file', 'File Form I-140 (premium processing optional)', 'atty', 60],
            ['rcpt', 'Log the receipt notice', 'hr', 70],
            ['dec', 'Record the approval: after 180 days it keeps the priority date even if withdrawn', 'hr', null],
            ['deadline', 'Last day to file (labor certification expires)', 'hr', 179],
        ]],
        'i485' => ['n' => 'I-485 adjustment of status', 'base' => 'Date the priority date is current', 'hint' => 'Check the Visa Bulletin chart USCIS accepts that month; the I-693 medical goes with the filing.', 'steps' => [
            ['med', 'Medical exam with a civil surgeon (Form I-693, filed with the I-485)', 'person', 14],
            ['docs', 'Birth certificate, passport, I-94s, status history and the I-864W/I-864 as applicable', 'person', 14],
            ['file', 'File Form I-485 with Forms I-765 and I-131', 'atty', 30],
            ['rcpt', 'Log the receipt notices', 'hr', 40],
            ['bio', 'Biometrics appointment', 'person', 75],
            ['dec', 'Record the decision', 'hr', null],
            ['supj', 'Job change after 180 days pending: Form I-485 Supplement J', 'hr', null],
        ]],
        'eadrenew' => ['n' => 'EAD renewal', 'base' => 'Current EAD end date', 'hint' => 'Renewals filed after 30 October 2025 get no automatic extension: file 180 days early.', 'steps' => [
            ['docs', 'Collect the current EAD and the documents for the category', 'person', -190],
            ['file', 'File Form I-765 for the renewal', 'person', -180],
            ['rcpt', 'Log the receipt notice', 'hr', -170],
            ['i9', 'Reverify the I-9 before the EAD ends', 'hr', -1],
            ['dec', 'Record the decision and the new EAD dates', 'hr', null],
        ]],
        'other' => ['n' => 'Other case', 'base' => 'Key date', 'hint' => 'Add the steps yourself.', 'steps' => []],
    ];
}
function imStaff(array $u): bool
{
    return hasRole($u, 'admin') || hasRole($u, 'hr') || grantOf((string) $u['id'], 'hr');
}
function imDate(string $d): string
{
    return preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) && strtotime($d) ? $d : '';
}
function imAdd(string $d, ?int $days): string
{
    if ($d === '' || $days === null) {
        return '';
    }
    return date('Y-m-d', (int) strtotime($d . ' 12:00:00') + $days * 86400);
}
/** The case, when this person may see it (HR and administrators; the person it is for); else a 404. */
function imGet(string $id, array $u): stdClass
{
    $id = preg_replace('/[^a-z0-9]/', '', $id);
    $c = $id !== '' ? docGet('im/' . $id) : null;
    if (!$c || !(imStaff($u) || (string) $c->uid === $u['id'])) {
        fail(404, 'not_found', 'No such case.');
    }
    $c->id = $id;
    return $c;
}
function imFiles(string $id): array
{
    $out = [];
    foreach (colAll('im/' . $id . '/f') as [$fid, $f]) {
        $out[] = ['id' => (string) $fid, 'n' => (string) ($f->n ?? ''), 'ty' => (string) ($f->ty ?? ''), 'sz' => (int) ($f->sz ?? 0), 'at' => (int) ($f->at ?? 0), 'c' => (string) ($f->c ?? ''), 'w' => (string) ($f->w ?? '')];
    }
    usort($out, fn($a, $b) => $b['at'] <=> $a['at']);
    return $out;
}
function imName(string $uid): string
{
    $r = $uid !== '' ? userRow($uid) : null;
    return $r ? (string) $r['name'] : '';
}
/** The next step not done (by due date) and how many are overdue. */
function imNext(stdClass $c): array
{
    $today = date('Y-m-d');
    $next = null;
    $late = 0;
    foreach ((array) ($c->steps ?? []) as $s) {
        if (!empty($s->done)) {
            continue;
        }
        $due = (string) ($s->due ?? '');
        if ($due !== '' && $due < $today) {
            $late++;
        }
        if ($next === null || ($due !== '' && ((string) ($next->due ?? '') === '' || $due < (string) $next->due))) {
            $next = $s;
        }
    }
    return [$next ? ['id' => (string) $next->id, 't' => (string) $next->t, 'due' => (string) ($next->due ?? ''), 'who' => (string) ($next->who ?? 'hr')] : null, $late];
}
function imView(stdClass $c, array $u, bool $full = false): array
{
    $staff = imStaff($u);
    $T = imTypes()[(string) $c->type] ?? imTypes()['other'];
    [$next, $late] = imNext($c);
    $out = [
        'id' => (string) $c->id, 'num' => (string) ($c->num ?? ''), 'type' => (string) $c->type, 'typeN' => $T['n'], 'baseN' => $T['base'], 'uid' => (string) $c->uid, 'n' => imName((string) $c->uid),
        'title' => (string) ($c->title ?? ''), 'st' => (string) $c->st, 'base' => (string) ($c->base ?? ''), 'filed' => (string) ($c->filed ?? ''), 'pd' => (string) ($c->pd ?? ''),
        'from' => (string) ($c->from ?? ''), 'to' => (string) ($c->to ?? ''), 'decAt' => (string) ($c->decAt ?? ''), 'premium' => !empty($c->premium), 'rcpts' => array_values(json_decode((string) json_encode($c->rcpts ?? []), true) ?: []),
        'atty' => json_decode((string) json_encode($c->atty ?? new stdClass()), true) ?: [], 'owner' => (string) ($c->owner ?? ''), 'ownerN' => imName((string) ($c->owner ?? '')),
        'next' => $next, 'late' => $late, 'at' => (int) ($c->at ?? 0), 'u' => (int) ($c->u ?? 0), 'staff' => $staff,
    ];
    if ($full) {
        $steps = array_values(json_decode((string) json_encode($c->steps ?? []), true) ?: []);
        $msgs = array_values(json_decode((string) json_encode($c->msgs ?? []), true) ?: []);
        $reqs = array_values(json_decode((string) json_encode($c->reqs ?? []), true) ?: []);
        $files = imFiles((string) $c->id);
        if (!$staff) {
            // the person: messages meant for them, the documents they uploaded or HR shared, no internal notes
            $msgs = array_values(array_filter($msgs, fn($m) => ($m['vis'] ?? 'all') === 'all'));
            $files = array_values(array_filter($files, fn($f) => $f['w'] === 'p'));
            foreach ($steps as &$s) {
                unset($s['note']);
            }
            unset($s);
        }
        $out += ['steps' => $steps, 'msgs' => $msgs, 'reqs' => $reqs, 'files' => $files, 'tok' => $staff ? (string) ($c->tok ?? '') : (string) ($c->ptok ?? ''), 'hint' => $T['hint'], 'gcSt' => imGcStatus($c)];
        if ($staff) {
            $out += ['lca' => json_decode((string) json_encode($c->lca ?? new stdClass()), true) ?: [], 'notes' => (string) ($c->notes ?? ''), 'log' => array_reverse(array_values(json_decode((string) json_encode($c->log ?? []), true) ?: []))];
            // v45.1: green card category and country, the LCA public access file, the attorney's links (never their tokens)
            $out['gc'] = ['cat' => (string) ($c->gc->cat ?? ''), 'cty' => (string) ($c->gc->cty ?? 'row')];
            $out['paf'] = str_starts_with((string) $c->type, 'h1b') ? ['items' => json_decode((string) json_encode($c->paf->items ?? new stdClass()), true) ?: [], 'note' => (string) ($c->paf->note ?? ''), 'list' => IM_PAF, 'core' => IM_PAF_CORE] : null;
            $out['grants'] = array_map(fn($g) => ['id' => (string) $g->id, 'email' => (string) $g->email, 'exp' => (int) $g->exp, 'used' => (int) ($g->used ?? 0), 'rev' => !empty($g->rev), 'at' => (int) $g->at, 'live' => empty($g->rev) && (int) $g->exp > now()], array_values((array) ($c->grants ?? [])));
        }
    }
    return $out;
}
function imLog(stdClass $c, array $u, string $ev): void
{
    $log = (array) ($c->log ?? []);
    $log[] = (object) ['t' => now(), 'who' => (string) $u['name'], 'ev' => mb_substr($ev, 0, 300)];
    $c->log = array_slice($log, -200);
}
function imSave(stdClass $c): void
{
    $id = (string) $c->id;
    unset($c->id);
    $c->u = now();
    docSet('im/' . $id, $c);
    $c->id = $id;
}
function imMail(string $uid, string $subject, string $body, string $link): void
{
    $row = $uid !== '' ? userRow($uid) : null;
    if (!$row || !filter_var((string) $row['email'], FILTER_VALIDATE_EMAIL)) {
        return;
    }
    try {
        sendMail((string) $row['email'], (string) $row['name'], $subject, $body . "\n\n" . siteUrl() . $link, emailHtml($subject, preg_split('/\n{2,}/', $body), ['Open it', siteUrl() . $link]));
    } catch (Throwable $e) {
        // the change stands; the email can be missed
    }
}
/** Where HR hears about a case: its owner, else every HR person. */
function imStaffTo(stdClass $c): array
{
    if ((string) ($c->owner ?? '') !== '') {
        return [(string) $c->owner];
    }
    $out = [];
    foreach (db()->query("SELECT * FROM users WHERE status = 'active' LIMIT 3000")->fetchAll() as $r) {
        if (hasRole($r, 'hr')) {
            $out[] = (string) $r['id'];
        }
    }
    return array_slice($out, 0, 10);
}
/** The next case number of the year (IM-2026-001), counted in the main database's meta table like claim numbers. */
function imNum(): string
{
    $p = db();
    $k = 'im' . date('Y');
    $p->beginTransaction();
    try {
        if (!$p->query("SELECT v FROM meta WHERE k='$k'")->fetch()) {
            $p->exec("INSERT INTO meta (k, v) VALUES ('$k', 0)");
        }
        $p->exec("UPDATE meta SET v = v + 1 WHERE k = '$k'");
        $n = (int) $p->query("SELECT v FROM meta WHERE k = '$k'")->fetchColumn();
        $p->commit();
    } catch (Throwable $e) {
        $p->rollBack();
        throw $e;
    }
    return 'IM-' . date('Y') . '-' . str_pad((string) $n, 3, '0', STR_PAD_LEFT);
}
/** The steps of a new case from its template, due dates counted from the base date. */
function imStepsFor(string $type, string $base): array
{
    $out = [];
    foreach ((imTypes()[$type] ?? imTypes()['other'])['steps'] as [$sid, $t, $who, $off]) {
        $out[] = (object) ['id' => $sid, 't' => $t, 'who' => $who, 'off' => $off, 'due' => imAdd($base, $off), 'done' => 0, 'by' => '', 'note' => ''];
    }
    return $out;
}

/** The scheduled job: steps due within 7 days or overdue, one email per person per day (owner/HR, or the person). */
function imCron(): array
{
    require_once __DIR__ . '/mail.php';
    $today = date('Y-m-d');
    $soon = date('Y-m-d', time() + 7 * 86400);
    $state = mkvGet('im_cron', []);
    if (($state['day'] ?? '') === $today) {
        return ['sent' => 0];
    }
    $by = [];
    foreach (colAll('im') as [$id, $c]) {
        if (!in_array((string) ($c->st ?? ''), ['open', 'filed', 'rfe'], true)) {
            continue;
        }
        $c->id = $id;
        foreach ((array) ($c->steps ?? []) as $s) {
            $due = (string) ($s->due ?? '');
            if (!empty($s->done) || $due === '' || $due > $soon) {
                continue;
            }
            $line = ($due < $today ? 'Overdue since ' . $due : 'Due ' . $due) . ': ' . (string) $s->t . ' (' . (string) ($c->num ?? '') . ', ' . imName((string) $c->uid) . ')';
            $to = (string) ($s->who ?? 'hr') === 'person' ? [(string) $c->uid] : imStaffTo($c);
            foreach ($to as $uid) {
                $by[$uid][] = $line;
            }
        }
        // v45.1: an LCA on file (its step done, or its number recorded) needs its public access file within a working day
        if (str_starts_with((string) $c->type, 'h1b')) {
            $lcaIn = (string) ($c->lca->num ?? '') !== '';
            foreach ((array) ($c->steps ?? []) as $s) {
                if ((string) $s->id === 'lca' && !empty($s->done)) {
                    $lcaIn = true;
                }
            }
            $have = array_keys((array) ($c->paf->items ?? []));
            $miss = array_diff(IM_PAF_CORE, $have);
            if ($lcaIn && $miss) {
                foreach (imStaffTo($c) as $uid) {
                    $by[$uid][] = 'Public access file incomplete (' . (count(IM_PAF_CORE) - count($miss)) . ' of ' . count(IM_PAF_CORE) . ' records): ' . (string) ($c->num ?? '') . ', ' . imName((string) $c->uid);
                }
            }
        }
    }
    $n = 0;
    foreach ($by as $uid => $lines) {
        $staff = ($row = userRow((string) $uid)) && imStaff($row);
        imMail((string) $uid, 'Immigration case steps due: ' . count($lines), "These steps are due within a week or overdue:\n\n" . implode("\n", array_slice($lines, 0, 30)), $staff ? '#/portal/hr/immig' : '#/portal/compliance?tab=cases');
        $n++;
    }
    mkvSet('im_cron', ['day' => $today, 'sent' => $n]);
    return ['sent' => $n];
}

/* ---------------------------------------------------------------- v45.1: the Visa Bulletin and priority dates */

/** The October 2026 Visa Bulletin (U.S. Department of State), employment-based: final action dates and dates for
 *  filing; 'C' = current. USCIS accepts the dates-for-filing chart for employment-based adjustment in October 2026. */
function imVbDefault(): array
{
    $row = fn(string $c, string $cn, string $in, string $mx, string $ph) => ['row' => $c, 'cn' => $cn, 'in' => $in, 'mx' => $mx, 'ph' => $ph];
    return [
        'month' => '2026-10', 'chart' => 'filing', 'src' => 'https://travel.state.gov/content/travel/en/legal/visa-law0/visa-bulletin.html',
        'fad' => ['eb1' => $row('C', '2023-07-01', '2023-02-01', 'C', 'C'), 'eb2' => $row('2025-01-01', '2021-10-01', '2013-11-01', '2025-01-01', '2025-01-01'), 'eb3' => $row('2024-05-15', '2022-01-08', '2014-01-01', '2024-05-15', '2023-08-15'), 'ew' => $row('2022-01-01', '2019-10-01', '2014-01-01', '2022-01-01', '2022-01-01')],
        'dff' => ['eb1' => $row('C', '2024-07-01', '2024-07-01', 'C', 'C'), 'eb2' => $row('2026-03-15', '2023-01-01', '2015-01-15', '2026-03-15', '2026-03-15'), 'eb3' => $row('2024-08-01', '2024-04-01', '2015-01-15', '2024-08-01', '2024-01-01'), 'ew' => $row('2022-06-01', '2020-10-01', '2015-01-15', '2022-06-01', '2022-06-01')],
        'hist' => [], 'u' => 0, 'by' => '',
    ];
}
function imVb(): array
{
    $d = docGet('imvb/x');
    return $d ? json_decode((string) json_encode($d), true) : imVbDefault();
}
/** Where a priority date stands against one cut-off: current, or how many months it still has to move. */
function imPdVs(string $pd, string $cut): array
{
    if ($cut === 'C') {
        return ['ok' => true, 'months' => 0];
    }
    if ($cut === 'U' || $cut === '' || $pd === '') {
        return ['ok' => false, 'months' => null];
    }
    if ($pd < $cut) {
        return ['ok' => true, 'months' => 0];
    }
    $a = new DateTime($cut . ' 12:00:00');
    $z = new DateTime($pd . ' 12:00:00');
    $diff = $a->diff($z);
    return ['ok' => false, 'months' => $diff->y * 12 + $diff->m + ($diff->d > 0 ? 1 : 0)];
}
/** A green card case against the bulletin: the final action date, the date for filing, and what that means. */
function imGcStatus(stdClass $c, ?array $vb = null): ?array
{
    if (!in_array((string) $c->type, ['perm', 'i140', 'i485'], true)) {
        return null;
    }
    $cat = (string) ($c->gc->cat ?? '');
    $cty = (string) ($c->gc->cty ?? 'row');
    $pd = (string) ($c->pd ?? '');
    if (!isset(IM_GC_CATS[$cat]) || $pd === '') {
        return ['set' => false];
    }
    $vb = $vb ?? imVb();
    $fad = (string) ($vb['fad'][$cat][$cty] ?? '');
    $dff = (string) ($vb['dff'][$cat][$cty] ?? '');
    $f = imPdVs($pd, $fad);
    $d = imPdVs($pd, $dff);
    $useChart = ($vb['chart'] ?? 'final') === 'filing' ? $d : $f;
    return ['set' => true, 'cat' => $cat, 'cty' => $cty, 'pd' => $pd, 'fad' => $fad, 'dff' => $dff, 'fadOk' => $f['ok'], 'dffOk' => $d['ok'], 'fadMonths' => $f['months'], 'dffMonths' => $d['months'], 'canFile' => $useChart['ok'], 'month' => (string) ($vb['month'] ?? ''), 'chart' => (string) ($vb['chart'] ?? 'final')];
}

/* ---------------------------------------------------------------- v45.1: the H-1B six-year clock */

/** One person's H-1B clock from their compliance profile: the six-year limit with days abroad recaptured, and what
 *  their green card stage allows beyond it (AC21: 3-year extensions with an approved I-140; 1-year extensions with a
 *  PERM or I-140 filed at least 365 days before the limit). */
function imClockOf(string $uid): ?array
{
    $p = docGet('comp/' . $uid . '/profile');
    if (!$p) {
        return null;
    }
    $first = (string) ($p->h1bFirst ?? '');
    if ((string) ($p->st ?? '') !== 'h1b' && $first === '') {
        return null;
    }
    $abroad = max(0, (int) ($p->abroad ?? 0));
    $limit = $first !== '' ? date('Y-m-d', (int) strtotime($first . ' 12:00:00 +6 years') + $abroad * 86400) : '';
    $gc = (string) ($p->gc ?? 'none');
    $pdAt = (string) ($p->pd ?? '');
    $i140 = (string) ($p->i140At ?? '');
    $daysLeft = $limit !== '' ? (int) floor((strtotime($limit . ' 12:00:00') - time()) / 86400) : null;
    $path = 'none';
    if ($i140 !== '' || in_array($gc, ['i140', 'i485'], true)) {
        $path = '3y';
    } elseif ($pdAt !== '' && $limit !== '' && strtotime($pdAt . ' +365 days') <= strtotime($limit)) {
        $path = '1y';
    } elseif ($gc === 'perm' && $pdAt === '') {
        $path = 'perm';
    }
    $startBy = $limit !== '' ? date('Y-m-d', (int) strtotime($limit . ' 12:00:00 -18 months')) : '';
    $risk = $limit !== '' && $path === 'none' && $daysLeft !== null && $daysLeft < 548;
    return ['uid' => $uid, 'n' => imName($uid), 'first' => $first, 'abroad' => $abroad, 'limit' => $limit, 'daysLeft' => $daysLeft, 'h1bExp' => (string) ($p->h1bExp ?? ''), 'gc' => $gc, 'pdAt' => $pdAt, 'i140At' => $i140, 'path' => $path, 'startBy' => $startBy, 'risk' => $risk];
}

/* ---------------------------------------------------------------- v45.1: the attorney's access */

function imTokHash(string $t): string
{
    return hash('sha256', 'imx|' . $t);
}
/** The attorney's grant behind a link token: [case, grant] when it is live, else a refusal. */
function imxGrant(string $t): array
{
    if (!preg_match('/^[a-f0-9]{48}$/', $t)) {
        fail(404, 'not_found', 'This link is not valid.');
    }
    $x = docGet('imx/' . imTokHash($t));
    $c = $x ? docGet('im/' . (string) $x->case) : null;
    if (!$c) {
        fail(404, 'not_found', 'This link is not valid.');
    }
    $c->id = (string) $x->case;
    foreach ((array) ($c->grants ?? []) as $g) {
        if ((string) $g->id === (string) $x->grant) {
            if (!empty($g->rev)) {
                fail(403, 'revoked', 'StratEdge HR has closed this link. Ask them for a new one.');
            }
            if ((int) $g->exp < now()) {
                fail(403, 'expired', 'This link has expired. Ask StratEdge HR for a new one.');
            }
            return [$c, $g];
        }
    }
    fail(404, 'not_found', 'This link is not valid.');
}
/** The attorney has confirmed the code in this browser (for 8 hours). */
function imxSignedIn(string $t): bool
{
    $k = imTokHash($t);
    return (int) ($_SESSION['imx'][$k] ?? 0) > now();
}
/** The case as the attorney sees it: no HR notes or HR-only documents; the attorney thread. */
function imxView(stdClass $c, stdClass $g): array
{
    $T = imTypes()[(string) $c->type] ?? imTypes()['other'];
    $files = array_values(array_filter(imFiles((string) $c->id), fn($f) => in_array($f['w'], ['a', 'p'], true)));
    $msgs = array_values(array_filter(json_decode((string) json_encode($c->msgs ?? []), true) ?: [], fn($m) => in_array($m['vis'] ?? 'all', ['all', 'atty'], true)));
    $steps = array_values(json_decode((string) json_encode($c->steps ?? []), true) ?: []);
    foreach ($steps as &$st) {
        unset($st['note']);
    }
    unset($st);
    return [
        'id' => (string) $c->id, 'num' => (string) ($c->num ?? ''), 'type' => (string) $c->type, 'typeN' => $T['n'], 'baseN' => $T['base'], 'n' => imName((string) $c->uid), 'title' => (string) ($c->title ?? ''), 'st' => (string) $c->st,
        'base' => (string) ($c->base ?? ''), 'filed' => (string) ($c->filed ?? ''), 'pd' => (string) ($c->pd ?? ''), 'from' => (string) ($c->from ?? ''), 'to' => (string) ($c->to ?? ''), 'premium' => !empty($c->premium),
        'rcpts' => array_values(json_decode((string) json_encode($c->rcpts ?? []), true) ?: []), 'lca' => json_decode((string) json_encode($c->lca ?? new stdClass()), true) ?: [], 'steps' => $steps, 'files' => $files, 'msgs' => $msgs,
        'tok' => (string) $g->atok, 'email' => (string) $g->email, 'exp' => (int) $g->exp, 'gc' => imGcStatus($c), 'cats' => IM_DOC_CATS, 'st0' => IM_ST, 'who' => IM_WHO,
    ];
}
/** The attorney's routes (imx_): no portal account; the link token plus a code emailed each visit. */
function imxRoute(string $r, array $b): never
{
    $t = (string) ($b['t'] ?? ($_POST['t'] ?? ''));
    [$c, $g] = imxGrant($t);
    $k = imTokHash($t);
    $who = 'Attorney ' . (string) $g->email;
    $save = function () use ($c) {
        $id = (string) $c->id;
        unset($c->id);
        $c->u = now();
        docSet('im/' . $id, $c);
        $c->id = $id;
    };
    $logAs = function (string $ev) use ($c, $who) {
        $log = (array) ($c->log ?? []);
        $log[] = (object) ['t' => now(), 'who' => $who, 'ev' => mb_substr($ev, 0, 300)];
        $c->log = array_slice($log, -200);
    };
    if ($r === 'imx_start') {
        // a fresh code to the attorney's email (at most 5 an hour per link)
        if (throttleHit('imxcode:' . $k, 5, 3600)) {
            fail(429, 'slow_down', 'Several codes were sent already. Wait a little, then try again.');
        }
        $code = (string) random_int(100000, 999999);
        $x = docGet('imx/' . $k);
        $x->code = hash('sha256', $k . '|' . $code);
        $x->codeExp = now() + 10 * 60000;
        $x->tries = 0;
        docSet('imx/' . $k, $x);
        try {
            sendMail((string) $g->email, '', 'Your code for case ' . (string) ($c->num ?? ''), "Your one-time code is $code. It works for 10 minutes.", emailHtml('Your code for case ' . (string) ($c->num ?? ''), ['Your one-time code is ' . $code . '.', 'It works for 10 minutes. If you did not ask for it, you can ignore this email.']));
        } catch (Throwable $e) {
            fail(503, 'unavailable', 'The code could not be emailed. Try again in a minute.');
        }
        [$l, $d] = explode('@', (string) $g->email, 2);
        ok(['email' => mb_substr($l, 0, 2) . str_repeat('•', max(1, mb_strlen($l) - 2)) . '@' . $d, 'num' => (string) ($c->num ?? '')]);
    }
    if ($r === 'imx_verify') {
        $x = docGet('imx/' . $k);
        $code = preg_replace('/\D/', '', (string) ($b['code'] ?? ''));
        if ((int) ($x->tries ?? 0) >= 5 || (int) ($x->codeExp ?? 0) < now()) {
            fail(403, 'expired', 'That code has expired. Ask for a new one.');
        }
        if (!hash_equals((string) ($x->code ?? ''), hash('sha256', $k . '|' . $code))) {
            $x->tries = (int) ($x->tries ?? 0) + 1;
            docSet('imx/' . $k, $x);
            fail(400, 'invalid_argument', 'That code is not right.');
        }
        unset($x->code, $x->codeExp);
        docSet('imx/' . $k, $x);
        $_SESSION['imx'][$k] = now() + 8 * 3600000;
        foreach ((array) $c->grants as $gg) {
            if ((string) $gg->id === (string) $g->id) {
                $gg->used = now();
            }
        }
        $logAs('Attorney opened the case');
        $save();
        ok(['case' => imxView($c, $g)]);
    }
    if (!imxSignedIn($t)) {
        fail(401, 'code_needed', 'Confirm the code sent to your email first.');
    }
    switch ($r) {
        case 'imx_case':
            ok(['case' => imxView($c, $g)]);
        case 'imx_step':
            $sid = preg_replace('/[^a-z0-9]/', '', (string) ($b['step'] ?? ''));
            foreach ((array) $c->steps as $st) {
                if ((string) $st->id === $sid) {
                    if ((string) $st->who !== 'atty') {
                        fail(403, 'forbidden', 'The attorney ticks the attorney\'s steps; HR keeps the others.');
                    }
                    $st->done = !empty($b['done']) ? now() : 0;
                    $st->by = !empty($b['done']) ? $who : '';
                    $logAs((!empty($b['done']) ? 'Done: ' : 'Not done: ') . (string) $st->t);
                    $save();
                    ok(['case' => imxView($c, $g)]);
                }
            }
            fail(404, 'not_found', 'No such step.');
        case 'imx_rcpt':
            $num = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string) ($b['num'] ?? '')));
            if (!preg_match('/^[A-Z]{3}\d{10}$/', $num)) {
                fail(400, 'invalid_argument', 'A USCIS receipt number is 3 letters and 10 digits, like EAC2690012345.');
            }
            $rc = (array) ($c->rcpts ?? []);
            $rc[] = (object) ['form' => mb_substr(trim((string) ($b['form'] ?? '')), 0, 20), 'num' => $num, 'at' => imDate((string) ($b['at'] ?? ''))];
            $c->rcpts = array_slice($rc, -12);
            $logAs('Receipt added: ' . $num);
            $save();
            foreach (imStaffTo($c) as $to) {
                imMail($to, 'Receipt on ' . (string) $c->num . ': ' . $num, (string) $g->email . ' added the receipt ' . $num . ' to case ' . (string) $c->num . '.', '#/portal/hr/immig?c=' . (string) $c->id);
            }
            ok(['case' => imxView($c, $g)]);
        case 'imx_msg':
            $txt = mb_substr(trim((string) ($b['txt'] ?? '')), 0, 4000);
            if ($txt === '') {
                fail(400, 'invalid_argument', 'Write the message first.');
            }
            if (throttleHit('imxmsg:' . $k, 60, 3600)) {
                fail(429, 'slow_down', 'Too many messages in an hour.');
            }
            $msgs = (array) ($c->msgs ?? []);
            $msgs[] = (object) ['t' => now(), 'by' => 'atty:' . (string) $g->id, 'who' => $who, 'txt' => $txt, 'vis' => 'atty', 'staff' => false, 'atty' => true];
            $c->msgs = array_slice($msgs, -300);
            $save();
            foreach (imStaffTo($c) as $to) {
                imMail($to, 'Attorney message on ' . (string) $c->num, (string) $g->email . ' wrote: ' . $txt, '#/portal/hr/immig?c=' . (string) $c->id);
            }
            ok(['case' => imxView($c, $g)]);
        case 'imx_upload':
            if (throttleHit('imxup:' . $k, 60, 3600)) {
                fail(429, 'slow_down', 'Too many uploads in an hour.');
            }
            if (count(imFiles((string) $c->id)) >= 150) {
                fail(400, 'invalid_argument', 'This case already holds 150 documents.');
            }
            $cat = (string) ($_POST['cat'] ?? 'other');
            $doc = storeUpload($_FILES['file'] ?? [], 'im/' . (string) $c->id, ['c' => isset(IM_DOC_CATS[$cat]) ? $cat : 'other', 'w' => 'a']);
            $logAs('Document added by the attorney: ' . (string) $doc['n']);
            $save();
            foreach (imStaffTo($c) as $to) {
                imMail($to, 'Attorney document on ' . (string) $c->num, (string) $g->email . ' added ' . (string) $doc['n'] . ' to case ' . (string) $c->num . ' (HR and the attorney see it).', '#/portal/hr/immig?c=' . (string) $c->id);
            }
            ok(['case' => imxView($c, $g)]);
    }
    fail(404, 'not_found', 'Unknown request.');
}

function imRoute(string $r, array $b): never
{
    $u = requireUser();
    $staff = imStaff($u);
    $str = fn(string $k, int $max) => mb_substr(trim((string) ($b[$k] ?? '')), 0, $max);
    $needStaff = function () use ($staff) {
        if (!$staff) {
            fail(403, 'forbidden', 'Immigration cases are run by HR and administrators.');
        }
    };
    switch ($r) {
        case 'im_types':
            $out = [];
            foreach (imTypes() as $k => $T) {
                $out[] = ['k' => $k, 'n' => $T['n'], 'base' => $T['base'], 'hint' => $T['hint'], 'steps' => array_map(fn($s) => ['id' => $s[0], 't' => $s[1], 'who' => $s[2], 'off' => $s[3]], $T['steps'])];
            }
            ok(['types' => $out, 'st' => IM_ST, 'who' => IM_WHO, 'cats' => IM_DOC_CATS, 'staff' => $staff]);

        case 'im_list':
            $needStaff();
            $rows = [];
            foreach (colAll('im') as [$id, $c]) {
                $c->id = $id;
                $rows[] = imView($c, $u);
            }
            usort($rows, fn($a, $b2) => [in_array($a['st'], ['approved', 'denied', 'withdrawn', 'closed'], true), $a['next']['due'] ?? '9999'] <=> [in_array($b2['st'], ['approved', 'denied', 'withdrawn', 'closed'], true), $b2['next']['due'] ?? '9999']);
            ok(['cases' => $rows]);

        case 'im_people':
            $needStaff();
            require_once __DIR__ . '/goals.php';
            ok(['people' => array_values(array_map(fn($p) => ['id' => $p['id'], 'n' => $p['n'], 'e' => $p['e'], 'staff' => ($row = userRow($p['id'])) !== null && imStaff($row)], pfPeople()))]);

        case 'im_mine':
            $rows = [];
            foreach (colAll('im') as [$id, $c]) {
                if ((string) $c->uid === $u['id']) {
                    $c->id = $id;
                    $rows[] = imView($c, ['roles' => ['user']] + $u, true);
                }
            }
            usort($rows, fn($a, $b2) => $b2['u'] <=> $a['u']);
            ok(['cases' => $rows, 'st' => IM_ST, 'who' => IM_WHO, 'cats' => IM_DOC_CATS]);

        case 'im_get':
            $c = imGet($str('id', 30), $u);
            ok(['case' => imView($c, $u, true), 'st' => IM_ST, 'who' => IM_WHO, 'cats' => IM_DOC_CATS]);

        case 'im_save':
            // a new case (type, person, base date) or the case's details; status changes and the decision dates too
            $needStaff();
            if (throttleHit('imsave:' . $u['id'], 300, 3600)) {
                fail(429, 'slow_down', 'Too many changes in an hour.');
            }
            $id = $str('id', 30);
            $c = $id !== '' ? imGet($id, $u) : null;
            $isNew = !$c;
            if ($isNew) {
                $type = (string) ($b['type'] ?? '');
                if (!isset(imTypes()[$type])) {
                    fail(400, 'invalid_argument', 'Choose the kind of case.');
                }
                $uid = $str('uid', 30);
                $row = $uid !== '' ? userRow($uid) : null;
                if (!$row || (string) $row['status'] !== 'active') {
                    fail(400, 'invalid_argument', 'Choose who the case is for.');
                }
                $base = imDate($str('base', 10));
                $c = (object) ['id' => rid(10), 'num' => imNum(), 'type' => $type, 'uid' => $uid, 'st' => 'open', 'base' => $base, 'steps' => imStepsFor($type, $base), 'msgs' => [], 'reqs' => [], 'rcpts' => [], 'tok' => rid(16), 'ptok' => rid(16), 'at' => now(), 'by' => $u['id'], 'owner' => $u['id']];
            }
            if ($isNew || array_key_exists('title', $b)) {
                $c->title = $str('title', 160);
            }
            if (array_key_exists('owner', $b)) {
                $ow = $str('owner', 30);
                $orow = $ow !== '' ? userRow($ow) : null;
                $c->owner = $orow && imStaff($orow) ? $ow : '';
            }
            foreach (['filed', 'pd', 'from', 'to', 'decAt'] as $k) {
                if (array_key_exists($k, $b)) {
                    $c->$k = imDate($str($k, 10));
                }
            }
            if ((string) ($c->from ?? '') !== '' && (string) ($c->to ?? '') !== '' && $c->to < $c->from) {
                fail(400, 'invalid_argument', 'The validity ends before it starts.');
            }
            if (array_key_exists('premium', $b)) {
                $c->premium = !empty($b['premium']);
            }
            if (array_key_exists('atty', $b)) {
                $a = (array) $b['atty'];
                $c->atty = (object) ['n' => mb_substr(trim((string) ($a['n'] ?? '')), 0, 100), 'firm' => mb_substr(trim((string) ($a['firm'] ?? '')), 0, 120), 'e' => filter_var(trim((string) ($a['e'] ?? '')), FILTER_VALIDATE_EMAIL) ? trim((string) $a['e']) : '', 'ph' => mb_substr(trim((string) ($a['ph'] ?? '')), 0, 40)];
            }
            if (array_key_exists('lca', $b)) {
                $l = (array) $b['lca'];
                $c->lca = (object) ['num' => mb_substr(trim((string) ($l['num'] ?? '')), 0, 40), 'soc' => mb_substr(trim((string) ($l['soc'] ?? '')), 0, 20), 'level' => in_array((string) ($l['level'] ?? ''), ['I', 'II', 'III', 'IV'], true) ? (string) $l['level'] : '', 'wage' => mb_substr(trim((string) ($l['wage'] ?? '')), 0, 40), 'sites' => mb_substr(trim((string) ($l['sites'] ?? '')), 0, 400)];
            }
            if (array_key_exists('rcpts', $b)) {
                $rc = [];
                foreach (array_slice((array) $b['rcpts'], 0, 12) as $x) {
                    $x = (array) $x;
                    $num = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string) ($x['num'] ?? '')));
                    if ($num === '') {
                        continue;
                    }
                    if (!preg_match('/^[A-Z]{3}\d{10}$/', $num)) {
                        fail(400, 'invalid_argument', 'A USCIS receipt number is 3 letters and 10 digits, like EAC2690012345 (' . $num . ').');
                    }
                    $rc[] = ['form' => mb_substr(trim((string) ($x['form'] ?? '')), 0, 20), 'num' => $num, 'at' => imDate((string) ($x['at'] ?? ''))];
                }
                $c->rcpts = $rc;
            }
            if (array_key_exists('notes', $b)) {
                $c->notes = $str('notes', 6000);
            }
            if (array_key_exists('gc', $b)) {
                $g = (array) $b['gc'];
                $c->gc = (object) ['cat' => isset(IM_GC_CATS[$g['cat'] ?? '']) ? (string) $g['cat'] : '', 'cty' => isset(IM_GC_CTY[$g['cty'] ?? '']) ? (string) $g['cty'] : 'row'];
            }
            if (!$isNew && array_key_exists('base', $b)) {
                // a new base date moves the due dates of the template steps not done yet (with the same offsets)
                $nb = imDate($str('base', 10));
                if ($nb !== (string) ($c->base ?? '')) {
                    foreach ((array) $c->steps as $s) {
                        if (empty($s->done) && isset($s->off) && $s->off !== null && $nb !== '') {
                            $s->due = imAdd($nb, (int) $s->off);
                        }
                    }
                    imLog($c, $u, 'Key date ' . ((string) ($c->base ?? '') ?: 'none') . ' → ' . ($nb ?: 'none') . '; open steps moved with it');
                    $c->base = $nb;
                }
            }
            $st = (string) ($b['st'] ?? $c->st);
            if (isset(IM_ST[$st]) && $st !== (string) $c->st) {
                imLog($c, $u, 'Status: ' . IM_ST[(string) $c->st] . ' → ' . IM_ST[$st]);
                if (in_array($st, ['approved', 'denied'], true)) {
                    imMail((string) $c->uid, 'Your case ' . (string) $c->num . ' (' . (imTypes()[$c->type]['n'] ?? 'immigration') . '): ' . strtolower(IM_ST[$st]), 'StratEdge recorded a decision on your case ' . (string) $c->num . ': ' . strtolower(IM_ST[$st]) . '. Open it in your portal (USCIS compliance › My cases).', '#/portal/compliance?tab=cases');
                }
                $c->st = $st;
            }
            if ($isNew) {
                imLog($c, $u, 'Case opened: ' . imTypes()[$c->type]['n']);
            } else {
                imLog($c, $u, 'Details changed');
            }
            imSave($c);
            if ($isNew) {
                imMail((string) $c->uid, 'StratEdge opened a case for you: ' . imTypes()[$c->type]['n'], 'HR opened your case ' . (string) $c->num . ' (' . imTypes()[$c->type]['n'] . '). Its steps, the documents HR asks you for and messages are in your portal under USCIS compliance › My cases.', '#/portal/compliance?tab=cases');
            }
            ok(['case' => imView($c, $u, true)]);

        case 'im_step':
            // HR: mark done or not, change the due date, the note; add or remove a step. The person: their own steps done.
            $c = imGet($str('id', 30), $u);
            $sid = preg_replace('/[^a-z0-9]/', '', $str('step', 20));
            if (!empty($b['add'])) {
                $needStaff();
                $t = $str('t', 200);
                if ($t === '') {
                    fail(400, 'invalid_argument', 'Name the step.');
                }
                $steps = (array) $c->steps;
                if (count($steps) >= 40) {
                    fail(400, 'invalid_argument', 'At most 40 steps.');
                }
                $steps[] = (object) ['id' => 's' . rid(3), 't' => $t, 'who' => isset(IM_WHO[$b['who'] ?? '']) ? (string) $b['who'] : 'hr', 'off' => null, 'due' => imDate($str('due', 10)), 'done' => 0, 'by' => '', 'note' => ''];
                $c->steps = $steps;
                imLog($c, $u, 'Step added: ' . $t);
                imSave($c);
                ok(['case' => imView($c, $u, true)]);
            }
            $found = null;
            foreach ((array) $c->steps as $s) {
                if ((string) $s->id === $sid) {
                    $found = $s;
                }
            }
            if (!$found) {
                fail(404, 'not_found', 'No such step.');
            }
            if (!$staff && ((string) $found->who !== 'person' || array_key_exists('due', $b) || array_key_exists('note', $b) || !empty($b['remove']))) {
                fail(403, 'forbidden', 'HR keeps the case; you can tick off your own steps.');
            }
            if (!empty($b['remove'])) {
                $c->steps = array_values(array_filter((array) $c->steps, fn($s) => (string) $s->id !== $sid));
                imLog($c, $u, 'Step removed: ' . (string) $found->t);
            } else {
                if (array_key_exists('done', $b)) {
                    $found->done = !empty($b['done']) ? now() : 0;
                    $found->by = !empty($b['done']) ? (string) $u['name'] : '';
                    imLog($c, $u, (!empty($b['done']) ? 'Done: ' : 'Not done: ') . (string) $found->t);
                    if (!$staff && !empty($b['done'])) {
                        foreach (imStaffTo($c) as $to) {
                            imMail($to, 'Step done on ' . (string) $c->num, imName((string) $c->uid) . ' marked "' . (string) $found->t . '" done.', '#/portal/hr/immig?c=' . (string) $c->id);
                        }
                    }
                }
                if (array_key_exists('due', $b)) {
                    $found->due = imDate($str('due', 10));
                }
                if (array_key_exists('note', $b)) {
                    $found->note = $str('note', 1000);
                }
            }
            imSave($c);
            ok(['case' => imView($c, $u, true)]);

        case 'im_msg':
            // a message on the case: HR to the person (or an internal note), the person to HR
            $c = imGet($str('id', 30), $u);
            $txt = $str('txt', 4000);
            if ($txt === '') {
                fail(400, 'invalid_argument', 'Write the message first.');
            }
            if (throttleHit('immsg:' . $u['id'], 120, 3600)) {
                fail(429, 'slow_down', 'Too many messages in an hour.');
            }
            $vis = $staff && in_array($b['vis'] ?? '', ['staff', 'atty'], true) ? (string) $b['vis'] : 'all';
            $msgs = (array) ($c->msgs ?? []);
            $msgs[] = (object) ['t' => now(), 'by' => $u['id'], 'who' => (string) $u['name'], 'txt' => $txt, 'vis' => $vis, 'staff' => $staff];
            $c->msgs = array_slice($msgs, -300);
            imSave($c);
            if ($vis === 'atty') {
                // v45.1: the attorney thread: the attorneys with a live link hear about it
                foreach ((array) ($c->grants ?? []) as $g) {
                    if (empty($g->rev) && (int) $g->exp > now()) {
                        try {
                            sendMail((string) $g->email, '', 'A message from StratEdge HR on case ' . (string) $c->num, $u['name'] . ' wrote: ' . $txt . "\n\nOpen the case with the link HR sent you.", emailHtml('A message on case ' . (string) $c->num, [$u['name'] . ' wrote: ' . $txt, 'Open the case with the link StratEdge HR sent you.']));
                        } catch (Throwable $e) {
                            // the message stands; the email can be missed
                        }
                    }
                }
            } elseif ($vis === 'all' && $staff && (string) $c->uid !== $u['id']) {
                imMail((string) $c->uid, 'A message about your case ' . (string) $c->num, $u['name'] . ' wrote: ' . $txt, '#/portal/compliance?tab=cases');
            } elseif (!$staff) {
                foreach (imStaffTo($c) as $to) {
                    imMail($to, 'Message on ' . (string) $c->num . ' from ' . $u['name'], $txt, '#/portal/hr/immig?c=' . (string) $c->id);
                }
            }
            ok(['case' => imView($c, $u, true)]);

        case 'im_req':
            // HR asks the person for a document (or closes the request); the person answers by uploading it
            $needStaff();
            $c = imGet($str('id', 30), $u);
            $reqs = (array) ($c->reqs ?? []);
            if (!empty($b['close'])) {
                foreach ($reqs as $q) {
                    if ((string) $q->id === $str('req', 20)) {
                        $q->st = 'closed';
                    }
                }
            } else {
                $n = $str('n', 160);
                if ($n === '') {
                    fail(400, 'invalid_argument', 'Say which document you need.');
                }
                $reqs[] = (object) ['id' => 'q' . rid(3), 'n' => $n, 'cat' => isset(IM_DOC_CATS[$b['cat'] ?? '']) ? (string) $b['cat'] : 'other', 'st' => 'open', 'at' => now(), 'due' => imDate($str('due', 10))];
                imMail((string) $c->uid, 'StratEdge needs a document for your case ' . (string) $c->num, 'Please upload: ' . $n . '. Open the case in your portal (USCIS compliance › My cases) and use "Upload" next to the request.', '#/portal/compliance?tab=cases');
            }
            $c->reqs = array_slice($reqs, -60);
            imLog($c, $u, !empty($b['close']) ? 'Document request closed' : 'Document requested: ' . $str('n', 160));
            imSave($c);
            ok(['case' => imView($c, $u, true)]);

        case 'im_upload':
            // multipart: id, cat, req (the request it answers), share (HR: the person may open it)
            $c = imGet((string) ($_POST['id'] ?? ''), $u);
            if (throttleHit('imup:' . $u['id'], 120, 3600)) {
                fail(429, 'slow_down', 'Too many uploads in an hour.');
            }
            $cat = (string) ($_POST['cat'] ?? 'other');
            $req = preg_replace('/[^a-z0-9]/', '', (string) ($_POST['req'] ?? ''));
            if (!$staff && $req === '') {
                fail(400, 'invalid_argument', 'Upload a document HR asked for (it goes next to the request).');
            }
            if (count(imFiles((string) $c->id)) >= 150) {
                fail(400, 'invalid_argument', 'This case already holds 150 documents.');
            }
            $vis = !$staff ? 'p' : (isset(IM_VIS[$_POST['vis'] ?? '']) ? (string) $_POST['vis'] : (!empty($_POST['share']) ? 'p' : 's'));
            $doc = storeUpload($_FILES['file'] ?? [], 'im/' . (string) $c->id, ['c' => (isset(IM_DOC_CATS[$cat]) ? $cat : 'other') . ($req !== '' ? ':' . $req : ''), 'w' => $vis]);
            $reqs = (array) ($c->reqs ?? []);
            foreach ($reqs as $q) {
                if ($req !== '' && (string) $q->id === $req) {
                    $q->st = 'received';
                    $q->fid = (string) $doc['id'];
                }
            }
            $c->reqs = $reqs;
            imLog($c, $u, 'Document added: ' . (string) $doc['n'] . ' (' . strtolower(IM_VIS[$vis]) . ')');
            imSave($c);
            if (!$staff) {
                foreach (imStaffTo($c) as $to) {
                    imMail($to, 'Document received on ' . (string) $c->num, imName((string) $c->uid) . ' uploaded ' . (string) $doc['n'] . '.', '#/portal/hr/immig?c=' . (string) $c->id);
                }
            }
            ok(['case' => imView($c, $u, true)]);

        case 'im_file':
            // HR: share a document with the person or take it back, or delete it
            $needStaff();
            $c = imGet($str('id', 30), $u);
            $fid = preg_replace('/[^a-f0-9]/', '', $str('fid', 40));
            $f = $fid !== '' ? docGet('im/' . (string) $c->id . '/f/' . $fid) : null;
            if (!$f) {
                fail(404, 'not_found', 'No such document.');
            }
            if (!empty($b['delete'])) {
                docDelete('im/' . (string) $c->id . '/f/' . $fid);
                @unlink(cfg('files_dir') . '/' . $fid);
                imLog($c, $u, 'Document deleted: ' . (string) $f->n);
            } else {
                $f->w = isset(IM_VIS[$b['vis'] ?? '']) ? (string) $b['vis'] : (!empty($b['share']) ? 'p' : 's');
                docSet('im/' . (string) $c->id . '/f/' . $fid, $f);
                imLog($c, $u, 'Who sees ' . (string) $f->n . ': ' . strtolower(IM_VIS[$f->w]));
            }
            imSave($c);
            ok(['case' => imView($c, $u, true)]);

        case 'im_comp_sync':
            // the case's dates into the person's compliance profile (status, approval and EAD dates, green card stage)
            $needStaff();
            $c = imGet($str('id', 30), $u);
            $p = docGet('comp/' . (string) $c->uid . '/profile') ?? new stdClass();
            $set = [];
            $type = (string) $c->type;
            $to = (string) ($c->to ?? '');
            $from = (string) ($c->from ?? '');
            $isH1b = in_array($type, ['h1bcap', 'h1bxfer', 'h1bext', 'h1bamend'], true);
            if ($isH1b && (string) $c->st === 'approved' && $to !== '') {
                $set['st'] = 'h1b';
                $set['h1bExp'] = $to;
                if ($type === 'h1bcap' && $from !== '' && (string) ($p->h1bFirst ?? '') === '') {
                    $set['h1bFirst'] = $from;
                }
            }
            if ($type === 'stemopt' && (string) $c->st === 'approved' && $from !== '' && $to !== '') {
                $set += ['st' => 'f1stem', 'stemStart' => $from, 'stemEnd' => $to, 'stem' => true];
            }
            if (in_array($type, ['eadrenew', 'h4ead'], true) && (string) $c->st === 'approved' && $to !== '') {
                $set['eadExp'] = $to;
                if ($type === 'h4ead') {
                    $set['st'] = 'h4ead';
                }
            }
            if ($type === 'perm' && (string) ($c->filed ?? '') !== '') {
                $set += ['gc' => 'perm', 'pd' => (string) $c->filed];
            }
            if ($type === 'i140' && (string) $c->st === 'approved') {
                $set += ['gc' => 'i140', 'i140At' => (string) ($c->decAt ?? '') ?: date('Y-m-d')];
                if ((string) ($c->pd ?? '') !== '') {
                    $set['pd'] = (string) $c->pd;
                }
            }
            if ($type === 'i485' && (string) ($c->filed ?? '') !== '') {
                $set += ['gc' => 'i485', 'i485At' => (string) $c->filed, 'st' => 'gcpend'];
            }
            $rc = (array) ($c->rcpts ?? []);
            if ($rc) {
                $set['receipt'] = (string) (end($rc)->num ?? '');
            }
            if (!empty($c->atty) && (string) ($c->atty->n ?? '') !== '') {
                $set['attorney'] = trim((string) $c->atty->n . ((string) ($c->atty->firm ?? '') !== '' ? ', ' . (string) $c->atty->firm : ''));
                if ((string) ($c->atty->e ?? '') !== '') {
                    $set['attorneyEmail'] = (string) $c->atty->e;
                }
            }
            if (!array_diff_key($set, ['receipt' => 1, 'attorney' => 1, 'attorneyEmail' => 1])) {
                fail(409, 'conflict', 'Nothing to copy yet: record the decision and its dates (or the filing date) first.');
            }
            foreach ($set as $k => $v) {
                $p->$k = $v;
            }
            $p->u = now();
            $p->by = $u['id'];
            docSet('comp/' . (string) $c->uid . '/profile', $p);
            imLog($c, $u, 'Dates copied to the compliance profile: ' . implode(', ', array_keys($set)));
            imSave($c);
            ok(['set' => $set, 'case' => imView($c, $u, true)]);

        /* ------------------------------------------------ v45.1 */

        case 'im_atty_grant':
            // a secure link for the case's attorney (emailed; each visit also asks for a code sent to that email)
            $needStaff();
            $c = imGet($str('id', 30), $u);
            $email = strtolower($str('email', 190) ?: (string) ($c->atty->e ?? ''));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                fail(400, 'invalid_argument', 'Give the attorney\'s email address (Details › Attorney).');
            }
            if (throttleHit('imgrant:' . $u['id'], 30, 3600)) {
                fail(429, 'slow_down', 'Too many links in an hour.');
            }
            $days = max(1, min(90, (int) ($b['days'] ?? 30)));
            $t = rid(24);
            $g = (object) ['id' => rid(4), 'email' => $email, 'exp' => now() + $days * 86400000, 'at' => now(), 'by' => $u['id'], 'used' => 0, 'rev' => 0, 'atok' => rid(16)];
            $grants = (array) ($c->grants ?? []);
            $grants[] = $g;
            $c->grants = array_slice($grants, -20);
            docSet('imx/' . imTokHash($t), (object) ['case' => (string) $c->id, 'grant' => $g->id, 'at' => now()]);
            imLog($c, $u, 'Secure link sent to the attorney ' . $email . ' (' . $days . ' days)');
            imSave($c);
            $link = rtrim(siteUrl(), '/') . '/#/atty?t=' . $t;
            try {
                sendMail($email, (string) ($c->atty->n ?? ''), 'StratEdge shared case ' . (string) $c->num . ' with you', 'StratEdge HR shared the immigration case ' . (string) $c->num . ' (' . (imTypes()[$c->type]['n'] ?? '') . ', ' . imName((string) $c->uid) . ') with you until ' . date('M j, Y', (int) ($g->exp / 1000)) . ".\n\nOpen it here: $link\n\nEach visit asks for a one-time code sent to this email address.", emailHtml('A case shared with you', ['StratEdge HR shared the immigration case ' . (string) $c->num . ' (' . (imTypes()[$c->type]['n'] ?? '') . ', ' . imName((string) $c->uid) . ') with you until ' . date('M j, Y', (int) ($g->exp / 1000)) . '.', 'Each visit asks for a one-time code sent to this email address. You can see the steps, add receipts, download and upload documents and write to HR.'], ['Open the case', $link]));
            } catch (Throwable $e) {
                fail(503, 'unavailable', 'The link was made but could not be emailed. Close it and try again later.');
            }
            ok(['case' => imView($c, $u, true)]);

        case 'im_atty_revoke':
            $needStaff();
            $c = imGet($str('id', 30), $u);
            foreach ((array) ($c->grants ?? []) as $g) {
                if ((string) $g->id === $str('grant', 10) && empty($g->rev)) {
                    $g->rev = now();
                    imLog($c, $u, 'Attorney link closed: ' . (string) $g->email);
                }
            }
            imSave($c);
            ok(['case' => imView($c, $u, true)]);

        case 'im_vb':
            $needStaff();
            ok(['vb' => imVb(), 'cats' => IM_GC_CATS, 'cty' => IM_GC_CTY]);

        case 'im_vb_save':
            // the month's employment-based cut-off dates, as HR copies them from the Visa Bulletin
            $needStaff();
            $old = imVb();
            $month = preg_match('/^\d{4}-\d{2}$/', (string) ($b['month'] ?? '')) ? (string) $b['month'] : '';
            if ($month === '') {
                fail(400, 'invalid_argument', 'Which month\'s bulletin is it (YYYY-MM)?');
            }
            $clean = function ($tbl) {
                $out = [];
                foreach (IM_GC_CATS as $cat => $_) {
                    foreach (IM_GC_CTY as $cty => $__) {
                        $v = strtoupper(trim((string) ($tbl[$cat][$cty] ?? '')));
                        if ($v !== 'C' && $v !== 'U' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) {
                            fail(400, 'invalid_argument', 'Each cut-off is a date, C (current) or U (unavailable): ' . IM_GC_CATS[$cat] . ', ' . IM_GC_CTY[$cty] . '.');
                        }
                        $out[$cat][$cty] = $v;
                    }
                }
                return $out;
            };
            $vb = ['month' => $month, 'chart' => ($b['chart'] ?? '') === 'filing' ? 'filing' : 'final', 'src' => (string) $old['src'], 'fad' => $clean((array) ($b['fad'] ?? [])), 'dff' => $clean((array) ($b['dff'] ?? [])), 'u' => now(), 'by' => $u['id']];
            $hist = (array) ($old['hist'] ?? []);
            if ((string) $old['month'] !== $month) {
                array_unshift($hist, ['month' => (string) $old['month'], 'chart' => (string) $old['chart'], 'fad' => $old['fad'], 'dff' => $old['dff']]);
            }
            $vb['hist'] = array_slice($hist, 0, 24);
            docSet('imvb/x', json_decode((string) json_encode($vb)));
            audit('settings', 'Visa Bulletin dates entered', $month, [], $u);
            ok(['vb' => imVb()]);

        case 'im_queue':
            // green card cases with a priority date, against this month's bulletin
            $needStaff();
            $vb = imVb();
            $rows = [];
            foreach (colAll('im') as [$id, $c]) {
                $c->id = $id;
                $gs = imGcStatus($c, $vb);
                if ($gs && in_array((string) $c->st, ['open', 'filed', 'rfe', 'approved'], true)) {
                    $rows[] = ['id' => $id, 'num' => (string) ($c->num ?? ''), 'type' => (string) $c->type, 'typeN' => imTypes()[(string) $c->type]['n'], 'n' => imName((string) $c->uid), 'st' => (string) $c->st] + $gs;
                }
            }
            usort($rows, fn($a, $b2) => [!($a['canFile'] ?? false), $a['pd'] ?? '9999'] <=> [!($b2['canFile'] ?? false), $b2['pd'] ?? '9999']);
            ok(['rows' => $rows, 'month' => (string) $vb['month'], 'chart' => (string) $vb['chart']]);

        case 'im_clock':
            // everyone in H-1B status (compliance profiles): the six-year limit and the AC21 path beyond it
            $needStaff();
            $rows = [];
            $s = db()->query("SELECT path FROM docs WHERE path LIKE 'comp/%/profile' AND path NOT LIKE 'comp/x/%'");
            while ($pr = $s->fetch()) {
                $uid = explode('/', (string) $pr['path'])[1];
                $ur = userRow($uid);
                if (!$ur || (string) $ur['status'] !== 'active') {
                    continue;
                }
                $k = imClockOf((string) $uid);
                if ($k) {
                    $rows[] = $k;
                }
            }
            usort($rows, fn($a, $b2) => [!$a['risk'], $a['limit'] === '' ? '9999' : $a['limit']] <=> [!$b2['risk'], $b2['limit'] === '' ? '9999' : $b2['limit']]);
            ok(['rows' => $rows]);

        case 'im_paf_save':
            // the LCA public access file: the date each record went in (or '' when it is not in yet)
            $needStaff();
            $c = imGet($str('id', 30), $u);
            if (!str_starts_with((string) $c->type, 'h1b')) {
                fail(400, 'invalid_argument', 'The public access file belongs to H-1B cases.');
            }
            $items = [];
            foreach (IM_PAF as $k => $_) {
                $v = imDate((string) ($b['items'][$k] ?? ''));
                if ($v !== '') {
                    $items[$k] = $v;
                }
            }
            $c->paf = (object) ['items' => (object) $items, 'note' => $str('note', 1000)];
            $core = count(array_intersect(array_keys($items), IM_PAF_CORE));
            imLog($c, $u, 'Public access file: ' . $core . ' of ' . count(IM_PAF_CORE) . ' required records in');
            imSave($c);
            ok(['case' => imView($c, $u, true)]);

        case 'im_report':
            // open cases by kind and status, how long cases take, decisions this year, approvals ending soon, overdue steps
            $needStaff();
            $year = date('Y');
            $byType = [];
            $bySt = array_fill_keys(array_keys(IM_ST), 0);
            $toFile = [];
            $toDecide = [];
            $dec = ['approved' => 0, 'denied' => 0, 'rfe' => 0];
            $ending = [];
            $overdue = [];
            $today = date('Y-m-d');
            foreach (colAll('im') as [$id, $c]) {
                $c->id = $id;
                $T = imTypes()[(string) $c->type] ?? imTypes()['other'];
                $bySt[(string) $c->st] = ($bySt[(string) $c->st] ?? 0) + 1;
                if (!in_array((string) $c->st, ['approved', 'denied', 'withdrawn', 'closed'], true)) {
                    $byType[$T['n']] = ($byType[$T['n']] ?? 0) + 1;
                }
                $opened = date('Y-m-d', (int) ((int) ($c->at ?? 0) / 1000));
                if ((string) ($c->filed ?? '') !== '') {
                    $toFile[$T['n']][] = max(0, (int) round((strtotime((string) $c->filed) - strtotime($opened)) / 86400));
                    if ((string) ($c->decAt ?? '') !== '') {
                        $toDecide[$T['n']][] = max(0, (int) round((strtotime((string) $c->decAt) - strtotime((string) $c->filed)) / 86400));
                    }
                }
                if (str_starts_with((string) ($c->decAt ?? ''), $year) && in_array((string) $c->st, ['approved', 'denied'], true)) {
                    $dec[(string) $c->st]++;
                }
                foreach ((array) ($c->log ?? []) as $l) {
                    if (str_contains((string) $l->ev, '→ Request for evidence') && date('Y', (int) ((int) $l->t / 1000)) === $year) {
                        $dec['rfe']++;
                        break;
                    }
                }
                if ((string) $c->st === 'approved' && (string) ($c->to ?? '') !== '' && $c->to >= $today && $c->to <= date('Y-m-d', time() + 180 * 86400)) {
                    $ending[] = ['id' => $id, 'num' => (string) ($c->num ?? ''), 'typeN' => $T['n'], 'n' => imName((string) $c->uid), 'to' => (string) $c->to];
                }
                if (!in_array((string) $c->st, ['approved', 'denied', 'withdrawn', 'closed'], true)) {
                    foreach ((array) ($c->steps ?? []) as $st) {
                        if (empty($st->done) && (string) ($st->due ?? '') !== '' && $st->due < $today) {
                            $who = (string) ($c->owner ?? '') !== '' ? imName((string) $c->owner) : 'HR';
                            $overdue[$who] = ($overdue[$who] ?? 0) + 1;
                        }
                    }
                }
            }
            $avg = fn(array $m) => array_map(fn($l) => ['n' => count($l), 'days' => (int) round(array_sum($l) / max(1, count($l)))], $m);
            usort($ending, fn($a, $b2) => $a['to'] <=> $b2['to']);
            arsort($byType);
            arsort($overdue);
            ok(['byType' => $byType, 'bySt' => $bySt, 'toFile' => $avg($toFile), 'toDecide' => $avg($toDecide), 'dec' => $dec, 'year' => $year, 'ending' => $ending, 'overdue' => $overdue, 'st' => IM_ST]);

        case 'im_delete':
            // only a case opened by mistake: no documents, nothing done yet
            $needStaff();
            $c = imGet($str('id', 30), $u);
            $doneAny = count(array_filter((array) $c->steps, fn($s) => !empty($s->done))) > 0;
            if ($doneAny || imFiles((string) $c->id) || (string) $c->st !== 'open') {
                fail(409, 'conflict', 'A case with work done or documents stays on record: close or withdraw it instead.');
            }
            docDelete('im/' . (string) $c->id);
            audit('data', 'Immigration case deleted', (string) ($c->num ?? ''), [], $u);
            ok(['ok' => true]);
    }
    fail(404, 'not_found', 'Unknown request.');
}
