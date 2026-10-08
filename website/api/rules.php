<?php
declare(strict_types=1);
/*
  v32: consultant types and job rules (Admin > Consultant types & job rules).

  Every consultant has a type: W2, C2C, 1099, full-time seeker, outside consultant (a membership, not placed by
  StratEdge) or student. The administrator decides which engagement types (C2C, W2, 1099, contract-to-hire,
  full-time, SOW) each type may see and apply to - e.g. C2C consultants never get full-time requirements - and can
  allow extra types for one person. The rules apply wherever jobs meet people: the consultant portal's matched
  jobs and applications, the requirements desk's matching, and requirement emails. More switches: hide roles whose
  work authorization excludes the person's status, how many applications an outside consultant may send a day,
  whether outside consultants need an active membership to apply, and what new consultant sign-ups start as.

  Settings: org/admin/x/jobrules. A person's type: r/{uid}.ct (portal accounts) or rec/cand/items/{id}.eng (the
  consultant database); extra engagement types for one person: r/{uid}.ctx.
*/

const CT_KINDS = [
    'w2' => 'W2 consultant',
    'c2c' => 'C2C consultant',
    '1099' => '1099 / independent',
    'fte' => 'Full-time job seeker',
    'outside' => 'Outside consultant (membership)',
    'student' => 'Student / trainee',
];
const ENG_KINDS = ['C2C', 'W2', '1099', 'Contract-to-hire', 'Full-time', 'SOW'];
// work authorization, normalized: what a job's "visa" text and a person's status are read as
const AUTH_KINDS = ['USC', 'GC', 'GC-EAD', 'H-1B', 'H-4 EAD', 'L-2 EAD', 'OPT', 'STEM OPT', 'CPT', 'TN', 'E-3', 'O-1', 'L-1'];

function ruleDefaults(): array
{
    $all = array_fill_keys(ENG_KINDS, true);
    return [
        'm' => [
            'w2' => $all,
            // the user's own example: C2C consultants never get full-time requirements
            'c2c' => ['Full-time' => false] + $all,
            '1099' => $all,
            'fte' => ['C2C' => false, '1099' => false, 'SOW' => false] + $all,
            'outside' => $all,
            'student' => ['C2C' => false, '1099' => false, 'SOW' => false] + $all,
        ],
        'auth' => true, // hide roles whose work authorization excludes the person's status
        'limit' => 20, // applications a day for outside consultants and students (0 = no limit)
        'newCt' => 'outside', // what a consultant who signs up on their own starts as
        'member' => true, // outside consultants need an active membership to apply through the portal
        // sign-ups that open their portal right away, without waiting for HR (the plan is the gate): students, and
        // consultants who sign up as outside consultants
        'open' => ['outside' => true, 'student' => true],
    ];
}
function ruleSettings(): array
{
    static $c = null;
    if ($c !== null) {
        return $c;
    }
    $d = docGet('org/admin/x/jobrules');
    $a = $d ? (json_decode((string) json_encode($d), true) ?: []) : [];
    $def = ruleDefaults();
    $m = $def['m'];
    foreach (CT_KINDS as $ct => $_) {
        foreach (ENG_KINDS as $e) {
            if (isset($a['m'][$ct][$e])) {
                $m[$ct][$e] = (bool) $a['m'][$ct][$e];
            }
        }
    }
    $open = $def['open'];
    foreach (['outside', 'student'] as $ct) {
        if (isset($a['open'][$ct])) {
            $open[$ct] = (bool) $a['open'][$ct];
        }
    }
    $c = [
        'm' => $m,
        'auth' => array_key_exists('auth', $a) ? (bool) $a['auth'] : $def['auth'],
        'limit' => max(0, min(500, (int) ($a['limit'] ?? $def['limit']))),
        // v33: with nothing saved yet the default applies (v32 read the missing key as '' and dropped it)
        'newCt' => array_key_exists('newCt', $a) && in_array($a['newCt'], ['outside', ''], true) ? (string) $a['newCt'] : $def['newCt'],
        'member' => array_key_exists('member', $a) ? (bool) $a['member'] : $def['member'],
        'open' => $open,
    ];
    return $c;
}
/** An engagement type in any spelling ("Corp to Corp", "C2H", "Permanent", "FTE") as one of ENG_KINDS, or '' when it
 *  says nothing (plain "Contract" fits C2C, W2 and 1099 alike, so nobody is blocked by it). */
function ruleEng(string $ty): string
{
    $t = strtolower(trim($ty));
    if ($t === '') {
        return '';
    }
    if (preg_match('/contract[\s-]*to[\s-]*hire|\bc2h\b|\bcth\b|temp[\s-]*to[\s-]*perm|right[\s-]*to[\s-]*hire/', $t)) {
        return 'Contract-to-hire';
    }
    if (preg_match('/\bc2c\b|corp[\s-]*to[\s-]*corp|corp-corp/', $t)) {
        return 'C2C';
    }
    if (preg_match('/\bw-?2\b/', $t)) {
        return 'W2';
    }
    if (preg_match('/\b1099\b/', $t)) {
        return '1099';
    }
    if (preg_match('/full[\s-]*time|\bfte\b|permanent|\bperm\b|direct[\s-]*hire|salaried/', $t)) {
        return 'Full-time';
    }
    if (preg_match('/\bsow\b|statement of work|fixed[\s-]*bid|project[\s-]*based/', $t)) {
        return 'SOW';
    }
    return '';
}
/** A portal account's type: set by an administrator, else students are students, consultants who signed up on
 *  their own are outside consultants (when that is the setting), and everyone else has no restrictions (''). */
function ruleCtOf(string $uid): string
{
    $r = myR($uid);
    $ct = (string) ($r->ct ?? '');
    if ($ct !== '' && isset(CT_KINDS[$ct])) {
        return $ct;
    }
    $role = (string) ($r->role ?? '');
    if ($role === '') {
        $u = docGet("u/$uid");
        $role = (string) ($u->p->role ?? '');
    }
    if ($role === 'student') {
        return 'student';
    }
    if ($role === 'consultant' && (!$r || ($r->st ?? '') !== 'active')) {
        return ruleSettings()['newCt'];
    }
    return '';
}
/** Extra engagement types allowed for one person (Admin > Consultant types & job rules > People). */
function ruleExtraOf(string $uid): array
{
    $r = myR($uid);
    return array_values(array_intersect(ENG_KINDS, array_map('strval', (array) ($r->ctx ?? []))));
}
/** May a person of this type (with these extra types) see and apply to this engagement type? */
function ruleAllows(string $ct, string $eng, array $extra = []): bool
{
    if ($ct === '' || $eng === '' || !isset(CT_KINDS[$ct]) || in_array($eng, $extra, true)) {
        return true;
    }
    return (bool) (ruleSettings()['m'][$ct][$eng] ?? true);
}
/** Work authorization names found in a text ("USC/GC only", "H1B ok", "OPT EAD", "No H-1B"): [listed, refused]. */
function ruleAuthIn(string $text): array
{
    $t = ' ' . strtolower($text) . ' ';
    $pat = [
        'USC' => '\b(usc|us citizens?|u\.s\. citizens?|citizens? only|citizenship)\b',
        'GC' => '\b(gc|green ?cards?|permanent residents?|lpr)\b(?![\s-]*ead)',
        'GC-EAD' => '\b(gc[\s-]*ead|aos[\s-]*ead|i-?485)\b',
        'H-1B' => '\bh[\s-]?1[\s-]?b\b|\bh1\b',
        'H-4 EAD' => '\bh[\s-]?4[\s-]*ead\b|\bh4\b',
        'L-2 EAD' => '\bl[\s-]?2[\s-]*(s|ead)?\b',
        'OPT' => '\b(opt|opt[\s-]*ead|f-?1)\b(?![\s-]*stem)',
        'STEM OPT' => '\bstem[\s-]*opt\b|\bstem[\s-]*ead\b',
        'CPT' => '\bcpt\b',
        'TN' => '\btn\b(?:[\s-]*visa)?',
        'E-3' => '\be-?3\b',
        'O-1' => '\bo-?1\b',
        'L-1' => '\bl-?1\b',
    ];
    $listed = [];
    $refused = [];
    foreach ($pat as $k => $p) {
        if (preg_match('/(no|not|without|except|excluding)\s+(any\s+)?(' . $p . ')/i', $t)) {
            $refused[] = $k;
        } elseif (preg_match('/' . $p . '/i', $t)) {
            $listed[] = $k;
        }
    }
    if (preg_match('/no (visa )?sponsorship|cannot sponsor|can\'t sponsor|unable to sponsor|without sponsorship/i', $t)) {
        foreach (['H-1B', 'OPT', 'STEM OPT', 'CPT', 'TN', 'E-3', 'O-1', 'L-1'] as $k) {
            if (!in_array($k, $listed, true)) {
                $refused[] = $k;
            }
        }
    }
    return [array_values(array_unique($listed)), array_values(array_unique($refused))];
}
/** A person's work authorization as one of AUTH_KINDS ('' when not known). */
function ruleAuthNorm(string $s): string
{
    $map = ['f1opt' => 'OPT', 'f1stem' => 'STEM OPT', 'f1cpt' => 'CPT', 'h1b' => 'H-1B', 'h4ead' => 'H-4 EAD', 'l1' => 'L-1', 'tn' => 'TN', 'e3' => 'E-3', 'o1' => 'O-1', 'gcpend' => 'GC-EAD', 'lpr' => 'GC', 'citizen' => 'USC'];
    if (isset($map[$s])) {
        return $map[$s];
    }
    [$listed] = ruleAuthIn($s);
    return $listed[0] ?? '';
}
function ruleAuthOf(string $uid): string
{
    $c = docGet("comp/$uid/profile");
    $st = ruleAuthNorm((string) ($c->st ?? ''));
    if ($st !== '') {
        return $st;
    }
    $u = docGet("u/$uid");
    return ruleAuthNorm((string) ($u->p->auth ?? ''));
}
/** Does a job's work-authorization text shut this person out? Only an explicit list ("USC/GC only") or an explicit
 *  refusal ("No H-1B", "no sponsorship") counts; a job that says nothing is open to everyone. */
function ruleAuthBlocks(string $visa, string $auth): bool
{
    if ($auth === '' || trim($visa) === '' || !ruleSettings()['auth']) {
        return false;
    }
    [$listed, $refused] = ruleAuthIn($visa);
    if (in_array($auth, $refused, true)) {
        return true;
    }
    if (!$listed) {
        return false;
    }
    // a GC-EAD holder fits a role open to green card holders; STEM OPT fits an OPT role
    $fits = [$auth];
    if ($auth === 'GC-EAD') {
        $fits[] = 'GC';
    }
    if ($auth === 'STEM OPT') {
        $fits[] = 'OPT';
    }
    if ($auth === 'USC') {
        return false; // citizens fit every role
    }
    return !array_intersect($fits, $listed);
}
/** The rules for one portal account. */
function rulePerson(string $uid): array
{
    return ['ct' => ruleCtOf($uid), 'extra' => ruleExtraOf($uid), 'auth' => ruleAuthOf($uid)];
}
/** May this person see/apply to a job with this engagement type and work-authorization text? [ok, why not]. */
function ruleJobOk(array $p, string $ty, string $visa = ''): array
{
    $eng = ruleEng($ty);
    if (!ruleAllows($p['ct'], $eng, $p['extra'])) {
        return [false, $eng . ' roles are not open to ' . strtolower(CT_KINDS[$p['ct']] ?? 'your consultant type') . 's'];
    }
    if (ruleAuthBlocks($visa, $p['auth'])) {
        return [false, 'The role\'s work authorization (' . mb_substr(trim($visa), 0, 60) . ') does not include ' . $p['auth']];
    }
    return [true, ''];
}
/** A consultant-database record's type (rec/cand/items: eng), for the desk and requirement emails. */
function ruleCtOfCand(stdClass $c): string
{
    $e = (string) ($c->eng ?? '');
    return isset(CT_KINDS[$e]) ? $e : '';
}

/* ---------- routes (Admin > Consultant types & job rules) ---------- */
function rulesStaff(): array
{
    $u = requireUser();
    if (userLevel($u) < 2) {
        fail(403, 'forbidden', 'Consultant types and job rules are for administrators and HR.');
    }
    return $u;
}
/** Portal consultants and students with their type, for the People tab. */
function rulesPeople(): array
{
    $users = [];
    foreach (colAll('u') as [$uid, $d]) {
        $users[(string) $uid] = $d;
    }
    $rs = [];
    foreach (colAll('r') as [$uid, $d]) {
        $rs[(string) $uid] = $d;
    }
    $out = [];
    foreach ($users as $uid => $u) {
        $r = $rs[$uid] ?? null;
        $role = (string) ($r->role ?? ($u->p->role ?? ''));
        if (!in_array($role, ['consultant', 'student'], true)) {
            continue;
        }
        $out[] = [
            'id' => $uid,
            'n' => (string) ($u->p->n ?? ''),
            'e' => (string) ($u->p->e ?? ''),
            'role' => $role,
            'st' => (string) ($r->st ?? 'new'),
            'ct' => (string) ($r->ct ?? ''),
            'eff' => ruleCtOf($uid),
            'ctx' => array_values(array_map('strval', (array) ($r->ctx ?? []))),
            'auth' => ruleAuthOf($uid),
        ];
    }
    usort($out, fn($a, $b) => strcasecmp($a['n'], $b['n']));
    return $out;
}
function rulesRoute(string $r, array $b): never
{
    switch ($r) {
        case 'rules_get':
            rulesStaff();
            $counts = array_fill_keys(array_keys(CT_KINDS), 0);
            $counts[''] = 0;
            $people = rulesPeople();
            foreach ($people as $p) {
                $counts[$p['eff']] = ($counts[$p['eff']] ?? 0) + 1;
            }
            $cand = array_fill_keys(array_keys(CT_KINDS), 0);
            foreach (colAll('rec/cand/items') as [, $c]) {
                $k = ruleCtOfCand($c);
                if ($k !== '') {
                    $cand[$k]++;
                }
            }
            ok(['settings' => ruleSettings(), 'kinds' => CT_KINDS, 'eng' => ENG_KINDS, 'people' => $people, 'counts' => $counts, 'cand' => $cand]);
        case 'rules_save':
            $u = rulesStaff();
            $in = (array) ($b['settings'] ?? []);
            $def = ruleDefaults();
            $m = [];
            foreach (CT_KINDS as $ct => $_) {
                foreach (ENG_KINDS as $e) {
                    $m[$ct][$e] = isset($in['m'][$ct][$e]) ? (bool) $in['m'][$ct][$e] : $def['m'][$ct][$e];
                }
            }
            $doc = [
                'm' => $m,
                'auth' => !empty($in['auth']),
                'limit' => max(0, min(500, (int) ($in['limit'] ?? 20))),
                'newCt' => in_array($in['newCt'] ?? 'outside', ['outside', ''], true) ? (string) ($in['newCt'] ?? 'outside') : 'outside',
                'member' => !empty($in['member']),
                'open' => ['outside' => !empty($in['open']['outside']), 'student' => !empty($in['open']['student'])],
                'u' => now(),
                'by' => $u['id'],
            ];
            docSet('org/admin/x/jobrules', json_decode((string) json_encode($doc)));
            ok(['ok' => true]);
        case 'rules_person':
            // one person's type and extra engagement types (creates their record when they have none yet)
            rulesStaff();
            $uid = (string) ($b['uid'] ?? '');
            if (!preg_match('/^u_[a-f0-9]{8,32}$/', $uid) || !docGet("u/$uid")) {
                fail(404, 'not_found', 'No such person.');
            }
            $ct = (string) ($b['ct'] ?? '');
            if ($ct !== '' && !isset(CT_KINDS[$ct])) {
                fail(400, 'invalid_argument', 'Unknown consultant type.');
            }
            $r = docGet("r/$uid");
            if (!$r) {
                // no status yet: an account still waiting for HR stays waiting (the portal opens on "active" only)
                $u = docGet("u/$uid");
                $r = (object) ['role' => (string) ($u->p->role ?? 'consultant')];
            }
            $r->ct = $ct;
            $r->ctx = array_values(array_intersect(ENG_KINDS, array_map('strval', (array) ($b['ctx'] ?? []))));
            $r->u = now();
            docSet("r/$uid", $r);
            ok(['ok' => true, 'eff' => ruleCtOf($uid)]);
    }
    fail(404, 'not_found', 'Unknown action.');
}
