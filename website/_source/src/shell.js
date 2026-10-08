/* ================= Staff portals: pages, access and navigation ================= */

// Every staff page, once. The same page can open under any staff portal the person has (admin/…, hr/…, acct/…, mgr/…).
const PAGES = {
  overview: {
    n: 'Overview',
    i: 'grid',
    c: k =>
      k === 'hr'
        ? html`<${HROverview} />`
        : k === 'acct'
          ? html`<${AcctOverview} />`
          : k === 'mgr'
            ? html`<${MgrHome} />`
            : html`<${AdminOverview} />`,
  },
  team: { n: 'Team', i: 'users', c: (k, q) => html`<${AdminTeam} q=${q} />` },
  myteam: { n: 'My team', i: 'users', c: () => html`<${MgrTeam} />` },
  directory: { n: 'Directory', i: 'idcard', c: () => html`<${HRDirectory} />` },
  hrms: { n: 'HRMS', i: 'org', c: (k, q) => html`<${HRMSPage} q=${q} />` },
  onboarding: { n: 'Onboarding', i: 'tasks', c: () => html`<${HROnboarding} />` },
  verify: { n: 'Document checks', i: 'folder', c: () => html`<${HRVerify} />` },
  policies: { n: 'Policies & templates', i: 'sheet', c: () => html`<${HRPolicies} />` },
  approvals: { n: 'Approvals', i: 'approve', c: (k, q) => html`<${AdminApprovals} q=${q} />` },
  attendance: { n: 'Team attendance', i: 'clock', c: () => html`<${AdminAttendance} />` },
  payplans: { n: 'Pay plans', i: 'money', c: () => html`<${AdminPayroll} />` },
  payruns: { n: 'Payroll runs & paystubs', i: 'money', c: () => html`<${PayrollRuns} />` },
  taxes: { n: 'Tax settings', i: 'approve', c: () => html`<${TaxSettings} />` },
  invoices: { n: 'Invoices', i: 'money', c: () => html`<${InvoicesAdmin} />` },
  expenses: { n: 'Bills & expenses', i: 'sheet', c: () => html`<${Expenses} />` },
  acctreports: { n: 'Accounting reports', i: 'chart', c: () => html`<${AcctReports} />` },
  accounts: { n: 'Chart of accounts', i: 'folder', c: () => html`<${ChartOfAccounts} />` },
  bank: { n: 'Bank import & matching', i: 'money', c: () => html`<${BankImportPage} />` },
  acctsettings: { n: 'Accounting settings', i: 'sheet', c: () => html`<${AcctSettingsPage} />` },
  requirements: { n: 'Requirements', i: 'brief', c: () => html`<${AdminRequirements} />` },
  books: { n: 'Books', i: 'layers', c: (sp, q) => html`<${BooksPage} q=${q} />` },
  paysetup: { n: 'Payroll setup', i: 'money', c: () => html`<${PayrollSetupPage} />` },
  paytax: { n: 'Taxes & filings', i: 'sheet', c: () => html`<${TaxFilingsPage} />` },
  vreqs: { n: 'Requirements desk', i: 'layers', c: () => html`<${ReqDeskPage} />` },
  vms: { n: 'Vendors & clients', i: 'building', c: () => html`<${VendorsPage} />` },
  mkt: { n: 'Talent marketplace', i: 'globe', c: () => html`<${MarketplacePage} />` },
  storage: { n: 'Storage box', i: 'folder', c: () => html`<${StoragePage} />` },
  recruiting: { n: 'Recruiting & daily reports', i: 'chart', c: () => html`<${Recruiting} />` },
  // v36.1: ID checks (driver's licenses, state IDs and green cards: genuine or fake)
  idscan: { n: 'ID checks', i: 'shield', c: (k, q) => html`<${IdScanPage} q=${q} />` },
  // v36: the bench desk (who is on the bench, what is due today, approvals, conflict checks, the pipeline)
  'bench-desk': { n: 'Bench desk', i: 'grid', c: (k, q) => html`<${BenchDeskPage} q=${q} />` },
  'rec-consultants': { n: 'Consultant database', i: 'users', c: () => html`<${RecConsultants} />` },
  'rec-submissions': { n: 'RTRs & submissions', i: 'send', c: () => html`<${RecSubmissions} />` },
  tailor: { n: 'Tailor & submit', i: 'bolt', c: (sp, q) => html`<${TailorStaffPage} q=${q} />` },
  jobs: { n: 'Job portals', i: 'search', c: () => html`<${JobPortalsAdmin} />` },
  autofill: { n: 'Apply profile & autofill', i: 'bolt', c: () => html`<${ApplyProfilePage} />` },
  appbot: { n: 'Application bot', i: 'bolt', c: () => html`<${ApplicationBotPage} />` },
  ats: { n: 'Candidates (ATS)', i: 'users', c: (sp, q) => html`<${ATSPage} q=${q} />` },
  // v33: the StratEdge AI screening agent
  agent: { n: 'Screening agent', i: 'shield', c: (sp, q) => html`<${AgentPage} q=${q} />` },
  sources: { n: 'Portal integrations', i: 'globe', c: () => html`<${SourcesPage} />` },
  // v80: the easy Ceipal & Oorwin connector (jobs → requirements, candidates → consultant database)
  atsconnect: { n: 'Ceipal & Oorwin', i: 'globe', c: () => html`<${AtcConnect} />` },
  search: { n: 'Talent search', i: 'search', c: (sp, q) => html`<${TalentSearchPage} q=${q} />` },
  placements: { n: 'Placements', i: 'brief', c: () => html`<${PlacementsPage} />` },
  compliance: { n: 'Compliance & deadlines', i: 'shield', c: (sp, q) => html`<${ComplianceAdminPage} q=${q} />` },
  immnews: { n: 'Immigration live updates', i: 'globe', c: () => html`<${ImmigrationLivePage} />` },
  learning: { n: 'Learning platform', i: 'compass', c: (sp, q) => html`<${LearningAdminPage} q=${q} />` },
  // v32: StratEdge certifications and tests, plans and payments, consultant types and job rules
  exams: { n: 'Certifications & tests', i: 'flag', c: (sp, q) => html`<${ExamsAdminPage} q=${q} />` },
  billing: { n: 'Plans & payments', i: 'money', c: (sp, q) => html`<${BillingAdminPage} q=${q} />` },
  jobrules: { n: 'Consultant types & job rules', i: 'key', c: (sp, q) => html`<${JobRulesPage} q=${q} />` },
  interviews: { n: 'My interviews', i: 'cal', c: () => html`<${MyInterviewsPage} />` },
  crm: { n: 'CRM', i: 'target', c: () => html`<${CRMPage} />` },
  clients: { n: 'Clients', i: 'building', c: () => html`<${AdminClients} />` },
  mail: { n: 'Email & contacts', i: 'mail', c: (k, q) => html`<${MailPage} q=${q} />` },
  'mail-validation': { n: 'Email Validation', i: 'check', c: () => html`<${MailValidationPage} />` },
  'mail-cleanup': { n: 'Contact Cleanup', i: 'trash', c: () => html`<${MailCleanupPage} />` },
  'mail-campaigns': { n: 'Campaigns', i: 'send', c: (k, q) => html`<${MailCampaignPage} q=${q} />` },
  mymail: { n: 'My email', i: 'inbox', c: (k, q) => html`<${MyMail} q=${q} />` },
  ads: { n: 'Ads & social posts', i: 'ad', c: () => html`<${AdsPage} />` },
  announcements: { n: 'Announcements', i: 'mega', c: () => html`<${AdminAnnouncements} />` },
  esign: { n: 'E-signatures', i: 'pen', c: (sp, q) => html`<${ESignApp} q=${q} />` },
  tasks: { n: 'Assign tasks', i: 'tasks', c: () => html`<${AdminTasks} />` },
  reports: { n: 'Reports', i: 'chart', c: () => html`<${AdminReports} />` },
  intel: { n: 'Intelligence & Operations', i: 'bolt', c: (sp, q) => html`<${IntelligencePage} q=${q} />` },
  website: { n: 'Website & messages', i: 'globe', c: (k, q) => html`<${AdminWebsite} q=${q} />` },
  logins: { n: 'Sign-in activity', i: 'globe', c: () => html`<${SignIns} />` },
  security: { n: 'Security & spam firewall', i: 'shield', c: () => html`<${SecurityPage} />` },
  // v78: the web application firewall (attack signatures, threat scores, bans) and its security-analyst view
  waf: { n: 'Web application firewall', i: 'shield', c: (sp, q) => html`<${WafPanel} q=${q} />` },
  // v34: the Security center, governance and SOC 2 readiness, privacy requests and retention
  trust: { n: 'Security center', i: 'shield', c: (sp, q) => html`<${TrustPage} q=${q} />` },
  governance: { n: 'Governance & SOC 2', i: 'flag', c: (sp, q) => html`<${GovernancePage} q=${q} />` },
  privacy: { n: 'Privacy & retention', i: 'idcard', c: (sp, q) => html`<${PrivacyAdminPage} q=${q} />` },
  access: { n: 'Roles & access', i: 'key', c: () => html`<${AccessPage} />` },
  health: { n: 'System health', i: 'bolt', c: () => html`<${HealthPage} />` },
  // v34: the person's own password, two-step sign-in, passkeys, sessions and policies (every staff portal)
  mysecurity: { n: 'Sign-in & security', i: 'key', c: () => html`<${MySecurityPage} />` },
  // v34: courses for staff without a member portal (the yearly security awareness course)
  learn: { n: 'My courses', i: 'compass', c: (sp, q) => html`<${StaffLearn} sp=${sp} q=${q} />` },
  // v34: the service desk (tickets by priority and SLA, the catalog, the knowledge base) and everyone's own Help & support
  desk: { n: 'Service desk', i: 'help', c: (sp, q) => html`<${ServiceDeskPage} q=${q} />` },
  help: { n: 'Help & support', i: 'help', c: (sp, q) => html`<${HelpPage} q=${q} />` },
  // v35: team messaging
  messages: { n: 'Messages', i: 'chat', c: (sp, q) => html`<${MessagesPage} q=${q} />` },
  // v35: who practises calls and drills, how much and how well
  practice: { n: 'Practice & training', i: 'phone', c: () => html`<${PracticeAdminPage} />` },
  // v37: StratEdge Workspaces, other companies' portals on this installation (the provider console)
  workspaces: { n: 'Workspaces', i: 'layers', c: (sp, q) => html`<${WorkspacesPage} q=${q} />` },
  // v38.1: a spreadsheet checked row by row before anything is saved (candidates, consultants, vendors, CRM, contacts...)
  import: { n: 'Import with preview', i: 'impin', c: (sp, q) => html`<${ImportPage} q=${q} />` },
  // v39: calls from the browser, incoming calls, voicemail, recordings, transcripts and texts (the company's Twilio)
  calls: { n: 'Calls & texts', i: 'phone', c: (sp, q) => html`<${CallsPage} q=${q} />` },
  phone: { n: 'Phone setup', i: 'phone', c: (sp, q) => html`<${PhoneSetupPage} q=${q} />` },
  // v40: everyone's own tax center (js/tax.js, fetched when opened)
  mytax: { n: 'My taxes', i: 'money', c: () => html`<${TaxCenterPage} />` },
  // v42: work boards (js/work.js, fetched when opened)
  work: { n: 'Work boards', i: 'grid', c: (sp, q) => html`<${WorkBoardsPage} q=${q} />` },
  // v43: expense claims: approving (managers, HR), paying (accounting) and the person's own claims (js/work.js)
  claims: { n: 'Expense claims', i: 'money', c: (sp, q) => html`<${ClaimsPage} q=${q} staff />` },
  // v44: goals with key results and check-ins, team and company goals, review cycles (js/work.js)
  goals: { n: 'Goals & reviews', i: 'target', c: (sp, q) => html`<${GoalsPage} q=${q} staff />` },
  // v45: immigration cases: petitions and applications with their steps, documents and messages (js/work.js)
  immig: { n: 'Immigration cases', i: 'globe', c: (sp, q) => html`<${ImmigPage} q=${q} />` },
  // v46: sequences: follow-up emails and tasks from the sender's own mailbox until the person replies (js/work.js)
  sequences: { n: 'Sequences', i: 'send', c: (sp, q) => html`<${SequencesPage} q=${q} />` },
  // v47: client companies' talent requests (with their approval) and proposals (js/work.js)
  clientreq: { n: 'Client requests & proposals', i: 'brief', c: (sp, q) => html`<${ClientReqPage} q=${q} />` },
  // v49: StratEdge's supplier profile, its document library and each client company's qualification packet (js/work.js)
  supplier: { n: 'Supplier profile & documents', i: 'shield', c: (sp, q) => html`<${SupplierPage} q=${q} />` },
  // v50: the website's specialist service pages and case evidence (js/work.js)
  webpages: { n: 'Service pages & cases', i: 'globe', c: (sp, q) => html`<${WebPagesPage} q=${q} />` },
};
const WebPagesPage = ({ q }) => html`<${Lazy} load=${loadWork} get=${() => CwStaffPage} props=${{ q }} label="Opening service pages…" />`;
const SupplierPage = ({ q }) => html`<${Lazy} load=${loadWork} get=${() => CqStaffPage} props=${{ q }} label="Opening supplier documents…" />`;
const ClientReqPage = ({ q }) => html`<${Lazy} load=${loadWork} get=${() => CrStaffDesk} props=${{ q }} label="Opening client requests…" />`;
const SequencesPage = ({ q }) => html`<${Lazy} load=${loadWork} get=${() => SqApp} props=${{ q }} label="Opening sequences…" />`;
const ImmigPage = ({ q }) => html`<${Lazy} load=${loadWork} get=${() => ImApp} props=${{ q, staff: true }} label="Opening immigration cases…" />`;
const GoalsPage = ({ q, staff }) => html`<${Lazy} load=${loadWork} get=${() => GoalsApp} props=${{ q, staff: !!staff }} label="Opening goals & reviews…" />`;
const ClaimsPage = ({ q, staff }) => html`<${Lazy} load=${loadWork} get=${() => ClaimsApp} props=${{ q, staff: !!staff }} label="Opening expense claims…" />`;
const WorkBoardsPage = ({ q }) => html`<${Lazy} load=${loadWork} get=${() => WorkApp} props=${{ q }} label="Opening work boards…" />`;
const TaxCenterPage = () => html`<${Lazy} load=${loadTax} get=${() => TaxCenter} label="Opening your tax center…" />`;
function StaffLearn({ sp, q }) {
  const P = usePortal();
  const ctx = useMemo(() => ({ ...P, base: '/portal/' + sp, staffView: true }), [P, sp]);
  return html`<${PortalCtx.Provider} value=${ctx}><${LearnPage} q=${q} /><//>`;
}
const STAFF_PORTALS = {
  admin: {
    n: 'Admin portal',
    home: 'Admin overview',
    groups: [
      ['', ['overview', 'messages', 'calls', 'work']],
      ['People', ['team', 'directory', 'hrms', 'goals', 'onboarding', 'verify', 'idscan', 'policies', 'compliance', 'immnews', 'immig', 'learning', 'exams', 'practice']],
      ['Time & pay', ['approvals', 'attendance', 'payplans', 'payruns', 'paysetup', 'paytax', 'taxes']],
      ['Finance', ['books', 'invoices', 'billing', 'expenses', 'claims', 'bank', 'acctreports', 'accounts', 'acctsettings']],
      ['Recruiting & sales', ['bench-desk', 'search', 'vreqs', 'vms', 'mkt', 'requirements', 'recruiting', 'rec-consultants', 'jobrules', 'tailor', 'rec-submissions', 'jobs', 'autofill', 'appbot', 'ats', 'agent', 'sources', 'atsconnect', 'interviews', 'placements', 'crm', 'sequences', 'clientreq', 'supplier', 'clients']],
      ['Marketing & messages', ['mail', 'mail-validation', 'mail-cleanup', 'mail-campaigns', 'mymail', 'ads', 'announcements', 'esign']],
      ['Operations', ['intel', 'desk', 'tasks', 'reports', 'import']],
      ['System', ['trust', 'governance', 'privacy', 'security', 'waf', 'access', 'logins', 'storage', 'website', 'webpages', 'phone', 'workspaces', 'health']],
      ['Account', ['mytax', 'help', 'learn', 'mysecurity']],
    ],
    tabs: ['', 'approvals', 'team', 'payruns'],
  },
  hr: {
    n: 'HR portal',
    home: 'HR overview',
    groups: [
      ['', ['overview', 'messages', 'calls', 'desk', 'ats', 'agent', 'search', 'interviews', 'jobs', 'autofill', 'appbot', 'onboarding', 'hrms', 'goals', 'compliance', 'immnews', 'immig', 'learning', 'exams', 'practice', 'esign', 'mail', 'mail-validation', 'mail-cleanup', 'mail-campaigns', 'mymail', 'verify', 'idscan', 'policies', 'directory', 'recruiting', 'logins']],
      ['Team', ['work', 'claims', 'team', 'approvals', 'payplans', 'attendance', 'announcements', 'tasks', 'reports', 'storage', 'import']],
      ['Recruiting & sales', ['bench-desk', 'vreqs', 'vms', 'mkt', 'rec-consultants', 'jobrules', 'billing', 'tailor', 'rec-submissions', 'requirements', 'placements', 'crm', 'sequences', 'ads', 'clientreq', 'supplier', 'webpages', 'clients']],
      ['Account', ['privacy', 'mytax', 'help', 'learn', 'mysecurity']],
    ],
    tabs: ['', 'onboarding', 'verify', 'approvals'],
  },
  acct: {
    n: 'Accounting portal',
    home: 'Accounting overview',
    groups: [
      ['', ['overview', 'messages', 'calls', 'desk', 'books', 'invoices', 'billing', 'expenses', 'claims', 'bank', 'acctreports', 'accounts', 'acctsettings', 'placements', 'mail', 'mail-validation', 'mail-cleanup', 'mail-campaigns', 'mymail', 'clients']],
      ['Payroll', ['payruns', 'paysetup', 'paytax', 'taxes', 'payplans']],
      ['Team', ['work', 'goals', 'immnews', 'team', 'approvals', 'attendance', 'storage', 'import']],
      ['Account', ['mytax', 'help', 'learn', 'mysecurity']],
    ],
    tabs: ['', 'invoices', 'expenses', 'payruns'],
  },
  mgr: {
    n: 'Manager portal',
    home: 'Manager overview',
    groups: [
      ['', ['overview', 'messages', 'calls', 'work', 'goals', 'immnews', 'claims', 'myteam', 'approvals', 'attendance', 'interviews', 'practice', 'tasks', 'mymail', 'desk']],
      ['Account', ['mytax', 'help', 'learn', 'mysecurity']],
    ],
    tabs: ['', 'myteam', 'approvals', 'attendance'],
  },
};
// Addresses from earlier versions keep working (#/portal/acct/payroll is the payroll run, #/portal/admin/payroll the pay plans).
const PAGE_ALIAS = {
  admin: { payroll: 'payplans' },
  hr: { payroll: 'payplans', reports: 'recruiting' },
  acct: { payroll: 'payruns', reports: 'acctreports' },
  mgr: { team: 'myteam' },
};
// v62: the pages in js/staff2.js, fetched after js/staff.js (the shell waits for it before drawing one of them)
const STAFF2_KEYS = ['intel', 'books', 'idscan', 'sources', 'atsconnect', 'compliance', 'learning', 'exams', 'billing', 'jobrules', 'trust', 'governance', 'privacy', 'practice', 'workspaces', 'phone'];
// What each staff role opens; administrators open everything. The server enforces the same split (api/lib.php SCOPES).
const ROLE_PAGES = {
  hr: ['team', 'directory', 'approvals', 'attendance', 'payplans', 'onboarding', 'verify', 'policies', 'ats', 'agent', 'search', 'interviews', 'placements', 'jobs', 'autofill', 'appbot', 'recruiting', 'bench-desk', 'idscan', 'rec-consultants', 'rec-submissions', 'tailor', 'esign', 'mail', 'mail-validation', 'mail-cleanup', 'mail-campaigns', 'logins', 'announcements', 'tasks', 'reports', 'requirements', 'clients', 'hrms', 'compliance', 'immnews', 'immig', 'learning', 'exams', 'practice', 'jobrules', 'billing', 'crm', 'ads', 'clientreq', 'supplier', 'webpages', 'vreqs', 'vms', 'mkt', 'storage', 'privacy'],
  acct: ['team', 'approvals', 'attendance', 'payplans', 'payruns', 'paysetup', 'paytax', 'invoices', 'billing', 'expenses', 'bank', 'books', 'acctreports', 'taxes', 'accounts', 'acctsettings', 'placements', 'mail', 'mail-validation', 'mail-cleanup', 'mail-campaigns', 'clients', 'storage', 'immnews'],
  manager: ['myteam', 'approvals', 'attendance', 'tasks', 'interviews', 'practice', 'immnews'],
};
// v58: fine-grained Role & Feature Access. "default" follows the role; allow/block override it.
const FEATURE_ACCESS_UI = [
  ['mail_contacts','Email & contacts','Email','Address book, inbox and normal company email'],
  ['mail_validation','Email validation','Email','Validate selected/pasted addresses and validation history'],
  ['mail_cleanup','Bounces & contact cleanup','Email','Bounce sync, suppressions, bad-address cleanup and duplicate merging'],
  ['mail_campaigns','Campaigns','Email','Create, test, send and review campaigns'],
  ['ats','Candidates / ATS','Recruiting','Candidate records and ATS pipeline'],
  ['screening_agent','Screening Agent','Recruiting','Resume/email screening agent and its queue'],
  ['talent_search','Talent Search','Recruiting','Search and source candidates'],
  ['bench_sales','Bench desk','Recruiting','Bench consultant desk and submission workflow for Employees'],
  ['recruiting_reports','Recruiting dashboard & reports','Recruiting','Recruiting overview, consultant/submission reports'],
  ['resume_tailor','Resume tailoring','Recruiting','Tailor resumes for job descriptions'],
  ['job_portals','Jobs & job portals','Recruiting','Jobs, portal posting and job-board tools'],
  ['auto_apply','Autofill & Auto Apply','Recruiting','Autofill profiles and automated application tools'],
  ['interviews','Interviews','Recruiting','Interview scheduling and tracking'],
  ['placements','Placements','Recruiting','Placement records and placement workflow'],
  ['requirements','Requirements desk','Recruiting','Internal/client requirements'],
  ['vendors','Vendors & marketplace','Recruiting','Vendor requirements, VMS and talent marketplace'],
  ['clients','Clients','Sales','Client records and workspaces'],
  ['crm','CRM','Sales','Accounts, contacts and deals'],
  ['sequences','Sequences','Sales','Follow-up sequences and outreach automation'],
  ['client_requests','Client requests','Sales','Client requisition/request workflow'],
  ['team_directory','Team & directory','People','Team list and company directory'],
  ['hrms','HRMS','People','Employee HR records and HR operations'],
  ['onboarding','Onboarding','People','Employee/consultant onboarding'],
  ['id_verification','ID verification','People','ID and work-document checks'],
  ['policies','Policies','People','Company policies and acknowledgements'],
  ['attendance','Attendance','People','Attendance and clock-in records'],
  ['approvals','Approvals','People','Manager/time approvals'],
  ['tasks','Tasks','People','Tasks and assignments'],
  ['announcements','Announcements','People','Internal announcements'],
  ['compliance','USCIS compliance','People','USCIS compliance dates and tasks'],
  ['immigration_news','Immigration live updates','People','Official USCIS/visa-bulletin live updates'],
  ['immigration','Immigration cases','People','Immigration case workflows and documents'],
  ['learning','Learning','People','Courses, certifications and projects'],
  ['exams_practice','Exams & practice','People','Tests, exams and practice'],
  ['goals','Goals & reviews','People','Goals, check-ins and performance reviews'],
  ['esign','E-signatures','Tools','Prepare and send documents for signature'],
  ['imports','Import with preview','Tools','Bulk imports and ATS/CRM migration'],
  ['integrations','Portal integrations','Tools','Dice, iLabor360, Oorwin and connectors'],
  ['ai','StratEdge AI','Tools','Portal assistant and AI writing/extraction helpers'],
  ['ops_intel','Intelligence & Operations','Operations','Command center, universal search, Candidate 360, quality, integrations and executive analytics'],
  ['reports','Reports','Operations','Operational reports'],
  ['storage','Storage box','Operations','Shared storage and cleanup'],
  ['desk','Service desk','Operations','Help-desk tickets and knowledge tools'],
  ['work','Work boards','Operations','Projects, boards, sprints and My work'],
  ['messages','Messages','Communications','Team messaging'],
  ['phone','Phone & texts','Communications','Calls, texts and voicemail; setup remains Admin-only'],
  ['invoices','Invoices','Finance','Customer invoices and invoice workflow'],
  ['expenses','Expenses & claims','Finance','Bills, expenses and employee claims'],
  ['banking','Bank & reconciliation','Finance','Bank feeds and matching'],
  ['books','Books','Finance','Bookkeeping and ledger tools'],
  ['accounting_reports','Accounting reports','Finance','Financial/accounting reports'],
  ['accounts_chart','Chart of accounts & settings','Finance','Accounts and accounting configuration'],
  ['payroll','Payroll runs & plans','Finance','Pay plans and payroll runs'],
  ['payroll_setup','Payroll setup','Finance','Payroll configuration'],
  ['payroll_tax','Payroll taxes','Finance','Payroll tax and filing tools'],
  ['billing','Plans & payments','Finance','Billing plans and payments'],
  ['ads','Ads & social posts','Marketing','Website ads and social recruiting posts'],
  ['service_pages','Service pages & cases','Marketing','The website\'s specialist service pages and case evidence'],
];
const FEATURE_PAGES = {
  mail_contacts:['mail'], mail_validation:['mail-validation'], mail_cleanup:['mail-cleanup'], mail_campaigns:['mail-campaigns'],
  ats:['ats'], screening_agent:['agent'], talent_search:['search'], bench_sales:['bench-desk'], recruiting_reports:['recruiting','rec-consultants','rec-submissions'], resume_tailor:['tailor'],
  job_portals:['jobs'], auto_apply:['autofill','appbot'], interviews:['interviews'], placements:['placements'], requirements:['requirements'], vendors:['vreqs','vms','mkt'],
  clients:['clients'], crm:['crm'], sequences:['sequences'], client_requests:['clientreq','supplier'], service_pages:['webpages'],
  team_directory:['team','directory'], hrms:['hrms'], onboarding:['onboarding'], id_verification:['verify','idscan'], policies:['policies'], attendance:['attendance'], approvals:['approvals'], tasks:['tasks'], announcements:['announcements'],
  compliance:['compliance'], immigration_news:['immnews'], immigration:['immig'], learning:['learning','learn'], exams_practice:['exams','practice'], goals:['goals'],
  esign:['esign'], imports:['import'], integrations:['sources', 'atsconnect'], ai:[], ops_intel:['intel'], reports:['reports'], storage:['storage'], desk:['desk'], work:['work'], messages:['messages'], phone:['calls'],
  invoices:['invoices'], expenses:['expenses','claims'], banking:['bank'], books:['books'], accounting_reports:['acctreports'], accounts_chart:['accounts','acctsettings'], payroll:['payplans','payruns'], payroll_setup:['paysetup'], payroll_tax:['paytax','taxes'], billing:['billing'], ads:['ads']
};
const FEATURE_PAGE = Object.fromEntries(Object.entries(FEATURE_PAGES).flatMap(([f, ps]) => ps.map(p => [p, f])));
const FEATURE_PARENT = {
  screening_agent:'recruiting', talent_search:'recruiting', bench_sales:'recruiting', recruiting_reports:'recruiting', resume_tailor:'recruiting', job_portals:'recruiting', auto_apply:'recruiting', interviews:'recruiting', placements:'recruiting', vendors:'requirements',
  clients:'crm', sequences:'crm', client_requests:'crm', team_directory:'hrms', onboarding:'hrms', id_verification:'hrms', policies:'hrms', attendance:'hrms', approvals:'hrms', tasks:'hrms', announcements:'hrms', immigration_news:'compliance', exams_practice:'learning',
  invoices:'accounting', expenses:'accounting', banking:'accounting', books:'accounting', accounting_reports:'accounting', accounts_chart:'accounting', payroll_setup:'payroll', payroll_tax:'payroll'
};
const featureModeClient = k => (Cap.fa && (Cap.fa[k] || (FEATURE_PARENT[k] && Cap.fa[FEATURE_PARENT[k]]))) || 'default';
// Single features an administrator can switch on for anyone (Roles & access), on top of their role.
const GRANTS = [
  ['hr', 'HR pages', 'Onboarding, document checks, policies and HRMS'],
  ['hrms', 'HRMS', 'Employee records, org chart, leave balances, assets and reviews'],
  ['crm', 'CRM', 'Accounts, contacts, deals pipeline and follow-ups'],
  ['ads', 'Ads', 'Website ads and social job posts'],
  // v45.3: team e-signature
  ['esign', 'E-signatures', 'Upload internal documents, send them for signature (to one person or many) and sign'],
  ['esignAll', 'E-signature manager', 'Runs the shared document library and sees every signature request'],
  // v39: a 4th value: administrators do not have it automatically (calls cost money and ring the browser)
  ['phone', 'Phone & texts', 'Calls from the browser, incoming calls, voicemail and texts with the company numbers (Admin › Phone setup)', 'own'],
];
const GRANT_PAGES = { hr: ['onboarding', 'verify', 'policies', 'hrms', 'compliance', 'immig', 'learning', 'exams', 'practice'], hrms: ['hrms'], crm: ['crm'], ads: ['ads'], esign: ['esign'], esignAll: ['esign'] };

const PAYROLL_PAGES = ['payruns', 'paysetup', 'paytax', 'payplans', 'taxes'];
const REPORTS_ONLY_PAGES = ['books', 'acctreports'];
/* v37 StratEdge Workspaces: the part of the portal each page belongs to. A company workspace shows only the parts the
   provider switched on for it (the server refuses the others' routes too); StratEdge's own site shows everything. */
const PAGE_PART = {
  hrms: 'hr', onboarding: 'hr', verify: 'hr', policies: 'hr', compliance: 'hr', esign: 'hr', immig: 'hr',
  idscan: 'recruiting', 'bench-desk': 'recruiting', 'rec-consultants': 'recruiting', 'rec-submissions': 'recruiting', tailor: 'recruiting', jobs: 'recruiting', autofill: 'recruiting', appbot: 'recruiting', ats: 'recruiting', agent: 'recruiting', sources: 'recruiting', search: 'recruiting', vreqs: 'recruiting', vms: 'recruiting', mkt: 'recruiting', requirements: 'recruiting', recruiting: 'recruiting', jobrules: 'recruiting', interviews: 'recruiting', placements: 'recruiting',
  approvals: 'time', attendance: 'time',
  payplans: 'payroll', payruns: 'payroll', paysetup: 'payroll', paytax: 'payroll', taxes: 'payroll',
  books: 'books', invoices: 'books', expenses: 'books', bank: 'books', acctreports: 'books', accounts: 'books', acctsettings: 'books',
  crm: 'crm', ads: 'crm', sequences: 'crm', clientreq: 'crm', supplier: 'crm',
  learning: 'learning', exams: 'learning', practice: 'learning', learn: 'learning',
  billing: 'billing',
  mail: 'mail', 'mail-validation': 'mail', 'mail-cleanup': 'mail', 'mail-campaigns': 'mail', mymail: 'mail',
  messages: 'chat',
  desk: 'desk', help: 'desk',
  calls: 'phone', phone: 'phone',
  mytax: 'tax',
  work: 'work',
  claims: 'books',
  goals: 'hr',
};
// the member portals' pages (consultant, employee, bench, client, student), by their address under #/portal/
const NAV_PART = {
  jobs: 'recruiting', mysubs: 'recruiting', resume: 'recruiting', autofill: 'recruiting', appbot: 'recruiting', bench: 'recruiting', tailor: 'recruiting', talent: 'recruiting', requests: 'recruiting', requirements: 'recruiting',
  'rec/bench': 'recruiting', 'rec/consultants': 'recruiting', 'rec/eod': 'recruiting', 'rec/search': 'recruiting', 'rec/submissions': 'recruiting', 'rec/tailor': 'recruiting',
  'tools/appbot': 'recruiting', 'tools/idscan': 'recruiting', 'tools/mkt': 'recruiting', 'tools/vms': 'recruiting', 'tools/vreqs': 'recruiting',
  attendance: 'time', timesheets: 'time', timeoff: 'time', reports: 'time',
  pay: 'payroll',
  sign: 'hr', policies: 'hr', onboarding: 'hr', compliance: 'hr', 'tools/hrms': 'hr',
  learn: 'learning', certify: 'learning', tests: 'learning', practice: 'learning', projects: 'learning', vault: 'learning',
  plan: 'billing', membership: 'billing',
  invoices: 'books',
  'rec/mail': 'mail', 'rec/mail-validation': 'mail', 'rec/mail-cleanup': 'mail', 'rec/mail-campaigns': 'mail', mymail: 'mail',
  messages: 'chat',
  calls: 'phone',
  help: 'desk', 'tools/desk': 'desk',
  'tools/esign': 'hr', 'tools/crm': 'crm', 'tools/ads': 'crm', 'tools/sequences': 'crm', 'tools/clientreq': 'crm', proposals: 'crm', 'tools/supplier': 'crm', supplier: 'crm',
  mytax: 'tax',
  work: 'work',
  expenses: 'books',
  goals: 'hr',
};
// StratEdge's own pages that a company workspace does not have: its website, its SOC 2 program, the hosting's health,
// and (v82) Portal integrations - the recruiting-source setup it manages centrally. A workspace still has Calls &
// texts and the Assistant features (both run on StratEdge's central setup). Phone setup STAYS (its "who can use the
// phone" roster is role management), but inside a workspace it shows only that roster, not the provider wiring -
// phoneadmin.js handles that split. The Assistant config lives in Website & messages, itself StratEdge-only.
const WS_STRATEDGE_ONLY = ['website', 'governance', 'health', 'webpages', 'atsconnect', 'sources'];
const wsPageOn = k => !wsOn() || (!WS_STRATEDGE_ONLY.includes(k) && (!PAGE_PART[k] || wsFeat(PAGE_PART[k])));
const wsNavOn = k => !wsOn() || !NAV_PART[k] || wsFeat(NAV_PART[k]);
function pageAllowed(P, key) {
  if (!wsPageOn(key)) return false;
  // v37: the provider console (StratEdge's own administrators, on StratEdge's own site)
  if (key === 'workspaces') return !!Cap.wsAdmin;
  // v45.3: e-signatures for whoever may send (the feature, the whole team as HR decides, or staff)
  if (key === 'esign' && Cap.es && Cap.es.send) return true;
  // v38.1: the server says what this person may import (the same rules as adding those records by hand)
  if (key === 'import') return !!(Cap.imp && Cap.imp.length);
  if (key === 'overview' || key === 'mymail' || key === 'mysecurity' || key === 'learn' || key === 'help' || key === 'mytax') return true;
  if (key === 'work') return Cap.work > 0; // v42: on a project, or may create one (the server checks each project)
  if (key === 'claims') return true; // v43: every staff portal approves, pays or at least makes its own claims
  if (key === 'goals') return true; // v44: everyone has goals; managers see their team's, HR runs the review cycles
  if (key === 'sequences') return pageAllowed(P, 'crm'); // v46: whoever works the CRM
  if (key === 'clientreq' || key === 'supplier') return pageAllowed(P, 'crm'); // v47, v49: whoever works client accounts (the server checks the same)
  if (key === 'webpages') {
    // v50: the website's service pages: administrators, HR and the sales team; v61: allowed or blocked per person
    const fm = featureModeClient('service_pages');
    return fm === 'block' ? false : fm === 'allow' ? true : pageAllowed(P, 'crm');
  }
  if (key === 'messages') return !!Cap.chat;
  if (key === 'calls') return phMine(); // v39: an administrator switched the phone on for this person
  if (key === 'idscan') return !!Cap.ids; // v36.1: the server says who checks IDs
  const roles = P.roles && P.roles.length ? P.roles : [P.roleName];
  if (roles.includes('admin')) return true;
  const fk = FEATURE_PAGE[key];
  if (fk) {
    const fm = featureModeClient(fk);
    if (fm === 'block') return false;
    if (fm === 'allow') return true;
  }
  // v34: the service desk is for the people in an assignment group (the server says who, Cap.desk)
  if (key === 'desk') return !!Cap.desk;
  // a bookkeeper's limits (Admin > Roles & access): no payroll pages, or reports only; outside bookkeepers never see team pages
  if (P.noPay && PAYROLL_PAGES.includes(key)) return false;
  if (P.asg && P.asg.ext && ['team', 'approvals', 'attendance', 'mail', 'clients', 'storage'].includes(key)) return false;
  if (P.books === 'reports' && roles.includes('acct') && !roles.includes('hr') && !REPORTS_ONLY_PAGES.includes(key)) return false;
  if (roles.some(r => (ROLE_PAGES[r] || []).includes(key))) return true;
  const ft = (P.caps && P.caps.ft) || {};
  if (Object.entries(GRANT_PAGES).some(([g, list]) => ft[g] && list.includes(key))) return true;
  // Employees working recruiting use the requirements desk, vendor list and Bench desk
  if (key === 'vreqs' || key === 'vms' || key === 'mkt' || key === 'tailor' || key === 'search' || key === 'bench-desk') return !!Cap.bench && !['employer', 'consultant', 'student'].includes(P.role);
  if (key === 'appbot') return !!P.prof && P.role !== 'employer';
  if (key === 'storage') return !!P.prof && !['employer', 'consultant', 'student'].includes(P.role) && !(P.asg && P.asg.norec);
  // Employees with recruiting access can work the CRM from the Employee portal.
  return key === 'crm' && (!!Cap.bench && !['employer', 'consultant', 'student'].includes(P.role));
}
// The staff portals a person may open come from the server (Admin > Roles & access), in menu order.
const staffPortalsOf = P => {
  const have = (P.portals || []).filter(k => STAFF_KEYS.includes(k));
  if (have.length) return STAFF_KEYS.filter(k => have.includes(k));
  const r = P.roles && P.roles.length ? P.roles : [P.roleName];
  return r.includes('admin') ? ['admin', 'hr', 'acct', 'mgr'] : STAFF_KEYS.filter(k => r.includes({ hr: 'hr', acct: 'acct', mgr: 'manager' }[k]));
};

const NoAccess = ({ title, home, why }) =>
  html`<div className="panel">
      <${Empty} title=${title || 'This page is not part of your access'}>${why || "Your role doesn't include it. An administrator can switch it on under Admin › Roles & access."}<//>
      <div className="actions" style=${{ marginTop: 14 }}>
        <a className="btn" href=${home || '#/portal'}>Back to your portal</a>
      </div>
    </div>`;

function Shell({ path, q }) {
  const P = usePortal();
  const [more, setMore] = useState(false);
  const [find, setFind] = useState('');
  // v38: quick jump to any page (Ctrl+K / ⌘K, or the search button in the top bar)
  const [jump, setJump] = useState(false);
  useJumpKey(() => setJump(true));
  const sub = path.replace(/^\/(portal|client)\/?/, '');
  useEffect(() => {
    setMore(false);
    setFind('');
    setJump(false);
  }, [path]);
  const emp = P.role === 'employer';
  const cons = P.role === 'consultant';
  // v32: students have their own portal; outside consultants (membership) have no timesheets or pay
  const stud = P.role === 'student';
  const outside = cons && Cap.ct === 'outside';
  // v63: every employee has the Bench desk (Cap.bench: unless the feature is blocked for them)
  const bench = !!Cap.bench && !emp && !cons && !stud;
  const mailOk = !emp && !cons && !stud && !!Cap.mail;
  const A = P.admin;
  const toSign = pendingSigs(P.sigs, P.uid).length;
  const openTasks = emp
    ? 0
    : Object.entries(P.asg.tasks || {}).filter(
        ([id, t]) => !t.x && (((P.root.tp || {})[id] || {}).s || 'todo') !== 'done'
      ).length;
  const pendN = A ? A.pendTs.length + A.pendLv.length + (A.pendAtt || []).length : 0;
  // v47: a client contact's talent requests to approve or answer, and proposals to decide
  const crW = useCrWaiting(emp ? P.cid : null, path);
  const memberBadge = { tasks: openTasks, sign: toSign, requirements: crW ? crW.reqs : 0, proposals: crW ? crW.props : 0, supplier: crW ? crW.docs || 0 : 0 };
  const staffBadge = {
    team: A && A.requests ? A.requests.length : 0,
    approvals: pendN,
    website: (A && A.unread) || 0,
    esign: toSign,
  };

  // v64: the client portal's pages by the contact's role in the company (caMay in core.js); unmapped pages are everyone's
  const CLIENT_AREA = { talent: 'requests', requests: 'requests', requirements: 'requests', timesheets: 'timesheets', consultants: 'consultants', attendance: 'consultants', proposals: 'proposals', supplier: 'supplier', invoices: 'invoices', reports: 'reports', reviews: 'reports', people: 'people' };
  const clientPageOn = k => !CLIENT_AREA[k] || caMay(P.cid, CLIENT_AREA[k]);
  // The person's own portal (consultant, employee, student or client).
  const BASE_NAV = bench ? [MEMBER_NAV[0], ['bench', 'Jobs & matches', 'search'], ...MEMBER_NAV.slice(1)] : MEMBER_NAV;
  const onbOpen = !emp && P.asg.onb && P.asg.onb.kind !== 'done';
  const primary0 = emp
    ? P.cid
      ? CLIENT_NAV.filter(([k]) => clientPageOn(k))
      : CLIENT_NAV.filter(([k]) => ['', 'talent', 'requirements', 'requests', 'sign', 'profile'].includes(k))
    : stud
      ? withMySubs([...STUDENT_NAV.slice(0, 5), ['sign', 'Sign documents', 'sheet'], ...STUDENT_NAV.slice(5)])
      : cons
      ? withMySubs([
          ...(outside ? [...CONSULTANT_NAV.slice(0, 5), MEMBERSHIP_NAV_ITEM] : CONSULTANT_NAV.slice(0, 9)),
          ...(onbOpen ? [['onboarding', 'Onboarding', 'tasks']] : []),
          ['sign', 'Sign documents', 'sheet'],
          ['policies', 'Policies', 'sheet'],
          ...CONSULTANT_NAV.slice(9),
        ])
      : [
          ...BASE_NAV.slice(0, 6),
          ...(onbOpen ? [['onboarding', 'Onboarding', 'tasks']] : []),
          ['sign', 'Sign documents', 'sheet'],
          ['policies', 'Policies', 'sheet'],
          ['mymail', 'My email', 'inbox'],
          ...BASE_NAV.slice(6),
        ];
  // v34: everyone's own sign-in settings (password, two-step sign-in, passkeys, sessions, policies)
  // v37: a company workspace lists only the pages of the parts it has
  // v40: everyone's own tax center
  // v42: work boards, for whoever is on a project (or may create one)
  // v43: My expenses (claims) for employees and consultants paid through the company (not clients, students or outside consultants)
  const primary = [...primary0.slice(0, 1), ...(Cap.chat ? [MSG_NAV_ITEM] : []), ...(phMine() && !emp ? [CALLS_NAV_ITEM] : []), ...(Cap.work > 0 ? [WORK_NAV_ITEM] : []), ...primary0.slice(1), ...(!emp && !stud && !outside ? [GOALS_NAV_ITEM, EXP_NAV_ITEM] : []), TAX_NAV_ITEM, HELP_NAV_ITEM, SEC_NAV_ITEM].filter(n => wsNavOn(n[0]));
  const rec = [
    ...(!emp && !cons && !stud && P.prof && !P.asg.norec ? REC_NAV.filter(n => (n[0] !== 'tools/idscan' || Cap.ids) && (n[0] !== 'rec/import' || (Cap.imp && Cap.imp.length))) : []),
    ...(!P.isAdmin && mailOk ? MAIL_NAV_ITEMS : []),
  ].filter(n => wsNavOn(n[0]));
  const grow = GROW_NAV.filter(n => wsNavOn(n[0]));
  const tools = P.isAdmin
    ? []
    : ['crm', 'sequences', 'clientreq', 'supplier', 'webpages', 'hrms', 'ads', 'desk', 'esign'].filter(k => pageAllowed(P, k)).map(k => ['tools/' + k, PAGES[k].n, PAGES[k].i]);

  // Which portals this person has: their member portals (employee, consultant, client workspaces) and staff portals.
  const staffKeys = staffPortalsOf(P);
  const memberKey = P.view === 'bench' ? 'employee' : P.view || (emp ? 'client' : cons ? 'consultant' : stud ? 'student' : 'employee');
  const memberKeys = MEMBER_KEYS.filter(k => (P.portals || []).includes(k));
  const external = !!(P.asg && P.asg.ext); // an outside bookkeeper: accounting portal only
  if (!memberKeys.length && !external && (P.prof || !staffKeys.length)) memberKeys.push(memberKey);
  const hasMember = (!!P.prof && !external) || !staffKeys.length;
  const portals = [
    ...(hasMember
      ? memberKeys.flatMap(k =>
          k === 'client' && P.clients && P.clients.length > 1
            ? P.clients.map(c => ['client:' + c.id, 'Client portal · ' + c.n])
            : [[k, PORTAL_INFO[k].n]]
        )
      : []),
    ...staffKeys.map(k => [k, STAFF_PORTALS[k].n]),
  ];
  const segs = sub.split('/');
  const sp = STAFF_PORTALS[segs[0]] ? segs[0] : null;
  // Staff pages live in js/staff.js, fetched the first time one is opened (staff accounts fetch it at login).
  const staffRoute = !!sp || sub.startsWith('tools/') || sub.startsWith('rec/') || sub === 'mymail' || sub === 'bench';
  const [staffTick, setStaffTick] = useState(0);
  const [staffErr, setStaffErr] = useState(null);
  // v62: the pages in js/staff2.js (STAFF2_KEYS) wait for that bundle too
  const pageKeyAny = sp ? (PAGE_ALIAS[sp] || {})[segs.slice(1).join('/')] || segs.slice(1).join('/') || 'overview' : sub.startsWith('tools/') ? sub.slice(6) : '';
  const needStaff2 = STAFF2_KEYS.includes(pageKeyAny);
  const needStaff = staffRoute && (!staffReady() || (needStaff2 && !staff2Ready()));
  useEffect(() => {
    if (!needStaff) return;
    let live = true;
    (needStaff2 ? loadStaff2() : loadStaff()).then(
      () => live && setStaffTick(t => t + 1),
      e => live && setStaffErr(e)
    );
    return () => {
      live = false;
    };
  }, [needStaff, staffTick]);
  const rawKey = sp ? segs.slice(1).join('/') : '';
  const pageKey = sp ? (PAGE_ALIAS[sp] || {})[rawKey] || rawKey || 'overview' : null;
  const spOk = !!sp && staffKeys.includes(sp);
  // A staff address for a portal this person doesn't have goes to the same page in a portal they do have.
  const redirect =
    sp && !spOk
      ? staffKeys[0]
        ? '#/portal/' + staffKeys[0] + (pageKey !== 'overview' ? '/' + pageKey : '') + (location.hash.includes('?') ? '?' + location.hash.split('?')[1] : '')
        : '#/portal'
      : !sp && !hasMember
        ? '#/portal/' + staffKeys[0] + ({ security: '/mysecurity', learn: '/learn', help: '/help', messages: '/messages', calls: '/calls', mytax: '/mytax', work: '/work', goals: '/goals', expenses: '/claims?t=mine', 'rec/bench': '/bench-desk' }[sub] || '') + ((sub === 'learn' || sub === 'help' || sub === 'messages' || sub === 'calls' || sub === 'mytax' || sub === 'work' || sub === 'goals') && location.hash.includes('?') ? '?' + location.hash.split('?')[1] : '')
        : null;
  useEffect(() => {
    if (redirect) location.replace(redirect);
  }, [redirect]);
  const inPortal = sp && spOk ? sp : hasMember ? (memberKey === 'client' && P.clients && P.clients.length > 1 && P.cid ? 'client:' + P.cid : memberKey) : staffKeys[0];

  const item = (portal, k) => [
    portal + (k === 'overview' ? '' : '/' + k),
    k === 'overview' ? STAFF_PORTALS[portal].home : PAGES[k].n,
    PAGES[k].i,
    k,
  ];
  let groups;
  if (sp && spOk) {
    const seen = new Set();
    groups = STAFF_PORTALS[sp].groups.map(([g, keys]) => [
      g,
      keys
        .filter(k => {
          if (seen.has(k) || !PAGES[k] || !pageAllowed(P, k)) return false;
          seen.add(k);
          return true;
        })
        .map(k => item(sp, k)),
    ]);
    // derived access: anything else this person was given shows up too
    const extra = (P.roles || []).includes('admin') ? [] : Object.keys(PAGES).filter(k => !seen.has(k) && k !== 'overview' && k !== 'myteam' && k !== 'mysecurity' && k !== 'learn' && pageAllowed(P, k));
    if (extra.length) groups.push(['More tools', extra.map(k => item(sp, k))]);
    groups = groups.filter(g => g[1].length);
  } else
    groups = [
      ['', primary],
      ...(!emp && grow.length ? [[stud ? 'Learn & grow' : 'Grow', grow]] : []),
      ...(rec.length ? [['Recruiting', rec]] : []),
      ...(tools.length ? [['Tools', tools]] : []),
    ];
  const flat = groups.flatMap(g => g[1]);
  const needle = find.trim().toLowerCase();
  const shown = needle
    ? groups
        .map(([g, items]) => [g, items.filter(n => n[1].toLowerCase().includes(needle))])
        .filter(g => g[1].length)
    : groups;
  const memberAll = [...primary, ...rec, ...tools, MYSUBS_NAV_ITEM, ...CONSULTANT_NAV, ...BENCH_NAV, ...MEMBER_NAV, ...CLIENT_NAV, ...REC_NAV, ...MAIL_NAV_ITEMS, ...GROW_NAV, ...STUDENT_NAV, MEMBERSHIP_NAV_ITEM];
  const cur = sp
    ? flat.find(n => n[3] === pageKey) || [
        sub,
        pageKey === 'overview' ? STAFF_PORTALS[sp].home : (PAGES[pageKey] || {}).n || 'Page not found',
        'grid',
        pageKey,
      ]
    : memberAll.find(n => n[0] === sub) || flat[0] || ['', 'Dashboard', 'home'];
  const portalName = (portals.find(x => x[0] === inPortal) || portals[0] || ['', 'Portal'])[1];
  const switchPortal = e => {
    const k = e.target.value;
    if (k === 'choose') {
      location.hash = '#/portal/choose?pick=0';
      return;
    }
    if (k.startsWith('client:')) {
      P.setCid(k.slice(7));
      location.hash = '#/portal/client?c=' + k.slice(7);
      return;
    }
    location.hash = STAFF_PORTALS[k] ? '#/portal/' + k : (PORTAL_INFO[k] || {}).href || '#/portal';
  };
  const title = cur[1];
  const href = k => '#' + (P.base || '/portal') + (k ? '/' + k : '');
  const jumpItems = () => [
    ...groups.flatMap(([g, items]) => items.map(n => ({ n: n[1], g: g || portalName, i: n[2], href: href(n[0]) }))),
    ...portals
      .filter(x => x[0] !== inPortal)
      .map(x => ({ n: x[1], g: 'Switch portal', i: 'switch', href: '#/portal/' + x[0], run: () => switchPortal({ target: { value: x[0] } }) })),
  ];
  const link = n => {
    const b = n[3] ? staffBadge[n[3]] : memberBadge[n[0]];
    return html`<a key=${n[0]} href=${href(n[0])} className=${cur[0] === n[0] ? 'on' : ''} aria-current=${cur[0] === n[0] ? 'page' : undefined}>
        <${Icon} n=${n[2]} />
        <span className="nl">${n[1]}</span>${b ? html`<span className="badge">${b}</span>` : null}
      </a>`;
  };
  const tabs =
    sp && spOk
      ? STAFF_PORTALS[sp].tabs.map(k => (k ? sp + '/' + k : sp)).filter(r => flat.some(n => n[0] === r))
      : emp
        ? ['', 'timesheets', 'consultants', 'requirements'].filter(k => clientPageOn(k))
        : stud
          ? ['', 'plan', 'learn', 'tests']
          : outside
          ? ['', 'jobs', 'membership', 'resume']
          : cons
          ? ['', 'jobs', 'timesheets', 'resume']
          : bench
            ? ['', 'bench', 'attendance', 'timesheets']
            : ['', 'attendance', 'timesheets', rec.length ? 'rec/submissions' : 'pay'];
  const tabItem = k => flat.find(x => x[0] === k) || memberAll.find(x => x[0] === k) || ['', 'Home', 'home'];
  const tabsShown = sp && spOk ? tabs : tabs.filter(k => k === '' || wsNavOn(k));

  const page = (() => {
    if (redirect) return html`<${Spinner} />`;
    if (needStaff)
      return staffErr
        ? html`<${LoadError} error=${{ message: 'The staff part of the site did not load. Check your connection and reload the page.' }} onRetry=${() => {
            setStaffErr(null);
            setStaffTick(t => t + 1);
          }} />`
        : html`<${Spinner} label="Loading…" />`;
    if (sp) {
      const def = PAGES[pageKey];
      if (!def) return html`<${NoAccess} title="That page doesn't exist" home=${'#/portal/' + sp} />`;
      if (!wsPageOn(pageKey)) return html`<${NoAccess} title="This page isn't part of this portal" home=${'#/portal/' + sp} why=${wsName() + ' does not use this part of the portal.'} />`;
      if (!pageAllowed(P, pageKey)) return html`<${NoAccess} home=${'#/portal/' + sp} />`;
      return def.c(sp, q);
    }
    // v37: a page of a part this company workspace does not have
    if (!wsNavOn(sub)) return html`<${NoAccess} title="This page isn't part of this portal" home="#/portal" why=${wsName() + ' does not use this part of the portal.'} />`;
    // v40: My taxes, in every member portal (client contacts too)
    if (sub === 'mytax') return html`<${TaxCenterPage} />`;
    // v42: work boards, in every member portal (for people on a project)
    if (sub === 'work') return Cap.work > 0 ? html`<${WorkBoardsPage} q=${q} />` : html`<${NoAccess} home="#/portal" why="You are not on any project yet." />`;
    // v43: the person's own expense claims
    if (sub === 'expenses' && !emp && !stud) return html`<${ClaimsPage} q=${q} />`;
    // v44: the person's own goals and reviews
    if (sub === 'goals' && !emp && !stud) return html`<${GoalsPage} q=${q} />`;
    // v64: a page outside the contact's role at the company
    if (emp && P.cid && !clientPageOn(sub)) return html`<${NoAccess} home="#/portal" why="Your role at your company does not cover this page. Ask a colleague with full access, or StratEdge." />`;
    if (emp)
      switch (sub) {
        case 'reviews':
          // v66: the scorecard and the business reviews (js/work.js)
          return P.cid ? html`<${Lazy} load=${loadWork} get=${() => CrReviewsPage} props=${{ q }} label="Opening business reviews…" />` : html`<${NoAccess} home="#/portal" why="Business reviews are for client companies." />`;
        case 'delivery':
          // v65: the delivery and escalation desk: the account team, decisions, requests, interviews, starts, issues (js/work.js)
          return P.cid ? html`<${Lazy} load=${loadWork} get=${() => CrDeliveryPage} props=${{ q }} label="Opening the delivery desk…" />` : html`<${NoAccess} home="#/portal" why="The delivery desk is for client companies." />`;
        case 'people':
          // v64: the company's people, their roles and business units, delegations and access reviews (js/work.js)
          return P.cid ? html`<${Lazy} load=${loadWork} get=${() => CrPeoplePanel} props=${{ cid: P.cid, staff: false }} label="Opening people & access…" />` : html`<${NoAccess} home="#/portal" why="People & access is for client companies." />`;
        case 'talent':
          return html`<${TalentPage} q=${q} />`;
        case 'requests':
          return html`<${MyRequestsPage} />`;
        case 'timesheets':
          return html`<${ClientTimesheets} />`;
        case 'consultants':
          return html`<${ClientConsultants} />`;
        case 'attendance':
          return html`<${ClientAttendance} />`;
        case 'requirements':
          return html`<${ClientRequirements} q=${q} />`;
        case 'supplier':
          // v49: StratEdge's supplier profile and the documents the company asked for (js/work.js)
          return P.cid ? html`<${Lazy} load=${loadWork} get=${() => CqClientPage} label="Opening supplier documents…" />` : html`<${NoAccess} home="#/portal" why="Supplier documents are for client companies." />`;
        case 'proposals':
          // v47: proposals from StratEdge to the client company (js/work.js)
          return P.cid ? html`<${Lazy} load=${loadWork} get=${() => CrClientProposals} props=${{ q }} label="Opening proposals…" />` : html`<${NoAccess} home="#/portal" why="Proposals are for client companies." />`;
        case 'reports':
          return html`<${ClientReports} />`;
        case 'invoices':
          return html`<${ClientInvoices} />`;
        case 'sign':
          return html`<${SignDocsPage} />`;
        case 'profile':
          return html`<${Profile} />`;
        case 'security':
          return html`<${MySecurityPage} />`;
        case 'help':
          return html`<${HelpPage} q=${q} />`;
        case 'messages':
          return Cap.chat ? html`<${MessagesPage} q=${q} />` : html`<${NoAccess} />`;
        default:
          // a vendor contact has no client workspace: the marketplace is their home
          return P.cid ? html`<${ClientDashboard} />` : html`<${TalentPage} q=${q} />`;
      }
    if (sub.startsWith('tools/')) {
      const k = sub.slice(6);
      return PAGES[k] && pageAllowed(P, k) ? PAGES[k].c('', q) : html`<${NoAccess} />`;
    }
    // v32: students are not on StratEdge's payroll: no clock-ins, timesheets, pay or time off
    if (stud && ['attendance', 'timesheets', 'pay', 'timeoff', 'mymail', 'bench', 'onboarding'].includes(sub)) return html`<${StudentHome} />`;
    switch (sub) {
      case 'attendance':
        return html`<${Attendance} />`;
      case 'timesheets':
        return html`<${Timesheets} q=${q} />`;
      case 'pay':
        return html`<${EarningsHub} />`;
      case 'tasks':
        return html`<${Tasks} />`;
      case 'timeoff':
        return html`<${TimeOff} />`;
      case 'documents':
        return html`<${Documents} />`;
      case 'profile':
        return html`<${Profile} q=${q} />`;
      case 'security':
        return html`<${MySecurityPage} />`;
      case 'help':
        return html`<${HelpPage} q=${q} />`;
      case 'messages':
        return Cap.chat ? html`<${MessagesPage} q=${q} />` : html`<${NoAccess} />`;
      case 'calls':
        return phMine() ? html`<${CallsPage} q=${q} />` : html`<${NoAccess} title="The phone is not switched on for you" why="An administrator can switch on Phone & texts for you under Roles & access." />`;
      case 'onboarding':
        return html`<${OnboardingPage} />`;
      case 'policies':
        return html`<${PoliciesPage} />`;
      case 'sign':
        return html`<${SignDocsPage} />`;
      case 'mymail':
        if (!cons) return html`<${MyMail} q=${q} />`;
        break;
      case 'jobs':
        return html`<${JobsPage} />`;
      // v36: the consultant's submissions in plain words, approvals to give and details to confirm
      case 'mysubs':
        return html`<${MySubsPage} />`;
      case 'resume':
        return html`<${ResumePage} />`;
      case 'autofill':
        return html`<${ApplyProfilePage} />`;
      case 'appbot':
        return html`<${ApplicationBotPage} />`;
      case 'bench':
        if (bench || P.isAdmin) return html`<${JobPortalsAdmin} />`;
        break;
      // The Grow pages for consultants and employees (client contacts never reach here)
      case 'compliance':
        return html`<${CompliancePage} q=${q} />`;
      case 'immigration-live':
        return html`<${ImmigrationLivePage} />`;
      case 'learn':
        return html`<${LearnPage} q=${q} />`;
      case 'projects':
        return html`<${ProjectsPage} q=${q} />`;
      case 'vault':
        return html`<${VaultPage} q=${q} />`;
      // Tailor my own resume to a job (consultants and employees)
      case 'tailor':
        return html`<${TailorPage} q=${q} />`;
      // v32: StratEdge certifications, daily and weekly tests, plans and payments
      case 'certify':
        return html`<${CertsPage} q=${q} />`;
      case 'tests':
        return html`<${TestsPage} q=${q} />`;
      // v35: practice calls and voice drills
      case 'practice':
        return html`<${PracticePage} q=${q} />`;
      case 'plan':
      case 'membership':
        if (stud || Cap.ct === 'outside' || Cap.ct === 'student') return html`<${BillingPage} q=${q} />`;
        break;
    }
    if ((!emp && !cons && !stud && !P.asg.norec) || P.isAdmin)
      switch (sub) {
        case 'rec/bench':
          return html`<${BenchDeskPage} q=${q} />`;
        case 'rec/consultants':
          return html`<${RecConsultants} />`;
        case 'rec/submissions':
          return html`<${RecSubmissions} />`;
        case 'rec/eod':
          return html`<${RecEOD} />`;
        case 'rec/tailor':
          return html`<${TailorStaffPage} q=${q} />`;
        case 'rec/search':
          return html`<${TalentSearchPage} q=${q} />`;
        // Import with preview for employee recruiters
        case 'rec/import':
          if (Cap.imp && Cap.imp.length) return html`<${ImportPage} q=${q} />`;
          break;
      }
    if ((mailOk || P.isAdmin) && sub === 'rec/mail') return html`<${MailPage} q=${q} />`;
    if ((mailOk || P.isAdmin) && sub === 'rec/mail-validation') return html`<${MailValidationPage} />`;
    if ((mailOk || P.isAdmin) && sub === 'rec/mail-cleanup') return html`<${MailCleanupPage} />`;
    if ((mailOk || P.isAdmin) && sub === 'rec/mail-campaigns') return html`<${MailCampaignPage} q=${q} />`;
    return stud ? html`<${StudentHome} />` : html`<${Dashboard} />`;
  })();
  const me = P.people[P.uid] || Cap.me || {};
  const roleLine = sp
    ? { admin: 'Admin', hr: 'HR', acct: 'Accounting', mgr: 'Manager' }[sp]
    : emp
      ? (P.clients && P.clients.length && P.cid ? (P.clients.find(c => c.id === P.cid) || {}).n : '') || P.asg.cl || (P.prof && P.prof.co) || 'Client contact'
      : stud
        ? 'Student' + (Cap.billing && Cap.billing.pt ? ' · ' + Cap.billing.pt : '')
        : outside
        ? 'Outside consultant'
        : cons
        ? P.asg.ty
          ? P.asg.ty + ' consultant'
          : 'Consultant'
        : bench
          ? 'Employee'
          : wsOn()
            ? 'Employee'
            : 'StratEdge employee';
  const banner =
    toSign > 0 && sub !== 'sign' && !sub.endsWith('esign')
      ? html`<div className="note amber" style=${{ marginBottom: 18 }}>
          <span><b>${toSign} document${toSign === 1 ? '' : 's'} waiting for your signature.</b></span>
          <div className="actions"><a className="btn sm" href="#/portal/sign">Review and sign</a></div>
        </div>`
      : null;
  // v34: two-step sign-in to set up before the deadline, security policies to accept
  const secHref = sp && spOk ? '#/portal/' + sp + '/mysecurity' : '#/portal/security';
  const onSec = sub === 'security' || pageKey === 'mysecurity';
  const notices = onSec ? null : html`<${SecurityNotices} securityHref=${secHref} policiesHref=${secHref} />`;
  const content = html`<${Fragment}>${notices}${banner}${emp ? html`<${ClientData}>${page}<//>` : page}<//>`;
  const switcher = style =>
    portals.length > 1
      ? html`<label className="pswitch" style=${style}>
          <span className="plabel">${portalName}</span>
          <select value=${inPortal} onChange=${switchPortal} aria-label="Switch portal">
            ${portals.map(x => html`<option key=${x[0]} value=${x[0]}>${x[1]}</option>`)}
            <option value="choose">All portals…</option>
          </select>
        </label>`
      : html`<div className="plabel">${portalName}</div>`;
  return html`<div className=${'app p-' + inPortal}>
      <${StaleBanner} />
      <aside className="side" aria-label="Portal navigation">
        <a className="brand" href="#/" aria-label="StratEdge website"><${Logo} /></a>
        ${switcher()}
        ${
          flat.length > 10 &&
          html`<label className="navfind">
              <${Icon} n="search" />
              <input type="search" placeholder="Find a page" value=${find} onInput=${e => setFind(e.target.value)} aria-label="Find a page" />
            </label>`
        }
        <div className="navscroll">
          ${shown.map(([g, items], i) => html`<${Fragment} key=${g || i}>${g && html`<div className="grp">${g}</div>`}<nav>${items.map(link)}</nav><//>`)}
          ${needle && !shown.length && html`<p className="muted small" style=${{ padding: '8px 14px' }}>No page matches.</p>`}
        </div>
        <div className="me">
          <img src=${me.avatarUrl} alt="" />
          <div style=${{ minWidth: 0 }}>
            <b>${(P.prof && P.prof.n) || me.name || 'You'}</b>
            <span>${roleLine}</span>
          </div>
          ${portals.length > 1 && html`<a className="btn ghost icon sm" href="#/portal/choose?pick=0" title="Switch portal" aria-label="Switch portal"><${Icon} n="switch" /></a>`}
        </div>
        <${InstallAppButton} className="btn ghost sm installbtn" label="Install on this device" />
        <div className="ver" title=${'Build ' + APP_BUILD}>${typeof APP_VERSION === 'string' ? APP_VERSION : ''} · ${APP_BUILD}${P.isAdmin ? html` · <a href="#/portal/admin/health">health</a>` : null}</div>
      </aside>
      <div className="main">
        <header className="ptop">
          <a className="mlogo" href="#/" aria-label="StratEdge website"><${Logo} /></a>
          <div className="ttl">
            <span className="crumb">${portalName}</span>
            <h1>${title}</h1>
          </div>
          <div className="push">
            ${Cap.chat && html`<${MessagesButton} href=${sp && spOk ? '#/portal/' + sp + '/messages' : href('messages')} />`}
            ${Cap.phone && html`<${PhoneButton} href=${sp && spOk ? '#/portal/' + sp + '/calls' : href('calls')} />`}
            ${wsFeat('desk') && html`<${HelpBot} title=${title} helpHref=${sp && spOk ? '#/portal/' + sp + '/help' : href('help')} />`}
            ${aiOn('copilot') && html`<${AskAi} portalName=${portalName} title=${title} />`}
            <button type="button" className="btn ghost icon jumpbtn" onClick=${() => setJump(true)} aria-label=${'Jump to a page (' + JUMP_KEY + ')'} title=${'Jump to a page (' + JUMP_KEY + ')'}>
              <${Icon} n="search" />
            </button>
            <${Appearance} />
            <a className="btn ghost sm" href="#/">Website</a>
            <button className="btn ghost sm" onClick=${logout}><${Icon} n="exit" />Log out</button>
          </div>
        </header>
        <main className="content" key=${path}><${PageGuard} where=${'portal/' + sub}>${content}<//></main>
      </div>
      <nav className="tabbar" aria-label="Portal sections">
        ${tabsShown.map(k => {
          const n = tabItem(k);
          const b = n[3] ? staffBadge[n[3]] : memberBadge[n[0]];
          return html`<a key=${k} href=${href(k)} className=${cur[0] === k ? 'on' : ''}>
              <${Icon} n=${n[2]} />
              ${k === '' || STAFF_PORTALS[k] ? 'Home' : n[1].replace('Team attendance', 'Attendance').replace('Payroll runs & paystubs', 'Payroll')}${b ? html`<span className="badge">${b}</span>` : null}
            </a>`;
        })}
        <button onClick=${() => setMore(true)}><${Icon} n="more" />More</button>
      </nav>
      ${jump && html`<${QuickJump} items=${jumpItems()} onClose=${() => setJump(false)} />`}
      ${
        more &&
        html`<${Modal} title="Portal" onClose=${() => setMore(false)}>
            <div className="side" style=${{ display: 'flex', position: 'static', height: 'auto', border: 0, padding: 0 }}>
              ${portals.length > 1 && switcher({ padding: '0 16px 10px' })}
              ${groups.map(
                ([g, items], i) => html`<${Fragment} key=${g || i}>
                    ${g && html`<div className="grp">${g}</div>`}
                    <nav>${items.filter(n => !tabsShown.includes(n[0])).map(link)}</nav>
                  <//>`
              )}
              <div className="grp">Account</div>
              <nav>
                <a href="#/">Back to website</a>
                <a href="#/" onClick=${e => {
                  e.preventDefault();
                  logout();
                }}><${Icon} n="exit" />Log out</a>
              </nav>
            </div>
          <//>`
      }
    </div>`;
}

/* ---- Manager portal: the people who report to this person ---- */
const mgrTeam = P => {
  const A = P.admin;
  if (!A) return [];
  return A.members.filter(
    m => !m.self && m.role !== 'employer' && (P.isMgr || (m.r && m.r.mgrId === P.uid))
  );
};
function MgrHome() {
  const P = usePortal();
  const A = P.admin;
  if (!A || A.loading) return html`<${Spinner} label="Loading your team…" />`;
  const team = mgrTeam(P);
  const ids = new Set(team.map(m => m.id));
  const ts = A.pendTs.filter(x => ids.has(x.m.id)).length;
  const lv = A.pendLv.filter(x => ids.has(x.m.id)).length;
  const att = (A.pendAtt || []).filter(x => ids.has(x.m.id)).length;
  const on = team.filter(m => m.u.clock && m.u.clock.on).length;
  const h = new Date().getHours();
  return html`<div className="stack">
      <div className="hello">
        <h2>Good ${h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'}, ${firstName((P.prof && P.prof.n) || (Cap.me && Cap.me.name) || '')}</h2>
        <p className="muted">Your team at a glance. Approvals you make here count for payroll the same way as HR's.</p>
      </div>
      <${KitStats} items=${[
        { v: team.length, l: 'People reporting to you', href: '#/portal/mgr/myteam' },
        { v: on, l: 'On the clock now', href: '#/portal/mgr/attendance' },
        { v: ts + lv, l: 'Timesheets and time off to approve', href: '#/portal/mgr/approvals' },
        { v: att, l: 'Clock-ins to approve', href: '#/portal/mgr/approvals' },
      ]} />
      ${
        team.length
          ? html`<${MgrTeam} compact />`
          : html`<div className="panel"><${Empty} title="No one reports to you yet">An administrator or HR sets "Reports to" for each person under Roles & access or HRMS › Employees.<//></div>`
      }
    </div>`;
}
function MgrTeam({ compact }) {
  const P = usePortal();
  const A = P.admin;
  if (!A || A.loading) return html`<${Spinner} />`;
  const team = mgrTeam(P);
  if (!team.length && !compact)
    return html`<div className="panel"><${Empty} title="No one reports to you yet">People appear here once their "Reports to" is set to you.<//></div>`;
  const pend = id =>
    A.pendTs.filter(x => x.m.id === id).length +
    A.pendLv.filter(x => x.m.id === id).length +
    (A.pendAtt || []).filter(x => x.m.id === id).length;
  return html`<section className="panel" style=${{ padding: '6px 8px' }}>
      <div className="tblwrap">
        <table className="tbl">
          <thead>
            <tr><th>Person</th><th>Today</th><th className="r">Waiting for you</th>${!compact && html`<th>Contact</th>`}</tr>
          </thead>
          <tbody>
            ${team.map(m => {
              const p = m.u.p;
              const n = pend(m.id);
              return html`<tr key=${m.id}>
                  <td>
                    <div className="pcell">
                      <img src=${avatarFor(p.n, m.id).url} alt="" />
                      <div><b>${p.n}</b><span className="muted small">${(m.r && m.r.ti) || p.ti || portalLabel(m.role)}</span></div>
                    </div>
                  </td>
                  <td>${m.u.clock && m.u.clock.on ? html`<${Chip} s="ok">On the clock<//>` : html`<${Chip}>Not clocked in<//>`}</td>
                  <td className="r">${n ? html`<a href="#/portal/mgr/approvals">${n} to review</a>` : html`<span className="muted">—</span>`}</td>
                  ${!compact && html`<td className="small">${p.e}${p.ph ? html`<br />${p.ph}` : null}</td>`}
                </tr>`;
            })}
          </tbody>
        </table>
      </div>
    </section>`;
}

/* ---- Admin › Roles & access ---- */
const LOGIN_LINKS = [
  ['consultant', 'Consultant'],
  ['employee', 'Employee'],
  ['student', 'Student'],
  ['client', 'Client'],
  ['hr', 'HR'],
  ['acct', 'Accounting'],
  ['manager', 'Manager'],
  ['admin', 'Admin'],
];
const ROLE_OPTS = [
  ['user', 'Member only'],
  ['manager', 'Manager'],
  ['hr', 'HR'],
  ['acct', 'Accounting'],
  ['admin', 'Administrator'],
];
const MEMBER_ROLE_OPTS = [
  ['employee', 'Employee'],
  ['consultant', 'Consultant'],
  ['student', 'Student'],
];
/* One form that makes any kind of login: a client contact (one or more workspaces), an employee, a consultant or a
   member, with the portals ticked. v34: the person is emailed an invitation link to choose their own
   password (no temporary passwords). */
function AddLogin({ onClose, clients, defaultKind, defaultCids }) {
  const toast = useToast();
  const P = usePortal();
  const owner = (P.roles || []).includes('admin');
  const [f, setF] = useState({ name: '', email: '', company: '', title: '', phone: '', kind: defaultKind || 'employer', books: 'view', nopay: true });
  const [portals, setPortals] = useState(defaultKind && defaultKind !== 'employer' ? [defaultKind] : []);
  const [cids, setCids] = useState(defaultCids || []);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const toggle = (list, set, k) => set(list.includes(k) ? list.filter(x => x !== k) : [...list, k]);
  const submit = async e => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api('admin_create_user', { ...f, portals: f.kind === 'employer' ? [...portals, 'client'] : f.kind === 'bookkeeper' ? ['acct'] : [f.kind, ...portals], cids: f.kind === 'employer' ? cids : [] });
      setDone(r);
      toast(r.mailed ? 'Login created and the invitation emailed.' : 'Login created. Email could not be sent, so send the invitation link below.');
    } catch (x) {
      toast(errText(x), true);
    }
    setBusy(false);
  };
  const kinds = [
    ['employer', 'Client contact'],
    ['employee', 'Employee'],
    ['consultant', 'Consultant'],
    ['student', 'Student'],
    ...(owner ? [['bookkeeper', 'Outside bookkeeper / accountant']] : []),
  ];
  const BOOKS_LEVELS = [
    ['full', 'Full: keep the books (categorize, reconcile, journal entries, invoices and bills)'],
    ['view', 'View only: see every record and report, change nothing'],
    ['reports', 'Reports only: the Books reports and exports'],
  ];
  return html`<${Modal} title="Add a login" onClose=${onClose} foot=${done
    ? html`<button type="button" className="btn" onClick=${onClose}>Done</button>`
    : html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${submit}>${busy ? 'Creating…' : 'Create login'}</button>`}>
      ${
        done
          ? html`<${InviteResult} name=${f.name} email=${f.email} link=${done.link} mailed=${done.mailed} />`
          : html`<form className="form" onSubmit=${submit}>
              <div className="row2">
                <${Field} label="Full name"><input value=${f.name} onInput=${up('name')} required autoFocus /><//>
                <${Field} label="Email"><input type="email" value=${f.email} onInput=${up('email')} required /><//>
              </div>
              <${Field} label="Kind of login">
                <select value=${f.kind} onChange=${up('kind')}>${kinds.map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select>
              <//>
              ${
                f.kind === 'bookkeeper'
                  ? html`<${Fragment}>
                      <${Field} label="Books access">
                        <select value=${f.books} onChange=${up('books')}>${BOOKS_LEVELS.map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select>
                      <//>
                      <label className="check"><input type="checkbox" checked=${!f.nopay} onChange=${e => setF({ ...f, nopay: !e.target.checked })} /><span>Can see payroll (pay runs, paystubs, tax filings, pay plans)</span></label>
                      <p className="muted small" style=${{ margin: 0 }}>A bookkeeper gets the accounting portal only: no employee portal, no team pages, and every change they make is in the audit log. The level can be changed later under Bookkeepers below.</p>
                    <//>`
                  : f.kind === 'employer'
                  ? html`<${Field} label="Client workspaces" hint="A contact can belong to more than one client and switch between them.">
                      <div className="checks">
                        ${(clients || []).map(c => html`<label key=${c.id} className="check"><input type="checkbox" checked=${cids.includes(c.id)} onChange=${() => toggle(cids, setCids, c.id)} /><span>${c.n}</span></label>`)}
                        ${!(clients || []).length && html`<span className="muted small">Add a client under Clients first.</span>`}
                      </div>
                    <//>`
                  : html`<${Field} label="Extra portals" hint="On top of their own portal.">
                      <div className="checks">
                        ${MEMBER_KEYS.filter(k => k !== f.kind && k !== 'client').map(k => html`<label key=${k} className="check"><input type="checkbox" checked=${portals.includes(k)} onChange=${() => toggle(portals, setPortals, k)} /><span>${PORTAL_INFO[k].n}</span></label>`)}
                        ${owner && STAFF_KEYS.map(k => html`<label key=${k} className="check"><input type="checkbox" checked=${portals.includes(k)} onChange=${() => toggle(portals, setPortals, k)} /><span>${PORTAL_INFO[k].n}</span></label>`)}
                      </div>
                    <//>`
              }
              <div className="row2">
                <${Field} label=${f.kind === 'employer' ? 'Company (optional)' : f.kind === 'bookkeeper' ? 'Firm (optional)' : 'Title (optional)'}><input value=${f.kind === 'employer' || f.kind === 'bookkeeper' ? f.company : f.title} onInput=${up(f.kind === 'employer' || f.kind === 'bookkeeper' ? 'company' : 'title')} /><//>
                <${Field} label="Phone (optional)"><input value=${f.phone} onInput=${up('phone')} /><//>
              </div>
              <p className="muted small">They are emailed an invitation to choose their own password (the link works once, for 7 days). Staff logins must also set up two-step sign-in.</p>
            </form>`
      }
    <//>`;
}
function AccessPage() {
  const P = usePortal();
  const A = P.admin;
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [featureUid, setFeatureUid] = useState('');
  const owner = (P.roles || []).includes('admin');
  if (!A || A.loading) return html`<${Spinner} />`;
  const people = A.members.filter(m => m.st !== 'inactive');
  const acct = id => (A.accounts || {})[id] || {};
  const leads = people.filter(m => ['manager', 'admin', 'hr', 'acct'].includes(acct(m.id).role) || (acct(m.id).portals || []).some(k => STAFF_KEYS.includes(k)));
  const clients = A.clients || [];
  // the portals a person opens: from the main role, their own record and the extra portals ticked here
  const portalsOfRow = (m, a) => {
    const set = new Set(a.portals || []);
    if (a.role === 'admin') ['admin', 'hr', 'acct', 'mgr'].forEach(k => set.add(k));
    if (a.role === 'hr') set.add('hr');
    if (a.role === 'acct') set.add('acct');
    if (a.role === 'manager') set.add('mgr');
    set.add(m.role === 'employer' ? 'client' : m.role === 'consultant' ? 'consultant' : m.role === 'student' ? 'student' : 'employee');
    return set;
  };
  const setPortal = async (m, a, k, on) => {
    const cur = new Set(a.portals || []);
    if (on) cur.add(k);
    else cur.delete(k);
    try {
      await api('admin_access', { uid: m.id, portals: [...cur] });
      A.loadAccounts();
      toast(`${PORTAL_INFO[k].n} ${on ? 'added for' : 'removed from'} ${firstName(m.u.p.n)}.`);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const setClientLink = async (m, a, cid, on) => {
    const cur = new Set(a.cids || []);
    if (on) cur.add(cid);
    else cur.delete(cid);
    try {
      await api('admin_access', { uid: m.id, cids: [...cur] });
      A.loadAccounts();
      toast('Client workspaces updated.');
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const base = location.origin + location.pathname;
  const copy = url =>
    navigator.clipboard
      ? navigator.clipboard.writeText(url).then(
          () => toast('Link copied.'),
          () => toast(url)
        )
      : toast(url);
  const setRole = async (m, role) => {
    const cur = (acct(m.id).role || 'user');
    if (cur === role) return;
    if (m.self && cur === 'admin' && role !== 'admin' && !confirm('Change your own Administrator role? You will lose Admin access immediately. StratEdge will refuse this if you are the last active administrator.')) return;
    try {
      await api('admin_role', { uid: m.id, role });
      await A.loadAccounts();
      if (m.id === Cap.uid) await reloadCaps();
      toast(`${firstName(m.u.p.n)} is now ${ROLE_OPTS.find(r => r[0] === role)[1].toLowerCase()}.`);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const setMemberRole = async (m, role) => {
    const cur = m.role || 'employee';
    if (cur === role) return;
    const label = MEMBER_ROLE_OPTS.find(x => x[0] === role)?.[1] || role;
    if (!confirm(`Change ${m.u.p.n}'s primary member portal from ${portalLabel(cur)} to ${label}? Their records are kept; this changes which member portal is primary.`)) return;
    try {
      await api('admin_member_role', { uid: m.id, role });
      Sync.kick(0);
      await A.loadAccounts();
      if (m.id === Cap.uid) await reloadCaps();
      toast(`${firstName(m.u.p.n)} now has ${label} as the primary member portal.`);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  // v39: the phone column only where the workspace has the phone part
  const grants = GRANTS.filter(g => g[0] !== 'phone' || wsFeat('phone'));
  const setGrant = async (m, g, on) => {
    try {
      await dbMerge(`r/${m.id}`, { ft: { [g]: on } });
      toast(`${GRANTS.find(x => x[0] === g)[1]} ${on ? 'switched on' : 'switched off'} for ${firstName(m.u.p.n)}.`);
      if (g === 'phone' && m.id === Cap.uid) reloadCaps(); // their own Phone button comes or goes
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const setMgr = async (m, id) => {
    try {
      await api('admin_manager', { uid: m.id, mgrId: id || '' });
      Sync.kick(0);
      toast(id ? `${firstName(m.u.p.n)} now reports to ${firstName(people.find(x => x.id === id).u.p.n)}.` : 'Manager removed.');
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return html`<div className="stack">
      ${adding && html`<${AddLogin} clients=${clients} onClose=${() => {
        setAdding(false);
        A.loadAccounts();
      }} />`}
      <section className="panel stack">
        <div className="ph-row">
          <h2 className="ph">Logins and portals</h2>
          <button type="button" className="btn" onClick=${() => setAdding(true)}><${Icon} n="plus" />Add a login</button>
        </div>
        <p className="muted small">Each portal has its own login page; an account can only sign in through the login of a portal it has, and is otherwise told which portals it can open. A person can hold several portals: tick them in the table below, then they sign in through whichever login they need (and can switch from the sidebar). Send people the link for their portal:</p>
        <div className="linkgrid">
          ${LOGIN_LINKS.map(
            ([k, n]) => html`<div key=${k} className="linkrow">
                <b>${n}</b>
                <code>#/login?as=${k}</code>
                <button type="button" className="btn ghost sm" onClick=${() => copy(base + '#/login?as=' + k)}>Copy link</button>
              </div>`
          )}
        </div>
      </section>
      <${SsoSettings} />
      <section className="panel stack">
        <h2 className="ph">What each role opens</h2>
        <div className="tblwrap">
          <table className="tbl">
            <thead><tr><th style=${{ width: 140 }}>Role</th><th>Pages</th></tr></thead>
            <tbody>
              <tr><td><b>Administrator</b></td><td className="small">Everything, including roles and access, security, the website and email setup.</td></tr>
              ${['hr', 'acct', 'manager'].map(
                r => html`<tr key=${r}>
                    <td><b>${ROLE_OPTS.find(x => x[0] === r)[1]}</b></td>
                    <td className="small">${ROLE_PAGES[r].map(k => PAGES[k].n).join(' · ')}${r === 'manager' ? '. Only people who report to them, and never pay, tax or bill rates.' : ''}</td>
                  </tr>`
              )}
              <tr><td><b>Member only</b></td><td className="small">Their own employee, consultant, student or client portal.</td></tr>
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel stack">
        <h2 className="ph">People, portals and extra features</h2>
        <p className="muted small">The main role sets what someone is first of all. Employee is a single portal and includes the recruiting and Bench desk workflow by default. Student is a separate login/portal. Portal boxes add other portals to the same login. Feature switches can allow or block individual tools. The server checks all of it on every request.</p>
        <div className="tblwrap">
          <table className="tbl access">
            <thead>
              <tr>
                <th>Person</th><th>Staff role</th><th>Primary member portal</th><th>Reports to</th>
                <th>Additional / effective portals</th>
                ${grants.map(g => html`<th key=${g[0]} className="c" title=${g[2]}>${g[1]}</th>`)}
              </tr>
            </thead>
            <tbody>
              ${people.map(m => {
                const a = acct(m.id);
                const ft = (m.r && m.r.ft) || {};
                const have = portalsOfRow(m, a);
                const extra = new Set(a.portals || []);
                const isClient = m.role === 'employer';
                return html`<tr key=${m.id}>
                    <td>
                      <div className="pcell">
                        <img src=${avatarFor(m.u.p.n, m.id).url} alt="" />
                        <div><b>${m.u.p.n}</b><span className="muted small">${a.email || m.u.p.e} · ${portalLabel(m.role)}</span></div>
                      </div>
                    </td>
                    <td>
                      ${
                        isClient
                          ? html`<span className="muted small">Client contact</span>`
                          : html`<select value=${a.role || 'user'} disabled=${!a.id || !owner} onChange=${e => setRole(m, e.target.value)} aria-label=${'Staff role for ' + m.u.p.n}>
                              ${ROLE_OPTS.map(([v, l]) => html`<option key=${v} value=${v}>${l}</option>`)}
                            </select>`
                      }
                    </td>
                    <td>
                      ${isClient
                        ? html`<span className="muted small">Client</span>`
                        : html`<select value=${MEMBER_ROLE_OPTS.some(x => x[0] === m.role) ? m.role : 'employee'} disabled=${!a.id || !owner} onChange=${e => setMemberRole(m, e.target.value)} aria-label=${'Primary member portal for ' + m.u.p.n}>
                            ${MEMBER_ROLE_OPTS.map(([v,l]) => html`<option key=${v} value=${v}>${l}</option>`)}
                          </select>`}
                    </td>
                    <td>
                      ${
                        isClient
                          ? html`<span className="muted small">—</span>`
                          : html`<select value=${(m.r && m.r.mgrId) || ''} onChange=${e => setMgr(m, e.target.value)} aria-label=${'Manager of ' + m.u.p.n}>
                              <option value="">No manager</option>
                              ${leads.filter(x => x.id !== m.id).map(x => html`<option key=${x.id} value=${x.id}>${x.u.p.n}</option>`)}
                            </select>`
                      }
                    </td>
                    <td>
                      <div className="portalpicks">
                        ${
                          isClient
                            ? clients.map(c => {
                                const on = (m.r && m.r.cid === c.id) || (a.cids || []).includes(c.id);
                                const fixed = m.r && m.r.cid === c.id;
                                return html`<label key=${c.id} className=${'pick' + (on ? ' on' : '')} title=${fixed ? 'Their main client (Clients page)' : 'Also a member of this client workspace'}>
                                    <input type="checkbox" checked=${on} disabled=${fixed || !a.id} onChange=${e => setClientLink(m, a, c.id, e.target.checked)} />
                                    <span>${c.n}</span>
                                  </label>`;
                              })
                            : ['admin', 'hr', 'acct', 'mgr', 'employee', 'consultant', 'student'].map(k => {
                                const fromRole = have.has(k) && !extra.has(k);
                                const canEdit = !!a.id && owner;
                                return html`<label key=${k} className=${'pick' + (have.has(k) ? ' on' : '')} title=${fromRole ? 'From their main role or record' : PORTAL_INFO[k].d}>
                                    <input type="checkbox" checked=${have.has(k)} disabled=${fromRole || !canEdit} onChange=${e => setPortal(m, a, k, e.target.checked)} />
                                    <span>${PORTAL_INFO[k].n.replace(' portal', '')}</span>
                                  </label>`;
                              })
                        }
                      </div>
                    </td>
                    ${grants.map(
                      ([g, n, , own]) => html`<td key=${g} className="c">
                          <input type="checkbox" checked=${!!ft[g] || (a.role === 'admin' && !own)} disabled=${(a.role === 'admin' && !own) || isClient} onChange=${e => setGrant(m, g, e.target.checked)} aria-label=${n + ' for ' + m.u.p.n} />
                        </td>`
                    )}
                  </tr>`;
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small" style=${{ margin: 0 }}><b>How to change a locked portal:</b> portals supplied by the person's Staff role or Primary member portal are shown as active and cannot be unticked directly. Change the Staff role or Primary member portal in the columns above. Extra portals can be switched on or off independently.</p>
        ${!leads.length && html`<p className="muted small">To pick a manager, first give that person the Manager (or HR, Accounting, Administrator) role above.</p>`}
      </section>
      <${FeatureAccessSection} A=${A} acct=${acct} people=${people} uid=${featureUid} onUid=${setFeatureUid} owner=${owner} />
      <${BooksAccessSection} A=${A} acct=${acct} owner=${owner} onAdd=${() => setAdding(true)} />
    </div>`;
}
/* Who keeps the books: outside bookkeepers (accounting-only logins) and staff with the accounting portal, each with
   a books level and a payroll switch. The server applies both on every request (api/lib.php acctLimits). */
function FeatureAccessSection({ A, acct, people, uid, onUid, owner }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const eligible = people.filter(m => m.role !== 'employer');
  const pick = eligible.find(m => m.id === uid) || eligible[0] || null;
  useEffect(() => { if (!uid && eligible[0]) onUid(eligible[0].id); }, [uid, eligible.length]);
  if (!owner) return null;
  const a = pick ? acct(pick.id) : {};
  const fa = (a && a.fa) || {};
  const save = async (key, mode) => {
    if (!pick) return;
    setBusy(key);
    try {
      await api('admin_feature_access', { uid: pick.id, key, mode });
      await A.loadAccounts();
      if (pick.id === Cap.uid) await reloadCaps();
      toast(`${FEATURE_ACCESS_UI.find(x => x[0] === key)[1]}: ${mode === 'default' ? 'role default restored' : mode === 'allow' ? 'allowed' : 'blocked'} for ${firstName(pick.u.p.n)}.`);
    } catch (e) { toast(errText(e), true); }
    setBusy('');
  };
  const groups = [...new Set(FEATURE_ACCESS_UI.map(x => x[2]))];
  return html`<section className="panel stack feature-access">
    <div className="ph-row"><div><h2 className="ph" style=${{marginBottom:4}}>Role & feature access</h2><p className="muted small" style=${{margin:0}}>Choose exactly what a person can use. <b>Role default</b> follows their portals and main role. <b>Allow</b> adds a feature. <b>Block</b> removes it even when the role normally has it.</p></div></div>
    <div className="note info"><span><b>Protected controls stay Administrator-only:</b> Roles & access itself, Security center/core security settings, system health, workspace ownership, website/mail delivery credentials and phone setup cannot be delegated here.</span></div>
    <${Field} label="Person"><select value=${pick ? pick.id : ''} onChange=${e => onUid(e.target.value)}>${eligible.map(m => html`<option key=${m.id} value=${m.id}>${m.u.p.n} · ${ROLE_OPTS.find(x => x[0] === (acct(m.id).role || 'user'))?.[1] || 'Member'}</option>`)}</select><//>
    ${pick && a.role === 'admin'
      ? html`<div className="note ok"><span><b>${pick.u.p.n} is an Administrator.</b> Administrators have full feature access and cannot be blocked here. Use the <b>Staff role</b> control in the access table above if this account should become Manager, HR, Accounting or Member only.</span></div>`
      : pick ? groups.map(group => html`<div key=${group} className="fa-group">
      <h3>${group}</h3>
      <div className="fa-list">${FEATURE_ACCESS_UI.filter(x => x[2] === group).map(([key,n,,d]) => {
        const mode = fa[key] || 'default';
        return html`<div key=${key} className="fa-row">
          <div className="fa-copy"><b>${n}</b><span className="muted small">${d}</span></div>
          <span className=${'chip ' + (mode === 'allow' ? 'ok' : mode === 'block' ? 'red' : '')}>${mode === 'allow' ? 'Allowed' : mode === 'block' ? 'Blocked' : 'From role'}</span>
          <select aria-label=${n + ' access for ' + pick.u.p.n} value=${mode} disabled=${busy === key} onChange=${e => save(key, e.target.value)}>
            <option value="default">Role default</option><option value="allow">Allow</option><option value="block">Block</option>
          </select>
        </div>`;
      })}</div>
    </div>`) : html`<p className="muted">No accounts are available.</p>`}
  </section>`;
}

const BOOKS_LEVEL_OPTS = [
  ['full', 'Full'],
  ['view', 'View only'],
  ['reports', 'Reports only'],
];
function BooksAccessSection({ A, acct, owner, onAdd }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const staffAcct = A.members.filter(m => m.role !== 'employer' && m.st !== 'inactive' && (acct(m.id).role === 'acct' || (acct(m.id).portals || []).includes('acct')) && acct(m.id).role !== 'admin');
  const rows = [...(A.externals || []).map(m => ({ m, ext: true })), ...staffAcct.map(m => ({ m, ext: false }))];
  const save = async (m, patch, msg) => {
    setBusy(m.id);
    try {
      await api('admin_books_access', { uid: m.id, ...patch });
      toast(msg);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  return html`<section className="panel stack">
      <div className="ph-row">
        <h2 className="ph">Bookkeepers and accountants</h2>
        ${owner && html`<button type="button" className="btn ghost sm" onClick=${onAdd}><${Icon} n="plus" />Add a bookkeeper login</button>`}
      </div>
      <p className="muted small">An outside bookkeeper signs in through the accounting login only (no employee portal, no team pages). <b>Full</b> keeps the books; <b>View only</b> reads every record and report; <b>Reports only</b> opens the Books reports and exports. Payroll (pay runs, paystubs, tax filings) can be kept out of reach. Everything they change is in Books › Audit log, and closed periods stay locked for everyone.</p>
      ${
        rows.length
          ? html`<div className="tblwrap"><table className="tbl">
              <thead><tr><th>Person</th><th>Books</th><th>Payroll</th><th>Status</th></tr></thead>
              <tbody>${rows.map(({ m, ext }) => {
                const r = m.r || {};
                const a = acct(m.id);
                return html`<tr key=${m.id} className=${r.st === 'inactive' ? 'muted' : ''}>
                    <td><div className="pcell"><img src=${avatarFor(m.u.p.n, m.id).url} alt="" /><div><b>${m.u.p.n}</b><span className="muted small">${a.email || m.u.p.e}${m.u.p.co ? ' · ' + m.u.p.co : ''} · ${ext ? 'Outside bookkeeper' : 'Staff'}</span></div></div></td>
                    <td><select value=${r.books || 'full'} disabled=${!owner || busy === m.id} onChange=${e => save(m, { books: e.target.value }, `${firstName(m.u.p.n)}: ${BOOKS_LEVEL_OPTS.find(x => x[0] === e.target.value)[1].toLowerCase()} books access.`)}>${BOOKS_LEVEL_OPTS.map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select></td>
                    <td><label className="check"><input type="checkbox" checked=${!r.nopay} disabled=${!owner || busy === m.id} onChange=${e => save(m, { nopay: !e.target.checked }, e.target.checked ? 'Payroll pages switched on.' : 'Payroll kept out of reach.')} /><span>Can see payroll</span></label></td>
                    <td>${ext ? html`<button type="button" className="btn ghost sm" disabled=${!owner || busy === m.id} onClick=${() => save(m, { st: r.st === 'inactive' ? 'active' : 'inactive' }, r.st === 'inactive' ? 'Login reactivated.' : 'Login paused; they can no longer sign in.')}>${r.st === 'inactive' ? 'Reactivate' : 'Pause login'}</button>` : html`<span className="muted small">${r.st === 'inactive' ? 'inactive' : 'active'}</span>`}</td>
                  </tr>`;
              })}</tbody>
            </table></div>`
          : html`<p className="muted small">No one holds the accounting portal yet besides administrators. Add a bookkeeper login, or tick the Accounting portal for a staff member above.</p>`
      }
    </section>`;
}
