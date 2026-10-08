<?php
declare(strict_types=1);
/*
  v35.1: "Grab from emails" on the Requirements desk (routes vms_grab, vms_grab_save), and the reader behind every
  vendor email that becomes a requirement (vmsMaybeRequirement: the shared inbox and connected Gmail).

  Vendor emails come in as Outlook .msg files (dragged out of Outlook), .eml files (Apple Mail, Thunderbird, new
  Outlook, Gmail's "Download message"), JD documents (PDF, Word, text, HTML) or pasted text holding one or several
  emails. Each email is decoded (MIME parts, character sets, attached and forwarded emails, JD attachments), split
  into requirements (several "Job Title:" blocks in one email become several requirements), and cleaned: greetings,
  "please share profiles", security banners, signatures, disclaimers and quoted replies are taken out of the job
  description. The fields are read from the labels vendors use (same line, the next line or a two-column table),
  from the subject ("Urgent || Java Developer || Dallas, TX || C2C") and from the signature (name, phone, company).

  Pure PHP: an OLE compound-file reader for .msg (with compressed RTF), a MIME reader for .eml, and textract.php for
  PDF and Word.
*/
require_once __DIR__ . '/vms.php';
require_once __DIR__ . '/textract.php';

const VG_MAX_FILES = 30;
const VG_MAX_FILE = 20 * 1048576;
const VG_MAX_TOTAL = 60 * 1048576;

/* ======================================================================================================== */
/* Reading files                                                                                              */
/* ======================================================================================================== */

/** Converts text in a named character set to UTF-8 (unknown names fall back to the usual guesses). */
function vgToUtf8(string $s, string $cs): string
{
    $cs = strtoupper(trim($cs, " \t\"'"));
    if ($cs === '' || $cs === 'UTF-8' || $cs === 'UTF8' || $cs === 'US-ASCII' || $cs === 'ASCII') {
        return utf8ify($s);
    }
    $alias = ['CP1252' => 'Windows-1252', 'WINDOWS-1252' => 'Windows-1252', 'CP1251' => 'Windows-1251', 'CP1250' => 'Windows-1250', 'LATIN1' => 'ISO-8859-1', 'GB2312' => 'GBK', 'KS_C_5601-1987' => 'UHC', 'SHIFT_JIS' => 'SJIS'];
    $cs = $alias[$cs] ?? $cs;
    try {
        $r = mb_convert_encoding($s, 'UTF-8', $cs);
        if (is_string($r)) {
            return $r;
        }
    } catch (Throwable $e) {
        // not a name mbstring knows
    }
    if (function_exists('iconv')) {
        $r = @iconv($cs, 'UTF-8//IGNORE', $s);
        if (is_string($r) && $r !== '') {
            return $r;
        }
    }
    return utf8ify($s);
}
/** "=?UTF-8?B?...?=" words in a header, decoded. */
function vgDecodeWords(string $s): string
{
    $s = trim($s);
    if (!str_contains($s, '=?')) {
        return utf8ify($s);
    }
    $s = preg_replace('/\?=\s+=\?/', '?==?', $s) ?? $s;
    return preg_replace_callback(
        '/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/',
        function ($m) {
            $t = strtoupper($m[2]) === 'B' ? (string) base64_decode($m[3]) : quoted_printable_decode(str_replace('_', ' ', $m[3]));
            return vgToUtf8($t, preg_replace('/\*.*$/', '', $m[1]) ?? $m[1]);
        },
        $s,
    ) ?? $s;
}
/** "Name <email>" (or just one of them) as [email, name]. */
function vgAddr(string $v): array
{
    $v = trim(str_replace(["\r", "\n"], ' ', $v));
    if (preg_match('/^(.*?)<\s*([^<>\s@]+@[^<>\s]+)\s*>/', $v, $m)) {
        $n = trim(trim($m[1]), "\"' ");
        return [strtolower(rtrim($m[2], '.')), $n];
    }
    if (preg_match('/\[?(?:mailto:)?([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})\]?/i', $v, $m)) {
        $n = trim(preg_replace('/\[?(?:mailto:)?' . preg_quote($m[1], '/') . '\]?|[()<>]/i', '', $v) ?? '', "\"' ");
        return [strtolower($m[1]), $n];
    }
    return ['', trim($v, "\"' ")];
}
/** A header value's main part and its parameters (boundary, charset, name, filename; RFC 2231 names too). */
function vgParams(string $v): array
{
    $p = [];
    $first = $v;
    if (($i = strpos($v, ';')) !== false) {
        $first = substr($v, 0, $i);
        if (preg_match_all('/;\s*([a-z0-9\-*]+)\s*=\s*("([^"]*)"|[^;\s]+)/i', substr($v, $i), $mm, PREG_SET_ORDER)) {
            foreach ($mm as $m) {
                $p[strtolower($m[1])] = isset($m[3]) && $m[3] !== '' ? $m[3] : trim($m[2], '"');
            }
        }
    }
    foreach (['name', 'filename'] as $k) {
        if (!isset($p[$k]) && isset($p[$k . '*'])) {
            $p[$k] = rawurldecode(preg_replace("/^[^']*'[^']*'/", '', $p[$k . '*']) ?? '');
        } elseif (!isset($p[$k]) && isset($p[$k . '*0'])) {
            $s = '';
            for ($n = 0; $n < 30 && (isset($p[$k . '*' . $n]) || isset($p[$k . '*' . $n . '*'])); $n++) {
                $s .= isset($p[$k . '*' . $n . '*']) ? rawurldecode(preg_replace("/^[^']*'[^']*'/", '', $p[$k . '*' . $n . '*']) ?? '') : $p[$k . '*' . $n];
            }
            $p[$k] = $s;
        }
    }
    return [strtolower(trim($first)), $p];
}
function vgHeaders(string $head): array
{
    $head = preg_replace("/\n[ \t]+/", ' ', $head) ?? $head;
    $h = [];
    foreach (explode("\n", $head) as $line) {
        $p = strpos($line, ':');
        if ($p === false || $p === 0) {
            continue;
        }
        $k = strtolower(trim(substr($line, 0, $p)));
        if ($k !== '' && !isset($h[$k])) {
            $h[$k] = trim(substr($line, $p + 1));
        }
    }
    return $h;
}
function vgSplitHead(string $s): array
{
    if (str_starts_with($s, "\n")) {
        return ['', substr($s, 1)];
    }
    $p = strpos($s, "\n\n");
    return $p === false ? [$s, ''] : [substr($s, 0, $p), substr($s, $p + 2)];
}
function vgMultipart(string $body, string $b): array
{
    $parts = [];
    $cur = null;
    $open = '--' . $b;
    foreach (explode("\n", $body) as $ln) {
        $t = rtrim($ln, "\r \t");
        if ($t === $open . '--') {
            break;
        }
        if ($t === $open) {
            if ($cur !== null) {
                $parts[] = $cur;
            }
            $cur = '';
            continue;
        }
        if ($cur !== null) {
            $cur .= $ln . "\n";
        }
    }
    if ($cur !== null) {
        $parts[] = $cur;
    }
    return array_map(fn($p) => str_ends_with($p, "\n") ? substr($p, 0, -1) : $p, $parts);
}
/** An empty email record (what the readers return). */
function vgMail(): array
{
    return ['from' => ['', ''], 'subject' => '', 'date' => '', 'text' => '', 'html' => '', 'atts' => [], 'inner' => []];
}
/** A raw email (.eml): headers, the text and HTML bodies, attachments, and emails attached or forwarded inside it. */
function vgEml(string $raw, int $depth = 0): array
{
    $raw = str_replace("\r\n", "\n", ltrim($raw, "\xEF\xBB\xBF"));
    [$head, $body] = vgSplitHead($raw);
    $h = vgHeaders($head);
    $out = vgMail();
    $out['from'] = vgAddr(vgDecodeWords($h['from'] ?? ($h['sender'] ?? '')));
    $out['subject'] = vgDecodeWords($h['subject'] ?? '');
    $out['date'] = trim($h['date'] ?? '');
    $count = 0;
    vgPart($h, $body, $out, $depth, $count);
    return $out;
}
function vgPart(array $h, string $body, array &$out, int $depth, int &$count): void
{
    if (++$count > 150 || $depth > 6) {
        return;
    }
    [$type, $p] = vgParams($h['content-type'] ?? 'text/plain');
    $type = $type ?: 'text/plain';
    $enc = strtolower(trim($h['content-transfer-encoding'] ?? ''));
    [$disp, $dp] = vgParams($h['content-disposition'] ?? '');
    $fname = vgDecodeWords((string) ($dp['filename'] ?? ($p['name'] ?? '')));
    if (str_starts_with($type, 'multipart/') && !empty($p['boundary'])) {
        foreach (vgMultipart($body, (string) $p['boundary']) as $part) {
            [$ph, $pb] = vgSplitHead($part);
            vgPart(vgHeaders($ph), $pb, $out, $depth + 1, $count);
        }
        return;
    }
    $data = $enc === 'base64' ? (string) base64_decode(preg_replace('/[^A-Za-z0-9+\/=]/', '', $body) ?? '') : ($enc === 'quoted-printable' ? quoted_printable_decode($body) : $body);
    if ($type === 'message/rfc822' || ($type === 'application/octet-stream' && preg_match('/\.eml$/i', $fname))) {
        if (count($out['inner']) < 10) {
            $out['inner'][] = vgEml($data, $depth + 1);
        }
        return;
    }
    if ($type === 'application/vnd.ms-outlook' || preg_match('/\.msg$/i', $fname)) {
        if (count($out['inner']) < 10 && str_starts_with($data, "\xD0\xCF\x11\xE0")) {
            try {
                $out['inner'][] = vgMsg($data, $depth + 1);
            } catch (Throwable $e) {
                // not readable: left out
            }
        }
        return;
    }
    $isAtt = $disp === 'attachment' || ($fname !== '' && !in_array($type, ['text/plain', 'text/html'], true));
    if (!$isAtt && $type === 'text/plain') {
        if ($out['text'] === '') {
            $out['text'] = vgToUtf8($data, (string) ($p['charset'] ?? ''));
        }
        return;
    }
    if (!$isAtt && $type === 'text/html') {
        if ($out['html'] === '') {
            $out['html'] = vgToUtf8($data, (string) ($p['charset'] ?? ''));
        }
        return;
    }
    if (count($out['atts']) < 20 && strlen($data) <= 15 * 1048576) {
        $out['atts'][] = ['name' => $fname !== '' ? $fname : 'attachment', 'type' => $type, 'data' => $data];
    }
}

/* ---------- Outlook .msg: an OLE compound file ---------- */

/** The compound file's directory and a reader for its streams. */
function vgCfb(string $d): array
{
    $len = strlen($d);
    if ($len < 1536 || substr($d, 0, 8) !== "\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1") {
        throw new RuntimeException('not an Outlook message file');
    }
    $u16 = fn(int $o) => unpack('v', substr($d, $o, 2))[1];
    $u32 = fn(int $o) => unpack('V', substr($d, $o, 4))[1];
    $shift = $u16(0x1E);
    if ($shift !== 9 && $shift !== 12) {
        throw new RuntimeException('unknown sector size');
    }
    $ss = 1 << $shift;
    $miniShift = $u16(0x20);
    $mss = 1 << ($miniShift ?: 6);
    $nFat = $u32(0x2C);
    $dirStart = $u32(0x30);
    $cutoff = $u32(0x38) ?: 4096;
    $miniFatStart = $u32(0x3C);
    $difStart = $u32(0x44);
    $nDif = $u32(0x48);
    $nSect = intdiv($len - $ss, $ss) + 1;
    $sector = function (int $n) use ($d, $ss, $len): string {
        $o = ($n + 1) * $ss;
        return $o >= 0 && $o < $len ? substr($d, $o, $ss) : '';
    };
    // the FAT: its sector list is in the header (109) and the DIFAT chain
    $fatSects = [];
    for ($i = 0; $i < 109; $i++) {
        $s = $u32(0x4C + 4 * $i);
        if ($s < 0xFFFFFFFA) {
            $fatSects[] = $s;
        }
    }
    $seen = [];
    for ($i = 0, $s = $difStart; $i < $nDif && $s < 0xFFFFFFFA && !isset($seen[$s]); $i++) {
        $seen[$s] = true;
        $ent = array_values(unpack('V*', $sector($s)) ?: []);
        $next = array_pop($ent);
        foreach ($ent as $x) {
            if ($x < 0xFFFFFFFA) {
                $fatSects[] = $x;
            }
        }
        $s = (int) $next;
    }
    $fat = [];
    foreach (array_slice($fatSects, 0, max($nFat, 1) + 8) as $s) {
        foreach (array_values(unpack('V*', $sector($s)) ?: []) as $x) {
            $fat[] = $x;
        }
    }
    $chain = function (int $start, int $limit) use ($fat, $nSect): array {
        $out = [];
        $seen = [];
        for ($s = $start; $s < 0xFFFFFFFA && $s < count($fat) && !isset($seen[$s]) && count($out) <= $limit; $s = $fat[$s]) {
            $seen[$s] = true;
            if ($s < $nSect) {
                $out[] = $s;
            }
        }
        return $out;
    };
    $readBig = function (int $start, int $size) use ($chain, $sector, $ss, $nSect): string {
        $buf = '';
        foreach ($chain($start, $size > 0 ? intdiv($size, $ss) + 2 : $nSect) as $s) {
            $buf .= $sector($s);
            if ($size > 0 && strlen($buf) >= $size) {
                break;
            }
        }
        return $size > 0 ? substr($buf, 0, $size) : $buf;
    };
    // the directory
    $dirData = $readBig($dirStart, 0);
    $entries = [];
    for ($o = 0; $o + 128 <= strlen($dirData) && count($entries) < 20000; $o += 128) {
        $nl = unpack('v', substr($dirData, $o + 64, 2))[1];
        $name = $nl >= 2 && $nl <= 64 ? (string) mb_convert_encoding(substr($dirData, $o, $nl - 2), 'UTF-8', 'UTF-16LE') : '';
        $e = unpack('Ctype/Ccolor/Vleft/Vright/Vchild', substr($dirData, $o + 66, 14));
        $start = unpack('V', substr($dirData, $o + 116, 4))[1];
        $size = unpack('V', substr($dirData, $o + 120, 4))[1];
        $entries[] = ['name' => $name, 'type' => $e['type'], 'left' => $e['left'], 'right' => $e['right'], 'child' => $e['child'], 'start' => $start, 'size' => $size];
    }
    if (!$entries || $entries[0]['type'] !== 5) {
        throw new RuntimeException('the message file has no root');
    }
    // the mini stream (small streams live inside the root entry's data) and its allocation table
    $mini = $readBig($entries[0]['start'], $entries[0]['size']);
    $miniFat = [];
    foreach ($chain($miniFatStart, $nSect) as $s) {
        foreach (array_values(unpack('V*', $sector($s)) ?: []) as $x) {
            $miniFat[] = $x;
        }
    }
    $read = function (int $idx) use ($entries, $readBig, $mini, $miniFat, $mss, $cutoff): string {
        $e = $entries[$idx] ?? null;
        if (!$e || $e['type'] !== 2) {
            return '';
        }
        if ($e['size'] >= $cutoff) {
            return $readBig($e['start'], $e['size']);
        }
        $buf = '';
        $seen = [];
        for ($s = $e['start']; $s < 0xFFFFFFFA && $s < count($miniFat) && !isset($seen[$s]) && strlen($buf) < $e['size']; $s = $miniFat[$s]) {
            $seen[$s] = true;
            $buf .= substr($mini, $s * $mss, $mss);
        }
        return substr($buf, 0, $e['size']);
    };
    $children = function (int $idx) use ($entries): array {
        $out = [];
        $stack = [$entries[$idx]['child'] ?? 0xFFFFFFFF];
        $seen = [];
        while ($stack && count($out) < 5000) {
            $n = array_pop($stack);
            if ($n >= 0xFFFFFFFA || !isset($entries[$n]) || isset($seen[$n])) {
                continue;
            }
            $seen[$n] = true;
            $out[$entries[$n]['name']] = $n;
            $stack[] = $entries[$n]['left'];
            $stack[] = $entries[$n]['right'];
        }
        return $out;
    };
    return ['entries' => $entries, 'read' => $read, 'children' => $children];
}
/** An Outlook .msg file in the shape vgEml() returns (attached and embedded messages included). */
function vgMsg(string $data, int $depth = 0): array
{
    $cf = vgCfb($data);
    return vgMsgFrom($cf, 0, $depth, true);
}
function vgMsgFrom(array $cf, int $idx, int $depth, bool $top): array
{
    $kids = ($cf['children'])($idx);
    $out = vgMail();
    // the message's code page, for 8-bit strings (the fixed-size property stream)
    $cp = 'Windows-1252';
    if (isset($kids['__properties_version1.0'])) {
        $ps = ($cf['read'])($kids['__properties_version1.0']);
        for ($o = $top ? 32 : 24; $o + 16 <= strlen($ps); $o += 16) {
            $t = unpack('vtype/vid', substr($ps, $o, 4));
            if (($t['id'] === 0x3FDE || $t['id'] === 0x3FFD) && $t['type'] === 3) {
                $n = unpack('V', substr($ps, $o + 8, 4))[1];
                $map = [65001 => 'UTF-8', 1252 => 'Windows-1252', 1251 => 'Windows-1251', 1250 => 'Windows-1250', 28591 => 'ISO-8859-1', 932 => 'SJIS', 936 => 'GBK', 949 => 'UHC', 950 => 'BIG-5', 20127 => 'ASCII'];
                if (isset($map[$n])) {
                    $cp = $map[$n];
                    break;
                }
            }
        }
    }
    $prop = function (int $id, bool $binary = false) use ($kids, $cf, $cp): string {
        $hex = sprintf('%04X', $id);
        if ($binary) {
            return isset($kids['__substg1.0_' . $hex . '0102']) ? ($cf['read'])($kids['__substg1.0_' . $hex . '0102']) : '';
        }
        if (isset($kids['__substg1.0_' . $hex . '001F'])) {
            return rtrim((string) mb_convert_encoding(($cf['read'])($kids['__substg1.0_' . $hex . '001F']), 'UTF-8', 'UTF-16LE'), "\0");
        }
        if (isset($kids['__substg1.0_' . $hex . '001E'])) {
            return rtrim(vgToUtf8(($cf['read'])($kids['__substg1.0_' . $hex . '001E']), $cp), "\0");
        }
        return '';
    };
    $out['subject'] = $prop(0x0037);
    $heads = vgHeaders(str_replace("\r\n", "\n", $prop(0x007D)));
    $name = $prop(0x0C1A) ?: $prop(0x0042);
    $email = '';
    foreach ([0x5D01, 0x5D02, 0x0C1F, 0x0065, 0x0C19] as $pid) {
        $v = $prop($pid);
        if (filter_var($v, FILTER_VALIDATE_EMAIL)) {
            $email = strtolower($v);
            break;
        }
    }
    if ($email === '' && isset($heads['from'])) {
        [$email, $hn] = vgAddr(vgDecodeWords($heads['from']));
        $name = $name ?: $hn;
    }
    $out['from'] = [$email, $name];
    $out['date'] = trim($heads['date'] ?? '');
    $out['text'] = $prop(0x1000);
    $html = $prop(0x1013, true);
    if ($html === '') {
        $html = $prop(0x1013);
    }
    if ($html !== '') {
        $out['html'] = preg_match('/<meta[^>]+charset=["\']?([a-z0-9_\-]+)/i', $html, $m) ? vgToUtf8($html, $m[1]) : utf8ify($html);
    }
    if ($out['text'] === '' && $out['html'] === '') {
        $rtf = $prop(0x1009, true);
        if ($rtf !== '') {
            $plain = vgRtfText(vgLzfu($rtf));
            $out[str_contains($plain, '<') && preg_match('/<(html|body|p|div|table)\b/i', $plain) ? 'html' : 'text'] = $plain;
        }
    }
    // attachments: files, and emails attached to this one (Outlook "forward as attachment")
    foreach ($kids as $kname => $kidx) {
        if (!str_starts_with($kname, '__attach_version1.0_') || count($out['atts']) + count($out['inner']) >= 20) {
            continue;
        }
        $ak = ($cf['children'])($kidx);
        if (isset($ak['__substg1.0_3701000D']) && $depth < 5) {
            $out['inner'][] = vgMsgFrom($cf, $ak['__substg1.0_3701000D'], $depth + 1, false);
            continue;
        }
        if (!isset($ak['__substg1.0_37010102'])) {
            continue;
        }
        $an = '';
        foreach (['3707', '3704', '3001'] as $pid) {
            foreach (['001F', '001E'] as $ty) {
                if ($an === '' && isset($ak['__substg1.0_' . $pid . $ty])) {
                    $raw = ($cf['read'])($ak['__substg1.0_' . $pid . $ty]);
                    $an = rtrim($ty === '001F' ? (string) mb_convert_encoding($raw, 'UTF-8', 'UTF-16LE') : vgToUtf8($raw, $cp), "\0");
                }
            }
        }
        $bytes = ($cf['read'])($ak['__substg1.0_37010102']);
        if (strlen($bytes) <= 15 * 1048576) {
            if (preg_match('/\.eml$/i', $an)) {
                $out['inner'][] = vgEml($bytes, $depth + 1);
            } elseif (preg_match('/\.msg$/i', $an) && str_starts_with($bytes, "\xD0\xCF\x11\xE0") && $depth < 5) {
                try {
                    $out['inner'][] = vgMsg($bytes, $depth + 1);
                } catch (Throwable $e) {
                }
            } else {
                $out['atts'][] = ['name' => $an !== '' ? $an : 'attachment', 'type' => '', 'data' => $bytes];
            }
        }
    }
    return $out;
}
/** Outlook's compressed RTF (PidTagRtfCompressed), decompressed. */
function vgLzfu(string $c): string
{
    if (strlen($c) < 16) {
        return '';
    }
    $h = unpack('Vcomp/Vraw/Vmagic/Vcrc', substr($c, 0, 16));
    if ($h['magic'] === 0x414C454D) {
        return substr($c, 16, $h['raw']);
    }
    if ($h['magic'] !== 0x75465A4C) {
        return '';
    }
    $pre = "{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}{\\f0\\fnil \\froman \\fswiss \\fmodern \\fscript \\fdecor MS Sans SerifSymbolArialTimes New RomanCourier{\\colortbl\\red0\\green0\\blue0\r\n\\par \\pard\\plain\\f0\\fs20\\b\\i\\u\\tab\\tx";
    $dict = str_pad($pre, 4096, "\0");
    $wp = strlen($pre);
    $out = '';
    $i = 16;
    $n = strlen($c);
    $max = min((int) $h['raw'], 8 * 1048576);
    while ($i < $n && strlen($out) < $max) {
        $ctl = ord($c[$i++]);
        for ($bit = 0; $bit < 8 && $i < $n; $bit++) {
            if ($ctl & (1 << $bit)) {
                if ($i + 1 >= $n) {
                    return $out;
                }
                $w = (ord($c[$i]) << 8) | ord($c[$i + 1]);
                $i += 2;
                $off = $w >> 4;
                $ln = ($w & 0xF) + 2;
                if ($off === $wp) {
                    return $out;
                }
                for ($k = 0; $k < $ln; $k++) {
                    $ch = $dict[($off + $k) % 4096];
                    $out .= $ch;
                    $dict[$wp] = $ch;
                    $wp = ($wp + 1) % 4096;
                }
            } else {
                $ch = $c[$i++];
                $out .= $ch;
                $dict[$wp] = $ch;
                $wp = ($wp + 1) % 4096;
            }
        }
    }
    return $out;
}
/** Readable text from RTF: HTML wrapped in RTF comes back as HTML, anything else as plain text. */
function vgRtfText(string $rtf): string
{
    if ($rtf === '') {
        return '';
    }
    $html = str_contains($rtf, '\\fromhtml');
    $out = '';
    $n = strlen($rtf);
    $skip = [];
    $depth = 0;
    $uc = 1;
    for ($i = 0; $i < $n && strlen($out) < 400000; $i++) {
        $c = $rtf[$i];
        if ($c === '{') {
            $depth++;
            if ($i + 2 < $n && $rtf[$i + 1] === '\\' && $rtf[$i + 2] === '*') {
                // an ignorable group, except HTML kept in \*\htmltag
                if (!($html && substr($rtf, $i + 3, 9) === '\\htmltag')) {
                    $skip[] = $depth;
                }
            }
            continue;
        }
        if ($c === '}') {
            if ($skip && end($skip) === $depth) {
                array_pop($skip);
            }
            $depth--;
            continue;
        }
        if ($skip) {
            continue;
        }
        if ($c === '\\') {
            $nx = $rtf[$i + 1] ?? '';
            if ($nx === '\\' || $nx === '{' || $nx === '}') {
                $out .= $nx;
                $i++;
                continue;
            }
            if ($nx === "'") {
                $out .= vgToUtf8(chr((int) hexdec(substr($rtf, $i + 2, 2))), 'Windows-1252');
                $i += 3;
                continue;
            }
            if (preg_match('/\G\\\\([a-z]{1,32})(-?\d{1,10})? ?/i', $rtf, $m, 0, $i)) {
                $w = $m[1];
                $i += strlen($m[0]) - 1;
                if ($w === 'par' || $w === 'line') {
                    $out .= "\n";
                } elseif ($w === 'tab') {
                    $out .= "\t";
                } elseif ($w === 'uc') {
                    $uc = max(0, (int) ($m[2] ?? 1));
                } elseif ($w === 'u' && isset($m[2])) {
                    $cp = (int) $m[2];
                    $out .= mb_chr($cp < 0 ? $cp + 65536 : $cp, 'UTF-8') ?: '';
                    $i += $uc;
                } elseif (in_array($w, ['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer'], true)) {
                    $skip[] = $depth;
                } elseif ($html && $w === 'htmlrtf') {
                    // RTF-only text between \htmlrtf and \htmlrtf0 is not part of the HTML
                    if (!isset($m[2]) || $m[2] !== '0') {
                        $end = strpos($rtf, '\\htmlrtf0', $i);
                        $i = $end === false ? $n : $end + 8;
                    }
                }
                continue;
            }
            $i++;
            continue;
        }
        if ($c === "\r" || $c === "\n") {
            continue;
        }
        $out .= $c;
    }
    return $out;
}

/** Text from a dropped document (a JD as PDF, Word, text or HTML), or '' when the format is not one of those. */
function vgDocText(string $name, string $data): string
{
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    try {
        if ($ext === 'pdf' || str_starts_with($data, '%PDF')) {
            return cleanText(pdfText($data, 30));
        }
        if ($ext === 'docx' || ($ext === '' && str_starts_with($data, 'PK'))) {
            return cleanText(docxText($data));
        }
        if (in_array($ext, ['html', 'htm'], true)) {
            return vgHtmlText($data);
        }
        if (in_array($ext, ['txt', 'text', 'md', ''], true)) {
            return cleanText($data);
        }
        if ($ext === 'rtf') {
            return cleanText(vgRtfText($data));
        }
    } catch (Throwable $e) {
        @error_log(date('c') . ' grab: could not read ' . $name . ': ' . $e->getMessage() . "\n", 3, storeDir() . '/error.log');
    }
    return '';
}
/** HTML email as text: a two-column table row becomes "Label: Value", other rows "a | b | c"; lists become bullets. */
function vgHtmlText(string $h): string
{
    $h = utf8ify($h);
    $h = preg_replace('#<(script|style|head|title|xml)\b[^>]*>.*?</\1>#is', ' ', $h) ?? $h;
    $h = preg_replace('#<!--.*?-->#s', '', $h) ?? $h;
    $h = preg_replace_callback(
        '#<tr\b[^>]*>(.*?)</tr>#is',
        function ($m) {
            preg_match_all('#<t[dh]\b[^>]*>(.*?)</t[dh]>#is', $m[1], $cells);
            $c = array_values(array_filter(array_map(fn($x) => trim(preg_replace('/\s+/u', ' ', html_entity_decode(strip_tags(preg_replace('#<br\s*/?>|</p>|</div>#i', ' ', $x) ?? $x), ENT_QUOTES | ENT_HTML5, 'UTF-8')) ?? ''), $cells[1]), fn($x) => $x !== ''));
            if (count($c) === 2 && mb_strlen($c[0]) <= 40 && !preg_match('/[.!?]$/', $c[0])) {
                return "\n" . rtrim($c[0], ' :') . ': ' . $c[1];
            }
            return $c ? "\n" . implode(' | ', $c) : '';
        },
        $h,
    ) ?? $h;
    return htmlToText($h);
}

/* ======================================================================================================== */
/* From text to emails, and from emails to requirements                                                       */
/* ======================================================================================================== */

/** Line endings, spaces, invisible characters, quote marks of replies and bullets made consistent; "Label<TAB>Value"
 *  and space-aligned "Label     Value" lines (tables pasted as text) become "Label: Value". */
function vgNorm(string $t): string
{
    $t = str_replace(["\r\n", "\r"], "\n", utf8ify($t));
    $lines = [];
    foreach (explode("\n", $t) as $ln) {
        $ln = preg_replace('/^(?:[ \t]*>)+[ \t]?/u', '', $ln) ?? $ln;
        if (preg_match('/^\s*([^\t:]{2,40}?)(?:\s*\t+|\s{3,})\s*(\S.*)$/u', $ln, $m) && vgLabel(trim($m[1]) . ':')) {
            $ln = trim($m[1]) . ': ' . trim($m[2]);
        }
        $ln = preg_replace('/^[ \t]*(?:[\x{2022}\x{25AA}\x{25CF}\x{25E6}\x{2023}\x{2043}\x{25A0}\x{25A1}\x{27A2}\x{27A4}\x{25BA}\x{25B6}\x{2713}\x{2714}\x{F0B7}\x{F0A7}\x{00B7}\x{2219}*\-\x{2013}]|[o\x{00A7}](?=\t)|\d{1,2}[.)](?=[ \t]+[A-Za-z]))[ \t]+/u', '• ', $ln) ?? $ln;
        if (vgLabel(trim($ln))) {
            $ln = preg_replace(vgLabelRe()[3], "\n", $ln) ?? $ln;
        }
        $lines[] = $ln;
    }
    $t = cleanText(implode("\n", $lines), 400000);
    return trim(preg_replace("/\n{3,}/", "\n\n", $t) ?? '');
}
/** Pasted text (or a text file) split into the emails it holds: Outlook and Gmail header blocks, forwarded and
 *  original-message markers, "On … wrote:" replies. Each: ['from' => [email, name], 'subject', 'body']. */
function vgSplitEmails(string $t): array
{
    $lines = explode("\n", vgNorm($t));
    $n = count($lines);
    $cuts = [];
    for ($i = 0; $i < $n; $i++) {
        $ln = trim($lines[$i], " \t*");
        if (preg_match('/^(-{3,}\s*(original message|forwarded message)\s*-{3,}|begin forwarded message:|_{8,})$/i', $ln)) {
            $cuts[] = [$i, $i + 1, []];
            continue;
        }
        if (preg_match('/^On\s.{6,160}\swrote:$/i', $ln) || preg_match('/^On\s.{6,120}$/i', $ln) && $i + 1 < $n && preg_match('/^.{0,120}wrote:$/i', trim($lines[$i + 1]))) {
            $both = preg_match('/wrote:$/i', $ln) ? $ln : $ln . ' ' . trim($lines[$i + 1]);
            [$e, $nm] = vgAddr(preg_replace('/^On\s.*(?:\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AP]\.?M\.?)?|\b\d{4}\b)\s*,?\s*/i', '', preg_replace('/\s*wrote:$/i', '', $both) ?? '') ?? '');
            $cuts[] = [$i, preg_match('/wrote:$/i', $ln) ? $i + 1 : $i + 2, ['from' => [$e, $nm]]];
            continue;
        }
        if (preg_match('/^From\s*:\s*(.+)$/i', $ln, $m)) {
            $hdr = ['from' => $m[1]];
            $j = $i + 1;
            for (; $j < min($n, $i + 12); $j++) {
                $lj = trim($lines[$j], " \t*");
                if (preg_match('/^(Sent|Date|To|Cc|Bcc|Subject|Importance|Reply-To)\s*:\s*(.*)$/i', $lj, $mm)) {
                    $hdr[strtolower($mm[1])] = $mm[2];
                    continue;
                }
                if ($lj === '' && !isset($hdr['subject'])) {
                    continue;
                }
                break;
            }
            if (isset($hdr['subject']) && (isset($hdr['sent']) || isset($hdr['date']) || isset($hdr['to']))) {
                $cuts[] = [$i, $j, ['from' => vgAddr(vgDecodeWords($hdr['from'])), 'subject' => vgDecodeWords($hdr['subject'])]];
                $i = $j - 1;
            }
        }
    }
    // the segments between the cuts; a marker line directly before a header block belongs to it
    $mails = [];
    $pos = 0;
    $hdr = [];
    $flush = function (int $from, int $to, array $hdr) use ($lines, &$mails) {
        $body = trim(implode("\n", array_slice($lines, $from, max(0, $to - $from))));
        $mails[] = ['from' => $hdr['from'] ?? ['', ''], 'subject' => (string) ($hdr['subject'] ?? ''), 'body' => $body];
    };
    foreach ($cuts as [$a, $b, $h]) {
        if ($a < $pos) {
            continue;
        }
        $flush($pos, $a, $hdr);
        $pos = $b;
        $hdr = $h;
    }
    $flush($pos, $n, $hdr);
    // a marker line followed by a header block: the empty segment between them carries nothing
    $out = [];
    foreach ($mails as $m) {
        if ($m['body'] === '' && $m['subject'] === '' && $m['from'][0] === '') {
            continue;
        }
        $out[] = $m;
    }
    return $out ?: [['from' => ['', ''], 'subject' => '', 'body' => '']];
}

/* ---------- cleaning ---------- */

const VG_SIGNOFF = '/^(?:(?:many\s+)?thanks?(?:\s+(?:you|so\s+much|a\s+lot|again))?(?:\s*(?:&|and|n|&amp;)\s*(?:best\s+|warm\s+|kind\s+)?regards)?|thanking\s+you|thanks\s+in\s+advance|best(?:\s+regards|\s+wishes)?|warm(?:est)?\s+regards|kind\s+regards|regards|sincerely(?:\s+yours)?|cheers|respectfully|with\s+(?:best\s+|warm\s+|kind\s+)?regards|yours\s+(?:truly|sincerely|faithfully)|thx|tia)\s*[,.!:\-]*\s*$|^(?:thanks|thank\s+you|regards|best|cheers)\s*[,\-–]\s*[A-Z][a-z]+(?:\s+[A-Z][a-z.]+){0,2}\s*$/i';
const VG_FOOTER = '/^(?:(?:note|nb|p\.?s\.?|important)\s*[:\-]\s*)?(?:disclaimer\b|confidential(?:ity)?\s*(?:notice|note|statement|:)|this\s+(?:e-?mail|message|communication|transmission)\b.{0,60}\b(?:confidential|intended|privileged|contains)|the\s+information\s+(?:contained|in\s+this)|if\s+you\s+(?:are\s+not\s+the\s+intended|have\s+received\s+this)|to\s+unsubscribe|unsubscribe\b|click\s+here\s+to\s+(?:unsubscribe|remove)|this\s+is\s+not\s+(?:an\s+)?unsolicited|under\s+bill\s+s\.?\s?1618|we\s+respect\s+your\s+(?:online\s+)?privacy|if\s+you\s+(?:do\s+not|don.t)\s+(?:wish|want)\s+to\s+receive|if\s+you\s+are\s+not\s+interested\s+in\s+receiving|(?:please\s+)?consider\s+the\s+environment|sent\s+from\s+my\s+(?:iphone|ipad|android|samsung|mobile|galaxy|blackberry)|get\s+outlook\s+for|you\s+(?:are\s+)?receiv(?:ed|ing)\s+this|to\s+be\s+removed\s+from|reply\s+with\s+["\']?remove)/i';
const VG_BANNER = '/^(?:\[\s*external\s*\]|\*{0,3}\s*external\s+(?:email|sender|message)\b|(?:caution|warning|attention)\s*[:\-]\s*(?:this|external|do\s+not)|this\s+(?:e-?mail|message)\s+(?:originated|came|was\s+sent)\s+from\s+(?:outside|an?\s+external))/i';
const VG_BOILER = [
    '/^(?:hi|hello|hey|dear|greetings|good\s+(?:morning|afternoon|evening|day))\b[^.!?\n]{0,60}[,!.:]?\s*$/i',
    '/^(?:i\s+)?hope\s+(?:you|this|all|your)\b.{0,120}$/i',
    '/^(?:greetings|warm\s+greetings)\s+from\b.{0,80}$/i',
    '/^(?:this\s+is|i\s+am|i\'m|myself|my\s+name\s+is)\s+[a-z .\'\-]{2,40}\s*(?:,|\s)\s*(?:from|with|at|working\s+(?:as|with|at)|a\s+(?:technical\s+)?recruiter)\b.{0,140}$/i',
    '/^(?:please|kindly|pls)\s+(?:find|see|go\s+through|check|review|look\s+at|refer\s+to)\s+(?:the\s+|our\s+|my\s+)?(?:below|attached|following|enclosed|requirements?|positions?|jd|job\s+descriptions?|details|opening|role)\b.{0,200}$/i',
    '/^(?:below|here)\s+is\s+(?:the|a|our)\s+(?:requirements?|jd|job\s+description|position|details|role)\b.{0,80}$/i',
    '/^(?:we\s+have|i\s+have)\s+(?:an?\s+)?(?:urgent|immediate|new|below|following|direct|excellent|exciting)?\s*(?:client\s+)?(?:requirements?|positions?|openings?|roles?|need)\b.{0,120}$/i',
    '/^(?:please|kindly|pls)\s+(?:share|send|forward|submit|email|reply\s+with)\s+(?:me\s+)?(?:your\s+|the\s+)?(?:best\s+|matching\s+|suitable\s+|updated\s+|relevant\s+|qualified\s+)*(?:resumes?|profiles?|candidates?|consultants?|cvs?)\b[^.]{0,80}[.!]*\s*$/i',
    '/^(?:let\s+me\s+know|please\s+let\s+me\s+know|kindly\s+let\s+me\s+know)\s+if\s+you\s+have\b.{0,120}$/i',
    '/^if\s+you\s+(?:have|are)\s+(?:any\s+)?(?:a\s+)?(?:matching|suitable|relevant|interested|qualified)\b.{0,140}$/i',
    '/^(?:looking\s+forward|awaiting|await)\s+(?:to\s+)?(?:hear|your|working|response|a\s+response)\b.{0,80}$/i',
    '/^(?:have\s+a\s+(?:great|good|nice)\s+(?:day|week|weekend)|thanks?\s+for\s+your\s+time)\b.{0,40}$/i',
];

/** The body without banners, greetings and pleasantries, cut before the sign-off, signature and disclaimers.
 *  Returns [clean text, signature text]. */
function vgClean(string $body): array
{
    $lines = explode("\n", $body);
    $keep = [];
    $sig = '';
    $content = 0;
    foreach ($lines as $i => $ln) {
        $t = trim($ln);
        if ($t === '') {
            $keep[] = '';
            continue;
        }
        if (preg_match(VG_BANNER, $t) && $content < 3) {
            continue;
        }
        if ($content > 0 && (preg_match(VG_SIGNOFF, $t) || preg_match(VG_FOOTER, $t))) {
            $sig = implode("\n", array_slice($lines, $i));
            break;
        }
        if (preg_match(VG_FOOTER, $t)) {
            continue;
        }
        if (mb_strlen($t) <= 220) {
            $hit = false;
            foreach (VG_BOILER as $re) {
                if (preg_match($re, $t)) {
                    $hit = true;
                    break;
                }
            }
            if ($hit) {
                continue;
            }
        }
        $keep[] = rtrim($ln);
        $content++;
    }
    $text = trim(preg_replace("/\n{3,}/", "\n\n", implode("\n", $keep)) ?? '');
    return [$text, $sig];
}

/* ---------- labels ---------- */

const VG_LABELS = [
    'ti' => ['job title', 'position title', 'requirement title', 'role title', 'job role', 'role name', 'job name', 'position name', 'job position', 'title', 'role', 'position', 'requirement', 'designation', 'opening', 'job opening'],
    'loc' => ['work location', 'job location', 'location of work', 'work site', 'worksite', 'office location', 'place of work', 'location(s)', 'locations', 'location', 'city/state', 'city'],
    'md' => ['work mode', 'work type', 'mode of work', 'work model', 'work arrangement', 'work setup', 'working mode', 'onsite/remote', 'remote/onsite', 'onsite/hybrid', 'remote/hybrid', 'onsite / remote', 'remote / onsite', 'remote'],
    'dur' => ['contract duration', 'project duration', 'contract length', 'assignment duration', 'assignment length', 'contract term', 'duration', 'length', 'tenure', 'term'],
    'rate' => ['max bill rate', 'bill rate', 'pay rate', 'max rate', 'rate range', 'hourly rate', 'rate/salary', 'salary range', 'budget', 'compensation', 'salary', 'rate', 'pay', 'ctc'],
    'ty' => ['employment type', 'engagement type', 'position type', 'job type', 'contract type', 'hire type', 'type of hire', 'type of employment', 'tax terms', 'tax term', 'engagement', 'employment', 'type'],
    'cl' => ['end client', 'end-client', 'client name', 'client', 'customer'],
    'ip' => ['implementation partner', 'prime vendor', 'prime', 'msp'],
    'visa' => ['visa status', 'visa type', 'visa requirement', 'visa requirements', 'visas accepted', 'visa accepted', 'acceptable visas', 'eligible visas', 'work authorization', 'work authorisation', 'work auth', 'authorization', 'visa', 'visas', 'citizenship', 'immigration status'],
    'sk' => ['must have skills', 'must-have skills', 'mandatory skills', 'required skills', 'primary skills', 'key skills', 'technical skills', 'top skills', 'core skills', 'skill set', 'skillset', 'skills required', 'must haves', 'must have', 'must-have', 'mandatory', 'skills', 'technologies', 'tech stack', 'technology stack'],
    'pref' => ['nice to have skills', 'nice to have', 'nice-to-have', 'good to have', 'preferred skills', 'preferred qualifications', 'preferred', 'secondary skills', 'desired skills'],
    'sd' => ['tentative start date', 'start date', 'target start', 'expected start', 'joining date', 'start'],
    'n' => ['number of positions', 'no of positions', 'no. of positions', '# of positions', 'positions', 'number of openings', 'no of openings', 'no. of openings', 'openings', 'headcount', 'vacancies', 'no of resources', 'resources needed'],
    'exp' => ['years of experience', 'total experience', 'experience required', 'experience level', 'experience', 'exp', 'yoe'],
    'vref' => ['job id', 'req id', 'requisition id', 'requisition #', 'requisition number', 'req #', 'req no', 'req no.', 'job #', 'job code', 'position id', 'jobdiva #', 'jobdiva id', 'reference #', 'reference id', 'ref #', 'ref id', 'job ref', 'job reference'],
    'iv' => ['interview mode', 'interview type', 'interview process', 'mode of interview', 'interview rounds', 'interview'],
    'desc' => ['detailed job description', 'job description', 'position description', 'role description', 'job summary', 'position summary', 'description', 'jd', 'job details', 'about the role', 'roles and responsibilities', 'roles & responsibilities', 'key responsibilities', 'responsibilities', 'duties', 'job duties'],
    'cn' => ['contact person', 'point of contact', 'poc', 'recruiter name', 'recruiter', 'contact name', 'contact'],
];
/** One regex over every label: [regex, label => key]. */
function vgLabelRe(): array
{
    static $re = null;
    if ($re === null) {
        $map = [];
        foreach (VG_LABELS as $k => $list) {
            foreach ($list as $l) {
                $map[$l] = $k;
            }
        }
        $ls = array_keys($map);
        usort($ls, fn($a, $b) => strlen($b) - strlen($a));
        $alt = implode('|', array_map(fn($l) => str_replace(' ', '\s*', preg_quote($l, '/')), $ls));
        $re = ['/^\s*(?:•\s*)?\**\s*(' . $alt . ')\s*\**\s*(?:\(s\))?\s*(?:[:=|\x{2013}\x{2014}]+|-{1,2}(?!\w)|\t)\s*(.*)$/iu', '/^\s*(?:•\s*)?\**\s*(' . $alt . ')\s*\**\s*:?\s*$/iu', $map, '/(?:[ \t]{2,}|[ \t]*\|[ \t]*|[ \t]+•[ \t]+)(?=(?:' . $alt . ')[ \t]*(?:\(s\))?[ \t]*:)/iu'];
    }
    return $re;
}
/** The label key and value on a line, or null. $bare: a line that is only a label ("Must Have Skills"). */
function vgLabel(string $line): ?array
{
    [$re, $bare, $map] = vgLabelRe();
    if (preg_match($re, $line, $m)) {
        $k = $map[mb_strtolower(preg_replace('/\s+/', ' ', trim($m[1])) ?? '')] ?? null;
        if ($k === null) {
            foreach ($map as $l => $kk) {
                if (preg_replace('/\s+/', '', $l) === preg_replace('/\s+/', '', mb_strtolower($m[1]))) {
                    $k = $kk;
                    break;
                }
            }
        }
        return $k === null ? null : [$k, trim($m[2], " \t*-:=|\u{2013}\u{2014}")];
    }
    if (mb_strlen($line) <= 34 && preg_match($bare, $line, $m) && ($k = $map[mb_strtolower(preg_replace('/\s+/', ' ', trim($m[1])) ?? '')] ?? '') !== '') {
        return [$k, ''];
    }
    return null;
}

const VG_ROLE_ALT = 'developer|engineer|architect|analyst|consultant|manager|lead|administrator|admin|specialist|tester|qa|sdet|scientist|designer|programmer|dba|devops|sre|scrum\s*master|product\s*owner|owner|director|coordinator|technician|support|officer|associate|expert|head|principal|modeler|writer|trainer|auditor|accountant|recruiter|executive|strategist|steward|integrator';
const VG_ROLE_WORDS = '/\b(?:' . VG_ROLE_ALT . ')s?\b/i';
const VG_STATES = 'A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY]';

/** Splits one cleaned email into requirement blocks (several "Job Title:" blocks, or "Requirement 1/2/3"). */
function vgReqBlocks(string $text): array
{
    $lines = explode("\n", $text);
    $marks = [];
    foreach ($lines as $i => $ln) {
        $t = trim($ln);
        if ($t === '') {
            continue;
        }
        if (preg_match('/^(?:•\s*)?(?:req(?:uirement)?|position|role|job|opening)\s*(?:#|no\.?)?\s*(\d{1,2})\s*(?:[:.)\-–]\s*(.*))?$/i', $t, $m) && mb_strlen($t) <= 90) {
            $marks[] = [$i, 'num', trim($m[2] ?? '')];
            continue;
        }
        $l = vgLabel($t);
        if ($l && $l[0] === 'ti' && $l[1] === '') {
            // "Job Title" on its own line, the title below it
            foreach (array_slice($lines, $i + 1, 2) as $nx) {
                if (trim($nx) !== '') {
                    $l[1] = vgLabel(trim($nx)) ? '' : trim($nx);
                    break;
                }
            }
        }
        if ($l && $l[0] === 'ti' && $l[1] !== '' && mb_strlen($l[1]) <= 120 && str_word_count($l[1]) <= 14) {
            $marks[] = [$i, 'ti', $l[1]];
        }
    }
    // a title label right after a "Requirement 2" line belongs to it
    $starts = [];
    foreach ($marks as $k => $m) {
        if ($m[1] === 'ti' && $k > 0 && $marks[$k - 1][1] === 'num' && $m[0] - $marks[$k - 1][0] <= 3) {
            continue;
        }
        $starts[] = $m[0];
    }
    if (count($starts) < 2) {
        return [['pre' => '', 'text' => $text]];
    }
    // each block needs another label or some text of its own, or it is not a separate requirement
    $blocks = [];
    for ($k = 0; $k < count($starts); $k++) {
        $a = $starts[$k];
        $b = $starts[$k + 1] ?? count($lines);
        $chunk = array_slice($lines, $a, $b - $a);
        $other = 0;
        foreach (array_slice($chunk, 1) as $ln) {
            $l = vgLabel(trim($ln));
            if ($l && $l[0] !== 'ti') {
                $other++;
            }
        }
        if ($other === 0 && count(array_filter($chunk, fn($x) => trim($x) !== '')) < 4) {
            return [['pre' => '', 'text' => $text]];
        }
        $blocks[] = trim(implode("\n", $chunk));
    }
    $pre = trim(implode("\n", array_slice($lines, 0, $starts[0])));
    return array_map(fn($b) => ['pre' => $pre, 'text' => $b], $blocks);
}

/** The labelled values in a block: [key => first value] (skills, nice-to-have and description sections gathered). */
function vgValues(string $text): array
{
    $lines = explode("\n", $text);
    $n = count($lines);
    $v = [];
    $sections = ['sk' => [], 'pref' => []];
    for ($i = 0; $i < $n; $i++) {
        $t = trim($lines[$i]);
        if ($t === '') {
            continue;
        }
        $l = vgLabel($t);
        if (!$l) {
            continue;
        }
        [$k, $val] = $l;
        if ($k === 'desc') {
            continue;
        }
        if ($k === 'sk' || $k === 'pref') {
            $items = $val !== '' ? [$val] : [];
            for ($j = $i + 1; $j < $n && $j <= $i + 40; $j++) {
                $tj = trim($lines[$j]);
                if ($tj === '') {
                    if ($items && ($j + 1 >= $n || !str_starts_with(trim($lines[$j + 1]), '•'))) {
                        break;
                    }
                    continue;
                }
                if (vgLabel($tj)) {
                    break;
                }
                if ($val !== '' && !str_starts_with($tj, '•')) {
                    break;
                }
                $items[] = ltrim($tj, '• ');
            }
            $sections[$k] = array_merge($sections[$k], $items);
            continue;
        }
        if ($val === '') {
            // the value on the next line ("Location:" then "Dallas, TX"), when it is not another label
            for ($j = $i + 1; $j < $n && $j <= $i + 2; $j++) {
                $tj = trim($lines[$j]);
                if ($tj === '') {
                    continue;
                }
                if (!vgLabel($tj) && mb_strlen($tj) <= 160) {
                    $val = ltrim($tj, '• ');
                }
                break;
            }
        }
        if ($k === 'ti' && ($val === '' || str_word_count($val) > 14 || preg_match('/[.!?]$/', $val) || !preg_match('/[A-Za-z]{2}/', $val))) {
            continue;
        }
        if ($val !== '' && !isset($v[$k])) {
            $v[$k] = $val;
        }
    }
    $v['_sk'] = $sections['sk'];
    $v['_pref'] = $sections['pref'];
    return $v;
}
function vgMode(string $s): string
{
    $s = mb_strtolower($s);
    if (preg_match('/\bhybrid\b|\b\d\s*(?:days?|x)\s*(?:a|per|\/)\s*week\b|\bpartial(?:ly)?\s*remote/', $s)) {
        return 'Hybrid';
    }
    if (preg_match('/\b(?:100\s*%\s*|fully\s+|full\s+|completely\s+)?remote\b|\bwork\s+from\s+home\b|\bwfh\b/', $s) && !preg_match('/\b(?:no|not|non|never)[\s\-]+remote\b|\bremote\s+(?:is\s+)?not\b|\bremote\s*:\s*no\b/', $s)) {
        return 'Remote';
    }
    if (preg_match('/\bon[\s\-]?site\b|\bin[\s\-]office\b|\bonsite\b|\bday\s*(?:1|one)\b|\bin\s+person\b/', $s)) {
        return 'Onsite';
    }
    return '';
}
function vgType(string $s): string
{
    $best = '';
    $at = PHP_INT_MAX;
    foreach (['C2C' => '/\bc2c\b|corp(?:oration)?[\s\-]*(?:to|2)[\s\-]*corp/i', 'W2' => '/\bw[\s\-]?2\b/i', '1099' => '/\b1099\b/', 'Contract-to-hire' => '/\bc2h\b|contract[\s\-]*(?:to|2)[\s\-]*hire|\bcth\b/i', 'Full-time' => '/\bfull[\s\-]*time\b|\bfte\b|\bpermanent\b|\bperm\b|\bdirect\s+hire\b/i', 'SOW' => '/\bsow\b|statement\s+of\s+work/i'] as $k => $re) {
        if (preg_match($re, $s, $m, PREG_OFFSET_CAPTURE) && $m[0][1] < $at) {
            $best = $k;
            $at = $m[0][1];
        }
    }
    return $best;
}
function vgRate(string $s): string
{
    $num = '\$?\s?\d{2,3}(?:[.,]\d{1,2})?\s*(?:k\b)?';
    if (preg_match('/(?:\$|usd\s?)\s?\d{2,3}(?:[.,]\d{1,2})?\s*(?:k\b)?(?:\s*(?:-|–|to)\s*' . $num . ')?\s*(?:(?:\/|per)\s*(?:hr|hour|h|annum|year|yr)\b|k\b|\s*(?:on\s+|\/\s*)?(?:c2c|w2|1099)\b)?(?:\s*(?:on\s+|\/\s*)?(?:c2c|w2|1099|all[\s\-]?inclusive))?/i', $s, $m)) {
        return trim($m[0]);
    }
    if (preg_match('/\b\d{2,3}(?:\.\d{1,2})?\s*(?:-|to)?\s*\d{0,3}\s*\/\s*(?:hr|hour)\b/i', $s, $m)) {
        return trim($m[0]);
    }
    return '';
}
function vgDuration(string $s): string
{
    if (preg_match('/\b(\d{1,2}\s*\+?\s*(?:(?:-|to)\s*\d{1,2}\s*\+?\s*)?(?:months?|mos?\b\.?|years?|yrs?|weeks?)(?:\s*(?:\+|plus|with\s+(?:possible\s+|likely\s+|high\s+possibility\s+of\s+)?extensions?|extendable|ext\.?)\b)?)/i', $s, $m)) {
        return trim($m[1]);
    }
    if (preg_match('/\blong[\s\-]*term\b/i', $s)) {
        return 'Long term';
    }
    return '';
}
function vgLoc(string $s): string
{
    if (preg_match('/\b([A-Z][A-Za-z.\'\-]+(?:[ \t]+[A-Z][A-Za-z.\'\-]+){0,3}),[ \t]*(' . VG_STATES . ')\b(?:[ \t]*,?[ \t]*\d{5})?/', $s, $m)) {
        return $m[1] . ', ' . $m[2];
    }
    return '';
}
/** Plain words for a location value: "Dallas, TX (Hybrid - 3 days onsite)" → "Dallas, TX". */
function vgLocTidy(string $v): string
{
    $v = trim(preg_replace('/\s*[(\[][^)\]]*(?:onsite|on-site|remote|hybrid|days?|week|office|local)[^)\]]*[)\]]/i', '', $v) ?? $v);
    $v = trim(preg_replace('/\s*(?:[\-–|,\/]|\bor\b)?\s*(?:\(?\s*(?:100\s*%\s*)?(?:onsite|on-site|on\s+site|remote|hybrid)\b.*)$/i', '', $v) ?? $v, " -–|,/");
    return mb_substr($v !== '' ? $v : 'Remote', 0, 160);
}
function vgTitleTidy(string $t): string
{
    $t = trim(preg_replace('/\s*[(\[][^)\]]*(?:onsite|remote|hybrid|c2c|w2|1099|contract|local|only|day\s*1|urgent|immediate)[^)\]]*[)\]]\s*/i', ' ', $t) ?? $t);
    $t = trim(preg_replace('/\s+(?:[\-–|@]|\bin\b|\bat\b)\s+(?:[A-Z][A-Za-z.\'\-]+\s*)+,\s*(?:' . VG_STATES . ')\b.*$/', '', $t) ?? $t);
    $t = trim(preg_replace('/\s*[\-–|,]\s*(?:onsite|on-site|remote|hybrid|c2c|w2|contract|long\s+term|urgent|immediate|need)\b.*$/i', '', $t) ?? $t, " -–|:,");
    $t = preg_replace('/\s{2,}/', ' ', $t) ?? $t;
    // SHOUTED TITLES in title case (short codes stay: SAP, AWS, QA, .NET)
    $letters = preg_replace('/[^A-Za-z]/', '', $t) ?? '';
    if (strlen($letters) > 6 && strlen(preg_replace('/[^A-Z]/', '', $letters) ?? '') / strlen($letters) > 0.8) {
        $t = implode(' ', array_map(fn($w) => strlen(preg_replace('/[^A-Za-z]/', '', $w) ?? '') > 4 ? ucfirst(strtolower($w)) : $w, explode(' ', $t)));
    }
    return mb_substr($t, 0, 160);
}
/** A role title from a subject: "Urgent Requirement || Java Developer || Dallas, TX || C2C" → "Java Developer". */
function vgSubjectTitle(string $s): string
{
    $s = preg_replace('/^(?:\s*(?:re|fw|fwd|aw|wg|sv)\s*:\s*|\s*\[[^\]]{1,30}\]\s*)+/i', '', $s) ?? $s;
    $parts = preg_split('/\s*(?:\|\||\||::|\s[\-–]\s|\s@\s|\/\/|;)\s*/', $s) ?: [$s];
    $clean = [];
    foreach ($parts as $p) {
        $p = trim(preg_replace('/^(?:urgent|hot|immediate|new|direct\s+client|direct|req(?:uirement)?s?|requirement\s+for|need(?:ed)?(?:\s+for)?|hiring(?:\s+for)?|looking\s+for|opening(?:\s+for)?|position(?:\s+for)?|job(?:\s+opening)?|role|immediate\s+need(?:\s+for)?|urgent\s+(?:need|requirement|req)(?:\s+for)?|hot\s+(?:need|requirement|req)(?:\s+for)?|very\s+urgent)\b[\s:\-–!]*/i', '', trim($p)) ?? $p);
        $p = trim(preg_replace('/^(?:urgent|immediate|hot|new)\b[\s:\-–!]*/i', '', $p) ?? $p);
        if ($p === '' || preg_match('/^(?:c2c|w2|1099|contract|onsite|on-site|remote|hybrid|local(?:s)?(?:\s+only)?|only|need|urgent|immediate|long\s+term|\d+\s*\+?\s*(?:months?|years?)|rate.*|\$.*)$/i', $p) || vgLoc($p) === $p) {
            continue;
        }
        $clean[] = $p;
    }
    foreach ($clean as $p) {
        if (preg_match(VG_ROLE_WORDS, $p)) {
            return vgTitleTidy($p);
        }
    }
    return vgTitleTidy($clean[0] ?? '');
}
/** A start date as Y-m-d when it is a real date (ASAP, Immediate: none). */
function vgDate(string $s): string
{
    $s = trim(preg_replace('/(\d)(st|nd|rd|th)\b/i', '$1', $s) ?? $s);
    if ($s === '' || preg_match('/asap|immediate|tbd|flexible/i', $s)) {
        return '';
    }
    if (preg_match('/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/', $s, $m)) {
        $y = (int) $m[3] < 100 ? 2000 + (int) $m[3] : (int) $m[3];
        return checkdate((int) $m[1], (int) $m[2], $y) ? sprintf('%04d-%02d-%02d', $y, $m[1], $m[2]) : '';
    }
    $t = strtotime($s);
    if ($t === false || $t < time() - 60 * 86400 || $t > time() + 400 * 86400) {
        return '';
    }
    return date('Y-m-d', $t);
}
/** The skills for matching: listed items that are short, plus the skills found in longer sentences. */
function vgSkills(array $items, string $fallbackText): string
{
    $out = [];
    $long = '';
    foreach ($items as $it) {
        foreach (vgSplitList($it) as $tok) {
            $tok = trim($tok, " \t.:-–*");
            if (substr_count($tok, '(') !== substr_count($tok, ')')) {
                $tok = trim($tok, '()');
            }
            if ($tok === '' || mb_strlen($tok) > 40 || str_word_count($tok) > 5) {
                $long .= ' ' . $tok;
                continue;
            }
            if (preg_match('/^\d+\+?\s*(?:years?|yrs?)/i', $tok) || preg_match('/^(?:experience|knowledge|strong|good|excellent|ability|must|should)\b/i', $tok)) {
                $long .= ' ' . $tok;
                continue;
            }
            $out[mb_strtolower($tok)] = $tok;
        }
    }
    $found = skillsIn($long !== '' ? $long : ($out ? '' : $fallbackText), 25);
    foreach ($found as $s) {
        if (!isset($out[mb_strtolower($s)])) {
            $out[mb_strtolower($s)] = $s;
        }
    }
    return mb_substr(implode(', ', array_slice(array_values($out), 0, 25)), 0, 1000);
}
/** A list split at commas, semicolons, bars, bullets and "and", but not inside brackets ("AWS (EC2, Lambda)"). */
function vgSplitList(string $s): array
{
    $out = [];
    $cur = '';
    $depth = 0;
    $s = preg_replace('/\s+and\s+/i', ',', $s) ?? $s;
    foreach (mb_str_split($s) as $ch) {
        if ($ch === '(' || $ch === '[') {
            $depth++;
        } elseif (($ch === ')' || $ch === ']') && $depth > 0) {
            $depth--;
        }
        if ($depth === 0 && in_array($ch, [',', ';', '|', '•', "\n"], true)) {
            $out[] = trim($cur);
            $cur = '';
            continue;
        }
        $cur .= $ch;
    }
    $out[] = trim($cur);
    return array_values(array_filter($out, fn($x) => $x !== ''));
}
/** Who wrote it, from the signature: [name, email, phone, company]. */
function vgSignature(string $sig, string $body): array
{
    $lines = array_values(array_filter(array_map('trim', explode("\n", $sig)), fn($x) => $x !== ''));
    $name = '';
    $company = '';
    foreach (array_slice($lines, 1, 6) as $ln) {
        $first = trim((string) preg_split('/\s+[|\-–]\s+|\s*,\s+/', $ln)[0]);
        if ($name === '' && preg_match('/^[A-Z][A-Za-z.\'\-]+(?:\s+[A-Z][A-Za-z.\'\-]*){1,3}$/', $first) && !preg_match(VG_ROLE_WORDS, $first) && !preg_match('/\b(?:inc|llc|ltd|corp|solutions|technologies|systems|consulting|services|group|email|phone|direct|mobile)\b/i', $first)) {
            $name = $first;
            if ($first === $ln) {
                continue;
            }
        }
        if ($company === '' && mb_strlen($ln) <= 70 && preg_match('/\b(?:inc|llc|ltd|l\.l\.c|corp(?:oration)?|technologies|technology|solutions|systems|consulting|consultancy|services|group|global|software|infotech|staffing|partners|associates)\b\.?/i', $ln) && !preg_match('/@|https?:|www\.|\d{3}[\s.\-]\d{4}/', $ln)) {
            $company = trim(preg_replace('/^(?:[A-Za-z .\'\-]+\s*[|,\-–]\s*)?(?=.*\b(?:inc|llc|ltd|corp|technologies|solutions|systems|consulting|services|group)\b)/i', '', $ln) ?? $ln, ' |,-–');
            $company = trim(preg_replace('/^.*\|\s*/', '', $company) ?? $company);
        }
    }
    $hay = $sig !== '' ? $sig : $body;
    $email = preg_match('/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i', $hay, $m) ? strtolower($m[0]) : '';
    $phone = preg_match('/(?:\+?1[\s.\-]?)?\(?\b\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}\b(?:\s*(?:x|ext\.?|extension)\s*\d{1,6})?/i', $hay, $m) ? trim($m[0]) : '';
    return [$name, $email, $phone, mb_substr($company, 0, 120)];
}
/** Whether a text reads like a hotlist (consultants offered) rather than a requirement. */
function vgHotlist(string $subject, string $text): bool
{
    $hay = mb_strtolower($subject . "\n" . mb_substr($text, 0, 5000));
    return (bool) preg_match('/\bhot\s*list\b|\bavailable\s+consultants?\b|\bconsultants?\s+(?:are\s+)?available\b|\bbench\s+(?:list|consultants?|profiles?)\b|\bavailable\s+(?:resources|profiles|candidates)\b/', $hay);
}

/**
 * The requirements in one email (or document): a list of ['f' => fields, 'warn' => [...], 'kind' => 'req'|'hotlist',
 * 'raw' => the block's text]. $from = [email, name].
 */
function vgReqsFromMail(array $from, string $subject, string $body, string $attText = ''): array
{
    [$text, $sig] = vgClean(vgNorm($body));
    // a short body with a JD attached: the attachment is the requirement
    $plain = trim(preg_replace('/\s+/', ' ', $text) ?? '');
    $plainBody = $plain;
    if ($attText !== '' && mb_strlen($plain) < 400) {
        [$at] = vgClean(vgNorm($attText));
        $text = trim($text . "\n\n" . $at);
    }
    if (trim($text) === '' && trim($subject) === '') {
        return [];
    }
    [$sn, $se, $sp, $sco] = vgSignature($sig, $text);
    $hot = vgHotlist($subject, $text);
    $out = [];
    $blocks = vgReqBlocks($text);
    $pre = $blocks[0]['pre'] !== '' ? vgValues($blocks[0]['pre']) : [];
    foreach ($blocks as $bi => $blk) {
        $t = $blk['text'];
        $v = vgValues($t) + array_diff_key($pre, ['ti' => 1, '_sk' => 1, '_pref' => 1]);
        $warn = [];
        $labels = count(array_diff_key($v, ['_sk' => 1, '_pref' => 1])) + (empty($v['_sk']) ? 0 : 1);
        // the title: a label, else the subject when it names a role, else a short first line that does, else the subject
        $title = isset($v['ti']) ? vgTitleTidy($v['ti']) : '';
        $subj = count($blocks) === 1 ? vgSubjectTitle($subject) : '';
        if ($title === '' && $subj !== '' && preg_match(VG_ROLE_WORDS, $subj)) {
            $title = $subj;
        }
        if ($title === '') {
            foreach (array_slice(explode("\n", $t), 0, 4) as $ln) {
                $ln = trim($ln, " •*#");
                if ($ln !== '' && mb_strlen($ln) <= 80 && str_word_count($ln) <= 9 && preg_match(VG_ROLE_WORDS, $ln) && !preg_match('/[.!?:]$/', $ln) && !vgLabel($ln)) {
                    $title = vgTitleTidy($ln);
                    break;
                }
            }
        }
        if ($title === '' && preg_match('/\b(?:looking\s+for|hiring(?:\s+for)?|in\s+need\s+of|need(?:ing)?|seeking|searching\s+for|requirement\s+for|opening\s+for|position\s+(?:of|for)|role\s+of)\s+(?:an?\s+|the\s+|one\s+|\d{1,2}\s+)?((?:[\w\/.+#&\-]+\s+){0,5}(?:' . VG_ROLE_ALT . ')s?)\b/i', $t, $sm)) {
            $cand = trim(preg_replace('/^(?:(?:strong|good|talented|experienced|skilled|passionate|great|qualified|motivated|dynamic|seasoned|hands[\s\-]on)\s+)+/i', '', $sm[1]) ?? $sm[1]);
            if (str_word_count($cand) <= 6) {
                $title = vgTitleTidy(implode(' ', array_map(fn($w) => preg_match('/^[a-z]/', $w) && strlen($w) > 3 ? ucfirst($w) : $w, explode(' ', $cand))));
            }
        }
        if ($labels === 0 && mb_strlen($plain) < 160 && preg_match('/^\s*(?:re|fw|fwd|aw|wg)\s*:/i', $subject) && ($title === '' || $title === $subj)) {
            // a short reply or forward note on top of an email ("RE: Data Analyst — any update?"): not a requirement
            continue;
        }
        if ($title === '' && $labels === 0 && mb_strlen($plain) < 160 && !preg_match(VG_ROLE_WORDS, $plain)) {
            // a forward or reply note ("FYI, please work on this", "Any update?"): nothing to file
            continue;
        }
        if ($title === '') {
            $title = $subj;
        }
        $hay = $subject . "\n" . $t;
        $preText = $blk['pre'];
        $locRaw = (string) ($v['loc'] ?? '');
        $md = vgMode((string) ($v['md'] ?? ''));
        if ($md === '' && isset($v['md']) && preg_match('/^\s*(?:no|n)\b/i', (string) $v['md'])) {
            $md = 'Onsite';
        } elseif ($md === '' && isset($v['md']) && preg_match('/^\s*(?:yes|y|100)\b/i', (string) $v['md'])) {
            $md = 'Remote';
        }
        $md = $md ?: vgMode($locRaw) ?: vgMode($subject) ?: vgMode($t) ?: vgMode($preText) ?: 'Onsite';
        $loc = $locRaw !== '' ? vgLocTidy($locRaw) : (vgLoc($subject) ?: vgLoc(mb_substr($t, 0, 1500)) ?: ($md === 'Remote' ? 'Remote' : ''));
        $rate = isset($v['rate']) ? mb_substr($v['rate'], 0, 60) : vgRate($hay);
        $ty = vgType((string) ($v['ty'] ?? '')) ?: vgType($subject . ' ' . (string) ($v['rate'] ?? '')) ?: vgType($t) ?: vgType($preText);
        $dur = isset($v['dur']) ? mb_substr($v['dur'], 0, 60) : (vgDuration(implode("\n", array_filter(explode("\n", $hay), fn($l) => preg_match('/contract|duration|month|year|term|long/i', $l) && !preg_match('/experience|exp\b/i', $l)))) ?: vgDuration(implode("\n", array_filter(explode("\n", $preText), fn($l) => !preg_match('/experience|exp\b/i', $l)))));
        $visa = isset($v['visa']) ? mb_substr($v['visa'], 0, 120) : '';
        if ($visa === '') {
            foreach (explode("\n", $hay) as $ln) {
                if (mb_strlen(trim($ln)) <= 160 && preg_match('/\b(?:usc|us\s+citizens?|gc[\s\-]?ead|gc|green\s*card|h[\s\-]?1\s?b|h[\s\-]?4\s?ead|l[\s\-]?2\s?ead|opt|cpt|stem|tn\s+visa|ead)\b/i', $ln) && preg_match('/\b(?:only|accepted|visa|work|authori[sz]|candidates|no\b|ok\b|eligible|citizens?|status)/i', $ln)) {
                    $visa = trim($ln, " •*");
                    break;
                }
            }
        }
        $sk = vgSkills($v['_sk'] ?? [], $title . "\n" . $t);
        $n = 1;
        if (isset($v['n']) && preg_match('/\d{1,2}/', $v['n'], $m)) {
            $n = (int) $m[0];
        } elseif (preg_match('/\b(\d{1,2})\s*(?:positions|openings|resources|people|consultants|candidates|roles|headcount)\b/i', $t, $m)) {
            $n = (int) $m[1];
        }
        $vref = isset($v['vref']) && preg_match('/[A-Za-z0-9][A-Za-z0-9\-_\/#.]{1,39}/', $v['vref'], $m) ? $m[0] : '';
        [$fe, $fn] = $from;
        $ce = $fe !== '' ? $fe : $se;
        $cn = $fn !== '' && !filter_var($fn, FILTER_VALIDATE_EMAIL) ? $fn : ($sn !== '' ? $sn : (string) ($v['cn'] ?? ''));
        $f = vmsReqFields([
            'ti' => $title,
            'cl' => (string) ($v['cl'] ?? ''),
            'ec' => (string) ($v['cl'] ?? ''),
            'loc' => $loc,
            'md' => $md,
            'ty' => $ty,
            'rate' => $rate,
            'dur' => $dur,
            'n' => $n,
            'sd' => vgDate((string) ($v['sd'] ?? '')),
            'sk' => $sk,
            'visa' => $visa,
            'd' => $t,
            'cn' => $cn,
            'ce' => filter_var($ce, FILTER_VALIDATE_EMAIL) ? $ce : '',
            'cp' => $sp,
        ]);
        $f['vref'] = $vref;
        $f['ip'] = mb_substr((string) ($v['ip'] ?? ''), 0, 160);
        $f['exp'] = mb_substr((string) ($v['exp'] ?? ''), 0, 60);
        $f['iv'] = mb_substr((string) ($v['iv'] ?? ''), 0, 120);
        $f['pref'] = !empty($v['_pref']) ? vgSkills($v['_pref'], '') : '';
        $f['co'] = $sco;
        if ($title === '') {
            $warn[] = 'No role title found: add one before saving.';
        }
        $out[] = ['f' => $f, 'warn' => $warn, 'kind' => $hot && !isset($v['ti']) ? 'hotlist' : 'req', 'raw' => mb_substr(($subject !== '' ? 'Subject: ' . $subject . "\n" : '') . $t, 0, 15000)];
    }
    return $out;
}

/** The vendor on file for a sender: [vid, name] (exact contact email first, then the company's website domain). */
function vgVendorFor(string $email): array
{
    $email = strtolower(trim($email));
    if ($email === '') {
        return ['', ''];
    }
    $dom = strtolower(substr(strrchr($email, '@') ?: '', 1));
    $free = in_array($dom, ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'aol.com', 'icloud.com', 'msn.com', 'protonmail.com', 'yahoo.co.in', 'rediffmail.com'], true);
    $byDomain = ['', ''];
    foreach (vmsVendorsRaw() as [$vid, $v]) {
        foreach ((array) ($v->contacts ?? []) as $c) {
            if (strtolower((string) ($c->e ?? '')) === $email) {
                return [(string) $vid, (string) ($v->n ?? '')];
            }
        }
        $site = strtolower((string) ($v->site ?? ''));
        if ($byDomain[0] === '' && !$free && $dom !== '' && $site !== '' && str_contains($site, $dom)) {
            $byDomain = [(string) $vid, (string) ($v->n ?? '')];
        }
    }
    return $byDomain;
}
/** Normalised words for comparing two requirements. */
function vgKey(string $s): string
{
    $s = mb_strtolower($s);
    $s = preg_replace('/\b(?:sr|senior|jr|junior|lead|ii|iii|the|a|an|of|for|and)\b|[^a-z0-9]+/', ' ', $s) ?? $s;
    return trim(preg_replace('/\s+/', ' ', $s) ?? $s);
}
/** A requirement already on the desk that this one repeats (same job ID, or the same role and place from the same
 *  sender or client in the last 45 days), or null. */
function vgDupOnDesk(array $f, array $desk): ?array
{
    $tk = vgKey($f['ti']);
    $lk = vgKey($f['loc']);
    foreach ($desk as [$id, $q]) {
        if ($f['vref'] !== '' && (string) ($q->vref ?? '') !== '' && strcasecmp((string) $q->vref, $f['vref']) === 0) {
            return ['id' => (string) $id, 'ti' => (string) ($q->ti ?? ''), 'at' => (int) ($q->at ?? 0), 'why' => 'same job ID'];
        }
        if ((int) ($q->at ?? 0) < now() - 45 * 86400000 || $tk === '' || vgKey((string) ($q->ti ?? '')) !== $tk) {
            continue;
        }
        $sameLoc = $lk === '' || vgKey((string) ($q->loc ?? '')) === $lk;
        $sameWho = ($f['ce'] !== '' && strtolower((string) ($q->ce ?? '')) === $f['ce']) || ($f['cl'] !== '' && vgKey((string) ($q->cl ?? '')) === vgKey($f['cl']));
        if ($sameLoc && $sameWho) {
            return ['id' => (string) $id, 'ti' => (string) ($q->ti ?? ''), 'at' => (int) ($q->at ?? 0), 'why' => 'same role and location from the same sender'];
        }
    }
    return null;
}

/* ======================================================================================================== */
/* The desk: grab, preview, save                                                                               */
/* ======================================================================================================== */

/** Everything dropped or pasted as emails: [['src', 'from', 'subject', 'body', 'att']] plus what was skipped. */
function vgCollect(array $files, string $text, string $html): array
{
    $mails = [];
    $skipped = [];
    $total = 0;
    $add = function (array $m, string $src) use (&$mails, &$add) {
        $body = $m['html'] !== '' && (preg_match('/<table\b/i', $m['html']) || trim($m['text']) === '') ? vgHtmlText($m['html']) : $m['text'];
        $att = '';
        foreach ($m['atts'] as $a) {
            if ($att === '' && preg_match('/\.(pdf|docx|txt|rtf|html?)$/i', (string) $a['name'])) {
                $att = vgDocText((string) $a['name'], (string) $a['data']);
            }
        }
        $parts = vgSplitEmails($body);
        $first = true;
        foreach ($parts as $p) {
            $mails[] = ['src' => $src, 'from' => $first && $m['from'][0] !== '' ? $m['from'] : ($p['from'][0] !== '' || $p['from'][1] !== '' ? $p['from'] : $m['from']), 'subject' => $first ? ($m['subject'] ?: $p['subject']) : ($p['subject'] ?: $m['subject']), 'body' => $p['body'], 'att' => $first ? $att : ''];
            $first = false;
        }
        foreach ($m['inner'] as $k => $in) {
            $add($in, $src . ' (attached email' . (count($m['inner']) > 1 ? ' ' . ($k + 1) : '') . ')');
        }
    };
    foreach (array_slice($files, 0, VG_MAX_FILES) as [$name, $data]) {
        $total += strlen($data);
        if (strlen($data) > VG_MAX_FILE || $total > VG_MAX_TOTAL) {
            $skipped[] = $name . ': larger than the 20 MB this reads';
            continue;
        }
        $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        if ($data === '') {
            $skipped[] = $name . ': empty, or it could not be uploaded';
            continue;
        }
        try {
            if ($ext === 'msg' || str_starts_with($data, "\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1")) {
                $add(vgMsg($data), $name);
            } elseif ($ext === 'eml' || ($ext === '' && preg_match('/^(?:[A-Za-z\-]+:.*\n){2,}/', substr($data, 0, 2000)))) {
                $add(vgEml($data), $name);
            } elseif (in_array($ext, ['pdf', 'docx', 'txt', 'text', 'html', 'htm', 'rtf', 'md'], true)) {
                $doc = vgDocText($name, $data);
                if (trim($doc) === '') {
                    $skipped[] = $name . ': no text could be read from it';
                    continue;
                }
                if (in_array($ext, ['txt', 'text', 'html', 'htm', 'md'], true)) {
                    $m = vgMail();
                    $m['text'] = $doc;
                    $add($m, $name);
                } else {
                    $mails[] = ['src' => $name, 'from' => ['', ''], 'subject' => '', 'body' => $doc, 'att' => '', 'doc' => trim(preg_replace('/[_\-]+|\b(?:jd|job\s*description)\b/i', ' ', pathinfo($name, PATHINFO_FILENAME)) ?? '')];
                }
            } elseif ($ext === 'doc') {
                $skipped[] = $name . ': an old Word file; save it as .docx or PDF';
            } else {
                $skipped[] = $name . ': not an email (.msg, .eml) or a document (PDF, Word, text)';
            }
        } catch (Throwable $e) {
            $skipped[] = $name . ': could not be read (' . $e->getMessage() . ')';
        }
    }
    if (trim($html) !== '' && (trim($text) === '' || preg_match('/<table\b/i', $html))) {
        $text = vgHtmlText($html);
    }
    if (trim($text) !== '') {
        $m = vgMail();
        $m['text'] = $text;
        $add($m, 'Pasted text');
    }
    return [$mails, $skipped];
}
/** The preview the desk shows: each requirement found, with duplicates and hotlists marked. */
function vgGrab(array $files, string $text, string $html): array
{
    [$mails, $skipped] = vgCollect($files, $text, $html);
    $desk = colAll(VMS_REQ);
    $items = [];
    $seen = [];
    foreach ($mails as $mi => $m) {
        $reqs = vgReqsFromMail($m['from'], $m['subject'], $m['body'], $m['att']);
        if (!$reqs) {
            continue;
        }
        foreach ($reqs as $ri => $r) {
            $f = $r['f'];
            if ($f['ti'] === '' && !empty($m['doc'])) {
                // a JD document with no title inside: its file name
                $f['ti'] = vgTitleTidy(ucwords((string) $m['doc']));
                $r['warn'] = $f['ti'] !== '' ? ['The role title is the file name: check it.'] : $r['warn'];
            }
            if ($f['ti'] === '' && mb_strlen(trim(preg_replace('/\s+/', ' ', $f['d']) ?? '')) < 80) {
                continue; // a reply or a forward note with no requirement in it
            }
            [$vid, $vn] = vgVendorFor($f['ce']);
            $f['vid'] = $vid;
            $f['vn'] = $vn !== '' ? $vn : ($f['co'] !== '' ? $f['co'] : ($f['ce'] !== '' && !preg_match('/@(?:gmail|yahoo|outlook|hotmail|live|aol|icloud)\./', $f['ce']) ? substr(strrchr($f['ce'], '@') ?: '', 1) : $f['cn']));
            $k = vgKey($f['ti']) . '|' . vgKey($f['loc']) . '|' . ($f['vref'] !== '' ? mb_strtolower($f['vref']) : vgKey($f['cl']));
            $dupBatch = $f['ti'] !== '' && isset($seen[$k]);
            $seen[$k] = true;
            $dup = $f['ti'] !== '' ? vgDupOnDesk($f, $desk) : null;
            $warn = $r['warn'];
            if ($dupBatch) {
                $warn[] = 'The same requirement appears earlier in what you dropped.';
            }
            if ($r['kind'] === 'hotlist') {
                $warn[] = 'This reads like a hotlist of consultants, not a requirement.';
            }
            $items[] = [
                'key' => 'g' . $mi . '_' . $ri,
                'src' => $m['src'],
                'part' => count($reqs) > 1 ? 'requirement ' . ($ri + 1) . ' of ' . count($reqs) : '',
                'subject' => mb_substr($m['subject'], 0, 300),
                'from' => ['e' => $m['from'][0], 'n' => $m['from'][1]],
                'f' => $f,
                'kind' => $r['kind'],
                'warn' => $warn,
                'dup' => $dup,
                'on' => !$dupBatch && !$dup && $r['kind'] === 'req' && $f['ti'] !== '',
                'raw' => $r['raw'],
            ];
            if (count($items) >= 200) {
                break 2;
            }
        }
    }
    return ['items' => $items, 'skipped' => $skipped, 'emails' => count($mails)];
}
/** v77: recruiter/vendor contact intelligence from signatures, pasted threads and requirement emails. */
function vgContactClass(string $ctx): array
{
    $lc = mb_strtolower($ctx);
    $kind = 'Recruiter';
    if (preg_match('/\bbench\s*(?:sales|marketing|recruiter|recruiting)|\bbench\s+consultants?\b|\bhot\s*list\b/', $lc)) {
        $kind = 'Bench Sales';
    } elseif (preg_match('/\bvendor\b|\bsupplier\b|\bstaffing\b|\bimplementation\s+partner\b|\bpreferred\s+vendor\b/', $lc)) {
        $kind = 'Vendor Recruiter';
    }
    $title = '';
    foreach (explode("\n", $ctx) as $ln) {
        $ln = trim($ln, " \t|,-–•");
        if ($ln === '' || mb_strlen($ln) > 100 || str_contains($ln, '@')) continue;
        if (preg_match('/\b(?:senior\s+|sr\.?\s+|lead\s+|technical\s+|it\s+)?(?:recruiter|talent\s+acquisition|account\s+manager|account\s+executive|business\s+development|bench\s+sales|resource\s+manager|delivery\s+manager|vendor\s+manager|staffing\s+manager|sales\s+recruiter)\b/i', $ln, $m)) {
            $title = mb_substr(trim($ln), 0, 120);
            break;
        }
    }
    $tags = ['Recruiter'];
    if ($kind === 'Bench Sales') $tags[] = 'Bench Sales';
    if ($kind === 'Vendor Recruiter') $tags[] = 'Vendor';
    return [$kind, $title, $tags];
}

function vgContactRows(string $text): array
{
    $text = vgNorm($text);
    if ($text === '') return [];
    $lines = explode("\n", $text);
    $out = [];
    foreach ($lines as $i => $line) {
        if (!preg_match_all('/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i', $line, $mm)) continue;
        foreach ($mm[0] as $email) {
            $email = strtolower(rtrim($email, '.,;:>)]'));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) continue;
            $lo = max(0, $i - 6); $hi = min(count($lines) - 1, $i + 7);
            $ctx = implode("\n", array_slice($lines, $lo, $hi - $lo + 1));
            [$name, $sigEmail, $phone, $company] = vgSignature($ctx, $ctx);
            if ($company === '') {
                $domain = strtolower((string) substr(strrchr($email, '@') ?: '', 1));
                $host = preg_replace('/\.(com|net|org|io|co|us|in|ai)$/i', '', $domain) ?: '';
                if ($host !== '' && !preg_match('/^(gmail|yahoo|outlook|hotmail|aol|icloud|protonmail)$/i', $host)) {
                    $company = ucwords(str_replace(['-', '_', '.'], ' ', $host));
                }
            }
            if ($name === '' && preg_match('/^\s*([A-Z][A-Za-z.\'\-]+(?:\s+[A-Z][A-Za-z.\'\-]+){1,3})\s*(?:<[^>]+>|$)/', $line, $nm)) $name = trim($nm[1]);
            [$kind, $title, $tags] = vgContactClass($ctx);
            $key = $email;
            if (!isset($out[$key])) {
                $out[$key] = [
                    'email' => $email, 'name' => $name, 'phone' => $phone, 'company' => $company,
                    'title' => $title, 'kind' => $kind, 'tags' => implode(', ', $tags),
                    'notes' => 'Captured from vendor/recruiter email', 'source' => 'Contact grabber', 'on' => true,
                ];
            } else {
                foreach (['name','phone','company','title'] as $k) {
                    $v = $$k ?? '';
                    if (($out[$key][$k] ?? '') === '' && $v !== '') $out[$key][$k] = $v;
                }
                if (($out[$key]['kind'] ?? '') === 'Recruiter' && $kind !== 'Recruiter') {
                    $out[$key]['kind'] = $kind;
                    $out[$key]['tags'] = implode(', ', $tags);
                }
            }
        }
    }
    return array_values($out);
}

/** Add duplicate/suppression state without changing the address book. */
function vgContactState(array $rows): array
{
    if (!$rows) return $rows;
    require_once __DIR__ . '/mail.php';
    $pdo = mdb();
    $find = $pdo->prepare('SELECT c.id, c.email, c.name, c.company, c.title, c.phone, c.tags, s.why FROM mail_contacts c LEFT JOIN mail_suppress s ON s.email = c.email WHERE c.email = ?');
    foreach ($rows as $i => $r) {
        $find->execute([strtolower((string) ($r['email'] ?? ''))]);
        $cur = $find->fetch();
        $rows[$i]['existing'] = (bool) $cur;
        $rows[$i]['existingId'] = $cur ? (string) $cur['id'] : '';
        $rows[$i]['suppressed'] = $cur && (string) ($cur['why'] ?? '') !== '' ? (string) $cur['why'] : '';
        if ($cur) {
            foreach (['name','company','title','phone'] as $k) {
                if ((string) ($rows[$i][$k] ?? '') === '' && (string) ($cur[$k] ?? '') !== '') $rows[$i][$k] = (string) $cur[$k];
            }
        }
    }
    return $rows;
}

/** Staff names used only for a lightweight Contact Grabber assignment tag. */
function vgContactOwners(): array
{
    $out = [];
    try {
        $st = db()->query("SELECT id, name, email, role FROM users WHERE status = 'active' ORDER BY name LIMIT 1000");
        foreach ($st->fetchAll() as $r) {
            $role = strtolower((string) ($r['role'] ?? ''));
            if (in_array($role, ['client','student'], true)) continue;
            $out[] = ['id' => (string) $r['id'], 'name' => (string) $r['name'], 'email' => (string) $r['email'], 'role' => $role];
        }
    } catch (Throwable $e) {}
    return $out;
}

/** Save selected requirement previews from either Requirement Grabber or Contact Intelligence. */
function vgSaveReqItems(array $items, array $u, string $status = 'open'): array
{
    $st = in_array($status, ['open','new'], true) ? $status : 'open';
    $ids=[]; $skipped=[]; $gks=[];
    foreach (colAll(VMS_REQ) as [$rid,$q]) if ((string)($q->gk??'')!=='') $gks[(string)$q->gk]=true;
    foreach (array_slice($items,0,200) as $it) {
        if (!is_array($it) || (array_key_exists('on',$it) && empty($it['on']))) continue;
        // Contact Intelligence sends the same preview objects returned by vgGrab(); Requirement Grabber may send fields directly.
        $raw = isset($it['f']) && is_array($it['f']) ? array_merge($it['f'], array_intersect_key($it, array_flip(['vref','ip','exp','iv','pref']))) : $it;
        $f=vmsReqFields($raw);
        if ($f['ti']==='' || mb_strlen($f['ti'])<2) { $skipped[]='one without a role title'; continue; }
        $gk=substr(hash('sha256',mb_strtolower($f['ti'].'|'.$f['loc'].'|'.$f['ce'].'|'.mb_substr($f['d'],0,600))),0,24);
        if (isset($gks[$gk])) { $skipped[]=$f['ti'].' (already added)'; continue; }
        $extra=['st'=>$st,'by'=>$u['id'],'via'=>'grab','gk'=>$gk];
        foreach (['vref'=>40,'ip'=>160,'exp'=>60,'iv'=>120,'pref'=>600] as $k=>$max) { $v=vmsStr($raw[$k]??'', $max); if($v!=='')$extra[$k]=$v; }
        $ids[]=vmsReqSave($f,'email',$extra); $gks[$gk]=true;
    }
    return ['ids'=>$ids,'skipped'=>$skipped];
}

function vgRoute(string $r, array $b): void
{
    $u = vmsStaff();
    switch ($r) {
        case 'vms_contact_grab':
            $text = mb_substr((string) ($b['text'] ?? ''), 0, 600000);
            if (trim($text) === '') fail(400, 'invalid_argument', 'Paste one or more vendor/recruiter emails or signatures first.');
            if (throttleHit('contactgrab:' . $u['id'], 80, 3600)) fail(429, 'rate_limited', 'Contact Grabber has been run many times this hour. Try again later.');
            $rows = vgContactState(array_slice(vgContactRows($text), 0, 300));
            // Reuse Email Validation's local/DNS/bounce checks so recruiters see bad/risky addresses before saving or campaigning.
            require_once __DIR__ . '/tools.php';
            $ctx = mailCheckContext();
            foreach ($rows as $i => $row) {
                $check = mailCheckOne((string) ($row['email'] ?? ''), $ctx);
                $rows[$i]['validation'] = $check ?: ['e'=>(string)($row['email']??''),'st'=>'bad','why'=>['Not a valid address'],'fix'=>''];
            }
            $grab = vgGrab([], $text, '');
            ok(['rows'=>$rows,'n'=>count($rows),'requirements'=>$grab['items']??[],'requirementCount'=>count($grab['items']??[]),'owners'=>vgContactOwners()]);
        case 'vms_contact_grab_save':
            require_once __DIR__ . '/mail.php';
            $rows = array_values(array_filter(array_slice((array) ($b['rows'] ?? []), 0, 500), fn($r)=>is_array($r) && (!array_key_exists('on',$r) || !empty($r['on']))));
            $mode = in_array((string)($b['mode']??'both'), ['new','existing','both'], true) ? (string)$b['mode'] : 'both';
            $pdo = mdb(); $exists = $pdo->prepare('SELECT 1 FROM mail_contacts WHERE email = ?'); $safe=[]; $held=0;
            foreach ($rows as $r) {
                $email=strtolower(trim((string)($r['email']??''))); $exists->execute([$email]); $isExisting=(bool)$exists->fetchColumn();
                if (($mode==='new'&&$isExisting)||($mode==='existing'&&!$isExisting)) continue;
                $v=(array)($r['validation']??[]); if (($v['st']??'')==='bad' || !empty($r['suppressed'])) { $held++; continue; }
                $safe[]=$r;
            }
            $extra=['Vendor','Recruiter','Grabbed']; $tag=mb_substr(trim((string)($b['tag']??'')),0,40); if($tag!=='')$extra[]=$tag;
            $ownerId=mb_substr(trim((string)($b['owner']??'')),0,40); $ownerName='';
            if($ownerId!==''){ $st=db()->prepare("SELECT name FROM users WHERE id = ? AND status = 'active' LIMIT 1");$st->execute([$ownerId]);$ownerName=(string)($st->fetchColumn()?:''); if($ownerName!=='')$extra[]='Owner: '.mb_substr($ownerName,0,60); }
            $res = mailUpsertContacts($safe, $extra, 'Contact grabber', (string) $u['id']);
            $reqRes = vgSaveReqItems((array)($b['requirements']??[]), $u, (string)($b['st']??'open'));
            $res['held']=$held; $res['requirements']=count($reqRes['ids']); $res['requirementIds']=$reqRes['ids']; $res['requirementSkipped']=$reqRes['skipped'];
            audit('data', 'Vendor/recruiter contacts grabbed', 'mail_contacts', ['added'=>$res['added'],'updated'=>$res['updated'],'invalid'=>$res['invalid'],'held'=>$held,'requirements'=>$res['requirements'],'owner'=>$ownerName], $u);
            ok($res);
        case 'vms_grab':
            if (throttleHit('vmsgrab:' . $u['id'], 120, 3600)) {
                fail(429, 'rate_limited', 'That is a lot of emails in an hour. Try again a little later.');
            }
            @set_time_limit(120);
            $files = [];
            if (!empty($_FILES['files']) && is_array($_FILES['files']['name'] ?? null)) {
                foreach ((array) $_FILES['files']['name'] as $i => $name) {
                    $tmp = (string) ($_FILES['files']['tmp_name'][$i] ?? '');
                    if ((int) ($_FILES['files']['error'][$i] ?? 1) === 0 && is_uploaded_file($tmp)) {
                        $files[] = [mb_substr(basename((string) $name), 0, 180), (string) file_get_contents($tmp)];
                    } elseif ((int) ($_FILES['files']['error'][$i] ?? 0) !== 4) {
                        $files[] = [mb_substr(basename((string) $name), 0, 180), ''];
                    }
                }
            }
            $text = (string) ($_POST['text'] ?? ($b['text'] ?? ''));
            $html = (string) ($_POST['html'] ?? ($b['html'] ?? ''));
            if (!$files && trim($text) === '' && trim($html) === '') {
                fail(400, 'invalid_argument', 'Drop emails or JD files, or paste the email text first.');
            }
            ok(vgGrab($files, mb_substr($text, 0, 400000), mb_substr($html, 0, 800000)));
        case 'vms_grab_save':
            $res = vgSaveReqItems((array)($b['items']??[]), $u, (string)($b['st']??'open'));
            audit('data', 'Requirements grabbed from emails', (string) count($res['ids']), ['by' => $u['email'] ?? '']);
            ok($res);
    }
    fail(404, 'not_found', 'Unknown action.');
}
