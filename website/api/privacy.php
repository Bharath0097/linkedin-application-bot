<?php
declare(strict_types=1);
/*
 * v34 privacy (Admin / HR > Privacy & retention):
 *   - Consent: every application records when it agreed to which version of the privacy notice, from where.
 *   - Privacy requests: anyone can ask for a copy of their data, a correction or deletion at #/privacy; the email is
 *     confirmed by a link first, then the request is logged with its legal deadline (45 days for US/California, one
 *     month for the EU/UK). Staff find everything held for that email, export it, and delete or keep it with a reason.
 *   - Retention: candidates who were never hired and have had no activity for the set number of months are listed,
 *     recruiters are told a set number of days ahead (they can keep someone), then the records are deleted. Off until
 *     an administrator switches it on.
 */

const PRIV_NOTICE_VER = '2026-10';

function privCfg(): array
{
    $d = docGet('sec/priv/cfg');
    $a = $d ? (json_decode(json_encode($d), true) ?: []) : [];
    return array_merge(['on' => false, 'months' => 24, 'notice' => 30, 'consent' => true, 'ver' => PRIV_NOTICE_VER, 'lastRun' => 0], $a);
}
/** What is stored with an application about its consent. */
function privConsent(string $where, array $src = []): ?stdClass
{
    if (empty($src['consent']) || in_array((string) $src['consent'], ['0', 'false', ''], true)) {
        return null;
    }
    return (object) ['at' => now(), 'ver' => privCfg()['ver'], 'ip' => clientIp(), 'where' => mb_substr($where, 0, 60)];
}
/** Staff who may handle privacy: administrators and HR. */
function privStaff(): array
{
    $u = requireAdmin();
    if (!hasRole($u, 'admin') && !hasRole($u, 'hr')) {
        fail(403, 'forbidden', 'Privacy requests are handled by HR and administrators.');
    }
    return $u;
}
/** Everything the portal holds for one email address. */
function privFind(string $email): array
{
    $email = strtolower(trim($email));
    $out = ['user' => null, 'ats' => [], 'cand' => [], 'web' => [], 'wsj' => [], 'lists' => [], 'contacts' => 0, 'suppressed' => false, 'legal' => []];
    if ($email === '') {
        return $out;
    }
    $s = db()->prepare('SELECT id, name, role, status, created FROM users WHERE email = ?');
    $s->execute([$email]);
    if ($u = $s->fetch()) {
        $out['user'] = $u;
        // people on payroll or with signed documents have records the law makes us keep
        if (docGet('pays/' . $u['id']) || colAll('pays/' . $u['id'] . '/items')) {
            $out['legal'][] = 'payroll records (keep at least 4 years)';
        }
        if (docGet('comp/' . $u['id'] . '/profile')) {
            $out['legal'][] = 'immigration and I-9 compliance records';
        }
    }
    foreach (colAll('ats') as [$id, $c]) {
        if ((string) $id !== 'x' && strtolower((string) ($c->e ?? '')) === $email) {
            $out['ats'][] = ['id' => (string) $id, 'n' => (string) ($c->n ?? ''), 'jt' => (string) ($c->jt ?? ''), 'st' => (string) ($c->st ?? ''), 'at' => (int) ($c->at ?? 0)];
        }
    }
    foreach (colAll('rec/cand/items') as [$id, $c]) {
        if (strtolower((string) ($c->e ?? $c->email ?? '')) === $email) {
            $out['cand'][] = ['id' => (string) $id, 'n' => (string) ($c->n ?? $c->name ?? '')];
        }
    }
    $pub = docGet('inbox/public');
    foreach ((array) ($pub->m ?? []) as $id => $m) {
        if (strtolower((string) ($m->e ?? '')) === $email) {
            $out['web'][] = ['id' => (string) $id, 'k' => (string) ($m->k ?? ''), 'at' => (int) ($m->at ?? 0)];
        }
    }
    // v37.4: requests for a company portal (StratEdge's own site)
    foreach (colAll('ws/signup') as [$id, $s]) {
        if (strtolower((string) ($s->e ?? '')) === $email) {
            $out['wsj'][] = ['id' => (string) $id, 'co' => (string) ($s->co ?? ''), 'st' => (string) ($s->st ?? ''), 'at' => (int) ($s->at ?? 0)];
        }
    }
    try {
        require_once __DIR__ . '/mail.php';
        $q = mdb()->prepare('SELECT COUNT(*) FROM mail_contacts WHERE email = ?');
        $q->execute([$email]);
        $out['contacts'] = (int) $q->fetchColumn();
        $q = mdb()->prepare('SELECT COUNT(*) FROM mail_suppress WHERE email = ?');
        $q->execute([$email]);
        $out['suppressed'] = (int) $q->fetchColumn() > 0;
        // v37.5: distribution lists they were added to by hand
        require_once __DIR__ . '/maillists.php';
        $q = dlDb()->prepare('SELECT l.id, l.name, m.st FROM mail_list_members m JOIN mail_lists l ON l.id = m.list WHERE m.email = ?');
        $q->execute([$email]);
        foreach ($q->fetchAll() as $row) {
            $out['lists'][] = ['id' => (string) $row['id'], 'name' => (string) $row['name'], 'st' => (string) $row['st']];
        }
    } catch (Throwable $e) {
        // mail tables not set up yet
    }
    return $out;
}
/** A copy of the data (JSON) for an access request. */
function privExport(string $email): array
{
    $f = privFind($email);
    $data = ['email' => $email, 'exported' => gmdate('c'), 'by' => 'StratEdge IT Consulting Inc.', 'records' => []];
    if ($f['user']) {
        $uid = (string) $f['user']['id'];
        $data['records']['account'] = ['name' => $f['user']['name'], 'created' => gmdate('c', (int) ($f['user']['created'] / 1000))];
        foreach (["u/$uid", "r/$uid", "comp/$uid/profile", "hrms/self/$uid", "hrms/emp/$uid/rec"] as $p) {
            $d = docGet($p);
            if ($d) {
                $data['records'][$p] = $d;
            }
        }
        // v37.3: their profile update requests (what they sent and what HR decided)
        foreach (colAll('hrms/main/hrq') as [$qid, $q]) {
            if ((string) ($q->uid ?? '') === $uid) {
                $data['records']['profile update request ' . $qid] = $q;
            }
        }
        $data['records']['signins'] = array_map(fn($x) => $x[1], array_slice(colAll("log/$uid/items", 't', 'desc'), 0, 50));
    }
    foreach ($f['ats'] as $a) {
        $d = docGet('ats/' . $a['id']);
        unset($d->ag);
        $data['records']['application ' . $a['id']] = $d;
    }
    foreach ($f['cand'] as $a) {
        $data['records']['profile ' . $a['id']] = docGet('rec/cand/items/' . $a['id']);
    }
    $pub = docGet('inbox/public');
    foreach ($f['web'] as $w) {
        $data['records']['website message ' . $w['id']] = $pub->m->{$w['id']} ?? null;
    }
    foreach ($f['wsj'] as $w) {
        $data['records']['portal request ' . $w['id']] = docGet('ws/signup/' . $w['id']);
    }
    if ($f['lists']) {
        $data['records']['distribution lists'] = array_map(fn($l) => $l['name'] . ($l['st'] === 'left' ? ' (left)' : ''), $f['lists']);
    }
    return $data;
}
/** Deletes what may be deleted for an email (applications, database profiles, website messages, contacts); the email
 *  stays on the do-not-contact list. Accounts with records the law keeps are left for HR to decide. */
function privErase(string $email, array $me): array
{
    $f = privFind($email);
    $n = ['ats' => 0, 'cand' => 0, 'web' => 0, 'wsj' => 0, 'lists' => 0, 'files' => 0, 'contacts' => 0, 'tax' => 0];
    $delFiles = function (string $base) use (&$n) {
        foreach (colAll($base . '/f') as [$fid]) {
            docDelete($base . '/f/' . $fid);
            @unlink(filePathOf((string) $fid));
            $n['files']++;
        }
    };
    foreach ($f['ats'] as $a) {
        $delFiles('ats/' . $a['id']);
        docDelete('ats/' . $a['id']);
        $n['ats']++;
    }
    foreach ($f['cand'] as $a) {
        $delFiles('rec/cand/items/' . $a['id']);
        docDelete('rec/cand/items/' . $a['id']);
        $n['cand']++;
    }
    if ($f['web']) {
        $pub = docGet('inbox/public');
        foreach ($f['web'] as $w) {
            if (isset($pub->m->{$w['id']})) {
                $fid = (string) ($pub->m->{$w['id']}->fid ?? '');
                if ($fid !== '') {
                    docDelete('inbox/public/f/' . $fid);
                    @unlink(filePathOf($fid));
                }
                unset($pub->m->{$w['id']});
                $n['web']++;
            }
        }
        docSet('inbox/public', $pub);
    }
    foreach ($f['wsj'] as $w) {
        docDelete('ws/signup/' . $w['id']);
        try {
            secdb()->prepare("DELETE FROM auth_tokens WHERE uid = ? AND kind = 'wsjoin'")->execute([$w['id']]);
        } catch (Throwable $e) {
            // no links left
        }
        $n['wsj']++;
    }
    try {
        require_once __DIR__ . '/mail.php';
        $q = mdb()->prepare('DELETE FROM mail_contacts WHERE email = ?');
        $q->execute([strtolower($email)]);
        $n['contacts'] = $q->rowCount();
        mdb()->prepare('REPLACE INTO mail_suppress (email, at, why) VALUES (?, ?, ?)')->execute([strtolower($email), now(), 'erased']);
        // v37.5: off every distribution list (the do-not-contact entry keeps them off the self-updating ones)
        require_once __DIR__ . '/maillists.php';
        $d = dlDb()->prepare('DELETE FROM mail_list_members WHERE email = ?');
        $d->execute([strtolower($email)]);
        $n['lists'] = $d->rowCount();
    } catch (Throwable $e) {
        // nothing in the mail tables
    }
    // v40: their own answers in My taxes (sealed for them alone; never part of an export)
    if ($f['user']) {
        try {
            require_once __DIR__ . '/tax.php';
            $q = taxDb()->prepare('DELETE FROM tax_prof WHERE uid = ?');
            $q->execute([(string) $f['user']['id']]);
            $n['tax'] = $q->rowCount();
        } catch (Throwable $e) {
            // no tax answers
        }
    }
    // the talent search index forgets them on its next pass (their records are gone)
    audit('data', 'Personal data deleted on request', $email, $n, $me);
    return $n;
}

/* ---------- retention ---------- */
function privLastActivity(stdClass $c): int
{
    $t = max((int) ($c->u ?? 0), (int) ($c->at ?? 0), (int) ($c->stAt ?? 0), (int) ($c->keptAt ?? 0));
    foreach ((array) ($c->log ?? []) as $l) {
        $t = max($t, (int) ($l->t ?? 0));
    }
    return $t;
}
/** Candidates whose records are past the retention period: [kind, id, name, email, last, due]. */
function privDue(): array
{
    $c = privCfg();
    $cut = now() - max(6, (int) $c['months']) * 30 * 86400000;
    $hiredKeys = ['hired', 'offer'];
    try {
        require_once __DIR__ . '/ats.php';
        foreach ((array) (atsSettings()['pipelines'] ?? []) as $pl) {
            foreach ((array) ($pl['stages'] ?? []) as $sg) {
                if (in_array($sg['kind'] ?? '', ['hired', 'offer'], true)) {
                    $hiredKeys[] = (string) $sg['k'];
                }
            }
        }
    } catch (Throwable $e) {
        // default stage names
    }
    $out = [];
    foreach (colAll('ats') as [$id, $x]) {
        if ((string) $id === 'x' || !empty($x->hold) || !empty($x->uid) || in_array((string) ($x->st ?? ''), $hiredKeys, true)) {
            continue;
        }
        $last = privLastActivity($x);
        if ($last > 0 && $last < $cut) {
            $out[] = ['kind' => 'ats', 'id' => (string) $id, 'n' => (string) ($x->n ?? ''), 'e' => (string) ($x->e ?? ''), 'last' => $last, 'due' => (int) ($x->retDue ?? 0)];
        }
    }
    foreach (colAll('rec/cand/items') as [$id, $x]) {
        if (!empty($x->hold) || !empty($x->uid) || in_array((string) ($x->st ?? ''), ['placed', 'active', 'bench'], true)) {
            continue;
        }
        $last = privLastActivity($x);
        if ($last > 0 && $last < $cut) {
            $out[] = ['kind' => 'cand', 'id' => (string) $id, 'n' => (string) ($x->n ?? $x->name ?? ''), 'e' => (string) ($x->e ?? ''), 'last' => $last, 'due' => (int) ($x->retDue ?? 0)];
        }
    }
    usort($out, fn($a, $b) => $a['last'] <=> $b['last']);
    return $out;
}
/** The daily retention pass (only when switched on): announce, then delete what passed its notice period. */
function privRetentionRun(bool $force = false): array
{
    $c = privCfg();
    if (empty($c['on'])) {
        return ['on' => false];
    }
    if (!$force && (int) $c['lastRun'] > now() - 20 * 3600000) {
        return ['on' => true, 'ran' => false];
    }
    $c['lastRun'] = now();
    docSet('sec/priv/cfg', json_decode(json_encode($c)));
    $announced = 0;
    $deleted = 0;
    $list = [];
    foreach (privDue() as $x) {
        $path = ($x['kind'] === 'ats' ? 'ats/' : 'rec/cand/items/') . $x['id'];
        $d = docGet($path);
        if (!$d) {
            continue;
        }
        if ((int) ($d->retDue ?? 0) === 0) {
            $d->retDue = now() + max(1, (int) $c['notice']) * 86400000;
            docSet($path, $d);
            $announced++;
            $list[] = $x['n'] . ($x['e'] !== '' ? ' <' . $x['e'] . '>' : '');
        } elseif ((int) $d->retDue < now()) {
            foreach (colAll($path . '/f') as [$fid]) {
                docDelete($path . '/f/' . $fid);
                @unlink(filePathOf((string) $fid));
            }
            docDelete($path);
            $deleted++;
        }
    }
    if ($deleted) {
        audit('data', 'Old candidate records deleted (retention)', 'retention', ['n' => $deleted, 'months' => (int) $c['months']]);
    }
    if ($announced) {
        require_once __DIR__ . '/auth.php';
        secAlertAdmins('ret:' . gmdate('Ymd'), $announced . ' old candidate records will be deleted in ' . (int) $c['notice'] . ' days', 'Under the retention rule (' . (int) $c['months'] . " months without activity), these records will be deleted unless someone keeps them (Privacy & retention > Retention):\n\n" . implode("\n", array_slice($list, 0, 60)) . (count($list) > 60 ? "\n... and " . (count($list) - 60) . ' more' : ''));
    }
    return ['on' => true, 'ran' => true, 'announced' => $announced, 'deleted' => $deleted];
}

/* ---------- routes ---------- */
function privRoute(string $r, array $b): never
{
    // public: ask for a copy, a correction or deletion (confirmed by email first)
    if ($r === 'priv_request') {
        if (throttleHit('privreq:' . clientIp(), 6, 3600)) {
            fail(429, 'rate_limited', 'Too many requests from this network. Email us instead.');
        }
        $email = strtolower(str($b, 'email', 190));
        $kind = in_array($b['kind'] ?? '', ['access', 'delete', 'correct', 'optout'], true) ? (string) $b['kind'] : 'access';
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            fail(400, 'invalid_argument', 'Enter the email address your information is under.');
        }
        if (fwScreen(['email' => $email, 'website' => $b['website'] ?? '', 't0' => $b['t0'] ?? 0, 'msg' => str($b, 'msg', 2000)], 'privacy request') !== '') {
            fail(400, 'spam', 'This request could not be sent. Email us directly.');
        }
        $region = in_array($b['region'] ?? '', ['us', 'ca', 'eu', 'uk', 'other'], true) ? (string) $b['region'] : 'us';
        $id = gmdate('ymd') . '-' . rid(3);
        $tok = rid(24);
        docSet('sec/priv/req/' . $id, json_decode(json_encode(['kind' => $kind, 'e' => $email, 'n' => str($b, 'name', 120), 'msg' => str($b, 'msg', 2000), 'region' => $region, 'src' => 'form', 'at' => now(), 'st' => 'verifying', 'tok' => hash('sha256', $tok), 'log' => [['at' => now(), 'by' => 'Website', 'note' => 'Request received; waiting for the email confirmation']]])));
        require_once __DIR__ . '/auth.php';
        authMail(['email' => $email, 'name' => str($b, 'name', 120) ?: $email], 'Confirm your privacy request to StratEdge', ['Hello,', 'We received a request to ' . ['access' => 'send you a copy of', 'delete' => 'delete', 'correct' => 'correct', 'optout' => 'stop using'][$kind] . ' the information StratEdge holds about ' . $email . '.', 'To protect your information, please confirm the request with the button below. If you did not ask for this, ignore this email.'], ['Confirm my request', siteUrl() . '#/privacy?confirm=' . $id . '.' . $tok]);
        ok(['ok' => true]);
    }
    if ($r === 'priv_confirm') {
        $t = str($b, 't', 80);
        [$id, $tok] = array_pad(explode('.', $t, 2), 2, '');
        $q = preg_match('/^[0-9]{6}-[a-f0-9]{6}$/', $id) ? docGet('sec/priv/req/' . $id) : null;
        if (!$q || ($q->st ?? '') !== 'verifying' || !hash_equals((string) $q->tok, hash('sha256', $tok))) {
            fail(400, 'bad_token', 'This confirmation link is not valid or was already used.');
        }
        $days = in_array($q->region ?? 'us', ['eu', 'uk'], true) ? 30 : 45;
        $q->st = 'open';
        $q->verified = now();
        $q->due = now() + $days * 86400000;
        $q->tok = '';
        $q->log = array_merge((array) $q->log, [(object) ['at' => now(), 'by' => 'Requester', 'note' => 'Email confirmed; answer due in ' . $days . ' days']]);
        docSet('sec/priv/req/' . $id, $q);
        audit('data', 'Privacy request confirmed', $id, ['kind' => (string) $q->kind]);
        require_once __DIR__ . '/auth.php';
        secAlertAdmins('priv:' . $id, 'New privacy request (' . $q->kind . ')', 'A ' . $q->kind . ' request from ' . $q->e . ' was confirmed. Answer by ' . gmdate('j M Y', (int) ($q->due / 1000)) . ' under Privacy & retention.');
        ok(['ok' => true, 'due' => (int) $q->due, 'kind' => (string) $q->kind]);
    }
    $me = privStaff();
    switch ($r) {
        case 'priv_overview':
            $reqs = [];
            foreach (colAll('sec/priv/req') as [$id, $q]) {
                $a = json_decode(json_encode($q), true);
                unset($a['tok']);
                $a['id'] = (string) $id;
                $reqs[] = $a;
            }
            usort($reqs, fn($a, $b) => [in_array($a['st'], ['done', 'denied'], true), -(int) $a['at']] <=> [in_array($b['st'], ['done', 'denied'], true), -(int) $b['at']]);
            $due = privDue();
            ok(['cfg' => privCfg(), 'requests' => $reqs, 'due' => array_slice($due, 0, 300), 'dueCount' => count($due), 'canSettings' => hasRole($me, 'admin')]);
        case 'priv_cfg_save':
            if (!hasRole($me, 'admin')) {
                fail(403, 'forbidden', 'Only an administrator can change the retention rule.');
            }
            $c = privCfg();
            $in = (array) ($b['cfg'] ?? []);
            $c['on'] = !empty($in['on']);
            $c['months'] = max(6, min(120, (int) ($in['months'] ?? $c['months'])));
            $c['notice'] = max(7, min(90, (int) ($in['notice'] ?? $c['notice'])));
            $c['consent'] = !array_key_exists('consent', $in) || !empty($in['consent']);
            docSet('sec/priv/cfg', json_decode(json_encode($c)));
            audit('settings', 'Retention rule changed', 'privacy', ['on' => $c['on'], 'months' => $c['months'], 'notice' => $c['notice']], $me);
            ok(['cfg' => $c]);
        case 'priv_find':
            $email = strtolower(str($b, 'email', 190));
            ok(privFind($email));
        case 'priv_export':
            $email = strtolower(str($b, 'email', 190));
            audit('data', 'Personal data exported (privacy request)', $email, [], $me);
            ok(['json' => json_encode(privExport($email), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)]);
        case 'priv_send_copy':
            $id = str($b, 'id', 20);
            $q = docGet('sec/priv/req/' . $id);
            if (!$q || ($q->st ?? '') !== 'open') {
                fail(400, 'invalid_argument', 'Only an open, confirmed request can be answered.');
            }
            $json = json_encode(privExport((string) $q->e), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            $ok = sendMail((string) $q->e, (string) ($q->n ?? ''), 'Your data held by StratEdge', "Hello,\n\nAs you asked, attached is a copy of the information StratEdge holds about you (a JSON file that any text editor opens).\n\nStratEdge IT Consulting", emailHtml('Your data held by StratEdge', ['Hello,', 'As you asked, attached is a copy of the information StratEdge holds about you (a JSON file that any text editor opens).']), [['name' => 'stratedge-data-' . gmdate('Ymd') . '.json', 'type' => 'application/json', 'data' => (string) $json]]);
            $q->log = array_merge((array) $q->log, [(object) ['at' => now(), 'by' => $me['name'], 'note' => $ok ? 'Copy of the data emailed' : 'Emailing the copy failed']]);
            docSet('sec/priv/req/' . $id, $q);
            audit('data', 'Personal data copy sent (privacy request)', (string) $q->e, ['ok' => $ok], $me);
            ok(['ok' => $ok]);
        case 'priv_erase':
            $id = str($b, 'id', 20);
            $q = $id !== '' ? docGet('sec/priv/req/' . $id) : null;
            $email = strtolower($q ? (string) $q->e : str($b, 'email', 190));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                fail(400, 'invalid_argument', 'No email to delete.');
            }
            $n = privErase($email, $me);
            if ($q) {
                $q->log = array_merge((array) $q->log, [(object) ['at' => now(), 'by' => $me['name'], 'note' => 'Deleted: ' . $n['ats'] . ' applications, ' . $n['cand'] . ' database profiles, ' . $n['web'] . ' website messages, ' . $n['files'] . ' files, ' . $n['contacts'] . ' contacts']]);
                docSet('sec/priv/req/' . $id, $q);
            }
            ok(['ok' => true, 'deleted' => $n]);
        case 'priv_close':
            $id = str($b, 'id', 20);
            $q = docGet('sec/priv/req/' . $id);
            if (!$q) {
                fail(404, 'not_found', 'No such request.');
            }
            $q->st = in_array($b['st'] ?? '', ['done', 'denied'], true) ? (string) $b['st'] : 'done';
            $q->closedAt = now();
            $q->by = $me['name'];
            $note = str($b, 'note', 1000);
            // an opt-out that is completed puts the address on the do-not-contact list of every mailing
            if ($q->st === 'done' && ($q->kind ?? '') === 'optout') {
                try {
                    require_once __DIR__ . '/mail.php';
                    mdb()->prepare('REPLACE INTO mail_suppress (email, at, why) VALUES (?, ?, ?)')->execute([strtolower((string) $q->e), now(), 'privacy opt-out']);
                    $note = trim('Added to the do-not-contact list. ' . $note);
                } catch (Throwable $e) {
                    // the mail tables are not set up yet
                }
            }
            $q->log = array_merge((array) $q->log, [(object) ['at' => now(), 'by' => $me['name'], 'note' => ($q->st === 'done' ? 'Completed' : 'Declined') . ($note !== '' ? ': ' . $note : '')]]);
            docSet('sec/priv/req/' . $id, $q);
            if (!empty($b['tell'])) {
                require_once __DIR__ . '/auth.php';
                authMail(['email' => (string) $q->e, 'name' => (string) ($q->n ?? '')], 'Your privacy request to StratEdge', ['Hello,', $q->st === 'done' ? 'Your request (' . $q->kind . ') has been completed.' : 'We could not complete your request (' . $q->kind . ').', $note !== '' ? $note : 'Reply to this email with any questions.']);
            }
            audit('data', 'Privacy request ' . ($q->st === 'done' ? 'completed' : 'declined'), $id, ['kind' => (string) $q->kind], $me);
            ok(['ok' => true]);
        case 'priv_add':
            // a request that came by phone, email or letter, logged by staff (already verified by them)
            $email = strtolower(str($b, 'email', 190));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                fail(400, 'invalid_argument', 'Enter the requester\'s email.');
            }
            $kind = in_array($b['kind'] ?? '', ['access', 'delete', 'correct', 'optout'], true) ? (string) $b['kind'] : 'access';
            $region = in_array($b['region'] ?? '', ['us', 'ca', 'eu', 'uk', 'other'], true) ? (string) $b['region'] : 'us';
            $id = gmdate('ymd') . '-' . rid(3);
            $days = in_array($region, ['eu', 'uk'], true) ? 30 : 45;
            docSet('sec/priv/req/' . $id, json_decode(json_encode(['kind' => $kind, 'e' => $email, 'n' => str($b, 'name', 120), 'msg' => str($b, 'msg', 2000), 'region' => $region, 'src' => 'staff', 'at' => now(), 'verified' => now(), 'due' => now() + $days * 86400000, 'st' => 'open', 'log' => [['at' => now(), 'by' => $me['name'], 'note' => 'Logged by staff (identity checked by them)']]])));
            audit('data', 'Privacy request logged', $id, ['kind' => $kind], $me);
            ok(['id' => $id]);
        case 'priv_keep':
            $n = 0;
            foreach ((array) ($b['items'] ?? []) as $x) {
                $kind = (string) ($x['kind'] ?? '');
                $id = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($x['id'] ?? ''));
                $path = ($kind === 'ats' ? 'ats/' : ($kind === 'cand' ? 'rec/cand/items/' : '')) . $id;
                if ($path === $id || !($d = docGet($path))) {
                    continue;
                }
                $d->keptAt = now();
                unset($d->retDue);
                if (!empty($b['hold'])) {
                    $d->hold = true;
                }
                docSet($path, $d);
                $n++;
            }
            audit('data', !empty($b['hold']) ? 'Legal hold placed' : 'Records kept past retention', 'retention', ['n' => $n], $me);
            ok(['ok' => true, 'n' => $n]);
        case 'priv_run':
            if (!hasRole($me, 'admin')) {
                fail(403, 'forbidden', 'Only an administrator can run the retention pass.');
            }
            ok(privRetentionRun(true));
    }
    fail(404, 'not_found', 'Unknown action.');
}
