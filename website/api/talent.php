<?php
declare(strict_types=1);
/*
 * Talent search (v33), in the style of JobDiva's search: every resume the portal holds - ATS candidates, the consultant
 * database and the consultants and employees in the portals - searched by Boolean keywords AND by skills with years of
 * experience ("Java 5+ years AND AWS 3+"), location, work authorization, total experience and how recently the resume
 * changed. Years per skill come from the dated jobs that mention the skill (overlapping jobs counted once); a claim like
 * "8 years of Java" counts when the dated history supports it.
 *   Index: storage/search.sqlite (ts_people, plus an FTS5 table where the server has it, used to narrow big searches
 *   before the exact Boolean check). Rebuilt in the background (cron, and a little on each search) from what changed.
 *   Saved searches: ts/x/saved/{id}; with alerts on, new matches are emailed to their owner once a day.
 */
require_once __DIR__ . '/tailor.php';
require_once __DIR__ . '/domains.php'; // v68: technology and industry domains read from the resumes

function tsdb(): PDO
{
    static $p = null;
    if ($p) {
        return $p;
    }
    $f = storeDir() . '/search.sqlite';
    $p = new PDO('sqlite:' . $f);
    $p->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $p->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $p->exec('PRAGMA journal_mode=WAL');
    $p->exec('CREATE TABLE IF NOT EXISTS ts_people (k TEXT PRIMARY KEY, kind TEXT, id TEXT, n TEXT, e TEXT, ph TEXT, ti TEXT, loc TEXT, auth TEXT, years REAL, upd INTEGER, src TEXT, skills TEXT, sig TEXT, txt TEXT, nt TEXT, at INTEGER)');
    $p->exec('CREATE TABLE IF NOT EXISTS ts_meta (k TEXT PRIMARY KEY, v TEXT)');
    // v36.2: an ATS person saved from the consultant database or a portal account keeps the link (cand:…, u:…), so a
    // search shows them once
    $cols = array_column($p->query('PRAGMA table_info(ts_people)')->fetchAll(), 'name');
    if (!in_array('lk', $cols, true)) {
        $p->exec("ALTER TABLE ts_people ADD COLUMN lk TEXT NOT NULL DEFAULT ''");
    }
    // v68: the recognized domains (JSON: tech, ind) of the resume
    if (!in_array('dom', $cols, true)) {
        $p->exec("ALTER TABLE ts_people ADD COLUMN dom TEXT NOT NULL DEFAULT ''");
    }
    try {
        $p->exec("CREATE VIRTUAL TABLE IF NOT EXISTS ts_fts USING fts5(k UNINDEXED, body, tokenize = 'unicode61')");
        $GLOBALS['tsFts'] = true;
    } catch (Throwable $e) {
        $GLOBALS['tsFts'] = false;
    }
    return $p;
}
function tsMeta(string $k, ?string $v = null): string
{
    if ($v !== null) {
        tsdb()->prepare('REPLACE INTO ts_meta (k, v) VALUES (?, ?)')->execute([$k, $v]);
        return $v;
    }
    $s = tsdb()->prepare('SELECT v FROM ts_meta WHERE k = ?');
    $s->execute([$k]);
    return (string) ($s->fetchColumn() ?: '');
}
/** Lower case, tech names with symbols spelled out (C#, C++, .NET, Node.js), everything else to single spaces. */
function tsNorm(string $s): string
{
    $s = mb_strtolower($s);
    $s = strtr($s, ['c#' => ' csharp ', 'f#' => ' fsharp ', 'c++' => ' cplusplus ', 'asp.net' => ' aspdotnet ', 'vb.net' => ' vbdotnet ', '.net' => ' dotnet ', 'node.js' => ' nodejs ', 'vue.js' => ' vuejs ', 'react.js' => ' reactjs ', 'next.js' => ' nextjs ', 'express.js' => ' expressjs ', 'd3.js' => ' d3js ', 'objective-c' => ' objectivec ', 'ci/cd' => ' cicd ', 'pl/sql' => ' plsql ', 't-sql' => ' tsql ', 's/4hana' => ' s4hana ']);
    $s = preg_replace('/[^\p{L}\p{N}]+/u', ' ', $s) ?? $s;
    return trim(preg_replace('/\s+/', ' ', $s) ?? $s);
}
function tsMonth(string $s, bool $end): ?int
{
    $s = trim($s);
    if ($s === '') {
        return null;
    }
    if (preg_match('/present|current|now|date|ongoing/i', $s)) {
        return (int) date('Y') * 12 + (int) date('n');
    }
    if (preg_match('/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*[\'’]?(\d{2,4})/i', $s, $m)) {
        $y = (int) $m[2];
        $y = $y < 100 ? $y + 2000 : $y;
        return $y * 12 + (int) array_search(strtolower(substr($m[1], 0, 3)), ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'], true) + 1;
    }
    if (preg_match('/(\d{1,2})\/((?:19|20)\d{2})/', $s, $m)) {
        return (int) $m[2] * 12 + (int) $m[1];
    }
    if (preg_match('/((?:19|20)\d{2})/', $s, $m)) {
        return (int) $m[1] * 12 + ($end ? 12 : 1);
    }
    return null;
}
/**
 * A resume read for search: [skills => [name => [y => years, c => claimed]], years, title, loc, auth].
 * A skill's years are the months of the dated jobs whose title, bullets or Environment line name it (a month counts
 * once however many jobs overlap); skills named only elsewhere (summary, skills list) show with 0 years.
 */
function tsRead(string $text): array
{
    $r = tailorParse($text);
    $nowM = (int) date('Y') * 12 + (int) date('n');
    $all = [];
    $per = [];
    foreach ($r['experience'] as $e) {
        $a = tsMonth($e['from'], false);
        $b = tsMonth($e['to'], true) ?? $a;
        if ($a === null || $b === null || $b < $a) {
            continue;
        }
        $b = min($b, $nowM);
        $months = range($a, max($a, $b));
        foreach ($months as $m) {
            $all[$m] = true;
        }
        foreach (skillsIn($e['ti'] . "\n" . implode("\n", $e['bullets']) . "\n" . ($e['env'] ?? ''), 80) as $sk) {
            foreach ($months as $m) {
                $per[$sk][$m] = true;
            }
        }
    }
    $total = $all ? round(count($all) / 12, 1) : (float) (resumeYears($text) ?? 0);
    $skills = [];
    foreach ($per as $sk => $ms) {
        $skills[$sk] = ['y' => round(count($ms) / 12, 1), 'c' => 0];
    }
    foreach (skillsIn($text, 120) as $sk) {
        if (!isset($skills[$sk])) {
            $skills[$sk] = ['y' => 0.0, 'c' => 0];
        }
    }
    // "8+ years of Java": counts when it is not more than the whole dated history
    if (preg_match_all('/(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b(?:\s+of)?(?:\s+(?:hands[- ]on|professional|strong|extensive|solid|deep))?(?:\s+experience)?\s+(?:in|with|on|using|of|working with)?\s*([A-Za-z.#+][\w.#+\/ \-]{1,30})/i', $text, $mm, PREG_SET_ORDER)) {
        foreach ($mm as $x) {
            $n = (int) $x[1];
            foreach (skillsIn($x[2], 2) as $sk) {
                if ($n > ($skills[$sk]['y'] ?? 0) && ($total <= 0 || $n <= $total + 1)) {
                    $skills[$sk] = ['y' => (float) $n, 'c' => 1];
                }
                break;
            }
        }
    }
    uasort($skills, fn($p, $q) => $q['y'] <=> $p['y']);
    return ['skills' => $skills, 'years' => $total, 'title' => $r['title'] !== '' ? $r['title'] : (string) ($r['experience'][0]['ti'] ?? ''), 'loc' => $r['loc'], 'auth' => $r['auth']];
}
/** Every searchable person, without reading resumes: [k, kind, id, sig, loader] - the loader returns the row. */
function tsSources(): array
{
    $out = [];
    // ATS candidates
    foreach (colAll('ats') as [$id, $c]) {
        $id = (string) $id;
        if ($id === 'x' || !isset($c->n)) {
            continue;
        }
        $lk = !empty($c->cand) ? 'cand:' . $c->cand : (!empty($c->uid) ? 'u:' . $c->uid : '');
        $out['ats:' . $id] = ['ats', $id, (string) ($c->rid ?? '') . '|' . (int) ($c->u ?? $c->at ?? 0) . '|' . $lk, function () use ($id, $c, $lk) {
            return ['n' => (string) $c->n, 'e' => (string) ($c->e ?? ''), 'ph' => (string) ($c->ph ?? ''), 'ti' => (string) (($c->ti ?? '') ?: ($c->jt ?? '')), 'loc' => (string) ($c->loc ?? ''), 'auth' => (string) ($c->auth ?? ''), 'sk' => (string) ($c->sk ?? ''), 'upd' => (int) ($c->u ?? $c->at ?? 0), 'src' => 'ATS' . ((string) ($c->src ?? '') !== '' ? ' · ' . $c->src : ''), 'txt' => vmsResumeText('ats/' . $id), 'lk' => $lk];
        }];
    }
    // the consultant database
    foreach (colAll('rec/cand/items') as [$id, $c]) {
        $id = (string) $id;
        if (($c->st ?? 'active') === 'archived') {
            continue;
        }
        $out['cand:' . $id] = ['cand', $id, (string) ($c->rid ?? '') . '|' . (int) ($c->u ?? $c->at ?? 0), function () use ($id, $c) {
            return ['n' => (string) ($c->n ?? ''), 'e' => (string) ($c->e ?? ''), 'ph' => (string) ($c->ph ?? ''), 'ti' => (string) ($c->ti ?? ''), 'loc' => (string) ($c->loc ?? ''), 'auth' => (string) ($c->auth ?? ''), 'sk' => (string) ($c->sk ?? ''), 'upd' => (int) ($c->u ?? $c->at ?? 0), 'src' => 'Consultant database', 'txt' => (string) ($c->rid ?? '') !== '' ? vmsResumeText('rec/cand/items/' . $id) : ''];
        }];
    }
    // consultants and employees in the portals (their active resume)
    try {
        $s = jdb()->query("SELECT jp.uid, jp.resume_text, jp.resume_name, jp.profile, u.name AS uname, u.email AS uemail FROM job_people jp JOIN users u ON u.id = jp.uid WHERE u.status = 'active'");
        foreach ($s->fetchAll() as $p) {
            $uid = (string) $p['uid'];
            $txt = (string) $p['resume_text'];
            $out['u:' . $uid] = ['u', $uid, md5($txt . '|' . (string) $p['resume_name'] . '|' . (string) $p['uname']), function () use ($uid, $p, $txt) {
                $pr = jdec((string) $p['profile']);
                $prof = docGet('u/' . $uid);
                return ['n' => (string) $p['uname'], 'e' => (string) $p['uemail'], 'ph' => (string) ($prof->p->ph ?? ''), 'ti' => (string) (($pr['titles'][0] ?? '') ?: ($prof->p->ti ?? '')), 'loc' => (string) (($pr['location'] ?? '') ?: ($prof->p->loc ?? '')), 'auth' => '', 'sk' => implode(', ', (array) ($pr['skills'] ?? [])), 'upd' => (int) ($prof->u ?? $prof->joined ?? 0), 'src' => 'Portal', 'txt' => $txt];
            }];
        }
    } catch (Throwable $e) {
    }
    return $out;
}
/** Brings the index up to date with what changed (within a time budget). */
function tsIndex(int $budget = 20, bool $full = false): array
{
    $t0 = microtime(true);
    $db = tsdb();
    $have = [];
    foreach ($db->query('SELECT k, sig FROM ts_people') as $r) {
        $have[$r['k']] = $r['sig'];
    }
    $src = tsSources();
    $changed = 0;
    $left = 0;
    $ins = $db->prepare('REPLACE INTO ts_people (k, kind, id, n, e, ph, ti, loc, auth, years, upd, src, skills, sig, txt, nt, at, lk, dom) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    $stores = []; // v68: the domains to keep on the records, written after the index transaction
    $fts = !empty($GLOBALS['tsFts']);
    $db->beginTransaction();
    try {
        foreach ($src as $k => [$kind, $id, $sig, $load]) {
            if (!$full && isset($have[$k]) && $have[$k] === $sig) {
                continue;
            }
            if (microtime(true) - $t0 > $budget) {
                $left++;
                continue;
            }
            $row = $load();
            $txt = cleanText((string) $row['txt'], 60000);
            $rd = $txt !== '' ? tsRead($txt) : ['skills' => [], 'years' => 0, 'title' => '', 'loc' => '', 'auth' => ''];
            // skills typed on the record count as named (0 years) when the resume does not show them
            foreach (skillsCanon(array_filter(array_map('trim', preg_split('/[,;|\n]+/', (string) $row['sk']) ?: []))) as $sk) {
                if (!isset($rd['skills'][$sk])) {
                    $rd['skills'][$sk] = ['y' => 0.0, 'c' => 0];
                }
            }
            $body = $row['n'] . "\n" . $row['ti'] . "\n" . $row['sk'] . "\n" . $txt;
            $nt = tsNorm($body);
            // v68: the technology and industry domains the resume shows (the title and the skills typed on the record count too)
            $ti = $row['ti'] !== '' ? $row['ti'] : $rd['title'];
            $dom = domRecognize($ti . "\n" . $row['sk'] . "\n" . $txt, $rd['skills'], $ti);
            $stores[] = [$kind, $id, $dom];
            $ins->execute([$k, $kind, $id, mb_substr($row['n'], 0, 160), mb_strtolower(mb_substr($row['e'], 0, 190)), mb_substr($row['ph'], 0, 40), mb_substr($ti, 0, 160), mb_substr($row['loc'] !== '' ? $row['loc'] : $rd['loc'], 0, 120), mb_substr($row['auth'] !== '' ? $row['auth'] : $rd['auth'], 0, 60), (float) $rd['years'], (int) $row['upd'], mb_substr($row['src'], 0, 80), json_encode($rd['skills']), $sig, $txt, $nt, now(), (string) ($row['lk'] ?? ''), json_encode(domSlim($dom))]);
            if ($fts) {
                $db->prepare('DELETE FROM ts_fts WHERE k = ?')->execute([$k]);
                $db->prepare('INSERT INTO ts_fts (k, body) VALUES (?, ?)')->execute([$k, $nt]);
            }
            $changed++;
        }
        // people who are gone
        $gone = array_diff(array_keys($have), array_keys($src));
        foreach ($gone as $k) {
            $db->prepare('DELETE FROM ts_people WHERE k = ?')->execute([$k]);
            if ($fts) {
                $db->prepare('DELETE FROM ts_fts WHERE k = ?')->execute([$k]);
            }
        }
        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        throw $e;
    }
    tsMeta('at', (string) now());
    // v68: the domains go onto the records themselves (only when they changed), so every page that shows the person has them
    foreach ($stores as [$kind, $id, $dom]) {
        try {
            domStore($kind, $id, $dom);
        } catch (Throwable $e) {
        }
    }
    return ['n' => count($src), 'changed' => $changed, 'removed' => count($gone), 'left' => $left, 'at' => now(), 'fts' => $fts];
}

/* ---------- the Boolean query: words, "phrases", prefix*, AND / OR / NOT (or -word), brackets ---------- */
function tsParse(string $q): ?array
{
    preg_match_all('/"[^"]*"|\(|\)|[^\s()"]+/u', $q, $m);
    $tok = $m[0];
    $pos = 0;
    $tree = tsPOr($tok, $pos);
    return $tree ?: null;
}
function tsIsOp(?string $t, string $op): bool
{
    return $t !== null && strtoupper($t) === $op && !str_starts_with($t, '"');
}
function tsPOr(array $tok, int &$pos): ?array
{
    $left = tsPAnd($tok, $pos);
    while (tsIsOp($tok[$pos] ?? null, 'OR')) {
        $pos++;
        $right = tsPAnd($tok, $pos);
        if ($right) {
            $left = $left ? ['or', $left, $right] : $right;
        }
    }
    return $left;
}
function tsPAnd(array $tok, int &$pos): ?array
{
    $left = tsPAtom($tok, $pos);
    while (($t = $tok[$pos] ?? null) !== null && $t !== ')' && !tsIsOp($t, 'OR')) {
        if (tsIsOp($t, 'AND')) {
            $pos++;
        }
        $right = tsPAtom($tok, $pos);
        if ($right) {
            $left = $left ? ['and', $left, $right] : $right;
        }
    }
    return $left;
}
function tsPAtom(array $tok, int &$pos): ?array
{
    $t = $tok[$pos] ?? null;
    if ($t === null) {
        return null;
    }
    if ($t === '(') {
        $pos++;
        $e = tsPOr($tok, $pos);
        if (($tok[$pos] ?? null) === ')') {
            $pos++;
        }
        return $e;
    }
    if (tsIsOp($t, 'NOT')) {
        $pos++;
        $a = tsPAtom($tok, $pos);
        return $a ? ['not', $a] : null;
    }
    $pos++;
    if ($t === ')' || tsIsOp($t, 'AND') || tsIsOp($t, 'OR')) {
        return null;
    }
    $neg = false;
    if (str_starts_with($t, '-') && mb_strlen($t) > 1) {
        $neg = true;
        $t = mb_substr($t, 1);
    }
    $phrase = str_starts_with($t, '"');
    $raw = trim($t, '"');
    $prefix = !$phrase && str_ends_with($raw, '*');
    $norm = tsNorm(rtrim($raw, '*'));
    if ($norm === '') {
        return null;
    }
    $node = ['term', $norm, $prefix, $raw];
    return $neg ? ['not', $node] : $node;
}
function tsEval(?array $n, string $padded): bool
{
    if (!$n) {
        return true;
    }
    return match ($n[0]) {
        'and' => tsEval($n[1], $padded) && tsEval($n[2], $padded),
        'or' => tsEval($n[1], $padded) || tsEval($n[2], $padded),
        'not' => !tsEval($n[1], $padded),
        default => $n[2] ? str_contains($padded, ' ' . $n[1]) : str_contains($padded, ' ' . $n[1] . ' '),
    };
}
/** The FTS5 expression that narrows the rows (a superset of the exact check); null when it cannot narrow. */
function tsFts(?array $n): ?string
{
    if (!$n) {
        return null;
    }
    switch ($n[0]) {
        case 'and':
            $a = tsFts($n[1]);
            $b = tsFts($n[2]);
            return $a && $b ? "($a AND $b)" : ($a ?: $b);
        case 'or':
            $a = tsFts($n[1]);
            $b = tsFts($n[2]);
            return $a && $b ? "($a OR $b)" : null;
        case 'not':
            return null;
    }
    return '"' . str_replace('"', '', $n[1]) . '"' . ($n[2] ? '*' : '');
}
function tsTerms(?array $n, bool $neg = false): array
{
    if (!$n) {
        return [];
    }
    return match ($n[0]) {
        'and', 'or' => array_merge(tsTerms($n[1], $neg), tsTerms($n[2], $neg)),
        'not' => tsTerms($n[1], !$neg),
        default => $neg ? [] : [$n[3]],
    };
}
/** A line of the resume around the first keyword. */
function tsSnippet(string $txt, array $terms): string
{
    $flat = preg_replace('/\s+/', ' ', $txt) ?? $txt;
    foreach ($terms as $t) {
        $t = trim($t, '"*');
        if ($t === '') {
            continue;
        }
        $p = mb_stripos($flat, $t);
        if ($p !== false) {
            $s = max(0, $p - 70);
            return ($s > 0 ? '…' : '') . trim(mb_substr($flat, $s, 200)) . '…';
        }
    }
    return mb_substr($flat, 0, 160) . (mb_strlen($flat) > 160 ? '…' : '');
}
/**
 * The search. $f: q (Boolean), skills [[s, y]], loc, auth [keys], ymin, ymax, upd (days), src {ats, cand, u},
 * sort (score|recent|years), since (ms: only people indexed after it - alerts). Returns [rows, total].
 */
function tsSearch(array $f, int $limit = 100): array
{
    $db = tsdb();
    $tree = tsParse((string) ($f['q'] ?? ''));
    $rowsSql = 'SELECT k, kind, id, n, e, ph, ti, loc, auth, years, upd, src, skills, txt, nt, at, lk, dom FROM ts_people';
    $args = [];
    $where = [];
    $kinds = array_keys(array_filter((array) ($f['src'] ?? ['ats' => 1, 'cand' => 1, 'u' => 1])));
    $kinds = array_values(array_intersect($kinds, ['ats', 'cand', 'u']));
    if (!$kinds) {
        return [[], 0];
    }
    $where[] = 'kind IN (' . implode(',', array_fill(0, count($kinds), '?')) . ')';
    array_push($args, ...$kinds);
    $fts = !empty($GLOBALS['tsFts']) ? tsFts($tree) : null;
    if ($fts) {
        $where[] = 'k IN (SELECT k FROM ts_fts WHERE ts_fts MATCH ?)';
        $args[] = $fts;
    }
    if (!empty($f['upd'])) {
        $where[] = 'upd >= ?';
        $args[] = now() - (int) $f['upd'] * 86400000;
    }
    if (!empty($f['since'])) {
        $where[] = 'at >= ?';
        $args[] = (int) $f['since'];
    }
    if (isset($f['ymin']) && $f['ymin'] !== '' && $f['ymin'] !== null) {
        $where[] = 'years >= ?';
        $args[] = (float) $f['ymin'];
    }
    if (isset($f['ymax']) && $f['ymax'] !== '' && $f['ymax'] !== null && (float) $f['ymax'] > 0) {
        $where[] = 'years <= ?';
        $args[] = (float) $f['ymax'];
    }
    $st = $db->prepare($rowsSql . ($where ? ' WHERE ' . implode(' AND ', $where) : ''));
    try {
        $st->execute($args);
    } catch (Throwable $e) {
        // an expression FTS5 cannot read: check every row instead
        if ($fts) {
            $f2 = $f;
            $GLOBALS['tsFts'] = false;
            $r = tsSearch($f2, $limit);
            $GLOBALS['tsFts'] = true;
            return $r;
        }
        throw $e;
    }
    $need = [];
    foreach ((array) ($f['skills'] ?? []) as $sy) {
        $sy = (array) $sy;
        $s = trim((string) ($sy['s'] ?? ($sy[0] ?? '')));
        if ($s === '') {
            continue;
        }
        $canon = skillsCanon([$s])[0] ?? $s;
        $need[] = [$canon, max(0.0, (float) ($sy['y'] ?? ($sy[1] ?? 0))), tsNorm($s)];
    }
    $loc = mb_strtolower(trim((string) ($f['loc'] ?? '')));
    $locs = array_values(array_filter(array_map('trim', explode(',', $loc))));
    $auths = array_values(array_filter(array_map('strval', (array) ($f['auth'] ?? []))));
    // v68: a technology domain and an industry domain (keys of the catalogs)
    $domTech = preg_replace('/[^a-z0-9]/', '', (string) ($f['dom'] ?? ''));
    $domInd = preg_replace('/[^a-z0-9]/', '', (string) ($f['ind'] ?? ''));
    $terms = tsTerms($tree);
    $out = [];
    while ($r = $st->fetch()) {
        $padded = ' ' . $r['nt'] . ' ';
        if ($tree && !tsEval($tree, $padded)) {
            continue;
        }
        $rdom = json_decode((string) ($r['dom'] ?? ''), true) ?: null;
        if (($domTech !== '' || $domInd !== '') && !domHas($rdom, $domTech, $domInd)) {
            continue;
        }
        $skills = json_decode((string) $r['skills'], true) ?: [];
        $lower = [];
        foreach ($skills as $k => $v) {
            $lower[mb_strtolower($k)] = [$k, (float) ($v['y'] ?? 0), (int) ($v['c'] ?? 0)];
        }
        $okAll = true;
        $hits = [];
        $margin = 0.0;
        foreach ($need as [$canon, $min, $norm]) {
            // "AWS" is met by AWS Lambda or AWS EC2 too (the longest stretch of them counts)
            $lc = mb_strtolower($canon);
            $h = $lower[$lc] ?? null;
            foreach ($lower as $lk => $lv) {
                if (str_starts_with($lk, $lc . ' ') && (!$h || $lv[1] > $h[1])) {
                    $h = [$canon . ' (' . $lv[0] . ')', $lv[1], $lv[2]];
                }
            }
            if (!$h && $min <= 0 && str_contains($padded, ' ' . $norm . ' ')) {
                $h = [$canon, 0.0, 0];
            }
            if (!$h || $h[1] + 0.001 < $min) {
                $okAll = false;
                break;
            }
            $hits[] = ['s' => $h[0], 'y' => $h[1], 'c' => $h[2]];
            $margin += min(5, $h[1] - $min);
        }
        if (!$okAll) {
            continue;
        }
        if ($locs) {
            $rl = mb_strtolower($r['loc'] . ' ' . mb_substr($r['txt'], 0, 400));
            $hit = false;
            foreach ($locs as $l) {
                if ($l !== '' && (str_contains($rl, $l) || (strlen($l) === 2 && preg_match('/,\s*' . preg_quote($l, '/') . '\b/i', $r['loc'])))) {
                    $hit = true;
                }
            }
            if (!$hit) {
                continue;
            }
        }
        if ($auths) {
            [$listed] = ruleAuthInSafe((string) $r['auth'] . ' ' . mb_substr($r['txt'], 0, 1500));
            if (!array_intersect($auths, $listed)) {
                continue;
            }
        }
        // the score: skills beyond the minimum, keyword hits, recency, experience
        $kw = 0;
        foreach ($terms as $t) {
            $kw += min(5, substr_count($padded, ' ' . tsNorm(trim($t, '"*'))));
        }
        $days = $r['upd'] ? (now() - (int) $r['upd']) / 86400000 : 999;
        $score = 40 + min(25, $margin * 3) + min(20, $kw * 2) + ($days <= 30 ? 15 : ($days <= 90 ? 10 : ($days <= 365 ? 4 : 0))) + min(5, (float) $r['years'] / 4);
        $top = [];
        foreach (array_slice($skills, 0, 8, true) as $k => $v) {
            $top[] = ['s' => $k, 'y' => (float) $v['y'], 'c' => (int) ($v['c'] ?? 0)];
        }
        $out[] = [
            'k' => $r['k'], 'kind' => $r['kind'], 'id' => $r['id'], 'n' => $r['n'], 'e' => $r['e'], 'ph' => $r['ph'], 'ti' => $r['ti'], 'loc' => $r['loc'], 'auth' => $r['auth'], 'years' => (float) $r['years'], 'upd' => (int) $r['upd'], 'src' => $r['src'], 'lk' => (string) ($r['lk'] ?? ''),
            'hits' => $hits, 'top' => $top, 'snip' => $terms ? tsSnippet($r['txt'], $terms) : '', 'score' => (int) round(min(100, $score)), 'resume' => mb_strlen($r['txt']) > 200,
            'dom' => $rdom, // v68
        ];
    }
    $sort = (string) ($f['sort'] ?? 'score');
    usort($out, fn($a, $b) => match ($sort) {
        'recent' => $b['upd'] <=> $a['upd'],
        'years' => $b['years'] <=> $a['years'],
        default => $b['score'] <=> $a['score'] ?: $b['upd'] <=> $a['upd'],
    });
    // one row per person: the same email in the ATS, the database and a portal shows once, with where else they are;
    // v36.2: so does an ATS record saved from a database record or a portal account (linked by lk), email or not
    $seen = [];
    $uniq = [];
    foreach ($out as $row) {
        $em = trim($row['e']);
        $keys = array_values(array_filter(['k:' . $row['k'], $row['lk'] !== '' ? 'k:' . $row['lk'] : '', $em !== '' ? 'e:' . $em : '']));
        $at = null;
        foreach ($keys as $kk) {
            if (isset($seen[$kk])) {
                $at = $seen[$kk];
                break;
            }
        }
        if ($at !== null) {
            $uniq[$at]['also'][] = ['k' => $row['k'], 'src' => $row['src']];
            foreach ($keys as $kk) {
                $seen[$kk] = $seen[$kk] ?? $at;
            }
            continue;
        }
        $row['also'] = [];
        foreach ($keys as $kk) {
            $seen[$kk] = count($uniq);
        }
        $uniq[] = $row;
    }
    return [array_slice($uniq, 0, $limit), count($uniq)];
}
/** Work-authorization keys in a text (rules.php when present). */
function ruleAuthInSafe(string $t): array
{
    require_once __DIR__ . '/rules.php';
    return ruleAuthIn($t);
}
/** The new matches of saved searches with alerts, emailed to their owners once a day. */
function tsAlerts(): int
{
    $sent = 0;
    foreach (colAll('ts/x/saved') as [$id, $s]) {
        if (empty($s->alert) || (int) ($s->last ?? 0) > now() - 20 * 3600000) {
            continue;
        }
        $owner = userById((string) ($s->uid ?? ''));
        if (!$owner || ($owner['status'] ?? '') !== 'active') {
            continue;
        }
        $f = json_decode(json_encode($s->q ?? new stdClass()), true) ?: [];
        $fl = $f;
        $fl['since'] = (int) ($s->last ?? 0) ?: now() - 86400000;
        [$rows] = tsSearch($fl, 20);
        $seen = (array) ($s->seen ?? []);
        $new = array_values(array_filter($rows, fn($r) => !in_array($r['k'], $seen, true)));
        // v36.1: the same search on Dice when the saved search includes it (people found there are saved as set)
        $dNew = [];
        $mark = [];
        if (!empty($f['src']['dice'])) {
            require_once __DIR__ . '/tsdice.php';
            [$dNew, $mark] = tsDiceAlert($owner, $f, (string) ($s->name ?? ''), $seen, array_map(fn($r) => $r['k'], $new));
        }
        $s->last = now();
        if ($new || $dNew) {
            $lines = array_map(fn($r) => '- ' . $r['n'] . ($r['ti'] ? ', ' . $r['ti'] : '') . ($r['loc'] ? ' (' . $r['loc'] . ')' : '') . ($r['hits'] ? ': ' . implode(', ', array_map(fn($h) => $h['s'] . ' ' . $h['y'] . 'y', $r['hits'])) : ''), array_slice($new, 0, 10));
            foreach (array_slice($dNew, 0, 10) as $r) {
                $lines[] = '- ' . $r['n'] . ($r['ti'] ? ', ' . $r['ti'] : '') . ($r['loc'] ? ' (' . $r['loc'] . ')' : '') . ' · on Dice' . ($r['ats'] !== '' ? ', saved to the ATS' : '') . ($r['url'] !== '' ? ': ' . $r['url'] : '');
            }
            $total = count($new) + count($dNew);
            $subject = $total . ' new match' . ($total === 1 ? '' : 'es') . ' for "' . (string) ($s->name ?? 'your search') . '"' . ($dNew ? ' (' . count($dNew) . ' on Dice)' : '');
            $link = siteUrl() . '#/portal/admin/search?saved=' . $id;
            sendMail((string) $owner['email'], (string) $owner['name'], $subject, "New people for your saved search:\n\n" . implode("\n", $lines) . "\n\nOpen the search: " . $link, emailHtml($subject, array_merge(['New people for your saved search:'], $lines), ['Open the search', $link]));
            $sent++;
        }
        $s->seen = array_slice(array_values(array_unique(array_merge($seen, array_map(fn($r) => $r['k'], $new), $mark))), -2000);
        docSet('ts/x/saved/' . $id, $s);
    }
    return $sent;
}
function tsRoute(string $r, array $b): never
{
    $u = tailorStaff();
    switch ($r) {
        case 'ts_search': {
            session_write_close();
            @set_time_limit(90);
            $t0 = microtime(true);
            // keep the index fresh: a short top-up before each search, the rest on the next one or the cron
            $last = (int) tsMeta('at');
            $ix = null;
            if ($last < now() - 120000) {
                $ix = tsIndex($last ? 4 : 25);
            }
            $f = (array) ($b['f'] ?? []);
            [$rows, $total] = tsSearch($f, 200);
            // v36.2: the people found in the consultant database and the portals are saved into the ATS (as set)
            $saved = 0;
            try {
                require_once __DIR__ . '/tssave.php';
                $saved = tsSaveFound($u, $rows, $f);
            } catch (Throwable $e) {
                @error_log(date('c') . ' talent save: ' . $e->getMessage() . "\n", 3, storeDir() . '/error.log');
            }
            ok(['rows' => $rows, 'total' => $total, 'saved' => $saved, 'took' => (int) round((microtime(true) - $t0) * 1000), 'index' => ['n' => (int) tsdb()->query('SELECT COUNT(*) FROM ts_people')->fetchColumn(), 'at' => (int) tsMeta('at'), 'left' => (int) ($ix['left'] ?? 0), 'fts' => !empty($GLOBALS['tsFts'])]]);
        }
        case 'ts_index': {
            session_write_close();
            @set_time_limit(150);
            ok(tsIndex(100, !empty($b['full'])));
        }
        case 'ts_person': {
            $k = str($b, 'k', 80);
            $s = tsdb()->prepare('SELECT k, kind, id, n, e, ph, ti, loc, auth, years, upd, src, skills, txt, dom FROM ts_people WHERE k = ?');
            $s->execute([$k]);
            $p = $s->fetch();
            if (!$p) {
                fail(404, 'not_found', 'That person is no longer in the index.');
            }
            $p['skills'] = json_decode((string) $p['skills'], true) ?: [];
            $p['dom'] = json_decode((string) ($p['dom'] ?? ''), true) ?: null; // v68
            ok(['p' => $p]);
        }
        case 'ts_fromjd': {
            // a job description becomes a search: its skills (with the years it asks for) and its title
            $text = (string) ($b['jd'] ?? '');
            if (mb_strlen(trim($text)) < 40) {
                fail(400, 'invalid_argument', 'Paste the job description first.');
            }
            $jd = tailorJd($text, []);
            $skills = [];
            foreach (array_slice($jd['skills'], 0, 8) as $sk) {
                $y = 0;
                if (preg_match('/(\d{1,2})\s*\+?\s*(?:years?|yrs?)[^.\n]{0,40}?' . preg_quote($sk, '/') . '|' . preg_quote($sk, '/') . '[^.\n]{0,30}?(\d{1,2})\s*\+?\s*(?:years?|yrs?)/i', $text, $m)) {
                    $y = (int) (($m[1] ?? '') !== '' ? $m[1] : ($m[2] ?? 0));
                }
                $skills[] = ['s' => $sk, 'y' => $y];
            }
            ok(['skills' => $skills, 'title' => $jd['title'], 'years' => $jd['years'], 'loc' => $jd['loc']]);
        }
        case 'ts_saved': {
            $out = [];
            foreach (colAll('ts/x/saved') as [$id, $s]) {
                if ((string) ($s->uid ?? '') === $u['id']) {
                    $out[] = ['id' => (string) $id, 'name' => (string) ($s->name ?? ''), 'q' => $s->q ?? new stdClass(), 'alert' => !empty($s->alert), 'at' => (int) ($s->at ?? 0), 'last' => (int) ($s->last ?? 0)];
                }
            }
            usort($out, fn($a, $b2) => $b2['at'] <=> $a['at']);
            // v36.1: whether Dice is searched too, and what happens to the people found there
            $dice = null;
            $save = null;
            try {
                require_once __DIR__ . '/tsdice.php';
                $dice = tsDicePublic();
                // v36.2: who is saved into the ATS (one setting for every source)
                $sv = tsSaveCfg();
                $save = ['save' => $sv['save'], 'min' => $sv['min'], 'can' => tsCanSet($u), 'wait' => count((array) (secKv('ts_res_q') ?: []))];
            } catch (Throwable $e) {
            }
            ok(['rows' => $out, 'dice' => $dice, 'save' => $save, 'dom' => domCatalog()]); // v68: the domain catalogs for the filters
        }
        case 'ts_domains': {
            // v68: how many people the index recognizes per domain, and the catalogs
            $counts = ['tech' => [], 'ind' => []];
            foreach (tsdb()->query('SELECT dom FROM ts_people') as $r) {
                $d = json_decode((string) $r['dom'], true) ?: [];
                foreach (['tech', 'ind'] as $g) {
                    foreach ((array) ($d[$g] ?? []) as $x) {
                        $counts[$g][$x['k']] = ($counts[$g][$x['k']] ?? 0) + 1;
                    }
                }
            }
            ok(['cat' => domCatalog(), 'counts' => $counts, 'n' => (int) tsdb()->query('SELECT COUNT(*) FROM ts_people')->fetchColumn(), 'at' => (int) tsMeta('at')]);
        }
        case 'ts_dom_rescan': {
            // v68: read every resume in the index again for its domains (after a catalog change) and keep them on the records
            session_write_close();
            @set_time_limit(150);
            $db = tsdb();
            $n = 0;
            $upd = $db->prepare('UPDATE ts_people SET dom = ? WHERE k = ?');
            foreach ($db->query('SELECT k, kind, id, ti, skills, txt FROM ts_people')->fetchAll() as $r) {
                $dom = domRecognize((string) $r['ti'] . "\n" . (string) $r['txt'], json_decode((string) $r['skills'], true) ?: [], (string) $r['ti']);
                $upd->execute([json_encode(domSlim($dom)), $r['k']]);
                try {
                    domStore((string) $r['kind'], (string) $r['id'], $dom);
                } catch (Throwable $e) {
                }
                $n++;
            }
            audit('talent', 'Domains read again', '', ['n' => $n], $u);
            ok(['n' => $n]);
        }
        case 'ts_cfg_save': {
            // v36.2: administrators and HR: who Talent search saves into the ATS
            require_once __DIR__ . '/tssave.php';
            if (!tsCanSet($u)) {
                fail(403, 'forbidden', 'Administrators and HR decide who Talent search saves into the ATS.');
            }
            $save = (string) ($b['save'] ?? '');
            if (!in_array($save, ['all', 'fit', 'off'], true)) {
                fail(400, 'invalid_argument', 'Choose everyone found, only those who fit, or nobody.');
            }
            $min = max(30, min(95, (int) ($b['min'] ?? 60)));
            docSet('ts/x/cfg', (object) ['save' => $save, 'min' => $min, 'at' => now(), 'by' => $u['id'], 'byn' => $u['name']]);
            audit('settings', 'Talent search: who is saved into the ATS', 'ts', ['save' => $save, 'min' => $min], $u);
            ok(['save' => $save, 'min' => $min]);
        }
        case 'ts_dice': {
            // v36.1: the same search on Dice (live), the people found saved into the ATS as the administrator set
            session_write_close();
            @set_time_limit(120);
            require_once __DIR__ . '/tsdice.php';
            if (throttleHit('tsdice:' . $u['id'], 60, 600)) {
                fail(429, 'rate_limited', 'That is a lot of Dice searches in a few minutes. Try again shortly.');
            }
            ok(tsDice($u, (array) ($b['f'] ?? []), max(1, min(20, (int) ($b['page'] ?? 1)))));
        }
        case 'ts_dice_fetch': {
            // v36.1: administrators: read the waiting Dice profiles now (otherwise the scheduled task does it)
            if (!hasRole($u, 'admin')) {
                fail(403, 'forbidden', 'Reading Dice profiles on demand is for administrators.');
            }
            session_write_close();
            @set_time_limit(150);
            require_once __DIR__ . '/tsdice.php';
            ok(tsDiceDrain(100, 25));
        }
        case 'ts_toats': {
            // v36.1: the chosen people into the ATS talent pool (consultant database, portal people and Dice people);
            // v36.2: as full records (on the ATS page at once, with the resume); someone a search already saved becomes one
            require_once __DIR__ . '/ats.php';
            require_once __DIR__ . '/tsdice.php';
            $me = atsStaff(true);
            $keys = array_slice(array_values(array_unique(array_filter(array_map('strval', (array) ($b['keys'] ?? []))))), 0, 200);
            $dice = (array) ($b['dice'] ?? []);
            $added = [];
            $have = [];
            $queued = 0;
            $h = tsHave();
            $cfg = tsDiceCfg();
            $promote = function (string $aid) use (&$have, $me): void {
                $c = docGet('ats/' . $aid);
                if (!$c) {
                    return;
                }
                if (!empty($c->lite)) {
                    atsLog($c, (string) $me['name'], 'Chosen in Talent search');
                    $c->u = now();
                    docSet('ats/' . $aid, $c);
                }
                $have[] = ['n' => (string) ($c->n ?? ''), 'id' => $aid];
            };
            foreach ($keys as $k) {
                [$kind, $id] = array_pad(explode(':', $k, 2), 2, '');
                if ($kind === 'ats') {
                    $promote($id);
                    continue;
                }
                if ($kind === 'cand' || $kind === 'u') {
                    $src = tsSourceInfo($kind, $id, $k);
                    if (!$src) {
                        continue;
                    }
                    $hit = ($h['ats']['l:' . $k] ?? '') ?: ($src['e'] !== '' ? ($h['ats']['e:' . $src['e']] ?? '') : '') ?: ($src['xid'] !== '' ? ($h['ats']['x:' . $src['xid']] ?? '') : '');
                    if ($hit !== '') {
                        $promote($hit);
                        continue;
                    }
                    $nid = tsSaveOne($me, ['kind' => $kind, 'id' => $id, 'k' => $k], 'Saved to the ATS from Talent search by ' . $me['name'], false);
                    if ($nid === '') {
                        continue;
                    }
                    tsResCopy($nid, $k);
                    $h['ats']['l:' . $k] = $nid;
                    if ($src['e'] !== '') {
                        $h['ats']['e:' . $src['e']] = $nid;
                    }
                    $added[] = ['n' => $src['n'], 'id' => $nid, 'k' => $k];
                    continue;
                }
                if ($kind === 'dice') {
                    $row = tsDiceRowIn($dice[$id] ?? null, $id);
                    if (!$row) {
                        continue;
                    }
                    $hit = tsHaveOf($h, 'ats', $id, $row['e']);
                    if ($hit !== '') {
                        $promote($hit);
                        continue;
                    }
                    $row['cand'] = tsHaveOf($h, 'cand', $id, $row['e']);
                    $nid = tsDiceSave($me, $row, $me['name'] . ' (chosen in Talent search)');
                    $h['ats']['x:dice:' . $id] = $nid;
                    if ($cfg['prof']) {
                        tsDiceQueue($nid, $id);
                        $queued++;
                    }
                    $added[] = ['n' => $row['n'], 'id' => $nid, 'k' => $k];
                }
            }
            if ($added) {
                audit('data', 'People saved to the ATS from Talent search', 'ats', ['n' => count($added)], $me);
            }
            if ($queued) {
                tsDiceSoon();
            }
            ok(['added' => $added, 'have' => $have, 'queued' => $queued]);
        }
        case 'ts_save': {
            $name = str($b, 'name', 80);
            if ($name === '') {
                fail(400, 'invalid_argument', 'Name the search.');
            }
            $id = preg_replace('/[^a-f0-9]/', '', str($b, 'id', 24)) ?: rid(6);
            $old = docGet('ts/x/saved/' . $id);
            if ($old && (string) ($old->uid ?? '') !== $u['id']) {
                fail(403, 'forbidden', 'That search belongs to someone else.');
            }
            $q = (array) ($b['f'] ?? []);
            docSet('ts/x/saved/' . $id, (object) ['uid' => $u['id'], 'name' => $name, 'q' => (object) $q, 'alert' => !empty($b['alert']), 'at' => (int) ($old->at ?? now()), 'last' => (int) ($old->last ?? now()), 'seen' => (array) ($old->seen ?? [])]);
            ok(['id' => $id]);
        }
        case 'ts_delete': {
            $id = preg_replace('/[^a-f0-9]/', '', str($b, 'id', 24)) ?? '';
            $old = docGet('ts/x/saved/' . $id);
            if ($old && (string) ($old->uid ?? '') === $u['id']) {
                docDelete('ts/x/saved/' . $id);
            }
            ok(['ok' => true]);
        }
        case 'ts_tojob': {
            // the chosen people onto an open job in the ATS (ATS access needed)
            require_once __DIR__ . '/ats.php';
            $me = atsStaff(true);
            $jid = preg_replace('/[^A-Za-z0-9_\-]/', '', str($b, 'job', 60)) ?? '';
            $pub = atsPublicJob($jid);
            if (!$pub) {
                fail(400, 'invalid_argument', 'Pick an open job.');
            }
            $keys = array_slice(array_values(array_filter(array_map('strval', (array) ($b['keys'] ?? [])))), 0, 200);
            $added = [];
            $skipped = [];
            $dh = null;
            foreach ($keys as $k) {
                [$kind, $id] = array_pad(explode(':', $k, 2), 2, '');
                // v36.1: a Dice person: the ATS record when they are in the ATS already, otherwise a new one on the job
                if ($kind === 'dice') {
                    require_once __DIR__ . '/tsdice.php';
                    $row = tsDiceRowIn(((array) ($b['dice'] ?? []))[$id] ?? null, $id);
                    if (!$row) {
                        continue;
                    }
                    $dh = $dh ?? tsHave();
                    $hit = tsHaveOf($dh, 'ats', $id, $row['e']);
                    if ($hit === '') {
                        $row['cand'] = tsHaveOf($dh, 'cand', $id, $row['e']);
                        $nid = tsDiceSave($me, $row, $me['name'] . ' (added to ' . $pub->ti . ' in Talent search)', '', [], $jid);
                        $dh['ats']['x:dice:' . $id] = $nid;
                        if (tsDiceCfg()['prof']) {
                            tsDiceQueue($nid, $id);
                            tsDiceSoon();
                        }
                        $added[] = $row['n'];
                        continue;
                    }
                    $kind = 'ats';
                    $id = $hit;
                }
                // v36.2: someone from the consultant database or a portal who is in the ATS already (saved by a search,
                // or added before): that ATS record goes onto the job instead of a second one
                if ($kind === 'cand' || $kind === 'u') {
                    require_once __DIR__ . '/tssave.php';
                    $dh = $dh ?? tsHave();
                    $src = tsSourceInfo($kind, $id, $k);
                    $hit = $src ? (($dh['ats']['l:' . $k] ?? '') ?: ($src['e'] !== '' ? ($dh['ats']['e:' . $src['e']] ?? '') : '')) : '';
                    if ($hit !== '') {
                        $kind = 'ats';
                        $id = $hit;
                    }
                }
                if ($kind === 'ats') {
                    $c = docGet('ats/' . $id);
                    if (!$c) {
                        continue;
                    }
                    if ((string) ($c->job ?? '') === $jid) {
                        $skipped[] = $c->n . ': already on this job';
                        continue;
                    }
                    if ((string) ($c->job ?? '') === '') {
                        $c->job = $jid;
                        $c->jt = (string) $pub->ti;
                        $c->pool = false;
                        atsLog($c, (string) $me['name'], 'Added to ' . $pub->ti . ' from Talent search');
                        $c->u = now();
                        docSet('ats/' . $id, $c);
                        $added[] = $c->n;
                        continue;
                    }
                    $f = ['n' => $c->n, 'e' => $c->e ?? '', 'ph' => $c->ph ?? '', 'ti' => $c->ti ?? '', 'sk' => $c->sk ?? '', 'loc' => $c->loc ?? '', 'auth' => $c->auth ?? '', 'exp' => $c->exp ?? 0, 'li' => $c->li ?? '', 'rate' => $c->rate ?? ''];
                    $nid = atsNewCandidate($me, $f, (string) ($c->src ?? 'Talent search'), $jid, 'Added from Talent search (also applied to ' . ($c->jt ?? 'another job') . ')');
                    if ((string) ($c->rid ?? '') !== '') {
                        $newF = atsCopyResume($nid, (string) $c->rid, (string) ($c->rn ?? 'resume.pdf'));
                        if ($newF) {
                            $x = docGet('ats/' . $nid);
                            $x->rid = $newF;
                            $x->rn = (string) ($c->rn ?? 'resume.pdf');
                            docSet('ats/' . $nid, $x);
                        }
                    }
                    $added[] = $c->n;
                } elseif ($kind === 'cand' || $kind === 'u') {
                    $in = atsEmailsIn();
                    if ($kind === 'cand') {
                        $c = docGet('rec/cand/items/' . $id);
                        if (!$c) {
                            continue;
                        }
                        $e = mb_strtolower(trim((string) ($c->e ?? '')));
                        $f = ['n' => (string) ($c->n ?? ''), 'e' => $e, 'ph' => (string) ($c->ph ?? ''), 'ti' => (string) ($c->ti ?? ''), 'sk' => (string) ($c->sk ?? ''), 'loc' => (string) ($c->loc ?? ''), 'auth' => (string) ($c->auth ?? ''), 'exp' => (float) ($c->exp ?? 0), 'li' => (string) ($c->li ?? ''), 'rate' => (string) ($c->rate ?? '')];
                        $nid = atsNewCandidate($me, $f, 'Consultant database', $jid, 'Added from Talent search', ['cand' => $id]);
                        if ((string) ($c->rid ?? '') !== '') {
                            $newF = atsCopyResume($nid, (string) $c->rid, (string) ($c->rn ?? 'resume.pdf'));
                            if ($newF) {
                                $x = docGet('ats/' . $nid);
                                $x->rid = $newF;
                                $x->rn = (string) ($c->rn ?? 'resume.pdf');
                                docSet('ats/' . $nid, $x);
                            }
                        }
                        $added[] = $f['n'];
                    } else {
                        $s = tsdb()->prepare('SELECT n, e, ph, ti, loc FROM ts_people WHERE k = ?');
                        $s->execute([$k]);
                        $p = $s->fetch();
                        if (!$p) {
                            continue;
                        }
                        $nid = atsNewCandidate($me, ['n' => $p['n'], 'e' => $p['e'], 'ph' => $p['ph'], 'ti' => $p['ti'], 'loc' => $p['loc']], 'Consultant portal', $jid, 'Added from Talent search', ['uid' => $id]);
                        $s2 = jdb()->prepare('SELECT resume_fid, resume_name FROM job_people WHERE uid = ?');
                        $s2->execute([$id]);
                        $jp = $s2->fetch();
                        if ($jp && (string) $jp['resume_fid'] !== '') {
                            $newF = atsCopyResume($nid, (string) $jp['resume_fid'], (string) ($jp['resume_name'] ?: 'resume.pdf'));
                            if ($newF) {
                                $x = docGet('ats/' . $nid);
                                $x->rid = $newF;
                                $x->rn = (string) ($jp['resume_name'] ?: 'resume.pdf');
                                docSet('ats/' . $nid, $x);
                            }
                        }
                        $added[] = $p['n'];
                    }
                }
            }
            ok(['added' => $added, 'skipped' => $skipped, 'job' => (string) $pub->ti]);
        }
    }
    fail(404, 'not_found', 'Unknown action.');
}
