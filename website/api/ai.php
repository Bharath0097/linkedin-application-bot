<?php
declare(strict_types=1);
/* The assistant across the portals (v31; "StratEdge AI" since v32), on the model set under Admin > Website & messages >
   Assistant (AI):
   - ai_ask      "StratEdge AI" on every portal page: answers about the page (its visible text, masked), teaches the
                 page, how-to questions from the app guide and the person's own menu, plans their day or week from
                 their own records (aiMyWork), and drafts text. It never changes anything.
   - ai_mail     v32: email help: summarize a message, list its action items, draft a reply or a follow-up.
   - ai_write    "Write with AI" next to the editors: write, improve, shorten or fix a draft of a given kind.
   - ai_extract  "Fill with AI": a pasted vendor email -> requirement fields; a resume -> consultant card fields.
   Each one has its own switch (aiReady('copilot' | 'copilotPage' | 'write' | 'extract')). */
require_once __DIR__ . '/textract.php';

/** What each portal holds, so how-to answers name the real pages. Kept short: it rides along with every question. */
const AI_APP_GUIDE = <<<'TXT'
StratEdge IT Consulting runs this portal for its IT staffing business. Every person signs in to the portals they have and switches between them from the sidebar.
CONSULTANT PORTAL: Dashboard; Matched jobs (jobs collected from job boards every few hours and matched to the active resume: Apply, Save, Tailor resume); Resume & preferences (upload up to several resumes, choose the active one, target titles and locations); Tailor my resume (paste a job description, get an ATS-friendly Word/PDF version with a match score); Apply profile & autofill (a bookmark button that fills job application forms); Attendance (clock in and out); Timesheets (weekly hours, submit for approval); Earnings (pay and paystubs); Time off; Tasks; Documents (upload work authorization, I-9 and other documents); Sign documents; Policies; Profile. Grow: USCIS compliance (status, dates, OPT/STEM OPT/H-1B/green card deadlines and tasks, documents), Immigration live updates (current USCIS News & Alerts, Department of State Visa Bulletin and Federal Register notices from official sources), Learning (courses with quizzes and certificates, including USCIS, STEM OPT and CHEA accreditation), Live projects (portfolio projects with milestones), Project vault (project records and files, shareable with recruiters).
EMPLOYEE PORTAL: Dashboard, Attendance, Timesheets, Earnings, Tasks, Time off, Documents, Sign documents, Policies, My email (connect your own Gmail or send with an app password), Profile, plus the Grow pages including Immigration live updates. Employee access also includes Jobs & matches, Requirements desk, Consultants, Tailor & submit, RTRs & submissions, Vendors & clients, Talent marketplace, the Bench desk, Storage box and Daily report unless an administrator blocks a specific feature.
CLIENT PORTAL: Dashboard, Source talent, Profile requests, Timesheets (approve consultants' hours), Consultants, Attendance, Requirements (post open roles), Invoices, Reports, Sign documents, Profile.
STAFF PORTALS (Admin, HR, Accounting, Manager; each sees the pages of their role): People - Team, Directory, HRMS, Onboarding, Document checks, Policies & templates, Compliance & deadlines, Learning platform. Time & pay - Approvals (timesheets, time off, clock-ins), Team attendance, Pay plans, Payroll runs & paystubs, Payroll setup, Taxes & filings. Finance - Books, Invoices, Bills & expenses, Bank import & matching, Accounting reports, Chart of accounts, Accounting settings. Recruiting & sales - Requirements desk (vendor requirements, matching consultants), Vendors & clients, Talent marketplace, Requirements, Recruiting & daily reports, Consultant database, Tailor & submit (JD -> ranked consultants -> tailored resume -> log submission and email the vendor), RTRs & submissions, Job portals, Apply profile & autofill, Candidates (ATS: requisitions, pipeline, interviews, offers), My interviews, Placements, CRM, Clients. Marketing & messages - Email, inbox & campaigns, My email, Ads & social posts, Announcements, E-signatures. Operations - Assign tasks, Reports. System - Storage box, Website & messages (website inbox, job openings, Assistant (AI) settings), Sign-in activity, Security & spam firewall, Roles & access (logins, portals, sign-in providers), System health.
TXT;

/** Numbers that look like SSNs, bank routing/account or card numbers are masked before page text leaves the server. */
function aiMask(string $t): string
{
    $t = preg_replace('/\b\d{3}-\d{2}-\d{4}\b/', '***-**-****', $t) ?? $t;
    $t = preg_replace('/\b(?:\d{4}[ \-]){3}\d{1,4}\b/', '**** **** **** ****', $t) ?? $t;
    $t = preg_replace_callback('/\b\d{12,19}\b|\b\d{9}\b/', fn($m) => str_repeat('*', max(0, strlen($m[0]) - 4)) . substr($m[0], -4), $t) ?? $t;
    return $t;
}
function aiRolesLine(array $u): string
{
    $roles = [];
    foreach (['admin' => 'administrator', 'hr' => 'HR', 'acct' => 'accounting', 'manager' => 'manager'] as $k => $n) {
        if (hasRole($u, $k)) {
            $roles[] = $n;
        }
    }
    if (!$roles && in_array('employee', portalsOf($u), true)) {
        $roles[] = 'StratEdge employee';
    } elseif (isRecruiter($u['id']) && !$roles) {
        $roles[] = 'StratEdge employee';
    }
    if (!$roles) {
        $roles[] = (string) ($u['role'] ?? '') === 'employer' ? 'client contact' : ((string) ($u['role'] ?? '') === 'consultant' ? 'consultant' : 'member');
    }
    return implode(', ', $roles);
}
/** v32: what is on this person's plate, from their own records only: clock-in, timesheets, assigned tasks,
 *  compliance deadlines, courses, tests, certifications, plan payments and new job matches. Each part is optional:
 *  one that fails is left out. */
function aiMyWork(array $u): string
{
    $uid = $u['id'];
    $tz = new DateTimeZone((string) (cfg('timezone') ?: 'America/New_York'));
    $now = new DateTimeImmutable('now', $tz);
    $today = $now->format('Y-m-d');
    $when = function (string $due) use ($today): string {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}/', $due)) {
            return '';
        }
        $days = (int) round((strtotime(substr($due, 0, 10)) - strtotime($today)) / 86400);
        return substr($due, 0, 10) . ($days < 0 ? ' (' . -$days . ' day' . ($days === -1 ? '' : 's') . ' overdue)' : ($days === 0 ? ' (today)' : ($days === 1 ? ' (tomorrow)' : ' (in ' . $days . ' days)')));
    };
    $out = [];
    $part = function (callable $f) use (&$out) {
        try {
            $f();
        } catch (Throwable $e) {
            // one part that fails is left out
        }
    };
    $ud = docGet("u/$uid");
    $r = myR($uid);
    require_once __DIR__ . '/rules.php';
    $ct = ruleCtOf($uid);
    $member = portalOf($uid);
    $payroll = $ct !== 'outside' && $ct !== 'student' && $member !== 'employer' && $member !== 'student';
    if ($payroll) {
        $part(function () use (&$out, $ud, $r, $now, $tz) {
            $c = $ud->clock ?? null;
            if ($c && !empty($c->on)) {
                $in = (new DateTimeImmutable('@' . intdiv((int) ($c->i ?? 0), 1000)))->setTimezone($tz);
                $out[] = 'Clock: clocked in since ' . $in->format('g:i A') . (!empty($c->brk) ? ', on a break now' : '') . '.';
            } else {
                $out[] = 'Clock: not clocked in right now.';
            }
            $ws = $now->modify('monday this week')->format('Y-m-d');
            $prev = $now->modify('monday this week')->modify('-7 days')->format('Y-m-d');
            $ts = isset($ud->ts) && $ud->ts instanceof stdClass ? (array) $ud->ts : [];
            $rev = $r && isset($r->rev) && $r->rev instanceof stdClass ? (array) $r->rev : [];
            foreach ([$prev => 'last week', $ws => 'this week'] as $w => $label) {
                $sum = $ts[$w] ?? null;
                $rv = $rev[$w] ?? null;
                if (!$sum) {
                    $st = 'no timesheet yet';
                } else {
                    $s = (string) ($sum->s ?? 'draft');
                    $same = $rv && (int) ($rv->v ?? 0) === (int) ($sum->u ?? -1);
                    $st = $same && ($rv->s ?? '') === 'reopened' ? 'reopened for changes' : ($s === 'submitted' ? ($same ? (string) $rv->s : 'submitted, waiting for approval') : ($rv && ($rv->s ?? '') === 'rejected' ? 'returned for changes' : 'draft, not submitted'));
                    $st .= ', ' . rtrim(rtrim(number_format((float) ($sum->t ?? 0), 2), '0'), '.') . ' h';
                }
                $out[] = 'Timesheet ' . $label . ' (week of ' . $w . '): ' . $st . '.';
            }
        });
    }
    $part(function () use (&$out, $ud, $r, $when) {
        $tasks = $r && isset($r->tasks) && $r->tasks instanceof stdClass ? (array) $r->tasks : [];
        $tp = $ud && isset($ud->tp) && $ud->tp instanceof stdClass ? (array) $ud->tp : [];
        $open = [];
        foreach ($tasks as $id => $t) {
            if (!$t instanceof stdClass || !empty($t->x)) {
                continue;
            }
            $s = (string) (($tp[$id] ?? null)->s ?? 'todo');
            if ($s === 'done') {
                continue;
            }
            $open[] = ['ti' => (string) ($t->ti ?? 'Task'), 'due' => (string) ($t->due ?? ''), 's' => $s, 'p' => (string) ($t->p ?? '')];
        }
        usort($open, fn($a, $b) => [$a['due'] === '' ? 1 : 0, $a['due']] <=> [$b['due'] === '' ? 1 : 0, $b['due']]);
        if ($open) {
            $out[] = 'Open tasks assigned to them (' . count($open) . '):';
            foreach (array_slice($open, 0, 8) as $t) {
                $out[] = '- ' . $t['ti'] . ($t['due'] !== '' ? ', due ' . $when($t['due']) : '') . ($t['s'] !== 'todo' ? ' [' . $t['s'] . ']' : '') . ($t['p'] === 'high' ? ' [high priority]' : '');
            }
        } else {
            $out[] = 'Open tasks: none.';
        }
    });
    $part(function () use (&$out, $uid, $today, $when) {
        if (!docGet("comp/$uid/profile")) {
            return;
        }
        require_once __DIR__ . '/comp.php';
        $c = compChecklist($uid, $today);
        $hot = array_values(array_filter($c['tasks'], fn($t) => in_array($t['sev'], ['late', 'soon'], true)));
        if ($hot) {
            $out[] = 'Compliance deadlines (overdue or within 30 days):';
            foreach (array_slice($hot, 0, 5) as $t) {
                $out[] = '- ' . $t['ti'] . ($t['due'] ? ', due ' . $when((string) $t['due']) : '');
            }
        }
    });
    $part(function () use (&$out, $uid) {
        require_once __DIR__ . '/learn.php';
        $courses = learnCourses();
        $req = learnRequired($uid, $courses);
        $need = [];
        $going = [];
        foreach ($courses as $c) {
            if (empty($c['pub'])) {
                continue;
            }
            $p = docGet("learn/$uid/p/" . $c['id']);
            if ($p && !empty($p->completedAt)) {
                continue;
            }
            if (isset($req[$c['id']])) {
                $need[] = $c['t'] . ' (' . (int) ($p->pct ?? 0) . '% done)';
            } elseif ($p && !empty($p->started)) {
                $going[] = $c['t'] . ' (' . (int) ($p->pct ?? 0) . '%)';
            }
        }
        if ($need) {
            $out[] = 'Required courses not finished: ' . implode('; ', array_slice($need, 0, 5)) . '.';
        }
        if ($going) {
            $out[] = 'Courses in progress: ' . implode('; ', array_slice($going, 0, 3)) . '.';
        }
    });
    $part(function () use (&$out, $uid, $when) {
        require_once __DIR__ . '/exams.php';
        $cfg = exTestsCfg();
        $st = exState($uid);
        $bits = [];
        if ($cfg['daily']['on']) {
            $d = $st['days'][exToday()] ?? null;
            $bits[] = $d === null ? 'today\'s daily test not taken yet' : 'today\'s daily test done (' . (int) $d . '%)';
        }
        if ($cfg['weekly']['on']) {
            $w = $st['weeks'][exWeek()] ?? null;
            $bits[] = $w === null ? 'this week\'s test not taken yet' : 'this week\'s test done (' . (int) $w . '%)';
        }
        if ($bits) {
            $out[] = 'Tests: ' . implode('; ', $bits) . ($st['streak'] ? '; streak ' . $st['streak'] . ' days' : '') . '.';
        }
        foreach (exCerts($uid) as $c) {
            $exp = (int) ($c['exp'] ?? 0);
            if ($exp > 0 && $exp < now() + 60 * 86400000) {
                $out[] = 'Certification "' . ($c['t'] ?? '') . '" ' . ($exp < now() ? 'expired on ' : 'expires on ') . date('Y-m-d', intdiv($exp, 1000)) . '.';
            }
        }
    });
    if ($ct === 'outside' || $ct === 'student') {
        $part(function () use (&$out, $uid, $when) {
            require_once __DIR__ . '/billing.php';
            $a = billDoc($uid);
            $st = billState($a);
            if ($st === 'none') {
                $out[] = 'Plan: none chosen yet (Plans & payments).';
                return;
            }
            $next = null;
            foreach ($a['items'] as $x) {
                if (in_array($x['st'] ?? '', ['due', 'reported'], true)) {
                    $next = $x;
                    break;
                }
            }
            $out[] = 'Plan: ' . ($a['pt'] ?? 'plan') . ', ' . str_replace('_', ' ', $st) . ($next ? '; next payment ' . $next['t'] . ', ' . billMoney((int) $next['amt']) . ', due ' . $when((string) $next['due']) . (($next['st'] ?? '') === 'reported' ? ' (reported, being checked)' : '') : '') . '.';
        });
    }
    $part(function () use (&$out, $uid) {
        require_once __DIR__ . '/jobs.php';
        $n = jobMatchCounts($uid);
        if (($n['new'] ?? 0) > 0) {
            $out[] = 'Matched jobs: ' . $n['new'] . ' new to review' . (($n['saved'] ?? 0) ? ', ' . $n['saved'] . ' saved' : '') . '.';
        }
    });
    return implode("\n", $out);
}
function aiStaffUser(array $u): bool
{
    return hasRole($u, 'admin') || hasRole($u, 'hr') || isRecruiter($u['id']) || isBench($u['id']);
}
function aiCompanyFacts(): string
{
    static $f = null;
    if ($f === null) {
        $kb = @include __DIR__ . '/knowledge.php';
        $f = is_array($kb) ? mb_substr((string) ($kb['facts'] ?? ''), 0, 1600) : '';
    }
    return $f;
}
/** One chat call with a message list; the reply text or ''. */
function aiChatText(array $messages, int $maxTokens = 900, float $temp = 0.3, int $timeout = 60): string
{
    [, $j] = aiPost(['max_tokens' => $maxTokens, 'temperature' => $temp, 'messages' => $messages], $timeout);
    return is_array($j) ? trim((string) ($j['choices'][0]['message']['content'] ?? '')) : '';
}

/** A resume (or a job-board profile) -> consultant fields; only what is stated. null when the assistant did not answer. */
function aiCandFields(string $text): ?array
{
    $auth = ['US citizen', 'Green card', 'H-1B', 'H4 EAD', 'OPT / CPT', 'L2 EAD', 'TN', 'GC EAD', 'Other'];
    $j = aiJson(
        'You read resumes for a staffing firm and fill a consultant card. Copy what is stated; never guess contact details, visa status or rates. Answer with one JSON object only.',
        'Return {"n":"full name","e":"email","ph":"phone","li":"LinkedIn URL","ti":"current or target job title","sk":"key skills, comma separated, at most 15, most important first","exp":0,"loc":"City, ST","auth":"one of: ' . implode(', ', $auth) . ', or empty when not stated","rate":"expected rate only if stated","avail":"availability only if stated","emp":"current employer only if stated"}' . "\n\nRESUME:\n" . mb_substr($text, 0, 14000),
        900
    );
    if (!$j) {
        return null;
    }
    $s = fn($k, $max = 200) => mb_substr(trim((string) ($j[$k] ?? '')), 0, $max);
    $a = $s('auth', 30);
    $exp = (float) ($j['exp'] ?? 0);
    return array_filter([
        'n' => $s('n', 120), 'e' => filter_var($s('e', 190), FILTER_VALIDATE_EMAIL) ? strtolower($s('e', 190)) : '', 'ph' => $s('ph', 40), 'li' => $s('li', 200),
        'ti' => $s('ti', 120), 'sk' => $s('sk', 600), 'exp' => $exp > 0 && $exp < 60 ? (string) round($exp, 1) : '', 'loc' => $s('loc', 120),
        'auth' => in_array($a, $auth, true) ? $a : '', 'rate' => $s('rate', 60), 'avail' => $s('avail', 60), 'emp' => $s('emp', 120),
    ], fn($v) => $v !== '' && $v !== null);
}

/* ---------- Write with AI: what each kind of text is ---------- */
const AI_WRITE_KINDS = [
    'email' => ['an email to one person or a few people', true],
    'campaign' => ['a mass email sent to many recipients (newsletter, job alert, outreach)', true],
    'reply' => ['a reply to the email given under ORIGINAL', false],
    'job' => ['a job posting description with the sections About the role, Responsibilities, Requirements, Nice to have (use "- " bullets)', false],
    'announcement' => ['an internal announcement for StratEdge staff and consultants', false],
    'task' => ['the details of a task assigned to an employee or consultant: what to do, by when, what done looks like', false],
    'esign' => ['a short message to the person asked to sign a document: what it is and what to check', false],
    'vendor' => ['a short note to a staffing vendor that goes with a consultant submission (availability, rate, interview slots)', false],
    'eod' => ['an end-of-day recruiting report for HR: submissions, interviews, follow-ups, blockers', false],
    'note' => ['an internal note', false],
    'post' => ['a LinkedIn post for the company page, with up to 5 hashtags at the end', false],
    'generic' => ['the text described', false],
];

function aiRoute(string $r, array $b): never
{
    switch ($r) {
        case 'ai_ask': {
            $u = requireUser();
            if (!aiReady('copilot')) {
                fail(400, 'invalid_argument', aiReady() ? 'StratEdge AI is switched off (Admin > Website & messages > Assistant (AI)).' : 'No assistant is set up yet. An administrator adds one under Admin > Website & messages > Assistant (AI).');
            }
            $q = trim(mb_substr((string) ($b['q'] ?? ''), 0, 2000));
            if ($q === '') {
                fail(400, 'invalid_argument', 'Ask something.');
            }
            if (throttleHit('ai_ask:' . $u['id'], 80, 3600)) {
                fail(429, 'rate_limited', 'That is a lot of questions for one hour. Try again a little later.');
            }
            session_write_close();
            @set_time_limit(90);
            $page = mb_substr(trim((string) ($b['page'] ?? '')), 0, 120);
            $portal = mb_substr(trim((string) ($b['portal'] ?? '')), 0, 60);
            $nav = array_slice(array_values(array_filter(array_map(fn($x) => mb_substr(trim((string) $x), 0, 60), (array) ($b['nav'] ?? [])))), 0, 80);
            // v78: the page's own text is content, not instructions: the AI shield reads it for prompt-injection,
            // fences it off and blanks secrets before the model sees it (aiMask still masks personal numbers).
            $text = '';
            if (aiReady('copilotPage')) {
                $raw = aiMask(mb_substr(trim((string) ($b['text'] ?? '')), 0, 9000));
                if ($raw !== '') {
                    require_once __DIR__ . '/copilot.php';
                    $text = aiReady('shield') ? cpFence($raw, 'page text', true) : $raw;
                }
            }
            // v32: their own day and week (tasks, timesheets, deadlines, courses, tests, payments) when they ask about it
            $wantWork = aiReady('mywork') && (!empty($b['me']) || preg_match('/\b(my (day|week|time|tasks?|schedule|deadlines?|work|plate|priorities)|today|tomorrow|this week|next week|due|deadlines?|overdue|remind\w*|timesheets?|hours|clock(ed)?[ -]?in|what should i (do|work on)|prioriti[sz]e|plan)\b/i', $q));
            $work = '';
            if ($wantWork) {
                try {
                    $work = aiMyWork($u);
                } catch (Throwable $e) {
                    $work = '';
                }
            }
            // v53: immigration questions are grounded in the same live official-source cache shown on
            // Grow > Immigration live updates. Unrelated questions never make these outside requests.
            $liveImm = '';
            $liveImmMeta = null;
            try {
                require_once __DIR__ . '/immnews.php';
                [$liveImm, $liveImmMeta] = immnewsContext($q, 9);
            } catch (Throwable $e) {
                $liveImm = '';
                $liveImmMeta = null;
            }
            $tzNow = new DateTimeImmutable('now', new DateTimeZone((string) (cfg('timezone') ?: 'America/New_York')));
            $sys = "You are StratEdge AI, the assistant built into the StratEdge IT Consulting portal (an IT staffing firm: consultants, employees, students, client contacts, HR, accounting and recruiters). You are helping " . ($u['name'] ?: 'the person') . " (" . aiRolesLine($u) . ")" . ($portal !== '' ? " in the " . $portal : '') . ($page !== '' ? " on the page \"" . $page . "\"" : '') . ". It is " . $tzNow->format('l, F j, Y, g:i A') . ".\n" .
                "RULES: Answer questions about the page from PAGE TEXT; never invent records, names, numbers or dates that are not there, and say so when the page does not show something. For how-to questions use the menu names under MENU and the APP GUIDE, written like Menu > Page > Tab. When asked to explain or teach this page, give a short lesson: what the page is for, what each part of the screen shows, numbered steps for the two or three things people do most here, and one tip. When asked about their day, week, time or deadlines, use MY WORK: overdue items first, then what is due soonest, and timesheet or clock-in reminders; suggest an order with rough time blocks (for example 9:00-9:30). When MY WORK is not given, say where to look (Tasks, Timesheets, Compliance). When asked to draft something (an email, a message, a summary, a job post), write it ready to paste. When asked to quiz them, ask the questions one at a time and wait for their answer before giving the right one. You cannot click, change, send or save anything: tell the person where to do it. Be concise: short paragraphs or '- ' bullets, no markdown headings, no tables, no code fences. For immigration questions, prefer LIVE OFFICIAL IMMIGRATION UPDATES when supplied; say when the official sources were checked, distinguish a new announcement from a standing rule, include the official source URL(s) you relied on, and never infer a person's eligibility or case outcome. Immigration information is general information, not legal advice; for a case-specific decision tell the person to confirm with HR or qualified immigration counsel. When no live context is supplied, do not claim you checked today's immigration news; point them to Grow > Immigration live updates. Do not state legal, immigration or tax rules as settled fact.\n\n" .
                "APP GUIDE:\n" . AI_APP_GUIDE .
                ($nav ? "\n\nMENU (what this person sees):\n" . implode(' | ', $nav) : '') .
                ($work !== '' ? "\n\nMY WORK (their own records right now):\n" . $work : '') .
                ($liveImm !== '' ? "\n\nLIVE OFFICIAL IMMIGRATION UPDATES (current official-source snapshot; use for this immigration question):\n" . $liveImm : '') .
                ($text !== '' ? "\n\nPAGE TEXT (what is on their screen now; sensitive numbers masked):\n" . $text : "\n\n(No page text was shared.)");
            $msgs = [['role' => 'system', 'content' => $sys]];
            foreach (array_slice((array) ($b['hist'] ?? []), -8) as $h) {
                $h = (array) $h;
                $role = ($h['role'] ?? '') === 'assistant' ? 'assistant' : 'user';
                $c = mb_substr(trim((string) ($h['content'] ?? '')), 0, 2000);
                if ($c !== '') {
                    $msgs[] = ['role' => $role, 'content' => $c];
                }
            }
            $msgs[] = ['role' => 'user', 'content' => $q];
            $answer = aiChatText($msgs, 900, 0.3, 75);
            if ($answer === '') {
                fail(502, 'unavailable', hasRole($u, 'admin') ? 'The assistant did not answer. Check it under Admin > Website & messages > Assistant (AI) (the Test button says why).' : 'The assistant did not answer. Try again in a minute.');
            }
            ok(['answer' => $answer, 'page' => $text !== '', 'work' => $work !== '', 'live' => $liveImm !== '', 'liveAsOf' => is_array($liveImmMeta) ? (string) ($liveImmMeta['asOf'] ?? '') : '', 'liveStale' => is_array($liveImmMeta) && !empty($liveImmMeta['stale'])]);
        }
        case 'ai_mail': {
            // v32: email help on an open message: a summary, its action items, a reply or a follow-up to edit and send
            $u = requireUser();
            if (!aiReady('mail')) {
                fail(400, 'invalid_argument', aiReady() ? 'Email help is switched off (Admin > Website & messages > Assistant (AI)).' : 'No assistant is set up yet. An administrator adds one under Admin > Website & messages > Assistant (AI).');
            }
            if (throttleHit('ai_mail:' . $u['id'], 120, 3600)) {
                fail(429, 'rate_limited', 'That is a lot of emails for one hour. Try again a little later.');
            }
            $op = in_array($b['op'] ?? '', ['summary', 'actions', 'reply', 'followup'], true) ? (string) $b['op'] : 'summary';
            $from = mb_substr(trim((string) ($b['from'] ?? '')), 0, 200);
            $subject = mb_substr(trim((string) ($b['subject'] ?? '')), 0, 300);
            // v78: an email is someone else's words — the AI shield fences it before the model reads it
            $text = aiMask(mb_substr(trim((string) ($b['text'] ?? '')), 0, 9000));
            if ($text !== '' && aiReady('shield')) {
                require_once __DIR__ . '/copilot.php';
                $text = cpFence($text, 'email', false);
            }
            $brief = mb_substr(trim((string) ($b['brief'] ?? '')), 0, 1000);
            $tone = in_array($b['tone'] ?? '', ['professional', 'friendly', 'concise', 'formal'], true) ? (string) $b['tone'] : 'professional';
            if (mb_strlen($text) < 5) {
                fail(400, 'invalid_argument', 'Open an email first.');
            }
            session_write_close();
            @set_time_limit(90);
            $who = ($u['name'] ?: 'the person') . ' (' . aiRolesLine($u) . ')';
            if ($op === 'summary' || $op === 'actions') {
                $task = $op === 'summary'
                    ? 'Summarize the email below in 3 to 5 "- " bullets: who it is from and what they want, and any dates, deadlines, rates, attachments or people it mentions. Then one line starting with "Next step:" saying what to do (reply, forward, schedule, or nothing).'
                    : 'List the action items in the email below as "- " bullets, each with who should do it and by when ("no date given" when there is none). If there are none, say so in one line.';
                $ans = aiChatText([
                    ['role' => 'system', 'content' => 'You are StratEdge AI, helping ' . $who . ' at StratEdge IT Consulting, an IT staffing firm, with their email. Plain text: "- " bullets, no headings, no tables. Never invent anything that is not in the email.'],
                    ['role' => 'user', 'content' => $task . "\n\nFROM: $from\nSUBJECT: $subject\n\nEMAIL:\n$text"],
                ], 700, 0.2, 75);
                if ($ans === '') {
                    fail(502, 'unavailable', 'The assistant did not answer. Try again in a minute.');
                }
                ok(['text' => $ans]);
            }
            $j = aiJson(
                'You write email replies for ' . $who . ' at StratEdge IT Consulting, a US IT staffing and consulting firm. Plain text only: no markdown, "- " for bullets, blank lines between paragraphs. Never invent names, numbers, rates, dates or promises that are not in the email or the instructions; leave a [bracketed placeholder] where a needed detail is missing. Sign off with the writer\'s first name. Answer with one JSON object only: {"text":"..."}',
                'TASK: ' . ($op === 'reply' ? 'Write a reply to the email below.' : 'Write a short, polite follow-up on the email below, for when there has been no answer yet.') . "\nTONE: $tone.\n" . ($brief !== '' ? "WHAT IT SHOULD SAY:\n$brief\n" : '') . "\nFROM: $from\nSUBJECT: $subject\n\nEMAIL:\n$text\n\nCOMPANY FACTS (only when relevant):\n" . aiCompanyFacts(),
                1100
            );
            $out = trim((string) ($j['text'] ?? ''));
            if ($out === '') {
                fail(502, 'unavailable', 'The assistant did not answer. Try again in a minute.');
            }
            ok(['text' => mb_substr($out, 0, 8000)]);
        }
        case 'ai_write': {
            $u = requireUser();
            if (!aiReady('write')) {
                fail(400, 'invalid_argument', 'Write with AI is switched off (Admin > Website & messages > Assistant (AI)).');
            }
            if (throttleHit('ai_write:' . $u['id'], 120, 3600)) {
                fail(429, 'rate_limited', 'That is a lot of drafts for one hour. Try again a little later.');
            }
            $kind = isset(AI_WRITE_KINDS[(string) ($b['kind'] ?? '')]) ? (string) $b['kind'] : 'generic';
            [$what, $withSubject] = AI_WRITE_KINDS[$kind];
            $op = in_array($b['op'] ?? '', ['write', 'improve', 'shorten', 'expand', 'fix'], true) ? (string) $b['op'] : 'write';
            $brief = trim(mb_substr((string) ($b['brief'] ?? ''), 0, 2000));
            $draft = trim(mb_substr((string) ($b['text'] ?? ''), 0, 8000));
            $tone = in_array($b['tone'] ?? '', ['professional', 'friendly', 'persuasive', 'concise', 'formal'], true) ? (string) $b['tone'] : 'professional';
            $len = in_array($b['len'] ?? '', ['short', 'medium', 'long'], true) ? (string) $b['len'] : 'medium';
            if ($op === 'write' && $brief === '' && $draft === '') {
                fail(400, 'invalid_argument', 'Say what it should be about.');
            }
            if ($op !== 'write' && $draft === '') {
                fail(400, 'invalid_argument', 'There is no text to work on yet.');
            }
            $ctx = [];
            foreach (array_slice((array) ($b['ctx'] ?? []), 0, 12, true) as $k => $v) {
                $k = preg_replace('/[^A-Za-z0-9 _\-]/', '', (string) $k) ?? '';
                $v = trim(mb_substr(is_scalar($v) ? (string) $v : json_encode($v), 0, $k === 'original' ? 4000 : 600));
                if ($k !== '' && $v !== '') {
                    $ctx[] = $k . ': ' . $v;
                }
            }
            $vars = array_slice(array_values(array_filter(array_map(fn($x) => preg_match('/^\{[a-z_]{1,30}\}$/', (string) $x) ? (string) $x : '', (array) ($b['vars'] ?? [])))), 0, 12);
            $task = [
                'write' => 'Write ' . $what . '.',
                'improve' => 'Improve the DRAFT (' . $what . '): clearer, better structured, same facts and meaning.',
                'shorten' => 'Shorten the DRAFT (' . $what . ') to about half, keeping every fact that matters.',
                'expand' => 'Expand the DRAFT (' . $what . ') with more useful detail, without inventing facts.',
                'fix' => 'Fix spelling, grammar and tone in the DRAFT (' . $what . '); change as little as possible.',
            ][$op];
            $sys = 'You write for StratEdge IT Consulting, a US IT staffing and consulting firm. Plain text only: no markdown, no headings with #, no bold; "- " for bullets; blank lines between paragraphs. Never invent names, numbers, rates, dates or promises that are not given; leave a [bracketed placeholder] where a needed detail is missing. Answer with one JSON object only: ' . ($withSubject ? '{"subject":"...","text":"..."}' : '{"text":"..."}') . '.';
            $prompt = "TASK: $task\nTONE: $tone. LENGTH: $len.\n" .
                ($vars ? 'PLACEHOLDERS that are filled in per recipient (use them where natural, exactly as written): ' . implode(', ', $vars) . "\n" : '') .
                ($ctx ? "CONTEXT:\n" . implode("\n", $ctx) . "\n" : '') .
                ($brief !== '' ? "WHAT IT SHOULD SAY:\n$brief\n" : '') .
                ($draft !== '' ? "DRAFT:\n$draft\n" : '') .
                "\nCOMPANY FACTS (use only when relevant):\n" . aiCompanyFacts() . "\nThe person writing is " . ($u['name'] ?: 'a StratEdge team member') . '.';
            $j = aiJson($sys, $prompt, $len === 'long' ? 1800 : 1100);
            $text = trim((string) ($j['text'] ?? ''));
            if ($text === '') {
                fail(502, 'unavailable', 'The assistant did not answer. Try again in a minute.');
            }
            ok(['text' => mb_substr($text, 0, 12000), 'subject' => $withSubject ? mb_substr(trim((string) ($j['subject'] ?? '')), 0, 200) : '']);
        }
        case 'ai_extract': {
            // multipart when a file comes along
            $u = requireUser();
            $in = $b ?: $_POST;
            if (!aiStaffUser($u)) {
                fail(403, 'invalid_argument', 'Filling forms with AI is for employees, recruiters and HR.');
            }
            if (!aiReady('extract')) {
                fail(400, 'invalid_argument', 'Fill with AI is switched off (Admin > Website & messages > Assistant (AI)).');
            }
            if (throttleHit('ai_extract:' . $u['id'], 120, 3600)) {
                fail(429, 'rate_limited', 'That is a lot for one hour. Try again a little later.');
            }
            $kind = (string) ($in['kind'] ?? '');
            $text = cleanText((string) ($in['text'] ?? ''), 20000);
            $base = (string) ($in['base'] ?? '');
            if ($text === '' && $base !== '') {
                if (!validPath($base, true) || !can($base, 'r')) {
                    fail(404, 'not_found', 'That record is not there.');
                }
                require_once __DIR__ . '/vms.php';
                $text = cleanText(vmsResumeText($base), 20000);
            }
            if ($text === '' && isset($_FILES['file']) && ($_FILES['file']['error'] ?? 1) === UPLOAD_ERR_OK) {
                $ext = strtolower(pathinfo((string) $_FILES['file']['name'], PATHINFO_EXTENSION));
                uploadGuard((string) $_FILES['file']['tmp_name'], basename((string) $_FILES['file']['name']));
                if (in_array($ext, ['pdf', 'docx', 'txt'], true)) {
                    $text = cleanText(textFromFile((string) $_FILES['file']['tmp_name'], $ext), 20000);
                }
            }
            if (mb_strlen($text) < 40) {
                fail(400, 'invalid_argument', $kind === 'cand' ? 'Attach or paste the resume first (a PDF, Word or text file with readable text).' : 'Paste the requirement text first.');
            }
            // v78: a pasted resume or requirement is untrusted content — the AI shield fences it before extraction
            if (aiReady('shield')) {
                require_once __DIR__ . '/copilot.php';
                $text = cpFence($text, $kind === 'cand' ? 'resume' : 'requirement', false);
            }
            session_write_close();
            @set_time_limit(90);
            if ($kind === 'req') {
                $j = aiJson(
                    'You read staffing requirements that vendors and clients send by email and fill a form. Copy what is stated; leave a field empty when it is not stated. Answer with one JSON object only.',
                    'Return {"ti":"role title","ec":"end client","vn":"vendor or company that sent it","loc":"City, ST","md":"Onsite|Hybrid|Remote","ty":"C2C|W2|1099|Contract-to-hire|Full-time|SOW","rate":"pay or bill rate as written","dur":"duration","n":1,"sk":"must-have skills, comma separated, at most 10","visa":"accepted work authorizations as written","cn":"contact name","ce":"contact email","cp":"contact phone","sd":"start date as YYYY-MM-DD or empty"}' . "\n\nREQUIREMENT:\n" . mb_substr($text, 0, 12000),
                    900
                );
                if (!$j) {
                    fail(502, 'unavailable', 'The assistant did not answer. Try again in a minute.');
                }
                $s = fn($k, $max = 200) => mb_substr(trim((string) ($j[$k] ?? '')), 0, $max);
                $md = $s('md', 12);
                $ty = $s('ty', 24);
                $sd = $s('sd', 10);
                ok(['fields' => array_filter([
                    'ti' => $s('ti', 160), 'ec' => $s('ec', 160), 'vn' => $s('vn', 160), 'loc' => $s('loc', 160),
                    'md' => in_array($md, ['Onsite', 'Hybrid', 'Remote'], true) ? $md : '',
                    'ty' => in_array($ty, ['C2C', 'W2', '1099', 'Contract-to-hire', 'Full-time', 'SOW'], true) ? $ty : '',
                    'rate' => $s('rate', 80), 'dur' => $s('dur', 60), 'n' => max(1, min(99, (int) ($j['n'] ?? 1))), 'sk' => $s('sk', 600), 'visa' => $s('visa', 160),
                    'cn' => $s('cn', 120), 'ce' => filter_var($s('ce', 190), FILTER_VALIDATE_EMAIL) ? $s('ce', 190) : '', 'cp' => $s('cp', 40),
                    'sd' => preg_match('/^\d{4}-\d{2}-\d{2}$/', $sd) ? $sd : '',
                ], fn($v) => $v !== '' && $v !== null)]);
            }
            if ($kind === 'cand') {
                $f = aiCandFields($text);
                if ($f === null) {
                    fail(502, 'unavailable', 'The assistant did not answer. Try again in a minute.');
                }
                ok(['fields' => $f]);
            }
            fail(400, 'invalid_argument', 'Unknown kind.');
        }
    }
    fail(404, 'not_found', 'Unknown action.');
}
