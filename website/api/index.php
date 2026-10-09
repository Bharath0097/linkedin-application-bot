<?php
declare(strict_types=1);
require __DIR__ . '/lib.php';
require __DIR__ . '/firewall.php';
// v78: the web application firewall (attack signatures, threat scores, escalating bans)
require __DIR__ . '/waf.php';
require_once __DIR__ . '/guard.php';
error_reporting(E_ALL);
ini_set('display_errors', '0');
set_exception_handler(function (Throwable $e) {
    @error_log(
        date('c') . ' ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine() . "\n",
        3,
        storeDir() . '/error.log',
    );
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode([
        'error' => 'unavailable',
        'message' => 'The server hit a problem. Try again in a moment.',
    ]);
    exit();
});
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
header('Referrer-Policy: same-origin');
$secure =
    (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ||
    ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
// v34: every API answer is data, never a page: nothing may load from it, frame it or run in it; HTTPS is pinned
header('X-Frame-Options: SAMEORIGIN');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
header('Cross-Origin-Resource-Policy: same-origin');
header('Permissions-Policy: camera=(), microphone=(), payment=(), usb=()');
header('X-Permitted-Cross-Domain-Policies: none');
if ($secure) {
    header('Strict-Transport-Security: max-age=31536000');
}
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'httponly' => true,
    'samesite' => 'Lax',
    'secure' => $secure,
]);
// v35: PHP accepts only session ids it created itself (strict mode: a planted cookie cannot fix a session), never from
// the address bar, and over HTTPS the cookie carries the __Host- prefix, which browsers only accept from this exact
// site (secure, no Domain, path /), so another subdomain on the same hosting account cannot set or overwrite it.
ini_set('session.use_strict_mode', '1');
ini_set('session.use_only_cookies', '1');
ini_set('session.use_trans_sid', '0');
$sessBase = (string) (cfg('session_name') ?: 'stratedge_portal');
$sessName = $secure ? '__Host-' . $sessBase : $sessBase;
if ($secure && !isset($_COOKIE[$sessName]) && preg_match('/^[A-Za-z0-9,-]{22,256}$/', (string) ($_COOKIE[$sessBase] ?? ''))) {
    // signed in before v35: the session moves to the new cookie once, and the old cookie is removed
    session_id((string) $_COOKIE[$sessBase]);
    setcookie($sessBase, '', ['expires' => time() - 42000, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'Lax']);
}
session_name($sessName);
session_start();
// v37: a session belongs to one workspace (or to StratEdge's own site); a session id copied across is emptied
$wsKey = (string) (cfg('ws') ?? '');
if ((string) ($_SESSION['ws'] ?? '') !== $wsKey) {
    if (!empty($_SESSION)) {
        $_SESSION = [];
        session_regenerate_id(true);
    }
    if ($wsKey !== '') {
        $_SESSION['ws'] = $wsKey;
    }
}
$r = (string) ($_GET['r'] ?? '');
$GLOBALS['secRoute'] = $r; // v34: the session register tells background polls from activity
$method = $_SERVER['REQUEST_METHOD'];
$GLOBALS['mailKind'] = $r; // the sent log shows which part of the site sent each email
// v35: pages on other web sites cannot call the portal through a visitor's browser (Fetch Metadata)
guardFetchMeta($r, $method);
// Mail apps confirm one-click unsubscribes with a plain POST, and the mail service posts delivery events and
// inbound messages directly, so those routes skip the same-site check (they verify a signature instead).
if (
    $method === 'POST' &&
    !in_array($r, ['unsub', 'mail_webhook', 'mail_inbound', 'mail_postal_hook', 'mail_postal_inbound', 'mail_ses_hook', 'plaid_webhook', 'stripe_webhook'], true) &&
    !str_starts_with($r, 'phw_') && // v39: Twilio's calls and texts (checked against X-Twilio-Signature instead)
    ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'fetch'
) {
    fail(403, 'bad_request', 'Rejected request.');
}
// Spam and abuse firewall: blocked addresses, request rate limits and strike counts (Admin > Security).
fwGuard($r, $method);
// v78: what the request carries is read for attacks before any module sees it (Security & spam firewall > Web application firewall)
wafGuard($r, $method);
if ($r !== 'file' && $r !== 'ws_logo' && $r !== 'ws_icon') {
    header('Content-Type: application/json; charset=utf-8');
}
// v37: an address that is not a workspace (or one that was removed), a paused workspace, parts of the portal a
// workspace does not have (answered before the bot check: there is nothing to protect behind them)
$wsNow = wsCurrent();
if ($wsNow) {
    if (!empty($wsNow['missing'])) {
        if ($r === 'me') {
            ok(['ws' => wsPublic(), 'user' => null, 'portal' => '', 'portals' => [], 'clients' => [], 'build' => siteBuild(), 'ft' => [], 'sso' => [], 'pk' => false, 'ai' => [], 'mfa' => null, 'sec' => null]);
        }
        if ($r !== 'ws_ping') {
            fail(404, 'ws_missing', 'There is no portal at this address.');
        }
    } elseif (($wsNow['status'] ?? 'active') === 'paused' && !in_array($r, ['me', 'ws_ping', 'ws_logo', 'ws_icon', 'ws_manifest'], true)) {
        fail(423, 'ws_paused', (string) ($wsNow['name'] ?? 'This portal') . ' is paused. Its administrator can switch it back on with the StratEdge Workspaces team.');
    } elseif ($r === 'register' && empty($wsNow['setupDone'])) {
        // nobody signs up to a company workspace before its first administrator has set it up
        fail(403, 'ws_setup', 'This portal is still being set up. Its administrator signs in first.');
    } elseif (wsRouteMainOnly($r)) {
        // v81: integration/configuration setup lives on StratEdge's own admin side, never inside a tenant workspace
        // (workspaces manage their own people and roles; the provider sets the integrations up centrally).
        fail(403, 'feature_off', 'This setup is managed centrally by StratEdge, not inside a company portal.');
    } else {
        $feat = wsFeatureOfRoute($r);
        if ($feat !== '' && !wsFeatureOn($feat)) {
            fail(403, 'feature_off', WS_FEATURES[$feat]['n'] . ' is not part of ' . (string) ($wsNow['name'] ?? 'this portal') . '.');
        }
    }
}
// v35: public forms, and sign-in from an address with wrong passwords or during an attack, carry a solved bot check
guardPowGate($r, $method);
$b = $method === 'POST' ? body() : [];
if ($method !== 'POST' && in_array($r, GUARD_POST_ONLY, true)) {
    fail(405, 'bad_request', 'Use POST.');
}
// Requests that take longer than 1.5 seconds are noted in storage/slow.log (shown under Admin > System health).
$GLOBALS['reqStart'] = microtime(true);
register_shutdown_function(function () use ($r) {
    $ms = (int) ((microtime(true) - $GLOBALS['reqStart']) * 1000);
    if ($ms >= 1500) {
        @error_log(date('c') . ' ' . $ms . 'ms ' . $r . ' uid=' . ($_SESSION['uid'] ?? '-') . ' mem=' . (int) (memory_get_peak_usage(true) / 1048576) . 'MB' . "\n", 3, storeDir() . '/slow.log');
    }
});
// Almost no route changes the PHP session (only signing in and out, the SSO and QuickBooks hand-offs do), so its lock
// is released right away for everything else. Otherwise every request from a page that loads many records waits in
// line for the one before it - a long bank sync or an assistant call would stall every other tab - and busy shared
// hosts give up on the queue. currentUser() reads the signed-in id once while the session is still open.
// v34: the sign-in steps (two-step codes, passkeys, password changes) also write to the session.
// v45.1: so does an attorney confirming the code for a shared immigration case (imx_verify).
$keepSession = in_array($r, ['register', 'login', 'logout', 'sso_start', 'sso_cb', 'sso_gis', 'qbo_connect', 'qbo_callback', 'password', 'auth_reauth', 'auth_reauth_drop', 'ws_setup', 'imx_verify'], true)
    || (bool) preg_match('/^(mfa|pk)_/', $r);
if (!$keepSession) {
    if ($r === 'batch') {
        touchSeen(currentUser());
    }
    currentUser();
    session_write_close();
}
// v58: per-person feature blocks are enforced before a private route reaches its module. Public hooks are excluded
// by featureRouteKey(). Existing module/role rules still apply when the feature is on or left at Role default.
featureRouteGuard($r, currentUser());
// v34: a password reset by staff (or found in a breach list) must be replaced before anything else
if (!empty($_SESSION['must_pw']) && !empty($_SESSION['uid']) && !in_array($r, ['me', 'password', 'logout', 'pw_policy', 'sec_me', 'pk_auth_options', 'auth_reauth', 'auth_reauth_info', 'auth_reauth_email', 'csp_report'], true)) {
    if (currentUser()) {
        fail(403, 'must_change_password', 'Choose a new password to continue.');
    }
}
// v35: downloads, exports and profile views are counted per person (data-theft guard)
guardDlpRoute($r);
// v35: sensitive actions need a password, passkey or code from the last few minutes (the page asks, then repeats them)
if (in_array($r, GUARD_REAUTH_ROUTES, true) && currentUser()) {
    requireRecentAuth();
}

switch ($r) {
    /* ---------- accounts ---------- */
    case 'me':
        $u = currentUser();
        // v34: a sign-in waiting for its second step, and what the portal should ask of the person (new password,
        // two-step sign-in set-up before the deadline, policies to accept)
        $pend = null;
        if (!$u && !empty($_SESSION['mfa'])) {
            require_once __DIR__ . '/auth.php';
            $pu = mfaPendingUser();
            $pend = $pu ? mfaPublic($pu, (array) mfaPending()) : null;
        }
        $secFlags = null;
        if ($u) {
            require_once __DIR__ . '/auth.php';
            $ms = mfaMethods($u);
            $secFlags = [
                'mustPw' => (string) ($_SESSION['must_pw'] ?? ''),
                'mfa' => (bool) $ms,
                'mfaDue' => !$ms && authMfaRequired($u) ? authMfaDue() : 0,
                'policies' => (function () use ($u) {
                    require_once __DIR__ . '/gov.php';
                    return govPendingFor($u);
                })(),
            ];
        }
        ok([
            'mfa' => $pend,
            'sec' => $secFlags,
            'user' => $u ? publicUser($u) : null,
            'portal' => $u ? portalOf($u['id']) : '',
            'portals' => $u ? portalsOf($u) : [],
            'clients' => $u ? clientsOf($u['id']) : [],
            'jobs' => true,
            'build' => siteBuild(),
            'ft' => $u ? grantsOf($u['id']) : [],
            // v64: a client contact's role and areas in each of their companies (the portal's menu and pages)
            'ca' => $u ? (function () use ($u) {
                require_once __DIR__ . '/corp.php';
                require_once __DIR__ . '/corpacc.php';
                return caMine($u);
            })() : [],
            'fa' => $u ? featureAccessOf($u['id']) : [],
            'sso' => ssoPublic(),
            // v34: whether "Sign in with a passkey" is offered on the sign-in page
            'pk' => !empty(authCfg()['passkey']),
            // administrators are told on every page when the last upload left files missing or stale (checked every
            // few minutes; the list itself is under System health)
            'upload' => $u && hasRole($u, 'admin') && wsSlug() === '' ? uploadIssues() : null,
            // v69: the person's email signature (the Signature button in every composer) and one made from their details
            'sig' => $u ? sigOf((string) $u['id']) : '',
            'sigAuto' => $u ? sigAutoOf($u) : '',
            // accounting staff learn their books level (full, view, reports) and whether payroll is off-limits
            'acct' => $u && hasRole($u, 'acct') && !hasRole($u, 'admin') ? acctLimits($u) : null,
            // v31: which AI helpers to show (StratEdge AI, Write with AI, fill from text, tailoring, email help)
            'ai' => aiClientFlags($u),
            // v63: every employee has the Bench desk and the recruiting pages unless the feature is blocked for them
            'bench' => $u && wsFeatureOn('recruiting') ? isBench($u['id']) : false,
            // v31: Email, inbox & campaigns (everyone in the employee portal; others when granted)
            'mail' => $u && wsFeatureOn('mail') ? mailCanUse($u) : false,
            // v32: consultant type (job rules) and, for students and outside consultants, their plan
            'ct' => $u ? meCt($u) : '',
            'bill' => $u ? meBill($u) : null,
            // v34: the people in a service desk assignment group (and administrators) work tickets
            'desk' => $u && wsFeatureOn('desk') ? (function () use ($u) {
                try {
                    require_once __DIR__ . '/desk.php';
                    return deskAgentFlag($u);
                } catch (Throwable $e) {
                    return false;
                }
            })() : false,
            // v35: team messaging (the Messages button) and projects & sprints (who sees the menu item)
            'chat' => $u && wsFeatureOn('chat') ? (function () use ($u) {
                try {
                    require_once __DIR__ . '/chat.php';
                    return chatFlag($u);
                } catch (Throwable $e) {
                    return false;
                }
            })() : false,
            // v37: the workspace (another company's portal on this installation): its name, brand, parts, address;
            // null on StratEdge's own site, where `wsAdmin` says whether this person runs the workspaces
            'ws' => wsPublic(),
            'wsAdmin' => $u && wsSlug() === '' && !wsCurrent() && hasRole($u, 'admin'),
            // v38: the look the portals start in for everyone ('glass' or 'classic'; each person can still pick their own)
            'look' => lookDefault(),
            // v39: the phone (null when it is not switched on for this person)
            'phone' => $u ? (function () use ($u) {
                try {
                    require_once __DIR__ . '/phone.php';
                    return phPublic($u);
                } catch (Throwable $e) {
                    return null;
                }
            })() : null,
            // v42: work boards: 2 = may create projects, 1 = on at least one project, 0 = neither
            'work' => $u && wsFeatureOn('work') ? (function () use ($u) {
                try {
                    require_once __DIR__ . '/work.php';
                    return wkCap($u);
                } catch (Throwable $e) {
                    return 0;
                }
            })() : 0,
            // v38.1: what this person may import with preview (candidates, consultants, vendors, CRM, contacts...)
            'imp' => $u ? (function () use ($u) {
                try {
                    require_once __DIR__ . '/imports.php';
                    return impAllowed($u);
                } catch (Throwable $e) {
                    return [];
                }
            })() : [],
            // v45.3: e-signatures: may send (the feature, the whole team, or staff), may manage the library
            'es' => $u && wsFeatureOn('hr') ? (function () use ($u) {
                try {
                    require_once __DIR__ . '/esign.php';
                    return esCaps($u);
                } catch (Throwable $e) {
                    return null;
                }
            })() : null,
            // v36.1: may check IDs (HR, administrators and authorized employees unless switched off)
            'ids' => $u && wsFeatureOn('recruiting') ? (function () use ($u) {
                try {
                    require_once __DIR__ . '/idscan.php';
                    return idsCan($u);
                } catch (Throwable $e) {
                    return false;
                }
            })() : false,
        ]);
    case 'sig_save':
        // v69: the person's email signature (plain text, up to 1500 characters; empty clears it)
        $u = requireUser();
        $sig = trim(preg_replace("/\r\n?/", "\n", (string) ($b['sig'] ?? '')) ?? '');
        if (mb_strlen($sig) > 1500) {
            fail(400, 'invalid_argument', 'Keep the signature under 1,500 characters.');
        }
        if (preg_match('/<\s*(script|iframe|object|embed)/i', $sig)) {
            fail(400, 'invalid_argument', 'The signature is plain text: no scripts or embedded content.');
        }
        $d = docGet('u/' . $u['id']) ?? (object) ['p' => (object) ['n' => (string) $u['name'], 'e' => (string) $u['email']], 'joined' => now()];
        $d->sig = $sig;
        docSet('u/' . $u['id'], $d);
        ok(['sig' => $sig]);
    case 'look_default':
        // v38: an administrator picks the look everyone starts in (people who chose their own keep it)
        $u = requireUser();
        if (!hasRole($u, 'admin')) {
            fail(403, 'forbidden', 'Only administrators choose the look everyone starts with.');
        }
        $v = (string) ($b['look'] ?? '');
        if (!in_array($v, LOOKS, true)) {
            fail(400, 'invalid_argument', 'Choose Glass or Classic.');
        }
        $was = lookDefault();
        secKvSet('look_default', $v);
        if ($was !== $v) {
            audit('settings', 'Look everyone starts with changed', $v, ['was' => $was], $u);
        }
        ok(['look' => $v]);
    case 'register':
        // v37: nobody signs up to a company workspace before its first administrator has set it up (the first account
        // of an empty database would otherwise become its administrator)
        if (wsSlug() !== '' && empty(wsCurrent()['setupDone'])) {
            fail(403, 'ws_setup', 'This portal is still being set up. Its administrator signs in first.');
        }
        if (throttleHit('reg:' . clientIp(), 20, 3600)) {
            fail(429, 'rate_limited', 'Too many sign-ups from this network. Try again later.');
        }
        $name = str($b, 'name', 120);
        $email = strtolower(str($b, 'email', 190));
        $pass = (string) ($b['password'] ?? '');
        if (mb_strlen($name) < 2) {
            fail(400, 'invalid_argument', 'Add your full name.');
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            fail(400, 'invalid_argument', 'Enter a valid email address.');
        }
        if (fwScreen(['name' => $name, 'email' => $email, 'website' => $b['website'] ?? '', 't0' => $b['t0'] ?? 0], 'sign-up') !== '') {
            fail(400, 'spam', 'This sign-up could not be completed. Contact StratEdge at ' . (string) cfg('mail_from') . '.');
        }
        require_once __DIR__ . '/auth.php';
        $weak = pwProblem($pass, ['email' => $email, 'name' => $name, 'mfa' => false, 'check' => true]);
        if ($weak !== '') {
            fail(400, 'weak_password', $weak);
        }
        $p = db();
        $s = $p->prepare('SELECT id FROM users WHERE email = ?');
        $s->execute([$email]);
        if ($s->fetch()) {
            fail(409, 'invalid_argument', 'An account with that email already exists. Log in instead.');
        }
        $first = !$p->query('SELECT id FROM users LIMIT 1')->fetch();
        $id = 'u_' . rid(8);
        $p->prepare(
            'INSERT INTO users (id, email, name, pass, role, status, created) VALUES (?,?,?,?,?,?,?)',
        )->execute([
            $id,
            $email,
            $name,
            pwHash($pass),
            $first ? 'admin' : 'user',
            'active',
            now(),
        ]);
        // v83: nobody proved this address yet (selfReg): a later Google/Microsoft/LinkedIn sign-in by its owner, or a
        // reset link from its mailbox, confirms it; the provider sign-in first shuts out whatever this sign-up set up
        authUserSet($id, ['pw_at' => now(), 'pw_check' => now()] + ($first ? [] : ['data' => json_encode(['selfReg' => now()])]));
        authFinish(['id' => $id, 'name' => $name, 'email' => $email, 'role' => $first ? 'admin' : 'user', 'status' => 'active', 'access' => ''], 'register', '', 0, '');
        ok([
            'user' => [
                'id' => $id,
                'name' => $name,
                'email' => $email,
                'role' => $first ? 'admin' : 'user',
                'status' => 'active',
            ],
            'first' => $first,
        ]);
    case 'login':
        $email = strtolower(str($b, 'email', 190));
        $pass = (string) ($b['password'] ?? '');
        if (throttleHit('login:' . $email, 10, 900) || throttleHit('loginip:' . clientIp(), 60, 900)) {
            fail(429, 'rate_limited', 'Too many attempts. Wait 15 minutes and try again.');
        }
        require_once __DIR__ . '/auth.php';
        $s = db()->prepare('SELECT * FROM users WHERE email = ?');
        $s->execute([$email]);
        $u = $s->fetch();
        if ($u && ($lock = authLocked($u)) !== '') {
            fail(429, 'locked', $lock);
        }
        // the same work whether or not the account exists, so the answer time does not reveal it
        $okPw = password_verify($pass, $u ? (string) $u['pass'] : '$argon2id$v=19$m=65536,t=4,p=1$c29tZXNhbHRzb21lc2FsdA$Ck3s2u2C4xQe0pE4yUa6hQ');
        if (!$u || !$okPw) {
            fwStrike('login', 'failed login for ' . $email);
            // v35: this address (and, past a level, every sign-in) now needs the bot check
            guardLoginFailed();
            if ($u) {
                authFailed($u);
            }
            audit('auth', 'Failed sign-in', $email, ['account' => (bool) $u]);
            fail(401, 'invalid_login', 'That email and password don\'t match.');
        }
        if ($u['status'] !== 'active') {
            fail(403, 'disabled', 'This account is paused. Contact StratEdge HR.');
        }
        throttleClear('login:' . $email);
        // Every login page is for one portal (#/login?as=consultant, employee, client, student, hr, acct, manager,
        // admin). The account must have that portal, or the login is refused with the portals it does have; the
        // password was right, so this is not counted as a failed attempt. See portalLoginCheck() in lib.php.
        $as = str($b, 'as', 12);
        $asKey = portalKeyOfLogin($as);
        if ($asKey === '') {
            fail(400, 'choose_portal', 'Choose which portal you are logging in to.');
        }
        $portal = portalOf($u['id']);
        $u['roles'] = rolesOf($u);
        $refusal = portalLoginCheck($u, $asKey);
        if ($refusal !== null) {
            http_response_code(403);
            echo json_encode($refusal);
            exit();
        }
        if (password_needs_rehash($u['pass'], pwAlgo())) {
            db()
                ->prepare('UPDATE users SET pass = ? WHERE id = ?')
                ->execute([pwHash($pass), $u['id']]);
        }
        // a new account with no profile yet goes to set it up for the portal it chose; everyone else straight in
        $go = $portal === '' && in_array($asKey, ['employee', 'consultant', 'client', 'student'], true) && !in_array($asKey, portalsOf($u), true) ? '#/portal?as=' . $asKey : portalHome($asKey);
        // v34: the session opens now, or after the second step (authenticator app, passkey, email code)
        $res = authBegin($u, 'password:' . $asKey, $asKey, $go, $pass);
        if (isset($res['mfa'])) {
            ok(['mfa' => $res['mfa'], 'portal' => $portal]);
        }
        ok(['user' => publicUser($u), 'portal' => $portal, 'go' => $res['go']]);
    case 'logout':
        $lu = currentUser();
        if ($lu) {
            $lid = rid(6);
            $lrec = (object) [
                't' => now(),
                'ip' => clientIp(),
                'ua' => mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 240),
                'how' => 'logout',
                'geo' => geoLookup(clientIp()),
            ];
            docSet("log/{$lu['id']}/items/$lid", $lrec);
            $ld = docGet("log/{$lu['id']}");
            if ($ld) {
                $ld->seen = now();
                $ld->out = $lrec;
                docSet("log/{$lu['id']}", $ld);
            }
        }
        if (!empty($_SESSION['sk'])) {
            sessClose(hash('sha256', (string) $_SESSION['sk']), 'signed out');
        }
        if ($lu) {
            audit('auth', 'Signed out', (string) $lu['email'], [], $lu);
        }
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $c = session_get_cookie_params();
            setcookie(
                session_name(),
                '',
                time() - 42000,
                $c['path'],
                $c['domain'],
                $c['secure'],
                $c['httponly'],
            );
        }
        session_destroy();
        ok(['ok' => true]);
    case 'password':
        $u = requireUser();
        require_once __DIR__ . '/auth.php';
        $cur = (string) ($b['current'] ?? '');
        $new = (string) ($b['new'] ?? '');
        if (throttleHit('pwchange:' . $u['id'], 10, 900)) {
            fail(429, 'rate_limited', 'Too many tries. Wait 15 minutes.');
        }
        $s = db()->prepare('SELECT pass FROM users WHERE id = ?');
        $s->execute([$u['id']]);
        $oldHash = (string) $s->fetchColumn();
        if (!password_verify($cur, $oldHash)) {
            authFailed($u);
            fail(400, 'invalid_argument', 'Your current password is not correct.');
        }
        if (password_verify($new, $oldHash)) {
            fail(400, 'weak_password', 'Choose a password different from the current one.');
        }
        $weak = pwProblem($new, ['email' => $u['email'], 'name' => $u['name'], 'mfa' => pwMfaApplies($u), 'check' => true]); // v83: grace period counts as no second step
        if ($weak !== '') {
            fail(400, 'weak_password', $weak);
        }
        db()
            ->prepare('UPDATE users SET pass = ? WHERE id = ?')
            ->execute([pwHash($new), $u['id']]);
        authUserSet((string) $u['id'], ['must_pw' => 0, 'why' => '', 'pw_at' => now(), 'pw_check' => now()]);
        unset($_SESSION['must_pw']);
        $_SESSION['auth_at'] = now();
        $ended = sessRevokeAll((string) $u['id'], 'password changed', true);
        audit('auth', 'Password changed', (string) $u['email'], ['otherSessionsEnded' => $ended], $u);
        authMail($u, 'Your StratEdge password was changed', ['Hi ' . authFirst($u) . ',', 'The password of your StratEdge account was just changed' . ($ended ? '; ' . $ended . ' other signed-in session' . ($ended === 1 ? ' was' : 's were') . ' ended' : '') . '.', 'If you did not do this, reset your password now and contact StratEdge.'], ['Reset my password', siteUrl() . '#/forgot']);
        ok(['ok' => true, 'ended' => $ended]);
    case 'profiles':
        requireUser();
        $ids = array_values(
            array_filter(
                array_slice((array) ($b['ids'] ?? []), 0, 300),
                fn($x) => is_string($x) && $x !== '',
            ),
        );
        $out = [];
        if ($ids) {
            $q = implode(',', array_fill(0, count($ids), '?'));
            $s = db()->prepare("SELECT id, name FROM users WHERE id IN ($q)");
            $s->execute($ids);
            while ($row = $s->fetch()) {
                $out[$row['id']] = ['name' => $row['name']];
            }
        }
        ok(['profiles' => $out]);

    /* ---------- documents ---------- */
    case 'doc':
        $path = (string) ($_GET['path'] ?? '');
        if (!validPath($path, true)) {
            fail(400, 'invalid_argument', 'Bad path.');
        }
        if (!can($path, 'r')) {
            ok(['e' => false, 'd' => null, 'v' => 'x']);
        }
        $row = docRow($path);
        if ($row) {
            guardDlpDoc($path); // v83: candidate records opened one at a time count toward the data-theft guard
        }
        ok(
            $row
                ? ['e' => true, 'd' => redactDoc($path, json_decode($row['data'])), 'v' => (string) $row['seq']]
                : ['e' => false, 'd' => null, 'v' => 'x'],
        );
    case 'col':
        $path = (string) ($_GET['path'] ?? '');
        if (!validPath($path, false)) {
            fail(400, 'invalid_argument', 'Bad path.');
        }
        ok([
            'v' => colVersionFor($path, (string) ($_GET['x'] ?? '')), // v83: counted over readable records only
            'docs' => colList(
                $path,
                $_GET['o'] ?? null,
                (string) ($_GET['d'] ?? 'asc'),
                (int) ($_GET['l'] ?? 0),
                (string) ($_GET['x'] ?? ''),
            ),
        ]);
    case 'batch':
        touchSeen(currentUser());
        $qs = array_slice((array) ($b['q'] ?? []), 0, 60);
        $res = [];
        foreach ($qs as $q) {
            $p = (string) ($q['p'] ?? '');
            $t = (string) ($q['t'] ?? '');
            $v = isset($q['v']) ? (string) $q['v'] : null;
            if ($t === 'doc') {
                if (!validPath($p, true)) {
                    $res[] = ['err' => 'Bad path.'];
                    continue;
                }
                if (!can($p, 'r')) {
                    $res[] =
                        $v === 'x' ? ['v' => 'x', 'same' => true] : ['v' => 'x', 'e' => false, 'd' => null];
                    continue;
                }
                $row = docRow($p);
                $nv = $row ? (string) $row['seq'] : 'x';
                // v83: a candidate record actually sent counts toward the data-theft guard (unchanged polls do not)
                if ($row && $nv !== $v && !guardDlpDoc($p, true)) {
                    $res[] = ['err' => 'Profile views are paused on your account. Ask an administrator to allow them again.'];
                    continue;
                }
                $res[] =
                    $nv === $v
                        ? ['v' => $nv, 'same' => true]
                        : ($row
                            ? ['v' => $nv, 'e' => true, 'd' => redactDoc($p, json_decode($row['data']))]
                            : ['v' => 'x', 'e' => false, 'd' => null]);
            } elseif ($t === 'col') {
                if (!validPath($p, false)) {
                    $res[] = ['err' => 'Bad path.'];
                    continue;
                }
                $nv = colVersionFor($p, (string) ($q['x'] ?? '')); // v83: counted over readable records only
                if ($nv === $v) {
                    $res[] = ['v' => $nv, 'same' => true];
                } elseif (isset($q['since']) && is_numeric($q['since']) && (int) $q['since'] > 0 && (int) ($q['l'] ?? 0) === 0) {
                    // the client has an earlier copy: send only what changed since then, plus the ids that still exist
                    $res[] = ['v' => $nv, 'delta' => true] + colDelta($p, (int) $q['since'], (string) ($q['x'] ?? ''));
                } else {
                    $res[] = [
                        'v' => $nv,
                        'docs' => colList(
                            $p,
                            isset($q['o']) ? (string) $q['o'] : null,
                            (string) ($q['d'] ?? 'asc'),
                            (int) ($q['l'] ?? 0),
                            (string) ($q['x'] ?? ''),
                        ),
                    ];
                }
            } else {
                $res[] = ['err' => 'Bad query.'];
            }
        }
        ok(['r' => $res]);
    case 'set':
    case 'update':
        requireUser();
        $path = (string) ($b['path'] ?? '');
        if (!validPath($path, true)) {
            fail(400, 'invalid_argument', 'Bad path.');
        }
        $data = json_decode(json_encode($b['data'] ?? null));
        if (!($data instanceof stdClass)) {
            fail(400, 'invalid_argument', 'Bad data.');
        }
        if (!can($path, 'w') && !($r === 'update' && managerWrites($path, currentUser(), $data))) {
            fail(403, 'invalid_argument', 'You can\'t change this record.');
        }
        if (financialPath($path)) {
            // v83: the record as it will be saved (an update merges into the stored one), so a payment dated after the
            // close on a closed-period invoice or bill can be told apart from a change to the closed period
            $after = $data;
            if ($r === 'update' && ($cur0 = docGet($path))) {
                $after = json_decode(json_encode($cur0));
                mergeInto($after, $data);
            }
            booksGuard($path, $data, $after); // closed periods stay closed; the change is written to the audit log below
            bankReconGuard($path, $data, $r === 'set'); // v83: finished reconciliations lock their lines
        }
        // Feature switches on a Team card (r/{id}.ft) are given and taken away by administrators only.
        $cu = currentUser();
        // v83: the shared box: a note keeps the person who added it; it is set here, never taken from the browser
        if (preg_match('#^org/box/items/[^/]+$#', $path)) {
            $prevBox = docGet($path);
            $data->by = $prevBox ? (string) ($prevBox->by ?? '') : (string) $cu['id'];
            $data->byn = $prevBox ? (string) ($prevBox->byn ?? '') : (string) ($cu['name'] ?? '');
        }
        // v83: the client's decision on a timesheet (cd) is the client's: a consultant's own mirror keeps the stored one,
        // and every change by them is a new version (so an earlier decision no longer applies)
        if (preg_match('#^pub/([^/]+)/ts/#', $path, $pm) && userLevel($cu) < 2 && !in_array($pm[1], clientCids((string) $cu['id']), true)) {
            $prevTs = docGet($path);
            if ($prevTs && isset($prevTs->cd)) {
                $data->cd = $prevTs->cd;
            } else {
                unset($data->cd);
            }
            // v83: the portal's own version stamp is kept when it is newer than the stored one, so the copy still
            // matches the submission (Approvals: "The copy shared with the client differs"); otherwise the server's
            $wasU = max((int) ($prevTs->u ?? 0), (int) ($prevTs->cd->v ?? 0));
            $data->u = is_int($data->u ?? null) && $data->u > $wasU && $data->u <= now() + 86400000 ? $data->u : max(now(), $wasU + 1);
        }
        if (preg_match('#^r/[^/]+$#', $path) && !hasRole($cu, 'admin') && property_exists($data, 'ft')) {
            $prev = docGet($path);
            if ($prev && isset($prev->ft)) {
                $data->ft = $prev->ft;
            } else {
                unset($data->ft);
            }
        }
        // v35: giving or taking away a feature switch needs a fresh confirmation (the page asks, then saves)
        if (preg_match('#^r/[^/]+$#', $path) && hasRole($cu, 'admin') && property_exists($data, 'ft')) {
            $on = function ($o): array {
                $k = array_keys(array_filter($o instanceof stdClass ? get_object_vars($o) : []));
                sort($k);
                return $k;
            };
            $prevR = docGet($path);
            $was = $prevR->ft ?? null;
            $will = $data->ft;
            if ($r === 'update' && $was instanceof stdClass && $will instanceof stdClass) {
                // an update only changes the switches it names
                $will = (object) array_merge(get_object_vars($was), get_object_vars($will));
            }
            if ($on($was) !== $on($will)) {
                requireRecentAuth();
            }
        }
        // v83: per-person feature access (fa) and the bookkeeper limits (books, nopay, ext) change only through
        // admin_feature_access and admin_books_access (administrators, "Confirm it's you", audit log); a plain record
        // write keeps whatever is saved, and a replace (set) cannot drop them either
        if (preg_match('#^r/[^/]+$#', $path)) {
            $prevCtl = docGet($path);
            foreach (['fa', 'books', 'nopay', 'ext'] as $k) {
                if ($prevCtl && property_exists($prevCtl, $k)) {
                    $data->$k = $prevCtl->$k;
                } else {
                    unset($data->$k);
                }
            }
        }
        // v83: placement rates and commissions are kept by administrators, HR and accounting; anyone else who saves a
        // placement (they read it without them, see redactDoc) leaves the stored values as they are
        if (str_starts_with($path, 'rec/place/items/') && !(hasRole($cu, 'admin') || hasRole($cu, 'hr') || hasRole($cu, 'acct'))) {
            unset($data->pay, $data->bill, $data->comm);
            if ($r === 'set' && ($prevPl = docGet($path))) {
                foreach (['pay', 'bill', 'comm'] as $k) {
                    if (property_exists($prevPl, $k)) {
                        $data->$k = $prevPl->$k;
                    }
                }
            }
        }
        $upTx = false;
        if ($r === 'update') {
            // v83: read, merge, check and write in one locked transaction, so two updates of one record at once both
            // land (the meta row update takes the write lock before the read, on SQLite and MySQL; a refusal below ends
            // the request and the open transaction is rolled back)
            $upTx = !db()->inTransaction() && db()->beginTransaction();
            if ($upTx) {
                db()->exec("UPDATE meta SET v = v WHERE k = 'seq'");
            }
            $cur = docGet($path);
            if (!$cur) {
                fail(400, 'invalid_argument', 'That record does not exist yet.');
            }
            $before = json_decode(json_encode($cur));
            mergeInto($cur, $data);
            $data = $cur;
        } else {
            $before = docGet($path);
        }
        // v83: a time-off request that was approved or declined keeps the type and dates that were decided
        if (userLevel($cu) < 2 && $path === 'u/' . (string) ($cu['id'] ?? '')) {
            leaveLockDecided((string) $cu['id'], $before instanceof stdClass ? $before : null, $data);
        }
        // v83: own clock-ins count as punched only with the punch route's signature; anything else is marked edited
        if (userLevel($cu) < 2 && preg_match('#^u/' . preg_quote((string) ($cu['id'] ?? ''), '#') . '/att/[^/]+$#', $path)) {
            attStampGuard((string) $cu['id'], $before instanceof stdClass ? $before : null, $data);
        }
        if (tsApprovedTamper($path, $before, $data, $cu)) {
            fail(409, 'conflict', 'This week is approved and locked. Ask your manager or HR to reopen it.');
        }
        // v36.2: an ATS record saved by a search becomes part of the working ATS once someone edits it
        if (preg_match('#^ats/[^/]+$#', $path)) {
            unset($data->lite);
        }
        colRoomFor($path, $data); // v83: no filling a list with huge records nobody can load
        docSet($path, $data);
        if ($upTx) {
            db()->commit();
        }
        if (financialPath($path)) {
            require_once __DIR__ . '/payroll.php';
            auditLog($before ? 'change' : 'create', $path, $before ? 'Record changed' : 'Record created', auditDiff($before, $data));
        }
        ok(['ok' => true]);
    case 'delete':
        requireUser();
        $path = (string) ($b['path'] ?? '');
        if (!validPath($path, true)) {
            fail(400, 'invalid_argument', 'Bad path.');
        }
        if (!can($path, 'w')) {
            fail(403, 'invalid_argument', 'You can\'t delete this record.');
        }
        // v83: a Team card (r/{id}) holds feature access and books limits; only an administrator removes one
        if (preg_match('#^r/[^/]+$#', $path) && !hasRole(currentUser(), 'admin')) {
            fail(403, 'invalid_argument', 'You can\'t delete this record.');
        }
        // v83: an approved timesheet week cannot be deleted by its owner (see tsApprovedTamper)
        if (tsApprovedTamper($path, docGet($path), null, currentUser())) {
            fail(409, 'conflict', 'This week is approved and locked. Ask your manager or HR to reopen it.');
        }
        if (financialPath($path)) {
            $prev = docGet($path);
            booksGuard($path, $prev);
            bankReconGuard($path, null, true); // v83: a reconciled bank line is not deleted
            docDelete($path);
            require_once __DIR__ . '/payroll.php';
            auditLog('delete', $path, 'Record deleted', ['was' => $prev ? array_intersect_key((array) $prev, array_flip(['total', 'a', 'gross', 'net', 'st', 'no', 'v', 'cn', 'd', 'dt', 'issue'])) : []]);
            ok(['ok' => true]);
        }
        docDelete($path);
        ok(['ok' => true]);

    /* ---------- files ---------- */
    case 'upload':
        requireUser();
        $base = (string) ($_POST['base'] ?? '');
        if (!validPath($base, true)) {
            fail(400, 'invalid_argument', 'Bad path.');
        }
        if (!can("$base/f/x", 'w')) {
            fail(403, 'invalid_argument', 'You can\'t upload here.');
        }
        if (!isset($_FILES['file'])) {
            fail(400, 'invalid_argument', 'No file received.');
        }
        $meta = json_decode((string) ($_POST['meta'] ?? '{}'), true);
        if (!is_array($meta)) {
            $meta = [];
        }
        ok(['doc' => storeUpload($_FILES['file'], $base, $meta)]);
    case 'file':
        $base = (string) ($_GET['base'] ?? '');
        $id = (string) ($_GET['id'] ?? '');
        if (!validPath($base, true) || !preg_match('/^[a-f0-9]{32}$/', $id)) {
            http_response_code(404);
            exit('Not found');
        }
        $path = "$base/f/$id";
        $ftok = (string) ($_GET['tok'] ?? '');
        // v83: a public signer's files are allowed by the cookie sig_public_get set (no token in the URL)
        if ($ftok === '' && preg_match('#^sig/([A-Za-z0-9_-]{1,20})$#', $base, $sm)) {
            $ftok = (string) ($_COOKIE['se_sig_' . $sm[1]] ?? '');
        }
        if (!can($path, 'r') && !tokenAllows($path, $ftok)) {
            http_response_code(404);
            exit('Not found');
        }
        $d = docGet($path);
        $f = cfg('files_dir') . "/$id";
        if (!$d || !is_file($f)) {
            http_response_code(404);
            exit('Not found');
        }
        $name = preg_replace('/[^A-Za-z0-9 ._()\-]/', '_', (string) ($d->n ?? 'file'));
        $ty = (string) ($d->ty ?? 'application/octet-stream');
        // v35: documents (not pictures shown on pages) count towards the data-theft guard
        if (!str_starts_with($ty, 'image/') && ($fu = currentUser())) {
            header('Content-Type: application/json; charset=utf-8');
            guardDlp($fu, 'file', (string) ($d->n ?? $id));
        }
        header('Content-Type: ' . $ty);
        header('Content-Length: ' . filePlainSize($f));
        // v34: a stored file is shown as itself, never run as part of the site: PDFs and pictures open inline (PDF
        // viewers need no extra rules), anything else downloads, sandboxed
        if ($ty === 'application/pdf') {
            header_remove('Content-Security-Policy');
        } else {
            header("Content-Security-Policy: default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox; frame-ancestors 'self'");
        }
        if (!str_starts_with($ty, 'image/') && !in_array($ty, ['application/pdf', 'text/plain', 'text/csv', 'text/markdown', 'application/json'], true)) {
            $_GET['dl'] = '1';
        }
        header(
            'Content-Disposition: ' .
                (($_GET['dl'] ?? '') === '1' ? 'attachment' : 'inline') .
                '; filename="' .
                $name .
                '"',
        );
        header('Cache-Control: private, max-age=300');
        fileServePath($f);
        exit();
    case 'delfile':
        requireUser();
        $base = (string) ($b['base'] ?? '');
        $id = (string) ($b['id'] ?? '');
        if (!validPath($base, true) || !preg_match('/^[a-f0-9]{32}$/', $id)) {
            fail(400, 'invalid_argument', 'Bad path.');
        }
        $path = "$base/f/$id";
        if (!can($path, 'w')) {
            fail(403, 'invalid_argument', 'You can\'t delete this file.');
        }
        docDelete($path);
        $f = cfg('files_dir') . "/$id";
        if (is_file($f)) {
            @unlink($f);
        }
        ok(['ok' => true]);

    /* ---------- website forms (no login needed) ---------- */
    case 'public_contact':
        if (throttleHit('form:' . clientIp(), (int) (cfg('public_forms_per_hour') ?: 20), 3600)) {
            fail(429, 'rate_limited', 'Too many messages from this network. Email us instead.');
        }
        $src = $_POST;
        $kind = in_array(str($src, 'k', 10), ['apply', 'talent'], true) ? str($src, 'k', 10) : 'contact';
        $m = [
            'k' => $kind,
            'n' => str($src, 'n', 120),
            'e' => strtolower(str($src, 'e', 190)),
            'ph' => str($src, 'ph', 40),
            'co' => str($src, 'co', 120),
            'sv' => str($src, 'sv', 80),
            'msg' => str($src, 'msg', 4000),
            'job' => preg_replace('/[^A-Za-z0-9_\-]/', '', str($src, 'job', 60)) ?? '',
            'jt' => str($src, 'jt', 160),
            'li' => str($src, 'li', 300),
            'at' => now(),
            'fid' => null,
        ];
        // v83: the profile link becomes a web address: "linkedin.com/in/x" gets https://, any other scheme
        // (javascript:, data:, vbscript: …) is dropped, so the inbox and the ATS card only ever link to a web page
        if ($m['li'] !== '' && !preg_match('#^https?://#i', $m['li'])) {
            $m['li'] = preg_match('#^[a-z][a-z0-9+\-]*:#i', $m['li']) ? '' : 'https://' . $m['li'];
        }
        if ($m['n'] === '' || !filter_var($m['e'], FILTER_VALIDATE_EMAIL)) {
            fail(400, 'invalid_argument', 'Add your name and a valid email.');
        }
        // v46: the visitor's time zone (the browser's), so a sequence emails a new lead in their working hours
        $tzIn = str($src, 'tz', 40);
        $m['tz'] = $tzIn !== '' && in_array($tzIn, DateTimeZone::listIdentifiers(), true) ? $tzIn : '';
        $u = currentUser();
        if (!$u) {
            $why = fwScreen($src, $kind === 'apply' ? 'application' : ($kind === 'talent' ? 'talent request' : 'contact form'));
            if ($why !== '') {
                fail(400, 'spam', 'This message could not be sent. Email us directly at ' . (string) cfg('mail_from') . '.');
            }
        }
        if ($u) {
            $m['uid'] = $u['id'];
        }
        $id = rid(6);
        $out = ['ok' => true];
        // v50: a request sent from a specialist service page names that page (only a published one), which may name
        // the person who answers it
        $pgSlug = '';
        $pgName = '';
        $pgOwn = '';
        if ($kind !== 'apply' && str($src, 'pg', 50) !== '') {
            require_once __DIR__ . '/corpweb.php';
            $pgFor = cwPageFor(str($src, 'pg', 50));
            if ($pgFor) {
                $pgSlug = $pgFor['slug'];
                $pgName = $pgFor['ti'];
                $pgOwn = $pgFor['own'];
            }
            $m['pg'] = $pgSlug;
        }
        if ($kind === 'apply') {
            // v34: an application records its consent to the privacy notice (time, version, address)
            require_once __DIR__ . '/privacy.php';
            $consent = privConsent('website application', $src);
            if (!$consent && privCfg()['consent']) {
                fail(400, 'consent', 'Please agree to the privacy notice so we can keep your application.');
            }
            require_once __DIR__ . '/ats.php';
            // v36 (MR-18): the same form sent twice gives back the same receipt; one application per person and job
            // in 30 days (applying again adds to the first one); a role that closed while the form was open is said
            $rk = substr(preg_replace('/[^A-Za-z0-9]/', '', str($src, 'rk', 60)) ?? '', 0, 40);
            if (strlen($rk) >= 12 && ($seen = docGet('ats/x/rk/' . $rk))) {
                ok(['ok' => true, 'receipt' => (string) ($seen->rcpt ?? ''), 'again' => true, 'closed' => !empty($seen->closed), 'title' => (string) ($seen->ti ?? '')]);
            }
            $pubJ = $m['job'] !== '' ? atsPublicJob($m['job']) : null;
            $closed = $m['job'] !== '' && (!$pubJ || ($pubJ->open ?? true) === false);
            $jobTi = $pubJ ? (string) ($pubJ->ti ?? '') : '';
            $dupKey = substr(hash('sha256', $m['e'] . '|' . ($m['job'] !== '' ? $m['job'] : 'general')), 0, 40);
            $prev = docGet('ats/x/applied/' . $dupKey);
            $prevC = $prev && (int) ($prev->at ?? 0) > now() - 30 * 86400000 && preg_match('/^[a-f0-9]{12}$/', (string) ($prev->aid ?? '')) ? docGet('ats/' . $prev->aid) : null;
            if ($prevC) {
                $aid = (string) $prev->aid;
                $rcpt = (string) ($prevC->rcpt ?? ('A-' . strtoupper($aid)));
                if (isset($_FILES['file']) && ($_FILES['file']['error'] ?? 1) !== UPLOAD_ERR_NO_FILE) {
                    $rf = storeUpload($_FILES['file'], "ats/$aid", ['c' => 'resume']);
                    $prevC->rid = $rf['id'];
                    $prevC->rn = $rf['n'];
                }
                atsLog($prevC, 'Website', 'Applied again' . ($m['jt'] !== '' ? ' for ' . mb_substr($m['jt'], 0, 120) : '') . (isset($rf) ? ', with a new resume' : '') . ($closed ? ' (the role had closed)' : '') . ($m['msg'] !== '' ? '. Note: ' . mb_substr($m['msg'], 0, 200) : ''));
                $prevC->u = now();
                docSet('ats/' . $aid, $prevC);
                if (strlen($rk) >= 12) {
                    docSet('ats/x/rk/' . $rk, (object) ['aid' => $aid, 'rcpt' => $rcpt, 'closed' => $closed, 'ti' => $jobTi, 'at' => now()]);
                }
                ok(['ok' => true, 'receipt' => $rcpt, 'again' => true, 'closed' => $closed, 'title' => $jobTi, 'first' => (int) ($prevC->at ?? 0)]);
            }
            $aid = rid(6);
            $rcpt = 'A-' . strtoupper($aid);
            $m['ats'] = $aid;
            $rf = null;
            if (isset($_FILES['file']) && ($_FILES['file']['error'] ?? 1) !== UPLOAD_ERR_NO_FILE) {
                $rf = storeUpload($_FILES['file'], "ats/$aid", ['c' => 'resume']);
                $m['fid'] = $rf['id'];
            }
            // v29: screening answers (with knockouts), the referral code and the voluntary EEO survey (kept apart)
            $answers = json_decode((string) ($src['answers'] ?? '{}'), true);
            $answers = is_array($answers) ? array_slice($answers, 0, 30, true) : [];
            $clean = [];
            foreach ($answers as $qid => $val) {
                $qid = preg_replace('/[^a-z0-9]/', '', (string) $qid);
                if ($qid !== '') {
                    $clean[$qid] = mb_substr(is_array($val) ? implode(', ', array_map('strval', $val)) : (string) $val, 0, 500);
                }
            }
            $ko = false;
            $koWhy = '';
            $ij = $m['job'] !== '' ? atsJob($m['job']) : null;
            if ($ij && is_array($ij['ko'] ?? null)) {
                $pubJob = atsPublicJob($m['job']);
                $qs = [];
                foreach ((array) ($pubJob->qs ?? []) as $q) {
                    if ($q instanceof stdClass && !empty($q->id)) {
                        $qs[(string) $q->id] = $q;
                    }
                }
                foreach ($ij['ko'] as $qid => $want) {
                    $qid = (string) $qid;
                    if (!isset($clean[$qid]) || $want === '' || $want === null) {
                        continue;
                    }
                    $got = mb_strtolower(trim($clean[$qid]));
                    $w = mb_strtolower(trim((string) $want));
                    $type = (string) ($qs[$qid]->type ?? 'text');
                    $pass = $type === 'number' ? (float) $got >= (float) $w : ($type === 'select' || $type === 'yesno' ? $got === $w : str_contains($got, $w));
                    if (!$pass) {
                        $ko = true;
                        $koWhy = (string) ($qs[$qid]->q ?? 'a screening question');
                        break;
                    }
                }
            }
            $ref = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($src['ref'] ?? ''));
            $rejKey = 'rejected';
            if ($ij) {
                foreach ($ij['stages'] as $sg) {
                    if ($sg['kind'] === 'rejected') {
                        $rejKey = $sg['k'];
                    }
                }
            }
            $logs = [['t' => now(), 'who' => 'Website', 'ev' => 'Applied' . ($m['jt'] !== '' ? ' for ' . $m['jt'] : '') . ($ref !== '' ? ' (referral ' . $ref . ')' : '') . ' · receipt ' . $rcpt]];
            if ($closed) {
                $logs[] = ['t' => now(), 'who' => 'Website', 'ev' => 'The role had closed when the application arrived'];
            }
            if ($ko) {
                $logs[] = ['t' => now(), 'who' => 'Screening', 'ev' => 'Did not meet a requirement: ' . mb_substr($koWhy, 0, 160)];
            }
            docSet(
                "ats/$aid",
                (object) [
                    'n' => $m['n'],
                    'e' => $m['e'],
                    'ph' => $m['ph'],
                    'job' => $m['job'],
                    'jt' => $m['jt'],
                    'li' => $m['li'],
                    'msg' => $m['msg'],
                    // v33: a job board link (?src=dice) names the board; the agent knows it came through the website
                    // v37.2: share links name their channel too (Facebook, X, WhatsApp, QR code …), kept as ch for the job page
                    'src' => $ref !== '' ? 'Referral' : (['dice' => 'Dice', 'indeed' => 'Indeed', 'linkedin' => 'LinkedIn', 'ziprecruiter' => 'ZipRecruiter', 'monster' => 'Monster', 'jooble' => 'Jooble', 'glassdoor' => 'Glassdoor', 'careerbuilder' => 'CareerBuilder', 'talent' => 'Talent.com', 'adzuna' => 'Adzuna', 'facebook' => 'Facebook', 'xcom' => 'X', 'whatsapp' => 'WhatsApp', 'telegram' => 'Telegram', 'qr' => 'QR code', 'email' => 'Shared by email'][strtolower(str($src, 'src', 20))] ?? 'Website'),
                    'ch' => substr((string) preg_replace('/[^a-z]/', '', strtolower(str($src, 'src', 20))), 0, 20) ?: ($ref !== '' ? 'referral' : 'careers'),
                    'via' => 'web',
                    'refCode' => $ref !== '' ? $ref : null,
                    'answers' => (object) $clean,
                    'st' => $ko ? $rejKey : 'new',
                    'ko' => $ko,
                    'why' => $ko ? 'Failed screening question' : null,
                    'rating' => 0,
                    'notes' => [],
                    'rid' => $rf ? $rf['id'] : null,
                    'rn' => $rf ? $rf['n'] : null,
                    'at' => now(),
                    'stAt' => now(),
                    'u' => now(),
                    'log' => $logs,
                    'consent' => $consent,
                    'rcpt' => $rcpt,
                    'jobClosed' => $closed,
                ],
            );
            docSet('ats/x/applied/' . $dupKey, (object) ['aid' => $aid, 'at' => now()]);
            if (strlen($rk) >= 12) {
                docSet('ats/x/rk/' . $rk, (object) ['aid' => $aid, 'rcpt' => $rcpt, 'closed' => $closed, 'ti' => $jobTi, 'at' => now()]);
            }
            $out = ['ok' => true, 'receipt' => $rcpt, 'closed' => $closed, 'title' => $jobTi];
            // the receipt by email (nothing the applicant typed goes into it; at most three a day to one address)
            if (!throttleHit('applyrcpt:' . $m['e'], 3, 86400)) {
                try {
                    $paras = [
                        'Thank you for applying' . ($jobTi !== '' ? ' for the ' . $jobTi . ' role' : '') . ' at StratEdge IT Consulting.',
                        'Your receipt number is ' . $rcpt . '. Mention it if you contact us about this application.',
                        $closed ? 'This role closed before your application arrived. We kept your application and will contact you if a similar role opens.' : 'Our recruiting team reviews every application. If your experience fits the role, a recruiter will contact you.',
                        'If you did not apply, you can ignore this email.',
                    ];
                    sendMail($m['e'], '', 'Application received: ' . $rcpt, implode("\n\n", $paras), emailHtml('Application received', $paras));
                } catch (Throwable $e) {
                    // the application is saved either way
                }
            }
            // v33: the screening agent looks at the application right after the answer goes back (when it is on)
            require_once __DIR__ . '/agent.php';
            agSoon();
            $eeo = json_decode((string) ($src['eeo'] ?? ''), true);
            if (is_array($eeo) && array_filter($eeo)) {
                docSet('ats/x/eeo/' . rid(8), (object) [
                    'job' => $m['job'],
                    'at' => now(),
                    'gender' => mb_substr((string) ($eeo['gender'] ?? ''), 0, 40),
                    'race' => mb_substr((string) ($eeo['race'] ?? ''), 0, 80),
                    'veteran' => mb_substr((string) ($eeo['veteran'] ?? ''), 0, 60),
                    'disability' => mb_substr((string) ($eeo['disability'] ?? ''), 0, 60),
                ]);
            }
        } elseif (isset($_FILES['file']) && ($_FILES['file']['error'] ?? 1) !== UPLOAD_ERR_NO_FILE) {
            $doc = storeUpload($_FILES['file'], 'inbox/public', ['c' => 'resume']);
            $m['fid'] = $doc['id'];
        }
        $cur = docGet('inbox/public') ?? new stdClass();
        if (!isset($cur->m) || !($cur->m instanceof stdClass)) {
            $cur->m = new stdClass();
        }
        $cur->m->$id = (object) $m;
        docSet('inbox/public', $cur);
        if ($kind !== 'apply') {
            // v29 web-to-lead: the enquiry becomes a CRM lead, assigned round-robin to the people under CRM > Settings
            try {
                $cs = docGet('crm/main/x/settings') ?? new stdClass();
                $pool = array_values(array_filter(array_map('strval', (array) ($cs->assign->pool ?? [])), fn($x) => preg_match('/^u_[a-f0-9]+$/', $x)));
                // v50: the page's own person answers its requests; the round-robin takes the rest
                $own = $pgOwn;
                if ($own === '' && $pool) {
                    $i = (int) ($cs->rr ?? 0) % count($pool);
                    $own = $pool[$i];
                    $cs->rr = $i + 1;
                    docSet('crm/main/x/settings', $cs);
                }
                $leadId = rid(10);
                // v50: the receipt names the inquiry and who replies
                $rcpt = 'Q-' . strtoupper($id);
                $ownRow = $own !== '' ? userRow($own) : null;
                $out['receipt'] = $rcpt;
                $out['owner'] = $ownRow ? (string) preg_replace('/\s.*$/', '', trim((string) $ownRow['name'])) : '';
                docSet('crm/main/lead/' . $leadId, (object) [
                    'n' => $m['n'],
                    'co' => $m['co'],
                    'e' => $m['e'],
                    'ph' => $m['ph'],
                    'ti' => '',
                    'src' => $pgName !== '' ? 'Website · ' . $pgName : 'Website',
                    'pg' => $pgSlug,
                    'rcpt' => $rcpt,
                    'k' => $kind,
                    'st' => 'New',
                    'own' => $own,
                    'need' => mb_substr(trim(($m['sv'] !== '' ? $m['sv'] . ': ' : '') . $m['msg']), 0, 300),
                    'notes' => ($kind === 'talent' ? 'Request talent form' : 'Contact form') . ' · ' . date('Y-m-d H:i'),
                    'inbox' => $id,
                    'at' => now(),
                    'by' => 'web',
                    'tz' => $m['tz'],
                    'u' => now(),
                ]);
                // v46: a sequence set to take website leads adds this one (the scheduled job sends its emails)
                require_once __DIR__ . '/seq.php';
                sqAutoLead($leadId, $kind);
                // v50: the receipt by email (nothing the visitor typed goes into it; at most three a day to one address)
                if ($kind === 'talent' && !throttleHit('inqrcpt:' . $m['e'], 3, 86400)) {
                    $paras = ['Thank you for your request to StratEdge IT Consulting' . ($pgName !== '' ? ' about ' . $pgName : '') . '.', 'Your reference is ' . $rcpt . '. ' . ($out['owner'] !== '' ? $out['owner'] . ' from our team will reply.' : 'Someone from our team will reply.'), 'If you did not send it, you can ignore this email.'];
                    sendMail($m['e'], '', 'Request received: ' . $rcpt, implode("\n\n", $paras), emailHtml('Request received', $paras));
                }
            } catch (Throwable $e) {
                // the enquiry itself was saved; the lead and its sequence are a convenience
            }
        }
        ok($out);

    /* ---------- website assistant ---------- */
    case 'chat':
        if (throttleHit('chat:' . clientIp(), (int) (cfg('assistant_messages_per_hour') ?: 40), 3600)) {
            fail(
                429,
                'rate_limited',
                'That is a lot of questions for one hour. Email info@stratedgeitconsulting.com and a person will take it from here.',
            );
        }
        if (!currentUser()) {
            $lastMsg = '';
            foreach ((array) ($b['messages'] ?? []) as $mm) {
                $lastMsg = (string) ($mm['content'] ?? $lastMsg);
            }
            if (fwScreen(['message' => $lastMsg, 'website' => $b['website'] ?? ''], 'assistant message') !== '') {
                fail(400, 'spam', 'That message could not be sent.');
            }
            // v78: the AI shield turns away a clear prompt-injection from a website visitor
            require_once __DIR__ . '/copilot.php';
            $refuse = cpShieldInbound($lastMsg, false);
            if ($refuse !== '') {
                ok(['reply' => $refuse, 'source' => 'shield']);
            }
        }
        $kb = require __DIR__ . '/knowledge.php';
        $msgs = [];
        foreach (array_slice((array) ($b['messages'] ?? []), -12) as $m) {
            $role = ($m['role'] ?? '') === 'assistant' ? 'assistant' : 'user';
            $c = mb_substr(trim((string) ($m['content'] ?? '')), 0, 1500);
            if ($c !== '') {
                $msgs[] = ['role' => $role, 'content' => $c];
            }
        }
        if (!$msgs || end($msgs)['role'] !== 'user') {
            fail(400, 'invalid_argument', 'Send a message.');
        }
        $last = end($msgs)['content'];
        if (aiReady('chat')) {
            $system =
                "You are StratEdge AI, the website assistant for StratEdge IT Consulting. Be warm, concise (under 120 words unless asked for detail) and specific. Answer general questions helpfully too. Use the facts below for anything about StratEdge; never invent prices, guarantees, client names or availability, and when unsure say so and point to info@stratedgeitconsulting.com or +1 (302) 434-8889. Plain text only, no markdown.\n\nFACTS:\n" .
                $kb['facts'];
            [$code, $j] = aiPost(['max_tokens' => 500, 'messages' => array_merge([['role' => 'system', 'content' => $system]], $msgs)], 30);
            $text = is_array($j) ? trim((string) ($j['choices'][0]['message']['content'] ?? '')) : '';
            if ($text !== '') {
                ok(['reply' => $text, 'source' => 'model']);
            }
            @error_log(
                date('c') . " assistant: the language model did not answer, used the knowledge base\n",
                3,
                storeDir() . '/error.log',
            );
        }
        $q = mb_strtolower($last);
        $best = null;
        $bestScore = 0;
        foreach ($kb['intents'] as $in) {
            $sc = 0;
            foreach ($in['keys'] as $k) {
                if (str_contains($q, $k)) {
                    $sc += strlen($k);
                }
            }
            if ($sc > $bestScore) {
                $bestScore = $sc;
                $best = $in;
            }
        }
        ok([
            'reply' => $best ? $best['a'] : $kb['default'],
            'source' => 'kb',
            'suggestions' => $kb['suggestions'],
        ]);

    /* ---------- e-signatures (portal members and external email signers) ---------- */
    case 'sig_create':
        // v45.3: anyone who may send for signature (Roles & access › E-signatures, or the whole team)
        $me = requireUser();
        require_once __DIR__ . '/esign.php';
        if (!esMaySend($me)) {
            fail(403, 'forbidden', 'Sending for signature is not switched on for your account.');
        }
        $ti = str($_POST, 'ti', 160);
        $msg = str($_POST, 'msg', 2000);
        $due = str($_POST, 'due', 10);
        $raw = json_decode((string) ($_POST['signers'] ?? '[]'), true);
        if (!is_array($raw)) {
            $raw = [];
        }
        if ($ti === '' || !$raw) {
            fail(400, 'invalid_argument', 'Add a title and at least one signer.');
        }
        if (!isset($_FILES['file'])) {
            fail(400, 'invalid_argument', 'Attach the document to sign (PDF, PNG or JPG).');
        }
        $ext = strtolower(pathinfo((string) $_FILES['file']['name'], PATHINFO_EXTENSION));
        if (!in_array($ext, ['pdf', 'png', 'jpg', 'jpeg'], true)) {
            fail(
                400,
                'invalid_argument',
                'Documents to sign must be PDF, PNG or JPG. Save Word files as PDF first.',
            );
        }
        $signers = [];
        $seen = [];
        foreach (array_slice($raw, 0, 6) as $x) {
            if (!is_array($x)) {
                continue;
            }
            if (!empty($x['uid']) && preg_match('/^u_[a-f0-9]+$/', (string) $x['uid'])) {
                $st = db()->prepare('SELECT id, name, email FROM users WHERE id = ?');
                $st->execute([$x['uid']]);
                $u = $st->fetch();
                if (!$u) {
                    fail(400, 'invalid_argument', 'One of the signers does not have an account.');
                }
                if (isset($seen[$u['id']])) {
                    continue;
                }
                $seen[$u['id']] = 1;
                $signers[] = [
                    'uid' => $u['id'],
                    'n' => $u['name'],
                    'e' => $u['email'],
                    'st' => 'pending',
                    'role' => $u['id'] === $me['id'] ? 'countersign' : 'signer',
                ];
            } else {
                if (!esMayExt($me)) {
                    fail(403, 'forbidden', 'Signers outside the portal are switched off for your account.');
                }
                $n = mb_substr(trim((string) ($x['n'] ?? '')), 0, 120);
                $e = strtolower(trim((string) ($x['e'] ?? '')));
                if ($n === '' || !filter_var($e, FILTER_VALIDATE_EMAIL)) {
                    fail(400, 'invalid_argument', 'External signers need a name and a valid email.');
                }
                if (isset($seen[$e])) {
                    continue;
                }
                $seen[$e] = 1;
                $signers[] = [
                    'n' => $n,
                    'e' => $e,
                    'st' => 'pending',
                    'role' => 'signer',
                    'tok' => rid(16),
                    'ext' => true,
                ];
            }
        }
        if (!$signers) {
            fail(400, 'invalid_argument', 'Add at least one signer.');
        }
        if (($_POST['counter'] ?? '') === '1' && !isset($seen[$me['id']])) {
            $signers[] = [
                'uid' => $me['id'],
                'n' => $me['name'],
                'e' => $me['email'],
                'st' => 'pending',
                'role' => 'countersign',
            ];
        }
        $id = rid(6);
        $base = "sig/$id";
        $now = now();
        $f = storeUpload($_FILES['file'], $base, ['c' => 'original']);
        $hash = fileHashPath(filePathOf((string) $f['id']));
        $d = (object) [
            'ti' => $ti,
            'msg' => $msg,
            'due' => $due,
            'by' => $me['id'],
            'byn' => $me['name'],
            'bye' => $me['email'],
            'at' => $now,
            'st' => 'sent',
            'cur' => 0,
            'fid' => $f['id'],
            'fn' => $f['n'],
            'fty' => $f['ty'],
            'fh' => $hash,
            'signers' => $signers,
            'log' => [['t' => $now, 'who' => $me['name'], 'ev' => 'Sent for signature', 'ip' => clientIp()]],
        ];
        sigNotify($d, $id, 0);
        docSet($base, $d);
        ok(['id' => $id]);
    case 'sig_public_get':
        // v83: the signer's token comes in the POST body, never the query string (access logs, history); the
        // document's file links then ride on a short-lived HttpOnly cookie instead of ?tok=
        $id = str($b, 'id', 20);
        $tok = str($b, 'tok', 40);
        $d = docGet("sig/$id");
        $i = $d ? sigIndexByTok($d, $tok) : -1;
        if ($i < 0) {
            fail(404, 'not_found', 'This signing link is not valid.');
        }
        if (preg_match('/^[A-Za-z0-9_-]{1,20}$/', $id)) {
            setcookie('se_sig_' . $id, $tok, ['expires' => time() + 43200, 'path' => '/', 'secure' => sessSecure(), 'httponly' => true, 'samesite' => 'Strict']);
        }
        $pub = [
            'id' => $id,
            'ti' => $d->ti,
            'msg' => $d->msg ?? '',
            'byn' => $d->byn,
            'at' => $d->at,
            'due' => $d->due ?? '',
            'st' => $d->st,
            'cur' => $d->cur ?? 0,
            'fid' => $d->fid,
            'fn' => $d->fn,
            'fty' => $d->fty,
            'fh' => $d->fh ?? '',
            'sfid' => $d->sfid ?? null,
            'done' => $d->done ?? null,
            'me' => $i,
            // v45.3: one after the other or in any order, the fields this signer fills in, and when it closes
            'order' => (string) ($d->order ?? 'seq'),
            'fields' => array_values(array_filter((array) ($d->fields ?? []), fn($fl) => (int) $fl->s === $i)),
            'exp' => (int) ($d->exp ?? 0),
            'signers' => array_map(
                fn($s) => ['n' => $s->n, 'st' => $s->st, 'role' => $s->role ?? 'signer'],
                (array) $d->signers,
            ),
        ];
        ok(['d' => $pub]);
    case 'sig_viewed':
        $id = str($b, 'id', 20);
        $d = docGet("sig/$id");
        if (!$d) {
            fail(404, 'not_found', 'No such request.');
        }
        $who = sigActor($d, $b);
        if (!$who) {
            fail(404, 'not_found', 'No such request.');
        }
        $log = (array) $d->log;
        $last = end($log);
        if (!$last || ($last->who ?? '') !== $who['n'] || ($last->ev ?? '') !== 'Viewed the document') {
            $log[] = (object) [
                't' => now(),
                'who' => $who['n'],
                'ev' => 'Viewed the document',
                'ip' => clientIp(),
            ];
            $d->log = $log;
            docSet("sig/$id", $d);
        }
        ok(['ok' => true]);
    case 'sig_sign':
        $id = str($_POST, 'id', 20);
        $d = docGet("sig/$id");
        if (!$d) {
            fail(404, 'not_found', 'No such request.');
        }
        $who = sigActor($d, $_POST);
        if (!$who) {
            fail(404, 'not_found', 'No such request.');
        }
        if (($d->st ?? '') !== 'sent') {
            fail(400, 'invalid_argument', 'This request is no longer open for signing.');
        }
        // v45.3: a request past its closing date cannot be signed
        if ((int) ($d->exp ?? 0) > 0 && (int) $d->exp < now()) {
            fail(400, 'invalid_argument', 'This request has expired. Ask the sender to send it again.');
        }
        $signers = (array) $d->signers;
        $any = ($d->order ?? 'seq') === 'any';
        // one after the other: only the signer whose turn it is; in any order (v45.3): anyone who has not signed yet
        $i = $any ? (int) $who['i'] : (int) ($d->cur ?? 0);
        if (!isset($signers[$i]) || $i !== $who['i'] || ($signers[$i]->st ?? '') !== 'pending') {
            fail(400, 'invalid_argument', $any ? 'You have signed this already.' : 'It is not your turn to sign yet.');
        }
        // v45.3: the signature must be on the newest copy (in any order two people can sign at the same moment)
        $onCopy = str($_POST, 'base', 40);
        if ($onCopy !== '' && $onCopy !== ((string) ($d->sfid ?? '') !== '' ? (string) $d->sfid : (string) $d->fid)) {
            fail(409, 'conflict', 'Someone signed a moment ago, so your signature goes on the newest copy. Sign again.');
        }
        if (($_POST['consent'] ?? '') !== '1') {
            fail(400, 'invalid_argument', 'Please confirm that you agree to sign electronically.');
        }
        $name = str($_POST, 'name', 120);
        if ($name === '') {
            fail(400, 'invalid_argument', 'Type your full name as your signature.');
        }
        // v45.3: what this signer typed into their fields (text and checkboxes); the required ones must be filled in
        $vals = json_decode((string) ($_POST['vals'] ?? '{}'), true);
        $vals = is_array($vals) ? $vals : [];
        $filled = [];
        foreach ((array) ($d->fields ?? []) as $fl) {
            if ((int) $fl->s !== $i) {
                continue;
            }
            if ($fl->k === 'text') {
                $v = mb_substr(trim((string) ($vals[$fl->id] ?? '')), 0, 300);
                if (!empty($fl->req) && $v === '') {
                    fail(400, 'invalid_argument', 'Fill in every required field' . ((string) ($fl->lbl ?? '') !== '' ? ' (' . $fl->lbl . ')' : '') . '.');
                }
                $filled[$fl->id] = $v;
            } elseif ($fl->k === 'check') {
                $v = !empty($vals[$fl->id]);
                if (!empty($fl->req) && !$v) {
                    fail(400, 'invalid_argument', 'Tick every required box' . ((string) ($fl->lbl ?? '') !== '' ? ' (' . $fl->lbl . ')' : '') . '.');
                }
                $filled[$fl->id] = $v;
            }
        }
        if (
            !isset($_FILES['file']) ||
            strtolower(pathinfo((string) $_FILES['file']['name'], PATHINFO_EXTENSION)) !== 'pdf'
        ) {
            fail(400, 'invalid_argument', 'The signed copy did not come through. Try again.');
        }
        // v83: the signed copy must carry the copy it was signed on (every page, image and font of it), not another document
        $onFid = (string) ($d->sfid ?? '') !== '' ? (string) $d->sfid : (string) $d->fid;
        $onTy = (string) ($d->sfid ?? '') !== '' ? 'application/pdf' : (string) ($d->fty ?? '');
        $was = fileRead($onFid);
        $got = (string) @file_get_contents((string) $_FILES['file']['tmp_name']);
        if ($was === null || !sigKeepsCopy($was, $onTy, $got)) {
            fail(400, 'invalid_argument', 'The signed copy does not match the document you were asked to sign. Reload the page and sign again.');
        }
        unset($was, $got);
        $base = "sig/$id";
        $f = storeUpload($_FILES['file'], $base, ['c' => 'signed']);
        $now = now();
        $signers[$i]->st = 'signed';
        $signers[$i]->at = $now;
        $signers[$i]->ip = clientIp();
        $signers[$i]->ua = mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 200);
        $signers[$i]->typed = $name;
        $signers[$i]->sfid = $f['id'];
        $signers[$i]->sh = fileHashPath(filePathOf((string) $f['id']));
        $signers[$i]->vals = (object) $filled;
        $d->signers = $signers;
        // one after the other: the next signer's turn; in any order: how many have signed
        $d->cur = $any ? count(array_filter($signers, fn($sg) => ($sg->st ?? '') === 'signed')) : $i + 1;
        $d->sfid = $f['id'];
        $d->sfn = $f['n'];
        $log = (array) $d->log;
        $log[] = (object) [
            't' => $now,
            'who' => $who['n'],
            'ev' => 'Signed as "' . $name . '" (signed copy SHA-256 ' . substr((string) $signers[$i]->sh, 0, 16) . '…)',
            'ip' => clientIp(),
        ];
        if ($d->cur >= count($signers)) {
            $d->st = 'completed';
            $d->done = $now;
            $log[] = (object) [
                't' => $now,
                'who' => 'System',
                'ev' => 'All signatures collected',
                'ip' => '',
            ];
            $d->log = $log;
            sigComplete($d, $id);
        } else {
            $d->log = $log;
            if (!$any) {
                sigNotify($d, $id, $d->cur);
            }
        }
        docSet($base, $d);
        ok(['st' => $d->st]);
    case 'sig_decline':
        $id = str($b, 'id', 20);
        $d = docGet("sig/$id");
        if (!$d) {
            fail(404, 'not_found', 'No such request.');
        }
        $who = sigActor($d, $b);
        if (!$who) {
            fail(404, 'not_found', 'No such request.');
        }
        if (($d->st ?? '') !== 'sent') {
            fail(400, 'invalid_argument', 'This request is no longer open.');
        }
        $reason = str($b, 'reason', 500);
        $signers = (array) $d->signers;
        $signers[$who['i']]->st = 'declined';
        $signers[$who['i']]->at = now();
        $signers[$who['i']]->reason = $reason;
        $d->signers = $signers;
        $d->st = 'declined';
        $log = (array) $d->log;
        $log[] = (object) [
            't' => now(),
            'who' => $who['n'],
            'ev' => 'Declined to sign' . ($reason !== '' ? ': ' . $reason : ''),
            'ip' => clientIp(),
        ];
        $d->log = $log;
        docSet("sig/$id", $d);
        if (!empty($d->bye)) {
            sendMail(
                $d->bye,
                $d->byn,
                'Declined: ' . $d->ti,
                "{$who['n']} declined to sign \"{$d->ti}\"." . ($reason !== '' ? "\nReason: $reason" : ''),
                emailHtml(
                    'Signature declined',
                    [
                        "{$who['n']} declined to sign \"{$d->ti}\"." .
                        ($reason !== '' ? " Reason: $reason" : ''),
                    ],
                    ['Open in the admin portal', siteUrl() . '#/portal/admin/esign'],
                ),
            );
        }
        ok(['ok' => true]);
    case 'sig_cancel':
        // v45.3: its sender or an e-signature manager
        $me = requireUser();
        require_once __DIR__ . '/esign.php';
        $id = str($b, 'id', 20);
        $d = docGet("sig/$id");
        if (!$d || !esCanRead($d, $me)) {
            fail(404, 'not_found', 'No such request.');
        }
        if (!esCanRun($d, $me)) {
            fail(403, 'forbidden', 'Only the sender or an e-signature manager cancels a request.');
        }
        $d->st = 'cancelled';
        $log = (array) $d->log;
        $log[] = (object) [
            't' => now(),
            'who' => $me['name'],
            'ev' => 'Cancelled the request',
            'ip' => clientIp(),
        ];
        $d->log = $log;
        docSet("sig/$id", $d);
        ok(['ok' => true]);
    case 'sig_remind':
        // v45.3: its sender or an e-signature manager; everyone the request waits for (in any order, all who have not signed)
        $me = requireUser();
        require_once __DIR__ . '/esign.php';
        $id = str($b, 'id', 20);
        $d = docGet("sig/$id");
        if (!$d || !esCanRun($d, $me)) {
            fail(404, 'not_found', 'No such request.');
        }
        if (($d->st ?? '') !== 'sent') {
            fail(400, 'invalid_argument', 'Only open requests can be resent.');
        }
        $sent = false;
        foreach (esWaitingFor($d) as $wi) {
            $sent = sigNotify($d, $id, $wi, true) || $sent;
        }
        $log = (array) $d->log;
        $log[] = (object) [
            't' => now(),
            'who' => $me['name'],
            'ev' => $sent ? 'Reminder emailed' : 'Reminder attempted (email not delivered)',
            'ip' => clientIp(),
        ];
        $d->log = $log;
        docSet("sig/$id", $d);
        ok(['mailed' => $sent]);

    /* ---------- clock and break punches: server time, network address and location ---------- */
    case 'punch':
        $u = requireUser();
        $ev = str($b, 'ev', 4);
        if (!in_array($ev, ['in', 'out', 'bi', 'bo'], true)) {
            fail(400, 'invalid_argument', 'Bad punch.');
        }
        $pos = null;
        if (isset($b['pos']) && is_array($b['pos'])) {
            $lat = (float) ($b['pos']['lat'] ?? 0);
            $lng = (float) ($b['pos']['lng'] ?? 0);
            if ($lat >= -90 && $lat <= 90 && $lng >= -180 && $lng <= 180 && !($lat === 0.0 && $lng === 0.0)) {
                $pos = [
                    'lat' => round($lat, 5),
                    'lng' => round($lng, 5),
                    'acc' => (int) ($b['pos']['acc'] ?? 0),
                ];
            }
        }
        $posErr = $pos ? '' : str($b, 'posErr', 20);
        $ip = clientIp();
        $geo = geoLookup($ip);
        $now = now();
        $id = rid(6);
        $rec = (object) [
            't' => $now,
            'ip' => $ip,
            'ua' => mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 240),
            'how' => 'punch',
            'ev' => $ev,
            'geo' => $geo,
            'pos' => $pos ? (object) $pos : null,
            'posErr' => $posErr,
        ];
        docSet("log/{$u['id']}/items/$id", $rec);
        $d =
            docGet("log/{$u['id']}") ??
            (object) ['n' => 0, 'name' => $u['name'], 'email' => $u['email'], 'role' => $u['role']];
        $d->seen = $now;
        $d->lastEv = $rec;
        docSet("log/{$u['id']}", $d);
        $g = $geo ? (string) ($geo['label'] ?? '') : '';
        ok([
            't' => $now,
            'ip' => $ip,
            'g' => $g,
            'pos' => $pos,
            'posErr' => $posErr,
            // v83: signed, so the attendance record can show this punch as real (attStampGuard)
            'k' => punchMac((string) $u['id'], $ev, $now, (string) $ip, $g, $pos),
        ]);

    /* ---------- precise sign-in location (browser geolocation, with the person's permission) ---------- */
    case 'login_geo':
        $u = requireUser();
        $lat = (float) ($b['lat'] ?? 0);
        $lng = (float) ($b['lng'] ?? 0);
        $acc = (int) ($b['acc'] ?? 0);
        $posErr = str($b, 'posErr', 20);
        $has = $lat >= -90 && $lat <= 90 && $lng >= -180 && $lng <= 180 && !($lat === 0.0 && $lng === 0.0);
        if (!$has && $posErr === '') {
            fail(400, 'invalid_argument', 'Bad coordinates.');
        }
        $lid = (string) ($_SESSION['login_id'] ?? '');
        if ($lid === '') {
            ok(['ok' => false]);
        }
        $pos = $has ? ['lat' => round($lat, 5), 'lng' => round($lng, 5), 'acc' => $acc, 't' => now()] : null;
        $rec = docGet("log/{$u['id']}/items/$lid");
        if ($rec) {
            if ($pos) {
                $rec->pos = (object) $pos;
                $rec->posErr = '';
            } elseif (empty($rec->pos)) {
                $rec->posErr = $posErr;
            }
            docSet("log/{$u['id']}/items/$lid", $rec);
        }
        $d = docGet("log/{$u['id']}");
        if ($d && ($d->lastId ?? '') === $lid) {
            if ($pos) {
                $d->last->pos = (object) $pos;
                $d->last->posErr = '';
            } elseif (empty($d->last->pos)) {
                $d->last->posErr = $posErr;
            }
            docSet("log/{$u['id']}", $d);
        }
        ok(['ok' => true]);

    /* ---------- ATS and payroll email ---------- */
    case 'ats_email':
        // v83: ATS staff only (admins, HR, the ATS feature), as every other ATS route; a plain candidate id
        require_once __DIR__ . '/ats.php';
        $me = atsStaff(true);
        $id = preg_replace('/[^A-Za-z0-9_\-]/', '', str($b, 'id', 40));
        if ($id === '') {
            fail(404, 'not_found', 'No such candidate.');
        }
        $d = docGet("ats/$id");
        if (!$d) {
            fail(404, 'not_found', 'No such candidate.');
        }
        $subject = str($b, 'subject', 200);
        $body = str($b, 'body', 6000);
        if ($subject === '' || $body === '') {
            fail(400, 'invalid_argument', 'Add a subject and a message.');
        }
        $ok = sendMail(
            (string) $d->e,
            (string) $d->n,
            $subject,
            $body,
            emailHtml($subject, preg_split('/\n{2,}/', $body)),
            [],
            (string) $me['email'],
        );
        $log = (array) ($d->log ?? []);
        $log[] = (object) [
            't' => now(),
            'who' => $me['name'],
            'ev' => ($ok ? 'Emailed: ' : 'Email failed: ') . $subject,
        ];
        $d->log = $log;
        $d->u = now();
        docSet("ats/$id", $d);
        ok(['mailed' => $ok]);
    case 'pay_email':
        $me = requireAdmin();
        $path = str($_POST, 'path', 120);
        if (!preg_match('#^pays/(u_[a-f0-9]+)/items/([0-9]{4}-[0-9]{2}(?:-[0-9]{1,2})?)$#', $path, $mm)) {
            fail(400, 'invalid_argument', 'Bad paystub path.');
        }
        $d = docGet($path);
        if (!$d) {
            fail(404, 'not_found', 'Finalize the payroll run first.');
        }
        if (
            !isset($_FILES['file']) ||
            strtolower(pathinfo((string) $_FILES['file']['name'], PATHINFO_EXTENSION)) !== 'pdf'
        ) {
            fail(400, 'invalid_argument', 'The paystub PDF did not come through.');
        }
        $st = db()->prepare('SELECT name, email FROM users WHERE id = ?');
        $st->execute([$mm[1]]);
        $u = $st->fetch();
        if (!$u) {
            fail(404, 'not_found', 'No such employee.');
        }
        $f = storeUpload($_FILES['file'], $path, ['c' => 'paystub']);
        $ok = sendMail(
            $u['email'],
            $u['name'],
            'Your paystub for ' . $mm[2],
            "Your paystub for {$mm[2]} is attached. You can also download it from the Earnings page in your portal.",
            emailHtml(
                'Paystub: ' . $mm[2],
                [
                    "Your paystub for {$mm[2]} is attached as a PDF. It is also available under Earnings in your StratEdge portal.",
                ],
                ['Open your portal', siteUrl() . '#/portal/pay'],
            ),
            [
                [
                    'name' => $f['n'],
                    'type' => 'application/pdf',
                    'data' => (string) fileRead((string) $f['id']),
                ],
            ],
            (string) $me['email'],
        );
        $d->fid = $f['id'];
        $d->fn = $f['n'];
        $d->emailed = $ok ? now() : $d->emailed ?? null;
        $d->u = now();
        docSet($path, $d);
        ok(['mailed' => $ok]);

    /* ---------- invoices ---------- */
    case 'inv_next':
        requireAdmin();
        // v83: numbering an invoice is a books change: administrators and bookkeepers with full books access
        if (!can('org/acct/x', 'w')) {
            fail(403, 'forbidden', 'Invoices are for administrators and the accounts team.');
        }
        ok(['num' => invNext()]);
    case 'inv_send':
        $me = requireAdmin();
        $id = str($_POST, 'id', 20);
        $d = docGet("inv/$id");
        if (!$d) {
            fail(404, 'not_found', 'No such invoice.');
        }
        // v83: sending replaces the invoice PDF and the client's copy: only who may change the invoice itself
        // (administrators and bookkeepers with full books access; not HR, not view-only or reports-only books)
        if (!can("inv/$id", 'w')) {
            fail(403, 'forbidden', 'Invoices are for administrators and the accounts team.');
        }
        if (
            !isset($_FILES['file']) ||
            strtolower(pathinfo((string) $_FILES['file']['name'], PATHINFO_EXTENSION)) !== 'pdf'
        ) {
            fail(400, 'invalid_argument', 'The invoice PDF did not come through.');
        }
        $to = strtolower(str($_POST, 'to', 190));
        if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
            fail(400, 'invalid_argument', 'Enter a valid email address to send the invoice to.');
        }
        $cc = str($_POST, 'cc', 300);
        $note = str($_POST, 'note', 2000);
        $f = storeUpload($_FILES['file'], "inv/$id", ['c' => 'invoice']);
        $now = now();
        if (empty($d->tok)) {
            $d->tok = rid(16);
        }
        $d->fid = $f['id'];
        $d->fn = $f['n'];
        $d->to = $to;
        $d->cc = $cc;
        if (($d->st ?? 'draft') === 'draft') {
            $d->st = 'sent';
        }
        $d->sentAt = $now;
        $d->u = $now;
        $link = siteUrl() . '#/invoice/' . $id . '/' . $d->tok;
        $amt = money((float) ($d->total ?? 0), (string) ($d->cur ?? 'USD'));
        $paras = [
            "Please find invoice {$d->num} from StratEdge IT Consulting for $amt, due " .
            ($d->due ?? '') .
            '.',
            $note !== '' ? $note : '',
            'The PDF is attached. You can also view and download it online.',
        ];
        $ok = sendMail(
            $to,
            (string) ($d->bill->n ?? ''),
            "Invoice {$d->num} from StratEdge IT Consulting ($amt)",
            "Invoice {$d->num} for $amt, due {$d->due}.\n$note\n\nView online: $link",
            emailHtml(
                "Invoice {$d->num}",
                array_values(array_filter($paras)),
                ['View invoice', $link],
                'Questions about this invoice? Reply to this email.',
            ),
            [
                [
                    'name' => $f['n'],
                    'type' => 'application/pdf',
                    'data' => (string) fileRead((string) $f['id']),
                ],
            ],
            (string) $me['email'],
            $cc,
        );
        $log = (array) ($d->log ?? []);
        $log[] = (object) [
            't' => $now,
            'who' => $me['name'],
            'ev' => ($ok ? 'Emailed to ' : 'Email failed to ') . $to . ($cc !== '' ? " (cc $cc)" : ''),
            'ip' => clientIp(),
        ];
        $d->log = $log;
        docSet("inv/$id", $d);
        if (!empty($d->cid)) {
            docSet("pub/{$d->cid}/inv/$id", invMirror($d, $id));
        }
        ok(['mailed' => $ok, 'link' => $link]);
    case 'inv_public_get':
        $id = str($_GET, 'id', 20);
        $tok = str($_GET, 'tok', 40);
        $d = docGet("inv/$id");
        if (!$d || empty($d->tok) || $d->tok !== $tok) {
            fail(404, 'not_found', 'This invoice link is not valid.');
        }
        if (($d->st ?? '') === 'sent') {
            $d->st = 'viewed';
            $d->viewedAt = now();
            $log = (array) ($d->log ?? []);
            $log[] = (object) [
                't' => now(),
                'who' => (string) ($d->bill->n ?? 'Recipient'),
                'ev' => 'Viewed the invoice online',
                'ip' => clientIp(),
            ];
            $d->log = $log;
            docSet("inv/$id", $d);
            if (!empty($d->cid)) {
                docSet("pub/{$d->cid}/inv/$id", invMirror($d, $id));
            }
        }
        ok(['d' => invMirror($d, $id)]);

    /* ---------- end-of-day report: share by email too ---------- */
    case 'eod_notify':
        $u = requireUser();
        // v83: the daily report is for the recruiting team (the same people who may write rec/eod/items), and it is
        // throttled: it mails the site's own EOD inbox from the site's From address
        if (userLevel($u) < 2 && !isRecruiter((string) $u['id']) && !isBench((string) $u['id'])) {
            fail(403, 'forbidden', 'Only the recruiting team sends daily reports.');
        }
        if (throttleHit('eod:' . $u['id'], 6, 3600)) {
            fail(429, 'rate_limited', 'Daily reports were sent several times in the last hour. Try again later.');
        }
        $to = array_values(
            array_filter(
                array_map('trim', explode(',', (string) cfg('eod_emails'))),
                fn($x) => filter_var($x, FILTER_VALIDATE_EMAIL),
            ),
        );
        $subject = 'EOD report: ' . preg_replace('/[\r\n\t]+/', ' ', (string) $u['name']) . ' ' . preg_replace('/[^0-9-]/', '', str($b, 'date', 20));
        $text = str($b, 'text', 6000);
        $sent = false;
        if ($to && $text !== '') {
            // v83: through the site's mailer (configured transport, sent log, suppression, encoded subject), not raw mail()
            foreach ($to as $addr) {
                $sent = sendMail($addr, '', $subject, $text, '', [], (string) $u['email']) || $sent;
            }
        }
        ok(['mailed' => (bool) $sent, 'recipients' => count($to)]);

    /* ---------- Careers: send a job to people (staff and recruiters), public "email this job to someone" ---------- */
    case 'job_recipients':
        $u = requireUser();
        $staff = userLevel($u) >= 2;
        if (!$staff && !isRecruiter($u['id'])) {
            fail(403, 'invalid_argument', 'Only StratEdge staff can send jobs.');
        }
        $out = ['portal' => [], 'rec' => [], 'ats' => []];
        foreach (colList('r', null, 'asc', 0) as [$uid, $r]) {
            if (($r->st ?? '') !== 'active' || ($r->role ?? '') === 'employer') {
                continue;
            }
            $root = docGet("u/$uid");
            $pp = $root->p ?? null;
            if (!$pp || empty($pp->e)) {
                continue;
            }
            $out['portal'][] = [
                'uid' => $uid,
                'n' => (string) $pp->n,
                'e' => (string) $pp->e,
                'ti' => (string) ($pp->ti ?? ''),
                'loc' => (string) ($pp->loc ?? ''),
                'role' => (string) ($r->role ?? 'consultant'),
            ];
        }
        if ($staff || isRecruiter($u['id'])) {
            foreach (colList('rec/cand/items', 'n', 'asc', 0) as [$id, $c]) {
                if (empty($c->e) || ($c->st ?? 'active') !== 'active') {
                    continue;
                }
                $out['rec'][] = [
                    'id' => $id,
                    'n' => (string) ($c->n ?? ''),
                    'e' => (string) $c->e,
                    'ti' => (string) ($c->ti ?? ''),
                    'loc' => (string) ($c->loc ?? ''),
                    'sk' => (string) ($c->sk ?? ''),
                ];
            };
        }
        if ($staff) {
            foreach (colList('ats', 'u', 'desc', 400) as [$id, $c]) {
                if (empty($c->e) || in_array($c->st ?? '', ['rejected', 'hired'], true)) {
                    continue;
                }
                $out['ats'][] = [
                    'id' => $id,
                    'n' => (string) ($c->n ?? ''),
                    'e' => (string) $c->e,
                    'ti' => (string) ($c->jt ?? ''),
                    'st' => (string) ($c->st ?? ''),
                ];
            };
        }
        ok($out);
    case 'job_send':
        $u = requireUser();
        $staff = userLevel($u) >= 2;
        if (!$staff && !isRecruiter($u['id'])) {
            fail(403, 'invalid_argument', 'Only StratEdge staff can send jobs.');
        }
        $id = str($b, 'id', 40);
        if (!preg_match('/^[A-Za-z0-9_\-]+$/', $id)) {
            fail(400, 'invalid_argument', 'Bad job.');
        }
        $job = docGet("org/site/jobs/$id");
        if (!$job) {
            fail(404, 'not_found', 'That job no longer exists.');
        }
        if (($job->open ?? true) === false) {
            fail(
                400,
                'invalid_argument',
                'This job is closed on the Careers page. Reopen it before sending.',
            );
        }
        $subject = str($b, 'subject', 200);
        $msg = str($b, 'message', 4000);
        if ($subject === '') {
            $subject = 'Job opportunity: ' . $job->ti . ' at StratEdge IT Consulting';
        }
        $to = [];
        $seen = [];
        foreach (array_slice((array) ($b['to'] ?? []), 0, 100) as $x) {
            if (!is_array($x)) {
                continue;
            }
            $e = strtolower(trim((string) ($x['e'] ?? '')));
            if (!filter_var($e, FILTER_VALIDATE_EMAIL) || isset($seen[$e])) {
                continue;
            }
            $seen[$e] = 1;
            $to[] = [
                'e' => $e,
                'n' => mb_substr(trim((string) ($x['n'] ?? '')), 0, 120),
                'uid' => preg_match('/^u_[a-f0-9]+$/', (string) ($x['uid'] ?? '')) ? (string) $x['uid'] : '',
            ];
        }
        if (!$to) {
            fail(400, 'invalid_argument', 'Pick at least one person with a valid email.');
        }
        if (throttleHit('jobsend:' . $u['id'], 500, 3600)) {
            fail(429, 'rate_limited', 'That is a lot of emails for one hour. Try again later.');
        }
        $link = siteUrl() . '#/careers/' . $id;
        $facts = implode(
            ' · ',
            array_values(
                array_filter([
                    (string) ($job->loc ?? ''),
                    (string) ($job->ty ?? ''),
                    (string) ($job->md ?? ''),
                ]),
            ),
        );
        $desc = trim((string) ($job->d ?? ''));
        if (mb_strlen($desc) > 900) {
            $desc = mb_substr($desc, 0, 900) . '…';
        }
        $sent = [];
        $failed = [];
        $now = now();
        foreach ($to as $r) {
            $paras = array_values(
                array_filter([
                    $r['n'] !== '' ? 'Hi ' . explode(' ', $r['n'])[0] . ',' : 'Hello,',
                    $msg !== '' ? $msg : "We have an opening that may fit you: {$job->ti}.",
                    $job->ti . ($facts !== '' ? ' (' . $facts . ')' : ''),
                    !empty($job->sk) ? 'Skills: ' . $job->sk : '',
                    $desc,
                ]),
            );
            $text =
                ($r['n'] !== '' ? "Hi {$r['n']},\n\n" : '') .
                ($msg !== '' ? $msg . "\n\n" : '') .
                "{$job->ti}" .
                ($facts !== '' ? " ($facts)" : '') .
                "\n" .
                (!empty($job->sk) ? "Skills: {$job->sk}\n" : '') .
                "\n$desc\n\nView and apply: $link\n\n{$u['name']}, StratEdge IT Consulting";
            $okm = sendMail(
                $r['e'],
                $r['n'],
                $subject,
                $text,
                emailHtml(
                    $job->ti,
                    $paras,
                    ['View and apply', $link],
                    'Sent by ' .
                        $u['name'] .
                        ' at StratEdge IT Consulting. Reply to this email to reach them.',
                ),
                [],
                $u['email'],
            );
            if ($okm) {
                $sent[] = $r['e'];
            } else {
                $failed[] = $r['e'];
            }
            if ($r['uid'] !== '') {
                // portal members also see it under "Sent to you" in their portal
                docSet(
                    "u/{$r['uid']}/jobs/$id",
                    (object) [
                        'ti' => $job->ti,
                        'loc' => $job->loc ?? '',
                        'ty' => $job->ty ?? '',
                        'md' => $job->md ?? '',
                        'sk' => $job->sk ?? '',
                        'at' => $now,
                        'by' => $u['id'],
                        'byn' => $u['name'],
                        'msg' => $msg,
                        'mailed' => (bool) $okm,
                    ],
                );
            }
        }
        $log = (array) ($job->sent ?? []);
        $log[] = (object) [
            't' => $now,
            'by' => $u['id'],
            'byn' => $u['name'],
            'n' => count($sent),
            'to' => array_slice(array_map(fn($r) => $r['n'] !== '' ? $r['n'] : $r['e'], $to), 0, 40),
            'failed' => count($failed),
        ];
        $job->sent = array_slice($log, -50);
        $job->sentN = (int) ($job->sentN ?? 0) + count($sent);
        docSet("org/site/jobs/$id", $job);
        ok(['sent' => count($sent), 'failed' => $failed]);
    case 'public_share':
        if (throttleHit('share:' . clientIp(), (int) (cfg('public_forms_per_hour') ?: 20), 3600)) {
            fail(429, 'rate_limited', 'Too many shares from this network. Copy the link instead.');
        }
        $id = str($b, 'id', 40);
        if (!preg_match('/^[A-Za-z0-9_\-]+$/', $id)) {
            fail(400, 'invalid_argument', 'Bad job.');
        }
        $job = docGet("org/site/jobs/$id");
        if (!$job || ($job->open ?? true) === false) {
            fail(404, 'not_found', 'That job is no longer open.');
        }
        $toE = strtolower(str($b, 'to_e', 190));
        $toN = str($b, 'to_n', 120);
        $fromN = str($b, 'from_n', 120);
        // v83: screen the visitor's note that is actually emailed (the form sends it as msg, never note)
        if (!currentUser() && fwScreen(['email' => $toE, 'name' => $fromN . ' ' . $toN, 'message' => str($b, 'msg', 1000), 'website' => $b['website'] ?? '', 't0' => $b['t0'] ?? 0], 'job share') !== '') {
            fail(400, 'spam', 'That share could not be sent. Copy the link instead.');
        }
        $fromE = strtolower(str($b, 'from_e', 190));
        $msg = str($b, 'msg', 1000);
        if (!filter_var($toE, FILTER_VALIDATE_EMAIL) || $fromN === '') {
            fail(400, 'invalid_argument', 'Add your name and a valid email address for the person.');
        }
        $link = siteUrl() . '#/careers/' . $id;
        $facts = implode(
            ' · ',
            array_values(
                array_filter([
                    (string) ($job->loc ?? ''),
                    (string) ($job->ty ?? ''),
                    (string) ($job->md ?? ''),
                ]),
            ),
        );
        $paras = array_values(
            array_filter([
                $toN !== '' ? "Hi $toN," : 'Hello,',
                "$fromN thought this role at StratEdge IT Consulting might fit you" .
                ($msg !== '' ? ":\n\n\"$msg\"" : '.'),
                $job->ti . ($facts !== '' ? ' (' . $facts . ')' : ''),
                !empty($job->sk) ? 'Skills: ' . $job->sk : '',
            ]),
        );
        $okm = sendMail(
            $toE,
            $toN,
            "$fromN shared a job with you: {$job->ti}",
            ($toN !== '' ? "Hi $toN,\n\n" : '') .
                "$fromN thought this role might fit you" .
                ($msg !== '' ? ":\n\"$msg\"" : '.') .
                "\n\n{$job->ti}" .
                ($facts !== '' ? " ($facts)" : '') .
                "\n\nView and apply: $link",
            emailHtml(
                $job->ti,
                $paras,
                ['View and apply', $link],
                'Shared through the StratEdge Careers page.',
            ),
            [],
            filter_var($fromE, FILTER_VALIDATE_EMAIL) ? $fromE : '',
        );
        $job->shares = (int) ($job->shares ?? 0) + 1;
        docSet("org/site/jobs/$id", $job);
        ok(['mailed' => (bool) $okm]);

    /* ---------- job matching, built in (api/jobs.php): resume profiles, collected jobs, matches, sources ---------- */
    case 'jobs_me':
    case 'jobs_prefs':
    case 'jobs_resume':
    case 'jobs_resume_edit':
    case 'jobs_matches':
    case 'jobs_mark':
    case 'jobs_rematch':
    case 'jobs_job':
    case 'jobs_tick':
    case 'jobs_cron':
    case 'jobs_admin':
    case 'jobs_apply_prep':
    case 'jobs_apply':
    case 'jobs_apps':
        require_once __DIR__ . '/jobs.php';
        jobsRoute($r, $method, $b);

    /* ---------- email: Gmail / SMTP settings, contacts, mass email, sent log ---------- */
    case 'mail_status':
    case 'mail_signature':
    case 'mail_signature_save':
    case 'mail_settings':
    case 'mail_settings_save':
    case 'mail_test':
    case 'mail_sources':
    case 'mail_audience':
    case 'mail_preview':
    case 'mail_send_test':
    case 'mail_campaign_create':
    case 'mail_campaign_run':
    case 'mail_campaigns':
    case 'mail_campaign':
    case 'mail_campaign_action':
    case 'mail_contacts':
    case 'mail_contact_save':
    case 'mail_contacts_import':
    case 'mail_contacts_delete':
    case 'mail_contacts_tag':
    case 'mail_suppress':
    case 'mail_log':
    case 'mail_inbox':
    case 'mail_inbox_get':
    case 'mail_inbox_act':
    case 'mail_inbox_reply':
    case 'mail_inbound':
    case 'mail_webhook':
    case 'unsub_info':
    case 'unsub':
    // v34: delivery events from Postal and Amazon SES, the inbox check, deliverability and delivery safety
    case 'mail_postal_hook':
    case 'mail_postal_inbound':
    case 'mail_ses_hook':
    case 'mail_content_check':
    case 'mail_deliv':
    case 'mail_deliv_check':
    case 'mail_safety_save':
        require_once __DIR__ . '/mail.php';
        mailRoute($r, $method, $b);
    /* ---------- vendors, the requirements desk, candidate matching and the candidate database import ---------- */
    case 'vms_post':
    case 'vms_vendor_of':
    case 'vms_match':
    case 'vms_resummary':
    case 'vms_submit':
    case 'vms_import':
    case 'vms_token':
    case 'vms_jobs':
    case 'vms_from_job':
    case 'vms_settings_save':
    case 'vms_grab':
    case 'vms_grab_save':
    case 'vms_contact_grab':
    case 'vms_contact_grab_save':
    case 'vms_dice':
    case 'vms_dice_import':
    case 'vms_agent_get':
    case 'vms_agent_run':
    case 'vms_agent_retry':
        require_once __DIR__ . '/vms.php';
        vmsRoute($r, $method, $b);
    /* ---------- the talent marketplace ---------- */
    case 'mkt_search':
    case 'mkt_profile':
    case 'mkt_request':
    case 'mkt_my_requests':
    case 'mkt_resume':
    case 'mkt_match':
    case 'mkt_pool':
    case 'mkt_set':
    case 'mkt_requests':
    case 'mkt_decide':
    case 'mkt_employers':
    case 'mkt_settings_save':
        require_once __DIR__ . '/jobs.php';
        require_once __DIR__ . '/vms.php';
        require_once __DIR__ . '/mkt.php';
        mktRoute($r, $method, $b);
    /* ---------- the apply profile and autofill ---------- */
    case 'apply_token':
    case 'apply_used':
    case 'apply_resume':
    case 'apply_profiles':
    case 'apply_profile_get':
        require_once __DIR__ . '/jobs.php';
        require_once __DIR__ . '/apply.php';
        applyRoute($r, $method, $b);
    /* ---------- bank connection (Plaid) ---------- */
    case 'plaid_settings':
    case 'plaid_settings_save':
    case 'plaid_link_token':
    case 'plaid_exchange':
    case 'plaid_sync':
    case 'plaid_balances':
    case 'plaid_remove':
    case 'plaid_sandbox_item':
        require_once __DIR__ . '/plaid.php';
        plaidRoute($r, $method, $b);
    /* ---------- ATS (v29): requisitions, stage moves, interviews, scorecards, offers, hires, reports ---------- */
    case 'ats_settings':
    case 'ats_settings_save':
    case 'ats_job':
    case 'ats_job_save':
    case 'ats_jobs':
    case 'ats_move':
    case 'ats_bulk':
    case 'ats_interview':
    case 'ats_card':
    case 'ats_my_interviews':
    case 'ats_match':
    case 'ats_dupes':
    case 'ats_pool':
    case 'ats_mail':
    case 'ats_mail_info':
    case 'ats_report':
    case 'ats_hire':
    case 'ats_import':
    case 'ats_sources':
    case 'ats_pull':
    case 'ats_upload':
    case 'ats_paste':
    case 'ats_export':
    case 'ats_offer_letter':
        require_once __DIR__ . '/ats.php';
        atsRoute($r, $method, $b);
    /* ---------- v37.3 profile update requests (HR asks, the person updates, HR approves) ---------- */
    case 'hrq_meta':
    case 'hrq_list':
    case 'hrq_get':
    case 'hrq_create':
    case 'hrq_review':
    case 'hrq_remind':
    case 'hrq_cancel':
    case 'hrq_expiring':
    case 'hrq_mine':
    case 'hrq_self':
    case 'hrq_upload':
    case 'hrq_unfile':
    case 'hrq_submit':
        require_once __DIR__ . '/hrq.php';
        hrqRoute($r, $method, $b);
    /* ---------- v37.2 the Jobs module: requisition page, codes, templates, assignments, the job boards desk ---------- */
    case 'ats_req_save':
    case 'ats_req_dupes':
    case 'ats_req_view':
    case 'ats_req_match':
    case 'ats_req_clone':
    case 'ats_req_assign':
    case 'ats_req_remind':
    case 'ats_req_note':
    case 'ats_tpl_list':
    case 'ats_tpl_save':
    case 'ats_tpl_delete':
    case 'ats_postings':
    case 'ats_posting_act':
        require_once __DIR__ . '/atsreq.php';
        atsReqRoute($r, $method, $b);
    /* ---------- QuickBooks Online ---------- */
    case 'qbo_settings':
    case 'qbo_settings_save':
    case 'qbo_connect':
    case 'qbo_callback':
    case 'qbo_disconnect':
    case 'qbo_sync':
    case 'qbo_accounts':
    case 'qbo_map_save':
        require_once __DIR__ . '/qbo.php';
        qboRoute($r, $method, $b);
    case 'plaid_webhook':
        // Plaid tells us a bank has news; verified by its signature inside
        require_once __DIR__ . '/plaid.php';
        header('Content-Type: text/plain');
        plaidWebhook((string) file_get_contents('php://input'));
    /* ---------- accounting: recurring invoices, reminders, numbering ---------- */
    case 'acct_recur_run':
    case 'inv_remind':
    case 'acct_next_num':
    case 'acct_next_peek':
    case 'acct_bank_import':
    case 'acct_bank_match':
    case 'acct_cron':
        require_once __DIR__ . '/acct.php';
        acctRoute($r, $method, $b);
    /* ---------- CRM: imports and a company's history ---------- */
    case 'crm_import':
    case 'crm_timeline':
        require_once __DIR__ . '/crm.php';
        crmRoute($r, $method, $b);
    /* ---------- the storage box ---------- */
    case 'storage_list':
    case 'storage_delete':
    case 'storage_cleanup':
    case 'storage_box':
    case 'storage_box_delete':
        require_once __DIR__ . '/storage.php';
        storageRoute($r, $method, $b);

    /* ---------- admin ---------- */
    case 'admin_users':
        requireAdmin();
        $rows = db()
            ->query('SELECT id, email, name, role, status, created, access FROM users ORDER BY created')
            ->fetchAll();
        $rows = array_map(function ($r) {
            $a = accessOf($r);
            unset($r['access']);
            $r['portals'] = $a['portals'];
            $r['cids'] = $a['cids'];
            $r['fa'] = featureAccessOf((string) $r['id']);
            return $r;
        }, $rows);
        ok(['users' => $rows, 'featureAccess' => featureAccessCatalog()]);
    /* Which portals a person may open and which client workspaces they belong to (Admin > Roles & access, Clients). */
    /* The books level of an accounting login (Admin > Roles & access > Bookkeepers): full, view-only or reports only,
       and whether payroll is off-limits. The server applies it on every request (acctLimits, scopeAllows). */
    case 'admin_books_access':
        $me = requireAdmin();
        if (!hasRole($me, 'admin')) {
            fail(403, 'invalid_argument', 'Only an administrator can change books access.');
        }
        $uid = str($b, 'uid', 40);
        if (!userRow($uid)) {
            fail(404, 'invalid_argument', 'No account with that id.');
        }
        $r = docGet("r/$uid") ?? new stdClass();
        if (array_key_exists('books', $b)) {
            $r->books = in_array((string) $b['books'], ['full', 'view', 'reports'], true) ? (string) $b['books'] : 'full';
        }
        if (array_key_exists('nopay', $b)) {
            $r->nopay = !empty($b['nopay']);
        }
        if (array_key_exists('st', $b) && !empty($r->ext)) {
            // pausing an outside bookkeeper closes the account itself: no sign-in, and the session ends
            $r->st = (string) $b['st'] === 'inactive' ? 'inactive' : 'active';
            db()->prepare('UPDATE users SET status = ? WHERE id = ?')->execute([$r->st === 'inactive' ? 'inactive' : 'active', $uid]);
        }
        $r->u = now();
        docSet("r/$uid", $r);
        require_once __DIR__ . '/payroll.php';
        auditLog('access', "r/$uid", 'Books access changed: ' . (string) (userRow($uid)['name'] ?? $uid), ['books' => (string) ($r->books ?? 'full'), 'nopay' => !empty($r->nopay), 'st' => (string) ($r->st ?? 'active')], $me);
        ok(['books' => (string) ($r->books ?? 'full'), 'nopay' => !empty($r->nopay), 'st' => (string) ($r->st ?? 'active')]);
    case 'admin_feature_access':
        $me = requireAdmin();
        if (!hasRole($me, 'admin')) {
            fail(403, 'invalid_argument', 'Only an administrator can change feature access.');
        }
        requireRecentAuth();
        $uid = str($b, 'uid', 40);
        $row = userRow($uid);
        if (!$row) fail(404, 'invalid_argument', 'No account with that id.');
        if (hasRole($row, 'admin')) fail(400, 'invalid_argument', 'Administrator feature access is always full. Change the main role first if this person should be restricted.');
        $key = str($b, 'key', 40);
        if (!isset(FEATURE_ACCESS[$key])) fail(400, 'invalid_argument', 'Unknown feature.');
        $mode = strtolower(str($b, 'mode', 10));
        if (!in_array($mode, ['default', 'allow', 'block'], true)) fail(400, 'invalid_argument', 'Choose Role default, Allow or Block.');
        $rr = docGet("r/$uid") ?? new stdClass();
        if (!isset($rr->fa) || !($rr->fa instanceof stdClass)) $rr->fa = new stdClass();
        $before = isset($rr->fa->$key) ? (string) $rr->fa->$key : 'default';
        if ($mode === 'default') unset($rr->fa->$key); else $rr->fa->$key = $mode;
        $rr->u = now();
        docSet("r/$uid", $rr);
        audit('access', 'Feature access changed', (string) $row['email'], ['feature' => $key, 'from' => $before, 'to' => $mode], $me);
        ok(['ok' => true, 'uid' => $uid, 'key' => $key, 'mode' => $mode, 'fa' => featureAccessOf($uid)]);
    case 'admin_access':
        $me = requireAdmin();
        $uid = str($b, 'uid', 40);
        $row = userRow($uid);
        if (!$row) {
            fail(404, 'invalid_argument', 'No account with that id.');
        }
        $cur = accessOf($row);
        $portals = $cur['portals'];
        $cids = $cur['cids'];
        if (array_key_exists('portals', $b)) {
            if (!hasRole($me, 'admin')) {
                fail(403, 'invalid_argument', 'Only an administrator can change which portals a person opens.');
            }
            $portals = [];
            foreach ((array) $b['portals'] as $k) {
                if (!is_string($k)) continue;
                if ($k === 'bench') $k = 'employee';
                if (in_array($k, PORTAL_KEYS, true)) {
                    $portals[] = $k;
                }
            }
            if ($uid === $me['id'] && !in_array('admin', $portals, true) && $row['role'] !== 'admin') {
                fail(400, 'invalid_argument', 'You can\'t remove your own administrator access.');
            }
        }
        if (array_key_exists('cids', $b)) {
            $cids = [];
            foreach ((array) $b['cids'] as $c) {
                if (is_string($c) && preg_match('/^[A-Za-z0-9_\-]{1,40}$/', $c) && docGet("org/admin/clients/$c")) {
                    $cids[] = $c;
                }
            }
            if ($cids && !in_array('client', $portals, true) && portalOf($uid) !== 'employer') {
                $portals[] = 'client';
            }
        }
        db()
            ->prepare('UPDATE users SET access = ? WHERE id = ?')
            ->execute([json_encode(['portals' => array_values(array_unique($portals)), 'cids' => array_values(array_unique($cids))]), $uid]);
        audit('access', 'Portals and workspaces changed', (string) $row['email'], ['from' => $cur, 'to' => ['portals' => array_values(array_unique($portals)), 'cids' => array_values(array_unique($cids))]], $me);
        ok(['ok' => true, 'portals' => array_values(array_unique($portals)), 'cids' => array_values(array_unique($cids))]);
    /* A login made by staff: a client contact, consultant or employee is emailed an invitation to choose a password. */
    case 'admin_create_user':
        $me = requireAdmin();
        // v35: a login that opens a staff portal or the books needs a fresh confirmation
        if (str($b, 'kind', 12) === 'bookkeeper' || array_intersect(array_map('strval', (array) ($b['portals'] ?? [])), array_keys(STAFF_PORTAL_ROLE))) {
            requireRecentAuth();
        }
        ok(createLogin($b, $me));
    case 'admin_role':
        $me = requireAdmin();
        if (!hasRole($me, 'admin')) {
            fail(403, 'invalid_argument', 'Only an administrator can change staff access.');
        }
        $uid = str($b, 'uid', 40);
        $role = in_array(str($b, 'role', 10), ['admin', 'hr', 'acct', 'manager'], true) ? str($b, 'role', 10) : 'user';
        if ($role !== 'admin') {
            $n = (int) db()
                ->query("SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active'")
                ->fetchColumn();
            $s = db()->prepare('SELECT role FROM users WHERE id = ?');
            $s->execute([$uid]);
            if ($s->fetchColumn() === 'admin' && $n <= 1) {
                fail(400, 'invalid_argument', 'Keep at least one administrator.');
            }
        }
        $was = userRow($uid);
        db()
            ->prepare('UPDATE users SET role = ? WHERE id = ?')
            ->execute([$role, $uid]);
        audit('access', 'Main role changed', (string) ($was['email'] ?? $uid), ['from' => (string) ($was['role'] ?? ''), 'to' => $role], $me);
        ok(['ok' => true]);
    case 'admin_member_role':
        $me = requireAdmin();
        if (!hasRole($me, 'admin')) {
            fail(403, 'invalid_argument', "Only an administrator can change a person's primary member portal.");
        }
        $uid = str($b, 'uid', 40);
        $row = userRow($uid);
        if (!$row) fail(404, 'invalid_argument', 'No account with that id.');
        $rr = docGet("r/$uid") ?? new stdClass();
        $before = (string) ($rr->role ?? portalOf($uid));
        if ($before === 'employer' || !empty($rr->ext)) {
            fail(400, 'invalid_argument', 'Client contacts and outside bookkeepers keep their dedicated portal type.');
        }
        $role = str($b, 'role', 16);
        if (!in_array($role, ['employee', 'consultant', 'student'], true)) {
            fail(400, 'invalid_argument', 'Choose Employee, Consultant or Student.');
        }
        $rr->role = $role;
        if (!isset($rr->st) || $rr->st === '') $rr->st = 'active';
        $rr->u = now();
        docSet("r/$uid", $rr);
        $ud = docGet("u/$uid") ?? new stdClass();
        if (!isset($ud->p) || !($ud->p instanceof stdClass)) $ud->p = new stdClass();
        $ud->p->role = $role;
        $ud->u = now();
        docSet("u/$uid", $ud);
        audit('access', 'Primary member portal changed', (string) ($row['email'] ?? $uid), ['from' => $before, 'to' => $role], $me);
        ok(['ok' => true, 'role' => $role]);
    case 'admin_manager':
        $me = requireAdmin();
        if (!hasRole($me, 'admin')) {
            fail(403, 'invalid_argument', 'Only an administrator can change reporting lines here.');
        }
        $uid = str($b, 'uid', 40);
        $row = userRow($uid);
        if (!$row) fail(404, 'invalid_argument', 'No account with that id.');
        $mgrId = str($b, 'mgrId', 40);
        if ($mgrId === $uid) fail(400, 'invalid_argument', 'A person cannot report to themselves.');
        if ($mgrId !== '') {
            $mgr = userRow($mgrId);
            if (!$mgr || ($mgr['status'] ?? '') !== 'active') fail(400, 'invalid_argument', 'Choose an active manager.');
            $lead = hasRole($mgr, 'manager') || hasRole($mgr, 'admin') || hasRole($mgr, 'hr') || hasRole($mgr, 'acct');
            if (!$lead) fail(400, 'invalid_argument', 'That person does not have Manager, HR, Accounting or Administrator access.');
        }
        $rr = docGet("r/$uid") ?? new stdClass();
        $before = (string) ($rr->mgrId ?? '');
        if ($mgrId === '') unset($rr->mgrId); else $rr->mgrId = $mgrId;
        $rr->u = now();
        docSet("r/$uid", $rr);
        audit('access', 'Reporting manager changed', (string) ($row['email'] ?? $uid), ['from' => $before, 'to' => $mgrId], $me);
        ok(['ok' => true, 'mgrId' => $mgrId]);
    case 'admin_status':
        $me = requireAdmin();
        require_once __DIR__ . '/auth.php';
        $uid = str($b, 'uid', 40);
        $st = str($b, 'status', 10) === 'disabled' ? 'disabled' : 'active';
        if ($uid === $me['id'] && $st === 'disabled') {
            fail(400, 'invalid_argument', 'You can\'t pause your own account.');
        }
        $t = userRow($uid);
        if (!$t) {
            fail(404, 'invalid_argument', 'No account with that id.');
        }
        // v34: only administrators pause or restore staff accounts (HR could otherwise lock an administrator out)
        if (!authMayManage($me, $t)) {
            fail(403, 'forbidden', 'Only an administrator can pause or restore a staff account.');
        }
        db()
            ->prepare('UPDATE users SET status = ? WHERE id = ?')
            ->execute([$st, $uid]);
        $ended = $st === 'disabled' ? sessRevokeAll($uid, 'account paused by ' . $me['name']) : 0;
        audit('access', $st === 'disabled' ? 'Account paused' : 'Account restored', (string) $t['email'], ['sessionsEnded' => $ended], $me);
        ok(['ok' => true]);
    case 'admin_reset':
        $me = requireAdmin();
        require_once __DIR__ . '/auth.php';
        $uid = str($b, 'uid', 40);
        $t = userRow($uid);
        if (!$t) {
            fail(404, 'invalid_argument', 'No account with that id.');
        }
        // v34: HR and accounting could reset an administrator's password and read the new one; now only administrators
        // reset staff accounts, and every temporary password must be replaced at the next sign-in
        if (!authMayManage($me, $t)) {
            fail(403, 'forbidden', 'Only an administrator can reset the password of a staff account. Send them a reset link instead, or ask an administrator.');
        }
        $pw = tempPassword() . tempPassword();
        db()->prepare('UPDATE users SET pass = ? WHERE id = ?')->execute([pwHash($pw), $uid]);
        authUserSet($uid, ['must_pw' => 1, 'why' => 'reset', 'locked_until' => 0, 'fails' => 0]);
        $ended = sessRevokeAll($uid, 'password reset by ' . $me['name']);
        audit('auth', 'Temporary password set by staff', (string) $t['email'], ['sessionsEnded' => $ended], $me);
        authMail($t + ['status' => 'active'], 'Your StratEdge password was reset', ['Hi ' . authFirst($t) . ',', $me['name'] . ' set a temporary password on your StratEdge account. You will choose your own password at your next sign-in.', 'If you did not ask for this, contact StratEdge right away.']);
        ok(['password' => $pw]);
    /* ---------- books (v28): ledger, reports, reconciliation, rules, audit log, exports ---------- */
    case 'books_overview':
    case 'books_report':
    case 'books_coa':
    case 'books_coa_save':
    case 'books_settings_save':
    case 'books_close':
    case 'books_je_save':
    case 'books_je_list':
    case 'books_review':
    case 'books_line':
    case 'books_rules_apply':
    case 'books_rules':
    case 'books_rules_save':
    case 'books_recon':
    case 'books_recon_clear':
    case 'books_recon_finish':
    case 'books_recon_list':
    case 'books_audit':
    case 'books_export':
        require_once __DIR__ . '/books.php';
        booksRoute($r, $method, $b);
    /* ---------- payroll (v28): direct deposit, ACH files, tax summaries, W-4 self-service ---------- */
    case 'dd_get':
    case 'dd_save':
    case 'dd_release':
    case 'dd_dispute_get':
    case 'dd_dispute':
    case 'dd_prenoted':
    case 'ach_settings':
    case 'ach_settings_save':
    case 'pay_nacha':
    case 'pay_dd_register':
    case 'pay_tax_summary':
    case 'my_tax_form':
    case 'my_w4_save':
    case 'taxdep_save':
    case 'taxdep_delete':
        require_once __DIR__ . '/payroll.php';
        payrollRoute($r, $method, $b);
    /* ---------- sign in with Google / LinkedIn / Microsoft, and each person's own mailbox ---------- */
    case 'sso_start':
    case 'sso_cb':
    case 'sso_gis':
    case 'sso_settings':
    case 'sso_settings_save':
    case 'sso_test':
    case 'sso_gis_verify':
    case 'mymail_status':
    case 'mymail_connect_smtp':
    case 'mymail_disconnect':
    case 'mymail_sync':
    case 'mymail_bounces_seen':
    case 'mymail_list':
    case 'mymail_get':
    case 'mymail_act':
    case 'mymail_book':
    case 'mymail_book_save':
    case 'mymail_send':
    case 'mymail_export':
    case 'mymail_labels_save':
    case 'mymail_download':
        require_once __DIR__ . '/sso.php';
        ssoRoute($r, $method, $b);
    /* ---------- payroll: everything a pay period needs in one request (three queries instead of hundreds) ---------- */
    case 'pay_inputs':
        requireAdmin();
        $months = array_values(array_filter(array_map(fn($m) => is_string($m) && preg_match('/^\d{4}-\d{2}$/', $m) ? $m : '', (array) ($b['months'] ?? []))));
        $ids = array_values(array_filter(array_map(fn($x) => is_string($x) && preg_match('/^u_[a-f0-9]{8,32}$/', $x) ? $x : '', (array) ($b['ids'] ?? []))));
        $mk = is_string($b['mk'] ?? null) && preg_match('/^\d{4}-\d{2}(-\d{1,2})?$/', $b['mk']) ? $b['mk'] : '';
        if (!$ids || !$months || $mk === '' || count($ids) > 500 || count($months) > 4) {
            fail(400, 'invalid_argument', 'Pay period details are missing.');
        }
        $pdo = db();
        $out = ['att' => [], 'stubs' => [], 'cur' => [], 'rec' => []];
        $paths = [];
        foreach ($ids as $id) {
            foreach ($months as $m) {
                $paths[] = 'u/' . $id . '/att/' . $m;
            }
            $paths[] = 'hrms/emp/' . $id . '/rec';
        }
        foreach (array_chunk($paths, 300) as $chunk) {
            $st = $pdo->prepare('SELECT path, data FROM docs WHERE path IN (' . implode(',', array_fill(0, count($chunk), '?')) . ')');
            $st->execute($chunk);
            foreach ($st->fetchAll() as $row) {
                if (!can($row['path'], 'r')) {
                    continue;
                }
                $seg = explode('/', $row['path']);
                if ($seg[0] === 'u') {
                    $out['att'][$seg[1]][$seg[3]] = json_decode($row['data']);
                } else {
                    $out['rec'][$seg[2]] = json_decode($row['data']);
                }
            }
        }
        // saved paystubs since April of last year (covers US calendar years and Indian financial years) for year-to-date figures
        $since = (string) ((int) substr($mk, 0, 4) - 1) . '-04';
        foreach (array_chunk(array_map(fn($id) => 'pays/' . $id . '/items', $ids), 300) as $chunk) {
            $st = $pdo->prepare('SELECT path, col, data FROM docs WHERE col IN (' . implode(',', array_fill(0, count($chunk), '?')) . ')');
            $st->execute($chunk);
            foreach ($st->fetchAll() as $row) {
                $m = substr($row['path'], strrpos($row['path'], '/') + 1);
                if ($m !== $mk && $m < $since) {
                    continue;
                }
                if (!can($row['path'], 'r')) {
                    continue;
                }
                $id = explode('/', $row['col'])[1];
                $d = json_decode($row['data']);
                if (!($d instanceof stdClass)) {
                    continue;
                }
                if ($m === $mk) {
                    $out['cur'][$id] = $d;
                } else {
                    $d->id = $m;
                    $out['stubs'][$id][] = $d;
                }
            }
        }
        ok($out);
    /* ---------- email checks, bounces and system health ---------- */
    case 'mail_check':
    case 'mail_check_sessions':
    case 'mail_check_session':
    case 'mail_check_delete':
    case 'mail_check_label':
    case 'mail_addr_lookup':
    case 'mail_bounce_sync':
    case 'mail_bounces':
    case 'mail_unsuppress':
    case 'mail_contacts_cleanup':
    case 'health':
    case 'admin_cleanup_gz':
    case 'ai_settings':
    case 'ai_settings_save':
    case 'ai_test':
    case 'ai_features_save':
        require_once __DIR__ . '/tools.php';
        toolsRoute($r, $method, $b);
    /* ---------- scanner trap: probes for WordPress, .env and similar files are answered here and banned ---------- */
    /* ---------- v34: security.txt (RFC 9116) and what the page's security policy blocked ---------- */
    case 'security_txt':
        header('Content-Type: text/plain; charset=utf-8');
        header('Cache-Control: public, max-age=3600');
        $sc = authCfg();
        $contact = (string) ($sc['secEmail'] ?: (cfg('mail_from') ?: 'info@stratedgeitconsulting.com'));
        $root = siteUrl();
        echo "# How to report a security problem with " . preg_replace('#^https?://#', '', rtrim($root, '/')) . "\n";
        echo 'Contact: mailto:' . $contact . "\n";
        echo 'Contact: ' . $root . "#/security\n";
        echo 'Expires: ' . gmdate('Y-m-d\TH:i:s\Z', (int) (((int) $sc['secReviewed']) / 1000) + 365 * 86400) . "\n";
        echo "Preferred-Languages: en\n";
        echo 'Policy: ' . $root . "#/security\n";
        echo 'Canonical: ' . $root . ".well-known/security.txt\n";
        exit();
    case 'csp_report':
        // the page's own reports (js/boot.js) of anything its Content-Security-Policy blocked: a few per address per hour
        if ($method === 'POST' && !throttleHit('csp:' . clientIp(), 30, 3600)) {
            $dir = mb_substr(str($b, 'dir', 80), 0, 80);
            $blocked = mb_substr(str($b, 'blocked', 300), 0, 300);
            $page = mb_substr(str($b, 'page', 300), 0, 300);
            if ($dir !== '') {
                $k = substr(hash('sha256', $dir . '|' . $blocked . '|' . $page), 0, 24);
                $p = secdb();
                $s = $p->prepare('UPDATE csp_reports SET n = n + 1, at = ? WHERE id = ?');
                $s->execute([now(), $k]);
                if (!$s->rowCount()) {
                    $p->prepare('INSERT INTO csp_reports (id, at, ip, page, dir, blocked, n) VALUES (?,?,?,?,?,?,1)')->execute([$k, now(), mb_substr(clientIp(), 0, 64), $page, $dir, $blocked]);
                    // v83: the reports age out like the firewall log, and the table keeps at most the newest 2000 rows
                    if (random_int(1, 50) === 1) {
                        try {
                            $p->prepare('DELETE FROM csp_reports WHERE at < ?')->execute([now() - max(1, (int) (fwSettings()['log_days'] ?? 30)) * 86400000]);
                            $cut = $p->query('SELECT at FROM csp_reports ORDER BY at DESC LIMIT 1 OFFSET 2000')->fetchColumn();
                            if ($cut !== false) {
                                $p->prepare('DELETE FROM csp_reports WHERE at <= ?')->execute([(int) $cut]);
                            }
                        } catch (Throwable $e) {
                            // pruning never blocks a report
                        }
                    }
                }
            }
        }
        ok(['ok' => true]);
    case 'trap':
        $probe = mb_substr((string) ($_GET['p'] ?? ($_SERVER['REQUEST_URI'] ?? '')), 0, 160);
        if (!fwAllowed(fwIp())) {
            fwLog('trap', 'Probed ' . $probe . (fwCrossSite() ? ' (sent by another web site through a browser: not banned)' : ''), 'trap');
            // v83: a picture or link on another site pointing here comes from a visitor's browser, not a scanner
            if (!fwCrossSite()) {
                fwBlock(ipBucket(fwIp()), 'ip', 1440, 'Scanned for ' . $probe); // v83: an IPv6 scanner's whole /64
                // v78: the address also carries the points, so it is banned longer if it comes back
                wafPoints(fwIp(), 25, 'trap-route');
            }
        }
        http_response_code(404);
        echo json_encode(['error' => 'not_found']);
        exit();
    /* ---------- security (Admin > Security) ---------- */
    case 'sec_overview':
    case 'sec_save':
    case 'sec_block':
    case 'sec_unblock':
    case 'sec_clear':
    case 'sec_test':
        secRoute($r, $b);
    /* ---------- a page that broke in someone's browser: noted in storage/error.log (Admin > System health) ---------- */
    case 'client_error':
        if (throttleHit('cerr:' . clientIp(), 10, 3600)) {
            ok(['ok' => true]);
        }
        $details = (string) ($b['details'] ?? '');
        $details = preg_replace('/[^\P{C}\n\t]+/u', '', mb_substr($details, 0, 4000)) ?? '';
        if ($details !== '') {
            $u = currentUser();
            @error_log(
                date('c') . ' [browser] ' . ($u ? $u['email'] : 'visitor ' . clientIp()) . "\n" . preg_replace('/^/m', '    ', trim($details)) . "\n",
                3,
                storeDir() . '/error.log',
            );
        }
        ok(['ok' => true]);
    /* ---------- ads: public click and impression counters ---------- */
    case 'ad_hit':
        $id = str($b, 'id', 40);
        $kind = str($b, 'kind', 6) === 'click' ? 'clicks' : 'views';
        if (!preg_match('/^[A-Za-z0-9_\-]{3,40}$/', $id)) {
            fail(400, 'invalid_argument', 'Bad ad.');
        }
        if (throttleHit('ad:' . $kind . ':' . $id . ':' . clientIp(), 30, 3600)) {
            ok(['ok' => true]);
        }
        $ad = docGet("org/site/ads/$id");
        if (!$ad) {
            ok(['ok' => true]);
        }
        $st = docGet("ads/stats/$id") ?? new stdClass();
        $st->$kind = (int) ($st->$kind ?? 0) + 1;
        $day = date('Y-m-d');
        if (!isset($st->days) || !($st->days instanceof stdClass)) {
            $st->days = new stdClass();
        }
        if (!isset($st->days->$day) || !($st->days->$day instanceof stdClass)) {
            $st->days->$day = (object) ['views' => 0, 'clicks' => 0];
        }
        $st->days->$day->$kind = (int) ($st->days->$day->$kind ?? 0) + 1;
        docSet("ads/stats/$id", $st);
        ok(['ok' => true]);
    default:
        // v30: compliance hub, learning platform, live projects and the vault live in their own modules
        if (str_starts_with($r, 'comp_')) {
            require_once __DIR__ . '/comp.php';
            compRoute($r, $b);
        }
        if (str_starts_with($r, 'learn_') || str_starts_with($r, 'proj_') || str_starts_with($r, 'vault_')) {
            require_once __DIR__ . '/learn.php';
            learnRoute($r, $b);
        }
        // v68/v75: unified Intelligence & Operations workspace.
        if (str_starts_with($r, 'intel_')) {
            require_once __DIR__ . '/intel.php';
            intelRoute($r, $b);
        }
        // v53: live official immigration intelligence for every signed-in consultant and employee.
        if (str_starts_with($r, 'immnews_')) {
            require_once __DIR__ . '/immnews.php';
            immnewsRoute($r, $b);
        }
        // v31: the assistant across the portals (StratEdge AI, Write with AI, fill forms from text); v32: email help
        if (in_array($r, ['ai_ask', 'ai_write', 'ai_extract', 'ai_mail'], true)) {
            require_once __DIR__ . '/ai.php';
            aiRoute($r, $b);
        }
        // v31: resume tailoring (JD in, ATS-ready DOCX/PDF out, find consultants, submit)
        if (str_starts_with($r, 'tl_')) {
            require_once __DIR__ . '/tailor.php';
            tailorRoute($r, $b);
        }
        // v31: share open requirements (email to vendors, clients and everyone; the careers page; social feeds)
        if (str_starts_with($r, 'rs_')) {
            require_once __DIR__ . '/reqshare.php';
            rsRoute($r, $b);
        }
        // v32: certifications and the daily and weekly tests; plans and payments; consultant types and job rules
        if (str_starts_with($r, 'ex_')) {
            require_once __DIR__ . '/exams.php';
            exRoute($r, $b);
        }
        if (str_starts_with($r, 'desk_')) {
            // v34: the service desk (Help & support)
            require_once __DIR__ . '/desk.php';
            deskRoute($r, $b);
        }
        if (str_starts_with($r, 'dl_')) {
            // v37.5: distribution lists (Email › Lists)
            require_once __DIR__ . '/maillists.php';
            dlRoute($r, $b);
        }
        if (str_starts_with($r, 'imp_')) {
            // v38.1: import with preview (a spreadsheet checked row by row before anything is saved; undo)
            require_once __DIR__ . '/imports.php';
            impRoute($r, $b);
        }
        if (str_starts_with($r, 'sq_')) {
            // v46: sequences (follow-up emails and tasks from the sender's own mailbox until the person replies)
            require_once __DIR__ . '/seq.php';
            sqRoute($r, $b);
        }
        if (str_starts_with($r, 'pub_cw')) {
            // v50: the website's specialist service pages and published cases (no sign-in)
            require_once __DIR__ . '/corpweb.php';
            cwPublicRoute($r, $b);
        }
        if (str_starts_with($r, 'cr_') || str_starts_with($r, 'cq_') || str_starts_with($r, 'cw_')) {
            // v47: corporate clients: talent requests with the company's approval, and proposals; v49: supplier
            // qualification (the supplier profile, the document library and each client company's packet)
            require_once __DIR__ . '/corp.php';
            crRoute($r, $b);
        }
        if (str_starts_with($r, 'es_')) {
            // v45.3: team e-signature (the library, sending, bulk sends, email options, settings)
            require_once __DIR__ . '/esign.php';
            esRoute($r, $b);
        }
        if (str_starts_with($r, 'imx_')) {
            // v45.1: the attorney's view of one case (a secure link plus a code emailed each visit; no portal account)
            require_once __DIR__ . '/imm.php';
            imxRoute($r, $b);
        }
        if (str_starts_with($r, 'im_')) {
            // v45: immigration cases (steps from a template per case type, documents, messages, compliance dates)
            require_once __DIR__ . '/imm.php';
            imRoute($r, $b);
        }
        if (str_starts_with($r, 'pf_')) {
            // v44: goals and reviews (key results, check-ins, alignment, review cycles)
            require_once __DIR__ . '/goals.php';
            pfRoute($r, $b);
        }
        if (str_starts_with($r, 'xc_')) {
            // v43: expense claims (lines with receipts or mileage, manager approval, paid into Bills & expenses)
            require_once __DIR__ . '/claims.php';
            xcRoute($r, $b);
        }
        if (str_starts_with($r, 'wk_')) {
            // v42: work boards (Scrum and Kanban projects, sprints, stand-ups, retrospectives, reports, My work)
            require_once __DIR__ . '/work.php';
            wkRoute($r, $b);
        }
        if (str_starts_with($r, 'mig_')) {
            // v41.1: bring records from another ATS or CRM (read-only) into Import with preview
            require_once __DIR__ . '/migrate.php';
            migRoute($r, $b);
        }
        if (str_starts_with($r, 'ph_') || str_starts_with($r, 'phw_')) {
            // v77: phone & texts through Twilio, VitelGlobal or another approved REST provider
            require_once __DIR__ . '/phone.php';
            phRoute($r, $b);
        }
        if (str_starts_with($r, 'cal_')) {
            // v41: each person's Google Calendar or Outlook for interviews (free/busy, invitations, answers synced back)
            require_once __DIR__ . '/cal.php';
            calRoute($r, $b);
        }
        if (str_starts_with($r, 'tax_')) {
            // v40: the personal tax center (My taxes): each person's own answers, sealed, and their pay figures
            require_once __DIR__ . '/tax.php';
            taxRoute($r, $b);
        }
        if (str_starts_with($r, 'chat_')) {
            // v35: team messaging
            require_once __DIR__ . '/chat.php';
            chatRoute($r, $b);
        }
        if (str_starts_with($r, 'guard_')) {
            // v35: Security center > Protection
            guardRoute($r, $b);
        }
        if (str_starts_with($r, 'ab_')) {
            // v35: the Application bot inside the portal
            require_once __DIR__ . '/appbot.php';
            abRoute($r, $b);
        }
        if (str_starts_with($r, 'ws_')) {
            require_once __DIR__ . '/wsadmin.php';
            wsRoute($r, $b);
        }
        // v36.3: the ID link a person opens (no account needed)
        if (str_starts_with($r, 'idq_')) {
            require_once __DIR__ . '/idscan.php';
            idqRoute($r, $b);
        }
        // v36.1: ID checks
        if (str_starts_with($r, 'ids_')) {
            // v36.1: ID checks (driver's licenses, state IDs and green cards)
            require_once __DIR__ . '/idscan.php';
            idsRoute($r, $b);
        }
        if (str_starts_with($r, 'bd_')) {
            // v36: the bench desk (consultants on the bench, approvals, conflict checks, the pipeline; the consultant's links)
            require_once __DIR__ . '/bench.php';
            bdRoute($r, $b);
        }
        if (str_starts_with($r, 'pr_')) {
            // v35: practice calls and voice drills (Grow > Practice calls; staff: Practice & training)
            require_once __DIR__ . '/practice.php';
            prRoute($r, $b);
        }
        if (str_starts_with($r, 'bill_')) {
            require_once __DIR__ . '/billing.php';
            billRoute($r, $b);
        }
        if ($r === 'stripe_webhook') {
            require_once __DIR__ . '/billing.php';
            billWebhook();
        }
        if (str_starts_with($r, 'rules_')) {
            require_once __DIR__ . '/rules.php';
            rulesRoute($r, $b);
        }
        // v33: sourcing connections (Dice, iLabor360) and the public job feed for job boards
        if (str_starts_with($r, 'src_')) {
            require_once __DIR__ . '/sources.php';
            srcRoute($r, $b);
        }
        if ($r === 'jobs_feed') {
            require_once __DIR__ . '/sources.php';
            srcFeed();
        }
        // v34: the live Dice and iLabor360 API connections
        if (str_starts_with($r, 'cx_')) {
            require_once __DIR__ . '/connectors.php';
            cxRoute($r, $b);
        }
        // v52: Oorwin login-based backup + import
        if (str_starts_with($r, 'oorwin_')) {
            require_once __DIR__ . '/oorwin.php';
            owRoute($r, $b);
        }
        // v80: the easy Ceipal & Oorwin API connector (pull jobs -> requirements, candidates -> consultant database)
        if (str_starts_with($r, 'atc_')) {
            require_once __DIR__ . '/atc.php';
            atcRoute($r, $b);
        }
        // v33: talent search (skills with years across every resume)
        if (str_starts_with($r, 'ts_')) {
            require_once __DIR__ . '/talent.php';
            tsRoute($r, $b);
        }
        // v33: the StratEdge AI screening agent (staff pages, and the candidate's secure form)
        if (str_starts_with($r, 'ag_')) {
            require_once __DIR__ . '/agent.php';
            agRoute($r, $b);
        }
        // v34: Security center (monitoring, backups) and Governance & SOC 2 (policies, reviews, registers, audit log)
        if (str_starts_with($r, 'trust_')) {
            require_once __DIR__ . '/monitor.php';
            trustRoute($r, $b);
        }
        if (str_starts_with($r, 'gov_')) {
            require_once __DIR__ . '/gov.php';
            govRoute($r, $b);
        }
        // v34: privacy requests (public form, confirmation link) and retention (HR and administrators)
        if (str_starts_with($r, 'priv_')) {
            require_once __DIR__ . '/privacy.php';
            privRoute($r, $b);
        }
        // v35: Help & support on the public website (sign-in help, the assistant, requests without a login)
        if (str_starts_with($r, 'pub_support')) {
            require_once __DIR__ . '/desk.php';
            deskPublicRoute($r, $b);
        }
        // v34: a security researcher's report from the public security page
        if ($r === 'sec_report') {
            if (throttleHit('secrep:' . clientIp(), 5, 3600)) {
                fail(429, 'rate_limited', 'Too many reports from this network. Email us instead.');
            }
            $email = strtolower(str($b, 'email', 190));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen(str($b, 'desc', 8000)) < 20) {
                fail(400, 'invalid_argument', 'Add your email and describe what you found (at least a sentence).');
            }
            if (fwScreen(['email' => $email, 'website' => $b['website'] ?? '', 't0' => $b['t0'] ?? 0, 'msg' => str($b, 'desc', 8000)], 'security report') !== '') {
                fail(400, 'spam', 'This report could not be sent. Email us directly.');
            }
            require_once __DIR__ . '/gov.php';
            $iid = govIncidentNew(['t' => 'Vulnerability report: ' . (str($b, 't', 120) ?: 'from a researcher'), 'kind' => 'vuln', 'desc' => 'From: ' . str($b, 'name', 120) . ' <' . $email . ">\n\n" . str($b, 'desc', 8000), 'src' => 'public', 'by' => $email]);
            ok(['ok' => true, 'ref' => $iid]);
        }
        // v34: sign-in (two-step codes, passkeys, password resets, sessions) and the sign-in rules
        if (preg_match('/^(mfa|pk|pw|sess|dev)_/', $r) || in_array($r, ['sec_me', 'auth_reauth', 'auth_reauth_info', 'auth_reauth_email', 'auth_reauth_drop', 'sec_user', 'sec_user_mfa_reset', 'sec_user_unlock', 'sec_user_revoke', 'sec_user_reset_link', 'sec_auth_get', 'sec_auth_save'], true)) {
            require_once __DIR__ . '/auth.php';
            authRoute($r, $b);
        }
        // v78: the web application firewall's dashboard (administrators)
        if (str_starts_with($r, 'waf_')) {
            wafRoute($r, $b);
        }
        // v78: StratEdge AI as an agent (tools, confirmations), the AI shield and the security analyst
        if (in_array($r, ['ai_agent', 'ai_act', 'ai_visitor', 'ai_props'], true) || str_starts_with($r, 'ai_shield')) {
            require_once __DIR__ . '/copilot.php';
            cpRoute($r, $b);
        }
        // v78: a visitor guessing route names is a scanner: a few points on the address (signed-in people never)
        // v79: it also counts towards the behavioral scan signal (many unknown/refused routes in a short window)
        if (empty($_SESSION['uid'])) {
            wafPoints(clientIp(), 2, 'proto-unknown');
            wafNoteProbe(clientIp());
        }
        fail(404, 'not_found', 'Unknown action.');
}
