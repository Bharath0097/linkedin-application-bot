StratEdge IT Consulting - website with consultant, employee, bench sales, client and admin portals
==================================================================================================

Everything runs on your own hosting. Nothing here connects to any outside
service: accounts, data and uploaded files live on your server.

WHAT YOU NEED
  - A web host with PHP 7.4 or newer (8.x recommended) and the PDO SQLite
    extension. Standard cPanel / LiteSpeed shared hosting has this.
  - The "storage" folder must be writable by the web server.
  - HTTPS is recommended (the login cookie is marked secure on HTTPS).

PUT IT LIVE (about 5 minutes)
  1. Upload everything in this zip EXCEPT the _source folder to your site's
     public folder (usually public_html or www). index.html must sit directly
     in that folder.
  2. Make the "storage" folder writable: in cPanel File Manager, right-click
     storage > Change Permissions > 755 (or 775 if the host asks for it).
  3. Open your website, click "Log in", then "Create account". The FIRST
     account created becomes the administrator. Use a strong password.
     (Alternatively set admin_email / admin_password in api/config.php before
     the first visit and that account is created automatically.)
  4. In the Admin section, add your clients (Admin > Clients). Then tell
     consultants and client managers to create their own accounts from the
     Log in page; approve them under Admin > Team.

HOW ACCESS WORKS
  - There are separate logins: Log in > Consultant, Employee, Bench sales or
    Client (the links are #/login?as=consultant, ?as=employee, ?as=bench and
    ?as=client). An account only works on its own login: a consultant who tries
    the employee login is told to use the consultant login, and the other way
    round. StratEdge staff (admin, HR, accounting) can sign in from any of them.
  - Consultants pick "Consultant" when they register (people placed by
    StratEdge or on the bench), StratEdge staff pick "StratEdge employee",
    bench sales recruiters pick "Bench sales recruiter", and client managers
    pick "client contact" and enter their company. They wait until you approve
    them.
  - Consultant portal: resume upload, matched jobs, attendance, timesheets,
    earnings, time off, documents. Employee portal: attendance, timesheets,
    tasks, onboarding and the recruiting workspace (consultants never see it).
  - Upgrading from an older version: everyone who registered before this
    version is a "consultant". Open Admin > Team and switch your internal staff
    to "Employee portal (StratEdge staff)" so they keep the recruiting pages.
  - Admin > Team: approve people, link them to a client, set projects and
    engagement type, pause access, reset a forgotten password, or give a
    StratEdge colleague admin access.
  - Everyone sees only what they are allowed to: consultants their own
    records, client contacts their own company's consultants, admins everything.

THE STRATEDGE ASSISTANT
  The animated assistant in the bottom corner answers questions about your
  services, staffing, the portals, timesheets and careers from the knowledge
  base in api/knowledge.php (plain text you can edit).
  To make it a full AI assistant that can discuss anything, add an Anthropic
  API key in api/config.php ('ai_api_key'). Usage is billed to that key, and
  the knowledge base stays as a fallback if the AI service is unavailable.
  Visitors are limited to 40 messages per hour each ('ai_messages_per_hour').

PAYROLL FROM CLOCK-INS
  Admin > Team > open a person > Pay tab: set a monthly salary or hourly rate,
  currency (INR or USD), standard hours per day, working days, overtime
  multiplier, loss of pay for absences, paid leave, and recurring allowances
  and deductions (fixed amounts or percentages). Employees then see an
  Earnings page computed from their clock-ins, with a downloadable payslip.
  Admin > Payroll shows everyone for the month, company holidays, one-off
  adjustments (bonus, advance) and a payroll CSV. Amounts in INR use Indian
  grouping (₹1,23,456.00).

HR PORTAL
  Give a colleague HR access from their card under Team (Staff access: HR portal).
  HR sees: Onboarding (start a checklist per hire; employees upload each document
  from their own Onboarding page and HR verifies it), Document checks (every
  employee upload awaiting verification), Policies & templates (handbook,
  policies, forms visible to all employees, plus the onboarding/offboarding
  checklist template), Directory (with CSV export), Daily reports, and the shared
  Team, Approvals, Payroll, Team attendance and Announcements pages.
  Only administrators can grant or remove staff access.

RECRUITING WORKSPACE (employee portal)
  Every employee has it by default (untick "Hide the recruiting workspace" on a
  person's card under Team to remove it for them). Admins and HR also add and
  log from Admin > Recruiting. It holds Consultants (a shared database with
  resume, skills, authorization, rate, location, current employer and website,
  visa sponsor, and a manager/reference with phone and email), RTRs &
  submissions (requirement, vendor and website, the vendor recruiter's name,
  phone and email, end client, hiring manager with phone and email, rate, RTR
  and status) and Daily report: one click sends the end-of-day summary to the
  HR and admin portals. Every record shows who added or logged it, and each
  consultant's card lists all RTRs and submissions logged for them by anyone. Set 'eod_emails'
  in api/config.php to also email each report. Admin > Recruiting and HR > Daily
  reports show RTR and submission counts per recruiter with all the details.

JOB MATCHING (consultant portal) - built in, no separate server
  Consultants upload their resume under Resume & preferences. The site reads the
  titles, skills, years of experience and location from it (PDF, Word or text;
  PDFs are read in the browser with PDF.js and on the server as a fallback) and
  searches the job sources you turn on for each consultant's titles and
  locations. Every posting found is ranked against each resume and shown under
  Matched jobs with a score and the reasons (title, skills, location, posted
  date, engagement type). Consultants save, mark applied or dismiss jobs and can
  add titles, locations, work mode, engagement types, extra skills, must-have
  and exclude words; saving preferences or a new resume starts a small search
  for that person right away.

  Sources (Admin > Job portals > Sources, also under HR):
    - Adzuna: US job search engine covering thousands of boards and company
      sites; the best source for on-site and hybrid roles. Free developer key
      from developer.adzuna.com.
    - Jooble: aggregator of many US job boards, says which board each posting
      came from. Free key on request at jooble.org/api/about.
    - JSearch (Google for Jobs): lists postings that appear on LinkedIn, Indeed,
      Dice, Monster, ZipRecruiter and Glassdoor with a link to each board. Free
      tier with a monthly search limit (set the limit in the card), paid plans
      above that. Key from rapidapi.com.
    - USAJOBS: federal jobs, free key.
    - Remotive, Remote OK, Himalayas, Jobicy: remote jobs, no key needed, on by
      default. Their terms require that listings credit and link to them, which
      the portal does.
    - Your own feeds: any RSS, Atom or JSON job feed (for example a C2C
      requirements board). An address containing {keywords} (and optionally
      {location}) is searched per title; otherwise the feed is read whole and
      filtered by the consultants' titles.
  Nothing logs in to Dice, LinkedIn, Indeed or Monster with a password: those
  sites block automated logins and close accounts that use them. Listings from
  them come through JSearch and Jooble instead.

  How collections run: a collection is a list of small steps (one search, one
  feed, one person's matching) that run a few seconds at a time, so they finish
  within shared-hosting limits. They run whenever a job page is open in anyone's
  browser, automatically every few hours (set under Sources), and from a cron
  job if you add one: cPanel > Cron Jobs, every 10 or 15 minutes, with the
  command shown under Sources (php .../api/cron.php), or the web address shown
  there if your host only offers web cron. Admin > Job portals also has:
    - Job grabber: type titles or keywords, a location, how recent and which
      sources, and grab; results appear as each source answers, are matched to
      every consultant, and any can be published to the Careers page in one
      click (jobs from sources that require credit show "Originally listed
      on ..." on the Careers page) or submitted for a consultant in one click
      (see ONE-CLICK APPLY below).
    - Collection runs: every run with its searches, jobs found, problems and log.
    - Collected jobs: everything collected, searchable, with Publish buttons.
    - Consultant matches: each person's resume profile and their matches.
  Careers page: every open role has its own page and a Share button (copy
  link, LinkedIn, WhatsApp, X, Facebook, email, the phone's share sheet, or
  "email this job to someone" straight from the page). Visitors can search
  and filter roles by location, engagement and work mode.
  Send a job to people: Admin > Website > Job openings > "Send" (also on
  published jobs in the Job grabber). Pick portal consultants, people in the
  recruiting database, ATS candidates or type any email addresses, edit the
  message and send; everyone gets the job details with a "View and apply"
  button and replies come to you. Portal consultants also see it under Matched
  jobs > Sent to you. The table shows how many people each job was sent to.
  Sending needs the outgoing email settings below.

BENCH SALES PORTAL
  A fourth kind of account for the StratEdge recruiters who market consultants
  to vendors and clients. People choose "Bench sales recruiter" when they
  register (or you set "Bench sales portal (recruiter)" on their card under
  Admin > Team) and log in at Log in > Bench sales (#/login?as=bench). Like
  employees they wait for an administrator's approval.
  What they get: the Job grabber (search every job source by keyword and
  publish roles to Careers), Consultant matches (every portal consultant with
  their resume profile, resumes and matched jobs), the recruiting workspace
  (Bench consultants, RTRs & submissions, Daily report), and the usual
  attendance, timesheets, tasks, time off, documents and profile pages.
  What they do not get: job sources and API keys, collection settings, the
  cron address, the scheduled "Collect jobs now" and the rest of the admin
  portal. Those stay with admins and HR. A bench sales recruiter may download
  a consultant's resume (to submit it) but cannot change a consultant's
  records. "Hide the recruiting workspace" on the person's card works for
  bench sales recruiters as it does for employees.
  Technical: the role key is "bench" (r/{uid}.role in the database, the same
  place as consultant / employee / employer). The API lets a bench account use
  jobs_admin with these actions only: overview, grab, run_jobs, jobs, runs,
  run_log, step, stop, publish, unpublish, consultants, matches, resumes, apps.

MULTIPLE RESUMES
  Consultants can keep up to 10 resumes under Resume & preferences (for
  example an SAP FICO resume and a Java resume). Each one can be named, renamed,
  downloaded and deleted. Exactly one is the primary resume: the site reads the
  titles, skills, years and location from it and matches jobs against it. "Use
  for matching" switches the primary resume and refreshes the matches right
  away; deleting the primary resume promotes the newest remaining one. When
  applying to a job the consultant (or the bench sales recruiter submitting
  them) picks which resume to send. Resumes uploaded in older versions appear
  as the primary resume automatically; nothing needs to be re-uploaded.
  Technical: table job_resumes (one row per file; the file itself is stored
  like every other upload under storage/files and listed at u/{uid}/f/{fid}).
  API: jobs_resume (upload: file, optional label and primary=1), jobs_resumes,
  jobs_resume_set (rename / make primary), jobs_resume_delete, and
  jobs_admin&op=resumes&uid=... for staff and bench sales recruiters.

ONE-CLICK APPLY
  Consultants: every matched job has "Apply now". It opens the posting on the
  job board in a new tab, logs the application under Applications, marks the
  match as applied and, when the posting lists a contact email address, emails
  the chosen resume to that address with a short cover note (reply-to is the
  consultant's own email). The cover note can be edited under Resume &
  preferences > "Cover note for one-click apply"; placeholders {name} {title}
  {job} {company} {years} {skills} {location} {phone} {email} {signature} are
  filled in from the resume and profile. Untick "Email my resume
  automatically ..." to only open the posting and log it. The Applications page
  lists every application with the resume used, who submitted it and a status
  (Applied, Interview, Offer, Placed, Rejected, Withdrawn) the consultant
  updates as things move along.
  Bench sales recruiters and staff: every job in the Job grabber, Collected
  jobs and Consultant matches has "Submit consultant". Pick the consultant and
  which of their resumes, check the "Send to" address (prefilled with the
  contact address found in the posting; change it if you know the vendor
  recruiter, or leave it empty to only log the submission), add a note, and
  submit. The resume is emailed with the recruiter as reply-to, the posting
  opens, the application appears in the consultant's Applications page as
  "Submitted by ...", and a row is logged under RTRs & submissions (status
  Submitted; changing the application status updates that row too) so the
  daily report counts it.
  Emails need the outgoing email settings below. Without them the application
  is still logged and the posting still opens; "Emailed" simply stays off.
  Each account may send up to 60 applications an hour.
  Technical: table job_apps (one row per application with the job title,
  company, location and address copied in so it survives the cleanup of old
  postings). API: jobs_apply {job_id, resume_id?, uid?, to?, note?}, jobs_apps
  (&uid= for staff / bench), jobs_app_set {id, status, note?}, and
  jobs_admin&op=apps&uid=.... Contact addresses found in postings are never
  shown to consultants (only a yes/no flag); staff and bench sales recruiters
  see them.

EMAIL (needed for e-signature links and invoices, one-click apply and submissions)
  Set the outgoing mail options in api/config.php. 'php' uses the host's own
  mail() function and works on most cPanel hosts out of the box. For reliable
  delivery use 'smtp' with your mailbox (e.g. billing@stratedgeitconsulting.com
  on Google Workspace: smtp.gmail.com, port 587, tls, an App Password).
  Set 'mail_from' to a real address on your domain. Delivery attempts are
  logged in storage/mail.log. 'site_url' is only needed if links in emails
  show the wrong address.

E-SIGNATURES (built in, no outside service)
  Admin > E-signatures or HR > E-signatures > "Send for signature": attach a
  PDF (or PNG/JPG), add the signers in order, each either a portal member or
  "By email" (just a name and address, no account needed), optionally
  countersign yourself, add a message and due date. Every signer gets an email
  with a secure link. Portal members can also sign under "Sign documents".
  The signer reviews the document, draws or types their signature and confirms
  consent. When everyone has signed, the final PDF is emailed to all parties.
  Use "Resend email" for reminders, or "Copy link" to share a signing link
  yourself. A new PDF is produced with a signature stamp
  on every page plus a signature certificate page (name, email, time, request
  ID, SHA-256 of the original). Later signers sign on top of the latest copy.
  The signed copy, each signer's time and network address, and the full audit
  log (sent, viewed, signed, declined, cancelled) are kept in the admin portal.

THE WEBSITE LOOK
  The public site has a clean corporate design: navy and teal on a warm
  off-white background, a hero with a card collage, a navy stats band, three
  service pillars and a services grid, a five-step walkthrough, engagement
  plan cards, benefits, industries, healthcare, the "Build your team" planner,
  portals, commitments, the assistant, FAQs and a contact band. No effects
  libraries; it is all CSS. The portals keep their own interface. All of it is CSS and a small
  canvas; it pauses when the tab is hidden and respects "reduce motion"
  settings. The portals keep the clean light/dark interface for daily work.
  Service content (deliverables, timelines, teams, engagement models, FAQs)
  is at the top of _source/src/site.js.

INVOICES
  Admin > Invoices or HR > Invoices. "Billing settings" holds the company
  details, default terms and tax, and the payment instructions printed on every
  invoice. "New invoice": choose a client workspace (bill-to and contact fill
  in; set the billing period and click "Add approved timesheets" to pull
  approved hours at each consultant's bill rate, set on their card under Team),
  or bill any vendor or company by typing the details. Add lines, tax and
  discount, save the draft, then "Send by email": the PDF is generated, attached
  and emailed with a secure "View invoice" link; opening the link marks it
  Viewed. Record full or partial payments, resend, void, download the PDF or
  copy the link. Clients see their invoices with status and PDF in the client
  portal. Numbers run INV-YEAR-0001 and up.

ACCOUNTING PORTAL (QuickBooks/ADP-style, built in)
  Give a colleague Accounting access from their card under Team (Staff access:
  Accounting portal). Admins see the same pages under "Accounting".
  - Invoices (receivables) and Bills & expenses (payables) with categories from
    the Chart of accounts, receipts, payments and CSV exports.
  - Payroll runs & paystubs: pick a month; every employee with a pay plan is
    computed from their clock-ins and salary or hourly rate. Taxes come from the
    person's Tax tab (Team > member > Tax): US W2 (federal withholding by the
    IRS percentage method, Social Security, Medicare, a state rate, employer
    FUTA/SUTA) or India (EPF, ESI, professional tax, TDS under the new or old
    regime with cess). Finalize the run, mark it paid, and email every paystub
    PDF in one click. Employees see and download paystubs under Earnings.
  - Tax settings: the rates and brackets (2025 US, FY 2025-26 India) in one
    editable page; update them each year. Paystubs are marked as estimates to
    confirm with your CPA or CA.
  - Reports: profit and loss (accrual or cash), receivables aging, payables,
    and payroll/withheld-tax summaries for 941 deposits, TDS, EPF and ESI.

EXACT LOCATION NEEDS HTTPS
  Browsers only share a person's exact location on pages served over https.
  Enable SSL for the site (cPanel: SSL/TLS Status > Run AutoSSL, free Let's
  Encrypt) and open the portal at https://... Without it, every record still
  has the network address and its city, and the admin pages say why the exact
  location is missing ("needs a secure https connection", "blocked in the
  browser", "no location fix"). Employees see a location status on their clock
  card with a "Share my location" button that triggers the browser prompt.

BREAKS AND LOCATIONS
  While clocked in, employees can start and end breaks from the clock card.
  Up to 60 minutes of breaks a day are paid (change the allowance under Pay
  plans > Payroll settings). Beyond that, the extra time is unpaid unless an
  admin approves the extended break under Approvals > Attendance, which offers
  "Approve with extra break" (paid) or "Approve (extra break unpaid)". Every
  clock-in, clock-out, break start and break end is stamped with the server
  time, the network address and, when the person allows location sharing, the
  exact location with a map link. Admins see these on each attendance approval
  row and in Sign-in activity, along with sign-ins and sign-outs.

SIGN-IN ACTIVITY
  Admin > Sign-in activity (also under HR). Every portal sign-in is recorded
  with its time, network address, approximate city (looked up from the address
  via ip-api.com; set 'geo_lookup' to false in api/config.php to turn that off),
  device, and, when the person allows location sharing in their browser, a
  precise location with a map link. The page shows who is signed in right now,
  each person's last sign-in and history, with CSV export. The login page tells
  people this is recorded.

ATS (applicant tracking)
  Admin > Candidates (ATS) or HR > Candidates (ATS). Applications from the
  website Careers page land here automatically with their resume. Move people
  through New, Screening, Interview, Offer, Hired or Rejected on the pipeline
  board, rate them, add notes, schedule interviews, and email them with the
  built-in templates (screening call, interview invitation, offer, not
  selected). Add candidates by hand with a resume as well.

FILES
  index.html, css/, js/, assets/   the website and portals (front end)
  css/fonts/                       the Archivo font, self-hosted (no outside requests)
  api/knowledge.php                what the assistant knows; edit the facts and answers
  js/config.js                     poll interval and logo paths
  js/vendor/pdfjs/                 PDF.js (Mozilla, Apache 2.0), reads PDF resumes in the browser
  api/                             the PHP backend (API)
  api/config.php                   database, upload limit, optional first admin, email
  api/jobs.php, api/textract.php   job matching: sources, collections, resume reading, matching,
                                   resumes (several per consultant), one-click apply and submissions
  api/cron.php                     optional cron entry point for hands-free job collections
  storage/                         the SQLite database and uploaded files
                                   (created on first use; keep it backed up)
  .htaccess                        hides folder listings; storage/ is blocked
                                   from the web
  _source/                         editable source for your developer; not
                                   needed on the server

UPDATING AN EXISTING SITE
  Upload everything in the zip except api/config.php (keep yours: it holds your
  email, assistant and database settings) and except the storage folder (your
  data). New database tables are created automatically (this version adds
  job_resumes and job_apps the first time a job page is opened). Any old
  jobs_url / jobs_key lines left in your config.php are simply ignored; the
  separate Python job server is no longer used or needed.

BACKUPS
  Copy storage/app.sqlite and the storage/files folder regularly. That is all
  the data.

UPLOAD LIMITS
  Timesheets and documents up to 10 MB. If uploads over 2 MB fail, your host's
  PHP settings cap them; api/.user.ini raises the limit on most cPanel hosts,
  otherwise ask the host to set upload_max_filesize and post_max_size to 12M.

USING MYSQL INSTEAD OF SQLITE (optional)
  Create a database in cPanel, then in api/config.php set
    'dsn' => 'mysql:host=localhost;dbname=YOUR_DB;charset=utf8mb4',
    'db_user' => 'YOUR_USER', 'db_pass' => 'YOUR_PASSWORD'
  Tables are created automatically.

IF SOMETHING GOES WRONG
  - Blank page or "server hit a problem": check storage/error.log and that
    storage/ is writable.
  - "Rejected request" or login loops: the site must be opened through the
    same address every time (with or without www); pick one in your DNS.
  - Edit text or layout: change files in _source/src and run
    python3 _source/build.py, or edit js/app.js and css/styles.css directly.
