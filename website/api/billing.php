<?php
declare(strict_types=1);
/*
  v32: plans and payments for students and outside consultants (Admin > Plans & payments).

  Plans (bill/x/plans/{id}) are paid once, in installments, or monthly. A person's enrollment is bill/{uid}: the plan,
  its payment schedule (items), placement-fee items, the fee terms they agreed to, and their Stripe customer and
  subscription. Payments come in two ways, as the administrator set up:
    - online through Stripe Checkout (cards; installments and monthly plans as a Stripe subscription that charges
      automatically and stops after the last installment). A payment is confirmed when the person comes back from
      Stripe (the session is looked up), by the webhook (api/index.php?r=stripe_webhook) and by a sync of the
      subscription's paid invoices, so a missed webhook never loses a payment;
    - manually (Zelle, bank transfer, check): the person reports it, staff mark it received.
  Access (courses, certifications, tests, live projects, resume tailoring, job applications) follows the plan's
  features while the enrollment is active; an installment unpaid past the grace days pauses it.
  Placement fees: terms per engagement type (Admin > Plans & payments > Placement fees), shown to outside
  consultants and students when they apply and agreed to; staff add the fee to the person's account once placed.
  Secrets (Stripe secret key, webhook signing secret) live sealed in sec/x/bill.
*/
require_once __DIR__ . '/mail.php';
require_once __DIR__ . '/rules.php';

const BILL_FEATURES = [
    'learn' => 'Courses',
    'cert' => 'StratEdge certifications',
    'tests' => 'Daily and weekly tests',
    'projects' => 'Live projects and the project vault',
    'tailor' => 'Resume tailoring',
    'apply' => 'Job applications through the portal (C2C to full-time)',
    'mentor' => 'A mentor, mock interviews and practice calls',
    'market' => 'Marketing to clients by the recruiting team',
];
const BILL_KINDS = ['once', 'install', 'monthly'];
// who can buy a plan: students, outside consultants, or (v34, the job placement programs) both
const BILL_AUDS = ['student', 'outside', 'all'];
/* v34: the job placement programs from the StratEdge brochure (Basic, Elite, Premium and a Custom plan quoted after a
   call). Created once on every site (Admin > Plans & payments edits or removes them); the comparison table on the
   pricing page is website content (Admin > Website & messages > Pricing). */
const BILL_PLACEMENT_SEED = [
    ['basic', 'Basic', 150000, 110, ['apply', 'tailor'], 'Get your applications out every day: a job application assistant, a resume in the standard format and ATS keyword and LinkedIn optimization.', ['Job application assistant: 60+ applications a day', 'Resume preparation (standard format)', 'PDF-based resume consultation', 'ATS keyword and LinkedIn optimization', 'Onboarding support'], false],
    ['elite', 'Elite', 300000, 120, ['apply', 'tailor', 'tests', 'mentor', 'learn', 'projects', 'market'], 'A recruiter on your side: exclusive openings, your resume sent to direct clients, interview preparation and industry-specific technical training.', ['Personalized recruiter support', '80+ applications a day, with internal (exclusive) openings', 'Resume sent to direct clients\' requirements', 'Cover letter and one-on-one resume consultation', 'Assessment, test and interview support', 'Industry-specific technical training', 'Job guarantee (conditional)'], false],
    ['premium', 'Premium', 500000, 130, ['apply', 'tailor', 'tests', 'mentor', 'learn', 'projects', 'market', 'cert'], 'Everything, at top priority: a resume tailored for each job, AI-powered ATS optimization, VIP interview preparation, certifications and automation tools.', ['150+ applications a day; top priority for direct clients', 'A resume tailored for each job description', 'AI-powered ATS keyword optimization', 'VIP, personalized preparation for every interview', 'Certifications and job-search automation tools', 'Email and LinkedIn chat support', 'Job guarantee (conditional)'], false],
    ['custom', 'Custom', 0, 140, [], 'Pick the services you need, for one role or a whole job search, at your pace. We put a plan together after a free call.', ['Any mix of the services in Basic, Elite and Premium', 'Help for one interview, one role or a full search', 'A price agreed in writing before you start'], true],
];

/* ---------- settings ---------- */

function billCfg(): array
{
    static $c = null;
    if ($c !== null) {
        return $c;
    }
    $d = docGet('sec/x/bill');
    $sk = (string) ($d->sk ?? '');
    $wh = (string) ($d->wh ?? '');
    $c = [
        'sk' => $sk !== '' ? mailUnseal($sk) : '',
        'wh' => $wh !== '' ? mailUnseal($wh) : '',
        'cur' => preg_match('/^[a-z]{3}$/', (string) ($d->cur ?? '')) ? (string) $d->cur : 'usd',
        'manual' => (string) ($d->manual ?? ''),
        'grace' => max(0, min(60, (int) ($d->grace ?? 5))),
        'unlock' => !empty($d->unlock),
        'remind' => !isset($d->remind) || !empty($d->remind),
        'okAt' => (int) ($d->okAt ?? 0),
        'okAcct' => (string) ($d->okAcct ?? ''),
    ];
    return $c;
}
function billStripeOn(): bool
{
    return billCfg()['sk'] !== '';
}
function billMoney(int $cents, string $cur = ''): string
{
    $cur = strtoupper($cur ?: billCfg()['cur']);
    $sym = ['USD' => '$', 'CAD' => 'CA$', 'EUR' => '€', 'GBP' => '£', 'INR' => '₹', 'AUD' => 'A$'][$cur] ?? $cur . ' ';
    return $sym . number_format($cents / 100, $cents % 100 ? 2 : 0);
}

/* ---------- plans ---------- */

function billPlans(string $aud = '', bool $all = false): array
{
    $out = [];
    foreach (colAll('bill/x/plans') as [$id, $d]) {
        $p = json_decode((string) json_encode($d), true) ?: [];
        $p['id'] = (string) $id;
        if ((!$all && empty($p['pub'])) || ($aud !== '' && !in_array($p['aud'] ?? '', [$aud, 'all'], true))) {
            continue;
        }
        $out[] = billPlanOut($p);
    }
    usort($out, fn($a, $b) => [$a['ord'], $a['price']] <=> [$b['ord'], $b['price']]);
    return $out;
}
/** v34: the three student plans shown on the pricing page (Starter $199, Career $499, Placement-ready $999), created
 *  once on a site that has no student plans yet. Admin > Plans & payments edits or removes them. */
function billSeedPlans(): void
{
    $m = docGet('bill/x/meta');
    $built = (array) ($m->builtins ?? []);
    // v34: the job placement programs are added once on every site, even one that already has its own plans
    if (count(array_intersect(['basic', 'elite', 'premium', 'custom'], $built)) < 4) {
        foreach (BILL_PLACEMENT_SEED as [$id, $t, $price, $ord, $feat, $d, $perks, $quote]) {
            if (!in_array($id, $built, true) && !docGet("bill/x/plans/$id")) {
                docSet("bill/x/plans/$id", json_decode((string) json_encode(['t' => $t, 'aud' => 'all', 'line' => 'placement', 'quote' => $quote, 'd' => $d, 'price' => $price, 'kind' => 'once', 'n' => 1, 'every' => 'month', 'feat' => $feat, 'perks' => $perks, 'months' => 0, 'pub' => true, 'ord' => $ord, 'u' => now(), 'by' => 'system'])));
            }
            $built[] = $id;
        }
        $built = array_values(array_unique($built));
        docSet('bill/x/meta', (object) ['seeded' => (int) ($m->seeded ?? 0), 'builtins' => $built]);
        $m = docGet('bill/x/meta');
    }
    if ($m && !empty($m->seeded)) {
        return;
    }
    $have = false;
    foreach (colAll('bill/x/plans') as [, $p]) {
        if (($p->aud ?? '') === 'student') {
            $have = true;
            break;
        }
    }
    if (!$have) {
        $plans = [
            ['starter', 'Starter', 19900, 3, 10, ['learn', 'tests', 'tailor'], 'Build the basics and practise every day: every course (USCIS compliance, working through StratEdge, interview readiness and more), daily and weekly tests that show where you stand, and resume tailoring for the roles you apply to.'],
            ['career', 'Career', 49900, 6, 20, ['learn', 'cert', 'tests', 'projects', 'tailor', 'apply'], 'Everything in Starter, plus StratEdge certifications that employers can verify online, live client-style projects for your portfolio and interviews, and job applications through the portal, from C2C to full-time.'],
            ['placement', 'Placement-ready', 99900, 12, 30, ['learn', 'cert', 'tests', 'projects', 'tailor', 'apply', 'mentor', 'market'], 'Everything in Career, plus a mentor and mock interviews before your client interviews, and your profile marketed to clients and vendors by the StratEdge recruiting team.'],
        ];
        foreach ($plans as [$id, $t, $price, $months, $ord, $feat, $d]) {
            if (!docGet("bill/x/plans/$id")) {
                docSet("bill/x/plans/$id", json_decode((string) json_encode(['t' => $t, 'aud' => 'student', 'd' => $d, 'price' => $price, 'kind' => 'once', 'n' => 1, 'every' => 'month', 'feat' => $feat, 'perks' => [], 'months' => $months, 'pub' => true, 'ord' => $ord, 'u' => now(), 'by' => 'system'])));
            }
        }
    }
    docSet('bill/x/meta', (object) ['seeded' => now(), 'builtins' => array_values(array_unique(array_merge($built, ['starter', 'career', 'placement'])))]);
}
function billPlanOut(array $p): array
{
    $kind = in_array($p['kind'] ?? '', BILL_KINDS, true) ? $p['kind'] : 'once';
    $n = max(1, (int) ($p['n'] ?? 1));
    $price = max(0, (int) ($p['price'] ?? 0));
    $each = $kind === 'install' ? (int) ceil($price / $n) : $price;
    $every = ($p['every'] ?? '') === 'week' ? 'week' : 'month';
    $quote = !empty($p['quote']);
    $label = $quote ? 'Price agreed after a free call' : match ($kind) {
        'once' => billMoney($price) . ' once',
        'install' => $n . ' payments of ' . billMoney($each) . ' (' . ($every === 'week' ? 'weekly' : 'monthly') . '), ' . billMoney($price) . ' in all',
        'monthly' => billMoney($price) . ' a month' . ((int) ($p['n'] ?? 0) > 0 ? ' for ' . (int) $p['n'] . ' months' : ''),
    };
    return [
        'id' => (string) $p['id'],
        't' => (string) ($p['t'] ?? 'Plan'),
        'aud' => in_array($p['aud'] ?? '', BILL_AUDS, true) ? $p['aud'] : 'student',
        'line' => ($p['line'] ?? '') === 'placement' ? 'placement' : '',
        'quote' => $quote,
        'd' => (string) ($p['d'] ?? ''),
        'price' => $price,
        'kind' => $kind,
        'n' => $kind === 'once' ? 1 : (int) ($p['n'] ?? ($kind === 'install' ? 2 : 0)),
        'every' => $every,
        'each' => $each,
        'label' => $label,
        'feat' => array_values(array_intersect(array_keys(BILL_FEATURES), (array) ($p['feat'] ?? []))),
        'perks' => array_values(array_filter(array_map(fn($x) => mb_substr(trim((string) $x), 0, 160), (array) ($p['perks'] ?? [])))),
        'months' => max(0, (int) ($p['months'] ?? 0)),
        'pub' => !empty($p['pub']),
        'ord' => (int) ($p['ord'] ?? 50),
        'cur' => billCfg()['cur'],
    ];
}
function billPlan(string $id): ?array
{
    if (!preg_match('/^[A-Za-z0-9_\-]{1,40}$/', $id)) {
        return null;
    }
    $d = docGet("bill/x/plans/$id");
    if (!$d) {
        return null;
    }
    $p = json_decode((string) json_encode($d), true) ?: [];
    $p['id'] = $id;
    return billPlanOut($p);
}

/* ---------- placement fees ---------- */

function billFees(): array
{
    $d = docGet('bill/x/fees');
    $a = $d ? (json_decode((string) json_encode($d), true) ?: []) : [];
    $rules = [];
    require_once __DIR__ . '/rules.php';
    foreach (ENG_KINDS as $e) {
        $r = (array) ($a['rules'][$e] ?? []);
        $kind = in_array($r['kind'] ?? '', ['none', 'flat', 'pct', 'salary'], true) ? $r['kind'] : 'none';
        $rules[$e] = [
            'kind' => $kind,
            'amt' => max(0, (int) ($r['amt'] ?? 0)), // cents (flat)
            'pct' => max(0, min(100, (float) ($r['pct'] ?? 0))), // percent (of billing or salary)
            'months' => max(1, min(24, (int) ($r['months'] ?? 3))), // of the first N months' billing
            'text' => mb_substr(trim((string) ($r['text'] ?? '')), 0, 300),
        ];
    }
    return ['rules' => $rules, 'aud' => array_values(array_intersect(['outside', 'student'], (array) ($a['aud'] ?? ['outside', 'student'])))];
}
/** The placement fee for one engagement type in words ('' when there is none). */
function billFeeText(string $eng): string
{
    $f = billFees();
    $r = $f['rules'][$eng] ?? null;
    if (!$r || $r['kind'] === 'none') {
        return '';
    }
    if ($r['text'] !== '') {
        return $r['text'];
    }
    return match ($r['kind']) {
        'flat' => 'A placement fee of ' . billMoney($r['amt']) . ' once you start',
        'pct' => 'A placement fee of ' . rtrim(rtrim(number_format($r['pct'], 2), '0'), '.') . '% of your first ' . $r['months'] . ' month' . ($r['months'] === 1 ? '' : 's') . '\' billing',
        'salary' => 'A placement fee of ' . rtrim(rtrim(number_format($r['pct'], 2), '0'), '.') . '% of your first-year base salary',
        default => '',
    };
}

/* ---------- a person's enrollment ---------- */

function billDoc(string $uid): array
{
    $d = docGet("bill/$uid");
    $a = $d ? (json_decode((string) json_encode($d), true) ?: []) : [];
    $a['items'] = array_values((array) ($a['items'] ?? []));
    return $a;
}
function billSave(string $uid, array $a): void
{
    $a['u'] = now();
    docSet("bill/$uid", json_decode((string) json_encode($a)));
}
/** The schedule for a plan starting today: one item per payment. */
function billSchedule(array $p): array
{
    $items = [];
    $today = new DateTimeImmutable('today');
    $n = $p['kind'] === 'once' ? 1 : ($p['kind'] === 'install' ? max(1, $p['n']) : max(1, $p['n'] ?: 1));
    $left = $p['price'] * ($p['kind'] === 'monthly' ? $n : 1);
    for ($i = 0; $i < $n; $i++) {
        $amt = $p['kind'] === 'monthly' ? $p['price'] : ($i === $n - 1 ? $left : min($left, $p['each']));
        if ($p['kind'] !== 'monthly') {
            $left -= $amt;
        }
        $due = $p['every'] === 'week' && $p['kind'] === 'install' ? $today->modify('+' . (7 * $i) . ' days') : $today->modify('+' . $i . ' months');
        $items[] = ['id' => 'p' . ($i + 1), 'k' => 'plan', 't' => $p['t'] . ($n > 1 ? ' - payment ' . ($i + 1) . ' of ' . $n : ''), 'amt' => $amt, 'due' => $due->format('Y-m-d'), 'st' => 'due'];
    }
    return $items;
}
/** Status from the items: pending (nothing paid), active, past_due (an installment unpaid past the grace days). */
function billState(array $a): string
{
    if (empty($a['plan'])) {
        return 'none';
    }
    if (in_array($a['st'] ?? '', ['cancelled'], true)) {
        return 'cancelled';
    }
    $c = billCfg();
    $plan = array_values(array_filter($a['items'], fn($x) => ($x['k'] ?? '') === 'plan' && ($x['st'] ?? '') !== 'void'));
    if (!$plan) {
        return 'active';
    }
    $paid = fn($x) => ($x['st'] ?? '') === 'paid' || (($x['st'] ?? '') === 'reported' && $c['unlock']);
    if (!$paid($plan[0]) && ($plan[0]['st'] ?? '') !== 'waived') {
        return 'pending';
    }
    $limit = (new DateTimeImmutable('today'))->modify('-' . $c['grace'] . ' days')->format('Y-m-d');
    foreach ($plan as $x) {
        if (!$paid($x) && ($x['st'] ?? '') !== 'waived' && (string) ($x['due'] ?? '') < $limit) {
            return 'past_due';
        }
    }
    if (!empty($a['open'])) {
        // a monthly plan without an end: paid up to a month after the last month paid for
        $last = '';
        foreach ($plan as $x) {
            if (($paid($x) || ($x['st'] ?? '') === 'waived') && (string) ($x['due'] ?? '') > $last) {
                $last = (string) $x['due'];
            }
        }
        if ($last !== '' && (new DateTimeImmutable($last))->modify('+1 month')->format('Y-m-d') < $limit) {
            return 'past_due';
        }
    }
    $until = (int) ($a['until'] ?? 0);
    if ($until && $until < now()) {
        return 'ended';
    }
    return 'active';
}
/** What a person may use: their type, whether a membership is needed, and the features of an active plan. */
function billAccess(string $uid): array
{
    require_once __DIR__ . '/rules.php';
    $ct = ruleCtOf($uid);
    $a = billDoc($uid);
    $st = billState($a);
    $active = $st === 'active';
    $plans = $ct === 'outside' || $ct === 'student' ? billPlans($ct) : [];
    // v34: the job placement programs are optional extras; only the student plans and memberships make a plan required
    $core = array_filter($plans, fn($p) => $p['line'] !== 'placement' && !$p['quote']);
    return [
        'ct' => $ct,
        'gated' => $ct === 'outside' || $ct === 'student',
        // a membership is needed only when there is one to buy (and, for outside consultants, when it is switched on)
        'required' => ($ct === 'student' || ($ct === 'outside' && ruleSettings()['member'])) && count($core) > 0,
        'st' => $st,
        'active' => $active,
        'plan' => (string) ($a['plan'] ?? ''),
        'pt' => (string) ($a['pt'] ?? ''),
        'feat' => $active ? array_values((array) ($a['feat'] ?? [])) : [],
        'plans' => count($plans),
    ];
}
/** May this person use a feature? Staff, employees and StratEdge's own consultants always may. */
function billCan(string $uid, string $feature): bool
{
    $ct = ruleCtOf($uid);
    if ($ct !== 'outside' && $ct !== 'student') {
        return true;
    }
    $acc = billAccess($uid);
    if (!$acc['gated'] || !$acc['required']) {
        return true;
    }
    return $acc['active'] && in_array($feature, $acc['feat'], true);
}
function billGate(array $u, string $feature): void
{
    if (userLevel($u) >= 2 || billCan($u['id'], $feature)) {
        return;
    }
    $what = [
        'learn' => 'Courses are',
        'cert' => 'StratEdge certifications are',
        'tests' => 'The daily and weekly tests are',
        'projects' => 'Live projects are',
        'tailor' => 'Resume tailoring is',
        'apply' => 'Job applications through the portal are',
        'mentor' => 'Mock interviews and practice calls are',
    ][$feature] ?? 'This is';
    fail(402, 'membership', $what . ' part of a paid plan. Choose one under ' . (ruleCtOf($u['id']) === 'outside' ? 'Membership & fees' : 'Plans & payments') . '.');
}
/** The person's account as they see it. */
function billMeOut(string $uid): array
{
    $a = billDoc($uid);
    $acc = billAccess($uid);
    $c = billCfg();
    $items = array_map(function ($x) {
        $x['amtText'] = billMoney((int) ($x['amt'] ?? 0));
        unset($x['sess']);
        return $x;
    }, $a['items']);
    $next = null;
    foreach ($items as $x) {
        if (in_array($x['st'] ?? '', ['due'], true)) {
            $next = $x;
            break;
        }
    }
    return [
        'access' => $acc,
        'plan' => !empty($a['plan']) ? (billPlan((string) $a['plan']) ?? ['id' => $a['plan'], 't' => $a['pt'] ?? 'Plan']) : null,
        'st' => $acc['st'],
        'items' => $items,
        'next' => $next,
        'auto' => !empty($a['stripe']['sub']),
        'until' => (int) ($a['until'] ?? 0),
        'agreed' => array_slice(array_reverse((array) ($a['agreed'] ?? [])), 0, 30),
        'plans' => $acc['ct'] === 'outside' || $acc['ct'] === 'student' ? billPlans($acc['ct']) : [],
        'fees' => in_array($acc['ct'], billFees()['aud'], true) ? array_filter(array_map(fn($e) => billFeeText($e), array_combine(ENG_KINDS, ENG_KINDS))) : [],
        'stripe' => billStripeOn(),
        'manual' => $c['manual'],
        'cur' => $c['cur'],
        'features' => BILL_FEATURES,
    ];
}
function billNotifyStaff(string $subject, string $text): void
{
    $to = (string) cfg('apply_emails') ?: (string) cfg('mail_from');
    foreach (array_filter(array_map('trim', explode(',', $to))) as $addr) {
        sendMail($addr, 'StratEdge', $subject, $text, emailHtml($subject, [nl2br(htmlspecialchars($text))], ['Open Plans & payments', siteUrl() . '#/portal/admin/billing']));
    }
}

/* ---------- Stripe ---------- */

function billStripe(string $method, string $path, array $params = []): array
{
    $c = billCfg();
    if ($c['sk'] === '') {
        fail(400, 'invalid_argument', 'Online payments are not set up yet. Use the payment instructions, or ask StratEdge.');
    }
    $base = rtrim((string) (getenv('SE_STRIPE_BASE') ?: (cfg('stripe_api') ?: 'https://api.stripe.com')), '/');
    $url = $base . $path . ($method === 'GET' && $params ? '?' . http_build_query($params) : '');
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 40,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_USERPWD => $c['sk'] . ':',
        CURLOPT_HTTPHEADER => ['Stripe-Version: 2024-06-20'],
    ]);
    if ($method !== 'GET' && $params) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($params));
    }
    $res = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    $j = is_string($res) ? json_decode($res, true) : null;
    if ($code >= 400 || !is_array($j)) {
        $msg = is_array($j) ? (string) ($j['error']['message'] ?? 'Stripe refused the request.') : ($err !== '' ? $err : 'Stripe did not answer.');
        @error_log(date('c') . " stripe $method $path: $code $msg\n", 3, storeDir() . '/error.log');
        return ['_error' => $msg, '_code' => $code];
    }
    return $j;
}
/** A Checkout session for a plan's payments (subscription for installments/monthly) or one due item (payment). */
function billCheckout(array $u, array $a, string $itemId, string $returnTo): string
{
    $c = billCfg();
    $plan = billPlan((string) ($a['plan'] ?? ''));
    $item = null;
    foreach ($a['items'] as $x) {
        if ($x['id'] === $itemId) {
            $item = $x;
        }
    }
    if (!$item || ($item['st'] ?? '') === 'paid' || ($item['st'] ?? '') === 'void') {
        fail(400, 'invalid_argument', 'That payment is not due.');
    }
    // Stripe comes back to a plain address (bill_return), which forwards to the portal page that records the payment
    $back = siteUrl() . 'api/index.php?r=bill_return&to=' . rawurlencode($returnTo);
    $p = [
        'success_url' => $back . '&s={CHECKOUT_SESSION_ID}',
        'cancel_url' => $back . '&c=1',
        'client_reference_id' => $u['id'],
        'metadata' => ['uid' => $u['id'], 'item' => $itemId, 'plan' => (string) ($a['plan'] ?? '')],
    ];
    if (!empty($a['stripe']['cus'])) {
        $p['customer'] = $a['stripe']['cus'];
    } else {
        $p['customer_email'] = $u['email'];
    }
    // the first payment of an installment or monthly plan starts a subscription that charges the rest by itself
    $auto = $plan && $item['k'] === 'plan' && $item['id'] === 'p1' && in_array($plan['kind'], ['install', 'monthly'], true) && (count(array_filter($a['items'], fn($x) => $x['k'] === 'plan')) > 1 || !empty($a['open'])) && empty($a['stripe']['sub']);
    if ($auto) {
        $p['mode'] = 'subscription';
        $p['line_items'] = [['quantity' => 1, 'price_data' => ['currency' => $c['cur'], 'unit_amount' => (int) $item['amt'], 'product_data' => ['name' => $plan['t']], 'recurring' => ['interval' => $plan['every'] === 'week' && $plan['kind'] === 'install' ? 'week' : 'month', 'interval_count' => 1]]]];
        $p['subscription_data'] = ['metadata' => ['uid' => $u['id'], 'plan' => (string) $a['plan']], 'description' => $plan['t']];
    } else {
        $p['mode'] = 'payment';
        $p['line_items'] = [['quantity' => 1, 'price_data' => ['currency' => $c['cur'], 'unit_amount' => (int) $item['amt'], 'product_data' => ['name' => mb_substr((string) $item['t'], 0, 200)]]]];
        $p['payment_intent_data'] = ['metadata' => ['uid' => $u['id'], 'item' => $itemId], 'description' => mb_substr((string) $item['t'], 0, 200)];
        $p['customer_creation'] = empty($a['stripe']['cus']) ? 'always' : null;
        if ($p['customer_creation'] === null) {
            unset($p['customer_creation']);
        }
    }
    $s = billStripe('POST', '/v1/checkout/sessions', $p);
    if (isset($s['_error'])) {
        fail(502, 'unavailable', 'Stripe: ' . $s['_error']);
    }
    return (string) ($s['url'] ?? '');
}
/** Marks an item paid once (the reference is a Stripe session, payment or invoice id, or a manual note). */
function billPaid(array &$a, string $itemId, string $how, string $ref): bool
{
    foreach ($a['items'] as &$x) {
        if ($x['id'] === $itemId) {
            if (($x['st'] ?? '') === 'paid') {
                return false;
            }
            $x['st'] = 'paid';
            $x['paidAt'] = now();
            $x['how'] = $how;
            $x['ref'] = mb_substr($ref, 0, 120);
            unset($x['rep']);
            unset($x);
            if (empty($a['act'])) {
                $a['act'] = now();
                $plan = billPlan((string) ($a['plan'] ?? ''));
                if ($plan && $plan['months'] > 0) {
                    $a['until'] = (new DateTimeImmutable())->modify('+' . $plan['months'] . ' months')->getTimestamp() * 1000;
                }
            }
            return true;
        }
    }
    unset($x);
    return false;
}
/** A monthly plan without an end: the next month's payment, due a month after the last one (returns its id). */
function billAddMonth(array &$a, string $st = 'due'): string
{
    $plan = array_values(array_filter($a['items'], fn($x) => ($x['k'] ?? '') === 'plan'));
    if (!$plan) {
        return '';
    }
    $lastItem = end($plan);
    $n = count($plan) + 1;
    $id = 'p' . $n;
    $a['items'][] = ['id' => $id, 'k' => 'plan', 't' => (string) ($a['pt'] ?? 'Plan') . ' - month ' . $n, 'amt' => (int) ($lastItem['amt'] ?? 0), 'due' => (new DateTimeImmutable((string) ($lastItem['due'] ?? 'today')))->modify('+1 month')->format('Y-m-d'), 'st' => $st];
    return $id;
}
/** The next plan payment not yet paid (installments charged by the subscription are matched in order). */
function billNextPlanItem(array $a): string
{
    foreach ($a['items'] as $x) {
        if (($x['k'] ?? '') === 'plan' && !in_array($x['st'] ?? '', ['paid', 'void', 'waived'], true)) {
            return (string) $x['id'];
        }
    }
    return '';
}
function billRefSeen(array $a, string $ref): bool
{
    foreach ($a['items'] as $x) {
        if (($x['ref'] ?? '') === $ref) {
            return true;
        }
    }
    return in_array($ref, (array) ($a['refs'] ?? []), true);
}
/** A completed Checkout session (from the return page or the webhook): marks the item paid, records the customer
 *  and subscription, and makes an installment subscription stop after its last payment. */
function billSessionDone(string $uid, array $s): bool
{
    if (($s['client_reference_id'] ?? '') !== $uid || !in_array($s['payment_status'] ?? '', ['paid', 'no_payment_required'], true)) {
        return false;
    }
    $a = billDoc($uid);
    $sid = (string) ($s['id'] ?? '');
    if ($sid === '' || billRefSeen($a, $sid)) {
        return false;
    }
    $item = (string) ($s['metadata']['item'] ?? '');
    // v83: the session must match this enrollment. A plan payment must be for the current plan, and any payment must be for the
    // item's amount in the site's currency: a session opened for a cheaper plan and paid after a swap must not pay for the new one.
    $it = null;
    foreach ($a['items'] as $x) {
        if (($x['id'] ?? '') === $item) {
            $it = $x;
        }
    }
    if (!$it || (($it['k'] ?? '') === 'plan' && (string) ($s['metadata']['plan'] ?? '') !== (string) ($a['plan'] ?? '')) || (int) ($s['amount_total'] ?? -1) !== (int) ($it['amt'] ?? 0) || strtolower((string) ($s['currency'] ?? '')) !== billCfg()['cur']) {
        $sub = is_array($s['subscription'] ?? null) ? (string) ($s['subscription']['id'] ?? '') : (string) ($s['subscription'] ?? '');
        if ($sub !== '' && billStripeOn()) {
            billStripe('DELETE', '/v1/subscriptions/' . rawurlencode($sub)); // stop further charges for a plan they no longer have
        }
        $a['refs'] = array_slice(array_merge((array) ($a['refs'] ?? []), [$sid]), -60);
        $a['held'] = array_slice(array_merge((array) ($a['held'] ?? []), [$sid]), -20);
        billSave($uid, $a);
        $who = userRow($uid);
        billNotifyStaff('Payment to check: ' . ($who['name'] ?? $uid), ($who['name'] ?? $uid) . ' (' . ($who['email'] ?? '') . ') paid ' . billMoney((int) ($s['amount_total'] ?? 0), strtolower((string) ($s['currency'] ?? ''))) . ' on Stripe (session ' . $sid . ') for plan "' . ($s['metadata']['plan'] ?? '') . '" item ' . $item . ', which does not match their current plan "' . ($a['pt'] ?? '') . '". It was not recorded. Refund it in Stripe, or mark the right payment received under Admin > Plans & payments.');
        return false;
    }
    $changed = billPaid($a, $item, 'stripe', $sid);
    $a['stripe'] = (array) ($a['stripe'] ?? []);
    if (!empty($s['customer'])) {
        $a['stripe']['cus'] = is_array($s['customer']) ? (string) ($s['customer']['id'] ?? '') : (string) $s['customer'];
    }
    if (!empty($s['subscription'])) {
        $sub = is_array($s['subscription']) ? (string) ($s['subscription']['id'] ?? '') : (string) $s['subscription'];
        $a['stripe']['sub'] = $sub;
        $plan = billPlan((string) ($a['plan'] ?? ''));
        $n = count(array_filter($a['items'], fn($x) => $x['k'] === 'plan'));
        if ($plan && $sub !== '' && $n > 1) {
            // stop after the last installment: n periods after the subscription's start (just before the next charge)
            $so = billStripe('GET', '/v1/subscriptions/' . rawurlencode($sub));
            $start = new DateTimeImmutable('@' . (int) ($so['billing_cycle_anchor'] ?? ($so['start_date'] ?? ($s['created'] ?? time()))));
            $end = $plan['every'] === 'week' && $plan['kind'] === 'install' ? $start->modify('+' . (7 * $n) . ' days') : $start->modify('+' . $n . ' months');
            billStripe('POST', '/v1/subscriptions/' . rawurlencode($sub), ['cancel_at' => $end->getTimestamp() - 60, 'proration_behavior' => 'none']);
        }
    }
    $a['refs'] = array_slice(array_merge((array) ($a['refs'] ?? []), [$sid]), -60);
    billSave($uid, $a);
    return $changed;
}
/** Paid invoices of the person's subscription → installments, in order (covers a missed webhook). */
function billSyncSub(string $uid): int
{
    $a = billDoc($uid);
    $sub = (string) ($a['stripe']['sub'] ?? '');
    if ($sub === '' || !billStripeOn()) {
        return 0;
    }
    $r = billStripe('GET', '/v1/invoices', ['subscription' => $sub, 'status' => 'paid', 'limit' => 24]);
    if (isset($r['_error'])) {
        return 0;
    }
    $inv = array_reverse((array) ($r['data'] ?? [])); // oldest first
    $n = 0;
    foreach ($inv as $i) {
        $id = (string) ($i['id'] ?? '');
        if ($id === '' || billRefSeen($a, $id)) {
            continue;
        }
        // the first invoice of the subscription was already counted with its Checkout session
        if (($i['billing_reason'] ?? '') === 'subscription_create') {
            $a['refs'] = array_slice(array_merge((array) ($a['refs'] ?? []), [$id]), -60);
            continue;
        }
        $next = billNextPlanItem($a);
        if ($next === '' && !empty($a['open'])) {
            $next = billAddMonth($a);
        }
        // v83: an invoice smaller than the installment does not pay it (e.g. a subscription left from another plan). '<' and not
        // '!==': an installment subscription charges the first amount every time while the last item is the smaller remainder.
        $want = 0;
        foreach ($a['items'] as $x) {
            if ($x['id'] === $next) {
                $want = (int) ($x['amt'] ?? 0);
            }
        }
        if ($next !== '' && (int) ($i['amount_paid'] ?? -1) < $want) {
            $a['refs'] = array_slice(array_merge((array) ($a['refs'] ?? []), [$id]), -60);
            $who = userRow($uid);
            billNotifyStaff('Payment to check: ' . ($who['name'] ?? $uid), ($who['name'] ?? $uid) . ' (' . ($who['email'] ?? '') . ') was charged ' . billMoney((int) ($i['amount_paid'] ?? 0), strtolower((string) ($i['currency'] ?? ''))) . ' by Stripe (invoice ' . $id . '), less than their next payment of ' . billMoney($want) . ' for "' . ($a['pt'] ?? '') . '". It was not recorded. Check the subscription in Stripe, or mark the payment received under Admin > Plans & payments.');
            continue;
        }
        if ($next !== '' && billPaid($a, $next, 'stripe', $id)) {
            $n++;
        }
        $a['refs'] = array_slice(array_merge((array) ($a['refs'] ?? []), [$id]), -60);
    }
    billSave($uid, $a);
    return $n;
}
/** Stripe's webhook: the signature is checked against the signing secret (t=…,v1=…, HMAC-SHA256 of "t.body"). */
function billWebhook(): never
{
    $raw = (string) file_get_contents('php://input');
    $sig = (string) ($_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '');
    $secret = billCfg()['wh'];
    if ($secret === '' || $sig === '') {
        http_response_code(400);
        exit('not set up');
    }
    $t = 0;
    $v1 = [];
    foreach (explode(',', $sig) as $part) {
        [$k, $v] = array_pad(explode('=', trim($part), 2), 2, '');
        if ($k === 't') {
            $t = (int) $v;
        } elseif ($k === 'v1') {
            $v1[] = $v;
        }
    }
    $want = hash_hmac('sha256', $t . '.' . $raw, $secret);
    $okSig = false;
    foreach ($v1 as $s) {
        if (hash_equals($want, $s)) {
            $okSig = true;
        }
    }
    if (!$okSig || abs(time() - $t) > 300) {
        http_response_code(400);
        exit('bad signature');
    }
    $e = json_decode($raw, true);
    $type = (string) ($e['type'] ?? '');
    $o = (array) ($e['data']['object'] ?? []);
    try {
        if ($type === 'checkout.session.completed' || $type === 'checkout.session.async_payment_succeeded') {
            $uid = (string) ($o['client_reference_id'] ?? '');
            if (preg_match('/^u_[a-f0-9]{8,32}$/', $uid)) {
                billSessionDone($uid, $o);
            }
        } elseif ($type === 'invoice.paid' || $type === 'invoice.payment_succeeded') {
            $uid = (string) ($o['subscription_details']['metadata']['uid'] ?? ($o['parent']['subscription_details']['metadata']['uid'] ?? ''));
            if (!preg_match('/^u_[a-f0-9]{8,32}$/', $uid)) {
                // older API versions: look the subscription up
                $sub = (string) ($o['subscription'] ?? '');
                foreach (colAll('bill') as [$id, $d]) {
                    if ($sub !== '' && (string) ($d->stripe->sub ?? '') === $sub) {
                        $uid = (string) $id;
                    }
                }
            }
            if (preg_match('/^u_[a-f0-9]{8,32}$/', $uid)) {
                billSyncSub($uid);
            }
        } elseif ($type === 'invoice.payment_failed') {
            $sub = (string) ($o['subscription'] ?? '');
            foreach (colAll('bill') as [$id, $d]) {
                if ($sub !== '' && (string) ($d->stripe->sub ?? '') === $sub) {
                    $a = billDoc((string) $id);
                    $a['failAt'] = now();
                    billSave((string) $id, $a);
                }
            }
        }
    } catch (Throwable $x) {
        @error_log(date('c') . ' stripe webhook ' . $type . ': ' . $x->getMessage() . "\n", 3, storeDir() . '/error.log');
    }
    http_response_code(200);
    header('Content-Type: application/json');
    exit('{"received":true}');
}

/* ---------- reminders (cron) ---------- */

function billCron(): array
{
    $c = billCfg();
    $sent = 0;
    if (!$c['remind']) {
        return ['sent' => 0];
    }
    $today = (new DateTimeImmutable('today'))->format('Y-m-d');
    $soon = (new DateTimeImmutable('today'))->modify('+3 days')->format('Y-m-d');
    foreach (colAll('bill') as [$uid, $d]) {
        $uid = (string) $uid;
        if (!preg_match('/^u_/', $uid) || empty($d->items)) {
            continue;
        }
        $a = billDoc($uid);
        if (!empty($a['stripe']['sub'])) {
            continue; // charged automatically by Stripe
        }
        $changed = false;
        if (!empty($a['open']) && billNextPlanItem($a) === '' && !in_array($a['st'] ?? '', ['cancelled'], true)) {
            // a monthly plan without an end, paid by hand: the next month is added a few days before it is due
            $plan = array_values(array_filter($a['items'], fn($x) => ($x['k'] ?? '') === 'plan'));
            $last = $plan ? (string) (end($plan)['due'] ?? '') : '';
            if ($last !== '' && (new DateTimeImmutable($last))->modify('+1 month')->format('Y-m-d') <= $soon) {
                billAddMonth($a);
                $changed = true;
            }
        }
        foreach ($a['items'] as &$x) {
            if (($x['st'] ?? '') !== 'due') {
                continue;
            }
            $due = (string) ($x['due'] ?? '');
            $mark = $due === $soon ? 'soon' : ($due === $today ? 'today' : ($due < $today && $due >= (new DateTimeImmutable('today'))->modify('-1 day')->format('Y-m-d') ? 'late' : ''));
            if ($mark === '' || in_array($mark, (array) ($x['rem'] ?? []), true)) {
                continue;
            }
            $u = userRow($uid);
            if (!$u) {
                continue;
            }
            $what = $x['t'] . ': ' . billMoney((int) $x['amt']) . ' due ' . date('M j, Y', (int) strtotime($due));
            $link = siteUrl() . '#/portal/' . (ruleCtOf($uid) === 'student' ? 'student/plan' : 'consultant/membership');
            sendMail($u['email'], $u['name'], $mark === 'late' ? 'Payment overdue: ' . $x['t'] : 'Payment reminder: ' . $x['t'], "Hi {$u['name']},\n\n$what.\n\nPay online or see the payment instructions: $link\n\nThanks,\nStratEdge IT Consulting", emailHtml($mark === 'late' ? 'A payment is overdue' : 'A payment is coming up', ["Hi " . htmlspecialchars($u['name']) . ',', htmlspecialchars($what) . '.'], ['Pay or see the instructions', $link]));
            $x['rem'] = array_merge((array) ($x['rem'] ?? []), [$mark]);
            $changed = true;
            $sent++;
        }
        unset($x);
        if ($changed) {
            billSave($uid, $a);
        }
    }
    return ['sent' => $sent];
}

/* ---------- routes ---------- */

function billStaff(): array
{
    $u = requireUser();
    if (userLevel($u) < 2) {
        fail(403, 'forbidden', 'Plans and payments are for administrators, HR and accounting.');
    }
    return $u;
}
function billSettingsOut(): array
{
    $c = billCfg();
    return [
        'stripe' => $c['sk'] !== '',
        'mode' => $c['sk'] === '' ? '' : (str_starts_with($c['sk'], 'sk_live') || str_starts_with($c['sk'], 'rk_live') ? 'live' : 'test'),
        'hint' => $c['sk'] !== '' ? substr($c['sk'], 0, 7) . '…' . substr($c['sk'], -4) : '',
        'wh' => $c['wh'] !== '',
        'hook' => siteUrl() . 'api/index.php?r=stripe_webhook',
        'cur' => $c['cur'],
        'manual' => $c['manual'],
        'grace' => $c['grace'],
        'unlock' => $c['unlock'],
        'remind' => $c['remind'],
        'okAt' => $c['okAt'],
        'okAcct' => $c['okAcct'],
    ];
}
function billPeople(): array
{
    $out = [];
    foreach (colAll('bill') as [$uid, $d]) {
        $uid = (string) $uid;
        if (!preg_match('/^u_[a-f0-9]{8,32}$/', $uid)) {
            continue;
        }
        $a = billDoc($uid);
        $u = userRow($uid);
        $due = 0;
        $paid = 0;
        $reported = 0;
        $next = null;
        foreach ($a['items'] as $x) {
            if (($x['st'] ?? '') === 'paid') {
                $paid += (int) $x['amt'];
            } elseif (in_array($x['st'] ?? '', ['due', 'reported'], true)) {
                $due += (int) $x['amt'];
                if (($x['st'] ?? '') === 'reported') {
                    $reported++;
                }
                if (!$next) {
                    $next = $x;
                }
            }
        }
        $out[] = [
            'id' => $uid,
            'n' => (string) ($u['name'] ?? ''),
            'e' => (string) ($u['email'] ?? ''),
            'ct' => ruleCtOf($uid),
            'plan' => (string) ($a['plan'] ?? ''),
            'pt' => (string) ($a['pt'] ?? ''),
            'st' => billState($a),
            'paid' => $paid,
            'due' => $due,
            'reported' => $reported,
            'next' => $next,
            'auto' => !empty($a['stripe']['sub']),
            'at' => (int) ($a['at'] ?? 0),
            'items' => $a['items'],
            'agreed' => array_slice(array_reverse((array) ($a['agreed'] ?? [])), 0, 20),
        ];
    }
    usort($out, fn($x, $y) => [$y['reported'], $y['at']] <=> [$x['reported'], $x['at']]);
    return $out;
}
function billRoute(string $r, array $b): never
{
    require_once __DIR__ . '/rules.php';
    switch ($r) {
        case 'bill_plans':
            // public: the published plans for students or outside consultants, and the placement fee terms
            billSeedPlans();
            $aud = in_array($b['aud'] ?? ($_GET['aud'] ?? ''), ['student', 'outside'], true) ? (string) ($b['aud'] ?? $_GET['aud']) : '';
            $fees = [];
            foreach (ENG_KINDS as $e) {
                $t = billFeeText($e);
                if ($t !== '') {
                    $fees[$e] = $t;
                }
            }
            ok(['plans' => billPlans($aud), 'fees' => $fees, 'features' => BILL_FEATURES, 'stripe' => billStripeOn(), 'cur' => billCfg()['cur']]);

        case 'bill_return':
            // back from Stripe Checkout: on to the portal page, which looks the session up and records the payment
            $to = preg_match('#^/portal/[a-z]+(/[a-z]+)?$#', (string) ($_GET['to'] ?? '')) ? (string) $_GET['to'] : '/portal';
            $sid = preg_match('/^cs_[A-Za-z0-9_]{6,200}$/', (string) ($_GET['s'] ?? '')) ? (string) $_GET['s'] : '';
            header('Location: ' . siteUrl() . '#' . $to . ($sid !== '' ? '?paid=' . $sid : '?cancelled=1'), true, 302);
            exit();

        case 'bill_me':
            $u = requireUser();
            if (!empty($b['sync'])) {
                billSyncSub($u['id']);
            }
            ok(billMeOut($u['id']));

        case 'bill_join':
            // a student, or a consultant who signed up as an outside consultant, opens their portal right away (when
            // the job rules allow it): the plan, not an HR review, decides what they can use
            $u = requireUser();
            $uid = $u['id'];
            $r = docGet("r/$uid");
            if ($r && !empty($r->st)) {
                ok(['st' => (string) $r->st, 'ct' => ruleCtOf($uid)]);
            }
            $p = docGet("u/$uid")->p ?? null;
            $role = (string) ($p->role ?? '');
            $open = ruleSettings()['open'];
            if ($role === 'student' && $open['student']) {
                $ct = 'student';
            } elseif ($role === 'consultant' && !empty($p->out) && $open['outside']) {
                $ct = 'outside';
            } else {
                ok(['st' => '', 'ct' => '', 'review' => true]);
            }
            $r = $r ?: new stdClass();
            $r->role = $role;
            $r->st = 'active';
            if (empty($r->ct)) {
                $r->ct = $ct;
            }
            $r->self = true;
            $r->at = now();
            $r->u = now();
            docSet("r/$uid", $r);
            billNotifyStaff(($ct === 'student' ? 'New student: ' : 'New outside consultant: ') . $u['name'], $u['name'] . ' (' . $u['email'] . ') signed up ' . ($ct === 'student' ? 'for the student portal' : 'as an outside consultant (membership)') . ' and can choose a plan now. Their type and access are under Admin > Consultant types & job rules > People.');
            ok(['st' => 'active', 'ct' => $ct]);

        case 'bill_choose':
            // pick a plan: the payment schedule starts today (a pending, unpaid plan can be swapped for another)
            $u = requireUser();
            $acc = billAccess($u['id']);
            if (!$acc['gated']) {
                fail(400, 'invalid_argument', 'Plans are for students and outside consultants.');
            }
            $p = billPlan((string) ($b['plan'] ?? ''));
            if (!$p || !$p['pub'] || !in_array($p['aud'], [$acc['ct'], 'all'], true)) {
                fail(404, 'not_found', 'That plan is not available.');
            }
            if ($p['quote']) {
                fail(400, 'invalid_argument', 'A custom plan is put together with you first. Contact StratEdge and we will set it up in your portal.');
            }
            $a = billDoc($u['id']);
            if (!empty($a['plan']) && in_array(billState($a), ['active', 'past_due'], true)) {
                fail(409, 'invalid_argument', 'You already have an active plan. Cancel it first, or ask StratEdge to change it.');
            }
            $fees = array_values(array_filter($a['items'], fn($x) => ($x['k'] ?? '') === 'fee'));
            if (!empty($a['plan'])) {
                $a['hist'] = array_slice(array_merge((array) ($a['hist'] ?? []), [['plan' => $a['plan'], 'pt' => $a['pt'] ?? '', 'st' => billState($a), 'at' => now()]]), -20);
            }
            $a['plan'] = $p['id'];
            $a['pt'] = $p['t'];
            $a['aud'] = $p['aud'];
            $a['feat'] = $p['feat'];
            $a['open'] = $p['kind'] === 'monthly' && !$p['n']; // monthly until cancelled
            $a['st'] = 'pending';
            $a['at'] = now();
            unset($a['act'], $a['until']);
            $a['stripe'] = ['cus' => (string) ($a['stripe']['cus'] ?? '')];
            $a['items'] = array_merge(billSchedule($p), $fees);
            billSave($u['id'], $a);
            ok(billMeOut($u['id']));

        case 'bill_checkout':
            $u = requireUser();
            $a = billDoc($u['id']);
            if (empty($a['plan']) && empty($a['items'])) {
                fail(400, 'invalid_argument', 'Choose a plan first.');
            }
            $ret = preg_match('#^/portal/[a-z]+(/[a-z]+)?$#', (string) ($b['ret'] ?? '')) ? (string) $b['ret'] : '/portal';
            ok(['url' => billCheckout($u, $a, (string) ($b['item'] ?? ''), $ret)]);

        case 'bill_confirm':
            // back from Stripe: the session is looked up and the payment recorded
            $u = requireUser();
            $sid = (string) ($b['session'] ?? '');
            if (!preg_match('/^cs_[A-Za-z0-9_]{6,200}$/', $sid)) {
                fail(400, 'invalid_argument', 'Bad session.');
            }
            $s = billStripe('GET', '/v1/checkout/sessions/' . rawurlencode($sid));
            if (isset($s['_error'])) {
                fail(502, 'unavailable', 'Stripe: ' . $s['_error']);
            }
            $done = billSessionDone($u['id'], $s);
            ok(['paid' => in_array($s['payment_status'] ?? '', ['paid', 'no_payment_required'], true), 'recorded' => $done, 'held' => in_array($sid, (array) (billDoc($u['id'])['held'] ?? []), true)] + billMeOut($u['id']));

        case 'bill_manual':
            // "I paid another way": staff are told and confirm it
            $u = requireUser();
            $a = billDoc($u['id']);
            $id = (string) ($b['item'] ?? '');
            $hit = false;
            foreach ($a['items'] as &$x) {
                if ($x['id'] === $id && ($x['st'] ?? '') === 'due') {
                    $x['st'] = 'reported';
                    $x['rep'] = ['at' => now(), 'how' => mb_substr(trim((string) ($b['how'] ?? '')), 0, 40), 'ref' => mb_substr(trim((string) ($b['ref'] ?? '')), 0, 120), 'note' => mb_substr(trim((string) ($b['note'] ?? '')), 0, 500)];
                    $hit = $x;
                }
            }
            unset($x);
            if (!$hit) {
                fail(400, 'invalid_argument', 'That payment is not due.');
            }
            billSave($u['id'], $a);
            billNotifyStaff('Payment reported: ' . $u['name'], $u['name'] . ' (' . $u['email'] . ') reports paying "' . $hit['t'] . '" (' . billMoney((int) $hit['amt']) . ')' . ($hit['rep']['how'] !== '' ? ' by ' . $hit['rep']['how'] : '') . ($hit['rep']['ref'] !== '' ? ', reference ' . $hit['rep']['ref'] : '') . ".\n" . $hit['rep']['note'] . "\n\nConfirm it under Admin > Plans & payments.");
            ok(billMeOut($u['id']));

        case 'bill_cancel':
            $u = requireUser();
            $a = billDoc($u['id']);
            if (empty($a['plan'])) {
                fail(400, 'invalid_argument', 'There is no plan to cancel.');
            }
            if (!empty($a['stripe']['sub']) && billStripeOn()) {
                billStripe('DELETE', '/v1/subscriptions/' . rawurlencode((string) $a['stripe']['sub']));
                $a['stripe']['sub'] = '';
            }
            foreach ($a['items'] as &$x) {
                if (($x['k'] ?? '') === 'plan' && in_array($x['st'] ?? '', ['due', 'reported'], true)) {
                    $x['st'] = 'void';
                }
            }
            unset($x);
            $a['st'] = 'cancelled';
            $a['cancelAt'] = now();
            billSave($u['id'], $a);
            billNotifyStaff('Plan cancelled: ' . $u['name'], $u['name'] . ' (' . $u['email'] . ') cancelled the plan "' . ($a['pt'] ?? '') . '".');
            ok(billMeOut($u['id']));

        /* ----- staff ----- */
        case 'bill_admin':
            billStaff();
            billSeedPlans();
            ok(['plans' => billPlans('', true), 'people' => billPeople(), 'fees' => billFees(), 'settings' => billSettingsOut(), 'features' => BILL_FEATURES, 'eng' => ENG_KINDS, 'feeText' => array_map(fn($e) => billFeeText($e), array_combine(ENG_KINDS, ENG_KINDS))]);

        case 'bill_plan_save':
            $u = billStaff();
            $x = (array) ($b['plan'] ?? []);
            $id = preg_match('/^[A-Za-z0-9_\-]{1,40}$/', (string) ($x['id'] ?? '')) ? (string) $x['id'] : rid(6);
            $t = mb_substr(trim((string) ($x['t'] ?? '')), 0, 120);
            if ($t === '') {
                fail(400, 'invalid_argument', 'Give the plan a name.');
            }
            $price = (int) round(max(0, (float) ($x['price'] ?? 0)) * 100);
            $kind = in_array($x['kind'] ?? '', BILL_KINDS, true) ? $x['kind'] : 'once';
            $doc = [
                't' => $t,
                'aud' => in_array($x['aud'] ?? '', BILL_AUDS, true) ? $x['aud'] : 'student',
                'line' => ($x['line'] ?? '') === 'placement' ? 'placement' : '',
                'quote' => !empty($x['quote']),
                'd' => mb_substr(trim((string) ($x['d'] ?? '')), 0, 1500),
                'price' => $price,
                'kind' => $kind,
                'n' => $kind === 'once' ? 1 : max($kind === 'install' ? 2 : 0, min(36, (int) ($x['n'] ?? 0))),
                'every' => ($x['every'] ?? '') === 'week' ? 'week' : 'month',
                'feat' => array_values(array_intersect(array_keys(BILL_FEATURES), (array) ($x['feat'] ?? []))),
                'perks' => array_slice(array_values(array_filter(array_map(fn($s) => mb_substr(trim((string) $s), 0, 160), (array) ($x['perks'] ?? [])))), 0, 12),
                'months' => max(0, min(60, (int) ($x['months'] ?? 0))),
                'pub' => !empty($x['pub']),
                'ord' => (int) ($x['ord'] ?? 50),
                'u' => now(),
                'by' => $u['id'],
            ];
            docSet("bill/x/plans/$id", json_decode((string) json_encode($doc)));
            ok(['plan' => billPlan($id)]);

        case 'bill_assign':
            // v34: staff put someone on a plan (a custom plan agreed on a call, or a draft made just for them)
            $u = billStaff();
            $email = strtolower(trim((string) ($b['email'] ?? '')));
            $st = db()->prepare('SELECT id, email, name FROM users WHERE LOWER(email) = ?');
            $st->execute([$email]);
            $who = $st->fetch();
            if (!$who) {
                fail(404, 'not_found', 'Nobody has a portal account with that email. Ask them to create one first (student or consultant).');
            }
            $acc = billAccess((string) $who['id']);
            if (!$acc['gated']) {
                fail(400, 'invalid_argument', $who['name'] . ' is not a student or outside consultant, so plans do not apply to them.');
            }
            $p = billPlan((string) ($b['plan'] ?? ''));
            if (!$p || !in_array($p['aud'], [$acc['ct'], 'all'], true)) {
                fail(400, 'invalid_argument', 'That plan is not for ' . ($acc['ct'] === 'student' ? 'students' : 'outside consultants') . '.');
            }
            if ($p['quote'] || $p['price'] <= 0) {
                fail(400, 'invalid_argument', 'Give the plan its agreed price first (a custom plan is a template: copy it into a plan for this person with the price).');
            }
            $a = billDoc((string) $who['id']);
            if (!empty($a['plan']) && in_array(billState($a), ['active', 'past_due'], true) && empty($b['replace'])) {
                fail(409, 'invalid_argument', $who['name'] . ' already has an active plan (' . ($a['pt'] ?? '') . '). Take it off first, or confirm the change.');
            }
            $fees = array_values(array_filter($a['items'], fn($x) => ($x['k'] ?? '') === 'fee'));
            if (!empty($a['plan'])) {
                $a['hist'] = array_slice(array_merge((array) ($a['hist'] ?? []), [['plan' => $a['plan'], 'pt' => $a['pt'] ?? '', 'st' => billState($a), 'at' => now()]]), -20);
            }
            $a['plan'] = $p['id'];
            $a['pt'] = $p['t'];
            $a['aud'] = $p['aud'];
            $a['feat'] = $p['feat'];
            $a['open'] = $p['kind'] === 'monthly' && !$p['n'];
            $a['st'] = 'pending';
            $a['at'] = now();
            $a['by'] = $u['id'];
            unset($a['act'], $a['until']);
            $a['stripe'] = ['cus' => (string) ($a['stripe']['cus'] ?? '')];
            $a['items'] = array_merge(billSchedule($p), $fees);
            billSave((string) $who['id'], $a);
            $link = siteUrl() . '#/portal/' . ($acc['ct'] === 'student' ? 'student/plan' : 'consultant/membership');
            sendMail((string) $who['email'], (string) $who['name'], 'Your StratEdge plan: ' . $p['t'], "Hi {$who['name']},\n\nStratEdge set up your plan: {$p['t']} ({$p['label']}).\n\nPay the first payment to start: $link", emailHtml('Your StratEdge plan: ' . htmlspecialchars($p['t']), ['Hi ' . htmlspecialchars((string) $who['name']) . ',', 'StratEdge set up your plan: <b>' . htmlspecialchars($p['t']) . '</b> (' . htmlspecialchars($p['label']) . ').', 'Pay the first payment in your portal to start.'], ['Open my plan', $link]));
            if (function_exists('audit')) {
                audit('billing', 'Plan assigned', (string) $who['email'], ['plan' => $p['id'], 'price' => $p['price']], $u);
            }
            ok(['people' => billPeople(), 'name' => $who['name']]);

        case 'bill_plan_delete':
            billStaff();
            $id = (string) ($b['id'] ?? '');
            if (preg_match('/^[A-Za-z0-9_\-]{1,40}$/', $id)) {
                docDelete("bill/x/plans/$id");
            }
            ok(['ok' => true]);

        case 'bill_fees_save':
            $u = billStaff();
            $in = (array) ($b['fees'] ?? []);
            $rules = [];
            foreach (ENG_KINDS as $e) {
                $x = (array) ($in['rules'][$e] ?? []);
                $kind = in_array($x['kind'] ?? '', ['none', 'flat', 'pct', 'salary'], true) ? $x['kind'] : 'none';
                $rules[$e] = ['kind' => $kind, 'amt' => (int) round(max(0, (float) ($x['amt'] ?? 0)) * 100), 'pct' => max(0, min(100, (float) ($x['pct'] ?? 0))), 'months' => max(1, min(24, (int) ($x['months'] ?? 3))), 'text' => mb_substr(trim((string) ($x['text'] ?? '')), 0, 300)];
            }
            docSet('bill/x/fees', json_decode((string) json_encode(['rules' => $rules, 'aud' => array_values(array_intersect(['outside', 'student'], (array) ($in['aud'] ?? []))), 'u' => now(), 'by' => $u['id']])));
            ok(['fees' => billFees(), 'feeText' => array_map(fn($e) => billFeeText($e), array_combine(ENG_KINDS, ENG_KINDS))]);

        case 'bill_settings_save':
            $u = requireAdmin();
            // v83: the Stripe keys, webhook secret and payment instructions are administrator settings (like the Plaid and
            // QuickBooks keys); HR and accounting keep the rest of Plans & payments
            if (!hasRole($u, 'admin')) {
                fail(403, 'forbidden', 'Only an administrator can change the payment settings.');
            }
            $d = docGet('sec/x/bill') ?? new stdClass();
            $sk = trim((string) ($b['sk'] ?? ''));
            if (!empty($b['clear'])) {
                $d->sk = '';
                $d->wh = '';
                $d->okAt = 0;
                $d->okAcct = '';
            } elseif ($sk !== '') {
                if (!preg_match('/^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/', $sk)) {
                    fail(400, 'invalid_argument', 'That does not look like a Stripe secret key (sk_live_… or sk_test_…, or a restricted key rk_…).');
                }
                $d->sk = mailSeal($sk);
                $d->okAt = 0;
            }
            $wh = trim((string) ($b['wh'] ?? ''));
            if ($wh !== '') {
                if (!preg_match('/^whsec_[A-Za-z0-9]{10,}$/', $wh)) {
                    fail(400, 'invalid_argument', 'The webhook signing secret starts with whsec_.');
                }
                $d->wh = mailSeal($wh);
            }
            foreach (['manual' => 2000] as $k => $max) {
                if (array_key_exists($k, $b)) {
                    $d->$k = mb_substr(trim((string) $b[$k]), 0, $max);
                }
            }
            if (array_key_exists('cur', $b) && preg_match('/^[a-z]{3}$/', strtolower((string) $b['cur']))) {
                $d->cur = strtolower((string) $b['cur']);
            }
            if (array_key_exists('grace', $b)) {
                $d->grace = max(0, min(60, (int) $b['grace']));
            }
            foreach (['unlock', 'remind'] as $k) {
                if (array_key_exists($k, $b)) {
                    $d->$k = !empty($b[$k]);
                }
            }
            $d->u = now();
            $d->by = $u['id'];
            docSet('sec/x/bill', $d);
            ok(['settings' => billSettingsOut()]);

        case 'bill_test':
            // the key works: the account's name and mode
            $u = requireAdmin();
            // v83: administrators only (it records the checked account in the payment settings)
            if (!hasRole($u, 'admin')) {
                fail(403, 'forbidden', 'Only an administrator can test the payment settings.');
            }
            if (!billStripeOn()) {
                fail(400, 'invalid_argument', 'Add the Stripe secret key first.');
            }
            $acct = billStripe('GET', '/v1/account');
            if (isset($acct['_error'])) {
                ok(['ok' => false, 'error' => $acct['_error'], 'hint' => ($acct['_code'] ?? 0) === 401 ? 'Stripe did not accept the key: copy the Secret key again from dashboard.stripe.com > Developers > API keys.' : (($acct['_code'] ?? 0) === 0 ? 'The server could not reach api.stripe.com; ask your host to allow outbound HTTPS.' : '')]);
            }
            $name = (string) ($acct['settings']['dashboard']['display_name'] ?? ($acct['business_profile']['name'] ?? ($acct['email'] ?? 'your account')));
            $d = docGet('sec/x/bill') ?? new stdClass();
            $d->okAt = now();
            $d->okAcct = $name;
            docSet('sec/x/bill', $d);
            ok(['ok' => true, 'account' => $name, 'settings' => billSettingsOut()]);

        case 'bill_mark':
            // staff: payment received (manual), back to due, waived, voided; or a new item (a placement fee)
            $u = billStaff();
            $uid = (string) ($b['uid'] ?? '');
            if (!preg_match('/^u_[a-f0-9]{8,32}$/', $uid) || !userRow($uid)) {
                fail(404, 'not_found', 'No such person.');
            }
            $a = billDoc($uid);
            if (!empty($b['add'])) {
                $x = (array) $b['add'];
                $amt = (int) round(max(0, (float) ($x['amt'] ?? 0)) * 100);
                $t = mb_substr(trim((string) ($x['t'] ?? '')), 0, 200);
                if ($amt <= 0 || $t === '') {
                    fail(400, 'invalid_argument', 'Give the charge a description and an amount.');
                }
                $due = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($x['due'] ?? '')) ? (string) $x['due'] : date('Y-m-d');
                $a['items'][] = ['id' => 'f' . rid(4), 'k' => 'fee', 't' => $t, 'amt' => $amt, 'due' => $due, 'st' => 'due', 'by' => $u['id'], 'at' => now()];
                billSave($uid, $a);
                $who = userRow($uid);
                if ($who) {
                    $link = siteUrl() . '#/portal/' . (ruleCtOf($uid) === 'student' ? 'student/plan' : 'consultant/membership');
                    sendMail($who['email'], $who['name'], 'New charge: ' . $t, "Hi {$who['name']},\n\n$t: " . billMoney($amt) . ' due ' . date('M j, Y', (int) strtotime($due)) . ".\n\nPay online or see the instructions: $link", emailHtml('New charge: ' . htmlspecialchars($t), ['Hi ' . htmlspecialchars($who['name']) . ',', htmlspecialchars($t) . ': <b>' . billMoney($amt) . '</b>, due ' . date('M j, Y', (int) strtotime($due)) . '.'], ['Pay or see the instructions', $link]));
                }
                ok(['people' => billPeople()]);
            }
            $id = (string) ($b['item'] ?? '');
            $st = (string) ($b['st'] ?? '');
            if (!in_array($st, ['paid', 'due', 'void', 'waived'], true)) {
                fail(400, 'invalid_argument', 'Unknown status.');
            }
            $hit = false;
            foreach ($a['items'] as &$x) {
                if ($x['id'] === $id) {
                    $hit = true;
                    if ($st === 'paid') {
                        unset($x);
                        billPaid($a, $id, 'manual', mb_substr(trim((string) ($b['ref'] ?? 'marked by ' . $u['name'])), 0, 120));
                        break;
                    }
                    $x['st'] = $st;
                    unset($x['paidAt'], $x['how'], $x['ref'], $x['rep']);
                    $x['by'] = $u['id'];
                }
            }
            unset($x);
            if (!$hit) {
                fail(404, 'not_found', 'No such payment.');
            }
            billSave($uid, $a);
            ok(['people' => billPeople()]);

        case 'bill_reset':
            // staff: take a person's plan off (e.g. moved to a StratEdge contract)
            billStaff();
            $uid = (string) ($b['uid'] ?? '');
            if (!preg_match('/^u_[a-f0-9]{8,32}$/', $uid)) {
                fail(400, 'invalid_argument', 'Bad person.');
            }
            $a = billDoc($uid);
            if (!empty($a['stripe']['sub']) && billStripeOn()) {
                billStripe('DELETE', '/v1/subscriptions/' . rawurlencode((string) $a['stripe']['sub']));
                $a['stripe']['sub'] = '';
            }
            $a['st'] = 'cancelled';
            billSave($uid, $a);
            ok(['people' => billPeople()]);
    }
    fail(404, 'not_found', 'Unknown action.');
}
