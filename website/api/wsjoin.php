<?php
declare(strict_types=1);
/*
 * v37.4 Workspace sign-up requests, routes ws_signup* (StratEdge's own site only; a workspace's address answers 404):
 *   The public page #/get-portal: a company asks for its own portal (bot check, firewall screening, limits per network,
 *   per address and for the whole site), then confirms its email address with a link (48 hours, once). Confirmed
 *   requests wait under Admin > System > Workspaces > Sign-up requests: approve (the workspace is made exactly as
 *   "New workspace" makes it, and its setup link goes to the person who asked) or decline (an optional reason, by email).
 *   Automatic approval is an option, off by default, with a daily limit; past it, or when making the workspace fails,
 *   requests wait for review.
 *   The page answers the same whatever the address: whether it has an account, a request or a portal is never said
 *   there; what differs goes only to that inbox.
 *   Records ws/signup/<id> (administrators only); settings secKv ws_signup_cfg; links in auth_tokens (kind wsjoin).
 */
require_once __DIR__ . '/wsadmin.php';

const WSJ_MODES = ['off', 'review', 'auto'];
const WSJ_SIZES = ['1-10' => '1 to 10 people', '11-50' => '11 to 50 people', '51-200' => '51 to 200 people', '201-1000' => '201 to 1,000 people', '1000+' => 'More than 1,000 people'];
const WSJ_COUNTRIES = ['US' => 'United States', 'IN' => 'India', 'CA' => 'Canada', 'GB' => 'United Kingdom', 'other' => 'Another country'];
// personal mailboxes: "work email only" refuses these (a company's portal belongs to the company's own domain)
const WSJ_FREE_MAIL = [
    'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.co.uk', 'yahoo.in', 'ymail.com', 'rocketmail.com', 'outlook.com', 'outlook.in', 'hotmail.com',
    'hotmail.co.uk', 'live.com', 'live.in', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net',
    'mail.com', 'yandex.com', 'yandex.ru', 'zoho.com', 'zohomail.com', 'zohomail.in', 'rediffmail.com', 'qq.com', '163.com', '126.com', 'tutanota.com', 'tuta.io',
    'hey.com', 'fastmail.com', 'inbox.com', 'mail.ru',
];
const WSJ_LINK_MS = 48 * 3600000;
const WSJ_ROLE_NAMES = ['admin' => 'administrator', 'hr' => 'HR', 'manager' => 'manager', 'user' => 'a member account', 'employee' => 'employee', 'consultant' => 'consultant', 'client' => 'client contact', 'student' => 'student', 'acct' => 'accountant', 'bench' => 'employee', 'books' => 'bookkeeper'];

/** The sign-up page's settings (Workspaces > Sign-up requests). Off until an administrator opens it. */
function wsjCfg(): array
{
    $c = secKv('ws_signup_cfg', []);
    $c = is_array($c) ? $c : [];
    return [
        'mode' => in_array($c['mode'] ?? '', WSJ_MODES, true) ? (string) $c['mode'] : 'off',
        'pilotDays' => max(1, min(365, (int) ($c['pilotDays'] ?? 30))),
        // the parts an automatically made portal may have (what they asked for, within these)
        'preset' => isset(WS_PRESETS[(string) ($c['preset'] ?? '')]) ? (string) $c['preset'] : 'staffing',
        'workOnly' => array_key_exists('workOnly', $c) ? !empty($c['workOnly']) : true,
        'autoMax' => max(1, min(50, (int) ($c['autoMax'] ?? 5))),
        'notify' => array_key_exists('notify', $c) ? !empty($c['notify']) : true,
    ];
}
/** A company's name without punctuation and legal endings ("Acme Staffing, LLC" = "acme staffing inc"). */
function wsjNorm(string $co): string
{
    $s = (string) preg_replace('/[^\p{L}\p{N}]+/u', ' ', mb_strtolower($co));
    $stop = ['inc', 'llc', 'ltd', 'llp', 'plc', 'pllc', 'lp', 'corp', 'corporation', 'co', 'company', 'pvt', 'private', 'limited', 'gmbh', 'the'];
    return implode('', array_filter(explode(' ', $s), fn($w) => $w !== '' && !in_array($w, $stop, true)));
}
/** A short name from a company's name ("Acme Staffing & Co." -> acme-staffing-and-co). */
function wsjSlugOf(string $n): string
{
    $s = mb_strtolower($n);
    if (function_exists('iconv')) {
        $t = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $s);
        if (is_string($t) && $t !== '') {
            $s = strtolower($t);
        }
    }
    $s = trim((string) preg_replace('/[^a-z0-9]+/', '-', str_replace('&', ' and ', $s)), '-');
    return rtrim(substr($s, 0, 30), '-');
}
/** A short name nobody has: the one asked for, else one made from the company's name, numbered when taken. */
function wsjFreeSlug(string $want, string $co): string
{
    $reg = wsRegistry(true);
    $ok = fn(string $x): bool => strlen($x) >= 2 && (bool) preg_match(WS_SLUG_RE, $x);
    $free = fn(string $x): bool => !isset($reg[$x]) && !is_dir(wsDirOf($x)) && !in_array($x, WS_RESERVED, true);
    $made = wsjSlugOf($co);
    foreach ([$want, $made] as $x) {
        if ($ok($x) && $free($x)) {
            return $x;
        }
    }
    $base = $ok($want) ? $want : ($ok($made) ? $made : 'company');
    for ($i = 2; $i < 100; $i++) {
        $x = rtrim(substr($base, 0, 29 - strlen((string) $i)), '-') . '-' . $i;
        if ($ok($x) && $free($x)) {
            return $x;
        }
    }
    return 'co-' . substr(rid(4), 0, 7);
}
/** The provider's address for replies to these emails. */
function wsjReplyTo(): string
{
    $a = trim(explode(',', (string) (cfg('apply_emails') ?: ''))[0]);
    return filter_var($a, FILTER_VALIDATE_EMAIL) ? $a : (string) (cfg('mail_from') ?: '');
}
function wsjFirst(string $n): string
{
    $f = trim(explode(' ', trim($n))[0]);
    return $f !== '' ? $f : 'there';
}
function wsjMail(string $to, string $name, string $subject, array $paras, ?array $btn = null): bool
{
    try {
        $text = implode("\n\n", $paras) . ($btn ? "\n\n" . $btn[0] . ': ' . $btn[1] : '');
        return sendMail($to, $name, $subject, $text, emailHtml($subject, $paras, $btn), [], wsjReplyTo());
    } catch (Throwable $e) {
        return false;
    }
}
function wsjLog(stdClass $s, string $who, string $ev): void
{
    $log = array_values((array) ($s->log ?? []));
    $log[] = (object) ['t' => now(), 'who' => mb_substr($who, 0, 120), 'ev' => mb_substr($ev, 0, 400)];
    $s->log = array_slice($log, -50);
}
/** Links not used yet stop working (a newer one was sent, or the request was decided or deleted). */
function wsjDropTokens(string $id): void
{
    try {
        secdb()->prepare("DELETE FROM auth_tokens WHERE uid = ? AND kind = 'wsjoin' AND used = 0")->execute([$id]);
    } catch (Throwable $e) {
        // nothing to drop
    }
}
/** The link that confirms the address (a new one each time; earlier ones stop working). */
function wsjSendLink(string $id, stdClass $s): bool
{
    wsjDropTokens($id);
    $t = tokNew('wsjoin', $id, WSJ_LINK_MS, []);
    $auto = wsjCfg()['mode'] === 'auto';
    return wsjMail((string) $s->e, (string) $s->n, 'Confirm your email to get your portal', [
        'Hello ' . wsjFirst((string) $s->n) . ',',
        'Thank you for asking for a portal for ' . $s->co . '. Confirm that this is your email address with the button below' . ($auto ? '; your portal is made as soon as you do.' : ', and our team will look at your request.'),
        'The link works for 48 hours. If you did not ask for this, ignore this email: nothing happens without the confirmation.',
    ], ['Confirm my email', siteUrl() . '#/get-portal?v=' . $t]);
}
/** StratEdge's active administrators (they review the requests). */
function wsjAdmins(int $max = 5): array
{
    $out = [];
    foreach (db()->query("SELECT id, email, name, role, status, access FROM users WHERE status = 'active' ORDER BY created")->fetchAll() as $r) {
        if (hasRole($r, 'admin')) {
            $out[] = $r;
        }
    }
    return array_slice($out, 0, $max);
}
function wsjReviewLink(string $id): string
{
    return siteUrl() . '#/portal/admin/workspaces?tab=requests&req=' . rawurlencode($id);
}
/** A task for each administrator and, unless switched off, an email. */
function wsjTell(string $id, string $title, array $paras): int
{
    $cfg = wsjCfg();
    $tid = rid(6);
    $n = 0;
    foreach (wsjAdmins() as $a) {
        $uid = (string) $a['id'];
        $r = docGet('r/' . $uid) ?? new stdClass();
        if (!isset($r->tasks) || !($r->tasks instanceof stdClass)) {
            $r->tasks = new stdClass();
        }
        $r->tasks->$tid = (object) ['ti' => mb_substr($title, 0, 160), 'd' => mb_substr(implode(' ', array_slice($paras, 0, 2)) . ' Admin › System › Workspaces › Sign-up requests.', 0, 1000), 'due' => date('Y-m-d', time() + 86400), 'p' => 'normal', 'at' => now(), 'by' => 'Workspaces'];
        docSet('r/' . $uid, $r);
        if ($cfg['notify']) {
            try {
                $link = wsjReviewLink($id);
                sendMail((string) $a['email'], (string) $a['name'], $title, implode("\n\n", $paras) . "\n\nReview it: " . $link, emailHtml($title, $paras, ['Review the request', $link]));
            } catch (Throwable $e) {
                // the task is there either way
            }
        }
        $n++;
    }
    return $n;
}
/** What a request says, in a line, for the administrators' email. */
function wsjSummary(stdClass $s): array
{
    $feats = array_map(fn($k) => WS_FEATURES[$k]['n'] ?? $k, (array) ($s->feats ?? []));
    $out = [
        $s->n . ' (' . $s->e . ($s->role ? ', ' . $s->role : '') . ') asked for a portal for ' . $s->co . ' (' . (WSJ_SIZES[$s->size] ?? $s->size) . ', ' . (WSJ_COUNTRIES[$s->country] ?? $s->country) . ($s->web ? ', ' . $s->web : '') . ').',
        'They want: ' . ($feats ? implode(', ', $feats) : 'not said') . '.',
    ];
    if ((string) ($s->msg ?? '') !== '') {
        $out[] = 'Their message: ' . mb_substr((string) $s->msg, 0, 600);
    }
    return $out;
}
/** Automatic portals made in the last 24 hours. */
function wsjAutoToday(): int
{
    $n = 0;
    foreach (colAll('ws/signup') as [, $s]) {
        if ((string) ($s->dec->by ?? '') === 'auto' && (int) ($s->dec->at ?? 0) > now() - 86400000) {
            $n++;
        }
    }
    return $n;
}
/** The parts an automatic portal gets: what they asked for, within what the settings allow. */
function wsjAutoFeats(stdClass $s, array $cfg): array
{
    $allow = WS_PRESETS[$cfg['preset']]['f'];
    $want = array_values(array_intersect($allow, (array) ($s->feats ?? [])));
    return $want ?: $allow;
}
/** The setup email's opening line for someone who asked on the website. */
function wsjIntro(stdClass $s): string
{
    return 'Thank you for asking for a portal for ' . $s->co . '. It is ready, and you are its first administrator.';
}
/** What the console shows about a request. */
function wsjOut(string $id, stdClass $s, array $hints = []): array
{
    $st = (string) ($s->st ?? 'unverified');
    return [
        'id' => $id,
        'co' => (string) ($s->co ?? ''), 'n' => (string) ($s->n ?? ''), 'e' => (string) ($s->e ?? ''), 'ph' => (string) ($s->ph ?? ''), 'role' => (string) ($s->role ?? ''),
        'web' => (string) ($s->web ?? ''), 'size' => (string) ($s->size ?? ''), 'country' => (string) ($s->country ?? ''), 'feats' => array_values((array) ($s->feats ?? [])),
        'slug' => (string) ($s->slug ?? ''), 'msg' => (string) ($s->msg ?? ''), 'st' => $st, 'at' => (int) ($s->at ?? 0), 'vAt' => (int) ($s->vAt ?? 0),
        'ip' => (string) ($s->ip ?? ''), 'sent' => (int) ($s->sent ?? 0), 'mailFail' => !empty($s->mailFail),
        'dec' => isset($s->dec) ? (array) $s->dec : null,
        'log' => array_values(array_map(fn($l) => (array) $l, (array) ($s->log ?? []))),
        'free' => $st === 'new' ? wsjFreeSlug((string) ($s->slug ?? ''), (string) ($s->co ?? '')) : '',
        'hints' => $hints,
    ];
}
/** Notes for the reviewer: a login here already, a workspace they run, other requests from them or their company. */
function wsjHints(array $rows): array
{
    $emails = [];
    foreach ($rows as [, $s]) {
        $emails[strtolower((string) ($s->e ?? ''))] = true;
    }
    unset($emails['']);
    $users = [];
    if ($emails) {
        $q = db()->prepare('SELECT email, role, status FROM users WHERE email IN (' . implode(',', array_fill(0, count($emails), '?')) . ')');
        $q->execute(array_keys($emails));
        foreach ($q->fetchAll() as $u) {
            $users[strtolower((string) $u['email'])] = $u;
        }
    }
    $runs = [];
    foreach (wsRegistry(true) as $slug => $e) {
        if (($e['status'] ?? '') === 'deleted') {
            continue;
        }
        foreach (array_unique([strtolower((string) ($e['admin']['email'] ?? '')), strtolower((string) ($e['contact'] ?? ''))]) as $em) {
            if ($em !== '') {
                $runs[$em][] = ['n' => (string) ($e['name'] ?? $slug) . ' (' . $slug . ')', 'from' => (string) ($e['signup'] ?? '')];
            }
        }
    }
    $byMail = [];
    $byDom = [];
    foreach ($rows as [$id, $s]) {
        $em = strtolower((string) ($s->e ?? ''));
        $byMail[$em][] = (string) $id;
        $byDom[substr($em, (int) strrpos($em, '@') + 1)][] = (string) $id;
    }
    $out = [];
    foreach ($rows as [$id, $s]) {
        $em = strtolower((string) ($s->e ?? ''));
        $dom = substr($em, (int) strrpos($em, '@') + 1);
        $h = [];
        if (isset($users[$em])) {
            $u = $users[$em];
            $h[] = 'Has a login on StratEdge\'s own portal (' . (WSJ_ROLE_NAMES[$u['role']] ?? $u['role']) . ((string) $u['status'] !== 'active' ? ', ' . $u['status'] : '') . ').';
        }
        foreach ($runs[$em] ?? [] as $w) {
            // the workspace made from this very request is not news
            if ($w['from'] !== (string) $id) {
                $h[] = 'Administrator or contact of the workspace ' . $w['n'] . '.';
            }
        }
        $h = array_values(array_unique($h));
        $same = count($byMail[$em] ?? []) - 1;
        if ($same > 0) {
            $h[] = $same . ' other request' . ($same === 1 ? '' : 's') . ' from this address.';
        }
        if (in_array($dom, WSJ_FREE_MAIL, true)) {
            $h[] = 'A personal email address (' . $dom . '), not the company\'s own.';
        } else {
            $others = count($byDom[$dom] ?? []) - count($byMail[$em] ?? []);
            if ($others > 0) {
                $h[] = $others . ' request' . ($others === 1 ? '' : 's') . ' from other people at ' . $dom . '.';
            }
        }
        $out[(string) $id] = $h;
    }
    return $out;
}
/** Checks the form; field => problem. */
function wsjCheck(array $b, array $cfg, array &$v): array
{
    $err = [];
    $v['co'] = trim((string) preg_replace('/\s+/u', ' ', mb_substr((string) ($b['co'] ?? ''), 0, 80)));
    if (mb_strlen($v['co']) < 2) {
        $err['co'] = 'Give your company\'s name.';
    }
    $v['n'] = trim((string) preg_replace('/\s+/u', ' ', mb_substr((string) ($b['n'] ?? ''), 0, 120)));
    if (mb_strlen($v['n']) < 2) {
        $err['n'] = 'Add your full name.';
    }
    $v['e'] = mb_strtolower(trim(mb_substr((string) ($b['e'] ?? ''), 0, 190)));
    $dom = str_contains($v['e'], '@') ? substr($v['e'], (int) strrpos($v['e'], '@') + 1) : '';
    if (!filter_var($v['e'], FILTER_VALIDATE_EMAIL)) {
        $err['e'] = 'Enter a valid email address.';
    } elseif ($cfg['workOnly'] && in_array($dom, WSJ_FREE_MAIL, true)) {
        $err['e'] = 'Use your work email address (not a personal one such as Gmail or Outlook).';
    }
    $v['ph'] = trim(mb_substr((string) ($b['ph'] ?? ''), 0, 30));
    $digits = strlen((string) preg_replace('/\D/', '', $v['ph']));
    if ($v['ph'] !== '' && ($digits < 7 || $digits > 15 || !preg_match('/^[0-9 +().\-]+$/', $v['ph']))) {
        $err['ph'] = 'Enter a phone number (7 to 15 digits), or leave it empty.';
    }
    $v['role'] = trim(mb_substr((string) ($b['role'] ?? ''), 0, 80));
    $web = strtolower(trim((string) ($b['web'] ?? '')));
    $web = (string) preg_replace('#^https?://#', '', $web);
    $web = (string) preg_replace('#[/?\#].*$#', '', $web);
    $web = (string) preg_replace('/^www\./', '', $web);
    $v['web'] = $web;
    if ($web !== '' && !preg_match('/^(?=.{4,190}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/', $web)) {
        $err['web'] = 'Enter your company\'s website, such as acme.com, or leave it empty.';
    }
    $v['size'] = (string) ($b['size'] ?? '');
    if (!isset(WSJ_SIZES[$v['size']])) {
        $err['size'] = 'Choose the company\'s size.';
    }
    $v['country'] = (string) ($b['country'] ?? '');
    if (!isset(WSJ_COUNTRIES[$v['country']])) {
        $err['country'] = 'Choose where the company is.';
    }
    $v['feats'] = array_values(array_intersect(array_keys(WS_FEATURES), array_map('strval', (array) ($b['feats'] ?? []))));
    if (!$v['feats']) {
        $err['feats'] = 'Choose at least one part of the portal.';
    }
    $v['slug'] = strtolower(trim((string) ($b['slug'] ?? '')));
    if ($v['slug'] !== '' && (strlen($v['slug']) < 2 || !preg_match(WS_SLUG_RE, $v['slug']) || in_array($v['slug'], WS_RESERVED, true))) {
        $err['slug'] = in_array($v['slug'], WS_RESERVED, true) ? '"' . $v['slug'] . '" is kept for the site itself. Choose another, or leave it empty.' : 'The address uses 2 to 30 lowercase letters, numbers and hyphens, or leave it empty.';
    }
    $v['msg'] = trim(mb_substr((string) ($b['msg'] ?? ''), 0, 2000));
    if (empty($b['consent']) || in_array((string) $b['consent'], ['0', 'false'], true)) {
        $err['consent'] = 'Tick the box to agree to the terms of use and the privacy notice.';
    }
    return $err;
}
/** Purges and a nudge (StratEdge's scheduled task): links never confirmed go after 7 days, decided requests 180 days
 *  after the decision; a confirmed request still waiting after 2 days reminds the administrators once. */
function wsjCron(): array
{
    if (wsCurrent() !== null) {
        return ['ran' => false];
    }
    $last = (int) secKv('wsj_cron_at', 0);
    if ($last > now() - 6 * 3600000) {
        return ['ran' => false];
    }
    secKvSet('wsj_cron_at', now());
    $gone = 0;
    $nudged = 0;
    foreach (colAll('ws/signup') as [$id, $s]) {
        $id = (string) $id;
        $st = (string) ($s->st ?? '');
        $decided = in_array($st, ['approved', 'declined'], true);
        if (($st === 'unverified' && (int) ($s->at ?? 0) < now() - 7 * 86400000) || ($decided && (int) ($s->dec->at ?? ($s->at ?? 0)) < now() - 180 * 86400000)) {
            docDelete('ws/signup/' . $id);
            wsjDropTokens($id);
            $gone++;
            continue;
        }
        if ($st === 'new' && empty($s->nudged) && (int) ($s->vAt ?? 0) < now() - 2 * 86400000) {
            $s->nudged = now();
            wsjLog($s, 'Workspaces', 'Reminder: waiting for review for over 2 days');
            docSet('ws/signup/' . $id, $s);
            wsjTell($id, 'Waiting for 2 days: the portal request of ' . $s->co, array_merge(['This request has waited for over two days. The page tells people we reply within one working day.'], wsjSummary($s)));
            $nudged++;
        }
    }
    return ['ran' => true, 'purged' => $gone, 'nudged' => $nudged];
}

function wsjRoute(string $r, array $b): never
{
    if (wsCurrent() !== null) {
        fail(404, 'not_found', 'This page is on StratEdge\'s own website.');
    }
    switch ($r) {
        /* ---------- the public page ---------- */
        case 'ws_signup_info': {
            $cfg = wsjCfg();
            $feats = [];
            foreach (WS_FEATURES as $k => $f) {
                $feats[] = ['k' => $k, 'n' => $f['n'], 'd' => $f['d']];
            }
            ok([
                'mode' => $cfg['mode'], 'open' => $cfg['mode'] !== 'off', 'pilotDays' => $cfg['pilotDays'], 'workOnly' => $cfg['workOnly'],
                'feats' => $feats, 'sizes' => WSJ_SIZES, 'countries' => WSJ_COUNTRIES, 'base' => siteUrl() . 'w/', 'email' => wsjReplyTo(),
            ]);
        }
        case 'ws_signup': {
            $cfg = wsjCfg();
            if ($cfg['mode'] === 'off') {
                fail(403, 'closed', 'Company portals are set up by invitation right now. Write to us at ' . wsjReplyTo() . '.');
            }
            // tries with mistakes in them count only here; a person correcting the form is not shut out by it
            if (throttleHit('wsjt:' . clientIp(), 30, 3600)) {
                fail(429, 'rate_limited', 'Too many tries from this network. Try again in an hour.');
            }
            $v = [];
            $errs = wsjCheck($b, $cfg, $v);
            if ($errs) {
                fail(400, 'invalid_argument', (string) reset($errs), ['errs' => $errs]);
            }
            if (throttleHit('wsj:' . clientIp(), 5, 3600)) {
                fail(429, 'rate_limited', 'Too many requests from this network. Try again in an hour.');
            }
            // the whole site: past this, something is wrong; people are asked to come back rather than queued
            if (throttleHit('wsj:all', 60, 3600)) {
                fail(429, 'rate_limited', 'We are receiving many requests right now. Try again in an hour.');
            }
            // the honeypot, the time the form was open, blocked and throwaway addresses (the website field is not a link)
            $scr = $b;
            unset($scr['web']);
            $scr['e'] = $v['e'];
            if (fwScreen($scr, 'portal sign-up') !== '') {
                fail(400, 'spam', 'This request could not be sent. Write to us at ' . wsjReplyTo() . '.');
            }
            // one address, three emails a day at most; past that the answer stays the same and nothing is sent
            if (throttleHit('wsje:' . substr(hash('sha256', $v['e']), 0, 40), 3, 86400)) {
                ok(['ok' => true]);
            }
            $all = colAll('ws/signup');
            // a portal this person already runs for this company: they hear where it is, nothing new is made
            foreach (wsRegistry(true) as $slug => $e) {
                if (($e['status'] ?? '') === 'deleted' || wsjNorm((string) ($e['name'] ?? '')) !== wsjNorm($v['co'])) {
                    continue;
                }
                if (in_array($v['e'], [mb_strtolower((string) ($e['admin']['email'] ?? '')), mb_strtolower((string) ($e['contact'] ?? ''))], true)) {
                    $url = wsUrlOf((string) $slug, $e);
                    wsjMail($v['e'], $v['n'], 'You have a portal already', [
                        'Hello ' . wsjFirst($v['n']) . ',',
                        'Someone, perhaps you, asked for a portal for ' . $v['co'] . ' with this email address. There is one already: ' . ($e['name'] ?? $slug) . ', at ' . $url,
                        !empty($e['setupDone'])
                            ? 'Sign in there with this email address. If you forgot your password, choose "Forgot your password?" on its login page.'
                            : 'Its setup link was emailed to its first administrator when it was made. If it has expired, reply to this email and we will send a new one.',
                        'Need a portal for another company? Reply to this email and tell us about it.',
                    ], ['Open your portal', $url]);
                    ok(['ok' => true]);
                }
            }
            // a request from this address that is still open: the same request, not a new one
            foreach ($all as [$sid, $s]) {
                $sid = (string) $sid;
                if (strtolower((string) ($s->e ?? '')) !== $v['e']) {
                    continue;
                }
                if (($s->st ?? '') === 'new') {
                    wsjMail($v['e'], $v['n'], 'We have your portal request', [
                        'Hello ' . wsjFirst((string) $s->n) . ',',
                        'You asked for a portal for ' . $s->co . ' on ' . date('j F Y', (int) (($s->at ?? now()) / 1000)) . ' and confirmed your email. Our team is looking at it and replies by email, usually within one working day.',
                        'You do not need to send the form again. To add something, reply to this email.',
                    ]);
                    ok(['ok' => true]);
                }
                if (($s->st ?? '') === 'unverified') {
                    foreach ($v as $k => $val) {
                        $s->$k = $val;
                    }
                    $s->ip = clientIp();
                    $s->sent = (int) ($s->sent ?? 0) + 1;
                    $sent = wsjSendLink($sid, $s);
                    $s->mailFail = !$sent;
                    wsjLog($s, $v['n'], 'Sent the form again; a new confirmation link' . ($sent ? ' went out' : ' could not be emailed'));
                    docSet('ws/signup/' . $sid, $s);
                    ok(['ok' => true]);
                }
            }
            require_once __DIR__ . '/privacy.php';
            $id = rid(6);
            $s = (object) ($v + ['st' => 'unverified', 'at' => now(), 'ip' => clientIp(), 'sent' => 1, 'consent' => privConsent('portal sign-up', ['consent' => 1]), 'log' => []]);
            wsjLog($s, $v['n'], 'Asked for a portal on the website');
            $sent = wsjSendLink($id, $s);
            $s->mailFail = !$sent;
            docSet('ws/signup/' . $id, $s);
            ok(['ok' => true]);
        }
        case 'ws_signup_verify': {
            if (throttleHit('wsjv:' . clientIp(), 30, 3600)) {
                fail(429, 'rate_limited', 'Too many tries from this network. Try again in an hour.');
            }
            $t = (string) ($b['t'] ?? '');
            $bad = 'This link has expired or was replaced by a newer one. Send the form again to get a new link.';
            if ($t === '' || strlen($t) > 100) {
                fail(400, 'bad_link', $bad);
            }
            // the link's row, used or not (a second click on a used link says where the request is)
            $q = secdb()->prepare("SELECT * FROM auth_tokens WHERE h = ? AND kind = 'wsjoin'");
            $q->execute([secMac('tok', $t)]);
            $row = $q->fetch();
            $id = $row ? (string) $row['uid'] : '';
            $s = $id !== '' ? docGet('ws/signup/' . $id) : null;
            if (!$row || !$s) {
                fail(400, 'bad_link', $bad);
            }
            if ((int) $row['used'] > 0 || ($s->st ?? '') !== 'unverified') {
                if (($s->st ?? '') === 'unverified' || (int) $row['exp'] < now() - 30 * 86400000) {
                    fail(400, 'bad_link', $bad);
                }
                $slug = (string) ($s->dec->slug ?? '');
                $e = $slug !== '' ? (wsRegistry(true)[$slug] ?? null) : null;
                ok(['ok' => true, 'again' => true, 'st' => (string) $s->st, 'co' => (string) $s->co] + ($s->st === 'approved' && $e ? ['url' => wsUrlOf($slug, $e)] : []));
            }
            if ((int) $row['exp'] < now()) {
                fail(400, 'bad_link', $bad);
            }
            tokUse((string) $row['h']);
            $s->st = 'new';
            $s->vAt = now();
            wsjLog($s, (string) $s->n, 'Confirmed the email address');
            docSet('ws/signup/' . $id, $s);
            audit('settings', 'Workspace sign-up request confirmed', $id, ['co' => (string) $s->co, 'e' => (string) $s->e], ['id' => '', 'name' => (string) $s->n]);
            $cfg = wsjCfg();
            $why = '';
            if ($cfg['mode'] === 'auto') {
                $writable = is_dir(wsRoot()) ? is_writable(wsRoot()) : is_writable(dirname(wsRoot()));
                if (!$writable) {
                    $why = 'the workspaces folder cannot be written';
                } elseif (wsjAutoToday() >= $cfg['autoMax']) {
                    $why = 'the daily limit of ' . $cfg['autoMax'] . ' automatic portal' . ($cfg['autoMax'] === 1 ? '' : 's') . ' was reached';
                } else {
                    $sys = ['id' => '', 'name' => 'Automatic sign-up', 'email' => wsjReplyTo()];
                    $m = wsMake($sys, [
                        'slug' => wsjFreeSlug((string) ($s->slug ?? ''), (string) $s->co), 'name' => (string) $s->co, 'adminName' => (string) $s->n, 'adminEmail' => (string) $s->e,
                        'features' => wsjAutoFeats($s, $cfg), 'pilotDays' => $cfg['pilotDays'], 'signup' => $id,
                        'notes' => 'Made automatically from a sign-up request on ' . date('j M Y') . '.',
                    ], wsjIntro($s));
                    if (isset($m['err'])) {
                        $why = 'making it failed: ' . $m['err'];
                    } else {
                        $s->st = 'approved';
                        $s->dec = (object) ['at' => now(), 'by' => 'auto', 'byn' => 'Automatic', 'act' => 'approved', 'slug' => $m['slug']];
                        wsjLog($s, 'Workspaces', 'Approved automatically: the workspace ' . $m['slug'] . ' was made and the setup link ' . ($m['mailed'] ? 'emailed' : 'could not be emailed'));
                        docSet('ws/signup/' . $id, $s);
                        wsjTell($id, 'New portal made automatically: ' . $s->co, array_merge(['A portal was made automatically at ' . wsUrlOf($m['slug'], $m['e']) . ' (pilot until ' . ($m['e']['plan']['until'] ?? '') . '). Pause or delete it under Workspaces if it should not be there.'], wsjSummary($s)));
                        ok(['ok' => true, 'st' => 'approved', 'co' => (string) $s->co, 'url' => wsUrlOf($m['slug'], $m['e']), 'setup' => wsSetupUrl($m['slug'], $m['e'], $m['tok']), 'mailed' => $m['mailed']]);
                    }
                }
                wsjLog($s, 'Workspaces', 'Not made automatically (' . $why . '); waiting for review');
                docSet('ws/signup/' . $id, $s);
            }
            wsjTell($id, 'New portal request: ' . $s->co, array_merge($why !== '' ? ['It could not be approved automatically: ' . $why . '.'] : [], wsjSummary($s)));
            ok(['ok' => true, 'st' => 'new', 'co' => (string) $s->co]);
        }
    }

    /* ---------- the provider console ---------- */
    $u = wsProvider();
    switch ($r) {
        case 'ws_signups': {
            $all = colAll('ws/signup');
            $hints = wsjHints($all);
            $rows = [];
            foreach ($all as [$id, $s]) {
                $rows[] = wsjOut((string) $id, $s, $hints[(string) $id] ?? []);
            }
            usort($rows, fn($a, $b2) => ($b2['vAt'] ?: $b2['at']) <=> ($a['vAt'] ?: $a['at']));
            $presets = [];
            foreach (WS_PRESETS as $k => $p) {
                $presets[] = ['k' => $k, 'n' => $p['n'], 'f' => $p['f']];
            }
            ok(['rows' => $rows, 'cfg' => wsjCfg(), 'link' => siteUrl() . '#/get-portal', 'sizes' => WSJ_SIZES, 'countries' => WSJ_COUNTRIES, 'presets' => $presets, 'autoToday' => wsjAutoToday()]);
        }
        case 'ws_signup_cfg': {
            $old = wsjCfg();
            $mode = (string) ($b['mode'] ?? $old['mode']);
            if (!in_array($mode, WSJ_MODES, true)) {
                fail(400, 'invalid_argument', 'Choose off, review or automatic.');
            }
            if ($mode === 'auto' && $old['mode'] !== 'auto') {
                // strangers can then make portals on this site: a recent sign-in is needed
                requireRecentAuth();
            }
            $preset = (string) ($b['preset'] ?? $old['preset']);
            $new = [
                'mode' => $mode,
                'pilotDays' => max(1, min(365, (int) ($b['pilotDays'] ?? $old['pilotDays']))),
                'preset' => isset(WS_PRESETS[$preset]) ? $preset : $old['preset'],
                'workOnly' => array_key_exists('workOnly', $b) ? !empty($b['workOnly']) : $old['workOnly'],
                'autoMax' => max(1, min(50, (int) ($b['autoMax'] ?? $old['autoMax']))),
                'notify' => array_key_exists('notify', $b) ? !empty($b['notify']) : $old['notify'],
            ];
            secKvSet('ws_signup_cfg', $new);
            audit('settings', 'Workspace sign-up page settings changed', 'ws_signup', $new, $u);
            ok(['cfg' => wsjCfg()]);
        }
        case 'ws_signup_decide': {
            $id = (string) ($b['id'] ?? '');
            $s = preg_match('/^[a-f0-9]{12}$/', $id) ? docGet('ws/signup/' . $id) : null;
            if (!$s) {
                fail(404, 'not_found', 'No such request (it may have been deleted).');
            }
            $act = (string) ($b['act'] ?? '');
            $st = (string) ($s->st ?? 'unverified');
            if ($act === 'approve') {
                if ($st !== 'new') {
                    fail(409, 'invalid_argument', $st === 'unverified' ? 'They have not confirmed their email address yet; approve it once they have (their link works for 48 hours).' : 'This request was decided already.');
                }
                $ae = mb_strtolower(trim((string) ($b['adminEmail'] ?? $s->e)));
                $mine = $ae === strtolower((string) $s->e);
                $fields = ['signup' => $id, 'notes' => 'From a sign-up request on the website (' . date('j M Y', (int) ((int) $s->at / 1000)) . ').'];
                foreach (['slug', 'name', 'adminName', 'adminEmail', 'features', 'preset', 'pilotDays', 'color', 'tagline', 'addr'] as $k) {
                    if (array_key_exists($k, $b)) {
                        $fields[$k] = $b[$k];
                    }
                }
                $m = wsMake($u, $fields, $mine ? wsjIntro($s) : '');
                if (isset($m['err'])) {
                    fail((int) $m['code'], 'invalid_argument', (string) $m['err']);
                }
                $s->st = 'approved';
                $s->dec = (object) ['at' => now(), 'by' => (string) $u['id'], 'byn' => (string) $u['name'], 'act' => 'approved', 'slug' => $m['slug']];
                wsjLog($s, (string) $u['name'], 'Approved: the workspace ' . $m['slug'] . ' was made; the setup link ' . ($m['mailed'] ? 'went to ' : 'could not be emailed to ') . $ae);
                if (!$mine) {
                    // someone else is its first administrator: the person who asked hears it was approved
                    wsjMail((string) $s->e, (string) $s->n, 'Your portal request was approved', [
                        'Hello ' . wsjFirst((string) $s->n) . ',',
                        'Your request for a portal for ' . $s->co . ' was approved. Its setup link went to ' . $ae . ', its first administrator.',
                        'Questions? Reply to this email.',
                    ]);
                }
                docSet('ws/signup/' . $id, $s);
                wsjDropTokens($id);
                audit('settings', 'Workspace sign-up request approved', $id, ['co' => (string) $s->co, 'slug' => $m['slug']], $u);
                ok(['req' => wsjOut($id, $s), 'ws' => wsRow($m['slug'], $m['e']), 'mailed' => $m['mailed']]);
            }
            if ($act === 'decline') {
                if (!in_array($st, ['new', 'unverified'], true)) {
                    fail(409, 'invalid_argument', 'This request was decided already.');
                }
                $reason = trim(mb_substr((string) ($b['reason'] ?? ''), 0, 1000));
                // only a confirmed address hears from us: an unconfirmed one may not be theirs
                $tell = !empty($b['tell']) && $st === 'new';
                $told = false;
                if ($tell) {
                    $told = wsjMail((string) $s->e, (string) $s->n, 'About your portal request', array_merge([
                        'Hello ' . wsjFirst((string) $s->n) . ',',
                        'Thank you for your interest in a portal for ' . $s->co . '. We are not able to set one up right now.',
                    ], $reason !== '' ? ['From our team: ' . $reason] : [], ['If you have questions, reply to this email.']));
                }
                $s->st = 'declined';
                $s->dec = (object) ['at' => now(), 'by' => (string) $u['id'], 'byn' => (string) $u['name'], 'act' => 'declined', 'reason' => $reason, 'told' => $told];
                wsjLog($s, (string) $u['name'], 'Declined' . ($reason !== '' ? ': ' . $reason : '') . ($tell ? ($told ? ' (emailed)' : ' (the email did not go out)') : ' (not emailed)'));
                docSet('ws/signup/' . $id, $s);
                wsjDropTokens($id);
                audit('settings', 'Workspace sign-up request declined', $id, ['co' => (string) $s->co, 'told' => $told], $u);
                ok(['req' => wsjOut($id, $s), 'told' => $told]);
            }
            if ($act === 'delete') {
                docDelete('ws/signup/' . $id);
                wsjDropTokens($id);
                audit('settings', 'Workspace sign-up request deleted', $id, ['co' => (string) $s->co, 'st' => $st], $u);
                ok(['ok' => true]);
            }
            fail(400, 'invalid_argument', 'Approve, decline or delete.');
        }
    }
    fail(404, 'not_found', 'Unknown action.');
}
