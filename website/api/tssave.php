<?php
declare(strict_types=1);
/*
 * v36.2 Talent search → ATS. Everyone a Talent search finds - in the consultant database, among the portal's
 * consultants and employees, and on Dice - is saved into the ATS talent pool, so the ATS holds everyone the team has
 * found. Nobody is saved twice: a saved person is linked to where they came from (cand = consultant database record,
 * uid = portal account, xid = dice:<profile ID>) and matched by email too.
 *   Settings ts/x/cfg {save: all | fit | off, min}: everyone found, only those who fit at least min %, or nobody
 *   (administrators and HR set it on the Talent search page; until then the v36.1 values kept with Dice apply).
 *   Saved-by-search records carry lite=1 until someone works with them (edits them, moves them onto a job, logs
 *   anything): the ATS page leaves them out of its live list and shows them on demand under Talent pool › Saved from
 *   searches; reports do not count them as applications; the screening agent never queues them.
 *   Resumes are copied in the background (sec_kv ts_res_q): right after the response where the server allows it, and
 *   by the scheduled task.
 */
require_once __DIR__ . '/connectors.php';
require_once __DIR__ . '/talent.php';

function tsSaveCfg(): array
{
    $d = docGet('ts/x/cfg');
    if ($d) {
        return ['save' => in_array($d->save ?? '', ['all', 'fit', 'off'], true) ? (string) $d->save : 'all', 'min' => max(30, min(95, (int) ($d->min ?? 60))), 'at' => (int) ($d->at ?? 0), 'by' => (string) ($d->byn ?? '')];
    }
    $a = cxApi('dice')['auto'];
    return ['save' => $a['tsSave'], 'min' => $a['tsMin'], 'at' => 0, 'by' => ''];
}
function tsCanSet(array $u): bool
{
    return hasRole($u, 'admin') || hasRole($u, 'hr');
}
/** Who is already in the ATS and the consultant database: by Dice profile ID (x:), by link to the consultant
 *  database or a portal account (l:cand:…, l:u:…, ATS only) and by email (e:). */
function tsHave(): array
{
    $h = ['ats' => [], 'cand' => []];
    foreach (['ats' => 'ats', 'cand' => 'rec/cand/items'] as $k => $col) {
        foreach (colAll($col) as [$id, $c]) {
            $id = (string) $id;
            if ($id === 'x' || !isset($c->n)) {
                continue;
            }
            if (!empty($c->xid)) {
                $h[$k]['x:' . $c->xid] = $h[$k]['x:' . $c->xid] ?? $id;
            }
            if ($k === 'ats') {
                if (!empty($c->cand)) {
                    $h[$k]['l:cand:' . $c->cand] = $h[$k]['l:cand:' . $c->cand] ?? $id;
                }
                if (!empty($c->uid)) {
                    $h[$k]['l:u:' . $c->uid] = $h[$k]['l:u:' . $c->uid] ?? $id;
                }
            }
            $e = mb_strtolower(trim((string) ($c->e ?? '')));
            if ($e !== '' && !isset($h[$k]['e:' . $e])) {
                $h[$k]['e:' . $e] = $id;
            }
        }
    }
    return $h;
}
function tsHaveOf(array $h, string $kind, string $pid, string $email): string
{
    $email = mb_strtolower(trim($email));
    return ($pid !== '' ? ($h[$kind]['x:dice:' . $pid] ?? '') : '') ?: ($email !== '' ? ($h[$kind]['e:' . $email] ?? '') : '');
}
/** The note on a saved record: who searched for what. */
function tsSaveNote(string $who, string $q, array $locs): string
{
    return 'Found by ' . $who . ($q !== '' ? ' (“' . mb_substr($q, 0, 120) . '”' . ($locs ? ', ' . implode(' / ', $locs) : '') . ')' : '');
}
/**
 * The portal's own search results into the ATS: rows from the consultant database and the portals that are not in
 * the ATS yet are saved (as set). Every row gets `ats` (its ATS record, '' when none) and `new` (saved just now).
 * Returns how many were saved.
 */
function tsSaveFound(array $u, array &$rows, array $f): int
{
    require_once __DIR__ . '/ats.php';
    $cfg = tsSaveCfg();
    $h = tsHave();
    $q = trim((string) ($f['q'] ?? ''));
    $skills = array_values(array_filter(array_map(fn($s) => trim((string) (((array) $s)['s'] ?? '')), (array) ($f['skills'] ?? []))));
    $what = $q !== '' ? $q : implode(', ', $skills);
    $locs = array_values(array_filter(array_map('trim', explode(',', (string) ($f['loc'] ?? '')))));
    $saved = 0;
    $queued = 0;
    foreach ($rows as &$r) {
        $r['new'] = false;
        if ($r['kind'] === 'ats') {
            $r['ats'] = (string) $r['id'];
            continue;
        }
        $r['ats'] = '';
        if (!in_array($r['kind'], ['cand', 'u'], true)) {
            continue;
        }
        $e = mb_strtolower(trim((string) $r['e']));
        $hit = ($h['ats']['l:' . $r['k']] ?? '') ?: ($e !== '' ? ($h['ats']['e:' . $e] ?? '') : '');
        foreach ((array) ($r['also'] ?? []) as $a) {
            if ($hit === '' && str_starts_with((string) $a['k'], 'ats:')) {
                $hit = substr((string) $a['k'], 4);
            }
        }
        if ($hit !== '') {
            $r['ats'] = $hit;
            continue;
        }
        if ($cfg['save'] === 'off' || ($cfg['save'] === 'fit' && (int) $r['score'] < $cfg['min'])) {
            continue;
        }
        $nid = tsSaveOne($u, $r, tsSaveNote($u['name'] . '’s Talent search', $what, $locs));
        if ($nid === '') {
            continue;
        }
        $r['ats'] = $nid;
        $r['new'] = true;
        $saved++;
        $h['ats']['l:' . $r['k']] = $nid;
        if ($e !== '') {
            $h['ats']['e:' . $e] = $nid;
        }
        if (tsResQueue($nid, (string) $r['k'])) {
            $queued++;
        }
    }
    unset($r);
    if ($saved) {
        audit('data', 'People saved to the ATS from Talent search', 'ats', ['n' => $saved, 'q' => mb_substr($what, 0, 120)], $u);
    }
    if ($queued) {
        tsSaveSoon();
    }
    return $saved;
}
/** One person from the consultant database (cand) or a portal account (u) into the ATS talent pool. $lite: saved by
 *  a search (not chosen by anyone yet). Returns the ATS id ('' when the source record is gone). */
function tsSaveOne(array $u, array $r, string $note, bool $lite = true, string $jid = ''): string
{
    require_once __DIR__ . '/ats.php';
    $extra = ($lite ? ['lite' => 1, 'tsd' => now()] : []) + ['tags' => ['Talent search']];
    if ($r['kind'] === 'cand') {
        $c = docGet('rec/cand/items/' . $r['id']);
        if (!$c || !isset($c->n)) {
            return '';
        }
        $f = ['n' => (string) $c->n, 'e' => (string) ($c->e ?? ''), 'ph' => (string) ($c->ph ?? ''), 'ti' => (string) ($c->ti ?? ''), 'sk' => (string) ($c->sk ?? ''), 'loc' => (string) ($c->loc ?? ''), 'auth' => (string) ($c->auth ?? ''), 'exp' => (float) ($c->exp ?? 0), 'li' => (string) ($c->li ?? ''), 'rate' => (string) ($c->rate ?? '')];
        return atsNewCandidate($u, $f, 'Consultant database', $jid, $note, ['cand' => (string) $r['id']] + (!empty($c->xid) ? ['xid' => (string) $c->xid] : []) + $extra);
    }
    if ($r['kind'] === 'u') {
        $s = tsdb()->prepare('SELECT n, e, ph, ti, loc, auth FROM ts_people WHERE k = ?');
        $s->execute([$r['k']]);
        $p = $s->fetch();
        if (!$p) {
            return '';
        }
        return atsNewCandidate($u, ['n' => $p['n'], 'e' => $p['e'], 'ph' => $p['ph'], 'ti' => $p['ti'], 'loc' => $p['loc'], 'auth' => $p['auth']], 'Consultant portal', $jid, $note, ['uid' => (string) $r['id']] + $extra);
    }
    return '';
}

/** Name, email and Dice link of a consultant-database record (cand) or a portal account (u); null when gone. */
function tsSourceInfo(string $kind, string $id, string $k): ?array
{
    if ($kind === 'cand') {
        $c = docGet('rec/cand/items/' . $id);
        if (!$c || !isset($c->n)) {
            return null;
        }
        return ['n' => (string) $c->n, 'e' => mb_strtolower(trim((string) ($c->e ?? ''))), 'xid' => (string) ($c->xid ?? '')];
    }
    if ($kind === 'u') {
        $s = tsdb()->prepare('SELECT n, e FROM ts_people WHERE k = ?');
        $s->execute([$k]);
        $p = $s->fetch();
        return $p ? ['n' => (string) $p['n'], 'e' => mb_strtolower(trim((string) $p['e'])), 'xid' => ''] : null;
    }
    return null;
}
/** Copies the source's resume into an ATS record that has none yet. Keeps a record saved by a search "lite". */
function tsResCopy(string $aid, string $k): bool
{
    require_once __DIR__ . '/ats.php';
    $c = $aid !== '' ? docGet('ats/' . $aid) : null;
    if (!$c || (string) ($c->rid ?? '') !== '') {
        return false;
    }
    [$kind, $id] = array_pad(explode(':', $k, 2), 2, '');
    $fid = '';
    $name = '';
    if ($kind === 'cand') {
        $src = docGet('rec/cand/items/' . $id);
        $fid = (string) ($src->rid ?? '');
        $name = (string) ($src->rn ?? '');
        if ($name === '' && $fid !== '') {
            $fd = docGet('rec/cand/items/' . $id . '/f/' . $fid);
            $name = (string) ($fd->n ?? '');
        }
    } elseif ($kind === 'u') {
        $s = jdb()->prepare('SELECT resume_fid, resume_name FROM job_people WHERE uid = ?');
        $s->execute([$id]);
        $jp = $s->fetch();
        $fid = (string) ($jp['resume_fid'] ?? '');
        $name = (string) ($jp['resume_name'] ?? '');
    }
    if ($fid === '') {
        return false;
    }
    $name = $name !== '' ? $name : 'resume.pdf';
    $new = atsCopyResume($aid, $fid, $name);
    if (!$new) {
        return false;
    }
    $c->rid = $new;
    $c->rn = $name;
    $c->u = now();
    // copying the resume is housekeeping: a record saved by a search stays so until someone works with it
    $wasLite = !empty($c->lite);
    atsLog($c, 'Talent search', 'Resume copied from the ' . ($kind === 'cand' ? 'consultant database' : 'consultant portal'));
    if ($wasLite) {
        $c->lite = 1;
    }
    docSet('ats/' . $aid, $c);
    return true;
}

/* ---------- resumes, copied in the background ---------- */
/** Queues the resume copy for a saved person when the source has one. */
function tsResQueue(string $aid, string $k): bool
{
    [$kind, $id] = array_pad(explode(':', $k, 2), 2, '');
    if ($kind === 'cand') {
        $c = docGet('rec/cand/items/' . $id);
        if (!$c || (string) ($c->rid ?? '') === '') {
            return false;
        }
    } elseif ($kind === 'u') {
        $s = jdb()->prepare('SELECT resume_fid FROM job_people WHERE uid = ?');
        $s->execute([$id]);
        if ((string) ($s->fetchColumn() ?: '') === '') {
            return false;
        }
    } else {
        return false;
    }
    $q = secKv('ts_res_q');
    $q = is_array($q) ? $q : [];
    $q[] = ['a' => $aid, 'k' => $k, 'at' => now()];
    secKvSet('ts_res_q', array_slice($q, -3000));
    return true;
}
function tsSaveSoon(): void
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
            tsResDrain(40, 150);
        } catch (Throwable $e) {
            @error_log(date('c') . ' talent save: ' . $e->getMessage() . "\n", 3, storeDir() . '/error.log');
        }
    });
}
/** Copies waiting resumes into the saved ATS records (one run at a time). */
function tsResDrain(int $budget = 40, int $max = 150): array
{
    require_once __DIR__ . '/ats.php';
    $res = ['done' => 0, 'left' => 0];
    $q = secKv('ts_res_q');
    $q = is_array($q) ? array_values($q) : [];
    if (!$q) {
        return $res;
    }
    $lock = @fopen(storeDir() . '/tsres.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
        $res['left'] = count($q);
        return $res;
    }
    try {
        $t0 = microtime(true);
        $keep = [];
        foreach ($q as $it) {
            if ($res['done'] >= $max || microtime(true) - $t0 > $budget) {
                $keep[] = $it;
                continue;
            }
            if (tsResCopy((string) ($it['a'] ?? ''), (string) ($it['k'] ?? ''))) {
                $res['done']++;
            }
        }
        // the queue may have grown while this ran
        $now = secKv('ts_res_q');
        $now = is_array($now) ? $now : [];
        $known = [];
        foreach ($q as $it) {
            $known[(string) ($it['a'] ?? '') . '|' . (string) ($it['k'] ?? '')] = true;
        }
        foreach ($now as $it) {
            if (!isset($known[(string) ($it['a'] ?? '') . '|' . (string) ($it['k'] ?? '')])) {
                $keep[] = $it;
            }
        }
        secKvSet('ts_res_q', array_slice(array_values($keep), -3000));
        $res['left'] = count($keep);
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
    return $res;
}
