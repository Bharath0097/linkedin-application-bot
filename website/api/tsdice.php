<?php
declare(strict_types=1);
/*
 * v36.1 Dice in Talent search. The search a recruiter types (keywords, skills with years, location, total experience,
 * work authorization, how recent) also runs on Dice through the live API set up under Sourcing connections. Dice rows
 * are scored like the portal's rows from what the search summary shows, labeled "Dice", and the people found are saved
 * into the ATS (talent pool, source Dice, linked by their Dice profile ID so nobody is saved twice): everyone found,
 * only those who fit, or nobody, as the administrator chooses. For saved people who fit, the full profile (email,
 * phone, resume) is read in the background within a daily number of profile views; an email that shows the person is
 * already in the ATS folds the two records into one. Saved searches with alerts include Dice.
 *   Settings: the Dice connection's "auto" block (tsOn, tsProf, tsDay), Admin › Sourcing connections; since v36.2
 *   who is saved into the ATS (everyone / who fits / nobody, and the fit) is one setting for every source (tssave.php).
 *   People saved by a search are lite until someone works with them (tssave.php).
 *   Queue of profiles to read: sec_kv ts_dice_q; profile views used today: sec_kv ts_dice_day.
 */
require_once __DIR__ . '/connectors.php';
require_once __DIR__ . '/jobs.php';
require_once __DIR__ . '/talent.php';
require_once __DIR__ . '/tssave.php';

function tsDiceCfg(): array
{
    $api = cxApi('dice');
    $a = $api['auto'];
    $set = $api['ops']['search']['on'] && ($api['base'] !== '' || (bool) preg_match('#^https?://#', $api['ops']['search']['path']));
    $sv = tsSaveCfg();
    return [
        'set' => $set,
        'on' => $set && $a['tsOn'],
        'save' => $sv['save'],
        'min' => $sv['min'],
        'prof' => $a['tsProf'] && $api['ops']['profile']['on'],
        'profOp' => $api['ops']['profile']['on'],
        'day' => $a['tsDay'],
    ];
}
/** What the Talent search page needs to know (no secrets). */
function tsDicePublic(): array
{
    $c = tsDiceCfg();
    $q = secKv('ts_dice_q');
    return ['set' => $c['set'], 'on' => $c['on'], 'save' => $c['save'], 'min' => $c['min'], 'prof' => $c['prof'], 'wait' => is_array($q) ? count($q) : 0];
}
function tsIsState(string $s): bool
{
    $s = trim($s);
    return (strlen($s) === 2 && isset(US_STATES[strtoupper($s)])) || in_array(mb_strtolower($s), array_map('mb_strtolower', US_STATES), true);
}
/** "NJ, Dallas" is two places; "Dallas, TX" is one; "Edison, NJ, Austin, TX" two (at most three searches). */
function tsDiceLocs(string $loc): array
{
    $parts = array_values(array_filter(array_map('trim', explode(',', $loc)), fn($p) => $p !== '' && mb_strlen($p) <= 60));
    $out = [];
    for ($i = 0; $i < count($parts); $i++) {
        $p = $parts[$i];
        $next = $parts[$i + 1] ?? '';
        if ($next !== '' && !tsIsState($p) && tsIsState($next)) {
            $out[] = $p . ', ' . (strlen($next) === 2 ? strtoupper($next) : $next);
            $i++;
        } else {
            $out[] = $p;
        }
    }
    $out = array_slice(array_values(array_unique($out)), 0, 3);
    return $out ?: [''];
}
/** The Talent search filter as a Dice query: the keywords in the usual Boolean form (-word becomes NOT word, a prefix
 *  star is dropped), the skills ANDed on unless the keywords already name them. */
function tsDiceQuery(array $f): array
{
    $q = trim((string) ($f['q'] ?? ''));
    preg_match_all('/"[^"]*"|\(|\)|[^\s()"]+/u', $q, $m);
    $toks = [];
    foreach ($m[0] as $t) {
        if (str_starts_with($t, '-') && mb_strlen($t) > 1) {
            $toks[] = 'NOT';
            $t = mb_substr($t, 1);
        }
        if (!str_starts_with($t, '"')) {
            $t = rtrim($t, '*');
            if ($t === '') {
                continue;
            }
            if (in_array(strtoupper($t), ['AND', 'OR', 'NOT'], true)) {
                $t = strtoupper($t);
            }
        } elseif (trim($t, '"') === '') {
            continue;
        }
        $toks[] = $t;
    }
    $q2 = trim((string) preg_replace(['/\(\s+/', '/\s+\)/', '/\s+/'], ['(', ')', ' '], implode(' ', $toks)));
    $q2 = (string) preg_replace('/^(AND|OR)\s+|\s+(AND|OR|NOT)$/', '', $q2);
    $skills = [];
    foreach ((array) ($f['skills'] ?? []) as $sy) {
        $sy = (array) $sy;
        $s = trim((string) ($sy['s'] ?? ($sy[0] ?? '')));
        if ($s !== '' && mb_strlen($s) <= 60) {
            $skills[mb_strtolower($s)] = $s;
        }
    }
    $skills = array_slice(array_values($skills), 0, 8);
    $low = ' ' . tsNorm($q2) . ' ';
    $add = [];
    foreach ($skills as $s) {
        $n = tsNorm($s);
        if ($n !== '' && !str_contains($low, ' ' . $n . ' ')) {
            $add[] = str_contains($s, ' ') ? '"' . str_replace('"', '', $s) . '"' : $s;
        }
    }
    $hasOr = (bool) preg_match('/(^|\s)OR(\s|$)/', $q2);
    $parts = $q2 !== '' ? [$hasOr && $add ? '(' . $q2 . ')' : $q2] : [];
    return ['q' => mb_substr(implode(' AND ', array_merge($parts, $add)), 0, 400), 'skills' => implode(', ', $skills)];
}
/** A date as Dice may send it (2026-09-30, an ISO time, seconds or milliseconds) in milliseconds; 0 when unknown. */
function tsDiceDate(string $s): int
{
    $s = trim($s);
    if ($s === '') {
        return 0;
    }
    if (ctype_digit($s)) {
        $n = (int) $s;
        return $n > 100000000000 ? $n : ($n > 1000000000 ? $n * 1000 : 0);
    }
    $t = strtotime($s);
    return $t ? min(now(), $t * 1000) : 0;
}
/** The fit of one Dice summary against the filter: [score, skill hits, keep, updated (ms), years or null].
 *  Filters the summary can answer apply (experience, authorization, recency); unknown values pass, because Dice
 *  matched the words against the whole profile. */
function tsDiceScore(array $f, array $m): array
{
    $txt = ' ' . tsNorm($m['title'] . ' ' . $m['skills']) . ' ';
    $exp = preg_match('/(\d+(?:\.\d+)?)/', (string) $m['exp'], $em) ? (float) $em[1] : null;
    $upd = tsDiceDate((string) ($m['updated'] ?? ''));
    $no = [0, [], false, $upd, $exp];
    if ($exp !== null) {
        if (isset($f['ymin']) && $f['ymin'] !== '' && $f['ymin'] !== null && $exp + 0.001 < (float) $f['ymin']) {
            return $no;
        }
        if (isset($f['ymax']) && $f['ymax'] !== '' && $f['ymax'] !== null && (float) $f['ymax'] > 0 && $exp > (float) $f['ymax']) {
            return $no;
        }
    }
    if (!empty($f['upd']) && $upd && $upd < now() - (int) $f['upd'] * 86400000) {
        return $no;
    }
    $auths = array_values(array_filter(array_map('strval', (array) ($f['auth'] ?? []))));
    if ($auths && trim((string) $m['auth']) !== '') {
        [$listed] = ruleAuthInSafe((string) $m['auth']);
        if ($listed && !array_intersect($auths, $listed)) {
            return $no;
        }
    }
    $need = [];
    foreach ((array) ($f['skills'] ?? []) as $sy) {
        $sy = (array) $sy;
        $s = trim((string) ($sy['s'] ?? ($sy[0] ?? '')));
        if ($s !== '') {
            $need[] = [$s, max(0.0, (float) ($sy['y'] ?? ($sy[1] ?? 0)))];
        }
    }
    $hits = [];
    foreach ($need as [$s, $y]) {
        $n = tsNorm($s);
        // years per skill are not in a search summary: a skill counts when it is named and the total experience allows it
        if ($n !== '' && str_contains($txt, ' ' . $n . ' ') && ($y <= 0 || $exp === null || $exp + 0.001 >= $y)) {
            $hits[] = ['s' => $s, 'y' => 0, 'c' => 0, 'd' => 1];
        }
    }
    $terms = tsTerms(tsParse((string) ($f['q'] ?? '')));
    $kw = 0;
    foreach ($terms as $t) {
        $n = tsNorm(trim($t, '"*'));
        if ($n !== '' && str_contains($txt, ' ' . $n)) {
            $kw++;
        }
    }
    $days = $upd ? (now() - $upd) / 86400000 : 999;
    $score = 40 + ($need ? 25 * count($hits) / count($need) : 12) + ($terms ? min(20, 20 * $kw / count($terms)) : 10) + ($days <= 30 ? 15 : ($days <= 90 ? 10 : ($days <= 365 ? 4 : 0))) + min(5, ($exp ?? 0) / 4);
    return [(int) round(min(100, $score)), $hits, true, $upd, $exp];
}
/** One Dice row as the page shows it (from a search summary, or sent back by the page for "Save to the ATS"). */
function tsDiceRow(array $m, array $f, ?array $have): ?array
{
    [$score, $hits, $keep, $upd, $exp] = tsDiceScore($f, $m);
    if (!$keep) {
        return null;
    }
    $pid = mb_substr(trim((string) $m['id']), 0, 120);
    $email = mb_strtolower(mb_substr(trim((string) ($m['email'] ?? '')), 0, 190));
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $email = '';
    }
    $sk = mb_substr(trim((string) $m['skills']), 0, 600);
    $top = [];
    foreach (array_slice(array_values(array_filter(array_map('trim', preg_split('/[,;|]+/', $sk) ?: []))), 0, 8) as $s) {
        $top[] = ['s' => mb_substr($s, 0, 40), 'y' => 0, 'c' => 0];
    }
    return [
        'k' => 'dice:' . ($pid !== '' ? $pid : substr(md5($m['name'] . '|' . $m['loc']), 0, 12)),
        'kind' => 'dice', 'id' => $pid, 'n' => mb_substr(trim((string) $m['name']), 0, 120), 'e' => $email, 'ph' => mb_substr(trim((string) ($m['phone'] ?? '')), 0, 40),
        'ti' => mb_substr(trim((string) $m['title']), 0, 160), 'loc' => mb_substr(trim((string) $m['loc']), 0, 120), 'auth' => mb_substr(trim((string) $m['auth']), 0, 60),
        'years' => $exp ?? 0.0, 'upd' => $upd, 'src' => 'Dice', 'hits' => $hits, 'top' => $top, 'sk' => $sk, 'snip' => '', 'score' => $score,
        'url' => preg_match('#^https://#', (string) $m['url']) ? mb_substr((string) $m['url'], 0, 400) : '',
        'cv' => (bool) preg_match('#^https?://#', (string) ($m['resume'] ?? '')),
        'ats' => $have ? tsHaveOf($have, 'ats', $pid, $email) : '', 'cand' => $have ? tsHaveOf($have, 'cand', $pid, $email) : '',
        'new' => false, 'q' => false,
    ];
}
/** The Dice side of a Talent search: rows scored and labeled, and (as set) saved into the ATS. $by: search | alert. */
function tsDice(array $u, array $f, int $page = 1, string $by = 'search'): array
{
    $cfg = tsDiceCfg();
    $base = ['on' => $cfg['on'], 'err' => '', 'rows' => [], 'q' => '', 'locs' => [], 'found' => 0, 'saved' => 0, 'queued' => 0, 'page' => $page, 'more' => false, 'took' => 0, 'cfg' => ['save' => $cfg['save'], 'min' => $cfg['min'], 'prof' => $cfg['prof']]];
    if (!$cfg['set']) {
        return ['err' => 'Dice is not connected yet (Admin › Sourcing connections › Dice: Candidate search).'] + $base;
    }
    if (!$cfg['on']) {
        return ['err' => 'Searching Dice from Talent search is switched off (Admin › Sourcing connections › Dice).'] + $base;
    }
    $qq = tsDiceQuery($f);
    if ($qq['q'] === '') {
        return ['err' => 'Type keywords or skills to search Dice.'] + $base;
    }
    $t0 = microtime(true);
    $api = cxApi('dice');
    $o = $api['ops']['search'];
    $size = max(1, min(50, $o['size']));
    $locs = tsDiceLocs((string) ($f['loc'] ?? ''));
    $items = [];
    $seen = [];
    $err = '';
    $more = false;
    foreach ($locs as $loc) {
        $r = cxCall('dice', 'search', ['q' => $qq['q'], 'skills' => $qq['skills'], 'location' => $loc, 'radius' => 50, 'page' => $page, 'size' => $size, 'offset' => ($page - 1) * $size]);
        if ($r['err'] !== '') {
            $err = $r['err'];
            continue;
        }
        if (count($r['items']) >= $size) {
            $more = true;
        }
        foreach ($r['items'] as $it) {
            if (!is_array($it)) {
                continue;
            }
            $m = cxMap($it, $o['map'], 'search');
            if (trim($m['id']) === '' && trim($m['name']) === '') {
                continue;
            }
            $key = trim($m['id']) !== '' ? 'i:' . $m['id'] : 'n:' . mb_strtolower($m['name'] . '|' . $m['loc']);
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $items[] = $m;
        }
    }
    $base['q'] = $qq['q'];
    $base['locs'] = array_values(array_filter($locs));
    if (!$items) {
        return ['err' => $err, 'took' => (int) round((microtime(true) - $t0) * 1000)] + $base;
    }
    $have = tsHave();
    $rows = [];
    foreach ($items as $m) {
        $row = tsDiceRow($m, $f, $have);
        if ($row) {
            $row['rs'] = preg_match('#^https?://#', (string) $m['resume']) ? mb_substr((string) $m['resume'], 0, 400) : '';
            $rows[] = $row;
        }
    }
    usort($rows, fn($a, $b) => $b['score'] <=> $a['score'] ?: $b['upd'] <=> $a['upd']);
    $saved = 0;
    $queued = 0;
    if ($cfg['save'] !== 'off') {
        foreach ($rows as &$row) {
            if ($row['ats'] !== '' || $row['id'] === '' || $row['n'] === '' || ($cfg['save'] === 'fit' && $row['score'] < $cfg['min'])) {
                continue;
            }
            $row['ats'] = tsDiceSave($u, $row, $by === 'alert' ? 'the saved search “' . ($f['__name'] ?? 'alert') . '”' : $u['name'] . '’s Talent search', $qq['q'], $base['locs'], '', true);
            $row['new'] = true;
            $saved++;
            if ($cfg['prof'] && $row['score'] >= $cfg['min']) {
                tsDiceQueue($row['ats'], $row['id'], $row['rs']);
                $row['q'] = true;
                $queued++;
            }
        }
        unset($row);
    }
    foreach ($rows as &$row) {
        unset($row['rs']);
    }
    unset($row);
    if ($saved) {
        audit('data', 'Dice people saved to the ATS from Talent search', 'ats', ['n' => $saved, 'q' => $qq['q'], 'by' => $by], $u);
    }
    if ($queued) {
        tsDiceSoon();
    }
    $wait = secKv('ts_dice_q');
    return ['rows' => $rows, 'err' => $err, 'found' => count($items), 'saved' => $saved, 'queued' => $queued, 'more' => $more, 'took' => (int) round((microtime(true) - $t0) * 1000), 'wait' => is_array($wait) ? count($wait) : 0] + $base;
}
/** A Dice person into the ATS talent pool (or onto a job): source Dice, linked by the Dice profile ID. */
function tsDiceSave(array $u, array $row, string $who, string $q = '', array $locs = [], string $jid = '', bool $lite = false): string
{
    require_once __DIR__ . '/ats.php';
    $note = 'Found on Dice by ' . $who . ($q !== '' ? ' (“' . mb_substr($q, 0, 120) . '”' . ($locs ? ', ' . implode(' / ', $locs) : '') . ')' : '');
    // saved by a search: lite (left out of the ATS page's live list until someone works with them); chosen: a full record
    $extra = ['xid' => 'dice:' . $row['id'], 'tags' => ['Dice'], 'tsd' => now()] + ($lite && $jid === '' ? ['lite' => 1] : []);
    if (($row['cand'] ?? '') !== '') {
        $extra['cand'] = (string) $row['cand'];
    }
    return atsNewCandidate($u, [
        'n' => $row['n'], 'e' => $row['e'] ?? '', 'ph' => $row['ph'] ?? '', 'ti' => $row['ti'] ?? '', 'sk' => $row['sk'] ?? '', 'loc' => $row['loc'] ?? '',
        'auth' => $row['auth'] ?? '', 'exp' => (float) ($row['years'] ?? 0), 'li' => (string) ($row['url'] ?? ''),
    ], 'Dice', $jid, $note, $extra);
}
/** A row the page sends back (an unsaved Dice person it shows), checked and trimmed. */
function tsDiceRowIn($x, string $pid): ?array
{
    if (!is_array($x) || !preg_match('/^[A-Za-z0-9_.:\-]{1,120}$/', $pid)) {
        return null;
    }
    $s = fn(string $k, int $max) => mb_substr(trim(is_scalar($x[$k] ?? null) ? (string) $x[$k] : ''), 0, $max);
    $n = $s('n', 120);
    if ($n === '') {
        return null;
    }
    $e = mb_strtolower($s('e', 190));
    return [
        'id' => $pid, 'n' => $n, 'e' => filter_var($e, FILTER_VALIDATE_EMAIL) ? $e : '', 'ph' => $s('ph', 40), 'ti' => $s('ti', 160), 'loc' => $s('loc', 120), 'auth' => $s('auth', 60),
        'sk' => $s('sk', 600), 'years' => max(0.0, min(60.0, (float) ($x['years'] ?? 0))), 'url' => preg_match('#^https://#', $s('url', 400)) ? $s('url', 400) : '', 'cand' => '',
        'score' => max(0, min(100, (int) ($x['score'] ?? 0))),
    ];
}

/* ---------- the full profiles, read in the background ---------- */
function tsDiceQueue(string $aid, string $pid, string $resume = ''): void
{
    $q = secKv('ts_dice_q');
    $q = is_array($q) ? $q : [];
    foreach ($q as $it) {
        if (($it['a'] ?? '') === $aid) {
            return;
        }
    }
    $q[] = ['a' => $aid, 'p' => $pid, 'r' => $resume, 'at' => now(), 't' => 0];
    secKvSet('ts_dice_q', array_slice($q, -500));
}
function tsDiceDay(): array
{
    $d = secKv('ts_dice_day');
    $today = date('Y-m-d');
    return is_array($d) && ($d['d'] ?? '') === $today ? ['d' => $today, 'n' => (int) ($d['n'] ?? 0)] : ['d' => $today, 'n' => 0];
}
/** After the response is on its way (LiteSpeed / PHP-FPM), a few profiles are read; the cron job reads the rest. */
function tsDiceSoon(): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    register_shutdown_function(function () {
        if (function_exists('litespeed_finish_request')) {
            @litespeed_finish_request();
        } elseif (function_exists('fastcgi_finish_request')) {
            @fastcgi_finish_request();
        } else {
            return;
        }
        @set_time_limit(90);
        try {
            tsDiceDrain(45, 8);
        } catch (Throwable $e) {
            @error_log(date('c') . ' talent dice: ' . $e->getMessage() . "\n", 3, storeDir() . '/error.log');
        }
    });
}
/** Reads waiting profiles (one run at a time) within the time budget, the per-run maximum and the daily allowance. */
function tsDiceDrain(int $budget = 45, int $max = 10): array
{
    $res = ['done' => 0, 'resumes' => 0, 'merged' => 0, 'left' => 0, 'err' => '', 'cap' => false, 'today' => 0];
    $cfg = tsDiceCfg();
    $q = secKv('ts_dice_q');
    $q = is_array($q) ? array_values($q) : [];
    $res['left'] = count($q);
    $day = tsDiceDay();
    $res['today'] = $day['n'];
    if (!$q || !$cfg['prof']) {
        return $res;
    }
    $lockF = storeDir() . '/tsdice.lock';
    $lock = @fopen($lockF, 'c');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
        return $res;
    }
    try {
        $t0 = microtime(true);
        $doneIds = [];
        $keep = [];
        foreach ($q as $it) {
            if ($res['err'] !== '' || $res['done'] >= $max || $day['n'] >= $cfg['day'] || microtime(true) - $t0 > $budget) {
                $keep[] = $it;
                continue;
            }
            $one = tsDiceFetch($it);
            if ($one['call']) {
                $day['n']++;
            }
            if (!empty($one['err'])) {
                $it['t'] = (int) ($it['t'] ?? 0) + 1;
                if ($it['t'] < 3) {
                    $keep[] = $it;
                }
                // a sign-in or allowance problem stops the run (the next one tries again)
                if (!empty($one['stop'])) {
                    $res['err'] = $one['err'];
                }
                continue;
            }
            $res['done'] += $one['call'] ? 1 : 0;
            $res['resumes'] += !empty($one['resume']) ? 1 : 0;
            $res['merged'] += !empty($one['merged']) ? 1 : 0;
            $doneIds[] = (string) $it['a'];
        }
        // the queue may have grown while this ran: keep what was added meanwhile
        $now = secKv('ts_dice_q');
        $now = is_array($now) ? $now : [];
        $known = array_flip(array_map(fn($x) => (string) ($x['a'] ?? ''), $q));
        foreach ($now as $it) {
            if (!isset($known[(string) ($it['a'] ?? '')])) {
                $keep[] = $it;
            }
        }
        secKvSet('ts_dice_q', array_slice(array_values($keep), -500));
        secKvSet('ts_dice_day', $day);
        $res['left'] = count($keep);
        $res['today'] = $day['n'];
        $res['cap'] = $day['n'] >= $cfg['day'] && $keep;
        secKvSet('ts_dice_last', $res + ['at' => now()]);
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
    return $res;
}
/** One waiting profile: the Dice profile read, the missing details filled in, the resume attached. When the email shows
 *  the person is already in the ATS, the details go onto that record and the bare one the search made is removed. */
function tsDiceFetch(array $it): array
{
    require_once __DIR__ . '/ats.php';
    $api = cxApi('dice');
    $aid = (string) ($it['a'] ?? '');
    $pid = (string) ($it['p'] ?? '');
    $c = $aid !== '' ? docGet('ats/' . $aid) : null;
    if (!$c || !empty($c->pf)) {
        return ['call' => false];
    }
    $m = [];
    $call = false;
    if ($api['ops']['profile']['on'] && $pid !== '') {
        $pr = cxCall('dice', 'profile', ['id' => $pid]);
        $call = true;
        if ($pr['err'] !== '') {
            return ['call' => true, 'err' => $pr['err'], 'stop' => in_array((int) $pr['code'], [0, 401, 402, 403, 429], true)];
        }
        $rec = is_array($pr['data']) ? ($api['ops']['profile']['items'] !== '' ? (cxItems($pr['data'], $api['ops']['profile']['items'])[0] ?? $pr['data']) : $pr['data']) : [];
        $m = is_array($rec) ? cxMap($rec, $api['ops']['profile']['map'], 'profile') : [];
    }
    $resumeUrl = trim((string) ($m['resume'] ?? '')) !== '' ? trim((string) $m['resume']) : (string) ($it['r'] ?? '');
    $email = mb_strtolower(trim((string) ($m['email'] ?? '')));
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $email = '';
    }
    $target = $aid;
    $tc = $c;
    $merged = false;
    if ($email !== '' && trim((string) ($c->e ?? '')) === '') {
        foreach (colAll('ats') as [$oid, $o]) {
            $oid = (string) $oid;
            if ($oid !== $aid && $oid !== 'x' && isset($o->n) && mb_strtolower(trim((string) ($o->e ?? ''))) === $email) {
                $target = $oid;
                $tc = $o;
                $merged = true;
                break;
            }
        }
    }
    foreach (['email' => 'e', 'phone' => 'ph', 'title' => 'ti', 'loc' => 'loc', 'skills' => 'sk', 'auth' => 'auth'] as $from => $to) {
        $v = trim((string) ($m[$from] ?? ''));
        if ($from === 'email') {
            $v = $email;
        }
        if ($v !== '' && trim((string) ($tc->$to ?? '')) === '') {
            $tc->$to = mb_substr($v, 0, $to === 'sk' ? 600 : ($to === 'auth' ? 40 : 190));
        }
    }
    if (empty($tc->exp) && preg_match('/(\d+(?:\.\d+)?)/', (string) ($m['exp'] ?? ''), $em)) {
        $tc->exp = (float) $em[1];
    }
    if (trim((string) ($tc->li ?? '')) === '' && preg_match('#^https://#', (string) ($m['url'] ?? ''))) {
        $tc->li = mb_substr((string) $m['url'], 0, 300);
    }
    if ($merged && empty($tc->xid)) {
        $tc->xid = 'dice:' . $pid;
    }
    $gotResume = false;
    if ($resumeUrl !== '' && trim((string) ($tc->rid ?? '')) === '') {
        $fid = cxAttachResume('dice', $target, $resumeUrl, (string) ($tc->n ?? 'resume'));
        if ($fid !== '') {
            $fd = docGet("ats/$target/f/$fid");
            $tc->rid = $fid;
            $tc->rn = (string) ($fd->n ?? 'resume.pdf');
            $gotResume = true;
        }
    }
    $what = array_values(array_filter([$email !== '' ? 'email' : '', trim((string) ($m['phone'] ?? '')) !== '' ? 'phone' : '', $gotResume ? 'resume' : '']));
    $tc->pf = now();
    $tc->u = now();
    $wasLite = !empty($tc->lite);
    atsLog($tc, 'Dice', 'Dice profile read' . ($what ? ': ' . implode(', ', $what) : '') . ($merged ? ' (the same person was found on Dice by Talent search)' : ''));
    if ($wasLite) {
        $tc->lite = 1; // reading the profile is housekeeping: still "saved by a search" until someone works with it
    }
    docSet('ats/' . $target, $tc);
    if ($merged) {
        // the record the search made a moment ago has nothing of its own: it goes; anything else stays, marked
        $bare = (string) ($c->job ?? '') === '' && (string) ($c->st ?? 'new') === 'new' && count((array) ($c->log ?? [])) <= 1 && !empty($c->tsd) && empty($c->notes);
        $bare = $bare || (!empty($c->lite) && (string) ($c->job ?? '') === '');
        if ($bare) {
            foreach (colAll("ats/$aid/f") as [$fid]) {
                @unlink(filePathOf((string) $fid));
                docDelete("ats/$aid/f/$fid");
            }
            docDelete('ats/' . $aid);
        } else {
            $c->pf = now();
            $wasLite = !empty($c->lite);
            atsLog($c, 'Dice', 'The same email is on another candidate: ' . (string) ($tc->n ?? ''));
            if ($wasLite) {
                $c->lite = 1;
            }
            docSet('ats/' . $aid, $c);
        }
    }
    return ['call' => $call, 'resume' => $gotResume, 'merged' => $merged];
}
/** Saved searches with alerts: the new Dice people for one search (saved into the ATS as set). */
function tsDiceAlert(array $owner, array $f, string $name, array $seen, array $localKeys): array
{
    $f['__name'] = $name;
    try {
        $d = tsDice($owner, $f, 1, 'alert');
    } catch (Throwable $e) {
        return [[], []];
    }
    $new = [];
    $mark = [];
    foreach ((array) ($d['rows'] ?? []) as $r) {
        $ak = $r['ats'] !== '' ? 'ats:' . $r['ats'] : '';
        if (in_array($r['k'], $seen, true) || ($ak !== '' && (in_array($ak, $seen, true) || in_array($ak, $localKeys, true)))) {
            $mark[] = $r['k'];
            continue;
        }
        $new[] = $r;
        $mark[] = $r['k'];
        if ($ak !== '') {
            $mark[] = $ak;
        }
    }
    return [$new, $mark];
}
