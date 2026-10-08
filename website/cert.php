<?php
/*
  v32: share links for certificates and StratEdge certifications: cert.php?no=<number>&code=<code>. LinkedIn,
  Facebook, X, WhatsApp and the rest read the credential's title from this page (they do not run the website's
  script); people are sent on to the public verification page (#/verify), which checks the number and code.
*/
declare(strict_types=1);
require __DIR__ . '/api/lib.php';
// v37: on a company workspace the page carries the company's name (StratEdge's own site is unchanged)
if (wsSlug() !== '') {
    ob_start(fn(string $out): string => wsBrandText($out, true));
}

$no = substr((string) preg_replace('/[^A-Z0-9\-]/', '', strtoupper((string) ($_GET['no'] ?? ''))), 0, 30);
$code = substr((string) preg_replace('/[^a-z0-9]/', '', strtolower((string) ($_GET['code'] ?? ''))), 0, 20);
$cfgUrl = (string) cfg('site_url');
if ($cfgUrl !== '') {
    $base = rtrim($cfgUrl, '/') . '/';
} else {
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    $dir = rtrim(str_replace('\\', '/', dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/cert.php'))), '/');
    $base = ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $dir . '/';
}
$cert = null;
if ($no !== '' && $code !== '') {
    try {
        $s = db()->prepare("SELECT data FROM docs WHERE path LIKE 'learn/%/certs/%'");
        $s->execute();
        while ($row = $s->fetch()) {
            $d = json_decode($row['data']);
            if ($d && ($d->no ?? '') === $no && ($d->code ?? '') === $code) {
                $cert = $d;
                break;
            }
        }
    } catch (Throwable $e) {
        $cert = null;
    }
}
$target = $base . '#/verify' . ($no !== '' ? '?' . http_build_query(['no' => $no, 'code' => $code]) : '');
$ua = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
$bot = $ua === '' || preg_match('~bot\b|bot/|crawl|spider|slurp|facebookexternalhit|facebot|whatsapp|telegram|slack|discord|skype|linkedin|embedly|pinterest|vkshare|redditbot|applebot|tumblr|bitly|quora|outbrain|google|bingpreview|preview|viber|snapchat|iframely|mastodon|okhttp|curl|wget|python|go-http~i', $ua);
if (!$bot) {
    header('Cache-Control: no-store');
    header('Location: ' . $target, true, 302);
    exit();
}
$e = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
$org = (string) (cfg('site_name') ?: 'StratEdge IT Consulting');
if ($cert) {
    $prog = ($cert->kind ?? '') === 'prog';
    $exp = (int) ($cert->exp ?? 0);
    $title = (string) ($cert->n ?? 'A participant') . ($prog ? ' is certified: ' : ' completed ') . (string) ($cert->t ?? '') . ($prog && !empty($cert->level) ? ' (' . $cert->level . ')' : '');
    $skills = array_slice(array_map('strval', (array) ($cert->skills ?? [])), 0, 8);
    $desc = ($prog ? 'A ' . $org . ' certification' : 'A ' . $org . ' course certificate') . ', issued ' . date('F j, Y', (int) (((int) ($cert->at ?? 0)) / 1000)) . ($exp > 0 ? ($exp < now() ? ' (expired ' : ' (valid until ') . date('F j, Y', (int) ($exp / 1000)) . ')' : '') . '.' . ($skills ? ' Covers ' . implode(', ', $skills) . '.' : '') . ' Certificate ' . $no . ': check it on the verification page.';
} else {
    $title = 'Verify a ' . $org . ' certificate';
    $desc = 'Certificates and certifications from ' . $org . ' carry a number and a code that anyone can check here.';
}
$img = $base . 'assets/og-cert.png';
$canon = $base . 'cert.php' . ($no !== '' ? '?' . http_build_query(['no' => $no, 'code' => $code]) : '');
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
<meta name="robots" content="noindex">
<title><?= $e($title) ?> | <?= $e($org) ?></title>
<meta name="description" content="<?= $e($desc) ?>">
<link rel="canonical" href="<?= $e($canon) ?>">
<meta property="og:type" content="website">
<meta property="og:site_name" content="<?= $e($org) ?>">
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
</head>
<body style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#1f2a44">
<h1 style="font-size:26px"><?= $e($title) ?></h1>
<p><?= $e($desc) ?></p>
<p><a href="<?= $e($target) ?>" style="color:#2B3993;font-weight:700">Verify this certificate</a></p>
<script nonce="<?= $nonce ?>">location.replace(<?= json_encode($target, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG) ?>);</script>
</body>
</html>
