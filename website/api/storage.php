<?php
declare(strict_types=1);
/*
  The storage box: every file the site keeps (resumes, timesheets, documents, MSAs, invoice and bill attachments,
  inbox attachments, shared-box uploads), with where it belongs and who it is for, plus a shared box where staff
  drop files with a note and tags. Files live in storage/files/{id}; their records at {base}/f/{id}.
*/

function storageKindOf(string $base, ?string $c): string
{
    if ($c === 'resume') {
        return 'resume';
    }
    if ($c === 'msa') {
        return 'msa';
    }
    if ($c === 'box' || str_starts_with($base, 'org/box/')) {
        return 'box';
    }
    if (preg_match('#^u/u_[a-f0-9]+/ts#', $base) || str_contains($base, '/ts/')) {
        return 'timesheet';
    }
    if (str_starts_with($base, 'inbox/')) {
        return 'attachment';
    }
    if (str_starts_with($base, 'exp/') || str_starts_with($base, 'inv/')) {
        return 'finance';
    }
    if (str_starts_with($base, 'sig/')) {
        return 'esign';
    }
    if (str_starts_with($base, 'hrms/') || str_starts_with($base, 'org/hr/')) {
        return 'hr';
    }
    if (str_starts_with($base, 'u/') || $c === 'doc' || $c === 'document') {
        return 'document';
    }
    return 'other';
}
const STORAGE_KIND_NAMES = [
    'resume' => 'Resumes',
    'timesheet' => 'Timesheets',
    'document' => 'Employee documents',
    'msa' => 'MSAs and contracts',
    'finance' => 'Invoices and bills',
    'esign' => 'E-signature documents',
    'hr' => 'HR policies and records',
    'attachment' => 'Email attachments',
    'box' => 'Shared box',
    'other' => 'Other',
];
/** A plain-language label for where a file belongs ("Resume · Priya Venkatesan", "Timesheet · Anirudh K."). */
function storageWhere(string $base, array &$cache): string
{
    $name = function (string $uid) use (&$cache): string {
        if (!isset($cache['u:' . $uid])) {
            $s = db()->prepare('SELECT name FROM users WHERE id = ?');
            $s->execute([$uid]);
            $n = (string) ($s->fetchColumn() ?: '');
            if ($n === '') {
                $d = docGet('u/' . $uid);
                $n = (string) ($d->p->n ?? $uid);
            }
            $cache['u:' . $uid] = $n;
        }
        return $cache['u:' . $uid];
    };
    $docName = function (string $path, array $keys) use (&$cache): string {
        if (!isset($cache['d:' . $path])) {
            $d = docGet($path);
            $v = '';
            if ($d) {
                foreach ($keys as $k) {
                    if (isset($d->$k) && is_scalar($d->$k) && (string) $d->$k !== '') {
                        $v = (string) $d->$k;
                        break;
                    }
                }
            }
            $cache['d:' . $path] = $v;
        }
        return $cache['d:' . $path];
    };
    if (preg_match('#^u/(u_[a-f0-9]+)(?:/(.*))?$#', $base, $m)) {
        $rest = $m[2] ?? '';
        $what = $rest === '' ? 'Profile' : (str_starts_with($rest, 'ts') ? 'Timesheet' . (preg_match('#ts/(\d{4}-\d{2}-\d{2})#', $rest, $w) ? ' ' . $w[1] : '') : (str_starts_with($rest, 'doc') ? 'Document' : (str_starts_with($rest, 'res') ? 'Resume' : ucfirst(str_replace('/', ' ', $rest)))));
        return $what . ' · ' . $name($m[1]);
    }
    if (preg_match('#^rec/cand/items/([^/]+)#', $base, $m)) {
        return 'Consultant database · ' . ($docName('rec/cand/items/' . $m[1], ['n']) ?: $m[1]);
    }
    if (preg_match('#^ats/([^/]+)#', $base, $m)) {
        return 'Candidate (ATS) · ' . ($docName('ats/' . $m[1], ['n']) ?: $m[1]);
    }
    if (preg_match('#^vms/vendor/items/([^/]+)#', $base, $m)) {
        return 'Vendor · ' . ($docName('vms/vendor/items/' . $m[1], ['n']) ?: $m[1]);
    }
    if (preg_match('#^org/box/items/([^/]+)#', $base, $m)) {
        return 'Shared box · ' . ($docName('org/box/items/' . $m[1], ['t']) ?: 'untitled');
    }
    if (preg_match('#^inbox/m([^/]+)#', $base, $m)) {
        return 'Email inbox attachment';
    }
    if (preg_match('#^exp/([^/]+)#', $base, $m)) {
        return 'Bill or expense · ' . ($docName('exp/' . $m[1], ['v', 'ref']) ?: $m[1]);
    }
    if (preg_match('#^inv/([^/]+)#', $base, $m)) {
        return 'Invoice · ' . ($docName('inv/' . $m[1], ['no', 'num']) ?: $m[1]);
    }
    if (preg_match('#^sig/([^/]+)#', $base, $m)) {
        return 'E-signature · ' . ($docName('sig/' . $m[1], ['t', 'title', 'n']) ?: $m[1]);
    }
    if (preg_match('#^hrms/(?:emp|self|rev|assets)/(u_[a-f0-9]+)#', $base, $m)) {
        return 'HRMS · ' . $name($m[1]);
    }
    if (str_starts_with($base, 'org/hr/')) {
        return 'HR policies and templates';
    }
    if (preg_match('#^pub/([^/]+)#', $base, $m)) {
        return 'Client workspace · ' . ($docName('org/admin/clients/' . $m[1], ['n']) ?: $m[1]);
    }
    if (preg_match('#^e/(u_[a-f0-9]+)#', $base, $m)) {
        return 'Client contact · ' . $name($m[1]);
    }
    return $base;
}
function storageRows(): array
{
    $s = db()->prepare("SELECT path, data FROM docs WHERE path LIKE '%/f/%'");
    $s->execute();
    $out = [];
    foreach ($s->fetchAll() as $r) {
        $p = $r['path'];
        $i = strrpos($p, '/f/');
        if ($i === false) {
            continue;
        }
        $base = substr($p, 0, $i);
        $fid = substr($p, $i + 3);
        if (!preg_match('/^[a-f0-9]{32}$/', $fid)) {
            continue;
        }
        $d = json_decode($r['data']);
        if (!($d instanceof stdClass)) {
            continue;
        }
        $out[] = ['base' => $base, 'id' => $fid, 'n' => (string) ($d->n ?? 'file'), 'ty' => (string) ($d->ty ?? ''), 'sz' => (int) ($d->sz ?? 0), 'at' => (int) ($d->at ?? 0), 'c' => isset($d->c) ? (string) $d->c : null, 'w' => isset($d->w) ? (string) $d->w : ''];
    }
    return $out;
}
function storageStaff(): array
{
    $u = requireUser();
    if (userLevel($u) < 2 && !isRecruiter($u['id'])) {
        fail(403, 'forbidden', 'The storage box is for StratEdge staff.');
    }
    return $u;
}
function storageRoute(string $r, string $method, array $b): never
{
    switch ($r) {
        case 'storage_list':
            $u = storageStaff();
            $admin = userLevel($u) >= 2;
            $q = mb_strtolower(trim(str($b, 'q', 120)));
            $kind = str($b, 'kind', 20);
            $page = max(1, (int) ($b['page'] ?? 1));
            $per = 150;
            $rows = storageRows();
            usort($rows, fn($a, $c) => $c['at'] <=> $a['at']);
            $cache = [];
            $byKind = [];
            $bytes = 0;
            $list = [];
            foreach ($rows as $f) {
                $f['kind'] = storageKindOf($f['base'], $f['c']);
                $byKind[$f['kind']] = ($byKind[$f['kind']] ?? 0) + 1;
                $bytes += $f['sz'];
                // staff see everything they may read; the shared box and recruiting files for recruiters
                if (!$admin && !can($f['base'] . '/f/' . $f['id'], 'r')) {
                    continue;
                }
                if ($kind !== '' && $f['kind'] !== $kind) {
                    continue;
                }
                $f['where'] = storageWhere($f['base'], $cache);
                if ($q !== '' && !str_contains(mb_strtolower($f['n'] . ' ' . $f['where'] . ' ' . $f['kind']), $q)) {
                    continue;
                }
                $list[] = $f;
            }
            $total = count($list);
            $list = array_slice($list, ($page - 1) * $per, $per);
            $dir = (string) cfg('files_dir');
            $disk = ['free' => is_dir($dir) ? (float) @disk_free_space($dir) : 0, 'total' => is_dir($dir) ? (float) @disk_total_space($dir) : 0];
            // files on disk that no record points to (left behind by deleted records)
            $orphans = 0;
            $orphanBytes = 0;
            if ($admin && is_dir($dir)) {
                $known = array_flip(array_map(fn($f) => $f['id'], $rows));
                foreach ((array) @scandir($dir) as $fn) {
                    if (preg_match('/^[a-f0-9]{32}$/', $fn) && !isset($known[$fn])) {
                        $orphans++;
                        $orphanBytes += (int) @filesize($dir . '/' . $fn);
                    }
                }
            }
            ok(['files' => $list, 'total' => $total, 'page' => $page, 'per' => $per, 'count' => count($rows), 'bytes' => $bytes, 'byKind' => $byKind, 'kinds' => STORAGE_KIND_NAMES, 'disk' => $disk, 'orphans' => $orphans, 'orphanBytes' => $orphanBytes, 'canDelete' => $admin]);
        case 'storage_delete':
            $u = requireAdmin();
            $base = str($b, 'base', 500);
            $fid = str($b, 'id', 40);
            if (!validPath($base, true) || !preg_match('/^[a-f0-9]{32}$/', $fid)) {
                fail(400, 'invalid_argument', 'Bad file.');
            }
            docDelete("$base/f/$fid");
            $f = cfg('files_dir') . '/' . $fid;
            if (is_file($f)) {
                @unlink($f);
            }
            ok(['ok' => true]);
        case 'storage_cleanup':
            requireAdmin();
            $dir = (string) cfg('files_dir');
            $known = array_flip(array_map(fn($f) => $f['id'], storageRows()));
            $n = 0;
            foreach ((array) @scandir($dir) as $fn) {
                if (preg_match('/^[a-f0-9]{32}$/', $fn) && !isset($known[$fn]) && @filemtime($dir . '/' . $fn) < time() - 3600) {
                    if (@unlink($dir . '/' . $fn)) {
                        $n++;
                    }
                }
            }
            ok(['removed' => $n]);
        /* the shared box: notes with files, for everyone on staff */
        case 'storage_box':
            storageStaff();
            $items = [];
            foreach (colList('org/box/items', 'at', 'desc', 0) as [$id, $d]) {
                $items[(string) $id] = ['id' => (string) $id, 't' => (string) ($d->t ?? ''), 'tags' => array_values(array_filter((array) ($d->tags ?? []), 'is_string')), 'by' => (string) ($d->by ?? ''), 'byn' => (string) ($d->byn ?? ''), 'at' => (int) ($d->at ?? 0), 'files' => []];
            }
            foreach (storageRows() as $f) {
                if (preg_match('#^org/box/items/([^/]+)$#', $f['base'], $m) && isset($items[$m[1]])) {
                    $items[$m[1]]['files'][] = $f;
                }
            }
            ok(['items' => array_values($items)]);
        case 'storage_box_delete':
            $u = storageStaff();
            $id = str($b, 'id', 40);
            $d = docGet('org/box/items/' . $id);
            if (!$d) {
                ok(['ok' => true]);
            }
            if ((string) ($d->by ?? '') !== $u['id'] && !hasRole($u, 'admin')) {
                fail(403, 'forbidden', 'Only the person who added it, or an administrator, can remove it.');
            }
            foreach (storageRows() as $f) {
                if ($f['base'] === 'org/box/items/' . $id) {
                    docDelete($f['base'] . '/f/' . $f['id']);
                    $p = cfg('files_dir') . '/' . $f['id'];
                    if (is_file($p)) {
                        @unlink($p);
                    }
                }
            }
            docDelete('org/box/items/' . $id);
            ok(['ok' => true]);
        default:
            fail(404, 'not_found', 'Unknown action.');
    }
}
