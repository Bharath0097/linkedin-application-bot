<?php
// Collects jobs and refreshes matches when a collection is due. Add it in cPanel > Cron Jobs
// (every 10 or 15 minutes):   php /home/YOUR_ACCOUNT/public_html/api/cron.php
// The exact command and a web alternative are shown under Admin > Job portals > Sources.
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/lib.php'; require __DIR__ . '/jobs.php';
if (empty($_SERVER['HTTP_HOST'])) $_SERVER['HTTP_HOST'] = (string) (parse_url((string) cfg('site_url'), PHP_URL_HOST) ?: 'localhost');
@set_time_limit(0); ini_set('display_errors', '1');
$out = jobCron(true);
echo date('c') . ' ' . $out['message'] . "\n";
