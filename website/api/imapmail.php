<?php
declare(strict_types=1);
/*
 * v37.5 Reading a mailbox over IMAP and taking a raw email apart (MIME), for a distribution list's own address: the
 * scheduled task (or "Check now") reads the list's mailbox and relays new messages to the list's members.
 * Plain PHP over a TLS socket: the imap extension is missing on many hosts and left PHP's core in 8.4.
 */

/** One IMAP session. Every problem is a RuntimeException with a sentence a person can act on. */
final class SeImap
{
    /** @var resource */
    private $fp;
    private int $n = 0;
    private int $timeout;

    public function __construct(string $host, int $port, string $sec, int $timeout = 20)
    {
        $this->timeout = $timeout;
        if (!preg_match('/^[A-Za-z0-9.-]{1,253}$/', $host) || $port < 1 || $port > 65535) {
            throw new RuntimeException('The mail server address is not valid.');
        }
        $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true, 'peer_name' => $host, 'SNI_enabled' => true]]);
        $fp = @stream_socket_client(($sec === 'ssl' ? 'ssl://' : 'tcp://') . $host . ':' . $port, $errno, $errstr, $timeout, STREAM_CLIENT_CONNECT, $ctx);
        if (!$fp) {
            throw new RuntimeException('Could not reach ' . $host . ':' . $port . ($errstr !== '' ? ' (' . $errstr . ')' : '') . '. Check the server name, the port and the security setting.');
        }
        stream_set_timeout($fp, $timeout);
        $this->fp = $fp;
        $greet = $this->line();
        if (!preg_match('/^\* (OK|PREAUTH)/i', $greet)) {
            throw new RuntimeException('The server at ' . $host . ':' . $port . ' did not answer as a mail (IMAP) server.');
        }
        if ($sec === 'tls') {
            $this->cmd('STARTTLS');
            if (!@stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                throw new RuntimeException('The secure connection (STARTTLS) failed. Try port 993 with SSL.');
            }
        }
    }

    private function line(): string
    {
        $l = fgets($this->fp, 65536);
        if ($l === false) {
            $meta = stream_get_meta_data($this->fp);
            throw new RuntimeException(!empty($meta['timed_out']) ? 'The mail server stopped answering (timed out).' : 'The mail server closed the connection.');
        }
        return rtrim($l, "\r\n");
    }

    private function bytes(int $len): string
    {
        $out = '';
        while (strlen($out) < $len) {
            $chunk = fread($this->fp, min(65536, $len - strlen($out)));
            if ($chunk === false || $chunk === '') {
                $meta = stream_get_meta_data($this->fp);
                if (!empty($meta['timed_out']) || feof($this->fp)) {
                    throw new RuntimeException('The mail server stopped in the middle of a message.');
                }
                continue;
            }
            $out .= $chunk;
        }
        return $out;
    }

    /**
     * Sends a command; returns the untagged answers, each ['line' => text, 'lits' => [literal bytes...]].
     * A refusal (NO / BAD) throws with the server's words.
     */
    public function cmd(string $c, ?string $cont = null): array
    {
        $tag = 'S' . (++$this->n);
        fwrite($this->fp, $tag . ' ' . $c . "\r\n");
        $out = [];
        while (true) {
            $l = $this->line();
            if ($cont !== null && str_starts_with($l, '+')) {
                // a continuation request (AUTHENTICATE): the answer goes on its own line
                fwrite($this->fp, $cont . "\r\n");
                $cont = null;
                continue;
            }
            $entry = ['line' => $l, 'lits' => []];
            while (preg_match('/\{(\d+)\}$/', $l, $m)) {
                $entry['lits'][] = $this->bytes((int) $m[1]);
                $l = $this->line();
                $entry['line'] .= "\n" . $l;
            }
            if (str_starts_with($entry['line'], $tag . ' ')) {
                $rest = substr($entry['line'], strlen($tag) + 1);
                if (!preg_match('/^OK\b/i', $rest)) {
                    throw new RuntimeException(trim((string) preg_replace('/^(NO|BAD)\s*(\[[^\]]*\]\s*)?/i', '', $rest)) ?: 'The mail server refused: ' . strtok($c, ' ') . '.');
                }
                return $out;
            }
            $out[] = $entry;
        }
    }

    private static function q(string $s): string
    {
        return '"' . str_replace(['\\', '"'], ['\\\\', '\\"'], $s) . '"';
    }

    public function login(string $user, string $pass): void
    {
        try {
            if (preg_match('/^[\x20-\x7e]*$/', $user . $pass)) {
                $this->cmd('LOGIN ' . self::q($user) . ' ' . self::q($pass));
            } else {
                // letters outside plain ASCII: the PLAIN mechanism carries them as they are
                $this->cmd('AUTHENTICATE PLAIN', base64_encode("\0" . $user . "\0" . $pass));
            }
        } catch (RuntimeException $e) {
            throw new RuntimeException('The mailbox refused the sign-in (' . $e->getMessage() . '). Check the address and password; Gmail and Microsoft 365 need an app password.');
        }
    }

    /** Opens a folder; returns how many messages it has. */
    public function select(string $folder): int
    {
        if (!preg_match('/^[\x20-\x7e]{1,120}$/', $folder)) {
            throw new RuntimeException('Use a folder name in plain letters (for example INBOX).');
        }
        $n = 0;
        foreach ($this->cmd('SELECT ' . self::q($folder)) as $e) {
            if (preg_match('/^\* (\d+) EXISTS/i', $e['line'], $m)) {
                $n = (int) $m[1];
            }
        }
        return $n;
    }

    /** UIDs of the messages not read yet. */
    public function unseen(): array
    {
        $uids = [];
        foreach ($this->cmd('UID SEARCH UNSEEN') as $e) {
            if (preg_match('/^\* SEARCH\b(.*)$/i', $e['line'], $m)) {
                foreach (preg_split('/\s+/', trim($m[1])) ?: [] as $u) {
                    if (ctype_digit($u)) {
                        $uids[] = (int) $u;
                    }
                }
            }
        }
        sort($uids);
        return $uids;
    }

    /** The message's size in bytes (before fetching a large one). */
    public function size(int $uid): int
    {
        foreach ($this->cmd('UID FETCH ' . $uid . ' (RFC822.SIZE)') as $e) {
            if (preg_match('/RFC822\.SIZE (\d+)/i', $e['line'], $m)) {
                return (int) $m[1];
            }
        }
        return 0;
    }

    /** The whole message as sent, without marking it read. */
    public function fetch(int $uid): string
    {
        foreach ($this->cmd('UID FETCH ' . $uid . ' (BODY.PEEK[])') as $e) {
            if ($e['lits'] && preg_match('/FETCH/i', $e['line'])) {
                return $e['lits'][0];
            }
        }
        throw new RuntimeException('The message ' . $uid . ' could not be read.');
    }

    public function markSeen(int $uid): void
    {
        $this->cmd('UID STORE ' . $uid . ' +FLAGS.SILENT (\\Seen)');
    }

    public function close(): void
    {
        try {
            if (is_resource($this->fp)) {
                fwrite($this->fp, 'S' . (++$this->n) . " LOGOUT\r\n");
                fclose($this->fp);
            }
        } catch (Throwable $e) {
            // closing anyway
        }
    }
}

/* ---------- a raw email taken apart ---------- */

/** Header block and body of a message or part. */
function mimeSplit(string $raw): array
{
    $raw = str_replace("\r\n", "\n", $raw);
    $p = strpos($raw, "\n\n");
    return $p === false ? [$raw, ''] : [substr($raw, 0, $p), substr($raw, $p + 2)];
}

/** Headers by lower-case name (each a list of values; folded lines joined). */
function mimeHeaders(string $head): array
{
    $out = [];
    $head = (string) preg_replace("/\n[ \t]+/", ' ', $head);
    foreach (explode("\n", $head) as $l) {
        $c = strpos($l, ':');
        if ($c === false || $c === 0) {
            continue;
        }
        $out[strtolower(trim(substr($l, 0, $c)))][] = trim(substr($l, $c + 1));
    }
    return $out;
}

/** Any text in another character set made UTF-8 (invalid bytes dropped). */
function mimeUtf8(string $s, string $charset): string
{
    $cs = strtolower(trim($charset, " \t\"'"));
    if ($cs === '' || in_array($cs, ['utf-8', 'utf8', 'us-ascii', 'ascii'], true)) {
        return mb_scrub($s, 'UTF-8');
    }
    $map = ['iso-8859-1' => 'ISO-8859-1', 'latin1' => 'ISO-8859-1', 'windows-1252' => 'Windows-1252', 'cp1252' => 'Windows-1252', 'iso-8859-15' => 'ISO-8859-15', 'windows-1251' => 'Windows-1251', 'koi8-r' => 'KOI8-R', 'shift_jis' => 'SJIS', 'gb2312' => 'GB18030', 'gbk' => 'GB18030', 'big5' => 'BIG-5', 'euc-kr' => 'EUC-KR', 'iso-2022-jp' => 'ISO-2022-JP', 'utf-16' => 'UTF-16'];
    $from = $map[$cs] ?? strtoupper($cs);
    $t = @mb_convert_encoding($s, 'UTF-8', $from);
    if (!is_string($t) || $t === '') {
        $t = function_exists('iconv') ? @iconv($cs, 'UTF-8//IGNORE', $s) : false;
    }
    return mb_scrub(is_string($t) ? $t : $s, 'UTF-8');
}

/** =?charset?B?...?= and =?charset?Q?...?= words in a header (spaces between two such words do not count). */
function mimeWords(string $s): string
{
    $s = (string) preg_replace('/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?[^?]+\?[BbQq]\?)/', '$1', $s);
    return (string) preg_replace_callback('/=\?([^?*]+)(?:\*[^?]*)?\?([BbQq])\?([^?]*)\?=/', function ($m) {
        $data = strtoupper($m[2]) === 'B' ? (string) base64_decode($m[3]) : quoted_printable_decode(str_replace('_', ' ', $m[3]));
        return mimeUtf8($data, $m[1]);
    }, $s);
}

/** "text/plain; charset=utf-8; name=..." -> ['value' => 'text/plain', 'charset' => ..., ...] (RFC 2231 joined and decoded). */
function mimeParams(string $v): array
{
    $parts = [];
    $buf = '';
    $q = false;
    for ($i = 0, $n = strlen($v); $i < $n; $i++) {
        $ch = $v[$i];
        if ($ch === '"' && ($i === 0 || $v[$i - 1] !== '\\')) {
            $q = !$q;
        }
        if ($ch === ';' && !$q) {
            $parts[] = $buf;
            $buf = '';
            continue;
        }
        $buf .= $ch;
    }
    $parts[] = $buf;
    $out = ['value' => strtolower(trim((string) array_shift($parts)))];
    $ext = [];
    foreach ($parts as $p) {
        $eq = strpos($p, '=');
        if ($eq === false) {
            continue;
        }
        $k = strtolower(trim(substr($p, 0, $eq)));
        $val = trim(substr($p, $eq + 1));
        if (strlen($val) >= 2 && $val[0] === '"' && substr($val, -1) === '"') {
            $val = (string) preg_replace('/\\\\(.)/s', '$1', substr($val, 1, -1));
        }
        if (preg_match('/^([a-z0-9_-]+)\*(\d+)?(\*)?$/', $k, $m)) {
            // filename*=UTF-8''%E2%82%AC.pdf, filename*0*=..., filename*1=...
            $ext[$m[1]][(int) ($m[2] ?? 0)] = [$val, isset($m[3]) || ($m[2] ?? '') === '' ];
            continue;
        }
        $out[$k] = mimeWords($val);
    }
    foreach ($ext as $k => $pieces) {
        ksort($pieces);
        $charset = 'utf-8';
        $s = '';
        $first = true;
        foreach ($pieces as [$val, $enc]) {
            if ($first && $enc && preg_match("/^([^']*)'[^']*'(.*)$/", $val, $mm)) {
                $charset = $mm[1] !== '' ? $mm[1] : 'utf-8';
                $val = $mm[2];
            }
            $s .= $enc ? rawurldecode($val) : $val;
            $first = false;
        }
        $out[$k] = mimeUtf8($s, $charset);
    }
    return $out;
}

/** The pieces of a multipart body. */
function mimeParts(string $body, string $boundary): array
{
    $out = [];
    $chunks = explode("\n--" . $boundary, "\n" . $body);
    array_shift($chunks); // the preamble
    foreach ($chunks as $c) {
        if (str_starts_with($c, '--')) {
            break; // the closing boundary
        }
        $out[] = (string) preg_replace('/^[ \t]*\n/', '', $c, 1);
    }
    return $out;
}

function mimeDecode(string $body, string $enc): string
{
    return match (strtolower(trim($enc))) {
        'base64' => (string) base64_decode((string) preg_replace('/[^A-Za-z0-9+\/=]/', '', $body)),
        'quoted-printable' => quoted_printable_decode(str_replace("\n", "\r\n", $body)),
        default => $body,
    };
}

/** Text from an HTML body (for a message sent as HTML only). */
function mimeHtmlText(string $html): string
{
    // v83: stripHtmlBlocks() (textract.php) runs in linear time; the old back-reference pattern took seconds (or hit
    // the backtrack limit and returned the raw body) on a message with an unclosed <style or <script.
    require_once __DIR__ . '/textract.php';
    $h = stripHtmlBlocks($html, ['script', 'style', 'head']);
    $h = (string) preg_replace('#<br\s*/?>#i', "\n", $h);
    $h = (string) preg_replace('#</(p|div|tr|h[1-6]|table|ul|ol|blockquote)>#i', "\n\n", $h);
    $h = (string) preg_replace('#<li[^>]*>#i', "\n- ", $h);
    $h = (string) preg_replace('#<a\s[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>#is', '$2 ($1)', $h);
    $t = html_entity_decode(strip_tags($h), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $t = (string) preg_replace("/[ \t\x{00A0}]+/u", ' ', $t);
    $t = (string) preg_replace("/ *\n */", "\n", $t);
    return trim((string) preg_replace("/\n{3,}/", "\n\n", $t));
}

/**
 * A raw email taken apart: ['headers', 'from' => [email, name], 'to' => [emails], 'subject', 'text', 'html',
 * 'files' => [[name, type, data]], 'msgid', 'inReply'].
 */
function mimeParse(string $raw): array
{
    [$head, $body] = mimeSplit($raw);
    $h = mimeHeaders($head);
    $out = ['headers' => $h, 'text' => '', 'html' => '', 'files' => []];
    mimeWalk($h, $body, $out, 0);
    if (trim($out['text']) === '' && $out['html'] !== '') {
        $out['text'] = mimeHtmlText($out['html']);
    }
    $out['subject'] = trim(mimeWords((string) ($h['subject'][0] ?? '')));
    $out['from'] = mimeAddr((string) ($h['from'][0] ?? ''));
    $to = [];
    foreach (['to', 'cc', 'delivered-to', 'x-original-to'] as $k) {
        foreach ((array) ($h[$k] ?? []) as $v) {
            if (preg_match_all('/[A-Za-z0-9._%+\'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/', (string) $v, $mm)) {
                foreach ($mm[0] as $e) {
                    $to[] = strtolower($e);
                }
            }
        }
    }
    $out['to'] = array_values(array_unique($to));
    $out['msgid'] = trim((string) ($h['message-id'][0] ?? ''));
    $out['inReply'] = trim((string) ($h['in-reply-to'][0] ?? ''));
    return $out;
}

/** "Jane Smith" <jane@acme.com> -> ['jane@acme.com', 'Jane Smith']. */
function mimeAddr(string $v): array
{
    $v = mimeWords($v);
    if (preg_match('/^\s*"?([^"<]*?)"?\s*<([^>]+)>/', $v, $m)) {
        return [strtolower(trim($m[2])), trim($m[1])];
    }
    if (preg_match('/[A-Za-z0-9._%+\'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/', $v, $m)) {
        return [strtolower($m[0]), ''];
    }
    return ['', ''];
}

function mimeWalk(array $h, string $body, array &$out, int $depth): void
{
    if ($depth > 10 || count($out['files']) > 20) {
        return;
    }
    $ct = mimeParams((string) ($h['content-type'][0] ?? 'text/plain'));
    $type = $ct['value'] !== '' ? $ct['value'] : 'text/plain';
    $cd = mimeParams((string) ($h['content-disposition'][0] ?? ''));
    if (str_starts_with($type, 'multipart/')) {
        $b = (string) ($ct['boundary'] ?? '');
        if ($b === '') {
            return;
        }
        foreach (mimeParts($body, $b) as $p) {
            [$ph, $pb] = mimeSplit($p);
            mimeWalk(mimeHeaders($ph), $pb, $out, $depth + 1);
        }
        return;
    }
    $data = mimeDecode($body, (string) ($h['content-transfer-encoding'][0] ?? '7bit'));
    $name = trim((string) ($cd['filename'] ?? ($ct['name'] ?? '')));
    $disp = (string) ($cd['value'] ?? '');
    if ($type === 'message/rfc822') {
        $out['files'][] = [$name !== '' ? $name : 'forwarded-message.eml', 'message/rfc822', $data];
        return;
    }
    $isText = in_array($type, ['text/plain', 'text/html'], true);
    if ($isText && $disp !== 'attachment' && $name === '') {
        $t = str_replace("\r\n", "\n", mimeUtf8($data, (string) ($ct['charset'] ?? '')));
        if ($type === 'text/plain') {
            $out['text'] .= ($out['text'] !== '' ? "\n\n" : '') . $t;
        } elseif ($out['html'] === '') {
            $out['html'] = $t;
        }
        return;
    }
    // pictures inside an HTML message (a signature's logo) are not attachments
    if ($disp !== 'attachment' && !empty($h['content-id']) && str_starts_with($type, 'image/')) {
        return;
    }
    if ($data === '') {
        return;
    }
    $out['files'][] = [$name !== '' ? mb_substr(str_replace(['/', '\\', "\0"], '_', $name), 0, 180) : 'attachment-' . (count($out['files']) + 1), $type, $data];
}
