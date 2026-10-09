<?php
// Scheduled work (api/cronlib.php: job collection, email, backups, the daily security check, retention, reminders and
// more). Add it in cPanel > Cron Jobs (every 5 to 15 minutes):
//   php /home/YOUR_ACCOUNT/public_html/api/cron.php
// The exact command and a web alternative are shown under Admin > Job portals > Sources.
declare(strict_types=1);
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit();
}
// v37: php cron.php --ws=<name> runs one company workspace's scheduled work (StratEdge's own run starts these)
foreach (array_slice($argv ?? [], 1) as $arg) {
    if (preg_match('/^--ws=([a-z0-9-]{1,30})$/', (string) $arg, $m)) {
        $GLOBALS['SE_WS_FORCE'] = $m[1];
    }
}
require __DIR__ . '/lib.php';
require __DIR__ . '/cronlib.php';
if (isset($GLOBALS['SE_WS_FORCE']) && wsSlug() === '') {
    echo 'There is no workspace called ' . $GLOBALS['SE_WS_FORCE'] . "\n";
    exit(1);
}
if (empty($_SERVER['HTTP_HOST'])) {
    $_SERVER['HTTP_HOST'] = (string) (parse_url((string) cfg('site_url'), PHP_URL_HOST) ?: 'localhost');
}
@set_time_limit(0);
ini_set('display_errors', '1');
$GLOBALS['mailKind'] = 'cron';
foreach (cronAll(true) as $line) {
    echo $line . "\n";
}
if (!isset($GLOBALS['SE_WS_FORCE'])) {
    require_once __DIR__ . '/wsadmin.php';
    foreach (wsCronAll(true) as $line) {
        echo $line . "\n";
    }
}
