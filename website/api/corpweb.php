<?php
declare(strict_types=1);
/*
 * v50 Specialist service pages and case evidence (CC-07).
 *
 * Service pages (for example SAP, cloud, security, software roles) explain the buyer's problem, the scope, how
 * StratEdge screens, the steps of an engagement, typical roles and technologies, common questions, and end in a
 * request button that names the page. A page says whether the service is available now, available in a limited way,
 * or planned; a planned service is never listed. A page is written as a draft and an administrator publishes it;
 * visitors see the published version until the changes are published too. A page may name the person who answers
 * its requests.
 *
 * Case evidence is published only after its factual review is recorded (who checked it against which source records,
 * the period, how each number was measured). A named client, a quote or a logo needs the client's permission
 * recorded too; without it a case describes the client without its name ("a pharmaceutical manufacturer in New
 * Jersey"). A conceptual example is always labeled "Example" and cannot carry a client, a quote, a logo or numbers.
 * Changing the facts after the review needs the review again; changing the name, the quote or the logo needs that
 * permission again.
 *
 * Requests sent from a page carry its name: the website lead records the page (and goes to the page's person when it
 * names one), and the visitor's receipt names the inquiry and who will reply. StratEdge sees the inquiries each page
 * brought and how far they went (discussion, qualified, a confirmed talent request from the company, or not a fit and
 * why).
 *
 * StratEdge's own website only: a company workspace's address answers 404. Tables (main database): cw_page, cw_case.
 */

// the client companies' requests (cr_req) and who works client accounts (crStaff)
require_once __DIR__ . '/corp.php';

const CW_AVAIL = ['now' => 'Available now', 'limited' => 'Limited availability', 'planned' => 'Planned'];
const CW_CST = ['draft' => 'Draft', 'reviewed' => 'Reviewed', 'published' => 'Published', 'withdrawn' => 'Withdrawn'];
const CW_SLUG_RE = '/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/';
const CW_PERM = ['name' => 'company name', 'quote' => 'quote', 'logo' => 'logo'];
const CW_LOGO_TYPES = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp'];

function cwDb(): PDO
{
    static $ready = false;
    $p = db();
    if (!$ready) {
        $ready = true;
        $p->exec("CREATE TABLE IF NOT EXISTS cw_page (id VARCHAR(20) PRIMARY KEY, slug VARCHAR(50) NOT NULL UNIQUE, ti VARCHAR(160) NOT NULL, st VARCHAR(10) NOT NULL, avail VARCHAR(10) NOT NULL, ord INT NOT NULL DEFAULT 0, own VARCHAR(40) NOT NULL DEFAULT '', data TEXT NOT NULL, pub TEXT NOT NULL, pub_at BIGINT NOT NULL DEFAULT 0, pub_by VARCHAR(120) NOT NULL DEFAULT '', by_uid VARCHAR(40) NOT NULL, at BIGINT NOT NULL, u BIGINT NOT NULL)");
        $p->exec("CREATE TABLE IF NOT EXISTS cw_case (id VARCHAR(20) PRIMARY KEY, slug VARCHAR(50) NOT NULL UNIQUE, ti VARCHAR(160) NOT NULL, st VARCHAR(10) NOT NULL, ex INT NOT NULL DEFAULT 0, data TEXT NOT NULL, rev TEXT NOT NULL, perm TEXT NOT NULL, pub TEXT NOT NULL, pub_at BIGINT NOT NULL DEFAULT 0, pub_by VARCHAR(120) NOT NULL DEFAULT '', by_uid VARCHAR(40) NOT NULL, at BIGINT NOT NULL, u BIGINT NOT NULL)");
    }
    return $p;
}
/** StratEdge's own site (not a company workspace). */
function cwHere(): bool
{
    return !function_exists('wsCurrent') || wsCurrent() === null;
}
function cwDecode(array $r): array
{
    foreach (['data', 'pub', 'rev', 'perm'] as $k) {
        if (array_key_exists($k, $r)) {
            $r[$k] = json_decode((string) $r[$k], true) ?: [];
        }
    }
    return $r;
}
function cwRow(string $table, string $id): ?array
{
    $s = cwDb()->prepare("SELECT * FROM $table WHERE id = ?");
    $s->execute([$id]);
    $r = $s->fetch();
    return $r ? cwDecode($r) : null;
}
function cwSlug(string $s): string
{
    $s = strtolower(trim((string) preg_replace('/[^A-Za-z0-9]+/', '-', $s), '-'));
    return trim(substr($s, 0, 50), '-');
}
/** A service page's content from the editor, cleaned. */
function cwPageIn($in): array
{
    $a = (array) $in;
    $s = fn($v, int $max) => mb_substr(trim((string) $v), 0, $max);
    $list = fn(string $k, int $n, int $max) => array_values(array_filter(array_map(fn($x) => $s($x, $max), array_slice((array) ($a[$k] ?? []), 0, $n)), fn($x) => $x !== ''));
    $faq = [];
    foreach (array_slice((array) ($a['faq'] ?? []), 0, 12) as $f) {
        $f = (array) $f;
        if ($s($f['q'] ?? '', 200) !== '' && $s($f['a'] ?? '', 1500) !== '') {
            $faq[] = ['q' => $s($f['q'], 200), 'a' => $s($f['a'], 1500)];
        }
    }
    // the services video: a link to an https address (opened on its own site; nothing is embedded)
    $video = $s($a['video'] ?? '', 300);
    if ($video !== '' && (!filter_var($video, FILTER_VALIDATE_URL) || !str_starts_with(strtolower($video), 'https://'))) {
        $video = '';
    }
    return [
        'sum' => $s($a['sum'] ?? '', 300), 'problem' => $s($a['problem'] ?? '', 3000), 'screen' => $s($a['screen'] ?? '', 3000),
        'scope' => $list('scope', 15, 300), 'steps' => $list('steps', 10, 300), 'roles' => $list('roles', 30, 120), 'tech' => $list('tech', 40, 80), 'faq' => $faq,
        'cta' => $s($a['cta'] ?? '', 60) ?: 'Request talent', 'limitNote' => $s($a['limitNote'] ?? '', 300), 'video' => $video,
    ];
}
/** A case's content from the editor, cleaned (the logo is set by its own upload and kept here). */
function cwCaseIn($in, bool $example, ?array $logo = null): array
{
    $a = (array) $in;
    $s = fn($v, int $max) => mb_substr(trim((string) $v), 0, $max);
    $date = fn($v) => preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', (string) $v) ? (string) $v : '';
    $metrics = [];
    foreach (array_slice((array) ($a['metrics'] ?? []), 0, 8) as $m) {
        $m = (array) $m;
        if ($s($m['label'] ?? '', 120) === '' || $s($m['value'] ?? '', 60) === '') {
            continue;
        }
        $metrics[] = ['label' => $s($m['label'], 120), 'value' => $s($m['value'], 60), 'how' => $s($m['how'] ?? '', 500), 'n' => $s($m['n'] ?? '', 60)];
    }
    $cl = (array) ($a['client'] ?? []);
    $q = (array) ($a['quote'] ?? []);
    $pages = [];
    foreach (array_slice((array) ($a['pages'] ?? []), 0, 10) as $x) {
        if (preg_match(CW_SLUG_RE, (string) $x) && !in_array((string) $x, $pages, true)) {
            $pages[] = (string) $x;
        }
    }
    $d = [
        'client' => ['named' => !empty($cl['named']), 'name' => $s($cl['name'] ?? '', 120), 'desc' => $s($cl['desc'] ?? '', 200)],
        'from' => $date($a['from'] ?? ''), 'to' => $date($a['to'] ?? ''), 'pages' => $pages,
        'sum' => $s($a['sum'] ?? '', 300), 'challenge' => $s($a['challenge'] ?? '', 3000), 'did' => $s($a['did'] ?? '', 3000), 'outcome' => $s($a['outcome'] ?? '', 3000),
        'metrics' => $metrics, 'quote' => ['text' => $s($q['text'] ?? '', 600), 'who' => $s($q['who'] ?? '', 120)], 'sources' => $s($a['sources'] ?? '', 2000),
        'logo' => $logo,
    ];
    if (!$d['client']['named']) {
        $d['client']['name'] = '';
    }
    if ($d['to'] !== '' && $d['from'] !== '' && $d['to'] < $d['from']) {
        $d['to'] = '';
    }
    if ($example) {
        // a conceptual example: no client, no period, no quote, no logo, no numbers
        $d['client'] = ['named' => false, 'name' => '', 'desc' => ''];
        $d['quote'] = ['text' => '', 'who' => ''];
        $d['metrics'] = [];
        $d['from'] = '';
        $d['to'] = '';
        $d['logo'] = null;
    }
    return $d;
}
/** What a case needs before it is published ('' when it may be). */
function cwCaseGate(array $c): string
{
    $d = $c['data'];
    if ((int) $c['ex'] === 1) {
        return $d['challenge'] === '' && $d['did'] === '' ? 'Describe the example first (the challenge or what we do).' : '';
    }
    if ($d['challenge'] === '' || $d['did'] === '' || $d['outcome'] === '') {
        return 'Write the challenge, what we did and the outcome.';
    }
    if (empty($c['rev']['at'])) {
        return 'Record the factual review first: who checked it against which records.';
    }
    if ($d['from'] === '') {
        return 'Give the period the case covers.';
    }
    foreach ($d['metrics'] as $m) {
        if ($m['how'] === '') {
            return 'Say how "' . $m['label'] . '" was measured.';
        }
    }
    if (!empty($d['logo']) && !$d['client']['named']) {
        return 'A logo names the client: tick "Name the client" or remove the logo.';
    }
    if ($d['client']['named'] && $d['client']['name'] === '') {
        return 'Give the client\'s name, or untick "Name the client".';
    }
    $needs = [];
    if ($d['client']['named']) {
        $needs[] = 'name';
    }
    if ($d['quote']['text'] !== '') {
        $needs[] = 'quote';
    }
    if (!empty($d['logo'])) {
        $needs[] = 'logo';
    }
    $miss = array_values(array_diff($needs, (array) ($c['perm']['covers'] ?? [])));
    if ($miss) {
        return 'Record the client\'s permission for the ' . implode(' and the ', array_map(fn($x) => CW_PERM[$x], $miss)) . ' first.';
    }
    if (!$d['client']['named'] && $d['client']['desc'] === '') {
        return 'Describe the client without naming them (for example: "a pharmaceutical manufacturer in New Jersey").';
    }
    return '';
}
/** What visitors see of a case: its published version. */
function cwCasePublic(array $c): array
{
    $d = $c['pub'];
    $named = !empty($d['client']['named']);
    $logo = $named && !empty($d['logo']['f']) ? 'api/index.php?r=pub_cw_logo&slug=' . rawurlencode((string) $c['slug']) . '&v=' . (int) ($d['logo']['at'] ?? 0) : '';
    return [
        'slug' => (string) $c['slug'], 'ti' => (string) ($d['ti'] ?? $c['ti']), 'ex' => (int) $c['ex'] === 1, 'client' => $named ? (string) $d['client']['name'] : (string) ($d['client']['desc'] ?? ''),
        'named' => $named, 'logo' => $logo, 'from' => (string) ($d['from'] ?? ''), 'to' => (string) ($d['to'] ?? ''), 'pages' => (array) ($d['pages'] ?? []), 'sum' => (string) ($d['sum'] ?? ''),
        'challenge' => (string) ($d['challenge'] ?? ''), 'did' => (string) ($d['did'] ?? ''), 'outcome' => (string) ($d['outcome'] ?? ''), 'metrics' => (array) ($d['metrics'] ?? []),
        'quote' => ($d['quote']['text'] ?? '') !== '' ? $d['quote'] : null, 'at' => (int) $c['pub_at'],
    ];
}
/** What visitors see of a page: its published version (the availability is current). */
function cwPagePublic(array $p, bool $full): array
{
    $d = $p['pub'];
    $out = ['slug' => (string) $p['slug'], 'ti' => (string) ($d['ti'] ?? $p['ti']), 'avail' => (string) $p['avail'], 'sum' => (string) ($d['sum'] ?? ''), 'cta' => (string) ($d['cta'] ?? 'Request talent')];
    if ($full) {
        foreach (['problem' => '', 'scope' => [], 'screen' => '', 'steps' => [], 'roles' => [], 'tech' => [], 'faq' => [], 'video' => ''] as $k => $def) {
            $out[$k] = $d[$k] ?? $def;
        }
        // what is limited goes with the availability: both change at once, published or not
        $out['limitNote'] = (string) ($p['data']['limitNote'] ?? '');
    }
    return $out;
}
/** The published pages visitors may see (a planned service is not listed). */
function cwPublishedPages(): array
{
    if (!cwHere()) {
        return [];
    }
    return array_map('cwDecode', cwDb()->query("SELECT * FROM cw_page WHERE st = 'published' AND avail <> 'planned' ORDER BY ord, ti")->fetchAll());
}
function cwPublishedCases(): array
{
    if (!cwHere()) {
        return [];
    }
    return array_map('cwDecode', cwDb()->query("SELECT * FROM cw_case WHERE st = 'published' ORDER BY pub_at DESC")->fetchAll());
}
/** The page a website request came from: its published title and the person who answers it (null when none). */
function cwPageFor(string $slug): ?array
{
    if (!cwHere() || !preg_match(CW_SLUG_RE, $slug)) {
        return null;
    }
    foreach (cwPublishedPages() as $p) {
        if ((string) $p['slug'] === $slug) {
            $own = (string) $p['own'];
            $row = $own !== '' ? userRow($own) : null;
            $ok = $row && (string) $row['status'] === 'active' && crStaff($row);
            return ['slug' => $slug, 'ti' => (string) ($p['pub']['ti'] ?? $p['ti']), 'own' => $ok ? $own : ''];
        }
    }
    return null;
}
function cwLogoPath(string $f): string
{
    return preg_match('/^[a-f0-9]{8,20}-\d{10,16}\.(png|jpg|webp)$/', $f) ? storeDir() . '/cw/' . $f : '';
}
function cwSendLogo(string $f): never
{
    $fp = cwLogoPath($f);
    if ($fp === '' || !is_file($fp)) {
        http_response_code(404);
        exit();
    }
    header('Content-Type: ' . array_search(pathinfo($fp, PATHINFO_EXTENSION), CW_LOGO_TYPES, true));
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'; sandbox");
    header('Content-Length: ' . filesize($fp));
    readfile($fp);
    exit();
}

/* ---------- the website (no sign-in) ---------- */
function cwPublicRoute(string $r, array $b): never
{
    if (!cwHere()) {
        fail(404, 'not_found', 'There is no such page.');
    }
    $slug = mb_substr(trim((string) ($b['slug'] ?? ($_GET['slug'] ?? ''))), 0, 50);
    if ($r === 'pub_cw') {
        $pages = array_map(fn($p) => cwPagePublic($p, false), cwPublishedPages());
        $cases = array_map('cwCasePublic', cwPublishedCases());
        ok(['pages' => $pages, 'cases' => array_map(fn($c) => array_intersect_key($c, array_flip(['slug', 'ti', 'ex', 'client', 'named', 'logo', 'from', 'to', 'pages', 'sum'])), $cases), 'avail' => CW_AVAIL]);
    }
    if ($r === 'pub_cw_page') {
        foreach (cwPublishedPages() as $p) {
            if ((string) $p['slug'] === $slug) {
                $cases = array_values(array_filter(array_map('cwCasePublic', cwPublishedCases()), fn($c) => in_array($slug, $c['pages'], true)));
                ok(['page' => cwPagePublic($p, true), 'cases' => $cases, 'avail' => CW_AVAIL]);
            }
        }
        fail(404, 'not_found', 'There is no such page.');
    }
    if ($r === 'pub_cw_case') {
        foreach (cwPublishedCases() as $c) {
            if ((string) $c['slug'] === $slug) {
                $on = (array) ($c['pub']['pages'] ?? []);
                ok(['case' => cwCasePublic($c), 'pages' => array_map(fn($p) => cwPagePublic($p, false), array_values(array_filter(cwPublishedPages(), fn($p) => in_array((string) $p['slug'], $on, true))))]);
            }
        }
        fail(404, 'not_found', 'There is no such case.');
    }
    if ($r === 'pub_cw_logo') {
        // a client's logo: only on a published case that names the client (its permission was recorded to publish it)
        foreach (cwPublishedCases() as $c) {
            if ((string) $c['slug'] === $slug && !empty($c['pub']['client']['named']) && !empty($c['pub']['logo']['f'])) {
                header('Cache-Control: public, max-age=86400');
                cwSendLogo((string) $c['pub']['logo']['f']);
            }
        }
        http_response_code(404);
        exit();
    }
    fail(404, 'not_found', 'Unknown request.');
}

/* ---------- StratEdge ---------- */
function cwRoute(string $r, array $b, array $u, bool $staff): never
{
    // administrators, HR and the people with the CRM feature write the website's pages and cases; an administrator
    // publishes them
    if (!cwHere()) {
        fail(404, 'not_found', 'Unknown request.');
    }
    $may = $staff && (hasRole($u, 'admin') || hasRole($u, 'hr') || grantOf((string) $u['id'], 'crm'));
    if (function_exists('featureAllowed')) {
        // v58+: an administrator may allow or block "Service pages & cases" for one person (Roles & access)
        $may = featureAllowed($u, 'service_pages', $may);
    }
    if (!$may) {
        fail(403, 'forbidden', 'The website\'s service pages and cases are for administrators, HR and the sales team.');
    }
    $p = cwDb();
    $admin = hasRole($u, 'admin');
    $str = fn(string $k, int $max) => mb_substr(trim((string) ($b[$k] ?? '')), 0, $max);
    $view = function (array $x, string $kind) {
        $live = $x['data'] + ['ti' => (string) $x['ti']];
        $out = ['id' => (string) $x['id'], 'slug' => (string) $x['slug'], 'ti' => (string) $x['ti'], 'st' => (string) $x['st'], 'data' => $x['data'], 'pubAt' => (int) $x['pub_at'], 'pubBy' => (string) $x['pub_by'], 'u' => (int) $x['u'], 'unpub' => (string) $x['st'] === 'published' && json_encode($live) !== json_encode($x['pub'])];
        if ($kind === 'page') {
            $out += ['avail' => (string) $x['avail'], 'ord' => (int) $x['ord'], 'own' => (string) $x['own']];
        } else {
            $logo = $x['data']['logo'] ?? null;
            $out += ['ex' => (int) $x['ex'] === 1, 'rev' => $x['rev'] ?: null, 'perm' => $x['perm'] ?: null, 'gate' => cwCaseGate($x), 'logoUrl' => $logo ? 'api/index.php?r=cw_logo&id=' . $x['id'] . '&v=' . (int) $logo['at'] : ''];
        }
        return $out;
    };
    $all = function (string $table, string $kind) use ($p, $view): array {
        return array_map(fn($x) => $view(cwDecode($x), $kind), $p->query("SELECT * FROM $table ORDER BY " . ($kind === 'page' ? 'ord, ti' : 'u DESC'))->fetchAll());
    };
    $staffOk = function (string $uid): bool {
        $row = $uid !== '' ? userRow($uid) : null;
        return $row && (string) $row['status'] === 'active' && crStaff($row);
    };
    switch ($r) {
        case 'cw_home':
            $team = [];
            foreach (db()->query("SELECT id, email, name, role, status, access FROM users WHERE status = 'active' ORDER BY name")->fetchAll() as $row) {
                if (crStaff($row)) {
                    $team[] = ['id' => (string) $row['id'], 'n' => (string) $row['name']];
                }
            }
            ok(['pages' => $all('cw_page', 'page'), 'cases' => $all('cw_case', 'case'), 'admin' => $admin, 'avail' => CW_AVAIL, 'cst' => CW_CST, 'perm' => CW_PERM, 'team' => $team]);

        case 'cw_stats':
            $days = (int) ($b['days'] ?? 0);
            ok(['stats' => cwStats(in_array($days, [30, 90, 365], true) ? $days : 0)]);

        case 'cw_page_save':
            $id = $str('id', 20);
            $ti = $str('ti', 160);
            $slug = cwSlug($str('slug', 60) ?: $ti);
            if ($ti === '' || !preg_match(CW_SLUG_RE, $slug)) {
                fail(400, 'invalid_argument', 'Give the page a title (its address is made from it).');
            }
            $avail = isset(CW_AVAIL[(string) ($b['avail'] ?? '')]) ? (string) $b['avail'] : 'now';
            $own = $str('own', 40);
            if ($own !== '' && !$staffOk($own)) {
                fail(400, 'invalid_argument', 'Choose someone at StratEdge who works client accounts to answer the requests.');
            }
            $d = cwPageIn($b['data'] ?? []);
            $dupe = $p->prepare('SELECT id FROM cw_page WHERE slug = ? AND id <> ?');
            $dupe->execute([$slug, $id]);
            if ($dupe->fetchColumn()) {
                fail(409, 'conflict', 'Another page already has the address "' . $slug . '".');
            }
            if ($id === '') {
                $id = rid(8);
                $p->prepare("INSERT INTO cw_page (id, slug, ti, st, avail, ord, own, data, pub, by_uid, at, u) VALUES (?,?,?,'draft',?,?,?,?,'{}',?,?,?)")->execute([$id, $slug, $ti, $avail, (int) ($b['ord'] ?? 0), $own, json_encode($d), $u['id'], now(), now()]);
            } else {
                $x = cwRow('cw_page', $id) ?? fail(404, 'not_found', 'No such page.');
                if ((string) $x['st'] === 'published' && $slug !== (string) $x['slug']) {
                    fail(409, 'conflict', 'A published page keeps its address; unpublish it first to change it.');
                }
                // the availability and who answers take effect at once (visitors rely on the availability); the content
                // waits for an administrator to publish it
                $p->prepare('UPDATE cw_page SET slug = ?, ti = ?, avail = ?, ord = ?, own = ?, data = ?, u = ? WHERE id = ?')->execute([$slug, $ti, $avail, (int) ($b['ord'] ?? $x['ord']), $own, json_encode($d), now(), $id]);
                if ((string) $x['st'] === 'published' && $avail !== (string) $x['avail']) {
                    audit('website', 'Service page availability changed', $ti, ['from' => CW_AVAIL[(string) $x['avail']] ?? '', 'to' => CW_AVAIL[$avail]], $u);
                }
            }
            ok(['id' => $id, 'slug' => $slug]);

        case 'cw_page_pub':
            if (!$admin) {
                fail(403, 'forbidden', 'An administrator publishes website pages.');
            }
            $x = cwRow('cw_page', $str('id', 20)) ?? fail(404, 'not_found', 'No such page.');
            if (!empty($b['off'])) {
                $p->prepare("UPDATE cw_page SET st = 'draft', u = ? WHERE id = ?")->execute([now(), (string) $x['id']]);
                audit('website', 'Service page unpublished', (string) $x['ti'], ['slug' => (string) $x['slug']], $u);
                ok(['ok' => true]);
            }
            $d = $x['data'];
            if ($d['sum'] === '' || $d['problem'] === '' || !$d['scope'] || !$d['steps']) {
                fail(400, 'invalid_argument', 'A page needs a summary, the buyer\'s problem, the scope and the steps before it is published.');
            }
            $p->prepare("UPDATE cw_page SET st = 'published', pub = ?, pub_at = ?, pub_by = ?, u = ? WHERE id = ?")->execute([json_encode($d + ['ti' => (string) $x['ti']]), now(), (string) $u['name'], now(), (string) $x['id']]);
            audit('website', 'Service page published', (string) $x['ti'], ['slug' => (string) $x['slug'], 'availability' => CW_AVAIL[(string) $x['avail']] ?? ''], $u);
            ok(['ok' => true]);

        case 'cw_case_save':
            $id = $str('id', 20);
            $ti = $str('ti', 160);
            $slug = cwSlug($str('slug', 60) ?: $ti);
            if ($ti === '' || !preg_match(CW_SLUG_RE, $slug)) {
                fail(400, 'invalid_argument', 'Give the case a title.');
            }
            $dupe = $p->prepare('SELECT id FROM cw_case WHERE slug = ? AND id <> ?');
            $dupe->execute([$slug, $id]);
            if ($dupe->fetchColumn()) {
                fail(409, 'conflict', 'Another case already has the address "' . $slug . '".');
            }
            if ($id === '') {
                $ex = !empty($b['ex']);
                $id = rid(8);
                $d = cwCaseIn($b['data'] ?? [], $ex);
                $p->prepare("INSERT INTO cw_case (id, slug, ti, st, ex, data, rev, perm, pub, by_uid, at, u) VALUES (?,?,?,'draft',?,?,'{}','{}','{}',?,?,?)")->execute([$id, $slug, $ti, $ex ? 1 : 0, json_encode($d), $u['id'], now(), now()]);
                ok(['id' => $id, 'slug' => $slug, 'reviewReset' => false]);
            }
            $x = cwRow('cw_case', $id) ?? fail(404, 'not_found', 'No such case.');
            if ((string) $x['st'] === 'published' && $slug !== (string) $x['slug']) {
                fail(409, 'conflict', 'A published case keeps its address; withdraw it first to change it.');
            }
            $old = $x['data'];
            $d = cwCaseIn($b['data'] ?? [], (int) $x['ex'] === 1, $old['logo'] ?? null);
            // a change to the facts after the review needs the review again (the published version stays as it was);
            // how a number was measured is its method, not a fact: writing it down keeps the review
            $facts = fn(string $ti, array $v) => json_encode([$ti, $v['client'], $v['from'], $v['to'], $v['sum'], $v['challenge'], $v['did'], $v['outcome'], array_map(fn($m) => [$m['label'], $m['value'], $m['n']], $v['metrics']), $v['quote']]);
            $rev = $x['rev'];
            if ($rev && $facts($ti, $d) !== $facts((string) $x['ti'], $old)) {
                $rev = [];
            }
            // the permission covers the client's name and quote as they were: a different one needs it again
            $perm = $x['perm'];
            $covers = (array) ($perm['covers'] ?? []);
            if ($d['client']['name'] !== $old['client']['name'] || !$d['client']['named']) {
                $covers = array_diff($covers, ['name', 'logo']);
            }
            if ($d['quote']['text'] !== $old['quote']['text'] || $d['quote']['who'] !== $old['quote']['who']) {
                $covers = array_diff($covers, ['quote']);
            }
            $permReset = $perm && count($covers) < count((array) ($perm['covers'] ?? []));
            $perm = $covers ? array_merge($perm, ['covers' => array_values($covers)]) : [];
            $st = (string) $x['st'] === 'reviewed' && !$rev ? 'draft' : (string) $x['st'];
            $p->prepare('UPDATE cw_case SET slug = ?, ti = ?, st = ?, data = ?, rev = ?, perm = ?, u = ? WHERE id = ?')->execute([$slug, $ti, $st, json_encode($d), json_encode((object) $rev), json_encode((object) $perm), now(), $id]);
            ok(['id' => $id, 'slug' => $slug, 'reviewReset' => !empty($x['rev']) && !$rev, 'permReset' => $permReset]);

        case 'cw_case_logo':
            // the client's logo (multipart: data {id, off} and the picture): PNG, JPEG or WebP up to 1 MB
            $in = json_decode((string) ($_POST['data'] ?? '{}'), true) ?: [];
            $x = cwRow('cw_case', mb_substr((string) ($in['id'] ?? ''), 0, 20)) ?? fail(404, 'not_found', 'No such case.');
            if ((int) $x['ex'] === 1) {
                fail(409, 'conflict', 'An example names no client, so it has no logo.');
            }
            $d = $x['data'];
            if (!empty($in['off'])) {
                $d['logo'] = null;
            } else {
                $f = $_FILES['file'] ?? null;
                if (!$f || (int) ($f['error'] ?? 1) !== 0 || !is_uploaded_file((string) $f['tmp_name']) || (int) $f['size'] > 1048576) {
                    fail(400, 'invalid_argument', 'Choose a PNG, JPEG or WebP picture up to 1 MB.');
                }
                $info = @getimagesize((string) $f['tmp_name']);
                $ext = CW_LOGO_TYPES[$info['mime'] ?? ''] ?? '';
                if ($ext === '' || ($info[0] ?? 0) < 32 || ($info[1] ?? 0) < 32) {
                    fail(400, 'invalid_argument', 'Choose a PNG, JPEG or WebP picture (at least 32 pixels).');
                }
                $dir = storeDir() . '/cw';
                if (!is_dir($dir)) {
                    @mkdir($dir, 0770, true);
                }
                $name = (string) $x['id'] . '-' . now() . '.' . $ext;
                if (!move_uploaded_file((string) $f['tmp_name'], $dir . '/' . $name)) {
                    fail(500, 'unavailable', 'The picture could not be stored.');
                }
                $d['logo'] = ['f' => $name, 'w' => (int) $info[0], 'h' => (int) $info[1], 'at' => now()];
            }
            // a new or removed logo needs the client's permission for it again
            $perm = $x['perm'];
            if (in_array('logo', (array) ($perm['covers'] ?? []), true)) {
                $perm['covers'] = array_values(array_diff($perm['covers'], ['logo']));
                $perm = $perm['covers'] ? $perm : [];
            }
            $p->prepare('UPDATE cw_case SET data = ?, perm = ?, u = ? WHERE id = ?')->execute([json_encode($d), json_encode((object) $perm), now(), (string) $x['id']]);
            // pictures neither this version nor the published one uses are removed
            $keep = array_filter([(string) ($d['logo']['f'] ?? ''), (string) ($x['pub']['logo']['f'] ?? '')]);
            foreach (glob(storeDir() . '/cw/' . $x['id'] . '-*') ?: [] as $old) {
                if (!in_array(basename($old), $keep, true)) {
                    @unlink($old);
                }
            }
            ok(['ok' => true, 'logo' => $d['logo']]);

        case 'cw_logo':
            // the logo as the draft has it (StratEdge only; a link, GET)
            $x = cwRow('cw_case', mb_substr((string) ($_GET['id'] ?? ($b['id'] ?? '')), 0, 20)) ?? fail(404, 'not_found', 'No such case.');
            header('Cache-Control: private, max-age=300');
            cwSendLogo((string) ($x['data']['logo']['f'] ?? ''));

        case 'cw_case_review':
            // the factual review: who checked the case against which records (not the person who wrote it, when possible)
            $x = cwRow('cw_case', $str('id', 20)) ?? fail(404, 'not_found', 'No such case.');
            if ((int) $x['ex'] === 1) {
                fail(409, 'conflict', 'An example reports no facts to review.');
            }
            $note = $str('msg', 1000);
            if (mb_strlen($note) < 10) {
                fail(400, 'invalid_argument', 'Say what you checked it against (the records, the period, how the numbers were counted).');
            }
            $rev = ['by' => (string) $u['name'], 'uid' => $u['id'], 'at' => now(), 'note' => $note, 'self' => (string) $x['by_uid'] === $u['id']];
            $p->prepare("UPDATE cw_case SET rev = ?, st = CASE WHEN st = 'draft' THEN 'reviewed' ELSE st END, u = ? WHERE id = ?")->execute([json_encode($rev), now(), (string) $x['id']]);
            audit('website', 'Case reviewed', (string) $x['ti'], ['note' => mb_substr($note, 0, 200)], $u);
            ok(['ok' => true]);

        case 'cw_case_perm':
            // the client's permission for its name, a quote and/or its logo, with its evidence
            $x = cwRow('cw_case', $str('id', 20)) ?? fail(404, 'not_found', 'No such case.');
            if ((int) $x['ex'] === 1) {
                fail(409, 'conflict', 'An example names no client.');
            }
            $covers = array_values(array_intersect(array_keys(CW_PERM), array_map('strval', (array) ($b['covers'] ?? []))));
            $who = $str('who', 160);
            $ev = $str('msg', 1000);
            if (!$covers || $who === '' || mb_strlen($ev) < 10) {
                fail(400, 'invalid_argument', 'Say what the permission covers, who gave it and the evidence (for example: "email of Oct 6 from their marketing director").');
            }
            $p->prepare('UPDATE cw_case SET perm = ?, u = ? WHERE id = ?')->execute([json_encode(['covers' => $covers, 'who' => $who, 'ev' => $ev, 'by' => (string) $u['name'], 'at' => now()]), now(), (string) $x['id']]);
            audit('website', 'Client permission recorded', (string) $x['ti'], ['covers' => implode(', ', $covers), 'who' => $who], $u);
            ok(['ok' => true]);

        case 'cw_case_pub':
            if (!$admin) {
                fail(403, 'forbidden', 'An administrator publishes cases.');
            }
            $x = cwRow('cw_case', $str('id', 20)) ?? fail(404, 'not_found', 'No such case.');
            if (!empty($b['off'])) {
                $p->prepare("UPDATE cw_case SET st = 'withdrawn', u = ? WHERE id = ?")->execute([now(), (string) $x['id']]);
                audit('website', 'Case withdrawn', (string) $x['ti'], ['slug' => (string) $x['slug']], $u);
                ok(['ok' => true]);
            }
            if (($why = cwCaseGate($x)) !== '') {
                fail(409, 'not_ready', $why);
            }
            $p->prepare("UPDATE cw_case SET st = 'published', pub = ?, pub_at = ?, pub_by = ?, u = ? WHERE id = ?")->execute([json_encode($x['data'] + ['ti' => (string) $x['ti']]), now(), (string) $u['name'], now(), (string) $x['id']]);
            audit('website', 'Case published', (string) $x['ti'], ['slug' => (string) $x['slug'], 'example' => (int) $x['ex'] === 1, 'named' => !empty($x['data']['client']['named'])], $u);
            ok(['ok' => true]);
    }
    fail(404, 'not_found', 'Unknown request.');
}

/**
 * Inquiries each page brought (website leads that named the page; '-' is the request form opened without a page) and
 * how far they went, in the period: the CRM lead's stage (New; in discussion = Working or Nurture; Qualified;
 * Converted; Unqualified = not a fit, with the reason), and a confirmed talent request from the company afterwards
 * (its CRM company linked to a client company, or a client company of the same name, with a request approved since).
 */
function cwStats(int $days = 0): array
{
    $since = $days > 0 ? now() - $days * 86400000 : 0;
    $cidByName = [];
    foreach (colAll('org/admin/clients') as [$cid, $c]) {
        $n = mb_strtolower(trim((string) ($c->n ?? '')));
        if ($n !== '') {
            $cidByName[$n] = (string) $cid;
        }
    }
    $reqAt = [];
    foreach (crDb()->query("SELECT cid, at FROM cr_req WHERE apv_ver > 0 OR st IN ('approved', 'active', 'filled')")->fetchAll() as $q) {
        $reqAt[(string) $q['cid']][] = (int) $q['at'];
    }
    $by = [];
    foreach (colAll('crm/main/lead') as [, $l]) {
        $pg = (string) ($l->pg ?? '');
        if ($pg === '') {
            // the request form without a page (website leads since v50 say which form), for comparison
            $kind = (string) ($l->k ?? (str_starts_with((string) ($l->notes ?? ''), 'Request talent form') ? 'talent' : ''));
            if ((string) ($l->by ?? '') !== 'web' || $kind !== 'talent') {
                continue;
            }
            $pg = '-';
        }
        $at = (int) ($l->at ?? 0);
        if ($at < $since) {
            continue;
        }
        $b = $by[$pg] ?? ['n' => 0, 'new' => 0, 'disc' => 0, 'qualified' => 0, 'converted' => 0, 'unfit' => 0, 'reached' => 0, 'qual' => 0, 'req' => 0, 'why' => []];
        $b['n']++;
        $k = ['working' => 'disc', 'nurture' => 'disc', 'qualified' => 'qualified', 'converted' => 'converted', 'unqualified' => 'unfit'][mb_strtolower((string) ($l->st ?? 'New'))] ?? 'new';
        $b[$k]++;
        if (in_array($k, ['disc', 'qualified', 'converted'], true)) {
            $b['reached']++;
        }
        if (in_array($k, ['qualified', 'converted'], true)) {
            $b['qual']++;
        }
        if ($k === 'unfit') {
            $w = trim((string) ($l->why ?? '')) ?: 'No reason given';
            $b['why'][$w] = ($b['why'][$w] ?? 0) + 1;
        }
        $cid = '';
        $acc = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($l->acc ?? '')) ?? '';
        if ($acc !== '') {
            $cid = (string) (docGet('crm/main/acc/' . $acc)->cid ?? '');
        }
        if ($cid === '') {
            $cid = $cidByName[mb_strtolower(trim((string) ($l->co ?? '')))] ?? '';
        }
        if ($cid !== '' && array_filter($reqAt[$cid] ?? [], fn($t) => $t >= $at)) {
            $b['req']++;
        }
        $by[$pg] = $b;
    }
    return $by;
}
