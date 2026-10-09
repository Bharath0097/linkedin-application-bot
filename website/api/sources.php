<?php
declare(strict_types=1);
/*
 * Sourcing connections (v33): Dice, iLabor360 and the job boards.
 *   - The API keys for Dice and iLabor360 are kept here, sealed (sec/x/src), ready for the live connections; the
 *     calls themselves follow when each company's API documents arrive.
 *   - What works today without their APIs: the job feed below (Indeed-style XML that job boards and Dice's Job Bot
 *     read; every job's link is tagged with the board so applicants arrive in the ATS under its name), Dice applications
 *     and forwarded profiles emailed to the company inbox (the screening agent turns them into candidates), and
 *     iLabor360 requisition emails (the requirements desk files them under iLabor360 with the requisition number).
 */
const SRC_BOARDS = ['indeed' => 'Indeed', 'dice' => 'Dice', 'ziprecruiter' => 'ZipRecruiter', 'jooble' => 'Jooble', 'linkedin' => 'LinkedIn', 'glassdoor' => 'Glassdoor', 'talent' => 'Talent.com', 'adzuna' => 'Adzuna'];

function srcSecrets(): array
{
    $d = docGet('sec/x/src');
    return $d ? (json_decode(json_encode($d), true) ?: []) : [];
}
function srcMask(string $s): string
{
    $s = trim($s);
    if ($s === '') {
        return '';
    }
    return mb_strlen($s) <= 6 ? str_repeat('•', mb_strlen($s)) : mb_substr($s, 0, 3) . str_repeat('•', 6) . mb_substr($s, -2);
}
/** v37.2: the job boards a posting is set to go to: none when it was taken off every board, every board when none
 *  was picked, else the ones picked (whether it is open or internal does not matter here). */
function jobBoardsCfg(stdClass $j): array
{
    if (!empty($j->offBoards)) {
        return [];
    }
    $only = array_values(array_intersect(array_keys(SRC_BOARDS), array_map('strval', (array) ($j->boards ?? []))));
    return $only ?: array_keys(SRC_BOARDS);
}
/** v37.2: the boards whose feeds carry a posting now: none while it is closed or internal only (an internal job is
 *  shared by its link, never sent to job boards); the Dice automation follows the same rule. */
function jobBoardsOf(stdClass $j): array
{
    if (($j->open ?? true) === false || trim((string) ($j->ti ?? '')) === '' || !empty($j->internal)) {
        return [];
    }
    return jobBoardsCfg($j);
}
function jobOnBoard(stdClass $j, string $board): bool
{
    return in_array($board, jobBoardsOf($j), true);
}
/** The open careers jobs as feed rows (those on at least one job board). */
function srcFeedJobs(): array
{
    $out = [];
    foreach (colAll('org/site/jobs') as [$id, $j]) {
        if (!jobBoardsOf($j)) {
            continue;
        }
        $out[(string) $id] = $j;
    }
    uasort($out, fn($a, $b) => (int) ($b->u ?? $b->at ?? 0) <=> (int) ($a->u ?? $a->at ?? 0));
    return $out;
}
/** Public: the open jobs as an Indeed-style XML feed (or JSON), links tagged with the board. */
function srcFeed(): never
{
    $board = strtolower(preg_replace('/[^a-z]/', '', (string) ($_GET['board'] ?? '')) ?? '');
    $board = isset(SRC_BOARDS[$board]) ? $board : 'feed';
    $fmt = (string) ($_GET['fmt'] ?? '') === 'json' ? 'json' : 'xml';
    $base = siteUrl();
    // v83: on a company workspace the feed lists that company's jobs, so it names the company, not StratEdge
    $co = wsBrandText('StratEdge IT Consulting');
    $rows = [];
    foreach (srcFeedJobs() as $id => $j) {
        // a job can be limited to some boards (the requisition's Job boards, or the job boards desk); none ticked means
        // every board; the general feed carries every job that is on at least one board
        if ($board !== 'feed' && !jobOnBoard($j, $board)) {
            continue;
        }
        $loc = trim((string) ($j->loc ?? ''));
        $city = $loc;
        $state = '';
        if (preg_match('/^(.*?),\s*([A-Z]{2})\b/', $loc, $m)) {
            $city = trim($m[1]);
            $state = $m[2];
        }
        $md = strtolower((string) ($j->md ?? ''));
        $ty = strtolower((string) ($j->ty ?? ''));
        $type = str_contains($ty, 'full') || str_contains($ty, 'perm') ? 'fulltime' : (str_contains($ty, 'part') ? 'parttime' : (str_contains($ty, 'intern') ? 'internship' : 'contract'));
        $desc = trim((string) ($j->d ?? ''));
        $extra = array_filter([
            trim((string) ($j->sk ?? '')) !== '' ? 'Skills: ' . trim((string) $j->sk) : '',
            trim((string) ($j->ty ?? '')) !== '' ? 'Engagement: ' . trim((string) $j->ty) : '',
            trim((string) ($j->visa ?? '')) !== '' ? 'Work authorization: ' . trim((string) $j->visa) : '',
            trim((string) ($j->dur ?? '')) !== '' ? 'Duration: ' . trim((string) $j->dur) : '',
        ]);
        $rows[] = [
            'id' => $id,
            'title' => (string) $j->ti,
            'date' => (int) (($j->u ?? $j->at ?? now()) / 1000),
            'url' => $base . 'job.php?id=' . rawurlencode($id) . '&src=' . $board,
            'city' => $city,
            'state' => $state,
            'country' => 'US',
            'description' => $desc . ($extra ? "\n\n" . implode("\n", $extra) : ''),
            'jobtype' => $type,
            'remote' => str_contains($md, 'remote') ? 'Fully remote' : (str_contains($md, 'hybrid') ? 'Hybrid remote' : ''),
            'salary' => trim((string) ($j->rate ?? '')),
            'category' => trim(explode(',', (string) ($j->sk ?? ''))[0] ?? ''),
            'experience' => trim((string) ($j->exp ?? '')),
        ];
    }
    header('Cache-Control: public, max-age=900');
    if ($fmt === 'json') {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['publisher' => $co, 'url' => $base, 'updated' => gmdate('c'), 'jobs' => array_map(fn($r) => array_merge($r, ['date' => gmdate('c', $r['date'])]), $rows)], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        exit();
    }
    header('Content-Type: application/xml; charset=utf-8');
    $c = fn(string $s) => '<![CDATA[' . str_replace(']]>', ']]]]><![CDATA[>', $s) . ']]>';
    $x = '<?xml version="1.0" encoding="utf-8"?>' . "\n<source>\n<publisher>" . htmlspecialchars($co, ENT_XML1) . "</publisher>\n<publisherurl>" . htmlspecialchars($base, ENT_XML1) . "</publisherurl>\n<lastBuildDate>" . gmdate('D, d M Y H:i:s') . " GMT</lastBuildDate>\n";
    foreach ($rows as $r) {
        $x .= "<job>\n<title>" . $c($r['title']) . "</title>\n<date>" . $c(gmdate('D, d M Y H:i:s', $r['date']) . ' GMT') . "</date>\n<referencenumber>" . $c($r['id']) . "</referencenumber>\n<requisitionid>" . $c($r['id']) . "</requisitionid>\n<url>" . $c($r['url']) . "</url>\n<company>" . $c($co) . "</company>\n<sourcename>" . $c($co) . "</sourcename>\n<city>" . $c($r['city']) . "</city>\n<state>" . $c($r['state']) . "</state>\n<country>" . $c($r['country']) . "</country>\n<description>" . $c(nl2br(htmlspecialchars($r['description']))) . "</description>\n<jobtype>" . $c($r['jobtype']) . "</jobtype>\n" .
            ($r['remote'] !== '' ? '<remotetype>' . $c($r['remote']) . "</remotetype>\n" : '') .
            ($r['salary'] !== '' ? '<salary>' . $c($r['salary']) . "</salary>\n" : '') .
            ($r['category'] !== '' ? '<category>' . $c($r['category']) . "</category>\n" : '') .
            ($r['experience'] !== '' ? '<experience>' . $c($r['experience']) . "</experience>\n" : '') .
            "</job>\n";
    }
    echo $x . "</source>\n";
    exit();
}
function srcRoute(string $r, array $b): never
{
    $u = requireAdmin();
    if (!hasRole($u, 'admin')) {
        fail(403, 'forbidden', 'Sourcing connections are for administrators.');
    }
    switch ($r) {
        case 'src_get': {
            $s = srcSecrets();
            $base = siteUrl() . 'api/index.php?r=jobs_feed';
            $since = now() - 30 * 86400000;
            $dice = 0;
            foreach (colAll('ats') as [$id, $c]) {
                if ((string) $id !== 'x' && (string) ($c->src ?? '') === 'Dice' && (int) ($c->at ?? 0) >= $since) {
                    $dice++;
                }
            }
            $il = 0;
            foreach (colAll('vms/req/items') as [$id, $q]) {
                if ((string) ($q->vms ?? '') === 'iLabor360') {
                    $il++;
                }
            }
            require_once __DIR__ . '/mail.php';
            $ms = mailSettings();
            ok([
                'dice' => ['cid' => srcMask((string) ($s['dice']['cid'] ?? '')), 'set' => !empty($s['dice']['secret']), 'at' => (int) ($s['dice']['at'] ?? 0), 'by' => (string) ($s['dice']['by'] ?? ''), 'recent' => $dice],
                'ilabor' => ['user' => srcMask((string) ($s['ilabor']['user'] ?? '')), 'set' => !empty($s['ilabor']['pass']) || !empty($s['ilabor']['key']), 'sysid' => (string) ($s['ilabor']['sysid'] ?? ''), 'at' => (int) ($s['ilabor']['at'] ?? 0), 'by' => (string) ($s['ilabor']['by'] ?? ''), 'reqs' => $il],
                'feed' => ['xml' => $base, 'json' => $base . '&fmt=json', 'boards' => array_map(fn($k, $n) => ['k' => $k, 'n' => $n, 'url' => $base . '&board=' . $k], array_keys(SRC_BOARDS), SRC_BOARDS), 'jobs' => count(srcFeedJobs())],
                'inbox' => ['from' => (string) ($ms['from'] ?? ''), 'mailgun' => ($ms['provider'] ?? '') === 'mailgun', 'webhook' => siteUrl() . 'api/index.php?r=mail_inbound'],
            ]);
        }
        case 'src_run': {
            @set_time_limit(300);
            $base = siteUrl() . 'api/index.php?r=jobs_feed';
            $diceJobs = 0;
            foreach (srcFeedJobs() as $j) {
                if (jobOnBoard($j, 'dice')) {
                    $diceJobs++;
                }
            }
            $since = now() - 30 * 86400000;
            $diceCandidates = 0;
            foreach (colAll('ats') as [$id, $c]) {
                if ((string) $id !== 'x' && (string) ($c->src ?? '') === 'Dice' && (int) ($c->at ?? 0) >= $since) {
                    $diceCandidates++;
                }
            }
            $ilReqs = 0;
            foreach (colAll('vms/req/items') as [$id, $q]) {
                if ((string) ($q->vms ?? '') === 'iLabor360') {
                    $ilReqs++;
                }
            }
            require_once __DIR__ . '/connectors.php';
            $da = cxApi('dice');
            $ia = cxApi('ilabor');
            $out = [
                'at' => now(),
                'dice' => [
                    'feedJobs' => $diceJobs,
                    'feedUrl' => $base . '&board=dice',
                    'recentCandidates' => $diceCandidates,
                    'search' => null,
                    'directPosting' => !empty($da['auto']['jobs']) && !empty($da['ops']['post']['on']),
                    'apiReady' => $da['base'] !== '' && cxProviderUrlProblem('dice', $da['base']) === '' && (!empty($da['ops']['search']['on']) || !empty($da['ops']['post']['on'])),
                ],
                'ilabor' => [
                    'existing' => $ilReqs,
                    'pull' => null,
                    'apiReady' => $ia['base'] !== '' && cxProviderUrlProblem('ilabor', $ia['base']) === '' && !empty($ia['ops']['reqs']['on']),
                ],
            ];
            // A manual run forces one Dice search pass even when a recurring interval is not set. Posting through
            // a private Dice API still obeys the explicit "Keep Dice in step" switch; otherwise jobs are only
            // published to the supported Job Bot feed and are not falsely marked as posted.
            if ($out['dice']['apiReady'] && !empty($da['ops']['search']['on'])) {
                require_once __DIR__ . '/cxauto.php';
                $out['dice']['search'] = cxAutoRun('by ' . $u['name'], 75, true);
            }
            if ($out['ilabor']['apiReady']) {
                $out['ilabor']['pull'] = cxPull('by ' . $u['name']);
            }
            audit('data', 'Recruiting integrations run', 'sources', [
                'diceFeedJobs' => $diceJobs,
                'diceApi' => $out['dice']['apiReady'],
                'ilaborApi' => $out['ilabor']['apiReady'],
            ], $u);
            ok($out);
        }
        case 'src_dice_feed_mode': {
            // v51: A copied Dice employer/login URL is a human web page, not a posting API.
            // Switch the connector back to the supported Job Bot/feed path without deleting saved Dice credentials.
            $s = srcSecrets();
            $api = (array) ($s['dice']['api'] ?? []);
            $api['base'] = '';
            $api['tokenUrl'] = '';
            $api['ops'] = [];
            $auto = (array) ($api['auto'] ?? []);
            $auto['jobs'] = false;
            $auto['search'] = 0;
            $api['auto'] = $auto;
            $s['dice']['api'] = $api;
            docSet('sec/x/src', (object) json_decode(json_encode($s ?: new stdClass())));
            secKvSet('cxtok_dice', []);
            audit('settings', 'Dice switched to Job Bot feed mode', 'dice', ['feed' => siteUrl() . 'api/index.php?r=jobs_feed&board=dice'], $u);
            require_once __DIR__ . '/connectors.php';
            ok([
                'mode' => 'feed',
                'feedUrl' => siteUrl() . 'api/index.php?r=jobs_feed&board=dice',
                'api' => cxApi('dice'),
            ]);
        }
        case 'src_save': {
            require_once __DIR__ . '/mail.php';
            $s = srcSecrets();
            $who = (string) $u['name'];
            $in = (array) ($b['dice'] ?? []);
            if ($in) {
                if (!empty($in['clear'])) {
                    unset($s['dice']);
                } else {
                    $cid = mb_substr(trim((string) ($in['cid'] ?? '')), 0, 120);
                    $sec = mb_substr(trim((string) ($in['secret'] ?? '')), 0, 200);
                    if ($cid !== '') {
                        $s['dice']['cid'] = $cid;
                    }
                    if ($sec !== '') {
                        $s['dice']['secret'] = mailSeal($sec);
                    }
                    $s['dice']['at'] = now();
                    $s['dice']['by'] = $who;
                }
            }
            $in = (array) ($b['ilabor'] ?? []);
            if ($in) {
                if (!empty($in['clear'])) {
                    unset($s['ilabor']);
                } else {
                    foreach (['user' => 190, 'sysid' => 40] as $k => $max) {
                        $v = mb_substr(trim((string) ($in[$k] ?? '')), 0, $max);
                        if ($v !== '') {
                            $s['ilabor'][$k] = $v;
                        }
                    }
                    foreach (['pass', 'key'] as $k) {
                        $v = mb_substr(trim((string) ($in[$k] ?? '')), 0, 200);
                        if ($v !== '') {
                            $s['ilabor'][$k] = mailSeal($v);
                        }
                    }
                    $s['ilabor']['at'] = now();
                    $s['ilabor']['by'] = $who;
                }
            }
            docSet('sec/x/src', (object) json_decode(json_encode($s ?: new stdClass())));
            ok(['ok' => true]);
        }
    }
    fail(404, 'not_found', 'Unknown action.');
}
