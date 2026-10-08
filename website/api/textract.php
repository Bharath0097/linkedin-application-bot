<?php
declare(strict_types=1);
/* Plain-text extraction for resumes and job posts: HTML, Word (.docx), PDF and text files.
   Pure PHP (zlib only), so it works on any shared host. The browser also reads PDFs with PDF.js
   and sends the text along; this is the fallback when that is not available. */

function utf8ify(string $s): string
{
    if (str_starts_with($s, "\xEF\xBB\xBF")) {
        $s = substr($s, 3);
    } elseif (str_starts_with($s, "\xFF\xFE")) {
        $s = (string) mb_convert_encoding(substr($s, 2), 'UTF-8', 'UTF-16LE');
    } elseif (str_starts_with($s, "\xFE\xFF")) {
        $s = (string) mb_convert_encoding(substr($s, 2), 'UTF-8', 'UTF-16BE');
    }
    if (!mb_check_encoding($s, 'UTF-8')) {
        $s = (string) mb_convert_encoding($s, 'UTF-8', 'Windows-1252');
    }
    return $s;
}
function cleanText(string $s, int $max = 300000): string
{
    $s = utf8ify($s);
    $s = str_replace(["\r\n", "\r", "\xC2\xA0", "\u{200B}", "\u{FEFF}"], ["\n", "\n", ' ', '', ''], $s);
    $s = preg_replace('/[^\P{C}\n\t]/u', '', $s) ?? $s;
    $s = preg_replace("/[ \t]+/u", ' ', $s) ?? $s;
    $s = preg_replace("/ *\n */u", "\n", $s) ?? $s;
    $s = preg_replace("/\n{3,}/u", "\n\n", $s) ?? $s;
    return mb_substr(trim($s), 0, $max);
}
function htmlToText(string $h): string
{
    if ($h === '') {
        return '';
    }
    $h = utf8ify($h);
    if (!preg_match('/<[a-z!\/]/i', $h)) {
        return cleanText(html_entity_decode($h, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    }
    $h = preg_replace('#<(script|style|head)\b[^>]*>.*?</\1>#is', ' ', $h) ?? $h;
    $h = preg_replace('#<li\b[^>]*>#i', "\n• ", $h) ?? $h;
    $h =
        preg_replace(
            '#</?(br|p|div|h[1-6]|tr|ul|ol|table|section|article|header|footer|blockquote|pre)\b[^>]*>#i',
            "\n",
            $h,
        ) ?? $h;
    $h = preg_replace('#</(li|td|th)>#i', "\n", $h) ?? $h;
    $h = strip_tags($h);
    $h = html_entity_decode($h, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    if (preg_match('/&(?:amp;)?(?:lt|gt|nbsp|amp|quot|#\d+);/', $h)) {
        $h = html_entity_decode($h, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        if (preg_match('/<[a-z\/]/i', $h)) {
            $h = strip_tags($h);
        }
    } // double-encoded feeds
    return cleanText($h);
}
function textFromFile(string $path, string $ext): string
{
    $data = @file_get_contents($path);
    if ($data === false || $data === '') {
        return '';
    }
    try {
        if ($ext === 'txt') {
            return cleanText($data);
        }
        if ($ext === 'docx') {
            return cleanText(docxText($data));
        }
        if ($ext === 'pdf') {
            return cleanText(pdfText($data));
        }
    } catch (Throwable $e) {
        @error_log(
            date('c') . ' text extraction failed: ' . $e->getMessage() . "\n",
            3,
            storeDir() . '/error.log',
        );
    }
    return '';
}

/* ---------- Word (.docx) ---------- */
function zipEntries(string $zip, string $want = '#^word/(document|header\d*|footer\d*)\.xml$#'): array
{
    // name => contents of the entries whose names match $want (a Word document's text by default), without needing
    // the zip extension. v38.1: other patterns (a spreadsheet's xl/ parts) for the imports.
    $out = [];
    if (class_exists('ZipArchive')) {
        $tmp = tempnam(sys_get_temp_dir(), 'dx');
        file_put_contents($tmp, $zip);
        $z = new ZipArchive();
        if ($z->open($tmp) === true) {
            for ($i = 0; $i < $z->numFiles; $i++) {
                $n = (string) $z->getNameIndex($i);
                if (preg_match($want, $n)) {
                    $c = $z->getFromIndex($i);
                    if ($c !== false) {
                        $out[$n] = $c;
                    }
                }
            }
            $z->close();
        }
        @unlink($tmp);
        if ($out) {
            return $out;
        }
    }
    $eocd = strrpos($zip, "PK\x05\x06");
    if ($eocd === false) {
        return [];
    }
    $cdSize = unpack('V', substr($zip, $eocd + 12, 4))[1];
    $p = unpack('V', substr($zip, $eocd + 16, 4))[1];
    $end = $p + $cdSize;
    while ($p < $end && substr($zip, $p, 4) === "PK\x01\x02") {
        $h = unpack(
            'vmethod/vtime/vdate/Vcrc/Vcsize/Vusize/vnlen/vxlen/vclen/vdisk/vint/Vext/Voff',
            substr($zip, $p + 10, 36),
        );
        $name = substr($zip, $p + 46, $h['nlen']);
        $p += 46 + $h['nlen'] + $h['xlen'] + $h['clen'];
        if (!preg_match($want, $name)) {
            continue;
        }
        $lh = unpack('vnlen/vxlen', substr($zip, $h['off'] + 26, 4));
        $start = $h['off'] + 30 + $lh['nlen'] + $lh['xlen'];
        $raw = substr($zip, $start, $h['csize']);
        $c = $h['method'] === 8 ? @gzinflate($raw) : ($h['method'] === 0 ? $raw : false);
        if ($c !== false) {
            $out[$name] = $c;
        }
    }
    return $out;
}
function docxText(string $data): string
{
    $e = zipEntries($data);
    if (!$e) {
        return '';
    }
    $order = array_keys($e);
    usort(
        $order,
        fn($a, $b) => (str_contains($a, 'header') ? 0 : (str_contains($a, 'document') ? 1 : 2)) <=>
            (str_contains($b, 'header') ? 0 : (str_contains($b, 'document') ? 1 : 2)),
    );
    $out = [];
    foreach ($order as $n) {
        $x = $e[$n];
        $x = preg_replace('#<w:delText\b[^>]*>.*?</w:delText>#s', '', $x) ?? $x;
        $x = preg_replace('#<w:tab\b[^>]*/>#', "\t", $x) ?? $x;
        $x = preg_replace('#<w:(br|cr)\b[^>]*/>#', "\n", $x) ?? $x;
        $x = preg_replace('#</w:p>#', "\n", $x) ?? $x;
        $x = preg_replace('#</w:tc>#', "\t", $x) ?? $x;
        $out[] = html_entity_decode(strip_tags($x), ENT_QUOTES | ENT_XML1, 'UTF-8');
    }
    return implode("\n", $out);
}

/* ---------- PDF ---------- */
function pdfText(string $pdf, int $maxPages = 20): string
{
    if (
        !str_starts_with(ltrim(substr($pdf, 0, 1024)), '%PDF') &&
        !str_contains(substr($pdf, 0, 1024), '%PDF')
    ) {
        return '';
    }
    if (preg_match('#/Encrypt\s+\d+\s+\d+\s+R#', $pdf)) {
        return '';
    } // encrypted: the browser (PDF.js) can still read it
    $objs = pdfObjects($pdf);
    if (!$objs) {
        return '';
    }
    $pages = pdfPages($pdf, $objs);
    $fc = [];
    $out = [];
    foreach (array_slice($pages, 0, $maxPages) as $pg) {
        $cs = '';
        foreach (pdfContentRefs($objs, $pg['dict']) as $ref) {
            if (isset($objs[$ref]) && $objs[$ref]['s'] !== null) {
                $cs .= pdfDecode($objs[$ref]['d'], $objs[$ref]['s']) . "\n";
            }
            if (strlen($cs) > 4000000) {
                break;
            }
        }
        $out[] = pdfRunText($cs, $objs, $pg['res'], 0, $fc);
    }
    return implode("\n\n", $out);
}
function pdfObjects(string $pdf): array
{
    if (!preg_match_all('/(?<![0-9])(\d{1,7})\s+(\d{1,5})\s+obj\b/', $pdf, $m, PREG_OFFSET_CAPTURE)) {
        return [];
    }
    $objs = [];
    $n = count($m[0]);
    $len = strlen($pdf);
    for ($i = 0; $i < $n; $i++) {
        $num = (int) $m[1][$i][0];
        $start = $m[0][$i][1] + strlen($m[0][$i][0]);
        $end = $i + 1 < $n ? $m[0][$i + 1][1] : $len;
        $chunk = substr($pdf, $start, $end - $start);
        if (preg_match('/>>\s*stream(\r\n|\n|\r)/', $chunk, $sm, PREG_OFFSET_CAPTURE)) {
            $dict = substr($chunk, 0, $sm[0][1] + 2);
            $ds = $sm[0][1] + strlen($sm[0][0]);
            $es = strpos($chunk, 'endstream', $ds);
            $raw = null;
            if (preg_match('#/Length\s+(\d+)(?!\s+\d+\s+R)#', $dict, $lm)) {
                $l = (int) $lm[1];
                if ($ds + $l <= strlen($chunk) && ($es === false || $ds + $l <= $es)) {
                    $raw = substr($chunk, $ds, $l);
                }
            }
            if ($raw === null) {
                $raw = $es === false ? substr($chunk, $ds) : rtrim(substr($chunk, $ds, $es - $ds), "\r\n");
            }
            $objs[$num] = ['d' => $dict, 's' => $raw];
        } else {
            $e = strpos($chunk, 'endobj');
            $objs[$num] = ['d' => $e === false ? $chunk : substr($chunk, 0, $e), 's' => null];
        }
    }
    foreach ($objs as $o) {
        // compressed object streams (PDF 1.5+)
        if ($o['s'] === null || !preg_match('#/Type\s*/ObjStm\b#', $o['d'])) {
            continue;
        }
        $data = pdfDecode($o['d'], $o['s']);
        if ($data === '') {
            continue;
        }
        $first = preg_match('#/First\s+(\d+)#', $o['d'], $fm) ? (int) $fm[1] : 0;
        $cnt = preg_match('#/N\s+(\d+)#', $o['d'], $nm) ? (int) $nm[1] : 0;
        $hdr = preg_split('/\s+/', trim(substr($data, 0, $first))) ?: [];
        $pairs = [];
        for ($k = 0; $k + 1 < count($hdr) && count($pairs) < $cnt; $k += 2) {
            $pairs[] = [(int) $hdr[$k], (int) $hdr[$k + 1]];
        }
        foreach ($pairs as $idx => [$on, $off]) {
            $s0 = $first + $off;
            $s1 = isset($pairs[$idx + 1]) ? $first + $pairs[$idx + 1][1] : strlen($data);
            if (!isset($objs[$on])) {
                $objs[$on] = ['d' => substr($data, $s0, max(0, $s1 - $s0)), 's' => null];
            }
        }
    }
    return $objs;
}
function pdfDecode(string $dict, string $raw): string
{
    $f = [];
    if (preg_match('#/Filter\s*\[([^\]]*)\]#', $dict, $m)) {
        preg_match_all('#/(\w+)#', $m[1], $fm);
        $f = $fm[1];
    } elseif (preg_match('#/Filter\s*/(\w+)#', $dict, $m)) {
        $f = [$m[1]];
    }
    $d = $raw;
    foreach ($f as $x) {
        if ($x === 'FlateDecode' || $x === 'Fl') {
            $y = @gzuncompress($d);
            if ($y === false) {
                $y = @gzinflate(substr($d, 2));
            }
            if ($y === false) {
                $y = pdfInflatePartial($d);
            }
            $d = (string) $y;
        } elseif ($x === 'ASCIIHexDecode' || $x === 'AHx') {
            $h = preg_replace('/[^0-9A-Fa-f]/', '', $d) ?? '';
            if (strlen($h) % 2) {
                $h .= '0';
            }
            $d = (string) @hex2bin($h);
        } elseif ($x === 'ASCII85Decode' || $x === 'A85') {
            $d = pdfA85($d);
        } else {
            return '';
        } // images and other binary data
    }
    return $d;
}
function pdfInflatePartial(string $d): string
{
    if (!function_exists('inflate_init')) {
        return '';
    }
    $ctx = @inflate_init(ZLIB_ENCODING_DEFLATE);
    if (!$ctx) {
        return '';
    }
    $out = '';
    foreach (str_split($d, 4096) as $c) {
        $r = @inflate_add($ctx, $c, ZLIB_SYNC_FLUSH);
        if ($r === false) {
            break;
        }
        $out .= $r;
    }
    return $out;
}
function pdfA85(string $s): string
{
    $s = preg_replace('/\s+/', '', $s) ?? '';
    if (str_starts_with($s, '<~')) {
        $s = substr($s, 2);
    }
    $e = strpos($s, '~>');
    if ($e !== false) {
        $s = substr($s, 0, $e);
    }
    $out = '';
    $g = [];
    for ($i = 0, $n = strlen($s); $i < $n; $i++) {
        if ($s[$i] === 'z' && !$g) {
            $out .= "\0\0\0\0";
            continue;
        }
        $g[] = ord($s[$i]) - 33;
        if (count($g) === 5) {
            $v = 0;
            foreach ($g as $c) {
                $v = $v * 85 + $c;
            }
            $out .= pack('N', $v & 0xffffffff);
            $g = [];
        }
    }
    if ($g) {
        $k = count($g);
        while (count($g) < 5) {
            $g[] = 84;
        }
        $v = 0;
        foreach ($g as $c) {
            $v = $v * 85 + $c;
        }
        $out .= substr(pack('N', $v & 0xffffffff), 0, $k - 1);
    }
    return $out;
}
function pdfRef(string $d, string $key): ?int
{
    return preg_match('#/' . $key . '\s+(\d+)\s+\d+\s+R#', $d, $m) ? (int) $m[1] : null;
}
function pdfInlineDict(string $d, string $key): ?string
{
    if (!preg_match('#/' . $key . '\s*<<#', $d, $m, PREG_OFFSET_CAPTURE)) {
        return null;
    }
    $i = $m[0][1] + strlen($m[0][0]) - 2;
    $start = $i;
    $depth = 0;
    $n = strlen($d);
    while ($i < $n) {
        if ($d[$i] === '<' && ($d[$i + 1] ?? '') === '<') {
            $depth++;
            $i += 2;
            continue;
        }
        if ($d[$i] === '>' && ($d[$i + 1] ?? '') === '>') {
            $depth--;
            $i += 2;
            if ($depth === 0) {
                return substr($d, $start, $i - $start);
            }
            continue;
        }
        $i++;
    }
    return null;
}
function pdfDictOf(array $objs, string $d, string $key): ?string
{
    $r = pdfRef($d, $key);
    if ($r !== null) {
        return $objs[$r]['d'] ?? null;
    }
    return pdfInlineDict($d, $key);
}
function pdfPages(string $pdf, array $objs): array
{
    $pages = [];
    $root = preg_match_all('#/Root\s+(\d+)\s+\d+\s+R#', $pdf, $m) ? (int) end($m[1]) : 0;
    if ($root && isset($objs[$root]) && ($pr = pdfRef($objs[$root]['d'], 'Pages')) !== null) {
        pdfWalk($objs, $pr, null, $pages, 0);
    }
    if (!$pages) {
        foreach ($objs as $o) {
            if (preg_match('#/Type\s*/Page(?![a-zA-Z])#', $o['d'])) {
                $pages[] = ['dict' => $o['d'], 'res' => pdfDictOf($objs, $o['d'], 'Resources')];
            }
        };
    }
    return $pages;
}
function pdfWalk(array $objs, int $n, ?string $inh, array &$pages, int $depth): void
{
    if ($depth > 25 || !isset($objs[$n]) || count($pages) > 300) {
        return;
    }
    $d = $objs[$n]['d'];
    $res = pdfDictOf($objs, $d, 'Resources') ?? $inh;
    if (preg_match('#/Kids\s*\[([^\]]*)\]#', $d, $km)) {
        preg_match_all('#(\d+)\s+\d+\s+R#', $km[1], $rm);
        foreach ($rm[1] as $k) {
            pdfWalk($objs, (int) $k, $res, $pages, $depth + 1);
        }
    } elseif (preg_match('#/Type\s*/Page(?![a-zA-Z])#', $d) || preg_match('#/Contents#', $d)) {
        $pages[] = ['dict' => $d, 'res' => $res];
    }
}
function pdfContentRefs(array $objs, string $d): array
{
    if (preg_match('#/Contents\s*\[([^\]]*)\]#', $d, $m)) {
        preg_match_all('#(\d+)\s+\d+\s+R#', $m[1], $r);
        return array_map('intval', $r[1]);
    }
    if (preg_match('#/Contents\s+(\d+)\s+\d+\s+R#', $d, $m)) {
        $n = (int) $m[1];
        if (
            isset($objs[$n]) &&
            $objs[$n]['s'] === null &&
            preg_match('#^\s*\[([^\]]*)\]#', $objs[$n]['d'], $am)
        ) {
            preg_match_all('#(\d+)\s+\d+\s+R#', $am[1], $r);
            return array_map('intval', $r[1]);
        }
        return [$n];
    }
    return [];
}
function pdfFonts(array $objs, ?string $res, array &$fc): array
{
    if ($res === null) {
        return [];
    }
    $fd = pdfDictOf($objs, $res, 'Font');
    if ($fd === null) {
        return [];
    }
    preg_match_all('#/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R#', $fd, $m, PREG_SET_ORDER);
    $fonts = [];
    foreach ($m as $x) {
        $n = (int) $x[2];
        if (!isset($fc[$n])) {
            $fc[$n] = pdfFont($objs, $n);
        }
        $fonts[$x[1]] = $fc[$n];
    }
    return $fonts;
}
function pdfInlineArray(array $objs, string $d, string $key): ?string
{
    if (preg_match('#/' . $key . '\s+(\d+)\s+\d+\s+R#', $d, $m)) {
        $b = $objs[(int) $m[1]]['d'] ?? '';
        $s = strpos($b, '[');
        $e = strrpos($b, ']');
        return $s !== false && $e !== false && $e > $s ? substr($b, $s + 1, $e - $s - 1) : null;
    }
    if (!preg_match('#/' . $key . '\s*\[#', $d, $m, PREG_OFFSET_CAPTURE)) {
        return null;
    }
    $i = $m[0][1] + strlen($m[0][0]);
    $start = $i;
    $depth = 1;
    $n = strlen($d);
    while ($i < $n) {
        if ($d[$i] === '[') {
            $depth++;
        } elseif ($d[$i] === ']') {
            $depth--;
            if ($depth === 0) {
                return substr($d, $start, $i - $start);
            }
        }
        $i++;
    }
    return null;
}
function pdfFont(array $objs, int $n): array
{
    $d = $objs[$n]['d'] ?? '';
    $type0 = (bool) preg_match('#/Subtype\s*/Type0#', $d);
    $map = [];
    $bytes = $type0 ? 2 : 1;
    $diff = [];
    $w = [];
    $dw = $type0 ? 1000.0 : 520.0;
    $tu = pdfRef($d, 'ToUnicode');
    if ($tu !== null && isset($objs[$tu]) && $objs[$tu]['s'] !== null) {
        [$map, $cb] = pdfCMap(pdfDecode($objs[$tu]['d'], $objs[$tu]['s']));
        if ($cb) {
            $bytes = $cb;
        }
    }
    if (!$type0) {
        $enc = pdfDictOf($objs, $d, 'Encoding');
        if ($enc !== null && preg_match('#/Differences\s*\[([^\]]*)\]#', $enc, $dm)) {
            $code = 0;
            preg_match_all('#(\d+)|/([^\s/\[\]]+)#', $dm[1], $tm, PREG_SET_ORDER);
            foreach ($tm as $t) {
                if ($t[1] !== '') {
                    $code = (int) $t[1];
                } else {
                    $diff[$code] = pdfGlyph($t[2]);
                    $code++;
                }
            }
        }
        $fc = preg_match('#/FirstChar\s+(\d+)#', $d, $m) ? (int) $m[1] : 0;
        $wa = pdfInlineArray($objs, $d, 'Widths');
        if ($wa !== null && preg_match_all('/-?\d+(?:\.\d+)?/', $wa, $wm)) {
            foreach ($wm[0] as $i => $x) {
                $w[$fc + $i] = (float) $x;
            };
        }
        if ($w && (preg_match('#/Subtype\s*/TrueType#', $d) || preg_match('#/Subtype\s*/Type1#', $d))) {
            $nz = array_filter($w);
            if ($nz) {
                $dw = array_sum($nz) / count($nz);
            }
        }
    } else {
        $da = pdfInlineArray($objs, $d, 'DescendantFonts');
        $cid = null;
        if ($da !== null && preg_match('#(\d+)\s+\d+\s+R#', $da, $cm)) {
            $cid = $objs[(int) $cm[1]]['d'] ?? null;
        }
        if ($cid !== null) {
            if (preg_match('#/DW\s+(\d+(?:\.\d+)?)#', $cid, $m)) {
                $dw = (float) $m[1];
            }
            $wa = pdfInlineArray($objs, $cid, 'W');
            if ($wa !== null && preg_match_all('/\[|\]|-?\d+(?:\.\d+)?/', $wa, $tm)) {
                $tk = $tm[0];
                $i = 0;
                $c = count($tk);
                while ($i < $c) {
                    if ($tk[$i] === '[' || $tk[$i] === ']') {
                        $i++;
                        continue;
                    }
                    if (($tk[$i + 1] ?? '') === '[') {
                        $code = (int) $tk[$i];
                        $i += 2;
                        while ($i < $c && $tk[$i] !== ']') {
                            if ($tk[$i] !== '[') {
                                $w[$code++] = (float) $tk[$i];
                            }
                            $i++;
                        }
                        $i++;
                    } elseif (isset($tk[$i + 2]) && $tk[$i + 2] !== '[' && $tk[$i + 2] !== ']') {
                        $a = (int) $tk[$i];
                        $b = min((int) $tk[$i + 1], $a + 65535);
                        $x = (float) $tk[$i + 2];
                        if ($b - $a < 2000) {
                            for ($k = $a; $k <= $b; $k++) {
                                $w[$k] = $x;
                            };
                        }
                        $i += 3;
                    } else {
                        $i++;
                    }
                }
            }
        }
    }
    return ['type0' => $type0, 'map' => $map, 'bytes' => $bytes, 'diff' => $diff, 'w' => $w, 'dw' => $dw];
}
function pdfRunWidth(string $b, ?array $f, float $size, float $tc, float $tw): float
{
    $n = $f ? max(1, (int) $f['bytes']) : 1;
    $len = strlen($b);
    $w = 0.0;
    for ($i = 0; $i + $n <= $len; $i += $n) {
        $code =
            $n === 1
                ? ord($b[$i])
                : ($n === 2
                    ? (ord($b[$i]) << 8) | ord($b[$i + 1])
                    : (int) hexdec(bin2hex(substr($b, $i, $n))));
        $w +=
            (($f ? $f['w'][$code] ?? $f['dw'] : 520.0) / 1000.0) * $size +
            $tc +
            ($n === 1 && $code === 32 ? $tw : 0.0);
    }
    return $w;
}
function pdfGlyph(string $g): string
{
    static $m = [
        'space' => ' ',
        'period' => '.',
        'comma' => ',',
        'hyphen' => '-',
        'colon' => ':',
        'semicolon' => ';',
        'parenleft' => '(',
        'parenright' => ')',
        'slash' => '/',
        'at' => '@',
        'ampersand' => '&',
        'quoteright' => '’',
        'quoteleft' => '‘',
        'quotedblleft' => '“',
        'quotedblright' => '”',
        'quotesingle' => "'",
        'quotedbl' => '"',
        'endash' => '–',
        'emdash' => '—',
        'bullet' => '•',
        'fi' => 'fi',
        'fl' => 'fl',
        'plus' => '+',
        'numbersign' => '#',
        'percent' => '%',
        'dollar' => '$',
        'underscore' => '_',
        'question' => '?',
        'exclam' => '!',
        'bar' => '|',
        'asterisk' => '*',
        'equal' => '=',
        'less' => '<',
        'greater' => '>',
        'bracketleft' => '[',
        'bracketright' => ']',
        'braceleft' => '{',
        'braceright' => '}',
        'zero' => '0',
        'one' => '1',
        'two' => '2',
        'three' => '3',
        'four' => '4',
        'five' => '5',
        'six' => '6',
        'seven' => '7',
        'eight' => '8',
        'nine' => '9',
        'nbspace' => ' ',
        'ellipsis' => '…',
        'trademark' => '™',
        'registered' => '®',
        'copyright' => '©',
    ];
    if (isset($m[$g])) {
        return $m[$g];
    }
    if (preg_match('/^[A-Za-z]$/', $g)) {
        return $g;
    }
    if (preg_match('/^uni([0-9A-Fa-f]{4})/', $g, $u)) {
        return (string) mb_chr((int) hexdec($u[1]), 'UTF-8');
    }
    return '';
}
function pdfU16(string $hex): string
{
    if ($hex === '') {
        return '';
    }
    if (strlen($hex) % 2) {
        $hex .= '0';
    }
    $b = @hex2bin($hex);
    return $b === false ? '' : (string) mb_convert_encoding($b, 'UTF-8', 'UTF-16BE');
}
function pdfCMap(string $c): array
{
    $map = [];
    $bytes = 0;
    if (preg_match('#begincodespacerange\s*<([0-9A-Fa-f]+)>#', $c, $m)) {
        $bytes = intdiv(strlen($m[1]), 2);
    }
    if (preg_match_all('#beginbfchar(.*?)endbfchar#s', $c, $bm)) {
        foreach ($bm[1] as $blk) {
            preg_match_all('#<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>#', $blk, $pm, PREG_SET_ORDER);
            foreach ($pm as $p) {
                $map[(int) hexdec($p[1])] = pdfU16($p[2]);
            }
        };
    }
    if (preg_match_all('#beginbfrange(.*?)endbfrange#s', $c, $rm)) {
        foreach ($rm[1] as $blk) {
            preg_match_all(
                '#<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]*)>|\[([^\]]*)\])#',
                $blk,
                $pm,
                PREG_SET_ORDER,
            );
            foreach ($pm as $p) {
                $a = (int) hexdec($p[1]);
                $b = (int) hexdec($p[2]);
                if ($b < $a || $b - $a > 65535) {
                    continue;
                }
                if (isset($p[4]) && $p[4] !== '') {
                    preg_match_all('#<([0-9A-Fa-f]*)>#', $p[4], $am);
                    foreach ($am[1] as $i => $h) {
                        $map[$a + $i] = pdfU16($h);
                    }
                    continue;
                }
                $base = $p[3] ?? '';
                if ($base === '') {
                    continue;
                }
                if (strlen($base) % 2) {
                    $base .= '0';
                }
                $units = array_values(
                    unpack('n*', (string) hex2bin(strlen($base) % 4 ? '00' . $base : $base)) ?: [],
                );
                if (!$units) {
                    continue;
                }
                for ($c2 = $a; $c2 <= $b; $c2++) {
                    $u = $units;
                    $u[count($u) - 1] += $c2 - $a;
                    $map[$c2] = (string) mb_convert_encoding(pack('n*', ...$u), 'UTF-8', 'UTF-16BE');
                }
            }
        };
    }
    return [$map, $bytes];
}
function pdfStr(string $b, ?array $f): string
{
    if ($f === null) {
        return (string) mb_convert_encoding($b, 'UTF-8', 'Windows-1252');
    }
    if ($f['map']) {
        $out = '';
        $n = max(1, (int) $f['bytes']);
        $len = strlen($b);
        for ($i = 0; $i + $n <= $len; $i += $n) {
            $code =
                $n === 1
                    ? ord($b[$i])
                    : ($n === 2
                        ? (ord($b[$i]) << 8) | ord($b[$i + 1])
                        : (int) hexdec(bin2hex(substr($b, $i, $n))));
            $out .=
                $f['map'][$code] ??
                ($n === 1 ? (string) mb_convert_encoding(chr($code), 'UTF-8', 'Windows-1252') : '');
        }
        return $out;
    }
    if ($f['type0']) {
        return '';
    } // composite font without a Unicode map: the codes are glyph numbers, not letters
    $out = '';
    for ($i = 0, $len = strlen($b); $i < $len; $i++) {
        $c = ord($b[$i]);
        $out .= $f['diff'][$c] ?? (string) mb_convert_encoding($b[$i], 'UTF-8', 'Windows-1252');
    }
    return $out;
}
/* Reads the text operators of a content stream. Line breaks come from changes in the vertical text position;
 word gaps come from the pen position (glyph widths from the font) when words are placed one by one. */
function pdfRunText(string $cs, array $objs, ?string $res, int $depth, array &$fc): string
{
    $fonts = pdfFonts($objs, $res, $fc);
    $font = null;
    $size = 10.0;
    $sx = 1.0;
    $sy = 1.0;
    $tc = 0.0;
    $tw = 0.0;
    $out = '';
    $st = [];
    $lx = 0.0;
    $ly = 0.0;
    $px = 0.0;
    $py = 0.0;
    $lead = 0.0;
    $lastY = null;
    $lastEnd = null;
    $show = function (string $bytes) use (
        &$out,
        &$lastY,
        &$lastEnd,
        &$px,
        &$py,
        &$size,
        &$sx,
        &$sy,
        &$tc,
        &$tw,
        &$font,
    ) {
        $t = pdfStr($bytes, $font);
        $w = pdfRunWidth($bytes, $font, $size, $tc, $tw) * $sx;
        if ($t !== '') {
            if ($lastY !== null && abs($py - $lastY) > max(1.0, $size * $sy * 0.3)) {
                if (!str_ends_with($out, "\n")) {
                    $out .= "\n";
                }
            } elseif (
                $lastEnd !== null &&
                $px - $lastEnd > $size * $sx * 0.17 &&
                !str_ends_with($out, ' ') &&
                !str_ends_with($out, "\n") &&
                $out !== '' &&
                !str_starts_with($t, ' ')
            ) {
                $out .= ' ';
            }
            $out .= $t;
            $lastY = $py;
        }
        $px += $w;
        $lastEnd = $px;
    };
    $n = strlen($cs);
    $i = 0;
    while ($i < $n) {
        $c = $cs[$i];
        if ($c === ' ' || $c === "\n" || $c === "\r" || $c === "\t" || $c === "\f" || $c === "\0") {
            $i++;
            continue;
        }
        if ($c === '%') {
            $e = strpos($cs, "\n", $i);
            $i = $e === false ? $n : $e + 1;
            continue;
        }
        if ($c === '(') {
            $s = '';
            $d = 1;
            $i++;
            while ($i < $n && $d > 0) {
                $ch = $cs[$i];
                if ($ch === '\\') {
                    $nx = $cs[$i + 1] ?? '';
                    $esc = [
                        'n' => "\n",
                        'r' => "\r",
                        't' => "\t",
                        'b' => "\x08",
                        'f' => "\f",
                        '(' => '(',
                        ')' => ')',
                        '\\' => '\\',
                    ];
                    if (isset($esc[$nx])) {
                        $s .= $esc[$nx];
                        $i += 2;
                        continue;
                    }
                    if ($nx >= '0' && $nx <= '7') {
                        $o = '';
                        $j = $i + 1;
                        while ($j < $n && strlen($o) < 3 && $cs[$j] >= '0' && $cs[$j] <= '7') {
                            $o .= $cs[$j];
                            $j++;
                        }
                        $s .= chr(octdec($o) & 255);
                        $i = $j;
                        continue;
                    }
                    if ($nx === "\r" || $nx === "\n") {
                        $i += $nx === "\r" && ($cs[$i + 2] ?? '') === "\n" ? 3 : 2;
                        continue;
                    }
                    $i++;
                    continue;
                }
                if ($ch === '(') {
                    $d++;
                } elseif ($ch === ')') {
                    $d--;
                    if ($d === 0) {
                        $i++;
                        break;
                    }
                }
                $s .= $ch;
                $i++;
            }
            $st[] = ['s', $s];
            continue;
        }
        if ($c === '<') {
            if (($cs[$i + 1] ?? '') === '<') {
                $d = 0;
                while ($i < $n) {
                    if ($cs[$i] === '<' && ($cs[$i + 1] ?? '') === '<') {
                        $d++;
                        $i += 2;
                    } elseif ($cs[$i] === '>' && ($cs[$i + 1] ?? '') === '>') {
                        $d--;
                        $i += 2;
                        if ($d <= 0) {
                            break;
                        }
                    } else {
                        $i++;
                    }
                }
                $st[] = ['d', ''];
                continue;
            }
            $e = strpos($cs, '>', $i);
            if ($e === false) {
                break;
            }
            $h = preg_replace('/[^0-9A-Fa-f]/', '', substr($cs, $i + 1, $e - $i - 1)) ?? '';
            if (strlen($h) % 2) {
                $h .= '0';
            }
            $st[] = ['s', (string) @hex2bin($h)];
            $i = $e + 1;
            continue;
        }
        if ($c === '[') {
            $st[] = ['['];
            $i++;
            continue;
        }
        if ($c === ']') {
            $arr = [];
            while ($st) {
                $x = array_pop($st);
                if ($x[0] === '[') {
                    break;
                }
                array_unshift($arr, $x);
            }
            $st[] = ['a', $arr];
            $i++;
            continue;
        }
        if ($c === '/') {
            $j = $i + 1;
            while ($j < $n && strpos(" \t\r\n\f\0/[]()<>{}%", $cs[$j]) === false) {
                $j++;
            }
            $st[] = ['n', substr($cs, $i + 1, $j - $i - 1)];
            $i = $j;
            continue;
        }
        if (($c >= '0' && $c <= '9') || $c === '-' || $c === '+' || $c === '.') {
            $j = $i + 1;
            while ($j < $n && (ctype_digit($cs[$j]) || $cs[$j] === '.')) {
                $j++;
            }
            $st[] = ['f', (float) substr($cs, $i, $j - $i)];
            $i = $j;
            continue;
        }
        $j = $i;
        while ($j < $n && strpos(" \t\r\n\f\0/[]()<>{}%", $cs[$j]) === false) {
            $j++;
        }
        if ($j === $i) {
            $i++;
            continue;
        }
        $op = substr($cs, $i, $j - $i);
        $i = $j;
        $num = function (int $k) use ($st): float {
            $x = $st[count($st) - $k] ?? null;
            return $x && $x[0] === 'f' ? (float) $x[1] : 0.0;
        };
        switch ($op) {
            case 'BT':
                $lx = $ly = $px = $py = 0.0;
                $sx = $sy = 1.0;
                break;
            case 'Tf':
                $nm = $st[count($st) - 2] ?? null;
                $font = $nm && $nm[0] === 'n' ? $fonts[$nm[1]] ?? null : null;
                $size = abs($num(1)) ?: 10.0;
                break;
            case 'TL':
                $lead = $num(1);
                break;
            case 'Tc':
                $tc = $num(1);
                break;
            case 'Tw':
                $tw = $num(1);
                break;
            case 'Td':
                $lx += $num(2) * $sx;
                $ly += $num(1) * $sy;
                $px = $lx;
                $py = $ly;
                break;
            case 'TD':
                $lx += $num(2) * $sx;
                $ly += $num(1) * $sy;
                $lead = -$num(1);
                $px = $lx;
                $py = $ly;
                break;
            case 'Tm':
                $sx = abs($num(6)) ?: 1.0;
                $sy = abs($num(3)) ?: 1.0;
                $lx = $num(2);
                $ly = $num(1);
                $px = $lx;
                $py = $ly;
                break;
            case 'T*':
                $ly -= ($lead ?: $size) * $sy;
                $px = $lx;
                $py = $ly;
                break;
            case 'Tj':
                $x = end($st);
                if ($x && $x[0] === 's') {
                    $show($x[1]);
                }
                break;
            case "'":
            case '"':
                $ly -= ($lead ?: $size) * $sy;
                $px = $lx;
                $py = $ly;
                $x = end($st);
                if ($x && $x[0] === 's') {
                    $show($x[1]);
                }
                break;
            case 'TJ':
                $x = end($st);
                if ($x && $x[0] === 'a') {
                    foreach ($x[1] as $el) {
                        if ($el[0] === 's') {
                            $show($el[1]);
                        } elseif ($el[0] === 'f') {
                            $px -= ($el[1] / 1000.0) * $size * $sx;
                        }
                    };
                }
                break;
            case 'Do':
                $nm = end($st);
                if (
                    $depth < 3 &&
                    $nm &&
                    $nm[0] === 'n' &&
                    $res !== null &&
                    ($xd = pdfDictOf($objs, $res, 'XObject')) !== null &&
                    preg_match('#/' . preg_quote($nm[1], '#') . '\s+(\d+)\s+\d+\s+R#', $xd, $xm)
                ) {
                    $xo = $objs[(int) $xm[1]] ?? null;
                    if ($xo && $xo['s'] !== null && preg_match('#/Subtype\s*/Form#', $xo['d'])) {
                        $t = pdfRunText(
                            pdfDecode($xo['d'], $xo['s']),
                            $objs,
                            pdfDictOf($objs, $xo['d'], 'Resources') ?? $res,
                            $depth + 1,
                            $fc,
                        );
                        if (trim($t) !== '') {
                            $out .= "\n" . $t . "\n";
                        }
                    }
                }
                break;
            case 'BI':
                $e = preg_match('/\sEI(?=\s|$)/', $cs, $em, PREG_OFFSET_CAPTURE, $i) ? $em[0][1] + 3 : $n;
                $i = $e;
                break;
        }
        $st = [];
    }
    return $out;
}
