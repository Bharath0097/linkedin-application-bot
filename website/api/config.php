<?php
// StratEdge portal settings. Edit the values below if needed.
return [
  // Database. SQLite needs no setup (the file is created automatically).
  // For MySQL use: 'mysql:host=localhost;dbname=YOUR_DB;charset=utf8mb4' plus db_user and db_pass.
  'dsn' => 'sqlite:' . __DIR__ . '/../storage/app.sqlite',
  'db_user' => '',
  'db_pass' => '',
  // Uploaded files (timesheets, documents, resumes). Must be writable by the web server.
  'files_dir' => __DIR__ . '/../storage/files',
  // Optional: create the first administrator automatically. Leave admin_email empty to make
  // the first person who registers on the site the administrator instead.
  'admin_email' => 'info@stratedgeitconsulting.com',
  'admin_name' => 'StratEdge Admin',
  'admin_password' => 'Se-D32A9Gd0M2dU!',   // temporary: change it after the first login (Admin > Team > your card > Reset password)
  'max_upload_mb' => 10,
  'session_name' => 'stratedge_portal',
  'public_forms_per_hour' => 20,
  // Website assistant ("StratEdge"). It answers from api/knowledge.php. To let it hold open-ended
  // conversations, add a hosted language model that supports the standard chat-completions API:
  // the endpoint URL, an API key and the model name from that provider (usage is billed to that key).
  'assistant_api_url' => '',
  'assistant_api_key' => '',
  'assistant_model' => '',
  'assistant_messages_per_hour' => 40,
  'eod_emails' => 'info@stratedgeitconsulting.com',
  // Outgoing email. Easiest: log in as admin and open Mass email > Gmail & sending to connect Gmail,
  // Google Workspace or any SMTP service (with a test button). The values below are only used until
  // that page is saved. 'php' uses the host's mail() function; 'smtp' uses the account below.
  'mail_transport' => 'smtp',   // SMTP is used once smtp_host and smtp_pass are filled in; until then the host's mail() is used
  'mail_from' => 'info@stratedgeitconsulting.com',
  'mail_from_name' => 'StratEdge IT Consulting',
  // From cPanel > Email Accounts > info@... > Connect Devices: the outgoing server is usually mail.stratedgeitconsulting.com (port 465, ssl)
  'smtp_host' => '', 'smtp_port' => 465, 'smtp_secure' => 'ssl', 'smtp_user' => 'info@stratedgeitconsulting.com', 'smtp_pass' => '',
  // Sign-in activity: look up an approximate city for each sign-in from its network address (uses ip-api.com; set false to keep it off).
  'geo_lookup' => true,
  // Public address of the site, used in email links. Leave empty to detect automatically.
  'site_url' => 'https://stratedgeitconsulting.com/',
  // Job matching runs inside this site (no separate server). Turn sources on and add their keys under
  // Admin > Job portals > Sources. To collect on a schedule without anyone opening the portal, add a cron job
  // (shown on that page) that runs api/cron.php.
  // Bench sales team addresses: copied on every resume a consultant emails to a recruiter and told about
  // applications that need a submission. Can also be changed under Admin > Job portals > Sources.
  'apply_emails' => 'info@stratedgeitconsulting.com',
];
