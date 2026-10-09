<?php
declare(strict_types=1);
/*
  The apply profile and autofill: a consultant keeps the answers every job application asks for (contact details,
  work authorization, rate, education, EEO answers, a cover letter) under u/{uid}.apply, and the "StratEdge
  autofill" bookmarklet fills them into any application page. The bookmarklet also attaches the active resume,
  which it fetches from apply_resume with a personal token (the page it runs on is another site, so the file is
  served with CORS headers and without the session).
*/
// v83: the resume link runs on third-party pages, so it does not live forever: 180 days from issue, then opening the
// apply profile page issues a fresh one (drag the autofill button again)
const APPLY_TOK_TTL = 180 * 86400000;
function applyTokenOf(string $uid, bool $regen = false): string
{
    $t = (string) jkvGet('apply_tok:' . $uid, '');
    if ($t !== '' && !$regen) {
        $at = (int) jkvGet('apply_tok_at:' . $t, 0);
        if ($at === 0) {
            jkvSet('apply_tok_at:' . $t, now()); // a link issued before v83 starts its clock now
        } elseif (now() - $at > APPLY_TOK_TTL) {
            $regen = true;
        }
    }
    if ($t === '' || $regen) {
        if ($t !== '') {
            jkvSet('apply_tok_rev:' . $t, '');
            jkvSet('apply_tok_at:' . $t, 0);
        }
        $t = bin2hex(random_bytes(16));
        jkvSet('apply_tok:' . $uid, $t);
        jkvSet('apply_tok_rev:' . $t, $uid);
        jkvSet('apply_tok_at:' . $t, now());
    }
    return $t;
}
/** The person a resume-link token belongs to, or '' when it is unknown, revoked or past its lifetime. */
function applyTokenUid(string $tok): string
{
    if (!preg_match('/^[a-f0-9]{32}$/', $tok)) {
        return '';
    }
    $uid = (string) jkvGet('apply_tok_rev:' . $tok, '');
    $at = (int) jkvGet('apply_tok_at:' . $tok, 0);
    if ($uid !== '' && $at > 0 && now() - $at > APPLY_TOK_TTL) {
        return '';
    }
    return $uid;
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
// v83: EEO self-identification stays with the person (the apply page promises it); staff views never get it
const APPLY_EEO_KEYS = ['gender', 'race', 'veteran', 'disability'];
/** Whose apply profile staff may open: consultants only (the Apply profiles tab is "every consultant"). */
function applyIsConsultant(string $uid): bool
{
    if (portalOf($uid) === 'consultant') {
        return true;
    }
    $row = userRow($uid);
    return $row !== null && in_array('consultant', accessOf($row)['portals'], true);
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
                if (!($d instanceof stdClass) || !(($d->p ?? null) instanceof stdClass)) {
                    continue;
                }
                $uid = substr($row['path'], 2);
                $a = ($d->apply ?? null) instanceof stdClass ? $d->apply : null;
                $role = (string) ($d->p->role ?? '');
                // v83: consultants only; staff who tried the autofill on their own profile are not listed
                if (!applyIsConsultant($uid)) {
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
            if (!$d || !applyIsConsultant($uid)) {
                fail(404, 'not_found', 'No such person.');
            }
            // v83: a copy without the voluntary self-identification answers
            $a = ($d->apply ?? null) instanceof stdClass ? clone $d->apply : null;
            if ($a) {
                foreach (APPLY_EEO_KEYS as $k) {
                    unset($a->$k);
                }
            }
            $res = [];
            foreach (jobResumes($uid) as $x) {
                $res[] = ['id' => (int) $x['id'], 'label' => $x['label'], 'name' => $x['name'], 'active' => (int) $x['active'] === 1];
            }
            ok(['name' => (string) ($d->p->n ?? ''), 'email' => (string) ($d->p->e ?? ''), 'apply' => $a, 'resumes' => $res]);
        case 'apply_token':
            $u = requireUser();
            $tok = applyTokenOf($u['id'], !empty($b['regen']));
            ok(['tok' => $tok, 'url' => applyResumeUrl($tok), 'report' => siteUrl() . 'api/index.php?r=apply_used&t=' . $tok]);
        case 'apply_used':
            // the bookmarklet reports a use (by token, from another site) so the consultant and recruiters can
            // see the profile is in service; nothing else is read or written
            $tok = (string) ($_GET['t'] ?? '');
            $uid = applyTokenUid($tok);
            if ($uid === '') {
                fail(404, 'not_found', 'Bad token.');
            }
            $d = docGet('u/' . $uid) ?? new stdClass();
            $a = ($d->apply ?? null) instanceof stdClass ? $d->apply : new stdClass();
            $host = mb_substr(preg_replace('/[^a-z0-9.\-]/i', '', (string) ($_GET['host'] ?? '')) ?? '', 0, 120);
            // v83: one use per site per minute, and at most 30 an hour per link, so a page holding the link cannot
            // inflate the counter recruiters see
            if ((now() - (int) ($a->usedAt ?? 0) < 60000 && (string) ($a->usedOn ?? '') === $host) || throttleHit('apply_used:' . $tok, 30, 3600)) {
                header('Access-Control-Allow-Origin: *');
                ok(['uses' => (int) ($a->uses ?? 0)]);
            }
            $a->uses = (int) ($a->uses ?? 0) + 1;
            $a->usedAt = now();
            $a->usedOn = $host;
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
            $uid = applyTokenUid($tok);
            if ($uid === '') {
                fail(404, 'not_found', 'This resume link is no longer valid. Open your apply profile and drag the autofill button to your bookmarks bar again.');
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
