<?php
declare(strict_types=1);
/*
 * v34 passkeys (WebAuthn): registering a passkey (Face ID, Touch ID, Windows Hello, Android, a security key) and
 * checking a sign-in with one. Attestation is not needed ("none"); the public key is kept and every sign-in signature
 * is verified with it (ES256, RS256 and Ed25519). Used by auth.php.
 */

function b64uEnc(string $b): string
{
    return rtrim(strtr(base64_encode($b), '+/', '-_'), '=');
}
function b64uDec(string $s): string
{
    $s = strtr($s, '-_', '+/');
    $p = strlen($s) % 4;
    if ($p) {
        $s .= str_repeat('=', 4 - $p);
    }
    $d = base64_decode($s, true);
    return $d === false ? '' : $d;
}

/* ---------- CBOR (the subset authenticators use) ---------- */
function cborLen(string $s, int &$o, int $ai): int
{
    if ($ai < 24) {
        return $ai;
    }
    $n = [24 => 1, 25 => 2, 26 => 4, 27 => 8][$ai] ?? 0;
    if ($n === 0 || $o + $n > strlen($s)) {
        throw new RuntimeException('cbor length');
    }
    $v = 0;
    for ($i = 0; $i < $n; $i++) {
        $v = ($v << 8) | ord($s[$o + $i]);
    }
    $o += $n;
    return $v;
}
function cborDecode(string $s, int &$o = 0, int $depth = 0)
{
    if ($depth > 16 || $o >= strlen($s)) {
        throw new RuntimeException('cbor');
    }
    $ib = ord($s[$o++]);
    $mt = $ib >> 5;
    $ai = $ib & 0x1f;
    if ($mt === 7) {
        if ($ai === 20) {
            return false;
        }
        if ($ai === 21) {
            return true;
        }
        if ($ai === 22 || $ai === 23) {
            return null;
        }
        if ($ai === 25 || $ai === 26 || $ai === 27) {
            $n = [25 => 2, 26 => 4, 27 => 8][$ai];
            $o += $n; // floats never matter for passkeys
            return 0.0;
        }
        throw new RuntimeException('cbor simple');
    }
    $len = cborLen($s, $o, $ai);
    switch ($mt) {
        case 0:
            return $len;
        case 1:
            return -1 - $len;
        case 2:
        case 3:
            if ($o + $len > strlen($s)) {
                throw new RuntimeException('cbor bytes');
            }
            $v = substr($s, $o, $len);
            $o += $len;
            return $v;
        case 4:
            $a = [];
            for ($i = 0; $i < $len; $i++) {
                $a[] = cborDecode($s, $o, $depth + 1);
            }
            return $a;
        case 5:
            $m = [];
            for ($i = 0; $i < $len; $i++) {
                $k = cborDecode($s, $o, $depth + 1);
                $m[is_int($k) || is_string($k) ? $k : json_encode($k)] = cborDecode($s, $o, $depth + 1);
            }
            return $m;
        case 6:
            return cborDecode($s, $o, $depth + 1);
    }
    throw new RuntimeException('cbor type');
}

/* ---------- authenticator data and keys ---------- */
function waAuthData(string $ad): array
{
    if (strlen($ad) < 37) {
        throw new RuntimeException('authenticator data too short');
    }
    $r = ['rp' => substr($ad, 0, 32), 'flags' => ord($ad[32]), 'cnt' => (int) unpack('N', substr($ad, 33, 4))[1]];
    if ($r['flags'] & 0x40) {
        if (strlen($ad) < 55) {
            throw new RuntimeException('attested data');
        }
        $len = (int) unpack('n', substr($ad, 53, 2))[1];
        $r['aaguid'] = bin2hex(substr($ad, 37, 16));
        $r['cid'] = substr($ad, 55, $len);
        $o = 55 + $len;
        $r['cose'] = cborDecode($ad, $o);
    }
    return $r;
}
function derLen(int $l): string
{
    if ($l < 128) {
        return chr($l);
    }
    $b = ltrim(pack('N', $l), "\0");
    return chr(0x80 | strlen($b)) . $b;
}
function derInt(string $v): string
{
    $v = ltrim($v, "\0");
    if ($v === '' || ord($v[0]) > 127) {
        $v = "\0" . $v;
    }
    return "\x02" . derLen(strlen($v)) . $v;
}
function waPem(string $der): string
{
    return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
}
/** The stored form of a credential public key: [alg, key] (PEM for ES256/RS256, "ed25519:" + base64 for EdDSA). */
function waCoseKey(array $c): array
{
    $kty = (int) ($c[1] ?? 0);
    $alg = (int) ($c[3] ?? 0);
    if ($kty === 2 && ($alg === -7 || $alg === 0) && (int) ($c[-1] ?? 0) === 1) {
        $x = (string) ($c[-2] ?? '');
        $y = (string) ($c[-3] ?? '');
        if (strlen($x) !== 32 || strlen($y) !== 32) {
            throw new RuntimeException('EC key');
        }
        return [-7, waPem(hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . "\x04" . $x . $y)];
    }
    if ($kty === 3 && ($alg === -257 || $alg === 0)) {
        $rsa = derInt((string) ($c[-1] ?? '')) . derInt((string) ($c[-2] ?? ''));
        $seq = "\x30" . derLen(strlen($rsa)) . $rsa;
        $bits = "\x03" . derLen(strlen($seq) + 1) . "\x00" . $seq;
        $algId = hex2bin('300d06092a864886f70d0101010500');
        return [-257, waPem("\x30" . derLen(strlen($algId) + strlen($bits)) . $algId . $bits)];
    }
    if ($kty === 1 && $alg === -8 && (int) ($c[-1] ?? 0) === 6) {
        $x = (string) ($c[-2] ?? '');
        if (strlen($x) !== 32) {
            throw new RuntimeException('Ed25519 key');
        }
        return [-8, 'ed25519:' . base64_encode($x)];
    }
    throw new RuntimeException('This kind of passkey is not supported (key type ' . $kty . ', algorithm ' . $alg . ').');
}
function waVerifySig(int $alg, string $key, string $data, string $sig): bool
{
    if ($alg === -8) {
        if (!function_exists('sodium_crypto_sign_verify_detached') || !str_starts_with($key, 'ed25519:') || strlen($sig) !== 64) {
            return false;
        }
        return sodium_crypto_sign_verify_detached($sig, $data, (string) base64_decode(substr($key, 8)));
    }
    $pk = openssl_pkey_get_public($key);
    if (!$pk) {
        return false;
    }
    return openssl_verify($data, $sig, $pk, OPENSSL_ALGO_SHA256) === 1;
}

/* ---------- relying party (this site) ---------- */
/** The passkey domain: the site's host name without "www." (passkeys work on both). Empty for an IP address. */
function waRpId(): string
{
    $h = strtolower((string) preg_replace('/:\d+$/', '', (string) ($_SERVER['HTTP_HOST'] ?? '')));
    if ($h === '' || filter_var($h, FILTER_VALIDATE_IP) || str_starts_with($h, '[')) {
        return '';
    }
    return str_starts_with($h, 'www.') ? substr($h, 4) : $h;
}
function waOrigin(): string
{
    return (sessSecure() ? 'https' : 'http') . '://' . strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
}
/** A fresh challenge kept in the session for one ceremony ('reg', 'mfa', 'login', 'reauth'). */
function waChallenge(string $kind, string $uid = ''): string
{
    $c = b64uEnc(random_bytes(32));
    $_SESSION['wa'] = ['c' => $c, 'k' => $kind, 'uid' => $uid, 'at' => now()];
    return $c;
}
function waTakeChallenge(string $kind): string
{
    $w = $_SESSION['wa'] ?? null;
    unset($_SESSION['wa']);
    if (!is_array($w) || ($w['k'] ?? '') !== $kind || now() - (int) ($w['at'] ?? 0) > 300000) {
        throw new RuntimeException('The passkey request timed out. Try again.');
    }
    return (string) $w['c'];
}
function waClientData(string $raw, string $type, string $challenge): array
{
    $c = json_decode($raw, true);
    if (!is_array($c) || ($c['type'] ?? '') !== $type) {
        throw new RuntimeException('Unexpected passkey response.');
    }
    if (!hash_equals($challenge, (string) ($c['challenge'] ?? ''))) {
        throw new RuntimeException('The passkey answered a different request. Try again.');
    }
    if (strtolower((string) ($c['origin'] ?? '')) !== waOrigin()) {
        throw new RuntimeException('The passkey was used on another site address (' . (string) ($c['origin'] ?? '?') . ').');
    }
    if (!empty($c['crossOrigin'])) {
        throw new RuntimeException('Passkeys must be used on this site itself.');
    }
    return $c;
}
/** Checks a registration (navigator.credentials.create result) and returns what is stored. */
function waRegister(array $cred, string $challenge): array
{
    $rp = waRpId();
    $resp = (array) ($cred['response'] ?? []);
    $cd = b64uDec((string) ($resp['clientDataJSON'] ?? ''));
    waClientData($cd, 'webauthn.create', $challenge);
    $att = cborDecode(b64uDec((string) ($resp['attestationObject'] ?? '')));
    if (!is_array($att) || !isset($att['authData'])) {
        throw new RuntimeException('The passkey response is incomplete.');
    }
    $ad = waAuthData((string) $att['authData']);
    if (!hash_equals(hash('sha256', $rp, true), $ad['rp'])) {
        throw new RuntimeException('The passkey was made for another site.');
    }
    if (!($ad['flags'] & 0x01)) {
        throw new RuntimeException('The passkey did not confirm that someone was present.');
    }
    if (empty($ad['cid']) || !isset($ad['cose']) || !is_array($ad['cose'])) {
        throw new RuntimeException('The passkey sent no key.');
    }
    $rawId = b64uDec((string) ($cred['rawId'] ?? ($cred['id'] ?? '')));
    if ($rawId !== '' && !hash_equals($rawId, (string) $ad['cid'])) {
        throw new RuntimeException('The passkey id does not match.');
    }
    [$alg, $key] = waCoseKey($ad['cose']);
    return ['cid' => b64uEnc((string) $ad['cid']), 'alg' => $alg, 'pk' => $key, 'cnt' => $ad['cnt'], 'aaguid' => (string) ($ad['aaguid'] ?? ''), 'uv' => ($ad['flags'] & 0x04) ? 1 : 0];
}
/** Checks a sign-in (navigator.credentials.get result) against a stored credential row; returns [ok, new count, uv]. */
function waAssert(array $cred, string $challenge, array $row, bool $needUv): array
{
    $rp = waRpId();
    $resp = (array) ($cred['response'] ?? []);
    $cd = b64uDec((string) ($resp['clientDataJSON'] ?? ''));
    waClientData($cd, 'webauthn.get', $challenge);
    $adRaw = b64uDec((string) ($resp['authenticatorData'] ?? ''));
    $ad = waAuthData($adRaw);
    if (!hash_equals(hash('sha256', $rp, true), $ad['rp'])) {
        throw new RuntimeException('The passkey belongs to another site.');
    }
    if (!($ad['flags'] & 0x01)) {
        throw new RuntimeException('The passkey did not confirm that someone was present.');
    }
    $uv = (bool) ($ad['flags'] & 0x04);
    if ($needUv && !$uv) {
        throw new RuntimeException('The passkey did not check your fingerprint, face or PIN.');
    }
    $sig = b64uDec((string) ($resp['signature'] ?? ''));
    if (!waVerifySig((int) $row['alg'], (string) $row['pk'], $adRaw . hash('sha256', $cd, true), $sig)) {
        throw new RuntimeException('The passkey signature did not check out.');
    }
    $old = (int) $row['cnt'];
    if (($old > 0 || $ad['cnt'] > 0) && $ad['cnt'] <= $old) {
        throw new RuntimeException('This passkey may have been copied (its counter went backwards). Remove it and add it again.');
    }
    return [true, $ad['cnt'], $uv];
}
