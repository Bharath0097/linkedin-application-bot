<?php
declare(strict_types=1);
require_once __DIR__ . '/mail.php';
require_once __DIR__ . '/sso.php';

/*
 * Email address checks (which addresses are safe to send to), the bounce list, and the System health page.
 */
const MAIL_ROLE_LOCAL = ['info', 'sales', 'admin', 'support', 'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'hr', 'jobs', 'careers', 'contact', 'office', 'billing', 'accounts', 'help', 'team', 'marketing', 'webmaster', 'postmaster', 'abuse', 'security', 'privacy', 'newsletter', 'recruiting', 'recruitment', 'hello', 'mail'];
const MAIL_FREE = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'aol.com', 'icloud.com', 'protonmail.com', 'proton.me', 'live.com', 'msn.com', 'ymail.com', 'rediffmail.com', 'zoho.com', 'gmx.com', 'mail.com', 'yahoo.co.in', 'yahoo.in'];
const MAIL_TYPOS = [
    'gmial.com' => 'gmail.com', 'gamil.com' => 'gmail.com', 'gmal.com' => 'gmail.com', 'gmail.co' => 'gmail.com', 'gmail.con' => 'gmail.com',
    'gmail.cm' => 'gmail.com', 'gnail.com' => 'gmail.com', 'gmaill.com' => 'gmail.com', 'gmai.com' => 'gmail.com', 'yahooo.com' => 'yahoo.com',
    'yaho.com' => 'yahoo.com', 'yahoo.co' => 'yahoo.com', 'yahoo.con' => 'yahoo.com', 'hotmal.com' => 'hotmail.com', 'hotmial.com' => 'hotmail.com',
    'hotmai.com' => 'hotmail.com', 'hotmail.co' => 'hotmail.com', 'outlok.com' => 'outlook.com', 'outloook.com' => 'outlook.com', 'outlook.co' => 'outlook.com',
    'iclod.com' => 'icloud.com', 'icloud.co' => 'icloud.com',
];

// mailDomainOk() (does a domain take email?) moved to mailbulk.php in v34: DNS over HTTPS, and null MX means no
/* Every check is kept (mail_checks) and every address remembers its last result (mail_addr), so the next check,
   the compose page and the bounce sync can say "checked good on Sep 12" or "bounced on Oct 1". */
function mailCheckDb(): PDO
{
    static $ready = false;
    $pdo = mdb();
    if (!$ready) {
        $ready = true;
        $pdo->exec('CREATE TABLE IF NOT EXISTS mail_checks (id VARCHAR(24) PRIMARY KEY, at BIGINT NOT NULL, by_uid VARCHAR(40) NOT NULL, by_name VARCHAR(190) NOT NULL,
            label VARCHAR(160) NOT NULL, n INT NOT NULL, good INT NOT NULL, risky INT NOT NULL, bad INT NOT NULL, rows_json LONGTEXT NOT NULL)');
        $pdo->exec('CREATE TABLE IF NOT EXISTS mail_addr (email VARCHAR(190) PRIMARY KEY, st VARCHAR(8) NOT NULL, why VARCHAR(600) NOT NULL, fix VARCHAR(190) NOT NULL,
            checked_at BIGINT NOT NULL, checked_by VARCHAR(190) NOT NULL, checks INT NOT NULL, bounced_at BIGINT NOT NULL, bounce_why VARCHAR(300) NOT NULL, bounce_src VARCHAR(40) NOT NULL)');
        try {
            $pdo->exec('CREATE INDEX mail_checks_at ON mail_checks (at)');
        } catch (Throwable $e) {
            // already there
        }
    }
    return $pdo;
}
function mailAddrGet(array $emails): array
{
    $out = [];
    $emails = array_values(array_unique(array_filter(array_map(fn($e) => strtolower(trim((string) $e)), $emails))));
    if (!$emails) {
        return $out;
    }
    $pdo = mailCheckDb();
    foreach (array_chunk($emails, 300) as $chunk) {
        $st = $pdo->prepare('SELECT * FROM mail_addr WHERE email IN (' . implode(',', array_fill(0, count($chunk), '?')) . ')');
        $st->execute($chunk);
        foreach ($st->fetchAll() as $r) {
            $out[$r['email']] = [
                'st' => $r['st'],
                'why' => $r['why'],
                'fix' => $r['fix'],
                'at' => (int) $r['checked_at'],
                'by' => $r['checked_by'],
                'checks' => (int) $r['checks'],
                'bouncedAt' => (int) $r['bounced_at'],
                'bounceWhy' => $r['bounce_why'],
                'bounceSrc' => $r['bounce_src'],
            ];
        }
    }
    return $out;
}
function mailAddrRemember(array $row, string $byName): void
{
    $pdo = mailCheckDb();
    $pdo->prepare('UPDATE mail_addr SET st = ?, why = ?, fix = ?, checked_at = ?, checked_by = ?, checks = checks + 1 WHERE email = ?')
        ->execute([$row['st'], mb_substr(implode(' · ', $row['why']), 0, 600), mb_substr((string) $row['fix'], 0, 190), now(), mb_substr($byName, 0, 190), $row['e']]);
    $s = $pdo->prepare('SELECT email FROM mail_addr WHERE email = ?');
    $s->execute([$row['e']]);
    if (!$s->fetch()) {
        $pdo->prepare('INSERT INTO mail_addr (email, st, why, fix, checked_at, checked_by, checks, bounced_at, bounce_why, bounce_src) VALUES (?,?,?,?,?,?,1,0,\'\',\'\')')
            ->execute([$row['e'], $row['st'], mb_substr(implode(' · ', $row['why']), 0, 600), mb_substr((string) $row['fix'], 0, 190), now(), mb_substr($byName, 0, 190)]);
    }
}
/** A bounce or complaint learned from the mail service or a delivery-failure message: remembered, suppressed, and the sent log updated. */
function mailAddrBounced(string $email, string $why, string $src, int $at = 0): void
{
    $email = strtolower(trim($email));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return;
    }
    $pdo = mailCheckDb();
    $at = $at ?: now();
    $why = mb_substr($why, 0, 300);
    $s = $pdo->prepare('SELECT email FROM mail_addr WHERE email = ?');
    $s->execute([$email]);
    if ($s->fetch()) {
        $pdo->prepare("UPDATE mail_addr SET st = 'bad', why = ?, bounced_at = ?, bounce_why = ?, bounce_src = ? WHERE email = ?")
            ->execute(['Bounced: ' . $why, $at, $why, $src, $email]);
    } else {
        $pdo->prepare('INSERT INTO mail_addr (email, st, why, fix, checked_at, checked_by, checks, bounced_at, bounce_why, bounce_src) VALUES (?,?,?,?,?,?,0,?,?,?)')
            ->execute([$email, 'bad', 'Bounced: ' . $why, '', 0, '', $at, $why, $src]);
    }
    $sup = $pdo->prepare('SELECT email FROM mail_suppress WHERE email = ?');
    $sup->execute([$email]);
    if (!$sup->fetch()) {
        $pdo->prepare('INSERT INTO mail_suppress (email, at, why) VALUES (?,?,?)')->execute([$email, $at, str_contains(strtolower($why), 'complain') ? 'complained' : 'bounced']);
    }
    // the sent log: the newest send to that address becomes "bounced" (or "complained") with the reason
    try {
        $log = $pdo->prepare("SELECT id FROM mail_log WHERE to_email = ? AND status IN ('sent', 'delivered', 'queued') ORDER BY at DESC LIMIT 1");
        $log->execute([$email]);
        $id = $log->fetchColumn();
        if ($id) {
            $pdo->prepare('UPDATE mail_log SET status = ?, err = ? WHERE id = ?')->execute([str_contains(strtolower($why), 'complain') ? 'complained' : 'bounced', mb_substr($why, 0, 500), $id]);
        }
    } catch (Throwable $e) {
        // the log is optional
    }
}
/** Contacts that are safe to remove from the active address book: hard bounces, complaints, and clearly permanent recipient rejects.
 * Unsubscribes/manual suppressions are intentionally kept as contacts; temporary failures and policy/throttle rejects are not cleaned. */
function mailContactCleanupCandidates(): array
{
    $pdo = mailCheckDb();
    $signals = [];
    $putSignal = function (array $r, string $kind, string $why, int $at = 0) use (&$signals): void {
        $email = strtolower(trim((string) ($r['email'] ?? $r['to_email'] ?? '')));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return;
        }
        if (!isset($signals[$email]) || $at > (int) ($signals[$email]['at'] ?? 0)) {
            $signals[$email] = ['kind' => $kind, 'why' => mb_substr(trim($why), 0, 300), 'at' => $at];
        }
    };

    // Provider-confirmed hard bounces and spam complaints are already on the suppression list.
    $st = $pdo->query("SELECT c.email, s.why, s.at FROM mail_contacts c JOIN mail_suppress s ON LOWER(TRIM(s.email)) = LOWER(TRIM(c.email)) WHERE s.why IN ('bounced','complained') ORDER BY s.at DESC");
    foreach ($st->fetchAll() as $r) {
        $kind = (string) $r['why'] === 'complained' ? 'complained' : 'bounced';
        $putSignal($r, $kind, $kind === 'complained' ? 'Marked as spam / complaint' : 'Hard bounce', (int) $r['at']);
    }

    // A bounce remembered by the validation/bounce store remains authoritative even if the suppression row was imported later.
    $st = $pdo->query("SELECT c.email, a.bounced_at, a.bounce_why FROM mail_contacts c JOIN mail_addr a ON LOWER(TRIM(a.email)) = LOWER(TRIM(c.email)) WHERE a.bounced_at > 0 ORDER BY a.bounced_at DESC");
    foreach ($st->fetchAll() as $r) {
        $putSignal($r, 'bounced', (string) ($r['bounce_why'] ?: 'Hard bounce'), (int) $r['bounced_at']);
    }

    // Some transports first record a failed/rejected send before a webhook arrives. Only treat errors that clearly
    // identify a nonexistent/invalid recipient as permanent; 550 policy/spam errors by themselves are not enough.
    $hard = "/\\b5\\.1\\.[0-9]\\b|does not exist|no such user|user unknown|unknown user|couldn(?:'|’)?t be found|could not be found|invalid recipient|recipient address rejected|address rejected|bad destination mailbox address|mailbox (?:not found|does not exist)/i";
    $st = $pdo->query("SELECT c.email, l.status, l.err, l.at FROM mail_contacts c JOIN mail_log l ON LOWER(TRIM(l.to_email)) = LOWER(TRIM(c.email)) WHERE l.status IN ('failed','rejected','error','bounced','complained') ORDER BY l.at DESC LIMIT 20000");
    foreach ($st->fetchAll() as $r) {
        $status = strtolower((string) $r['status']);
        $err = trim((string) $r['err']);
        if ($status === 'bounced' || $status === 'complained') {
            $putSignal($r, $status === 'complained' ? 'complained' : 'bounced', $err !== '' ? $err : ucfirst($status), (int) $r['at']);
        } elseif ($err !== '' && preg_match($hard, $err)) {
            $putSignal($r, 'rejected', $err, (int) $r['at']);
        }
    }

    // Every active contact with the same normalized address is the same mailbox. If one casing/spacing variant has a
    // confirmed hard failure, all variants leave the active address book. The bounce/suppression record remains.
    $out = [];
    foreach ($pdo->query('SELECT id, email, name, company FROM mail_contacts')->fetchAll() as $c) {
        $email = strtolower(trim((string) $c['email']));
        if (!isset($signals[$email])) {
            continue;
        }
        $sig = $signals[$email];
        $out[] = [
            'id' => (string) $c['id'], 'email' => $email, 'name' => (string) $c['name'], 'company' => (string) $c['company'],
            'kind' => (string) $sig['kind'], 'why' => (string) $sig['why'], 'at' => (int) $sig['at'],
        ];
    }
    usort($out, fn($a, $b) => ($b['at'] <=> $a['at']) ?: strcmp($a['email'], $b['email']));
    return $out;
}

/** Exact-mailbox duplicates in the active contact list after trimming/lowercasing. Bad addresses are excluded because
 * they are removed instead of merged. */
function mailContactDuplicateGroups(array $badEmails = []): array
{
    $bad = array_fill_keys(array_map(fn($e) => strtolower(trim((string) $e)), $badEmails), true);
    $groups = [];
    foreach (mailCheckDb()->query('SELECT * FROM mail_contacts ORDER BY updated DESC, created ASC')->fetchAll() as $r) {
        $email = strtolower(trim((string) $r['email']));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || isset($bad[$email])) {
            continue;
        }
        $groups[$email][] = $r;
    }
    return array_filter($groups, fn($rows) => count($rows) > 1);
}

function mailContactMergeScore(array $r): int
{
    $n = 0;
    foreach (['name','company','title','phone','city','source'] as $k) {
        if (trim((string) ($r[$k] ?? '')) !== '') $n += 3;
    }
    $n += min(8, (int) floor(mb_strlen(trim((string) ($r['notes'] ?? ''))) / 80));
    $n += min(8, count(mailTagsList((string) ($r['tags'] ?? ''))));
    if ((int) ($r['last_sent'] ?? 0) > 0) $n += 2;
    return $n;
}

/** Preview or perform contact refinement without losing bounce/suppression memory.
 * It removes confirmed bad mailboxes and merges duplicate contacts by normalized email. */
function mailContactCleanup(bool $apply, array $u): array
{
    $pdo = mailCheckDb();
    $badRows = mailContactCleanupCandidates();
    $badEmails = array_values(array_unique(array_map(fn($r) => (string) $r['email'], $badRows)));
    $dups = mailContactDuplicateGroups($badEmails);
    $counts = ['bounced' => 0, 'rejected' => 0, 'complained' => 0];
    foreach ($badRows as $r) {
        $counts[$r['kind']] = ($counts[$r['kind']] ?? 0) + 1;
    }
    $dupRows = array_sum(array_map(fn($rows) => count($rows) - 1, $dups));
    $dupExamples = [];
    foreach ($dups as $email => $rows) {
        $dupExamples[] = ['email' => $email, 'copies' => count($rows)];
        if (count($dupExamples) >= 12) break;
    }
    $out = [
        'n' => count($badRows) + $dupRows,
        'bad' => count($badRows),
        'duplicates' => $dupRows,
        'duplicateGroups' => count($dups),
        'counts' => $counts,
        'examples' => array_map(fn($r) => ['email' => $r['email'], 'why' => $r['why'], 'kind' => $r['kind']], array_slice($badRows, 0, 12)),
        'duplicateExamples' => $dupExamples,
        'removed' => 0,
        'removedBad' => 0,
        'mergedDuplicates' => 0,
    ];
    if (!$apply || $out['n'] === 0) {
        return $out;
    }

    // Permanent rejects are remembered before their active contact rows disappear.
    foreach ($badRows as $r) {
        if ($r['kind'] === 'rejected') {
            mailAddrBounced($r['email'], $r['why'] !== '' ? $r['why'] : 'Permanent recipient rejection', 'contact-cleanup', (int) ($r['at'] ?: now()));
        }
    }

    $badIds = array_values(array_unique(array_filter(array_map(fn($r) => (string) $r['id'], $badRows))));
    $removedBad = 0;
    $merged = 0;
    $pdo->beginTransaction();
    try {
        // Merge duplicate fields/tags/notes first, then delete the extra rows, then normalize the keeper's email.
        foreach ($dups as $email => $rows) {
            usort($rows, function ($a, $b) {
                $d = mailContactMergeScore($b) <=> mailContactMergeScore($a);
                return $d !== 0 ? $d : ((int) $b['updated'] <=> (int) $a['updated']);
            });
            $keep = array_shift($rows);
            $mergedRow = $keep;
            $tags = mailTagsList((string) ($keep['tags'] ?? ''));
            $notes = trim((string) ($keep['notes'] ?? ''));
            $created = (int) ($keep['created'] ?? now());
            $lastSent = (int) ($keep['last_sent'] ?? 0);
            $sup = null;
            foreach (array_merge([$keep], $rows) as $r) {
                foreach (['name','company','title','phone','city','source'] as $k) {
                    if (trim((string) ($mergedRow[$k] ?? '')) === '' && trim((string) ($r[$k] ?? '')) !== '') $mergedRow[$k] = (string) $r[$k];
                }
                $tags = array_merge($tags, mailTagsList((string) ($r['tags'] ?? '')));
                $rn = trim((string) ($r['notes'] ?? ''));
                if ($rn !== '' && !str_contains("\n" . $notes . "\n", "\n" . $rn . "\n")) {
                    $notes .= ($notes !== '' ? "\n\n--- Merged duplicate contact ---\n" : '') . $rn;
                }
                $created = min($created ?: PHP_INT_MAX, (int) ($r['created'] ?? $created));
                $lastSent = max($lastSent, (int) ($r['last_sent'] ?? 0));
                $ss = $pdo->prepare('SELECT at, why FROM mail_suppress WHERE LOWER(TRIM(email)) = ? ORDER BY at DESC LIMIT 1');
                $ss->execute([$email]);
                $x = $ss->fetch();
                if ($x && (!$sup || (int) $x['at'] > (int) $sup['at'])) $sup = $x;
            }
            $delIds = array_map(fn($r) => (string) $r['id'], $rows);
            if ($delIds) {
                $q = $pdo->prepare('DELETE FROM mail_contacts WHERE id IN (' . implode(',', array_fill(0, count($delIds), '?')) . ')');
                $q->execute($delIds);
                $merged += $q->rowCount();
            }
            $pdo->prepare('UPDATE mail_contacts SET email=?, name=?, company=?, title=?, phone=?, city=?, tags=?, source=?, notes=?, created=?, updated=?, last_sent=? WHERE id=?')->execute([
                $email,
                mb_substr((string) ($mergedRow['name'] ?? ''), 0, 190), mb_substr((string) ($mergedRow['company'] ?? ''), 0, 190),
                mb_substr((string) ($mergedRow['title'] ?? ''), 0, 190), mb_substr((string) ($mergedRow['phone'] ?? ''), 0, 60),
                mb_substr((string) ($mergedRow['city'] ?? ''), 0, 120), mailTagsNorm($tags), mb_substr((string) ($mergedRow['source'] ?? ''), 0, 80),
                mb_substr($notes, 0, 12000), $created === PHP_INT_MAX ? now() : $created, now(), $lastSent, (string) $keep['id'],
            ]);
            if ($sup) {
                $pdo->prepare('REPLACE INTO mail_suppress (email, at, why) VALUES (?,?,?)')->execute([$email, (int) $sup['at'], (string) $sup['why']]);
            }
        }

        foreach (array_chunk($badIds, 300) as $chunk) {
            if (!$chunk) continue;
            $q = $pdo->prepare('DELETE FROM mail_contacts WHERE id IN (' . implode(',', array_fill(0, count($chunk), '?')) . ')');
            $q->execute($chunk);
            $removedBad += $q->rowCount();
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    $out['removedBad'] = $removedBad;
    $out['mergedDuplicates'] = $merged;
    $out['removed'] = $removedBad + $merged;
    audit('data', 'Email contacts refined', 'mail_contacts', [
        'removedBad' => $removedBad, 'mergedDuplicates' => $merged, 'duplicateGroups' => count($dups),
        'bounced' => $counts['bounced'], 'rejected' => $counts['rejected'], 'complained' => $counts['complained'],
    ], $u);
    return $out;
}

/** Pulls bounces and complaints from Mailgun's event log (for sites without the webhook, and as a catch-up). */
function mailBounceSync(bool $force = false): array
{
    $c = mailSettings();
    $last = mkvGet('bounce_sync', ['at' => 0, 'n' => 0, 'msg' => '']);
    if (!$force && (int) ($last['at'] ?? 0) > now() - 6 * 3600000) {
        return ['ran' => false, 'at' => (int) $last['at'], 'n' => (int) ($last['n'] ?? 0), 'msg' => (string) ($last['msg'] ?? 'Checked recently.')];
    }
    if (($c['provider'] ?? '') === 'ses_api' && ($c['user'] ?? '') !== '' && ($c['pass'] ?? '') !== '') {
        // v34: Amazon SES keeps bounced and complaining addresses on the account's suppression list
        [$n, $err] = sesSuppressionSync($c, max((int) ($last['at'] ?? 0) - 86400000, now() - 30 * 86400000));
        $res = ['ran' => true, 'at' => now(), 'n' => $n, 'msg' => $err !== '' ? $err : ($n ? $n . ' bounced or complaining address' . ($n === 1 ? '' : 'es') . ' brought in from Amazon SES.' : 'No new bounces at Amazon SES.')];
        mkvSet('bounce_sync', $res);
        return $res;
    }
    if (($c['provider'] ?? '') === 'postal') {
        $res = ['ran' => true, 'at' => now(), 'n' => 0, 'msg' => 'Your Postal server reports bounces as they happen through its webhook (Email › Sending setup).'];
        mkvSet('bounce_sync', $res);
        return $res;
    }
    if (($c['provider'] ?? '') !== 'mailgun' || ($c['host'] ?? '') === '' || ($c['pass'] ?? '') === '') {
        $res = ['ran' => true, 'at' => now(), 'n' => 0, 'msg' => 'Mailgun is not connected (Email › Sending setup), so bounces come only from delivery-failure messages in connected mailboxes.'];
        mkvSet('bounce_sync', $res);
        return $res;
    }
    if (!function_exists('curl_init')) {
        return ['ran' => true, 'at' => now(), 'n' => 0, 'msg' => 'cURL is not available on this server.'];
    }
    $base = MAILGUN_API[$c['region']] ?? MAILGUN_API['us'];
    $since = max((int) ($last['at'] ?? 0) - 86400000, now() - 30 * 86400000);
    $n = 0;
    $err = '';
    foreach ([['failed', 'permanent'], ['complained', '']] as [$event, $sev]) {
        $url = $base . '/' . rawurlencode($c['host']) . '/events?' . http_build_query(array_filter(['event' => $event, 'severity' => $sev, 'begin' => (int) ($since / 1000), 'ascending' => 'yes', 'limit' => 300]));
        for ($page = 0; $page < 10 && $url !== ''; $page++) {
            $h = curl_init();
            curl_setopt_array($h, [CURLOPT_URL => $url, CURLOPT_USERPWD => 'api:' . $c['pass'], CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_CONNECTTIMEOUT => 10]);
            $resp = curl_exec($h);
            $code = (int) curl_getinfo($h, CURLINFO_RESPONSE_CODE);
            $cerr = curl_error($h);
            curl_close($h);
            if ($resp === false || $cerr !== '') {
                $err = 'Could not reach the Mailgun API: ' . ($cerr ?: 'no response');
                break 2;
            }
            $j = json_decode((string) $resp, true);
            if ($code !== 200 || !is_array($j)) {
                $err = 'Mailgun answered ' . $code . (is_array($j) && isset($j['message']) ? ': ' . $j['message'] : '');
                break 2;
            }
            $items = (array) ($j['items'] ?? []);
            foreach ($items as $ev) {
                $rcpt = strtolower((string) ($ev['recipient'] ?? ''));
                $why = (string) (($ev['delivery-status']['description'] ?? '') ?: ($ev['delivery-status']['message'] ?? '') ?: ($ev['reason'] ?? $event));
                $at = (int) round(((float) ($ev['timestamp'] ?? 0)) * 1000);
                if ($rcpt !== '') {
                    // v34: through the delivery-event path, so the campaign the address came from is updated too
                    mailEvent($rcpt, $event === 'complained' ? 'complained' : 'bounced', $event === 'complained' ? '' : ($why !== '' ? $why : 'Bounced'), (string) ($ev['user-variables']['ref'] ?? ''), 'mailgun');
                    $n++;
                }
            }
            $url = count($items) >= 300 ? (string) ($j['paging']['next'] ?? '') : '';
        }
    }
    $res = ['ran' => true, 'at' => now(), 'n' => $n, 'msg' => $err !== '' ? $err : ($n ? $n . ' bounce' . ($n === 1 ? '' : 's') . ' and complaints brought in from Mailgun.' : 'No new bounces at Mailgun.')];
    mkvSet('bounce_sync', $res);
    return $res;
}
/** A delivery-failure message (Gmail, Outlook, most mail servers): the address it failed for and why. */
function mailParseDsn(string $fromE, string $subject, string $text): ?array
{
    $f = strtolower($fromE);
    $s = strtolower($subject);
    $isDsn = str_contains($f, 'mailer-daemon') || str_contains($f, 'postmaster') || preg_match('/delivery status notification|undeliverable|mail delivery failed|delivery has failed|returned mail|failure notice|undelivered mail/i', $s);
    if (!$isDsn) {
        return null;
    }
    $t = str_replace(["\r\n", "\r"], "\n", $text);
    $addr = '';
    foreach ([
        '/(?:was(?:n\'t| not) delivered to|could(?:n\'t| not) be delivered to|delivery to|the following address(?:es)? failed:?|failed permanently|recipient address rejected:?|final-recipient:\s*rfc822;?)\s*[<\[]?([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/i',
        '/[<\[]?([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})[>\]]?\s*(?:\n|:)?\s*(?:\(.*\))?\s*(?:the address|the email account|the recipient|user unknown|mailbox|does not exist|no such user)/i',
    ] as $re) {
        if (preg_match($re, $t, $m)) {
            $addr = strtolower($m[1]);
            break;
        }
    }
    if ($addr === '') {
        if (preg_match_all('/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i', $t, $all)) {
            foreach ($all[0] as $cand) {
                $cl = strtolower($cand);
                if (!str_contains($cl, 'mailer-daemon') && !str_contains($cl, 'postmaster') && !str_contains($cl, 'noreply') && !str_contains($cl, 'no-reply')) {
                    $addr = $cl;
                    break;
                }
            }
        }
    }
    if ($addr === '') {
        return null;
    }
    $why = 'Delivery failed';
    foreach (['/(?:the )?(?:address|email account|mailbox)[^\n]{0,80}(?:does(?:n\'t| not) exist|couldn\'t be found|not found|unable to receive)[^\n]{0,60}/i', '/(?:user unknown|no such user|mailbox (?:unavailable|full|not found)|recipient address rejected|does not like recipient|over quota|blocked|rejected)[^\n]{0,80}/i', '/5\.\d\.\d[^\n]{0,100}/'] as $re) {
        if (preg_match($re, $t, $m)) {
            $why = trim($m[0], " \t'\"`.,;:)(");
            break;
        }
    }
    // a full mailbox or a delay is not a dead address; an unknown user is
    $temp = preg_match('/temporar|delayed|will retry|try again later|try resending|resending your message|deferred|mailbox full|over quota|4\.\d\.\d/i', $t);
    $hard = preg_match('/5\.1\.[01]\b|does not exist|no such user|user unknown|unknown user|couldn\'t be found|could not be found|address rejected|recipient address rejected|not found|invalid recipient/i', $t);
    return ['email' => $addr, 'why' => mb_substr($why, 0, 200), 'permanent' => (bool) ($hard || !$temp)];
}
function mailCheckContext(): array
{
    $pdo = mdb();
    $ctx = ['suppress' => [], 'failed' => [], 'sentOk' => []];
    foreach ($pdo->query('SELECT email, why FROM mail_suppress')->fetchAll() as $r) {
        $ctx['suppress'][strtolower($r['email'])] = (string) $r['why'];
    }
    foreach ($pdo->query('SELECT to_email, status, err, at FROM mail_log ORDER BY at DESC LIMIT 6000')->fetchAll() as $r) {
        $e = strtolower((string) $r['to_email']);
        $st = (string) $r['status'];
        if (in_array($st, ['failed', 'bounced', 'error', 'complained', 'rejected'], true) || ((string) $r['err'] !== '' && $st !== 'sent' && $st !== 'delivered')) {
            if (!isset($ctx['failed'][$e]) && !isset($ctx['sentOk'][$e])) {
                $ctx['failed'][$e] = mb_substr((string) $r['err'] ?: $st, 0, 90);
            }
        } elseif (in_array($st, ['sent', 'delivered', 'opened', 'clicked'], true) && !isset($ctx['sentOk'][$e]) && !isset($ctx['failed'][$e])) {
            $ctx['sentOk'][$e] = date('M j, Y', (int) ($r['at'] / 1000));
        }
    }
    return $ctx;
}
function mailCheckOne(string $raw, array $ctx): ?array
{
    $e = strtolower(trim($raw, " \t\r\n<>\"'"));
    if ($e === '') {
        return null;
    }
    if (!filter_var($e, FILTER_VALIDATE_EMAIL) || !str_contains($e, '@')) {
        return ['e' => $e, 'st' => 'bad', 'why' => ['Not a valid address'], 'fix' => ''];
    }
    [$local, $dom] = explode('@', $e, 2);
    $why = [];
    $st = 'good';
    $fix = '';
    if (isset(MAIL_TYPOS[$dom])) {
        $st = 'bad';
        $fix = $local . '@' . MAIL_TYPOS[$dom];
        $why[] = 'Looks like a typo of ' . MAIL_TYPOS[$dom];
    }
    if (in_array($dom, FW_DISPOSABLE, true)) {
        $st = 'bad';
        $why[] = 'Throwaway email service';
    }
    if (isset($ctx['suppress'][$e])) {
        $st = 'bad';
        $why[] = 'Bounced or unsubscribed before (' . $ctx['suppress'][$e] . ')';
    } elseif (isset($ctx['failed'][$e])) {
        if ($st === 'good') {
            $st = 'risky';
        }
        $why[] = 'A previous send failed: ' . $ctx['failed'][$e];
    }
    if ($st !== 'bad') {
        $ok = mailDomainOk($dom);
        if ($ok === false) {
            $st = 'bad';
            $why[] = 'No mail server found for ' . $dom;
        } elseif ($ok === null) {
            $why[] = 'Mail server not checked (DNS lookups are off on this server)';
        }
    }
    if (in_array($local, MAIL_ROLE_LOCAL, true) || str_starts_with($local, 'noreply') || str_starts_with($local, 'no-reply')) {
        if ($st === 'good') {
            $st = 'risky';
        }
        $why[] = 'Role address, often unread';
    }
    if (in_array($dom, MAIL_FREE, true)) {
        $why[] = 'Personal mailbox';
    }
    if (isset($ctx['sentOk'][$e])) {
        $why[] = 'Delivered before (' . $ctx['sentOk'][$e] . ')';
    }
    return ['e' => $e, 'st' => $st, 'why' => $why, 'fix' => $fix];
}
function tailOf(string $file, int $lines = 25): array
{
    if (!is_file($file)) {
        return [];
    }
    $size = filesize($file);
    $fh = fopen($file, 'r');
    if (!$fh) {
        return [];
    }
    fseek($fh, max(0, $size - 24000));
    $txt = (string) stream_get_contents($fh);
    fclose($fh);
    $all = array_values(array_filter(explode("\n", $txt), fn($l) => trim($l) !== ''));
    return array_slice($all, -$lines);
}

/** Hosted language models that speak the standard chat-completions API; the admin picks one and pastes a key. */
const AI_PRESETS = [
    ['k' => 'openai', 'n' => 'OpenAI', 'url' => 'https://api.openai.com/v1/chat/completions', 'model' => 'gpt-4o-mini', 'keys' => 'https://platform.openai.com/api-keys', 'note' => 'Pay as you go; gpt-4o-mini is inexpensive and good for briefs, quizzes and summaries. Add billing credit first (Settings > Billing).'],
    ['k' => 'anthropic', 'n' => 'Anthropic (Claude)', 'url' => 'https://api.anthropic.com/v1/chat/completions', 'model' => 'claude-sonnet-4-5', 'keys' => 'https://console.anthropic.com/settings/keys', 'note' => 'Uses Anthropic\'s OpenAI-compatible endpoint. Copy the exact model name from the console if this one is retired.'],
    ['k' => 'groq', 'n' => 'Groq', 'url' => 'https://api.groq.com/openai/v1/chat/completions', 'model' => 'llama-3.3-70b-versatile', 'keys' => 'https://console.groq.com/keys', 'note' => 'Very fast open models with a free tier; fine for briefs and quizzes.'],
    ['k' => 'gemini', 'n' => 'Google Gemini', 'url' => 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', 'model' => 'gemini-2.5-flash', 'keys' => 'https://aistudio.google.com/apikey', 'note' => 'Google AI Studio key; a free tier exists.'],
    ['k' => 'mistral', 'n' => 'Mistral', 'url' => 'https://api.mistral.ai/v1/chat/completions', 'model' => 'mistral-small-latest', 'keys' => 'https://console.mistral.ai/api-keys', 'note' => 'European provider; small models are inexpensive.'],
    ['k' => 'deepseek', 'n' => 'DeepSeek', 'url' => 'https://api.deepseek.com/chat/completions', 'model' => 'deepseek-chat', 'keys' => 'https://platform.deepseek.com/api_keys', 'note' => 'Low cost; data is processed outside the US.'],
    ['k' => 'openrouter', 'n' => 'OpenRouter', 'url' => 'https://openrouter.ai/api/v1/chat/completions', 'model' => 'openai/gpt-4o-mini', 'keys' => 'https://openrouter.ai/keys', 'note' => 'One key for many models; the model name includes the vendor prefix.'],
    ['k' => 'other', 'n' => 'Other (OpenAI-compatible)', 'url' => '', 'model' => '', 'keys' => '', 'note' => 'Any service with a /v1/chat/completions endpoint and a Bearer key (Azure OpenAI, Together, Fireworks, a self-hosted Ollama or vLLM behind https).'],
];
function aiSettingsOut(): array
{
    $d = docGet('sec/x/ai/cfg');
    $a = aiCfg(true);
    return [
        'url' => trim((string) ($d->url ?? '')),
        'model' => trim((string) ($d->model ?? '')),
        'hasKey' => (string) ($d->key ?? '') !== '',
        'keyHint' => (string) ($d->hint ?? ''),
        'from' => $a['from'],
        'configFile' => (string) cfg('assistant_api_key') !== '' ? ['url' => (string) cfg('assistant_api_url'), 'model' => (string) cfg('assistant_model')] : null,
        'at' => (int) ($d->at ?? 0),
        'by' => (string) ($d->by ?? ''),
        'okAt' => (int) ($d->okAt ?? 0),
        'okModel' => (string) ($d->okModel ?? ''),
        'ready' => aiReady(),
        'curl' => function_exists('curl_init'),
        'features' => aiFeatures(true),
        'featureList' => array_map(fn($k, $v) => ['k' => $k, 'n' => $v[0], 'd' => $v[1]], array_keys(AI_FEATURES), array_values(AI_FEATURES)),
        'presets' => AI_PRESETS,
        'uses' => [],
    ];
}
function toolsRoute(string $r, string $method, array $b): never
{
    if (str_starts_with($r, 'mail_')) {
        require_once __DIR__ . '/mail.php';
        mailUser();
    }
    switch ($r) {
        case 'ai_settings': {
            $u = requireAdmin();
            if (!hasRole($u, 'admin')) {
                fail(403, 'invalid_argument', 'Administrators only.');
            }
            ok(aiSettingsOut());
        }
        case 'ai_settings_save': {
            $u = requireAdmin();
            if (!hasRole($u, 'admin')) {
                fail(403, 'invalid_argument', 'Administrators only.');
            }
            $url = trim(mb_substr((string) ($b['url'] ?? ''), 0, 300));
            $model = trim(mb_substr((string) ($b['model'] ?? ''), 0, 120));
            $key = trim(mb_substr((string) ($b['key'] ?? ''), 0, 400));
            if ($url !== '' && !preg_match('#^https://[^\s]+$#', $url) && !preg_match('#^http://(127\.0\.0\.1|localhost)[:/]#', $url)) {
                fail(400, 'invalid_argument', 'The API URL must start with https:// (the full chat-completions address, for example https://api.openai.com/v1/chat/completions).');
            }
            if ($url !== '' && !str_contains($url, 'chat/completions')) {
                fail(400, 'invalid_argument', 'Paste the full chat-completions address, ending in /chat/completions (a base URL alone will not answer).');
            }
            $doc = docGet('sec/x/ai/cfg') ?? new stdClass();
            if (!empty($b['clear'])) {
                $doc = new stdClass();
            } else {
                $doc->url = $url;
                $doc->model = $model;
                if ($key !== '') {
                    require_once __DIR__ . '/mail.php';
                    $doc->key = mailSeal($key);
                    $doc->hint = mb_substr($key, 0, 3) . '…' . mb_substr($key, -4);
                    unset($doc->okAt, $doc->okModel);
                }
                $doc->at = now();
                $doc->by = (string) ($u['email'] ?? '');
            }
            docSet('sec/x/ai/cfg', $doc);
            ok(aiSettingsOut());
        }
        case 'ai_features_save': {
            // the master switch and one switch per place the assistant is used
            $u = requireAdmin();
            if (!hasRole($u, 'admin')) {
                fail(403, 'invalid_argument', 'Administrators only.');
            }
            $in = (array) ($b['features'] ?? []);
            $doc = new stdClass();
            $doc->on = !array_key_exists('on', $in) || !empty($in['on']);
            foreach (array_keys(AI_FEATURES) as $k) {
                $doc->$k = !array_key_exists($k, $in) || !empty($in[$k]);
            }
            $doc->at = now();
            $doc->by = (string) ($u['email'] ?? '');
            docSet('sec/x/ai/features', $doc);
            ok(aiSettingsOut());
        }
        case 'ai_test': {
            // one tiny request to the configured model, and what went wrong in plain words when it did not answer
            $u = requireAdmin();
            if (!hasRole($u, 'admin')) {
                fail(403, 'invalid_argument', 'Administrators only.');
            }
            $a = aiCfg();
            if (!function_exists('curl_init')) {
                ok(['ok' => false, 'what' => 'PHP on this server has no curl extension, so it cannot call any assistant. Ask the host to enable php-curl.']);
            }
            if ($a['url'] === '' || $a['key'] === '' || $a['model'] === '') {
                ok(['ok' => false, 'what' => 'Fill in the API URL, the API key and the model name, save, then test.']);
            }
            $t0 = microtime(true);
            [$code, $j, $err] = aiPost(['max_tokens' => 20, 'temperature' => 0, 'messages' => [['role' => 'user', 'content' => 'Reply with the single word OK.']]], 30);
            $ms = (int) round((microtime(true) - $t0) * 1000);
            $text = is_array($j) ? trim((string) ($j['choices'][0]['message']['content'] ?? '')) : '';
            $e = is_array($j) ? ($j['error'] ?? ($j['message'] ?? '')) : mb_substr(strip_tags((string) $j), 0, 200);
            if (is_array($e)) {
                $e = (string) ($e['message'] ?? json_encode($e));
            }
            $emsg = mb_substr(trim((string) $e), 0, 240);
            if ($text !== '') {
                $doc = docGet('sec/x/ai/cfg') ?? new stdClass();
                if ($a['from'] === 'settings') {
                    $doc->okAt = now();
                    $doc->okModel = $a['model'];
                    docSet('sec/x/ai/cfg', $doc);
                }
                $on = array_keys(array_filter(aiFeatures(true), fn($v, $k) => $k !== 'on' && $v, ARRAY_FILTER_USE_BOTH));
                ok(['ok' => true, 'what' => 'The assistant answered in ' . $ms . ' ms (' . $a['model'] . '): "' . mb_substr($text, 0, 60) . '". ' . (aiFeatures()['on'] ? count($on) . ' of ' . count(AI_FEATURES) . ' AI features are switched on (list below).' : 'All AI features are switched off below.'), 'ms' => $ms]);
            }
            if ($code === 0) {
                ok(['ok' => false, 'what' => 'The server could not reach ' . parse_url($a['url'], PHP_URL_HOST) . ' (' . ($err !== '' ? $err : 'no answer') . '). Outbound connections may be blocked on this host; ask the host to allow https to that address.']);
            }
            $hay = strtolower($emsg);
            if ($code === 401 || $code === 403 || str_contains($hay, 'api key') || str_contains($hay, 'invalid_api_key') || str_contains($hay, 'authentication')) {
                ok(['ok' => false, 'what' => 'The provider rejected the API key (' . $code . ($emsg !== '' ? ': ' . $emsg : '') . '). Create a new key in the provider console and paste it again; make sure the key belongs to the same provider as the URL.']);
            }
            if ($code === 404 || str_contains($hay, 'model') && (str_contains($hay, 'not found') || str_contains($hay, 'does not exist') || str_contains($hay, 'not exist') || str_contains($hay, 'unknown') || str_contains($hay, 'invalid model') || str_contains($hay, 'decommissioned') || str_contains($hay, 'not supported'))) {
                ok(['ok' => false, 'what' => ($code === 404 && !str_contains($hay, 'model') ? 'Nothing answers at that URL (404): it must be the full chat-completions address, for example https://api.openai.com/v1/chat/completions. ' : 'The model name was not accepted (' . $emsg . '): copy the exact model name from the provider\'s model list. ')]);
            }
            if ($code === 429 || str_contains($hay, 'quota') || str_contains($hay, 'billing') || str_contains($hay, 'insufficient') || str_contains($hay, 'rate limit')) {
                ok(['ok' => false, 'what' => 'The provider refused for quota or billing reasons (' . $code . ($emsg !== '' ? ': ' . $emsg : '') . '). Add credit or billing to the account that owns the key, or wait and try again.']);
            }
            ok(['ok' => false, 'what' => 'The provider answered ' . $code . ($emsg !== '' ? ' - ' . $emsg : ' without a usable reply') . '. Check the URL, the model name and the key together on the provider\'s documentation.']);
        }
        case 'admin_cleanup_gz':
            // deletes the pre-compressed copies older versions shipped (System health > Version & upload)
            $u = requireAdmin();
            if (!hasRole($u, 'admin')) {
                fail(403, 'invalid_argument', 'Administrators only.');
            }
            $root = dirname(__DIR__);
            $gone = [];
            foreach (siteLeftovers() as $rel) {
                if (preg_match('#^(js|css)(/[A-Za-z0-9_.\-]+)*\.gz$#', $rel) && @unlink($root . '/' . $rel)) {
                    $gone[] = $rel;
                }
            }
            if (function_exists('apcu_delete')) {
                apcu_delete('se_upload_issues');
            }
            ok(['removed' => $gone, 'left' => siteLeftovers()]);
        case 'mail_check':
            $u = requireUser();
            if (throttleHit('mail_check:' . $u['id'], 40, 3600)) {
                fail(429, 'rate_limited', 'Address checks run at most 40 times an hour.');
            }
            $in = $b['emails'] ?? '';
            $parts = preg_split('/[\s,;]+/', is_array($in) ? implode("\n", $in) : (string) $in) ?: [];
            $seen = [];
            $rows = [];
            $dups = 0;
            $ctx = mailCheckContext();
            foreach ($parts as $p) {
                $e = strtolower(trim($p, " \t\r\n<>\"'"));
                if ($e === '') {
                    continue;
                }
                if (isset($seen[$e])) {
                    $dups++;
                    continue;
                }
                $seen[$e] = true;
                if (count($rows) >= 300) {
                    break;
                }
                $row = mailCheckOne($e, $ctx);
                if ($row) {
                    $rows[] = $row;
                }
            }
            $sum = ['good' => 0, 'risky' => 0, 'bad' => 0];
            $known = mailAddrGet(array_map(fn($r) => $r['e'], $rows));
            $meDoc = docGet('u/' . $u['id']);
            $byName = (string) ($meDoc->p->n ?? $u['name']);
            foreach ($rows as $i => $row) {
                $sum[$row['st']]++;
                $k = $known[$row['e']] ?? null;
                // what was known before this check: the last result and any bounce since
                $rows[$i]['last'] = $k && $k['at'] ? ['at' => $k['at'], 'st' => $k['st'], 'by' => $k['by']] : null;
                $rows[$i]['bounced'] = $k && $k['bouncedAt'] ? ['at' => $k['bouncedAt'], 'why' => $k['bounceWhy'], 'src' => $k['bounceSrc']] : null;
                if ($rows[$i]['bounced'] && $row['st'] !== 'bad') {
                    $rows[$i]['st'] = 'bad';
                    $rows[$i]['why'][] = 'Bounced ' . date('M j, Y', (int) ($k['bouncedAt'] / 1000)) . ($k['bounceWhy'] !== '' ? ': ' . $k['bounceWhy'] : '');
                    $sum[$row['st']]--;
                    $sum['bad']++;
                }
                mailAddrRemember($rows[$i], $byName);
            }
            $sid = '';
            if (($b['save'] ?? true) !== false && $rows) {
                $sid = rid(8);
                $label = mb_substr(trim((string) ($b['label'] ?? '')), 0, 160);
                mailCheckDb()->prepare('INSERT INTO mail_checks (id, at, by_uid, by_name, label, n, good, risky, bad, rows_json) VALUES (?,?,?,?,?,?,?,?,?,?)')
                    ->execute([$sid, now(), $u['id'], $byName, $label, count($rows), $sum['good'], $sum['risky'], $sum['bad'], json_encode($rows, JSON_UNESCAPED_UNICODE)]);
            }
            ok(['rows' => $rows, 'summary' => $sum, 'duplicates' => $dups, 'capped' => count($parts) > 300, 'id' => $sid]);
        /* ---- the history of checks, what is known about an address, and the bounce sync ---- */
        case 'mail_check_sessions':
            requireUser();
            $pdo = mailCheckDb();
            $list = $pdo->query('SELECT id, at, by_uid, by_name, label, n, good, risky, bad FROM mail_checks ORDER BY at DESC LIMIT 200')->fetchAll();
            $list = array_map(function ($r) {
                $r['at'] = (int) $r['at'];
                foreach (['n', 'good', 'risky', 'bad'] as $k) {
                    $r[$k] = (int) $r[$k];
                }
                return $r;
            }, $list);
            $sync = mkvGet('bounce_sync', ['at' => 0, 'n' => 0, 'msg' => '']);
            $recent = $pdo->query('SELECT email, bounced_at, bounce_why, bounce_src FROM mail_addr WHERE bounced_at > 0 ORDER BY bounced_at DESC LIMIT 100')->fetchAll();
            $recent = array_map(function ($r) {
                $r['bounced_at'] = (int) $r['bounced_at'];
                return $r;
            }, $recent);
            // who sent to those addresses, so the right person hears about it
            $senders = [];
            if ($recent) {
                $emails = array_map(fn($r) => $r['email'], $recent);
                foreach (array_chunk($emails, 100) as $chunk) {
                    $st = $pdo->prepare('SELECT to_email, by_uid, MAX(at) AS at FROM mail_log WHERE to_email IN (' . implode(',', array_fill(0, count($chunk), '?')) . ') GROUP BY to_email, by_uid');
                    $st->execute($chunk);
                    foreach ($st->fetchAll() as $x) {
                        $senders[$x['to_email']][] = $x['by_uid'];
                    }
                    try {
                        $st = mymailDb()->prepare('SELECT to_email, uid FROM mail_user_msgs WHERE dir = \'out\' AND to_email IN (' . implode(',', array_fill(0, count($chunk), '?')) . ') GROUP BY to_email, uid');
                        $st->execute($chunk);
                        foreach ($st->fetchAll() as $x) {
                            $senders[$x['to_email']][] = $x['uid'];
                        }
                    } catch (Throwable $e) {
                        // no personal mailboxes yet
                    }
                }
            }
            $names = [];
            $ids = array_values(array_unique(array_merge(...array_values($senders) ?: [[]])));
            if ($ids) {
                $st = db()->prepare('SELECT id, name FROM users WHERE id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')');
                $st->execute($ids);
                foreach ($st->fetchAll() as $x) {
                    $names[$x['id']] = $x['name'];
                }
            }
            foreach ($recent as $i => $r) {
                $recent[$i]['senders'] = array_values(array_unique(array_map(fn($id) => $names[$id] ?? '', array_unique($senders[$r['email']] ?? []))));
            }
            $stats = $pdo->query('SELECT COUNT(*) AS n, SUM(CASE WHEN bounced_at > 0 THEN 1 ELSE 0 END) AS b, SUM(CASE WHEN st = \'good\' THEN 1 ELSE 0 END) AS g FROM mail_addr')->fetch();
            ok(['sessions' => $list, 'sync' => $sync, 'recent' => $recent, 'known' => ['n' => (int) ($stats['n'] ?? 0), 'bounced' => (int) ($stats['b'] ?? 0), 'good' => (int) ($stats['g'] ?? 0)]]);
        case 'mail_check_session':
            requireUser();
            $st = mailCheckDb()->prepare('SELECT * FROM mail_checks WHERE id = ?');
            $st->execute([str($b, 'id', 24)]);
            $r = $st->fetch();
            if (!$r) {
                fail(404, 'not_found', 'That check is gone.');
            }
            $rows = json_decode((string) $r['rows_json'], true) ?: [];
            unset($r['rows_json']);
            $r['at'] = (int) $r['at'];
            ok(['session' => $r, 'rows' => $rows]);
        case 'mail_check_delete':
            $u = requireUser();
            $st = mailCheckDb()->prepare('DELETE FROM mail_checks WHERE id = ? AND (by_uid = ? OR ? = 1)');
            $st->execute([str($b, 'id', 24), $u['id'], userLevel($u) >= 2 ? 1 : 0]);
            ok(['ok' => true]);
        case 'mail_check_label':
            $u = requireUser();
            mailCheckDb()->prepare('UPDATE mail_checks SET label = ? WHERE id = ? AND (by_uid = ? OR ? = 1)')->execute([mb_substr(str($b, 'label', 160), 0, 160), str($b, 'id', 24), $u['id'], userLevel($u) >= 2 ? 1 : 0]);
            ok(['ok' => true]);
        case 'mail_addr_lookup':
            requireUser();
            $emails = (array) ($b['emails'] ?? []);
            $q = trim(str($b, 'q', 100));
            if ($q !== '') {
                $st = mailCheckDb()->prepare('SELECT * FROM mail_addr WHERE email LIKE ? ORDER BY checked_at DESC LIMIT 200');
                $st->execute(['%' . strtolower($q) . '%']);
                $rows = array_map(fn($r) => ['e' => $r['email'], 'st' => $r['st'], 'why' => $r['why'], 'at' => (int) $r['checked_at'], 'by' => $r['checked_by'], 'checks' => (int) $r['checks'], 'bouncedAt' => (int) $r['bounced_at'], 'bounceWhy' => $r['bounce_why'], 'bounceSrc' => $r['bounce_src']], $st->fetchAll());
                ok(['rows' => $rows]);
            }
            ok(['known' => mailAddrGet(array_slice($emails, 0, 500))]);
        case 'mail_bounce_sync':
            requireUser();
            ok(mailBounceSync(($b['force'] ?? true) !== false));
        case 'mail_bounces':
            mailUser();
            $pdo = mdb();
            $sup = $pdo->query('SELECT email, at, why FROM mail_suppress ORDER BY at DESC LIMIT 500')->fetchAll();
            $st = $pdo->prepare("SELECT to_email, to_name, subject, status, err, at FROM mail_log WHERE status NOT IN ('sent', 'delivered', 'opened', 'clicked', 'queued') ORDER BY at DESC LIMIT 200");
            $st->execute();
            ok(['suppressed' => $sup, 'failed' => $st->fetchAll()]);
        case 'mail_unsuppress':
            mailUser();
            $e = strtolower(trim(str($b, 'email', 190)));
            // v83: privacy erasures and opt-outs only by an administrator; audited
            mailUnsuppress($e);
            ok(['ok' => true]);
        case 'mail_contacts_cleanup':
            $u = mailUser();
            ok(mailContactCleanup(!empty($b['apply']), $u));
        case 'health':
            $me = requireAdmin();
            if (!hasRole($me, 'admin')) {
                fail(403, 'invalid_argument', 'Administrators only.');
            }
            $pdo = db();
            $driver = (string) $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
            $store = storeDir();
            $t = microtime(true);
            $docs = (int) $pdo->query('SELECT COUNT(*) FROM docs')->fetchColumn();
            $countMs = (int) ((microtime(true) - $t) * 1000);
            $cols = $pdo->query('SELECT col, COUNT(*) AS n, SUM(LENGTH(data)) AS b FROM docs GROUP BY col ORDER BY b DESC LIMIT 12')->fetchAll();
            $big = $pdo->query('SELECT path, LENGTH(data) AS b FROM docs ORDER BY b DESC LIMIT 8')->fetchAll();
            $t = microtime(true);
            $uCount = 0;
            foreach ($pdo->query("SELECT data FROM docs WHERE col = 'u'")->fetchAll() as $row) {
                json_decode((string) $row['data']);
                $uCount++;
            }
            $listMs = (int) ((microtime(true) - $t) * 1000);
            $journal = $driver === 'sqlite' ? (string) $pdo->query('PRAGMA journal_mode')->fetchColumn() : '';
            $dbFile = $driver === 'sqlite' ? $store . '/app.sqlite' : '';
            $checks = [
                ['HTTPS', !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off', 'Serve the site over https so logins and cookies are protected.'],
                ['cURL (email services, sign-in providers)', function_exists('curl_init'), 'Ask the host to enable the PHP curl extension.'],
                ['mbstring', function_exists('mb_substr'), 'Ask the host to enable the PHP mbstring extension.'],
                ['OpenSSL (SMTP over TLS)', function_exists('openssl_encrypt'), 'Ask the host to enable the PHP openssl extension.'],
                ['DNS lookups (email checks)', function_exists('checkdnsrr') && @checkdnsrr('gmail.com.', 'MX'), 'Email address checks will skip the mail-server test.'],
                ['Database write-ahead log (SQLite)', $driver !== 'sqlite' || strtolower($journal) === 'wal', 'Readers and writers would block each other; make sure the storage folder is writable.'],
                ['Storage folder writable', is_writable($store), 'Uploads, logs and the database need write access to storage/.'],
                ['Script cache (OPcache)', function_exists('opcache_get_status') && (bool) ini_get('opcache.enable'), 'PHP runs faster with OPcache on; most hosts offer it under PHP settings.'],
                ['Memory limit at least 128 MB', (int) ini_get('memory_limit') >= 128 || (int) ini_get('memory_limit') === -1, 'Raise memory_limit in the host\'s PHP settings.'],
                ['Script time limit at least 30 s', (int) ini_get('max_execution_time') === 0 || (int) ini_get('max_execution_time') >= 30, 'Raise max_execution_time in the host\'s PHP settings.'],
            ];
            $throttles = 0;
            try {
                $throttles = (int) $pdo->query('SELECT COUNT(*) FROM throttle')->fetchColumn();
            } catch (Throwable $e) {
                $throttles = -1;
            }
            $mods = function_exists('apache_get_modules') ? array_map('strval', (array) apache_get_modules()) : null;
            $root = dirname(__DIR__);
            ok([
                'php' => PHP_VERSION,
                'sapi' => PHP_SAPI,
                'protocol' => (string) ($_SERVER['SERVER_PROTOCOL'] ?? ''),
                'opcache' => function_exists('opcache_get_status') && (bool) ini_get('opcache.enable'),
                'apcu' => function_exists('apcu_fetch') && (bool) ini_get('apc.enabled'),
                'modules' => $mods === null ? null : ['deflate' => in_array('mod_deflate', $mods, true), 'brotli' => in_array('mod_brotli', $mods, true), 'headers' => in_array('mod_headers', $mods, true), 'rewrite' => in_array('mod_rewrite', $mods, true)],
                'gz' => false, // pre-compressed copies are no longer shipped (v30.1)
                'reqMs' => (int) ((microtime(true) - (float) ($GLOBALS['reqStart'] ?? microtime(true))) * 1000),
                'server' => (string) ($_SERVER['SERVER_SOFTWARE'] ?? ''),
                'memory' => (string) ini_get('memory_limit'),
                'peak' => round(memory_get_peak_usage(true) / 1048576, 1),
                'execTime' => (string) ini_get('max_execution_time'),
                'upload' => (string) ini_get('upload_max_filesize'),
                'post' => (string) ini_get('post_max_size'),
                'sessionLife' => (string) ini_get('session.gc_maxlifetime'),
                'driver' => $driver,
                'journal' => $journal,
                'dbSize' => $dbFile !== '' && is_file($dbFile) ? filesize($dbFile) : 0,
                'docs' => $docs,
                'countMs' => $countMs,
                'listMs' => $listMs,
                'people' => $uCount,
                'cols' => $cols,
                'big' => $big,
                'throttles' => $throttles,
                'disk' => @disk_free_space($store) ?: 0,
                'checks' => $checks,
                'slow' => tailOf($store . '/slow.log', 30),
                'errors' => tailOf($store . '/error.log', 25),
                'mail' => tailOf($store . '/mail.log', 20),
                'build' => siteBuild(),
                'version' => siteVersionInfo(),
                'time' => date('c'),
                'url' => siteUrl(),
            ]);
        default:
            fail(404, 'not_found', 'Unknown action.');
    }
}
