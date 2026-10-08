<?php
declare(strict_types=1);
require_once __DIR__ . '/mail.php';
require_once __DIR__ . '/sso.php';
require_once __DIR__ . '/acct.php';
require_once __DIR__ . '/books.php';

/*
 * Bank connection through Plaid (v28). The company's Plaid keys live in sec/x/bank/plaid (secret sealed), each
 * connected bank ("item") in sec/x/bank/items/{itemId} (access token sealed), and every posted transaction lands
 * in org/acct/bank as a normal bank line keyed plaid:{transaction_id}, where Books > Transactions reviews it.
 * Sync runs on demand ("Sync now"), from the cron job every run, and when Plaid's webhook says there is news.
 *
 * Statement files (OFX/QFX/QBO/CSV) are parsed in the browser (acct2.js) and arrive through acct_bank_import,
 * which de-duplicates on the bank's own FITID when the file has one.
 */

const PLAID_HOSTS = ['sandbox' => 'https://sandbox.plaid.com', 'production' => 'https://production.plaid.com'];
/** Plaid personal-finance categories → the usual chart-of-accounts names (used as a suggestion only). */
const PLAID_CATS = [
    'RENT_AND_UTILITIES' => 'Rent and utilities',
    'GENERAL_SERVICES' => 'Professional fees (legal, CPA)',
    'BANK_FEES' => 'Bank fees and charges',
    'TRAVEL' => 'Travel',
    'TRANSPORTATION' => 'Travel',
    'FOOD_AND_DRINK' => 'Travel',
    'GENERAL_MERCHANDISE' => 'Office and supplies',
    'HOME_IMPROVEMENT' => 'Office and supplies',
    'GOVERNMENT_AND_NON_PROFIT' => 'Taxes and licenses',
    'INCOME' => 'Staffing income',
    'TRANSFER_IN' => 'Transfer',
    'TRANSFER_OUT' => 'Transfer',
    'LOAN_PAYMENTS' => 'Transfer',
];
const PLAID_SUBCATS = [
    'GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING' => 'Professional fees (legal, CPA)',
    'GENERAL_SERVICES_CONSULTING_AND_LEGAL' => 'Professional fees (legal, CPA)',
    'GENERAL_SERVICES_INSURANCE' => 'Insurance',
    'GENERAL_SERVICES_POSTAGE_AND_SHIPPING' => 'Office and supplies',
    'GENERAL_SERVICES_EDUCATION' => 'Screening',
    'GENERAL_SERVICES_OTHER_GENERAL_SERVICES' => 'Software subscriptions',
    'RENT_AND_UTILITIES_TELEPHONE' => 'Rent and utilities',
    'RENT_AND_UTILITIES_INTERNET_AND_CABLE' => 'Rent and utilities',
    'GENERAL_MERCHANDISE_OFFICE_SUPPLIES' => 'Office and supplies',
    'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES' => 'Office and supplies',
    'ENTERTAINMENT_TV_AND_MOVIES' => 'Software subscriptions',
    'INCOME_WAGES' => 'Payroll',
    'BANK_FEES_INTEREST_CHARGE' => 'Interest expense',
    'INCOME_INTEREST_EARNED' => 'Other income',
    'GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT' => 'Taxes and licenses',
    'TRANSFER_OUT_ACCOUNT_TRANSFER' => 'Transfer',
    'TRANSFER_IN_ACCOUNT_TRANSFER' => 'Transfer',
    'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' => 'Transfer',
    'MEDICAL_DENTAL_CARE' => 'Benefits (staff)',
    'MEDICAL_PRIMARY_CARE' => 'Benefits (staff)',
];

function plaidCfg(): array
{
    $d = docGet('sec/x/bank/plaid') ?? new stdClass();
    $env = (string) ($d->env ?? 'sandbox');
    return [
        'on' => !empty($d->on),
        'env' => isset(PLAID_HOSTS[$env]) ? $env : 'sandbox',
        'clientId' => trim((string) ($d->clientId ?? '')),
        'secret' => mailUnseal((string) ($d->secret ?? '')),
        'hasSecret' => (string) ($d->secret ?? '') !== '',
        'webhookSecret' => (string) ($d->wh ?? ''),
        'country' => (string) ($d->country ?? 'US'),
        'u' => (int) ($d->u ?? 0),
    ];
}
/** Plaid's base address; config.php may point it at a test server (plaid_base). */
function plaidBase(string $env): string
{
    $o = (string) (getenv('SE_PLAID_BASE') ?: (cfg('plaid_base') ?? ''));
    return $o !== '' ? rtrim($o, '/') : PLAID_HOSTS[$env] ?? PLAID_HOSTS['sandbox'];
}
/** One Plaid API call. Returns the decoded body; throws with Plaid's own message on an error. */
function plaidCall(string $path, array $body, ?array $cfg = null): array
{
    $cfg = $cfg ?? plaidCfg();
    if ($cfg['clientId'] === '' || $cfg['secret'] === '') {
        throw new RuntimeException('Plaid is not set up: add the client ID and secret under Books > Connections.');
    }
    $body['client_id'] = $cfg['clientId'];
    $body['secret'] = $cfg['secret'];
    [$st, $j] = ssoHttp(plaidBase($cfg['env']) . $path, ['__raw' => json_encode($body, JSON_UNESCAPED_SLASHES)], ['Content-Type: application/json', 'Plaid-Version: 2020-09-14']);
    if (!is_array($j)) {
        throw new RuntimeException($st === 0 ? 'Could not reach Plaid: ' . (string) $j : 'Plaid answered ' . $st . '.');
    }
    if ($st >= 400 || isset($j['error_code'])) {
        $msg = (string) ($j['error_message'] ?? $j['display_message'] ?? 'Plaid refused the request.');
        $code = (string) ($j['error_code'] ?? '');
        throw new RuntimeException(($code !== '' ? $code . ': ' : '') . $msg, $st);
    }
    return $j;
}
function plaidItems(): array
{
    $out = [];
    foreach (colAll('sec/x/bank/items', 'at', 'asc') as [$id, $d]) {
        $out[(string) $id] = $d;
    }
    return $out;
}
/** What the browser may see about a connected bank (no tokens). */
function plaidItemPublic(string $id, stdClass $d): array
{
    return [
        'id' => $id,
        'inst' => (string) ($d->inst ?? ''),
        'instId' => (string) ($d->instId ?? ''),
        'accounts' => array_values(array_map(fn($a) => (array) $a, (array) ($d->accounts ?? []))),
        'at' => (int) ($d->at ?? 0),
        'lastSync' => (int) ($d->lastSync ?? 0),
        'added' => (int) ($d->added ?? 0),
        'err' => isset($d->err) && $d->err ? (array) $d->err : null,
        'needsSync' => !empty($d->needsSync),
        'env' => (string) ($d->env ?? ''),
    ];
}
/** The bank-account label a Plaid account posts under (what Books > Settings maps to a ledger account). */
function plaidAcctLabel(stdClass $item, array $acct): string
{
    $inst = trim((string) ($item->inst ?? ''));
    $name = trim((string) ($acct['name'] ?? $acct['official_name'] ?? 'Account'));
    $mask = trim((string) ($acct['mask'] ?? ''));
    return trim(($inst !== '' ? $inst . ' ' : '') . $name . ($mask !== '' ? ' ••' . $mask : ''));
}
function plaidStoreAccounts(string $itemId, stdClass $item, array $accounts): void
{
    $list = [];
    foreach ($accounts as $a) {
        if (!is_array($a) || empty($a['account_id'])) {
            continue;
        }
        $list[] = (object) [
            'id' => (string) $a['account_id'],
            'name' => (string) ($a['name'] ?? ''),
            'official' => (string) ($a['official_name'] ?? ''),
            'mask' => (string) ($a['mask'] ?? ''),
            'type' => (string) ($a['type'] ?? ''),
            'subtype' => (string) ($a['subtype'] ?? ''),
            'label' => plaidAcctLabel($item, $a),
            'cur' => (string) ($a['balances']['iso_currency_code'] ?? 'USD'),
            'bal' => isset($a['balances']['current']) ? round((float) $a['balances']['current'], 2) : null,
            'avail' => isset($a['balances']['available']) ? round((float) $a['balances']['available'], 2) : null,
            'balAt' => now(),
        ];
    }
    $item->accounts = $list;
    docSet('sec/x/bank/items/' . $itemId, $item);
}
/** Turn one Plaid transaction into a bank line (null for pending ones: they arrive again once posted). */
function plaidLine(stdClass $item, array $t, array $acctById, string $base): ?array
{
    if (!empty($t['pending'])) {
        return null;
    }
    $acct = $acctById[(string) ($t['account_id'] ?? '')] ?? null;
    $amt = round(-(float) ($t['amount'] ?? 0), 2); // Plaid: positive = money out
    if ($amt == 0.0) {
        return null;
    }
    $dt = (string) ($t['authorized_date'] ?? '') ?: (string) ($t['date'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $dt)) {
        return null;
    }
    $pfc = is_array($t['personal_finance_category'] ?? null) ? $t['personal_finance_category'] : [];
    $hint = PLAID_SUBCATS[(string) ($pfc['detailed'] ?? '')] ?? PLAID_CATS[(string) ($pfc['primary'] ?? '')] ?? '';
    $cur = (string) ($t['iso_currency_code'] ?? '') ?: (string) ($t['unofficial_currency_code'] ?? '') ?: $base;
    $merchant = trim((string) ($t['merchant_name'] ?? ''));
    return [
        'dt' => $dt,
        'desc' => mb_substr(trim((string) ($t['name'] ?? $merchant ?: 'Transaction')), 0, 300),
        'a' => $amt,
        'ref' => mb_substr(trim((string) ($t['check_number'] ?? '')), 0, 120),
        'cur' => $cur,
        'acct' => $acct ? (string) $acct->label : plaidAcctLabel($item, ['name' => 'Account']),
        'payee' => mb_substr($merchant, 0, 120),
        'hint' => $hint,
        'pfc' => (string) ($pfc['detailed'] ?? $pfc['primary'] ?? ''),
        'src' => 'plaid',
        'key' => 'plaid:' . (string) ($t['transaction_id'] ?? ''),
        'pid' => (string) ($t['transaction_id'] ?? ''),
    ];
}
/** Pull everything new for one connected bank. Returns counts. */
function plaidSyncItem(string $itemId, ?stdClass $item = null, ?array $cfg = null): array
{
    $cfg = $cfg ?? plaidCfg();
    $item = $item ?? docGet('sec/x/bank/items/' . $itemId);
    if (!$item) {
        throw new RuntimeException('That bank connection is gone.');
    }
    $token = mailUnseal((string) ($item->token ?? ''));
    if ($token === '') {
        throw new RuntimeException('The access token for this bank is missing; connect it again.');
    }
    $acctById = [];
    foreach ((array) ($item->accounts ?? []) as $a) {
        $acctById[(string) $a->id] = $a;
    }
    // existing lines by Plaid id, so modified/removed find their rows and re-runs never duplicate
    $byPid = [];
    foreach (colAll('org/acct/bank') as [$id, $x]) {
        if (!empty($x->pid)) {
            $byPid[(string) $x->pid] = [(string) $id, $x];
        }
    }
    $base = (string) acctSettings()['cur'];
    $cursor = (string) ($item->cursor ?? '');
    $added = 0;
    $modified = 0;
    $removed = 0;
    $pages = 0;
    $now = now();
    do {
        $req = ['access_token' => $token, 'count' => 250, 'options' => ['include_personal_finance_category' => true]];
        if ($cursor !== '') {
            $req['cursor'] = $cursor;
        }
        $r = plaidCall('/transactions/sync', $req, $cfg);
        foreach ((array) ($r['added'] ?? []) as $t) {
            $line = is_array($t) ? plaidLine($item, $t, $acctById, $base) : null;
            if (!$line) {
                continue;
            }
            if (isset($byPid[$line['pid']])) {
                continue;
            }
            $id = rid(10);
            $doc = (object) ($line + ['m' => null, 'cat' => '', 'excl' => false, 'at' => $now, 'u' => $now]);
            docSet('org/acct/bank/' . $id, $doc);
            $byPid[$line['pid']] = [$id, $doc];
            $added++;
        }
        foreach ((array) ($r['modified'] ?? []) as $t) {
            $line = is_array($t) ? plaidLine($item, $t, $acctById, $base) : null;
            if (!$line || !isset($byPid[$line['pid']])) {
                continue;
            }
            [$id, $x] = $byPid[$line['pid']];
            foreach (['dt', 'desc', 'a', 'ref', 'cur', 'payee', 'hint', 'pfc'] as $k) {
                $x->$k = $line[$k];
            }
            $x->u = $now;
            docSet('org/acct/bank/' . $id, $x);
            $modified++;
        }
        foreach ((array) ($r['removed'] ?? []) as $t) {
            $pid = (string) (is_array($t) ? $t['transaction_id'] ?? '' : '');
            if ($pid === '' || !isset($byPid[$pid])) {
                continue;
            }
            [$id, $x] = $byPid[$pid];
            if (!empty($x->m) || (string) ($x->cat ?? '') !== '' || !empty($x->recon)) {
                // already in the books: keep it, flag it, let a person decide
                $x->gone = $now;
                $x->u = $now;
                docSet('org/acct/bank/' . $id, $x);
            } else {
                docDelete('org/acct/bank/' . $id);
            }
            unset($byPid[$pid]);
            $removed++;
        }
        $cursor = (string) ($r['next_cursor'] ?? $cursor);
        // the cursor is saved after each page is applied, so an interrupted sync resumes rather than repeats
        $item->cursor = $cursor;
        docSet('sec/x/bank/items/' . $itemId, $item);
        $pages++;
    } while (!empty($r['has_more']) && $pages < 40);
    $item->lastSync = $now;
    $item->added = (int) ($item->added ?? 0) + $added;
    $item->err = null;
    $item->needsSync = false;
    docSet('sec/x/bank/items/' . $itemId, $item);
    if ($added || $modified || $removed) {
        auditLog('plaid', 'sec/x/bank/items/' . $itemId, 'Bank sync: ' . (string) ($item->inst ?? ''), ['added' => $added, 'modified' => $modified, 'removed' => $removed]);
    }
    return ['added' => $added, 'modified' => $modified, 'removed' => $removed, 'pages' => $pages];
}
/** Every connected bank; errors are kept on the item (shown under Connections) instead of stopping the run. */
function plaidSyncAll(bool $onlyFlagged = false): array
{
    $cfg = plaidCfg();
    $out = ['items' => 0, 'added' => 0, 'modified' => 0, 'removed' => 0, 'errors' => 0];
    if (!$cfg['on']) {
        return $out;
    }
    foreach (plaidItems() as $id => $item) {
        if ($onlyFlagged && empty($item->needsSync) && (int) ($item->lastSync ?? 0) > now() - 6 * 3600 * 1000) {
            continue;
        }
        $out['items']++;
        try {
            $r = plaidSyncItem($id, $item, $cfg);
            $out['added'] += $r['added'];
            $out['modified'] += $r['modified'];
            $out['removed'] += $r['removed'];
        } catch (Throwable $e) {
            $out['errors']++;
            $item->err = (object) ['at' => now(), 'msg' => mb_substr($e->getMessage(), 0, 300)];
            docSet('sec/x/bank/items/' . $id, $item);
        }
    }
    return $out;
}
/** Plaid's webhook: a verified call for a bank we know flags it for the next sync (and syncs it right away). */
function plaidWebhook(string $raw): never
{
    $j = json_decode($raw, true);
    if (!is_array($j)) {
        http_response_code(400);
        exit('bad request');
    }
    $itemId = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($j['item_id'] ?? ''));
    $items = plaidItems();
    $found = null;
    foreach ($items as $id => $d) {
        if ((string) ($d->plaidItem ?? '') === $itemId) {
            $found = $id;
            break;
        }
    }
    if ($found === null) {
        http_response_code(200);
        exit('ignored');
    }
    $item = $items[$found];
    $verified = plaidVerifyWebhook($raw);
    if ($verified === false) {
        http_response_code(401);
        exit('signature');
    }
    $type = (string) ($j['webhook_type'] ?? '');
    $code = (string) ($j['webhook_code'] ?? '');
    if ($type === 'ITEM' && in_array($code, ['ERROR', 'PENDING_EXPIRATION', 'LOGIN_REPAIRED', 'USER_PERMISSION_REVOKED'], true)) {
        $item->err = $code === 'LOGIN_REPAIRED' ? null : (object) ['at' => now(), 'msg' => $code === 'PENDING_EXPIRATION' ? 'The bank login expires soon; reconnect it.' : (string) ($j['error']['error_message'] ?? $code)];
    }
    $item->needsSync = true;
    $item->whAt = now();
    docSet('sec/x/bank/items/' . $found, $item);
    if ($type === 'TRANSACTIONS' || $type === 'ITEM') {
        try {
            plaidSyncItem($found, $item);
        } catch (Throwable $e) {
            // the next cron run retries
        }
    }
    http_response_code(200);
    exit('ok');
}
/** Plaid signs webhooks with a JWT (ES256). true = verified, false = bad signature, null = could not check. */
function plaidVerifyWebhook(string $raw): ?bool
{
    $jwt = (string) ($_SERVER['HTTP_PLAID_VERIFICATION'] ?? '');
    if ($jwt === '' || !function_exists('openssl_verify')) {
        return null;
    }
    $parts = explode('.', $jwt);
    if (count($parts) !== 3) {
        return false;
    }
    $b64 = fn(string $s) => (string) base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4));
    $hdr = json_decode($b64($parts[0]), true);
    $pl = json_decode($b64($parts[1]), true);
    if (!is_array($hdr) || !is_array($pl) || ($hdr['alg'] ?? '') !== 'ES256' || empty($hdr['kid'])) {
        return false;
    }
    if ((int) ($pl['iat'] ?? 0) < time() - 300) {
        return false;
    }
    if (hash('sha256', $raw) !== (string) ($pl['request_body_sha256'] ?? '')) {
        return false;
    }
    try {
        $k = plaidCall('/webhook_verification_key/get', ['key_id' => (string) $hdr['kid']]);
    } catch (Throwable $e) {
        return null;
    }
    $key = $k['key'] ?? null;
    if (!is_array($key) || empty($key['x']) || empty($key['y'])) {
        return false;
    }
    // JWK (P-256) → uncompressed point → DER SubjectPublicKeyInfo → PEM
    $x = $b64((string) $key['x']);
    $y = $b64((string) $key['y']);
    $point = "\x04" . str_pad($x, 32, "\0", STR_PAD_LEFT) . str_pad($y, 32, "\0", STR_PAD_LEFT);
    $der = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . $point;
    $pem = "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
    $sig = $b64($parts[2]);
    if (strlen($sig) !== 64) {
        return false;
    }
    // raw r||s → DER ECDSA-Sig-Value
    $int = function (string $v): string {
        $v = ltrim($v, "\0");
        if ($v === '' || (ord($v[0]) & 0x80)) {
            $v = "\0" . $v;
        }
        return "\x02" . chr(strlen($v)) . $v;
    };
    $seq = $int(substr($sig, 0, 32)) . $int(substr($sig, 32));
    $derSig = "\x30" . chr(strlen($seq)) . $seq;
    $ok = openssl_verify($parts[0] . '.' . $parts[1], $derSig, $pem, OPENSSL_ALGO_SHA256);
    return $ok === 1;
}
function plaidWebhookUrl(): string
{
    return siteUrl() . 'api/index.php?r=plaid_webhook';
}

function plaidRoute(string $r, string $method, array $b): never
{
    switch ($r) {
        case 'plaid_settings':
            booksStaff();
            $cfg = plaidCfg();
            $items = [];
            foreach (plaidItems() as $id => $d) {
                $items[] = plaidItemPublic($id, $d);
            }
            ok([
                'on' => $cfg['on'],
                'env' => $cfg['env'],
                'clientId' => $cfg['clientId'],
                'hasSecret' => $cfg['hasSecret'],
                'country' => $cfg['country'],
                'items' => $items,
                'webhook' => plaidWebhookUrl(),
                'curl' => function_exists('curl_init'),
                'u' => $cfg['u'],
            ]);
        case 'plaid_settings_save':
            $u = requireAdmin();
            if (!hasRole($u, 'admin')) {
                fail(403, 'forbidden', 'Only an administrator can change the bank connection keys.');
            }
            $d = docGet('sec/x/bank/plaid') ?? new stdClass();
            $d->on = !empty($b['on']);
            $env = str($b, 'env', 12);
            $d->env = isset(PLAID_HOSTS[$env]) ? $env : 'sandbox';
            $d->clientId = preg_replace('/[^a-f0-9]/', '', (string) ($b['clientId'] ?? ''));
            $secret = trim((string) ($b['secret'] ?? ''));
            if ($secret !== '') {
                $d->secret = mailSeal(preg_replace('/[^a-f0-9]/', '', $secret));
            }
            if (!empty($b['clearSecret'])) {
                $d->secret = '';
            }
            $d->country = preg_replace('/[^A-Z]/', '', strtoupper(str($b, 'country', 2))) ?: 'US';
            $d->u = now();
            docSet('sec/x/bank/plaid', $d);
            auditLog('plaid', 'sec/x/bank/plaid', 'Bank connection settings changed', ['on' => $d->on, 'env' => $d->env], $u);
            ok(['saved' => true]);
        case 'plaid_link_token':
            // a short-lived token the browser hands to Plaid Link (new bank, or update mode to repair a login)
            $u = booksStaff(true);
            $cfg = plaidCfg();
            if (!$cfg['on']) {
                fail(400, 'invalid_argument', 'Switch the bank connection on and add the Plaid keys first.');
            }
            $req = [
                'client_name' => (string) cfg('mail_from_name') ?: 'StratEdge',
                'language' => 'en',
                'country_codes' => [$cfg['country'] ?: 'US'],
                'user' => ['client_user_id' => (string) $u['id']],
                'webhook' => plaidWebhookUrl(),
            ];
            $itemId = preg_replace('/[^a-z0-9]/', '', (string) ($b['itemId'] ?? ''));
            if ($itemId !== '') {
                $item = docGet('sec/x/bank/items/' . $itemId);
                if (!$item) {
                    fail(404, 'not_found', 'That bank connection is gone.');
                }
                $req['access_token'] = mailUnseal((string) ($item->token ?? ''));
            } else {
                $req['products'] = ['transactions'];
                $req['transactions'] = ['days_requested' => max(30, min(730, (int) ($b['days'] ?? 90)))];
            }
            try {
                $r = plaidCall('/link/token/create', $req, $cfg);
            } catch (Throwable $e) {
                fail(502, 'plaid', $e->getMessage());
            }
            ok(['token' => (string) ($r['link_token'] ?? ''), 'exp' => (string) ($r['expiration'] ?? '')]);
        case 'plaid_exchange':
            // Link finished: swap the public token for an access token, remember the bank and pull its history
            $u = booksStaff(true);
            $cfg = plaidCfg();
            $pub = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($b['public_token'] ?? ''));
            if ($pub === '') {
                fail(400, 'invalid_argument', 'No public token.');
            }
            $meta = is_array($b['metadata'] ?? null) ? $b['metadata'] : [];
            try {
                $r = plaidCall('/item/public_token/exchange', ['public_token' => $pub], $cfg);
                $token = (string) ($r['access_token'] ?? '');
                $plaidItem = (string) ($r['item_id'] ?? '');
                if ($token === '') {
                    throw new RuntimeException('Plaid returned no access token.');
                }
                $id = rid(8);
                $inst = is_array($meta['institution'] ?? null) ? $meta['institution'] : [];
                $item = (object) [
                    'token' => mailSeal($token),
                    'plaidItem' => $plaidItem,
                    'inst' => mb_substr((string) ($inst['name'] ?? 'Bank'), 0, 80),
                    'instId' => (string) ($inst['institution_id'] ?? ''),
                    'env' => $cfg['env'],
                    'at' => now(),
                    'by' => $u['id'],
                    'cursor' => '',
                    'accounts' => [],
                ];
                docSet('sec/x/bank/items/' . $id, $item);
                $acc = plaidCall('/accounts/get', ['access_token' => $token], $cfg);
                plaidStoreAccounts($id, $item, (array) ($acc['accounts'] ?? []));
                auditLog('plaid', 'sec/x/bank/items/' . $id, 'Bank connected: ' . $item->inst, ['accounts' => count((array) $item->accounts)], $u);
                $sync = ['added' => 0, 'pending' => true];
                try {
                    $sync = plaidSyncItem($id, $item, $cfg);
                } catch (Throwable $e) {
                    // the first transactions can take Plaid a moment; the webhook or the next "Sync now" gets them
                    $item->needsSync = true;
                    docSet('sec/x/bank/items/' . $id, $item);
                }
            } catch (Throwable $e) {
                fail(502, 'plaid', $e->getMessage());
            }
            ok(['item' => plaidItemPublic($id, docGet('sec/x/bank/items/' . $id)), 'sync' => $sync]);
        case 'plaid_sync':
            booksStaff(true);
            $itemId = preg_replace('/[^a-z0-9]/', '', (string) ($b['itemId'] ?? ''));
            if ($itemId !== '') {
                try {
                    $r = plaidSyncItem($itemId);
                } catch (Throwable $e) {
                    $item = docGet('sec/x/bank/items/' . $itemId);
                    if ($item) {
                        $item->err = (object) ['at' => now(), 'msg' => mb_substr($e->getMessage(), 0, 300)];
                        docSet('sec/x/bank/items/' . $itemId, $item);
                    }
                    fail(502, 'plaid', $e->getMessage());
                }
                ok($r);
            }
            ok(plaidSyncAll(false));
        case 'plaid_balances':
            booksStaff();
            $itemId = preg_replace('/[^a-z0-9]/', '', (string) ($b['itemId'] ?? ''));
            $item = $itemId !== '' ? docGet('sec/x/bank/items/' . $itemId) : null;
            if (!$item) {
                fail(404, 'not_found', 'That bank connection is gone.');
            }
            try {
                $acc = plaidCall('/accounts/balance/get', ['access_token' => mailUnseal((string) ($item->token ?? ''))]);
                plaidStoreAccounts($itemId, $item, (array) ($acc['accounts'] ?? []));
            } catch (Throwable $e) {
                fail(502, 'plaid', $e->getMessage());
            }
            ok(['item' => plaidItemPublic($itemId, $item)]);
        case 'plaid_remove':
            $u = requireAdmin();
            if (!hasRole($u, 'admin')) {
                fail(403, 'forbidden', 'Only an administrator can disconnect a bank.');
            }
            $itemId = preg_replace('/[^a-z0-9]/', '', (string) ($b['itemId'] ?? ''));
            $item = $itemId !== '' ? docGet('sec/x/bank/items/' . $itemId) : null;
            if (!$item) {
                fail(404, 'not_found', 'That bank connection is gone.');
            }
            try {
                plaidCall('/item/remove', ['access_token' => mailUnseal((string) ($item->token ?? ''))]);
            } catch (Throwable $e) {
                // the token may already be dead; the local record goes either way
            }
            docDelete('sec/x/bank/items/' . $itemId);
            auditLog('plaid', 'sec/x/bank/items/' . $itemId, 'Bank disconnected: ' . (string) ($item->inst ?? ''), [], $u);
            ok(['removed' => true]);
        case 'plaid_sandbox_item':
            // sandbox only: connect Plaid's test bank without the Link window (handy to see the flow end to end)
            $u = booksStaff(true);
            $cfg = plaidCfg();
            if ($cfg['env'] !== 'sandbox') {
                fail(400, 'invalid_argument', 'Test banks exist only in the sandbox environment.');
            }
            try {
                $r = plaidCall('/sandbox/public_token/create', ['institution_id' => 'ins_109508', 'initial_products' => ['transactions'], 'options' => ['webhook' => plaidWebhookUrl()]], $cfg);
            } catch (Throwable $e) {
                fail(502, 'plaid', $e->getMessage());
            }
            $_POST = [];
            plaidRoute('plaid_exchange', 'POST', ['public_token' => (string) ($r['public_token'] ?? ''), 'metadata' => ['institution' => ['name' => 'First Platypus Bank (sandbox)', 'institution_id' => 'ins_109508']]]);
        default:
            fail(404, 'not_found', 'Unknown action.');
    }
}
