<?php
declare(strict_types=1);
/*
 * v35: the Application bot inside the portal (routes ab_*). Replaces v34's separate workspace (application-bot/index.html
 * with start.py): the queue, approvals, run history and settings are saved here, per person, so they follow them to
 * any computer; the profile comes from their Apply profile and the résumé from My résumés.
 *
 * The forms on employer websites are filled by the StratEdge browser companion (browser-companion/, a Chrome
 * extension the person installs once): the portal page talks to it directly (externally_connectable for the StratEdge
 * addresses, or the dashboard bridge for any other address), sends it the approved jobs with the profile and résumé,
 * and records what it reports back (submitted, needs review, uncertain). The companion only runs on employer sites
 * the person allowed, never on job boards (Dice, LinkedIn, Indeed, ZipRecruiter, Monster, Glassdoor: those are a
 * manual handoff), stops at logins, CAPTCHAs and questions it cannot answer, and reports "submitted" only after a
 * visible confirmation.
 */

const AB_SCHEMA = 1;
const AB_STATUSES = ['queued', 'manual', 'review', 'submitted', 'uncertain', 'error', 'skipped'];
const AB_MAX_JOBS = 2000;
// job boards: a manual handoff, never automated (their terms forbid it)
const AB_BOARDS = [
    ['dice', 'Dice', 'dice.com', 'https://www.dice.com/jobs?q={q}&location={l}'],
    ['linkedin', 'LinkedIn', 'linkedin.com', 'https://www.linkedin.com/jobs/search/?keywords={q}&location={l}'],
    ['indeed', 'Indeed', 'indeed.com', 'https://www.indeed.com/jobs?q={q}&l={l}'],
    ['ziprecruiter', 'ZipRecruiter', 'ziprecruiter.com', 'https://www.ziprecruiter.com/jobs-search?search={q}&location={l}'],
    ['monster', 'Monster', 'monster.com', 'https://www.monster.com/jobs/search?q={q}&where={l}'],
    ['glassdoor', 'Glassdoor', 'glassdoor.com', 'https://www.glassdoor.com/Job/jobs.htm?sc.keyword={q}&locKeyword={l}'],
];
const AB_SETTINGS = ['mode' => 'review', 'dailyLimit' => 5, 'minScore' => 40, 'allowedHosts' => []];

function abdb(): PDO
{
    static $ready = false;
    $p = db();
    if ($ready) {
        return $p;
    }
    $v = (int) ($p->query("SELECT v FROM meta WHERE k = 'ab_schema'")->fetchColumn() ?: 0);
    if ($v < AB_SCHEMA) {
        $p->exec('CREATE TABLE IF NOT EXISTS ab_jobs (id VARCHAR(24) PRIMARY KEY, uid VARCHAR(40) NOT NULL, url TEXT NOT NULL, canon VARCHAR(500) NOT NULL,
            title VARCHAR(200) NOT NULL, company VARCHAR(200) NOT NULL, loc VARCHAR(160) NOT NULL, descr TEXT NOT NULL, approved INT NOT NULL,
            status VARCHAR(12) NOT NULL, note TEXT NOT NULL, src VARCHAR(40) NOT NULL, created BIGINT NOT NULL, updated BIGINT NOT NULL, done BIGINT NOT NULL)');
        $p->exec('CREATE TABLE IF NOT EXISTS ab_cfg (uid VARCHAR(40) PRIMARY KEY, data TEXT NOT NULL, u BIGINT NOT NULL)');
        try {
            $p->exec('CREATE INDEX ab_jobs_uid ON ab_jobs (uid, updated)');
        } catch (Throwable $e) {
            // already there
        }
        $p->prepare('REPLACE INTO meta (k, v) VALUES (?, ?)')->execute(['ab_schema', AB_SCHEMA]);
    }
    $ready = true;
    return $p;
}

/** The job board a link belongs to (a manual handoff), or null for an employer's own site. */
function abBoard(string $url): ?array
{
    $host = strtolower((string) parse_url($url, PHP_URL_HOST));
    foreach (AB_BOARDS as $b) {
        if ($host === $b[2] || str_ends_with($host, '.' . $b[2])) {
            return $b;
        }
    }
    if (preg_match('/(^|\.)indeed\.(co\.uk|co\.in|ca|fr|de|nl|com\.au|co\.za)$/', $host)) {
        return AB_BOARDS[2];
    }
    if (preg_match('/(^|\.)(monster|glassdoor)\.(co\.uk|ca|de|fr|com\.au|co\.in)$/', $host, $m)) {
        return $m[2] === 'monster' ? AB_BOARDS[4] : AB_BOARDS[5];
    }
    return null;
}
/** An application link: https (http only for this computer, for the practice form), no user name or password in it. */
function abSafeUrl(string $url): string
{
    $url = trim($url);
    $p = parse_url($url);
    if (!$p || empty($p['host']) || !in_array(strtolower((string) ($p['scheme'] ?? '')), ['https', 'http'], true) || isset($p['user']) || isset($p['pass'])) {
        fail(400, 'invalid_argument', 'Use the HTTPS application link from the employer, without a user name or password in it.');
    }
    if (strtolower((string) $p['scheme']) === 'http' && !in_array(strtolower((string) $p['host']), ['localhost', '127.0.0.1'], true)) {
        fail(400, 'invalid_argument', 'Employer application links must start with https://.');
    }
    return mb_substr($url, 0, 2000);
}
/** The link without tracking parameters, sorted, so the same job is not queued twice. */
function abCanon(string $url): string
{
    $p = parse_url($url);
    $q = [];
    parse_str((string) ($p['query'] ?? ''), $q);
    foreach (array_keys($q) as $k) {
        if (preg_match('/^utm_|^(trk|source|gh_src|lever-source|referral|ref)$/i', (string) $k)) {
            unset($q[$k]);
        }
    }
    ksort($q);
    $path = rtrim((string) ($p['path'] ?? ''), '/') ?: '/';
    return mb_substr(strtolower((string) $p['scheme']) . '://' . strtolower((string) $p['host']) . (isset($p['port']) ? ':' . $p['port'] : '') . $path . ($q ? '?' . http_build_query($q) : ''), 0, 500);
}
/**
 * v35.1: the exact site name the companion compares for "Submit by itself", from what a person typed or pasted
 * (careers.acme.com, or a whole application link). Returns ['', reason] when the line cannot be used.
 */
function abHostOf(string $v): array
{
    $v = trim($v);
    if ($v === '') {
        return ['', ''];
    }
    if (str_contains($v, '*')) {
        return ['', 'list each site by its full name, without *'];
    }
    $url = preg_match('~^[a-z][a-z0-9+.-]*://~i', $v) ? $v : 'https://' . ltrim($v, '/');
    $h = strtolower(rtrim((string) parse_url($url, PHP_URL_HOST), '.'));
    if ($h !== '' && preg_match('/[^\x00-\x7f]/', $h) && function_exists('idn_to_ascii')) {
        $h = (string) (idn_to_ascii($h, IDNA_DEFAULT, INTL_IDNA_VARIANT_UTS46) ?: '');
    }
    if ($h === '' || strlen($h) > 190 || !preg_match('/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/', $h) || (!str_contains($h, '.') && $h !== 'localhost')) {
        return ['', 'not a website address'];
    }
    if ($b = abBoard('https://' . $h . '/')) {
        return ['', $b[1] . ' is a job board: apply there by hand'];
    }
    return [$h, ''];
}
function abCfg(string $uid): array
{
    $s = abdb()->prepare('SELECT data FROM ab_cfg WHERE uid = ?');
    $s->execute([$uid]);
    $d = json_decode((string) ($s->fetchColumn() ?: '{}'), true) ?: [];
    return ['settings' => array_merge(AB_SETTINGS, (array) ($d['settings'] ?? [])), 'answers' => array_values((array) ($d['answers'] ?? []))];
}
function abCfgSave(string $uid, array $cfg): void
{
    abdb()->prepare('REPLACE INTO ab_cfg (uid, data, u) VALUES (?,?,?)')->execute([$uid, json_encode($cfg, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), now()]);
}
/** What the companion fills in: the person's Apply profile (and their account details where it is empty). */
function abProfile(array $u): array
{
    $d = docGet('u/' . $u['id']);
    $a = $d && isset($d->apply) && $d->apply instanceof stdClass ? get_object_vars($d->apply) : [];
    $p = $d && isset($d->p) && $d->p instanceof stdClass ? $d->p : new stdClass();
    $g = fn(string $k) => trim((string) ($a[$k] ?? ''));
    $first = $g('first');
    $last = $g('last');
    if ($first === '' && $last === '') {
        $parts = preg_split('/\s+/', trim((string) ($p->n ?? $u['name']))) ?: [];
        $first = (string) array_shift($parts);
        $last = implode(' ', $parts);
    }
    $answers = [];
    foreach (['address' => 'Street address', 'zip' => 'ZIP code', 'degree' => 'Highest degree', 'major' => 'Field of study', 'school' => 'School', 'gradyear' => 'Graduation year', 'certs' => 'Certifications', 'avail' => 'Availability', 'rate' => 'Expected hourly rate'] as $k => $q) {
        if ($g($k) !== '') {
            $answers[$q] = $g($k);
        }
    }
    return [
        'fullName' => trim($first . ' ' . $last) ?: (string) $u['name'],
        'firstName' => $first,
        'lastName' => $last,
        'email' => $g('email') ?: (string) ($p->e ?? $u['email']),
        'phone' => $g('phone') ?: (string) ($p->ph ?? ''),
        'city' => $g('city'),
        'state' => $g('state'),
        'country' => $g('country'),
        'linkedin' => $g('linkedin'),
        'website' => $g('website'),
        'currentTitle' => $g('title') ?: (string) ($p->ti ?? ''),
        'yearsExperience' => $g('years'),
        'targetRoles' => '',
        'skills' => $g('skills'),
        'workAuthorization' => $g('auth_yesno'),
        'sponsorship' => $g('sponsor'),
        'relocation' => $g('relocate'),
        'salary' => $g('salary'),
        'answers' => $answers,
    ];
}
function abJobOut(array $r): array
{
    return [
        'id' => (string) $r['id'],
        'url' => (string) $r['url'],
        'title' => (string) $r['title'],
        'company' => (string) $r['company'],
        'location' => (string) $r['loc'],
        'description' => (string) $r['descr'],
        'approved' => (int) $r['approved'] === 1,
        'status' => (string) $r['status'],
        'note' => (string) $r['note'],
        'src' => (string) $r['src'],
        'createdAt' => (int) $r['created'],
        'updatedAt' => (int) $r['updated'],
        'done' => (int) $r['done'],
        'board' => ($b = abBoard((string) $r['url'])) ? $b[1] : '',
    ];
}
function abJobs(string $uid): array
{
    $s = abdb()->prepare('SELECT * FROM ab_jobs WHERE uid = ? ORDER BY created DESC LIMIT ' . AB_MAX_JOBS);
    $s->execute([$uid]);
    return array_map('abJobOut', $s->fetchAll());
}
function abJob(string $uid, string $id): array
{
    $s = abdb()->prepare('SELECT * FROM ab_jobs WHERE id = ? AND uid = ?');
    $s->execute([$id, $uid]);
    $r = $s->fetch();
    if (!$r) {
        fail(404, 'not_found', 'That job is not in your queue any more.');
    }
    return $r;
}
/** Adds one job to the person's queue (or updates it when $id is given). Returns the saved job. */
function abJobPut(string $uid, array $in, string $id = '', string $src = 'manual'): array
{
    $url = abSafeUrl((string) ($in['url'] ?? ''));
    $title = mb_substr(trim((string) ($in['title'] ?? '')), 0, 200);
    $company = mb_substr(trim((string) ($in['company'] ?? '')), 0, 200);
    if ($title === '' || $company === '') {
        fail(400, 'invalid_argument', 'Add the job title and the company name.');
    }
    $canon = abCanon($url);
    $dupe = abdb()->prepare('SELECT id FROM ab_jobs WHERE uid = ? AND canon = ? AND id <> ?');
    $dupe->execute([$uid, $canon, $id]);
    if ($dupe->fetchColumn()) {
        fail(409, 'invalid_argument', 'This job is already in your queue.');
    }
    $manual = abBoard($url) !== null;
    $now = now();
    $row = [
        'url' => $url,
        'canon' => $canon,
        'title' => $title,
        'company' => $company,
        'loc' => mb_substr(trim((string) ($in['location'] ?? '')), 0, 160),
        'descr' => mb_substr((string) ($in['description'] ?? ''), 0, 20000),
        'approved' => !empty($in['approved']) ? 1 : 0,
    ];
    if ($id === '') {
        $n = abdb()->prepare('SELECT COUNT(*) FROM ab_jobs WHERE uid = ?');
        $n->execute([$uid]);
        if ((int) $n->fetchColumn() >= AB_MAX_JOBS) {
            fail(400, 'invalid_argument', 'Your queue holds ' . AB_MAX_JOBS . ' jobs. Remove finished ones first.');
        }
        $id = rid(8);
        abdb()->prepare('INSERT INTO ab_jobs (id, uid, url, canon, title, company, loc, descr, approved, status, note, src, created, updated, done) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)')
            ->execute([$id, $uid, $row['url'], $row['canon'], $row['title'], $row['company'], $row['loc'], $row['descr'], $row['approved'], $manual ? 'manual' : 'queued', $manual ? 'Apply on the job board yourself, then mark it here.' : '', mb_substr($src, 0, 40), $now, $now]);
    } else {
        $cur = abJob($uid, $id);
        $status = (string) $cur['status'];
        if ($manual && $status === 'queued') {
            $status = 'manual';
        } elseif (!$manual && $status === 'manual') {
            $status = 'queued';
        }
        abdb()->prepare('UPDATE ab_jobs SET url = ?, canon = ?, title = ?, company = ?, loc = ?, descr = ?, approved = ?, status = ?, updated = ? WHERE id = ? AND uid = ?')
            ->execute([$row['url'], $row['canon'], $row['title'], $row['company'], $row['loc'], $row['descr'], $row['approved'], $status, $now, $id, $uid]);
    }
    return abJobOut(abJob($uid, $id));
}
/** The person's active résumé from My résumés, as the companion attaches it (a data: address), or null. */
function abResume(string $uid): ?array
{
    require_once __DIR__ . '/jobs.php';
    $all = jobResumes($uid);
    $pick = null;
    foreach ($all as $x) {
        if ((int) $x['active'] === 1) {
            $pick = $x;
            break;
        }
    }
    $pick = $pick ?? ($all[0] ?? null);
    if (!$pick) {
        return null;
    }
    $name = (string) $pick['name'];
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    if (!in_array($ext, ['pdf', 'docx'], true)) {
        return ['name' => $name, 'error' => 'Employer forms take a PDF or Word (.docx) résumé; upload one under My résumés.'];
    }
    return ['name' => $name, 'fid' => (string) $pick['fid'], 'ext' => $ext];
}
function abTodaySubmitted(string $uid): int
{
    $s = abdb()->prepare("SELECT COUNT(*) FROM ab_jobs WHERE uid = ? AND status IN ('submitted', 'uncertain') AND done >= ?");
    $s->execute([$uid, strtotime('today') * 1000]);
    return (int) $s->fetchColumn();
}

function abRoute(string $r, array $b): never
{
    $u = requireUser();
    $uid = (string) $u['id'];
    switch ($r) {
        case 'ab_boot':
            $cfg = abCfg($uid);
            $res = abResume($uid);
            ok([
                'profile' => abProfile($u),
                'settings' => $cfg['settings'],
                'answers' => $cfg['answers'],
                'jobs' => abJobs($uid),
                'resume' => $res ? array_diff_key($res, ['fid' => 1]) : null,
                'today' => abTodaySubmitted($uid),
                'boards' => array_map(fn($x) => ['id' => $x[0], 'name' => $x[1], 'host' => $x[2], 'search' => $x[3]], AB_BOARDS),
                // where the practice form is, relative to the page (the page resolves it on the address it is open at)
                'practice' => 'application-bot/practice.html',
                'staff' => userLevel($u) >= 2 || isBench($uid),
            ]);
        case 'ab_job_save':
            $job = abJobPut($uid, $b, str($b, 'id', 24), str($b, 'src', 40) ?: 'manual');
            ok(['job' => $job]);
        case 'ab_jobs_add':
            // several at once (a CSV, or matches from Job portals): the ones that cannot be added are listed
            $added = [];
            $skipped = [];
            foreach (array_slice((array) ($b['jobs'] ?? []), 0, 500) as $i => $in) {
                if (!is_array($in)) {
                    continue;
                }
                try {
                    $added[] = abJobPutSoft($uid, $in, str($b, 'src', 40) ?: 'import');
                } catch (RuntimeException $e) {
                    $skipped[] = 'Row ' . ($i + 1) . ': ' . $e->getMessage();
                }
            }
            ok(['added' => count($added), 'skipped' => $skipped, 'jobs' => abJobs($uid)]);
        case 'ab_job_delete':
            abJob($uid, str($b, 'id', 24));
            abdb()->prepare('DELETE FROM ab_jobs WHERE id = ? AND uid = ?')->execute([str($b, 'id', 24), $uid]);
            ok(['ok' => true]);
        case 'ab_job_status':
            // what the companion reported, or the person marking a job board application as done
            $row = abJob($uid, str($b, 'id', 24));
            $st = str($b, 'status', 12);
            if (!in_array($st, AB_STATUSES, true)) {
                fail(400, 'invalid_argument', 'Unknown status.');
            }
            $note = mb_substr(str($b, 'note', 2000), 0, 2000);
            $done = in_array($st, ['submitted', 'uncertain'], true) ? ((int) $row['done'] ?: now()) : 0;
            abdb()->prepare('UPDATE ab_jobs SET status = ?, note = ?, updated = ?, done = ? WHERE id = ? AND uid = ?')->execute([$st, $note, now(), $done, (string) $row['id'], $uid]);
            ok(['job' => abJobOut(abJob($uid, (string) $row['id'])), 'today' => abTodaySubmitted($uid)]);
        case 'ab_settings_save':
            // v35.1: a pasted link keeps its site name, and every line that cannot be used comes back with the reason
            // (until v35 such lines disappeared without a word, so "Submit by itself" kept refusing the site)
            $cfg = abCfg($uid);
            $hosts = [];
            $dropped = [];
            foreach (array_slice((array) ($b['allowedHosts'] ?? []), 0, 200) as $raw) {
                $raw = trim((string) $raw);
                [$h, $why] = abHostOf($raw);
                if ($h === '') {
                    if ($why !== '') {
                        $dropped[] = ['v' => mb_substr($raw, 0, 120), 'why' => $why];
                    }
                } elseif (!in_array($h, $hosts, true)) {
                    if (count($hosts) >= 50) {
                        $dropped[] = ['v' => $h, 'why' => 'the list holds 50 sites'];
                    } else {
                        $hosts[] = $h;
                    }
                }
            }
            $cfg['settings'] = [
                'mode' => str($b, 'mode', 10) === 'auto' ? 'auto' : 'review',
                'dailyLimit' => max(1, min(50, (int) ($b['dailyLimit'] ?? 5))),
                'minScore' => max(0, min(100, (int) ($b['minScore'] ?? 40))),
                'allowedHosts' => $hosts,
            ];
            abCfgSave($uid, $cfg);
            ok(['settings' => $cfg['settings'], 'dropped' => $dropped]);
        case 'ab_allow_host':
            // v35.1: the one-click "Allow <site>" buttons (the run check, a job's note, the suggestions in Settings)
            $cfg = abCfg($uid);
            $list = array_values(array_filter(array_map('strval', (array) $cfg['settings']['allowedHosts'])));
            foreach (array_slice((array) ($b['hosts'] ?? []), 0, 50) as $raw) {
                [$h, $why] = abHostOf((string) $raw);
                if ($h === '') {
                    fail(400, 'invalid_argument', mb_substr(trim((string) $raw), 0, 80) . ': ' . ($why ?: 'not a website address') . '.');
                }
                if (!in_array($h, $list, true)) {
                    $list[] = $h;
                }
            }
            if (count($list) > 50) {
                fail(400, 'invalid_argument', 'Your list holds 50 sites. Remove some under Settings first.');
            }
            $cfg['settings']['allowedHosts'] = $list;
            abCfgSave($uid, $cfg);
            ok(['settings' => $cfg['settings']]);
        case 'ab_answers_save':
            $cfg = abCfg($uid);
            $out = [];
            foreach (array_slice((array) ($b['answers'] ?? []), 0, 100) as $x) {
                $q = mb_substr(trim((string) (is_array($x) ? ($x['q'] ?? '') : '')), 0, 300);
                $a = mb_substr(trim((string) (is_array($x) ? ($x['a'] ?? '') : '')), 0, 5000);
                if ($q !== '' && $a !== '') {
                    $out[] = ['q' => $q, 'a' => $a];
                }
            }
            $cfg['answers'] = $out;
            abCfgSave($uid, $cfg);
            ok(['answers' => $out]);
        case 'ab_resume':
            // the résumé the companion attaches to forms (the person's own file only)
            $res = abResume($uid);
            if (!$res || isset($res['error'])) {
                ok(['resume' => null, 'error' => $res['error'] ?? '']);
            }
            $data = fileReadPath(filePathOf($res['fid']));
            if ($data === null || strlen($data) > 5 * 1048576) {
                ok(['resume' => null, 'error' => 'The résumé file is missing or larger than 5 MB.']);
            }
            ok(['resume' => ['name' => $res['name'], 'data' => 'data:' . MIME[$res['ext']] . ';base64,' . base64_encode($data)]]);
        case 'ab_team':
            // staff and recruiting team: how the consultants use the bot (counts only)
            if (userLevel($u) < 2 && !isBench($uid)) {
                fail(403, 'forbidden', 'This view is for StratEdge staff.');
            }
            $since = now() - 30 * 86400000;
            $s = abdb()->prepare("SELECT uid, COUNT(*) AS jobs, SUM(approved) AS approved, SUM(CASE WHEN status IN ('submitted','uncertain') AND done >= ? THEN 1 ELSE 0 END) AS sent30,
                SUM(CASE WHEN status = 'review' THEN 1 ELSE 0 END) AS review, MAX(updated) AS last FROM ab_jobs GROUP BY uid ORDER BY last DESC LIMIT 300");
            $s->execute([$since]);
            $rows = [];
            foreach ($s->fetchAll() as $x) {
                $p = userRow((string) $x['uid']);
                if ($p) {
                    $rows[] = ['uid' => (string) $x['uid'], 'n' => (string) $p['name'], 'e' => (string) $p['email'], 'jobs' => (int) $x['jobs'], 'approved' => (int) $x['approved'], 'sent30' => (int) $x['sent30'], 'review' => (int) $x['review'], 'last' => (int) $x['last']];
                }
            }
            ok(['people' => $rows]);
        default:
            fail(404, 'not_found', 'Unknown action.');
    }
}
/** abJobPut for imports: problems become exceptions instead of ending the request. */
function abJobPutSoft(string $uid, array $in, string $src): array
{
    $url = trim((string) ($in['url'] ?? ''));
    $p = parse_url($url);
    if (!$p || empty($p['host']) || !in_array(strtolower((string) ($p['scheme'] ?? '')), ['https', 'http'], true) || isset($p['user']) || (strtolower((string) $p['scheme']) === 'http' && !in_array(strtolower((string) $p['host']), ['localhost', '127.0.0.1'], true))) {
        throw new RuntimeException('needs an https:// application link');
    }
    if (trim((string) ($in['title'] ?? '')) === '' || trim((string) ($in['company'] ?? '')) === '') {
        throw new RuntimeException('needs a job title and a company');
    }
    $dupe = abdb()->prepare('SELECT id FROM ab_jobs WHERE uid = ? AND canon = ?');
    $dupe->execute([$uid, abCanon($url)]);
    if ($dupe->fetchColumn()) {
        throw new RuntimeException('already in your queue');
    }
    return abJobPut($uid, $in, '', $src);
}
