<?php
declare(strict_types=1);
/*
  Accounting extras: the accounting settings (payment terms, invoice numbering, late fee, currencies, bank accounts,
  payment methods, sales-tax presets, reminder schedule, budgets) in org/acct/x/settings; recurring invoices in
  org/acct/recur, created as drafts when they fall due; payment reminders for open invoices, by hand or on the
  schedule; and the nightly job that runs both (cron.php and the web cron call acctCron()).
*/
const ACCT_DEFAULTS = [
    'prefix' => 'INV',
    'cur' => 'USD',
    'curs' => ['USD', 'INR'],
    'terms' => [['n' => 'Due on receipt', 'd' => 0], ['n' => 'Net 15', 'd' => 15], ['n' => 'Net 30', 'd' => 30], ['n' => 'Net 45', 'd' => 45], ['n' => 'Net 60', 'd' => 60]],
    'lateFee' => 0,
    'methods' => ['Bank transfer', 'ACH', 'Wire', 'Check', 'Card', 'UPI', 'Other'],
    'banks' => [],
    'taxes' => [],
    'remind' => [-3, 1, 7, 14, 30],
    'remindAuto' => false,
    'remindCc' => '',
    'budgets' => [],
    'cash' => 0,
];
function acctSettings(): array
{
    $d = docGet('org/acct/x/settings');
    $s = $d ? json_decode(json_encode($d), true) : [];
    $out = ACCT_DEFAULTS;
    foreach (ACCT_DEFAULTS as $k => $v) {
        if (array_key_exists($k, $s) && $s[$k] !== null && $s[$k] !== '') {
            $out[$k] = $s[$k];
        }
    }
    $out['prefix'] = preg_replace('/[^A-Za-z0-9\-]/', '', (string) $out['prefix']) ?: 'INV';
    $out['remind'] = array_values(array_unique(array_map('intval', array_filter((array) $out['remind'], 'is_numeric'))));
    sort($out['remind']);
    // v83: the reminder copy address is only ever a list of valid emails (it goes into the Cc header)
    $out['remindCc'] = implode(', ', array_filter(array_map('trim', explode(',', str_replace(["\r", "\n"], ',', (string) $out['remindCc']))), fn($x) => (bool) filter_var($x, FILTER_VALIDATE_EMAIL)));
    return $out;
}
function acctInvNext(): string
{
    return invNext();
}
function acctInvCalc(array $lines, float $taxp, float $disc): array
{
    $sub = 0.0;
    foreach ($lines as $l) {
        $sub += (float) ($l->q ?? 0) * (float) ($l->u ?? 0);
    }
    $sub = round($sub, 2);
    $tax = round($sub * $taxp / 100, 2);
    return ['sub' => $sub, 'tax' => $tax, 'total' => round(max(0, $sub + $tax - $disc), 2)];
}
/** The date a recurring invoice is due after $from: monthly on a day of the month, weekly, quarterly or yearly. */
function acctRecurNext(string $from, string $every, int $day): string
{
    $t = strtotime($from . ' 12:00:00') ?: time();
    if ($every === 'week') {
        return date('Y-m-d', strtotime('+1 week', $t));
    }
    $months = $every === 'quarter' ? 3 : ($every === 'year' ? 12 : 1);
    $y = (int) date('Y', $t);
    $m = (int) date('n', $t) + $months;
    while ($m > 12) {
        $m -= 12;
        $y++;
    }
    $d = max(1, min($day ?: (int) date('j', $t), (int) date('t', mktime(12, 0, 0, $m, 1, $y))));
    return sprintf('%04d-%02d-%02d', $y, $m, $d);
}
/** Make a draft invoice from a recurring template and move the template on to its next date. */
function acctRecurRun(string $tid, stdClass $t, string $byName): string
{
    $now = now();
    $issue = (string) ($t->next ?? '') ?: date('Y-m-d');
    $terms = (int) ($t->terms ?? 30);
    $lines = array_values(array_filter((array) ($t->lines ?? []), fn($l) => $l instanceof stdClass && trim((string) ($l->d ?? '')) !== ''));
    // round the rate (3 decimals, e.g. 8.875%) and the discount first, then work out the totals from exactly what is stored
    $taxp = round((float) ($t->taxp ?? 0), 3);
    $disc = round((float) ($t->disc ?? 0), 2);
    $c = acctInvCalc($lines, $taxp, $disc);
    $id = rid(10);
    $num = acctInvNext();
    $bill = $t->bill instanceof stdClass ? $t->bill : (object) ['co' => '', 'n' => '', 'e' => '', 'addr' => ''];
    // {month} and {year} in line descriptions become the period being billed
    $label = date('F Y', strtotime($issue . ' 12:00:00') ?: time());
    foreach ($lines as $l) {
        $l->d = str_replace(['{month}', '{year}', '{date}'], [$label, date('Y', strtotime($issue) ?: time()), $issue], (string) $l->d);
    }
    $doc = (object) [
        'num' => $num,
        'cur' => (string) ($t->cur ?? 'USD'),
        'cid' => (string) ($t->cid ?? ''),
        'bill' => (object) ['co' => (string) ($bill->co ?? ''), 'n' => (string) ($bill->n ?? ''), 'e' => (string) ($bill->e ?? ''), 'addr' => (string) ($bill->addr ?? '')],
        'issue' => $issue,
        'terms' => $terms,
        'due' => date('Y-m-d', strtotime($issue . " +$terms days") ?: time()),
        'period' => (object) ['f' => '', 't' => ''],
        'lines' => $lines,
        'taxp' => $taxp,
        'disc' => $disc,
        'sub' => $c['sub'],
        'tax' => $c['tax'],
        'total' => $c['total'],
        'paid' => 0,
        'notes' => (string) ($t->notes ?? ''),
        'pay' => (string) ($t->pay ?? ''),
        'st' => 'draft',
        'pays' => [],
        'tok' => '',
        'fid' => '',
        'recur' => $tid,
        'at' => $now,
        'by' => (string) ($t->by ?? ''),
        'byn' => $byName,
        'u' => $now,
        'log' => [(object) ['t' => $now, 'who' => $byName, 'ev' => 'Created from the recurring invoice "' . (string) ($t->t ?? '') . '"', 'ip' => '']],
    ];
    docSet("inv/$id", $doc);
    $t->last = $issue;
    $t->lastInv = $id;
    $t->next = acctRecurNext($issue, (string) ($t->every ?? 'month'), (int) ($t->day ?? 0));
    $t->made = (int) ($t->made ?? 0) + 1;
    if (!empty($t->until) && $t->next > (string) $t->until) {
        $t->st = 'done';
    }
    $t->u = $now;
    docSet("org/acct/recur/$tid", $t);
    return $id;
}
/** Every active recurring invoice whose date has come becomes a draft. Returns the invoice ids made. */
function acctRecurDue(): array
{
    $today = date('Y-m-d');
    $made = [];
    foreach (acctCol('org/acct/recur') as $tid => $t) {
        if ((string) ($t->st ?? 'active') !== 'active' || empty($t->next) || (string) $t->next > $today) {
            continue;
        }
        $n = 0;
        // catch up at most three missed periods, never silently a year's worth
        while ((string) ($t->st ?? 'active') === 'active' && (string) $t->next <= $today && $n < 3) {
            $made[] = acctRecurRun((string) $tid, $t, 'Scheduled');
            $n++;
        }
    }
    return $made;
}
function acctCol(string $col): array
{
    $s = db()->prepare('SELECT path, data FROM docs WHERE col = ?');
    $s->execute([$col]);
    $out = [];
    foreach ($s->fetchAll() as $row) {
        $d = json_decode($row['data']);
        if ($d instanceof stdClass) {
            $out[substr($row['path'], strrpos($row['path'], '/') + 1)] = $d;
        }
    }
    return $out;
}
/** Email a payment reminder for an open invoice to the address it was sent to, with the stored PDF when there is one. */
function acctRemind(string $id, stdClass $d, string $who, string $note, string $why): bool
{
    $to = strtolower(trim((string) ($d->to ?? $d->bill->e ?? '')));
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
        return false;
    }
    $S = acctSettings();
    if (empty($d->tok)) {
        $d->tok = rid(16);
    }
    $cur = (string) ($d->cur ?? 'USD');
    $bal = money(max(0, (float) ($d->total ?? 0) - (float) ($d->paid ?? 0)), $cur);
    $due = (string) ($d->due ?? '');
    $days = $due !== '' ? (int) floor((strtotime(date('Y-m-d')) - strtotime($due)) / 86400) : 0;
    $when = $due === '' ? '' : ($days > 0 ? "was due on $due, $days day" . ($days === 1 ? '' : 's') . ' ago' : ($days === 0 ? 'is due today' : 'is due on ' . $due));
    $link = siteUrl() . '#/invoice/' . $id . '/' . $d->tok;
    $subject = ($days > 0 ? 'Payment overdue: ' : 'Payment reminder: ') . "invoice {$d->num} ($bal)";
    $paras = array_values(array_filter([
        "This is a friendly reminder that invoice {$d->num} from StratEdge IT Consulting for $bal $when.",
        $note !== '' ? $note : '',
        (float) ($d->paid ?? 0) > 0 ? 'Thank you for the part payment already received; the amount above is the remaining balance.' : '',
        $days > 0 && (float) $S['lateFee'] > 0 ? 'Our terms allow a late fee of ' . rtrim(rtrim(number_format((float) $S['lateFee'], 2), '0'), '.') . '% per month on overdue balances.' : '',
        'If payment is already on its way, please ignore this note. The invoice is attached and can also be viewed online.',
    ]));
    $atts = [];
    if (!empty($d->fid) && is_file(cfg('files_dir') . '/' . $d->fid)) {
        $atts[] = ['name' => (string) ($d->fn ?: $d->num . '.pdf'), 'type' => 'application/pdf', 'data' => (string) fileRead((string) $d->fid)];
    }
    $ok = sendMail($to, (string) ($d->bill->n ?? ''), $subject, implode("\n\n", $paras) . "\n\nView online: $link", emailHtml($subject, $paras, ['View invoice', $link], 'Questions about this invoice? Reply to this email.'), $atts, (string) (acctFromEmail()), (string) ($S['remindCc'] ?? ''));
    $now = now();
    $log = (array) ($d->log ?? []);
    $log[] = (object) ['t' => $now, 'who' => $who, 'ev' => ($ok ? 'Reminder emailed to ' : 'Reminder failed to ') . $to . ' (' . $why . ')', 'ip' => ''];
    $d->log = $log;
    $rem = (array) ($d->rem ?? []);
    $rem[] = (object) ['at' => $now, 'why' => $why, 'ok' => $ok, 'to' => $to];
    $d->rem = $rem;
    $d->remAt = $now;
    $d->u = $now;
    docSet("inv/$id", $d);
    if (!empty($d->cid)) {
        docSet("pub/{$d->cid}/inv/$id", invMirror($d, $id));
    }
    return $ok;
}
function acctFromEmail(): string
{
    $s = docGet('org/main/x/settings');
    $e = (string) ($s->inv->email ?? '');
    return filter_var($e, FILTER_VALIDATE_EMAIL) ? $e : '';
}
/** On the schedule in the settings (days before or after the due date), open invoices get a reminder once per step. */
function acctRemindDue(): array
{
    $S = acctSettings();
    if (empty($S['remindAuto']) || !$S['remind']) {
        return ['sent' => 0, 'skipped' => 'off'];
    }
    $today = strtotime(date('Y-m-d'));
    $sent = 0;
    $tried = 0;
    foreach (acctCol('inv') as $id => $d) {
        if (!in_array((string) ($d->st ?? ''), ['sent', 'viewed', 'part'], true) || empty($d->due) || empty($d->to)) {
            continue;
        }
        $days = (int) floor(($today - strtotime((string) $d->due)) / 86400); // positive = overdue
        $doneSteps = [];
        foreach ((array) ($d->rem ?? []) as $r) {
            if (preg_match('/^step:(-?\d+)$/', (string) ($r->why ?? ''), $m)) {
                $doneSteps[(int) $m[1]] = true;
            }
        }
        // the latest step that has come, if it was not sent yet (missed steps are not sent late in a burst)
        $step = null;
        foreach ($S['remind'] as $s) {
            if ($days >= (int) $s) {
                $step = (int) $s;
            }
        }
        if ($step === null || isset($doneSteps[$step]) || $days > $step + 2) {
            continue;
        }
        $tried++;
        if (acctRemind((string) $id, $d, 'Scheduled', '', 'step:' . $step)) {
            $sent++;
        }
    }
    return ['sent' => $sent, 'tried' => $tried];
}
/** Called by cron.php and the web cron once per run; cheap when there is nothing to do. */
function acctCron(): array
{
    $out = ['recurring' => 0, 'reminders' => 0];
    try {
        $out['recurring'] = count(acctRecurDue());
    } catch (Throwable $e) {
        $out['recurring_error'] = $e->getMessage();
    }
    try {
        $r = acctRemindDue();
        $out['reminders'] = (int) ($r['sent'] ?? 0);
        $out['reminders_tried'] = (int) ($r['tried'] ?? 0);
    } catch (Throwable $e) {
        $out['reminders_error'] = $e->getMessage();
    }
    return $out;
}
function acctStaff(bool $write = true): array
{
    $u = requireUser();
    if (!can('org/acct', 'w')) {
        fail(403, 'forbidden', 'Accounting is for administrators and the accounts team.');
    }
    // v83: org/acct itself is not a books record; probe one below it so view-only and reports-only bookkeepers
    // are held to their level
    if ($write && !can('org/acct/x', 'w')) {
        fail(403, 'forbidden', 'Your access to the books is view-only.');
    }
    return $u;
}
function acctRoute(string $r, string $method, array $b): never
{
    switch ($r) {
        case 'acct_recur_run':
            $u = acctStaff();
            $tid = str($b, 'id', 40);
            $t = docGet('org/acct/recur/' . $tid);
            if (!$t) {
                fail(404, 'not_found', 'No such recurring invoice.');
            }
            $id = acctRecurRun($tid, $t, (string) $u['name']);
            ok(['id' => $id, 'next' => $t->next]);
        case 'inv_remind':
            $u = acctStaff();
            $id = str($b, 'id', 40);
            $d = docGet("inv/$id");
            if (!$d) {
                fail(404, 'not_found', 'No such invoice.');
            }
            if (!in_array((string) ($d->st ?? ''), ['sent', 'viewed', 'part'], true)) {
                fail(400, 'invalid_state', 'Reminders go out for invoices that have been sent and are still open.');
            }
            $to = strtolower(trim((string) ($d->to ?? $d->bill->e ?? '')));
            if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
                fail(400, 'invalid_argument', 'This invoice has no email address to remind. Send it by email first.');
            }
            $ok = acctRemind($id, $d, (string) $u['name'], str($b, 'note', 2000), 'by hand');
            ok(['mailed' => $ok, 'to' => $to]);
        case 'acct_next_num':
            acctStaff(); // v83: was any staff login (HR too); resetting the numbering changes the books
            $n = max(1, min(999999, (int) ($b['n'] ?? 1)));
            $y = date('Y');
            $k = "inv$y";
            $p = db();
            if (!$p->query("SELECT v FROM meta WHERE k='$k'")->fetch()) {
                $p->exec("INSERT INTO meta (k, v) VALUES ('$k', 0)");
            }
            // v83: never hand out a number an invoice of this year already carries (moving back after deleting
            // test invoices still works)
            $pre = acctSettings()['prefix'] . "-$y-";
            $used = 0;
            foreach (acctCol('inv') as $d) {
                $num = (string) ($d->num ?? '');
                if (str_starts_with($num, $pre) && ctype_digit(substr($num, strlen($pre)))) {
                    $used = max($used, (int) substr($num, strlen($pre)));
                }
            }
            if ($n <= $used) {
                fail(400, 'invalid_argument', sprintf('%s%04d is already on an invoice. Choose %d or higher.', $pre, $used, $used + 1));
            }
            $p->prepare("UPDATE meta SET v = ? WHERE k = '$k'")->execute([$n - 1]);
            ok(['next' => sprintf('%s-%s-%04d', acctSettings()['prefix'], $y, $n)]);
        case 'acct_next_peek':
            acctStaff(false);
            $y = date('Y');
            $n = (int) (db()->query("SELECT v FROM meta WHERE k='inv$y'")->fetchColumn() ?: 0) + 1;
            ok(['next' => sprintf('%s-%s-%04d', acctSettings()['prefix'], $y, $n), 'n' => $n]);
        /* Bank statement rows (already parsed by the browser) are stored once each; the same row imported again is skipped. */
        case 'acct_bank_import':
            $u = acctStaff();
            $rows = is_array($b['rows'] ?? null) ? $b['rows'] : [];
            if (!$rows || count($rows) > 5000) {
                fail(400, 'invalid_argument', 'Send between 1 and 5000 rows.');
            }
            $acct = str($b, 'acct', 80);
            $src = str($b, 'src', 120);
            $known = [];
            foreach (acctCol('org/acct/bank') as $d) {
                if (!empty($d->key)) {
                    $known[(string) $d->key] = true;
                }
            }
            $added = 0;
            $skipped = 0;
            $now = now();
            foreach ($rows as $row) {
                if (!is_array($row)) {
                    continue;
                }
                $dt = (string) ($row['dt'] ?? '');
                $a = round((float) ($row['a'] ?? 0), 2);
                $desc = trim(mb_substr((string) ($row['desc'] ?? ''), 0, 300));
                if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $dt) || $a == 0.0) {
                    $skipped++;
                    continue;
                }
                $ref = trim(mb_substr((string) ($row['ref'] ?? ''), 0, 120));
                // OFX/QFX files carry the bank's own transaction id (FITID): the surest guard against importing a
                // statement twice; CSV rows fall back to date + description + amount + reference
                $fitid = trim(mb_substr((string) ($row['fitid'] ?? ''), 0, 120));
                $key = $fitid !== '' ? md5('fitid|' . $acct . '|' . $fitid) : md5($acct . '|' . $dt . '|' . mb_strtolower($desc) . '|' . number_format($a, 2, '.', '') . '|' . $ref);
                if (isset($known[$key])) {
                    $skipped++;
                    continue;
                }
                $known[$key] = true;
                $cur = strtoupper(trim((string) ($row['cur'] ?? '')));
                docSet('org/acct/bank/' . rid(10), (object) [
                    'dt' => $dt,
                    'desc' => $desc,
                    'a' => $a,
                    'ref' => $ref,
                    'bal' => isset($row['bal']) && is_numeric($row['bal']) ? round((float) $row['bal'], 2) : null,
                    'cur' => preg_match('/^[A-Z]{3}$/', $cur) ? $cur : (string) (acctSettings()['cur']),
                    'acct' => $acct,
                    'src' => $src,
                    'key' => $key,
                    'fitid' => $fitid !== '' ? $fitid : null,
                    'payee' => trim(mb_substr((string) ($row['payee'] ?? ''), 0, 120)),
                    'ref2' => trim(mb_substr((string) ($row['type'] ?? ''), 0, 20)),
                    'm' => null,
                    'cat' => '',
                    'excl' => false,
                    'at' => $now,
                    'by' => $u['id'],
                    'u' => $now,
                ]);
                $added++;
            }
            ok(['added' => $added, 'skipped' => $skipped]);
        /* v83: one bank deposit recorded on one invoice, read and written under the write lock, so two quick matches
         * (or two people matching at once) no longer rebuild the payments from a stale copy and lose one. */
        case 'acct_bank_match':
            $u = acctStaff();
            $rid = (string) preg_replace('/[^A-Za-z0-9_\-]/', '', str($b, 'row', 40));
            $iid = (string) preg_replace('/[^A-Za-z0-9_\-]/', '', str($b, 'inv', 40));
            $note = str($b, 'note', 200);
            if ($rid === '' || $iid === '' || !can('inv/' . $iid, 'w') || !can('org/acct/bank/' . $rid, 'w')) {
                fail(403, 'forbidden', 'You can\'t record this payment.');
            }
            [$res, $before, $after] = dbBatch(function () use ($rid, $iid, $note, $u) {
                nextSeq(); // a write first, so the lock is held before anything is read (SQLite and MySQL)
                $row = docGet('org/acct/bank/' . $rid);
                if (!$row) {
                    fail(404, 'not_found', 'No such bank row.');
                }
                if (!empty($row->m)) {
                    fail(409, 'already_matched', 'This bank row is already matched. The list will refresh.');
                }
                $inv = docGet('inv/' . $iid);
                if (!$inv) {
                    fail(404, 'not_found', 'Invoice not found.');
                }
                $amt = round((float) ($row->a ?? 0), 2);
                if (!($amt > 0)) {
                    fail(400, 'invalid_argument', 'Only money in can be matched to an invoice.');
                }
                $before = json_decode(json_encode($inv));
                $now = now();
                $cur = (string) ($inv->cur ?? 'USD');
                $ref = (string) ($row->ref ?? '');
                $paid = round((float) ($inv->paid ?? 0) + $amt, 2);
                $st = $paid >= (float) ($inv->total ?? 0) - 0.005 ? 'paid' : 'part';
                $wasDraft = (string) ($inv->st ?? '') === 'draft';
                $pays = array_values((array) ($inv->pays ?? []));
                $pays[] = (object) ['a' => $amt, 'dt' => (string) ($row->dt ?? ''), 'm' => 'Bank transfer', 'ref' => $ref !== '' ? $ref : mb_substr((string) ($row->desc ?? ''), 0, 40), 'at' => $now, 'bank' => $rid];
                $log = array_values((array) ($inv->log ?? []));
                $log[] = (object) ['t' => $now, 'who' => (string) $u['name'], 'ev' => 'Payment matched from the bank statement: ' . money($amt, $cur) . ($ref !== '' ? ' (' . $ref . ')' : ''), 'ip' => ''];
                $after = json_decode(json_encode($inv));
                $after->paid = $paid;
                $after->st = $st;
                $after->pays = $pays;
                $after->log = $log;
                $after->u = $now;
                // closed periods stay closed (a payment dated after the close is allowed, as with any record write)
                booksGuard('inv/' . $iid, (object) ['paid' => $paid, 'st' => $st, 'pays' => $pays, 'log' => $log, 'u' => $now], $after);
                $rowAfter = json_decode(json_encode($row));
                $rowAfter->m = (object) ['k' => 'inv', 'id' => $iid, 'n' => (string) ($inv->num ?? $iid), 'at' => $now, 'note' => $note];
                $rowAfter->u = $now;
                booksGuard('org/acct/bank/' . $rid, (object) ['m' => $rowAfter->m, 'u' => $now], $rowAfter);
                docSet('inv/' . $iid, $after);
                if (!empty($after->cid) && !$wasDraft) {
                    $pp = 'pub/' . $after->cid . '/inv/' . $iid;
                    $pub = docGet($pp);
                    if ($pub) {
                        $pub->paid = $paid;
                        $pub->st = $st;
                        $pub->u = $now;
                        docSet($pp, $pub);
                    } else {
                        docSet($pp, invMirror($after, $iid));
                    }
                }
                docSet('org/acct/bank/' . $rid, $rowAfter);
                return [['st' => $st, 'paid' => $paid, 'num' => (string) ($inv->num ?? $iid)], $before, $after];
            });
            require_once __DIR__ . '/payroll.php';
            auditLog('change', 'inv/' . $iid, 'Record changed', auditDiff($before, $after));
            ok($res);
        case 'acct_cron':
            // "run the scheduled jobs now": recurring invoices due today and scheduled reminders
            acctStaff();
            ok(acctCron());
        default:
            fail(404, 'not_found', 'Unknown action.');
    }
}
