<?php
declare(strict_types=1);
/*
 * v34: AWS Signature Version 4, for Amazon SES (bulk email through its API) and S3-compatible storage (off-site
 * backup copies: Amazon S3, Backblaze B2, Wasabi, Cloudflare R2, DigitalOcean Spaces). No SDK needed.
 */

function awsUriEncode(string $s, bool $slash = true): string
{
    $o = rawurlencode($s);
    return $slash ? $o : str_replace('%2F', '/', $o);
}
/**
 * Headers for a signed request. $headers are extra headers to sign (name => value); $payloadHash is the hex SHA-256 of
 * the body ('UNSIGNED-PAYLOAD' is allowed by S3 over HTTPS). Returns curl-style "Name: value" lines.
 */
function awsSign(string $method, string $url, string $region, string $service, string $akid, string $secret, array $headers, string $payloadHash, ?int $time = null): array
{
    $t = $time ?? time();
    $amzDate = gmdate('Ymd\THis\Z', $t);
    $date = gmdate('Ymd', $t);
    $u = parse_url($url);
    $host = (string) ($u['host'] ?? '') . (isset($u['port']) ? ':' . $u['port'] : '');
    $path = (string) ($u['path'] ?? '/');
    if ($path === '') {
        $path = '/';
    }
    $canonUri = implode('/', array_map(fn($seg) => awsUriEncode(rawurldecode($seg)), explode('/', $path)));
    $pairs = [];
    if (!empty($u['query'])) {
        foreach (explode('&', (string) $u['query']) as $kv) {
            if ($kv === '') {
                continue;
            }
            [$k, $v] = array_pad(explode('=', $kv, 2), 2, '');
            $pairs[] = [awsUriEncode(rawurldecode($k)), awsUriEncode(rawurldecode($v))];
        }
        usort($pairs, fn($a, $b) => $a[0] === $b[0] ? strcmp($a[1], $b[1]) : strcmp($a[0], $b[0]));
    }
    $canonQuery = implode('&', array_map(fn($p) => $p[0] . '=' . $p[1], $pairs));
    $h = ['host' => $host, 'x-amz-date' => $amzDate];
    if ($service === 's3' || $payloadHash === 'UNSIGNED-PAYLOAD') {
        $h['x-amz-content-sha256'] = $payloadHash;
    }
    foreach ($headers as $k => $v) {
        $h[strtolower((string) $k)] = trim((string) preg_replace('/\s+/', ' ', (string) $v));
    }
    ksort($h);
    $canonHeaders = '';
    foreach ($h as $k => $v) {
        $canonHeaders .= $k . ':' . $v . "\n";
    }
    $signed = implode(';', array_keys($h));
    $canon = $method . "\n" . $canonUri . "\n" . $canonQuery . "\n" . $canonHeaders . "\n" . $signed . "\n" . $payloadHash;
    $scope = $date . '/' . $region . '/' . $service . '/aws4_request';
    $sts = "AWS4-HMAC-SHA256\n" . $amzDate . "\n" . $scope . "\n" . hash('sha256', $canon);
    $k = hash_hmac('sha256', $date, 'AWS4' . $secret, true);
    $k = hash_hmac('sha256', $region, $k, true);
    $k = hash_hmac('sha256', $service, $k, true);
    $k = hash_hmac('sha256', 'aws4_request', $k, true);
    $sig = hash_hmac('sha256', $sts, $k);
    $out = ['Authorization: AWS4-HMAC-SHA256 Credential=' . $akid . '/' . $scope . ', SignedHeaders=' . $signed . ', Signature=' . $sig];
    foreach ($h as $k2 => $v) {
        if ($k2 !== 'host') {
            $out[] = $k2 . ': ' . $v;
        }
    }
    return $out;
}
/** The object URL on an S3-compatible service: virtual-hosted on AWS, path-style elsewhere. */
function s3Url(array $c, string $key): string
{
    $ep = rtrim((string) ($c['endpoint'] ?? ''), '/');
    if ($ep === '') {
        $ep = 'https://s3.' . ($c['region'] ?: 'us-east-1') . '.amazonaws.com';
    }
    $u = parse_url($ep);
    $hostPart = (string) ($u['host'] ?? '');
    $key = implode('/', array_map(fn($s) => awsUriEncode($s), explode('/', ltrim($key, '/'))));
    if (str_ends_with($hostPart, 'amazonaws.com') && !str_contains((string) $c['bucket'], '.')) {
        return ($u['scheme'] ?? 'https') . '://' . $c['bucket'] . '.' . $hostPart . '/' . $key;
    }
    return $ep . '/' . rawurlencode((string) $c['bucket']) . '/' . $key;
}
/** Uploads a local file (streamed). Returns [ok, message]. */
function s3Put(array $c, string $key, string $file, string $type = 'application/octet-stream'): array
{
    if (!is_file($file)) {
        return [false, 'The file to upload is missing.'];
    }
    $url = s3Url($c, $key);
    $hash = hash_file('sha256', $file);
    $size = (int) filesize($file);
    $hdr = awsSign('PUT', $url, (string) ($c['region'] ?: 'us-east-1'), 's3', (string) $c['akid'], (string) $c['secret'], ['content-type' => $type, 'content-length' => (string) $size], $hash);
    $fh = fopen($file, 'rb');
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_UPLOAD => true, CURLOPT_INFILE => $fh, CURLOPT_INFILESIZE => $size, CURLOPT_HTTPHEADER => array_merge($hdr, ['Content-Type: ' . $type, 'Expect:']), CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 1800, CURLOPT_CONNECTTIMEOUT => 15]);
    $body = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    fclose($fh);
    if ($code >= 200 && $code < 300) {
        return [true, 'Uploaded'];
    }
    $msg = preg_match('#<Message>(.*?)</Message>#s', $body, $m) ? $m[1] : ($err !== '' ? $err : 'HTTP ' . $code);
    return [false, 'The storage service refused the upload: ' . mb_substr($msg, 0, 300)];
}
/** Removes an object (old off-site copies). */
function s3Delete(array $c, string $key): bool
{
    $url = s3Url($c, $key);
    $hdr = awsSign('DELETE', $url, (string) ($c['region'] ?: 'us-east-1'), 's3', (string) $c['akid'], (string) $c['secret'], [], hash('sha256', ''));
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => 'DELETE', CURLOPT_HTTPHEADER => $hdr, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30]);
    curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return $code >= 200 && $code < 300;
}
