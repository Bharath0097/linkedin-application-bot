<?php
declare(strict_types=1);
/*
 * v34 encrypted backups (Security center > Backups).
 *
 *   - Every night (cron) a backup of the database, the encryption key and config.php (config.php on StratEdge's own site
 *     only: a company workspace's backup never carries the shared provider file); once a week (optional) a full one
 *     with every uploaded file. Each backup is a zip, encrypted with a fresh random key (XChaCha20-Poly1305 in 1 MB
 *     chunks), and that key is sealed to the RECOVERY KEY's public half (libsodium sealed box). The server keeps only the
 *     public half: it can make backups but can never open one, so a stolen server or a stolen backup reveals nothing.
 *     The recovery key (private half) is shown once to the administrator who sets backups up; keep it offline.
 *   - Copies go to storage/backups (blocked from the web) and, optionally, to S3-compatible storage off the server.
 *   - "Check a backup" opens one with the recovery key in memory, checks the database inside and records the test
 *     restore (SOC 2 A1.3); "Restore" puts a backup's database and key back after a safety copy of the current ones.
 *
 * File layout (.seb): "SEBK1" | sealed key length (2) | sealed key | secretstream header (24) | chunks: length (4) | data.
 */
require_once __DIR__ . '/aws.php';

const BK_MAGIC = 'SEBK1';
const BK_CHUNK = 1048576;

function bkDir(): string
{
    $d = storeDir() . '/backups'; // v37: a workspace keeps its backups in its own folder
    if (!is_dir($d)) {
        @mkdir($d, 0700, true);
    }
    return $d;
}
function monRootDir(): string
{
    return dirname(__DIR__);
}
function bkCfg(): array
{
    $c = secKv('backup', []);
    $c = is_array($c) ? $c : [];
    return array_merge(['on' => false, 'pk' => '', 'fp' => '', 'keyAt' => 0, 'keyBy' => '', 'keep' => 14, 'full' => true, 'fullKeep' => 2, 'exported' => false, 's3' => ['on' => false, 'endpoint' => '', 'region' => '', 'bucket' => '', 'prefix' => 'stratedge-backups/', 'akid' => '', 'secret' => '']], $c);
}
function bkS3(array $c): ?array
{
    $s = (array) ($c['s3'] ?? []);
    if (empty($s['on']) || ($s['bucket'] ?? '') === '' || ($s['akid'] ?? '') === '' || ($s['secret'] ?? '') === '') {
        return null;
    }
    $s['secret'] = secUnseal((string) $s['secret']);
    return $s;
}
/** A new recovery key pair: the public half is kept, the private half returned once. */
function bkKeygen(array $me): array
{
    if (!function_exists('sodium_crypto_box_keypair')) {
        fail(500, 'unavailable', 'This server has no libsodium, so encrypted backups are not possible. Ask the host to enable the PHP sodium extension.');
    }
    $kp = sodium_crypto_box_keypair();
    $pk = sodium_crypto_box_publickey($kp);
    $sk = sodium_crypto_box_secretkey($kp);
    $c = bkCfg();
    $c['pk'] = base64_encode($pk);
    $c['fp'] = substr(hash('sha256', $pk), 0, 16);
    $c['keyAt'] = now();
    $c['keyBy'] = (string) $me['name'];
    $c['exported'] = false;
    $c['on'] = true;
    secKvSet('backup', $c);
    audit('settings', 'New backup recovery key', 'backups', ['fingerprint' => $c['fp']], $me);
    return ['secret' => 'SEBK-' . base64_encode($sk) . '-' . $c['fp'], 'fp' => $c['fp']];
}
/** The secret half pasted back: "SEBK-<base64>-<fingerprint>" (or the bare base64). */
function bkSecretFrom(string $s): ?string
{
    $s = trim($s);
    if (preg_match('/^SEBK-([A-Za-z0-9+\/=]+)-[a-f0-9]{16}$/', $s, $m)) {
        $s = $m[1];
    }
    $sk = base64_decode($s, true);
    return $sk !== false && strlen($sk) === SODIUM_CRYPTO_BOX_SECRETKEYBYTES ? $sk : null;
}
/** A consistent copy of the database (SQLite: VACUUM INTO; MySQL: every table as JSON lines). Returns [path, name]. */
function bkDbSnapshot(string $tmpDir): array
{
    $dsn = (string) cfg('dsn');
    if (str_starts_with($dsn, 'sqlite:')) {
        $out = $tmpDir . '/db.sqlite';
        @unlink($out);
        db()->exec('VACUUM INTO ' . db()->quote($out));
        return [$out, 'db.sqlite'];
    }
    $out = $tmpDir . '/db.jsonl';
    $fh = fopen($out, 'wb');
    foreach (db()->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN) as $t) {
        $s = db()->query('SELECT * FROM `' . str_replace('`', '', (string) $t) . '`');
        while ($r = $s->fetch()) {
            fwrite($fh, json_encode(['t' => $t, 'r' => $r], JSON_UNESCAPED_UNICODE) . "\n");
        }
    }
    fclose($fh);
    return [$out, 'db.jsonl'];
}
/** Encrypts $in to $out for the public key $pk (streamed, 1 MB at a time). */
function bkEncrypt(string $in, string $out, string $pk): bool
{
    $k = sodium_crypto_secretstream_xchacha20poly1305_keygen();
    [$state, $header] = sodium_crypto_secretstream_xchacha20poly1305_init_push($k);
    $sealed = sodium_crypto_box_seal($k, $pk);
    $fi = fopen($in, 'rb');
    $fo = fopen($out, 'wb');
    if (!$fi || !$fo) {
        return false;
    }
    fwrite($fo, BK_MAGIC . pack('n', strlen($sealed)) . $sealed . $header);
    $size = (int) filesize($in);
    $done = 0;
    do {
        $chunk = (string) fread($fi, BK_CHUNK);
        $done += strlen($chunk);
        $tag = $done >= $size ? SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_FINAL : SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_MESSAGE;
        $c = sodium_crypto_secretstream_xchacha20poly1305_push($state, $chunk, '', $tag);
        fwrite($fo, pack('N', strlen($c)) . $c);
    } while ($done < $size);
    fclose($fi);
    fclose($fo);
    sodium_memzero($k);
    return true;
}
/** Decrypts a .seb file with the secret key into $out. Returns '' on success or what went wrong. */
function bkDecrypt(string $in, string $out, string $sk): string
{
    $fi = @fopen($in, 'rb');
    if (!$fi) {
        return 'The backup file cannot be read.';
    }
    if ((string) fread($fi, 5) !== BK_MAGIC) {
        fclose($fi);
        return 'This is not a StratEdge backup file.';
    }
    $len = (int) unpack('n', (string) fread($fi, 2))[1];
    $sealed = (string) fread($fi, $len);
    $pk = sodium_crypto_box_publickey_from_secretkey($sk);
    $k = sodium_crypto_box_seal_open($sealed, sodium_crypto_box_keypair_from_secretkey_and_publickey($sk, $pk));
    if ($k === false) {
        fclose($fi);
        return 'This recovery key does not open this backup (it was made with another key).';
    }
    $header = (string) fread($fi, SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_HEADERBYTES);
    $state = sodium_crypto_secretstream_xchacha20poly1305_init_pull($header, $k);
    $fo = fopen($out, 'wb');
    $final = false;
    while (!feof($fi)) {
        $lb = (string) fread($fi, 4);
        if ($lb === '') {
            break;
        }
        if (strlen($lb) !== 4) {
            fclose($fi);
            fclose($fo);
            return 'The backup file is cut short.';
        }
        $n = (int) unpack('N', $lb)[1];
        $c = $n > 0 ? (string) stream_get_contents($fi, $n) : '';
        $r = sodium_crypto_secretstream_xchacha20poly1305_pull($state, $c);
        if ($r === false) {
            fclose($fi);
            fclose($fo);
            return 'The backup file is damaged or was altered.';
        }
        fwrite($fo, $r[0]);
        if ($r[1] === SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_FINAL) {
            $final = true;
            break;
        }
    }
    fclose($fi);
    fclose($fo);
    return $final ? '' : 'The backup file is cut short (no end marker).';
}
/** Makes one backup now. $full adds every uploaded file. Returns the result recorded under backup_last. */
function bkRun(bool $full = false, string $why = 'scheduled'): array
{
    $c = bkCfg();
    $res = ['at' => now(), 'ok' => false, 'full' => $full, 'why' => $why, 'err' => '', 'name' => '', 'size' => 0, 'offsite' => false];
    try {
        if (empty($c['on']) || $c['pk'] === '') {
            throw new RuntimeException('Backups are not set up (no recovery key yet).');
        }
        if (!class_exists('ZipArchive')) {
            throw new RuntimeException('The PHP zip extension is missing; ask the host to enable it.');
        }
        @set_time_limit(1800);
        $dir = bkDir();
        $tmp = $dir . '/tmp-' . rid(6);
        @mkdir($tmp, 0700);
        [$dbFile, $dbName] = bkDbSnapshot($tmp);
        $zipPath = $tmp . '/backup.zip';
        $z = new ZipArchive();
        if ($z->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            throw new RuntimeException('The backup archive could not be created in storage/backups.');
        }
        $z->addFile($dbFile, $dbName);
        $keyFile = secKeyPath();
        if (is_file($keyFile)) {
            $z->addFile($keyFile, 'keys/mail.key');
        }
        // v83: config.php is StratEdge's own (provider) file, shared by every workspace (its admin login, database, mail
        // and assistant secrets): only StratEdge's own backups carry it, never a company workspace's (whose admin holds the key)
        $cfgFile = __DIR__ . '/config.php';
        if (wsCurrent() === null && is_file($cfgFile)) {
            $z->addFile($cfgFile, 'config.php');
        }
        $n = 0;
        $bytes = 0;
        if ($full) {
            $fd = rtrim((string) cfg('files_dir'), '/');
            foreach (scandir($fd) ?: [] as $f) {
                if (preg_match('/^[a-f0-9]{20,64}(\.[a-z0-9]{1,8})?$/', $f) && is_file("$fd/$f")) {
                    $z->addFile("$fd/$f", 'files/' . $f);
                    $z->setCompressionName('files/' . $f, ZipArchive::CM_STORE);
                    $n++;
                    $bytes += (int) filesize("$fd/$f");
                }
            }
        }
        $meta = ['app' => 'StratEdge portal', 'version' => (string) (json_decode((string) @file_get_contents(__DIR__ . '/manifest.json'), true)['version'] ?? ''), 'at' => now(), 'site' => siteUrl(), 'db' => $dbName, 'full' => $full, 'files' => $n, 'fileBytes' => $bytes, 'keyFile' => is_file($keyFile), 'php' => PHP_VERSION];
        $z->addFromString('backup.json', json_encode($meta, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        if (!$z->close()) {
            throw new RuntimeException('The backup archive could not be written (disk full?).');
        }
        $name = 'stratedge-' . ($full ? 'full' : 'db') . '-' . gmdate('Ymd-His') . '.seb';
        $out = $dir . '/' . $name;
        if (!bkEncrypt($zipPath, $out, (string) base64_decode($c['pk']))) {
            throw new RuntimeException('The backup could not be encrypted.');
        }
        @chmod($out, 0600);
        @unlink($zipPath);
        @unlink($dbFile);
        @rmdir($tmp);
        $res['ok'] = true;
        $res['name'] = $name;
        $res['size'] = (int) filesize($out);
        $res['files'] = $n;
        // off the server
        $s3 = bkS3($c);
        if ($s3) {
            [$okUp, $msg] = s3Put($s3, rtrim((string) $s3['prefix'], '/') . '/' . $name, $out);
            $res['offsite'] = $okUp;
            if (!$okUp) {
                $res['offsiteErr'] = $msg;
            }
        }
        bkPrune($c, $s3);
        audit('system', $full ? 'Full backup made' : 'Backup made', $name, ['size' => $res['size'], 'files' => $n, 'offsite' => $res['offsite']]);
    } catch (Throwable $e) {
        $res['err'] = $e->getMessage();
        audit('system', 'Backup failed', 'backups', ['why' => $res['err']]);
        foreach (glob(bkDir() . '/tmp-*') ?: [] as $t) {
            foreach (glob($t . '/*') ?: [] as $f) {
                @unlink($f);
            }
            @rmdir($t);
        }
    }
    secKvSet('backup_last', $res);
    if ($res['ok']) {
        secKvSet('backup_ok', $res);
    }
    return $res;
}
/** Keeps the newest $keep database backups and $fullKeep full ones (locally and off-site). */
function bkPrune(array $c, ?array $s3): void
{
    $list = bkList();
    $db = array_values(array_filter($list, fn($x) => !$x['full']));
    $full = array_values(array_filter($list, fn($x) => $x['full']));
    $drop = array_merge(array_slice($db, max(1, (int) $c['keep'])), array_slice($full, max(1, (int) $c['fullKeep'])));
    foreach ($drop as $x) {
        @unlink(bkDir() . '/' . $x['name']);
        if ($s3) {
            s3Delete($s3, rtrim((string) $s3['prefix'], '/') . '/' . $x['name']);
        }
    }
}
function bkList(): array
{
    $out = [];
    foreach (glob(bkDir() . '/*.seb') ?: [] as $f) {
        $n = basename($f);
        $out[] = ['name' => $n, 'size' => (int) filesize($f), 'at' => (int) filemtime($f) * 1000, 'full' => str_contains($n, '-full-')];
    }
    usort($out, fn($a, $b) => $b['at'] <=> $a['at']);
    return $out;
}
/** Opens a backup with the recovery key and checks what is inside (nothing on the site changes). */
function bkVerify(string $name, string $sk): array
{
    $f = bkDir() . '/' . basename($name);
    if (!is_file($f) || !str_ends_with($f, '.seb')) {
        return ['ok' => false, 'err' => 'No such backup.'];
    }
    @set_time_limit(900);
    $tmp = bkDir() . '/tmp-' . rid(6);
    @mkdir($tmp, 0700);
    $zip = $tmp . '/b.zip';
    $err = bkDecrypt($f, $zip, $sk);
    $res = ['ok' => false, 'name' => basename($name), 'at' => now(), 'err' => $err];
    if ($err === '') {
        $z = new ZipArchive();
        if ($z->open($zip) !== true) {
            $res['err'] = 'The archive inside the backup cannot be opened.';
        } else {
            $meta = json_decode((string) $z->getFromName('backup.json'), true) ?: [];
            $res['meta'] = $meta;
            $res['entries'] = $z->numFiles;
            $dbName = (string) ($meta['db'] ?? 'db.sqlite');
            if ($dbName === 'db.sqlite') {
                $dbTmp = $tmp . '/check.sqlite';
                file_put_contents($dbTmp, (string) $z->getFromName('db.sqlite'));
                try {
                    $p = new PDO('sqlite:' . $dbTmp, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
                    $ic = (string) $p->query('PRAGMA integrity_check')->fetchColumn();
                    $res['dbCheck'] = $ic;
                    $res['users'] = (int) $p->query('SELECT COUNT(*) FROM users')->fetchColumn();
                    $res['records'] = (int) $p->query('SELECT COUNT(*) FROM docs')->fetchColumn();
                    $res['ok'] = $ic === 'ok';
                    if (!$res['ok']) {
                        $res['err'] = 'The database inside failed its integrity check: ' . $ic;
                    }
                    $p = null;
                } catch (Throwable $e) {
                    $res['err'] = 'The database inside could not be read: ' . $e->getMessage();
                }
                @unlink($dbTmp);
            } else {
                $res['ok'] = $z->locateName($dbName) !== false;
            }
            $res['hasKey'] = $z->locateName('keys/mail.key') !== false;
            $z->close();
        }
    }
    @unlink($zip);
    @rmdir($tmp);
    if ($res['ok']) {
        secKvSet('backup_verify', ['at' => now(), 'ok' => true, 'name' => $res['name'], 'users' => $res['users'] ?? 0, 'records' => $res['records'] ?? 0]);
    }
    audit('system', $res['ok'] ? 'Backup checked (test restore)' : 'Backup check failed', basename($name), ['err' => $res['err']]);
    return $res;
}
/**
 * Puts a backup's database (and key, and files of a full backup that are missing here) back. The current database and
 * key are copied to storage/backups/before-restore-* first. Everyone is signed out afterwards.
 */
function bkRestore(string $name, string $sk): array
{
    $f = bkDir() . '/' . basename($name);
    if (!is_file($f)) {
        return ['ok' => false, 'err' => 'No such backup.'];
    }
    $dsn = (string) cfg('dsn');
    if (!str_starts_with($dsn, 'sqlite:')) {
        return ['ok' => false, 'err' => 'Restoring from the portal works for the built-in SQLite database. For MySQL, ask your developer to load db.jsonl from the decrypted backup.'];
    }
    @set_time_limit(1800);
    $tmp = bkDir() . '/tmp-' . rid(6);
    @mkdir($tmp, 0700);
    $zip = $tmp . '/b.zip';
    $err = bkDecrypt($f, $zip, $sk);
    if ($err !== '') {
        @rmdir($tmp);
        return ['ok' => false, 'err' => $err];
    }
    $z = new ZipArchive();
    if ($z->open($zip) !== true || $z->locateName('db.sqlite') === false) {
        @unlink($zip);
        @rmdir($tmp);
        return ['ok' => false, 'err' => 'The backup holds no database.'];
    }
    $dbPath = substr($dsn, 7);
    $stamp = gmdate('Ymd-His');
    // a safety copy of what is here now
    db()->exec('VACUUM INTO ' . db()->quote(bkDir() . '/before-restore-' . $stamp . '.sqlite'));
    @copy(secKeyPath(), bkDir() . '/before-restore-' . $stamp . '.key');
    $newDb = $tmp . '/restore.sqlite';
    file_put_contents($newDb, (string) $z->getFromName('db.sqlite'));
    $key = $z->getFromName('keys/mail.key');
    $files = 0;
    $fd = rtrim((string) cfg('files_dir'), '/');
    for ($i = 0; $i < $z->numFiles; $i++) {
        $en = (string) $z->getNameIndex($i);
        if (preg_match('#^files/([a-f0-9]{20,64}(\.[a-z0-9]{1,8})?)$#', $en, $m) && !is_file("$fd/" . $m[1])) {
            file_put_contents("$fd/" . $m[1], (string) $z->getFromIndex($i));
            $files++;
        }
    }
    $z->close();
    @unlink($zip);
    // swap the database: WAL side files of the old one go first
    foreach (['-wal', '-shm'] as $sfx) {
        @unlink($dbPath . $sfx);
    }
    if (!@rename($newDb, $dbPath)) {
        @copy($newDb, $dbPath);
        @unlink($newDb);
    }
    if (is_string($key) && strlen(trim($key)) === 64) {
        @file_put_contents(secKeyPath(), trim($key));
    }
    @rmdir($tmp);
    return ['ok' => true, 'files' => $files, 'safety' => 'before-restore-' . $stamp];
}
