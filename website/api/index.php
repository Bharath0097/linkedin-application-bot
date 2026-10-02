<?php
declare(strict_types=1);
require __DIR__ . '/lib.php';
error_reporting(E_ALL); ini_set('display_errors', '0');
set_exception_handler(function (Throwable $e) {
  @error_log(date('c') . ' ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine() . "\n", 3, dirname(__DIR__) . '/storage/error.log');
  http_response_code(500); header('Content-Type: application/json'); echo json_encode(['error' => 'unavailable', 'message' => 'The server hit a problem. Try again in a moment.']); exit;
});
header('X-Content-Type-Options: nosniff'); header('Cache-Control: no-store'); header('Referrer-Policy: same-origin');
$secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax', 'secure' => $secure]);
session_name(cfg('session_name') ?: 'stratedge_portal');
session_start();
$r = (string) ($_GET['r'] ?? '');
$method = $_SERVER['REQUEST_METHOD'];
if ($method === 'POST' && ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'fetch') fail(403, 'bad_request', 'Rejected request.');
if ($r !== 'file') header('Content-Type: application/json; charset=utf-8');
$b = $method === 'POST' ? body() : [];

switch ($r) {
  /* ---------- accounts ---------- */
  case 'me': { $u = currentUser(); ok(['user' => $u ? publicUser($u) : null, 'portal' => $u ? portalOf($u['id']) : '', 'jobs' => jobsUrl() !== '']); }
  case 'register': {
    if (throttleHit('reg:' . clientIp(), 20, 3600)) fail(429, 'rate_limited', 'Too many sign-ups from this network. Try again later.');
    $name = str($b, 'name', 120); $email = strtolower(str($b, 'email', 190)); $pass = (string) ($b['password'] ?? '');
    if (mb_strlen($name) < 2) fail(400, 'invalid_argument', 'Add your full name.');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail(400, 'invalid_argument', 'Enter a valid email address.');
    if (strlen($pass) < 8) fail(400, 'invalid_argument', 'Use a password of at least 8 characters.');
    $p = db(); $s = $p->prepare('SELECT id FROM users WHERE email = ?'); $s->execute([$email]);
    if ($s->fetch()) fail(409, 'invalid_argument', 'An account with that email already exists. Log in instead.');
    $first = !$p->query('SELECT id FROM users LIMIT 1')->fetch();
    $id = 'u_' . rid(8);
    $p->prepare('INSERT INTO users (id, email, name, pass, role, status, created) VALUES (?,?,?,?,?,?,?)')->execute([$id, $email, $name, password_hash($pass, PASSWORD_DEFAULT), $first ? 'admin' : 'user', 'active', now()]);
    session_regenerate_id(true); $_SESSION['uid'] = $id;
    recordLogin(['id' => $id, 'name' => $name, 'email' => $email, 'role' => $first ? 'admin' : 'user'], 'register');
    ok(['user' => ['id' => $id, 'name' => $name, 'email' => $email, 'role' => $first ? 'admin' : 'user', 'status' => 'active'], 'first' => $first]);
  }
  case 'login': {
    $email = strtolower(str($b, 'email', 190)); $pass = (string) ($b['password'] ?? '');
    if (throttleHit('login:' . $email, 10, 900) || throttleHit('loginip:' . clientIp(), 60, 900)) fail(429, 'rate_limited', 'Too many attempts. Wait 15 minutes and try again.');
    $s = db()->prepare('SELECT * FROM users WHERE email = ?'); $s->execute([$email]); $u = $s->fetch();
    if (!$u || !password_verify($pass, $u['pass'])) fail(401, 'invalid_login', 'That email and password don\'t match.');
    if ($u['status'] !== 'active') fail(403, 'disabled', 'This account is paused. Contact StratEdge HR.');
    throttleClear('login:' . $email);
    // Separate logins: the consultant, employee and client login pages only accept accounts that belong to that portal.
    // StratEdge staff (admin, HR, accounting) can sign in from any of them; accounts without a profile yet are not restricted.
    $as = str($b, 'as', 12); $portal = portalOf($u['id']); $staff = in_array($u['role'], ['admin', 'hr', 'acct'], true);
    if (!$staff && isset(PORTAL_NAMES[$as]) && $portal !== '' && PORTAL_NAMES[$portal] !== PORTAL_NAMES[$as]) {
      $want = PORTAL_NAMES[$portal]; http_response_code(403);
      echo json_encode(['error' => 'wrong_portal', 'portal' => $want, 'message' => 'This account belongs to the ' . $want . ' portal. Use the ' . $want . ' login instead.']); exit;
    }
    if (password_needs_rehash($u['pass'], PASSWORD_DEFAULT)) db()->prepare('UPDATE users SET pass = ? WHERE id = ?')->execute([password_hash($pass, PASSWORD_DEFAULT), $u['id']]);
    session_regenerate_id(true); $_SESSION['uid'] = $u['id'];
    recordLogin($u, 'password' . ($as !== '' ? ':' . $as : ''));
    ok(['user' => publicUser($u), 'portal' => $portal]);
  }
  case 'logout': { $lu = currentUser(); if ($lu) { $lid = rid(6); $lrec = (object) ['t' => now(), 'ip' => clientIp(), 'ua' => mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 240), 'how' => 'logout', 'geo' => geoLookup(clientIp())]; docSet("log/{$lu['id']}/items/$lid", $lrec); $ld = docGet("log/{$lu['id']}"); if ($ld) { $ld->seen = now(); $ld->out = $lrec; docSet("log/{$lu['id']}", $ld); } }
    $_SESSION = []; if (ini_get('session.use_cookies')) { $c = session_get_cookie_params(); setcookie(session_name(), '', time() - 42000, $c['path'], $c['domain'], $c['secure'], $c['httponly']); } session_destroy(); ok(['ok' => true]); }
  case 'password': {
    $u = requireUser(); $cur = (string) ($b['current'] ?? ''); $new = (string) ($b['new'] ?? '');
    $s = db()->prepare('SELECT pass FROM users WHERE id = ?'); $s->execute([$u['id']]);
    if (!password_verify($cur, (string) $s->fetchColumn())) fail(400, 'invalid_argument', 'Your current password is not correct.');
    if (strlen($new) < 8) fail(400, 'invalid_argument', 'Use a new password of at least 8 characters.');
    db()->prepare('UPDATE users SET pass = ? WHERE id = ?')->execute([password_hash($new, PASSWORD_DEFAULT), $u['id']]);
    ok(['ok' => true]);
  }
  case 'profiles': {
    requireUser(); $ids = array_values(array_filter(array_slice((array) ($b['ids'] ?? []), 0, 300), fn($x) => is_string($x) && $x !== ''));
    $out = [];
    if ($ids) { $q = implode(',', array_fill(0, count($ids), '?')); $s = db()->prepare("SELECT id, name FROM users WHERE id IN ($q)"); $s->execute($ids); while ($row = $s->fetch()) $out[$row['id']] = ['name' => $row['name']]; }
    ok(['profiles' => $out]);
  }

  /* ---------- documents ---------- */
  case 'doc': {
    $path = (string) ($_GET['path'] ?? ''); if (!validPath($path, true)) fail(400, 'invalid_argument', 'Bad path.');
    if (!can($path, 'r')) ok(['e' => false, 'd' => null, 'v' => 'x']);
    $row = docRow($path); ok($row ? ['e' => true, 'd' => json_decode($row['data']), 'v' => (string) $row['seq']] : ['e' => false, 'd' => null, 'v' => 'x']);
  }
  case 'col': {
    $path = (string) ($_GET['path'] ?? ''); if (!validPath($path, false)) fail(400, 'invalid_argument', 'Bad path.');
    ok(['v' => colVersion($path), 'docs' => colList($path, $_GET['o'] ?? null, (string) ($_GET['d'] ?? 'asc'), (int) ($_GET['l'] ?? 0))]);
  }
  case 'batch': {
    touchSeen(currentUser());
    $qs = array_slice((array) ($b['q'] ?? []), 0, 60); $res = [];
    foreach ($qs as $q) {
      $p = (string) ($q['p'] ?? ''); $t = (string) ($q['t'] ?? ''); $v = isset($q['v']) ? (string) $q['v'] : null;
      if ($t === 'doc') {
        if (!validPath($p, true)) { $res[] = ['err' => 'Bad path.']; continue; }
        if (!can($p, 'r')) { $res[] = $v === 'x' ? ['v' => 'x', 'same' => true] : ['v' => 'x', 'e' => false, 'd' => null]; continue; }
        $row = docRow($p); $nv = $row ? (string) $row['seq'] : 'x';
        $res[] = $nv === $v ? ['v' => $nv, 'same' => true] : ($row ? ['v' => $nv, 'e' => true, 'd' => json_decode($row['data'])] : ['v' => 'x', 'e' => false, 'd' => null]);
      } elseif ($t === 'col') {
        if (!validPath($p, false)) { $res[] = ['err' => 'Bad path.']; continue; }
        $nv = colVersion($p);
        $res[] = $nv === $v ? ['v' => $nv, 'same' => true] : ['v' => $nv, 'docs' => colList($p, isset($q['o']) ? (string) $q['o'] : null, (string) ($q['d'] ?? 'asc'), (int) ($q['l'] ?? 0))];
      } else $res[] = ['err' => 'Bad query.'];
    }
    ok(['r' => $res]);
  }
  case 'set': case 'update': {
    requireUser(); $path = (string) ($b['path'] ?? ''); if (!validPath($path, true)) fail(400, 'invalid_argument', 'Bad path.');
    if (!can($path, 'w')) fail(403, 'invalid_argument', 'You can\'t change this record.');
    $data = json_decode(json_encode($b['data'] ?? null)); if (!($data instanceof stdClass)) fail(400, 'invalid_argument', 'Bad data.');
    if ($r === 'update') { $cur = docGet($path); if (!$cur) fail(400, 'invalid_argument', 'That record does not exist yet.'); mergeInto($cur, $data); $data = $cur; }
    docSet($path, $data); ok(['ok' => true]);
  }
  case 'delete': {
    requireUser(); $path = (string) ($b['path'] ?? ''); if (!validPath($path, true)) fail(400, 'invalid_argument', 'Bad path.');
    if (!can($path, 'w')) fail(403, 'invalid_argument', 'You can\'t delete this record.');
    docDelete($path); ok(['ok' => true]);
  }

  /* ---------- files ---------- */
  case 'upload': {
    requireUser(); $base = (string) ($_POST['base'] ?? ''); if (!validPath($base, true)) fail(400, 'invalid_argument', 'Bad path.');
    if (!can("$base/f/x", 'w')) fail(403, 'invalid_argument', 'You can\'t upload here.');
    if (!isset($_FILES['file'])) fail(400, 'invalid_argument', 'No file received.');
    $meta = json_decode((string) ($_POST['meta'] ?? '{}'), true); if (!is_array($meta)) $meta = [];
    ok(['doc' => storeUpload($_FILES['file'], $base, $meta)]);
  }
  case 'file': {
    $base = (string) ($_GET['base'] ?? ''); $id = (string) ($_GET['id'] ?? '');
    if (!validPath($base, true) || !preg_match('/^[a-f0-9]{32}$/', $id)) { http_response_code(404); exit('Not found'); }
    $path = "$base/f/$id";
    if (!can($path, 'r') && !tokenAllows($path, (string) ($_GET['tok'] ?? ''))) { http_response_code(404); exit('Not found'); }
    $d = docGet($path); $f = cfg('files_dir') . "/$id";
    if (!$d || !is_file($f)) { http_response_code(404); exit('Not found'); }
    $name = preg_replace('/[^A-Za-z0-9 ._()\-]/', '_', (string) ($d->n ?? 'file'));
    header('Content-Type: ' . ($d->ty ?? 'application/octet-stream')); header('Content-Length: ' . filesize($f));
    header('Content-Disposition: ' . (($_GET['dl'] ?? '') === '1' ? 'attachment' : 'inline') . '; filename="' . $name . '"');
    header('Cache-Control: private, max-age=300'); readfile($f); exit;
  }
  case 'delfile': {
    requireUser(); $base = (string) ($b['base'] ?? ''); $id = (string) ($b['id'] ?? '');
    if (!validPath($base, true) || !preg_match('/^[a-f0-9]{32}$/', $id)) fail(400, 'invalid_argument', 'Bad path.');
    $path = "$base/f/$id"; if (!can($path, 'w')) fail(403, 'invalid_argument', 'You can\'t delete this file.');
    docDelete($path); $f = cfg('files_dir') . "/$id"; if (is_file($f)) @unlink($f);
    ok(['ok' => true]);
  }

  /* ---------- website forms (no login needed) ---------- */
  case 'public_contact': {
    if (throttleHit('form:' . clientIp(), (int) (cfg('public_forms_per_hour') ?: 20), 3600)) fail(429, 'rate_limited', 'Too many messages from this network. Email us instead.');
    $src = $_POST; $kind = in_array(str($src, 'k', 10), ['apply', 'talent'], true) ? str($src, 'k', 10) : 'contact';
    $m = ['k' => $kind, 'n' => str($src, 'n', 120), 'e' => strtolower(str($src, 'e', 190)), 'ph' => str($src, 'ph', 40), 'co' => str($src, 'co', 120), 'sv' => str($src, 'sv', 80), 'msg' => str($src, 'msg', 4000), 'job' => str($src, 'job', 60), 'jt' => str($src, 'jt', 160), 'li' => str($src, 'li', 300), 'at' => now(), 'fid' => null];
    if ($m['n'] === '' || !filter_var($m['e'], FILTER_VALIDATE_EMAIL)) fail(400, 'invalid_argument', 'Add your name and a valid email.');
    $u = currentUser(); if ($u) $m['uid'] = $u['id'];
    $id = rid(6);
    if ($kind === 'apply') {
      $aid = rid(6); $rf = null;
      if (isset($_FILES['file']) && ($_FILES['file']['error'] ?? 1) !== UPLOAD_ERR_NO_FILE) { $rf = storeUpload($_FILES['file'], "ats/$aid", ['c' => 'resume']); $m['fid'] = $rf['id']; $m['ats'] = $aid; }
      docSet("ats/$aid", (object) ['n' => $m['n'], 'e' => $m['e'], 'ph' => $m['ph'], 'job' => $m['job'], 'jt' => $m['jt'], 'li' => $m['li'], 'msg' => $m['msg'], 'src' => 'Website', 'st' => 'new', 'rating' => 0, 'notes' => [], 'rid' => $rf ? $rf['id'] : null, 'rn' => $rf ? $rf['n'] : null, 'at' => now(), 'u' => now(), 'log' => [['t' => now(), 'who' => 'Website', 'ev' => 'Applied' . ($m['jt'] !== '' ? ' for ' . $m['jt'] : '')]]]);
    } elseif (isset($_FILES['file']) && ($_FILES['file']['error'] ?? 1) !== UPLOAD_ERR_NO_FILE) { $doc = storeUpload($_FILES['file'], 'inbox/public', ['c' => 'resume']); $m['fid'] = $doc['id']; }
    $cur = docGet('inbox/public') ?? new stdClass(); if (!isset($cur->m) || !($cur->m instanceof stdClass)) $cur->m = new stdClass();
    $cur->m->$id = (object) $m; docSet('inbox/public', $cur);
    ok(['ok' => true]);
  }

  /* ---------- website assistant ---------- */
  case 'chat': {
    if (throttleHit('chat:' . clientIp(), (int) (cfg('ai_messages_per_hour') ?: 40), 3600)) fail(429, 'rate_limited', 'That is a lot of questions for one hour. Email info@stratedgeitconsulting.com and a person will take it from here.');
    $kb = require __DIR__ . '/knowledge.php';
    $msgs = [];
    foreach (array_slice((array) ($b['messages'] ?? []), -12) as $m) {
      $role = ($m['role'] ?? '') === 'assistant' ? 'assistant' : 'user'; $c = mb_substr(trim((string) ($m['content'] ?? '')), 0, 1500);
      if ($c !== '') $msgs[] = ['role' => $role, 'content' => $c];
    }
    if (!$msgs || end($msgs)['role'] !== 'user') fail(400, 'invalid_argument', 'Send a message.');
    $last = end($msgs)['content'];
    $key = (string) cfg('ai_api_key');
    if ($key !== '') {
      $system = "You are the StratEdge assistant, the website assistant for StratEdge IT Consulting. Be warm, concise (under 120 words unless asked for detail) and specific. Answer general questions helpfully too. Use the facts below for anything about StratEdge; never invent prices, guarantees, client names or availability, and when unsure say so and point to info@stratedgeitconsulting.com or +1 (302) 434-8889. Plain text only, no markdown.

FACTS:
" . $kb['facts'];
      $payload = json_encode(['model' => cfg('ai_model') ?: 'claude-sonnet-5-5', 'max_tokens' => 500, 'system' => $system, 'messages' => $msgs]);
      $resp = null;
      if (function_exists('curl_init')) {
        $ch = curl_init('https://api.anthropic.com/v1/messages');
        curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $payload, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30,
          CURLOPT_HTTPHEADER => ['content-type: application/json', 'x-api-key: ' . $key, 'anthropic-version: 2023-06-01']]);
        $resp = curl_exec($ch); curl_close($ch);
      } else {
        $ctx = stream_context_create(['http' => ['method' => 'POST', 'header' => "content-type: application/json
x-api-key: $key
anthropic-version: 2023-06-01
", 'content' => $payload, 'timeout' => 30, 'ignore_errors' => true]]);
        $resp = @file_get_contents('https://api.anthropic.com/v1/messages', false, $ctx);
      }
      $j = $resp ? json_decode($resp, true) : null;
      $text = '';
      foreach ((array) ($j['content'] ?? []) as $blk) if (($blk['type'] ?? '') === 'text') $text .= $blk['text'];
      if (trim($text) !== '') ok(['reply' => trim($text), 'source' => 'ai']);
      @error_log(date('c') . " assistant: AI call failed, used knowledge base
", 3, dirname(__DIR__) . '/storage/error.log');
    }
    $q = mb_strtolower($last); $best = null; $bestScore = 0;
    foreach ($kb['intents'] as $in) { $sc = 0; foreach ($in['keys'] as $k) if (str_contains($q, $k)) $sc += strlen($k); if ($sc > $bestScore) { $bestScore = $sc; $best = $in; } }
    ok(['reply' => $best ? $best['a'] : $kb['default'], 'source' => 'kb', 'suggestions' => $kb['suggestions']]);
  }

  /* ---------- e-signatures (portal members and external email signers) ---------- */
  case 'sig_create': {
    $me = requireAdmin(); $ti = str($_POST, 'ti', 160); $msg = str($_POST, 'msg', 2000); $due = str($_POST, 'due', 10);
    $raw = json_decode((string) ($_POST['signers'] ?? '[]'), true); if (!is_array($raw)) $raw = [];
    if ($ti === '' || !$raw) fail(400, 'invalid_argument', 'Add a title and at least one signer.');
    if (!isset($_FILES['file'])) fail(400, 'invalid_argument', 'Attach the document to sign (PDF, PNG or JPG).');
    $ext = strtolower(pathinfo((string) $_FILES['file']['name'], PATHINFO_EXTENSION)); if (!in_array($ext, ['pdf', 'png', 'jpg', 'jpeg'], true)) fail(400, 'invalid_argument', 'Documents to sign must be PDF, PNG or JPG. Save Word files as PDF first.');
    $signers = []; $seen = [];
    foreach (array_slice($raw, 0, 6) as $x) {
      if (!is_array($x)) continue;
      if (!empty($x['uid']) && preg_match('/^u_[a-f0-9]+$/', (string) $x['uid'])) { $st = db()->prepare('SELECT id, name, email FROM users WHERE id = ?'); $st->execute([$x['uid']]); $u = $st->fetch(); if (!$u) fail(400, 'invalid_argument', 'One of the signers does not have an account.'); if (isset($seen[$u['id']])) continue; $seen[$u['id']] = 1; $signers[] = ['uid' => $u['id'], 'n' => $u['name'], 'e' => $u['email'], 'st' => 'pending', 'role' => $u['id'] === $me['id'] ? 'countersign' : 'signer']; }
      else { $n = mb_substr(trim((string) ($x['n'] ?? '')), 0, 120); $e = strtolower(trim((string) ($x['e'] ?? ''))); if ($n === '' || !filter_var($e, FILTER_VALIDATE_EMAIL)) fail(400, 'invalid_argument', 'External signers need a name and a valid email.'); if (isset($seen[$e])) continue; $seen[$e] = 1; $signers[] = ['n' => $n, 'e' => $e, 'st' => 'pending', 'role' => 'signer', 'tok' => rid(16), 'ext' => true]; }
    }
    if (!$signers) fail(400, 'invalid_argument', 'Add at least one signer.');
    if (($_POST['counter'] ?? '') === '1' && !isset($seen[$me['id']])) $signers[] = ['uid' => $me['id'], 'n' => $me['name'], 'e' => $me['email'], 'st' => 'pending', 'role' => 'countersign'];
    $id = rid(6); $base = "sig/$id"; $now = now();
    $f = storeUpload($_FILES['file'], $base, ['c' => 'original']); $hash = hash_file('sha256', cfg('files_dir') . '/' . $f['id']);
    $d = (object) ['ti' => $ti, 'msg' => $msg, 'due' => $due, 'by' => $me['id'], 'byn' => $me['name'], 'bye' => $me['email'], 'at' => $now, 'st' => 'sent', 'cur' => 0, 'fid' => $f['id'], 'fn' => $f['n'], 'fty' => $f['ty'], 'fh' => $hash, 'signers' => $signers, 'log' => [['t' => $now, 'who' => $me['name'], 'ev' => 'Sent for signature', 'ip' => clientIp()]]];
    sigNotify($d, $id, 0); docSet($base, $d);
    ok(['id' => $id]);
  }
  case 'sig_public_get': {
    $id = str($_GET, 'id', 20); $tok = str($_GET, 'tok', 40); $d = docGet("sig/$id"); $i = $d ? sigIndexByTok($d, $tok) : -1;
    if ($i < 0) fail(404, 'not_found', 'This signing link is not valid.');
    $pub = ['id' => $id, 'ti' => $d->ti, 'msg' => $d->msg ?? '', 'byn' => $d->byn, 'at' => $d->at, 'due' => $d->due ?? '', 'st' => $d->st, 'cur' => $d->cur ?? 0, 'fid' => $d->fid, 'fn' => $d->fn, 'fty' => $d->fty, 'fh' => $d->fh ?? '', 'sfid' => $d->sfid ?? null, 'done' => $d->done ?? null, 'me' => $i,
      'signers' => array_map(fn($s) => ['n' => $s->n, 'st' => $s->st, 'role' => $s->role ?? 'signer'], (array) $d->signers)];
    ok(['d' => $pub]);
  }
  case 'sig_viewed': {
    $id = str($b, 'id', 20); $d = docGet("sig/$id"); if (!$d) fail(404, 'not_found', 'No such request.');
    $who = sigActor($d, $b); if (!$who) fail(404, 'not_found', 'No such request.');
    $log = (array) $d->log; $last = end($log); if (!$last || ($last->who ?? '') !== $who['n'] || ($last->ev ?? '') !== 'Viewed the document') { $log[] = (object) ['t' => now(), 'who' => $who['n'], 'ev' => 'Viewed the document', 'ip' => clientIp()]; $d->log = $log; docSet("sig/$id", $d); }
    ok(['ok' => true]);
  }
  case 'sig_sign': {
    $id = str($_POST, 'id', 20); $d = docGet("sig/$id"); if (!$d) fail(404, 'not_found', 'No such request.');
    $who = sigActor($d, $_POST); if (!$who) fail(404, 'not_found', 'No such request.');
    if (($d->st ?? '') !== 'sent') fail(400, 'invalid_argument', 'This request is no longer open for signing.');
    $signers = (array) $d->signers; $i = (int) ($d->cur ?? 0); if (!isset($signers[$i]) || $i !== $who['i']) fail(400, 'invalid_argument', 'It is not your turn to sign yet.');
    if (($_POST['consent'] ?? '') !== '1') fail(400, 'invalid_argument', 'Please confirm that you agree to sign electronically.');
    $name = str($_POST, 'name', 120); if ($name === '') fail(400, 'invalid_argument', 'Type your full name as your signature.');
    if (!isset($_FILES['file']) || strtolower(pathinfo((string) $_FILES['file']['name'], PATHINFO_EXTENSION)) !== 'pdf') fail(400, 'invalid_argument', 'The signed copy did not come through. Try again.');
    $base = "sig/$id"; $f = storeUpload($_FILES['file'], $base, ['c' => 'signed']); $now = now();
    $signers[$i]->st = 'signed'; $signers[$i]->at = $now; $signers[$i]->ip = clientIp(); $signers[$i]->ua = mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 200); $signers[$i]->typed = $name; $signers[$i]->sfid = $f['id']; $signers[$i]->sh = hash_file('sha256', cfg('files_dir') . '/' . $f['id']);
    $d->signers = $signers; $d->cur = $i + 1; $d->sfid = $f['id']; $d->sfn = $f['n'];
    $log = (array) $d->log; $log[] = (object) ['t' => $now, 'who' => $who['n'], 'ev' => 'Signed as "' . $name . '"', 'ip' => clientIp()];
    if ($d->cur >= count($signers)) { $d->st = 'completed'; $d->done = $now; $log[] = (object) ['t' => $now, 'who' => 'System', 'ev' => 'All signatures collected', 'ip' => '']; $d->log = $log; sigComplete($d, $id); }
    else { $d->log = $log; sigNotify($d, $id, $d->cur); }
    docSet($base, $d); ok(['st' => $d->st]);
  }
  case 'sig_decline': {
    $id = str($b, 'id', 20); $d = docGet("sig/$id"); if (!$d) fail(404, 'not_found', 'No such request.');
    $who = sigActor($d, $b); if (!$who) fail(404, 'not_found', 'No such request.');
    if (($d->st ?? '') !== 'sent') fail(400, 'invalid_argument', 'This request is no longer open.');
    $reason = str($b, 'reason', 500); $signers = (array) $d->signers; $signers[$who['i']]->st = 'declined'; $signers[$who['i']]->at = now(); $signers[$who['i']]->reason = $reason;
    $d->signers = $signers; $d->st = 'declined'; $log = (array) $d->log; $log[] = (object) ['t' => now(), 'who' => $who['n'], 'ev' => 'Declined to sign' . ($reason !== '' ? ': ' . $reason : ''), 'ip' => clientIp()]; $d->log = $log; docSet("sig/$id", $d);
    if (!empty($d->bye)) sendMail($d->bye, $d->byn, 'Declined: ' . $d->ti, "{$who['n']} declined to sign \"{$d->ti}\"." . ($reason !== '' ? "\nReason: $reason" : ''), emailHtml('Signature declined', ["{$who['n']} declined to sign \"{$d->ti}\"." . ($reason !== '' ? " Reason: $reason" : '')], ['Open in the admin portal', siteUrl() . '#/portal/admin/esign']));
    ok(['ok' => true]);
  }
  case 'sig_cancel': {
    $me = requireAdmin(); $id = str($b, 'id', 20); $d = docGet("sig/$id"); if (!$d) fail(404, 'not_found', 'No such request.');
    $d->st = 'cancelled'; $log = (array) $d->log; $log[] = (object) ['t' => now(), 'who' => $me['name'], 'ev' => 'Cancelled the request', 'ip' => clientIp()]; $d->log = $log; docSet("sig/$id", $d); ok(['ok' => true]);
  }
  case 'sig_remind': {
    $me = requireAdmin(); $id = str($b, 'id', 20); $d = docGet("sig/$id"); if (!$d || ($d->st ?? '') !== 'sent') fail(400, 'invalid_argument', 'Only open requests can be resent.');
    $sent = sigNotify($d, $id, (int) ($d->cur ?? 0), true); $log = (array) $d->log; $log[] = (object) ['t' => now(), 'who' => $me['name'], 'ev' => $sent ? 'Reminder emailed' : 'Reminder attempted (email not delivered)', 'ip' => clientIp()]; $d->log = $log; docSet("sig/$id", $d); ok(['mailed' => $sent]);
  }

  /* ---------- clock and break punches: server time, network address and location ---------- */
  case 'punch': {
    $u = requireUser(); $ev = str($b, 'ev', 4); if (!in_array($ev, ['in', 'out', 'bi', 'bo'], true)) fail(400, 'invalid_argument', 'Bad punch.');
    $pos = null; if (isset($b['pos']) && is_array($b['pos'])) { $lat = (float) ($b['pos']['lat'] ?? 0); $lng = (float) ($b['pos']['lng'] ?? 0); if ($lat >= -90 && $lat <= 90 && $lng >= -180 && $lng <= 180 && !($lat === 0.0 && $lng === 0.0)) $pos = ['lat' => round($lat, 5), 'lng' => round($lng, 5), 'acc' => (int) ($b['pos']['acc'] ?? 0)]; }
    $posErr = $pos ? '' : str($b, 'posErr', 20);
    $ip = clientIp(); $geo = geoLookup($ip); $now = now(); $id = rid(6);
    $rec = (object) ['t' => $now, 'ip' => $ip, 'ua' => mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 240), 'how' => 'punch', 'ev' => $ev, 'geo' => $geo, 'pos' => $pos ? (object) $pos : null, 'posErr' => $posErr];
    docSet("log/{$u['id']}/items/$id", $rec);
    $d = docGet("log/{$u['id']}") ?? (object) ['n' => 0, 'name' => $u['name'], 'email' => $u['email'], 'role' => $u['role']]; $d->seen = $now; $d->lastEv = $rec; docSet("log/{$u['id']}", $d);
    ok(['t' => $now, 'ip' => $ip, 'g' => $geo ? ($geo['label'] ?? '') : '', 'pos' => $pos, 'posErr' => $posErr]);
  }

  /* ---------- precise sign-in location (browser geolocation, with the person's permission) ---------- */
  case 'login_geo': {
    $u = requireUser(); $lat = (float) ($b['lat'] ?? 0); $lng = (float) ($b['lng'] ?? 0); $acc = (int) ($b['acc'] ?? 0); $posErr = str($b, 'posErr', 20);
    $has = ($lat >= -90 && $lat <= 90 && $lng >= -180 && $lng <= 180) && !($lat === 0.0 && $lng === 0.0);
    if (!$has && $posErr === '') fail(400, 'invalid_argument', 'Bad coordinates.');
    $lid = (string) ($_SESSION['login_id'] ?? ''); if ($lid === '') ok(['ok' => false]);
    $pos = $has ? ['lat' => round($lat, 5), 'lng' => round($lng, 5), 'acc' => $acc, 't' => now()] : null;
    $rec = docGet("log/{$u['id']}/items/$lid"); if ($rec) { if ($pos) { $rec->pos = (object) $pos; $rec->posErr = ''; } elseif (empty($rec->pos)) $rec->posErr = $posErr; docSet("log/{$u['id']}/items/$lid", $rec); }
    $d = docGet("log/{$u['id']}"); if ($d && ($d->lastId ?? '') === $lid) { if ($pos) { $d->last->pos = (object) $pos; $d->last->posErr = ''; } elseif (empty($d->last->pos)) $d->last->posErr = $posErr; docSet("log/{$u['id']}", $d); }
    ok(['ok' => true]);
  }

  /* ---------- ATS and payroll email ---------- */
  case 'ats_email': {
    $me = requireAdmin(); $id = str($b, 'id', 20); $d = docGet("ats/$id"); if (!$d) fail(404, 'not_found', 'No such candidate.');
    $subject = str($b, 'subject', 200); $body = str($b, 'body', 6000); if ($subject === '' || $body === '') fail(400, 'invalid_argument', 'Add a subject and a message.');
    $ok = sendMail((string) $d->e, (string) $d->n, $subject, $body, emailHtml($subject, preg_split('/\n{2,}/', $body)), [], (string) $me['email']);
    $log = (array) ($d->log ?? []); $log[] = (object) ['t' => now(), 'who' => $me['name'], 'ev' => ($ok ? 'Emailed: ' : 'Email failed: ') . $subject]; $d->log = $log; $d->u = now(); docSet("ats/$id", $d);
    ok(['mailed' => $ok]);
  }
  case 'pay_email': {
    $me = requireAdmin(); $path = str($_POST, 'path', 120); if (!preg_match('#^pays/(u_[a-f0-9]+)/items/([0-9]{4}-[0-9]{2})$#', $path, $mm)) fail(400, 'invalid_argument', 'Bad paystub path.');
    $d = docGet($path); if (!$d) fail(404, 'not_found', 'Finalize the payroll run first.');
    if (!isset($_FILES['file']) || strtolower(pathinfo((string) $_FILES['file']['name'], PATHINFO_EXTENSION)) !== 'pdf') fail(400, 'invalid_argument', 'The paystub PDF did not come through.');
    $st = db()->prepare('SELECT name, email FROM users WHERE id = ?'); $st->execute([$mm[1]]); $u = $st->fetch(); if (!$u) fail(404, 'not_found', 'No such employee.');
    $f = storeUpload($_FILES['file'], $path, ['c' => 'paystub']);
    $ok = sendMail($u['email'], $u['name'], 'Your paystub for ' . $mm[2], "Your paystub for {$mm[2]} is attached. You can also download it from the Earnings page in your portal.", emailHtml('Paystub: ' . $mm[2], ["Your paystub for {$mm[2]} is attached as a PDF. It is also available under Earnings in your StratEdge portal."], ['Open your portal', siteUrl() . '#/portal/pay']), [['name' => $f['n'], 'type' => 'application/pdf', 'data' => file_get_contents(cfg('files_dir') . '/' . $f['id'])]], (string) $me['email']);
    $d->fid = $f['id']; $d->fn = $f['n']; $d->emailed = $ok ? now() : ($d->emailed ?? null); $d->u = now(); docSet($path, $d);
    ok(['mailed' => $ok]);
  }

  /* ---------- invoices ---------- */
  case 'inv_next': { requireAdmin(); ok(['num' => invNext()]); }
  case 'inv_send': {
    $me = requireAdmin(); $id = str($_POST, 'id', 20); $d = docGet("inv/$id"); if (!$d) fail(404, 'not_found', 'No such invoice.');
    if (!isset($_FILES['file']) || strtolower(pathinfo((string) $_FILES['file']['name'], PATHINFO_EXTENSION)) !== 'pdf') fail(400, 'invalid_argument', 'The invoice PDF did not come through.');
    $to = strtolower(str($_POST, 'to', 190)); if (!filter_var($to, FILTER_VALIDATE_EMAIL)) fail(400, 'invalid_argument', 'Enter a valid email address to send the invoice to.');
    $cc = str($_POST, 'cc', 300); $note = str($_POST, 'note', 2000);
    $f = storeUpload($_FILES['file'], "inv/$id", ['c' => 'invoice']); $now = now();
    if (empty($d->tok)) $d->tok = rid(16);
    $d->fid = $f['id']; $d->fn = $f['n']; $d->to = $to; $d->cc = $cc; if (($d->st ?? 'draft') === 'draft') $d->st = 'sent'; $d->sentAt = $now; $d->u = $now;
    $link = siteUrl() . '#/invoice/' . $id . '/' . $d->tok; $amt = money((float) ($d->total ?? 0), (string) ($d->cur ?? 'USD'));
    $paras = ["Please find invoice {$d->num} from StratEdge IT Consulting for $amt, due " . ($d->due ?? '') . '.', $note !== '' ? $note : '', 'The PDF is attached. You can also view and download it online.'];
    $ok = sendMail($to, (string) ($d->bill->n ?? ''), "Invoice {$d->num} from StratEdge IT Consulting ($amt)", "Invoice {$d->num} for $amt, due {$d->due}.\n$note\n\nView online: $link", emailHtml("Invoice {$d->num}", array_values(array_filter($paras)), ['View invoice', $link], 'Questions about this invoice? Reply to this email.'), [['name' => $f['n'], 'type' => 'application/pdf', 'data' => file_get_contents(cfg('files_dir') . '/' . $f['id'])]], (string) $me['email'], $cc);
    $log = (array) ($d->log ?? []); $log[] = (object) ['t' => $now, 'who' => $me['name'], 'ev' => ($ok ? 'Emailed to ' : 'Email failed to ') . $to . ($cc !== '' ? " (cc $cc)" : ''), 'ip' => clientIp()]; $d->log = $log;
    docSet("inv/$id", $d); if (!empty($d->cid)) docSet("pub/{$d->cid}/inv/$id", invMirror($d, $id));
    ok(['mailed' => $ok, 'link' => $link]);
  }
  case 'inv_public_get': {
    $id = str($_GET, 'id', 20); $tok = str($_GET, 'tok', 40); $d = docGet("inv/$id"); if (!$d || empty($d->tok) || $d->tok !== $tok) fail(404, 'not_found', 'This invoice link is not valid.');
    if (($d->st ?? '') === 'sent') { $d->st = 'viewed'; $d->viewedAt = now(); $log = (array) ($d->log ?? []); $log[] = (object) ['t' => now(), 'who' => (string) ($d->bill->n ?? 'Recipient'), 'ev' => 'Viewed the invoice online', 'ip' => clientIp()]; $d->log = $log; docSet("inv/$id", $d); if (!empty($d->cid)) docSet("pub/{$d->cid}/inv/$id", invMirror($d, $id)); }
    ok(['d' => invMirror($d, $id)]);
  }

  /* ---------- end-of-day report: share by email too ---------- */
  case 'eod_notify': {
    $u = requireUser(); $to = array_values(array_filter(array_map('trim', explode(',', (string) cfg('eod_emails'))), fn($x) => filter_var($x, FILTER_VALIDATE_EMAIL)));
    $subject = 'EOD report: ' . $u['name'] . ' ' . str($b, 'date', 20); $text = str($b, 'text', 6000);
    $sent = false;
    if ($to && $text !== '') { $from = (string) (cfg('mail_from') ?: 'no-reply@' . ($_SERVER['SERVER_NAME'] ?? 'localhost')); $sent = @mail(implode(',', $to), $subject, $text, "From: $from\r\nReply-To: " . $u['email'] . "\r\nContent-Type: text/plain; charset=UTF-8"); }
    ok(['mailed' => (bool) $sent, 'recipients' => count($to)]);
  }

  /* ---------- job portals: resume matching for consultants, portal accounts and scrape runs for staff ---------- */
  case 'jobs_me': { $u = requireUser(); ok(jobsCall('GET', '/consultants/' . rawurlencode($u['id']))); }
  case 'jobs_prefs': {
    $u = requireUser(); $root = docGet("u/{$u['id']}"); $prof = $root->p ?? null;
    $r = jobsCall('PUT', '/consultants/' . rawurlencode($u['id']), ['name' => $u['name'], 'email' => $u['email'], 'prefs' => jobsPrefs(is_array($b['prefs'] ?? null) ? $b['prefs'] : [], $prof)]);
    ok($r);
  }
  case 'jobs_resume': {
    $u = requireUser(); if (!isset($_FILES['file']) || ($_FILES['file']['error'] ?? 1) !== UPLOAD_ERR_OK) fail(400, 'invalid_argument', 'Choose your resume (PDF, Word or text).');
    $name = mb_substr(basename((string) $_FILES['file']['name']), 0, 180); $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    if (!in_array($ext, ['pdf', 'docx', 'txt'], true)) fail(400, 'invalid_argument', 'Upload your resume as PDF, Word (.docx) or plain text.');
    $copy = tempnam(sys_get_temp_dir(), 'resume'); if (!copy($_FILES['file']['tmp_name'], $copy)) fail(500, 'unavailable', 'The server could not read the upload.');
    try { $r = jobsCall('POST', '/consultants/' . rawurlencode($u['id']) . '/resume', null, ['tmp' => $copy, 'type' => MIME[$ext], 'name' => $name], 120); } finally { @unlink($copy); }
    $doc = storeUpload($_FILES['file'], "u/{$u['id']}", ['c' => 'resume']);
    $root = docGet("u/{$u['id']}") ?? new stdClass(); $root->resume = (object) ['fid' => $doc['id'], 'n' => $doc['n'], 'at' => now()]; docSet("u/{$u['id']}", $root);
    ok(['doc' => $doc, 'consultant' => $r['consultant'] ?? null, 'matches' => (int) ($r['matches'] ?? 0)]);
  }
  case 'jobs_matches': { $u = requireUser(); $st = str($_GET, 'state', 12); ok(jobsCall('GET', '/consultants/' . rawurlencode($u['id']) . '/matches' . ($st !== '' ? '?state=' . rawurlencode($st) : ''))); }
  case 'jobs_mark': {
    $u = requireUser(); $jid = (int) ($b['job_id'] ?? 0); $st = str($b, 'state', 12);
    if ($jid <= 0 || !in_array($st, ['new', 'saved', 'applied', 'dismissed'], true)) fail(400, 'invalid_argument', 'Bad job or state.');
    ok(jobsCall('POST', '/consultants/' . rawurlencode($u['id']) . "/matches/$jid", ['state' => $st]));
  }
  case 'jobs_rematch': { $u = requireUser(); ok(jobsCall('POST', '/consultants/' . rawurlencode($u['id']) . '/rematch')); }
  case 'jobs_job': { requireUser(); ok(jobsCall('GET', '/jobs/' . (int) ($_GET['id'] ?? 0))); }
  case 'jobs_admin': {
    $me = requireAdmin(); $src = $method === 'POST' ? $b : $_GET; $op = str($src, 'op', 20);
    switch ($op) {
      case 'overview': ok(jobsCall('GET', '/overview'));
      case 'portals': ok(jobsCall('GET', '/portals'));
      case 'account_add': ok(jobsCall('POST', '/portals/accounts', ['portal' => str($b, 'portal', 20), 'label' => str($b, 'label', 80), 'username' => str($b, 'username', 190), 'password' => (string) ($b['password'] ?? ''), 'enabled' => !isset($b['enabled']) || !empty($b['enabled'])]));
      case 'account_update': {
        $patch = []; foreach (['label', 'username'] as $k) if (array_key_exists($k, $b)) $patch[$k] = str($b, $k, 190);
        if (isset($b['password']) && $b['password'] !== '') $patch['password'] = (string) $b['password'];
        if (array_key_exists('enabled', $b)) $patch['enabled'] = (bool) $b['enabled'];
        ok(jobsCall('PATCH', '/portals/accounts/' . (int) ($b['id'] ?? 0), $patch));
      }
      case 'account_delete': ok(jobsCall('DELETE', '/portals/accounts/' . (int) ($b['id'] ?? 0)));
      case 'account_test': ok(jobsCall('POST', '/portals/accounts/' . (int) ($b['id'] ?? 0) . '/test', null, null, 240));
      case 'runs': ok(jobsCall('GET', '/runs?limit=' . max(1, min(100, (int) ($_GET['limit'] ?? 20)))));
      case 'run': ok(jobsCall('POST', '/runs', ['portals' => array_values(array_filter((array) ($b['portals'] ?? []), 'is_string')), 'uids' => [], 'trigger' => 'portal:' . $me['name']]));
      case 'jobs': ok(jobsCall('GET', '/jobs?' . http_build_query(['q' => str($_GET, 'q', 120), 'portal' => str($_GET, 'portal', 20), 'limit' => 100, 'offset' => max(0, (int) ($_GET['offset'] ?? 0))])));
      case 'consultants': ok(jobsCall('GET', '/consultants'));
      /* Job grabber: log in through a portal from the admin page (with a verification code when the site asks), grab jobs by keyword, publish to Careers */
      case 'status': ok(jobsCall('GET', '/portals/status'));
      case 'login_start': ok(jobsCall('POST', '/portals/accounts/' . (int) ($b['id'] ?? 0) . '/login'));
      case 'login_status': ok(jobsCall('GET', '/portals/accounts/' . (int) ($_GET['id'] ?? 0) . '/login'));
      case 'login_code': ok(jobsCall('POST', '/portals/accounts/' . (int) ($b['id'] ?? 0) . '/login/code', ['code' => str($b, 'code', 20)]));
      case 'logout': ok(jobsCall('POST', '/portals/accounts/' . (int) ($b['id'] ?? 0) . '/logout'));
      case 'grab': {
        $kws = array_values(array_filter(array_map(fn($x) => is_scalar($x) ? mb_substr(trim((string) $x), 0, 80) : '', (array) ($b['keywords'] ?? [])), fn($x) => $x !== ''));
        ok(jobsCall('POST', '/grab', ['keywords' => $kws, 'location' => str($b, 'location', 80), 'remote' => str($b, 'remote', 10), 'posted_days' => (int) ($b['posted_days'] ?? 7),
          'portals' => array_values(array_filter((array) ($b['portals'] ?? []), 'is_string')), 'trigger' => 'grab:' . $me['name']]));
      }
      case 'run_jobs': ok(jobsCall('GET', '/runs/' . (int) ($_GET['id'] ?? 0) . '/jobs'));
      case 'publish': {
        $jid = (int) ($b['job_id'] ?? 0); $j = jobsCall('GET', "/jobs/$jid")['job'] ?? null; if (!$j) fail(404, 'not_found', 'No such job.');
        $id = 'g' . $jid; $cur = docGet("org/site/jobs/$id");
        $remote = strtolower((string) ($j['remote'] ?? '')); $md = str_contains($remote, 'remote') ? 'Remote' : (str_contains($remote, 'hybrid') ? 'Hybrid' : 'Onsite');
        $ty = ''; foreach (['C2C', 'W2', '1099', 'Contract-to-hire', 'Contract', 'Full-time', 'Part-time'] as $t) if (stripos((string) ($j['job_type'] ?? ''), $t) !== false) { $ty = $t; break; }
        $desc = trim((string) ($j['description'] ?? '')); if ($desc === '') $desc = trim((string) ($j['summary'] ?? ''));
        $doc = (object) ['ti' => mb_substr((string) $j['title'], 0, 160), 'loc' => mb_substr((string) ($j['location'] ?? ''), 0, 120), 'ty' => $ty !== '' ? ($ty === 'Contract' ? 'C2C' : $ty) : 'C2C', 'md' => $md,
          'sk' => implode(', ', array_slice((array) ($j['skills'] ?? []), 0, 8)), 'd' => mb_substr($desc, 0, 4000), 'open' => true, 'at' => $cur->at ?? now(), 'by' => $me['id'],
          'src' => (object) ['portal' => $j['portal'], 'url' => $j['url'], 'company' => $j['company'] ?? '', 'job_id' => $jid]];
        if ($cur) foreach (['ti', 'loc', 'ty', 'md', 'sk', 'd', 'open'] as $k) if (isset($cur->$k) && ($b['overwrite'] ?? false) !== true) $doc->$k = $cur->$k;
        docSet("org/site/jobs/$id", $doc); jobsCall('PATCH', "/jobs/$jid", ['published' => true]);
        ok(['id' => $id, 'job' => $doc]);
      }
      case 'unpublish': { $jid = (int) ($b['job_id'] ?? 0); if (docGet("org/site/jobs/g$jid")) docDelete("org/site/jobs/g$jid"); jobsCall('PATCH', "/jobs/$jid", ['published' => false]); ok(['ok' => true]); }
      case 'matches': ok(jobsCall('GET', '/consultants/' . rawurlencode(str($_GET, 'uid', 40)) . '/matches'));
      default: fail(400, 'invalid_argument', 'Unknown job-portal action.');
    }
  }

  /* ---------- admin ---------- */
  case 'admin_users': { requireAdmin(); $rows = db()->query('SELECT id, email, name, role, status, created FROM users ORDER BY created')->fetchAll(); ok(['users' => $rows]); }
  case 'admin_role': {
    $me = requireAdmin(); if ($me['role'] !== 'admin') fail(403, 'invalid_argument', 'Only an administrator can change staff access.');
    $uid = str($b, 'uid', 40); $role = in_array(str($b, 'role', 10), ['admin', 'hr', 'acct'], true) ? str($b, 'role', 10) : 'user';
    if ($role !== 'admin') { $n = (int) db()->query("SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active'")->fetchColumn(); $s = db()->prepare('SELECT role FROM users WHERE id = ?'); $s->execute([$uid]); if ($s->fetchColumn() === 'admin' && $n <= 1) fail(400, 'invalid_argument', 'Keep at least one administrator.'); }
    db()->prepare('UPDATE users SET role = ? WHERE id = ?')->execute([$role, $uid]); ok(['ok' => true]);
  }
  case 'admin_status': {
    $me = requireAdmin(); $uid = str($b, 'uid', 40); $st = str($b, 'status', 10) === 'disabled' ? 'disabled' : 'active';
    if ($uid === $me['id'] && $st === 'disabled') fail(400, 'invalid_argument', 'You can\'t pause your own account.');
    db()->prepare('UPDATE users SET status = ? WHERE id = ?')->execute([$st, $uid]); ok(['ok' => true]);
  }
  case 'admin_reset': {
    requireAdmin(); $uid = str($b, 'uid', 40); $pw = tempPassword();
    $s = db()->prepare('UPDATE users SET pass = ? WHERE id = ?'); $s->execute([password_hash($pw, PASSWORD_DEFAULT), $uid]);
    if (!$s->rowCount()) fail(404, 'invalid_argument', 'No account with that id.');
    ok(['password' => $pw]);
  }
  default: fail(404, 'not_found', 'Unknown action.');
}
