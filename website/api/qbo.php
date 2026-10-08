<?php
declare(strict_types=1);
require_once __DIR__ . '/mail.php';
require_once __DIR__ . '/acct.php';
require_once __DIR__ . '/books.php';

/*
 * QuickBooks Online sync (v28). The site's books stay the system of record; QuickBooks receives a copy of every
 * record as it happens, in the shape an accountant expects there: customers, vendors, service items, invoices,
 * invoice payments, bills, bill payments, and journal entries for everything else (payroll, tax deposits,
 * categorized bank lines, manual journals, opening balances). Nothing is pulled back from QuickBooks.
 *
 * Keys and tokens: sec/x/qbo/cfg (sealed). Company and sync state: org/acct/x/qbo. What each local record became
 * in QuickBooks (Id, SyncToken, fingerprint): org/acct/x/qbomap_{names|acct|item|inv|pay|bill|billpay|je}.
 *
 * Set-up: create an app at developer.intuit.com with the Accounting scope, add the redirect address shown under
 * Books > Connections, paste the client ID and secret, then "Connect to QuickBooks".
 */

const QBO_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QBO_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const QBO_API = ['sandbox' => 'https://sandbox-quickbooks.api.intuit.com', 'production' => 'https://quickbooks.api.intuit.com'];
const QBO_MINOR = 75;
const QBO_BATCH = 120; // records pushed per run; the browser (or the cron job) calls again while "more" is true

function qboCfg(): array
{
    $d = docGet('sec/x/qbo/cfg') ?? new stdClass();
    $env = (string) ($d->env ?? 'sandbox');
    return [
        'env' => isset(QBO_API[$env]) ? $env : 'sandbox',
        'clientId' => trim((string) ($d->clientId ?? '')),
        'secret' => mailUnseal((string) ($d->secret ?? '')),
        'hasSecret' => (string) ($d->secret ?? '') !== '',
        'access' => mailUnseal((string) ($d->access ?? '')),
        'refresh' => mailUnseal((string) ($d->refresh ?? '')),
        'accessExp' => (int) ($d->accessExp ?? 0),
        'refreshExp' => (int) ($d->refreshExp ?? 0),
        'realmId' => preg_replace('/\D/', '', (string) ($d->realmId ?? '')),
        'auto' => !isset($d->auto) || !empty($d->auto),
    ];
}
function qboState(): stdClass
{
    return docGet('org/acct/x/qbo') ?? new stdClass();
}
function qboConnected(?array $cfg = null): bool
{
    $cfg = $cfg ?? qboCfg();
    return $cfg['realmId'] !== '' && $cfg['refresh'] !== '' && $cfg['refreshExp'] > time();
}
function qboRedirect(): string
{
    return siteUrl() . 'api/index.php?r=qbo_callback';
}
/** Where the browser goes after the callback: this very host (a staging copy must not bounce to the live site). */
function qboAppUrl(): string
{
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    $dir = rtrim(dirname(dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/api/index.php'))), '/');
    return ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $dir . '/';
}
function qboApiBase(string $env): string
{
    $o = (string) (getenv('SE_QBO_BASE') ?: (cfg('qbo_base') ?? ''));
    return $o !== '' ? rtrim($o, '/') : QBO_API[$env] ?? QBO_API['sandbox'];
}
function qboTokenUrl(): string
{
    $o = (string) (getenv('SE_QBO_BASE') ?: (cfg('qbo_base') ?? ''));
    return $o !== '' ? rtrim($o, '/') . '/oauth2/v1/tokens/bearer' : QBO_TOKEN_URL;
}
/** One HTTP call with a JSON or form body. Returns [status, decoded JSON or raw string]. */
function qboHttp(string $method, string $url, ?string $body, array $headers): array
{
    if (!function_exists('curl_init')) {
        return [0, 'PHP cURL is not available on this server.'];
    }
    $ch = curl_init($url);
    $opts = [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 40, CURLOPT_HTTPHEADER => $headers, CURLOPT_CUSTOMREQUEST => $method];
    if ($body !== null) {
        $opts[CURLOPT_POSTFIELDS] = $body;
    }
    curl_setopt_array($ch, $opts);
    $out = curl_exec($ch);
    $st = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($out === false) {
        return [0, $err];
    }
    $j = json_decode((string) $out, true);
    return [$st, is_array($j) ? $j : (string) $out];
}
/** Exchange an authorization code or refresh a token; stores the result sealed. */
function qboTokens(array $form, array $cfg): array
{
    $basic = base64_encode($cfg['clientId'] . ':' . $cfg['secret']);
    [$st, $j] = qboHttp('POST', qboTokenUrl(), http_build_query($form), ['Authorization: Basic ' . $basic, 'Accept: application/json', 'Content-Type: application/x-www-form-urlencoded']);
    if (!is_array($j) || $st >= 400 || empty($j['access_token'])) {
        $msg = is_array($j) ? (string) ($j['error_description'] ?? $j['error'] ?? 'refused') : (string) $j;
        throw new RuntimeException('QuickBooks sign-in failed: ' . ($msg !== '' ? $msg : 'HTTP ' . $st));
    }
    $d = docGet('sec/x/qbo/cfg') ?? new stdClass();
    $d->access = mailSeal((string) $j['access_token']);
    $d->accessExp = time() + (int) ($j['expires_in'] ?? 3600);
    if (!empty($j['refresh_token'])) {
        $d->refresh = mailSeal((string) $j['refresh_token']);
        $d->refreshExp = time() + (int) ($j['x_refresh_token_expires_in'] ?? 8726400);
    }
    docSet('sec/x/qbo/cfg', $d);
    return $j;
}
/** A live access token, refreshed when it is about to expire. */
function qboAccess(array &$cfg): string
{
    if (!qboConnected($cfg)) {
        throw new RuntimeException('QuickBooks is not connected. Connect it under Books > Connections.');
    }
    if ($cfg['access'] === '' || $cfg['accessExp'] < time() + 120) {
        qboTokens(['grant_type' => 'refresh_token', 'refresh_token' => $cfg['refresh']], $cfg);
        $cfg = qboCfg();
    }
    return $cfg['access'];
}
/** One QuickBooks API call; throws with Intuit's own fault text. */
function qboApi(string $method, string $path, ?array $body = null, array $query = []): array
{
    static $cfg = null;
    $cfg = $cfg ?? qboCfg();
    $token = qboAccess($cfg);
    $query['minorversion'] = QBO_MINOR;
    $url = qboApiBase($cfg['env']) . '/v3/company/' . $cfg['realmId'] . '/' . ltrim($path, '/') . '?' . http_build_query($query);
    $headers = ['Authorization: Bearer ' . $token, 'Accept: application/json'];
    $raw = null;
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
        $raw = json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }
    [$st, $j] = qboHttp($method, $url, $raw, $headers);
    if ($st === 401) {
        // the token died early: refresh once and retry
        qboTokens(['grant_type' => 'refresh_token', 'refresh_token' => $cfg['refresh']], $cfg);
        $cfg = qboCfg();
        $headers[0] = 'Authorization: Bearer ' . $cfg['access'];
        [$st, $j] = qboHttp($method, $url, $raw, $headers);
    }
    if (!is_array($j)) {
        throw new RuntimeException($st === 0 ? 'Could not reach QuickBooks: ' . (string) $j : 'QuickBooks answered ' . $st . ': ' . mb_substr((string) $j, 0, 200));
    }
    if ($st >= 400 || isset($j['Fault'])) {
        $errs = (array) ($j['Fault']['Error'] ?? []);
        $e = is_array($errs[0] ?? null) ? $errs[0] : [];
        $msg = trim((string) ($e['Message'] ?? 'QuickBooks refused the request.') . ' ' . (string) ($e['Detail'] ?? ''));
        throw new RuntimeException($msg . ' (code ' . (string) ($e['code'] ?? $st) . ')', $st);
    }
    return $j;
}
/** Every row a query returns (pages of 1000). */
function qboQuery(string $entity, string $where = ''): array
{
    $out = [];
    $start = 1;
    do {
        $q = 'select * from ' . $entity . ($where !== '' ? ' where ' . $where : '') . ' startposition ' . $start . ' maxresults 1000';
        $r = qboApi('GET', 'query', null, ['query' => $q]);
        $rows = (array) ($r['QueryResponse'][$entity] ?? []);
        foreach ($rows as $row) {
            if (is_array($row)) {
                $out[] = $row;
            }
        }
        $start += 1000;
    } while (count($rows) === 1000 && $start < 20000);
    return $out;
}
function qboQuote(string $s): string
{
    return str_replace(["\\", "'"], ["\\\\", "\\'"], $s);
}
function qboMap(string $kind): stdClass
{
    return docGet('org/acct/x/qbomap_' . $kind) ?? new stdClass();
}
function qboMapSave(string $kind, stdClass $m): void
{
    docSet('org/acct/x/qbomap_' . $kind, $m);
}
function qboLog(string $msg, array $data = []): void
{
    $s = qboState();
    $log = array_values((array) ($s->log ?? []));
    $log[] = (object) (['t' => now(), 'msg' => mb_substr($msg, 0, 300)] + $data);
    if (count($log) > 80) {
        $log = array_slice($log, -80);
    }
    $s->log = $log;
    docSet('org/acct/x/qbo', $s);
}
/** What the browser sees. */
function qboPublic(): array
{
    $cfg = qboCfg();
    $s = qboState();
    $counts = [];
    foreach (['inv', 'pay', 'bill', 'billpay', 'je'] as $k) {
        $counts[$k] = count(get_object_vars(qboMap($k)));
    }
    return [
        'env' => $cfg['env'],
        'clientId' => $cfg['clientId'],
        'hasSecret' => $cfg['hasSecret'],
        'connected' => qboConnected($cfg),
        'realmId' => $cfg['realmId'],
        'company' => (string) ($s->company ?? ''),
        'country' => (string) ($s->country ?? ''),
        'connectedAt' => (int) ($s->connectedAt ?? 0),
        'refreshExp' => $cfg['refreshExp'],
        'auto' => $cfg['auto'],
        'lastSync' => (int) ($s->lastSync ?? 0),
        'lastErr' => isset($s->lastErr) && $s->lastErr ? (array) $s->lastErr : null,
        'log' => array_values(array_map(fn($l) => (array) $l, array_slice((array) ($s->log ?? []), -30))),
        'counts' => $counts,
        'redirect' => qboRedirect(),
        'curl' => function_exists('curl_init'),
        'pending' => (int) ($s->pending ?? 0),
    ];
}

/* ---------- the chart: our accounts ↔ QuickBooks accounts ---------- */
function qboAccountType(array $a): array
{
    $sys = (string) ($a['sys'] ?? '');
    $k = $a['t'] . '/' . $a['sub'];
    return match (true) {
        $k === 'asset/bank' => ['Bank', 'Checking'],
        $k === 'asset/cash' => ['Other Current Asset', 'UndepositedFunds'],
        $k === 'asset/ar' => ['Accounts Receivable', 'AccountsReceivable'],
        $k === 'asset/current' => ['Other Current Asset', $sys === 'prepaid' ? 'PrepaidExpenses' : 'OtherCurrentAssets'],
        $k === 'asset/fixed' => ['Fixed Asset', $sys === 'accdep' ? 'AccumulatedDepreciation' : 'MachineryAndEquipment'],
        $k === 'liability/ap' => ['Accounts Payable', 'AccountsPayable'],
        $k === 'liability/cc' => ['Credit Card', 'CreditCard'],
        $k === 'liability/payroll' => ['Other Current Liability', in_array($sys, ['fedliab', 'stateliab'], true) ? 'PayrollTaxPayable' : 'PayrollClearing'],
        $k === 'liability/current' => ['Other Current Liability', $sys === 'salestax' ? 'SalesTaxPayable' : 'OtherCurrentLiabilities'],
        $k === 'liability/longterm' => ['Long Term Liability', 'NotesPayable'],
        $a['t'] === 'equity' => ['Equity', $sys === 'openeq' ? 'OpeningBalanceEquity' : ($sys === 'retained' ? 'RetainedEarnings' : ($sys === 'draws' ? 'PartnerDistributions' : 'OwnersEquity'))],
        $k === 'income/other' => ['Other Income', 'OtherMiscellaneousIncome'],
        $a['t'] === 'income' => ['Income', $sys === 'discounts' ? 'DiscountsRefundsGiven' : 'ServiceFeeIncome'],
        $k === 'expense/cogs' => ['Cost of Goods Sold', 'CostOfLabor'],
        $k === 'expense/other' => ['Other Expense', 'OtherMiscellaneousExpense'],
        default => ['Expense', match ($sys) {
            'bankfees' => 'BankCharges',
            'wages', 'ertax' => 'PayrollExpenses',
            'ben' => 'PayrollExpenses',
            'interest' => 'InterestPaid',
            'depr' => 'OtherMiscellaneousServiceCost',
            default => 'OtherMiscellaneousServiceCost',
        }],
    };
}
/** Make sure every account in our chart has a QuickBooks account id; returns ourId => qboId. */
function qboSyncAccounts(array &$stats): array
{
    $map = qboMap('acct');
    $coa = booksCoa();
    $qb = qboQuery('Account');
    $byName = [];
    $byNum = [];
    $byType = [];
    $byId = [];
    foreach ($qb as $a) {
        $byId[(string) $a['Id']] = $a;
        $byName[mb_strtolower(trim((string) ($a['Name'] ?? '')))] = (string) $a['Id'];
        if (!empty($a['AcctNum'])) {
            $byNum[(string) $a['AcctNum']] = (string) $a['Id'];
        }
        $byType[(string) ($a['AccountType'] ?? '') . '/' . (string) ($a['AccountSubType'] ?? '')][] = (string) $a['Id'];
    }
    $out = [];
    foreach ($coa as $a) {
        $id = (string) $a['id'];
        $cur = isset($map->$id) ? (string) $map->$id : '';
        if ($cur !== '' && isset($byId[$cur])) {
            $out[$id] = $cur;
            continue;
        }
        [$type, $sub] = qboAccountType($a);
        $name = trim((string) $a['n']);
        $hit = $byName[mb_strtolower($name)] ?? (!empty($a['num']) ? $byNum[(string) $a['num']] ?? null : null);
        // the special accounts QuickBooks already has (one A/R, one A/P, retained earnings, opening balance equity,
        // undeposited funds) are reused rather than duplicated
        if ($hit === null && in_array($sub, ['AccountsReceivable', 'AccountsPayable', 'RetainedEarnings', 'OpeningBalanceEquity', 'UndepositedFunds', 'SalesTaxPayable'], true)) {
            $hit = $byType[$type . '/' . $sub][0] ?? null;
        }
        if ($hit === null) {
            $body = ['Name' => mb_substr($name, 0, 100), 'AccountType' => $type, 'AccountSubType' => $sub];
            if (!empty($a['num'])) {
                $body['AcctNum'] = (string) $a['num'];
            }
            try {
                $r = qboApi('POST', 'account', $body);
            } catch (RuntimeException $e) {
                // a sub-type QuickBooks will not create here (locale rules): try the plain type
                $body['AccountSubType'] = match ($type) {
                    'Bank' => 'Checking',
                    'Other Current Asset' => 'OtherCurrentAssets',
                    'Fixed Asset' => 'OtherFixedAssets',
                    'Other Current Liability' => 'OtherCurrentLiabilities',
                    'Long Term Liability' => 'OtherLongTermLiabilities',
                    'Equity' => 'OwnersEquity',
                    'Income' => 'ServiceFeeIncome',
                    'Other Income' => 'OtherMiscellaneousIncome',
                    'Cost of Goods Sold' => 'OtherCostsOfServiceCos',
                    'Other Expense' => 'OtherMiscellaneousExpense',
                    'Credit Card' => 'CreditCard',
                    default => 'OtherMiscellaneousServiceCost',
                };
                $r = qboApi('POST', 'account', $body);
            }
            $hit = (string) ($r['Account']['Id'] ?? '');
            $stats['accounts']++;
        }
        if ($hit !== null && $hit !== '') {
            $out[$id] = $hit;
            $map->$id = $hit;
        }
    }
    qboMapSave('acct', $map);
    return $out;
}
/* ---------- names: customers and vendors ---------- */
function qboNames(): stdClass
{
    static $n = null;
    return $n ?? ($n = qboMap('names'));
}
function qboCustomer(string $name, array $extra = []): string
{
    $name = trim($name) !== '' ? trim($name) : 'Customer';
    $names = qboNames();
    $key = 'c:' . mb_strtolower($name);
    if (!empty($names->$key)) {
        return (string) $names->$key;
    }
    $rows = qboQuery('Customer', "DisplayName = '" . qboQuote(mb_substr($name, 0, 100)) . "'");
    $id = (string) ($rows[0]['Id'] ?? '');
    if ($id === '') {
        $body = ['DisplayName' => mb_substr($name, 0, 100), 'CompanyName' => mb_substr($name, 0, 100)];
        if (!empty($extra['email'])) {
            $body['PrimaryEmailAddr'] = ['Address' => (string) $extra['email']];
        }
        if (!empty($extra['addr'])) {
            $body['BillAddr'] = ['Line1' => mb_substr((string) $extra['addr'], 0, 500)];
        }
        $r = qboApi('POST', 'customer', $body);
        $id = (string) ($r['Customer']['Id'] ?? '');
    }
    $names->$key = $id;
    qboMapSave('names', $names);
    return $id;
}
function qboVendor(string $name): string
{
    $name = trim($name) !== '' ? trim($name) : 'Vendor';
    $names = qboNames();
    $key = 'v:' . mb_strtolower($name);
    if (!empty($names->$key)) {
        return (string) $names->$key;
    }
    $rows = qboQuery('Vendor', "DisplayName = '" . qboQuote(mb_substr($name, 0, 100)) . "'");
    $id = (string) ($rows[0]['Id'] ?? '');
    if ($id === '') {
        $r = qboApi('POST', 'vendor', ['DisplayName' => mb_substr($name, 0, 100), 'CompanyName' => mb_substr($name, 0, 100)]);
        $id = (string) ($r['Vendor']['Id'] ?? '');
    }
    $names->$key = $id;
    qboMapSave('names', $names);
    return $id;
}
/** A service item per income account (invoice lines in QuickBooks post through items). */
function qboItem(string $ourAcct, array $acctMap): string
{
    $items = qboMap('item');
    if (!empty($items->$ourAcct)) {
        return (string) $items->$ourAcct;
    }
    $a = coaIndex()['byId'][$ourAcct] ?? null;
    $name = $a ? (string) $a['n'] : 'Services';
    $rows = qboQuery('Item', "Name = '" . qboQuote(mb_substr($name, 0, 100)) . "'");
    $id = (string) ($rows[0]['Id'] ?? '');
    if ($id === '') {
        $r = qboApi('POST', 'item', ['Name' => mb_substr($name, 0, 100), 'Type' => 'Service', 'IncomeAccountRef' => ['value' => $acctMap[$ourAcct] ?? $acctMap[sysAcct('inc')]]]);
        $id = (string) ($r['Item']['Id'] ?? '');
    }
    $items->$ourAcct = $id;
    qboMapSave('item', $items);
    return $id;
}
/* ---------- pushing one record ---------- */
/** Create or update one entity; the map remembers Id, SyncToken and the fingerprint of what was sent. */
function qboPush(string $kind, string $entity, string $key, array $body, stdClass $map, array &$stats): bool
{
    $fp = md5(json_encode($body));
    $cur = isset($map->$key) ? (array) $map->$key : null;
    if ($cur && ($cur['fp'] ?? '') === $fp) {
        return false;
    }
    $path = strtolower($entity);
    if ($cur && !empty($cur['id'])) {
        // the current SyncToken is needed to update; read the record first
        try {
            $live = qboApi('GET', $path . '/' . $cur['id']);
            $body['Id'] = (string) $cur['id'];
            $body['SyncToken'] = (string) ($live[$entity]['SyncToken'] ?? '0');
            $r = qboApi('POST', $path, $body);
            $stats['updated']++;
        } catch (RuntimeException $e) {
            if ($e->getCode() === 404 || str_contains($e->getMessage(), 'Object Not Found') || str_contains($e->getMessage(), 'code 610')) {
                unset($body['Id'], $body['SyncToken']);
                $r = qboApi('POST', $path, $body);
                $stats['created']++;
            } else {
                throw $e;
            }
        }
    } else {
        $r = qboApi('POST', $path, $body);
        $stats['created']++;
    }
    $map->$key = (object) ['id' => (string) ($r[$entity]['Id'] ?? ''), 'fp' => $fp, 'u' => now()];
    return true;
}
/** A record that disappeared locally is removed (or voided) in QuickBooks. */
function qboDrop(string $entity, string $key, stdClass $map, array &$stats, bool $void = false): void
{
    $cur = isset($map->$key) ? (array) $map->$key : null;
    if (!$cur || empty($cur['id'])) {
        unset($map->$key);
        return;
    }
    $path = strtolower($entity);
    try {
        $live = qboApi('GET', $path . '/' . $cur['id']);
        qboApi('POST', $path, ['Id' => (string) $cur['id'], 'SyncToken' => (string) ($live[$entity]['SyncToken'] ?? '0')], ['operation' => $void ? 'void' : 'delete']);
        $stats['removed']++;
    } catch (RuntimeException $e) {
        // already gone, or voided by hand in QuickBooks
    }
    unset($map->$key);
}
/** The whole push. Processes up to QBO_BATCH changes, then reports "more" so the caller runs it again. */
function qboSync(bool $full = false): array
{
    $cfg = qboCfg();
    if (!qboConnected($cfg)) {
        throw new RuntimeException('QuickBooks is not connected.');
    }
    $stats = ['accounts' => 0, 'created' => 0, 'updated' => 0, 'removed' => 0, 'skipped' => 0, 'errors' => 0, 'more' => false];
    $budget = QBO_BATCH;
    $state = qboState();
    $us = (string) ($state->country ?? 'US') === 'US';
    $acctMap = qboSyncAccounts($stats);
    $q = fn(string $our) => ['value' => $acctMap[$our] ?? $acctMap[sysAcct('otherexp')] ?? ''];
    $errors = [];
    $touch = function (string $kind, string $entity, string $key, array $body, stdClass $map) use (&$stats, &$budget, &$errors): void {
        if ($budget <= 0) {
            $stats['more'] = true;
            return;
        }
        try {
            if (qboPush($kind, $entity, $key, $body, $map, $stats)) {
                $budget--;
            } else {
                $stats['skipped']++;
            }
        } catch (RuntimeException $e) {
            $stats['errors']++;
            $budget--;
            if (count($errors) < 12) {
                $errors[] = $entity . ' ' . $key . ': ' . mb_substr($e->getMessage(), 0, 240);
            }
        }
    };
    $closeAfter = (string) (booksCfg()['close'] ?? ''); // nothing dated inside a closed period is re-pushed on a normal run
    $recent = fn(string $d) => $full || $closeAfter === '' || $d > $closeAfter;

    /* invoices and their payments */
    $invMap = qboMap('inv');
    $payMap = qboMap('pay');
    $seenInv = [];
    $seenPay = [];
    foreach (colAll('inv') as [$id, $x]) {
        $st = (string) ($x->st ?? 'draft');
        if ($st === 'draft') {
            continue;
        }
        $id = (string) $id;
        if ($st === 'void') {
            if (isset($invMap->$id)) {
                qboDrop('Invoice', $id, $invMap, $stats, true);
            }
            continue;
        }
        $seenInv[$id] = true;
        $issue = (string) ($x->issue ?? '');
        if (!$recent($issue) && isset($invMap->$id)) {
            foreach ((array) ($x->pays ?? []) as $k => $p) {
                $seenPay[$id . ':' . (string) ($p->at ?? $k)] = true;
            }
            continue;
        }
        $client = trim((string) ($x->cn ?? ($x->bill->co ?? '')));
        try {
            $custId = qboCustomer($client !== '' ? $client : 'Walk-in client', ['email' => (string) ($x->bill->e ?? ''), 'addr' => (string) ($x->bill->addr ?? '')]);
        } catch (RuntimeException $e) {
            $stats['errors']++;
            $errors[] = 'Customer ' . $client . ': ' . $e->getMessage();
            continue;
        }
        $lines = [];
        foreach ((array) ($x->lines ?? []) as $l) {
            if (!($l instanceof stdClass)) {
                continue;
            }
            $amt = round((float) ($l->q ?? 0) * (float) ($l->u ?? 0), 2);
            $acct = !empty($l->acct) && isset(coaIndex()['byId'][(string) $l->acct]) ? (string) $l->acct : sysAcct('inc');
            try {
                $item = qboItem($acct, $acctMap);
            } catch (RuntimeException $e) {
                $item = qboItem(sysAcct('inc'), $acctMap);
            }
            $detail = ['ItemRef' => ['value' => $item], 'Qty' => (float) ($l->q ?? 1), 'UnitPrice' => (float) ($l->u ?? 0)];
            if ($us) {
                $detail['TaxCodeRef'] = ['value' => 'NON'];
            }
            $lines[] = ['DetailType' => 'SalesItemLineDetail', 'Amount' => $amt, 'Description' => mb_substr((string) ($l->d ?? ''), 0, 4000), 'SalesItemLineDetail' => $detail];
        }
        if ((float) ($x->tax ?? 0) > 0) {
            // tax collected goes to the sales-tax liability through its own service line (automated sales tax in
            // QuickBooks cannot be told an amount)
            $taxItem = qboItem(sysAcct('salestax'), $acctMap);
            $lines[] = ['DetailType' => 'SalesItemLineDetail', 'Amount' => round((float) $x->tax, 2), 'Description' => 'Sales tax (' . (string) ($x->taxp ?? '') . '%)', 'SalesItemLineDetail' => ['ItemRef' => ['value' => $taxItem], 'Qty' => 1, 'UnitPrice' => round((float) $x->tax, 2)] + ($us ? ['TaxCodeRef' => ['value' => 'NON']] : [])];
        }
        if ((float) ($x->disc ?? 0) > 0) {
            $lines[] = ['DetailType' => 'DiscountLineDetail', 'Amount' => round((float) $x->disc, 2), 'DiscountLineDetail' => ['PercentBased' => false, 'DiscountAccountRef' => $q(sysAcct('discounts'))]];
        }
        $body = [
            'DocNumber' => mb_substr((string) ($x->num ?? $id), 0, 21),
            'TxnDate' => $issue,
            'CustomerRef' => ['value' => $custId],
            'Line' => $lines,
            'PrivateNote' => 'StratEdge invoice ' . (string) ($x->num ?? $id),
        ];
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($x->due ?? ''))) {
            $body['DueDate'] = (string) $x->due;
        }
        if (trim((string) ($x->notes ?? '')) !== '') {
            $body['CustomerMemo'] = ['value' => mb_substr((string) $x->notes, 0, 1000)];
        }
        if (!empty($x->bill->e)) {
            $body['BillEmail'] = ['Address' => (string) $x->bill->e];
        }
        if ((string) ($x->cur ?? 'USD') !== 'USD') {
            $body['CurrencyRef'] = ['value' => (string) $x->cur];
        }
        $touch('inv', 'Invoice', $id, $body, $invMap);
        $invQbo = isset($invMap->$id) ? (string) ((array) $invMap->$id)['id'] : '';
        if ($invQbo === '') {
            continue;
        }
        foreach ((array) ($x->pays ?? []) as $k => $p) {
            if (!($p instanceof stdClass)) {
                continue;
            }
            $pk = $id . ':' . (string) ($p->at ?? $k);
            $seenPay[$pk] = true;
            $amt = round((float) ($p->a ?? 0), 2);
            if ($amt <= 0) {
                continue;
            }
            $pb = [
                'CustomerRef' => ['value' => $custId],
                'TotalAmt' => $amt,
                'TxnDate' => (string) ($p->dt ?? $issue),
                'DepositToAccountRef' => $q(methodAcct((string) ($p->m ?? ''))),
                'Line' => [['Amount' => $amt, 'LinkedTxn' => [['TxnId' => $invQbo, 'TxnType' => 'Invoice']]]],
                'PrivateNote' => 'Payment on StratEdge invoice ' . (string) ($x->num ?? $id) . (!empty($p->m) ? ' · ' . (string) $p->m : ''),
            ];
            if (trim((string) ($p->ref ?? '')) !== '') {
                $pb['PaymentRefNum'] = mb_substr(trim((string) $p->ref), 0, 21);
            }
            $touch('pay', 'Payment', $pk, $pb, $payMap);
        }
    }
    foreach (array_keys(get_object_vars($payMap)) as $pk) {
        if (!isset($seenPay[$pk]) && $budget > 0) {
            qboDrop('Payment', $pk, $payMap, $stats);
            $budget--;
        }
    }
    foreach (array_keys(get_object_vars($invMap)) as $ik) {
        if (!isset($seenInv[$ik]) && $budget > 0 && !docGet('inv/' . $ik)) {
            qboDrop('Invoice', $ik, $invMap, $stats, true);
            $budget--;
        }
    }
    qboMapSave('inv', $invMap);
    qboMapSave('pay', $payMap);

    /* bills and their payments */
    $billMap = qboMap('bill');
    $bpMap = qboMap('billpay');
    $seenBill = [];
    $seenBp = [];
    foreach (colAll('exp') as [$id, $x]) {
        $id = (string) $id;
        $amt = round((float) ($x->a ?? 0), 2);
        if ($amt <= 0) {
            continue;
        }
        $seenBill[$id] = true;
        $d = (string) ($x->d ?? '');
        $paid = (string) ($x->st ?? '') === 'paid';
        if ($paid) {
            $seenBp[$id] = true;
        }
        if (!$recent($d) && isset($billMap->$id) && (!$paid || isset($bpMap->$id))) {
            continue;
        }
        $vendor = trim((string) ($x->v ?? ''));
        try {
            $vendId = qboVendor($vendor !== '' ? $vendor : 'Vendor');
        } catch (RuntimeException $e) {
            $stats['errors']++;
            $errors[] = 'Vendor ' . $vendor . ': ' . $e->getMessage();
            continue;
        }
        $body = [
            'VendorRef' => ['value' => $vendId],
            'TxnDate' => $d,
            'Line' => [['DetailType' => 'AccountBasedExpenseLineDetail', 'Amount' => $amt, 'Description' => mb_substr(trim((string) ($x->notes ?? '')) !== '' ? (string) $x->notes : (string) ($x->cat ?? ''), 0, 4000), 'AccountBasedExpenseLineDetail' => ['AccountRef' => $q(catAcct((string) ($x->cat ?? '')))]]],
            'PrivateNote' => 'StratEdge bill' . ((string) ($x->cat ?? '') !== '' ? ' · ' . (string) $x->cat : ''),
        ];
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($x->due ?? ''))) {
            $body['DueDate'] = (string) $x->due;
        }
        if (trim((string) ($x->ref ?? '')) !== '') {
            $body['DocNumber'] = mb_substr(trim((string) $x->ref), 0, 21);
        }
        if ((string) ($x->cur ?? 'USD') !== 'USD') {
            $body['CurrencyRef'] = ['value' => (string) $x->cur];
        }
        $touch('bill', 'Bill', $id, $body, $billMap);
        $billQbo = isset($billMap->$id) ? (string) ((array) $billMap->$id)['id'] : '';
        if ($paid && $billQbo !== '') {
            $from = methodAcct((string) ($x->m ?? ''));
            $fromA = coaIndex()['byId'][$from] ?? null;
            $cc = $fromA && (string) ($fromA['sub'] ?? '') === 'cc';
            $pb = [
                'VendorRef' => ['value' => $vendId],
                'TotalAmt' => $amt,
                'TxnDate' => (string) ($x->paidOn ?? $d),
                'PayType' => $cc ? 'CreditCard' : 'Check',
                'Line' => [['Amount' => $amt, 'LinkedTxn' => [['TxnId' => $billQbo, 'TxnType' => 'Bill']]]],
                'PrivateNote' => 'Paid · ' . $vendor,
            ];
            if ($cc) {
                $pb['CreditCardPayment'] = ['CCAccountRef' => $q($from)];
            } else {
                $pb['CheckPayment'] = ['BankAccountRef' => $q($from), 'PrintStatus' => 'NotSet'];
            }
            $touch('billpay', 'BillPayment', $id, $pb, $bpMap);
        } elseif (!$paid && isset($bpMap->$id) && $budget > 0) {
            qboDrop('BillPayment', $id, $bpMap, $stats);
            $budget--;
        }
    }
    foreach (array_keys(get_object_vars($bpMap)) as $k) {
        if (!isset($seenBp[$k]) && $budget > 0) {
            qboDrop('BillPayment', $k, $bpMap, $stats);
            $budget--;
        }
    }
    foreach (array_keys(get_object_vars($billMap)) as $k) {
        if (!isset($seenBill[$k]) && $budget > 0) {
            qboDrop('Bill', $k, $billMap, $stats);
            $budget--;
        }
    }
    qboMapSave('bill', $billMap);
    qboMapSave('billpay', $bpMap);

    /* everything else in the ledger goes as journal entries */
    $jeMap = qboMap('je');
    $seenJe = [];
    $arId = sysAcct('ar');
    $apId = sysAcct('ap');
    foreach (booksEntries('', '') as $e) {
        if (in_array((string) $e['src'], ['inv', 'pay', 'exp', 'billpay'], true)) {
            continue;
        }
        $key = preg_replace('/[^A-Za-z0-9_\-:.]/', '_', (string) $e['id']);
        $seenJe[$key] = true;
        if (!$recent((string) $e['d']) && isset($jeMap->$key)) {
            continue;
        }
        $lines = [];
        foreach ((array) $e['lines'] as $l) {
            $dr = round((float) ($l['dr'] ?? 0), 2);
            $cr = round((float) ($l['cr'] ?? 0), 2);
            $acct = (string) $l['acct'];
            $detail = ['PostingType' => $dr > 0 ? 'Debit' : 'Credit', 'AccountRef' => $q($acct)];
            if ($acct === $arId) {
                $detail['Entity'] = ['Type' => 'Customer', 'EntityRef' => ['value' => qboCustomer((string) ($l['name'] ?? '') !== '' ? (string) $l['name'] : 'Opening balances')]];
            } elseif ($acct === $apId) {
                $detail['Entity'] = ['Type' => 'Vendor', 'EntityRef' => ['value' => qboVendor((string) ($l['name'] ?? '') !== '' ? (string) $l['name'] : 'Opening balances')]];
            }
            $lines[] = ['DetailType' => 'JournalEntryLineDetail', 'Amount' => $dr > 0 ? $dr : $cr, 'Description' => mb_substr(trim(((string) ($l['name'] ?? '') !== '' ? $l['name'] . ' · ' : '') . (string) ($l['memo'] ?? $e['memo'])), 0, 4000), 'JournalEntryLineDetail' => $detail];
        }
        if (count($lines) < 2) {
            continue;
        }
        $body = ['TxnDate' => (string) $e['d'], 'DocNumber' => mb_substr($key, 0, 21), 'PrivateNote' => mb_substr((string) $e['memo'] . ((string) ($e['ref'] ?? '') !== '' ? ' · ' . $e['ref'] : ''), 0, 4000), 'Line' => $lines];
        $touch('je', 'JournalEntry', $key, $body, $jeMap);
    }
    foreach (array_keys(get_object_vars($jeMap)) as $k) {
        if (!isset($seenJe[$k]) && $budget > 0) {
            qboDrop('JournalEntry', $k, $jeMap, $stats);
            $budget--;
        }
    }
    qboMapSave('je', $jeMap);

    $state = qboState();
    $state->lastSync = now();
    $state->pending = $stats['more'] ? 1 : 0;
    $state->lastErr = $errors ? (object) ['at' => now(), 'msg' => $errors[0], 'n' => $stats['errors']] : null;
    docSet('org/acct/x/qbo', $state);
    $stats['errorList'] = $errors;
    qboLog(sprintf('Sync: %d created, %d updated, %d removed, %d unchanged%s%s', $stats['created'], $stats['updated'], $stats['removed'], $stats['skipped'], $stats['errors'] ? ', ' . $stats['errors'] . ' failed' : '', $stats['more'] ? ', more to do' : ''), ['n' => $stats['created'] + $stats['updated'] + $stats['removed'], 'err' => $stats['errors']]);
    return $stats;
}
/** The cron job: a push when connected and automatic sync is on (several passes while there is more). */
function qboCron(): array
{
    $cfg = qboCfg();
    if (!qboConnected($cfg) || !$cfg['auto']) {
        return ['ran' => false];
    }
    $out = ['ran' => true, 'created' => 0, 'updated' => 0, 'removed' => 0, 'errors' => 0];
    for ($i = 0; $i < 6; $i++) {
        try {
            $r = qboSync(false);
        } catch (Throwable $e) {
            $s = qboState();
            $s->lastErr = (object) ['at' => now(), 'msg' => mb_substr($e->getMessage(), 0, 300)];
            docSet('org/acct/x/qbo', $s);
            $out['errors']++;
            $out['message'] = $e->getMessage();
            break;
        }
        foreach (['created', 'updated', 'removed', 'errors'] as $k) {
            $out[$k] += $r[$k];
        }
        if (!$r['more']) {
            break;
        }
    }
    return $out;
}
/** OAuth: Intuit sends the browser back here with a code and the company (realm) id. */
function qboCallback(): never
{
    $st = (string) ($_GET['state'] ?? '');
    $want = (string) ($_SESSION['qbo_state'] ?? '');
    $home = qboAppUrl() . '#/portal/admin/books?tab=connect';
    if ($want === '' || !hash_equals($want, $st)) {
        header('Location: ' . $home . '&qbo=state');
        exit();
    }
    unset($_SESSION['qbo_state']);
    $u = currentUser();
    if (!$u || !hasRole($u, 'admin')) {
        header('Location: ' . $home . '&qbo=login');
        exit();
    }
    if (!empty($_GET['error'])) {
        header('Location: ' . $home . '&qbo=denied');
        exit();
    }
    $code = (string) ($_GET['code'] ?? '');
    $realm = preg_replace('/\D/', '', (string) ($_GET['realmId'] ?? ''));
    $cfg = qboCfg();
    try {
        qboTokens(['grant_type' => 'authorization_code', 'code' => $code, 'redirect_uri' => qboRedirect()], $cfg);
        $d = docGet('sec/x/qbo/cfg') ?? new stdClass();
        $d->realmId = $realm;
        docSet('sec/x/qbo/cfg', $d);
        $state = qboState();
        $state->connectedAt = now();
        $state->by = $u['id'];
        $state->log = [];
        try {
            $info = qboApi('GET', 'companyinfo/' . $realm);
            $state->company = (string) ($info['CompanyInfo']['CompanyName'] ?? '');
            $state->country = (string) ($info['CompanyInfo']['Country'] ?? 'US');
        } catch (Throwable $e) {
            $state->company = '';
        }
        docSet('org/acct/x/qbo', $state);
        qboLog('Connected to QuickBooks' . ($state->company !== '' ? ': ' . $state->company : ''));
        auditLog('qbo', 'sec/x/qbo/cfg', 'QuickBooks connected: ' . (string) $state->company, ['realm' => $realm], $u);
    } catch (Throwable $e) {
        $s = qboState();
        $s->lastErr = (object) ['at' => now(), 'msg' => mb_substr($e->getMessage(), 0, 300)];
        docSet('org/acct/x/qbo', $s);
        header('Location: ' . $home . '&qbo=failed');
        exit();
    }
    header('Location: ' . $home . '&qbo=ok');
    exit();
}

function qboRoute(string $r, string $method, array $b): never
{
    switch ($r) {
        case 'qbo_settings':
            booksStaff();
            ok(qboPublic());
        case 'qbo_settings_save':
            $u = requireAdmin();
            if (!hasRole($u, 'admin')) {
                fail(403, 'forbidden', 'Only an administrator can change the QuickBooks keys.');
            }
            $d = docGet('sec/x/qbo/cfg') ?? new stdClass();
            $env = str($b, 'env', 12);
            $newEnv = isset(QBO_API[$env]) ? $env : 'sandbox';
            if ((string) ($d->env ?? 'sandbox') !== $newEnv) {
                // a different environment is a different company: forget the old tokens
                $d->access = '';
                $d->refresh = '';
                $d->realmId = '';
                $d->refreshExp = 0;
            }
            $d->env = $newEnv;
            $d->clientId = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($b['clientId'] ?? ''));
            $secret = trim((string) ($b['secret'] ?? ''));
            if ($secret !== '') {
                $d->secret = mailSeal(preg_replace('/[^A-Za-z0-9_\-]/', '', $secret));
            }
            if (array_key_exists('auto', $b)) {
                $d->auto = !empty($b['auto']);
            }
            $d->u = now();
            docSet('sec/x/qbo/cfg', $d);
            auditLog('qbo', 'sec/x/qbo/cfg', 'QuickBooks settings changed', ['env' => $d->env, 'auto' => !isset($d->auto) || $d->auto], $u);
            ok(qboPublic());
        case 'qbo_connect':
            // where to send the browser to approve the connection at Intuit
            $u = requireAdmin();
            if (!hasRole($u, 'admin')) {
                fail(403, 'forbidden', 'Only an administrator can connect QuickBooks.');
            }
            $cfg = qboCfg();
            if ($cfg['clientId'] === '' || $cfg['secret'] === '') {
                fail(400, 'invalid_argument', 'Add the client ID and client secret from developer.intuit.com first.');
            }
            $state = rid(16);
            $_SESSION['qbo_state'] = $state;
            $url = QBO_AUTH_URL . '?' . http_build_query(['client_id' => $cfg['clientId'], 'response_type' => 'code', 'scope' => 'com.intuit.quickbooks.accounting', 'redirect_uri' => qboRedirect(), 'state' => $state]);
            ok(['url' => $url]);
        case 'qbo_callback':
            qboCallback();
        case 'qbo_disconnect':
            $u = requireAdmin();
            if (!hasRole($u, 'admin')) {
                fail(403, 'forbidden', 'Only an administrator can disconnect QuickBooks.');
            }
            $cfg = qboCfg();
            if ($cfg['refresh'] !== '') {
                qboHttp('POST', QBO_REVOKE_URL, json_encode(['token' => $cfg['refresh']]), ['Authorization: Basic ' . base64_encode($cfg['clientId'] . ':' . $cfg['secret']), 'Accept: application/json', 'Content-Type: application/json']);
            }
            $d = docGet('sec/x/qbo/cfg') ?? new stdClass();
            $d->access = '';
            $d->refresh = '';
            $d->realmId = '';
            $d->accessExp = 0;
            $d->refreshExp = 0;
            docSet('sec/x/qbo/cfg', $d);
            if (!empty($b['forget'])) {
                foreach (['names', 'acct', 'item', 'inv', 'pay', 'bill', 'billpay', 'je'] as $k) {
                    docDelete('org/acct/x/qbomap_' . $k);
                }
            }
            qboLog('Disconnected from QuickBooks');
            auditLog('qbo', 'sec/x/qbo/cfg', 'QuickBooks disconnected', [], $u);
            ok(qboPublic());
        case 'qbo_sync':
            booksStaff(true);
            try {
                $r = qboSync(!empty($b['full']));
            } catch (Throwable $e) {
                $s = qboState();
                $s->lastErr = (object) ['at' => now(), 'msg' => mb_substr($e->getMessage(), 0, 300)];
                docSet('org/acct/x/qbo', $s);
                fail(502, 'qbo', $e->getMessage());
            }
            ok($r + ['state' => qboPublic()]);
        case 'qbo_accounts':
            // the QuickBooks chart next to ours, for checking the mapping
            booksStaff();
            try {
                $qb = qboQuery('Account');
            } catch (Throwable $e) {
                fail(502, 'qbo', $e->getMessage());
            }
            $map = (array) qboMap('acct');
            ok(['qbo' => array_map(fn($a) => ['id' => (string) $a['Id'], 'n' => (string) ($a['Name'] ?? ''), 'num' => (string) ($a['AcctNum'] ?? ''), 't' => (string) ($a['AccountType'] ?? ''), 'sub' => (string) ($a['AccountSubType'] ?? ''), 'active' => !isset($a['Active']) || $a['Active']], $qb), 'map' => $map, 'coa' => booksCoa()]);
        case 'qbo_map_save':
            $u = booksStaff(true);
            if (!hasRole($u, 'admin')) {
                fail(403, 'forbidden', 'Only an administrator can change the account mapping.');
            }
            $map = qboMap('acct');
            foreach ((array) ($b['map'] ?? []) as $our => $qid) {
                $our = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) $our);
                $qid = preg_replace('/\D/', '', (string) $qid);
                if ($our === '') {
                    continue;
                }
                if ($qid === '') {
                    unset($map->$our);
                } else {
                    $map->$our = $qid;
                }
            }
            qboMapSave('acct', $map);
            ok(['map' => (array) $map]);
        default:
            fail(404, 'not_found', 'Unknown action.');
    }
}
