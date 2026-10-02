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
  'admin_email' => '',
  'admin_name' => 'StratEdge Admin',
  'admin_password' => '',
  'max_upload_mb' => 10,
  'session_name' => 'stratedge_portal',
  'public_forms_per_hour' => 20,
  // Website assistant ("Edge"). Without a key it answers from api/knowledge.php.
  // Add an Anthropic API key to make it a full AI assistant that can discuss anything (usage is billed to your key).
  'ai_api_key' => '',
  'ai_model' => 'claude-sonnet-5-5',
  'ai_messages_per_hour' => 40,
  // End-of-day recruiting reports are always visible in the HR and admin portals; add addresses
  // (comma-separated) to also email each report the moment it is sent.
  'eod_emails' => '',
  // Outgoing email (signature requests, invoices, notifications).
  // 'php' uses the host's mail() function; 'smtp' uses the SMTP account below (recommended on shared hosting).
  'mail_transport' => 'php',
  'mail_from' => '',            // e.g. billing@stratedgeitconsulting.com (defaults to no-reply@your-domain)
  'mail_from_name' => 'StratEdge IT Consulting',
  'smtp_host' => '', 'smtp_port' => 587, 'smtp_secure' => 'tls', 'smtp_user' => '', 'smtp_pass' => '',
  // Sign-in activity: look up an approximate city for each sign-in from its network address (uses ip-api.com; set false to keep it off).
  'geo_lookup' => true,
  // Public address of the site, used in email links. Leave empty to detect automatically.
  'site_url' => '',
  // Job-portal server (the Python service in the repository root: "python -m jobserver"). It keeps the Dice, LinkedIn,
  // Indeed and Monster logins, scrapes jobs on a schedule and matches them to each consultant's uploaded resume.
  // jobs_key must equal JOBSERVER_API_KEY on that server. Leave jobs_url empty to hide the job features.
  'jobs_url' => 'http://127.0.0.1:8765',
  'jobs_key' => '',
];
