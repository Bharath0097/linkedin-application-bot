<?php
declare(strict_types=1);
/*
  The talent marketplace: employers (client contacts and vendor contacts signed in to the client portal) search the
  people StratEdge has marked as marketable, see a redacted profile (title, skills, years, location, availability,
  rate band, a scrubbed summary), request the full profile, and get it once a recruiter approves. Requirements the
  employer posts can be matched against the same pool. Staff mark people from the consultant database, the ATS and
  the job portal (bench) under Talent marketplace › Profiles.

  Records: org/mkt/items/{key}   one marketable person (key = db_<id> | ats_<id> | portal_<uid>)
           org/mkt/req/{id}      a profile request and its decision
           org/mkt/x/settings    band width, summary length
           e/{uid}/mkt/{key}     an employer's shortlist (written by the browser)
*/
const MKT_ITEMS = 'org/mkt/items';
const MKT_REQ = 'org/mkt/req';
function mktSettings(): array
{
    $d = docGet('org/mkt/x/settings');
    return [
        'band' => max(5, min(50, (int) ($d->band ?? 10))),
        'summary' => max(200, min(2000, (int) ($d->summary ?? 700))),
        'intro' => (string) ($d->intro ?? ''),
        'autoApprove' => array_values(array_filter((array) ($d->autoApprove ?? []), 'is_string')),
    ];
}
function mktStaff(): array
{
    $u = requireUser();
    if (userLevel($u) < 2 && !isRecruiter($u['id']) && !isBench($u['id'])) {
        fail(403, 'forbidden', 'The talent marketplace is run by StratEdge staff and recruiters.');
    }
    return $u;
}
/** The organisation an employer login belongs to: a client workspace or a vendor on the vendors list. */
function mktEmployer(array $u, string $cidWanted = ''): ?array
{
    $r = myR($u['id']);
    $vid = (string) ($r->vid ?? '');
    if ($vid !== '') {
        $v = docGet('vms/vendor/items/' . $vid);
        return ['kind' => 'vendor', 'id' => $vid, 'n' => (string) ($v->n ?? ($r->cl ?? 'Vendor'))];
    }
    $cids = myCids($u['id']);
    if (!$cids) {
        return null;
    }
    $cid = $cidWanted !== '' && in_array($cidWanted, $cids, true) ? $cidWanted : $cids[0];
    $c = docGet('org/admin/clients/' . $cid);
    return ['kind' => 'client', 'id' => $cid, 'n' => (string) ($c->n ?? ($r->cl ?? 'Client'))];
}
function mktEmployerUser(): array
{
    $u = requireUser();
    if (userLevel($u) >= 2 || isRecruiter($u['id']) || isBench($u['id'])) {
        return $u; // staff may look at what employers see
    }
    if (!mktEmployer($u)) {
        fail(403, 'forbidden', 'The talent marketplace is for client and vendor contacts.');
    }
    return $u;
}
function mktKey(string $src, string $id): string
{
    return $src . '_' . $id;
}
function mktSplitKey(string $key): ?array
{
    return preg_match('/^(db|ats|portal)_([A-Za-z0-9_\-]{1,60})$/', $key, $m) ? [$m[1], $m[2]] : null;
}
function mktCode(string $key): string
{
    return 'SE-' . strtoupper(substr(md5('mkt|' . $key), 0, 5));
}
/** One person in the matcher's shape (see vmsCandidates), plus the resume text and years when asked. */
function mktCandidate(string $src, string $id, bool $withText): ?array
{
    static $portal = null;
    if ($src === 'db' || $src === 'ats') {
        $base = $src === 'db' ? 'rec/cand/items/' . $id : 'ats/' . $id;
        $c = docGet($base);
        if (!$c) {
            return null;
        }
        $txt = $withText ? vmsResumeText($base) : '';
        $prof = $txt !== '' ? resumeProfile($txt) : ['titles' => [], 'skills' => [], 'location' => '', 'years' => null];
        if ($src === 'db') {
            $skills = array_values(array_unique(array_merge(skillsCanon(vmsSplitSkills((string) ($c->sk ?? ''))), (array) ($prof['skills'] ?? []))));
            $years = (string) ($c->exp ?? '') !== '' ? (int) preg_replace('/\D/', '', (string) $c->exp) : ($prof['years'] ?? null);
            return ['src' => 'db', 'id' => $id, 'n' => (string) ($c->n ?? ''), 'ti' => (string) ($c->ti ?? ($prof['titles'][0] ?? '')), 'titles' => array_values(array_filter(array_unique(array_merge([(string) ($c->ti ?? '')], (array) ($prof['titles'] ?? []))))), 'skills' => $skills, 'loc' => (string) ($c->loc ?? ($prof['location'] ?? '')), 'auth' => (string) ($c->auth ?? ''), 'rate' => (string) ($c->rate ?? ''), 'e' => (string) ($c->e ?? ''), 'ph' => (string) ($c->ph ?? ''), 'avail' => (string) ($c->avail ?? ''), 'reloc' => (string) ($c->reloc ?? ''), 'tags' => (array) ($c->tags ?? []), 'resume' => $txt !== '', 'years' => $years, 'txt' => $txt, 'st' => (string) ($c->st ?? 'active'), 'u' => (int) ($c->u ?? $c->at ?? 0)];
        }
        if (in_array((string) ($c->st ?? ''), ['rejected', 'hired'], true)) {
            return null;
        }
        return ['src' => 'ats', 'id' => $id, 'n' => (string) ($c->n ?? ''), 'ti' => (string) ($c->jt ?? ($prof['titles'][0] ?? '')), 'titles' => array_values(array_filter(array_unique(array_merge([(string) ($c->jt ?? '')], (array) ($prof['titles'] ?? []))))), 'skills' => (array) ($prof['skills'] ?? []), 'loc' => (string) ($c->loc ?? ($prof['location'] ?? '')), 'auth' => (string) ($c->auth ?? ''), 'rate' => '', 'e' => (string) ($c->e ?? ''), 'ph' => (string) ($c->ph ?? ''), 'avail' => '', 'reloc' => '', 'tags' => [], 'resume' => $txt !== '', 'years' => $prof['years'] ?? null, 'txt' => $txt, 'st' => (string) ($c->st ?? ''), 'u' => (int) ($c->u ?? $c->at ?? 0)];
    }
    if ($src === 'portal') {
        if ($portal === null) {
            $portal = [];
            try {
                foreach (jobPeopleActive() as $p) {
                    $portal[(string) $p['uid']] = $p;
                }
            } catch (Throwable $e) {
                $portal = [];
            }
        }
        $p = $portal[$id] ?? null;
        if (!$p) {
            return null;
        }
        $prof = jdec($p['profile']);
        $pref = jdec($p['prefs']);
        $titles = array_values(array_filter((array) ($pref['titles'] ?? []), 'is_string')) ?: array_values(array_filter((array) ($prof['titles'] ?? []), 'is_string'));
        $txt = '';
        if ($withText) {
            $txt = (string) ($p['resume_text'] ?? '');
            if ($txt === '') {
                foreach (jobResumes($id) as $r) {
                    if ((int) $r['active'] === 1 || $txt === '') {
                        $full = jobResume($id, (int) $r['id']);
                        $txt = (string) ($full['resume_text'] ?? '');
                    }
                }
            }
        }
        $apply = docGet('u/' . $id)->apply ?? null;
        return ['src' => 'portal', 'id' => $id, 'n' => (string) $p['name'], 'ti' => (string) ($titles[0] ?? ''), 'titles' => $titles, 'skills' => array_values(array_unique(array_merge(array_filter((array) ($prof['skills'] ?? []), 'is_string'), skillsCanon((array) ($pref['skills'] ?? []))))), 'loc' => (string) (($pref['locations'][0] ?? null) ?: ($prof['location'] ?? '')), 'auth' => (string) ($apply->auth ?? ($pref['auth'] ?? '')), 'rate' => (string) ($apply->rate ?? ($pref['rate'] ?? '')), 'e' => (string) $p['email'], 'ph' => (string) ($apply->phone ?? ''), 'avail' => (string) ($apply->avail ?? ''), 'reloc' => (string) ($apply->relocate ?? ''), 'tags' => [], 'resume' => (string) ($p['resume_name'] ?? '') !== '', 'years' => $prof['years'] ?? (isset($apply->years) ? (int) $apply->years : null), 'txt' => $txt, 'st' => 'active', 'u' => (int) ($p['updated_at'] ?? 0)];
    }
    return null;
}
/** Every marketable person with their record: [['key'=>…, 'item'=>stdClass, 'c'=>array], …]. */
function mktPool(bool $withText): array
{
    $out = [];
    foreach (colAll(MKT_ITEMS, null, 'asc') as [$key, $it]) {
        if (empty($it->on)) {
            continue;
        }
        $sp = mktSplitKey((string) $key);
        if (!$sp) {
            continue;
        }
        $c = mktCandidate($sp[0], $sp[1], $withText);
        if (!$c || ($c['src'] === 'db' && $c['st'] === 'inactive')) {
            continue;
        }
        $out[] = ['key' => (string) $key, 'item' => $it, 'c' => $c];
    }
    return $out;
}
/** A rate as a band: "$70–80/hr" or "$120–130k/yr"; '' when there is no usable number. */
function mktBand(string $rate, int $w): string
{
    if (!preg_match('/(\d[\d,]*(?:\.\d+)?)/', $rate, $m)) {
        return '';
    }
    $n = (float) str_replace(',', '', $m[1]);
    if (preg_match('/\bk\b/i', $rate) && $n < 1000) {
        $n *= 1000;
    }
    if ($n >= 20 && $n <= 400) {
        $lo = (int) (floor($n / $w) * $w);
        return '$' . $lo . '–' . ($lo + $w) . '/hr';
    }
    if ($n > 1000) {
        $lo = (int) (floor($n / 10000) * 10);
        return '$' . $lo . '–' . ($lo + 10) . 'k/yr';
    }
    return '';
}
/** The resume summary an employer sees: no name, email, phone, links or street address, cut to a sensible length. */
function mktScrub(string $txt, string $name, int $len): string
{
    $t = preg_replace('/\r/', '', $txt) ?? '';
    $t = preg_replace('/[\w.+-]+@[\w-]+\.[\w.-]+/u', '[email hidden]', $t) ?? $t;
    // phone numbers (not year ranges like 2015 - 2019): 10+ digits, or 7+ digits with separators and no 4-digit-year shape
    $t = preg_replace_callback('/\+?\(?\d[\d\s().-]{6,}\d/', function ($m) {
        $digits = preg_replace('/\D/', '', $m[0]) ?? '';
        if (strlen($digits) >= 10 && strlen($digits) <= 13) {
            return '[phone hidden]';
        }
        return $m[0];
    }, $t) ?? $t;
    $t = preg_replace('/\[phone hidden\]\s*(?:ext|x)\.?\s*\d+/i', '[phone hidden]', $t) ?? $t;
    $t = preg_replace('#(?:https?://|www\.)\S+#i', '[link hidden]', $t) ?? $t;
    $t = preg_replace('/\blinkedin\b[^\n]*/i', '[link hidden]', $t) ?? $t;
    foreach (array_filter(preg_split('/\s+/', trim($name)) ?: []) as $part) {
        if (mb_strlen($part) >= 3) {
            $t = preg_replace('/\b' . preg_quote($part, '/') . '\b/iu', '', $t) ?? $t;
        }
    }
    $t = preg_replace('/^\s*(?:address|phone|mobile|email|e-mail|cell|contact|name|full name|candidate name|candidate)\s*[:\-].*$/mi', '', $t) ?? $t;
    // whole lines that are only contact details (the header block): drop them instead of leaving "[hidden] | [hidden]"
    $lines = explode("\n", $t);
    $out = [];
    foreach ($lines as $i => $ln) {
        $plain = trim(preg_replace('/\[(?:email|phone|link) hidden\]|[|•·,()\-–\s]+/u', ' ', $ln) ?? $ln);
        $hidden = preg_match_all('/\[(?:email|phone|link) hidden\]/', $ln);
        if ($hidden && (mb_strlen($plain) < 4 || ($i < 8 && mb_strlen($plain) < 40))) {
            continue; // contact line
        }
        $out[] = $ln;
    }
    // v36: the resume's own name line (often spelled differently from the record, or someone's preferred name):
    // the first line when it holds only a name, with or without "Name:"
    foreach ($out as $i => $ln) {
        if (trim($ln) === '') {
            continue;
        }
        if ((preg_match('/^\s*\p{Lu}[\p{L}\'’.\-]+(?:\s+\p{Lu}[\p{L}\'’.\-]*){1,3}\s*$/u', $ln) || preg_match('/^\s*(?:\p{Lu}\.?\s*){1,3}$/u', $ln)) && !preg_match('/\b(?:engineer|developer|consultant|manager|analyst|architect|administrator|admin|lead|specialist|designer|tester|scientist|summary|profile|resume|curriculum|objective|professional|experience|skills|sap|java|python|oracle|aws|azure)\b/i', $ln)) {
            unset($out[$i]);
        }
        break;
    }
    $t = implode("\n", $out);
    $t = preg_replace('/[ \t]{2,}/', ' ', $t) ?? $t;
    $t = preg_replace('/^[ \t|•·,\-–]+$/m', '', $t) ?? $t;
    $t = preg_replace('/\n{3,}/', "\n\n", $t) ?? $t;
    $t = trim($t);
    if (mb_strlen($t) > $len) {
        $t = rtrim(mb_substr($t, 0, $len)) . '…';
    }
    return $t;
}
/** What an employer sees of one person; $full adds the name, contact details and the resume (after approval). */
function mktCard(array $row, array $S, bool $full = false): array
{
    $c = $row['c'];
    $it = $row['item'];
    $band = (string) ($it->band ?? '');
    if ($band === '') {
        $band = mktBand($c['rate'], $S['band']);
    }
    $out = [
        'pid' => $row['key'],
        'code' => mktCode($row['key']),
        'ti' => (string) ($it->hl ?? '') !== '' ? (string) $it->hl : $c['ti'],
        'titles' => array_slice($c['titles'], 0, 3),
        'skills' => array_slice($c['skills'], 0, 18),
        'years' => $c['years'],
        'loc' => $c['loc'],
        'auth' => $c['auth'],
        'avail' => (string) ($it->avail ?? '') !== '' ? (string) $it->avail : $c['avail'],
        'reloc' => $c['reloc'],
        'band' => $band,
        'resume' => $c['resume'],
        'summary' => $c['txt'] !== '' ? mktScrub($c['txt'], $c['n'], $S['summary']) : '',
        'src' => $c['src'] === 'portal' ? 'bench' : ($c['src'] === 'ats' ? 'candidate' : 'database'),
        'u' => max((int) ($it->u ?? 0), (int) $c['u']),
    ];
    if ($full) {
        $out['n'] = $c['n'];
        $out['e'] = $c['e'];
        $out['ph'] = $c['ph'];
    }
    return $out;
}
/** The resume file of a marketable person: [name, type, path] or null. */
function mktResumeFile(array $c): ?array
{
    if ($c['src'] === 'portal') {
        $best = null;
        foreach (jobResumes($c['id']) as $r) {
            if ((int) $r['active'] === 1 || $best === null) {
                $best = $r;
            }
        }
        if (!$best) {
            return null;
        }
        $ext = strtolower(pathinfo((string) $best['name'], PATHINFO_EXTENSION));
        $path = fileLocal((string) $best['fid'], $ext);
        return $path !== null ? [(string) $best['name'], MIME[$ext] ?? 'application/octet-stream', $path] : null;
    }
    $base = $c['src'] === 'db' ? 'rec/cand/items/' . $c['id'] : 'ats/' . $c['id'];
    $pick = null;
    foreach (colAll($base . '/f', null, 'asc') as [$fid, $f]) {
        if ((string) ($f->c ?? '') === 'resume' || $pick === null) {
            $pick = [(string) ($f->n ?? 'resume.pdf'), (string) ($f->ty ?? 'application/octet-stream'), (string) $fid];
        }
    }
    if (!$pick) {
        return null;
    }
    $local = fileLocal($pick[2], strtolower(pathinfo($pick[0], PATHINFO_EXTENSION)));
    return $local !== null ? [$pick[0], $pick[1], $local] : null;
}
function mktReqOut(string $id, stdClass $d, ?array $card = null): array
{
    return [
        'id' => $id,
        'pid' => (string) ($d->pid ?? ''),
        'code' => mktCode((string) ($d->pid ?? '')),
        'ti' => (string) ($d->ti ?? ''),
        'by' => (string) ($d->by ?? ''),
        'byn' => (string) ($d->byn ?? ''),
        'bye' => (string) ($d->bye ?? ''),
        'org' => (string) ($d->org ?? ''),
        'orgKind' => (string) ($d->orgKind ?? ''),
        'rq' => (string) ($d->rq ?? ''),
        'rqTitle' => (string) ($d->rqTitle ?? ''),
        'note' => (string) ($d->note ?? ''),
        'st' => (string) ($d->st ?? 'new'),
        'at' => (int) ($d->at ?? 0),
        'u' => (int) ($d->u ?? 0),
        'dec' => isset($d->dec) && $d->dec instanceof stdClass ? ['at' => (int) ($d->dec->at ?? 0), 'by' => (string) ($d->dec->by ?? ''), 'why' => (string) ($d->dec->why ?? ''), 'mailed' => !empty($d->dec->mailed)] : null,
        'card' => $card,
    ];
}
function mktNotifyStaff(string $subject, array $paras, string $link): void
{
    $to = array_values(array_filter(array_map('trim', explode(',', (string) (jobSettings()['apply_emails'] ?? ''))), fn($e) => filter_var($e, FILTER_VALIDATE_EMAIL)));
    if (!$to) {
        $to = [(string) cfg('mail_from')];
    }
    foreach (array_slice($to, 0, 5) as $e) {
        try {
            sendMail($e, 'StratEdge', $subject, implode("\n\n", $paras) . "\n\n" . $link, emailHtml($subject, array_map('htmlspecialchars', $paras), ['Open the marketplace', $link]));
        } catch (Throwable $x) {
            /* mail not set up */
        }
    }
}
function mktRoute(string $r, string $method, array $b): never
{
    $S = mktSettings();
    switch ($r) {
        /* ---------- employers ---------- */
        case 'mkt_search':
            $u = mktEmployerUser();
            $q = mb_strtolower(vmsStr($b['q'] ?? '', 200));
            $loc = mb_strtolower(vmsStr($b['loc'] ?? '', 100));
            $auth = mb_strtolower(vmsStr($b['auth'] ?? '', 40));
            $years = (int) ($b['years'] ?? 0);
            $toks = array_values(array_filter(preg_split('/[\s,;]+/', $q) ?: [], fn($t) => mb_strlen($t) >= 2));
            $want = $q !== '' ? skillsCanon(vmsSplitSkills(str_replace(' ', ',', $q))) : [];
            $rows = [];
            foreach (mktPool(true) as $row) {
                $card = mktCard($row, $S);
                $hay = mb_strtolower(implode(' ', array_merge([$card['ti'], $card['loc'], $card['auth'], $card['summary']], $card['titles'], $card['skills'])));
                $score = 0;
                if ($toks) {
                    $hit = 0;
                    foreach ($toks as $t) {
                        if (str_contains($hay, $t)) {
                            $hit++;
                        }
                    }
                    if ($hit === 0) {
                        continue;
                    }
                    $score += $hit * 10;
                    $skillHits = count(array_intersect(array_map('mb_strtolower', $card['skills']), array_map('mb_strtolower', $want)));
                    $score += $skillHits * 15;
                    if (str_contains(mb_strtolower($card['ti']), $q)) {
                        $score += 40;
                    }
                }
                if ($loc !== '' && !str_contains(mb_strtolower($card['loc'] . ' ' . $card['reloc']), $loc) && !preg_match('/remote|anywhere/', mb_strtolower($card['loc']))) {
                    continue;
                }
                if ($auth !== '' && !str_contains(mb_strtolower($card['auth']), $auth)) {
                    continue;
                }
                if ($years > 0 && ($card['years'] === null || (int) $card['years'] < $years)) {
                    continue;
                }
                $card['score'] = $score;
                $rows[] = $card;
            }
            usort($rows, fn($x, $y) => [$y['score'], $y['u']] <=> [$x['score'], $x['u']]);
            ok(['rows' => array_slice($rows, 0, 120), 'total' => count($rows), 'intro' => $S['intro']]);
        case 'mkt_profile':
            $u = mktEmployerUser();
            $pid = vmsStr($b['pid'] ?? '', 80);
            $sp = mktSplitKey($pid);
            $it = $sp ? docGet(MKT_ITEMS . '/' . $pid) : null;
            if (!$sp || !$it || empty($it->on)) {
                fail(404, 'not_found', 'That profile is not available any more.');
            }
            $c = mktCandidate($sp[0], $sp[1], true);
            if (!$c) {
                fail(404, 'not_found', 'That profile is not available any more.');
            }
            // approved for this person (or staff): the full profile
            $full = userLevel($u) >= 2 || isRecruiter($u['id']) || isBench($u['id']);
            $myReq = null;
            foreach (colAll(MKT_REQ, 'at', 'desc') as [$rid, $d]) {
                if ((string) ($d->pid ?? '') === $pid && (string) ($d->by ?? '') === $u['id']) {
                    $myReq = mktReqOut((string) $rid, $d);
                    if (in_array($myReq['st'], ['approved', 'submitted'], true)) {
                        $full = true;
                    }
                    break;
                }
            }
            $card = mktCard(['key' => $pid, 'item' => $it, 'c' => $c], $S, $full);
            if ($full && $myReq) {
                $card['resumeUrl'] = mktResumeFile($c) ? 'api/index.php?r=mkt_resume&rid=' . $myReq['id'] : '';
            }
            ok(['profile' => $card, 'request' => $myReq]);
        case 'mkt_request':
            $u = mktEmployerUser();
            $emp = mktEmployer($u, vmsStr($b['cid'] ?? '', 40));
            if (!$emp) {
                fail(403, 'forbidden', 'Only client and vendor contacts can request profiles.');
            }
            $pid = vmsStr($b['pid'] ?? '', 80);
            $sp = mktSplitKey($pid);
            $it = $sp ? docGet(MKT_ITEMS . '/' . $pid) : null;
            if (!$sp || !$it || empty($it->on)) {
                fail(404, 'not_found', 'That profile is not available any more.');
            }
            if (throttleHit('mktreq:' . $u['id'], 40, 86400)) {
                fail(429, 'rate_limited', 'That is a lot of requests for one day. Your account manager will be in touch.');
            }
            foreach (colAll(MKT_REQ, null, 'asc') as [$rid, $d]) {
                if ((string) ($d->pid ?? '') === $pid && (string) ($d->by ?? '') === $u['id'] && in_array((string) ($d->st ?? ''), ['new', 'approved', 'submitted'], true)) {
                    ok(['id' => (string) $rid, 'already' => true, 'st' => (string) $d->st]);
                }
            }
            $c = mktCandidate($sp[0], $sp[1], false);
            $rq = vmsStr($b['rq'] ?? '', 40);
            $rqTitle = '';
            if ($rq !== '') {
                $rd = docGet("e/{$u['id']}/req/$rq");
                $rqTitle = (string) ($rd->ti ?? '');
                if ($rqTitle === '') {
                    $rq = '';
                }
            }
            $id = rid(10);
            $now = now();
            $auto = in_array($emp['id'], $S['autoApprove'], true);
            $doc = (object) [
                'pid' => $pid,
                'ti' => $c ? ((string) ($it->hl ?? '') !== '' ? (string) $it->hl : $c['ti']) : '',
                'by' => $u['id'],
                'byn' => (string) $u['name'],
                'bye' => (string) $u['email'],
                'org' => $emp['n'],
                'orgKind' => $emp['kind'],
                'orgId' => $emp['id'],
                'rq' => $rq,
                'rqTitle' => $rqTitle,
                'note' => vmsStr($b['note'] ?? '', 2000),
                'st' => $auto ? 'approved' : 'new',
                'at' => $now,
                'u' => $now,
            ];
            if ($auto) {
                $doc->dec = (object) ['at' => $now, 'by' => 'auto', 'why' => 'Trusted employer: approved automatically.', 'mailed' => false];
            }
            docSet(MKT_REQ . '/' . $id, $doc);
            if (!$auto) {
                mktNotifyStaff(
                    $emp['n'] . ' requested profile ' . mktCode($pid) . ($doc->ti !== '' ? ' (' . $doc->ti . ')' : ''),
                    [$u['name'] . ' at ' . $emp['n'] . ' asked for the full profile of ' . mktCode($pid) . ($doc->ti !== '' ? ', ' . $doc->ti : '') . '.' . ($rqTitle !== '' ? ' For their requirement: ' . $rqTitle . '.' : ''), $doc->note !== '' ? 'Their note: ' . $doc->note : 'Approve or decline it under Talent marketplace › Requests.'],
                    siteUrl() . '#/portal/admin/mkt',
                );
            }
            ok(['id' => $id, 'st' => $doc->st]);
        case 'mkt_my_requests':
            $u = mktEmployerUser();
            $out = [];
            foreach (colAll(MKT_REQ, 'at', 'desc') as [$rid, $d]) {
                if ((string) ($d->by ?? '') !== $u['id']) {
                    continue;
                }
                $sp = mktSplitKey((string) ($d->pid ?? ''));
                $card = null;
                if ($sp) {
                    $it = docGet(MKT_ITEMS . '/' . $d->pid);
                    $c = $it ? mktCandidate($sp[0], $sp[1], false) : null;
                    if ($c) {
                        $full = in_array((string) ($d->st ?? ''), ['approved', 'submitted'], true);
                        $card = mktCard(['key' => (string) $d->pid, 'item' => $it, 'c' => $c], $S, $full);
                        if ($full) {
                            $card['resumeUrl'] = mktResumeFile($c) ? 'api/index.php?r=mkt_resume&rid=' . $rid : '';
                        }
                    }
                }
                $out[] = mktReqOut((string) $rid, $d, $card);
            }
            ok(['rows' => $out]);
        case 'mkt_resume':
            $u = requireUser();
            $rid = vmsStr($_GET['rid'] ?? '', 40);
            $d = docGet(MKT_REQ . '/' . $rid);
            $staff = userLevel($u) >= 2 || isRecruiter($u['id']) || isBench($u['id']);
            if (!$d || (!$staff && ((string) ($d->by ?? '') !== $u['id'] || !in_array((string) ($d->st ?? ''), ['approved', 'submitted'], true)))) {
                fail(404, 'not_found', 'No resume to show for this request.');
            }
            $sp = mktSplitKey((string) ($d->pid ?? ''));
            $c = $sp ? mktCandidate($sp[0], $sp[1], false) : null;
            $f = $c ? mktResumeFile($c) : null;
            if (!$f) {
                fail(404, 'not_found', 'This profile has no resume file.');
            }
            header('Content-Type: ' . $f[1]);
            header('Content-Length: ' . (string) filesize($f[2]));
            header('Content-Disposition: attachment; filename="' . str_replace('"', '', $f[0]) . '"');
            header('X-Robots-Tag: noindex');
            readfile($f[2]);
            exit();
        case 'mkt_match':
            // the marketable people ranked against one of the employer's own requirements
            $u = mktEmployerUser();
            $rq = vmsStr($b['rq'] ?? '', 40);
            $req = vmsReqGet('e:' . $u['id'] . ':' . $rq);
            if (!$req) {
                fail(404, 'not_found', 'That requirement was not found.');
            }
            $prof = vmsReqProfile($req);
            $rows = [];
            foreach (mktPool(true) as $row) {
                [$score, $why] = vmsScore($prof, $row['c']);
                if ((int) $score < 20) {
                    continue;
                }
                $card = mktCard($row, $S);
                $card['score'] = (int) $score;
                $card['why'] = array_values((array) $why);
                $rows[] = $card;
            }
            usort($rows, fn($x, $y) => $y['score'] <=> $x['score']);
            ok(['rows' => array_slice($rows, 0, 60), 'req' => ['id' => $rq, 'ti' => $req['ti'], 'loc' => $req['loc'], 'sk' => $req['sk']]]);

        /* ---------- staff ---------- */
        case 'mkt_pool':
            // everyone who could be listed, with their marketplace state, for the Profiles tab
            mktStaff();
            $q = mb_strtolower(vmsStr($b['q'] ?? '', 120));
            $only = vmsStr($b['only'] ?? '', 10); // on | off | ''
            $items = [];
            foreach (colAll(MKT_ITEMS, null, 'asc') as [$key, $it]) {
                $items[(string) $key] = $it;
            }
            $rows = [];
            foreach (vmsCandidates(false) as $c) {
                $key = mktKey($c['src'], $c['id']);
                $it = $items[$key] ?? null;
                $on = $it && !empty($it->on);
                if (($only === 'on' && !$on) || ($only === 'off' && $on)) {
                    continue;
                }
                if ($q !== '' && !str_contains(mb_strtolower(implode(' ', array_merge([$c['n'], $c['ti'], $c['loc'], $c['auth']], $c['skills']))), $q)) {
                    continue;
                }
                $rows[] = ['key' => $key, 'code' => mktCode($key), 'src' => $c['src'], 'id' => $c['id'], 'n' => $c['n'], 'ti' => $c['ti'], 'loc' => $c['loc'], 'auth' => $c['auth'], 'rate' => $c['rate'], 'skills' => array_slice($c['skills'], 0, 8), 'resume' => $c['resume'], 'on' => $on, 'band' => $it ? (string) ($it->band ?? '') : '', 'avail' => $it ? (string) ($it->avail ?? '') : '', 'hl' => $it ? (string) ($it->hl ?? '') : '', 'since' => $it ? (int) ($it->at ?? 0) : 0];
            }
            usort($rows, fn($x, $y) => [$y['on'], $x['n']] <=> [$x['on'], $y['n']]);
            $reqs = 0;
            foreach (colAll(MKT_REQ, null, 'asc') as [, $d]) {
                if ((string) ($d->st ?? '') === 'new') {
                    $reqs++;
                }
            }
            ok(['rows' => array_slice($rows, 0, 500), 'total' => count($rows), 'on' => count(array_filter($rows, fn($x) => $x['on'])), 'newRequests' => $reqs, 'settings' => $S]);
        case 'mkt_set':
            $u = mktStaff();
            $keys = array_values(array_filter((array) ($b['keys'] ?? []), fn($k) => is_string($k) && mktSplitKey($k)));
            if (!$keys || count($keys) > 500) {
                fail(400, 'invalid_argument', 'Pick between 1 and 500 people.');
            }
            $on = !empty($b['on']);
            $n = 0;
            foreach ($keys as $key) {
                $it = docGet(MKT_ITEMS . '/' . $key) ?? (object) ['at' => now(), 'by' => $u['id'], 'byn' => (string) $u['name']];
                $it->on = $on;
                if (array_key_exists('band', $b)) {
                    $it->band = vmsStr($b['band'] ?? '', 40);
                }
                if (array_key_exists('avail', $b)) {
                    $it->avail = vmsStr($b['avail'] ?? '', 80);
                }
                if (array_key_exists('hl', $b)) {
                    $it->hl = vmsStr($b['hl'] ?? '', 120);
                }
                $it->u = now();
                $it->ub = $u['id'];
                docSet(MKT_ITEMS . '/' . $key, $it);
                $n++;
            }
            ok(['n' => $n]);
        case 'mkt_requests':
            mktStaff();
            $st = vmsStr($b['st'] ?? '', 12);
            $out = [];
            foreach (colAll(MKT_REQ, 'at', 'desc') as [$rid, $d]) {
                if ($st !== '' && $st !== 'all' && (string) ($d->st ?? 'new') !== $st) {
                    continue;
                }
                $sp = mktSplitKey((string) ($d->pid ?? ''));
                $card = null;
                if ($sp) {
                    $it = docGet(MKT_ITEMS . '/' . $d->pid) ?? new stdClass();
                    $c = mktCandidate($sp[0], $sp[1], false);
                    if ($c) {
                        $card = mktCard(['key' => (string) $d->pid, 'item' => $it, 'c' => $c], $S, true);
                        $card['resumeUrl'] = mktResumeFile($c) ? 'api/index.php?r=mkt_resume&rid=' . $rid : '';
                    }
                }
                $out[] = mktReqOut((string) $rid, $d, $card);
            }
            ok(['rows' => $out]);
        case 'mkt_decide':
            $me = mktStaff();
            $rid = vmsStr($b['id'] ?? '', 40);
            $d = docGet(MKT_REQ . '/' . $rid);
            if (!$d) {
                fail(404, 'not_found', 'No such request.');
            }
            $st = vmsStr($b['st'] ?? '', 12);
            if (!in_array($st, ['approved', 'declined', 'new'], true)) {
                fail(400, 'invalid_argument', 'Approve or decline.');
            }
            $why = vmsStr($b['why'] ?? '', 1000);
            $sp = mktSplitKey((string) ($d->pid ?? ''));
            $c = $sp ? mktCandidate($sp[0], $sp[1], false) : null;
            $mailed = false;
            if (!empty($b['email']) && filter_var((string) ($d->bye ?? ''), FILTER_VALIDATE_EMAIL) && $st !== 'new') {
                $code = mktCode((string) $d->pid);
                $first = trim(explode(' ', (string) ($d->byn ?? ''))[0] ?? '') ?: 'there';
                if ($st === 'approved' && $c) {
                    $atts = [];
                    $f = mktResumeFile($c);
                    if ($f) {
                        $atts[] = ['name' => $f[0], 'type' => $f[1], 'data' => (string) file_get_contents($f[2])];
                    }
                    $subject = 'Profile ' . $code . ' approved: ' . $c['n'] . ($c['ti'] !== '' ? ', ' . $c['ti'] : '');
                    $lines = ["Hi $first,", 'Your request for profile ' . $code . ' is approved. Here are the details' . ($atts ? ' and the resume' : '') . ':', implode("\n", array_filter([$c['n'], $c['ti'], $c['loc'] !== '' ? 'Location: ' . $c['loc'] : '', $c['auth'] !== '' ? 'Work authorization: ' . $c['auth'] : '', $c['e'] !== '' ? 'Email: ' . $c['e'] : '', $c['ph'] !== '' ? 'Phone: ' . $c['ph'] : ''])), $why !== '' ? $why : '', 'You can also open it under Profile requests in your portal. Please route interviews and offers through StratEdge.', "Regards,\n" . $me['name'] . "\nStratEdge IT Consulting"];
                } else {
                    $atts = [];
                    $subject = 'Profile ' . $code . ': ' . ($st === 'declined' ? 'not available' : 'update');
                    $lines = ["Hi $first,", 'We could not release profile ' . $code . ' this time.' . ($why !== '' ? ' ' . $why : ''), 'Tell us what you are looking for under Requirements in your portal and we will send matching people.', "Regards,\n" . $me['name'] . "\nStratEdge IT Consulting"];
                }
                try {
                    $mailed = sendMail((string) $d->bye, (string) ($d->byn ?? ''), $subject, implode("\n\n", array_filter($lines)), emailHtml($subject, array_map('nl2br', array_map('htmlspecialchars', array_filter($lines))), ['Open your portal', siteUrl() . '#/login?as=client']), $atts, (string) $me['email']);
                } catch (Throwable $e) {
                    $mailed = false;
                }
            }
            $d->st = $st;
            $d->u = now();
            $d->dec = $st === 'new' ? null : (object) ['at' => now(), 'by' => (string) $me['name'], 'why' => $why, 'mailed' => $mailed];
            docSet(MKT_REQ . '/' . $rid, $d);
            // an approval for a requirement is a submission too, so it shows under RTRs & submissions
            if ($st === 'approved' && $c && (string) ($d->rq ?? '') !== '' && empty($d->sub)) {
                $sid = rid(10);
                docSet('rec/sub/items/' . $sid, (object) ['d' => date('Y-m-d'), 'cn' => $c['n'], 'ce' => $c['e'], 'cid' => $c['id'], 'csrc' => $c['src'], 'req' => (string) ($d->rqTitle ?? ''), 'ti' => (string) ($d->rqTitle ?? ''), 'cl' => (string) ($d->org ?? ''), 'vn' => (string) ($d->org ?? ''), 'st' => 'submitted', 'stAt' => now(), 'src' => 'marketplace', 'vreq' => 'e:' . $d->by . ':' . $d->rq, 'by' => $me['id'], 'byn' => (string) $me['name'], 'at' => now(), 'u' => now(), 'un' => (string) $me['name'], 'note' => 'Released through the talent marketplace (request ' . $rid . ').']);
                $d->sub = $sid;
                docSet(MKT_REQ . '/' . $rid, $d);
            }
            ok(['ok' => true, 'mailed' => $mailed]);
        case 'mkt_employers':
            mktStaff();
            $rows = [];
            $counts = [];
            foreach (colAll(MKT_REQ, null, 'asc') as [, $d]) {
                $k = (string) ($d->by ?? '');
                $counts[$k] = ($counts[$k] ?? 0) + 1;
            }
            foreach (db()->query("SELECT id, email, name, status, access FROM users WHERE status = 'active'")->fetchAll() as $usr) {
                $rr = myR($usr['id']);
                if ((string) ($rr->role ?? '') !== 'employer' && !myCids($usr['id'])) {
                    continue;
                }
                $emp = mktEmployer($usr);
                $seen = docGet('log/' . $usr['id']);
                $rows[] = ['uid' => $usr['id'], 'n' => $usr['name'], 'e' => $usr['email'], 'org' => $emp['n'] ?? (string) ($rr->cl ?? ''), 'orgId' => $emp['id'] ?? '', 'kind' => $emp['kind'] ?? 'client', 'seen' => (int) ($seen->seen ?? 0), 'requests' => $counts[$usr['id']] ?? 0];
            }
            usort($rows, fn($x, $y) => [$x['org'], $x['n']] <=> [$y['org'], $y['n']]);
            $vendors = [];
            foreach (vmsVendorsRaw() as [$vid, $v]) {
                $vendors[] = ['id' => (string) $vid, 'n' => (string) ($v->n ?? ''), 'contacts' => array_values(array_map(fn($c) => ['n' => (string) ($c->n ?? ''), 'e' => (string) ($c->e ?? '')], array_filter((array) ($v->contacts ?? []), fn($c) => $c instanceof stdClass)))];
            }
            ok(['rows' => $rows, 'vendors' => $vendors, 'autoApprove' => $S['autoApprove']]);
        case 'mkt_settings_save':
            $me = mktStaff();
            if (userLevel($me) < 2) {
                fail(403, 'forbidden', 'Administrators and HR change the marketplace settings.');
            }
            $d = docGet('org/mkt/x/settings') ?? new stdClass();
            $d->band = max(5, min(50, (int) ($b['band'] ?? 10)));
            $d->summary = max(200, min(2000, (int) ($b['summary'] ?? 700)));
            $d->intro = vmsStr($b['intro'] ?? '', 600);
            $d->autoApprove = array_values(array_filter((array) ($b['autoApprove'] ?? []), fn($x) => is_string($x) && preg_match('/^[A-Za-z0-9_\-]{1,40}$/', $x)));
            $d->u = now();
            docSet('org/mkt/x/settings', $d);
            ok(['settings' => mktSettings()]);
        default:
            fail(404, 'not_found', 'Unknown action.');
    }
}
