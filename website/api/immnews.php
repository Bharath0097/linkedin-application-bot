<?php
declare(strict_types=1);
/* v53: live official immigration intelligence for consultants and employees.
 * Fixed official sources only (no user-supplied URLs): USCIS News & Alerts, the Department of State Visa Bulletin,
 * and FederalRegister.gov. Results are cached on the server so every employee opening the page does not hammer the
 * government sites. StratEdge AI uses the same cache to ground immigration questions in current official material. */

const IMMNEWS_TTL = 600; // 10 minutes
const IMMNEWS_UA = 'StratEdge-portal/53 immigration-intelligence (+https://stratedgeitconsulting.com)';

function immnewsCacheFile(): string
{
    $d = rtrim(storeDir(), '/') . '/cache';
    if (!is_dir($d)) @mkdir($d, 0700, true);
    return $d . '/immigration-news.json';
}
function immnewsClean(string $s, int $max = 500): string
{
    $s = html_entity_decode(strip_tags($s), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $s = preg_replace('/\s+/u', ' ', trim($s)) ?? trim($s);
    return mb_substr($s, 0, $max);
}
function immnewsDate(string $s): string
{
    if (preg_match('/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})\b/i', $s, $m)) {
        $t = strtotime($m[1] . ' ' . $m[2] . ', ' . $m[3]);
        return $t ? date('Y-m-d', $t) : '';
    }
    if (preg_match('/\b(20\d{2})-(\d{2})-(\d{2})\b/', $s, $m)) return $m[0];
    return '';
}
function immnewsAbs(string $base, string $href): string
{
    $href = trim(html_entity_decode($href, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    if ($href === '') return '';
    if (preg_match('#^https://#i', $href)) return $href;
    if (str_starts_with($href, '//')) return 'https:' . $href;
    $p = parse_url($base);
    if (!$p || empty($p['host'])) return '';
    $root = 'https://' . $p['host'];
    if (str_starts_with($href, '/')) return $root . $href;
    $dir = rtrim(str_replace('\\', '/', dirname((string) ($p['path'] ?? '/'))), '/');
    return $root . ($dir === '' ? '' : $dir) . '/' . ltrim($href, '/');
}
/** Fixed-host HTTPS fetch; returns [code, body, error]. */
function immnewsHttp(string $url, string $accept = 'text/html,application/xhtml+xml,application/json'): array
{
    $p = parse_url($url);
    $host = strtolower((string) ($p['host'] ?? ''));
    $allowed = ['www.uscis.gov', 'travel.state.gov', 'www.federalregister.gov'];
    if (($p['scheme'] ?? '') !== 'https' || !in_array($host, $allowed, true)) return [0, '', 'Source address was rejected.'];
    if (!function_exists('curl_init')) return [0, '', 'PHP cURL is not available.'];
    $buf = '';
    $ch = curl_init(extUrl($url));
    $opts = [
        CURLOPT_HTTPHEADER => ['Accept: ' . $accept, 'Accept-Language: en-US,en;q=0.8'],
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_USERAGENT => IMMNEWS_UA,
        CURLOPT_ENCODING => '',
        CURLOPT_WRITEFUNCTION => function ($c, $chunk) use (&$buf) {
            if (strlen($buf) > 4 * 1048576) return 0;
            $buf .= $chunk;
            return strlen($chunk);
        },
    ];
    if (defined('CURLOPT_PROTOCOLS') && defined('CURLPROTO_HTTPS')) $opts[CURLOPT_PROTOCOLS] = CURLPROTO_HTTPS;
    if (defined('CURLOPT_REDIR_PROTOCOLS') && defined('CURLPROTO_HTTPS')) $opts[CURLOPT_REDIR_PROTOCOLS] = CURLPROTO_HTTPS;
    curl_setopt_array($ch, $opts);
    curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_errno($ch) ? curl_error($ch) : '';
    curl_close($ch);
    if ($err !== '') return [$code, $buf, $err];
    if ($code < 200 || $code >= 300) return [$code, $buf, 'Official source answered HTTP ' . $code . '.'];
    return [$code, $buf, ''];
}
function immnewsTags(string $text): array
{
    $x = strtolower($text);
    $map = [
        'h1b' => '/\bh[- ]?1b\b|specialty occupation/',
        'h4' => '/\bh[- ]?4\b/',
        'f1' => '/\bf[- ]?1\b|student visa|student status/',
        'opt' => '/\bopt\b|optional practical training|stem opt/',
        'ead' => '/\bead\b|employment authorization/',
        'greencard' => '/green card|permanent residen|adjustment of status|\bi-485\b|priority date|visa bulletin/',
        'i9' => '/\bi[- ]?9\b|employment eligibility verification|e-verify/',
        'citizenship' => '/citizenship|naturalization|\bn-400\b/',
        'tps' => '/temporary protected status|\btps\b/',
        'asylum' => '/asylum|refugee/',
        'fees' => '/filing fee|fee schedule|premium processing/',
        'forms' => '/\bform\b|\bi-129\b|\bi-140\b|\bi-765\b|\bi-539\b/',
        'employer' => '/employer|worksite|labor condition|nonimmigrant worker|foreign labor/',
    ];
    $out = [];
    foreach ($map as $k => $re) if (preg_match($re, $x)) $out[] = $k;
    return $out;
}
function immnewsUscis(): array
{
    $url = 'https://www.uscis.gov/newsroom/all-news?items_per_page=20';
    [$code, $html, $err] = immnewsHttp($url);
    if ($err !== '' || $html === '') return [[], ['id' => 'uscis', 'name' => 'USCIS News & Alerts', 'url' => 'https://www.uscis.gov/newsroom/all-news', 'ok' => false, 'note' => $err ?: 'No data returned.']];
    $items = [];
    $seen = [];
    if (class_exists('DOMDocument')) {
        $dom = new DOMDocument();
        $old = libxml_use_internal_errors(true);
        @$dom->loadHTML($html, LIBXML_NOWARNING | LIBXML_NOERROR);
        libxml_clear_errors(); libxml_use_internal_errors($old);
        $xp = new DOMXPath($dom);
        foreach ($xp->query('//a[@href]') ?: [] as $a) {
            $href = (string) $a->getAttribute('href');
            if (!preg_match('#/newsroom/(alerts|news-releases)/[^/?#]+#i', $href, $m)) continue;
            $link = immnewsAbs($url, $href);
            if ($link === '' || isset($seen[$link])) continue;
            $title = immnewsClean((string) $a->textContent, 260);
            if (mb_strlen($title) < 14 || preg_match('/^(read more|learn more)$/i', $title)) continue;
            $ctx = '';
            $n = $a;
            for ($i = 0; $i < 4 && $n; $i++, $n = $n->parentNode) $ctx .= ' ' . (string) ($n->textContent ?? '');
            $date = immnewsDate($ctx);
            $plain = immnewsClean($ctx, 1100);
            $summary = trim(str_replace([$title, $date], '', $plain));
            $summary = preg_replace('/^(Alerts?|News Releases?)\s*/i', '', $summary) ?? $summary;
            if (mb_strlen($summary) > 360) $summary = mb_substr($summary, 0, 357) . '…';
            $type = strtolower($m[1]) === 'alerts' ? 'Alert' : 'News Release';
            $items[] = [
                'id' => 'uscis-' . substr(hash('sha256', $link), 0, 14), 'source' => 'USCIS', 'type' => $type,
                'title' => $title, 'date' => $date, 'summary' => $summary, 'url' => $link,
                'tags' => immnewsTags($title . ' ' . $summary), 'official' => true,
            ];
            $seen[$link] = true;
            if (count($items) >= 18) break;
        }
    }
    // Conservative fallback when the DOM extension is unavailable or the page layout changes.
    if (!$items && preg_match_all('#<a[^>]+href=["\']([^"\']*/newsroom/(?:alerts|news-releases)/[^"\'#?]+)["\'][^>]*>(.*?)</a>#is', $html, $mm, PREG_SET_ORDER)) {
        foreach ($mm as $m) {
            $link = immnewsAbs($url, $m[1]); if ($link === '' || isset($seen[$link])) continue;
            $title = immnewsClean($m[2], 260); if (mb_strlen($title) < 14) continue;
            $pos = strpos($html, $m[0]); $tail = $pos === false ? '' : substr($html, $pos, 1200);
            $date = immnewsDate(immnewsClean($tail, 1000));
            $items[] = ['id' => 'uscis-' . substr(hash('sha256', $link), 0, 14), 'source' => 'USCIS', 'type' => str_contains($link, '/alerts/') ? 'Alert' : 'News Release', 'title' => $title, 'date' => $date, 'summary' => '', 'url' => $link, 'tags' => immnewsTags($title), 'official' => true];
            $seen[$link] = true; if (count($items) >= 18) break;
        }
    }
    return [$items, ['id' => 'uscis', 'name' => 'USCIS News & Alerts', 'url' => 'https://www.uscis.gov/newsroom/all-news', 'ok' => (bool) $items, 'note' => $items ? count($items) . ' current items read.' : 'The source loaded, but no news cards could be read. Open USCIS directly.']];
}
function immnewsVisa(): array
{
    $url = 'https://travel.state.gov/content/travel/en/legal/visa-law0/visa-bulletin.html';
    [$code, $html, $err] = immnewsHttp($url);
    $fallback = ['id' => 'dos', 'name' => 'Department of State Visa Bulletin', 'url' => $url, 'ok' => false, 'note' => $err ?: 'No data returned.'];
    if ($err !== '' || $html === '') return [[], $fallback];
    $best = null;
    if (class_exists('DOMDocument')) {
        $dom = new DOMDocument(); $old = libxml_use_internal_errors(true); @$dom->loadHTML($html, LIBXML_NOWARNING | LIBXML_NOERROR); libxml_clear_errors(); libxml_use_internal_errors($old);
        $xp = new DOMXPath($dom);
        foreach ($xp->query('//a[@href]') ?: [] as $a) {
            $title = immnewsClean((string) $a->textContent, 180);
            $href = (string) $a->getAttribute('href');
            if (!preg_match('/Visa Bulletin (?:For )?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})/i', $title, $m)) continue;
            $link = immnewsAbs($url, $href); if ($link === '') continue;
            $ts = strtotime($m[1] . ' 1, ' . $m[2]); if (!$ts) continue;
            if (!$best || $ts > $best['ts']) $best = ['ts' => $ts, 'title' => $title, 'url' => $link];
        }
    }
    if (!$best && preg_match('#href=["\']([^"\']+)["\'][^>]*>\s*Visa Bulletin (?:For )?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\s*</a>#is', $html, $m)) {
        $ts = strtotime($m[2] . ' 1, ' . $m[3]); if ($ts) $best = ['ts' => $ts, 'title' => immnewsClean(strip_tags($m[0]), 180), 'url' => immnewsAbs($url, $m[1])];
    }
    if (!$best) return [[], ['id' => 'dos', 'name' => 'Department of State Visa Bulletin', 'url' => $url, 'ok' => false, 'note' => 'The Visa Bulletin page loaded, but the current bulletin link could not be identified.']];
    $month = date('F Y', (int) $best['ts']);
    $item = [
        'id' => 'dos-vb-' . date('Ym', (int) $best['ts']), 'source' => 'Department of State', 'type' => 'Visa Bulletin',
        'title' => 'Visa Bulletin for ' . $month, 'date' => date('Y-m-01', (int) $best['ts']),
        'summary' => 'Monthly official immigrant visa availability, including Final Action Dates and Dates for Filing. Check the USCIS visa-bulletin page for which chart adjustment-of-status applicants may use.',
        'url' => $best['url'], 'tags' => ['greencard'], 'official' => true,
    ];
    return [[$item], ['id' => 'dos', 'name' => 'Department of State Visa Bulletin', 'url' => $url, 'ok' => true, 'note' => $month . ' identified as the current bulletin.']];
}
function immnewsFederal(): array
{
    $url = 'https://www.federalregister.gov/api/v1/documents.json?per_page=25&order=newest&conditions%5Bterm%5D=immigration';
    [$code, $body, $err] = immnewsHttp($url, 'application/json');
    if ($err !== '' || $body === '') return [[], ['id' => 'fr', 'name' => 'Federal Register', 'url' => 'https://www.federalregister.gov/agencies/citizenship-and-immigration-services', 'ok' => false, 'note' => $err ?: 'No data returned.']];
    $j = json_decode($body, true);
    $rows = is_array($j) && isset($j['results']) && is_array($j['results']) ? $j['results'] : [];
    $items = [];
    foreach ($rows as $r) {
        if (!is_array($r)) continue;
        $ag = array_values(array_filter(array_map(fn($a) => is_array($a) ? (string) ($a['name'] ?? '') : '', (array) ($r['agencies'] ?? []))));
        $agencyText = implode(' · ', $ag);
        $hay = strtolower($agencyText . ' ' . (string) ($r['title'] ?? '') . ' ' . (string) ($r['abstract'] ?? ''));
        if (!preg_match('/citizenship and immigration|homeland security|department of state|employment and training|immigration|nonimmigrant|visa/', $hay)) continue;
        $title = immnewsClean((string) ($r['title'] ?? ''), 300); if ($title === '') continue;
        $link = (string) ($r['html_url'] ?? ''); if (!preg_match('#^https://www\.federalregister\.gov/#', $link)) continue;
        $summary = immnewsClean((string) ($r['abstract'] ?? ''), 420);
        $items[] = [
            'id' => 'fr-' . preg_replace('/[^A-Za-z0-9-]/', '', (string) ($r['document_number'] ?? substr(hash('sha256', $link), 0, 12))),
            'source' => $agencyText !== '' ? $agencyText : 'Federal Register', 'type' => immnewsClean((string) ($r['type'] ?? 'Federal Register'), 80),
            'title' => $title, 'date' => preg_match('/^20\d{2}-\d{2}-\d{2}$/', (string) ($r['publication_date'] ?? '')) ? (string) $r['publication_date'] : '',
            'summary' => $summary, 'url' => $link, 'tags' => immnewsTags($title . ' ' . $summary), 'official' => true,
        ];
        if (count($items) >= 12) break;
    }
    return [$items, ['id' => 'fr', 'name' => 'Federal Register', 'url' => 'https://www.federalregister.gov/agencies/citizenship-and-immigration-services', 'ok' => (bool) $items, 'note' => $items ? count($items) . ' recent immigration-related notices read.' : 'No matching recent notices were returned.']];
}
function immnewsSort(array &$items): void
{
    usort($items, function ($a, $b) {
        $ad = (string) ($a['date'] ?? ''); $bd = (string) ($b['date'] ?? '');
        if ($ad !== $bd) return strcmp($bd, $ad);
        return strcmp((string) ($a['title'] ?? ''), (string) ($b['title'] ?? ''));
    });
}
function immnewsReadCache(): ?array
{
    $f = immnewsCacheFile();
    if (!is_file($f)) return null;
    $j = json_decode((string) @file_get_contents($f), true);
    return is_array($j) ? $j : null;
}
function immnewsWriteCache(array $d): void
{
    $f = immnewsCacheFile();
    @file_put_contents($f, json_encode($d, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), LOCK_EX);
    @chmod($f, 0600);
}
/** Current official data. $force bypasses TTL but an old successful cache is kept when all live sources fail. */
function immnewsData(bool $force = false): array
{
    $cached = immnewsReadCache();
    $age = $cached ? time() - (int) ($cached['fetchedAt'] ?? 0) : PHP_INT_MAX;
    if (!$force && $cached && $age >= 0 && $age < IMMNEWS_TTL) {
        $cached['cacheAge'] = $age; $cached['cached'] = true; return $cached;
    }
    [$u, $us] = immnewsUscis();
    [$v, $vs] = immnewsVisa();
    [$f, $fs] = immnewsFederal();
    $items = array_values(array_merge($u, $v, $f));
    // De-duplicate on canonical URL and keep the richer first item.
    $seen = []; $uniq = [];
    foreach ($items as $it) {
        $key = strtolower((string) ($it['url'] ?? '') ?: (string) ($it['title'] ?? ''));
        if ($key === '' || isset($seen[$key])) continue;
        $seen[$key] = true; $uniq[] = $it;
    }
    immnewsSort($uniq);
    $sources = [$us, $vs, $fs];
    $okCount = count(array_filter($sources, fn($s) => !empty($s['ok'])));
    if (!$uniq && $cached && !empty($cached['items'])) {
        $cached['stale'] = true; $cached['cached'] = true; $cached['cacheAge'] = $age;
        $cached['liveError'] = 'Official sources could not be refreshed; showing the last successful snapshot.';
        $cached['sources'] = $sources;
        return $cached;
    }
    $d = [
        'fetchedAt' => time(), 'asOf' => gmdate('c'), 'stale' => $okCount === 0, 'cached' => false, 'cacheAge' => 0,
        'items' => array_slice($uniq, 0, 36), 'sources' => $sources,
    ];
    if ($uniq) immnewsWriteCache($d);
    return $d;
}
function immnewsRelevant(string $q): bool
{
    return (bool) preg_match('/\b(uscis|immigra\w*|visa|h[- ]?1b|h[- ]?4|f[- ]?1|opt|stem opt|ead|i[- ]?765|i[- ]?129|i[- ]?140|i[- ]?485|green card|permanent residen|priority date|visa bulletin|adjustment of status|consular|naturaliz|citizenship|tps|asylum|refugee|i[- ]?9|e-verify|work authorization|premium processing|rfe|noid|nonimmigrant|petition|status extension|change of status)\b/i', $q);
}
/** Plain-text official-source context for StratEdge AI. */
function immnewsContext(string $q, int $max = 9): array
{
    if (!immnewsRelevant($q)) return ['', null];
    try { $d = immnewsData(false); } catch (Throwable $e) { return ['', null]; }
    $items = (array) ($d['items'] ?? []); if (!$items) return ['', $d];
    $terms = array_values(array_unique(array_filter(preg_split('/[^a-z0-9]+/i', strtolower($q)) ?: [], fn($x) => strlen($x) >= 3)));
    foreach ($items as &$it) {
        $hay = strtolower(((string) ($it['title'] ?? '')) . ' ' . ((string) ($it['summary'] ?? '')) . ' ' . implode(' ', (array) ($it['tags'] ?? [])));
        $score = 0;
        foreach ($terms as $t) if (str_contains($hay, $t)) $score += strlen($t) > 5 ? 3 : 1;
        if (preg_match('/priority date|visa bulletin|green card|i[- ]?485/i', $q) && ($it['type'] ?? '') === 'Visa Bulletin') $score += 12;
        if (stripos((string) ($it['source'] ?? ''), 'USCIS') !== false) $score += 1;
        $it['_score'] = $score;
    }
    unset($it);
    usort($items, fn($a, $b) => [-(int) ($a['_score'] ?? 0), (string) ($b['date'] ?? '')] <=> [-(int) ($b['_score'] ?? 0), (string) ($a['date'] ?? '')]);
    $pick = array_slice($items, 0, max(3, min(12, $max)));
    $lines = [];
    $lines[] = 'Checked official immigration sources at ' . (string) ($d['asOf'] ?? gmdate('c')) . (!empty($d['stale']) ? ' (last cached snapshot; live refresh was unavailable)' : '') . '.';
    foreach ($pick as $it) {
        $lines[] = '- [' . ((string) ($it['source'] ?? 'Official source')) . '] ' . ((string) ($it['date'] ?? 'date not shown')) . ' | ' . ((string) ($it['title'] ?? '')) . (($it['summary'] ?? '') !== '' ? ' | ' . mb_substr((string) $it['summary'], 0, 360) : '') . ' | ' . ((string) ($it['url'] ?? ''));
    }
    return [mb_substr(implode("\n", $lines), 0, 8500), $d];
}
function immnewsRoute(string $r, array $b): never
{
    $u = requireUser();
    if ($r !== 'immnews_feed') fail(404, 'not_found', 'Not found.');
    $force = !empty($b['refresh']);
    if ($force && throttleHit('immnews-refresh:' . $u['id'], 12, 3600)) $force = false;
    @set_time_limit(65);
    $d = immnewsData($force);
    ok($d);
}
