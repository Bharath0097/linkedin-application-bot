<?php
declare(strict_types=1);
/*
 * v78: the web application firewall (Admin > Security & spam firewall > Web application firewall).
 *
 * Runs on every API request right after the address checks in firewall.php, before any module reads the request:
 *   1. The request itself: methods the API never uses, oversized addresses, decoy routes only scanners ask for, attack
 *      tools by their user agent, and blocked countries.
 *   2. Every value the request carries (address parameters, JSON and form fields with their names, uploaded file
 *      names, cookies, the user agent, referrer and forwarding headers) is read the way a server would read it - URL
 *      escapes decoded (twice-encoded ones too), HTML entities, Unicode look-alikes, SQL comment padding, spread-out
 *      whitespace - and matched against attack signatures in nine families: SQL injection, cross-site scripting, path
 *      traversal and file inclusion, command injection, server-side request forgery, code and template injection
 *      (PHP objects, Log4Shell-style lookups, XML entities), NoSQL operators, protocol abuse and attack tools.
 *   3. Each signature carries points. Balanced (the default) refuses a request with 10 or more (a clear attack) and
 *      logs one with 4 or more for review; Strict refuses from 5; Watch only logs. People who are signed in are held
 *      to a higher bar (20 to refuse, 10 to log) and are never banned automatically: a false alarm must not lock an
 *      office out. Their attack-like requests are logged and the security contacts are told.
 *   4. Points also add up per network address and fade by half every few hours. An address that keeps attacking is
 *      banned, longer each time: 15 minutes, 1 hour, 6 hours, a day, a week. Firewall strikes (wrong passwords, spam,
 *      failed bot checks, scanner traps) add to the same score.
 * Passwords, codes, passkey answers and signatures are never read or logged. Webhooks from the mail, payment and phone
 * services are left to their own signature checks. Nothing here calls an outside service on ordinary requests.
 * Tables: waf_ip (the score per address), waf_log (what was refused or logged); settings in fw_kv under 'waf'.
 */

const WAF_SCHEMA = 1;
const WAF_DEFAULTS = [
    'on' => true,
    'mode' => 'balanced', // balanced | strict | watch
    'fam' => ['sqli' => true, 'xss' => true, 'lfi' => true, 'rce' => true, 'ssrf' => true, 'inject' => true, 'nosql' => true, 'proto' => true, 'bot' => true, 'bhv' => true],
    'banAt' => 25, // points on one address (after fading) that ban it
    'halfLife' => 6, // hours for an address's points to fade by half
    'staffAlert' => true, // tell the security contacts when a signed-in account sends attack-like requests
    'geo' => true, // refuse the countries listed under Firewall settings > Blocked countries
    'traps' => true, // decoy routes only scanners ask for ban at once
    // v79: the behavioral (derived) layer - patterns no single request shows
    'behavior' => true,
    'probeWindow' => 10, // minutes over which an address's refused/probing requests are counted
    'probeMax' => 15, // that many in the window is a scan spread across endpoints
    'stuffMax' => 10, // wrong sign-ins from one address in 15 minutes that look like credential stuffing
    'skip' => [], // false alarms: 'rule@route' or 'rule@*'
];
// what each mode refuses and logs: [refuse, log] for visitors, then for signed-in people
const WAF_LEVELS = [
    'balanced' => [10, 4, 20, 10],
    'strict' => [5, 3, 10, 5],
    'watch' => [PHP_INT_MAX, 4, PHP_INT_MAX, 10],
];
const WAF_FAMILIES = [
    'sqli' => 'SQL injection',
    'xss' => 'Cross-site scripting',
    'lfi' => 'Path traversal & file inclusion',
    'rce' => 'Command & code execution',
    'ssrf' => 'Server-side request forgery',
    'inject' => 'Template, object & XML injection',
    'nosql' => 'NoSQL operator injection',
    'proto' => 'Protocol abuse',
    'bot' => 'Attack tools & bad bots',
    'bhv' => 'Behavioral (scans & stuffing)',
];
// minutes of each automatic ban in a row (within 30 days): 15 minutes, 1 hour, 6 hours, a day, a week
const WAF_BAN_STEPS = [15, 60, 360, 1440, 10080];
const WAF_MAX_VALUE = 65536; // characters of one value that are read
const WAF_MAX_TOTAL = 400000; // characters of one request that are read
// fields that are never read or logged (passwords, codes, passkey answers, signatures, the bot check, data URLs)
const WAF_SKIP_FIELD = '/(^|\.)(password|passwd|pass|pw|pwd|newpw|oldpw|new_password|old_password|current|code|otp|totp|token|tok|secret|apikey|api_key|key|cred|credential|assertion|attestation|attestationobject|clientdatajson|authenticatordata|signature|sig|userhandle|rawid|challenge|pow|recovery|backup|png|img|image|data_url|dataurl|logo|icon|photo|avatar|pdf|file64|b64)$/i';
// routes whose bodies are left to their own checks: signed webhooks and inbound mail, browser error reports
const WAF_SKIP_BODY = ['unsub', 'mail_webhook', 'mail_inbound', 'mail_postal_hook', 'mail_postal_inbound', 'mail_ses_hook', 'plaid_webhook', 'stripe_webhook', 'client_error', 'csp_report'];
// decoy routes: the portal has none of these, so a request for one is a scanner guessing
const WAF_DECOYS = ['phpinfo', 'debug', 'shell', 'cmd', 'eval', 'exec', 'env', 'dump', 'sql', 'adminer', 'install', 'setup', 'upgrade', 'backup_download', 'admin_backup', 'admin_login', 'config', 'wp_login', 'xmlrpc', 'phpmyadmin'];
// public routes where a blocked country is checked even without Cloudflare (one cached location lookup per address)
const WAF_GEO_ROUTES = ['login', 'register', 'pw_forgot', 'public_contact', 'chat', 'ai_visitor', 'public_share', 'vms_post', 'pub_support_create', 'ws_signup', 'sso_start', 'mfa_verify', 'pk_auth_options'];

/**
 * The signatures: [id, family, points, pattern, where]. Patterns run on the decoded, lower-cased text; 'c' runs on
 * the same text with every space removed (java script: and the like), 'ua' only on the user agent, 'key' only on
 * field names, 'name' only on uploaded file names. Points: 10 a clear attack on its own, 5 strong, 3 or 2 a hint that
 * only counts together with others.
 */
function wafRules(): array
{
    static $r = null;
    if ($r !== null) {
        return $r;
    }
    $r = [
        // SQL injection
        ['sqli-union', 'sqli', 10, '/\bunion\b[\s(]+(?:all\s+|distinct\s+)?\(?\s*select\b/', ''],
        ['sqli-tautology', 'sqli', 10, '/[\'"`]\s*\)*\s*(?:or|and|xor|\|\||&&)\s*\(?\s*[\'"`]?\s*(\w+)\s*[\'"`]?\s*(?:=|<>|!=|like)\s*[\'"`]?\s*\1\b/', ''],
        ['sqli-tautology-num', 'sqli', 10, '/[\'"`]\s*\)*\s*(?:or|and|\|\|)\s+\d+\s*(?:=|>|<)\s*\d+/', ''],
        ['sqli-stacked', 'sqli', 10, '/;\s*(?:drop\s+(?:table|database|user|schema)\b|truncate\s+table\b|alter\s+(?:table|user)\b|create\s+(?:table|user|login|function)\b|insert\s+into\s+[\w.`"\[\]]+\s*(?:\(|values|select)|delete\s+from\s+[\w.`"\[\]]+\s+where\b|update\s+[\w.`"\[\]]+\s+set\s+[\w`"]+\s*=|exec(?:ute)?\s+(?:xp_|sp_|master\.)|declare\s+@|shutdown\b)/', ''],
        ['sqli-time', 'sqli', 10, '/(?:[\'"`)=,(]|\band\b|\bor\b|\bselect\b|\|\|)\s*\(?\s*(?:sleep|pg_sleep|benchmark)\s*\(\s*\d|waitfor\s+delay\s+[\'"]\s*\d|dbms_(?:pipe\.receive_message|lock\.sleep)\s*\(/', ''],
        ['sqli-functions', 'sqli', 10, '/\b(?:extractvalue|updatexml|load_file|utl_inaddr\.get_host|utl_http\.request|dbms_xmlgen|xp_cmdshell|xp_dirtree|sp_oacreate|sp_executesql|into\s+(?:out|dump)file)\b/', ''],
        ['sqli-order-probe', 'sqli', 10, '/[\'"`)]\s*(?:order|group)\s+by\s+\d+\s*(?:--|#|\/\*|;)/', ''],
        ['sqli-comment-end', 'sqli', 3, '/\w[\'"`]\s*\)*\s*(?:--|#)(?:\s|$)/', ''],
        ['sqli-schema', 'sqli', 3, '/\b(?:information_schema|sysobjects|syscolumns|pg_catalog|pg_shadow|sqlite_master|mysql\.user|all_tables|sys\.tables)\b/', ''],
        ['sqli-concat', 'sqli', 5, '/\b(?:group_concat|concat_ws|concat)\s*\(.{0,80}(?:select|0x[0-9a-f]{4}|char\s*\(|@@version|user\s*\(\s*\))/', ''],
        ['sqli-char', 'sqli', 5, '/\b(?:char|chr|nchar)\s*\(\s*\d+\s*(?:,\s*\d+\s*){3,}\)|\b0x[0-9a-f]{20,}\b/', ''],
        ['sqli-version', 'sqli', 5, '/@@(?:version|datadir|hostname|basedir)\b|\bversion\s*\(\s*\)\s*(?:--|#|,|\))/', ''],
        ['sqli-select-from', 'sqli', 2, '/\bselect\b.{1,120}\bfrom\b.{1,120}\bwhere\b/', ''],
        // cross-site scripting
        ['xss-script', 'xss', 10, '/<\/?script\b/', ''],
        ['xss-handler', 'xss', 10, '/<[a-z][a-z0-9:-]*\b[^>]{0,300}?[\s\/"\'](?:on[a-z]{3,25})\s*=/', ''],
        ['xss-js-url', 'xss', 10, '/(?:^|[\s"\'=(`>])(?:javascript|vbscript|livescript):(?:\/\/|alert|prompt|confirm|eval|fetch|import|atob|document|window|location|top\[|self\[|this\.|settimeout|setinterval|constructor|void\s*\(|\(|`|\[)/', 'c'],
        ['xss-attr-url', 'xss', 10, '/(?:href|src|action|formaction|data|xlink:href|background|poster)\s*=\s*[\'"]?\s*(?:javascript|vbscript|data:text\/html|data:image\/svg\+xml)/', ''],
        ['xss-srcdoc', 'xss', 10, '/\bsrcdoc\s*=|<(?:iframe|frame|object|embed|applet)\b[^>]*\b(?:src|data|code)\s*=/', ''],
        ['xss-tags', 'xss', 5, '/<(?:iframe|frame|frameset|object|embed|applet|meta\s+http-equiv|base\s+href|svg|math|isindex|xss|marquee|form\s+action|link\s+rel|style)\b/', ''],
        ['xss-dom', 'xss', 5, '/\bdocument\s*\.\s*(?:cookie|domain|write(?:ln)?)\b|\bwindow\s*\.\s*(?:location|name|opener)\s*=|\.(?:innerhtml|outerhtml)\s*=|\bnew\s+function\s*\(|\bstring\.fromcharcode\s*\(|\b(?:settimeout|setinterval)\s*\(\s*[\'"`]/', ''],
        ['xss-alert', 'xss', 5, '/\b(?:alert|prompt|confirm)(?:\(|`)\s*(?:[\'"`]?\s*(?:1|xss|document|origin|cookie|domain)\b|\)|`)/', ''],
        ['xss-css', 'xss', 5, '/\bexpression\s*\(|-moz-binding|behavior\s*:\s*url|@import\s+[\'"]?\s*(?:javascript|data):/', ''],
        // path traversal and file inclusion
        ['lfi-traversal', 'lfi', 10, '/(?:\.\.[\/\\\\]){2,}/', ''],
        ['lfi-files', 'lfi', 10, '/\/etc\/(?:passwd|shadow|group|hosts|issue|crontab|sudoers)\b|\/proc\/(?:self|\d+)\/(?:environ|cmdline|maps|fd)|\b(?:win\.ini|boot\.ini|system32[\/\\\\]config)\b|[\/\\\\](?:id_rsa|id_ed25519|authorized_keys|\.bash_history|\.htpasswd)\b|\.aws\/credentials/', ''],
        ['lfi-wrapper', 'lfi', 10, '/\b(?:php|phar|zip|expect|glob|compress\.zlib|compress\.bzip2|ogg|rar|ssh2(?:\.\w+)?):\/\/|\bfile:\/\/\/|\bdata:\/\//', ''],
        ['lfi-config', 'lfi', 3, '/(?:^|[\/\\\\])(?:wp-config\.php|config\.php|web\.config|\.env|\.git\/config|\.htaccess|settings\.py|database\.yml)\b/', ''],
        ['lfi-dotdot', 'lfi', 3, '/(?:^|[\/\\\\=])\.\.[\/\\\\]/', ''],
        ['lfi-null', 'lfi', 5, '/\x00/', ''],
        ['lfi-upload-name', 'lfi', 10, '/\.(?:php\d?|phtml|phar|pht|phps|jsp|jspx|asp|aspx|ashx|asmx|cer|cgi|pl|py|sh|htaccess|shtml)(?:\.|$|\s|;|%00)/', 'name'],
        ['lfi-upload-path', 'lfi', 5, '/[\/\\\\]|\.\./', 'name'],
        // command and code execution
        ['rce-shell', 'rce', 10, '/(?:;|\||&&|\$\(|`)\s*(?:cat\s+\/|ls\s+-[a-z]|whoami\b|uname\s+-[a-z]|wget\s+(?:-[a-z]+\s+)*https?:|curl\s+(?:-[a-z]+\s+)*(?:https?:|-[a-z])|(?:nc|ncat|netcat)\s+(?:-[a-z]+\s+)*(?:\d{1,3}\.\d|[a-z0-9-]+\.[a-z0-9.-]+\s+\d)|bash\s+-[ci]|sh\s+-c\b|\/bin\/(?:ba|z|k|da)?sh\b|python[23]?\s+-c\b|perl\s+-e\b|ruby\s+-e\b|php\s+-r\b|cmd(?:\.exe)?\s+\/[ck]\b|chmod\s+[0-7+]|rm\s+-rf\b|busybox\s+[a-z]|nslookup\s+(?:-[a-z]|[a-z0-9-]+\.[a-z0-9.-]+)|ping\s+-[cn]\s)|(?:;|\||\$\(|`)id(?:\s*(?:$|;|\||`|\)))/', ''],
        ['rce-subshell', 'rce', 10, '/\$\(\s*(?:curl|wget|cat|id|whoami|uname|echo|nslookup|sleep|ping)\b|`\s*(?:curl|wget|cat|id|whoami|uname|sleep|ping)\s+[^`]{1,80}`/', ''],
        ['rce-reverse', 'rce', 10, '/\/dev\/(?:tcp|udp)\/|\bbash\s+-i\s*>&|\bnc\s+(?:-[a-z]+\s+)*-e\s|\bmkfifo\s+\/tmp|\bsocat\s+.{0,40}exec:|\bsh\s+-i\s*[<>]/', ''],
        ['rce-php', 'rce', 10, '/<\?(?:php|=)|\b(?:shell_exec|passthru|proc_open|pcntl_exec|popen|create_function)\s*\(|\bsystem\s*\(\s*[\'"$]|\beval\s*\(\s*(?:base64_decode|gzinflate|gzuncompress|str_rot13|\$_(?:get|post|request|cookie|server))|\bassert\s*\(\s*\$_(?:get|post|request)/', ''],
        ['rce-powershell', 'rce', 10, '/\bpowershell(?:\.exe)?\b.{0,60}(?:-e(?:nc(?:odedcommand)?)?\s|\biex\b|invoke-expression|downloadstring|frombase64string|-w(?:indowstyle)?\s+hidden)/', ''],
        ['rce-ifs', 'rce', 5, '/\$\{ifs\}|\$ifs\$9|\{(?:cat|ls|id|wget|curl),/', ''],
        // server-side request forgery
        ['ssrf-metadata', 'ssrf', 10, '/169\.254\.169\.254|metadata\.google\.internal|100\.100\.100\.200|fd00:ec2::254|\binstance-data\b|metadata\.azure\.com/', ''],
        ['ssrf-scheme', 'ssrf', 10, '/\b(?:gopher|dict|ldap|ldaps|tftp|jar|netdoc|sftp):\/\//', ''],
        ['ssrf-internal', 'ssrf', 5, '/\b(?:https?|ftp):\/\/(?:[^\/@\s]*@)?(?:localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|0\.0\.0\.0|\[?::1?\]?|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|0x7f[0-9a-f.]*|2130706433|017700000001)(?:[:\/?#]|$)/', ''],
        // template, object and XML injection
        ['inject-jndi', 'inject', 10, '/\$\{\s*(?:jndi|lower|upper|env|sys|java|date|ctx|main|bundle|k8s|docker|spring|log4j|base64)\s*:|\$\{[^}]{0,40}j[^}]{0,15}n[^}]{0,15}d[^}]{0,15}i[^}]{0,15}:/', ''],
        ['inject-ssti', 'inject', 10, '/\{\{.{0,60}(?:__class__|__mro__|__subclasses__|__globals__|__builtins__|__import__|config\.items|request\.application|self\._templatereference|lipsum|cycler|joiner)|\{%\s*(?:import|include|exec|debug)\b/', ''],
        ['inject-ssti-math', 'inject', 5, '/\{\{\s*\d+\s*[*+]\s*\d+\s*\}\}|\$\{\s*\d+\s*\*\s*\d+\s*\}|#\{\s*\d+\s*\*\s*\d+\s*\}|<%=?\s*\d+\s*\*\s*\d+\s*%>/', ''],
        ['inject-php-object', 'inject', 10, '/\b[oc]:\d+:"[a-z_\\\\][\w\\\\]{0,120}":\d+:\{|__php_incomplete_class/', ''],
        ['inject-xxe', 'inject', 10, '/<!entity\s|<!doctype\s+[a-z0-9_:-]+\s*\[|\bsystem\s+["\'](?:file|https?|php|expect):/', ''],
        ['inject-java', 'inject', 5, '/\bro0ab[a-z0-9+\/=]{8,}|\baced0005[0-9a-f]{8,}|\bjava\.lang\.(?:runtime|processbuilder)\b|\bclass\.module\.classloader\b/', ''],
        ['inject-crlf', 'inject', 10, '/[\r\n]\s*(?:set-cookie|location|content-(?:type|length)|refresh|x-[a-z-]+)\s*:/', 'q'],
        // NoSQL operators (in field names: {"email": {"$ne": null}} or email[$ne]=1)
        ['nosql-operator', 'nosql', 10, '/^\$(?:ne|eq|gt|gte|lt|lte|in|nin|regex|where|exists|or|and|nor|not|expr|function|elemmatch|all|size|type|text)$/', 'key'],
        ['nosql-query', 'nosql', 10, '/\[\$(?:ne|gt|gte|lt|lte|regex|where|exists|nin|in)\]/', 'q'],
        // attack tools by their user agent
        ['bot-tool', 'bot', 10, '/\b(?:sqlmap|nikto|nmap|masscan|zgrab|zmeu|acunetix|netsparker|nessus|openvas|wpscan|joomscan|droopescan|dirbuster|gobuster|feroxbuster|dirsearch|ffuf|wfuzz|nuclei|jaeles|whatweb|arachni|w3af|skipfish|havij|commix|xsstrike|hydra|medusa|burp\s*(?:suite|collaborator)|owasp[\s_-]*zap|zaproxy|interactsh|fimap|morfeus|paros|webinspect|appscan|sqlninja|bsqlbf|pangolin|grabber|vega\/|httprint|brutus|crowdstrike-scan|censysinspect|expanse|l9explore|leakix|xfa1|nimbostratus|zmap)\b/', 'ua'],
        ['bot-script', 'bot', 2, '/^(?:python-requests|python-urllib|python-httpx|aiohttp|go-http-client|java\/|libwww-perl|lwp::|wget\/|curl\/|okhttp|scrapy|node-fetch|axios\/|php\/|ruby|mechanize|apache-httpclient|httpclient)|\b(?:headlesschrome|phantomjs|selenium|puppeteer|playwright)\b/', 'ua'],
    ];
    return $r;
}
/** A short, plain description of each signature for the dashboard. */
const WAF_RULE_NAMES = [
    'sqli-union' => 'UNION SELECT (reading other tables)', 'sqli-tautology' => 'Always-true comparison (\' OR \'a\'=\'a)', 'sqli-tautology-num' => 'Always-true comparison (\' OR 1=1)',
    'sqli-stacked' => 'A second SQL statement (; DROP / DELETE / UPDATE …)', 'sqli-time' => 'Time-delay probe (SLEEP, BENCHMARK, WAITFOR)', 'sqli-functions' => 'Database file or command functions',
    'sqli-order-probe' => 'Column-count probe (ORDER BY n--)', 'sqli-comment-end' => 'Quote followed by a SQL comment', 'sqli-schema' => 'Database catalog names', 'sqli-concat' => 'CONCAT with SELECT or hex',
    'sqli-char' => 'Encoded strings (CHAR(…), long hex)', 'sqli-version' => 'Database version probe', 'sqli-select-from' => 'SELECT … FROM … WHERE',
    'xss-script' => '<script> tag', 'xss-handler' => 'HTML tag with an event handler (onerror=, onload=…)', 'xss-js-url' => 'javascript: link that runs code', 'xss-attr-url' => 'Attribute pointing at javascript: or data:',
    'xss-srcdoc' => 'Embedded frame or object with content', 'xss-tags' => 'Risky HTML tags (iframe, svg, object…)', 'xss-dom' => 'Page-script access (document.cookie…)', 'xss-alert' => 'alert(1)-style probe', 'xss-css' => 'Script in CSS',
    'lfi-traversal' => 'Climbing out of folders (../../)', 'lfi-files' => 'System files (/etc/passwd, win.ini…)', 'lfi-wrapper' => 'File-reading wrappers (php://, phar://, file:///)', 'lfi-config' => 'Configuration file names',
    'lfi-dotdot' => 'Parent folder (../)', 'lfi-null' => 'Null byte', 'lfi-upload-name' => 'Upload named like a program (.php, .jsp…)', 'lfi-upload-path' => 'Upload name with a folder path',
    'rce-shell' => 'Shell commands chained in (; cat /etc, | wget …)', 'rce-subshell' => 'Shell sub-command ($(…), `…`)', 'rce-reverse' => 'Reverse shell', 'rce-php' => 'PHP code or execution functions', 'rce-powershell' => 'Hidden or encoded PowerShell',
    'rce-ifs' => 'Shell spacing tricks (${IFS})', 'ssrf-metadata' => 'Cloud metadata address', 'ssrf-scheme' => 'Unusual URL schemes (gopher://, dict://…)', 'ssrf-internal' => 'Address inside a private network',
    'inject-jndi' => 'Log4Shell-style lookup (${jndi:…})', 'inject-ssti' => 'Server template injection', 'inject-ssti-math' => 'Template math probe ({{7*7}})', 'inject-php-object' => 'Serialized PHP object', 'inject-xxe' => 'XML external entity',
    'inject-java' => 'Serialized Java object', 'inject-crlf' => 'Header injection (line breaks)', 'nosql-operator' => 'NoSQL operator as a field name ($ne, $where…)', 'nosql-query' => 'NoSQL operator in the address',
    'bot-tool' => 'Attack tool (sqlmap, nikto, nuclei…)', 'bot-script' => 'Script or headless browser on a public form', 'bot-empty' => 'No browser name on a public form',
    'proto-method' => 'HTTP method the site never uses', 'proto-long-query' => 'Oversized address', 'proto-params' => 'Hundreds of parameters', 'proto-depth' => 'Deeply nested data', 'proto-oversize' => 'Request too big to read whole',
    'trap-route' => 'Decoy route only scanners ask for', 'geo-block' => 'Blocked country', 'ai-injection' => 'Prompt injection aimed at StratEdge AI',
    'bhv-probe' => 'Scanning: many refused/probing requests across the site', 'bhv-stuffing' => 'Credential stuffing: many wrong sign-ins from one address', 'proto-unknown' => 'Guessing route names',
];

/* ---------- storage ---------- */
function wafdb(): PDO
{
    static $ready = false;
    $pdo = fwdb();
    if ($ready) {
        return $pdo;
    }
    $row = $pdo->query("SELECT v FROM meta WHERE k = 'waf_schema'")->fetch();
    if (!$row || (int) $row['v'] < WAF_SCHEMA) {
        $pdo->exec('CREATE TABLE IF NOT EXISTS waf_ip (ip VARCHAR(64) PRIMARY KEY, score DOUBLE PRECISION NOT NULL, at BIGINT NOT NULL,
            hits INT NOT NULL, bans INT NOT NULL, ban_at BIGINT NOT NULL, first BIGINT NOT NULL, rule VARCHAR(40) NOT NULL, cc VARCHAR(4) NOT NULL)');
        $pdo->exec('CREATE TABLE IF NOT EXISTS waf_log (id VARCHAR(24) PRIMARY KEY, at BIGINT NOT NULL, ip VARCHAR(64) NOT NULL, route VARCHAR(40) NOT NULL,
            uid VARCHAR(40) NOT NULL, act VARCHAR(8) NOT NULL, score INT NOT NULL, rules VARCHAR(300) NOT NULL, fam VARCHAR(80) NOT NULL,
            field VARCHAR(80) NOT NULL, sample VARCHAR(300) NOT NULL, ua VARCHAR(200) NOT NULL, cc VARCHAR(4) NOT NULL, method VARCHAR(8) NOT NULL)');
        foreach (['CREATE INDEX waf_log_at ON waf_log (at)', 'CREATE INDEX waf_log_ip ON waf_log (ip)', 'CREATE INDEX waf_ip_at ON waf_ip (at)'] as $sql) {
            try {
                $pdo->exec($sql);
            } catch (Throwable $e) {
                // index already there
            }
        }
        $pdo->prepare('REPLACE INTO meta (k, v) VALUES (?, ?)')->execute(['waf_schema', WAF_SCHEMA]);
    }
    $ready = true;
    return $pdo;
}
function wafCfg(bool $fresh = false): array
{
    static $c = null;
    if ($c !== null && !$fresh) {
        return $c;
    }
    $saved = null;
    try {
        $s = fwdb()->query("SELECT v FROM fw_kv WHERE k = 'waf'")->fetchColumn();
        $saved = $s ? json_decode((string) $s, true) : null;
    } catch (Throwable $e) {
        $saved = null;
    }
    $c = WAF_DEFAULTS;
    if (is_array($saved)) {
        foreach ($saved as $k => $v) {
            if (array_key_exists($k, WAF_DEFAULTS)) {
                $c[$k] = $k === 'fam' && is_array($v) ? array_merge(WAF_DEFAULTS['fam'], array_intersect_key($v, WAF_DEFAULTS['fam'])) : $v;
            }
        }
    }
    $c['mode'] = isset(WAF_LEVELS[$c['mode']]) ? $c['mode'] : 'balanced';
    $c['skip'] = array_values(array_filter(array_map('strval', (array) $c['skip']), fn($x) => (bool) preg_match('/^[a-z0-9-]{3,40}@[a-z0-9_*]{1,40}$/', $x)));
    return $c;
}
function wafSave(array $in): array
{
    $cur = wafCfg(true);
    $fam = [];
    foreach (WAF_DEFAULTS['fam'] as $k => $v) {
        $fam[$k] = isset($in['fam']) && is_array($in['fam']) && array_key_exists($k, $in['fam']) ? !empty($in['fam'][$k]) : $cur['fam'][$k];
    }
    $new = [
        'on' => array_key_exists('on', $in) ? !empty($in['on']) : $cur['on'],
        'mode' => isset(WAF_LEVELS[(string) ($in['mode'] ?? '')]) ? (string) $in['mode'] : $cur['mode'],
        'fam' => $fam,
        'banAt' => max(8, min(500, (int) ($in['banAt'] ?? $cur['banAt']))),
        'halfLife' => max(1, min(168, (int) ($in['halfLife'] ?? $cur['halfLife']))),
        'staffAlert' => array_key_exists('staffAlert', $in) ? !empty($in['staffAlert']) : $cur['staffAlert'],
        'geo' => array_key_exists('geo', $in) ? !empty($in['geo']) : $cur['geo'],
        'traps' => array_key_exists('traps', $in) ? !empty($in['traps']) : $cur['traps'],
        'behavior' => array_key_exists('behavior', $in) ? !empty($in['behavior']) : $cur['behavior'],
        'probeWindow' => max(1, min(120, (int) ($in['probeWindow'] ?? $cur['probeWindow']))),
        'probeMax' => max(4, min(500, (int) ($in['probeMax'] ?? $cur['probeMax']))),
        'stuffMax' => max(3, min(200, (int) ($in['stuffMax'] ?? $cur['stuffMax']))),
        'skip' => array_key_exists('skip', $in) ? array_slice(array_values(array_unique(array_filter(array_map('strval', (array) $in['skip']), fn($x) => (bool) preg_match('/^[a-z0-9-]{3,40}@[a-z0-9_*]{1,40}$/', $x)))), 0, 200) : $cur['skip'],
    ];
    fwdb()->prepare('REPLACE INTO fw_kv (k, v) VALUES (?, ?)')->execute(['waf', json_encode($new)]);
    return wafCfg(true);
}

/* ---------- reading a value the way a server would ---------- */
/** [normalized, compact]: decoded, entity-free, Unicode-folded, lower-cased, comment- and space-collapsed. */
function wafNorm(string $v): array
{
    if ($v === '') {
        return ['', ''];
    }
    if (strlen($v) > WAF_MAX_VALUE) {
        $v = substr($v, 0, WAF_MAX_VALUE);
    }
    // URL escapes, up to three rounds (an attack encoded twice is decoded twice)
    for ($i = 0; $i < 3 && preg_match('/%[0-9a-f]{2}/i', $v); $i++) {
        $d = rawurldecode($v);
        if ($d === $v) {
            break;
        }
        $v = $d;
    }
    // < and \x3c escapes, then HTML entities (&lt; &#60; &#x3c;), twice for doubled ones
    $v = preg_replace_callback('/\\\\(?:u00([0-9a-f]{2})|x([0-9a-f]{2}))/i', fn($m) => chr(hexdec($m[1] !== '' ? $m[1] : $m[2])), $v) ?? $v;
    for ($i = 0; $i < 2 && str_contains($v, '&'); $i++) {
        $d = html_entity_decode($v, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        if ($d === $v) {
            break;
        }
        $v = $d;
    }
    if (!mb_check_encoding($v, 'UTF-8')) {
        $v = mb_convert_encoding($v, 'UTF-8', 'UTF-8');
    }
    // full-width and other look-alike characters fold to plain ones (＜ｓｃｒｉｐｔ＞ is <script>)
    if (class_exists('Normalizer')) {
        $n = Normalizer::normalize($v, Normalizer::FORM_KC);
        if (is_string($n)) {
            $v = $n;
        }
    }
    $v = mb_strtolower($v, 'UTF-8');
    // MySQL runs the text of /*!50000 … */ comments; ordinary comments count as spaces
    $v = preg_replace('/\/\*!\d*/', ' ', $v) ?? $v;
    $v = preg_replace('/\/\*.*?\*\//s', ' ', $v) ?? $v;
    $n = preg_replace('/[\s\x0b\x0c]+/u', ' ', $v) ?? $v;
    // browsers drop tabs, line breaks and control characters inside a link (java&#9;script:), never ordinary spaces
    $c = preg_replace('/[\x00-\x1f\x7f]+/', '', $v) ?? $v;
    return [$n, $c];
}
/** The signatures one value matches: [[id, fam, pts, sample], ...]. $where: '' (a value), 'q', 'ua', 'key' or 'name'. */
function wafScan(string $raw, string $where, array $fam): array
{
    if ($raw === '') {
        return [];
    }
    [$n, $c] = wafNorm($raw);
    $hits = [];
    // a null byte is checked on the raw value (decoding keeps it)
    $rawNull = str_contains($raw, "\0") || stripos($raw, '%00') !== false;
    foreach (wafRules() as [$id, $f, $pts, $re, $on]) {
        if (empty($fam[$f])) {
            continue;
        }
        if ($on === 'ua' || $on === 'key' || $on === 'name' || $on === 'q') {
            // signatures for one kind of value: the user agent, field names, file names, or the address and headers
            if ($on !== $where) {
                continue;
            }
        } elseif ($where === 'key' || $where === 'name') {
            // field and file names meet only their own signatures and the clear script and injection ones
            if (!in_array($f, ['xss', 'inject'], true) || $pts < 10) {
                continue;
            }
        } elseif ($where === 'ua' && $pts < 10) {
            // a user agent meets the clear signatures only (Log4Shell lookups and SQL in it are common scanner tricks)
            continue;
        }
        if ($id === 'lfi-null') {
            if ($rawNull) {
                $hits[] = [$id, $f, $pts, '\\0'];
            }
            continue;
        }
        $subject = $on === 'c' ? $c : $n;
        if (@preg_match($re, $subject, $m, PREG_OFFSET_CAPTURE)) {
            $at = (int) $m[0][1];
            $hits[] = [$id, $f, $pts, mb_strcut($subject, max(0, $at - 40), 160, 'UTF-8')];
        }
    }
    return $hits;
}

/* ---------- what a request carries ---------- */
/** Flattens a decoded JSON value into [path, string] pairs (and the field names, for NoSQL operators). */
function wafFlatten($v, string $path, array &$out, array &$keys, int $depth, int &$size, int &$maxDepth): void
{
    if ($size > WAF_MAX_TOTAL || count($out) > 4000) {
        return;
    }
    $maxDepth = max($maxDepth, $depth);
    if (is_array($v)) {
        if ($depth > 40) {
            return;
        }
        foreach ($v as $k => $x) {
            $ks = (string) $k;
            if (!is_int($k)) {
                $keys[] = [$path === '' ? $ks : $path . '.' . $ks, $ks];
            }
            $p = $path === '' ? $ks : $path . '.' . $ks;
            if (preg_match(WAF_SKIP_FIELD, $ks)) {
                continue;
            }
            wafFlatten($x, $p, $out, $keys, $depth + 1, $size, $maxDepth);
        }
        return;
    }
    if (is_string($v)) {
        // pictures and documents sent as data: addresses or long base64 are not text
        if (strlen($v) > 512 && (str_starts_with($v, 'data:') || preg_match('/^[A-Za-z0-9+\/=_-]{512,}$/', substr($v, 0, 2048)))) {
            return;
        }
        $size += strlen($v);
        $out[] = [$path, $v];
    }
}
/**
 * What signed-in people send for reading only, never stored or run: the page text and history StratEdge AI is given,
 * email bodies they write, the samples administrators test the filters with. Those fields are left to the AI shield
 * and the mail checks (an administrator asking StratEdge AI about the firewall page must not trip the firewall).
 */
function wafMemberSkip(string $r, string $path): bool
{
    if (in_array($r, ['waf_test', 'sec_test', 'ai_shield_test'], true)) {
        return true;
    }
    if (!preg_match('/^(ai_|mymail_|mail_|ats_email|tl_|es_|dl_|sq_|chat_|desk_)/', $r)) {
        return false;
    }
    $last = strtolower((string) preg_replace('/^.*\./', '', $path));
    $first = strtolower(explode('.', $path)[0]);
    return in_array($last, ['text', 'html', 'body', 'content', 'page', 'brief', 'draft', 'jd', 'resume', 'signature', 'template', 'original'], true) || in_array($first, ['hist', 'ctx', 'nav'], true);
}
/** [[field, value, where], ...] for everything the request carries, plus facts about its shape. */
function wafCollect(string $r, bool $signed = false): array
{
    $vals = [];
    $keys = [];
    $size = 0;
    $depth = 0;
    $params = 0;
    foreach ($_GET as $k => $v) {
        $params++;
        if ($k === 'r') {
            continue;
        }
        $ks = (string) $k;
        $keys[] = ['?' . $ks, $ks];
        if (preg_match(WAF_SKIP_FIELD, $ks)) {
            continue;
        }
        if (is_array($v)) {
            $o = [];
            $kk = [];
            wafFlatten($v, '?' . $ks, $o, $kk, 1, $size, $depth);
            foreach ($o as [$p, $x]) {
                $vals[] = [$p, $x, 'q'];
            }
            $keys = array_merge($keys, $kk);
        } else {
            $vals[] = ['?' . $ks, (string) $v, 'q'];
        }
    }
    $qs = (string) ($_SERVER['QUERY_STRING'] ?? '');
    if ($qs !== '') {
        $vals[] = ['?', $qs, 'q'];
    }
    if (!in_array($r, WAF_SKIP_BODY, true) && ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
        // v83: what the modules read is what is scanned: body() decodes php://input as JSON whatever the Content-Type
        // says, so a JSON body sent as text/plain (or any type PHP does not parse into $_POST) is read here as well
        $b = body();
        if ($b) {
            // the website chat sends the whole conversation back: only what the visitor typed is theirs
            if (($r === 'chat' || str_starts_with($r, 'ai_')) && isset($b['messages']) && is_array($b['messages'])) {
                $b['messages'] = array_values(array_filter($b['messages'], fn($m) => is_array($m) && ($m['role'] ?? '') === 'user'));
            }
            $o = [];
            wafFlatten($b, '', $o, $keys, 1, $size, $depth);
            foreach ($o as [$p, $x]) {
                if ($signed && wafMemberSkip($r, $p)) {
                    continue;
                }
                $vals[] = [$p, $x, ''];
            }
            $params += count($o);
        }
        if ($_POST || $_FILES) {
            $o = [];
            wafFlatten($_POST, '', $o, $keys, 1, $size, $depth);
            foreach ($o as [$p, $x]) {
                if ($signed && wafMemberSkip($r, $p)) {
                    continue;
                }
                // form fields that carry JSON (screening answers, signers) are read as JSON as well
                if (strlen($x) > 1 && ($x[0] === '{' || $x[0] === '[')) {
                    $j = json_decode($x, true);
                    if (is_array($j)) {
                        $oo = [];
                        wafFlatten($j, $p, $oo, $keys, 2, $size, $depth);
                        foreach ($oo as [$pp, $xx]) {
                            $vals[] = [$pp, $xx, ''];
                        }
                        continue;
                    }
                }
                $vals[] = [$p, $x, ''];
            }
            $params += count($o);
            foreach ($_FILES as $fk => $f) {
                foreach ((array) ($f['name'] ?? []) as $nm) {
                    if (is_string($nm) && $nm !== '') {
                        $vals[] = ['file:' . $fk, $nm, 'name'];
                    }
                }
            }
        }
    }
    $ua = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
    if ($ua !== '') {
        $vals[] = ['user-agent', mb_substr($ua, 0, 1000), 'ua'];
    }
    foreach (['HTTP_REFERER' => 'referer', 'HTTP_X_FORWARDED_FOR' => 'x-forwarded-for', 'HTTP_X_API_VERSION' => 'x-api-version', 'HTTP_ORIGIN' => 'origin'] as $h => $n) {
        $hv = (string) ($_SERVER[$h] ?? '');
        if ($hv !== '') {
            $vals[] = [$n, mb_substr($hv, 0, 2000), 'q'];
        }
    }
    $sess = (string) session_name();
    foreach ($_COOKIE as $ck => $cv) {
        if ($ck === $sess || !is_string($cv) || $cv === '' || preg_match(WAF_SKIP_FIELD, (string) $ck)) {
            continue;
        }
        $vals[] = ['cookie:' . $ck, mb_substr($cv, 0, 4000), 'q'];
    }
    // v83: more than the firewall reads (WAF_MAX_TOTAL characters or 4000 values): what came after the limit was not scanned
    $cut = $size > WAF_MAX_TOTAL || $params > 4000;
    return ['vals' => $vals, 'keys' => $keys, 'params' => $params, 'depth' => $depth, 'qs' => strlen($qs), 'cut' => $cut];
}

/* ---------- decisions ---------- */
/** The country of this request: Cloudflare's header when the request came through Cloudflare, else '' (or a lookup when $look). */
function wafCountry(bool $look = false): string
{
    if (clientEdge()['via'] === 'cloudflare') {
        $cc = strtoupper(substr((string) ($_SERVER['HTTP_CF_IPCOUNTRY'] ?? ''), 0, 2));
        if (preg_match('/^[A-Z]{2}$/', $cc) && $cc !== 'XX' && $cc !== 'T1') {
            return $cc;
        }
    }
    if ($look) {
        try {
            $g = geoLookup(clientIp());
            $cc = strtoupper((string) ($g['cc'] ?? ''));
            return preg_match('/^[A-Z]{2}$/', $cc) ? $cc : '';
        } catch (Throwable $e) {
            return '';
        }
    }
    return '';
}
/** The address's score after fading, and its row. */
function wafScoreOf(string $ip): array
{
    $s = wafdb()->prepare('SELECT * FROM waf_ip WHERE ip = ?');
    $s->execute([$ip]);
    $row = $s->fetch() ?: null;
    if (!$row) {
        return [0.0, null];
    }
    $hl = max(1, (int) wafCfg()['halfLife']) * 3600000;
    $score = (float) $row['score'] * pow(0.5, max(0, now() - (int) $row['at']) / $hl);
    return [$score, $row];
}
/**
 * Adds points to an address (attacks, firewall strikes, traps). Over the ban level the address is banned, longer
 * each time. Allow-listed addresses and the watch mode collect points without bans. Returns the new score.
 */
function wafPoints(string $ip, float $pts, string $rule, string $cc = ''): float
{
    // v83: a request another web site made through a visitor's browser never scores (or bans) the visitor's address
    if ($ip === '' || $pts <= 0 || fwCrossSite()) {
        return 0.0;
    }
    $real = $ip;
    $ip = ipBucket($ip); // v83: an IPv6 /64 is scored and banned as one address (rotating within it no longer escapes)
    try {
        $c = wafCfg();
        [$score, $row] = wafScoreOf($ip);
        $score += $pts;
        $t = now();
        $bans = (int) ($row['bans'] ?? 0);
        $banAt = (int) ($row['ban_at'] ?? 0);
        if ($banAt && $banAt < $t - 30 * 86400000) {
            $bans = 0;
        }
        $ban = 0;
        if ($c['on'] && $c['mode'] !== 'watch' && $score >= (float) $c['banAt'] && !fwAllowed($real) && !fwBlocked($real)) {
            $ban = WAF_BAN_STEPS[min($bans, count(WAF_BAN_STEPS) - 1)];
            $bans++;
            $banAt = $t;
        }
        wafdb()->prepare('REPLACE INTO waf_ip (ip, score, at, hits, bans, ban_at, first, rule, cc) VALUES (?,?,?,?,?,?,?,?,?)')->execute([
            mb_substr($ip, 0, 64), round($score, 3), $t, (int) ($row['hits'] ?? 0) + 1, $bans, $banAt, (int) ($row['first'] ?? $t), mb_substr($rule, 0, 40), $cc !== '' ? $cc : (string) ($row['cc'] ?? ''),
        ]);
        if ($ban) {
            $what = WAF_RULE_NAMES[$rule] ?? (str_starts_with($rule, 'strike-') ? 'repeated firewall strikes' : $rule);
            fwBlock($ip, 'ip', $ban, 'Automatic: attack score ' . (int) round($score) . ' (' . $what . ')');
            fwLog('ban', 'Banned for ' . wafDur($ban) . ' by the web application firewall (ban ' . $bans . ', score ' . (int) round($score) . ')');
            wafLogRow('ban', (int) round($score), [$rule], '', '', 0);
            if (($bans >= 2 || $pts >= 10) && !throttleHit('wafban:' . gmdate('YmdH'), 1, 3600)) {
                $hits = (int) ($row['hits'] ?? 0) + 1;
                require_once __DIR__ . '/auth.php';
                secAlertAdmins('waf:ban:' . gmdate('YmdH'), 'The firewall banned an attacking address', $ip . ' was banned for ' . wafDur($ban) . ' after ' . $hits . ' attack-like request' . ($hits === 1 ? '' : 's') . ' (score ' . (int) round($score) . ', last: ' . $what . '). ' . ($bans > 1 ? 'This is ban number ' . $bans . ' for that address in 30 days. ' : '') . 'Nothing is needed from you; open Admin > Security & spam firewall to see what it sent.');
            }
        }
        if (random_int(1, 200) === 1) {
            wafdb()->prepare('DELETE FROM waf_ip WHERE at < ?')->execute([$t - 60 * 86400000]);
        }
        return $score;
    } catch (Throwable $e) {
        return 0.0;
    }
}
function wafDur(int $min): string
{
    return $min >= 10080 ? round($min / 10080) . ' week' . ($min >= 20160 ? 's' : '') : ($min >= 1440 ? round($min / 1440) . ' day' . ($min >= 2880 ? 's' : '') : ($min >= 60 ? round($min / 60) . ' hour' . ($min >= 120 ? 's' : '') : $min . ' minutes'));
}
/** One row of the firewall log; returns its reference. */
function wafLogRow(string $act, int $score, array $rules, string $field, string $sample, int $uidKnown = 1, string $cc = ''): string
{
    $id = rid(8);
    try {
        $fams = array_values(array_unique(array_map(fn($r) => explode('-', $r)[0], $rules)));
        $u = $uidKnown ? currentUser() : null;
        wafdb()->prepare('INSERT INTO waf_log (id, at, ip, route, uid, act, score, rules, fam, field, sample, ua, cc, method) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute([
            $id, now(), mb_substr(clientIp(), 0, 64), mb_substr((string) ($GLOBALS['fwRoute'] ?? ''), 0, 40), (string) ($u['id'] ?? ''), $act, $score,
            mb_substr(implode(',', $rules), 0, 300), mb_substr(implode(',', $fams), 0, 80), mb_substr(mb_scrub($field, 'UTF-8'), 0, 80), mb_substr(mb_scrub($sample, 'UTF-8'), 0, 300),
            mb_substr(mb_scrub((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 'UTF-8'), 0, 200), $cc, mb_substr((string) ($_SERVER['REQUEST_METHOD'] ?? ''), 0, 8),
        ]);
        if (random_int(1, 50) === 1) {
            $days = (int) (fwSettings()['log_days'] ?? 30);
            wafdb()->prepare('DELETE FROM waf_log WHERE at < ?')->execute([now() - max(1, $days) * 86400000]);
        }
    } catch (Throwable $e) {
        // the log never blocks a request
    }
    return $id;
}
/** Refuses the request with a reference the visitor can quote. */
function wafRefuse(string $ref, int $status = 403, string $msg = ''): never
{
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    fail($status, 'waf', ($msg !== '' ? $msg : 'This request was blocked by the site\'s firewall.') . ' If you think this is a mistake, email ' . (string) cfg('mail_from') . ' and quote reference W-' . strtoupper(substr($ref, 0, 8)) . '.', ['ref' => 'W-' . strtoupper(substr($ref, 0, 8))]);
}
/** Runs on every API request (api/index.php), after fwGuard. */
function wafGuard(string $r, string $method): void
{
    $c = wafCfg();
    if (!$c['on']) {
        return;
    }
    $ip = clientIp();
    $allowed = fwAllowed($ip);
    $signed = !empty($_SESSION['uid']);
    [$refuseAnon, $logAnon, $refuseUser, $logUser] = WAF_LEVELS[$c['mode']];
    $refuseAt = $allowed ? PHP_INT_MAX : ($signed ? $refuseUser : $refuseAnon);
    $logAt = $signed ? $logUser : $logAnon;
    $hook = in_array($r, WAF_SKIP_BODY, true) || str_starts_with($r, 'phw_');
    // 0. the derived layer: scans and credential stuffing seen across this address's recent requests
    wafBehavior($ip, $r, $signed, $allowed);
    // 1. the request itself
    if (!in_array($method, ['GET', 'POST', 'HEAD', 'OPTIONS'], true) && !empty($c['fam']['proto'])) {
        $ref = wafLogRow($allowed || $c['mode'] === 'watch' ? 'log' : 'block', 10, ['proto-method'], 'method', $method);
        if (!$signed) {
            wafPoints($ip, 10, 'proto-method');
            wafNoteProbe($ip);
        }
        if (!$allowed && $c['mode'] !== 'watch') {
            header('Allow: GET, POST');
            wafRefuse($ref, 405, 'This method is not used by the site.');
        }
    }
    if (!empty($c['traps']) && in_array(strtolower($r), WAF_DECOYS, true) && !$signed) {
        $ref = wafLogRow($allowed || $c['mode'] === 'watch' ? 'log' : 'block', 25, ['trap-route'], 'r', $r);
        fwLog('trap', 'Asked for the decoy route ' . mb_substr($r, 0, 40), $r);
        wafPoints($ip, 25, 'trap-route');
        wafNoteProbe($ip);
        http_response_code(404);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'not_found']);
        exit();
    }
    // blocked countries: Cloudflare's header on every visitor request; without Cloudflare one cached lookup on sign-ins and public forms
    $list = !empty($c['geo']) && !$allowed && !$hook ? array_map('strtoupper', fwLines((string) (fwSettings()['countries'] ?? ''))) : [];
    $cc = '';
    if ($list && (!$signed || $r === 'login')) {
        $cc = wafCountry($method === 'POST' && in_array($r, WAF_GEO_ROUTES, true));
        if ($cc !== '' && in_array($cc, $list, true)) {
            $ref = wafLogRow($c['mode'] === 'watch' ? 'log' : 'block', 0, ['geo-block'], 'country', $cc, 1, $cc);
            if ($c['mode'] !== 'watch') {
                wafRefuse($ref, 403, 'This site is not available from your country.');
            }
        }
    }
    if ($hook) {
        return;
    }
    // 2. everything the request carries
    $req = wafCollect($r, $signed);
    $found = [];
    $add = function (array $hits, string $field) use (&$found, $c, $r) {
        foreach ($hits as [$id, $f, $pts, $sample]) {
            if (in_array($id . '@' . $r, $c['skip'], true) || in_array($id . '@*', $c['skip'], true)) {
                continue;
            }
            if (!isset($found[$id]) || $found[$id][1] < $pts) {
                $found[$id] = [$f, $pts, $field, $sample];
            }
        }
    };
    foreach ($req['vals'] as [$field, $val, $where]) {
        $add(wafScan((string) $val, $where, $c['fam']), $field);
    }
    foreach ($req['keys'] as [$field, $key]) {
        if (preg_match('/[$<\{]/', $key)) {
            $add(wafScan($key, 'key', $c['fam']), $field);
        }
    }
    if (!empty($c['fam']['proto'])) {
        if ($req['qs'] > 16384) {
            $add([['proto-long-query', 'proto', 10, $req['qs'] . ' characters']], '?');
        } elseif ($req['qs'] > 4096) {
            $add([['proto-long-query', 'proto', 5, $req['qs'] . ' characters']], '?');
        }
        if ($req['params'] > 1500) {
            $add([['proto-params', 'proto', 5, $req['params'] . ' parameters']], 'body');
        }
        if ($req['depth'] > 32) {
            $add([['proto-depth', 'proto', 5, 'nested ' . $req['depth'] . ' levels']], 'body');
        }
        // v83: a visitor's request too big to read whole cannot hide an attack behind padding (signed-in people are
        // left out: they are never refused for protocol hits and may save large records)
        if ($req['cut'] && !$signed) {
            $add([['proto-oversize', 'proto', 10, 'more than the firewall reads']], 'body');
        }
    }
    // a public form posted without any browser name
    if (!$signed && $method === 'POST' && !empty($c['fam']['bot']) && trim((string) ($_SERVER['HTTP_USER_AGENT'] ?? '')) === '' && in_array($r, GUARD_POW_FORMS, true)) {
        $add([['bot-empty', 'bot', 3, '(no user agent)']], 'user-agent');
    }
    // a script's user agent only counts on public form posts (monitors and feeds read the site with them all day)
    if (isset($found['bot-script']) && ($signed || $method !== 'POST' || !in_array($r, GUARD_POW_FORMS, true))) {
        unset($found['bot-script']);
    }
    if (!$found) {
        return;
    }
    $score = 0;
    foreach ($found as $f) {
        $score += $f[1];
    }
    if ($score < $logAt) {
        return;
    }
    uasort($found, fn($a, $b) => $b[1] <=> $a[1]);
    $top = reset($found);
    $refuse = $score >= $refuseAt;
    if ($refuse && $signed) {
        // a signed-in person is refused only for what attacks the server itself (SQL, commands, files, internal
        // addresses, injected objects); script-looking text alone is logged, the portal shows it as text anyway
        $serverSide = false;
        foreach ($found as [$fm, $pts]) {
            if ($pts >= 10 && in_array($fm, ['sqli', 'rce', 'lfi', 'ssrf', 'inject', 'nosql'], true)) {
                $serverSide = true;
                break;
            }
        }
        $refuse = $serverSide;
    }
    $act = $refuse ? 'block' : ($c['mode'] === 'watch' && $score >= ($signed ? WAF_LEVELS['balanced'][2] : WAF_LEVELS['balanced'][0]) ? 'watch' : 'log');
    $ref = wafLogRow($act, $score, array_keys($found), (string) $top[2], (string) $top[3], 1, $cc);
    if (!$signed) {
        // points stay with the address (a refused request counts fully, one only logged counts half): a visitor who
        // keeps attacking is banned
        wafPoints($ip, $refuse || $act === 'watch' ? (float) min($score, 40) : (float) min($score / 2, 10), (string) array_key_first($found), $cc);
        wafNoteProbe($ip); // counts towards the behavioral scan signal too
    } elseif ($score >= WAF_LEVELS['balanced'][3] && !empty($c['staffAlert']) && !throttleHit('wafuser:' . (string) $_SESSION['uid'], 1, 3600)) {
        $u = currentUser();
        if ($u) {
            require_once __DIR__ . '/auth.php';
            secAlertAdmins('waf:user:' . $u['id'], 'Attack-like request from ' . $u['name'], $u['name'] . ' (' . $u['email'] . ') sent a request to "' . $r . '" that matched ' . implode(', ', array_map(fn($k) => WAF_RULE_NAMES[$k] ?? $k, array_keys($found))) . ' (score ' . $score . ($refuse ? ', refused' : ', logged only') . '). It may be harmless (pasted code, a technical note) or a sign the account is misused. Reference W-' . strtoupper(substr($ref, 0, 8)) . ' under Admin > Security & spam firewall.');
        }
    }
    if ($refuse) {
        wafRefuse($ref);
    }
}
/** Firewall strikes (firewall.php) add to the address's score: wrong passwords, spam, failed bot checks, the rate limit. */
function wafStrike(string $kind): void
{
    $pts = ['login' => 2, 'spam' => 4, 'bot' => 4, 'rate' => 3, 'ai' => 5, 'xsite' => 2][$kind] ?? 2;
    if (empty($_SESSION['uid'])) {
        wafPoints(clientIp(), (float) $pts, 'strike-' . preg_replace('/[^a-z]/', '', $kind));
        wafNoteProbe(clientIp());
    }
}
/* ---------- the derived (behavioral) layer: patterns across many requests, not one ---------- */
/** Counts one refused/probing request against the address, over the behavioral window. */
function wafNoteProbe(string $ip): void
{
    if ($ip === '' || !function_exists('guardCount') || fwCrossSite()) {
        return;
    }
    $c = wafCfg();
    if (empty($c['behavior']) || empty($c['fam']['bhv'])) {
        return;
    }
    try {
        guardCount('wafprobe:' . ipBucket($ip), max(1, (int) $c['probeWindow']) * 60, 1);
    } catch (Throwable $e) {
        // counting never blocks a request
    }
}
/**
 * Derived signals for an anonymous address: a scan spread across many endpoints (lots of refused/probing requests in
 * the window) and credential stuffing (many wrong sign-ins). Each adds escalating points to the same score, so an
 * attacker who stays under the per-request bar is still banned once the pattern is clear. Signed-in and allow-listed
 * addresses are skipped (they are accountable, and the data-theft guard already watches authenticated enumeration).
 */
function wafBehavior(string $ip, string $r, bool $signed, bool $allowed): void
{
    $c = wafCfg();
    if (empty($c['on']) || empty($c['behavior']) || empty($c['fam']['bhv']) || $signed || $allowed || $ip === '' || !function_exists('guardCount')) {
        return;
    }
    $watch = $c['mode'] === 'watch';
    $key = ipBucket($ip); // v83: counted per IPv6 /64
    try {
        $n = guardCount('wafprobe:' . $key, max(1, (int) $c['probeWindow']) * 60, 0);
        if ($n >= max(4, (int) $c['probeMax']) && !throttleHit('wafbhv:probe:' . $key, 1, 60)) {
            $pts = min(20, 8 + intdiv(max(0, $n - (int) $c['probeMax']), 5) * 4);
            wafLogRow($watch ? 'watch' : 'log', $pts, ['bhv-probe'], 'address', $n . ' refused or probing requests in ' . $c['probeWindow'] . ' min');
            wafPoints($ip, (float) $pts, 'bhv-probe');
        }
        if ($r === 'login') {
            $f = guardCount('guard:ipfail:' . $key, 900, 0);
            if ($f >= max(3, (int) $c['stuffMax']) && !throttleHit('wafbhv:stuff:' . $key, 1, 60)) {
                $pts = min(20, 6 + intdiv(max(0, $f - (int) $c['stuffMax']), 5) * 3);
                wafLogRow($watch ? 'watch' : 'log', $pts, ['bhv-stuffing'], 'login', $f . ' wrong sign-ins from this address in 15 min');
                wafPoints($ip, (float) $pts, 'bhv-stuffing');
            }
        }
    } catch (Throwable $e) {
        // the behavioral layer never blocks a request on its own error
    }
}
/** From the scheduled task: trims the firewall log to the kept days and drops long-idle address scores. */
function wafCronPrune(): array
{
    try {
        $days = max(1, (int) (fwSettings()['log_days'] ?? 30));
        $p = wafdb();
        $l = $p->prepare('DELETE FROM waf_log WHERE at < ?');
        $l->execute([now() - $days * 86400000]);
        $i = $p->prepare('DELETE FROM waf_ip WHERE at < ? AND ban_at < ?');
        $i->execute([now() - 60 * 86400000, now() - 60 * 86400000]);
        return ['logs' => $l->rowCount(), 'addresses' => $i->rowCount()];
    } catch (Throwable $e) {
        return ['err' => mb_substr($e->getMessage(), 0, 120)];
    }
}
/** Checks a sample against the signatures without logging (Admin > Security > Web application firewall > Test). */
function wafTest(string $text): array
{
    $c = wafCfg();
    $hits = [];
    foreach (wafScan($text, '', $c['fam']) as [$id, $f, $pts, $sample]) {
        $hits[$id] = ['id' => $id, 'fam' => $f, 'pts' => $pts, 'n' => WAF_RULE_NAMES[$id] ?? $id, 'sample' => $sample, 'skipped' => in_array($id . '@*', $c['skip'], true)];
    }
    $score = array_sum(array_map(fn($h) => $h['skipped'] ? 0 : $h['pts'], $hits));
    [$ra, $la, $ru, $lu] = WAF_LEVELS[$c['mode']];
    return ['hits' => array_values($hits), 'score' => $score, 'visitor' => $score >= $ra ? 'refused' : ($score >= $la ? 'logged' : 'allowed'), 'member' => $score >= $ru ? 'refused' : ($score >= $lu ? 'logged' : 'allowed')];
}

/* ---------- the dashboard and the security analyst ---------- */
/** Plain numbers about the last day and week, the busiest attackers and what to consider blocking. */
function wafBrief(int $hours = 24): array
{
    $p = wafdb();
    $since = now() - $hours * 3600000;
    $acts = [];
    $s = $p->prepare('SELECT act, COUNT(*) AS n FROM waf_log WHERE at > ? GROUP BY act');
    $s->execute([$since]);
    foreach ($s->fetchAll() as $x) {
        $acts[$x['act']] = (int) $x['n'];
    }
    $fams = [];
    $rules = [];
    $s = $p->prepare('SELECT rules FROM waf_log WHERE at > ? AND act IN (\'block\', \'log\', \'watch\') ORDER BY at DESC LIMIT 5000');
    $s->execute([$since]);
    foreach ($s->fetchAll(PDO::FETCH_COLUMN) as $rl) {
        $seenF = [];
        foreach (array_filter(explode(',', (string) $rl)) as $rid) {
            $rules[$rid] = ($rules[$rid] ?? 0) + 1;
            $f = explode('-', $rid)[0];
            if (!isset($seenF[$f])) {
                $fams[$f] = ($fams[$f] ?? 0) + 1;
                $seenF[$f] = 1;
            }
        }
    }
    arsort($rules);
    arsort($fams);
    $fw = [];
    $s = fwdb()->prepare('SELECT kind, COUNT(*) AS n FROM fw_log WHERE at > ? GROUP BY kind');
    $s->execute([$since]);
    foreach ($s->fetchAll() as $x) {
        $fw[$x['kind']] = (int) $x['n'];
    }
    $top = [];
    $s = $p->prepare('SELECT ip, COUNT(*) AS n, MAX(score) AS mx, MAX(at) AS last, MAX(cc) AS cc FROM waf_log WHERE at > ? AND uid = \'\' GROUP BY ip ORDER BY n DESC LIMIT 15');
    $s->execute([$since]);
    $hl = max(1, (int) wafCfg()['halfLife']) * 3600000;
    foreach ($s->fetchAll() as $x) {
        [$score, $row] = wafScoreOf(ipBucket((string) $x['ip']));
        $b = fwBlocked((string) $x['ip']);
        $top[] = ['ip' => (string) $x['ip'], 'n' => (int) $x['n'], 'max' => (int) $x['mx'], 'last' => (int) $x['last'], 'cc' => (string) ($x['cc'] ?: ($row['cc'] ?? '')), 'score' => round($score, 1), 'bans' => (int) ($row['bans'] ?? 0), 'blocked' => $b ? ($b['until'] ?: 0) : null, 'allowed' => fwAllowed((string) $x['ip'])];
    }
    // addresses worth blocking for longer: high scores now, or banned before and back
    $suggest = [];
    $s = $p->query('SELECT ip, score, at, bans, hits, rule, cc FROM waf_ip ORDER BY score DESC LIMIT 60');
    foreach ($s->fetchAll() as $x) {
        $sc = (float) $x['score'] * pow(0.5, max(0, now() - (int) $x['at']) / $hl);
        $ipx = (string) $x['ip'];
        if (($sc >= 15 || (int) $x['bans'] >= 2) && !fwBlocked($ipx) && !fwAllowed($ipx) && $ipx !== ipBucket(clientIp())) {
            $suggest[] = ['ip' => $ipx, 'score' => round($sc, 1), 'bans' => (int) $x['bans'], 'hits' => (int) $x['hits'], 'rule' => (string) $x['rule'], 'why' => WAF_RULE_NAMES[(string) $x['rule']] ?? (string) $x['rule'], 'cc' => (string) $x['cc'], 'minutes' => (int) $x['bans'] >= 3 ? 43200 : ((int) $x['bans'] >= 2 ? 10080 : 1440)];
        }
        if (count($suggest) >= 8) {
            break;
        }
    }
    $members = [];
    $s = $p->prepare('SELECT uid, COUNT(*) AS n, MAX(score) AS mx FROM waf_log WHERE at > ? AND uid <> \'\' GROUP BY uid ORDER BY n DESC LIMIT 10');
    $s->execute([$since]);
    foreach ($s->fetchAll() as $x) {
        $ur = userRow((string) $x['uid']);
        $members[] = ['uid' => (string) $x['uid'], 'name' => (string) ($ur['name'] ?? $x['uid']), 'email' => (string) ($ur['email'] ?? ''), 'n' => (int) $x['n'], 'max' => (int) $x['mx']];
    }
    $att = (int) secKv('guard_attack', 0);
    return [
        'hours' => $hours,
        'blocked' => (int) ($acts['block'] ?? 0),
        'logged' => (int) ($acts['log'] ?? 0) + (int) ($acts['watch'] ?? 0),
        'bans' => (int) ($acts['ban'] ?? 0),
        'families' => array_map(fn($k, $v) => ['k' => $k, 'n' => WAF_FAMILIES[$k] ?? $k, 'count' => $v], array_keys($fams), array_values($fams)),
        'rules' => array_slice(array_map(fn($k, $v) => ['id' => $k, 'n' => WAF_RULE_NAMES[$k] ?? $k, 'count' => $v], array_keys($rules), array_values($rules)), 0, 12),
        'firewall' => $fw,
        'top' => $top,
        'suggest' => $suggest,
        'members' => $members,
        'attackMode' => $att > now() ? $att : 0,
        'mode' => wafCfg()['mode'],
        'on' => wafCfg()['on'],
    ];
}
/** Everything known about one address: its score, bans, what it sent, and who signed in from it. */
function wafIpProfile(string $ip, bool $geo = false): array
{
    [$score, $row] = wafScoreOf(ipBucket($ip));
    $p = wafdb();
    $s = $p->prepare('SELECT id, at, route, uid, act, score, rules, field, sample, ua, cc, method FROM waf_log WHERE ip = ? ORDER BY at DESC LIMIT 60');
    $s->execute([$ip]);
    $waf = $s->fetchAll();
    $s = fwdb()->prepare('SELECT at, route, kind, detail FROM fw_log WHERE ip = ? ORDER BY at DESC LIMIT 60');
    $s->execute([$ip]);
    $fw = $s->fetchAll();
    $people = [];
    try {
        $s = secdb()->prepare('SELECT uid, MAX(at) AS last, COUNT(*) AS n FROM auth_sessions WHERE ip = ? GROUP BY uid ORDER BY last DESC LIMIT 10');
        $s->execute([$ip]);
        foreach ($s->fetchAll() as $x) {
            $ur = userRow((string) $x['uid']);
            $people[] = ['uid' => (string) $x['uid'], 'name' => (string) ($ur['name'] ?? ''), 'email' => (string) ($ur['email'] ?? ''), 'last' => (int) $x['last'], 'n' => (int) $x['n']];
        }
    } catch (Throwable $e) {
        $people = [];
    }
    $b = fwBlocked($ip);
    return [
        'ip' => $ip,
        'score' => round($score, 1),
        'hits' => (int) ($row['hits'] ?? 0),
        'bans' => (int) ($row['bans'] ?? 0),
        'first' => (int) ($row['first'] ?? 0),
        'cc' => (string) ($row['cc'] ?? ''),
        'blocked' => $b,
        'allowed' => fwAllowed($ip),
        'you' => ipBucket($ip) === ipBucket(clientIp()),
        'waf' => $waf,
        'fw' => $fw,
        'people' => $people,
        'geo' => $geo ? geoLookup($ip) : null,
    ];
}
/** Admin > Security & spam firewall > Web application firewall (administrators). */
function wafRoute(string $r, array $b): never
{
    $me = requireUser();
    if (!hasRole($me, 'admin')) {
        fail(403, 'forbidden', 'Only an administrator can manage the firewall.');
    }
    switch ($r) {
        case 'waf_overview': {
            $hours = in_array((int) ($b['hours'] ?? 24), [1, 24, 168, 720], true) ? (int) $b['hours'] : 24;
            $p = wafdb();
            $f = [];
            $args = [now() - $hours * 3600000];
            $act = (string) ($b['act'] ?? '');
            if (in_array($act, ['block', 'log', 'ban', 'watch'], true)) {
                $f[] = 'act = ?';
                $args[] = $act;
            }
            $fam = (string) ($b['fam'] ?? '');
            if (isset(WAF_FAMILIES[$fam])) {
                $f[] = 'fam LIKE ?';
                $args[] = '%' . $fam . '%';
            }
            $ipq = trim((string) ($b['ip'] ?? ''));
            if ($ipq !== '' && preg_match('/^[0-9a-f:.]{2,64}$/i', $ipq)) {
                $f[] = 'ip = ?';
                $args[] = $ipq;
            }
            $s = $p->prepare('SELECT id, at, ip, route, uid, act, score, rules, fam, field, sample, ua, cc, method FROM waf_log WHERE at > ?' . ($f ? ' AND ' . implode(' AND ', $f) : '') . ' ORDER BY at DESC LIMIT 300');
            $s->execute($args);
            $events = $s->fetchAll();
            $names = [];
            foreach ($events as &$e) {
                if ($e['uid'] !== '') {
                    $names[$e['uid']] = $names[$e['uid']] ?? (string) (userRow((string) $e['uid'])['name'] ?? '');
                    $e['who'] = $names[$e['uid']];
                }
                $e['ref'] = 'W-' . strtoupper(substr((string) $e['id'], 0, 8));
            }
            unset($e);
            // requests per hour over the window (refused and logged), for the chart
            $buckets = [];
            $step = $hours <= 24 ? 3600000 : 86400000;
            $s = $p->prepare('SELECT at, act FROM waf_log WHERE at > ? ORDER BY at DESC LIMIT 20000');
            $s->execute([now() - $hours * 3600000]);
            foreach ($s->fetchAll() as $x) {
                $k = (int) (floor((int) $x['at'] / $step) * $step);
                $buckets[$k] = $buckets[$k] ?? ['t' => $k, 'block' => 0, 'log' => 0];
                $buckets[$k][$x['act'] === 'block' || $x['act'] === 'ban' ? 'block' : 'log']++;
            }
            ksort($buckets);
            $rules = [];
            foreach (wafRules() as [$id, $fm, $pts]) {
                $rules[] = ['id' => $id, 'fam' => $fm, 'pts' => $pts, 'n' => WAF_RULE_NAMES[$id] ?? $id];
            }
            ok([
                'cfg' => wafCfg(),
                'brief' => wafBrief($hours),
                'events' => $events,
                'series' => array_values($buckets),
                'rules' => $rules,
                'families' => WAF_FAMILIES,
                'levels' => WAF_LEVELS,
                'you' => clientIp(),
                'countries' => (string) (fwSettings()['countries'] ?? ''),
                'cf' => clientEdge()['via'] === 'cloudflare',
            ]);
        }
        case 'waf_save': {
            requireRecentAuth();
            $before = wafCfg(true);
            $new = wafSave((array) ($b['cfg'] ?? []));
            $diff = [];
            foreach ($new as $k => $v) {
                if (($before[$k] ?? null) !== $v) {
                    $diff[$k] = ['from' => $before[$k] ?? null, 'to' => $v];
                }
            }
            audit('settings', 'Web application firewall settings changed', 'waf', $diff, $me);
            fwLog('settings', 'Web application firewall settings saved by ' . $me['name']);
            ok(['cfg' => $new]);
        }
        case 'waf_allow': {
            // a false alarm: this signature no longer counts on this route (or anywhere)
            requireRecentAuth();
            $rule = preg_replace('/[^a-z0-9-]/', '', strtolower(str($b, 'rule', 40))) ?? '';
            $route = preg_replace('/[^a-z0-9_*]/', '', strtolower(str($b, 'route', 40))) ?? '';
            if (!isset(WAF_RULE_NAMES[$rule]) || $route === '') {
                fail(400, 'invalid_argument', 'Choose a signature and a route.');
            }
            $c = wafCfg(true);
            $c['skip'][] = $rule . '@' . $route;
            $new = wafSave(['skip' => $c['skip']]);
            audit('settings', 'Firewall exception added', $rule . '@' . $route, ['note' => str($b, 'note', 200)], $me);
            fwLog('settings', 'Exception ' . $rule . '@' . $route . ' added by ' . $me['name']);
            ok(['cfg' => $new]);
        }
        case 'waf_unallow': {
            $k = str($b, 'k', 90);
            $c = wafCfg(true);
            $new = wafSave(['skip' => array_values(array_filter($c['skip'], fn($x) => $x !== $k))]);
            audit('settings', 'Firewall exception removed', $k, [], $me);
            ok(['cfg' => $new]);
        }
        case 'waf_ip': {
            $ip = trim(str($b, 'ip', 64));
            if (!filter_var($ip, FILTER_VALIDATE_IP)) {
                fail(400, 'invalid_argument', 'Enter a network address like 203.0.113.9.');
            }
            ok(wafIpProfile($ip, !empty($b['geo'])));
        }
        case 'waf_forgive': {
            $ip = trim(str($b, 'ip', 64));
            wafdb()->prepare('DELETE FROM waf_ip WHERE ip IN (?, ?)')->execute([$ip, ipBucket($ip)]);
            audit('settings', 'Firewall score cleared for an address', $ip, [], $me);
            ok(['ok' => true]);
        }
        case 'waf_test': {
            $t = (string) ($b['text'] ?? '');
            if (mb_strlen($t) > 8000) {
                $t = mb_substr($t, 0, 8000);
            }
            ok(wafTest($t));
        }
        case 'waf_clear': {
            requireRecentAuth();
            wafdb()->exec('DELETE FROM waf_log');
            audit('settings', 'Web application firewall log cleared', 'waf', [], $me);
            ok(['ok' => true]);
        }
    }
    fail(404, 'not_found', 'Unknown action.');
}
