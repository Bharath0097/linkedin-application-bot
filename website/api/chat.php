<?php
declare(strict_types=1);
/*
 * v35: Team messaging (the Messages button at the top of every portal, and the Messages page).
 *
 *  - Direct messages between two people, group conversations (up to 50 people) and channels: public ones anyone they
 *    are meant for can find and join (#general for the team, #announcements for everyone, where only staff post), and
 *    private ones by invitation.
 *  - Messages: text with @mentions (a person, or @everyone in a group or channel), replies to a message, reactions,
 *    edits and deletes by the author (administrators can remove any channel message), files (encrypted at rest like
 *    every upload) and pins. Unread counts and read positions, mute, who is online and who is typing.
 *  - New messages arrive by polling (shared hosting has no websockets): every couple of seconds while a conversation
 *    is open, every half minute for the badge otherwise. Unread direct messages and mentions are emailed after a while
 *    to people who have not been back (once per message; muted conversations never).
 *  - Who may use it (Messages > Settings, administrators): StratEdge staff and employees always; consultants, outside
 *    consultants, students and client contacts when switched on. People outside the team only see the team (and the
 *    people they already share a conversation with) in the people list. Retention: messages older than the months
 *    set are deleted with their files.
 * Tables chat_convs, chat_members, chat_msgs, chat_presence; documents chat/x/settings, chat/x/meta, chat/p/{uid}.
 */

const CHAT_SCHEMA = 1;
const CHAT_KINDS = ['staff' => 'StratEdge staff', 'employee' => 'Employees', 'consultant' => 'Consultants', 'outside' => 'Outside consultants', 'student' => 'Students', 'client' => 'Client contacts'];
const CHAT_TEAM = ['staff', 'employee'];
const CHAT_EMOJI = ['👍', '❤️', '😂', '🎉', '👀', '✅', '🙏', '🔥'];
const CHAT_MAX_BODY = 8000;
const CHAT_MAX_GROUP = 50;
const CHAT_MAX_FILES = 5;

/* ---------- storage ---------- */

function cdb(): PDO
{
    static $ready = false;
    $pdo = db();
    if ($ready) {
        return $pdo;
    }
    $v = (int) ($pdo->query("SELECT v FROM meta WHERE k = 'chat_schema'")->fetchColumn() ?: 0);
    if ($v < CHAT_SCHEMA) {
        $pdo->exec('CREATE TABLE IF NOT EXISTS chat_convs (id VARCHAR(24) PRIMARY KEY, kind VARCHAR(8) NOT NULL, name VARCHAR(80) NOT NULL, topic VARCHAR(300) NOT NULL,
            private INT NOT NULL, aud VARCHAR(8) NOT NULL, posting VARCHAR(8) NOT NULL, def INT NOT NULL, dm_key VARCHAR(90) NOT NULL, by_uid VARCHAR(40) NOT NULL,
            created BIGINT NOT NULL, rev BIGINT NOT NULL, last_seq BIGINT NOT NULL, last_at BIGINT NOT NULL, last_text VARCHAR(300) NOT NULL, archived INT NOT NULL)');
        $pdo->exec('CREATE TABLE IF NOT EXISTS chat_members (conv VARCHAR(24) NOT NULL, uid VARCHAR(40) NOT NULL, role VARCHAR(8) NOT NULL, joined BIGINT NOT NULL,
            last_read BIGINT NOT NULL, muted INT NOT NULL, mailed BIGINT NOT NULL, PRIMARY KEY (conv, uid))');
        $pdo->exec('CREATE TABLE IF NOT EXISTS chat_msgs (seq BIGINT PRIMARY KEY, conv VARCHAR(24) NOT NULL, uid VARCHAR(40) NOT NULL, at BIGINT NOT NULL,
            kind VARCHAR(8) NOT NULL, body TEXT NOT NULL, reply_to BIGINT NOT NULL, atts TEXT NOT NULL, reacts TEXT NOT NULL, mentions TEXT NOT NULL,
            edited BIGINT NOT NULL, deleted BIGINT NOT NULL, pinned BIGINT NOT NULL, rev BIGINT NOT NULL)');
        $pdo->exec('CREATE TABLE IF NOT EXISTS chat_presence (uid VARCHAR(40) PRIMARY KEY, seen BIGINT NOT NULL, typing VARCHAR(24) NOT NULL, typing_at BIGINT NOT NULL)');
        foreach ([
            'CREATE INDEX chat_members_uid ON chat_members (uid)',
            'CREATE INDEX chat_msgs_conv ON chat_msgs (conv, seq)',
            'CREATE INDEX chat_msgs_rev ON chat_msgs (conv, rev)',
            'CREATE INDEX chat_msgs_at ON chat_msgs (at)',
            'CREATE INDEX chat_convs_dm ON chat_convs (dm_key)',
        ] as $sql) {
            try {
                $pdo->exec($sql);
            } catch (Throwable $e) {
                // already there
            }
        }
        foreach (['chat_seq' => 0, 'chat_cron' => 0] as $k => $val) {
            try {
                $pdo->prepare('INSERT INTO meta (k, v) VALUES (?, ?)')->execute([$k, $val]);
            } catch (Throwable $e) {
                // already there
            }
        }
        try {
            $pdo->prepare($v ? "UPDATE meta SET v = ? WHERE k = 'chat_schema'" : "INSERT INTO meta (k, v) VALUES ('chat_schema', ?)")->execute([CHAT_SCHEMA]);
        } catch (Throwable $e) {
            // another request finished the setup first
        }
    }
    $ready = true;
    return $pdo;
}
/** Runs $fn in one transaction; the counter, the new rows and the conversation's summary change together. */
function chatTx(callable $fn)
{
    $pdo = cdb();
    // SQLite: take the write lock first (BEGIN IMMEDIATE waits its turn); a transaction that reads before it writes
    // could otherwise fail with "database is locked" when another page wrote in between
    $lite = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite';
    $lite ? $pdo->exec('BEGIN IMMEDIATE') : $pdo->beginTransaction();
    try {
        $out = $fn($pdo);
        $lite ? $pdo->exec('COMMIT') : $pdo->commit();
        return $out;
    } catch (Throwable $e) {
        try {
            $lite ? $pdo->exec('ROLLBACK') : $pdo->rollBack();
        } catch (Throwable $e2) {
            // nothing was open
        }
        throw $e;
    }
}
/** The next number of the one counter behind new messages and every change the pollers pick up. Call inside chatTx. */
function chatNext(PDO $pdo): int
{
    $pdo->exec("UPDATE meta SET v = v + 1 WHERE k = 'chat_seq'");
    return (int) $pdo->query("SELECT v FROM meta WHERE k = 'chat_seq'")->fetchColumn();
}
function chatObj($x): array
{
    return is_array($x) ? $x : (json_decode((string) json_encode($x), true) ?: []);
}

/* ---------- who may use it ---------- */

function chatSettings(): array
{
    static $s = null;
    if ($s !== null) {
        return $s;
    }
    $d = chatObj(docGet('chat/x/settings'));
    $who = (array) ($d['who'] ?? []);
    $s = [
        'who' => [
            'consultant' => !array_key_exists('consultant', $who) || !empty($who['consultant']),
            'outside' => !empty($who['outside']),
            'student' => !empty($who['student']),
            'client' => !empty($who['client']),
        ],
        'channels' => ($d['channels'] ?? 'employee') === 'staff' ? 'staff' : 'employee',
        'retention' => max(0, min(120, (int) ($d['retention'] ?? 0))),
        'mailAfter' => max(0, min(1440, (int) ($d['mailAfter'] ?? 15))),
        'edit' => !array_key_exists('edit', $d) || !empty($d['edit']),
    ];
    return $s;
}
/** staff | employee | consultant | outside | student | client, or '' for someone who can't message (not approved yet). */
function chatKind(array $u): string
{
    if (($u['status'] ?? 'active') !== 'active') {
        return '';
    }
    if (userLevel($u) >= 2 || hasRole($u, 'manager')) {
        return 'staff';
    }
    $uid = (string) $u['id'];
    $r = myR($uid);
    if (!$r || ($r->st ?? '') !== 'active') {
        return '';
    }
    $p = portalsOf($u);
    if (in_array('employee', $p, true)) {
        return 'employee';
    }
    if (in_array('consultant', $p, true)) {
        return meCt($u) === 'outside' ? 'outside' : 'consultant';
    }
    if (in_array('student', $p, true)) {
        return 'student';
    }
    if (in_array('client', $p, true)) {
        return 'client';
    }
    return '';
}
function chatAllowed(string $k, ?array $s = null): bool
{
    if ($k === '') {
        return false;
    }
    if (in_array($k, CHAT_TEAM, true)) {
        return true;
    }
    $s = $s ?? chatSettings();
    return !empty($s['who'][$k]);
}
/** For the "me" route: whether this person sees the Messages button. */
function chatFlag(array $u): bool
{
    return chatAllowed(chatKind($u));
}
function chatMe(): array
{
    $u = requireUser();
    $k = chatKind($u);
    if (!chatAllowed($k)) {
        fail(403, 'forbidden', 'Messages are not switched on for your account.');
    }
    cdb();
    chatSeed();
    return $u + ['ck' => $k];
}
function chatIsTeam(array $me): bool
{
    return in_array($me['ck'], CHAT_TEAM, true);
}
function chatIsAdmin(array $me): bool
{
    return hasRole($me, 'admin');
}
/** A channel's audience: 'team' (staff and employees) or 'all' (everyone who may use Messages). */
function chatAudienceHas(string $aud, string $kind): bool
{
    return $aud === 'all' ? $kind !== '' : in_array($kind, CHAT_TEAM, true);
}
/** Everyone who may use Messages: [id => [id, n, k, t]] (t: a short line, such as "HR" or "Consultant"). */
function chatDirectory(): array
{
    static $all = null;
    if ($all !== null) {
        return $all;
    }
    $s = chatSettings();
    $all = [];
    $roleNames = ['admin' => 'Admin', 'hr' => 'HR', 'acct' => 'Accounting', 'manager' => 'Manager'];
    foreach (db()->query("SELECT id, email, name, role, status, access FROM users WHERE status = 'active' ORDER BY name")->fetchAll() as $row) {
        $k = chatKind($row);
        if (!chatAllowed($k, $s)) {
            continue;
        }
        $t = $k === 'staff' ? implode(', ', array_values(array_filter(array_map(fn($r) => $roleNames[$r] ?? '', rolesOf($row))))) : ['employee' => 'Employee', 'consultant' => 'Consultant', 'outside' => 'Outside consultant', 'student' => 'Student', 'client' => 'Client contact'][$k];
        $all[(string) $row['id']] = ['id' => (string) $row['id'], 'n' => (string) $row['name'], 'k' => $k, 't' => $t ?: 'StratEdge'];
    }
    return $all;
}
/** The people this person may start a conversation with or add: the team for everyone, everybody for the team. */
function chatVisible(array $me): array
{
    $dir = chatDirectory();
    if (chatIsTeam($me)) {
        return $dir;
    }
    $out = array_filter($dir, fn($p) => in_array($p['k'], CHAT_TEAM, true));
    // and the people they already talk with in a direct message or a group (a shared channel doesn't count: everyone
    // is in #announcements)
    $st = cdb()->prepare("SELECT DISTINCT o.uid FROM chat_members m JOIN chat_convs c ON c.id = m.conv AND c.kind <> 'channel' JOIN chat_members o ON o.conv = m.conv WHERE m.uid = ?");
    $st->execute([(string) $me['id']]);
    foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $uid) {
        if (isset($dir[$uid])) {
            $out[$uid] = $dir[$uid];
        }
    }
    unset($out[(string) $me['id']]);
    return $out;
}
function chatName(string $uid): string
{
    $d = chatDirectory();
    if (isset($d[$uid])) {
        return $d[$uid]['n'];
    }
    $row = userRow($uid);
    return $row ? (string) $row['name'] : 'Someone';
}
function chatPrefs(string $uid): array
{
    $d = chatObj(docGet("chat/p/$uid"));
    return ['email' => !array_key_exists('email', $d) || !empty($d['email']), 'left' => array_values(array_filter((array) ($d['left'] ?? []), 'is_string'))];
}

/* ---------- the built-in channels ---------- */

function chatSeed(): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    $m = chatObj(docGet('chat/x/meta'));
    $built = (array) ($m['builtins'] ?? []);
    $seed = [
        'general' => ['general', 'The whole StratEdge team: questions, updates and anything work-related.', 'team', 'all'],
        'announcements' => ['announcements', 'News from StratEdge for everyone. Only staff post here.', 'all', 'staff'],
    ];
    $added = false;
    foreach ($seed as $id => [$name, $topic, $aud, $posting]) {
        if (in_array($id, $built, true)) {
            continue;
        }
        $st = cdb()->prepare('SELECT COUNT(*) FROM chat_convs WHERE id = ?');
        $st->execute([$id]);
        if (!(int) $st->fetchColumn()) {
            chatTx(function (PDO $pdo) use ($id, $name, $topic, $aud, $posting) {
                $rev = chatNext($pdo);
                $pdo->prepare('INSERT INTO chat_convs (id, kind, name, topic, private, aud, posting, def, dm_key, by_uid, created, rev, last_seq, last_at, last_text, archived) VALUES (?,?,?,?,0,?,?,1,\'\',\'system\',?,?,0,?,\'\',0)')->execute([$id, 'channel', $name, $topic, $aud, $posting, now(), $rev, now()]);
            });
        }
        $built[] = $id;
        $added = true;
    }
    if ($added) {
        docSet('chat/x/meta', (object) ['builtins' => array_values(array_unique($built))]);
    }
}
/** Joins this person to the default channels meant for them (once; leaving one keeps them out). */
function chatEnsureDefaults(array $me): void
{
    $prefs = chatPrefs((string) $me['id']);
    $rows = cdb()->query("SELECT id, aud FROM chat_convs WHERE def = 1 AND archived = 0 AND kind = 'channel'")->fetchAll();
    foreach ($rows as $c) {
        if (!chatAudienceHas((string) $c['aud'], $me['ck']) || in_array($c['id'], $prefs['left'], true) || chatMember((string) $c['id'], (string) $me['id'])) {
            continue;
        }
        chatAddMember((string) $c['id'], (string) $me['id'], 'member', false);
    }
}

/* ---------- conversations ---------- */

function chatConv(string $id): ?array
{
    $st = cdb()->prepare('SELECT * FROM chat_convs WHERE id = ?');
    $st->execute([$id]);
    return $st->fetch() ?: null;
}
function chatMember(string $conv, string $uid): ?array
{
    $st = cdb()->prepare('SELECT * FROM chat_members WHERE conv = ? AND uid = ?');
    $st->execute([$conv, $uid]);
    return $st->fetch() ?: null;
}
function chatMemberIds(string $conv): array
{
    $st = cdb()->prepare('SELECT uid FROM chat_members WHERE conv = ?');
    $st->execute([$conv]);
    return array_map('strval', $st->fetchAll(PDO::FETCH_COLUMN));
}
/** The conversation, when this person is in it (or may read it: none outside). Fails otherwise. */
function chatConvFor(array $me, string $id, bool $write = false): array
{
    $c = $id !== '' ? chatConv($id) : null;
    $m = $c ? chatMember($id, (string) $me['id']) : null;
    if (!$c || !$m) {
        fail(404, 'not_found', 'That conversation is not open to you.');
    }
    if ($write && (int) $c['archived']) {
        fail(400, 'invalid_argument', 'This channel is archived.');
    }
    return [$c, $m];
}
/** Bumps a conversation's change number (its name, members or settings changed). Call inside chatTx. */
function chatTouchConv(PDO $pdo, string $conv): void
{
    $pdo->prepare('UPDATE chat_convs SET rev = ? WHERE id = ?')->execute([chatNext($pdo), $conv]);
}
function chatAddMember(string $conv, string $uid, string $role = 'member', bool $note = true, ?array $by = null): void
{
    chatTx(function (PDO $pdo) use ($conv, $uid, $role, $note, $by) {
        $st = $pdo->prepare('SELECT COUNT(*) FROM chat_members WHERE conv = ? AND uid = ?');
        $st->execute([$conv, $uid]);
        if ((int) $st->fetchColumn()) {
            return;
        }
        $c = $pdo->prepare('SELECT last_seq FROM chat_convs WHERE id = ?');
        $c->execute([$conv]);
        $last = (int) $c->fetchColumn();
        // a new member starts with nothing unread
        $pdo->prepare('INSERT INTO chat_members (conv, uid, role, joined, last_read, muted, mailed) VALUES (?,?,?,?,?,0,?)')->execute([$conv, $uid, $role, now(), $last, $last]);
        chatTouchConv($pdo, $conv);
        if ($note) {
            chatSysNote($pdo, $conv, $by && (string) $by['id'] !== $uid ? $by['name'] . ' added ' . chatName($uid) : chatName($uid) . ' joined');
        }
    });
}
/** A line such as "Priya joined" in the conversation (not counted as unread). Call inside chatTx. */
function chatSysNote(PDO $pdo, string $conv, string $text): void
{
    $seq = chatNext($pdo);
    $pdo->prepare('INSERT INTO chat_msgs (seq, conv, uid, at, kind, body, reply_to, atts, reacts, mentions, edited, deleted, pinned, rev) VALUES (?,?,\'\',?,\'sys\',?,0,\'[]\',\'{}\',\'[]\',0,0,0,?)')->execute([$seq, $conv, now(), mb_substr($text, 0, 300), $seq]);
    $pdo->prepare('UPDATE chat_convs SET last_seq = ? WHERE id = ?')->execute([$seq, $conv]);
}
/** My conversations with their unread counts, for the list and the badge. */
function chatList(array $me): array
{
    $uid = (string) $me['id'];
    $pdo = cdb();
    $st = $pdo->prepare('SELECT c.*, m.role AS mrole, m.last_read, m.muted FROM chat_members m JOIN chat_convs c ON c.id = m.conv WHERE m.uid = ? AND c.archived = 0');
    $st->execute([$uid]);
    $rows = $st->fetchAll();
    $un = $pdo->prepare("SELECT x.conv, COUNT(*) AS n, SUM(CASE WHEN x.mentions LIKE ? OR x.mentions LIKE '%\"*\"%' THEN 1 ELSE 0 END) AS mn
        FROM chat_members m JOIN chat_msgs x ON x.conv = m.conv AND x.seq > m.last_read
        WHERE m.uid = ? AND x.uid <> ? AND x.deleted = 0 AND x.kind = 'msg' GROUP BY x.conv");
    $un->execute(['%"' . $uid . '"%', $uid, $uid]);
    $unread = [];
    foreach ($un->fetchAll() as $r) {
        $unread[(string) $r['conv']] = [(int) $r['n'], (int) $r['mn']];
    }
    // the people in direct messages and groups, for their names
    $ids = array_values(array_map(fn($r) => (string) $r['id'], array_filter($rows, fn($r) => $r['kind'] !== 'channel')));
    $people = [];
    $counts = [];
    if ($ids) {
        $in = implode(',', array_fill(0, count($ids), '?'));
        $pm = $pdo->prepare("SELECT conv, uid FROM chat_members WHERE conv IN ($in)");
        $pm->execute($ids);
        foreach ($pm->fetchAll() as $r) {
            $people[(string) $r['conv']][] = (string) $r['uid'];
        }
    }
    $chIds = array_values(array_map(fn($r) => (string) $r['id'], array_filter($rows, fn($r) => $r['kind'] === 'channel')));
    if ($chIds) {
        $in = implode(',', array_fill(0, count($chIds), '?'));
        $cm = $pdo->prepare("SELECT conv, COUNT(*) AS n FROM chat_members WHERE conv IN ($in) GROUP BY conv");
        $cm->execute($chIds);
        foreach ($cm->fetchAll() as $r) {
            $counts[(string) $r['conv']] = (int) $r['n'];
        }
    }
    $out = [];
    foreach ($rows as $r) {
        $id = (string) $r['id'];
        $members = $people[$id] ?? [];
        $others = array_values(array_filter($members, fn($x) => $x !== $uid));
        [$n, $mn] = $unread[$id] ?? [0, 0];
        $name = (string) $r['name'];
        if ($r['kind'] === 'dm') {
            $name = $others ? chatName($others[0]) : 'Just you';
        } elseif ($r['kind'] === 'group' && $name === '') {
            $name = implode(', ', array_map(fn($x) => explode(' ', chatName($x))[0], array_slice($others, 0, 4))) . (count($others) > 4 ? ' +' . (count($others) - 4) : '');
        }
        $out[] = [
            'id' => $id,
            'kind' => $r['kind'],
            'name' => $name,
            'topic' => $r['topic'],
            'private' => (bool) $r['private'],
            'aud' => $r['aud'],
            'posting' => $r['posting'],
            'def' => (bool) $r['def'],
            'other' => $r['kind'] === 'dm' ? ($others[0] ?? '') : '',
            'members' => $r['kind'] === 'channel' ? [] : $members,
            'n' => $r['kind'] === 'channel' ? ($counts[$id] ?? 0) : count($members),
            'role' => $r['mrole'],
            'muted' => (bool) $r['muted'],
            'lastAt' => (int) $r['last_at'],
            'lastText' => $r['last_text'],
            'unread' => $n,
            'mention' => $r['kind'] === 'channel' ? $mn : $n,
            'rev' => (int) $r['rev'],
            'canPost' => $r['posting'] !== 'staff' || $me['ck'] === 'staff',
        ];
    }
    usort($out, fn($a, $b) => $b['lastAt'] <=> $a['lastAt']);
    return $out;
}
/** A direct message with one person, made the first time. */
function chatOpenDm(array $me, string $uid): array
{
    $vis = chatVisible($me);
    if ($uid === (string) $me['id'] || !isset($vis[$uid])) {
        fail(400, 'invalid_argument', 'You can\'t message that person.');
    }
    $pair = [(string) $me['id'], $uid];
    sort($pair);
    $key = implode('|', $pair);
    $st = cdb()->prepare("SELECT id FROM chat_convs WHERE kind = 'dm' AND dm_key = ?");
    $st->execute([$key]);
    $id = (string) ($st->fetchColumn() ?: '');
    if ($id !== '') {
        return chatConv($id);
    }
    $id = 'd' . rid(8);
    chatTx(function (PDO $pdo) use ($id, $key, $me, $uid) {
        $rev = chatNext($pdo);
        $pdo->prepare('INSERT INTO chat_convs (id, kind, name, topic, private, aud, posting, def, dm_key, by_uid, created, rev, last_seq, last_at, last_text, archived) VALUES (?,\'dm\',\'\',\'\',1,\'\',\'all\',0,?,?,?,?,0,?,\'\',0)')->execute([$id, $key, (string) $me['id'], now(), $rev, now()]);
        foreach ([(string) $me['id'], $uid] as $x) {
            $pdo->prepare('INSERT INTO chat_members (conv, uid, role, joined, last_read, muted, mailed) VALUES (?,?,\'member\',?,0,0,0)')->execute([$id, $x, now()]);
        }
    });
    return chatConv($id);
}
function chatSlug(string $name): string
{
    $s = trim((string) preg_replace('/[^a-z0-9]+/', '-', mb_strtolower(trim($name))), '-');
    return mb_substr($s, 0, 40);
}

/* ---------- messages ---------- */

function chatMsg(int $seq): ?array
{
    $st = cdb()->prepare('SELECT * FROM chat_msgs WHERE seq = ?');
    $st->execute([$seq]);
    return $st->fetch() ?: null;
}
/** The names of the people who wrote these messages (and of those they reply to), for the page. */
function chatNamesOf(array $outs): object
{
    $names = [];
    foreach ($outs as $o) {
        foreach ([$o['u'], $o['rp']['u'] ?? ''] as $uid) {
            if ($uid !== '' && !isset($names[$uid])) {
                $names[$uid] = chatName($uid);
            }
        }
    }
    return (object) $names;
}
/** What the browser sees of messages (a deleted one keeps its place, without its text and files). */
function chatOut(array $rows): array
{
    $replies = array_values(array_unique(array_filter(array_map(fn($r) => (int) $r['reply_to'], $rows))));
    $rp = [];
    if ($replies) {
        $in = implode(',', array_fill(0, count($replies), '?'));
        $st = cdb()->prepare("SELECT seq, uid, body, deleted, atts FROM chat_msgs WHERE seq IN ($in)");
        $st->execute($replies);
        foreach ($st->fetchAll() as $r) {
            $atts = json_decode((string) $r['atts'], true) ?: [];
            $rp[(int) $r['seq']] = ['u' => (string) $r['uid'], 'b' => (int) $r['deleted'] ? '' : mb_substr((string) $r['body'], 0, 160), 'd' => (bool) $r['deleted'], 'f' => count($atts)];
        }
    }
    return array_map(function ($r) use ($rp) {
        $del = (int) $r['deleted'] > 0;
        return [
            's' => (int) $r['seq'],
            'u' => (string) $r['uid'],
            'at' => (int) $r['at'],
            'k' => $r['kind'],
            'b' => $del ? '' : (string) $r['body'],
            'r' => (int) $r['reply_to'],
            'rp' => (int) $r['reply_to'] ? ($rp[(int) $r['reply_to']] ?? null) : null,
            'a' => $del ? [] : (json_decode((string) $r['atts'], true) ?: []),
            'x' => $del ? (object) [] : (json_decode((string) $r['reacts'], true) ?: (object) []),
            'm' => json_decode((string) $r['mentions'], true) ?: [],
            'e' => (int) $r['edited'],
            'd' => $del,
            'p' => (int) $r['pinned'],
            'v' => (int) $r['rev'],
        ];
    }, $rows);
}
/** Files sent with a message: stored encrypted like every upload, listed on the message only (no document). */
function chatStoreFiles(): array
{
    $out = [];
    $max = (int) cfg('max_upload_mb') * 1048576;
    // v35: every file is screened first (type matches content, no macros or programs, virus scan), so a refused file
    // never leaves the others half-stored
    foreach ($_FILES as $k => $f) {
        if (is_array($f) && preg_match('/^f\d$/', (string) $k) && ($f['error'] ?? 1) === UPLOAD_ERR_OK) {
            uploadGuard((string) $f['tmp_name'], mb_substr(basename((string) $f['name']), 0, 180));
        }
    }
    foreach ($_FILES as $k => $f) {
        if (!is_array($f) || !preg_match('/^f\d$/', (string) $k) || ($f['error'] ?? 1) === UPLOAD_ERR_NO_FILE) {
            continue;
        }
        if (count($out) >= CHAT_MAX_FILES) {
            break;
        }
        if (($f['error'] ?? 1) !== UPLOAD_ERR_OK) {
            fail(400, 'invalid_argument', ($f['error'] ?? 0) === UPLOAD_ERR_INI_SIZE || ($f['error'] ?? 0) === UPLOAD_ERR_FORM_SIZE ? 'That file is too large.' : 'The upload did not complete. Try again.');
        }
        $name = mb_substr(basename((string) $f['name']), 0, 180);
        $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        if (!isset(MIME[$ext])) {
            fail(400, 'invalid_argument', 'Send a PDF, image, Excel (.xlsx), Word (.docx), PowerPoint (.pptx), zip, CSV, Markdown, JSON or text file.');
        }
        $size = (int) $f['size'];
        if ($size <= 0 || $size > $max) {
            fail(400, 'too_large', $size <= 0 ? 'That file is empty.' : 'That file is larger than ' . cfg('max_upload_mb') . ' MB.');
        }
        $dir = cfg('files_dir');
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        $fid = rid(16);
        if (!move_uploaded_file((string) $f['tmp_name'], "$dir/$fid")) {
            fail(500, 'unavailable', 'The server could not store the file. Check that the storage folder is writable.');
        }
        fileSealPath("$dir/$fid");
        $out[] = ['i' => $fid, 'n' => $name, 'ty' => MIME[$ext], 'sz' => $size];
    }
    return $out;
}
function chatDropFiles(array $atts): void
{
    foreach ($atts as $a) {
        $fid = (string) ($a['i'] ?? '');
        if (preg_match('/^[a-f0-9]{32}$/', $fid)) {
            @unlink(cfg('files_dir') . '/' . $fid);
        }
    }
}
/** Sends a message. $b: conv, body, reply, mentions (list of ids, "*" for everyone), plus files f0..f4. */
function chatSend(array $me, array $b): array
{
    [$c, $m] = chatConvFor($me, (string) ($b['conv'] ?? ''), true);
    if ($c['posting'] === 'staff' && $me['ck'] !== 'staff') {
        fail(403, 'forbidden', 'Only StratEdge staff post in #' . $c['name'] . '.');
    }
    $body = trim(str_replace("\r\n", "\n", (string) ($b['body'] ?? '')));
    if (mb_strlen($body) > CHAT_MAX_BODY) {
        fail(400, 'invalid_argument', 'That message is too long. Split it, or send it as a file.');
    }
    $mentions = $b['mentions'] ?? [];
    if (is_string($mentions)) {
        $mentions = json_decode($mentions, true) ?: [];
    }
    $members = chatMemberIds((string) $c['id']);
    $ment = [];
    foreach ((array) $mentions as $x) {
        $x = (string) $x;
        if ($x === '*' && $c['kind'] !== 'dm' && ($c['kind'] === 'group' || chatIsTeam($me))) {
            $ment[] = '*';
        } elseif (in_array($x, $members, true) && $x !== (string) $me['id']) {
            $ment[] = $x;
        }
    }
    $ment = array_values(array_unique($ment));
    $reply = (int) ($b['reply'] ?? 0);
    if ($reply) {
        $r = chatMsg($reply);
        if (!$r || $r['conv'] !== $c['id']) {
            $reply = 0;
        }
    }
    $atts = chatStoreFiles();
    if ($body === '' && !$atts) {
        fail(400, 'invalid_argument', 'Write a message or add a file.');
    }
    $preview = chatName((string) $me['id']) . ': ' . ($body !== '' ? mb_substr((string) preg_replace('/\s+/', ' ', $body), 0, 200) : ($atts ? '[' . $atts[0]['n'] . ']' : ''));
    $seq = chatTx(function (PDO $pdo) use ($c, $me, $body, $reply, $atts, $ment, $preview) {
        $seq = chatNext($pdo);
        $now = now();
        $pdo->prepare('INSERT INTO chat_msgs (seq, conv, uid, at, kind, body, reply_to, atts, reacts, mentions, edited, deleted, pinned, rev) VALUES (?,?,?,?,\'msg\',?,?,?,\'{}\',?,0,0,0,?)')
            ->execute([$seq, $c['id'], (string) $me['id'], $now, $body, $reply, json_encode($atts, JSON_UNESCAPED_UNICODE), json_encode($ment), $seq]);
        $pdo->prepare('UPDATE chat_convs SET last_seq = ?, last_at = ?, last_text = ?, rev = ? WHERE id = ?')->execute([$seq, $now, mb_substr($preview, 0, 300), $seq, $c['id']]);
        // what I wrote is read, and my own message is never emailed to me
        $pdo->prepare('UPDATE chat_members SET last_read = ?, mailed = ? WHERE conv = ? AND uid = ?')->execute([$seq, $seq, $c['id'], (string) $me['id']]);
        return $seq;
    });
    chatPresenceSet((string) $me['id'], '');
    return chatOut([chatMsg($seq)])[0];
}
/** Changes a message in place (edit, delete, react, pin): it gets a new change number so every open page picks it up. */
function chatChange(int $seq, array $f): void
{
    chatTx(function (PDO $pdo) use ($seq, $f) {
        $f['rev'] = chatNext($pdo);
        $cols = implode(', ', array_map(fn($k) => "$k = ?", array_keys($f)));
        $pdo->prepare("UPDATE chat_msgs SET $cols WHERE seq = ?")->execute([...array_values($f), $seq]);
    });
}
function chatMsgFor(array $me, int $seq): array
{
    $x = chatMsg($seq);
    if (!$x || $x['kind'] !== 'msg') {
        fail(404, 'not_found', 'That message is gone.');
    }
    [$c, $m] = chatConvFor($me, (string) $x['conv']);
    return [$x, $c, $m];
}

/* ---------- presence and polling ---------- */

function chatPresenceSet(string $uid, ?string $typing = null): void
{
    try {
        $st = cdb()->prepare('SELECT seen, typing, typing_at FROM chat_presence WHERE uid = ?');
        $st->execute([$uid]);
        $p = $st->fetch();
        $now = now();
        if ($typing === null && $p && (int) $p['seen'] > $now - 30000) {
            return;
        }
        cdb()->prepare('REPLACE INTO chat_presence (uid, seen, typing, typing_at) VALUES (?,?,?,?)')->execute([$uid, $now, $typing ?? ($p['typing'] ?? ''), $typing === null ? (int) ($p['typing_at'] ?? 0) : ($typing === '' ? 0 : $now)]);
    } catch (Throwable $e) {
        // presence is a nicety
    }
}
function chatOnline(): array
{
    $st = cdb()->prepare('SELECT uid FROM chat_presence WHERE seen > ?');
    $st->execute([now() - 150000]);
    return array_map('strval', $st->fetchAll(PDO::FETCH_COLUMN));
}
/**
 * One poll: the conversation list when it changed (by its fingerprint h), and for the open conversation the messages
 * changed since its change number, who read how far, and who is typing.
 */
function chatPoll(array $me, array $b): array
{
    $uid = (string) $me['id'];
    chatPresenceSet($uid);
    $list = chatList($me);
    $h = md5(json_encode(array_map(fn($c) => [$c['id'], $c['rev'], $c['unread'], $c['mention'], $c['muted']], $list)));
    $out = ['h' => $h, 'online' => chatOnline(), 'now' => now()];
    if ((string) ($b['h'] ?? '') !== $h) {
        $out['convs'] = $list;
    }
    $open = (string) ($b['open'] ?? '');
    if ($open !== '' && ($m = chatMember($open, $uid))) {
        $since = max(0, (int) ($b['since'] ?? 0));
        $st = cdb()->prepare('SELECT * FROM chat_msgs WHERE conv = ? AND rev > ? ORDER BY seq LIMIT 300');
        $st->execute([$open, $since]);
        $out['msgs'] = chatOut($st->fetchAll());
        $out['names'] = chatNamesOf($out['msgs']);
        $c = chatConv($open);
        if ($c && $c['kind'] !== 'channel') {
            $rd = cdb()->prepare('SELECT uid, last_read FROM chat_members WHERE conv = ?');
            $rd->execute([$open]);
            $out['reads'] = array_map(fn($r) => [(string) $r['uid'], (int) $r['last_read']], $rd->fetchAll());
        }
        $ty = cdb()->prepare('SELECT p.uid FROM chat_presence p JOIN chat_members m ON m.uid = p.uid AND m.conv = ? WHERE p.typing = ? AND p.typing_at > ? AND p.uid <> ?');
        $ty->execute([$open, $open, now() - 8000, $uid]);
        $out['typing'] = array_map(fn($x) => chatName((string) $x), $ty->fetchAll(PDO::FETCH_COLUMN));
    }
    return $out;
}

/* ---------- email for unread direct messages and mentions ---------- */

function chatMailDigest(int $maxPeople = 40): int
{
    $s = chatSettings();
    if ($s['mailAfter'] <= 0) {
        return 0;
    }
    $now = now();
    $st = cdb()->prepare("SELECT m.uid, m.conv, c.kind, c.name, x.seq, x.uid AS sender, x.body, x.mentions, x.at, x.atts
        FROM chat_members m JOIN chat_convs c ON c.id = m.conv JOIN chat_msgs x ON x.conv = m.conv AND x.seq > m.last_read AND x.seq > m.mailed
        WHERE m.muted = 0 AND c.archived = 0 AND x.uid <> m.uid AND x.deleted = 0 AND x.kind = 'msg' AND x.at < ? AND x.at > ?
        ORDER BY x.seq");
    $st->execute([$now - $s['mailAfter'] * 60000, $now - 3 * 86400000]);
    $by = [];
    foreach ($st->fetchAll() as $r) {
        $uid = (string) $r['uid'];
        $ment = json_decode((string) $r['mentions'], true) ?: [];
        if ($r['kind'] === 'channel' && !in_array($uid, $ment, true) && !in_array('*', $ment, true)) {
            continue;
        }
        $by[$uid][] = $r;
    }
    $sent = 0;
    $seen = [];
    foreach (cdb()->query('SELECT uid, seen FROM chat_presence')->fetchAll() as $p) {
        $seen[(string) $p['uid']] = (int) $p['seen'];
    }
    foreach ($by as $uid => $rows) {
        if ($sent >= $maxPeople) {
            break;
        }
        $first = (int) $rows[0]['at'];
        $maxSeq = [];
        foreach ($rows as $r) {
            $maxSeq[(string) $r['conv']] = max($maxSeq[(string) $r['conv']] ?? 0, (int) $r['seq']);
        }
        $mark = function () use ($maxSeq, $uid) {
            foreach ($maxSeq as $conv => $seq) {
                cdb()->prepare('UPDATE chat_members SET mailed = ? WHERE conv = ? AND uid = ? AND mailed < ?')->execute([$seq, $conv, $uid, $seq]);
            }
        };
        // someone who has been in the portal since these arrived saw the badge: no email
        if (($seen[$uid] ?? 0) > $first || !chatPrefs($uid)['email']) {
            $mark();
            continue;
        }
        $row = userRow($uid);
        if (!$row || ($row['status'] ?? '') !== 'active' || !filter_var((string) $row['email'], FILTER_VALIDATE_EMAIL)) {
            $mark();
            continue;
        }
        $lines = [];
        foreach (array_slice($rows, -8) as $r) {
            $where = $r['kind'] === 'channel' ? ' in #' . $r['name'] : ($r['kind'] === 'group' ? ' in a group' : '');
            $atts = json_decode((string) $r['atts'], true) ?: [];
            $text = trim((string) preg_replace('/\s+/', ' ', (string) $r['body']));
            $lines[] = chatName((string) $r['sender']) . $where . ': ' . ($text !== '' ? mb_substr($text, 0, 220) : '[' . ($atts[0]['n'] ?? 'a file') . ']');
        }
        $n = count($rows);
        $link = siteUrl() . '#/portal/messages';
        try {
            require_once __DIR__ . '/mail.php';
            mailDeliver([
                'to' => (string) $row['email'],
                'name' => (string) $row['name'],
                'subject' => $n === 1 ? 'New message from ' . chatName((string) $rows[0]['sender']) : $n . ' new messages for you on StratEdge',
                'text' => "You have unread messages on StratEdge:\n\n" . implode("\n", $lines) . "\n\nOpen Messages: $link\n\n(Turn these emails off in Messages > your settings.)",
                'html' => emailHtml('You have unread messages', array_merge($lines, ['Reply in the portal; these emails stop once you have read them.']), ['Open Messages', $link], 'You get this because a message was sent to you directly or mentioned you. Turn these emails off in Messages.'),
                'kind' => 'chat',
            ]);
            $sent++;
        } catch (Throwable $e) {
            // tried once; the badge still shows it
        }
        $mark();
    }
    return $sent;
}
/** Messages older than the months set are deleted with their files (daily). */
function chatRetention(): int
{
    $s = chatSettings();
    if ($s['retention'] <= 0) {
        return 0;
    }
    $cut = now() - $s['retention'] * 30 * 86400000;
    $st = cdb()->prepare("SELECT seq, atts FROM chat_msgs WHERE at < ? LIMIT 2000");
    $st->execute([$cut]);
    $rows = $st->fetchAll();
    foreach ($rows as $r) {
        chatDropFiles(json_decode((string) $r['atts'], true) ?: []);
    }
    if ($rows) {
        $in = implode(',', array_fill(0, count($rows), '?'));
        cdb()->prepare("DELETE FROM chat_msgs WHERE seq IN ($in)")->execute(array_map(fn($r) => (int) $r['seq'], $rows));
    }
    return count($rows);
}
function chatCron(bool $force = false): array
{
    $pdo = cdb();
    $last = (int) $pdo->query("SELECT v FROM meta WHERE k = 'chat_cron'")->fetchColumn();
    if (!$force && $last > now() - 240000) {
        return ['ran' => false];
    }
    $pdo->prepare("UPDATE meta SET v = ? WHERE k = 'chat_cron'")->execute([now()]);
    $mailed = chatMailDigest();
    $removed = 0;
    $day = (int) (secKv('chat_retention_at', 0) ?? 0);
    if ($force || $day < now() - 20 * 3600000) {
        secKvSet('chat_retention_at', now());
        $removed = chatRetention();
    }
    return ['ran' => true, 'mailed' => $mailed, 'removed' => $removed];
}

/* ---------- routes ---------- */

function chatRoute(string $r, array $b): never
{
    if ($r === 'chat_file') {
        chatFile();
    }
    $me = chatMe();
    $uid = (string) $me['id'];
    switch ($r) {
        case 'chat_boot':
            chatEnsureDefaults($me);
            $vis = chatVisible($me);
            $s = chatSettings();
            ok([
                'me' => ['id' => $uid, 'n' => (string) $me['name'], 'k' => $me['ck']],
                'convs' => chatList($me),
                'people' => array_values($vis),
                'online' => chatOnline(),
                'emoji' => CHAT_EMOJI,
                'canChannel' => $me['ck'] === 'staff' || ($s['channels'] === 'employee' && $me['ck'] === 'employee'),
                'team' => chatIsTeam($me),
                'admin' => chatIsAdmin($me),
                'edit' => $s['edit'],
                'prefs' => ['email' => chatPrefs($uid)['email']],
                'top' => (int) cdb()->query("SELECT v FROM meta WHERE k = 'chat_seq'")->fetchColumn(),
            ]);

        case 'chat_poll':
            ok(chatPoll($me, $b));

        case 'chat_history':
            [$c, $m] = chatConvFor($me, str($b, 'conv', 24));
            // the counter first: anything written after it reaches the page through the poll
            $top = (int) cdb()->query("SELECT v FROM meta WHERE k = 'chat_seq'")->fetchColumn();
            $before = (int) ($b['before'] ?? 0);
            $limit = max(10, min(100, (int) ($b['limit'] ?? 50)));
            $st = cdb()->prepare('SELECT * FROM chat_msgs WHERE conv = ?' . ($before ? ' AND seq < ?' : '') . ' ORDER BY seq DESC LIMIT ' . $limit);
            $st->execute($before ? [$c['id'], $before] : [$c['id']]);
            $rows = array_reverse($st->fetchAll());
            $members = [];
            $mm = cdb()->prepare('SELECT uid, role, last_read FROM chat_members WHERE conv = ?');
            $mm->execute([$c['id']]);
            // in a channel, people outside the team see the team (and themselves), not everyone else who is in it
            $dir = chatDirectory();
            $teamOnly = $c['kind'] === 'channel' && !chatIsTeam($me);
            foreach ($mm->fetchAll() as $x) {
                $xid = (string) $x['uid'];
                if ($teamOnly && $xid !== $uid && !in_array($dir[$xid]['k'] ?? '', CHAT_TEAM, true)) {
                    continue;
                }
                $members[] = ['id' => $xid, 'n' => chatName($xid), 'role' => $x['role'], 'read' => (int) $x['last_read']];
            }
            $pins = cdb()->prepare('SELECT COUNT(*) FROM chat_msgs WHERE conv = ? AND pinned > 0 AND deleted = 0');
            $pins->execute([$c['id']]);
            $outs = chatOut($rows);
            ok([
                'msgs' => $outs,
                'names' => chatNamesOf($outs),
                'more' => count($rows) === $limit,
                'members' => $members,
                'pins' => (int) $pins->fetchColumn(),
                'myRead' => (int) $m['last_read'],
                'top' => $top,
            ]);

        case 'chat_send':
            // files come as a form (multipart), text alone as JSON
            ok(['msg' => chatSend($me, $b ?: $_POST)]);

        case 'chat_edit':
            [$x, $c] = chatMsgFor($me, (int) ($b['seq'] ?? 0));
            if ((string) $x['uid'] !== $uid || !chatSettings()['edit'] || (int) $x['deleted']) {
                fail(403, 'forbidden', 'Only the person who wrote a message can change it.');
            }
            $body = trim(str_replace("\r\n", "\n", (string) ($b['body'] ?? '')));
            if ($body === '' && !(json_decode((string) $x['atts'], true) ?: [])) {
                fail(400, 'invalid_argument', 'Write something, or delete the message instead.');
            }
            if (mb_strlen($body) > CHAT_MAX_BODY) {
                fail(400, 'invalid_argument', 'That message is too long.');
            }
            chatChange((int) $x['seq'], ['body' => $body, 'edited' => now()]);
            ok(['msg' => chatOut([chatMsg((int) $x['seq'])])[0]]);

        case 'chat_delete':
            [$x, $c] = chatMsgFor($me, (int) ($b['seq'] ?? 0));
            $mine = (string) $x['uid'] === $uid && chatSettings()['edit'];
            $moderate = chatIsAdmin($me) && $c['kind'] === 'channel';
            if (!$mine && !$moderate) {
                fail(403, 'forbidden', 'Only the person who wrote a message can delete it.');
            }
            chatDropFiles(json_decode((string) $x['atts'], true) ?: []);
            chatChange((int) $x['seq'], ['body' => '', 'atts' => '[]', 'reacts' => '{}', 'pinned' => 0, 'deleted' => now()]);
            if (!$mine && function_exists('audit')) {
                audit('admin', 'Removed a message in #' . $c['name'], 'chat', ['seq' => (int) $x['seq'], 'by' => chatName((string) $x['uid'])], $me);
            }
            ok(['msg' => chatOut([chatMsg((int) $x['seq'])])[0]]);

        case 'chat_react':
            [$x] = chatMsgFor($me, (int) ($b['seq'] ?? 0));
            $e = (string) ($b['e'] ?? '');
            if (!in_array($e, CHAT_EMOJI, true) || (int) $x['deleted']) {
                fail(400, 'invalid_argument', 'Pick one of the reactions.');
            }
            $reacts = json_decode((string) $x['reacts'], true) ?: [];
            $list = (array) ($reacts[$e] ?? []);
            $list = in_array($uid, $list, true) ? array_values(array_diff($list, [$uid])) : [...$list, $uid];
            if ($list) {
                $reacts[$e] = $list;
            } else {
                unset($reacts[$e]);
            }
            chatChange((int) $x['seq'], ['reacts' => json_encode($reacts ?: (object) [], JSON_UNESCAPED_UNICODE)]);
            ok(['msg' => chatOut([chatMsg((int) $x['seq'])])[0]]);

        case 'chat_pin':
            [$x] = chatMsgFor($me, (int) ($b['seq'] ?? 0));
            if ((int) $x['deleted']) {
                fail(400, 'invalid_argument', 'That message was deleted.');
            }
            chatChange((int) $x['seq'], ['pinned' => !empty($b['on']) ? now() : 0]);
            ok(['msg' => chatOut([chatMsg((int) $x['seq'])])[0]]);

        case 'chat_pins':
            [$c] = chatConvFor($me, str($b, 'conv', 24));
            $st = cdb()->prepare('SELECT * FROM chat_msgs WHERE conv = ? AND pinned > 0 AND deleted = 0 ORDER BY pinned DESC LIMIT 50');
            $st->execute([$c['id']]);
            ok(['msgs' => chatOut($st->fetchAll())]);

        case 'chat_read':
            [$c, $m] = chatConvFor($me, str($b, 'conv', 24));
            $seq = min((int) ($b['seq'] ?? 0), (int) $c['last_seq']);
            if ($seq > (int) $m['last_read']) {
                cdb()->prepare('UPDATE chat_members SET last_read = ? WHERE conv = ? AND uid = ?')->execute([$seq, $c['id'], $uid]);
            }
            ok(['ok' => true]);

        case 'chat_typing':
            // {conv} while writing (the client repeats it every few seconds); {conv, stop} when the text is cleared
            [$c] = chatConvFor($me, str($b, 'conv', 24));
            chatPresenceSet($uid, !empty($b['stop']) ? '' : (string) $c['id']);
            ok(['ok' => true]);

        case 'chat_mute':
            [$c] = chatConvFor($me, str($b, 'conv', 24));
            cdb()->prepare('UPDATE chat_members SET muted = ? WHERE conv = ? AND uid = ?')->execute([!empty($b['on']) ? 1 : 0, $c['id'], $uid]);
            ok(['convs' => chatList($me)]);

        case 'chat_dm':
            $c = chatOpenDm($me, str($b, 'uid', 40));
            ok(['id' => $c['id'], 'convs' => chatList($me)]);

        case 'chat_group':
            $vis = chatVisible($me);
            $uids = array_values(array_unique(array_filter(array_map('strval', (array) ($b['uids'] ?? [])), fn($x) => isset($vis[$x]))));
            if (count($uids) < 2) {
                fail(400, 'invalid_argument', 'Pick at least two people for a group (for one person, send a direct message).');
            }
            if (count($uids) + 1 > CHAT_MAX_GROUP) {
                fail(400, 'invalid_argument', 'A group holds up to ' . CHAT_MAX_GROUP . ' people; use a channel for more.');
            }
            $id = 'g' . rid(8);
            $name = mb_substr(trim(str($b, 'name', 80)), 0, 80);
            chatTx(function (PDO $pdo) use ($id, $name, $uids, $me, $uid) {
                $rev = chatNext($pdo);
                $pdo->prepare('INSERT INTO chat_convs (id, kind, name, topic, private, aud, posting, def, dm_key, by_uid, created, rev, last_seq, last_at, last_text, archived) VALUES (?,\'group\',?,\'\',1,\'\',\'all\',0,\'\',?,?,?,0,?,\'\',0)')->execute([$id, $name, $uid, now(), $rev, now()]);
                foreach ([$uid, ...$uids] as $x) {
                    $pdo->prepare('INSERT INTO chat_members (conv, uid, role, joined, last_read, muted, mailed) VALUES (?,?,?,?,0,0,0)')->execute([$id, $x, $x === $uid ? 'owner' : 'member', now()]);
                }
                chatSysNote($pdo, $id, $me['name'] . ' started the group');
            });
            ok(['id' => $id, 'convs' => chatList($me)]);

        case 'chat_channel_save':
            $s = chatSettings();
            $id = str($b, 'id', 24);
            $name = chatSlug(str($b, 'name', 80));
            $topic = mb_substr(trim(str($b, 'topic', 300)), 0, 300);
            if ($name === '') {
                fail(400, 'invalid_argument', 'Name the channel (letters, numbers and dashes).');
            }
            $aud = ($b['aud'] ?? '') === 'all' && $me['ck'] === 'staff' ? 'all' : 'team';
            $private = !empty($b['private']) ? 1 : 0;
            $posting = ($b['posting'] ?? '') === 'staff' && $me['ck'] === 'staff' ? 'staff' : 'all';
            $dupe = cdb()->prepare("SELECT id FROM chat_convs WHERE kind = 'channel' AND name = ? AND id <> ?");
            $dupe->execute([$name, $id]);
            if ($dupe->fetchColumn()) {
                fail(400, 'invalid_argument', 'There is already a #' . $name . ' channel.');
            }
            if ($id !== '') {
                [$c, $m] = chatConvFor($me, $id, true);
                if ($c['kind'] !== 'channel' || ($m['role'] !== 'owner' && !chatIsAdmin($me))) {
                    fail(403, 'forbidden', 'Only the channel\'s owner or an administrator can change it.');
                }
                chatTx(function (PDO $pdo) use ($c, $name, $topic, $aud, $private, $posting, $me) {
                    $pdo->prepare('UPDATE chat_convs SET name = ?, topic = ?, aud = ?, private = ?, posting = ? WHERE id = ?')->execute([$name, $topic, $aud, $private, $posting, $c['id']]);
                    chatTouchConv($pdo, (string) $c['id']);
                    if ($c['name'] !== $name) {
                        chatSysNote($pdo, (string) $c['id'], $me['name'] . ' renamed the channel to #' . $name);
                    }
                });
                ok(['id' => $c['id'], 'convs' => chatList($me)]);
            }
            if ($me['ck'] !== 'staff' && !($s['channels'] === 'employee' && $me['ck'] === 'employee')) {
                fail(403, 'forbidden', 'Channels are created by StratEdge staff.');
            }
            $id = 'c' . rid(8);
            $vis = chatVisible($me);
            $invite = array_values(array_unique(array_filter(array_map('strval', (array) ($b['uids'] ?? [])), fn($x) => isset($vis[$x]) && chatAudienceHas($aud, $vis[$x]['k']))));
            chatTx(function (PDO $pdo) use ($id, $name, $topic, $private, $aud, $posting, $uid, $invite, $me) {
                $rev = chatNext($pdo);
                $pdo->prepare('INSERT INTO chat_convs (id, kind, name, topic, private, aud, posting, def, dm_key, by_uid, created, rev, last_seq, last_at, last_text, archived) VALUES (?,\'channel\',?,?,?,?,?,0,\'\',?,?,?,0,?,\'\',0)')->execute([$id, $name, $topic, $private, $aud, $posting, $uid, now(), $rev, now()]);
                foreach ([$uid, ...$invite] as $x) {
                    $pdo->prepare('INSERT INTO chat_members (conv, uid, role, joined, last_read, muted, mailed) VALUES (?,?,?,?,0,0,0)')->execute([$id, $x, $x === $uid ? 'owner' : 'member', now()]);
                }
                chatSysNote($pdo, $id, $me['name'] . ' created #' . $name);
            });
            ok(['id' => $id, 'convs' => chatList($me)]);

        case 'chat_channels':
            // public channels this person may join (and the ones they are in, marked)
            $st = cdb()->prepare("SELECT c.id, c.name, c.topic, c.aud, c.posting, c.last_at, (SELECT COUNT(*) FROM chat_members x WHERE x.conv = c.id) AS n,
                (SELECT COUNT(*) FROM chat_members y WHERE y.conv = c.id AND y.uid = ?) AS mine FROM chat_convs c WHERE c.kind = 'channel' AND c.private = 0 AND c.archived = 0 ORDER BY c.name");
            $st->execute([$uid]);
            ok(['channels' => array_values(array_map(fn($c) => ['id' => $c['id'], 'name' => $c['name'], 'topic' => $c['topic'], 'aud' => $c['aud'], 'n' => (int) $c['n'], 'mine' => (bool) (int) $c['mine'], 'lastAt' => (int) $c['last_at']], array_filter($st->fetchAll(), fn($c) => chatAudienceHas((string) $c['aud'], $me['ck']))))]);

        case 'chat_join':
            $c = chatConv(str($b, 'conv', 24));
            if (!$c || $c['kind'] !== 'channel' || (int) $c['private'] || (int) $c['archived'] || !chatAudienceHas((string) $c['aud'], $me['ck'])) {
                fail(404, 'not_found', 'That channel is not open to you.');
            }
            chatAddMember((string) $c['id'], $uid);
            $prefs = chatPrefs($uid);
            if (in_array($c['id'], $prefs['left'], true)) {
                $d = chatObj(docGet("chat/p/$uid"));
                $d['left'] = array_values(array_diff($prefs['left'], [$c['id']]));
                docSet("chat/p/$uid", json_decode((string) json_encode($d)));
            }
            ok(['id' => $c['id'], 'convs' => chatList($me)]);

        case 'chat_leave':
            [$c, $m] = chatConvFor($me, str($b, 'conv', 24));
            if ($c['kind'] === 'dm') {
                fail(400, 'invalid_argument', 'A direct message can be muted, not left.');
            }
            chatTx(function (PDO $pdo) use ($c, $uid, $me) {
                $pdo->prepare('DELETE FROM chat_members WHERE conv = ? AND uid = ?')->execute([$c['id'], $uid]);
                chatTouchConv($pdo, (string) $c['id']);
                chatSysNote($pdo, (string) $c['id'], $me['name'] . ' left');
            });
            if ((int) $c['def']) {
                $d = chatObj(docGet("chat/p/$uid"));
                $d['left'] = array_values(array_unique([...(array) ($d['left'] ?? []), $c['id']]));
                docSet("chat/p/$uid", json_decode((string) json_encode($d)));
            }
            ok(['convs' => chatList($me)]);

        case 'chat_members_add':
            [$c, $m] = chatConvFor($me, str($b, 'conv', 24), true);
            if ($c['kind'] === 'dm') {
                fail(400, 'invalid_argument', 'Start a group to talk with more people.');
            }
            if ($c['kind'] === 'channel' && (int) $c['private'] && $m['role'] !== 'owner' && !chatIsAdmin($me)) {
                fail(403, 'forbidden', 'Only the channel\'s owner adds people to a private channel.');
            }
            $vis = chatVisible($me);
            $have = chatMemberIds((string) $c['id']);
            $add = array_values(array_unique(array_filter(array_map('strval', (array) ($b['uids'] ?? [])), fn($x) => isset($vis[$x]) && !in_array($x, $have, true) && ($c['kind'] !== 'channel' || chatAudienceHas((string) $c['aud'], $vis[$x]['k'])))));
            if (!$add) {
                fail(400, 'invalid_argument', 'Pick people who are not in it yet.');
            }
            if ($c['kind'] === 'group' && count($have) + count($add) > CHAT_MAX_GROUP) {
                fail(400, 'invalid_argument', 'A group holds up to ' . CHAT_MAX_GROUP . ' people; make a channel instead.');
            }
            foreach ($add as $x) {
                chatAddMember((string) $c['id'], $x, 'member', true, $me);
            }
            ok(['convs' => chatList($me)]);

        case 'chat_members_remove':
            [$c, $m] = chatConvFor($me, str($b, 'conv', 24), true);
            $x = str($b, 'uid', 40);
            if ($c['kind'] === 'dm' || ($m['role'] !== 'owner' && !chatIsAdmin($me)) || $x === $uid) {
                fail(403, 'forbidden', 'Only the owner removes people (to leave, use Leave).');
            }
            chatTx(function (PDO $pdo) use ($c, $x, $me) {
                $pdo->prepare('DELETE FROM chat_members WHERE conv = ? AND uid = ?')->execute([$c['id'], $x]);
                chatTouchConv($pdo, (string) $c['id']);
                chatSysNote($pdo, (string) $c['id'], $me['name'] . ' removed ' . chatName($x));
            });
            ok(['convs' => chatList($me)]);

        case 'chat_rename':
            [$c, $m] = chatConvFor($me, str($b, 'conv', 24), true);
            if ($c['kind'] !== 'group') {
                fail(400, 'invalid_argument', 'Only a group is renamed here.');
            }
            $name = mb_substr(trim(str($b, 'name', 80)), 0, 80);
            chatTx(function (PDO $pdo) use ($c, $name, $me) {
                $pdo->prepare('UPDATE chat_convs SET name = ? WHERE id = ?')->execute([$name, $c['id']]);
                chatTouchConv($pdo, (string) $c['id']);
                chatSysNote($pdo, (string) $c['id'], $me['name'] . ($name !== '' ? ' named the group "' . $name . '"' : ' removed the group name'));
            });
            ok(['convs' => chatList($me)]);

        case 'chat_archive':
            $c = chatConv(str($b, 'conv', 24));
            $m = $c ? chatMember((string) $c['id'], $uid) : null;
            if (!$c || $c['kind'] !== 'channel' || (!chatIsAdmin($me) && (!$m || $m['role'] !== 'owner' || in_array($c['id'], ['general', 'announcements'], true)))) {
                fail(403, 'forbidden', 'Only the channel\'s owner or an administrator can archive it.');
            }
            chatTx(function (PDO $pdo) use ($c, $b) {
                $pdo->prepare('UPDATE chat_convs SET archived = ? WHERE id = ?')->execute([!empty($b['undo']) ? 0 : 1, $c['id']]);
                chatTouchConv($pdo, (string) $c['id']);
            });
            ok(['convs' => chatList($me)]);

        case 'chat_search':
            $q = mb_strtolower(trim(str($b, 'q', 100)));
            if (mb_strlen($q) < 2) {
                ok(['msgs' => []]);
            }
            $conv = str($b, 'conv', 24);
            $sql = "SELECT x.*, c.kind AS ckind, c.name AS cname FROM chat_msgs x JOIN chat_members m ON m.conv = x.conv AND m.uid = ? JOIN chat_convs c ON c.id = x.conv
                WHERE x.deleted = 0 AND x.kind = 'msg' AND (LOWER(x.body) LIKE ? ESCAPE '!' OR LOWER(x.atts) LIKE ? ESCAPE '!')" . ($conv !== '' ? ' AND x.conv = ?' : '') . ' ORDER BY x.seq DESC LIMIT 50';
            $st = cdb()->prepare($sql);
            // ! escapes the wildcards the same way in SQLite and MySQL
            $like = '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $q) . '%';
            $st->execute($conv !== '' ? [$uid, $like, $like, $conv] : [$uid, $like, $like]);
            $rows = $st->fetchAll();
            $outs = chatOut($rows);
            foreach ($outs as $i => &$o) {
                $o['c'] = (string) $rows[$i]['conv'];
            }
            unset($o);
            ok(['msgs' => $outs, 'names' => chatNamesOf($outs)]);

        case 'chat_prefs_save':
            $d = chatObj(docGet("chat/p/$uid"));
            $d['email'] = !empty($b['email']);
            docSet("chat/p/$uid", json_decode((string) json_encode($d)));
            ok(['prefs' => ['email' => $d['email']]]);

        case 'chat_admin':
            if (!chatIsAdmin($me)) {
                fail(403, 'forbidden', 'Administrators set up Messages.');
            }
            $counts = [];
            foreach (chatDirectory() as $p) {
                $counts[$p['k']] = ($counts[$p['k']] ?? 0) + 1;
            }
            $ch = cdb()->query("SELECT c.id, c.name, c.topic, c.private, c.aud, c.posting, c.def, c.archived, c.last_at, (SELECT COUNT(*) FROM chat_members x WHERE x.conv = c.id) AS n FROM chat_convs c WHERE c.kind = 'channel' ORDER BY c.archived, c.name")->fetchAll();
            ok(['settings' => chatSettings(), 'kinds' => CHAT_KINDS, 'counts' => $counts, 'channels' => array_map(fn($c) => ['id' => $c['id'], 'name' => $c['name'], 'topic' => $c['topic'], 'private' => (bool) $c['private'], 'aud' => $c['aud'], 'posting' => $c['posting'], 'def' => (bool) $c['def'], 'archived' => (bool) $c['archived'], 'n' => (int) $c['n'], 'lastAt' => (int) $c['last_at']], $ch)]);

        case 'chat_admin_save':
            if (!chatIsAdmin($me)) {
                fail(403, 'forbidden', 'Administrators set up Messages.');
            }
            $who = (array) ($b['who'] ?? []);
            docSet('chat/x/settings', json_decode((string) json_encode([
                'who' => ['consultant' => !empty($who['consultant']), 'outside' => !empty($who['outside']), 'student' => !empty($who['student']), 'client' => !empty($who['client'])],
                'channels' => ($b['channels'] ?? '') === 'staff' ? 'staff' : 'employee',
                'retention' => max(0, min(120, (int) ($b['retention'] ?? 0))),
                'mailAfter' => max(0, min(1440, (int) ($b['mailAfter'] ?? 15))),
                'edit' => !empty($b['edit']),
                'u' => now(),
            ])));
            if (function_exists('audit')) {
                audit('settings', 'Messages settings changed', 'chat', ['who' => $who, 'retention' => (int) ($b['retention'] ?? 0)], $me);
            }
            ok(['ok' => true]);
    }
    fail(404, 'not_found', 'Unknown action.');
}
/** A file sent in a conversation, for the people in it. */
function chatFile(): never
{
    $u = requireUser();
    $seq = (int) ($_GET['s'] ?? 0);
    $fid = (string) ($_GET['i'] ?? '');
    $x = $seq ? chatMsg($seq) : null;
    $atts = $x ? (json_decode((string) $x['atts'], true) ?: []) : [];
    $a = null;
    foreach ($atts as $y) {
        if (($y['i'] ?? '') === $fid) {
            $a = $y;
        }
    }
    $f = cfg('files_dir') . '/' . $fid;
    if (!$x || !$a || (int) $x['deleted'] || !preg_match('/^[a-f0-9]{32}$/', $fid) || !chatMember((string) $x['conv'], (string) $u['id']) || !is_file($f)) {
        http_response_code(404);
        exit('Not found');
    }
    $name = preg_replace('/[^A-Za-z0-9 ._()\-]/', '_', (string) ($a['n'] ?? 'file'));
    $ty = (string) ($a['ty'] ?? 'application/octet-stream');
    header('Content-Type: ' . $ty);
    header('Content-Length: ' . filePlainSize($f));
    if ($ty === 'application/pdf') {
        header_remove('Content-Security-Policy');
    } else {
        header("Content-Security-Policy: default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox; frame-ancestors 'self'");
    }
    $inline = str_starts_with($ty, 'image/') || in_array($ty, ['application/pdf', 'text/plain', 'text/csv', 'text/markdown', 'application/json'], true);
    header('Content-Disposition: ' . ($inline && ($_GET['dl'] ?? '') !== '1' ? 'inline' : 'attachment') . '; filename="' . $name . '"');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, max-age=3600');
    fileServePath($f);
    exit();
}
