<?php
declare(strict_types=1);
/*
 * v43 Expense claims: employees, consultants and staff claim back what they paid for the company. A claim holds
 * lines (date, category, merchant, amount, note, receipt; or miles at the IRS standard rate for that year); it is
 * submitted to the person's manager (Team card › Manager), or to HR and administrators when there is none; approved
 * claims wait for accounting, who mark them paid (with payroll, bank transfer or check) and the payment goes into
 * Bills & expenses (so into the books) under the category's expense account.
 * Policy (Accounting › Expense claim settings): mileage rate per year (2025: $0.70, 2026: $0.725 a mile, IRS), a
 * receipt from $75 (the IRS substantiation threshold for an accountable plan), a 60-day submission window (the IRS
 * safe harbor for substantiating within a reasonable time), per-category limits.
 */

const XC_ST = ['draft' => 'Draft', 'submitted' => 'Waiting for approval', 'returned' => 'Returned for changes', 'approved' => 'Approved, to be paid', 'rejected' => 'Rejected', 'paid' => 'Paid'];
const XC_PAY = ['payroll' => 'With payroll', 'bank' => 'Bank transfer', 'check' => 'Check', 'other' => 'Other'];

function xcDefaults(): array
{
    return [
        'rates' => ['2025' => 0.70, '2026' => 0.725],
        'receipt' => 75.0,
        'days' => 60,
        'cats' => [
            ['k' => 'travel', 'n' => 'Travel (air, rail, taxi)', 'limit' => 0, 'acct' => 'Travel'],
            ['k' => 'lodging', 'n' => 'Lodging', 'limit' => 0, 'acct' => 'Travel'],
            ['k' => 'meals', 'n' => 'Meals', 'limit' => 75, 'acct' => 'Meals & entertainment'],
            ['k' => 'mileage', 'n' => 'Mileage (own car)', 'limit' => 0, 'acct' => 'Travel'],
            ['k' => 'supplies', 'n' => 'Office supplies', 'limit' => 0, 'acct' => 'Office supplies'],
            ['k' => 'software', 'n' => 'Software & subscriptions', 'limit' => 0, 'acct' => 'Software'],
            ['k' => 'phone', 'n' => 'Phone & internet', 'limit' => 0, 'acct' => 'Phone & internet'],
            ['k' => 'training', 'n' => 'Training & certifications', 'limit' => 0, 'acct' => 'Training'],
            ['k' => 'other', 'n' => 'Other', 'limit' => 0, 'acct' => 'Other expenses'],
        ],
    ];
}
function xcSettings(): array
{
    $d = docGet('org/acct/x/claims');
    $s = xcDefaults();
    if ($d) {
        $j = json_decode((string) json_encode($d), true) ?: [];
        foreach (['rates', 'receipt', 'days', 'cats'] as $k) {
            if (isset($j[$k])) {
                $s[$k] = $j[$k];
            }
        }
    }
    return $s;
}
function xcRate(array $S, string $date): float
{
    $y = substr($date, 0, 4);
    $r = $S['rates'][$y] ?? null;
    if ($r === null) {
        $ys = array_keys($S['rates']);
        sort($ys);
        $r = $S['rates'][(string) end($ys)] ?? 0.725;
    }
    return (float) $r;
}
function xcIsPayer(array $u): bool
{
    return hasRole($u, 'admin') || hasRole($u, 'acct');
}
function xcIsApprover(array $u, stdClass $c): bool
{
    if ((string) $c->uid === $u['id']) {
        return false; // nobody approves their own claim
    }
    if ((string) ($c->appr ?? '') !== '') {
        return (string) $c->appr === $u['id'] || hasRole($u, 'admin');
    }
    return hasRole($u, 'admin') || hasRole($u, 'hr');
}
/** The claim, when this person may see it (theirs, its approver, HR/admin, accounting); else a 404. */
function xcGet(string $id, array $u): stdClass
{
    $id = preg_replace('/[^a-z0-9]/', '', $id);
    $c = $id !== '' ? docGet('xc/' . $id) : null;
    if (!$c || !((string) $c->uid === $u['id'] || xcIsApprover($u, $c) || xcIsPayer($u) || hasRole($u, 'hr'))) {
        fail(404, 'not_found', 'No such expense claim.');
    }
    $c->id = $id;
    return $c;
}
function xcTotal(stdClass $c): float
{
    $t = 0.0;
    foreach ((array) ($c->lines ?? []) as $l) {
        $t += (float) ($l->a ?? 0);
    }
    return round($t, 2);
}
function xcLog(stdClass $c, array $u, string $ev): void
{
    $log = (array) ($c->log ?? []);
    $log[] = (object) ['t' => now(), 'who' => (string) $u['name'], 'ev' => mb_substr($ev, 0, 300)];
    $c->log = array_slice($log, -100);
}
/** What the policy says about each line: a missing receipt, an old date, over the category's limit. */
function xcChecks(stdClass $c, array $S, array $files): array
{
    $out = [];
    $cats = [];
    foreach ($S['cats'] as $k) {
        $cats[$k['k']] = $k;
    }
    $has = [];
    foreach ($files as $f) {
        $has[(string) ($f['c'] ?? '')] = true;
    }
    $old = date('Y-m-d', time() - (int) $S['days'] * 86400);
    foreach ((array) ($c->lines ?? []) as $l) {
        $w = [];
        if ((string) $l->cat !== 'mileage' && (float) $l->a >= (float) $S['receipt'] && empty($has[(string) $l->id])) {
            $w[] = 'receipt';
        }
        if ((string) $l->d < $old) {
            $w[] = 'old';
        }
        $lim = (float) ($cats[(string) $l->cat]['limit'] ?? 0);
        if ($lim > 0 && (float) $l->a > $lim) {
            $w[] = 'limit';
        }
        if ($w) {
            $out[(string) $l->id] = $w;
        }
    }
    return $out;
}
function xcFiles(string $id): array
{
    $out = [];
    foreach (colAll('xc/' . $id . '/f') as [$fid, $f]) {
        $out[] = ['id' => (string) $fid, 'n' => (string) ($f->n ?? ''), 'ty' => (string) ($f->ty ?? ''), 'sz' => (int) ($f->sz ?? 0), 'c' => (string) ($f->c ?? '')];
    }
    return $out;
}
function xcView(stdClass $c, array $u, bool $full = false): array
{
    $S = xcSettings();
    $files = $full ? xcFiles((string) $c->id) : [];
    $out = [
        'id' => (string) $c->id, 'num' => (string) ($c->num ?? ''), 'uid' => (string) $c->uid, 'n' => (string) ($c->n ?? ''), 'title' => (string) ($c->title ?? ''), 'st' => (string) $c->st,
        'total' => xcTotal($c), 'cur' => 'USD', 'lines' => array_values((array) ($c->lines ?? [])), 'at' => (int) ($c->at ?? 0), 'u' => (int) ($c->u ?? 0), 'sub' => (int) ($c->sub ?? 0),
        'appr' => (string) ($c->appr ?? ''), 'apprN' => (string) ($c->apprN ?? ''), 'dec' => $c->dec ?? null, 'paid' => $c->paid ?? null,
        'mine' => (string) $c->uid === $u['id'], 'canDecide' => (string) $c->st === 'submitted' && xcIsApprover($u, $c), 'canPay' => (string) $c->st === 'approved' && xcIsPayer($u),
        'canEdit' => (string) $c->uid === $u['id'] && in_array((string) $c->st, ['draft', 'returned'], true),
    ];
    if ($full) {
        $out['files'] = $files;
        $out['tok'] = (string) ($c->tok ?? '');
        $out['checks'] = (object) xcChecks($c, $S, $files);
        $out['log'] = array_values((array) ($c->log ?? []));
    }
    return $out;
}
function xcNext(): string
{
    $p = db();
    $k = 'xc' . date('Y');
    $p->beginTransaction();
    try {
        if (!$p->query("SELECT v FROM meta WHERE k='$k'")->fetch()) {
            $p->exec("INSERT INTO meta (k, v) VALUES ('$k', 0)");
        }
        $p->exec("UPDATE meta SET v = v + 1 WHERE k = '$k'");
        $n = (int) $p->query("SELECT v FROM meta WHERE k = '$k'")->fetchColumn();
        $p->commit();
    } catch (Throwable $e) {
        $p->rollBack();
        throw $e;
    }
    return sprintf('EC-%s-%04d', date('Y'), $n);
}
function xcMail(string $uid, string $subject, string $body): void
{
    $row = userRow($uid);
    if (!$row || !filter_var((string) $row['email'], FILTER_VALIDATE_EMAIL)) {
        return;
    }
    try {
        sendMail((string) $row['email'], (string) $row['name'], $subject, $body, emailHtml($subject, preg_split('/\n{2,}/', $body)));
    } catch (Throwable $e) {
        // the claim stands; the email can be missed
    }
}

function xcRoute(string $r, array $b): never
{
    $u = requireUser();
    $str = fn(string $k, int $max) => mb_substr(trim((string) ($b[$k] ?? '')), 0, $max);
    switch ($r) {
        case 'xc_settings':
            $S = xcSettings();
            ok(['settings' => $S, 'payer' => xcIsPayer($u), 'st' => XC_ST, 'pay' => XC_PAY]);

        case 'xc_settings_save':
            if (!xcIsPayer($u)) {
                fail(403, 'forbidden', 'Accounting and administrators set the expense policy.');
            }
            $S = xcSettings();
            $rates = [];
            foreach ((array) ($b['rates'] ?? []) as $y => $v) {
                if (preg_match('/^20\d{2}$/', (string) $y) && (float) $v > 0 && (float) $v < 5) {
                    $rates[(string) $y] = round((float) $v, 3);
                }
            }
            $cats = [];
            $seen = [];
            foreach ((array) ($b['cats'] ?? []) as $c) {
                $n = mb_substr(trim((string) ($c['n'] ?? '')), 0, 60);
                $k = strtolower((string) preg_replace('/[^a-z0-9]/i', '', (string) ($c['k'] ?? ''))) ?: strtolower((string) preg_replace('/[^a-z0-9]/i', '', $n));
                if ($n === '' || $k === '' || isset($seen[$k])) {
                    continue;
                }
                $seen[$k] = true;
                $cats[] = ['k' => mb_substr($k, 0, 20), 'n' => $n, 'limit' => max(0, round((float) ($c['limit'] ?? 0), 2)), 'acct' => mb_substr(trim((string) ($c['acct'] ?? '')), 0, 60) ?: 'Other expenses'];
            }
            if (!isset($seen['mileage'])) {
                $cats[] = ['k' => 'mileage', 'n' => 'Mileage (own car)', 'limit' => 0, 'acct' => 'Travel'];
            }
            $new = ['rates' => $rates ?: $S['rates'], 'receipt' => max(0, round((float) ($b['receipt'] ?? $S['receipt']), 2)), 'days' => max(1, min(365, (int) ($b['days'] ?? $S['days']))), 'cats' => $cats ?: $S['cats']];
            docSet('org/acct/x/claims', json_decode((string) json_encode($new)));
            audit('settings', 'Expense claim policy changed', '', [], $u);
            ok(['settings' => xcSettings()]);

        case 'xc_mine':
            $rows = [];
            foreach (colAll('xc') as [$id, $c]) {
                if ((string) ($c->uid ?? '') === $u['id']) {
                    $c->id = $id;
                    $rows[] = xcView($c, $u);
                }
            }
            usort($rows, fn($a, $b2) => $b2['u'] <=> $a['u']);
            ok(['claims' => $rows, 'settings' => xcSettings(), 'st' => XC_ST]);

        case 'xc_queue':
            // to approve (my reports', or everyone's for HR and administrators), to pay (accounting), and the rest
            $mayAll = hasRole($u, 'admin') || hasRole($u, 'hr') || xcIsPayer($u);
            $rows = [];
            foreach (colAll('xc') as [$id, $c]) {
                $c->id = $id;
                if ((string) $c->st === 'draft') {
                    continue;
                }
                if ($mayAll || xcIsApprover($u, $c)) {
                    $rows[] = xcView($c, $u);
                }
            }
            usort($rows, fn($a, $b2) => $b2['u'] <=> $a['u']);
            if (!$rows && !$mayAll && !hasRole($u, 'manager')) {
                fail(403, 'forbidden', 'Expense claims are approved by managers, HR and administrators.');
            }
            ok(['claims' => $rows, 'payer' => xcIsPayer($u), 'st' => XC_ST, 'pay' => XC_PAY]);

        case 'xc_get':
            $c = xcGet($str('id', 30), $u);
            ok(['claim' => xcView($c, $u, true), 'settings' => xcSettings(), 'st' => XC_ST, 'pay' => XC_PAY]);

        case 'xc_save':
            // a new claim, or a draft (or a returned claim) changed by its owner: title and lines
            $S = xcSettings();
            $id = $str('id', 30);
            if ($id !== '') {
                $c = xcGet($id, $u);
                if ((string) $c->uid !== $u['id'] || !in_array((string) $c->st, ['draft', 'returned'], true)) {
                    fail(409, 'conflict', 'Only a draft or a returned claim can be changed, by whoever made it.');
                }
            } else {
                $id = rid(10);
                $c = (object) ['uid' => $u['id'], 'n' => (string) $u['name'], 'st' => 'draft', 'at' => now(), 'tok' => rid(16), 'lines' => [], 'log' => []];
                $c->id = $id;
                xcLog($c, $u, 'Claim started');
            }
            $cats = array_column($S['cats'], null, 'k');
            $lines = [];
            foreach (array_slice((array) ($b['lines'] ?? []), 0, 60) as $l) {
                $lid = preg_replace('/[^a-z0-9]/', '', (string) ($l['id'] ?? '')) ?: rid(4);
                $d = (string) ($l['d'] ?? '');
                if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) || !strtotime($d)) {
                    fail(400, 'invalid_argument', 'Every line needs its date.');
                }
                if ($d > date('Y-m-d')) {
                    fail(400, 'invalid_argument', 'A line is dated in the future (' . $d . ').');
                }
                $cat = (string) ($l['cat'] ?? '');
                if (!isset($cats[$cat])) {
                    fail(400, 'invalid_argument', 'Pick a category for every line.');
                }
                $line = (object) ['id' => $lid, 'd' => $d, 'cat' => $cat, 'm' => mb_substr(trim((string) ($l['m'] ?? '')), 0, 120), 'note' => mb_substr(trim((string) ($l['note'] ?? '')), 0, 500)];
                if ($cat === 'mileage') {
                    $mi = round((float) ($l['mi'] ?? 0), 1);
                    if ($mi <= 0 || $mi > 5000) {
                        fail(400, 'invalid_argument', 'Enter the miles driven (a mileage line).');
                    }
                    $rate = xcRate($S, $d);
                    $line->mi = $mi;
                    $line->rate = $rate;
                    $line->a = round($mi * $rate, 2);
                    $line->from = mb_substr(trim((string) ($l['from'] ?? '')), 0, 120);
                    $line->to = mb_substr(trim((string) ($l['to'] ?? '')), 0, 120);
                } else {
                    $a = round((float) ($l['a'] ?? 0), 2);
                    if ($a <= 0 || $a > 100000) {
                        fail(400, 'invalid_argument', 'Enter the amount of every line.');
                    }
                    $line->a = $a;
                }
                $lines[] = $line;
            }
            $c->title = $str('title', 160) ?: ((string) ($c->title ?? '') ?: 'Expenses ' . date('M j, Y'));
            $c->lines = $lines;
            $c->u = now();
            $cid = $c->id;
            unset($c->id);
            docSet('xc/' . $cid, $c);
            $c->id = $cid;
            ok(['claim' => xcView($c, $u, true)]);

        case 'xc_upload':
            // a receipt for one line (multipart: id, line, file)
            $c = xcGet((string) ($_POST['id'] ?? ''), $u);
            if ((string) $c->uid !== $u['id'] || !in_array((string) $c->st, ['draft', 'returned'], true)) {
                fail(409, 'conflict', 'Receipts are added while the claim is a draft (or returned).');
            }
            $line = preg_replace('/[^a-z0-9]/', '', (string) ($_POST['line'] ?? ''));
            if (!in_array($line, array_map(fn($l) => (string) $l->id, (array) ($c->lines ?? [])), true)) {
                fail(400, 'invalid_argument', 'Save the line first, then add its receipt.');
            }
            if (throttleHit('xcup:' . $u['id'], 120, 3600)) {
                fail(429, 'rate_limited', 'That is a lot of uploads in an hour. Try again a little later.');
            }
            if (count(colAll('xc/' . $c->id . '/f')) >= 80) {
                fail(400, 'invalid_argument', 'A claim holds up to 80 receipts.');
            }
            if (!isset($_FILES['file'])) {
                fail(400, 'invalid_argument', 'No file received.');
            }
            $doc = storeUpload($_FILES['file'], 'xc/' . $c->id, ['c' => $line]);
            ok(['file' => ['id' => $doc['id'], 'n' => $doc['n'], 'ty' => $doc['ty'], 'sz' => $doc['sz'], 'c' => $line]]);

        case 'xc_unfile':
            $c = xcGet($str('id', 30), $u);
            if ((string) $c->uid !== $u['id'] || !in_array((string) $c->st, ['draft', 'returned'], true)) {
                fail(409, 'conflict', 'Receipts are removed while the claim is a draft (or returned).');
            }
            $fid = preg_replace('/[^a-f0-9]/', '', $str('fid', 40));
            if ($fid !== '' && docGet('xc/' . $c->id . '/f/' . $fid)) {
                docDelete('xc/' . $c->id . '/f/' . $fid);
                $f = cfg('files_dir') . '/' . $fid;
                if (is_file($f)) {
                    @unlink($f);
                }
            }
            ok(['ok' => true]);

        case 'xc_submit':
            $c = xcGet($str('id', 30), $u);
            if ((string) $c->uid !== $u['id'] || !in_array((string) $c->st, ['draft', 'returned'], true)) {
                fail(409, 'conflict', 'This claim was already sent.');
            }
            if (!(array) ($c->lines ?? [])) {
                fail(400, 'invalid_argument', 'Add at least one line.');
            }
            $S = xcSettings();
            $checks = xcChecks($c, $S, xcFiles((string) $c->id));
            $noReceipt = array_keys(array_filter($checks, fn($w) => in_array('receipt', $w, true)));
            if ($noReceipt) {
                fail(400, 'invalid_argument', 'Add the receipt for every line of $' . number_format((float) $S['receipt'], 0) . ' or more (' . count($noReceipt) . ' missing).');
            }
            // the manager on the person's Team card approves; without one, HR and administrators do
            $r0 = myR((string) $c->uid);
            $mgr = (string) ($r0->mgrId ?? '');
            $mrow = $mgr !== '' ? userRow($mgr) : null;
            $c->appr = $mrow && $mgr !== $u['id'] ? $mgr : '';
            $c->apprN = $mrow && $mgr !== $u['id'] ? (string) $mrow['name'] : 'HR';
            $c->st = 'submitted';
            $c->sub = now();
            $c->u = now();
            if (empty($c->num)) {
                $c->num = xcNext();
            }
            xcLog($c, $u, 'Submitted for approval (' . money(xcTotal($c), 'USD') . ') to ' . $c->apprN . ($checks ? '; notes: ' . implode(', ', array_unique(array_merge(...array_values($checks)))) : ''));
            $cid = $c->id;
            unset($c->id);
            docSet('xc/' . $cid, $c);
            $c->id = $cid;
            $link = siteUrl() . '#/portal/' . ($c->appr !== '' ? 'mgr' : 'hr') . '/claims?c=' . $cid;
            $text = $u['name'] . ' sent an expense claim for approval: ' . $c->num . ', ' . (string) $c->title . ', ' . money(xcTotal($c), 'USD') . ".\n\nOpen it to approve, return or reject: " . $link;
            if ($c->appr !== '') {
                xcMail($c->appr, 'Expense claim to approve: ' . $c->num, $text);
            } else {
                foreach (db()->query("SELECT id FROM users WHERE role = 'hr' AND status = 'active' LIMIT 5")->fetchAll(PDO::FETCH_COLUMN) as $hr) {
                    xcMail((string) $hr, 'Expense claim to approve: ' . $c->num, $text);
                }
            }
            audit('data', 'Expense claim submitted', $cid, ['total' => xcTotal($c)], $u);
            ok(['claim' => xcView($c, $u, true)]);

        case 'xc_decide':
            $c = xcGet($str('id', 30), $u);
            if ((string) $c->st !== 'submitted' || !xcIsApprover($u, $c)) {
                fail(403, 'forbidden', (string) $c->uid === $u['id'] ? 'Nobody approves their own claim.' : 'This claim is not waiting for you.');
            }
            $act = $str('act', 10);
            $why = $str('why', 500);
            if (!in_array($act, ['approve', 'return', 'reject'], true)) {
                fail(400, 'invalid_argument', 'Approve, return or reject.');
            }
            if ($act !== 'approve' && $why === '') {
                fail(400, 'invalid_argument', 'Say why, so ' . explode(' ', (string) $c->n)[0] . ' knows what to do.');
            }
            $c->st = ['approve' => 'approved', 'return' => 'returned', 'reject' => 'rejected'][$act];
            $c->dec = (object) ['by' => $u['id'], 'byn' => (string) $u['name'], 'at' => now(), 'act' => $act, 'why' => $why];
            $c->u = now();
            xcLog($c, $u, ['approve' => 'Approved', 'return' => 'Returned for changes', 'reject' => 'Rejected'][$act] . ($why !== '' ? ': ' . $why : ''));
            $cid = $c->id;
            unset($c->id);
            docSet('xc/' . $cid, $c);
            $c->id = $cid;
            xcMail((string) $c->uid, 'Your expense claim ' . (string) $c->num . ': ' . strtolower(XC_ST[$c->st]), 'Your expense claim ' . (string) $c->num . ' (' . money(xcTotal($c), 'USD') . ') was ' . ['approve' => 'approved by ' . $u['name'] . '; accounting pays it next.', 'return' => 'returned by ' . $u['name'] . ' for changes: ' . $why, 'reject' => 'rejected by ' . $u['name'] . ': ' . $why][$act]);
            audit('data', 'Expense claim ' . $c->st, $cid, ['total' => xcTotal($c)], $u);
            ok(['claim' => xcView($c, $u, true)]);

        case 'xc_pay':
            // paid: recorded on the claim and in Bills & expenses (one entry per expense account of its lines)
            $c = xcGet($str('id', 30), $u);
            if ((string) $c->st !== 'approved' || !xcIsPayer($u)) {
                fail(403, 'forbidden', 'Accounting pays approved claims.');
            }
            $m = $str('m', 10);
            if (!isset(XC_PAY[$m])) {
                fail(400, 'invalid_argument', 'How was it paid?');
            }
            $d = $str('d', 10) ?: date('Y-m-d');
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) {
                fail(400, 'invalid_argument', 'The payment date is year-month-day.');
            }
            $S = xcSettings();
            $acct = [];
            foreach ($S['cats'] as $k) {
                $acct[$k['k']] = $k['acct'];
            }
            $by = [];
            foreach ((array) ($c->lines ?? []) as $l) {
                $an = $acct[(string) $l->cat] ?? 'Other expenses';
                $by[$an] = round(($by[$an] ?? 0) + (float) $l->a, 2);
            }
            $now = now();
            $exp = [];
            foreach ($by as $an => $amt) {
                $eid = 'xc' . $c->id . substr(md5($an), 0, 6);
                docSet('exp/' . $eid, (object) ['v' => (string) $c->n, 'cat' => $an, 'd' => $d, 'due' => '', 'a' => $amt, 'cur' => 'USD', 'ref' => (string) $c->num, 'notes' => 'Expense claim ' . (string) $c->num . ': ' . (string) $c->title, 'st' => 'paid', 'od' => 0, 'm' => XC_PAY[$m], 'paidAt' => $now, 'paidOn' => $d, 'at' => $now, 'by' => $u['id'], 'byn' => (string) $u['name'], 'u' => $now, 'xc' => $c->id]);
                $exp[] = $eid;
            }
            $c->st = 'paid';
            $c->paid = (object) ['by' => $u['id'], 'byn' => (string) $u['name'], 'at' => $now, 'd' => $d, 'm' => $m, 'ref' => $str('ref', 80), 'exp' => $exp];
            $c->u = $now;
            xcLog($c, $u, 'Paid ' . money(xcTotal($c), 'USD') . ' (' . XC_PAY[$m] . ', ' . $d . ')');
            $cid = $c->id;
            unset($c->id);
            docSet('xc/' . $cid, $c);
            $c->id = $cid;
            xcMail((string) $c->uid, 'Your expense claim ' . (string) $c->num . ' is paid', 'Your expense claim ' . (string) $c->num . ' (' . money(xcTotal($c), 'USD') . ') was paid: ' . strtolower(XC_PAY[$m]) . ', ' . $d . '.');
            audit('data', 'Expense claim paid', $cid, ['total' => xcTotal($c)], $u);
            ok(['claim' => xcView($c, $u, true)]);

        case 'xc_delete':
            $c = xcGet($str('id', 30), $u);
            if ((string) $c->uid !== $u['id'] || (string) $c->st !== 'draft') {
                fail(409, 'conflict', 'Only a draft is deleted, by whoever made it.');
            }
            foreach (xcFiles((string) $c->id) as $f) {
                docDelete('xc/' . $c->id . '/f/' . $f['id']);
                $p = cfg('files_dir') . '/' . $f['id'];
                if (is_file($p)) {
                    @unlink($p);
                }
            }
            docDelete('xc/' . $c->id);
            ok(['ok' => true]);

        case 'xc_report':
            // paid and approved claims by month, category and person (for accounting, HR and administrators)
            if (!xcIsPayer($u) && !hasRole($u, 'hr')) {
                fail(403, 'forbidden', 'The claims report is for accounting, HR and administrators.');
            }
            $year = (int) ($b['year'] ?? date('Y'));
            $byMonth = [];
            $byCat = [];
            $byPerson = [];
            foreach (colAll('xc') as [$id, $c]) {
                if (!in_array((string) $c->st, ['approved', 'paid'], true)) {
                    continue;
                }
                foreach ((array) ($c->lines ?? []) as $l) {
                    if ((int) substr((string) $l->d, 0, 4) !== $year) {
                        continue;
                    }
                    $mo = substr((string) $l->d, 0, 7);
                    $byMonth[$mo] = round(($byMonth[$mo] ?? 0) + (float) $l->a, 2);
                    $byCat[(string) $l->cat] = round(($byCat[(string) $l->cat] ?? 0) + (float) $l->a, 2);
                    $byPerson[(string) $c->n] = round(($byPerson[(string) $c->n] ?? 0) + (float) $l->a, 2);
                }
            }
            ksort($byMonth);
            arsort($byCat);
            arsort($byPerson);
            ok(['year' => $year, 'month' => $byMonth, 'cat' => $byCat, 'person' => $byPerson, 'settings' => xcSettings()]);
    }
    fail(404, 'not_found', 'Unknown action.');
}
