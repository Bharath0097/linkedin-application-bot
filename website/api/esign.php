<?php
/* v45.3 Team e-signature (routes es_). Who may send: administrators, HR and accounting as before, anyone given the
   "E-signatures" feature (Roles & access), or the whole team when HR switches that on; "E-signature manager" runs the
   library and sees every request. The internal document library: versions, who sees each document, a saved signing
   pattern (who signs, in what order, and the fields each signs on the pages) and its email. Sending: from the library or
   an upload, in order or in any order, only me, or to many people at once (each their own copy) with a tracker. Email
   options: from the company address or the sender's own connected mailbox, the subject and message, a copy attached,
   the signed copy to more addresses, reminders, expiry; the signed copy emailed again later. The signing itself stays
   in index.php (sig_*), which calls the helpers here. */
declare(strict_types=1);

const ES_CATS = ['policy' => 'Policy', 'hr' => 'HR form', 'nda' => 'NDA', 'offer' => 'Offer letter', 'agreement' => 'Agreement', 'client' => 'Client or vendor', 'other' => 'Other'];
const ES_VIS = ['team' => 'Everyone on the team', 'senders' => 'People who send for signature', 'hr' => 'HR and e-signature managers'];
const ES_ROLES = ['person' => 'The person it is sent to', 'manager' => 'Their manager', 'hr' => 'HR', 'sender' => 'The sender', 'member' => 'A named person', 'ext' => 'Someone outside, by email'];
const ES_KINDS = ['sig' => 'Signature', 'ini' => 'Initials', 'date' => 'Date signed', 'name' => 'Full name', 'text' => 'Text', 'check' => 'Checkbox'];
const ES_MAX_SIGNERS = 10;
const ES_MAX_BULK = 200;

/* ---------------------------------------------------------------- who may do what */

function esCfg(): array
{
    static $c = null;
    if ($c !== null) {
        return $c;
    }
    $d = docGet('esx/cfg');
    $x = $d ? json_decode((string) json_encode($d), true) : [];
    return $c = [
        'who' => ($x['who'] ?? '') === 'team' ? 'team' : 'granted',
        'ext' => array_key_exists('ext', $x) ? !empty($x['ext']) : true,
        'days' => max(0, min(365, (int) ($x['days'] ?? 30))),
        'remind' => max(0, min(30, (int) ($x['remind'] ?? 3))),
        'hr' => (string) ($x['hr'] ?? ''),
    ];
}
/** A member of the team (employees, bench, managers): not a client contact, a consultant on membership or a student. */
function esIsTeam(string $uid): bool
{
    $d = myR($uid);
    return (bool) ($d && ($d->st ?? '') === 'active' && !in_array($d->role ?? '', ['employer', 'consultant', 'student'], true));
}
/** 'admin' (administrators, HR, accounting), 'manage' (e-signature manager), 'send', 'sign' or '' (nobody). */
function esLevel(?array $u): string
{
    static $memo = [];
    if (!$u) {
        return '';
    }
    $k = (string) $u['id'];
    if (isset($memo[$k])) {
        return $memo[$k];
    }
    if (userLevel($u) >= 2) {
        return $memo[$k] = 'admin';
    }
    if (grantOf($k, 'esignAll')) {
        return $memo[$k] = 'manage';
    }
    if (grantOf($k, 'esign') || (esCfg()['who'] === 'team' && esIsTeam($k))) {
        return $memo[$k] = 'send';
    }
    return $memo[$k] = 'sign';
}
function esMayManage(?array $u): bool
{
    return in_array(esLevel($u), ['admin', 'manage'], true);
}
function esMaySend(?array $u): bool
{
    return in_array(esLevel($u), ['admin', 'manage', 'send'], true);
}
function esMayExt(?array $u): bool
{
    return esMayManage($u) || (esMaySend($u) && esCfg()['ext']);
}
/** What the portal shows (the "me" answer). */
function esCaps(array $u): array
{
    $l = esLevel($u);
    return ['level' => $l, 'send' => esMaySend($u), 'manage' => esMayManage($u), 'ext' => esMayExt($u)];
}
/** A signature request: its sender, its signers and e-signature managers may read it. */
function esCanRead(?stdClass $d, ?array $u): bool
{
    if (!$d || !$u) {
        return false;
    }
    return esMayManage($u) || (string) ($d->by ?? '') === (string) $u['id'] || isSigner($d, (string) $u['id']);
}
function esCanRun(stdClass $d, array $u): bool
{
    return esMayManage($u) || (string) ($d->by ?? '') === (string) $u['id'];
}

/* ---------------------------------------------------------------- people to sign */

/** The people a sender may pick: the team and consultants; managers and administrators also client contacts and students. */
function esPeople(array $u): array
{
    $all = esMayManage($u);
    $out = [];
    foreach (db()->query("SELECT id, name, email, role FROM users WHERE status = 'active' ORDER BY name LIMIT 5000")->fetchAll() as $r) {
        $rd = myR((string) $r['id']);
        $role = (string) ($rd->role ?? '');
        if ($rd && ($rd->st ?? '') !== 'active' && !in_array((string) $r['role'], ['admin', 'hr', 'acct'], true)) {
            continue;
        }
        if (!$all && in_array($role, ['employer', 'student'], true)) {
            continue;
        }
        $out[] = ['id' => (string) $r['id'], 'n' => (string) $r['name'], 'e' => (string) $r['email'], 'role' => $role !== '' ? $role : (string) $r['role'], 'mgr' => is_string($rd->mgrId ?? null) ? (string) $rd->mgrId : '', 'hr' => in_array('hr', rolesOf(userRow((string) $r['id']) ?? []), true)];
    }
    return $out;
}
/** The HR person a pattern's "HR" signer becomes: the one chosen in the settings, else the sender when they are HR or
 *  an administrator, else the first HR person. */
function esHrSigner(array $u): string
{
    $c = esCfg()['hr'];
    $row = $c !== '' ? userRow($c) : null;
    if ($row && (string) $row['status'] === 'active') {
        return $c;
    }
    if (hasRole($u, 'hr') || hasRole($u, 'admin')) {
        return (string) $u['id'];
    }
    foreach (db()->query("SELECT * FROM users WHERE status = 'active' ORDER BY created LIMIT 3000")->fetchAll() as $r) {
        if (hasRole($r, 'hr')) {
            return (string) $r['id'];
        }
    }
    return (string) $u['id'];
}
/** One signer from a uid (an active account) as stored on a request. */
function esMemberSigner(string $uid, string $me): array
{
    $row = userRow($uid);
    if (!$row || (string) $row['status'] !== 'active') {
        fail(400, 'invalid_argument', 'One of the signers does not have an active account.');
    }
    return ['uid' => $uid, 'n' => (string) $row['name'], 'e' => (string) $row['email'], 'st' => 'pending', 'role' => $uid === $me ? 'countersign' : 'signer'];
}
function esExtSigner(array $x): array
{
    $n = mb_substr(trim((string) ($x['n'] ?? '')), 0, 120);
    $e = strtolower(trim((string) ($x['e'] ?? '')));
    if ($n === '' || !filter_var($e, FILTER_VALIDATE_EMAIL)) {
        fail(400, 'invalid_argument', 'A signer outside the portal needs a name and a valid email.');
    }
    return ['n' => $n, 'e' => $e, 'st' => 'pending', 'role' => 'signer', 'tok' => rid(16), 'ext' => true];
}

/* ---------------------------------------------------------------- fields placed on the pages */

/** Fields as the sender placed them: kind, the signer's place in the list, page, position and size (fractions of the
 *  page), required, label. */
function esFieldsIn(array $raw, int $signers): array
{
    $out = [];
    foreach (array_slice($raw, 0, 80) as $f) {
        $f = (array) $f;
        $k = (string) ($f['k'] ?? '');
        $s = (int) ($f['s'] ?? -1);
        if (!isset(ES_KINDS[$k]) || $s < 0 || $s >= $signers) {
            continue;
        }
        $num = fn($v, $lo, $hi) => max($lo, min($hi, round((float) $v, 5)));
        $w = $num($f['w'] ?? 0.2, 0.01, 1);
        $h = $num($f['h'] ?? 0.05, 0.005, 1);
        $out[] = [
            'id' => preg_match('/^[a-z0-9]{2,12}$/', (string) ($f['id'] ?? '')) ? (string) $f['id'] : 'f' . rid(3),
            'k' => $k, 's' => $s, 'p' => max(0, min(499, (int) ($f['p'] ?? 0))),
            'x' => $num($f['x'] ?? 0, 0, 1 - $w), 'y' => $num($f['y'] ?? 0, 0, 1 - $h), 'w' => $w, 'h' => $h,
            'req' => $k === 'check' || $k === 'text' ? !empty($f['req']) : true,
            'lbl' => mb_substr(trim((string) ($f['lbl'] ?? '')), 0, 60),
        ];
    }
    return $out;
}
/** A signing pattern: roles in order and their fields. */
function esPatternIn(array $p, array $u): array
{
    $roles = [];
    foreach (array_slice((array) ($p['roles'] ?? []), 0, ES_MAX_SIGNERS) as $r) {
        $r = (array) $r;
        $k = (string) ($r['k'] ?? '');
        if (!isset(ES_ROLES[$k])) {
            continue;
        }
        $x = ['k' => $k, 'lbl' => mb_substr(trim((string) ($r['lbl'] ?? '')), 0, 60)];
        if ($k === 'member') {
            $row = userRow((string) ($r['uid'] ?? ''));
            if (!$row) {
                fail(400, 'invalid_argument', 'Choose the named person for each "A named person" signer.');
            }
            $x['uid'] = (string) $row['id'];
            $x['n'] = (string) $row['name'];
        }
        if ($k === 'ext') {
            if (!esMayExt($u)) {
                fail(403, 'forbidden', 'Signers outside the portal are switched off for your account.');
            }
            $x['n'] = mb_substr(trim((string) ($r['n'] ?? '')), 0, 120);
            $x['e'] = strtolower(trim((string) ($r['e'] ?? '')));
            if ($x['e'] !== '' && !filter_var($x['e'], FILTER_VALIDATE_EMAIL)) {
                fail(400, 'invalid_argument', 'The outside signer\'s email is not valid.');
            }
        }
        $roles[] = $x;
    }
    return ['order' => ($p['order'] ?? '') === 'any' ? 'any' : 'seq', 'roles' => $roles, 'fields' => esFieldsIn((array) ($p['fields'] ?? []), count($roles))];
}
/** A pattern's roles for one person: [signers, error]. */
function esResolve(array $pat, ?string $person, array $u): array
{
    $out = [];
    foreach ($pat['roles'] as $r) {
        switch ($r['k']) {
            case 'person':
                if (!$person) {
                    return [null, 'choose who it is for'];
                }
                $out[] = ['uid' => $person];
                break;
            case 'manager':
                $m = $person ? (is_string(myR($person)->mgrId ?? null) ? (string) myR($person)->mgrId : '') : '';
                if ($m === '') {
                    return [null, 'no manager on file'];
                }
                $out[] = ['uid' => $m];
                break;
            case 'hr':
                $out[] = ['uid' => esHrSigner($u)];
                break;
            case 'sender':
                $out[] = ['uid' => (string) $u['id']];
                break;
            case 'member':
                $out[] = ['uid' => (string) $r['uid']];
                break;
            case 'ext':
                if (($r['e'] ?? '') === '') {
                    return [null, 'the outside signer has no email'];
                }
                $out[] = ['n' => $r['n'] ?: $r['e'], 'e' => $r['e']];
                break;
        }
    }
    return [$out, ''];
}

/* ---------------------------------------------------------------- the library */

function esLibMaySee(stdClass $d, array $u): bool
{
    if (esMayManage($u) || (string) ($d->by ?? '') === (string) $u['id']) {
        return true;
    }
    $vis = (string) ($d->vis ?? 'senders');
    return ($vis === 'team' && (esIsTeam((string) $u['id']) || esMaySend($u))) || ($vis === 'senders' && esMaySend($u));
}
function esLibMayEdit(stdClass $d, array $u): bool
{
    return esMayManage($u) || ((string) ($d->by ?? '') === (string) $u['id'] && esMaySend($u));
}
function esLibView(string $id, stdClass $d, array $u): array
{
    $files = array_values(json_decode((string) json_encode($d->files ?? []), true) ?: []);
    $cur = $files[(int) ($d->cur ?? count($files) - 1)] ?? end($files) ?: null;
    return [
        'id' => $id, 'ti' => (string) $d->ti, 'cat' => (string) ($d->cat ?? 'other'), 'desc' => (string) ($d->desc ?? ''), 'vis' => (string) ($d->vis ?? 'senders'),
        'files' => $files, 'cur' => $cur, 'pat' => json_decode((string) json_encode($d->pat ?? ['order' => 'seq', 'roles' => [], 'fields' => []]), true),
        'mail' => json_decode((string) json_encode($d->mail ?? ['subj' => '', 'msg' => '']), true), 'days' => (int) ($d->days ?? 0), 'remind' => (int) ($d->remind ?? 0),
        'by' => (string) ($d->by ?? ''), 'byn' => (string) ($d->byn ?? ''), 'at' => (int) ($d->at ?? 0), 'u' => (int) ($d->u ?? 0), 'uses' => (int) ($d->uses ?? 0), 'arch' => (int) ($d->arch ?? 0),
        'tok' => (string) ($d->tok ?? ''), 'edit' => esLibMayEdit($d, $u), 'send' => esMaySend($u),
    ];
}
function esLibGet(string $id, array $u): stdClass
{
    $d = preg_match('/^[a-f0-9]{8,20}$/', $id) ? docGet('esd/' . $id) : null;
    if (!$d || !esLibMaySee($d, $u)) {
        fail(404, 'not_found', 'That document is not in the library.');
    }
    return $d;
}

/* ---------------------------------------------------------------- email: the company address or the sender's own mailbox */

/** The sender's connected mailbox (Gmail or Microsoft 365, or Gmail by app password), or null. */
function esMailbox(string $uid): ?array
{
    require_once __DIR__ . '/sso.php';
    try {
        $a = mymailAcct($uid);
    } catch (Throwable $e) {
        return null;
    }
    return $a && in_array((string) $a['provider'], ['google', 'microsoft', 'gmail'], true) ? $a : null;
}
/** Sends one message through the sender's mailbox: [ok, error]. Only during the sender's own requests (never from the
 *  scheduled job): the mailbox's permission is refreshed here when it has expired. */
function esSendFromMe(string $uid, string $to, string $subject, string $text, array $atts = [], array $cc = []): array
{
    require_once __DIR__ . '/sso.php';
    if (PHP_SAPI === 'cli') {
        // the scheduled job and command-line tools never send from a person's own mailbox
        return [false, 'Not from the scheduled job.'];
    }
    $a = esMailbox($uid);
    if (!$a) {
        return [false, 'No mailbox is connected under My email.'];
    }
    $GLOBALS['SE_FAIL_THROWS'] = true;
    try {
        if (in_array($a['provider'], ['google', 'microsoft'], true) && ((int) $a['exp'] <= now() + 60000 || (string) $a['access'] === '')) {
            $a['provider'] === 'microsoft' ? msmailToken($a) : gmailToken($a);
            $a = mymailAcct($uid) ?? $a;
        }
        $row = userRow($uid);
        $fromName = (string) ($a['name'] !== '' ? $a['name'] : ($row['name'] ?? ''));
        $raw = mymailMime($fromName, (string) $a['email'], [$to], $cc, [], $subject, $text, '', $atts);
        [$ok, $err] = mymailSendRaw($a, $raw, array_merge([$to], $cc));
    } catch (Throwable $e) {
        [$ok, $err] = [false, $e->getMessage()];
    } finally {
        $GLOBALS['SE_FAIL_THROWS'] = false;
    }
    try {
        // the message also shows in the sender's Sent mail (My email)
        preg_match('/\r\nMessage-ID: (<[^>]+>)/', $raw ?? '', $mm);
        mymailDb()->prepare('INSERT INTO mail_user_msgs (id, uid, dir, at, from_email, from_name, to_email, cc, subject, text, snippet, msgid, thread, label, seen, starred, gid, err) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute([
            rid(12), $uid, 'out', now(), (string) $a['email'], $fromName ?? '', $to, implode(', ', $cc), mb_substr($subject, 0, 500), $text, mb_substr((string) preg_replace('/\s+/', ' ', $text), 0, 300), (string) ($mm[1] ?? ''), '', '', 1, 0, '', $ok ? '' : (string) $err,
        ]);
    } catch (Throwable $e) {
        // the sent copy is a convenience
    }
    return [(bool) $ok, (string) $err];
}
/** {title}, {sender}, {first_name} in a subject or message. */
function esMerge(string $s, stdClass $d, ?stdClass $signer): string
{
    $first = $signer ? explode(' ', trim((string) ($signer->n ?? '')))[0] : '';
    return strtr($s, ['{title}' => (string) $d->ti, '{sender}' => (string) ($d->byn ?? ''), '{first_name}' => $first]);
}
/** The original document as an attachment (PDF or picture), or [] when too large (8 MB). */
function esAttachment(stdClass $d): array
{
    $data = fileRead((string) $d->fid);
    if ($data === null || strlen($data) > 8 * 1048576) {
        return [];
    }
    return [['name' => (string) ($d->fn ?? 'document.pdf'), 'type' => (string) ($d->fty ?? 'application/pdf'), 'data' => $data]];
}

/* ---------------------------------------------------------------- sending */

/** Creates one request; returns its id. $file: the document (from the library or uploaded) as stored file meta. */
function esCreate(array $u, array $file, string $ti, string $msg, array $signersIn, array $o): string
{
    if (count($signersIn) < 1) {
        fail(400, 'invalid_argument', 'Add at least one signer.');
    }
    if (count($signersIn) > ES_MAX_SIGNERS) {
        fail(400, 'invalid_argument', 'At most ' . ES_MAX_SIGNERS . ' signers on one request.');
    }
    $signers = [];
    $seen = [];
    foreach ($signersIn as $x) {
        $x = (array) $x;
        if (!empty($x['uid'])) {
            $s = esMemberSigner((string) $x['uid'], (string) $u['id']);
            if (!esMayManage($u) && !in_array($s['uid'], array_column(esPeopleIds($u), 0), true) && $s['uid'] !== $u['id']) {
                fail(403, 'forbidden', 'You can send to the team and consultants only.');
            }
            $key = $s['uid'];
        } else {
            if (!esMayExt($u)) {
                fail(403, 'forbidden', 'Signers outside the portal are switched off for your account.');
            }
            $s = esExtSigner($x);
            $key = $s['e'];
        }
        if (isset($seen[$key])) {
            fail(400, 'invalid_argument', 'Each person signs once on a request (' . $s['n'] . ' is in the list twice).');
        }
        $seen[$key] = 1;
        $signers[] = $s;
    }
    if (count($signers) === 1) {
        $signers[0]['role'] = 'signer';
    }
    $id = rid(6);
    $now = now();
    // the document: its stored file is shared with the library (the same encrypted file, its own record here)
    docSet("sig/$id/f/" . $file['id'], (object) ['n' => $file['n'], 'ty' => $file['ty'], 'sz' => (int) ($file['sz'] ?? 0), 'at' => $now, 'c' => 'original']);
    $days = (int) ($o['days'] ?? 0);
    $cc = mymailListSafe((string) ($o['cc'] ?? ''));
    $mail = ['from' => ($o['from'] ?? '') === 'me' && esMailbox((string) $u['id']) ? 'me' : 'co', 'subj' => mb_substr(trim((string) ($o['subj'] ?? '')), 0, 200), 'cc' => array_slice($cc, 0, 10), 'attach' => !empty($o['attach'])];
    $d = (object) [
        'ti' => $ti, 'msg' => $msg, 'due' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($o['due'] ?? '')) ? (string) $o['due'] : '',
        'by' => (string) $u['id'], 'byn' => (string) $u['name'], 'bye' => (string) $u['email'], 'at' => $now, 'st' => 'sent', 'cur' => 0,
        'fid' => (string) $file['id'], 'fn' => (string) $file['n'], 'fty' => (string) $file['ty'], 'fh' => fileHashPath(filePathOf((string) $file['id'])),
        'signers' => json_decode((string) json_encode($signers)), 'order' => ($o['order'] ?? '') === 'any' ? 'any' : 'seq',
        'fields' => esFieldsIn((array) ($o['fields'] ?? []), count($signers)), 'exp' => $days > 0 ? $now + $days * 86400000 : 0,
        'remind' => max(0, min(30, (int) ($o['remind'] ?? 0))), 'remAt' => 0, 'mail' => (object) $mail,
        'lib' => (string) ($o['lib'] ?? ''), 'libv' => (int) ($o['libv'] ?? 0), 'batch' => (string) ($o['batch'] ?? ''), 'kind' => 'team',
        'log' => [(object) ['t' => $now, 'who' => (string) $u['name'], 'ev' => 'Sent for signature' . ($mail['from'] === 'me' ? ' (from ' . $u['email'] . '\'s mailbox)' : ''), 'ip' => clientIp()]],
    ];
    if ($d->order === 'any') {
        foreach (array_keys($signers) as $i) {
            sigNotify($d, $id, $i);
        }
    } else {
        sigNotify($d, $id, 0);
    }
    docSet("sig/$id", $d);
    return $id;
}
function esPeopleIds(array $u): array
{
    static $memo = null;
    if ($memo === null) {
        $memo = array_map(fn($p) => [$p['id']], esPeople($u));
    }
    return $memo;
}
function mymailListSafe(string $s): array
{
    $out = [];
    foreach (preg_split('/[,;\s]+/', $s) as $x) {
        $x = strtolower(trim($x, " \t<>"));
        if ($x !== '' && filter_var($x, FILTER_VALIDATE_EMAIL) && !in_array($x, $out, true)) {
            $out[] = $x;
        }
    }
    return $out;
}
/** The uploaded document of a send (multipart "file"): PDF, PNG or JPG. */
function esUpload(string $base): array
{
    if (!isset($_FILES['file'])) {
        fail(400, 'invalid_argument', 'Attach the document (PDF, PNG or JPG).');
    }
    $ext = strtolower(pathinfo((string) $_FILES['file']['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, ['pdf', 'png', 'jpg', 'jpeg'], true)) {
        fail(400, 'invalid_argument', 'Documents to sign must be PDF, PNG or JPG. Save Word files as PDF first.');
    }
    return storeUpload($_FILES['file'], $base, ['c' => 'original']);
}

/* ---------------------------------------------------------------- the scheduled job: reminders and expiry */

/** At most once an hour: an expired request closes (the sender hears about it); a request with reminders reminds the
 *  people whose signature it waits for, from the company address (with the sender as Reply-To). */
function esCron(): array
{
    require_once __DIR__ . '/mail.php';
    $last = (int) mkvGet('es_cron', 0);
    if ($last > now() - 3600000) {
        return ['reminded' => 0, 'expired' => 0];
    }
    mkvSet('es_cron', now());
    $rem = 0;
    $exp = 0;
    foreach (colAll('sig') as [$id, $d]) {
        if ((string) ($d->st ?? '') !== 'sent') {
            continue;
        }
        if ((int) ($d->exp ?? 0) > 0 && (int) $d->exp < now()) {
            $d->st = 'expired';
            $log = (array) ($d->log ?? []);
            $log[] = (object) ['t' => now(), 'who' => 'System', 'ev' => 'Expired before everyone signed', 'ip' => ''];
            $d->log = $log;
            docSet("sig/$id", $d);
            if (!empty($d->bye)) {
                try {
                    sendMail((string) $d->bye, (string) ($d->byn ?? ''), 'Expired: ' . $d->ti, "\"{$d->ti}\" expired before everyone signed. Send it again from E-signatures if it is still needed.", emailHtml('A signature request expired', ["\"{$d->ti}\" expired before everyone signed. Send it again from E-signatures if it is still needed."], ['Open E-signatures', siteUrl() . '#/portal/sign']));
                } catch (Throwable $e) {
                }
            }
            $exp++;
            continue;
        }
        $every = (int) ($d->remind ?? 0);
        if ($every <= 0) {
            continue;
        }
        $since = max((int) ($d->remAt ?? 0), (int) ($d->at ?? 0));
        if ($since > now() - $every * 86400000) {
            continue;
        }
        $mail = $d->mail ?? null;
        $from = $mail instanceof stdClass ? $mail->from : 'co';
        if ($mail instanceof stdClass) {
            $mail->from = 'co'; // the scheduled job always uses the company address
        }
        foreach (esWaitingFor($d) as $i) {
            sigNotify($d, $id, $i, true);
            $rem++;
        }
        if ($mail instanceof stdClass) {
            $mail->from = $from;
        }
        $d->remAt = now();
        docSet("sig/$id", $d);
    }
    return ['reminded' => $rem, 'expired' => $exp];
}
/** The signers a request waits for now: the current one in order, or everyone still to sign in any order. */
function esWaitingFor(stdClass $d): array
{
    $out = [];
    foreach ((array) $d->signers as $i => $s) {
        if ((string) ($s->st ?? '') === 'pending' && (($d->order ?? 'seq') === 'any' || $i === (int) ($d->cur ?? 0))) {
            $out[] = $i;
        }
    }
    return $out;
}

/* ---------------------------------------------------------------- routes */

function esRoute(string $r, array $b): never
{
    $u = requireUser();
    $str = fn(string $k, int $max) => mb_substr(trim((string) ($b[$k] ?? '')), 0, $max);
    $needSend = function () use ($u) {
        if (!esMaySend($u)) {
            fail(403, 'forbidden', 'Sending for signature is not switched on for your account (Admin › Roles & access › E-signatures).');
        }
    };
    $needManage = function () use ($u) {
        if (!esMayManage($u)) {
            fail(403, 'forbidden', 'This is for administrators, HR and e-signature managers.');
        }
    };
    switch ($r) {
        case 'es_home':
            $mb = esMaySend($u) ? esMailbox((string) $u['id']) : null;
            ok(['caps' => esCaps($u), 'cfg' => esMayManage($u) ? esCfg() : ['ext' => esCfg()['ext'], 'days' => esCfg()['days'], 'remind' => esCfg()['remind']], 'mailbox' => $mb ? (string) $mb['email'] : '', 'cats' => ES_CATS, 'vis' => ES_VIS, 'roles' => ES_ROLES, 'kinds' => ES_KINDS, 'me' => ['id' => (string) $u['id'], 'n' => (string) $u['name'], 'e' => (string) $u['email']], 'hr' => esMaySend($u) ? esHrSigner($u) : '']);

        case 'es_people':
            $needSend();
            ok(['people' => esPeople($u)]);

        case 'es_settings_save':
            // HR and administrators: who may send, outside signers, the defaults
            if (esLevel($u) !== 'admin') {
                fail(403, 'forbidden', 'Administrators and HR change the e-signature settings.');
            }
            $hr = $str('hr', 30);
            $c = (object) ['who' => ($b['who'] ?? '') === 'team' ? 'team' : 'granted', 'ext' => !empty($b['ext']), 'days' => max(0, min(365, (int) ($b['days'] ?? 30))), 'remind' => max(0, min(30, (int) ($b['remind'] ?? 3))), 'hr' => $hr !== '' && userRow($hr) ? $hr : '', 'u' => now(), 'by' => $u['id']];
            docSet('esx/cfg', $c);
            audit('settings', 'E-signature settings changed', $c->who === 'team' ? 'everyone on the team may send' : 'people given the feature may send', [], $u);
            ok(['cfg' => (array) $c]);

        /* ---------------- the library ---------------- */
        case 'es_lib':
            $out = [];
            foreach (colAll('esd') as [$id, $d]) {
                if (!esLibMaySee($d, $u) || (!empty($d->arch) && empty($b['arch']))) {
                    continue;
                }
                $out[] = esLibView((string) $id, $d, $u);
            }
            usort($out, fn($a, $c) => [$a['cat'], strtolower($a['ti'])] <=> [$c['cat'], strtolower($c['ti'])]);
            ok(['docs' => $out]);

        case 'es_lib_get':
            ok(['doc' => esLibView($str('id', 20), esLibGet($str('id', 20), $u), $u)]);

        case 'es_lib_save':
            // multipart: data (JSON: id?, ti, cat, desc, vis, pat, mail, days, remind, note) and an optional file (a new version)
            $needSend();
            $in = json_decode((string) ($_POST['data'] ?? '{}'), true);
            $in = is_array($in) ? $in : [];
            $id = preg_replace('/[^a-f0-9]/', '', (string) ($in['id'] ?? ''));
            $now = now();
            if ($id !== '') {
                $d = esLibGet($id, $u);
                if (!esLibMayEdit($d, $u)) {
                    fail(403, 'forbidden', 'Only the person who added it or an e-signature manager changes it.');
                }
            } else {
                if (throttleHit('eslib:' . $u['id'], 60, 3600)) {
                    fail(429, 'slow_down', 'Too many new documents in an hour.');
                }
                $id = rid(8);
                $d = (object) ['files' => [], 'cur' => 0, 'by' => (string) $u['id'], 'byn' => (string) $u['name'], 'at' => $now, 'uses' => 0, 'arch' => 0, 'tok' => rid(16), 'pat' => ['order' => 'seq', 'roles' => [], 'fields' => []], 'mail' => ['subj' => '', 'msg' => '']];
            }
            $ti = mb_substr(trim((string) ($in['ti'] ?? ($d->ti ?? ''))), 0, 160);
            if ($ti === '') {
                fail(400, 'invalid_argument', 'Give the document a title.');
            }
            $d->ti = $ti;
            $d->cat = isset(ES_CATS[$in['cat'] ?? '']) ? (string) $in['cat'] : (string) ($d->cat ?? 'other');
            $d->desc = mb_substr(trim((string) ($in['desc'] ?? ($d->desc ?? ''))), 0, 1000);
            $vis = isset(ES_VIS[$in['vis'] ?? '']) ? (string) $in['vis'] : (string) ($d->vis ?? 'senders');
            if ($vis === 'hr' && !esMayManage($u)) {
                $vis = 'senders';
            }
            $d->vis = $vis;
            if (isset($in['pat']) && is_array($in['pat'])) {
                $d->pat = esPatternIn($in['pat'], $u);
            }
            if (isset($in['mail']) && is_array($in['mail'])) {
                $d->mail = ['subj' => mb_substr(trim((string) ($in['mail']['subj'] ?? '')), 0, 200), 'msg' => mb_substr(trim((string) ($in['mail']['msg'] ?? '')), 0, 2000)];
            }
            $d->days = max(0, min(365, (int) ($in['days'] ?? ($d->days ?? 0))));
            $d->remind = max(0, min(30, (int) ($in['remind'] ?? ($d->remind ?? 0))));
            if (isset($_FILES['file'])) {
                $f = esUpload('esd/' . $id);
                $files = (array) ($d->files ?? []);
                $files[] = ['v' => count($files) + 1, 'fid' => $f['id'], 'fn' => $f['n'], 'fty' => $f['ty'], 'sz' => (int) $f['sz'], 'fh' => fileHashPath(filePathOf((string) $f['id'])), 'at' => $now, 'by' => (string) $u['name'], 'note' => mb_substr(trim((string) ($in['note'] ?? '')), 0, 200)];
                $d->files = $files;
                $d->cur = count($files) - 1;
            }
            if (!count((array) ($d->files ?? []))) {
                fail(400, 'invalid_argument', 'Attach the document (PDF, PNG or JPG).');
            }
            $d->u = $now;
            docSet('esd/' . $id, json_decode((string) json_encode($d)));
            ok(['doc' => esLibView($id, docGet('esd/' . $id), $u)]);

        case 'es_lib_archive':
            $d = esLibGet($str('id', 20), $u);
            if (!esLibMayEdit($d, $u)) {
                fail(403, 'forbidden', 'Only the person who added it or an e-signature manager archives it.');
            }
            $d->arch = !empty($b['arch']) ? now() : 0;
            docSet('esd/' . $str('id', 20), $d);
            ok(['doc' => esLibView($str('id', 20), $d, $u)]);

        /* ---------------- sending ---------------- */
        case 'es_send':
            // multipart (an uploaded document) or JSON (a library document): one request, or one per person (bulk)
            $needSend();
            $in = !empty($_POST['data']) ? json_decode((string) $_POST['data'], true) : $b;
            $in = is_array($in) ? $in : [];
            if (throttleHit('essend:' . $u['id'], 400, 3600)) {
                fail(429, 'slow_down', 'Too many requests sent in an hour.');
            }
            $libId = preg_replace('/[^a-f0-9]/', '', (string) ($in['lib'] ?? ''));
            $lib = $libId !== '' ? esLibGet($libId, $u) : null;
            if ($lib) {
                $files = (array) $lib->files;
                $vf = (array) ($files[(int) ($lib->cur ?? 0)] ?? end($files));
                $file = ['id' => (string) $vf['fid'], 'n' => (string) $vf['fn'], 'ty' => (string) $vf['fty'], 'sz' => (int) ($vf['sz'] ?? 0)];
                $libv = (int) ($vf['v'] ?? 1);
            } else {
                $base = 'sig/up' . rid(6);
                $file = esUpload($base);
                docDelete($base . '/f/' . $file['id']); // its record moves to each request below
                $libv = 0;
            }
            $ti = mb_substr(trim((string) ($in['ti'] ?? ($lib->ti ?? ''))), 0, 160);
            if ($ti === '') {
                fail(400, 'invalid_argument', 'Give the request a title.');
            }
            // what the request leaves out comes from the library document, then from the settings
            $lm = $lib && isset($lib->mail) ? (object) $lib->mail : null;
            $msg = mb_substr(trim((string) (array_key_exists('msg', $in) ? $in['msg'] : ($lm->msg ?? ''))), 0, 2000);
            $opts = [
                'order' => (string) ($in['order'] ?? 'seq'), 'fields' => (array) ($in['fields'] ?? []), 'due' => (string) ($in['due'] ?? ''),
                'days' => array_key_exists('days', $in) ? (int) $in['days'] : ($lib && (int) ($lib->days ?? 0) > 0 ? (int) $lib->days : esCfg()['days']),
                'remind' => array_key_exists('remind', $in) ? (int) $in['remind'] : ($lib && (int) ($lib->remind ?? 0) > 0 ? (int) $lib->remind : esCfg()['remind']),
                'from' => (string) ($in['mail']['from'] ?? 'co'), 'subj' => (string) (isset($in['mail']['subj']) ? $in['mail']['subj'] : ($lm->subj ?? '')), 'cc' => (string) ($in['mail']['cc'] ?? ''), 'attach' => !empty($in['mail']['attach']),
                'lib' => $libId, 'libv' => $libv,
            ];
            $bulk = array_values(array_unique(array_filter(array_map('strval', (array) ($in['bulk'] ?? [])))));
            if ($bulk) {
                // one request per person, the pattern's roles worked out for each (the person, their manager, HR, me...)
                if (count($bulk) > ES_MAX_BULK) {
                    fail(400, 'invalid_argument', 'At most ' . ES_MAX_BULK . ' people at once.');
                }
                $pat = esPatternIn((array) ($in['pat'] ?? ($lib ? json_decode((string) json_encode($lib->pat), true) : [])), $u);
                if (!in_array('person', array_column($pat['roles'], 'k'), true)) {
                    fail(400, 'invalid_argument', 'Sending to many people needs a signing pattern with "The person it is sent to".');
                }
                $opts['order'] = $pat['order'];
                $opts['fields'] = $pat['fields'];
                $batch = rid(6);
                $opts['batch'] = $batch;
                $ids = [];
                $skipped = [];
                $mayTo = esMayManage($u) ? null : array_column(esPeopleIds($u), 0);
                foreach ($bulk as $pid) {
                    $row = userRow($pid);
                    if (!$row || (string) $row['status'] !== 'active') {
                        $skipped[] = ['id' => $pid, 'n' => '', 'why' => 'no active account'];
                        continue;
                    }
                    if ($mayTo !== null && !in_array($pid, $mayTo, true)) {
                        $skipped[] = ['id' => $pid, 'n' => (string) $row['name'], 'why' => 'not on the team'];
                        continue;
                    }
                    [$signers, $why] = esResolve($pat, $pid, $u);
                    if (!$signers) {
                        $skipped[] = ['id' => $pid, 'n' => (string) $row['name'], 'why' => $why];
                        continue;
                    }
                    // the same person twice in one pattern (their own manager is HR, say) signs once
                    $uniq = [];
                    $map = [];
                    foreach ($signers as $i => $s) {
                        $k = $s['uid'] ?? ($s['e'] ?? '');
                        if (!isset($uniq[$k])) {
                            $uniq[$k] = count($uniq);
                        }
                        $map[$i] = $uniq[$k];
                    }
                    $list = [];
                    foreach ($signers as $i => $s) {
                        if ($map[$i] === count($list)) {
                            $list[] = $s;
                        }
                    }
                    $o2 = $opts;
                    $o2['fields'] = array_map(fn($f) => ['s' => $map[$f['s']] ?? $f['s']] + $f, $pat['fields']);
                    $ids[] = ['id' => esCreate($u, $file, $ti, $msg, $list, $o2), 'pid' => $pid, 'n' => (string) $row['name']];
                }
                if (!$ids) {
                    fail(400, 'invalid_argument', 'Nothing was sent: ' . implode('; ', array_map(fn($s) => ($s['n'] ?: $s['id']) . ' (' . $s['why'] . ')', array_slice($skipped, 0, 5))));
                }
                docSet('esb/' . $batch, (object) ['ti' => $ti, 'lib' => $libId, 'by' => (string) $u['id'], 'byn' => (string) $u['name'], 'at' => now(), 'ids' => $ids, 'skipped' => $skipped]);
                if ($lib) {
                    $lib->uses = (int) ($lib->uses ?? 0) + count($ids);
                    docSet('esd/' . $libId, $lib);
                }
                ok(['batch' => $batch, 'sent' => count($ids), 'skipped' => $skipped]);
            }
            $signers = (array) ($in['signers'] ?? []);
            if (!empty($in['self'])) {
                $signers = [['uid' => (string) $u['id']]];
            }
            $id = esCreate($u, $file, $ti, $msg, $signers, $opts);
            if ($lib) {
                $lib->uses = (int) ($lib->uses ?? 0) + 1;
                docSet('esd/' . $libId, $lib);
            }
            ok(['id' => $id]);

        case 'es_batches':
            $out = [];
            foreach (colAll('esb') as [$bid, $x]) {
                if ((string) $x->by !== (string) $u['id'] && !esMayManage($u)) {
                    continue;
                }
                $n = count((array) $x->ids);
                $done = 0;
                foreach ((array) $x->ids as $e) {
                    $d = docGet('sig/' . $e->id);
                    $done += $d && (string) $d->st === 'completed' ? 1 : 0;
                }
                $out[] = ['id' => (string) $bid, 'ti' => (string) $x->ti, 'byn' => (string) $x->byn, 'at' => (int) $x->at, 'n' => $n, 'done' => $done, 'skipped' => count((array) ($x->skipped ?? []))];
            }
            usort($out, fn($a, $c) => $c['at'] <=> $a['at']);
            ok(['batches' => $out]);

        case 'es_batch':
            $x = docGet('esb/' . preg_replace('/[^a-f0-9]/', '', $str('id', 20)));
            if (!$x || ((string) $x->by !== (string) $u['id'] && !esMayManage($u))) {
                fail(404, 'not_found', 'No such bulk send.');
            }
            $rows = [];
            foreach ((array) $x->ids as $e) {
                $d = docGet('sig/' . $e->id);
                if (!$d) {
                    continue;
                }
                $signed = count(array_filter((array) $d->signers, fn($s) => (string) $s->st === 'signed'));
                $wait = array_map(fn($i) => (string) $d->signers[$i]->n, esWaitingFor($d));
                $rows[] = ['id' => (string) $e->id, 'n' => (string) $e->n, 'st' => (string) $d->st, 'signed' => $signed, 'of' => count((array) $d->signers), 'wait' => $wait, 'done' => (int) ($d->done ?? 0), 'sfid' => (string) ($d->sfid ?? '')];
            }
            ok(['batch' => ['id' => $str('id', 20), 'ti' => (string) $x->ti, 'at' => (int) $x->at, 'byn' => (string) $x->byn, 'rows' => $rows, 'skipped' => json_decode((string) json_encode($x->skipped ?? []), true)]]);

        case 'es_batch_remind':
            $x = docGet('esb/' . preg_replace('/[^a-f0-9]/', '', $str('id', 20)));
            if (!$x || ((string) $x->by !== (string) $u['id'] && !esMayManage($u))) {
                fail(404, 'not_found', 'No such bulk send.');
            }
            $n = 0;
            foreach ((array) $x->ids as $e) {
                $d = docGet('sig/' . $e->id);
                if (!$d || (string) $d->st !== 'sent') {
                    continue;
                }
                foreach (esWaitingFor($d) as $i) {
                    $n += sigNotify($d, (string) $e->id, $i, true) ? 1 : 0;
                }
                $d->remAt = now();
                docSet('sig/' . $e->id, $d);
            }
            ok(['reminded' => $n]);

        case 'es_send_copy':
            // the signed copy (with its certificate pages) to more addresses, from the company or the sender's mailbox
            $id = preg_replace('/[^a-f0-9]/', '', $str('id', 20));
            $d = docGet('sig/' . $id);
            if (!$d || !esCanRead($d, $u)) {
                fail(404, 'not_found', 'No such request.');
            }
            if ((string) $d->st !== 'completed' || empty($d->sfid)) {
                fail(409, 'conflict', 'The signed copy is ready once everyone has signed.');
            }
            $to = array_slice(mymailListSafe($str('to', 2000)), 0, 10);
            if (!$to) {
                fail(400, 'invalid_argument', 'Give at least one email address.');
            }
            if (throttleHit('escopy:' . $u['id'], 40, 3600)) {
                fail(429, 'slow_down', 'Too many copies sent in an hour.');
            }
            $pdf = fileRead((string) $d->sfid);
            if ($pdf === null) {
                fail(404, 'not_found', 'The signed copy is missing.');
            }
            $att = [['name' => (string) ($d->sfn ?? 'signed.pdf'), 'type' => 'application/pdf', 'data' => $pdf]];
            // v83: the original as sent goes with it, so the recipient can compare the two
            $orig = fileRead((string) $d->fid);
            if ($orig !== null) {
                $att[] = ['name' => 'original-' . (string) ($d->fn ?? 'document'), 'type' => (string) ($d->fty ?? 'application/pdf'), 'data' => $orig];
            }
            $note = $str('note', 2000);
            $subject = 'Signed copy: ' . $d->ti;
            $text = ($note !== '' ? $note . "\n\n" : '') . "\"{$d->ti}\" was signed by " . implode(', ', array_map(fn($s) => (string) $s->n, (array) $d->signers)) . '. The signed PDF, with a signature certificate for each signer, is attached.' . ($orig !== null ? ' The original document as sent (SHA-256 ' . (string) ($d->fh ?? '') . ') is attached too.' : '');
            $sent = 0;
            $errs = [];
            $fromMe = ($b['from'] ?? '') === 'me' && esMailbox((string) $u['id']);
            foreach ($to as $e) {
                if ($fromMe) {
                    [$okm, $err] = esSendFromMe((string) $u['id'], $e, $subject, $text, $att);
                } else {
                    $okm = sendMail($e, '', $subject, $text, emailHtml($subject, array_values(array_filter([$note, "\"{$d->ti}\" was signed by " . implode(', ', array_map(fn($s) => (string) $s->n, (array) $d->signers)) . '. The signed PDF, with a signature certificate for each signer, is attached.' . ($orig !== null ? ' The original document as sent (SHA-256 ' . (string) ($d->fh ?? '') . ') is attached too.' : '')])), null), $att, (string) $u['email']);
                    $err = $okm ? '' : (string) ($GLOBALS['mailErr'] ?? 'not delivered');
                }
                $okm ? $sent++ : ($errs[] = $e . ': ' . $err);
            }
            $log = (array) ($d->log ?? []);
            $log[] = (object) ['t' => now(), 'who' => (string) $u['name'], 'ev' => 'Signed copy emailed to ' . implode(', ', $to) . ($fromMe ? ' (from ' . $u['email'] . ')' : ''), 'ip' => clientIp()];
            $d->log = $log;
            docSet('sig/' . $id, $d);
            ok(['sent' => $sent, 'errors' => $errs]);
    }
    fail(404, 'not_found', 'Unknown request.');
}
