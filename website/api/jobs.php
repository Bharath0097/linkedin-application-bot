<?php
declare(strict_types=1);
/* ==========================================================================
   Job matching, built into the site. No separate server to run.
   - Collects postings from the job sources turned on under Admin > Job portals > Sources
     (job-board APIs that publish listings for this purpose, plus any RSS/JSON feed).
   - Reads each consultant's resume for titles, skills, experience and location.
   - Ranks the collected jobs against every consultant and explains each match.
   A collection is a list of small tasks (one search, one feed, one person's matching)
   run a few at a time, so it finishes within shared-hosting time limits. Steps are
   driven by whoever has a job page open (jobs_tick), by api/cron.php or by the cron URL.
   ========================================================================== */
require_once __DIR__ . '/textract.php';

const JOB_STATES = ['new', 'saved', 'applied', 'dismissed'];
const APP_STATES = ['applied', 'interview', 'offer', 'placed', 'rejected', 'withdrawn']; // one-click applications (job_apps.status)
const JOB_SCHEMA = 2; // 2: job_resumes (several resumes per consultant) and job_apps (one-click applications)
const JOB_MAX_RESUMES = 10;
// Job grabber actions a bench sales recruiter may use; everything else (sources, keys, settings, cron, starting the scheduled collection) is staff only.
const JOBS_BENCH_OPS = ['overview', 'grab', 'run_jobs', 'jobs', 'runs', 'run_log', 'step', 'stop', 'publish', 'unpublish', 'consultants', 'matches', 'resumes', 'apps'];
const JOB_TYPES = ['Contract', 'C2C', 'W2', '1099', 'Contract-to-hire', 'Full-time', 'Part-time'];
const JOB_CONTRACT_TYPES = ['Contract', 'C2C', 'W2', '1099', 'Contract-to-hire'];
const JOB_ROLE_TOKENS = ['developer', 'engineer', 'programmer', 'consultant', 'analyst', 'architect', 'administrator', 'manager', 'lead', 'specialist', 'qa', 'scientist', 'designer', 'nurse', 'accountant', 'coordinator', 'technician', 'director', 'owner', 'master', 'dba', 'sre', 'auditor', 'controller', 'bookkeeper', 'recruiter', 'officer', 'expert', 'associate', 'support', 'representative', 'assistant', 'clerk', 'intern', 'head', 'practitioner', 'therapist', 'pharmacist', 'technologist', 'executive'];
const JOB_NEUTRAL_TOKENS = ['senior', 'junior', 'principal', 'staff', 'i', 'ii', 'iii', 'iv', 'v', '1', '2', '3', '4', 'level', 'remote', 'hybrid', 'onsite', 'on', 'site', 'contract', 'contractor', 'w2', 'c2c', '1099', 'fulltime', 'full', 'time', 'part', 'temp', 'temporary', 'to', 'hire', 'cth', 'perm', 'permanent', 'the', 'a', 'an', 'of', 'and', 'or', 'for', 'with', 'in', 'at', 'urgent', 'immediate', 'need', 'needed', 'opening', 'position', 'role', 'job', 'opportunity', 'usa', 'us', 'only', 'local', 'candidates', 'day', 'week', 'month', 'months', 'long', 'term', 'experienced', 'entry', 'mid', 'new', 'grad', 'hiring', 'now', 'req', 'requirement', 'jr', 'sr', 'is', 'are', 'who', 'that', 'this', 'from', 'by', 'as', 'be', 'all', 'any'];
const JOB_TOKEN_MAP = ['sr' => 'senior', 'jr' => 'junior', 'dev' => 'developer', 'devs' => 'developer', 'developers' => 'developer', 'engr' => 'engineer', 'engineers' => 'engineer', 'engineering' => 'engineer', 'mgr' => 'manager', 'managers' => 'manager', 'admin' => 'administrator', 'admins' => 'administrator', 'administrators' => 'administrator', 'administration' => 'administrator', 'sys' => 'system', 'systems' => 'system', 'apps' => 'application', 'app' => 'application', 'applications' => 'application', 'nursing' => 'nurse', 'nurses' => 'nurse', 'rn' => 'nurse', 'networks' => 'network', 'networking' => 'network', 'databases' => 'database', 'db' => 'database', 'tester' => 'qa', 'testers' => 'qa', 'testing' => 'qa', 'test' => 'qa', 'quality' => 'qa', 'sdet' => 'qa', 'golang' => 'go', 'k8s' => 'kubernetes', 'reactjs' => 'react', 'nodejs' => 'node', 'angularjs' => 'angular', 'vuejs' => 'vue', 'js' => 'javascript', 'ts' => 'typescript', 'analysts' => 'analyst', 'consultants' => 'consultant', 'architects' => 'architect', 'specialists' => 'specialist', 'scientists' => 'scientist', 'designers' => 'designer', 'accountants' => 'accountant', 'accounting' => 'accountant', 'coordinators' => 'coordinator', 'technicians' => 'technician', 'tech' => 'technician', 'programmers' => 'programmer', 'leads' => 'lead', 'cyber' => 'security', 'cybersecurity' => 'security', 'infosec' => 'security', 'ux' => 'ui', 'frontend' => 'frontend', 'ai' => 'ai', 'ml' => 'ai', 'mlops' => 'ai', 'bi' => 'bi', 'pm' => 'manager', 'ba' => 'analyst', 'devops' => 'devops', 'cloud' => 'cloud', 'infra' => 'infrastructure'];
const JOB_TOKEN_SYN = ['developer' => ['engineer', 'programmer'], 'engineer' => ['developer', 'programmer'], 'programmer' => ['developer', 'engineer'], 'frontend' => ['ui', 'react', 'angular', 'web'], 'backend' => ['api', 'server'], 'fullstack' => ['frontend', 'backend', 'web'], 'devops' => ['sre', 'cloud', 'platform'], 'sre' => ['devops', 'reliability'], 'dba' => ['database'], 'database' => ['dba', 'sql'], 'security' => ['soc', 'iam'], 'data' => ['analytics', 'bi', 'etl'], 'bi' => ['data', 'analytics', 'reporting'], 'ai' => ['data', 'genai', 'llm'], 'network' => ['noc', 'infrastructure'], 'qa' => ['automation'], 'automation' => ['qa'], 'web' => ['frontend', 'fullstack'], 'erp' => ['sap', 'oracle'], 'cloud' => ['aws', 'azure', 'gcp', 'devops'], 'nurse' => ['clinical'], 'manager' => ['management', 'lead'], 'lead' => ['manager', 'senior'], 'analyst' => ['analysis'], 'infrastructure' => ['network', 'system']];
const US_STATES = ['AL' => 'Alabama', 'AK' => 'Alaska', 'AZ' => 'Arizona', 'AR' => 'Arkansas', 'CA' => 'California', 'CO' => 'Colorado', 'CT' => 'Connecticut', 'DE' => 'Delaware', 'FL' => 'Florida', 'GA' => 'Georgia', 'HI' => 'Hawaii', 'ID' => 'Idaho', 'IL' => 'Illinois', 'IN' => 'Indiana', 'IA' => 'Iowa', 'KS' => 'Kansas', 'KY' => 'Kentucky', 'LA' => 'Louisiana', 'ME' => 'Maine', 'MD' => 'Maryland', 'MA' => 'Massachusetts', 'MI' => 'Michigan', 'MN' => 'Minnesota', 'MS' => 'Mississippi', 'MO' => 'Missouri', 'MT' => 'Montana', 'NE' => 'Nebraska', 'NV' => 'Nevada', 'NH' => 'New Hampshire', 'NJ' => 'New Jersey', 'NM' => 'New Mexico', 'NY' => 'New York', 'NC' => 'North Carolina', 'ND' => 'North Dakota', 'OH' => 'Ohio', 'OK' => 'Oklahoma', 'OR' => 'Oregon', 'PA' => 'Pennsylvania', 'RI' => 'Rhode Island', 'SC' => 'South Carolina', 'SD' => 'South Dakota', 'TN' => 'Tennessee', 'TX' => 'Texas', 'UT' => 'Utah', 'VT' => 'Vermont', 'VA' => 'Virginia', 'WA' => 'Washington', 'WV' => 'West Virginia', 'WI' => 'Wisconsin', 'WY' => 'Wyoming', 'DC' => 'District of Columbia'];

/* ---------- storage ---------- */
function jdb(): PDO {
  static $ok = false; $p = db(); if ($ok) return $p;
  $cur = $p->query("SELECT v FROM meta WHERE k = 'jobs_schema'")->fetch();
  if (!$cur || (int) $cur['v'] < JOB_SCHEMA) {
    $my = $p->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql'; $id = $my ? 'INT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    $p->exec("CREATE TABLE IF NOT EXISTS job_posts (id $id, k VARCHAR(64) NOT NULL, fp VARCHAR(64) NOT NULL, src VARCHAR(40) NOT NULL, pub VARCHAR(80) NOT NULL, title VARCHAR(300) NOT NULL, company VARCHAR(200) NOT NULL, location VARCHAR(200) NOT NULL, remote VARCHAR(20) NOT NULL, job_type VARCHAR(60) NOT NULL, salary VARCHAR(120) NOT NULL, url VARCHAR(1000) NOT NULL, boards TEXT NOT NULL, summary TEXT NOT NULL, description LONGTEXT NOT NULL, skills TEXT NOT NULL, posted BIGINT NOT NULL, first_seen BIGINT NOT NULL, last_seen BIGINT NOT NULL, run_id INT NOT NULL, published INT NOT NULL)");
    $p->exec("CREATE TABLE IF NOT EXISTS job_matches (uid VARCHAR(40) NOT NULL, job_id INT NOT NULL, score INT NOT NULL, reasons TEXT NOT NULL, state VARCHAR(12) NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, PRIMARY KEY (uid, job_id))");
    $p->exec("CREATE TABLE IF NOT EXISTS job_runs (id $id, kind VARCHAR(12) NOT NULL, status VARCHAR(20) NOT NULL, trigger_by VARCHAR(160) NOT NULL, started_at BIGINT NOT NULL, finished_at BIGINT NOT NULL, heartbeat BIGINT NOT NULL, pos INT NOT NULL, total INT NOT NULL, searches INT NOT NULL, jobs_found INT NOT NULL, jobs_new INT NOT NULL, errors TEXT NOT NULL, logtext LONGTEXT NOT NULL, search TEXT NOT NULL, plan LONGTEXT NOT NULL)");
    $p->exec("CREATE TABLE IF NOT EXISTS job_run_jobs (run_id INT NOT NULL, job_id INT NOT NULL, PRIMARY KEY (run_id, job_id))");
    $p->exec("CREATE TABLE IF NOT EXISTS job_people (uid VARCHAR(40) PRIMARY KEY, name VARCHAR(190) NOT NULL, email VARCHAR(190) NOT NULL, resume_name VARCHAR(200) NOT NULL, resume_fid VARCHAR(64) NOT NULL, resume_at BIGINT NOT NULL, resume_text LONGTEXT NOT NULL, profile TEXT NOT NULL, prefs TEXT NOT NULL, updated_at BIGINT NOT NULL, matched_at BIGINT NOT NULL)");
    $p->exec("CREATE TABLE IF NOT EXISTS job_kv (k VARCHAR(40) PRIMARY KEY, v LONGTEXT NOT NULL)");
    $p->exec("CREATE TABLE IF NOT EXISTS job_lock (k VARCHAR(20) PRIMARY KEY, until_ms BIGINT NOT NULL)");
    // schema 2: every resume a consultant keeps (one is primary = used for matching), and one-click applications / bench submissions
    $p->exec("CREATE TABLE IF NOT EXISTS job_resumes (id $id, uid VARCHAR(40) NOT NULL, fid VARCHAR(64) NOT NULL, name VARCHAR(200) NOT NULL, label VARCHAR(80) NOT NULL, ext VARCHAR(8) NOT NULL, size INT NOT NULL, text LONGTEXT NOT NULL, profile TEXT NOT NULL, is_primary INT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)");
    $p->exec("CREATE TABLE IF NOT EXISTS job_apps (id $id, uid VARCHAR(40) NOT NULL, job_id INT NOT NULL, resume_id INT NOT NULL, resume_name VARCHAR(200) NOT NULL, by_uid VARCHAR(40) NOT NULL, by_name VARCHAR(190) NOT NULL, kind VARCHAR(8) NOT NULL, status VARCHAR(12) NOT NULL, to_email VARCHAR(190) NOT NULL, mailed INT NOT NULL, note TEXT NOT NULL, title VARCHAR(300) NOT NULL, company VARCHAR(200) NOT NULL, location VARCHAR(200) NOT NULL, url VARCHAR(1000) NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)");
    foreach (['CREATE UNIQUE INDEX job_posts_k ON job_posts (k)', 'CREATE INDEX job_posts_fp ON job_posts (fp)', 'CREATE INDEX job_posts_seen ON job_posts (last_seen)', 'CREATE INDEX job_matches_uid ON job_matches (uid, state)', 'CREATE INDEX job_matches_job ON job_matches (job_id)', 'CREATE INDEX job_runs_status ON job_runs (status)', 'CREATE INDEX job_resumes_uid ON job_resumes (uid)', 'CREATE INDEX job_apps_uid ON job_apps (uid, created_at)', 'CREATE INDEX job_apps_job ON job_apps (job_id)'] as $q) { try { $p->exec($q); } catch (Throwable $e) { /* exists */ } }
    try { $p->exec("INSERT INTO job_lock (k, until_ms) VALUES ('run', 0)"); } catch (Throwable $e) { /* exists */ }
    try { if ($cur) $p->prepare("UPDATE meta SET v = ? WHERE k = 'jobs_schema'")->execute([JOB_SCHEMA]); else $p->prepare("INSERT INTO meta (k, v) VALUES ('jobs_schema', ?)")->execute([JOB_SCHEMA]); } catch (Throwable $e) { /* concurrent setup */ }
  }
  $ok = true; return $p;
}
function jkvGet(string $k, $def = null) { $s = jdb()->prepare('SELECT v FROM job_kv WHERE k = ?'); $s->execute([$k]); $r = $s->fetchColumn(); if ($r === false) return $def; $d = json_decode((string) $r, true); return $d ?? $def; }
function jkvSet(string $k, $v): void { jdb()->prepare('REPLACE INTO job_kv (k, v) VALUES (?, ?)')->execute([$k, json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]); }
function jenc($v): string { return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '[]'; }
function jdec(?string $s, $def = []) { $d = json_decode((string) $s, true); return is_array($d) ? $d : $def; }
function jobLock(int $ms = 90000): bool { $t = now(); $s = jdb()->prepare("UPDATE job_lock SET until_ms = ? WHERE k = 'run' AND until_ms < ?"); $s->execute([$t + $ms, $t]); return $s->rowCount() === 1; }
function jobLockRenew(int $ms = 90000): void { jdb()->prepare("UPDATE job_lock SET until_ms = ? WHERE k = 'run'")->execute([now() + $ms]); }
function jobUnlock(): void { jdb()->exec("UPDATE job_lock SET until_ms = 0 WHERE k = 'run'"); }

/* ---------- sources & settings ---------- */
function jobSources(): array {
  static $s = null; if ($s !== null) return $s;
  return $s = [
    'adzuna' => ['name' => 'Adzuna', 'kind' => 'search', 'def' => false, 'per_run' => 20, 'fields' => ['app_id' => ['App ID', false], 'app_key' => ['App key', true]], 'cost' => 'Free key', 'link' => 'https://developer.adzuna.com/signup', 'credit' => true,
      'about' => 'US job search engine that indexes thousands of job boards and company career sites. The best general source for on-site and hybrid roles anywhere in the US. Sign up for a free developer key (it has a daily search limit).'],
    'jooble' => ['name' => 'Jooble', 'kind' => 'search', 'def' => false, 'per_run' => 20, 'fields' => ['key' => ['API key', true]], 'cost' => 'Free key', 'link' => 'https://jooble.org/api/about', 'credit' => false,
      'about' => 'Aggregator that collects postings from many US job boards and says which board each one came from. Request a free API key on their site.'],
    'jsearch' => ['name' => 'JSearch (Google for Jobs)', 'kind' => 'search', 'def' => false, 'per_run' => 5, 'month_cap' => 150, 'fields' => ['key' => ['RapidAPI key', true]], 'cost' => 'Free tier, then paid', 'link' => 'https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch', 'credit' => false,
      'about' => 'Searches Google for Jobs, which lists postings from LinkedIn, Indeed, Dice, Monster, ZipRecruiter, Glassdoor and company sites, with a link to each board. The free plan allows a limited number of searches a month; set the monthly limit below to match your plan.'],
    'usajobs' => ['name' => 'USAJOBS', 'kind' => 'search', 'def' => false, 'per_run' => 6, 'fields' => ['key' => ['API key', true], 'email' => ['Email the key was issued to', false]], 'cost' => 'Free key', 'link' => 'https://developer.usajobs.gov/apirequest/', 'credit' => false,
      'about' => 'Official US federal government jobs. Free key by email.'],
    'remotive' => ['name' => 'Remotive', 'kind' => 'search', 'remote' => true, 'def' => true, 'per_run' => 6, 'fields' => [], 'cost' => 'Free, no key', 'link' => 'https://remotive.com', 'credit' => true,
      'about' => 'Remote jobs, mostly software and data. Listings link back to Remotive, as their terms require.'],
    'remoteok' => ['name' => 'Remote OK', 'kind' => 'feed', 'remote' => true, 'def' => true, 'per_run' => 1, 'fields' => [], 'cost' => 'Free, no key', 'link' => 'https://remoteok.com', 'credit' => true,
      'about' => 'Remote tech jobs. One feed per collection, filtered by your consultants\' titles. Listings link back to Remote OK, as their terms require.'],
    'himalayas' => ['name' => 'Himalayas', 'kind' => 'search', 'remote' => true, 'def' => true, 'per_run' => 6, 'fields' => [], 'cost' => 'Free, no key', 'link' => 'https://himalayas.app', 'credit' => true,
      'about' => 'Remote jobs worldwide; only roles open to US candidates are kept.'],
    'jobicy' => ['name' => 'Jobicy', 'kind' => 'search', 'remote' => true, 'def' => true, 'per_run' => 6, 'fields' => [], 'cost' => 'Free, no key', 'link' => 'https://jobicy.com', 'credit' => true,
      'about' => 'Remote jobs across many fields, filtered to the USA.'],
  ];
}
function jobSettings(): array {
  static $cache = null; if ($cache !== null) return $cache;
  $d = ['schedule_hours' => 6, 'max_age_days' => 7, 'keep_days' => 30, 'max_searches' => 20, 'min_score' => 45, 'sources' => [], 'feeds' => []];
  $s = jkvGet('settings', []); $s = (is_array($s) ? $s : []) + $d;
  foreach (jobSources() as $k => $m) {
    $c = is_array($s['sources'][$k] ?? null) ? $s['sources'][$k] : [];
    $base = ['on' => $m['def'], 'per_run' => $m['per_run']]; foreach ($m['fields'] as $fk => $_) $base[$fk] = '';
    if (isset($m['month_cap'])) $base['month_cap'] = $m['month_cap']; if ($k === 'adzuna') $base['country'] = 'us';
    $s['sources'][$k] = $c + $base;
  }
  $s['feeds'] = array_values(array_filter(is_array($s['feeds']) ? $s['feeds'] : [], fn($f) => is_array($f) && !empty($f['id'])));
  return $cache = $s;
}
function jobSettingsSave(array $s): void { jkvSet('settings', $s); }
function jobReady(string $k, array $c): bool { $m = jobSources()[$k] ?? null; if (!$m) return false; foreach ($m['fields'] as $fk => $_) if (trim((string) ($c[$fk] ?? '')) === '') return false; return true; }
function jobFeedCfg(array $set, string $id): ?array { foreach ($set['feeds'] as $f) if (($f['id'] ?? '') === $id) return $f; return null; }
function jobSourceName(string $src, ?array $set = null): string {
  if (str_starts_with($src, 'feed:')) { $f = jobFeedCfg($set ?? jobSettings(), substr($src, 5)); return $f ? (string) ($f['name'] ?: 'Feed') : 'Feed'; }
  return jobSources()[$src]['name'] ?? ucfirst($src);
}
function jobSourceStatus(string $src, string $error, int $n): void {
  $st = jkvGet('srcstat', []); $st = is_array($st) ? $st : [];
  $st[$src] = $error === '' ? ['ok_at' => now(), 'n' => $n, 'error' => '', 'err_at' => (int) ($st[$src]['err_at'] ?? 0)] : ['ok_at' => (int) ($st[$src]['ok_at'] ?? 0), 'n' => (int) ($st[$src]['n'] ?? 0), 'error' => mb_substr($error, 0, 300), 'err_at' => now()];
  jkvSet('srcstat', $st);
}
function jobCronKey(bool $regen = false): string { $k = (string) jkvGet('cron_key', ''); if ($k === '' || $regen) { $k = bin2hex(random_bytes(16)); jkvSet('cron_key', $k); } return $k; }
function jobCronInfo(): array {
  $cli = 'php ' . str_replace('\\', '/', __DIR__) . '/cron.php';
  $url = siteUrl() . 'api/index.php?r=jobs_cron&key=' . jobCronKey();
  return ['cli' => $cli, 'url' => $url, 'last' => (int) jkvGet('cron_seen', 0)];
}

/* ---------- small text helpers ---------- */
function jclean(string $s, int $max = 300): string { $s = htmlToText($s); $s = preg_replace('/\s+/u', ' ', $s) ?? $s; return mb_substr(trim($s), 0, $max); }
function jnorm(string $s): string { $s = mb_strtolower(trim($s)); $s = preg_replace('/[^a-z0-9]+/u', ' ', $s) ?? $s; return trim($s); }
function jtok(string $s): array {
  $s = mb_strtolower($s);
  $s = str_replace(['full stack', 'full-stack', 'front end', 'front-end', 'back end', 'back-end', 'dot net', '.net', 'c#', 'c++', 'node.js', 'react.js', 'vue.js', 's/4 hana', 's/4hana', 's4 hana', 'ui/ux', 'pl/sql', 'ci/cd', 'sr.', 'jr.', 'sr ', 'jr ', 'mlops', 'gen ai', 'machine learning', 'data science'],
    ['fullstack', 'fullstack', 'frontend', 'frontend', 'backend', 'backend', 'dotnet', ' dotnet', 'csharp', 'cpp', 'node', 'react', 'vue', 's4hana', 's4hana', 's4hana', 'ui ux', 'plsql', 'cicd', 'senior ', 'junior ', 'senior ', 'junior ', 'ai', 'ai', 'ai', 'ai'], $s);
  $s = preg_replace('/[^a-z0-9+#]+/u', ' ', $s) ?? $s; $out = [];
  foreach (explode(' ', $s) as $w) { if ($w === '') continue; $w = JOB_TOKEN_MAP[$w] ?? $w; $out[$w] = 1; }
  return array_keys($out);
}
function jtokCore(string $q): array { $t = array_values(array_diff(jtok($q), JOB_ROLE_TOKENS, JOB_NEUTRAL_TOKENS)); if (!$t) $t = array_values(array_diff(jtok($q), JOB_NEUTRAL_TOKENS)); return $t; }
function jago(int $ms): string {
  if ($ms <= 0) return '';
  $d = (int) floor((now() - $ms) / 86400000);
  return $d <= 0 ? 'today' : ($d === 1 ? 'yesterday' : ($d < 30 ? "$d days ago" : ($d < 60 ? 'a month ago' : (int) floor($d / 30) . ' months ago')));
}
function jsalary(?float $min, ?float $max, string $period, string $cur = 'USD'): string {
  $min = $min && $min > 0 ? $min : null; $max = $max && $max > 0 ? $max : null; if ($min === null && $max === null) return '';
  if (max($min ?? 0, $max ?? 0) < 1000 && !str_contains(strtolower($period), 'hour') && !str_contains(strtolower($period), 'day')) $period = 'hour'; // a few sources label hourly rates as yearly
  $per = str_contains(strtolower($period), 'hour') || strtolower($period) === 'ph' ? 'hr' : (str_contains(strtolower($period), 'month') ? 'mo' : (str_contains(strtolower($period), 'week') ? 'wk' : (str_contains(strtolower($period), 'day') ? 'day' : 'yr')));
  $f = function (float $v) use ($cur): string { $p = ($cur === 'USD' || $cur === '') ? '$' : $cur . ' '; if ($v >= 1000) { $k = $v / 1000; return $p . (abs($k - round($k)) < 0.05 ? (string) (int) round($k) : number_format($k, 1)) . 'k'; } return $p . (abs($v - round($v)) < 0.005 ? (string) (int) round($v) : number_format($v, 2)); };
  if ($min !== null && $max !== null && $max > $min) return $f($min) . '–' . $f($max) . '/' . $per;
  return $f($min ?? $max) . '/' . $per;
}
function jlocParse(string $s): array {
  $o = ['city' => '', 'state' => '', 'stateName' => '', 'label' => jclean($s, 80), 'remote' => false, 'us' => false];
  $t = trim(preg_replace('/\s+/', ' ', $o['label']) ?? ''); if ($t === '') return $o;
  if (preg_match('/\b(remote|anywhere|work from home|wfh)\b/i', $t)) $o['remote'] = true;
  if (preg_match('/\b(united states|usa|u\.s\.a?|us)\b/i', $t)) $o['us'] = true;
  if (preg_match('/(?:,|\s)\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*(?:,\s*(?:us|usa|united states))?\s*$/i', $t, $m) && isset(US_STATES[strtoupper($m[1])]) && strtoupper($m[1]) !== 'US') $o['state'] = strtoupper($m[1]);
  elseif (preg_match('/^([A-Z]{2})$/i', $t, $m) && isset(US_STATES[strtoupper($m[1])])) $o['state'] = strtoupper($m[1]);
  else { static $names = null; if ($names === null) { $names = US_STATES; uasort($names, fn($a, $b) => strlen($b) <=> strlen($a)); } foreach ($names as $code => $name) if (preg_match('/\b' . preg_quote($name, '/') . '\b/i', $t)) { $o['state'] = $code; break; } }
  $o['stateName'] = US_STATES[$o['state']] ?? '';
  $city = trim(explode(',', $t)[0]); $city = preg_replace('/\s+(metro|area|metropolitan area|county)$/i', '', $city) ?? $city;
  if ($city !== '' && $o['state'] !== '' && strcasecmp($city, $o['stateName']) !== 0 && !preg_match('/^(remote|united states|usa|us|anywhere|multiple locations|various)$/i', $city) && mb_strlen($city) <= 40 && !preg_match('/\d{5}/', $city)) $o['city'] = mb_strtolower($city);
  if ($o['state'] !== '') $o['us'] = true;
  return $o;
}
function jboard(string $s): string {
  $l = strtolower(trim($s)); $l = preg_replace('#^https?://(www\.)?#', '', $l) ?? $l;
  static $map = ['linkedin' => 'LinkedIn', 'indeed' => 'Indeed', 'dice' => 'Dice', 'monster' => 'Monster', 'ziprecruiter' => 'ZipRecruiter', 'glassdoor' => 'Glassdoor', 'careerbuilder' => 'CareerBuilder', 'simplyhired' => 'SimplyHired', 'snagajob' => 'Snagajob', 'usajobs' => 'USAJOBS', 'builtin' => 'Built In', 'wellfound' => 'Wellfound', 'talent.com' => 'Talent.com', 'jooble' => 'Jooble', 'adzuna' => 'Adzuna', 'lensa' => 'Lensa', 'jobright' => 'Jobright', 'techfetch' => 'TechFetch', 'clearancejobs' => 'ClearanceJobs', 'remoteok' => 'Remote OK', 'remotive' => 'Remotive', 'himalayas' => 'Himalayas', 'jobicy' => 'Jobicy', 'workday' => 'Workday', 'greenhouse' => 'Greenhouse', 'lever' => 'Lever', 'icims' => 'iCIMS', 'teksystems' => 'TEKsystems', 'roberthalf' => 'Robert Half', 'insight global' => 'Insight Global', 'randstad' => 'Randstad'];
  foreach ($map as $k => $v) if (str_contains($l, $k)) return $v;
  return mb_substr(trim($s), 0, 60);
}

/* ---------- skills dictionary ---------- */
function jobSkillDict(): string { // 'Canonical: alias, alias' ; aliases starting with = are case-sensitive
  return <<<'TXT'
Java: java, core java, java 8, java 11, java 17, java 21
J2EE: j2ee, java ee, jakarta ee, jee
Spring Boot: spring boot, springboot
Spring: spring framework, spring mvc, spring core, spring batch, spring security, spring cloud, spring data
Hibernate: hibernate, jpa
Microservices: microservices, micro services, microservice
Kotlin
Scala
Python: python, python3
Django
Flask
FastAPI
C#: c#, c sharp, csharp
.NET: .net, dotnet, dot net, .net framework
.NET Core: .net core, asp.net core, .net 6, .net 8
ASP.NET: asp.net, asp.net mvc, asp.net web api
Entity Framework: entity framework, ef core
C++: c++, cpp, c/c++
C: c programming, ansi c, embedded c
Go: golang, go lang, go language, go programming
Rust
Ruby
Ruby on Rails: ruby on rails, rails, ror
PHP
Laravel
Node.js: node.js, nodejs, node js
Express.js: express.js, expressjs
JavaScript: javascript, java script, es6, ecmascript
TypeScript
React: react, react.js, reactjs
React Native: react native
Angular: angular, angularjs, angular.js
Vue.js: vue, vue.js, vuejs
Next.js: next.js, nextjs
Redux
HTML: html, html5
CSS: css, css3
SASS: sass, scss
Tailwind CSS: tailwind, tailwind css
Bootstrap
jQuery
GraphQL
REST APIs: rest api, rest apis, restful, restful api, restful apis, restful services, rest services, restful web services, web services
SOAP: soap, soap web services
JSON
XML
Swift
iOS: =iOS
Objective-C: objective-c, objective c
Android
Flutter
Dart
Xamarin
Perl
COBOL
Mainframe: mainframe, z/os, zos
JCL
DB2
CICS
VB.NET: vb.net, visual basic, vba
MATLAB
Groovy
Shell scripting: shell scripting, shell script, shell scripts, bash, ksh, unix shell
PowerShell
SQL
NoSQL
PL/SQL: pl/sql, plsql
T-SQL: t-sql, tsql
MySQL
PostgreSQL: postgresql, postgres
Oracle: oracle, oracle database, oracle db, oracle 19c, oracle 12c, oracle 11g, oracle sql
SQL Server: sql server, mssql, ms sql
MongoDB: mongodb, mongo db
Cassandra
Redis
DynamoDB
Elasticsearch: elasticsearch, elastic search, opensearch
Snowflake
Databricks
Apache Spark: spark, apache spark, spark sql
PySpark
Hadoop: hadoop, hdfs, mapreduce
Hive
Kafka: kafka, apache kafka
Airflow: airflow, apache airflow
dbt
ETL: etl, elt, data pipelines, data pipeline
Informatica: informatica, informatica powercenter, iics
Talend
SSIS
SSRS
SSAS
Power BI: power bi, powerbi
Tableau
Looker
Qlik: qlik, qlikview, qlik sense
Data Warehousing: data warehouse, data warehousing, dwh
Data Modeling: data modeling, data modelling, dimensional modeling
Data Analysis: data analysis, data analytics
Machine Learning: machine learning, ml models
Deep Learning
TensorFlow
PyTorch
scikit-learn: scikit-learn, sklearn
NLP: nlp, natural language processing
Computer Vision
Generative AI: generative ai, genai, gen ai, llm, llms, large language models, prompt engineering, langchain, rag, agentic ai
Pandas
NumPy
Azure Data Factory: azure data factory, adf
Azure Synapse: azure synapse, synapse analytics
Redshift
BigQuery
AWS Glue: aws glue
AWS EMR: aws emr, amazon emr, elastic mapreduce
AWS: aws, amazon web services
EC2
S3
AWS Lambda: aws lambda, lambda functions
CloudFormation
Azure: azure, microsoft azure
GCP: gcp, google cloud, google cloud platform
Terraform
Ansible
Puppet
Chef
Docker
Kubernetes: kubernetes, k8s, aks, eks, gke
OpenShift
Helm
Jenkins
GitLab CI: gitlab, gitlab ci
GitHub Actions
Azure DevOps: azure devops, vsts, tfs
CI/CD: ci/cd, ci cd, cicd, continuous integration, continuous delivery, continuous deployment
Git: git, github, bitbucket
Maven
Gradle
Tomcat: tomcat, apache tomcat
WebLogic
WebSphere
JBoss
Linux: linux, rhel, red hat, centos, ubuntu
Unix
Windows Server
VMware: vmware, vsphere, esxi
Hyper-V
Prometheus
Grafana
ELK: elk, elk stack, kibana, logstash
Splunk
Datadog
Dynatrace
New Relic
AppDynamics
Nagios
ArgoCD: argocd, argo cd
Site Reliability Engineering: sre, site reliability
DevOps
Selenium: selenium, selenium webdriver
Cypress
Playwright
Appium
JUnit
TestNG
PyTest
Cucumber: cucumber, bdd, gherkin
JMeter
LoadRunner
Postman
SoapUI
UFT: uft, qtp
Manual Testing: manual testing
Test Automation: test automation, automation testing, automated testing
API Testing: api testing
Performance Testing: performance testing, load testing
Salesforce: salesforce, sfdc, salesforce.com
Apex
Lightning Web Components: lwc, lightning web components, salesforce lightning
Visualforce
ServiceNow: servicenow, service now
Workday
Oracle Fusion: oracle fusion, oracle cloud erp, oracle erp cloud
Oracle EBS: oracle ebs, oracle e-business suite, oracle apps, oracle applications
PeopleSoft
Microsoft Dynamics: microsoft dynamics, dynamics 365, d365, dynamics crm, dynamics ax, navision, business central
SharePoint
Power Apps: power apps, powerapps
Power Automate: power automate, microsoft flow
MuleSoft: mulesoft, mule esb, anypoint
Boomi: boomi, dell boomi
TIBCO
Guidewire: guidewire, policycenter, claimcenter, billingcenter
Duck Creek
Pega: pega, pegasystems, pega prpc
Appian
UiPath
Blue Prism
Automation Anywhere
RPA: rpa, robotic process automation
Adobe AEM: aem, adobe experience manager
Sitecore
Shopify
Magento
WordPress
Jira
Confluence
SAP
S/4HANA: s/4hana, s4hana, s/4 hana, s4 hana
SAP HANA: sap hana, hana
SAP Fiori: fiori, sap fiori, sapui5, ui5
SAP SuccessFactors: successfactors, sap successfactors
SAP Ariba: ariba, sap ariba
SAP BTP: sap btp, btp
SAP CPI: sap cpi, sap integration suite
SAP PI/PO: sap pi, sap po, sap pi/po, sap xi
SAP ABAP: abap, sap abap
SAP Basis: sap basis, basis administration
SAP FICO: sap fico, fico, fi/co, sap fi, sap co, sap finance, s/4hana finance
SAP MM: sap mm
SAP SD: sap sd
SAP PP: sap pp
SAP QM: sap qm
SAP PM: sap pm, sap plant maintenance
SAP PS: sap ps
SAP WM: sap wm
SAP EWM: sap ewm, ewm
SAP HCM: sap hcm, sap hr
SAP BW: sap bw, bw/4hana, sap bi
SAP BusinessObjects: business objects, businessobjects, sap bo, sap bods
SAP CRM: sap crm
SAP GRC: sap grc
SAP Security: sap security
SAP IBP: sap ibp
SAP APO: sap apo
SAP TM: sap tm
SAP MDG: sap mdg
SAP Analytics Cloud: sap analytics cloud
ERP
CRM
Cisco: cisco, cisco ios, =IOS, ios-xe, nx-os, cisco routers, cisco switches
Juniper
Palo Alto: palo alto, palo alto networks, panorama
Fortinet: fortinet, fortigate
Check Point: checkpoint, check point
F5: f5, f5 ltm, big-ip
Arista
Cisco ACI: aci, cisco aci
Cisco Nexus: nexus, nexus 9k, nexus 7k
Cisco Meraki: meraki
Aruba
Infoblox
SolarWinds
Wireshark
BGP
OSPF
EIGRP
MPLS
SD-WAN: sd-wan, sdwan, viptela, velocloud
VLAN: vlan, vlans
VPN: vpn, ipsec, ssl vpn
Firewalls: firewall, firewalls
Load Balancing: load balancing, load balancer, load balancers
TCP/IP: tcp/ip
DNS
DHCP
LAN/WAN: lan, wan, lan/wan
Wireless: wireless, wlan, wi-fi, wifi
Routing and Switching: routing and switching, routing & switching, routing protocols, switching
Network Security: network security
CCNA
CCNP
CCIE
Network Automation: network automation, netmiko, napalm
Active Directory: active directory, ad ds
Azure AD: azure ad, entra id, azure active directory
Okta
CyberArk
SailPoint
IAM: iam, identity and access management, identity management
SIEM
SOC: security operations center, soc analyst
Penetration Testing: penetration testing, pen testing, pentest
Vulnerability Management: vulnerability management, vulnerability assessment
Nessus
Qualys
CrowdStrike
NIST
ISO 27001
SOC 2: soc 2, soc2
HIPAA
PCI DSS: pci, pci dss, pci-dss
CISSP
CISM
CEH
Security+: security+, comptia security+
Zero Trust
Cybersecurity: cybersecurity, cyber security, information security, infosec
Business Analysis: business analysis, business analyst
Requirements Gathering: requirements gathering, requirement gathering, requirements elicitation
Agile
Scrum
Kanban
SAFe: safe agile, scaled agile, safe framework, =SAFe
Waterfall
PMP
Scrum Master: scrum master, certified scrum master
Product Owner: product owner, cspo
Project Management: project management, project manager
Program Management: program management
Stakeholder Management
UAT: uat, user acceptance testing
BRD: brd, frd, business requirements document
User Stories: user stories, user story
Visio: visio, ms visio
MS Project: ms project, microsoft project
Change Management: change management
Risk Management: risk management
ITIL
ITSM
Help Desk: help desk, helpdesk, service desk
Desktop Support: desktop support
Office 365: office 365, o365, microsoft 365, m365
Intune
SCCM: sccm, mecm
Exchange Server: exchange server, exchange online, ms exchange
Citrix
Excel: excel, ms excel, microsoft excel, advanced excel, vlookup, pivot tables, pivot table
SAS: sas, base sas, sas programming
R: r programming, rstudio, r language
Accounting: accounting, accountant
GAAP: gaap, us gaap
IFRS
Accounts Payable: accounts payable, a/p
Accounts Receivable: accounts receivable, a/r
General Ledger: general ledger
Reconciliation: reconciliation, reconciliations, account reconciliation, bank reconciliation
Month-End Close: month-end close, month end close, month-end, year-end close, financial close
Financial Reporting: financial reporting, financial statements
Financial Analysis: financial analysis
FP&A: fp&a, financial planning and analysis, financial planning & analysis
Budgeting
Forecasting
Variance Analysis
Audit: auditing, internal audit, external audit, it audit, audit and assurance
Tax: taxation, tax preparation, tax returns, tax accounting, sales tax, tax compliance
Payroll
QuickBooks: quickbooks, quick books
NetSuite
Xero
Sage: sage intacct, sage 50, sage 100
Hyperion: hyperion, oracle hyperion, essbase
Oracle Financials
CPA
CMA
SOX: sox, sarbanes-oxley, sox compliance
Cost Accounting
Billing: billing, invoicing
Collections: debt collection, collections management, ar collections
Registered Nurse: registered nurse, rn
LPN: lpn, licensed practical nurse
CNA: cna, certified nursing assistant
BLS
ACLS
PALS
ICU: icu, intensive care
Med-Surg: med-surg, med surg, medical-surgical, medical surgical
Emergency Department: emergency room, emergency department
Telemetry
Patient Care: patient care
EMR/EHR: emr, ehr, electronic medical records, electronic health records
Epic: epic systems, epic ehr, epic certified, epic ambulatory, epic clindoc, epic cadence, epic willow, epic beaker, epic resolute, epic tapestry, epic bridges, epic prelude, epic orders, epic optime, epic asap, epic radiant, epic clarity, epic caboodle
Cerner
Meditech
HL7: hl7, hl7 v2
FHIR
Medical Coding: medical coding, medical coder
ICD-10: icd-10, icd 10, icd10
CPT Coding: cpt coding, cpt codes, cpt-4
HCPCS
Medical Billing: medical billing
Revenue Cycle: revenue cycle, rcm
Claims: claims processing, claims adjudication, claims management
Pharmacy: pharmacy, pharmacist
Clinical Research: clinical research, clinical trials
Case Management: case management, case manager
Utilization Review: utilization review, utilization management
Phlebotomy
Six Sigma: six sigma, lean six sigma
UI/UX: ui/ux, ux design, ui design, user experience
Figma
Adobe XD
Photoshop
Technical Writing: technical writing, technical writer
TXT;
}
function jobSkillIndex(): array { // [regex (case-insensitive), regex (case-sensitive), normalized alias => canonical]
  static $idx = null; if ($idx !== null) return $idx;
  $map = []; $mapCs = []; $ci = []; $cs = [];
  foreach (preg_split('/\R/', jobSkillDict()) as $line) {
    $line = trim($line); if ($line === '') continue;
    [$canon, $rest] = array_pad(explode(':', $line, 2), 2, null);
    $canon = trim($canon); $aliases = $rest === null ? [strtolower($canon)] : array_map('trim', explode(',', $rest));
    foreach ($aliases as $a) {
      if ($a === '') continue; $sens = $a[0] === '='; if ($sens) $a = substr($a, 1);
      if ($sens) $mapCs[jskillKey($a, true)] = $canon; else $map[jskillKey($a)] = $canon;
      $parts = array_map(fn($w) => str_replace('/', '\s*/\s*', preg_quote($w, '~')), preg_split('/[\s\-]+/', $a) ?: []);
      $re = implode('[\s\-_]*', $parts);
      if ($sens) $cs[] = $re; else $ci[] = $re;
    }
  }
  $sort = function (array $l): array { usort($l, fn($a, $b) => strlen($b) <=> strlen($a)); return $l; };
  $b1 = '(?<![A-Za-z0-9+#])'; $b2 = '(?![A-Za-z0-9+#])';
  return $idx = ['ci' => '~' . $b1 . '(' . implode('|', $sort($ci)) . ')' . $b2 . '~iu', 'cs' => $cs ? '~' . $b1 . '(' . implode('|', $sort($cs)) . ')' . $b2 . '~u' : '', 'map' => $map, 'map_cs' => $mapCs ?? []];
}
function jskillKey(string $a, bool $keepCase = false): string { $a = str_replace(' / ', '/', $keepCase ? $a : strtolower($a)); return preg_replace('/[\s\-_]+/', '', $a) ?? $a; }
function skillsIn(string $text, int $max = 80): array {
  $i = jobSkillIndex(); $found = []; $text = mb_substr($text, 0, 60000);
  if (preg_match_all($i['ci'], $text, $m)) foreach ($m[1] as $hit) { $c = $i['map'][jskillKey($hit)] ?? null; if ($c !== null) $found[$c] = ($found[$c] ?? 0) + 1; }
  if ($i['cs'] !== '' && preg_match_all($i['cs'], $text, $m)) foreach ($m[1] as $hit) { $c = $i['map_cs'][jskillKey($hit, true)] ?? null; if ($c !== null) $found[$c] = ($found[$c] ?? 0) + 1; }
  if (preg_match_all('/\bSAP\s*[-–]?\s*((?:FI\s*\/\s*CO|FICO|[A-Z]{2,5})(?:\s*(?:\/|,|&|and)\s*(?:FI\s*\/\s*CO|FICO|[A-Z]{2,5}))*)/', $text, $sm)) { // "SAP PP/QM", "SAP MM, SD and FICO"
    static $mods = ['FI' => 'SAP FICO', 'CO' => 'SAP FICO', 'FICO' => 'SAP FICO', 'MM' => 'SAP MM', 'SD' => 'SAP SD', 'PP' => 'SAP PP', 'QM' => 'SAP QM', 'PM' => 'SAP PM', 'PS' => 'SAP PS', 'WM' => 'SAP WM', 'EWM' => 'SAP EWM', 'HCM' => 'SAP HCM', 'HR' => 'SAP HCM', 'BW' => 'SAP BW', 'BI' => 'SAP BW', 'BO' => 'SAP BusinessObjects', 'CRM' => 'SAP CRM', 'ABAP' => 'SAP ABAP', 'BASIS' => 'SAP Basis', 'HANA' => 'SAP HANA', 'GRC' => 'SAP GRC', 'BTP' => 'SAP BTP', 'CPI' => 'SAP CPI', 'PI' => 'SAP PI/PO', 'PO' => 'SAP PI/PO', 'IBP' => 'SAP IBP', 'APO' => 'SAP APO', 'TM' => 'SAP TM', 'MDG' => 'SAP MDG', 'FSCM' => 'SAP FICO', 'SAC' => 'SAP Analytics Cloud'];
    foreach ($sm[1] as $grp) foreach (preg_split('/\s*(?:\/|,|&|and)\s*/', $grp) ?: [] as $code) { $code = strtoupper(str_replace(' ', '', $code)); if ($code === 'FI/CO') $code = 'FICO'; if (isset($mods[$code])) $found[$mods[$code]] = ($found[$mods[$code]] ?? 0) + 1; }
  }
  arsort($found); return array_slice(array_keys($found), 0, $max);
}
function skillsCanon(array $list): array { // user-typed skills → canonical names where known, else as typed
  $i = jobSkillIndex(); $out = [];
  foreach ($list as $s) { $s = trim((string) $s); if ($s === '') continue; $c = $i['map'][jskillKey($s)] ?? null; if ($c === null) { $f = skillsIn($s, 3); $c = count($f) === 1 ? $f[0] : mb_substr($s, 0, 40); } $out[$c] = 1; }
  return array_keys($out);
}

/* ---------- resume profile ---------- */
function resumeProfile(string $text, string $fallbackLoc = ''): array {
  $lines = array_values(array_filter(array_map('trim', preg_split('/\R/u', $text) ?: []), fn($l) => $l !== ''));
  $years = resumeYears($text);
  return ['titles' => resumeTitles($lines), 'skills' => skillsIn($text), 'years' => $years, 'seniority' => $years === null ? '' : ($years >= 12 ? 'Lead' : ($years >= 7 ? 'Senior' : ($years >= 3 ? 'Mid-level' : 'Junior'))), 'location' => resumeLocation($lines) ?: $fallbackLoc, 'chars' => mb_strlen($text)];
}
function resumeTitles(array $lines): array {
  $roles = 'developer|engineer|programmer|consultant|analyst|architect|administrator|admin|manager|lead|specialist|tester|scientist|designer|nurse|accountant|coordinator|technician|director|owner|dba|sre|sdet|auditor|controller|bookkeeper|recruiter|officer|expert|associate|practitioner|therapist|pharmacist|technologist|supervisor|executive|strategist|writer';
  $stop = ['as', 'a', 'an', 'the', 'and', 'with', 'for', 'to', 'in', 'at', 'on', 'of', 'worked', 'working', 'work', 'experienced', 'experience', 'years', 'year', 'yrs', 'role', 'title', 'position', 'designation', 'currently', 'seeking', 'is', 'am', 'i', 'my', 'our', 'their', 'from', 'by', 'or', 'be', 'been', 'being', 'was', 'were', 'hiring', 'reporting', 'direct', 'line', 'any', 'all', 'new', 'per', 'via', 'under', 'into', 'that', 'this', 'which', 'skilled', 'certified', 'professional', 'profile', 'summary', 'objective', 'resume', 'cv', 'name', 'client', 'company', 'project', 'projects', 'team', 'teams', 'duration', 'location', 'environment', 'responsibilities', 'description'];
  $acr = ['sap', 'aws', 'qa', 'ui', 'ux', 'it', 'erp', 'crm', 'sql', 'etl', 'bi', 'hr', 'mm', 'sd', 'pp', 'qm', 'fico', 'fi', 'co', 'pm', 'ps', 'abap', '.net', 'rn', 'lpn', 'cna', 'dba', 'sre', 'sdet', 'ai', 'ml', 'ios', 'api', 'gcp', 'ba', 'ssis', 'ssrs', 'sas', 'php', 'css', 'html', 'js', 'rpa', 'iam', 'soc', 'siem', 'cpa', 'cma', 'icu', 'er', 'ehr', 'emr', 'hl7', 'uat', 'sap', 'bw', 'hana', 'ewm', 'hcm', 'crm', 'wms', 'tms', 'edi', 'iot', 'nlp', 'devops', 'mlops', 'c#', 'c++', 'ci/cd', 'db2', 'cobol', 'jcl', 'pega', 'uipath', 'aem', 'mulesoft', 'gis', 'cad', 'plc', 'scada', 'oss', 'bss', 'voip', 'lan', 'wan', 'vmware', 'linux', 'unix', 'sql', 'nosql', 'php', 'ios', 'ux/ui', 'ui/ux', 'pp/qm', 'fi/co', 'mm/sd', 'sd/mm', 'ar', 'ap', 'gl', 'fp&a', 'hris'];
  $cand = []; $n = count($lines);
  foreach (array_slice($lines, 0, 160) as $li => $line) {
    $labelled = (bool) preg_match('/^(role|title|position|designation|job title|current role|current title|profile)\s*[:\-–]/i', $line);
    $clean = preg_replace('/^(role|title|position|designation|job title|current role|current title|profile)\s*[:\-–]\s*/i', '', $line) ?? $line;
    $segs = preg_split('/\s*(?:\||,|;|•|·|–|—|\(|\)|\/\s|\s\/|\bat\b|\bfor\b|\bwith\b|\bin\b|\bsince\b|\bfrom\b|:|\s-\s|\s\d{4}\b|\d{2}\/\d{4})\s*/i', $clean) ?: [];
    foreach ($segs as $seg) {
      $seg = trim($seg); if ($seg === '' || mb_strlen($seg) > 80) continue;
      if (!preg_match('/\b(' . $roles . ')s?\b\.?$/i', $seg)) { if (!preg_match('/\b(' . $roles . ')s?\b/i', $seg, $rm, PREG_OFFSET_CAPTURE)) continue; $seg = trim(substr($seg, 0, $rm[0][1] + strlen($rm[0][0]))); }
      $words = preg_split('/\s+/', $seg) ?: []; $words = array_slice($words, -7);
      while ($words && (in_array(strtolower(trim($words[0], ".,:;-")), $stop, true) || preg_match('/^\d+\+?$/', $words[0]) || preg_match('/^[^A-Za-z.#+]/', $words[0]))) array_shift($words);
      $t = implode(' ', $words); if (count($words) < 2 || count($words) > 6) continue;
      if (preg_match('/\b(hiring|reporting|line|direct|project|account) manager$/i', $t) && !preg_match('/\b(technical|it|program|product|engineering|delivery) /i', $t)) { if (!preg_match('/^(project|account|product|program|engineering|delivery|it|technical)\s/i', $t)) continue; }
      if (preg_match('/\b(sap|net|java|cloud|data|business|network|software|systems?|security|qa|test|web|full|front|back|devops|salesforce|servicenow|oracle|erp|sr|senior|junior|lead|staff|principal|registered|clinical|financial|accounts?|tax|project|product|technical|it|ui|ux|ai|ml|python|react|angular|azure|aws|mainframe|database|infrastructure|solution|solutions|enterprise|application|applications|integration|platform|site|reliability|mobile|ios|android|embedded|firmware|hardware|electrical|mechanical|civil|quality|automation|performance|release|build|scrum|agile|program|portfolio|change|service|support|help|desk|desktop|cyber|information|informatica|etl|bi|reporting|analytics|machine|learning|nlp|genai|generative|staff|med|surg|icu|er|travel|charge|nurse|pharmacy|lab|medical|healthcare|revenue|billing|coding|claims|payroll|bookkeeping|cost|controller|fp&a|treasury|audit|compliance|risk|sox|credit|collections|hr|hris|recruiting|talent|marketing|sales|customer|operations|supply|chain|logistics|procurement|warehouse|manufacturing|plant|process|design|graphic|content|technical|writer|game|unity|blockchain|golang|rust|kotlin|swift|dotnet|c#|c\+\+|php|ruby|scala|spark|kafka|snowflake|tableau|power|microsoft|dynamics|workday|peoplesoft|guidewire|pega|mulesoft|boomi|tibco|epic|cerner|hl7|fhir|citrix|vmware|linux|unix|windows|exchange|sharepoint|identity|access|okta|sailpoint|cyberark|splunk|siem|soc|pen|vulnerability|network|wireless|voice|voip|firewall|load|cisco|juniper|palo|f5|aci|bgp|mpls|sd-wan|cloud|kubernetes|docker|terraform|ansible|jenkins|release|site)\b/i', $t) === 0 && count($words) === 2 && !preg_match('/\b(analyst|consultant|architect|nurse|accountant|recruiter|auditor|controller|bookkeeper|pharmacist|therapist)$/i', $t)) continue;
      $key = preg_replace('/\s+/', ' ', str_replace(['sr. ', 'sr ', 'jr. ', 'jr ', 'fi/co', 'full-stack', 'full stack'], ['senior ', 'senior ', 'junior ', 'junior ', 'fico', 'fullstack', 'fullstack'], strtolower($t) . ' ')) ?? '';
      $key = trim(preg_replace('/s$/', '', trim($key, " .")) ?? $key);
      $w = 1 + ($li < 8 ? 4 : ($li < 25 ? 1 : 0)) + ($labelled ? 3 : 0) + (count(preg_split('/\s+/', $clean) ?: []) <= 7 ? 2 : 0);
      if (!isset($cand[$key])) $cand[$key] = ['w' => 0, 't' => $t, 'first' => $li]; $cand[$key]['w'] += $w;
    }
  }
  uasort($cand, fn($a, $b) => $b['w'] <=> $a['w'] ?: $a['first'] <=> $b['first']);
  $out = []; $seen = [];
  foreach ($cand as $k => $c) {
    $base = preg_replace('/^(senior|junior|lead|principal|staff|associate) /', '', $k) ?? $k; if (isset($seen[$base])) continue; $seen[$base] = 1;
    $t = $c['t'];
    if (strtoupper($t) === $t) $t = implode(' ', array_map(fn($w) => in_array(strtolower($w), $acr, true) ? strtoupper($w) : (strlen($w) <= 3 && ctype_upper($w) ? $w : ucfirst(strtolower($w))), explode(' ', $t)));
    $out[] = trim($t, " .,"); if (count($out) >= 3) break;
  }
  return $out;
}
function resumeYears(string $t): ?int {
  $best = null;
  if (preg_match_all('/(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)\b[^.\n]{0,40}?\bexperience/i', $t, $m)) foreach ($m[1] as $v) { $v = (float) $v; if ($v >= 1 && $v <= 45) $best = max($best ?? 0, $v); }
  if (preg_match_all('/experience\s+of\s+(?:over\s+|about\s+|around\s+|more than\s+)?(\d{1,2})\s*\+?\s*(?:years?|yrs?)/i', $t, $m)) foreach ($m[1] as $v) { $v = (float) $v; if ($v >= 1 && $v <= 45) $best = max($best ?? 0, $v); }
  if ($best === null && preg_match_all('/\b(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+|\d{1,2}\/)?((?:19|20)\d{2})\s*(?:-|–|—|to|till|until)\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+|\d{1,2}\/)?((?:19|20)\d{2}|present|current|now|till date|date|today)/i', $t, $m)) {
    $starts = [];
    foreach ($m[1] as $i => $s) { $e = strtolower($m[2][$i]); $endY = ctype_digit($e) ? (int) $e : (int) date('Y'); if ($endY >= (int) $s && $endY - (int) $s <= 25) $starts[] = (int) $s; }
    if ($starts) { $y = (int) date('Y') - min($starts); if ($y >= 1 && $y <= 45) $best = $y; }
  }
  return $best === null ? null : (int) round($best);
}
function resumeLocation(array $lines): string {
  static $names = null; if ($names === null) { $names = array_values(US_STATES); usort($names, fn($a, $b) => strlen($b) <=> strlen($a)); }
  $codes = '(?:' . implode('|', array_keys(US_STATES)) . ')';
  foreach (array_slice($lines, 0, 15) as $l) {
    if (preg_match('/\b([A-Z][a-zA-Z.\'-]+(?:\s+[A-Z][a-zA-Z.\'-]+){0,2}),\s*(' . $codes . ')\b(?!\w)/', $l, $m) && !preg_match('/^(RN|LPN|CNA|MBA|PMP|CPA|PE|MD|DO)$/', $m[2])) return $m[1] . ', ' . $m[2];
    if (preg_match('/\b([A-Z][a-zA-Z.\'-]+(?:\s+[A-Z][a-zA-Z.\'-]+){0,2}),\s*(' . implode('|', array_map(fn($n) => preg_quote($n, '/'), $names)) . ')\b/', $l, $m)) return $m[1] . ', ' . array_search($m[2], US_STATES, true);
  }
  foreach ($lines as $l) if (preg_match('/^(?:location|address|current location|based in|city)\s*[:\-–]\s*(.{3,60})$/i', $l, $m)) return trim($m[1], " .");
  foreach (array_slice($lines, 0, 15) as $l) if (preg_match('/\b(' . $codes . ')\s+\d{5}\b/', $l, $m)) return $m[1];
  return '';
}

/* ---------- HTTP ---------- */
function jhttp(string $method, string $url, array $headers = [], ?string $body = null, int $timeout = 15): array {
  $hasUa = false; foreach ($headers as $h) if (stripos($h, 'user-agent:') === 0) $hasUa = true;
  $ua = 'Mozilla/5.0 (compatible; StratEdgeJobs/1.0; +' . (string) (cfg('site_url') ?: 'https://stratedgeitconsulting.com') . ')';
  if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 3, CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 7, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_ENCODING => '', CURLOPT_HTTPHEADER => array_merge(['Accept: application/json, application/xml;q=0.9, */*;q=0.5'], $headers)]);
    if (!$hasUa) curl_setopt($ch, CURLOPT_USERAGENT, $ua);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $raw = curl_exec($ch); $st = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE); $err = (string) curl_error($ch); curl_close($ch);
    return ['status' => $raw === false ? 0 : $st, 'body' => $raw === false ? '' : (string) $raw, 'error' => $err];
  }
  $ctx = stream_context_create(['http' => ['method' => $method, 'header' => implode("\r\n", array_merge($hasUa ? [] : ["User-Agent: $ua"], ['Accept: application/json, */*;q=0.5'], $headers)), 'content' => $body ?? '', 'timeout' => $timeout, 'ignore_errors' => true, 'follow_location' => 1]]);
  $raw = @file_get_contents($url, false, $ctx); $st = 0;
  foreach ((array) ($http_response_header ?? []) as $h) if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) $st = (int) $m[1];
  return ['status' => $raw === false ? 0 : $st, 'body' => (string) $raw, 'error' => $raw === false ? 'connection failed' : ''];
}

/* ---------- source requests and parsers ---------- */
function jobRequest(string $src, array $q, array $cfg): array {
  $kw = trim((string) $q['q']); $loc = trim((string) ($q['loc'] ?? '')); $remote = (string) ($q['remote'] ?? 'any'); $days = max(1, (int) ($q['days'] ?? 7));
  if ($remote === 'remote') $loc = '';
  switch ($src) {
    case 'adzuna': {
      $p = ['app_id' => $cfg['app_id'], 'app_key' => $cfg['app_key'], 'results_per_page' => 50, 'what' => $kw . ($remote === 'remote' ? ' remote' : ''), 'max_days_old' => $days, 'content-type' => 'application/json'];
      if ($loc !== '') { $p['where'] = $loc; $p['distance'] = 60; }
      return ['method' => 'GET', 'url' => 'https://api.adzuna.com/v1/api/jobs/' . rawurlencode(strtolower((string) ($cfg['country'] ?: 'us'))) . '/search/1?' . http_build_query($p)];
    }
    case 'jooble': return ['method' => 'POST', 'url' => 'https://jooble.org/api/' . rawurlencode((string) $cfg['key']), 'headers' => ['Content-Type: application/json'], 'body' => jenc(['keywords' => $kw . ($remote === 'remote' ? ' remote' : ''), 'location' => $loc, 'page' => '1', 'ResultOnPage' => '50', 'datecreatedfrom' => date('Y-m-d', time() - $days * 86400)])];
    case 'jsearch': {
      $p = ['query' => $kw . ($loc !== '' ? ' in ' . $loc : ''), 'page' => 1, 'num_pages' => 1, 'country' => 'us', 'date_posted' => $days <= 1 ? 'today' : ($days <= 3 ? '3days' : ($days <= 7 ? 'week' : ($days <= 31 ? 'month' : 'all')))];
      if ($remote === 'remote') $p['work_from_home'] = 'true';
      $types = array_map('strtolower', (array) ($q['types'] ?? [])); if ($types && !array_intersect($types, ['full-time', 'part-time'])) $p['employment_types'] = 'CONTRACTOR';
      return ['method' => 'GET', 'url' => 'https://jsearch.p.rapidapi.com/search?' . http_build_query($p), 'headers' => ['x-rapidapi-key: ' . $cfg['key'], 'x-rapidapi-host: jsearch.p.rapidapi.com']];
    }
    case 'usajobs': { $p = ['Keyword' => $kw, 'ResultsPerPage' => 50, 'DatePosted' => min(60, $days)]; if ($loc !== '') $p['LocationName'] = $loc; if ($remote === 'remote') $p['RemoteIndicator'] = 'True';
      return ['method' => 'GET', 'url' => 'https://data.usajobs.gov/api/search?' . http_build_query($p), 'headers' => ['Host: data.usajobs.gov', 'User-Agent: ' . $cfg['email'], 'Authorization-Key: ' . $cfg['key']]]; }
    case 'remotive': return ['method' => 'GET', 'url' => 'https://remotive.com/api/remote-jobs?' . http_build_query(['search' => $kw, 'limit' => 60])];
    case 'remoteok': return ['method' => 'GET', 'url' => 'https://remoteok.com/api', 'timeout' => 25];
    case 'himalayas': return ['method' => 'GET', 'url' => 'https://himalayas.app/jobs/api/search?' . http_build_query(['q' => $kw, 'limit' => 50])];
    case 'jobicy': return ['method' => 'GET', 'url' => 'https://jobicy.com/api/v2/remote-jobs?' . http_build_query(['count' => 50, 'geo' => 'usa', 'tag' => $kw])];
  }
  if (str_starts_with($src, 'feed:')) { $u = trim((string) ($cfg['url'] ?? '')); if (!preg_match('#^https?://#i', $u)) return ['error' => 'The feed address must start with http:// or https://']; $u = str_replace(['{keywords}', '{location}'], [rawurlencode($kw), rawurlencode($loc)], $u); return ['method' => 'GET', 'url' => $u, 'timeout' => 20]; }
  return ['error' => 'Unknown source'];
}
function jms($v): int { if ($v === null || $v === '') return 0; if (is_numeric($v)) { $n = (float) $v; return (int) ($n > 1e12 ? $n : $n * 1000); } $t = strtotime((string) $v); return $t ? $t * 1000 : 0; }
function jobParse(string $src, string $body, array $q): ?array {
  $b = ltrim($body); $j = ($b !== '' && ($b[0] === '{' || $b[0] === '[')) ? json_decode($b, true) : null; $out = [];
  switch ($src) {
    case 'adzuna':
      if (!is_array($j) || !isset($j['results'])) return null;
      foreach ((array) $j['results'] as $r) { $area = (array) ($r['location']['area'] ?? []); $loc = (string) ($r['location']['display_name'] ?? '');
        if (count($area) >= 2 && ($area[0] ?? '') === 'US') { $st = array_search($area[1], US_STATES, true); $city = $area[count($area) - 1] !== $area[1] ? (string) end($area) : ''; $loc = ($city !== '' ? $city . ', ' : '') . ($st !== false ? $st : (string) $area[1]); }
        $ct = strtolower((string) ($r['contract_type'] ?? '')); $tm = strtolower((string) ($r['contract_time'] ?? ''));
        $out[] = ['ext' => (string) ($r['id'] ?? ''), 'title' => (string) ($r['title'] ?? ''), 'company' => (string) ($r['company']['display_name'] ?? ''), 'location' => $loc, 'url' => (string) ($r['redirect_url'] ?? ''), 'desc' => (string) ($r['description'] ?? ''), 'posted' => jms($r['created'] ?? null), 'type' => $ct === 'contract' ? 'Contract' : ($ct === 'permanent' ? ($tm === 'part_time' ? 'Part-time' : 'Full-time') : ($tm === 'part_time' ? 'Part-time' : '')), 'pub' => 'Adzuna', 'sal' => empty($r['salary_is_predicted']) || (string) $r['salary_is_predicted'] === '0' ? [$r['salary_min'] ?? null, $r['salary_max'] ?? null, 'year'] : null]; }
      return $out;
    case 'jooble':
      if (!is_array($j) || !isset($j['jobs'])) return null;
      foreach ((array) $j['jobs'] as $r) $out[] = ['ext' => (string) ($r['id'] ?? ''), 'title' => (string) ($r['title'] ?? ''), 'company' => (string) ($r['company'] ?? ''), 'location' => (string) ($r['location'] ?? ''), 'url' => (string) ($r['link'] ?? ''), 'desc' => (string) ($r['snippet'] ?? ''), 'posted' => jms($r['updated'] ?? null), 'type' => (string) ($r['type'] ?? ''), 'pub' => jboard((string) ($r['source'] ?? '')) ?: 'Jooble', 'via' => 'Jooble', 'salt' => (string) ($r['salary'] ?? '')];
      return $out;
    case 'jsearch':
      if (!is_array($j) || !isset($j['data'])) return null;
      foreach ((array) $j['data'] as $r) { $also = []; foreach ((array) ($r['apply_options'] ?? []) as $o) if (!empty($o['publisher']) && !empty($o['apply_link'])) $also[] = ['p' => jboard((string) $o['publisher']), 'u' => (string) $o['apply_link']];
        $loc = (string) ($r['job_location'] ?? ''); if ($loc === '') $loc = implode(', ', array_filter([(string) ($r['job_city'] ?? ''), (string) ($r['job_state'] ?? '')])) ?: (string) ($r['job_country'] ?? '');
        $et = strtoupper((string) ($r['job_employment_type'] ?? '')); $type = str_contains($et, 'CONTRACT') ? 'Contract' : (str_contains($et, 'FULL') ? 'Full-time' : (str_contains($et, 'PART') ? 'Part-time' : ''));
        $out[] = ['ext' => (string) ($r['job_id'] ?? ''), 'title' => (string) ($r['job_title'] ?? ''), 'company' => (string) ($r['employer_name'] ?? ''), 'location' => $loc, 'url' => (string) ($r['job_apply_link'] ?? ''), 'desc' => (string) ($r['job_description'] ?? ''), 'posted' => jms($r['job_posted_at_timestamp'] ?? ($r['job_posted_at_datetime_utc'] ?? null)), 'type' => $type, 'pub' => jboard((string) ($r['job_publisher'] ?? '')) ?: 'Google for Jobs', 'via' => 'Google for Jobs', 'also' => $also, 'remote' => !empty($r['job_is_remote']) ? 'Remote' : '', 'sal' => [$r['job_min_salary'] ?? null, $r['job_max_salary'] ?? null, (string) ($r['job_salary_period'] ?? 'year')]]; }
      return $out;
    case 'usajobs':
      if (!is_array($j) || !isset($j['SearchResult'])) return null;
      foreach ((array) ($j['SearchResult']['SearchResultItems'] ?? []) as $it) { $r = (array) ($it['MatchedObjectDescriptor'] ?? []); $rem = (array) (($r['PositionRemuneration'] ?? [])[0] ?? []); $loc = (string) ($r['PositionLocationDisplay'] ?? '');
        $out[] = ['ext' => (string) ($r['PositionID'] ?? ''), 'title' => (string) ($r['PositionTitle'] ?? ''), 'company' => trim((string) ($r['OrganizationName'] ?? '') . (!empty($r['DepartmentName']) ? ' (' . $r['DepartmentName'] . ')' : '')), 'location' => $loc, 'url' => (string) ($r['PositionURI'] ?? ''), 'desc' => trim((string) ($r['UserArea']['Details']['JobSummary'] ?? '') . "\n\n" . (string) ($r['QualificationSummary'] ?? '')), 'posted' => jms($r['PublicationStartDate'] ?? null), 'type' => str_contains(strtolower((string) (($r['PositionSchedule'] ?? [])[0]['Name'] ?? '')), 'part') ? 'Part-time' : 'Full-time', 'pub' => 'USAJOBS', 'remote' => stripos($loc, 'remote') !== false ? 'Remote' : '', 'sal' => [$rem['MinimumRange'] ?? null, $rem['MaximumRange'] ?? null, (string) ($rem['RateIntervalCode'] ?? 'year') === 'PH' ? 'hour' : 'year']]; }
      return $out;
    case 'remotive':
      if (!is_array($j) || !isset($j['jobs'])) return null;
      foreach ((array) $j['jobs'] as $r) { $where = (string) ($r['candidate_required_location'] ?? ''); if ($where !== '' && !preg_match('/\b(usa|us|u\.s\.|united states|americas?|north america|worldwide|anywhere|global)\b/i', $where)) continue; $jt = strtolower((string) ($r['job_type'] ?? ''));
        $out[] = ['ext' => (string) ($r['id'] ?? ''), 'title' => (string) ($r['title'] ?? ''), 'company' => (string) ($r['company_name'] ?? ''), 'location' => 'Remote' . ($where !== '' ? ' (' . (mb_strlen($where) > 40 ? (preg_match('/\b(usa|us|united states)\b/i', $where) ? 'USA and other countries' : mb_substr($where, 0, 40) . '…') : $where) . ')' : ''), 'url' => (string) ($r['url'] ?? ''), 'desc' => (string) ($r['description'] ?? ''), 'posted' => jms($r['publication_date'] ?? null), 'type' => str_contains($jt, 'contract') || str_contains($jt, 'freelance') ? 'Contract' : (str_contains($jt, 'part') ? 'Part-time' : (str_contains($jt, 'full') ? 'Full-time' : '')), 'pub' => 'Remotive', 'remote' => 'Remote', 'salt' => (string) ($r['salary'] ?? '')]; }
      return $out;
    case 'remoteok':
      if (!is_array($j)) return null;
      foreach ($j as $r) { if (!is_array($r) || empty($r['position'])) continue;
        $out[] = ['ext' => (string) ($r['id'] ?? ''), 'title' => (string) $r['position'], 'company' => (string) ($r['company'] ?? ''), 'location' => 'Remote' . (!empty($r['location']) && strcasecmp((string) $r['location'], 'remote') !== 0 ? ' (' . $r['location'] . ')' : ''), 'url' => (string) ($r['url'] ?? ($r['apply_url'] ?? '')), 'desc' => (string) ($r['description'] ?? '') . "\n" . implode(', ', (array) ($r['tags'] ?? [])), 'posted' => jms($r['epoch'] ?? ($r['date'] ?? null)), 'type' => '', 'pub' => 'Remote OK', 'remote' => 'Remote', 'sal' => [$r['salary_min'] ?? null, $r['salary_max'] ?? null, 'year']]; }
      return $out;
    case 'himalayas':
      if (!is_array($j) || !isset($j['jobs'])) return null;
      foreach ((array) $j['jobs'] as $r) { $lr = (array) ($r['locationRestrictions'] ?? []); if ($lr && !in_array('United States', $lr, true) && !in_array('USA', $lr, true)) continue; $et = strtolower((string) ($r['employmentType'] ?? ''));
        $out[] = ['ext' => (string) ($r['guid'] ?? ($r['applicationLink'] ?? '')), 'title' => (string) ($r['title'] ?? ''), 'company' => (string) ($r['companyName'] ?? ''), 'location' => 'Remote (' . ($lr ? 'US' : 'worldwide') . ')', 'url' => (string) ($r['applicationLink'] ?? ($r['guid'] ?? '')), 'desc' => (string) ($r['description'] ?? ($r['excerpt'] ?? '')), 'posted' => jms($r['pubDate'] ?? null), 'type' => str_contains($et, 'contract') ? 'Contract' : (str_contains($et, 'part') ? 'Part-time' : (str_contains($et, 'full') ? 'Full-time' : '')), 'pub' => 'Himalayas', 'remote' => 'Remote', 'sal' => [$r['minSalary'] ?? null, $r['maxSalary'] ?? null, (string) ($r['salaryPeriod'] ?? 'year')], 'cur' => (string) ($r['currency'] ?? 'USD')]; }
      return $out;
    case 'jobicy':
      if (!is_array($j)) return null; if (!isset($j['jobs'])) return isset($j['success']) ? [] : null;
      foreach ((array) $j['jobs'] as $r) { $jt = strtolower(implode(' ', (array) ($r['jobType'] ?? [])));
        $out[] = ['ext' => (string) ($r['id'] ?? ''), 'title' => (string) ($r['jobTitle'] ?? ''), 'company' => (string) ($r['companyName'] ?? ''), 'location' => 'Remote (' . ((string) ($r['jobGeo'] ?? 'USA') ?: 'USA') . ')', 'url' => (string) ($r['url'] ?? ''), 'desc' => (string) ($r['jobDescription'] ?? ($r['jobExcerpt'] ?? '')), 'posted' => jms($r['pubDate'] ?? null), 'type' => str_contains($jt, 'contract') || str_contains($jt, 'freelance') ? 'Contract' : (str_contains($jt, 'part') ? 'Part-time' : (str_contains($jt, 'full') ? 'Full-time' : '')), 'pub' => 'Jobicy', 'remote' => 'Remote', 'sal' => [$r['salaryMin'] ?? null, $r['salaryMax'] ?? null, (string) ($r['salaryPeriod'] ?? 'year')], 'cur' => (string) ($r['salaryCurrency'] ?? 'USD')]; }
      return $out;
  }
  if (str_starts_with($src, 'feed:')) return jobParseFeed($body, $j);
  return null;
}
function jobParseFeed(string $body, $j): ?array {
  $out = [];
  if (is_array($j)) {
    $list = null; foreach (['items', 'jobs', 'data', 'results', 'postings'] as $k) if (isset($j[$k]) && is_array($j[$k])) { $list = $j[$k]; break; }
    if ($list === null) $list = array_keys($j) === range(0, count($j) - 1) ? $j : null; if ($list === null) return null;
    foreach ($list as $it) { if (!is_array($it)) continue; $title = (string) ($it['title'] ?? ($it['position'] ?? ($it['job_title'] ?? ($it['name'] ?? '')))); $url = (string) ($it['url'] ?? ($it['link'] ?? ($it['apply_url'] ?? ($it['external_url'] ?? ($it['job_url'] ?? ''))))); if ($title === '' || $url === '') continue;
      $out[] = ['ext' => (string) ($it['id'] ?? ($it['guid'] ?? '')), 'title' => $title, 'company' => (string) ($it['company'] ?? ($it['company_name'] ?? ($it['employer'] ?? ($it['author'] ?? '')))), 'location' => (string) ($it['location'] ?? ($it['city'] ?? '')), 'url' => $url, 'desc' => (string) ($it['description'] ?? ($it['content_html'] ?? ($it['content_text'] ?? ($it['summary'] ?? ($it['content'] ?? ''))))), 'posted' => jms($it['date_published'] ?? ($it['date'] ?? ($it['created_at'] ?? ($it['published'] ?? null)))), 'type' => (string) ($it['job_type'] ?? ($it['type'] ?? '')), 'pub' => '']; }
    return $out;
  }
  if (!function_exists('simplexml_load_string')) return null;
  libxml_use_internal_errors(true); $x = @simplexml_load_string($body, 'SimpleXMLElement', LIBXML_NOCDATA | LIBXML_NONET); if ($x === false) return null;
  $s = fn($v) => $v === null ? '' : trim((string) $v);
  if (isset($x->channel->item)) foreach ($x->channel->item as $it) { $c = $it->children('content', true); $desc = isset($c->encoded) ? (string) $c->encoded : $s($it->description); $out[] = ['ext' => $s($it->guid), 'title' => $s($it->title), 'company' => $s($it->author) ?: (isset($it->children('dc', true)->creator) ? (string) $it->children('dc', true)->creator : ''), 'location' => '', 'url' => $s($it->link), 'desc' => $desc, 'posted' => jms($s($it->pubDate) ?: null), 'type' => '', 'pub' => '']; }
  elseif (isset($x->entry)) foreach ($x->entry as $e) { $url = ''; foreach ($e->link as $l) { $a = $l->attributes(); if (!isset($a['rel']) || (string) $a['rel'] === 'alternate') { $url = (string) ($a['href'] ?? ''); break; } } $out[] = ['ext' => $s($e->id), 'title' => $s($e->title), 'company' => $s($e->author->name ?? null), 'location' => '', 'url' => $url, 'desc' => $s($e->content) ?: $s($e->summary), 'posted' => jms($s($e->published) ?: ($s($e->updated) ?: null)), 'type' => '', 'pub' => '']; }
  elseif (isset($x->job)) foreach ($x->job as $jb) $out[] = ['ext' => $s($jb->referencenumber ?? null) ?: $s($jb->id ?? null), 'title' => $s($jb->title), 'company' => $s($jb->company), 'location' => trim(implode(', ', array_filter([$s($jb->city), $s($jb->state)]))), 'url' => $s($jb->url) ?: $s($jb->link), 'desc' => $s($jb->description), 'posted' => jms($s($jb->date) ?: null), 'type' => $s($jb->jobtype), 'pub' => ''];
  else return null;
  return $out;
}
function jobTypeOf(string $hint, string $text): string {
  $h = strtolower($hint); $t = strtolower(mb_substr($text, 0, 5000));
  $noC2C = (bool) preg_match('/\bno\s+c2c\b|c2c\s+(?:is\s+)?not\b|not\s+(?:open\s+(?:to|for)\s+)?c2c|w-?2\s+only|only\s+w-?2|w-?2\s+candidates?\s+only/', $t);
  if (!$noC2C && preg_match('/\bc2c\b|corp[\s-]*to[\s-]*corp/', $t)) return 'C2C';
  if (preg_match('/contract[\s-]*to[\s-]*hire|\bcth\b|contract to perm|temp[\s-]*to[\s-]*hire/', $t)) return 'Contract-to-hire';
  if (preg_match('/\b1099\b/', $t) && preg_match('/\bcontract|independent|freelance/', $t)) return '1099';
  if (preg_match('/w-?2\s+only|only\s+w-?2|\bw-?2\s+contract|w-?2\s+(?:role|position|candidates?|employees?)|\bon\s+w-?2\b/', $t)) return 'W2';
  if (preg_match('/contract|temporary|temp|freelance/', $h)) return 'Contract';
  if (preg_match('/full[\s-]*time|permanent|fulltime/', $h)) return 'Full-time';
  if (preg_match('/part[\s-]*time/', $h)) return 'Part-time';
  if (preg_match('/\b(\d{1,2}\+?\s*(?:months?|mos)\s*(?:contract|duration|assignment)|contract (?:role|position|opportunity|assignment|duration)|duration\s*:\s*\d|contract length)/', $t)) return 'Contract';
  if (preg_match('/\bfull[\s-]*time\b|\bpermanent\b/', $t) && !preg_match('/\bcontract\b/', $t)) return 'Full-time';
  return '';
}
function jobNormalize(string $src, array $r): ?array {
  $title = jclean((string) ($r['title'] ?? ''), 200); if ($title === '' || mb_strlen($title) < 3) return null;
  $url = trim((string) ($r['url'] ?? '')); if (!preg_match('#^https?://#i', $url)) return null;
  $desc = htmlToText((string) ($r['desc'] ?? '')); $desc = mb_substr($desc, 0, 15000);
  $company = jclean((string) ($r['company'] ?? ''), 120); $loc = jclean((string) ($r['location'] ?? ''), 120);
  $remote = (string) ($r['remote'] ?? ''); $probe = strtolower($title . ' ' . $loc . ' ' . mb_substr($desc, 0, 600));
  if ($remote === '') $remote = preg_match('/\bhybrid\b/', $probe) ? 'Hybrid' : (preg_match('/\b(remote|work from home|wfh)\b/', $probe) ? 'Remote' : '');
  if ($remote === 'Remote' && preg_match('/\b(hybrid|on-?site)\b/', strtolower($title . ' ' . $loc))) $remote = 'Hybrid';
  $sal = ''; if (!empty($r['salt'])) $sal = jclean((string) $r['salt'], 60); elseif (is_array($r['sal'] ?? null)) { [$mn, $mx, $per] = array_pad($r['sal'], 3, null); $sal = jsalary($mn !== null && $mn !== '' ? (float) $mn : null, $mx !== null && $mx !== '' ? (float) $mx : null, (string) $per, (string) ($r['cur'] ?? 'USD')); }
  $skills = skillsIn($title . "\n" . $desc, 60);
  $ext = trim((string) ($r['ext'] ?? ''));
  $k = sha1($src . '|' . ($ext !== '' ? $ext : strtolower(preg_replace('/[?#].*$/', '', $url) ?? $url)));
  $cityKey = jlocParse($loc)['city'] ?: jnorm($loc);
  return ['k' => $k, 'fp' => sha1(jnorm($title) . '|' . jnorm($company) . '|' . $cityKey), 'src' => $src, 'pub' => mb_substr((string) ($r['pub'] ?: jobSourceName($src)), 0, 80), 'title' => $title, 'company' => $company, 'location' => $loc, 'remote' => $remote, 'job_type' => jobTypeOf((string) ($r['type'] ?? ''), $title . ' ' . $desc), 'salary' => $sal, 'url' => mb_substr($url, 0, 1000), 'boards' => array_values(array_filter((array) ($r['also'] ?? []), fn($a) => !empty($a['p']) && !empty($a['u']))), 'summary' => mb_substr($desc, 0, 320), 'description' => $desc, 'skills' => $skills, 'posted' => (int) ($r['posted'] ?? 0)];
}
function jobUpsert(array $j, int $runId): array { // [id, isNew]
  $p = jdb(); $now = now();
  $s = $p->prepare('SELECT id, description, boards, pub, url FROM job_posts WHERE k = ?'); $s->execute([$j['k']]); $row = $s->fetch();
  if (!$row && $j['company'] !== '') { $s = $p->prepare('SELECT id, description, boards, pub, url FROM job_posts WHERE fp = ? AND last_seen > ? ORDER BY id DESC LIMIT 1'); $s->execute([$j['fp'], $now - 21 * 86400000]); $row = $s->fetch(); if ($row) { // the same posting seen through another source: remember the extra board instead of duplicating
      $boards = jdec($row['boards']); $have = array_map(fn($b) => strtolower($b['p'] . '|' . $b['u']), $boards); $have[] = strtolower($row['pub'] . '|' . $row['url']);
      if (!in_array(strtolower($j['pub'] . '|' . $j['url']), $have, true)) $boards[] = ['p' => $j['pub'], 'u' => $j['url']];
      foreach ($j['boards'] as $b) if (!in_array(strtolower($b['p'] . '|' . $b['u']), $have, true)) $boards[] = $b;
      $j['boards'] = array_slice($boards, 0, 8);
    } }
  if ($row) {
    $better = mb_strlen($j['description']) > mb_strlen((string) $row['description']) + 200;
    if ($better) $p->prepare('UPDATE job_posts SET last_seen = ?, run_id = ?, description = ?, summary = ?, skills = ?, boards = ?, salary = CASE WHEN salary = \'\' THEN ? ELSE salary END, job_type = CASE WHEN job_type = \'\' THEN ? ELSE job_type END WHERE id = ?')->execute([$now, $runId, $j['description'], $j['summary'], jenc($j['skills']), jenc($j['boards']), $j['salary'], $j['job_type'], (int) $row['id']]);
    else $p->prepare('UPDATE job_posts SET last_seen = ?, run_id = ?, boards = ? WHERE id = ?')->execute([$now, $runId, jenc($j['boards']), (int) $row['id']]);
    return [(int) $row['id'], false];
  }
  $p->prepare('INSERT INTO job_posts (k, fp, src, pub, title, company, location, remote, job_type, salary, url, boards, summary, description, skills, posted, first_seen, last_seen, run_id, published) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)')
    ->execute([$j['k'], $j['fp'], $j['src'], $j['pub'], $j['title'], $j['company'], $j['location'], $j['remote'], $j['job_type'], $j['salary'], $j['url'], jenc($j['boards']), $j['summary'], $j['description'], jenc($j['skills']), $j['posted'], $now, $now, $runId]);
  $GLOBALS['jobPoolDirty'] = true;
  return [(int) $p->lastInsertId(), true];
}
function jobRunLink(int $runId, int $jobId): void { $p = jdb(); $ig = $p->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql' ? 'INSERT IGNORE' : 'INSERT OR IGNORE'; $p->prepare("$ig INTO job_run_jobs (run_id, job_id) VALUES (?, ?)")->execute([$runId, $jobId]); }
function jobFetch(string $src, array $q, array $cfg): array {
  $req = jobRequest($src, $q, $cfg); if (isset($req['error'])) return ['jobs' => [], 'error' => $req['error']];
  $res = jhttp($req['method'], $req['url'], $req['headers'] ?? [], $req['body'] ?? null, (int) ($req['timeout'] ?? 14));
  if ($res['status'] === 0) return ['jobs' => [], 'error' => 'No answer from the service (' . ($res['error'] ?: 'connection failed') . ').'];
  if ($res['status'] === 401 || $res['status'] === 403) return ['jobs' => [], 'error' => 'The key was refused (HTTP ' . $res['status'] . '). Check it under Sources.'];
  if ($res['status'] === 429) return ['jobs' => [], 'error' => 'Rate limit reached (HTTP 429). It will try again on the next collection.'];
  if ($res['status'] >= 400) return ['jobs' => [], 'error' => 'HTTP ' . $res['status'] . ' ' . mb_substr(jclean($res['body'], 140), 0, 140)];
  $items = jobParse($src, $res['body'], $q); if ($items === null) return ['jobs' => [], 'error' => 'Unexpected response (not the job data expected).'];
  $out = []; foreach ($items as $it) { $n = jobNormalize($src, $it); if ($n) $out[] = $n; }
  return ['jobs' => $out, 'error' => ''];
}

/* ---------- people ---------- */
function jobPerson(string $uid): ?array { $s = jdb()->prepare('SELECT * FROM job_people WHERE uid = ?'); $s->execute([$uid]); $r = $s->fetch(); return $r ?: null; }
function jobPeopleActive(): array { return jdb()->query("SELECT jp.*, u.name AS uname, u.email AS uemail FROM job_people jp JOIN users u ON u.id = jp.uid WHERE u.status = 'active' ORDER BY jp.updated_at DESC")->fetchAll(); }
function jobPersonSave(array $u, ?array $patch): array {
  $p = jdb(); $cur = jobPerson($u['id']); $now = now();
  $row = ['uid' => $u['id'], 'name' => $u['name'], 'email' => $u['email'], 'resume_name' => $cur['resume_name'] ?? '', 'resume_fid' => $cur['resume_fid'] ?? '', 'resume_at' => (int) ($cur['resume_at'] ?? 0), 'resume_text' => $cur['resume_text'] ?? '', 'profile' => $cur['profile'] ?? '{}', 'prefs' => $cur['prefs'] ?? '{}', 'updated_at' => $now, 'matched_at' => (int) ($cur['matched_at'] ?? 0)];
  foreach ((array) $patch as $k => $v) if (array_key_exists($k, $row)) $row[$k] = $v;
  $p->prepare('REPLACE INTO job_people (uid, name, email, resume_name, resume_fid, resume_at, resume_text, profile, prefs, updated_at, matched_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')->execute(array_values($row));
  return $row;
}
function jobsPrefs(array $in, ?stdClass $prof): array {
  $list = function ($v, int $n = 12) { if (is_string($v)) $v = preg_split('/[,;\n]/', $v); if (!is_array($v)) return []; $o = []; foreach ($v as $x) { if (!is_scalar($x)) continue; $x = mb_substr(trim((string) $x), 0, 80); if ($x !== '' && !in_array($x, $o, true)) $o[] = $x; if (count($o) >= $n) break; } return $o; };
  $remote = in_array($in['remote'] ?? '', ['any', 'remote', 'onsite', 'hybrid'], true) ? $in['remote'] : 'any';
  return ['titles' => $list($in['titles'] ?? []), 'skills' => $list($in['skills'] ?? [], 40), 'locations' => $list($in['locations'] ?? []), 'keywords' => $list($in['keywords'] ?? []), 'exclude' => $list($in['exclude'] ?? []), 'job_types' => array_values(array_intersect($list($in['job_types'] ?? [], 8), JOB_TYPES)), 'remote' => $remote,
    'title' => mb_substr(trim((string) ($prof->ti ?? '')), 0, 80), 'location' => mb_substr(trim((string) ($prof->loc ?? '')), 0, 80),
    // one-click apply: an optional cover note (placeholders {name} {title} {job} {company} {years} {skills} {location} {phone} {email} {signature}) and whether to email the resume to a contact address found in the posting
    'apply_note' => mb_substr(trim(is_scalar($in['apply_note'] ?? null) ? (string) $in['apply_note'] : ''), 0, 1500), 'apply_email' => array_key_exists('apply_email', $in) ? (bool) $in['apply_email'] : true];
}
function jobPersonTerms(array $p): array { // what to search for, for one person
  $prof = jdec($p['profile']); $pref = jdec($p['prefs']);
  $titles = array_values(array_filter((array) ($pref['titles'] ?? []), 'is_string')); if (!$titles) $titles = array_slice(array_values(array_filter((array) ($prof['titles'] ?? []), 'is_string')), 0, 2); if (!$titles && !empty($pref['title'])) $titles = [(string) $pref['title']];
  $locs = array_values(array_filter((array) ($pref['locations'] ?? []), 'is_string')); if (!$locs) { $l = (string) ($prof['location'] ?? '') ?: (string) ($pref['location'] ?? ''); if ($l !== '') $locs = [$l]; }
  return ['titles' => array_slice($titles, 0, 3), 'locs' => array_slice($locs, 0, 3), 'remote' => (string) ($pref['remote'] ?? 'any'), 'types' => (array) ($pref['job_types'] ?? [])];
}
function jobQueriesFor(array $people, int $max, bool $skipRecent = false): array {
  $lists = []; $searched = $skipRecent ? (array) jkvGet('searched', []) : [];
  foreach ($people as $p) { $t = jobPersonTerms($p); $l = [];
    foreach ($t['titles'] as $ti) foreach ($t['locs'] ?: [''] as $lo) $l[] = ['q' => $ti, 'loc' => $t['remote'] === 'remote' ? '' : $lo, 'remote' => $t['remote'], 'types' => $t['types']];
    if ($l) $lists[] = $l; }
  $out = []; $seen = [];
  for ($i = 0; count($out) < $max; $i++) { $any = false;
    foreach ($lists as $l) { if (!isset($l[$i])) continue; $any = true; $q = $l[$i]; $key = strtolower($q['q'] . '|' . $q['loc'] . '|' . $q['remote']); if (isset($seen[$key])) continue; $seen[$key] = 1;
      if ($skipRecent && isset($searched[$key]) && now() - (int) $searched[$key] < 3 * 3600000) continue;
      $out[] = $q; if (count($out) >= $max) break; }
    if (!$any) break; }
  return $out;
}
function jobSearched(string $src, array $q): void { $m = (array) jkvGet('searched', []); $now = now(); foreach ($m as $k => $t) if ($now - (int) $t > 2 * 86400000) unset($m[$k]); $m[strtolower($q['q'] . '|' . ($q['loc'] ?? '') . '|' . ($q['remote'] ?? 'any'))] = $now; jkvSet('searched', $m); }

/* ---------- runs ---------- */
function jobRunGet(int $id): ?array { $s = jdb()->prepare('SELECT * FROM job_runs WHERE id = ?'); $s->execute([$id]); $r = $s->fetch(); return $r ?: null; }
function jobRunActive(): ?array { $r = jdb()->query("SELECT * FROM job_runs WHERE status IN ('running','queued') ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END, id LIMIT 1")->fetch(); return $r ?: null; }
function jobRunLast(): ?array { $r = jdb()->query("SELECT * FROM job_runs WHERE status NOT IN ('running','queued') ORDER BY id DESC LIMIT 1")->fetch(); return $r ?: null; }
function jobRunLog(array &$run, string $line): void { $run['logtext'] = mb_substr((string) $run['logtext'] . date('H:i:s') . ' ' . $line . "\n", -40000); }
function jobRunErr(array &$run, string $source, string $error): void { $e = jdec($run['errors']); foreach ($e as $x) if (($x['source'] ?? '') === $source && ($x['error'] ?? '') === $error) return; if (count($e) < 25) $e[] = ['source' => $source, 'error' => $error]; $run['errors'] = jenc($e); }
function jobRunSave(array $run): void { jdb()->prepare('UPDATE job_runs SET heartbeat = ?, pos = ?, searches = ?, jobs_found = ?, jobs_new = ?, errors = ?, logtext = ? WHERE id = ?')->execute([now(), (int) $run['pos'], (int) $run['searches'], (int) $run['jobs_found'], (int) $run['jobs_new'], (string) $run['errors'], (string) $run['logtext'], (int) $run['id']]); }
function jobPlan(array $set, array $queries, array $only, string $kind, array $uids, int $days): array {
  $tasks = [];
  foreach (jobSources() as $k => $m) {
    if ($only && !in_array($k, $only, true)) continue;
    $c = $set['sources'][$k]; if (empty($c['on']) || !jobReady($k, $c)) continue;
    if ($m['kind'] === 'feed') { if ($queries) $tasks[] = ['t' => 'feed', 's' => $k, 'days' => $days]; continue; }
    $cap = max(1, (int) ($c['per_run'] ?: $m['per_run'])); $seen = []; $n = 0;
    foreach ($queries as $q) {
      if (!empty($m['remote']) && ($q['remote'] ?? 'any') === 'onsite') continue;
      $key = !empty($m['remote']) ? strtolower($q['q']) : strtolower($q['q'] . '|' . $q['loc'] . '|' . $q['remote']); if (isset($seen[$key])) continue; $seen[$key] = 1;
      $tasks[] = ['t' => 'search', 's' => $k, 'q' => $q['q'], 'loc' => !empty($m['remote']) ? '' : $q['loc'], 'remote' => $q['remote'], 'types' => $q['types'] ?? [], 'days' => $days];
      if (++$n >= $cap) break;
    }
  }
  foreach ($set['feeds'] as $f) { $id = 'feed:' . $f['id']; if (empty($f['on']) || ($only && !in_array($id, $only, true))) continue;
    if (str_contains((string) $f['url'], '{keywords}')) { $n = 0; $seen = []; foreach ($queries as $q) { $key = strtolower($q['q'] . '|' . $q['loc']); if (isset($seen[$key])) continue; $seen[$key] = 1; $tasks[] = ['t' => 'search', 's' => $id, 'q' => $q['q'], 'loc' => $q['loc'], 'remote' => $q['remote'], 'types' => [], 'days' => $days]; if (++$n >= 6) break; } }
    elseif ($queries) $tasks[] = ['t' => 'feed', 's' => $id, 'days' => $days]; }
  foreach ($uids as $u) $tasks[] = ['t' => 'match', 'uid' => $u];
  if ($kind === 'all') $tasks[] = ['t' => 'cleanup'];
  return $tasks;
}
function jobRunStart(string $kind, string $by, array $plan, array $search): array {
  $p = jdb(); $now = now(); $active = jobRunActive();
  $p->prepare('INSERT INTO job_runs (kind, status, trigger_by, started_at, finished_at, heartbeat, pos, total, searches, jobs_found, jobs_new, errors, logtext, search, plan) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    ->execute([$kind, $active ? 'queued' : 'running', mb_substr($by, 0, 150), $now, 0, $now, 0, count($plan), 0, 0, 0, '[]', '', jenc($search), jenc($plan)]);
  return jobRunGet((int) $p->lastInsertId());
}
function jobSearchList(array $queries): array { $o = []; $seen = []; foreach ($queries as $q) { $k = strtolower($q['q'] . '|' . $q['loc'] . '|' . $q['remote']); if (isset($seen[$k])) continue; $seen[$k] = 1; $o[] = ['q' => $q['q'], 'location' => $q['loc'] !== '' ? $q['loc'] : ($q['remote'] === 'remote' ? 'Remote' : 'United States')]; } return $o; }
function jobSourcesOn(array $set): int { $n = 0; foreach (jobSources() as $k => $m) if (!empty($set['sources'][$k]['on']) && jobReady($k, $set['sources'][$k])) $n++; foreach ($set['feeds'] as $f) if (!empty($f['on'])) $n++; return $n; }
function jobStartAll(array $set, string $by): array { // ['run' => ..., 'error' => '']
  if (jobSourcesOn($set) === 0) return ['run' => null, 'error' => 'Turn on at least one job source under Sources first.'];
  $people = jobPeopleActive(); $queries = jobQueriesFor($people, max(1, (int) $set['max_searches']));
  if (!$queries) return ['run' => null, 'error' => 'No consultant has a resume or job titles yet, so there is nothing to search for. Use the Job grabber to search by keyword.'];
  $plan = jobPlan($set, $queries, [], 'all', array_column($people, 'uid'), max(1, (int) $set['max_age_days']));
  return ['run' => jobRunStart('all', $by, $plan, jobSearchList($queries)), 'error' => ''];
}
function jobStartPerson(array $set, array $u, string $by): ?array { // a small collection for one person's titles, after a resume or preference change
  if (jobSourcesOn($set) === 0) return null; $p = jobPerson($u['id']); if (!$p) return null;
  if (throttleHit('jobperson:' . $u['id'], 2, 1800)) return null;
  $queries = jobQueriesFor([$p], 6, true); $plan = $queries ? jobPlan($set, $queries, [], 'person', [$u['id']], max(1, (int) $set['max_age_days'])) : [];
  $plan = array_values(array_filter($plan, fn($t) => $t['t'] !== 'feed')); if (!$plan || !array_filter($plan, fn($t) => $t['t'] === 'search')) return null;
  return jobRunStart('person', $by, $plan, jobSearchList($queries));
}
function jobDue(array $set): bool { $h = (float) $set['schedule_hours']; if ($h <= 0) return false; $last = (int) jdb()->query("SELECT MAX(started_at) FROM job_runs WHERE kind = 'all'")->fetchColumn(); return $last === 0 || now() - $last >= $h * 3600000; }
function jobMaybeStart(array $set, string $by): ?array {
  if (jobRunActive() || !jobDue($set)) return null;
  $last = (int) jkvGet('auto_try', 0); if (now() - $last < 600000) return null; jkvSet('auto_try', now());
  if (!jobLock(5000)) return null;
  try { if (jobRunActive()) return null; $r = jobStartAll($set, $by); return $r['run']; } finally { jobUnlock(); }
}
function jobStep(int $budgetMs): ?array { // advances the oldest active run for about $budgetMs, returns it (or the active run when someone else is stepping it)
  $run = jobRunActive(); if (!$run) return null;
  if (!jobLock()) return $run;
  $t0 = now();
  try {
    $run = jobRunActive(); if (!$run) return null;
    if ($run['status'] === 'queued') { jdb()->prepare("UPDATE job_runs SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'")->execute([now(), (int) $run['id']]); $run['status'] = 'running'; $run['started_at'] = now(); }
    $plan = jdec($run['plan']); $set = jobSettings(); $pos = (int) $run['pos'];
    while ($pos < count($plan)) {
      if (now() - $t0 > $budgetMs) break;
      $task = $plan[$pos];
      try { jobTask($task, $run, $set); } catch (Throwable $e) { jobRunErr($run, jobSourceName((string) ($task['s'] ?? 'run'), $set), 'Problem: ' . $e->getMessage()); jobRunLog($run, 'Problem in ' . ($task['t'] ?? 'task') . ': ' . $e->getMessage()); }
      $pos++; $run['pos'] = $pos; jobRunSave($run); jobLockRenew();
      $st = jdb()->prepare('SELECT status FROM job_runs WHERE id = ?'); $st->execute([(int) $run['id']]); if ($st->fetchColumn() === 'cancelled') return jobRunGet((int) $run['id']);
    }
    if ($pos >= count($plan)) jobRunFinish($run, $plan);
    return jobRunGet((int) $run['id']);
  } finally { jobUnlock(); }
}
function jobRunFinish(array $run, array $plan): void {
  $errs = jdec($run['errors']); $fetch = count(array_filter($plan, fn($t) => in_array($t['t'], ['search', 'feed'], true)));
  $status = $fetch > 0 && count($errs) >= $fetch && (int) $run['jobs_found'] === 0 ? 'failed' : ($errs ? 'done_with_errors' : 'done');
  jdb()->prepare("UPDATE job_runs SET status = ?, finished_at = ?, plan = '[]' WHERE id = ? AND status = 'running'")->execute([$status, now(), (int) $run['id']]);
}
function jobTask(array $t, array &$run, array $set): void {
  $kind = (string) ($t['t'] ?? '');
  if ($kind === 'search' || $kind === 'feed') {
    $src = (string) $t['s']; $name = jobSourceName($src, $set);
    $cfg = str_starts_with($src, 'feed:') ? jobFeedCfg($set, substr($src, 5)) : ($set['sources'][$src] ?? null);
    if (!$cfg) { jobRunLog($run, "$name: skipped (no longer configured)"); return; }
    $label = $kind === 'search' ? '"' . $t['q'] . '"' . (($t['loc'] ?? '') !== '' ? ' in ' . $t['loc'] : (($t['remote'] ?? '') === 'remote' ? ' (remote)' : '')) : 'feed';
    if ($src === 'jsearch') { $u = (array) jkvGet('jsearch_month', []); $month = date('Y-m'); $used = ($u['m'] ?? '') === $month ? (int) ($u['n'] ?? 0) : 0; $cap = max(1, (int) ($cfg['month_cap'] ?? 150));
      if ($used >= $cap) { jobRunLog($run, "$name: $label skipped, monthly search limit ($cap) reached"); jobRunErr($run, $name, "Monthly search limit of $cap reached; raise it under Sources if your plan allows more."); return; }
      jkvSet('jsearch_month', ['m' => $month, 'n' => $used + 1]); }
    $q = ['q' => (string) ($t['q'] ?? ''), 'loc' => (string) ($t['loc'] ?? ''), 'remote' => (string) ($t['remote'] ?? 'any'), 'days' => (int) ($t['days'] ?? $set['max_age_days']), 'types' => (array) ($t['types'] ?? [])];
    $res = jobFetch($src, $q, $cfg); jobSourceStatus($src, $res['error'], count($res['jobs']));
    if ($res['error'] !== '') { jobRunErr($run, $name, $res['error']); jobRunLog($run, "$name: $label failed: " . $res['error']); return; }
    $jobs = $res['jobs']; $search = jdec($run['search']);
    if ($kind === 'feed') $jobs = array_values(array_filter($jobs, fn($j) => jobFitsSearch($j, $search)));
    $cut = now() - ($q['days'] + 1) * 86400000; $jobs = array_values(array_filter($jobs, fn($j) => $j['posted'] === 0 || $j['posted'] >= $cut));
    $new = 0; foreach ($jobs as $j) { [$id, $isNew] = jobUpsert($j, (int) $run['id']); if ($isNew) $new++; jobRunLink((int) $run['id'], $id); }
    $run['jobs_found'] = (int) $run['jobs_found'] + count($jobs); $run['jobs_new'] = (int) $run['jobs_new'] + $new; if ($kind === 'search') { $run['searches'] = (int) $run['searches'] + 1; jobSearched($src, $q); }
    jobRunLog($run, sprintf('%s: %s → %d jobs, %d new', $name, $label, count($jobs), $new));
  } elseif ($kind === 'match') { $uid = (string) $t['uid']; $n = jobMatchPerson($uid, $set); $p = jobPerson($uid); jobRunLog($run, 'Matched ' . ($p['name'] ?? $uid) . ': ' . $n . ' jobs'); }
  elseif ($kind === 'cleanup') { $n = jobCleanup($set); jobRunLog($run, "Removed $n postings older than {$set['keep_days']} days"); }
}
function jobFitsSearch(array $j, array $search): bool {
  if (!$search) return true;
  $hay = ' ' . implode(' ', jtok($j['title'] . ' ' . implode(' ', $j['skills']))) . ' ';
  foreach ($search as $s) { $tok = jtokCore((string) ($s['q'] ?? '')); if (!$tok) continue; $all = true; foreach ($tok as $x) if (!str_contains($hay, ' ' . $x . ' ')) { $all = false; break; } if ($all) return true; }
  return false;
}
function jobCleanup(array $set): int {
  $p = jdb(); $cut = now() - max(7, (int) $set['keep_days']) * 86400000;
  $s = $p->prepare("SELECT id FROM job_posts WHERE last_seen < ? AND published = 0 AND id NOT IN (SELECT job_id FROM job_matches WHERE state IN ('saved','applied'))"); $s->execute([$cut]);
  $ids = array_map('intval', $s->fetchAll(PDO::FETCH_COLUMN));
  foreach (array_chunk($ids, 300) as $ch) { $in = implode(',', $ch); $p->exec("DELETE FROM job_posts WHERE id IN ($in)"); $p->exec("DELETE FROM job_matches WHERE job_id IN ($in)"); $p->exec("DELETE FROM job_run_jobs WHERE job_id IN ($in)"); }
  $old = $p->query('SELECT id FROM job_runs ORDER BY id DESC LIMIT 1 OFFSET 80')->fetchColumn();
  if ($old) { $p->prepare('DELETE FROM job_run_jobs WHERE run_id <= ?')->execute([(int) $old]); $p->prepare("DELETE FROM job_runs WHERE id <= ? AND status NOT IN ('running','queued')")->execute([(int) $old]); }
  if ($ids) $GLOBALS['jobPoolDirty'] = true;
  return count($ids);
}
function jobCron(bool $cli): array {
  $set = jobSettings(); $started = null;
  if (!jobRunActive() && jobDue($set)) { $r = jobStartAll($set, $cli ? 'cron' : 'cron (web)'); $started = $r['run']; }
  $t0 = microtime(true); $run = null; $lastPos = -1; $idle = 0;
  do { $run = jobStep($cli ? 25000 : 18000); if ($run && (int) $run['pos'] === $lastPos) { $idle++; if ($cli) sleep(2); } else $idle = 0; $lastPos = $run ? (int) $run['pos'] : -1; }
  while ($cli && $run && in_array($run['status'], ['running', 'queued'], true) && microtime(true) - $t0 < 840 && $idle < 20);
  jkvSet('cron_seen', now()); $a = jobRunActive();
  return ['ok' => true, 'started' => $started ? (int) $started['id'] : null, 'active' => $a ? jobRunOut($a) : null, 'message' => $started ? 'Started collection #' . $started['id'] . ($a ? ', in progress' : ', finished') : ($a ? 'Collection #' . $a['id'] . ' in progress (' . $a['pos'] . '/' . $a['total'] . ')' : 'Nothing due' . ($set['schedule_hours'] > 0 ? '; next collection ' . round((float) $set['schedule_hours'], 1) . ' h after the last one' : ' (automatic collections are off)'))];
}

/* ---------- matching ---------- */
function jobPool(array $set): array {
  static $pool = null; if ($pool !== null && empty($GLOBALS['jobPoolDirty'])) return $pool;
  $GLOBALS['jobPoolDirty'] = false; $pool = [];
  $s = jdb()->prepare('SELECT id, title, location, remote, job_type, skills, posted, first_seen FROM job_posts WHERE last_seen >= ? ORDER BY id DESC LIMIT 9000'); $s->execute([now() - max(7, (int) $set['keep_days']) * 86400000]);
  $now = now();
  while ($r = $s->fetch()) { $sk = jdec($r['skills']); $pool[] = ['id' => (int) $r['id'], 'tt' => array_flip(jtok((string) $r['title'])), 'skl' => array_map('strtolower', $sk), 'skn' => $sk, 'loc' => jlocParse((string) $r['location']), 'remote' => (string) $r['remote'], 'type' => (string) $r['job_type'], 'age' => (int) floor(($now - ((int) $r['posted'] ?: (int) $r['first_seen'])) / 86400000)]; }
  return $pool;
}
function jobTitleScore(array $pts, array $jt): array { // [score 0..1, matched person title]
  $best = 0.0; $bt = ''; $jobDev = isset($jt['developer']) || isset($jt['engineer']) || isset($jt['programmer']);
  foreach ($pts as [$title, $toks]) {
    $w = 0.0; $got = 0.0;
    foreach ($toks as $t) { $role = in_array($t, JOB_ROLE_TOKENS, true); $wt = $role ? 0.5 : 1.0; $w += $wt;
      if (isset($jt[$t])) $got += $wt;
      elseif ($role && in_array($t, ['developer', 'engineer', 'programmer'], true) && $jobDev) $got += $wt * 0.85;
      elseif (isset(JOB_TOKEN_SYN[$t]) && array_intersect_key(array_flip(JOB_TOKEN_SYN[$t]), $jt)) $got += $wt * 0.75; }
    if ($w > 0 && $got / $w > $best) { $best = $got / $w; $bt = $title; }
  }
  return [$best, $bt];
}
function jobLocFit(string $mode, array $locs, array $j): array { // [points, reason, drop]
  $r = $j['remote']; $jl = $j['loc']; $area = 0.0; $where = '';
  foreach ($locs as $pl) { if ($pl['state'] !== '' && $jl['state'] === $pl['state']) { $v = ($pl['city'] !== '' && $jl['city'] === $pl['city']) ? 1.0 : 0.75; if ($v > $area) { $area = $v; $where = $v === 1.0 ? 'Near ' . $pl['label'] : 'In ' . $pl['stateName']; } } }
  $unknown = $jl['state'] === '' && !$jl['remote']; $isRemote = $r === 'Remote' || $jl['remote'];
  switch ($mode) {
    case 'remote': return $isRemote ? [10, 'Remote', false] : [0, '', true];
    case 'hybrid': if ($isRemote) return [10, 'Remote', false]; if ($area > 0) return [2 + 8 * $area, ($r === 'Hybrid' ? 'Hybrid, ' : '') . $where, false]; return [$unknown ? 2 : -8, '', false];
    case 'onsite': if ($area > 0) return [10 * $area, $where, false]; if ($isRemote) return [4, 'Remote', false]; return [$unknown ? 2 : -10, '', false];
    default: if ($area > 0) return [10 * $area, ($r === 'Hybrid' ? 'Hybrid, ' : '') . $where, false]; if ($isRemote) return [9, 'Remote', false]; return [$unknown ? 4 : ($locs ? 0 : 5), '', false];
  }
}
function jobTypeFit(array $types, string $t): array { // [points, reason]
  if (!$types || $t === '') return [0, ''];
  if (in_array($t, $types, true)) return [5, $t];
  $wantContract = (bool) array_intersect($types, JOB_CONTRACT_TYPES); $jobContract = in_array($t, JOB_CONTRACT_TYPES, true);
  if ($jobContract && $wantContract) return [3, $t];
  if (($t === 'Full-time' && !in_array('Full-time', $types, true) && $wantContract) || ($jobContract && !$wantContract)) return [-12, ''];
  return [0, ''];
}
function jobMatchPerson(string $uid, ?array $set = null): int {
  $set = $set ?? jobSettings(); $p = jobPerson($uid); if (!$p) return 0;
  $prof = jdec($p['profile']); $pref = jdec($p['prefs']);
  $titles = array_values(array_filter((array) ($pref['titles'] ?? []), 'is_string')) ?: array_slice(array_values(array_filter((array) ($prof['titles'] ?? []), 'is_string')), 0, 4);
  if (!$titles && !empty($pref['title'])) $titles = [(string) $pref['title']];
  $pts = []; foreach ($titles as $ti) { $tk = array_values(array_diff(jtok($ti), JOB_NEUTRAL_TOKENS)); if ($tk) $pts[] = [$ti, $tk]; }
  $skills = array_values(array_unique(array_merge(array_filter((array) ($prof['skills'] ?? []), 'is_string'), skillsCanon((array) ($pref['skills'] ?? []))))); $sk = array_flip(array_map('strtolower', $skills)); $skName = array_combine(array_map('strtolower', $skills), $skills) ?: [];
  $locs = []; foreach ((array) ($pref['locations'] ?? []) as $l) if (is_string($l) && trim($l) !== '') $locs[] = jlocParse($l);
  if (!$locs) { $l = (string) ($prof['location'] ?? '') ?: (string) ($pref['location'] ?? ''); if ($l !== '') $locs[] = jlocParse($l); }
  $mode = (string) ($pref['remote'] ?? 'any'); $types = array_values(array_intersect((array) ($pref['job_types'] ?? []), JOB_TYPES));
  $must = array_values(array_filter(array_map(fn($x) => mb_strtolower(trim((string) $x)), (array) ($pref['keywords'] ?? [])))); $excl = array_values(array_filter(array_map(fn($x) => mb_strtolower(trim((string) $x)), (array) ($pref['exclude'] ?? []))));
  if (!$pts && !$sk) { jobSaveMatches($uid, []); return 0; }
  $cands = []; $min = max(10, (int) $set['min_score']);
  foreach (jobPool($set) as $j) {
    [$ts, $bt] = $pts ? jobTitleScore($pts, $j['tt']) : [0.0, ''];
    $ov = []; foreach ($j['skl'] as $i => $s) if (isset($sk[$s])) $ov[] = $j['skn'][$i];
    $ovN = count($ov); $jn = count($j['skl']); $ratio = $jn ? $ovN / min($jn, 10) : 0.0;
    if (!($ts >= 0.5 || $ovN >= 3 || ($ovN >= 2 && $ratio >= 0.5) || (!$pts && $ovN >= 2))) continue;
    $base = !$pts ? 80 * min(1.0, $ratio * 1.25) : ($jn ? 42 * $ts + 38 * min(1.0, $ratio * 1.25) : 70 * $ts);
    [$lf, $lr, $drop] = jobLocFit($mode, $locs, $j); if ($drop) continue;
    [$tf, $tr] = jobTypeFit($types, $j['type']);
    $rec = $j['age'] <= 2 ? 5 : ($j['age'] <= 7 ? 3 : ($j['age'] <= 14 ? 1 : 0));
    $score = $base + $lf + $tf + $rec; if ($score < $min - 12) continue;
    $reasons = [];
    if ($ts >= 0.5) $reasons[] = ($ts >= 0.95 ? 'Title matches ' : 'Similar to ') . $bt;
    if ($ovN) $reasons[] = $ovN . ' of your skills: ' . implode(', ', array_slice($ov, 0, 5)) . ($ovN > 5 ? ' +' . ($ovN - 5) : '');
    if ($lr !== '') $reasons[] = $lr; if ($tr !== '') $reasons[] = $tr;
    if ($j['age'] <= 2) $reasons[] = $j['age'] <= 0 ? 'Posted today' : 'Posted ' . $j['age'] . ' day' . ($j['age'] === 1 ? '' : 's') . ' ago';
    $cands[] = ['id' => $j['id'], 'score' => $score, 'reasons' => $reasons];
  }
  usort($cands, fn($a, $b) => $b['score'] <=> $a['score']); $cands = array_slice($cands, 0, 400);
  if (($must || $excl) && $cands) {
    $texts = []; foreach (array_chunk(array_column($cands, 'id'), 150) as $ch) { $s = jdb()->query('SELECT id, title, summary, description FROM job_posts WHERE id IN (' . implode(',', $ch) . ')'); while ($r = $s->fetch()) $texts[(int) $r['id']] = mb_strtolower($r['title'] . "\n" . $r['description']); }
    foreach ($cands as $i => &$c) { $tx = $texts[$c['id']] ?? ''; foreach ($excl as $x) if ($x !== '' && str_contains($tx, $x)) { unset($cands[$i]); continue 2; }
      $hits = []; foreach ($must as $x) if ($x !== '' && str_contains($tx, $x)) $hits[] = $x; if ($hits) { $c['score'] += min(12, 4 * count($hits)); $c['reasons'][] = 'Mentions ' . implode(', ', array_slice($hits, 0, 3)); } }
    unset($c); $cands = array_values($cands); usort($cands, fn($a, $b) => $b['score'] <=> $a['score']);
  }
  $final = []; foreach ($cands as $c) { $c['score'] = (int) max(0, min(100, round($c['score']))); if ($c['score'] < $min) continue; $final[] = $c; if (count($final) >= 150) break; }
  jobSaveMatches($uid, $final);
  jdb()->prepare('UPDATE job_people SET matched_at = ? WHERE uid = ?')->execute([now(), $uid]);
  return count($final);
}
function jobSaveMatches(string $uid, array $final): void {
  $p = jdb(); $now = now(); $s = $p->prepare('SELECT job_id, state FROM job_matches WHERE uid = ?'); $s->execute([$uid]); $cur = []; foreach ($s->fetchAll() as $r) $cur[(int) $r['job_id']] = $r['state'];
  $keep = []; $p->beginTransaction();
  try {
    $ins = $p->prepare('INSERT INTO job_matches (uid, job_id, score, reasons, state, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'); $upd = $p->prepare('UPDATE job_matches SET score = ?, reasons = ?, updated_at = ? WHERE uid = ? AND job_id = ?');
    foreach ($final as $c) { $keep[$c['id']] = 1; $rj = jenc($c['reasons']); if (isset($cur[$c['id']])) $upd->execute([$c['score'], $rj, $now, $uid, $c['id']]); else $ins->execute([$uid, $c['id'], $c['score'], $rj, 'new', $now, $now]); }
    $del = $p->prepare("DELETE FROM job_matches WHERE uid = ? AND job_id = ? AND state = 'new'");
    foreach ($cur as $jid => $st) if (!isset($keep[$jid]) && $st === 'new') $del->execute([$uid, $jid]);
    $p->commit();
  } catch (Throwable $e) { $p->rollBack(); throw $e; }
}
function jobMatchCounts(string $uid): array { $c = ['new' => 0, 'saved' => 0, 'applied' => 0, 'dismissed' => 0]; $s = jdb()->prepare('SELECT state, COUNT(*) AS n FROM job_matches WHERE uid = ? GROUP BY state'); $s->execute([$uid]); foreach ($s->fetchAll() as $r) $c[$r['state']] = (int) $r['n']; return $c; }

/* ---------- output shapes ---------- */
function jobOut(array $r, ?array $m = null, bool $withDesc = false, bool $priv = false): array { // $priv: the caller is staff or a bench recruiter (may see the contact address)
  $posted = (int) $r['posted']; $contact = jobContactEmail($r);
  $o = ['id' => (int) $r['id'], 'title' => $r['title'], 'company' => $r['company'], 'location' => $r['location'], 'remote' => $r['remote'], 'job_type' => $r['job_type'], 'salary' => $r['salary'], 'url' => $r['url'], 'portal' => $r['pub'], 'source' => $r['src'], 'source_name' => jobSourceName((string) $r['src']), 'also' => array_values(array_map(fn($b) => ['portal' => (string) $b['p'], 'url' => (string) $b['u']], jdec($r['boards']))), 'summary' => $r['summary'], 'posted_at' => $posted ?: (int) $r['first_seen'], 'posted' => $posted ? 'Posted ' . jago($posted) : 'Found ' . jago((int) $r['first_seen']), 'published' => (int) $r['published'] > 0, 'skills' => array_slice(jdec($r['skills']), 0, 12), 'contact_email' => $contact !== ''];
  if ($withDesc) { $o['description'] = $r['description']; $o['contact'] = $priv ? $contact : ''; }
  if ($m) { $o['score'] = (int) $m['score']; $o['reasons'] = jdec($m['reasons']); $o['state'] = (string) $m['state']; }
  return $o;
}
function jobRunOut(?array $r, bool $withLog = false, bool $brief = false): ?array {
  if (!$r) return null;
  $o = ['id' => (int) $r['id'], 'kind' => $r['kind'], 'status' => $r['status'], 'started_at' => (int) $r['started_at'], 'finished_at' => (int) $r['finished_at'], 'progress' => ['done' => (int) $r['pos'], 'total' => (int) $r['total']], 'searches' => (int) $r['searches'], 'jobs_found' => (int) $r['jobs_found'], 'jobs_new' => (int) $r['jobs_new']];
  if ($brief) return $o;
  $log = trim((string) $r['logtext']);
  return $o + ['trigger_by' => $r['trigger_by'], 'errors' => jdec($r['errors']), 'search' => jdec($r['search']), 'log' => $withLog ? $log : implode("\n", array_slice(explode("\n", $log), -6))];
}
function jobPersonOut(string $uid): ?array {
  $p = jobPerson($uid); if (!$p) return null; $last = jobRunLast(); $resumes = array_map('jobResumeOut', jobResumeList($uid));
  return ['uid' => $uid, 'name' => $p['name'], 'email' => $p['email'], 'has_resume' => $p['resume_name'] !== '', 'resume_name' => $p['resume_name'], 'resume_at' => (int) $p['resume_at'], 'resumes' => $resumes, 'resume_count' => count($resumes), 'profile' => jdec($p['profile']) + ['titles' => [], 'skills' => [], 'years' => null, 'seniority' => '', 'location' => ''], 'prefs' => jdec($p['prefs']), 'match_counts' => jobMatchCounts($uid), 'matched_at' => (int) $p['matched_at'], 'last_run' => $last ? ['started_at' => (int) $last['started_at'], 'finished_at' => (int) $last['finished_at'], 'jobs_new' => (int) $last['jobs_new'], 'status' => $last['status']] : null];
}
function jobMatchesOut(string $uid, string $state, int $limit = 200): array {
  $sql = 'SELECT jp.*, jm.score, jm.reasons, jm.state FROM job_matches jm JOIN job_posts jp ON jp.id = jm.job_id WHERE jm.uid = ?' . ($state !== '' ? ' AND jm.state = ?' : '') . ' ORDER BY jm.score DESC, jp.posted DESC LIMIT ' . $limit;
  $s = jdb()->prepare($sql); $s->execute($state !== '' ? [$uid, $state] : [$uid]); $out = [];
  while ($r = $s->fetch()) $out[] = jobOut($r, $r);
  return $out;
}

/* ---------- resumes: a consultant keeps several; the primary one feeds job_people and the matching ---------- */
function jobUserRow(string $uid): ?array { if (!preg_match('/^u_[a-f0-9]+$/', $uid)) return null; $s = db()->prepare('SELECT id, email, name, role, status FROM users WHERE id = ?'); $s->execute([$uid]); $r = $s->fetch(); return $r ?: null; }
function jobsCallerIsStaffOrBench(): bool { $u = currentUser(); return $u !== null && (userLevel($u) >= 2 || isBench($u['id'])); }
function jobResumeList(string $uid): array { // primary first, then newest first
  $p = jdb(); $s = $p->prepare('SELECT * FROM job_resumes WHERE uid = ? ORDER BY is_primary DESC, created_at DESC, id DESC'); $s->execute([$uid]); $rows = $s->fetchAll();
  if (!$rows) { // older installs kept one resume on job_people: move it into the list once
    $jp = jobPerson($uid);
    if ($jp && (string) $jp['resume_fid'] !== '') {
      $fd = docGet("u/$uid/f/{$jp['resume_fid']}"); $name = (string) $jp['resume_name'];
      $p->prepare('INSERT INTO job_resumes (uid, fid, name, label, ext, size, text, profile, is_primary, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        ->execute([$uid, (string) $jp['resume_fid'], $name, '', strtolower(pathinfo($name, PATHINFO_EXTENSION)), (int) ($fd->sz ?? 0), (string) $jp['resume_text'], (string) ($jp['profile'] ?: '{}'), 1, (int) $jp['resume_at'] ?: now(), now()]);
      $s->execute([$uid]); $rows = $s->fetchAll();
    }
  }
  return $rows;
}
function jobResumeGet(string $uid, int $id): ?array { $s = jdb()->prepare('SELECT * FROM job_resumes WHERE id = ? AND uid = ?'); $s->execute([$id, $uid]); $r = $s->fetch(); return $r ?: null; }
function jobResumePrimary(string $uid): ?array { foreach (jobResumeList($uid) as $r) if ((int) $r['is_primary'] === 1) return $r; return null; }
function jobResumeOut(array $r): array {
  $pr = jdec($r['profile']); $skills = array_values(array_filter((array) ($pr['skills'] ?? []), 'is_string'));
  return ['id' => (int) $r['id'], 'fid' => $r['fid'], 'name' => $r['name'], 'label' => $r['label'], 'ext' => $r['ext'], 'size' => (int) $r['size'], 'at' => (int) $r['created_at'], 'primary' => (int) $r['is_primary'] === 1,
    'profile' => ['titles' => array_values(array_filter((array) ($pr['titles'] ?? []), 'is_string')), 'skills' => array_slice($skills, 0, 12), 'skills_n' => count($skills), 'years' => $pr['years'] ?? null, 'seniority' => (string) ($pr['seniority'] ?? ''), 'location' => (string) ($pr['location'] ?? '')]];
}
function jobResumeProfileOf(array $r, string $uid): array { // the stored profile, recomputed from the text when it is empty
  $pr = jdec($r['profile']);
  if (empty($pr['titles']) && empty($pr['skills'])) { $root = docGet("u/$uid"); $pp = $root->p ?? null; $pr = resumeProfile((string) $r['text'], (string) ($pp->loc ?? '')); if (!$pr['titles'] && !empty($pp->ti)) $pr['titles'] = [(string) $pp->ti]; jdb()->prepare('UPDATE job_resumes SET profile = ? WHERE id = ?')->execute([jenc($pr), (int) $r['id']]); }
  return $pr;
}
function jobResumeMakePrimary(array $u, int $id): int { // $u = the consultant's user row; returns the number of matches after rematching
  $r = jobResumeGet($u['id'], $id); if (!$r) fail(404, 'not_found', 'No such resume.');
  $now = now(); jdb()->prepare('UPDATE job_resumes SET is_primary = CASE WHEN id = ? THEN 1 ELSE 0 END, updated_at = ? WHERE uid = ?')->execute([$id, $now, $u['id']]);
  $profile = jobResumeProfileOf($r, $u['id']);
  jobPersonSave($u, ['resume_name' => $r['name'], 'resume_fid' => $r['fid'], 'resume_at' => (int) $r['created_at'], 'resume_text' => mb_substr((string) $r['text'], 0, 200000), 'profile' => jenc($profile)]);
  $root = docGet("u/{$u['id']}") ?? new stdClass(); $root->resume = (object) ['fid' => $r['fid'], 'n' => $r['name'], 'at' => (int) $r['created_at']]; docSet("u/{$u['id']}", $root);
  return jobMatchPerson($u['id']);
}
function jobResumeClearPrimary(array $u): int { // no resume left: job_people forgets the resume (preferences stay) and the matches are refreshed
  jobPersonSave($u, ['resume_name' => '', 'resume_fid' => '', 'resume_at' => 0, 'resume_text' => '', 'profile' => '{}']);
  $root = docGet("u/{$u['id']}"); if ($root && isset($root->resume)) { unset($root->resume); docSet("u/{$u['id']}", $root); }
  return jobMatchPerson($u['id']);
}
function jobResumeSave(array $u, array $f, string $clientText, string $label = '', ?bool $primary = null): array { // adds a resume; it becomes the primary one when asked or when it is the first
  if (($f['error'] ?? 1) !== UPLOAD_ERR_OK) fail(400, 'bad_request', 'Choose your resume (PDF, Word or text).');
  $name = mb_substr(basename((string) $f['name']), 0, 180); $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
  if (!in_array($ext, ['pdf', 'docx', 'txt'], true)) fail(400, 'bad_request', 'Upload your resume as PDF, Word (.docx) or plain text.');
  $existing = jobResumeList($u['id']); if (count($existing) >= JOB_MAX_RESUMES) fail(400, 'invalid_argument', 'Up to ' . JOB_MAX_RESUMES . ' resumes can be kept. Delete one first.');
  $text = cleanText($clientText); $how = 'browser';
  if (mb_strlen($text) < 120) { $text = textFromFile((string) $f['tmp_name'], $ext); $how = 'server'; }
  $text = mb_substr($text, 0, 200000);
  $root = docGet("u/{$u['id']}") ?? new stdClass(); $pp = $root->p ?? null;
  $profile = resumeProfile($text, (string) ($pp->loc ?? ''));
  if (!$profile['titles'] && !empty($pp->ti)) $profile['titles'] = [(string) $pp->ti];
  $doc = storeUpload($f, "u/{$u['id']}", ['c' => 'resume']); $now = now(); $makePrimary = $primary === true || !$existing;
  $p = jdb(); $p->prepare('INSERT INTO job_resumes (uid, fid, name, label, ext, size, text, profile, is_primary, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    ->execute([$u['id'], $doc['id'], $name, mb_substr(trim($label), 0, 80), $ext, (int) $doc['sz'], $text, jenc($profile), $makePrimary ? 1 : 0, $now, $now]);
  $id = (int) $p->lastInsertId();
  if ($makePrimary) {
    $p->prepare('UPDATE job_resumes SET is_primary = 0 WHERE uid = ? AND id <> ?')->execute([$u['id'], $id]);
    $root->resume = (object) ['fid' => $doc['id'], 'n' => $doc['n'], 'at' => $now]; docSet("u/{$u['id']}", $root);
    jobPersonSave($u, ['resume_name' => $name, 'resume_fid' => $doc['id'], 'resume_at' => $now, 'resume_text' => $text, 'profile' => jenc($profile)]);
  } elseif (!jobPerson($u['id'])) jobPersonSave($u, null);
  return ['doc' => $doc, 'profile' => $profile, 'read' => ['chars' => mb_strlen($text), 'how' => $how], 'resume' => jobResumeGet($u['id'], $id), 'primary' => $makePrimary];
}
function jobResumeDelete(array $u, int $id): void { // removes the row, the file record and the file; promotes the newest remaining resume when the primary one goes
  $r = jobResumeGet($u['id'], $id); if (!$r) fail(404, 'not_found', 'No such resume.');
  jdb()->prepare('DELETE FROM job_resumes WHERE id = ? AND uid = ?')->execute([$id, $u['id']]);
  $path = "u/{$u['id']}/f/{$r['fid']}"; if (docGet($path)) docDelete($path); $f = cfg('files_dir') . '/' . $r['fid']; if (preg_match('/^[a-f0-9]{32}$/', (string) $r['fid']) && is_file($f)) @unlink($f);
  if ((int) $r['is_primary'] === 1) {
    $jp = jobPerson($u['id']); if ($jp && $jp['resume_fid'] === $r['fid']) jobPersonSave($u, ['resume_name' => '', 'resume_fid' => '', 'resume_at' => 0, 'resume_text' => '', 'profile' => '{}']); // so the list does not re-create it
    $rest = jobResumeList($u['id']); if ($rest) jobResumeMakePrimary($u, (int) $rest[0]['id']); else jobResumeClearPrimary($u);
  }
}

/* ---------- one-click apply ---------- */
function jobContactEmail(array $job): string { // the first plausible contact address in the posting, preferring one near "send/email/resume/reach/contact/apply"
  $d = (string) ($job['description'] ?? ''); if ($d === '' || !str_contains($d, '@')) return '';
  if (!preg_match_all('/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i', $d, $m, PREG_OFFSET_CAPTURE)) return '';
  $skip = ['noreply', 'no-reply', 'donotreply', 'unsubscribe', 'privacy', 'support@', 'abuse@', 'postmaster', 'example.com'];
  $cands = []; foreach ($m[0] as [$e, $off]) { $e = rtrim($e, '.'); $l = strtolower($e); foreach ($skip as $x) if (str_contains($l, $x)) continue 2; if (!filter_var($e, FILTER_VALIDATE_EMAIL)) continue; $cands[] = [$e, $off]; }
  if (!$cands) return '';
  foreach ($cands as [$e, $off]) { $before = strtolower(substr($d, max(0, $off - 120), min(120, $off))); if (preg_match('/\b(send|email|e-mail|resume|resumes|reach|contact|apply)\b/', $before)) return $e; }
  return $cands[0][0];
}
function jobAppOut(array $r, bool $priv): array { // $priv: staff or bench recruiter (sees the address even on bench submissions)
  return ['id' => (int) $r['id'], 'job_id' => (int) $r['job_id'], 'title' => (string) ($r['ptitle'] ?? '') !== '' ? $r['ptitle'] : $r['title'], 'company' => (string) ($r['pcompany'] ?? '') !== '' ? $r['pcompany'] : $r['company'], 'location' => (string) ($r['plocation'] ?? '') !== '' ? $r['plocation'] : $r['location'], 'url' => (string) ($r['purl'] ?? '') !== '' ? $r['purl'] : $r['url'], 'portal' => (string) ($r['pub'] ?? ''),
    'resume_id' => (int) $r['resume_id'], 'resume_name' => $r['resume_name'], 'status' => $r['status'], 'mailed' => (int) $r['mailed'] === 1, 'to' => $priv || $r['kind'] === 'self' ? $r['to_email'] : '', 'kind' => $r['kind'], 'by_name' => $r['by_name'], 'note' => $r['note'], 'at' => (int) $r['created_at'], 'u' => (int) $r['updated_at']];
}
function jobAppsOut(string $uid, bool $priv): array {
  $s = jdb()->prepare('SELECT a.*, jp.title AS ptitle, jp.company AS pcompany, jp.location AS plocation, jp.url AS purl, jp.pub FROM job_apps a LEFT JOIN job_posts jp ON jp.id = a.job_id WHERE a.uid = ? ORDER BY a.created_at DESC LIMIT 400'); $s->execute([$uid]);
  $apps = []; $counts = array_fill_keys(APP_STATES, 0);
  while ($r = $s->fetch()) { $apps[] = jobAppOut($r, $priv); if (isset($counts[$r['status']])) $counts[$r['status']]++; }
  return ['apps' => $apps, 'counts' => $counts];
}
function jobAppGet(int $id): ?array { $s = jdb()->prepare('SELECT a.*, jp.title AS ptitle, jp.company AS pcompany, jp.location AS plocation, jp.url AS purl, jp.pub FROM job_apps a LEFT JOIN job_posts jp ON jp.id = a.job_id WHERE a.id = ?'); $s->execute([$id]); $r = $s->fetch(); return $r ?: null; }
function jobApplyNote(string $tpl, array $vars): string { $o = $tpl; foreach ($vars as $k => $v) $o = str_replace('{' . $k . '}', (string) $v, $o); return trim(preg_replace("/\n{3,}/", "\n\n", $o) ?? $o); }

/* ---------- routes ---------- */
function jobsRoute(string $r, string $method, array $b): void {
  switch ($r) {
    case 'jobs_me': { $u = requireUser(); $set = jobSettings(); session_write_close(); $started = jobMaybeStart($set, 'auto (' . $u['name'] . ')');
      ok(['consultant' => jobPersonOut($u['id']), 'run' => jobRunOut(jobRunActive(), false, userLevel($u) < 2), 'sources' => jobSourcesOn($set)]); }
    case 'jobs_prefs': {
      $u = requireUser(); $root = docGet("u/{$u['id']}"); $prof = $root->p ?? null; $set = jobSettings();
      $prefs = jobsPrefs(is_array($b['prefs'] ?? null) ? $b['prefs'] : [], $prof); $cur = jobPerson($u['id']);
      jobPersonSave($u, ['prefs' => jenc($prefs)]); session_write_close();
      $n = jobMatchPerson($u['id'], $set); $run = null;
      $old = $cur ? jdec($cur['prefs']) : []; $changed = ($old['titles'] ?? []) != $prefs['titles'] || ($old['locations'] ?? []) != $prefs['locations'] || ($old['remote'] ?? 'any') !== $prefs['remote'];
      if ($changed || $n === 0) $run = jobStartPerson($set, $u, 'preferences (' . $u['name'] . ')');
      ok(['consultant' => jobPersonOut($u['id']), 'matches' => $n, 'run' => jobRunOut($run ?? jobRunActive(), false, true)]);
    }
    case 'jobs_resume': { // adds a resume (multipart: file, optional text read in the browser, label, primary '1'|'0')
      $u = requireUser(); if (!isset($_FILES['file'])) fail(400, 'bad_request', 'Choose your resume (PDF, Word or text).');
      $set = jobSettings(); session_write_close(); @set_time_limit(90);
      $primary = isset($_POST['primary']) ? ((string) $_POST['primary'] === '1') : null;
      $res = jobResumeSave($u, $_FILES['file'], (string) ($_POST['text'] ?? ''), (string) ($_POST['label'] ?? ''), $primary);
      $run = null;
      if ($res['primary']) { $n = jobMatchPerson($u['id'], $set); $run = jobStartPerson($set, $u, 'resume (' . $u['name'] . ')'); }
      else { $c = jobMatchCounts($u['id']); $n = $c['new'] + $c['saved'] + $c['applied']; }
      ok(['doc' => $res['doc'], 'resume' => jobResumeOut($res['resume']), 'resumes' => array_map('jobResumeOut', jobResumeList($u['id'])), 'consultant' => jobPersonOut($u['id']), 'matches' => $n, 'read' => $res['read'], 'run' => jobRunOut($run ?? jobRunActive(), false, true)]);
    }
    case 'jobs_resumes': { $u = requireUser(); $list = jobResumeList($u['id']); $prim = null; foreach ($list as $r) if ((int) $r['is_primary'] === 1) $prim = (int) $r['id']; ok(['resumes' => array_map('jobResumeOut', $list), 'primary_id' => $prim]); }
    case 'jobs_resume_set': { // rename and/or make primary
      $u = requireUser(); $id = (int) ($b['id'] ?? 0); $r = $id > 0 ? jobResumeGet($u['id'], $id) : null; if (!$r) fail(404, 'not_found', 'No such resume.');
      $n = null; session_write_close();
      if (array_key_exists('label', $b)) jdb()->prepare('UPDATE job_resumes SET label = ?, updated_at = ? WHERE id = ?')->execute([str($b, 'label', 80), now(), $id]);
      if (!empty($b['primary']) && (int) $r['is_primary'] !== 1) $n = jobResumeMakePrimary($u, $id);
      if ($n === null) { $c = jobMatchCounts($u['id']); $n = $c['new'] + $c['saved'] + $c['applied']; }
      ok(['resumes' => array_map('jobResumeOut', jobResumeList($u['id'])), 'consultant' => jobPersonOut($u['id']), 'matches' => $n]);
    }
    case 'jobs_resume_delete': {
      $u = requireUser(); $id = (int) ($b['id'] ?? 0); if ($id <= 0) fail(400, 'bad_request', 'Bad resume.');
      session_write_close(); jobResumeDelete($u, $id);
      ok(['resumes' => array_map('jobResumeOut', jobResumeList($u['id'])), 'consultant' => jobPersonOut($u['id'])]);
    }
    case 'jobs_matches': { $u = requireUser(); $st = str($_GET, 'state', 12); if (!in_array($st, JOB_STATES, true)) $st = ''; ok(['matches' => jobMatchesOut($u['id'], $st), 'counts' => jobMatchCounts($u['id'])]); }
    case 'jobs_mark': {
      $u = requireUser(); $jid = (int) ($b['job_id'] ?? 0); $st = str($b, 'state', 12);
      if ($jid <= 0 || !in_array($st, JOB_STATES, true)) fail(400, 'bad_request', 'Bad job or state.');
      $s = jdb()->prepare('SELECT 1 FROM job_matches WHERE uid = ? AND job_id = ?'); $s->execute([$u['id'], $jid]);
      if ($s->fetchColumn()) jdb()->prepare('UPDATE job_matches SET state = ?, updated_at = ? WHERE uid = ? AND job_id = ?')->execute([$st, now(), $u['id'], $jid]);
      else { $j = jdb()->prepare('SELECT id FROM job_posts WHERE id = ?'); $j->execute([$jid]); if (!$j->fetchColumn()) fail(404, 'not_found', 'That job is no longer available.'); jdb()->prepare('INSERT INTO job_matches (uid, job_id, score, reasons, state, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')->execute([$u['id'], $jid, 0, '[]', $st, now(), now()]); }
      ok(['ok' => true, 'counts' => jobMatchCounts($u['id'])]);
    }
    case 'jobs_rematch': { $u = requireUser(); session_write_close(); ok(['matches' => jobMatchPerson($u['id']), 'counts' => jobMatchCounts($u['id'])]); }
    case 'jobs_job': { requireUser(); $s = jdb()->prepare('SELECT * FROM job_posts WHERE id = ?'); $s->execute([(int) ($_GET['id'] ?? 0)]); $j = $s->fetch(); if (!$j) fail(404, 'not_found', 'No such job.'); ok(['job' => jobOut($j, null, true, jobsCallerIsStaffOrBench())]); }
    case 'jobs_apply': jobsApply($b);
    case 'jobs_apps': { // a consultant's applications; staff and bench recruiters may pass uid
      $me = requireUser(); $priv = jobsCallerIsStaffOrBench(); $uid = str($_GET, 'uid', 40);
      if ($uid !== '' && $uid !== $me['id']) { if (!$priv) fail(403, 'invalid_argument', 'You can only see your own applications.'); if (!jobUserRow($uid)) fail(404, 'not_found', 'No such consultant.'); } else $uid = $me['id'];
      ok(jobAppsOut($uid, $priv));
    }
    case 'jobs_app_set': { // the consultant, staff, or the recruiter who submitted it may change the status and note
      $me = requireUser(); $id = (int) ($b['id'] ?? 0); $a = $id > 0 ? jobAppGet($id) : null; if (!$a) fail(404, 'not_found', 'No such application.');
      $staff = userLevel($me) >= 2; if (!($a['uid'] === $me['id'] || $staff || $a['by_uid'] === $me['id'])) fail(403, 'invalid_argument', 'You can\'t change this application.');
      $st = str($b, 'status', 12); if (!in_array($st, APP_STATES, true)) fail(400, 'bad_request', 'Bad status.');
      $note = array_key_exists('note', $b) ? str($b, 'note', 1000) : (string) $a['note'];
      jdb()->prepare('UPDATE job_apps SET status = ?, note = ?, updated_at = ? WHERE id = ?')->execute([$st, $note, now(), $id]);
      if ($a['kind'] === 'bench') { // keep the RTR / submissions log in step
        $q = db()->prepare("SELECT path, data FROM docs WHERE col = 'rec/sub/items'"); $q->execute();
        while ($row = $q->fetch()) { $d = json_decode($row['data']); if ($d instanceof stdClass && (int) ($d->app_id ?? 0) === $id) { $d->st = $st === 'applied' ? 'submitted' : $st; $d->u = now(); $d->un = $me['name']; docSet($row['path'], $d); break; } }
      }
      ok(['app' => jobAppOut(jobAppGet($id), $staff || isBench($me['id']) || $a['kind'] === 'self')]);
    }
    case 'jobs_tick': {
      $u = requireUser(); session_write_close(); @set_time_limit(60); ignore_user_abort(true);
      $worked = jobStep(8000); $want = (int) ($b['id'] ?? 0); $out = $want ? jobRunGet($want) : ($worked ?? jobRunActive());
      ok(['run' => jobRunOut($out, false, userLevel($u) < 2), 'active' => jobRunActive() !== null]);
    }
    case 'jobs_cron': {
      $key = (string) ($_GET['key'] ?? ''); $want = (string) jkvGet('cron_key', '');
      if ($want === '' || $key === '' || !hash_equals($want, $key)) fail(403, 'forbidden', 'Wrong cron key.');
      session_write_close(); @set_time_limit(120); ignore_user_abort(true);
      ok(jobCron(false));
    }
    case 'jobs_admin': jobsAdmin($method, $b);
  }
  fail(404, 'not_found', 'Unknown route.');
}
function jobsAdmin(string $method, array $b): void {
  // Staff (admin, HR, accounting) may do everything. Bench sales recruiters get the grabber, runs, collected jobs, consultants, matches, resumes and applications; never sources, keys, settings or the cron URL.
  $me = requireUser(); $staff = userLevel($me) >= 2; $bench = !$staff && isBench($me['id']);
  if (!$staff && !$bench) fail(403, 'invalid_argument', 'Only StratEdge staff and bench sales recruiters can use the job grabber.');
  $src = $method === 'POST' ? $b : $_GET; $op = str($src, 'op', 24); $set = jobSettings();
  if ($bench && !in_array($op, JOBS_BENCH_OPS, true)) fail(403, 'invalid_argument', 'That part of the job grabber is for StratEdge staff.');
  switch ($op) {
    case 'overview': {
      $p = jdb(); $jobs = (int) $p->query('SELECT COUNT(*) FROM job_posts')->fetchColumn(); $w = $p->prepare('SELECT COUNT(*) FROM job_posts WHERE first_seen >= ?'); $w->execute([now() - 7 * 86400000]);
      $people = (int) $p->query("SELECT COUNT(*) FROM job_people WHERE resume_name <> ''")->fetchColumn(); $active = jobRunActive(); $last = jobRunLast(); $lastAll = (int) $p->query("SELECT MAX(started_at) FROM job_runs WHERE kind = 'all'")->fetchColumn();
      $st = (array) jkvGet('srcstat', []); $list = [];
      foreach (jobSources() as $k => $m) { $c = $set['sources'][$k]; $list[] = ['key' => $k, 'name' => $m['name'], 'kind' => $m['kind'], 'remote' => !empty($m['remote']), 'on' => !empty($c['on']), 'ready' => jobReady($k, $c), 'status' => $staff ? ($st[$k] ?? null) : null]; }
      foreach ($set['feeds'] as $f) $list[] = ['key' => 'feed:' . $f['id'], 'name' => (string) $f['name'], 'kind' => str_contains((string) $f['url'], '{keywords}') ? 'search' : 'feed', 'remote' => false, 'on' => !empty($f['on']), 'ready' => true, 'status' => $staff ? ($st['feed:' . $f['id']] ?? null) : null];
      $apps = (int) $p->query('SELECT COUNT(*) FROM job_apps')->fetchColumn(); $aw = $p->prepare('SELECT COUNT(*) FROM job_apps WHERE created_at >= ?'); $aw->execute([now() - 7 * 86400000]);
      $o = ['sources' => $list, 'sources_on' => jobSourcesOn($set), 'jobs' => $jobs, 'jobs_7d' => (int) $w->fetchColumn(), 'consultants_with_resume' => $people, 'apps' => $apps, 'apps_7d' => (int) $aw->fetchColumn(), 'running' => $active !== null, 'run' => jobRunOut($active), 'last_run' => jobRunOut($last), 'schedule_hours' => (float) $set['schedule_hours'], 'next_run_at' => $set['schedule_hours'] > 0 && $lastAll ? (int) ($lastAll + $set['schedule_hours'] * 3600000) : 0];
      if ($staff) { $o['settings'] = ['schedule_hours' => $set['schedule_hours'], 'max_age_days' => $set['max_age_days'], 'keep_days' => $set['keep_days'], 'max_searches' => $set['max_searches'], 'min_score' => $set['min_score']]; $o['cron'] = jobCronInfo(); }
      ok($o);
    }
    case 'sources': {
      $st = (array) jkvGet('srcstat', []); $out = []; $use = (array) jkvGet('jsearch_month', []);
      foreach (jobSources() as $k => $m) { $c = $set['sources'][$k]; $fields = [];
        foreach ($m['fields'] as $fk => [$label, $secret]) { $v = (string) ($c[$fk] ?? ''); $fields[] = ['k' => $fk, 'label' => $label, 'secret' => $secret, 'set' => $v !== '', 'value' => $secret ? ($v === '' ? '' : '••••' . substr($v, -4)) : $v]; }
        $o = ['key' => $k, 'name' => $m['name'], 'kind' => $m['kind'], 'remote' => !empty($m['remote']), 'cost' => $m['cost'], 'link' => $m['link'], 'about' => $m['about'], 'on' => !empty($c['on']), 'ready' => jobReady($k, $c), 'per_run' => (int) $c['per_run'], 'fields' => $fields, 'status' => $st[$k] ?? null];
        if (isset($m['month_cap'])) $o['month'] = ['cap' => (int) ($c['month_cap'] ?? $m['month_cap']), 'used' => ($use['m'] ?? '') === date('Y-m') ? (int) ($use['n'] ?? 0) : 0];
        if ($k === 'adzuna') $o['country'] = (string) ($c['country'] ?? 'us');
        $out[] = $o; }
      $feeds = array_map(fn($f) => ['id' => $f['id'], 'name' => (string) $f['name'], 'url' => (string) $f['url'], 'on' => !empty($f['on']), 'status' => $st['feed:' . $f['id']] ?? null], $set['feeds']);
      ok(['sources' => $out, 'feeds' => $feeds, 'settings' => ['schedule_hours' => $set['schedule_hours'], 'max_age_days' => $set['max_age_days'], 'keep_days' => $set['keep_days'], 'max_searches' => $set['max_searches'], 'min_score' => $set['min_score']], 'cron' => jobCronInfo()]);
    }
    case 'source_save': {
      $k = str($b, 'key', 20); $m = jobSources()[$k] ?? null; if (!$m) fail(400, 'bad_request', 'Unknown source.');
      $c = $set['sources'][$k];
      if (array_key_exists('on', $b)) $c['on'] = (bool) $b['on'];
      if (isset($b['per_run'])) $c['per_run'] = max(1, min(100, (int) $b['per_run']));
      if (isset($b['month_cap']) && isset($m['month_cap'])) $c['month_cap'] = max(1, min(100000, (int) $b['month_cap']));
      if ($k === 'adzuna' && isset($b['country'])) $c['country'] = preg_match('/^[a-z]{2}$/', strtolower(str($b, 'country', 2))) ? strtolower(str($b, 'country', 2)) : 'us';
      foreach ((array) ($b['fields'] ?? []) as $fk => $v) { if (!isset($m['fields'][$fk]) || !is_scalar($v)) continue; $v = trim((string) $v); if ($v !== '') $c[$fk] = mb_substr($v, 0, 200); }
      foreach ((array) ($b['clear'] ?? []) as $fk) if (is_string($fk) && isset($m['fields'][$fk])) $c[$fk] = '';
      if (!empty($c['on']) && !jobReady($k, $c)) { $c['on'] = false; $set['sources'][$k] = $c; jobSettingsSave($set); fail(400, 'bad_request', 'Enter the ' . implode(' and ', array_map(fn($f) => $f[0], $m['fields'])) . ' before turning ' . $m['name'] . ' on.'); }
      $set['sources'][$k] = $c; jobSettingsSave($set); ok(['ok' => true, 'on' => !empty($c['on']), 'ready' => jobReady($k, $c)]);
    }
    case 'source_test': {
      $k = str($b, 'key', 40); session_write_close(); @set_time_limit(60);
      if (str_starts_with($k, 'feed:')) { $cfg = jobFeedCfg($set, substr($k, 5)); if (!$cfg) fail(404, 'not_found', 'No such feed.'); }
      else { $m = jobSources()[$k] ?? null; if (!$m) fail(400, 'bad_request', 'Unknown source.'); $cfg = $set['sources'][$k]; if (!jobReady($k, $cfg)) fail(400, 'bad_request', 'Enter the key first.'); }
      $q = ['q' => str($b, 'q', 60) ?: 'software engineer', 'loc' => '', 'remote' => 'any', 'days' => 30, 'types' => []];
      if ($k === 'jsearch') { $u = (array) jkvGet('jsearch_month', []); jkvSet('jsearch_month', ['m' => date('Y-m'), 'n' => (($u['m'] ?? '') === date('Y-m') ? (int) ($u['n'] ?? 0) : 0) + 1]); }
      $res = jobFetch($k, $q, $cfg); jobSourceStatus($k, $res['error'], count($res['jobs']));
      ok(['ok' => $res['error'] === '', 'n' => count($res['jobs']), 'error' => $res['error'], 'sample' => array_map(fn($j) => $j['title'] . ($j['company'] !== '' ? ' — ' . $j['company'] : '') . ($j['location'] !== '' ? ' (' . $j['location'] . ')' : ''), array_slice($res['jobs'], 0, 5))]);
    }
    case 'feed_save': {
      $id = preg_match('/^[a-f0-9]{8}$/', (string) ($b['id'] ?? '')) ? (string) $b['id'] : ''; $name = str($b, 'name', 60); $url = str($b, 'url', 500);
      if ($name === '' || !preg_match('#^https?://\S+$#i', $url)) fail(400, 'bad_request', 'Give the feed a name and a full web address (https://...).');
      $found = false; foreach ($set['feeds'] as &$f) if ($f['id'] === $id) { $f['name'] = $name; $f['url'] = $url; if (array_key_exists('on', $b)) $f['on'] = (bool) $b['on']; $found = true; } unset($f);
      if (!$found) { if (count($set['feeds']) >= 20) fail(400, 'bad_request', 'Up to 20 feeds can be added.'); $set['feeds'][] = ['id' => bin2hex(random_bytes(4)), 'name' => $name, 'url' => $url, 'on' => !isset($b['on']) || !empty($b['on'])]; }
      jobSettingsSave($set); ok(['ok' => true, 'feeds' => $set['feeds']]);
    }
    case 'feed_toggle': { $id = (string) ($b['id'] ?? ''); foreach ($set['feeds'] as &$f) if ($f['id'] === $id) $f['on'] = (bool) ($b['on'] ?? false); unset($f); jobSettingsSave($set); ok(['ok' => true]); }
    case 'feed_delete': { $id = (string) ($b['id'] ?? ''); $set['feeds'] = array_values(array_filter($set['feeds'], fn($f) => $f['id'] !== $id)); jobSettingsSave($set); ok(['ok' => true]); }
    case 'settings_save': {
      foreach (['schedule_hours' => [0, 168], 'max_age_days' => [1, 60], 'keep_days' => [7, 180], 'max_searches' => [1, 100], 'min_score' => [10, 90]] as $k => [$lo, $hi]) if (isset($b[$k]) && is_numeric($b[$k])) $set[$k] = max($lo, min($hi, $k === 'schedule_hours' ? round((float) $b[$k], 1) : (int) $b[$k]));
      jobSettingsSave($set); ok(['ok' => true, 'settings' => ['schedule_hours' => $set['schedule_hours'], 'max_age_days' => $set['max_age_days'], 'keep_days' => $set['keep_days'], 'max_searches' => $set['max_searches'], 'min_score' => $set['min_score']]]);
    }
    case 'cron_key': { jobCronKey(true); ok(['cron' => jobCronInfo()]); }
    case 'runs': { $lim = max(1, min(100, (int) ($_GET['limit'] ?? 20))); $s = jdb()->query('SELECT * FROM job_runs ORDER BY id DESC LIMIT ' . $lim); $runs = []; while ($r = $s->fetch()) $runs[] = jobRunOut($r); ok(['runs' => $runs, 'running' => jobRunActive() !== null]); }
    case 'run_log': { $r = jobRunGet((int) ($_GET['id'] ?? 0)); if (!$r) fail(404, 'not_found', 'No such run.'); ok(['run' => jobRunOut($r, true)]); }
    case 'run': { session_write_close(); if ($a = jobRunActive()) ok(['run' => jobRunOut($a), 'already' => true]); $r = jobStartAll($set, 'portal (' . $me['name'] . ')'); if ($r['error'] !== '') fail(400, 'bad_request', $r['error']); ok(['run' => jobRunOut($r['run'])]); }
    case 'stop': { $id = (int) ($b['id'] ?? 0); jdb()->prepare("UPDATE job_runs SET status = 'cancelled', finished_at = ?, plan = '[]' WHERE id = ? AND status IN ('running','queued')")->execute([now(), $id]); ok(['ok' => true, 'run' => jobRunOut(jobRunGet($id))]); }
    case 'step': { session_write_close(); @set_time_limit(60); ignore_user_abort(true); $worked = jobStep(8000); $want = (int) ($b['id'] ?? 0); ok(['run' => jobRunOut($want ? jobRunGet($want) : ($worked ?? jobRunActive())), 'active' => jobRunActive() !== null]); }
    case 'jobs': {
      $q = str($_GET, 'q', 120); $sf = str($_GET, 'source', 40); $off = max(0, (int) ($_GET['offset'] ?? 0)); $where = []; $args = [];
      if ($q !== '') { $where[] = '(title LIKE ? OR company LIKE ? OR location LIKE ? OR summary LIKE ? OR skills LIKE ?)'; $like = '%' . $q . '%'; array_push($args, $like, $like, $like, $like, $like); }
      if ($sf !== '') { $where[] = 'src = ?'; $args[] = $sf; }
      $w = $where ? ' WHERE ' . implode(' AND ', $where) : ''; $p = jdb();
      $c = $p->prepare('SELECT COUNT(*) FROM job_posts' . $w); $c->execute($args);
      $s = $p->prepare('SELECT * FROM job_posts' . $w . ' ORDER BY CASE WHEN posted > 0 THEN posted ELSE first_seen END DESC LIMIT 100 OFFSET ' . $off); $s->execute($args); $jobs = []; while ($r = $s->fetch()) $jobs[] = jobOut($r);
      ok(['jobs' => $jobs, 'total' => (int) $c->fetchColumn()]);
    }
    case 'consultants': {
      $out = []; foreach (jdb()->query('SELECT jp.*, u.status FROM job_people jp JOIN users u ON u.id = jp.uid ORDER BY jp.updated_at DESC')->fetchAll() as $p) $out[] = ['uid' => $p['uid'], 'name' => $p['name'], 'email' => $p['email'], 'status' => $p['status'], 'has_resume' => $p['resume_name'] !== '', 'resume_name' => $p['resume_name'], 'resume_at' => (int) $p['resume_at'], 'resume_count' => count(jobResumeList((string) $p['uid'])), 'profile' => jdec($p['profile']) + ['titles' => [], 'location' => '', 'skills' => []], 'prefs' => jdec($p['prefs']), 'match_counts' => jobMatchCounts((string) $p['uid']), 'matched_at' => (int) $p['matched_at']];
      ok(['consultants' => $out]);
    }
    case 'matches': { $uid = str($_GET, 'uid', 40); if (!preg_match('/^u_[a-f0-9]+$/', $uid)) fail(400, 'bad_request', 'Bad consultant.'); ok(['matches' => jobMatchesOut($uid, str($_GET, 'state', 12) ?: ''), 'counts' => jobMatchCounts($uid)]); }
    case 'resumes': { $uid = str($_GET, 'uid', 40); $cu = jobUserRow($uid); if (!$cu) fail(404, 'not_found', 'No such consultant.'); ok(['resumes' => array_map('jobResumeOut', jobResumeList($uid)), 'name' => $cu['name'], 'email' => $cu['email']]); }
    case 'apps': { $uid = str($_GET, 'uid', 40); if (!jobUserRow($uid)) fail(404, 'not_found', 'No such consultant.'); ok(jobAppsOut($uid, true)); }
    case 'rematch_all': { session_write_close(); @set_time_limit(120); $n = 0; foreach (jobPeopleActive() as $p) { jobMatchPerson((string) $p['uid'], $set); $n++; } ok(['people' => $n]); }
    case 'grab': {
      $kws = array_values(array_filter(array_map(fn($x) => is_scalar($x) ? mb_substr(trim((string) $x), 0, 80) : '', (array) ($b['keywords'] ?? [])), fn($x) => $x !== '')); $kws = array_slice($kws, 0, 10);
      if (!$kws) fail(400, 'bad_request', 'Type at least one job title or keyword.');
      $loc = str($b, 'location', 80); $remote = in_array($b['remote'] ?? '', ['any', 'remote', 'hybrid', 'onsite'], true) ? (string) $b['remote'] : 'any'; $days = max(1, min(60, (int) ($b['posted_days'] ?? 7)));
      $only = array_values(array_filter((array) ($b['sources'] ?? []), 'is_string')); if (!$only) fail(400, 'bad_request', 'Pick at least one source.');
      $queries = array_map(fn($k) => ['q' => $k, 'loc' => $remote === 'remote' ? '' : $loc, 'remote' => $remote, 'types' => []], $kws);
      $plan = jobPlan($set, $queries, $only, 'grab', array_column(jobPeopleActive(), 'uid'), $days);
      if (!array_filter($plan, fn($t) => in_array($t['t'], ['search', 'feed'], true))) fail(400, 'bad_request', 'None of the chosen sources is turned on and ready. Check them under Sources.');
      ok(['run' => jobRunOut(jobRunStart('grab', 'grab (' . $me['name'] . ')', $plan, jobSearchList($queries)))]);
    }
    case 'run_jobs': { $id = (int) ($_GET['id'] ?? 0); $s = jdb()->prepare('SELECT jp.* FROM job_run_jobs rj JOIN job_posts jp ON jp.id = rj.job_id WHERE rj.run_id = ? ORDER BY CASE WHEN jp.posted > 0 THEN jp.posted ELSE jp.first_seen END DESC LIMIT 300'); $s->execute([$id]); $jobs = []; while ($r = $s->fetch()) $jobs[] = jobOut($r); ok(['jobs' => $jobs]); }
    case 'publish': {
      $jid = (int) ($b['job_id'] ?? 0); $s = jdb()->prepare('SELECT * FROM job_posts WHERE id = ?'); $s->execute([$jid]); $j = $s->fetch(); if (!$j) fail(404, 'not_found', 'No such job.');
      $id = 'g' . $jid; $cur = docGet("org/site/jobs/$id"); $m = jobSources()[$j['src']] ?? null;
      $md = $j['remote'] === 'Remote' ? 'Remote' : ($j['remote'] === 'Hybrid' ? 'Hybrid' : 'Onsite'); $ty = in_array($j['job_type'], JOB_TYPES, true) ? ($j['job_type'] === 'Contract' ? 'C2C' : $j['job_type']) : 'C2C';
      $desc = trim((string) $j['description']) ?: trim((string) $j['summary']);
      $doc = (object) ['ti' => mb_substr((string) $j['title'], 0, 160), 'loc' => mb_substr((string) $j['location'], 0, 120), 'ty' => $ty, 'md' => $md, 'sk' => implode(', ', array_slice(jdec($j['skills']), 0, 8)), 'd' => mb_substr($desc, 0, 4000), 'open' => true, 'at' => $cur->at ?? now(), 'by' => $me['id'],
        'src' => (object) ['portal' => $j['pub'], 'url' => $j['url'], 'company' => $j['company'], 'job_id' => $jid, 'source' => $j['src'], 'credit' => $m ? !empty($m['credit']) : false]];
      if ($cur) foreach (['ti', 'loc', 'ty', 'md', 'sk', 'd', 'open'] as $k) if (isset($cur->$k) && ($b['overwrite'] ?? false) !== true) $doc->$k = $cur->$k;
      docSet("org/site/jobs/$id", $doc); jdb()->prepare('UPDATE job_posts SET published = 1 WHERE id = ?')->execute([$jid]);
      ok(['id' => $id, 'job' => $doc]);
    }
    case 'unpublish': { $jid = (int) ($b['job_id'] ?? 0); if (docGet("org/site/jobs/g$jid")) docDelete("org/site/jobs/g$jid"); jdb()->prepare('UPDATE job_posts SET published = 0 WHERE id = ?')->execute([$jid]); ok(['ok' => true]); }
    default: fail(400, 'bad_request', 'Unknown job action.');
  }
}

/* ---------- one-click apply: log the application, mark the match applied, email the resume to the posting's contact, and for bench recruiters log the submission ---------- */
function jobsApply(array $b): void {
  $me = requireUser(); $staff = userLevel($me) >= 2; $priv = $staff || isBench($me['id']);
  $uid = str($b, 'uid', 40); $kind = 'self';
  if ($uid !== '' && $uid !== $me['id']) { if (!$priv) fail(403, 'invalid_argument', 'Only StratEdge staff and bench sales recruiters can submit someone else.'); $kind = 'bench'; }
  else $uid = $me['id'];
  $cu = $kind === 'self' ? $me : jobUserRow($uid); if (!$cu || $cu['status'] !== 'active') fail(404, 'not_found', 'No such consultant.');
  if (throttleHit('apply:' . $me['id'], 60, 3600)) fail(429, 'rate_limited', 'That is a lot of applications for one hour. Try again later.');
  $jid = (int) ($b['job_id'] ?? 0); $s = jdb()->prepare('SELECT * FROM job_posts WHERE id = ?'); $s->execute([$jid]); $job = $s->fetch(); if (!$job) fail(404, 'not_found', 'That job is no longer available.');
  $rid = (int) ($b['resume_id'] ?? 0); $resume = $rid > 0 ? jobResumeGet($uid, $rid) : jobResumePrimary($uid);
  if ($rid > 0 && !$resume) fail(400, 'bad_request', 'That resume does not belong to this consultant.');
  if (!$resume) fail(400, 'bad_request', $kind === 'self' ? 'Upload a resume first.' : 'This consultant has no resume in the portal yet.');
  $note = str($b, 'note', 1500); $jp = jobPerson($uid); $pref = $jp ? jdec($jp['prefs']) : []; $root = docGet("u/$uid"); $pp = $root->p ?? null;
  // where to send: staff / bench recruiters choose (the address they typed; an empty 'to' means log only), consultants use the address found in the posting
  if ($priv && array_key_exists('to', $b)) { $to = strtolower(str($b, 'to', 190)); if ($to !== '' && !filter_var($to, FILTER_VALIDATE_EMAIL)) fail(400, 'bad_request', 'Enter a valid email address to send the resume to, or leave it empty.'); }
  else $to = jobContactEmail($job);
  if ($kind === 'self' && ($pref['apply_email'] ?? true) === false) $to = '';
  // the cover note
  $profile = jobResumeProfileOf($resume, $uid) + ['titles' => [], 'skills' => [], 'years' => null, 'location' => ''];
  $title = (string) (($pref['titles'][0] ?? '') ?: ($profile['titles'][0] ?? '') ?: ($pp->ti ?? '') ?: 'consultant');
  $skills = array_slice(array_values(array_filter((array) $profile['skills'], 'is_string')), 0, 6); if (!$skills) $skills = array_slice((array) ($pref['skills'] ?? []), 0, 6);
  $years = $profile['years'] !== null ? $profile['years'] . ' years' : 'several years';
  $loc = (string) (($pref['locations'][0] ?? '') ?: $profile['location'] ?: ($pp->loc ?? '') ?: 'the US');
  $types = array_values(array_intersect((array) ($pref['job_types'] ?? []), JOB_TYPES)); $typesText = $types ? implode(', ', $types) : 'contract or full-time roles';
  $phone = (string) ($pp->ph ?? ''); $email = (string) $cu['email'];
  $signature = $kind === 'self' ? implode("\n", array_values(array_filter([$cu['name'], $phone, $email]))) : $me['name'] . ", StratEdge IT Consulting\n" . $me['email'];
  $tpl = trim((string) ($pref['apply_note'] ?? ''));
  if ($tpl === '') $tpl = "Hello,\n\nPlease consider {name} for the {job} role" . ($job['company'] !== '' ? ' at {company}' : '') . ". {name} is a {title} with {years} of experience in {skills}, based in {location}, available for {types}.\n\nThe resume is attached. Reply to this email to schedule a call.\n\n{signature}";
  $vars = ['name' => $cu['name'], 'title' => $title, 'job' => $job['title'], 'company' => $job['company'], 'years' => $years, 'skills' => $skills ? implode(', ', $skills) : $title, 'location' => $loc, 'types' => $typesText, 'phone' => $phone, 'email' => $email, 'signature' => $signature, 'recruiter' => $me['name']];
  $text = jobApplyNote($tpl, $vars); if (!str_contains($tpl, '{signature}')) $text .= "\n\n" . $signature;
  // email, only when an address is known and the resume file is still there
  $mailed = false; $subject = 'Application: ' . $job['title'] . ' – ' . $cu['name'];
  if ($to !== '') {
    $f = cfg('files_dir') . '/' . $resume['fid']; $data = preg_match('/^[a-f0-9]{32}$/', (string) $resume['fid']) ? @file_get_contents($f) : false;
    if ($data === false) fail(400, 'bad_request', 'The resume file is missing. Upload it again.');
    $att = [['name' => (string) $resume['name'], 'type' => MIME[$resume['ext']] ?? 'application/octet-stream', 'data' => $data]];
    $foot = ($kind === 'self' ? 'Sent by ' . $cu['name'] : 'Sent by ' . $me['name'] . ' at StratEdge IT Consulting') . ' through the StratEdge portal. Reply to this email to reach them.';
    $mailed = sendMail($to, '', $subject, $text, emailHtml($subject, preg_split('/\n{2,}/', $text) ?: [$text], null, $foot), $att, (string) $me['email']);
  }
  // record it
  $now = now(); $p = jdb();
  $p->prepare('INSERT INTO job_apps (uid, job_id, resume_id, resume_name, by_uid, by_name, kind, status, to_email, mailed, note, title, company, location, url, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    ->execute([$uid, $jid, (int) $resume['id'], (string) $resume['name'], $me['id'], $me['name'], $kind, 'applied', $to, $mailed ? 1 : 0, $note, (string) $job['title'], (string) $job['company'], (string) $job['location'], (string) $job['url'], $now, $now]);
  $appId = (int) $p->lastInsertId();
  $m = $p->prepare('SELECT 1 FROM job_matches WHERE uid = ? AND job_id = ?'); $m->execute([$uid, $jid]);
  if ($m->fetchColumn()) $p->prepare('UPDATE job_matches SET state = ?, updated_at = ? WHERE uid = ? AND job_id = ?')->execute(['applied', $now, $uid, $jid]);
  else $p->prepare('INSERT INTO job_matches (uid, job_id, score, reasons, state, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')->execute([$uid, $jid, 0, '[]', 'applied', $now, $now]);
  if ($kind === 'bench') { // the recruiting workspace sees it under RTRs & submissions
    $nid = bin2hex(random_bytes(6)); $loc2 = (string) $job['location'];
    docSet("rec/sub/items/$nid", (object) ['d' => date('Y-m-d'), 'cid' => '', 'cn' => $cu['name'], 'req' => $job['title'] . ($loc2 !== '' ? ', ' . $loc2 : ''), 'vn' => $job['company'] !== '' ? $job['company'] : (string) $job['pub'], 'vw' => (string) $job['url'], 'rn' => '', 'rp' => '', 're' => $to, 'ec' => '', 'mn' => '', 'mp' => '', 'mem' => '', 'rate' => '', 'rtr' => false, 'rtrAt' => '', 'st' => 'submitted', 'intv' => '',
      'notes' => 'One-click submit from the job grabber' . ($note !== '' ? ': ' . $note : ''), 'by' => $me['id'], 'byn' => $me['name'], 'at' => $now, 'u' => $now, 'un' => $me['name'], 'job_id' => $jid, 'app_id' => $appId]);
  }
  ok(['app' => jobAppOut(jobAppGet($appId), $priv), 'mailed' => $mailed, 'to' => $priv ? $to : '', 'url' => (string) $job['url'], 'counts' => jobMatchCounts($uid)]);
}
