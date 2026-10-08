<?php
declare(strict_types=1);
/*
 * v35: voice practice (Grow > Practice calls; staff: Practice & training). Routes pr_*.
 *
 * Calls: a recruiter, technical lead or hiring manager (a made-up persona at a made-up firm) asks the questions of a
 * scenario (practice_content.php) in order; the consultant answers out loud in the browser (speech recognition) or by
 * typing. Each answer is checked against the points a good answer covers, its length, filler words and hedges, and
 * the speaking pace when it was spoken; a missing key point (no rate number, no visa, no start date) gets a follow-up
 * like on a real call. With the StratEdge AI set up (feature "practice"), the caller words its lines naturally and
 * the assistant writes the feedback; without it the built-in questions and scoring work on their own.
 * Drills: listen-and-repeat sentences (word accuracy) and spoken flashcards from the skill packs.
 * Everything is kept per person (pr_sessions): their own history, and for administrators, HR and managers a team view
 * of who practises, how much, how well and where they are weak. Audio is never stored, only the words.
 */
require_once __DIR__ . '/practice_content.php';

const PR_SCHEMA = 1;
const PR_FILLERS = '/\b(um+|uh+|erm|ah+|hmm+|you know|basically|kind of|sort of|i mean)\b/iu';
const PR_HEDGES = '/\b(i think|i guess|maybe|probably|not sure|i don\'?t know|hopefully|i believe|i suppose)\b/iu';
const PR_NAMES = ['Rachel Adams', 'Mike Patel', 'Sarah Kim', 'David Brooks', 'Priya Nair', 'Kevin Moore', 'Emily Carter', 'Arjun Rao'];
const PR_FIRMS = ['BlueRiver Staffing', 'Summit IT Partners', 'Northwind Talent', 'Crestline Tech Solutions', 'Harborview Consulting'];
const PR_CLIENTS = [['a large bank', 'banking'], ['a healthcare company', 'healthcare'], ['a retail chain', 'retail'], ['an insurance company', 'insurance'], ['a telecom provider', 'telecom']];
const PR_CITIES = ['Charlotte, NC', 'Dallas, TX', 'Jersey City, NJ', 'Chicago, IL', 'Atlanta, GA', 'Phoenix, AZ'];
const PR_DIMS = ['clarity' => 'Clarity', 'content' => 'Content', 'confidence' => 'Confidence', 'technical' => 'Technical', 'handling' => 'Call handling'];

function prdb(): PDO
{
    static $ready = false;
    $p = db();
    if ($ready) {
        return $p;
    }
    $v = (int) ($p->query("SELECT v FROM meta WHERE k = 'pr_schema'")->fetchColumn() ?: 0);
    if ($v < PR_SCHEMA) {
        $p->exec('CREATE TABLE IF NOT EXISTS pr_sessions (id VARCHAR(24) PRIMARY KEY, uid VARCHAR(40) NOT NULL, kind VARCHAR(8) NOT NULL, scen VARCHAR(20) NOT NULL,
            skill VARCHAR(20) NOT NULL, lvl VARCHAR(10) NOT NULL, at BIGINT NOT NULL, ended BIGINT NOT NULL, secs INT NOT NULL, dur INT NOT NULL, turns INT NOT NULL,
            words INT NOT NULL, score INT NOT NULL, st VARCHAR(8) NOT NULL, ai INT NOT NULL, data LONGTEXT NOT NULL)');
        try {
            $p->exec('CREATE INDEX pr_sessions_uid ON pr_sessions (uid, at)');
        } catch (Throwable $e) {
            // already there
        }
        $p->prepare('REPLACE INTO meta (k, v) VALUES (?, ?)')->execute(['pr_schema', PR_SCHEMA]);
    }
    $ready = true;
    return $p;
}
function prSettings(): array
{
    $d = docGet('pr/x/settings');
    $extra = [];
    foreach ((array) ($d->extra ?? []) as $scen => $list) {
        foreach ((array) $list as $x) {
            if (is_object($x) && trim((string) ($x->q ?? '')) !== '') {
                $extra[(string) $scen][] = ['q' => (string) $x->q, 'pts' => (string) ($x->pts ?? '')];
            }
        }
    }
    return ['goal' => max(0, (int) ($d->goal ?? 3)), 'extra' => $extra];
}
/** Who a staff member sees in the team view: 'all' (administrators, HR, the HR grant), 'team' (managers: the people who
 *  report to them) or '' (nobody else). */
function prStaff(array $u): string
{
    if (hasRole($u, 'admin') || hasRole($u, 'hr') || !empty(grantsOf((string) $u['id'])['hr'])) {
        return 'all';
    }
    return hasRole($u, 'manager') ? 'team' : '';
}
function prCanSee(array $u, string $pid): bool
{
    $s = prStaff($u);
    return $pid === (string) $u['id'] || $s === 'all' || ($s === 'team' && (string) (myR($pid)->mgrId ?? '') === (string) $u['id']);
}
function prAi(): bool
{
    return aiReady('practice');
}

/** What the questions and model answers use about the person (only work facts from their profile and résumé). */
function prWho(array $u): array
{
    $d = docGet('u/' . $u['id']);
    $a = $d && isset($d->apply) && $d->apply instanceof stdClass ? get_object_vars($d->apply) : [];
    $p = $d && isset($d->p) && $d->p instanceof stdClass ? $d->p : new stdClass();
    $skills = array_values(array_filter(array_map('trim', preg_split('/[,;\n]+/', (string) ($a['skills'] ?? '')) ?: [])));
    $years = trim((string) ($a['years'] ?? ''));
    $title = trim((string) ($a['title'] ?? ($p->ti ?? '')));
    try {
        require_once __DIR__ . '/jobs.php';
        foreach (jobResumes((string) $u['id']) as $r) {
            if ((int) $r['active'] === 1 || !$skills) {
                $pr = json_decode((string) $r['profile'], true) ?: [];
                if (!$skills && !empty($pr['skills'])) {
                    $skills = array_values(array_slice(array_map('strval', (array) $pr['skills']), 0, 12));
                }
                if ($years === '' && !empty($pr['years'])) {
                    $years = (string) (int) $pr['years'];
                }
                if ($title === '' && !empty($pr['titles'][0])) {
                    $title = (string) $pr['titles'][0];
                }
                break;
            }
        }
    } catch (Throwable $e) {
        // the résumé is optional
    }
    $first = trim((string) ($a['first'] ?? '')) ?: (string) (preg_split('/\s+/', trim((string) ($p->n ?? $u['name'])))[0] ?? '');
    require_once __DIR__ . '/rules.php';
    return [
        'first' => $first ?: 'there',
        'title' => $title ?: 'IT consultant',
        'years' => $years !== '' ? $years : 'several',
        'skills' => array_slice($skills, 0, 12),
        'city' => trim((string) ($a['city'] ?? '')) ?: (trim((string) explode(',', (string) ($p->loc ?? ''))[0]) ?: '[your city]'),
        'visa' => ruleAuthOf((string) $u['id']),
    ];
}
/** The work authorization as a sentence start ("I am on an H-1B visa", "I am a US citizen"); '' when unknown. */
function prVisaStmt(string $auth): string
{
    return [
        'H-1B' => 'I am on an H-1B visa', 'OPT' => 'I am on OPT', 'STEM OPT' => 'I am on STEM OPT', 'CPT' => 'I am on CPT', 'H-4 EAD' => 'I have an H-4 EAD',
        'L-1' => 'I am on an L-1 visa', 'TN' => 'I am on a TN visa', 'E-3' => 'I am on an E-3 visa', 'O-1' => 'I am on an O-1 visa',
        'GC-EAD' => 'I have an EAD while my green card is pending', 'GC' => 'I am a green card holder', 'USC' => 'I am a US citizen',
    ][$auth] ?? ($auth !== '' ? 'I am on ' . $auth : '');
}
/** The skill pack that fits the person best (their skills and title), or the one they picked. */
function prPackFor(array $who, string $pick = ''): string
{
    $packs = prSkillPacks();
    if ($pick !== '' && isset($packs[$pick])) {
        return $pick;
    }
    $hay = mb_strtolower(implode(', ', $who['skills']) . ' ' . $who['title']);
    $best = 'general';
    $bestN = 0;
    foreach ($packs as $k => $p) {
        if ($k === 'general') {
            continue;
        }
        $n = preg_match_all('/' . $p['match'] . '/iu', $hay);
        if ($n > $bestN) {
            $best = $k;
            $bestN = $n;
        }
    }
    return $best;
}
function prFill(string $t, array $v): string
{
    return preg_replace_callback('/\{(\w+)\}/', fn($m) => array_key_exists($m[1], $v) ? (string) $v[$m[1]] : $m[0], $t) ?? $t;
}
/** A new call: the persona, the variables and the steps (technical questions taken from the pack). */
function prPlan(string $scen, string $pack, string $lvl, array $who): array
{
    $sc = prScenarios()[$scen];
    $packs = prSkillPacks();
    $qs = $packs[$pack]['qs'];
    shuffle($qs);
    $vname = PR_NAMES[array_rand(PR_NAMES)];
    $client = PR_CLIENTS[array_rand(PR_CLIENTS)];
    $skills = $who['skills'] ?: ['the technologies on my résumé'];
    // the person's own skills (".NET", "C#" and "C++" need lookarounds instead of \b)
    $re = '(?<!\w)(' . ($who['skills'] ? implode('|', array_map(fn($s) => preg_quote(mb_strtolower($s), '/'), array_slice($who['skills'], 0, 10))) . '|' : '') . 'java|python|sql|aws|azure|\.net|react|cloud|data|testing|network\w*|salesforce|sap|devops)(?!\w)';
    $vars = [
        'first' => $who['first'],
        'vname' => $vname,
        'vfirst' => explode(' ', $vname)[0],
        'vco' => PR_FIRMS[array_rand(PR_FIRMS)],
        'role' => $packs[$pack]['role'],
        'client' => $client[0],
        'domain' => $client[1],
        'city' => PR_CITIES[array_rand(PR_CITIES)],
        'skillname' => $packs[$pack]['n'],
        'skills' => implode(', ', array_slice($skills, 0, 3)),
        'skill1' => $skills[0],
        'title' => $who['title'],
        'atitle' => (preg_match('/^[aeiou]|^(it|sql|sap|aws|etl|sre|ml|ui|ux|hr|mba|fp)\b/i', $who['title']) ? 'an ' : 'a ') . $who['title'],
        'years' => $who['years'],
        'recent' => 'build and support ' . ($skills[0] ?? 'the') . ' solutions for a [industry] client',
        'mycity' => $who['city'],
        'visa' => $who['visa'] ?: '[your work authorization]',
        'visastmt' => prVisaStmt($who['visa']) ?: 'I am on [your work authorization]',
        'visayear' => (string) ((int) date('Y') + 2),
        'ratenum' => '$65',
        'lowrate' => '$55',
        'midrate' => '$60',
        'skillsre' => $re,
    ];
    $steps = [];
    $t = 0;
    foreach ($sc['steps'] as $s) {
        if (($s['k'] ?? '') === 'tech') {
            if (isset($qs[$t])) {
                $steps[] = ['k' => 'tech' . $t] + $qs[$t];
                $t++;
            }
            continue;
        }
        $steps[] = $s;
    }
    // questions administrators added for this scenario, before the closing questions
    $extra = prSettings()['extra'][$scen] ?? [];
    if ($extra) {
        $at = max(1, count($steps) - (in_array($scen, ['vendor', 'client'], true) ? 2 : 1));
        $add = [];
        foreach (array_slice($extra, 0, 5) as $i => $x) {
            $pts = [];
            foreach (array_filter(array_map('trim', explode(',', $x['pts']))) as $kw) {
                $pts[] = [$kw, '\b' . preg_quote(mb_strtolower($kw), '/') . '\w*'];
            }
            $add[] = ['k' => 'extra' . $i, 'q' => $x['q'], 'pts' => $pts, 'len' => [10, 220], 'model' => ''];
        }
        array_splice($steps, $at, 0, $add);
    }
    return ['steps' => $steps, 'vars' => $vars, 'who' => $sc['who'], 't' => $sc['t']];
}
/** How an answer covers a step: the points found and missing, words, fillers, hedges, length. */
function prEval(array $step, string $text, array $vars): array
{
    $t = mb_strtolower(preg_replace('/[^\p{L}\p{N}\s\$\%\.\-\'\/#\+@]/u', ' ', $text) ?? $text);
    $words = count(preg_split('/\s+/u', trim($t), -1, PREG_SPLIT_NO_EMPTY) ?: []);
    $hit = [];
    $miss = [];
    foreach ((array) ($step['pts'] ?? []) as $i => $p) {
        $re = str_replace('{skillsre}', $vars['skillsre'] ?? '\bzzzz\b', $p[1]);
        if (@preg_match('/' . $re . '/iu', $t) === 1) {
            $hit[] = $i;
        } else {
            $miss[] = $p[0];
        }
    }
    $n = count((array) ($step['pts'] ?? []));
    [$min, $max] = $step['len'] ?? [1, 400];
    return [
        'cov' => $n ? round(count($hit) / $n, 2) : 1.0,
        'hit' => $hit,
        'miss' => $miss,
        'words' => $words,
        'fill' => (int) preg_match_all(PR_FILLERS, $t),
        'hedge' => (int) preg_match_all(PR_HEDGES, $t),
        'len' => $words < $min ? 'short' : ($words > $max ? 'long' : 'ok'),
    ];
}
/** One AI line for the caller: the planned question (or follow-up) in natural words after a short reaction. */
function prAiSay(array $data, string $planned, bool $followup): string
{
    $v = $data['vars'];
    $hist = [];
    foreach (array_slice($data['tr'], -6) as $x) {
        $hist[] = ($x['who'] === 'v' ? 'CALLER: ' : 'CONSULTANT: ') . mb_substr((string) $x['t'], 0, 600);
    }
    $langNote = (string) ($data['lang'] ?? 'en-US') !== 'en-US' ? ' The consultant answers in ' . $data['lang'] . '; understand it, and keep your own lines in English.' : '';
    $sys = $langNote . 'You play the recruiter on a practice phone call that trains an IT consultant. You are ' . $v['vname'] . ' (' . $data['who'] . ') from ' . $v['vco'] . ', calling about a ' . $v['role'] . ' contract with ' . $v['client'] . ' in ' . $v['city'] . '. Speak like a real, busy but polite US staffing professional. Reply with JSON {"say": "..."}: at most two short sentences, first a brief natural reaction to the consultant\'s last answer (no praise, no feedback, no scoring), then the planned line in your own words. Never invent facts about the consultant. Style: ' . ['friendly' => 'warm and patient', 'typical' => 'professional and brisk', 'tough' => 'skeptical and direct'][$data['lvl']] . '.';
    $prompt = "CALL SO FAR:\n" . implode("\n", $hist) . "\n\nPLANNED " . ($followup ? 'FOLLOW-UP' : 'NEXT LINE') . ': ' . $planned;
    $payload = ['max_tokens' => 160, 'temperature' => 0.7, 'messages' => [['role' => 'system', 'content' => $sys], ['role' => 'user', 'content' => $prompt]], 'response_format' => ['type' => 'json_object']];
    [, $j] = aiPost($payload, 20);
    $t = is_array($j) ? trim((string) ($j['choices'][0]['message']['content'] ?? '')) : '';
    $d = json_decode(preg_replace('/^```(?:json)?\s*|\s*```$/m', '', $t) ?? $t, true);
    $say = is_array($d) ? trim((string) ($d['say'] ?? '')) : '';
    return $say !== '' && mb_strlen($say) < 500 ? $say : $planned;
}
/** The caller's next line after an answer: a follow-up for a missing key point, or the next question. */
function prAdvance(array &$data, string $answer, int $secs, bool $skip = false, bool $voice = false): array
{
    $steps = $data['plan'];
    $i = $data['step'];
    $step = $steps[$i];
    $v = &$data['vars'];
    // the whole answer to this step so far (a follow-up answer adds to the first one)
    $data['ans'][$i] = trim(($data['ans'][$i] ?? '') . ' ' . $answer);
    $ev = prEval($step, $data['ans'][$i], $v);
    $one = prEval($step, $answer, $v);
    $data['tr'][] = ['who' => 'me', 't' => $skip ? '' : $answer, 'skip' => $skip, 'v' => $voice && !$skip, 'at' => now(), 'step' => $i, 'secs' => $secs, 'words' => $one['words'], 'wpm' => $secs > 2 && $one['words'] > 0 ? (int) round($one['words'] / ($secs / 60)) : 0, 'fill' => $one['fill'], 'hedge' => $one['hedge']];
    if ($skip) {
        $data['fuDone'][$i] = true;
    }
    $data['ev'][$i] = $ev;
    if (($step['k'] ?? '') === 'rate' && preg_match('/\$?\b(\d{2,3})(\.\d+)?\b/', $data['ans'][$i], $m)) {
        // the negotiation continues from the person's own number
        $n = (int) $m[1];
        if ($n >= 20 && $n <= 400) {
            $v['ratenum'] = '$' . $n;
            $v['lowrate'] = '$' . (int) round($n * 0.82);
            $v['midrate'] = '$' . (int) round($n * 0.92);
        }
    }
    $fu = '';
    $done = (array) ($data['fuDone'] ?? []);
    if ($data['lvl'] !== 'friendly' && empty($done[$i])) {
        if (isset($step['fu']) && !in_array($step['fu'][0], $ev['hit'], true)) {
            $fu = $step['fu'][1];
        } elseif ($data['lvl'] === 'tough' && !empty($step['tech']) && $ev['cov'] < 0.5) {
            $fu = 'Can you be more specific? Give me a concrete example from your own project.';
        } elseif ($ev['len'] === 'short' && in_array($step['k'] ?? '', ['intro', 'project', 'challenge'], true) && ($ev['cov'] < 1 || $ev['words'] < 0.6 * (int) ($step['len'][0] ?? 0))) {
            $fu = 'Could you tell me a little more about that?';
        }
    }
    if ($fu !== '') {
        $data['fuDone'][$i] = true;
        $say = prFill($fu, $v);
        $isEnd = false;
    } else {
        $data['step'] = $i + 1;
        $next = $steps[$data['step']] ?? ['k' => 'close', 'q' => 'Thanks for your time. Goodbye!', 'end' => true];
        $say = prFill((string) $next['q'], $v);
        $isEnd = !empty($next['end']);
    }
    if ($data['ai'] && !$isEnd) {
        $say = prAiSay($data, $say, $fu !== '');
    }
    $data['tr'][] = ['who' => 'v', 't' => $say, 'at' => now(), 'step' => $data['step']];
    return ['say' => $say, 'done' => $isEnd, 'step' => $data['step'], 'of' => count($steps)];
}
/** A short name for a question in the feedback ("Your introduction", "Rate", or the start of a technical question). */
function prStepLabel(string $k, string $q): string
{
    $names = ['greet' => 'The greeting', 'intro' => 'Your introduction', 'project' => 'Your project', 'location' => 'Location', 'visa' => 'Work authorization', 'avail' => 'Availability', 'rate' => 'Your rate', 'other' => 'Other submissions', 'rtr' => 'The RTR', 'ask' => 'Your questions', 'challenge' => 'The challenging project', 'conflict' => 'The disagreement', 'deadline' => 'Tight deadlines', 'why' => 'Why you', 'issue' => 'The production issue', 'process' => 'Testing and deployment', 'push' => 'The lower budget', 'agree' => 'Confirming the terms', 'validity' => 'Validity and sponsorship', 'i9' => 'I-9 documents', 'employer' => 'Your employer', 'gaps' => 'Status gaps'];
    if (isset($names[$k])) {
        return $names[$k];
    }
    $short = mb_strlen($q) > 60 ? preg_replace('/\s+\S*$/u', '', mb_substr($q, 0, 60)) . '…' : $q;
    return '“' . $short . '”';
}
/** Scores and feedback for a finished call (built-in rules; the assistant improves them when it is set up). */
function prReport(array $data, array $who): array
{
    $steps = $data['plan'];
    $answers = [];
    $cov = [];
    $tech = [];
    $len = ['ok' => 0, 'short' => 0, 'long' => 0];
    $words = 0;
    $fill = 0;
    $hedge = 0;
    $dontKnow = 0;
    $wpm = [];
    $spoken = 0;
    $mine = 0;
    foreach ($data['tr'] as $x) {
        if ($x['who'] === 'me') {
            $mine++;
            $spoken += !empty($x['v']) ? 1 : 0;
            $words += (int) $x['words'];
            $fill += (int) $x['fill'];
            $hedge += (int) $x['hedge'];
            if (!empty($x['wpm']) && $x['words'] >= 8) {
                $wpm[] = (int) $x['wpm'];
            }
            if (preg_match('/\b(i don\'?t know|no idea|not sure)\b/i', (string) $x['t'])) {
                $dontKnow++;
            }
        }
    }
    foreach ($steps as $i => $s) {
        if (!isset($data['ev'][$i]) || empty($s['pts'])) {
            continue;
        }
        $ev = $data['ev'][$i];
        $len[$ev['len']]++;
        if (!in_array($s['k'] ?? '', ['greet', 'other'], true)) {
            $cov[] = $ev['cov'];
        }
        if (!empty($s['tech'])) {
            $tech[] = $ev['cov'];
        }
        $answers[] = ['i' => $i, 'k' => (string) ($s['k'] ?? ''), 'label' => prStepLabel((string) ($s['k'] ?? ''), prFill((string) $s['q'], $data['vars'])), 'q' => prFill((string) $s['q'], $data['vars']), 'you' => (string) ($data['ans'][$i] ?? ''), 'cov' => $ev['cov'], 'miss' => $ev['miss'], 'len' => $ev['len'], 'better' => prFill((string) ($s['model'] ?? ''), $data['vars']), 'tip' => ''];
    }
    $nAns = max(1, array_sum($len));
    $avg = fn(array $a) => $a ? array_sum($a) / count($a) : null;
    $content = (int) round(100 * ($avg($cov) ?? 0));
    $technical = $tech ? (int) round(100 * $avg($tech)) : null;
    $fillRate = $words ? 100 * $fill / $words : 0;
    $pace = $avg($wpm);
    $clarity = 100 - min(30, $fillRate * 8) - 25 * $len['short'] / $nAns - 10 * $len['long'] / $nAns - ($pace !== null && ($pace < 105 || $pace > 175) ? min(20, abs($pace - ($pace < 105 ? 105 : 175)) / 3) : 0);
    $confidence = 100 - min(40, $hedge * 8) - min(30, $dontKnow * 10) - 20 * $len['short'] / $nAns;
    $evk = fn(string $k) => array_values(array_filter($answers, fn($a) => $a['k'] === $k))[0] ?? null;
    $polite = (bool) preg_match('/\b(thank\w*|appreciate|great talking|nice talking|have a (good|great))\b/i', implode(' ', array_map(fn($x) => $x['who'] === 'me' ? $x['t'] : '', $data['tr'])));
    $checks = [];
    foreach (['rate' => 1.0, 'avail' => 1.0, 'ask' => 1.0, 'visa' => 0.5, 'challenge' => 0.67, 'issue' => 0.5, 'agree' => 0.5, 'push' => 0.67] as $k => $need) {
        if ($a = $evk($k)) {
            $checks[] = $a['cov'] >= $need ? 1 : 0;
        }
    }
    // a call that was ended before the caller's closing line is not marked down for a missing goodbye
    $finished = !empty($steps[$data['step']]['end'] ?? false);
    if ($finished) {
        $checks[] = $polite ? 1 : 0;
    }
    $checks[] = $len['ok'] / $nAns >= 0.7 ? 1 : 0;
    $handling = (int) round(100 * array_sum($checks) / max(1, count($checks)));
    $scores = ['clarity' => (int) max(0, round($clarity)), 'content' => $content, 'confidence' => (int) max(0, round($confidence)), 'technical' => $technical, 'handling' => $handling];
    $w = ['content' => 0.3, 'clarity' => 0.2, 'confidence' => 0.15, 'technical' => 0.15, 'handling' => 0.2];
    if ($technical === null) {
        $w['content'] += 0.15;
        unset($w['technical']);
    }
    $overall = 0;
    foreach ($w as $k => $x) {
        $overall += $x * (int) $scores[$k];
    }
    // what went well and what to work on
    $good = [];
    $work = [];
    if (($a = $evk('rate')) && $a['cov'] >= 1) {
        $good[] = 'You gave a clear rate with a number and the tax term (C2C or W2).';
    }
    if (($a = $evk('intro')) && $a['cov'] >= 0.75) {
        $good[] = 'Your introduction covered your experience, skills, current work and what you want next.';
    }
    if (($a = $evk('ask')) && $a['cov'] >= 1) {
        $good[] = 'You asked useful questions about the role.';
    }
    if ($words > 60 && $fillRate < 1) {
        $good[] = 'Hardly any filler words.';
    }
    if ($len['ok'] / $nAns >= 0.8) {
        $good[] = 'Your answers were the right length for a phone call.';
    }
    if ($technical !== null && $technical >= 70) {
        $good[] = 'Solid technical answers that hit the key points.';
    }
    foreach ($answers as $a) {
        if ($a['cov'] < 1 && $a['miss'] && count($work) < 3) {
            $work[] = prStepLabel($a['k'], $a['q']) . ': add ' . implode(' and ', array_slice($a['miss'], 0, 2)) . '.';
        }
    }
    if ($fillRate >= 3) {
        $work[] = 'Cut filler words like “basically” and “you know”: pause instead.';
    }
    if ($pace !== null && $pace > 175) {
        $work[] = 'Slow down: about ' . (int) $pace . ' words a minute; 130 to 160 is easy to follow on a call.';
    } elseif ($pace !== null && $pace < 105) {
        $work[] = 'Speak a little faster and more steadily: about ' . (int) $pace . ' words a minute.';
    }
    if ($len['short'] / $nAns > 0.3) {
        $work[] = ($len['short'] === 1 ? 'One answer was' : 'Several answers were') . ' very short: give one more sentence with a specific example.';
    }
    if ($hedge >= 2) {
        $work[] = 'Avoid “I think” and “maybe” when you state facts about your own experience.';
    }
    if (!$polite && $finished) {
        $work[] = 'Close with a thank-you: recruiters remember a courteous call.';
    }
    $rep = [
        'overall' => (int) round($overall),
        'scores' => $scores,
        'good' => array_slice($good, 0, 4),
        'work' => array_slice($work, 0, 5),
        'answers' => $answers,
        'stats' => ['words' => $words, 'fillers' => $fill, 'hedges' => $hedge, 'wpm' => $pace !== null ? (int) round($pace) : null, 'answers' => $nAns, 'voice' => $mine ? (int) round(100 * $spoken / $mine) : 0],
        'by' => 'rules',
    ];
    if ($data['ai'] && $answers) {
        $rep = prAiCoach($data, $rep, $who);
    }
    return $rep;
}
/** The assistant's feedback on top of the built-in scoring (kept when it does not answer). */
function prAiCoach(array $data, array $rep, array $who): array
{
    $lines = [];
    foreach ($data['tr'] as $x) {
        $lines[] = ($x['who'] === 'v' ? 'CALLER: ' : 'CONSULTANT: ') . mb_substr((string) $x['t'], 0, 1200);
    }
    $qs = [];
    foreach ($rep['answers'] as $n => $a) {
        $qs[] = '#' . $n . ' QUESTION: ' . $a['q'] . "\nANSWER: " . mb_substr($a['you'], 0, 1500) . "\nMISSING POINTS (by a keyword check): " . ($a['miss'] ? implode('; ', $a['miss']) : 'none');
    }
    $langNote2 = (string) ($data['lang'] ?? 'en-US') !== 'en-US' ? ' The consultant answered in ' . $data['lang'] . ': judge the substance of the answers in that language and coach in English, noting when an answer would need to be in English on a real call.' : '';
    $sys = 'You coach IT consultants in the US staffing market after a practice phone call with a recruiter, technical lead or hiring manager. Be specific, kind and honest.' . $langNote2 . ' Return JSON {"overall": 0-100, "scores": {"clarity": 0-100, "content": 0-100, "confidence": 0-100, "technical": 0-100 or null, "handling": 0-100}, "good": [up to 4 short strings], "work": [up to 5 short, actionable strings], "answers": [{"n": number, "tip": one sentence, "better": a stronger answer of 2-4 sentences in first person}]}. Better answers must only use facts from the consultant\'s answers and profile; where a fact is unknown, write a [placeholder] such as [your rate]. Do not mention scoring rules or keywords.';
    $prompt = 'SCENARIO: ' . $data['title'] . "\nPROFILE: " . $who['title'] . ', ' . $who['years'] . ' years, skills: ' . implode(', ', array_slice($who['skills'], 0, 8)) . "\nMEASURED: " . json_encode($rep['stats']) . ' built-in scores ' . json_encode($rep['scores']) . "\n\nTRANSCRIPT:\n" . implode("\n", $lines) . "\n\nANSWERS:\n" . implode("\n\n", $qs);
    $j = aiJson($sys, $prompt, 2500);
    if (!is_array($j)) {
        return $rep;
    }
    $num = fn($x) => is_numeric($x) ? max(0, min(100, (int) round((float) $x))) : null;
    if ($num($j['overall'] ?? null) !== null) {
        $rep['overall'] = $num($j['overall']);
    }
    foreach (array_keys(PR_DIMS) as $k) {
        if (isset($j['scores'][$k]) && $num($j['scores'][$k]) !== null && ($k !== 'technical' || $rep['scores']['technical'] !== null)) {
            $rep['scores'][$k] = $num($j['scores'][$k]);
        }
    }
    $strs = fn($a, int $n) => array_values(array_slice(array_filter(array_map(fn($x) => mb_substr(trim((string) $x), 0, 300), (array) $a)), 0, $n));
    if ($g = $strs($j['good'] ?? [], 4)) {
        $rep['good'] = $g;
    }
    if ($w = $strs($j['work'] ?? [], 5)) {
        $rep['work'] = $w;
    }
    foreach ((array) ($j['answers'] ?? []) as $x) {
        $n = (int) ($x['n'] ?? -1);
        if (isset($rep['answers'][$n])) {
            $rep['answers'][$n]['tip'] = mb_substr(trim((string) ($x['tip'] ?? '')), 0, 400);
            $b = trim((string) ($x['better'] ?? ''));
            if ($b !== '') {
                $rep['answers'][$n]['better'] = mb_substr($b, 0, 1200);
            }
        }
    }
    $rep['by'] = 'ai';
    return $rep;
}
/** Word accuracy of a repeated sentence: the share of the sentence's words said in order, and the missed ones. */
function prRepeatScore(string $target, string $said): array
{
    $norm = function (string $s): array {
        $s = mb_strtolower(str_replace(['’', '‘'], "'", $s));
        $s = strtr($s, ["i'm" => 'i am', "don't" => 'do not', "it's" => 'it is', "we're" => 'we are', "can't" => 'cannot', "i'll" => 'i will', "that's" => 'that is', "won't" => 'will not', "i've" => 'i have', "you're" => 'you are', "let's" => 'let us', "i'd" => 'i would', 'e-mail' => 'email', 'corp to corp' => 'c2c', 'corp-to-corp' => 'c2c', 'c to c' => 'c2c', 'w 2' => 'w2', 'w-2' => 'w2']);
        // "I-94", "I 94" and "i94" are the same word; "$65", "65 dollars" and "65" too
        $s = preg_replace('/\b([a-z])[\s\-](\d{1,3})\b/u', '$1$2', $s) ?? $s;
        $s = preg_replace('/\b(dollars?|bucks)\b/u', ' ', $s) ?? $s;
        $s = preg_replace('/[^\p{L}\p{N} ]+/u', ' ', $s) ?? $s;
        return array_values(array_filter(explode(' ', $s), fn($w) => $w !== ''));
    };
    $a = $norm($target);
    $b = $norm($said);
    $n = count($a);
    $m = count($b);
    $L = array_fill(0, $n + 1, array_fill(0, $m + 1, 0));
    for ($i = $n - 1; $i >= 0; $i--) {
        for ($j = $m - 1; $j >= 0; $j--) {
            $L[$i][$j] = $a[$i] === $b[$j] ? $L[$i + 1][$j + 1] + 1 : max($L[$i + 1][$j], $L[$i][$j + 1]);
        }
    }
    $missed = [];
    for ($i = 0, $j = 0; $i < $n;) {
        if ($j < $m && $a[$i] === $b[$j]) {
            $i++;
            $j++;
        } elseif ($j < $m && $L[$i][$j + 1] >= $L[$i + 1][$j]) {
            $j++;
        } else {
            $missed[] = $a[$i];
            $i++;
        }
    }
    return ['acc' => $n ? (int) round(100 * $L[0][0] / $n) : 0, 'missed' => $missed];
}
function prOut(array $r, bool $full = false): array
{
    $d = json_decode((string) $r['data'], true) ?: [];
    $o = ['id' => (string) $r['id'], 'kind' => (string) $r['kind'], 'scen' => (string) $r['scen'], 'skill' => (string) $r['skill'], 'lvl' => (string) $r['lvl'], 'at' => (int) $r['at'], 'ended' => (int) $r['ended'], 'dur' => (int) $r['dur'], 'secs' => (int) $r['secs'], 'turns' => (int) $r['turns'], 'words' => (int) $r['words'], 'score' => (int) $r['score'], 'st' => (string) $r['st'], 'ai' => (int) $r['ai'] === 1, 'title' => (string) ($d['title'] ?? ''), 'scores' => $d['report']['scores'] ?? null];
    if ($full) {
        $o['tr'] = array_map(fn($x) => ['who' => $x['who'], 't' => $x['t'], 'secs' => (int) ($x['secs'] ?? 0), 'wpm' => (int) ($x['wpm'] ?? 0), 'skip' => !empty($x['skip']), 'v' => !empty($x['v'])], (array) ($d['tr'] ?? []));
        $o['report'] = $d['report'] ?? null;
        $o['items'] = $d['items'] ?? null;
        $o['persona'] = isset($d['vars']) ? ['name' => $d['vars']['vname'], 'co' => $d['vars']['vco'], 'who' => $d['who'] ?? '', 'role' => $d['vars']['role'], 'client' => $d['vars']['client'], 'city' => $d['vars']['city']] : null;
    }
    return $o;
}
function prRow(string $id): array
{
    $s = prdb()->prepare('SELECT * FROM pr_sessions WHERE id = ?');
    $s->execute([$id]);
    $r = $s->fetch();
    if (!$r) {
        fail(404, 'not_found', 'That practice session is not there.');
    }
    return $r;
}
function prSave(string $id, array $data, array $set): void
{
    $set['data'] = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $cols = implode(', ', array_map(fn($k) => "$k = ?", array_keys($set)));
    prdb()->prepare("UPDATE pr_sessions SET $cols WHERE id = ?")->execute([...array_values($set), $id]);
}
/** The Mondays (00:00 in the organization's time zone, as Unix seconds) of this week and the $n weeks before it, oldest
 *  first: weeks follow the office calendar, not the server clock. */
function prWeekStarts(int $n): array
{
    $tz = new DateTimeZone((string) (cfg('timezone') ?: 'America/New_York'));
    $mon = new DateTimeImmutable('monday this week', $tz);
    $out = [];
    for ($w = $n; $w >= 0; $w--) {
        $out[] = $mon->modify('-' . $w . ' weeks')->getTimestamp();
    }
    return $out;
}
function prDay(int $t): string
{
    return (new DateTimeImmutable('@' . $t))->setTimezone(new DateTimeZone((string) (cfg('timezone') ?: 'America/New_York')))->format('Y-m-d');
}
/** A person's practice in numbers: last 30 days and this week. */
function prStats(string $uid): array
{
    $since = now() - 30 * 86400000;
    $s = prdb()->prepare("SELECT kind, score, dur, at, data FROM pr_sessions WHERE uid = ? AND st = 'done' AND at > ? ORDER BY at DESC");
    $s->execute([$uid, $since]);
    $rows = $s->fetchAll();
    $calls = array_values(array_filter($rows, fn($r) => $r['kind'] === 'call'));
    $week = prWeekStarts(0)[0] * 1000;
    $dims = [];
    foreach ($calls as $r) {
        $d = json_decode((string) $r['data'], true) ?: [];
        foreach ((array) ($d['report']['scores'] ?? []) as $k => $v) {
            if ($v !== null) {
                $dims[$k][] = (int) $v;
            }
        }
    }
    $avgDims = array_map(fn($a) => (int) round(array_sum($a) / count($a)), $dims);
    asort($avgDims);
    $recent = array_slice($calls, 0, 5);
    $before = array_slice($calls, 5, 5);
    $av = fn(array $a) => $a ? (int) round(array_sum(array_map(fn($r) => (int) $r['score'], $a)) / count($a)) : null;
    return [
        'calls30' => count($calls),
        'drills30' => count($rows) - count($calls),
        'minutes30' => (int) round(array_sum(array_map(fn($r) => (int) $r['dur'], $rows)) / 60),
        'avg30' => $av($calls),
        'best30' => $calls ? max(array_map(fn($r) => (int) $r['score'], $calls)) : null,
        'trend' => $av($recent) !== null && $av($before) !== null ? $av($recent) - $av($before) : null,
        'weak' => $avgDims ? (string) array_key_first($avgDims) : '',
        'dims' => $avgDims,
        'week' => count(array_filter($calls, fn($r) => (int) $r['at'] >= $week)),
        'last' => $rows ? (int) $rows[0]['at'] : 0,
    ];
}

/** A call worth feedback: at least one real question (not only the greeting) was answered, not skipped. */
function prAnsweredSomething(array $data): bool
{
    foreach ((array) ($data['tr'] ?? []) as $x) {
        if (($x['who'] ?? '') === 'me' && empty($x['skip']) && trim((string) ($x['t'] ?? '')) !== '' && (($data['plan'][(int) ($x['step'] ?? 0)]['k'] ?? '') !== 'greet')) {
            return true;
        }
    }
    return false;
}
/** Calls left open (the tab was closed mid-call) are finished after an hour with the built-in scoring, or removed
 *  when nothing was answered. */
function prSweep(string $uid, array $u): void
{
    $s = prdb()->prepare("SELECT * FROM pr_sessions WHERE uid = ? AND st = 'live' AND at < ?");
    $s->execute([$uid, now() - 3600000]);
    foreach ($s->fetchAll() as $row) {
        $data = json_decode((string) $row['data'], true) ?: [];
        if (!prAnsweredSomething($data)) {
            prdb()->prepare('DELETE FROM pr_sessions WHERE id = ?')->execute([(string) $row['id']]);
            continue;
        }
        $data['ai'] = false;
        $data['report'] = prReport($data, prWho($u));
        $data['report']['left'] = true;
        $last = max(array_map(fn($x) => (int) ($x['at'] ?? 0), $data['tr']));
        prSave((string) $row['id'], $data, ['st' => 'done', 'ended' => $last, 'dur' => min(3600, max(1, (int) round(($last - (int) $row['at']) / 1000))), 'score' => (int) $data['report']['overall']]);
    }
}

function prRoute(string $r, array $b): never
{
    $u = requireUser();
    $uid = (string) $u['id'];
    require_once __DIR__ . '/billing.php';
    // students and outside consultants practise with a plan that has mock interviews (StratEdge's own consultants,
    // employees and staff always can); the home page loads either way and shows what unlocks it
    $can = prStaff($u) !== '' || billCan($uid, 'mentor') || userLevel($u) >= 2;
    if (!$can && in_array($r, ['pr_start', 'pr_turn', 'pr_end', 'pr_check', 'pr_drill_items', 'pr_drill_save'], true)) {
        billGate($u, 'mentor');
    }
    switch ($r) {
        case 'pr_check':
            // one drill item checked as the person goes (nothing is saved until pr_drill_save)
            if (throttleHit('prcheck:' . $uid, 600, 3600)) {
                fail(429, 'rate_limited', 'Slow down a little: too many checks in an hour.');
            }
            $said = mb_substr(trim(str($b, 'said', 3000)), 0, 3000);
            if (str($b, 'kind', 8) === 'cards') {
                $who = prWho($u);
                $qs = prSkillPacks()[prPackFor($who, str($b, 'skill', 20))]['qs'];
                $q = $qs[(int) ($b['i'] ?? -1)] ?? null;
                if (!$q) {
                    fail(400, 'invalid_argument', 'That question is not there.');
                }
                $ev = prEval($q, $said, ['skillsre' => '\bzzzz\b']);
                ok(['acc' => (int) round(100 * $ev['cov']), 'missed' => $ev['miss'], 'pts' => array_map(fn($p) => $p[0], $q['pts']), 'better' => $q['model'], 'words' => $ev['words']]);
            }
            ok(prRepeatScore(str($b, 't', 400), $said));
        case 'pr_remind':
            $scope = prStaff($u);
            if ($scope === '') {
                fail(403, 'forbidden', 'Reminders are sent by administrators, HR and managers.');
            }
            $goal = prSettings()['goal'];
            $sent = 0;
            $skipped = 0;
            foreach (array_slice(array_unique(array_map('strval', (array) ($b['uids'] ?? []))), 0, 200) as $pid) {
                $p = userRow($pid);
                if (!$p || (string) $p['status'] !== 'active' || !prCanSee($u, $pid) || throttleHit('prremind:' . $pid, 1, 20 * 3600)) {
                    $skipped++;
                    continue;
                }
                $st = prStats($pid);
                $first = explode(' ', trim((string) $p['name']))[0] ?: 'there';
                $paras = [
                    'Hi ' . $first . ',',
                    $st['calls30'] ? 'Thanks for practising: you did ' . $st['calls30'] . ' practice call' . ($st['calls30'] === 1 ? '' : 's') . ' in the last 30 days' . ($st['avg30'] !== null ? ' with an average score of ' . $st['avg30'] : '') . '.' : 'You have not tried a practice call yet.',
                    $goal ? 'The team goal is ' . $goal . ' practice call' . ($goal === 1 ? '' : 's') . ' a week; this week you have done ' . $st['week'] . '. A call takes about ten minutes: a recruiter, technical lead or hiring manager asks the questions and you answer out loud.' : 'A call takes about ten minutes: a recruiter, technical lead or hiring manager asks the questions and you answer out loud.',
                    trim(str($b, 'note', 400)) !== '' ? 'Note from ' . (string) $u['name'] . ': ' . str($b, 'note', 400) : '',
                ];
                $paras = array_values(array_filter($paras));
                $link = siteUrl() . '#/portal/practice';
                if (sendMail((string) $p['email'], (string) $p['name'], 'A practice call this week?', implode("\n\n", $paras) . "\n\nStart a practice call: " . $link . "\n\nStratEdge IT Consulting", emailHtml('A practice call this week?', $paras, ['Start a practice call', $link]))) {
                    $sent++;
                } else {
                    $skipped++;
                }
            }
            audit('people', 'Practice reminders sent', 'practice', ['sent' => $sent, 'skipped' => $skipped], $u);
            ok(['sent' => $sent, 'skipped' => $skipped]);
        case 'pr_home':
            prSweep($uid, $u);
            $who = prWho($u);
            $pack = prPackFor($who);
            $scs = [];
            foreach (prScenarios() as $k => $sc) {
                $scs[] = ['k' => $k, 't' => $sc['t'], 'd' => str_replace('{skillname}', prSkillPacks()[$pack]['n'], $sc['d']), 'who' => $sc['who'], 'n' => count(array_filter($sc['steps'], fn($s) => empty($s['end'])))];
            }
            $s = prdb()->prepare('SELECT * FROM pr_sessions WHERE uid = ? AND st = ? ORDER BY at DESC LIMIT 30');
            $s->execute([$uid, 'done']);
            ok([
                'scenarios' => $scs,
                'packs' => array_map(fn($k, $p) => ['k' => $k, 'n' => $p['n']], array_keys(prSkillPacks()), prSkillPacks()),
                'pack' => $pack,
                'sets' => array_map(fn($k, $x) => ['k' => $k, 'n' => $x['n']], array_keys(prRepeatSets()), prRepeatSets()),
                'ai' => prAi(),
                'goal' => prSettings()['goal'],
                'stats' => prStats($uid),
                'recent' => array_map('prOut', $s->fetchAll()),
                'profile' => ['title' => $who['title'], 'skills' => $who['skills'], 'years' => $who['years'], 'visa' => $who['visa']],
                'staff' => prStaff($u) !== '',
                'can' => $can,
            ]);
        case 'pr_start':
            if (throttleHit('prstart:' . $uid, 60, 86400)) {
                fail(429, 'rate_limited', 'That is a lot of practice for one day. Come back tomorrow.');
            }
            $scen = str($b, 'scen', 20);
            if (!isset(prScenarios()[$scen])) {
                fail(400, 'invalid_argument', 'Pick a scenario.');
            }
            $who = prWho($u);
            $pack = prPackFor($who, str($b, 'skill', 20));
            $lvl = in_array(str($b, 'lvl', 10), ['friendly', 'typical', 'tough'], true) ? str($b, 'lvl', 10) : 'typical';
            $plan = prPlan($scen, $pack, $lvl, $who);
            $lang = preg_match('/^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$/', str($b, 'lang', 16)) ? str($b, 'lang', 16) : 'en-US'; // v68: the language the consultant answers in
            $data = ['plan' => $plan['steps'], 'vars' => $plan['vars'], 'who' => $plan['who'], 'title' => $plan['t'], 'lvl' => $lvl, 'step' => 0, 'ans' => [], 'ev' => [], 'fuDone' => [], 'tr' => [], 'ai' => prAi(), 'lang' => $lang];
            $first = prFill((string) $plan['steps'][0]['q'], $plan['vars']);
            $data['tr'][] = ['who' => 'v', 't' => $first, 'at' => now(), 'step' => 0];
            $id = rid(8);
            prdb()->prepare('INSERT INTO pr_sessions (id, uid, kind, scen, skill, lvl, at, ended, secs, dur, turns, words, score, st, ai, data) VALUES (?,?,?,?,?,?,?,0,0,0,0,0,0,?,?,?)')
                ->execute([$id, $uid, 'call', $scen, $pack, $lvl, now(), 'live', $data['ai'] ? 1 : 0, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
            ok(['id' => $id, 'say' => $first, 'step' => 0, 'of' => count($plan['steps']), 'persona' => ['name' => $plan['vars']['vname'], 'co' => $plan['vars']['vco'], 'who' => $plan['who'], 'role' => $plan['vars']['role'], 'client' => $plan['vars']['client'], 'city' => $plan['vars']['city']], 'title' => $plan['t'], 'skill' => prSkillPacks()[$pack]['n'], 'ai' => $data['ai']]);
        case 'pr_turn':
            session_write_close();
            @set_time_limit(60);
            $row = prRow(str($b, 'id', 24));
            if ((string) $row['uid'] !== $uid || $row['st'] !== 'live') {
                fail(400, 'invalid_argument', 'This call has ended.');
            }
            if (throttleHit('prturn:' . $uid, 400, 3600)) {
                fail(429, 'rate_limited', 'Slow down a little: too many answers in an hour.');
            }
            $skip = !empty($b['skip']);
            $text = $skip ? '' : mb_substr(trim(str($b, 'text', 4000)), 0, 4000);
            if ($text === '' && !$skip) {
                fail(400, 'invalid_argument', 'Say or type your answer first.');
            }
            $secs = max(0, min(600, (int) ($b['secs'] ?? 0)));
            $data = json_decode((string) $row['data'], true);
            if ($data['step'] >= count($data['plan']) || !empty($data['plan'][$data['step']]['end'])) {
                fail(400, 'invalid_argument', 'The call is over: end it to see your feedback.');
            }
            $next = prAdvance($data, $text, $secs, $skip, !empty($b['voice']));
            $mine = array_filter($data['tr'], fn($x) => $x['who'] === 'me');
            prSave((string) $row['id'], $data, ['turns' => count($mine), 'words' => array_sum(array_map(fn($x) => (int) $x['words'], $mine)), 'secs' => array_sum(array_map(fn($x) => (int) $x['secs'], $mine))]);
            ok($next);
        case 'pr_end':
            session_write_close();
            @set_time_limit(150);
            $row = prRow(str($b, 'id', 24));
            if ((string) $row['uid'] !== $uid) {
                fail(403, 'forbidden', 'This is not your call.');
            }
            $data = json_decode((string) $row['data'], true);
            if ($row['st'] === 'live') {
                if (!prAnsweredSomething($data)) {
                    prdb()->prepare('DELETE FROM pr_sessions WHERE id = ?')->execute([(string) $row['id']]);
                    ok(['deleted' => true]);
                }
                $data['report'] = prReport($data, prWho($u));
                $dur = max(1, (int) round((now() - (int) $row['at']) / 1000));
                prSave((string) $row['id'], $data, ['st' => 'done', 'ended' => now(), 'dur' => min($dur, 3600), 'score' => (int) $data['report']['overall']]);
            }
            ok(['session' => prOut(prRow((string) $row['id']), true)]);
        case 'pr_get':
            $row = prRow(str($b, 'id', 24));
            if (!prCanSee($u, (string) $row['uid'])) {
                fail(403, 'forbidden', 'You can only open your own practice.');
            }
            ok(['session' => prOut($row, true)]);
        case 'pr_drill_items':
            $who = prWho($u);
            $kind = str($b, 'kind', 8) === 'cards' ? 'cards' : 'repeat';
            if ($kind === 'repeat') {
                $sets = prRepeatSets();
                $set = isset($sets[str($b, 'set', 12)]) ? str($b, 'set', 12) : 'intro';
                $vars = prPlan('vendor', prPackFor($who), 'friendly', $who)['vars'];
                $items = [];
                foreach ($sets[$set]['s'] as $i => $t) {
                    // a sentence about something the profile does not say (no skills, no work authorization) is left out
                    if ((!$who['skills'] && preg_match('/\{(skills|recent|skill1)\}/', $t)) || ($who['visa'] === '' && str_contains($t, '{visa'))) {
                        continue;
                    }
                    $items[] = ['i' => $i, 't' => prFill($t, $vars)];
                }
                ok(['kind' => 'repeat', 'set' => $set, 'n' => $sets[$set]['n'], 'items' => $items, 'missing' => array_values(array_filter([!$who['skills'] ? 'skills' : '', $who['visa'] === '' ? 'work authorization' : '']))]);
            }
            $pack = prPackFor($who, str($b, 'skill', 20));
            $qs = prSkillPacks()[$pack]['qs'];
            ok(['kind' => 'cards', 'skill' => $pack, 'n' => prSkillPacks()[$pack]['n'], 'items' => array_map(fn($q, $i) => ['i' => $i, 'q' => $q['q']], $qs, array_keys($qs))]);
        case 'pr_drill_save':
            $kind = str($b, 'kind', 8) === 'cards' ? 'cards' : 'repeat';
            $who = prWho($u);
            $items = array_slice((array) ($b['items'] ?? []), 0, 12);
            $out = [];
            $secs = 0;
            if ($kind === 'repeat') {
                $sets = prRepeatSets();
                $set = isset($sets[str($b, 'set', 12)]) ? str($b, 'set', 12) : 'intro';
                foreach ($items as $x) {
                    $t = mb_substr(trim((string) ($x['t'] ?? '')), 0, 400);
                    $said = mb_substr(trim((string) ($x['said'] ?? '')), 0, 600);
                    if ($t === '') {
                        continue;
                    }
                    $out[] = ['t' => $t, 'said' => $said] + prRepeatScore($t, $said);
                    $secs += max(0, min(120, (int) ($x['secs'] ?? 0)));
                }
                $title = 'Listen and repeat: ' . $sets[$set]['n'];
                $skill = $set;
            } else {
                $pack = prPackFor($who, str($b, 'skill', 20));
                $qs = prSkillPacks()[$pack]['qs'];
                $vars = ['skillsre' => '\bzzzz\b'];
                foreach ($items as $x) {
                    $i = (int) ($x['i'] ?? -1);
                    if (!isset($qs[$i])) {
                        continue;
                    }
                    $said = mb_substr(trim((string) ($x['said'] ?? '')), 0, 3000);
                    $ev = prEval($qs[$i], $said, $vars);
                    $out[] = ['q' => $qs[$i]['q'], 'said' => $said, 'acc' => (int) round(100 * $ev['cov']), 'missed' => $ev['miss'], 'better' => $qs[$i]['model']];
                    $secs += max(0, min(300, (int) ($x['secs'] ?? 0)));
                }
                $title = 'Spoken flashcards: ' . prSkillPacks()[$pack]['n'];
                $skill = $pack;
            }
            if (!$out) {
                fail(400, 'invalid_argument', 'Answer at least one item first.');
            }
            $score = (int) round(array_sum(array_column($out, 'acc')) / count($out));
            $id = rid(8);
            prdb()->prepare('INSERT INTO pr_sessions (id, uid, kind, scen, skill, lvl, at, ended, secs, dur, turns, words, score, st, ai, data) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)')
                ->execute([$id, $uid, 'drill', $kind, $skill, '', now(), now(), $secs, max(30, $secs + 10 * count($out)), count($out), 0, $score, 'done', json_encode(['title' => $title, 'items' => $out], JSON_UNESCAPED_UNICODE)]);
            ok(['id' => $id, 'score' => $score, 'items' => $out]);
        case 'pr_team':
            $scope = prStaff($u);
            if ($scope === '') {
                fail(403, 'forbidden', 'The team view is for administrators, HR and managers.');
            }
            // everyone who practised, plus the active consultants and students who have not started yet
            $ids = [];
            $s = prdb()->query("SELECT uid, COUNT(*) AS n FROM pr_sessions WHERE st = 'done' GROUP BY uid");
            foreach ($s->fetchAll() as $x) {
                $ids[(string) $x['uid']] = (int) $x['n'];
            }
            foreach (colAll('r') as [$rid, $r]) {
                if (in_array((string) ($r->role ?? ''), ['consultant', 'student'], true) && (string) ($r->st ?? '') === 'active') {
                    $ids[(string) $rid] = $ids[(string) $rid] ?? 0;
                }
            }
            $people = [];
            foreach ($ids as $pid => $n) {
                $pid = (string) $pid;
                if ($scope === 'team' && (string) (myR($pid)->mgrId ?? '') !== $uid) {
                    continue;
                }
                $p = userRow($pid);
                if (!$p || ($n === 0 && (string) $p['status'] !== 'active')) {
                    continue;
                }
                $people[] = ['uid' => $pid, 'n' => (string) $p['name'], 'e' => (string) $p['email'], 'role' => portalOf($pid), 'total' => $n] + prStats($pid);
                if (count($people) >= 1000) {
                    break;
                }
            }
            usort($people, fn($a, $b) => [$b['last'], $a['n']] <=> [$a['last'], $b['n']]);
            // the last eight weeks: sessions, minutes and the average call score (only the people in this view)
            $weeks = [];
            $starts = prWeekStarts(7);
            $in = array_flip(array_column($people, 'uid'));
            $s = prdb()->prepare("SELECT uid, kind, at, dur, score FROM pr_sessions WHERE st = 'done' AND at >= ?");
            $s->execute([$starts[0] * 1000]);
            foreach ($starts as $i => $t) {
                $weeks[] = ['from' => prDay($t), 'calls' => 0, 'drills' => 0, 'min' => 0, 'sum' => 0, 'people' => []];
            }
            foreach ($s->fetchAll() as $x) {
                if (!isset($in[(string) $x['uid']])) {
                    continue;
                }
                $w = -1;
                foreach ($starts as $i => $t) {
                    if ((int) $x['at'] >= $t * 1000) {
                        $w = $i;
                    }
                }
                if ($w < 0) {
                    continue;
                }
                $k = $x['kind'] === 'call' ? 'calls' : 'drills';
                $weeks[$w][$k]++;
                $weeks[$w]['min'] += (int) $x['dur'];
                $weeks[$w]['people'][(string) $x['uid']] = 1;
                if ($x['kind'] === 'call') {
                    $weeks[$w]['sum'] += (int) $x['score'];
                }
            }
            $weeks = array_map(fn($w) => ['from' => $w['from'], 'calls' => $w['calls'], 'drills' => $w['drills'], 'min' => (int) round($w['min'] / 60), 'avg' => $w['calls'] ? (int) round($w['sum'] / $w['calls']) : null, 'people' => count($w['people'])], $weeks);
            $set = prSettings();
            ok(['people' => $people, 'weeks' => $weeks, 'scope' => $scope, 'goal' => $set['goal'], 'extra' => $set['extra'], 'dims' => PR_DIMS, 'ai' => prAi(), 'canEdit' => hasRole($u, 'admin') || hasRole($u, 'hr'), 'scenarios' => array_map(fn($k, $sc) => ['k' => $k, 't' => $sc['t']], array_keys(prScenarios()), prScenarios())]);
        case 'pr_person':
            $pid = str($b, 'uid', 40);
            if (prStaff($u) === '' || !prCanSee($u, $pid)) {
                fail(403, 'forbidden', 'The team view is for administrators, HR and managers (their own team).');
            }
            $s = prdb()->prepare('SELECT * FROM pr_sessions WHERE uid = ? AND st = ? ORDER BY at DESC LIMIT 100');
            $s->execute([$pid, 'done']);
            $p = userRow($pid);
            ok(['name' => (string) ($p['name'] ?? ''), 'e' => (string) ($p['email'] ?? ''), 'stats' => prStats($pid), 'sessions' => array_map('prOut', $s->fetchAll())]);
        case 'pr_settings_save':
            if (!hasRole($u, 'admin') && !hasRole($u, 'hr')) {
                fail(403, 'forbidden', 'Only administrators and HR change the practice settings.');
            }
            $extra = new stdClass();
            foreach ((array) ($b['extra'] ?? []) as $scen => $list) {
                if (!isset(prScenarios()[(string) $scen])) {
                    continue;
                }
                $rows = [];
                foreach (array_slice((array) $list, 0, 5) as $x) {
                    $q = mb_substr(trim((string) ($x['q'] ?? '')), 0, 300);
                    if ($q !== '') {
                        $rows[] = (object) ['q' => $q, 'pts' => mb_substr(trim((string) ($x['pts'] ?? '')), 0, 300)];
                    }
                }
                if ($rows) {
                    $extra->{(string) $scen} = $rows;
                }
            }
            docSet('pr/x/settings', (object) ['goal' => max(0, min(20, (int) ($b['goal'] ?? 3))), 'extra' => $extra, 'u' => now(), 'by' => $uid]);
            audit('settings', 'Practice settings changed', 'practice', ['goal' => (int) ($b['goal'] ?? 3)], $u);
            ok(prSettings());
        default:
            fail(404, 'not_found', 'Unknown action.');
    }
}
