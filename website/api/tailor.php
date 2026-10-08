<?php
declare(strict_types=1);
/* Resume tailoring (v31): a job description in, an ATS-friendly resume out.
   - Reads the resume (a consultant's own, one from the recruiting database, an ATS candidate, an upload or pasted text),
     parses it into sections (the assistant when configured, rules otherwise), rewrites it for the JD (the assistant;
     rules reorder and surface what is already there), scores it before and after, and writes a clean single-column
     DOCX and PDF (no tables, no columns, standard headings) that parsers read reliably.
   - Employers, titles, dates, education and certifications are restored from the original after the rewrite, whatever
     the assistant returned; keywords the rewrite introduced that the original never mentioned are listed for the
     recruiter or consultant to confirm.
   - Staff (admin, HR, internal recruiters, recruiting team) work from rec/tl/items/{id} with a "find consultants" ranking
     over the portal resumes, the recruiting database and ATS candidates; members work on their own tl/{uid}/items.
   - v33: any number of pages (1-15). A resume shorter than the pages needed is written out in the US IT staffing
     format (summary bullets, an Environment line per job, more detail per job) by StratEdge AI, one job per call in
     parallel; one that is longer loses its least relevant bullets (older jobs first). */
require_once __DIR__ . '/vms.php';
require_once __DIR__ . '/mail.php';
require_once __DIR__ . '/sso.php';

const TL_MAX_JD = 12000;
const TL_MAX_RESUME = 24000;
const TL_MAX_PAGES = 15; // v33: the most pages a tailored resume may be asked for
const TL_MAX_BULLETS = 40; // v33: per job (long resumes)
const TL_ROLE_WORDS = 'developer|engineer|programmer|consultant|analyst|architect|administrator|admin|manager|lead|specialist|tester|scientist|designer|accountant|coordinator|technician|director|officer|associate|intern|nurse|recruiter|executive|head|principal|owner|devops|sre|qa|dba|pm|coder|biller|therapist|pharmacist|assistant|clerk|representative|planner|buyer|auditor|controller|bookkeeper|marketer|writer|editor|abstractor|generalist|supervisor|agent|advisor|paralegal|teacher|trainer';
const TL_HEADINGS = [
    'summary' => 'summary|professional summary|profile|professional profile|career summary|objective|about|overview|executive summary',
    'skills' => 'skills|technical skills|core skills|core competencies|competencies|technologies|technical summary|technical expertise|areas of expertise|tools|skill set|technical proficiencies',
    'experience' => 'experience|work experience|professional experience|employment|employment history|work history|career history|professional background|relevant experience',
    'education' => 'education|academic background|academics|qualifications|educational qualifications',
    'certs' => 'certifications|certification|certificates|licenses|licenses and certifications|certifications and training|training',
    'projects' => 'projects|key projects|selected projects|academic projects|personal projects',
    'other' => 'achievements|awards|honors|publications|languages|interests|volunteer|references|additional information|affiliations',
];
const TL_STOP = ['the', 'and', 'for', 'with', 'you', 'our', 'are', 'will', 'this', 'that', 'from', 'have', 'has', 'not', 'but', 'all', 'any', 'can', 'who', 'what', 'your', 'their', 'they', 'them', 'into', 'than', 'then', 'such', 'more', 'most', 'also', 'able', 'about', 'across', 'after', 'etc', 'per', 'via', 'using', 'use', 'used', 'work', 'working', 'works', 'team', 'teams', 'role', 'roles', 'job', 'jobs', 'years', 'year', 'experience', 'experienced', 'strong', 'good', 'excellent', 'skills', 'skill', 'knowledge', 'ability', 'required', 'requirements', 'requirement', 'preferred', 'plus', 'must', 'should', 'nice', 'responsibilities', 'responsible', 'duties', 'description', 'position', 'candidate', 'candidates', 'client', 'clients', 'company', 'business', 'environment', 'including', 'include', 'includes', 'within', 'well', 'new', 'other', 'various', 'related', 'based', 'level', 'senior', 'junior', 'lead', 'minimum', 'degree', 'bachelor', 'bachelors', 'master', 'masters', 'equivalent', 'field', 'computer', 'science', 'information', 'technology', 'understanding', 'familiarity', 'familiar', 'proficient', 'proficiency', 'hands', 'solid', 'proven', 'track', 'record', 'communication', 'written', 'verbal', 'develop', 'developing', 'development', 'design', 'designing', 'support', 'supporting', 'maintain', 'maintaining', 'ensure', 'ensuring', 'provide', 'providing', 'perform', 'performing', 'collaborate', 'collaborating', 'participate', 'implement', 'implementing', 'implementation', 'manage', 'managing', 'management', 'process', 'processes', 'system', 'systems', 'application', 'applications', 'solution', 'solutions', 'project', 'projects', 'product', 'products', 'service', 'services', 'data', 'software', 'technical', 'engineering', 'engineer', 'developer', 'analyst', 'architect', 'consultant', 'manager', 'location', 'remote', 'onsite', 'hybrid', 'contract', 'duration', 'rate', 'visa', 'only', 'local', 'need', 'needs', 'looking', 'seeking', 'join', 'opportunity', 'please', 'send', 'resume', 'resumes', 'apply', 'immediate', 'start', 'asap', 'urgent', 'hiring', 'hire', 'full', 'time', 'part', 'long', 'term', 'short', 'day', 'days', 'week', 'weeks', 'month', 'months', 'hour', 'hours'];

/* ---------- who may do what ---------- */
function tailorStaff(): array
{
    $u = requireUser();
    if (hasRole($u, 'admin') || hasRole($u, 'hr') || isRecruiter($u['id']) || isBench($u['id'])) {
        return $u;
    }
    fail(403, 'invalid_argument', 'Resume tailoring for other people is for recruiters, recruiting team and HR.');
}
function tailorIsStaff(array $u): bool
{
    return hasRole($u, 'admin') || hasRole($u, 'hr') || isRecruiter($u['id']) || isBench($u['id']);
}
/** The item base for a request: staff work in rec/tl, members in their own tl/{uid}. */
function tailorBase(array $u, array $b): string
{
    $scope = (string) ($b['scope'] ?? ($_GET['scope'] ?? ''));
    if ($scope === 'rec') {
        tailorStaff();
        return 'rec/tl/items';
    }
    return 'tl/' . $u['id'] . '/items';
}

/* ---------- text helpers ---------- */
function tlLines(string $t): array
{
    $t = str_replace(["\r\n", "\r"], "\n", $t);
    $t = preg_replace('/[\x{00A0}\x{2007}\x{202F}]/u', ' ', $t) ?? $t;
    return array_values(array_filter(array_map(fn($l) => rtrim(preg_replace('/[ \t]+/', ' ', $l) ?? $l), explode("\n", $t)), fn($l) => trim($l) !== ''));
}
function tlIsBullet(string $l): bool
{
    return (bool) preg_match('/^\s*(?:[-•▪◦●○■□▶►➢➤✓✔*·–—]|\d{1,2}[.)])\s+/u', $l);
}
function tlStripBullet(string $l): string
{
    return trim(preg_replace('/^\s*(?:[-•▪◦●○■□▶►➢➤✓✔*·–—]|\d{1,2}[.)])\s+/u', '', $l) ?? $l);
}
function tlHeading(string $l): string
{
    $s = strtolower(trim(preg_replace('/[^A-Za-z &\/]+/', ' ', $l) ?? $l));
    $s = trim(preg_replace('/\s+/', ' ', $s) ?? $s);
    if ($s === '' || str_word_count($s) > 5 || mb_strlen(trim($l)) > 48) {
        return '';
    }
    foreach (TL_HEADINGS as $k => $pat) {
        if (preg_match('/^(?:' . $pat . ')$/', $s)) {
            return $k;
        }
    }
    return '';
}
const TL_DATE_RX = '(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(?:\d{1,2}\/)?(?:19|20)\d{2}\s*(?:–|—|-|to|until)\s*(?:(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(?:\d{1,2}\/)?(?:19|20)\d{2}|present|current|till date|to date|now|ongoing)';
function tlDateRange(string $l): ?array
{
    if (preg_match('/(' . TL_DATE_RX . ')/iu', $l, $m)) {
        $parts = preg_split('/\s*(?:–|—|-|\bto\b|\buntil\b)\s*/iu', $m[1], 2) ?: [$m[1], ''];
        return [trim($parts[0]), trim($parts[1] ?? ''), $m[1]];
    }
    return null;
}
function tlWords(string $s): array
{
    $s = strtolower($s);
    preg_match_all('/[a-z0-9][a-z0-9+#.\-]{1,}/u', $s, $m);
    $out = [];
    foreach ($m[0] as $w) {
        $w = trim($w, '.-');
        if (mb_strlen($w) >= 2 && !in_array($w, TL_STOP, true) && !is_numeric($w)) {
            $out[] = $w;
        }
    }
    return $out;
}

/* ---------- the job description ---------- */
function tailorJd(string $jd, array $meta = []): array
{
    $jd = mb_substr(cleanText($jd), 0, TL_MAX_JD);
    $lines = tlLines($jd);
    $grab = function (string $label) use ($jd): string {
        return preg_match('/^\s*' . $label . '\s*[:\-–]\s*(.{2,120})$/mi', $jd, $m) ? trim($m[1]) : '';
    };
    $title = trim((string) ($meta['title'] ?? ''));
    if ($title === '') {
        $title = $grab('(?:job title|title|position|role|requirement)');
    }
    if ($title === '' && $lines) {
        $first = trim($lines[0]);
        if (mb_strlen($first) <= 90 && preg_match('/\b(?:' . TL_ROLE_WORDS . ')\b/i', $first)) {
            $title = $first;
        }
    }
    if ($title === '') {
        foreach (array_slice($lines, 0, 12) as $l) {
            if (mb_strlen($l) <= 70 && preg_match('/\b(?:' . TL_ROLE_WORDS . ')\b/i', $l) && !tlIsBullet($l)) {
                $title = trim($l);
                break;
            }
        }
    }
    $title = preg_replace('/^(?:job title|title|position|role)\s*[:\-]\s*/i', '', $title) ?? $title;
    $company = trim((string) ($meta['company'] ?? '')) ?: $grab('(?:company|client|end client|employer|customer)');
    $loc = trim((string) ($meta['loc'] ?? '')) ?: $grab('(?:location|work location|job location)');
    $years = null;
    if (preg_match('/(\d{1,2})\s*\+?\s*(?:to|-|–)?\s*(?:\d{1,2})?\s*\+?\s*(?:years|yrs)/i', $jd, $m)) {
        $years = (int) $m[1];
    }
    $skills = skillsIn($jd, 40);
    // requirement lines: bullets under requirements/qualifications/skills headings (or any bullet when there are none)
    $reqs = [];
    $inReq = false;
    foreach ($lines as $l) {
        $h = strtolower(trim($l, " :\t"));
        if (mb_strlen($l) <= 60 && preg_match('/^(?:(?:basic |minimum |required |preferred |key |technical |desired |must[- ]have |nice[- ]to[- ]have )?(?:requirements?|qualifications?|skills(?: required| and experience)?|what you(?:\'ll)? bring|what we(?:\'re)? looking for|must haves?|experience required|you have|about you|requirements and qualifications))$/i', $h)) {
            $inReq = true;
            continue;
        }
        if (mb_strlen($l) <= 60 && preg_match('/^(?:responsibilities|duties|what you(?:\'ll)? do|about (?:the )?(?:role|job|us|company)|job description|benefits|perks|overview|summary|description)$/i', $h)) {
            $inReq = false;
            continue;
        }
        if ($inReq && tlIsBullet($l)) {
            $t = tlStripBullet($l);
            if (mb_strlen($t) >= 8 && count($reqs) < 24) {
                $reqs[] = mb_substr($t, 0, 220);
            }
        }
    }
    if (!$reqs) {
        foreach ($lines as $l) {
            if (tlIsBullet($l)) {
                $t = tlStripBullet($l);
                if (mb_strlen($t) >= 12 && count($reqs) < 16) {
                    $reqs[] = mb_substr($t, 0, 220);
                }
            }
        }
    }
    // named tools and nouns the dictionary does not know (SAP PP, Terraform Cloud, Snowflake): capitalised runs
    $extra = [];
    preg_match_all('/\b(?:[A-Z][A-Za-z0-9+#.]{1,}|[A-Z]{2,}[0-9]*)(?:[ \/\-](?:[A-Z][A-Za-z0-9+#.]{1,}|[A-Z]{2,}[0-9]*)){0,2}\b/u', $jd, $mm);
    $skLow = array_map('strtolower', $skills);
    foreach ($mm[0] as $w) {
        $lw = strtolower($w);
        if (mb_strlen($w) < 3 || in_array($lw, TL_STOP, true) || in_array($lw, $skLow, true) || preg_match('/^(?:the|and|for|with|job|title|location|role|position|company|client|requirements?|responsibilities|qualifications|skills|experience|description|summary|about|must|nice|preferred|required|remote|onsite|hybrid|contract|duration|rate|usa|us|united|states|america|north|south|east|west|new|york|jersey|texas|california|florida|chicago|dallas|atlanta|boston|please|send|email|phone|contact|note|notes|key|strong|good|excellent|bachelor|bachelors|master|masters|degree|computer|science|engineering|information|technology|senior|junior|lead|years|year|team|teams|work|working|knowledge|ability|understanding|hands|day|days|week|weeks|month|months|hour|hours|monday|friday|ok|okay|yes|no)$/i', $w)) {
            continue;
        }
        if (preg_match('/^[A-Z][a-z]+$/', $w) && !preg_match('/[A-Z].*[A-Z]|\d|\+|#|\./', $w)) {
            // a single capitalised ordinary word (sentence starts) is not a tool unless it appears mid-sentence too
            if (!preg_match('/[a-z,;]\s+' . preg_quote($w, '/') . '\b/', $jd)) {
                continue;
            }
        }
        $extra[$lw] = ($extra[$lw] ?? 0) + 1;
    }
    arsort($extra);
    $terms = [];
    $skipIn = strtolower($title . ' ' . $company . ' ' . $loc);
    $verbs = '/^(?:build|builds|building|design|designs|designing|develop|develops|developing|implement|implements|implementing|create|creates|creating|write|writes|writing|lead|leads|leading|manage|manages|managing|support|supports|supporting|maintain|maintains|maintaining|deploy|deploys|deploying|participate|collaborate|ensure|provide|perform|work|working|own|drive|deliver|define|review|test|testing|monitor|troubleshoot|analyze|analyse|partner|mentor|coach|help|assist|coordinate|communicate|contribute|identify|improve|optimize|optimise|research|document|report|track|plan|execute|integrate|configure|migrate|automate|must|should|strong|hands|job|title|role|position|location|client|company|duration|rate|contract|requirements?|responsibilities|qualifications|skills|experience|preferred|required|nice|plus|years?|hybrid|remote|onsite)\b/i';
    foreach (array_keys(array_slice($extra, 0, 30, true)) as $lw) {
        if ($lw === '' || str_contains($skipIn, $lw) || preg_match($verbs, $lw)) {
            continue;
        }
        $ws = preg_split('/[\s\/\-]+/', $lw) ?: [];
        if (!array_filter($ws, fn($x) => !in_array($x, TL_STOP, true))) {
            continue;
        }
        foreach ($mm[0] as $w) {
            if (strtolower($w) === $lw) {
                $terms[] = $w;
                break;
            }
        }
        if (count($terms) >= 20) {
            break;
        }
    }
    return [
        'title' => mb_substr($title, 0, 120),
        'company' => mb_substr($company, 0, 120),
        'loc' => mb_substr($loc, 0, 120),
        'years' => $years,
        'skills' => $skills,
        'terms' => $terms,
        'reqs' => $reqs,
        'words' => mb_strlen($jd) ? str_word_count($jd) : 0,
        'text' => $jd,
    ];
}

/** The assistant reads the JD into modules: what the role is really made of (core stack, cloud, messaging, domain,
 *  seniority, constraints), each with its must-have / nice-to-have weight. Rules-only JDs get modules from skills. */
function tailorAiJd(array $jd): ?array
{
    if (!aiReady('tailor')) {
        return null;
    }
    $j = aiJson(
        'You analyze job descriptions for a staffing firm. Answer with one JSON object only.',
        "Break this job description into the modules a recruiter would screen for. Return JSON {\"title\":\"the job title\",\"seniority\":\"junior|mid|senior|lead|principal|manager\",\"domain\":\"industry or business domain, or empty\",\"modules\":[{\"t\":\"short module name, e.g. Backend Java / Spring Boot\",\"must\":true,\"req\":[\"the concrete requirements in it, in the JD's words\"],\"kw\":[\"keywords an ATS would look for\"]}],\"constraints\":[\"location, onsite/hybrid, visa, clearance, travel, duration\"],\"nice\":[\"nice-to-haves\"],\"summary\":\"two sentences on what this role really is\"}. 4-8 modules, most important first; must=false for nice-to-have modules.\n\nJOB DESCRIPTION:\n" . mb_substr($jd['text'], 0, 9000),
        2500
    );
    if (!$j || empty($j['modules']) || !is_array($j['modules'])) {
        return null;
    }
    $mods = [];
    foreach ($j['modules'] as $m) {
        $m = (array) $m;
        $t = mb_substr(trim((string) ($m['t'] ?? '')), 0, 80);
        if ($t === '') {
            continue;
        }
        $mods[] = ['t' => $t, 'must' => !isset($m['must']) || !empty($m['must']), 'req' => array_slice(array_values(array_filter(array_map(fn($x) => mb_substr(trim((string) $x), 0, 200), (array) ($m['req'] ?? [])))), 0, 8), 'kw' => array_slice(array_values(array_filter(array_map(fn($x) => mb_substr(trim((string) $x), 0, 60), (array) ($m['kw'] ?? [])))), 0, 12)];
    }
    if (!$mods) {
        return null;
    }
    return [
        'title' => mb_substr(trim((string) ($j['title'] ?? '')), 0, 120),
        'seniority' => mb_substr(trim((string) ($j['seniority'] ?? '')), 0, 20),
        'domain' => mb_substr(trim((string) ($j['domain'] ?? '')), 0, 80),
        'modules' => array_slice($mods, 0, 10),
        'constraints' => array_slice(array_values(array_filter(array_map(fn($x) => mb_substr(trim((string) $x), 0, 160), (array) ($j['constraints'] ?? [])))), 0, 8),
        'nice' => array_slice(array_values(array_filter(array_map(fn($x) => mb_substr(trim((string) $x), 0, 120), (array) ($j['nice'] ?? [])))), 0, 8),
        'summary' => mb_substr(trim((string) ($j['summary'] ?? '')), 0, 400),
    ];
}
/** Without the assistant: one module per group of the job's keywords. */
function tailorRuleModules(array $jd): array
{
    $mods = [];
    if ($jd['skills']) {
        $mods[] = ['t' => 'Core skills the JD names', 'must' => true, 'req' => [], 'kw' => array_slice($jd['skills'], 0, 12)];
    }
    if ($jd['terms']) {
        $mods[] = ['t' => 'Tools and platforms named', 'must' => false, 'req' => [], 'kw' => array_slice($jd['terms'], 0, 12)];
    }
    return ['title' => $jd['title'], 'seniority' => '', 'domain' => '', 'modules' => $mods, 'constraints' => [], 'nice' => [], 'summary' => ''];
}
/** Evidence per module from the tailored resume text (the assistant's own reading when it ran, else keyword hits). */
function tailorFitByKeywords(array $analysis, array $r): array
{
    $low = strtolower(tailorText($r));
    $out = [];
    foreach ($analysis['modules'] as $m) {
        $kws = $m['kw'];
        $hit = array_values(array_filter($kws, fn($k) => $k !== '' && str_contains($low, strtolower($k))));
        $ratio = $kws ? count($hit) / count($kws) : 0;
        $out[] = ['module' => $m['t'], 'must' => $m['must'], 'level' => $ratio >= 0.6 ? 'strong' : ($ratio > 0 ? 'partial' : 'none'), 'evidence' => $hit ? 'Mentions ' . implode(', ', array_slice($hit, 0, 6)) : 'Not evidenced', 'missing' => array_values(array_diff($kws, $hit))];
    }
    return $out;
}

/* ---------- the resume: text -> sections ---------- */
function tailorEmpty(): array
{
    return ['name' => '', 'title' => '', 'email' => '', 'phone' => '', 'loc' => '', 'linkedin' => '', 'auth' => '', 'summary' => '', 'hl' => [], 'skills' => [], 'experience' => [], 'education' => [], 'certs' => [], 'projects' => [], 'other' => []];
}
/** Rules-based parse: headings split the sections, date ranges split the jobs, bullets become bullets. */
function tailorParse(string $text): array
{
    $r = tailorEmpty();
    $lines = tlLines(mb_substr($text, 0, TL_MAX_RESUME));
    if (!$lines) {
        return $r;
    }
    // contact lines sit at the top; the name is the first short line without an @ or digits
    $head = array_slice($lines, 0, 8);
    $all = implode("\n", $lines);
    if (preg_match('/[\w.+\-]+@[\w\-]+\.[\w.\-]+/u', $all, $m)) {
        $r['email'] = strtolower($m[0]);
    }
    if (preg_match('/(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/', $all, $m)) {
        $r['phone'] = trim($m[0]);
    }
    if (preg_match('~(?:https?://)?(?:www\.)?linkedin\.com/in/[A-Za-z0-9_\-%]+/?~i', $all, $m)) {
        $r['linkedin'] = $m[0];
    }
    foreach ($head as $i => $l) {
        $plain = trim($l);
        if ($r['name'] === '' && !preg_match('/@|\d{3}|linkedin|http|resume|curriculum/i', $plain) && str_word_count($plain) <= 5 && mb_strlen($plain) <= 48 && !tlHeading($plain)) {
            $r['name'] = preg_replace('/\s*[|,]\s*$/', '', $plain) ?? $plain;
            continue;
        }
        if ($r['name'] !== '' && $r['title'] === '' && preg_match('/\b(?:' . TL_ROLE_WORDS . ')\b/i', $plain) && mb_strlen($plain) <= 120 && !preg_match('/@|\d{3}/', $plain) && !tlHeading($plain) && !tlDateRange($plain)) {
            // "Senior Medical Coder (CPC) · Houston, TX": keep the part with the role word
            $parts = array_values(array_filter(array_map('trim', preg_split('/\s+[·|•–—]\s+|\s{2,}/u', $plain) ?: [$plain])));
            foreach ($parts as $pt) {
                if (preg_match('/\b(?:' . TL_ROLE_WORDS . ')\b/i', $pt)) {
                    $r['title'] = mb_substr($pt, 0, 80);
                    break;
                }
            }
        }
    }
    if (preg_match('/\b(?:US Citizen|U\.S\. Citizen|Green Card|GC|H-?1B|H-?4 EAD|OPT|STEM OPT|EAD|TN|L-?1|E-?3|Permanent Resident)\b[^\n|,;]{0,30}/i', $all, $m)) {
        $r['auth'] = trim($m[0]);
    }
    $r['loc'] = resumeLocation($lines);
    // sections
    $sec = 'head';
    $buf = ['head' => []];
    foreach ($lines as $l) {
        $h = tlHeading($l);
        if ($h !== '') {
            $sec = $h;
            $buf[$sec] = $buf[$sec] ?? [];
            continue;
        }
        if ($sec === 'head' && tlDateRange($l)) {
            // no "Experience" heading at all: the first dated line starts it
            $sec = 'experience';
            $buf[$sec] = $buf[$sec] ?? [];
        }
        $buf[$sec][] = $l;
    }
    $joinWrapped = function (array $ls): array {
        $out = [];
        foreach ($ls as $l) {
            $t = trim($l);
            if ($out && !tlIsBullet($l) && preg_match('/^[a-z(]/', $t) && !tlDateRange($t)) {
                $out[count($out) - 1] .= ' ' . $t;
            } else {
                $out[] = $t;
            }
        }
        return $out;
    };
    // summary: the head lines that are sentences, plus the summary section
    $sumLines = [];
    $sumBul = [];
    foreach (array_merge($buf['head'] ?? [], $buf['summary'] ?? []) as $l) {
        $t = tlStripBullet($l);
        if ($t === $r['name'] || $t === $r['title'] || preg_match('/@|linkedin\.com|^\+?\(?\d/i', $t) || str_word_count($t) < 6) {
            continue;
        }
        if (tlIsBullet($l)) {
            $sumBul[] = $t;
        } else {
            $sumLines[] = $t;
        }
    }
    // v33: a summary written as 4+ bullet points stays bullet points
    if (count($sumBul) >= 4) {
        $r['hl'] = $sumBul;
    } else {
        $sumLines = array_merge($sumLines, $sumBul);
    }
    $r['summary'] = mb_substr(trim(implode(' ', $sumLines)), 0, 1500);
    // skills: "Group: a, b, c" lines, else a flat list
    foreach ($joinWrapped($buf['skills'] ?? []) as $l) {
        $t = tlStripBullet($l);
        $g = 'Skills';
        if (preg_match('/^([A-Za-z][A-Za-z &\/()+#.\-]{1,40})\s*[:\-–]\s+(.+)$/u', $t, $m) && !str_contains($m[1], ',')) {
            $g = trim($m[1]);
            $t = $m[2];
        }
        // commas inside brackets stay ("AWS (EC2, S3, Lambda)")
        $items = array_values(array_filter(array_map(fn($x) => trim($x, " \t.;"), preg_split('/\s*[,|•;]\s*(?![^()]*\))|\s{2,}|\s\/\s/u', $t) ?: []), fn($x) => $x !== '' && mb_strlen($x) <= 60));
        if (!$items) {
            continue;
        }
        $found = false;
        foreach ($r['skills'] as &$gr) {
            if (strcasecmp($gr['g'], $g) === 0) {
                $gr['items'] = array_values(array_unique(array_merge($gr['items'], $items)));
                $found = true;
            }
        }
        unset($gr);
        if (!$found) {
            $r['skills'][] = ['g' => $g, 'items' => $items];
        }
    }
    if (!$r['skills']) {
        $sk = skillsIn($text, 60);
        if ($sk) {
            $r['skills'][] = ['g' => 'Skills', 'items' => $sk];
        }
    }
    // experience: a dated header line opens a job; the title is the segment with a role word
    $exp = [];
    $cur = null;
    $pending = [];
    foreach ($joinWrapped($buf['experience'] ?? []) as $l) {
        $dr = tlDateRange($l);
        if ($dr && !tlIsBullet($l) && mb_strlen($l) <= 160) {
            if ($cur) {
                $exp[] = $cur;
            }
            $rest = trim(str_replace($dr[2], '', $l), " \t|,–-()");
            $segs = array_values(array_filter(array_map(fn($x) => trim($x, " \t,"), preg_split('/\s*(?:\||–|—|\s-\s|\bat\b|@)\s*/u', $rest) ?: []), fn($x) => $x !== ''));
            $cur = ['co' => '', 'ti' => '', 'loc' => '', 'from' => $dr[0], 'to' => $dr[1], 'bullets' => []];
            foreach ($segs as $s) {
                $isLoc = (bool) preg_match('/,\s*[A-Z]{2}\b|,\s*(?:USA|India|Canada|UK|Remote)\b|^remote\b/i', $s);
                if ($cur['ti'] === '' && !$isLoc && preg_match('/\b(?:' . TL_ROLE_WORDS . ')\b/i', $s)) {
                    $cur['ti'] = $s;
                } elseif ($cur['loc'] === '' && $isLoc) {
                    $cur['loc'] = $s;
                } elseif ($cur['co'] === '') {
                    $cur['co'] = $s;
                } elseif ($cur['loc'] === '') {
                    $cur['loc'] = $s;
                }
            }
            // the previous undated line (or the next one) carries the missing company/title
            foreach ($pending as $p) {
                if ($cur['ti'] === '' && preg_match('/\b(?:' . TL_ROLE_WORDS . ')\b/i', $p)) {
                    $cur['ti'] = $p;
                } elseif ($cur['co'] === '') {
                    $cur['co'] = $p;
                }
            }
            $pending = [];
            continue;
        }
        if (!$cur) {
            if (!tlIsBullet($l) && mb_strlen($l) <= 90) {
                $pending[] = trim($l);
            }
            continue;
        }
        $t = tlStripBullet($l);
        if (!tlIsBullet($l) && !$cur['bullets'] && mb_strlen($t) <= 90 && ($cur['ti'] === '' || $cur['co'] === '') && !preg_match('/[.!?]$/', $t)) {
            if ($cur['ti'] === '' && preg_match('/\b(?:' . TL_ROLE_WORDS . ')\b/i', $t)) {
                $cur['ti'] = $t;
                continue;
            }
            if ($cur['co'] === '') {
                $cur['co'] = $t;
                continue;
            }
        }
        // v33: "Environment: Java, Spring Boot, AWS" lines (the US IT staffing format) are kept apart from the bullets
        if (preg_match('/^(?:environment|tools(?: used)?|technologies(?: used)?|tech(?:nology)? stack)\s*[:\-–]\s*(.+)$/iu', $t, $em)) {
            $cur['env'] = trim(($cur['env'] ?? '') . ', ' . $em[1], ' ,');
            continue;
        }
        if (mb_strlen($t) >= 3) {
            $cur['bullets'][] = mb_substr($t, 0, 600);
        }
    }
    if ($cur) {
        $exp[] = $cur;
    }
    $r['experience'] = $exp;
    foreach ($joinWrapped($buf['education'] ?? []) as $l) {
        $t = tlStripBullet($l);
        if (mb_strlen($t) >= 4) {
            $r['education'][] = ['t' => mb_substr($t, 0, 200)];
        }
    }
    foreach ($joinWrapped($buf['certs'] ?? []) as $l) {
        foreach (preg_split('/\s*[|•;]\s*/u', tlStripBullet($l)) ?: [] as $c) {
            $c = trim($c);
            if (mb_strlen($c) >= 4) {
                $r['certs'][] = mb_substr($c, 0, 160);
            }
        }
    }
    $pt = null;
    foreach ($joinWrapped($buf['projects'] ?? []) as $l) {
        $t = tlStripBullet($l);
        if (!tlIsBullet($l) && mb_strlen($t) <= 90 && !preg_match('/[.]$/', $t)) {
            if ($pt) {
                $r['projects'][] = $pt;
            }
            $pt = ['t' => $t, 'd' => ''];
        } elseif ($pt) {
            $pt['d'] = trim($pt['d'] . ' ' . $t);
        } else {
            $pt = ['t' => mb_substr($t, 0, 80), 'd' => ''];
        }
    }
    if ($pt) {
        $r['projects'][] = $pt;
    }
    foreach ($joinWrapped($buf['other'] ?? []) as $l) {
        $t = tlStripBullet($l);
        if (mb_strlen($t) >= 4) {
            $r['other'][] = mb_substr($t, 0, 220);
        }
    }
    return tailorClean($r);
}
/** Types and limits for a resume structure coming from the parser, the assistant or the editor. */
function tailorClean($in): array
{
    $in = is_array($in) ? $in : (array) $in;
    $r = tailorEmpty();
    foreach (['name', 'title', 'email', 'phone', 'loc', 'linkedin', 'auth'] as $k) {
        $r[$k] = mb_substr(trim((string) ($in[$k] ?? '')), 0, 160);
    }
    $r['summary'] = mb_substr(trim((string) ($in['summary'] ?? '')), 0, 1800);
    foreach ((array) ($in['hl'] ?? []) as $x) {
        $x = mb_substr(trim(tlStripBullet((string) $x)), 0, 400);
        if ($x !== '' && !in_array($x, $r['hl'], true)) {
            $r['hl'][] = $x;
        }
    }
    $r['hl'] = array_slice($r['hl'], 0, 20);
    foreach ((array) ($in['skills'] ?? []) as $g) {
        $g = (array) $g;
        $items = [];
        foreach ((array) ($g['items'] ?? []) as $it) {
            $it = mb_substr(trim((string) $it), 0, 60);
            if ($it !== '' && !in_array($it, $items, true)) {
                $items[] = $it;
            }
        }
        if ($items) {
            $r['skills'][] = ['g' => mb_substr(trim((string) ($g['g'] ?? 'Skills')) ?: 'Skills', 0, 60), 'items' => array_slice($items, 0, 40)];
        }
    }
    $r['skills'] = array_slice($r['skills'], 0, 12);
    foreach ((array) ($in['experience'] ?? []) as $e) {
        $e = (array) $e;
        $bul = [];
        foreach ((array) ($e['bullets'] ?? []) as $x) {
            $x = mb_substr(trim((string) $x), 0, 600);
            if ($x !== '') {
                $bul[] = $x;
            }
        }
        $env = $e['env'] ?? '';
        $env = is_array($env) ? implode(', ', array_map(fn($x) => trim((string) $x), $env)) : (string) $env;
        $env = trim(preg_replace('/^(?:environment|tools|technologies)\s*[:\-–]\s*/i', '', trim($env)) ?? $env, " \t,.;");
        $row = ['co' => mb_substr(trim((string) ($e['co'] ?? '')), 0, 120), 'ti' => mb_substr(trim((string) ($e['ti'] ?? '')), 0, 120), 'loc' => mb_substr(trim((string) ($e['loc'] ?? '')), 0, 80), 'from' => mb_substr(trim((string) ($e['from'] ?? '')), 0, 24), 'to' => mb_substr(trim((string) ($e['to'] ?? '')), 0, 24), 'bullets' => array_slice($bul, 0, TL_MAX_BULLETS), 'env' => mb_substr($env, 0, 700)];
        if ($row['co'] !== '' || $row['ti'] !== '' || $row['bullets']) {
            $r['experience'][] = $row;
        }
    }
    $r['experience'] = array_slice($r['experience'], 0, 14);
    foreach ((array) ($in['education'] ?? []) as $e) {
        $t = is_array($e) || $e instanceof stdClass ? trim((string) (((array) $e)['t'] ?? implode(', ', array_filter([((array) $e)['deg'] ?? '', ((array) $e)['school'] ?? '', ((array) $e)['year'] ?? ''])))) : trim((string) $e);
        if ($t !== '') {
            $r['education'][] = ['t' => mb_substr($t, 0, 200)];
        }
    }
    foreach ((array) ($in['certs'] ?? []) as $c) {
        $c = mb_substr(trim((string) (is_array($c) || $c instanceof stdClass ? (((array) $c)['t'] ?? '') : $c)), 0, 160);
        if ($c !== '') {
            $r['certs'][] = $c;
        }
    }
    foreach ((array) ($in['projects'] ?? []) as $p) {
        $p = (array) $p;
        $t = mb_substr(trim((string) ($p['t'] ?? '')), 0, 120);
        if ($t !== '') {
            $r['projects'][] = ['t' => $t, 'd' => mb_substr(trim((string) ($p['d'] ?? '')), 0, 500)];
        }
    }
    foreach ((array) ($in['other'] ?? []) as $o) {
        $o = mb_substr(trim((string) $o), 0, 220);
        if ($o !== '') {
            $r['other'][] = $o;
        }
    }
    return $r;
}
/** The resume as plain text (what an ATS reads), used for scoring and the preview. */
function tailorText(array $r): string
{
    $out = [trim($r['name'] . ' ' . $r['title']), trim(implode(' | ', array_filter([$r['email'], $r['phone'], $r['loc'], $r['linkedin'], $r['auth']])))];
    if ($r['summary'] !== '' || !empty($r['hl'])) {
        $out[] = trim("SUMMARY\n" . $r['summary'] . "\n" . implode("\n", array_map(fn($b) => '- ' . $b, $r['hl'] ?? [])));
    }
    if ($r['skills']) {
        $out[] = "SKILLS\n" . implode("\n", array_map(fn($g) => $g['g'] . ': ' . implode(', ', $g['items']), $r['skills']));
    }
    if ($r['experience']) {
        $out[] = "EXPERIENCE\n" . implode("\n", array_map(fn($e) => trim($e['ti'] . ' | ' . $e['co'] . ' | ' . $e['loc'] . ' | ' . $e['from'] . ' - ' . $e['to']) . "\n" . implode("\n", array_map(fn($b) => '- ' . $b, $e['bullets'])) . (($e['env'] ?? '') !== '' ? "\nEnvironment: " . $e['env'] : ''), $r['experience']));
    }
    if ($r['education']) {
        $out[] = "EDUCATION\n" . implode("\n", array_column($r['education'], 't'));
    }
    if ($r['certs']) {
        $out[] = "CERTIFICATIONS\n" . implode("\n", $r['certs']);
    }
    if ($r['projects']) {
        $out[] = "PROJECTS\n" . implode("\n", array_map(fn($p) => $p['t'] . ': ' . $p['d'], $r['projects']));
    }
    if ($r['other']) {
        $out[] = implode("\n", $r['other']);
    }
    return implode("\n\n", $out);
}

/* ---------- the assistant ---------- */
const TL_SCHEMA = '{"name":"","title":"","email":"","phone":"","loc":"City, ST","linkedin":"","auth":"work authorization if stated","summary":"","hl":["summary bullet points (only when asked for, or when the resume has them)"],"skills":[{"g":"group name","items":["skill"]}],"experience":[{"co":"employer","ti":"job title","loc":"","from":"Mon YYYY","to":"Mon YYYY or Present","bullets":["..."],"env":"Environment: the tools this job used, comma-separated (only when asked for, or when the resume has it)"}],"education":[{"t":"degree, school, year"}],"certs":["..."],"projects":[{"t":"","d":""}],"other":["awards, publications, languages"]}';
function tailorAiParse(string $text): ?array
{
    if (!aiReady('tailor')) {
        return null;
    }
    $j = aiJson(
        'You convert resumes into JSON for a staffing firm. Copy facts exactly; never add, infer or drop employers, titles, dates, degrees or certifications. Answer with one JSON object only.',
        "Return this JSON shape with the resume's content: " . TL_SCHEMA . "\nKeep every bullet (lightly trimmed of leading symbols). Group skills the way the resume does, or by type when it lists them flat.\n\nRESUME:\n" . mb_substr($text, 0, TL_MAX_RESUME),
        6000
    );
    if (!$j || empty($j['experience']) && empty($j['summary']) && empty($j['skills'])) {
        return null;
    }
    return tailorClean($j);
}
/** The rewrite. Returns ['resume'=>..., 'gaps'=>[], 'changes'=>[], 'added'=>[]] or null when the assistant is not set up or fails. */
function tailorAiRewrite(array $orig, array $jd, string $origText, ?array $analysis = null, int $pages = 0): ?array
{
    if (!aiReady('tailor')) {
        return null;
    }
    $rules = "RULES (never break them):\n" .
        "1. Keep every employer, job title, location and date range exactly as given, in the same order; do not add or remove jobs.\n" .
        "2. Keep education, certifications, name and contact details exactly; never invent degrees, certifications, employers, clients, dates, team sizes or numbers. Metrics may stay only if the original states them.\n" .
        "3. Rewrite freely otherwise: mirror the job description's wording and priorities, lead each bullet with a strong verb, put the most relevant bullets first, write a 3-4 line summary that uses the job title and the top requirements, and build a Core Skills section ordered by the job's priorities (job keywords first, then the rest of the person's skills).\n" .
        "4. A tool or skill from the job description may be added to a bullet or to the skills only when the original resume shows the person used it or a closely related one (say the related one too). List every keyword you introduced that the original never mentioned in \"added\" so a recruiter can confirm it with the person.\n" .
        "5. Plain text only: no markdown, no tables, no icons. Bullets 1-2 lines. Standard American spelling. " . tailorLengthRule($pages) . "\n" .
        "6. Return JSON only: {\"resume\": " . TL_SCHEMA . ", \"gaps\": [\"job requirements the resume does not evidence\"], \"changes\": [\"what you changed, 4-8 short lines\"], \"added\": [\"keyword\"], \"fit\": [{\"module\": \"module name from the list\", \"level\": \"strong|partial|none\", \"evidence\": \"one line: where the resume shows it, or what is missing\"}]}";
    $modText = '';
    if ($analysis && !empty($analysis['modules'])) {
        $modText = "\n\nMODULES TO SCREEN FOR (rate each in \"fit\"):\n" . implode("\n", array_map(fn($m) => '- ' . $m['t'] . ($m['must'] ? ' (must-have)' : ' (nice-to-have)') . ': ' . implode('; ', array_merge($m['req'], $m['kw'])), $analysis['modules']));
    }
    $prompt = "JOB TITLE: " . ($jd['title'] ?: '(not stated)') . "\nCOMPANY: " . ($jd['company'] ?: '(not stated)') . "\nJOB KEYWORDS: " . implode(', ', array_merge($jd['skills'], $jd['terms'])) . $modText . "\n\nJOB DESCRIPTION:\n" . mb_substr($jd['text'], 0, 9000) .
        "\n\nORIGINAL RESUME (JSON):\n" . json_encode($orig, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) .
        "\n\nORIGINAL RESUME (TEXT, for anything the JSON missed):\n" . mb_substr($origText, 0, 9000) . "\n\n" . $rules;
    $j = aiJson('You are an expert technical recruiter and resume writer who tailors resumes to job descriptions for applicant tracking systems without ever misrepresenting the candidate. Answer with one JSON object only.', $prompt, 7000);
    if (!$j || empty($j['resume'])) {
        return null;
    }
    $fit = [];
    foreach ((array) ($j['fit'] ?? []) as $f) {
        $f = (array) $f;
        $mod = mb_substr(trim((string) ($f['module'] ?? '')), 0, 80);
        if ($mod === '') {
            continue;
        }
        $lvl = strtolower(trim((string) ($f['level'] ?? '')));
        $must = true;
        foreach ((array) ($analysis['modules'] ?? []) as $m) {
            if (strcasecmp($m['t'], $mod) === 0) {
                $must = $m['must'];
            }
        }
        $fit[] = ['module' => $mod, 'must' => $must, 'level' => in_array($lvl, ['strong', 'partial', 'none'], true) ? $lvl : 'partial', 'evidence' => mb_substr(trim((string) ($f['evidence'] ?? '')), 0, 240)];
    }
    return [
        'fit' => array_slice($fit, 0, 10),
        'resume' => tailorClean($j['resume']),
        'gaps' => array_slice(array_values(array_filter(array_map(fn($x) => mb_substr(trim((string) $x), 0, 200), (array) ($j['gaps'] ?? [])))), 0, 12),
        'changes' => array_slice(array_values(array_filter(array_map(fn($x) => mb_substr(trim((string) $x), 0, 220), (array) ($j['changes'] ?? [])))), 0, 10),
        'added' => array_slice(array_values(array_filter(array_map(fn($x) => mb_substr(trim((string) $x), 0, 60), (array) ($j['added'] ?? [])))), 0, 30),
    ];
}
/** v32: what the assistant is told about the length (the files are fitted to the pages afterwards either way). */
function tailorLengthRule(int $pages): string
{
    return match (true) {
        $pages === 1 => 'LENGTH: it must fit on ONE page: a 2-3 line summary, one skills block with the 20-25 most relevant skills, at most 4 bullets for the latest job, 3 for the one before and 1-2 for older ones; keep every job (title, employer, dates). Leave "hl" and every "env" empty.',
        $pages === 2 => 'LENGTH: two pages at most: a 3-4 line summary, at most 6 bullets for the two latest jobs and 3 for older ones. Leave "hl" empty; keep an "env" only when the original has one.',
        $pages === 3 => 'LENGTH: up to three pages: keep the relevant detail, at most 8 bullets per recent job and 4 per older job; at most 6 "hl" bullets; an "env" line per job listing the tools the resume shows for that job.',
        $pages >= 4 => 'LENGTH: this resume needs ' . $pages . ' pages in the US IT staffing format: a 2-3 line summary plus 8-12 "hl" summary bullets, Core Skills as label: value groups, and for every job 8-12 bullets (most relevant first) and an "env" line listing the tools the resume shows for that job. More detail per job is added in a second pass, so do not pad or repeat.',
        default => 'At most 8 bullets per recent job and 4 per older job. Keep "hl" and "env" only when the original resume has them.',
    };
}
/** Rules-based rewrite when no assistant answers: the job title on top, a summary that names the shared skills,
 *  skills reordered with the job's keywords first, bullets reordered by keyword hits. Nothing is invented. */
function tailorRules(array $orig, array $jd, string $origText): array
{
    $r = $orig;
    $have = skillsIn($origText, 80);
    $haveLow = array_map('strtolower', $have);
    $shared = array_values(array_filter($jd['skills'], fn($s) => in_array(strtolower($s), $haveLow, true)));
    $changes = [];
    if ($jd['title'] !== '') {
        // the job title without its bracketed or slashed skill list ("Senior Java Engineer (Kafka / Kubernetes)")
        $plain = trim(preg_replace('/\s*[(\[].*$|\s+[-–—\/]\s+.*$/u', '', $jd['title']) ?? $jd['title']);
        $tt = array_diff(jtok($plain), JOB_NEUTRAL_TOKENS);
        $rt = array_diff(jtok($r['title'] . ' ' . ($r['experience'][0]['ti'] ?? '')), JOB_NEUTRAL_TOKENS);
        if ($plain !== '' && $tt && array_intersect($tt, $rt)) {
            $r['title'] = $plain;
            $changes[] = 'Headline set to the job title (' . $plain . ').';
        }
    }
    $years = resumeYears($origText);
    $lead = $r['title'] !== '' ? $r['title'] : ($jd['title'] ?: 'Professional');
    $sum = $lead . ($years ? ' with ' . $years . '+ years of experience' : '') . ($shared ? ' in ' . implode(', ', array_slice($shared, 0, 5)) : '') . '.';
    if ($r['summary'] !== '') {
        $first = preg_split('/(?<=[.!?])\s+/', $r['summary'], 3) ?: [$r['summary']];
        $sum .= ' ' . implode(' ', array_slice($first, 0, 2));
    }
    $r['summary'] = mb_substr(trim($sum), 0, 1200);
    $changes[] = 'Summary rewritten around the role' . ($shared ? ' and the skills the job asks for that the resume already shows (' . implode(', ', array_slice($shared, 0, 4)) . ')' : '') . '.';
    // skills: job keywords first, inside each group; a Core Skills group on top with the shared ones
    $jdLow = array_map('strtolower', array_merge($jd['skills'], $jd['terms']));
    foreach ($r['skills'] as &$g) {
        usort($g['items'], fn($a, $b) => (int) in_array(strtolower($b), $jdLow, true) - (int) in_array(strtolower($a), $jdLow, true));
    }
    unset($g);
    if ($shared) {
        array_unshift($r['skills'], ['g' => 'Core skills', 'items' => array_slice($shared, 0, 16)]);
        $changes[] = 'Core skills section added with the job\'s keywords the resume evidences.';
    }
    // bullets: the ones that hit job keywords first (stable), untouched text
    $hits = function (string $b) use ($jdLow): int {
        $n = 0;
        $lb = strtolower($b);
        foreach ($jdLow as $k) {
            if ($k !== '' && str_contains($lb, $k)) {
                $n++;
            }
        }
        return $n;
    };
    $moved = 0;
    foreach ($r['experience'] as &$e) {
        $idx = array_keys($e['bullets']);
        $scored = array_map(fn($i) => [$hits($e['bullets'][$i]), -$i, $e['bullets'][$i]], $idx);
        usort($scored, fn($a, $b) => $b[0] <=> $a[0] ?: $b[1] <=> $a[1]);
        $new = array_column($scored, 2);
        if ($new !== $e['bullets']) {
            $moved++;
        }
        $e['bullets'] = $new;
    }
    unset($e);
    if ($moved) {
        $changes[] = 'Bullets reordered so the ones matching the job come first (' . $moved . ' job' . ($moved === 1 ? '' : 's') . ').';
    }
    $missing = array_values(array_filter($jd['skills'], fn($s) => !in_array(strtolower($s), $haveLow, true)));
    return ['resume' => tailorClean($r), 'gaps' => array_slice($missing, 0, 12), 'changes' => $changes, 'added' => [], 'fit' => []];
}
/** Employers, titles, dates, education, certifications and contact details come back from the original; whatever
 *  the rewrite introduced that the original never mentioned is listed. */
function tailorGuard(array $orig, array $out, string $origText): array
{
    $flags = [];
    foreach (['name', 'email', 'phone', 'linkedin'] as $k) {
        if ($orig[$k] !== '') {
            $out[$k] = $orig[$k];
        }
    }
    if ($orig['loc'] !== '' && $out['loc'] === '') {
        $out['loc'] = $orig['loc'];
    }
    if ($orig['auth'] !== '') {
        $out['auth'] = $orig['auth'];
    }
    $origLowAll = strtolower($origText . ' ' . tailorText($orig));
    $envDropped = [];
    if ($orig['experience']) {
        // line the rewritten jobs up with the original ones: same dates first, then a similar employer name, then the
        // same position when the count did not change; the original's employer, title, place and dates always win
        $key = fn(string $s) => strtolower(preg_replace('/\b(?:inc|llc|ltd|corp|corporation|co|company|pvt|limited|plc|gmbh)\b|\W+/i', '', $s) ?? $s);
        $dk = fn(array $e) => strtolower(preg_replace('/\W+/', '', $e['from'] . '|' . $e['to']) ?? '');
        $avail = $out['experience'];
        $taken = [];
        $n = count($orig['experience']);
        if (count($avail) !== $n) {
            $flags[] = 'The rewrite had ' . count($avail) . ' jobs instead of ' . $n . '; every original job was kept and the rewritten bullets were matched by dates and employer.';
        }
        $rebuilt = [];
        foreach ($orig['experience'] as $i => $oe) {
            $m = null;
            foreach ($avail as $j => $ae) {
                if (!isset($taken[$j]) && $oe['from'] !== '' && $dk($ae) === $dk($oe)) {
                    $m = $j;
                    break;
                }
            }
            if ($m === null) {
                $ok = $key($oe['co']);
                foreach ($avail as $j => $ae) {
                    $ak = $key($ae['co']);
                    if (!isset($taken[$j]) && $ok !== '' && $ak !== '' && (str_contains($ak, $ok) || str_contains($ok, $ak))) {
                        $m = $j;
                        break;
                    }
                }
            }
            if ($m === null && count($avail) === $n && !isset($taken[$i])) {
                $m = $i;
            }
            $ae = $m !== null ? $avail[$m] : null;
            if ($m !== null) {
                $taken[$m] = true;
            }
            $row = $oe;
            if ($ae && $ae['bullets']) {
                $row['bullets'] = $ae['bullets'];
            }
            // v33: an Environment line keeps only tools the original resume mentions
            if ($ae && ($ae['env'] ?? '') !== '') {
                [$keepEnv, $gone] = tailorEnvKeep($ae['env'], $origLowAll);
                if ($keepEnv !== '') {
                    $row['env'] = $keepEnv;
                }
                $envDropped = array_merge($envDropped, $gone);
            }
            if ($ae && $oe['ti'] !== '' && $ae['ti'] !== '' && strcasecmp(trim($ae['ti']), trim($oe['ti'])) !== 0) {
                $flags[] = 'Title at ' . ($oe['co'] ?: 'job ' . ($i + 1)) . ' kept as "' . $oe['ti'] . '" (the rewrite had "' . $ae['ti'] . '").';
            }
            if ($ae && $oe['co'] !== '' && $ae['co'] !== '' && $key($ae['co']) !== $key($oe['co'])) {
                $flags[] = 'Employer kept as "' . $oe['co'] . '" (the rewrite had "' . $ae['co'] . '").';
            }
            $rebuilt[] = $row;
        }
        $out['experience'] = $rebuilt;
    }
    if ($envDropped) {
        $flags[] = 'Environment lines keep only tools the original resume mentions (left out: ' . implode(', ', array_slice(array_values(array_unique($envDropped)), 0, 8)) . ').';
    }
    $origCerts = array_map('strtolower', $orig['certs']);
    foreach ($out['certs'] as $c) {
        if (!in_array(strtolower($c), $origCerts, true)) {
            $flags[] = 'Certification "' . $c . '" is not on the original resume and was left out.';
        }
    }
    if ($orig['education']) {
        $out['education'] = $orig['education'];
    }
    if ($orig['certs']) {
        $out['certs'] = $orig['certs'];
    }
    // keywords in the result that the original never mentioned (dictionary skills, plus the job's named terms)
    $origLow = strtolower($origText . ' ' . tailorText($orig));
    $origSk = array_map('strtolower', skillsIn($origText . "\n" . tailorText($orig), 160));
    $added = [];
    foreach (skillsIn(tailorText($out), 160) as $s) {
        if (!in_array(strtolower($s), $origSk, true) && !str_contains($origLow, strtolower($s)) && !in_array($s, $added, true)) {
            $added[] = $s;
        }
    }
    return [tailorClean($out), $added, $flags];
}

/** v33: the tools of an Environment line that the original resume mentions; returns [line, left out]. */
function tailorEnvKeep(string $env, string $origLow): array
{
    $keep = [];
    $gone = [];
    foreach (preg_split('/\s*[,;|]\s*(?![^()]*\))/', $env) ?: [] as $t) {
        $t = trim($t, " \t.");
        if ($t === '' || mb_strlen($t) > 60) {
            continue;
        }
        // "AWS (EC2, S3)" counts when "AWS" is there; "Spring Boot 3" when "spring boot" is
        $core = strtolower(trim(preg_replace('/\s*\(.*\)$|\s+v?\d+(?:\.\d+)*$/', '', $t) ?? $t));
        if ($core !== '' && (str_contains($origLow, $core) || str_contains($origLow, strtolower($t)))) {
            if (!in_array($t, $keep, true)) {
                $keep[] = $t;
            }
        } else {
            $gone[] = $t;
        }
    }
    return [implode(', ', $keep), $gone];
}

/* ---------- the ATS score ---------- */
function tailorScore(array $r, array $jd): array
{
    $text = tailorText($r);
    $low = strtolower($text);
    $have = [];
    $missing = [];
    foreach ($jd['skills'] as $s) {
        if (str_contains($low, strtolower($s))) {
            $have[] = $s;
        } else {
            $missing[] = $s;
        }
    }
    $termsHave = [];
    $termsMissing = [];
    foreach ($jd['terms'] as $t) {
        if (str_contains($low, strtolower($t))) {
            $termsHave[] = $t;
        } else {
            $termsMissing[] = $t;
        }
    }
    $nk = count($jd['skills']);
    $kw = $nk ? count($have) / max(1, min($nk, 15)) : 1.0;
    $kw = min(1.0, $kw);
    $nt = count($jd['terms']);
    $tm = $nt ? min(1.0, count($termsHave) / max(1, min($nt, 10))) : 1.0;
    // title
    $tt = array_values(array_diff(jtok($jd['title']), JOB_NEUTRAL_TOKENS));
    $rt = array_values(array_diff(jtok($r['title'] . ' ' . mb_substr($r['summary'], 0, 300) . ' ' . ($r['experience'][0]['ti'] ?? '')), JOB_NEUTRAL_TOKENS));
    $title = $tt ? count(array_intersect($tt, $rt)) / count($tt) : 1.0;
    // years
    $years = resumeYears($text);
    $yr = $jd['years'] ? ($years === null ? 0.5 : min(1.0, $years / $jd['years'])) : 1.0;
    // requirement lines: a line is met when most of its content words appear
    $reqs = [];
    $met = 0;
    foreach ($jd['reqs'] as $line) {
        $w = array_values(array_unique(tlWords($line)));
        $w = array_slice($w, 0, 12);
        $hit = 0;
        foreach ($w as $x) {
            if (str_contains($low, $x)) {
                $hit++;
            }
        }
        $ok = $w ? $hit / count($w) >= 0.6 : false;
        if ($ok) {
            $met++;
        }
        $reqs[] = ['t' => $line, 'ok' => $ok];
    }
    $rq = $jd['reqs'] ? $met / count($jd['reqs']) : 1.0;
    // format checks
    $words = str_word_count($text);
    $checks = [
        ['t' => 'Email and phone on the resume', 'ok' => $r['email'] !== '' && $r['phone'] !== ''],
        ['t' => 'Professional summary', 'ok' => mb_strlen($r['summary']) >= 80],
        ['t' => 'Skills section', 'ok' => (bool) $r['skills']],
        ['t' => 'Every job has a title, employer and dates', 'ok' => $r['experience'] && !array_filter($r['experience'], fn($e) => $e['co'] === '' || $e['ti'] === '' || $e['from'] === '')],
        ['t' => 'Bullets on the recent jobs', 'ok' => $r['experience'] && count($r['experience'][0]['bullets']) >= 3],
        ['t' => 'Education listed', 'ok' => (bool) $r['education']],
        ['t' => 'Length ' . $words . ' words (400-1,100 reads best)', 'ok' => $words >= 350 && $words <= 1200],
        ['t' => 'Job title in the headline or summary', 'ok' => $title >= 0.5],
    ];
    $fmt = count(array_filter($checks, fn($c) => $c['ok'])) / count($checks);
    $score = (int) round($kw * 40 + $tm * 10 + $title * 12 + $yr * 8 + $rq * 20 + $fmt * 10);
    return [
        'score' => max(0, min(100, $score)),
        'kw' => ['have' => $have, 'missing' => $missing],
        'terms' => ['have' => $termsHave, 'missing' => $termsMissing],
        'title' => ['ok' => $title >= 0.5, 'v' => round($title, 2), 'jd' => $jd['title']],
        'years' => ['need' => $jd['years'], 'have' => $years],
        'reqs' => $reqs,
        'checks' => $checks,
        'words' => $words,
    ];
}

/* ---------- DOCX: one column, real headings, real bullets, Calibri - what parsers read best ---------- */
function tlx(string $s): string
{
    return htmlspecialchars(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', '', $s) ?? $s, ENT_XML1 | ENT_QUOTES, 'UTF-8');
}
function tlRun(string $text, bool $bold = false, int $halfPts = 22, string $color = ''): string
{
    $pr = '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>' . ($bold ? '<w:b/>' : '') . ($color !== '' ? '<w:color w:val="' . $color . '"/>' : '') . '<w:sz w:val="' . $halfPts . '"/><w:szCs w:val="' . $halfPts . '"/></w:rPr>';
    return '<w:r>' . $pr . '<w:t xml:space="preserve">' . tlx($text) . '</w:t></w:r>';
}
function tlPara(string $runs, string $style = '', int $after = 60, string $extra = ''): string
{
    return '<w:p><w:pPr>' . ($style !== '' ? '<w:pStyle w:val="' . $style . '"/>' : '') . $extra . '<w:spacing w:after="' . $after . '" w:line="264" w:lineRule="auto"/></w:pPr>' . $runs . '</w:p>';
}
function tailorDocx(array $r, array $o = []): string
{
    // v32: $o['s'] scales type and spacing, $o['m'] the margins (the same choices that make the PDF fit its pages)
    $s = max(0.8, min(1.12, (float) ($o['s'] ?? 1.0)));
    $mf = max(0.65, min(1.0, (float) ($o['m'] ?? 1.0)));
    $z = fn(int $v) => (int) max(1, round($v * $s));
    $body = [];
    $body[] = tlPara(tlRun($r['name'] !== '' ? $r['name'] : 'Resume', true, $z(34)), '', $z(20), '<w:jc w:val="center"/>');
    if ($r['title'] !== '') {
        $body[] = tlPara(tlRun($r['title'], false, $z(24), '1F3B73'), '', $z(20), '<w:jc w:val="center"/>');
    }
    $contact = array_values(array_filter([$r['email'], $r['phone'], $r['loc'], $r['linkedin'], $r['auth']]));
    if ($contact) {
        $body[] = tlPara(tlRun(implode('  |  ', $contact), false, $z(20)), '', $z(160), '<w:jc w:val="center"/>');
    }
    $heading = fn(string $t) => '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="1F3B73"/></w:pBdr><w:spacing w:before="' . $z(200) . '" w:after="' . $z(80) . '"/></w:pPr>' . tlRun(mb_strtoupper($t), true, $z(22), '1F3B73') . '</w:p>';
    $bullet = fn(string $t) => '<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:spacing w:after="' . $z(40) . '" w:line="259" w:lineRule="auto"/><w:ind w:left="360" w:hanging="360"/></w:pPr>' . tlRun($t, false, $z(22)) . '</w:p>';
    if ($r['summary'] !== '' || !empty($r['hl'])) {
        $body[] = $heading('Professional Summary');
        if ($r['summary'] !== '') {
            $body[] = tlPara(tlRun($r['summary'], false, $z(22)), '', $z(80));
        }
        foreach ($r['hl'] ?? [] as $h) {
            $body[] = $bullet($h);
        }
    }
    if ($r['skills']) {
        $body[] = $heading('Core Skills');
        foreach ($r['skills'] as $g) {
            $body[] = tlPara(tlRun($g['g'] . ': ', true, $z(22)) . tlRun(implode(', ', $g['items']), false, $z(22)), '', $z(40));
        }
    }
    if ($r['experience']) {
        $body[] = $heading('Professional Experience');
        foreach ($r['experience'] as $e) {
            $dates = trim($e['from'] . ($e['to'] !== '' ? ' – ' . $e['to'] : ''));
            $body[] = '<w:p><w:pPr><w:keepNext/><w:tabs><w:tab w:val="right" w:pos="' . (int) round(12240 - 2 * 1080 * $mf) . '"/></w:tabs><w:spacing w:before="' . $z(120) . '" w:after="0"/></w:pPr>' . tlRun($e['ti'] !== '' ? $e['ti'] : 'Role', true, $z(22)) . ($dates !== '' ? '<w:r><w:tab/></w:r>' . tlRun($dates, false, $z(20)) : '') . '</w:p>';
            $line2 = trim($e['co'] . ($e['loc'] !== '' ? ' — ' . $e['loc'] : ''));
            if ($line2 !== '') {
                $body[] = tlPara(tlRun($line2, false, $z(22), '444444'), '', $z(40), '<w:keepNext/>');
            }
            foreach ($e['bullets'] as $b) {
                $body[] = $bullet($b);
            }
            if (($e['env'] ?? '') !== '') {
                $body[] = tlPara(tlRun('Environment: ', true, $z(22)) . tlRun($e['env'], false, $z(22)), '', $z(60), '<w:spacing w:before="' . $z(40) . '"/>');
            }
        }
    }
    if ($r['projects']) {
        $body[] = $heading('Projects');
        foreach ($r['projects'] as $p) {
            $body[] = tlPara(tlRun($p['t'], true, $z(22)) . ($p['d'] !== '' ? tlRun(' — ' . $p['d'], false, $z(22)) : ''), '', $z(40));
        }
    }
    if ($r['education']) {
        $body[] = $heading('Education');
        foreach ($r['education'] as $e) {
            $body[] = tlPara(tlRun($e['t'], false, $z(22)), '', $z(40));
        }
    }
    if ($r['certs']) {
        $body[] = $heading('Certifications');
        foreach ($r['certs'] as $c) {
            $body[] = $bullet($c);
        }
    }
    if ($r['other']) {
        $body[] = $heading('Additional');
        foreach ($r['other'] as $ot) {
            $body[] = tlPara(tlRun($ot, false, $z(22)), '', $z(40));
        }
    }
    $document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' .
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>' .
        implode('', $body) .
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="' . (int) round(1008 * $mf) . '" w:right="' . (int) round(1080 * $mf) . '" w:bottom="' . (int) round(1008 * $mf) . '" w:left="' . (int) round(1080 * $mf) . '" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>';
    $styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' .
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' .
        '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' .
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' .
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3B73"/><w:sz w:val="22"/></w:rPr></w:style>' .
        '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>' .
        '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:sz w:val="34"/></w:rPr></w:style>' .
        '</w:styles>';
    $numbering = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' .
        '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' .
        '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#8226;"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:hint="default"/></w:rPr></w:lvl></w:abstractNum>' .
        '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';
    $contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' .
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' .
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' .
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' .
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' .
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' .
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>';
    $rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' .
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>';
    $docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' .
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>';
    $now = gmdate('Y-m-d\TH:i:s\Z');
    $core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' .
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' . tlx(trim($r['name'] . ' - ' . $r['title'])) . '</dc:title><dc:creator>' . tlx($r['name']) . '</dc:creator><cp:lastModifiedBy>' . tlx($r['name']) . '</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">' . $now . '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' . $now . '</dcterms:modified></cp:coreProperties>';
    $app = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Office Word</Application></Properties>';
    $tmp = tempnam(sys_get_temp_dir(), 'tlx');
    $z = new ZipArchive();
    if ($z->open($tmp, ZipArchive::OVERWRITE) !== true) {
        fail(500, 'unavailable', 'The server could not write the Word file (zip).');
    }
    $z->addFromString('[Content_Types].xml', $contentTypes);
    $z->addFromString('_rels/.rels', $rels);
    $z->addFromString('word/document.xml', $document);
    $z->addFromString('word/styles.xml', $styles);
    $z->addFromString('word/numbering.xml', $numbering);
    $z->addFromString('word/_rels/document.xml.rels', $docRels);
    $z->addFromString('docProps/core.xml', $core);
    $z->addFromString('docProps/app.xml', $app);
    $z->close();
    $bytes = (string) file_get_contents($tmp);
    @unlink($tmp);
    return $bytes;
}

/* ---------- PDF: Helvetica, one column, text only (selectable, parsable) ---------- */
const TL_HELV = [32=>278,33=>278,34=>355,35=>556,36=>556,37=>889,38=>667,39=>191,40=>333,41=>333,42=>389,43=>584,44=>278,45=>333,46=>278,47=>278,48=>556,49=>556,50=>556,51=>556,52=>556,53=>556,54=>556,55=>556,56=>556,57=>556,58=>278,59=>278,60=>584,61=>584,62=>584,63=>556,64=>1015,65=>667,66=>667,67=>722,68=>722,69=>667,70=>611,71=>778,72=>722,73=>278,74=>500,75=>667,76=>556,77=>833,78=>722,79=>778,80=>667,81=>778,82=>722,83=>667,84=>611,85=>722,86=>667,87=>944,88=>667,89=>667,90=>611,91=>278,92=>278,93=>278,94=>469,95=>556,96=>333,97=>556,98=>556,99=>500,100=>556,101=>556,102=>278,103=>556,104=>556,105=>222,106=>222,107=>500,108=>222,109=>833,110=>556,111=>556,112=>556,113=>556,114=>333,115=>500,116=>278,117=>556,118=>500,119=>722,120=>500,121=>500,122=>500,123=>334,124=>260,125=>334,126=>584,149=>350,150=>556,151=>1000];
const TL_HELV_B = [32=>278,33=>333,34=>474,35=>556,36=>556,37=>889,38=>722,39=>238,40=>333,41=>333,42=>389,43=>584,44=>278,45=>333,46=>278,47=>278,48=>556,49=>556,50=>556,51=>556,52=>556,53=>556,54=>556,55=>556,56=>556,57=>556,58=>333,59=>333,60=>584,61=>584,62=>584,63=>611,64=>975,65=>722,66=>722,67=>722,68=>722,69=>667,70=>611,71=>778,72=>722,73=>278,74=>556,75=>722,76=>611,77=>833,78=>722,79=>778,80=>667,81=>778,82=>722,83=>667,84=>611,85=>722,86=>667,87=>944,88=>667,89=>667,90=>611,91=>333,92=>278,93=>333,94=>584,95=>556,96=>333,97=>556,98=>611,99=>556,100=>611,101=>556,102=>333,103=>611,104=>611,105=>278,106=>278,107=>556,108=>278,109=>889,110=>611,111=>611,112=>611,113=>611,114=>389,115=>556,116=>333,117=>611,118=>556,119=>778,120=>556,121=>556,122=>500,123=>389,124=>280,125=>389,126=>584,149=>350,150=>556,151=>1000];
function tlPdfText(string $s): string
{
    $s = str_replace(["\u{2013}", "\u{2014}", "\u{2022}", "\u{2018}", "\u{2019}", "\u{201C}", "\u{201D}", "\u{00A0}"], ['-', '-', "\u{2022}", "'", "'", '"', '"', ' '], $s);
    $c = @iconv('UTF-8', 'Windows-1252//TRANSLIT//IGNORE', $s);
    if ($c === false) {
        $c = preg_replace('/[^\x20-\x7E]/', '', $s) ?? '';
    }
    return $c;
}
function tlPdfWidth(string $cp1252, float $size, bool $bold): float
{
    $w = 0;
    $tbl = $bold ? TL_HELV_B : TL_HELV;
    $n = strlen($cp1252);
    for ($i = 0; $i < $n; $i++) {
        $w += $tbl[ord($cp1252[$i])] ?? 556;
    }
    return $w * $size / 1000;
}
function tlPdfWrap(string $text, float $size, bool $bold, float $maxW): array
{
    $words = preg_split('/\s+/', trim(tlPdfText($text))) ?: [];
    $lines = [];
    $cur = '';
    foreach ($words as $w) {
        $try = $cur === '' ? $w : $cur . ' ' . $w;
        if ($cur !== '' && tlPdfWidth($try, $size, $bold) > $maxW) {
            $lines[] = $cur;
            $cur = $w;
        } else {
            $cur = $try;
        }
    }
    if ($cur !== '') {
        $lines[] = $cur;
    }
    return $lines;
}
function tlPdfEsc(string $cp): string
{
    return str_replace(['\\', '(', ')', "\r", "\n"], ['\\\\', '\\(', '\\)', '', ' '], $cp);
}
function tailorPdf(array $r, array $o = []): string
{
    return tailorPdfBuild($r, $o)['pdf'];
}
/** v32: $o['s'] scales type and spacing, $o['m'] the margins (to fit a page count); returns the PDF and its pages. */
function tailorPdfBuild(array $r, array $o = []): array
{
    $s = max(0.8, min(1.12, (float) ($o['s'] ?? 1.0)));
    $mf = max(0.65, min(1.0, (float) ($o['m'] ?? 1.0)));
    $W = 612.0;
    $H = 792.0;
    $ml = 54.0 * $mf;
    $mr = 54.0 * $mf;
    $mt = 50.0 * $mf;
    $mb = 54.0 * $mf;
    $maxW = $W - $ml - $mr;
    $pages = [];
    $ops = [];
    $y = $H - $mt;
    $pageNo = 1;
    $name = $r['name'] !== '' ? $r['name'] : 'Resume';
    $flush = function () use (&$ops, &$pages, &$pageNo, $name, $W, $mb, $ml, $maxW) {
        if ($pageNo > 1) {
            $foot = tlPdfText($name . '  -  page ' . $pageNo);
            $ops[] = 'BT /F1 8 Tf 0.45 g ' . number_format($ml + ($maxW - tlPdfWidth($foot, 8, false)) / 2, 2, '.', '') . ' ' . number_format($mb - 24, 2, '.', '') . ' Td (' . tlPdfEsc($foot) . ') Tj ET 0 g';
        }
        $pages[] = implode("\n", $ops);
        $ops = [];
        $pageNo++;
    };
    $need = function (float $h) use (&$y, &$flush, $H, $mt, $mb) {
        if ($y - $h < $mb) {
            $flush();
            $y = $H - $mt;
        }
    };
    $line = function (string $text, float $size, bool $bold, float $x, string $color = '0 g') use (&$ops, &$y) {
        $cp = tlPdfText($text);
        $ops[] = 'BT /' . ($bold ? 'F2' : 'F1') . ' ' . $size . ' Tf ' . $color . ' ' . number_format($x, 2, '.', '') . ' ' . number_format($y, 2, '.', '') . ' Td (' . tlPdfEsc($cp) . ') Tj ET';
    };
    $para = function (string $text, float $size, bool $bold, float $indent = 0, float $lead = 0, string $color = '0 g', string $prefix = '') use (&$y, &$ops, $need, $line, $ml, $maxW) {
        $lead = $lead ?: $size * 1.32;
        $lines = tlPdfWrap($text, $size, $bold, $maxW - $indent - ($prefix !== '' ? 12 : 0));
        foreach ($lines as $i => $l) {
            $need($lead);
            $y -= $lead;
            if ($i === 0 && $prefix !== '') {
                $line($prefix, $size, false, $ml + $indent, $color);
            }
            $line($l, $size, $bold, $ml + $indent + ($prefix !== '' ? 12 : 0), $color);
        }
    };
    $center = function (string $text, float $size, bool $bold, string $color = '0 g') use (&$y, $need, $line, $ml, $maxW) {
        $need($size * 1.3);
        $y -= $size * 1.3;
        $cp = tlPdfText($text);
        $line($text, $size, $bold, $ml + max(0, ($maxW - tlPdfWidth($cp, $size, $bold)) / 2), $color);
    };
    $heading = function (string $t) use (&$y, &$ops, $need, $line, $ml, $maxW, $s) {
        $need(30 * $s);
        $y -= 16 * $s;
        $line(strtoupper($t), 10.5 * $s, true, $ml, '0.12 0.23 0.45 rg');
        $y -= 4 * $s;
        $ops[] = '0.12 0.23 0.45 RG 0.8 w ' . number_format($ml, 2, '.', '') . ' ' . number_format($y, 2, '.', '') . ' m ' . number_format($ml + $maxW, 2, '.', '') . ' ' . number_format($y, 2, '.', '') . ' l S';
        $y -= 4 * $s;
    };
    $blue = '0.12 0.23 0.45 rg';
    $center($name, 16 * $s, true);
    if ($r['title'] !== '') {
        $center($r['title'], 11 * $s, false, $blue);
    }
    $contact = array_values(array_filter([$r['email'], $r['phone'], $r['loc'], $r['linkedin'], $r['auth']]));
    if ($contact) {
        $center(implode('  |  ', $contact), 9 * $s, false, '0.25 g');
    }
    $y -= 4 * $s;
    if ($r['summary'] !== '' || !empty($r['hl'])) {
        $heading('Professional Summary');
        if ($r['summary'] !== '') {
            $para($r['summary'], 10 * $s, false);
        }
        if (!empty($r['hl'])) {
            $y -= ($r['summary'] !== '' ? 3 : 0) * $s;
            foreach ($r['hl'] as $h) {
                $para($h, 10 * $s, false, 6, 13 * $s, '0 g', "\u{2022}");
            }
        }
    }
    if ($r['skills']) {
        $heading('Core Skills');
        foreach ($r['skills'] as $g) {
            $txt = $g['g'] . ': ' . implode(', ', $g['items']);
            $lines = tlPdfWrap($txt, 10 * $s, false, $maxW);
            foreach ($lines as $i => $l) {
                $need(13.2 * $s);
                $y -= 13.2 * $s;
                if ($i === 0) {
                    $gp = tlPdfText($g['g'] . ':');
                    $line($g['g'] . ':', 10 * $s, true, $ml);
                    $rest = trim(substr($l, strlen($gp)));
                    $line($rest, 10 * $s, false, $ml + tlPdfWidth($gp, 10 * $s, true) + 4);
                } else {
                    $line($l, 10 * $s, false, $ml);
                }
            }
            $y -= 2 * $s;
        }
    }
    if ($r['experience']) {
        $heading('Professional Experience');
        foreach ($r['experience'] as $e) {
            $need(40 * $s);
            $y -= 14 * $s;
            $line($e['ti'] !== '' ? $e['ti'] : 'Role', 10.5 * $s, true, $ml);
            $dates = trim($e['from'] . ($e['to'] !== '' ? ' - ' . $e['to'] : ''));
            if ($dates !== '') {
                $cp = tlPdfText($dates);
                $line($dates, 9.5 * $s, false, $ml + $maxW - tlPdfWidth($cp, 9.5 * $s, false), '0.3 g');
            }
            $l2 = trim($e['co'] . ($e['loc'] !== '' ? ' - ' . $e['loc'] : ''));
            if ($l2 !== '') {
                $y -= 12.5 * $s;
                $line($l2, 10 * $s, false, $ml, '0.25 g');
            }
            $y -= 2 * $s;
            foreach ($e['bullets'] as $b) {
                $para($b, 10 * $s, false, 6, 13 * $s, '0 g', "\u{2022}");
            }
            if (($e['env'] ?? '') !== '') {
                // "Environment:" in bold, the tools after it, wrapped like a paragraph
                $txt = 'Environment: ' . $e['env'];
                $lines = tlPdfWrap($txt, 10 * $s, false, $maxW - 6);
                $y -= 2 * $s;
                foreach ($lines as $i => $l) {
                    $need(13 * $s);
                    $y -= 13 * $s;
                    if ($i === 0) {
                        $lab = tlPdfText('Environment:');
                        $line('Environment:', 10 * $s, true, $ml + 6);
                        $line(trim(substr($l, strlen($lab))), 10 * $s, false, $ml + 6 + tlPdfWidth($lab, 10 * $s, true) + 4);
                    } else {
                        $line($l, 10 * $s, false, $ml + 6);
                    }
                }
            }
            $y -= 3 * $s;
        }
    }
    if ($r['projects']) {
        $heading('Projects');
        foreach ($r['projects'] as $p) {
            $para($p['t'] . ($p['d'] !== '' ? ' - ' . $p['d'] : ''), 10 * $s, false);
            $y -= 2 * $s;
        }
    }
    if ($r['education']) {
        $heading('Education');
        foreach ($r['education'] as $e) {
            $para($e['t'], 10 * $s, false);
        }
    }
    if ($r['certs']) {
        $heading('Certifications');
        foreach ($r['certs'] as $c) {
            $para($c, 10 * $s, false, 6, 13 * $s, '0 g', "\u{2022}");
        }
    }
    if ($r['other']) {
        $heading('Additional');
        foreach ($r['other'] as $ot) {
            $para($ot, 10 * $s, false);
        }
    }
    // v33: how full the last page is (0-1), so a page count can be aimed at
    $fill = max(0.0, min(1.0, ($H - $mt - $y) / max(1.0, $H - $mt - $mb)));
    $flush();
    // objects: 1 catalog, 2 pages, 3 F1, 4 F2, then page+content pairs
    $objs = [];
    $objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    $objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    $objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    $kids = [];
    $n = 5;
    foreach ($pages as $content) {
        $pid = $n++;
        $cid = $n++;
        $kids[] = $pid . ' 0 R';
        $objs[$pid] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' . $W . ' ' . $H . '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' . $cid . ' 0 R >>';
        $objs[$cid] = '<< /Length ' . strlen($content) . ' >>' . "\nstream\n" . $content . "\nendstream";
    }
    $objs[2] = '<< /Type /Pages /Kids [' . implode(' ', $kids) . '] /Count ' . count($kids) . ' >>';
    $info = $n++;
    $objs[$info] = '<< /Title (' . tlPdfEsc(tlPdfText(trim($r['name'] . ' - ' . $r['title']))) . ') /Author (' . tlPdfEsc(tlPdfText($r['name'])) . ') /Producer (StratEdge portal) /CreationDate (D:' . gmdate('YmdHis') . 'Z) >>';
    ksort($objs);
    $out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    $offsets = [];
    foreach ($objs as $id => $body) {
        $offsets[$id] = strlen($out);
        $out .= $id . " 0 obj\n" . $body . "\nendobj\n";
    }
    $xref = strlen($out);
    $max = max(array_keys($objs));
    $out .= "xref\n0 " . ($max + 1) . "\n0000000000 65535 f \n";
    for ($i = 1; $i <= $max; $i++) {
        $out .= sprintf('%010d 00000 n ', $offsets[$i] ?? 0) . "\n";
    }
    $out .= "trailer\n<< /Size " . ($max + 1) . " /Root 1 0 R /Info " . $info . " 0 R >>\nstartxref\n" . $xref . "\n%%EOF\n";
    return ['pdf' => $out, 'pages' => count($pages), 'fill' => $fill];
}

/* ---------- where the resume comes from ---------- */
function tailorResumeTextOf(array $row): string
{
    $t = (string) ($row['resume_text'] ?? '');
    if (mb_strlen($t) < 120 && (string) ($row['fid'] ?? $row['resume_fid'] ?? '') !== '') {
        $fid = (string) ($row['fid'] ?? $row['resume_fid']);
        $name = (string) ($row['name'] ?? $row['resume_name'] ?? '');
        $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        $local = in_array($ext, ['pdf', 'docx', 'txt'], true) ? fileLocal($fid, $ext) : null;
        if ($local !== null) {
            $t = textFromFile($local, $ext);
        }
    }
    return cleanText($t, TL_MAX_RESUME);
}
/** Resolves a source {kind, id|uid|rid|text} to text + who it is. Members may only use their own resumes. */
function tailorSource(array $u, array $src, bool $staff): array
{
    $kind = (string) ($src['kind'] ?? '');
    $who = ['kind' => $kind, 'id' => '', 'n' => (string) $u['name'], 'email' => (string) ($u['email'] ?? ''), 'uid' => $u['id']];
    if ($kind === 'text') {
        $text = cleanText((string) ($src['text'] ?? ''), TL_MAX_RESUME);
        if (mb_strlen($text) < 200) {
            fail(400, 'invalid_argument', 'Paste the whole resume (at least a few paragraphs).');
        }
        if ($staff && trim((string) ($src['n'] ?? '')) !== '') {
            $who['n'] = mb_substr(trim((string) $src['n']), 0, 120);
            $who['email'] = mb_substr(trim((string) ($src['e'] ?? '')), 0, 160);
            $who['uid'] = '';
        }
        return ['text' => $text, 'label' => 'Pasted resume', 'who' => $who];
    }
    if ($kind === 'file') {
        $f = $_FILES['file'] ?? null;
        if (!$f || ($f['error'] ?? 1) !== UPLOAD_ERR_OK) {
            fail(400, 'invalid_argument', 'Choose a resume file (PDF, Word or text).');
        }
        $ext = strtolower(pathinfo((string) $f['name'], PATHINFO_EXTENSION));
        if (!in_array($ext, ['pdf', 'docx', 'txt'], true)) {
            fail(400, 'invalid_argument', 'Upload the resume as PDF, Word (.docx) or plain text.');
        }
        uploadGuard((string) $f['tmp_name'], basename((string) $f['name']));
        $text = cleanText(textFromFile((string) $f['tmp_name'], $ext), TL_MAX_RESUME);
        if (mb_strlen($text) < 200) {
            fail(400, 'invalid_argument', 'That file has no readable text (a scanned image?). Paste the resume text instead.');
        }
        if ($staff && trim((string) ($src['n'] ?? '')) !== '') {
            $who['n'] = mb_substr(trim((string) $src['n']), 0, 120);
            $who['email'] = mb_substr(trim((string) ($src['e'] ?? '')), 0, 160);
            $who['uid'] = '';
        }
        return ['text' => $text, 'label' => mb_substr((string) $f['name'], 0, 120), 'who' => $who];
    }
    if ($kind === 'resume') {
        $uid = $staff && (string) ($src['uid'] ?? '') !== '' ? (string) $src['uid'] : $u['id'];
        $row = jobResume($uid, (int) ($src['rid'] ?? 0));
        if (!$row) {
            fail(404, 'not_found', 'That resume is not there any more.');
        }
        $person = $uid === $u['id'] ? $u : (userById($uid) ?? []);
        $who = ['kind' => 'u', 'id' => $uid, 'n' => (string) ($person['name'] ?? ''), 'email' => (string) ($person['email'] ?? ''), 'uid' => $uid];
        return ['text' => tailorResumeTextOf($row), 'label' => (string) ($row['label'] ?: $row['name']), 'who' => $who];
    }
    if ($kind === 'u') {
        if (!$staff) {
            fail(403, 'invalid_argument', 'Pick one of your own resumes.');
        }
        $uid = (string) ($src['id'] ?? '');
        $person = userById($uid);
        if (!$person) {
            fail(404, 'not_found', 'No such person.');
        }
        $rows = jobResumes($uid);
        $row = null;
        foreach ($rows as $x) {
            if ((int) $x['active'] === 1) {
                $row = jobResume($uid, (int) $x['id']);
                break;
            }
        }
        if (!$row && $rows) {
            $row = jobResume($uid, (int) $rows[0]['id']);
        }
        if (!$row) {
            $st = jdb()->prepare('SELECT * FROM job_people WHERE uid = ?');
            $st->execute([$uid]);
            $row = $st->fetch() ?: null;
        }
        $text = $row ? tailorResumeTextOf($row) : '';
        if (mb_strlen($text) < 120) {
            fail(400, 'invalid_argument', ($person['name'] ?? 'That person') . ' has no resume on file in the portal. Ask them to upload one under Resume & preferences, or upload it here.');
        }
        return ['text' => $text, 'label' => (string) (($row['label'] ?? '') ?: ($row['name'] ?? $row['resume_name'] ?? 'Resume')), 'who' => ['kind' => 'u', 'id' => $uid, 'n' => (string) $person['name'], 'email' => (string) ($person['email'] ?? ''), 'uid' => $uid]];
    }
    if ($kind === 'cand' || $kind === 'ats') {
        if (!$staff) {
            fail(403, 'invalid_argument', 'Pick one of your own resumes.');
        }
        $id = (string) ($src['id'] ?? '');
        if (!preg_match('/^[A-Za-z0-9_\-]{1,40}$/', $id)) {
            fail(400, 'invalid_argument', 'Bad id.');
        }
        $base = $kind === 'cand' ? 'rec/cand/items/' . $id : 'ats/' . $id;
        $d = docGet($base);
        if (!$d) {
            fail(404, 'not_found', 'That candidate is not there any more.');
        }
        $text = cleanText(vmsResumeText($base), TL_MAX_RESUME);
        if (mb_strlen($text) < 120) {
            fail(400, 'invalid_argument', ((string) ($d->n ?? 'That candidate')) . ' has no readable resume file. Upload one on their card first, or paste the resume here.');
        }
        return ['text' => $text, 'label' => 'Resume on file', 'who' => ['kind' => $kind, 'id' => $id, 'n' => (string) ($d->n ?? ''), 'email' => (string) ($d->e ?? $d->email ?? ''), 'uid' => '']];
    }
    fail(400, 'invalid_argument', 'Choose where the resume comes from.');
}
function userById(string $uid): ?array
{
    if (!preg_match('/^u_[a-f0-9]{8,32}$/', $uid)) {
        return null;
    }
    $s = db()->prepare('SELECT id, name, email, role, status FROM users WHERE id = ?');
    $s->execute([$uid]);
    $row = $s->fetch();
    return $row ?: null;
}

/* ---------- the generated files ---------- */
/* ---------- v33: the pages needed ---------- */
/** How full the resume is in pages: 3.4 = three full pages and 40% of a fourth. */
function tailorPagesF(array $r, array $o = []): float
{
    $b = tailorPdfBuild($r, $o);
    return $b['pages'] - 1 + $b['fill'];
}
/** Months a job ran ("Mar 2021" - "Present"); 12 when the dates cannot be read. */
function tailorJobMonths(array $e): int
{
    $p = function (string $s, bool $end): ?int {
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
            $mon = (int) array_search(strtolower(substr($m[1], 0, 3)), ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'], true) + 1;
            return $y * 12 + $mon;
        }
        if (preg_match('/(\d{1,2})\/((?:19|20)\d{2})/', $s, $m)) {
            return (int) $m[2] * 12 + (int) $m[1];
        }
        if (preg_match('/((?:19|20)\d{2})/', $s, $m)) {
            return (int) $m[1] * 12 + ($end ? 12 : 1);
        }
        return null;
    };
    $a = $p((string) ($e['from'] ?? ''), false);
    $b = $p((string) ($e['to'] ?? ''), true) ?? $a;
    return $a !== null && $b !== null && $b >= $a ? max(1, $b - $a + 1) : 12;
}
/** The person's tools named in a job's bullets, as an Environment line (only what the resume itself shows). */
function tailorEnvFromWork(array $e, array $tools): string
{
    $txt = ' ' . strtolower(implode(' ', $e['bullets'])) . ' ';
    $found = [];
    foreach ($tools as $t) {
        $k = strtolower(trim(preg_replace('/\s*\(.*\)$/', '', $t) ?? $t));
        if (mb_strlen($k) < 2 || in_array($t, $found, true)) {
            continue;
        }
        if (preg_match('/(?<![a-z0-9])' . preg_quote($k, '/') . '(?![a-z0-9])/i', $txt)) {
            $found[] = $t;
        }
    }
    return count($found) >= 2 ? implode(', ', array_slice($found, 0, 18)) : '';
}
/**
 * Writes a tailored resume out to the pages needed when it is shorter. StratEdge AI adds summary bullets and more
 * detail per job - the work the resume already shows, in more depth - one job per call, in parallel (two rounds at
 * most); Environment lines list the person's own tools. Employers, titles, dates, education and certifications never
 * change; tools the original never mentions are left out of Environment lines and listed in "added" when a bullet
 * names them. Returns [resume, notes, added].
 */
function tailorGrow(array $r, array $orig, string $origText, array $jd, int $pages, int $deadline): array
{
    $notes = [];
    if ($pages < 2 || !aiReady('tailor') || !$r['experience']) {
        return [$r, $notes, []];
    }
    $have = tailorPagesF($r);
    if ($have > $pages - 1 + 0.55) {
        return [$r, $notes, []]; // already well into the last page needed: spacing or trimming does the rest
    }
    $origLow = strtolower($origText . ' ' . tailorText($orig));
    $tools = [];
    foreach ($orig['skills'] as $g) {
        foreach ($g['items'] as $it) {
            $tools[] = $it;
        }
    }
    foreach (skillsIn($origText . "\n" . tailorText($orig), 120) as $it) {
        $tools[] = $it;
    }
    $tools = array_slice(array_values(array_unique($tools)), 0, 160);
    $jdBrief = 'JOB TITLE: ' . (($jd['title'] ?? '') !== '' ? $jd['title'] : '(not stated)') .
        "\nJOB KEYWORDS: " . implode(', ', array_slice(array_merge((array) ($jd['skills'] ?? []), (array) ($jd['terms'] ?? [])), 0, 60)) .
        "\nJOB DESCRIPTION (start):\n" . mb_substr((string) ($jd['text'] ?? ''), 0, 3500);
    $origJob = function (int $i, array $e) use ($orig, $r): array {
        if (count($orig['experience']) === count($r['experience'])) {
            return $orig['experience'][$i] ?? [];
        }
        foreach ($orig['experience'] as $oe) {
            if ($oe['from'] === $e['from'] && $oe['to'] === $e['to'] && strcasecmp($oe['co'], $e['co']) === 0) {
                return $oe;
            }
        }
        return [];
    };
    $wpp = max(380.0, min(900.0, str_word_count(tailorText($r)) / max(0.5, $have)));
    // summary bullets and Environment lines belong to the longer formats (3+ pages)
    $hlWant = $pages <= 2 ? 0 : ($pages === 3 ? 6 : min(16, 4 + $pages));
    $withEnv = $pages >= 3;
    $sysJob = 'You expand one job on a resume for a US IT staffing firm, in the detailed US IT consulting resume format. You never invent employers, clients, projects, products, team sizes, numbers or certifications, and never claim a tool the person does not show. Answer with one JSON object only.';
    $sysHl = 'You write the Professional Summary bullet points of a resume for a US IT staffing firm. You never invent employers, clients, numbers, years of experience or certifications. Answer with one JSON object only.';
    $grownJobs = [];
    $failed = 0;
    $hlDone = false;
    $envGone = [];
    for ($round = 1; $round <= 2; $round++) {
        if ($round === 2 && ($have > $pages - 1 + 0.55 || time() > $deadline - 75)) {
            break;
        }
        // words still needed (aim a little past the line; the trimming lands it on the page count)
        $need = ($pages + 0.3 - $have) * $wpp;
        $calls = [];
        $what = [];
        if (!$hlDone && count($r['hl']) < $hlWant) {
            $need -= ($hlWant - count($r['hl'])) * 22;
            $calls[] = [$sysHl, $jdBrief . "\n\nTHE TAILORED RESUME:\n" . mb_substr(tailorText($r), 0, 12000) .
                "\n\nWrite exactly $hlWant summary bullet points for this person, aimed at this job: total years of experience only as the resume shows them, the job title, the industries and domains, the core stack by area, the delivery practices (Agile, CI/CD, testing, cloud) the resume shows, and how they work with business and technical teams. One point per bullet, 1-2 lines each, most relevant to the job first. Return {\"hl\": [\"...\"]}", 2200];
            $what[] = ['hl'];
        }
        $w = [];
        foreach ($r['experience'] as $i => $e) {
            $w[$i] = max(0.35, 1 - 0.13 * $i) * sqrt(max(6, min(120, tailorJobMonths($e))));
        }
        $sum = array_sum($w) ?: 1;
        foreach ($r['experience'] as $i => $e) {
            $cur = count($e['bullets']);
            $k = min(TL_MAX_BULLETS, $cur + max(0, (int) round(max(0, $need) * $w[$i] / $sum / 24)));
            if ($k < $cur + 2) {
                continue;
            }
            $oe = $origJob($i, $e);
            $prompt = $jdBrief .
                "\n\nTHE PERSON'S TOOLS AND SKILLS (from their resume): " . implode(', ', $tools) .
                "\n\nTHIS JOB: " . trim($e['ti'] . ' | ' . $e['co'] . ' | ' . $e['loc'] . ' | ' . $e['from'] . ' - ' . $e['to']) .
                "\nWHAT THE ORIGINAL RESUME SAYS FOR THIS JOB:\n" . (($oe['bullets'] ?? []) ? implode("\n", array_map(fn($b) => '- ' . $b, $oe['bullets'])) : '(no bullets)') . (($oe['env'] ?? '') !== '' ? "\nEnvironment: " . $oe['env'] : '') .
                "\nTHE BULLETS SO FAR (keep them, in this order):\n" . implode("\n", array_map(fn($b) => '- ' . $b, $e['bullets'])) .
                "\n\nWrite exactly $k bullets in total for this job: the bullets so far (you may tighten their wording), then new ones that describe the same work in more depth - how it was analyzed, designed, built, tested, deployed, monitored and supported, the work with business users, QA and other teams, documentation, code reviews and production support - in the job description's language. Use only tools from the person's list that fit this job and its dates. No numbers or metrics the original does not state, no new clients or projects. Each bullet starts with a strong verb (past tense; present tense for a current job), 1-2 lines, no repeats." .
                "\nReturn {\"bullets\": [\"...\"], \"env\": \"comma-separated tools this job used, from the person's list\"}";
            $calls[] = [$sysJob, $prompt, min(4000, 70 * $k + 400)];
            $what[] = ['job', $i, $cur];
        }
        if (!$calls) {
            break;
        }
        $res = aiJsonMulti($calls, 110, 5);
        foreach ($what as $n => $wt) {
            $j = $res[$n] ?? null;
            if (!is_array($j)) {
                $failed++;
                continue;
            }
            if ($wt[0] === 'hl') {
                $hl = [];
                foreach ((array) ($j['hl'] ?? []) as $x) {
                    $x = mb_substr(trim(tlStripBullet((string) $x)), 0, 400);
                    if ($x !== '' && !in_array($x, $hl, true)) {
                        $hl[] = $x;
                    }
                }
                if (count($hl) >= 3) {
                    $r['hl'] = array_slice($hl, 0, 20);
                    $hlDone = true;
                }
                continue;
            }
            [, $i, $cur] = $wt;
            $bul = [];
            foreach ((array) ($j['bullets'] ?? []) as $x) {
                $x = mb_substr(trim(tlStripBullet((string) $x)), 0, 600);
                if ($x !== '' && !in_array($x, $bul, true)) {
                    $bul[] = $x;
                }
            }
            if (count($bul) > $cur) {
                $r['experience'][$i]['bullets'] = array_slice($bul, 0, TL_MAX_BULLETS);
                $grownJobs[$i] = true;
            }
            $env = $j['env'] ?? '';
            $env = is_array($env) ? implode(', ', array_map('strval', $env)) : (string) $env;
            if ($withEnv && $env !== '' && ($r['experience'][$i]['env'] ?? '') === '') {
                [$keep, $gone] = tailorEnvKeep($env, $origLow);
                $envGone = array_merge($envGone, $gone);
                if ($keep !== '') {
                    $r['experience'][$i]['env'] = mb_substr($keep, 0, 700);
                }
            }
        }
        $have = tailorPagesF($r);
    }
    // every job gets an Environment line from its own bullets when it has none (3+ pages)
    foreach ($r['experience'] as &$e) {
        if ($withEnv && ($e['env'] ?? '') === '') {
            $e['env'] = tailorEnvFromWork($e, $tools);
        }
    }
    unset($e);
    $added = [];
    $origSk = array_map('strtolower', skillsIn($origText . "\n" . tailorText($orig), 160));
    foreach (skillsIn(tailorText($r), 160) as $s) {
        if (!in_array(strtolower($s), $origSk, true) && !str_contains($origLow, strtolower($s)) && !in_array($s, $added, true)) {
            $added[] = $s;
        }
    }
    $parts = [];
    if ($hlDone) {
        $parts[] = count($r['hl']) . ' summary bullets';
    }
    if ($grownJobs) {
        $parts[] = 'more detail for ' . count($grownJobs) . (count($grownJobs) === 1 ? ' job' : ' jobs');
    }
    if ($withEnv) {
        $parts[] = 'an Environment line per job (the person\'s own tools)';
    }
    if ($hlDone || $grownJobs) {
        $notes[] = 'Written out for ' . $pages . ' pages by StratEdge AI: ' . implode(', ', $parts) . '. Nothing new was invented, but read it through before sending';
    }
    if ($envGone) {
        $notes[] = 'Environment lines keep only tools the original resume mentions (left out: ' . implode(', ', array_slice(array_values(array_unique($envGone)), 0, 8)) . ')';
    }
    if ($failed) {
        $notes[] = 'StratEdge AI did not answer for ' . $failed . ($failed === 1 ? ' part' : ' parts') . '; those keep their tailored text';
    }
    return [tailorClean($r), $notes, $added];
}
/** A note when the resume came out shorter than the pages needed. */
function tailorShortNote(int $have, int $pages, bool $ai, bool $edited = false): array
{
    if ($pages <= 0 || $have >= $pages) {
        return [];
    }
    $alt = $have . ($have === 1 ? ' page' : ' pages');
    if ($edited) {
        return ['The edited resume is ' . $alt . ' of the ' . $pages . ' needed: press "Fit to ' . $pages . ' pages" to have StratEdge AI write out more detail'];
    }
    return [$ai
        ? 'Came to ' . $alt . ' of the ' . $pages . ' needed: the original resume does not hold enough to fill ' . $pages . ' pages without making things up. Add projects or responsibilities in the editor and press Fit again, or choose ' . $alt
        : 'Came to ' . $alt . ' of the ' . $pages . ' needed: writing a resume out to more pages needs StratEdge AI (Admin › StratEdge AI)'];
}
/**
 * Resumes over the page count (2+ pages) lose their least relevant bullets (each job's last ones) in proportion,
 * older jobs more than recent ones, and summary bullets down to six. Returns [resume, notes], or null when even the
 * deepest cut is too long (the step-by-step trimming takes over).
 */
function tailorTrimLong(array $r, int $pages, array $o, array $floor = [5, 3, 6]): ?array
{
    [$fRecent, $fOlder, $fHl] = $floor;
    $cut = function (float $k) use ($r, $fRecent, $fOlder, $fHl): array {
        $x = $r;
        foreach ($x['experience'] as $i => &$e) {
            $n = count($e['bullets']);
            $age = min(1.0, 0.5 + 0.12 * $i);
            $keep = max(min($n, $i < 2 ? $fRecent : $fOlder), (int) ceil($n * (1 - $k * $age)));
            $e['bullets'] = array_slice($e['bullets'], 0, $keep);
        }
        unset($e);
        $h = count($x['hl']);
        if ($h > $fHl) {
            $x['hl'] = array_slice($x['hl'], 0, max($fHl, (int) ceil($h * (1 - $k * 0.5))));
        }
        if (!$x['hl'] && $r['hl'] && $x['summary'] === '') {
            $x['summary'] = mb_substr(implode(' ', array_map(fn($h) => rtrim($h, '. ') . '.', array_slice($r['hl'], 0, 3))), 0, 520);
        }
        return $x;
    };
    if (tailorPdfBuild($cut(1.0), $o)['pages'] > $pages) {
        return null;
    }
    $lo = 0.0;
    $hi = 1.0;
    for ($i = 0; $i < 9; $i++) {
        $mid = ($lo + $hi) / 2;
        if (tailorPdfBuild($cut($mid), $o)['pages'] <= $pages) {
            $hi = $mid;
        } else {
            $lo = $mid;
        }
    }
    $x = $cut($hi);
    $count = fn(array $y) => array_sum(array_map(fn($e) => count($e['bullets']), $y['experience'])) + count($y['hl']);
    $gone = $count($r) - $count($x);
    return [$x, $gone > 0 ? ['The ' . $gone . ' least relevant bullets came off to fit ' . $pages . ' pages (older jobs first)'] : []];
}
/**
 * v32: makes the resume fit a number of pages (0 = any length). Tightens the layout first, then trims the least
 * relevant content step by step: bullets come off the end of each job (the most relevant ones are first), older jobs
 * before recent ones; every job, date, degree and certification stays. Returns [resume, layout, notes, pages].
 */
function tailorFit(array $r, int $pages): array
{
    $o = ['s' => 1.0, 'm' => 1.0];
    $b = tailorPdfBuild($r, $o);
    $n = $b['pages'];
    if ($pages <= 0 || $n === $pages) {
        return [$r, $o, [], $n];
    }
    if ($n < $pages) {
        // v33: a little short of the pages needed: roomier type and spacing fill the last one
        if ($pages - ($n - 1 + $b['fill']) <= 0.8) {
            foreach ([1.05, 1.1] as $sc) {
                $try = ['s' => $sc, 'm' => 1.0];
                $n2 = tailorPdfBuild($r, $try)['pages'];
                if ($n2 === $pages) {
                    return [$r, $try, ['Roomier type and spacing to fill ' . $pages . ' pages'], $n2];
                }
                if ($n2 > $pages) {
                    break;
                }
            }
        }
        return [$r, $o, [], $n];
    }
    // v33: resumes of 2+ pages lose their least relevant bullets evenly (older jobs first) before anything else
    if ($pages >= 2) {
        $t = tailorTrimLong($r, $pages, $o) ?? tailorTrimLong($r, $pages, $o, [3, 1, 0]);
        if ($t) {
            return [$t[0], $o, $t[1], tailorPdfBuild($t[0], $o)['pages']];
        }
    }
    $notes = [];
    $cap = function (array $r, int $from, int $to, int $max) {
        $changed = false;
        foreach ($r['experience'] as $i => &$e) {
            if ($i >= $from && $i <= $to && count($e['bullets']) > $max) {
                $e['bullets'] = array_slice($e['bullets'], 0, $max);
                $changed = true;
            }
        }
        unset($e);
        return [$r, $changed];
    };
    $steps = [
        function ($r, $o) {
            return [$r, ['s' => 0.95, 'm' => 0.85], 'Tighter spacing and margins'];
        },
        function ($r, $o) {
            // v33: summary bullets go first (the first three become the summary when there is no paragraph)
            if (!$r['hl']) {
                return [$r, $o, ''];
            }
            if ($r['summary'] === '') {
                $r['summary'] = mb_substr(implode(' ', array_map(fn($h) => rtrim($h, '. ') . '.', array_slice($r['hl'], 0, 3))), 0, 520);
            }
            $r['hl'] = [];
            return [$r, $o, 'Summary bullets left out (the summary paragraph stays)'];
        },
        function ($r, $o) {
            $c = false;
            foreach ($r['experience'] as &$e) {
                if (($e['env'] ?? '') !== '') {
                    $e['env'] = '';
                    $c = true;
                }
            }
            unset($e);
            return [$r, $o, $c ? 'Environment lines left out' : ''];
        },
        function ($r, $o) use ($cap) {
            [$r, $c] = $cap($r, 2, 99, 3);
            return [$r, $o, $c ? 'Older jobs kept to their 3 most relevant bullets' : ''];
        },
        function ($r, $o) {
            $c = (bool) $r['other'];
            $r['other'] = [];
            return [$r, $o, $c ? 'The Additional section was left out' : ''];
        },
        function ($r, $o) {
            $c = count($r['projects']) > 2;
            $r['projects'] = array_slice($r['projects'], 0, 2);
            return [$r, $o, $c ? 'Projects kept to the 2 most relevant' : ''];
        },
        function ($r, $o) {
            $sents = preg_split('/(?<=[.!?])\s+/', trim($r['summary'])) ?: [];
            if (count($sents) <= 3 && mb_strlen($r['summary']) <= 520) {
                return [$r, $o, ''];
            }
            $r['summary'] = mb_substr(implode(' ', array_slice($sents, 0, 3)), 0, 520);
            return [$r, $o, 'Summary shortened to 3 sentences'];
        },
        function ($r, $o) {
            $c = false;
            if (count($r['skills']) > 6) {
                $r['skills'] = array_slice($r['skills'], 0, 6);
                $c = true;
            }
            foreach ($r['skills'] as &$g) {
                if (count($g['items']) > 14) {
                    $g['items'] = array_slice($g['items'], 0, 14);
                    $c = true;
                }
            }
            unset($g);
            return [$r, $o, $c ? 'Skills kept to the most relevant (the job\'s keywords first)' : ''];
        },
        function ($r, $o) use ($cap) {
            [$r, $c] = $cap($r, 0, 1, 6);
            return [$r, $o, $c ? 'The two latest jobs kept to 6 bullets' : ''];
        },
        function ($r, $o) use ($cap) {
            [$r, $c] = $cap($r, 2, 99, 2);
            return [$r, $o, $c ? 'Older jobs kept to 2 bullets' : ''];
        },
        function ($r, $o) {
            return [$r, ['s' => 0.9, 'm' => 0.8], 'Slightly smaller type'];
        },
        function ($r, $o) use ($cap) {
            [$r, $c] = $cap($r, 4, 99, 0);
            return [$r, $o, $c ? 'Jobs from the 5th one back listed with title, employer and dates only' : ''];
        },
        function ($r, $o) use ($cap) {
            [$r, $c1] = $cap($r, 0, 1, 4);
            [$r, $c2] = $cap($r, 2, 3, 1);
            return [$r, $o, $c1 || $c2 ? 'Recent jobs kept to 4 bullets, the next ones to 1' : ''];
        },
        function ($r, $o) {
            return [$r, ['s' => 0.86, 'm' => 0.72], 'Compact layout'];
        },
        function ($r, $o) use ($cap) {
            [$r, $c1] = $cap($r, 0, 0, 3);
            [$r, $c2] = $cap($r, 1, 1, 2);
            [$r, $c3] = $cap($r, 2, 99, 0);
            return [$r, $o, $c1 || $c2 || $c3 ? 'Only the latest jobs keep bullets' : ''];
        },
    ];
    foreach ($steps as $step) {
        [$r, $o, $note] = $step($r, $o);
        if ($note !== '') {
            $notes[] = $note;
        }
        $n = tailorPdfBuild($r, $o)['pages'];
        if ($n <= $pages) {
            break;
        }
    }
    if ($n > $pages) {
        $notes[] = 'Still ' . $n . ' pages: the work history is long. Choose ' . $n . ' pages, or remove older jobs in the editor';
    }
    return [$r, $o, $notes, $n];
}
function tailorFileName(array $r, string $jdTitle, string $ext): string
{
    $who = $r['name'] !== '' ? $r['name'] : 'Resume';
    $t = $jdTitle !== '' ? $jdTitle : ($r['title'] ?: 'tailored');
    $n = preg_replace('/[^A-Za-z0-9 ._()\-]+/', ' ', $who . ' - ' . $t) ?? $who;
    $n = trim(preg_replace('/\s+/', ' ', $n) ?? $n);
    return mb_substr($n, 0, 110) . '.' . $ext;
}
function tailorFiles(string $base, array $r, string $jdTitle, array $o = []): array
{
    foreach (colAll($base . '/f') as [$fid, $f]) {
        if ((string) ($f->c ?? '') === 'tailored') {
            docDelete("$base/f/$fid");
            @unlink(cfg('files_dir') . '/' . $fid);
        }
    }
    $dir = cfg('files_dir');
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    $out = [];
    foreach (['docx' => tailorDocx($r, $o), 'pdf' => tailorPdf($r, $o)] as $ext => $bytes) {
        $fid = rid(16);
        if (!fileWritePath("$dir/$fid", $bytes)) {
            fail(500, 'unavailable', 'The server could not store the file. Check that the storage folder is writable.');
        }
        $doc = (object) ['n' => tailorFileName($r, $jdTitle, $ext), 'ty' => MIME[$ext], 'sz' => strlen($bytes), 'at' => now(), 'c' => 'tailored'];
        docSet("$base/f/$fid", $doc);
        $out[$ext] = ['id' => $fid, 'n' => $doc->n, 'sz' => $doc->sz];
    }
    return $out;
}
function tailorItemOut(string $base, string $id, stdClass $d, bool $full): array
{
    $a = json_decode(json_encode($d), true);
    $a['id'] = $id;
    $a['base'] = $base . '/' . $id; // the item's own path: its files hang under base/f/{fid}
    unset($a['full'], $a['layout']); // the untrimmed version stays on the server (used when the pages change)
    if (!$full) {
        unset($a['orig'], $a['out'], $a['full'], $a['before'], $a['after']);
        $a['score'] = ['before' => (int) ($d->before->score ?? 0), 'after' => (int) ($d->after->score ?? 0)];
        if (isset($a['jd'])) {
            unset($a['jd']['text'], $a['jd']['reqs'], $a['jd']['terms'], $a['jd']['skills']);
        }
    }
    return $a;
}

/* ---------- find consultants for a JD ---------- */
function tailorPeople(array $jd, string $q = ''): array
{
    $prof = $jd ? vmsReqProfile(['ti' => $jd['title'], 'sk' => implode(', ', $jd['skills']), 'd' => $jd['text'], 'loc' => $jd['loc'], 'md' => stripos($jd['text'], 'remote') !== false && stripos($jd['text'], 'onsite') === false ? 'Remote' : '']) : null;
    $rows = [];
    $ql = mb_strtolower(trim($q));
    $add = function (array $c) use (&$rows, $prof, $jd, $ql) {
        if ($ql !== '' && !str_contains(mb_strtolower($c['n'] . ' ' . $c['ti'] . ' ' . $c['email']), $ql)) {
            return;
        }
        $score = 0;
        $why = [];
        if ($prof) {
            [$score, $why] = vmsScore($prof, ['titles' => $c['titles'], 'skills' => $c['skills'], 'loc' => $c['loc'], 'auth' => $c['auth'], 'reloc' => $c['reloc']]);
            if ($jd['years'] && $c['years']) {
                if ($c['years'] >= $jd['years']) {
                    $score = min(100, $score + 5);
                    $why[] = $c['years'] . ' years (asks ' . $jd['years'] . '+)';
                } else {
                    $score = max(0, $score - 8);
                    $why[] = 'Only ' . $c['years'] . ' years (asks ' . $jd['years'] . '+)';
                }
            }
            if (!$c['resume']) {
                $why[] = 'No resume file: score from the card only';
            }
        }
        unset($c['titles'], $c['skills']);
        $c['score'] = $score;
        $c['why'] = $why;
        $rows[] = $c;
    };
    // portal consultants and employees with a resume
    $s = jdb()->query("SELECT jp.uid, jp.resume_text, jp.profile, jp.resume_name, u.name AS uname, u.email AS uemail, u.role FROM job_people jp JOIN users u ON u.id = jp.uid WHERE u.status = 'active'");
    foreach ($s->fetchAll() as $p) {
        $pr = jdec((string) $p['profile']);
        $titles = (array) ($pr['titles'] ?? []);
        $add([
            'kind' => 'u',
            'id' => (string) $p['uid'],
            'n' => (string) $p['uname'],
            'email' => (string) $p['uemail'],
            'ti' => (string) ($titles[0] ?? ''),
            'loc' => (string) ($pr['location'] ?? ''),
            'auth' => '',
            'reloc' => '',
            'years' => (int) ($pr['years'] ?? 0),
            'src' => 'Portal (' . ($p['role'] === 'consultant' ? 'consultant' : 'employee') . ')',
            'resume' => mb_strlen((string) $p['resume_text']) > 120 || (string) $p['resume_name'] !== '',
            'titles' => $titles,
            'skills' => (array) ($pr['skills'] ?? []),
        ]);
    }
    // recruiting database
    foreach (colAll('rec/cand/items') as [$id, $c]) {
        if (($c->st ?? 'active') === 'archived') {
            continue;
        }
        $txt = (string) ($c->rid ?? '') !== '' ? vmsResumeText('rec/cand/items/' . $id) : '';
        $rp = $txt !== '' ? resumeProfile($txt) : ['titles' => [], 'skills' => [], 'years' => null];
        $listed = array_values(array_filter(array_map('trim', preg_split('/[,;|\n]+/', (string) ($c->sk ?? '')) ?: [])));
        $add([
            'kind' => 'cand',
            'id' => (string) $id,
            'n' => (string) ($c->n ?? ''),
            'email' => (string) ($c->e ?? ''),
            'ti' => (string) ($c->ti ?? ''),
            'loc' => (string) ($c->loc ?? ''),
            'auth' => (string) ($c->auth ?? ''),
            'reloc' => (string) ($c->reloc ?? ''),
            'years' => (int) ((float) ($c->exp ?? 0) ?: ($rp['years'] ?? 0)),
            'src' => 'Consultant database',
            'resume' => $txt !== '',
            'titles' => array_values(array_unique(array_filter(array_merge([(string) ($c->ti ?? '')], (array) $rp['titles'])))),
            'skills' => array_values(array_unique(array_merge(skillsCanon($listed), (array) $rp['skills']))),
        ]);
    }
    // ATS candidates (active ones)
    foreach (colAll('ats') as [$id, $c]) {
        if (!preg_match('/^[A-Za-z0-9_\-]{1,40}$/', (string) $id) || in_array((string) ($c->st ?? ''), ['rejected', 'hired', 'withdrawn'], true)) {
            continue;
        }
        $txt = vmsResumeText('ats/' . $id);
        $rp = $txt !== '' ? resumeProfile($txt) : ['titles' => [], 'skills' => [], 'years' => null];
        $listed = array_values(array_filter(array_map('trim', preg_split('/[,;|\n]+/', (string) ($c->sk ?? '')) ?: [])));
        $add([
            'kind' => 'ats',
            'id' => (string) $id,
            'n' => (string) ($c->n ?? ''),
            'email' => (string) ($c->e ?? $c->email ?? ''),
            'ti' => (string) ($c->ti ?? $c->jt ?? ''),
            'loc' => (string) ($c->loc ?? ''),
            'auth' => (string) ($c->auth ?? ''),
            'reloc' => (string) ($c->reloc ?? ''),
            'years' => (int) ((float) ($c->exp ?? 0) ?: ($rp['years'] ?? 0)),
            'src' => 'ATS',
            'resume' => $txt !== '',
            'titles' => array_values(array_unique(array_filter(array_merge([(string) ($c->ti ?? ''), (string) ($c->jt ?? '')], (array) $rp['titles'])))),
            'skills' => array_values(array_unique(array_merge(skillsCanon($listed), (array) $rp['skills']))),
        ]);
    }
    usort($rows, fn($a, $b) => $b['score'] <=> $a['score'] ?: strcmp($a['n'], $b['n']));
    return array_slice($rows, 0, $jd ? 40 : 60);
}
/** The assistant's read on the top few: fit level and a two-line note per person, from their resume text. */
function tailorAiFit(array $jd, array $people): array
{
    if (!aiReady('find') || !$people) {
        return [];
    }
    $top = array_slice($people, 0, 6);
    $profiles = [];
    foreach ($top as $i => $p) {
        $base = $p['kind'] === 'u' ? null : ($p['kind'] === 'cand' ? 'rec/cand/items/' . $p['id'] : 'ats/' . $p['id']);
        $txt = '';
        if ($base) {
            $txt = vmsResumeText($base);
        } else {
            $st = jdb()->prepare('SELECT resume_text FROM job_people WHERE uid = ?');
            $st->execute([$p['id']]);
            $txt = (string) (($st->fetch() ?: [])['resume_text'] ?? '');
        }
        $card = $base && $p['kind'] === 'cand' ? docGet($base) : null;
        $profiles[] = '#' . ($i + 1) . ' ' . $p['n'] . ' - ' . $p['ti'] . ($p['years'] ? ', ' . $p['years'] . ' yrs' : '') . ($p['loc'] ? ', ' . $p['loc'] : '') . ($p['auth'] ? ', ' . $p['auth'] : '') . ($card && !empty($card->sk) ? "\nListed skills: " . mb_substr((string) $card->sk, 0, 400) : '') . "\n" . ($txt !== '' ? mb_substr(preg_replace('/\s+/', ' ', $txt) ?? '', 0, 1500) : '(no resume file; judge from the title and listed skills only)');
    }
    $j = aiJson(
        'You screen consultants against a job description for a staffing firm. Be specific and honest; never invent experience. Answer with one JSON object only.',
        "JOB: " . $jd['title'] . "\n" . mb_substr($jd['text'], 0, 5000) . "\n\nCONSULTANTS:\n" . implode("\n\n", $profiles) . "\n\nReturn JSON {\"fits\":[{\"n\":1,\"level\":\"strong|good|weak\",\"note\":\"two lines: the strongest evidence for this job, then the biggest gap\"}]} with one entry per consultant number.",
        1800
    );
    $out = [];
    foreach ((array) ($j['fits'] ?? []) as $f) {
        $f = (array) $f;
        $n = (int) ($f['n'] ?? 0);
        if ($n >= 1 && $n <= count($top)) {
            $p = $top[$n - 1];
            $lvl = strtolower(trim((string) ($f['level'] ?? '')));
            $out[$p['kind'] . ':' . $p['id']] = ['level' => in_array($lvl, ['strong', 'good', 'weak'], true) ? $lvl : 'good', 'note' => mb_substr(trim((string) ($f['note'] ?? '')), 0, 300)];
        }
    }
    return $out;
}
/** Job descriptions already in the system: ATS requisitions and desk requirements. */
function tailorJds(): array
{
    $out = [];
    $clients = [];
    foreach (colAll('org/admin/clients') as [$cid, $cl]) {
        $clients[(string) $cid] = (string) ($cl->n ?? '');
    }
    foreach (colAll('ats/x/jobs') as [$id, $j]) {
        if (in_array((string) ($j->status ?? $j->st ?? ''), ['closed', 'filled', 'cancelled', 'on_hold'], true)) {
            continue;
        }
        $co = (string) ($clients[(string) ($j->client ?? '')] ?? ($j->cl ?? ''));
        $out[] = ['kind' => 'ats', 'id' => (string) $id, 'ti' => (string) ($j->ti ?? ''), 'co' => $co, 'vn' => '', 'loc' => (string) ($j->loc ?? ''), 'u' => (int) ($j->u ?? $j->at ?? 0), 'text' => trim((string) ($j->d ?? '') . "\n\nSkills: " . (string) ($j->sk ?? ''))];
    }
    foreach (colAll(VMS_REQ) as [$id, $r]) {
        if (in_array((string) ($r->st ?? ''), ['closed', 'filled', 'dead', 'lost'], true)) {
            continue;
        }
        $out[] = ['kind' => 'req', 'id' => (string) $id, 'ti' => (string) ($r->ti ?? ''), 'co' => (string) (($r->ec ?? '') ?: ($r->cl ?? '')), 'vn' => (string) ($r->vn ?? ''), 'loc' => (string) ($r->loc ?? ''), 'u' => (int) ($r->u ?? $r->at ?? 0), 'text' => trim((string) ($r->d ?? '') . "\n\nSkills: " . (string) ($r->sk ?? ''))];
    }
    usort($out, fn($a, $b) => $b['u'] <=> $a['u']);
    return array_slice($out, 0, 80);
}

/* ---------- the run ---------- */
function tailorRun(array $u, array $b, string $base, bool $staff): array
{
    $jdText = (string) ($b['jd'] ?? '');
    if (mb_strlen(trim($jdText)) < 80) {
        fail(400, 'invalid_argument', 'Paste the job description (at least a few lines).');
    }
    $meta = ['title' => str($b, 'title', 120), 'company' => str($b, 'company', 120), 'loc' => str($b, 'loc', 120)];
    $jd = tailorJd($jdText, $meta);
    $srcIn = is_array($b['src'] ?? null) ? $b['src'] : (is_string($b['src'] ?? null) ? (json_decode((string) $b['src'], true) ?: []) : []);
    $src = tailorSource($u, $srcIn, $staff);
    $text = $src['text'];
    if (throttleHit('tl:' . $u['id'], 40, 3600)) {
        fail(429, 'rate_limited', 'That is a lot of resumes for one hour. Try again a little later.');
    }
    session_write_close();
    @set_time_limit(330);
    $t0 = time();
    $ai = aiReady('tailor');
    // the JD as modules (the assistant's reading, else the keyword groups); a title it finds fills an empty one
    $analysis = $ai ? tailorAiJd($jd) : null;
    $analysis = $analysis ?: tailorRuleModules($jd);
    if ($jd['title'] === '' && $analysis['title'] !== '') {
        $jd['title'] = $analysis['title'];
    }
    $orig = $ai ? tailorAiParse($text) : null;
    $parsedBy = $orig ? 'ai' : 'rules';
    $orig = $orig ?: tailorParse($text);
    if (!$orig['experience'] && !$orig['skills'] && $orig['summary'] === '') {
        fail(400, 'invalid_argument', 'The resume could not be read into sections. Paste it as plain text with headings (Summary, Skills, Experience, Education).');
    }
    $before = tailorScore($orig, $jd);
    $before['fit'] = tailorFitByKeywords($analysis, $orig);
    $pages = max(0, min(TL_MAX_PAGES, (int) ($b['pages'] ?? 0)));
    $rw = $ai ? tailorAiRewrite($orig, $jd, $text, $analysis, $pages) : null;
    $mode = $rw ? 'ai' : 'rules';
    $rw = $rw ?: tailorRules($orig, $jd, $text);
    [$out, $added, $flags] = tailorGuard($orig, $rw['resume'], $text);
    $added = array_values(array_unique(array_merge($rw['added'], $added)));
    if ($jd['title'] !== '' && $out['title'] === '') {
        $out['title'] = $jd['title'];
    }
    // v32: fit the chosen number of pages (the untrimmed version is kept for a different choice later)
    // v33: a version shorter than the pages needed is written out first (StratEdge AI, one job per call)
    $full = $out;
    $growNotes = [];
    if ($pages > 0 && $ai) {
        [$full, $growNotes, $gAdded] = tailorGrow($full, $orig, $text, $jd, $pages, $t0 + 300);
        $added = array_values(array_unique(array_merge($added, $gAdded)));
    }
    [$out, $layout, $fitNotes, $pageN] = tailorFit($full, $pages);
    $fitNotes = array_merge($growNotes, $fitNotes, tailorShortNote($pageN, $pages, $ai));
    $after = tailorScore($out, $jd);
    $after['fit'] = $rw['fit'] ?: tailorFitByKeywords($analysis, $out);
    $id = rid(12);
    $item = (object) [
        't' => $jd['title'] !== '' ? $jd['title'] : 'Tailored resume',
        'co' => $jd['company'],
        'vn' => str($b, 'vendor', 120),
        'loc' => $jd['loc'],
        'jd' => ['title' => $jd['title'], 'company' => $jd['company'], 'loc' => $jd['loc'], 'years' => $jd['years'], 'skills' => $jd['skills'], 'terms' => $jd['terms'], 'reqs' => $jd['reqs'], 'words' => $jd['words'], 'text' => $jd['text'], 'kind' => str($b, 'jdKind', 12), 'ref' => str($b, 'jdId', 60)],
        'analysis' => $analysis,
        'who' => $src['who'],
        'src' => ['kind' => (string) ($srcIn['kind'] ?? ''), 'label' => $src['label'], 'chars' => mb_strlen($text)],
        'orig' => $orig,
        'out' => $out,
        'full' => $full,
        'pages' => $pages,
        'pageN' => $pageN,
        'layout' => $layout,
        'fitNotes' => $fitNotes,
        'before' => $before,
        'after' => $after,
        'gaps' => $rw['gaps'],
        'changes' => $rw['changes'],
        'added' => $added,
        'flags' => $flags,
        'mode' => $mode,
        'parsedBy' => $parsedBy,
        'st' => 'draft',
        'at' => now(),
        'u' => now(),
        'by' => $u['id'],
        'byn' => (string) $u['name'],
    ];
    $item->files = tailorFiles($base . '/' . $id, $out, $jd['title'], $layout);
    docSet($base . '/' . $id, $item);
    return tailorItemOut($base, $id, $item, true);
}
function tailorLoad(string $base, string $id): array
{
    if (!preg_match('/^[A-Za-z0-9_\-]{1,40}$/', $id)) {
        fail(400, 'invalid_argument', 'Bad id.');
    }
    $d = docGet($base . '/' . $id);
    if (!$d) {
        fail(404, 'not_found', 'That tailored resume is not there any more.');
    }
    return [$d, $base . '/' . $id];
}
/** Sends the tailored files to a vendor or client: through the sender's own connected mailbox (My email) when there
 *  is one, otherwise from the company mailbox with reply-to the sender. */
function tailorEmail(array $u, stdClass $d, string $path, array $b): array
{
    $tos = mymailList($b['to'] ?? '');
    $cc = mymailList($b['cc'] ?? '');
    $subject = trim(str($b, 'subject', 300));
    $text = trim((string) ($b['text'] ?? ''));
    if (!$tos || $subject === '' || $text === '') {
        fail(400, 'invalid_argument', 'Add a recipient, a subject and a message.');
    }
    if (throttleHit('tl_mail:' . $u['id'], 60, 3600)) {
        fail(429, 'rate_limited', 'That is a lot of email for one hour.');
    }
    $which = (string) ($b['which'] ?? 'both');
    $atts = [];
    foreach ((array) ($d->files ?? []) as $ext => $f) {
        $f = (array) $f;
        if ($which !== 'both' && $which !== $ext) {
            continue;
        }
        $data = fileRead((string) ($f['id'] ?? '')) ?? false;
        if ($data !== false) {
            $atts[] = ['name' => (string) $f['n'], 'type' => MIME[$ext], 'data' => $data];
        }
    }
    if (!$atts) {
        fail(400, 'invalid_argument', 'The files are missing; regenerate the resume first.');
    }
    $a = mymailAcct($u['id']);
    $ok = false;
    $err = '';
    $via = '';
    if ($a) {
        $fromName = $a['name'] !== '' ? $a['name'] : (string) $u['name'];
        $raw = mymailMime($fromName, $a['email'], $tos, $cc, [], $subject, $text, '', $atts);
        [$ok, $err] = mymailSendRaw($a, $raw, array_merge($tos, $cc));
        if (!$ok) {
            $err = 'Your connected mailbox (' . $a['email'] . ') refused the message' . ($err !== '' ? ': ' . $err : '') . '. Reconnect it under My email, or disconnect it there to send from the company mailbox.';
        }
        $via = $a['email'];
        mymailDb()->prepare('INSERT INTO mail_user_msgs (id, uid, dir, at, from_email, from_name, to_email, cc, subject, text, snippet, msgid, thread, label, seen, starred, gid, err) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute([
            rid(12), $u['id'], 'out', now(), $a['email'], $fromName, implode(', ', $tos), implode(', ', $cc), mb_substr($subject, 0, 500), $text . "\n\n[Attached: " . implode(', ', array_map(fn($x) => $x['name'], $atts)) . ']', mb_substr(preg_replace('/\s+/', ' ', $text) ?? '', 0, 300), '', '', 'consultant', 1, 0, '', $ok ? '' : $err,
        ]);
        foreach ($tos as $t) {
            mymailBook($u['id'], $t, '', now());
        }
    } else {
        $html = '<div style="font:15px/1.6 Arial,sans-serif;color:#111">' . nl2br(htmlspecialchars($text, ENT_QUOTES, 'UTF-8')) . '</div>';
        $ok = sendMail($tos[0], '', $subject, $text, $html, $atts, (string) ($u['email'] ?? ''), implode(', ', array_merge(array_slice($tos, 1), $cc)));
        $err = $ok ? '' : 'The company mailbox could not send it (Admin > Email > Gmail & sending).';
        $via = 'company mailbox';
    }
    if (!$ok) {
        fail(502, 'unavailable', $err !== '' ? $err : 'The message could not be sent.');
    }
    $d->sent = array_values(array_merge((array) ($d->sent ?? []), [['at' => now(), 'to' => implode(', ', $tos), 'by' => (string) $u['name'], 'via' => $via, 'subject' => $subject]]));
    $d->st = 'sent';
    $d->u = now();
    docSet($path, $d);
    return ['ok' => true, 'via' => $via, 'to' => $tos];
}

/* ---------- routes ---------- */
function tailorRoute(string $r, array $b): never
{
    switch ($r) {
        case 'tl_status': {
            $u = requireUser();
            ok(['ai' => aiReady('tailor'), 'staff' => tailorIsStaff($u), 'resumes' => array_map(fn($x) => ['id' => (int) $x['id'], 'label' => (string) ($x['label'] ?: $x['name']), 'name' => (string) $x['name'], 'active' => (int) $x['active'] === 1, 'at' => (int) $x['created_at']], jobResumes($u['id'])), 'mymail' => (bool) mymailAcct($u['id'])]);
        }
        case 'tl_jd': {
            requireUser();
            $jd = tailorJd((string) ($b['jd'] ?? ''), ['title' => str($b, 'title', 120), 'company' => str($b, 'company', 120)]);
            unset($jd['text']);
            ok(['jd' => $jd]);
        }
        case 'tl_jds': {
            tailorStaff();
            ok(['items' => tailorJds()]);
        }
        case 'tl_find': {
            tailorStaff();
            $jdText = (string) ($b['jd'] ?? '');
            $jd = mb_strlen(trim($jdText)) >= 40 ? tailorJd($jdText, ['title' => str($b, 'title', 120)]) : [];
            session_write_close();
            @set_time_limit(120);
            $people = tailorPeople($jd, str($b, 'q', 80));
            if ($jd && empty($b['quick'])) {
                $fits = tailorAiFit($jd, $people);
                foreach ($people as &$p) {
                    $p['ai'] = $fits[$p['kind'] . ':' . $p['id']] ?? null;
                }
                unset($p);
            }
            ok(['people' => $people, 'jd' => $jd ? ['title' => $jd['title'], 'skills' => $jd['skills'], 'years' => $jd['years']] : null, 'ai' => aiReady('find')]);
        }
        case 'tl_run': {
            // JSON, or multipart when a resume file comes along (fields then arrive in $_POST)
            $u = requireUser();
            $in = $b ?: $_POST;
            $base = tailorBase($u, $in);
            if ($base !== 'rec/tl/items' && userLevel($u) < 2) {
                // v32: students and outside consultants tailor their own resume when their plan includes it
                require_once __DIR__ . '/billing.php';
                billGate($u, 'tailor');
            }
            ok(['item' => tailorRun($u, $in, $base, $base === 'rec/tl/items')]);
        }
        case 'tl_items': {
            $u = requireUser();
            $base = tailorBase($u, $b);
            $out = [];
            foreach (colAll($base) as [$id, $d]) {
                $out[] = tailorItemOut($base, (string) $id, $d, false);
            }
            usort($out, fn($a, $b2) => ($b2['u'] ?? 0) <=> ($a['u'] ?? 0));
            ok(['items' => array_slice($out, 0, 200), 'ai' => aiReady('tailor')]);
        }
        case 'tl_get': {
            $u = requireUser();
            $base = tailorBase($u, $b);
            [$d] = tailorLoad($base, (string) ($b['id'] ?? ''));
            ok(['item' => tailorItemOut($base, (string) $b['id'], $d, true)]);
        }
        case 'tl_save': {
            // the editor: new text for the sections, re-scored, files rewritten
            $u = requireUser();
            $base = tailorBase($u, $b);
            [$d, $path] = tailorLoad($base, (string) ($b['id'] ?? ''));
            $out = tailorClean($b['resume'] ?? []);
            if (!$out['experience'] && !$out['skills'] && $out['summary'] === '') {
                fail(400, 'invalid_argument', 'The resume is empty.');
            }
            $jd = json_decode(json_encode($d->jd ?? []), true) ?: [];
            $jd += ['title' => '', 'company' => '', 'loc' => '', 'years' => null, 'skills' => [], 'terms' => [], 'reqs' => [], 'text' => ''];
            // v32: what was edited is the full version; it is fitted to the chosen pages again
            $d->full = $out;
            [$out, $layout, $fitNotes, $pageN] = tailorFit($out, (int) ($d->pages ?? 0));
            $fitNotes = array_merge($fitNotes, tailorShortNote($pageN, (int) ($d->pages ?? 0), aiReady('tailor'), true));
            $d->out = $out;
            $d->layout = $layout;
            $d->fitNotes = $fitNotes;
            $d->pageN = $pageN;
            $d->after = tailorScore($out, $jd);
            $an = json_decode(json_encode($d->analysis ?? null), true);
            $d->after['fit'] = is_array($an) && !empty($an['modules']) ? tailorFitByKeywords($an, $out) : [];
            foreach (['t', 'co', 'vn'] as $k) {
                if (array_key_exists($k, $b)) {
                    $d->$k = str($b, $k, 120);
                }
            }
            $d->files = tailorFiles($path, $out, (string) ($d->jd->title ?? $d->t ?? ''), $layout);
            $d->st = ($d->st ?? '') === 'sent' ? 'sent' : 'edited';
            $d->u = now();
            docSet($path, $d);
            ok(['item' => tailorItemOut($base, (string) $b['id'], $d, true)]);
        }
        case 'tl_score': {
            // v69: the editor's draft scored against the job as it stands, nothing saved (the "Check ATS score" button
            // and "Score as I edit")
            $u = requireUser();
            $base = tailorBase($u, $b);
            [$d] = tailorLoad($base, (string) ($b['id'] ?? ''));
            $out = tailorClean($b['resume'] ?? []);
            if (!$out['experience'] && !$out['skills'] && $out['summary'] === '') {
                fail(400, 'invalid_argument', 'The resume is empty.');
            }
            $jd = json_decode(json_encode($d->jd ?? []), true) ?: [];
            $jd += ['title' => '', 'company' => '', 'loc' => '', 'years' => null, 'skills' => [], 'terms' => [], 'reqs' => [], 'text' => ''];
            $after = tailorScore($out, $jd);
            $an = json_decode(json_encode($d->analysis ?? null), true);
            $after['fit'] = is_array($an) && !empty($an['modules']) ? tailorFitByKeywords($an, $out) : [];
            ok(['after' => $after, 'saved' => (int) ($d->after->score ?? 0)]);
        }
        case 'tl_pages': {
            // v32: a different number of pages: fitted again from the full version, files rewritten
            // v33: any number up to 15; a version shorter than needed is written out first (StratEdge AI)
            $u = requireUser();
            $base = tailorBase($u, $b);
            [$d, $path] = tailorLoad($base, (string) ($b['id'] ?? ''));
            $pages = max(0, min(TL_MAX_PAGES, (int) ($b['pages'] ?? 0)));
            $full = tailorClean(json_decode(json_encode($d->full ?? $d->out ?? []), true) ?: []);
            $jd = json_decode(json_encode($d->jd ?? []), true) ?: [];
            $jd += ['title' => '', 'company' => '', 'loc' => '', 'years' => null, 'skills' => [], 'terms' => [], 'reqs' => [], 'text' => ''];
            $ai = aiReady('tailor');
            $growNotes = [];
            if ($pages > 0 && $ai && tailorPagesF($full) <= $pages - 1 + 0.55) {
                if (throttleHit('tlg:' . $u['id'], 30, 3600)) {
                    fail(429, 'rate_limited', 'That is a lot of longer resumes for one hour. Try again a little later.');
                }
                session_write_close();
                @set_time_limit(330);
                $orig = tailorClean(json_decode(json_encode($d->orig ?? []), true) ?: []);
                [$full, $growNotes, $gAdded] = tailorGrow($full, $orig, tailorText($orig), $jd, $pages, time() + 300);
                if ($gAdded) {
                    $d->added = array_values(array_unique(array_merge((array) ($d->added ?? []), $gAdded)));
                }
            }
            [$out, $layout, $fitNotes, $pageN] = tailorFit($full, $pages);
            $fitNotes = array_merge($growNotes, $fitNotes, tailorShortNote($pageN, $pages, $ai));
            $d->full = $full;
            $d->out = $out;
            $d->pages = $pages;
            $d->pageN = $pageN;
            $d->layout = $layout;
            $d->fitNotes = $fitNotes;
            $d->after = tailorScore($out, $jd);
            $an = json_decode(json_encode($d->analysis ?? null), true);
            $d->after['fit'] = is_array($an) && !empty($an['modules']) ? tailorFitByKeywords($an, $out) : [];
            $d->files = tailorFiles($path, $out, (string) ($d->jd->title ?? $d->t ?? ''), $layout);
            $d->u = now();
            docSet($path, $d);
            ok(['item' => tailorItemOut($base, (string) $b['id'], $d, true)]);
        }
        case 'tl_delete': {
            $u = requireUser();
            $base = tailorBase($u, $b);
            [$d, $path] = tailorLoad($base, (string) ($b['id'] ?? ''));
            foreach (colAll($path . '/f') as [$fid]) {
                docDelete("$path/f/$fid");
                @unlink(cfg('files_dir') . '/' . $fid);
            }
            docDelete($path);
            ok(['ok' => true]);
        }
        case 'tl_email': {
            $u = requireUser();
            $base = tailorBase($u, $b);
            [$d, $path] = tailorLoad($base, (string) ($b['id'] ?? ''));
            ok(tailorEmail($u, $d, $path, $b));
        }
        case 'tl_link': {
            // ties a logged submission to the tailored resume (both ways)
            $u = tailorStaff();
            [$d, $path] = tailorLoad('rec/tl/items', (string) ($b['id'] ?? ''));
            $sid = str($b, 'sub', 60);
            if (!preg_match('/^[A-Za-z0-9_\-]{1,60}$/', $sid)) {
                fail(400, 'invalid_argument', 'Bad submission id.');
            }
            $d->sub = $sid;
            $d->st = ($d->st ?? '') === 'sent' ? 'sent' : 'submitted';
            $d->u = now();
            docSet($path, $d);
            ok(['ok' => true]);
        }
    }
    fail(404, 'not_found', 'Unknown action.');
}
