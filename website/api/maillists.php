<?php
declare(strict_types=1);
/*
 * v37.5 Distribution lists, routes dl_* (Email › Lists):
 *   Named lists of vendor and client contacts, team members, consultants and candidates and any addresses, plus a
 *   selection that keeps itself up to date (all prime vendors, every bench consultant, ATS applicants at a stage...).
 *   Administrators and HR make and edit lists and choose who may send to each; the team picks a list wherever it
 *   sends email (New email, Share requirements) and every person gets their own copy, under the list's name.
 *   A list can have its own address (reqs@yourcompany.com): mail to it is relayed to the members, read from the
 *   list's mailbox over IMAP by the scheduled task (or "Check now"), or handed over by Mailgun / Postal inbound routes.
 *   Who may write to the address is a setting; anyone else waits for an administrator. Loops and automatic replies are
 *   dropped. Members leave a list from the link at the bottom of its emails (without leaving every mailing).
 *   Tables (the mail database): mail_lists, mail_list_members, mail_list_msgs.
 */
require_once __DIR__ . '/mail.php';
require_once __DIR__ . '/imapmail.php';

const DL_SCHEMA = 1;
const DL_KINDS = ['vendor' => 'Vendor', 'client' => 'Client', 'team' => 'Team', 'consultant' => 'Consultant', 'candidate' => 'Candidate', 'contact' => 'Contact', 'other' => 'Other'];
// who may send to a list (administrators always may); "recruiter" is everyone working in the employee portal
const DL_ROLES = ['everyone' => 'Everyone who sends email in the portal', 'hr' => 'HR', 'manager' => 'Managers', 'acct' => 'Accounting', 'bench' => 'Employees (legacy rule)', 'recruiter' => 'Recruiters (employee portal)'];
const DL_POST = ['senders' => 'People who may send to the list', 'members' => 'Them and the list\'s members', 'anyone' => 'Anyone'];
const DL_REPLY = ['sender' => 'The person who sent it', 'list' => 'The list\'s address', 'fixed' => 'An address you choose'];
const DL_RULE_KEYS = ['groups', 'ats', 'atsStage', 'vms', 'vmsTypes', 'rec', 'contacts', 'tags'];
const DL_MAX_MEMBERS = 20000;
const DL_RELAY_HOUR = 30;
const DL_MAX_MB = 25;

/* ---------- storage ---------- */
function dlDb(): PDO
{
    static $ready = false;
    $pdo = mdb();
    if ($ready) {
        return $pdo;
    }
    $v = (int) ($pdo->query("SELECT v FROM meta WHERE k = 'dl_schema'")->fetchColumn() ?: 0);
    if ($v < DL_SCHEMA) {
        $pdo->exec('CREATE TABLE IF NOT EXISTS mail_lists (id VARCHAR(16) PRIMARY KEY, name VARCHAR(120) NOT NULL, descr VARCHAR(500) NOT NULL,
            addr VARCHAR(190) NOT NULL, from_name VARCHAR(120) NOT NULL, reply VARCHAR(10) NOT NULL, reply_to VARCHAR(190) NOT NULL,
            prefix VARCHAR(40) NOT NULL, senders TEXT NOT NULL, post VARCHAR(10) NOT NULL, rule_json TEXT NOT NULL, imap TEXT NOT NULL,
            status VARCHAR(10) NOT NULL, reach INT NOT NULL, reach_at BIGINT NOT NULL, sent INT NOT NULL, last_sent BIGINT NOT NULL,
            created BIGINT NOT NULL, updated BIGINT NOT NULL, by_uid VARCHAR(40) NOT NULL, by_name VARCHAR(190) NOT NULL)');
        $pdo->exec('CREATE TABLE IF NOT EXISTS mail_list_members (list VARCHAR(16) NOT NULL, email VARCHAR(190) NOT NULL, name VARCHAR(190) NOT NULL,
            company VARCHAR(190) NOT NULL, title VARCHAR(190) NOT NULL, kind VARCHAR(12) NOT NULL, src VARCHAR(60) NOT NULL, st VARCHAR(8) NOT NULL,
            added BIGINT NOT NULL, by_uid VARCHAR(40) NOT NULL, left_at BIGINT NOT NULL, PRIMARY KEY (list, email))');
        $pdo->exec('CREATE TABLE IF NOT EXISTS mail_list_msgs (id VARCHAR(16) PRIMARY KEY, list VARCHAR(16) NOT NULL, at BIGINT NOT NULL,
            dir VARCHAR(4) NOT NULL, from_email VARCHAR(190) NOT NULL, from_name VARCHAR(190) NOT NULL, subject VARCHAR(300) NOT NULL,
            body MEDIUMTEXT NOT NULL, atts TEXT NOT NULL, st VARCHAR(10) NOT NULL, why VARCHAR(300) NOT NULL, campaign VARCHAR(24) NOT NULL,
            n INT NOT NULL, msgid VARCHAR(300) NOT NULL, by_uid VARCHAR(40) NOT NULL, by_name VARCHAR(190) NOT NULL)');
        foreach (['CREATE INDEX mail_list_msgs_list ON mail_list_msgs (list, at)', 'CREATE INDEX mail_list_msgs_mid ON mail_list_msgs (list, msgid)', 'CREATE INDEX mail_list_members_email ON mail_list_members (email)'] as $sql) {
            try {
                $pdo->exec($sql);
            } catch (Throwable $e) {
                // already there
            }
        }
        try {
            $pdo->prepare('INSERT INTO meta (k, v) VALUES (?, ?)')->execute(['dl_schema', DL_SCHEMA]);
        } catch (Throwable $e) {
            $pdo->prepare('UPDATE meta SET v = ? WHERE k = ?')->execute([DL_SCHEMA, 'dl_schema']);
        }
    }
    $ready = true;
    return $pdo;
}

/** A list as the code uses it (null when there is no such list). */
function dlGet(string $id): ?array
{
    if (!preg_match('/^[a-f0-9]{12}$/', $id)) {
        return null;
    }
    $q = dlDb()->prepare('SELECT * FROM mail_lists WHERE id = ?');
    $q->execute([$id]);
    $r = $q->fetch();
    return $r ? dlRow($r) : null;
}
function dlRow(array $r): array
{
    $s = json_decode((string) $r['senders'], true) ?: [];
    $im = json_decode((string) $r['imap'], true) ?: [];
    return [
        'id' => (string) $r['id'], 'name' => (string) $r['name'], 'descr' => (string) $r['descr'], 'addr' => (string) $r['addr'],
        'fromName' => (string) $r['from_name'], 'reply' => (string) $r['reply'], 'replyTo' => (string) $r['reply_to'], 'prefix' => (string) $r['prefix'],
        'senders' => ['roles' => array_values(array_intersect(array_keys(DL_ROLES), (array) ($s['roles'] ?? []))), 'uids' => array_values(array_filter((array) ($s['uids'] ?? []), 'is_string'))],
        'post' => isset(DL_POST[$r['post']]) ? (string) $r['post'] : 'senders',
        'rule' => dlRuleClean(json_decode((string) $r['rule_json'], true) ?: []),
        'imap' => $im,
        'status' => (string) $r['status'], 'reach' => (int) $r['reach'], 'reachAt' => (int) $r['reach_at'], 'sent' => (int) $r['sent'], 'lastSent' => (int) $r['last_sent'],
        'created' => (int) $r['created'], 'updated' => (int) $r['updated'], 'byn' => (string) $r['by_name'],
    ];
}
/** The self-updating part of a list: the same choices as New email's audience (never lists or pasted addresses). */
function dlRuleClean(array $a): array
{
    $out = [];
    $groups = array_values(array_intersect((array) ($a['groups'] ?? []), ['employees', 'consultants', 'clients']));
    if ($groups) {
        $out['groups'] = $groups;
    }
    if (!empty($a['ats'])) {
        $out['ats'] = true;
        $out['atsStage'] = mb_substr((string) ($a['atsStage'] ?? ''), 0, 30);
    }
    if (!empty($a['vms'])) {
        $out['vms'] = true;
        $out['vmsTypes'] = array_values(array_slice(array_filter(array_map(fn($t) => mb_substr(trim((string) $t), 0, 60), (array) ($a['vmsTypes'] ?? []))), 0, 20));
    }
    if (!empty($a['rec'])) {
        $out['rec'] = true;
    }
    if (!empty($a['contacts'])) {
        $out['contacts'] = true;
        $out['tags'] = array_values(array_slice(array_filter(array_map(fn($t) => mb_substr(trim((string) $t), 0, 40), (array) ($a['tags'] ?? []))), 0, 20));
    }
    return $out;
}
/** The rule in words ("Prime vendor contacts, bench consultants"). */
function dlRuleText(array $rule): string
{
    $p = [];
    foreach ((array) ($rule['groups'] ?? []) as $g) {
        $p[] = ['employees' => 'employees', 'consultants' => 'consultants in the portal', 'clients' => 'client contacts'][$g] ?? $g;
    }
    if (!empty($rule['vms'])) {
        $p[] = $rule['vmsTypes'] ? implode(', ', $rule['vmsTypes']) . ' contacts' : 'every vendor and client contact';
    }
    if (!empty($rule['rec'])) {
        $p[] = 'the consultant database';
    }
    if (!empty($rule['ats'])) {
        $p[] = 'ATS applicants' . ($rule['atsStage'] !== '' ? ' at ' . $rule['atsStage'] : '');
    }
    if (!empty($rule['contacts'])) {
        $p[] = $rule['tags'] ? 'contacts tagged ' . implode(', ', $rule['tags']) : 'every contact';
    }
    return implode('; ', $p);
}

/* ---------- who may do what ---------- */
function dlManager(array $u): bool
{
    return hasRole($u, 'admin') || hasRole($u, 'hr');
}
function dlMaySend(array $L, array $u): bool
{
    if (hasRole($u, 'admin') || (hasRole($u, 'hr') && mailCanUse($u))) {
        return true;
    }
    if (!mailCanUse($u)) {
        return false;
    }
    $uid = (string) ($u['id'] ?? '');
    if ($uid !== '' && in_array($uid, $L['senders']['uids'], true)) {
        return true;
    }
    foreach ($L['senders']['roles'] as $r) {
        if ($r === 'everyone' || (in_array($r, ['hr', 'manager', 'acct'], true) && hasRole($u, $r)) || ($r === 'bench' && $uid !== '' && isBench($uid)) || ($r === 'recruiter' && $uid !== '' && isRecruiter($uid))) {
            return true;
        }
    }
    return false;
}
/** A stand-in account that reads every source (a list's selection was set by an administrator). */
function dlSystemUser(string $name = 'Distribution list'): array
{
    return ['id' => '', 'name' => $name, 'email' => '', 'role' => 'admin', 'roles' => ['admin'], 'status' => 'active', 'access' => ''];
}

/* ---------- members ---------- */
/** Everyone a list reaches now: its members and its selection, without people who left it or unsubscribed. */
function dlRecipients(array $L): array
{
    $out = [];
    $left = [];
    $q = dlDb()->prepare('SELECT email, name, company, title, kind, st FROM mail_list_members WHERE list = ?');
    $q->execute([$L['id']]);
    foreach ($q as $m) {
        $e = (string) $m['email'];
        if ($m['st'] === 'left') {
            $left[$e] = true;
            continue;
        }
        $out[$e] = ['email' => $e, 'name' => (string) $m['name'], 'vars' => array_filter(['company' => (string) $m['company'], 'title' => (string) $m['title']], fn($x) => $x !== '')];
    }
    if ($L['rule']) {
        $aud = mailAudience($L['rule'], dlSystemUser());
        foreach ($aud['list'] as $p) {
            $out[$p['email']] = $out[$p['email']] ?? $p;
        }
    }
    $sup = mailSuppressed();
    foreach (array_keys($out) as $e) {
        if (isset($left[$e]) || isset($sup[$e])) {
            unset($out[$e]);
        }
    }
    // a list never sends to its own address (that would be a loop)
    unset($out[$L['addr']]);
    return $out;
}
/** Keeps the "reaches N people" figure the lists page shows. */
function dlReach(array $L): int
{
    $n = count(dlRecipients($L));
    dlDb()->prepare('UPDATE mail_lists SET reach = ?, reach_at = ? WHERE id = ?')->execute([$n, now(), $L['id']]);
    return $n;
}
/** New members (an address already on the list stays as it is; people who left are not put back). */
function dlAddMembers(array $L, array $rows, array $u): array
{
    $pdo = dlDb();
    $have = [];
    $q = $pdo->prepare('SELECT email, st FROM mail_list_members WHERE list = ?');
    $q->execute([$L['id']]);
    foreach ($q as $m) {
        $have[(string) $m['email']] = (string) $m['st'];
    }
    $sup = mailSuppressed();
    $added = 0;
    $res = ['added' => 0, 'already' => 0, 'left' => 0, 'unsub' => 0, 'bad' => 0, 'full' => false];
    $ins = $pdo->prepare('INSERT INTO mail_list_members (list, email, name, company, title, kind, src, st, added, by_uid, left_at) VALUES (?,?,?,?,?,?,?,?,?,?,0)');
    $pdo->beginTransaction();
    try {
        foreach ($rows as $r) {
            $e = strtolower(trim((string) ($r['email'] ?? '')));
            if (!filter_var($e, FILTER_VALIDATE_EMAIL) || strlen($e) > 190) {
                $res['bad']++;
                continue;
            }
            if (isset($have[$e])) {
                $res[$have[$e] === 'left' ? 'left' : 'already']++;
                continue;
            }
            if (count($have) >= DL_MAX_MEMBERS) {
                $res['full'] = true;
                break;
            }
            $kind = isset(DL_KINDS[(string) ($r['kind'] ?? '')]) ? (string) $r['kind'] : 'other';
            $ins->execute([$L['id'], $e, mb_substr(trim((string) ($r['name'] ?? '')), 0, 190), mb_substr(trim((string) ($r['company'] ?? '')), 0, 190), mb_substr(trim((string) ($r['title'] ?? '')), 0, 190), $kind, mb_substr((string) ($r['src'] ?? ''), 0, 60), 'in', now(), (string) $u['id']]);
            $have[$e] = 'in';
            $res['added']++;
            if (isset($sup[$e])) {
                $res['unsub']++;
            }
        }
        $pdo->commit();
    } catch (Throwable $ex) {
        $pdo->rollBack();
        throw $ex;
    }
    return $res;
}
/** A member leaves (from the link in a list email): kept as "left" so neither the selection nor an import adds them back. */
function dlLeave(string $listId, string $email): bool
{
    $L = dlGet($listId);
    $email = strtolower(trim($email));
    if (!$L || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return false;
    }
    $pdo = dlDb();
    $u = $pdo->prepare("UPDATE mail_list_members SET st = 'left', left_at = ? WHERE list = ? AND email = ?");
    $u->execute([now(), $L['id'], $email]);
    if ($u->rowCount() === 0) {
        $pdo->prepare("INSERT INTO mail_list_members (list, email, name, company, title, kind, src, st, added, by_uid, left_at) VALUES (?,?,'','','','other','selection','left',?, '', ?)")->execute([$L['id'], $email, now(), now()]);
    }
    return true;
}

/* ---------- sending ---------- */
/** Recipients of the lists in an audience that this person may send to (mailAudience calls this). */
function dlAudience(array $ids, array $u): array
{
    $out = [];
    foreach (array_slice(array_unique(array_filter($ids, 'is_string')), 0, 20) as $id) {
        $L = dlGet($id);
        if (!$L || $L['status'] !== 'active' || !dlMaySend($L, $u)) {
            continue;
        }
        foreach (dlRecipients($L) as $e => $p) {
            $out[$e] = $out[$e] ?? $p;
        }
    }
    return array_values($out);
}
/** After New email or Share requirements went to lists: each list's activity, last sent and count. */
function dlNoteSent(array $ids, string $campaignId, string $subject, int $n, array $u): void
{
    try {
        foreach (array_slice(array_unique(array_filter($ids, 'is_string')), 0, 20) as $id) {
            $L = dlGet($id);
            if (!$L || !dlMaySend($L, $u)) {
                continue;
            }
            dlDb()->prepare('INSERT INTO mail_list_msgs (id, list, at, dir, from_email, from_name, subject, body, atts, st, why, campaign, n, msgid, by_uid, by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
                ->execute([rid(6), $L['id'], now(), 'out', mb_substr((string) ($u['email'] ?? ''), 0, 190), mb_substr((string) $u['name'], 0, 190), mb_substr($subject, 0, 300), '', '[]', 'sent', '', $campaignId, $n, '', (string) $u['id'], mb_substr((string) $u['name'], 0, 190)]);
            dlDb()->prepare('UPDATE mail_lists SET sent = sent + 1, last_sent = ? WHERE id = ?')->execute([now(), $L['id']]);
        }
    } catch (Throwable $e) {
        mailLog('Distribution list activity could not be noted: ' . $e->getMessage());
    }
}

/* ---------- the list's own address ---------- */
function dlByAddress(string $to): ?array
{
    $want = [];
    if (preg_match_all('/[A-Za-z0-9._%+\'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/', strtolower($to), $m)) {
        $want = array_unique($m[0]);
    }
    if (!$want) {
        return null;
    }
    $q = dlDb()->prepare('SELECT * FROM mail_lists WHERE addr IN (' . implode(',', array_fill(0, count($want), '?')) . ") AND status <> 'archived' LIMIT 1");
    $q->execute(array_values($want));
    $r = $q->fetch();
    return $r ? dlRow($r) : null;
}
/** Why a message to the list address is not passed on at all ('' = it is a real message). */
function dlLoopWhy(array $L, array $m): string
{
    $h = (array) ($m['headers'] ?? []);
    $from = (string) ($m['from'][0] ?? '');
    if (!empty($h['x-se-list'])) {
        return 'a copy this list sent itself';
    }
    // the site's own copies: every one has a Message-ID like <token.campaign.mass@domain> (the site's sending address
    // can also be a person's own, e.g. an administrator writing to the list, so the address alone says nothing)
    if (preg_match('/\.mass@/i', (string) ($m['msgid'] ?? ''))) {
        return 'a copy the site sent itself';
    }
    if ($from === '' || ($L['addr'] !== '' && $from === $L['addr'])) {
        return 'sent from the list\'s own address';
    }
    $auto = strtolower(trim((string) ($h['auto-submitted'][0] ?? 'no')));
    if ($auto !== '' && $auto !== 'no') {
        return 'an automatic message (' . $auto . ')';
    }
    if (!empty($h['x-autoreply']) || !empty($h['x-autorespond']) || preg_match('/^(bulk|junk|auto_reply)$/', strtolower(trim((string) ($h['precedence'][0] ?? ''))))) {
        return 'an automatic reply';
    }
    if (preg_match('/^(mailer-daemon|postmaster)@/i', $from)) {
        return 'a delivery report';
    }
    if (preg_match('/^(auto(matic)?[ -]?reply|out of (the )?office|undeliver(able|ed)|delivery status notification|returned mail)/i', (string) ($m['subject'] ?? ''))) {
        return 'an automatic reply or delivery report';
    }
    return '';
}
/**
 * v83: whether the server that received the message vouches for its From address: the topmost Authentication-Results
 * (added by the list's mail server: Gmail, Microsoft 365, most cPanel servers) reports dmarc=pass for the From's own
 * domain. A From header proves nothing by itself, so mail without this waits for an administrator like a stranger's.
 */
function dlSenderVouched(array $h, string $from): bool
{
    $at = strrpos($from, '@');
    $dom = $at === false ? '' : rtrim(strtolower(substr($from, $at + 1)), '.');
    $ar = strtolower((string) ($h['authentication-results'][0] ?? ''));
    if ($dom === '' || $ar === '') {
        return false;
    }
    // quoted strings and (comments) can carry the sender's own text (a quoted envelope address with ';' in it): drop them
    $ar = (string) preg_replace('/"(?:[^"\\\\]|\\\\.)*"/', ' ', $ar);
    for ($i = 0; $i < 5 && str_contains($ar, '('); $i++) {
        $ar = (string) preg_replace('/\([^()]*\)/', ' ', $ar);
    }
    if (preg_match('/[()"]/', $ar)) {
        return false;
    }
    // the first part is the checking server's name; then one result per method ("dmarc=pass ... header.from=domain")
    foreach (array_slice(explode(';', $ar), 1) as $part) {
        if (preg_match('/^\s*dmarc\s*=\s*([a-z]+)/', $part, $mm)) {
            return $mm[1] === 'pass' && preg_match('/\bheader\.from\s*=\s*"?([a-z0-9.-]+)/', $part, $hf) === 1 && rtrim($hf[1], '.') === $dom;
        }
    }
    return false;
}
/**
 * One message that reached a list's address. $m: from [email, name], subject, text, html, files [[name, type, data]],
 * headers, msgid. Relayed, held for an administrator, or dropped; returns ['st', 'why', 'id', 'n'].
 */
function dlInbound(array $L, array $m): array
{
    $pdo = dlDb();
    $from = strtolower((string) ($m['from'][0] ?? ''));
    $fromN = trim((string) ($m['from'][1] ?? ''));
    $subject = trim((string) ($m['subject'] ?? '')) ?: '(no subject)';
    $msgid = mb_substr(trim((string) ($m['msgid'] ?? '')), 0, 300);
    if ($msgid === '') {
        $msgid = 'h:' . substr(hash('sha256', $from . '|' . $subject . '|' . (string) ($m['headers']['date'][0] ?? '') . '|' . mb_substr((string) ($m['text'] ?? ''), 0, 500)), 0, 40);
    }
    // the same message twice (a mailbox read again after a lost connection, a provider retry) is passed on once
    $seen = $pdo->prepare('SELECT id, st FROM mail_list_msgs WHERE list = ? AND msgid = ?');
    $seen->execute([$L['id'], $msgid]);
    if ($row = $seen->fetch()) {
        return ['st' => 'duplicate', 'why' => 'already received', 'id' => (string) $row['id'], 'n' => 0];
    }
    $text = trim((string) ($m['text'] ?? ''));
    $mid = rid(6);
    $save = function (string $st, string $why, array $atts = [], string $camp = '', int $n = 0, ?array $poster = null) use ($pdo, $L, $mid, $from, $fromN, $subject, &$text, $msgid) {
        $pdo->prepare('INSERT INTO mail_list_msgs (id, list, at, dir, from_email, from_name, subject, body, atts, st, why, campaign, n, msgid, by_uid, by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
            ->execute([$mid, $L['id'], now(), 'in', mb_substr($from, 0, 190), mb_substr($fromN, 0, 190), mb_substr($subject, 0, 300), mb_substr($text, 0, 60000), json_encode($atts, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), $st, mb_substr($why, 0, 300), $camp, $n, $msgid, (string) ($poster['id'] ?? ''), mb_substr((string) ($poster['name'] ?? ''), 0, 190)]);
        return ['st' => $st, 'why' => $why, 'id' => $mid, 'n' => $n];
    };
    $loop = dlLoopWhy($L, $m);
    if ($loop !== '') {
        return $save('dropped', $loop);
    }
    // attachments: the inbound screening first (programs, scripts, macro files, viruses), then kept for the relay
    $files = [];
    $removed = [];
    $total = 0;
    require_once __DIR__ . '/guard.php';
    foreach (array_slice((array) ($m['files'] ?? []), 0, 10) as $f) {
        [$fname, $ftype, $data] = [(string) $f[0], (string) $f[1], (string) $f[2]];
        $ext = strtolower(pathinfo($fname, PATHINFO_EXTENSION));
        if ($ext === '' && $ftype === 'message/rfc822') {
            $fname .= '.eml';
            $ext = 'eml';
        }
        $tmp = (string) tempnam(sys_get_temp_dir(), 'dl');
        @file_put_contents($tmp, $data);
        $why = guardInbound($tmp, $fname);
        if ($why === '' && !isset(MIME[$ext]) && $ext !== 'eml') {
            $why = 'not a document or picture';
        }
        if ($why === '' && ($total + strlen($data) > 15 * 1048576 || count($files) >= 5)) {
            $why = 'over the 15 MB / 5 file limit of a list email';
        }
        if ($why !== '') {
            @unlink($tmp);
            $removed[] = $fname . ' (' . $why . ')';
            continue;
        }
        $total += strlen($data);
        $files[] = ['name' => preg_replace('/[^A-Za-z0-9._ -]+/', '_', $fname) ?: 'file.' . $ext, 'type' => MIME[$ext] ?? 'message/rfc822', 'tmp' => $tmp];
    }
    if ($removed) {
        $text = '[Removed by the security check: ' . implode('; ', $removed) . ".]\n\n" . $text;
    }
    // who wrote: a portal account (they may send to this list), a member, or someone else
    // v83: the From address counts only when the receiving mail server confirmed it (DMARC pass); a forged From of a
    // staff address or a member is held like anyone else's, and is not recorded under that person's name
    $poster = null;
    $claimed = null;
    $vouched = dlSenderVouched((array) ($m['headers'] ?? []), $from);
    $q = db()->prepare("SELECT id, email, name, role, status, access FROM users WHERE email = ? AND status = 'active'");
    $q->execute([$from]);
    if ($u = $q->fetch()) {
        if ($vouched) {
            $poster = $u;
        } else {
            $claimed = $u;
        }
    }
    $mayPost = $poster && dlMaySend($L, $poster);
    $recips = dlRecipients($L);
    if (!$mayPost && $vouched && $L['post'] === 'members' && isset($recips[$from])) {
        $mayPost = true;
    }
    if (!$mayPost && $L['post'] === 'anyone') {
        $mayPost = true;
    }
    $keep = function () use ($files, $mid): array {
        // a held message keeps its files until an administrator decides (14 days)
        $dir = rtrim((string) cfg('files_dir'), '/') . '/dlheld/' . $mid;
        $out = [];
        foreach ($files as $i => $f) {
            if (!is_dir($dir)) {
                @mkdir($dir, 0770, true);
            }
            $p = $dir . '/' . $i . '-' . $f['name'];
            if (@rename($f['tmp'], $p) || (@copy($f['tmp'], $p) && @unlink($f['tmp']))) {
                $out[] = ['name' => $f['name'], 'type' => $f['type'], 'file' => $p];
            }
        }
        return $out;
    };
    if ($L['status'] !== 'active') {
        $r = $save('held', 'the list is paused', $keep(), '', 0, $poster);
        dlTellHeld($L, $r['id'], $from, $subject, 'the list is paused');
        return $r;
    }
    if (!$mayPost) {
        $why = $poster ? $poster['name'] . ' is not among the people who may send to this list'
            : ($claimed || ($L['post'] === 'members' && isset($recips[$from]))
                ? 'the mail server did not confirm it really came from ' . $from . ' (no DMARC pass)'
                : $from . ' may not write to this list');
        $r = $save('held', $why, $keep(), '', 0, $poster);
        dlTellHeld($L, $r['id'], $from, $subject, $why);
        return $r;
    }
    $hour = $pdo->prepare("SELECT COUNT(*) FROM mail_list_msgs WHERE list = ? AND dir = 'in' AND st = 'relayed' AND at > ?");
    $hour->execute([$L['id'], now() - 3600000]);
    if ((int) $hour->fetchColumn() >= DL_RELAY_HOUR) {
        $r = $save('held', 'more than ' . DL_RELAY_HOUR . ' messages to the list in an hour', $keep(), '', 0, $poster);
        dlTellHeld($L, $r['id'], $from, $subject, 'too many messages in an hour');
        return $r;
    }
    unset($recips[$from]);
    if (!$recips) {
        foreach ($files as $f) {
            @unlink($f['tmp']);
        }
        return $save('dropped', 'nobody on the list to send it to', [], '', 0, $poster);
    }
    $r = dlRelay($L, $mid, $from, $fromN, $subject, $text, $files, $recips, $poster);
    return $save('relayed', '', [], $r['campaign'], $r['n'], $poster);
}
/** Queues a message to the list's members as a campaign (each gets their own copy, under "Sender via List"). */
function dlRelay(array $L, string $mid, string $from, string $fromN, string $subject, string $text, array $files, array $recips, ?array $poster): array
{
    $cid = rid(8);
    $dir = rtrim((string) cfg('files_dir'), '/') . '/mail/' . $cid;
    $atts = [];
    foreach ($files as $i => $f) {
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        $p = $dir . '/' . $i . '-' . $f['name'];
        $src = (string) ($f['tmp'] ?? ($f['file'] ?? ''));
        if ($src !== '' && (@rename($src, $p) || (@copy($src, $p) && @unlink($src)))) {
            $atts[] = ['name' => $f['name'], 'type' => $f['type'], 'file' => $p];
        }
    }
    $prefix = trim($L['prefix']);
    if ($prefix !== '' && stripos($subject, $prefix) === false) {
        $subject = $prefix . ' ' . $subject;
    }
    $who = $fromN !== '' ? $fromN : (string) strstr($from, '@', true);
    $reply = $L['reply'] === 'list' && $L['addr'] !== '' ? $L['addr'] : ($L['reply'] === 'fixed' && $L['replyTo'] !== '' ? $L['replyTo'] : $from);
    $msg = [
        'subject' => mb_substr($subject, 0, 250),
        'body' => mb_substr($text !== '' ? $text : '(no text)', 0, 20000),
        'btnText' => '', 'btnUrl' => '',
        'fromName' => mb_substr($who . ' via ' . ($L['fromName'] !== '' ? $L['fromName'] : $L['name']), 0, 100),
        'replyTo' => $reply,
        'aud' => ['lists' => [$L['id']]],
    ];
    $owner = $poster ? ['id' => (string) $poster['id'], 'name' => (string) $poster['name']] : ['id' => 'dl:' . $L['id'], 'name' => $L['name'] . ' (list address)'];
    mailCampaignQueue($owner, $msg, array_values($recips), $atts, 'List ' . $L['name'] . ': message from ' . $from, ['dl' => $L['id'], 'dlMsg' => $mid], $cid, ['dl' => ['id' => $L['id'], 'from' => $from]]);
    dlDb()->prepare('UPDATE mail_lists SET sent = sent + 1, last_sent = ? WHERE id = ?')->execute([now(), $L['id']]);
    return ['campaign' => $cid, 'n' => count($recips)];
}
/** Administrators and HR hear about a held message (a task; an email at most once an hour per list). */
function dlTellHeld(array $L, string $mid, string $from, string $subject, string $why): void
{
    try {
        $title = 'Held for review on the ' . $L['name'] . ' list: ' . mb_substr($subject, 0, 80);
        $detail = 'A message from ' . $from . ' to the list\'s address waits for you (' . $why . '). Email › Lists › ' . $L['name'] . ' › Held.';
        $email = !throttleHit('dlheld:' . $L['id'], 1, 3600);
        $tid = rid(6);
        foreach (db()->query("SELECT id, email, name, role, status, access FROM users WHERE status = 'active'")->fetchAll() as $a) {
            if (!dlManager($a)) {
                continue;
            }
            $r = docGet('r/' . $a['id']) ?? new stdClass();
            if (!isset($r->tasks) || !($r->tasks instanceof stdClass)) {
                $r->tasks = new stdClass();
            }
            $r->tasks->$tid = (object) ['ti' => mb_substr($title, 0, 160), 'd' => $detail, 'due' => date('Y-m-d', time() + 86400), 'p' => 'normal', 'at' => now(), 'by' => 'Distribution lists'];
            docSet('r/' . $a['id'], $r);
            if ($email && hasRole($a, 'admin')) {
                $link = siteUrl() . '#/portal/admin/mail?tab=lists&dl=' . $L['id'];
                sendMail((string) $a['email'], (string) $a['name'], $title, $detail . "\n\n" . $link, emailHtml($title, [$detail], ['Review it', $link]));
            }
        }
    } catch (Throwable $e) {
        mailLog('Held-message notice failed: ' . $e->getMessage());
    }
}

/* ---------- the list's mailbox (IMAP) ---------- */
function dlImapOut(array $im): array
{
    return [
        'on' => !empty($im['on']), 'host' => (string) ($im['host'] ?? ''), 'port' => (int) ($im['port'] ?? 993), 'sec' => (string) ($im['sec'] ?? 'ssl'),
        'user' => (string) ($im['user'] ?? ''), 'folder' => (string) ($im['folder'] ?? 'INBOX'), 'passSet' => (string) ($im['pass'] ?? '') !== '',
        'last' => (int) ($im['last'] ?? 0), 'lastOk' => (int) ($im['lastOk'] ?? 0), 'err' => (string) ($im['err'] ?? ''), 'n' => (int) ($im['n'] ?? 0),
    ];
}
function dlImapSet(string $id, array $im): void
{
    dlDb()->prepare('UPDATE mail_lists SET imap = ?, updated = ? WHERE id = ?')->execute([json_encode($im, JSON_UNESCAPED_SLASHES), now(), $id]);
}
/** Reads new mail in a list's mailbox and passes it on. One reader at a time per list. */
function dlPoll(array $L, int $max = 20): array
{
    $im = $L['imap'];
    if (empty($im['host']) || empty($im['user']) || empty($im['pass'])) {
        return ['ok' => false, 'err' => 'The mailbox is not set up.', 'n' => 0];
    }
    $lockF = rtrim((string) cfg('files_dir'), '/') . '/dl-' . $L['id'] . '.lock';
    $lk = @fopen($lockF, 'c');
    if ($lk && !flock($lk, LOCK_EX | LOCK_NB)) {
        fclose($lk);
        return ['ok' => true, 'busy' => true, 'n' => 0, 'err' => ''];
    }
    $n = 0;
    $res = ['relayed' => 0, 'held' => 0, 'dropped' => 0, 'duplicate' => 0];
    $err = '';
    $c = null;
    try {
        $c = new SeImap((string) $im['host'], (int) ($im['port'] ?? 993), (string) ($im['sec'] ?? 'ssl'), 20);
        $c->login((string) $im['user'], secUnseal((string) $im['pass']));
        $c->select((string) (($im['folder'] ?? '') ?: 'INBOX'));
        foreach (array_slice($c->unseen(), 0, $max) as $uid) {
            $size = $c->size($uid);
            if ($size > DL_MAX_MB * 1048576) {
                // too large to pass on: noted (and left read in the mailbox)
                dlDb()->prepare('INSERT INTO mail_list_msgs (id, list, at, dir, from_email, from_name, subject, body, atts, st, why, campaign, n, msgid, by_uid, by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
                    ->execute([rid(6), $L['id'], now(), 'in', '', '', 'A message of ' . round($size / 1048576, 1) . ' MB in the mailbox', '', '[]', 'dropped', 'over ' . DL_MAX_MB . ' MB: open it in the mailbox itself', '', 0, 'big:' . $uid . ':' . $size, '', '']);
                $c->markSeen($uid);
                $res['dropped']++;
                continue;
            }
            $r = dlInbound($L, mimeParse($c->fetch($uid)));
            $res[$r['st']] = ($res[$r['st']] ?? 0) + 1;
            $c->markSeen($uid);
            $n++;
        }
    } catch (Throwable $e) {
        $err = $e->getMessage();
    } finally {
        if ($c) {
            $c->close();
        }
        if ($lk) {
            flock($lk, LOCK_UN);
            fclose($lk);
        }
    }
    $fresh = dlGet($L['id']);
    if ($fresh) {
        $im2 = $fresh['imap'];
        $im2['last'] = now();
        $im2['err'] = mb_substr($err, 0, 300);
        if ($err === '') {
            $im2['lastOk'] = now();
            $im2['n'] = (int) ($im2['n'] ?? 0) + $n;
        }
        dlImapSet($L['id'], $im2);
    }
    return ['ok' => $err === '', 'err' => $err, 'n' => $n] + $res;
}
/** The scheduled task: every list's mailbox, then old held and dropped messages cleared. */
function dlCron(int $budgetMs = 60000): array
{
    $t0 = now();
    $out = ['polled' => 0, 'relayed' => 0, 'held' => 0, 'errors' => 0, 'cleared' => 0];
    foreach (dlDb()->query("SELECT * FROM mail_lists WHERE status = 'active'")->fetchAll() as $r) {
        $L = dlRow($r);
        if (empty($L['imap']['on'])) {
            continue;
        }
        if (now() - $t0 > $budgetMs) {
            break;
        }
        $p = dlPoll($L);
        $out['polled']++;
        $out['relayed'] += (int) ($p['relayed'] ?? 0);
        $out['held'] += (int) ($p['held'] ?? 0);
        $out['errors'] += $p['ok'] ? 0 : 1;
    }
    // held messages nobody decided on go after 14 days (with their files); dropped ones after 30
    $old = dlDb()->prepare("SELECT id, atts FROM mail_list_msgs WHERE (st = 'held' AND at < ?) OR (st = 'dropped' AND at < ?)");
    $old->execute([now() - 14 * 86400000, now() - 30 * 86400000]);
    foreach ($old->fetchAll() as $m) {
        foreach (json_decode((string) $m['atts'], true) ?: [] as $a) {
            @unlink((string) ($a['file'] ?? ''));
        }
        @rmdir(rtrim((string) cfg('files_dir'), '/') . '/dlheld/' . $m['id']);
        dlDb()->prepare('DELETE FROM mail_list_msgs WHERE id = ?')->execute([$m['id']]);
        $out['cleared']++;
    }
    return $out;
}

/* ---------- what the pages see ---------- */
function dlOut(array $L, bool $mgr): array
{
    $o = [
        'id' => $L['id'], 'name' => $L['name'], 'descr' => $L['descr'], 'addr' => $L['addr'], 'fromName' => $L['fromName'], 'reply' => $L['reply'], 'replyTo' => $L['replyTo'],
        'prefix' => $L['prefix'], 'status' => $L['status'], 'reach' => $L['reach'], 'reachAt' => $L['reachAt'], 'sent' => $L['sent'], 'lastSent' => $L['lastSent'],
        'ruleText' => dlRuleText($L['rule']),
    ];
    if ($mgr) {
        $o += ['senders' => $L['senders'], 'post' => $L['post'], 'rule' => $L['rule'], 'imap' => dlImapOut($L['imap']), 'created' => $L['created'], 'updated' => $L['updated'], 'byn' => $L['byn']];
    }
    return $o;
}
/** Lists this person may send to (New email and Share requirements show them). */
function dlForSender(array $u): array
{
    $out = [];
    foreach (dlDb()->query("SELECT * FROM mail_lists WHERE status = 'active' ORDER BY name")->fetchAll() as $r) {
        $L = dlRow($r);
        if (dlMaySend($L, $u)) {
            $out[] = ['id' => $L['id'], 'name' => $L['name'], 'descr' => $L['descr'], 'n' => $L['reach'], 'addr' => $L['addr'], 'fromName' => $L['fromName'] !== '' ? $L['fromName'] : $L['name'], 'reply' => $L['reply'], 'replyTo' => $L['reply'] === 'list' ? $L['addr'] : ($L['reply'] === 'fixed' ? $L['replyTo'] : '')];
        }
    }
    return $out;
}
function dlMemberSearch(string $listId, string $q, string $kind, string $st, int $limit = 200, int $off = 0): array
{
    $sql = 'SELECT email, name, company, title, kind, src, st, added, left_at FROM mail_list_members WHERE list = ?';
    $args = [$listId];
    if ($q !== '') {
        $sql .= ' AND (LOWER(email) LIKE ? OR LOWER(name) LIKE ? OR LOWER(company) LIKE ?)';
        $like = '%' . mb_strtolower($q) . '%';
        array_push($args, $like, $like, $like);
    }
    if ($kind !== '' && isset(DL_KINDS[$kind])) {
        $sql .= ' AND kind = ?';
        $args[] = $kind;
    }
    if (in_array($st, ['in', 'left'], true)) {
        $sql .= ' AND st = ?';
        $args[] = $st;
    }
    $cnt = dlDb()->prepare(str_replace('SELECT email, name, company, title, kind, src, st, added, left_at', 'SELECT COUNT(*)', $sql));
    $cnt->execute($args);
    $total = (int) $cnt->fetchColumn();
    $sql .= ' ORDER BY name, email LIMIT ' . max(1, min(500, $limit)) . ' OFFSET ' . max(0, $off);
    $s = dlDb()->prepare($sql);
    $s->execute($args);
    $sup = mailSuppressed();
    $rows = array_map(fn($m) => ['email' => (string) $m['email'], 'name' => (string) $m['name'], 'company' => (string) $m['company'], 'title' => (string) $m['title'], 'kind' => (string) $m['kind'], 'src' => (string) $m['src'], 'st' => (string) $m['st'], 'added' => (int) $m['added'], 'leftAt' => (int) $m['left_at'], 'unsub' => isset($sup[(string) $m['email']])], $s->fetchAll());
    return ['rows' => $rows, 'total' => $total];
}
/** People to add, from the portal's own records. */
function dlPick(string $src, string $q): array
{
    $q = mb_strtolower(trim($q));
    $hit = fn(string ...$s) => $q === '' || str_contains(mb_strtolower(implode(' ', $s)), $q);
    $out = [];
    $push = function (string $e, string $n, string $co, string $ti, string $kind, string $from) use (&$out) {
        $e = strtolower(trim($e));
        if (filter_var($e, FILTER_VALIDATE_EMAIL) && !isset($out[$e])) {
            $out[$e] = ['email' => $e, 'name' => $n, 'company' => $co, 'title' => $ti, 'kind' => $kind, 'src' => $from];
        }
    };
    if ($src === 'vendors') {
        foreach (docsIn('vms/vendor/items') as $v) {
            $type = (string) ($v->type ?? 'Prime vendor');
            $kind = stripos($type, 'client') !== false ? 'client' : 'vendor';
            foreach ((array) ($v->contacts ?? []) as $c) {
                $c = (object) $c;
                if ($hit((string) ($v->n ?? ''), (string) ($c->n ?? ''), (string) ($c->e ?? ''), $type)) {
                    $push((string) ($c->e ?? ''), (string) ($c->n ?? ''), (string) ($v->n ?? ''), (string) ($c->ti ?? ''), $kind, 'Vendors & clients · ' . $type);
                }
            }
        }
    } elseif ($src === 'team' || $src === 'consultants') {
        $m = mailMembers();
        foreach ($src === 'team' ? $m['employees'] : $m['consultants'] as $p) {
            if ($hit($p['name'], $p['email'], $p['company'], $p['title'])) {
                $push($p['email'], $p['name'], $p['company'], $p['title'], $src === 'team' ? 'team' : 'consultant', $src === 'team' ? 'Team' : 'Consultants in the portal');
            }
        }
        if ($src === 'consultants') {
            foreach (docsIn('rec/cand/items') as $c) {
                if ($hit((string) ($c->n ?? ''), (string) ($c->e ?? ''), (string) ($c->ti ?? ''))) {
                    $push((string) ($c->e ?? ''), (string) ($c->n ?? ''), '', (string) ($c->ti ?? ''), 'consultant', 'Consultant database');
                }
            }
        }
    } elseif ($src === 'candidates') {
        foreach (docsIn('ats') as $id => $c) {
            if ((string) $id === 'x') {
                continue;
            }
            if ($hit((string) ($c->n ?? ''), (string) ($c->e ?? ''), (string) ($c->jt ?? ''))) {
                $push((string) ($c->e ?? ''), (string) ($c->n ?? ''), '', (string) ($c->jt ?? ''), 'candidate', 'ATS');
            }
        }
    } elseif ($src === 'contacts') {
        $s = mdb()->prepare('SELECT email, name, company, title FROM mail_contacts' . ($q !== '' ? ' WHERE LOWER(email) LIKE ? OR LOWER(name) LIKE ? OR LOWER(company) LIKE ?' : '') . ' ORDER BY name LIMIT 400');
        $s->execute($q !== '' ? ['%' . $q . '%', '%' . $q . '%', '%' . $q . '%'] : []);
        foreach ($s as $c) {
            $push((string) $c['email'], (string) $c['name'], (string) $c['company'], (string) $c['title'], 'contact', 'Contacts');
        }
    }
    return array_slice(array_values($out), 0, 300);
}

/* ---------- routes ---------- */
function dlRoute(string $r, array $b): never
{
    $u = requireUser();
    if (!mailCanUse($u)) {
        fail(403, 'forbidden', 'Email is not switched on for your account. Ask an administrator.');
    }
    $mgr = dlManager($u);
    $need = function () use ($mgr) {
        if (!$mgr) {
            fail(403, 'forbidden', 'Administrators and HR make and change distribution lists.');
        }
    };
    $list = function () use ($b): array {
        $L = dlGet((string) ($b['id'] ?? ''));
        if (!$L) {
            fail(404, 'not_found', 'No such list.');
        }
        return $L;
    };
    switch ($r) {
        case 'dl_lists': {
            $rows = [];
            foreach (dlDb()->query("SELECT * FROM mail_lists WHERE status <> 'archived' ORDER BY name")->fetchAll() as $row) {
                $L = dlRow($row);
                if ($mgr || dlMaySend($L, $u)) {
                    $o = dlOut($L, $mgr);
                    if ($mgr) {
                        $h = dlDb()->prepare("SELECT COUNT(*) FROM mail_list_msgs WHERE list = ? AND st = 'held'");
                        $h->execute([$L['id']]);
                        $o['held'] = (int) $h->fetchColumn();
                        $m = dlDb()->prepare("SELECT COUNT(*) FROM mail_list_members WHERE list = ? AND st = 'in'");
                        $m->execute([$L['id']]);
                        $o['members'] = (int) $m->fetchColumn();
                    }
                    $rows[] = $o;
                }
            }
            ok(['rows' => $rows, 'manager' => $mgr, 'kinds' => DL_KINDS, 'roles' => DL_ROLES, 'post' => DL_POST, 'reply' => DL_REPLY, 'team' => $mgr ? array_values(array_map(fn($x) => ['id' => (string) $x['id'], 'name' => (string) $x['name'], 'email' => (string) $x['email']], array_filter(db()->query("SELECT id, email, name, role, status, access FROM users WHERE status = 'active' ORDER BY name")->fetchAll(), fn($x) => mailCanUse($x)))) : []]);
        }
        case 'dl_get': {
            $L = $list();
            if (!$mgr && !dlMaySend($L, $u)) {
                fail(403, 'forbidden', 'This list is not one you send to.');
            }
            $out = ['list' => dlOut($L, $mgr), 'reach' => dlReach($L)];
            $msgs = dlDb()->prepare('SELECT id, at, dir, from_email, from_name, subject, st, why, campaign, n, by_name, atts FROM mail_list_msgs WHERE list = ?' . ($mgr ? '' : " AND dir = 'out'") . ' ORDER BY at DESC LIMIT 100');
            $msgs->execute([$L['id']]);
            $out['msgs'] = array_map(fn($m) => ['id' => (string) $m['id'], 'at' => (int) $m['at'], 'dir' => (string) $m['dir'], 'from' => (string) $m['from_email'], 'fromN' => (string) $m['from_name'], 'subject' => (string) $m['subject'], 'st' => (string) $m['st'], 'why' => (string) $m['why'], 'campaign' => (string) $m['campaign'], 'n' => (int) $m['n'], 'byn' => (string) $m['by_name'], 'files' => array_map(fn($a) => (string) ($a['name'] ?? ''), json_decode((string) $m['atts'], true) ?: [])], $msgs->fetchAll());
            ok($out);
        }
        case 'dl_save': {
            // a new list, or a change to an existing one (fields left out keep their value: each tab saves its own)
            $need();
            $id = (string) ($b['id'] ?? '');
            $L = $id !== '' ? $list() : null;
            $cur = $L ?? ['name' => '', 'descr' => '', 'addr' => '', 'fromName' => '', 'reply' => 'sender', 'replyTo' => '', 'prefix' => '', 'senders' => ['roles' => ['everyone'], 'uids' => []], 'post' => 'senders', 'rule' => [], 'status' => 'active'];
            $v = fn(string $k) => array_key_exists($k, $b) ? $b[$k] : $cur[$k];
            $name = trim(mb_substr((string) $v('name'), 0, 120));
            if (mb_strlen($name) < 2) {
                fail(400, 'invalid_argument', 'Give the list a name.');
            }
            $addr = strtolower(trim((string) $v('addr')));
            if ($addr !== '' && !filter_var($addr, FILTER_VALIDATE_EMAIL)) {
                fail(400, 'invalid_argument', 'The list\'s address is not a valid email address.');
            }
            if ($addr !== '') {
                $dup = dlDb()->prepare("SELECT name FROM mail_lists WHERE addr = ? AND id <> ? AND status <> 'archived'");
                $dup->execute([$addr, $id]);
                if ($n = $dup->fetchColumn()) {
                    fail(409, 'invalid_argument', $addr . ' is already the address of the list "' . $n . '".');
                }
                $own = strtolower((string) (mailSettings()['from'] ?? ''));
                if ($own !== '' && $addr === $own) {
                    fail(400, 'invalid_argument', 'Use an address of its own for the list, not the one the site sends from (' . $own . ').');
                }
            }
            $reply = (string) $v('reply');
            $reply = isset(DL_REPLY[$reply]) ? $reply : 'sender';
            $replyTo = strtolower(trim((string) $v('replyTo')));
            if ($reply === 'fixed' && !filter_var($replyTo, FILTER_VALIDATE_EMAIL)) {
                fail(400, 'invalid_argument', 'Give the address replies should go to.');
            }
            if ($reply === 'list' && $addr === '') {
                fail(400, 'invalid_argument', 'Replies can go to the list\'s address once the list has one.');
            }
            $senders = (array) $v('senders');
            $sJson = json_encode(['roles' => array_values(array_intersect(array_keys(DL_ROLES), array_map('strval', (array) ($senders['roles'] ?? [])))), 'uids' => array_values(array_slice(array_filter(array_map('strval', (array) ($senders['uids'] ?? [])), fn($x) => (bool) preg_match('/^u_[a-f0-9]+$/', $x)), 0, 200))]);
            $post = (string) $v('post');
            $post = isset(DL_POST[$post]) ? $post : 'senders';
            $status = in_array((string) $v('status'), ['active', 'paused'], true) ? (string) $v('status') : 'active';
            $rule = json_encode(dlRuleClean(is_array($v('rule')) ? $v('rule') : []), JSON_UNESCAPED_UNICODE);
            $vals = [$name, trim(mb_substr((string) $v('descr'), 0, 500)), $addr, trim(mb_substr((string) $v('fromName'), 0, 120)), $reply, $reply === 'fixed' ? $replyTo : '', trim(mb_substr((string) $v('prefix'), 0, 40)), $sJson, $post, $rule, $status, now()];
            if ($L) {
                dlDb()->prepare('UPDATE mail_lists SET name = ?, descr = ?, addr = ?, from_name = ?, reply = ?, reply_to = ?, prefix = ?, senders = ?, post = ?, rule_json = ?, status = ?, updated = ? WHERE id = ?')->execute([...$vals, $L['id']]);
                $id = $L['id'];
                audit('settings', 'Distribution list changed', $id, ['name' => $name, 'addr' => $addr, 'status' => $status, 'fields' => array_values(array_intersect(array_keys($b), ['name', 'descr', 'addr', 'fromName', 'reply', 'replyTo', 'prefix', 'senders', 'post', 'rule', 'status']))], $u);
            } else {
                $id = rid(6);
                dlDb()->prepare("INSERT INTO mail_lists (name, descr, addr, from_name, reply, reply_to, prefix, senders, post, rule_json, status, updated, id, imap, reach, reach_at, sent, last_sent, created, by_uid, by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'{}',0,0,0,0,?,?,?)")->execute([...$vals, $id, now(), (string) $u['id'], (string) $u['name']]);
                audit('settings', 'Distribution list made', $id, ['name' => $name, 'addr' => $addr], $u);
            }
            $L = dlGet($id);
            dlReach($L);
            ok(['list' => dlOut(dlGet($id), true)]);
        }
        case 'dl_delete': {
            $need();
            $L = $list();
            if ((string) ($b['confirm'] ?? '') !== $L['name']) {
                fail(400, 'invalid_argument', 'Type the list\'s name to confirm.');
            }
            foreach (['DELETE FROM mail_list_members WHERE list = ?', 'DELETE FROM mail_list_msgs WHERE list = ?', 'DELETE FROM mail_lists WHERE id = ?'] as $sql) {
                dlDb()->prepare($sql)->execute([$L['id']]);
            }
            audit('settings', 'Distribution list deleted', $L['id'], ['name' => $L['name']], $u);
            ok(['ok' => true]);
        }
        case 'dl_members': {
            $need();
            $L = $list();
            ok(dlMemberSearch($L['id'], trim(mb_substr((string) ($b['q'] ?? ''), 0, 80)), (string) ($b['kind'] ?? ''), (string) ($b['st'] ?? ''), (int) ($b['limit'] ?? 200), (int) ($b['off'] ?? 0)));
        }
        case 'dl_members_add': {
            $need();
            $L = $list();
            $rows = [];
            foreach (array_slice((array) ($b['members'] ?? []), 0, DL_MAX_MEMBERS) as $m) {
                if (is_array($m)) {
                    $rows[] = $m;
                }
            }
            if (trim((string) ($b['paste'] ?? '')) !== '') {
                $kind = isset(DL_KINDS[(string) ($b['kind'] ?? '')]) ? (string) $b['kind'] : 'other';
                foreach (mailParseList(mb_substr((string) $b['paste'], 0, 400000)) as $p) {
                    $rows[] = ['email' => $p['email'], 'name' => $p['name'], 'kind' => $kind, 'src' => 'Pasted'];
                }
            }
            if (!$rows) {
                fail(400, 'invalid_argument', 'Nobody to add.');
            }
            $res = dlAddMembers($L, $rows, $u);
            audit('settings', 'Distribution list members added', $L['id'], ['n' => $res['added']], $u);
            ok($res + ['reach' => dlReach($L)]);
        }
        case 'dl_members_remove': {
            $need();
            $L = $list();
            $emails = array_values(array_filter(array_map(fn($e) => strtolower(trim((string) $e)), array_slice((array) ($b['emails'] ?? []), 0, 5000))));
            $n = 0;
            foreach (array_chunk($emails, 400) as $ch) {
                $d = dlDb()->prepare("DELETE FROM mail_list_members WHERE list = ? AND st = 'in' AND email IN (" . implode(',', array_fill(0, count($ch), '?')) . ')');
                $d->execute(array_merge([$L['id']], $ch));
                $n += $d->rowCount();
            }
            audit('settings', 'Distribution list members removed', $L['id'], ['n' => $n], $u);
            ok(['removed' => $n, 'reach' => dlReach($L)]);
        }
        case 'dl_member_back': {
            // someone who left asked to be on the list again (only on their request)
            $need();
            $L = $list();
            $e = strtolower(trim((string) ($b['email'] ?? '')));
            $q = dlDb()->prepare("UPDATE mail_list_members SET st = 'in', left_at = 0 WHERE list = ? AND email = ? AND st = 'left'");
            $q->execute([$L['id'], $e]);
            if ($q->rowCount() !== 1) {
                fail(404, 'not_found', 'They are not among the people who left this list.');
            }
            audit('settings', 'Distribution list: a member who left was added back on request', $L['id'], ['email' => $e], $u);
            ok(['ok' => true, 'reach' => dlReach($L)]);
        }
        case 'dl_pick': {
            $need();
            $src = (string) ($b['src'] ?? '');
            if (!in_array($src, ['vendors', 'team', 'consultants', 'candidates', 'contacts'], true)) {
                fail(400, 'invalid_argument', 'Choose where to add people from.');
            }
            ok(['rows' => dlPick($src, mb_substr((string) ($b['q'] ?? ''), 0, 80))]);
        }
        case 'dl_preview': {
            $need();
            $rule = dlRuleClean(is_array($b['rule'] ?? null) ? $b['rule'] : []);
            $aud = $rule ? mailAudience($rule, dlSystemUser()) : ['list' => []];
            ok(['n' => count($aud['list']), 'sample' => array_slice(array_map(fn($p) => $p['name'] !== '' ? $p['name'] . ' <' . $p['email'] . '>' : $p['email'], $aud['list']), 0, 6), 'text' => dlRuleText($rule)]);
        }
        case 'dl_export': {
            $need();
            $L = $list();
            $sup = mailSuppressed();
            $q = dlDb()->prepare('SELECT email, name, company, title, kind, st FROM mail_list_members WHERE list = ? ORDER BY name, email');
            $q->execute([$L['id']]);
            $csv = "email,name,company,title,kind,status\n";
            $n = 0;
            foreach ($q as $m) {
                // a spreadsheet must not run a cell that starts like a formula
                $cell = fn($v) => '"' . str_replace('"', '""', preg_match('/^[=+\-@\t\r]/', (string) $v) ? "'" . $v : (string) $v) . '"';
                $csv .= implode(',', array_map($cell, [$m['email'], $m['name'], $m['company'], $m['title'], DL_KINDS[$m['kind']] ?? $m['kind'], $m['st'] === 'left' ? 'left the list' : (isset($sup[$m['email']]) ? 'unsubscribed' : 'member')])) . "\n";
                $n++;
            }
            audit('data', 'Distribution list exported', $L['id'], ['n' => $n], $u);
            ok(['csv' => $csv, 'name' => preg_replace('/[^A-Za-z0-9-]+/', '-', strtolower($L['name'])) . '-members.csv']);
        }
        case 'dl_imap_save': {
            $need();
            $L = $list();
            // a mailbox password: a recent sign-in, like the other connections to outside services
            requireRecentAuth();
            $host = strtolower(trim((string) ($b['host'] ?? '')));
            $port = (int) ($b['port'] ?? 993);
            $sec = in_array((string) ($b['sec'] ?? 'ssl'), ['ssl', 'tls', 'none'], true) ? (string) ($b['sec'] ?? 'ssl') : 'ssl';
            $user = trim(mb_substr((string) ($b['user'] ?? ''), 0, 190));
            $folder = trim(mb_substr((string) ($b['folder'] ?? 'INBOX'), 0, 120)) ?: 'INBOX';
            $on = !empty($b['on']);
            if ($on && ($host === '' || $user === '' || $port < 1 || $port > 65535)) {
                fail(400, 'invalid_argument', 'Give the mail server, its port and the mailbox\'s sign-in.');
            }
            if ($host !== '' && !preg_match('/^[a-z0-9.-]{1,253}$/', $host)) {
                fail(400, 'invalid_argument', 'The mail server name is not valid (for example mail.yourcompany.com).');
            }
            if ($sec === 'none' && !in_array($host, ['127.0.0.1', 'localhost'], true)) {
                fail(400, 'invalid_argument', 'Use SSL (port 993) or STARTTLS: a password must not cross the internet unprotected.');
            }
            $im = $L['imap'];
            $pass = (string) ($b['pass'] ?? '');
            // v83: the saved password only ever goes back to the server and sign-in it was given for; a new server, port, security or sign-in needs it again
            $same = (string) ($im['host'] ?? '') === $host && (int) ($im['port'] ?? 993) === $port && (string) ($im['sec'] ?? 'ssl') === $sec && strtolower((string) ($im['user'] ?? '')) === strtolower($user);
            $im = ['on' => $on, 'host' => $host, 'port' => $port, 'sec' => $sec, 'user' => $user, 'folder' => $folder, 'pass' => $pass !== '' ? secSeal($pass) : ($same ? (string) ($im['pass'] ?? '') : '')] + $im;
            if ($on && (string) $im['pass'] === '') {
                fail(400, 'invalid_argument', 'Give the mailbox\'s password (an app password for Gmail or Microsoft 365).');
            }
            dlImapSet($L['id'], $im);
            audit('settings', 'Distribution list mailbox ' . ($on ? 'connected' : 'switched off'), $L['id'], ['host' => $host, 'user' => $user], $u);
            ok(['imap' => dlImapOut($im)]);
        }
        case 'dl_imap_test': {
            $need();
            $L = $list();
            $im = $L['imap'];
            try {
                $c = new SeImap((string) ($im['host'] ?? ''), (int) ($im['port'] ?? 993), (string) ($im['sec'] ?? 'ssl'), 15);
                $c->login((string) ($im['user'] ?? ''), secUnseal((string) ($im['pass'] ?? '')));
                $n = $c->select((string) (($im['folder'] ?? '') ?: 'INBOX'));
                $un = count($c->unseen());
                $c->close();
                ok(['ok' => true, 'msg' => 'Connected: ' . $n . ' message' . ($n === 1 ? '' : 's') . ' in the folder, ' . $un . ' not read yet (they will be passed on at the next check).']);
            } catch (Throwable $e) {
                ok(['ok' => false, 'msg' => $e->getMessage()]);
            }
        }
        case 'dl_check': {
            $need();
            $L = $list();
            session_write_close();
            @set_time_limit(120);
            $p = dlPoll($L);
            if (!empty($p['relayed'])) {
                // what was passed on starts going out now
                mailRun(8000);
            }
            ok($p + ['imap' => dlImapOut(dlGet($L['id'])['imap'])]);
        }
        case 'dl_held': {
            $need();
            $L = $list();
            $q = dlDb()->prepare("SELECT * FROM mail_list_msgs WHERE id = ? AND list = ? AND st = 'held'");
            $q->execute([(string) ($b['mid'] ?? ''), $L['id']]);
            $m = $q->fetch();
            if (!$m) {
                fail(404, 'not_found', 'That message was decided already.');
            }
            $atts = json_decode((string) $m['atts'], true) ?: [];
            if ((string) ($b['act'] ?? '') === 'discard') {
                foreach ($atts as $a) {
                    @unlink((string) ($a['file'] ?? ''));
                }
                @rmdir(rtrim((string) cfg('files_dir'), '/') . '/dlheld/' . $m['id']);
                dlDb()->prepare("UPDATE mail_list_msgs SET st = 'discarded', why = ?, atts = '[]', by_uid = ?, by_name = ? WHERE id = ?")->execute(['discarded by ' . $u['name'], (string) $u['id'], (string) $u['name'], $m['id']]);
                audit('settings', 'Distribution list: held message discarded', $L['id'], ['from' => (string) $m['from_email']], $u);
                ok(['ok' => true]);
            }
            if ($L['status'] !== 'active') {
                fail(409, 'invalid_argument', 'Switch the list back on first.');
            }
            $recips = dlRecipients($L);
            unset($recips[(string) $m['from_email']]);
            if (!$recips) {
                fail(400, 'invalid_argument', 'Nobody is on the list to send it to.');
            }
            $files = array_map(fn($a) => ['name' => (string) $a['name'], 'type' => (string) $a['type'], 'file' => (string) $a['file']], $atts);
            $res = dlRelay($L, (string) $m['id'], (string) $m['from_email'], (string) $m['from_name'], (string) $m['subject'], (string) $m['body'], $files, $recips, null);
            @rmdir(rtrim((string) cfg('files_dir'), '/') . '/dlheld/' . $m['id']);
            dlDb()->prepare("UPDATE mail_list_msgs SET st = 'relayed', why = ?, campaign = ?, n = ?, atts = '[]' WHERE id = ?")->execute(['approved by ' . $u['name'], $res['campaign'], $res['n'], $m['id']]);
            audit('settings', 'Distribution list: held message approved', $L['id'], ['from' => (string) $m['from_email'], 'n' => $res['n']], $u);
            ok(['ok' => true, 'n' => $res['n']]);
        }
    }
    fail(404, 'not_found', 'Unknown action.');
}
