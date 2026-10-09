<?php
declare(strict_types=1);
/*
  v35.2: the live API connections (Dice, iLabor360) set themselves up and run by themselves.

  "Set it up for me" (route cx_auto): the API documents the provider gave you — an OpenAPI/Swagger file (JSON or
  YAML), a Postman collection, or the PDF / Word / HTML / text documents — or the address of those documents, or just
  the base address (the server then looks for the documents and the OAuth settings at the usual addresses). From them
  the connection is filled in: base address, sign-in (OAuth 2.0 token address and scope, API key name, Basic, token),
  each operation's method, path with the portal's placeholders, request body, where the list sits in the answer and
  which field is which. Then it signs in, runs a test call for each operation that only reads, keeps the list path and
  field names it found, and switches those operations on. Operations that write (posting, updating and closing jobs)
  are filled in and left for an administrator to switch on: nothing is posted while setting up.

  "Run by itself" (cxAutoRun, from the cron job): Dice candidate search for every open requirement on the Requirements
  desk (matches kept on the requirement, the best ones imported into the consultant database when asked), and Dice job
  postings kept in step with the careers page (new jobs posted, changed ones updated, closed ones closed).

  Dice does not publish its API documents (they come with an API agreement: integrationsupport@dice.com); nothing here
  assumes Dice's addresses.
*/
require_once __DIR__ . '/connectors.php';
require_once __DIR__ . '/textract.php';
// v37.2: which job boards a job goes to (an internal-only job, or one with Dice switched off, is not on Dice)
require_once __DIR__ . '/sources.php';

/* ======================================================================================================== */
/* A small YAML reader (the subset OpenAPI files use)                                                         */
/* ======================================================================================================== */
final class CxYaml
{
    private array $L;
    private int $i = 0;
    private int $n;

    private function __construct(string $s)
    {
        $this->L = preg_split('/\R/', str_replace("\t", '  ', $s)) ?: [];
        $this->n = count($this->L);
    }
    public static function parse(string $s): ?array
    {
        try {
            $p = new self($s);
            $p->skip();
            $v = $p->node(-1);
            return is_array($v) ? $v : null;
        } catch (Throwable $e) {
            return null;
        }
    }
    private function skip(): void
    {
        while ($this->i < $this->n) {
            $l = $this->L[$this->i];
            if (trim($l) === '' || preg_match('/^\s*#/', $l) || preg_match('/^(---|\.\.\.)(\s|$)/', $l) || preg_match('/^%/', $l)) {
                $this->i++;
                continue;
            }
            break;
        }
    }
    private static function ind(string $l): int
    {
        return strlen($l) - strlen(ltrim($l, ' '));
    }
    private static function isItem(string $t): bool
    {
        return $t === '-' || str_starts_with($t, '- ');
    }
    private function node(int $parent)
    {
        $this->skip();
        if ($this->i >= $this->n) {
            return null;
        }
        $l = $this->L[$this->i];
        $ind = self::ind($l);
        if ($ind <= $parent) {
            return null;
        }
        return self::isItem(ltrim($l)) ? $this->seq($ind) : $this->map($ind);
    }
    private function seq(int $ind): array
    {
        $out = [];
        while (true) {
            $this->skip();
            if ($this->i >= $this->n) {
                break;
            }
            $l = $this->L[$this->i];
            $t = ltrim($l);
            if (self::ind($l) !== $ind || !self::isItem($t)) {
                break;
            }
            $rest = trim(substr($t, 1));
            if ($rest === '') {
                $this->i++;
                $out[] = $this->node($ind);
                continue;
            }
            if (self::splitKey($rest)[0] !== null && !in_array($rest[0], ['"', "'", '[', '{'], true) || (in_array($rest[0], ['"', "'"], true) && self::splitKey($rest)[0] !== null)) {
                // "- key: value" opens a mapping whose keys sit two columns in
                $this->L[$this->i] = str_repeat(' ', $ind + 2) . $rest;
                $out[] = $this->map($ind + 2);
                continue;
            }
            $this->i++;
            $out[] = $this->value($rest, $ind);
        }
        return $out;
    }
    private function map(int $ind): array
    {
        $out = [];
        while (true) {
            $this->skip();
            if ($this->i >= $this->n) {
                break;
            }
            $l = $this->L[$this->i];
            $t = ltrim($l);
            if (self::ind($l) !== $ind || self::isItem($t)) {
                break;
            }
            [$k, $rest] = self::splitKey($t);
            $this->i++;
            if ($k === null) {
                continue;
            }
            if ($rest === '') {
                $this->skip();
                if ($this->i < $this->n) {
                    $nl = $this->L[$this->i];
                    $ni = self::ind($nl);
                    if ($ni > $ind) {
                        $out[$k] = $this->node($ind);
                        continue;
                    }
                    if ($ni === $ind && self::isItem(ltrim($nl))) {
                        $out[$k] = $this->seq($ind);
                        continue;
                    }
                }
                $out[$k] = null;
                continue;
            }
            if (preg_match('/^[|>][+-]?\d*\s*(#.*)?$/', $rest)) {
                $out[$k] = $this->block($ind, $rest[0] === '>');
                continue;
            }
            $out[$k] = $this->value($rest, $ind);
        }
        return $out;
    }
    /** A key line: [key, rest] or [null, '']. */
    private static function splitKey(string $t): array
    {
        if ($t === '') {
            return [null, ''];
        }
        if ($t[0] === '"' || $t[0] === "'") {
            $q = $t[0];
            $k = '';
            $j = 1;
            $len = strlen($t);
            while ($j < $len) {
                $c = $t[$j];
                if ($q === '"' && $c === '\\') {
                    $k .= $t[$j + 1] ?? '';
                    $j += 2;
                    continue;
                }
                if ($c === $q) {
                    if ($q === "'" && ($t[$j + 1] ?? '') === "'") {
                        $k .= "'";
                        $j += 2;
                        continue;
                    }
                    break;
                }
                $k .= $c;
                $j++;
            }
            $after = ltrim(substr($t, $j + 1));
            return str_starts_with($after, ':') && (strlen($after) === 1 || ctype_space($after[1])) ? [$k, trim(self::uncomment(substr($after, 1)))] : [null, ''];
        }
        if (in_array($t[0], ['[', '{', '#', '&', '*', '!', '|', '>', '%', '@', '`'], true)) {
            return [null, ''];
        }
        if (preg_match('/^(.+?):(?:\s+(.*))?$/', $t, $m) && !str_contains($m[1], ': ')) {
            return [trim($m[1]), trim(self::uncomment($m[2] ?? ''))];
        }
        return [null, ''];
    }
    private static function uncomment(string $s): string
    {
        $q = '';
        $len = strlen($s);
        for ($j = 0; $j < $len; $j++) {
            $c = $s[$j];
            if ($q !== '') {
                if ($c === $q) {
                    $q = '';
                }
                continue;
            }
            if ($c === '"' || $c === "'") {
                $q = $c;
            } elseif ($c === '#' && ($j === 0 || ctype_space($s[$j - 1]))) {
                return rtrim(substr($s, 0, $j));
            }
        }
        return $s;
    }
    private function block(int $ind, bool $folded): string
    {
        $lines = [];
        $bi = -1;
        while ($this->i < $this->n) {
            $l = $this->L[$this->i];
            if (trim($l) === '') {
                $lines[] = '';
                $this->i++;
                continue;
            }
            $li = self::ind($l);
            if ($li <= $ind) {
                break;
            }
            if ($bi < 0) {
                $bi = $li;
            }
            $lines[] = substr($l, min($bi, $li));
            $this->i++;
        }
        while ($lines && end($lines) === '') {
            array_pop($lines);
        }
        if (!$folded) {
            return implode("\n", $lines);
        }
        $out = '';
        foreach ($lines as $x) {
            $out .= $x === '' ? "\n" : (($out === '' || str_ends_with($out, "\n")) ? $x : ' ' . $x);
        }
        return $out;
    }
    /** A scalar, a quoted string (possibly over several lines), or a flow [ ] / { } collection. */
    private function value(string $v, int $ind)
    {
        $v = trim($v);
        if ($v === '') {
            return null;
        }
        if ($v[0] === '[' || $v[0] === '{') {
            while (!self::balanced($v) && $this->i < $this->n) {
                $v .= ' ' . trim($this->L[$this->i++]);
            }
            $pos = 0;
            return self::flow($v, $pos);
        }
        if ($v[0] === '"' || $v[0] === "'") {
            while (!self::closedQuote($v) && $this->i < $this->n) {
                $v .= ' ' . trim($this->L[$this->i++]);
            }
            return self::unquote($v);
        }
        $v = self::uncomment($v);
        // a plain scalar may go on over more-indented lines
        while ($this->i < $this->n) {
            $l = $this->L[$this->i];
            if (trim($l) === '' || self::ind($l) <= $ind || self::splitKey(ltrim($l))[0] !== null || self::isItem(ltrim($l))) {
                break;
            }
            $v .= ' ' . trim(self::uncomment($l));
            $this->i++;
        }
        return self::scalar($v);
    }
    private static function balanced(string $s): bool
    {
        $d = 0;
        $q = '';
        $len = strlen($s);
        for ($j = 0; $j < $len; $j++) {
            $c = $s[$j];
            if ($q !== '') {
                if ($c === $q) {
                    $q = '';
                }
                continue;
            }
            if ($c === '"' || $c === "'") {
                $q = $c;
            } elseif ($c === '[' || $c === '{') {
                $d++;
            } elseif ($c === ']' || $c === '}') {
                $d--;
            }
        }
        return $d <= 0;
    }
    private static function closedQuote(string $s): bool
    {
        $q = $s[0];
        $len = strlen($s);
        for ($j = 1; $j < $len; $j++) {
            if ($q === '"' && $s[$j] === '\\') {
                $j++;
                continue;
            }
            if ($s[$j] === $q) {
                if ($q === "'" && ($s[$j + 1] ?? '') === "'") {
                    $j++;
                    continue;
                }
                return true;
            }
        }
        return false;
    }
    private static function unquote(string $s): string
    {
        $q = $s[0];
        $end = strrpos($s, $q);
        $in = $end > 0 ? substr($s, 1, $end - 1) : substr($s, 1);
        if ($q === "'") {
            return str_replace("''", "'", $in);
        }
        $j = json_decode('"' . str_replace(["\n", "\r", "\t"], ['\n', '', '\t'], $in) . '"');
        return is_string($j) ? $j : stripcslashes($in);
    }
    private static function scalar(string $v)
    {
        $l = strtolower($v);
        if ($l === 'true' || $l === 'yes' || $l === 'on') {
            return true;
        }
        if ($l === 'false' || $l === 'no' || $l === 'off') {
            return false;
        }
        if ($l === 'null' || $l === '~') {
            return null;
        }
        if (preg_match('/^-?\d+$/', $v) && strlen($v) < 18) {
            return (int) $v;
        }
        if (preg_match('/^-?\d*\.\d+(e[+-]?\d+)?$/i', $v)) {
            return (float) $v;
        }
        return $v;
    }
    private static function flow(string $s, int &$p)
    {
        $len = strlen($s);
        $ws = function () use ($s, &$p, $len) {
            while ($p < $len && ctype_space($s[$p])) {
                $p++;
            }
        };
        $ws();
        if ($p >= $len) {
            return null;
        }
        $c = $s[$p];
        if ($c === '[') {
            $p++;
            $out = [];
            while (true) {
                $ws();
                if ($p >= $len) {
                    break;
                }
                if ($s[$p] === ']') {
                    $p++;
                    break;
                }
                $out[] = self::flow($s, $p);
                $ws();
                if ($p < $len && $s[$p] === ',') {
                    $p++;
                }
            }
            return $out;
        }
        if ($c === '{') {
            $p++;
            $out = [];
            while (true) {
                $ws();
                if ($p >= $len) {
                    break;
                }
                if ($s[$p] === '}') {
                    $p++;
                    break;
                }
                $k = self::flowScalar($s, $p, true);
                $ws();
                $val = null;
                if ($p < $len && $s[$p] === ':') {
                    $p++;
                    $val = self::flow($s, $p);
                }
                $out[(string) $k] = $val;
                $ws();
                if ($p < $len && $s[$p] === ',') {
                    $p++;
                }
            }
            return $out;
        }
        return self::flowScalar($s, $p, false);
    }
    private static function flowScalar(string $s, int &$p, bool $key)
    {
        $len = strlen($s);
        if ($s[$p] === '"' || $s[$p] === "'") {
            $q = $s[$p];
            $st = $p;
            $p++;
            while ($p < $len) {
                if ($q === '"' && $s[$p] === '\\') {
                    $p += 2;
                    continue;
                }
                if ($s[$p] === $q) {
                    if ($q === "'" && ($s[$p + 1] ?? '') === "'") {
                        $p += 2;
                        continue;
                    }
                    break;
                }
                $p++;
            }
            $p++;
            return self::unquote(substr($s, $st, $p - $st));
        }
        $st = $p;
        while ($p < $len && !in_array($s[$p], [',', ']', '}'], true) && !($key && $s[$p] === ':' && ($p + 1 >= $len || ctype_space($s[$p + 1]) || in_array($s[$p + 1], [',', '}'], true)))) {
            $p++;
        }
        $v = trim(substr($s, $st, $p - $st));
        return $key ? $v : self::scalar($v);
    }
}

/* ======================================================================================================== */
/* Reading the documents into one shape: ['base', 'auth' => [...], 'ops' => [[...], ...], 'kind', 'headers']   */
/* ======================================================================================================== */

/** A spec of no operations (what the readers start from). */
function cxSpec(string $kind): array
{
    return ['kind' => $kind, 'base' => '', 'auth' => ['kind' => '', 'tokenUrl' => '', 'scope' => '', 'keyName' => '', 'keyIn' => 'header', 'clientAuth' => '', 'extraKeyName' => '', 'extraKeyIn' => 'header'], 'ops' => [], 'headers' => [], 'notes' => []];
}
/** Follows "#/components/schemas/X" references inside a document (cycles and depth bounded). */
function cxRef(array $doc, $node, int $depth = 0)
{
    $seen = 0;
    while (is_array($node) && isset($node['$ref']) && is_string($node['$ref']) && str_starts_with($node['$ref'], '#/') && $seen++ < 12) {
        $cur = $doc;
        foreach (explode('/', substr($node['$ref'], 2)) as $seg) {
            $seg = str_replace(['~1', '~0'], ['/', '~'], rawurldecode($seg));
            if (!is_array($cur) || !array_key_exists($seg, $cur)) {
                return [];
            }
            $cur = $cur[$seg];
        }
        $node = $cur;
    }
    if (is_array($node) && $depth < 6) {
        // allOf: the parts merged (properties and required)
        if (isset($node['allOf']) && is_array($node['allOf'])) {
            $m = ['type' => 'object', 'properties' => [], 'required' => []];
            foreach ($node['allOf'] as $part) {
                $part = cxRef($doc, $part, $depth + 1);
                $m['properties'] += (array) ($part['properties'] ?? []);
                $m['required'] = array_merge($m['required'], (array) ($part['required'] ?? []));
            }
            $node = $m + $node;
        }
        foreach (['oneOf', 'anyOf'] as $k) {
            if (isset($node[$k][0]) && !isset($node['properties']) && !isset($node['items'])) {
                $node = cxRef($doc, $node[$k][0], $depth + 1) + $node;
            }
        }
    }
    return $node;
}
/** OpenAPI 3.x or Swagger 2.0. $from: where the document came from (to resolve a relative server address). */
function cxSpecOpenApi(array $doc, string $from = ''): array
{
    $sp = cxSpec(isset($doc['swagger']) ? 'Swagger ' . $doc['swagger'] : 'OpenAPI ' . ($doc['openapi'] ?? ''));
    // the base address
    if (isset($doc['servers'][0]['url'])) {
        $u = (string) $doc['servers'][0]['url'];
        foreach ((array) ($doc['servers'][0]['variables'] ?? []) as $vk => $vv) {
            $u = str_replace('{' . $vk . '}', (string) ($vv['default'] ?? ''), $u);
        }
        if (!preg_match('#^https?://#i', $u) && preg_match('#^(https?://[^/]+)#i', $from, $m)) {
            $u = $m[1] . '/' . ltrim($u, '/');
        }
        $sp['base'] = rtrim($u, '/');
    } elseif (isset($doc['host'])) {
        $scheme = in_array('https', (array) ($doc['schemes'] ?? []), true) || empty($doc['schemes']) ? 'https' : (string) $doc['schemes'][0];
        $sp['base'] = rtrim($scheme . '://' . $doc['host'] . (string) ($doc['basePath'] ?? ''), '/');
    }
    // the sign-in: OAuth 2.0 client credentials first, then Basic, an API key, a bearer token
    $schemes = (array) ($doc['components']['securitySchemes'] ?? ($doc['securityDefinitions'] ?? []));
    $best = null;
    $extraKey = null;
    $rank = ['oauth2' => 4, 'basic' => 3, 'apikey' => 2, 'bearer' => 1];
    foreach ($schemes as $s) {
        $s = cxRef($doc, $s);
        $ty = strtolower((string) ($s['type'] ?? ''));
        $a = null;
        if ($ty === 'oauth2') {
            $flow = $s['flows']['clientCredentials'] ?? null;
            $tok = (string) ($flow['tokenUrl'] ?? (($s['flow'] ?? '') === 'application' ? ($s['tokenUrl'] ?? '') : ''));
            if ($tok === '' && isset($s['flows'])) {
                foreach ((array) $s['flows'] as $f) {
                    if (!empty($f['tokenUrl'])) {
                        $tok = (string) $f['tokenUrl'];
                        break;
                    }
                }
            }
            $scopes = array_keys((array) ($flow['scopes'] ?? ($s['scopes'] ?? [])));
            $a = ['kind' => 'oauth2', 'tokenUrl' => $tok, 'scope' => count($scopes) <= 8 ? implode(' ', $scopes) : '', 'keyName' => '', 'keyIn' => 'header', 'clientAuth' => 'basic'];
        } elseif ($ty === 'http' && strtolower((string) ($s['scheme'] ?? '')) === 'basic' || $ty === 'basic') {
            $a = ['kind' => 'basic'] + cxSpec('')['auth'];
        } elseif ($ty === 'apikey' && in_array(strtolower((string) ($s['in'] ?? '')), ['header', 'query'], true)) {
            $a = ['kind' => 'apikey', 'keyName' => (string) ($s['name'] ?? ''), 'keyIn' => strtolower((string) $s['in'])] + cxSpec('')['auth'];
            // Keep an API-key scheme even when Basic/OAuth is the primary sign-in. OpenAPI allows a request to require
            // more than one security scheme, which is common in VMS integrations.
            if ($extraKey === null && (string) ($s['name'] ?? '') !== '') {
                $extraKey = ['name' => (string) $s['name'], 'in' => strtolower((string) $s['in'])];
            }
        } elseif ($ty === 'http' && strtolower((string) ($s['scheme'] ?? '')) === 'bearer') {
            $a = ['kind' => 'bearer'] + cxSpec('')['auth'];
        }
        if ($a && (!$best || $rank[$a['kind']] > $rank[$best['kind']])) {
            $best = $a;
        }
    }
    if ($best) {
        if ($best['tokenUrl'] !== '' && !preg_match('#^https?://#i', $best['tokenUrl']) && preg_match('#^(https?://[^/]+)#i', $sp['base'] ?: $from, $m)) {
            $best['tokenUrl'] = $m[1] . '/' . ltrim($best['tokenUrl'], '/');
        }
        if ($extraKey !== null && $best['kind'] !== 'apikey') {
            $best['extraKeyName'] = $extraKey['name'];
            $best['extraKeyIn'] = $extraKey['in'];
        }
        $sp['auth'] = $best;
    }
    // the operations
    foreach ((array) ($doc['paths'] ?? []) as $path => $item) {
        if (!is_array($item)) {
            continue;
        }
        $item = cxRef($doc, $item);
        $common = (array) ($item['parameters'] ?? []);
        foreach (['get', 'post', 'put', 'patch', 'delete'] as $m) {
            if (!isset($item[$m]) || !is_array($item[$m])) {
                continue;
            }
            $op = $item[$m];
            $params = [];
            foreach (array_merge($common, (array) ($op['parameters'] ?? [])) as $p) {
                $p = cxRef($doc, $p);
                if (!is_array($p) || !isset($p['name'], $p['in'])) {
                    continue;
                }
                $sch = cxRef($doc, $p['schema'] ?? $p);
                $params[$p['in'] . ':' . $p['name']] = ['name' => (string) $p['name'], 'in' => (string) $p['in'], 'req' => !empty($p['required']), 'type' => (string) ($sch['type'] ?? ''), 'def' => $sch['default'] ?? ($p['example'] ?? ($sch['example'] ?? (isset($sch['enum'][0]) ? $sch['enum'][0] : null))), 'schema' => $sch];
            }
            // the request body: OpenAPI 3 requestBody, Swagger 2 "in: body" or form fields
            $body = null;
            $ctype = 'json';
            if (isset($op['requestBody'])) {
                $rb = cxRef($doc, $op['requestBody']);
                $content = (array) ($rb['content'] ?? []);
                foreach (['application/json', 'application/*+json', 'application/x-www-form-urlencoded', 'multipart/form-data', 'application/xml', 'text/xml'] as $ct) {
                    foreach ($content as $ck => $cv) {
                        if (str_starts_with(strtolower((string) $ck), explode('*', $ct)[0]) && isset($cv['schema'])) {
                            $body = cxRef($doc, $cv['schema']);
                            $ctype = str_contains($ck, 'form') ? 'form' : (str_contains($ck, 'xml') ? 'xml' : 'json');
                            break 2;
                        }
                    }
                }
            } else {
                foreach ($params as $k => $p) {
                    if ($p['in'] === 'body') {
                        $body = cxRef($doc, $p['schema']);
                        unset($params[$k]);
                    } elseif ($p['in'] === 'formData') {
                        $body = $body ?? ['type' => 'object', 'properties' => []];
                        $body['properties'][$p['name']] = $p['schema'];
                        if ($p['req']) {
                            $body['required'][] = $p['name'];
                        }
                        $ctype = 'form';
                        unset($params[$k]);
                    }
                }
            }
            // the answer: the first 2xx with a schema
            $resp = null;
            foreach ((array) ($op['responses'] ?? []) as $code => $r) {
                if (!preg_match('/^2\d\d$|^default$/', (string) $code)) {
                    continue;
                }
                $r = cxRef($doc, $r);
                $schema = $r['schema'] ?? null;
                foreach ((array) ($r['content'] ?? []) as $ck => $cv) {
                    if (isset($cv['schema']) && (str_contains((string) $ck, 'json') || $schema === null)) {
                        $schema = $cv['schema'];
                        if (str_contains((string) $ck, 'json')) {
                            break;
                        }
                    }
                }
                if ($schema !== null) {
                    $resp = cxRef($doc, $schema);
                    break;
                }
            }
            $sp['ops'][] = [
                'method' => strtoupper($m),
                'path' => (string) $path,
                'params' => array_values($params),
                'body' => $body,
                'ctype' => $ctype,
                'resp' => $resp,
                'doc' => $doc,
                'text' => mb_strtolower(implode(' ', array_filter([(string) $path, (string) ($op['operationId'] ?? ''), (string) ($op['summary'] ?? ''), mb_substr((string) ($op['description'] ?? ''), 0, 240), implode(' ', array_map('strval', (array) ($op['tags'] ?? [])))]))),
                'id' => (string) ($op['operationId'] ?? ''),
                'sum' => mb_substr((string) ($op['summary'] ?? ($op['operationId'] ?? '')), 0, 120),
            ];
        }
    }
    return $sp;
}
/** A Postman collection (v2.0 / v2.1). */
function cxSpecPostman(array $col): array
{
    $sp = cxSpec('Postman collection');
    $vars = [];
    foreach ((array) ($col['variable'] ?? []) as $v) {
        if (isset($v['key'])) {
            $vars[(string) $v['key']] = (string) ($v['value'] ?? '');
        }
    }
    $sub = fn(string $s) => preg_replace_callback('/\{\{\s*([A-Za-z0-9_.\-]+)\s*\}\}/', fn($m) => array_key_exists($m[1], $vars) && $vars[$m[1]] !== '' && !preg_match('/token|secret|password|key/i', $m[1]) ? $vars[$m[1]] : '{{' . $m[1] . '}}', $s) ?? $s;
    $authOf = function ($a) use ($sub): ?array {
        if (!is_array($a) || empty($a['type'])) {
            return null;
        }
        $kv = [];
        foreach ((array) ($a[$a['type']] ?? []) as $x) {
            if (is_array($x) && isset($x['key'])) {
                $kv[(string) $x['key']] = is_scalar($x['value'] ?? null) ? (string) $x['value'] : '';
            }
        }
        switch ($a['type']) {
            case 'oauth2':
                return ['kind' => 'oauth2', 'tokenUrl' => $sub($kv['accessTokenUrl'] ?? ($kv['tokenUrl'] ?? '')), 'scope' => (string) ($kv['scope'] ?? ''), 'keyName' => '', 'keyIn' => 'header', 'clientAuth' => ($kv['client_authentication'] ?? 'header') === 'body' ? 'form' : 'basic'];
            case 'apikey':
                return ['kind' => 'apikey', 'tokenUrl' => '', 'scope' => '', 'keyName' => (string) ($kv['key'] ?? 'x-api-key'), 'keyIn' => ($kv['in'] ?? 'header') === 'query' ? 'query' : 'header', 'clientAuth' => ''];
            case 'basic':
            case 'bearer':
                return ['kind' => $a['type'], 'tokenUrl' => '', 'scope' => '', 'keyName' => '', 'keyIn' => 'header', 'clientAuth' => ''];
        }
        return null;
    };
    if ($a = $authOf($col['auth'] ?? null)) {
        $sp['auth'] = $a;
    }
    $reqs = [];
    $walk = function (array $items, ?array $auth) use (&$walk, &$reqs, $authOf) {
        foreach ($items as $it) {
            if (!is_array($it)) {
                continue;
            }
            $a = $authOf($it['auth'] ?? null) ?? $auth;
            if (isset($it['item']) && is_array($it['item'])) {
                $walk($it['item'], $a);
            } elseif (isset($it['request'])) {
                $reqs[] = [$it, $a];
            }
        }
    };
    $walk((array) ($col['item'] ?? []), null);
    $urls = [];
    foreach ($reqs as [$it, $a]) {
        $r = $it['request'];
        if (is_string($r)) {
            $r = ['method' => 'GET', 'url' => $r];
        }
        $u = $r['url'] ?? '';
        $raw = is_array($u) ? (string) ($u['raw'] ?? '') : (string) $u;
        if ($raw === '' && is_array($u)) {
            $raw = (isset($u['protocol']) ? $u['protocol'] . '://' : '') . implode('.', (array) ($u['host'] ?? [])) . '/' . implode('/', (array) ($u['path'] ?? []));
        }
        $raw = $sub($raw);
        $hdr = [];
        foreach ((array) ($r['header'] ?? []) as $h) {
            if (is_array($h) && isset($h['key']) && empty($h['disabled'])) {
                $hdr[(string) $h['key']] = $sub((string) ($h['value'] ?? ''));
            }
        }
        $body = null;
        $ctype = 'json';
        $b = $r['body'] ?? null;
        if (is_array($b)) {
            if (($b['mode'] ?? '') === 'raw') {
                $rawBody = (string) ($b['raw'] ?? '');
                $ctype = str_contains(strtolower((string) ($b['options']['raw']['language'] ?? '')), 'xml') || str_starts_with(ltrim($rawBody), '<') ? 'xml' : 'json';
                $body = ['raw' => $rawBody];
            } elseif (in_array($b['mode'] ?? '', ['urlencoded', 'formdata'], true)) {
                $ctype = 'form';
                $props = [];
                foreach ((array) ($b[$b['mode']] ?? []) as $x) {
                    if (is_array($x) && isset($x['key'])) {
                        $props[(string) $x['key']] = ['type' => 'string'];
                    }
                }
                $body = ['type' => 'object', 'properties' => $props];
            }
        }
        $params = [];
        if (is_array($u)) {
            foreach ((array) ($u['query'] ?? []) as $q) {
                if (is_array($q) && isset($q['key']) && empty($q['disabled'])) {
                    $params[] = ['name' => (string) $q['key'], 'in' => 'query', 'req' => false, 'type' => '', 'def' => $q['value'] ?? null, 'schema' => []];
                }
            }
        } elseif (preg_match('/\?(.*)$/', $raw, $qm)) {
            parse_str($qm[1], $qa);
            foreach ($qa as $k => $v) {
                $params[] = ['name' => (string) $k, 'in' => 'query', 'req' => false, 'type' => '', 'def' => is_scalar($v) ? $v : null, 'schema' => []];
            }
        }
        foreach ($hdr as $k => $v) {
            $params[] = ['name' => $k, 'in' => 'header', 'req' => true, 'type' => 'string', 'def' => $v, 'schema' => []];
        }
        $path = preg_replace('/\?.*$/', '', $raw) ?? $raw;
        $path = preg_replace('#/:([A-Za-z_][A-Za-z0-9_]*)#', '/{$1}', $path) ?? $path;
        $urls[] = $path;
        $sp['ops'][] = [
            'method' => strtoupper((string) ($r['method'] ?? 'GET')),
            'path' => $path,
            'params' => $params,
            'body' => $body,
            'ctype' => $ctype,
            'resp' => null,
            'doc' => [],
            'text' => mb_strtolower(trim((string) ($it['name'] ?? '') . ' ' . $path . ' ' . mb_substr(is_string($r['description'] ?? null) ? $r['description'] : '', 0, 240))),
            'id' => (string) ($it['name'] ?? ''),
            'sum' => mb_substr((string) ($it['name'] ?? ''), 0, 120),
            'auth' => $a,
            'example' => isset($it['response'][0]['body']) ? (string) $it['response'][0]['body'] : '',
        ];
        if (!$sp['auth']['kind'] && $a) {
            $sp['auth'] = $a;
        }
    }
    // the base: a variable named like one, else what the addresses have in common
    foreach (['baseUrl', 'base_url', 'baseURL', 'apiUrl', 'api_url', 'url', 'host', 'server'] as $k) {
        if (!empty($vars[$k]) && preg_match('#^https?://#i', $vars[$k])) {
            $sp['base'] = rtrim($vars[$k], '/');
            break;
        }
    }
    if ($sp['base'] === '' && $urls) {
        $abs = array_values(array_filter($urls, fn($u) => preg_match('#^https?://#i', $u)));
        if ($abs) {
            $pre = $abs[0];
            foreach ($abs as $u) {
                while ($pre !== '' && !str_starts_with($u, $pre)) {
                    $pre = substr($pre, 0, -1);
                }
            }
            $pre = preg_replace('#/[^/]*$#', '', $pre) ?? $pre;
            if (preg_match('#^https?://[^/]+#i', $pre)) {
                $sp['base'] = rtrim($pre, '/');
            }
        }
    }
    foreach ($sp['ops'] as &$o) {
        if ($sp['base'] !== '' && str_starts_with($o['path'], $sp['base'])) {
            $o['path'] = substr($o['path'], strlen($sp['base'])) ?: '/';
        }
    }
    unset($o);
    return $sp;
}
/** Documents in prose (PDF, Word, HTML, text): addresses, methods, sign-in words, example bodies and headers. */
function cxSpecDocs(string $text): array
{
    $sp = cxSpec('API documents (text)');
    $t = str_replace(["\r\n", "\r"], "\n", $text);
    $lines = explode("\n", $t);
    // the token address and the sign-in
    if (preg_match('#(https?://[^\s"\'<>)]*(?:oauth|token|connect/token)[^\s"\'<>)]*)#i', $t, $m)) {
        $sp['auth']['tokenUrl'] = rtrim($m[1], '.,;');
    }
    $hasKey = preg_match('/\b(x-api-key|api[-_]?key|apikey|subscription-key|ocp-apim-subscription-key)\s*:/i', $t, $km);
    $hasBasic = preg_match('/Authorization:\s*Basic/i', $t);
    $hasBearer = preg_match('/Authorization:\s*Bearer/i', $t);
    if ($sp['auth']['tokenUrl'] !== '' || preg_match('/client[_\s]?credentials/i', $t)) {
        $sp['auth']['kind'] = 'oauth2';
        $sp['auth']['clientAuth'] = preg_match('/client_id\s*=|"client_id"\s*:/i', $t) && !$hasBasic ? 'form' : 'basic';
        if (preg_match('/\bscopes?\s*[:=]\s*["\']?([a-z0-9_.:\/\- ]{3,120})/i', $t, $sm)) {
            $sp['auth']['scope'] = trim($sm[1], " \"'");
        }
    } elseif ($hasBasic) {
        $sp['auth']['kind'] = 'basic';
    } elseif ($hasBearer) {
        $sp['auth']['kind'] = 'bearer';
    } elseif ($hasKey) {
        $sp['auth']['kind'] = 'apikey';
        $sp['auth']['keyName'] = $km[1];
    }
    if ($hasKey && $sp['auth']['kind'] !== 'apikey') {
        $sp['auth']['extraKeyName'] = $km[1];
        $sp['auth']['extraKeyIn'] = 'header';
    }
    // a stated base address
    if (preg_match('/(?:base\s*(?:url|address|uri|endpoint)|api\s*(?:url|endpoint|host)|host)\s*[:=\-]?\s*(https?:\/\/[^\s"\'<>)]+)/i', $t, $bm)) {
        $sp['base'] = rtrim($bm[1], '/.,;');
    }
    $n = count($lines);
    $hosts = [];
    for ($i = 0; $i < $n; $i++) {
        if (!preg_match('#\b(GET|POST|PUT|PATCH|DELETE)\s+(https?://[^\s"\'<>]+|/[A-Za-z0-9_\-/{}.:%?=&\[\]]+)#', $lines[$i], $m)) {
            continue;
        }
        $url = rtrim($m[2], '.,;');
        if (preg_match('#^(https?://[^/]+)#i', $url, $hm)) {
            $hosts[$hm[1]] = ($hosts[$hm[1]] ?? 0) + 1;
        }
        $ctx = implode(' ', array_slice($lines, max(0, $i - 3), 7));
        // an example body: the first { … } after the line
        $body = null;
        if (in_array($m[1], ['POST', 'PUT', 'PATCH'], true)) {
            $chunk = implode("\n", array_slice($lines, $i + 1, 40));
            $st = strpos($chunk, '{');
            if ($st !== false && $st < 600) {
                $d = 0;
                for ($j = $st; $j < strlen($chunk); $j++) {
                    $d += $chunk[$j] === '{' ? 1 : ($chunk[$j] === '}' ? -1 : 0);
                    if ($d === 0) {
                        $raw = substr($chunk, $st, $j - $st + 1);
                        if (is_array(json_decode($raw, true))) {
                            $body = ['raw' => $raw];
                        }
                        break;
                    }
                }
            }
        }
        // headers in the example right below ("SystemUserId: 12345")
        $params = [];
        foreach (array_slice($lines, $i + 1, 8) as $hl) {
            if (preg_match('/^\s*([A-Z][A-Za-z0-9\-]{2,40}):\s*(\S.{0,80})$/', $hl, $hm2) && !preg_match('/^(content-type|accept|authorization|host|content-length|user-agent|cache-control|connection)$/i', $hm2[1])) {
                $params[] = ['name' => $hm2[1], 'in' => 'header', 'req' => true, 'type' => 'string', 'def' => trim($hm2[2]), 'schema' => []];
            }
        }
        $q = [];
        if (preg_match('/\?(.*)$/', $url, $qm)) {
            parse_str($qm[1], $q);
        }
        foreach ($q as $k => $v) {
            $params[] = ['name' => (string) $k, 'in' => 'query', 'req' => false, 'type' => '', 'def' => is_scalar($v) ? $v : null, 'schema' => []];
        }
        $sp['ops'][] = ['method' => $m[1], 'path' => preg_replace('/\?.*$/', '', $url) ?? $url, 'params' => $params, 'body' => $body, 'ctype' => $body !== null ? 'json' : 'json', 'resp' => null, 'doc' => [], 'text' => mb_strtolower($ctx), 'id' => '', 'sum' => mb_substr(trim($lines[$i]), 0, 120)];
    }
    if ($sp['base'] === '' && $hosts) {
        arsort($hosts);
        $top = (string) array_key_first($hosts);
        // the longest common path prefix of the absolute addresses on that host
        $abs = array_values(array_filter(array_column($sp['ops'], 'path'), fn($p) => str_starts_with($p, $top)));
        $pre = $abs[0] ?? $top;
        foreach ($abs as $p) {
            while ($pre !== '' && !str_starts_with($p, $pre)) {
                $pre = substr($pre, 0, -1);
            }
        }
        $sp['base'] = rtrim(preg_replace('#/[^/{}]*$#', '', $pre) ?: $top, '/');
        if (!str_starts_with($sp['base'], $top)) {
            $sp['base'] = $top;
        }
    }
    foreach ($sp['ops'] as &$o) {
        if ($sp['base'] !== '' && str_starts_with($o['path'], $sp['base'])) {
            $o['path'] = substr($o['path'], strlen($sp['base'])) ?: '/';
        }
    }
    unset($o);
    return $sp;
}
/** Reads one document (by its content): OpenAPI JSON/YAML, Postman, or prose. Null when nothing usable. */
function cxReadDoc(string $name, string $data, string $from = ''): ?array
{
    $t = ltrim($data, "\xEF\xBB\xBF \t\r\n");
    $j = null;
    if ($t !== '' && ($t[0] === '{' || $t[0] === '[')) {
        $j = json_decode($t, true);
    } elseif (preg_match('/^(openapi|swagger)\s*:/m', $t) || preg_match('/\.(ya?ml)$/i', $name)) {
        $j = CxYaml::parse($t);
    }
    if (is_array($j)) {
        if (isset($j['openapi']) || isset($j['swagger'])) {
            return cxSpecOpenApi($j, $from);
        }
        if (isset($j['info']['_postman_id']) || str_contains((string) ($j['info']['schema'] ?? ''), 'postman') || (isset($j['item']) && is_array($j['item']))) {
            return cxSpecPostman($j);
        }
    }
    $text = '';
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    if ($ext === 'pdf' || str_starts_with($data, '%PDF')) {
        $text = pdfText($data, 60);
    } elseif ($ext === 'docx' || str_starts_with($data, "PK\x03\x04")) {
        $text = docxText($data);
    } elseif (in_array($ext, ['html', 'htm'], true) || preg_match('/<(html|body|div|table|pre)\b/i', substr($t, 0, 2000))) {
        // keep code examples on their own lines
        $text = htmlToText(preg_replace('#<(br|/p|/div|/pre|/li|/tr|/h\d)\b[^>]*>#i', "\n$0", $data) ?? $data);
    } else {
        $text = utf8ify($data);
    }
    $sp = cxSpecDocs($text);
    $sp['text'] = mb_substr($text, 0, 60000);
    return $sp['ops'] || $sp['base'] !== '' || $sp['auth']['kind'] !== '' ? $sp : null;
}

/* ======================================================================================================== */
/* From the documents to the connection                                                                       */
/* ======================================================================================================== */

// what each of the portal's operations looks like in an API
const CX_INTENT = [
    'search' => ['m' => ['GET', 'POST'], 'noun' => '/candidat|profile|resume|talent|people|person|applicant|seeker|\bcv\b|member|professional/', 'verb' => '/search|find|query|match|lookup|browse|list/', 'list' => true],
    'profile' => ['m' => ['GET'], 'noun' => '/candidat|profile|resume|talent|people|person|applicant|seeker|member|professional/', 'verb' => '/get|detail|retriev|read|fetch|view|show|profile|by\s*id/', 'item' => true],
    'post' => ['m' => ['POST'], 'noun' => '/\bjobs?\b|posting|position|requisition|opening|vacanc|advert/', 'verb' => '/create|post|add|publish|new|submit/', 'list' => true, 'body' => true],
    'update' => ['m' => ['PUT', 'PATCH', 'POST'], 'noun' => '/\bjobs?\b|posting|position|requisition|opening|vacanc|advert/', 'verb' => '/update|edit|modify|change|replace|patch/', 'item' => true, 'body' => true],
    'close' => ['m' => ['DELETE', 'POST', 'PUT', 'PATCH'], 'noun' => '/\bjobs?\b|posting|position|requisition|opening|vacanc|advert/', 'verb' => '/close|expire|deactivat|archiv|unpublish|delete|remove|end\b|cancel|withdraw/', 'item' => true],
    'reqs' => ['m' => ['GET', 'POST'], 'noun' => '/requisition|\bjobs?\b|order|position|opening|request|need|assignment/', 'verb' => '/list|search|get|find|query|all|open|pull/', 'list' => true],
];
// query and body names → the portal's placeholders
const CX_QMAP = [
    '{q}' => '/^(q|query|keywords?|search|searchterm|searchtext|term|text|skills?|kw)$/i',
    '{location}' => '/^(location|loc|city|where|zip|zipcode|postalcode|geo|place)$/i',
    '{radius}' => '/^(radius|distance|miles|within|range)$/i',
    '{page}' => '/^(page|pagenumber|pageno|pageindex|p)$/i',
    '{size}' => '/^(size|pagesize|limit|perpage|per_page|count|rows|max|maxresults|top|take|pagelength)$/i',
    '{offset}' => '/^(offset|start|skip|from|startindex|first)$/i',
    '{since}' => '/^(since|updatedsince|modifiedsince|updatedafter|modifiedafter|lastmodified|changedsince|createdafter|fromdate|datefrom|startdate)$/i',
    '{sysid}' => '/^(sysid|systemuserid|system_user_id|userid)$/i',
];
const CX_BMAP = [
    '{title}' => '/^(title|jobtitle|positiontitle|name|jobname|position)$/i',
    '{description_html}' => '/^(description|jobdescription|details|body|summary|descriptionhtml|content|text)$/i',
    '{city}' => '/^(city|town|locationcity)$/i',
    '{state}' => '/^(state|statecode|region|province|stateprovince)$/i',
    '{zip}' => '/^(zip|zipcode|postalcode|postcode)$/i',
    '{location}' => '/^(location|locationtext|address|worklocation|joblocation)$/i',
    '{{remote}}' => '/^(remote|isremote|telecommute|remoteallowed|remoteok)$/i',
    '{workplace}' => '/^(workplacetype|workmode|worksetting|workplace|worktype|workarrangement)$/i',
    '{type}' => '/^(employmenttype|jobtype|type|positiontype|engagementtype|contracttype|employment)$/i',
    '{{skills_list}}' => '/^(skills|requiredskills|keywords|skilllist|tags)$/i',
    '{rate}' => '/^(rate|payrate|billrate|salary|compensation|pay|hourlyrate|salaryrange)$/i',
    '{duration}' => '/^(duration|contractlength|length|term|contractduration)$/i',
    '{visa}' => '/^(workauthorization|visa|authorization|workpermit|citizenship)$/i',
    '{apply_url}' => '/^(applyurl|applicationurl|applylink|applyto|url|joburl|externalurl)$/i',
    '{company}' => '/^(company|companyname|employer|employername|organization|clientname)$/i',
    '{email}' => '/^(email|contactemail|applyemail|recruiteremail)$/i',
    '{job_id}' => '/^(externalid|referenceid|reference|requisitionid|jobid|clientjobid|refid|externaljobid|jobreference)$/i',
    '{posted}' => '/^(posted|posteddate|dateposted|postdate|publishdate)$/i',
];
/** How well an API operation fits one of the portal's operations. */
function cxScore(array $o, string $want): int
{
    $in = CX_INTENT[$want];
    if (!in_array($o['method'], $in['m'], true)) {
        return -99;
    }
    $p = mb_strtolower((string) $o['path']);
    $s = 0;
    if (preg_match($in['noun'], $p)) {
        $s += 4;
    } elseif (preg_match($in['noun'], $o['text'])) {
        $s += 2;
    } else {
        return -99;
    }
    if (preg_match($in['verb'], mb_strtolower($o['id'] . ' ' . $o['sum']))) {
        $s += 3;
    } elseif (preg_match($in['verb'], $o['text'])) {
        $s += 1;
    }
    $trailing = (bool) preg_match('#/\{[^}/]+\}/?$|/:[a-z_]+$#i', $p);
    if (!empty($in['item'])) {
        $s += $trailing ? 3 : (preg_match('#/\{[^}/]+\}/[a-z\-_]+$#i', $p) ? 2 : -6);
    }
    if (!empty($in['list'])) {
        $s += $trailing ? -6 : 2;
    }
    if ($in['m'][0] === $o['method']) {
        $s += 1;
    }
    if (!empty($in['body'])) {
        $s += $o['body'] !== null ? 2 : -1;
    }
    $names = array_map(fn($x) => strtolower($x['name']), array_filter($o['params'], fn($x) => $x['in'] === 'query'));
    if ($want === 'search') {
        $s += preg_grep(CX_QMAP['{q}'], $names) ? 3 : 0;
        $s += preg_match('/search/', $p) ? 2 : 0;
    }
    if ($want === 'reqs') {
        $s += preg_grep(CX_QMAP['{since}'], $names) ? 2 : 0;
        $s -= preg_match('/candidat|profile|resume|talent/', $p) ? 6 : 0;
    }
    if ($want === 'profile' && preg_match('#/(resume|cv|download|file|attachment)s?(/|$)#', $p)) {
        $s -= 4;
    }
    if ($want === 'close') {
        $s += $o['method'] === 'DELETE' ? 2 : 0;
        $s += preg_match('#/(close|expire|deactivate|archive|unpublish|end|cancel)$#', $p) ? 4 : 0;
    }
    if ($want === 'update' && in_array($o['method'], ['PUT', 'PATCH'], true)) {
        $s += 2;
    }
    return $s;
}
/** A sample record from a schema (property names with stand-in values), for field detection. */
function cxSample(array $doc, $schema, int $d = 0)
{
    $schema = cxRef($doc, $schema);
    if (!is_array($schema) || $d > 4) {
        return 'x';
    }
    $ty = $schema['type'] ?? (isset($schema['properties']) ? 'object' : (isset($schema['items']) ? 'array' : 'string'));
    if ($ty === 'array') {
        return [cxSample($doc, $schema['items'] ?? [], $d + 1)];
    }
    if ($ty === 'object') {
        $o = [];
        foreach ((array) ($schema['properties'] ?? []) as $k => $v) {
            $o[(string) $k] = cxSample($doc, $v, $d + 1);
        }
        return $o ?: ['value' => 'x'];
    }
    return $schema['example'] ?? ($ty === 'integer' || $ty === 'number' ? 1 : ($ty === 'boolean' ? true : 'x'));
}
/** Where the list of records sits in an answer schema ('' for a top-level list), or null when there is none. */
function cxListPath(array $doc, $schema, string $pre = '', int $d = 0): ?string
{
    $schema = cxRef($doc, $schema);
    if (!is_array($schema) || $d > 4) {
        return null;
    }
    if (($schema['type'] ?? '') === 'array' || isset($schema['items'])) {
        $it = cxRef($doc, $schema['items'] ?? []);
        return is_array($it) && (isset($it['properties']) || ($it['type'] ?? '') === 'object' || isset($it['allOf'])) ? $pre : null;
    }
    $props = (array) ($schema['properties'] ?? []);
    // the usual names first
    uksort($props, fn($a, $b) => (int) !preg_match('/^(data|items|results|records|content|hits|list|candidates|profiles|jobs|requisitions|value|rows)$/i', (string) $a) <=> (int) !preg_match('/^(data|items|results|records|content|hits|list|candidates|profiles|jobs|requisitions|value|rows)$/i', (string) $b));
    foreach ($props as $k => $v) {
        $r = cxListPath($doc, $v, ltrim($pre . '.' . $k, '.'), $d + 1);
        if ($r !== null) {
            return $r;
        }
    }
    return null;
}
/** The request body as a template with the portal's placeholders; [template, names that need a value]. */
function cxBodyTpl(array $doc, $body, string $ctype): array
{
    if ($body === null) {
        return ['', []];
    }
    if (isset($body['raw'])) {
        // an example body (Postman, documents): its values replaced where the names are known
        $j = json_decode((string) preg_replace('/\{\{\s*[A-Za-z0-9_.\-]+\s*\}\}/', '"__v__"', (string) $body['raw']), true);
        if (!is_array($j)) {
            return [(string) $body['raw'], []];
        }
        $need = [];
        $walk = function ($v, string $k) use (&$walk, &$need) {
            if (is_array($v) && !cxIsList($v)) {
                $o = [];
                foreach ($v as $kk => $vv) {
                    $o[$kk] = $walk($vv, (string) $kk);
                }
                return $o;
            }
            foreach (CX_BMAP as $ph => $re) {
                if (preg_match($re, preg_replace('/[^a-z0-9]/i', '', $k) ?? $k)) {
                    return $ph;
                }
            }
            return $v;
        };
        $out = $walk($j, '');
        return [cxTplJson($out), $need];
    }
    $need = [];
    $build = function ($schema, int $d) use (&$build, &$need, $doc) {
        $schema = cxRef($doc, $schema);
        $props = (array) ($schema['properties'] ?? []);
        $req = array_flip(array_map('strval', (array) ($schema['required'] ?? [])));
        $o = [];
        foreach ($props as $k => $v) {
            $v = cxRef($doc, $v);
            $nk = preg_replace('/[^a-z0-9]/i', '', (string) $k) ?? (string) $k;
            $ph = null;
            // an object (a location with city, state, zip) is built inside, not given one placeholder
            if ((($v['type'] ?? '') === 'object' || isset($v['properties'])) && $d < 3) {
                $sub = $build($v, $d + 1);
                if ($sub) {
                    $o[(string) $k] = $sub;
                    continue;
                }
            }
            foreach (CX_BMAP as $p => $re) {
                if (preg_match($re, $nk)) {
                    $ph = $p;
                    break;
                }
            }
            if ($ph === '{type}' && !empty($v['enum']) && preg_grep('/FULLTIME|CONTRACT|THIRD_PARTY|PART/i', array_map('strval', $v['enum']))) {
                $ph = '{type_code}';
            }
            if ($ph === '{{skills_list}}' && ($v['type'] ?? '') === 'string') {
                $ph = '{skills}';
            }
            if ($ph === null && (($v['type'] ?? '') === 'object' || isset($v['properties'])) && $d < 3) {
                $sub = $build($v, $d + 1);
                if ($sub) {
                    $o[(string) $k] = $sub;
                }
                continue;
            }
            if ($ph !== null) {
                $o[(string) $k] = $ph;
            } elseif (isset($req[(string) $k])) {
                $def = $v['default'] ?? ($v['example'] ?? (isset($v['enum'][0]) ? $v['enum'][0] : null));
                if ($def !== null) {
                    $o[(string) $k] = $def;
                } else {
                    $o[(string) $k] = '';
                    $need[] = (string) $k;
                }
            }
        }
        return $o;
    };
    $tpl = $build($body, 0);
    if ($ctype === 'form') {
        return [implode('&', array_map(fn($k, $v) => $k . '=' . (is_string($v) ? str_replace(['{{', '}}'], ['{', '}'], $v) : rawurlencode((string) json_encode($v))), array_keys($tpl), $tpl)), $need];
    }
    if ($ctype === 'xml') {
        return ['', ['an XML body (write it from the documents)']];
    }
    return [cxTplJson($tpl), $need];
}
/** JSON text with "{{raw}}" placeholders unquoted (true, 12, ["a","b"] go in as JSON). */
function cxTplJson($v): string
{
    $s = (string) json_encode($v, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    return (string) preg_replace('/"(\{\{[a-z_]+\}\})"/', '$1', $s);
}
/** The portal's connection for one provider, built from a spec: [api, report lines, warnings]. Existing values stay
 *  unless $replace (an operation's path, an empty base address and sign-in are always filled). */
function cxPlan(string $prov, array $sp, bool $replace): array
{
    $cur = cxApi($prov);
    $api = $cur;
    $rep = [];
    $warn = [];
    if ($sp['base'] !== '' && ($replace || $api['base'] === '')) {
        $api['base'] = $sp['base'];
    }
    $a = $sp['auth'];
    if ($a['kind'] !== '' && ($replace || $cur['base'] === '' || ($cur['auth'] === 'oauth2' && $cur['tokenUrl'] === ''))) {
        $api['auth'] = $a['kind'];
        if ($a['kind'] === 'oauth2') {
            $api['tokenUrl'] = $a['tokenUrl'] !== '' ? $a['tokenUrl'] : $api['tokenUrl'];
            $api['scope'] = $a['scope'] !== '' ? $a['scope'] : $api['scope'];
            $api['clientAuth'] = $a['clientAuth'] ?: $api['clientAuth'];
        }
        if ($a['kind'] === 'apikey') {
            $api['keyName'] = $a['keyName'] ?: $api['keyName'];
            $api['keyIn'] = $a['keyIn'] ?: 'header';
        }
        if (($a['extraKeyName'] ?? '') !== '') {
            $api['useKey'] = true;
            $api['keyName'] = $a['extraKeyName'];
            $api['keyIn'] = ($a['extraKeyIn'] ?? 'header') === 'query' ? 'query' : 'header';
        }
    }
    $used = [];
    $hdrs = array_filter(array_map('trim', preg_split('/\R/', (string) $api['headers']) ?: []));
    foreach (array_keys(CX_OPS[$prov]) as $op) {
        $best = null;
        $bs = 0;
        foreach ($sp['ops'] as $k => $o) {
            $s = cxScore($o, $op);
            if ($s > $bs && !isset($used[$o['method'] . ' ' . $o['path']])) {
                $bs = $s;
                $best = $k;
            }
        }
        if ($best === null || $bs < 5) {
            $rep[] = ['op' => $op, 'ok' => false, 'text' => CX_OPS[$prov][$op] . ': not found in the documents'];
            continue;
        }
        $o = $sp['ops'][$best];
        $used[$o['method'] . ' ' . $o['path']] = true;
        $doc = $o['doc'] ?? [];
        // the path: its parameters become placeholders (the last one is the record's ID)
        $path = (string) $o['path'];
        $pp = [];
        preg_match_all('/\{([^}]+)\}/', $path, $mm);
        $last = end($mm[1]) ?: '';
        $need = [];
        foreach ($mm[1] as $pn) {
            if ($pn === $last && in_array($op, ['profile'], true)) {
                $path = str_replace('{' . $pn . '}', '{id}', $path);
            } elseif ($pn === $last && in_array($op, ['update', 'close'], true)) {
                $path = str_replace('{' . $pn . '}', '{posting_id}', $path);
            } elseif (preg_match(CX_QMAP['{sysid}'], $pn)) {
                $path = str_replace('{' . $pn . '}', '{sysid}', $path);
            } elseif (!in_array($pn, ['id', 'posting_id', 'q', 'location', 'page', 'size', 'offset', 'since', 'sysid'], true)) {
                $need[] = '{' . $pn . '} in the path';
            }
        }
        $q = [];
        foreach ($o['params'] as $p) {
            if ($p['in'] === 'query') {
                $ph = null;
                foreach (CX_QMAP as $k => $re) {
                    if (preg_match($re, preg_replace('/[^a-z0-9_]/i', '', $p['name']) ?? $p['name'])) {
                        $ph = $k;
                        break;
                    }
                }
                if ($ph === '{q}' && $op === 'reqs') {
                    $ph = null;
                }
                if ($ph === '{since}' && $op !== 'reqs') {
                    $ph = null;
                }
                if ($ph !== null) {
                    $q[] = rawurlencode($p['name']) . '=' . $ph;
                } elseif ($p['req'] || ($p['def'] !== null && preg_match('/status|state/i', $p['name']) && $op === 'reqs')) {
                    if ($p['def'] !== null && is_scalar($p['def'])) {
                        $q[] = rawurlencode($p['name']) . '=' . rawurlencode(is_bool($p['def']) ? ($p['def'] ? 'true' : 'false') : (string) $p['def']);
                    } else {
                        $need[] = $p['name'] . ' (query)';
                    }
                }
            } elseif ($p['in'] === 'header' && !preg_match('/^(authorization|accept|content-type)$/i', $p['name'])) {
                $val = preg_match(CX_QMAP['{sysid}'], preg_replace('/[^a-z0-9_]/i', '', $p['name']) ?? '') ? '{sysid}' : (is_scalar($p['def']) && $p['def'] !== '' && !preg_match('/^(<.*>|\{.*\}|x+|your|string)$/i', (string) $p['def']) ? (string) $p['def'] : '');
                if ($val !== '') {
                    $line = $p['name'] . ': ' . $val;
                    if (!preg_grep('/^' . preg_quote($p['name'], '/') . '\s*:/i', $hdrs)) {
                        $hdrs[] = $line;
                    }
                } elseif ($p['req']) {
                    $need[] = $p['name'] . ' (header)';
                }
            }
        }
        if (in_array($op, ['search', 'reqs'], true) && !preg_grep('/\{(page|offset)\}/', $q) && !str_contains($path, '{page}')) {
            // no paging parameter: one page
        }
        $full = $path . ($q ? (str_contains($path, '?') ? '&' : '?') . implode('&', $q) : '');
        $no = $api['ops'][$op];
        if ($replace || $no['path'] === '') {
            $no['method'] = $o['method'];
            $no['path'] = $full;
            if (in_array($op, ['post', 'update', 'close'], true) || ($o['method'] !== 'GET' && $o['body'] !== null)) {
                [$tpl, $bneed] = cxBodyTpl($doc, $o['body'], $o['ctype']);
                if ($tpl !== '' || $o['body'] === null) {
                    $no['body'] = $tpl;
                    $no['ctype'] = in_array($o['ctype'], ['json', 'form', 'xml'], true) ? $o['ctype'] : 'json';
                }
                foreach ($bneed as $bn) {
                    $need[] = $bn . ' (body)';
                }
            }
            if (in_array($op, ['search', 'reqs'], true) && $o['resp'] !== null) {
                $lp = cxListPath($doc, $o['resp']);
                if ($lp !== null) {
                    $no['items'] = $lp;
                    $sample = cxSample($doc, $o['resp']);
                    $items = is_array($sample) ? cxItems($sample, $lp) : [];
                    $no['map'] = $items ? array_filter(cxAutoMap($items, $op)) : $no['map'];
                }
            } elseif ($o['resp'] !== null) {
                $sample = cxSample($doc, $o['resp']);
                if (is_array($sample)) {
                    $rec = isset($sample['data']) && is_array($sample['data']) && !cxIsList($sample['data']) ? $sample['data'] : $sample;
                    $auto = cxAutoMap([$rec], $op);
                    if ($auto) {
                        $no['map'] = array_map(fn($p) => (isset($sample['data']) && $rec !== $sample ? 'data.' : '') . $p, $auto);
                    }
                }
            } elseif (!empty($o['example'])) {
                $ex = json_decode((string) $o['example'], true);
                if (is_array($ex)) {
                    $items = in_array($op, ['search', 'reqs'], true) ? cxItems($ex, '') : [$ex];
                    if (in_array($op, ['search', 'reqs'], true)) {
                        $no['items'] = cxItemsPath($ex);
                    }
                    $no['map'] = $items ? array_filter(cxAutoMap($items, $op)) : $no['map'];
                }
            }
            $no['on'] = false;
        }
        $api['ops'][$op] = $no;
        $rep[] = ['op' => $op, 'ok' => true, 'text' => CX_OPS[$prov][$op] . ': ' . $no['method'] . ' ' . $no['path'] . ($o['sum'] !== '' ? ' (“' . $o['sum'] . '”)' : ''), 'need' => $need];
        if ($need) {
            $warn[] = CX_OPS[$prov][$op] . ' needs a value for ' . implode(', ', $need) . ': fill it in under the operation.';
        }
    }
    $api['headers'] = implode("\n", $hdrs);
    return [$api, $rep, $warn];
}
/** Text documents read by the AI (when it is switched on for "Fill forms"): only what appears in the text is kept. */
function cxAiDocs(string $prov, array $sp): array
{
    if (empty($sp['text']) || !aiReady('extract')) {
        return $sp;
    }
    $sys = 'You read API documentation for a recruiting integration and answer with JSON only. Use only addresses, paths and names that appear in the text; leave a value empty when the text does not give it. Keys: base (the base URL), auth (oauth2|basic|apikey|bearer|none), tokenUrl, scope, keyName, ops (an object keyed by ' . implode(', ', array_keys(CX_OPS[$prov])) . '; each {method, path, body}).';
    $j = aiJson($sys, "The documentation:\n\n" . mb_substr((string) $sp['text'], 0, 30000), 2500);
    if (!is_array($j)) {
        return $sp;
    }
    $txt = (string) $sp['text'];
    $inText = fn($s) => is_string($s) && $s !== '' && (str_contains($txt, $s) || str_contains($txt, (string) parse_url($s, PHP_URL_PATH)));
    if ($sp['base'] === '' && $inText($j['base'] ?? '')) {
        $sp['base'] = rtrim((string) $j['base'], '/');
    }
    if ($sp['auth']['kind'] === '' && in_array($j['auth'] ?? '', ['oauth2', 'basic', 'apikey', 'bearer'], true)) {
        $sp['auth']['kind'] = (string) $j['auth'];
    }
    if ($sp['auth']['tokenUrl'] === '' && $inText($j['tokenUrl'] ?? '')) {
        $sp['auth']['tokenUrl'] = (string) $j['tokenUrl'];
    }
    foreach ((array) ($j['ops'] ?? []) as $op => $o) {
        if (!isset(CX_OPS[$prov][$op]) || !is_array($o) || !$inText((string) preg_replace('/\?.*$/', '', (string) ($o['path'] ?? '')))) {
            continue;
        }
        $have = array_filter($sp['ops'], fn($x) => cxScore($x, (string) $op) >= 5);
        if ($have) {
            continue;
        }
        $sp['ops'][] = ['method' => strtoupper((string) ($o['method'] ?? 'GET')), 'path' => (string) $o['path'], 'params' => [], 'body' => !empty($o['body']) ? ['raw' => is_string($o['body']) ? $o['body'] : (string) json_encode($o['body'])] : null, 'ctype' => 'json', 'resp' => null, 'doc' => [], 'text' => mb_strtolower($op . ' ' . CX_OPS[$prov][$op] . ' ' . $o['path']), 'id' => (string) $op, 'sum' => CX_OPS[$prov][$op] . ' (read by AI)'];
    }
    return $sp;
}
/** Looks for the documents and the OAuth settings at the usual addresses of an API. */
function cxDiscover(string $prov, string $base): array
{
    $found = [];
    if ($base === '' || cxUrlProblem($base) !== '') {
        return [null, $found];
    }
    $api = cxApi($prov);
    // v83: the saved sign-in goes only to the connection's own API host; another address is looked at without it
    [$h] = cxApiHostOf($api, $base) ? cxAuth($prov, $api) : [[]];
    $origin = preg_match('#^(https?://[^/]+)#i', $base, $m) ? $m[1] : $base;
    $tries = [];
    foreach ([$base, $origin] as $root) {
        foreach (['/openapi.json', '/openapi.yaml', '/swagger.json', '/v3/api-docs', '/v2/api-docs', '/api-docs', '/swagger/v1/swagger.json', '/docs/openapi.json', '/.well-known/openapi.json', '/postman.json'] as $p) {
            $tries[rtrim($root, '/') . $p] = true;
        }
    }
    foreach (array_keys(array_slice($tries, 0, 16)) as $u) {
        [$code, $body] = cxHttp('GET', $u, array_merge($h, ['Accept: application/json, application/yaml, text/yaml, */*']), null, 10);
        $found[] = $u . ' → ' . ($code ?: 'no answer');
        if ($code === 200 && strlen($body) > 40) {
            $sp = cxReadDoc($u, $body, $u);
            if ($sp && $sp['ops']) {
                return [$sp, $found];
            }
        }
    }
    // OAuth metadata only
    foreach (['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration'] as $p) {
        [$code, $body] = cxHttp('GET', $origin . $p, ['Accept: application/json'], null, 10);
        $found[] = $origin . $p . ' → ' . ($code ?: 'no answer');
        $j = json_decode($body, true);
        if ($code === 200 && is_array($j) && !empty($j['token_endpoint'])) {
            $sp = cxSpec('OAuth metadata');
            $sp['auth'] = ['kind' => 'oauth2', 'tokenUrl' => (string) $j['token_endpoint'], 'scope' => '', 'keyName' => '', 'keyIn' => 'header', 'clientAuth' => in_array('client_secret_basic', (array) ($j['token_endpoint_auth_methods_supported'] ?? ['client_secret_basic']), true) ? 'basic' : 'form'];
            $sp['base'] = $base;
            return [$sp, $found];
        }
    }
    return [null, $found];
}
/** Signs in and tries every operation that only reads; switches on the ones that answer. Returns the steps. */
function cxVerify(string $prov): array
{
    $api = cxApi($prov);
    $steps = [];
    $changed = false;
    if ($api['auth'] === 'oauth2') {
        [$tok, $err] = cxToken($prov, $api, cxCreds($prov), true);
        $steps[] = ['ok' => $tok !== '', 'text' => $tok !== '' ? 'Signed in with the client ID and secret' : 'Sign-in failed: ' . $err];
        if ($tok === '') {
            return $steps;
        }
    }
    $firstId = '';
    foreach (array_keys(CX_OPS[$prov]) as $op) {
        $o = $api['ops'][$op];
        if (!in_array($op, ['reqs', 'search', 'profile'], true) || $o['path'] === '' || ($op === 'profile' && $firstId === '')) {
            continue;
        }
        $vars = ['page' => 1, 'size' => min(25, $o['size']), 'offset' => 0, 'since' => gmdate('Y-m-d\TH:i:s\Z', time() - 30 * 86400), 'since_date' => gmdate('Y-m-d', time() - 30 * 86400), 'q' => cxSampleQuery(), 'location' => '', 'radius' => 50, 'id' => $firstId];
        $r = cxCall($prov, $op, $vars);
        $ok = $r['err'] === '' && $r['code'] >= 200 && $r['code'] < 300;
        $items = $op === 'profile' && is_array($r['data']) ? [$r['data']] : ($r['items'] ?? []);
        $alt = '';
        if ($op === 'search' && $ok && !$items) {
            // v36: the newest requirement's title found no one: try broader words, so the profile can be tested too
            foreach (['java developer', 'developer', 'engineer'] as $w) {
                if (mb_strtolower((string) $vars['q']) === $w) {
                    continue;
                }
                $r2 = cxCall($prov, $op, ['q' => $w] + $vars);
                if ($r2['err'] === '' && $r2['code'] >= 200 && $r2['code'] < 300 && !empty($r2['items'])) {
                    [$r, $items, $alt] = [$r2, $r2['items'], $w];
                    break;
                }
            }
        }
        if ($ok) {
            if (in_array($op, ['reqs', 'search'], true) && $o['items'] === '' && $r['data'] !== null) {
                $o['items'] = cxItemsPath($r['data']);
            }
            $auto = cxAutoMap($items, $op);
            if ($items && (!$o['map'] || array_diff_key($auto, $o['map']))) {
                $o['map'] = $o['map'] + $auto;
            }
            $o['on'] = true;
            $api['ops'][$op] = $o;
            $changed = true;
            if ($op === 'search' && $items) {
                $firstId = cxMap($items[0], $o['map'], 'search')['id'] ?? '';
            }
        }
        $steps[] = ['ok' => $ok, 'op' => $op, 'text' => CX_OPS[$prov][$op] . ($ok ? ': answered ' . $r['code'] . ($op !== 'profile' ? ' with ' . count($items) . ' record' . (count($items) === 1 ? '' : 's') : '') . ($alt !== '' ? ' (for “' . $alt . '”; “' . $vars['q'] . '” found none)' : '') . ' — switched on' : ': ' . ($r['err'] ?: 'answered ' . $r['code']))];
    }
    // v83: never saved in a workspace running on StratEdge's inherited setup (that would copy StratEdge's document in)
    if ($changed && !cxInherited()) {
        $s = cxStore();
        $s[$prov]['api'] = $api;
        docSet('sec/x/src', (object) json_decode((string) json_encode($s)));
    }
    foreach (['post', 'update', 'close'] as $op) {
        if (isset(CX_OPS[$prov][$op]) && $api['ops'][$op]['path'] !== '' && !$api['ops'][$op]['on']) {
            $steps[] = ['ok' => null, 'op' => $op, 'text' => CX_OPS[$prov][$op] . ': ready, not switched on (nothing is posted while setting up)'];
        }
    }
    return $steps;
}
/** Words for a test search: the newest open requirement's title, else "java developer". */
function cxSampleQuery(): string
{
    try {
        require_once __DIR__ . '/vms.php';
        $best = null;
        foreach (colAll(VMS_REQ) as [$id, $q]) {
            if (in_array((string) ($q->st ?? ''), ['open', 'working'], true) && (string) ($q->ti ?? '') !== '' && (!$best || (int) ($q->at ?? 0) > (int) ($best->at ?? 0))) {
                $best = $q;
            }
        }
        if ($best) {
            return mb_substr(trim(preg_replace('/\s*[(\[].*$/', '', (string) $best->ti) ?? ''), 0, 60);
        }
    } catch (Throwable $e) {
    }
    return 'java developer';
}

/* ======================================================================================================== */
/* Running by itself: Dice candidates for every open requirement, Dice postings in step with the careers page */
/* ======================================================================================================== */

/** Who is already in the portal: "dice:<id>" and "e:<email>" → "rec:<id>" or "ats:<id>". */
function cxHaveIndex(): array
{
    $have = [];
    foreach (['rec/cand/items' => 'rec', 'ats' => 'ats'] as $col => $tag) {
        foreach (colAll($col) as [$id, $c]) {
            if (!empty($c->xid)) {
                $have[(string) $c->xid] = $tag . ':' . $id;
            }
            if (!empty($c->e)) {
                $have['e:' . strtolower((string) $c->e)] = $have['e:' . strtolower((string) $c->e)] ?? $tag . ':' . $id;
            }
        }
    }
    return $have;
}
/** The document key for a requirement's Dice results (client requirements have ':' in their IDs). */
function cxDiceKey(string $reqId): string
{
    return preg_match('/^[A-Za-z0-9_\-]{1,40}$/', $reqId) ? $reqId : 'c' . substr(md5($reqId), 0, 16);
}
/** Dice candidates for one requirement: searched with its title and main skills, scored against it like the
 *  portal's own matches, and kept on vms/dice/items/{key} (the best first). */
function cxReqSearch(string $reqId, string $by = 'schedule'): array
{
    require_once __DIR__ . '/vms.php';
    $api = cxApi('dice');
    $o = $api['ops']['search'];
    if (!$o['on']) {
        return ['ok' => false, 'err' => 'Dice candidate search is not set up (Admin › Sourcing connections).'];
    }
    $req = vmsReqGet($reqId);
    if (!$req) {
        return ['ok' => false, 'err' => 'That requirement is no longer on the desk.'];
    }
    $prof = vmsReqProfile($req);
    $ti = trim(preg_replace('/\s*[(\[].*$/', '', (string) ($req['ti'] ?? '')) ?? '');
    $extra = array_values(array_filter(array_slice($prof['skills'], 0, 4), fn($s) => !str_contains(mb_strtolower($ti), mb_strtolower((string) $s))));
    $query = trim($ti . ' ' . implode(' ', array_slice($extra, 0, 2)));
    $loc = ($req['md'] ?? '') === 'Remote' ? '' : (string) ($req['loc'] ?? '');
    $r = cxCall('dice', 'search', ['q' => $query, 'skills' => implode(', ', $extra), 'location' => $loc, 'radius' => 50, 'page' => 1, 'size' => min(50, $o['size']), 'offset' => 0]);
    if ($r['err'] !== '') {
        return ['ok' => false, 'err' => $r['err']];
    }
    $have = cxHaveIndex();
    $rows = [];
    foreach ($r['items'] as $it) {
        $m = cxMap($it, $o['map'], 'search');
        if ($m['id'] === '' && $m['name'] === '') {
            continue;
        }
        $c = ['titles' => array_values(array_filter([$m['title']])), 'skills' => array_values(array_filter(array_map('trim', preg_split('/[,;|]+/', $m['skills']) ?: []))), 'loc' => $m['loc'], 'reloc' => '', 'auth' => $m['auth']];
        [$score, $why] = vmsScore($prof, $c);
        $rows[] = [
            'id' => mb_substr($m['id'], 0, 120), 'n' => mb_substr($m['name'], 0, 120), 'ti' => mb_substr($m['title'], 0, 160), 'loc' => mb_substr($m['loc'], 0, 120),
            'sk' => mb_substr($m['skills'], 0, 300), 'exp' => mb_substr($m['exp'], 0, 20), 'auth' => mb_substr($m['auth'], 0, 60), 'e' => mb_substr($m['email'], 0, 190), 'ph' => mb_substr($m['phone'], 0, 40),
            'url' => preg_match('#^https://#', $m['url']) ? mb_substr($m['url'], 0, 400) : '', 'resume' => preg_match('#^https?://#', $m['resume']) ? mb_substr($m['resume'], 0, 400) : '', 'upd' => mb_substr($m['updated'], 0, 30),
            'score' => $score, 'why' => array_slice($why, 0, 3),
            'have' => $have['dice:' . $m['id']] ?? ($m['email'] !== '' ? ($have['e:' . strtolower($m['email'])] ?? '') : ''),
        ];
    }
    usort($rows, fn($a, $b) => $b['score'] <=> $a['score']);
    $rows = array_slice($rows, 0, max(5, min(50, (int) $api['auto']['keep'])));
    docSet('vms/dice/items/' . cxDiceKey($reqId), (object) ['rid' => $reqId, 'ti' => (string) ($req['ti'] ?? ''), 'at' => now(), 'by' => $by, 'q' => $query, 'loc' => $loc, 'found' => count($r['items']), 'rows' => $rows]);
    return ['ok' => true, 'rows' => $rows, 'q' => $query, 'loc' => $loc, 'found' => count($r['items'])];
}
/** A Dice profile into the consultant database (with its resume when the profile operation gives one). Returns
 *  ['id' => …] or ['have' => 'rec:…'] or ['err' => …]. $u null: the automation. */
function cxImportRec(?array $u, array $row, string $reqTitle = ''): array
{
    $api = cxApi('dice');
    $pid = (string) ($row['id'] ?? '');
    $x = $row;
    if ($pid !== '' && $api['ops']['profile']['on']) {
        $pr = cxCall('dice', 'profile', ['id' => $pid]);
        if ($pr['err'] === '' && is_array($pr['data'])) {
            $rec = $api['ops']['profile']['items'] !== '' ? (cxItems($pr['data'], $api['ops']['profile']['items'])[0] ?? $pr['data']) : $pr['data'];
            $m = cxMap($rec, $api['ops']['profile']['map'], 'profile');
            foreach (['name' => 'n', 'email' => 'e', 'phone' => 'ph', 'title' => 'ti', 'loc' => 'loc', 'skills' => 'sk', 'exp' => 'exp', 'auth' => 'auth', 'url' => 'url', 'resume' => 'resume'] as $from => $to) {
                if (($m[$from] ?? '') !== '' && trim((string) ($x[$to] ?? '')) === '') {
                    $x[$to] = $m[$from];
                }
            }
        }
    }
    $name = trim((string) ($x['n'] ?? ''));
    if ($name === '') {
        return ['err' => 'no name'];
    }
    $have = cxHaveIndex();
    $hit = $have['dice:' . $pid] ?? (($x['e'] ?? '') !== '' ? ($have['e:' . strtolower((string) $x['e'])] ?? '') : '');
    if ($hit !== '') {
        return ['have' => $hit];
    }
    $id = rid(8);
    $now = now();
    $doc = (object) [
        'n' => mb_substr($name, 0, 120), 'e' => mb_strtolower(mb_substr((string) ($x['e'] ?? ''), 0, 190)), 'ph' => mb_substr((string) ($x['ph'] ?? ''), 0, 40),
        'ti' => mb_substr((string) ($x['ti'] ?? ''), 0, 160), 'sk' => mb_substr((string) ($x['sk'] ?? ''), 0, 600), 'loc' => mb_substr((string) ($x['loc'] ?? ''), 0, 120),
        'auth' => mb_substr((string) ($x['auth'] ?? ''), 0, 60), 'exp' => mb_substr((string) ($x['exp'] ?? ''), 0, 20), 'li' => preg_match('#^https://#', (string) ($x['url'] ?? '')) ? (string) $x['url'] : '',
        'src' => 'Dice', 'tags' => ['Dice'], 'st' => 'active', 'xid' => 'dice:' . $pid,
        'notes' => 'Imported from Dice' . ($reqTitle !== '' ? ' for the requirement “' . $reqTitle . '”' : '') . ($u ? ' by ' . $u['name'] : ' by the automatic Dice search') . ' on ' . date('M j, Y') . '.',
        'by' => $u ? (string) $u['id'] : 'auto', 'byn' => $u ? (string) $u['name'] : 'Dice automation', 'at' => $now, 'u' => $now, 'un' => $u ? (string) $u['name'] : 'Dice automation',
    ];
    docSet('rec/cand/items/' . $id, $doc);
    $resume = false;
    if (($x['resume'] ?? '') !== '') {
        // v83: the Dice sign-in goes only to the Dice API host; a resume link elsewhere is fetched without it
        [$h] = cxApiHostOf($api, (string) $x['resume']) ? cxAuth('dice', $api) : [[]];
        [$code, $body, $rh] = cxHttp('GET', (string) $x['resume'], $h, null, 30);
        $ct = strtolower((string) ($rh['content-type'] ?? ''));
        $ext = str_contains($ct, 'pdf') || str_starts_with($body, '%PDF') ? 'pdf' : (str_contains($ct, 'word') || str_starts_with($body, "PK\x03\x04") ? 'docx' : '');
        if ($code === 200 && $ext !== '' && strlen($body) > 100 && strlen($body) <= (int) cfg('max_upload_mb') * 1048576) {
            $dir = cfg('files_dir');
            if (!is_dir($dir)) {
                @mkdir($dir, 0775, true);
            }
            $fid = rid(16);
            if (file_put_contents("$dir/$fid", $body) !== false) {
                fileSealPath("$dir/$fid");
                $fname = (preg_replace('/[^A-Za-z0-9 _\-]/', '', $name) ?: 'resume') . ' (Dice).' . $ext;
                docSet('rec/cand/items/' . $id . '/f/' . $fid, (object) ['n' => $fname, 'ty' => MIME[$ext] ?? 'application/octet-stream', 'sz' => strlen($body), 'at' => $now, 'c' => 'resume']);
                $doc->rid = $fid;
                $doc->rn = $fname;
                docSet('rec/cand/items/' . $id, $doc);
                $resume = true;
            }
        }
    }
    return ['id' => $id, 'n' => $name, 'resume' => $resume];
}
/** What a careers job looks like to Dice, for spotting changes (title, text, place, terms). */
function cxJobHash(stdClass $j): string
{
    return substr(hash('sha256', json_encode([(string) ($j->ti ?? ''), (string) ($j->d ?? ''), (string) ($j->loc ?? ''), (string) ($j->md ?? ''), (string) ($j->ty ?? ''), (string) ($j->rate ?? ''), (string) ($j->dur ?? ''), (string) ($j->visa ?? ''), (string) ($j->sk ?? '')]) ?: ''), 0, 16);
}
/* ---------- v37.1: reading what a job board answered to a posting ----------
   Job boards answer a new posting in many shapes: {"jobId": …}, {"data": {"job": {"jobPostingId": …}}}, an empty body
   with Location: /jobs/123, the bare ID as text, XML. The portal looks for the ID in that order of trust, saves where it
   found it (so every later answer is read the same way), and never takes a field that names something else (the
   company, the user, the request) or our own job ID echoed back. When a board accepts a job but says nothing usable,
   the job is marked "live, ID unknown": it is never sent twice, and the ID can be typed in by hand. */
const CX_ID_KEYS = [
    'jobpostingid' => 0, 'postingid' => 0, 'dicejobid' => 0, 'dicepostingid' => 0, 'diceid' => 0,
    'jobid' => 1, 'positionid' => 1, 'vacancyid' => 1, 'listingid' => 1, 'advertid' => 1, 'externaljobid' => 1, 'resourceid' => 1,
    'entityid' => 2, 'recordid' => 2, 'objectid' => 2, 'adid' => 2,
    'id' => 3, 'uuid' => 3, 'guid' => 3, 'externalid' => 3,
    'jobkey' => 4, 'postingkey' => 4, 'referenceid' => 4, 'jobreference' => 4, 'postingreference' => 4, 'postingnumber' => 4, 'jobnumber' => 4,
];
// a plain "id" (or url) counts only at the top of the answer or inside one of these, never in company.id or user.id
const CX_ID_HOLDERS = ['data', 'result', 'results', 'job', 'jobs', 'posting', 'postings', 'jobposting', 'jobpostings', 'item', 'items', 'payload', 'response', 'body', 'record', 'entity', 'created', 'value', 'content', 'resource', 'listing', 'position', 'vacancy'];
const CX_URL_KEYS = ['postingurl' => 0, 'jobpostingurl' => 0, 'jobdetailurl' => 0, 'jobdetailsurl' => 0, 'joburl' => 1, 'publicurl' => 1, 'viewurl' => 1, 'detailurl' => 1, 'detailsurl' => 1, 'permalink' => 1, 'weburl' => 2, 'url' => 3, 'link' => 3, 'href' => 3];

/** Looks like a posting ID: one short token, not a word like "ok", not a link, not our own job ID. */
function cxIdOk(string $v, string $ownId = ''): bool
{
    $v = trim($v);
    return $v !== '' && $v !== '0' && strlen($v) <= 120 && $v !== $ownId
        && preg_match('/^[A-Za-z0-9][A-Za-z0-9_\-.:]*$/', $v) === 1
        && !preg_match('/^(ok|okay|success|successful|succeeded|created|accepted|queued|pending|processing|true|false|null|none|done|posted|yes|no|error|failed)$/i', $v);
}
/** [value, path] of the best-ranked key in a parsed answer: breadth first, 4 levels, a one-item list looked into;
 *  one wrapper around everything (an XML root element, {"response": {…}}) counts as the top. */
function cxFindKey($data, array $keys, callable $ok): array
{
    if (!is_array($data) || $data === []) {
        return ['', ''];
    }
    $start = [$data, '', 0, ''];
    if (count($data) === 1 && is_array(reset($data)) && !cxIsList(reset($data))) {
        $start = [reset($data), (string) key($data), 0, ''];
    } elseif (cxIsList($data)) {
        if (count($data) !== 1 || !is_array($data[0])) {
            return ['', ''];
        }
        $start = [$data[0], '0', 0, ''];
    }
    $best = null;
    $queue = [$start];
    while ($queue) {
        [$node, $path, $d, $parent] = array_shift($queue);
        foreach ($node as $k => $v) {
            $nk = strtolower((string) preg_replace('/[^a-z0-9]/i', '', (string) $k));
            $p = ltrim($path . '.' . $k, '.');
            if (is_array($v)) {
                if ((string) $k === '@attributes') {
                    // XML attributes belong to the element they sit on
                    $queue[] = [$v, $p, $d, $parent];
                } elseif ($d < 4 && !cxIsList($v)) {
                    $queue[] = [$v, $p, $d + 1, $nk];
                } elseif ($d < 4 && count($v) === 1 && is_array($v[0])) {
                    $queue[] = [$v[0], $p . '.0', $d + 1, $nk];
                }
                continue;
            }
            if (!isset($keys[$nk]) || ($keys[$nk] >= 3 && $d > 0 && !in_array($parent, CX_ID_HOLDERS, true))) {
                continue;
            }
            $val = cxText($v);
            if (!$ok($val)) {
                continue;
            }
            $score = $keys[$nk] * 10 + $d;
            if ($best === null || $score < $best[0]) {
                $best = [$score, $val, $p];
            }
        }
    }
    return $best ? [$best[1], $best[2]] : ['', ''];
}
/** The last part of a Location address when it is an ID (…/jobs/DJ-123 → DJ-123). */
function cxIdFromLocation(string $v, string $ownId): string
{
    $v = trim($v);
    // Some APIs return Location: /jobs?postingId=123 instead of putting the ID in the final path segment.
    $query = (string) (parse_url($v, PHP_URL_QUERY) ?? '');
    if ($query !== '') {
        parse_str($query, $q);
        foreach ($q as $k => $x) {
            $nk = strtolower((string) preg_replace('/[^a-z0-9]/i', '', (string) $k));
            $val = is_scalar($x) ? trim((string) $x) : '';
            if (isset(CX_ID_KEYS[$nk]) && cxIdOk($val, $ownId)) {
                return $val;
            }
        }
    }
    $path = (string) (parse_url($v, PHP_URL_PATH) ?? '');
    $segs = array_values(array_filter(explode('/', $path), fn($s) => $s !== ''));
    if (!$segs) {
        return '';
    }
    $last = urldecode((string) end($segs));
    return cxIdOk($last, $ownId) && !preg_match('/^(jobs?|postings?|v\d+|api|status|new)$/i', $last) ? $last : '';
}
/** A scalar ID wrapped as {data:"123"}, {result:"123"}, {created:{value:"123"}}, etc. */
function cxFindWrappedScalarId($data, string $ownId): array
{
    if (!is_array($data) || $data === []) {
        return ['', ''];
    }
    $holders = ['data', 'result', 'value', 'content', 'resource', 'created', 'record', 'entity', 'posting', 'job'];
    $queue = [[$data, '', 0]];
    while ($queue) {
        [$node, $path, $depth] = array_shift($queue);
        foreach ($node as $k => $v) {
            $nk = strtolower((string) preg_replace('/[^a-z0-9]/i', '', (string) $k));
            $p = ltrim($path . '.' . $k, '.');
            if (is_array($v) && $depth < 3 && in_array($nk, $holders, true)) {
                $queue[] = [$v, $p, $depth + 1];
                continue;
            }
            if (!is_scalar($v) || !in_array($nk, $holders, true)) {
                continue;
            }
            $val = trim((string) $v);
            if (cxIdOk($val, $ownId)) {
                return [$val, $p];
            }
        }
    }
    return ['', ''];
}
/** An ID can also be encoded in a job/posting URL in the response body. */
function cxFindIdInUrls($data, string $ownId): array
{
    if (!is_array($data) || $data === []) {
        return ['', ''];
    }
    $queue = [[$data, '', 0]];
    while ($queue) {
        [$node, $path, $depth] = array_shift($queue);
        foreach ($node as $k => $v) {
            $nk = strtolower((string) preg_replace('/[^a-z0-9]/i', '', (string) $k));
            $p = ltrim($path . '.' . $k, '.');
            if (is_array($v) && $depth < 4) {
                if (!cxIsList($v)) {
                    $queue[] = [$v, $p, $depth + 1];
                } elseif (count($v) === 1 && is_array($v[0])) {
                    $queue[] = [$v[0], $p . '.0', $depth + 1];
                }
                continue;
            }
            if (!is_scalar($v) || !(isset(CX_URL_KEYS[$nk]) || in_array($nk, ['resourceurl', 'resourceuri', 'uri'], true))) {
                continue;
            }
            $txt = trim((string) $v);
            if (!(str_starts_with($txt, '/') || preg_match('#^https?://#i', $txt))) {
                continue;
            }
            $id = cxIdFromLocation($txt, $ownId);
            if ($id !== '') {
                return [$id, $p];
            }
        }
    }
    return ['', ''];
}
/** Last resort for APIs that only say e.g. "Job ID: DJ-123" in a success message. */
function cxFindIdInMessage(string $s, string $ownId): string
{
    if (preg_match('/(?:job\s*posting|posting|job)\s*(?:id|number|#)\s*[\"\'=:>#-]*\s*([A-Za-z0-9][A-Za-z0-9_\-.:]{0,119})/i', $s, $m)) {
        return cxIdOk($m[1], $ownId) ? $m[1] : '';
    }
    return '';
}
/** A value of the answer at a saved path: a dot path in the body, @header:name, or @text (the whole plain answer). */
function cxAnswerAt(array $r, string $path, string $ownId, bool $raw = false): string
{
    if (str_starts_with($path, '@header:')) {
        $k = strtolower(trim(substr($path, 8)));
        $v = trim((string) (($r['hdrs'] ?? [])[$k] ?? ''));
        if ($raw) {
            return $v;
        }
        return in_array($k, ['location', 'content-location'], true) ? cxIdFromLocation($v, $ownId) : (cxIdOk($v, $ownId) ? $v : '');
    }
    if ($path === '@text') {
        $t = trim((string) ($r['text'] ?? ''), " \t\r\n\"'");
        return $raw || (strlen($t) <= 64 && cxIdOk($t, $ownId)) ? $t : '';
    }
    if ($path === '@message') {
        return cxFindIdInMessage((string) ($r['sample'] ?? ''), $ownId);
    }
    $v = cxText(cxGet($r['data'] ?? null, $path));
    if ($raw || cxIdOk($v, $ownId)) {
        return $v;
    }
    if (str_starts_with($v, '/') || preg_match('#^https?://#i', $v)) {
        return cxIdFromLocation($v, $ownId);
    }
    return '';
}
/** [id, where]: the saved Posting ID path first, then the body, the ID headers, a plain-text answer. */
function cxFindPostingId(array $r, string $mapped, string $ownId): array
{
    if ($mapped !== '') {
        $v = cxAnswerAt($r, $mapped, $ownId);
        if ($v !== '') {
            return [$v, $mapped];
        }
    }
    [$v, $p] = cxFindKey($r['data'] ?? null, CX_ID_KEYS, fn($x) => cxIdOk($x, $ownId));
    if ($v !== '') {
        return [$v, $p];
    }
    [$v, $p] = cxFindWrappedScalarId($r['data'] ?? null, $ownId);
    if ($v !== '') {
        return [$v, $p];
    }
    [$v, $p] = cxFindIdInUrls($r['data'] ?? null, $ownId);
    if ($v !== '') {
        return [$v, $p];
    }
    $h = (array) ($r['hdrs'] ?? []);
    foreach ($h as $k => $hv) {
        if (!in_array($k, ['location', 'content-location'], true) && cxIdOk(trim((string) $hv), $ownId)) {
            return [trim((string) $hv), '@header:' . $k];
        }
    }
    foreach (['location', 'content-location'] as $k) {
        $id = cxIdFromLocation((string) ($h[$k] ?? ''), $ownId);
        if ($id !== '') {
            return [$id, '@header:' . $k];
        }
    }
    $t = trim((string) ($r['text'] ?? ''), " \t\r\n\"'");
    if ($t !== '' && strlen($t) <= 64 && cxIdOk($t, $ownId)) {
        return [$t, '@text'];
    }
    $msgId = cxFindIdInMessage((string) ($r['sample'] ?? ''), $ownId);
    if ($msgId !== '') {
        return [$msgId, '@message'];
    }
    return ['', ''];
}
/** The public link of the posting (https, not our own site), when the answer has one. */
function cxFindPostingUrl(array $r, string $mapped): string
{
    $own = siteUrl();
    $ok = fn($x) => (bool) preg_match('#^https://\S{4,400}$#', $x) && !str_starts_with($x, $own);
    if ($mapped !== '') {
        $v = cxAnswerAt($r, $mapped, '', true);
        if ($ok($v)) {
            return $v;
        }
    }
    return cxFindKey($r['data'] ?? null, CX_URL_KEYS, $ok)[0];
}
/** A 2xx answer that still says the call did not work: a web page instead of the API, or an error inside the body.
 *  '' when nothing is wrong. */
function cxAnswerProblem(array $r, string $act): string
{
    $op = CX_OPS['dice'][$act] ?? $act;
    $tail = $act === 'post' ? ' The job was not marked as posted.' : ' Nothing was changed here.';
    $ct = (string) ($r['ctype'] ?? '');
    $head = strtolower(ltrim(substr((string) ($r['sample'] ?? ''), 0, 200)));
    // a page is a body that is HTML (an empty answer sent with the server's default text/html type is not one)
    if ($head !== '' && (str_starts_with($head, '<!doctype html') || str_starts_with($head, '<html') || (str_contains($ct, 'text/html') && str_starts_with($head, '<') && !str_starts_with($head, '<?xml')))) {
        return 'The address of "' . $op . '" answered with a web page (code ' . (int) $r['code'] . '), not with the API, so nothing confirms Dice took it. Check the base address and the path of "' . $op . '": they must be Dice\'s API address from its documents, not the dice.com website.' . $tail;
    }
    $d = $r['data'] ?? null;
    if (!is_array($d) || cxIsList($d)) {
        return '';
    }
    $layers = [$d];
    $bad = false;
    if (count($d) === 1 && is_array(reset($d)) && !cxIsList(reset($d))) {
        // one wrapper: an XML root element or {"response": {…}}; a wrapper named error or fault is the answer
        $bad = (bool) preg_match('/^(error|errors|fault|exception)$/i', (string) key($d));
        $layers[] = reset($d);
    }
    foreach (['data', 'result', 'response'] as $k) {
        if (isset($d[$k]) && is_array($d[$k]) && !cxIsList($d[$k])) {
            $layers[] = $d[$k];
        }
    }
    $msg = '';
    foreach ($layers as $L0) {
        // keys compared without case (XML answers say <Status>, JSON ones "status")
        $L = array_change_key_case($L0, CASE_LOWER);
        $flag = fn($k) => array_key_exists($k, $L) ? $L[$k] : null;
        $st = strtolower(trim((string) (is_scalar($flag('status')) ? $flag('status') : '')));
        $res = strtolower(trim((string) (is_scalar($flag('result')) ? $flag('result') : '')));
        $err = $flag('error');
        $errs = $flag('errors');
        if ($flag('success') === false || $flag('ok') === false || (is_string($flag('success')) && strtolower($flag('success')) === 'false')
            || in_array($st, ['error', 'failed', 'failure', 'fail', 'rejected', 'invalid', 'denied', 'unauthorized', 'forbidden'], true)
            || in_array($res, ['error', 'failed', 'failure', 'fail', 'rejected', 'invalid'], true)
            || ($err !== null && $err !== false && $err !== '' && $err !== [] && $err !== 0 && !(is_string($err) && in_array(strtolower(trim($err)), ['0', 'none', 'null', 'false', 'no'], true)))
            || (is_array($errs) && $errs !== []) || (is_string($errs) && trim($errs) !== '')) {
            $bad = true;
        }
        if ($bad && $msg === '') {
            foreach (['message', 'error_description', 'errormessage', 'detail', 'title', 'error', 'reason', 'description'] as $k) {
                if (isset($L[$k]) && is_scalar($L[$k]) && !is_bool($L[$k]) && trim((string) $L[$k]) !== '') {
                    $msg = trim((string) $L[$k]);
                    break;
                }
            }
            $first = function ($x): string {
                if (is_scalar($x)) {
                    return (string) $x;
                }
                if (!is_array($x) || $x === []) {
                    return '';
                }
                $x = array_change_key_case($x, CASE_LOWER);
                return cxText($x['message'] ?? $x['msg'] ?? $x['detail'] ?? $x['error'] ?? $x['description'] ?? reset($x));
            };
            if ($msg === '' && is_array($errs) && $errs) {
                $msg = $first(cxIsList($errs) ? $errs[0] : $errs);
            }
            if ($msg === '' && is_array($err)) {
                $msg = $first($err);
            }
        }
    }
    return $bad ? 'Dice answered ' . (int) $r['code'] . ' but said it did not work' . ($msg !== '' ? ': ' . mb_substr($msg, 0, 200) : '') . '.' . $tail : '';
}
/** What the last posting answer looked like: the fields with short values (secret-looking ones hidden), the ID headers,
 *  a plain answer and a sample. Shown under Post a job to choose the Posting ID by hand. */
function cxAnswerShape(array $r): array
{
    $d = $r['data'] ?? null;
    $paths = [];
    if (is_array($d) && $d !== []) {
        $list = cxIsList($d);
        $root = $list ? (is_array($d[0] ?? null) ? $d[0] : []) : $d;
        foreach (array_slice(cxPaths($root, $list ? '0' : ''), 0, 80) as $p) {
            $segs = explode('.', $p);
            $last = strtolower((string) preg_replace('/[^a-z]/i', '', (string) end($segs)));
            $v = cxGet($d, $p);
            $txt = is_array($v) ? (cxIsList($v) ? '[' . count($v) . ' items]' : '{…}') : mb_substr(cxText($v), 0, 80);
            if (preg_match('/token|secret|password|passwd|apikey|authorization|cookie|session|signature|credential/', $last)) {
                $txt = '••••';
            }
            $paths[] = [$p, $txt];
        }
    }
    return [
        'at' => now(),
        'code' => (int) ($r['code'] ?? 0),
        'ctype' => trim(explode(';', (string) ($r['ctype'] ?? ''))[0]),
        'paths' => $paths,
        'hdrs' => (array) ($r['hdrs'] ?? []),
        'text' => (string) ($r['text'] ?? ''),
        'sample' => mb_substr((string) ($r['sample'] ?? ''), 0, 2500),
    ];
}
/** Saves a path found in an answer as the operation's field path (the same as typing it under "Which field is which"). */
function cxLearnPath(string $op, string $field, string $path): void
{
    // v83: nothing is saved in a workspace running on StratEdge's inherited setup (see cxInherited)
    if (cxInherited()) {
        return;
    }
    $s = cxStore();
    if (!isset($s['dice']['api']['ops'][$op]) || !is_array($s['dice']['api']['ops'][$op])) {
        return;
    }
    $map = (array) ($s['dice']['api']['ops'][$op]['map'] ?? []);
    $map[$field] = mb_substr($path, 0, 200);
    $s['dice']['api']['ops'][$op]['map'] = $map;
    docSet('sec/x/src', (object) json_decode((string) json_encode($s)));
}
/** Posts, updates or closes one careers job on Dice. Returns ['dice' => record] (with 'warn', 'learned' or 'note'
 *  when there is something to say) or ['err' => …]. $again: post even though Dice already took it (ID unknown). */
function cxJobAct(?array $u, string $jid, string $act, bool $again = false): array
{
    $j = $jid !== '' ? docGet('org/site/jobs/' . $jid) : null;
    if (!$j) {
        return ['err' => 'No such job.'];
    }
    $api = cxApi('dice');
    if (!$api['ops'][$act]['on']) {
        return ['err' => 'Switch on and set up "' . CX_OPS['dice'][$act] . '" first.'];
    }
    $d0 = isset($j->dice) && $j->dice instanceof stdClass ? $j->dice : null;
    $isLive = $d0 && (string) ($d0->st ?? '') === 'live';
    if ($act === 'post' && !empty($j->internal)) {
        return ['err' => 'This job is internal only, so it does not go to job boards. Untick "Internal only" on the requisition first.'];
    }
    if ($act === 'post' && $u !== null && ($j->open ?? true) !== false && !jobOnBoard($j, 'dice')) {
        // v37.2: posting it by hand switches Dice on for the job, so the automation does not take it down again
        if (!empty($j->offBoards)) {
            unset($j->offBoards);
            $j->boards = ['dice'];
        } else {
            $b = array_values(array_unique(array_merge(jobBoardsCfg($j), ['dice'])));
            $j->boards = count($b) === count(SRC_BOARDS) ? [] : $b;
        }
    }
    if ($act === 'post' && $isLive && !$again) {
        return ['err' => !empty($d0->noId) ? 'Dice already took this job, but its posting ID is not known. Enter the Dice ID, or confirm posting it again.' : 'This job is already live on Dice (posting ' . (string) ($d0->id ?? '') . ').'];
    }
    if ($act !== 'post' && empty($d0->id)) {
        return ['err' => $d0 && !empty($d0->noId) ? 'Dice did not send this posting\'s ID, so it cannot be ' . ($act === 'close' ? 'closed' : 'updated') . ' from here. Enter its Dice ID first (Jobs on Dice › Enter the Dice ID).' : 'This job is not posted on Dice yet.'];
    }
    $r = cxCall('dice', $act, cxJobVars($jid, $j));
    $why = $r['err'] !== '' ? $r['err'] : cxAnswerProblem($r, $act);
    $map = $api['ops'][$act]['map'];
    [$pid, $at] = $why === '' && $act === 'post' ? cxFindPostingId($r, (string) ($map['id'] ?? ''), $jid) : ['', ''];
    if ($act === 'post') {
        secKvSet('cx_last_post', cxAnswerShape($r) + ['job' => $jid, 'ti' => mb_substr((string) ($j->ti ?? ''), 0, 120), 'err' => $why, 'id' => $pid, 'found' => $at]);
    }
    if ($why !== '') {
        return ['err' => $why];
    }
    $url = cxFindPostingUrl($r, (string) ($map['url'] ?? ''));
    $d = $d0 ?? new stdClass();
    $out = [];
    if ($act === 'post') {
        if ($pid !== '') {
            $d->id = mb_substr($pid, 0, 120);
            unset($d->noId, $d->idBy);
            if (($map['id'] ?? '') === '' && $at !== '') {
                // learned: kept as the Posting ID path, so every later answer is read the same way
                cxLearnPath('post', 'id', $at);
                $out['learned'] = $at;
            } elseif (($map['id'] ?? '') !== '' && $at !== $map['id']) {
                $out['note'] = 'The saved Posting ID path (' . $map['id'] . ') was empty in this answer; the ID was found at ' . $at . '.';
            }
        } else {
            // accepted without an ID: marked live, so neither the button nor the automation sends it a second time
            unset($d->id, $d->url, $d->idBy);
            $d->noId = true;
            $out['warn'] = 'Dice accepted the job (answer ' . (int) $r['code'] . ') but did not say which posting it is. The job is marked "Live · ID unknown" and will not be posted again. Enter its Dice ID under Jobs on Dice, or pick the Posting ID from Dice\'s last answer under Post a job.';
        }
        $d->postedAt = now();
    }
    if ($url !== '') {
        $d->url = mb_substr($url, 0, 400);
    }
    $d->st = $act === 'close' ? 'closed' : 'live';
    $d->at = now();
    $d->by = $u ? $u['name'] : 'Dice automation';
    $d->h = cxJobHash($j);
    $j->dice = $d;
    docSet('org/site/jobs/' . $jid, $j);
    audit('data', ['post' => !empty($d->noId) ? 'Job sent to Dice (no posting ID in the answer)' : 'Job posted to Dice', 'update' => 'Dice posting updated', 'close' => 'Dice posting closed'][$act], $jid, ['posting' => (string) ($d->id ?? ''), 'by' => $d->by], $u);
    return ['dice' => $d] + $out;
}
/** From the cron job (and "Run now"): the automatic Dice search for open requirements, and the postings. */
function cxAutoRun(string $by = 'schedule', int $budget = 50, bool $forceSearch = false): array
{
    require_once __DIR__ . '/vms.php';
    $api = cxApi('dice');
    $a = $api['auto'];
    $res = ['at' => now(), 'by' => $by, 'searched' => 0, 'found' => 0, 'imported' => 0, 'posted' => 0, 'updated' => 0, 'closed' => 0, 'waiting' => 0, 'noId' => 0, 'err' => ''];
    $t0 = microtime(true);
    if (($a['search'] > 0 || $forceSearch) && $api['ops']['search']['on']) {
        $seen = secKv('cx_dice_seen');
        $seen = is_array($seen) ? $seen : [];
        $open = [];
        foreach (colAll(VMS_REQ) as [$id, $q]) {
            if (in_array((string) ($q->st ?? ''), ['open', 'working'], true) && trim((string) ($q->ti ?? '')) !== '') {
                $open[(string) $id] = $q;
            }
        }
        $due = $forceSearch ? array_keys($open) : array_values(array_filter(array_keys($open), fn($id) => (int) ($seen[$id] ?? 0) < now() - $a['search'] * 3600000 + 60000));
        usort($due, fn($x, $y) => ((int) ($seen[$x] ?? 0)) <=> ((int) ($seen[$y] ?? 0)));
        foreach (array_slice($due, 0, 12) as $id) {
            if (microtime(true) - $t0 > $budget) {
                break;
            }
            $r = cxReqSearch((string) $id, $by);
            $seen[$id] = now();
            if (!$r['ok']) {
                $res['err'] = $r['err'];
                break;
            }
            $res['searched']++;
            $res['found'] += count($r['rows']);
            $got = 0;
            if ($a['import'] > 0) {
                $doc = docGet('vms/dice/items/' . cxDiceKey((string) $id));
                foreach ($r['rows'] as $k => $row) {
                    if ($got >= $a['import'] || $row['score'] < $a['min']) {
                        break;
                    }
                    if ($row['have'] !== '') {
                        continue;
                    }
                    $imp = cxImportRec(null, $row, (string) $open[$id]->ti);
                    if (!empty($imp['id'])) {
                        $got++;
                        $res['imported']++;
                        if ($doc && isset($doc->rows[$k])) {
                            $doc->rows[$k]->have = 'rec:' . $imp['id'];
                            $doc->rows[$k]->auto = true;
                        }
                    }
                }
                if ($doc && $got) {
                    docSet('vms/dice/items/' . cxDiceKey((string) $id), $doc);
                }
            }
            if ($r['rows'] || $got) {
                $q = $open[$id];
                $log = (array) ($q->vlog ?? []);
                $log[] = (object) ['t' => now(), 'ev' => 'Dice: ' . count($r['rows']) . ' candidate' . (count($r['rows']) === 1 ? '' : 's') . ' found' . ($got ? ', ' . $got . ' added to the consultant database' : '')];
                $q->vlog = array_slice($log, -30);
                docSet(VMS_REQ . '/' . $id, $q);
            }
        }
        secKvSet('cx_dice_seen', array_intersect_key($seen, $open));
    }
    // v37.1: before this version a posting Dice took without an ID was not recorded, so every run sent it again. The
    // first run after the upgrade that finds that error from before pauses the posting once, so the doubles on Dice
    // can be cleaned up and the IDs entered before anything else is sent.
    $prev = secKv('cx_dice_auto');
    if ($a['jobs'] && $api['ops']['post']['on'] && is_array($prev) && str_contains((string) ($prev['err'] ?? ''), 'answer had no posting ID')) {
        // v83: the switch is saved only where the setup is the site's own (never copied into a workspace)
        if (!cxInherited()) {
            $s = cxStore();
            $s['dice']['api']['auto']['jobs'] = false;
            docSet('sec/x/src', (object) json_decode((string) json_encode($s)));
        }
        $a['jobs'] = false;
        $res['paused'] = true;
        $res['err'] = 'Posting to Dice was paused once after the upgrade: earlier runs sent jobs that Dice took without saying their IDs, so some may be on Dice more than once. Check your Dice postings, remove any doubles, enter each job\'s Dice ID under Jobs on Dice ("Already on Dice?"), then switch "Keep Dice in step" back on.';
        audit('settings', 'Dice posting automation paused (postings without IDs before v37.1)', 'dice', [], null);
    }
    if ($a['jobs'] && $api['ops']['post']['on']) {
        $live = 0;
        $jobs = colAll('org/site/jobs');
        foreach ($jobs as [$jid, $j]) {
            if (($j->dice->st ?? '') === 'live') {
                $live++;
            }
        }
        foreach ($jobs as [$jid, $j]) {
            if (microtime(true) - $t0 > $budget + 30) {
                break;
            }
            // v37.2: open AND meant for Dice (not internal only, Dice not switched off for it); otherwise a live posting closes
            $open = jobOnBoard($j, 'dice');
            $st = (string) ($j->dice->st ?? '');
            $hasId = !empty($j->dice->id);
            // v37.1: a job Dice took without saying its ID is never posted again; it waits for its ID (typed in)
            $noId = !empty($j->dice->noId) && $st === 'live';
            $act = '';
            if ($open && !$hasId && !$noId && $live < $a['slots']) {
                $act = 'post';
            } elseif ($open && $st === 'live' && $hasId && $api['ops']['update']['on'] && (string) ($j->dice->h ?? '') !== cxJobHash($j)) {
                $act = 'update';
            } elseif (!$open && $st === 'live' && $hasId && $api['ops']['close']['on']) {
                $act = 'close';
            } elseif ($noId && (!$open || (string) ($j->dice->h ?? '') !== cxJobHash($j))) {
                // closed or changed here, but without its ID it cannot be closed or updated on Dice
                $res['waiting'] = ($res['waiting'] ?? 0) + 1;
            }
            if ($act === '') {
                continue;
            }
            $r = cxJobAct(null, (string) $jid, $act);
            if (isset($r['err'])) {
                $res['err'] = $res['err'] ?: CX_OPS['dice'][$act] . ': ' . $r['err'];
                continue;
            }
            $res[['post' => 'posted', 'update' => 'updated', 'close' => 'closed'][$act]]++;
            if (isset($r['warn'])) {
                $res['noId']++;
            }
            $live += $act === 'post' ? 1 : ($act === 'close' ? -1 : 0);
        }
    }
    secKvSet('cx_dice_auto', $res);
    return $res;
}
/** For the cron job: the Dice automation when it is due (every run checks; the search interval is per requirement). */
function cxAutoCron(): array
{
    $api = cxApi('dice');
    // v83: a workspace running on StratEdge's inherited setup never searches or posts through StratEdge's Dice account
    if (cxInherited()) {
        return ['ran' => false];
    }
    if (($api['auto']['search'] <= 0 || !$api['ops']['search']['on']) && (!$api['auto']['jobs'] || !$api['ops']['post']['on'])) {
        return ['ran' => false];
    }
    $last = secKv('cx_dice_auto');
    if (is_array($last) && (int) ($last['at'] ?? 0) > now() - 14 * 60000) {
        return ['ran' => false];
    }
    return ['ran' => true] + cxAutoRun('schedule');
}

/* ======================================================================================================== */
/* Routes                                                                                                     */
/* ======================================================================================================== */

/** cx_auto: set the connection up from documents, an address, or the base address alone. Administrators. */
function cxAutoRoute(array $u, string $prov, array $b): array
{
    @set_time_limit(180);
    $replace = !empty($b['replace']) || ($_POST['replace'] ?? '') === '1';
    $docs = [];
    if (!empty($_FILES['files']) && is_array($_FILES['files']['name'] ?? null)) {
        foreach ((array) $_FILES['files']['name'] as $i => $name) {
            $tmp = (string) ($_FILES['files']['tmp_name'][$i] ?? '');
            if ((int) ($_FILES['files']['error'][$i] ?? 1) === 0 && is_uploaded_file($tmp) && filesize($tmp) <= 15 * 1048576) {
                $docs[] = [basename((string) $name), (string) file_get_contents($tmp), ''];
            }
        }
    }
    $url = trim((string) ($_POST['url'] ?? ($b['url'] ?? '')));
    $looked = [];
    if ($url !== '') {
        if (($why = cxUrlProblem($url)) !== '') {
            fail(400, 'invalid_argument', 'Documents address: ' . $why);
        }
        $api = cxApi($prov);
        // v83: the saved sign-in goes only to the connection's own API host; documents elsewhere are fetched without it
        [$h] = cxApiHostOf($api, $url) ? cxAuth($prov, $api) : [[]];
        [$code, $body] = cxHttp('GET', $url, array_merge($h, ['Accept: application/json, application/yaml, text/yaml, text/html, */*']), null, 20);
        $looked[] = $url . ' → ' . ($code ?: 'no answer');
        if ($code === 200 && $body !== '') {
            $docs[] = [basename((string) parse_url($url, PHP_URL_PATH)) ?: 'documents', $body, $url];
        } else {
            fail(400, 'invalid_argument', 'The documents address answered ' . ($code ?: 'nothing') . '. Download the documents and drop the file instead.');
        }
    }
    $sp = null;
    $kinds = [];
    foreach ($docs as [$name, $data, $from]) {
        $one = cxReadDoc($name, $data, $from);
        if (!$one) {
            continue;
        }
        $kinds[] = $name . ': ' . $one['kind'] . ' (' . count($one['ops']) . ' operation' . (count($one['ops']) === 1 ? '' : 's') . ')';
        if (!$sp) {
            $sp = $one;
        } else {
            // several files: the operations add up; the first base address and sign-in win
            $sp['ops'] = array_merge($sp['ops'], $one['ops']);
            $sp['base'] = $sp['base'] ?: $one['base'];
            if ($sp['auth']['kind'] === '') {
                $sp['auth'] = $one['auth'];
            }
            $sp['text'] = trim(($sp['text'] ?? '') . "\n\n" . ($one['text'] ?? ''));
        }
    }
    if (!$docs) {
        // nothing dropped: look at the usual addresses of the base address
        $base = trim((string) ($_POST['base'] ?? ($b['base'] ?? cxApi($prov)['base'])));
        if ($base === '') {
            fail(400, 'invalid_argument', 'Drop the API documents (or give their address, or the base address) first.');
        }
        if (($why = cxProviderUrlProblem($prov, $base)) !== '') {
            fail(400, 'invalid_argument', 'Base address: ' . $why);
        }
        [$sp, $looked] = cxDiscover($prov, $base);
        if ($sp) {
            $kinds[] = 'Found at the base address: ' . $sp['kind'];
            if ($sp['base'] === '') {
                $sp['base'] = $base;
            }
        }
    }
    if (!$sp) {
        return ['ok' => false, 'kinds' => $kinds, 'looked' => $looked, 'err' => $docs ? 'These files hold no API operations the portal could read. Drop the OpenAPI (Swagger) file, a Postman collection, or the documents with the request examples.' : 'No API documents were found at the usual addresses. Drop the documents ' . CX_PROVS[$prov] . ' gave you instead.'];
    }
    if (!empty($sp['text'])) {
        $sp = cxAiDocs($prov, $sp);
    }
    [$api, $plan, $warn] = cxPlan($prov, $sp, $replace);
    if ($api['base'] !== '' && ($why = cxProviderUrlProblem($prov, $api['base'])) !== '') {
        fail(400, 'invalid_argument', 'The documents produced an invalid base address: ' . $why);
    }
    foreach ($api['ops'] as $op => $o) {
        if (!empty($o['path']) && preg_match('#^https?://#i', (string) $o['path']) && !str_contains((string) $o['path'], '{')) {
            if (($why = cxProviderUrlProblem($prov, (string) $o['path'])) !== '') {
                fail(400, 'invalid_argument', (CX_OPS[$prov][$op] ?? $op) . ': ' . $why);
            }
        }
    }
    // saved like "Save the connection" (checks included)
    $s = cxStore();
    $s[$prov]['api'] = $api;
    docSet('sec/x/src', (object) json_decode((string) json_encode($s)));
    secKvSet('cxtok_' . $prov, []);
    audit('settings', CX_PROVS[$prov] . ' API connection set up from documents', $prov, ['kinds' => $kinds, 'base' => $api['base'], 'auth' => $api['auth']], $u);
    $c = cxCreds($prov);
    $steps = ($c['id'] !== '' || $c['key'] !== '' || $c['token'] !== '' || $api['auth'] === 'none') ? cxVerify($prov) : [['ok' => false, 'text' => 'Save the ' . ($prov === 'dice' ? 'client ID and secret' : 'API credentials') . ' above, then press "Set it up" again to sign in and test.']];
    return ['ok' => true, 'kinds' => $kinds, 'looked' => $looked, 'base' => $api['base'], 'auth' => $api['auth'], 'tokenUrl' => $api['tokenUrl'], 'plan' => $plan, 'steps' => $steps, 'warn' => $warn, 'api' => cxApi($prov)];
}
/** vms_dice, vms_dice_import: the Requirements desk's "On Dice" tab (staff, recruiters and bench). */
function cxDeskRoute(array $u, string $r, array $b): array
{
    require_once __DIR__ . '/vms.php';
    $api = cxApi('dice');
    $id = (string) ($b['id'] ?? '');
    if (!$api['ops']['search']['on']) {
        return ['on' => false];
    }
    $key = cxDiceKey($id);
    if ($r === 'vms_dice') {
        if (!empty($b['fresh']) || !docGet('vms/dice/items/' . $key)) {
            if (throttleHit('vmsdice:' . $u['id'], 60, 3600)) {
                fail(429, 'rate_limited', 'That is a lot of Dice searches in an hour. Try again later.');
            }
            $res = cxReqSearch($id, $u['name']);
            if (!$res['ok']) {
                fail(502, 'upstream', $res['err']);
            }
        }
        $d = docGet('vms/dice/items/' . $key);
        return ['on' => true, 'res' => $d, 'auto' => $api['auto'], 'profile' => $api['ops']['profile']['on']];
    }
    // import picked rows
    $d = docGet('vms/dice/items/' . $key);
    if (!$d) {
        fail(404, 'not_found', 'Search Dice for this requirement first.');
    }
    $want = array_flip(array_map('strval', (array) ($b['rows'] ?? [])));
    $added = [];
    $had = 0;
    foreach ((array) $d->rows as $k => $row) {
        if (!isset($want[(string) $row->id])) {
            continue;
        }
        $res = cxImportRec($u, (array) $row, (string) ($d->ti ?? ''));
        if (!empty($res['id'])) {
            $added[] = $res;
            $d->rows[$k]->have = 'rec:' . $res['id'];
        } elseif (!empty($res['have'])) {
            $had++;
            $d->rows[$k]->have = $res['have'];
        }
    }
    docSet('vms/dice/items/' . $key, $d);
    if ($added) {
        audit('data', 'Candidates added from Dice', $id, ['n' => count($added)], $u);
    }
    return ['added' => $added, 'had' => $had, 'res' => $d];
}
