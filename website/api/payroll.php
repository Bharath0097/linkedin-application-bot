<?php
declare(strict_types=1);
require_once __DIR__ . '/mail.php';

/*
 * Payroll (v28): direct deposit accounts, NACHA ACH files for a pay run, company ACH settings, the year's tax
 * liabilities and year-end form data (941/940/W-2/W-3/1099-NEC), employee self-service for W-4 details, and the
 * audit log every financial change is written to. Pay itself is computed in the browser (core.js computePay,
 * usTaxes, buildStub) and stored as paystubs under pays/{uid}/items/{period}.
 */

/** Payroll staff: administrators, and accounting staff who were not limited to the books (r.nopay). */
function payrollStaff(): array
{
    $u = requireAdmin();
    if (hasRole($u, 'admin')) {
        return $u;
    }
    $r = myR($u['id']);
    if (!hasRole($u, 'acct') || ($r && !empty($r->nopay))) {
        fail(403, 'forbidden', 'Payroll is for administrators and accounting staff.');
    }
    if ($r && in_array((string) ($r->books ?? ''), ['view', 'reports'], true)) {
        // view-only bookkeepers read payroll pages but change nothing (v83: whatever the method; a GET was let through)
        $route = (string) ($_GET['r'] ?? '');
        if (!in_array($route, ['pay_tax_summary', 'dd_get', 'ach_settings'], true)) {
            fail(403, 'forbidden', 'Your books access is view-only.');
        }
    }
    return $u;
}
/** One line in the audit trail (Admin > Books > Audit log). */
function auditLog(string $kind, string $ref, string $what, array $data = [], ?array $u = null): void
{
    try {
        $u = $u ?? currentUser();
        docSet('org/acct/audit/' . rid(10), (object) [
            't' => now(),
            'by' => $u['id'] ?? '',
            'byn' => (string) ($u['name'] ?? ''),
            'ip' => clientIp(),
            'kind' => mb_substr($kind, 0, 40),
            'ref' => mb_substr($ref, 0, 160),
            'what' => mb_substr($what, 0, 300),
            'data' => (object) $data,
        ]);
    } catch (Throwable $e) {
        // the audit trail never blocks the change itself
    }
}
/** ABA routing numbers carry a check digit: 3,7,1 weights, sum divisible by 10. */
function abaValid(string $r): bool
{
    if (!preg_match('/^\d{9}$/', $r)) {
        return false;
    }
    $w = [3, 7, 1, 3, 7, 1, 3, 7, 1];
    $s = 0;
    for ($i = 0; $i < 9; $i++) {
        $s += (int) $r[$i] * $w[$i];
    }
    return $s % 10 === 0;
}
function ddDoc(string $uid): ?stdClass
{
    return docGet('sec/dd/items/' . $uid);
}
/** The person's accounts without the numbers: last four digits only. */
function ddPublic(?stdClass $d): array
{
    $out = [];
    foreach ((array) ($d->accts ?? []) as $a) {
        if (!($a instanceof stdClass)) {
            continue;
        }
        $out[] = [
            'id' => (string) ($a->id ?? ''),
            'n' => (string) ($a->n ?? ''),
            'type' => (string) ($a->type ?? 'checking') === 'savings' ? 'savings' : 'checking',
            'routing' => (string) ($a->routing ?? ''),
            'last4' => (string) ($a->last4 ?? ''),
            'kind' => in_array((string) ($a->kind ?? ''), ['amount', 'percent', 'remainder'], true) ? (string) $a->kind : 'remainder',
            'val' => (float) ($a->val ?? 0),
            'prenote' => !empty($a->prenote),
            'prenotedAt' => (int) ($a->prenotedAt ?? 0),
            // v35: a new or changed account payroll does not use yet
            'holdUntil' => (int) ($a->holdUntil ?? 0) > now() ? (int) $a->holdUntil : 0,
        ];
    }
    $held = (int) ($d->prevUntil ?? 0) > now();
    return [
        'accts' => $out,
        'u' => (int) ($d->u ?? 0),
        'byn' => (string) ($d->byn ?? ''),
        'holdUntil' => $held ? (int) $d->prevUntil : 0,
        // where pay goes meanwhile (last four digits only)
        'paidTo' => $held ? array_values(array_map(fn($a) => (string) ($a->last4 ?? ''), array_filter((array) ($d->prev ?? []), fn($a) => is_object($a)))) : [],
        'frozen' => !empty($d->frozen),
    ];
}
/** The accounts a pay run uses now: during a hold the ones that worked before the change (v35). Returns [accounts, held]. */
function ddEffective(?stdClass $d): array
{
    $now = now();
    $all = array_values(array_filter((array) ($d->accts ?? []), fn($a) => $a instanceof stdClass && !empty($a->acct)));
    $ready = array_values(array_filter($all, fn($a) => (int) ($a->holdUntil ?? 0) <= $now));
    if (count($ready) === count($all)) {
        return [$all, false];
    }
    $prev = array_values(array_filter((array) ($d->prev ?? []), fn($a) => $a instanceof stdClass && !empty($a->acct)));
    if ($prev && (int) ($d->prevUntil ?? 0) > $now) {
        return [$prev, true];
    }
    return [$ready, true];
}
/** People who can run payroll (administrators and accounting staff with payroll), for direct deposit notices. */
function ddPayrollPeople(): array
{
    $out = [];
    foreach (db()->query("SELECT id, email, name, role, status, access FROM users WHERE status = 'active'")->fetchAll() as $r) {
        if (hasRole($r, 'admin') || (hasRole($r, 'acct') && !((myR((string) $r['id'])->nopay ?? false)))) {
            $out[] = $r;
        }
    }
    return $out;
}
/** v35: tells the person (with a "this wasn't me" link) and payroll about a new or changed bank account. */
function ddChangeNotice(string $uid, array $by, bool $staff, array $last4s, int $holdUntil, array $prev, array $before = [], bool $removed = false): void
{
    try {
        require_once __DIR__ . '/auth.php';
        $p = userRow($uid);
        if (!$p) {
            return;
        }
        $tok = rid(16);
        secdb()->prepare('INSERT INTO auth_tokens (h, kind, uid, exp, used, at, data) VALUES (?,?,?,?,?,?,?)')
            ->execute([secMac('tok', $tok), 'dd_stop', $uid, now() + 14 * 86400000, 0, now(), json_encode(['by' => (string) $by['id'], 'byn' => (string) $by['name'], 'last4' => array_values($last4s), 'at' => now(), 'before' => array_values($before)])]);
        $link = siteUrl() . '#/stop-change?k=' . $tok;
        $accts = implode(', ', array_map(fn($x) => 'the account ending ' . $x, $last4s));
        $when = gmdate('j M Y', (int) ($holdUntil / 1000));
        $prev4 = array_values(array_filter(array_map(fn($a) => is_object($a) ? (string) ($a->last4 ?? '') : '', $prev)));
        $meanwhile = $holdUntil > 0 ? 'For your protection, payroll starts paying into it on ' . $when . '. Until then your pay goes ' . ($prev4 ? 'to the account ending ' . implode(' and ', $prev4) : 'out another way (payroll will contact you)') . '.' : '';
        authMail(
            $p + ['status' => 'active'],
            'Your direct deposit account was changed',
            array_values(array_filter(['Hi ' . authFirst($p) . ',', ($staff ? $by['name'] . ' (StratEdge payroll)' : 'You') . ($removed ? ' removed ' . $accts . ' from your direct deposit' : ' changed where your pay goes: ' . $accts) . ', on ' . gmdate('j M Y H:i') . ' UTC from ' . clientIp() . '.', $meanwhile, 'If you did not make or ask for this change, open the link below right away: it stops the change, signs everyone out of your account and alerts payroll.'])),
            ['This was not me: stop the change', $link]
        );
        $GLOBALS['mailKind'] = 'security';
        $what = $p['name'] . ($removed ? ' no longer has ' . $accts . ' for pay (removed by ' : ' now has ' . $accts . ' for pay (changed by ') . $by['name'] . ').';
        foreach (ddPayrollPeople() as $r) {
            if ((string) $r['id'] === (string) $by['id']) {
                continue;
            }
            sendMail((string) $r['email'], (string) $r['name'], 'Direct deposit changed: ' . $p['name'], $what . ($holdUntil > 0 ? ' It is on hold until ' . $when . '; until then pay goes to the previous account. Release the hold early only after you confirm the change with them by phone at a number already on file (not one given in an email).' : ''), emailHtml('Direct deposit changed', [$what, $holdUntil > 0 ? 'It is on hold until ' . $when . '; until then pay goes to the previous account. Release the hold early only after confirming the change with them by phone, at a number already on file - never one given in an email or chat.' : 'Check with them if this was unexpected.'], ['Open payroll setup', siteUrl() . '#/portal/admin/paysetup']));
        }
    } catch (Throwable $e) {
        // a notice never blocks the save
    }
}
function achCfg(): array
{
    $d = docGet('sec/x/ach/cfg');
    $g = fn(string $k, string $def = '') => (string) ($d->$k ?? $def);
    return [
        'immDest' => $g('immDest'),
        'destName' => $g('destName'),
        'immOrigin' => $g('immOrigin'),
        'originName' => $g('originName'),
        'companyName' => $g('companyName'),
        'companyId' => $g('companyId'),
        'odfi' => $g('odfi'),
        'entryDesc' => $g('entryDesc', 'PAYROLL'),
        'balanced' => !empty($d->balanced),
        'offsetRouting' => $g('offsetRouting'),
        'offsetLast4' => $g('offsetLast4'),
        'offsetType' => $g('offsetType', 'checking'),
        'hasOffset' => $g('offsetAcct') !== '',
        'u' => (int) ($d->u ?? 0),
    ];
}
/** Fixed-width helpers for NACHA records. */
function nachaAlpha(string $s, int $n): string
{
    $s = strtoupper(preg_replace('/[^A-Za-z0-9 .\-&\/,]/', '', $s) ?? '');
    return str_pad(substr($s, 0, $n), $n, ' ');
}
function nachaNum(int|string $v, int $n): string
{
    $v = preg_replace('/\D/', '', (string) $v) ?? '';
    return str_pad(substr($v, -$n), $n, '0', STR_PAD_LEFT);
}
/**
 * Builds a NACHA (ACH) file for the net pay of a finalized run: one PPD credit per bank account, an optional
 * balancing debit to the company account, trace numbers, hashes and 10-line blocks. $prenote makes a $0 test file
 * for accounts not yet verified. Returns [text, summary].
 */
function nachaBuild(string $mk, bool $prenote, array $u): array
{
    $cfg = achCfg();
    foreach (['immDest' => 'bank routing (immediate destination)', 'immOrigin' => 'company identifier (immediate origin)', 'companyName' => 'company name', 'companyId' => 'company ID', 'odfi' => 'originating bank ID (ODFI)'] as $k => $n) {
        if ($cfg[$k] === '') {
            fail(400, 'invalid_argument', 'ACH settings are incomplete: add the ' . $n . ' under Payroll setup › Direct deposit.');
        }
    }
    $stubs = [];
    if ($prenote && $mk === 'prenote') {
        // v83: the standalone prenote (Payroll setup › Direct deposit): every person with a direct deposit account
        // on file, no run needed; the loop below keeps only the accounts still waiting for their $0 test entry
        $payDate = date('Y-m-d');
        $s = db()->prepare("SELECT path FROM docs WHERE col = 'sec/dd/items'");
        $s->execute();
        while ($row = $s->fetch()) {
            if (!preg_match('#^sec/dd/items/(u_[a-f0-9]+)$#', $row['path'], $mm)) {
                continue;
            }
            $p = userRow($mm[1]);
            $stubs[$mm[1]] = (object) ['n' => (string) ($p['name'] ?? $mm[1]), 'method' => 'Direct deposit', 'net' => 0];
        }
        if (!$stubs) {
            fail(400, 'invalid_argument', 'Nobody has a direct deposit account on file yet.');
        }
    } else {
        $run = docGet('org/acct/runs/' . $mk);
        if (!$run || !in_array((string) ($run->st ?? ''), ['final', 'paid'], true)) {
            fail(400, 'invalid_argument', 'Finalize the payroll run first.');
        }
        $payDate = (string) ($run->payDate ?? '');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $payDate)) {
            $payDate = (string) ($run->paidOn ?? date('Y-m-d'));
        }
        // every paystub of this run
        $s = db()->prepare("SELECT path, data FROM docs WHERE col LIKE 'pays/%/items' AND path LIKE ?");
        $s->execute(['pays/%/items/' . $mk]);
        while ($row = $s->fetch()) {
            if (!preg_match('#^pays/(u_[a-f0-9]+)/items/#', $row['path'], $mm)) {
                continue;
            }
            $d = json_decode($row['data']);
            if ($d instanceof stdClass) {
                $stubs[$mm[1]] = $d;
            }
        }
    }
    if (!$stubs) {
        fail(404, 'not_found', 'No paystubs found for this run.');
    }
    $entries = [];
    $missing = [];
    $checks = [];
    $holds = [];
    $seq = 0;
    $odfi8 = nachaNum($cfg['odfi'], 8);
    foreach ($stubs as $uid => $st) {
        $isHeld = false;
        $net = round((float) ($st->net ?? 0), 2);
        $name = (string) ($st->n ?? $uid);
        $method = (string) ($st->method ?? 'Direct deposit');
        if ($method !== 'Direct deposit' && !$prenote) {
            $checks[] = ['uid' => $uid, 'n' => $name, 'net' => $net, 'method' => $method];
            continue;
        }
        $dd = ddDoc($uid);
        $accts = array_values(array_filter((array) ($dd->accts ?? []), fn($a) => $a instanceof stdClass && !empty($a->acct)));
        if (!$prenote && $accts) {
            // v35: an account changed in the last few days is on hold: pay goes to the accounts that worked before
            [$accts, $isHeld] = ddEffective($dd);
            if ($isHeld) {
                $holds[] = ['uid' => $uid, 'n' => $name, 'net' => $net, 'until' => (int) ($dd->prevUntil ?? 0), 'prev' => (bool) $accts];
            }
        }
        if (!$accts) {
            $missing[] = ['uid' => $uid, 'n' => $name, 'net' => $net] + (!empty($isHeld) ? ['held' => true] : []);
            continue;
        }
        if ($prenote) {
            foreach ($accts as $a) {
                if (empty($a->prenote)) {
                    continue; // already verified
                }
                $entries[] = ['uid' => $uid, 'n' => $name, 'routing' => (string) $a->routing, 'acct' => mailUnseal((string) $a->acct), 'type' => (string) ($a->type ?? 'checking'), 'amt' => 0, 'last4' => (string) ($a->last4 ?? '')];
            }
            continue;
        }
        if ($net <= 0) {
            continue;
        }
        // split: fixed amounts, then percentages, the remainder account gets what is left (the first account if none is marked)
        $left = $net;
        $split = [];
        $rem = null;
        foreach ($accts as $a) {
            $kind = (string) ($a->kind ?? 'remainder');
            if ($kind === 'amount') {
                $v = min($left, round((float) ($a->val ?? 0), 2));
            } elseif ($kind === 'percent') {
                $v = min($left, round($net * (float) ($a->val ?? 0) / 100, 2));
            } else {
                if ($rem === null) {
                    $rem = $a;
                }
                continue;
            }
            if ($v > 0) {
                $split[] = [$a, $v];
                $left = round($left - $v, 2);
            }
        }
        if ($rem === null) {
            $rem = $accts[0];
        }
        if ($left > 0) {
            $split[] = [$rem, $left];
        }
        foreach ($split as [$a, $v]) {
            $entries[] = ['uid' => $uid, 'n' => $name, 'routing' => (string) $a->routing, 'acct' => mailUnseal((string) $a->acct), 'type' => (string) ($a->type ?? 'checking'), 'amt' => (int) round($v * 100), 'last4' => (string) ($a->last4 ?? '')];
        }
    }
    if (!$entries) {
        fail(400, 'invalid_argument', $prenote ? 'Every account is already verified; nothing to prenote.' : 'Nobody in this run has a direct deposit account on file.');
    }
    $credits = 0;
    $hash = 0;
    $lines = [];
    $yymmdd = date('ymd', strtotime($payDate . ' 12:00:00'));
    $fileId = chr(65 + (int) date('G') % 26); // A..Z by hour, so a second file the same day gets another modifier
    $lines[] = '1' . '01' . str_pad(' ' . nachaNum($cfg['immDest'], 9), 10) . str_pad(' ' . nachaNum($cfg['immOrigin'], 9), 10) . date('ymd') . date('Hi') . $fileId . '094' . '10' . '1' . nachaAlpha($cfg['destName'], 23) . nachaAlpha($cfg['originName'] ?: $cfg['companyName'], 23) . str_repeat(' ', 8);
    $serviceClass = $cfg['balanced'] && $cfg['hasOffset'] && !$prenote ? '200' : '220';
    $batchNo = '0000001';
    $lines[] = '5' . $serviceClass . nachaAlpha($cfg['companyName'], 16) . str_repeat(' ', 20) . nachaAlpha($cfg['companyId'], 10) . 'PPD' . nachaAlpha($prenote ? 'PRENOTE' : $cfg['entryDesc'], 10) . nachaAlpha(date('M d', strtotime($payDate . ' 12:00:00')), 6) . $yymmdd . '   ' . '1' . $odfi8 . $batchNo;
    foreach ($entries as $e) {
        $seq++;
        $r = nachaNum($e['routing'], 9);
        $tx = $e['type'] === 'savings' ? ($prenote ? '33' : '32') : ($prenote ? '23' : '22');
        $hash += (int) substr($r, 0, 8);
        $credits += $e['amt'];
        $lines[] = '6' . $tx . substr($r, 0, 8) . substr($r, 8, 1) . str_pad(substr(preg_replace('/\D/', '', $e['acct']) ?? '', 0, 17), 17) . nachaNum($e['amt'], 10) . nachaAlpha(substr($e['uid'], -15), 15) . nachaAlpha($e['n'], 22) . '  ' . '0' . $odfi8 . nachaNum($seq, 7);
    }
    $debits = 0;
    if ($serviceClass === '200') {
        // the balancing debit to the company account
        $seq++;
        $d = docGet('sec/x/ach/cfg');
        $r = nachaNum($cfg['offsetRouting'], 9);
        $hash += (int) substr($r, 0, 8);
        $debits = $credits;
        $lines[] = '6' . ($cfg['offsetType'] === 'savings' ? '37' : '27') . substr($r, 0, 8) . substr($r, 8, 1) . str_pad(substr(preg_replace('/\D/', '', mailUnseal((string) ($d->offsetAcct ?? ''))) ?? '', 0, 17), 17) . nachaNum($debits, 10) . nachaAlpha('OFFSET', 15) . nachaAlpha($cfg['companyName'], 22) . '  ' . '0' . $odfi8 . nachaNum($seq, 7);
    }
    $hash10 = nachaNum($hash, 10);
    $lines[] = '8' . $serviceClass . nachaNum($seq, 6) . $hash10 . nachaNum($debits, 12) . nachaNum($credits, 12) . nachaAlpha($cfg['companyId'], 10) . str_repeat(' ', 19) . str_repeat(' ', 6) . $odfi8 . $batchNo;
    $blockCount = (int) ceil((count($lines) + 1) / 10);
    $lines[] = '9' . '000001' . nachaNum($blockCount, 6) . nachaNum($seq, 8) . $hash10 . nachaNum($debits, 12) . nachaNum($credits, 12) . str_repeat(' ', 39);
    while (count($lines) % 10 !== 0) {
        $lines[] = str_repeat('9', 94);
    }
    foreach ($lines as $i => $l) {
        if (strlen($l) !== 94) {
            fail(500, 'internal', 'ACH line ' . ($i + 1) . ' is ' . strlen($l) . ' characters; check the ACH settings for stray characters.');
        }
    }
    $summary = ['entries' => count($entries), 'people' => count(array_unique(array_column($entries, 'uid'))), 'total' => round($credits / 100, 2), 'payDate' => $payDate, 'missing' => $missing, 'checks' => $checks, 'holds' => $holds, 'prenote' => $prenote, 'balanced' => $serviceClass === '200', 'fileId' => $fileId];
    return [implode("\r\n", $lines) . "\r\n", $summary];
}
/** W-2 / 941 / 940 / 1099 figures for a year from the saved paystubs (US only). */
function payTaxSummary(int $year, ?string $onlyUid = null): array
{
    $s = db()->prepare("SELECT path, data FROM docs WHERE col LIKE 'pays/%/items'");
    $s->execute();
    $q = [];
    for ($i = 1; $i <= 4; $i++) {
        $q[$i] = ['wages' => 0, 'fitW' => 0, 'fit' => 0, 'ssW' => 0, 'ssEE' => 0, 'ssER' => 0, 'medW' => 0, 'medEE' => 0, 'medAdd' => 0, 'medER' => 0, 'futaW' => 0, 'futa' => 0, 'liability' => 0, 'byMonth' => [], 'people' => 0, 'uids' => []];
    }
    $states = [];
    $emps = [];
    $contractors = [];
    $people = [];
    $sum = fn(array $list, callable $f) => array_reduce($list, fn($a, $x) => $a + (float) $f($x), 0.0);
    while ($row = $s->fetch()) {
        if (!preg_match('#^pays/(u_[a-f0-9]+)/items/([^/]+)$#', $row['path'], $mm)) {
            continue;
        }
        $uid = $mm[1];
        if ($onlyUid !== null && $uid !== $onlyUid) {
            continue;
        }
        $st = json_decode($row['data']);
        if (!($st instanceof stdClass) || !in_array((string) ($st->st ?? ''), ['final', 'paid'], true)) {
            continue;
        }
        $country = isset($st->country) ? (string) $st->country : (((string) ($st->cur ?? '')) === 'USD' ? 'US' : 'IN');
        if ($country !== 'US') {
            continue;
        }
        $payDate = (string) ($st->paidOn ?? ($st->payDate ?? ''));
        $yk = (string) ($st->yk ?? '');
        $yr = preg_match('/^\d{4}-\d{2}-\d{2}$/', $payDate) ? (int) substr($payDate, 0, 4) : ($yk !== '' ? (int) $yk : (int) substr($mm[2], 0, 4));
        if ($yr !== $year) {
            continue;
        }
        $month = preg_match('/^\d{4}-\d{2}-\d{2}$/', $payDate) ? (int) substr($payDate, 5, 2) : (int) substr($mm[2], 5, 2);
        $quarter = (int) ceil($month / 3);
        $gross = round((float) ($st->gross ?? 0), 2);
        $wtype = (string) ($st->wtype ?? 'w2');
        $name = (string) ($st->n ?? $uid);
        $people[$uid] = $name;
        if ($wtype !== 'w2') {
            $c = $contractors[$uid] ?? ['uid' => $uid, 'n' => $name, 'e' => (string) ($st->e ?? ''), 'kind' => $wtype, 'total' => 0, 'runs' => 0];
            $c['total'] = round($c['total'] + (float) ($st->net ?? $gross), 2);
            $c['runs']++;
            $contractors[$uid] = $c;
            continue;
        }
        $taxes = array_filter((array) ($st->taxes ?? []), fn($t) => $t instanceof stdClass);
        $er = array_filter((array) ($st->employer ?? []), fn($t) => $t instanceof stdClass);
        $w = (array) ($st->wages ?? []);
        $fitW = isset($w['fit']) ? (float) $w['fit'] : $gross;
        $ficaW = isset($w['fica']) ? (float) $w['fica'] : $gross;
        $ssW = isset($w['ss']) ? (float) $w['ss'] : $ficaW;
        $futaW = isset($w['futa']) ? (float) $w['futa'] : 0.0;
        $pick = fn(array $list, string $re) => $sum(array_filter($list, fn($t) => preg_match($re, (string) ($t->n ?? ''))), fn($t) => $t->v ?? 0);
        $fit = $pick($taxes, '/^Federal income tax/');
        $ssEE = $pick($taxes, '/^Social Security \(/');
        $medEE = $pick($taxes, '/^Medicare \(/');
        $medAdd = $pick($taxes, '/^Additional Medicare/');
        $ssER = $pick($er, '/^Social Security \(employer\)/');
        $medER = $pick($er, '/^Medicare \(employer\)/');
        $futa = $pick($er, '/^FUTA/');
        $suta = $pick($er, '/^SUTA/');
        $stateCode = strtoupper((string) ($st->state ?? ''));
        $stateTax = $sum(array_filter($taxes, fn($t) => (string) ($t->g ?? '') === 'state' && preg_match('/income tax$/', (string) ($t->n ?? ''))), fn($t) => $t->v ?? 0);
        $statePrograms = $sum(array_filter($taxes, fn($t) => (string) ($t->g ?? '') === 'state' && !preg_match('/income tax$/', (string) ($t->n ?? ''))), fn($t) => $t->v ?? 0);
        $local = $sum(array_filter($taxes, fn($t) => (string) ($t->g ?? '') === 'local'), fn($t) => $t->v ?? 0);
        $qq = &$q[$quarter];
        $qq['wages'] += $gross;
        $qq['fitW'] += $fitW;
        $qq['fit'] += $fit;
        $qq['ssW'] += $ssW;
        $qq['ssEE'] += $ssEE;
        $qq['ssER'] += $ssER;
        $qq['medW'] += $ficaW;
        $qq['medEE'] += $medEE;
        $qq['medAdd'] += $medAdd;
        $qq['medER'] += $medER;
        $qq['futaW'] += $futaW;
        $qq['futa'] += $futa;
        $liab = $fit + $ssEE + $ssER + $medEE + $medAdd + $medER;
        $qq['liability'] += $liab;
        $qq['byMonth'][$month] = round(($qq['byMonth'][$month] ?? 0) + $liab, 2);
        $qq['uids'][$uid] = true;
        unset($qq);
        if ($stateCode !== '') {
            $sx = $states[$stateCode] ?? ['code' => $stateCode, 'wages' => 0, 'wh' => 0, 'programs' => 0, 'suta' => 0, 'people' => [], 'quarters' => [1 => ['wages' => 0, 'wh' => 0, 'suta' => 0], 2 => ['wages' => 0, 'wh' => 0, 'suta' => 0], 3 => ['wages' => 0, 'wh' => 0, 'suta' => 0], 4 => ['wages' => 0, 'wh' => 0, 'suta' => 0]]];
            $sx['wages'] += $gross;
            $sx['wh'] += $stateTax;
            $sx['programs'] += $statePrograms;
            $sx['suta'] += $suta;
            $sx['people'][$uid] = true;
            $sx['quarters'][$quarter]['wages'] += $gross;
            $sx['quarters'][$quarter]['wh'] += $stateTax;
            $sx['quarters'][$quarter]['suta'] += $suta;
            $states[$stateCode] = $sx;
        }
        // W-2 boxes
        $e = $emps[$uid] ?? ['uid' => $uid, 'n' => $name, 'e' => (string) ($st->e ?? ''), 'box1' => 0, 'box2' => 0, 'box3' => 0, 'box4' => 0, 'box5' => 0, 'box6' => 0, 'box12' => ['D' => 0, 'DD' => 0, 'W' => 0, 'AA' => 0], 'box14' => 0, 'box16' => 0, 'box17' => 0, 'state' => $stateCode, 'local' => 0, 'gross' => 0, 'net' => 0, 'runs' => 0, 'retire' => false];
        $e['box1'] += $fitW;
        $e['box2'] += $fit;
        $e['box3'] += $ssW;
        $e['box4'] += $ssEE;
        $e['box5'] += $ficaW;
        $e['box6'] += $medEE + $medAdd;
        $e['box16'] += isset($w['state']) ? (float) $w['state'] : $gross;
        $e['box17'] += $stateTax;
        $e['box14'] += $statePrograms;
        $e['local'] += $local;
        $e['gross'] += $gross;
        $e['net'] += (float) ($st->net ?? 0);
        $e['runs']++;
        if ($stateCode !== '') {
            $e['state'] = $stateCode;
        }
        foreach (array_merge((array) ($st->pre ?? []), (array) ($st->post ?? [])) as $l) {
            if (!($l instanceof stdClass)) {
                continue;
            }
            $kind = (string) ($l->kind ?? '');
            $v = (float) ($l->v ?? 0);
            if ($kind === 'k401') {
                $e['box12']['D'] += $v;
                $e['retire'] = true;
            } elseif ($kind === 'roth') {
                $e['box12']['AA'] += $v;
                $e['retire'] = true;
            } elseif ($kind === 'hsa') {
                $e['box12']['W'] += $v;
            } elseif ($kind === 'health') {
                $e['box12']['DD'] += $v;
            }
        }
        foreach ($er as $l) {
            $kind = (string) ($l->kind ?? '');
            if ($kind === 'health') {
                $e['box12']['DD'] += (float) ($l->v ?? 0);
            } elseif ($kind === 'hsa') {
                $e['box12']['W'] += (float) ($l->v ?? 0);
            }
        }
        $emps[$uid] = $e;
    }
    $r2 = fn($v) => round((float) $v, 2);
    foreach ($q as $i => $qq) {
        foreach ($qq as $k => $v) {
            if (is_numeric($v)) {
                $q[$i][$k] = $r2($v);
            }
        }
        $q[$i]['people'] = count($qq['uids']);
        unset($q[$i]['uids']);
        ksort($q[$i]['byMonth']);
    }
    foreach ($states as $k => $sx) {
        $states[$k]['people'] = count($sx['people']);
        foreach (['wages', 'wh', 'programs', 'suta'] as $f) {
            $states[$k][$f] = $r2($sx[$f]);
        }
        foreach ($sx['quarters'] as $i => $qq) {
            foreach ($qq as $f => $v) {
                $states[$k]['quarters'][$i][$f] = $r2($v);
            }
        }
    }
    foreach ($emps as $k => $e) {
        foreach (['box1', 'box2', 'box3', 'box4', 'box5', 'box6', 'box14', 'box16', 'box17', 'local', 'gross', 'net'] as $f) {
            $emps[$k][$f] = $r2($e[$f]);
        }
        foreach ($e['box12'] as $code => $v) {
            $emps[$k]['box12'][$code] = $r2($v);
        }
        // the address from HRMS when it is on file (W-2 box e/f)
        $h = docGet('hrms/emp/' . $k);
        $emps[$k]['addr'] = $h ? trim(implode(', ', array_filter([(string) ($h->addr ?? ''), (string) ($h->city ?? ''), trim(((string) ($h->state ?? '')) . ' ' . ((string) ($h->zip ?? '')))]))) : '';
    }
    usort($emps, fn($a, $b) => strcmp($a['n'], $b['n']));
    // 1099-NEC: contractors paid through payroll, plus bills paid to vendors marked for a 1099
    $vend1099 = [];
    foreach (colAll('vms/vendor/items') as [$vid, $v]) {
        if (!empty($v->ten99)) {
            $vend1099[mb_strtolower(trim((string) ($v->n ?? '')))] = ['vid' => (string) $vid, 'n' => (string) ($v->n ?? ''), 'tin' => (string) ($v->tin ?? '')];
        }
    }
    $bills = [];
    foreach (colAll('exp') as [$id, $x]) {
        if ((string) ($x->st ?? '') !== 'paid' || empty($x->ten99) && !isset($vend1099[mb_strtolower(trim((string) ($x->v ?? '')))])) {
            continue;
        }
        $on = (string) ($x->paidOn ?? ($x->d ?? ''));
        if ((int) substr($on, 0, 4) !== $year) {
            continue;
        }
        $key = mb_strtolower(trim((string) ($x->v ?? '')));
        $b = $bills[$key] ?? ['n' => (string) ($x->v ?? ''), 'kind' => 'vendor', 'total' => 0, 'runs' => 0, 'tin' => $vend1099[$key]['tin'] ?? ''];
        $b['total'] = $r2($b['total'] + (float) ($x->a ?? 0));
        $b['runs']++;
        $bills[$key] = $b;
    }
    $nec = array_values(array_merge(array_values($contractors), array_values($bills)));
    usort($nec, fn($a, $b) => $b['total'] <=> $a['total']);
    foreach ($nec as $i => $c) {
        $nec[$i]['total'] = $r2($c['total']);
        $nec[$i]['due'] = $c['total'] >= 600;
    }
    $deposits = [];
    foreach (colAll('org/acct/taxdep', 'd', 'asc') as [$id, $d]) {
        if ((int) substr((string) ($d->d ?? ''), 0, 4) === $year) {
            $deposits[] = ['id' => (string) $id] + (array) $d;
        }
    }
    $org = docGet('org/acct/x/settings');
    $main = docGet('org/main/x/settings');
    $inv = $main && $main->inv instanceof stdClass ? $main->inv : new stdClass();
    $w3 = ['box1' => 0, 'box2' => 0, 'box3' => 0, 'box4' => 0, 'box5' => 0, 'box6' => 0, 'n' => count($emps)];
    foreach ($emps as $e) {
        foreach (['box1', 'box2', 'box3', 'box4', 'box5', 'box6'] as $f) {
            $w3[$f] = $r2($w3[$f] + $e[$f]);
        }
    }
    return ['year' => $year, 'quarters' => $q, 'states' => array_values($states), 'employees' => $emps, 'w3' => $w3, 'nec' => $nec, 'deposits' => $deposits, 'company' => ['n' => (string) ($inv->co ?? 'StratEdge IT Consulting Inc.'), 'ein' => (string) ($org->ein ?? ''), 'addr' => (string) ($inv->addr ?? ''), 'stateIds' => (array) ($org->stateIds ?? [])]];
}

function payrollRoute(string $r, string $method, array $b): never
{
    switch ($r) {
        case 'dd_get':
            $u = requireUser();
            $uid = str($b, 'uid', 40);
            if ($uid !== '' && $uid !== $u['id']) {
                payrollStaff();
            } else {
                $uid = $u['id'];
            }
            ok(ddPublic(ddDoc($uid)));
        case 'dd_save':
            $u = requireUser();
            $uid = str($b, 'uid', 40);
            $staff = false;
            if ($uid !== '' && $uid !== $u['id']) {
                payrollStaff();
                $staff = true;
            } else {
                $uid = $u['id'];
            }
            $cur = ddDoc($uid);
            $old = [];
            foreach ((array) ($cur->accts ?? []) as $a) {
                if ($a instanceof stdClass && !empty($a->id)) {
                    $old[(string) $a->id] = $a;
                }
            }
            if ($cur && !empty($cur->frozen) && !$staff) {
                fail(403, 'forbidden', 'Direct deposit changes are stopped on your account after a change you reported. Payroll will contact you; they can make the change for you.');
            }
            $in = is_array($b['accts'] ?? null) ? array_slice($b['accts'], 0, 4) : [];
            $accts = [];
            $hasRem = false;
            $now = now();
            // v35: a new or changed account waits a few days before payroll pays into it, when the person already had a
            // working account (the classic payroll-diversion fraud swaps it), and the person is told by email
            require_once __DIR__ . '/guard.php';
            $holdDays = (int) guardCfg()['ddHold'];
            // v83: also once the person has ever had a working account (`had`), so emptying the list first no longer skips the hold
            $hadWorking = !empty($cur->had) || (bool) array_filter($old, fn($a) => (int) ($a->holdUntil ?? 0) <= $now) || (!empty($cur->prev) && (int) ($cur->prevUntil ?? 0) > $now);
            $changed = [];
            foreach ($in as $a) {
                if (!is_array($a)) {
                    continue;
                }
                $id = preg_replace('/[^a-z0-9]/', '', (string) ($a['id'] ?? '')) ?: rid(6);
                $routing = preg_replace('/\D/', '', (string) ($a['routing'] ?? '')) ?? '';
                if (!abaValid($routing)) {
                    fail(400, 'invalid_argument', 'That routing number is not valid (9 digits, from the bottom of a check or the bank\'s website).');
                }
                $num = preg_replace('/\D/', '', (string) ($a['acct'] ?? '')) ?? '';
                $prev = $old[$id] ?? null;
                $holdUntil = (int) ($prev->holdUntil ?? 0);
                if ($num === '' && $prev && !empty($prev->acct)) {
                    $sealed = (string) $prev->acct;
                    $last4 = (string) ($prev->last4 ?? '');
                    $prenote = !empty($prev->prenote);
                    $prenotedAt = (int) ($prev->prenotedAt ?? 0);
                    if ((string) ($prev->routing ?? '') !== $routing) {
                        $prenote = true;
                        $prenotedAt = 0;
                        $changed[] = $last4;
                        $holdUntil = $holdDays > 0 && $hadWorking ? $now + $holdDays * 86400000 : 0;
                    }
                } else {
                    if (strlen($num) < 4 || strlen($num) > 17) {
                        fail(400, 'invalid_argument', 'Account numbers are 4 to 17 digits.');
                    }
                    $sealed = mailSeal($num);
                    $last4 = substr($num, -4);
                    $prenote = true; // a new or changed account gets a $0 prenote first
                    $prenotedAt = 0;
                    $changed[] = $last4;
                    $holdUntil = $holdDays > 0 && $hadWorking ? $now + $holdDays * 86400000 : 0;
                }
                $kind = in_array((string) ($a['kind'] ?? ''), ['amount', 'percent', 'remainder'], true) ? (string) $a['kind'] : 'remainder';
                if ($kind === 'remainder') {
                    $hasRem = true;
                }
                $accts[] = (object) [
                    'id' => $id,
                    'n' => mb_substr(trim((string) ($a['n'] ?? '')), 0, 40),
                    'type' => (string) ($a['type'] ?? 'checking') === 'savings' ? 'savings' : 'checking',
                    'routing' => $routing,
                    'acct' => $sealed,
                    'last4' => $last4,
                    'kind' => $kind,
                    'val' => $kind === 'remainder' ? 0 : max(0, round((float) ($a['val'] ?? 0), 2)),
                    'prenote' => $prenote,
                    'prenotedAt' => $prenotedAt,
                    'holdUntil' => $holdUntil > $now ? $holdUntil : 0,
                ];
            }
            if ($accts && !$hasRem) {
                $accts[count($accts) - 1]->kind = 'remainder';
                $accts[count($accts) - 1]->val = 0;
            }
            $doc = (object) ['accts' => $accts, 'u' => $now, 'by' => $u['id'], 'byn' => (string) $u['name']];
            if (!$staff && !empty($cur->frozen)) {
                $doc->frozen = true;
            }
            // v83: once the person has had a working account, every later new or changed one waits (emptying the list first does not reset this)
            if ($hadWorking || $accts) {
                $doc->had = true;
            }
            // the accounts that last worked: on file now, kept from a hold in progress, or kept when the list was emptied
            $working = array_values(array_filter(array_values($old), fn($a) => (int) ($a->holdUntil ?? 0) <= $now))
                ?: (!empty($cur->prev) && (int) ($cur->prevUntil ?? 0) > $now ? array_values((array) $cur->prev) : array_values(array_filter((array) ($cur->gone ?? []), fn($a) => is_object($a))));
            if (!$accts && $working) {
                $doc->gone = $working;
            }
            $until = max(0, ...array_map(fn($a) => (int) $a->holdUntil, $accts ?: [(object) ['holdUntil' => 0]]));
            if ($until > $now) {
                // until the hold ends, pay keeps going to the accounts that worked before the change
                $doc->prev = !empty($cur->prev) && (int) ($cur->prevUntil ?? 0) > $now ? $cur->prev : $working;
                $doc->prevUntil = $until;
            }
            docSet('sec/dd/items/' . $uid, $doc);
            auditLog('dd', $uid, ($staff ? 'Staff updated' : 'Employee updated') . ' direct deposit accounts', ['n' => count($accts), 'last4' => array_map(fn($a) => $a->last4, $accts), 'heldUntil' => $until > $now ? $until : 0], $u);
            // v83: removing every account is a change too (with a "this was not me" link that restores it)
            $removed = !$accts ? array_values(array_map(fn($a) => (string) ($a->last4 ?? ''), $old)) : [];
            if ($changed || $removed) {
                ddChangeNotice($uid, $u, $staff, $changed ?: $removed, $until > $now ? $until : 0, (array) ($doc->prev ?? []), array_values($old) ?: $working, !$changed);
            }
            ok(ddPublic(ddDoc($uid)));
        case 'dd_release':
            // v35: payroll ends a hold early, after confirming the change with the person by phone
            $u = payrollStaff();
            $uid = str($b, 'uid', 40);
            $d = ddDoc($uid);
            if (!$d || (int) ($d->prevUntil ?? 0) <= now()) {
                fail(400, 'invalid_argument', 'Nothing is on hold for this person.');
            }
            $note = str($b, 'note', 300);
            if (mb_strlen($note) < 5) {
                fail(400, 'invalid_argument', 'Write how you confirmed the change (for example: called them at the number on file).');
            }
            foreach ((array) $d->accts as $a) {
                if (is_object($a)) {
                    $a->holdUntil = 0;
                }
            }
            unset($d->prev, $d->prevUntil);
            docSet('sec/dd/items/' . $uid, $d);
            auditLog('dd', $uid, 'Direct deposit hold released', ['note' => $note], $u);
            audit('data', 'Direct deposit hold released', (string) (userRow($uid)['email'] ?? $uid), ['note' => $note], $u);
            ok(ddPublic(ddDoc($uid)));
        case 'dd_dispute_get':
            // v35: the "this wasn't me" page (public, by the link in the email)
            require_once __DIR__ . '/auth.php';
            $row = tokGet('dd_stop', str($b, 'k', 64));
            if (!$row) {
                fail(404, 'not_found', 'This link has expired or was already used. Contact StratEdge payroll directly.');
            }
            $x = json_decode((string) $row['data'], true) ?: [];
            $p = userRow((string) $row['uid']);
            ok(['first' => $p ? authFirst($p) : '', 'byn' => (string) ($x['byn'] ?? ''), 'last4' => (array) ($x['last4'] ?? []), 'at' => (int) ($x['at'] ?? 0)]);
        case 'dd_dispute':
            require_once __DIR__ . '/auth.php';
            $row = tokGet('dd_stop', str($b, 'k', 64));
            if (!$row) {
                fail(404, 'not_found', 'This link has expired or was already used. Contact StratEdge payroll directly.');
            }
            tokUse((string) $row['h']);
            $uid = (string) $row['uid'];
            $p = userRow($uid);
            $x = json_decode((string) $row['data'], true) ?: [];
            $before = json_decode(json_encode($x['before'] ?? []));
            $d = ddDoc($uid) ?? new stdClass();
            // back to the accounts from before the change; self-service changes stop until payroll has spoken to them
            $d->accts = is_array($before) ? array_values(array_map(function ($a) {
                $a->holdUntil = 0;
                return $a;
            }, array_filter($before, fn($a) => is_object($a)))) : [];
            unset($d->prev, $d->prevUntil);
            $d->frozen = true;
            $d->u = now();
            $d->byn = 'Restored after a reported change';
            docSet('sec/dd/items/' . $uid, $d);
            $ended = sessRevokeAll($uid, 'bank change reported as not theirs');
            if ($p) {
                // whoever made the change may know the password: it is replaced, and a reset link goes to the person
                db()->prepare('UPDATE users SET pass = ? WHERE id = ?')->execute([pwHash(rid(16) . 'Aa1!'), $uid]);
                authResetLink($p);
            }
            $who = $p ? $p['name'] . ' (' . $p['email'] . ')' : $uid;
            auditLog('dd', $uid, 'Direct deposit change reported as not theirs: restored', ['last4' => (array) ($x['last4'] ?? []), 'by' => (string) ($x['byn'] ?? '')], $p);
            audit('alert', 'Direct deposit change reported as fraud', (string) ($p['email'] ?? $uid), ['last4' => (array) ($x['last4'] ?? []), 'changedBy' => (string) ($x['byn'] ?? ''), 'sessionsEnded' => $ended], $p);
            secAlertAdmins('ddfraud:' . $uid, 'Direct deposit change reported as fraud: ' . ($p['name'] ?? $uid), $who . ' says they did not make the change to ' . implode(', ', array_map(fn($l) => 'the account ending ' . $l, (array) ($x['last4'] ?? []))) . ' (made by ' . ($x['byn'] ?? '?') . '). The previous accounts were put back, their sessions were ended (' . $ended . '), their password was replaced and a reset link was emailed, and their own direct deposit changes are stopped until payroll changes them. Treat it as an incident: check how the change was made (Security center > Activity) and call them at a number already on file.');
            foreach (ddPayrollPeople() as $r) {
                sendMail((string) $r['email'], (string) $r['name'], 'Reported as fraud: direct deposit change for ' . ($p['name'] ?? $uid), $who . ' reported the direct deposit change as not theirs. The previous accounts are back in place and their own changes are stopped; call them at a number already on file before changing anything.', emailHtml('Direct deposit change reported as fraud', [$who . ' reported the direct deposit change as not theirs.', 'The previous accounts are back in place and their own changes are stopped. Call them at a number already on file before changing anything.']));
            }
            ok(['ok' => true, 'restored' => count($d->accts)]);
        case 'dd_prenoted':
            // staff mark a prenote as sent (the bank confirms silently within 3 banking days)
            $u = payrollStaff();
            $mk = str($b, 'mk', 20);
            $n = 0;
            $s = db()->prepare("SELECT path, data FROM docs WHERE col = 'sec/dd/items'");
            $s->execute();
            while ($row = $s->fetch()) {
                $d = json_decode($row['data']);
                if (!($d instanceof stdClass)) {
                    continue;
                }
                $changed = false;
                foreach ((array) ($d->accts ?? []) as $a) {
                    if ($a instanceof stdClass && !empty($a->prenote)) {
                        $a->prenote = false;
                        $a->prenotedAt = now();
                        $changed = true;
                        $n++;
                    }
                }
                if ($changed) {
                    docSet($row['path'], $d);
                }
            }
            auditLog('ach', $mk, 'Prenote file sent to the bank', ['accounts' => $n], $u);
            ok(['marked' => $n]);
        case 'ach_settings':
            payrollStaff();
            ok(achCfg());
        case 'ach_settings_save':
            $u = payrollStaff();
            $cur = docGet('sec/x/ach/cfg') ?? new stdClass();
            foreach (['immDest', 'immOrigin', 'odfi', 'offsetRouting'] as $k) {
                $v = preg_replace('/\D/', '', (string) ($b[$k] ?? '')) ?? '';
                if ($v !== '' && ($k === 'odfi' ? strlen($v) < 8 : !abaValid($v)) && $k !== 'immOrigin') {
                    fail(400, 'invalid_argument', 'Check the ' . ['immDest' => 'bank routing number', 'odfi' => 'ODFI number', 'offsetRouting' => 'company account routing number'][$k] . '.');
                }
                $cur->$k = $v;
            }
            foreach (['destName', 'originName', 'companyName', 'entryDesc'] as $k) {
                $cur->$k = mb_substr(trim((string) ($b[$k] ?? '')), 0, 40);
            }
            $cur->companyId = mb_substr(preg_replace('/[^A-Za-z0-9]/', '', (string) ($b['companyId'] ?? '')) ?? '', 0, 10);
            $cur->balanced = !empty($b['balanced']);
            $cur->offsetType = (string) ($b['offsetType'] ?? 'checking') === 'savings' ? 'savings' : 'checking';
            $acct = preg_replace('/\D/', '', (string) ($b['offsetAcct'] ?? '')) ?? '';
            if ($acct !== '') {
                $cur->offsetAcct = mailSeal($acct);
                $cur->offsetLast4 = substr($acct, -4);
            }
            if (!empty($b['clearOffset'])) {
                $cur->offsetAcct = '';
                $cur->offsetLast4 = '';
            }
            $cur->u = now();
            docSet('sec/x/ach/cfg', $cur);
            auditLog('ach', 'settings', 'ACH settings changed', ['companyName' => $cur->companyName], $u);
            ok(achCfg());
        case 'pay_nacha':
            $u = payrollStaff();
            $mk = str($b, 'mk', 20);
            $prenote = !empty($b['prenote']);
            // v83: mk 'prenote' (with prenote) is the standalone prenote for new accounts, not a pay period
            if (!($prenote && $mk === 'prenote') && !preg_match('/^\d{4}-\d{2}(-\d{1,2})?$/', $mk)) {
                fail(400, 'invalid_argument', 'Bad pay period.');
            }
            [$text, $summary] = nachaBuild($mk, $prenote, $u);
            if (!empty($b['download'])) {
                header('Content-Type: text/plain; charset=us-ascii');
                header('Content-Disposition: attachment; filename="' . ($prenote ? 'prenote-' : 'payroll-') . $summary['payDate'] . '.ach"');
                header('Cache-Control: no-store');
                echo $text;
                exit();
            }
            if (!$prenote) {
                $run = docGet('org/acct/runs/' . $mk) ?? new stdClass();
                $run->ach = (object) ['at' => now(), 'by' => $u['id'], 'byn' => (string) $u['name'], 'total' => $summary['total'], 'entries' => $summary['entries'], 'people' => $summary['people'], 'fileId' => $summary['fileId']];
                docSet('org/acct/runs/' . $mk, $run);
            }
            auditLog('ach', $mk, ($prenote ? 'Prenote' : 'Direct deposit') . ' file created', ['total' => $summary['total'], 'entries' => $summary['entries']], $u);
            ok(['file' => $text, 'summary' => $summary]);
        case 'pay_dd_register':
            // the same payments as a CSV, for banks whose portal takes a list instead of an ACH file
            payrollStaff();
            $mk = str($b, 'mk', 20);
            [$text, $summary] = nachaBuild($mk, false, requireUser());
            $out = ["Name,Routing,Account (last 4),Type,Amount,Pay date"];
            foreach (explode("\r\n", $text) as $line) {
                if ($line !== '' && $line[0] === '6' && substr($line, 1, 2) !== '27' && substr($line, 1, 2) !== '37') {
                    $out[] = '"' . trim(substr($line, 54, 22)) . '",' . substr($line, 3, 9) . ',' . substr(trim(substr($line, 12, 17)), -4) . ',' . (substr($line, 1, 2) === '32' ? 'savings' : 'checking') . ',' . number_format(((int) substr($line, 29, 10)) / 100, 2, '.', '') . ',' . $summary['payDate'];
                }
            }
            header('Content-Type: text/csv; charset=utf-8');
            header('Content-Disposition: attachment; filename="direct-deposit-' . $summary['payDate'] . '.csv"');
            echo implode("\n", $out);
            exit();
        case 'pay_tax_summary':
            payrollStaff();
            $year = (int) ($b['year'] ?? date('Y'));
            if ($year < 2020 || $year > 2100) {
                fail(400, 'invalid_argument', 'Bad year.');
            }
            ok(payTaxSummary($year));
        case 'my_tax_form':
            // the employee's own W-2 (or 1099) figures for a year
            $u = requireUser();
            $year = (int) ($b['year'] ?? date('Y') - 1);
            $all = payTaxSummary($year, $u['id']);
            ok(['year' => $year, 'w2' => $all['employees'][0] ?? null, 'nec' => array_values(array_filter($all['nec'], fn($c) => ($c['uid'] ?? '') === $u['id'])), 'company' => $all['company']]);
        case 'my_w4_save':
            // employee self-service: the W-4 details (filing status, Steps 2–4) and the direct deposit choice
            $u = requireUser();
            $r = myR($u['id']) ?? new stdClass();
            $tax = $r->tax instanceof stdClass ? $r->tax : new stdClass();
            if ((string) ($tax->country ?? 'US') !== 'US') {
                fail(400, 'invalid_argument', 'W-4 details apply to US payroll.');
            }
            $filing = (string) ($b['filing'] ?? ($tax->filing ?? 'single'));
            $tax->filing = in_array($filing, ['single', 'married', 'head'], true) ? $filing : 'single';
            $w4 = is_array($b['w4'] ?? null) ? $b['w4'] : [];
            $tax->w4 = (object) ['multi' => !empty($w4['multi']), 'dep' => max(0, round((float) ($w4['dep'] ?? 0), 2)), 'other' => max(0, round((float) ($w4['other'] ?? 0), 2)), 'dedn' => max(0, round((float) ($w4['dedn'] ?? 0), 2))];
            $tax->extra = max(0, round((float) ($b['extra'] ?? ($tax->extra ?? 0)), 2));
            $tax->stateExtra = max(0, round((float) ($b['stateExtra'] ?? ($tax->stateExtra ?? 0)), 2));
            $tax->exemptFed = !empty($b['exemptFed']);
            if (isset($b['method']) && in_array((string) $b['method'], ['Direct deposit', 'Check'], true)) {
                $tax->method = (string) $b['method'];
            }
            $tax->w4At = now();
            $tax->w4By = 'self';
            $r->tax = $tax;
            $r->u = now();
            docSet('r/' . $u['id'], $r);
            auditLog('w4', $u['id'], 'Employee updated W-4 details', ['filing' => $tax->filing, 'multi' => $tax->w4->multi, 'dep' => $tax->w4->dep, 'extra' => $tax->extra], $u);
            ok(['tax' => ['filing' => $tax->filing, 'w4' => $tax->w4, 'extra' => $tax->extra, 'stateExtra' => $tax->stateExtra, 'exemptFed' => $tax->exemptFed, 'method' => $tax->method ?? 'Direct deposit']]);
        case 'taxdep_save':
            $u = payrollStaff();
            $id = preg_replace('/[^a-z0-9]/', '', (string) ($b['id'] ?? '')) ?: rid(10);
            $d = (object) [
                'kind' => in_array((string) ($b['kind'] ?? ''), ['941', '940', 'state-wh', 'suta', 'local', 'other'], true) ? (string) $b['kind'] : 'other',
                'state' => strtoupper(preg_replace('/[^A-Za-z]/', '', (string) ($b['state'] ?? '')) ?? ''),
                'period' => mb_substr(trim((string) ($b['period'] ?? '')), 0, 20),
                'd' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($b['d'] ?? '')) ? (string) $b['d'] : date('Y-m-d'),
                'a' => round((float) ($b['a'] ?? 0), 2),
                'conf' => mb_substr(trim((string) ($b['conf'] ?? '')), 0, 60),
                'note' => mb_substr(trim((string) ($b['note'] ?? '')), 0, 300),
                'by' => $u['id'],
                'u' => now(),
            ];
            booksGuard('org/acct/taxdep/' . $id, $d); // v83: closed periods stay closed (the new date and, for an edit, the old one)
            docSet('org/acct/taxdep/' . $id, $d);
            auditLog('taxdep', $id, 'Tax deposit recorded', ['kind' => $d->kind, 'a' => $d->a, 'period' => $d->period], $u);
            ok(['id' => $id]);
        case 'taxdep_delete':
            $u = payrollStaff();
            $id = preg_replace('/[^a-z0-9]/', '', (string) ($b['id'] ?? ''));
            if ($id !== '') {
                booksGuard('org/acct/taxdep/' . $id, docGet('org/acct/taxdep/' . $id)); // v83: a deposit in a closed period stays
                docDelete('org/acct/taxdep/' . $id);
                auditLog('taxdep', $id, 'Tax deposit removed', [], $u);
            }
            ok(['ok' => true]);
        default:
            fail(404, 'not_found', 'Unknown action.');
    }
}
