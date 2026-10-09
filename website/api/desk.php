<?php
declare(strict_types=1);
/*
 * v34: Service desk (Help & support), the way ServiceNow runs IT and HR service management, sized for StratEdge.
 *
 *  - Everyone signed in (employees, consultants, students, clients, staff) reports a problem, requests something from
 *    the catalog, or sends feedback: from the Help button (a support bot that first looks in the knowledge base),
 *    the Help & support page, or by email (replies to [SD-1234] update the ticket).
 *  - Priority comes from impact x urgency (P1 critical to P4 low), each with a response and a resolution target (SLA);
 *    the clock stops while a ticket is on hold waiting for the requester.
 *  - Stages: Awaiting approval (catalog requests that need one) > New > Assigned > In progress > On hold > Resolved >
 *    Closed (by the requester, or automatically after a few days). A requester's reply reopens a resolved ticket.
 *  - Assignment groups (IT & portal support, HR, Payroll & accounting, Recruiting, General) by
 *    category; group members work the queue; administrators see everything. Work notes stay internal.
 *  - The knowledge base answers common questions and feeds the support bot (and StratEdge AI, when it is set up).
 *  - The dashboard: open work by priority, stage and group, SLA breaches, unassigned, created vs resolved, satisfaction.
 * Tables desk_tickets and desk_notes; groups, the catalog, articles and settings are documents under desk/x/.
 */
require_once __DIR__ . '/mail.php';

const DESK_SCHEMA = 1;
const DESK_ST = ['approval' => 'Awaiting approval', 'new' => 'New', 'assigned' => 'Assigned', 'progress' => 'In progress', 'hold' => 'On hold', 'resolved' => 'Resolved', 'closed' => 'Closed', 'cancelled' => 'Cancelled'];
const DESK_OPEN = ['approval', 'new', 'assigned', 'progress', 'hold'];
const DESK_PRI = [1 => 'P1 Critical', 2 => 'P2 High', 3 => 'P3 Moderate', 4 => 'P4 Low'];
const DESK_IMPACT = [1 => 'Everyone, or a client is affected', 2 => 'My team or several people', 3 => 'Just me'];
const DESK_URGENCY = [1 => 'I can\'t work at all', 2 => 'It slows me down: soon, please', 3 => 'It can wait'];
const DESK_HOLD = ['caller' => 'Waiting for the requester', 'vendor' => 'Waiting for an outside company', 'change' => 'Waiting for a planned change'];
const DESK_RES = ['solved' => 'Fixed', 'workaround' => 'Worked around', 'answered' => 'Question answered', 'duplicate' => 'Duplicate of another ticket', 'noaction' => 'No action needed'];
// category => [name, default group, words that suggest it]
// (words of up to three letters match whole words only, longer ones also match words they start; _ joins a phrase;
// a word with + in front counts double)
const DESK_CATS = [
    'signin' => ['Sign-in & account', 'it', '+password +sign_in +signin +sign-in +login +log_in logged_out locked lockout two-step 2fa mfa passkey authenticator backup_code verification_code'],
    'portal' => ['Portal or website problem', 'it', 'error page blank broken bug button website portal loading slow crash not_working screen'],
    'email' => ['Email & mass email', 'it', '+email mail campaign bounce spam inbox gmail sending unsubscribe'],
    'equipment' => ['Equipment & access', 'it', '+laptop monitor headset equipment software license access +vpn permission tool'],
    'time' => ['Timesheets & attendance', 'hr', '+timesheet hours attendance clock approval approve overtime'],
    'pay' => ['Pay, paystubs & taxes', 'pay', 'pay paid +paystub salary +payroll payday +paycheck tax taxes w-2 w2 1099 deduction +direct_deposit bank'],
    'billing' => ['Invoices & billing', 'pay', '+invoice billing payment plan stripe charge refund fee'],
    'docs' => ['Documents, visa & compliance', 'hr', 'document +visa h-1b h1b opt stem i-9 i9 e-verify uscis compliance letter upload passport'],
    'hr' => ['Onboarding, benefits & HR', 'hr', '+onboarding benefits insurance +pto +time_off leave hr policy +offer_letter'],
    'jobs' => ['Jobs, submissions & interviews', 'rec', 'job jobs submission submitted interview client vendor requirement resume recruiter placement bench'],
    'learning' => ['Training & certifications', 'hr', 'course training certification certificate test exam learning'],
    'feedback' => ['Feedback & ideas', 'gen', 'feedback idea suggestion improve feature'],
    'other' => ['Something else', 'gen', ''],
];
// minutes: [respond within, resolve within]; the clock runs all hours and stops while on hold for the requester
const DESK_SLA_DEFAULT = [1 => [15, 240], 2 => [60, 480], 3 => [480, 4320], 4 => [1440, 7200]];
const DESK_GROUPS_SEED = [
    'it' => ['IT & portal support', 'Sign-in, the portal and website, email, equipment and access.', ['admin']],
    'hr' => ['HR', 'Onboarding, documents and compliance, timesheets, benefits, training.', ['hr']],
    'pay' => ['Payroll & accounting', 'Pay and paystubs, taxes, invoices and plan payments.', ['acct']],
    'rec' => ['Recruiting', 'Jobs, submissions, interviews and placements.', ['admin']],
    'gen' => ['General requests', 'Feedback, ideas and anything else.', ['admin']],
];

/* ---------- storage ---------- */

function ddb(): PDO
{
    static $ready = false;
    $pdo = db();
    if ($ready) {
        return $pdo;
    }
    $v = (int) ($pdo->query("SELECT v FROM meta WHERE k = 'desk_schema'")->fetchColumn() ?: 0);
    if ($v < DESK_SCHEMA) {
        $pdo->exec('CREATE TABLE IF NOT EXISTS desk_tickets (id VARCHAR(24) PRIMARY KEY, num INT NOT NULL, kind VARCHAR(12) NOT NULL, title VARCHAR(200) NOT NULL,
            body TEXT NOT NULL, cat VARCHAR(20) NOT NULL, impact INT NOT NULL, urgency INT NOT NULL, pri INT NOT NULL, st VARCHAR(12) NOT NULL,
            grp VARCHAR(40) NOT NULL, asg VARCHAR(40) NOT NULL, asg_name VARCHAR(190) NOT NULL, by_uid VARCHAR(40) NOT NULL, by_name VARCHAR(190) NOT NULL,
            by_email VARCHAR(190) NOT NULL, created BIGINT NOT NULL, updated BIGINT NOT NULL, first_resp BIGINT NOT NULL, due_resp BIGINT NOT NULL,
            due_res BIGINT NOT NULL, resolved_at BIGINT NOT NULL, closed_at BIGINT NOT NULL, hold_why VARCHAR(20) NOT NULL, hold_since BIGINT NOT NULL,
            breach INT NOT NULL, notified INT NOT NULL, item VARCHAR(40) NOT NULL, vars TEXT NOT NULL, appr TEXT NOT NULL, src VARCHAR(12) NOT NULL,
            res_code VARCHAR(20) NOT NULL, csat INT NOT NULL, csat_note VARCHAR(500) NOT NULL, page VARCHAR(300) NOT NULL)');
        $pdo->exec('CREATE TABLE IF NOT EXISTS desk_notes (id VARCHAR(24) PRIMARY KEY, ticket VARCHAR(24) NOT NULL, at BIGINT NOT NULL, by_uid VARCHAR(40) NOT NULL,
            by_name VARCHAR(190) NOT NULL, kind VARCHAR(10) NOT NULL, pub INT NOT NULL, body TEXT NOT NULL)');
        foreach ([
            'CREATE UNIQUE INDEX desk_tickets_num ON desk_tickets (num)',
            'CREATE INDEX desk_tickets_by ON desk_tickets (by_uid, updated)',
            'CREATE INDEX desk_tickets_st ON desk_tickets (st, pri)',
            'CREATE INDEX desk_tickets_grp ON desk_tickets (grp, st)',
            'CREATE INDEX desk_tickets_asg ON desk_tickets (asg, st)',
            'CREATE INDEX desk_notes_ticket ON desk_notes (ticket, at)',
        ] as $sql) {
            try {
                $pdo->exec($sql);
            } catch (Throwable $e) {
                // already there
            }
        }
        foreach (['desk_seq' => 1000, 'desk_cron' => 0] as $k => $val) {
            try {
                $pdo->prepare('INSERT INTO meta (k, v) VALUES (?, ?)')->execute([$k, $val]);
            } catch (Throwable $e) {
                // already there
            }
        }
        try {
            $pdo->prepare($v ? "UPDATE meta SET v = ? WHERE k = 'desk_schema'" : "INSERT INTO meta (k, v) VALUES ('desk_schema', ?)")->execute([DESK_SCHEMA]);
        } catch (Throwable $e) {
            // another request finished the setup first
        }
    }
    $ready = true;
    return $pdo;
}
function deskObj($x): array
{
    return is_array($x) ? $x : (json_decode((string) json_encode($x), true) ?: []);
}

/* ---------- settings, groups, catalog, articles ---------- */

function deskSettings(): array
{
    $d = deskObj(docGet('desk/x/settings'));
    $sla = [];
    foreach (DESK_SLA_DEFAULT as $p => [$r, $f]) {
        $x = (array) ($d['sla'][$p] ?? $d['sla'][(string) $p] ?? []);
        $sla[$p] = [max(5, (int) ($x[0] ?? $r)), max(15, (int) ($x[1] ?? $f))];
    }
    return [
        'sla' => $sla,
        'autoClose' => max(1, min(30, (int) ($d['autoClose'] ?? 5))),
        'email' => strtolower(trim((string) ($d['email'] ?? ''))),
        'notify' => ['create' => !isset($d['notify']['create']) || !empty($d['notify']['create']), 'assign' => !isset($d['notify']['assign']) || !empty($d['notify']['assign']), 'update' => !isset($d['notify']['update']) || !empty($d['notify']['update']), 'breach' => !isset($d['notify']['breach']) || !empty($d['notify']['breach'])],
        'bot' => !isset($d['bot']) || !empty($d['bot']),
        // v35: Help & support on the public website (#/support): sign-in help, the assistant and requests without a login
        'web' => !isset($d['web']) || !empty($d['web']),
    ];
}
/** The built-in groups, catalog items and articles, added once (removing one later keeps it removed). */
function deskSeed(): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    $m = deskObj(docGet('desk/x/meta'));
    $built = (array) ($m['builtins'] ?? []);
    $before = count($built);
    foreach (DESK_GROUPS_SEED as $id => [$n, $d, $roles]) {
        if (!in_array('g:' . $id, $built, true)) {
            if (!docGet("desk/x/groups/$id")) {
                docSet("desk/x/groups/$id", (object) ['n' => $n, 'd' => $d, 'roles' => $roles, 'members' => [], 'u' => now()]);
            }
            $built[] = 'g:' . $id;
        }
    }
    foreach (deskCatalogSeed() as $id => $item) {
        if (!in_array('c:' . $id, $built, true)) {
            if (!docGet("desk/x/catalog/$id")) {
                docSet("desk/x/catalog/$id", json_decode((string) json_encode($item + ['pub' => true, 'u' => now()])));
            }
            $built[] = 'c:' . $id;
        }
    }
    foreach (deskKbSeed() as $id => $a) {
        if (!in_array('k:' . $id, $built, true)) {
            if (!docGet("desk/x/kb/$id")) {
                docSet("desk/x/kb/$id", json_decode((string) json_encode($a + ['aud' => 'all', 'pub' => true, 'views' => 0, 'up' => 0, 'down' => 0, 'u' => now(), 'by' => 'system'])));
            }
            $built[] = 'k:' . $id;
        }
    }
    if (count($built) !== $before) {
        docSet('desk/x/meta', (object) ['builtins' => array_values(array_unique($built))]);
    }
}
function deskCatalogSeed(): array
{
    return [
        'letter' => ['t' => 'Employment verification letter', 'd' => 'A signed letter confirming your employment, for a visa, a lease or a loan.', 'cat' => 'docs', 'grp' => 'hr', 'icon' => 'file', 'appr' => 'none', 'ord' => 10, 'fields' => [['k' => 'purpose', 'l' => 'What it is for', 'type' => 'select', 'opts' => ['Visa or immigration', 'Lease or rental', 'Loan or bank', 'Other'], 'req' => true], ['k' => 'to', 'l' => 'Addressed to (optional)', 'type' => 'text', 'req' => false], ['k' => 'need', 'l' => 'Needed by', 'type' => 'date', 'req' => false]]],
        'access' => ['t' => 'Access to a system or tool', 'd' => 'A login, a permission or a software license you need for your work.', 'cat' => 'equipment', 'grp' => 'it', 'icon' => 'key', 'appr' => 'admin', 'ord' => 20, 'fields' => [['k' => 'system', 'l' => 'Which system or tool', 'type' => 'text', 'req' => true], ['k' => 'why', 'l' => 'What you need to do with it', 'type' => 'textarea', 'req' => true], ['k' => 'need', 'l' => 'Needed by', 'type' => 'date', 'req' => false]]],
        'equipment' => ['t' => 'Equipment', 'd' => 'A laptop, monitor, headset or other equipment for your work.', 'cat' => 'equipment', 'grp' => 'it', 'icon' => 'layers', 'appr' => 'admin', 'ord' => 30, 'fields' => [['k' => 'item', 'l' => 'What you need', 'type' => 'select', 'opts' => ['Laptop', 'Monitor', 'Headset', 'Keyboard or mouse', 'Other'], 'req' => true], ['k' => 'why', 'l' => 'Why', 'type' => 'textarea', 'req' => true]]],
        'paycorrection' => ['t' => 'Paystub or payroll correction', 'd' => 'Hours, rate, deductions or taxes that look wrong on a paystub.', 'cat' => 'pay', 'grp' => 'pay', 'icon' => 'money', 'appr' => 'none', 'ord' => 40, 'fields' => [['k' => 'period', 'l' => 'Pay period', 'type' => 'text', 'req' => true], ['k' => 'what', 'l' => 'What looks wrong', 'type' => 'textarea', 'req' => true]]],
        'taxdoc' => ['t' => 'W-2, 1099 or another tax document', 'd' => 'A copy or a correction of a tax form.', 'cat' => 'pay', 'grp' => 'pay', 'icon' => 'sheet', 'appr' => 'none', 'ord' => 50, 'fields' => [['k' => 'year', 'l' => 'Tax year', 'type' => 'text', 'req' => true], ['k' => 'form', 'l' => 'Which form', 'type' => 'select', 'opts' => ['W-2', '1099', 'Other'], 'req' => true]]],
        'details' => ['t' => 'Update my personal details', 'd' => 'Your name, address or emergency contact. Bank and direct-deposit changes are made in your portal under Earnings, never by ticket or email.', 'cat' => 'hr', 'grp' => 'hr', 'icon' => 'user', 'appr' => 'none', 'ord' => 60, 'fields' => [['k' => 'what', 'l' => 'What changes', 'type' => 'textarea', 'req' => true]]],
        'training' => ['t' => 'Training or certification', 'd' => 'A course, an exam or a certification you would like StratEdge to support.', 'cat' => 'learning', 'grp' => 'hr', 'icon' => 'star', 'appr' => 'admin', 'ord' => 70, 'fields' => [['k' => 'course', 'l' => 'Course or certification', 'type' => 'text', 'req' => true], ['k' => 'why', 'l' => 'How it helps your work', 'type' => 'textarea', 'req' => true]]],
    ];
}
function deskKbSeed(): array
{
    return [
        'priorities' => ['t' => 'How tickets work: priorities and response times', 'cat' => 'other', 'tags' => 'ticket priority sla response time urgent p1 p2 p3 p4 support', 'body' => "Every ticket gets a priority from two questions: who it affects (impact) and how badly it stops work (urgency).\n\n- P1 Critical: everyone, or a client, is affected and work has stopped.\n- P2 High: someone can't work at all, or everyone is slowed down.\n- P3 Moderate: a team's work is slowed down, or a problem for everyone can wait.\n- P4 Low: it only slows you down or can wait, or it is a question or an idea.\n\nThe time to a first answer for each priority is listed at the bottom of the Help & support page. While we wait for your answer the ticket is On hold and the clock stops. When we resolve it you get an email: reply if it is not fixed and the ticket reopens. Resolved tickets close by themselves after a few days."],
        'signin' => ['t' => "Can't sign in, or lost your two-step sign-in", 'cat' => 'signin', 'tags' => 'password forgot reset login sign in locked two-step 2fa mfa passkey authenticator backup code phone', 'body' => "Forgot your password: on the login page choose \"Forgot your password?\", enter your email, and follow the link we send.\n\nLost the phone with your authenticator app: sign in with one of your backup codes, then set the app up again under Sign-in & security.\n\nNo backup codes either: raise a ticket (category Sign-in & account) from another device or ask your manager to; an administrator can reset your two-step sign-in after checking it is really you.\n\nToo many wrong tries lock the account for a few minutes. Wait, then try again."],
        'timesheets' => ['t' => 'Submit your timesheet', 'cat' => 'time', 'tags' => 'timesheet hours submit approve week weekly approval rejected', 'body' => "Open Timesheets in your portal, enter the hours for each day of the week and submit it before the weekly deadline.\n\nYour manager or the client approves it. If a timesheet comes back rejected, the reason is shown on it: fix the hours and submit again.\n\nHours that are approved are the ones that are paid and invoiced, so check them before you submit."],
        'paystubs' => ['t' => 'Paystubs, payday and tax forms', 'cat' => 'pay', 'tags' => 'paystub pay payday salary paycheck earnings w-2 w2 1099 tax form deduction', 'body' => "Your paystubs are under Earnings in your portal, one for every pay run, with the hours, rate, deductions and taxes.\n\nYear-end tax forms (W-2 or 1099) come from Payroll after the end of the year; if you need a copy, use the \"W-2, 1099 or another tax document\" request.\n\nIf something on a paystub looks wrong, use the \"Paystub or payroll correction\" request and tell us the pay period: Payroll & accounting answers it."],
        'bank' => ['t' => 'Changing your bank or direct deposit', 'cat' => 'pay', 'tags' => 'bank direct deposit account routing change pay fraud', 'body' => "Make bank and direct-deposit changes yourself in your portal under Earnings > Direct deposit.\n\nStratEdge never asks for bank details by email, chat or ticket, and never changes them because of an email. If someone asks you to, it is a scam: report it with a ticket (category Pay, paystubs & taxes)."],
        'documents' => ['t' => 'Upload documents (I-9, visa, certifications)', 'cat' => 'docs', 'tags' => 'document upload i-9 i9 visa h-1b opt stem passport certification compliance', 'body' => "Open Documents in your portal and upload the file under the right type. Compliance & deadlines shows what is still needed and what expires when.\n\nFor questions about your status (OPT, STEM OPT, H-1B), see USCIS compliance in your portal, or raise a ticket in Documents, visa & compliance."],
        'timeoff' => ['t' => 'Request time off', 'cat' => 'hr', 'tags' => 'time off pto vacation leave sick day holiday', 'body' => "Open Time off in your portal, choose the dates and the type, and send the request. Its status shows there once it is decided.\n\nFor anything unusual (a long leave, a family emergency) raise a ticket in Onboarding, benefits & HR, or call HR."],
        'appbot' => ['t' => 'Using the application bot', 'cat' => 'jobs', 'tags' => 'application bot apply job automation companion chrome extension queue autofill', 'body' => "The application bot keeps your job applications in one place and, with its browser companion, fills employer application forms from your saved profile.\n\nStart with Apply profile & autofill, then open Application bot and import your saved answers. Add the job links you want and approve each one after reading the listing.\n\nJob boards such as Dice, LinkedIn and Indeed are a manual hand-off: apply there yourself and record the result. The bot never signs in for you and stops at any login or security check."],
        // v35: sign-in help shown on the public website (#/support) as well as in the portal
        'web-password' => ['t' => 'Forgot your password', 'cat' => 'signin', 'web' => true, 'tags' => 'password forgot reset change email link sign in login', 'body' => "On the login page choose \"Forgot your password?\" and enter the email address you sign in with. We email a link that works once, for 30 minutes: open it and choose a new password.\n\nUse a long passphrase (several words) that you do not use anywhere else. Passwords found in public data breaches are refused.\n\nNo email after a few minutes? Check the spam folder, and make sure it is the address your account uses. Still nothing: send us a request below."],
        'web-locked' => ['t' => 'Your account is locked after wrong passwords', 'cat' => 'signin', 'web' => true, 'tags' => 'locked lockout too many attempts wrong password blocked sign in', 'body' => "After many wrong passwords in a row the account locks for a while to stop someone guessing it. Wait, then sign in again, or reset your password with \"Forgot your password?\" so you are sure you have the right one.\n\nIf you did not try to sign in yourself, someone may know your email address: reset your password and tell us with a request below (topic: a security concern)."],
        'web-2fa' => ['t' => 'Lost your phone, authenticator app or backup codes', 'cat' => 'signin', 'web' => true, 'tags' => 'two-step 2fa mfa authenticator phone lost new phone backup codes reset passkey', 'body' => "Your account asks for a second step after the password. If you cannot use it any more:\n\n- Backup codes: on the code step choose \"Backup code\" and type one of the ten codes you saved when you set it up. Each works once.\n- Email code: if your account offers it, choose \"Email code\" and we send a code to your email address.\n- Nothing works: sign in with your password, and on the code step choose \"Can't use any of these?\". We email you a code to confirm the request, then an administrator contacts you to make sure it is really you and resets your two-step sign-in. At your next sign-in you set it up again on your new phone.\n\nWe never ask for your password or your codes by phone, chat or email."],
        'web-codes' => ['t' => 'The sign-in or confirmation code email did not arrive', 'cat' => 'signin', 'web' => true, 'tags' => 'code email not received verification confirmation spam junk', 'body' => "Codes arrive within a minute or two. Check the spam or junk folder, and search your inbox for \"StratEdge\".\n\nA code works for 10 minutes and only the newest one counts: if you asked for several, use the last.\n\nCompany email systems sometimes hold messages from outside: ask your IT team to allow emails from our address, or send us a request below."],
        'web-passkey' => ['t' => 'Passkey, Face ID or Windows Hello does not work', 'cat' => 'signin', 'web' => true, 'tags' => 'passkey face id touch id fingerprint windows hello security key not working', 'body' => "A passkey lives on the device (or password manager) where you made it. On another computer choose the option to use a phone or tablet and scan the code with the device that has the passkey.\n\nIf the browser shows no passkey, use another way on the code step (authenticator app, email code or a backup code), then add a passkey for this device under Sign-in & security."],
        'web-portals' => ['t' => 'Which portal do I sign in to?', 'cat' => 'signin', 'web' => true, 'tags' => 'portal login which consultant employee client student staff admin hr', 'body' => "Choose the login that matches how you work with us: Consultant (placed by StratEdge or looking for your next role), Employee (StratEdge staff), Client (companies hiring through us), Student (training plans), or one of the staff portals.\n\nOne account can open more than one portal: after you sign in you can switch between the portals you have. If a page says your access is being reviewed, HR approves new accounts within a business day."],
        'campaign' => ['t' => 'Why did my email campaign pause?', 'cat' => 'email', 'tags' => 'campaign mass email paused bounce bounced complaint spam deliverability', 'body' => "A campaign pauses itself when too many emails bounce or are marked as spam, before it hurts the address it is sent from.\n\nOpen Email > Check & bounces, remove the addresses that bounced, then open the campaign and resume it: the rates are measured again from that moment.\n\nOld or bought lists bounce the most. Send to people who know you, and keep the message personal and short."],
    ];
}
/** Groups with their members resolved: the people named plus everyone whose role the group takes in. */
function deskGroups(): array
{
    static $g = null;
    if ($g !== null) {
        return $g;
    }
    deskSeed();
    $roleUsers = [];
    foreach (db()->query("SELECT id, email, name, role, status, access FROM users WHERE status = 'active'")->fetchAll() as $row) {
        foreach (rolesOf($row) as $r) {
            $roleUsers[$r][] = (string) $row['id'];
        }
    }
    $g = [];
    foreach (colAll('desk/x/groups') as [$id, $d]) {
        $x = deskObj($d);
        $members = array_values(array_unique(array_merge(array_values(array_filter((array) ($x['members'] ?? []), 'is_string')), ...array_map(fn($r) => $roleUsers[$r] ?? [], (array) ($x['roles'] ?? [])))));
        $g[(string) $id] = ['id' => (string) $id, 'n' => (string) ($x['n'] ?? $id), 'd' => (string) ($x['d'] ?? ''), 'roles' => array_values((array) ($x['roles'] ?? [])), 'named' => array_values(array_filter((array) ($x['members'] ?? []), 'is_string')), 'members' => $members];
    }
    return $g;
}
function deskMyGroups(array $u): array
{
    return array_keys(array_filter(deskGroups(), fn($g) => in_array((string) $u['id'], $g['members'], true)));
}
function deskIsAdmin(array $u): bool
{
    return hasRole($u, 'admin');
}
function deskIsAgent(array $u): bool
{
    return deskIsAdmin($u) || featureMode((string) $u['id'], 'desk') === 'allow' || (featureMode((string) $u['id'], 'desk') !== 'block' && deskMyGroups($u) !== []);
}
/** The same answer without listing every user (asked on every page load, for the Service desk menu item). */
function deskAgentFlag(array $u): bool
{
    if (deskIsAdmin($u)) {
        return true;
    }
    $mode = featureMode((string) $u['id'], 'desk');
    if ($mode === 'block') return false;
    if ($mode === 'allow') return true;
    deskSeed();
    $roles = rolesOf($u);
    foreach (colAll('desk/x/groups') as [, $d]) {
        $x = deskObj($d);
        if (in_array((string) $u['id'], (array) ($x['members'] ?? []), true) || array_intersect($roles, (array) ($x['roles'] ?? []))) {
            return true;
        }
    }
    return false;
}
function deskCanSee(array $u, array $t): bool
{
    if ((string) $t['by_uid'] === (string) $u['id'] || deskIsAdmin($u) || (string) $t['asg'] === (string) $u['id']) {
        return true;
    }
    if (in_array((string) $t['grp'], deskMyGroups($u), true)) {
        return true;
    }
    $appr = json_decode((string) $t['appr'], true) ?: [];
    return in_array((string) $u['id'], (array) ($appr['who'] ?? []), true);
}
function deskCanWork(array $u, array $t): bool
{
    return deskIsAdmin($u) || (string) $t['asg'] === (string) $u['id'] || in_array((string) $t['grp'], deskMyGroups($u), true);
}
function deskCatalog(bool $all = false): array
{
    deskSeed();
    $out = [];
    foreach (colAll('desk/x/catalog') as [$id, $d]) {
        $x = deskObj($d);
        if (!$all && empty($x['pub'])) {
            continue;
        }
        $out[] = ['id' => (string) $id, 't' => (string) ($x['t'] ?? ''), 'd' => (string) ($x['d'] ?? ''), 'cat' => isset(DESK_CATS[$x['cat'] ?? '']) ? $x['cat'] : 'other', 'grp' => (string) ($x['grp'] ?? 'gen'), 'icon' => (string) ($x['icon'] ?? 'tasks'), 'appr' => in_array($x['appr'] ?? '', ['none', 'admin', 'grp'], true) ? $x['appr'] : 'none', 'fields' => array_values((array) ($x['fields'] ?? [])), 'pub' => !empty($x['pub']), 'ord' => (int) ($x['ord'] ?? 50)];
    }
    usort($out, fn($a, $b) => [$a['ord'], $a['t']] <=> [$b['ord'], $b['t']]);
    return $out;
}
function deskArticles(array $u, bool $all = false): array
{
    deskSeed();
    $staff = deskIsAgent($u) || userLevel($u) >= 2;
    $out = [];
    foreach (colAll('desk/x/kb') as [$id, $d]) {
        $x = deskObj($d);
        if ((!$all && empty($x['pub'])) || (($x['aud'] ?? 'all') === 'staff' && !$staff)) {
            continue;
        }
        $out[(string) $id] = ['id' => (string) $id, 't' => (string) ($x['t'] ?? ''), 'body' => (string) ($x['body'] ?? ''), 'cat' => (string) ($x['cat'] ?? 'other'), 'tags' => (string) ($x['tags'] ?? ''), 'aud' => ($x['aud'] ?? 'all') === 'staff' ? 'staff' : 'all', 'pub' => !empty($x['pub']), 'web' => !empty($x['web']), 'views' => (int) ($x['views'] ?? 0), 'up' => (int) ($x['up'] ?? 0), 'down' => (int) ($x['down'] ?? 0), 'u' => (int) ($x['u'] ?? 0)];
    }
    return $out;
}
/** The most read articles (then by title), for the Help page. */
function deskPopular(array $u, int $n = 9): array
{
    $all = array_values(deskArticles($u));
    usort($all, fn($a, $b) => [$b['views'], $a['t']] <=> [$a['views'], $b['t']]);
    return array_map(fn($a) => ['id' => $a['id'], 't' => $a['t'], 'cat' => $a['cat']], array_slice($all, 0, $n));
}
/** Articles for a question, best first: words in the title count most, then tags, then the text. */
function deskKbSearch(array $u, string $q, int $n = 5): array
{
    $words = array_values(array_filter(preg_split('/[^a-z0-9\-]+/', mb_strtolower($q)) ?: [], fn($w) => strlen($w) > 2 && !in_array($w, ['the', 'and', 'for', 'how', 'can', 'not', 'what', 'why', 'with', 'my', 'you', 'your', 'have', 'does', 'this', 'that', 'from', 'get', 'when', 'where', 'need', 'help', 'please', 'there', 'are', 'was', 'its', 'it\'s', 'cant', 'dont', 'doesnt', 'into', 'about'], true)));
    if (!$words) {
        return [];
    }
    $out = [];
    foreach (deskArticles($u) as $a) {
        $t = mb_strtolower($a['t']);
        $tags = mb_strtolower($a['tags']);
        $b = mb_strtolower($a['body']);
        $s = 0;
        foreach ($words as $w) {
            $stem = strlen($w) > 5 ? substr($w, 0, -1) : $w;
            $s += (str_contains($t, $stem) ? 6 : 0) + (str_contains($tags, $stem) ? 4 : 0) + min(3, substr_count($b, $stem));
        }
        if ($s >= 4) {
            $out[] = $a + ['score' => $s];
        }
    }
    usort($out, fn($x, $y) => $y['score'] <=> $x['score']);
    return array_slice($out, 0, $n);
}
/** The category a description most likely belongs to. */
function deskGuessCat(string $text): string
{
    $t = ' ' . mb_strtolower($text) . ' ';
    $best = 'other';
    $bestN = 0;
    foreach (DESK_CATS as $k => [, , $words]) {
        $n = 0;
        foreach (preg_split('/\s+/', $words) ?: [] as $w) {
            if ($w === '') {
                continue;
            }
            $weight = $w[0] === '+' ? 2 : 1;
            $w = ltrim($w, '+');
            $re = str_replace('_', '\s+', preg_quote($w, '/'));
            if (preg_match('/\b' . $re . (strlen($w) <= 3 ? '\b' : '') . '/u', $t)) {
                $n += $weight;
            }
        }
        if ($n > $bestN) {
            [$best, $bestN] = [$k, $n];
        }
    }
    return $best;
}
/** Impact x urgency, as in ServiceNow (its P5 folded into P4), except that someone who can't work at all is never below P2. */
function deskPri(int $impact, int $urgency): int
{
    $u = max(1, min(3, $urgency));
    $s = max(1, min(3, $impact)) + $u;
    $p = $s <= 2 ? 1 : ($s === 3 ? 2 : ($s === 4 ? 3 : 4));
    return $u === 1 ? min($p, 2) : $p;
}

/* ---------- tickets ---------- */

function deskGet(string $ref): ?array
{
    $num = (int) preg_replace('/\D/', '', $ref);
    $st = ddb()->prepare(preg_match('/^[a-f0-9]{16}$/', $ref) ? 'SELECT * FROM desk_tickets WHERE id = ?' : 'SELECT * FROM desk_tickets WHERE num = ?');
    $st->execute([preg_match('/^[a-f0-9]{16}$/', $ref) ? $ref : $num]);
    return $st->fetch() ?: null;
}
/** What the browser sees of a ticket (internal fields only for people who work it). */
function deskOut(array $t, ?array $u = null): array
{
    $now = now();
    $open = in_array($t['st'], DESK_OPEN, true);
    $paused = $t['st'] === 'hold' ? $now - (int) $t['hold_since'] : 0;
    $groups = deskGroups();
    $o = [
        'id' => $t['id'],
        'num' => 'SD-' . $t['num'],
        'kind' => $t['kind'],
        'title' => $t['title'],
        'body' => $t['body'],
        'cat' => $t['cat'],
        'catName' => DESK_CATS[$t['cat']][0] ?? $t['cat'],
        'impact' => (int) $t['impact'],
        'urgency' => (int) $t['urgency'],
        'pri' => (int) $t['pri'],
        'st' => $t['st'],
        'stName' => DESK_ST[$t['st']] ?? $t['st'],
        'grp' => $t['grp'],
        'grpName' => $groups[$t['grp']]['n'] ?? $t['grp'],
        'asg' => $t['asg'],
        'asgName' => $t['asg_name'],
        'by' => $t['by_name'],
        'byUid' => $t['by_uid'],
        'byEmail' => $t['by_email'],
        'created' => (int) $t['created'],
        'updated' => (int) $t['updated'],
        'firstResp' => (int) $t['first_resp'],
        'dueResp' => (int) $t['due_resp'],
        'dueRes' => (int) $t['due_res'] + $paused,
        'resolvedAt' => (int) $t['resolved_at'],
        'closedAt' => (int) $t['closed_at'],
        'hold' => $t['hold_why'],
        'holdName' => DESK_HOLD[$t['hold_why']] ?? '',
        // feedback has no targets: it is read and answered, never late
        'breachResp' => $t['kind'] !== 'feedback' && ((int) $t['first_resp'] === 0 && $open && $now > (int) $t['due_resp'] || ((int) $t['breach'] & 1) === 1),
        'breachRes' => $t['kind'] !== 'feedback' && ($open && $t['st'] !== 'hold' && $now > (int) $t['due_res'] + $paused || ((int) $t['breach'] & 2) === 2),
        'item' => $t['item'],
        'vars' => json_decode((string) $t['vars'], true) ?: [],
        'appr' => json_decode((string) $t['appr'], true) ?: null,
        'src' => $t['src'],
        'res' => $t['res_code'],
        'resName' => DESK_RES[$t['res_code']] ?? '',
        'csat' => (int) $t['csat'],
        'csatNote' => $t['csat_note'],
        'page' => $t['page'],
    ];
    if ($u) {
        $o['mine'] = (string) $t['by_uid'] === (string) $u['id'];
        $o['canWork'] = deskCanWork($u, $t);
        $appr = $o['appr'];
        $o['canApprove'] = $t['st'] === 'approval' && is_array($appr) && in_array((string) $u['id'], (array) ($appr['who'] ?? []), true);
    }
    return $o;
}
function deskNotes(string $tid, bool $internal): array
{
    $st = ddb()->prepare('SELECT * FROM desk_notes WHERE ticket = ?' . ($internal ? '' : ' AND pub = 1') . ' ORDER BY at');
    $st->execute([$tid]);
    return array_map(fn($n) => ['id' => $n['id'], 'at' => (int) $n['at'], 'by' => $n['by_name'], 'byUid' => $n['by_uid'], 'kind' => $n['kind'], 'pub' => (bool) $n['pub'], 'body' => $n['body']], $st->fetchAll());
}
function deskNote(string $tid, array $u, string $kind, bool $pub, string $body): void
{
    ddb()->prepare('INSERT INTO desk_notes (id, ticket, at, by_uid, by_name, kind, pub, body) VALUES (?,?,?,?,?,?,?,?)')->execute([rid(8), $tid, now(), (string) ($u['id'] ?? ''), mb_substr((string) ($u['name'] ?? 'StratEdge'), 0, 190), $kind, $pub ? 1 : 0, mb_substr($body, 0, 20000)]);
}
function deskSet(string $tid, array $f): void
{
    $f['updated'] = now();
    $cols = implode(', ', array_map(fn($k) => "$k = ?", array_keys($f)));
    ddb()->prepare("UPDATE desk_tickets SET $cols WHERE id = ?")->execute([...array_values($f), $tid]);
}
/** The portal page a person opens a ticket on: the Help page for requesters, the Service desk for the people working it. */
function deskLink(array $t, string $uid, bool $agent): string
{
    if (!$agent && $uid === '' && (string) $t['by_uid'] === '') {
        // v35: someone who wrote from the public website follows their request on its own page (no login)
        return siteUrl() . '#/support?k=' . deskGuestToken($t);
    }
    if (!$agent) {
        return siteUrl() . '#/portal/help?t=SD-' . $t['num'];
    }
    $row = userRow($uid);
    $roles = $row ? rolesOf($row) : [];
    $sp = in_array('admin', $roles, true) ? 'admin/desk' : (in_array('hr', $roles, true) ? 'hr/desk' : (in_array('acct', $roles, true) ? 'acct/desk' : 'tools/desk'));
    return siteUrl() . '#/portal/' . $sp . '?t=SD-' . $t['num'];
}
/** One email about a ticket. The subject keeps [SD-1234] so a reply comes back to the same ticket. */
function deskMail(array $t, string $uid, string $email, string $name, string $lead, array $paras, bool $agent = false): void
{
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return;
    }
    $s = deskSettings();
    $link = deskLink($t, $uid, $agent);
    $subject = '[SD-' . $t['num'] . '] ' . mb_substr((string) $t['title'], 0, 120);
    if ($agent && $uid !== '') {
        // v83: a reply to an email for someone working the ticket posts as them only with their own reference
        $subject .= ' [ref:' . deskReplyRef($t, $uid) . ']';
    }
    $text = $lead . "\n\n" . implode("\n\n", $paras) . "\n\nOpen it: $link\n\nReply to this email to add to the ticket (keep [SD-" . $t['num'] . '] in the subject).';
    try {
        require_once __DIR__ . '/mail.php';
        mailDeliver([
            'to' => $email,
            'name' => $name,
            'subject' => $subject,
            'text' => $text,
            'html' => emailHtml($lead, array_merge($paras, ['Reply to this email to add to the ticket.']), ['Open SD-' . $t['num'], $link]),
            'reply' => $s['email'] ?: '',
            'kind' => 'desk',
            'ref' => 'SD-' . $t['num'],
        ]);
    } catch (Throwable $e) {
        // the ticket matters more than the email
    }
}
/** Everyone in the ticket's group (or the assignee, when there is one). */
function deskTellAgents(array $t, string $lead, array $paras, string $exceptUid = ''): void
{
    $ids = (string) $t['asg'] !== '' ? [(string) $t['asg']] : (deskGroups()[$t['grp']]['members'] ?? []);
    if (!$ids) {
        // a group nobody is in yet: the administrators hear about it
        $ids = array_map('strval', db()->query("SELECT id FROM users WHERE role = 'admin' AND status = 'active'")->fetchAll(PDO::FETCH_COLUMN));
    }
    foreach (array_slice($ids, 0, 25) as $uid) {
        if ($uid === $exceptUid) {
            continue;
        }
        $row = userRow($uid);
        if ($row && ($row['status'] ?? '') === 'active') {
            deskMail($t, $uid, (string) $row['email'], (string) $row['name'], $lead, $paras, true);
        }
    }
}
/**
 * Opens a ticket. $x: kind (incident | request | feedback), title, body, cat, impact, urgency, item (catalog id) with
 * vars, page, rating (feedback), src. Returns the stored row.
 */
function deskCreate(array $u, array $x): array
{
    $s = deskSettings();
    $kind = in_array($x['kind'] ?? '', ['incident', 'request', 'feedback'], true) ? $x['kind'] : 'incident';
    $item = null;
    if ($kind === 'request') {
        foreach (deskCatalog() as $c) {
            if ($c['id'] === (string) ($x['item'] ?? '')) {
                $item = $c;
            }
        }
        if (!$item) {
            fail(404, 'not_found', 'That request is not offered any more.');
        }
    }
    $vars = [];
    if ($item) {
        foreach ($item['fields'] as $f) {
            $k = (string) ($f['k'] ?? '');
            $v = mb_substr(trim((string) ($x['vars'][$k] ?? '')), 0, 2000);
            if (!empty($f['req']) && $v === '') {
                fail(400, 'invalid_argument', 'Fill in: ' . ($f['l'] ?? $k) . '.');
            }
            if (($f['type'] ?? '') === 'select' && $v !== '' && !in_array($v, (array) ($f['opts'] ?? []), true)) {
                fail(400, 'invalid_argument', 'Choose one of the options for ' . ($f['l'] ?? $k) . '.');
            }
            if ($v !== '') {
                $vars[] = ['l' => (string) ($f['l'] ?? $k), 'v' => $v];
            }
        }
    }
    $title = mb_substr(trim((string) ($x['title'] ?? '')), 0, 200);
    $body = mb_substr(trim((string) ($x['body'] ?? '')), 0, 20000);
    if ($item) {
        $title = $title !== '' ? $title : $item['t'];
    }
    if ($kind === 'feedback') {
        $title = $title !== '' ? $title : 'Feedback' . (!empty($x['rating']) ? ' (' . max(1, min(5, (int) $x['rating'])) . '/5)' : '');
        if ($body === '') {
            fail(400, 'invalid_argument', 'Write your feedback first.');
        }
    }
    if ($title === '' || ($kind === 'incident' && $body === '')) {
        fail(400, 'invalid_argument', 'Say briefly what is wrong, and add the details.');
    }
    $cat = $item ? $item['cat'] : ($kind === 'feedback' ? 'feedback' : (isset(DESK_CATS[$x['cat'] ?? '']) ? (string) $x['cat'] : deskGuessCat($title . ' ' . $body)));
    $impact = $kind === 'feedback' ? 3 : max(1, min(3, (int) ($x['impact'] ?? 3)));
    $urgency = $kind === 'feedback' ? 3 : max(1, min(3, (int) ($x['urgency'] ?? 3)));
    $pri = deskPri($impact, $urgency);
    $grp = $item ? $item['grp'] : (DESK_CATS[$cat][1] ?? 'gen');
    if (!isset(deskGroups()[$grp])) {
        $grp = isset(deskGroups()['gen']) ? 'gen' : (string) (array_key_first(deskGroups()) ?? 'gen');
    }
    $now = now();
    [$resp, $res] = $s['sla'][$pri];
    // approval: administrators (or the group's members) approve before the request is worked
    $appr = null;
    $st = 'new';
    if ($item && $item['appr'] !== 'none') {
        $who = $item['appr'] === 'grp' ? (deskGroups()[$grp]['members'] ?? []) : array_map('strval', db()->query("SELECT id FROM users WHERE role = 'admin' AND status = 'active'")->fetchAll(PDO::FETCH_COLUMN));
        $who = array_values(array_filter($who, fn($id) => $id !== (string) $u['id']));
        if ($who) {
            $appr = ['who' => $who, 'st' => 'pending', 'at' => 0, 'by' => '', 'note' => ''];
            $st = 'approval';
        }
    }
    $pdo = ddb();
    $pdo->beginTransaction();
    try {
        $pdo->exec("UPDATE meta SET v = v + 1 WHERE k = 'desk_seq'");
        $num = (int) $pdo->query("SELECT v FROM meta WHERE k = 'desk_seq'")->fetchColumn();
        $id = rid(8);
        $pdo->prepare('INSERT INTO desk_tickets (id, num, kind, title, body, cat, impact, urgency, pri, st, grp, asg, asg_name, by_uid, by_name, by_email, created, updated,
            first_resp, due_resp, due_res, resolved_at, closed_at, hold_why, hold_since, breach, notified, item, vars, appr, src, res_code, csat, csat_note, page)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,\'\',\'\',?,?,?,?,?,0,?,?,0,0,\'\',0,0,0,?,?,?,?,\'\',0,\'\',?)')->execute([
            $id, $num, $kind, $title, $body, $cat, $impact, $urgency, $pri, $st, $grp, (string) $u['id'], mb_substr((string) $u['name'], 0, 190), mb_substr((string) $u['email'], 0, 190),
            $now, $now, $now + $resp * 60000, $now + $res * 60000, $item ? $item['id'] : '', json_encode($vars, JSON_UNESCAPED_UNICODE), $appr ? json_encode($appr) : '', in_array($x['src'] ?? '', ['portal', 'bot', 'email', 'web', 'signin'], true) ? $x['src'] : 'portal', mb_substr((string) ($x['page'] ?? ''), 0, 300),
        ]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    $t = (array) deskGet($id);
    $lines = $vars ? array_map(fn($v) => $v['l'] . ': ' . $v['v'], $vars) : [];
    if ($s['notify']['create']) {
        deskMail($t, (string) $u['id'], (string) $u['email'], (string) $u['name'], 'We have your ' . ($kind === 'request' ? 'request' : ($kind === 'feedback' ? 'feedback' : 'ticket')) . ': SD-' . $num, array_merge([$st === 'approval' ? 'It needs an approval first; we will tell you when it is approved.' : ($kind === 'feedback' ? 'Thank you. The team reads every message.' : DESK_PRI[$pri] . ': we answer within ' . deskMins($resp) . '.')], $lines));
    }
    if ($st === 'approval') {
        foreach ($appr['who'] as $aid) {
            $row = userRow($aid);
            if ($row) {
                deskMail($t, $aid, (string) $row['email'], (string) $row['name'], 'Approval needed: ' . $title, array_merge(['Requested by ' . $u['name'] . '. Approve or reject it in the Service desk.'], $lines), true);
            }
        }
    } elseif ($kind !== 'feedback' || $s['notify']['assign']) {
        deskTellAgents($t, 'New ticket SD-' . $num . ' (' . DESK_PRI[$pri] . ')', array_merge(['From ' . $u['name'] . ' · ' . (DESK_CATS[$cat][0] ?? $cat)], $lines, [$body !== '' ? mb_substr($body, 0, 1200) : '']), (string) $u['id']);
    }
    return $t;
}
function deskMins(int $m): string
{
    return $m < 60 ? $m . ' minutes' : ($m < 1440 ? round($m / 60) . ' hour' . (round($m / 60) == 1 ? '' : 's') : round($m / 1440) . ' day' . (round($m / 1440) == 1 ? '' : 's'));
}
/** A public answer from someone working the ticket is the first response. */
function deskResponded(array $t): array
{
    $f = [];
    if ((int) $t['first_resp'] === 0) {
        $f['first_resp'] = now();
    }
    return $f;
}
/** Leaving "On hold" moves the resolution target on by the time spent waiting. */
function deskUnhold(array $t): array
{
    return $t['st'] === 'hold' ? ['due_res' => (int) $t['due_res'] + max(0, now() - (int) $t['hold_since']), 'hold_why' => '', 'hold_since' => 0] : [];
}
/** Someone working the ticket changes it: assign, take, start, hold, resolve, close, cancel, reopen, or the fields. */
function deskAct(array $u, array $t, string $act, array $b): array
{
    $s = deskSettings();
    $now = now();
    $groups = deskGroups();
    $note = mb_substr(trim((string) ($b['note'] ?? '')), 0, 20000);
    // v83: a request waiting for approval is only approved, rejected (desk_approve) or cancelled; a closed or cancelled
    // ticket is only reopened (group members could otherwise work or resolve a request nobody approved)
    if ($t['st'] === 'approval' && $act !== 'cancel') {
        fail(400, 'invalid_argument', 'This request is waiting for approval. It can be worked once it is approved.');
    }
    if (in_array($t['st'], ['closed', 'cancelled'], true) && $act !== 'reopen') {
        fail(400, 'invalid_argument', 'This ticket is closed. Reopen it first.');
    }
    switch ($act) {
        case 'take':
        case 'assign':
            $uid = $act === 'take' ? (string) $u['id'] : (string) ($b['uid'] ?? '');
            $grp = (string) ($b['grp'] ?? $t['grp']);
            if (!isset($groups[$grp])) {
                fail(400, 'invalid_argument', 'Unknown group.');
            }
            $row = $uid !== '' ? userRow($uid) : null;
            if ($uid !== '' && (!$row || (!in_array($uid, $groups[$grp]['members'], true) && !hasRole($row, 'admin')))) {
                fail(400, 'invalid_argument', 'Assign it to someone in the ' . $groups[$grp]['n'] . ' group.');
            }
            $f = ['grp' => $grp, 'asg' => $uid, 'asg_name' => $row ? mb_substr((string) $row['name'], 0, 190) : ''];
            if (in_array($t['st'], ['new', 'assigned'], true)) {
                $f['st'] = $uid !== '' ? 'assigned' : 'new';
            }
            deskSet($t['id'], $f);
            deskNote($t['id'], $u, 'system', false, $uid !== '' ? 'Assigned to ' . $row['name'] . ' (' . $groups[$grp]['n'] . ')' : 'Moved to ' . $groups[$grp]['n']);
            if ($uid !== '' && $uid !== (string) $u['id'] && $s['notify']['assign']) {
                deskMail(array_merge($t, $f), $uid, (string) $row['email'], (string) $row['name'], 'SD-' . $t['num'] . ' is assigned to you (' . DESK_PRI[(int) $t['pri']] . ')', [$t['title'], 'From ' . $t['by_name'] . '.'], true);
            }
            break;
        case 'start':
            deskSet($t['id'], ['st' => 'progress'] + deskUnhold($t) + ($t['asg'] === '' ? ['asg' => (string) $u['id'], 'asg_name' => mb_substr((string) $u['name'], 0, 190)] : []) + deskResponded($t));
            deskNote($t['id'], $u, 'system', true, 'Work started');
            break;
        case 'hold':
            $why = (string) ($b['why'] ?? 'caller');
            if (!isset(DESK_HOLD[$why])) {
                fail(400, 'invalid_argument', 'Say what the ticket waits for.');
            }
            if ($why === 'caller' && $note === '') {
                fail(400, 'invalid_argument', 'Ask the requester your question: they get it by email.');
            }
            deskSet($t['id'], ['st' => 'hold', 'hold_why' => $why, 'hold_since' => $now] + deskResponded($t));
            deskNote($t['id'], $u, 'system', true, 'On hold: ' . DESK_HOLD[$why]);
            if ($note !== '') {
                deskNote($t['id'], $u, 'comment', true, $note);
                if ($s['notify']['update']) {
                    deskMail($t, (string) $t['by_uid'], (string) $t['by_email'], (string) $t['by_name'], $why === 'caller' ? 'We need something from you: SD-' . $t['num'] : 'An update on SD-' . $t['num'], [$note]);
                }
            }
            break;
        case 'resolve':
            $code = (string) ($b['code'] ?? 'solved');
            if (!isset(DESK_RES[$code])) {
                fail(400, 'invalid_argument', 'Choose how it was resolved.');
            }
            if ($note === '') {
                fail(400, 'invalid_argument', 'Write what was done: the requester gets it by email.');
            }
            deskSet($t['id'], ['st' => 'resolved', 'res_code' => $code, 'resolved_at' => $now] + deskUnhold($t) + deskResponded($t) + ($t['asg'] === '' ? ['asg' => (string) $u['id'], 'asg_name' => mb_substr((string) $u['name'], 0, 190)] : []));
            deskNote($t['id'], $u, 'comment', true, 'Resolved (' . DESK_RES[$code] . '): ' . $note);
            if ($s['notify']['update']) {
                deskMail($t, (string) $t['by_uid'], (string) $t['by_email'], (string) $t['by_name'], 'Resolved: SD-' . $t['num'], [$note, 'If it is not fixed, reply to this email or reopen it in the portal within ' . $s['autoClose'] . ' days; after that it closes.']);
            }
            break;
        case 'close':
            if (!in_array($t['st'], ['resolved', 'new', 'assigned', 'progress', 'hold'], true)) {
                fail(400, 'invalid_argument', 'This ticket is already closed.');
            }
            deskSet($t['id'], ['st' => 'closed', 'closed_at' => $now] + ($t['resolved_at'] ? [] : ['resolved_at' => $now, 'res_code' => isset(DESK_RES[$b['code'] ?? '']) ? (string) $b['code'] : 'noaction']));
            deskNote($t['id'], $u, 'system', true, 'Closed' . ($note !== '' ? ': ' . $note : ''));
            break;
        case 'cancel':
            deskSet($t['id'], ['st' => 'cancelled', 'closed_at' => $now] + deskUnhold($t));
            deskNote($t['id'], $u, 'system', true, 'Cancelled' . ($note !== '' ? ': ' . $note : ''));
            break;
        case 'reopen':
            if (!in_array($t['st'], ['resolved', 'closed'], true)) {
                fail(400, 'invalid_argument', 'Only a resolved or closed ticket can be reopened.');
            }
            deskSet($t['id'], ['st' => $t['asg'] !== '' ? 'progress' : 'new', 'resolved_at' => 0, 'closed_at' => 0, 'res_code' => '', 'due_res' => $now + $s['sla'][(int) $t['pri']][1] * 60000, 'breach' => (int) $t['breach'] & 1]);
            deskNote($t['id'], $u, 'system', true, 'Reopened' . ($note !== '' ? ': ' . $note : ''));
            break;
        case 'fields':
            $impact = max(1, min(3, (int) ($b['impact'] ?? $t['impact'])));
            $urgency = max(1, min(3, (int) ($b['urgency'] ?? $t['urgency'])));
            $cat = isset(DESK_CATS[$b['cat'] ?? '']) ? (string) $b['cat'] : $t['cat'];
            $pri = deskPri($impact, $urgency);
            $f = ['impact' => $impact, 'urgency' => $urgency, 'cat' => $cat, 'pri' => $pri];
            if ($pri !== (int) $t['pri']) {
                // a new priority brings new targets, counted from when the ticket was opened (time on hold still added)
                [$resp, $res] = $s['sla'][$pri];
                $held = max(0, (int) $t['due_res'] - ((int) $t['created'] + $s['sla'][(int) $t['pri']][1] * 60000));
                $f['due_resp'] = (int) $t['created'] + $resp * 60000;
                $f['due_res'] = (int) $t['created'] + $res * 60000 + $held;
                $f['breach'] = 0;
                $f['notified'] = 0;
            }
            deskSet($t['id'], $f);
            deskNote($t['id'], $u, 'system', false, 'Priority ' . DESK_PRI[$pri] . ' (impact ' . $impact . ', urgency ' . $urgency . '), ' . (DESK_CATS[$cat][0] ?? $cat));
            break;
        default:
            fail(400, 'invalid_argument', 'Unknown action.');
    }
    return (array) deskGet($t['id']);
}
/** A comment: public (the requester sees it, and gets it by email when someone else wrote it) or an internal work note. */
function deskComment(array $u, array $t, string $body, bool $pub, string $via = 'comment'): array
{
    $s = deskSettings();
    $body = trim($body);
    if ($body === '') {
        fail(400, 'invalid_argument', 'Write something first.');
    }
    $mine = (string) $t['by_uid'] === (string) $u['id'];
    deskNote($t['id'], $u, $pub ? ($via === 'email' ? 'email' : 'comment') : 'work', $pub, $body);
    $f = [];
    if ($mine) {
        // the requester answers: a ticket waiting for them, or resolved, goes back to work
        if ($t['st'] === 'hold' && $t['hold_why'] === 'caller') {
            $f = ['st' => $t['asg'] !== '' ? 'progress' : 'new'] + deskUnhold($t);
        } elseif ($t['st'] === 'resolved') {
            $f = ['st' => $t['asg'] !== '' ? 'progress' : 'new', 'resolved_at' => 0, 'res_code' => '', 'due_res' => now() + $s['sla'][(int) $t['pri']][1] * 60000];
            deskNote($t['id'], $u, 'system', true, 'Reopened by the requester\'s reply');
        }
        if ($s['notify']['update']) {
            deskTellAgents($t, 'SD-' . $t['num'] . ': ' . $u['name'] . ' wrote', [mb_substr($body, 0, 2000)], (string) $u['id']);
        }
    } elseif ($pub) {
        $f = deskResponded($t);
        if ($s['notify']['update']) {
            deskMail($t, (string) $t['by_uid'], (string) $t['by_email'], (string) $t['by_name'], $u['name'] . ' answered SD-' . $t['num'], [$body]);
        }
    }
    deskSet($t['id'], $f);
    return (array) deskGet($t['id']);
}
function deskApprove(array $u, array $t, bool $yes, string $note): array
{
    $appr = json_decode((string) $t['appr'], true) ?: [];
    if ($t['st'] !== 'approval' || !in_array((string) $u['id'], (array) ($appr['who'] ?? []), true)) {
        fail(403, 'forbidden', 'You are not an approver of this request.');
    }
    $appr['st'] = $yes ? 'approved' : 'rejected';
    $appr['at'] = now();
    $appr['by'] = (string) $u['name'];
    $appr['note'] = mb_substr($note, 0, 1000);
    $s = deskSettings();
    $f = ['appr' => json_encode($appr)];
    if ($yes) {
        // the response and resolution clocks start now
        [$resp, $res] = $s['sla'][(int) $t['pri']];
        $f += ['st' => 'new', 'due_resp' => now() + $resp * 60000, 'due_res' => now() + $res * 60000];
    } else {
        $f += ['st' => 'closed', 'closed_at' => now(), 'resolved_at' => now(), 'res_code' => 'noaction'];
    }
    deskSet($t['id'], $f);
    deskNote($t['id'], $u, 'system', true, ($yes ? 'Approved' : 'Rejected') . ' by ' . $u['name'] . ($note !== '' ? ': ' . $note : ''));
    $t2 = (array) deskGet($t['id']);
    deskMail($t2, (string) $t['by_uid'], (string) $t['by_email'], (string) $t['by_name'], ($yes ? 'Approved: ' : 'Not approved: ') . 'SD-' . $t['num'], [$yes ? 'Your request is approved and on its way to ' . (deskGroups()[$t['grp']]['n'] ?? 'the team') . '.' : 'Your request was not approved.' . ($note !== '' ? ' ' . $note : '')]);
    if ($yes) {
        deskTellAgents($t2, 'New approved request SD-' . $t['num'], [$t['title'], 'From ' . $t['by_name'] . '.']);
    }
    return $t2;
}

/* ---------- the queue and the dashboard ---------- */

/** The tickets one person may see, filtered: view (mine | groups | unassigned | open | breached | approvals | closed | all), q, pri, grp, st. */
function deskQueue(array $u, array $b): array
{
    $where = [];
    $args = [];
    $admin = deskIsAdmin($u);
    $groups = deskMyGroups($u);
    if (!$admin) {
        $in = $groups ? implode(',', array_fill(0, count($groups), '?')) : "''";
        $where[] = "(grp IN ($in) OR asg = ?)";
        $args = array_merge($args, $groups, [(string) $u['id']]);
    }
    $openIn = "'" . implode("','", DESK_OPEN) . "'";
    $view = (string) ($b['view'] ?? 'open');
    $now = now();
    switch ($view) {
        case 'mine':
            $where[] = "asg = ? AND st IN ($openIn)";
            $args[] = (string) $u['id'];
            break;
        case 'groups':
            $in = $groups ? implode(',', array_fill(0, count($groups), '?')) : "''";
            $where[] = "grp IN ($in) AND st IN ($openIn)";
            $args = array_merge($args, $groups);
            break;
        case 'unassigned':
            $where[] = "asg = '' AND st IN ('new', 'assigned', 'progress', 'hold')";
            break;
        case 'breached':
            $where[] = "st IN ($openIn) AND st <> 'approval' AND kind <> 'feedback' AND ((first_resp = 0 AND due_resp < ?) OR (st <> 'hold' AND due_res < ?) OR breach > 0)";
            array_push($args, $now, $now);
            break;
        case 'approvals':
            $where[] = "st = 'approval'";
            break;
        case 'closed':
            $where[] = "st IN ('resolved', 'closed', 'cancelled')";
            break;
        case 'all':
            break;
        default:
            $where[] = "st IN ($openIn)";
    }
    $q = trim((string) ($b['q'] ?? ''));
    if ($q !== '') {
        if (preg_match('/^(?:sd-?)?(\d{3,})$/i', $q, $m)) {
            $where[] = 'num = ?';
            $args[] = (int) $m[1];
        } else {
            $where[] = '(LOWER(title) LIKE ? OR LOWER(by_name) LIKE ? OR LOWER(by_email) LIKE ? OR LOWER(body) LIKE ?)';
            $like = '%' . mb_strtolower($q) . '%';
            array_push($args, $like, $like, $like, $like);
        }
    }
    foreach (['pri' => 'pri', 'grp' => 'grp', 'st' => 'st'] as $k => $col) {
        if (($b[$k] ?? '') !== '' && $b[$k] !== null) {
            $where[] = "$col = ?";
            $args[] = $k === 'pri' ? (int) $b[$k] : (string) $b[$k];
        }
    }
    $sql = ' FROM desk_tickets' . ($where ? ' WHERE ' . implode(' AND ', $where) : '');
    $cnt = ddb()->prepare('SELECT COUNT(*)' . $sql);
    $cnt->execute($args);
    $limit = max(1, min(200, (int) ($b['limit'] ?? 50)));
    $offset = max(0, (int) ($b['offset'] ?? 0));
    $order = $view === 'closed' || $view === 'all' ? 'updated DESC' : 'pri ASC, due_res ASC';
    $st = ddb()->prepare('SELECT *' . $sql . " ORDER BY $order LIMIT $limit OFFSET $offset");
    $st->execute($args);
    return ['rows' => array_map(fn($t) => deskOut($t, $u), $st->fetchAll()), 'total' => (int) $cnt->fetchColumn()];
}
/** The numbers on the Service desk dashboard, over what this person may see. */
function deskDash(array $u): array
{
    $admin = deskIsAdmin($u);
    $groups = deskMyGroups($u);
    $scope = '';
    $args = [];
    if (!$admin) {
        $in = $groups ? implode(',', array_fill(0, count($groups), '?')) : "''";
        $scope = " AND (grp IN ($in) OR asg = ?)";
        $args = [...$groups, (string) $u['id']];
    }
    $now = now();
    $q = function (string $where, array $a = []) use ($scope, $args) {
        $st = ddb()->prepare('SELECT * FROM desk_tickets WHERE ' . $where . $scope);
        $st->execute([...$a, ...$args]);
        return $st->fetchAll();
    };
    $open = $q("st IN ('" . implode("','", DESK_OPEN) . "')");
    $byPri = [1 => 0, 2 => 0, 3 => 0, 4 => 0];
    $bySt = array_fill_keys(DESK_OPEN, 0);
    $byGrp = [];
    $breached = 0;
    $soon = 0;
    $unassigned = 0;
    $mine = 0;
    foreach ($open as $t) {
        $byPri[(int) $t['pri']]++;
        $bySt[$t['st']]++;
        $byGrp[$t['grp']] = ($byGrp[$t['grp']] ?? 0) + 1;
        $o = deskOut($t);
        if ($t['st'] !== 'approval' && ($o['breachResp'] || $o['breachRes'])) {
            $breached++;
        } elseif ($t['kind'] !== 'feedback' && $t['st'] !== 'hold' && $t['st'] !== 'approval' && $o['dueRes'] - $now < 3600000) {
            $soon++;
        }
        if ($t['asg'] === '' && $t['st'] !== 'approval') {
            $unassigned++;
        }
        if ((string) $t['asg'] === (string) $u['id']) {
            $mine++;
        }
    }
    // the last 14 days: opened and resolved per day
    $since = (int) (floor($now / 86400000) * 86400000) - 13 * 86400000;
    $days = [];
    for ($i = 0; $i < 14; $i++) {
        $days[gmdate('Y-m-d', (int) (($since + $i * 86400000) / 1000))] = ['in' => 0, 'out' => 0];
    }
    foreach ($q('(created >= ? OR resolved_at >= ?)', [$since, $since]) as $t) {
        $d1 = gmdate('Y-m-d', (int) ((int) $t['created'] / 1000));
        if (isset($days[$d1]) && (int) $t['created'] >= $since) {
            $days[$d1]['in']++;
        }
        if ((int) $t['resolved_at'] >= $since) {
            $d2 = gmdate('Y-m-d', (int) ((int) $t['resolved_at'] / 1000));
            if (isset($days[$d2])) {
                $days[$d2]['out']++;
            }
        }
    }
    // the last 30 days: time to resolve, met SLAs, satisfaction
    $done = $q('resolved_at >= ?', [$now - 30 * 86400000]);
    $mins = [];
    $met = 0;
    $slaN = 0;
    $csat = [];
    foreach ($done as $t) {
        $mins[] = ((int) $t['resolved_at'] - (int) $t['created']) / 60000;
        if ($t['kind'] !== 'feedback' && ($t['appr'] === '' || (json_decode((string) $t['appr'], true)['st'] ?? '') === 'approved')) {
            $slaN++;
            $met += ((int) $t['breach'] & 2) === 0 && (int) $t['resolved_at'] <= (int) $t['due_res'] ? 1 : 0;
        }
        if ((int) $t['csat'] > 0) {
            $csat[] = (int) $t['csat'];
        }
    }
    sort($mins);
    $groupsAll = deskGroups();
    return [
        'open' => count($open),
        'byPri' => $byPri,
        'bySt' => $bySt,
        'byGrp' => array_map(fn($k, $n) => ['id' => $k, 'n' => $groupsAll[$k]['n'] ?? $k, 'c' => $n], array_keys($byGrp), array_values($byGrp)),
        'breached' => $breached,
        'soon' => $soon,
        'unassigned' => $unassigned,
        'mine' => $mine,
        'approvals' => $bySt['approval'],
        'days' => array_map(fn($d, $v) => ['d' => $d] + $v, array_keys($days), array_values($days)),
        'resolved30' => count($done),
        'medianMins' => $mins ? (int) round($mins[intdiv(count($mins), 2)]) : 0,
        'slaMet' => $slaN ? (int) round($met * 100 / $slaN) : null,
        'csat' => $csat ? round(array_sum($csat) / count($csat), 1) : null,
        'csatN' => count($csat),
    ];
}

/* ---------- the support bot ---------- */

/** Answers a question from the knowledge base (and StratEdge AI when it is set up), and suggests a category. */
function deskBot(array $u, string $q): array
{
    $hits = deskKbSearch($u, $q, 3);
    // only the articles that match nearly as well as the best one
    $hits = $hits ? array_values(array_filter($hits, fn($a) => $a['score'] * 2 >= $hits[0]['score'])) : [];
    $cat = deskGuessCat($q);
    $out = ['articles' => array_map(fn($a) => ['id' => $a['id'], 't' => $a['t'], 'snip' => mb_substr((string) preg_replace('/\s+/', ' ', $a['body']), 0, 220), 'body' => $a['body']], $hits), 'cat' => $cat, 'catName' => DESK_CATS[$cat][0], 'answer' => ''];
    if ($hits && deskSettings()['bot'] && function_exists('aiReady') && aiReady('copilot')) {
        try {
            require_once __DIR__ . '/ai.php';
            $kb = implode("\n\n", array_map(fn($a) => '## ' . $a['t'] . "\n" . $a['body'], $hits));
            $answer = aiChatText([
                ['role' => 'system', 'content' => "You are the StratEdge IT Consulting help desk assistant inside the company portal. Answer the person's question in at most 6 short sentences, using only the help articles below. Use the portal's own page names. If the articles do not answer it, say so and suggest raising a ticket. Never ask for passwords, bank details or codes.\n\n" . $kb],
                ['role' => 'user', 'content' => mb_substr($q, 0, 2000)],
            ], 400, 0.2, 30);
            $out['answer'] = mb_substr(trim($answer), 0, 2000);
        } catch (Throwable $e) {
            // the articles are the answer
        }
    }
    return $out;
}

/* ---------- email: replies to [SD-1234] and new tickets sent to the support address ---------- */

/** Text above the quoted part of a reply ("On ... wrote:", "-----Original Message-----", lines starting with >). */
function deskReplyText(string $text): string
{
    $t = str_replace(["\r\n", "\r"], "\n", $text);
    $cut = preg_split('/\n\s*(On .{4,200}wrote:|-{2,}\s*Original Message\s*-{2,}|From: .+\nSent: |_{8,})/i', $t, 2);
    $t = (string) ($cut[0] ?? $t);
    $lines = array_filter(explode("\n", $t), fn($l) => !str_starts_with(ltrim($l), '>'));
    return trim(implode("\n", $lines));
}
/** Called for every email that reaches the site's inbox. Returns the ticket number it went to, or ''. */
function deskInbound(string $fromE, string $fromN, string $to, string $subject, string $text): string
{
    $fromE = strtolower(trim($fromE));
    $st = db()->prepare('SELECT id, email, name, role, status, access FROM users WHERE LOWER(email) = ?');
    $st->execute([$fromE]);
    $who = $st->fetch();
    if ((!$who || ($who['status'] ?? '') !== 'active') && preg_match('/\[SD-(\d{3,})\]/i', $subject, $m)) {
        // v35: a reply from someone who wrote from the public website (no account): the address must be theirs
        $t = deskGet($m[1]);
        if ($t && (string) $t['by_uid'] === '' && strtolower((string) $t['by_email']) === $fromE && !in_array($t['st'], ['closed', 'cancelled'], true)) {
            $body = deskReplyText($text);
            if ($body !== '') {
                deskComment(deskGuestUser($t), $t, $body, true, 'email');
                return 'SD-' . $t['num'];
            }
        }
        return '';
    }
    if (!$who || ($who['status'] ?? '') !== 'active') {
        return '';
    }
    if (preg_match('/\[SD-(\d{3,})\]/i', $subject, $m)) {
        $t = deskGet($m[1]);
        if (!$t || !deskCanSee($who, $t) || in_array($t['st'], ['closed', 'cancelled'], true)) {
            return '';
        }
        // v83: a From address can be forged: answering as someone who works the ticket (not its requester) needs the
        // reference from that person's own ticket email; the email still reaches the Inbox
        if ((string) $t['by_uid'] !== (string) $who['id'] && !(preg_match('/\[ref:([a-f0-9]{12})\]/i', $subject, $k) && hash_equals(deskReplyRef($t, (string) $who['id']), strtolower($k[1])))) {
            return '';
        }
        $body = deskReplyText($text);
        if ($body === '') {
            return '';
        }
        deskComment($who, $t, $body, true, 'email');
        return 'SD-' . $t['num'];
    }
    $s = deskSettings();
    if ($s['email'] !== '' && str_contains(strtolower($to), $s['email'])) {
        $t = deskCreate($who, ['kind' => 'incident', 'title' => mb_substr(trim($subject) ?: 'Email to support', 0, 200), 'body' => deskReplyText($text) ?: '(empty email)', 'impact' => 3, 'urgency' => 2, 'src' => 'email']);
        return 'SD-' . $t['num'];
    }
    return '';
}

/* ---------- v35: Help & support on the public website (no login) ---------- */

const DESK_WEB_TOPICS = ['signin' => 'Signing in or two-step sign-in', 'security' => 'A security concern about my account', 'portal' => 'The website or a portal page', 'other' => 'Something else'];
const DESK_WEB_PORTALS = ['consultant' => 'Consultant', 'employee' => 'Employee', 'client' => 'Client', 'student' => 'Student', 'staff' => 'Staff (admin, HR, accounting, manager)', 'none' => 'I do not have an account yet'];

/** The private link a website requester follows their ticket with (SD number + a seal of the ticket and its email). */
function deskGuestToken(array $t): string
{
    return $t['num'] . '.' . substr(secMac('deskguest', $t['id'] . '|' . strtolower((string) $t['by_email'])), 0, 32);
}
/** v83: the reference in a ticket email to someone working it: an emailed reply posts as them only when it carries
 *  their own reference (a From address can be forged). */
function deskReplyRef(array $t, string $uid): string
{
    return substr(secMac('deskreply', $t['id'] . '|' . $uid), 0, 12);
}
/** The person behind a website request, for the functions that expect a signed-in user. */
function deskGuestUser(array $t): array
{
    return ['id' => '', 'name' => (string) $t['by_name'], 'email' => (string) $t['by_email'], 'role' => 'guest', 'status' => 'active', 'access' => ''];
}
function deskGuestTicket(string $k): array
{
    if (!preg_match('/^(\d{3,9})\.([a-f0-9]{32})$/', $k, $m)) {
        fail(404, 'not_found', 'This link is not valid. Use the link from our latest email.');
    }
    $t = deskGet($m[1]);
    if (!$t || (string) $t['by_uid'] !== '' || !hash_equals(deskGuestToken($t), $k)) {
        fail(404, 'not_found', 'This link is not valid. Use the link from our latest email.');
    }
    if (in_array($t['st'], ['closed', 'cancelled'], true) && max((int) $t['closed_at'], (int) $t['updated']) < now() - 30 * 86400000) {
        fail(410, 'expired', 'This request was closed more than 30 days ago. Send a new one if you still need help.');
    }
    return $t;
}
/** What the requester sees on their status page. */
function deskGuestOut(array $t): array
{
    return ['num' => 'SD-' . $t['num'], 'title' => $t['title'], 'body' => $t['body'], 'st' => $t['st'], 'stName' => DESK_ST[$t['st']] ?? $t['st'], 'pri' => DESK_PRI[(int) $t['pri']] ?? '', 'created' => (int) $t['created'], 'updated' => (int) $t['updated'], 'by' => $t['by_name'], 'open' => in_array($t['st'], DESK_OPEN, true) || $t['st'] === 'resolved', 'notes' => array_map(fn($n) => ['at' => $n['at'], 'by' => $n['byUid'] === '' && $n['kind'] !== 'system' ? 'You' : $n['by'], 'kind' => $n['kind'], 'body' => $n['body']], deskNotes($t['id'], false))];
}
/** The articles shown on the website: published, for everyone, marked for the website. */
function deskWebArticles(): array
{
    deskSeed();
    $out = [];
    foreach (colAll('desk/x/kb') as [$id, $d]) {
        $x = deskObj($d);
        if (!empty($x['pub']) && !empty($x['web']) && ($x['aud'] ?? 'all') !== 'staff') {
            $out[] = ['id' => (string) $id, 't' => (string) ($x['t'] ?? ''), 'body' => (string) ($x['body'] ?? ''), 'cat' => (string) ($x['cat'] ?? 'other'), 'tags' => (string) ($x['tags'] ?? '')];
        }
    }
    usort($out, fn($a, $b) => $a['t'] <=> $b['t']);
    return $out;
}
function deskPublicRoute(string $r, array $b): never
{
    $s = deskSettings();
    switch ($r) {
        case 'pub_support':
            ok(['articles' => deskWebArticles(), 'topics' => DESK_WEB_TOPICS, 'portals' => DESK_WEB_PORTALS, 'on' => $s['web'], 'email' => (string) (cfg('mail_from') ?: '')]);
        case 'pub_support_bot':
            if (throttleHit('supbot:' . clientIp(), 60, 3600)) {
                fail(429, 'rate_limited', 'That is a lot of questions. Send us a request instead.');
            }
            $q = mb_strtolower(str($b, 'q', 300));
            $words = array_values(array_filter(preg_split('/[^a-z0-9\-]+/', $q) ?: [], fn($w) => strlen($w) > 2));
            $hits = [];
            foreach (deskWebArticles() as $a) {
                $sc = 0;
                foreach ($words as $w) {
                    $stem = strlen($w) > 5 ? substr($w, 0, -1) : $w;
                    $sc += (str_contains(mb_strtolower($a['t']), $stem) ? 6 : 0) + (str_contains(mb_strtolower($a['tags']), $stem) ? 4 : 0) + min(3, substr_count(mb_strtolower($a['body']), $stem));
                }
                if ($sc >= 4) {
                    $hits[] = $a + ['score' => $sc];
                }
            }
            usort($hits, fn($x, $y) => $y['score'] <=> $x['score']);
            $best = $hits ? $hits[0]['score'] : 0;
            ok(['answers' => array_map(fn($a) => ['id' => $a['id'], 't' => $a['t'], 'body' => $a['body']], array_slice(array_values(array_filter($hits, fn($h) => $h['score'] * 2 >= $best)), 0, 3))]);
        case 'pub_support_create':
            if (!$s['web']) {
                fail(403, 'off', 'Requests from the website are switched off. Email us instead.');
            }
            if (throttleHit('supnew:' . clientIp(), 5, 3600)) {
                fail(429, 'rate_limited', 'Too many requests from this network. Email us instead.');
            }
            $name = str($b, 'name', 120);
            $email = strtolower(str($b, 'email', 190));
            if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                fail(400, 'invalid_argument', 'Add your name and a valid email address.');
            }
            $body = str($b, 'body', 6000);
            if (mb_strlen($body) < 10) {
                fail(400, 'invalid_argument', 'Describe the problem in a sentence or two.');
            }
            if (fwScreen(['email' => $email, 'website' => $b['website'] ?? '', 't0' => $b['t0'] ?? 0, 'msg' => $body], 'support request') !== '') {
                fail(400, 'spam', 'This request could not be sent. Email us directly.');
            }
            if (throttleHit('supnewe:' . $email, 3, 86400)) {
                fail(429, 'rate_limited', 'You already sent requests today: we answer them by email. Reply to our email to add to them.');
            }
            $topic = isset(DESK_WEB_TOPICS[str($b, 'topic', 12)]) ? str($b, 'topic', 12) : 'other';
            $portal = isset(DESK_WEB_PORTALS[str($b, 'portal', 12)]) ? str($b, 'portal', 12) : 'none';
            $title = str($b, 'title', 200) ?: DESK_WEB_TOPICS[$topic];
            $t = deskCreate(['id' => '', 'name' => $name, 'email' => $email, 'role' => 'guest', 'status' => 'active', 'access' => ''], [
                'kind' => 'incident',
                'title' => $title,
                'body' => $body . "\n\nPortal: " . DESK_WEB_PORTALS[$portal],
                'cat' => in_array($topic, ['signin', 'security'], true) ? 'signin' : ($topic === 'portal' ? 'portal' : 'other'),
                'impact' => 3,
                'urgency' => in_array($topic, ['signin', 'security'], true) ? 1 : 2,
                'src' => 'web',
            ]);
            // for the people who work it (never shown to the requester): whether the address has an account
            $st = db()->prepare('SELECT id, name, role, status FROM users WHERE LOWER(email) = ?');
            $st->execute([$email]);
            $acc = $st->fetch();
            $st->closeCursor();
            deskNote($t['id'], ['id' => '', 'name' => 'StratEdge'], 'work', false, 'Sent from the public website, not signed in (' . clientIp() . '). ' . ($acc ? 'An account uses this address: ' . $acc['name'] . ' (' . $acc['status'] . ').' : 'No account uses this address.') . ' Confirm who it is before changing anything on an account.');
            ok(['num' => 'SD-' . $t['num']]);
        case 'pub_support_ticket':
            ok(['ticket' => deskGuestOut(deskGuestTicket(str($b, 'k', 80)))]);
        case 'pub_support_reply':
            if (throttleHit('suprep:' . clientIp(), 20, 3600)) {
                fail(429, 'rate_limited', 'Too many messages. Reply to our email instead.');
            }
            $t = deskGuestTicket(str($b, 'k', 80));
            if (in_array($t['st'], ['closed', 'cancelled'], true)) {
                fail(400, 'invalid_argument', 'This request is closed. Send a new one and mention SD-' . $t['num'] . '.');
            }
            $body = str($b, 'body', 6000);
            if ($body === '') {
                fail(400, 'invalid_argument', 'Write something first.');
            }
            ok(['ticket' => deskGuestOut(deskComment(deskGuestUser($t), $t, $body, true, 'web'))]);
    }
    fail(404, 'not_found', 'Unknown action.');
}
/** v35: a request to reset two-step sign-in, made at sign-in after the password and an emailed code (auth.php). */
function deskMfaRequest(array $u, string $note, string $where): array
{
    $st = ddb()->prepare("SELECT * FROM desk_tickets WHERE by_uid = ? AND item = 'mfa_reset' AND st IN ('approval', 'new', 'assigned', 'progress', 'hold') ORDER BY created DESC LIMIT 1");
    $st->execute([(string) $u['id']]);
    $open = $st->fetch();
    $st->closeCursor();
    if ($open) {
        if ($note !== '') {
            deskComment($u, $open, $note, true, 'signin');
        }
        return $open;
    }
    $row = docGet('u/' . $u['id']);
    $phone = trim((string) ($row->p->ph ?? ''));
    $t = deskCreate($u, ['kind' => 'incident', 'title' => 'Two-step sign-in reset: ' . $u['name'], 'body' => ($note !== '' ? $note . "\n\n" : '') . 'Asked at sign-in: they cannot use any of their two-step sign-in methods.', 'cat' => 'signin', 'impact' => 3, 'urgency' => 1, 'src' => 'signin']);
    $vars = [
        ['l' => 'Account', 'v' => $u['email']],
        ['l' => 'Checked when asked', 'v' => 'The password, and a code emailed to the account address (' . gmdate('j M Y H:i', (int) (now() / 1000)) . ' UTC, ' . $where . ')'],
        ['l' => 'Phone in their profile', 'v' => $phone !== '' ? $phone : 'none on file'],
    ];
    deskSet($t['id'], ['item' => 'mfa_reset', 'vars' => json_encode($vars, JSON_UNESCAPED_UNICODE)]);
    deskNote($t['id'], ['id' => '', 'name' => 'StratEdge'], 'work', false, 'Before resetting: call them back on a number you already have (their profile, HR records or a manager), not one given in this ticket, or see them on a video call, and ask something only they would know. Then use "Reset two-step sign-in" here (administrators).');
    return (array) deskGet($t['id']);
}

/* ---------- the scheduled task: SLA breaches and closing resolved tickets ---------- */

function deskCron(bool $force = false): array
{
    $pdo = ddb();
    $last = (int) $pdo->query("SELECT v FROM meta WHERE k = 'desk_cron'")->fetchColumn();
    if (!$force && $last > now() - 240000) {
        return ['ran' => false];
    }
    $pdo->prepare("UPDATE meta SET v = ? WHERE k = 'desk_cron'")->execute([now()]);
    $s = deskSettings();
    $now = now();
    $marked = 0;
    $st = $pdo->prepare("SELECT * FROM desk_tickets WHERE st IN ('new', 'assigned', 'progress', 'hold') AND kind <> 'feedback' AND ((first_resp = 0 AND due_resp < ?) OR (st <> 'hold' AND due_res < ?))");
    $st->execute([$now, $now]);
    foreach ($st->fetchAll() as $t) {
        $bits = (int) $t['breach'];
        $note = (int) $t['notified'];
        $what = [];
        if ((int) $t['first_resp'] === 0 && $now > (int) $t['due_resp'] && !($bits & 1)) {
            $bits |= 1;
            $what[] = 'no first answer within ' . deskMins($s['sla'][(int) $t['pri']][0]);
        }
        if ($t['st'] !== 'hold' && $now > (int) $t['due_res'] && !($bits & 2)) {
            $bits |= 2;
            $what[] = 'not resolved within ' . deskMins($s['sla'][(int) $t['pri']][1]);
        }
        if ($bits !== (int) $t['breach']) {
            $marked++;
            $pdo->prepare('UPDATE desk_tickets SET breach = ?, notified = ? WHERE id = ?')->execute([$bits, $note | $bits, $t['id']]);
            if ($s['notify']['breach'] && $what) {
                // the assignee (or the whole group), and for P1 and P2 the administrators too: one email each
                $to = (string) $t['asg'] !== '' ? [(string) $t['asg']] : (deskGroups()[$t['grp']]['members'] ?? []);
                if ((int) $t['pri'] <= 2 || !$to) {
                    $to = array_merge($to, array_map('strval', $pdo->query("SELECT id FROM users WHERE role = 'admin' AND status = 'active'")->fetchAll(PDO::FETCH_COLUMN)));
                }
                foreach (array_slice(array_values(array_unique($to)), 0, 30) as $uid) {
                    $row = userRow($uid);
                    if ($row && ($row['status'] ?? '') === 'active') {
                        deskMail($t, $uid, (string) $row['email'], (string) $row['name'], 'SLA missed: SD-' . $t['num'] . ' (' . DESK_PRI[(int) $t['pri']] . ')', [$t['title'], ucfirst(implode(' and ', $what)) . '.'], true);
                    }
                }
            }
        }
    }
    $close = $pdo->prepare("UPDATE desk_tickets SET st = 'closed', closed_at = ?, updated = ? WHERE st = 'resolved' AND resolved_at < ?");
    $close->execute([$now, $now, $now - $s['autoClose'] * 86400000]);
    return ['ran' => true, 'breached' => $marked, 'closed' => $close->rowCount()];
}

/* ---------- routes ---------- */

function deskTicketFor(array $u, string $ref, bool $work = false): array
{
    $t = deskGet($ref);
    if (!$t || !deskCanSee($u, $t) || ($work && !deskCanWork($u, $t))) {
        fail(404, 'not_found', 'No ticket with that number is open to you.');
    }
    return $t;
}
function deskFull(array $u, array $t): array
{
    $work = deskCanWork($u, $t);
    $out = ['ticket' => deskOut($t, $u), 'notes' => deskNotes($t['id'], $work)];
    if ($work) {
        $groups = deskGroups();
        $names = [];
        foreach ($groups as $g) {
            foreach ($g['members'] as $uid) {
                if (!isset($names[$uid]) && ($row = userRow($uid))) {
                    $names[$uid] = (string) $row['name'];
                }
            }
        }
        $out['groups'] = array_values(array_map(fn($g) => ['id' => $g['id'], 'n' => $g['n'], 'members' => array_values(array_filter(array_map(fn($uid) => isset($names[$uid]) ? ['id' => $uid, 'n' => $names[$uid]] : null, $g['members'])))], $groups));
        // the areas a ticket can be moved to (the "Priority & area" panel)
        $out['cats'] = array_map(fn($c) => $c[0], DESK_CATS);
        // the requester's other tickets, for context. v83: only the ones this person may open, and a website ticket (no
        // account: by_uid '') matches the same address, not every other guest's ticket
        $rows = [];
        if ((string) $t['by_uid'] !== '') {
            $st = ddb()->prepare("SELECT * FROM desk_tickets WHERE by_uid = ? AND id <> ? ORDER BY created DESC LIMIT 40");
            $st->execute([(string) $t['by_uid'], $t['id']]);
            $rows = $st->fetchAll();
        } elseif ((string) $t['by_email'] !== '') {
            $st = ddb()->prepare("SELECT * FROM desk_tickets WHERE by_uid = '' AND LOWER(by_email) = ? AND id <> ? ORDER BY created DESC LIMIT 40");
            $st->execute([strtolower((string) $t['by_email']), $t['id']]);
            $rows = $st->fetchAll();
        }
        $rows = array_slice(array_values(array_filter($rows, fn($r) => deskCanSee($u, $r))), 0, 5);
        $out['others'] = array_map(fn($r) => ['num' => 'SD-' . $r['num'], 'title' => $r['title'], 'st' => DESK_ST[$r['st']] ?? $r['st']], $rows);
    }
    return $out;
}
function deskRoute(string $r, array $b): never
{
    $u = requireUser();
    ddb();
    switch ($r) {
        case 'desk_home':
            $st = ddb()->prepare('SELECT * FROM desk_tickets WHERE by_uid = ? ORDER BY (CASE WHEN st IN (\'' . implode("','", DESK_OPEN) . '\', \'resolved\') THEN 0 ELSE 1 END), updated DESC LIMIT 40');
            $st->execute([(string) $u['id']]);
            $s = deskSettings();
            ok([
                'mine' => array_map(fn($t) => deskOut($t, $u), $st->fetchAll()),
                'catalog' => deskCatalog(),
                'cats' => array_map(fn($c) => $c[0], DESK_CATS),
                'impact' => DESK_IMPACT,
                'urgency' => DESK_URGENCY,
                'pri' => DESK_PRI,
                'sla' => array_map(fn($x) => [deskMins($x[0]), deskMins($x[1])], $s['sla']),
                'agent' => deskIsAgent($u),
                'admin' => deskIsAdmin($u),
                'bot' => $s['bot'],
                'ai' => function_exists('aiReady') && aiReady('copilot'),
                'popular' => deskPopular($u),
            ]);

        case 'desk_create':
            $t = deskCreate($u, $b);
            ok(['ticket' => deskOut($t, $u)]);

        case 'desk_ticket':
            ok(deskFull($u, deskTicketFor($u, (string) ($b['id'] ?? ''))));

        case 'desk_comment':
            $t = deskTicketFor($u, (string) ($b['id'] ?? ''));
            $pub = !array_key_exists('pub', $b) || !empty($b['pub']);
            if (!$pub && !deskCanWork($u, $t)) {
                $pub = true;
            }
            if (in_array($t['st'], ['closed', 'cancelled'], true)) {
                fail(400, 'invalid_argument', 'This ticket is closed. Raise a new one and mention SD-' . $t['num'] . '.');
            }
            $t = deskComment($u, $t, mb_substr((string) ($b['body'] ?? ''), 0, 20000), $pub);
            ok(deskFull($u, $t));

        case 'desk_mine_act':
            // the requester: confirm it is fixed (close), reopen it, or cancel it
            $t = deskTicketFor($u, (string) ($b['id'] ?? ''));
            if ((string) $t['by_uid'] !== (string) $u['id']) {
                fail(403, 'forbidden', 'Only the person who raised it can do that.');
            }
            $act = (string) ($b['act'] ?? '');
            if ($act === 'reopen' && $t['st'] !== 'resolved') {
                fail(400, 'invalid_argument', $t['st'] === 'closed' ? 'This ticket is closed. Raise a new one and mention SD-' . $t['num'] . '.' : 'Only a resolved ticket can be reopened.');
            }
            if ($act === 'close' && $t['st'] !== 'resolved') {
                fail(400, 'invalid_argument', 'Only a resolved ticket can be confirmed.');
            }
            if ($act === 'cancel' && !in_array($t['st'], DESK_OPEN, true)) {
                fail(400, 'invalid_argument', 'This ticket is no longer open.');
            }
            if (!in_array($act, ['reopen', 'close', 'cancel'], true)) {
                fail(400, 'invalid_argument', 'Unknown action.');
            }
            $t = deskAct($u, $t, $act, ['note' => mb_substr(trim((string) ($b['note'] ?? '')), 0, 2000)]);
            if ($act === 'reopen') {
                deskTellAgents($t, 'Reopened by ' . $u['name'] . ': SD-' . $t['num'], [(string) ($b['note'] ?? '') ?: $t['title']], (string) $u['id']);
            }
            ok(deskFull($u, $t));

        case 'desk_mfa_reset':
            // v35: an administrator resets someone's two-step sign-in from their reset request, after confirming it is them
            $t = deskTicketFor($u, (string) ($b['id'] ?? ''), true);
            if ($t['item'] !== 'mfa_reset' || (string) $t['by_uid'] === '') {
                fail(400, 'invalid_argument', 'This is not a two-step sign-in reset request.');
            }
            if (!hasRole($u, 'admin')) {
                fail(403, 'forbidden', 'Only an administrator can reset two-step sign-in. Assign the ticket to one.');
            }
            if (!in_array($t['st'], DESK_OPEN, true)) {
                fail(400, 'invalid_argument', 'This request is no longer open.');
            }
            $how = mb_substr(trim((string) ($b['how'] ?? '')), 0, 500);
            if (mb_strlen($how) < 10) {
                fail(400, 'invalid_argument', 'Say how you confirmed it is really them (for example: called back on the number in their HR record).');
            }
            requireRecentAuth();
            $target = userRow((string) $t['by_uid']);
            if (!$target) {
                fail(404, 'not_found', 'That account is not there any more.');
            }
            require_once __DIR__ . '/auth.php';
            authMfaResetFor($u, $target, 'SD-' . $t['num'] . ': ' . $how);
            deskNote($t['id'], $u, 'work', false, 'Identity confirmed: ' . $how);
            $t = deskAct($u, (array) deskGet($t['id']), 'resolve', ['code' => 'solved', 'note' => 'Your two-step sign-in was reset. Sign in with your password and set it up again on your new phone, and save the new backup codes.']);
            ok(deskFull($u, $t));

        case 'desk_rate':
            $t = deskTicketFor($u, (string) ($b['id'] ?? ''));
            if ((string) $t['by_uid'] !== (string) $u['id'] || !in_array($t['st'], ['resolved', 'closed'], true)) {
                fail(400, 'invalid_argument', 'You can rate a ticket once it is resolved.');
            }
            deskSet($t['id'], ['csat' => max(1, min(5, (int) ($b['csat'] ?? 0))), 'csat_note' => mb_substr(trim((string) ($b['note'] ?? '')), 0, 500)]);
            ok(deskFull($u, (array) deskGet($t['id'])));

        case 'desk_kb':
            $q = trim((string) ($b['q'] ?? ''));
            if (!empty($b['all'])) {
                // the knowledge editor: every article with its text, drafts included (people who work tickets)
                if (!deskIsAgent($u)) {
                    fail(403, 'forbidden', 'Articles are written by the service desk.');
                }
                $list = array_values(deskArticles($u, true));
                usort($list, fn($x, $y) => [$x['cat'], $x['t']] <=> [$y['cat'], $y['t']]);
                ok(['articles' => array_map(fn($a) => $a + ['catName' => DESK_CATS[$a['cat']][0] ?? ''], $list), 'cats' => array_map(fn($c) => $c[0], DESK_CATS), 'admin' => deskIsAdmin($u)]);
            }
            $list = $q !== '' ? deskKbSearch($u, $q, 20) : array_values(deskArticles($u));
            if ($q === '') {
                usort($list, fn($x, $y) => [$x['cat'], $x['t']] <=> [$y['cat'], $y['t']]);
            }
            ok(['articles' => array_map(fn($a) => ['id' => $a['id'], 't' => $a['t'], 'cat' => $a['cat'], 'catName' => DESK_CATS[$a['cat']][0] ?? '', 'snip' => mb_substr((string) preg_replace('/\s+/', ' ', $a['body']), 0, 200), 'aud' => $a['aud']], $list)]);

        case 'desk_kb_get':
            $all = deskArticles($u, deskIsAgent($u));
            $a = $all[(string) ($b['id'] ?? '')] ?? null;
            if (!$a) {
                fail(404, 'not_found', 'That article is not available.');
            }
            if (empty($b['edit'])) {
                $d = docGet('desk/x/kb/' . $a['id']);
                if ($d) {
                    $d->views = (int) ($d->views ?? 0) + 1;
                    docSet('desk/x/kb/' . $a['id'], $d);
                }
            }
            ok(['article' => $a + ['catName' => DESK_CATS[$a['cat']][0] ?? '']]);

        case 'desk_kb_vote':
            // v83: only an article this person may open (as desk_kb_get), written back under its own stored id (a raw id
            // with extra characters made a copy of the article), and one vote per person and article a day
            $a = deskArticles($u, deskIsAgent($u))[(string) ($b['id'] ?? '')] ?? null;
            if (!$a) {
                fail(404, 'not_found', 'That article is not available.');
            }
            if (!throttleHit('deskkbvote:' . $u['id'] . ':' . $a['id'], 1, 86400)) {
                $d = docGet('desk/x/kb/' . $a['id']);
                if ($d) {
                    $k = !empty($b['up']) ? 'up' : 'down';
                    $d->$k = (int) ($d->$k ?? 0) + 1;
                    docSet('desk/x/kb/' . $a['id'], $d);
                }
            }
            ok(['ok' => true]);

        case 'desk_bot':
            $q = trim((string) ($b['q'] ?? ''));
            if ($q === '') {
                fail(400, 'invalid_argument', 'Type your question.');
            }
            if (throttleHit('deskbot:' . $u['id'], 40, 3600)) {
                fail(429, 'rate_limited', 'That is a lot of questions in an hour. Raise a ticket and a person will help.');
            }
            ok(deskBot($u, mb_substr($q, 0, 2000)));

        /* ---- the people who work tickets ---- */
        case 'desk_queue':
            if (!deskIsAgent($u)) {
                fail(403, 'forbidden', 'The service desk is for the people in an assignment group.');
            }
            ok(deskQueue($u, $b) + ['groups' => array_values(array_map(fn($g) => ['id' => $g['id'], 'n' => $g['n']], deskGroups()))]);

        case 'desk_dash':
            if (!deskIsAgent($u)) {
                fail(403, 'forbidden', 'The service desk is for the people in an assignment group.');
            }
            deskCron(false);
            ok(deskDash($u) + ['admin' => deskIsAdmin($u), 'myGroups' => array_values(array_map(fn($id) => deskGroups()[$id]['n'], deskMyGroups($u)))]);

        case 'desk_act':
            $t = deskTicketFor($u, (string) ($b['id'] ?? ''), true);
            $t = deskAct($u, $t, (string) ($b['act'] ?? ''), $b);
            ok(deskFull($u, $t));

        case 'desk_approve':
            $t = deskTicketFor($u, (string) ($b['id'] ?? ''));
            $t = deskApprove($u, $t, !empty($b['yes']), mb_substr(trim((string) ($b['note'] ?? '')), 0, 1000));
            ok(deskFull($u, $t));

        case 'desk_kb_save':
            if (!deskIsAgent($u)) {
                fail(403, 'forbidden', 'Articles are written by the service desk.');
            }
            $id = preg_match('/^[a-z0-9_-]{1,40}$/', (string) ($b['id'] ?? '')) ? (string) $b['id'] : rid(6);
            $t = mb_substr(trim((string) ($b['t'] ?? '')), 0, 200);
            $body = mb_substr(trim((string) ($b['body'] ?? '')), 0, 30000);
            if ($t === '' || $body === '') {
                fail(400, 'invalid_argument', 'An article needs a title and its text.');
            }
            $old = deskObj(docGet("desk/x/kb/$id"));
            docSet("desk/x/kb/$id", json_decode((string) json_encode(['t' => $t, 'body' => $body, 'cat' => isset(DESK_CATS[$b['cat'] ?? '']) ? $b['cat'] : 'other', 'tags' => mb_substr(trim((string) ($b['tags'] ?? '')), 0, 400), 'aud' => ($b['aud'] ?? '') === 'staff' ? 'staff' : 'all', 'pub' => !empty($b['pub']), 'web' => !empty($b['web']) && ($b['aud'] ?? '') !== 'staff', 'views' => (int) ($old['views'] ?? 0), 'up' => (int) ($old['up'] ?? 0), 'down' => (int) ($old['down'] ?? 0), 'u' => now(), 'by' => (string) $u['id']])));
            ok(['id' => $id]);

        /* ---- administrators: groups, the catalog, settings ---- */
        case 'desk_admin':
            if (!deskIsAdmin($u)) {
                fail(403, 'forbidden', 'Administrators set up the service desk.');
            }
            $people = [];
            foreach (db()->query("SELECT id, name, email, role, status, access FROM users WHERE status = 'active' ORDER BY name")->fetchAll() as $row) {
                $people[] = ['id' => $row['id'], 'n' => $row['name'], 'e' => $row['email'], 'roles' => rolesOf($row)];
            }
            ok(['groups' => array_values(deskGroups()), 'catalog' => deskCatalog(true), 'articles' => array_values(deskArticles($u, true)), 'settings' => deskSettings(), 'people' => $people, 'cats' => array_map(fn($c) => ['n' => $c[0], 'grp' => $c[1]], DESK_CATS)]);

        case 'desk_group_save':
            if (!deskIsAdmin($u)) {
                fail(403, 'forbidden', 'Administrators set up the service desk.');
            }
            $id = preg_match('/^[a-z0-9_-]{1,40}$/', (string) ($b['id'] ?? '')) ? (string) $b['id'] : rid(4);
            $n = mb_substr(trim((string) ($b['n'] ?? '')), 0, 80);
            if ($n === '') {
                fail(400, 'invalid_argument', 'Name the group.');
            }
            docSet("desk/x/groups/$id", json_decode((string) json_encode(['n' => $n, 'd' => mb_substr(trim((string) ($b['d'] ?? '')), 0, 300), 'roles' => array_values(array_intersect(['admin', 'hr', 'acct', 'manager'], (array) ($b['roles'] ?? []))), 'members' => array_values(array_filter((array) ($b['members'] ?? []), fn($x) => is_string($x) && preg_match('/^u_[a-f0-9]{8,32}$/', $x))), 'u' => now()])));
            ok(['groups' => array_values(deskGroupsFresh())]);

        case 'desk_item_save':
            if (!deskIsAdmin($u)) {
                fail(403, 'forbidden', 'Administrators set up the service desk.');
            }
            $id = preg_match('/^[a-z0-9_-]{1,40}$/', (string) ($b['id'] ?? '')) ? (string) $b['id'] : rid(4);
            $t = mb_substr(trim((string) ($b['t'] ?? '')), 0, 120);
            if ($t === '') {
                fail(400, 'invalid_argument', 'Name the request.');
            }
            $fields = [];
            foreach (array_slice((array) ($b['fields'] ?? []), 0, 12) as $i => $f) {
                $l = mb_substr(trim((string) ($f['l'] ?? '')), 0, 120);
                if ($l === '') {
                    continue;
                }
                $type = in_array($f['type'] ?? '', ['text', 'textarea', 'select', 'date'], true) ? $f['type'] : 'text';
                $fields[] = ['k' => preg_match('/^[a-z0-9_]{1,30}$/', (string) ($f['k'] ?? '')) ? $f['k'] : 'f' . $i, 'l' => $l, 'type' => $type, 'opts' => $type === 'select' ? array_values(array_filter(array_map(fn($o) => mb_substr(trim((string) $o), 0, 80), (array) ($f['opts'] ?? [])))) : [], 'req' => !empty($f['req'])];
            }
            docSet("desk/x/catalog/$id", json_decode((string) json_encode(['t' => $t, 'd' => mb_substr(trim((string) ($b['d'] ?? '')), 0, 600), 'cat' => isset(DESK_CATS[$b['cat'] ?? '']) ? $b['cat'] : 'other', 'grp' => isset(deskGroups()[$b['grp'] ?? '']) ? $b['grp'] : 'gen', 'icon' => preg_match('/^[a-z]{2,12}$/', (string) ($b['icon'] ?? '')) ? $b['icon'] : 'tasks', 'appr' => in_array($b['appr'] ?? '', ['none', 'admin', 'grp'], true) ? $b['appr'] : 'none', 'fields' => $fields, 'pub' => !empty($b['pub']), 'ord' => (int) ($b['ord'] ?? 50), 'u' => now()])));
            ok(['catalog' => deskCatalog(true)]);

        case 'desk_delete':
            if (!deskIsAdmin($u)) {
                fail(403, 'forbidden', 'Administrators set up the service desk.');
            }
            $what = (string) ($b['what'] ?? '');
            $id = preg_replace('/[^A-Za-z0-9_-]/', '', (string) ($b['id'] ?? ''));
            if (!in_array($what, ['groups', 'catalog', 'kb'], true) || $id === '') {
                fail(400, 'invalid_argument', 'Nothing to delete.');
            }
            if ($what === 'groups') {
                $st = ddb()->prepare("SELECT COUNT(*) FROM desk_tickets WHERE grp = ? AND st IN ('" . implode("','", DESK_OPEN) . "')");
                $st->execute([$id]);
                if ((int) $st->fetchColumn() > 0) {
                    fail(400, 'invalid_argument', 'This group still has open tickets. Move them to another group first.');
                }
            }
            docDelete("desk/x/$what/$id");
            ok(['ok' => true]);

        case 'desk_settings_save':
            if (!deskIsAdmin($u)) {
                fail(403, 'forbidden', 'Administrators set up the service desk.');
            }
            $sla = [];
            foreach (DESK_SLA_DEFAULT as $p => $def) {
                $x = (array) ($b['sla'][$p] ?? $b['sla'][(string) $p] ?? $def);
                $sla[$p] = [max(5, min(43200, (int) ($x[0] ?? $def[0]))), max(15, min(129600, (int) ($x[1] ?? $def[1])))];
                if ($sla[$p][1] < $sla[$p][0]) {
                    fail(400, 'invalid_argument', DESK_PRI[$p] . ': resolving can\'t take less time than the first answer.');
                }
            }
            $email = strtolower(trim((string) ($b['email'] ?? '')));
            if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                fail(400, 'invalid_argument', 'The support address is not a valid email.');
            }
            docSet('desk/x/settings', json_decode((string) json_encode(['sla' => $sla, 'autoClose' => max(1, min(30, (int) ($b['autoClose'] ?? 5))), 'email' => $email, 'notify' => array_map(fn($v) => !empty($v), array_intersect_key((array) ($b['notify'] ?? []), array_flip(['create', 'assign', 'update', 'breach']))), 'bot' => !empty($b['bot']), 'web' => !empty($b['web']), 'u' => now()])));
            if (function_exists('audit')) {
                audit('settings', 'Service desk settings changed', 'desk', ['autoClose' => (int) ($b['autoClose'] ?? 5)], $u);
            }
            ok(['settings' => deskSettings()]);
    }
    fail(404, 'not_found', 'Unknown action.');
}
/** Groups read again after a change (the per-request cache would still hold the old ones). */
function deskGroupsFresh(): array
{
    $out = [];
    foreach (colAll('desk/x/groups') as [$id, $d]) {
        $x = deskObj($d);
        $out[] = ['id' => (string) $id, 'n' => (string) ($x['n'] ?? $id), 'd' => (string) ($x['d'] ?? ''), 'roles' => array_values((array) ($x['roles'] ?? [])), 'named' => array_values((array) ($x['members'] ?? []))];
    }
    return $out;
}
