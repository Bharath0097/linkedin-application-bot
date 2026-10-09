<?php
/*
  Share links for open roles: job.php?id=<posting>&src=<channel>. LinkedIn, Facebook, X, WhatsApp, Telegram, Slack and
  the rest read the role's title, description and picture from this page (they do not run the website's script, so
  they would only ever see the home page). People are sent straight on to the role on the careers page.
  job.php?id=<posting>&img=1 is the role's picture (made when it was shared from the requirements desk), or the
  site's default card. Without an id the link is for the careers page as a whole.
*/
declare(strict_types=1);
require __DIR__ . '/api/lib.php';
// v37: on a company workspace the page carries the company's name (StratEdge's own site is unchanged)
if (wsSlug() !== '') {
    ob_start(fn(string $out): string => wsBrandText($out, true));
}

/** v37.2: one more visit to a role's link through a channel (ats/x/clicks/{id}: total, per channel, per day for 60 days). */
function jobClickCount(string $id, string $ch): void
{
    $ch = $ch !== '' ? $ch : 'direct';
    $d = docGet('ats/x/clicks/' . $id) ?? new stdClass();
    $c = isset($d->ch) && $d->ch instanceof stdClass ? $d->ch : new stdClass();
    if (!isset($c->$ch) && count(get_object_vars($c)) >= 40) {
        $ch = 'other';
    }
    $d->n = (int) ($d->n ?? 0) + 1;
    $c->$ch = (int) ($c->$ch ?? 0) + 1;
    $d->ch = $c;
    $days = isset($d->d) && $d->d instanceof stdClass ? (array) $d->d : [];
    $day = gmdate('Y-m-d');
    $days[$day] = (int) ($days[$day] ?? 0) + 1;
    ksort($days);
    $d->d = (object) array_slice($days, -60, null, true);
    $d->last = now();
    docSet('ats/x/clicks/' . $id, $d);
}
$id = (string) ($_GET['id'] ?? '');
$id = preg_match('/^[A-Za-z0-9_\-]{1,48}$/', $id) ? $id : '';
// v37.2: a short link by job code (job.php?j=J-1001&s=qr), from the requisition's share panel and its QR code
if ($id === '' && isset($_GET['j'])) {
    $code = strtoupper(substr((string) $_GET['j'], 0, 20));
    if (preg_match('/^[A-Z0-9]{1,6}-\d{1,9}$/', $code)) {
        try {
            $ix = docGet('ats/x/codes/' . $code);
            $hit = $ix ? (string) ($ix->id ?? '') : '';
            $id = preg_match('/^[A-Za-z0-9_\-]{1,48}$/', $hit) ? $hit : '';
        } catch (Throwable $e) {
            $id = '';
        }
    }
}
$src = substr((string) preg_replace('/[^a-z0-9_\-]/', '', strtolower((string) ($_GET['src'] ?? ($_GET['s'] ?? '')))), 0, 24);
$ref = substr((string) preg_replace('/[^A-Za-z0-9]/', '', (string) ($_GET['ref'] ?? '')), 0, 12);
$cfgUrl = (string) cfg('site_url');
if ($cfgUrl !== '') {
    $base = rtrim($cfgUrl, '/') . '/';
} else {
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    $dir = rtrim(str_replace('\\', '/', dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/job.php'))), '/');
    $base = ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $dir . '/';
}
try {
    $job = $id !== '' ? docGet("org/site/jobs/$id") : null;
} catch (Throwable $e) {
    $job = null;
}
$open = $job && ($job->open ?? true) !== false;

// the picture for the card
if (isset($_GET['img'])) {
    foreach (['jpg' => 'image/jpeg', 'png' => 'image/png'] as $ext => $type) {
        $f = rtrim((string) cfg('files_dir'), '/') . '/og/' . $id . '.' . $ext;
        if ($id !== '' && $job && is_file($f)) {
            header('Content-Type: ' . $type);
            header('Cache-Control: public, max-age=86400');
            header('Content-Length: ' . filesize($f));
            readfile($f);
            exit();
        }
    }
    header('Location: ' . $base . 'assets/og-share.png', true, 302);
    exit();
}

$q = array_filter(['src' => $src, 'ref' => $ref], fn($v) => $v !== '');
$target = $base . '#/careers' . ($open ? '/' . $id : '') . ($q ? '?' . http_build_query($q) : '');
$ua = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
$bot = $ua === '' || preg_match('~bot\b|bot/|crawl|spider|slurp|facebookexternalhit|facebot|whatsapp|telegram|slack|discord|skype|linkedin|embedly|pinterest|vkshare|redditbot|applebot|tumblr|bitly|quora|outbrain|google|bingpreview|preview|viber|snapchat|iframely|mastodon|okhttp|curl|wget|python|go-http~i', $ua);
if (!$bot) {
    // v37.2: people who open a role's link are counted per channel for the requisition page (once per address and hour;
    // no address is kept)
    if ($id !== '' && $job) {
        try {
            if (!throttleHit('jclick:' . substr(hash('sha256', clientIp() . '|' . $id), 0, 32), 1, 3600)) {
                jobClickCount($id, $src);
            }
        } catch (Throwable $e) {
            // counting never stops the visit
        }
    }
    header('Cache-Control: no-store');
    header('Location: ' . $target, true, 302);
    exit();
}

$e = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
$cut = function (string $s, int $n): string {
    $s = trim((string) preg_replace('/\s+/', ' ', $s));
    return mb_strlen($s) > $n ? preg_replace('/\s+\S*$/u', '', mb_substr($s, 0, $n)) . '…' : $s;
};
if ($open) {
    $meta = implode(' · ', array_values(array_unique(array_filter([(string) ($job->loc ?? ''), (string) ($job->md ?? ''), (string) ($job->ty ?? ''), (string) ($job->dur ?? '')]))));
    $title = (string) $job->ti . ((string) ($job->loc ?? '') !== '' ? ' · ' . $job->loc : '');
    $desc = $cut(implode('. ', array_values(array_filter([
        $meta,
        (string) ($job->sk ?? '') !== '' ? 'Skills: ' . $job->sk : '',
        (string) ($job->d ?? ''),
    ]))), 280);
    $img = !empty($job->img) ? $base . 'job.php?id=' . rawurlencode($id) . '&img=1&v=' . (int) $job->img : $base . 'assets/og-share.png';
    $canon = $base . 'job.php?id=' . rawurlencode($id);
} else {
    $n = 0;
    try {
        foreach (colAll('org/site/jobs') as [$jid, $j]) {
            if (($j->open ?? true) !== false && empty($j->internal)) {
                $n++;
            }
        }
    } catch (Throwable $x) {
        $n = 0;
    }
    $title = $job ? 'This role has been filled' : 'Open roles at StratEdge IT Consulting';
    $desc = ($n ? $n . ' open ' . ($n === 1 ? 'role' : 'roles') . ': ' : '') . 'contract, contract-to-hire and full-time roles with StratEdge IT Consulting and our clients across the US. Apply in one click.';
    $img = $base . 'assets/og-share.png';
    $canon = $base . 'job.php' . ($id !== '' ? '?id=' . rawurlencode($id) : '');
}
// a JobPosting for search engines (Google for Jobs reads it from the page it crawls)
$ld = null;
if ($open) {
    $types = ['C2C' => 'CONTRACTOR', 'W2' => 'CONTRACTOR', '1099' => 'CONTRACTOR', 'Contract-to-hire' => 'CONTRACTOR', 'Full-time' => 'FULL_TIME', 'SOW' => 'CONTRACTOR', 'Part-time' => 'PART_TIME'];
    $loc = (string) ($job->loc ?? '');
    $parts = array_map('trim', explode(',', $loc));
    $ld = [
        '@context' => 'https://schema.org/',
        '@type' => 'JobPosting',
        'title' => (string) $job->ti,
        'description' => nl2br($e((string) ($job->d ?? '') !== '' ? $job->d : $desc)),
        'datePosted' => date('Y-m-d', (int) (((int) ($job->at ?? 0)) / 1000) ?: time()),
        'employmentType' => $types[(string) ($job->ty ?? '')] ?? 'CONTRACTOR',
        'hiringOrganization' => ['@type' => 'Organization', 'name' => 'StratEdge IT Consulting Inc.', 'sameAs' => rtrim($base, '/'), 'logo' => $base . 'assets/logo-light.png'],
        'directApply' => true,
    ];
    if (($job->md ?? '') === 'Remote') {
        $ld['jobLocationType'] = 'TELECOMMUTE';
        $ld['applicantLocationRequirements'] = ['@type' => 'Country', 'name' => 'USA'];
    }
    if ($loc !== '' && ($job->md ?? '') !== 'Remote') {
        $ld['jobLocation'] = ['@type' => 'Place', 'address' => ['@type' => 'PostalAddress', 'addressLocality' => $parts[0] ?? $loc, 'addressRegion' => $parts[1] ?? '', 'addressCountry' => 'US']];
    }
}
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: public, max-age=300');
// v34: only this page's own redirect line may run (a fresh nonce each time); nothing may frame the page
$nonce = base64_encode(random_bytes(16));
header("Content-Security-Policy: default-src 'none'; script-src 'nonce-$nonce'; style-src 'unsafe-inline'; img-src 'self' https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= $e($title) ?> | StratEdge IT Consulting</title>
<meta name="description" content="<?= $e($desc) ?>">
<link rel="canonical" href="<?= $e($canon) ?>">
<meta property="og:type" content="website">
<meta property="og:site_name" content="StratEdge IT Consulting">
<meta property="og:title" content="<?= $e($title) ?>">
<meta property="og:description" content="<?= $e($desc) ?>">
<meta property="og:url" content="<?= $e($canon) ?>">
<meta property="og:image" content="<?= $e($img) ?>">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="628">
<meta property="og:image:alt" content="<?= $e($title) ?>">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="<?= $e($title) ?>">
<meta name="twitter:description" content="<?= $e($desc) ?>">
<meta name="twitter:image" content="<?= $e($img) ?>">
<?php if ($ld): ?><script type="application/ld+json"><?= json_encode($ld, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG) ?></script>
<?php endif; ?>
</head>
<body style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#1f2a44">
<h1 style="font-size:26px"><?= $e($title) ?></h1>
<p><?= $e($desc) ?></p>
<p><a href="<?= $e($target) ?>" style="color:#2B3993;font-weight:700">View the role and apply</a></p>
<script nonce="<?= $nonce ?>">location.replace(<?= json_encode($target, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG) ?>);</script>
</body>
</html>
