<?php
declare(strict_types=1);
/*
 * v41 Calendars. Each person can connect their Google Calendar or their Microsoft 365 / Outlook.com calendar (OAuth,
 * through the apps set up under Roles & access › Sign-in providers; their primary calendar). Then:
 *   - scheduling an interview shows the panel's busy times that day (Google free/busy; for Outlook the calendar view
 *     with only start, end and "show as": times only, never what the meetings are) next to the interviews already in
 *     the portal, and warns about clashes;
 *   - "From my calendar" puts the interview in the organiser's calendar with the candidate and the panel as guests:
 *     Google or Outlook sends the invitations, with a Google Meet or Teams link when asked;
 *   - changing or cancelling it in the portal changes it there (always through the organiser's calendar);
 *   - the scheduled job looks at the upcoming interviews' events: guests' answers (accepted, declined, maybe) show on
 *     the interview, and an interview moved or cancelled in Google or Outlook is moved or cancelled in the portal.
 * Tokens are kept sealed. Nothing else in anyone's calendar is read: free/busy times and the events the portal made.
 */
require_once __DIR__ . '/sso.php';

const CAL_GAPI = 'https://www.googleapis.com/calendar/v3/';
const CAL_NAMES = ['google' => 'Google Calendar', 'microsoft' => 'Outlook'];

function calDb(): PDO
{
    static $ready = false;
    $p = db();
    if (!$ready) {
        $ready = true;
        $p->exec("CREATE TABLE IF NOT EXISTS cal_acct (uid VARCHAR(40) PRIMARY KEY, provider VARCHAR(12) NOT NULL, email VARCHAR(190) NOT NULL, name VARCHAR(190) NOT NULL, refresh TEXT, access TEXT, exp BIGINT NOT NULL, meet INT NOT NULL DEFAULT 0, err VARCHAR(300) NOT NULL DEFAULT '', created BIGINT NOT NULL)");
        // the interviews that live in someone's calendar: what the scheduled job keeps in step
        $p->exec("CREATE TABLE IF NOT EXISTS cal_links (k VARCHAR(100) PRIMARY KEY, ats VARCHAR(80) NOT NULL, iv VARCHAR(20) NOT NULL, uid VARCHAR(40) NOT NULL, provider VARCHAR(12) NOT NULL, eid TEXT NOT NULL, at BIGINT NOT NULL, synced BIGINT NOT NULL DEFAULT 0, err VARCHAR(300) NOT NULL DEFAULT '')");
    }
    return $p;
}
function calAcct(string $uid): ?array
{
    $s = calDb()->prepare('SELECT * FROM cal_acct WHERE uid = ?');
    $s->execute([$uid]);
    $r = $s->fetch();
    return $r ?: null;
}
function calPublic(?array $a): ?array
{
    return $a ? ['provider' => (string) $a['provider'], 'n' => CAL_NAMES[$a['provider']] ?? $a['provider'], 'email' => (string) $a['email'], 'name' => (string) $a['name'], 'meet' => (int) $a['meet'] === 1, 'err' => (string) $a['err'], 'at' => (int) $a['created']] : null;
}
/** Keeps a person's new calendar connection (called when the provider sends them back with a code). */
function calStore(array $u, string $p, string $email, string $name, string $refresh, string $access, int $exp): void
{
    // can this calendar add an online meeting link? Google Meet: yes; Outlook: only where Teams is allowed (work and
    // school accounts usually, not outlook.com)
    $meet = $p === 'google' ? 1 : 0;
    if ($p === 'microsoft') {
        [$code, $cal] = msHttp('GET', 'me/calendar?$select=allowedOnlineMeetingProviders,defaultOnlineMeetingProvider', null, $access);
        $meet = $code === 200 && is_array($cal) && in_array('teamsForBusiness', (array) ($cal['allowedOnlineMeetingProviders'] ?? []), true) ? 1 : 0;
    }
    $pdo = calDb();
    $pdo->prepare('DELETE FROM cal_acct WHERE uid = ?')->execute([$u['id']]);
    $pdo->prepare('INSERT INTO cal_acct (uid, provider, email, name, refresh, access, exp, meet, err, created) VALUES (?,?,?,?,?,?,?,?,?,?)')->execute([
        $u['id'], $p, mb_substr($email, 0, 190), mb_substr($name, 0, 190), mailSeal($refresh), mailSeal($access), $exp, $meet, '', now(),
    ]);
}
/** The calendar's access token, renewed when it ran out; throws (and notes it on the connection) when it cannot be. */
function calToken(array $a): string
{
    if ((int) $a['exp'] > now() && (string) $a['access'] !== '') {
        return mailUnseal((string) $a['access']);
    }
    [$acc, $exp, $newRefresh, $err] = ssoRefresh((string) $a['provider'], mailUnseal((string) $a['refresh']), $a['provider'] === 'microsoft' ? CAL_MS_SCOPES : '');
    if ($acc === '') {
        $why = 'The connection to ' . (CAL_NAMES[$a['provider']] ?? 'the calendar') . ' (' . $a['email'] . ') stopped working: connect it again. (' . mb_substr($err, 0, 120) . ')';
        calDb()->prepare('UPDATE cal_acct SET err = ? WHERE uid = ?')->execute([mb_substr($why, 0, 300), $a['uid']]);
        throw new RuntimeException($why);
    }
    calDb()
        ->prepare('UPDATE cal_acct SET access = ?, exp = ?, err = \'\'' . ($newRefresh !== '' ? ', refresh = ?' : '') . ' WHERE uid = ?')
        ->execute(array_merge([mailSeal($acc), $exp], $newRefresh !== '' ? [mailSeal($newRefresh)] : [], [$a['uid']]));
    return $acc;
}
function calIso(int $ms): string
{
    return gmdate('Y-m-d\TH:i:s\Z', intdiv($ms, 1000));
}
/** A provider's date-time (RFC 3339, or Graph's UTC "2026-10-07T14:00:00.0000000") in ms. */
function calMs(string $s, bool $utc = false): int
{
    if ($s === '') {
        return 0;
    }
    if ($utc) {
        $s = substr($s, 0, 19) . 'Z';
    }
    $t = strtotime($s);
    return $t ? $t * 1000 : 0;
}
/** When an interview starts (ms, UTC): its time was typed in the scheduler's time zone. */
function calIvStart(stdClass $iv): int
{
    $tz = (string) ($iv->tz ?? '');
    try {
        $z = new DateTimeZone($tz !== '' ? $tz : date_default_timezone_get());
    } catch (Throwable $e) {
        $z = new DateTimeZone('UTC');
    }
    try {
        return (new DateTime((string) ($iv->at ?? ''), $z))->getTimestamp() * 1000;
    } catch (Throwable $e) {
        return 0;
    }
}
/** The same moment as the interview's local time ("2026-10-07T10:30") in its time zone. */
function calLocal(int $ms, string $tz): string
{
    try {
        $z = new DateTimeZone($tz !== '' ? $tz : date_default_timezone_get());
    } catch (Throwable $e) {
        $z = new DateTimeZone('UTC');
    }
    return (new DateTime('@' . intdiv($ms, 1000)))->setTimezone($z)->format('Y-m-d\TH:i');
}

/* ---------------------------------------------------------------- free / busy */

/** Busy times in a person's calendar between two moments (ms): [[start, end], ...]. Throws when it cannot be read. */
function calBusy(array $a, int $from, int $to): array
{
    $tok = calToken($a);
    $out = [];
    if ($a['provider'] === 'google') {
        [$code, $r] = msHttp('POST', CAL_GAPI . 'freeBusy', ['timeMin' => calIso($from), 'timeMax' => calIso($to), 'items' => [['id' => 'primary']]], $tok);
        $cal = is_array($r) ? ($r['calendars']['primary'] ?? null) : null;
        if ($code !== 200 || !is_array($cal) || !empty($cal['errors'])) {
            throw new RuntimeException('Google Calendar did not give the free/busy times: ' . msErr($r, (string) $code));
        }
        foreach ((array) ($cal['busy'] ?? []) as $b) {
            $s = calMs((string) ($b['start'] ?? ''));
            $e = calMs((string) ($b['end'] ?? ''));
            if ($s && $e > $s) {
                $out[] = [$s, $e];
            }
        }
        return $out;
    }
    // Outlook: the person's own calendar view, asking only for start, end and "show as" (Microsoft's getSchedule would
    // do it too, but not for personal Outlook.com accounts)
    $url = 'me/calendarView?' . http_build_query(['startDateTime' => calIso($from), 'endDateTime' => calIso($to), '$select' => 'start,end,showAs,isCancelled', '$top' => 250]);
    for ($page = 0; $page < 4 && $url !== ''; $page++) {
        [$code, $r] = msHttp('GET', $url, null, $tok, ['Prefer: outlook.timezone="UTC"']);
        if ($code !== 200 || !is_array($r)) {
            throw new RuntimeException('Outlook did not give the free/busy times: ' . msErr($r, (string) $code));
        }
        foreach ((array) ($r['value'] ?? []) as $it) {
            if (!empty($it['isCancelled']) || in_array((string) ($it['showAs'] ?? ''), ['free', 'workingElsewhere'], true)) {
                continue;
            }
            $s = calMs((string) ($it['start']['dateTime'] ?? ''), true);
            $e = calMs((string) ($it['end']['dateTime'] ?? ''), true);
            if ($s && $e > $s) {
                $out[] = [$s, $e];
            }
        }
        $url = (string) ($r['@odata.nextLink'] ?? '');
    }
    return $out;
}
/** The interviews already in the portal for these people between two moments: uid => [[start, end, what], ...]. */
function calPortalBusy(array $uids, int $from, int $to, string $skip = ''): array
{
    $out = [];
    if (!$uids) {
        return $out;
    }
    $s = db()->prepare("SELECT path, data FROM docs WHERE col = 'ats' AND data LIKE ?");
    $s->execute(['%"intvs"%']);
    foreach ($s->fetchAll() as $row) {
        $c = json_decode((string) $row['data']);
        if (!($c instanceof stdClass)) {
            continue;
        }
        $atsId = substr((string) $row['path'], 4);
        foreach ((array) ($c->intvs ?? []) as $iv) {
            if (!($iv instanceof stdClass) || !empty($iv->cancelled) || $atsId . ':' . (string) ($iv->id ?? '') === $skip) {
                continue;
            }
            $st = calIvStart($iv);
            $en = $st + max(15, (int) ($iv->dur ?? 60)) * 60000;
            if (!$st || $en <= $from || $st >= $to) {
                continue;
            }
            foreach ((array) ($iv->who ?? []) as $w) {
                if (in_array((string) $w, $uids, true)) {
                    $out[(string) $w][] = [$st, $en, (string) ($iv->kind ?? 'Interview') . ': ' . (string) ($c->n ?? '')];
                }
            }
        }
    }
    return $out;
}

/* ---------------------------------------------------------------- events */

/** The event for an interview, as the provider wants it. $guests: [[name, email], ...]. */
function calBody(string $p, string $atsId, stdClass $c, stdClass $iv, array $guests, bool $meet, string $org): array
{
    $s = calIvStart($iv);
    $e = $s + max(15, (int) ($iv->dur ?? 60)) * 60000;
    $title = (string) ($iv->kind ?? 'Interview') . ': ' . (string) ($c->n ?? '') . ((string) ($c->jt ?? '') !== '' ? ' · ' . $c->jt : '');
    $desc = trim((string) ($iv->notes ?? ''));
    $desc .= ($desc !== '' ? "\n\n" : '') . 'Scheduled by ' . $org . ((string) ($c->jt ?? '') !== '' ? ' for the ' . $c->jt . ' role' : '') . '.';
    if ($p === 'google') {
        $tz = (string) ($iv->tz ?? '');
        $b = [
            'summary' => $title,
            'description' => $desc,
            'location' => (string) ($iv->where ?? ''),
            'start' => ['dateTime' => calIso($s)] + ($tz !== '' ? ['timeZone' => $tz] : []),
            'end' => ['dateTime' => calIso($e)] + ($tz !== '' ? ['timeZone' => $tz] : []),
            'attendees' => array_map(fn($g) => ['email' => $g[1], 'displayName' => $g[0]], $guests),
            'guestsCanModify' => false,
            'guestsCanInviteOthers' => false,
            'reminders' => ['useDefault' => true],
            'extendedProperties' => ['private' => ['seAts' => $atsId, 'seIv' => (string) $iv->id]],
        ];
        if ($meet) {
            $b['conferenceData'] = ['createRequest' => ['requestId' => 'se' . (string) $iv->id . rid(4), 'conferenceSolutionKey' => ['type' => 'hangoutsMeet']]];
        }
        return $b;
    }
    $b = [
        'subject' => $title,
        'body' => ['contentType' => 'text', 'content' => $desc],
        'location' => ['displayName' => (string) ($iv->where ?? '')],
        'start' => ['dateTime' => gmdate('Y-m-d\TH:i:s', intdiv($s, 1000)), 'timeZone' => 'UTC'],
        'end' => ['dateTime' => gmdate('Y-m-d\TH:i:s', intdiv($e, 1000)), 'timeZone' => 'UTC'],
        'attendees' => array_map(fn($g) => ['emailAddress' => ['address' => $g[1], 'name' => $g[0]], 'type' => 'required'], $guests),
        'allowNewTimeProposals' => false,
        'responseRequested' => true,
    ];
    if ($meet) {
        $b['isOnlineMeeting'] = true;
        $b['onlineMeetingProvider'] = 'teamsForBusiness';
    }
    return $b;
}
/** What came back from the provider about an event: its id, link, meeting link. */
function calEventOut(string $p, array $r): array
{
    if ($p === 'google') {
        $join = (string) ($r['hangoutLink'] ?? '');
        foreach ((array) ($r['conferenceData']['entryPoints'] ?? []) as $ep) {
            if (($ep['entryPointType'] ?? '') === 'video' && $join === '') {
                $join = (string) ($ep['uri'] ?? '');
            }
        }
        return ['eid' => (string) ($r['id'] ?? ''), 'link' => (string) ($r['htmlLink'] ?? ''), 'join' => $join];
    }
    return ['eid' => (string) ($r['id'] ?? ''), 'link' => (string) ($r['webLink'] ?? ''), 'join' => (string) ($r['onlineMeeting']['joinUrl'] ?? '')];
}
function calCreate(array $a, array $body, bool $meet, string $txn): array
{
    $tok = calToken($a);
    if ($a['provider'] === 'google') {
        [$code, $r] = msHttp('POST', CAL_GAPI . 'calendars/primary/events?sendUpdates=all' . ($meet ? '&conferenceDataVersion=1' : ''), $body, $tok);
        if ($code !== 200 || !is_array($r) || empty($r['id'])) {
            throw new RuntimeException('Google Calendar did not take the interview: ' . msErr($r, (string) $code));
        }
        return calEventOut('google', $r);
    }
    [$code, $r] = msHttp('POST', 'me/events', $body + ['transactionId' => $txn], $tok);
    if (($code !== 201 && $code !== 200) || !is_array($r) || empty($r['id'])) {
        throw new RuntimeException('Outlook did not take the interview: ' . msErr($r, (string) $code));
    }
    return calEventOut('microsoft', $r);
}
/** Changes the event; null when it is not in the calendar any more. */
function calUpdate(array $a, string $eid, array $body, bool $meet): ?array
{
    $tok = calToken($a);
    if ($a['provider'] === 'google') {
        [$code, $r] = msHttp('PATCH', CAL_GAPI . 'calendars/primary/events/' . rawurlencode($eid) . '?sendUpdates=all' . ($meet ? '&conferenceDataVersion=1' : ''), $body, $tok);
        if ($code === 404 || $code === 410 || (is_array($r) && ($r['status'] ?? '') === 'cancelled')) {
            return null;
        }
        if ($code !== 200 || !is_array($r)) {
            throw new RuntimeException('Google Calendar did not take the change: ' . msErr($r, (string) $code));
        }
        return calEventOut('google', $r);
    }
    [$code, $r] = msHttp('PATCH', 'me/events/' . rawurlencode($eid), $body, $tok);
    if ($code === 404) {
        return null;
    }
    if ($code !== 200 || !is_array($r)) {
        throw new RuntimeException('Outlook did not take the change: ' . msErr($r, (string) $code));
    }
    return calEventOut('microsoft', $r);
}
/** Cancels the event: the guests are told by Google or Outlook. */
function calCancel(array $a, string $eid, string $why): void
{
    $tok = calToken($a);
    if ($a['provider'] === 'google') {
        [$code, $r] = msHttp('DELETE', CAL_GAPI . 'calendars/primary/events/' . rawurlencode($eid) . '?sendUpdates=all', null, $tok);
        if (!in_array($code, [200, 204, 404, 410], true)) {
            throw new RuntimeException('Google Calendar did not cancel it: ' . msErr($r, (string) $code));
        }
        return;
    }
    [$code, $r] = msHttp('POST', 'me/events/' . rawurlencode($eid) . '/cancel', ['comment' => $why], $tok);
    if (in_array($code, [200, 202, 204, 404], true)) {
        return;
    }
    // not a meeting the connected account organises: remove it from that calendar instead
    [$code2, $r2] = msHttp('DELETE', 'me/events/' . rawurlencode($eid), null, $tok);
    if (!in_array($code2, [200, 204, 404], true)) {
        throw new RuntimeException('Outlook did not cancel it: ' . msErr($r2 ?: $r, (string) $code2));
    }
}
/** The event as it is now: null when it is gone; else cancelled, start and end (ms), and each guest's answer. */
function calGet(array $a, string $eid): ?array
{
    $tok = calToken($a);
    $resp = [];
    if ($a['provider'] === 'google') {
        [$code, $r] = msHttp('GET', CAL_GAPI . 'calendars/primary/events/' . rawurlencode($eid), null, $tok);
        if ($code === 404 || $code === 410) {
            return null;
        }
        if ($code !== 200 || !is_array($r)) {
            throw new RuntimeException('Google Calendar: ' . msErr($r, (string) $code));
        }
        foreach ((array) ($r['attendees'] ?? []) as $g) {
            $resp[strtolower((string) ($g['email'] ?? ''))] = ['needsAction' => 'none', 'accepted' => 'yes', 'declined' => 'no', 'tentative' => 'maybe'][(string) ($g['responseStatus'] ?? '')] ?? 'none';
        }
        return ['cancelled' => ($r['status'] ?? '') === 'cancelled', 's' => calMs((string) ($r['start']['dateTime'] ?? '')), 'e' => calMs((string) ($r['end']['dateTime'] ?? '')), 'resp' => $resp];
    }
    [$code, $r] = msHttp('GET', 'me/events/' . rawurlencode($eid) . '?$select=start,end,isCancelled,attendees', null, $tok, ['Prefer: outlook.timezone="UTC"']);
    if ($code === 404) {
        return null;
    }
    if ($code !== 200 || !is_array($r)) {
        throw new RuntimeException('Outlook: ' . msErr($r, (string) $code));
    }
    foreach ((array) ($r['attendees'] ?? []) as $g) {
        $resp[strtolower((string) ($g['emailAddress']['address'] ?? ''))] = ['accepted' => 'yes', 'declined' => 'no', 'tentativelyAccepted' => 'maybe'][(string) ($g['status']['response'] ?? '')] ?? 'none';
    }
    return ['cancelled' => !empty($r['isCancelled']), 's' => calMs((string) ($r['start']['dateTime'] ?? ''), true), 'e' => calMs((string) ($r['end']['dateTime'] ?? ''), true), 'resp' => $resp];
}

/* ---------------------------------------------------------------- interviews */

/** The guests of an interview: the panel (except the organiser) and the candidate. A panelist who connected a calendar
 *  is invited there (the calendar they told the portal to use), anyone else at their portal email. */
function calGuests(stdClass $c, stdClass $iv, string $orgEmail): array
{
    $g = [];
    foreach ((array) ($iv->who ?? []) as $uid) {
        $row = userRow((string) $uid);
        if (!$row) {
            continue;
        }
        $mine = calAcct((string) $uid);
        $em = strtolower($mine ? (string) $mine['email'] : (string) $row['email']);
        if ($em !== strtolower($orgEmail) && strtolower((string) $row['email']) !== strtolower($orgEmail) && filter_var($em, FILTER_VALIDATE_EMAIL)) {
            $g[$em] = [(string) $row['name'], $em];
        }
    }
    $ce = strtolower(trim((string) ($c->e ?? '')));
    if (filter_var($ce, FILTER_VALIDATE_EMAIL) && $ce !== strtolower($orgEmail)) {
        $g[$ce] = [(string) ($c->n ?? ''), $ce];
    }
    return array_values($g);
}
function calLinkSave(string $atsId, stdClass $iv, string $uid, string $p, string $eid): void
{
    $pdo = calDb();
    $k = $atsId . ':' . (string) $iv->id;
    $pdo->prepare('DELETE FROM cal_links WHERE k = ?')->execute([$k]);
    $pdo->prepare('INSERT INTO cal_links (k, ats, iv, uid, provider, eid, at, synced, err) VALUES (?,?,?,?,?,?,?,?,?)')->execute([$k, $atsId, (string) $iv->id, $uid, $p, $eid, calIvStart($iv), now(), '']);
}
function calLinkDrop(string $atsId, string $ivId): void
{
    calDb()->prepare('DELETE FROM cal_links WHERE k = ?')->execute([$atsId . ':' . $ivId]);
}
/**
 * Puts an interview in the organiser's calendar, changes it there or cancels it. $prevCal is what the interview kept
 * from its calendar before (null for a new one: then $u, the person scheduling, is the organiser). Returns
 * ['cal' => what to keep on the interview (or null), 'err' => '' or what went wrong, 'made' => true when created].
 */
function calInterview(array $u, string $atsId, stdClass $c, stdClass $iv, ?stdClass $prevCal, bool $cancel, bool $meet): array
{
    if ($prevCal) {
        // v83: whose calendar and which event come from what the portal itself recorded when it made the event
        // (cal_links), never from the interview kept on the candidate (staff can edit that record)
        $s = calDb()->prepare('SELECT uid, provider, eid FROM cal_links WHERE k = ?');
        $s->execute([$atsId . ':' . (string) $iv->id]);
        $link = $s->fetch();
        if (!$link) {
            return ['cal' => $prevCal, 'err' => 'This interview is not linked to a calendar event, so the calendar invitation could not be ' . ($cancel ? 'cancelled' : 'changed') . '.', 'made' => false];
        }
        $prevCal = clone $prevCal;
        $prevCal->by = (string) $link['uid'];
        $prevCal->p = (string) $link['provider'];
        $prevCal->eid = (string) $link['eid'];
    }
    $orgUid = $prevCal ? (string) $prevCal->by : (string) $u['id'];
    $a = calAcct($orgUid);
    if (!$a) {
        $who = $orgUid === $u['id'] ? 'Your calendar is' : ((string) ($prevCal->byn ?? 'The organiser') . '\'s calendar is');
        return ['cal' => $prevCal, 'err' => $who . ' not connected, so the calendar invitation could not be ' . ($cancel ? 'cancelled' : ($prevCal ? 'changed' : 'sent')) . '.', 'made' => false];
    }
    $guests = calGuests($c, $iv, (string) $a['email']);
    $name = CAL_NAMES[$a['provider']] ?? 'the calendar';
    try {
        if ($prevCal && (string) ($prevCal->eid ?? '') !== '') {
            if ($cancel) {
                calCancel($a, (string) $prevCal->eid, 'The interview was cancelled.');
                calLinkDrop($atsId, (string) $iv->id);
                $kept = clone $prevCal;
                $kept->st = 'cancelled';
                return ['cal' => $kept, 'err' => '', 'made' => false];
            }
            $addMeet = $meet && (int) $a['meet'] === 1 && (string) ($prevCal->join ?? '') === '';
            $out = calUpdate($a, (string) $prevCal->eid, calBody($a['provider'], $atsId, $c, $iv, $guests, $addMeet, (string) $a['name']), $addMeet);
            if ($out === null) {
                // removed from the calendar meanwhile: made again
                $out = calCreate($a, calBody($a['provider'], $atsId, $c, $iv, $guests, $meet && (int) $a['meet'] === 1, (string) $a['name']), $meet && (int) $a['meet'] === 1, 'se-' . sha1($atsId . ':' . $iv->id . ':' . now()));
            }
            $kept = clone $prevCal;
            $kept->gn = (object) array_column($guests, 0, 1);
            $kept->eid = $out['eid'];
            $kept->link = $out['link'] !== '' ? $out['link'] : (string) ($prevCal->link ?? '');
            $kept->join = $out['join'] !== '' ? $out['join'] : (string) ($prevCal->join ?? '');
            $kept->u = now();
            calLinkSave($atsId, $iv, $orgUid, (string) $a['provider'], $out['eid']);
            return ['cal' => $kept, 'err' => '', 'made' => false];
        }
        if ($cancel) {
            return ['cal' => $prevCal, 'err' => '', 'made' => false];
        }
        $withMeet = $meet && (int) $a['meet'] === 1;
        $out = calCreate($a, calBody($a['provider'], $atsId, $c, $iv, $guests, $withMeet, (string) $a['name']), $withMeet, 'se-' . sha1($atsId . ':' . $iv->id . ':' . (int) ($iv->seq ?? 0)));
        calLinkSave($atsId, $iv, $orgUid, (string) $a['provider'], $out['eid']);
        return ['cal' => (object) [
            'p' => (string) $a['provider'],
            'by' => $orgUid,
            'byn' => (string) $u['name'],
            'email' => (string) $a['email'],
            'eid' => $out['eid'],
            'link' => $out['link'],
            'join' => $out['join'],
            'rsvp' => new stdClass(),
            // the guests' names by the address they were invited at (their answers come back by address)
            'gn' => (object) array_column($guests, 0, 1),
            'at' => now(),
        ], 'err' => '', 'made' => true];
    } catch (Throwable $e) {
        return ['cal' => $prevCal, 'err' => $name . ': ' . $e->getMessage(), 'made' => false];
    }
}
/** The next interview not cancelled (for the candidate's board card), '' when none is coming. */
function calNextIv(stdClass $c): string
{
    $next = '';
    $now = now();
    foreach ((array) ($c->intvs ?? []) as $iv) {
        if ($iv instanceof stdClass && empty($iv->cancelled) && calIvStart($iv) >= $now - 3600000 && ($next === '' || strcmp((string) $iv->at, $next) < 0)) {
            $next = (string) $iv->at;
        }
    }
    return $next;
}

/* ---------------------------------------------------------------- the scheduled job */

/** Looks at the upcoming interviews' events (at most $max, each at most every 10 minutes): answers, moves, cancels. */
function calCron(int $max = 40): array
{
    require_once __DIR__ . '/ats.php';
    $out = ['checked' => 0, 'moved' => 0, 'cancelled' => 0, 'answers' => 0, 'errors' => 0];
    $now = now();
    $s = calDb()->prepare('SELECT * FROM cal_links WHERE at > ? AND at < ? AND synced < ? ORDER BY synced ASC LIMIT ' . max(1, min(200, $max)));
    $s->execute([$now - 86400000, $now + 60 * 86400000, $now - 600000]);
    foreach ($s->fetchAll() as $L) {
        $done = calDb()->prepare('UPDATE cal_links SET synced = ?, err = ? WHERE k = ?');
        $a = calAcct((string) $L['uid']);
        if (!$a) {
            $done->execute([$now, 'calendar not connected', $L['k']]);
            continue;
        }
        try {
            $ev = calGet($a, (string) $L['eid']);
        } catch (Throwable $e) {
            $done->execute([$now, mb_substr($e->getMessage(), 0, 300), $L['k']]);
            $out['errors']++;
            continue;
        }
        $out['checked']++;
        $c = docGet('ats/' . $L['ats']);
        $iv = null;
        foreach ((array) ($c->intvs ?? []) as $x) {
            if ($x instanceof stdClass && (string) ($x->id ?? '') === (string) $L['iv']) {
                $iv = $x;
            }
        }
        if (!$c || !$iv || !empty($iv->cancelled)) {
            calLinkDrop((string) $L['ats'], (string) $L['iv']);
            continue;
        }
        $where = CAL_NAMES[$a['provider']] ?? 'the calendar';
        $changed = false;
        if ($ev === null || !empty($ev['cancelled'])) {
            $iv->cancelled = true;
            $iv->u = now();
            if (isset($iv->cal) && $iv->cal instanceof stdClass) {
                $iv->cal->st = 'cancelled';
            }
            atsLog($c, (string) $a['name'], 'Interview cancelled in ' . $where . ': ' . (string) ($iv->kind ?? 'Interview'));
            calLinkDrop((string) $L['ats'], (string) $L['iv']);
            $out['cancelled']++;
            $changed = true;
        } else {
            if ($ev['s'] && abs($ev['s'] - calIvStart($iv)) > 60000) {
                $iv->at = calLocal($ev['s'], (string) ($iv->tz ?? ''));
                if ($ev['e'] > $ev['s']) {
                    $iv->dur = max(15, min(480, (int) round(($ev['e'] - $ev['s']) / 60000)));
                }
                $iv->seq = (int) ($iv->seq ?? 0) + 1;
                $iv->u = now();
                try {
                    $when = (new DateTime((string) $iv->at, new DateTimeZone((string) ($iv->tz ?? '') ?: date_default_timezone_get())))->format('D, M j \a\t g:i A');
                } catch (Throwable $e) {
                    $when = (string) $iv->at;
                }
                atsLog($c, (string) $a['name'], 'Interview moved in ' . $where . ' to ' . $when);
                calDb()->prepare('UPDATE cal_links SET at = ? WHERE k = ?')->execute([$ev['s'], $L['k']]);
                $out['moved']++;
                $changed = true;
            }
            if (isset($iv->cal) && $iv->cal instanceof stdClass) {
                $old = isset($iv->cal->rsvp) ? (array) $iv->cal->rsvp : [];
                $new = [];
                foreach ($ev['resp'] as $em => $ans) {
                    if ($em !== '' && $em !== strtolower((string) $a['email'])) {
                        $new[$em] = $ans;
                    }
                }
                if ($new != $old) {
                    $ce = strtolower(trim((string) ($c->e ?? '')));
                    if ($ce !== '' && ($new[$ce] ?? '') === 'no' && ($old[$ce] ?? '') !== 'no') {
                        atsLog($c, (string) ($c->n ?? 'The candidate'), 'Declined the interview invitation (' . $where . ')');
                    }
                    $iv->cal->rsvp = (object) $new;
                    $out['answers']++;
                    $changed = true;
                }
            }
        }
        if ($changed) {
            $c->intv = calNextIv($c);
            $c->u = now();
            docSet('ats/' . $L['ats'], $c);
        }
        $done->execute([$now, '', $L['k']]);
    }
    return $out;
}

/* ---------------------------------------------------------------- routes */

function calRoute(string $r, array $b): never
{
    switch ($r) {
        case 'cal_status':
            $u = requireUser();
            $a = calAcct($u['id']);
            ok(['acct' => calPublic($a), 'google' => ssoConnectable('google'), 'microsoft' => ssoConnectable('microsoft')]);

        case 'cal_check':
            // the connection still works? (a token renewed if needed, and today's free/busy read)
            $u = requireUser();
            $a = calAcct($u['id']);
            if (!$a) {
                fail(404, 'not_found', 'No calendar is connected.');
            }
            try {
                $from = now();
                calBusy($a, $from, $from + 86400000);
                calDb()->prepare("UPDATE cal_acct SET err = '' WHERE uid = ?")->execute([$u['id']]);
                ok(['ok' => true, 'acct' => calPublic(calAcct($u['id']))]);
            } catch (Throwable $e) {
                fail(502, 'unavailable', $e->getMessage());
            }

        case 'cal_disconnect':
            $u = requireUser();
            $a = calAcct($u['id']);
            if ($a && $a['provider'] === 'google') {
                // Google lets the portal give the permission back
                ssoHttp('https://oauth2.googleapis.com/revoke', ['token' => mailUnseal((string) $a['refresh'])], ['Accept: application/json']);
            }
            calDb()->prepare('DELETE FROM cal_acct WHERE uid = ?')->execute([$u['id']]);
            audit('data', 'Calendar disconnected', $u['id'], ['p' => $a['provider'] ?? ''], $u);
            ok(['ok' => true]);

        case 'cal_busy':
            // the panel's busy times on a day, for the interview window: their calendars (times only) and the portal
            require_once __DIR__ . '/ats.php';
            $u = atsStaff(false);
            if (throttleHit('calbusy:' . $u['id'], 240, 3600)) {
                fail(429, 'rate_limited', 'Too many availability checks in an hour. Try again in a few minutes.');
            }
            $day = str($b, 'day', 10);
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $day)) {
                fail(400, 'invalid_argument', 'Pick a day.');
            }
            try {
                $z = new DateTimeZone(str($b, 'tz', 60) ?: date_default_timezone_get());
            } catch (Throwable $e) {
                $z = new DateTimeZone('UTC');
            }
            $from = (new DateTime($day . ' 00:00', $z))->getTimestamp() * 1000;
            $to = $from + 86400000;
            $uids = array_slice(array_values(array_unique(array_filter(array_map('strval', (array) ($b['who'] ?? [])), fn($x) => preg_match('/^u_[a-f0-9]{8,32}$/', $x) === 1))), 0, 12);
            $skip = mb_substr((string) preg_replace('/[^A-Za-z0-9_:\-]/', '', str($b, 'skip', 100)), 0, 100);
            $portal = calPortalBusy($uids, $from, $to, $skip);
            $people = [];
            foreach ($uids as $uid) {
                $row = userRow($uid);
                $a = calAcct($uid);
                $p = ['uid' => $uid, 'n' => (string) ($row['name'] ?? ''), 'cal' => $a ? (string) $a['provider'] : '', 'err' => '', 'busy' => []];
                foreach ($portal[$uid] ?? [] as [$s, $e, $what]) {
                    $p['busy'][] = [$s, $e, 'portal', $what];
                }
                if ($a) {
                    try {
                        foreach (calBusy($a, $from, $to) as [$s, $e]) {
                            $p['busy'][] = [$s, $e, 'cal', ''];
                        }
                    } catch (Throwable $e) {
                        $p['err'] = $e->getMessage();
                    }
                }
                usort($p['busy'], fn($x, $y) => $x[0] <=> $y[0]);
                $people[] = $p;
            }
            ok(['from' => $from, 'to' => $to, 'people' => $people]);
    }
    fail(404, 'not_found', 'Unknown action.');
}
