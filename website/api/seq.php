<?php
declare(strict_types=1);
/*
 * v46 Sequences: follow-up emails and call/LinkedIn tasks that go out by themselves, one person at a time, from the
 * sender's own mailbox (My email: Gmail or Microsoft 365), until the person replies. Recruiters and sales people
 * (whoever has the CRM: HR, recruiting team, the CRM feature, administrators) build a sequence of steps (an email or a
 * task, each a number of days after the one before), add CRM leads and contacts (or pasted addresses, or a CSV file)
 * to it, and the scheduled job sends each step when it is due: inside the sending hours of the person's own time zone
 * (or the company's), on weekdays, not on US federal holidays, under a daily cap per sender.
 * A person leaves the sequence when they reply (the sender's inbox is read; the reply is sorted: interested, not now,
 * not interested, wrong person, asked to stop; an out-of-office answer keeps them in and waits until they are back),
 * unsubscribe (the link and the one-click header every sequence email carries, with the company's postal address, as
 * CAN-SPAM asks), bounce, or when their lead is converted or marked unqualified. Unsubscribes go to the mail
 * suppression list every mailing respects.
 * An email step can test a second subject or message (A/B): people get version A or B in turn, the numbers show which
 * one gets more replies, and the better one can then go to everyone. Templates (the team's and some to start from)
 * fill a step. New website leads (the Request talent and Contact forms) can join a sequence by themselves.
 * Tables (main database): sq_seq sequences, sq_enr people in a sequence, sq_ev what happened, sq_task tasks,
 * sq_tpl email templates.
 */

const SQ_ENR_ST = ['active' => 'Active', 'task' => 'Waiting for a task', 'paused' => 'Paused', 'replied' => 'Replied', 'finished' => 'Finished', 'stopped' => 'Stopped', 'bounced' => 'Bounced', 'unsub' => 'Unsubscribed', 'error' => 'Needs attention'];
const SQ_LIVE = ['active', 'task', 'paused', 'error'];
const SQ_FIELDS = ['first_name', 'last_name', 'name', 'company', 'my_name', 'my_email', 'signature']; // v69: signature
const SQ_CFG = [
    'weekdays' => true, 'from' => 8, 'to' => 18, 'cap' => 60, 'stopLead' => true,
    // v46: whose clock the sending hours follow, US federal holidays, what a sorted reply does, website leads
    'tzMode' => 'person', 'hol' => true, 'holOff' => [], 'ooo' => 3, 'oooKeep' => true, 'later' => 90, 'replyTask' => true,
    'auto' => ['on' => false, 'forms' => ['talent', 'contact'], 'who' => 'owner'],
];
/** v83: why a person waits while the sender's account is paused or no longer has Sequences. */
const SQ_SENDER_OFF = 'The sender\'s account is paused or no longer has Sequences.';
/** How a reply was sorted. */
const SQ_CLS = ['interested' => 'Interested', 'later' => 'Not now', 'no' => 'Not interested', 'wrong' => 'Wrong person', 'unsub' => 'Asked to stop', 'ooo' => 'Out of office', 'other' => 'Other reply'];
/** Time zones offered on the pages (any IANA name is accepted from a file). */
const SQ_TZS = [
    ['America/New_York', 'Eastern (New York)'], ['America/Chicago', 'Central (Chicago)'], ['America/Denver', 'Mountain (Denver)'], ['America/Phoenix', 'Arizona (Phoenix)'],
    ['America/Los_Angeles', 'Pacific (Los Angeles)'], ['America/Anchorage', 'Alaska'], ['Pacific/Honolulu', 'Hawaii'], ['America/Puerto_Rico', 'Puerto Rico'],
    ['America/Toronto', 'Toronto'], ['Europe/London', 'London'], ['Europe/Berlin', 'Central Europe'], ['Asia/Dubai', 'Dubai'], ['Asia/Kolkata', 'India'],
    ['Asia/Singapore', 'Singapore'], ['Australia/Sydney', 'Sydney'],
];
/** US federal holidays (5 U.S.C. 6103) and the day after Thanksgiving, by key. */
const SQ_HOL = [
    'newyear' => "New Year's Day", 'mlk' => 'Martin Luther King Jr. Day', 'presidents' => "Washington's Birthday", 'memorial' => 'Memorial Day', 'juneteenth' => 'Juneteenth',
    'independence' => 'Independence Day', 'labor' => 'Labor Day', 'columbus' => 'Columbus Day', 'veterans' => 'Veterans Day', 'thanksgiving' => 'Thanksgiving Day',
    'thanksgiving2' => 'Day after Thanksgiving', 'christmas' => 'Christmas Day',
];
const SQ_STATE_TZ = [
    'AL' => 'America/Chicago', 'AK' => 'America/Anchorage', 'AZ' => 'America/Phoenix', 'AR' => 'America/Chicago', 'CA' => 'America/Los_Angeles', 'CO' => 'America/Denver',
    'CT' => 'America/New_York', 'DE' => 'America/New_York', 'DC' => 'America/New_York', 'FL' => 'America/New_York', 'GA' => 'America/New_York', 'HI' => 'Pacific/Honolulu',
    'ID' => 'America/Boise', 'IL' => 'America/Chicago', 'IN' => 'America/Indiana/Indianapolis', 'IA' => 'America/Chicago', 'KS' => 'America/Chicago', 'KY' => 'America/New_York',
    'LA' => 'America/Chicago', 'ME' => 'America/New_York', 'MD' => 'America/New_York', 'MA' => 'America/New_York', 'MI' => 'America/Detroit', 'MN' => 'America/Chicago',
    'MS' => 'America/Chicago', 'MO' => 'America/Chicago', 'MT' => 'America/Denver', 'NE' => 'America/Chicago', 'NV' => 'America/Los_Angeles', 'NH' => 'America/New_York',
    'NJ' => 'America/New_York', 'NM' => 'America/Denver', 'NY' => 'America/New_York', 'NC' => 'America/New_York', 'ND' => 'America/Chicago', 'OH' => 'America/New_York',
    'OK' => 'America/Chicago', 'OR' => 'America/Los_Angeles', 'PA' => 'America/New_York', 'RI' => 'America/New_York', 'SC' => 'America/New_York', 'SD' => 'America/Chicago',
    'TN' => 'America/Chicago', 'TX' => 'America/Chicago', 'UT' => 'America/Denver', 'VT' => 'America/New_York', 'VA' => 'America/New_York', 'WA' => 'America/Los_Angeles',
    'WV' => 'America/New_York', 'WI' => 'America/Chicago', 'WY' => 'America/Denver', 'PR' => 'America/Puerto_Rico',
];
const SQ_STATE_NAMES = [
    'district of columbia' => 'DC', 'west virginia' => 'WV', 'north carolina' => 'NC', 'south carolina' => 'SC', 'north dakota' => 'ND', 'south dakota' => 'SD',
    'new hampshire' => 'NH', 'new jersey' => 'NJ', 'new mexico' => 'NM', 'new york' => 'NY', 'rhode island' => 'RI', 'puerto rico' => 'PR', 'alabama' => 'AL', 'alaska' => 'AK',
    'arizona' => 'AZ', 'arkansas' => 'AR', 'california' => 'CA', 'colorado' => 'CO', 'connecticut' => 'CT', 'delaware' => 'DE', 'florida' => 'FL', 'georgia' => 'GA',
    'hawaii' => 'HI', 'idaho' => 'ID', 'illinois' => 'IL', 'indiana' => 'IN', 'iowa' => 'IA', 'kansas' => 'KS', 'kentucky' => 'KY', 'louisiana' => 'LA', 'maine' => 'ME',
    'maryland' => 'MD', 'massachusetts' => 'MA', 'michigan' => 'MI', 'minnesota' => 'MN', 'mississippi' => 'MS', 'missouri' => 'MO', 'montana' => 'MT', 'nebraska' => 'NE',
    'nevada' => 'NV', 'ohio' => 'OH', 'oklahoma' => 'OK', 'oregon' => 'OR', 'pennsylvania' => 'PA', 'tennessee' => 'TN', 'texas' => 'TX', 'utah' => 'UT', 'vermont' => 'VT',
    'virginia' => 'VA', 'washington' => 'WA', 'wisconsin' => 'WI', 'wyoming' => 'WY',
];
/** Templates to start from (the team copies and changes them). */
const SQ_STARTERS = [
    ['id' => 'start-bench', 'n' => 'Bench intro to a hiring manager', 'cat' => 'Recruiting', 'subj' => 'Available consultants for {company}', 'body' => "Hi {first_name},\n\nWe have experienced consultants who can start within one to two weeks, and I thought of {company}.\n\nIf you have open roles, reply with the skills you need and I will send matching profiles with rates the same day.\n\nBest,\n{my_name}"],
    ['id' => 'start-hotlist', 'n' => "This week's hot list", 'cat' => 'Recruiting', 'subj' => "This week's available consultants", 'body' => "Hi {first_name},\n\nHere is who is available this week:\n\n- Role, years of experience, location, availability\n- Role, years of experience, location, availability\n\nReply with the ones you would like to see and I will send resumes and rates.\n\n{my_name}"],
    ['id' => 'start-vendor', 'n' => 'Vendor partnership intro', 'cat' => 'Vendors', 'subj' => 'Supporting {company} on open requirements', 'body' => "Hi {first_name},\n\nWe work with implementation partners and prime vendors on contract roles, and we would like to support {company}'s open requirements.\n\nCould you add us to your vendor list, or share the roles that are hardest to fill?\n\nThanks,\n{my_name}"],
    ['id' => 'start-bump', 'n' => 'Follow-up in the same thread', 'cat' => 'Follow-up', 'subj' => '', 'body' => "Hi {first_name},\n\nBringing this back to the top of your inbox. Is there a role at {company} we could help with this month?\n\n{my_name}"],
    ['id' => 'start-last', 'n' => 'Last note', 'cat' => 'Follow-up', 'subj' => 'Should I close your file?', 'body' => "Hi {first_name},\n\nI have not heard back, so I will stop following up for now. If {company} needs contract or full-time help later, just reply to this email.\n\nAll the best,\n{my_name}"],
];

function sqDb(): PDO
{
    static $ready = false;
    $p = db();
    if (!$ready) {
        $ready = true;
        $p->exec("CREATE TABLE IF NOT EXISTS sq_seq (id VARCHAR(20) PRIMARY KEY, n VARCHAR(120) NOT NULL, owner VARCHAR(40) NOT NULL, shared INT NOT NULL DEFAULT 0, st VARCHAR(10) NOT NULL DEFAULT 'active', steps TEXT NOT NULL, cfg TEXT NOT NULL, at BIGINT NOT NULL, u BIGINT NOT NULL)");
        $p->exec("CREATE TABLE IF NOT EXISTS sq_enr (id VARCHAR(20) PRIMARY KEY, seq VARCHAR(20) NOT NULL, sender VARCHAR(40) NOT NULL, email VARCHAR(190) NOT NULL, n VARCHAR(190) NOT NULL DEFAULT '', co VARCHAR(190) NOT NULL DEFAULT '', ref VARCHAR(80) NOT NULL DEFAULT '', step INT NOT NULL DEFAULT 0, next_at BIGINT NOT NULL DEFAULT 0, st VARCHAR(10) NOT NULL, why VARCHAR(300) NOT NULL DEFAULT '', last_at BIGINT NOT NULL DEFAULT 0, sent INT NOT NULL DEFAULT 0, msgid VARCHAR(300) NOT NULL DEFAULT '', subj VARCHAR(300) NOT NULL DEFAULT '', mid VARCHAR(24) NOT NULL DEFAULT '', tok VARCHAR(40) NOT NULL, at BIGINT NOT NULL, by_uid VARCHAR(40) NOT NULL, ab VARCHAR(1) NOT NULL DEFAULT '', tz VARCHAR(40) NOT NULL DEFAULT '', src VARCHAR(12) NOT NULL DEFAULT '', cls VARCHAR(12) NOT NULL DEFAULT '', rep_at BIGINT NOT NULL DEFAULT 0, rep_txt VARCHAR(400) NOT NULL DEFAULT '')");
        $p->exec('CREATE INDEX IF NOT EXISTS sq_enr_due ON sq_enr (st, next_at)');
        $p->exec('CREATE INDEX IF NOT EXISTS sq_enr_seq ON sq_enr (seq)');
        $p->exec('CREATE INDEX IF NOT EXISTS sq_enr_email ON sq_enr (email)');
        $p->exec('CREATE INDEX IF NOT EXISTS sq_enr_tok ON sq_enr (tok)');
        $p->exec("CREATE TABLE IF NOT EXISTS sq_ev (id VARCHAR(20) PRIMARY KEY, seq VARCHAR(20) NOT NULL, enr VARCHAR(20) NOT NULL, sender VARCHAR(40) NOT NULL, at BIGINT NOT NULL, kind VARCHAR(10) NOT NULL, step INT NOT NULL DEFAULT 0, info VARCHAR(500) NOT NULL DEFAULT '', ab VARCHAR(1) NOT NULL DEFAULT '')");
        $p->exec('CREATE INDEX IF NOT EXISTS sq_ev_seq ON sq_ev (seq, kind)');
        $p->exec('CREATE INDEX IF NOT EXISTS sq_ev_sender ON sq_ev (sender, kind, at)');
        $p->exec('CREATE INDEX IF NOT EXISTS sq_ev_enr ON sq_ev (enr, kind)');
        $p->exec("CREATE TABLE IF NOT EXISTS sq_task (id VARCHAR(20) PRIMARY KEY, seq VARCHAR(20) NOT NULL, enr VARCHAR(20) NOT NULL, uid VARCHAR(40) NOT NULL, step INT NOT NULL, t VARCHAR(600) NOT NULL, due BIGINT NOT NULL, st VARCHAR(8) NOT NULL, done_at BIGINT NOT NULL DEFAULT 0)");
        $p->exec('CREATE INDEX IF NOT EXISTS sq_task_uid ON sq_task (uid, st)');
        $p->exec("CREATE TABLE IF NOT EXISTS sq_tpl (id VARCHAR(20) PRIMARY KEY, n VARCHAR(120) NOT NULL, owner VARCHAR(40) NOT NULL, shared INT NOT NULL DEFAULT 0, cat VARCHAR(40) NOT NULL DEFAULT '', subj VARCHAR(200) NOT NULL DEFAULT '', body TEXT NOT NULL, uses INT NOT NULL DEFAULT 0, at BIGINT NOT NULL, u BIGINT NOT NULL)");
        // tables made before the A/B, time zone and reply-sorting columns get them once
        if ((int) ($p->query("SELECT v FROM meta WHERE k = 'sq_schema'")->fetchColumn() ?: 0) < 2) {
            foreach (["sq_enr ADD COLUMN ab VARCHAR(1) NOT NULL DEFAULT ''", "sq_enr ADD COLUMN tz VARCHAR(40) NOT NULL DEFAULT ''", "sq_enr ADD COLUMN src VARCHAR(12) NOT NULL DEFAULT ''", "sq_enr ADD COLUMN cls VARCHAR(12) NOT NULL DEFAULT ''", 'sq_enr ADD COLUMN rep_at BIGINT NOT NULL DEFAULT 0', "sq_enr ADD COLUMN rep_txt VARCHAR(400) NOT NULL DEFAULT ''", "sq_ev ADD COLUMN ab VARCHAR(1) NOT NULL DEFAULT ''"] as $alt) {
                try {
                    $p->exec('ALTER TABLE ' . $alt);
                } catch (Throwable $e) {
                    // the column is already there
                }
            }
            $p->exec("DELETE FROM meta WHERE k = 'sq_schema'");
            $p->exec("INSERT INTO meta (k, v) VALUES ('sq_schema', 2)");
        }
    }
    return $p;
}
/** Who works with sequences: the people who have the CRM. */
function sqMay(array $u): bool
{
    return hasRole($u, 'admin') || hasRole($u, 'hr') || isBench((string) $u['id']) || grantOf((string) $u['id'], 'crm');
}
function sqSeqRow(array $r): array
{
    $cfg = (json_decode((string) $r['cfg'], true) ?: []) + SQ_CFG;
    $cfg['auto'] = (array) ($cfg['auto'] ?? []) + SQ_CFG['auto'];
    return ['id' => (string) $r['id'], 'n' => (string) $r['n'], 'owner' => (string) $r['owner'], 'shared' => (int) $r['shared'] === 1, 'st' => (string) $r['st'], 'steps' => json_decode((string) $r['steps'], true) ?: [], 'cfg' => $cfg, 'at' => (int) $r['at'], 'u' => (int) $r['u']];
}
function sqSeq(string $id, array $u, bool $edit = false): array
{
    $s = sqDb()->prepare('SELECT * FROM sq_seq WHERE id = ?');
    $s->execute([$id]);
    $r = $s->fetch();
    if (!$r) {
        fail(404, 'not_found', 'No such sequence.');
    }
    $S = sqSeqRow($r);
    $mine = $S['owner'] === $u['id'] || hasRole($u, 'admin');
    if (!$mine && !($S['shared'] && !$edit)) {
        fail($edit && $S['shared'] ? 403 : 404, $edit && $S['shared'] ? 'forbidden' : 'not_found', $edit && $S['shared'] ? 'Only its owner changes a shared sequence.' : 'No such sequence.');
    }
    return $S;
}
function sqEv(string $seq, string $enr, string $sender, string $kind, int $step = 0, string $info = '', string $ab = ''): void
{
    sqDb()->prepare('INSERT INTO sq_ev (id, seq, enr, sender, at, kind, step, info, ab) VALUES (?,?,?,?,?,?,?,?,?)')->execute([rid(9), $seq, $enr, $sender, now(), $kind, $step, mb_substr($info, 0, 500), $ab]);
}
/** {fields} used in a text that are not merge fields, as an error ('' when all are known). */
function sqFieldsBad(string $txt, string $where): string
{
    if (preg_match_all('/\{([a-z_]+)\}/', $txt, $m)) {
        foreach ($m[1] as $f) {
            if (!in_array($f, SQ_FIELDS, true)) {
                return $where . ' uses {' . $f . '}; the fields are {' . implode('}, {', SQ_FIELDS) . '}.';
            }
        }
    }
    return '';
}
/** The steps sent by the page, cleaned: up to 10, an email (subject, body, an optional B version) or a task, each a number of days after the one before. */
function sqStepsIn($in): array
{
    $out = [];
    $emails = 0;
    foreach (array_slice((array) $in, 0, 10) as $i => $s) {
        $s = (array) $s;
        $kind = ($s['kind'] ?? '') === 'task' ? 'task' : 'email';
        $wait = max(0, min(60, (int) ($s['wait'] ?? 0)));
        $id = preg_replace('/[^a-z0-9]/', '', (string) ($s['id'] ?? '')) ?: rid(4);
        if ($kind === 'email') {
            $subj = mb_substr(trim((string) ($s['subj'] ?? '')), 0, 200);
            $body = mb_substr(trim((string) ($s['body'] ?? '')), 0, 8000);
            $thread = $emails > 0 && !empty($s['thread']);
            if (($subj === '' && !$thread) || $body === '') {
                fail(400, 'invalid_argument', 'Email step ' . ($i + 1) . ' needs a subject and a message.');
            }
            // A/B: a second subject (not for a reply in the thread) and/or a second message
            $subjB = $thread ? '' : mb_substr(trim((string) ($s['subjB'] ?? '')), 0, 200);
            $bodyB = mb_substr(trim((string) ($s['bodyB'] ?? '')), 0, 8000);
            foreach ([[$subj, 'Step ' . ($i + 1)], [$body, 'Step ' . ($i + 1)], [$subjB, 'Step ' . ($i + 1) . ' (version B)'], [$bodyB, 'Step ' . ($i + 1) . ' (version B)']] as [$txt, $where]) {
                if (($bad = sqFieldsBad($txt, $where)) !== '') {
                    fail(400, 'invalid_argument', $bad);
                }
            }
            $row = ['id' => $id, 'kind' => 'email', 'wait' => $wait, 'subj' => $subj, 'body' => $body, 'thread' => $thread];
            if ($subjB !== '' || $bodyB !== '') {
                $row += ['subjB' => $subjB, 'bodyB' => $bodyB, 'win' => in_array($s['win'] ?? '', ['a', 'b'], true) ? (string) $s['win'] : ''];
            }
            $out[] = $row;
            $emails++;
        } else {
            $t = mb_substr(trim((string) ($s['task'] ?? '')), 0, 400);
            if ($t === '') {
                fail(400, 'invalid_argument', 'Task step ' . ($i + 1) . ' needs to say what to do.');
            }
            $out[] = ['id' => $id, 'kind' => 'task', 'wait' => $wait, 'task' => $t];
        }
    }
    if (!$emails) {
        fail(400, 'invalid_argument', 'A sequence needs at least one email.');
    }
    return $out;
}
function sqCfgIn($in): array
{
    $c = (array) $in;
    $from = max(0, min(23, (int) ($c['from'] ?? SQ_CFG['from'])));
    $to = max(1, min(24, (int) ($c['to'] ?? SQ_CFG['to'])));
    if ($to <= $from) {
        fail(400, 'invalid_argument', 'The sending hours end before they start.');
    }
    $flag = fn(string $k) => !array_key_exists($k, $c) || !empty($c[$k]);
    $au = (array) ($c['auto'] ?? []);
    $forms = array_values(array_intersect(['talent', 'contact'], array_map('strval', (array) ($au['forms'] ?? []))));
    if (!empty($au['on']) && !$forms) {
        fail(400, 'invalid_argument', 'Pick the website form whose new leads join this sequence.');
    }
    return [
        'weekdays' => $flag('weekdays'), 'from' => $from, 'to' => $to, 'cap' => max(1, min(200, (int) ($c['cap'] ?? SQ_CFG['cap']))), 'stopLead' => $flag('stopLead'),
        'tzMode' => ($c['tzMode'] ?? 'person') === 'company' ? 'company' : 'person',
        'hol' => $flag('hol'), 'holOff' => array_values(array_intersect(array_keys(SQ_HOL), array_map('strval', (array) ($c['holOff'] ?? [])))),
        'ooo' => max(1, min(30, (int) ($c['ooo'] ?? SQ_CFG['ooo']))), 'oooKeep' => $flag('oooKeep'), 'later' => max(0, min(365, (int) ($c['later'] ?? SQ_CFG['later']))), 'replyTask' => $flag('replyTask'),
        'auto' => ['on' => !empty($au['on']), 'forms' => $forms ?: SQ_CFG['auto']['forms'], 'who' => ($au['who'] ?? 'owner') === 'me' ? 'me' : 'owner'],
    ];
}

/* ---------- time zones and holidays ---------- */
/** The company's time zone (Admin settings 'timezone', else US Eastern, as elsewhere in the portal). */
function sqCoTz(): string
{
    $t = sqTz((string) (cfg('timezone') ?: ''));
    return $t !== '' ? $t : 'America/New_York';
}
/** A time zone as typed in a file or form (an IANA name, or ET / Eastern / PST / IST and the like); '' when unknown. */
function sqTz(string $tz): string
{
    $tz = trim($tz);
    if ($tz === '' || strlen($tz) > 40) {
        return '';
    }
    $w = strtolower((string) preg_replace('/[^a-z]/i', '', $tz));
    $words = ['et' => 'America/New_York', 'est' => 'America/New_York', 'edt' => 'America/New_York', 'eastern' => 'America/New_York', 'easterntime' => 'America/New_York', 'ct' => 'America/Chicago', 'cst' => 'America/Chicago', 'cdt' => 'America/Chicago', 'central' => 'America/Chicago', 'centraltime' => 'America/Chicago', 'mt' => 'America/Denver', 'mst' => 'America/Denver', 'mdt' => 'America/Denver', 'mountain' => 'America/Denver', 'mountaintime' => 'America/Denver', 'pt' => 'America/Los_Angeles', 'pst' => 'America/Los_Angeles', 'pdt' => 'America/Los_Angeles', 'pacific' => 'America/Los_Angeles', 'pacifictime' => 'America/Los_Angeles', 'akst' => 'America/Anchorage', 'alaska' => 'America/Anchorage', 'hst' => 'Pacific/Honolulu', 'hawaii' => 'Pacific/Honolulu', 'arizona' => 'America/Phoenix', 'ist' => 'Asia/Kolkata', 'india' => 'Asia/Kolkata', 'useastern' => 'America/New_York', 'uscentral' => 'America/Chicago', 'usmountain' => 'America/Denver', 'uspacific' => 'America/Los_Angeles', 'usarizona' => 'America/Phoenix', 'usalaska' => 'America/Anchorage', 'ushawaii' => 'Pacific/Honolulu'];
    if (isset($words[$w])) {
        return $words[$w];
    }
    static $all = null;
    $all ??= array_flip(DateTimeZone::listIdentifiers(DateTimeZone::ALL_WITH_BC));
    return isset($all[$tz]) ? $tz : '';
}
/** A time zone from a location ("Austin, TX", "Jersey City, New Jersey", "Hyderabad, India"); '' when it does not say. */
function sqTzGuess(string $loc): string
{
    $loc = trim($loc);
    if ($loc === '') {
        return '';
    }
    if (preg_match('/,\s*([A-Z]{2})\b(?!.*,\s*[A-Z]{2}\b)/', $loc, $m) && isset(SQ_STATE_TZ[$m[1]])) {
        return SQ_STATE_TZ[$m[1]];
    }
    $l = ' ' . strtolower((string) preg_replace('/[^a-z]+/i', ' ', $loc)) . ' ';
    foreach (SQ_STATE_NAMES as $name => $ab) {
        if (str_contains($l, ' ' . $name . ' ')) {
            // "Washington" alone is the state; "Washington DC" / "District of Columbia" were matched first
            return $name === 'washington' && str_contains($l, ' washington dc ') ? SQ_STATE_TZ['DC'] : SQ_STATE_TZ[$ab];
        }
    }
    if (preg_match('/\b(india|hyderabad|bangalore|bengaluru|chennai|pune|mumbai|delhi|noida|gurgaon|gurugram|kolkata|ahmedabad|kochi|coimbatore|vizag|visakhapatnam|vijayawada|chandigarh|jaipur|indore|nagpur|trivandrum|thiruvananthapuram)\b/', $l)) {
        return 'Asia/Kolkata';
    }
    if (preg_match('/^\s*([A-Z]{2})\s*$/', $loc, $m) && isset(SQ_STATE_TZ[$m[1]])) {
        return SQ_STATE_TZ[$m[1]];
    }
    return '';
}
/** Does US federal holiday skipping apply to this time zone ('' is the company's: a US company)? */
function sqUsTz(string $tz): bool
{
    return $tz === '' || (bool) preg_match('#^(America/(New_York|Chicago|Denver|Phoenix|Los_Angeles|Anchorage|Juneau|Sitka|Yakutat|Nome|Adak|Metlakatla|Detroit|Boise|Menominee|Puerto_Rico|Indiana/.+|Kentucky/.+|North_Dakota/.+)|Pacific/Honolulu|US/.+)$#', $tz);
}
/** The local time at $ms (default now) in a time zone ('' = the company's). */
function sqLocal(string $tz, ?int $ms = null): DateTimeImmutable
{
    return (new DateTimeImmutable('@' . intdiv($ms ?? now(), 1000)))->setTimezone(new DateTimeZone($tz !== '' ? $tz : sqCoTz()));
}
/**
 * US federal holidays as they are observed (one on a Saturday is observed the Friday before, one on a Sunday the
 * Monday after, so New Year's Day 2028 is observed on Friday, December 31, 2027), plus the day after Thanksgiving:
 * 'Y-m-d' => [key, name] for the year and the years either side.
 */
function sqHolidays(int $year): array
{
    static $cache = [];
    if (isset($cache[$year])) {
        return $cache[$year];
    }
    $utc = new DateTimeZone('UTC');
    $out = [];
    foreach ([$year - 1, $year, $year + 1] as $y) {
        $nth = function (int $m, int $dow, int $n) use ($y, $utc): string {
            $d1 = new DateTimeImmutable(sprintf('%04d-%02d-01', $y, $m), $utc);
            return $d1->modify('+' . ((($dow - (int) $d1->format('N') + 7) % 7) + 7 * ($n - 1)) . ' days')->format('Y-m-d');
        };
        $last = function (int $m, int $dow) use ($y, $utc): string {
            $d = (new DateTimeImmutable(sprintf('%04d-%02d-01', $y, $m), $utc))->modify('last day of this month');
            return $d->modify('-' . (((int) $d->format('N') - $dow + 7) % 7) . ' days')->format('Y-m-d');
        };
        $fixed = function (int $m, int $day) use ($y, $utc): string {
            $d = new DateTimeImmutable(sprintf('%04d-%02d-%02d', $y, $m, $day), $utc);
            $n = (int) $d->format('N');
            return ($n === 6 ? $d->modify('-1 day') : ($n === 7 ? $d->modify('+1 day') : $d))->format('Y-m-d');
        };
        $list = [
            'newyear' => $fixed(1, 1), 'mlk' => $nth(1, 1, 3), 'presidents' => $nth(2, 1, 3), 'memorial' => $last(5, 1), 'juneteenth' => $fixed(6, 19),
            'independence' => $fixed(7, 4), 'labor' => $nth(9, 1, 1), 'columbus' => $nth(10, 1, 2), 'veterans' => $fixed(11, 11), 'thanksgiving' => $nth(11, 4, 4), 'christmas' => $fixed(12, 25),
        ];
        $list['thanksgiving2'] = (new DateTimeImmutable($list['thanksgiving'], $utc))->modify('+1 day')->format('Y-m-d');
        foreach ($list as $k => $d) {
            $out[$d] = [$k, SQ_HOL[$k]];
        }
    }
    ksort($out);
    return $cache[$year] = $out;
}
/** The holiday on that local day ('' when none, or when it is one the sequence does not skip). */
function sqHolidayOn(DateTimeImmutable $local, array $off = []): string
{
    $h = sqHolidays((int) $local->format('Y'))[$local->format('Y-m-d')] ?? null;
    return $h && !in_array($h[0], $off, true) ? (string) $h[1] : '';
}
/** The next holidays from today (company time): [[date, key, name]]. */
function sqHolidaysNext(int $n = 6): array
{
    $today = sqLocal('')->format('Y-m-d');
    $y = (int) substr($today, 0, 4);
    $out = [];
    foreach (sqHolidays($y) + sqHolidays($y + 1) as $d => [$k, $name]) {
        if ($d >= $today && count($out) < $n) {
            $out[$d] = [$d, $k, $name];
        }
    }
    ksort($out);
    return array_values($out);
}
/** '' when an email may go out to this person now, else why it waits: 'weekend', 'hours' or 'holiday: <name>'. */
function sqWindowWhy(array $cfg, string $tz = '', ?int $ms = null): string
{
    $tz = ($cfg['tzMode'] ?? 'person') === 'person' ? sqTz($tz) : '';
    $t = sqLocal($tz, $ms);
    if (!empty($cfg['weekdays']) && (int) $t->format('N') > 5) {
        return 'weekend';
    }
    $h = (int) $t->format('G');
    if ($h < (int) $cfg['from'] || $h >= (int) $cfg['to']) {
        return 'hours';
    }
    if (!empty($cfg['hol']) && sqUsTz($tz) && ($n = sqHolidayOn($t, (array) ($cfg['holOff'] ?? []))) !== '') {
        return 'holiday: ' . $n;
    }
    return '';
}

/* ---------- merge fields, rendering, mailbox ---------- */
/** The merge fields for one person. */
function sqVars(array $e, array $sender, array $acct = []): array
{
    require_once __DIR__ . '/sso.php';
    $n = trim((string) $e['n']);
    $parts = preg_split('/\s+/', $n) ?: [];
    $first = $n !== '' ? (string) $parts[0] : mymailFirst((string) $e['email'], '');
    $sig = sigOf((string) ($sender['id'] ?? ''));
    return ['first_name' => $first, 'last_name' => count($parts) > 1 ? (string) end($parts) : '', 'name' => $n !== '' ? $n : $first, 'company' => (string) ($e['co'] ?? ''), 'my_name' => (string) (($acct['name'] ?? '') ?: $sender['name']), 'my_email' => (string) (($acct['email'] ?? '') ?: $sender['email']), 'signature' => $sig !== '' ? $sig : (string) (($acct['name'] ?? '') ?: $sender['name'])]; // v69: the sender's signature (their name when they have none)
}
function sqMerge(string $txt, array $v): string
{
    return (string) preg_replace_callback('/\{([a-z_]+)\}/', fn($m) => array_key_exists($m[1], $v) ? $v[$m[1]] : $m[0], $txt);
}
/** v83: what a website visitor typed, made safe to merge into an email from a staff mailbox: no links, addresses, paths or domains, plain words only. */
function sqPlainWeb(string $s, int $max, int $words): string
{
    $s = (string) preg_replace('~\S*(?:://|www\.|@|/|\\\\)\S*~iu', ' ', $s);
    $s = (string) preg_replace('~[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.[a-z]{2,}\b~iu', ' ', $s);
    $s = (string) preg_replace('~[^\p{L}\p{N} &.,\'-]~u', ' ', $s);
    $w = array_filter(preg_split('/\s+/u', trim($s)) ?: [], fn($x) => $x !== '');
    return mb_substr(implode(' ', array_slice($w, 0, $words)), 0, $max);
}
function sqUnsubUrl(string $tok): string
{
    return rtrim(siteUrl(), '/') . '/#/unsubscribe?t=' . $tok;
}
/** Which version of an email step this person gets: '' (the step has one), 'a' or 'b' (the winner once one is chosen). */
function sqVariant(array $st, array $e): string
{
    if (trim((string) ($st['subjB'] ?? '')) === '' && trim((string) ($st['bodyB'] ?? '')) === '') {
        return '';
    }
    if (in_array($st['win'] ?? '', ['a', 'b'], true)) {
        return (string) $st['win'];
    }
    return ($e['ab'] ?? '') === 'b' ? 'b' : 'a';
}
/** One step's email for one person: subject, body with the postal address and the unsubscribe link, threading, the version. */
function sqRender(array $S, int $stepIx, array $e, array $sender, array $acct = []): array
{
    $st = $S['steps'][$stepIx];
    $v = sqVars($e, $sender, $acct);
    $var = sqVariant($st, $e);
    $first = null;
    foreach ($S['steps'] as $x) {
        if ($x['kind'] === 'email') {
            $first = $x;
            break;
        }
    }
    $thread = !empty($st['thread']) && (string) ($e['msgid'] ?? '') !== '';
    $subjT = $var === 'b' && trim((string) ($st['subjB'] ?? '')) !== '' ? (string) $st['subjB'] : (string) $st['subj'];
    $bodyT = $var === 'b' && trim((string) ($st['bodyB'] ?? '')) !== '' ? (string) $st['bodyB'] : (string) $st['body'];
    if (!empty($st['thread'])) {
        $fv = $first ? sqVariant($first, $e) : '';
        $firstSubj = $fv === 'b' && trim((string) ($first['subjB'] ?? '')) !== '' ? (string) $first['subjB'] : (string) ($first['subj'] ?? '');
        $subj = 'Re: ' . ((string) ($e['subj'] ?? '') !== '' ? (string) $e['subj'] : sqMerge($firstSubj, $v));
    } else {
        $subj = sqMerge($subjT, $v);
    }
    $brand = emailBrand();
    $body = sqMerge($bodyT, $v) . "\n\n--\n" . $brand['text'] . "\nIf you would rather not hear from me again: " . sqUnsubUrl((string) $e['tok']);
    return ['subj' => preg_replace('/^(Re:\s*)+/i', 'Re: ', $subj), 'body' => $body, 'inReplyTo' => $thread ? (string) $e['msgid'] : '', 'ab' => $var];
}
/** A token that sees the mailbox; '' when it has to be connected again (no request is ended). */
function sqToken(array $a): array
{
    require_once __DIR__ . '/sso.php';
    // v83: a Gmail app-password (SMTP) mailbox has no token: mymailSendRaw() signs in to SMTP itself
    if (!in_array($a['provider'], ['google', 'microsoft'], true)) {
        return [$a, ''];
    }
    if ((int) $a['exp'] > now() + 60000 && (string) $a['access'] !== '') {
        return [$a, ''];
    }
    $GLOBALS['SE_FAIL_THROWS'] = true;
    try {
        $tok = $a['provider'] === 'microsoft' ? msmailToken($a) : gmailToken($a);
    } catch (FailError $e) {
        return [null, $e->getMessage()];
    } finally {
        $GLOBALS['SE_FAIL_THROWS'] = false;
    }
    return [mymailAcct((string) $a['uid']) ?? $a, ''];
}
/** New mail in the sender's inbox (Gmail or Microsoft 365), at most every 10 minutes; '' or what went wrong. */
function sqSync(array $a): string
{
    require_once __DIR__ . '/sso.php';
    if (!in_array($a['provider'], ['google', 'microsoft'], true)) {
        return 'replies are read from Gmail or Microsoft 365 mailboxes only';
    }
    $k = 'sqsync:' . $a['uid'];
    $last = (int) (secKv($k) ?? 0);
    if ($last > now() - 10 * 60000) {
        return '';
    }
    secKvSet($k, now());
    $GLOBALS['SE_FAIL_THROWS'] = true;
    try {
        $a['provider'] === 'microsoft' ? msmailSync($a) : gmailSync($a);
    } catch (FailError $e) {
        return $e->getMessage();
    } finally {
        $GLOBALS['SE_FAIL_THROWS'] = false;
    }
    return '';
}

/* ---------- replies ---------- */
/** The person's own words in a reply: the text above the quoted email ("On … wrote:", "-----Original Message-----", "From:"). */
function sqReplyText(string $text): string
{
    $out = [];
    foreach (preg_split('/\r\n|\r|\n/', $text) ?: [] as $line) {
        $l = trim($line);
        if (preg_match('/^(On .{4,240}wrote:?|-{2,}\s*Original Message\s*-{2,}|From:\s.+|_{8,}|Sent from my \w+)$/i', $l)) {
            break;
        }
        if (str_starts_with($l, '>')) {
            continue;
        }
        $out[] = $line;
    }
    return trim(implode("\n", $out));
}
/** When an out-of-office answer says the person is back ("back on Monday, October 12", "returning 10/12"): the day after, or 0. */
function sqOooUntil(string $text, ?int $nowMs = null): int
{
    $now = $nowMs ?? now();
    $t = ' ' . strtolower((string) preg_replace('/\s+/', ' ', $text)) . ' ';
    $months = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
    $lead = '(?:back|return(?:ing)?|returns|in the office|in office|available|until|till|through|thru)';
    $cands = [];
    if (preg_match_all('/' . $lead . '\D{0,30}?\b(' . $months . ')\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/', $t, $mm, PREG_SET_ORDER)) {
        foreach ($mm as $m) {
            $cands[] = [$m[1], (int) $m[2], isset($m[3]) && $m[3] !== '' ? (int) $m[3] : 0];
        }
    }
    if (preg_match_all('/' . $lead . '\D{0,30}?\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(' . $months . ')\b(?:,?\s+(\d{4}))?/', $t, $mm, PREG_SET_ORDER)) {
        foreach ($mm as $m) {
            $cands[] = [$m[2], (int) $m[1], isset($m[3]) && $m[3] !== '' ? (int) $m[3] : 0];
        }
    }
    if (preg_match_all('#' . $lead . '\D{0,30}?\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b#', $t, $mm, PREG_SET_ORDER)) {
        foreach ($mm as $m) {
            $y = isset($m[3]) && $m[3] !== '' ? (int) $m[3] : 0;
            $cands[] = [(int) $m[1], (int) $m[2], $y > 0 && $y < 100 ? 2000 + $y : $y];
        }
    }
    $tz = new DateTimeZone(sqCoTz());
    $today = (new DateTimeImmutable('@' . intdiv($now, 1000)))->setTimezone($tz);
    foreach ($cands as [$mon, $day, $year]) {
        $mn = is_int($mon) ? $mon : (int) date('n', (int) strtotime('1 ' . substr((string) $mon, 0, 3) . ' 2000'));
        if ($mn < 1 || $mn > 12 || $day < 1 || $day > 31) {
            continue;
        }
        $y = $year ?: (int) $today->format('Y');
        if (!checkdate($mn, $day, $y)) {
            continue;
        }
        $d = new DateTimeImmutable(sprintf('%04d-%02d-%02d 00:00:00', $y, $mn, $day), $tz);
        if (!$year && $d < $today->modify('-7 days')) {
            $d = $d->modify('+1 year');
        }
        $ms = $d->modify('+1 day')->getTimestamp() * 1000;
        if ($ms > $now && $ms < $now + 90 * 86400000) {
            return $ms;
        }
    }
    return 0;
}
/** Sort a reply by its subject and the person's own words: [class, until (out of office), the words]. */
function sqSortReply(string $subj, string $text, ?int $nowMs = null): array
{
    $own = sqReplyText($text);
    $s = strtolower(trim($subj));
    $t = ' ' . strtolower((string) preg_replace('/\s+/', ' ', $own)) . ' ';
    $interested = "/\b(interested|let'?s (talk|connect|chat|set up|schedule|discuss)|send (me |over |us )?(the |your |a few |some )?(resumes?|profiles?|details|rates?|cvs?|candidates)|share (the |your |a few |some )?(resumes?|profiles?|candidates)|(available|free) (for|to) (a )?(call|chat|talk|discuss)|schedule (a )?(call|meeting|time|chat)|set up (a )?(call|meeting|time)|give me a call|call me|sounds good|we have (an? )?(open|current) (role|position|requirement|need)|we are (looking|hiring)|we're (looking|hiring)|what are your rates)\b/";
    $auto = (bool) preg_match('/^(automatic reply|auto(matic)?[ -]?reply|autoreply|out of (the )?office|ooo\b|away\b|on leave|on vacation|annual leave)/', $s);
    $oooWords = (bool) preg_match("/\b(out of (the )?office|on (annual |parental |maternity |paternity |medical |sick )?leave|on vacation|away from (the |my )?office|limited (access to|connectivity|ability to check) (my )?e-?mail)\b/", $t);
    if ($auto || ($oooWords && !preg_match($interested, $t))) {
        return ['ooo', sqOooUntil($own, $nowMs), $own];
    }
    if (preg_match("/\b(unsubscribe|remove me|take me off|stop (e-?mailing|contacting|sending|writing)|(do not|don't|please don't) (contact|e-?mail|email|write)|no more e-?mails?|opt me out|opt out)\b/", $t)) {
        return ['unsub', 0, $own];
    }
    if (preg_match("/\b(wrong (person|contact|email)|not the right (person|contact)|no longer (with|at|work|working)|i have left|left the (company|firm|organization)|not (my|in my) (area|department|team)|(please )?(reach out to|contact|email|speak (to|with)|talk to) (my colleague|our|the) |forwarding (this|your email) to|you (should|may want to|might want to) (reach|contact|talk|speak))/", $t)) {
        return ['wrong', 0, $own];
    }
    if (preg_match("/\b(not interested|no thanks|no thank you|no, thank|we're all set|we are all set|we're good|we are good|not a (good )?fit|we don't (use|work with) (vendors|agencies|staffing|third)|do not (use|work with) (vendors|agencies|staffing)|no need for)\b/", $t)) {
        return ['no', 0, $own];
    }
    if (preg_match("/\b(not (right )?now|not at (this|the moment|the present)|not at this time|no (current |open )?(needs?|openings|requirements?|positions|roles)( right now| at the moment| at this time)?|not hiring|hiring freeze|budget freeze|maybe later|(reach|check) (back|out|in) (in|next|later|after)|circle back|touch base (in|next|later)|next (quarter|year|month)|in a (few|couple of) (weeks|months)|after the (holidays|new year)|early next year)/", $t)) {
        return ['later', 0, $own];
    }
    if (preg_match($interested, $t)) {
        return ['interested', 0, $own];
    }
    return ['other', 0, $own];
}
/** The newest reply from the person in the sender's inbox, since they were added (or since the last one that was sorted). */
function sqReplyOf(array $e): ?array
{
    require_once __DIR__ . '/sso.php';
    $s = mymailDb()->prepare("SELECT id, at, subject, text, snippet FROM mail_user_msgs WHERE uid = ? AND dir = 'in' AND LOWER(from_email) = ? AND at > ? ORDER BY at DESC LIMIT 1");
    $s->execute([(string) $e['sender'], strtolower((string) $e['email']), max((int) $e['at'], (int) ($e['rep_at'] ?? 0))]);
    $r = $s->fetch();
    return $r ?: null;
}
/** The step and version of the last email that went to this person (a reply counts towards it). */
function sqLastSent(string $enr): array
{
    $s = sqDb()->prepare("SELECT step, ab FROM sq_ev WHERE enr = ? AND kind = 'sent' ORDER BY at DESC LIMIT 1");
    $s->execute([$enr]);
    $r = $s->fetch();
    return $r ? [(int) $r['step'], (string) $r['ab']] : [0, ''];
}
function sqTaskAdd(string $seq, string $enr, string $uid, int $step, string $t, int $due): void
{
    sqDb()->prepare("INSERT INTO sq_task (id, seq, enr, uid, step, t, due, st) VALUES (?,?,?,?,?,?,?, 'open')")->execute([rid(9), $seq, $enr, $uid, $step, mb_substr($t, 0, 600), $due]);
}
/** A reply arrived: sort it, take the person out (or, out of office, wait until they are back), and make the follow-up task. True when they left. */
function sqOnReply(array $S, array $e, array $rep): bool
{
    $p = sqDb();
    [$cls, $until, $own] = sqSortReply((string) $rep['subject'], (string) ($rep['text'] !== '' ? $rep['text'] : $rep['snippet']));
    $who = trim((string) $e['n']) !== '' ? trim((string) $e['n']) : (string) $e['email'];
    [$ls, $ab] = sqLastSent((string) $e['id']);
    $snip = mb_substr(trim((string) preg_replace('/\s+/', ' ', $own !== '' ? $own : (string) $rep['snippet'])), 0, 380);
    $day = sqLocal('', (int) $rep['at'])->format('M j');
    if ($cls === 'ooo' && !empty($S['cfg']['oooKeep'])) {
        $back = $until ?: now() + max(1, (int) $S['cfg']['ooo']) * 86400000;
        $f = ['rep_at' => (int) $rep['at'], 'rep_txt' => $snip, 'cls' => 'ooo', 'why' => 'Out of office; next email after ' . sqLocal('', $back)->format('M j')];
        if ((string) $e['st'] === 'active') {
            $f['next_at'] = max((int) $e['next_at'], $back);
        }
        sqSetEnr((string) $e['id'], $f);
        sqEv((string) $e['seq'], (string) $e['id'], (string) $e['sender'], 'ooo', $ls, 'Out of office until ' . sqLocal('', $back)->format('M j'), $ab);
        return false;
    }
    $st = $cls === 'unsub' ? 'unsub' : 'replied';
    sqSetEnr((string) $e['id'], ['st' => $st, 'why' => 'Replied ' . $day . ' (' . strtolower(SQ_CLS[$cls]) . ')' . ((string) $rep['subject'] !== '' ? ': ' . mb_substr((string) $rep['subject'], 0, 120) : ''), 'next_at' => 0, 'cls' => $cls, 'rep_at' => (int) $rep['at'], 'rep_txt' => $snip]);
    $p->prepare("UPDATE sq_task SET st = 'gone' WHERE enr = ? AND st = 'open'")->execute([(string) $e['id']]);
    sqEv((string) $e['seq'], (string) $e['id'], (string) $e['sender'], 'replied', $ls, SQ_CLS[$cls] . ': ' . $snip, $ab);
    if ($cls === 'unsub') {
        require_once __DIR__ . '/mail.php';
        mdb()->prepare('REPLACE INTO mail_suppress (email, at, why) VALUES (?, ?, ?)')->execute([strtolower((string) $e['email']), now(), 'asked by reply']);
        sqEv((string) $e['seq'], (string) $e['id'], (string) $e['sender'], 'unsub', $ls, 'Asked by reply', $ab);
    }
    $co = trim((string) $e['co']);
    $task = match ($cls) {
        'interested' => 'Answer ' . $who . ' (interested): ' . mb_substr($snip, 0, 160),
        'later' => !empty($S['cfg']['later']) ? 'Check back with ' . $who . ($co !== '' ? ' at ' . $co : '') . ' (said not now on ' . $day . ')' : '',
        'wrong' => 'Find the right contact' . ($co !== '' ? ' at ' . $co : '') . ': ' . $who . ' says it is not them: ' . mb_substr($snip, 0, 140),
        'other' => !empty($S['cfg']['replyTask']) ? 'Answer ' . $who . ': ' . mb_substr($snip, 0, 160) : '',
        default => '',
    };
    if ($task !== '') {
        sqTaskAdd((string) $e['seq'], (string) $e['id'], (string) $e['sender'], -1, $task, $cls === 'later' ? now() + (int) $S['cfg']['later'] * 86400000 : now());
    }
    return true;
}
/** Why this person should not get the next step: a reply ('reply' and the message), unsubscribed, bounced, lead closed; '' when they should. */
function sqStopWhy(array $S, array $e): array
{
    require_once __DIR__ . '/mail.php';
    $email = strtolower((string) $e['email']);
    $s = mdb()->prepare('SELECT why FROM mail_suppress WHERE email = ?');
    $s->execute([$email]);
    $sup = $s->fetchColumn();
    if ($sup !== false) {
        return [str_contains((string) $sup, 'bounce') ? 'bounced' : 'unsub', 'On the do-not-email list (' . $sup . ')', null];
    }
    require_once __DIR__ . '/sso.php';
    if ($rep = sqReplyOf($e)) {
        return ['reply', '', $rep];
    }
    if ((string) $e['mid'] !== '') {
        $s = mymailDb()->prepare('SELECT err FROM mail_user_msgs WHERE id = ?');
        $s->execute([(string) $e['mid']]);
        $err = (string) ($s->fetchColumn() ?: '');
        if (str_starts_with($err, 'Bounced')) {
            return ['bounced', mb_substr($err, 0, 200), null];
        }
    }
    if (!empty($S['cfg']['stopLead']) && str_starts_with((string) $e['ref'], 'lead:')) {
        $l = docGet('crm/main/lead/' . substr((string) $e['ref'], 5));
        if ($l && in_array((string) ($l->st ?? ''), ['Converted', 'Unqualified'], true)) {
            return ['stopped', 'Lead ' . strtolower((string) $l->st), null];
        }
    }
    return ['', '', null];
}
function sqSetEnr(string $id, array $f): void
{
    $sets = [];
    $vals = [];
    foreach ($f as $k => $v) {
        $sets[] = "$k = ?";
        $vals[] = $v;
    }
    $vals[] = $id;
    sqDb()->prepare('UPDATE sq_enr SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($vals);
}
/** v83: takes one person's due step for this run (the scheduled job and "Send what is due now" may run at once); false when another run took it first. */
function sqClaim(array $e): bool
{
    $c = sqDb()->prepare('UPDATE sq_enr SET next_at = ? WHERE id = ? AND st = ? AND step = ? AND next_at = ?');
    $c->execute([now() + 600000, (string) $e['id'], (string) $e['st'], (int) $e['step'], (int) $e['next_at']]);
    return $c->rowCount() === 1;
}
/** When a step that waits $days after now may go out (the sending hours, weekdays and holidays are checked when it is due). */
function sqNextAt(array $S, int $ix): int
{
    if (!isset($S['steps'][$ix])) {
        return 0;
    }
    return now() + (int) $S['steps'][$ix]['wait'] * 86400000;
}
/** A/B: the version a person gets for the whole sequence, A and B in turn (counted per sequence). */
function sqAbPick(string $seq, array &$counts): string
{
    if (!isset($counts[$seq])) {
        $s = sqDb()->prepare("SELECT ab, COUNT(*) n FROM sq_enr WHERE seq = ? AND ab IN ('a', 'b') GROUP BY ab");
        $s->execute([$seq]);
        $counts[$seq] = ['a' => 0, 'b' => 0];
        foreach ($s->fetchAll() as $r) {
            $counts[$seq][(string) $r['ab']] = (int) $r['n'];
        }
    }
    $v = $counts[$seq]['a'] <= $counts[$seq]['b'] ? 'a' : 'b';
    $counts[$seq][$v]++;
    return $v;
}
/**
 * The work that is due: replies and bounces first, then each person's next step (an email from the sender's mailbox
 * or a task for the sender), one step per person per run. $onlySender limits it to one sender's people ("Send what is
 * due now"). Returns counts.
 */
function sqRun(string $onlySender = '', int $max = 60): array
{
    require_once __DIR__ . '/sso.php';
    require_once __DIR__ . '/mail.php';
    $out = ['sent' => 0, 'tasks' => 0, 'stopped' => 0, 'held' => 0, 'errors' => 0, 'ooo' => 0, 'replies' => 0];
    $p = sqDb();
    // paused people are read for replies too (nothing goes to them), and so are the people who got the last step in
    // the past 30 days: a reply to the last email is sorted and counted like any other
    // v83: the people who can get a step (active, and error which is retried) come first, earliest due first, so rows
    // that are only read for replies (task, paused, finished; next_at 0) cannot fill the limit and starve the sending
    $q = "SELECT * FROM sq_enr WHERE (st IN ('active', 'task', 'error', 'paused') OR (st = 'finished' AND cls = '' AND last_at > ?))" . ($onlySender !== '' ? ' AND sender = ?' : '') . " ORDER BY CASE WHEN st IN ('active', 'error') THEN 0 ELSE 1 END, next_at LIMIT 3000";
    $s = $p->prepare($q);
    $s->execute($onlySender !== '' ? [now() - 30 * 86400000, $onlySender] : [now() - 30 * 86400000]);
    $rows = $s->fetchAll();
    $seqs = [];
    $accts = [];
    $synced = [];
    $sentToday = [];
    $abCount = [];
    $live = [];
    foreach ($rows as $e) {
        $sid = (string) $e['seq'];
        if (!isset($seqs[$sid])) {
            $r = $p->prepare('SELECT * FROM sq_seq WHERE id = ?');
            $r->execute([$sid]);
            $row = $r->fetch();
            $seqs[$sid] = $row ? sqSeqRow($row) : null;
        }
        $S = $seqs[$sid];
        if (!$S) {
            continue;
        }
        $sender = (string) $e['sender'];
        if (!array_key_exists($sender, $live)) {
            $su = userRow($sender);
            $live[$sender] = $su && (string) $su['status'] === 'active' && sqMay($su);
        }
        if (!$live[$sender]) {
            // v83: a paused account, or one that no longer works the CRM: nothing goes out from its mailbox and its
            // inbox is not read (st stays, so the people go on when the account is back)
            if (in_array((string) $e['st'], ['active', 'error'], true) && (string) $e['why'] !== SQ_SENDER_OFF) {
                sqSetEnr((string) $e['id'], ['why' => SQ_SENDER_OFF]);
            }
            continue;
        }
        if (!array_key_exists($sender, $accts)) {
            $accts[$sender] = mymailAcct($sender);
        }
        $a = $accts[$sender];
        // replies and bounces: read the sender's inbox first (every live person, due or not)
        if ($a && !isset($synced[$sender])) {
            $synced[$sender] = sqSync($a);
        }
        [$stop, $why, $rep] = sqStopWhy($S, $e);
        if ((string) $e['st'] === 'finished') {
            // after the last step: only a reply or a bounce of the last email changes anything
            if ($stop === 'reply') {
                $out['replies'] += sqOnReply($S, $e, $rep) ? 1 : 0;
            } elseif ($stop === 'bounced') {
                sqSetEnr((string) $e['id'], ['st' => 'bounced', 'why' => $why]);
                sqEv($sid, (string) $e['id'], $sender, 'bounced', (int) $e['step'], $why);
            }
            continue;
        }
        if ($stop === 'reply') {
            if (sqOnReply($S, $e, $rep)) {
                $out['stopped']++;
                $out['replies']++;
                continue;
            }
            // out of office: they stay in, and the next email waits until they are back
            $out['ooo']++;
            $r = $p->prepare('SELECT * FROM sq_enr WHERE id = ?');
            $r->execute([(string) $e['id']]);
            $e = $r->fetch() ?: $e;
        } elseif ($stop !== '') {
            sqSetEnr((string) $e['id'], ['st' => $stop, 'why' => $why, 'next_at' => 0]);
            $p->prepare("UPDATE sq_task SET st = 'gone' WHERE enr = ? AND st = 'open'")->execute([(string) $e['id']]);
            sqEv($sid, (string) $e['id'], $sender, $stop, (int) $e['step'], $why);
            $out['stopped']++;
            continue;
        }
        if (in_array((string) $e['st'], ['task', 'paused'], true) || (int) $e['next_at'] > now() || $S['st'] !== 'active') {
            continue;
        }
        if ($out['sent'] + $out['tasks'] >= $max) {
            continue; // v83: the rest are still read for replies and bounces above, nothing more goes out
        }
        $step = $S['steps'][(int) $e['step']] ?? null;
        if (!$step) {
            sqSetEnr((string) $e['id'], ['st' => 'finished', 'next_at' => 0]);
            sqEv($sid, (string) $e['id'], $sender, 'finished');
            continue;
        }
        if ($step['kind'] === 'task') {
            if (!sqClaim($e)) {
                continue; // v83: another run took this step
            }
            $u = userRow($sender);
            $t = sqMerge((string) $step['task'], sqVars($e, $u ? ['name' => (string) $u['name'], 'email' => (string) $u['email'], 'id' => (string) $u['id']] : ['name' => '', 'email' => '']));
            sqTaskAdd($sid, (string) $e['id'], $sender, (int) $e['step'], $t, now());
            sqSetEnr((string) $e['id'], ['st' => 'task', 'next_at' => 0, 'why' => '']);
            sqEv($sid, (string) $e['id'], $sender, 'task', (int) $e['step'], $t);
            $out['tasks']++;
            continue;
        }
        if (sqWindowWhy($S['cfg'], (string) ($e['tz'] ?? '')) !== '') {
            $out['held']++;
            continue;
        }
        if (!$a) {
            sqSetEnr((string) $e['id'], ['st' => 'error', 'why' => 'The sender has no mailbox connected (My email).']);
            $out['errors']++;
            continue;
        }
        if (!isset($sentToday[$sender])) {
            $c = $p->prepare("SELECT COUNT(*) FROM sq_ev WHERE sender = ? AND kind = 'sent' AND at >= ?");
            $c->execute([$sender, sqLocal('')->setTime(0, 0)->getTimestamp() * 1000]);
            $sentToday[$sender] = (int) $c->fetchColumn();
        }
        if ($sentToday[$sender] >= (int) $S['cfg']['cap']) {
            $out['held']++;
            continue;
        }
        [$a2, $terr] = sqToken($a);
        if (!$a2) {
            sqSetEnr((string) $e['id'], ['st' => 'error', 'why' => 'The mailbox needs to be connected again (My email): ' . mb_substr($terr, 0, 160)]);
            $out['errors']++;
            continue;
        }
        $accts[$sender] = $a2;
        if (!sqClaim($e)) {
            continue; // v83: another run is sending this step (no second copy)
        }
        // A/B: the person's version is picked the first time a step with two versions goes to them
        if (sqVariant($step, $e) !== '' && !in_array((string) ($e['ab'] ?? ''), ['a', 'b'], true)) {
            $e['ab'] = sqAbPick($sid, $abCount);
            sqSetEnr((string) $e['id'], ['ab' => $e['ab']]);
        }
        $u = userRow($sender) ?? ['name' => '', 'email' => ''];
        $m = sqRender($S, (int) $e['step'], $e, ['name' => (string) $u['name'], 'email' => (string) $u['email'], 'id' => (string) $u['id']], $a2);
        $fromName = (string) ($a2['name'] !== '' ? $a2['name'] : $u['name']);
        $raw = mymailMime($fromName, (string) $a2['email'], [(string) $e['email']], [], [], $m['subj'], $m['body'], $m['inReplyTo']);
        // the one-click unsubscribe (RFC 8058) and a mailto fallback, next to the link in the message
        $one = rtrim(siteUrl(), '/') . '/api/index.php?r=unsub&t=' . $e['tok'];
        $raw = (string) preg_replace('/\r\nMIME-Version: 1\.0/', "\r\nList-Unsubscribe: <$one>, <mailto:" . $a2['email'] . "?subject=unsubscribe>\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\nMIME-Version: 1.0", $raw, 1);
        preg_match('/\r\nMessage-ID: (<[^>]+>)/', $raw, $mm);
        $GLOBALS['SE_FAIL_THROWS'] = true;
        try {
            [$okSend, $err] = mymailSendRaw($a2, $raw, [(string) $e['email']]);
        } catch (FailError $x) {
            [$okSend, $err] = [false, $x->getMessage()];
        } finally {
            $GLOBALS['SE_FAIL_THROWS'] = false;
        }
        $mid = rid(12);
        mymailDb()->prepare('INSERT INTO mail_user_msgs (id, uid, dir, at, from_email, from_name, to_email, cc, subject, text, snippet, msgid, thread, label, seen, starred, gid, err) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute([
            $mid, $sender, 'out', now(), (string) $a2['email'], $fromName, (string) $e['email'], '', mb_substr($m['subj'], 0, 500), $m['body'], mb_substr((string) preg_replace('/\s+/', ' ', $m['body']), 0, 300), (string) ($mm[1] ?? ''), '', '', 1, 0, '', $okSend ? '' : (string) $err,
        ]);
        if (!$okSend) {
            // v83: tried again later, waiting longer after each failed try at this step (2h, 4h, 8h, 16h, then daily),
            // not on every run; Resume sends right away
            $c = $p->prepare("SELECT COUNT(*) FROM sq_ev WHERE enr = ? AND kind = 'error' AND step = ?");
            $c->execute([(string) $e['id'], (int) $e['step']]);
            $tries = min(5, (int) $c->fetchColumn() + 1);
            sqSetEnr((string) $e['id'], ['st' => 'error', 'why' => 'Sending failed: ' . mb_substr((string) $err, 0, 200), 'next_at' => now() + min(24, 2 ** $tries) * 3600000]);
            sqEv($sid, (string) $e['id'], $sender, 'error', (int) $e['step'], (string) $err);
            $out['errors']++;
            continue;
        }
        $first = (int) $e['sent'] === 0;
        $nix = (int) $e['step'] + 1;
        sqSetEnr((string) $e['id'], [
            'st' => isset($S['steps'][$nix]) ? 'active' : 'finished', 'step' => $nix, 'next_at' => isset($S['steps'][$nix]) ? sqNextAt($S, $nix) : 0, 'last_at' => now(), 'sent' => (int) $e['sent'] + 1, 'why' => '', 'mid' => $mid,
        ] + ($first ? ['msgid' => (string) ($mm[1] ?? ''), 'subj' => mb_substr($m['subj'], 0, 300)] : []));
        sqEv($sid, (string) $e['id'], $sender, 'sent', (int) $e['step'], $m['subj'], $m['ab']);
        if (!isset($S['steps'][$nix])) {
            sqEv($sid, (string) $e['id'], $sender, 'finished', $nix);
        }
        $sentToday[$sender]++;
        $out['sent']++;
    }
    return $out;
}
/** The scheduled job's share: everyone's due work. */
function sqCron(): array
{
    $s = sqDb()->prepare("SELECT COUNT(*) FROM sq_enr WHERE st IN ('active', 'task', 'error', 'paused') OR (st = 'finished' AND cls = '' AND last_at > ?)");
    $s->execute([now() - 30 * 86400000]);
    return (int) $s->fetchColumn() ? sqRun('', 120) : ['sent' => 0, 'tasks' => 0, 'stopped' => 0, 'held' => 0, 'errors' => 0, 'ooo' => 0, 'replies' => 0];
}
/** An unsubscribe link from a sequence email: the address, or '' when the token is not one of ours. */
function sqTokEmail(string $tok): string
{
    if (!preg_match('/^sq[a-f0-9]{30}$/', $tok)) {
        return '';
    }
    $s = sqDb()->prepare('SELECT email FROM sq_enr WHERE tok = ?');
    $s->execute([$tok]);
    return (string) ($s->fetchColumn() ?: '');
}
/** Everyone with that address leaves every sequence (they unsubscribed). */
function sqUnsubscribed(string $email): void
{
    $p = sqDb();
    $s = $p->prepare("SELECT id, seq, sender, step FROM sq_enr WHERE email = ? AND st IN ('active', 'task', 'paused', 'error')");
    $s->execute([strtolower($email)]);
    foreach ($s->fetchAll() as $e) {
        sqSetEnr((string) $e['id'], ['st' => 'unsub', 'why' => 'Unsubscribed with the link', 'next_at' => 0]);
        $p->prepare("UPDATE sq_task SET st = 'gone' WHERE enr = ? AND st = 'open'")->execute([(string) $e['id']]);
        sqEv((string) $e['seq'], (string) $e['id'], (string) $e['sender'], 'unsub', (int) $e['step']);
    }
}
/** Add one person to a sequence (the checks were made by the caller); returns the new id. */
function sqEnrAdd(array $S, string $sender, string $email, string $n, string $co, string $ref, string $tz, string $src, int $t0, string $by, string $st = 'active', string $why = ''): string
{
    $id = rid(8);
    sqDb()->prepare("INSERT INTO sq_enr (id, seq, sender, email, n, co, ref, step, next_at, st, why, tok, at, by_uid, tz, src) VALUES (?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?)")->execute([$id, $S['id'], $sender, $email, $n, $co, $ref, $t0 + (int) $S['steps'][0]['wait'] * 86400000, $st, $why, 'sq' . rid(15), now(), $by, $tz, $src]);
    return $id;
}
/** Is the address on the do-not-email list ('' or why), or already in a live sequence? */
function sqBlocked(string $email): string
{
    require_once __DIR__ . '/mail.php';
    $s = mdb()->prepare('SELECT why FROM mail_suppress WHERE email = ?');
    $s->execute([$email]);
    if (($why = $s->fetchColumn()) !== false) {
        return 'on the do-not-email list (' . $why . ')';
    }
    $s = sqDb()->prepare("SELECT COUNT(*) FROM sq_enr WHERE email = ? AND st IN ('active', 'task', 'paused', 'error')");
    $s->execute([$email]);
    return (int) $s->fetchColumn() > 0 ? 'already in a sequence' : '';
}
/** A CRM lead or contact's time zone: its own (the website form records the visitor's), else its location's (a contact: its company's). */
function sqTzOfRecord(string $kind, stdClass $d): string
{
    $tz = sqTz((string) ($d->tz ?? ''));
    if ($tz !== '') {
        return $tz;
    }
    $loc = (string) ($d->loc ?? '');
    if ($loc === '' && $kind === 'con' && (string) ($d->acc ?? '') !== '') {
        $loc = (string) (docGet('crm/main/acc/' . (string) $d->acc)->loc ?? '');
    }
    return sqTzGuess($loc);
}
/** v46: a new website lead (the Request talent or Contact form) joins the sequence set to take them, from the lead owner's mailbox (or the sequence owner's). */
function sqAutoLead(string $leadId, string $form): void
{
    require_once __DIR__ . '/sso.php';
    $p = sqDb();
    $lead = docGet('crm/main/lead/' . $leadId);
    if (!$lead) {
        return;
    }
    $email = strtolower(trim((string) ($lead->e ?? '')));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return;
    }
    $pick = null;
    foreach ($p->query("SELECT * FROM sq_seq WHERE st = 'active' ORDER BY u DESC")->fetchAll() as $row) {
        $S = sqSeqRow($row);
        if (!empty($S['cfg']['auto']['on']) && in_array($form, (array) $S['cfg']['auto']['forms'], true)) {
            $pick = $S;
            break;
        }
    }
    if (!$pick || sqBlocked($email) !== '' || throttleHit('sqauto', 300, 86400)) {
        return;
    }
    $sender = $pick['owner'];
    $own = (string) ($lead->own ?? '');
    if ($pick['cfg']['auto']['who'] === 'owner' && $own !== '' && $own !== $sender && ($ou = userRow($own)) && (string) $ou['status'] === 'active' && sqMay($ou) && mymailAcct($own)) {
        $sender = $own;
    }
    $su = userRow($sender);
    if (!$su || (string) $su['status'] !== 'active' || !sqMay($su)) {
        return; // v83: the sequence owner is paused or no longer works the CRM
    }
    $box = (bool) mymailAcct($sender);
    // v83: the name and company the visitor typed go into the emails only as plain words (the CRM lead keeps the original)
    $id = sqEnrAdd($pick, $sender, $email, sqPlainWeb((string) ($lead->n ?? ''), 60, 4), sqPlainWeb((string) ($lead->co ?? ''), 60, 6), 'lead:' . $leadId, sqTzOfRecord('lead', $lead), 'auto', now(), 'web', $box ? 'active' : 'error', $box ? '' : 'The sender has no mailbox connected (My email).');
    sqEv($pick['id'], $id, $sender, 'added', 0, 'Website lead (' . ($form === 'talent' ? 'Request talent' : 'Contact') . ' form)');
}
function sqEnrView(array $e, ?array $S = null): array
{
    return [
        'id' => (string) $e['id'], 'seq' => (string) $e['seq'], 'sender' => (string) $e['sender'], 'email' => (string) $e['email'], 'n' => (string) $e['n'], 'co' => (string) $e['co'], 'ref' => (string) $e['ref'],
        'step' => (int) $e['step'], 'nSteps' => $S ? count($S['steps']) : 0, 'next' => (int) $e['next_at'], 'st' => (string) $e['st'], 'why' => (string) $e['why'], 'last' => (int) $e['last_at'], 'sent' => (int) $e['sent'], 'at' => (int) $e['at'],
        'ab' => (string) ($e['ab'] ?? ''), 'tz' => (string) ($e['tz'] ?? ''), 'src' => (string) ($e['src'] ?? ''), 'cls' => (string) ($e['cls'] ?? ''), 'rep' => (string) ($e['rep_txt'] ?? ''), 'repAt' => (int) ($e['rep_at'] ?? 0),
    ];
}
/** The numbers of one sequence: people by status, each step's emails, tasks and replies (by version when it has two), reply sorting. */
function sqStats(string $seq): array
{
    $p = sqDb();
    $by = [];
    $s = $p->prepare('SELECT st, COUNT(*) n FROM sq_enr WHERE seq = ? GROUP BY st');
    $s->execute([$seq]);
    foreach ($s->fetchAll() as $r) {
        $by[(string) $r['st']] = (int) $r['n'];
    }
    $steps = [];
    $ab = [];
    $s = $p->prepare("SELECT step, kind, ab, COUNT(*) n FROM sq_ev WHERE seq = ? AND kind IN ('sent', 'task', 'replied', 'ooo') GROUP BY step, kind, ab");
    $s->execute([$seq]);
    foreach ($s->fetchAll() as $r) {
        $k = (string) $r['kind'];
        $steps[(int) $r['step']][$k] = ($steps[(int) $r['step']][$k] ?? 0) + (int) $r['n'];
        if (in_array((string) $r['ab'], ['a', 'b'], true)) {
            $ab[(int) $r['step']][(string) $r['ab']][$k] = (int) $r['n'];
        }
    }
    $cls = [];
    $s = $p->prepare("SELECT cls, COUNT(*) n FROM sq_enr WHERE seq = ? AND cls <> '' GROUP BY cls");
    $s->execute([$seq]);
    foreach ($s->fetchAll() as $r) {
        $cls[(string) $r['cls']] = (int) $r['n'];
    }
    $total = array_sum($by);
    $s = $p->prepare("SELECT COUNT(DISTINCT enr) FROM sq_ev WHERE seq = ? AND kind = 'sent'");
    $s->execute([$seq]);
    $contacted = (int) $s->fetchColumn();
    $s = $p->prepare("SELECT COUNT(DISTINCT enr) FROM sq_ev WHERE seq = ? AND kind = 'replied'");
    $s->execute([$seq]);
    $replied = (int) $s->fetchColumn();
    return ['by' => $by, 'total' => $total, 'steps' => $steps, 'ab' => $ab, 'cls' => $cls, 'contacted' => $contacted, 'replied' => $replied, 'replyRate' => $contacted > 0 ? (int) round($replied / $contacted * 100) : 0];
}
/** One person's action (pause, resume, stop, replied, a time zone, a sorting); '' when done, else why not. */
function sqEnrAct(array $e, array $S, string $act, array $u, string $val = ''): string
{
    $p = sqDb();
    $live = in_array((string) $e['st'], SQ_LIVE, true);
    if ($act === 'tz') {
        $tz = $val === '' ? '' : sqTz($val);
        if ($val !== '' && $tz === '') {
            return 'unknown time zone';
        }
        sqSetEnr((string) $e['id'], ['tz' => $tz]);
        return '';
    }
    if ($act === 'sort') {
        if (!isset(SQ_CLS[$val]) || !in_array((string) $e['st'], ['replied', 'unsub'], true) || (string) $e['cls'] === '') {
            return 'only a sorted reply can be sorted again';
        }
        sqSetEnr((string) $e['id'], ['cls' => $val]);
        if ($val === 'unsub') {
            require_once __DIR__ . '/mail.php';
            mdb()->prepare('REPLACE INTO mail_suppress (email, at, why) VALUES (?, ?, ?)')->execute([strtolower((string) $e['email']), now(), 'asked by reply']);
        }
        sqEv((string) $e['seq'], (string) $e['id'], (string) $e['sender'], 'sorted', (int) $e['step'], SQ_CLS[$val] . ' (by ' . $u['name'] . ')');
        return '';
    }
    if (!$live && $act !== 'resume') {
        return 'already left the sequence';
    }
    if ($act === 'pause') {
        if (!in_array((string) $e['st'], ['active', 'task', 'error'], true)) {
            return 'not running';
        }
        sqSetEnr((string) $e['id'], ['st' => 'paused']);
    } elseif ($act === 'resume') {
        if (!in_array((string) $e['st'], ['paused', 'error'], true)) {
            return 'only a paused person (or one that needs attention) can be resumed';
        }
        // a call or LinkedIn task still open for this step: they wait on it again (no second task)
        $o = $p->prepare("SELECT COUNT(*) FROM sq_task WHERE enr = ? AND step = ? AND st = 'open'");
        $o->execute([(string) $e['id'], (int) $e['step']]);
        $st = (int) $o->fetchColumn() > 0 ? 'task' : (isset($S['steps'][(int) $e['step']]) ? 'active' : 'finished');
        // v83: a failed send waits before it is tried again; Resume tries it now
        $retry = str_starts_with((string) $e['why'], 'Sending failed:');
        sqSetEnr((string) $e['id'], ['st' => $st, 'why' => '', 'next_at' => $st === 'task' ? 0 : ($retry ? now() : max((int) $e['next_at'], now()))]);
    } elseif ($act === 'stop' || $act === 'replied') {
        sqSetEnr((string) $e['id'], ['st' => $act === 'stop' ? 'stopped' : 'replied', 'why' => $val !== '' ? $val : ($act === 'stop' ? 'Stopped by ' . $u['name'] : 'Marked as replied by ' . $u['name']), 'next_at' => 0] + ($act === 'replied' ? ['cls' => 'other', 'rep_at' => now()] : []));
        $p->prepare("UPDATE sq_task SET st = 'gone' WHERE enr = ? AND st = 'open'")->execute([(string) $e['id']]);
    } else {
        return 'unknown action';
    }
    if ($act === 'replied') {
        [$ls, $ab] = sqLastSent((string) $e['id']);
        sqEv((string) $e['seq'], (string) $e['id'], (string) $e['sender'], 'replied', $ls, 'Marked by ' . $u['name'], $ab);
    } else {
        sqEv((string) $e['seq'], (string) $e['id'], (string) $e['sender'], $act, (int) $e['step'], $val);
    }
    return '';
}
function sqSeqOf(string $id): array
{
    $r2 = sqDb()->prepare('SELECT * FROM sq_seq WHERE id = ?');
    $r2->execute([$id]);
    return sqSeqRow($r2->fetch() ?: ['id' => '', 'n' => '', 'owner' => '', 'shared' => 0, 'st' => 'archived', 'steps' => '[]', 'cfg' => '{}', 'at' => 0, 'u' => 0]);
}
function sqTplView(array $r, array $u): array
{
    return ['id' => (string) $r['id'], 'n' => (string) $r['n'], 'cat' => (string) $r['cat'], 'subj' => (string) $r['subj'], 'body' => (string) $r['body'], 'shared' => (int) $r['shared'] === 1, 'uses' => (int) $r['uses'], 'mine' => (string) $r['owner'] === $u['id'] || hasRole($u, 'admin'), 'ownerN' => (string) (userRow((string) $r['owner'])['name'] ?? ''), 'u' => (int) $r['u']];
}
/** The numbers for the Analytics tab: totals, each day, each step (one sequence), each sender, each sequence, the sorted replies. */
function sqAnalytics(array $u, string $seqId, int $days): array
{
    $p = sqDb();
    $admin = hasRole($u, 'admin');
    $since = $days > 0 ? now() - $days * 86400000 : 0;
    if ($seqId !== '') {
        $one = sqSeq($seqId, $u);
        $seqs = [$one['id'] => $one];
    } else {
        $seqs = [];
        $s = $p->prepare('SELECT * FROM sq_seq WHERE owner = ? OR shared = 1' . ($admin ? ' OR 1 = 1' : ''));
        $s->execute([$u['id']]);
        foreach ($s->fetchAll() as $row) {
            $seqs[(string) $row['id']] = sqSeqRow($row);
        }
    }
    // someone else's shared sequence counts only their own sending
    $full = [];
    $own = [];
    foreach ($seqs as $id => $S) {
        $admin || $S['owner'] === $u['id'] ? ($full[] = $id) : ($own[] = $id);
    }
    $where = '(' . ($full ? 'seq IN (' . implode(',', array_fill(0, count($full), '?')) . ')' : '1 = 0') . ($own ? ' OR (seq IN (' . implode(',', array_fill(0, count($own), '?')) . ') AND sender = ?)' : '') . ')';
    $args = array_merge($full, $own, $own ? [$u['id']] : []);
    $q = function (string $sql, array $extra = []) use ($p, $where, $args) {
        $s = $p->prepare(str_replace('{W}', $where, $sql));
        $s->execute(array_merge($args, $extra));
        return $s->fetchAll();
    };
    $tot = ['added' => 0, 'sent' => 0, 'contacted' => 0, 'replied' => 0, 'bounced' => 0, 'unsub' => 0, 'ooo' => 0, 'taskdone' => 0];
    foreach ($q("SELECT kind, COUNT(*) n, COUNT(DISTINCT enr) d FROM sq_ev WHERE {W} AND at >= ? GROUP BY kind", [$since]) as $r) {
        $k = (string) $r['kind'];
        if ($k === 'sent') {
            $tot['sent'] = (int) $r['n'];
            $tot['contacted'] = (int) $r['d'];
        } elseif (isset($tot[$k])) {
            $tot[$k] = $k === 'replied' ? (int) $r['d'] : (int) $r['n'];
        }
    }
    $tot['rate'] = $tot['contacted'] > 0 ? (int) round($tot['replied'] / $tot['contacted'] * 100) : 0;
    // each day (the company's calendar)
    $dayN = max(1, min($days > 0 ? $days : 365, 90));
    $tz = new DateTimeZone(sqCoTz());
    $daysOut = [];
    $start = sqLocal('')->setTime(0, 0)->modify('-' . ($dayN - 1) . ' days');
    for ($i = 0; $i < $dayN; $i++) {
        $daysOut[$start->modify('+' . $i . ' days')->format('Y-m-d')] = ['sent' => 0, 'replied' => 0];
    }
    foreach ($q("SELECT at, kind FROM sq_ev WHERE {W} AND at >= ? AND kind IN ('sent', 'replied')", [$start->getTimestamp() * 1000]) as $r) {
        $d = (new DateTimeImmutable('@' . intdiv((int) $r['at'], 1000)))->setTimezone($tz)->format('Y-m-d');
        if (isset($daysOut[$d])) {
            $daysOut[$d][(string) $r['kind']]++;
        }
    }
    // each sender
    $senders = [];
    foreach ($q("SELECT sender, kind, COUNT(*) n, COUNT(DISTINCT enr) d FROM sq_ev WHERE {W} AND at >= ? GROUP BY sender, kind", [$since]) as $r) {
        $id = (string) $r['sender'];
        $senders[$id] ??= ['id' => $id, 'n' => (string) (userRow($id)['name'] ?? 'Someone who left'), 'added' => 0, 'sent' => 0, 'contacted' => 0, 'replied' => 0, 'bounced' => 0, 'unsub' => 0, 'taskdone' => 0];
        $k = (string) $r['kind'];
        if ($k === 'sent') {
            $senders[$id]['sent'] = (int) $r['n'];
            $senders[$id]['contacted'] = (int) $r['d'];
        } elseif (isset($senders[$id][$k])) {
            $senders[$id][$k] = $k === 'replied' ? (int) $r['d'] : (int) $r['n'];
        }
    }
    foreach ($senders as &$x) {
        $x['rate'] = $x['contacted'] > 0 ? (int) round($x['replied'] / $x['contacted'] * 100) : 0;
    }
    unset($x);
    usort($senders, fn($a, $b) => $b['sent'] <=> $a['sent']);
    // each sequence
    $bySeq = [];
    foreach ($q("SELECT seq, kind, COUNT(*) n, COUNT(DISTINCT enr) d FROM sq_ev WHERE {W} AND at >= ? GROUP BY seq, kind", [$since]) as $r) {
        $id = (string) $r['seq'];
        if (!isset($seqs[$id])) {
            continue;
        }
        $bySeq[$id] ??= ['id' => $id, 'n' => $seqs[$id]['n'], 'st' => $seqs[$id]['st'], 'added' => 0, 'sent' => 0, 'contacted' => 0, 'replied' => 0];
        $k = (string) $r['kind'];
        if ($k === 'sent') {
            $bySeq[$id]['sent'] = (int) $r['n'];
            $bySeq[$id]['contacted'] = (int) $r['d'];
        } elseif (in_array($k, ['added', 'replied'], true)) {
            $bySeq[$id][$k] = $k === 'replied' ? (int) $r['d'] : (int) $r['n'];
        }
    }
    foreach ($bySeq as &$x) {
        $x['rate'] = $x['contacted'] > 0 ? (int) round($x['replied'] / $x['contacted'] * 100) : 0;
    }
    unset($x);
    usort($bySeq, fn($a, $b) => $b['sent'] <=> $a['sent']);
    // each step of one sequence (and its two versions)
    $steps = [];
    if ($seqId !== '') {
        $S = $seqs[$seqId];
        foreach ($S['steps'] as $i => $st) {
            $steps[$i] = ['i' => $i, 'kind' => $st['kind'], 'label' => $st['kind'] === 'email' ? (!empty($st['thread']) ? 'Follow-up in the thread' : (string) $st['subj']) : 'Task: ' . (string) $st['task'], 'sent' => 0, 'replied' => 0, 'task' => 0, 'taskdone' => 0, 'ooo' => 0, 'ab' => (trim((string) ($st['subjB'] ?? '')) !== '' || trim((string) ($st['bodyB'] ?? '')) !== '') ? ['a' => ['sent' => 0, 'replied' => 0, 'subj' => (string) $st['subj']], 'b' => ['sent' => 0, 'replied' => 0, 'subj' => (string) ($st['subjB'] ?? '') ?: (string) $st['subj']], 'win' => (string) ($st['win'] ?? '')] : null];
        }
        foreach ($q("SELECT step, kind, ab, COUNT(*) n FROM sq_ev WHERE {W} AND at >= ? GROUP BY step, kind, ab", [$since]) as $r) {
            $i = (int) $r['step'];
            $k = (string) $r['kind'];
            if (!isset($steps[$i]) || !in_array($k, ['sent', 'replied', 'task', 'taskdone', 'ooo'], true)) {
                continue;
            }
            $steps[$i][$k] += (int) $r['n'];
            if ($steps[$i]['ab'] && in_array((string) $r['ab'], ['a', 'b'], true) && in_array($k, ['sent', 'replied'], true)) {
                $steps[$i]['ab'][(string) $r['ab']][$k] += (int) $r['n'];
            }
        }
        foreach ($steps as &$x) {
            $x['rate'] = $x['sent'] > 0 ? (int) round($x['replied'] / $x['sent'] * 100) : 0;
            if ($x['ab']) {
                foreach (['a', 'b'] as $v) {
                    $x['ab'][$v]['rate'] = $x['ab'][$v]['sent'] > 0 ? (int) round($x['ab'][$v]['replied'] / $x['ab'][$v]['sent'] * 100) : 0;
                }
            }
        }
        unset($x);
        $steps = array_values($steps);
    }
    // the sorted replies (people who replied in the period)
    $cls = array_fill_keys(array_keys(SQ_CLS), 0);
    $s = $p->prepare("SELECT cls, COUNT(*) n FROM sq_enr WHERE $where AND cls <> '' AND rep_at >= ? GROUP BY cls");
    $s->execute(array_merge($args, [$since]));
    foreach ($s->fetchAll() as $r) {
        if (isset($cls[(string) $r['cls']])) {
            $cls[(string) $r['cls']] = (int) $r['n'];
        }
    }
    return ['tot' => $tot, 'days' => array_map(fn($d, $v) => ['d' => $d] + $v, array_keys($daysOut), array_values($daysOut)), 'senders' => array_values($senders), 'seqs' => array_values($bySeq), 'steps' => $steps, 'cls' => $cls, 'list' => array_map(fn($S) => ['id' => $S['id'], 'n' => $S['n'], 'st' => $S['st']], array_values($seqs))];
}

function sqRoute(string $r, array $b): never
{
    $u = requireUser();
    if (!sqMay($u)) {
        fail(403, 'forbidden', 'Sequences are for the people who work the CRM (HR, recruiting team, the CRM feature, administrators).');
    }
    require_once __DIR__ . '/sso.php';
    $p = sqDb();
    $str = fn(string $k, int $max) => mb_substr(trim((string) ($b[$k] ?? '')), 0, $max);
    $admin = hasRole($u, 'admin');
    switch ($r) {
        case 'sq_home':
            $s = $p->prepare('SELECT * FROM sq_seq WHERE (owner = ? OR shared = 1' . ($admin ? ' OR 1 = 1' : '') . ") AND st <> 'archived' ORDER BY u DESC");
            $s->execute([$u['id']]);
            $seqs = [];
            foreach ($s->fetchAll() as $row) {
                $S = sqSeqRow($row);
                $seqs[] = $S + ['stats' => sqStats($S['id']), 'ownerN' => (string) (userRow($S['owner'])['name'] ?? ''), 'mine' => $S['owner'] === $u['id']];
            }
            $a = mymailAcct($u['id']);
            $t = $p->prepare("SELECT COUNT(*) FROM sq_task WHERE uid = ? AND st = 'open' AND due <= ?");
            $t->execute([$u['id'], now()]);
            ok([
                'seqs' => $seqs, 'mailbox' => $a ? ['provider' => (string) $a['provider'], 'email' => (string) $a['email'], 'replies' => in_array($a['provider'], ['google', 'microsoft'], true)] : null, 'tasks' => (int) $t->fetchColumn(),
                'st' => SQ_ENR_ST, 'fields' => SQ_FIELDS, 'cfg' => SQ_CFG, 'me' => $u['id'], 'admin' => $admin, 'brand' => emailBrand()['text'],
                'cls' => SQ_CLS, 'tzs' => SQ_TZS, 'coTz' => sqCoTz(), 'hol' => SQ_HOL, 'holNext' => sqHolidaysNext(6),
            ]);

        case 'sq_get':
            $S = sqSeq($str('id', 20), $u);
            $all = $admin || $S['owner'] === $u['id'];
            // the newest 2000; 'more' says there are others, and q finds anyone in the whole sequence (name, company, address)
            $q = $str('q', 120);
            $w = 'seq = ?';
            $args = [$S['id']];
            if (!$all) {
                $w .= ' AND sender = ?';
                $args[] = $u['id'];
            }
            if ($q !== '') {
                $w .= " AND (email LIKE ? ESCAPE '!' OR n LIKE ? ESCAPE '!' OR co LIKE ? ESCAPE '!')";
                $l = '%' . strtr($q, ['!' => '!!', '%' => '!%', '_' => '!_']) . '%';
                array_push($args, $l, $l, $l);
            }
            $s = $p->prepare('SELECT * FROM sq_enr WHERE ' . $w . ' ORDER BY at DESC LIMIT 2001');
            $s->execute($args);
            $got = $s->fetchAll();
            $more = count($got) > 2000;
            $rows = array_map(fn($e) => sqEnrView($e, $S) + ['senderN' => (string) (userRow((string) $e['sender'])['name'] ?? '')], array_slice($got, 0, 2000));
            ok(['seq' => $S + ['stats' => sqStats($S['id']), 'mine' => $S['owner'] === $u['id'] || $admin], 'people' => $rows, 'more' => $more]);

        case 'sq_save':
            if (throttleHit('sqsave:' . $u['id'], 120, 3600)) {
                fail(429, 'slow_down', 'Too many changes in an hour.');
            }
            $id = $str('id', 20);
            $S = $id !== '' ? sqSeq($id, $u, true) : null;
            $n = $str('n', 120);
            if ($n === '') {
                fail(400, 'invalid_argument', 'Name the sequence.');
            }
            $steps = sqStepsIn($b['steps'] ?? []);
            $cfg = sqCfgIn($b['cfg'] ?? []);
            $st = in_array($b['st'] ?? '', ['active', 'paused', 'archived'], true) ? (string) $b['st'] : ($S['st'] ?? 'active');
            if ($S) {
                // people part-way through keep their place: a step removed from the end finishes them at the next run
                $p->prepare('UPDATE sq_seq SET n = ?, shared = ?, st = ?, steps = ?, cfg = ?, u = ? WHERE id = ?')->execute([$n, !empty($b['shared']) ? 1 : 0, $st, json_encode($steps), json_encode($cfg), now(), $S['id']]);
                $id = $S['id'];
            } else {
                $id = rid(8);
                $p->prepare('INSERT INTO sq_seq (id, n, owner, shared, st, steps, cfg, at, u) VALUES (?,?,?,?,?,?,?,?,?)')->execute([$id, $n, $u['id'], !empty($b['shared']) ? 1 : 0, $st, json_encode($steps), json_encode($cfg), now(), now()]);
            }
            ok(['seq' => sqSeq($id, $u)]);

        case 'sq_ab':
            // A/B: send the better version to everyone from now on (or test both again)
            $S = sqSeq($str('id', 20), $u, true);
            $ix = (int) ($b['step'] ?? -1);
            $win = in_array($b['win'] ?? '', ['a', 'b'], true) ? (string) $b['win'] : '';
            if (!isset($S['steps'][$ix]) || sqVariant($S['steps'][$ix], []) === '') {
                fail(400, 'invalid_argument', 'That step has one version.');
            }
            $S['steps'][$ix]['win'] = $win;
            $p->prepare('UPDATE sq_seq SET steps = ?, u = ? WHERE id = ?')->execute([json_encode($S['steps']), now(), $S['id']]);
            ok(['seq' => sqSeq($S['id'], $u)]);

        case 'sq_delete':
            $S = sqSeq($str('id', 20), $u, true);
            $s = $p->prepare('SELECT COUNT(*) FROM sq_enr WHERE seq = ?');
            $s->execute([$S['id']]);
            if ((int) $s->fetchColumn() > 0) {
                $p->prepare("UPDATE sq_seq SET st = 'archived', u = ? WHERE id = ?")->execute([now(), $S['id']]);
                $p->prepare("UPDATE sq_enr SET st = 'stopped', why = 'Sequence archived', next_at = 0 WHERE seq = ? AND st IN ('active', 'task', 'paused', 'error')")->execute([$S['id']]);
                ok(['archived' => true]);
            }
            $p->prepare('DELETE FROM sq_seq WHERE id = ?')->execute([$S['id']]);
            ok(['deleted' => true]);

        case 'sq_people':
            // CRM leads (not converted or unqualified) and contacts with an email, for "Add people"
            $q = mb_strtolower($str('q', 80));
            $live = [];
            $s = $p->query("SELECT email, seq FROM sq_enr WHERE st IN ('active', 'task', 'paused', 'error')");
            foreach ($s->fetchAll() as $row) {
                $live[(string) $row['email']] = true;
            }
            require_once __DIR__ . '/mail.php';
            $sup = [];
            foreach (mdb()->query('SELECT email FROM mail_suppress') as $row) {
                $sup[strtolower((string) $row['email'])] = true;
            }
            $accN = [];
            foreach (colAll('crm/main/acc') as [$aid, $acc]) {
                $accN[$aid] = (string) ($acc->n ?? '');
            }
            $out = [];
            foreach ([['lead', 'crm/main/lead'], ['con', 'crm/main/con']] as [$kind, $col]) {
                foreach (colAll($col) as [$cid, $d]) {
                    $email = strtolower(trim((string) ($d->e ?? '')));
                    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || ($kind === 'lead' && in_array((string) ($d->st ?? ''), ['Converted', 'Unqualified'], true))) {
                        continue;
                    }
                    $co = $kind === 'lead' ? (string) ($d->co ?? '') : ($accN[(string) ($d->acc ?? '')] ?? '');
                    $hay = mb_strtolower((string) ($d->n ?? '') . ' ' . $email . ' ' . $co);
                    if ($q !== '' && !str_contains($hay, $q)) {
                        continue;
                    }
                    $out[] = ['ref' => $kind . ':' . $cid, 'kind' => $kind, 'n' => (string) ($d->n ?? ''), 'email' => $email, 'co' => $co, 'ti' => (string) ($d->ti ?? ''), 'busy' => isset($live[$email]), 'sup' => isset($sup[$email])];
                    if (count($out) >= 200) {
                        break 2;
                    }
                }
            }
            ok(['people' => $out]);

        case 'sq_enroll':
            $S = sqSeq($str('id', 20), $u);
            if ($S['st'] !== 'active') {
                fail(409, 'conflict', 'This sequence is paused or archived.');
            }
            $a = mymailAcct($u['id']);
            if (!$a) {
                fail(400, 'invalid_argument', 'Connect your mailbox first (My email): sequence emails go out from it, and replies come back to it.');
            }
            if (throttleHit('sqenroll:' . $u['id'], 2000, 86400)) {
                fail(429, 'slow_down', 'That is a lot of people for one day.');
            }
            $start = $str('start', 10);
            $t0 = preg_match('/^\d{4}-\d{2}-\d{2}$/', $start) ? max(now(), (new DateTimeImmutable($start . ' 00:00:00', new DateTimeZone(sqCoTz())))->getTimestamp() * 1000) : now();
            $src0 = in_array($b['src'] ?? '', ['csv', 'paste'], true) ? (string) $b['src'] : 'paste';
            $tzAll = sqTz($str('tz', 40));
            $added = [];
            $skipped = [];
            $seen = [];
            $all = (array) ($b['people'] ?? []);
            foreach (array_slice($all, 0, 500) as $x) {
                $x = (array) $x;
                $email = strtolower(trim((string) ($x['email'] ?? '')));
                $ref = preg_match('/^(lead|con):[A-Za-z0-9_\-]{1,40}$/', (string) ($x['ref'] ?? '')) ? (string) $x['ref'] : '';
                $n = mb_substr(trim((string) ($x['n'] ?? '')), 0, 190);
                $co = mb_substr(trim((string) ($x['co'] ?? '')), 0, 190);
                $tz = sqTz((string) ($x['tz'] ?? '')) ?: sqTzGuess(mb_substr((string) ($x['loc'] ?? ''), 0, 120));
                if ($ref !== '') {
                    // a CRM record speaks for itself: its current name, email, company and time zone
                    [$kind, $rid] = explode(':', $ref, 2);
                    $d = docGet(($kind === 'lead' ? 'crm/main/lead/' : 'crm/main/con/') . $rid);
                    if (!$d) {
                        $skipped[] = ['email' => $email, 'why' => 'not in the CRM any more'];
                        continue;
                    }
                    $email = strtolower(trim((string) ($d->e ?? '')));
                    $n = (string) ($d->n ?? $n);
                    if ($kind === 'lead') {
                        $co = (string) ($d->co ?? $co);
                    } elseif ((string) ($d->acc ?? '') !== '') {
                        $co = (string) (docGet('crm/main/acc/' . (string) $d->acc)->n ?? $co);
                    }
                    $tz = $tz ?: sqTzOfRecord($kind, $d);
                }
                if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                    $skipped[] = ['email' => $email, 'why' => 'not a valid email address'];
                    continue;
                }
                if (isset($seen[$email])) {
                    continue;
                }
                $seen[$email] = true;
                if (($why = sqBlocked($email)) !== '') {
                    $skipped[] = ['email' => $email, 'why' => $why];
                    continue;
                }
                $id = sqEnrAdd($S, $u['id'], $email, $n, $co, $ref, $tz ?: $tzAll, $ref !== '' ? 'crm' : $src0, $t0, $u['id']);
                sqEv($S['id'], $id, $u['id'], 'added', 0, $email);
                $added[] = $email;
            }
            if (count($all) > 500) {
                // one summary row, so a caller that sent more learns about it (the page sends 500 at a time)
                $skipped[] = ['email' => '', 'why' => (count($all) - 500) . ' more left out: add at most 500 people at a time'];
            }
            ok(['added' => count($added), 'skipped' => $skipped]);

        case 'sq_enr':
            // pause, resume, stop, replied (by hand: a phone call or a reply to another address), remove (nothing sent
            // yet), a time zone, sorting a reply again
            $s = $p->prepare('SELECT * FROM sq_enr WHERE id = ?');
            $s->execute([$str('enr', 20)]);
            $e = $s->fetch();
            if (!$e || !((string) $e['sender'] === $u['id'] || $admin)) {
                fail(404, 'not_found', 'No such person in a sequence.');
            }
            // (the person's sequence, even when it is no longer shared with the sender)
            $S = sqSeqOf((string) $e['seq']);
            $act = (string) ($b['act'] ?? '');
            if ($act === 'remove') {
                if ((int) $e['sent'] > 0) {
                    fail(409, 'conflict', 'Emails already went out: stop it instead, so the record stays.');
                }
                $p->prepare('DELETE FROM sq_enr WHERE id = ?')->execute([(string) $e['id']]);
                $p->prepare('DELETE FROM sq_task WHERE enr = ?')->execute([(string) $e['id']]);
                ok(['ok' => true]);
            }
            if (!in_array($act, ['pause', 'resume', 'stop', 'replied', 'tz', 'sort'], true)) {
                fail(400, 'invalid_argument', 'Unknown action.');
            }
            $err = sqEnrAct($e, $S, $act, $u, $act === 'tz' ? $str('tz', 40) : ($act === 'sort' ? $str('cls', 12) : ''));
            if ($err !== '') {
                fail(409, 'conflict', $err === 'already left the sequence' ? 'This person has already left the sequence.' : ucfirst($err) . '.');
            }
            $s = $p->prepare('SELECT * FROM sq_enr WHERE id = ?');
            $s->execute([(string) $e['id']]);
            ok(['person' => sqEnrView($s->fetch(), $S)]);

        case 'sq_bulk':
            // the same actions for many people at once, and moving them to another sequence
            $ids = array_slice(array_values(array_unique(array_filter(array_map('strval', (array) ($b['enrs'] ?? [])), fn($x) => (bool) preg_match('/^[A-Za-z0-9_\-]{1,20}$/', $x)))), 0, 1000);
            $act = (string) ($b['act'] ?? '');
            if (!in_array($act, ['pause', 'resume', 'stop', 'replied', 'tz', 'move'], true) || !$ids) {
                fail(400, 'invalid_argument', 'Pick the people and what to do.');
            }
            $to = null;
            if ($act === 'move') {
                $to = sqSeq($str('to', 20), $u);
                if ($to['st'] !== 'active') {
                    fail(409, 'conflict', 'That sequence is paused or archived.');
                }
            }
            $done = 0;
            $skipped = [];
            $one = $p->prepare('SELECT * FROM sq_enr WHERE id = ?');
            foreach ($ids as $id) {
                $one->execute([$id]);
                $e = $one->fetch();
                if (!$e || !((string) $e['sender'] === $u['id'] || $admin)) {
                    $skipped[] = ['email' => $e ? (string) $e['email'] : $id, 'why' => 'not yours'];
                    continue;
                }
                $S = sqSeqOf((string) $e['seq']);
                if ($act === 'move') {
                    if ((string) $e['seq'] === $to['id']) {
                        $skipped[] = ['email' => (string) $e['email'], 'why' => 'already in that sequence'];
                        continue;
                    }
                    $err = sqEnrAct($e, $S, 'stop', $u, 'Moved to ' . $to['n'] . ' by ' . $u['name']);
                    if ($err === '') {
                        $nid = sqEnrAdd($to, (string) $e['sender'], (string) $e['email'], (string) $e['n'], (string) $e['co'], (string) $e['ref'], (string) $e['tz'], 'move', now(), $u['id']);
                        sqEv($to['id'], $nid, (string) $e['sender'], 'added', 0, 'Moved from ' . $S['n']);
                    }
                } else {
                    $err = sqEnrAct($e, $S, $act, $u, $act === 'tz' ? $str('tz', 40) : '');
                }
                if ($err !== '') {
                    $skipped[] = ['email' => (string) $e['email'], 'why' => $err];
                    continue;
                }
                $done++;
            }
            ok(['done' => $done, 'skipped' => $skipped]);

        case 'sq_tasks':
            $s = $p->prepare("SELECT t.*, e.email, e.n, e.co, e.cls, q.n seqn FROM sq_task t JOIN sq_enr e ON e.id = t.enr JOIN sq_seq q ON q.id = t.seq WHERE t.uid = ? AND t.st = 'open' ORDER BY t.due");
            $s->execute([$u['id']]);
            ok(['tasks' => array_map(fn($t) => ['id' => (string) $t['id'], 't' => (string) $t['t'], 'due' => (int) $t['due'], 'email' => (string) $t['email'], 'n' => (string) $t['n'], 'co' => (string) $t['co'], 'seqn' => (string) $t['seqn'], 'enr' => (string) $t['enr'], 'reply' => (int) $t['step'] < 0, 'cls' => (string) $t['cls']], $s->fetchAll()), 'now' => now()]);

        case 'sq_task':
            // done or skipped: the person moves on to the next step (a reply's task just closes)
            $s = $p->prepare("SELECT * FROM sq_task WHERE id = ? AND uid = ? AND st = 'open'");
            $s->execute([$str('task', 20), $u['id']]);
            $t = $s->fetch();
            if (!$t) {
                fail(404, 'not_found', 'No such open task.');
            }
            $done = ($b['act'] ?? '') !== 'skip';
            $p->prepare('UPDATE sq_task SET st = ?, done_at = ? WHERE id = ?')->execute([$done ? 'done' : 'skipped', now(), (string) $t['id']]);
            $s = $p->prepare('SELECT * FROM sq_enr WHERE id = ?');
            $s->execute([(string) $t['enr']]);
            $e = $s->fetch();
            if ($e && in_array((string) $e['st'], ['task', 'paused'], true) && (int) $t['step'] >= 0 && (int) $t['step'] === (int) $e['step']) {
                // only the task of the step they are on moves them on; a paused person stays paused at the next step
                $S = sqSeqOf((string) $e['seq']);
                $nix = (int) $e['step'] + 1;
                $f = ['step' => $nix, 'next_at' => isset($S['steps'][$nix]) ? sqNextAt($S, $nix) : 0];
                if ((string) $e['st'] === 'task') {
                    $f['st'] = isset($S['steps'][$nix]) ? 'active' : 'finished';
                }
                sqSetEnr((string) $e['id'], $f);
                sqEv((string) $e['seq'], (string) $e['id'], (string) $e['sender'], $done ? 'taskdone' : 'taskskip', (int) $e['step']);
            } elseif ($e && $done) {
                sqEv((string) $e['seq'], (string) $e['id'], (string) $e['sender'], 'taskdone', max(0, (int) $t['step']), 'Done: ' . mb_substr((string) $t['t'], 0, 120));
            }
            ok(['ok' => true]);

        case 'sq_preview':
            // a step as one person would get it (the first person given, or a made-up one), either version
            $S = $b['seq'] ?? null;
            if (is_array($S)) {
                $S = ['steps' => sqStepsIn($S['steps'] ?? []), 'cfg' => SQ_CFG];
            } else {
                $S = sqSeq($str('id', 20), $u);
            }
            $ix = max(0, min(count($S['steps']) - 1, (int) ($b['step'] ?? 0)));
            if ($S['steps'][$ix]['kind'] !== 'email') {
                fail(400, 'invalid_argument', 'That step is a task.');
            }
            $a = mymailAcct($u['id']) ?? [];
            $e = ['email' => $str('email', 190) ?: 'jordan.lee@example.com', 'n' => $str('n', 190) ?: 'Jordan Lee', 'co' => $str('co', 190) ?: 'Acme Corp', 'tok' => 'sqpreview', 'msgid' => '<first@example>', 'subj' => '', 'ab' => ($b['ab'] ?? '') === 'b' ? 'b' : 'a'];
            if (sqVariant($S['steps'][$ix], []) !== '') {
                // the version asked for, whichever goes to everyone now
                $S['steps'][$ix]['win'] = $e['ab'];
            }
            ok(['email' => sqRender($S, $ix, $e, ['name' => (string) $u['name'], 'email' => (string) $u['email'], 'id' => (string) $u['id']], $a) + ['from' => (string) ($a['email'] ?? $u['email'])]]);

        case 'sq_run':
            // "Send what is due now": the caller's own people (an administrator: everyone's)
            if (throttleHit('sqrun:' . $u['id'], 30, 3600)) {
                fail(429, 'slow_down', 'Try again in a few minutes.');
            }
            ok(sqRun($admin && !empty($b['all']) ? '' : $u['id'], 60));

        case 'sq_stats':
            $days = (int) ($b['days'] ?? 30);
            ok(sqAnalytics($u, $str('id', 20), in_array($days, [7, 30, 90, 365, 0], true) ? $days : 30));

        case 'sq_tpls':
            $s = $p->prepare('SELECT * FROM sq_tpl WHERE owner = ? OR shared = 1' . ($admin ? ' OR 1 = 1' : '') . ' ORDER BY cat, n');
            $s->execute([$u['id']]);
            ok(['tpls' => array_map(fn($r) => sqTplView($r, $u), $s->fetchAll()), 'starters' => SQ_STARTERS, 'fields' => SQ_FIELDS]);

        case 'sq_tpl_save':
            if (throttleHit('sqtpl:' . $u['id'], 120, 3600)) {
                fail(429, 'slow_down', 'Too many changes in an hour.');
            }
            $id = $str('id', 20);
            $n = $str('n', 120);
            $subj = $str('subj', 200);
            $body = mb_substr(trim((string) ($b['body'] ?? '')), 0, 8000);
            if ($n === '' || $body === '') {
                fail(400, 'invalid_argument', 'A template needs a name and a message.');
            }
            foreach ([$subj, $body] as $txt) {
                if (($bad = sqFieldsBad($txt, 'The template')) !== '') {
                    fail(400, 'invalid_argument', $bad);
                }
            }
            $cat = $str('cat', 40);
            if ($id !== '') {
                $s = $p->prepare('SELECT * FROM sq_tpl WHERE id = ?');
                $s->execute([$id]);
                $t = $s->fetch();
                if (!$t || !((string) $t['owner'] === $u['id'] || $admin)) {
                    fail(404, 'not_found', 'No such template (or it is a colleague\'s).');
                }
                $p->prepare('UPDATE sq_tpl SET n = ?, cat = ?, subj = ?, body = ?, shared = ?, u = ? WHERE id = ?')->execute([$n, $cat, $subj, $body, !empty($b['shared']) ? 1 : 0, now(), $id]);
            } else {
                $id = rid(8);
                $p->prepare('INSERT INTO sq_tpl (id, n, owner, shared, cat, subj, body, uses, at, u) VALUES (?,?,?,?,?,?,?,0,?,?)')->execute([$id, $n, $u['id'], !empty($b['shared']) ? 1 : 0, $cat, $subj, $body, now(), now()]);
            }
            $s = $p->prepare('SELECT * FROM sq_tpl WHERE id = ?');
            $s->execute([$id]);
            ok(['tpl' => sqTplView($s->fetch(), $u)]);

        case 'sq_tpl_del':
            $s = $p->prepare('SELECT owner FROM sq_tpl WHERE id = ?');
            $s->execute([$str('id', 20)]);
            $o = $s->fetchColumn();
            if ($o === false || !((string) $o === $u['id'] || $admin)) {
                fail(404, 'not_found', 'No such template (or it is a colleague\'s).');
            }
            $p->prepare('DELETE FROM sq_tpl WHERE id = ?')->execute([$str('id', 20)]);
            ok(['ok' => true]);

        case 'sq_tpl_use':
            $p->prepare('UPDATE sq_tpl SET uses = uses + 1 WHERE id = ?')->execute([$str('id', 20)]);
            ok(['ok' => true]);
    }
    fail(404, 'not_found', 'Unknown request.');
}
