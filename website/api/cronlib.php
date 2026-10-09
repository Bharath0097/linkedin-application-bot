<?php
declare(strict_types=1);
/*
 * v35: the scheduled work, shared by the command-line cron job (api/cron.php) and the web link for hosts without cron
 * (api/index.php?r=jobs_cron&key=..., shown under Admin > Job portals > Sources). Until v34 the web link only collected
 * jobs and sent email: backups, the daily security check (file integrity, the audit seal), file encryption, retention,
 * reminders, the service desk and messages ran from the command line only. Every run is recorded (secKv cron_at) so
 * Monitoring and the SOC 2 readiness page can tell when the scheduled task is not running.
 */
require_once __DIR__ . '/jobs.php';
require_once __DIR__ . '/mail.php';

/** Runs everything that is due and returns one line per task that did something. */
function cronAll(bool $cli): array
{
    $t0 = microtime(true);
    // v83: scheduled work never runs on StratEdge's inherited recruiting setup (connectors.php cxStore), however it
    // was started: cron.php (--ws), the provider's ws_cron call, or a workspace's own jobs_cron link
    $GLOBALS['SE_WS_CRON'] = true;
    // one run at a time (a command-line run collecting jobs can take up to 14 minutes)
    $lock = secKv('cron_lock');
    if (is_array($lock) && (int) $lock['at'] > now() - 15 * 60000) {
        return ['another scheduled run is still working (started ' . gmdate('H:i', (int) ($lock['at'] / 1000)) . ' UTC)'];
    }
    secKvSet('cron_lock', ['at' => now(), 'via' => $cli ? 'cli' : 'web']);
    $log = [];
    try {
        $out = jobCron($cli);
        $log[] = ' jobs: ' . $out['message'];
        require_once __DIR__ . '/tools.php';
        $bounce = mailBounceSync(false);
        if ($bounce['ran']) {
            $log[] = ' bounces: ' . $bounce['msg'];
        }
        require_once __DIR__ . '/acct.php';
        $acct = acctCron();
        if ($acct['recurring'] || $acct['reminders'] || $acct['reminders_tried'] || isset($acct['recurring_error']) || isset($acct['reminders_error'])) {
            $log[] = ' accounting: ' . json_encode($acct);
        }
        require_once __DIR__ . '/plaid.php';
        $bank = plaidSyncAll(true);
        if ($bank['items']) {
            $log[] = ' bank: ' . json_encode($bank);
        }
        require_once __DIR__ . '/qbo.php';
        $qbo = qboCron();
        if ($qbo['ran']) {
            $log[] = ' quickbooks: ' . json_encode($qbo);
        }
        require_once __DIR__ . '/comp.php';
        $comp = compCron();
        if ($comp['sent']) {
            $log[] = ' compliance reminders: ' . json_encode($comp);
        }
        // v46: sequences: replies and unsubscribes first, then each person's next email or task when it is due
        try {
            require_once __DIR__ . '/seq.php';
            $sq = sqCron();
            if ($sq['sent'] || $sq['tasks'] || $sq['stopped'] || $sq['errors'] || !empty($sq['replies']) || !empty($sq['ooo'])) {
                $log[] = ' sequences: ' . json_encode($sq);
            }
        } catch (Throwable $e) {
            $log[] = ' sequences failed: ' . $e->getMessage();
        }
        // v73/v74: vendor requirement auto-reply queue and scheduled 9/10/3 ET follow-ups.
        try {
            require_once __DIR__ . '/vms.php';
            require_once __DIR__ . '/vmsagent.php';
            $va = vmaCron();
            if (!empty($va['sent']) || !empty($va['tailored']) || !empty($va['follow']) || !empty($va['review']) || !empty($va['error'])) $log[] = ' vendor agent: ' . json_encode($va);
        } catch (Throwable $e) { $log[] = ' vendor agent failed: ' . $e->getMessage(); }
        // v80: scheduled Ceipal/Oorwin pulls (jobs -> requirements desk, candidates -> consultant database)
        try {
            require_once __DIR__ . '/atc.php';
            $atc = atcCron();
            if ($atc) { $log[] = ' ceipal/oorwin: ' . json_encode($atc); }
        } catch (Throwable $e) { $log[] = ' ceipal/oorwin failed: ' . $e->getMessage(); }
        // v80: refresh the consultant-match summary on open requirements (so imported/new ones show their best fits)
        try {
            require_once __DIR__ . '/vms.php';
            $ms = vmsMatchSweep($cli ? 40 : 12);
            if (!empty($ms['matched'])) { $log[] = ' requirement matches: ' . $ms['matched']; }
        } catch (Throwable $e) { $log[] = ' requirement matches failed: ' . $e->getMessage(); }
        // v45.3: signature requests: reminders and expiry (at most once an hour)
        try {
            require_once __DIR__ . '/esign.php';
            $es = esCron();
            if ($es['reminded'] || $es['expired']) {
                $log[] = ' signature reminders: ' . $es['reminded'] . ', expired: ' . $es['expired'];
            }
        } catch (Throwable $e) {
            $log[] = ' signature reminders failed: ' . $e->getMessage();
        }
        // v45: immigration case steps due within a week or overdue (once a day)
        try {
            require_once __DIR__ . '/imm.php';
            $im = imCron();
            if ($im['sent']) {
                $log[] = ' immigration case reminders: ' . $im['sent'];
            }
        } catch (Throwable $e) {
            $log[] = ' immigration case reminders failed: ' . $e->getMessage();
        }
        // v32: payment reminders for students and outside consultants paying by hand (Stripe charges the others itself)
        require_once __DIR__ . '/billing.php';
        $bill = billCron();
        if ($bill['sent']) {
            $log[] = ' payment reminders: ' . $bill['sent'];
        }
        // v31: careers postings of requirements that were filled or closed on the desk come down
        require_once __DIR__ . '/reqshare.php';
        $closed = rsSweep();
        if ($closed) {
            $log[] = ' requirement postings closed: ' . $closed;
        }
        // v37.2: recruiters behind their target on a requisition, a day before the date and the day after
        try {
            require_once __DIR__ . '/atsreq.php';
            $ar = atsReqCron();
            if (!empty($ar['sent'])) {
                $log[] = ' requisition reminders: ' . $ar['sent'];
            }
        } catch (Throwable $e) {
            $log[] = ' requisition reminders failed: ' . $e->getMessage();
        }
        // v37.3: profile update requests: reminders near the date, old decided requests cleared of their values
        try {
            require_once __DIR__ . '/hrq.php';
            $hq = hrqCron();
            if (!empty($hq['sent']) || !empty($hq['purged'])) {
                $log[] = ' profile update requests: ' . json_encode(array_intersect_key($hq, array_flip(['sent', 'purged'])));
            }
        } catch (Throwable $e) {
            $log[] = ' profile update requests failed: ' . $e->getMessage();
        }
        // v39: phone recordings past the days they are kept are deleted on Twilio; call summaries still due are written
        try {
            if (docGet('sec/x/phone/cfg')) {
                require_once __DIR__ . '/phone.php';
                $ph = phCron();
                if ($ph['deleted'] || $ph['summaries']) {
                    $log[] = ' phone: ' . json_encode($ph);
                }
            }
        } catch (Throwable $e) {
            $log[] = ' phone failed: ' . $e->getMessage();
        }
        // v41: interviews in Google Calendar or Outlook: the guests' answers, and interviews moved or cancelled there
        try {
            require_once __DIR__ . '/cal.php';
            $cs = calCron($cli ? 120 : 40);
            if ($cs['checked'] || $cs['errors']) {
                $log[] = ' calendars: ' . json_encode($cs);
            }
        } catch (Throwable $e) {
            $log[] = ' calendars failed: ' . $e->getMessage();
        }
        // v37.4: workspace sign-up requests (StratEdge's own site): unconfirmed ones go after 7 days, decided ones
        // after 180; a confirmed one waiting 2 days reminds the administrators once
        if (wsSlug() === '') {
            try {
                require_once __DIR__ . '/wsjoin.php';
                $wj = wsjCron();
                if (!empty($wj['purged']) || !empty($wj['nudged'])) {
                    $log[] = ' workspace sign-up requests: ' . json_encode(array_intersect_key($wj, array_flip(['purged', 'nudged'])));
                }
            } catch (Throwable $e) {
                $log[] = ' workspace sign-up requests failed: ' . $e->getMessage();
            }
        }
        // v33: the screening agent: new candidates, reminders, emailed resumes and replies
        require_once __DIR__ . '/agent.php';
        $ag = $cli ? agSweep(240, 25) : agSweep(60, 8);
        if ($ag['queued'] || $ag['screened'] || $ag['reminded'] || $ag['inbox'] || $ag['evaluated'] || $ag['docs']) {
            $log[] = ' screening agent: ' . json_encode($ag);
        }
        // v33: talent search: the index follows what changed; saved searches with alerts email their new matches
        try {
            require_once __DIR__ . '/talent.php';
            $ts = tsIndex(120);
            $tsA = tsAlerts();
            // v36.1: the Dice profiles of people Talent search saved into the ATS, read within the daily allowance
            require_once __DIR__ . '/tsdice.php';
            $tsD = tsDiceDrain($cli ? 120 : 40, $cli ? 40 : 12);
            // v36.2: the resumes of people Talent search saved into the ATS
            $tsR = tsResDrain($cli ? 120 : 30, $cli ? 1000 : 200);
            if ($ts['changed'] || $ts['removed'] || $tsA || $tsD['done'] || $tsD['err'] !== '' || $tsR['done']) {
                $log[] = ' talent search: ' . json_encode($ts + ['alerts' => $tsA, 'dice' => array_intersect_key($tsD, array_flip(['done', 'resumes', 'merged', 'left', 'err'])), 'resumes' => $tsR]);
            }
        } catch (Throwable $e) {
            $log[] = ' talent search failed: ' . $e->getMessage();
        }
        // v34: security and governance: encrypt older uploads, nightly encrypted backup (weekly full), the daily security
        // check with file integrity and the audit chain, the retention rule, and reminders (access reviews, policies)
        try {
            $sealed = fileSealSweep(500, 40);
            if ($sealed['done']) {
                $log[] = ' files encrypted: ' . json_encode($sealed);
            }
            require_once __DIR__ . '/monitor.php';
            require_once __DIR__ . '/backup.php';
            $bc = bkCfg();
            $lastOk = secKv('backup_ok');
            if (!empty($bc['on']) && (!is_array($lastOk) || (int) $lastOk['at'] < now() - 20 * 3600000)) {
                $lastFull = secKv('backup_full_at', 0);
                $full = !empty($bc['full']) && (int) $lastFull < now() - 6.5 * 86400000;
                $bk = bkRun($full);
                if ($bk['ok'] && $full) {
                    secKvSet('backup_full_at', now());
                }
                $log[] = ' backup: ' . ($bk['ok'] ? $bk['name'] . ' ' . round($bk['size'] / 1048576, 1) . ' MB' . ($bk['offsite'] ? ' (off-site copy)' : '') : 'FAILED ' . $bk['err']);
            }
            $mon = monDaily();
            if ($mon['ran']) {
                $log[] = ' security check: ' . json_encode($mon);
            }
            // v79: trim the web application firewall log to the kept days and drop long-idle address scores
            try {
                require_once __DIR__ . '/firewall.php'; // v83: wafCronPrune reads fwSettings(), not loaded by cron.php
                require_once __DIR__ . '/waf.php';
                $wp = wafCronPrune();
                if (!empty($wp['logs']) || !empty($wp['addresses']) || !empty($wp['err'])) {
                    $log[] = ' firewall log retention: ' . json_encode($wp);
                }
            } catch (Throwable $e) {
                $log[] = ' firewall retention failed: ' . $e->getMessage();
            }
            // v83: rate-limit and bot-check counters whose window has ended
            try {
                $tp = throttlePrune();
                if ($tp) {
                    $log[] = ' rate-limit counters pruned: ' . $tp;
                }
            } catch (Throwable $e) {
            }
            require_once __DIR__ . '/privacy.php';
            $ret = privRetentionRun();
            if (!empty($ret['ran'])) {
                $log[] = ' retention: ' . json_encode($ret);
            }
            // v36.1: ID check pictures past their keeping period are deleted (the results stay), unfinished checks removed
            require_once __DIR__ . '/idscan.php';
            idsSweep();
            require_once __DIR__ . '/gov.php';
            $rem = govReminders();
            if ($rem) {
                $log[] = ' governance reminders: ' . $rem;
            }
        } catch (Throwable $e) {
            $log[] = ' security tasks failed: ' . $e->getMessage();
        }
        // v34: iLabor360 requisitions pulled through the API on the schedule set under Sourcing connections
        try {
            require_once __DIR__ . '/connectors.php';
            $cx = cxCron();
            if (!empty($cx['ok']) || !empty($cx['err'])) {
                $log[] = ' iLabor360 requisitions: ' . json_encode(array_intersect_key($cx, array_flip(['fetched', 'added', 'updated', 'closed', 'err'])));
            }
            // v35.2: Dice by itself: candidates for open requirements, postings in step with the careers page
            require_once __DIR__ . '/cxauto.php';
            $da = cxAutoCron();
            if (!empty($da['ran'])) {
                $log[] = ' Dice automation: ' . json_encode(array_intersect_key($da, array_flip(['searched', 'found', 'imported', 'posted', 'updated', 'closed', 'err'])));
            }
        } catch (Throwable $e) {
            $log[] = ' iLabor360 pull failed: ' . $e->getMessage();
        }
        // v34: service desk: SLA breaches (the group and, for P1 and P2, the administrators are told) and resolved tickets closed
        try {
            require_once __DIR__ . '/desk.php';
            $dk = deskCron(false);
            if (!empty($dk['ran']) && ($dk['breached'] || $dk['closed'])) {
                $log[] = ' service desk: ' . $dk['breached'] . ' SLA breaches, ' . $dk['closed'] . ' closed';
            }
        } catch (Throwable $e) {
            $log[] = ' service desk task failed: ' . $e->getMessage();
        }
        // v83: client delivery desk: issues nobody acknowledged within the target are escalated (owner and backup, then
        // HR and administrators), on the schedule rather than only when someone opens that company's desk
        try {
            require_once __DIR__ . '/corp.php';
            require_once __DIR__ . '/corpdd.php';
            $dde = 0;
            foreach (ddDb()->query("SELECT DISTINCT cid FROM cr_issue WHERE st IN ('open', 'reopened') AND ack_at = 0 AND esc < 2")->fetchAll(PDO::FETCH_COLUMN) as $c) {
                $dde += ddEscalate((string) $c);
            }
            if ($dde) {
                $log[] = ' delivery desk escalations: ' . $dde;
            }
        } catch (Throwable $e) {
            $log[] = ' delivery desk escalations failed: ' . $e->getMessage();
        }
        // v35: team messaging: emails for unread direct messages and mentions, and the retention rule
        try {
            require_once __DIR__ . '/chat.php';
            $ch = chatCron(false);
            if (!empty($ch['ran']) && ($ch['mailed'] || $ch['removed'])) {
                $log[] = ' messages: ' . $ch['mailed'] . ' unread-message emails, ' . $ch['removed'] . ' old messages removed';
            }
        } catch (Throwable $e) {
            $log[] = ' messages task failed: ' . $e->getMessage();
        }
        // v37.5: distribution lists: new mail in each list's mailbox is passed on (then sent below)
        try {
            require_once __DIR__ . '/maillists.php';
            $dlr = dlCron($cli ? 90000 : 30000);
            if ($dlr['polled'] || $dlr['cleared']) {
                $log[] = ' distribution lists: ' . json_encode($dlr);
            }
        } catch (Throwable $e) {
            $log[] = ' distribution lists failed: ' . $e->getMessage();
        }
        $mail = mailRun($cli ? 50000 : 30000);
        $log[] = ' email: ' .
            $mail['state'] .
            (isset($mail['sent']) ? ', sent ' . $mail['sent'] . ', waiting ' . $mail['left'] : '') .
            (!empty($mail['message']) ? ' (' . $mail['message'] . ')' : '');
    } catch (Throwable $e) {
        $log[] = 'scheduled run stopped: ' . $e->getMessage();
    } finally {
        secKvSet('cron_lock', null);
        secKvSet('cron_at', ['at' => now(), 'via' => $cli ? 'cli' : 'web', 'secs' => (int) round(microtime(true) - $t0), 'tasks' => count($log), 'err' => array_values(array_filter($log, fn($l) => (bool) preg_match('/failed|FAILED|stopped/', $l)))]);
    }
    return array_map(fn($l) => date('c') . ' ' . ltrim($l), $log);
}
