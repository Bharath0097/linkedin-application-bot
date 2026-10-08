<?php
declare(strict_types=1);
require_once __DIR__ . '/jobs.php';
require_once __DIR__ . '/vms.php';

/*
 * ATS (v29): structured hiring in the style of Greenhouse / Workable / Ceipal / Oorwin.
 *   - Requisitions: the public posting stays in org/site/jobs/{id} (the Careers page reads it); the internal side
 *     (hiring team, openings, pay range, pipeline stages, interview kits, scorecard attributes, knockout answers,
 *     approvals, SLA) lives in ats/x/jobs/{id}.
 *   - Candidates: ats/{id} — one record per application (a person applying to two jobs is two records linked by
 *     e-mail). st is the stage key; a job's stages each have a kind (new, screen, interview, offer, hired, rejected)
 *     so boards and reports group custom stages correctly.
 *   - Stage moves run the automations (stage e-mails, tasks for the hiring team, SLA clocks); interviews send
 *     calendar invitations (.ics); scorecards are appended atomically; the hire button creates the login, the
 *     onboarding checklist, the HR record and the placement in one go.
 *   - Public: screening questions with knockouts and an optional voluntary EEO survey, stored apart from the
 *     candidate and reported only in aggregate.
 */

const ATS_KINDS = ['new', 'screen', 'interview', 'offer', 'hired', 'rejected'];
const ATS_DEFAULT_STAGES = [
    ['k' => 'new', 'n' => 'New', 'kind' => 'new'],
    ['k' => 'screen', 'n' => 'Screening', 'kind' => 'screen'],
    ['k' => 'interview', 'n' => 'Interview', 'kind' => 'interview'],
    ['k' => 'offer', 'n' => 'Offer', 'kind' => 'offer'],
    ['k' => 'hired', 'n' => 'Hired', 'kind' => 'hired'],
    ['k' => 'rejected', 'n' => 'Rejected', 'kind' => 'rejected'],
];
const ATS_SETTINGS_DEFAULT = [
    'stageSets' => [
        ['id' => 'std', 'n' => 'Standard', 'stages' => ATS_DEFAULT_STAGES],
        ['id' => 'tech', 'n' => 'Technical hire', 'stages' => [
            ['k' => 'new', 'n' => 'Application review', 'kind' => 'new'],
            ['k' => 'screen', 'n' => 'Recruiter screen', 'kind' => 'screen'],
            ['k' => 'tech', 'n' => 'Technical interview', 'kind' => 'interview'],
            ['k' => 'onsite', 'n' => 'Panel / onsite', 'kind' => 'interview'],
            ['k' => 'refs', 'n' => 'Reference check', 'kind' => 'interview'],
            ['k' => 'offer', 'n' => 'Offer', 'kind' => 'offer'],
            ['k' => 'hired', 'n' => 'Hired', 'kind' => 'hired'],
            ['k' => 'rejected', 'n' => 'Rejected', 'kind' => 'rejected'],
        ]],
        ['id' => 'c2c', 'n' => 'Contract / C2C placement', 'stages' => [
            ['k' => 'new', 'n' => 'Sourced', 'kind' => 'new'],
            ['k' => 'screen', 'n' => 'Qualified', 'kind' => 'screen'],
            ['k' => 'submitted', 'n' => 'Submitted to client', 'kind' => 'interview'],
            ['k' => 'interview', 'n' => 'Client interview', 'kind' => 'interview'],
            ['k' => 'offer', 'n' => 'Offer / rate confirmed', 'kind' => 'offer'],
            ['k' => 'hired', 'n' => 'Placed', 'kind' => 'hired'],
            ['k' => 'rejected', 'n' => 'Not selected', 'kind' => 'rejected'],
        ]],
    ],
    'attrs' => ['Technical skills', 'Communication', 'Problem solving', 'Experience fit', 'Culture add'],
    'sources' => ['Website', 'LinkedIn', 'Dice', 'Indeed', 'Monster', 'Referral', 'Agency / vendor', 'Recruiter sourced', 'Job fair', 'Internal', 'Other'],
    'tags' => ['Hot', 'Local', 'Relocating', 'Needs sponsorship', 'Passive', 'Silver medalist'],
    'reject' => ['Not qualified', 'Compensation mismatch', 'Location / relocation', 'Work authorization', 'Withdrew', 'No response', 'Position filled', 'Failed screening question', 'Other'],
    'sla' => ['new' => 3, 'screen' => 7, 'interview' => 14, 'offer' => 7],
    'auto' => [
        ['kind' => 'screen', 'email' => true, 'task' => ''],
        ['kind' => 'interview', 'email' => false, 'task' => 'Schedule the interview with {name}'],
        ['kind' => 'offer', 'email' => true, 'task' => 'Prepare the offer for {name}'],
        ['kind' => 'rejected', 'email' => true, 'task' => ''],
        ['kind' => 'hired', 'email' => false, 'task' => 'Start onboarding for {name}'],
    ],
    'eeo' => false,
    // v37.2: job codes are this prefix and a number (J-1001)
    'codePrefix' => 'J',
    'offerTpl' => "Dear {name},\n\nStratEdge IT Consulting is pleased to offer you the position of {job}{client}. Your start date will be {start}, and your compensation will be {pay}.\n\n{terms}\n\nThis offer is valid until {expires}. Please sign below to accept.\n\nWe look forward to working with you.\n\n{signer}\nStratEdge IT Consulting",
    'kits' => [
        'screen' => ['Walk me through your recent experience and the role you are looking for.', 'What is your work authorization and location / relocation situation?', 'What rate or salary are you expecting, and when could you start?'],
        'interview' => ['Describe a hard technical problem you solved recently. What was your part?', 'How do you handle a disagreement with a teammate or client?', 'What would you need from us to succeed in your first 90 days?'],
    ],
];

function atsStaff(bool $write = false): array
{
    $u = requireAdmin();
    if (!can('ats/x', $write ? 'w' : 'r')) {
        fail(403, 'forbidden', 'The ATS is for administrators and HR.');
    }
    return $u;
}
/** Someone on the interview panel of this candidate (or its hiring manager) may read it and submit a scorecard. */
function atsOnPanel(array $u, stdClass $c): bool
{
    foreach ((array) ($c->intvs ?? []) as $iv) {
        if ($iv instanceof stdClass && in_array($u['id'], array_map('strval', (array) ($iv->who ?? [])), true)) {
            return true;
        }
    }
    $job = atsJob((string) ($c->job ?? ''));
    return in_array($u['id'], atsTeam($job), true);
}
function atsSettings(): array
{
    $d = docGet('ats/x/settings');
    $s = $d ? json_decode(json_encode($d), true) : [];
    $out = ATS_SETTINGS_DEFAULT;
    foreach (ATS_SETTINGS_DEFAULT as $k => $v) {
        if (array_key_exists($k, $s) && $s[$k] !== null && $s[$k] !== '' && $s[$k] !== []) {
            $out[$k] = $s[$k];
        }
    }
    return $out;
}
/** The internal side of a requisition, with defaults. */
function atsJob(string $jobId): array
{
    $d = docGet('ats/x/jobs/' . $jobId);
    $j = $d ? json_decode(json_encode($d), true) : [];
    $stages = is_array($j['stages'] ?? null) && $j['stages'] ? $j['stages'] : ATS_DEFAULT_STAGES;
    $clean = [];
    foreach ($stages as $s) {
        if (!is_array($s) || trim((string) ($s['k'] ?? '')) === '') {
            continue;
        }
        $kind = in_array((string) ($s['kind'] ?? ''), ATS_KINDS, true) ? (string) $s['kind'] : 'interview';
        $clean[] = ['k' => preg_replace('/[^a-z0-9_\-]/', '', strtolower((string) $s['k'])), 'n' => (string) ($s['n'] ?? $s['k']), 'kind' => $kind];
    }
    foreach (['hired', 'rejected'] as $k) {
        if (!array_filter($clean, fn($s) => $s['kind'] === $k)) {
            $clean[] = ['k' => $k, 'n' => ucfirst($k), 'kind' => $k];
        }
    }
    $j['stages'] = $clean;
    $j['id'] = $jobId;
    return $j;
}
function atsStageKind(array $job, string $st): string
{
    foreach ($job['stages'] as $s) {
        if ($s['k'] === $st) {
            return $s['kind'];
        }
    }
    return in_array($st, ATS_KINDS, true) ? $st : 'new';
}
function atsStageName(array $job, string $st): string
{
    foreach ($job['stages'] as $s) {
        if ($s['k'] === $st) {
            return $s['n'];
        }
    }
    return ucfirst($st);
}
function atsLog(stdClass $c, string $who, string $ev): void
{
    // v36.2: anything logged on a record saved by a search makes it part of the working ATS (shown on the ATS page)
    unset($c->lite);
    $log = (array) ($c->log ?? []);
    $log[] = (object) ['t' => now(), 'who' => $who, 'ev' => mb_substr($ev, 0, 300)];
    if (count($log) > 300) {
        $log = array_slice($log, -300);
    }
    $c->log = array_values($log);
}
/** v37.2: a line in the requisition's own history (ats/x/jobs/{id}.log, newest last, at most 300); the caller saves. */
function atsJobLog(stdClass $ij, string $who, string $ev, array $extra = []): void
{
    $log = array_values(array_filter((array) ($ij->log ?? []), fn($l) => $l instanceof stdClass || is_array($l)));
    $log[] = (object) (['t' => now(), 'who' => mb_substr($who, 0, 120), 'ev' => mb_substr($ev, 0, 600)] + $extra);
    if (count($log) > 300) {
        $log = array_slice($log, -300);
    }
    $ij->log = array_values($log);
}
function atsPublicJob(string $jobId): ?stdClass
{
    return $jobId !== '' ? docGet('org/site/jobs/' . $jobId) : null;
}
/** Placeholders in e-mail and offer templates. */
function atsFill(string $tpl, array $vars): string
{
    foreach ($vars as $k => $v) {
        $tpl = str_replace('{' . $k . '}', (string) $v, $tpl);
    }
    return $tpl;
}
/** Give the hiring team a task on someone's record (the same tasks the Team page assigns). */
function atsTask(array $uids, string $title, string $detail, string $by): int
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
/** Everyone on a job's hiring team (recruiter, coordinator, hiring manager, interviewers). */
function atsTeam(array $job): array
{
    $t = (array) ($job['team'] ?? []);
    return array_values(array_unique(array_filter(array_merge([(string) ($t['rec'] ?? ''), (string) ($t['coord'] ?? ''), (string) ($t['hm'] ?? '')], array_map('strval', (array) ($t['intv'] ?? []))))));
}
/** Move a candidate to a stage: validates it, logs it, runs the automations. */
function atsMove(stdClass $c, string $id, string $st, array $me, string $reason = '', string $note = '', bool $silent = false): array
{
    $job = atsJob((string) ($c->job ?? ''));
    $keys = array_column($job['stages'], 'k');
    if (!in_array($st, $keys, true)) {
        fail(400, 'invalid_argument', 'That stage is not in this job\'s pipeline.');
    }
    $kind = atsStageKind($job, $st);
    $from = (string) ($c->st ?? 'new');
    $c->st = $st;
    $c->stAt = now();
    if ($kind === 'rejected') {
        $c->why = mb_substr($reason, 0, 120);
    }
    $hist = (array) ($c->hist ?? []);
    $hist[] = (object) ['from' => $from, 'to' => $st, 'at' => now(), 'by' => $me['id']];
    $c->hist = array_values($hist);
    atsLog($c, (string) $me['name'], 'Moved to ' . atsStageName($job, $st) . ($reason !== '' ? ' · ' . $reason : '') . ($note !== '' ? ' · ' . $note : ''));
    $c->u = now();
    $out = ['emailed' => false, 'tasks' => 0];
    if ($silent) {
        docSet('ats/' . $id, $c);
        return $out;
    }
    $S = atsSettings();
    $rules = array_filter((array) $S['auto'], fn($a) => is_array($a) && ((string) ($a['kind'] ?? '') === $kind || (string) ($a['stage'] ?? '') === $st));
    $vars = ['name' => (string) ($c->n ?? ''), 'first' => explode(' ', trim((string) ($c->n ?? '')))[0] ?? '', 'job' => (string) ($c->jt ?? 'the role'), 'me' => (string) $me['name'], 'date' => '', 'stage' => atsStageName($job, $st)];
    foreach ($rules as $a) {
        if (!empty($a['email']) && filter_var((string) ($c->e ?? ''), FILTER_VALIDATE_EMAIL)) {
            $tpl = atsTemplate($S, $st, $kind);
            if ($tpl) {
                try {
                    $subject = atsFill($tpl['s'], $vars);
                    $body = atsFill($tpl['b'], $vars);
                    $ok = sendMail((string) $c->e, (string) $c->n, $subject, $body, emailHtml($subject, preg_split('/\n{2,}/', $body)), [], (string) $me['email']);
                    atsLog($c, 'Automation', ($ok ? 'Emailed: ' : 'Email failed: ') . $subject);
                    $out['emailed'] = $ok;
                } catch (Throwable $e) {
                    atsLog($c, 'Automation', 'Email failed: ' . $e->getMessage());
                }
            }
        }
        if (trim((string) ($a['task'] ?? '')) !== '') {
            $who = atsTeam($job) ?: [(string) $me['id']];
            $out['tasks'] += atsTask($who, atsFill((string) $a['task'], $vars), 'Candidate ' . (string) ($c->n ?? '') . ' · ' . (string) ($c->jt ?? '') . ' · now in ' . atsStageName($job, $st), (string) $me['id']);
        }
    }
    docSet('ats/' . $id, $c);
    return $out;
}
/** The e-mail template for a stage: a custom one from settings, else the built-in one for the stage's kind. */
function atsTemplate(array $S, string $st, string $kind): ?array
{
    $custom = (array) ($S['templates'] ?? []);
    foreach ([$st, $kind] as $k) {
        if (isset($custom[$k]) && is_array($custom[$k]) && trim((string) ($custom[$k]['s'] ?? '')) !== '') {
            return ['s' => (string) $custom[$k]['s'], 'b' => (string) ($custom[$k]['b'] ?? '')];
        }
    }
    $built = [
        'screen' => ['s' => 'Your application to StratEdge IT Consulting', 'b' => "Hi {first},\n\nThank you for applying for the {job} role. We have reviewed your profile and would like to set up a short call to learn more about your experience and what you are looking for.\n\nCould you share a few times that work for you this week?\n\nBest regards,\n{me}\nStratEdge IT Consulting"],
        'interview' => ['s' => 'Next step: {stage} for {job} at StratEdge', 'b' => "Hi {first},\n\nGood news: we would like to move you forward to the {stage} for the {job} role. We will follow up shortly with times.\n\nBest regards,\n{me}\nStratEdge IT Consulting"],
        'offer' => ['s' => 'Offer: {job} at StratEdge IT Consulting', 'b' => "Hi {first},\n\nWe are pleased to move forward with an offer for the {job} role. The offer letter will follow for electronic signature. Please let us know if you have any questions.\n\nWelcome aboard,\n{me}\nStratEdge IT Consulting"],
        'rejected' => ['s' => 'Your application to StratEdge IT Consulting', 'b' => "Hi {first},\n\nThank you for taking the time to apply for the {job} role. We have decided to move forward with other candidates for this position, but we will keep your profile on file for roles that match your experience.\n\nWe wish you the best in your search.\n\nBest regards,\n{me}\nStratEdge IT Consulting"],
    ];
    return $built[$kind] ?? null;
}
/** An iCalendar invitation for an interview. */
function atsIcs(array $iv, stdClass $c, array $attendees, string $uidStr): string
{
    // the time was typed in the organiser's local time zone (sent along as tz); the invitation carries it in UTC
    $zone = new DateTimeZone('UTC');
    try {
        if (!empty($iv['tz'])) {
            $zone = new DateTimeZone((string) $iv['tz']);
        }
    } catch (Throwable $e) {
        $zone = new DateTimeZone('UTC');
    }
    $start = new DateTime((string) $iv['at'], $zone);
    $start->setTimezone(new DateTimeZone('UTC'));
    $end = (clone $start)->modify('+' . max(15, (int) ($iv['dur'] ?? 60)) . ' minutes');
    $fmt = fn(DateTime $d) => $d->format('Ymd\THis\Z');
    $esc = fn(string $s) => str_replace(["\\", ";", ",", "\n"], ["\\\\", "\\;", "\\,", "\\n"], $s);
    $lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//StratEdge IT Consulting//ATS//EN', 'METHOD:' . (!empty($iv['cancelled']) ? 'CANCEL' : 'REQUEST'), 'BEGIN:VEVENT', 'UID:' . $uidStr, 'SEQUENCE:' . (int) ($iv['seq'] ?? 0), 'DTSTAMP:' . $fmt(new DateTime('now', new DateTimeZone('UTC'))), 'DTSTART:' . $fmt($start), 'DTEND:' . $fmt($end), 'SUMMARY:' . $esc(((string) ($iv['kind'] ?? 'Interview')) . ': ' . (string) ($c->n ?? '') . ' · ' . (string) ($c->jt ?? '')), 'DESCRIPTION:' . $esc((string) ($iv['notes'] ?? '')), 'LOCATION:' . $esc((string) ($iv['where'] ?? '')), 'ORGANIZER;CN=StratEdge IT Consulting:mailto:' . (string) cfg('mail_from'), 'STATUS:' . (!empty($iv['cancelled']) ? 'CANCELLED' : 'CONFIRMED')];
    foreach ($attendees as [$n, $e]) {
        $lines[] = 'ATTENDEE;CN=' . $esc($n) . ';ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:' . $e;
    }
    $lines[] = 'END:VEVENT';
    $lines[] = 'END:VCALENDAR';
    return implode("\r\n", $lines) . "\r\n";
}
/** How well a candidate fits a job: the same title/skills/location logic as the requirements desk. */
function atsMatch(string $id, stdClass $c, ?stdClass $job): array
{
    if (!$job) {
        return ['v' => 0, 'why' => ['No job attached'], 'at' => now()];
    }
    $prof = vmsReqProfile(['ti' => (string) ($job->ti ?? ''), 'sk' => (string) ($job->sk ?? ''), 'd' => (string) ($job->d ?? ''), 'loc' => (string) ($job->loc ?? ''), 'md' => (string) ($job->md ?? ''), 'visa' => (string) ($job->visa ?? '')]);
    $txt = vmsResumeText('ats/' . $id);
    $rp = $txt !== '' ? resumeProfile($txt) : ['titles' => [], 'skills' => [], 'location' => ''];
    $listed = array_values(array_filter(array_map('trim', preg_split('/[,;|\n]+/', (string) ($c->sk ?? '')) ?: [])));
    $cand = [
        'titles' => array_values(array_unique(array_filter(array_merge([(string) ($c->ti ?? ''), (string) ($c->jt ?? '')], (array) $rp['titles'])))),
        'skills' => array_values(array_unique(array_merge(skillsCanon($listed), (array) $rp['skills']))),
        'loc' => (string) (($c->loc ?? '') ?: ($rp['location'] ?? '')),
        'auth' => (string) ($c->auth ?? ''),
        'reloc' => (string) ($c->reloc ?? ''),
    ];
    [$score, $why] = vmsScore($prof, $cand);
    if ($txt === '' && !$listed) {
        $why[] = 'No resume text to read: the score only uses the title';
    }
    // years of experience when the job asks for some ("5+ years", "3-5 years")
    if (preg_match('/(\d{1,2})\s*(?:\+|-\s*\d{1,2})?\s*(?:years|yrs)/i', (string) ($job->d ?? '') . ' ' . (string) ($job->sk ?? ''), $mm)) {
        $need = (int) $mm[1];
        $have = (float) ($c->exp ?? 0);
        if ($have > 0) {
            if ($have >= $need) {
                $score = min(100, $score + 5);
                $why[] = $have . ' years (asks ' . $need . '+)';
            } else {
                $score = max(0, $score - 10);
                $why[] = 'Only ' . $have . ' years (asks ' . $need . '+)';
            }
        }
    }
    return ['v' => $score, 'why' => array_values($why), 'at' => now(), 'resume' => $txt !== ''];
}
/** A short written summary from the configured language model (optional), else a rule-based one. */
function atsSummary(stdClass $c, ?stdClass $job, array $match): string
{
    $txt = vmsResumeText('ats/' . ($c->id ?? ''));
    if (aiReady('ats')) {
        $prompt = "You are a recruiting assistant. In at most 90 words of plain text, summarize how this candidate fits the job: strengths, gaps, and one question to ask. No markdown.\n\nJOB: " . (string) ($job->ti ?? '') . "\n" . mb_substr((string) ($job->d ?? '') . "\nSkills: " . (string) ($job->sk ?? ''), 0, 2500) . "\n\nCANDIDATE: " . (string) ($c->n ?? '') . ', ' . (string) ($c->ti ?? $c->jt ?? '') . "\nSkills: " . (string) ($c->sk ?? '') . "\nExperience: " . (string) ($c->exp ?? '?') . " years\nResume: " . mb_substr(preg_replace('/\s+/', ' ', $txt) ?? '', 0, 6000);
        [$code, $j] = aiPost(['max_tokens' => 220, 'temperature' => 0.3, 'messages' => [['role' => 'user', 'content' => $prompt]]], 40);
        $text = is_array($j) ? trim((string) ($j['choices'][0]['message']['content'] ?? '')) : '';
        if ($text !== '') {
            return mb_substr($text, 0, 900);
        }
    }
    $parts = [];
    $parts[] = ($match['v'] >= 70 ? 'Strong fit' : ($match['v'] >= 45 ? 'Possible fit' : 'Weak fit on paper')) . ' (' . $match['v'] . '/100).';
    foreach ($match['why'] as $w) {
        $parts[] = $w . '.';
    }
    if (trim((string) ($c->msg ?? '')) !== '') {
        $parts[] = 'They wrote: "' . mb_substr(trim((string) $c->msg), 0, 160) . '".';
    }
    return implode(' ', $parts);
}
/** The same person applying elsewhere, by e-mail or phone. */
function atsDupes(string $email, string $phone, string $skipId = ''): array
{
    $out = [];
    $e = mb_strtolower(trim($email));
    $p = preg_replace('/\D/', '', $phone) ?? '';
    foreach (colAll('ats') as [$id, $x]) {
        if ((string) $id === $skipId) {
            continue;
        }
        $xe = mb_strtolower(trim((string) ($x->e ?? '')));
        $xp = preg_replace('/\D/', '', (string) ($x->ph ?? '')) ?? '';
        if (($e !== '' && $xe === $e) || (strlen($p) >= 10 && $xp !== '' && substr($xp, -10) === substr($p, -10))) {
            $out[] = ['id' => (string) $id, 'n' => (string) ($x->n ?? ''), 'jt' => (string) ($x->jt ?? ''), 'st' => (string) ($x->st ?? ''), 'at' => (int) ($x->at ?? 0)];
        }
    }
    return $out;
}
/** Everything the reports tab needs, computed here so a big ATS does not have to travel to the browser. */
function atsReport(string $from, string $to): array
{
    $fromT = $from !== '' ? strtotime($from) * 1000 : 0;
    $toT = $to !== '' ? (strtotime($to) + 86400) * 1000 : PHP_INT_MAX;
    $jobs = [];
    foreach (colAll('org/site/jobs') as [$jid, $j]) {
        $jobs[(string) $jid] = $j;
    }
    $funnel = ['applied' => 0, 'screen' => 0, 'interview' => 0, 'offer' => 0, 'hired' => 0, 'rejected' => 0];
    $bySrc = [];
    $byJob = [];
    $tth = [];
    $ttf = [];
    $offers = ['made' => 0, 'accepted' => 0, 'declined' => 0];
    $load = [];
    $stageAges = [];
    $now = now();
    $S = atsSettings();
    $overdue = [];
    foreach (colAll('ats') as [$id, $c]) {
        $at = (int) ($c->at ?? 0);
        if ($at < $fromT || $at > $toT) {
            continue;
        }
        // v36.2: people saved by a search who nobody has worked with are not applications
        if (!empty($c->lite)) {
            continue;
        }
        $job = atsJob((string) ($c->job ?? ''));
        $kind = atsStageKind($job, (string) ($c->st ?? 'new'));
        $funnel['applied']++;
        $reached = [];
        foreach ((array) ($c->hist ?? []) as $h) {
            $reached[atsStageKind($job, (string) ($h->to ?? ''))] = true;
        }
        $reached[$kind] = true;
        foreach (['screen', 'interview', 'offer', 'hired'] as $k) {
            if (!empty($reached[$k]) || ($k === 'screen' && !empty($reached['interview'])) || ($k !== 'hired' && !empty($reached['hired']))) {
                $funnel[$k]++;
            }
        }
        if ($kind === 'rejected') {
            $funnel['rejected']++;
        }
        $src = (string) ($c->src ?? 'Other') ?: 'Other';
        $bySrc[$src] = $bySrc[$src] ?? ['n' => 0, 'hired' => 0, 'interview' => 0];
        $bySrc[$src]['n']++;
        if (!empty($reached['interview']) || !empty($reached['hired'])) {
            $bySrc[$src]['interview']++;
        }
        if ($kind === 'hired') {
            $bySrc[$src]['hired']++;
            $hiredAt = 0;
            foreach ((array) ($c->hist ?? []) as $h) {
                if (atsStageKind($job, (string) ($h->to ?? '')) === 'hired') {
                    $hiredAt = (int) ($h->at ?? 0);
                }
            }
            if ($hiredAt > $at) {
                $tth[] = ($hiredAt - $at) / 86400000;
                $jp = $jobs[(string) ($c->job ?? '')] ?? null;
                if ($jp && (int) ($jp->at ?? 0) > 0) {
                    $ttf[] = max(0, ($hiredAt - (int) $jp->at) / 86400000);
                }
            }
        }
        $jk = (string) ($c->jt ?? 'Unassigned') ?: 'Unassigned';
        $byJob[$jk] = $byJob[$jk] ?? ['n' => 0, 'active' => 0, 'hired' => 0, 'rejected' => 0];
        $byJob[$jk]['n']++;
        if ($kind === 'hired') {
            $byJob[$jk]['hired']++;
        } elseif ($kind === 'rejected') {
            $byJob[$jk]['rejected']++;
        } else {
            $byJob[$jk]['active']++;
        }
        if (isset($c->offer) && $c->offer instanceof stdClass && (string) ($c->offer->st ?? '') !== '' && (string) $c->offer->st !== 'draft') {
            $offers['made']++;
            if ((string) $c->offer->st === 'accepted') {
                $offers['accepted']++;
            } elseif ((string) $c->offer->st === 'declined') {
                $offers['declined']++;
            }
        }
        foreach ((array) ($c->intvs ?? []) as $iv) {
            if (!($iv instanceof stdClass) || !empty($iv->cancelled)) {
                continue;
            }
            foreach ((array) ($iv->who ?? []) as $uid) {
                $load[(string) $uid] = ($load[(string) $uid] ?? 0) + 1;
            }
        }
        if (!in_array($kind, ['hired', 'rejected'], true)) {
            $days = ($now - (int) ($c->stAt ?? $at)) / 86400000;
            $stageAges[$kind][] = $days;
            $limit = (int) ($S['sla'][$kind] ?? 0);
            if ($limit > 0 && $days > $limit) {
                $overdue[] = ['id' => (string) $id, 'n' => (string) ($c->n ?? ''), 'jt' => (string) ($c->jt ?? ''), 'stage' => atsStageName($job, (string) ($c->st ?? '')), 'days' => (int) floor($days), 'limit' => $limit];
            }
        }
    }
    $avg = fn(array $a) => $a ? round(array_sum($a) / count($a), 1) : null;
    $med = function (array $a) {
        if (!$a) {
            return null;
        }
        sort($a);
        $n = count($a);
        return round($n % 2 ? $a[intdiv($n, 2)] : ($a[$n / 2 - 1] + $a[$n / 2]) / 2, 1);
    };
    $names = [];
    foreach (array_keys($load) as $uid) {
        $u = docGet('u/' . $uid);
        $names[$uid] = (string) ($u->p->n ?? $uid);
    }
    arsort($load);
    usort($overdue, fn($a, $b) => $b['days'] <=> $a['days']);
    // EEO: counts only, never tied to a person; shown only when at least 5 answered
    $eeo = ['n' => 0, 'gender' => [], 'race' => [], 'veteran' => [], 'disability' => []];
    foreach (colAll('ats/x/eeo') as [, $r]) {
        $rt = (int) ($r->at ?? 0);
        if ($rt < $fromT || $rt > $toT) {
            continue;
        }
        $eeo['n']++;
        foreach (['gender', 'race', 'veteran', 'disability'] as $k) {
            $v = (string) ($r->$k ?? 'Not answered') ?: 'Not answered';
            $eeo[$k][$v] = ($eeo[$k][$v] ?? 0) + 1;
        }
    }
    if ($eeo['n'] < 5) {
        $eeo = ['n' => $eeo['n'], 'hidden' => true];
    }
    return [
        'funnel' => $funnel,
        'sources' => $bySrc,
        'jobs' => $byJob,
        'tth' => ['avg' => $avg($tth), 'med' => $med($tth), 'n' => count($tth)],
        'ttf' => ['avg' => $avg($ttf), 'med' => $med($ttf), 'n' => count($ttf)],
        'offers' => $offers,
        'load' => array_map(fn($uid, $n) => ['uid' => $uid, 'n' => $names[$uid] ?? $uid, 'count' => $n], array_keys($load), $load),
        'stageAges' => array_map(fn($a) => $avg($a), $stageAges),
        'overdue' => array_slice($overdue, 0, 50),
        'eeo' => $eeo,
    ];
}
/** The hire: a login, onboarding, the HR record and (for a client placement) the placement record. */
function atsHire(string $id, stdClass $c, array $opt, array $me): array
{
    $job = atsJob((string) ($c->job ?? ''));
    $pub = atsPublicJob((string) ($c->job ?? ''));
    $offer = $c->offer instanceof stdClass ? $c->offer : new stdClass();
    $kind = in_array((string) ($opt['kind'] ?? ''), ['employee', 'consultant'], true) ? (string) $opt['kind'] : 'employee';
    $out = ['uid' => (string) ($c->uid ?? ''), 'login' => null, 'placement' => null];
    if ($out['uid'] === '' && !empty($opt['login'])) {
        $email = strtolower(trim((string) ($c->e ?? '')));
        $s = db()->prepare('SELECT id FROM users WHERE email = ?');
        $s->execute([$email]);
        $existing = $s->fetchColumn();
        if ($existing) {
            $out['uid'] = (string) $existing;
        } else {
            $r = createLogin(['name' => (string) ($c->n ?? ''), 'email' => $email, 'phone' => (string) ($c->ph ?? ''), 'title' => (string) ($offer->title ?? $c->jt ?? ''), 'kind' => $kind, 'portals' => [$kind], 'cids' => []], $me);
            $out['uid'] = (string) $r['id'];
            $out['login'] = ['mailed' => $r['mailed'], 'link' => $r['link']];
        }
        $c->uid = $out['uid'];
    }
    $uid = $out['uid'];
    if ($uid !== '') {
        $r = docGet('r/' . $uid) ?? new stdClass();
        if (!empty($opt['onboard']) && empty($r->onb)) {
            $r->onb = (object) ['kind' => 'onb', 'started' => now(), 'items' => new stdClass(), 'by' => $me['id']];
        }
        if (!empty($opt['client']) && preg_match('/^[A-Za-z0-9_\-]{1,40}$/', (string) $opt['client'])) {
            $r->cid = (string) $opt['client'];
            $cd = docGet('org/admin/clients/' . $r->cid);
            if ($cd) {
                $r->cl = (string) ($cd->n ?? '');
            }
        }
        if (!empty($offer->start) && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $offer->start)) {
            $r->start = (string) $offer->start;
        }
        $r->u = now();
        docSet('r/' . $uid, $r);
        // the HR record (HRMS > People), prefilled from the offer
        $rec = docGet('hrms/emp/' . $uid . '/rec') ?? new stdClass();
        if (empty($rec->doj) && !empty($offer->start)) {
            $rec->doj = (string) $offer->start;
        }
        if (empty($rec->desig)) {
            $rec->desig = (string) ($offer->title ?? $c->jt ?? '');
        }
        if (empty($rec->type)) {
            $rec->type = (string) ($offer->type ?? '') === 'c2c' ? 'Contract (C2C)' : ((string) ($offer->type ?? '') === 'w2c' ? 'Contract (W2)' : 'Full-time');
        }
        if (empty($rec->dept) && !empty($job['dept'])) {
            $rec->dept = (string) $job['dept'];
        }
        if (empty($rec->st)) {
            $rec->st = 'Active';
        }
        if (empty($rec->loc) && !empty($pub->loc)) {
            $rec->loc = (string) $pub->loc;
        }
        if (empty($rec->mgrId) && !empty($job['team']['hm'])) {
            $rec->mgrId = (string) $job['team']['hm'];
        }
        $rec->u = now();
        $rec->by = $me['id'];
        docSet('hrms/emp/' . $uid . '/rec', $rec);
        // the pay plan from the offer (what payroll runs on)
        if (!empty($opt['pay']) && (float) ($offer->pay ?? 0) > 0) {
            $per = (string) ($offer->per ?? 'hour');
            $r = docGet('r/' . $uid) ?? new stdClass();
            if (empty($r->pay)) {
                $r->pay = (object) ['t' => $per === 'hour' ? 'hourly' : 'salary', 'r' => (float) $offer->pay, 'cur' => (string) ($offer->cur ?? 'USD'), 'from' => (string) ($offer->start ?? date('Y-m-d')), 'by' => $me['id'], 'at' => now()];
                docSet('r/' . $uid, $r);
            }
        }
    }
    // a placement: the engagement with the client, with the margin (Oorwin / Ceipal style)
    if (!empty($opt['placement'])) {
        $pid = rid(8);
        $place = (object) [
            'uid' => $uid,
            'cand' => $id,
            'n' => (string) ($c->n ?? ''),
            'ti' => (string) ($offer->title ?? $c->jt ?? ''),
            'cid' => (string) ($opt['client'] ?? ''),
            'cl' => '',
            'vid' => (string) ($opt['vendor'] ?? ''),
            'bill' => (float) ($opt['bill'] ?? 0),
            'pay' => (float) ($offer->pay ?? 0),
            'per' => (string) ($offer->per ?? 'hour'),
            'cur' => (string) ($offer->cur ?? 'USD'),
            'type' => (string) ($offer->type ?? 'w2'),
            'start' => (string) ($offer->start ?? ''),
            'end' => (string) ($opt['end'] ?? ''),
            'rec' => (string) ($job['team']['rec'] ?? $me['id']),
            'sales' => (string) ($opt['sales'] ?? ($job['team']['sales'] ?? '')),
            'job' => (string) ($c->job ?? ''),
            'st' => (string) ($offer->start ?? '') > date('Y-m-d') ? 'upcoming' : 'active',
            'at' => now(),
            'by' => $me['id'],
            'u' => now(),
        ];
        if ($place->cid !== '') {
            $cd = docGet('org/admin/clients/' . $place->cid);
            $place->cl = (string) ($cd->n ?? '');
        }
        docSet('rec/place/items/' . $pid, $place);
        $out['placement'] = $pid;
        $c->place = $pid;
    }
    // the stage: whichever stage of this job means hired
    $hiredKey = 'hired';
    foreach ($job['stages'] as $s) {
        if ($s['kind'] === 'hired') {
            $hiredKey = $s['k'];
        }
    }
    atsLog($c, (string) $me['name'], 'Hired' . ($uid !== '' ? ' · login ' . $uid : '') . ($out['placement'] ? ' · placement created' : ''));
    atsMove($c, $id, $hiredKey, $me, '', '', true);
    // the opening is filled: count down the requisition
    if (!empty($c->job)) {
        $ij = docGet('ats/x/jobs/' . $c->job) ?? new stdClass();
        $ij->filled = (int) ($ij->filled ?? 0) + 1;
        $ij->u = now();
        $full = (int) ($ij->openings ?? 1) > 0 && $ij->filled >= (int) ($ij->openings ?? 1);
        if ($full) {
            $ij->status = 'filled';
            if ($pub) {
                $pub->open = false;
                docSet('org/site/jobs/' . $c->job, $pub);
            }
        }
        // v37.2: the requisition's history
        atsJobLog($ij, (string) $me['name'], 'Hired ' . (string) ($c->n ?? '') . ' (' . $ij->filled . ' of ' . (int) ($ij->openings ?? 1) . ' openings filled)' . ($full ? '. Filled: taken off the careers page' : ''));
        docSet('ats/x/jobs/' . $c->job, $ij);
    }
    return $out;
}

/* ---------- v31: candidates pulled in from the other portals and from job boards ---------- */
const ATS_BOARDS = ['Dice', 'Monster', 'LinkedIn', 'Indeed', 'CareerBuilder', 'ZipRecruiter', 'Glassdoor', 'Email', 'Referral', 'Other job board'];
function atsEmailsIn(): array
{
    $seen = [];
    foreach (colAll('ats') as [$id, $x]) {
        $e = mb_strtolower(trim((string) ($x->e ?? '')));
        if ($e !== '') {
            $seen[$e] = (string) $id;
        }
    }
    return $seen;
}
/** Copies a stored file into the candidate as its resume (its own copy: deleting one never removes the other). */
function atsCopyResume(string $id, string $fid, string $name): ?string
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
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    docSet("ats/$id/f/$new", (object) ['n' => mb_substr($name ?: 'resume', 0, 180), 'ty' => MIME[$ext] ?? 'application/octet-stream', 'sz' => filePlainSize("$dir/$new"), 'at' => now(), 'c' => 'resume']);
    return $new;
}
/** Text of a resume or profile -> candidate fields: the assistant when it is on (Fill with AI), the parser otherwise. */
function atsFieldsFromText(string $text): array
{
    require_once __DIR__ . '/tailor.php';
    $r = tailorParse($text);
    $rules = [
        'n' => $r['name'], 'e' => $r['email'], 'ph' => $r['phone'], 'li' => $r['linkedin'],
        'ti' => $r['title'] !== '' ? $r['title'] : (string) ($r['experience'][0]['ti'] ?? ''),
        'sk' => implode(', ', array_slice(skillsIn($text, 40), 0, 15)), 'loc' => $r['loc'], 'exp' => (string) (resumeYears($text) ?? ''), 'auth' => $r['auth'],
    ];
    if (aiReady('extract')) {
        require_once __DIR__ . '/ai.php';
        $f = aiCandFields($text);
        if ($f) {
            return array_merge($rules, $f);
        }
    }
    return $rules;
}
function atsNewCandidate(array $u, array $f, string $src, string $jid, string $logEv, array $extra = []): string
{
    $pub = $jid !== '' ? atsPublicJob($jid) : null;
    $id = rid(6);
    docSet('ats/' . $id, (object) array_merge([
        'n' => mb_substr(trim((string) ($f['n'] ?? '')), 0, 120),
        'e' => mb_strtolower(mb_substr(trim((string) ($f['e'] ?? '')), 0, 190)),
        'ph' => mb_substr((string) ($f['ph'] ?? ''), 0, 40),
        'ti' => mb_substr((string) ($f['ti'] ?? ''), 0, 120),
        'sk' => mb_substr((string) ($f['sk'] ?? ''), 0, 600),
        'loc' => mb_substr((string) ($f['loc'] ?? ''), 0, 120),
        'auth' => mb_substr((string) ($f['auth'] ?? ''), 0, 40),
        'exp' => (float) ($f['exp'] ?? 0) ?: null,
        'li' => mb_substr((string) ($f['li'] ?? ''), 0, 300),
        'rate' => mb_substr((string) ($f['rate'] ?? ''), 0, 60),
        'src' => mb_substr($src, 0, 60),
        'job' => $pub ? $jid : '',
        'jt' => $pub ? (string) ($pub->ti ?? '') : '',
        'tags' => [],
        'msg' => '',
        'st' => 'new',
        'pool' => !$pub,
        'rating' => 0,
        'notes' => [],
        'at' => now(),
        'stAt' => now(),
        'u' => now(),
        'by' => $u['id'],
        'log' => [(object) ['t' => now(), 'who' => (string) $u['name'], 'ev' => $logEv]],
    ], $extra));
    return $id;
}
/* ---------- v36.4: Mail from the ATS (profiles to a client or vendor, email to candidates, a message to anyone) ---------- */
const ATS_MAIL_MAX_IDS = 25;
const ATS_MAIL_MAX_BYTES = 20 * 1048576; // attachments together (Gmail takes 25 MB including the encoding)
/** This person's own mailbox (My email) when it is connected: ['email', 'provider'], else null. */
function atsMailBox(array $u): ?array
{
    require_once __DIR__ . '/sso.php';
    $a = mymailAcct((string) $u['id']);
    return $a ? ['email' => (string) $a['email'], 'provider' => (string) $a['provider']] : null;
}
/** One message, through the sender's own mailbox (My email) when they chose it and it is connected, otherwise from
 *  the company mailbox with replies going to them. Returns [ok, error, how it went out]. */
function atsMailSend(array $u, array $tos, array $cc, string $subject, string $text, array $atts, bool $box, bool $branded, string $label): array
{
    require_once __DIR__ . '/sso.php';
    $a = $box ? mymailAcct((string) $u['id']) : null;
    if ($a) {
        $fromName = $a['name'] !== '' ? $a['name'] : (string) $u['name'];
        $raw = mymailMime($fromName, $a['email'], $tos, $cc, [], $subject, $text, '', $atts);
        [$ok, $err] = mymailSendRaw($a, $raw, array_merge($tos, $cc));
        if (!$ok) {
            $err = 'Your connected mailbox (' . $a['email'] . ') refused the message' . ($err !== '' ? ': ' . $err : '') . '. Reconnect it under My email, or send from the company mailbox.';
        }
        // kept in My email > Sent, like any message written there
        mymailDb()->prepare('INSERT INTO mail_user_msgs (id, uid, dir, at, from_email, from_name, to_email, cc, subject, text, snippet, msgid, thread, label, seen, starred, gid, err) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute([
            rid(12), $u['id'], 'out', now(), $a['email'], $fromName, implode(', ', $tos), implode(', ', $cc), mb_substr($subject, 0, 500),
            $text . ($atts ? "\n\n[Attached: " . implode(', ', array_map(fn($x) => $x['name'], $atts)) . ']' : ''), mb_substr(preg_replace('/\s+/', ' ', $text) ?? '', 0, 300), '', '', $label, 1, 0, '', $ok ? '' : $err,
        ]);
        foreach ($tos as $t) {
            mymailBook((string) $u['id'], $t, '', now());
        }
        return [$ok, $ok ? '' : $err, $a['email']];
    }
    $html = $branded ? emailHtml($subject, preg_split('/\n{2,}/', $text) ?: [$text]) : '<div style="font:15px/1.6 Arial,sans-serif;color:#111">' . nl2br(htmlspecialchars($text, ENT_QUOTES, 'UTF-8')) . '</div>';
    $ok = sendMail($tos[0], '', $subject, $text, $html, $atts, (string) ($u['email'] ?? ''), implode(', ', array_merge(array_slice($tos, 1), $cc)));
    return [$ok, $ok ? '' : 'The company mailbox could not send it (Admin > Email > Gmail & sending).', 'company mailbox'];
}
/** A candidate's resume as an attachment ("Jane Doe - Resume.pdf"), or null when there is none. */
function atsMailResume(string $id, stdClass $c): ?array
{
    $fid = (string) ($c->rid ?? '');
    if (!preg_match('/^[a-f0-9]{32}$/', $fid)) {
        return null;
    }
    $meta = docGet('ats/' . $id . '/f/' . $fid);
    $data = fileRead($fid);
    if ($data === null || $data === '') {
        return null;
    }
    $ext = strtolower(pathinfo((string) ($meta->n ?? ''), PATHINFO_EXTENSION)) ?: 'pdf';
    $name = trim(preg_replace('/[^A-Za-z0-9 .\'-]/', '', (string) $c->n) ?? '') ?: 'Candidate';
    return ['name' => $name . ' - Resume.' . $ext, 'type' => (string) ($meta->ty ?? (MIME[$ext] ?? 'application/octet-stream')), 'data' => $data];
}
/** Addresses this person sent ATS mail to (for the To field's suggestions). */
function atsMailRemember(array $u, array $tos): void
{
    $path = 'ats/x/mailto/' . preg_replace('/[^A-Za-z0-9_]/', '', (string) $u['id']);
    $d = docGet($path) ?? (object) ['list' => []];
    $list = array_values(array_filter((array) ($d->list ?? []), fn($x) => !in_array((string) ($x->e ?? ''), $tos, true)));
    foreach ($tos as $t) {
        array_unshift($list, (object) ['e' => $t, 'at' => now()]);
    }
    $d->list = array_slice($list, 0, 100);
    docSet($path, $d);
}

function atsRoute(string $r, string $method, array $b): never
{
    switch ($r) {
        case 'ats_settings':
            atsStaff();
            ok(['settings' => atsSettings()]);
        case 'ats_settings_save':
            $u = atsStaff(true);
            $cur = docGet('ats/x/settings') ?? new stdClass();
            foreach (['stageSets', 'attrs', 'sources', 'tags', 'reject', 'sla', 'auto', 'eeo', 'offerTpl', 'kits', 'templates'] as $k) {
                if (array_key_exists($k, $b)) {
                    $cur->$k = json_decode(json_encode($b[$k]));
                }
            }
            if (array_key_exists('codePrefix', $b)) {
                // v37.2: letters and digits, up to 6 (new codes only; codes already given stay)
                $cur->codePrefix = substr(strtoupper((string) preg_replace('/[^A-Za-z0-9]/', '', (string) $b['codePrefix'])), 0, 6) ?: 'J';
            }
            $cur->u = now();
            $cur->by = $u['id'];
            docSet('ats/x/settings', $cur);
            ok(['settings' => atsSettings()]);
        case 'ats_job':
            // the internal requisition record for a posting
            atsStaff();
            $jid = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($b['id'] ?? ''));
            ok(['job' => atsJob($jid), 'pub' => atsPublicJob($jid)]);
        case 'ats_job_save':
            $u = atsStaff(true);
            $jid = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($b['id'] ?? ''));
            if ($jid === '') {
                fail(400, 'invalid_argument', 'Which job?');
            }
            $cur = docGet('ats/x/jobs/' . $jid) ?? new stdClass();
            foreach (['dept', 'openings', 'status', 'team', 'stages', 'attrs', 'kit', 'ko', 'pay', 'approvals', 'internal', 'client', 'notes', 'sla', 'filled', 'reqBy', 'priority', 'ec', 'vendor'] as $k) {
                if (array_key_exists($k, $b)) {
                    $cur->$k = json_decode(json_encode($b[$k]));
                }
            }
            $cur->u = now();
            $cur->by = $u['id'];
            docSet('ats/x/jobs/' . $jid, $cur);
            ok(['job' => atsJob($jid)]);
        case 'ats_jobs':
            // every posting with its internal side and live counts per stage kind
            atsStaff();
            $counts = [];
            foreach (colAll('ats') as [$id, $c]) {
                $jk = (string) ($c->job ?? '');
                $counts[$jk] = $counts[$jk] ?? ['total' => 0, 'active' => 0, 'new' => 0, 'screen' => 0, 'interview' => 0, 'offer' => 0, 'hired' => 0, 'rejected' => 0];
                $kind = atsStageKind(atsJob($jk), (string) ($c->st ?? 'new'));
                $counts[$jk]['total']++;
                $counts[$jk][$kind]++;
                if (!in_array($kind, ['hired', 'rejected'], true)) {
                    $counts[$jk]['active']++;
                }
            }
            // v37.2: postings made elsewhere get their job codes (oldest first)
            require_once __DIR__ . '/atsreq.php';
            try {
                atsReqBackfill();
            } catch (Throwable $e) {
                @error_log(date('c') . ' job codes: ' . $e->getMessage() . "\n", 3, storeDir() . '/error.log');
            }
            $rows = [];
            foreach (colAll('org/site/jobs', 'at', 'desc') as [$jid, $p]) {
                $ij = atsJob((string) $jid);
                // the history is read on the job page only
                unset($ij['log']);
                $rows[] = ['id' => (string) $jid, 'pub' => $p, 'job' => $ij, 'counts' => $counts[(string) $jid] ?? null];
            }
            ok(['rows' => $rows, 'unassigned' => $counts[''] ?? null]);
        case 'ats_move':
            $u = atsStaff(true);
            $id = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($b['id'] ?? ''));
            $c = $id !== '' ? docGet('ats/' . $id) : null;
            if (!$c) {
                fail(404, 'not_found', 'No such candidate.');
            }
            $res = atsMove($c, $id, preg_replace('/[^a-z0-9_\-]/', '', strtolower((string) ($b['st'] ?? ''))), $u, str($b, 'reason', 120), str($b, 'note', 500), !empty($b['silent']));
            ok($res + ['c' => $c]);
        case 'ats_bulk':
            $u = atsStaff(true);
            $ids = array_values(array_filter(array_map(fn($x) => preg_replace('/[^A-Za-z0-9_\-]/', '', (string) $x), (array) ($b['ids'] ?? []))));
            if (!$ids || count($ids) > 200) {
                fail(400, 'invalid_argument', 'Pick between 1 and 200 candidates.');
            }
            $act = str($b, 'act', 12);
            $n = 0;
            foreach ($ids as $id) {
                $c = docGet('ats/' . $id);
                if (!$c) {
                    continue;
                }
                unset($c->lite); // v36.2: chosen for an action: part of the working ATS from now on
                if ($act === 'move') {
                    atsMove($c, $id, preg_replace('/[^a-z0-9_\-]/', '', strtolower((string) ($b['st'] ?? ''))), $u, str($b, 'reason', 120), '', !empty($b['silent']));
                } elseif ($act === 'tag') {
                    $tags = array_values(array_unique(array_merge(array_map('strval', (array) ($c->tags ?? [])), [str($b, 'tag', 40)])));
                    $c->tags = array_values(array_filter($tags));
                    $c->u = now();
                    docSet('ats/' . $id, $c);
                } elseif ($act === 'email') {
                    $subject = str($b, 'subject', 200);
                    $body = str($b, 'body', 6000);
                    if ($subject === '' || $body === '' || !filter_var((string) ($c->e ?? ''), FILTER_VALIDATE_EMAIL)) {
                        continue;
                    }
                    $vars = ['name' => (string) $c->n, 'first' => explode(' ', trim((string) $c->n))[0] ?? '', 'job' => (string) ($c->jt ?? 'the role'), 'me' => (string) $u['name']];
                    $ok = sendMail((string) $c->e, (string) $c->n, atsFill($subject, $vars), atsFill($body, $vars), emailHtml(atsFill($subject, $vars), preg_split('/\n{2,}/', atsFill($body, $vars))), [], (string) $u['email']);
                    atsLog($c, (string) $u['name'], ($ok ? 'Emailed: ' : 'Email failed: ') . atsFill($subject, $vars));
                    $c->u = now();
                    docSet('ats/' . $id, $c);
                } elseif ($act === 'pool') {
                    $c->pool = true;
                    $c->u = now();
                    docSet('ats/' . $id, $c);
                } else {
                    fail(400, 'invalid_argument', 'Unknown action.');
                }
                $n++;
            }
            ok(['n' => $n]);
        case 'ats_interview':
            // create / update / cancel an interview; invitations with an .ics go to the candidate and interviewers
            $u = atsStaff(true);
            $id = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($b['id'] ?? ''));
            $c = $id !== '' ? docGet('ats/' . $id) : null;
            if (!$c) {
                fail(404, 'not_found', 'No such candidate.');
            }
            $in = is_array($b['intv'] ?? null) ? $b['intv'] : [];
            $ivId = preg_replace('/[^a-z0-9]/', '', (string) ($in['id'] ?? '')) ?: rid(5);
            $list = array_values(array_filter((array) ($c->intvs ?? []), fn($x) => $x instanceof stdClass));
            $prev = null;
            foreach ($list as $x) {
                if ((string) ($x->id ?? '') === $ivId) {
                    $prev = $x;
                }
            }
            $cancel = !empty($b['cancel']);
            $at = (string) ($in['at'] ?? ($prev->at ?? ''));
            if (!$cancel && !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/', $at)) {
                fail(400, 'invalid_argument', 'Pick the date and time.');
            }
            $iv = (object) [
                'id' => $ivId,
                'at' => $at,
                'tz' => mb_substr((string) ($in['tz'] ?? ($prev->tz ?? '')), 0, 60),
                'dur' => max(15, min(480, (int) ($in['dur'] ?? ($prev->dur ?? 60)))),
                'kind' => mb_substr((string) ($in['kind'] ?? ($prev->kind ?? 'Interview')), 0, 40),
                'where' => mb_substr((string) ($in['where'] ?? ($prev->where ?? '')), 0, 300),
                'who' => array_values(array_filter(array_map('strval', (array) ($in['who'] ?? ($prev->who ?? []))), fn($x) => preg_match('/^u_[a-f0-9]+$/', $x))),
                'stage' => (string) ($in['stage'] ?? ($prev->stage ?? ($c->st ?? ''))),
                'notes' => mb_substr((string) ($in['notes'] ?? ($prev->notes ?? '')), 0, 2000),
                'seq' => (int) ($prev->seq ?? -1) + 1,
                'cancelled' => $cancel,
                'by' => $u['id'],
                'u' => now(),
            ];
            // v41: an interview in the organiser's Google Calendar or Outlook keeps its event, and every change goes there
            if ($prev && isset($prev->cal) && $prev->cal instanceof stdClass) {
                $iv->cal = $prev->cal;
            }
            $list = array_values(array_filter($list, fn($x) => (string) ($x->id ?? '') !== $ivId));
            $list[] = $iv;
            usort($list, fn($a, $b2) => strcmp((string) ($a->at ?? ''), (string) ($b2->at ?? '')));
            $c->intvs = $list;
            $c->intv = $cancel ? '' : $at; // the next interview, for the board card
            $c->u = now();
            try {
                $whenDt = new DateTime($at, new DateTimeZone($iv->tz !== '' ? $iv->tz : date_default_timezone_get()));
                $when = $whenDt->format('D, M j \a\t g:i A') . ($iv->tz !== '' ? ' (' . $whenDt->format('T') . ')' : '');
            } catch (Throwable $e) {
                $when = date('D, M j \a\t g:i A', strtotime($at));
            }
            atsLog($c, (string) $u['name'], ($cancel ? 'Interview cancelled: ' : ($prev ? 'Interview updated: ' : 'Interview scheduled: ')) . $iv->kind . ' on ' . $when);
            $calErr = '';
            $calOn = false;
            $inCal = isset($iv->cal) && $iv->cal instanceof stdClass && (string) ($iv->cal->eid ?? '') !== '' && (string) ($iv->cal->st ?? '') !== 'cancelled';
            if ($inCal || (!$cancel && !empty($b['cal']))) {
                require_once __DIR__ . '/cal.php';
                $cr = calInterview($u, $id, $c, $iv, $inCal ? $iv->cal : null, $cancel, !empty($b['meet']));
                if ($cr['cal']) {
                    $iv->cal = $cr['cal'];
                }
                $calErr = (string) $cr['err'];
                $calOn = $calErr === '';
                if ($calOn) {
                    $calName = ['google' => 'Google Calendar', 'microsoft' => 'Outlook'][(string) ($iv->cal->p ?? '')] ?? 'the calendar';
                    // an online meeting the calendar made is where the interview happens, unless a place was given
                    if (!$cancel && $iv->where === '' && (string) ($iv->cal->join ?? '') !== '') {
                        $iv->where = (string) $iv->cal->join;
                    }
                    atsLog($c, (string) $u['name'], $cancel ? 'Calendar invitation cancelled in ' . $calName : ($cr['made'] ? 'Invitation sent from ' . $calName . ' (' . (string) ($iv->cal->email ?? '') . ')' . ((string) ($iv->cal->join ?? '') !== '' ? ' with an online meeting link' : '') : 'Calendar invitation updated in ' . $calName));
                } else {
                    atsLog($c, (string) $u['name'], 'Calendar: ' . $calErr);
                }
            }
            docSet('ats/' . $id, $c);
            // invitations (the calendar sends its own: then the portal's email with an .ics is not needed)
            $sent = 0;
            if (!empty($b['invite']) && !$calOn) {
                $attendees = [];
                foreach ($iv->who as $uid) {
                    $row = userRow($uid);
                    if ($row) {
                        $attendees[] = [(string) $row['name'], (string) $row['email']];
                    }
                }
                if (filter_var((string) ($c->e ?? ''), FILTER_VALIDATE_EMAIL)) {
                    $attendees[] = [(string) $c->n, (string) $c->e];
                }
                $ics = atsIcs((array) $iv, $c, $attendees, 'ats-' . $id . '-' . $ivId . '@stratedge');
                $subject = ($cancel ? 'Cancelled: ' : '') . $iv->kind . ' · ' . (string) ($c->jt ?? 'StratEdge') . ' · ' . $when;
                foreach ($attendees as [$n, $e]) {
                    $isCand = $e === (string) ($c->e ?? '');
                    $body = $isCand
                        ? "Hi " . (explode(' ', trim((string) $c->n))[0] ?? '') . ",\n\n" . ($cancel ? 'The interview below has been cancelled; we will be in touch about another time.' : 'You are invited to a ' . $iv->kind . ' for the ' . (string) ($c->jt ?? '') . ' role.') . "\n\nWhen: $when (" . $iv->dur . " minutes)" . ($iv->where !== '' ? "\nWhere: " . $iv->where : '') . ($iv->notes !== '' && !$cancel ? "\n\n" . $iv->notes : '') . "\n\nThe calendar invitation is attached.\n\nBest regards,\n" . (string) $u['name'] . "\nStratEdge IT Consulting"
                        : "Hi " . (explode(' ', $n)[0] ?? '') . ",\n\n" . ($cancel ? 'Cancelled: ' : 'You are on the panel: ') . $iv->kind . " with " . (string) $c->n . " for " . (string) ($c->jt ?? '') . ".\n\nWhen: $when (" . $iv->dur . " minutes)" . ($iv->where !== '' ? "\nWhere: " . $iv->where : '') . "\n\nOpen the candidate in the ATS to see the resume and fill in your scorecard afterwards: " . siteUrl() . "#/portal/admin/ats?c=" . $id . "\n\n" . (string) $u['name'];
                    try {
                        if (sendMail($e, $n, $subject, $body, emailHtml($subject, preg_split('/\n{2,}/', $body)), [['name' => 'invite.ics', 'type' => 'text/calendar; method=' . ($cancel ? 'CANCEL' : 'REQUEST'), 'data' => $ics]], (string) $u['email'])) {
                            $sent++;
                        }
                    } catch (Throwable $e2) {
                        // one failed invitation does not stop the rest
                    }
                }
                if ($sent) {
                    atsLog($c, (string) $u['name'], 'Invitations sent to ' . $sent . ' ' . ($sent === 1 ? 'person' : 'people'));
                    docSet('ats/' . $id, $c);
                }
            }
            ok(['intv' => $iv, 'sent' => $sent, 'c' => $c, 'cal' => $calOn ? ($iv->cal ?? null) : null, 'calErr' => $calErr]);
        case 'ats_card':
            // a scorecard from one interviewer (one per interviewer per interview / stage; a second submission replaces it)
            $u = requireUser();
            $id = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($b['id'] ?? ''));
            $c = $id !== '' ? docGet('ats/' . $id) : null;
            if (!$c) {
                fail(404, 'not_found', 'No such candidate.');
            }
            if (!can('ats/x', 'r') && !atsOnPanel($u, $c)) {
                fail(403, 'forbidden', 'Scorecards come from the interview panel.');
            }
            $in = is_array($b['card'] ?? null) ? $b['card'] : [];
            $attrs = [];
            foreach ((array) ($in['attrs'] ?? []) as $k => $v) {
                $k = mb_substr(trim((string) $k), 0, 60);
                $v = (int) $v;
                if ($k !== '' && $v >= 1 && $v <= 4) {
                    $attrs[$k] = $v;
                }
            }
            $rec = in_array((string) ($in['rec'] ?? ''), ['strong_yes', 'yes', 'no', 'strong_no'], true) ? (string) $in['rec'] : '';
            if ($rec === '' && !$attrs && trim((string) ($in['notes'] ?? '')) === '') {
                fail(400, 'invalid_argument', 'Rate at least one attribute, pick a recommendation or write a note.');
            }
            $card = (object) [
                'id' => rid(5),
                'by' => $u['id'],
                'byn' => (string) $u['name'],
                'intv' => preg_replace('/[^a-z0-9]/', '', (string) ($in['intv'] ?? '')),
                'stage' => preg_replace('/[^a-z0-9_\-]/', '', (string) ($in['stage'] ?? ($c->st ?? ''))),
                'attrs' => (object) $attrs,
                'rec' => $rec,
                'notes' => mb_substr((string) ($in['notes'] ?? ''), 0, 4000),
                'at' => now(),
            ];
            $cards = array_values(array_filter((array) ($c->cards ?? []), fn($x) => $x instanceof stdClass && !((string) ($x->by ?? '') === $u['id'] && (string) ($x->intv ?? '') === $card->intv && (string) ($x->stage ?? '') === $card->stage)));
            $cards[] = $card;
            $c->cards = $cards;
            $c->u = now();
            $labels = ['strong_yes' => 'Strong yes', 'yes' => 'Yes', 'no' => 'No', 'strong_no' => 'Strong no'];
            atsLog($c, (string) $u['name'], 'Scorecard submitted' . ($rec !== '' ? ': ' . $labels[$rec] : ''));
            docSet('ats/' . $id, $c);
            ok(['card' => $card, 'c' => $c]);
        case 'ats_match':
            // fit score (and an optional written summary) for one candidate or every active one on a job
            atsStaff(true);
            $id = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($b['id'] ?? ''));
            $jid = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($b['job'] ?? ''));
            $withSummary = !empty($b['summary']);
            $done = [];
            if ($id !== '') {
                $c = docGet('ats/' . $id);
                if (!$c) {
                    fail(404, 'not_found', 'No such candidate.');
                }
                $c->id = $id;
                $m = atsMatch($id, $c, atsPublicJob((string) ($c->job ?? '')));
                $c->score = (object) $m;
                if ($withSummary) {
                    $c->ai = (object) ['text' => atsSummary($c, atsPublicJob((string) ($c->job ?? '')), $m), 'at' => now()];
                }
                unset($c->id);
                $c->u = now();
                docSet('ats/' . $id, $c);
                ok(['score' => $c->score, 'ai' => $c->ai ?? null]);
            }
            $job = atsPublicJob($jid);
            if (!$job) {
                fail(404, 'not_found', 'No such job.');
            }
            foreach (colAll('ats') as [$cid, $c]) {
                if ((string) ($c->job ?? '') !== $jid) {
                    continue;
                }
                $kind = atsStageKind(atsJob($jid), (string) ($c->st ?? 'new'));
                if (in_array($kind, ['hired', 'rejected'], true)) {
                    continue;
                }
                $c->score = (object) atsMatch((string) $cid, $c, $job);
                $c->u = now();
                docSet('ats/' . $cid, $c);
                $done[] = ['id' => (string) $cid, 'v' => $c->score->v];
                if (count($done) >= 150) {
                    break;
                }
            }
            ok(['scored' => count($done), 'rows' => $done]);
        case 'ats_my_interviews':
            // the interviews a person sits on (any staff member or manager), with what they need to fill in a scorecard
            $u = requireUser();
            $S = atsSettings();
            $rows = [];
            $staff = can('ats/x', 'r');
            foreach (colAll('ats', 'u', 'desc') as [$id, $c]) {
                $mine = [];
                foreach ((array) ($c->intvs ?? []) as $iv) {
                    if ($iv instanceof stdClass && empty($iv->cancelled) && in_array($u['id'], array_map('strval', (array) ($iv->who ?? [])), true)) {
                        // v41: of an interview in the organiser's calendar the panel sees only the meeting link
                        $x = clone $iv;
                        if (isset($x->cal) && $x->cal instanceof stdClass) {
                            $x->cal = (object) ['p' => (string) ($x->cal->p ?? ''), 'join' => (string) ($x->cal->st ?? '') === 'cancelled' ? '' : (string) ($x->cal->join ?? '')];
                        }
                        $mine[] = $x;
                    }
                }
                if (!$mine) {
                    continue;
                }
                $job = atsJob((string) ($c->job ?? ''));
                if (empty($c->tok)) {
                    $c->tok = rid(16);
                    docSet('ats/' . $id, $c);
                }
                $kind = atsStageKind($job, (string) ($c->st ?? 'new'));
                $kit = (array) (($job['kit'][(string) ($c->st ?? '')] ?? null) ?: ($job['kit'][$kind] ?? null) ?: ($S['kits'][$kind] ?? $S['kits']['interview'] ?? []));
                $rows[] = [
                    'id' => (string) $id,
                    'n' => (string) ($c->n ?? ''),
                    'jt' => (string) ($c->jt ?? ''),
                    'ti' => (string) ($c->ti ?? ''),
                    'loc' => (string) ($c->loc ?? ''),
                    'sk' => (string) ($c->sk ?? ''),
                    'exp' => $c->exp ?? null,
                    'li' => (string) ($c->li ?? ''),
                    'msg' => (string) ($c->msg ?? ''),
                    'stage' => atsStageName($job, (string) ($c->st ?? '')),
                    'st' => (string) ($c->st ?? ''),
                    'stages' => $job['stages'],
                    'rid' => (string) ($c->rid ?? ''),
                    'rn' => (string) ($c->rn ?? ''),
                    'tok' => (string) $c->tok,
                    'intvs' => array_values($mine),
                    'attrs' => array_values((array) (($job['attrs'] ?? null) ?: $S['attrs'])),
                    'kit' => array_values($kit),
                    'cards' => array_values(array_filter((array) ($c->cards ?? []), fn($k) => $k instanceof stdClass && ((string) ($k->by ?? '') === $u['id'] || $staff))),
                    'others' => count(array_filter((array) ($c->cards ?? []), fn($k) => $k instanceof stdClass && (string) ($k->by ?? '') !== $u['id'])),
                    'score' => $staff ? ($c->score ?? null) : null,
                ];
            }
            ok(['rows' => $rows, 'staff' => $staff]);
        case 'ats_mail_info':
            // v36.4: what the Mail window needs: the person's own mailbox, and addresses to suggest
            $u = atsStaff();
            $book = [];
            $mine = docGet('ats/x/mailto/' . preg_replace('/[^A-Za-z0-9_]/', '', (string) $u['id']));
            foreach ((array) ($mine->list ?? []) as $x) {
                $book[(string) $x->e] = ['e' => (string) $x->e, 'n' => '', 'tag' => 'sent'];
            }
            $box = atsMailBox($u);
            if ($box) {
                $st = mymailDb()->prepare('SELECT email, name, tag FROM mail_user_book WHERE uid = ? ORDER BY last DESC LIMIT 300');
                $st->execute([$u['id']]);
                foreach ($st->fetchAll() as $row) {
                    $e = (string) $row['email'];
                    $book[$e] = ['e' => $e, 'n' => (string) ($book[$e]['n'] ?? '') ?: (string) $row['name'], 'tag' => (string) ($row['tag'] ?? '')];
                }
            }
            ok(['box' => $box, 'book' => array_values(array_slice($book, 0, 400)), 'max' => ATS_MAIL_MAX_IDS]);
        case 'ats_mail':
            // v36.4: profiles to a client or vendor (with their resumes), email to candidates, or a message to anyone
            $u = atsStaff(true);
            if ($_POST) {
                $b = array_merge($b, array_map(fn($v) => is_string($v) ? $v : '', $_POST));
            }
            $mode = in_array($b['mode'] ?? '', ['push', 'cand', 'any'], true) ? (string) $b['mode'] : '';
            if ($mode === '') {
                fail(400, 'invalid_argument', 'Choose what to send.');
            }
            $ids = array_values(array_unique(array_filter(array_map(fn($x) => preg_replace('/[^A-Za-z0-9_\-]/', '', (string) $x), (array) json_decode((string) ($b['ids'] ?? '[]'), true)))));
            if (count($ids) > ATS_MAIL_MAX_IDS) {
                fail(400, 'invalid_argument', 'Up to ' . ATS_MAIL_MAX_IDS . ' candidates at a time.');
            }
            $cands = [];
            foreach ($ids as $id) {
                $c = docGet('ats/' . $id);
                if ($c) {
                    $cands[$id] = $c;
                }
            }
            $subject = trim(str($b, 'subject', 300));
            $text = trim((string) ($b['body'] ?? ''));
            if ($subject === '' || $text === '') {
                fail(400, 'invalid_argument', 'Add a subject and a message.');
            }
            if (mb_strlen($text) > 20000) {
                fail(400, 'invalid_argument', 'The message is too long.');
            }
            $box = ($b['via'] ?? '') === 'box';
            $jobT = '';
            $jid = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($b['job'] ?? ''));
            if ($jid !== '' && ($jp = atsPublicJob($jid))) {
                $jobT = (string) ($jp->ti ?? '');
            }
            require_once __DIR__ . '/sso.php';
            if ($mode === 'cand') {
                // each candidate gets their own email ({first}, {name}, {job}, {me} filled in)
                if (!$cands) {
                    fail(400, 'invalid_argument', 'Add the candidates to email.');
                }
                if (throttleHit('atsmail:' . $u['id'], 300, 3600)) {
                    fail(429, 'rate_limited', 'That is a lot of email for one hour. Try again later.');
                }
                $sent = 0;
                $failed = [];
                $skipped = [];
                foreach ($cands as $id => $c) {
                    $e = strtolower(trim((string) ($c->e ?? '')));
                    if (!filter_var($e, FILTER_VALIDATE_EMAIL)) {
                        $skipped[] = (string) $c->n;
                        continue;
                    }
                    $vars = ['name' => (string) $c->n, 'first' => explode(' ', trim((string) $c->n))[0] ?? '', 'job' => $jobT !== '' ? $jobT : ((string) ($c->jt ?? '') ?: 'the role'), 'me' => (string) $u['name']];
                    [$ok, $err] = atsMailSend($u, [$e], [], atsFill($subject, $vars), atsFill($text, $vars), [], $box, true, 'candidate');
                    unset($c->lite);
                    atsLog($c, (string) $u['name'], ($ok ? 'Emailed: ' : 'Email failed: ') . atsFill($subject, $vars));
                    $c->u = now();
                    docSet('ats/' . $id, $c);
                    $ok ? $sent++ : ($failed[] = (string) $c->n . ': ' . $err);
                    if (!$ok && count($failed) >= 3 && !$sent) {
                        break; // the mailbox refuses everything: stop instead of trying the rest
                    }
                }
                audit('ats', 'ATS mail: candidates emailed', $subject, ['sent' => $sent, 'failed' => count($failed)], $u);
                ok(['sent' => $sent, 'failed' => $failed, 'skipped' => $skipped, 'via' => $box && atsMailBox($u) ? atsMailBox($u)['email'] : 'company mailbox']);
            }
            // one message to the people typed in (a client, a vendor, a hiring manager, anyone)
            $tos = mymailList($b['to'] ?? '');
            $cc = array_values(array_diff(mymailList($b['cc'] ?? ''), $tos));
            if (!$tos) {
                fail(400, 'invalid_argument', 'Add who it goes to (an email address).');
            }
            if (count($tos) > 20 || count($cc) > 20) {
                fail(400, 'invalid_argument', 'Up to 20 addresses in To and 20 in Cc.');
            }
            if ($mode === 'push' && !$cands) {
                fail(400, 'invalid_argument', 'Add the candidates whose profiles you are sending.');
            }
            if (throttleHit('atsmail:' . $u['id'], 300, 3600)) {
                fail(429, 'rate_limited', 'That is a lot of email for one hour. Try again later.');
            }
            $atts = [];
            $with = [];
            $size = 0;
            if (($b['attach'] ?? '') === '1') {
                foreach ($cands as $id => $c) {
                    $r = atsMailResume($id, $c);
                    if ($r) {
                        $atts[] = $r;
                        $with[] = $id;
                        $size += strlen($r['data']);
                    }
                }
            }
            // files added from the computer (anything a person may send): checked like every upload
            if ($mode === 'any' && isset($_FILES['file']) && is_array($_FILES['file']['name'] ?? null)) {
                foreach ($_FILES['file']['name'] as $i => $nm) {
                    if (($_FILES['file']['error'][$i] ?? 4) === UPLOAD_ERR_NO_FILE) {
                        continue;
                    }
                    if (count($atts) >= 30) {
                        break;
                    }
                    $name = mb_substr(basename((string) $nm), 0, 180);
                    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
                    $tmp = (string) ($_FILES['file']['tmp_name'][$i] ?? '');
                    if (($_FILES['file']['error'][$i] ?? 1) !== UPLOAD_ERR_OK || !isset(MIME[$ext]) || !is_uploaded_file($tmp)) {
                        fail(400, 'invalid_argument', $name . ' cannot be attached. Attach a PDF, image, Word, Excel, PowerPoint, CSV or text file.');
                    }
                    uploadGuard($tmp, $name);
                    $data = (string) file_get_contents($tmp);
                    $atts[] = ['name' => $name, 'type' => MIME[$ext], 'data' => $data];
                    $size += strlen($data);
                }
            }
            if ($size > ATS_MAIL_MAX_BYTES) {
                fail(400, 'too_large', 'The attachments come to ' . round($size / 1048576, 1) . ' MB; email takes about 20 MB. Send fewer resumes at a time, or leave some files out.');
            }
            [$ok, $err, $via] = atsMailSend($u, $tos, $cc, $subject, $text, $atts, $box, false, $mode === 'push' ? 'client' : '');
            if (!$ok) {
                fail(502, 'unavailable', $err !== '' ? $err : 'The message could not be sent.');
            }
            atsMailRemember($u, $tos);
            // each candidate whose profile went out shows it in their activity (and joins the working ATS)
            $toTxt = implode(', ', $tos);
            foreach ($cands as $id => $c) {
                if ($mode === 'any' && !in_array($id, $with, true)) {
                    continue;
                }
                atsLog($c, (string) $u['name'], ($mode === 'push' ? 'Profile sent to ' : 'Resume sent to ') . mb_substr($toTxt, 0, 160) . (in_array($id, $with, true) && $mode === 'push' ? ' (with the resume)' : '') . ': ' . $subject);
                $sentList = array_values(array_filter((array) ($c->sent ?? []), fn($x) => $x instanceof stdClass));
                $sentList[] = (object) ['t' => now(), 'to' => mb_substr($toTxt, 0, 300), 'by' => (string) $u['name'], 'job' => $jobT, 'res' => in_array($id, $with, true)];
                $c->sent = array_slice($sentList, -50);
                $c->u = now();
                docSet('ats/' . $id, $c);
            }
            audit('ats', $mode === 'push' ? 'ATS mail: profiles sent' : 'ATS mail: message sent', $toTxt, ['candidates' => count($cands), 'files' => count($atts), 'via' => $via], $u);
            ok(['sent' => 1, 'via' => $via, 'to' => $tos, 'atts' => count($atts), 'resumes' => count($with)]);
        case 'ats_pool': {
            // v36.2: people saved into the ATS by Talent search that nobody has worked with yet (left out of the live
            // ATS list so a big pool never slows the page): searched and paged here, newest first
            atsStaff();
            $words = array_values(array_filter(preg_split('/\s+/', mb_strtolower(str($b, 'q', 200))) ?: [], fn($w) => $w !== ''));
            $src = str($b, 'src', 60);
            $page = max(1, (int) ($b['page'] ?? 1));
            $size = 50;
            $rows = [];
            $srcs = [];
            foreach (colAll('ats') as [$id, $c]) {
                if ((string) $id === 'x' || empty($c->lite) || !isset($c->n)) {
                    continue;
                }
                $cs = (string) ($c->src ?? '');
                $srcs[$cs] = ($srcs[$cs] ?? 0) + 1;
                if ($src !== '' && $cs !== $src) {
                    continue;
                }
                if ($words) {
                    $hay = mb_strtolower(implode(' ', [(string) $c->n, (string) ($c->e ?? ''), (string) ($c->ti ?? ''), (string) ($c->sk ?? ''), (string) ($c->loc ?? ''), (string) ($c->auth ?? ''), $cs, implode(' ', array_map('strval', (array) ($c->tags ?? [])))]));
                    $all = true;
                    foreach ($words as $w) {
                        if (!str_contains($hay, $w)) {
                            $all = false;
                            break;
                        }
                    }
                    if (!$all) {
                        continue;
                    }
                }
                $rows[] = ['id' => (string) $id, 'n' => (string) $c->n, 'e' => (string) ($c->e ?? ''), 'ti' => (string) ($c->ti ?? ''), 'loc' => (string) ($c->loc ?? ''), 'auth' => (string) ($c->auth ?? ''), 'src' => $cs, 'tags' => array_values(array_map('strval', (array) ($c->tags ?? []))), 'at' => (int) ($c->at ?? 0), 'u' => (int) ($c->u ?? 0), 'rid' => (string) ($c->rid ?? ''), 'by' => (string) (($c->log[0]->ev ?? '') ?: '')];
            }
            usort($rows, fn($x, $y) => $y['at'] <=> $x['at']);
            arsort($srcs);
            ok(['rows' => array_slice($rows, ($page - 1) * $size, $size), 'total' => count($rows), 'page' => $page, 'size' => $size, 'srcs' => $srcs]);
        }
        case 'ats_dupes':
            atsStaff();
            ok(['rows' => atsDupes(str($b, 'e', 190), str($b, 'ph', 40), preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($b['id'] ?? '')))]);
        case 'ats_report':
            atsStaff();
            ok(atsReport(preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($b['from'] ?? '')) ? (string) $b['from'] : '', preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($b['to'] ?? '')) ? (string) $b['to'] : ''));
        case 'ats_hire':
            $u = atsStaff(true);
            if (!hasRole($u, 'admin') && !hasRole($u, 'hr')) {
                fail(403, 'forbidden', 'Only HR or an administrator can hire.');
            }
            $id = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($b['id'] ?? ''));
            $c = $id !== '' ? docGet('ats/' . $id) : null;
            if (!$c) {
                fail(404, 'not_found', 'No such candidate.');
            }
            $res = atsHire($id, $c, is_array($b['opt'] ?? null) ? $b['opt'] : [], $u);
            ok($res + ['c' => docGet('ats/' . $id)]);
        case 'ats_sources': {
            // people elsewhere in the portal who can be pulled into the ATS: consultant sign-ups and the recruiting database
            atsStaff(false);
            $src = (string) ($b['src'] ?? 'portal');
            $q = mb_strtolower(trim(mb_substr((string) ($b['q'] ?? ''), 0, 80)));
            $in = atsEmailsIn();
            $rows = [];
            if ($src === 'portal') {
                // members only (consultants, employees, recruiting team): the portal role lives in r/{uid}, not users.role
                $st = db()->query("SELECT id, name, email, role, status FROM users WHERE status = 'active'");
                $people = [];
                foreach ($st->fetchAll() as $usr) {
                    $rr = myR((string) $usr['id']);
                    $mr = (string) ($rr->role ?? '');
                    if (in_array($mr, ['consultant', 'employee', 'bench'], true) && ($rr->st ?? 'active') === 'active') {
                        $usr['role'] = $mr;
                        $people[$usr['id']] = $usr;
                    }
                }
                $jp = [];
                foreach (jdb()->query('SELECT uid, profile, resume_name, resume_fid, LENGTH(resume_text) AS tl FROM job_people')->fetchAll() as $p) {
                    $jp[$p['uid']] = $p;
                }
                foreach ($people as $uid => $usr) {
                    $p = $jp[$uid] ?? null;
                    $pr = $p ? jdec((string) $p['profile']) : [];
                    $prof = docGet('u/' . $uid);
                    $row = [
                        'kind' => 'portal', 'id' => (string) $uid, 'n' => (string) $usr['name'], 'e' => mb_strtolower((string) $usr['email']),
                        'ti' => (string) (($pr['titles'][0] ?? '') ?: ($prof->p->ti ?? '')), 'sk' => implode(', ', array_slice((array) ($pr['skills'] ?? []), 0, 8)),
                        'loc' => (string) (($pr['location'] ?? '') ?: ($prof->p->loc ?? '')), 'exp' => (int) ($pr['years'] ?? 0), 'role' => (string) $usr['role'],
                        'resume' => $p && ((string) $p['resume_fid'] !== '' || (int) $p['tl'] > 120), 'in' => $in[mb_strtolower((string) $usr['email'])] ?? '',
                    ];
                    $rows[] = $row;
                }
            } elseif ($src === 'db') {
                foreach (colAll('rec/cand/items') as [$id, $c]) {
                    $rows[] = [
                        'kind' => 'db', 'id' => (string) $id, 'n' => (string) ($c->n ?? ''), 'e' => mb_strtolower((string) ($c->e ?? '')), 'ph' => (string) ($c->ph ?? ''),
                        'ti' => (string) ($c->ti ?? ''), 'sk' => mb_substr((string) ($c->sk ?? ''), 0, 160), 'loc' => (string) ($c->loc ?? ''), 'auth' => (string) ($c->auth ?? ''),
                        'exp' => (float) ($c->exp ?? 0), 'st' => (string) ($c->st ?? ''), 'resume' => (string) ($c->rid ?? '') !== '', 'in' => ($c->e ?? '') !== '' ? ($in[mb_strtolower((string) $c->e)] ?? '') : '',
                    ];
                }
            } else {
                fail(400, 'invalid_argument', 'Unknown source.');
            }
            if ($q !== '') {
                $rows = array_values(array_filter($rows, fn($r) => str_contains(mb_strtolower($r['n'] . ' ' . $r['e'] . ' ' . $r['ti'] . ' ' . $r['sk'] . ' ' . $r['loc']), $q)));
            }
            usort($rows, fn($a, $b2) => ($a['in'] !== '') <=> ($b2['in'] !== '') ?: strcasecmp($a['n'], $b2['n']));
            ok(['rows' => array_slice($rows, 0, 500), 'boards' => ATS_BOARDS, 'ai' => aiReady('extract')]);
        }
        case 'ats_pull': {
            // copies the chosen people (with their resume file) into the ATS; anyone already here by email is skipped
            $u = atsStaff(true);
            $src = (string) ($b['src'] ?? '');
            $ids = array_slice(array_values(array_filter(array_map('strval', (array) ($b['ids'] ?? [])))), 0, 300);
            $jid = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($b['job'] ?? ''));
            if (!$ids || !in_array($src, ['portal', 'db'], true)) {
                fail(400, 'invalid_argument', 'Pick the people to import.');
            }
            $in = atsEmailsIn();
            $added = [];
            $skipped = [];
            foreach ($ids as $pid) {
                if ($src === 'portal') {
                    $st = db()->prepare('SELECT id, name, email, role FROM users WHERE id = ? AND status = ?');
                    $st->execute([$pid, 'active']);
                    $usr = $st->fetch();
                    $mr = $usr ? (string) (myR((string) $pid)->role ?? '') : '';
                    if ($usr) {
                        $usr['role'] = $mr;
                    }
                    if (!$usr || !in_array($mr, ['consultant', 'employee', 'bench'], true)) {
                        $skipped[] = $pid . ': not found';
                        continue;
                    }
                    $e = mb_strtolower((string) $usr['email']);
                    if (isset($in[$e])) {
                        $skipped[] = $usr['name'] . ': already in the ATS';
                        continue;
                    }
                    $s2 = jdb()->prepare('SELECT profile, resume_name, resume_fid, resume_text FROM job_people WHERE uid = ?');
                    $s2->execute([$pid]);
                    $p = $s2->fetch() ?: null;
                    $pr = $p ? jdec((string) $p['profile']) : [];
                    $prof = docGet('u/' . $pid);
                    $f = ['n' => $usr['name'], 'e' => $e, 'ph' => (string) ($prof->p->ph ?? ''), 'ti' => (string) (($pr['titles'][0] ?? '') ?: ($prof->p->ti ?? '')), 'sk' => implode(', ', array_slice((array) ($pr['skills'] ?? []), 0, 15)), 'loc' => (string) (($pr['location'] ?? '') ?: ($prof->p->loc ?? '')), 'exp' => (float) ($pr['years'] ?? 0)];
                    $id = atsNewCandidate($u, $f, 'Consultant portal', $jid, 'Imported from the ' . ($usr['role'] === 'consultant' ? 'consultant' : 'employee') . ' portal', ['uid' => (string) $pid]);
                    if ($p && (string) $p['resume_fid'] !== '') {
                        $doc = docGet('u/' . $pid . '/f/' . $p['resume_fid']);
                        atsCopyResume($id, (string) $p['resume_fid'], (string) ($doc->n ?? $p['resume_name'] ?? 'resume.pdf'));
                    }
                } else {
                    if (!preg_match('/^[A-Za-z0-9_\-]{1,40}$/', $pid)) {
                        continue;
                    }
                    $c = docGet('rec/cand/items/' . $pid);
                    if (!$c) {
                        $skipped[] = $pid . ': not found';
                        continue;
                    }
                    $e = mb_strtolower(trim((string) ($c->e ?? '')));
                    if ($e !== '' && isset($in[$e])) {
                        $skipped[] = ($c->n ?? $pid) . ': already in the ATS';
                        continue;
                    }
                    $f = ['n' => (string) ($c->n ?? ''), 'e' => $e, 'ph' => (string) ($c->ph ?? ''), 'ti' => (string) ($c->ti ?? ''), 'sk' => (string) ($c->sk ?? ''), 'loc' => (string) ($c->loc ?? ''), 'auth' => (string) ($c->auth ?? ''), 'exp' => (float) ($c->exp ?? 0), 'li' => (string) ($c->li ?? ''), 'rate' => (string) ($c->rate ?? '')];
                    if (trim($f['n']) === '') {
                        $skipped[] = $pid . ': no name';
                        continue;
                    }
                    $id = atsNewCandidate($u, $f, 'Consultant database', $jid, 'Imported from the consultant database', ['cand' => (string) $pid]);
                    if ((string) ($c->rid ?? '') !== '') {
                        atsCopyResume($id, (string) $c->rid, (string) ($c->rn ?? 'resume.pdf'));
                    }
                }
                if ($e !== '') {
                    $in[$e] = $id;
                }
                $added[] = ['id' => $id, 'n' => $f['n']];
            }
            ok(['added' => $added, 'skipped' => $skipped]);
        }
        case 'ats_upload': {
            // resumes downloaded from job boards (Dice, Monster, LinkedIn, Indeed...) or received by email: one candidate each
            $u = atsStaff(true);
            $board = in_array($_POST['board'] ?? '', ATS_BOARDS, true) ? (string) $_POST['board'] : 'Other job board';
            $jid = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($_POST['job'] ?? ''));
            $files = $_FILES['files'] ?? null;
            if (!$files || !is_array($files['name'] ?? null)) {
                fail(400, 'invalid_argument', 'Choose the resume files.');
            }
            $n = min(10, count($files['name']));
            session_write_close();
            @set_time_limit(60 + 30 * $n);
            $in = atsEmailsIn();
            $added = [];
            $skipped = [];
            for ($i = 0; $i < $n; $i++) {
                $f1 = ['name' => $files['name'][$i], 'type' => $files['type'][$i], 'tmp_name' => $files['tmp_name'][$i], 'error' => $files['error'][$i], 'size' => $files['size'][$i]];
                $name = mb_substr(basename((string) $f1['name']), 0, 180);
                $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
                if ($f1['error'] !== UPLOAD_ERR_OK || !in_array($ext, ['pdf', 'docx', 'txt'], true)) {
                    $skipped[] = $name . ': not a PDF, Word or text file';
                    continue;
                }
                require_once __DIR__ . '/guard.php';
                $why = guardUpload((string) $f1['tmp_name'], $name);
                if ($why !== '') {
                    $skipped[] = $name . ': ' . $why;
                    continue;
                }
                $text = cleanText(textFromFile((string) $f1['tmp_name'], $ext), 40000);
                if (mb_strlen($text) < 80) {
                    $skipped[] = $name . ': no readable text (a scanned image?)';
                    continue;
                }
                $f = atsFieldsFromText($text);
                if (trim((string) $f['n']) === '') {
                    $f['n'] = ucwords(trim(preg_replace('/[_\-]+|resume|cv|\.\w+$/i', ' ', $name) ?? $name)) ?: 'Unnamed candidate';
                }
                $e = mb_strtolower(trim((string) ($f['e'] ?? '')));
                if ($e !== '' && isset($in[$e])) {
                    $skipped[] = $name . ': ' . $f['n'] . ' is already in the ATS';
                    continue;
                }
                $id = atsNewCandidate($u, $f, $board, $jid, 'Imported from a ' . $board . ' resume');
                storeUpload($f1, 'ats/' . $id, ['c' => 'resume']);
                if ($e !== '') {
                    $in[$e] = $id;
                }
                $added[] = ['id' => $id, 'n' => $f['n'], 'e' => $e, 'ti' => (string) ($f['ti'] ?? '')];
            }
            ok(['added' => $added, 'skipped' => $skipped, 'ai' => aiReady('extract')]);
        }
        case 'ats_paste': {
            // a profile copied from a job-board page or an email: read into a candidate, the text kept as the resume
            $u = atsStaff(true);
            $board = in_array($b['board'] ?? '', ATS_BOARDS, true) ? (string) $b['board'] : 'Other job board';
            $jid = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($b['job'] ?? ''));
            $text = cleanText((string) ($b['text'] ?? ''), 40000);
            if (mb_strlen($text) < 80) {
                fail(400, 'invalid_argument', 'Paste the whole profile or resume (a few paragraphs at least).');
            }
            session_write_close();
            $f = atsFieldsFromText($text);
            if (trim((string) $f['n']) === '') {
                fail(400, 'invalid_argument', 'No name found in the text. Add the name on the first line and try again.');
            }
            $e = mb_strtolower(trim((string) ($f['e'] ?? '')));
            $in = atsEmailsIn();
            if ($e !== '' && isset($in[$e])) {
                fail(409, 'invalid_argument', $f['n'] . ' is already in the ATS.');
            }
            $id = atsNewCandidate($u, $f, $board, $jid, 'Imported from a ' . $board . ' profile');
            $dir = cfg('files_dir');
            if (!is_dir($dir)) {
                @mkdir($dir, 0775, true);
            }
            $fid = rid(16);
            if (fileWritePath("$dir/$fid", $text)) {
                docSet("ats/$id/f/$fid", (object) ['n' => preg_replace('/[^A-Za-z0-9 ._\-]/', '', $f['n']) . ' - ' . $board . ' profile.txt', 'ty' => MIME['txt'], 'sz' => strlen($text), 'at' => now(), 'c' => 'resume']);
            }
            ok(['id' => $id, 'fields' => $f]);
        }
        case 'ats_import':
            // rows from a CSV: name, email, phone, title, skills, location, source, job title, tags, notes
            $u = atsStaff(true);
            $rows = is_array($b['rows'] ?? null) ? $b['rows'] : [];
            if (!$rows || count($rows) > 2000) {
                fail(400, 'invalid_argument', 'Send between 1 and 2000 rows.');
            }
            $jid = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($b['job'] ?? ''));
            $pub = atsPublicJob($jid);
            $seen = [];
            foreach (colAll('ats') as [, $x]) {
                $seen[mb_strtolower(trim((string) ($x->e ?? '')))] = true;
            }
            $added = 0;
            $skipped = 0;
            foreach ($rows as $row) {
                if (!is_array($row)) {
                    continue;
                }
                $n = trim(mb_substr((string) ($row['n'] ?? ''), 0, 120));
                $e = mb_strtolower(trim(mb_substr((string) ($row['e'] ?? ''), 0, 190)));
                if ($n === '' || ($e !== '' && !filter_var($e, FILTER_VALIDATE_EMAIL)) || ($e !== '' && isset($seen[$e]))) {
                    $skipped++;
                    continue;
                }
                if ($e !== '') {
                    $seen[$e] = true;
                }
                $id = rid(6);
                docSet('ats/' . $id, (object) [
                    'n' => $n,
                    'e' => $e,
                    'ph' => mb_substr((string) ($row['ph'] ?? ''), 0, 40),
                    'ti' => mb_substr((string) ($row['ti'] ?? ''), 0, 120),
                    'sk' => mb_substr((string) ($row['sk'] ?? ''), 0, 600),
                    'loc' => mb_substr((string) ($row['loc'] ?? ''), 0, 120),
                    'auth' => mb_substr((string) ($row['auth'] ?? ''), 0, 40),
                    'exp' => (float) ($row['exp'] ?? 0) ?: null,
                    'li' => mb_substr((string) ($row['li'] ?? ''), 0, 300),
                    'src' => mb_substr((string) ($row['src'] ?? 'Import'), 0, 60) ?: 'Import',
                    'job' => $jid,
                    'jt' => $pub ? (string) ($pub->ti ?? '') : mb_substr((string) ($row['jt'] ?? ''), 0, 160),
                    'tags' => array_values(array_filter(array_map('trim', explode(',', (string) ($row['tags'] ?? ''))))),
                    'msg' => mb_substr((string) ($row['notes'] ?? ''), 0, 2000),
                    'st' => $jid !== '' ? 'new' : 'new',
                    'pool' => $jid === '',
                    'rating' => 0,
                    'notes' => [],
                    'at' => now(),
                    'stAt' => now(),
                    'u' => now(),
                    'by' => $u['id'],
                    'log' => [(object) ['t' => now(), 'who' => (string) $u['name'], 'ev' => 'Imported']],
                ]);
                $added++;
            }
            ok(['added' => $added, 'skipped' => $skipped]);
        case 'ats_export':
            atsStaff();
            $jid = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($b['job'] ?? ''));
            $out = [csvLine(['Name', 'Email', 'Phone', 'Title', 'Job', 'Stage', 'Source', 'Tags', 'Rating', 'Fit score', 'Location', 'Work authorization', 'Years', 'LinkedIn', 'Applied', 'Last change', 'Reason'])];
            foreach (colAll('ats', 'at', 'desc') as [$id, $c]) {
                if ($jid !== '' && (string) ($c->job ?? '') !== $jid) {
                    continue;
                }
                $job = atsJob((string) ($c->job ?? ''));
                $out[] = csvLine([(string) ($c->n ?? ''), (string) ($c->e ?? ''), (string) ($c->ph ?? ''), (string) ($c->ti ?? ''), (string) ($c->jt ?? ''), atsStageName($job, (string) ($c->st ?? '')), (string) ($c->src ?? ''), implode(', ', array_map('strval', (array) ($c->tags ?? []))), (string) ($c->rating ?? ''), (string) ($c->score->v ?? ''), (string) ($c->loc ?? ''), (string) ($c->auth ?? ''), (string) ($c->exp ?? ''), (string) ($c->li ?? ''), $c->at ? date('Y-m-d', (int) ($c->at / 1000)) : '', $c->u ? date('Y-m-d', (int) ($c->u / 1000)) : '', (string) ($c->why ?? '')]);
            }
            header('Content-Type: text/csv; charset=utf-8');
            header('Content-Disposition: attachment; filename="candidates.csv"');
            echo implode("\n", $out);
            exit();
        case 'ats_offer_letter':
            // the offer letter text with the placeholders filled (the browser turns it into the PDF for signing)
            atsStaff();
            $id = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($b['id'] ?? ''));
            $c = $id !== '' ? docGet('ats/' . $id) : null;
            if (!$c) {
                fail(404, 'not_found', 'No such candidate.');
            }
            $o = is_array($b['offer'] ?? null) ? $b['offer'] : (array) ($c->offer ?? []);
            $S = atsSettings();
            $tpl = trim((string) ($b['tpl'] ?? '')) !== '' ? (string) $b['tpl'] : (string) $S['offerTpl'];
            $pay = (float) ($o['pay'] ?? 0);
            $per = (string) ($o['per'] ?? 'hour');
            $cur = (string) ($o['cur'] ?? 'USD');
            $payTxt = $pay > 0 ? ($cur === 'INR' ? '₹' : '$') . number_format($pay, 2) . ($per === 'hour' ? ' per hour' : ($per === 'year' ? ' per year' : ' per ' . $per)) : 'as agreed';
            $type = (string) ($o['type'] ?? 'w2');
            $terms = (string) ($o['terms'] ?? '') !== '' ? (string) $o['terms'] : ($type === 'c2c' ? 'This is a corp-to-corp engagement with your company; you remain responsible for your own taxes, insurance and benefits.' : ($type === '1099' ? 'This is an independent-contractor engagement; you remain responsible for your own taxes.' : 'This is a W-2 ' . ((string) ($o['empType'] ?? '') ?: 'position') . '; standard payroll withholding and company benefits apply as described in the employee handbook.'));
            $text = atsFill($tpl, [
                'name' => (string) ($c->n ?? ''),
                'first' => explode(' ', trim((string) ($c->n ?? '')))[0] ?? '',
                'job' => (string) ($o['title'] ?? $c->jt ?? ''),
                'client' => (string) ($o['client'] ?? '') !== '' ? ' on assignment with ' . (string) $o['client'] : '',
                'start' => (string) ($o['start'] ?? '') !== '' ? date('F j, Y', strtotime((string) $o['start'])) : 'to be agreed',
                'pay' => $payTxt,
                'terms' => $terms,
                'expires' => (string) ($o['expires'] ?? '') !== '' ? date('F j, Y', strtotime((string) $o['expires'])) : 'further notice',
                'signer' => (string) ($o['signer'] ?? currentUser()['name'] ?? ''),
                'date' => date('F j, Y'),
            ]);
            ok(['text' => $text]);
        default:
            fail(404, 'not_found', 'Unknown action.');
    }
}
