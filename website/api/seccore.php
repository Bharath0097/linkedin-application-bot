<?php
declare(strict_types=1);
/*
 * v34 security core, loaded by lib.php on every request:
 *   - the security store (its own tables, never reachable through the generic record routes),
 *   - the encryption key (kept outside the website folder once moved there) and the keys derived from it,
 *   - sealed values (AES-256-GCM, the same format the mail settings have used since v20),
 *   - every uploaded file encrypted at rest (AES-256-GCM in 1 MB chunks, "SEF1" files),
 *   - the tamper-evident audit log (each entry carries an HMAC over the one before it).
 */

const SEC_SCHEMA = 3;

/** The security tables. Created on first use; MySQL-compatible types. */
function secdb(): PDO
{
    static $ready = false;
    $p = db();
    if ($ready) {
        return $p;
    }
    $row = $p->query("SELECT v FROM meta WHERE k = 'sec_schema'")->fetch();
    $v = $row ? (int) $row['v'] : 0;
    if ($v < SEC_SCHEMA) {
        $sql = [
            'CREATE TABLE IF NOT EXISTS sec_kv (k VARCHAR(60) PRIMARY KEY, v LONGTEXT NOT NULL, u BIGINT NOT NULL)',
            'CREATE TABLE IF NOT EXISTS audit_log (seq BIGINT PRIMARY KEY, at BIGINT NOT NULL, uid VARCHAR(40) NOT NULL, who VARCHAR(190) NOT NULL,
                ip VARCHAR(64) NOT NULL, kind VARCHAR(16) NOT NULL, act VARCHAR(80) NOT NULL, target VARCHAR(190) NOT NULL, detail TEXT NOT NULL, h VARCHAR(64) NOT NULL)',
            'CREATE TABLE IF NOT EXISTS auth_sessions (id VARCHAR(64) PRIMARY KEY, uid VARCHAR(40) NOT NULL, at BIGINT NOT NULL, seen BIGINT NOT NULL,
                act BIGINT NOT NULL, ip VARCHAR(64) NOT NULL, ua VARCHAR(255) NOT NULL, geo VARCHAR(160) NOT NULL, dev VARCHAR(64) NOT NULL,
                how VARCHAR(80) NOT NULL, mfa INT NOT NULL, out_at BIGINT NOT NULL, why VARCHAR(80) NOT NULL)',
            'CREATE TABLE IF NOT EXISTS auth_devices (uid VARCHAR(40) NOT NULL, dev VARCHAR(64) NOT NULL, at BIGINT NOT NULL, seen BIGINT NOT NULL,
                ua VARCHAR(255) NOT NULL, geo VARCHAR(160) NOT NULL, ip VARCHAR(64) NOT NULL, trust BIGINT NOT NULL, PRIMARY KEY (uid, dev))',
            'CREATE TABLE IF NOT EXISTS auth_mfa (uid VARCHAR(40) PRIMARY KEY, totp TEXT NOT NULL, totp_at BIGINT NOT NULL, totp_step BIGINT NOT NULL,
                email_on INT NOT NULL, codes TEXT NOT NULL, codes_at BIGINT NOT NULL, u BIGINT NOT NULL)',
            'CREATE TABLE IF NOT EXISTS auth_keys (kh VARCHAR(64) PRIMARY KEY, cid TEXT NOT NULL, uid VARCHAR(40) NOT NULL, name VARCHAR(120) NOT NULL,
                pk TEXT NOT NULL, alg INT NOT NULL, cnt BIGINT NOT NULL, at BIGINT NOT NULL, used BIGINT NOT NULL, aaguid VARCHAR(40) NOT NULL, uv INT NOT NULL)',
            'CREATE TABLE IF NOT EXISTS auth_tokens (h VARCHAR(64) PRIMARY KEY, kind VARCHAR(20) NOT NULL, uid VARCHAR(40) NOT NULL, exp BIGINT NOT NULL,
                used BIGINT NOT NULL, at BIGINT NOT NULL, data TEXT NOT NULL)',
            'CREATE TABLE IF NOT EXISTS auth_user (uid VARCHAR(40) PRIMARY KEY, must_pw INT NOT NULL, why VARCHAR(40) NOT NULL, locked_until BIGINT NOT NULL,
                fails INT NOT NULL, fails_at BIGINT NOT NULL, pw_at BIGINT NOT NULL, pw_check BIGINT NOT NULL, mfa_reset BIGINT NOT NULL, data TEXT NOT NULL)',
            'CREATE TABLE IF NOT EXISTS csp_reports (id VARCHAR(24) PRIMARY KEY, at BIGINT NOT NULL, ip VARCHAR(64) NOT NULL, page VARCHAR(300) NOT NULL,
                dir VARCHAR(80) NOT NULL, blocked VARCHAR(300) NOT NULL, n INT NOT NULL)',
        ];
        foreach ($sql as $q) {
            $p->exec($q);
        }
        foreach ([
            'CREATE INDEX audit_at ON audit_log (at)',
            'CREATE INDEX audit_uid ON audit_log (uid)',
            'CREATE INDEX auth_sessions_uid ON auth_sessions (uid)',
            'CREATE INDEX auth_keys_uid ON auth_keys (uid)',
            'CREATE INDEX auth_tokens_uid ON auth_tokens (uid)',
        ] as $q) {
            try {
                $p->exec($q);
            } catch (Throwable $e) {
                // already there
            }
        }
        $p->prepare('REPLACE INTO meta (k, v) VALUES (?, ?)')->execute(['sec_schema', SEC_SCHEMA]);
    }
    $ready = true;
    return $p;
}
/** A JSON value from the security store (settings, results, progress). */
function secKv(string $k, $default = null)
{
    $s = secdb()->prepare('SELECT v FROM sec_kv WHERE k = ?');
    $s->execute([$k]);
    $v = $s->fetchColumn();
    if ($v === false) {
        return $default;
    }
    $j = json_decode((string) $v, true);
    return $j === null && $v !== 'null' ? $default : $j;
}
function secKvSet(string $k, $v): void
{
    secdb()->prepare('REPLACE INTO sec_kv (k, v, u) VALUES (?, ?, ?)')->execute([$k, json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), now()]);
}

/* ---------- the encryption key ----------
   One 256-bit key protects every sealed value and file. It lives in a file: storage/mail.key on older installs (the
   storage folder is blocked from the web), or - after "Move the key out of the website folder" under Security
   center - in .stratedge-keys one level above the site, where no web request can reach it whatever the server
   does with .htaccess. config.php 'key_dir' can name another folder. Every other key is derived from this one. */
function secKeyOutsideDir(): string
{
    // v37: each workspace has its own key (never StratEdge's), outside the website folder once moved there
    $ws = wsSlug();
    return dirname(dirname(__DIR__)) . '/.stratedge-keys' . ($ws !== '' ? '/ws/' . $ws : '');
}
function secKeyCandidates(): array
{
    $out = [];
    $dir = trim((string) cfg('key_dir'));
    if ($dir !== '') {
        $out[] = rtrim($dir, '/') . '/mail.key';
    }
    $out[] = secKeyOutsideDir() . '/mail.key';
    $out[] = storeDir() . '/mail.key';
    return array_values(array_unique($out));
}
/** Where the key is (or will be created). */
function secKeyPath(): string
{
    foreach (secKeyCandidates() as $f) {
        if (is_file($f)) {
            return $f;
        }
    }
    return storeDir() . '/mail.key';
}
function secKeyInsideSite(): bool
{
    $real = realpath(secKeyPath()) ?: secKeyPath();
    $site = realpath(dirname(__DIR__)) ?: dirname(__DIR__);
    return str_starts_with($real, rtrim($site, '/') . '/');
}
/** The raw 32-byte key. */
function secKeyBytes(): string
{
    static $k = null;
    if ($k !== null) {
        return $k;
    }
    $f = secKeyPath();
    if (!is_file($f)) {
        @file_put_contents($f, bin2hex(random_bytes(32)));
        @chmod($f, 0600);
    }
    $hex = trim((string) @file_get_contents($f));
    // without a readable key file the old derived key keeps earlier sealed values readable; Security center flags it
    $k = strlen($hex) === 64 && ctype_xdigit($hex) ? (string) hex2bin($hex) : hash('sha256', __DIR__ . (string) cfg('session_name'), true);
    return $k;
}
function secKeyFileOk(): bool
{
    $hex = trim((string) @file_get_contents(secKeyPath()));
    return strlen($hex) === 64 && ctype_xdigit($hex);
}
/** A key for one purpose ('files', 'audit', 'codes', 'tokens', ...), derived from the main key. */
function secSubKey(string $purpose): string
{
    static $c = [];
    return $c[$purpose] ??= hash_hkdf('sha256', secKeyBytes(), 32, 'stratedge-v34:' . $purpose);
}
/** Moves the key one level above the website folder. Returns [ok, message]. */
function secKeyMoveOutside(): array
{
    $from = secKeyPath();
    if (!secKeyInsideSite()) {
        return [true, 'The key is already outside the website folder.'];
    }
    $dir = secKeyOutsideDir();
    if (!is_dir($dir) && !@mkdir($dir, 0700, true)) {
        return [false, 'The folder above the website (' . dirname($dir) . ') is not writable for the web server, so the key stays where it is. Your host can move storage/mail.key there for you, or set key_dir in api/config.php.'];
    }
    @chmod($dir, 0700);
    $to = $dir . '/mail.key';
    $hex = trim((string) @file_get_contents($from));
    if (strlen($hex) !== 64) {
        return [false, 'The key file could not be read.'];
    }
    if (@file_put_contents($to, $hex) === false) {
        return [false, 'The key could not be written to ' . $dir . '.'];
    }
    @chmod($to, 0600);
    if (trim((string) @file_get_contents($to)) !== $hex) {
        @unlink($to);
        return [false, 'The copy did not read back correctly, so the key stays where it is.'];
    }
    // the old copy goes; if the server refuses, the new copy is used anyway (it is checked first)
    @unlink($from);
    return [true, is_file($from) ? 'The key now lives outside the website folder. The old copy in storage could not be deleted; delete storage/mail.key in cPanel.' : 'The key now lives outside the website folder (' . $dir . ').'];
}

/* ---------- sealed values (same format as mailSeal in mail.php: "v1:" base64(iv | tag | ciphertext)) ---------- */
function secSeal(string $plain): string
{
    if ($plain === '') {
        return '';
    }
    $iv = random_bytes(12);
    $tag = '';
    $c = openssl_encrypt($plain, 'aes-256-gcm', secKeyBytes(), OPENSSL_RAW_DATA, $iv, $tag);
    return 'v1:' . base64_encode($iv . $tag . $c);
}
function secUnseal(string $sealed): string
{
    if ($sealed === '') {
        return '';
    }
    if (str_starts_with($sealed, 'b64:')) {
        return (string) base64_decode(substr($sealed, 4));
    }
    if (!str_starts_with($sealed, 'v1:')) {
        return '';
    }
    $raw = (string) base64_decode(substr($sealed, 3));
    if (strlen($raw) < 28) {
        return '';
    }
    $p = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', secKeyBytes(), OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
    return $p === false ? '' : $p;
}
/** HMAC of a value with a derived key (backup codes, tokens): never reversible, comparable in constant time. */
function secMac(string $purpose, string $v): string
{
    return hash_hmac('sha256', $v, secSubKey($purpose));
}

/* ---------- files encrypted at rest ----------
   SEF1 layout: "SEF1" | version (1) | key id (1) | nonce prefix (8) | plain size (8, big-endian), then per 1 MB chunk:
   length (4) | GCM tag (16) | ciphertext. Chunk i uses IV = prefix | i and authenticates "SEF1" | i | last-flag, so
   chunks cannot be reordered, dropped or cut off without the file failing to open. */
const SEF_MAGIC = 'SEF1';
const SEF_HEAD = 22;
const SEF_CHUNK = 1048576;

function filePathOf(string $fid): string
{
    return rtrim((string) cfg('files_dir'), '/') . '/' . basename($fid);
}
function fileIsSealedPath(string $path): bool
{
    $h = @fopen($path, 'rb');
    if (!$h) {
        return false;
    }
    $m = (string) fread($h, 4);
    fclose($h);
    return $m === SEF_MAGIC;
}
/** Encrypts a file in place (no-op when it already is). */
function fileSealPath(string $path): bool
{
    if (!is_file($path)) {
        return false;
    }
    if (fileIsSealedPath($path)) {
        return true;
    }
    $size = (int) filesize($path);
    $in = @fopen($path, 'rb');
    if (!$in) {
        return false;
    }
    $tmp = $path . '.sef-' . rid(4);
    $out = @fopen($tmp, 'wb');
    if (!$out) {
        fclose($in);
        return false;
    }
    $key = secSubKey('files');
    $prefix = random_bytes(8);
    fwrite($out, SEF_MAGIC . chr(1) . chr(1) . $prefix . pack('J', $size));
    $n = max(1, (int) ceil($size / SEF_CHUNK));
    $ok = true;
    for ($i = 0; $i < $n; $i++) {
        $chunk = $size > 0 ? (string) stream_get_contents($in, SEF_CHUNK) : '';
        $tag = '';
        $ct = openssl_encrypt($chunk, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $prefix . pack('N', $i), $tag, SEF_MAGIC . pack('N', $i) . ($i === $n - 1 ? "\x01" : "\x00"));
        if ($ct === false || fwrite($out, pack('N', strlen($ct)) . $tag . $ct) === false) {
            $ok = false;
            break;
        }
    }
    fclose($in);
    fclose($out);
    if (!$ok) {
        @unlink($tmp);
        return false;
    }
    $perm = @fileperms($path);
    if (!@rename($tmp, $path)) {
        @unlink($tmp);
        return false;
    }
    if ($perm) {
        @chmod($path, $perm & 0777);
    }
    return true;
}
/** Streams a stored file's plain content to $sink in pieces. Plain (not yet encrypted) files pass through. */
function filePipe(string $path, callable $sink): bool
{
    $h = @fopen($path, 'rb');
    if (!$h) {
        return false;
    }
    $head = (string) fread($h, SEF_HEAD);
    if (substr($head, 0, 4) !== SEF_MAGIC) {
        $sink($head);
        while (!feof($h)) {
            $b = fread($h, 262144);
            if ($b === false || $b === '') {
                break;
            }
            $sink($b);
        }
        fclose($h);
        return true;
    }
    if (strlen($head) < SEF_HEAD) {
        fclose($h);
        return false;
    }
    $key = secSubKey('files');
    $prefix = substr($head, 6, 8);
    $size = (int) unpack('J', substr($head, 14, 8))[1];
    $n = max(1, (int) ceil($size / SEF_CHUNK));
    $got = 0;
    for ($i = 0; $i < $n; $i++) {
        $lb = (string) fread($h, 4);
        if (strlen($lb) !== 4) {
            fclose($h);
            return false;
        }
        $len = (int) unpack('N', $lb)[1];
        $tag = (string) fread($h, 16);
        $ct = $len > 0 ? (string) stream_get_contents($h, $len) : '';
        if (strlen($tag) !== 16 || strlen($ct) !== $len) {
            fclose($h);
            return false;
        }
        $pt = openssl_decrypt($ct, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $prefix . pack('N', $i), $tag, SEF_MAGIC . pack('N', $i) . ($i === $n - 1 ? "\x01" : "\x00"));
        if ($pt === false) {
            fclose($h);
            return false;
        }
        $got += strlen($pt);
        $sink($pt);
    }
    fclose($h);
    return $got === $size;
}
/** Plain size of a stored file. */
function filePlainSize(string $path): int
{
    if (!is_file($path)) {
        return 0;
    }
    $h = @fopen($path, 'rb');
    $head = $h ? (string) fread($h, SEF_HEAD) : '';
    if ($h) {
        fclose($h);
    }
    return substr($head, 0, 4) === SEF_MAGIC && strlen($head) === SEF_HEAD ? (int) unpack('J', substr($head, 14, 8))[1] : (int) filesize($path);
}
/** The plain bytes of a stored file (by full path), or null when missing or damaged. */
function fileReadPath(string $path): ?string
{
    if (!is_file($path)) {
        return null;
    }
    $buf = [];
    $ok = filePipe($path, function (string $b) use (&$buf) {
        $buf[] = $b;
    });
    return $ok ? implode('', $buf) : null;
}
function fileRead(string $fid): ?string
{
    return fileReadPath(filePathOf($fid));
}
/**
 * A path whose content is the plain file, for code that needs a real file (PDF and Word readers, zip, attachments):
 * the stored path itself when it is not encrypted, else a private temporary copy removed when the request ends.
 */
function fileLocalPath(string $path, string $ext = ''): ?string
{
    if (!is_file($path)) {
        return null;
    }
    if (!fileIsSealedPath($path)) {
        return $path;
    }
    $dir = storeDir() . '/tmp';
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    $tmp = $dir . '/' . rid(12) . ($ext !== '' ? '.' . preg_replace('/[^a-z0-9]/', '', strtolower($ext)) : '');
    $out = @fopen($tmp, 'wb');
    if (!$out) {
        return null;
    }
    @chmod($tmp, 0600);
    $ok = filePipe($path, function (string $b) use ($out) {
        fwrite($out, $b);
    });
    fclose($out);
    if (!$ok) {
        @unlink($tmp);
        return null;
    }
    static $reg = false;
    $GLOBALS['secTmpFiles'][] = $tmp;
    if (!$reg) {
        $reg = true;
        register_shutdown_function(function () {
            foreach ((array) ($GLOBALS['secTmpFiles'] ?? []) as $f) {
                @unlink($f);
            }
        });
    }
    return $tmp;
}
function fileLocal(string $fid, string $ext = ''): ?string
{
    return fileLocalPath(filePathOf($fid), $ext);
}
/** SHA-256 of the plain content (e-signature fingerprints stay the same whether a file is encrypted or not). */
function fileHashPath(string $path): string
{
    $ctx = hash_init('sha256');
    filePipe($path, function (string $b) use ($ctx) {
        hash_update($ctx, $b);
    });
    return hash_final($ctx);
}
/** Sends a stored file's plain content to the browser. */
function fileServePath(string $path): bool
{
    return filePipe($path, function (string $b) {
        echo $b;
        if (strlen($b) >= 262144) {
            @flush();
        }
    });
}
/** Writes plain bytes as a new stored file (encrypted). */
function fileWritePath(string $path, string $data): bool
{
    if (@file_put_contents($path, $data) === false) {
        return false;
    }
    return fileSealPath($path);
}
/** Encrypts the uploaded files that are still plain (older uploads), a batch at a time; the cron runs it. */
function fileSealSweep(int $max = 300, float $budget = 20.0): array
{
    $dir = rtrim((string) cfg('files_dir'), '/');
    $t0 = microtime(true);
    $done = 0;
    $left = 0;
    $total = 0;
    $failed = 0;
    if (is_dir($dir)) {
        foreach (scandir($dir) ?: [] as $f) {
            if (!preg_match('/^[a-f0-9]{20,64}(\.[a-z0-9]{1,8})?$/', $f) || !is_file("$dir/$f")) {
                continue;
            }
            $total++;
            if (fileIsSealedPath("$dir/$f")) {
                continue;
            }
            if ($done >= $max || microtime(true) - $t0 > $budget) {
                $left++;
                continue;
            }
            if (fileSealPath("$dir/$f")) {
                $done++;
            } else {
                $failed++;
                $left++;
            }
        }
    }
    $st = ['total' => $total, 'plain' => $left, 'done' => $done, 'failed' => $failed, 'at' => now()];
    secKvSet('files_seal', $st);
    return $st;
}

/* ---------- the audit log ----------
   Security-relevant events (sign-ins, two-step changes, access and role changes, settings, exports, deletions,
   backups, reveals) with who, when and from where. Each entry's h = HMAC(previous h | entry) with a key derived from
   the main key, so editing, removing or reordering entries in the database breaks the chain where it happened;
   "Verify the chain" under Security center walks it. */
function auditCanon(array $r): string
{
    return json_encode([(int) $r['seq'], (int) $r['at'], (string) $r['uid'], (string) $r['who'], (string) $r['ip'], (string) $r['kind'], (string) $r['act'], (string) $r['target'], (string) $r['detail']], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}
function audit(string $kind, string $act, string $target = '', array $detail = [], ?array $u = null): void
{
    try {
        $p = secdb();
        $u = $u ?? ($GLOBALS['secUser'] ?? null);
        $sqlite = $p->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite';
        $own = !$p->inTransaction();
        for ($try = 0; $try < 4; $try++) {
            try {
                if ($own) {
                    if ($sqlite) {
                        $p->exec('BEGIN IMMEDIATE');
                    } else {
                        $p->beginTransaction();
                    }
                }
                $last = $p->query('SELECT seq, h FROM audit_log ORDER BY seq DESC LIMIT 1' . ($sqlite || !$own ? '' : ' FOR UPDATE'))->fetch();
                $anchor = $last ? null : secKv('audit_anchor');
                $seq = $last ? (int) $last['seq'] + 1 : (int) ($anchor['seq'] ?? 0) + 1;
                $prev = $last ? (string) $last['h'] : (string) ($anchor['h'] ?? '');
                $row = [
                    'seq' => $seq,
                    'at' => now(),
                    'uid' => mb_substr((string) ($u['id'] ?? ''), 0, 40),
                    'who' => mb_substr((string) ($u['name'] ?? ($u ? '' : 'System')), 0, 190),
                    'ip' => mb_substr(PHP_SAPI === 'cli' ? 'cron' : clientIp(), 0, 64),
                    'kind' => mb_substr($kind, 0, 16),
                    'act' => mb_substr($act, 0, 80),
                    'target' => mb_substr($target, 0, 190),
                    'detail' => mb_substr(json_encode((object) $detail, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), 0, 4000),
                ];
                $row['h'] = hash_hmac('sha256', $prev . "\n" . auditCanon($row), secSubKey('audit'));
                $p->prepare('INSERT INTO audit_log (seq, at, uid, who, ip, kind, act, target, detail, h) VALUES (?,?,?,?,?,?,?,?,?,?)')
                    ->execute([$row['seq'], $row['at'], $row['uid'], $row['who'], $row['ip'], $row['kind'], $row['act'], $row['target'], $row['detail'], $row['h']]);
                if ($own) {
                    if ($sqlite) {
                        $p->exec('COMMIT');
                    } else {
                        $p->commit();
                    }
                }
                return;
            } catch (Throwable $e) {
                if ($own) {
                    try {
                        if ($sqlite) {
                            $p->exec('ROLLBACK');
                        } elseif ($p->inTransaction()) {
                            $p->rollBack();
                        }
                    } catch (Throwable $x) {
                        // nothing to roll back
                    }
                }
                if ($try === 3 || !$own) {
                    @error_log(date('c') . ' audit log write failed: ' . $e->getMessage() . "\n", 3, storeDir() . '/error.log');
                    return;
                }
                usleep(20000 * ($try + 1));
            }
        }
    } catch (Throwable $e) {
        // the audit trail never blocks the action itself
    }
}
/** Walks the chain. Returns n, first, last, ok, bad (the first entry that does not match) and head (latest hash). */
function auditVerify(): array
{
    $p = secdb();
    $anchor = secKv('audit_anchor');
    $prev = (string) ($anchor['h'] ?? '');
    $expect = (int) ($anchor['seq'] ?? 0) + 1;
    $n = 0;
    $first = null;
    $bad = null;
    $why = '';
    $last = 0;
    $after = 0;
    $key = secSubKey('audit');
    while (true) {
        $s = $p->prepare('SELECT * FROM audit_log WHERE seq > ? ORDER BY seq LIMIT 2000');
        $s->execute([$after]);
        $rows = $s->fetchAll();
        if (!$rows) {
            break;
        }
        foreach ($rows as $r) {
            $n++;
            $first = $first ?? (int) $r['seq'];
            if ((int) $r['seq'] !== $expect && $bad === null) {
                $bad = (int) $r['seq'];
                $why = 'entries missing before #' . $r['seq'];
            }
            $h = hash_hmac('sha256', $prev . "\n" . auditCanon($r), $key);
            if (!hash_equals($h, (string) $r['h']) && $bad === null) {
                $bad = (int) $r['seq'];
                $why = 'entry #' . $r['seq'] . ' does not match its seal';
            }
            $prev = (string) $r['h'];
            $expect = (int) $r['seq'] + 1;
            $after = (int) $r['seq'];
            $last = (int) $r['seq'];
        }
    }
    $res = ['n' => $n, 'first' => $first, 'last' => $last, 'ok' => $bad === null, 'bad' => $bad, 'why' => $why, 'head' => $prev, 'at' => now()];
    secKvSet('audit_verify', $res);
    return $res;
}
/** Removes entries older than the retention period, keeping the chain verifiable from the first entry kept. */
function auditPrune(int $days): int
{
    if ($days < 90) {
        return 0;
    }
    $p = secdb();
    $cut = now() - $days * 86400000;
    $s = $p->prepare('SELECT seq, h FROM audit_log WHERE at < ? ORDER BY seq DESC LIMIT 1');
    $s->execute([$cut]);
    $r = $s->fetch();
    if (!$r) {
        return 0;
    }
    secKvSet('audit_anchor', ['seq' => (int) $r['seq'], 'h' => (string) $r['h'], 'at' => now()]);
    $d = $p->prepare('DELETE FROM audit_log WHERE seq <= ?');
    $d->execute([(int) $r['seq']]);
    return $d->rowCount();
}
