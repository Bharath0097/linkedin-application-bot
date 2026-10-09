<?php
declare(strict_types=1);
require_once __DIR__ . '/payroll.php';

/*
 * Books (v28): a double-entry general ledger derived from the records the site already keeps (invoices and their
 * payments, bills and their payments, finalized payroll, tax deposits, categorized bank lines) plus manual journal
 * entries; the reports a bookkeeper expects (trial balance, profit & loss, balance sheet, cash flow, AR/AP aging,
 * sales tax); bank reconciliation; rules; receipts; exports for an outside accountant.
 *
 * Chart of accounts: org/acct/x/coa.items [{id, n, t, sub, num, open, openDate, sys, active}]. Manual journals:
 * org/acct/je/{id}. Reconciliations: org/acct/recon/{id}. Rules: org/acct/x/rules. Settings: org/acct/x/books.
 */

const BOOKS_SYS = [
    // sys key => [number, name, type, subtype]
    'bank' => ['1000', 'Business checking', 'asset', 'bank'],
    'savings' => ['1010', 'Business savings', 'asset', 'bank'],
    'undep' => ['1050', 'Undeposited funds', 'asset', 'cash'],
    'ar' => ['1200', 'Accounts receivable', 'asset', 'ar'],
    'prepaid' => ['1300', 'Prepaid expenses', 'asset', 'current'],
    'equip' => ['1500', 'Equipment and computers', 'asset', 'fixed'],
    'accdep' => ['1510', 'Accumulated depreciation', 'asset', 'fixed'],
    'ap' => ['2000', 'Accounts payable', 'liability', 'ap'],
    'cc' => ['2100', 'Business credit card', 'liability', 'cc'],
    'fedliab' => ['2200', 'Payroll liabilities: federal', 'liability', 'payroll'],
    'stateliab' => ['2210', 'Payroll liabilities: state', 'liability', 'payroll'],
    'benliab' => ['2220', 'Benefits payable', 'liability', 'payroll'],
    'garnliab' => ['2230', 'Garnishments payable', 'liability', 'payroll'],
    'netpay' => ['2240', 'Net pay payable', 'liability', 'payroll'],
    'salestax' => ['2300', 'Sales tax payable', 'liability', 'current'],
    'loans' => ['2500', 'Loans payable', 'liability', 'longterm'],
    'openeq' => ['3000', 'Opening balance equity', 'equity', 'equity'],
    'retained' => ['3100', 'Retained earnings', 'equity', 'equity'],
    'draws' => ['3200', 'Owner draws / distributions', 'equity', 'equity'],
    'contrib' => ['3300', 'Owner contributions', 'equity', 'equity'],
    'inc' => ['4000', 'Staffing income', 'income', 'income'],
    'discounts' => ['4800', 'Discounts given', 'income', 'income'],
    'cogsw2' => ['5000', 'Consultant pay (W-2 wages)', 'expense', 'cogs'],
    'cogsc2c' => ['5010', 'Consultant pay (C2C / 1099)', 'expense', 'cogs'],
    'cogstax' => ['5020', 'Employer payroll taxes (consultants)', 'expense', 'cogs'],
    'cogsben' => ['5030', 'Benefits (consultants)', 'expense', 'cogs'],
    'wages' => ['6000', 'Salaries (internal staff)', 'expense', 'opex'],
    'ertax' => ['6010', 'Employer payroll taxes (staff)', 'expense', 'opex'],
    'ben' => ['6020', 'Benefits (staff)', 'expense', 'opex'],
    'bankfees' => ['6800', 'Bank fees and charges', 'expense', 'opex'],
    'depr' => ['6950', 'Depreciation', 'expense', 'opex'],
    'interest' => ['7000', 'Interest expense', 'expense', 'opex'],
    'otherexp' => ['7900', 'Other expenses', 'expense', 'opex'],
];
// the readable chart that ships with the site (core.js COA_DEFAULT) keeps its ids; numbers and roles are added here
const BOOKS_LEGACY = [
    'inc-staff' => ['4000', 'inc'],
    'inc-sow' => ['4100', ''],
    'inc-consult' => ['4200', ''],
    'inc-other' => ['4900', ''],
    'exp-c2c' => ['5010', 'cogsc2c'],
    'exp-payroll' => ['6000', 'wages'],
    'exp-paytax' => ['6010', 'ertax'],
    'exp-rent' => ['6100', ''],
    'exp-soft' => ['6200', ''],
    'exp-travel' => ['6500', ''],
    'exp-mkt' => ['6600', ''],
    'exp-prof' => ['6300', ''],
    'exp-ins' => ['6400', ''],
    'exp-office' => ['6700', ''],
    'exp-bank' => ['6800', 'bankfees'],
    'exp-tax' => ['6900', ''],
    'exp-other' => ['7900', 'otherexp'],
];
const BOOKS_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'];

/** v83: takes back what a bank line's match wrote: the invoice payment it added (pays[] entries carrying this bank
 *  line, so manual and card payments stay) or the bill it marked paid. Called before the line is undone, excluded or
 *  categorized, so one deposit is never counted twice. */
function booksUnmatch(string $id, stdClass $x): void
{
    $m = $x->m ?? null;
    if (!($m instanceof stdClass)) {
        return;
    }
    $k = (string) ($m->k ?? '');
    $mid = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($m->id ?? '')) ?? '';
    if ($mid === '') {
        return;
    }
    $now = now();
    if ($k === 'inv') {
        $inv = docGet('inv/' . $mid);
        if (!$inv) {
            return;
        }
        $keep = [];
        $back = 0.0;
        $gone = 0;
        foreach ((array) ($inv->pays ?? []) as $p) {
            if ($p instanceof stdClass && (string) ($p->bank ?? '') === $id) {
                $back += (float) ($p->a ?? 0);
                $gone++;
                continue;
            }
            $keep[] = $p;
        }
        if (!$gone) {
            return;
        }
        $paid = round(max(0, (float) ($inv->paid ?? 0) - $back), 2);
        $inv->pays = $keep;
        $inv->paid = $paid;
        if (in_array((string) ($inv->st ?? ''), ['paid', 'part'], true)) {
            $inv->st = $paid >= (float) ($inv->total ?? 0) - 0.005 && $paid > 0 ? 'paid' : ($paid > 0.005 ? 'part' : (!empty($inv->viewedAt) ? 'viewed' : 'sent'));
        }
        $log = array_values((array) ($inv->log ?? []));
        $log[] = (object) ['t' => $now, 'who' => (string) (currentUser()['name'] ?? ''), 'ev' => 'Bank match undone: ' . money(round($back, 2), (string) ($inv->cur ?? 'USD')) . ' taken back', 'ip' => ''];
        $inv->log = $log;
        $inv->u = $now;
        docSet('inv/' . $mid, $inv);
        if (!empty($inv->cid)) {
            try {
                $pub = docGet('pub/' . $inv->cid . '/inv/' . $mid);
                if ($pub) {
                    $pub->paid = $paid;
                    $pub->st = $inv->st;
                    $pub->u = $now;
                    docSet('pub/' . $inv->cid . '/inv/' . $mid, $pub);
                }
            } catch (Throwable $e) {
                // the client copy follows when it can
            }
        }
    } elseif ($k === 'exp') {
        $exp = docGet('exp/' . $mid);
        if (!$exp || (string) ($exp->st ?? '') !== 'paid') {
            return;
        }
        $exp->st = 'unpaid';
        unset($exp->paidOn, $exp->paidAt);
        if ((string) ($exp->m ?? '') === 'Bank transfer') {
            unset($exp->m);
        }
        $exp->u = $now;
        docSet('exp/' . $mid, $exp);
    }
}
/** Books staff: accounting and administrators (view-only bookkeepers may read). */
function booksStaff(bool $write = false): array
{
    $u = requireAdmin();
    if (hasRole($u, 'admin')) {
        return $u;
    }
    if (!hasRole($u, 'acct')) {
        fail(403, 'forbidden', 'The books are for administrators and accounting staff.');
    }
    if ($write && acctLimits($u)['books'] !== 'full') {
        fail(403, 'forbidden', 'Your books access is view-only.');
    }
    return $u;
}
function booksCfg(): array
{
    $d = docGet('org/acct/x/books');
    $bs = booksSettings();
    return [
        'close' => $bs['close'],
        'closedBy' => $bs['closedBy'],
        'closedAt' => $bs['closedAt'],
        'fy' => $bs['fy'],
        'catMap' => (array) ($d->catMap ?? []),
        'bankMap' => (array) ($d->bankMap ?? []),
        'methodMap' => (array) ($d->methodMap ?? []),
        'roles' => (array) ($d->roles ?? []),
        'start' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($d->start ?? '')) ? (string) $d->start : '',
        'rates' => array_filter(array_map('floatval', (array) ($d->rates ?? [])), fn($v) => $v > 0),
        'base' => booksBase(),
    ];
}
/** The books are kept in one currency: the accounting settings' default (USD unless changed). */
function booksBase(): string
{
    $s = docGet('org/acct/x/settings');
    $c = strtoupper((string) ($s->cur ?? 'USD'));
    return preg_match('/^[A-Z]{3}$/', $c) ? $c : 'USD';
}
/** An amount in the books' currency, or null when there is no rate for the record's currency (then it is left out). */
function booksFx(float $v, string $cur): ?float
{
    static $base = null, $rates = null;
    if ($base === null) {
        $base = booksBase();
        $rates = booksCfg()['rates'];
    }
    $cur = strtoupper($cur);
    if ($cur === '' || $cur === $base) {
        return $v;
    }
    if (isset($rates[$cur])) {
        return round($v * $rates[$cur], 2);
    }
    $GLOBALS['booksSkipped'][$cur] = ($GLOBALS['booksSkipped'][$cur] ?? 0) + 1;
    return null;
}
/**
 * The chart of accounts with every structural account present: the saved list (or the site's readable default)
 * with numbers, types and system roles filled in, and any missing system account added. Saved back when changed.
 */
function booksCoa(bool $persist = true): array
{
    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }
    $d = docGet('org/acct/x/coa');
    $items = [];
    foreach ((array) ($d->items ?? []) as $it) {
        if ($it instanceof stdClass && !empty($it->id) && !empty($it->n)) {
            $items[] = (array) $it;
        }
    }
    $legacyDefault = [
        ['inc-staff', 'Staffing income', 'income'], ['inc-sow', 'Project (SOW) income', 'income'], ['inc-consult', 'Consulting income', 'income'], ['inc-other', 'Other income', 'income'],
        ['exp-c2c', 'Contractor payments (C2C)', 'expense'], ['exp-payroll', 'Payroll', 'expense'], ['exp-paytax', 'Payroll taxes', 'expense'], ['exp-rent', 'Rent and utilities', 'expense'],
        ['exp-soft', 'Software subscriptions', 'expense'], ['exp-travel', 'Travel', 'expense'], ['exp-mkt', 'Marketing and job boards', 'expense'], ['exp-prof', 'Professional fees (legal, CPA)', 'expense'],
        ['exp-ins', 'Insurance', 'expense'], ['exp-office', 'Office and supplies', 'expense'], ['exp-bank', 'Bank fees and charges', 'expense'], ['exp-tax', 'Taxes and licenses', 'expense'], ['exp-other', 'Other expenses', 'expense'],
    ];
    if (!$items) {
        foreach ($legacyDefault as [$id, $n, $t]) {
            $items[] = ['id' => $id, 'n' => $n, 't' => $t];
        }
    }
    $changed = false;
    $bySys = [];
    foreach ($items as $i => $it) {
        $it['t'] = in_array((string) ($it['t'] ?? ''), BOOKS_TYPES, true) ? (string) $it['t'] : 'expense';
        if (isset(BOOKS_LEGACY[$it['id']])) {
            [$num, $sys] = BOOKS_LEGACY[$it['id']];
            if (empty($it['num'])) {
                $it['num'] = $num;
                $changed = true;
            }
            if ($sys !== '' && empty($it['sys'])) {
                $it['sys'] = $sys;
                $changed = true;
            }
        }
        if (empty($it['sub'])) {
            $it['sub'] = $it['t'] === 'income' ? 'income' : ($it['t'] === 'expense' ? (str_starts_with((string) ($it['num'] ?? ''), '5') ? 'cogs' : 'opex') : $it['t']);
            $changed = true;
        }
        if (!empty($it['sys'])) {
            $bySys[(string) $it['sys']] = $it['id'];
        }
        $items[$i] = $it;
    }
    foreach (BOOKS_SYS as $sys => [$num, $n, $t, $sub]) {
        if (isset($bySys[$sys])) {
            continue;
        }
        // a saved account with the same name takes the role rather than a duplicate being added
        $found = null;
        foreach ($items as $i => $it) {
            if (mb_strtolower($it['n']) === mb_strtolower($n) && $it['t'] === $t) {
                $found = $i;
                break;
            }
        }
        if ($found !== null) {
            $items[$found]['sys'] = $sys;
            if (empty($items[$found]['num'])) {
                $items[$found]['num'] = $num;
            }
        } else {
            $items[] = ['id' => 'sys-' . $sys, 'n' => $n, 't' => $t, 'sub' => $sub, 'num' => $num, 'sys' => $sys];
        }
        $changed = true;
    }
    usort($items, fn($a, $b) => strcmp((string) ($a['num'] ?? '9999'), (string) ($b['num'] ?? '9999')) ?: strcmp($a['n'], $b['n']));
    if ($changed && $persist) {
        try {
            $doc = $d ?? new stdClass();
            $doc->items = array_map(fn($x) => (object) $x, $items);
            $doc->u = now();
            docSet('org/acct/x/coa', $doc);
        } catch (Throwable $e) {
            // a view-only session still gets the chart; it is saved by the next person who may write
        }
    }
    return $cache = $items;
}
function coaIndex(): array
{
    static $idx = null;
    if ($idx === null) {
        $idx = ['byId' => [], 'bySys' => [], 'byName' => []];
        foreach (booksCoa() as $it) {
            $idx['byId'][$it['id']] = $it;
            if (!empty($it['sys'])) {
                $idx['bySys'][$it['sys']] = $it['id'];
            }
            $idx['byName'][mb_strtolower(trim($it['n']))] = $it['id'];
        }
    }
    return $idx;
}
function sysAcct(string $sys): string
{
    $i = coaIndex();
    return $i['bySys'][$sys] ?? ($i['bySys']['otherexp'] ?? 'exp-other');
}
/** The account an expense category (stored by name on bills) posts to. */
function catAcct(string $cat): string
{
    $cfg = booksCfg();
    $i = coaIndex();
    if (isset($cfg['catMap'][$cat]) && isset($i['byId'][(string) $cfg['catMap'][$cat]])) {
        return (string) $cfg['catMap'][$cat];
    }
    $k = mb_strtolower(trim($cat));
    if (isset($i['byName'][$k])) {
        return $i['byName'][$k];
    }
    return sysAcct('otherexp');
}
/** The ledger account behind a bank-line account name or a payment method. */
function bankAcct(string $name): string
{
    $cfg = booksCfg();
    $i = coaIndex();
    if ($name !== '' && isset($cfg['bankMap'][$name]) && isset($i['byId'][(string) $cfg['bankMap'][$name]])) {
        return (string) $cfg['bankMap'][$name];
    }
    $k = mb_strtolower(trim($name));
    if ($k !== '' && isset($i['byName'][$k])) {
        return $i['byName'][$k];
    }
    return sysAcct('bank');
}
function methodAcct(string $method): string
{
    $cfg = booksCfg();
    $i = coaIndex();
    if ($method !== '' && isset($cfg['methodMap'][$method]) && isset($i['byId'][(string) $cfg['methodMap'][$method]])) {
        return (string) $cfg['methodMap'][$method];
    }
    if (preg_match('/card/i', $method)) {
        return sysAcct('cc');
    }
    return sysAcct('bank');
}
/** Whether a person is billable (consultant: cost of sales) or internal staff (operating expense). */
function personIsConsultant(string $uid): bool
{
    static $c = [];
    if (!isset($c[$uid])) {
        $r = myR($uid);
        $u = docGet('u/' . $uid);
        $role = (string) ($r->role ?? ($u->p->role ?? 'consultant'));
        $c[$uid] = !in_array($role, ['employee', 'bench', 'employer'], true);
    }
    return $c[$uid];
}
function je(string $id, string $d, string $src, string $ref, string $memo, array $lines, array $extra = []): array
{
    $clean = [];
    foreach ($lines as $l) {
        $dr = round((float) ($l['dr'] ?? 0), 2);
        $cr = round((float) ($l['cr'] ?? 0), 2);
        if ($dr == 0.0 && $cr == 0.0) {
            continue;
        }
        if ($dr < 0) {
            $cr += -$dr;
            $dr = 0;
        }
        if ($cr < 0) {
            $dr += -$cr;
            $cr = 0;
        }
        $clean[] = ['acct' => (string) $l['acct'], 'dr' => round($dr, 2), 'cr' => round($cr, 2), 'memo' => (string) ($l['memo'] ?? ''), 'name' => (string) ($l['name'] ?? '')];
    }
    return ['id' => $id, 'd' => $d, 'src' => $src, 'ref' => $ref, 'memo' => $memo, 'lines' => $clean] + $extra;
}
/** v83: bookkeepers kept out of payroll (r.nopay) see every pay run as one unnamed entry, never one per person. */
function booksNoPay(): bool
{
    $u = currentUser();
    return $u !== null && !hasRole($u, 'admin') && acctLimits($u)['nopay'];
}
function booksPayrollRollup(array $entries): array
{
    $out = [];
    $runs = [];
    foreach ($entries as $e) {
        if (($e['src'] ?? '') !== 'payroll') {
            $out[] = $e;
            continue;
        }
        $k = $e['ref'] . "\x1f" . $e['d'] . "\x1f" . (string) ($e['cur'] ?? '');
        $runs[$k] = $runs[$k] ?? ['e' => $e, 'n' => 0, 'acc' => []];
        $runs[$k]['n']++;
        foreach ($e['lines'] as $l) {
            $runs[$k]['acc'][$l['acct']][$l['memo']] = ($runs[$k]['acc'][$l['acct']][$l['memo']] ?? 0.0) + $l['dr'] - $l['cr'];
        }
    }
    foreach ($runs as $g) {
        $lines = [];
        foreach ($g['acc'] as $acct => $byMemo) {
            foreach ($byMemo as $memo => $v) {
                $lines[] = ['acct' => (string) $acct, 'dr' => $v > 0 ? $v : 0, 'cr' => $v < 0 ? -$v : 0, 'memo' => (string) $memo, 'name' => ''];
            }
        }
        $e = $g['e'];
        $out[] = je('payroll-' . $e['ref'] . '-' . $e['d'], $e['d'], 'payroll', $e['ref'], 'Payroll ' . $e['ref'] . ' · ' . $g['n'] . ' paystub' . ($g['n'] === 1 ? '' : 's'), $lines, ['link' => 'pay', 'linkId' => '', 'cur' => (string) ($e['cur'] ?? '')]);
    }
    usort($out, fn($a, $b) => strcmp($a['d'], $b['d']) ?: strcmp($a['id'], $b['id']));
    return $out;
}
/**
 * Every journal entry between two dates (inclusive), derived from the records plus manual journals. Dates are
 * YYYY-MM-DD; '' means open-ended. Entries outside the window are skipped but opening balances and retained
 * earnings are computed by the reports from the full history (they call this with from = '').
 */
function booksEntries(string $from, string $to): array
{
    $out = [];
    $in = fn(string $d) => $d !== '' && ($from === '' || $d >= $from) && ($to === '' || $d <= $to);
    $cfg = booksCfg();
    $coa = booksCoa();
    // opening balances
    foreach ($coa as $a) {
        $open = round((float) ($a['open'] ?? 0), 2);
        if ($open == 0.0) {
            continue;
        }
        $d = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($a['openDate'] ?? '')) ? (string) $a['openDate'] : ($cfg['start'] ?: '2000-01-01');
        if (!$in($d)) {
            continue;
        }
        $debitNormal = in_array($a['t'], ['asset', 'expense'], true);
        $out[] = je('open-' . $a['id'], $d, 'open', $a['n'], 'Opening balance', [
            ['acct' => $a['id'], 'dr' => $debitNormal ? $open : 0, 'cr' => $debitNormal ? 0 : $open],
            ['acct' => sysAcct('openeq'), 'dr' => $debitNormal ? 0 : $open, 'cr' => $debitNormal ? $open : 0],
        ]);
    }
    // invoices and their payments
    $ar = sysAcct('ar');
    $tax = sysAcct('salestax');
    $incDefault = sysAcct('inc');
    foreach (colAll('inv') as [$id, $x]) {
        $st = (string) ($x->st ?? 'draft');
        if ($st === 'draft') {
            continue;
        }
        $issue = (string) ($x->issue ?? '');
        $num = (string) ($x->num ?? $id);
        $client = (string) ($x->cn ?? ($x->bill->co ?? ''));
        $icur = (string) ($x->cur ?? 'USD');
        if (booksFx(1.0, $icur) === null) {
            continue;
        }
        $fx = fn($v) => (float) booksFx((float) $v, $icur);
        // a voided invoice leaves the books, but money already received on it stays (a credit owed to the client)
        if ($st !== 'void' && $in($issue)) {
            $lines = [['acct' => $ar, 'dr' => $fx($x->total ?? 0), 'cr' => 0, 'name' => $client]];
            foreach ((array) ($x->lines ?? []) as $l) {
                if (!($l instanceof stdClass)) {
                    continue;
                }
                $amt = $fx(round((float) ($l->q ?? 0) * (float) ($l->u ?? 0), 2));
                $acct = !empty($l->acct) && isset(coaIndex()['byId'][(string) $l->acct]) ? (string) $l->acct : $incDefault;
                $lines[] = ['acct' => $acct, 'dr' => 0, 'cr' => $amt, 'memo' => (string) ($l->d ?? '')];
            }
            if ((float) ($x->tax ?? 0) > 0) {
                $lines[] = ['acct' => $tax, 'dr' => 0, 'cr' => $fx($x->tax)];
            }
            if ((float) ($x->disc ?? 0) > 0) {
                $lines[] = ['acct' => sysAcct('discounts'), 'dr' => $fx($x->disc), 'cr' => 0];
            }
            $out[] = je('inv-' . $id, $issue, 'inv', $num, 'Invoice ' . $num . ($client !== '' ? ' · ' . $client : ''), $lines, ['link' => 'inv', 'linkId' => (string) $id]);
        }
        foreach ((array) ($x->pays ?? []) as $k => $p) {
            if (!($p instanceof stdClass)) {
                continue;
            }
            $dt = (string) ($p->dt ?? '');
            if (!$in($dt)) {
                continue;
            }
            $amt = $fx(round((float) ($p->a ?? 0), 2));
            $out[] = je('invpay-' . $id . '-' . $k, $dt, 'pay', $num, 'Payment on invoice ' . $num . ($client !== '' ? ' · ' . $client : ''), [
                ['acct' => methodAcct((string) ($p->m ?? '')), 'dr' => $amt, 'cr' => 0, 'name' => $client],
                ['acct' => $ar, 'dr' => 0, 'cr' => $amt, 'name' => $client],
            ], ['link' => 'inv', 'linkId' => (string) $id]);
        }
    }
    // bills and their payments
    $ap = sysAcct('ap');
    foreach (colAll('exp') as [$id, $x]) {
        $d = (string) ($x->d ?? '');
        $vendor = (string) ($x->v ?? '');
        $amtN = booksFx(round((float) ($x->a ?? 0), 2), (string) ($x->cur ?? 'USD'));
        if ($amtN === null || $amtN <= 0) {
            continue;
        }
        $amt = $amtN;
        if ($in($d)) {
            $out[] = je('exp-' . $id, $d, 'exp', (string) ($x->ref ?? ''), 'Bill · ' . $vendor . ((string) ($x->cat ?? '') !== '' ? ' · ' . $x->cat : ''), [
                ['acct' => catAcct((string) ($x->cat ?? '')), 'dr' => $amt, 'cr' => 0, 'name' => $vendor, 'memo' => (string) ($x->notes ?? '')],
                ['acct' => $ap, 'dr' => 0, 'cr' => $amt, 'name' => $vendor],
            ], ['link' => 'exp', 'linkId' => (string) $id]);
        }
        if ((string) ($x->st ?? '') === 'paid') {
            $pd = (string) ($x->paidOn ?? $d);
            if ($in($pd)) {
                $out[] = je('exppay-' . $id, $pd, 'billpay', (string) ($x->ref ?? ''), 'Paid · ' . $vendor, [
                    ['acct' => $ap, 'dr' => $amt, 'cr' => 0, 'name' => $vendor],
                    ['acct' => methodAcct((string) ($x->m ?? '')), 'dr' => 0, 'cr' => $amt, 'name' => $vendor],
                ], ['link' => 'exp', 'linkId' => (string) $id]);
            }
        }
    }
    // payroll: finalized paystubs post on their pay date; the run's payment moves net pay out of the bank
    $s = db()->prepare("SELECT path, data FROM docs WHERE col LIKE 'pays/%/items'");
    $s->execute();
    $runNet = [];
    while ($row = $s->fetch()) {
        if (!preg_match('#^pays/(u_[a-f0-9]+)/items/([^/]+)$#', $row['path'], $mm)) {
            continue;
        }
        $st = json_decode($row['data']);
        if (!($st instanceof stdClass) || !in_array((string) ($st->st ?? ''), ['final', 'paid'], true)) {
            continue;
        }
        $uid = $mm[1];
        $mk = $mm[2];
        $run = docGet('org/acct/runs/' . $mk);
        $pd = (string) ($run->payDate ?? '');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $pd)) {
            $pd = (string) ($st->payDate ?? '');
        }
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $pd)) {
            // older runs: the last day of the period
            $pd = preg_match('/^\d{4}-\d{2}$/', $mk) ? date('Y-m-t', strtotime($mk . '-01')) : substr($mk, 0, 10);
        }
        $cur = (string) ($st->cur ?? 'USD');
        if (booksFx(1.0, $cur) === null) {
            continue;
        }
        $cons = personIsConsultant($uid);
        $gross = (float) booksFx(round((float) ($st->gross ?? 0), 2), $cur);
        $net = (float) booksFx(round((float) ($st->net ?? 0), 2), $cur);
        $wtype = (string) ($st->wtype ?? 'w2');
        $taxes = array_filter((array) ($st->taxes ?? []), fn($t) => $t instanceof stdClass);
        $er = array_filter((array) ($st->employer ?? []), fn($t) => $t instanceof stdClass);
        $sum = fn(array $list, callable $f) => (float) booksFx(round(array_reduce($list, fn($a, $x) => $a + ((float) ($x->v ?? 0)) * ($f($x) ? 1 : 0), 0.0), 2), $cur);
        // older paystubs tag no group on a tax line: the name decides, as the paystub view does
        $grp = function (stdClass $t): string {
            $g = (string) ($t->g ?? '');
            if ($g !== '') {
                return $g;
            }
            $n = (string) ($t->n ?? '');
            return preg_match('/Federal/i', $n) ? 'fed' : (preg_match('/Social Security|Medicare/i', $n) ? 'fica' : (preg_match('/PF|ESI|TDS|Professional|Provident/i', $n) ? 'in' : 'state'));
        };
        $fedEE = $sum($taxes, fn($t) => in_array($grp($t), ['fed', 'fica'], true));
        $stateEE = $sum($taxes, fn($t) => !in_array($grp($t), ['fed', 'fica'], true));
        $fedER = $sum($er, fn($t) => in_array($grp($t), ['fed', 'fica'], true));
        $benER = $sum($er, fn($t) => $grp($t) === 'ben');
        $stateER = $sum($er, fn($t) => !in_array($grp($t), ['fed', 'fica', 'ben'], true));
        $other = array_filter((array) ($st->other ?? []), fn($t) => $t instanceof stdClass);
        $garn = $sum($other, fn($t) => !empty($t->garn));
        $benEE = $sum($other, fn($t) => !empty($t->plan) && empty($t->garn));
        $otherDed = round($sum($other, fn($t) => true) - $garn - $benEE, 2);
        // whatever the saved figures do not account for (rounding, an older stub's shape) keeps the entry balanced
        $residual = round($gross - ($fedEE + $stateEE) - ($garn + $benEE + $otherDed) - $net, 2);
        $name = (string) ($st->n ?? $uid);
        if ($in($pd)) {
            $wageAcct = $wtype !== 'w2' ? sysAcct('cogsc2c') : ($cons ? sysAcct('cogsw2') : sysAcct('wages'));
            $lines = [
                ['acct' => $wageAcct, 'dr' => $gross, 'cr' => 0, 'name' => $name],
                ['acct' => $cons ? sysAcct('cogstax') : sysAcct('ertax'), 'dr' => $fedER + $stateER, 'cr' => 0, 'name' => $name],
                ['acct' => $cons ? sysAcct('cogsben') : sysAcct('ben'), 'dr' => $benER, 'cr' => 0, 'name' => $name],
                ['acct' => sysAcct('netpay'), 'dr' => 0, 'cr' => $net, 'name' => $name],
                ['acct' => sysAcct('fedliab'), 'dr' => 0, 'cr' => $fedEE + $fedER, 'name' => $name],
                ['acct' => sysAcct('stateliab'), 'dr' => 0, 'cr' => $stateEE + $stateER, 'name' => $name],
                ['acct' => sysAcct('benliab'), 'dr' => 0, 'cr' => $benEE + $benER, 'name' => $name],
                ['acct' => sysAcct('garnliab'), 'dr' => 0, 'cr' => $garn, 'name' => $name],
            ];
            if ($otherDed != 0.0) {
                $lines[] = ['acct' => sysAcct('otherexp'), 'dr' => 0, 'cr' => $otherDed, 'name' => $name, 'memo' => 'Other deductions'];
            }
            if (abs($residual) >= 0.01) {
                $lines[] = ['acct' => sysAcct('otherexp'), 'dr' => $residual < 0 ? -$residual : 0, 'cr' => $residual > 0 ? $residual : 0, 'name' => $name, 'memo' => 'Paystub rounding'];
            }
            $out[] = je('payroll-' . $uid . '-' . $mk, $pd, 'payroll', $mk, 'Payroll ' . ((string) ($st->period ?? $mk)) . ' · ' . $name, $lines, ['link' => 'pay', 'linkId' => $uid . '/' . $mk, 'cur' => $cur]);
        }
        if ((string) ($st->st ?? '') === 'paid') {
            $paidOn = (string) ($st->paidOn ?? ($run->paidOn ?? $pd));
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $paidOn)) {
                $paidOn = $pd;
            }
            $runNet[$mk . '|' . $paidOn] = ($runNet[$mk . '|' . $paidOn] ?? 0) + $net;
        }
    }
    foreach ($runNet as $k => $net) {
        [$mk, $paidOn] = explode('|', $k);
        if (!$in($paidOn)) {
            continue;
        }
        $out[] = je('paynet-' . $mk . '-' . $paidOn, $paidOn, 'paynet', $mk, 'Net pay paid · ' . $mk, [
            ['acct' => sysAcct('netpay'), 'dr' => round($net, 2), 'cr' => 0],
            ['acct' => sysAcct('bank'), 'dr' => 0, 'cr' => round($net, 2)],
        ]);
    }
    // tax deposits
    foreach (colAll('org/acct/taxdep') as [$id, $x]) {
        $d = (string) ($x->d ?? '');
        if (!$in($d)) {
            continue;
        }
        $kind = (string) ($x->kind ?? 'other');
        $amt = round((float) ($x->a ?? 0), 2);
        $out[] = je('taxdep-' . $id, $d, 'taxdep', (string) ($x->conf ?? ''), 'Tax deposit ' . $kind . ' ' . (string) ($x->period ?? '') . ((string) ($x->state ?? '') !== '' ? ' ' . $x->state : ''), [
            ['acct' => in_array($kind, ['941', '940'], true) ? sysAcct('fedliab') : sysAcct('stateliab'), 'dr' => $amt, 'cr' => 0],
            ['acct' => sysAcct('bank'), 'dr' => 0, 'cr' => $amt],
        ]);
    }
    // categorized bank lines (money that is not an invoice payment or a bill payment)
    foreach (colAll('org/acct/bank') as [$id, $x]) {
        $dt = (string) ($x->dt ?? '');
        if (!$in($dt) || !empty($x->excl)) {
            continue;
        }
        $m = $x->m instanceof stdClass ? $x->m : null;
        $cat = (string) ($x->cat ?? '');
        if ($m && in_array((string) ($m->k ?? ''), ['inv', 'exp', 'payroll', 'taxdep'], true)) {
            continue; // already posted by the matched record
        }
        if ($cat === '') {
            continue; // uncategorized: shows up as "to review"
        }
        if (!isset(coaIndex()['byId'][$cat])) {
            $cat = sysAcct('otherexp'); // its account was removed from the chart: posts to Other expenses, as the Accounts page says
        }
        $amtN = booksFx(round((float) ($x->a ?? 0), 2), (string) ($x->cur ?? booksBase()));
        if ($amtN === null) {
            continue;
        }
        $amt = $amtN;
        $bank = bankAcct((string) ($x->acct ?? ''));
        $desc = (string) ($x->desc ?? '');
        $out[] = je('bank-' . $id, $dt, 'bank', (string) ($x->ref ?? ''), $desc, [
            ['acct' => $bank, 'dr' => $amt > 0 ? $amt : 0, 'cr' => $amt < 0 ? -$amt : 0, 'name' => (string) ($x->payee ?? '')],
            ['acct' => $cat, 'dr' => $amt < 0 ? -$amt : 0, 'cr' => $amt > 0 ? $amt : 0, 'name' => (string) ($x->payee ?? ''), 'memo' => $desc],
        ], ['link' => 'bank', 'linkId' => (string) $id]);
    }
    // manual journals
    foreach (colAll('org/acct/je', 'd', 'asc') as [$id, $x]) {
        $d = (string) ($x->d ?? '');
        if (!$in($d) || !empty($x->void)) {
            continue;
        }
        $lines = [];
        foreach ((array) ($x->lines ?? []) as $l) {
            if ($l instanceof stdClass) {
                $lines[] = ['acct' => (string) ($l->acct ?? ''), 'dr' => (float) ($l->dr ?? 0), 'cr' => (float) ($l->cr ?? 0), 'memo' => (string) ($l->memo ?? ''), 'name' => (string) ($l->name ?? '')];
            }
        }
        $out[] = je('je-' . $id, $d, 'je', (string) ($x->ref ?? ''), (string) ($x->memo ?? 'Journal entry'), $lines, ['link' => 'je', 'linkId' => (string) $id]);
    }
    usort($out, fn($a, $b) => strcmp($a['d'], $b['d']) ?: strcmp($a['id'], $b['id']));
    return $out;
}
/** Net balance per account over a set of entries: debit-positive for assets/expenses, credit-positive otherwise. */
function booksBalances(array $entries): array
{
    $bal = [];
    $idx = coaIndex()['byId'];
    foreach ($entries as $e) {
        foreach ($e['lines'] as $l) {
            $a = $l['acct'];
            $t = $idx[$a]['t'] ?? 'expense';
            $dn = in_array($t, ['asset', 'expense'], true);
            $bal[$a] = round(($bal[$a] ?? 0) + ($dn ? $l['dr'] - $l['cr'] : $l['cr'] - $l['dr']), 2);
        }
    }
    return $bal;
}
function fyStart(string $asOf): string
{
    $fy = booksSettings()['fy'];
    $y = (int) substr($asOf, 0, 4);
    $m = (int) substr($asOf, 5, 2);
    $startY = $m >= $fy ? $y : $y - 1;
    return sprintf('%04d-%02d-01', $startY, $fy);
}
function booksReport(string $kind, string $from, string $to, array $opt = []): array
{
    $coa = booksCoa();
    $idx = coaIndex()['byId'];
    $acctOut = fn(string $id) => ['id' => $id, 'n' => $idx[$id]['n'] ?? $id, 'num' => (string) ($idx[$id]['num'] ?? ''), 't' => $idx[$id]['t'] ?? '', 'sub' => (string) ($idx[$id]['sub'] ?? '')];
    if ($kind === 'tb') {
        $entries = booksEntries('', $to);
        $dr = [];
        $cr = [];
        foreach ($entries as $e) {
            if ($from !== '' && $e['d'] < $from) {
                // before the period: still part of balance-sheet accounts, income/expense roll into retained earnings
                foreach ($e['lines'] as $l) {
                    $t = $idx[$l['acct']]['t'] ?? 'expense';
                    $a = in_array($t, ['income', 'expense'], true) ? sysAcct('retained') : $l['acct'];
                    $dr[$a] = ($dr[$a] ?? 0) + $l['dr'];
                    $cr[$a] = ($cr[$a] ?? 0) + $l['cr'];
                }
                continue;
            }
            foreach ($e['lines'] as $l) {
                $dr[$l['acct']] = ($dr[$l['acct']] ?? 0) + $l['dr'];
                $cr[$l['acct']] = ($cr[$l['acct']] ?? 0) + $l['cr'];
            }
        }
        $rows = [];
        foreach ($coa as $a) {
            $d = round($dr[$a['id']] ?? 0, 2);
            $c = round($cr[$a['id']] ?? 0, 2);
            if ($d == 0.0 && $c == 0.0) {
                continue;
            }
            $net = round($d - $c, 2);
            $rows[] = $acctOut($a['id']) + ['dr' => $net > 0 ? $net : 0, 'cr' => $net < 0 ? -$net : 0, 'rawDr' => $d, 'rawCr' => $c];
        }
        return ['rows' => $rows, 'totalDr' => round(array_sum(array_column($rows, 'dr')), 2), 'totalCr' => round(array_sum(array_column($rows, 'cr')), 2)];
    }
    if ($kind === 'pl') {
        $entries = booksEntries($from, $to);
        $by = !empty($opt['byMonth']);
        $cols = [];
        $rows = [];
        foreach ($entries as $e) {
            $col = $by ? substr($e['d'], 0, 7) : 'total';
            $cols[$col] = true;
            foreach ($e['lines'] as $l) {
                $t = $idx[$l['acct']]['t'] ?? '';
                if (!in_array($t, ['income', 'expense'], true)) {
                    continue;
                }
                $v = $t === 'income' ? $l['cr'] - $l['dr'] : $l['dr'] - $l['cr'];
                if ($col !== 'total') { // without months the column is the total itself: add once, not twice
                    $rows[$l['acct']][$col] = round(($rows[$l['acct']][$col] ?? 0) + $v, 2);
                }
                $rows[$l['acct']]['total'] = round(($rows[$l['acct']]['total'] ?? 0) + $v, 2);
            }
        }
        ksort($cols);
        $sections = ['income' => [], 'cogs' => [], 'opex' => []];
        foreach ($coa as $a) {
            if (!isset($rows[$a['id']])) {
                continue;
            }
            $sec = $a['t'] === 'income' ? 'income' : (($a['sub'] ?? '') === 'cogs' ? 'cogs' : 'opex');
            $sections[$sec][] = $acctOut($a['id']) + ['v' => $rows[$a['id']]];
        }
        $tot = fn(array $list, string $col) => round(array_sum(array_map(fn($r) => (float) ($r['v'][$col] ?? 0), $list)), 2);
        $colKeys = array_keys($cols);
        if (!in_array('total', $colKeys, true)) {
            $colKeys[] = 'total';
        }
        $totals = [];
        foreach ($colKeys as $c) {
            $inc = $tot($sections['income'], $c);
            $cogs = $tot($sections['cogs'], $c);
            $opex = $tot($sections['opex'], $c);
            $totals[$c] = ['income' => $inc, 'cogs' => $cogs, 'gross' => round($inc - $cogs, 2), 'opex' => $opex, 'net' => round($inc - $cogs - $opex, 2)];
        }
        return ['cols' => $colKeys, 'sections' => $sections, 'totals' => $totals];
    }
    if ($kind === 'bs') {
        $asOf = $to !== '' ? $to : date('Y-m-d');
        $all = booksEntries('', $asOf);
        $bal = booksBalances($all);
        // retained earnings: all income and expense before the current fiscal year; current year net income shown separately
        $fy = fyStart($asOf);
        $prior = 0.0;
        $cur = 0.0;
        foreach ($all as $e) {
            foreach ($e['lines'] as $l) {
                $t = $idx[$l['acct']]['t'] ?? '';
                if ($t === 'income') {
                    $v = $l['cr'] - $l['dr'];
                } elseif ($t === 'expense') {
                    $v = -($l['dr'] - $l['cr']);
                } else {
                    continue;
                }
                if ($e['d'] < $fy) {
                    $prior += $v;
                } else {
                    $cur += $v;
                }
            }
        }
        $groups = ['asset' => [], 'liability' => [], 'equity' => []];
        foreach ($coa as $a) {
            if (!isset($groups[$a['t']])) {
                continue;
            }
            $v = round($bal[$a['id']] ?? 0, 2);
            if (($a['sys'] ?? '') === 'retained') {
                $v = round($v + $prior, 2);
            }
            if ($v == 0.0) {
                continue;
            }
            $groups[$a['t']][] = $acctOut($a['id']) + ['v' => $v];
        }
        $sumG = fn(array $g) => round(array_sum(array_column($g, 'v')), 2);
        $assets = $sumG($groups['asset']);
        $liab = $sumG($groups['liability']);
        $equity = $sumG($groups['equity']);
        if (!array_filter($groups['equity'], fn($r) => ($idx[$r['id']]['sys'] ?? '') === 'retained') && abs($prior) >= 0.005) {
            $groups['equity'][] = $acctOut(sysAcct('retained')) + ['v' => round($prior, 2)];
            $equity = round($equity + $prior, 2);
        }
        return ['asOf' => $asOf, 'fyStart' => $fy, 'groups' => $groups, 'assets' => $assets, 'liabilities' => $liab, 'equity' => $equity, 'netIncome' => round($cur, 2), 'total' => round($liab + $equity + $cur, 2), 'balanced' => abs($assets - ($liab + $equity + $cur)) < 0.05];
    }
    if ($kind === 'cf') {
        // direct method: movements through bank and credit-card accounts, grouped by what they touched
        $entries = booksEntries($from, $to);
        $cashIds = [];
        foreach ($coa as $a) {
            if (in_array((string) ($a['sub'] ?? ''), ['bank', 'cash', 'cc'], true)) {
                $cashIds[$a['id']] = true;
            }
        }
        $sections = ['operating' => [], 'investing' => [], 'financing' => []];
        $opening = 0.0;
        foreach (booksEntries('', $from !== '' ? date('Y-m-d', strtotime($from . ' -1 day')) : '') as $e) {
            foreach ($e['lines'] as $l) {
                if (isset($cashIds[$l['acct']])) {
                    $opening += ($idx[$l['acct']]['t'] === 'asset' ? 1 : -1) * ($l['dr'] - $l['cr']);
                }
            }
        }
        foreach ($entries as $e) {
            $cashMove = 0.0;
            foreach ($e['lines'] as $l) {
                if (isset($cashIds[$l['acct']])) {
                    $cashMove += ($idx[$l['acct']]['t'] === 'asset' ? 1 : -1) * ($l['dr'] - $l['cr']);
                }
            }
            if (abs($cashMove) < 0.005) {
                continue;
            }
            // the counter-accounts decide the section
            $label = $e['memo'];
            $sec = 'operating';
            $key = $e['src'];
            foreach ($e['lines'] as $l) {
                if (isset($cashIds[$l['acct']])) {
                    continue;
                }
                $sub = (string) ($idx[$l['acct']]['sub'] ?? '');
                $t = (string) ($idx[$l['acct']]['t'] ?? '');
                if ($sub === 'fixed') {
                    $sec = 'investing';
                } elseif ($t === 'equity' || $sub === 'longterm') {
                    $sec = 'financing';
                }
                $key = ['inv' => 'Invoice payments received', 'pay' => 'Invoice payments received', 'billpay' => 'Bills paid', 'paynet' => 'Payroll (net pay)', 'taxdep' => 'Payroll tax deposits', 'bank' => $idx[$l['acct']]['n'] ?? 'Other', 'je' => $idx[$l['acct']]['n'] ?? 'Journal', 'open' => 'Opening balances'][$e['src']] ?? ($idx[$l['acct']]['n'] ?? $e['src']);
            }
            $sections[$sec][$key] = round(($sections[$sec][$key] ?? 0) + $cashMove, 2);
        }
        $out = [];
        $net = 0.0;
        foreach ($sections as $k => $rows) {
            arsort($rows);
            $t = round(array_sum($rows), 2);
            $net += $t;
            $out[$k] = ['rows' => array_map(fn($n, $v) => ['n' => $n, 'v' => $v], array_keys($rows), $rows), 'total' => $t];
        }
        return ['sections' => $out, 'opening' => round($opening, 2), 'net' => round($net, 2), 'closing' => round($opening + $net, 2)];
    }
    if ($kind === 'ar' || $kind === 'ap') {
        $asOf = $to !== '' ? $to : date('Y-m-d');
        $rows = [];
        $buckets = ['current' => 0, 'b30' => 0, 'b60' => 0, 'b90' => 0, 'b90p' => 0];
        $bucketOf = function (string $due) use ($asOf): string {
            if ($due === '' || $due >= $asOf) {
                return 'current';
            }
            $days = (int) ((strtotime($asOf) - strtotime($due)) / 86400);
            return $days <= 30 ? 'b30' : ($days <= 60 ? 'b60' : ($days <= 90 ? 'b90' : 'b90p'));
        };
        if ($kind === 'ar') {
            foreach (colAll('inv') as [$id, $x]) {
                $st = (string) ($x->st ?? 'draft');
                if (in_array($st, ['draft', 'void', 'paid'], true) || (string) ($x->issue ?? '') > $asOf) {
                    continue;
                }
                $paid = 0.0;
                foreach ((array) ($x->pays ?? []) as $p) {
                    if ($p instanceof stdClass && (string) ($p->dt ?? '') <= $asOf) {
                        $paid += (float) ($p->a ?? 0);
                    }
                }
                $open = round((float) ($x->total ?? 0) - $paid, 2);
                if ($open <= 0) {
                    continue;
                }
                $who = (string) ($x->cn ?? ($x->bill->co ?? 'Client'));
                $b = $bucketOf((string) ($x->due ?? ''));
                $rows[$who] = $rows[$who] ?? ['n' => $who, 'current' => 0, 'b30' => 0, 'b60' => 0, 'b90' => 0, 'b90p' => 0, 'total' => 0, 'items' => []];
                $rows[$who][$b] = round($rows[$who][$b] + $open, 2);
                $rows[$who]['total'] = round($rows[$who]['total'] + $open, 2);
                $rows[$who]['items'][] = ['id' => (string) $id, 'num' => (string) ($x->num ?? $id), 'due' => (string) ($x->due ?? ''), 'open' => $open, 'bucket' => $b];
                $buckets[$b] = round($buckets[$b] + $open, 2);
            }
        } else {
            foreach (colAll('exp') as [$id, $x]) {
                if ((string) ($x->st ?? '') === 'paid' || (string) ($x->d ?? '') > $asOf) {
                    continue;
                }
                $open = round((float) ($x->a ?? 0), 2);
                if ($open <= 0) {
                    continue;
                }
                $who = (string) ($x->v ?? 'Vendor');
                $b = $bucketOf((string) ($x->due ?? ''));
                $rows[$who] = $rows[$who] ?? ['n' => $who, 'current' => 0, 'b30' => 0, 'b60' => 0, 'b90' => 0, 'b90p' => 0, 'total' => 0, 'items' => []];
                $rows[$who][$b] = round($rows[$who][$b] + $open, 2);
                $rows[$who]['total'] = round($rows[$who]['total'] + $open, 2);
                $rows[$who]['items'][] = ['id' => (string) $id, 'num' => (string) ($x->ref ?? ''), 'due' => (string) ($x->due ?? ''), 'open' => $open, 'bucket' => $b];
                $buckets[$b] = round($buckets[$b] + $open, 2);
            }
        }
        $list = array_values($rows);
        usort($list, fn($a, $b) => $b['total'] <=> $a['total']);
        return ['asOf' => $asOf, 'rows' => $list, 'buckets' => $buckets, 'total' => round(array_sum($buckets), 2)];
    }
    if ($kind === 'salestax') {
        $entries = booksEntries($from, $to);
        $tax = sysAcct('salestax');
        $byMonth = [];
        foreach ($entries as $e) {
            foreach ($e['lines'] as $l) {
                if ($l['acct'] !== $tax) {
                    continue;
                }
                $m = substr($e['d'], 0, 7);
                $byMonth[$m] = $byMonth[$m] ?? ['collected' => 0, 'remitted' => 0];
                $byMonth[$m]['collected'] = round($byMonth[$m]['collected'] + $l['cr'], 2);
                $byMonth[$m]['remitted'] = round($byMonth[$m]['remitted'] + $l['dr'], 2);
            }
        }
        ksort($byMonth);
        return ['rows' => array_map(fn($m, $v) => ['m' => $m] + $v, array_keys($byMonth), $byMonth)];
    }
    if ($kind === 'gl') {
        $entries = booksEntries($from, $to);
        if (booksNoPay()) {
            $entries = booksPayrollRollup($entries); // v83: no per-person pay lines for a bookkeeper kept out of payroll
        }
        $acct = (string) ($opt['acct'] ?? '');
        $rows = [];
        $run = 0.0;
        if ($acct !== '') {
            // the account's register with a running balance, starting from its balance before the period
            foreach (booksEntries('', $from !== '' ? date('Y-m-d', strtotime($from . ' -1 day')) : '') as $e) {
                foreach ($e['lines'] as $l) {
                    if ($l['acct'] === $acct) {
                        $run += in_array($idx[$acct]['t'] ?? '', ['asset', 'expense'], true) ? $l['dr'] - $l['cr'] : $l['cr'] - $l['dr'];
                    }
                }
            }
        }
        $opening = round($run, 2);
        foreach ($entries as $e) {
            foreach ($e['lines'] as $l) {
                if ($acct !== '' && $l['acct'] !== $acct) {
                    continue;
                }
                if ($acct !== '') {
                    $run += in_array($idx[$acct]['t'] ?? '', ['asset', 'expense'], true) ? $l['dr'] - $l['cr'] : $l['cr'] - $l['dr'];
                }
                $rows[] = ['d' => $e['d'], 'je' => $e['id'], 'src' => $e['src'], 'ref' => $e['ref'], 'memo' => $l['memo'] !== '' ? $l['memo'] : $e['memo'], 'name' => $l['name'], 'acct' => $l['acct'], 'an' => $idx[$l['acct']]['n'] ?? $l['acct'], 'num' => (string) ($idx[$l['acct']]['num'] ?? ''), 'dr' => $l['dr'], 'cr' => $l['cr'], 'bal' => $acct !== '' ? round($run, 2) : null, 'link' => $e['link'] ?? '', 'linkId' => $e['linkId'] ?? ''];
            }
        }
        if (count($rows) > 5000) {
            $rows = array_slice($rows, -5000);
        }
        return ['rows' => $rows, 'opening' => $opening, 'closing' => round($run, 2)];
    }
    fail(400, 'invalid_argument', 'Unknown report.');
}
/** Bank lines still to review: not matched, not categorized, not excluded. Suggestions come from open invoices and bills. */
function booksSuggest(stdClass $line): array
{
    $amt = round((float) ($line->a ?? 0), 2);
    $dt = (string) ($line->dt ?? '');
    $desc = mb_strtolower((string) ($line->desc ?? ''));
    $out = [];
    $near = fn(string $d2) => $d2 !== '' && $dt !== '' && abs((strtotime($dt) - strtotime($d2)) / 86400) <= 45;
    if ($amt > 0) {
        foreach (colAll('inv') as [$id, $x]) {
            $st = (string) ($x->st ?? '');
            if (!in_array($st, ['sent', 'viewed', 'part'], true)) {
                continue;
            }
            $open = round((float) ($x->total ?? 0) - (float) ($x->paid ?? 0), 2);
            $num = mb_strtolower((string) ($x->num ?? ''));
            $score = 0;
            if (abs($open - $amt) < 0.01) {
                $score += 60;
            } elseif ($open > $amt && $amt > 0) {
                $score += 10;
            }
            if ($num !== '' && str_contains($desc, $num)) {
                $score += 50;
            }
            if ($near((string) ($x->issue ?? ''))) {
                $score += 10;
            }
            $cn = mb_strtolower((string) ($x->cn ?? ''));
            if ($cn !== '' && str_contains($desc, explode(' ', $cn)[0])) {
                $score += 20;
            }
            if ($score >= 30) {
                $out[] = ['k' => 'inv', 'id' => (string) $id, 'n' => (string) ($x->num ?? $id), 'who' => (string) ($x->cn ?? ''), 'open' => $open, 'score' => $score];
            }
        }
    } else {
        foreach (colAll('exp') as [$id, $x]) {
            if ((string) ($x->st ?? '') === 'paid') {
                continue;
            }
            $a = round((float) ($x->a ?? 0), 2);
            $v = mb_strtolower((string) ($x->v ?? ''));
            $score = 0;
            if (abs($a + $amt) < 0.01) {
                $score += 60;
            }
            if ($v !== '' && str_contains($desc, explode(' ', $v)[0])) {
                $score += 30;
            }
            if ($near((string) ($x->due ?? ($x->d ?? '')))) {
                $score += 10;
            }
            if ($score >= 30) {
                $out[] = ['k' => 'exp', 'id' => (string) $id, 'n' => (string) ($x->v ?? ''), 'who' => (string) ($x->cat ?? ''), 'open' => $a, 'score' => $score];
            }
        }
        // a payroll run's net pay or a tax deposit of the same amount
        foreach (colAll('org/acct/runs') as [$mk, $r]) {
            $tot = (array) ($r->totals ?? []);
            foreach ($tot as $cur => $t) {
                if ($t instanceof stdClass && abs((float) ($t->net ?? 0) + $amt) < 0.01) {
                    $out[] = ['k' => 'payroll', 'id' => (string) $mk, 'n' => 'Payroll ' . $mk . ' net pay', 'who' => '', 'open' => (float) $t->net, 'score' => 70];
                }
            }
        }
    }
    usort($out, fn($a, $b) => $b['score'] <=> $a['score']);
    return array_slice($out, 0, 5);
}
/** Rules: the first rule whose text appears in the description sets the category (and payee). */
function booksApplyRules(stdClass $line, array $rules): ?array
{
    $desc = mb_strtolower((string) ($line->desc ?? ''));
    foreach ($rules as $r) {
        if (!($r instanceof stdClass)) {
            continue;
        }
        $m = mb_strtolower(trim((string) ($r->match ?? '')));
        if ($m === '' || !str_contains($desc, $m)) {
            continue;
        }
        $dir = (string) ($r->dir ?? 'any');
        $amt = (float) ($line->a ?? 0);
        if (($dir === 'in' && $amt < 0) || ($dir === 'out' && $amt > 0)) {
            continue;
        }
        return ['cat' => (string) ($r->acct ?? ''), 'payee' => (string) ($r->payee ?? ''), 'rule' => (string) ($r->id ?? '')];
    }
    return null;
}
/** The bank feed's own category (Plaid) as a suggestion, when an account of that name exists in the chart. */
function booksHint(stdClass $line): ?array
{
    $hint = mb_strtolower(trim((string) ($line->hint ?? '')));
    if ($hint === '' || $hint === 'transfer') {
        return null;
    }
    $id = coaIndex()['byName'][$hint] ?? null;
    if ($id === null) {
        return null;
    }
    $a = coaIndex()['byId'][$id];
    if (isset($a['active']) && $a['active'] === false) {
        return null;
    }
    return ['cat' => (string) $id, 'payee' => (string) ($line->payee ?? ''), 'rule' => 'bank-category'];
}

function booksRoute(string $r, string $method, array $b): never
{
    switch ($r) {
        case 'books_overview':
            booksStaff();
            $today = date('Y-m-d');
            $fy = fyStart($today);
            $bs = booksReport('bs', '', $today);
            $pl = booksReport('pl', $fy, $today, ['byMonth' => true]);
            $ar = booksReport('ar', '', $today);
            $ap = booksReport('ap', '', $today);
            $review = 0;
            foreach (colAll('org/acct/bank') as [, $x]) {
                if (empty($x->m) && (string) ($x->cat ?? '') === '' && empty($x->excl)) {
                    $review++;
                }
            }
            $cash = 0.0;
            foreach ($bs['groups']['asset'] as $a) {
                if (in_array($a['sub'], ['bank', 'cash'], true)) {
                    $cash += $a['v'];
                }
            }
            ok(['cash' => round($cash, 2), 'ar' => $ar['total'], 'ap' => $ap['total'], 'review' => $review, 'pl' => $pl, 'bs' => $bs, 'cfg' => booksCfg(), 'coa' => booksCoa(), 'skipped' => $GLOBALS['booksSkipped'] ?? []]);
        case 'books_report':
            booksStaff();
            $kind = str($b, 'kind', 12);
            $from = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($b['from'] ?? '')) ? (string) $b['from'] : '';
            $to = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($b['to'] ?? '')) ? (string) $b['to'] : '';
            ok(booksReport($kind, $from, $to, ['byMonth' => !empty($b['byMonth']), 'acct' => str($b, 'acct', 60)]) + ['from' => $from, 'to' => $to]);
        case 'books_coa':
            booksStaff();
            ok(['items' => booksCoa(), 'cfg' => booksCfg()]);
        case 'books_coa_save':
            $u = booksStaff(true);
            $in = is_array($b['items'] ?? null) ? $b['items'] : [];
            $items = [];
            $seen = [];
            foreach ($in as $it) {
                if (!is_array($it)) {
                    continue;
                }
                $id = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($it['id'] ?? '')) ?: ('a' . rid(6));
                $n = mb_substr(trim((string) ($it['n'] ?? '')), 0, 80);
                if ($n === '' || isset($seen[$id])) {
                    continue;
                }
                $seen[$id] = true;
                $t = in_array((string) ($it['t'] ?? ''), BOOKS_TYPES, true) ? (string) $it['t'] : 'expense';
                $items[] = (object) [
                    'id' => $id,
                    'n' => $n,
                    't' => $t,
                    'sub' => mb_substr(preg_replace('/[^a-z]/', '', (string) ($it['sub'] ?? '')) ?? '', 0, 12) ?: ($t === 'income' ? 'income' : ($t === 'expense' ? 'opex' : $t)),
                    'num' => mb_substr(preg_replace('/[^0-9]/', '', (string) ($it['num'] ?? '')) ?? '', 0, 6),
                    'open' => round((float) ($it['open'] ?? 0), 2),
                    'openDate' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($it['openDate'] ?? '')) ? (string) $it['openDate'] : '',
                    'sys' => isset(BOOKS_SYS[(string) ($it['sys'] ?? '')]) ? (string) $it['sys'] : '',
                    'active' => !isset($it['active']) || !empty($it['active']),
                ];
            }
            // v83: an opening balance posts at its date; one in a closed period (old or new date) cannot change. Names,
            // numbers, new accounts and opening balances dated after the close stay editable.
            $close = booksSettings()['close'];
            if ($close !== '') {
                $start = booksCfg()['start'] ?: '2000-01-01';
                $eff = fn(array $a): string => round((float) ($a['open'] ?? 0), 2) == 0.0 ? '' : (preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($a['openDate'] ?? '')) ? (string) $a['openDate'] : $start);
                $key = fn(array $a): string => $eff($a) === '' ? '' : json_encode([round((float) ($a['open'] ?? 0), 2), $eff($a), (string) ($a['t'] ?? '')]);
                $old = [];
                foreach (booksCoa(false) as $a) {
                    $old[(string) $a['id']] = $a;
                }
                $new = [];
                foreach ($items as $it) {
                    $new[(string) $it->id] = (array) $it;
                }
                foreach (array_unique(array_merge(array_map('strval', array_keys($old)), array_map('strval', array_keys($new)))) as $aid) {
                    $o = $old[$aid] ?? [];
                    $nw = $new[$aid] ?? [];
                    if ($key($o) === $key($nw)) {
                        continue;
                    }
                    foreach ([$eff($o), $eff($nw)] as $od) {
                        if ($od !== '' && $od <= $close) {
                            booksGuard('org/acct/x/coa', (object) ['d' => $od]);
                        }
                    }
                }
            }
            $doc = docGet('org/acct/x/coa') ?? new stdClass();
            $doc->items = $items;
            $doc->u = now();
            docSet('org/acct/x/coa', $doc);
            auditLog('coa', 'org/acct/x/coa', 'Chart of accounts saved', ['n' => count($items)], $u);
            ok(['items' => array_map(fn($x) => (array) $x, $items)]);
        case 'books_settings_save':
            $u = booksStaff(true);
            $doc = docGet('org/acct/x/books') ?? new stdClass();
            foreach (['catMap', 'bankMap', 'methodMap'] as $k) {
                if (isset($b[$k]) && is_array($b[$k])) {
                    $clean = [];
                    foreach ($b[$k] as $name => $acct) {
                        $name = mb_substr(trim((string) $name), 0, 80);
                        $acct = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) $acct) ?? '';
                        if ($name !== '' && $acct !== '') {
                            $clean[$name] = $acct;
                        }
                    }
                    $doc->$k = (object) $clean;
                }
            }
            if (isset($b['fy'])) {
                $doc->fy = max(1, min(12, (int) $b['fy']));
            }
            if (isset($b['rates']) && is_array($b['rates'])) {
                $rates = [];
                foreach ($b['rates'] as $cur => $v) {
                    $cur = strtoupper(preg_replace('/[^A-Za-z]/', '', (string) $cur) ?? '');
                    if (strlen($cur) === 3 && (float) $v > 0) {
                        $rates[$cur] = round((float) $v, 6);
                    }
                }
                $doc->rates = (object) $rates;
            }
            if (isset($b['start'])) {
                $doc->start = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $b['start']) ? (string) $b['start'] : '';
            }
            $doc->u = now();
            docSet('org/acct/x/books', $doc);
            auditLog('books', 'settings', 'Books settings changed', [], $u);
            ok(booksCfg());
        case 'books_close':
            // closing the books is an administrator's decision
            $u = requireAdmin();
            if (!hasRole($u, 'admin')) {
                fail(403, 'forbidden', 'Only an administrator closes or reopens the books.');
            }
            $date = (string) ($b['date'] ?? '');
            $doc = docGet('org/acct/x/books') ?? new stdClass();
            if ($date === '') {
                $doc->close = '';
                $doc->closedBy = '';
                $doc->closedAt = 0;
                auditLog('books', 'close', 'Books reopened', [], $u);
            } else {
                if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
                    fail(400, 'invalid_argument', 'Bad date.');
                }
                $doc->close = $date;
                $doc->closedBy = (string) $u['name'];
                $doc->closedAt = now();
                auditLog('books', 'close', 'Books closed through ' . $date, [], $u);
            }
            $doc->u = now();
            docSet('org/acct/x/books', $doc);
            ok(['close' => (string) ($doc->close ?? ''), 'closedBy' => (string) ($doc->closedBy ?? ''), 'closedAt' => (int) ($doc->closedAt ?? 0)]);
        case 'books_je_save':
            $u = booksStaff(true);
            $id = preg_replace('/[^a-z0-9]/', '', (string) ($b['id'] ?? '')) ?: rid(10);
            $d = (string) ($b['d'] ?? '');
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) {
                fail(400, 'invalid_argument', 'Give the entry a date.');
            }
            $idx = coaIndex()['byId'];
            $lines = [];
            $dr = 0.0;
            $cr = 0.0;
            foreach ((array) ($b['lines'] ?? []) as $l) {
                if (!is_array($l) || !isset($idx[(string) ($l['acct'] ?? '')])) {
                    continue;
                }
                $ld = round((float) ($l['dr'] ?? 0), 2);
                $lc = round((float) ($l['cr'] ?? 0), 2);
                if ($ld <= 0 && $lc <= 0) {
                    continue;
                }
                $lines[] = (object) ['acct' => (string) $l['acct'], 'dr' => max(0, $ld), 'cr' => max(0, $lc), 'memo' => mb_substr((string) ($l['memo'] ?? ''), 0, 200), 'name' => mb_substr((string) ($l['name'] ?? ''), 0, 120)];
                $dr += max(0, $ld);
                $cr += max(0, $lc);
            }
            if (count($lines) < 2 || abs($dr - $cr) >= 0.005) {
                fail(400, 'invalid_argument', 'A journal entry needs at least two lines and debits must equal credits (debits ' . number_format($dr, 2) . ', credits ' . number_format($cr, 2) . ').');
            }
            $prev = docGet('org/acct/je/' . $id);
            $doc = (object) ['d' => $d, 'memo' => mb_substr(trim((string) ($b['memo'] ?? '')), 0, 200), 'ref' => mb_substr(trim((string) ($b['ref'] ?? '')), 0, 60), 'lines' => $lines, 'void' => !empty($b['void']), 'by' => $prev->by ?? $u['id'], 'byn' => $prev->byn ?? (string) $u['name'], 'at' => $prev->at ?? now(), 'u' => now()];
            booksGuard('org/acct/je/' . $id, $doc);
            docSet('org/acct/je/' . $id, $doc);
            auditLog('je', $id, $prev ? 'Journal entry changed' : 'Journal entry added', ['d' => $d, 'total' => round($dr, 2), 'memo' => $doc->memo], $u);
            ok(['id' => $id]);
        case 'books_je_list':
            booksStaff();
            $rows = [];
            foreach (colAll('org/acct/je', 'd', 'desc') as [$id, $x]) {
                $rows[] = ['id' => (string) $id] + (array) $x;
            }
            ok(['rows' => array_slice($rows, 0, 500)]);
        case 'books_review':
            // bank lines to review, with suggestions and rules applied
            booksStaff();
            $acct = str($b, 'acct', 80);
            $only = str($b, 'only', 12); // review | done | all
            $rules = (array) (docGet('org/acct/x/rules')->items ?? []);
            $rows = [];
            foreach (colAll('org/acct/bank', 'dt', 'desc') as [$id, $x]) {
                if ($acct !== '' && (string) ($x->acct ?? '') !== $acct) {
                    continue;
                }
                $done = !empty($x->m) || (string) ($x->cat ?? '') !== '' || !empty($x->excl);
                if (($only === 'review' && $done) || ($only === 'done' && !$done)) {
                    continue;
                }
                $row = ['id' => (string) $id] + (array) $x;
                if (!$done) {
                    $row['suggest'] = booksSuggest($x);
                    $row['rule'] = booksApplyRules($x, $rules) ?? booksHint($x);
                }
                $rows[] = $row;
                if (count($rows) >= 400) {
                    break;
                }
            }
            $accts = [];
            foreach (colAll('org/acct/bank') as [, $x]) {
                $a = (string) ($x->acct ?? '');
                $accts[$a] = ($accts[$a] ?? 0) + 1;
            }
            ok(['rows' => $rows, 'accts' => $accts, 'coa' => booksCoa(), 'cfg' => booksCfg()]);
        case 'books_line':
            // categorize / match / exclude one bank line
            $u = booksStaff(true);
            $id = preg_replace('/[^a-z0-9]/', '', (string) ($b['id'] ?? ''));
            $x = $id !== '' ? docGet('org/acct/bank/' . $id) : null;
            if (!$x) {
                fail(404, 'not_found', 'That bank line is gone.');
            }
            booksGuard('org/acct/bank/' . $id, $x);
            $act = str($b, 'act', 12);
            $now = now();
            // v83: finished reconciliations lock their lines; a reconciled line not reviewed yet can still be categorized
            // or matched once
            $done = !empty($x->m) || (string) ($x->cat ?? '') !== '' || !empty($x->excl);
            if (!empty($x->recon) && ($done || $act === 'excl')) {
                fail(423, 'reconciled', 'This line is part of a finished reconciliation, so it stays as it was reconciled.');
            }
            // v83: a line matched to an invoice or bill is matched once; undo, exclude or categorize first take back the
            // payment the match recorded (otherwise the deposit was counted twice)
            $wasK = ($x->m ?? null) instanceof stdClass ? (string) ($x->m->k ?? '') : '';
            if (in_array($wasK, ['inv', 'exp'], true)) {
                if ($act === 'match') {
                    fail(409, 'conflict', 'This line is already matched. Undo the match first.');
                }
                if (in_array($act, ['cat', 'excl', 'undo'], true)) {
                    booksUnmatch($id, $x);
                }
            }
            if ($act === 'cat') {
                $cat = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($b['cat'] ?? '')) ?? '';
                if (!isset(coaIndex()['byId'][$cat])) {
                    fail(400, 'invalid_argument', 'Pick an account.');
                }
                $x->cat = $cat;
                $x->payee = mb_substr(trim((string) ($b['payee'] ?? ($x->payee ?? ''))), 0, 120);
                $x->m = null;
                $x->excl = false;
                if (!empty($b['remember']) && trim((string) ($b['match'] ?? '')) !== '') {
                    $rd = docGet('org/acct/x/rules') ?? new stdClass();
                    $items = (array) ($rd->items ?? []);
                    $items[] = (object) ['id' => rid(6), 'match' => mb_substr(trim((string) $b['match']), 0, 80), 'acct' => $cat, 'payee' => $x->payee, 'dir' => (float) ($x->a ?? 0) < 0 ? 'out' : 'in', 'at' => $now];
                    $rd->items = array_values($items);
                    $rd->u = $now;
                    docSet('org/acct/x/rules', $rd);
                }
            } elseif ($act === 'match') {
                $k = str($b, 'k', 10);
                $mid = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($b['mid'] ?? '')) ?? '';
                if ($k === 'inv') {
                    $inv = docGet('inv/' . $mid);
                    if (!$inv) {
                        fail(404, 'not_found', 'Invoice not found.');
                    }
                    $amt = round((float) ($x->a ?? 0), 2);
                    if ($amt <= 0 || in_array((string) ($inv->st ?? 'draft'), ['draft', 'void', 'paid'], true)) {
                        fail(400, 'invalid_argument', 'Only money coming in can be matched, to an invoice that has been sent, is not paid yet and is not voided.');
                    }
                    $paid = round((float) ($inv->paid ?? 0) + $amt, 2);
                    $st = $paid >= (float) ($inv->total ?? 0) - 0.005 ? 'paid' : 'part';
                    $pays = (array) ($inv->pays ?? []);
                    $pays[] = (object) ['a' => $amt, 'dt' => (string) ($x->dt ?? date('Y-m-d')), 'm' => 'Bank transfer', 'ref' => (string) ($x->ref ?? 'bank feed'), 'at' => $now, 'bank' => $id];
                    $inv->pays = array_values($pays);
                    $inv->paid = $paid;
                    $inv->st = $st;
                    $inv->u = $now;
                    docSet('inv/' . $mid, $inv);
                    if (!empty($inv->cid) && (string) ($inv->st ?? '') !== 'draft') {
                        try {
                            $pub = docGet('pub/' . $inv->cid . '/inv/' . $mid);
                            if ($pub) {
                                $pub->paid = $paid;
                                $pub->st = $st;
                                $pub->u = $now;
                                docSet('pub/' . $inv->cid . '/inv/' . $mid, $pub);
                            }
                        } catch (Throwable $e) {
                            // the client copy follows when it can
                        }
                    }
                    $x->m = (object) ['k' => 'inv', 'id' => $mid, 'n' => (string) ($inv->num ?? $mid), 'at' => $now];
                } elseif ($k === 'exp') {
                    $exp = docGet('exp/' . $mid);
                    if (!$exp) {
                        fail(404, 'not_found', 'Bill not found.');
                    }
                    if ((float) ($x->a ?? 0) >= 0 || (string) ($exp->st ?? '') === 'paid') {
                        fail(400, 'invalid_argument', 'Only money going out can be matched, to a bill that is not paid yet.');
                    }
                    $exp->st = 'paid';
                    $exp->paidOn = (string) ($x->dt ?? date('Y-m-d'));
                    $exp->paidAt = $now;
                    $exp->m = 'Bank transfer';
                    $exp->u = $now;
                    docSet('exp/' . $mid, $exp);
                    $x->m = (object) ['k' => 'exp', 'id' => $mid, 'n' => (string) ($exp->v ?? ''), 'at' => $now];
                } elseif ($k === 'payroll') {
                    $x->m = (object) ['k' => 'payroll', 'id' => $mid, 'n' => 'Payroll ' . $mid, 'at' => $now];
                } elseif ($k === 'transfer') {
                    $to = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($b['to'] ?? '')) ?? '';
                    if (!isset(coaIndex()['byId'][$to])) {
                        fail(400, 'invalid_argument', 'Pick the other account.');
                    }
                    $x->cat = $to;
                    $x->m = null;
                } else {
                    fail(400, 'invalid_argument', 'Unknown match.');
                }
                $x->excl = false;
            } elseif ($act === 'excl') {
                $x->excl = true;
                $x->m = null;
                $x->cat = '';
            } elseif ($act === 'undo') {
                $x->excl = false;
                $x->cat = '';
                $x->m = null;
            } else {
                fail(400, 'invalid_argument', 'Unknown action.');
            }
            $x->u = $now;
            $x->rb = $u['id'];
            docSet('org/acct/bank/' . $id, $x);
            auditLog('bank', $id, 'Bank line ' . $act, ['desc' => mb_substr((string) ($x->desc ?? ''), 0, 60), 'a' => (float) ($x->a ?? 0), 'cat' => (string) ($x->cat ?? ''), 'm' => $x->m ? (array) $x->m : null], $u);
            ok(['row' => ['id' => $id] + (array) $x]);
        case 'books_rules_apply':
            $u = booksStaff(true);
            $rules = (array) (docGet('org/acct/x/rules')->items ?? []);
            $n = 0;
            $close = booksSettings()['close'];
            foreach (colAll('org/acct/bank') as [$id, $x]) {
                if (!empty($x->m) || (string) ($x->cat ?? '') !== '' || !empty($x->excl)) {
                    continue;
                }
                $dt = (string) ($x->dt ?? '');
                if ($close !== '' && $dt !== '' && $dt <= $close) {
                    continue; // v83: a line in a closed period is not categorized (it would post into the closed books)
                }
                $hit = booksApplyRules($x, $rules);
                if ($hit && isset(coaIndex()['byId'][$hit['cat']])) {
                    $x->cat = $hit['cat'];
                    if ($hit['payee'] !== '') {
                        $x->payee = $hit['payee'];
                    }
                    $x->rule = $hit['rule'];
                    $x->u = now();
                    docSet('org/acct/bank/' . $id, $x);
                    $n++;
                }
            }
            auditLog('bank', 'rules', 'Rules applied', ['n' => $n], $u);
            ok(['applied' => $n]);
        case 'books_rules':
            booksStaff();
            ok(['items' => array_values((array) (docGet('org/acct/x/rules')->items ?? []))]);
        case 'books_rules_save':
            $u = booksStaff(true);
            $items = [];
            foreach ((array) ($b['items'] ?? []) as $it) {
                if (!is_array($it) || trim((string) ($it['match'] ?? '')) === '') {
                    continue;
                }
                $items[] = (object) ['id' => preg_replace('/[^a-z0-9]/', '', (string) ($it['id'] ?? '')) ?: rid(6), 'match' => mb_substr(trim((string) $it['match']), 0, 80), 'acct' => preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($it['acct'] ?? '')), 'payee' => mb_substr(trim((string) ($it['payee'] ?? '')), 0, 120), 'dir' => in_array((string) ($it['dir'] ?? ''), ['in', 'out'], true) ? (string) $it['dir'] : 'any'];
            }
            $rd = docGet('org/acct/x/rules') ?? new stdClass();
            $rd->items = $items;
            $rd->u = now();
            docSet('org/acct/x/rules', $rd);
            ok(['items' => array_map(fn($x) => (array) $x, $items)]);
        case 'books_recon':
            // the state of a reconciliation: uncleared lines up to the statement date, the last finished one
            booksStaff();
            $acct = str($b, 'acct', 80);
            $end = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($b['end'] ?? '')) ? (string) $b['end'] : date('Y-m-d');
            $last = null;
            foreach (colAll('org/acct/recon', 'end', 'desc') as [$id, $x]) {
                if ((string) ($x->acct ?? '') === $acct) {
                    $last = ['id' => (string) $id] + (array) $x;
                    break;
                }
            }
            $rows = [];
            foreach (colAll('org/acct/bank', 'dt', 'asc') as [$id, $x]) {
                if ((string) ($x->acct ?? '') !== $acct || !empty($x->recon) || (string) ($x->dt ?? '') > $end || !empty($x->excl)) {
                    continue;
                }
                $rows[] = ['id' => (string) $id, 'dt' => (string) ($x->dt ?? ''), 'desc' => (string) ($x->desc ?? ''), 'a' => (float) ($x->a ?? 0), 'clr' => !empty($x->clr), 'done' => !empty($x->m) || (string) ($x->cat ?? '') !== ''];
            }
            ok(['rows' => $rows, 'last' => $last, 'opening' => $last ? (float) ($last['endBal'] ?? 0) : 0.0]);
        case 'books_recon_clear':
            $u = booksStaff(true);
            $ids = array_slice(array_filter(array_map(fn($x) => preg_replace('/[^a-z0-9]/', '', (string) $x), (array) ($b['ids'] ?? []))), 0, 500);
            $clr = !empty($b['clr']);
            foreach ($ids as $id) {
                $x = docGet('org/acct/bank/' . $id);
                if ($x && empty($x->recon)) {
                    $x->clr = $clr;
                    docSet('org/acct/bank/' . $id, $x);
                }
            }
            ok(['n' => count($ids)]);
        case 'books_recon_finish':
            $u = booksStaff(true);
            $acct = str($b, 'acct', 80);
            $end = (string) ($b['end'] ?? '');
            $endBal = round((float) ($b['endBal'] ?? 0), 2);
            if ($acct === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $end)) {
                fail(400, 'invalid_argument', 'Account and statement date are needed.');
            }
            $opening = 0.0;
            foreach (colAll('org/acct/recon', 'end', 'desc') as [, $x]) {
                if ((string) ($x->acct ?? '') === $acct) {
                    $opening = (float) ($x->endBal ?? 0);
                    break;
                }
            }
            $cleared = 0.0;
            $ids = [];
            foreach (colAll('org/acct/bank') as [$id, $x]) {
                if ((string) ($x->acct ?? '') === $acct && !empty($x->clr) && empty($x->recon) && (string) ($x->dt ?? '') <= $end && empty($x->excl)) {
                    $cleared += (float) ($x->a ?? 0);
                    $ids[] = (string) $id;
                }
            }
            $diff = round($endBal - ($opening + $cleared), 2);
            if (abs($diff) >= 0.005 && empty($b['force'])) {
                fail(400, 'invalid_argument', 'The difference is ' . number_format($diff, 2) . '. Clear or add the missing lines, or finish anyway to record an adjustment.');
            }
            $rid = rid(10);
            $now = now();
            if (abs($diff) >= 0.005) {
                booksGuard('org/acct/je/' . $rid, (object) ['d' => $end]); // v83: the adjusting entry is dated at the statement end; closed periods stay closed
            }
            foreach ($ids as $id) {
                $x = docGet('org/acct/bank/' . $id);
                if ($x) {
                    $x->recon = $rid;
                    $x->clr = true;
                    docSet('org/acct/bank/' . $id, $x);
                }
            }
            if (abs($diff) >= 0.005) {
                // an adjusting entry to the bank's ledger account against other expenses / income
                $bank = bankAcct($acct);
                docSet('org/acct/je/' . $rid, (object) ['d' => $end, 'memo' => 'Reconciliation adjustment · ' . $acct, 'ref' => 'RECON', 'lines' => [(object) ['acct' => $bank, 'dr' => $diff > 0 ? $diff : 0, 'cr' => $diff < 0 ? -$diff : 0, 'memo' => 'Statement difference'], (object) ['acct' => sysAcct($diff > 0 ? 'inc' : 'bankfees'), 'dr' => $diff < 0 ? -$diff : 0, 'cr' => $diff > 0 ? $diff : 0, 'memo' => 'Statement difference']], 'by' => $u['id'], 'byn' => (string) $u['name'], 'at' => $now, 'u' => $now]);
            }
            docSet('org/acct/recon/' . $rid, (object) ['acct' => $acct, 'end' => $end, 'endBal' => $endBal, 'opening' => round($opening, 2), 'cleared' => round($cleared, 2), 'diff' => $diff, 'n' => count($ids), 'by' => $u['id'], 'byn' => (string) $u['name'], 'at' => $now]);
            auditLog('recon', $rid, 'Reconciliation finished · ' . $acct . ' through ' . $end, ['endBal' => $endBal, 'n' => count($ids), 'diff' => $diff], $u);
            ok(['id' => $rid, 'n' => count($ids), 'diff' => $diff]);
        case 'books_recon_list':
            booksStaff();
            $rows = [];
            foreach (colAll('org/acct/recon', 'end', 'desc') as [$id, $x]) {
                $rows[] = ['id' => (string) $id] + (array) $x;
            }
            ok(['rows' => array_slice($rows, 0, 200)]);
        case 'books_audit':
            booksStaff();
            $q = mb_strtolower(str($b, 'q', 80));
            $kind = str($b, 'kind', 20);
            $rows = [];
            foreach (colAll('org/acct/audit', 't', 'desc') as [$id, $x]) {
                if ($kind !== '' && (string) ($x->kind ?? '') !== $kind) {
                    continue;
                }
                if ($q !== '' && !str_contains(mb_strtolower(json_encode($x, JSON_UNESCAPED_UNICODE) ?: ''), $q)) {
                    continue;
                }
                $rows[] = ['id' => (string) $id] + (array) $x;
                if (count($rows) >= 300) {
                    break;
                }
            }
            ok(['rows' => $rows]);
        case 'books_export':
            booksStaff();
            $kind = str($b, 'kind', 12);
            $from = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($b['from'] ?? '')) ? (string) $b['from'] : '';
            $to = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($b['to'] ?? '')) ? (string) $b['to'] : '';
            $idx = coaIndex()['byId'];
            $name = 'export';
            $lines = [];
            if ($kind === 'gl') {
                $name = 'general-ledger';
                $lines[] = csvLine(['Date', 'Entry', 'Source', 'Reference', 'Memo', 'Account number', 'Account', 'Name', 'Debit', 'Credit']);
                foreach (booksNoPay() ? booksPayrollRollup(booksEntries($from, $to)) : booksEntries($from, $to) as $e) {
                    foreach ($e['lines'] as $l) {
                        $lines[] = csvLine([$e['d'], $e['id'], $e['src'], $e['ref'], $l['memo'] !== '' ? $l['memo'] : $e['memo'], $idx[$l['acct']]['num'] ?? '', $idx[$l['acct']]['n'] ?? $l['acct'], $l['name'], $l['dr'] ?: '', $l['cr'] ?: '']);
                    }
                }
            } elseif ($kind === 'iif') {
                // QuickBooks Desktop general journal import
                $name = 'general-journal';
                $out = ["!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO", "!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO", "!ENDTRNS"];
                // v83: tabs and line breaks in any text field would add columns or TRNS/SPL rows to the import
                $t = fn($v) => preg_replace('/[\t\r\n]+/', ' ', (string) $v);
                $n = 0;
                foreach (booksNoPay() ? booksPayrollRollup(booksEntries($from, $to)) : booksEntries($from, $to) as $e) {
                    $first = true;
                    $date = date('m/d/Y', strtotime($e['d']));
                    foreach ($e['lines'] as $l) {
                        $amt = $l['dr'] - $l['cr'];
                        $acct = $t($idx[$l['acct']]['n'] ?? $l['acct']);
                        $row = [$first ? 'TRNS' : 'SPL', ++$n, 'GENERAL JOURNAL', $date, $acct, $t($l['name']), number_format($first ? $amt : $amt, 2, '.', ''), $t($e['ref']), $t($l['memo'] !== '' ? $l['memo'] : $e['memo'])];
                        $out[] = implode("\t", $row);
                        $first = false;
                    }
                    $out[] = 'ENDTRNS';
                }
                header('Content-Type: text/plain; charset=utf-8');
                header('Content-Disposition: attachment; filename="' . $name . ($from ? '-' . $from : '') . '.iif"');
                echo implode("\r\n", $out) . "\r\n";
                exit();
            } elseif ($kind === 'coa') {
                $name = 'chart-of-accounts';
                $lines[] = csvLine(['Number', 'Account', 'Type', 'Detail type', 'Opening balance', 'As of']);
                foreach (booksCoa() as $a) {
                    $lines[] = csvLine([$a['num'] ?? '', $a['n'], $a['t'], $a['sub'] ?? '', $a['open'] ?? 0, $a['openDate'] ?? '']);
                }
            } elseif ($kind === 'inv') {
                $name = 'invoices';
                $lines[] = csvLine(['Invoice', 'Client', 'Issued', 'Due', 'Status', 'Subtotal', 'Tax', 'Discount', 'Total', 'Paid', 'Currency']);
                foreach (colAll('inv', 'issue', 'asc') as [$id, $x]) {
                    if ($from !== '' && (string) ($x->issue ?? '') < $from) {
                        continue;
                    }
                    if ($to !== '' && (string) ($x->issue ?? '') > $to) {
                        continue;
                    }
                    $lines[] = csvLine([(string) ($x->num ?? $id), (string) ($x->cn ?? ''), (string) ($x->issue ?? ''), (string) ($x->due ?? ''), (string) ($x->st ?? ''), (float) ($x->sub ?? 0), (float) ($x->tax ?? 0), (float) ($x->disc ?? 0), (float) ($x->total ?? 0), (float) ($x->paid ?? 0), (string) ($x->cur ?? 'USD')]);
                }
            } elseif ($kind === 'bills') {
                $name = 'bills';
                $lines[] = csvLine(['Date', 'Vendor', 'Category', 'Reference', 'Due', 'Status', 'Paid on', 'Method', 'Amount', 'Currency', 'Notes']);
                foreach (colAll('exp', 'd', 'asc') as [$id, $x]) {
                    if ($from !== '' && (string) ($x->d ?? '') < $from) {
                        continue;
                    }
                    if ($to !== '' && (string) ($x->d ?? '') > $to) {
                        continue;
                    }
                    $lines[] = csvLine([(string) ($x->d ?? ''), (string) ($x->v ?? ''), (string) ($x->cat ?? ''), (string) ($x->ref ?? ''), (string) ($x->due ?? ''), (string) ($x->st ?? ''), (string) ($x->paidOn ?? ''), (string) ($x->m ?? ''), (float) ($x->a ?? 0), (string) ($x->cur ?? 'USD'), (string) ($x->notes ?? '')]);
                }
            } elseif ($kind === 'bank') {
                // QuickBooks Online "3-column" bank import format
                $name = 'bank-transactions';
                $lines[] = 'Date,Description,Amount';
                foreach (colAll('org/acct/bank', 'dt', 'asc') as [$id, $x]) {
                    if ($from !== '' && (string) ($x->dt ?? '') < $from) {
                        continue;
                    }
                    if ($to !== '' && (string) ($x->dt ?? '') > $to) {
                        continue;
                    }
                    $lines[] = csvLine([date('m/d/Y', strtotime((string) ($x->dt ?? 'today'))), (string) ($x->desc ?? ''), (float) ($x->a ?? 0)]);
                }
            } elseif ($kind === 'tb' || $kind === 'pl' || $kind === 'bs') {
                $rep = booksReport($kind, $from, $to, ['byMonth' => false]);
                $name = ['tb' => 'trial-balance', 'pl' => 'profit-and-loss', 'bs' => 'balance-sheet'][$kind];
                if ($kind === 'tb') {
                    $lines[] = csvLine(['Number', 'Account', 'Debit', 'Credit']);
                    foreach ($rep['rows'] as $r) {
                        $lines[] = csvLine([$r['num'], $r['n'], $r['dr'] ?: '', $r['cr'] ?: '']);
                    }
                    $lines[] = csvLine(['', 'Total', $rep['totalDr'], $rep['totalCr']]);
                } elseif ($kind === 'pl') {
                    $lines[] = csvLine(['Section', 'Number', 'Account', 'Amount']);
                    foreach (['income' => 'Income', 'cogs' => 'Cost of services', 'opex' => 'Operating expenses'] as $k => $label) {
                        foreach ($rep['sections'][$k] as $r) {
                            $lines[] = csvLine([$label, $r['num'], $r['n'], $r['v']['total'] ?? 0]);
                        }
                    }
                    $t = $rep['totals']['total'];
                    $lines[] = csvLine(['', '', 'Gross profit', $t['gross']]);
                    $lines[] = csvLine(['', '', 'Net income', $t['net']]);
                } else {
                    $lines[] = csvLine(['Section', 'Number', 'Account', 'Balance']);
                    foreach (['asset' => 'Assets', 'liability' => 'Liabilities', 'equity' => 'Equity'] as $k => $label) {
                        foreach ($rep['groups'][$k] as $r) {
                            $lines[] = csvLine([$label, $r['num'], $r['n'], $r['v']]);
                        }
                    }
                    $lines[] = csvLine(['Equity', '', 'Net income (current year)', $rep['netIncome']]);
                }
            } else {
                fail(400, 'invalid_argument', 'Unknown export.');
            }
            header('Content-Type: text/csv; charset=utf-8');
            header('Content-Disposition: attachment; filename="' . $name . ($from ? '-' . $from : '') . ($to ? '-to-' . $to : '') . '.csv"');
            echo "\xEF\xBB\xBF" . implode("\n", $lines) . "\n";
            exit();
        default:
            fail(404, 'not_found', 'Unknown action.');
    }
}
