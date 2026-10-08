<?php
declare(strict_types=1);
/*
 * StratEdge AI screening agent (v33).
 *   Reads every new candidate - website and portal applications, resumes emailed to the company inbox (by the person,
 *   a job board such as Dice, or a vendor) and candidates the team adds to the ATS - and:
 *     1. checks them against the job (StratEdge AI when it is set up, the ATS fit score otherwise; knockout answers and
 *        the job's work-authorization rule always count);
 *     2. looks for signs of a fake or borrowed profile (the same phone, email, LinkedIn or resume under another name,
 *        throwaway email addresses, impossible timelines, "10 years of" a tool that is younger than that, text copied
 *        from the job description, profiles marked fake before, and what StratEdge AI notices);
 *     3. emails them (or the vendor who sent them) a secure link to confirm their details: the basics, LinkedIn and two
 *        references, a few questions about the job only someone who did the work answers well, and a copy of their
 *        work authorization or ID - with reminders until the link runs out;
 *     4. reads what comes back (the form, or a reply by email), checks it against the resume and other candidates, and
 *        files the candidate as verified (and moves them to the job's screening stage) or "needs a recruiter".
 *   Candidates who do not look like a match are never emailed by the agent: a recruiter decides (reject with or
 *   without the "not a match" email, keep, or ask for details anyway).
 * Data: settings ats/x/agent/cfg; activity ats/x/agent/log; blocklist ats/x/agent/block; link tokens
 * ats/x/agent/tok/{sha256}; subject refs ats/x/agent/ref/{REF}; inbox messages read ats/x/agent/inbox/{mid};
 * per candidate ats/{id}.ag (and the copies of their documents under ats/{id}/f with c verify-*).
 */
require_once __DIR__ . '/ats.php';
require_once __DIR__ . '/tailor.php';
require_once __DIR__ . '/rules.php';

const AG_DEFAULT = [
    'on' => false,
    'since' => 0,
    'src' => ['web' => true, 'inbox' => true, 'staff' => true],
    'ask' => ['basics' => true, 'refs' => true, 'quiz' => true, 'docs' => true],
    'qualify' => 70,
    'maybe' => 45,
    'remind' => 24,
    'reminders' => 2,
    'expire' => 5,
    'cap' => 150,
    'move' => true,
    'vendor' => true,
    'notify' => [],
    'keepDocs' => 90,
    'replyTo' => '',
    'tpl' => [
        'ask' => ['s' => '{job}: please confirm a few details (Ref {ref})', 'b' => "Hi {first},\n\nThank you for your interest in the {job} role{where}. Before our team puts your profile forward, please confirm a few details. It takes about 5 to 10 minutes.\n\nThe link is personal to you and works until {expires}.\n\n{sender}\nStratEdge IT Consulting"],
        'remind' => ['s' => 'Reminder: confirm your details for {job} (Ref {ref})', 'b' => "Hi {first},\n\nA quick reminder: we still need a few details from you before we can move forward with the {job} role. It takes about 5 to 10 minutes, and the link works until {expires}.\n\n{sender}\nStratEdge IT Consulting"],
        'vendor' => ['s' => '{name} for {job}: details needed (Ref {ref})', 'b' => "Hi {first},\n\nThank you for submitting {name} for the {job} role. Before we move forward, we need a few details confirmed: work authorization, rate, availability, LinkedIn, two references, a few questions about the role and a copy of the work authorization. You or {name} can complete the secure form below.\n\nThe link works until {expires}.\n\n{sender}\nStratEdge IT Consulting"],
        'notfit' => ['s' => 'Your application for {job}', 'b' => "Hi {first},\n\nThank you for your interest in the {job} role at StratEdge IT Consulting. After reviewing your profile, we will not be moving forward for this position. We keep your profile on file and will reach out when a role fits your experience.\n\nWe wish you the best in your search.\n\n{sender}\nStratEdge IT Consulting"],
    ],
];
const AG_FREEMAIL = ['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com', 'protonmail.com', 'proton.me', 'zoho.com', 'zohomail.com', 'gmx.com', 'gmx.net', 'mail.com', 'rediffmail.com', 'yandex.com', 'qq.com', '163.com', 'hey.com', 'fastmail.com', 'tutanota.com'];
const AG_THROWAWAY = ['mailinator.com', 'guerrillamail.com', 'guerrillamail.info', 'sharklasers.com', 'grr.la', '10minutemail.com', 'temp-mail.org', 'tempmail.com', 'tempmailo.com', 'yopmail.com', 'trashmail.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'mintemail.com', 'throwawaymail.com', 'fakeinbox.com', 'mohmal.com', 'emailondeck.com', 'spamgourmet.com', 'burnermail.io', 'mailnesia.com', 'mytemp.email', 'tempr.email', 'discard.email', 'moakt.com', 'inboxkitten.com', 'temp-mail.io', 'tmpmail.org', 'emailfake.com', 'fakemail.net', 'mail.tm', 'mailpoof.com', 'tempinbox.com'];
// job boards and VMS portals by sender domain (resumes from them are not vendor submissions)
const AG_BOARDS = ['dice.com' => 'Dice', 'linkedin.com' => 'LinkedIn', 'indeed.com' => 'Indeed', 'indeedemail.com' => 'Indeed', 'monster.com' => 'Monster', 'ziprecruiter.com' => 'ZipRecruiter', 'careerbuilder.com' => 'CareerBuilder', 'glassdoor.com' => 'Glassdoor', 'ilabor360.com' => 'iLabor360', 'techfetch.com' => 'TechFetch'];
// the year each tool appeared: "10+ years of Kubernetes" in 2026 cannot be true (generous years, to avoid false alarms)
const AG_TECH_YEAR = ['kubernetes' => 2014, 'k8s' => 2014, 'docker' => 2013, 'react native' => 2015, 'react' => 2013, 'vue' => 2014, 'typescript' => 2012, 'swift' => 2014, 'kotlin' => 2011, 'golang' => 2009, 'rust' => 2010, 'spring boot' => 2014, 'node.js' => 2009, 'nodejs' => 2009, 'terraform' => 2014, 'ansible' => 2012, 'kafka' => 2011, 'snowflake' => 2014, 'databricks' => 2013, 'airflow' => 2015, 'flutter' => 2017, 'next.js' => 2016, 'graphql' => 2015, 'aws lambda' => 2014, 'azure' => 2010, 'gcp' => 2008, 'google cloud' => 2008, 'aws' => 2006, 'power bi' => 2011, 'chatgpt' => 2022, 'generative ai' => 2022, 'genai' => 2022, 'langchain' => 2022, 'llm' => 2019, 'pytorch' => 2016, 'tensorflow' => 2015, '.net core' => 2016, 'dotnet core' => 2016, 'blazor' => 2018, 's/4hana' => 2015, 's4 hana' => 2015, 'mongodb' => 2009, 'elasticsearch' => 2010, 'github actions' => 2019, 'microservices' => 2011, 'devops' => 2009, 'salesforce lightning' => 2015, 'servicenow' => 2004];
const AG_SEV = ['high' => 35, 'medium' => 15, 'low' => 5];
const AG_ST_NAME = ['new' => 'Queued', 'notfit' => 'Not a match: recruiter decides', 'asked' => 'Waiting for the candidate', 'reminded' => 'Reminded', 'answered' => 'Answered: checking', 'verified' => 'Verified', 'review' => 'Needs a recruiter', 'noreply' => 'No reply', 'closed' => 'Closed', 'kept' => 'Kept in the pool', 'fake' => 'Marked fake', 'stopped' => 'Stopped', 'skipped' => 'Not screened'];

/* ---------- settings, log, small helpers ---------- */
function agCfg(): array
{
    $d = docGet('ats/x/agent/cfg');
    $s = $d ? json_decode(json_encode($d), true) : [];
    $c = AG_DEFAULT;
    foreach ($s as $k => $v) {
        if (!array_key_exists($k, AG_DEFAULT)) {
            continue;
        }
        if (is_array(AG_DEFAULT[$k]) && is_array($v) && $k !== 'notify') {
            $c[$k] = array_replace_recursive(AG_DEFAULT[$k], $v);
        } else {
            $c[$k] = $v;
        }
    }
    $c['notify'] = array_values(array_filter(array_map('strval', (array) $c['notify']), fn($x) => (bool) preg_match('/^u_[a-f0-9]+$/', $x)));
    return $c;
}
function agLog(string $cid, string $name, string $ev): void
{
    $d = docGet('ats/x/agent/log') ?? new stdClass();
    $rows = (array) ($d->rows ?? []);
    $rows[] = ['t' => now(), 'cid' => $cid, 'n' => mb_substr($name, 0, 120), 'ev' => mb_substr($ev, 0, 300)];
    $d->rows = array_slice($rows, -400);
    docSet('ats/x/agent/log', $d);
}
/** The candidate's agent record as an array. */
function agOf(stdClass $c): array
{
    return isset($c->ag) ? (json_decode(json_encode($c->ag), true) ?: []) : [];
}
function agSave(string $id, stdClass $c, array $ag): void
{
    $ag['u'] = now();
    $c->ag = $ag;
    $c->u = now();
    docSet('ats/' . $id, $c);
}
function agNorm(string $s): string
{
    return trim(preg_replace('/[^a-z0-9 ]+/', ' ', strtolower($s)) ?? '');
}
function agSameName(string $a, string $b): bool
{
    $ta = array_values(array_filter(explode(' ', agNorm($a)), fn($x) => strlen($x) > 1));
    $tb = array_values(array_filter(explode(' ', agNorm($b)), fn($x) => strlen($x) > 1));
    if (!$ta || !$tb) {
        return true; // nothing to compare: no alarm
    }
    $common = array_intersect($ta, $tb);
    return count($common) >= min(2, min(count($ta), count($tb)));
}
function agDomain(string $email): string
{
    return strtolower(substr(strrchr($email, '@') ?: '', 1));
}
function agPhone(string $p): string
{
    $d = preg_replace('/\D/', '', $p) ?? '';
    return strlen($d) >= 10 ? substr($d, -10) : '';
}
function agLiSlug(string $li): string
{
    return preg_match('~linkedin\.com/in/([A-Za-z0-9_\-%]+)~i', $li, $m) ? strtolower(rtrim($m[1], '/')) : '';
}
/** The canonical work-authorization key ('USC', 'GC', 'H-1B'...) of free text. */
function agAuthKey(string $s): string
{
    $s = trim($s);
    if ($s === '') {
        return '';
    }
    [$listed] = ruleAuthIn($s);
    return $listed[0] ?? '';
}
/** Why a candidate is not a match, in one line: the assistant's summary, missed must-haves, the fit score's gaps. */
function agWhyNot(array $fit): string
{
    $miss = array_map(fn($m) => $m['req'], array_filter((array) ($fit['must'] ?? []), fn($m) => ($m['met'] ?? '') === 'no'));
    $bad = array_filter((array) ($fit['why'] ?? []), fn($w) => (bool) preg_match('/^(Not listed|Only|Different|Visa|The job takes|Failed|No resume)/i', (string) $w));
    return trim(implode(' ', array_filter([(string) ($fit['summary'] ?? ''), $miss ? 'Missing: ' . implode(', ', $miss) . '.' : '', implode('; ', $bad)])));
}
function agFirst(string $n): string
{
    $f = trim(explode(' ', trim($n))[0] ?? '');
    return $f !== '' ? $f : 'there';
}
function agFill(string $t, array $v): string
{
    foreach ($v as $k => $x) {
        $t = str_replace('{' . $k . '}', (string) $x, $t);
    }
    return $t;
}
/** Uids who get the agent's tasks for a candidate: the settings list, else the job's hiring team. */
function agNotifyUids(array $cfg, stdClass $c): array
{
    if ($cfg['notify']) {
        return $cfg['notify'];
    }
    return atsTeam(atsJob((string) ($c->job ?? '')));
}
function agTask(array $cfg, stdClass $c, string $id, string $title, string $detail): void
{
    $uids = agNotifyUids($cfg, $c);
    if ($uids) {
        atsTask($uids, $title, $detail . ' · open it under Recruiting › Screening agent (candidate ' . $id . ')', 'agent');
    }
}
/** One line of the candidate's ATS history and of the agent's activity. */
function agNote(string $id, stdClass $c, string $ev): void
{
    atsLog($c, 'StratEdge AI agent', $ev);
    agLog($id, (string) ($c->n ?? ''), $ev);
}
function agMailOn(): bool
{
    require_once __DIR__ . '/mail.php';
    return mailReady(mailSettings());
}

/* ---------- resume fingerprints and text tests ---------- */
/** A bottom-96 sketch of a text's 6-word shingles: two resumes that share most of their text share most of it. */
function agSketch(string $text, int $k = 96, int $w = 6): array
{
    $words = preg_split('/\s+/', agNorm($text)) ?: [];
    $words = array_values(array_filter($words, fn($x) => $x !== ''));
    $h = [];
    for ($i = 0; $i + $w <= count($words); $i++) {
        $h[crc32(implode(' ', array_slice($words, $i, $w)))] = true;
    }
    $keys = array_keys($h);
    sort($keys);
    return array_slice($keys, 0, $k);
}
function agSketchSim(array $a, array $b): float
{
    if (count($a) < 20 || count($b) < 20) {
        return 0.0;
    }
    $k = min(count($a), count($b));
    $union = array_unique(array_merge($a, $b));
    sort($union);
    $union = array_slice($union, 0, $k);
    $sa = array_flip($a);
    $sb = array_flip($b);
    $both = 0;
    foreach ($union as $x) {
        if (isset($sa[$x], $sb[$x])) {
            $both++;
        }
    }
    return $both / $k;
}
/** How much of the job description's own wording (8-word runs) appears in the resume, 0-1. */
function agJdCopy(string $jd, string $resume): float
{
    $sh = function (string $t): array {
        $w = array_values(array_filter(preg_split('/\s+/', agNorm($t)) ?: [], fn($x) => $x !== ''));
        $o = [];
        for ($i = 0; $i + 8 <= count($w); $i++) {
            $o[implode(' ', array_slice($w, $i, 8))] = true;
        }
        return $o;
    };
    $j = $sh($jd);
    if (count($j) < 30) {
        return 0.0;
    }
    $r = $sh($resume);
    return count(array_intersect_key($j, $r)) / count($j);
}
function agLooksLikeResume(string $t): bool
{
    if (mb_strlen($t) < 500) {
        return false;
    }
    $h = 0;
    foreach (['experience|employment|work history|professional experience', 'education|academic', 'skills|technical skills|technologies|competencies|skill set', 'summary|profile|objective', 'certifications?', 'projects?'] as $rx) {
        if (preg_match('/^\s*(?:' . $rx . ')\b/im', $t)) {
            $h++;
        }
    }
    $dates = preg_match_all('/' . TL_DATE_RX . '/i', $t);
    $contact = preg_match('/[\w.+\-]+@[\w\-]+\.[\w.\-]+/', $t) || preg_match('/\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/', $t);
    return ($h >= 2 && $dates >= 1) || $h >= 3 || ($dates >= 2 && $contact && $h >= 1);
}
/** "Mar 2021" -> a month number; null when unreadable. */
function agMonth(string $s, bool $end): ?int
{
    $s = trim($s);
    if ($s === '') {
        return null;
    }
    if (preg_match('/present|current|now|date|ongoing/i', $s)) {
        return (int) date('Y') * 12 + (int) date('n');
    }
    if (preg_match('/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*[\'’]?(\d{2,4})/i', $s, $m)) {
        $y = (int) $m[2];
        $y = $y < 100 ? $y + 2000 : $y;
        return $y * 12 + (int) array_search(strtolower(substr($m[1], 0, 3)), ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'], true) + 1;
    }
    if (preg_match('/(\d{1,2})\/((?:19|20)\d{2})/', $s, $m)) {
        return (int) $m[2] * 12 + (int) $m[1];
    }
    if (preg_match('/((?:19|20)\d{2})/', $s, $m)) {
        return (int) $m[1] * 12 + ($end ? 12 : 1);
    }
    return null;
}

/* ---------- 1. does the candidate fit the job ---------- */
/** Open careers jobs: [id => stdClass]. */
function agOpenJobs(): array
{
    $out = [];
    foreach (colAll('org/site/jobs') as [$jid, $j]) {
        if (($j->open ?? true) !== false && trim((string) ($j->ti ?? '')) !== '') {
            $out[(string) $jid] = $j;
        }
    }
    return $out;
}
/**
 * The fit: [v 0-100, level qualified|maybe|not, why[], must[], summary, questions[], redflags[], by ai|rules, job].
 * $ai is the assistant's answer for this candidate (null without it).
 */
function agFitOf(string $id, stdClass $c, array $cfg, ?array $ai): array
{
    $pub = atsPublicJob((string) ($c->job ?? ''));
    $m = atsMatch($id, $c, $pub);
    $v = (int) $m['v'];
    $why = $m['why'];
    $by = 'rules';
    $level = $v >= $cfg['qualify'] ? 'qualified' : ($v >= $cfg['maybe'] ? 'maybe' : 'not');
    $must = [];
    $summary = '';
    if ($ai && in_array($ai['level'] ?? '', ['qualified', 'maybe', 'not'], true)) {
        $by = 'ai';
        $level = (string) $ai['level'];
        $av = (int) ($ai['score'] ?? -1);
        if ($av >= 0 && $av <= 100) {
            $v = (int) round(0.65 * $av + 0.35 * $v);
        }
        foreach ((array) ($ai['must'] ?? []) as $x) {
            $x = (array) $x;
            $met = in_array($x['met'] ?? '', ['yes', 'partial', 'no'], true) ? $x['met'] : 'partial';
            $must[] = ['req' => mb_substr(trim((string) ($x['req'] ?? '')), 0, 160), 'met' => $met, 'ev' => mb_substr(trim((string) ($x['evidence'] ?? '')), 0, 220)];
        }
        $must = array_slice(array_values(array_filter($must, fn($x) => $x['req'] !== '')), 0, 8);
        $summary = mb_substr(trim((string) ($ai['summary'] ?? '')), 0, 600);
    }
    // what always counts, whatever the score says
    if (!empty($c->ko)) {
        $level = 'not';
        array_unshift($why, 'Failed a knockout screening question');
    }
    $visa = trim((string) ($pub->visa ?? ''));
    $auth = agAuthKey((string) ($c->auth ?? ''));
    if ($visa !== '' && $auth !== '' && ruleAuthBlocks($visa, $auth)) {
        $level = 'not';
        array_unshift($why, 'The job takes ' . $visa . '; the candidate is ' . $auth);
    }
    return ['v' => max(0, min(100, $v)), 'level' => $level, 'why' => array_values(array_slice($why, 0, 8)), 'must' => $must, 'summary' => $summary, 'by' => $by, 'job' => (string) ($c->job ?? ''), 'at' => now()];
}
/** The assistant's read on one candidate: fit, must-haves, a summary, role questions and red flags (one call). */
function agAiPrompt(stdClass $c, ?stdClass $pub, string $text): array
{
    $sys = 'You screen candidates for a US IT staffing firm. Judge only what the resume shows against the job, fairly and factually; never guess at age, gender, nationality or other protected traits. Answer with one JSON object only.';
    $job = $pub ? ('JOB: ' . (string) ($pub->ti ?? '') . "\nLocation: " . trim((string) ($pub->loc ?? '') . ' ' . (string) ($pub->md ?? '')) . "\nType: " . (string) ($pub->ty ?? '') . "\nWork authorization: " . ((string) ($pub->visa ?? '') ?: 'not stated') . "\nSkills: " . (string) ($pub->sk ?? '') . "\nDescription:\n" . mb_substr((string) ($pub->d ?? ''), 0, 6000)) : 'JOB: none attached (general application): judge the profile on its own and leave "must" empty.';
    $cand = 'CANDIDATE: ' . (string) ($c->n ?? '') . ' · ' . (string) ($c->ti ?? '') . ' · ' . (string) ($c->loc ?? '') . ' · work authorization: ' . ((string) ($c->auth ?? '') ?: 'unknown') . ' · source: ' . (string) ($c->src ?? '');
    $ans = '';
    foreach ((array) ($c->answers ?? []) as $k => $v) {
        $ans .= "\n- $k: " . mb_substr((string) $v, 0, 200);
    }
    $prompt = $job . "\n\n" . $cand . ($ans !== '' ? "\nSCREENING ANSWERS:" . $ans : '') . "\n\nRESUME:\n" . mb_substr($text, 0, 9000) .
        "\n\nReturn {\"level\": \"qualified|maybe|not\", \"score\": 0-100, \"must\": [{\"req\": \"a must-have from the job\", \"met\": \"yes|partial|no\", \"evidence\": \"where the resume shows it, or what is missing\"}], \"summary\": \"two sentences a recruiter can act on\", \"questions\": [{\"q\": \"a question about this job that someone who really did the work on this resume answers well (name their own project or tool)\", \"look\": \"what a real practitioner would mention\"}], \"redflags\": [{\"flag\": \"a sign the profile may be fake, borrowed or embellished\", \"evidence\": \"the exact part of the resume\", \"sev\": \"low|medium|high\"}]}. " .
        "Write 4 questions. Red flags only with evidence: impossible timelines, tools claimed for longer than they existed, a stack that does not fit the employer or the dates, generic bullets copied across jobs, titles or locations that contradict each other, text lifted from the job description; an empty list when there are none.";
    return [$sys, $prompt, 1800];
}
/** Role questions without the assistant: from the job's skills and title. */
function agRuleQuestions(?stdClass $pub, stdClass $c): array
{
    $title = (string) ($pub->ti ?? ($c->ti ?? 'this role'));
    $sk = array_values(array_filter(array_map('trim', preg_split('/[,;|\n]+/', (string) ($pub->sk ?? ($c->sk ?? ''))) ?: [])));
    $a = $sk[0] ?? 'the main technology in your current role';
    $b = $sk[1] ?? ($sk[0] ?? 'your main tools');
    return [
        ['q' => "Describe a recent project where you used $a: what did you build, and what exactly was your part?", 'look' => "A named project, concrete pieces they built with $a, their own decisions."],
        ['q' => "Tell us about a hard problem you debugged with $b. What was wrong and how did you find it?", 'look' => 'Symptoms, the tools they used to dig, the root cause and the fix.'],
        ['q' => "How is your work as a $title tested and released in your current or last job? Walk us through it.", 'look' => 'Their real pipeline: tests, reviews, environments, approvals.'],
        ['q' => 'What would you want to know in your first week to be productive in this role?', 'look' => 'Questions about the codebase, environments, people and priorities.'],
    ];
}

/* ---------- 2. signs of a fake or borrowed profile ---------- */
/** [v 0-100, level low|medium|high, flags[{k, t, sev}]] from what the candidate sent and what we already hold. */
function agRiskOf(string $id, stdClass $c, string $text, array $sketch, array $aiFlags, array $cards): array
{
    $flags = [];
    $add = function (string $k, string $t, string $sev) use (&$flags) {
        foreach ($flags as $f) {
            if ($f['k'] === $k && $f['t'] === $t) {
                return;
            }
        }
        $flags[] = ['k' => $k, 't' => mb_substr($t, 0, 240), 'sev' => $sev];
    };
    $name = (string) ($c->n ?? '');
    $email = strtolower(trim((string) ($c->e ?? '')));
    $phone = agPhone((string) ($c->ph ?? ''));
    $slug = agLiSlug((string) ($c->li ?? ''));
    $dom = agDomain($email);
    // marked fake before
    $blk = docGet('ats/x/agent/block');
    foreach ((array) ($blk->items ?? []) as $b) {
        $v = strtolower((string) ($b->v ?? ''));
        $k = (string) ($b->k ?? '');
        if ($v === '') {
            continue;
        }
        if (($k === 'email' && $v === $email) || ($k === 'phone' && $v === $phone && $phone !== '') || ($k === 'li' && $v === $slug && $slug !== '') || ($k === 'domain' && $v === $dom)) {
            $add('blocked', 'Marked fake before (' . $k . ' ' . $v . ($b->why ?? '' ? ': ' . $b->why : '') . ')', 'high');
        }
    }
    // the same phone, email, LinkedIn or resume under another name
    foreach ($cards as [$oid, $o]) {
        if ((string) $oid === $id || !($o instanceof stdClass)) {
            continue;
        }
        $on = (string) ($o->n ?? '');
        if (agSameName($name, $on)) {
            continue;
        }
        $when = date('M j, Y', (int) (($o->at ?? 0) / 1000));
        if ($email !== '' && strtolower(trim((string) ($o->e ?? ''))) === $email) {
            $add('dupe_email', 'Same email as ' . $on . ' (' . $when . ($o->jt ?? '' ? ', ' . $o->jt : '') . ')', 'high');
        }
        if ($phone !== '' && agPhone((string) ($o->ph ?? '')) === $phone) {
            $add('dupe_phone', 'Same phone as ' . $on . ' (' . $when . ($o->jt ?? '' ? ', ' . $o->jt : '') . ')', 'high');
        }
        if ($slug !== '' && agLiSlug((string) ($o->li ?? '')) === $slug) {
            $add('dupe_li', 'Same LinkedIn profile as ' . $on . ' (' . $when . ')', 'high');
        }
        $ofp = (array) ($o->ag->fp ?? []);
        if ($sketch && $ofp) {
            $sim = agSketchSim($sketch, array_map('intval', $ofp));
            if ($sim >= 0.6) {
                $add('dupe_resume', 'Resume text is ' . (int) round($sim * 100) . '% the same as ' . $on . '\'s (' . $when . ')', 'high');
            }
        }
    }
    // the email address
    if ($dom !== '' && in_array($dom, AG_THROWAWAY, true)) {
        $add('throwaway', 'Throwaway email address (' . $dom . ')', 'high');
    } elseif ($email !== '' && preg_match('/\d{6,}/', strstr($email, '@', true) ?: '')) {
        $add('email_digits', 'Email address looks auto-generated (' . $email . ')', 'low');
    }
    if ($email !== '') {
        try {
            require_once __DIR__ . '/mail.php';
            foreach (mailSuppressed() as $s) {
                $se = is_array($s) ? strtolower((string) ($s['e'] ?? ($s['email'] ?? ''))) : strtolower((string) ($s->e ?? ($s->email ?? '')));
                if ($se === $email) {
                    $add('bounced', 'Email to ' . $email . ' bounced before', 'medium');
                    break;
                }
            }
        } catch (Throwable $e) {
        }
    }
    // the phone number (US numbers only: area code and exchange start 2-9; 555-01xx is fictional)
    $raw = preg_replace('/\D/', '', (string) ($c->ph ?? '')) ?? '';
    if ($raw !== '' && (strlen($raw) === 10 || (strlen($raw) === 11 && $raw[0] === '1'))) {
        $d = substr($raw, -10);
        if ($d[0] < '2' || $d[3] < '2' || preg_match('/^(\d)\1{9}$/', $d) || $d === '1234567890' || preg_match('/^\d{3}55501\d\d$/', $d)) {
            $add('phone', 'Phone number does not look real (' . (string) $c->ph . ')', 'medium');
        }
    }
    if (trim((string) ($c->li ?? '')) !== '' && $slug === '') {
        $add('li_link', 'The LinkedIn link is not a profile link', 'low');
    }
    // the timeline
    if ($text !== '') {
        $r = tailorParse($text);
        $ranges = [];
        foreach ($r['experience'] as $e) {
            $a = agMonth($e['from'], false);
            $b = agMonth($e['to'], true) ?? $a;
            if ($a !== null && $b !== null && $b >= $a) {
                $ranges[] = [$a, $b, trim($e['co'] ?: $e['ti'])];
            }
        }
        $nowM = (int) date('Y') * 12 + (int) date('n');
        foreach ($ranges as [$a, $b, $who]) {
            if ($a > $nowM + 1) {
                $add('future', 'A job starts in the future (' . $who . ')', 'medium');
            }
        }
        $worst = null;
        for ($i = 0; $i < count($ranges); $i++) {
            for ($j = $i + 1; $j < count($ranges); $j++) {
                [$a1, $b1, $w1] = $ranges[$i];
                [$a2, $b2, $w2] = $ranges[$j];
                $ov = min($b1, $b2) - max($a1, $a2) + 1;
                if ($ov > 6 && ($b1 - $a1) >= 9 && ($b2 - $a2) >= 9 && (!$worst || $ov > $worst[0])) {
                    $worst = [$ov, $w1, $w2];
                }
            }
        }
        if ($worst) {
            $add('overlap', 'Two jobs at the same time for ' . $worst[0] . ' months: ' . $worst[1] . ' and ' . $worst[2], 'medium');
        }
        $claimed = resumeYears($text);
        if ($claimed && $ranges) {
            $months = [];
            foreach ($ranges as [$a, $b]) {
                for ($m = $a; $m <= min($b, $nowM); $m++) {
                    $months[$m] = true;
                }
            }
            $dated = count($months) / 12;
            if ($dated > 0 && $claimed - $dated >= 4) {
                $add('years', 'Says ' . $claimed . '+ years; the dated jobs add up to about ' . (int) round($dated), 'medium');
            }
        }
        // "12 years of Kubernetes" when Kubernetes is younger than that
        if (preg_match_all('/(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b(?:\s+of)?(?:\s+(?:hands[- ]on|professional|strong|extensive|solid|deep))?(?:\s+experience)?\s+(?:in|with|on|using|of|working with)?\s*([A-Za-z][A-Za-z0-9.+#\/ \-]{1,28})/i', $text, $mm, PREG_SET_ORDER)) {
            $yearNow = (int) date('Y');
            foreach ($mm as $x) {
                $n = (int) $x[1];
                $what = strtolower(trim($x[2]));
                foreach (AG_TECH_YEAR as $tech => $yr) {
                    if (str_starts_with($what, $tech) && $n > $yearNow - $yr) {
                        $add('techage', 'Claims ' . $n . ' years of ' . ucfirst($tech) . ', which only appeared in ' . $yr, 'high');
                        break;
                    }
                }
            }
        }
        $pub = atsPublicJob((string) ($c->job ?? ''));
        if ($pub) {
            $copy = agJdCopy((string) ($pub->d ?? ''), $text);
            if ($copy >= 0.25) {
                $add('jdcopy', (int) round($copy * 100) . '% of the job description appears word for word in the resume', 'medium');
            }
        }
    }
    // a burst of applications
    if ($email !== '') {
        $n = 0;
        foreach ($cards as [$oid, $o]) {
            if ($o instanceof stdClass && strtolower(trim((string) ($o->e ?? ''))) === $email && (int) ($o->at ?? 0) > now() - 86400000) {
                $n++;
            }
        }
        if ($n >= 5) {
            $add('burst', $n . ' applications from this email in a day', 'low');
        }
    }
    // the same person from two vendors
    if (!empty($c->vend) && $email !== '') {
        $mine = agDomain((string) ($c->vend->e ?? ''));
        foreach ($cards as [$oid, $o]) {
            if ((string) $oid === $id || !($o instanceof stdClass) || empty($o->vend)) {
                continue;
            }
            $theirs = agDomain((string) ($o->vend->e ?? ''));
            if ($theirs !== '' && $theirs !== $mine && (strtolower((string) ($o->e ?? '')) === $email || ($phone !== '' && agPhone((string) ($o->ph ?? '')) === $phone)) && (int) ($o->at ?? 0) > now() - 30 * 86400000) {
                $add('twovendors', 'Also submitted by ' . ((string) ($o->vend->co ?? '') ?: $theirs) . ' on ' . date('M j', (int) (($o->at ?? 0) / 1000)), 'medium');
            }
        }
    }
    foreach ($aiFlags as $f) {
        $f = (array) $f;
        $t = trim((string) ($f['flag'] ?? ''));
        if ($t === '') {
            continue;
        }
        $ev = trim((string) ($f['evidence'] ?? ''));
        $sev = in_array($f['sev'] ?? '', ['low', 'medium'], true) ? (string) $f['sev'] : 'medium'; // the assistant's flags are leads, never "high"
        $add('ai', 'StratEdge AI: ' . $t . ($ev !== '' ? ' (' . mb_substr($ev, 0, 120) . ')' : ''), $sev);
    }
    return agRiskScore($flags);
}
function agRiskScore(array $flags): array
{
    $v = 0;
    foreach ($flags as $f) {
        $v += AG_SEV[$f['sev']] ?? 5;
    }
    $v = min(100, $v);
    usort($flags, fn($a, $b) => (AG_SEV[$b['sev']] ?? 0) <=> (AG_SEV[$a['sev']] ?? 0));
    return ['v' => $v, 'level' => $v >= 35 ? 'high' : ($v >= 15 ? 'medium' : 'low'), 'flags' => array_values(array_slice($flags, 0, 16)), 'at' => now()];
}

/* ---------- 3. the email with the secure link ---------- */
function agToken(): string
{
    return rid(16);
}
function agLink(string $tok): string
{
    return siteUrl() . '#/confirm?t=' . $tok;
}
/** Sends the request (kind ask) or a reminder (kind remind); a new link each time a request goes out. */
function agSend(string $id, stdClass $c, array &$ag, array $cfg, string $kind): bool
{
    require_once __DIR__ . '/mail.php';
    $toVendor = !empty($ag['toVendor']) && !empty($c->vend->e);
    $to = $toVendor ? strtolower((string) $c->vend->e) : strtolower(trim((string) ($c->e ?? '')));
    $toName = $toVendor ? (string) ($c->vend->n ?? '') : (string) ($c->n ?? '');
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
        $ag['err'] = 'No email address to write to';
        return false;
    }
    if (!agMailOn()) {
        $ag['err'] = 'Email is not set up (Admin › Email)';
        return false;
    }
    if (throttleHit('agmail:' . date('Ymd'), max(1, (int) $cfg['cap']), 86400)) {
        $ag['err'] = 'The daily limit of ' . (int) $cfg['cap'] . ' agent emails is reached; it carries on tomorrow';
        return false;
    }
    if ($kind === 'ask' || empty($ag['tok'])) {
        $tok = agToken();
        if (!empty($ag['tokH'])) {
            docDelete('ats/x/agent/tok/' . $ag['tokH']);
        }
        $ag['tokH'] = hash('sha256', $tok);
        $ag['tok'] = mailSeal($tok);
        $ag['exp'] = now() + max(1, (int) $cfg['expire']) * 86400000;
        $ag['used'] = false;
        docSet('ats/x/agent/tok/' . $ag['tokH'], (object) ['cid' => $id, 'exp' => $ag['exp']]);
    } else {
        $tok = mailUnseal((string) $ag['tok']);
    }
    if (empty($ag['ref'])) {
        $ag['ref'] = strtoupper(substr(rid(4), 0, 6));
        docSet('ats/x/agent/ref/' . $ag['ref'], (object) ['cid' => $id]);
    }
    $pub = atsPublicJob((string) ($c->job ?? ''));
    $jt = (string) (($pub->ti ?? '') ?: ($c->jt ?? '') ?: 'the open');
    $tplKey = $kind === 'remind' ? 'remind' : ($toVendor ? 'vendor' : 'ask');
    $tpl = (array) ($cfg['tpl'][$tplKey] ?? AG_DEFAULT['tpl'][$tplKey]);
    $team = atsTeam(atsJob((string) ($c->job ?? '')));
    $sender = 'The recruiting team';
    if ($team) {
        $su = userById($team[0]);
        if ($su && trim((string) $su['name']) !== '') {
            $sender = (string) $su['name'];
        }
    }
    $vars = [
        'first' => agFirst($toName),
        'name' => (string) ($c->n ?? ''),
        'job' => $jt,
        'where' => trim((string) ($pub->loc ?? '')) !== '' ? ' in ' . trim((string) $pub->loc) : '',
        'expires' => date('l, F j', (int) ($ag['exp'] / 1000)),
        'ref' => $ag['ref'],
        'sender' => $sender,
        'link' => agLink($tok),
    ];
    $subject = mb_substr(agFill((string) ($tpl['s'] ?? ''), $vars), 0, 200);
    $body = agFill((string) ($tpl['b'] ?? ''), $vars);
    $link = agLink($tok);
    $paras = preg_split('/\n{2,}/', trim($body)) ?: [$body];
    $text = $body . "\n\nConfirm your details: " . $link . "\n";
    $html = emailHtml($subject, $paras, ['Confirm my details', $link], 'You get this email because of an application to StratEdge IT Consulting. Questions? Reply to this email.');
    $settings = mailSettings();
    $reply = trim((string) $cfg['replyTo']) !== '' ? trim((string) $cfg['replyTo']) : (string) $settings['from'];
    $ok = mailDeliver(['to' => $to, 'name' => $toName, 'subject' => $subject, 'text' => $text, 'html' => $html, 'reply' => $reply, 'kind' => 'agent']);
    if (!$ok) {
        $ag['err'] = 'The email did not go out: ' . ((string) ($GLOBALS['mailErr'] ?? '') ?: 'check Admin › Email');
        return false;
    }
    unset($ag['err']);
    $ag['last'] = now();
    if ($kind === 'ask') {
        $ag['sent'] = now();
        $ag['rem'] = 0;
        $ag['st'] = 'asked';
    } else {
        $ag['rem'] = (int) ($ag['rem'] ?? 0) + 1;
        $ag['st'] = 'reminded';
    }
    $ag['to'] = $to;
    return true;
}

/* ---------- the pipeline ---------- */
/** Which door a candidate came in by: web (applied on the site or in a portal), inbox (emailed) or staff (added). */
function agVia(stdClass $c): string
{
    $v = (string) ($c->via ?? '');
    if (in_array($v, ['web', 'inbox'], true)) {
        return $v;
    }
    return in_array((string) ($c->src ?? ''), ['Website', 'Referral', 'Consultant portal'], true) ? 'web' : 'staff';
}
/** All candidate records [[id, stdClass]] (the x settings folder left out). */
function agCards(): array
{
    return array_values(array_filter(colAll('ats'), fn($r) => $r[0] !== 'x' && $r[1] instanceof stdClass && isset($r[1]->n)));
}
/**
 * Screens a batch of queued candidates: the assistant reads them in parallel, then each gets its fit and risk and,
 * by the settings, the request email or a recruiter decision. Returns how many were screened.
 */
function agScreenBatch(array $ids, array $cfg, bool $force = false): int
{
    $cards = agCards();
    $byId = [];
    foreach ($cards as [$cid, $cd]) {
        $byId[(string) $cid] = $cd;
    }
    $todo = [];
    foreach ($ids as $id) {
        $c = $byId[$id] ?? docGet('ats/' . $id);
        if ($c instanceof stdClass) {
            $todo[$id] = [$c, vmsResumeText('ats/' . $id)];
        }
    }
    if (!$todo) {
        return 0;
    }
    $useAi = aiReady('agent');
    $calls = [];
    $order = [];
    foreach ($todo as $id => [$c, $text]) {
        // a candidate without a job: the best open job is used when it fits well (inbox resumes join it)
        if ((string) ($c->job ?? '') === '') {
            $best = null;
            foreach (agOpenJobs() as $jid => $pj) {
                $m = atsMatch((string) $id, $c, $pj);
                if (!$best || $m['v'] > $best[1]) {
                    $best = [(string) $jid, (int) $m['v'], (string) ($pj->ti ?? '')];
                }
            }
            if ($best && $best[1] >= $cfg['maybe']) {
                $ag = agOf($c);
                $ag['best'] = ['job' => $best[0], 'jt' => $best[2], 'v' => $best[1]];
                if (agVia($c) === 'inbox' && $best[1] >= $cfg['qualify']) {
                    $c->job = $best[0];
                    $c->jt = $best[2];
                    $c->pool = false;
                    atsLog($c, 'StratEdge AI agent', 'Matched to ' . $best[2] . ' (fit ' . $best[1] . ')');
                }
                $c->ag = $ag;
                $todo[$id][0] = $c;
            }
        }
        if ($useAi) {
            $calls[] = agAiPrompt($c, atsPublicJob((string) ($c->job ?? '')), $text);
            $order[] = $id;
        }
    }
    $answers = $calls ? aiJsonMulti($calls, 90, 4) : [];
    $aiBy = [];
    foreach ($order as $i => $id) {
        $aiBy[$id] = $answers[$i] ?? null;
    }
    $n = 0;
    foreach ($todo as $id => [$c, $text]) {
        $ai = $aiBy[$id] ?? null;
        $ag = agOf($c);
        $ag['fit'] = agFitOf((string) $id, $c, $cfg, $ai);
        $sketch = $text !== '' ? agSketch($text) : [];
        $ag['fp'] = $sketch;
        $ag['risk'] = agRiskOf((string) $id, $c, $text, $sketch, (array) ($ai['redflags'] ?? []), $cards);
        $qs = [];
        foreach ((array) ($ai['questions'] ?? []) as $q) {
            $q = (array) $q;
            $qq = mb_substr(trim((string) ($q['q'] ?? '')), 0, 300);
            if ($qq !== '') {
                $qs[] = ['q' => $qq, 'look' => mb_substr(trim((string) ($q['look'] ?? '')), 0, 240)];
            }
        }
        $ag['qs'] = $qs ? array_slice($qs, 0, 5) : agRuleQuestions(atsPublicJob((string) ($c->job ?? '')), $c);
        $ag['screened'] = now();
        $ag['by'] = $ai ? 'ai' : 'rules';
        $fit = $ag['fit'];
        $risk = $ag['risk'];
        $name = (string) ($c->n ?? 'Candidate');
        $jt = (string) (($c->jt ?? '') ?: (($ag['best']['jt'] ?? '') ?: 'the talent pool'));
        agNote((string) $id, $c, 'Screened: ' . ($fit['level'] === 'qualified' ? 'qualified' : ($fit['level'] === 'maybe' ? 'possible match' : 'not a match')) . ' (fit ' . $fit['v'] . '), risk ' . $risk['level'] . ($risk['flags'] ? ' (' . $risk['flags'][0]['t'] . ')' : ''));
        $blocked = (bool) array_filter($risk['flags'], fn($f) => $f['k'] === 'blocked');
        // vendor submissions: the request goes to the vendor who sent the resume (settings)
        $ag['toVendor'] = $cfg['vendor'] && !empty($c->vend->e) && (trim((string) ($c->e ?? '')) === '' || agDomain((string) $c->vend->e) !== agDomain((string) ($c->e ?? '')));
        if ($fit['level'] === 'not') {
            $ag['st'] = 'notfit';
            agTask($cfg, $c, (string) $id, 'Decide: ' . $name . ' does not look like a match for ' . $jt, agWhyNot($fit) ?: implode('; ', array_slice($fit['why'], 0, 3)));
        } elseif ($blocked) {
            $ag['st'] = 'review';
            agNote((string) $id, $c, 'Not emailed: this person was marked fake before');
            agTask($cfg, $c, (string) $id, 'Check ' . $name . ': marked fake before', $risk['flags'][0]['t']);
        } else {
            if (agSend((string) $id, $c, $ag, $cfg, 'ask')) {
                agNote((string) $id, $c, 'Emailed ' . ($ag['toVendor'] ? 'the vendor (' . $ag['to'] . ')' : $ag['to']) . ' a secure link to confirm the details (Ref ' . $ag['ref'] . ')');
            } else {
                $ag['st'] = 'review';
                agNote((string) $id, $c, 'Could not email: ' . ($ag['err'] ?? 'unknown reason'));
            }
            if ($risk['level'] === 'high') {
                agTask($cfg, $c, (string) $id, 'Check ' . $name . ': possible fake profile', implode('; ', array_map(fn($f) => $f['t'], array_slice($risk['flags'], 0, 3))));
            }
        }
        agSave((string) $id, $c, $ag);
        // the next candidates in this batch compare against this one too
        $fresh = docGet('ats/' . $id);
        foreach ($cards as $k => [$cid2]) {
            if ((string) $cid2 === (string) $id && $fresh) {
                $cards[$k][1] = $fresh;
            }
        }
        $n++;
    }
    return $n;
}
/** Reads what the candidate sent back, checks it and files them: verified, needs a recruiter or not a match. */
function agEvaluate(string $id, stdClass $c, array $cfg, bool $withAi = true): void
{
    $ag = agOf($c);
    $ans = (array) ($ag['ans'] ?? []);
    $text = vmsResumeText('ats/' . $id);
    $res = $text !== '' ? tailorParse($text) : tailorEmpty();
    $flags = array_values(array_filter((array) ($ag['risk']['flags'] ?? []), fn($f) => !str_starts_with((string) ($f['k'] ?? ''), 'ans_')));
    $add = function (string $k, string $t, string $sev) use (&$flags) {
        $flags[] = ['k' => 'ans_' . $k, 't' => mb_substr($t, 0, 240), 'sev' => $sev];
    };
    $cards = agCards();
    // their answers against the resume
    $ph = agPhone((string) ($ans['ph'] ?? ''));
    $rph = agPhone($res['phone'] ?: (string) ($c->ph ?? ''));
    if ($ph !== '' && $rph !== '' && $ph !== $rph) {
        $add('phone', 'Phone given (' . $ans['ph'] . ') differs from the resume\'s', 'low');
    }
    $st = fn(string $l) => preg_match('/,\s*([A-Z]{2})\b/', $l, $m) ? $m[1] : '';
    $ls = $st((string) ($ans['loc'] ?? ''));
    $rs = $st($res['loc'] ?: (string) ($c->loc ?? ''));
    if ($ls !== '' && $rs !== '' && $ls !== $rs) {
        $add('loc', 'Lives in ' . $ans['loc'] . '; the resume says ' . ($res['loc'] ?: $c->loc), 'low');
    }
    $aa = agAuthKey((string) ($ans['auth'] ?? ''));
    $ra = agAuthKey($res['auth'] ?: (string) ($c->auth ?? ''));
    if ($aa !== '' && $ra !== '' && $aa !== $ra && !($aa === 'GC' && $ra === 'GC-EAD') && !($aa === 'STEM OPT' && $ra === 'OPT')) {
        $add('auth', 'Work authorization given (' . $aa . ') differs from the resume (' . $ra . ')', 'medium');
    }
    if (!empty($ans['authUntil']) && strtotime((string) $ans['authUntil']) && strtotime((string) $ans['authUntil']) < time() + 60 * 86400) {
        $add('authexp', 'Work authorization ends ' . $ans['authUntil'], 'medium');
    }
    // LinkedIn and references
    $slug = agLiSlug((string) ($ans['li'] ?? ''));
    if (!empty($cfg['ask']['refs'])) {
        if ($slug === '') {
            $add('li', 'No LinkedIn profile given', 'low');
        }
        $refs = array_values(array_filter((array) ($ans['refs'] ?? []), fn($r) => trim((string) ($r['n'] ?? '')) !== ''));
        if (count($refs) < 2) {
            $add('refs', 'Fewer than two references', 'medium');
        }
        $myE = strtolower(trim((string) ($c->e ?? '')));
        $myP = agPhone((string) ($ans['ph'] ?? '') ?: (string) ($c->ph ?? ''));
        foreach ($refs as $r) {
            $re = strtolower(trim((string) ($r['e'] ?? '')));
            $rp = agPhone((string) ($r['ph'] ?? ''));
            $rn = (string) ($r['n'] ?? 'a reference');
            if (($re !== '' && $re === $myE) || ($rp !== '' && $rp === $myP)) {
                $add('refself', 'Reference ' . $rn . ' uses the candidate\'s own email or phone', 'high');
            }
            if ($re !== '' && in_array(agDomain($re), AG_FREEMAIL, true)) {
                $add('reffree', 'Reference ' . $rn . ' gave a personal email (' . agDomain($re) . '), not a work one', 'low');
            }
            if ($re !== '' && in_array(agDomain($re), AG_THROWAWAY, true)) {
                $add('refthrow', 'Reference ' . $rn . ' uses a throwaway email', 'high');
            }
            // the same reference for other candidates: a classic sign of a profile factory
            $others = [];
            foreach ($cards as [$oid, $o]) {
                if ((string) $oid === $id || empty($o->ag->ans->refs)) {
                    continue;
                }
                foreach ((array) $o->ag->ans->refs as $or) {
                    $oe = strtolower(trim((string) ($or->e ?? '')));
                    $op = agPhone((string) ($or->ph ?? ''));
                    if (($re !== '' && $oe === $re) || ($rp !== '' && $op === $rp)) {
                        $others[(string) ($o->n ?? '')] = true;
                    }
                }
            }
            $others = array_keys(array_filter($others, fn($v, $k) => !agSameName($k, (string) ($c->n ?? '')), ARRAY_FILTER_USE_BOTH));
            if ($others) {
                $add('refshared', 'Reference ' . $rn . ' was also given by ' . implode(', ', array_slice($others, 0, 3)), 'high');
            }
        }
        if ($slug !== '') {
            foreach ($cards as [$oid, $o]) {
                if ((string) $oid !== $id && !agSameName((string) ($c->n ?? ''), (string) ($o->n ?? '')) && (agLiSlug((string) ($o->li ?? '')) === $slug || agLiSlug((string) ($o->ag->ans->li ?? '')) === $slug)) {
                    $add('lishared', 'LinkedIn profile also given by ' . (string) $o->n, 'high');
                    break;
                }
            }
        }
    }
    // role questions not answered (a reply by email instead of the form)
    if (!empty($cfg['ask']['quiz']) && empty($ag['qa'])) {
        $add('noquiz', 'The role questions are not answered yet (replied by email)', 'medium');
    }
    // documents
    if (!empty($cfg['ask']['docs']) && empty($ag['docs'])) {
        $add('nodocs', 'No work authorization or ID document', 'medium');
    }
    // the role questions
    $qa = (array) ($ag['qa'] ?? []);
    if (!empty($cfg['ask']['quiz']) && $qa) {
        $scores = [];
        $aiOut = null;
        if ($withAi && aiReady('agent')) {
            $lines = [];
            foreach ($qa as $i => $x) {
                $lines[] = '#' . ($i + 1) . ' QUESTION: ' . (string) ($x['q'] ?? '') . "\nWHAT A PRACTITIONER WOULD MENTION: " . (string) ($x['look'] ?? '') . "\nANSWER: " . mb_substr((string) ($x['a'] ?? ''), 0, 2500);
            }
            $aiOut = aiJson(
                'You check a candidate\'s written answers for a US IT staffing firm. Score each answer 0-5 for hands-on evidence: specific tools, steps, decisions and trade-offs from their own work score high; generic textbook text, buzzwords or text that reads machine-written score low. Be fair to non-native English. Answer with one JSON object only.',
                "JOB: " . (string) ($c->jt ?? '') . "\n\nRESUME (for consistency):\n" . mb_substr($text, 0, 5000) . "\n\n" . implode("\n\n", $lines) . "\n\nReturn {\"answers\": [{\"i\": 1, \"score\": 0-5, \"note\": \"one line\"}], \"consistency\": [{\"issue\": \"an answer that contradicts the resume\", \"sev\": \"low|medium\"}]}",
                1200
            );
        }
        foreach ($qa as $i => &$x) {
            $s = null;
            foreach ((array) ($aiOut['answers'] ?? []) as $r) {
                $r = (array) $r;
                if ((int) ($r['i'] ?? 0) === $i + 1) {
                    $s = max(0, min(5, (int) ($r['score'] ?? 0)));
                    $x['note'] = mb_substr(trim((string) ($r['note'] ?? '')), 0, 200);
                }
            }
            if ($s === null) {
                // without the assistant: length and the job's own words
                $w = str_word_count((string) ($x['a'] ?? ''));
                $s = $w >= 60 ? 3 : ($w >= 25 ? 2 : ($w >= 8 ? 1 : 0));
                $x['note'] = $w . ' words';
            }
            $x['s'] = $s;
            $scores[] = $s;
        }
        unset($x);
        $ag['qa'] = $qa;
        $avg = $scores ? array_sum($scores) / count($scores) : 0;
        $ag['quiz'] = round($avg, 1);
        if ($avg < 2) {
            $add('quiz', 'Weak answers to the role questions (' . round($avg, 1) . ' of 5)', 'medium');
        }
        foreach ((array) ($aiOut['consistency'] ?? []) as $ci) {
            $ci = (array) $ci;
            if (trim((string) ($ci['issue'] ?? '')) !== '') {
                $add('consist', 'StratEdge AI: ' . trim((string) $ci['issue']), ($ci['sev'] ?? '') === 'low' ? 'low' : 'medium');
            }
        }
        if (!empty($ag['secs']) && (int) $ag['secs'] < 120) {
            $add('fast', 'The whole form took ' . (int) $ag['secs'] . ' seconds', 'medium');
        }
    }
    $ag['risk'] = agRiskScore($flags);
    $ag['evAt'] = now();
    $ag['evAi'] = $withAi && aiReady('agent');
    // the answers fill gaps on the candidate's record
    foreach (['ph' => 'ph', 'loc' => 'loc', 'li' => 'li', 'rate' => 'rate'] as $from => $to) {
        if (trim((string) ($ans[$from] ?? '')) !== '' && trim((string) ($c->$to ?? '')) === '') {
            $c->$to = mb_substr((string) $ans[$from], 0, 300);
        }
    }
    if ($aa !== '' && trim((string) ($c->auth ?? '')) === '') {
        $c->auth = (string) ($ans['auth'] ?? '');
    }
    $name = (string) ($c->n ?? 'Candidate');
    $jt = (string) ($c->jt ?? 'the job');
    // the job's work-authorization rule with what they told us
    $pub = atsPublicJob((string) ($c->job ?? ''));
    if ($pub && $aa !== '' && trim((string) ($pub->visa ?? '')) !== '' && ruleAuthBlocks((string) $pub->visa, $aa)) {
        $ag['st'] = 'notfit';
        $ag['fit']['level'] = 'not';
        array_unshift($ag['fit']['why'], 'The job takes ' . $pub->visa . '; the candidate says ' . $aa);
        agNote($id, $c, 'Answered: work authorization (' . $aa . ') does not fit the job (' . $pub->visa . '); a recruiter decides');
        agTask($cfg, $c, $id, 'Decide: ' . $name . ' (' . $aa . ') for ' . $jt, 'The job takes ' . $pub->visa);
    } elseif ($ag['risk']['level'] === 'high' || (($ag['quiz'] ?? 5) < 2 && !empty($cfg['ask']['quiz']))) {
        $ag['st'] = 'review';
        agNote($id, $c, 'Answered; needs a recruiter: ' . implode('; ', array_map(fn($f) => $f['t'], array_slice($ag['risk']['flags'], 0, 3))));
        agTask($cfg, $c, $id, 'Check ' . $name . ' for ' . $jt . ' before submitting', implode('; ', array_map(fn($f) => $f['t'], array_slice($ag['risk']['flags'], 0, 3))));
    } else {
        $ag['st'] = 'verified';
        $msg = 'Verified: details confirmed' . (isset($ag['quiz']) ? ', role answers ' . $ag['quiz'] . ' of 5' : '') . ', risk ' . $ag['risk']['level'];
        // qualified and verified: on to the job's screening stage (when it is still new)
        if ($cfg['move'] && ($ag['fit']['level'] ?? '') === 'qualified' && (string) ($c->job ?? '') !== '') {
            $job = atsJob((string) $c->job);
            if (atsStageKind($job, (string) ($c->st ?? 'new')) === 'new') {
                foreach ($job['stages'] as $sg) {
                    if ($sg['kind'] === 'screen') {
                        $c->st = $sg['k'];
                        $c->stAt = now();
                        $hist = (array) ($c->hist ?? []);
                        $hist[] = (object) ['from' => 'new', 'to' => $sg['k'], 'at' => now(), 'by' => 'agent'];
                        $c->hist = $hist;
                        $msg .= '; moved to ' . $sg['n'];
                        break;
                    }
                }
            }
        }
        agNote($id, $c, $msg);
        agTask($cfg, $c, $id, 'Verified: ' . $name . ' for ' . $jt . ' is ready for you', 'Fit ' . (int) ($ag['fit']['v'] ?? 0) . ', role answers ' . ($ag['quiz'] ?? '-') . ' of 5');
    }
    agSave($id, $c, $ag);
}

/* ---------- the sweep (cron, "Run now", and right after a new candidate arrives) ---------- */
/** One pass: queue new candidates, screen them, remind, expire, read inbox messages, delete old documents. */
function agSweep(int $budget = 25, int $max = 10): array
{
    $cfg = agCfg();
    $out = ['on' => (bool) $cfg['on'], 'queued' => 0, 'screened' => 0, 'reminded' => 0, 'expired' => 0, 'evaluated' => 0, 'inbox' => 0, 'docs' => 0];
    if (!$cfg['on']) {
        return $out;
    }
    $lockF = storeDir() . '/agent.lock';
    $lock = @fopen($lockF, 'c');
    if ($lock && !flock($lock, LOCK_EX | LOCK_NB)) {
        $out['busy'] = true;
        return $out;
    }
    $t0 = time();
    try {
        // emailed resumes first, so they are screened in this same pass
        $out['inbox'] = agInboxSweep($cfg, 20);
        $new = [];
        foreach (agCards() as [$id, $c]) {
            $id = (string) $id;
            if (!isset($c->ag)) {
                if ((int) ($c->at ?? 0) < (int) $cfg['since'] || empty($cfg['src'][agVia($c)])) {
                    continue;
                }
                // v36.2: people saved into the talent pool by a search never applied: the agent leaves them alone
                // until someone puts them on a job
                if (!empty($c->lite) || (!empty($c->tsd) && (string) ($c->job ?? '') === '')) {
                    continue;
                }
                $job = atsJob((string) ($c->job ?? ''));
                if (atsStageKind($job, (string) ($c->st ?? 'new')) !== 'new') {
                    continue; // already moving through the pipeline
                }
                $c->ag = ['st' => 'new', 'at' => now()];
                docSet('ats/' . $id, $c);
                $out['queued']++;
            }
            $ag = agOf($c);
            $st = (string) ($ag['st'] ?? '');
            if ($st === 'new') {
                $new[] = $id;
            } elseif (in_array($st, ['asked', 'reminded'], true)) {
                if ((int) ($ag['exp'] ?? 0) > 0 && (int) $ag['exp'] < now()) {
                    $ag['st'] = 'noreply';
                    agNote($id, $c, 'No reply before the link ran out');
                    agSave($id, $c, $ag);
                    $out['expired']++;
                } elseif ((int) ($ag['rem'] ?? 0) < (int) $cfg['reminders'] && (int) ($ag['last'] ?? 0) + (int) $cfg['remind'] * 3600000 <= now() && time() - $t0 < $budget) {
                    if (agSend($id, $c, $ag, $cfg, 'remind')) {
                        agNote($id, $c, 'Reminder ' . $ag['rem'] . ' sent to ' . $ag['to']);
                        $out['reminded']++;
                    }
                    agSave($id, $c, $ag);
                }
            } elseif ($st === 'answered' && empty($ag['evAt']) && time() - $t0 < $budget) {
                agEvaluate($id, $c, $cfg);
                $out['evaluated']++;
            }
            // copies of ID and work-authorization documents are kept for the settings' number of days
            if (!empty($ag['docs']) && (int) ($ag['docsAt'] ?? 0) > 0 && (int) $ag['docsAt'] < now() - max(7, (int) $cfg['keepDocs']) * 86400000) {
                foreach ((array) $ag['docs'] as $d) {
                    $fid = (string) ($d['id'] ?? '');
                    if (preg_match('/^[a-f0-9]{32}$/', $fid)) {
                        docDelete("ats/$id/f/$fid");
                        @unlink(cfg('files_dir') . '/' . $fid);
                    }
                }
                $ag['docs'] = [];
                $ag['docsGone'] = now();
                agNote($id, $c, 'Verification documents deleted after ' . (int) $cfg['keepDocs'] . ' days');
                agSave($id, $c, $ag);
                $out['docs']++;
            }
        }
        foreach (array_chunk(array_slice($new, 0, $max), 4) as $chunk) {
            if (time() - $t0 >= $budget) {
                break;
            }
            $out['screened'] += agScreenBatch($chunk, $cfg);
        }
        $out['left'] = max(0, count($new) - $out['screened']);
    } finally {
        if ($lock) {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }
    $d = docGet('ats/x/agent/log') ?? new stdClass();
    $d->ran = now();
    docSet('ats/x/agent/log', $d);
    return $out;
}
/** After the response is on its way (LiteSpeed / PHP-FPM), the agent looks at the new candidate or message. */
function agSoon(): void
{
    static $done = false;
    if ($done || !agCfg()['on']) {
        return;
    }
    $done = true;
    register_shutdown_function(function () {
        if (function_exists('litespeed_finish_request')) {
            @litespeed_finish_request();
        } elseif (function_exists('fastcgi_finish_request')) {
            @fastcgi_finish_request();
        } else {
            return; // the next cron run or "Run now" picks it up; nobody waits on it here
        }
        @set_time_limit(120);
        try {
            agSweep(60, 4);
        } catch (Throwable $e) {
            @error_log(date('c') . ' agent: ' . $e->getMessage() . "\n", 3, storeDir() . '/error.log');
        }
    });
}

/* ---------- 4. the company inbox: resumes and replies ---------- */
function agInboxSweep(array $cfg, int $max): int
{
    if (empty($cfg['src']['inbox'])) {
        return 0;
    }
    require_once __DIR__ . '/mail.php';
    $st = mdb()->prepare("SELECT id, at, from_email, from_name, subject, text, atts FROM mail_inbox WHERE at >= ? AND folder = 'inbox' ORDER BY at ASC LIMIT 200");
    $st->execute([(int) $cfg['since']]);
    $n = 0;
    foreach ($st->fetchAll() as $row) {
        if ($n >= $max) {
            break;
        }
        if (docGet('ats/x/agent/inbox/' . $row['id'])) {
            continue;
        }
        $res = agInboxOne($row, $cfg);
        docSet('ats/x/agent/inbox/' . $row['id'], (object) ($res + ['at' => now()]));
        $n++;
    }
    return $n;
}
/** One inbox message: a reply to the agent, resumes (one candidate per resume), or nothing for the agent. */
function agInboxOne(array $row, array $cfg): array
{
    $from = strtolower(trim((string) $row['from_email']));
    $subject = (string) $row['subject'];
    $body = (string) $row['text'];
    $atts = json_decode((string) $row['atts'], true) ?: [];
    // a reply: the Ref in the subject, or a candidate (or vendor) we are waiting on
    $cid = '';
    if (preg_match('/\(Ref ([A-Z0-9]{6})\)/', $subject, $m)) {
        $ref = docGet('ats/x/agent/ref/' . $m[1]);
        $cid = (string) ($ref->cid ?? '');
    }
    if ($cid === '') {
        foreach (agCards() as [$id, $c]) {
            $st = (string) ($c->ag->st ?? '');
            if (in_array($st, ['asked', 'reminded', 'noreply'], true) && ($from === strtolower((string) ($c->e ?? '')) || $from === strtolower((string) ($c->vend->e ?? ''))) && (int) ($c->ag->sent ?? 0) > now() - 21 * 86400000) {
                $cid = (string) $id;
                break;
            }
        }
    }
    if ($cid !== '') {
        $c = docGet('ats/' . $cid);
        if ($c) {
            agReply($cid, $c, $row, $atts, $cfg);
            return ['kind' => 'reply', 'cids' => [$cid], 'n' => (string) ($c->n ?? '')];
        }
    }
    // resumes: each attachment that reads like one, else the body when it is a pasted resume
    $found = [];
    foreach ($atts as $a) {
        $ext = strtolower(pathinfo((string) ($a['n'] ?? ''), PATHINFO_EXTENSION));
        $fid = (string) ($a['id'] ?? '');
        if (!in_array($ext, ['pdf', 'docx', 'txt'], true) || !preg_match('/^[a-f0-9]{32}$/', $fid)) {
            continue;
        }
        $path = fileLocal($fid, $ext);
        if ($path === null) {
            continue;
        }
        $t = cleanText(textFromFile($path, $ext), 60000);
        if (agLooksLikeResume($t)) {
            $found[] = ['text' => $t, 'fid' => $fid, 'n' => (string) $a['n']];
        }
    }
    if (!$found && agLooksLikeResume($body) && mb_strlen($body) >= 1200) {
        $found[] = ['text' => $body, 'fid' => '', 'n' => ''];
    }
    if (!$found) {
        return ['kind' => 'none'];
    }
    $dom = agDomain($from);
    $board = '';
    foreach (AG_BOARDS as $d => $nm) {
        if ($dom === $d || str_ends_with($dom, '.' . $d)) {
            $board = $nm;
        }
    }
    if ($board === '' && preg_match('/\b(dice|linkedin|indeed|monster|ziprecruiter)\b/i', $subject, $bm)) {
        $board = ['dice' => 'Dice', 'linkedin' => 'LinkedIn', 'indeed' => 'Indeed', 'monster' => 'Monster', 'ziprecruiter' => 'ZipRecruiter'][strtolower($bm[1])];
    }
    // which open job the email is about: its title in the subject (or the body's first lines)
    $jobs = agOpenJobs();
    $jid = '';
    $hay = agNorm($subject . ' ' . mb_substr($body, 0, 600));
    $bestLen = 0;
    foreach ($jobs as $id => $j) {
        $t = agNorm((string) $j->ti);
        if ($t !== '' && str_contains($hay, $t) && strlen($t) > $bestLen) {
            $jid = (string) $id;
            $bestLen = strlen($t);
        }
    }
    $sys = ['id' => 'agent', 'name' => 'StratEdge AI agent', 'email' => ''];
    $cids = [];
    $names = [];
    foreach (array_slice($found, 0, 8) as $f) {
        $fields = atsFieldsFromText($f['text']);
        $email = strtolower(trim((string) ($fields['e'] ?? '')));
        $vendor = $board === '' && $dom !== '' && !in_array($dom, AG_FREEMAIL, true) && ($email === '' || agDomain($email) !== $dom);
        if ($email === '' && !$vendor && $board === '') {
            $fields['e'] = $from; // the person sent their own resume
        }
        if (trim((string) ($fields['n'] ?? '')) === '') {
            $fields['n'] = $vendor || $board !== '' ? 'Candidate from ' . ($board ?: $dom) : ((string) $row['from_name'] ?: $from);
        }
        // the same person already applied to this job: noted there instead of a second record
        $dupe = '';
        foreach (agCards() as [$oid, $o]) {
            if (strtolower((string) ($o->e ?? '')) !== '' && strtolower((string) ($o->e ?? '')) === strtolower((string) $fields['e']) && (string) ($o->job ?? '') === $jid) {
                $dupe = (string) $oid;
            }
        }
        if ($dupe !== '') {
            $o = docGet('ats/' . $dupe);
            atsLog($o, 'StratEdge AI agent', 'Sent again by email from ' . $from . ' (' . $subject . ')');
            docSet('ats/' . $dupe, $o);
            $cids[] = $dupe;
            $names[] = (string) ($o->n ?? '');
            continue;
        }
        $src = $board !== '' ? $board : ($vendor ? 'Agency / vendor' : 'Email');
        $extra = ['via' => 'inbox', 'mid' => (string) $row['id']];
        if ($vendor) {
            $extra['vend'] = ['e' => $from, 'n' => (string) $row['from_name'], 'co' => ucfirst(explode('.', $dom)[0] ?? $dom)];
        }
        $id = atsNewCandidate($sys, $fields, $src, $jid, 'Emailed in' . ($vendor ? ' by ' . ((string) $row['from_name'] ?: $from) : ($board !== '' ? ' from ' . $board : '')) . ': ' . mb_substr($subject, 0, 120), $extra);
        if ($f['fid'] !== '') {
            $new = atsCopyResume($id, $f['fid'], $f['n']);
            if ($new) {
                $c = docGet('ats/' . $id);
                $c->rid = $new;
                $c->rn = $f['n'];
                docSet('ats/' . $id, $c);
            }
        } else {
            // the pasted resume becomes a text file on the record, so the fit score and the agent can read it
            $dir = cfg('files_dir');
            $fid = rid(16);
            if (fileWritePath("$dir/$fid", $f['text'])) {
                docSet("ats/$id/f/$fid", (object) ['n' => 'resume (from email).txt', 'ty' => 'text/plain', 'sz' => strlen($f['text']), 'at' => now(), 'c' => 'resume']);
                $c = docGet('ats/' . $id);
                $c->rid = $fid;
                $c->rn = 'resume (from email).txt';
                docSet('ats/' . $id, $c);
            }
        }
        agLog($id, (string) $fields['n'], 'New candidate from the inbox (' . $src . ')');
        $cids[] = $id;
        $names[] = (string) $fields['n'];
    }
    return ['kind' => 'resume', 'cids' => $cids, 'names' => $names, 'src' => $board ?: ($dom ?: 'email')];
}
/** A reply by email instead of the form: the assistant (or the patterns) read the details out of it. */
function agReply(string $id, stdClass $c, array $row, array $atts, array $cfg): void
{
    $ag = agOf($c);
    $body = (string) $row['text'];
    // the quoted original under "On ... wrote:" is not their answer
    $body = preg_split('/\n\s*(?:On .{5,120}wrote:|-{2,}\s*Original Message|From:\s.+\n(?:Sent|Date):)/i', $body)[0] ?? $body;
    $ans = (array) ($ag['ans'] ?? []);
    $got = null;
    if (aiReady('agent')) {
        $got = aiJson(
            'You read a candidate\'s email reply for a US IT staffing firm and pull out only what they actually wrote. Answer with one JSON object only.',
            "EMAIL:\n" . mb_substr($body, 0, 6000) . "\n\nReturn {\"ph\": \"\", \"loc\": \"City, ST\", \"auth\": \"work authorization\", \"authUntil\": \"YYYY-MM-DD or empty\", \"rate\": \"\", \"avail\": \"\", \"emp\": \"current employer\", \"li\": \"LinkedIn URL\", \"refs\": [{\"n\": \"\", \"ti\": \"\", \"co\": \"\", \"e\": \"\", \"ph\": \"\"}]}; empty strings for anything not in the email.",
            900
        );
    }
    if (!$got) {
        $got = [];
        if (preg_match('~(?:https?://)?(?:www\.)?linkedin\.com/in/[A-Za-z0-9_\-%]+/?~i', $body, $m)) {
            $got['li'] = $m[0];
        }
        if (preg_match('/(?:work authori[sz]ation|visa|status)\s*[:\-]\s*([^\n]{2,40})/i', $body, $m)) {
            $got['auth'] = trim($m[1]);
        }
        if (preg_match('/(?:rate|expected rate)\s*[:\-]\s*([^\n]{2,40})/i', $body, $m)) {
            $got['rate'] = trim($m[1]);
        }
        if (preg_match('/(?:location|located in|based in)\s*[:\-]?\s*([A-Z][A-Za-z .]+,\s*[A-Z]{2})\b/', $body, $m)) {
            $got['loc'] = trim($m[1]);
        }
        if (preg_match('/(?:phone|mobile|cell)\s*[:\-]\s*(\+?[\d().\s\-]{10,20})/i', $body, $m)) {
            $got['ph'] = trim($m[1]);
        }
    }
    $filled = [];
    foreach (['ph', 'loc', 'auth', 'authUntil', 'rate', 'avail', 'emp', 'li'] as $k) {
        $v = mb_substr(trim((string) ($got[$k] ?? '')), 0, 200);
        if ($v !== '' && trim((string) ($ans[$k] ?? '')) === '') {
            $ans[$k] = $v;
            $filled[] = $k;
        }
    }
    $refs = [];
    foreach ((array) ($got['refs'] ?? []) as $r) {
        $r = (array) $r;
        if (trim((string) ($r['n'] ?? '')) !== '') {
            $refs[] = ['n' => mb_substr((string) $r['n'], 0, 80), 'ti' => mb_substr((string) ($r['ti'] ?? ''), 0, 80), 'co' => mb_substr((string) ($r['co'] ?? ''), 0, 80), 'e' => mb_substr(strtolower((string) ($r['e'] ?? '')), 0, 120), 'ph' => mb_substr((string) ($r['ph'] ?? ''), 0, 30), 'rel' => ''];
        }
    }
    if ($refs && empty($ans['refs'])) {
        $ans['refs'] = array_slice($refs, 0, 3);
        $filled[] = 'references';
    }
    // documents attached to the reply
    $docs = (array) ($ag['docs'] ?? []);
    foreach ($atts as $a) {
        $ext = strtolower(pathinfo((string) ($a['n'] ?? ''), PATHINFO_EXTENSION));
        $fid = (string) ($a['id'] ?? '');
        if (in_array($ext, ['pdf', 'jpg', 'jpeg', 'png'], true) && preg_match('/^[a-f0-9]{32}$/', $fid) && count($docs) < 6) {
            $new = atsCopyResume($id, $fid, (string) $a['n']);
            if ($new) {
                $f = docGet("ats/$id/f/$new");
                $f->c = 'verify-doc';
                docSet("ats/$id/f/$new", $f);
                $docs[] = ['id' => $new, 'n' => (string) $a['n'], 'k' => 'doc'];
            }
        }
    }
    if (count($docs) > count((array) ($ag['docs'] ?? []))) {
        $ag['docs'] = $docs;
        $ag['docsAt'] = now();
        $filled[] = 'documents';
    }
    $ans['via'] = 'email';
    $ag['ans'] = $ans;
    $c->ag = $ag;
    agNote($id, $c, 'Replied by email' . ($filled ? ': ' . implode(', ', $filled) : ' (nothing the agent could read; the form link still works)'));
    $basics = trim((string) ($ans['auth'] ?? '')) !== '' && (trim((string) ($ans['loc'] ?? '')) !== '' || trim((string) ($ans['ph'] ?? '')) !== '');
    if ($basics) {
        $ag['st'] = 'answered';
        $ag['ansAt'] = now();
        unset($ag['evAt']);
        agSave($id, $c, $ag);
        agEvaluate($id, docGet('ats/' . $id), $cfg);
    } else {
        agSave($id, $c, $ag);
    }
}

/* ---------- routes ---------- */
function agStaffOut(string $id, stdClass $c, bool $full): array
{
    $ag = agOf($c);
    unset($ag['tok'], $ag['tokH'], $ag['fp']);
    $o = [
        'id' => $id, 'n' => (string) ($c->n ?? ''), 'e' => (string) ($c->e ?? ''), 'ph' => (string) ($c->ph ?? ''), 'jt' => (string) ($c->jt ?? ''), 'job' => (string) ($c->job ?? ''),
        'src' => (string) ($c->src ?? ''), 'via' => agVia($c), 'loc' => (string) ($c->loc ?? ''), 'auth' => (string) ($c->auth ?? ''), 'li' => (string) ($c->li ?? ''), 'st' => (string) ($c->st ?? ''), 'at' => (int) ($c->at ?? 0),
        'vend' => isset($c->vend) ? (array) $c->vend : null, 'ag' => $ag,
    ];
    if (!$full) {
        unset($o['ag']['qa'], $o['ag']['ans'], $o['ag']['qs']);
        $o['ag']['risk']['flags'] = array_slice((array) ($ag['risk']['flags'] ?? []), 0, 3);
    } else {
        $o['log'] = array_slice((array) ($c->log ?? []), -40);
        $o['files'] = [];
        foreach (colAll("ats/$id/f") as [$fid, $f]) {
            $o['files'][] = ['id' => (string) $fid, 'n' => (string) ($f->n ?? ''), 'c' => (string) ($f->c ?? ''), 'at' => (int) ($f->at ?? 0)];
        }
    }
    return $o;
}
/** The candidate behind a link token, or null. */
function agByToken(string $tok): array
{
    if (!preg_match('/^[a-f0-9]{32}$/', $tok)) {
        return [null, null, ''];
    }
    $h = hash('sha256', $tok);
    $t = docGet('ats/x/agent/tok/' . $h);
    if (!$t) {
        return [null, null, ''];
    }
    $cid = (string) ($t->cid ?? '');
    $c = docGet('ats/' . $cid);
    if (!$c || (string) ($c->ag->tokH ?? '') !== $h) {
        return [null, null, ''];
    }
    return [$cid, $c, $h];
}
function agRoute(string $r, array $b): never
{
    switch ($r) {
        /* ----- public: the candidate's secure form ----- */
        case 'ag_form': {
            if (throttleHit('agform:' . clientIp(), 60, 3600)) {
                fail(429, 'rate_limited', 'Too many tries from this network. Try again in an hour.');
            }
            [$cid, $c] = agByToken(str($b, 't', 40));
            if (!$c) {
                ok(['state' => 'gone']);
            }
            $ag = agOf($c);
            if (!empty($ag['used'])) {
                ok(['state' => 'done', 'first' => agFirst((string) $c->n)]);
            }
            if ((int) ($ag['exp'] ?? 0) < now()) {
                ok(['state' => 'expired', 'first' => agFirst((string) $c->n)]);
            }
            $cfg = agCfg();
            if (empty($ag['opened'])) {
                $ag['opened'] = now();
                $c->ag = $ag;
                agNote($cid, $c, 'Opened the link');
                agSave($cid, $c, $ag);
            }
            $pub = atsPublicJob((string) ($c->job ?? ''));
            ok([
                'state' => 'open',
                'first' => agFirst((string) $c->n),
                'name' => (string) $c->n,
                'vendor' => !empty($ag['toVendor']),
                'job' => (string) (($pub->ti ?? '') ?: ($c->jt ?? '')),
                'loc' => (string) ($pub->loc ?? ''),
                'ask' => $cfg['ask'],
                'qs' => !empty($cfg['ask']['quiz']) ? array_map(fn($q) => (string) $q['q'], (array) ($ag['qs'] ?? [])) : [],
                'exp' => (int) $ag['exp'],
            ]);
        }
        case 'ag_submit': {
            if (throttleHit('agsub:' . clientIp(), 20, 3600)) {
                fail(429, 'rate_limited', 'Too many tries from this network. Try again in an hour.');
            }
            $in = $_POST ?: $b;
            [$cid, $c] = agByToken(str($in, 't', 40));
            if (!$c) {
                fail(404, 'not_found', 'This link is no longer valid. Reply to the email and the recruiter will send a new one.');
            }
            $ag = agOf($c);
            if (!empty($ag['used'])) {
                fail(409, 'conflict', 'These details were already sent. Thank you!');
            }
            if ((int) ($ag['exp'] ?? 0) < now()) {
                fail(410, 'expired', 'This link has run out. Reply to the email and the recruiter will send a new one.');
            }
            $cfg = agCfg();
            $ask = $cfg['ask'];
            $a = json_decode((string) ($in['answers'] ?? '{}'), true);
            $a = is_array($a) ? $a : [];
            $s = fn(string $k, int $n = 200) => mb_substr(trim((string) ($a[$k] ?? '')), 0, $n);
            $ans = [];
            if (!empty($ask['basics'])) {
                foreach (['ph' => 40, 'loc' => 120, 'auth' => 40, 'authUntil' => 20, 'avail' => 80, 'rate' => 60, 'emp' => 120, 'reloc' => 20] as $k => $n) {
                    $ans[$k] = $s($k, $n);
                }
                if ($ans['ph'] === '' || strlen(preg_replace('/\D/', '', $ans['ph']) ?? '') < 10) {
                    fail(400, 'invalid_argument', 'Add a phone number we can reach you on.');
                }
                if ($ans['loc'] === '' || $ans['auth'] === '') {
                    fail(400, 'invalid_argument', 'Add where you live and your work authorization.');
                }
                if (empty($a['consent'])) {
                    fail(400, 'invalid_argument', 'Please confirm the details are accurate.');
                }
            }
            if (!empty($ask['refs'])) {
                $ans['li'] = $s('li', 300);
                if ($ans['li'] !== '' && !preg_match('~linkedin\.com/in/~i', $ans['li'])) {
                    fail(400, 'invalid_argument', 'The LinkedIn link should look like linkedin.com/in/your-name.');
                }
                $refs = [];
                foreach (array_slice((array) ($a['refs'] ?? []), 0, 3) as $rf) {
                    $rf = (array) $rf;
                    $one = ['n' => mb_substr(trim((string) ($rf['n'] ?? '')), 0, 80), 'ti' => mb_substr(trim((string) ($rf['ti'] ?? '')), 0, 80), 'co' => mb_substr(trim((string) ($rf['co'] ?? '')), 0, 80), 'e' => mb_substr(strtolower(trim((string) ($rf['e'] ?? ''))), 0, 120), 'ph' => mb_substr(trim((string) ($rf['ph'] ?? '')), 0, 30), 'rel' => mb_substr(trim((string) ($rf['rel'] ?? '')), 0, 40)];
                    if ($one['n'] === '') {
                        continue;
                    }
                    if ($one['e'] !== '' && !filter_var($one['e'], FILTER_VALIDATE_EMAIL)) {
                        fail(400, 'invalid_argument', 'Check the email of ' . $one['n'] . '.');
                    }
                    if ($one['e'] === '' && strlen(preg_replace('/\D/', '', $one['ph']) ?? '') < 10) {
                        fail(400, 'invalid_argument', 'Add an email or phone for ' . $one['n'] . '.');
                    }
                    $refs[] = $one;
                }
                if (count($refs) < 2) {
                    fail(400, 'invalid_argument', 'Add two references (a manager or a client contact you worked with).');
                }
                $ans['refs'] = $refs;
            }
            $qa = [];
            if (!empty($ask['quiz'])) {
                $qs = (array) ($ag['qs'] ?? []);
                $got = (array) ($a['qa'] ?? []);
                foreach ($qs as $i => $q) {
                    $txt = mb_substr(trim((string) ($got[$i] ?? '')), 0, 4000);
                    if (mb_strlen($txt) < 20) {
                        fail(400, 'invalid_argument', 'Please answer question ' . ($i + 1) . ' in a few sentences.');
                    }
                    $qa[] = ['q' => (string) $q['q'], 'look' => (string) ($q['look'] ?? ''), 'a' => $txt, 'paste' => (int) (((array) ($a['pastes'] ?? []))[$i] ?? 0)];
                }
            }
            // documents: work authorization and ID copies (PDF or photo), kept for the settings' number of days
            $docs = (array) ($ag['docs'] ?? []);
            if (!empty($ask['docs'])) {
                foreach (['wa' => 'verify-wa', 'id' => 'verify-id'] as $field => $cat) {
                    $f = $_FILES[$field] ?? null;
                    if (!$f || ($f['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
                        continue;
                    }
                    $ext = strtolower(pathinfo((string) $f['name'], PATHINFO_EXTENSION));
                    if (!in_array($ext, ['pdf', 'jpg', 'jpeg', 'png'], true)) {
                        fail(400, 'invalid_argument', 'Upload the document as a PDF or a photo (JPG or PNG).');
                    }
                    if ((int) $f['size'] > 10 * 1048576) {
                        fail(400, 'too_large', 'Each document can be up to 10 MB.');
                    }
                    $d = storeUpload($f, 'ats/' . $cid, ['c' => $cat]);
                    $docs[] = ['id' => $d['id'], 'n' => $d['n'], 'k' => $field];
                }
                if (!array_filter($docs, fn($d) => in_array($d['k'] ?? '', ['wa', 'doc'], true))) {
                    fail(400, 'invalid_argument', 'Add a copy of your work authorization (or passport for US citizens).');
                }
            }
            $ans['via'] = 'form';
            $ans['ip'] = clientIp();
            $ag['ans'] = $ans;
            $ag['qa'] = $qa;
            $ag['docs'] = $docs;
            $ag['docsAt'] = $docs ? now() : 0;
            $ag['secs'] = max(0, min(86400, (int) ($a['secs'] ?? 0)));
            $ag['used'] = true;
            $ag['ansAt'] = now();
            $ag['st'] = 'answered';
            unset($ag['evAt']);
            $c->ag = $ag;
            agNote($cid, $c, 'Sent the details through the secure form' . ($ag['toVendor'] ?? false ? ' (filled by the vendor)' : ''));
            agSave($cid, $c, $ag);
            // StratEdge AI reads the answers right after the response goes back (or on the next run); without it the
            // checks run now
            if ($cfg['on'] && aiReady('agent') && !empty($cfg['ask']['quiz'])) {
                agSoon();
            } else {
                agEvaluate($cid, docGet('ats/' . $cid), $cfg, false);
            }
            ok(['ok' => true]);
        }
    }
    /* ----- staff: admin and HR (the ATS's own access) ----- */
    $write = in_array($r, ['ag_cfg_save', 'ag_decide', 'ag_run', 'ag_block', 'ag_screen'], true);
    $u = atsStaff($write);
    switch ($r) {
        case 'ag_overview': {
            $cfg = agCfg();
            $counts = [];
            $q = 0;
            foreach (agCards() as [$id, $c]) {
                $st = (string) ($c->ag->st ?? '');
                if ($st !== '') {
                    $counts[$st] = ($counts[$st] ?? 0) + 1;
                }
            }
            $log = docGet('ats/x/agent/log');
            $today = 0;
            foreach ((array) ($log->rows ?? []) as $row) {
                if ((int) ($row->t ?? 0) >= strtotime('today') * 1000 && preg_match('/^(Emailed|Reminder)/', (string) ($row->ev ?? ''))) {
                    $today++;
                }
            }
            $cfgOut = $cfg;
            ok(['cfg' => $cfgOut, 'counts' => $counts, 'ran' => (int) ($log->ran ?? 0), 'sentToday' => $today, 'ai' => aiReady('agent'), 'mail' => agMailOn(), 'names' => AG_ST_NAME]);
        }
        case 'ag_list': {
            $tab = str($b, 'tab', 12);
            $rows = [];
            foreach (agCards() as [$id, $c]) {
                $st = (string) ($c->ag->st ?? '');
                if ($st === '') {
                    continue;
                }
                $in = match ($tab) {
                    'you' => in_array($st, ['notfit', 'review', 'verified'], true),
                    'wait' => in_array($st, ['new', 'asked', 'reminded', 'answered'], true),
                    'done' => in_array($st, ['closed', 'kept', 'fake', 'stopped', 'noreply', 'skipped'], true),
                    default => true,
                };
                if ($in) {
                    $rows[] = agStaffOut((string) $id, $c, false);
                }
            }
            usort($rows, fn($x, $y) => ($y['ag']['u'] ?? 0) <=> ($x['ag']['u'] ?? 0));
            ok(['rows' => array_slice($rows, 0, 300)]);
        }
        case 'ag_get': {
            $id = preg_replace('/[^A-Za-z0-9_\-]/', '', str($b, 'id', 40)) ?? '';
            $c = docGet('ats/' . $id);
            if (!$c) {
                fail(404, 'not_found', 'That candidate is gone.');
            }
            ok(['c' => agStaffOut($id, $c, true)]);
        }
        case 'ag_log':
            ok(['rows' => array_reverse((array) (docGet('ats/x/agent/log')->rows ?? []))]);
        case 'ag_run': {
            session_write_close();
            @set_time_limit(150);
            $cfg = agCfg();
            if (!$cfg['on']) {
                fail(400, 'invalid_argument', 'Switch the agent on first.');
            }
            ok(['out' => agSweep(100, 12)]);
        }
        case 'ag_screen': {
            // a recruiter asks the agent to screen one candidate now (any source, any date)
            session_write_close();
            @set_time_limit(120);
            $id = preg_replace('/[^A-Za-z0-9_\-]/', '', str($b, 'id', 40)) ?? '';
            $c = docGet('ats/' . $id);
            if (!$c) {
                fail(404, 'not_found', 'That candidate is gone.');
            }
            $ag = agOf($c);
            if (in_array((string) ($ag['st'] ?? ''), ['asked', 'reminded', 'answered'], true)) {
                fail(409, 'conflict', 'The agent is already waiting on this candidate.');
            }
            $ag['st'] = 'new';
            $ag['at'] = now();
            agSave($id, $c, $ag);
            agScreenBatch([$id], agCfg(), true);
            ok(['c' => agStaffOut($id, docGet('ats/' . $id), true)]);
        }
        case 'ag_decide': {
            $id = preg_replace('/[^A-Za-z0-9_\-]/', '', str($b, 'id', 40)) ?? '';
            $c = docGet('ats/' . $id);
            if (!$c) {
                fail(404, 'not_found', 'That candidate is gone.');
            }
            $d = str($b, 'd', 20);
            $cfg = agCfg();
            $ag = agOf($c);
            $who = (string) $u['name'];
            $rejectTo = function (string $why) use ($c) {
                $job = atsJob((string) ($c->job ?? ''));
                foreach ($job['stages'] as $sg) {
                    if ($sg['kind'] === 'rejected') {
                        return $sg['k'];
                    }
                }
                return 'rejected';
            };
            switch ($d) {
                case 'reject_email':
                case 'reject':
                    $mailed = false;
                    if ($d === 'reject_email' && filter_var((string) ($c->e ?? ''), FILTER_VALIDATE_EMAIL)) {
                        require_once __DIR__ . '/mail.php';
                        $tpl = (array) ($cfg['tpl']['notfit'] ?? AG_DEFAULT['tpl']['notfit']);
                        $vars = ['first' => agFirst((string) $c->n), 'name' => (string) $c->n, 'job' => (string) (($c->jt ?? '') ?: 'the open'), 'sender' => $who, 'ref' => (string) ($ag['ref'] ?? ''), 'where' => '', 'expires' => '', 'link' => ''];
                        $subject = agFill((string) $tpl['s'], $vars);
                        $body = agFill((string) $tpl['b'], $vars);
                        $mailed = mailDeliver(['to' => (string) $c->e, 'name' => (string) $c->n, 'subject' => $subject, 'text' => $body, 'html' => emailHtml($subject, preg_split('/\n{2,}/', $body) ?: [$body]), 'reply' => (string) $u['email'], 'kind' => 'agent']);
                    }
                    if (!empty($c->job)) {
                        atsMove($c, $id, $rejectTo('Not qualified'), $u, 'Not qualified', 'Decided from the screening agent', true);
                        $c = docGet('ats/' . $id);
                    }
                    $ag['st'] = 'closed';
                    $ag['dec'] = ['d' => $d, 'by' => $who, 'at' => now()];
                    agNote($id, $c, $who . ' rejected' . ($d === 'reject_email' ? ($mailed ? ' and sent the "not a match" email' : ' (the email did not go out)') : ' without an email'));
                    break;
                case 'keep':
                    $ag['st'] = 'kept';
                    $ag['dec'] = ['d' => $d, 'by' => $who, 'at' => now()];
                    $c->pool = true;
                    agNote($id, $c, $who . ' kept them in the talent pool (no email)');
                    break;
                case 'ask':
                case 'resend':
                    if (!agSend($id, $c, $ag, $cfg, 'ask')) {
                        fail(400, 'invalid_argument', (string) ($ag['err'] ?? 'The email did not go out.'));
                    }
                    $ag['dec'] = ['d' => $d, 'by' => $who, 'at' => now()];
                    agNote($id, $c, $who . ($d === 'ask' ? ' asked for the details anyway' : ' sent a new link') . ' (' . $ag['to'] . ')');
                    break;
                case 'verified':
                    $ag['st'] = 'verified';
                    $ag['dec'] = ['d' => $d, 'by' => $who, 'at' => now()];
                    agNote($id, $c, $who . ' marked them verified');
                    break;
                case 'stop':
                    $ag['st'] = 'stopped';
                    agNote($id, $c, $who . ' stopped the reminders');
                    break;
                case 'fake':
                    $ag['st'] = 'fake';
                    $ag['dec'] = ['d' => $d, 'by' => $who, 'at' => now()];
                    $blk = docGet('ats/x/agent/block') ?? new stdClass();
                    $items = (array) ($blk->items ?? []);
                    $why = mb_substr(str($b, 'why', 160) ?: 'Fake profile', 0, 160);
                    foreach (['email' => strtolower(trim((string) ($c->e ?? ''))), 'phone' => agPhone((string) ($c->ph ?? '')), 'li' => agLiSlug((string) ($c->li ?? '') ?: (string) ($ag['ans']['li'] ?? ''))] as $k => $v) {
                        if ($v !== '') {
                            $items[] = (object) ['k' => $k, 'v' => $v, 'why' => $why . ' · ' . (string) $c->n, 'by' => $who, 'at' => now()];
                        }
                    }
                    $blk->items = array_slice($items, -2000);
                    docSet('ats/x/agent/block', $blk);
                    if (!empty($c->job)) {
                        atsMove($c, $id, $rejectTo('Fake'), $u, 'Fake / fraudulent profile', $why, true);
                        $c = docGet('ats/' . $id);
                    }
                    agNote($id, $c, $who . ' marked the profile fake: ' . $why . ' (email, phone and LinkedIn are flagged from now on)');
                    break;
                default:
                    fail(400, 'invalid_argument', 'Unknown decision.');
            }
            agSave($id, $c, $ag);
            ok(['c' => agStaffOut($id, docGet('ats/' . $id), true)]);
        }
        case 'ag_cfg_save': {
            $cur = agCfg();
            $in = (array) ($b['cfg'] ?? []);
            $c = $cur;
            if (array_key_exists('on', $in)) {
                $on = !empty($in['on']);
                if ($on && !$cur['on']) {
                    $c['since'] = now(); // from now on: candidates already in the ATS are screened only when asked
                }
                $c['on'] = $on;
            }
            foreach (['src' => ['web', 'inbox', 'staff'], 'ask' => ['basics', 'refs', 'quiz', 'docs']] as $k => $keys) {
                if (isset($in[$k]) && is_array($in[$k])) {
                    foreach ($keys as $kk) {
                        if (array_key_exists($kk, $in[$k])) {
                            $c[$k][$kk] = !empty($in[$k][$kk]);
                        }
                    }
                }
            }
            $num = ['qualify' => [30, 100], 'maybe' => [0, 95], 'remind' => [4, 168], 'reminders' => [0, 5], 'expire' => [1, 30], 'cap' => [1, 2000], 'keepDocs' => [7, 365]];
            foreach ($num as $k => [$lo, $hi]) {
                if (isset($in[$k]) && is_numeric($in[$k])) {
                    $c[$k] = max($lo, min($hi, (int) $in[$k]));
                }
            }
            if ($c['maybe'] >= $c['qualify']) {
                $c['maybe'] = max(0, $c['qualify'] - 10);
            }
            foreach (['move', 'vendor'] as $k) {
                if (array_key_exists($k, $in)) {
                    $c[$k] = !empty($in[$k]);
                }
            }
            if (isset($in['notify']) && is_array($in['notify'])) {
                $c['notify'] = array_values(array_filter(array_map('strval', $in['notify']), fn($x) => (bool) preg_match('/^u_[a-f0-9]+$/', $x)));
            }
            if (array_key_exists('replyTo', $in)) {
                $rt = strtolower(trim((string) $in['replyTo']));
                if ($rt !== '' && !filter_var($rt, FILTER_VALIDATE_EMAIL)) {
                    fail(400, 'invalid_argument', 'The reply-to address is not a valid email.');
                }
                $c['replyTo'] = $rt;
            }
            if (isset($in['tpl']) && is_array($in['tpl'])) {
                foreach (['ask', 'remind', 'vendor', 'notfit'] as $k) {
                    if (isset($in['tpl'][$k]) && is_array($in['tpl'][$k])) {
                        $s = mb_substr(trim((string) ($in['tpl'][$k]['s'] ?? '')), 0, 200);
                        $bd = mb_substr(trim((string) ($in['tpl'][$k]['b'] ?? '')), 0, 4000);
                        if ($s !== '' && $bd !== '') {
                            $c['tpl'][$k] = ['s' => $s, 'b' => $bd];
                        }
                    }
                }
            }
            docSet('ats/x/agent/cfg', (object) json_decode(json_encode($c)));
            agLog('', (string) $u['name'], 'Settings saved' . ($c['on'] !== $cur['on'] ? ($c['on'] ? ': the agent is on' : ': the agent is off') : ''));
            ok(['cfg' => agCfg()]);
        }
        case 'ag_block': {
            $blk = docGet('ats/x/agent/block') ?? new stdClass();
            $items = (array) ($blk->items ?? []);
            $op = str($b, 'op', 10);
            if ($op === 'add') {
                $k = str($b, 'k', 10);
                $v = strtolower(str($b, 'v', 200));
                if (!in_array($k, ['email', 'phone', 'li', 'domain'], true) || $v === '') {
                    fail(400, 'invalid_argument', 'Choose what to block and type it.');
                }
                $v = $k === 'phone' ? agPhone($v) : ($k === 'li' ? (agLiSlug($v) ?: $v) : $v);
                if ($v === '') {
                    fail(400, 'invalid_argument', 'That phone number has fewer than 10 digits.');
                }
                $items[] = (object) ['k' => $k, 'v' => $v, 'why' => str($b, 'why', 160), 'by' => (string) $u['name'], 'at' => now()];
            } elseif ($op === 'remove') {
                $i = (int) ($b['i'] ?? -1);
                if (isset($items[$i])) {
                    array_splice($items, $i, 1);
                }
            }
            $blk->items = array_values($items);
            docSet('ats/x/agent/block', $blk);
            ok(['items' => $blk->items]);
        }
        case 'ag_blocklist':
            ok(['items' => (array) (docGet('ats/x/agent/block')->items ?? [])]);
        case 'ag_link': {
            // a recruiter copies the candidate's current link (to send another way)
            $id = preg_replace('/[^A-Za-z0-9_\-]/', '', str($b, 'id', 40)) ?? '';
            $c = docGet('ats/' . $id);
            $tok = $c ? mailUnseal((string) ($c->ag->tok ?? '')) : '';
            if ($tok === '' || (int) ($c->ag->exp ?? 0) < now() || !empty($c->ag->used)) {
                fail(404, 'not_found', 'There is no open link for this candidate. Send a new one.');
            }
            ok(['url' => agLink($tok)]);
        }
    }
    fail(404, 'not_found', 'Unknown action.');
}
