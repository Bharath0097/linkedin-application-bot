<?php
declare(strict_types=1);

const LEVELS = ['view' => 0, 'interact' => 1, 'admin' => 2];
// Who may read and write where. A rule covers its path and everything below it; a deeper rule wins.
// {self} stands for the signed-in person's own id.
const RULES = [
  ['', 'admin', 'admin'],
  ['u', 'admin', 'admin'], ['u/{self}', 'interact', 'interact'],
  ['r', 'admin', 'admin'], ['r/{self}', 'interact', 'admin'],
  ['e', 'admin', 'admin'], ['e/{self}', 'interact', 'interact'],
  ['pub', 'interact', 'interact'],
  ['org', 'interact', 'admin'], ['org/site', 'view', 'admin'], ['org/admin', 'admin', 'admin'],
  ['inbox', 'admin', 'admin'], ['inbox/{self}', 'interact', 'interact'],
  ['rec', 'interact', 'interact'],
  ['sig', 'admin', 'admin'],
  ['inv', 'admin', 'admin'],
  ['exp', 'admin', 'admin'], ['ats', 'admin', 'admin'], ['org/acct', 'admin', 'admin'],
  ['pays', 'admin', 'admin'], ['pays/{self}', 'interact', 'admin'],
  ['log', 'admin', 'admin'], ['geo', 'admin', 'admin'],
];
const MIME = ['pdf' => 'application/pdf', 'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'webp' => 'image/webp', 'gif' => 'image/gif', 'csv' => 'text/csv', 'txt' => 'text/plain',
  'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

function cfg(string $k) { static $c = null; if ($c === null) $c = require __DIR__ . '/config.php'; return $c[$k] ?? null; }
function fail(int $status, string $code, string $msg): never { http_response_code($status); echo json_encode(['error' => $code, 'message' => $msg]); exit; }
function ok($data = []): never { echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); exit; }
function body(): array { static $b = null; if ($b === null) { $raw = file_get_contents('php://input'); $b = $raw === '' ? [] : (json_decode($raw, true) ?: []); } return $b; }
function rid(int $n = 12): string { return bin2hex(random_bytes($n)); }
function now(): int { return (int) round(microtime(true) * 1000); }

/* ---------- database ---------- */
function db(): PDO {
  static $pdo = null;
  if ($pdo) return $pdo;
  $dsn = cfg('dsn');
  if (str_starts_with($dsn, 'sqlite:')) { $f = substr($dsn, 7); $dir = dirname($f); if (!is_dir($dir)) @mkdir($dir, 0775, true); }
  $pdo = new PDO($dsn, cfg('db_user') ?: null, cfg('db_pass') ?: null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
  if (str_starts_with($dsn, 'sqlite:')) { $pdo->exec('PRAGMA busy_timeout=5000'); $pdo->exec('PRAGMA journal_mode=WAL'); }
  $pdo->exec('CREATE TABLE IF NOT EXISTS users (id VARCHAR(40) PRIMARY KEY, email VARCHAR(190) NOT NULL, name VARCHAR(190) NOT NULL, pass VARCHAR(255) NOT NULL, role VARCHAR(16) NOT NULL, status VARCHAR(16) NOT NULL, created BIGINT NOT NULL)');
  $pdo->exec('CREATE TABLE IF NOT EXISTS docs (path VARCHAR(500) PRIMARY KEY, col VARCHAR(400) NOT NULL, data LONGTEXT NOT NULL, seq BIGINT NOT NULL, updated BIGINT NOT NULL)');
  $pdo->exec('CREATE INDEX IF NOT EXISTS docs_col ON docs (col)');
  $pdo->exec('CREATE TABLE IF NOT EXISTS meta (k VARCHAR(32) PRIMARY KEY, v BIGINT NOT NULL)');
  $pdo->exec('CREATE TABLE IF NOT EXISTS throttle (k VARCHAR(190) PRIMARY KEY, n INT NOT NULL, until BIGINT NOT NULL)');
  if (!$pdo->query("SELECT v FROM meta WHERE k='seq'")->fetch()) $pdo->exec("INSERT INTO meta (k, v) VALUES ('seq', 0)");
  if (cfg('admin_email') && cfg('admin_password') && !$pdo->query('SELECT id FROM users LIMIT 1')->fetch()) {
    $pdo->prepare('INSERT INTO users (id, email, name, pass, role, status, created) VALUES (?,?,?,?,?,?,?)')
      ->execute(['u_' . rid(8), strtolower(trim(cfg('admin_email'))), cfg('admin_name') ?: 'Administrator', password_hash(cfg('admin_password'), PASSWORD_DEFAULT), 'admin', 'active', now()]);
  }
  return $pdo;
}
function nextSeq(): int { $p = db(); $p->exec("UPDATE meta SET v = v + 1 WHERE k = 'seq'"); return (int) $p->query("SELECT v FROM meta WHERE k = 'seq'")->fetchColumn(); }

/* ---------- paths & permissions ---------- */
function validPath(string $p, ?bool $doc): bool {
  if ($p === '' || strlen($p) > 1000) return false;
  $segs = explode('/', $p);
  if (count($segs) > 16) return false;
  foreach ($segs as $s) if ($s === '' || $s === '.' || $s === '..' || strlen($s) > 200 || !preg_match('/^[A-Za-z0-9_\-.~:@+]+$/', $s)) return false;
  if ($doc === true && count($segs) % 2 !== 0) return false;
  if ($doc === false && count($segs) % 2 !== 1) return false;
  return true;
}
function userLevel(?array $u): int { return !$u ? 0 : (in_array($u['role'], ['admin', 'hr', 'acct'], true) ? 2 : 1); }
function ruleFor(string $path, ?string $uid): array {
  $segs = $path === '' ? [] : explode('/', $path);
  $best = null; $bestLen = -1;
  foreach (RULES as [$pat, $r, $w]) {
    $ps = $pat === '' ? [] : explode('/', $pat);
    if (count($ps) > count($segs)) continue;
    $ok = true;
    foreach ($ps as $i => $s) {
      if ($s === '{self}') { if ($uid === null || $segs[$i] !== $uid) { $ok = false; break; } }
      elseif ($s !== $segs[$i]) { $ok = false; break; }
    }
    if ($ok && count($ps) > $bestLen) { $best = [$r, $w]; $bestLen = count($ps); }
  }
  return $best ?? ['view', 'interact'];
}
function myR(string $uid): ?stdClass { static $c = []; if (!array_key_exists($uid, $c)) $c[$uid] = docGet("r/$uid"); return $c[$uid]; }
function myCid(string $uid): ?string { $d = myR($uid); return ($d && isset($d->cid) && is_string($d->cid) && $d->cid !== '') ? $d->cid : null; }
// Which portal a person belongs to: 'consultant' (placed consultant), 'employee' (StratEdge staff), 'employer' (client contact),
// 'bench' (StratEdge bench sales recruiter) or '' when unknown.
function portalOf(string $uid): string {
  $d = myR($uid); $role = (string) ($d->role ?? '');
  if ($role === '') { $u = docGet("u/$uid"); $role = (string) ($u->p->role ?? ''); }
  return in_array($role, ['consultant', 'employee', 'employer', 'bench'], true) ? $role : '';
}
// Portal role -> login name (the ?as= value on the login page); login name -> label used in messages.
const PORTAL_NAMES = ['consultant' => 'consultant', 'employee' => 'employee', 'employer' => 'client', 'client' => 'client', 'bench' => 'bench'];
const PORTAL_LABELS = ['consultant' => 'consultant', 'employee' => 'employee', 'client' => 'client', 'bench' => 'bench sales'];
// A bench sales recruiter: approved (active) assignment with the 'bench' portal role. They get the job grabber and the recruiting workspace.
function isBench(string $uid): bool { $d = myR($uid); return (bool) ($d && ($d->st ?? '') === 'active' && ($d->role ?? '') === 'bench'); }
// The recruiting workspace is for StratEdge employees and bench sales recruiters (internal staff), not for placed consultants or client contacts.
function isRecruiter(string $uid): bool { $d = myR($uid); return (bool) ($d && ($d->st ?? '') === 'active' && !in_array($d->role ?? '', ['employer', 'consultant'], true) && empty($d->norec)); }
function isSigner(?stdClass $d, ?string $uid): bool { if (!$d || $uid === null) return false; foreach ((array) ($d->signers ?? []) as $s) if (($s->uid ?? '') === $uid) return true; return false; }
function can(string $path, string $mode): bool {
  $u = currentUser(); $lvl = userLevel($u); $uid = $u['id'] ?? null;
  if ($lvl < 2 && str_starts_with($path, 'sig')) { // signature requests: a signer may read their own; writes go through the signing endpoints
    if ($mode === 'w' || $uid === null) return false;
    $segs = explode('/', $path); if (count($segs) < 2 || $segs[0] !== 'sig') return false;
    return isSigner(docGet("sig/{$segs[1]}"), $uid);
  }
  [$r, $w] = ruleFor($path, $uid);
  if ($lvl < LEVELS[$mode === 'r' ? $r : $w]) return false;
  if ($lvl < 2 && str_starts_with($path, 'pub')) { // client workspaces: only people linked to that client
    $segs = explode('/', $path);
    if (count($segs) < 2 || $uid === null || myCid($uid) !== $segs[1]) return false;
  }
  if ($lvl < 2 && ($path === 'rec' || str_starts_with($path, 'rec/'))) { // recruiting workspace: internal recruiters only
    if ($uid === null || !isRecruiter($uid)) return false;
  }
  return true;
}

/* ---------- documents ---------- */
function docRow(string $path): ?array { $s = db()->prepare('SELECT data, seq FROM docs WHERE path = ?'); $s->execute([$path]); $r = $s->fetch(); return $r ?: null; }
function docGet(string $path): ?stdClass { $r = docRow($path); if (!$r) return null; $d = json_decode($r['data']); return $d instanceof stdClass ? $d : new stdClass(); }
function docSet(string $path, stdClass $data): void {
  $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  if (strlen($json) > 600000) fail(400, 'invalid_argument', 'That record is too large.');
  $col = substr($path, 0, (int) strrpos($path, '/'));
  $p = db(); $p->beginTransaction();
  try { $seq = nextSeq(); $p->prepare('REPLACE INTO docs (path, col, data, seq, updated) VALUES (?,?,?,?,?)')->execute([$path, $col, $json, $seq, now()]); $p->commit(); }
  catch (Throwable $e) { $p->rollBack(); throw $e; }
}
function mergeInto(stdClass $t, stdClass $patch): void {
  foreach (get_object_vars($patch) as $k => $v) {
    if ($v instanceof stdClass && isset($t->$k) && $t->$k instanceof stdClass) mergeInto($t->$k, $v); else $t->$k = $v;
  }
}
function docDelete(string $path): void { $p = db(); $p->beginTransaction(); try { nextSeq(); $p->prepare('DELETE FROM docs WHERE path = ?')->execute([$path]); $p->commit(); } catch (Throwable $e) { $p->rollBack(); throw $e; } }
function colVersion(string $col): string { $s = db()->prepare('SELECT COALESCE(MAX(seq),0) AS m, COUNT(*) AS c FROM docs WHERE col = ?'); $s->execute([$col]); $r = $s->fetch(); return $r['m'] . '-' . $r['c']; }
function colList(string $col, ?string $orderBy, string $dir, int $limit): array {
  $s = db()->prepare('SELECT path, data FROM docs WHERE col = ?'); $s->execute([$col]);
  $out = [];
  while ($r = $s->fetch()) { if (!can($r['path'], 'r')) continue; $d = json_decode($r['data']); if (!($d instanceof stdClass)) $d = new stdClass(); $out[] = [substr($r['path'], strrpos($r['path'], '/') + 1), $d]; }
  if ($orderBy !== null && $orderBy !== '') {
    $f = $orderBy; $desc = $dir === 'desc';
    usort($out, function ($a, $b) use ($f, $desc) {
      $x = $a[1]->$f ?? null; $y = $b[1]->$f ?? null;
      if ($x === null && $y === null) return strcmp($a[0], $b[0]); if ($x === null) return 1; if ($y === null) return -1;
      $c = is_numeric($x) && is_numeric($y) ? ($x <=> $y) : strcmp((string) $x, (string) $y);
      return $desc ? -$c : $c;
    });
  } else usort($out, fn($a, $b) => strcmp($a[0], $b[0]));
  if ($limit > 0) $out = array_slice($out, 0, $limit);
  return $out;
}

/* ---------- users & sessions ---------- */
function currentUser(): ?array {
  static $u = false;
  if ($u !== false) return $u;
  $u = null;
  if (!empty($_SESSION['uid'])) {
    $s = db()->prepare('SELECT id, email, name, role, status FROM users WHERE id = ?'); $s->execute([$_SESSION['uid']]); $r = $s->fetch();
    if ($r && $r['status'] === 'active') $u = $r; else unset($_SESSION['uid']);
  }
  return $u;
}
function requireUser(): array { $u = currentUser(); if (!$u) fail(401, 'unauthenticated', 'Log in to continue.'); return $u; }
function requireAdmin(): array { $u = requireUser(); if (userLevel($u) < 2) fail(403, 'invalid_argument', 'Staff access is required.'); return $u; }
function publicUser(array $u): array { return ['id' => $u['id'], 'name' => $u['name'], 'email' => $u['email'], 'role' => $u['role'], 'status' => $u['status']]; }
function throttleHit(string $key, int $max, int $windowSec): bool { // true when over the limit
  $p = db(); $t = now(); $s = $p->prepare('SELECT n, until FROM throttle WHERE k = ?'); $s->execute([$key]); $r = $s->fetch();
  if (!$r || (int) $r['until'] < $t) { $p->prepare('REPLACE INTO throttle (k, n, until) VALUES (?,?,?)')->execute([$key, 1, $t + $windowSec * 1000]); return false; }
  $p->prepare('UPDATE throttle SET n = n + 1 WHERE k = ?')->execute([$key]);
  return (int) $r['n'] + 1 > $max;
}
function throttleClear(string $key): void { db()->prepare('DELETE FROM throttle WHERE k = ?')->execute([$key]); }
function clientIp(): string { return (string) ($_SERVER['REMOTE_ADDR'] ?? '0'); }
function str(array $src, string $k, int $max = 500): string { $v = $src[$k] ?? ''; if (!is_string($v)) $v = is_scalar($v) ? (string) $v : ''; return mb_substr(trim($v), 0, $max); }
function tempPassword(): string { $chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'; $o = ''; for ($i = 0; $i < 10; $i++) $o .= $chars[random_int(0, strlen($chars) - 1)]; return $o; }

/* ---------- files ---------- */
function storeUpload(array $f, string $base, array $meta): array {
  if (($f['error'] ?? 1) !== UPLOAD_ERR_OK) fail(400, 'invalid_argument', $f['error'] === UPLOAD_ERR_INI_SIZE || $f['error'] === UPLOAD_ERR_FORM_SIZE ? 'That file is too large.' : 'The upload did not complete. Try again.');
  $name = mb_substr(basename((string) $f['name']), 0, 180); $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
  if (!isset(MIME[$ext])) fail(400, 'invalid_argument', 'Upload a PDF, image, Excel (.xlsx), Word (.docx), CSV or text file.');
  $max = (int) cfg('max_upload_mb') * 1048576; $size = (int) $f['size'];
  if ($size <= 0) fail(400, 'invalid_argument', 'That file is empty.');
  if ($size > $max) fail(400, 'too_large', 'That file is larger than ' . cfg('max_upload_mb') . ' MB.');
  $dir = cfg('files_dir'); if (!is_dir($dir)) @mkdir($dir, 0775, true);
  $fid = rid(16);
  if (!move_uploaded_file($f['tmp_name'], "$dir/$fid")) fail(500, 'unavailable', 'The server could not store the file. Check that the storage folder is writable.');
  $doc = (object) ['n' => $name, 'ty' => MIME[$ext], 'sz' => $size, 'at' => now()];
  foreach (['c', 'w'] as $k) if (isset($meta[$k]) && is_string($meta[$k])) $doc->$k = mb_substr($meta[$k], 0, 60);
  docSet("$base/f/$fid", $doc);
  $a = (array) $doc; $a['id'] = $fid; return $a;
}

/* ---------- email ---------- */
function siteUrl(): string {
  $c = (string) cfg('site_url'); if ($c !== '') return rtrim($c, '/') . '/';
  $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
  $dir = rtrim(dirname(dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/api/index.php'))), '/');
  return ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $dir . '/';
}
function mailLog(string $line): void { @error_log(date('c') . ' ' . $line . "\n", 3, dirname(__DIR__) . '/storage/mail.log'); }
function emailHtml(string $title, array $paras, ?array $button = null, string $foot = ''): string {
  $p = implode('', array_map(fn($x) => '<p style="margin:0 0 14px;font:15px/1.55 Arial,Helvetica,sans-serif;color:#1f2a44">' . nl2br(htmlspecialchars($x)) . '</p>', $paras));
  $b = $button ? '<p style="margin:22px 0"><a href="' . htmlspecialchars($button[1]) . '" style="display:inline-block;background:#2B3993;color:#fff;text-decoration:none;font:700 15px Arial,Helvetica,sans-serif;padding:13px 22px;border-radius:10px">' . htmlspecialchars($button[0]) . '</a></p><p style="font:12px/1.5 Arial,sans-serif;color:#7a87a6;word-break:break-all">Or open this link: ' . htmlspecialchars($button[1]) . '</p>' : '';
  return '<!doctype html><html><body style="margin:0;background:#f4f7fa;padding:24px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="600" style="max-width:600px;background:#fff;border-radius:16px;border:1px solid #dce3ec" cellspacing="0" cellpadding="0"><tr><td style="padding:26px 30px 10px"><div style="font:800 20px Arial,Helvetica,sans-serif;color:#2B3993">StratEdge <span style="color:#0E849A">IT Consulting</span></div></td></tr><tr><td style="padding:10px 30px 26px"><h1 style="margin:0 0 16px;font:800 22px/1.25 Arial,Helvetica,sans-serif;color:#101b35">' . htmlspecialchars($title) . '</h1>' . $p . $b . '</td></tr><tr><td style="padding:16px 30px;border-top:1px solid #dce3ec;font:12px/1.5 Arial,sans-serif;color:#7a87a6">StratEdge IT Consulting Inc. · 1553 Route 27, Suite 1000, Somerset, NJ 08873 · +1 (302) 434-8889 · info@stratedgeitconsulting.com' . ($foot !== '' ? '<br>' . htmlspecialchars($foot) : '') . '</td></tr></table></td></tr></table></body></html>';
}
function buildMime(string $fromName, string $from, string $to, string $toName, string $subject, string $text, string $html, array $atts, string $replyTo = '', string $cc = ''): array {
  $enc = fn($s) => '=?UTF-8?B?' . base64_encode($s) . '?=';
  $b1 = 'alt' . bin2hex(random_bytes(8)); $b2 = 'mix' . bin2hex(random_bytes(8));
  $headers = "From: " . $enc($fromName) . " <$from>\r\nTo: " . ($toName !== '' ? $enc($toName) . " <$to>" : $to) . "\r\n" . ($cc !== '' ? "Cc: $cc\r\n" : '') . ($replyTo !== '' ? "Reply-To: $replyTo\r\n" : '') . "Subject: " . $enc($subject) . "\r\nMIME-Version: 1.0\r\nDate: " . date('r') . "\r\nMessage-ID: <" . bin2hex(random_bytes(10)) . "@" . ($_SERVER['HTTP_HOST'] ?? 'localhost') . ">\r\n";
  $alt = "--$b1\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n" . quoted_printable_encode($text) . "\r\n--$b1\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($html)) . "\r\n--$b1--\r\n";
  if (!$atts) return [$headers . "Content-Type: multipart/alternative; boundary=\"$b1\"\r\n", $alt];
  $body = "--$b2\r\nContent-Type: multipart/alternative; boundary=\"$b1\"\r\n\r\n$alt";
  foreach ($atts as $a) $body .= "--$b2\r\nContent-Type: " . $a['type'] . "; name=\"" . $a['name'] . "\"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=\"" . $a['name'] . "\"\r\n\r\n" . chunk_split(base64_encode($a['data'])) . "\r\n";
  return [$headers . "Content-Type: multipart/mixed; boundary=\"$b2\"\r\n", $body . "--$b2--\r\n"];
}
function smtpSend(string $from, array $rcpts, string $raw): bool {
  $host = (string) cfg('smtp_host'); $port = (int) (cfg('smtp_port') ?: 587); $secure = (string) (cfg('smtp_secure') ?: 'tls');
  $fp = @stream_socket_client(($secure === 'ssl' ? 'ssl://' : 'tcp://') . "$host:$port", $errno, $errstr, 20); if (!$fp) { mailLog("smtp connect failed: $errstr"); return false; }
  stream_set_timeout($fp, 20);
  $read = function () use ($fp) { $out = ''; while (($l = fgets($fp, 1024)) !== false) { $out .= $l; if (strlen($l) < 4 || $l[3] !== '-') break; } return $out; };
  $cmd = function (string $c) use ($fp, $read) { fwrite($fp, $c . "\r\n"); return $read(); };
  $ok = fn($r, $code) => str_starts_with($r, (string) $code);
  $r = $read(); if (!$ok($r, 220)) { fclose($fp); mailLog("smtp greeting: $r"); return false; }
  $r = $cmd('EHLO ' . ($_SERVER['HTTP_HOST'] ?? 'localhost'));
  if ($secure === 'tls') { $r = $cmd('STARTTLS'); if (!$ok($r, 220) || !stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) { fclose($fp); mailLog("smtp starttls: $r"); return false; } $r = $cmd('EHLO ' . ($_SERVER['HTTP_HOST'] ?? 'localhost')); }
  if ((string) cfg('smtp_user') !== '') { $cmd('AUTH LOGIN'); $cmd(base64_encode((string) cfg('smtp_user'))); $r = $cmd(base64_encode((string) cfg('smtp_pass'))); if (!$ok($r, 235)) { fclose($fp); mailLog("smtp auth: $r"); return false; } }
  $r = $cmd("MAIL FROM:<$from>"); if (!$ok($r, 250)) { fclose($fp); mailLog("smtp from: $r"); return false; }
  foreach ($rcpts as $to) { $r = $cmd("RCPT TO:<$to>"); if (!$ok($r, 250) && !$ok($r, 251)) { fclose($fp); mailLog("smtp rcpt $to: $r"); return false; } }
  $r = $cmd('DATA'); if (!$ok($r, 354)) { fclose($fp); return false; }
  $r = $cmd(preg_replace('/^\./m', '..', $raw) . "\r\n."); if (!$ok($r, 250)) { fclose($fp); mailLog("smtp data: $r"); return false; }
  $cmd('QUIT'); fclose($fp); return true;
}
function sendMail(string $to, string $toName, string $subject, string $text, string $html, array $atts = [], string $replyTo = '', string $cc = ''): bool {
  if (!filter_var($to, FILTER_VALIDATE_EMAIL)) return false;
  $from = (string) (cfg('mail_from') ?: 'no-reply@' . preg_replace('/^www\./', '', (string) ($_SERVER['HTTP_HOST'] ?? 'localhost'))); $fromName = (string) (cfg('mail_from_name') ?: 'StratEdge IT Consulting');
  [$headers, $body] = buildMime($fromName, $from, $to, $toName, $subject, $text, $html, $atts, $replyTo, $cc);
  $rcpts = array_values(array_filter(array_merge([$to], array_map('trim', explode(',', $cc))), fn($x) => filter_var($x, FILTER_VALIDATE_EMAIL)));
  if ((string) cfg('mail_transport') === 'smtp' && (string) cfg('smtp_host') !== '') { $ok = smtpSend($from, $rcpts, $headers . "\r\n" . $body); }
  else { $ok = @mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, preg_replace('/^(To|Subject):.*\r\n/m', '', $headers)); }
  mailLog(($ok ? 'sent' : 'FAILED') . " to $to: $subject");
  return (bool) $ok;
}
function tokenAllows(string $path, string $tok): bool {
  if ($tok === '' || !preg_match('/^[a-f0-9]{32}$/', $tok)) return false;
  $segs = explode('/', $path); if (count($segs) < 2) return false;
  if ($segs[0] === 'sig') { $d = docGet("sig/{$segs[1]}"); if (!$d) return false; foreach ((array) ($d->signers ?? []) as $s) if (($s->tok ?? '') === $tok) return true; return false; }
  if ($segs[0] === 'inv') { $d = docGet("inv/{$segs[1]}"); return $d && ($d->tok ?? '') === $tok; }
  return false;
}
function invNext(): string { $p = db(); $y = date('Y'); $k = "inv$y"; $p->beginTransaction(); try { if (!$p->query("SELECT v FROM meta WHERE k='$k'")->fetch()) $p->exec("INSERT INTO meta (k, v) VALUES ('$k', 0)"); $p->exec("UPDATE meta SET v = v + 1 WHERE k = '$k'"); $n = (int) $p->query("SELECT v FROM meta WHERE k = '$k'")->fetchColumn(); $p->commit(); } catch (Throwable $e) { $p->rollBack(); throw $e; } return sprintf('INV-%s-%04d', $y, $n); }
function money(float $n, string $cur): string { return ($cur === 'INR' ? '₹' : ($cur === 'USD' ? '$' : $cur . ' ')) . number_format($n, 2); }

/* ---------- e-signature helpers ---------- */
function sigIndexByTok(stdClass $d, string $tok): int { if ($tok === '') return -1; foreach ((array) $d->signers as $i => $s) if (($s->tok ?? '') === $tok) return $i; return -1; }
function sigActor(stdClass $d, array $src): ?array {
  $tok = (string) ($src['tok'] ?? ''); if ($tok !== '') { $i = sigIndexByTok($d, $tok); return $i >= 0 ? ['i' => $i, 'n' => $d->signers[$i]->n] : null; }
  $u = currentUser(); if (!$u) return null; foreach ((array) $d->signers as $i => $s) if (($s->uid ?? '') === $u['id']) return ['i' => $i, 'n' => $u['name']]; return null;
}
function sigNotify(stdClass $d, string $id, int $i, bool $remind = false): bool {
  $signers = (array) $d->signers; if (!isset($signers[$i])) return false; $s = $signers[$i]; $s = is_array($s) ? (object) $s : $s;
  $link = !empty($s->tok) ? siteUrl() . '#/sign/' . $id . '/' . $s->tok : siteUrl() . '#/portal/sign';
  $title = ($remind ? 'Reminder: ' : '') . 'Please sign: ' . $d->ti;
  $paras = ["{$d->byn} at StratEdge IT Consulting sent you \"{$d->ti}\" to sign electronically." . (!empty($d->due) ? " It is due by {$d->due}." : ''), !empty($d->msg) ? $d->msg : '', !empty($s->tok) ? 'No account is needed: open the link, review the document, and sign on screen.' : 'Log in to your StratEdge portal and open "Sign documents".'];
  $ok = sendMail((string) $s->e, (string) $s->n, $title, "{$d->byn} sent you \"{$d->ti}\" to sign.\n\n" . (!empty($d->msg) ? $d->msg . "\n\n" : '') . "Review and sign: $link", emailHtml($title, array_values(array_filter($paras)), ['Review and sign', $link]), [], (string) ($d->bye ?? ''));
  $log = (array) ($d->log ?? []); $log[] = (object) ['t' => now(), 'who' => 'System', 'ev' => ($ok ? 'Signing request emailed to ' : 'Email could not be sent to ') . $s->e, 'ip' => '']; $d->log = $log;
  return $ok;
}
function sigComplete(stdClass $d, string $id): void {
  $pdf = @file_get_contents(cfg('files_dir') . '/' . $d->sfid); if ($pdf === false) return;
  $att = [['name' => (string) ($d->sfn ?? 'signed.pdf'), 'type' => 'application/pdf', 'data' => $pdf]];
  $sent = [];
  foreach ((array) $d->signers as $s) { if (!empty($s->e) && !isset($sent[$s->e])) { $sent[$s->e] = 1; sendMail((string) $s->e, (string) $s->n, 'Signed copy: ' . $d->ti, "All parties have signed \"{$d->ti}\". The signed copy is attached.", emailHtml('Signed: ' . $d->ti, ["All parties have signed \"{$d->ti}\". The signed PDF, with a signature certificate for each signer, is attached for your records."]), $att); } }
  if (!empty($d->bye) && !isset($sent[$d->bye])) sendMail((string) $d->bye, (string) $d->byn, 'Signed copy: ' . $d->ti, "All parties have signed \"{$d->ti}\". The signed copy is attached.", emailHtml('Signed: ' . $d->ti, ["All parties have signed \"{$d->ti}\". The signed PDF is attached and the request is marked complete in the admin portal."]), $att);
  $log = (array) ($d->log ?? []); $log[] = (object) ['t' => now(), 'who' => 'System', 'ev' => 'Signed copy emailed to all parties', 'ip' => '']; $d->log = $log;
}
function invMirror(stdClass $d, string $id): stdClass {
  $m = clone $d; unset($m->log); $m->id = $id; return $m;
}

/* ---------- sign-in activity ---------- */
function geoLookup(string $ip): ?array {
  if (!cfg('geo_lookup')) return null;
  if ($ip === '' || $ip === '0' || $ip === '127.0.0.1' || $ip === '::1' || preg_match('/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fc|fd|fe80)/i', $ip)) return ['city' => '', 'region' => '', 'country' => '', 'label' => 'Local network'];
  $key = 'geo/' . preg_replace('/[^a-z0-9]/i', '_', $ip); $c = docGet($key);
  if ($c && (now() - (int) ($c->t ?? 0)) < 7 * 86400 * 1000) return (array) $c->g;
  $ctx = stream_context_create(['http' => ['timeout' => 2.5, 'ignore_errors' => true]]);
  $raw = @file_get_contents('http://ip-api.com/json/' . rawurlencode($ip) . '?fields=status,country,regionName,city,lat,lon,isp,timezone', false, $ctx);
  $j = $raw ? json_decode($raw, true) : null;
  if (!is_array($j) || ($j['status'] ?? '') !== 'success') return null;
  $g = ['city' => (string) ($j['city'] ?? ''), 'region' => (string) ($j['regionName'] ?? ''), 'country' => (string) ($j['country'] ?? ''), 'lat' => $j['lat'] ?? null, 'lng' => $j['lon'] ?? null, 'isp' => (string) ($j['isp'] ?? ''), 'tz' => (string) ($j['timezone'] ?? '')];
  $g['label'] = implode(', ', array_values(array_filter([$g['city'], $g['region'], $g['country']])));
  docSet($key, (object) ['t' => now(), 'g' => $g]); return $g;
}
function recordLogin(array $u, string $how): string {
  $ip = clientIp(); $ua = mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 240); $now = now(); $id = rid(6);
  $rec = (object) ['t' => $now, 'ip' => $ip, 'ua' => $ua, 'how' => $how, 'geo' => geoLookup($ip)];
  docSet("log/{$u['id']}/items/$id", $rec);
  $d = docGet("log/{$u['id']}") ?? (object) ['n' => 0];
  $d->n = (int) ($d->n ?? 0) + 1; $d->last = $rec; $d->lastId = $id; $d->seen = $now; $d->name = $u['name']; $d->email = $u['email']; $d->role = $u['role'];
  docSet("log/{$u['id']}", $d); $_SESSION['login_id'] = $id; $_SESSION['seen'] = $now;
  return $id;
}
function touchSeen(?array $u): void {
  if (!$u) return; $now = now(); if ((int) ($_SESSION['seen'] ?? 0) > $now - 300000) return;
  $_SESSION['seen'] = $now; $d = docGet("log/{$u['id']}"); if ($d) { $d->seen = $now; docSet("log/{$u['id']}", $d); }
}
