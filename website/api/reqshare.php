<?php
declare(strict_types=1);
/*
  v31: sharing open requirements from the requirements desk.

  An accepted requirement (open, working, submitted or interview) can be
    - emailed to vendors and clients on file, client contacts, consultants and the contacts list. Each person gets the
      list without the requirements that came from their own company (same vendor, email domain or company name), so a
      requirement never goes back to the vendor or client who gave it to us;
    - posted on the public careers page (org/site/jobs/v{id}); applications land in the ATS like any other posting;
    - shared to social feeds (LinkedIn, Facebook, X, WhatsApp, Telegram, Instagram) through job.php, which gives the
      networks the role's title, description and picture (they do not run the site's script).

  What goes out is a public version of the requirement: the vendor's name, contacts, email addresses, phone numbers and
  links are always taken out; the end client and a rate only when the sharer turns them on, and the rate as typed for
  sharing (usually lower than the vendor's). Share state and the share history live in vms/shr/items/{key}, where key
  is the careers posting id, so a client contact never sees that their requirement was shared.
*/
require_once __DIR__ . '/vms.php';
require_once __DIR__ . '/mail.php';

const RS_SHAREABLE = ['open', 'working', 'submitted', 'interview'];
const RS_CHANNELS = ['email', 'careers', 'careers-off', 'linkedin', 'facebook', 'x', 'whatsapp', 'telegram', 'instagram', 'mailto', 'copy', 'native', 'image'];
const RS_FREE_MAIL = ['gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'rocketmail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'protonmail.com', 'proton.me', 'zoho.com', 'zohomail.com', 'gmx.com', 'gmx.net', 'mail.com', 'yandex.com', 'rediffmail.com', 'comcast.net', 'verizon.net', 'att.net'];

/* ---------- where things live ---------- */

/** The careers posting id (and share record id) for a requirement: v{id} for desk ones, vc{hash} for client-posted ones. */
function rsKey(string $rid): string
{
    return preg_match('/^[A-Za-z0-9_\-]{1,38}$/', $rid) ? 'v' . $rid : 'vc' . substr(sha1($rid), 0, 20);
}
function rsIdOk(string $rid): bool
{
    return (bool) (preg_match('/^[A-Za-z0-9_\-]{1,40}$/', $rid) || preg_match('/^e:u_[a-f0-9]{8,32}:[A-Za-z0-9_\-]{1,40}$/', $rid));
}
/** The requirement ids in a request (desk ids and e:{uid}:{rid} client ones), at most 30. */
function rsIds(array $b): array
{
    $out = [];
    foreach ((array) ($b['ids'] ?? (isset($b['id']) ? [$b['id']] : [])) as $id) {
        $id = is_string($id) ? trim($id) : '';
        if ($id !== '' && rsIdOk($id) && !in_array($id, $out, true)) {
            $out[] = $id;
        }
    }
    return array_slice($out, 0, 30);
}
function rsMeta(string $rid): array
{
    $d = docGet('vms/shr/items/' . rsKey($rid));
    return $d ? (json_decode((string) json_encode($d), true) ?: []) : [];
}
function rsMetaSave(string $rid, array $patch): void
{
    $m = array_merge(rsMeta($rid), $patch, ['rid' => $rid, 'u' => now()]);
    docSet('vms/shr/items/' . rsKey($rid), json_decode((string) json_encode($m)));
}
function rsLog(string $rid, array $u, string $ch, int $n = 0, string $ref = ''): void
{
    $sh = (array) (rsMeta($rid)['sh'] ?? []);
    $e = ['at' => now(), 'by' => $u['id'], 'byn' => $u['name'], 'ch' => $ch];
    if ($n > 0) {
        $e['n'] = $n;
    }
    if ($ref !== '') {
        $e['ref'] = $ref;
    }
    $sh[] = $e;
    rsMetaSave($rid, ['sh' => array_slice($sh, -40)]);
}
function rsShareable(array $r): bool
{
    return in_array((string) ($r['st'] ?? 'open'), RS_SHAREABLE, true);
}
/** The public link for a posting (job.php shows social networks the role; people go on to the careers page). */
function rsLink(string $key, string $src = ''): string
{
    return siteUrl() . 'job.php?id=' . rawurlencode($key) . ($src !== '' ? '&src=' . rawurlencode($src) : '');
}

/* ---------- the public version of a requirement ---------- */

/** Takes out what identifies the vendor (names, contacts, emails, phone numbers, links, signatures). */
function rsScrub(string $s, array $drop, array $client, bool $title = false): string
{
    $s = str_replace(["\r\n", "\r"], "\n", $s);
    $contact = '/[A-Z0-9._%+\'-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b(?:https?:\/\/|www\.)\S+|(?:\(\d{3}\)|\b\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b|\+\d{1,3}[\s.-]?\d{2,5}[\s.-]?\d{3,5}[\s.-]?\d{3,5}/i';
    if (!$title) {
        $keep = [];
        $seen = 0;
        foreach (explode("\n", $s) as $ln) {
            $t = trim($ln);
            if ($t !== '' && preg_match('/^(thanks|thank you|thanks\s*(and|&)\s*regards|regards|best regards|kind regards|warm regards|best wishes|best|sincerely|cheers|respectfully)\b[\s,.!-]*$/i', $t)) {
                break; // the signature follows
            }
            if (
                preg_match('/^(from|to|cc|bcc|sent|date|subject|reply-to)\s*:/i', $t) ||
                preg_match('/^(e-?mail|phone|ph|mobile|mob|cell|fax|tel|telephone|whatsapp|linkedin|skype|website|address)(\s*(no\.?|number|#|id))?\s*[:#-]/i', $t) ||
                preg_match('/^contact(\s*(no\.?|number|details|info|email|phone|person|name))?\s*[:#-]/i', $t) ||
                preg_match('/^[-_=*~.]{3,}$/', $t) ||
                preg_match('/^-*\s*(forwarded message|original message|begin forwarded message)/i', $t) ||
                // the vendor's greeting and "please find the requirement below"
                ($seen < 2 && preg_match('/^(hi|hello|hey|dear|greetings|good (morning|afternoon|evening))\b[^.!?]{0,40}[,!:.]?$/i', $t)) ||
                preg_match('/^(please\s+)?(find|see|check|review)\b.{0,60}\b(below|attached|following)\b[^.!?]*[.!:]?$/i', $t)
            ) {
                continue;
            }
            if ($t !== '') {
                $seen++;
            }
            // sentences with an email address, a link or a phone number are contact instructions: they go entirely
            if ($t !== '' && preg_match($contact, $t)) {
                $parts = preg_split('/(?<=[.!?;])\s+/', $t) ?: [$t];
                $t2 = trim(implode(' ', array_filter($parts, fn($x) => !preg_match($contact, $x))));
                if ($t2 === '' || !preg_match('/[\p{L}\p{N}]/u', $t2)) {
                    continue;
                }
                $ln = (string) preg_replace('/^(\s*)\S.*$/', '$1', $ln) . $t2;
            }
            $keep[] = rtrim($ln);
        }
        $s = implode("\n", $keep);
    }
    $s = (string) preg_replace('/[A-Z0-9._%+\'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i', '', $s);
    $s = (string) preg_replace('~\b(?:https?://|www\.)[^\s<>()]+~i', '', $s);
    $s = (string) preg_replace('/(?<![\w$])(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*(?:x|ext\.?|extension)\s*\d{1,6})?(?!\w)/i', '', $s);
    $s = (string) preg_replace('/(?<![\w$])\+\d{1,3}[\s.-]?\d{2,5}[\s.-]?\d{3,5}[\s.-]?\d{3,5}(?!\w)/', '', $s);
    $name = fn(string $n) => '/(?<![\p{L}\p{N}])' . preg_quote($n, '/') . '(?![\p{L}\p{N}])/iu';
    foreach ($drop as $n) {
        $n = trim((string) $n);
        if (mb_strlen($n) >= 3) {
            $s = (string) preg_replace($name($n), '', $s);
        }
    }
    foreach ($client as $n) {
        $n = trim((string) $n);
        if (mb_strlen($n) >= 3) {
            $s = (string) preg_replace($name($n), $title ? '' : 'our client', $s);
        }
    }
    if ($title) {
        $s = trim((string) preg_replace('/\s+/', ' ', $s));
        $s = (string) preg_replace('/^((fw|fwd|re)\s*:\s*)+/i', '', $s);
        $s = (string) preg_replace('/^(urgent|immediate|hot|new)?\s*(need|requirement|req|position|opening|role)s?\s*(for|:|-)\s*/i', '', $s);
        $s = (string) preg_replace('/\(\s*\)|\[\s*\]/', '', $s);
        $s = (string) preg_replace('/(\s*[-–—|:@,\/]+\s*)+$/u', '', $s);
        $s = (string) preg_replace('/^(\s*[-–—|:@,\/]+\s*)+/u', '', $s);
        return mb_substr(trim((string) preg_replace('/\s+/', ' ', $s)), 0, 160);
    }
    $s = (string) preg_replace('/[ \t]{2,}/', ' ', $s);
    $s = (string) preg_replace('/^[ \t]*[:|,;\/-]+[ \t]*$/m', '', $s);
    $s = (string) preg_replace('/\b(our client)(\s+our client)+/i', '$1', $s);
    $s = trim((string) preg_replace("/\n{3,}/", "\n\n", $s));
    if (mb_strlen($s) > 4000) {
        $s = preg_replace('/\s+\S*$/u', '', mb_substr($s, 0, 4000)) . '…';
    }
    return $s;
}
/** Names that never go out (vendor, its contact) and the end client (out unless the sharer shows it). */
function rsNames(array $r): array
{
    $drop = [(string) ($r['vn'] ?? ''), (string) ($r['cn'] ?? '')];
    $client = [(string) ($r['ec'] ?? ''), (string) ($r['cl'] ?? '')];
    if (($r['src'] ?? '') === 'client') {
        // a client contact's own requirement: the client is the "vendor" here
        $client[] = (string) ($r['vn'] ?? '');
        $drop = [(string) ($r['cn'] ?? '')];
    }
    if (!empty($r['vid'])) {
        $v = docGet(VMS_VENDOR . '/' . $r['vid']);
        if ($v) {
            $drop[] = (string) ($v->n ?? '');
            foreach ((array) ($v->contacts ?? []) as $c) {
                $drop[] = (string) (((object) $c)->n ?? '');
            }
        }
    }
    $clean = fn($l) => array_values(array_unique(array_filter(array_map('trim', $l), fn($x) => mb_strlen($x) >= 3)));
    $client = $clean($client);
    // a vendor that is also the end client is a direct client: treat it as the client
    $drop = array_values(array_diff($clean($drop), $client));
    return [$drop, $client];
}
/** What the sharer chose for a requirement (saved from the last share), merged with what they send now. */
function rsPs(array $r, array $in = []): array
{
    $saved = (array) (rsMeta((string) $r['id'])['ps'] ?? []);
    $ps = array_merge(['ti' => '', 'd' => '', 'rate' => '', 'client' => false], $saved, $in);
    return [
        'ti' => mb_substr(trim((string) ($ps['ti'] ?? '')), 0, 160),
        'd' => mb_substr(trim((string) ($ps['d'] ?? '')), 0, 6000),
        'rate' => mb_substr(trim((string) ($ps['rate'] ?? '')), 0, 60),
        'client' => !empty($ps['client']),
    ];
}
/** The public fields of a requirement: what an email, the careers posting and social posts show. */
function rsPublic(array $r, array $ps): array
{
    [$drop, $client] = rsNames($r);
    $hide = $ps['client'] ? [] : $client;
    $ti = rsScrub($ps['ti'] !== '' ? $ps['ti'] : (string) ($r['ti'] ?? ''), $drop, $hide, true);
    $d = rsScrub($ps['d'] !== '' ? $ps['d'] : (string) ($r['d'] ?? ''), $drop, $hide);
    $sk = rsScrub((string) ($r['sk'] ?? ''), $drop, $hide, true);
    $cl = $ps['client'] ? trim((string) (($r['ec'] ?? '') !== '' ? $r['ec'] : ($r['cl'] ?? ''))) : '';
    return [
        'ti' => $ti !== '' ? $ti : 'Open role',
        'loc' => mb_substr(trim((string) ($r['loc'] ?? '')), 0, 120),
        'md' => (string) ($r['md'] ?? ''),
        'ty' => (string) ($r['ty'] ?? ''),
        'dur' => mb_substr((string) ($r['dur'] ?? ''), 0, 60),
        'n' => max(1, (int) ($r['n'] ?? 1)),
        'sd' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($r['sd'] ?? '')) ? (string) $r['sd'] : '',
        'sk' => mb_substr($sk, 0, 400),
        'visa' => mb_substr((string) ($r['visa'] ?? ''), 0, 120),
        'rate' => $ps['rate'],
        'client' => $cl,
        'd' => $d,
    ];
}
/** Non-empty values without repeats (a location of "Remote" and the work mode "Remote" show once). */
function rsUniq(array $l): array
{
    $out = [];
    $seen = [];
    foreach ($l as $x) {
        $x = trim((string) $x);
        if ($x !== '' && !isset($seen[mb_strtolower($x)])) {
            $seen[mb_strtolower($x)] = true;
            $out[] = $x;
        }
    }
    return $out;
}
function rsDate(string $ymd): string
{
    $t = strtotime($ymd . ' 12:00:00');
    return $t ? date('M j, Y', $t) : $ymd;
}
/** One requirement in a shared-requirements email: text lines and the same in HTML. */
function rsBlock(array $pf, string $link, bool $full): array
{
    $meta = implode(' · ', rsUniq([$pf['loc'], $pf['md'], $pf['ty'], $pf['dur'], $pf['n'] > 1 ? $pf['n'] . ' openings' : '']));
    $more = implode(' · ', array_values(array_filter([
        $pf['rate'] !== '' ? 'Rate: ' . $pf['rate'] : '',
        $pf['sd'] !== '' ? 'Start: ' . rsDate($pf['sd']) : '',
        $pf['visa'] !== '' ? 'Work authorization: ' . $pf['visa'] : '',
        $pf['client'] !== '' ? 'Client: ' . $pf['client'] : '',
    ])));
    $d = $pf['d'];
    $cap = $full ? 2500 : 320;
    if (mb_strlen($d) > $cap) {
        $d = preg_replace('/\s+\S*$/u', '', mb_substr($d, 0, $cap)) . '…';
    }
    if (!$full) {
        $d = trim((string) preg_replace('/\s+/', ' ', $d));
    }
    $t = [$pf['ti']];
    $e = fn($x) => htmlspecialchars((string) $x, ENT_QUOTES, 'UTF-8');
    $h = '<b style="font-size:16px;color:#1f2a44">' . $e($pf['ti']) . '</b>';
    if ($meta !== '') {
        $t[] = $meta;
        $h .= '<br><span style="color:#46546f">' . $e($meta) . '</span>';
    }
    if ($more !== '') {
        $t[] = $more;
        $h .= '<br>' . $e($more);
    }
    if ($pf['sk'] !== '') {
        $t[] = 'Skills: ' . $pf['sk'];
        $h .= '<br><b>Skills:</b> ' . $e($pf['sk']);
    }
    if ($d !== '') {
        $t[] = $d;
        $h .= '<br><span style="color:#46546f">' . nl2br($e($d)) . '</span>';
    }
    if ($link !== '') {
        $t[] = 'Details and apply: ' . $link;
        $h .= '<br><a href="' . $e($link) . '" style="color:#2B3993;font-weight:700">Details and apply</a>';
    }
    return ['t' => implode("\n", $t), 'h' => $h];
}

/* ---------- who a requirement came from (so it never goes back to them) ---------- */

function rsOrg(string $s): string
{
    $s = mb_strtolower(trim($s));
    $s = (string) preg_replace('/[^\p{L}\p{N} ]+/u', ' ', $s);
    $s = (string) preg_replace('/\b(inc|llc|l l c|ltd|limited|corp|corporation|co|company|pvt|private|plc|gmbh|llp|lp|the)\b/u', ' ', $s);
    return trim((string) preg_replace('/\s+/', ' ', $s));
}
function rsDom(string $email): string
{
    $at = strrpos($email, '@');
    if ($at === false) {
        return '';
    }
    $d = strtolower(trim(substr($email, $at + 1)));
    return in_array($d, RS_FREE_MAIL, true) ? '' : $d;
}
function rsSiteDom(string $site): string
{
    $s = strtolower(trim($site));
    if (str_contains($s, '@')) {
        return rsDom($s);
    }
    $s = (string) preg_replace('~^[a-z]+://~', '', $s);
    $s = (string) preg_replace('~^www\.~', '', $s);
    $s = explode('/', $s)[0];
    return preg_match('/^[a-z0-9.-]+\.[a-z]{2,}$/', $s) && !in_array($s, RS_FREE_MAIL, true) ? $s : '';
}
/** The vendor id, company names, email domains and addresses a requirement came from (and its end client). */
function rsOwners(array $r, array $vendors): array
{
    $names = [];
    $doms = [];
    $emails = [];
    foreach (['vn', 'ec', 'cl'] as $k) {
        $n = rsOrg((string) ($r[$k] ?? ''));
        if (mb_strlen($n) >= 2) {
            $names[] = $n;
        }
    }
    $ce = strtolower(trim((string) ($r['ce'] ?? '')));
    if ($ce !== '') {
        $emails[] = $ce;
        $doms[] = rsDom($ce);
    }
    $vid = (string) ($r['vid'] ?? '');
    foreach ($vendors as $id => $v) {
        $mine = ($vid !== '' && (string) $id === $vid) || in_array(rsOrg((string) ($v->n ?? '')), $names, true);
        if (!$mine) {
            continue;
        }
        $names[] = rsOrg((string) ($v->n ?? ''));
        $doms[] = rsSiteDom((string) ($v->site ?? ''));
        foreach ((array) ($v->contacts ?? []) as $c) {
            $e = strtolower(trim((string) (((object) $c)->e ?? '')));
            if ($e !== '') {
                $emails[] = $e;
                $doms[] = rsDom($e);
            }
        }
    }
    $u = fn($l) => array_values(array_unique(array_filter($l, fn($x) => $x !== '')));
    return ['vid' => $vid, 'names' => $u($names), 'doms' => $u($doms), 'emails' => $u($emails)];
}
/** The requirements one recipient must not get: those from their own vendor, company or email domain. */
function rsSkips(array $p, array $owners): array
{
    $e = strtolower((string) $p['email']);
    $d = rsDom($e);
    $co = rsOrg((string) ($p['vars']['company'] ?? ''));
    $vid = (string) ($p['vars']['vid'] ?? '');
    $out = [];
    foreach ($owners as $id => $o) {
        if (
            ($vid !== '' && $vid === $o['vid']) ||
            in_array($e, $o['emails'], true) ||
            ($d !== '' && in_array($d, $o['doms'], true)) ||
            ($co !== '' && in_array($co, $o['names'], true))
        ) {
            $out[] = (string) $id;
        }
    }
    return $out;
}

/** v32: consultants by email (the consultant database and portal accounts) with their type and work authorization,
 *  so a requirement email never offers someone a role their type may not take (e.g. full-time to a C2C consultant). */
function rsRulePeople(): array
{
    require_once __DIR__ . '/rules.php';
    $out = [];
    foreach (colAll('rec/cand/items') as [, $c]) {
        $e = strtolower(trim((string) ($c->e ?? '')));
        if ($e !== '') {
            $out[$e] = ['ct' => ruleCtOfCand($c), 'extra' => [], 'auth' => ruleAuthNorm((string) ($c->auth ?? ''))];
        }
    }
    foreach (colAll('u') as [$uid, $u]) {
        $role = (string) (myR((string) $uid)->role ?? ($u->p->role ?? ''));
        $e = strtolower(trim((string) ($u->p->e ?? '')));
        if ($e !== '' && in_array($role, ['consultant', 'student'], true)) {
            $out[$e] = rulePerson((string) $uid);
        }
    }
    return $out;
}

/* ---------- the careers posting ---------- */

function rsApps(string $key): int
{
    try {
        $st = db()->prepare("SELECT COUNT(*) FROM docs WHERE col = 'ats' AND data LIKE ?");
        $st->execute(['%"job":"' . $key . '"%']);
        return (int) $st->fetchColumn();
    } catch (Throwable $e) {
        return 0;
    }
}
function rsJobOut(string $key): ?array
{
    $j = docGet("org/site/jobs/$key");
    if (!$j) {
        return null;
    }
    return ['id' => $key, 'open' => ($j->open ?? true) !== false, 'link' => rsLink($key), 'page' => siteUrl() . '#/careers/' . $key, 'apps' => rsApps($key), 'at' => (int) ($j->at ?? 0), 'img' => !empty($j->img)];
}
/** Posts (or refreshes) a requirement on the careers page; $img is an uploaded PNG for the social card, if any. */
function rsPublish(array $u, array $r, array $ps, ?array $img): array
{
    $key = rsKey((string) $r['id']);
    $pf = rsPublic($r, $ps);
    $cur = docGet("org/site/jobs/$key");
    $job = (object) [
        'ti' => $pf['ti'],
        'loc' => $pf['loc'],
        'ty' => $pf['ty'],
        'md' => $pf['md'],
        'sk' => $pf['sk'],
        'd' => $pf['d'],
        'rate' => $pf['rate'],
        'dur' => $pf['dur'],
        'visa' => $pf['visa'],
        'n' => $pf['n'],
        'sd' => $pf['sd'],
        'cl' => $pf['client'],
        'open' => true,
        'at' => (int) ($cur->at ?? now()),
        'u' => now(),
        'by' => (string) ($cur->by ?? $u['id']),
        'vreq' => (string) $r['id'],
    ];
    foreach (['qs', 'eeo', 'internal', 'img'] as $k) {
        if ($cur && isset($cur->$k)) {
            $job->$k = $cur->$k;
        }
    }
    if ($img && ($img['error'] ?? 1) === UPLOAD_ERR_OK && is_uploaded_file((string) $img['tmp_name'])) {
        uploadGuard((string) $img['tmp_name'], basename((string) $img['name']));
        $info = @getimagesize((string) $img['tmp_name']);
        $ext = $info ? ([IMAGETYPE_PNG => 'png', IMAGETYPE_JPEG => 'jpg'][$info[2]] ?? '') : '';
        if ($ext !== '' && $info[0] <= 2400 && $info[1] <= 2400 && (int) $img['size'] <= 4 * 1048576) {
            $dir = rtrim((string) cfg('files_dir'), '/') . '/og';
            if (!is_dir($dir)) {
                @mkdir($dir, 0775, true);
            }
            foreach (['png', 'jpg'] as $old) {
                @unlink("$dir/$key.$old");
            }
            if (@move_uploaded_file((string) $img['tmp_name'], "$dir/$key.$ext")) {
                $job->img = now();
            }
        }
    }
    docSet("org/site/jobs/$key", $job);
    $m = rsMeta((string) $r['id']);
    rsMetaSave((string) $r['id'], ['ps' => $ps, 'job' => $key, 'on' => true, 'pubAt' => (int) ($m['pubAt'] ?? now()), 'pubBy' => $u['id']]);
    return (array) rsJobOut($key);
}
/** Takes a posting down (the page then says the role is no longer open). */
function rsClose(string $rid): bool
{
    $key = rsKey($rid);
    $j = docGet("org/site/jobs/$key");
    if (!$j || ($j->open ?? true) === false) {
        return false;
    }
    $j->open = false;
    $j->closedAt = now();
    docSet("org/site/jobs/$key", $j);
    rsMetaSave($rid, ['on' => false]);
    return true;
}
/** Postings of requirements that were filled, closed, dismissed or deleted come down. */
function rsSweep(): int
{
    $n = 0;
    foreach (colAll('org/site/jobs') as [$jid, $j]) {
        if (empty($j->vreq) || ($j->open ?? true) === false) {
            continue;
        }
        $r = vmsReqGet((string) $j->vreq);
        if ($r && rsShareable($r)) {
            continue;
        }
        if (rsClose((string) $j->vreq)) {
            $n++;
        }
    }
    return $n;
}
function rsLoad(string $rid): ?array
{
    if (!rsIdOk($rid)) {
        return null;
    }
    $r = vmsReqGet($rid);
    if (!$r) {
        return null;
    }
    $r['id'] = $rid;
    return $r;
}
/** Everything the share dialog needs about one requirement. */
function rsItem(array $r, array $ps): array
{
    $m = rsMeta((string) $r['id']);
    $key = rsKey((string) $r['id']);
    return [
        'id' => (string) $r['id'],
        'key' => $key,
        'ok' => rsShareable($r),
        'st' => (string) ($r['st'] ?? 'open'),
        'src' => (string) ($r['src'] ?? ''),
        'ti' => (string) ($r['ti'] ?? ''),
        'raw' => ['rate' => (string) ($r['rate'] ?? ''), 'client' => (string) (($r['ec'] ?? '') !== '' ? $r['ec'] : ($r['cl'] ?? '')), 'vn' => (string) ($r['vn'] ?? '')],
        'ps' => $ps,
        'pub' => rsPublic($r, $ps),
        'job' => rsJobOut($key),
        'sh' => array_slice(array_reverse((array) ($m['sh'] ?? [])), 0, 12),
    ];
}

/* ---------- routes ---------- */

function rsRoute(string $r, array $b): never
{
    switch ($r) {
        case 'rs_info':
            // the dialog: public versions (with the choices sent, not saved), postings, history, the company's pages
            $u = vmsStaff();
            rsSweep();
            $psIn = (array) ($b['ps'] ?? []);
            $items = [];
            foreach (rsIds($b) as $id) {
                $req = rsLoad($id);
                if ($req) {
                    $items[] = rsItem($req, rsPs($req, is_array($psIn[$id] ?? null) ? $psIn[$id] : []));
                }
            }
            $c = mailSettings();
            ok([
                'items' => $items,
                'mail' => mailCanUse($u),
                'mailReady' => mailReady($c),
                'limit' => (int) ($c['limit'] ?? 0),
                'social' => docGet('org/site/x/social') ?? new stdClass(),
                'base' => siteUrl(),
            ]);

        case 'rs_publish':
            // post on the careers page (FormData "data" + an optional "img" PNG, or plain JSON)
            $u = vmsStaff();
            $in = isset($_POST['data']) ? (json_decode((string) $_POST['data'], true) ?: []) : $b;
            $req = rsLoad((string) ($in['id'] ?? ''));
            if (!$req) {
                fail(404, 'not_found', 'That requirement is no longer on the desk.');
            }
            if (!rsShareable($req)) {
                fail(400, 'invalid_argument', 'Only open requirements can be posted. Accept it to the desk first.');
            }
            $job = rsPublish($u, $req, rsPs($req, is_array($in['ps'] ?? null) ? $in['ps'] : []), $_FILES['img'] ?? null);
            rsLog((string) $req['id'], $u, 'careers');
            ok(['job' => $job, 'item' => rsItem($req, rsPs($req))]);

        case 'rs_unpublish':
            $u = vmsStaff();
            $ids = rsIds($b);
            foreach ($ids as $id) {
                if (rsClose($id)) {
                    rsLog($id, $u, 'careers-off');
                }
            }
            ok(['ok' => true]);

        case 'rs_sync':
            // after a status change on the desk: a filled or closed requirement's posting comes down
            vmsStaff();
            $n = 0;
            foreach (rsIds($b) as $id) {
                $req = rsLoad($id);
                if ((!$req || !rsShareable($req)) && rsClose($id)) {
                    $n++;
                }
            }
            ok(['closed' => $n]);

        case 'rs_log':
            // social buttons and copies are logged on each requirement (who shared it where, and when)
            $u = vmsStaff();
            $ch = (string) ($b['ch'] ?? '');
            if (!in_array($ch, RS_CHANNELS, true)) {
                fail(400, 'invalid_argument', 'Unknown channel.');
            }
            foreach (rsIds($b) as $id) {
                if (rsLoad($id)) {
                    rsLog($id, $u, $ch);
                }
            }
            ok(['ok' => true]);

        case 'rs_mail':
            // email the requirements: count (who gets it), preview, test (to me) or send (a campaign)
            $u = vmsStaff();
            if (!mailCanUse($u)) {
                fail(403, 'forbidden', 'Email, inbox & campaigns is not switched on for your account. Ask an administrator.');
            }
            $mode = in_array($b['mode'] ?? '', ['count', 'preview', 'test', 'send'], true) ? (string) $b['mode'] : 'count';
            $psIn = (array) ($b['ps'] ?? []);
            $reqs = [];
            foreach (rsIds($b) as $id) {
                $req = rsLoad($id);
                if (!$req) {
                    continue;
                }
                if (!rsShareable($req)) {
                    fail(400, 'invalid_argument', '"' . $req['ti'] . '" is not open. Only accepted, open requirements can be shared.');
                }
                $reqs[$id] = $req;
            }
            if (!$reqs) {
                fail(400, 'invalid_argument', 'Pick at least one open requirement.');
            }
            $vendors = docsIn(VMS_VENDOR);
            $full = count($reqs) === 1;
            $blocks = [];
            $owners = [];
            $psUse = [];
            foreach ($reqs as $id => $req) {
                $ps = rsPs($req, is_array($psIn[$id] ?? null) ? $psIn[$id] : []);
                $psUse[$id] = $ps;
                $job = rsJobOut(rsKey($id));
                $blocks[] = ['id' => (string) $id] + rsBlock(rsPublic($req, $ps), $job && $job['open'] ? rsLink(rsKey($id), 'email') : '', $full);
                $owners[$id] = rsOwners($req, $vendors);
            }
            $audIn = is_array($b['aud'] ?? null) ? $b['aud'] : [];
            $aud = mailAudience($audIn, $u);
            $list = [];
            $own = 0;
            $partial = 0;
            $people = rsRulePeople();
            $ruled = 0;
            foreach ($aud['list'] as $p) {
                $skip = rsSkips($p, $owners);
                $ownSkip = count($skip);
                // v32: consultants only get the roles their type may take (Admin > Consultant types & job rules)
                $person = $people[strtolower((string) $p['email'])] ?? null;
                if ($person) {
                    foreach ($reqs as $rid => $req) {
                        [$allowed] = ruleJobOk($person, (string) ($req['ty'] ?? ''), (string) ($req['visa'] ?? ''));
                        if (!$allowed && !in_array((string) $rid, $skip, true)) {
                            $skip[] = (string) $rid;
                        }
                    }
                }
                if (count($skip) >= count($reqs)) {
                    // left out: their own company's requirements, or roles their consultant type may not take
                    if ($ownSkip > 0) {
                        $own++;
                    } else {
                        $ruled++;
                    }
                    continue;
                }
                if ($skip) {
                    $p['vars']['skip'] = $skip;
                    $partial++;
                }
                $list[] = $p;
            }
            if ($mode === 'count') {
                ok([
                    'count' => count($list),
                    'own' => $own,
                    'partial' => $partial,
                    'ruled' => $ruled,
                    'suppressed' => $aud['suppressed'],
                    'sample' => array_slice(array_map(fn($p) => $p['name'] !== '' ? $p['name'] . ' <' . $p['email'] . '>' : $p['email'], $list), 0, 6),
                ]);
            }
            $subject = trim(str($b, 'subject', 250));
            $body = trim(str($b, 'body', 20000));
            if ($subject === '' || $body === '') {
                fail(400, 'invalid_argument', 'Add a subject and a message.');
            }
            if (!str_contains($body, '{requirements}')) {
                // the list goes after the opening paragraphs when the placeholder was removed
                $parts = preg_split("/\n[ \t]*\n/", $body, 3) ?: [$body];
                $body = count($parts) >= 2 ? $parts[0] . "\n\n" . $parts[1] . "\n\n{requirements}" . (isset($parts[2]) ? "\n\n" . $parts[2] : '') : $body . "\n\n{requirements}";
            }
            $replyTo = strtolower(trim(str($b, 'replyTo', 190)));
            if ($replyTo !== '' && !filter_var($replyTo, FILTER_VALIDATE_EMAIL)) {
                fail(400, 'invalid_argument', 'The reply-to address is not a valid email.');
            }
            $fromName = trim(str($b, 'fromName', 100));
            $camp = ['subject' => $subject, 'body' => $body, 'btn_text' => '', 'btn_url' => '', 'audience' => json_encode(['reqs' => $blocks]), 'base' => siteUrl()];
            if ($mode === 'preview') {
                $msg = mailCampaignMessage($camp, ['email' => 'alex.morgan@example.com', 'name' => 'Alex Morgan', 'vars' => json_encode(['company' => 'Example Corp', 'title' => 'Account Manager']), 'tok' => 'preview']);
                ok(['subject' => $msg['subject'], 'html' => $msg['html']]);
            }
            if ($mode === 'test') {
                session_write_close();
                $msg = mailCampaignMessage($camp, ['email' => $u['email'], 'name' => $u['name'], 'vars' => '{}', 'tok' => 'test']);
                $sent = mailDeliver(['to' => $u['email'], 'name' => $u['name'], 'subject' => '[Test] ' . $msg['subject'], 'html' => $msg['html'], 'text' => $msg['text'], 'reply' => $replyTo, 'from_name' => $fromName, 'atts' => [], 'kind' => 'mass_test']);
                $f = $GLOBALS['mailFail'] ?? ['stage' => '', 'code' => 0];
                $err = (string) ($GLOBALS['mailErr'] ?? '');
                ok(['ok' => $sent, 'to' => $u['email'], 'error' => $err, 'hint' => $sent ? '' : mailHint($err, (string) $f['stage'], (int) $f['code'], mailSettings())]);
            }
            if (!$list) {
                fail(400, 'invalid_argument', $own ? 'Everyone picked works with the company these requirements came from, so nobody would get them.' : ($aud['suppressed'] ? 'Everyone in this audience has unsubscribed.' : 'Pick at least one recipient.'));
            }
            if (count($list) > MAIL_MAX_RECIPIENTS) {
                fail(400, 'invalid_argument', 'One email can go to up to ' . number_format(MAIL_MAX_RECIPIENTS) . ' people. Pick fewer groups or tags.');
            }
            $first = reset($reqs);
            $label = 'Requirements: ' . mb_substr((string) $first['ti'], 0, 60) . (count($reqs) > 1 ? ' +' . (count($reqs) - 1) . ' more' : '') . (trim(str($b, 'label', 200)) !== '' ? ' · ' . trim(str($b, 'label', 200)) : '');
            $m = ['subject' => $subject, 'body' => $body, 'btnText' => '', 'btnUrl' => '', 'fromName' => $fromName, 'replyTo' => $replyTo, 'aud' => $audIn];
            $cid = mailCampaignQueue($u, $m, $list, [], $label, ['reqs' => $blocks, 'vreq' => array_keys($reqs)]);
            foreach ($reqs as $id => $req) {
                rsMetaSave((string) $id, ['ps' => $psUse[$id]]);
                rsLog((string) $id, $u, 'email', count($list), $cid);
            }
            if (!empty($audIn['lists']) && is_array($audIn['lists'])) {
                // v37.5: each distribution list's activity shows the requirements that went to it
                require_once __DIR__ . '/maillists.php';
                dlNoteSent($audIn['lists'], $cid, $subject, count($list), $u);
            }
            ok(['campaign' => mailCampaignOut((array) mailCampaignGet($cid)), 'own' => $own, 'partial' => $partial, 'skipped' => $aud['suppressed']]);
    }
    fail(404, 'not_found', 'Unknown action.');
}
