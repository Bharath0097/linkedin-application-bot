<?php
declare(strict_types=1);
require_once __DIR__ . '/mail.php';

/*
 * Sign in with Google, LinkedIn or Microsoft (OpenID Connect), and each person's own mailbox inside the portal:
 * Gmail through the Gmail API (send and receive) when connected with Google, or Gmail/Workspace sending through
 * SMTP with an app password. Settings live under Admin > Roles & access > Sign-in providers.
 */
const SSO_PROVIDERS = [
    'google' => [
        'n' => 'Google',
        'auth' => 'https://accounts.google.com/o/oauth2/v2/auth',
        'token' => 'https://oauth2.googleapis.com/token',
        'user' => 'https://openidconnect.googleapis.com/v1/userinfo',
        'scope' => 'openid email profile',
    ],
    'linkedin' => [
        'n' => 'LinkedIn',
        'auth' => 'https://www.linkedin.com/oauth/v2/authorization',
        'token' => 'https://www.linkedin.com/oauth/v2/accessToken',
        'user' => 'https://api.linkedin.com/v2/userinfo',
        'scope' => 'openid profile email',
    ],
    'microsoft' => [
        'n' => 'Microsoft',
        'auth' => 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        'token' => 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        'user' => 'https://graph.microsoft.com/oidc/userinfo',
        'scope' => 'openid email profile',
    ],
];
const GMAIL_SCOPES = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me/';
// v41: what the other connections ask for, each on its own consent screen: a person's calendar (Google or Microsoft),
// their Microsoft 365 / Outlook mailbox, and the company's Microsoft 365 mailbox for the portal's own email
const CAL_GOOGLE_SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy';
const CAL_MS_SCOPES = 'offline_access User.Read Calendars.ReadWrite';
const MSMAIL_SCOPES = 'offline_access User.Read Mail.ReadWrite Mail.Send';
const MSSYS_SCOPES = 'offline_access User.Read Mail.Send';
const GRAPH_API = 'https://graph.microsoft.com/v1.0/';
const MYMAIL_LABELS = ['', 'candidate', 'consultant', 'vendor', 'client', 'personal'];
const MYMAIL_COLORS = ['blue', 'green', 'amber', 'red', 'purple', 'teal', 'gray'];
/** The person's own labels (v31), on top of the built-in ones: [{k: 'u_...', n: 'Name', c: 'color'}]. */
function mymailOwnLabels(string $uid): array
{
    $l = mkvGet('mylabels:' . $uid, []);
    return is_array($l) ? array_values(array_filter($l, fn($x) => is_array($x) && preg_match('/^u_[a-z0-9_]{1,36}$/', (string) ($x['k'] ?? '')))) : [];
}
function mymailLabelKeys(string $uid): array
{
    return array_merge(MYMAIL_LABELS, array_map(fn($x) => (string) $x['k'], mymailOwnLabels($uid)));
}

function ssoCfg(): array
{
    $d = docGet('sec/x/sso/cfg');
    $out = [];
    foreach (SSO_PROVIDERS as $k => $p) {
        $c = $d && isset($d->$k) && $d->$k instanceof stdClass ? $d->$k : new stdClass();
        $out[$k] = ['id' => (string) ($c->id ?? ''), 'secret' => (string) ($c->secret ?? ''), 'on' => !empty($c->on), 'gis' => !isset($c->gis) || !empty($c->gis)];
    }
    return $out;
}
/** v41: may people connect their calendar or mailbox with this provider? (Its app is set up: a client ID and secret;
 *  the sign-in button on the login page has its own switch.) */
function ssoConnectable(string $p): bool
{
    $c = ssoCfg()[$p] ?? null;
    return $c !== null && $c['id'] !== '' && $c['secret'] !== '';
}
/** A new access token from a saved refresh token: [access token, expires at (ms), the new refresh token Microsoft hands
 *  out each time (keep it: the old one runs out), the error]. */
function ssoRefresh(string $p, string $refresh, string $scope = '', ?array $app = null): array
{
    // $app: another site's app (id, secret in plain): a company workspace sending through StratEdge's Microsoft mailbox
    $c = $app ? ['id' => (string) ($app['id'] ?? ''), 'secret' => (string) ($app['secret'] ?? '')] : (ssoCfg()[$p] ?? null);
    if (!$c || $c['id'] === '' || $c['secret'] === '' || $refresh === '') {
        return ['', 0, '', 'not set up'];
    }
    $post = ['client_id' => $c['id'], 'client_secret' => $app ? $c['secret'] : mailUnseal($c['secret']), 'refresh_token' => $refresh, 'grant_type' => 'refresh_token'];
    if ($p === 'microsoft' && $scope !== '') {
        $post['scope'] = $scope;
    }
    [$code, $tok] = ssoHttp(SSO_PROVIDERS[$p]['token'], $post, ['Accept: application/json']);
    if ($code !== 200 || !is_array($tok) || empty($tok['access_token'])) {
        return ['', 0, '', is_array($tok) ? (string) ($tok['error_description'] ?? ($tok['error'] ?? $code)) : (string) $code];
    }
    return [(string) $tok['access_token'], now() + ((int) ($tok['expires_in'] ?? 3600) - 60) * 1000, (string) ($tok['refresh_token'] ?? ''), ''];
}
function ssoRedirect(): string
{
    // v38: the address the sign-in started on (a workspace may be opened at /w/<name>/, its subdomain or its own domain)
    return ssoBase() . 'api/index.php?r=sso_cb';
}
/** A provider's refusal of a real sign-in attempt, kept (one per provider) so the admin test can show it. */
function ssoNoteRefusal(string $p, string $err, string $desc): void
{
    @error_log(date('c') . ' sso ' . $p . ' refused the sign-in: ' . $err . ($desc !== '' ? ' - ' . $desc : '') . "\n", 3, storeDir() . '/error.log');
    $doc = docGet('sec/x/sso/cfg') ?? new stdClass();
    if (!isset($doc->$p) || !($doc->$p instanceof stdClass)) {
        $doc->$p = new stdClass();
    }
    $doc->$p->lastErr = (object) ['at' => now(), 'err' => $err, 'desc' => $desc];
    docSet('sec/x/sso/cfg', $doc);
}
/** What a provider's refusal means and what to do about it, in plain words. */
function ssoExplainRefusal(string $p, string $err, string $desc): string
{
    $n = SSO_PROVIDERS[$p]['n'] ?? $p;
    $hay = strtolower($err . ' ' . $desc);
    if ($p === 'linkedin' && (str_contains($hay, 'scope') || str_contains($hay, 'unauthorized'))) {
        return 'LinkedIn has not allowed the sign-in scopes for this app: open the app at linkedin.com/developers › Products and add "Sign In with LinkedIn using OpenID Connect" (approved at once), then try again.';
    }
    if (str_contains($hay, 'redirect')) {
        return 'The redirect address is not registered with ' . $n . ': add ' . ssoRedirect() . ' exactly as written.';
    }
    if (str_contains($hay, 'invalid_client') || str_contains($hay, 'unauthorized_client') || str_contains($hay, 'client')) {
        return $n . ' does not know this client ID: paste the Client ID and secret again from the ' . $n . ' developer console.';
    }
    if ($p === 'google' && (str_contains($hay, 'access_denied') || str_contains($hay, 'verification') || str_contains($hay, 'not verified'))) {
        return 'Google blocks the app for people outside its test users while the OAuth consent screen is in testing: publish it (Google Cloud console › OAuth consent screen) or add the sign-in addresses as test users.';
    }
    if ($p === 'microsoft' && str_contains($hay, 'aadsts')) {
        return 'Microsoft refused the request (' . mb_substr($desc, 0, 120) . '). Check that the app registration allows personal and organizational accounts and lists the redirect address as a Web platform.';
    }
    return $n . ' refused the sign-in' . ($desc !== '' ? ': ' . $desc : ($err !== '' ? ' (' . $err . ')' : '')) . '.';
}
/** One HTTP call; returns [status, decoded JSON array or raw string]. */
function ssoHttp(string $url, ?array $post, array $headers = []): array
{
    if (!function_exists('curl_init')) {
        return [0, 'PHP cURL is not available on this server.'];
    }
    $ch = curl_init(extUrl($url));
    $opts = [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 25, CURLOPT_HTTPHEADER => $headers];
    if ($post !== null) {
        $opts[CURLOPT_POST] = true;
        $opts[CURLOPT_POSTFIELDS] = isset($post['__raw']) ? (string) $post['__raw'] : http_build_query($post);
    }
    curl_setopt_array($ch, $opts);
    $body = curl_exec($ch);
    $st = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($body === false) {
        return [0, $err];
    }
    $j = json_decode((string) $body, true);
    return [$st, is_array($j) ? $j : (string) $body];
}
function ssoGo(string $hash): never
{
    // back to the address the sign-in started on, where its session lives
    header('Location: ' . ssoBase() . $hash);
    exit();
}
function ssoStart(): never
{
    $p = (string) ($_GET['p'] ?? '');
    $cfg = ssoCfg();
    // v41: besides signing in, a signed-in person connects their Gmail, their calendar (Google or Microsoft) or their
    // Microsoft 365 / Outlook mailbox, and an administrator the company's Microsoft 365 mailbox for the portal's email
    $what = ($_GET['gmail'] ?? '') === '1' ? 'gmail' : (string) ($_GET['connect'] ?? '');
    if (!in_array($what, ['', 'gmail', 'cal', 'mail', 'sysmail'], true) || !isset(SSO_PROVIDERS[$p])) {
        fail(400, 'invalid_argument', 'That sign-in method is not switched on.');
    }
    $u = currentUser();
    if ($what === '') {
        if (!$cfg[$p]['on'] || $cfg[$p]['id'] === '') {
            fail(400, 'invalid_argument', 'That sign-in method is not switched on.');
        }
    } else {
        if (!$u) {
            fail(403, 'invalid_argument', 'Log in first, then connect.');
        }
        $fits = ['gmail' => ['google'], 'cal' => ['google', 'microsoft'], 'mail' => ['microsoft'], 'sysmail' => ['microsoft']][$what];
        if (!in_array($p, $fits, true) || !ssoConnectable($p)) {
            fail(400, 'invalid_argument', SSO_PROVIDERS[$p]['n'] . ' is not set up for connections yet: an administrator adds its app under Roles & access › Sign-in providers.');
        }
        if ($what === 'sysmail' && !hasRole($u, 'admin')) {
            fail(403, 'forbidden', 'Only an administrator connects the company mailbox.');
        }
    }
    $state = rid(16);
    $_SESSION['sso'] = [
        's' => $state,
        'p' => $p,
        'as' => preg_replace('/[^a-z]/', '', (string) ($_GET['as'] ?? '')),
        'next' => mb_substr((string) ($_GET['next'] ?? ''), 0, 300),
        'gmail' => $what === 'gmail',
        'what' => $what,
        'uid' => $u['id'] ?? '',
        'at' => now(),
    ];
    $extra = ['' => '', 'gmail' => GMAIL_SCOPES, 'cal' => $p === 'google' ? CAL_GOOGLE_SCOPES : CAL_MS_SCOPES, 'mail' => MSMAIL_SCOPES, 'sysmail' => MSSYS_SCOPES][$what];
    $q = [
        'client_id' => $cfg[$p]['id'],
        'redirect_uri' => ssoRedirect(),
        'response_type' => 'code',
        'scope' => SSO_PROVIDERS[$p]['scope'] . ($extra !== '' ? ' ' . $extra : ''),
        'state' => $state,
    ];
    if ($p === 'google') {
        $q['access_type'] = $what !== '' ? 'offline' : 'online';
        if ($what !== '') {
            $q['prompt'] = 'consent';
            $q['include_granted_scopes'] = 'true';
        }
    }
    if ($p === 'microsoft' && $what !== '') {
        // the account to connect may not be the one the browser is signed in to
        $q['prompt'] = 'select_account';
        $q['response_mode'] = 'query';
    }
    header('Location: ' . SSO_PROVIDERS[$p]['auth'] . '?' . http_build_query($q));
    exit();
}
/** Where a connection (not a sign-in) comes back to, with how it went. */
function ssoConnBack(array $st, string $how): string
{
    $what = (string) ($st['what'] ?? '');
    if ($what === 'gmail' || $what === 'mail') {
        return '#/portal/mymail?' . ($how === 'ok' ? 'connected=1' : 'conn=' . rawurlencode($how));
    }
    if ($what === 'sysmail') {
        return '#/portal/admin/mail?tab=settings&m365=' . rawurlencode($how === 'ok' ? 'connected' : $how);
    }
    $next = (string) ($st['next'] ?? '');
    if ($next === '' || !preg_match('#^/[A-Za-z0-9/_\-?=&.%]*$#', $next) || str_starts_with($next, '//')) {
        $next = '/portal';
    }
    $next = (string) preg_replace('/[?&]cal=[a-z]+/', '', $next);
    return '#' . $next . (str_contains($next, '?') ? '&' : '?') . 'cal=' . rawurlencode($how === 'ok' ? 'connected' : $how);
}
function ssoCallback(): never
{
    $st = $_SESSION['sso'] ?? null;
    unset($_SESSION['sso']);
    // v41: a connection (Gmail, a calendar, a Microsoft mailbox, the company mailbox) comes back to its own page, even
    // when it went wrong; a sign-in comes back to the login page
    $what = is_array($st) ? (string) ($st['what'] ?? (!empty($st['gmail']) ? 'gmail' : '')) : '';
    $back = $what !== ''
        ? function (string $err) use ($st): never {
            ssoGo(ssoConnBack($st, $err));
        }
        : function (string $err): never {
            ssoGo('#/login?sso=' . rawurlencode($err));
        };
    if (!$st || (int) ($st['at'] ?? 0) < now() - 600000 || (string) ($_GET['state'] ?? '') !== (string) $st['s']) {
        $back('expired');
    }
    $p = (string) $st['p'];
    if (isset($_GET['error'])) {
        // the person pressed Cancel at the provider, or the provider refused the request itself (LinkedIn without the
        // "Sign In with LinkedIn using OpenID Connect" product answers unauthorized_scope_error, say): the refusal is
        // shown on the login page, logged, and kept for the admin's sign-in test
        $err = mb_substr(preg_replace('/[^\w.\- ]/', '', (string) $_GET['error']), 0, 60);
        $desc = mb_substr(trim(strip_tags((string) ($_GET['error_description'] ?? ''))), 0, 240);
        if (in_array($err, ['access_denied', 'user_cancelled_login', 'user_cancelled_authorize', 'consent_required', 'login_required', 'interaction_required'], true)) {
            $back('denied');
        }
        ssoNoteRefusal($p, $err, $desc);
        if ($what !== '') {
            $back('refused');
        }
        ssoGo('#/login?sso=provider&p=' . rawurlencode($p) . '&d=' . rawurlencode(($err !== '' ? $err . ': ' : '') . $desc));
    }
    $cfg = ssoCfg()[$p];
    [$code, $tok] = ssoHttp(
        SSO_PROVIDERS[$p]['token'],
        [
            'code' => (string) ($_GET['code'] ?? ''),
            'client_id' => $cfg['id'],
            'client_secret' => mailUnseal($cfg['secret']),
            'redirect_uri' => ssoRedirect(),
            'grant_type' => 'authorization_code',
        ],
        ['Accept: application/json']
    );
    if ($code !== 200 || !is_array($tok) || empty($tok['access_token'])) {
        mailLog('sso ' . $p . ' token exchange failed: ' . $code . ' ' . (is_array($tok) ? json_encode($tok) : (string) $tok));
        $back('token');
    }
    [$c2, $info] = ssoHttp(SSO_PROVIDERS[$p]['user'], null, ['Authorization: Bearer ' . $tok['access_token']]);
    $email = is_array($info) ? strtolower(trim((string) ($info['email'] ?? ''))) : '';
    $name = is_array($info) ? trim((string) ($info['name'] ?? trim(($info['given_name'] ?? '') . ' ' . ($info['family_name'] ?? '')))) : '';
    if ($what !== '' && $p === 'microsoft' && ($c2 !== 200 || !filter_var($email, FILTER_VALIDATE_EMAIL))) {
        // a Microsoft account without an email claim: its mailbox address (or sign-in name) from Graph
        [$c3, $me] = ssoHttp(GRAPH_API . 'me?$select=mail,userPrincipalName,displayName', null, ['Authorization: Bearer ' . $tok['access_token'], 'Accept: application/json']);
        if ($c3 === 200 && is_array($me)) {
            $email = strtolower(trim((string) (($me['mail'] ?? '') ?: ($me['userPrincipalName'] ?? ''))));
            $name = $name !== '' ? $name : trim((string) ($me['displayName'] ?? ''));
            $c2 = 200;
        }
    }
    if ($c2 !== 200 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        mailLog('sso ' . $p . ' profile failed: ' . $c2);
        $back('profile');
    }
    if ($what === 'cal' || $what === 'mail' || $what === 'sysmail') {
        $u = currentUser();
        if (!$u || $u['id'] !== (string) $st['uid']) {
            $back('expired');
        }
        if (empty($tok['refresh_token'])) {
            // without a refresh token the connection would stop within the hour
            $back('norefresh');
        }
        $exp = now() + ((int) ($tok['expires_in'] ?? 3600) - 60) * 1000;
        if ($what === 'cal') {
            require_once __DIR__ . '/cal.php';
            calStore($u, $p, $email, $name, (string) $tok['refresh_token'], (string) $tok['access_token'], $exp);
            ssoGo(ssoConnBack($st, 'ok'));
        }
        if ($what === 'mail') {
            mymailStore($u['id'], ['provider' => 'microsoft', 'email' => $email, 'name' => $name, 'refresh' => (string) $tok['refresh_token'], 'access' => (string) $tok['access_token'], 'exp' => $exp, 'pass' => '']);
            ssoGo(ssoConnBack($st, 'ok'));
        }
        // the company's own mailbox for the portal's email (Microsoft 365, through Graph)
        if (!hasRole($u, 'admin')) {
            $back('denied');
        }
        $old = mkvGet('settings', []);
        $old = is_array($old) ? $old : [];
        mkvSet('settings', [
            'provider' => 'm365',
            'region' => 'us',
            'whk' => '',
            'host' => '',
            'port' => 443,
            'secure' => 'tls',
            'user' => $email,
            'pass' => mailSeal((string) $tok['refresh_token']),
            'from' => $email,
            'from_name' => (string) ($old['from_name'] ?? ''),
            'limit' => ($old['provider'] ?? '') === 'm365' ? (int) ($old['limit'] ?? MAIL_PROVIDERS['m365']['limit']) : MAIL_PROVIDERS['m365']['limit'],
            'gap' => 1,
            'rate' => ($old['provider'] ?? '') === 'm365' ? (float) ($old['rate'] ?? 0.4) : 0.4,
            'pkey' => '',
            'cset' => '',
            'topic' => '',
            'ip' => (string) ($old['ip'] ?? ''),
            'dkimSel' => (string) ($old['dkimSel'] ?? ''),
        ]);
        mkvSet('m365_tok', ['a' => mailSeal((string) $tok['access_token']), 'exp' => $exp]);
        metaSet('mail_wait', 0);
        mailSettings(true);
        audit('settings', 'Company email connected to Microsoft 365', $email, [], $u);
        ssoGo(ssoConnBack($st, 'ok'));
    }
    if (!empty($st['gmail'])) {
        $u = currentUser();
        if (!$u || $u['id'] !== (string) $st['uid']) {
            $back('expired');
        }
        if (empty($tok['refresh_token'])) {
            // Google only hands out a refresh token the first time; without one the connection would stop in an hour
            mymailStore($u['id'], ['provider' => 'google', 'email' => $email, 'name' => $name, 'refresh' => '', 'access' => (string) $tok['access_token'], 'exp' => now() + 3000000, 'pass' => '']);
            ssoGo('#/portal/mymail?connected=short');
        }
        mymailStore($u['id'], [
            'provider' => 'google',
            'email' => $email,
            'name' => $name,
            'refresh' => (string) $tok['refresh_token'],
            'access' => (string) $tok['access_token'],
            'exp' => now() + ((int) ($tok['expires_in'] ?? 3600) - 60) * 1000,
            'pass' => '',
        ]);
        ssoGo('#/portal/mymail?connected=1');
    }
    $as = (string) $st['as'];
    $u = ssoAccount($p, $email, $name, $back);
    // signed in through a particular portal's login: the account must have that portal (same rule as the password login)
    $asKey = portalKeyOfLogin($as);
    if ($asKey !== '') {
        $refusal = portalLoginCheck($u, $asKey);
        if ($refusal !== null) {
            ssoGo('#/login?as=' . $as . '&sso=portal&who=' . rawurlencode((string) $u['email']) . '&p=' . implode(',', array_map(fn($x) => $x['login'], $refusal['portals'])));
        }
    }
    ssoGo(ssoOpen($u, $p, $asKey, (string) $st['next']));
}
/** The account behind a verified provider email: found, or created on the spot (screened first). */
function ssoAccount(string $p, string $email, string $name, callable $back): array
{
    $s = db()->prepare('SELECT * FROM users WHERE email = ?');
    $s->execute([$email]);
    $u = $s->fetch();
    if (!$u && wsSlug() !== '' && empty(wsCurrent()['setupDone'])) {
        $back('blocked'); // v37: no accounts in a company workspace before its first administrator sets it up
    }
    if (!$u) {
        if (fwScreen(['name' => $name, 'email' => $email], 'sign-in with ' . SSO_PROVIDERS[$p]['n']) !== '') {
            $back('blocked');
        }
        $id = 'u_' . rid(8);
        db()
            ->prepare('INSERT INTO users (id, email, name, pass, role, status, created) VALUES (?,?,?,?,?,?,?)')
            ->execute([$id, $email, $name !== '' ? mb_substr($name, 0, 120) : $email, password_hash(rid(16), PASSWORD_DEFAULT), 'user', 'active', now()]);
        $s->execute([$email]);
        $u = $s->fetch();
    }
    if (!$u || $u['status'] !== 'active') {
        $back('disabled');
    }
    $u['roles'] = rolesOf($u);
    return $u;
}
/** Starts the session for a verified sign-in and returns where the browser goes next. v34: when the person has (or
 *  must set up) two-step sign-in, the session waits for it and the browser goes to the sign-in page's second step. */
function ssoOpen(array $u, string $p, string $asKey, string $next, string $how = ''): string
{
    $r = ssoBegin($u, $p, $asKey, $next, $how);
    if (isset($r['mfa'])) {
        $login = ['mgr' => 'manager'][$asKey] ?? $asKey;
        return '#/login?mfa=1' . ($login !== '' ? '&as=' . $login : '');
    }
    return (string) $r['go'];
}
/** authBegin for a provider sign-in: ['go' => ...] or ['mfa' => ...]. */
function ssoBegin(array $u, string $p, string $asKey, string $next, string $how = ''): array
{
    require_once __DIR__ . '/auth.php';
    if (($lock = authLocked($u)) !== '') {
        // a locked account stays locked whichever way someone tries to come in
        $GLOBALS['ssoLocked'] = $lock;
        return ['go' => '#/login?sso=locked' . ($asKey !== '' ? '&as=' . (['mgr' => 'manager'][$asKey] ?? $asKey) : '')];
    }
    if (function_exists('guardNetOk') && !guardNetOk($u)) {
        // v35: staff accounts sign in only from the staff networks
        guardNetRefuse($u);
        return ['go' => '#/login?sso=network' . ($asKey !== '' ? '&as=' . (['mgr' => 'manager'][$asKey] ?? $asKey) : '')];
    }
    if ($next !== '' && preg_match('#^/[A-Za-z0-9/_\-?=&.%]*$#', $next) && !str_starts_with($next, '//')) {
        $go = '#' . $next;
    } elseif ($asKey !== '') {
        // straight into the portal that was chosen; a new account sets up its profile for it first
        $fresh = portalOf($u['id']) === '' && in_array($asKey, ['employee', 'consultant', 'bench', 'client'], true) && !in_array($asKey, portalsOf($u), true);
        $go = $fresh ? '#/portal?as=' . $asKey : portalHome($asKey);
    } else {
        // no portal chosen (a plain sign-in link): the portal chooser
        $go = '#/portal/choose';
    }
    return authBegin($u, 'sso:' . $p . ($how !== '' ? ':' . $how : '') . ($asKey !== '' ? ':' . $asKey : ''), $asKey, $go);
}
/**
 * Google's own sign-in button (Google Identity Services) hands the page an ID token instead of sending the browser
 * away; this verifies it with Google and signs the person in. The site address must be listed under
 * "Authorized JavaScript origins" on the OAuth client, or Google refuses to draw the button.
 */
/** Checks an ID token from Google's own button with Google: returns [email, name] or fails. */
function ssoGisToken(array $b): array
{
    $cfg = ssoCfg()['google'];
    if (!$cfg['on'] || $cfg['id'] === '') {
        fail(400, 'invalid_argument', 'Sign in with Google is not switched on.');
    }
    $cred = trim((string) ($b['credential'] ?? ''));
    if ($cred === '' || strlen($cred) > 4000 || !preg_match('/^[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$/', $cred)) {
        fail(400, 'invalid_argument', 'That Google sign-in did not complete. Try again.');
    }
    [$code, $info] = ssoHttp('https://oauth2.googleapis.com/tokeninfo?id_token=' . rawurlencode($cred), null, ['Accept: application/json']);
    if ($code !== 200 || !is_array($info)) {
        mailLog('sso google id-token check failed: ' . $code . ' ' . (is_array($info) ? json_encode($info) : (string) $info));
        fail(401, 'sso_token', 'Google did not confirm that sign-in. Try again.');
    }
    $iss = (string) ($info['iss'] ?? '');
    $okIss = in_array($iss, ['accounts.google.com', 'https://accounts.google.com'], true);
    $okAud = hash_equals($cfg['id'], (string) ($info['aud'] ?? ''));
    $okExp = (int) ($info['exp'] ?? 0) > time() - 30;
    $email = strtolower(trim((string) ($info['email'] ?? '')));
    $verified = in_array((string) ($info['email_verified'] ?? ''), ['true', '1'], true) || ($info['email_verified'] ?? null) === true;
    if (!$okIss || !$okAud || !$okExp || !$verified || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        mailLog('sso google id-token rejected: iss=' . $iss . ' aud-ok=' . ($okAud ? 1 : 0) . ' exp-ok=' . ($okExp ? 1 : 0) . ' verified=' . ($verified ? 1 : 0));
        fail(401, 'sso_token', 'That Google account could not be verified for this site.');
    }
    $name = trim((string) ($info['name'] ?? trim(($info['given_name'] ?? '') . ' ' . ($info['family_name'] ?? ''))));
    return [$email, $name];
}
function ssoGis(array $b): never
{
    [$email, $name] = ssoGisToken($b);
    $back = function (string $err): never {
        $msg = ['blocked' => 'That account cannot be created here.', 'disabled' => 'This account is paused. Contact StratEdge HR.'][$err] ?? 'That sign-in did not complete.';
        fail(403, 'sso_' . $err, $msg);
    };
    $u = ssoAccount('google', $email, $name, $back);
    $as = preg_replace('/[^a-z]/', '', (string) ($b['as'] ?? '')) ?? '';
    $asKey = portalKeyOfLogin($as);
    if ($asKey !== '') {
        $refusal = portalLoginCheck($u, $asKey);
        if ($refusal !== null) {
            http_response_code(403);
            echo json_encode($refusal + ['sso' => true]);
            exit();
        }
    }
    $res = ssoBegin($u, 'google', $asKey, mb_substr((string) ($b['next'] ?? ''), 0, 300), 'button');
    if (!empty($GLOBALS['ssoLocked'])) {
        fail(429, 'locked', (string) $GLOBALS['ssoLocked']);
    }
    if (isset($res['mfa'])) {
        ok(['mfa' => $res['mfa']]);
    }
    ok(['user' => publicUser($u), 'go' => $res['go']]);
}

/* ---------- each person's mailbox ---------- */
/** A bounce seen in someone's mailbox: their sent message is marked "Bounced", the address is remembered and skipped. */
function mymailBounce(string $uid, array $dsn, int $at): void
{
    try {
        $pdo = mymailDb();
        $st = $pdo->prepare("SELECT id, err FROM mail_user_msgs WHERE uid = ? AND dir = 'out' AND LOWER(to_email) LIKE ? ORDER BY at DESC LIMIT 1");
        $st->execute([$uid, '%' . strtolower($dsn['email']) . '%']);
        $m = $st->fetch();
        if ($m && !str_starts_with((string) $m['err'], 'Bounced')) {
            $pdo->prepare("UPDATE mail_user_msgs SET err = ?, label = 'bounced' WHERE id = ?")->execute(['Bounced: ' . $dsn['why'], $m['id']]);
        }
        if (!empty($dsn['permanent'])) {
            mailAddrBounced($dsn['email'], $dsn['why'], 'gmail', $at);
        }
    } catch (Throwable $e) {
        @error_log(date('c') . ' bounce from mailbox failed: ' . $e->getMessage() . "\n", 3, storeDir() . '/error.log');
    }
}
function mymailDb(): PDO
{
    static $ready = false;
    $pdo = mdb();
    if (!$ready) {
        $ready = true;
        $pdo->exec('CREATE TABLE IF NOT EXISTS mail_user_acct (uid VARCHAR(40) PRIMARY KEY, provider VARCHAR(12) NOT NULL, email VARCHAR(190) NOT NULL,
            name VARCHAR(120) NOT NULL, refresh TEXT, access TEXT, exp BIGINT NOT NULL, pass TEXT, synced BIGINT NOT NULL, created BIGINT NOT NULL)');
        $pdo->exec('CREATE TABLE IF NOT EXISTS mail_user_msgs (id VARCHAR(24) PRIMARY KEY, uid VARCHAR(40) NOT NULL, dir VARCHAR(4) NOT NULL, at BIGINT NOT NULL,
            from_email VARCHAR(190) NOT NULL, from_name VARCHAR(190) NOT NULL, to_email TEXT, cc TEXT, subject VARCHAR(500) NOT NULL, text TEXT, snippet VARCHAR(300) NOT NULL,
            msgid VARCHAR(300) NOT NULL, thread VARCHAR(120) NOT NULL, label VARCHAR(40) NOT NULL, seen TINYINT NOT NULL, starred TINYINT NOT NULL, gid VARCHAR(40) NOT NULL, err TEXT)');
        $pdo->exec('CREATE TABLE IF NOT EXISTS mail_user_book (uid VARCHAR(40) NOT NULL, email VARCHAR(190) NOT NULL, name VARCHAR(190) NOT NULL, tag VARCHAR(40) NOT NULL,
            last BIGINT NOT NULL, n INT NOT NULL, PRIMARY KEY (uid, email))');
        try {
            $pdo->exec('CREATE INDEX mail_user_msgs_uid ON mail_user_msgs (uid, at)');
        } catch (Throwable $e) {
            // the index already exists
        }
    }
    return $pdo;
}
function mymailAcct(string $uid): ?array
{
    $s = mymailDb()->prepare('SELECT * FROM mail_user_acct WHERE uid = ?');
    $s->execute([$uid]);
    $r = $s->fetch();
    return $r ?: null;
}
function mymailStore(string $uid, array $a): void
{
    $pdo = mymailDb();
    $pdo->prepare('DELETE FROM mail_user_acct WHERE uid = ?')->execute([$uid]);
    $pdo->prepare('INSERT INTO mail_user_acct (uid, provider, email, name, refresh, access, exp, pass, synced, created) VALUES (?,?,?,?,?,?,?,?,?,?)')->execute([
        $uid,
        $a['provider'],
        $a['email'],
        mb_substr((string) $a['name'], 0, 120),
        $a['refresh'] !== '' ? mailSeal($a['refresh']) : '',
        $a['access'] !== '' ? mailSeal($a['access']) : '',
        (int) $a['exp'],
        $a['pass'] !== '' ? mailSeal($a['pass']) : '',
        0,
        now(),
    ]);
}
function mymailAddr(string $s): array
{
    if (preg_match('/^\s*"?([^"<]*)"?\s*<([^>]+)>/', $s, $m)) {
        return [strtolower(trim($m[2])), trim($m[1])];
    }
    return [strtolower(trim($s)), ''];
}
function mymailFirst(string $email, string $name = ''): string
{
    if ($name !== '') {
        return ucfirst(strtolower(explode(' ', trim($name))[0]));
    }
    $local = explode('@', $email)[0];
    return ucfirst(strtolower((string) preg_split('/[._\-0-9]+/', $local)[0]));
}
function mymailBook(string $uid, string $email, string $name, int $at): void
{
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return;
    }
    $pdo = mymailDb();
    $s = $pdo->prepare('SELECT name, n FROM mail_user_book WHERE uid = ? AND email = ?');
    $s->execute([$uid, $email]);
    if ($r = $s->fetch()) {
        $pdo->prepare('UPDATE mail_user_book SET name = ?, last = ?, n = ? WHERE uid = ? AND email = ?')->execute([$name !== '' ? mb_substr($name, 0, 190) : $r['name'], $at, (int) $r['n'] + 1, $uid, $email]);
    } else {
        $pdo->prepare('INSERT INTO mail_user_book (uid, email, name, tag, last, n) VALUES (?,?,?,?,?,?)')->execute([$uid, $email, mb_substr($name, 0, 190), '', $at, 1]);
    }
}
function mymailList(mixed $v): array
{
    $out = [];
    foreach (preg_split('/[,;\s]+/', is_array($v) ? implode(',', $v) : (string) $v) as $x) {
        $x = strtolower(trim($x, " \t<>"));
        if ($x !== '' && filter_var($x, FILTER_VALIDATE_EMAIL) && !in_array($x, $out, true)) {
            $out[] = $x;
        }
    }
    return $out;
}
/** A plain text/HTML message as raw RFC 822 text. */
function mymailMime(string $fromName, string $from, array $to, array $cc, array $bcc, string $subject, string $text, string $inReplyTo = '', array $atts = []): string
{
    $b = 'b' . rid(10);
    $enc = fn(string $s) => '=?UTF-8?B?' . base64_encode($s) . '?=';
    $h = ['From: ' . ($fromName !== '' ? $enc($fromName) . ' ' : '') . '<' . $from . '>', 'To: ' . implode(', ', $to)];
    if ($cc) {
        $h[] = 'Cc: ' . implode(', ', $cc);
    }
    if ($bcc) {
        $h[] = 'Bcc: ' . implode(', ', $bcc);
    }
    if ($inReplyTo !== '') {
        $h[] = 'In-Reply-To: ' . $inReplyTo;
        $h[] = 'References: ' . $inReplyTo;
    }
    $h[] = 'Subject: ' . $enc($subject);
    $h[] = 'Date: ' . date('r');
    $h[] = 'Message-ID: <' . rid(12) . '@' . (parse_url(siteUrl(), PHP_URL_HOST) ?: 'localhost') . '>';
    $h[] = 'MIME-Version: 1.0';
    $html = '<div style="font:15px/1.6 Arial,sans-serif;color:#111">' . nl2br(htmlspecialchars($text, ENT_QUOTES, 'UTF-8')) . '</div>';
    $alt =
        "--$b\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($text)) .
        "--$b\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($html)) . "--$b--\r\n";
    if (!$atts) {
        $h[] = 'Content-Type: multipart/alternative; boundary="' . $b . '"';
        return implode("\r\n", $h) . "\r\n\r\n" . $alt;
    }
    // attachments (tailored resumes, say): multipart/mixed around the alternative part
    $m = 'm' . rid(10);
    $h[] = 'Content-Type: multipart/mixed; boundary="' . $m . '"';
    $body = "--$m\r\nContent-Type: multipart/alternative; boundary=\"$b\"\r\n\r\n" . $alt;
    foreach ($atts as $a) {
        $name = preg_replace('/[^A-Za-z0-9 ._()\-]/', '_', (string) ($a['name'] ?? 'file'));
        $body .= "--$m\r\nContent-Type: " . (string) ($a['type'] ?? 'application/octet-stream') . "; name=\"$name\"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=\"$name\"\r\n\r\n" . chunk_split(base64_encode((string) ($a['data'] ?? ''))) . "\r\n";
    }
    $body .= "--$m--\r\n";
    return implode("\r\n", $h) . "\r\n\r\n" . $body;
}
function gmailToken(array $a): string
{
    if ((int) $a['exp'] > now() && (string) $a['access'] !== '') {
        return mailUnseal((string) $a['access']);
    }
    if ((string) $a['refresh'] === '') {
        fail(400, 'gmail', 'The Gmail connection expired. Open My email and connect Gmail again.');
    }
    $cfg = ssoCfg()['google'];
    [$code, $tok] = ssoHttp(SSO_PROVIDERS['google']['token'], [
        'client_id' => $cfg['id'],
        'client_secret' => mailUnseal($cfg['secret']),
        'refresh_token' => mailUnseal((string) $a['refresh']),
        'grant_type' => 'refresh_token',
    ]);
    if ($code !== 200 || !is_array($tok) || empty($tok['access_token'])) {
        fail(400, 'gmail', 'Gmail needs to be connected again: the saved permission expired or was revoked.');
    }
    mymailDb()
        ->prepare('UPDATE mail_user_acct SET access = ?, exp = ? WHERE uid = ?')
        ->execute([mailSeal((string) $tok['access_token']), now() + ((int) ($tok['expires_in'] ?? 3600) - 60) * 1000, $a['uid']]);
    return (string) $tok['access_token'];
}
function gmailSend(array $a, string $raw): array
{
    $tok = gmailToken($a);
    [$code, $r] = ssoHttp(GMAIL_API . 'messages/send', ['__raw' => json_encode(['raw' => rtrim(strtr(base64_encode($raw), '+/', '-_'), '=')])], [
        'Authorization: Bearer ' . $tok,
        'Content-Type: application/json',
    ]);
    if ($code !== 200) {
        return [false, is_array($r) ? (string) ($r['error']['message'] ?? 'Gmail refused the message.') : 'Gmail refused the message (' . $code . ').'];
    }
    return [true, ''];
}
function mymailText(array $p): string
{
    $mime = (string) ($p['mimeType'] ?? '');
    if (!empty($p['parts']) && is_array($p['parts'])) {
        $plain = '';
        $html = '';
        foreach ($p['parts'] as $part) {
            $t = mymailText((array) $part);
            if ($t === '') {
                continue;
            }
            $pm = (string) ($part['mimeType'] ?? '');
            if ($pm === 'text/plain' && $plain === '') {
                $plain = $t;
            } elseif ($pm === 'text/html' && $html === '') {
                $html = $t;
            } elseif ($plain === '' && $html === '') {
                $plain = $t;
            }
        }
        return $plain !== '' ? $plain : $html;
    }
    $data = (string) ($p['body']['data'] ?? '');
    if ($data === '') {
        return '';
    }
    $raw = base64_decode(strtr($data, '-_', '+/'));
    if ($raw === false) {
        return '';
    }
    if ($mime === 'text/html') {
        $raw = preg_replace(['#<style.*?</style>#is', '#<script.*?</script>#is', '#<br\s*/?>#i', '#</(p|div|tr|li|h[1-6])>#i'], ['', '', "\n", "\n"], $raw);
        return trim(html_entity_decode(strip_tags((string) $raw), ENT_QUOTES, 'UTF-8'));
    }
    return trim($raw);
}
function gmailSync(array $a): int
{
    $tok = gmailToken($a);
    $pdo = mymailDb();
    [$code, $list] = ssoHttp(GMAIL_API . 'messages?' . http_build_query(['maxResults' => 40, 'q' => 'newer_than:21d -in:spam -in:trash']), null, ['Authorization: Bearer ' . $tok]);
    if ($code !== 200 || !is_array($list)) {
        fail(400, 'gmail', 'Gmail did not answer: ' . (is_array($list) ? (string) ($list['error']['message'] ?? $code) : $code));
    }
    $n = 0;
    foreach ((array) ($list['messages'] ?? []) as $m) {
        $gid = (string) ($m['id'] ?? '');
        if ($gid === '') {
            continue;
        }
        $s = $pdo->prepare('SELECT id FROM mail_user_msgs WHERE uid = ? AND gid = ?');
        $s->execute([$a['uid'], $gid]);
        if ($s->fetch()) {
            continue;
        }
        [$c2, $full] = ssoHttp(GMAIL_API . 'messages/' . rawurlencode($gid) . '?format=full', null, ['Authorization: Bearer ' . $tok]);
        if ($c2 !== 200 || !is_array($full)) {
            continue;
        }
        $h = [];
        foreach ((array) ($full['payload']['headers'] ?? []) as $x) {
            $h[strtolower((string) ($x['name'] ?? ''))] = (string) ($x['value'] ?? '');
        }
        $labels = (array) ($full['labelIds'] ?? []);
        $dir = in_array('SENT', $labels, true) ? 'out' : 'in';
        [$fe, $fn] = mymailAddr($h['from'] ?? '');
        $at = (int) ($full['internalDate'] ?? now());
        $pdo->prepare('INSERT INTO mail_user_msgs (id, uid, dir, at, from_email, from_name, to_email, cc, subject, text, snippet, msgid, thread, label, seen, starred, gid, err) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute([
            rid(12),
            $a['uid'],
            $dir,
            $at,
            mb_substr($fe, 0, 190),
            mb_substr($fn, 0, 190),
            mb_substr((string) ($h['to'] ?? ''), 0, 3000),
            mb_substr((string) ($h['cc'] ?? ''), 0, 3000),
            mb_substr((string) ($h['subject'] ?? ''), 0, 500),
            mb_substr(mymailText((array) ($full['payload'] ?? [])), 0, 200000),
            mb_substr(html_entity_decode((string) ($full['snippet'] ?? ''), ENT_QUOTES, 'UTF-8'), 0, 300),
            mb_substr((string) ($h['message-id'] ?? ''), 0, 300),
            mb_substr((string) ($full['threadId'] ?? ''), 0, 120),
            '',
            in_array('UNREAD', $labels, true) ? 0 : 1,
            in_array('STARRED', $labels, true) ? 1 : 0,
            $gid,
            '',
        ]);
        if ($dir === 'in') {
            $bodyText = mymailText((array) ($full['payload'] ?? []));
            // a delivery-failure message: the email that bounced is marked and the address remembered
            require_once __DIR__ . '/tools.php';
            $dsn = mailParseDsn($fe, (string) ($h['subject'] ?? ''), $bodyText);
            if ($dsn) {
                mymailBounce($a['uid'], $dsn, $at);
            } else {
                // vendor requirements that arrive in a person's own Gmail go to the requirements desk too
                require_once __DIR__ . '/vms.php';
                vmsMaybeRequirement($fe, $fn, (string) ($h['subject'] ?? ''), $bodyText, 'gmail', (string) ($h['message-id'] ?? ''));
                mymailBook($a['uid'], $fe, $fn, $at);
            }
        }
        $n++;
    }
    $pdo->prepare('UPDATE mail_user_acct SET synced = ? WHERE uid = ?')->execute([now(), $a['uid']]);
    return $n;
}
/* ---------- v41: a Microsoft 365 / Outlook.com mailbox through Microsoft Graph ---------- */

/** One Microsoft Graph call: $body as an array is sent as JSON, as a string as it is (with its own Content-Type). */
function msHttp(string $method, string $url, $body, string $tok, array $headers = []): array
{
    if (!function_exists('curl_init')) {
        return [0, 'PHP cURL is not available on this server.'];
    }
    $ch = curl_init(extUrl(str_starts_with($url, 'https://') ? $url : GRAPH_API . $url));
    $h = array_merge(['Authorization: Bearer ' . $tok, 'Accept: application/json'], $headers);
    $opts = [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_CUSTOMREQUEST => $method];
    if ($body !== null) {
        if (is_array($body)) {
            $h[] = 'Content-Type: application/json';
            $opts[CURLOPT_POSTFIELDS] = (string) json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        } else {
            $opts[CURLOPT_POSTFIELDS] = (string) $body;
        }
    }
    $opts[CURLOPT_HTTPHEADER] = $h;
    curl_setopt_array($ch, $opts);
    $raw = curl_exec($ch);
    $st = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($raw === false) {
        return [0, $err];
    }
    $j = json_decode((string) $raw, true);
    return [$st, is_array($j) ? $j : (string) $raw];
}
function msErr($r, string $fallback): string
{
    return is_array($r) ? (string) ($r['error']['message'] ?? ($r['error_description'] ?? $fallback)) : ($r !== '' ? mb_substr((string) $r, 0, 200) : $fallback);
}
/** The mailbox's access token, refreshed when it ran out (Microsoft hands out a new refresh token each time: kept). */
function msmailToken(array $a): string
{
    if ((int) $a['exp'] > now() && (string) $a['access'] !== '') {
        return mailUnseal((string) $a['access']);
    }
    [$acc, $exp, $newRefresh, $err] = ssoRefresh('microsoft', mailUnseal((string) $a['refresh']), MSMAIL_SCOPES);
    if ($acc === '') {
        fail(400, 'msmail', 'Your Microsoft mailbox needs to be connected again (My email): ' . mb_substr($err, 0, 160));
    }
    mymailDb()
        ->prepare('UPDATE mail_user_acct SET access = ?, exp = ?' . ($newRefresh !== '' ? ', refresh = ?' : '') . ' WHERE uid = ?')
        ->execute(array_merge([mailSeal($acc), $exp], $newRefresh !== '' ? [mailSeal($newRefresh)] : [], [$a['uid']]));
    return $acc;
}
/** Sends a whole message (MIME, as built for Gmail) through Graph: it is saved in the mailbox's Sent Items. */
function msmailSend(array $a, string $raw): array
{
    $tok = msmailToken($a);
    [$code, $r] = msHttp('POST', 'me/sendMail', base64_encode($raw), $tok, ['Content-Type: text/plain']);
    if ($code !== 202 && $code !== 200) {
        return [false, 'Microsoft refused the message: ' . msErr($r, (string) $code)];
    }
    return [true, ''];
}
/** Brings in the last three weeks of the inbox and of Sent Items (new messages only). */
function msmailSync(array $a): int
{
    $tok = msmailToken($a);
    mymailXid();
    $pdo = mymailDb();
    $since = gmdate('Y-m-d\TH:i:s\Z', time() - 21 * 86400);
    $n = 0;
    foreach (['inbox' => 'in', 'sentitems' => 'out'] as $folder => $dir) {
        $q = http_build_query([
            '$top' => 40,
            '$select' => 'id,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,flag,internetMessageId,conversationId,bodyPreview,body',
            '$filter' => 'receivedDateTime ge ' . $since,
            '$orderby' => 'receivedDateTime desc',
        ]);
        [$code, $list] = msHttp('GET', 'me/mailFolders/' . $folder . '/messages?' . $q, null, $tok, ['Prefer: outlook.body-content-type="text"']);
        if ($code !== 200 || !is_array($list)) {
            fail(400, 'msmail', 'Microsoft did not answer: ' . msErr($list, (string) $code));
        }
        foreach ((array) ($list['value'] ?? []) as $m) {
            $xid = (string) ($m['id'] ?? '');
            if ($xid === '') {
                continue;
            }
            $gid = sha1($xid);
            $s = $pdo->prepare('SELECT id FROM mail_user_msgs WHERE uid = ? AND gid = ?');
            $s->execute([$a['uid'], $gid]);
            if ($s->fetch()) {
                continue;
            }
            $addr = fn($r) => strtolower(trim((string) ($r['emailAddress']['address'] ?? '')));
            $fe = $addr((array) ($m['from'] ?? []));
            $fn = trim((string) ($m['from']['emailAddress']['name'] ?? ''));
            $at = strtotime((string) ($m['receivedDateTime'] ?? '')) ?: time();
            $text = trim((string) ($m['body']['content'] ?? ''));
            if (($m['body']['contentType'] ?? 'text') === 'html') {
                $text = trim(html_entity_decode(strip_tags((string) preg_replace(['#<style.*?</style>#is', '#<script.*?</script>#is', '#<br\s*/?>#i', '#</(p|div|tr|li|h[1-6])>#i'], ['', '', "\n", "\n"], $text)), ENT_QUOTES, 'UTF-8'));
            }
            $subject = (string) ($m['subject'] ?? '');
            $msgid = (string) ($m['internetMessageId'] ?? '');
            $pdo->prepare('INSERT INTO mail_user_msgs (id, uid, dir, at, from_email, from_name, to_email, cc, subject, text, snippet, msgid, thread, label, seen, starred, gid, err, xid) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute([
                rid(12),
                $a['uid'],
                $dir,
                $at * 1000,
                mb_substr($fe, 0, 190),
                mb_substr($fn, 0, 190),
                mb_substr(implode(', ', array_filter(array_map($addr, (array) ($m['toRecipients'] ?? [])))), 0, 3000),
                mb_substr(implode(', ', array_filter(array_map($addr, (array) ($m['ccRecipients'] ?? [])))), 0, 3000),
                mb_substr($subject, 0, 500),
                mb_substr($text, 0, 200000),
                mb_substr((string) ($m['bodyPreview'] ?? ''), 0, 300),
                mb_substr($msgid, 0, 300),
                substr(sha1((string) ($m['conversationId'] ?? $xid)), 0, 40),
                '',
                !empty($m['isRead']) || $dir === 'out' ? 1 : 0,
                ($m['flag']['flagStatus'] ?? '') === 'flagged' ? 1 : 0,
                $gid,
                '',
                $xid,
            ]);
            if ($dir === 'in') {
                require_once __DIR__ . '/tools.php';
                $dsn = mailParseDsn($fe, $subject, $text);
                if ($dsn) {
                    mymailBounce($a['uid'], $dsn, $at * 1000);
                } else {
                    require_once __DIR__ . '/vms.php';
                    vmsMaybeRequirement($fe, $fn, $subject, $text, 'microsoft', $msgid);
                    mymailBook($a['uid'], $fe, $fn, $at * 1000);
                }
            }
            $n++;
        }
    }
    $pdo->prepare('UPDATE mail_user_acct SET synced = ? WHERE uid = ?')->execute([now(), $a['uid']]);
    return $n;
}
/** v41: the provider's own message id (Microsoft's are longer than the gid column), added to older databases once. */
function mymailXid(): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    $pdo = mymailDb();
    try {
        $pdo->query('SELECT xid FROM mail_user_msgs LIMIT 0');
    } catch (Throwable $e) {
        $pdo->exec('ALTER TABLE mail_user_msgs ADD COLUMN xid TEXT');
    }
}
/** Sends a message (MIME) through a person's connected mailbox: the Gmail API, Microsoft Graph, or Gmail's SMTP with an
 *  app password ($session keeps one SMTP connection for several messages). Returns [ok, error]. */
function mymailSendRaw(array $a, string $raw, array $rcpts, ?SmtpSession $session = null): array
{
    if ($a['provider'] === 'google') {
        return gmailSend($a, $raw);
    }
    if ($a['provider'] === 'microsoft') {
        return msmailSend($a, $raw);
    }
    $own = $session === null;
    if ($own) {
        $session = new SmtpSession(['provider' => 'gmail', 'host' => 'smtp.gmail.com', 'port' => 465, 'secure' => 'ssl', 'user' => $a['email'], 'pass' => mailUnseal((string) $a['pass'])]);
        if (!$session->open()) {
            return [false, $session->error !== '' ? $session->error : 'The mail server could not be reached.'];
        }
    }
    $ok = $session->send($a['email'], $rcpts, $raw);
    $err = $ok ? '' : ($session->error !== '' ? $session->error : 'The mail server refused the message.');
    if ($own) {
        $session->close();
    }
    return [$ok, $err];
}
function mymailPublic(?array $a): ?array
{
    return $a ? ['provider' => $a['provider'], 'email' => $a['email'], 'name' => $a['name'], 'synced' => (int) $a['synced'], 'receive' => in_array($a['provider'], ['google', 'microsoft'], true)] : null;
}

function ssoRoute(string $r, string $method, array $b): never
{
    switch ($r) {
        case 'sso_start':
            ssoStart();
        case 'sso_cb':
            ssoCallback();
        case 'sso_gis':
            if ($method !== 'POST') {
                fail(405, 'invalid_argument', 'POST only.');
            }
            ssoGis($b);
        case 'sso_settings':
            $me = requireAdmin();
            if (!hasRole($me, 'admin')) {
                fail(403, 'invalid_argument', 'Only an administrator can change sign-in providers.');
            }
            $out = [];
            $raw = docGet('sec/x/sso/cfg');
            foreach (ssoCfg() as $k => $c) {
                $out[$k] = ['n' => SSO_PROVIDERS[$k]['n'], 'id' => $c['id'], 'hasSecret' => $c['secret'] !== '', 'on' => $c['on'], 'gis' => $c['gis']];
                if ($k === 'google') {
                    $g = $raw && isset($raw->google) && $raw->google instanceof stdClass ? $raw->google : new stdClass();
                    $out[$k]['gisOk'] = ssoGisHere($g);
                    $out[$k]['gisOkAt'] = (int) ($g->gisOkAt ?? 0);
                    $out[$k]['gisOkBy'] = (string) ($g->gisOkBy ?? '');
                    $out[$k]['gisOrigins'] = isset($g->gisOrigins) && is_array($g->gisOrigins) ? array_values($g->gisOrigins) : [];
                }
            }
            foreach ($out as $k => $row) {
                $le = $raw && isset($raw->$k->lastErr) && $raw->$k->lastErr instanceof stdClass ? $raw->$k->lastErr : null;
                $out[$k]['lastErr'] = $le ? ['at' => (int) ($le->at ?? 0), 'err' => (string) ($le->err ?? ''), 'desc' => (string) ($le->desc ?? ''), 'fix' => ssoExplainRefusal($k, (string) ($le->err ?? ''), (string) ($le->desc ?? ''))] : null;
            }
            // v41: what each connection asks for (to list on the provider's consent screen / API permissions)
            ok(['providers' => $out, 'redirect' => ssoRedirect(), 'origin' => ssoOriginOf(ssoBase()), 'addrs' => ssoAddrs(), 'gmailScopes' => GMAIL_SCOPES, 'connScopes' => ['google' => ['gmail' => GMAIL_SCOPES, 'cal' => CAL_GOOGLE_SCOPES], 'microsoft' => ['cal' => CAL_MS_SCOPES, 'mail' => MSMAIL_SCOPES, 'sysmail' => MSSYS_SCOPES]]]);
        case 'sso_gis_verify':
            // An administrator clicked Google's own button in the settings test and Google handed back an ID token:
            // the address is registered with Google, so the login page may show that button from now on.
            $me = requireAdmin();
            if (!hasRole($me, 'admin')) {
                fail(403, 'invalid_argument', 'Administrators only.');
            }
            [$email] = ssoGisToken($b);
            $doc = docGet('sec/x/sso/cfg') ?? new stdClass();
            if (!isset($doc->google) || !($doc->google instanceof stdClass)) {
                $doc->google = new stdClass();
            }
            $doc->google->gisOk = true;
            $doc->google->gisOkAt = now();
            $doc->google->gisOkBy = $email;
            // v38: verified for the address it was clicked on (each address is registered with Google on its own)
            $origins = isset($doc->google->gisOrigins) && is_array($doc->google->gisOrigins) ? $doc->google->gisOrigins : [];
            $here = ssoOriginOf(ssoBase());
            if (!in_array($here, $origins, true)) {
                $origins[] = $here;
            }
            $doc->google->gisOrigins = array_slice(array_values($origins), -10);
            docSet('sec/x/sso/cfg', $doc);
            ok(['ok' => true, 'email' => $email, 'at' => $doc->google->gisOkAt, 'origin' => $here]);
        case 'sso_test':
            // Asks each provider's token endpoint with a dummy code: a provider that answers "invalid code" has
            // accepted the client id, secret and redirect address; "invalid client" means the id or secret is wrong;
            // a redirect mismatch names the address to register. Nothing is signed in.
            $me = requireAdmin();
            if (!hasRole($me, 'admin')) {
                fail(403, 'invalid_argument', 'Administrators only.');
            }
            $out = [];
            foreach (ssoCfg() as $k => $c) {
                if (!$c['on'] && $c['id'] === '') {
                    continue;
                }
                if ($c['id'] === '' || $c['secret'] === '') {
                    $out[$k] = ['ok' => false, 'what' => 'Client ID or secret is missing.'];
                    continue;
                }
                [$code, $tok] = ssoHttp(
                    SSO_PROVIDERS[$k]['token'],
                    ['code' => 'stratedge-test-' . rid(4), 'client_id' => $c['id'], 'client_secret' => mailUnseal($c['secret']), 'redirect_uri' => ssoRedirect(), 'grant_type' => 'authorization_code'],
                    ['Accept: application/json']
                );
                $err = is_array($tok) ? (string) ($tok['error'] ?? '') : '';
                $desc = is_array($tok) ? (string) ($tok['error_description'] ?? '') : (string) $tok;
                if ($code === 0) {
                    $out[$k] = ['ok' => false, 'what' => 'The server could not reach ' . SSO_PROVIDERS[$k]['n'] . ' (' . mb_substr($desc, 0, 160) . '). Outbound connections may be blocked on this host.'];
                } elseif ($k === 'linkedin' && in_array($err, ['invalid_grant', 'invalid_request'], true) && stripos($desc, 'code') !== false) {
                    // LinkedIn answers every unknown code with the same "appid/redirect uri/code verifier does not match
                    // authorization code" line, whatever the client id, so the test proves only that LinkedIn is reachable
                    $out[$k] = ['ok' => false, 'soft' => true, 'what' => 'LinkedIn is reachable and answered the test code as expected. LinkedIn only checks the client ID, secret, redirect address and the "Sign In with LinkedIn using OpenID Connect" product during a real sign-in, so try "Continue with LinkedIn" on the login page: a refusal is shown here afterwards with what to fix.'];
                } elseif (in_array($err, ['invalid_grant', 'invalid_request'], true) && stripos($desc, 'redirect') === false) {
                    $out[$k] = ['ok' => true, 'what' => 'Client ID, secret and redirect address accepted by ' . SSO_PROVIDERS[$k]['n'] . '.'];
                } elseif ($err === 'invalid_client' || $err === 'unauthorized_client' || $code === 401) {
                    $out[$k] = ['ok' => false, 'what' => SSO_PROVIDERS[$k]['n'] . ' rejected the client ID or secret (' . ($desc !== '' ? mb_substr($desc, 0, 160) : $err) . '). Paste them again from the provider console.'];
                } elseif ($err === 'redirect_uri_mismatch' || stripos($desc, 'redirect') !== false) {
                    $out[$k] = ['ok' => false, 'what' => 'The redirect address is not registered with ' . SSO_PROVIDERS[$k]['n'] . ': add ' . ssoRedirect() . ' under Authorized redirect URIs.'];
                } else {
                    $out[$k] = ['ok' => false, 'what' => SSO_PROVIDERS[$k]['n'] . ' answered ' . $code . ' ' . mb_substr(($err !== '' ? $err . ': ' : '') . $desc, 0, 200)];
                }
            }
            $raw = docGet('sec/x/sso/cfg');
            foreach ($out as $k => $row) {
                $le = $raw && isset($raw->$k->lastErr) && $raw->$k->lastErr instanceof stdClass ? $raw->$k->lastErr : null;
                if ($le && (int) ($le->at ?? 0) > now() - 30 * 86400000) {
                    $out[$k]['last'] = ['at' => (int) $le->at, 'what' => (string) ($le->err ?? '') . ((string) ($le->desc ?? '') !== '' ? ' - ' . $le->desc : ''), 'fix' => ssoExplainRefusal($k, (string) ($le->err ?? ''), (string) ($le->desc ?? ''))];
                }
            }
            ok(['results' => $out, 'redirect' => ssoRedirect(), 'origin' => ssoOriginOf(ssoBase()), 'addrs' => ssoAddrs()]);
        case 'sso_settings_save':
            $me = requireAdmin();
            if (!hasRole($me, 'admin')) {
                fail(403, 'invalid_argument', 'Only an administrator can change sign-in providers.');
            }
            $cur = ssoCfg();
            $doc = docGet('sec/x/sso/cfg') ?? new stdClass();
            foreach (SSO_PROVIDERS as $k => $p) {
                $in = (array) ($b[$k] ?? []);
                $secret = trim((string) ($in['secret'] ?? ''));
                $prev = isset($doc->$k) && $doc->$k instanceof stdClass ? $doc->$k : new stdClass();
                $id = trim(mb_substr((string) ($in['id'] ?? $cur[$k]['id']), 0, 300));
                $doc->$k = (object) [
                    'id' => $id,
                    'secret' => $secret !== '' ? mailSeal($secret) : $cur[$k]['secret'],
                    'on' => !empty($in['on']),
                    'gis' => array_key_exists('gis', $in) ? !empty($in['gis']) : $cur[$k]['gis'],
                ];
                if ($id === $cur[$k]['id'] && isset($prev->lastErr) && $prev->lastErr instanceof stdClass) {
                    $doc->$k->lastErr = $prev->lastErr;
                }
                if ($k === 'google' && $id === $cur[$k]['id'] && !empty($prev->gisOk)) {
                    // the verified-button mark survives a save; a new client id has to be verified again
                    $doc->$k->gisOk = true;
                    $doc->$k->gisOkAt = (int) ($prev->gisOkAt ?? 0);
                    $doc->$k->gisOkBy = (string) ($prev->gisOkBy ?? '');
                    if (isset($prev->gisOrigins) && is_array($prev->gisOrigins)) {
                        $doc->$k->gisOrigins = $prev->gisOrigins;
                    }
                }
            }
            docSet('sec/x/sso/cfg', $doc);
            ok(['ok' => true]);
        case 'mymail_status':
            $u = requireUser();
            $a = mymailAcct($u['id']);
            $counts = ['in' => 0, 'unread' => 0, 'out' => 0];
            $st = mymailDb()->prepare('SELECT dir, SUM(CASE WHEN seen = 0 THEN 1 ELSE 0 END) AS unread, COUNT(*) AS n FROM mail_user_msgs WHERE uid = ? GROUP BY dir');
            $st->execute([$u['id']]);
            foreach ($st->fetchAll() as $x) {
                $counts[$x['dir']] = (int) $x['n'];
                if ($x['dir'] === 'in') {
                    $counts['unread'] = (int) $x['unread'];
                }
            }
            $seenAt = (int) (mkvGet('bounce_seen:' . $u['id'], 0) ?: 0);
            $bs = mymailDb()->prepare("SELECT COUNT(*) FROM mail_user_msgs WHERE uid = ? AND dir = 'out' AND err LIKE 'Bounced%' AND at > ?");
            $bs->execute([$u['id'], $seenAt]);
            ok(['acct' => mymailPublic($a), 'counts' => $counts, 'google' => ssoConnectable('google'), 'microsoft' => ssoConnectable('microsoft'), 'labels' => mymailLabelKeys($u['id']), 'own' => mymailOwnLabels($u['id']), 'bounced' => (int) $bs->fetchColumn()]);
        case 'mymail_bounces_seen':
            $u = requireUser();
            mkvSet('bounce_seen:' . $u['id'], now());
            ok(['ok' => true]);
        case 'mymail_connect_smtp':
            $u = requireUser();
            $email = strtolower(trim(str($b, 'email', 190)));
            $pass = (string) preg_replace('/\s+/', '', (string) ($b['pass'] ?? ''));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($pass) < 8) {
                fail(400, 'invalid_argument', 'Enter your Gmail or Google Workspace address and the 16-character app password.');
            }
            mymailStore($u['id'], ['provider' => 'smtp', 'email' => $email, 'name' => str($b, 'name', 120) ?: $u['name'], 'refresh' => '', 'access' => '', 'exp' => 0, 'pass' => $pass]);
            ok(['acct' => mymailPublic(mymailAcct($u['id']))]);
        case 'mymail_disconnect':
            $u = requireUser();
            mymailDb()->prepare('DELETE FROM mail_user_acct WHERE uid = ?')->execute([$u['id']]);
            ok(['ok' => true]);
        case 'mymail_sync':
            $u = requireUser();
            $a = mymailAcct($u['id']);
            if (!$a || !in_array($a['provider'], ['google', 'microsoft'], true)) {
                fail(400, 'invalid_argument', 'Receiving needs Gmail connected with Google, or a Microsoft 365 / Outlook mailbox connected with Microsoft.');
            }
            if (throttleHit('mymail_sync:' . $u['id'], 30, 3600)) {
                fail(429, 'rate_limited', 'Inbox sync runs at most 30 times an hour.');
            }
            ok(['added' => $a['provider'] === 'microsoft' ? msmailSync($a) : gmailSync($a)]);
        case 'mymail_list':
            $u = requireUser();
            $dir = in_array(str($b, 'box', 4), ['in', 'out'], true) ? str($b, 'box', 4) : 'in';
            $label = str($b, 'label', 40);
            $q = trim(str($b, 'q', 100));
            $sql = 'SELECT id, dir, at, from_email, from_name, to_email, subject, snippet, label, seen, starred, thread, err FROM mail_user_msgs WHERE uid = ? AND dir = ?';
            $args = [$u['id'], $dir];
            if ($label !== '') {
                $sql .= ' AND label = ?';
                $args[] = $label;
            }
            if ($q !== '') {
                $sql .= ' AND (subject LIKE ? OR from_email LIKE ? OR from_name LIKE ? OR to_email LIKE ? OR text LIKE ?)';
                $like = '%' . $q . '%';
                array_push($args, $like, $like, $like, $like, $like);
            }
            $sql .= ' ORDER BY at DESC LIMIT 300';
            $st = mymailDb()->prepare($sql);
            $st->execute($args);
            $rows = array_map(function ($r) {
                $r['seen'] = (bool) $r['seen'];
                $r['starred'] = (bool) $r['starred'];
                $r['at'] = (int) $r['at'];
                return $r;
            }, $st->fetchAll());
            ok(['messages' => $rows]);
        case 'mymail_get':
            $u = requireUser();
            $st = mymailDb()->prepare('SELECT * FROM mail_user_msgs WHERE id = ? AND uid = ?');
            $st->execute([str($b, 'id', 24), $u['id']]);
            $m = $st->fetch();
            if (!$m) {
                fail(404, 'not_found', 'That message is gone.');
            }
            if (!$m['seen']) {
                mymailDb()->prepare('UPDATE mail_user_msgs SET seen = 1 WHERE id = ?')->execute([$m['id']]);
            }
            ok(['message' => $m]);
        case 'mymail_act':
            $u = requireUser();
            $ids = array_values(array_filter(array_map(fn($x) => is_string($x) ? mb_substr($x, 0, 24) : '', (array) ($b['ids'] ?? [])), fn($x) => $x !== ''));
            $act = str($b, 'act', 12);
            $label = str($b, 'label', 40);
            if (!$ids) {
                ok(['ok' => true]);
            }
            $in = implode(',', array_fill(0, count($ids), '?'));
            $pdo = mymailDb();
            $sql = [
                'seen' => 'UPDATE mail_user_msgs SET seen = 1 WHERE uid = ? AND id IN (' . $in . ')',
                'unseen' => 'UPDATE mail_user_msgs SET seen = 0 WHERE uid = ? AND id IN (' . $in . ')',
                'star' => 'UPDATE mail_user_msgs SET starred = 1 WHERE uid = ? AND id IN (' . $in . ')',
                'unstar' => 'UPDATE mail_user_msgs SET starred = 0 WHERE uid = ? AND id IN (' . $in . ')',
                'delete' => 'DELETE FROM mail_user_msgs WHERE uid = ? AND id IN (' . $in . ')',
            ][$act] ?? null;
            if ($act === 'delete' && !empty($b['gmail'])) {
                // also move them to Gmail's trash (recoverable there for 30 days), or to Outlook's Deleted Items (v41)
                $a = mymailAcct($u['id']);
                if ($a && $a['provider'] === 'microsoft') {
                    mymailXid();
                    $gs = $pdo->prepare("SELECT xid FROM mail_user_msgs WHERE uid = ? AND xid IS NOT NULL AND xid <> '' AND id IN (" . $in . ')');
                    $gs->execute(array_merge([$u['id']], $ids));
                    $tok = '';
                    try {
                        $tok = msmailToken($a);
                    } catch (Throwable $e) {
                        $tok = '';
                    }
                    $trashed = 0;
                    foreach ($gs->fetchAll(PDO::FETCH_COLUMN) as $xid) {
                        if ($tok === '' || !preg_match('/^[A-Za-z0-9=_\-+\/]{1,400}$/', (string) $xid)) {
                            continue;
                        }
                        [$code] = msHttp('POST', 'me/messages/' . rawurlencode((string) $xid) . '/move', ['destinationId' => 'deleteditems'], $tok);
                        if ($code === 201 || $code === 200) {
                            $trashed++;
                        }
                    }
                    $pdo->prepare($sql)->execute(array_merge([$u['id']], $ids));
                    ok(['ok' => true, 'trashed' => $trashed]);
                }
                if ($a && $a['provider'] === 'google') {
                    $gs = $pdo->prepare('SELECT gid FROM mail_user_msgs WHERE uid = ? AND gid <> \'\' AND id IN (' . $in . ')');
                    $gs->execute(array_merge([$u['id']], $ids));
                    $tok = '';
                    try {
                        $tok = gmailToken($a);
                    } catch (Throwable $e) {
                        $tok = '';
                    }
                    $trashed = 0;
                    foreach ($gs->fetchAll(PDO::FETCH_COLUMN) as $gid) {
                        if ($tok === '' || !preg_match('/^[A-Za-z0-9]{1,40}$/', (string) $gid)) {
                            continue;
                        }
                        [$code] = ssoHttp(GMAIL_API . 'messages/' . $gid . '/trash', ['__raw' => ''], ['Authorization: Bearer ' . $tok, 'Content-Length: 0']);
                        if ($code === 200) {
                            $trashed++;
                        }
                    }
                    $pdo->prepare($sql)->execute(array_merge([$u['id']], $ids));
                    ok(['ok' => true, 'trashed' => $trashed]);
                }
            }
            if ($act === 'label') {
                if (!in_array($label, mymailLabelKeys($u['id']), true)) {
                    fail(400, 'invalid_argument', 'Unknown label.');
                }
                $pdo->prepare('UPDATE mail_user_msgs SET label = ? WHERE uid = ? AND id IN (' . $in . ')')->execute(array_merge([$label, $u['id']], $ids));
            } elseif ($sql) {
                $pdo->prepare($sql)->execute(array_merge([$u['id']], $ids));
            } else {
                fail(400, 'invalid_argument', 'Unknown action.');
            }
            ok(['ok' => true]);
        case 'mymail_book':
            $u = requireUser();
            $st = mymailDb()->prepare('SELECT email, name, tag, last, n FROM mail_user_book WHERE uid = ? ORDER BY last DESC LIMIT 500');
            $st->execute([$u['id']]);
            ok(['book' => $st->fetchAll()]);
        case 'mymail_book_save':
            $u = requireUser();
            $email = strtolower(trim(str($b, 'email', 190)));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                fail(400, 'invalid_argument', 'Enter a valid email address.');
            }
            $pdo = mymailDb();
            if (!empty($b['delete'])) {
                $pdo->prepare('DELETE FROM mail_user_book WHERE uid = ? AND email = ?')->execute([$u['id'], $email]);
                ok(['ok' => true]);
            }
            mymailBook($u['id'], $email, str($b, 'name', 190), now());
            $tag = in_array(str($b, 'tag', 40), mymailLabelKeys($u['id']), true) ? str($b, 'tag', 40) : '';
            $pdo->prepare('UPDATE mail_user_book SET tag = ? WHERE uid = ? AND email = ?')->execute([$tag, $u['id'], $email]);
            ok(['ok' => true]);
        case 'mymail_send':
            $u = requireUser();
            $a = mymailAcct($u['id']);
            if (!$a) {
                fail(400, 'invalid_argument', 'Connect your email first (My email > Connect).');
            }
            $tos = mymailList($b['to'] ?? '');
            $cc = mymailList($b['cc'] ?? '');
            $bcc = mymailList($b['bcc'] ?? '');
            $subject = trim(str($b, 'subject', 300));
            $text = trim((string) ($b['text'] ?? ''));
            $loop = !empty($b['loop']);
            $replyTo = str($b, 'reply', 24);
            if (!$tos || $subject === '' || $text === '') {
                fail(400, 'invalid_argument', 'Add at least one valid recipient, a subject and a message.');
            }
            if (count($tos) > 100) {
                fail(400, 'invalid_argument', 'Up to 100 recipients at a time.');
            }
            if (throttleHit('mymail_send:' . $u['id'], 300, 3600)) {
                fail(429, 'rate_limited', 'That is a lot of email for one hour. Try again later.');
            }
            $inReplyTo = '';
            if ($replyTo !== '') {
                $st = mymailDb()->prepare('SELECT msgid FROM mail_user_msgs WHERE id = ? AND uid = ?');
                $st->execute([$replyTo, $u['id']]);
                $inReplyTo = (string) (($st->fetch() ?: [])['msgid'] ?? '');
            }
            $names = [];
            $st = mymailDb()->prepare('SELECT email, name FROM mail_user_book WHERE uid = ?');
            $st->execute([$u['id']]);
            foreach ($st->fetchAll() as $row) {
                $names[$row['email']] = $row['name'];
            }
            $groups = $loop ? array_map(fn($t) => [$t], $tos) : [$tos];
            $fromName = $a['name'] !== '' ? $a['name'] : $u['name'];
            $sent = 0;
            $failed = [];
            $session = null;
            foreach ($groups as $g) {
                $first = mymailFirst($g[0], $names[$g[0]] ?? '');
                $body = str_replace(['{first_name}', '{email}', '{my_name}', '{signature}'], [$first, $g[0], $fromName, sigOf((string) $u['id'])], $text); // v69: {signature}
                $subj = str_replace(['{first_name}'], [$first], $subject);
                $raw = mymailMime($fromName, $a['email'], $g, $cc, $bcc, $subj, $body, $inReplyTo);
                if ($a['provider'] === 'smtp' && $session === null) {
                    // one connection for the whole send (it was never opened before v31, so every app-password send failed)
                    $session = new SmtpSession(['provider' => 'gmail', 'host' => 'smtp.gmail.com', 'port' => 465, 'secure' => 'ssl', 'user' => $a['email'], 'pass' => mailUnseal((string) $a['pass']), 'from' => $a['email'], 'from_name' => $fromName]);
                    $session->open();
                }
                [$ok, $err] = mymailSendRaw($a, $raw, array_merge($g, $cc, $bcc), $session);
                mymailDb()->prepare('INSERT INTO mail_user_msgs (id, uid, dir, at, from_email, from_name, to_email, cc, subject, text, snippet, msgid, thread, label, seen, starred, gid, err) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute([
                    rid(12),
                    $u['id'],
                    'out',
                    now(),
                    $a['email'],
                    $fromName,
                    implode(', ', $g),
                    implode(', ', $cc),
                    mb_substr($subj, 0, 500),
                    $body,
                    mb_substr(preg_replace('/\s+/', ' ', $body) ?? '', 0, 300),
                    '',
                    '',
                    in_array(str($b, 'label', 40), mymailLabelKeys($u['id']), true) ? str($b, 'label', 40) : '',
                    1,
                    0,
                    '',
                    $ok ? '' : $err,
                ]);
                foreach ($g as $t) {
                    mymailBook($u['id'], $t, $names[$t] ?? '', now());
                }
                if ($ok) {
                    $sent++;
                } else {
                    $failed[] = $g[0] . ': ' . $err;
                    if ($a['provider'] === 'smtp' && count($failed) >= 3) {
                        break;
                    }
                }
            }
            if ($session) {
                $session->close();
            }
            ok(['sent' => $sent, 'failed' => $failed]);
        case 'mymail_labels_save': {
            // the person's own labels: add, rename, recolor, remove (removing clears it from the messages)
            $u = requireUser();
            $old = mymailOwnLabels($u['id']);
            $oldKeys = array_column($old, 'k');
            $out = [];
            $names = array_map('mb_strtolower', ['No label', 'Candidate', 'Consultant', 'Vendor', 'Client', 'Personal']);
            foreach (array_slice((array) ($b['labels'] ?? []), 0, 40) as $x) {
                $x = (array) $x;
                $n = trim(mb_substr((string) ($x['n'] ?? ''), 0, 40));
                if ($n === '' || in_array(mb_strtolower($n), $names, true)) {
                    continue;
                }
                $names[] = mb_strtolower($n);
                $k = (string) ($x['k'] ?? '');
                if (!in_array($k, $oldKeys, true)) {
                    $k = 'u_' . substr(trim(preg_replace('/[^a-z0-9]+/', '_', mb_strtolower($n)) ?? '', '_'), 0, 24) . '_' . substr(rid(2), 0, 4);
                }
                $c = in_array($x['c'] ?? '', MYMAIL_COLORS, true) ? (string) $x['c'] : 'blue';
                $out[] = ['k' => $k, 'n' => $n, 'c' => $c];
            }
            if (count($out) > 30) {
                fail(400, 'invalid_argument', 'Up to 30 labels of your own.');
            }
            $gone = array_diff($oldKeys, array_column($out, 'k'));
            foreach ($gone as $k) {
                mymailDb()->prepare("UPDATE mail_user_msgs SET label = '' WHERE uid = ? AND label = ?")->execute([$u['id'], $k]);
                mymailDb()->prepare("UPDATE mail_user_book SET tag = '' WHERE uid = ? AND tag = ?")->execute([$u['id'], $k]);
            }
            mkvSet('mylabels:' . $u['id'], $out);
            ok(['own' => $out, 'labels' => mymailLabelKeys($u['id'])]);
        }
        case 'mymail_download': {
            // the chosen messages as .eml files (one message) or a zip of them with an index (several)
            $u = requireUser();
            $ids = array_slice(array_values(array_filter(array_map(fn($x) => is_string($x) ? mb_substr($x, 0, 24) : '', (array) ($b['ids'] ?? [])), fn($x) => $x !== '')), 0, 500);
            if (!$ids) {
                fail(400, 'invalid_argument', 'Select the messages to download.');
            }
            $in = implode(',', array_fill(0, count($ids), '?'));
            $st = mymailDb()->prepare('SELECT * FROM mail_user_msgs WHERE uid = ? AND id IN (' . $in . ') ORDER BY at DESC');
            $st->execute(array_merge([$u['id']], $ids));
            $rows = $st->fetchAll();
            if (!$rows) {
                fail(404, 'not_found', 'Those messages are gone.');
            }
            $own = [];
            foreach (mymailOwnLabels($u['id']) as $l) {
                $own[$l['k']] = $l['n'];
            }
            $eml = function (array $m) use ($own): string {
                $enc = fn(string $s) => preg_match('/[^\x20-\x7E]/', $s) ? '=?UTF-8?B?' . base64_encode($s) . '?=' : $s;
                $h = [
                    'From: ' . ($m['from_name'] !== '' ? $enc((string) $m['from_name']) . ' ' : '') . '<' . $m['from_email'] . '>',
                    'To: ' . $m['to_email'],
                ];
                if ((string) $m['cc'] !== '') {
                    $h[] = 'Cc: ' . $m['cc'];
                }
                $h[] = 'Subject: ' . $enc((string) $m['subject']);
                $h[] = 'Date: ' . date('r', (int) floor((int) $m['at'] / 1000));
                $h[] = 'Message-ID: ' . ((string) $m['msgid'] !== '' ? $m['msgid'] : '<' . $m['id'] . '@stratedge-portal>');
                if ((string) $m['label'] !== '') {
                    $h[] = 'X-Portal-Label: ' . ($own[$m['label']] ?? ucfirst((string) $m['label']));
                }
                $h[] = 'MIME-Version: 1.0';
                $h[] = 'Content-Type: text/plain; charset=UTF-8';
                $h[] = 'Content-Transfer-Encoding: base64';
                return implode("\r\n", $h) . "\r\n\r\n" . chunk_split(base64_encode((string) $m['text']));
            };
            $fname = function (array $m): string {
                $s = preg_replace('/[^A-Za-z0-9 ._\-]+/', '', (string) $m['subject']) ?: 'message';
                return date('Y-m-d', (int) floor((int) $m['at'] / 1000)) . ' ' . mb_substr(trim($s), 0, 60) . ' ' . substr((string) $m['id'], 0, 6) . '.eml';
            };
            if (count($rows) === 1) {
                $data = $eml($rows[0]);
                header('Content-Type: message/rfc822');
                header('Content-Disposition: attachment; filename="' . $fname($rows[0]) . '"');
                header('Content-Length: ' . strlen($data));
                echo $data;
                exit();
            }
            $tmp = tempnam(sys_get_temp_dir(), 'mmz');
            $z = new ZipArchive();
            if ($z->open($tmp, ZipArchive::OVERWRITE) !== true) {
                fail(500, 'unavailable', 'The server could not build the zip.');
            }
            $csv = fopen('php://temp', 'w+');
            fputcsv($csv, ['Direction', 'Date', 'From', 'To', 'Cc', 'Subject', 'Label', 'File']);
            foreach ($rows as $m) {
                $fn = $fname($m);
                $z->addFromString($fn, $eml($m));
                fputcsv($csv, [$m['dir'] === 'in' ? 'Received' : 'Sent', date('Y-m-d H:i', (int) floor((int) $m['at'] / 1000)), $m['from_email'], $m['to_email'], $m['cc'], $m['subject'], $own[$m['label']] ?? (string) $m['label'], $fn]);
            }
            rewind($csv);
            $z->addFromString('index.csv', (string) stream_get_contents($csv));
            $z->close();
            $data = (string) file_get_contents($tmp);
            @unlink($tmp);
            header('Content-Type: application/zip');
            header('Content-Disposition: attachment; filename="my-email-' . date('Y-m-d') . '-' . count($rows) . '-messages.zip"');
            header('Content-Length: ' . strlen($data));
            echo $data;
            exit();
        }
        case 'mymail_export':
            $u = requireUser();
            $st = mymailDb()->prepare('SELECT dir, at, from_email, from_name, to_email, cc, subject, label, seen, starred, err, snippet FROM mail_user_msgs WHERE uid = ? ORDER BY at DESC LIMIT 5000');
            $st->execute([$u['id']]);
            ok(['rows' => $st->fetchAll()]);
        default:
            fail(404, 'not_found', 'Unknown action.');
    }
}
