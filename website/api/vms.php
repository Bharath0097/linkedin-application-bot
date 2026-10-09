<?php
declare(strict_types=1);
/*
  Vendor management: the vendors and clients StratEdge works with, the requirements desk (requirements that come
  in from client contacts, vendor emails, the public posting link, job boards or by hand), matching every
  requirement against the whole candidate database, one-click submissions, and the bulk import of candidates
  from CSV, Excel or a folder of resumes.

  Requirements live in vms/req/items/{id}; vendors in vms/vendor/items/{id}. The job engine's skill dictionary,
  title tokens, location parser and resume reader are reused so a requirement and a resume are compared the
  same way jobs and resumes are.
*/
require_once __DIR__ . '/jobs.php';

const VMS_REQ = 'vms/req/items';
const VMS_VENDOR = 'vms/vendor/items';
const VMS_STATES = ['new', 'open', 'working', 'submitted', 'interview', 'filled', 'closed', 'dismissed'];

function vmsDb(): PDO
{
    static $ready = false;
    $pdo = db();
    if (!$ready) {
        $ready = true;
        // text pulled out of resumes, kept per file so matching never reads the same PDF twice
        $pdo->exec('CREATE TABLE IF NOT EXISTS vms_text (k VARCHAR(80) PRIMARY KEY, txt LONGTEXT NOT NULL, at BIGINT NOT NULL)');
    }
    return $pdo;
}
function vmsSettings(): array
{
    $d = docGet('org/vms/x/settings');
    return [
        'mailReq' => !($d && isset($d->mailReq) && $d->mailReq === false),
        'keywords' => (string) ($d->keywords ?? 'requirement, req, urgent, need, position, opening, role, job, c2c, contract, w2, hotlist'),
        'minScore' => max(10, min(90, (int) ($d->minScore ?? 35))),
        'linkOpen' => !($d && isset($d->linkOpen) && $d->linkOpen === false),
        'agentOn' => (bool) ($d->agentOn ?? false),
        'agentThreshold' => max(70, min(100, (int) ($d->agentThreshold ?? 86))),
        'agentFollow' => (bool) ($d->agentFollow ?? false),
        'agentOwner' => (string) ($d->agentOwner ?? ''),
    ];
}
function vmsNid(): string
{
    return substr(rid(6), 0, 9) . substr(base_convert((string) time(), 10, 36), -5);
}
function vmsStr($v, int $max = 500): string
{
    return is_scalar($v) ? mb_substr(trim((string) $v), 0, $max) : '';
}

/* ---------- requirements ---------- */

/** The fields a requirement is made of, cleaned, from any source. */
/** v68: the healthcare staffing details of a submission or a requirement, as text fields of a bounded size. */
function vmsHc(array $in): object
{
    $out = [];
    foreach (['disc', 'spec', 'fac', 'ftype', 'atype', 'shift', 'hrs', 'len', 'start', 'lic', 'licExp', 'certs', 'emr', 'yrs', 'hourly', 'stipend', 'bill', 'notes'] as $k) {
        $out[$k] = vmsStr($in[$k] ?? '', $k === 'notes' ? 1000 : 160);
    }
    $out['compact'] = !empty($in['compact']);
    $cred = [];
    foreach ((array) ($in['cred'] ?? []) as $k => $v) {
        if (in_array((string) $k, ['imm', 'tb', 'drug', 'bg', 'fit', 'phys', 'ref', 'skills'], true) && in_array((string) $v, ['ok', 'due', 'na'], true)) {
            $cred[(string) $k] = (string) $v;
        }
    }
    $out['cred'] = (object) $cred;
    return (object) $out;
}
function vmsReqFields(array $in): array
{
    $md = vmsStr($in['md'] ?? '', 12);
    $md = in_array($md, ['Onsite', 'Hybrid', 'Remote'], true) ? $md : (preg_match('/remote/i', $md) ? 'Remote' : (preg_match('/hybrid/i', $md) ? 'Hybrid' : 'Onsite'));
    return [
        'ti' => vmsStr($in['ti'] ?? '', 160),
        'cl' => vmsStr($in['cl'] ?? '', 160),
        'ec' => vmsStr($in['ec'] ?? '', 160),
        'vn' => vmsStr($in['vn'] ?? '', 160),
        'vid' => preg_match('/^[A-Za-z0-9_\-]{1,40}$/', (string) ($in['vid'] ?? '')) ? (string) $in['vid'] : '',
        'loc' => vmsStr($in['loc'] ?? '', 160),
        'md' => $md,
        'ty' => vmsStr($in['ty'] ?? '', 24),
        'rate' => vmsStr($in['rate'] ?? '', 60),
        'dur' => vmsStr($in['dur'] ?? '', 60),
        'n' => max(1, min(99, (int) ($in['n'] ?? 1))),
        'sd' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($in['sd'] ?? '')) ? (string) $in['sd'] : '',
        'sk' => vmsStr($in['sk'] ?? '', 1000),
        'visa' => vmsStr($in['visa'] ?? '', 120),
        'd' => vmsStr($in['d'] ?? '', 20000),
        'cn' => vmsStr($in['cn'] ?? '', 120),
        'ce' => strtolower(vmsStr($in['ce'] ?? '', 190)),
        'cp' => vmsStr($in['cp'] ?? '', 60),
    ];
}
/** What a requirement looks like to the matcher: title tokens, canonical skills, location. */
function vmsReqProfile(array $r): array
{
    $tt = array_values(array_diff(jtok((string) ($r['ti'] ?? '')), JOB_NEUTRAL_TOKENS));
    $skillText = ($r['ti'] ?? '') . "\n" . ($r['sk'] ?? '') . "\n" . ($r['d'] ?? '');
    $listed = array_values(array_filter(array_map('trim', preg_split('/[,;|]+|\s{2,}|\n/', (string) ($r['sk'] ?? '')) ?: [])));
    $skills = array_values(array_unique(array_merge(skillsCanon($listed), skillsIn($skillText, 40))));
    $loc = trim((string) ($r['loc'] ?? '')) !== '' ? jlocParse((string) $r['loc']) : null;
    return ['tt' => $tt, 'ttMap' => array_flip($tt), 'skills' => $skills, 'skMap' => array_flip(array_map('strtolower', $skills)), 'loc' => $loc, 'md' => (string) ($r['md'] ?? ''), 'visa' => mb_strtolower((string) ($r['visa'] ?? ''))];
}
function vmsReqGet(string $id): ?array
{
    // ids: a desk requirement, or e:{uid}:{rid} for one a client contact posted from the client portal
    if (preg_match('/^e:(u_[a-f0-9]{8,32}):([A-Za-z0-9_\-]{1,40})$/', $id, $m)) {
        $d = docGet("e/{$m[1]}/req/{$m[2]}");
        if (!$d) {
            return null;
        }
        $a = (array) $d;
        $who = docGet('u/' . $m[1]);
        $rr = docGet('r/' . $m[1]);
        $cl = (string) ($rr->cl ?? '');
        if ($cl === '' && isset($rr->cid)) {
            $cd = docGet('org/admin/clients/' . $rr->cid);
            $cl = (string) ($cd->n ?? '');
        }
        return ['id' => $id, 'src' => 'client', 'ti' => (string) ($a['ti'] ?? ''), 'cl' => $cl, 'vn' => $cl, 'loc' => (string) ($a['loc'] ?? ''), 'md' => (string) ($a['md'] ?? ''), 'ty' => (string) ($a['ty'] ?? ''), 'sk' => (string) ($a['sk'] ?? ''), 'd' => (string) ($a['d'] ?? ''), 'n' => (int) ($a['n'] ?? 1), 'sd' => (string) ($a['sd'] ?? ''), 'st' => (string) ($a['st'] ?? 'open'), 'at' => (int) ($a['at'] ?? 0), 'cn' => (string) ($who->p->n ?? ''), 'ce' => (string) ($who->p->e ?? ''), 'rate' => '', 'ec' => '', 'visa' => '', 'dur' => '', 'cp' => '', 'vid' => ''];
    }
    if (!preg_match('/^[A-Za-z0-9_\-]{1,40}$/', $id)) {
        return null;
    }
    $d = docGet(VMS_REQ . '/' . $id);
    if (!$d) {
        return null;
    }
    $a = (array) $d;
    $a['id'] = $id;
    return $a;
}
function vmsReqSave(array $fields, string $src, array $extra = []): string
{
    $id = vmsNid();
    $prof = vmsReqProfile($fields);
    $doc = array_merge($fields, [
        'src' => $src,
        'st' => $extra['st'] ?? 'new',
        'skills' => $prof['skills'],
        'at' => now(),
        'u' => now(),
    ], $extra);
    docSet(VMS_REQ . '/' . $id, (object) $doc);
    return $id;
}

/** Vendor emails that read like a requirement become a draft on the desk (Requirements › Inbox). */
function vmsLooksLikeRequirement(string $subject, string $text): bool
{
    $kw = array_values(array_filter(array_map('trim', explode(',', mb_strtolower(vmsSettings()['keywords'])))));
    $s = mb_strtolower($subject);
    $hit = 0;
    foreach ($kw as $k) {
        if ($k !== '' && mb_strpos($s, $k) !== false) {
            $hit++;
        }
    }
    $body = mb_strtolower(mb_substr($text, 0, 6000));
    $signals = 0;
    foreach (['location', 'rate', 'duration', 'client', 'visa', 'job description', 'responsibilities', 'must have', 'skills', 'contract', 'onsite', 'remote', 'hybrid', 'interview', 'submit', 'resume'] as $w) {
        if (mb_strpos($body, $w) !== false) {
            $signals++;
        }
    }
    if (($hit > 0 && $signals >= 2) || $signals >= 5) {
        return true;
    }
    // v35.1: labelled like a requirement (a role title plus at least two of location, rate, duration, skills…), even
    // when the subject is only the role ("RE: Data Analyst")
    require_once __DIR__ . '/vmsgrab.php';
    [$clean] = vgClean(vgNorm(mb_substr($text, 0, 20000)));
    $v = vgValues($clean);
    return isset($v['ti']) && count(array_intersect(array_keys($v), ['loc', 'rate', 'dur', 'ty', 'visa', 'cl', 'md', 'exp'])) + (empty($v['_sk']) ? 0 : 1) >= 2;
}
function vmsParseEmail(string $subject, string $text): array
{
    // v35.1: the reader in vmsgrab.php (several requirements per email, a cleaned job description); this keeps the
    // old single-requirement answer for any caller that wants one
    require_once __DIR__ . '/vmsgrab.php';
    $r = vgReqsFromMail(['', ''], $subject, $text);
    return $r ? $r[0]['f'] : vmsReqFields(['ti' => '', 'd' => $text]);
}
/** Called wherever an incoming email is stored (the shared inbox and each person's Gmail). */
function vmsMaybeRequirement(string $fromE, string $fromN, string $subject, string $text, string $src, string $ref): void
{
    try {
        if ($subject === '' && $text === '') {
            return;
        }
        $set = vmsSettings();
        // v33: iLabor360 notifications: a new requisition is filed under iLabor360 with its number and link; a status
        // email (shortlisted, interview, offer, closed...) is noted on the requisition it names
        $isIl = str_contains(strtolower($fromE), 'ilabor360') || stripos($subject . ' ' . mb_substr($text, 0, 4000), 'ilabor360') !== false;
        $ilRef = '';
        $ilUrl = '';
        if ($isIl) {
            $ilRef = preg_match('/\b(?:req(?:uisition)?|job)\s*(?:id|#|no\.?|number)?\s*[:#]\s*([A-Z0-9][A-Z0-9\-]{2,19})\b/i', $subject . "\n" . $text, $m) ? strtoupper($m[1]) : '';
            $ilUrl = preg_match('~https?://[^\s"<>]*ilabor360[^\s"<>]*~i', $text, $m2) ? $m2[0] : '';
            $known = null;
            if ($ilRef !== '') {
                foreach (colAll(VMS_REQ) as [$rid, $q]) {
                    if ((string) ($q->vref ?? '') === $ilRef && (string) ($q->vms ?? '') === 'iLabor360') {
                        $known = [(string) $rid, $q];
                    }
                }
            }
            $isStatus = (bool) preg_match('/\b(shortlist|interview|offer|reject|declin|withdr|status|feedback|on hold|filled|closed|cancel|update)/i', $subject);
            if ($known) {
                [$rid, $q] = $known;
                $log = (array) ($q->vlog ?? []);
                $log[] = (object) ['t' => now(), 'ev' => mb_substr($subject, 0, 200)];
                $q->vlog = array_slice($log, -30);
                $q->u = now();
                docSet(VMS_REQ . '/' . $rid, $q);
                return;
            }
            if ($isStatus) {
                return; // about a requisition that is not on the desk: nothing to file
            }
        }
        if (!$set['mailReq'] || (!($isIl && preg_match('/requisition|new job|job posted|position|opening/i', $subject . ' ' . mb_substr($text, 0, 600))) && !vmsLooksLikeRequirement($subject, $text))) {
            return;
        }
        $key = 'mail:' . ($ref !== '' ? $ref : md5($fromE . '|' . $subject . '|' . mb_substr($text, 0, 400)));
        if (vmsRefSeen($key)) {
            return;
        }
        // v35.1: every requirement in the email (several "Job Title:" blocks become several), each with a cleaned job
        // description: no greeting, signature, disclaimer or quoted reply
        require_once __DIR__ . '/vmsgrab.php';
        // the newest message in the email that holds a requirement: a forwarded vendor email under "FYI" counts as
        // the vendor's (their name and address are the contact), an old quoted copy below a reply does not repeat it
        $found = [];
        foreach (vgSplitEmails($text) as $si => $sg) {
            $who = $si === 0 || ($sg['from'][0] === '' && $sg['from'][1] === '') ? [strtolower($fromE), $fromN] : $sg['from'];
            $rs = array_values(array_filter(vgReqsFromMail($who, $si === 0 ? $subject : ($sg['subject'] ?: $subject), $sg['body']), fn($x) => $x['f']['ti'] !== '' && $x['kind'] === 'req'));
            if ($rs) {
                $found = $rs;
                break;
            }
        }
        foreach ($found as $i => $rq) {
            $f = $rq['f'];
            [$vid, $vn] = vgVendorFor($f['ce'] !== '' ? $f['ce'] : $fromE);
            $f['vid'] = $vid;
            $f['vn'] = $vn !== '' ? $vn : ($f['co'] !== '' ? $f['co'] : ($f['cn'] !== '' ? $f['cn'] : ($fromN !== '' ? $fromN : $fromE)));
            if ($f['ce'] === '') {
                $f['ce'] = strtolower($fromE);
                $f['cn'] = $f['cn'] !== '' ? $f['cn'] : $fromN;
            }
            $extra = ['st' => 'new', 'ref' => $key . ($i ? '#' . $i : ''), 'via' => $src];
            foreach (['vref', 'ip', 'exp', 'iv', 'pref'] as $k) {
                if ((string) ($f[$k] ?? '') !== '') {
                    $extra[$k] = (string) $f[$k];
                }
            }
            if ($isIl) {
                $extra['vms'] = 'iLabor360';
                $extra['vref'] = $ilRef;
                $extra['vurl'] = $ilUrl;
                if ($vn === '') {
                    $f['vn'] = 'iLabor360';
                }
            }
            $newReqId = vmsReqSave(vmsReqFields($f), 'email', $extra);
            // v73/v74: optional vendor auto-reply agent. iLabor messages are handled by their own incoming queue.
            if (!$isIl) {
                try { require_once __DIR__ . '/vmsagent.php'; vmaQueue($newReqId, 'vendor email'); } catch (Throwable $e) { @error_log(date('c').' vendor agent queue failed: '.$e->getMessage()."\n", 3, storeDir().'/error.log'); }
            }
        }
    } catch (Throwable $e) {
        @error_log(date('c') . ' requirement from email failed: ' . $e->getMessage() . "\n", 3, storeDir() . '/error.log');
    }
}
/** All vendors, read straight from the table (used where no one is signed in, e.g. the inbound-mail webhook). */
function vmsVendorsRaw(): array
{
    $s = db()->prepare('SELECT path, data FROM docs WHERE col = ?');
    $s->execute([VMS_VENDOR]);
    $out = [];
    foreach ($s->fetchAll() as $row) {
        $d = json_decode($row['data']);
        if ($d instanceof stdClass) {
            $out[] = [substr($row['path'], strrpos($row['path'], '/') + 1), $d];
        }
    }
    return $out;
}
function vmsRefSeen(string $key): bool
{
    $p = vmsDb();
    $s = $p->prepare('SELECT k FROM vms_text WHERE k = ?');
    $s->execute(['ref:' . md5($key)]);
    if ($s->fetch()) {
        return true;
    }
    $p->prepare('REPLACE INTO vms_text (k, txt, at) VALUES (?,?,?)')->execute(['ref:' . md5($key), $key, now()]);
    return false;
}

/* ---------- the candidate pool ---------- */

/** Text of the resume attached to a record (rec/cand/items/{id} or ats/{id}), read once and cached. */
function vmsResumeText(string $base): string
{
    $best = null;
    foreach (colAll($base . '/f') as [$fid, $f]) {
        if ((string) ($f->c ?? '') === 'resume' || $best === null) {
            $best = [(string) $fid, (string) ($f->n ?? '')];
        }
    }
    if (!$best) {
        return '';
    }
    [$fid, $name] = $best;
    $p = vmsDb();
    $s = $p->prepare('SELECT txt FROM vms_text WHERE k = ?');
    $s->execute(['f:' . $fid]);
    $row = $s->fetch();
    if ($row) {
        return (string) $row['txt'];
    }
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    $local = in_array($ext, ['pdf', 'docx', 'txt'], true) ? fileLocal($fid, $ext) : null;
    $txt = $local !== null ? mb_substr(textFromFile($local, $ext), 0, 120000) : '';
    $p->prepare('REPLACE INTO vms_text (k, txt, at) VALUES (?,?,?)')->execute(['f:' . $fid, $txt, now()]);
    return $txt;
}
function vmsSplitSkills(string $s): array
{
    // commas, semicolons, pipes and new lines separate skills; a slash does not (S/4HANA, PP/QM, CI/CD, TCP/IP)
    return array_values(array_filter(array_map('trim', preg_split('/[,;|\n]+/', $s) ?: []), fn($x) => $x !== ''));
}
/** Everyone who could be put forward: the consultant database, ATS candidates and people with a resume in the job portal. */
function vmsCandidates(bool $withText = true, bool $system = false): array
{
    // v80: the background match sweep runs with no signed-in user, so it reads the pool without the per-person ACL
    // (colAll) - the same records a recruiter would see. Interactive calls keep the ACL (colList).
    $readCand = $system ? colAll('rec/cand/items') : colList('rec/cand/items', null, 'asc', 0);
    $readAts = $system ? colAll('ats') : colList('ats', null, 'asc', 0);
    $out = [];
    foreach ($readCand as [$id, $c]) {
        if ((string) ($c->st ?? 'active') === 'inactive') {
            continue;
        }
        $txt = $withText ? vmsResumeText('rec/cand/items/' . $id) : '';
        $skills = array_values(array_unique(array_merge(skillsCanon(vmsSplitSkills((string) ($c->sk ?? ''))), $txt !== '' ? skillsIn($txt, 60) : [])));
        $out[] = [
            'src' => 'db',
            'id' => (string) $id,
            'ct' => (string) ($c->eng ?? ''),
            'n' => (string) ($c->n ?? ''),
            'ti' => (string) ($c->ti ?? ''),
            'titles' => array_values(array_filter([(string) ($c->ti ?? '')])),
            'skills' => $skills,
            'loc' => (string) ($c->loc ?? ''),
            'auth' => (string) ($c->auth ?? ''),
            'rate' => (string) ($c->rate ?? ''),
            'e' => (string) ($c->e ?? ''),
            'ph' => (string) ($c->ph ?? ''),
            'avail' => (string) ($c->avail ?? ''),
            'reloc' => (string) ($c->reloc ?? ''),
            'tags' => (array) ($c->tags ?? []),
            'resume' => $txt !== '',
            'by' => (string) ($c->byn ?? ''),
        ];
    }
    foreach ($readAts as [$id, $c]) {
        if (in_array((string) ($c->st ?? ''), ['rejected', 'hired'], true)) {
            continue;
        }
        $txt = $withText ? vmsResumeText('ats/' . $id) : '';
        $prof = $txt !== '' ? resumeProfile($txt) : ['titles' => [], 'skills' => [], 'location' => ''];
        $out[] = [
            'src' => 'ats',
            'id' => (string) $id,
            'n' => (string) ($c->n ?? ''),
            'ti' => (string) ($c->jt ?? ($prof['titles'][0] ?? '')),
            'titles' => array_values(array_unique(array_filter(array_merge([(string) ($c->jt ?? '')], (array) $prof['titles'])))),
            'skills' => (array) $prof['skills'],
            'loc' => (string) ($c->loc ?? $prof['location'] ?? ''),
            'auth' => (string) ($c->auth ?? ''),
            'rate' => '',
            'e' => (string) ($c->e ?? ''),
            'ph' => (string) ($c->ph ?? ''),
            'avail' => '',
            'reloc' => '',
            'tags' => [],
            'resume' => $txt !== '',
            'by' => '',
        ];
    }
    try {
        foreach (jobPeopleActive() as $p) {
            $prof = jdec($p['profile']);
            $pref = jdec($p['prefs']);
            if (!$prof && !$pref) {
                continue;
            }
            $titles = array_values(array_filter((array) ($pref['titles'] ?? []), 'is_string')) ?: array_values(array_filter((array) ($prof['titles'] ?? []), 'is_string'));
            $out[] = [
                'src' => 'portal',
                'id' => (string) $p['uid'],
                'n' => (string) $p['name'],
                'ti' => (string) ($titles[0] ?? ''),
                'titles' => $titles,
                'skills' => array_values(array_unique(array_merge(array_filter((array) ($prof['skills'] ?? []), 'is_string'), skillsCanon((array) ($pref['skills'] ?? []))))),
                'loc' => (string) (($pref['locations'][0] ?? null) ?: ($prof['location'] ?? '')),
                'auth' => (string) ($pref['auth'] ?? ''),
                'rate' => (string) ($pref['rate'] ?? ''),
                'e' => (string) $p['email'],
                'ph' => '',
                'avail' => '',
                'reloc' => '',
                'tags' => [],
                'resume' => (string) ($p['resume_name'] ?? '') !== '',
                'by' => '',
            ];
        }
    } catch (Throwable $e) {
        // the job portal tables may not exist yet on a site that never used it
    }
    return $out;
}
/** How well one person fits a requirement: title, skills, location, visa; with the reasons. */
function vmsScore(array $prof, array $c): array
{
    $why = [];
    $pts = [];
    foreach ($c['titles'] as $ti) {
        $tk = array_values(array_diff(jtok((string) $ti), JOB_NEUTRAL_TOKENS));
        if ($tk) {
            $pts[] = [$ti, $tk];
        }
    }
    [$ts, $bt] = $pts && $prof['tt'] ? jobTitleScore($pts, $prof['ttMap']) : [0.0, ''];
    $have = [];
    foreach ($c['skills'] as $s) {
        if (isset($prof['skMap'][strtolower((string) $s)])) {
            $have[] = $s;
        }
    }
    $need = count($prof['skills']);
    $ratio = $need ? count($have) / min($need, 8) : 0.0;
    $ratio = min(1.0, $ratio);
    if (!$prof['tt'] && !$need) {
        return [0, []];
    }
    $score = $prof['tt'] ? $ts * 45 + $ratio * 45 : $ratio * 85;
    if ($bt !== '' && $ts >= 0.5) {
        $why[] = 'Title: ' . $bt;
    }
    if ($have) {
        $why[] = 'Skills: ' . implode(', ', array_slice($have, 0, 8)) . (count($have) > 8 ? ' +' . (count($have) - 8) : '');
    }
    $missing = array_values(array_diff($prof['skills'], $have));
    if ($need && $missing) {
        $why[] = 'Not listed: ' . implode(', ', array_slice($missing, 0, 5)) . (count($missing) > 5 ? ' +' . (count($missing) - 5) : '');
    }
    // location: the same city or state, remote work, or someone open to relocation
    $locPts = 0;
    if ($prof['md'] === 'Remote') {
        $locPts = 10;
        $why[] = 'Remote role';
    } elseif ($prof['loc'] && trim($c['loc']) !== '') {
        $cl = jlocParse($c['loc']);
        $same = ($prof['loc']['city'] ?? '') !== '' && ($cl['city'] ?? '') === ($prof['loc']['city'] ?? '');
        $state = ($prof['loc']['state'] ?? '') !== '' && ($cl['state'] ?? '') === ($prof['loc']['state'] ?? '');
        if ($same) {
            $locPts = 10;
            $why[] = 'Same city';
        } elseif ($state) {
            $locPts = 7;
            $why[] = 'Same state';
        } elseif (preg_match('/^(open|yes|anywhere)/i', $c['reloc'])) {
            $locPts = 5;
            $why[] = 'Open to relocation';
        } else {
            $why[] = 'Different location (' . $c['loc'] . ')';
        }
    } elseif (preg_match('/^(open|yes|anywhere)/i', $c['reloc'])) {
        $locPts = 4;
    }
    $score += $locPts;
    if ($prof['visa'] !== '' && $c['auth'] !== '') {
        $a = mb_strtolower($c['auth']);
        $ok = str_contains($prof['visa'], 'any') || str_contains($prof['visa'], mb_strtolower(preg_replace('/[^a-z0-9]/i', '', $c['auth']) ?: $a)) || str_contains(preg_replace('/[^a-z0-9 ]/i', '', $prof['visa']) ?? '', preg_replace('/[^a-z0-9 ]/i', '', $a) ?? '');
        if (!$ok && (str_contains($prof['visa'], 'usc') || str_contains($prof['visa'], 'gc') || str_contains($prof['visa'], 'citizen') || str_contains($prof['visa'], 'green')) && preg_match('/h-?1b|opt|cpt|h4|l1|tn/i', $a)) {
            $score -= 15;
            $why[] = 'Visa may not fit (' . $c['auth'] . ')';
        }
    }
    return [(int) round(max(0, min(100, $score))), $why];
}
function vmsMatch(string $id, bool $system = false): array
{
    $r = vmsReqGet($id);
    if (!$r) {
        fail(404, 'not_found', 'That requirement is gone.');
    }
    $prof = vmsReqProfile($r);
    $min = vmsSettings()['minScore'];
    $subs = [];
    foreach (($system ? colAll('rec/sub/items') : colList('rec/sub/items', null, 'asc', 0)) as [$sid, $s]) {
        if ((string) ($s->vreq ?? '') === $id) {
            $subs[(string) ($s->src ?? 'db') . ':' . (string) ($s->cid ?? '')] = (string) ($s->st ?? 'submitted');
        }
    }
    // v32: consultant types and work authorization (Admin > Consultant types & job rules)
    require_once __DIR__ . '/rules.php';
    $eng = ruleEng((string) ($r['ty'] ?? ''));
    $hidden = 0;
    $out = [];
    foreach (vmsCandidates(true, $system) as $c) {
        [$score, $why] = vmsScore($prof, $c);
        if ($score < $min) {
            continue;
        }
        $person = $c['src'] === 'portal' ? rulePerson($c['id']) : ['ct' => $c['src'] === 'db' && isset(CT_KINDS[$c['ct'] ?? '']) ? (string) $c['ct'] : '', 'extra' => [], 'auth' => ruleAuthNorm((string) ($c['auth'] ?? ''))];
        [$allowed] = ruleJobOk($person, (string) ($r['ty'] ?? ''), (string) ($r['visa'] ?? ''));
        if (!$allowed) {
            $hidden++;
            continue;
        }
        $c['score'] = $score;
        $c['why'] = $why;
        $c['sub'] = $subs[$c['src'] . ':' . $c['id']] ?? '';
        $c['skills'] = array_slice($c['skills'], 0, 30);
        $out[] = $c;
    }
    usort($out, fn($a, $b) => $b['score'] <=> $a['score'] ?: strcmp($a['n'], $b['n']));
    return ['req' => $r, 'profile' => ['titleTokens' => $prof['tt'], 'skills' => $prof['skills'], 'minScore' => $min], 'matches' => array_slice($out, 0, 60), 'pool' => count($out), 'hidden' => $hidden, 'eng' => $eng];
}

/* v80: a compact match summary stored on the requirement (->mx) so the desk shows, at a glance, how many consultants
 * fit a requirement and the best few - without opening each one. Imported Ceipal/Oorwin requirements become
 * actionable the moment they land. The full list is still the live vms_match. A "strong" match scores 75+. */
const VMS_STRONG = 75;
function vmsReqMatchSummary(string $id, bool $store = true, bool $system = false): array
{
    $m = vmsMatch($id, $system); // scores the whole consultant pool; throws if the requirement is gone
    $strong = 0;
    $top = [];
    foreach ($m['matches'] as $c) {
        if ((int) ($c['score'] ?? 0) >= VMS_STRONG) {
            $strong++;
        }
        if (count($top) < 3) {
            $top[] = ['n' => (string) ($c['n'] ?? ''), 'score' => (int) ($c['score'] ?? 0), 'src' => (string) ($c['src'] ?? ''), 'cid' => (string) ($c['id'] ?? ''), 'ti' => (string) ($c['ti'] ?? '')];
        }
    }
    $mx = ['n' => count($m['matches']), 'strong' => $strong, 'top' => $top, 'pool' => (int) $m['pool'], 'at' => now()];
    // store only on the desk's own requirements (plain ids); client-posted reqs (e:uid:rid) are read-only here
    if ($store && preg_match('/^[A-Za-z0-9_\-]{1,40}$/', $id)) {
        $d = docGet(VMS_REQ . '/' . $id);
        if ($d) {
            $d->mx = (object) $mx;
            docSet(VMS_REQ . '/' . $id, $d);
        }
    }
    return $mx;
}
/** Scheduled pass: refresh the match summary for open requirements whose summary is missing or stale (the consultant
 *  database grows with every import, so matches are recomputed). Bounded per run. */
function vmsMatchSweep(int $budget = 12): array
{
    $done = 0;
    $t = now();
    foreach (colAll(VMS_REQ) as [$id, $q]) {
        if ($done >= $budget) {
            break;
        }
        if (in_array((string) ($q->st ?? 'new'), ['filled', 'closed', 'dismissed'], true)) {
            continue;
        }
        $mx = isset($q->mx) && $q->mx instanceof stdClass ? $q->mx : null;
        $fresh = $mx && (int) ($mx->at ?? 0) > $t - 12 * 3600000 && (int) ($mx->at ?? 0) >= (int) ($q->u ?? 0);
        if ($fresh) {
            continue;
        }
        try {
            vmsReqMatchSummary((string) $id, true, true); // system read: works in cron (no signed-in user) too
            $done++;
        } catch (Throwable $e) {
            // one requirement that fails to score does not stop the sweep
        }
    }
    return ['matched' => $done];
}

/* ---------- submissions ---------- */
function vmsSubmit(array $me, array $b): array
{
    $id = vmsStr($b['id'] ?? '', 80);
    $r = vmsReqGet($id);
    if (!$r) {
        fail(404, 'not_found', 'That requirement is gone.');
    }
    $src = in_array($b['src'] ?? '', ['db', 'ats', 'portal'], true) ? $b['src'] : 'db';
    $cid = vmsStr($b['cid'] ?? '', 60);
    $cand = null;
    foreach (vmsCandidates(false) as $c) {
        if ($c['src'] === $src && $c['id'] === $cid) {
            $cand = $c;
            break;
        }
    }
    if (!$cand) {
        fail(404, 'not_found', 'That candidate is no longer in the database.');
    }
    $meDoc = docGet('u/' . $me['id']);
    $byn = (string) ($meDoc->p->n ?? $me['name']);
    $sid = vmsNid();
    $vendor = (string) ($r['vn'] ?? '') !== '' ? (string) $r['vn'] : (string) ($r['cl'] ?? '');
    // v36: the same check as the bench desk before anything goes out (the same requirement, requisition ID, or end
    // client and role stops it unless a manager gives a reason; an uncertain match needs "I checked")
    require_once __DIR__ . '/bench.php';
    $draft = (object) ['cid' => $src === 'db' ? $cid : '', 'cn' => (string) $cand['n'], 'ce' => strtolower(trim((string) ($cand['e'] ?? ''))), 'req' => (string) $r['ti'], 'vn' => $vendor, 'ec' => (string) ($r['ec'] ?? ''), 'ext' => (string) ($r['vref'] ?? ''), 'vreq' => $id];
    $checked = bdSendCheck($draft, '', $me, $b);
    $hist = [(object) ['t' => now(), 'by' => $byn, 'ev' => 'Submitted from the requirements desk' . (!empty($b['email']) ? ' (emailed to the vendor)' : '')]];
    foreach ($checked as $line) {
        $hist[] = (object) ['t' => now(), 'by' => $byn, 'ev' => $line];
    }
    $subDoc = (object) ([
        'd' => date('Y-m-d'),
        'cid' => $src === 'db' ? $cid : '',
        'cn' => $cand['n'],
        'req' => (string) $r['ti'],
        'vn' => $vendor,
        'ec' => (string) ($r['ec'] ?? ($r['cl'] ?? '')),
        'rate' => vmsStr($b['rate'] ?? ($r['rate'] ?? ''), 60),
        'rn' => (string) ($r['cn'] ?? ''),
        're' => (string) ($r['ce'] ?? ''),
        'rp' => (string) ($r['cp'] ?? ''),
        'rtr' => !empty($b['rtr']),
        'rtrAt' => !empty($b['rtr']) ? date('Y-m-d') : '',
        'st' => 'submitted',
        'notes' => vmsStr($b['note'] ?? '', 2000),
        'lob' => ($b['lob'] ?? '') === 'hc' ? 'hc' : '', // v68
        'hc' => ($b['lob'] ?? '') === 'hc' ? vmsHc((array) ($b['hc'] ?? [])) : null,
        'vreq' => $id,
        'ext' => (string) ($r['vref'] ?? ''),
        'ce' => $draft->ce,
        'src' => $src,
        'score' => (int) ($b['score'] ?? 0),
        // v68/v74 healthcare staffing submission details (optional; useful for clinical/healthcare requirements).
        'healthcare' => (object) [
            'specialty' => vmsStr($b['hcSpecialty'] ?? '', 120),
            'license' => vmsStr($b['hcLicense'] ?? '', 160),
            'certs' => vmsStr($b['hcCerts'] ?? '', 300),
            'immun' => vmsStr($b['hcImmun'] ?? '', 300),
            'shift' => vmsStr($b['hcShift'] ?? '', 120),
            'facility' => vmsStr($b['hcFacility'] ?? '', 160),
        ],
        'by' => $me['id'],
        'byn' => $byn,
        'own' => $me['id'],
        'ownn' => $byn,
        'at' => now(),
        'stAt' => now(),
        'u' => now(),
        'un' => $byn,
        'hist' => $hist,
    ] + (isset($draft->ovr) ? ['ovr' => $draft->ovr] : []) + (isset($draft->ack) ? ['ack' => $draft->ack] : []) + (!empty($b['rtr']) ? ['rtr2' => (object) ['st' => 'approved', 'at' => now(), 'by' => $byn, 'via' => 'recorded by ' . $byn, 'scope' => 'req']] : []));
    $subDoc->pk = bdPacket($subDoc, $me); // what went out, kept as it was
    docSet('rec/sub/items/' . $sid, $subDoc);
    if ($r['src'] !== 'client' && in_array((string) ($r['st'] ?? ''), ['new', 'open', 'working'], true)) {
        $d = docGet(VMS_REQ . '/' . $id);
        if ($d) {
            $d->st = 'submitted';
            $d->u = now();
            docSet(VMS_REQ . '/' . $id, $d);
        }
    }
    $mailed = false;
    $to = strtolower(vmsStr($b['to'] ?? ($r['ce'] ?? ''), 190));
    if (!empty($b['email']) && filter_var($to, FILTER_VALIDATE_EMAIL)) {
        $atts = [];
        $base = $src === 'db' ? 'rec/cand/items/' . $cid : ($src === 'ats' ? 'ats/' . $cid : '');
        if ($base !== '') {
            foreach (colList($base . '/f', null, 'asc', 0) as [$fid, $f]) {
                if ((string) ($f->c ?? '') === 'resume') {
                    $data = fileRead((string) $fid);
                    if ($data !== null) {
                        $atts[] = ['name' => (string) ($f->n ?? 'resume.pdf'), 'type' => (string) ($f->ty ?? 'application/octet-stream'), 'data' => $data];
                    }
                    break;
                }
            }
        }
        $subject = 'Submission: ' . $cand['n'] . ' for ' . $r['ti'];
        $lines = [
            'Hi ' . (($r['cn'] ?? '') !== '' ? $r['cn'] : 'there') . ',',
            'Please find ' . $cand['n'] . ' for the ' . $r['ti'] . ' requirement' . (($r['loc'] ?? '') !== '' ? ' (' . $r['loc'] . ')' : '') . '.',
            implode(' · ', array_filter([$cand['ti'] !== '' ? $cand['ti'] : '', $cand['loc'] !== '' ? 'Location: ' . $cand['loc'] : '', $cand['auth'] !== '' ? 'Work authorization: ' . $cand['auth'] : '', ($b['rate'] ?? '') !== '' ? 'Rate: ' . vmsStr($b['rate'], 60) : ''])),
            vmsStr($b['note'] ?? '', 2000),
            implode(' · ', array_filter([
                vmsStr($b['hcSpecialty'] ?? '', 120) !== '' ? 'Specialty: ' . vmsStr($b['hcSpecialty'], 120) : '',
                vmsStr($b['hcLicense'] ?? '', 160) !== '' ? 'License: ' . vmsStr($b['hcLicense'], 160) : '',
                vmsStr($b['hcCerts'] ?? '', 300) !== '' ? 'Certifications: ' . vmsStr($b['hcCerts'], 300) : '',
                vmsStr($b['hcShift'] ?? '', 120) !== '' ? 'Shift: ' . vmsStr($b['hcShift'], 120) : '',
                vmsStr($b['hcFacility'] ?? '', 160) !== '' ? 'Facility: ' . vmsStr($b['hcFacility'], 160) : '',
            ])),
            'Regards,' . "\n" . $byn . "\n" . 'StratEdge IT Consulting',
        ];
        try {
            $mailed = sendMail($to, (string) ($r['cn'] ?? ''), $subject, implode("\n\n", array_filter($lines)), emailHtml($subject, array_values(array_filter($lines))), $atts, (string) $me['email']);
        } catch (Throwable $e) {
            $mailed = false;
        }
    }
    return ['id' => $sid, 'mailed' => $mailed];
}

/* ---------- bulk import into the candidate database ---------- */
function vmsHeaderKey(string $h): string
{
    $h = strtolower(trim($h));
    $map = [
        'n' => ['name', 'full name', 'candidate', 'consultant', 'candidate name', 'consultant name', 'first name'],
        'e' => ['email', 'e-mail', 'email address', 'mail'],
        'ph' => ['phone', 'mobile', 'contact', 'phone number', 'contact number', 'cell'],
        'ti' => ['title', 'job title', 'role', 'designation', 'position', 'profile'],
        'sk' => ['skills', 'skill', 'skill set', 'skillset', 'technologies', 'primary skills', 'key skills', 'technology'],
        'loc' => ['location', 'city', 'current location', 'address', 'state'],
        'auth' => ['visa', 'visa status', 'work authorization', 'authorization', 'work status', 'immigration status'],
        'rate' => ['rate', 'expected rate', 'bill rate', 'hourly rate', 'salary', 'pay rate'],
        'exp' => ['experience', 'years', 'years of experience', 'total experience', 'exp'],
        'li' => ['linkedin', 'linkedin url', 'profile url'],
        'avail' => ['availability', 'available', 'available from', 'notice period'],
        'reloc' => ['relocation', 'relocate', 'open to relocation', 'willing to relocate'],
        'emp' => ['employer', 'current employer', 'vendor', 'company', 'current company'],
        'notes' => ['notes', 'comments', 'remarks', 'summary'],
        'tags' => ['tags', 'tag', 'category', 'group', 'list'],
    ];
    foreach ($map as $k => $names) {
        if (in_array($h, $names, true)) {
            return $k;
        }
    }
    foreach ($map as $k => $names) {
        foreach ($names as $nm) {
            if (str_contains($h, $nm)) {
                return $k;
            }
        }
    }
    return '';
}
/**
 * The rows of a spreadsheet (first row = column names), read like Import with preview reads them (v38.1): quoted cells
 * with line breaks, any separator or encoding, every Excel sheet (the first one with rows is used), Excel dates.
 */
function vmsSheetRows(string $path, string $ext): array
{
    require_once __DIR__ . '/imports.php';
    if ($ext === 'xlsx') {
        if (impZipGet($path)('xl/workbook.xml') === null) {
            return [];
        }
        $rows = [];
        foreach (impXlsx($path) as $sh) {
            if (count($sh['rows']) >= 2) {
                $rows = $sh['rows'];
                break;
            }
        }
    } else {
        $rows = impCsv(impUtf8((string) file_get_contents($path)), $ext === 'tsv' ? "\t" : '');
    }
    // title rows above the column names are left out
    return array_map(fn($r) => array_slice($r, 1), array_slice($rows, max(0, impHeadRow($rows))));
}
function vmsGuessName(string $text, string $filename): string
{
    foreach (array_slice(preg_split('/\R/', $text) ?: [], 0, 12) as $l) {
        $l = trim(preg_replace('/\s+/', ' ', $l) ?? '');
        if ($l === '' || preg_match('/[@\d]|resume|curriculum|cv\b|profile|http/i', $l)) {
            continue;
        }
        $w = explode(' ', $l);
        if (count($w) >= 2 && count($w) <= 4 && mb_strlen($l) <= 40 && preg_match('/^[\p{L}][\p{L}\'\.\- ]+$/u', $l)) {
            return $l;
        }
    }
    $n = preg_replace('/\.(pdf|docx|txt)$/i', '', $filename) ?? $filename;
    $n = preg_replace('/[_\-]+/', ' ', $n) ?? $n;
    $n = preg_replace('/\b(resume|cv|updated|final|new|\d{2,})\b/i', '', $n) ?? $n;
    return mb_substr(trim(preg_replace('/\s+/', ' ', $n) ?? $n), 0, 80);
}
function vmsImport(array $me, array $files, array $opts): array
{
    $meDoc = docGet('u/' . $me['id']);
    $byn = (string) ($meDoc->p->n ?? $me['name']);
    $update = !empty($opts['update']);
    $tags = array_values(array_filter(array_map('trim', explode(',', vmsStr($opts['tags'] ?? '', 300)))));
    // what is already there, by email, phone and name
    $byEmail = [];
    $byPhone = [];
    $byName = [];
    $known = []; // id => [email, last 10 phone digits]: whether a same-name row may be the same person
    foreach (colList('rec/cand/items', null, 'asc', 0) as [$id, $c]) {
        $e = strtolower(trim((string) ($c->e ?? '')));
        $p = preg_replace('/\D+/', '', (string) ($c->ph ?? '')) ?? '';
        $n = mb_strtolower(trim((string) ($c->n ?? '')));
        if ($e !== '') {
            $byEmail[$e] = (string) $id;
        }
        if (strlen($p) >= 7) {
            $byPhone[substr($p, -10)] = (string) $id;
        }
        if ($n !== '') {
            $byName[$n] = (string) $id;
        }
        $known[(string) $id] = [$e, strlen($p) >= 7 ? substr($p, -10) : ''];
    }
    $added = 0;
    $updated = 0;
    $skipped = 0;
    $failed = [];
    $now = now();
    $save = function (array $f, ?array $resume) use (&$added, &$updated, &$skipped, &$byEmail, &$byPhone, &$byName, &$known, $update, $tags, $byn, $me, $now) {
        $e = strtolower(trim((string) ($f['e'] ?? '')));
        $p = preg_replace('/\D+/', '', (string) ($f['ph'] ?? '')) ?? '';
        $n = mb_strtolower(trim((string) ($f['n'] ?? '')));
        if ($n === '' && $e === '') {
            $skipped++;
            return;
        }
        $p10 = strlen($p) >= 7 ? substr($p, -10) : '';
        $dup = ($e !== '' ? $byEmail[$e] ?? null : null) ?? ($p10 !== '' ? $byPhone[$p10] ?? null : null);
        if ($dup === null && $n !== '' && isset($byName[$n])) {
            // the same name is only the same person when the email and phone do not say otherwise
            [$ce, $cp] = $known[$byName[$n]] ?? ['', ''];
            if (($e === '' || $ce === '') && ($p10 === '' || $cp === '')) {
                $dup = $byName[$n];
            }
        }
        $doc = array_filter([
            'n' => vmsStr($f['n'] ?? '', 120),
            'e' => vmsStr($e, 190),
            'ph' => vmsStr($f['ph'] ?? '', 60),
            'ti' => vmsStr($f['ti'] ?? '', 160),
            'sk' => vmsStr($f['sk'] ?? '', 1000),
            'loc' => vmsStr($f['loc'] ?? '', 160),
            'auth' => vmsStr($f['auth'] ?? '', 60),
            'rate' => vmsStr($f['rate'] ?? '', 60),
            'exp' => vmsStr($f['exp'] ?? '', 40),
            'li' => vmsStr($f['li'] ?? '', 300),
            'avail' => vmsStr($f['avail'] ?? '', 120),
            'reloc' => vmsStr($f['reloc'] ?? '', 40),
            'emp' => vmsStr($f['emp'] ?? '', 160),
            'notes' => vmsStr($f['notes'] ?? '', 4000),
        ], fn($v) => $v !== '');
        $rowTags = array_values(array_unique(array_merge($tags, array_filter(array_map('trim', explode(',', (string) ($f['tags'] ?? '')))))));
        if ($dup !== null) {
            if (!$update) {
                $skipped++;
                return;
            }
            $cur = docGet('rec/cand/items/' . $dup) ?? new stdClass();
            foreach ($doc as $k => $v) {
                if ($v !== '' && (!isset($cur->$k) || trim((string) $cur->$k) === '')) {
                    $cur->$k = $v;
                }
            }
            $cur->tags = array_values(array_unique(array_merge((array) ($cur->tags ?? []), $rowTags)));
            $cur->u = $now;
            $cur->un = $byn;
            docSet('rec/cand/items/' . $dup, $cur);
            // the record may have gained an email or phone: later rows match it by those
            $ce2 = strtolower(trim((string) ($cur->e ?? '')));
            $cp2 = preg_replace('/\D+/', '', (string) ($cur->ph ?? '')) ?? '';
            $known[$dup] = [$ce2, strlen($cp2) >= 7 ? substr($cp2, -10) : ''];
            if ($ce2 !== '') {
                $byEmail[$ce2] = $dup;
            }
            if (strlen($cp2) >= 7) {
                $byPhone[substr($cp2, -10)] = $dup;
            }
            $id = $dup;
            $updated++;
        } else {
            $id = vmsNid();
            $doc['ti'] = $doc['ti'] ?? ($doc['sk'] ?? '' ? 'Consultant' : 'Consultant');
            $doc['st'] = 'active';
            $doc['src'] = 'Import';
            $doc['tags'] = $rowTags;
            $doc['by'] = $me['id'];
            $doc['byn'] = $byn;
            $doc['at'] = $now;
            $doc['u'] = $now;
            $doc['un'] = $byn;
            docSet('rec/cand/items/' . $id, (object) $doc);
            if ($e !== '') {
                $byEmail[$e] = $id;
            }
            if (strlen($p) >= 7) {
                $byPhone[substr($p, -10)] = $id;
            }
            if ($n !== '') {
                $byName[$n] = $id;
            }
            $known[$id] = [$e, $p10];
            $added++;
        }
        if ($resume) {
            $fid = rid(16);
            $dir = cfg('files_dir');
            if (!is_dir($dir)) {
                @mkdir($dir, 0775, true);
            }
            if (@copy($resume['tmp'], "$dir/$fid") && fileSealPath("$dir/$fid")) {
                docSet('rec/cand/items/' . $id . '/f/' . $fid, (object) ['n' => $resume['name'], 'ty' => MIME[$resume['ext']], 'sz' => $resume['size'], 'at' => $now, 'c' => 'resume']);
                vmsDb()->prepare('REPLACE INTO vms_text (k, txt, at) VALUES (?,?,?)')->execute(['f:' . $fid, mb_substr($resume['text'], 0, 120000), $now]);
            }
        }
    };
    $count = is_array($files['name'] ?? null) ? count($files['name']) : 0;
    for ($i = 0; $i < $count; $i++) {
        $name = mb_substr(basename((string) $files['name'][$i]), 0, 180);
        $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        $tmp = (string) $files['tmp_name'][$i];
        if (($files['error'][$i] ?? 1) !== UPLOAD_ERR_OK || !is_file($tmp)) {
            $failed[] = $name . ': the upload did not complete';
            continue;
        }
        if ((int) $files['size'][$i] > 12 * 1048576) {
            $failed[] = $name . ': larger than 12 MB';
            continue;
        }
        // v35: screened before it is read (type matches content, no macros or programs, virus scan)
        require_once __DIR__ . '/guard.php';
        $why = guardUpload($tmp, $name);
        if ($why !== '') {
            $failed[] = $name . ': ' . $why;
            continue;
        }
        try {
            if ($ext === 'csv' || $ext === 'tsv' || $ext === 'xlsx') {
                $rows = vmsSheetRows($tmp, $ext);
                if (count($rows) < 2) {
                    $failed[] = $name . ': no rows found (the first row must be the column names)';
                    continue;
                }
                $keys = array_map(fn($h) => vmsHeaderKey((string) $h), $rows[0]);
                if (!in_array('n', $keys, true) && !in_array('e', $keys, true)) {
                    $failed[] = $name . ': no Name or Email column found';
                    continue;
                }
                foreach (array_slice($rows, 1) as $row) {
                    $f = [];
                    foreach ($keys as $ci => $k) {
                        if ($k !== '' && isset($row[$ci]) && trim((string) $row[$ci]) !== '') {
                            $f[$k] = isset($f[$k]) ? $f[$k] . ', ' . trim((string) $row[$ci]) : trim((string) $row[$ci]);
                        }
                    }
                    $save($f, null);
                }
            } elseif (in_array($ext, ['pdf', 'docx', 'txt'], true)) {
                $text = textFromFile($tmp, $ext);
                if (trim($text) === '') {
                    $failed[] = $name . ': no text could be read from it';
                    continue;
                }
                $prof = resumeProfile($text);
                preg_match('/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i', $text, $em);
                preg_match('/(\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}/', $text, $pm);
                $f = [
                    'n' => vmsGuessName($text, $name),
                    'e' => $em[0] ?? '',
                    'ph' => $pm[0] ?? '',
                    'ti' => (string) ($prof['titles'][0] ?? ''),
                    'sk' => implode(', ', array_slice((array) $prof['skills'], 0, 25)),
                    'loc' => (string) ($prof['location'] ?? ''),
                    'exp' => $prof['years'] !== null ? (string) $prof['years'] . ' years' : '',
                    'notes' => 'Imported from ' . $name,
                ];
                $save($f, ['tmp' => $tmp, 'name' => $name, 'ext' => $ext, 'size' => (int) $files['size'][$i], 'text' => $text]);
            } else {
                $failed[] = $name . ': use CSV, Excel (.xlsx), PDF, Word (.docx) or text files';
            }
        } catch (Throwable $e) {
            $failed[] = $name . ': ' . $e->getMessage();
        }
    }
    return ['added' => $added, 'updated' => $updated, 'skipped' => $skipped, 'failed' => $failed];
}

/* ---------- routes ---------- */
function vmsStaff(): array
{
    $u = requireUser();
    if (!featureAllowed($u, 'requirements', userLevel($u) >= 2 || isRecruiter($u['id']) || isBench($u['id']))) {
        fail(403, 'forbidden', 'The requirements desk is for StratEdge staff and recruiters.');
    }
    return $u;
}
/** v83: whether a person's own mailbox may feed the requirements desk: the same people who work the desk (vmsStaff),
 *  so a consultant's or a self-registered account's mailbox cannot file requirements in it. */
function vmsMayFeed(string $uid): bool
{
    $row = userRow($uid);
    if (!$row || ($row['status'] ?? '') !== 'active') {
        return false;
    }
    $u = $row + ['roles' => rolesOf($row)];
    return featureAllowed($u, 'requirements', userLevel($u) >= 2 || isRecruiter($uid) || isBench($uid));
}
function vmsRoute(string $r, string $method, array $b): void
{
    switch ($r) {
        /* a client or vendor posts a requirement through the public link (#/post-requirement?v=...) */
        case 'vms_post':
            if (throttleHit('vmspost:' . clientIp(), 12, 3600)) {
                fail(429, 'rate_limited', 'Too many requirements from this network. Try again later.');
            }
            $set = vmsSettings();
            $tok = vmsStr($b['v'] ?? '', 40);
            $vendor = null;
            $vid = '';
            if ($tok !== '') {
                foreach (vmsVendorsRaw() as [$id, $v]) {
                    if ((string) ($v->tok ?? '') === $tok) {
                        $vendor = $v;
                        $vid = (string) $id;
                        break;
                    }
                }
            }
            if (!$vendor && !$set['linkOpen']) {
                fail(403, 'forbidden', 'This posting link is not valid. Ask StratEdge for your link.');
            }
            $f = vmsReqFields($b);
            if ($f['ti'] === '' || mb_strlen($f['ti']) < 3) {
                fail(400, 'invalid_argument', 'Add the role or job title.');
            }
            if ($f['ce'] !== '' && !filter_var($f['ce'], FILTER_VALIDATE_EMAIL)) {
                fail(400, 'invalid_argument', 'Enter a valid contact email.');
            }
            if (fwScreen(['name' => $f['cn'], 'email' => $f['ce'], 'website' => $b['website'] ?? '', 't0' => $b['t0'] ?? 0, 'message' => $f['d']], 'requirement') !== '') {
                fail(400, 'spam', 'This could not be posted. Email ' . (string) cfg('mail_from') . ' instead.');
            }
            if ($vendor) {
                $f['vid'] = $vid;
                $f['vn'] = (string) ($vendor->n ?? '');
            } elseif ($f['vn'] === '') {
                $f['vn'] = $f['cl'];
            }
            $id = vmsReqSave($f, 'link', ['st' => 'new']);
            // the team hears about it
            try {
                $to = (string) cfg('apply_emails') ?: (string) cfg('mail_from');
                foreach (array_filter(array_map('trim', explode(',', $to))) as $addr) {
                    sendMail($addr, 'StratEdge', 'New requirement: ' . $f['ti'], 'A requirement was posted through the website link.' . "\n\n" . 'Role: ' . $f['ti'] . "\n" . 'From: ' . ($f['vn'] !== '' ? $f['vn'] : 'unknown') . ($f['cn'] !== '' ? ' · ' . $f['cn'] : '') . ($f['ce'] !== '' ? ' · ' . $f['ce'] : '') . "\n" . 'Location: ' . $f['loc'] . ' (' . $f['md'] . ')' . "\n" . 'Rate: ' . $f['rate'] . "\n\n" . 'Open it under Requirements desk > Inbox.', emailHtml('New requirement: ' . $f['ti'], ['A requirement was posted through the website link.', 'From: ' . ($f['vn'] !== '' ? $f['vn'] : 'unknown') . ($f['cn'] !== '' ? ' · ' . $f['cn'] : '') . "\n" . 'Location: ' . $f['loc'] . ' (' . $f['md'] . ')' . "\n" . 'Rate: ' . $f['rate'], 'Open it under Requirements desk › Inbox.'], ['Open the desk', siteUrl() . '#/portal/admin/vreqs']));
                }
            } catch (Throwable $e) {
                // the requirement is saved either way
            }
            ok(['ok' => true, 'id' => $id, 'vendor' => $vendor ? (string) ($vendor->n ?? '') : '']);
        case 'vms_grab':
        case 'vms_grab_save':
        case 'vms_contact_grab':
        case 'vms_contact_grab_save':
            // v35.1: "Grab from emails" (dropped Outlook and .eml emails, JD files, pasted text)
            require_once __DIR__ . '/vmsgrab.php';
            vgRoute($r, $b);
        case 'vms_vendor_of':
            // the vendor name for a posting link, shown on the public form
            $tok = vmsStr($b['v'] ?? ($_GET['v'] ?? ''), 40);
            $n = '';
            if ($tok !== '') {
                foreach (vmsVendorsRaw() as [$id, $v]) {
                    if ((string) ($v->tok ?? '') === $tok) {
                        $n = (string) ($v->n ?? '');
                    }
                }
            }
            ok(['vendor' => $n, 'open' => vmsSettings()['linkOpen']]);
        case 'vms_match':
            vmsStaff();
            $mres = vmsMatch(vmsStr($b['id'] ?? '', 80));
            // v35.2: whether the "On Dice" tab has something to show
            try {
                require_once __DIR__ . '/connectors.php';
                $mres['dice'] = cxApi('dice')['ops']['search']['on'];
            } catch (Throwable $e) {
                $mres['dice'] = false;
            }
            ok($mres);
        case 'vms_resummary':
            // v80: recompute and store the match summary for one requirement, or sweep the open ones (bounded)
            vmsStaff();
            if (!empty($b['all'])) {
                ok(vmsMatchSweep(max(1, min(40, (int) ($b['budget'] ?? 25)))));
            }
            $rid = vmsStr($b['id'] ?? '', 80);
            if ($rid === '') {
                fail(400, 'invalid_argument', 'Which requirement?');
            }
            ok(['mx' => vmsReqMatchSummary($rid, true)]);
        case 'vms_dice':
        case 'vms_dice_import':
            // v35.2: Dice candidates for a requirement (search, results, add to the consultant database)
            $du = vmsStaff();
            require_once __DIR__ . '/cxauto.php';
            ok(cxDeskRoute($du, $r, $b));
        case 'vms_submit':
            ok(vmsSubmit(vmsStaff(), $b));
        case 'vms_import':
            $u = vmsStaff();
            if (empty($_FILES['files'])) {
                fail(400, 'invalid_argument', 'Choose one or more files first.');
            }
            ok(vmsImport($u, $_FILES['files'], ['update' => ($_POST['update'] ?? '') === '1', 'tags' => (string) ($_POST['tags'] ?? '')]));
        case 'vms_token':
            // a fresh posting link for a vendor
            $u = vmsStaff();
            $id = vmsStr($b['id'] ?? '', 40);
            $d = docGet(VMS_VENDOR . '/' . $id);
            if (!$d) {
                fail(404, 'not_found', 'No such vendor.');
            }
            $d->tok = rid(10);
            $d->u = now();
            docSet(VMS_VENDOR . '/' . $id, $d);
            ok(['tok' => $d->tok]);
        case 'vms_jobs':
            // collected jobs that could be worked as requirements
            vmsStaff();
            $q = mb_strtolower(vmsStr($b['q'] ?? '', 120));
            $out = [];
            try {
                $pdo = jdb();
                $st = $pdo->query('SELECT id, title, company, location, remote, job_type, url, src, posted, last_seen FROM job_posts ORDER BY last_seen DESC LIMIT 600');
                foreach ($st->fetchAll() as $j) {
                    $hay = mb_strtolower($j['title'] . ' ' . $j['company'] . ' ' . $j['location']);
                    if ($q !== '' && !str_contains($hay, $q)) {
                        continue;
                    }
                    $out[] = ['id' => (int) $j['id'], 'ti' => (string) $j['title'], 'co' => (string) $j['company'], 'loc' => (string) $j['location'], 'remote' => (string) $j['remote'], 'ty' => (string) $j['job_type'], 'url' => (string) $j['url'], 'src' => (string) $j['src'], 'at' => (int) ($j['posted'] ?: $j['last_seen'])];
                    if (count($out) >= 80) {
                        break;
                    }
                }
            } catch (Throwable $e) {
                // no job tables yet
            }
            ok(['jobs' => $out]);
        case 'vms_from_job':
            $u = vmsStaff();
            $jid = (int) ($b['jobId'] ?? 0);
            $st = jdb()->prepare('SELECT * FROM job_posts WHERE id = ?');
            $st->execute([$jid]);
            $j = $st->fetch();
            if (!$j) {
                fail(404, 'not_found', 'That job is no longer in the pool.');
            }
            $desc = (string) ($j['description'] ?? '') ?: (string) ($j['summary'] ?? '');
            $f = vmsReqFields([
                'ti' => $j['title'],
                'cl' => $j['company'],
                'vn' => $j['company'],
                'loc' => $j['location'],
                'md' => preg_match('/remote/i', (string) $j['remote']) ? 'Remote' : (preg_match('/hybrid/i', (string) $j['remote']) ? 'Hybrid' : 'Onsite'),
                'ty' => $j['job_type'],
                'sk' => implode(', ', skillsIn($j['title'] . "\n" . $desc, 20)),
                'd' => ($j['url'] ? $j['url'] . "\n\n" : '') . $desc,
            ]);
            $id = vmsReqSave($f, 'feed', ['st' => 'open', 'jobId' => $jid, 'by' => $u['id']]);
            ok(['id' => $id]);
        case 'vms_settings_save':
            $u = requireAdmin();
            $d = docGet('org/vms/x/settings') ?? new stdClass();
            if (array_key_exists('mailReq', $b)) {
                $d->mailReq = !empty($b['mailReq']);
            }
            if (array_key_exists('linkOpen', $b)) {
                $d->linkOpen = !empty($b['linkOpen']);
            }
            if (isset($b['keywords'])) {
                $d->keywords = vmsStr($b['keywords'], 600);
            }
            if (isset($b['minScore'])) {
                $d->minScore = max(10, min(90, (int) $b['minScore']));
            }
            if (array_key_exists('agentOn', $b)) $d->agentOn = !empty($b['agentOn']);
            if (isset($b['agentThreshold'])) $d->agentThreshold = max(70, min(100, (int) $b['agentThreshold']));
            if (array_key_exists('agentFollow', $b)) $d->agentFollow = !empty($b['agentFollow']);
            if (!empty($b['agentOn']) && (string)($d->agentOwner ?? '') === '') $d->agentOwner = (string) $u['id'];
            docSet('org/vms/x/settings', $d);
            if (array_key_exists('agentOn', $b) || array_key_exists('agentThreshold', $b) || array_key_exists('agentFollow', $b)) {
                audit('settings', 'Vendor auto-reply agent settings changed', 'vms_agent', ['enabled' => !empty($d->agentOn), 'threshold' => (int)($d->agentThreshold ?? 86), 'followups' => !empty($d->agentFollow)], $u);
            }
            ok(['ok' => true, 'settings' => vmsSettings()]);
        case 'vms_agent_get':
            requireAdmin(); require_once __DIR__ . '/vmsagent.php'; ok(vmaPublic());
        case 'vms_agent_run': {
            $u=requireAdmin(); require_once __DIR__ . '/vmsagent.php'; @set_time_limit(330); $r=vmaCron(); audit('data','Vendor auto-reply agent run','vms_agent',$r,$u); ok($r);
        }
        case 'vms_agent_retry': {
            $u=requireAdmin(); require_once __DIR__ . '/vmsagent.php'; $id=vmsStr($b['id']??'',60); $x=docGet(VMA_COL.'/'.$id); if(!$x) fail(404,'not_found','No such vendor-agent item.'); $x->st='queued'; $x->nextFollow=0; vmaLog($x,'Queued again by '.$u['name']); docSet(VMA_COL.'/'.$id,$x); audit('data','Vendor agent item re-queued','vms_agent',['id'=>$id,'req'=>(string)($x->req??'')],$u); ok(vmaPublic());
        }
        default:
            fail(404, 'not_found', 'Unknown action.');
    }
}
