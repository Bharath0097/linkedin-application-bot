<?php
declare(strict_types=1);
/*
  The apply profile and autofill: a consultant keeps the answers every job application asks for (contact details,
  work authorization, rate, education, EEO answers, a cover letter) under u/{uid}.apply, and the "StratEdge
  autofill" bookmarklet fills them into any application page. The bookmarklet also attaches the active resume,
  which it fetches from apply_resume with a personal token (the page it runs on is another site, so the file is
  served with CORS headers and without the session).
*/
function applyTokenOf(string $uid, bool $regen = false): string
{
    $t = (string) jkvGet('apply_tok:' . $uid, '');
    if ($t === '' || $regen) {
        if ($t !== '') {
            jkvSet('apply_tok_rev:' . $t, '');
        }
        $t = bin2hex(random_bytes(16));
        jkvSet('apply_tok:' . $uid, $t);
        jkvSet('apply_tok_rev:' . $t, $uid);
    }
    return $t;
}
function applyResumeUrl(string $tok): string
{
    return siteUrl() . 'api/index.php?r=apply_resume&t=' . $tok;
}
function applyStaff(): array
{
    $u = requireUser();
    if (userLevel($u) < 2 && !isRecruiter($u['id']) && !isBench($u['id'])) {
        fail(403, 'forbidden', 'Apply profiles are for StratEdge staff and recruiters.');
    }
    return $u;
}
function applyRoute(string $r, string $method, array $b): never
{
    switch ($r) {
        /* Staff view: every consultant's apply profile, how complete it is and when the autofill was last used. */
        case 'apply_profiles':
            applyStaff();
            $rows = [];
            foreach (db()->query("SELECT path, data FROM docs WHERE col = 'u'")->fetchAll() as $row) {
                $d = json_decode($row['data']);
                if (!($d instanceof stdClass) || !($d->p instanceof stdClass)) {
                    continue;
                }
                $uid = substr($row['path'], 2);
                $a = $d->apply instanceof stdClass ? $d->apply : null;
                $role = (string) ($d->p->role ?? '');
                if (!$a && $role !== 'consultant') {
                    continue;
                }
                $rows[] = [
                    'uid' => $uid,
                    'name' => (string) ($d->p->n ?? ''),
                    'email' => (string) ($d->p->e ?? ''),
                    'role' => $role,
                    'title' => (string) ($a->title ?? ($d->p->ti ?? '')),
                    'loc' => $a ? trim(((string) ($a->city ?? '')) . ((string) ($a->state ?? '') !== '' ? ', ' . $a->state : '')) : '',
                    'auth' => (string) ($a->auth ?? ''),
                    'rate' => (string) ($a->rate ?? ''),
                    'pct' => $a ? (int) ($a->pct ?? 0) : 0,
                    'has' => (bool) $a,
                    'uses' => (int) ($a->uses ?? 0),
                    'usedAt' => (int) ($a->usedAt ?? 0),
                    'usedOn' => (string) ($a->usedOn ?? ''),
                    'u' => (int) ($a->u ?? 0),
                ];
            }
            usort($rows, fn($x, $y) => [$y['has'], $y['pct'], $x['name']] <=> [$x['has'], $x['pct'], $y['name']]);
            ok(['rows' => $rows]);
        case 'apply_profile_get':
            applyStaff();
            $uid = str($b, 'uid', 40);
            if (!preg_match('/^u_[a-f0-9]+$/', $uid)) {
                fail(400, 'invalid_argument', 'Bad person.');
            }
            $d = docGet('u/' . $uid);
            if (!$d) {
                fail(404, 'not_found', 'No such person.');
            }
            $res = [];
            foreach (jobResumes($uid) as $x) {
                $res[] = ['id' => (int) $x['id'], 'label' => $x['label'], 'name' => $x['name'], 'active' => (int) $x['active'] === 1];
            }
            ok(['name' => (string) ($d->p->n ?? ''), 'email' => (string) ($d->p->e ?? ''), 'apply' => $d->apply instanceof stdClass ? $d->apply : null, 'resumes' => $res]);
        case 'apply_token':
            $u = requireUser();
            $tok = applyTokenOf($u['id'], !empty($b['regen']));
            ok(['tok' => $tok, 'url' => applyResumeUrl($tok), 'report' => siteUrl() . 'api/index.php?r=apply_used&t=' . $tok]);
        case 'apply_used':
            // the bookmarklet reports a use (by token, from another site) so the consultant and recruiters can
            // see the profile is in service; nothing else is read or written
            $tok = (string) ($_GET['t'] ?? '');
            $uid = preg_match('/^[a-f0-9]{32}$/', $tok) ? (string) jkvGet('apply_tok_rev:' . $tok, '') : '';
            if ($uid === '') {
                fail(404, 'not_found', 'Bad token.');
            }
            $d = docGet('u/' . $uid) ?? new stdClass();
            $a = $d->apply instanceof stdClass ? $d->apply : new stdClass();
            $a->uses = (int) ($a->uses ?? 0) + 1;
            $a->usedAt = now();
            $a->usedOn = mb_substr(preg_replace('/[^a-z0-9.\-]/i', '', (string) ($_GET['host'] ?? '')) ?? '', 0, 120);
            $d->apply = $a;
            docSet('u/' . $uid, $d);
            header('Access-Control-Allow-Origin: *');
            ok(['uses' => $a->uses]);
        case 'apply_resume':
            // public by token: the active resume of the consultant the token belongs to
            $tok = (string) ($_GET['t'] ?? '');
            if (!preg_match('/^[a-f0-9]{32}$/', $tok)) {
                fail(404, 'not_found', 'Bad token.');
            }
            $uid = (string) jkvGet('apply_tok_rev:' . $tok, '');
            if ($uid === '') {
                fail(404, 'not_found', 'This resume link is no longer valid.');
            }
            $res = null;
            foreach (jobResumes($uid) as $x) {
                if ((int) $x['active'] === 1) {
                    $res = $x;
                    break;
                }
            }
            if (!$res) {
                $all = jobResumes($uid);
                $res = $all[0] ?? null;
            }
            if (!$res) {
                fail(404, 'not_found', 'No resume uploaded yet.');
            }
            $path = filePathOf((string) $res['fid']);
            if (!is_file($path)) {
                fail(404, 'not_found', 'The resume file is missing.');
            }
            $name = (string) $res['name'];
            $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
            $type = MIME[$ext] ?? 'application/octet-stream';
            header('Access-Control-Allow-Origin: *');
            header('Access-Control-Expose-Headers: Content-Disposition');
            header('Content-Type: ' . $type);
            header('Content-Length: ' . (string) filePlainSize($path));
            header('Content-Disposition: inline; filename="' . str_replace('"', '', $name) . '"');
            header('Cache-Control: private, max-age=60');
            header('X-Robots-Tag: noindex');
            fileServePath($path);
            exit();
        default:
            fail(404, 'not_found', 'Unknown action.');
    }
}
