<?php
declare(strict_types=1);
/*
  v40: the personal tax center (routes tax_*). Everyone with a portal account gets a refund estimate for 2025 and 2026
  (federal Form 1040 and their state), worked out in the browser (js/tax.js, from assets/tax/<year>.json) from:
    - the pay recorded in this portal: the W-2 figures so far (paystubs of the year), each paystub for the projection to
      Dec 31, 1099-NEC payments made through payroll, the company's pay schedule;
    - the person's own answers (filing status, dependents, other jobs and income, deductions, credits, payments),
      saved here sealed with the site key (table tax_prof, one row per person and year), and the refund tracker.
  Nobody else reads them: no route returns another person's answers, administrators included. "Delete my tax
  answers" removes them. Social security numbers, bank account numbers and addresses for the printed forms are typed
  into the browser when the forms are made and are never sent here.
*/

const TAX_YEARS = [2025, 2026];

function taxDb(): PDO
{
    static $ready = false;
    $p = db();
    if (!$ready) {
        $ready = true;
        $p->exec('CREATE TABLE IF NOT EXISTS tax_prof (uid VARCHAR(40) NOT NULL, year INT NOT NULL, data LONGTEXT NOT NULL, u BIGINT NOT NULL, PRIMARY KEY (uid, year))');
    }
    return $p;
}
function taxYear(array $b): int
{
    $y = (int) ($b['year'] ?? 0);
    if (!in_array($y, TAX_YEARS, true)) {
        fail(400, 'invalid_argument', 'The tax center covers ' . implode(' and ', TAX_YEARS) . '.');
    }
    return $y;
}
/** The person's saved answers and refund tracker for a year: ['prof' => [...], 'track' => [...], 'u' => ms] or null. */
function taxLoad(string $uid, int $year): ?array
{
    $s = taxDb()->prepare('SELECT data, u FROM tax_prof WHERE uid = ? AND year = ?');
    $s->execute([$uid, $year]);
    $row = $s->fetch();
    if (!$row) {
        return null;
    }
    require_once __DIR__ . '/mail.php';
    try {
        $j = json_decode(mailUnseal((string) $row['data']), true);
    } catch (Throwable $e) {
        $j = null;
    }
    return is_array($j) ? $j + ['u' => (int) $row['u']] : null;
}
function taxStore(string $uid, int $year, array $data): int
{
    require_once __DIR__ . '/mail.php';
    $u = now();
    unset($data['u']);
    $sealed = mailSeal((string) json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    $db = taxDb();
    $db->prepare('DELETE FROM tax_prof WHERE uid = ? AND year = ?')->execute([$uid, $year]);
    $db->prepare('INSERT INTO tax_prof (uid, year, data, u) VALUES (?, ?, ?, ?)')->execute([$uid, $year, $sealed, $u]);
    return $u;
}
/** Answers come back exactly as the page keeps them, within limits: plain data only, no deeper than 6 levels, 64 KB. */
function taxClean($v, int $depth = 0)
{
    if ($depth > 6) {
        return null;
    }
    if (is_array($v)) {
        $out = [];
        $i = 0;
        foreach ($v as $k => $x) {
            if (++$i > 120) {
                break;
            }
            $key = is_int($k) ? $k : mb_substr(preg_replace('/[^A-Za-z0-9_]/', '', (string) $k), 0, 30);
            if ($key === '') {
                continue;
            }
            $out[$key] = taxClean($x, $depth + 1);
        }
        return $out;
    }
    if (is_bool($v) || $v === null) {
        return $v;
    }
    if (is_int($v) || is_float($v)) {
        return is_finite((float) $v) ? round((float) $v, 2) : 0;
    }
    return mb_substr(trim((string) $v), 0, 200);
}
/** One paystub as W-2 boxes (the same reading of a paystub as payTaxSummary in payroll.php). */
function taxStubBoxes(stdClass $st): array
{
    $sum = fn(array $list, callable $f) => array_reduce($list, fn($a, $x) => $a + (float) $f($x), 0.0);
    $gross = round((float) ($st->gross ?? 0), 2);
    $taxes = array_filter((array) ($st->taxes ?? []), fn($t) => $t instanceof stdClass);
    $er = array_filter((array) ($st->employer ?? []), fn($t) => $t instanceof stdClass);
    $w = (array) ($st->wages ?? []);
    $pick = fn(array $list, string $re) => $sum(array_filter($list, fn($t) => preg_match($re, (string) ($t->n ?? ''))), fn($t) => $t->v ?? 0);
    $ficaW = isset($w['fica']) ? (float) $w['fica'] : $gross;
    $b = [
        'b1' => isset($w['fit']) ? (float) $w['fit'] : $gross,
        'b2' => $pick($taxes, '/^Federal income tax/'),
        'b3' => isset($w['ss']) ? (float) $w['ss'] : $ficaW,
        'b4' => $pick($taxes, '/^Social Security \(/'),
        'b5' => $ficaW,
        'b6' => $pick($taxes, '/^Medicare \(/') + $pick($taxes, '/^Additional Medicare/'),
        'b16' => isset($w['state']) ? (float) $w['state'] : $gross,
        'b17' => $sum(array_filter($taxes, fn($t) => (string) ($t->g ?? '') === 'state' && preg_match('/income tax$/', (string) ($t->n ?? ''))), fn($t) => $t->v ?? 0),
        'b19' => $sum(array_filter($taxes, fn($t) => (string) ($t->g ?? '') === 'local'), fn($t) => $t->v ?? 0),
        'b12d' => 0, 'b12aa' => 0, 'b12w' => 0, 'b10' => 0,
    ];
    foreach (array_merge((array) ($st->pre ?? []), (array) ($st->post ?? [])) as $l) {
        if (!($l instanceof stdClass)) {
            continue;
        }
        $kind = (string) ($l->kind ?? '');
        $v = (float) ($l->v ?? 0);
        if ($kind === 'k401') {
            $b['b12d'] += $v;
        } elseif ($kind === 'roth') {
            $b['b12aa'] += $v;
        } elseif ($kind === 'hsa') {
            $b['b12w'] += $v;
        } elseif ($kind === 'dcfsa' || $kind === 'dependent_care') {
            $b['b10'] += $v;
        }
    }
    foreach ($er as $l) {
        if ((string) ($l->kind ?? '') === 'hsa') {
            $b['b12w'] += (float) ($l->v ?? 0);
        }
    }
    foreach ($b as $k => $v) {
        $b[$k] = round((float) $v, 2);
    }
    return $b;
}
/** What the portal knows for the year: the W-2 so far (with each paystub, for the projection), 1099-NEC payments
 *  through payroll, payments to the person's own company (C2C), the pay schedule. */
function taxFacts(string $uid, int $year): array
{
    $s = db()->prepare('SELECT path, data FROM docs WHERE col = ?');
    $s->execute(['pays/' . $uid . '/items']);
    $stubs = [];
    $nec = [];
    $c2c = 0.0;
    $state = '';
    $employer = '';
    while ($row = $s->fetch()) {
        $st = json_decode((string) $row['data']);
        if (!($st instanceof stdClass) || !in_array((string) ($st->st ?? ''), ['final', 'paid'], true)) {
            continue;
        }
        $country = isset($st->country) ? (string) $st->country : (((string) ($st->cur ?? '')) === 'USD' ? 'US' : 'IN');
        if ($country !== 'US') {
            continue;
        }
        $payDate = (string) ($st->paidOn ?? ($st->payDate ?? ''));
        $yk = (string) ($st->yk ?? '');
        $key = (string) substr((string) $row['path'], strlen('pays/' . $uid . '/items/'));
        $yr = preg_match('/^\d{4}-\d{2}-\d{2}$/', $payDate) ? (int) substr($payDate, 0, 4) : ($yk !== '' ? (int) $yk : (int) substr($key, 0, 4));
        if ($yr !== $year) {
            continue;
        }
        $wtype = (string) ($st->wtype ?? 'w2');
        $d = preg_match('/^\d{4}-\d{2}-\d{2}$/', $payDate) ? $payDate : (preg_match('/^\d{4}-\d{2}/', $key) ? substr($key, 0, 7) . '-28' : $year . '-12-31');
        if ($wtype === 'w2') {
            $stubs[] = ['d' => $d] + taxStubBoxes($st);
            if ((string) ($st->state ?? '') !== '') {
                $state = strtoupper((string) $st->state);
            }
            $employer = (string) ($st->employerName ?? $employer);
        } elseif ($wtype === 'c2c') {
            $c2c += (float) ($st->net ?? ($st->gross ?? 0));
        } else {
            $nec[] = ['d' => $d, 'amt' => round((float) ($st->net ?? ($st->gross ?? 0)), 2)];
        }
    }
    usort($stubs, fn($a, $b) => strcmp($a['d'], $b['d']));
    usort($nec, fn($a, $b) => strcmp($a['d'], $b['d']));
    $w2 = null;
    if ($stubs) {
        $w2 = ['employer' => '', 'st' => $state, 'runs' => count($stubs), 'last' => end($stubs)['d']];
        foreach (['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b16', 'b17', 'b19', 'b12d', 'b12aa', 'b12w', 'b10'] as $k) {
            $w2[$k] = round(array_sum(array_column($stubs, $k)), 2);
        }
        $w2['retire'] = $w2['b12d'] > 0 || $w2['b12aa'] > 0;
    }
    $org = docGet('org/main/x/settings');
    $inv = $org && isset($org->inv) && $org->inv instanceof stdClass ? $org->inv : new stdClass();
    $co = (string) ($inv->co ?? 'StratEdge IT Consulting Inc.');
    if ($w2) {
        $w2['employer'] = $co;
    }
    $necTotal = round(array_sum(array_column($nec, 'amt')), 2);
    return [
        'year' => $year,
        'w2' => $w2,
        'stubs' => $stubs,
        'nec' => $necTotal > 0 ? [['payer' => $co, 'total' => $necTotal, 'runs' => count($nec), 'last' => end($nec)['d']]] : [],
        'necStubs' => $nec,
        'c2c' => round($c2c, 2),
        'sched' => ['payFreq' => (string) ($org->payFreq ?? 'monthly'), 'payAnchor' => (string) ($org->payAnchor ?? ''), 'payStart' => $org->payStart ?? null, 'payLag' => $org->payLag ?? null],
    ];
}
/** What the portal knows about the person that helps fill the answers in (their own records only). */
function taxAbout(array $u): array
{
    $uid = (string) $u['id'];
    $rec = docGet('hrms/emp/' . $uid . '/rec');
    $prof = docGet('u/' . $uid);
    $p = $prof && isset($prof->p) && $prof->p instanceof stdClass ? $prof->p : new stdClass();
    $dob = (string) ($rec->dob ?? '');
    $state = strtoupper(trim((string) ($rec->state ?? '')));
    $names = ['NEW JERSEY' => 'NJ', 'NEW YORK' => 'NY', 'CALIFORNIA' => 'CA', 'TEXAS' => 'TX', 'PENNSYLVANIA' => 'PA', 'FLORIDA' => 'FL', 'ILLINOIS' => 'IL', 'GEORGIA' => 'GA', 'NORTH CAROLINA' => 'NC', 'VIRGINIA' => 'VA', 'WASHINGTON' => 'WA', 'MASSACHUSETTS' => 'MA', 'OHIO' => 'OH', 'MICHIGAN' => 'MI', 'MARYLAND' => 'MD', 'CONNECTICUT' => 'CT', 'ARIZONA' => 'AZ', 'COLORADO' => 'CO', 'INDIANA' => 'IN', 'MINNESOTA' => 'MN', 'DELAWARE' => 'DE'];
    if (isset($names[$state])) {
        $state = $names[$state];
    }
    if (!preg_match('/^[A-Z]{2}$/', $state)) {
        $state = '';
    }
    $auth = '';
    $ct = '';
    try {
        require_once __DIR__ . '/rules.php';
        $auth = ruleAuthOf($uid);
        $ct = ruleCtOf($uid);
    } catch (Throwable $e) {
        // the answers stay blank
    }
    return [
        'name' => (string) ($u['name'] ?? ''),
        'born' => preg_match('/^(\d{4})-\d{2}-\d{2}$/', $dob, $m) ? (int) $m[1] : 0,
        'state' => $state,
        'addr' => ['line' => trim((string) ($rec->addr1 ?? '')), 'apt' => trim((string) ($rec->addr2 ?? '')), 'city' => trim((string) ($rec->city ?? '')), 'state' => $state, 'zip' => trim((string) ($rec->zip ?? ''))],
        'phone' => (string) ($p->ph ?? ''),
        'email' => (string) ($u['email'] ?? ''),
        'auth' => $auth,
        'ct' => $ct,
    ];
}
function taxRoute(string $r, array $b): never
{
    $u = requireUser();
    $uid = (string) $u['id'];
    switch ($r) {
        case 'tax_get':
            // the year's answers, refund tracker and what the portal knows (pay, the person's record)
            $year = taxYear($b);
            $saved = taxLoad($uid, $year);
            ok(['year' => $year, 'years' => TAX_YEARS, 'prof' => $saved['prof'] ?? null, 'track' => $saved['track'] ?? null, 'u' => $saved['u'] ?? 0, 'facts' => taxFacts($uid, $year), 'about' => taxAbout($u)]);

        case 'tax_save':
            // the answers (and, when sent, the refund tracker); sealed; only the person reads them back
            $year = taxYear($b);
            if (throttleHit('taxsave:' . $uid, 600, 3600)) {
                fail(429, 'rate_limited', 'Saved many times in the last hour. Try again in a few minutes.');
            }
            $raw = json_encode($b['prof'] ?? null);
            if (!is_array($b['prof'] ?? null) || strlen((string) $raw) > 65536) {
                fail(400, 'invalid_argument', 'The answers could not be saved (too much, or not in the expected shape).');
            }
            $cur = taxLoad($uid, $year) ?? [];
            $data = ['prof' => taxClean($b['prof']), 'track' => is_array($b['track'] ?? null) ? taxClean($b['track']) : ($cur['track'] ?? null)];
            $at = taxStore($uid, $year, $data);
            ok(['u' => $at]);

        case 'tax_track':
            // the refund tracker: filed on, how, refund expected, what the IRS / the state said
            $year = taxYear($b);
            if (!is_array($b['track'] ?? null) || strlen((string) json_encode($b['track'])) > 16384) {
                fail(400, 'invalid_argument', 'The tracker could not be saved.');
            }
            $cur = taxLoad($uid, $year) ?? [];
            $at = taxStore($uid, $year, ['prof' => $cur['prof'] ?? null, 'track' => taxClean($b['track'])]);
            ok(['u' => $at]);

        case 'tax_delete':
            // "Delete my tax answers" for one year (or every year)
            $years = !empty($b['all']) ? TAX_YEARS : [taxYear($b)];
            $s = taxDb()->prepare('DELETE FROM tax_prof WHERE uid = ? AND year = ?');
            foreach ($years as $y) {
                $s->execute([$uid, $y]);
            }
            ok(['deleted' => $years]);
    }
    fail(404, 'not_found', 'Unknown action.');
}
