<?php
declare(strict_types=1);
/*
 * v34 governance (Admin > Governance & SOC 2):
 *   - Security policies with versions and staff acknowledgment (everyone accepts the current version in their portal).
 *   - SOC 2 readiness: the Trust Services Criteria controls, most of them checked automatically from the site itself,
 *     the rest marked by the security officer with notes and evidence; a printable readiness report.
 *   - Quarterly access reviews, the risk register, the vendor register and the incident register (with
 *     breach-notification deadlines), plus the audit log viewer.
 * Everything lives under sec/gov (administrators only); staff use the dedicated routes for their own policies and to
 * report a concern. A SOC 2 report itself is issued by an independent CPA firm; this prepares the evidence for it.
 */
require_once __DIR__ . '/gov_content.php';

function govCfg(): array
{
    $d = docGet('sec/gov/cfg');
    $a = $d ? (json_decode(json_encode($d), true) ?: []) : [];
    return array_merge(['officer' => '', 'company' => 'StratEdge IT Consulting Inc.', 'contractHours' => 72, 'insurer' => '', 'counsel' => '', 'tabletop' => 0, 'seeded' => 0], $a);
}
function govSaveCfg(array $c): void
{
    docSet('sec/gov/cfg', json_decode(json_encode($c)));
}
/** The policy text with this site's details filled in. */
function govFill(string $s): string
{
    $g = govCfg();
    $a = authCfg();
    $officer = $g['officer'] !== '' ? (string) (userRow($g['officer'])['name'] ?? 'the security officer') : 'the security officer';
    $priv = docGet('sec/priv/cfg');
    $bk = function_exists('bkCfg') ? bkCfg() : ['keep' => 14];
    return strtr($s, [
        '{company}' => $g['company'],
        '{officer}' => $officer,
        '{secEmail}' => (string) ($a['secEmail'] ?: (cfg('mail_from') ?: 'info@stratedgeitconsulting.com')),
        '{site}' => rtrim(siteUrl(), '/') . '/',
        '{idleStaff}' => (string) $a['idleStaff'],
        '{pwMin}' => (string) max(8, (int) $a['pwMin']),
        '{pwMinSolo}' => (string) max(8, (int) $a['pwMinSolo']),
        '{retention}' => (string) (int) ($priv->months ?? 24),
        '{backupKeep}' => (string) (int) ($bk['keep'] ?? 14),
    ]);
}
/** First use: the policy templates, the starter risks and the vendors this site already uses. */
function govSeed(): void
{
    $g = govCfg();
    if (!empty($g['seeded'])) {
        return;
    }
    foreach (govPolicyTemplates() as $p) {
        if (!docGet('sec/gov/pol/' . $p['id'])) {
            docSet('sec/gov/pol/' . $p['id'], (object) ['t' => $p['t'], 'sum' => $p['sum'], 'aud' => $p['aud'], 'body' => $p['body'], 'ver' => 0, 'st' => 'draft', 'tpl' => true, 'hist' => [], 'u' => now()]);
        }
    }
    foreach (govStarterRisks() as $i => $r) {
        docSet('sec/gov/risk/r' . ($i + 1), json_decode(json_encode($r + ['owner' => '', 'rev' => 0, 'at' => now(), 'u' => now()])));
    }
    govVendorsDetect();
    $g['seeded'] = now();
    govSaveCfg($g);
}
/** Adds the services this site is configured to use to the vendor register (once each). */
function govVendorsDetect(): int
{
    $cat = govVendorCatalog();
    $have = [];
    foreach (colAll('sec/gov/vend') as [$id, $v]) {
        if (!empty($v->auto)) {
            $have[(string) $v->auto] = true;
        }
    }
    $on = ['host' => true, 'hibp' => !empty(authCfg()['breached']), 'geo' => (bool) cfg('geo_lookup')];
    require_once __DIR__ . '/mail.php';
    $ms = mailSettings();
    $on['mail'] = ($ms['provider'] ?? 'config') !== 'php';
    $on['ai'] = function_exists('aiReady') && aiReady();
    $on['stripe'] = (bool) docGet('sec/x/bill');
    $on['plaid'] = (bool) docGet('sec/x/plaid') || (bool) docGet('org/acct/plaid');
    $on['qbo'] = (bool) docGet('sec/x/qbo') || (bool) docGet('org/acct/qbo');
    $sso = docGet('sec/x/sso/cfg');
    foreach (['google', 'linkedin', 'microsoft'] as $p) {
        $on[$p] = $sso && !empty($sso->$p->on);
    }
    $src = docGet('sec/x/src');
    $on['dice'] = $src && isset($src->dice);
    $on['ilabor'] = $src && isset($src->ilabor);
    $bk = secKv('backup', []);
    $on['s3'] = !empty($bk['s3']['on']);
    $n = 0;
    foreach ($cat as $k => $v) {
        if (empty($on[$k]) || isset($have[$k])) {
            continue;
        }
        $name = $v['n'];
        if ($k === 'mail') {
            $name = ['gmail' => 'Google Gmail', 'workspace' => 'Google Workspace', 'mailgun' => 'Mailgun', 'sendgrid' => 'SendGrid', 'brevo' => 'Brevo', 'ses' => 'Amazon SES', 'postal' => 'Own mail server (Postal)', 'smtp' => 'SMTP service', 'host' => 'Web host mailbox'][$ms['provider']] ?? $name;
        }
        docSet('sec/gov/vend/' . $k, json_decode(json_encode(['n' => $name, 'svc' => $v['svc'], 'data' => $v['data'], 'tier' => $v['tier'], 'soc' => '', 'dpa' => false, 'owner' => '', 'rev' => 0, 'notes' => '', 'auto' => $k, 'at' => now(), 'u' => now()])));
        $n++;
    }
    return $n;
}
/** Which policy audiences a person belongs to. */
function govAudOf(array $u): array
{
    $roles = rolesOf($u);
    $portals = portalsOf($u);
    $out = [];
    if (array_intersect($roles, ['admin', 'hr', 'acct', 'manager']) || array_intersect($portals, ['employee', 'bench', 'admin', 'hr', 'acct', 'mgr'])) {
        $out[] = 'staff';
    }
    if (in_array('consultant', $portals, true) && ruleCtSafe($u) !== 'student') {
        $out[] = 'consultants';
    }
    if (in_array('admin', $roles, true)) {
        $out[] = 'admins';
    }
    return $out;
}
function ruleCtSafe(array $u): string
{
    try {
        return meCt($u);
    } catch (Throwable $e) {
        return '';
    }
}
/** Published policies this person still has to accept (the current version). */
function govPendingList(array $u): array
{
    $aud = govAudOf($u);
    if (!$aud) {
        return [];
    }
    $ack = docGet('sec/gov/ack/' . $u['id']);
    $out = [];
    foreach (colAll('sec/gov/pol') as [$id, $p]) {
        if (($p->st ?? '') !== 'published' || !array_intersect($aud, (array) ($p->aud ?? []))) {
            continue;
        }
        $mine = $ack->$id->ver ?? 0;
        if ((int) $mine < (int) ($p->ver ?? 0)) {
            $out[] = (string) $id;
        }
    }
    return $out;
}
function govPendingFor(array $u): int
{
    try {
        return count(govPendingList($u));
    } catch (Throwable $e) {
        return 0;
    }
}
/** People a policy applies to, with whether they accepted the current version. */
function govAckReport(string $pid): array
{
    $p = docGet('sec/gov/pol/' . $pid);
    if (!$p) {
        return [];
    }
    $rows = db()->query("SELECT id, email, name, role, status, access FROM users WHERE status = 'active'")->fetchAll();
    $out = [];
    foreach ($rows as $r) {
        if (!array_intersect(govAudOf($r), (array) ($p->aud ?? []))) {
            continue;
        }
        $a = docGet('sec/gov/ack/' . $r['id']);
        $x = $a->$pid ?? null;
        $out[] = ['uid' => $r['id'], 'n' => $r['name'], 'e' => $r['email'], 'ver' => (int) ($x->ver ?? 0), 'at' => (int) ($x->at ?? 0), 'cur' => (int) ($x->ver ?? 0) >= (int) ($p->ver ?? 0)];
    }
    usort($out, fn($a, $b) => [$a['cur'], $a['n']] <=> [$b['cur'], $b['n']]);
    return $out;
}

/* ---------- breach-notification deadlines ---------- */
function govNotices(array $inc): array
{
    $found = (int) ($inc['found'] ?? now());
    $g = govCfg();
    $where = array_values(array_filter(array_map('strval', (array) ($inc['where'] ?? []))));
    $count = (int) ($inc['count'] ?? 0);
    $states = govBreachStates();
    $out = [];
    $out[] = ['k' => 'insurer', 'to' => 'Cyber insurance carrier' . ($g['insurer'] !== '' ? ' (' . $g['insurer'] . ')' : ''), 'due' => $found + 2 * 86400000, 'rule' => 'Most policies require notice within days and before you hire outside help; check yours.'];
    $out[] = ['k' => 'clients', 'to' => 'Clients and partners whose data or staff are involved', 'due' => $found + (int) $g['contractHours'] * 3600000, 'rule' => 'Contract terms (default ' . (int) $g['contractHours'] . ' hours; check each MSA).'];
    if (in_array('EU', $where, true)) {
        $out[] = ['k' => 'gdpr', 'to' => 'EU supervisory authority (lead authority)', 'due' => $found + 72 * 3600000, 'rule' => 'GDPR Art. 33: within 72 hours of becoming aware; people without undue delay if high risk.'];
    }
    if (in_array('UK', $where, true)) {
        $out[] = ['k' => 'uk', 'to' => 'UK Information Commissioner\'s Office', 'due' => $found + 72 * 3600000, 'rule' => 'UK GDPR: within 72 hours of becoming aware.'];
    }
    if (in_array('CA-CAN', $where, true)) {
        $out[] = ['k' => 'pipeda', 'to' => 'Office of the Privacy Commissioner of Canada and the people affected', 'due' => 0, 'rule' => 'PIPEDA: as soon as feasible when there is a real risk of significant harm.'];
    }
    foreach ($where as $st) {
        if (!isset($states[$st])) {
            if (strlen($st) === 2 && ctype_upper($st)) {
                $out[] = ['k' => 'st-' . $st, 'to' => 'Residents of ' . $st, 'due' => 0, 'rule' => 'Without unreasonable delay; check the state\'s law for regulator notice.'];
            }
            continue;
        }
        [$name, $days, $reg] = $states[$st];
        if ($st === 'NJ') {
            $out[] = ['k' => 'nj-police', 'to' => 'New Jersey Division of State Police', 'due' => $found + 86400000, 'rule' => 'Before notifying New Jersey residents (N.J.S.A. 56:8-163).'];
        }
        $out[] = ['k' => 'st-' . $st, 'to' => 'Residents of ' . $name, 'due' => $days > 0 ? $found + $days * 86400000 : 0, 'rule' => ($days > 0 ? 'Within ' . $days . ' days' : 'Without unreasonable delay') . ($reg !== '' ? '. Regulator: ' . $reg . '.' : '.')];
    }
    if ($count > 1000) {
        $out[] = ['k' => 'cra', 'to' => 'Nationwide credit bureaus (Equifax, Experian, TransUnion)', 'due' => 0, 'rule' => 'Most states require it when more than 1,000 people are notified (Texas: more than 10,000).'];
    }
    $done = (array) ($inc['done'] ?? []);
    foreach ($out as &$n) {
        $n['done'] = (int) ($done[$n['k']] ?? 0);
    }
    return $out;
}

/* ---------- SOC 2 readiness ---------- */
function govCtx(): array
{
    static $c = null;
    if ($c !== null) {
        return $c;
    }
    require_once __DIR__ . '/auth.php';
    $users = db()->query("SELECT * FROM users WHERE status = 'active'")->fetchAll();
    foreach ($users as &$r) {
        $r['roles'] = rolesOf($r);
    }
    unset($r);
    $c = ['users' => $users, 'scan' => secKv('scan'), 'integrity' => secKv('integrity'), 'auth' => authCfg()];
    return $c;
}
/** Staff members (for training and policies): privileged roles, employees and recruiting team. */
function govStaff(): array
{
    return array_values(array_filter(govCtx()['users'], fn($u) => in_array('staff', govAudOf($u), true)));
}
function govTraining(): array
{
    $staff = govStaff();
    $done = 0;
    $late = [];
    foreach ($staff as $u) {
        $p = docGet('learn/' . $u['id'] . '/p/security');
        if ($p && (int) ($p->completedAt ?? 0) > now() - 365 * 86400000) {
            $done++;
        } else {
            $late[] = $u['name'];
        }
    }
    return ['n' => count($staff), 'done' => $done, 'late' => $late];
}
function govScanCheck(string $k): ?array
{
    $s = govCtx()['scan'];
    foreach ((array) ($s['checks'] ?? []) as $x) {
        if ($x['k'] === $k) {
            return $x;
        }
    }
    return null;
}
/** One automatic check: [status ok|warn|fail, evidence]. */
function govAuto(string $key): array
{
    $ctx = govCtx();
    $g = govCfg();
    $a = $ctx['auth'];
    $year = now() - 365 * 86400000;
    if (str_starts_with($key, 'ack:')) {
        $pid = substr($key, 4);
        $p = docGet('sec/gov/pol/' . $pid);
        if (!$p || ($p->st ?? '') !== 'published') {
            return ['fail', 'The policy is not published yet.'];
        }
        $rep = govAckReport($pid);
        $cur = count(array_filter($rep, fn($x) => $x['cur']));
        $pct = $rep ? (int) round(100 * $cur / count($rep)) : 100;
        return [$pct >= 95 ? 'ok' : ($pct >= 60 ? 'warn' : 'fail'), $cur . ' of ' . count($rep) . ' people accepted version ' . (int) $p->ver . ' (' . $pct . '%).'];
    }
    switch ($key) {
        case 'officer':
            return $g['officer'] !== '' && userRow($g['officer']) ? ['ok', 'Security officer: ' . userRow($g['officer'])['name'] . '.'] : ['fail', 'Name a security officer under "Who is responsible" on this page.'];
        case 'training':
            $t = govTraining();
            $pct = $t['n'] ? (int) round(100 * $t['done'] / $t['n']) : 0;
            return [$pct >= 95 ? 'ok' : ($pct >= 50 ? 'warn' : 'fail'), $t['done'] . ' of ' . $t['n'] . ' staff completed the security course in the last 12 months' . ($t['late'] ? '; outstanding: ' . implode(', ', array_slice($t['late'], 0, 6)) : '') . '.'];
        case 'policies':
            $pub = 0;
            $old = 0;
            $all = 0;
            foreach (colAll('sec/gov/pol') as [, $p]) {
                $all++;
                if (($p->st ?? '') === 'published') {
                    $pub++;
                    if ((int) ($p->reviewed ?? $p->pubAt ?? 0) < $year) {
                        $old++;
                    }
                }
            }
            return [$pub === $all && !$old ? 'ok' : ($pub > 0 ? 'warn' : 'fail'), $pub . ' of ' . $all . ' policies published' . ($old ? ', ' . $old . ' not reviewed in a year' : '') . '.'];
        case 'acks':
            $need = 0;
            $behind = 0;
            foreach (govStaff() as $u) {
                $need++;
                if (govPendingList($u)) {
                    $behind++;
                }
            }
            return [$behind === 0 && $need > 0 ? 'ok' : ($behind <= max(1, (int) ($need / 10)) ? 'warn' : 'fail'), ($need - $behind) . ' of ' . $need . ' staff accepted every current policy.'];
        case 'concern':
            return ['ok', 'Sign-in & security > Report a security concern in every portal, and ' . ($a['secEmail'] ?: (string) cfg('mail_from')) . '.'];
        case 'public':
            $ok = (bool) govScanCheck('securitytxt') && govScanCheck('securitytxt')['st'] === 'ok';
            return [$ok ? 'ok' : 'warn', 'Public security page #/security, privacy notice #/privacy' . ($ok ? ', security.txt answering.' : '; security.txt not confirmed by the last self-check.')];
        case 'risk':
            $rev = 0;
            $n = 0;
            foreach (colAll('sec/gov/risk') as [, $r]) {
                $n++;
                $rev = max($rev, (int) ($r->reviewed ?? 0));
            }
            return [$rev > $year ? 'ok' : ($n ? 'warn' : 'fail'), $n . ' risks in the register; last reviewed ' . ($rev ? gmdate('j M Y', (int) ($rev / 1000)) : 'never') . '.'];
        case 'riskowners':
            $bad = 0;
            $hi = 0;
            foreach (colAll('sec/gov/risk') as [, $r]) {
                if ((int) $r->l * (int) $r->i >= 15 && ($r->st ?? 'open') !== 'closed') {
                    $hi++;
                    if (($r->owner ?? '') === '' || trim((string) ($r->plan ?? '')) === '') {
                        $bad++;
                    }
                }
            }
            return [$bad === 0 ? 'ok' : 'warn', $hi . ' high risks; ' . $bad . ' without an owner or plan.'];
        case 'fraud':
            $n = 0;
            foreach (colAll('sec/gov/risk') as [, $r]) {
                if (($r->cat ?? '') === 'Fraud') {
                    $n++;
                }
            }
            return [$n > 0 ? 'ok' : 'warn', $n . ' fraud risks recorded (fake candidates, payroll diversion and similar).'];
        case 'scan':
            $s = $ctx['scan'];
            if (!is_array($s) || (int) $s['at'] <= now() - 3 * 86400000) {
                return ['fail', 'The daily self-check has not run in 3 days (check the cron job).'];
            }
            // v35: continuous monitoring means the daily run happens on its own, not only when someone presses the button
            $daily = (int) secKv('mon_daily', 0);
            return [$daily > now() - 2 * 86400000 ? 'ok' : 'warn', 'Self-check ran ' . gmdate('j M H:i', (int) ($s['at'] / 1000)) . ' UTC: score ' . (int) $s['score'] . '%' . ($daily > now() - 2 * 86400000 ? '; the daily run is on schedule.' : '; it was run by hand: the daily run needs the scheduled task (cron job), see Monitoring.')];
        case 'nofail':
            $s = $ctx['scan'];
            $f = is_array($s) ? (int) ($s['sum']['fail'] ?? 0) : -1;
            return $f === 0 ? ['ok', 'No failing checks.'] : ['fail', $f < 0 ? 'Run the self-check.' : $f . ' failing checks in Monitoring.'];
        case 'web':
            $keys = ['csp', 'frame', 'x-content-type-options', 'hsts'];
            $ok = 0;
            foreach ($keys as $k) {
                $x = govScanCheck($k);
                if ($x && $x['st'] === 'ok') {
                    $ok++;
                }
            }
            return [$ok === count($keys) ? 'ok' : 'warn', $ok . ' of ' . count($keys) . ' web protections confirmed (CSP, framing, MIME, HSTS).'];
        case 'mfa':
            $need = 0;
            $have = 0;
            foreach ($ctx['users'] as $u) {
                if (authMfaRequired($u)) {
                    $need++;
                    if (mfaMethods($u)) {
                        $have++;
                    }
                }
            }
            $enforced = now() >= authMfaDue();
            return [$need === $have && $enforced ? 'ok' : ($have > 0 ? 'warn' : 'fail'), $have . ' of ' . $need . ' people in required roles use two-step sign-in; ' . ($enforced ? 'enforced at sign-in.' : 'enforced from ' . gmdate('j M Y', (int) (authMfaDue() / 1000)) . '.')];
        case 'pwpolicy':
            $ok = (int) $a['pwMinSolo'] >= 15 && (int) $a['pwMin'] >= 8 && !empty($a['breached']);
            return [$ok ? 'ok' : 'warn', 'Minimum ' . $a['pwMinSolo'] . ' characters alone, ' . $a['pwMin'] . ' with two-step sign-in; breached-password check ' . (!empty($a['breached']) ? 'on' : 'off') . '; lockout after ' . $a['lockAfter'] . ' failures.'];
        case 'encryption':
            $fs = secKv('files_seal');
            $plain = is_array($fs) ? (int) $fs['plain'] : -1;
            return [$plain === 0 && !secKeyInsideSite() ? 'ok' : ($plain === 0 ? 'warn' : 'warn'), ($plain === 0 ? 'Every uploaded file is encrypted' : ($plain < 0 ? 'File encryption has not been checked yet' : $plain . ' older files still to encrypt')) . '; bank details and credentials sealed; key ' . (secKeyInsideSite() ? 'inside the website folder (move it out).' : 'outside the website folder.')];
        case 'audit':
            $n = (int) secdb()->query("SELECT COUNT(*) FROM audit_log WHERE kind = 'access'")->fetchColumn();
            return ['ok', 'Access changes are made by administrators in Roles & access and logged (' . $n . ' access entries in the audit log).'];
        case 'review':
            $last = 0;
            foreach (colAll('sec/gov/rev') as [, $r]) {
                if (($r->st ?? '') === 'done') {
                    $last = max($last, (int) ($r->doneAt ?? 0));
                }
            }
            return [$last > now() - 100 * 86400000 ? 'ok' : ($last ? 'warn' : 'fail'), $last ? 'Last access review completed ' . gmdate('j M Y', (int) ($last / 1000)) . '.' : 'No access review completed yet.'];
        case 'dormant':
            $x = govScanCheck('stale');
            return $x ? ['warn', $x['t']] : ['ok', 'No staff account unused for 90 days.'];
        case 'firewall':
            require_once __DIR__ . '/guard.php';
            $fw = function_exists('fwSettings') ? fwSettings() : ['enabled' => true];
            $gc = function_exists('guardCfg') ? guardCfg() : [];
            return [!empty($fw['enabled']) ? 'ok' : 'fail', 'Firewall ' . (!empty($fw['enabled']) ? 'on' : 'off') . '; scanner trap, rate limits and lockouts active; requests from other web sites refused; bot check on public forms ' . (!empty($gc['pow']) ? 'on' : 'off') . ' and on sign-in under attack ' . (!empty($gc['powLogin']) ? 'on' : 'off') . (trim((string) ($gc['staffNets'] ?? '')) !== '' ? '; staff sign in only from listed networks' : '') . '.'];
        // v35: the second protection layer (Security center > Protection)
        case 'stepup':
            require_once __DIR__ . '/guard.php';
            $gc = function_exists('guardCfg') ? guardCfg() : ['reauthMin' => 15];
            return [(int) $gc['reauthMin'] <= 30 ? 'ok' : 'warn', 'Access changes, keys of outside services, bank accounts, payroll files, exports and data deletion ask for a password, passkey or code entered within the last ' . (int) $gc['reauthMin'] . ' minutes.'];
        case 'dlp':
            require_once __DIR__ . '/guard.php';
            $gc = function_exists('guardCfg') ? guardCfg() : [];
            return [!empty($gc['dlp']) ? 'ok' : 'warn', !empty($gc['dlp']) ? 'Unusual downloads (' . (int) $gc['dlpFiles'] . '/hour), exports (' . (int) $gc['dlpExports'] . '/hour) and profile views (' . (int) $gc['dlpProfiles'] . '/hour) alert the security contacts' . (!empty($gc['dlpPause']) ? ' and pause at three times that' : '') . '.' : 'The data-theft guard is off (Security center > Protection).'];
        case 'uploads':
            require_once __DIR__ . '/guard.php';
            $av = guardAvTarget() !== '';
            return ['ok', 'Uploads and email attachments are screened: the content must match the type; macros, programs inside archives, unsafe paths and zip bombs are refused' . ($av ? '; ClamAV scans every file' : '') . '.'];
        case 'ddhold':
            require_once __DIR__ . '/guard.php';
            $gc = function_exists('guardCfg') ? guardCfg() : ['ddHold' => 0];
            return [(int) $gc['ddHold'] > 0 ? 'ok' : 'warn', (int) $gc['ddHold'] > 0 ? 'A changed bank account waits ' . (int) $gc['ddHold'] . ' days before payroll pays into it; the person is emailed a "this was not me" link and payroll is told.' : 'Bank account changes take effect at once (Security center > Protection: hold them for a few days).'];
        case 'tls':
            $x = govScanCheck('https');
            $c2 = govScanCheck('cert');
            return [$x && $x['st'] === 'ok' && (!$c2 || $c2['st'] === 'ok') ? 'ok' : 'warn', ($x ? $x['t'] : 'HTTPS not checked yet') . ($c2 ? '; ' . $c2['t'] : '') . '.'];
        case 'integrity':
            $iv = $ctx['integrity'];
            return is_array($iv) ? [!empty($iv['ok']) ? 'ok' : 'fail', !empty($iv['ok']) ? 'All program files match the version (checked ' . gmdate('j M', (int) ($iv['at'] / 1000)) . ').' : 'Program files differ from the version: see Monitoring.'] : ['warn', 'The integrity check has not run yet.'];
        case 'vuln':
            $x = govScanCheck('php');
            return [$x && $x['st'] === 'ok' ? 'ok' : 'warn', ($x ? $x['t'] : 'PHP not checked') . '; responsible disclosure at #/security and security.txt.'];
        case 'alerts':
            $av = secKv('audit_verify');
            return [is_array($av) && !empty($av['ok']) ? 'ok' : 'warn', 'Alerts go to ' . (count((array) $a['alertUids']) ?: 'every administrator') . ' recipient(s); audit chain ' . (is_array($av) ? ($av['ok'] ? 'verified ' . gmdate('j M', (int) ($av['at'] / 1000)) : 'BROKEN') : 'not verified yet') . '.'];
        case 'incidents':
            $open = 0;
            $noOwner = 0;
            foreach (colAll('sec/gov/inc') as [, $i]) {
                if (!in_array($i->st ?? 'new', ['closed'], true)) {
                    $open++;
                    if (($i->owner ?? '') === '') {
                        $noOwner++;
                    }
                }
            }
            return [$noOwner === 0 ? 'ok' : 'warn', $open . ' open incidents; ' . $noOwner . ' without an owner.'];
        case 'change':
            $up = uploadIssues();
            return [($up['missing'] ?? 0) === 0 && ($up['changed'] ?? 0) === 0 ? 'ok' : 'warn', 'Version ' . (json_decode((string) @file_get_contents(__DIR__ . '/manifest.json'), true)['version'] ?? '?') . ' installed; upload check ' . (($up['missing'] ?? 0) === 0 && ($up['changed'] ?? 0) === 0 ? 'complete' : 'incomplete') . '; settings changes logged.'];
        case 'backups':
            $x = govScanCheck('backup');
            $o = govScanCheck('offsite');
            return $x ? [$x['st'] === 'ok' && !$o ? 'ok' : ($x['st'] === 'ok' ? 'warn' : 'fail'), $x['t'] . ($o ? '; ' . $o['t'] : '')] : ['fail', 'Backups not checked yet.'];
        case 'vendors':
            $n = 0;
            $due = 0;
            foreach (colAll('sec/gov/vend') as [, $v]) {
                $n++;
                if (in_array($v->tier ?? 'low', ['critical', 'high'], true) && (int) ($v->reviewed ?? 0) < $year) {
                    $due++;
                }
            }
            return [$n > 0 && $due === 0 ? 'ok' : ($n > 0 ? 'warn' : 'fail'), $n . ' vendors in the register; ' . $due . ' critical or high ones not reviewed in a year.'];
        case 'restore':
            $vf = secKv('backup_verify');
            return is_array($vf) && (int) $vf['at'] > now() - 183 * 86400000 ? ['ok', 'Test restore ' . gmdate('j M Y', (int) ($vf['at'] / 1000)) . ' (' . (int) $vf['users'] . ' accounts, ' . (int) $vf['records'] . ' records).'] : ['fail', 'No backup was test-restored in the last 6 months.'];
        case 'capacity':
            $x = govScanCheck('disk');
            return $x ? [$x['st'], $x['t'] . '.'] : ['warn', 'Not checked yet.'];
        case 'retention':
            $p = docGet('sec/priv/cfg');
            return [!empty($p->on) ? 'ok' : 'warn', !empty($p->on) ? 'Candidate data older than ' . (int) ($p->months ?? 24) . ' months is deleted automatically; verification documents after their set days; logs and backups age out.' : 'Automatic deletion of old candidate data is switched off (Privacy > Retention).'];
        case 'notice':
            return ['ok', 'Privacy notice at #/privacy, linked from every application form.'];
        case 'consent':
            $p = docGet('sec/priv/cfg');
            return [($p->consent ?? true) ? 'ok' : 'warn', 'Applications record consent with the time and the notice version.'];
        case 'dsr':
            $late = 0;
            $n = 0;
            foreach (colAll('sec/priv/req') as [, $q]) {
                $n++;
                if (!in_array($q->st ?? '', ['done', 'denied'], true) && (int) ($q->due ?? 0) < now()) {
                    $late++;
                }
            }
            return [$late === 0 ? 'ok' : 'fail', $n . ' privacy requests received; ' . $late . ' past their deadline.'];
    }
    return ['warn', ''];
}
function govControls(): array
{
    $manual = docGet('sec/gov/soc');
    $out = [];
    foreach (govSocControls() as $c) {
        $m = $manual->{$c['id']} ?? null;
        if ($c['auto'] !== '') {
            [$st, $ev] = govAuto($c['auto']);
        } else {
            $st = (string) ($m->st ?? 'fail');
            $ev = (string) ($m->ev ?? 'Mark this one yourself with your evidence.');
        }
        $out[] = $c + ['st' => $st, 'ev' => $ev, 'note' => (string) ($m->note ?? ''), 'mBy' => (string) ($m->by ?? ''), 'mAt' => (int) ($m->at ?? 0)];
    }
    return $out;
}
function govScore(array $controls): array
{
    $s = ['ok' => 0, 'warn' => 0, 'fail' => 0];
    foreach ($controls as $c) {
        $s[$c['st']] = ($s[$c['st']] ?? 0) + 1;
    }
    $n = max(1, count($controls));
    return $s + ['pct' => (int) round(100 * ($s['ok'] + 0.5 * $s['warn']) / $n), 'n' => count($controls)];
}

/* ---------- access reviews ---------- */
function govReviewItems(): array
{
    require_once __DIR__ . '/auth.php';
    $items = [];
    foreach (db()->query("SELECT id, email, name, role, status, access, created FROM users WHERE status = 'active' ORDER BY name")->fetchAll() as $r) {
        $r['roles'] = rolesOf($r);
        $portals = portalsOf($r);
        $lg = docGet('log/' . $r['id']);
        $items[] = ['uid' => $r['id'], 'n' => $r['name'], 'e' => $r['email'], 'roles' => $r['roles'], 'portals' => $portals, 'last' => (int) ($lg->seen ?? ($lg->last->t ?? 0)), 'mfa' => (bool) mfaMethods($r), 'priv' => sessPrivileged($r), 'd' => '', 'note' => ''];
    }
    usort($items, fn($a, $b) => [!$a['priv'], $a['n']] <=> [!$b['priv'], $b['n']]);
    return $items;
}

/* ---------- routes ---------- */
function govRoute(string $r, array $b): never
{
    // staff: their own policies, accepting them, reporting a concern
    if ($r === 'gov_my_policies') {
        $u = requireUser();
        $aud = govAudOf($u);
        $ack = docGet('sec/gov/ack/' . $u['id']);
        $out = [];
        foreach (colAll('sec/gov/pol') as [$id, $p]) {
            if (($p->st ?? '') !== 'published' || !array_intersect($aud, (array) ($p->aud ?? []))) {
                continue;
            }
            $mine = $ack->$id ?? null;
            $out[] = ['id' => (string) $id, 't' => (string) $p->t, 'sum' => govFill((string) ($p->sum ?? '')), 'body' => govFill((string) $p->body), 'ver' => (int) $p->ver, 'pubAt' => (int) ($p->pubAt ?? 0), 'ackVer' => (int) ($mine->ver ?? 0), 'ackAt' => (int) ($mine->at ?? 0)];
        }
        usort($out, fn($a, $b) => [$a['ackVer'] >= $a['ver'], $a['t']] <=> [$b['ackVer'] >= $b['ver'], $b['t']]);
        ok(['policies' => $out]);
    }
    if ($r === 'gov_ack') {
        $u = requireUser();
        $id = str($b, 'id', 40);
        $p = docGet('sec/gov/pol/' . $id);
        if (!$p || ($p->st ?? '') !== 'published' || (int) ($b['ver'] ?? 0) !== (int) $p->ver) {
            fail(409, 'invalid_argument', 'This policy changed; read the current version and accept it again.');
        }
        $a = docGet('sec/gov/ack/' . $u['id']) ?? new stdClass();
        $a->$id = (object) ['ver' => (int) $p->ver, 'at' => now(), 'ip' => clientIp()];
        docSet('sec/gov/ack/' . $u['id'], $a);
        audit('policy', 'Policy accepted', $id, ['ver' => (int) $p->ver, 'title' => (string) $p->t], $u);
        ok(['ok' => true, 'pending' => govPendingFor($u)]);
    }
    if ($r === 'gov_concern') {
        $u = requireUser();
        if (throttleHit('concern:' . $u['id'], 10, 3600)) {
            fail(429, 'rate_limited', 'Too many reports in an hour. Email ' . (authCfg()['secEmail'] ?: (string) cfg('mail_from')) . ' instead.');
        }
        $id = govIncidentNew(['t' => str($b, 't', 160) ?: 'Security concern', 'kind' => in_array($b['kind'] ?? '', ['phishing', 'device', 'data', 'account', 'other'], true) ? (string) $b['kind'] : 'other', 'desc' => str($b, 'desc', 4000), 'src' => 'staff', 'by' => $u['name'] . ' (' . $u['email'] . ')'], $u);
        ok(['ok' => true, 'id' => $id]);
    }
    // everything else: administrators (the security officer may be any administrator)
    $me = requireAdmin();
    if (!hasRole($me, 'admin')) {
        fail(403, 'forbidden', 'Governance is for administrators.');
    }
    govSeed();
    switch ($r) {
        case 'gov_overview':
            $controls = govControls();
            $pols = [];
            foreach (colAll('sec/gov/pol') as [$id, $p]) {
                $pols[] = ['id' => (string) $id, 'st' => (string) ($p->st ?? 'draft')];
            }
            $openInc = 0;
            foreach (colAll('sec/gov/inc') as [, $i]) {
                if (($i->st ?? 'new') !== 'closed') {
                    $openInc++;
                }
            }
            $revOpen = null;
            $revLast = 0;
            foreach (colAll('sec/gov/rev') as [$id, $rv]) {
                if (($rv->st ?? '') === 'open') {
                    $revOpen = (string) $id;
                } else {
                    $revLast = max($revLast, (int) ($rv->doneAt ?? 0));
                }
            }
            $hiRisk = 0;
            foreach (colAll('sec/gov/risk') as [, $rk]) {
                if ((int) $rk->l * (int) $rk->i >= 15 && ($rk->st ?? 'open') !== 'closed') {
                    $hiRisk++;
                }
            }
            // the people who can own a risk, a vendor or an incident, or be the security officer: staff with privileged roles
            $people = [];
            foreach (govCtx()['users'] as $u) {
                if (sessPrivileged($u)) {
                    $people[] = ['id' => (string) $u['id'], 'n' => (string) $u['name'], 'e' => (string) $u['email']];
                }
            }
            usort($people, fn($a, $b) => strcasecmp($a['n'], $b['n']));
            ok(['controls' => $controls, 'score' => govScore($controls), 'cfg' => govCfg(), 'officerName' => govCfg()['officer'] ? (string) (userRow(govCfg()['officer'])['name'] ?? '') : '', 'policies' => $pols, 'incidentsOpen' => $openInc, 'review' => ['open' => $revOpen, 'last' => $revLast, 'due' => $revLast ? $revLast + 90 * 86400000 : 0], 'risksHigh' => $hiRisk, 'training' => govTraining(), 'people' => $people]);
        case 'gov_cfg_save':
            $c = govCfg();
            $in = (array) ($b['cfg'] ?? []);
            if (array_key_exists('officer', $in)) {
                $o = (string) $in['officer'];
                $c['officer'] = $o !== '' && userRow($o) ? $o : '';
            }
            foreach (['company' => 120, 'insurer' => 160, 'counsel' => 160] as $k => $max) {
                if (array_key_exists($k, $in)) {
                    $c[$k] = mb_substr(trim((string) $in[$k]), 0, $max);
                }
            }
            if (array_key_exists('contractHours', $in)) {
                $c['contractHours'] = max(1, min(720, (int) $in['contractHours']));
            }
            govSaveCfg($c);
            audit('settings', 'Governance settings changed', 'governance', array_intersect_key($in, array_flip(['officer', 'company', 'insurer', 'counsel', 'contractHours'])), $me);
            ok(['cfg' => $c]);
        case 'gov_soc_set':
            $id = str($b, 'id', 40);
            if (!in_array($id, array_column(govSocControls(), 'id'), true)) {
                fail(404, 'invalid_argument', 'No such control.');
            }
            $d = docGet('sec/gov/soc') ?? new stdClass();
            $d->$id = (object) ['st' => in_array($b['st'] ?? '', ['ok', 'warn', 'fail'], true) ? $b['st'] : 'fail', 'ev' => str($b, 'ev', 1000), 'note' => str($b, 'note', 1000), 'by' => $me['name'], 'at' => now()];
            docSet('sec/gov/soc', $d);
            if ($id === 'cc7-tabletop' && ($b['st'] ?? '') === 'ok') {
                $c = govCfg();
                $c['tabletop'] = now();
                govSaveCfg($c);
            }
            audit('policy', 'SOC 2 control marked', $id, ['st' => $d->$id->st], $me);
            ok(['ok' => true]);

        /* --- policies --- */
        case 'gov_pol_list':
            $out = [];
            foreach (colAll('sec/gov/pol') as [$id, $p]) {
                $rep = ($p->st ?? '') === 'published' ? govAckReport((string) $id) : [];
                $out[] = ['id' => (string) $id, 't' => (string) $p->t, 'sum' => govFill((string) ($p->sum ?? '')), 'aud' => (array) ($p->aud ?? []), 'st' => (string) ($p->st ?? 'draft'), 'ver' => (int) ($p->ver ?? 0), 'pubAt' => (int) ($p->pubAt ?? 0), 'reviewed' => (int) ($p->reviewed ?? $p->pubAt ?? 0), 'edited' => !empty($p->edited), 'acks' => count(array_filter($rep, fn($x) => $x['cur'])), 'people' => count($rep)];
            }
            $order = array_flip(array_column(govPolicyTemplates(), 'id'));
            usort($out, fn($a, $b) => ($order[$a['id']] ?? 99) <=> ($order[$b['id']] ?? 99));
            ok(['policies' => $out]);
        case 'gov_pol_get':
            $id = str($b, 'id', 40);
            $p = docGet('sec/gov/pol/' . $id);
            if (!$p) {
                fail(404, 'not_found', 'No such policy.');
            }
            ok(['id' => $id, 't' => (string) $p->t, 'sum' => (string) ($p->sum ?? ''), 'body' => (string) $p->body, 'filled' => govFill((string) $p->body), 'aud' => (array) ($p->aud ?? []), 'st' => (string) ($p->st ?? 'draft'), 'ver' => (int) ($p->ver ?? 0), 'hist' => (array) ($p->hist ?? []), 'draft' => isset($p->draft) ? (string) $p->draft : null, 'acks' => govAckReport($id)]);
        case 'gov_pol_save':
            $id = str($b, 'id', 40);
            if (!preg_match('/^[a-z0-9_-]{2,40}$/', $id)) {
                fail(400, 'invalid_argument', 'Give the policy a short id (letters, numbers, dashes).');
            }
            $p = docGet('sec/gov/pol/' . $id) ?? (object) ['ver' => 0, 'st' => 'draft', 'hist' => []];
            $p->t = mb_substr(trim(str($b, 't', 160)), 0, 160) ?: ($p->t ?? 'Untitled policy');
            $p->sum = str($b, 'sum', 400);
            $p->aud = array_values(array_intersect(['staff', 'consultants', 'admins'], (array) ($b['aud'] ?? ['staff'])));
            $body = mb_substr((string) ($b['body'] ?? ''), 0, 60000);
            if (($p->st ?? '') === 'published') {
                $p->draft = $body; // the published text stays until "Publish" makes the draft the new version
            } else {
                $p->body = $body;
            }
            $p->edited = true;
            $p->u = now();
            docSet('sec/gov/pol/' . $id, $p);
            ok(['ok' => true]);
        case 'gov_pol_publish':
            $id = str($b, 'id', 40);
            $p = docGet('sec/gov/pol/' . $id);
            if (!$p) {
                fail(404, 'not_found', 'No such policy.');
            }
            if (isset($p->draft)) {
                $p->body = $p->draft;
                unset($p->draft);
            }
            $minor = !empty($b['review']);
            if (!$minor || (int) ($p->ver ?? 0) === 0) {
                $p->ver = (int) ($p->ver ?? 0) + 1;
            }
            $p->st = 'published';
            $p->pubAt = now();
            $p->reviewed = now();
            $p->by = $me['name'];
            $hist = (array) ($p->hist ?? []);
            $hist[] = (object) ['ver' => (int) $p->ver, 'at' => now(), 'by' => $me['name'], 'note' => str($b, 'note', 300) ?: ($minor ? 'Reviewed, no changes' : 'Published')];
            $p->hist = array_slice($hist, -40);
            docSet('sec/gov/pol/' . $id, $p);
            audit('policy', $minor ? 'Policy reviewed' : 'Policy published', $id, ['ver' => (int) $p->ver, 'title' => (string) $p->t], $me);
            ok(['ok' => true, 'ver' => (int) $p->ver]);
        case 'gov_pol_publish_all':
            $n = 0;
            foreach (colAll('sec/gov/pol') as [$id, $p]) {
                if (($p->st ?? '') !== 'published') {
                    $p->ver = (int) ($p->ver ?? 0) + 1;
                    $p->st = 'published';
                    $p->pubAt = now();
                    $p->reviewed = now();
                    $p->by = $me['name'];
                    $p->hist = array_merge((array) ($p->hist ?? []), [(object) ['ver' => (int) $p->ver, 'at' => now(), 'by' => $me['name'], 'note' => 'Published']]);
                    docSet('sec/gov/pol/' . $id, $p);
                    $n++;
                }
            }
            audit('policy', 'Policies published', 'all', ['n' => $n], $me);
            ok(['ok' => true, 'n' => $n]);
        case 'gov_pol_reset':
            $id = str($b, 'id', 40);
            foreach (govPolicyTemplates() as $t) {
                if ($t['id'] === $id) {
                    $p = docGet('sec/gov/pol/' . $id) ?? new stdClass();
                    if (($p->st ?? '') === 'published') {
                        $p->draft = $t['body'];
                    } else {
                        $p->body = $t['body'];
                    }
                    $p->t = $t['t'];
                    $p->sum = $t['sum'];
                    $p->aud = $t['aud'];
                    $p->edited = false;
                    docSet('sec/gov/pol/' . $id, $p);
                    ok(['ok' => true]);
                }
            }
            fail(404, 'not_found', 'There is no built-in text for this policy.');
        case 'gov_pol_delete':
            $id = str($b, 'id', 40);
            docDelete('sec/gov/pol/' . $id);
            audit('policy', 'Policy deleted', $id, [], $me);
            ok(['ok' => true]);
        case 'gov_pol_remind':
            $id = str($b, 'id', 40);
            $p = docGet('sec/gov/pol/' . $id);
            if (!$p || ($p->st ?? '') !== 'published') {
                fail(400, 'invalid_argument', 'Publish the policy first.');
            }
            require_once __DIR__ . '/auth.php';
            $n = 0;
            foreach (govAckReport($id) as $x) {
                if (!$x['cur'] && $n < 200) {
                    authMail(['email' => $x['e'], 'name' => $x['n']], 'Please read and accept: ' . $p->t, ['Hi ' . explode(' ', $x['n'])[0] . ',', 'StratEdge published a policy that applies to you: ' . $p->t . ' (version ' . (int) $p->ver . '). Please read it and accept it in the portal.'], ['Open my policies', siteUrl() . '#/portal/security']);
                    $n++;
                }
            }
            ok(['ok' => true, 'n' => $n]);

        /* --- access reviews --- */
        case 'gov_rev_start':
            foreach (colAll('sec/gov/rev') as [$id, $rv]) {
                if (($rv->st ?? '') === 'open') {
                    ok(['id' => (string) $id]);
                }
            }
            $id = gmdate('Y') . '-Q' . (int) ceil((int) gmdate('n') / 3) . '-' . rid(2);
            docSet('sec/gov/rev/' . $id, json_decode(json_encode(['at' => now(), 'by' => $me['name'], 'st' => 'open', 'due' => now() + 14 * 86400000, 'items' => govReviewItems()])));
            audit('access', 'Access review started', $id, [], $me);
            ok(['id' => $id]);
        case 'gov_rev_list':
            $out = [];
            foreach (colAll('sec/gov/rev') as [$id, $rv]) {
                $items = (array) ($rv->items ?? []);
                $out[] = ['id' => (string) $id, 'at' => (int) $rv->at, 'by' => (string) ($rv->by ?? ''), 'st' => (string) $rv->st, 'doneAt' => (int) ($rv->doneAt ?? 0), 'n' => count($items), 'decided' => count(array_filter($items, fn($x) => ($x->d ?? '') !== '')), 'removed' => count(array_filter($items, fn($x) => ($x->d ?? '') === 'remove'))];
            }
            usort($out, fn($a, $b) => $b['at'] <=> $a['at']);
            ok(['reviews' => $out]);
        case 'gov_rev_get':
            $id = str($b, 'id', 40);
            $rv = docGet('sec/gov/rev/' . $id);
            if (!$rv) {
                fail(404, 'not_found', 'No such review.');
            }
            ok(['id' => $id] + json_decode(json_encode($rv), true));
        case 'gov_rev_decide':
            $id = str($b, 'id', 40);
            $rv = docGet('sec/gov/rev/' . $id);
            if (!$rv || ($rv->st ?? '') !== 'open') {
                fail(400, 'invalid_argument', 'This review is closed.');
            }
            $uid = str($b, 'uid', 40);
            $d = in_array($b['d'] ?? '', ['keep', 'change', 'remove'], true) ? (string) $b['d'] : '';
            $found = false;
            foreach ($rv->items as $it) {
                if ($it->uid === $uid) {
                    $it->d = $d;
                    $it->note = str($b, 'note', 300);
                    $it->by = $me['name'];
                    $it->at = now();
                    $found = true;
                }
            }
            if (!$found) {
                fail(404, 'invalid_argument', 'That person is not in this review.');
            }
            docSet('sec/gov/rev/' . $id, $rv);
            ok(['ok' => true]);
        case 'gov_rev_done':
            $id = str($b, 'id', 40);
            $rv = docGet('sec/gov/rev/' . $id);
            if (!$rv || ($rv->st ?? '') !== 'open') {
                fail(400, 'invalid_argument', 'This review is closed.');
            }
            $left = count(array_filter((array) $rv->items, fn($x) => ($x->d ?? '') === ''));
            if ($left > 0) {
                fail(400, 'invalid_argument', $left . ' accounts still need a decision.');
            }
            require_once __DIR__ . '/auth.php';
            $paused = 0;
            foreach ($rv->items as $it) {
                if ($it->d === 'remove' && $it->uid !== $me['id']) {
                    db()->prepare("UPDATE users SET status = 'disabled' WHERE id = ?")->execute([$it->uid]);
                    sessRevokeAll((string) $it->uid, 'removed in access review');
                    $paused++;
                }
            }
            $rv->st = 'done';
            $rv->doneAt = now();
            $rv->doneBy = $me['name'];
            $rv->summary = ['kept' => count(array_filter((array) $rv->items, fn($x) => $x->d === 'keep')), 'changed' => count(array_filter((array) $rv->items, fn($x) => $x->d === 'change')), 'removed' => $paused];
            docSet('sec/gov/rev/' . $id, $rv);
            audit('access', 'Access review completed', $id, $rv->summary, $me);
            ok(['ok' => true, 'summary' => $rv->summary]);

        /* --- risks, vendors --- */
        case 'gov_risks':
            $out = [];
            foreach (colAll('sec/gov/risk') as [$id, $x]) {
                $out[] = ['id' => (string) $id] + json_decode(json_encode($x), true);
            }
            usort($out, fn($a, $b) => ((int) $b['l'] * (int) $b['i']) <=> ((int) $a['l'] * (int) $a['i']));
            ok(['risks' => $out]);
        case 'gov_risk_save':
            $id = preg_match('/^[a-z0-9]{1,20}$/', str($b, 'id', 20)) ? str($b, 'id', 20) : 'r' . rid(4);
            $prev = docGet('sec/gov/risk/' . $id);
            $x = [
                't' => mb_substr(trim(str($b, 't', 200)), 0, 200) ?: 'Untitled risk',
                'cat' => str($b, 'cat', 40) ?: 'General',
                'desc' => str($b, 'desc', 2000),
                'l' => max(1, min(5, (int) ($b['l'] ?? 3))),
                'i' => max(1, min(5, (int) ($b['i'] ?? 3))),
                'owner' => str($b, 'owner', 40),
                'treat' => in_array($b['treat'] ?? '', ['mitigate', 'accept', 'transfer', 'avoid'], true) ? (string) $b['treat'] : 'mitigate',
                'plan' => str($b, 'plan', 2000),
                'st' => in_array($b['st'] ?? '', ['open', 'treated', 'accepted', 'closed'], true) ? (string) $b['st'] : 'open',
                'rev' => (int) ($b['rev'] ?? 0),
                'reviewed' => !empty($b['reviewedNow']) ? now() : (int) ($prev->reviewed ?? 0),
                'at' => (int) ($prev->at ?? now()),
                'u' => now(),
                'by' => $me['name'],
            ];
            docSet('sec/gov/risk/' . $id, json_decode(json_encode($x)));
            audit('policy', $prev ? 'Risk updated' : 'Risk added', $id, ['t' => $x['t'], 'score' => $x['l'] * $x['i'], 'st' => $x['st']], $me);
            ok(['id' => $id]);
        case 'gov_risks_reviewed':
            foreach (colAll('sec/gov/risk') as [$id, $x]) {
                $x->reviewed = now();
                docSet('sec/gov/risk/' . $id, $x);
            }
            audit('policy', 'Risk assessment reviewed', 'risks', [], $me);
            ok(['ok' => true]);
        case 'gov_risk_delete':
            docDelete('sec/gov/risk/' . str($b, 'id', 20));
            ok(['ok' => true]);
        case 'gov_vendors':
            $added = govVendorsDetect();
            $out = [];
            foreach (colAll('sec/gov/vend') as [$id, $x]) {
                $out[] = ['id' => (string) $id] + json_decode(json_encode($x), true);
            }
            $rank = ['critical' => 0, 'high' => 1, 'medium' => 2, 'low' => 3];
            usort($out, fn($a, $b) => [$rank[$a['tier']] ?? 4, $a['n']] <=> [$rank[$b['tier']] ?? 4, $b['n']]);
            ok(['vendors' => $out, 'added' => $added]);
        case 'gov_vendor_save':
            $id = preg_match('/^[a-z0-9]{1,20}$/', str($b, 'id', 20)) ? str($b, 'id', 20) : 'v' . rid(4);
            $prev = docGet('sec/gov/vend/' . $id);
            $x = [
                'n' => mb_substr(trim(str($b, 'n', 120)), 0, 120) ?: 'Vendor',
                'svc' => str($b, 'svc', 300),
                'data' => str($b, 'data', 300),
                'tier' => in_array($b['tier'] ?? '', ['critical', 'high', 'medium', 'low'], true) ? (string) $b['tier'] : 'medium',
                'soc' => str($b, 'soc', 120),
                'dpa' => !empty($b['dpa']),
                'owner' => str($b, 'owner', 40),
                'rev' => (int) ($b['rev'] ?? 0),
                'reviewed' => !empty($b['reviewedNow']) ? now() : (int) ($prev->reviewed ?? 0),
                'notes' => str($b, 'notes', 2000),
                'auto' => (string) ($prev->auto ?? ''),
                'at' => (int) ($prev->at ?? now()),
                'u' => now(),
            ];
            docSet('sec/gov/vend/' . $id, json_decode(json_encode($x)));
            audit('policy', $prev ? 'Vendor updated' : 'Vendor added', $id, ['n' => $x['n'], 'tier' => $x['tier']], $me);
            ok(['id' => $id]);
        case 'gov_vendor_delete':
            docDelete('sec/gov/vend/' . str($b, 'id', 20));
            ok(['ok' => true]);

        /* --- incidents --- */
        case 'gov_incidents':
            $out = [];
            foreach (colAll('sec/gov/inc') as [$id, $x]) {
                $a = json_decode(json_encode($x), true);
                $a['id'] = (string) $id;
                $a['notices'] = !empty($a['breach']) || !empty($a['pd']) ? govNotices($a) : [];
                $out[] = $a;
            }
            usort($out, fn($a, $b) => [($a['st'] ?? '') === 'closed', -(int) ($a['found'] ?? 0)] <=> [($b['st'] ?? '') === 'closed', -(int) ($b['found'] ?? 0)]);
            ok(['incidents' => $out, 'states' => govBreachStates()]);
        case 'gov_inc_save':
            $id = str($b, 'id', 20);
            $prev = $id !== '' ? docGet('sec/gov/inc/' . $id) : null;
            if (!$prev) {
                $id = govIncidentNew(['t' => str($b, 't', 160), 'kind' => str($b, 'kind', 20), 'desc' => str($b, 'desc', 4000), 'src' => 'admin', 'by' => $me['name']], $me);
                $prev = docGet('sec/gov/inc/' . $id);
            }
            foreach (['t' => 160, 'desc' => 6000, 'lessons' => 4000, 'owner' => 40] as $k => $max) {
                if (array_key_exists($k, $b)) {
                    $prev->$k = str($b, $k, $max);
                }
            }
            if (isset($b['sev']) && in_array($b['sev'], ['low', 'medium', 'high', 'critical'], true)) {
                $prev->sev = $b['sev'];
            }
            if (isset($b['st']) && in_array($b['st'], ['new', 'investigating', 'contained', 'resolved', 'closed'], true)) {
                if ($b['st'] !== ($prev->st ?? '')) {
                    $prev->log = array_merge((array) ($prev->log ?? []), [(object) ['at' => now(), 'by' => $me['name'], 'note' => 'Status: ' . $b['st']]]);
                }
                $prev->st = $b['st'];
                if ($b['st'] === 'closed') {
                    $prev->closedAt = now();
                }
            }
            if (array_key_exists('pd', $b)) {
                $prev->pd = !empty($b['pd']);
            }
            if (array_key_exists('breach', $b)) {
                if (!empty($b['breach']) && empty($prev->breach)) {
                    $prev->confirmedAt = now();
                }
                $prev->breach = !empty($b['breach']);
            }
            if (array_key_exists('types', $b)) {
                $prev->types = array_values(array_intersect(['ssn', 'bank', 'ids', 'immigration', 'resumes', 'contact', 'credentials', 'health', 'pay', 'other'], (array) $b['types']));
            }
            if (array_key_exists('where', $b)) {
                $prev->where = array_values(array_filter(array_map(fn($x) => strtoupper(substr((string) $x, 0, 6)), (array) $b['where']), fn($x) => preg_match('/^[A-Z-]{2,6}$/', $x)));
            }
            if (array_key_exists('count', $b)) {
                $prev->count = max(0, (int) $b['count']);
            }
            if (array_key_exists('found', $b) && (int) $b['found'] > 0) {
                $prev->found = (int) $b['found'];
            }
            if (isset($b['noticeDone']) && is_string($b['noticeDone'])) {
                $done = (array) ($prev->done ?? []);
                $k = preg_replace('/[^a-z0-9-]/', '', strtolower($b['noticeDone']));
                $done[$k] = empty($done[$k]) ? now() : 0;
                $prev->done = (object) $done;
            }
            if (str($b, 'note', 2000) !== '') {
                $prev->log = array_merge((array) ($prev->log ?? []), [(object) ['at' => now(), 'by' => $me['name'], 'note' => str($b, 'note', 2000)]]);
            }
            $prev->u = now();
            docSet('sec/gov/inc/' . $id, $prev);
            audit('incident', 'Incident updated', $id, ['st' => (string) ($prev->st ?? ''), 'sev' => (string) ($prev->sev ?? ''), 'breach' => !empty($prev->breach)], $me);
            ok(['id' => $id]);
        case 'gov_inc_delete':
            docDelete('sec/gov/inc/' . str($b, 'id', 20));
            ok(['ok' => true]);

        /* --- training --- */
        case 'gov_training':
            $rows = [];
            foreach (govStaff() as $u) {
                $p = docGet('learn/' . $u['id'] . '/p/security');
                $rows[] = ['uid' => $u['id'], 'n' => $u['name'], 'e' => $u['email'], 'pct' => (int) ($p->pct ?? 0), 'done' => (int) ($p->completedAt ?? 0)];
            }
            usort($rows, fn($a, $b) => [$a['done'] > now() - 365 * 86400000, $a['n']] <=> [$b['done'] > now() - 365 * 86400000, $b['n']]);
            ok(['rows' => $rows]);
        case 'gov_training_retake':
            $n = 0;
            require_once __DIR__ . '/auth.php';
            foreach ((array) ($b['uids'] ?? []) as $uid) {
                $uid = (string) $uid;
                $u = userRow($uid);
                if (!$u) {
                    continue;
                }
                $p = docGet('learn/' . $uid . '/p/security');
                if ($p && (int) ($p->completedAt ?? 0) > 0 && (int) $p->completedAt < now() - 300 * 86400000) {
                    docDelete('learn/' . $uid . '/p/security');
                }
                authMail($u, 'Your yearly security course', ['Hi ' . authFirst($u) . ',', 'Please complete "Security awareness at StratEdge" in the portal (Learning). It takes about 25 minutes and is required once a year.'], ['Open the course', siteUrl() . '#/portal/learn?c=security']);
                $n++;
            }
            ok(['ok' => true, 'n' => $n]);

        /* --- the audit log --- */
        case 'gov_audit':
            $where = [];
            $args = [];
            if (($k = str($b, 'kind', 16)) !== '') {
                $where[] = 'kind = ?';
                $args[] = $k;
            }
            if (($q = str($b, 'q', 100)) !== '') {
                $where[] = '(act LIKE ? OR target LIKE ? OR who LIKE ? OR ip LIKE ?)';
                array_push($args, "%$q%", "%$q%", "%$q%", "%$q%");
            }
            if ((int) ($b['from'] ?? 0) > 0) {
                $where[] = 'at >= ?';
                $args[] = (int) $b['from'];
            }
            if ((int) ($b['to'] ?? 0) > 0) {
                $where[] = 'at <= ?';
                $args[] = (int) $b['to'];
            }
            $page = max(1, (int) ($b['page'] ?? 1));
            $sqlW = $where ? ' WHERE ' . implode(' AND ', $where) : '';
            $cnt = secdb()->prepare('SELECT COUNT(*) FROM audit_log' . $sqlW);
            $cnt->execute($args);
            $s = secdb()->prepare('SELECT seq, at, uid, who, ip, kind, act, target, detail FROM audit_log' . $sqlW . ' ORDER BY seq DESC LIMIT 100 OFFSET ' . (($page - 1) * 100));
            $s->execute($args);
            ok(['rows' => $s->fetchAll(), 'total' => (int) $cnt->fetchColumn(), 'page' => $page, 'verify' => secKv('audit_verify')]);
        case 'gov_audit_verify':
            ok(auditVerify());
        case 'gov_audit_csv':
            $s = secdb()->query('SELECT seq, at, who, ip, kind, act, target, detail, h FROM audit_log ORDER BY seq');
            $lines = ["Entry,When (UTC),Who,Network address,Kind,Action,Target,Details,Seal"];
            while ($row = $s->fetch()) {
                $lines[] = csvLine([(string) $row['seq'], gmdate('Y-m-d H:i:s', (int) ($row['at'] / 1000)), $row['who'], $row['ip'], $row['kind'], $row['act'], $row['target'], $row['detail'], $row['h']]);
            }
            audit('data', 'Audit log exported', 'audit_log', [], $me);
            ok(['csv' => implode("\n", $lines)]);
    }
    fail(404, 'not_found', 'Unknown action.');
}
/** Records an incident (from staff, the public report form, an alert or an administrator). Returns its id. */
function govIncidentNew(array $in, ?array $by = null): string
{
    $id = gmdate('ymd') . '-' . rid(2);
    $kind = (string) ($in['kind'] ?? 'other');
    $sev = $kind === 'vuln' ? 'medium' : ($kind === 'data' ? 'high' : 'low');
    docSet('sec/gov/inc/' . $id, json_decode(json_encode([
        't' => mb_substr((string) ($in['t'] ?? 'Security concern'), 0, 160),
        'kind' => $kind,
        'sev' => $sev,
        'desc' => mb_substr((string) ($in['desc'] ?? ''), 0, 6000),
        'st' => 'new',
        'found' => now(),
        'src' => (string) ($in['src'] ?? 'staff'),
        'reporter' => mb_substr((string) ($in['by'] ?? ''), 0, 200),
        'owner' => govCfg()['officer'],
        'pd' => false,
        'breach' => false,
        'log' => [['at' => now(), 'by' => (string) ($in['by'] ?? 'System'), 'note' => 'Reported']],
        'at' => now(),
        'u' => now(),
    ])));
    audit('incident', 'Incident reported', $id, ['kind' => $kind, 'src' => (string) ($in['src'] ?? '')], $by);
    require_once __DIR__ . '/auth.php';
    secAlertAdmins('inc:' . $id, 'New security report: ' . mb_substr((string) ($in['t'] ?? ''), 0, 80), 'A ' . $kind . ' report was recorded (' . $id . ') by ' . ((string) ($in['by'] ?? 'someone')) . ":\n\n" . mb_substr((string) ($in['desc'] ?? ''), 0, 1500));
    return $id;
}
/** Once a week from the cron: what governance work is due (access review, policy and risk reviews, vendors, training). */
function govReminders(): int
{
    $g = govCfg();
    if (empty($g['seeded']) || (int) secKv('gov_remind', 0) > now() - 6.5 * 86400000) {
        return 0;
    }
    secKvSet('gov_remind', now());
    $year = now() - 365 * 86400000;
    $lines = [];
    $last = 0;
    $open = false;
    foreach (colAll('sec/gov/rev') as [, $rv]) {
        if (($rv->st ?? '') === 'open') {
            $open = true;
        } else {
            $last = max($last, (int) ($rv->doneAt ?? 0));
        }
    }
    if (!$open && $last < now() - 90 * 86400000) {
        $lines[] = 'The quarterly access review is due' . ($last ? ' (last one ' . gmdate('j M Y', (int) ($last / 1000)) . ')' : '') . '.';
    }
    $old = 0;
    $drafts = 0;
    foreach (colAll('sec/gov/pol') as [, $p]) {
        if (($p->st ?? '') !== 'published') {
            $drafts++;
        } elseif ((int) ($p->reviewed ?? 0) < $year) {
            $old++;
        }
    }
    if ($drafts) {
        $lines[] = $drafts . ' security policies are still drafts (publish them so staff can accept them).';
    }
    if ($old) {
        $lines[] = $old . ' policies were not reviewed in the last 12 months.';
    }
    $rrev = 0;
    foreach (colAll('sec/gov/risk') as [, $r]) {
        $rrev = max($rrev, (int) ($r->reviewed ?? 0));
    }
    if ($rrev < $year) {
        $lines[] = 'The yearly risk assessment is due (Risks > Mark the assessment reviewed).';
    }
    $vend = 0;
    foreach (colAll('sec/gov/vend') as [, $v]) {
        if (in_array($v->tier ?? '', ['critical', 'high'], true) && (int) ($v->reviewed ?? 0) < $year) {
            $vend++;
        }
    }
    if ($vend) {
        $lines[] = $vend . ' critical or high vendors need their yearly review.';
    }
    $t = govTraining();
    if ($t['late']) {
        $lines[] = count($t['late']) . ' staff have not completed the security course in the last 12 months.';
    }
    if (!$lines) {
        return 0;
    }
    require_once __DIR__ . '/auth.php';
    secAlertAdmins('gov:' . gmdate('YW'), 'Governance work due this week', implode("\n", $lines) . "\n\nEverything is under Admin > Governance & SOC 2.");
    return count($lines);
}
