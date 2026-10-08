<?php
declare(strict_types=1);
/*
 * v38.1 Import with preview (blueprint I01, "import dry run").
 * A spreadsheet (CSV, TSV, a text export or an Excel .xlsx) or rows pasted from Excel or Google Sheets go through:
 *   1. upload: read on the server (every sheet of a workbook, up to 10,000 rows each) and kept for 7 days;
 *   2. columns: each column is matched to a field from its heading, from what this team matched before and from the
 *      values themselves (a column of email addresses is the email); the person corrects any match;
 *   3. check (the dry run): every row is read as it would be saved: invalid values, values cleaned up (dates, phone
 *      numbers, work authorization, remote / onsite...), the records it would create, the records already here that it
 *      would update (field by field, before and after), rows that repeat inside the file and likely duplicates. The
 *      person decides row by row where the guess is wrong, or fixes a value;
 *   4. import: written in steps of 200 rows (each step in one transaction), then a result summary, the rows that were not
 *      imported as a CSV to fix and import again, and Undo.
 * Nothing is saved before step 4. Undo deletes what the import created (unless someone changed it since) and puts back
 * the values it replaced (unless someone changed them since). Imports and undos are in the audit log. The same
 * permissions apply as for adding the records by hand, and a company workspace imports only into the parts it has.
 */

const IMP_MAX_ROWS = 10000;
const IMP_MAX_COLS = 100;
const IMP_MAX_SHEETS = 12;
const IMP_CELL = 20000;      // the longest cell kept (a job description)
const IMP_CHUNK = 500;       // file rows per stored chunk
const IMP_STEP = 200;        // rows written per import step
const IMP_KEEP_DRAFT = 7;    // days a file that was never imported is kept
const IMP_KEEP_DONE = 30;    // days the file rows and the undo information are kept after an import
const IMP_FREE_MAIL = ['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.co.uk', 'ymail.com', 'rocketmail.com', 'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com', 'protonmail.com', 'proton.me', 'gmx.com', 'gmx.net', 'yandex.com', 'mail.com', 'zoho.com', 'zohomail.com', 'rediffmail.com', 'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'qq.com', '163.com'];
const IMP_MAIL_TYPOS = ['gmial.com' => 'gmail.com', 'gmai.com' => 'gmail.com', 'gamil.com' => 'gmail.com', 'gnail.com' => 'gmail.com', 'gmail.co' => 'gmail.com', 'gmail.con' => 'gmail.com', 'gmaill.com' => 'gmail.com', 'gmail.cm' => 'gmail.com', 'yaho.com' => 'yahoo.com', 'yahooo.com' => 'yahoo.com', 'yahoo.con' => 'yahoo.com', 'hotmial.com' => 'hotmail.com', 'hotmal.com' => 'hotmail.com', 'hotmail.con' => 'hotmail.com', 'outlok.com' => 'outlook.com', 'outlook.con' => 'outlook.com', 'iclod.com' => 'icloud.com', 'icloud.con' => 'icloud.com'];
// work authorization as people write it, for the two lists the portal uses (ATS and the consultant database)
const IMP_AUTH_SYN = [
    'US citizen' => ['uscitizen', 'usc', 'citizen', 'americancitizen', 'usacitizen', 'citizenship', 'us'],
    'Green card' => ['greencard', 'gc', 'permanentresident', 'lpr', 'pr', 'i551', 'gcholder', 'greencardholder'],
    'H-1B' => ['h1b', 'h1', 'h1bvisa', 'h1btransfer', 'h1bholder'],
    'H4 EAD' => ['h4ead', 'h4'],
    'OPT' => ['opt', 'f1opt', 'stemopt', 'optead', 'f1'],
    'CPT' => ['cpt', 'f1cpt'],
    'OPT / CPT' => ['optcpt', 'opt', 'cpt', 'stemopt', 'optead', 'f1', 'f1opt', 'f1cpt'],
    'L2 EAD' => ['l2ead', 'l2'],
    'TN' => ['tn', 'tnvisa', 'tn1'],
    'EAD' => ['ead', 'gcead', 'aosead', 'i485ead', 'c9ead'],
    'GC EAD' => ['gcead', 'ead', 'aosead', 'i485ead', 'c9ead'],
    'Other' => ['other', 'e3', 'o1', 'j1', 'h1b1'],
];

function impDb(): PDO
{
    static $ready = false;
    $p = db();
    if (!$ready) {
        $ready = true;
        $p->exec('CREATE TABLE IF NOT EXISTS imp_runs (id VARCHAR(24) PRIMARY KEY, at BIGINT NOT NULL, uid VARCHAR(40) NOT NULL, tgt VARCHAR(16) NOT NULL, st VARCHAR(12) NOT NULL, lk BIGINT NOT NULL DEFAULT 0, data LONGTEXT NOT NULL)');
        $p->exec('CREATE TABLE IF NOT EXISTS imp_rows (run VARCHAR(24) NOT NULL, kind VARCHAR(8) NOT NULL, k INT NOT NULL, data LONGTEXT NOT NULL, PRIMARY KEY (run, kind, k))');
        $p->exec('CREATE TABLE IF NOT EXISTS imp_log (run VARCHAR(24) NOT NULL, i INT NOT NULL, n INT NOT NULL, act VARCHAR(2) NOT NULL, ref VARCHAR(500) NOT NULL, seq BIGINT NOT NULL, prev LONGTEXT NOT NULL, PRIMARY KEY (run, i, n))');
        try {
            $p->exec('CREATE INDEX IF NOT EXISTS imp_log_ref ON imp_log (run, ref)');
        } catch (Throwable $e) {
            // a database without IF NOT EXISTS for indexes: the index only speeds up undo
        }
    }
    return $p;
}

/* ---------------------------------------------------------------- what can be imported */

/**
 * The record types. Field: l label, t type, max length, req, multi (several columns are joined), app (added to what is
 * already there instead of replacing it), o options (value => label), syn synonyms, lst (options from the module's own
 * settings), free (a value outside the list is kept as typed), def default, a heading names, h help.
 */
function impTargets(): array
{
    static $T = null;
    if ($T !== null) {
        return $T;
    }
    $F = fn(string $l, string $t, int $max = 0, array $x = []): array => ['l' => $l, 't' => $t, 'max' => $max] + $x;
    $nameA = 'name fullname candidatename consultantname applicantname candidate consultant applicant employeename resourcename personname talentname';
    $emailA = 'email emailaddress emailid mail workemail primaryemail personalemail candidateemail emails emailaddresses';
    $phoneA = 'phone phonenumber mobile mobilenumber cell cellphone contactnumber telephone tel mobilephone workphone primaryphone phoneno contactno whatsapp mobileno cellnumber';
    $skillsA = 'skills skill skillset keyskills primaryskills technologies technology techstack expertise secondaryskills skillsandexpertise tools mandatoryskills requiredskills';
    $locA = 'location city currentlocation address citystate basedin residence currentcity worklocation town';
    $authA = 'workauthorization visa visastatus workstatus authorization immigrationstatus workauth workpermit legalstatus visatype citizenship';
    $authAts = ['US citizen' => 'US citizen', 'Green card' => 'Green card', 'H-1B' => 'H-1B', 'H4 EAD' => 'H4 EAD', 'OPT' => 'OPT', 'CPT' => 'CPT', 'L2 EAD' => 'L2 EAD', 'TN' => 'TN', 'EAD' => 'EAD', 'Other' => 'Other'];
    $authCons = ['US citizen' => 'US citizen', 'Green card' => 'Green card', 'H-1B' => 'H-1B', 'H4 EAD' => 'H4 EAD', 'OPT / CPT' => 'OPT / CPT', 'L2 EAD' => 'L2 EAD', 'TN' => 'TN', 'GC EAD' => 'GC EAD', 'Other' => 'Other'];
    $first = $F('First name', 'first', 60, ['a' => 'firstname first givenname fname forename']);
    $last = $F('Last name', 'last', 60, ['a' => 'lastname last surname familyname lname']);
    $tags = $F('Tags', 'list', 600, ['multi' => true, 'a' => 'tags tag labels label categories hotlist hotlists', 'h' => 'Separated by commas']);
    $T = [
        'ats' => [
            'n' => 'Candidates (ATS)', 'one' => 'candidate', 'many' => 'candidates', 'feat' => 'recruiting', 'col' => 'ats', 'ico' => 'users', 'page' => 'ats',
            'hint' => 'One person per row. People already in the ATS for the job are found by email, phone or LinkedIn.',
            'f' => [
                'n' => $F('Name', 'name', 120, ['a' => $nameA]),
                'first' => $first,
                'last' => $last,
                'e' => $F('Email', 'email', 190, ['a' => $emailA]),
                'ph' => $F('Phone', 'phone', 40, ['a' => $phoneA]),
                'ti' => $F('Current title', 'text', 120, ['a' => 'title jobtitle currenttitle designation role currentrole headline currentposition currentdesignation']),
                'sk' => $F('Skills', 'text', 600, ['multi' => true, 'a' => $skillsA]),
                'loc' => $F('Location', 'text', 120, ['a' => $locA]),
                'auth' => $F('Work authorization', 'choice', 40, ['o' => $authAts, 'syn' => IMP_AUTH_SYN, 'a' => $authA]),
                'exp' => $F('Years of experience', 'num', 0, ['min' => 0, 'max2' => 70, 'a' => 'experience yearsofexperience totalexperience years yoe exp experienceyears totalexp yrsofexp relevantexperience experienceinyears']),
                'li' => $F('LinkedIn', 'li', 300, ['a' => 'linkedin linkedinurl linkedinprofile profileurl linkedinlink li']),
                'src' => $F('Source', 'choice', 60, ['lst' => 'src', 'free' => true, 'a' => 'source candidatesource sourcedfrom channel origin']),
                'tags' => $tags,
                'msg' => $F('Notes', 'long', 2000, ['multi' => true, 'app' => true, 'a' => 'notes note comments comment remarks summary recruiternotes']),
                'job' => $F('Job', 'job', 160, ['a' => 'job jobcode jobid requisition requisitionid appliedfor jobappliedfor opening jobopening req', 'h' => 'The job code (J-1001) or the job title']),
            ],
            'keys' => ['e' => 'email', 'ph' => 'phone', 'li' => 'li'],
            'likely' => 'person', 'need' => 'n', 'show' => ['n', 'ti', 'e', 'ph', 'loc'], 'opts' => ['job', 'tags', 'src'],
        ],
        'cons' => [
            'n' => 'Consultants (bench database)', 'one' => 'consultant', 'many' => 'consultants', 'feat' => 'recruiting', 'col' => 'rec/cand/items', 'ico' => 'idcard', 'page' => 'rec-consultants', 'mpage' => 'rec/consultants',
            'hint' => 'One consultant per row. Consultants already in the database are found by email, phone or LinkedIn.',
            'f' => [
                'n' => $F('Full name', 'name', 120, ['a' => $nameA]),
                'first' => $first,
                'last' => $last,
                'ti' => $F('Title / role', 'text', 160, ['a' => 'title jobtitle role designation currenttitle position profile headline']),
                'e' => $F('Email', 'email', 190, ['a' => $emailA]),
                'ph' => $F('Phone', 'phone', 60, ['a' => $phoneA]),
                'li' => $F('LinkedIn', 'li', 300, ['a' => 'linkedin linkedinurl linkedinprofile profileurl li']),
                'sk' => $F('Key skills', 'text', 1000, ['multi' => true, 'a' => $skillsA]),
                'auth' => $F('Work authorization', 'choice', 40, ['o' => $authCons, 'syn' => IMP_AUTH_SYN, 'a' => $authA]),
                'exp' => $F('Experience (years)', 'num', 0, ['min' => 0, 'max2' => 70, 'a' => 'experience yearsofexperience totalexperience years yoe exp totalexp yrsofexp']),
                'rate' => $F('Expected rate', 'text', 60, ['a' => 'rate expectedrate billrate hourlyrate payrate salary expectedsalary ratehr currentrate ctc']),
                'loc' => $F('Current location', 'text', 160, ['a' => $locA]),
                'reloc' => $F('Relocation', 'choice', 40, ['o' => ['Open' => 'Open', 'Remote only' => 'Remote only', 'Local only' => 'Local only', 'Specific states' => 'Specific states'], 'syn' => ['Open' => ['open', 'yes', 'y', 'willing', 'anywhere', 'opentorelocate', 'opentorelocation', 'true', 'ok'], 'Remote only' => ['remote', 'remoteonly', 'onlyremote'], 'Local only' => ['local', 'localonly', 'no', 'n', 'notwilling', 'false', 'none'], 'Specific states' => ['specificstates', 'specific', 'states', 'selectstates']], 'a' => 'relocation relocate willingtorelocate opentorelocation relocatable']),
                'avail' => $F('Available from', 'text', 120, ['a' => 'availability available availablefrom noticeperiod canstart availabledate']),
                'emp' => $F('Current employer / vendor', 'text', 160, ['a' => 'employer currentemployer currentcompany employername worksthrough employercompany vendor company']),
                'src' => $F('Source', 'text', 60, ['a' => 'source sourcedfrom channel origin']),
                'notes' => $F('Notes', 'long', 4000, ['multi' => true, 'app' => true, 'a' => 'notes note comments comment remarks summary']),
                'tags' => $tags,
                'st' => $F('Status', 'choice', 20, ['o' => ['active' => 'Available', 'working' => 'In process', 'placed' => 'Placed', 'hold' => 'On hold', 'inactive' => 'Inactive'], 'syn' => ['active' => ['available', 'bench', 'onbench', 'active', 'open', 'free'], 'working' => ['inprocess', 'working', 'interviewing', 'submitted', 'process'], 'placed' => ['placed', 'onproject', 'project', 'deployed', 'billing'], 'hold' => ['hold', 'onhold', 'paused'], 'inactive' => ['inactive', 'notavailable', 'unavailable', 'left', 'closed']], 'def' => 'active', 'a' => 'status benchstatus availabilitystatus candidatestatus consultantstatus']),
            ],
            'keys' => ['e' => 'email', 'ph' => 'phone', 'li' => 'li'],
            'likely' => 'person', 'need' => 'n', 'show' => ['n', 'ti', 'e', 'ph', 'loc'], 'opts' => ['tags'],
        ],
        'vendor' => [
            'n' => 'Vendors', 'one' => 'vendor', 'many' => 'vendors', 'feat' => 'recruiting', 'col' => 'vms/vendor/items', 'ico' => 'building', 'page' => 'vms', 'mpage' => 'tools/vms',
            'hint' => 'One vendor per row, or one contact per row: rows with the same vendor name become one vendor with all their contacts.',
            'f' => [
                'n' => $F('Vendor name', 'text', 160, ['a' => 'vendor vendorname company companyname name supplier suppliername organization organisation agency firm partner']),
                'type' => $F('Kind', 'choice', 40, ['o' => ['Prime vendor' => 'Prime vendor', 'Direct client' => 'Direct client', 'Implementation partner' => 'Implementation partner', 'Staffing agency' => 'Staffing agency', 'MSP / VMS' => 'MSP / VMS'], 'syn' => ['Prime vendor' => ['prime', 'primevendor', 'tier1', 'tier1vendor'], 'Direct client' => ['direct', 'directclient', 'client', 'endclient'], 'Implementation partner' => ['implementationpartner', 'ip', 'si', 'systemintegrator', 'integrator', 'partner'], 'Staffing agency' => ['staffing', 'staffingagency', 'agency', 'subvendor', 'tier2', 'tier2vendor', 'vendor', 'layer'], 'MSP / VMS' => ['msp', 'vms', 'mspvms']], 'def' => 'Prime vendor', 'a' => 'kind type vendortype category tier relationship']),
                'site' => $F('Website or email domain', 'domain', 120, ['a' => 'website web domain emaildomain site url companywebsite']),
                'loc' => $F('Location', 'text', 160, ['a' => 'location city address hq headquarters state']),
                'terms' => $F('Payment terms', 'choice', 20, ['o' => ['Net 15' => 'Net 15', 'Net 30' => 'Net 30', 'Net 45' => 'Net 45', 'Net 60' => 'Net 60', 'Net 90' => 'Net 90', 'Other' => 'Other'], 'syn' => ['Net 15' => ['net15', '15', '15days'], 'Net 30' => ['net30', '30', '30days', 'monthly'], 'Net 45' => ['net45', '45', '45days'], 'Net 60' => ['net60', '60', '60days'], 'Net 90' => ['net90', '90', '90days']], 'def' => 'Net 30', 'a' => 'terms paymentterms netterms payterms net']),
                'pays' => $F('Payment record', 'choice', 20, ['o' => ['ontime' => 'Pays on time', 'late' => 'Pays late', 'risk' => 'Payment problems'], 'syn' => ['ontime' => ['ontime', 'good', 'paysontime', 'yes', 'reliable'], 'late' => ['late', 'payslate', 'slow', 'delayed'], 'risk' => ['risk', 'problems', 'paymentproblems', 'bad', 'nonpayment', 'blacklist']], 'a' => 'payment paymenthistory pays paymentrating paymentrecord']),
                'rates' => $F('Rate notes', 'text', 300, ['a' => 'rates ratenotes margin markup ratecard']),
                'notes' => $F('Notes', 'long', 4000, ['multi' => true, 'app' => true, 'a' => 'notes comments remarks']),
                'cn' => $F('Contact name', 'name', 120, ['a' => 'contactname contact pointofcontact poc recruiter recruitername accountmanager contactperson']),
                'ce' => $F('Contact email', 'email', 190, ['a' => 'contactemail email emailaddress pocemail recruiteremail']),
                'cp' => $F('Contact phone', 'phone', 60, ['a' => 'contactphone phone phonenumber mobile pocphone recruiterphone']),
                'ct' => $F('Contact title', 'text', 120, ['a' => 'contacttitle designation title role']),
            ],
            'keys' => ['n' => 'co', 'site' => 'domain'],
            'likely' => 'company', 'need' => 'n', 'show' => ['n', 'type', 'cn', 'ce'], 'opts' => [],
        ],
        'client' => [
            'n' => 'Clients', 'one' => 'client', 'many' => 'clients', 'feat' => '', 'col' => 'org/admin/clients', 'ico' => 'building', 'page' => 'clients',
            'hint' => 'One client per row. Clients already here are found by name.',
            'f' => [
                'n' => $F('Client name', 'text', 160, ['a' => 'client clientname company companyname name customer account accountname']),
                'ec' => $F('End client', 'text', 160, ['a' => 'endclient endclientname finalclient ultimateclient endcustomer']),
                'loc' => $F('Location', 'text', 160, ['a' => 'location city address state']),
                'site' => $F('Website', 'domain', 120, ['a' => 'website web domain site url']),
                'notes' => $F('Notes', 'long', 4000, ['multi' => true, 'app' => true, 'a' => 'notes comments remarks']),
            ],
            'keys' => ['n' => 'co'],
            'likely' => 'company', 'need' => 'n', 'show' => ['n', 'ec', 'loc'], 'opts' => [],
        ],
        'req' => [
            'n' => 'Requirements', 'one' => 'requirement', 'many' => 'requirements', 'feat' => 'recruiting', 'col' => 'vms/req/items', 'ico' => 'layers', 'page' => 'vreqs', 'mpage' => 'tools/vreqs',
            'hint' => 'One open position per row. A requirement already on the desk is found by its requisition ID.',
            'f' => [
                'ti' => $F('Job title', 'text', 160, ['a' => 'title jobtitle positiontitle role position requirement requirementtitle jobname opening positionname']),
                'vref' => $F('Requisition / job ID', 'text', 40, ['a' => 'requisitionid reqid requisition jobid reqno jobcode requisitionnumber reqnumber vmsid postingid jobnumber refno reference id']),
                'cl' => $F('Client', 'text', 160, ['a' => 'client clientname customer account company']),
                'ec' => $F('End client', 'text', 160, ['a' => 'endclient finalclient ultimateclient endcustomer']),
                'vn' => $F('Vendor', 'text', 160, ['a' => 'vendor vendorname prime primevendor supplier implementationpartner partner']),
                'loc' => $F('Location', 'text', 160, ['a' => 'location joblocation worklocation city worksite citystate']),
                'md' => $F('Remote / onsite', 'choice', 12, ['o' => ['Onsite' => 'Onsite', 'Hybrid' => 'Hybrid', 'Remote' => 'Remote'], 'syn' => ['Onsite' => ['onsite', 'onsight', 'office', 'inoffice', 'local', 'onlocation', 'fullyonsite', 'no'], 'Hybrid' => ['hybrid', 'partialremote', 'partiallyremote', 'flexible', 'mixed'], 'Remote' => ['remote', 'wfh', 'workfromhome', 'fullyremote', '100remote', 'telecommute', 'yes', 'anywhere']], 'def' => 'Onsite', 'a' => 'remoteonsite remote worktype workmode worksetup onsiteremote mode workplace locationtype remotehybrid workarrangement']),
                'ty' => $F('Engagement', 'choice', 24, ['o' => ['C2C' => 'C2C', 'W2' => 'W2', '1099' => '1099', 'Contract-to-hire' => 'Contract-to-hire', 'Full-time' => 'Full-time', 'SOW' => 'SOW'], 'syn' => ['C2C' => ['c2c', 'corptocorp', 'corp2corp', 'ctoc', 'contract'], 'W2' => ['w2', 'w2contract', 'w2only'], '1099' => ['1099', '1099contract'], 'Contract-to-hire' => ['contracttohire', 'cth', 'c2h', 'contract2hire', 'temptoperm', 'contracttoperm'], 'Full-time' => ['fulltime', 'fte', 'permanent', 'perm', 'directhire', 'ft', 'fulltimeemployee'], 'SOW' => ['sow', 'project', 'statementofwork', 'fixedbid']], 'def' => 'C2C', 'a' => 'engagement type employmenttype jobtype contracttype taxterms positiontype engagementtype']),
                'rate' => $F('Rate', 'text', 60, ['a' => 'rate billrate payrate maxrate budget hourlyrate ratehr salary compensation']),
                'dur' => $F('Duration', 'text', 60, ['a' => 'duration contractlength length term contractduration tenure']),
                'n' => $F('Openings', 'int', 0, ['min' => 1, 'max2' => 99, 'a' => 'openings positions numberofpositions headcount qty quantity vacancies noofpositions count']),
                'sd' => $F('Start date', 'date', 10, ['a' => 'startdate start datestart projectstart joiningdate']),
                'sk' => $F('Skills', 'text', 1000, ['multi' => true, 'a' => $skillsA]),
                'visa' => $F('Work authorization accepted', 'text', 120, ['a' => 'visa workauthorization visarequirements visaaccepted acceptedvisas eligibility visastatus authorization']),
                'd' => $F('Job description', 'long', 20000, ['multi' => true, 'a' => 'description jobdescription jd details summary responsibilities body text']),
                'cn' => $F('Contact name', 'name', 120, ['a' => 'contactname contact recruiter manager hiringmanager poc pointofcontact postedby']),
                'ce' => $F('Contact email', 'email', 190, ['a' => 'contactemail email recruiteremail pocemail emailaddress']),
                'cp' => $F('Contact phone', 'phone', 60, ['a' => 'contactphone phone recruiterphone pocphone']),
                'st' => $F('Status', 'choice', 12, ['o' => ['new' => 'New', 'open' => 'Open', 'working' => 'Working', 'submitted' => 'Submitted', 'interview' => 'Interview', 'filled' => 'Filled', 'closed' => 'Closed', 'dismissed' => 'Dismissed'], 'syn' => ['open' => ['open', 'active', 'live', 'hiring', 'approved'], 'closed' => ['closed', 'cancelled', 'canceled', 'onhold', 'hold', 'inactive'], 'filled' => ['filled', 'placed', 'won'], 'working' => ['working', 'inprogress', 'sourcing']], 'def' => 'open', 'a' => 'status state reqstatus jobstatus requirementstatus']),
            ],
            'keys' => ['vref' => 'ref'],
            'likely' => 'req', 'need' => 'ti', 'show' => ['ti', 'vref', 'cl', 'loc'], 'opts' => [],
        ],
        'crmco' => [
            'n' => 'CRM companies', 'one' => 'company', 'many' => 'companies', 'feat' => 'crm', 'col' => 'crm/main/acc', 'ico' => 'target', 'page' => 'crm', 'mpage' => 'tools/crm',
            'hint' => 'One company per row. Companies already in the CRM are found by name or website.',
            'f' => [
                'n' => $F('Company', 'text', 160, ['a' => 'company companyname account accountname organization organisation name client firm']),
                'ty' => $F('Company type', 'choice', 60, ['lst' => 'types', 'free' => true, 'a' => 'companytype accounttype type category kind']),
                'st' => $F('Company status', 'choice', 40, ['lst' => 'statuses', 'free' => true, 'a' => 'companystatus accountstatus status']),
                'ind' => $F('Industry', 'choice', 60, ['lst' => 'inds', 'free' => true, 'a' => 'industry sector vertical']),
                'web' => $F('Website', 'url', 200, ['a' => 'website web companywebsite url domain site']),
                'loc' => $F('Location', 'text', 160, ['a' => 'location city hq address state country headquarters']),
                'own' => $F('Owner', 'person', 120, ['a' => 'owner accountowner assignedto salesrep rep']),
                'src' => $F('Source', 'choice', 60, ['lst' => 'srcs', 'free' => true, 'a' => 'source leadsource origin channel']),
                'notes' => $F('Notes', 'long', 4000, ['multi' => true, 'app' => true, 'a' => 'notes comments remarks description']),
            ],
            'keys' => ['n' => 'co', 'web' => 'domain'],
            'likely' => 'company', 'need' => 'n', 'show' => ['n', 'ty', 'web', 'loc'], 'opts' => [],
        ],
        'crm' => [
            'n' => 'CRM contacts', 'one' => 'contact', 'many' => 'contacts', 'feat' => 'crm', 'col' => 'crm/main/con', 'ico' => 'user', 'page' => 'crm', 'mpage' => 'tools/crm',
            'hint' => 'One person per row with their company (added when it is new). Contacts already here are found by email.',
            'f' => [
                'n' => $F('Contact name', 'name', 120, ['a' => 'contactname name fullname contact person']),
                'first' => $first,
                'last' => $last,
                'ti' => $F('Title', 'text', 120, ['a' => 'title jobtitle designation role position']),
                'e' => $F('Email', 'email', 190, ['a' => 'email emailaddress workemail emailid']),
                'ph' => $F('Phone', 'phone', 60, ['a' => 'phone mobile phonenumber directphone workphone cell telephone']),
                'rel' => $F('Relationship', 'choice', 60, ['lst' => 'rels', 'free' => true, 'a' => 'relationship relation contactrole contacttype persona']),
                'co' => $F('Company', 'text', 160, ['a' => 'company companyname account accountname organization organisation employer firm client']),
                'cweb' => $F('Company website', 'url', 200, ['a' => 'website companywebsite web url domain']),
                'cty' => $F('Company type', 'choice', 60, ['lst' => 'types', 'free' => true, 'a' => 'companytype accounttype']),
                'cloc' => $F('Company location', 'text', 160, ['a' => 'companylocation location city hq address state']),
                'src' => $F('Source', 'choice', 60, ['lst' => 'srcs', 'free' => true, 'a' => 'source leadsource origin channel']),
                'notes' => $F('Notes', 'long', 4000, ['multi' => true, 'app' => true, 'a' => 'notes comments remarks']),
            ],
            'keys' => ['e' => 'email'],
            'likely' => 'person', 'need' => 'n|e', 'show' => ['n', 'ti', 'co', 'e'], 'opts' => [],
        ],
        'lead' => [
            'n' => 'CRM leads', 'one' => 'lead', 'many' => 'leads', 'feat' => 'crm', 'col' => 'crm/main/lead', 'ico' => 'target', 'page' => 'crm', 'mpage' => 'tools/crm',
            'hint' => 'One lead per row. Leads already here are found by email.',
            'f' => [
                'n' => $F('Contact name', 'name', 120, ['a' => 'contactname name fullname leadname contact person']),
                'first' => $first,
                'last' => $last,
                'co' => $F('Company', 'text', 160, ['a' => 'company companyname account organization organisation firm']),
                'ti' => $F('Title', 'text', 120, ['a' => 'title jobtitle designation role position']),
                'e' => $F('Email', 'email', 190, ['a' => 'email emailaddress workemail emailid']),
                'ph' => $F('Phone', 'phone', 60, ['a' => 'phone mobile phonenumber directphone workphone cell telephone']),
                'src' => $F('Source', 'choice', 60, ['lst' => 'srcs', 'free' => true, 'a' => 'source leadsource origin channel']),
                'st' => $F('Status', 'choice', 20, ['o' => ['New' => 'New', 'Working' => 'Working', 'Nurture' => 'Nurture', 'Qualified' => 'Qualified', 'Unqualified' => 'Unqualified', 'Converted' => 'Converted'], 'syn' => ['New' => ['new', 'open', 'fresh'], 'Working' => ['working', 'contacted', 'inprogress', 'attempted'], 'Nurture' => ['nurture', 'nurturing', 'cold', 'later'], 'Qualified' => ['qualified', 'hot', 'sql', 'mql'], 'Unqualified' => ['unqualified', 'disqualified', 'junk', 'dead', 'lost']], 'def' => 'New', 'a' => 'status leadstatus stage']),
                'own' => $F('Owner', 'person', 120, ['a' => 'owner leadowner assignedto salesrep accountowner rep']),
                'need' => $F('What they need', 'text', 300, ['a' => 'need needs requirement requirements interest whattheyneed opportunity']),
                'v' => $F('Estimated value', 'num', 0, ['min' => 0, 'max2' => 1000000000, 'a' => 'value estimatedvalue dealvalue amount budget revenue dealsize']),
                'ind' => $F('Industry', 'choice', 60, ['lst' => 'inds', 'free' => true, 'a' => 'industry sector vertical']),
                'loc' => $F('Location', 'text', 160, ['a' => 'location city state country address']),
                'notes' => $F('Notes', 'long', 4000, ['multi' => true, 'app' => true, 'a' => 'notes comments remarks description']),
            ],
            'keys' => ['e' => 'email'],
            'likely' => 'person', 'need' => 'n', 'show' => ['n', 'co', 'ti', 'e'], 'opts' => [],
        ],
        'mail' => [
            'n' => 'Email contacts', 'one' => 'contact', 'many' => 'contacts', 'feat' => 'mail', 'col' => '', 'ico' => 'mail', 'page' => 'mail', 'mpage' => 'rec/mail',
            'hint' => 'One email address per row, for campaigns and lists. Addresses already in the contacts are updated, never added twice.',
            'f' => [
                'email' => $F('Email', 'email', 190, ['a' => $emailA . ' contactemail']),
                'name' => $F('Name', 'name', 190, ['a' => 'name fullname contactname contact person']),
                'first' => $first,
                'last' => $last,
                'company' => $F('Company', 'text', 190, ['a' => 'company companyname organization organisation employer vendor client account']),
                'title' => $F('Title', 'text', 190, ['a' => 'title jobtitle position designation role']),
                'phone' => $F('Phone', 'phone', 60, ['a' => $phoneA]),
                'city' => $F('City', 'text', 120, ['a' => 'city location town state']),
                'tags' => $tags,
                'notes' => $F('Notes', 'long', 2000, ['multi' => true, 'app' => true, 'a' => 'notes comments remarks']),
                'source' => $F('Source', 'text', 80, ['a' => 'source origin list']),
            ],
            'keys' => ['email' => 'email'],
            'likely' => '', 'need' => 'email', 'show' => ['email', 'name', 'company', 'title'], 'opts' => ['tags'],
        ],
    ];
    return $T;
}

/** May this person import into this kind of record? (The same rules as adding one by hand; a workspace's parts.) */
function impMay(string $tk, array $u): bool
{
    if (!featureAllowed($u, 'imports', true)) return false;
    $T = impTargets()[$tk] ?? null;
    if (!$T || ($T['feat'] !== '' && !wsFeatureOn($T['feat']))) {
        return false;
    }
    $lvl = userLevel($u);
    switch ($tk) {
        case 'ats':
            return $lvl >= 2 && can('ats/x', 'w');
        case 'cons':
        case 'vendor':
        case 'req':
            if ($lvl < 2 && !isRecruiter($u['id']) && !isBench($u['id'])) {
                return false;
            }
            return can($T['col'] . '/x', 'w');
        case 'mail':
            return mailCanUse($u);
        default:
            return can($T['col'] . '/x', 'w');
    }
}
function impAllowed(array $u): array
{
    return array_values(array_filter(array_keys(impTargets()), fn($k) => impMay($k, $u)));
}
function impTarget(string $tk, array $u): array
{
    if (!isset(impTargets()[$tk])) {
        fail(400, 'invalid_argument', 'Choose what you are importing.');
    }
    if (!impMay($tk, $u)) {
        fail(403, 'forbidden', 'Your access does not include adding ' . impTargets()[$tk]['many'] . '. An administrator can switch it on under Roles & access.');
    }
    return impTargets()[$tk];
}

/* ---------------------------------------------------------------- reading the file */

/** Text in UTF-8 whatever the spreadsheet saved it as (UTF-16 "Unicode text", Windows-1252, a byte-order mark). */
function impUtf8(string $s): string
{
    if (str_starts_with($s, "\xEF\xBB\xBF")) {
        return substr($s, 3);
    }
    if (str_starts_with($s, "\xFF\xFE")) {
        return (string) mb_convert_encoding(substr($s, 2), 'UTF-8', 'UTF-16LE');
    }
    if (str_starts_with($s, "\xFE\xFF")) {
        return (string) mb_convert_encoding(substr($s, 2), 'UTF-8', 'UTF-16BE');
    }
    $head = substr($s, 0, 400);
    if (strlen($head) > 8 && substr_count($head, "\0") > strlen($head) / 3) {
        // UTF-16 without a byte-order mark: one byte of each pair is zero in plain text
        $evenZero = substr_count(implode('', array_map(fn($i) => $head[$i] ?? '', range(0, strlen($head) - 1, 2))), "\0");
        return (string) mb_convert_encoding($s, 'UTF-8', $evenZero > 0 ? 'UTF-16BE' : 'UTF-16LE');
    }
    return mb_check_encoding($s, 'UTF-8') ? $s : (string) mb_convert_encoding($s, 'UTF-8', 'Windows-1252');
}
/** The separator a delimited text uses: the one that splits the first lines most evenly (tab, comma, semicolon, pipe). */
function impSniffSep(string $s): string
{
    $lines = array_slice(array_values(array_filter(explode("\n", substr($s, 0, 20000)), fn($l) => trim($l) !== '')), 0, 15);
    if (!$lines) {
        return ',';
    }
    $best = ',';
    $bestScore = 0;
    foreach (["\t", ',', ';', '|'] as $sep) {
        $counts = array_map(fn($l) => substr_count(preg_replace('/"[^"]*"/', '', $l) ?? $l, $sep), $lines);
        $min = min($counts);
        $score = $min > 0 ? $min * 10 + (count(array_unique($counts)) === 1 ? 5 : 0) : (max($counts) > 0 ? 1 : 0);
        if ($score > $bestScore) {
            $best = $sep;
            $bestScore = $score;
        }
    }
    return $best;
}
/**
 * Delimited text into rows of [line number, cell, cell...]: quoted cells (with commas, quotes and line breaks inside),
 * Excel's "sep=;" first line, empty rows left out. At most IMP_MAX_ROWS (+ room for title rows above the headings).
 */
function impCsv(string $s, string $sep = ''): array
{
    $s = str_replace(["\r\n", "\r"], "\n", $s);
    $ln = 1;
    if (preg_match('/^"?sep=(.)"?\n/i', $s, $m)) {
        $sep = $m[1];
        $s = substr($s, strlen($m[0]));
        $ln = 2;
    }
    if ($sep === '') {
        $sep = impSniffSep($s);
    }
    $rows = [];
    $row = [];
    $f = '';
    $q = false;
    $start = $ln;
    $len = strlen($s);
    $i = 0;
    $cap = IMP_MAX_ROWS + 40;
    $push = function () use (&$rows, &$row, &$f, &$start) {
        $row[] = $f;
        $f = '';
        foreach ($row as $c) {
            if (trim($c) !== '') {
                $rows[] = array_merge([$start], array_map(fn($c) => mb_substr(trim($c), 0, IMP_CELL), array_slice($row, 0, IMP_MAX_COLS)));
                break;
            }
        }
        $row = [];
    };
    while ($i < $len && count($rows) < $cap) {
        if ($q) {
            $j = strpos($s, '"', $i);
            if ($j === false) {
                $f .= substr($s, $i);
                $i = $len;
                break;
            }
            $chunk = substr($s, $i, $j - $i);
            $ln += substr_count($chunk, "\n");
            $f .= $chunk;
            if (($s[$j + 1] ?? '') === '"') {
                $f .= '"';
                $i = $j + 2;
            } else {
                $q = false;
                $i = $j + 1;
            }
            continue;
        }
        $n = strcspn($s, $sep . "\"\n", $i);
        $f .= substr($s, $i, $n);
        $i += $n;
        if ($i >= $len) {
            break;
        }
        $ch = $s[$i];
        if ($ch === '"') {
            if (trim($f) === '') {
                $f = '';
                $q = true;
            } else {
                $f .= '"';
            }
        } elseif ($ch === $sep) {
            $row[] = $f;
            $f = '';
        } else {
            $push();
            $ln++;
            $start = $ln;
        }
        $i++;
    }
    if ($f !== '' || $row) {
        $push();
    }
    return $rows;
}
/** A spreadsheet column letter (A, Z, AA) as a number from 0. */
function impColNum(string $ref): int
{
    $n = 0;
    foreach (str_split(strtoupper((string) preg_replace('/[^A-Za-z]/', '', $ref))) as $ch) {
        $n = $n * 26 + (ord($ch) - 64);
    }
    return max(0, $n - 1);
}
function impColName(int $i): string
{
    $s = '';
    for ($i++; $i > 0; $i = intdiv($i - 1, 26)) {
        $s = chr(65 + ($i - 1) % 26) . $s;
    }
    return $s;
}
/** A spreadsheet date (days since 1899-12-30, or 1904-01-01) as YYYY-MM-DD, with the time when there is one. */
function impSerialDate(float $v, bool $d1904, bool $time): string
{
    $days = (int) floor($v);
    $secs = (int) round(($v - $days) * 86400);
    $ts = ($d1904 ? gmmktime(0, 0, 0, 1, 1, 1904) : gmmktime(0, 0, 0, 12, 30, 1899)) + $days * 86400 + $secs;
    return gmdate($time && $secs > 0 ? 'Y-m-d H:i' : 'Y-m-d', $ts);
}
/** The parts of an .xlsx file this reader needs, by name (ZipArchive when the host has it). */
function impZipGet(string $path): callable
{
    if (class_exists('ZipArchive')) {
        $z = new ZipArchive();
        if ($z->open($path) === true) {
            return function (string $n) use ($z): ?string {
                $c = $z->getFromName($n);
                return $c === false ? null : $c;
            };
        }
        return fn(string $n): ?string => null;
    }
    require_once __DIR__ . '/textract.php';
    $all = zipEntries((string) file_get_contents($path), '#^xl/(workbook\.xml|_rels/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets/[^/]+\.xml)$#');
    return fn(string $n): ?string => $all[$n] ?? null;
}
/** Every sheet of an Excel workbook (.xlsx): name, hidden or not, rows of [row number, cell, cell...]. */
function impXlsx(string $path): array
{
    $get = impZipGet($path);
    $wb = $get('xl/workbook.xml');
    if ($wb === null) {
        fail(400, 'invalid_argument', 'This Excel file could not be read. Open it in Excel and save it again as .xlsx, or save it as CSV.');
    }
    $d1904 = (bool) preg_match('/date1904="(1|true)"/i', $wb);
    // where each sheet's part is
    $targets = [];
    if (preg_match_all('#<(?:\w+:)?Relationship\b([^>]*)/?>#', (string) $get('xl/_rels/workbook.xml.rels'), $mm)) {
        foreach ($mm[1] as $attrs) {
            if (preg_match('/\bId="([^"]+)"/', $attrs, $a) && preg_match('/\bTarget="([^"]+)"/', $attrs, $t)) {
                $tg = ltrim(html_entity_decode($t[1], ENT_QUOTES | ENT_XML1), '/');
                $targets[$a[1]] = str_starts_with($tg, 'xl/') ? $tg : 'xl/' . $tg;
            }
        }
    }
    $sheets = [];
    if (preg_match_all('#<(?:\w+:)?sheet\b([^>]*)/?>#', $wb, $mm)) {
        foreach ($mm[1] as $k => $attrs) {
            $name = preg_match('/\bname="([^"]*)"/', $attrs, $a) ? html_entity_decode($a[1], ENT_QUOTES | ENT_XML1, 'UTF-8') : 'Sheet ' . ($k + 1);
            $rid = preg_match('/\br:id="([^"]+)"/', $attrs, $a) ? $a[1] : (preg_match('/\bid="([^"]+)"/', $attrs, $a) ? $a[1] : '');
            $hidden = (bool) preg_match('/\bstate="(hidden|veryHidden)"/', $attrs);
            $sheets[] = ['n' => $name, 'hidden' => $hidden, 'p' => $targets[$rid] ?? 'xl/worksheets/sheet' . ($k + 1) . '.xml'];
        }
    }
    if (!$sheets) {
        $sheets[] = ['n' => 'Sheet 1', 'hidden' => false, 'p' => 'xl/worksheets/sheet1.xml'];
    }
    // shared strings (rich text runs joined, phonetic guides left out)
    $shared = [];
    $ss = $get('xl/sharedStrings.xml');
    if ($ss !== null && preg_match_all('#<(?:\w+:)?si\b[^>]*?(?:/>|>(.*?)</(?:\w+:)?si>)#s', $ss, $mm)) {
        foreach ($mm[1] as $si) {
            $si = preg_replace('#<(?:\w+:)?rPh\b.*?</(?:\w+:)?rPh>#s', '', (string) $si) ?? '';
            preg_match_all('#<(?:\w+:)?t\b[^>]*?(?:/>|>(.*?)</(?:\w+:)?t>)#s', $si, $tt);
            $shared[] = html_entity_decode(implode('', $tt[1] ?? []), ENT_QUOTES | ENT_XML1, 'UTF-8');
        }
    }
    unset($ss);
    // which cell styles are dates (built-in date formats, or a custom format with day, month or year in it)
    $dateStyle = [];
    $st = (string) $get('xl/styles.xml');
    $fmt = [];
    if (preg_match_all('#<(?:\w+:)?numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"#', $st, $mm, PREG_SET_ORDER)) {
        foreach ($mm as $x) {
            $code = html_entity_decode($x[2], ENT_QUOTES | ENT_XML1);
            $code = (string) preg_replace(['/"[^"]*"/', '/\[[^\]]*\]/', '/\\\\./'], '', $code);
            $fmt[(int) $x[1]] = preg_match('/[dmy]/i', $code) ? 'd' : (preg_match('/[hs]/i', $code) ? 't' : '');
        }
    }
    if (preg_match('#<(?:\w+:)?cellXfs\b[^>]*>(.*?)</(?:\w+:)?cellXfs>#s', $st, $cx) && preg_match_all('#<(?:\w+:)?xf\b([^>]*)#', $cx[1], $mm)) {
        foreach ($mm[1] as $k => $attrs) {
            $id = preg_match('/numFmtId="(\d+)"/', $attrs, $a) ? (int) $a[1] : 0;
            $kind = ($id >= 14 && $id <= 17) || $id === 22 || ($id >= 27 && $id <= 36) || ($id >= 50 && $id <= 58) ? 'd' : (($id >= 18 && $id <= 21) || ($id >= 45 && $id <= 47) ? 't' : ($fmt[$id] ?? ''));
            if ($kind !== '') {
                $dateStyle[$k] = $kind;
            }
        }
    }
    unset($st);
    $out = [];
    foreach (array_slice($sheets, 0, IMP_MAX_SHEETS) as $sh) {
        $xml = $get($sh['p']);
        $rows = [];
        $more = false;
        if ($xml !== null) {
            [$rows, $more] = impXlsxRows($xml, $shared, $dateStyle, $d1904);
        }
        $out[] = ['n' => $sh['n'], 'hidden' => $sh['hidden'], 'rows' => $rows, 'more' => $more];
    }
    return $out;
}
/** One worksheet's rows, read as a stream (a big sheet never has to fit in memory as a tree). */
function impXlsxRows(string $xml, array $shared, array $dateStyle, bool $d1904): array
{
    $r = new XMLReader();
    if (!$r->XML($xml, null, LIBXML_NONET | LIBXML_COMPACT | (defined('LIBXML_PARSEHUGE') ? LIBXML_PARSEHUGE : 0))) {
        return [[], false];
    }
    $rows = [];
    $cells = [];
    $rowNo = 0;
    $next = 0;
    $cur = null;
    $in = '';
    $skip = 0;
    $cap = IMP_MAX_ROWS + 40;
    $more = false;
    $flush = function () use (&$rows, &$cells, &$rowNo) {
        $any = false;
        foreach ($cells as $c) {
            if (trim($c) !== '') {
                $any = true;
                break;
            }
        }
        if ($any) {
            $max = min(IMP_MAX_COLS - 1, max(array_keys($cells)));
            $line = [$rowNo];
            for ($c = 0; $c <= $max; $c++) {
                $line[] = mb_substr(trim($cells[$c] ?? ''), 0, IMP_CELL);
            }
            $rows[] = $line;
        }
        $cells = [];
    };
    while (@$r->read()) {
        $nt = $r->nodeType;
        $nm = $r->localName;
        if ($nt === XMLReader::ELEMENT) {
            if ($skip > 0) {
                if (!$r->isEmptyElement) {
                    $skip++;
                }
                continue;
            }
            if ($nm === 'row') {
                if (count($rows) >= $cap) {
                    $more = true;
                    break;
                }
                $cells = [];
                $rowNo = (int) ($r->getAttribute('r') ?: $rowNo + 1);
                $next = 0;
                if ($r->isEmptyElement) {
                    $cells = [];
                }
            } elseif ($nm === 'c') {
                $ref = (string) $r->getAttribute('r');
                $col = $ref !== '' ? impColNum($ref) : $next;
                $cur = ['col' => $col, 't' => (string) $r->getAttribute('t'), 's' => (int) $r->getAttribute('s'), 'v' => '', 'is' => ''];
                if ($r->isEmptyElement) {
                    $cur = null;
                    $next = $col + 1;
                }
            } elseif ($cur !== null && ($nm === 'v' || $nm === 't')) {
                $in = $r->isEmptyElement ? '' : $nm;
            } elseif ($nm === 'rPh' && !$r->isEmptyElement) {
                $skip = 1; // phonetic guide: not part of the value
            }
        } elseif ($nt === XMLReader::END_ELEMENT) {
            if ($skip > 0) {
                $skip--;
                continue;
            }
            if ($nm === 'v' || $nm === 't') {
                $in = '';
            } elseif ($nm === 'c' && $cur !== null) {
                $v = $cur['v'];
                switch ($cur['t']) {
                    case 's':
                        $v = $shared[(int) $v] ?? '';
                        break;
                    case 'inlineStr':
                        $v = $cur['is'];
                        break;
                    case 'b':
                        $v = $v === '1' ? 'TRUE' : 'FALSE';
                        break;
                    case 'e':
                        $v = ''; // #N/A and other formula errors
                        break;
                    case 'd':
                        $v = substr($v, 0, 10);
                        break;
                    case 'str':
                        break;
                    default:
                        if ($v !== '' && is_numeric($v)) {
                            $kind = $dateStyle[$cur['s']] ?? '';
                            if ($kind !== '') {
                                $v = impSerialDate((float) $v, $d1904, $kind === 't');
                            } elseif (!preg_match('/^-?\d+$/', $v)) {
                                $f = round((float) $v, 9);
                                $v = abs($f) >= 1e15 ? $v : rtrim(rtrim(number_format($f, 9, '.', ''), '0'), '.');
                            }
                        }
                }
                $cells[$cur['col']] = (string) $v;
                $next = $cur['col'] + 1;
                $cur = null;
            } elseif ($nm === 'row') {
                $flush();
            } elseif ($nm === 'sheetData') {
                break;
            }
        } elseif ($cur !== null && $in !== '' && $skip === 0 && ($nt === XMLReader::TEXT || $nt === XMLReader::CDATA || $nt === XMLReader::WHITESPACE || $nt === XMLReader::SIGNIFICANT_WHITESPACE)) {
            if ($in === 'v') {
                $cur['v'] .= $r->value;
            } else {
                $cur['is'] .= $r->value;
            }
        }
    }
    $r->close();
    return [$rows, $more];
}
/**
 * Which row holds the headings: the first of the opening rows that is about as wide as the data and reads as words.
 * -1 when the file starts straight with data (email addresses, numbers): the columns are then called A, B, C...
 */
function impHeadRow(array $rows): int
{
    $look = array_slice($rows, 0, 15);
    if (!$look) {
        return 0;
    }
    $filled = array_map(fn($r) => array_values(array_filter(array_slice($r, 1), fn($c) => trim((string) $c) !== '')), $look);
    $max = max(array_map('count', $filled));
    foreach ($filled as $i => $cells) {
        $n = count($cells);
        if ($n >= max(min(2, $max), (int) ceil($max * 0.6))) {
            $words = count(array_filter($cells, fn($c) => !is_numeric(str_replace([',', '$', '%', ' '], '', (string) $c)) && mb_strlen((string) $c) <= 60 && !str_contains((string) $c, '@')));
            if ($words >= $n * 0.7) {
                return $i;
            }
        }
    }
    return -1;
}
/** The columns under a heading row: index, heading (or "Column C"), a few sample values, how many rows fill it. */
function impColumns(array $rows, int $hrow): array
{
    $head = $hrow >= 0 ? $rows[$hrow] ?? [0] : [0];
    $data = array_slice($rows, max(0, $hrow + 1));
    $w = count($head) - 1;
    foreach ($data as $r) {
        $w = max($w, count($r) - 1);
    }
    $w = min($w, IMP_MAX_COLS);
    $cols = [];
    $seen = [];
    for ($c = 0; $c < $w; $c++) {
        $h = trim((string) ($head[$c + 1] ?? ''));
        $samples = [];
        $filled = 0;
        foreach ($data as $k => $r) {
            $v = trim((string) ($r[$c + 1] ?? ''));
            if ($v === '') {
                continue;
            }
            $filled++;
            if (count($samples) < 3 && $k < 400 && !in_array($v, $samples, true)) {
                $samples[] = mb_substr(preg_replace('/\s+/', ' ', $v) ?? $v, 0, 80);
            }
        }
        if ($h === '' && $filled === 0) {
            continue;
        }
        $label = $h !== '' ? mb_substr($h, 0, 80) : 'Column ' . impColName($c);
        $base = $label;
        for ($k = 2; isset($seen[mb_strtolower($label)]); $k++) {
            $label = $base . ' (' . $k . ')';
        }
        $seen[mb_strtolower($label)] = true;
        $cols[] = ['i' => $c, 'h' => $label, 'hd' => $h !== '', 's' => $samples, 'f' => $filled];
    }
    return $cols;
}
function impNormHead(string $h): string
{
    return (string) preg_replace('/[^a-z0-9]/', '', mb_strtolower(impAscii($h)));
}
function impAscii(string $s): string
{
    if (preg_match('/[^\x20-\x7e]/', $s)) {
        $t = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $s);
        if (is_string($t) && $t !== '') {
            return $t;
        }
    }
    return $s;
}
/**
 * The columns matched to fields: what this team matched before for the same heading, then the usual names for each
 * field, then the values themselves (a column of email addresses is an email, of LinkedIn links the LinkedIn, of
 * phone numbers a phone). A field takes one column unless it joins several (skills, tags, notes).
 */
function impGuess(string $tk, array $T, array $cols, array $data, array $learned): array
{
    $map = [];
    $used = [];
    $take = function (int $i, string $fk) use (&$map, &$used, $T): bool {
        if (isset($map[$i]) || !isset($T['f'][$fk]) || (isset($used[$fk]) && empty($T['f'][$fk]['multi']))) {
            return false;
        }
        $map[$i] = $fk;
        $used[$fk] = true;
        return true;
    };
    $alias = [];
    foreach ($T['f'] as $fk => $f) {
        foreach (preg_split('/\s+/', (string) ($f['a'] ?? '')) ?: [] as $a) {
            if ($a !== '' && !isset($alias[$a])) {
                $alias[$a] = $fk;
            }
        }
        $alias[impNormHead($f['l'])] ??= $fk;
    }
    // 1. what was matched for this heading before, 2. a usual name for the field
    foreach ($cols as $c) {
        if (!$c['hd']) {
            continue;
        }
        $h = impNormHead($c['h']);
        if (isset($learned[$h]) && $take($c['i'], (string) $learned[$h])) {
            continue;
        }
        if (isset($alias[$h])) {
            $take($c['i'], $alias[$h]);
        }
    }
    // 3. a heading that contains a usual name ("Candidate Email Address", "Phone (mobile)"), the longest name first
    $names = array_keys($alias);
    usort($names, fn($a, $b) => strlen($b) <=> strlen($a));
    foreach ($cols as $c) {
        if (isset($map[$c['i']]) || !$c['hd']) {
            continue;
        }
        $h = impNormHead($c['h']);
        foreach ($names as $a) {
            if (strlen($a) >= 4 && str_contains($h, $a) && $take($c['i'], $alias[$a])) {
                break;
            }
        }
    }
    // 4. the values: emails, LinkedIn links, phone numbers, web addresses
    $kinds = ['email' => [], 'li' => [], 'phone' => [], 'url' => [], 'domain' => []];
    foreach ($T['f'] as $fk => $f) {
        if (isset($kinds[$f['t']])) {
            $kinds[$f['t']][] = $fk;
        }
    }
    foreach ($cols as $c) {
        if (isset($map[$c['i']]) || $c['f'] === 0) {
            continue;
        }
        $vals = [];
        foreach (array_slice($data, 0, 60) as $r) {
            $v = trim((string) ($r[$c['i'] + 1] ?? ''));
            if ($v !== '') {
                $vals[] = $v;
            }
        }
        if (!$vals) {
            continue;
        }
        $share = fn(string $re) => count(array_filter($vals, fn($v) => (bool) preg_match($re, $v))) / count($vals);
        $want = $share('/^[^@\s<>]+@[^@\s<>]+\.[a-z]{2,}$/i') >= 0.6 ? 'email' : ($share('#linkedin\.com/#i') >= 0.6 ? 'li' : ($share('/^\+?[\d\s().\-]{7,20}$/') >= 0.6 && $share('/\d{3}/') >= 0.6 ? 'phone' : ($share('#^(https?://|www\.)#i') >= 0.6 ? 'url' : '')));
        $list = $want === 'url' ? array_merge($kinds['url'], $kinds['domain']) : ($want !== '' ? $kinds[$want] : []);
        foreach ($list as $fk) {
            if ($take($c['i'], $fk)) {
                break;
            }
        }
    }
    // a name split in two columns: the full-name field stays free for them
    if (isset($used['first'], $used['last']) && !isset($used['n']) && !isset($used['name'])) {
        // nothing to do: first + last build the name
    }
    return $map;
}

/** v41.1: a new import run from rows already read (a file, pasted rows, or rows brought from another system):
 *  $sheets = [['n' => name, 'hidden' => bool, 'rows' => [[cell, ...], ...], 'more' => bool], ...]; $extra goes into
 *  the run's data (where the rows came from). Returns the run's id. */
function impRunFromSheets(array $u, string $tk, array $T, array $sheets, string $name, int $size, bool $paste, array $extra = []): string
{
    $sheets = array_values(array_filter($sheets, fn($s) => $s['rows'] || !$s['hidden']));
    $best = -1;
    foreach ($sheets as $k => $s) {
        if ($best < 0 && !$s['hidden'] && count($s['rows']) >= 2) {
            $best = $k;
        }
    }
    if ($best < 0) {
        fail(400, 'invalid_argument', 'No rows were found. The first row should hold the column names and the rows below it the ' . $T['many'] . '.');
    }
    $id = 'i' . rid(9);
    $info = [];
    dbBatch(function () use ($sheets, $id, &$info) {
        foreach ($sheets as $k => $s) {
            foreach (array_chunk($s['rows'], IMP_CHUNK) as $c => $part) {
                impRowsPut($id, 's', $k * 1000 + $c, $part);
            }
            $info[] = ['n' => $s['n'], 'rows' => count($s['rows']), 'more' => !empty($s['more']) || count($s['rows']) > IMP_MAX_ROWS + 1, 'hidden' => !empty($s['hidden'])];
        }
    });
    $rows = $sheets[$best]['rows'];
    $hrow = impHeadRow($rows);
    $cols = impColumns($rows, $hrow);
    $map = impGuess($tk, $T, $cols, array_slice($rows, $hrow + 1, 80), impLearned($tk));
    $data = $extra + ['file' => $name, 'size' => $size, 'paste' => $paste, 'sheets' => $info, 'sheet' => $best, 'hrow' => $hrow, 'map' => (object) $map, 'opts' => (object) ['upd' => 'fill'], 'fixes' => (object) [], 'acts' => (object) [], 'who' => (string) $u['name'], 'n' => max(0, count($rows) - $hrow - 1)];
    impDb()->prepare('INSERT INTO imp_runs (id, at, uid, tgt, st, lk, data) VALUES (?,?,?,?,?,0,?)')->execute([$id, now(), $u['id'], $tk, 'draft', json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE)]);
    return $id;
}

/* ---------------------------------------------------------------- stored runs */

function impRowsPut(string $run, string $kind, int $k, array $rows): void
{
    impDb()->prepare('REPLACE INTO imp_rows (run, kind, k, data) VALUES (?,?,?,?)')->execute([$run, $kind, $k, json_encode($rows, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE)]);
}
/** Stored chunks of one kind, in order (all of them, or the one numbered $k). */
function impRowsGet(string $run, string $kind, ?int $k = null): array
{
    if ($k !== null) {
        $s = impDb()->prepare('SELECT data FROM imp_rows WHERE run = ? AND kind = ? AND k = ?');
        $s->execute([$run, $kind, $k]);
        $d = $s->fetchColumn();
        return $d === false ? [] : (array) json_decode((string) $d, true);
    }
    $s = impDb()->prepare('SELECT data FROM imp_rows WHERE run = ? AND kind = ? ORDER BY k');
    $s->execute([$run, $kind]);
    $out = [];
    foreach ($s->fetchAll(PDO::FETCH_COLUMN) as $d) {
        foreach ((array) json_decode((string) $d, true) as $x) {
            $out[] = $x;
        }
    }
    return $out;
}
/** Every stored row of one sheet ([line, cells...]). */
function impSheetRows(string $run, int $sheet): array
{
    $s = impDb()->prepare('SELECT data FROM imp_rows WHERE run = ? AND kind = ? AND k >= ? AND k < ? ORDER BY k');
    $s->execute([$run, 's', $sheet * 1000, $sheet * 1000 + 1000]);
    $out = [];
    foreach ($s->fetchAll(PDO::FETCH_COLUMN) as $d) {
        foreach ((array) json_decode((string) $d, true) as $x) {
            $out[] = $x;
        }
    }
    return $out;
}
/** A run, if this person may see it (their own, or any for an administrator). */
function impRun(string $id, array $u): array
{
    if (!preg_match('/^i[a-f0-9]{16,22}$/', $id)) {
        fail(404, 'not_found', 'No such import.');
    }
    $s = impDb()->prepare('SELECT * FROM imp_runs WHERE id = ?');
    $s->execute([$id]);
    $r = $s->fetch();
    if (!$r || ($r['uid'] !== $u['id'] && !hasRole($u, 'admin'))) {
        fail(404, 'not_found', 'No such import. Imports are kept for ' . IMP_KEEP_DONE . ' days.');
    }
    $r['data'] = (array) json_decode((string) $r['data'], true);
    return $r;
}
function impRunSave(string $id, array $data, ?string $st = null): void
{
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    if ($st !== null) {
        impDb()->prepare('UPDATE imp_runs SET data = ?, st = ? WHERE id = ?')->execute([$json, $st, $id]);
    } else {
        impDb()->prepare('UPDATE imp_runs SET data = ? WHERE id = ?')->execute([$json, $id]);
    }
}
/** Files never imported go after 7 days; the rows and undo information of imports after 30; the list after a year. */
function impCleanup(): void
{
    $p = impDb();
    $now = now();
    $old = $p->prepare("SELECT id, st, data FROM imp_runs WHERE (st = 'draft' AND at < ?) OR (st <> 'draft' AND at < ? AND data NOT LIKE '%\"purged\":true%') LIMIT 50");
    $old->execute([$now - IMP_KEEP_DRAFT * 86400000, $now - IMP_KEEP_DONE * 86400000]);
    foreach ($old->fetchAll() as $r) {
        $p->prepare('DELETE FROM imp_rows WHERE run = ?')->execute([$r['id']]);
        $p->prepare('DELETE FROM imp_log WHERE run = ?')->execute([$r['id']]);
        if ($r['st'] === 'draft') {
            $p->prepare('DELETE FROM imp_runs WHERE id = ?')->execute([$r['id']]);
        } else {
            $d = (array) json_decode((string) $r['data'], true);
            $d['purged'] = true;
            impRunSave((string) $r['id'], $d);
        }
    }
    $p->prepare('DELETE FROM imp_runs WHERE at < ?')->execute([$now - 365 * 86400000]);
}

/* ---------------------------------------------------------------- reading values */

function impKey(string $s): string
{
    return (string) preg_replace('/[^a-z0-9]/', '', mb_strtolower(impAscii($s)));
}
/** A company name compared without case, punctuation or the legal form ("Acme, Inc." is "acme"). */
function impCoKey(string $s): string
{
    $s = mb_strtolower(impAscii($s));
    $s = (string) preg_replace('/&/', ' and ', $s);
    $s = (string) preg_replace('/[^a-z0-9 ]+/', ' ', $s);
    $s = (string) preg_replace('/\b(the|inc|incorporated|llc|l l c|ltd|limited|corp|corporation|co|company|pvt|private|plc|gmbh|llp|lp|pc|sa|ag|bv|nv|pty|pte|srl|sas|usa|us)\b/', ' ', $s);
    return trim((string) preg_replace('/\s+/', ' ', $s));
}
/** A person's name compared without case, accents, punctuation, initials or order ("Doe, John A." is "doe john"). */
function impNameKey(string $s): string
{
    $s = mb_strtolower(impAscii($s));
    $s = (string) preg_replace('/[^a-z ]+/', ' ', $s);
    $w = array_values(array_filter(explode(' ', $s), fn($x) => strlen($x) > 1 && !in_array($x, ['mr', 'mrs', 'ms', 'dr', 'jr', 'sr', 'ii', 'iii', 'iv'], true)));
    sort($w);
    return implode(' ', $w);
}
function impCityKey(string $s): string
{
    return impKey(explode(',', $s)[0]);
}
function impDomain(string $s): string
{
    $s = strtolower(trim($s));
    if (str_contains($s, '@') && !str_contains($s, '/')) {
        $s = substr($s, strrpos($s, '@') + 1);
    }
    $s = (string) preg_replace('#^[a-z][a-z0-9+.\-]*://#', '', $s);
    $s = (string) preg_replace('#[/?\#:].*$#', '', $s);
    $s = (string) preg_replace('/^www\d?\./', '', $s);
    return preg_match('/^[a-z0-9\-]+(\.[a-z0-9\-]+)+$/', $s) ? $s : '';
}
function impLiSlug(string $s): string
{
    return preg_match('#linkedin\.com/(?:in|pub)/([^/?\#\s]+)#i', $s, $m) ? strtolower(rawurldecode($m[1])) : '';
}
/** The value a record is found by, for each kind of key. */
function impKeyOf(string $kind, $v): string
{
    if (is_array($v)) {
        return '';
    }
    $v = trim((string) $v);
    if ($v === '') {
        return '';
    }
    switch ($kind) {
        case 'email':
            return strtolower($v);
        case 'phone':
            $d = (string) preg_replace('/\D+/', '', $v);
            return strlen($d) >= 10 ? substr($d, -10) : '';
        case 'li':
            return impLiSlug($v);
        case 'co':
            return impCoKey($v);
        case 'domain':
            $d = impDomain($v);
            return $d !== '' && !in_array($d, IMP_FREE_MAIL, true) ? $d : '';
        case 'ref':
            return strtoupper((string) preg_replace('/\s+/', '', $v));
    }
    return '';
}
function impClip(string $s, int $max): string
{
    return $max > 0 && mb_strlen($s) > $max ? mb_substr($s, 0, $max) : $s;
}
/** One of the allowed values, from the value itself, its label or a usual way of writing it ('' if none). */
function impPick(array $o, array $syn, string $v): string
{
    $k = impKey($v);
    if ($k === '') {
        return '';
    }
    foreach ($o as $val => $lab) {
        if (impKey((string) $val) === $k || impKey((string) $lab) === $k) {
            return (string) $val;
        }
    }
    foreach ($syn as $val => $list) {
        if (isset($o[$val]) && in_array($k, $list, true)) {
            return (string) $val;
        }
    }
    // "H1B transfer", "GC holder": the longest usual way of writing it that the value starts with
    $best = '';
    $bestLen = 0;
    foreach ($syn as $val => $list) {
        if (!isset($o[$val])) {
            continue;
        }
        foreach ($list as $s) {
            if (strlen($s) >= 2 && strlen($s) > $bestLen && str_starts_with($k, $s) && strlen($k) - strlen($s) <= 12) {
                $best = (string) $val;
                $bestLen = strlen($s);
            }
        }
    }
    return $best;
}
/** A date in any usual spelling as YYYY-MM-DD; $dmy says how 03/04/2026 is read. */
function impDate(string $v, bool $dmy): array
{
    $v = trim($v);
    $k = impKey($v);
    if (in_array($k, ['asap', 'immediate', 'immediately', 'tbd', 'tba', 'na', 'none', 'open', 'flexible', 'anytime'], true)) {
        return ['', 'n', 'is not a date; left empty'];
    }
    if (preg_match('/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[T ].*)?$/', $v, $m)) {
        [$y, $mo, $d] = [(int) $m[1], (int) $m[2], (int) $m[3]];
    } elseif (preg_match('/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2}|\d{4})$/', $v, $m)) {
        [$a, $b, $y] = [(int) $m[1], (int) $m[2], (int) $m[3]];
        if ($y < 100) {
            $y += $y < 70 ? 2000 : 1900;
        }
        if ($a > 12 && $b <= 12) {
            [$d, $mo] = [$a, $b];
        } elseif ($b > 12 && $a <= 12) {
            [$mo, $d] = [$a, $b];
        } else {
            [$mo, $d] = $dmy ? [$b, $a] : [$a, $b];
        }
    } elseif (preg_match('/^\d{5}(\.\d+)?$/', $v) && (float) $v > 20000 && (float) $v < 80000) {
        return [impSerialDate((float) $v, false, false), 'n', 'read as a spreadsheet date'];
    } else {
        $t = strtotime(preg_replace('/(\d)(st|nd|rd|th)\b/i', '$1', $v) ?? $v);
        if ($t === false) {
            return ['', 'w', 'is not a date; left empty'];
        }
        [$y, $mo, $d] = [(int) date('Y', $t), (int) date('n', $t), (int) date('j', $t)];
    }
    if (!checkdate($mo, $d, $y) || $y < 1900 || $y > 2200) {
        return ['', 'w', 'is not a date; left empty'];
    }
    return [sprintf('%04d-%02d-%02d', $y, $mo, $d), '', ''];
}
/**
 * One cell read as a field: [value, messages]. A message is [kind, text]: 'e' stops the row, 'w' is shown and the row
 * goes ahead, 'n' notes how the value was read.
 */
function impNorm(array $f, string $raw, array $ctx): array
{
    $m = [];
    $v = trim(str_replace(["\u{00A0}", "\u{200B}", "\u{FEFF}"], [' ', '', ''], $raw));
    if ($v === '') {
        return ['', []];
    }
    $t = $f['t'];
    $q = "'" . mb_substr(preg_replace('/\s+/', ' ', $v) ?? $v, 0, 60) . "'";
    // a cell written as a spreadsheet formula would run again when an export of the record is opened in a spreadsheet
    if (str_starts_with($v, '=') && !in_array($t, ['num', 'int', 'date'], true)) {
        $v = ltrim($v, '= ');
        $m[] = ['w', 'started with "=" like a spreadsheet formula; the "=" was left out'];
        if ($v === '') {
            return ['', $m];
        }
    }
    switch ($t) {
        case 'name':
        case 'first':
        case 'last':
            $v = (string) preg_replace('/\s+/', ' ', $v);
            if ($t === 'name' && preg_match('/^([^,]+),\s*([^,]+)$/u', $v, $x) && !preg_match('/\d|\b(jr|sr|ii|iii|iv|phd|md|mba|pmp|cpa)\b\.?$/i', $x[2]) && substr_count(trim($x[1]), ' ') <= 1) {
                $v = trim($x[2]) . ' ' . trim($x[1]);
                $m[] = ['n', 'read "Last, First" as ' . $v];
            }
            if (mb_strlen($v) > 3 && ($v === mb_strtoupper($v) || $v === mb_strtolower($v)) && preg_match('/\p{L}/u', $v)) {
                $v = mb_convert_case(mb_strtolower($v), MB_CASE_TITLE);
            }
            if (preg_match('/@|\d{3}/', $v)) {
                $m[] = ['w', $q . ' does not look like a name'];
            }
            return [impClip($v, $f['max'] ?: 120), $m];
        case 'email':
            $v = (string) preg_replace('/^mailto:/i', '', $v);
            preg_match_all('/[A-Za-z0-9._%+\'\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/', $v, $mm);
            $all = array_values(array_unique(array_map('strtolower', $mm[0])));
            if (!$all || !filter_var($all[0], FILTER_VALIDATE_EMAIL)) {
                return ['', [['w', $q . ' is not a valid email address; left empty']]];
            }
            if (count($all) > 1) {
                $m[] = ['n', count($all) . ' addresses in the cell; the first was used'];
            }
            $dom = substr($all[0], strrpos($all[0], '@') + 1);
            if (isset(IMP_MAIL_TYPOS[$dom])) {
                $m[] = ['w', 'check the address: ' . $dom . ' is probably ' . IMP_MAIL_TYPOS[$dom]];
            }
            return [impClip($all[0], 190), $m];
        case 'phone':
            $v = (string) preg_replace('/^(tel|phone|ph|mobile|cell|m|p)\s*[:.]\s*/i', '', $v);
            if (preg_match('/^\d(\.\d+)?e\+?\d+$/i', $v)) {
                return ['', [['w', 'the spreadsheet turned this phone number into ' . $v . ' and its digits are lost; left empty (format the column as text in the file)']]];
            }
            $v = (string) preg_replace('/\.0+$/', '', (string) preg_replace('/\s+/', ' ', $v));
            $d = strlen((string) preg_replace('/\D+/', '', explode('x', strtolower($v))[0]));
            if ($d < 7 || $d > 15) {
                $m[] = ['w', $q . ' does not look like a phone number (' . $d . ' digits); kept as written'];
            }
            return [impClip($v, $f['max'] ?: 60), $m];
        case 'li':
            $slug = impLiSlug($v);
            if ($slug === '' && preg_match('#^(?:in/)?([A-Za-z0-9\-_%]{3,100})/?$#', $v, $x) && !str_contains($v, '.')) {
                $slug = strtolower($x[1]);
            }
            if ($slug === '') {
                return ['', [['w', $q . ' is not a LinkedIn profile link; left empty']]];
            }
            return ['https://www.linkedin.com/in/' . rawurlencode(rawurldecode($slug)), $m];
        case 'url':
            if (!preg_match('#^[a-z][a-z0-9+.\-]*://#i', $v)) {
                $v = 'https://' . $v;
            }
            if (!filter_var($v, FILTER_VALIDATE_URL) || !preg_match('#^https?://#i', $v) || impDomain($v) === '') {
                return ['', [['w', $q . ' is not a web address; left empty']]];
            }
            return [impClip($v, $f['max'] ?: 300), $m];
        case 'domain':
            $d = impDomain($v);
            if ($d === '') {
                return ['', [['w', $q . ' is not a website or email domain; left empty']]];
            }
            return [$d, $m];
        case 'num':
        case 'int':
            $s = str_replace(',', '', mb_strtolower($v));
            $s = (string) preg_replace('/^[^\d\-.]*(?=[\d.])/', '', $s); // "$", "USD", "₹"
            if (!preg_match('/^-?\d+(\.\d+)?/', $s, $x)) {
                return ['', [['w', $q . ' is not a number; left empty']]];
            }
            $n = (float) $x[0];
            if (preg_match('/^(\d+(?:\.\d+)?)\s*(?:y|yr|yrs|years?)\D*(\d+)\s*(?:m|mo|mos|months?)\b/', $s, $ym)) {
                $n = (float) $ym[1] + round((float) $ym[2] / 12, 1);
            } elseif (preg_match('/^\d+(\.\d+)?\s*(k)\b/', $s)) {
                $n *= 1000;
            }
            if (preg_match('/^\d+(\.\d+)?\s*(?:-|–|to)\s*\d/u', $s)) {
                $m[] = ['n', 'a range; the first number was used'];
            }
            if ($t === 'int') {
                $n = (float) round($n);
            }
            if ((isset($f['min']) && $n < $f['min']) || (isset($f['max2']) && $n > $f['max2'])) {
                return ['', [['w', $q . ' is outside ' . ($f['min'] ?? 0) . '–' . ($f['max2'] ?? '') . '; left empty']]];
            }
            return [$t === 'int' ? (int) $n : (float) $n, $m];
        case 'date':
            [$d, $k, $why] = impDate($v, !empty($ctx['dmy']));
            if ($k !== '') {
                $m[] = [$k, $q . ' ' . $why];
            }
            return [$d, $m];
        case 'list':
            $items = [];
            foreach (preg_split('/[,;|\n]+/', $v) ?: [] as $it) {
                $it = mb_substr(trim($it), 0, 40);
                if ($it !== '' && !in_array(mb_strtolower($it), array_map('mb_strtolower', $items), true)) {
                    $items[] = $it;
                }
            }
            return [array_slice($items, 0, 30), $m];
        case 'choice':
            $o = $f['o'] ?? array_combine($ctx['lists'][$f['lst']] ?? [], $ctx['lists'][$f['lst']] ?? []);
            $hit = impPick($o ?: [], $f['syn'] ?? [], $v);
            if ($hit !== '') {
                if (impKey($hit) !== impKey($v) && impKey((string) ($o[$hit] ?? '')) !== impKey($v)) {
                    $m[] = ['n', $q . ' read as ' . ($o[$hit] ?? $hit)];
                }
                return [$hit, $m];
            }
            if (!empty($f['free'])) {
                $v = impClip((string) preg_replace('/\s+/', ' ', $v), $f['max'] ?: 60);
                if ($o) {
                    $m[] = ['n', $q . ' is not one of your usual values; kept as written'];
                }
                return [$v, $m];
            }
            $def = (string) ($f['def'] ?? '');
            return [$def, [['w', $q . ' is not one of: ' . implode(', ', array_slice(array_values($o), 0, 8)) . ($def !== '' ? '; set to ' . ($o[$def] ?? $def) : '; left empty')]]];
        case 'person':
            $k = mb_strtolower($v);
            foreach ($ctx['people'] ?? [] as [$id, $nm, $em]) {
                if ($k === mb_strtolower($em) || $k === mb_strtolower($nm)) {
                    return [$id, $m];
                }
            }
            return ['', [['w', $q . ' is not someone on the team; you are the owner']]];
        case 'job':
            $code = strtoupper(trim($v));
            foreach ($ctx['jobs'] ?? [] as $j) {
                if (($j['code'] !== '' && strtoupper($j['code']) === $code) || $j['id'] === $v) {
                    return [$j['id'], $m];
                }
            }
            $hits = array_values(array_filter($ctx['jobs'] ?? [], fn($j) => mb_strtolower($j['ti']) === mb_strtolower($v)));
            if (count($hits) >= 1) {
                usort($hits, fn($a, $b) => ($b['open'] <=> $a['open']) ?: ($b['at'] <=> $a['at']));
                return [$hits[0]['id'], count($hits) > 1 ? [['n', 'several jobs are called ' . $q . '; the newest open one was used']] : []];
            }
            return ['', [['w', 'no job ' . $q . '; the row goes to ' . (($ctx['jobName'] ?? '') !== '' ? $ctx['jobName'] : 'the talent pool')]]];
        case 'long':
            $v = (string) preg_replace("/[ \t]+/", ' ', $v);
            $v = (string) preg_replace("/\n{3,}/", "\n\n", $v);
            break;
        default:
            $v = (string) preg_replace('/\s+/', ' ', $v);
    }
    if ($f['max'] > 0 && mb_strlen($v) > $f['max']) {
        $m[] = ['w', 'longer than ' . $f['max'] . ' characters; the rest was cut'];
        $v = mb_substr($v, 0, $f['max']);
    }
    return [$v, $m];
}
/** Everything the checks need once per request: the module's own lists, the team, the jobs, the import's options. */
function impCtx(string $tk, array $opts, array $u): array
{
    $ctx = ['dmy' => ($opts['dates'] ?? '') === 'dmy', 'lists' => [], 'people' => [], 'jobs' => [], 'uid' => $u['id']];
    if ($tk === 'ats') {
        require_once __DIR__ . '/ats.php';
        $S = atsSettings();
        $ctx['lists']['src'] = array_values(array_map('strval', (array) $S['sources']));
        foreach (colAll('org/site/jobs') as [$id, $j]) {
            $ctx['jobs'][] = ['id' => (string) $id, 'code' => (string) ($j->code ?? ''), 'ti' => (string) ($j->ti ?? ''), 'open' => ($j->open ?? true) !== false ? 1 : 0, 'at' => (int) ($j->at ?? 0)];
        }
        $jid = (string) ($opts['job'] ?? '');
        foreach ($ctx['jobs'] as $j) {
            if ($j['id'] === $jid) {
                $ctx['jobName'] = $j['ti'];
            }
        }
    }
    if (in_array($tk, ['crm', 'crmco', 'lead'], true)) {
        $d = docGet('crm/main/x/settings');
        $def = ['types' => ['End client', 'Prime vendor', 'Implementation partner', 'Vendor', 'Sub-vendor', 'Prospect'], 'statuses' => ['Active', 'Prospect', 'On hold', 'Inactive'], 'inds' => ['IT services', 'Banking & finance', 'Insurance', 'Healthcare', 'Pharma & life sciences', 'Retail & e-commerce', 'Manufacturing', 'Telecom', 'Government', 'Energy & utilities', 'Education', 'Other'], 'rels' => ['Hiring manager', 'Recruiter', 'Account manager', 'Procurement', 'Accounts payable', 'Executive', 'Other'], 'srcs' => ['Referral', 'LinkedIn', 'Email campaign', 'Website', 'Vendor portal', 'Cold outreach', 'Existing client', 'Other']];
        foreach ($def as $k => $list) {
            $have = array_values(array_filter(array_map(fn($x) => is_scalar($x) ? (string) $x : '', (array) ($d->$k ?? [])), fn($x) => $x !== ''));
            $ctx['lists'][$k] = $have ?: $list;
        }
        foreach (db()->query("SELECT id, name, email FROM users WHERE status = 'active' AND role <> 'employer'")->fetchAll() as $p) {
            $ctx['people'][] = [(string) $p['id'], (string) $p['name'], (string) $p['email']];
        }
    }
    return $ctx;
}
/**
 * One row read as it would be saved: [values, messages]. Several columns for one field are joined (skills, notes) or
 * the first filled one is used; the reviewer's corrections replace the file's cell.
 */
function impRowVals(string $tk, array $T, array $row, array $map, array $fix, array $opts, array $ctx): array
{
    $raw = [];
    foreach ($map as $ci => $fk) {
        if (!isset($T['f'][$fk])) {
            continue;
        }
        $c = trim((string) ($row[(int) $ci + 1] ?? ''));
        if ($c === '') {
            continue;
        }
        if (($raw[$fk] ?? '') !== '') {
            if (!empty($T['f'][$fk]['multi'])) {
                $raw[$fk] .= ($T['f'][$fk]['t'] === 'long' ? "\n" : ', ') . $c;
            }
        } else {
            $raw[$fk] = $c;
        }
    }
    foreach ($fix as $fk => $fv) {
        if (isset($T['f'][$fk]) && is_scalar($fv)) {
            $raw[$fk] = mb_substr((string) $fv, 0, IMP_CELL);
        }
    }
    $vals = [];
    $msgs = [];
    foreach ($raw as $fk => $rv) {
        [$v, $m] = impNorm($T['f'][$fk], $rv, $ctx);
        if ($v !== '' && $v !== []) {
            $vals[$fk] = $v;
        }
        foreach ($m as [$k, $txt]) {
            $msgs[] = [$k, $fk, $txt];
        }
    }
    // a name in two columns
    $nk = $tk === 'mail' ? 'name' : 'n';
    if (isset($T['f']['first']) && (($vals[$nk] ?? '') === '') && (($vals['first'] ?? '') !== '' || ($vals['last'] ?? '') !== '')) {
        $vals[$nk] = impClip(trim(($vals['first'] ?? '') . ' ' . ($vals['last'] ?? '')), 120);
    }
    unset($vals['first'], $vals['last']);
    // what the import adds to every row
    if (!empty($opts['tags']) && isset($T['f']['tags'])) {
        $extra = array_values(array_filter(array_map(fn($x) => mb_substr(trim($x), 0, 40), explode(',', (string) $opts['tags']))));
        $vals['tags'] = array_values(array_unique(array_merge((array) ($vals['tags'] ?? []), $extra), SORT_REGULAR));
    }
    if ($tk === 'ats') {
        if (($vals['job'] ?? '') === '' && ($opts['job'] ?? '') !== '') {
            $vals['job'] = (string) $opts['job'];
        }
    }
    // what a row needs
    $need = $T['need'];
    $missing = false;
    if ($need === 'n|e') {
        $missing = ($vals['n'] ?? '') === '' && ($vals['e'] ?? '') === '';
        if ($missing) {
            $msgs[] = ['e', 'n', 'No contact name or email'];
        }
    } elseif (($vals[$need] ?? '') === '') {
        $f = $T['f'][$need];
        $why = isset($raw[$need]) && $raw[$need] !== '' ? 'is not usable' : 'is empty';
        $msgs[] = ['e', $need, ($tk === 'mail' ? 'No valid email address' : $f['l'] . ' ' . $why) . ($need === 'n' && isset($T['f']['first']) && $why === 'is empty' ? ' (map a Name column, or First and Last name)' : '')];
    }
    if ($tk === 'cons' && ($vals['ti'] ?? '') === '' && ($vals['n'] ?? '') !== '') {
        $vals['ti'] = 'Consultant';
        $msgs[] = ['n', 'ti', 'no title; saved as "Consultant"'];
    }
    return [$vals, $msgs, $raw];
}

/* ---------------------------------------------------------------- what is already here */

const IMP_WHY = ['email' => 'same email', 'phone' => 'same phone', 'li' => 'same LinkedIn', 'co' => 'same name', 'domain' => 'same website', 'ref' => 'same requisition ID'];
/** Fields kept on the record as they are (the rest are read into something else: a name, a contact, a company). */
function impStored(string $tk, string $fk): bool
{
    if (in_array($fk, ['first', 'last'], true)) {
        return false;
    }
    if ($tk === 'vendor' && in_array($fk, ['cn', 'ce', 'cp', 'ct'], true)) {
        return false;
    }
    if ($tk === 'crm' && in_array($fk, ['co', 'cweb', 'cty', 'cloc'], true)) {
        return false;
    }
    return !($tk === 'ats' && $fk === 'job');
}
/** A record's values for the target's fields (and the vendor's contacts, a contact's company, a candidate's job). */
function impRecVals(string $tk, array $T, $d): array
{
    $d = $d instanceof stdClass ? (array) $d : (array) $d;
    $v = [];
    foreach ($T['f'] as $fk => $f) {
        if (!impStored($tk, $fk) || !array_key_exists($fk, $d)) {
            continue;
        }
        $x = $d[$fk];
        if ($f['t'] === 'list') {
            $v[$fk] = is_array($x) ? array_values(array_map('strval', array_filter($x, 'is_scalar'))) : (is_string($x) ? array_values(array_filter(array_map('trim', explode(',', $x)), fn($t) => $t !== '')) : []);
        } elseif (is_scalar($x) || $x === null) {
            $v[$fk] = $x === null ? '' : $x;
        }
    }
    if ($tk === 'vendor') {
        $v['contacts'] = array_values(array_map(fn($c) => (array) $c, array_filter((array) ($d['contacts'] ?? []), fn($c) => $c instanceof stdClass || is_array($c))));
    }
    if ($tk === 'crm') {
        $v['acc'] = (string) ($d['acc'] ?? '');
    }
    return $v;
}
/** The vendor contact a row carries ([] when none). */
function impContactOf(array $vals): array
{
    $c = ['n' => (string) ($vals['cn'] ?? ''), 'e' => strtolower((string) ($vals['ce'] ?? '')), 'ph' => (string) ($vals['cp'] ?? ''), 'ti' => (string) ($vals['ct'] ?? '')];
    return $c['n'] !== '' || $c['e'] !== '' ? $c : [];
}
function impHasContact(array $list, array $c): bool
{
    foreach ($list as $x) {
        $x = (array) $x;
        if ($c['e'] !== '' ? strtolower((string) ($x['e'] ?? '')) === $c['e'] : impNameKey((string) ($x['n'] ?? '')) === impNameKey($c['n'])) {
            return true;
        }
    }
    return false;
}
/** A row's values in the form the record keeps them (what a later row for the same record is compared with). */
function impAsRecord(string $tk, array $T, array $vals): array
{
    $r = [];
    foreach ($vals as $fk => $v) {
        if (isset($T['f'][$fk]) && impStored($tk, $fk)) {
            $r[$fk] = $v;
        }
    }
    if ($tk === 'vendor') {
        $c = impContactOf($vals);
        $r['contacts'] = $c ? [$c] : [];
    }
    if ($tk === 'crm') {
        $r['acc'] = (string) ($vals['_acc'] ?? '');
    }
    return $r;
}
function impBlank($v): bool
{
    return $v === null || $v === '' || $v === [] || (is_string($v) && trim($v) === '');
}
function impSameVal($a, $b): bool
{
    if (is_numeric($a) && is_numeric($b)) {
        return abs((float) $a - (float) $b) < 0.0001;
    }
    return mb_strtolower(trim((string) (is_array($a) ? implode(', ', $a) : $a))) === mb_strtolower(trim((string) (is_array($b) ? implode(', ', $b) : $b)));
}
/**
 * What an update would change: [changes, kept], each field => [now, then]. Empty cells never erase anything; lists
 * (tags) gain the new items; notes are added below what is there; other fields are filled when empty, and replaced only
 * when the import says so ('over'). A vendor gains a contact it does not have; a contact gains its company.
 */
function impDiff(string $tk, array $T, array $cur, array $vals, string $pol): array
{
    $chg = [];
    $kept = [];
    foreach ($vals as $fk => $nv) {
        if (!isset($T['f'][$fk]) || !impStored($tk, $fk) || impBlank($nv)) {
            continue;
        }
        $f = $T['f'][$fk];
        $cv = $cur[$fk] ?? '';
        if ($f['t'] === 'list') {
            $have = array_map(fn($x) => mb_strtolower((string) $x), (array) $cv);
            $add = array_values(array_filter((array) $nv, fn($x) => !in_array(mb_strtolower((string) $x), $have, true)));
            if ($add) {
                $chg[$fk] = [(array) $cv, array_values(array_merge((array) $cv, $add))];
            }
            continue;
        }
        if (!empty($f['app'])) {
            $c = trim((string) $cv);
            $n = trim((string) $nv);
            if ($c === '' || !str_contains(mb_strtolower($c), mb_strtolower($n))) {
                $chg[$fk] = [$c, impClip($c === '' ? $n : $c . "\n" . $n, max($f['max'], 1))];
            }
            continue;
        }
        // a value the record was found by is the same when its key is ("Acme, LLC" and "Acme LLC", any case of an email)
        $kind = $T['keys'][$fk] ?? '';
        if ($kind !== '' && !impBlank($cv) && impKeyOf($kind, $cv) !== '' && impKeyOf($kind, $cv) === impKeyOf($kind, $nv)) {
            continue;
        }
        if (impBlank($cv)) {
            $chg[$fk] = ['', $nv];
        } elseif (!impSameVal($cv, $nv)) {
            if ($pol === 'over') {
                $chg[$fk] = [$cv, $nv];
            } else {
                $kept[$fk] = [$cv, $nv];
            }
        }
    }
    if ($tk === 'vendor') {
        $c = impContactOf($vals);
        $list = (array) ($cur['contacts'] ?? []);
        if ($c && !impHasContact($list, $c)) {
            $chg['contacts'] = [$list, array_merge($list, [$c])];
        }
    }
    if ($tk === 'crm' && ($vals['_acc'] ?? '') !== '' && $vals['_acc'] !== '#new') {
        $ca = (string) ($cur['acc'] ?? '');
        if ($ca === '') {
            $chg['acc'] = ['', $vals['_acc']];
        } elseif ($ca !== $vals['_acc']) {
            if ($pol === 'over') {
                $chg['acc'] = [$ca, $vals['_acc']];
            } else {
                $kept['acc'] = [$ca, $vals['_acc']];
            }
        }
    }
    return [$chg, $kept];
}
function impApplyChg(array $cur, array $chg): array
{
    foreach ($chg as $fk => [, $to]) {
        $cur[$fk] = $to;
    }
    return $cur;
}
/**
 * What is already here, for matching: rec[id] = [l label, v values, x extras]; by[kind][key] = ids; nm[name key] = ids
 * (people, or requirement titles); co = [company key, id] (for similar names). CRM contacts also get the companies.
 */
function impIndex(string $tk, array $T, array $ctx): array
{
    $ix = ['rec' => [], 'by' => [], 'nm' => [], 'co' => [], 'acc' => [], 'accBy' => []];
    $add = function (string $id, array $v, string $l, array $x = []) use (&$ix, $T) {
        $ix['rec'][$id] = ['l' => $l, 'v' => $v, 'x' => $x];
        foreach ($T['keys'] as $fk => $kind) {
            $k = impKeyOf($kind, $v[$fk] ?? '');
            if ($k !== '') {
                $ix['by'][$kind][$k][] = $id;
            }
        }
        if ($T['likely'] === 'person') {
            $nk = impNameKey((string) ($v['n'] ?? ''));
            if (str_contains($nk, ' ')) {
                $ix['nm'][$nk][] = $id;
            }
        } elseif ($T['likely'] === 'company') {
            $ck = impCoKey((string) ($v['n'] ?? ''));
            if ($ck !== '') {
                $ix['co'][] = [$ck, $id];
            }
        } elseif ($T['likely'] === 'req') {
            $tkey = impKey((string) ($v['ti'] ?? ''));
            if ($tkey !== '') {
                $ix['nm'][$tkey][] = $id;
            }
        }
    };
    if ($tk === 'mail') {
        require_once __DIR__ . '/mail.php';
        foreach (mdb()->query('SELECT id, email, name, company, title, phone, city, tags, notes, source FROM mail_contacts') as $r) {
            $v = ['email' => (string) $r['email'], 'name' => (string) $r['name'], 'company' => (string) $r['company'], 'title' => (string) $r['title'], 'phone' => (string) $r['phone'], 'city' => (string) $r['city'], 'tags' => mailTagsList((string) $r['tags']), 'notes' => (string) $r['notes'], 'source' => (string) $r['source']];
            $add((string) $r['id'], $v, trim($r['name'] . ' <' . $r['email'] . '>', ' <>'));
        }
        return $ix;
    }
    if ($tk === 'crm' || $tk === 'lead') {
        foreach (colAll('crm/main/acc') as [$id, $a]) {
            $nm = (string) ($a->n ?? '');
            $ix['acc'][(string) $id] = $nm;
            $k = impCoKey($nm);
            if ($k !== '') {
                $ix['accBy']['co'][$k][] = (string) $id;
            }
            $dom = impKeyOf('domain', (string) ($a->web ?? ''));
            if ($dom !== '') {
                $ix['accBy']['domain'][$dom][] = (string) $id;
            }
        }
    }
    $jobs = [];
    foreach ($ctx['jobs'] ?? [] as $j) {
        $jobs[$j['id']] = $j['ti'];
    }
    foreach (colAll($T['col']) as [$id, $d]) {
        $id = (string) $id;
        $v = impRecVals($tk, $T, $d);
        $x = [];
        switch ($tk) {
            case 'ats':
                $x = ['job' => (string) ($d->job ?? ''), 'pool' => empty($d->job), 'u' => (int) ($d->u ?? 0)];
                $l = (string) ($d->n ?? '') . ' · ' . (!empty($d->job) ? ((string) ($d->jt ?? '') ?: ($jobs[(string) $d->job] ?? 'a job')) : 'talent pool');
                break;
            case 'cons':
                $l = trim((string) ($d->n ?? '') . ' · ' . (string) ($d->ti ?? ''), ' ·');
                break;
            case 'req':
                $x = ['open' => !in_array((string) ($d->st ?? 'open'), ['closed', 'dismissed', 'filled'], true)];
                $l = implode(' · ', array_filter([(string) ($d->ti ?? ''), (string) ($d->cl ?? '') ?: (string) ($d->vn ?? ''), (string) ($d->loc ?? '')]));
                break;
            case 'crm':
                $l = trim((string) ($d->n ?? '') . ' · ' . ($ix['acc'][(string) ($d->acc ?? '')] ?? ''), ' ·');
                break;
            case 'lead':
                $l = trim((string) ($d->n ?? '') . ' · ' . (string) ($d->co ?? ''), ' ·');
                break;
            default:
                $l = (string) ($d->n ?? $id);
        }
        $add($id, $v, $l !== '' ? $l : $id, $x);
    }
    return $ix;
}
function impSimilar(string $a, string $b): bool
{
    $la = strlen($a);
    $lb = strlen($b);
    if (min($la, $lb) < 4 || $la > 200 || $lb > 200) {
        return false;
    }
    if ((str_contains($a, $b) || str_contains($b, $a)) && min($la, $lb) / max($la, $lb) >= 0.5) {
        return true;
    }
    return abs($la - $lb) <= 2 && levenshtein($a, $b) <= max(1, intdiv(min($la, $lb), 8));
}
/** Records that are surely the same (same email, phone, LinkedIn, name of a company, requisition ID): id => why. */
function impStrong(string $tk, array $T, array $vals, array $ix, array &$also): array
{
    $hits = [];
    foreach ($T['keys'] as $fk => $kind) {
        $k = impKeyOf($kind, $vals[$fk] ?? '');
        if ($k === '') {
            continue;
        }
        foreach ($ix['by'][$kind][$k] ?? [] as $id) {
            if (isset($hits[$id])) {
                continue;
            }
            $rec = $ix['rec'][$id];
            if ($tk === 'ats') {
                // one record per person and job: the same person for another job is a new application
                $job = (string) ($vals['job'] ?? '');
                if ($job !== '' && $rec['x']['job'] !== $job) {
                    $also[$id] = $rec['l'];
                    continue;
                }
            }
            if ($tk === 'req') {
                // a requisition ID is the vendor's own number: another vendor's requisition is another requirement
                $a = impCoKey((string) ($vals['vn'] ?? ''));
                $b = impCoKey((string) ($rec['v']['vn'] ?? ''));
                if ($a !== '' && $b !== '' && $a !== $b) {
                    continue;
                }
            }
            $hits[$id] = IMP_WHY[$kind];
        }
    }
    if ($tk === 'ats' && ($vals['job'] ?? '') === '' && count($hits) > 1) {
        // into the talent pool: the person's pool record first, then the one changed last
        uksort($hits, fn($a, $b) => [(int) $ix['rec'][$b]['x']['pool'], $ix['rec'][$b]['x']['u']] <=> [(int) $ix['rec'][$a]['x']['pool'], $ix['rec'][$a]['x']['u']]);
    }
    return $hits;
}
/** Records that may be the same (same name and place, a similar company name...): [[id, why]], at most 3. */
function impLikely(string $tk, array $T, array $vals, array $ix, array $skip): array
{
    $out = [];
    if ($T['likely'] === 'person') {
        $nk = impNameKey((string) ($vals['n'] ?? ''));
        if (!str_contains($nk, ' ')) {
            return [];
        }
        $city = impCityKey((string) ($vals['loc'] ?? ''));
        $org = impCoKey((string) ($vals['co'] ?? $vals['emp'] ?? ''));
        foreach ($ix['nm'][$nk] ?? [] as $id) {
            if (isset($skip[$id])) {
                continue;
            }
            $r = $ix['rec'][$id]['v'];
            $why = 'same name';
            if ($city !== '' && $city === impCityKey((string) ($r['loc'] ?? ''))) {
                $why = 'same name and city';
            } elseif (($vals['ti'] ?? '') !== '' && impKey((string) $vals['ti']) === impKey((string) ($r['ti'] ?? ''))) {
                $why = 'same name and title';
            } elseif ($org !== '' && $org === impCoKey((string) ($r['co'] ?? $r['emp'] ?? ($ix['acc'][(string) ($r['acc'] ?? '')] ?? '')))) {
                $why = 'same name and company';
            }
            $out[] = [$id, $why];
        }
    } elseif ($T['likely'] === 'company') {
        $ck = impCoKey((string) ($vals['n'] ?? ''));
        if ($ck !== '' && count($ix['co']) <= 3000) {
            foreach ($ix['co'] as [$k, $id]) {
                if (!isset($skip[$id]) && $k !== $ck && impSimilar($ck, $k)) {
                    $out[] = [$id, 'similar name'];
                }
                if (count($out) >= 3) {
                    break;
                }
            }
        }
    } elseif ($T['likely'] === 'req') {
        $tkey = impKey((string) ($vals['ti'] ?? ''));
        $who = impCoKey((string) (($vals['cl'] ?? '') !== '' ? $vals['cl'] : ($vals['vn'] ?? '')));
        $city = impCityKey((string) ($vals['loc'] ?? ''));
        foreach ($ix['nm'][$tkey] ?? [] as $id) {
            $rec = $ix['rec'][$id];
            if (isset($skip[$id]) || empty($rec['x']['open'])) {
                continue;
            }
            $rw = impCoKey((string) (($rec['v']['cl'] ?? '') !== '' ? $rec['v']['cl'] : ($rec['v']['vn'] ?? '')));
            if ($who === '' || $rw !== $who) {
                continue;
            }
            $out[] = [$id, $city !== '' && $city === impCityKey((string) ($rec['v']['loc'] ?? '')) ? 'same title, client and place (open)' : 'same title and client (open)'];
        }
    }
    return array_slice($out, 0, 3);
}

/* ---------------------------------------------------------------- the dry run */

function impPolicy(array $opts): string
{
    return in_array($opts['upd'] ?? '', ['fill', 'over', 'skip'], true) ? (string) $opts['upd'] : 'fill';
}
/**
 * Every row as the import would treat it. A row: i, ln (line in the file), a (new | upd | same | merge | skip | err),
 * id (the record it updates), to (the earlier row it repeats), dup (matches: id, label, why, strong), m (messages), v
 * (values), raw (what was read), chg / kept (an update's changes and the differences it leaves), co (a contact's
 * company), why (why a row is skipped). Counts: by action, likely duplicates, rows with warnings.
 */
function impPlan(string $tk, array $T, array $D, array $rows, array $ctx, array $ix): array
{
    $map = (array) ($D['map'] ?? []);
    $fixes = (array) ($D['fixes'] ?? []);
    $acts = (array) ($D['acts'] ?? []);
    $opts = (array) ($D['opts'] ?? []);
    $pol = impPolicy($opts);
    $out = [];
    $fileKey = [];
    $state = [];
    $coFile = [];
    $vendors = $ctx['vendors'] ?? null;
    $cnt = ['all' => 0, 'new' => 0, 'upd' => 0, 'same' => 0, 'merge' => 0, 'skip' => 0, 'err' => 0, 'likely' => 0, 'warn' => 0, 'fixed' => 0];
    foreach ($rows as $i => $row) {
        $fix = (array) ($fixes[$i] ?? $fixes[(string) $i] ?? []);
        [$vals, $msgs, $raw] = impRowVals($tk, $T, $row, $map, $fix, $opts, $ctx);
        $dec = (string) ($acts[$i] ?? $acts[(string) $i] ?? '');
        $p = ['i' => $i, 'ln' => (int) ($row[0] ?? 0), 'a' => 'new', 'id' => '', 'to' => -1, 'dup' => [], 'm' => $msgs, 'v' => $vals, 'raw' => $raw, 'dec' => $dec, 'chg' => [], 'kept' => [], 'why' => '', 'fx' => $fix ? 1 : 0];
        $errs = array_values(array_filter($msgs, fn($x) => $x[0] === 'e'));
        if ($tk === 'req' && ($vals['vn'] ?? '') !== '' && is_array($vendors)) {
            $vk = impCoKey((string) $vals['vn']);
            if (isset($vendors[$vk])) {
                $p['v']['vid'] = $vendors[$vk][0];
                $vals['vid'] = $vendors[$vk][0];
            } else {
                $p['m'][] = ['n', 'vn', '"' . $vals['vn'] . '" is not under Vendors & clients; kept as a name'];
            }
        }
        if ($dec === 'skip') {
            $p['a'] = 'skip';
            $p['why'] = 'You chose to skip this row';
        } elseif ($errs) {
            $p['a'] = 'err';
            $p['why'] = $errs[0][2];
        } else {
            // a CRM contact's company: one already in the CRM, one an earlier row adds, or a new one
            if ($tk === 'crm' && ($vals['co'] ?? '') !== '') {
                $ck = impCoKey((string) $vals['co']);
                $dom = impKeyOf('domain', (string) ($vals['cweb'] ?? '')) ?: impKeyOf('domain', (string) ($vals['e'] ?? ''));
                $acc = ($ix['accBy']['co'][$ck] ?? [])[0] ?? (($dom !== '' ? ($ix['accBy']['domain'][$dom] ?? []) : [])[0] ?? '');
                if ($acc !== '') {
                    $p['co'] = ['a' => 'link', 'id' => $acc, 'l' => $ix['acc'][$acc] ?? $vals['co']];
                    $vals['_acc'] = $acc;
                } elseif (isset($coFile[$ck])) {
                    $p['co'] = ['a' => 'same', 'row' => $coFile[$ck], 'l' => $vals['co'], 'k' => $ck];
                    $vals['_acc'] = '#new';
                } else {
                    $p['co'] = ['a' => 'new', 'l' => $vals['co'], 'k' => $ck];
                    $vals['_acc'] = '#new';
                    $coFile[$ck] = $i;
                }
            }
            $keys = [];
            foreach ($T['keys'] as $fk => $kind) {
                $k = impKeyOf($kind, $vals[$fk] ?? '');
                if ($k !== '') {
                    // one record per person and job (ATS); a requisition ID belongs to its vendor
                    $keys[] = $kind . ':' . $k . ($tk === 'ats' ? '|' . ($vals['job'] ?? '') : '') . ($tk === 'req' ? '|' . impCoKey((string) ($vals['vn'] ?? '')) : '');
                }
            }
            $also = [];
            $hits = impStrong($tk, $T, $vals, $ix, $also);
            $likely = $hits ? [] : impLikely($tk, $T, $vals, $ix, []);
            foreach ($hits as $id => $why) {
                $p['dup'][] = ['id' => (string) $id, 'l' => $ix['rec'][$id]['l'], 'why' => $why, 's' => 1];
            }
            foreach ($likely as [$id, $why]) {
                $p['dup'][] = ['id' => (string) $id, 'l' => $ix['rec'][$id]['l'], 'why' => $why, 's' => 0];
            }
            if ($also && !$hits) {
                $p['m'][] = ['n', '', 'also in the ATS: ' . implode('; ', array_slice(array_values($also), 0, 2))];
            }
            $to = -1;
            foreach ($keys as $k) {
                if (isset($fileKey[$k])) {
                    $to = $fileKey[$k];
                    break;
                }
            }
            $ids = array_column($p['dup'], 'id');
            if ($dec === 'new') {
                $p['a'] = 'new';
            } elseif (str_starts_with($dec, 'upd:') && in_array(substr($dec, 4), $ids, true)) {
                $p['a'] = 'upd';
                $p['id'] = substr($dec, 4);
            } elseif ($to >= 0) {
                $first = $out[$to];
                if ($first['a'] === 'new') {
                    $p['a'] = 'merge';
                    $p['to'] = $to;
                } else {
                    $p['a'] = 'upd';
                    $p['id'] = $first['id'];
                    $p['to'] = $to;
                }
            } elseif ($hits) {
                $p['id'] = (string) array_key_first($hits);
                if ($pol === 'skip') {
                    $p['a'] = 'skip';
                    $p['why'] = 'Already here (' . $hits[$p['id']] . '): ' . $ix['rec'][$p['id']]['l'];
                } else {
                    $p['a'] = 'upd';
                }
            }
            if ($p['a'] === 'upd') {
                $cur = $state['id:' . $p['id']] ?? ($ix['rec'][$p['id']]['v'] ?? null);
                if ($cur === null) {
                    $p['a'] = 'new';
                    $p['id'] = '';
                } else {
                    [$p['chg'], $p['kept']] = impDiff($tk, $T, $cur, $vals, $pol);
                    if (!$p['chg']) {
                        $p['a'] = 'same';
                    }
                    $state['id:' . $p['id']] = impApplyChg($cur, $p['chg']);
                }
            }
            if ($p['a'] === 'merge') {
                $base = $state['row:' . $p['to']] ?? impAsRecord($tk, $T, $out[$p['to']]['v']);
                [$p['chg'], $p['kept']] = impDiff($tk, $T, $base, $vals, $pol);
                $state['row:' . $p['to']] = impApplyChg($base, $p['chg']);
            }
            if ($p['a'] === 'new') {
                $state['row:' . $i] = impAsRecord($tk, $T, $vals);
            }
            if (in_array($p['a'], ['new', 'upd', 'same', 'merge'], true)) {
                foreach ($keys as $k) {
                    $fileKey[$k] ??= $p['a'] === 'merge' ? $p['to'] : $i;
                }
            }
            $p['v'] = $vals;
        }
        // A manual edit only counts as "Fixed by hand" after the row actually passes validation and has a
        // writable action. For example, an Email contact that still has no valid email remains a Problem.
        $p['fx'] = $fix && in_array($p['a'], ['new', 'upd', 'same', 'merge'], true) ? 1 : 0;
        $out[$i] = $p;
        $cnt['all']++;
        $cnt[$p['a']]++;
        if (in_array($p['a'], ['new', 'upd', 'same'], true) && array_filter($p['dup'], fn($d) => !$d['s'])) {
            $cnt['likely']++;
        }
        if (array_filter($p['m'], fn($x) => $x[0] === 'w')) {
            $cnt['warn']++;
        }
        if ($p['fx']) {
            $cnt['fixed']++;
        }
    }
    return [$out, $cnt];
}
/** A value as the screens show it. */
function impShow(string $tk, array $T, string $fk, $v, array $ix = []): string
{
    if (is_array($v)) {
        if ($fk === 'contacts') {
            return implode('; ', array_map(fn($c) => trim(((array) $c)['n'] ?? '') . (((array) $c)['e'] ?? '') !== '' ? trim((((array) $c)['n'] ?? '') . ' ' . ((((array) $c)['e'] ?? '') !== '' ? '<' . ((array) $c)['e'] . '>' : '')) : '', $v));
        }
        return implode(', ', array_map('strval', $v));
    }
    if ($fk === 'acc') {
        return (string) ($ix['acc'][(string) $v] ?? ($v === '#new' ? 'a new company' : (string) $v));
    }
    $f = $T['f'][$fk] ?? null;
    if ($f && $f['t'] === 'choice' && isset($f['o'][(string) $v])) {
        return (string) $f['o'][(string) $v];
    }
    if ($f && $f['t'] === 'job') {
        return (string) $v;
    }
    return mb_substr((string) $v, 0, 140);
}
function impLabelOf(array $T, string $fk): string
{
    return $fk === 'contacts' ? 'Contacts' : ($fk === 'acc' ? 'Company' : (string) ($T['f'][$fk]['l'] ?? $fk));
}
/** One planned row as the check screen shows it. */
function impRowView(string $tk, array $T, array $p, array $out, array $ix, array $ctx): array
{
    // the main field first (empty when the row has none: "no name"), then the others the row has
    $show = [];
    foreach ($T['show'] as $k => $fk) {
        $has = ($p['v'][$fk] ?? '') !== '' && ($p['v'][$fk] ?? []) !== [];
        if ($has || $k === 0) {
            $show[] = $has ? impShow($tk, $T, $fk, $p['v'][$fk], $ix) : '';
        }
    }
    $pairs = fn(array $list) => array_map(fn($fk, $x) => [impLabelOf($T, (string) $fk), impShow($tk, $T, (string) $fk, $x[0], $ix), impShow($tk, $T, (string) $fk, $x[1], $ix)], array_keys($list), array_values($list));
    $chg = [];
    foreach ($p['chg'] as $fk => [$from, $to]) {
        $f = $T['f'][$fk] ?? [];
        if (!impBlank($from) && ($f['t'] ?? '') === 'list') {
            // tags: the ones added (the others stay)
            $chg[] = [impLabelOf($T, (string) $fk), impShow($tk, $T, (string) $fk, $from, $ix), implode(', ', array_slice((array) $to, count((array) $from))), 'add'];
        } elseif (!impBlank($from) && !empty($f['app'])) {
            // notes: the text added below what is there
            $chg[] = [impLabelOf($T, (string) $fk), mb_substr((string) $from, 0, 80), mb_substr(ltrim(mb_substr((string) $to, mb_strlen((string) $from))), 0, 140), 'add'];
        } else {
            $chg[] = [impLabelOf($T, (string) $fk), impShow($tk, $T, (string) $fk, $from, $ix), impShow($tk, $T, (string) $fk, $to, $ix)];
        }
    }
    if ($tk === 'vendor' && isset($p['chg']['contacts'])) {
        $new = array_slice((array) $p['chg']['contacts'][1], count((array) $p['chg']['contacts'][0]));
        foreach ($chg as $k => $c) {
            if ($c[0] === 'Contacts') {
                $chg[$k] = ['Contacts', '', 'adds ' . impShow($tk, $T, 'contacts', $new)];
            }
        }
    }
    $job = '';
    if ($tk === 'ats' && ($p['v']['job'] ?? '') !== '') {
        foreach ($ctx['jobs'] ?? [] as $j) {
            if ($j['id'] === $p['v']['job']) {
                $job = $j['ti'] . ($j['code'] !== '' ? ' (' . $j['code'] . ')' : '');
            }
        }
    }
    return [
        'i' => $p['i'], 'ln' => $p['ln'], 'a' => $p['a'], 'id' => $p['id'], 'dec' => $p['dec'], 'fx' => $p['fx'],
        'to' => $p['to'], 'toLn' => $p['to'] >= 0 ? $out[$p['to']]['ln'] ?? 0 : 0,
        'show' => $show, 'why' => $p['why'], 'job' => $job,
        'm' => array_map(fn($x) => [$x[0], $x[1] !== '' ? impLabelOf($T, $x[1]) : '', $x[2]], $p['m']),
        'dup' => $p['dup'], 'chg' => $chg, 'kept' => $pairs($p['kept']),
        'co' => $p['co'] ?? null,
        'raw' => $p['raw'],
        'lbl' => $p['id'] !== '' ? ($ix['rec'][$p['id']]['l'] ?? '') : '',
    ];
}

/* ---------------------------------------------------------------- writing */

function impSeq(string $path): int
{
    $r = docRow($path);
    return $r ? (int) $r['seq'] : 0;
}
function impLogC(string $run, int $i, int $n, string $ref, int $seq, string $note = ''): void
{
    impDb()->prepare('REPLACE INTO imp_log (run, i, n, act, ref, seq, prev) VALUES (?,?,?,?,?,?,?)')->execute([$run, $i, $n, 'c', $ref, $seq, $note]);
}
/** An update: the values before and after, for undo. A record this import created keeps only its creation entry (undo deletes it), with the newest version number. */
function impLogU(string $run, int $i, int $n, string $ref, int $seq, array $before, array $after): void
{
    $p = impDb();
    $s = $p->prepare('SELECT i, n, act, prev FROM imp_log WHERE run = ? AND ref = ? ORDER BY i, n LIMIT 1');
    $s->execute([$run, $ref]);
    $e = $s->fetch();
    if ($e && $e['act'] === 'c') {
        $p->prepare('UPDATE imp_log SET seq = ? WHERE run = ? AND i = ? AND n = ?')->execute([$seq, $run, $e['i'], $e['n']]);
        return;
    }
    if ($e) {
        $pv = (array) json_decode((string) $e['prev'], true);
        $b = (array) ($pv['b'] ?? []);
        foreach ($before as $k => $v) {
            if (!array_key_exists($k, $b)) {
                $b[$k] = $v;
            }
        }
        $a = array_merge((array) ($pv['a'] ?? []), $after);
        $p->prepare('UPDATE imp_log SET seq = ?, prev = ? WHERE run = ? AND i = ? AND n = ?')->execute([$seq, json_encode(['b' => $b, 'a' => $a], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $run, $e['i'], $e['n']]);
        return;
    }
    $p->prepare('INSERT INTO imp_log (run, i, n, act, ref, seq, prev) VALUES (?,?,?,?,?,?,?)')->execute([$run, $i, $n, 'u', $ref, $seq, json_encode(['b' => $before, 'a' => $after], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
}
/** A value as the record keeps it. */
function impStoreVal(string $tk, string $fk, $v)
{
    if ($tk === 'cons' && $fk === 'exp') {
        return is_numeric($v) ? rtrim(rtrim(number_format((float) $v, 1, '.', ''), '0'), '.') : (string) $v;
    }
    if ($tk === 'ats' && $fk === 'exp') {
        return is_numeric($v) ? (float) $v : null;
    }
    if ($tk === 'req' && $fk === 'n') {
        return max(1, min(99, (int) $v));
    }
    if ($tk === 'lead' && $fk === 'v') {
        return is_numeric($v) ? (float) $v : null;
    }
    return $v;
}
function impStr(array $v, string $k): string
{
    return is_scalar($v[$k] ?? null) ? (string) $v[$k] : '';
}
/** A new record from a row; returns its id. Logged for undo. */
function impCreate(string $tk, array $T, array $p, array $ctx, string $run, array $u, array $opts, array &$cache): string
{
    $v = $p['v'];
    $now = now();
    $uname = (string) ($u['name'] ?? '');
    $doc = [];
    foreach ($v as $fk => $x) {
        if (isset($T['f'][$fk]) && impStored($tk, $fk)) {
            $doc[$fk] = impStoreVal($tk, $fk, $x);
        }
    }
    switch ($tk) {
        case 'mail':
            require_once __DIR__ . '/mail.php';
            $id = rid(8);
            mdb()->prepare('INSERT INTO mail_contacts (id, email, name, company, title, phone, city, tags, source, notes, created, updated, by_uid, last_sent) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0)')->execute([
                $id, impStr($v, 'email'), impStr($v, 'name'), impStr($v, 'company'), impStr($v, 'title'), impStr($v, 'phone'), impStr($v, 'city'),
                mailTagsNorm((array) ($v['tags'] ?? [])), mb_substr(impStr($v, 'source') ?: 'Import', 0, 80), impStr($v, 'notes'), $now, $now, $u['id'],
            ]);
            impLogC($run, $p['i'], 0, 'mail:' . $id, $now);
            return $id;
        case 'ats':
            $job = (string) ($v['job'] ?? '');
            $pub = $job !== '' ? docGet('org/site/jobs/' . $job) : null;
            $doc = array_merge(['n' => '', 'e' => '', 'ph' => '', 'ti' => '', 'sk' => '', 'loc' => '', 'auth' => '', 'exp' => null, 'li' => '', 'tags' => [], 'msg' => ''], $doc, [
                'src' => impStr($v, 'src') !== '' ? impStr($v, 'src') : ((string) ($opts['src'] ?? '') ?: 'Import'),
                'job' => $job, 'jt' => $pub ? (string) ($pub->ti ?? '') : '', 'st' => 'new', 'pool' => $job === '', 'rating' => 0, 'notes' => [],
                'at' => $now, 'stAt' => $now, 'u' => $now, 'by' => $u['id'],
                'log' => [['t' => $now, 'who' => $uname, 'ev' => 'Imported']],
            ]);
            $id = rid(6);
            break;
        case 'cons':
            $st = impStr($v, 'st') !== '' ? impStr($v, 'st') : 'active';
            $doc = array_merge(['n' => '', 'ti' => 'Consultant', 'e' => '', 'ph' => '', 'sk' => '', 'loc' => '', 'auth' => '', 'rate' => '', 'exp' => '', 'notes' => ''], $doc, [
                'st' => $st, 'src' => impStr($v, 'src') !== '' ? impStr($v, 'src') : 'Import', 'tags' => (array) ($v['tags'] ?? []),
                'by' => $u['id'], 'byn' => $uname, 'own' => $u['id'], 'ownn' => $uname, 'benchSince' => in_array($st, ['active', 'working'], true) ? date('Y-m-d') : '',
                'at' => $now, 'u' => $now, 'un' => $uname,
            ]);
            $id = substr(rid(6), 0, 9) . substr(base_convert((string) time(), 10, 36), -5);
            break;
        case 'vendor':
            $c = impContactOf($v);
            $doc = array_merge(['n' => '', 'type' => 'Prime vendor', 'site' => '', 'loc' => '', 'terms' => 'Net 30', 'pays' => '', 'payNotes' => '', 'rates' => '', 'notes' => '', 'msaSt' => 'none', 'msaDate' => ''], $doc, [
                'contacts' => $c ? [$c] : [], 'tok' => rid(7), 'at' => $now, 'by' => $u['id'], 'u' => $now,
            ]);
            $id = substr(rid(6), 0, 9) . substr(base_convert((string) time(), 10, 36), -5);
            break;
        case 'client':
            $doc = array_merge(['n' => '', 'ec' => '', 'loc' => '', 'notes' => ''], $doc, ['at' => $now, 'by' => $u['id'], 'u' => $now]);
            $id = rid(10);
            break;
        case 'req':
            require_once __DIR__ . '/vms.php';
            $f = vmsReqFields($v + ['md' => 'Onsite']);
            $prof = vmsReqProfile($f);
            $doc = array_merge($f, ['src' => 'import', 'st' => impStr($v, 'st') !== '' ? impStr($v, 'st') : 'open', 'skills' => $prof['skills'], 'by' => $u['id'], 'at' => $now, 'u' => $now]);
            if (impStr($v, 'vref') !== '') {
                $doc['vref'] = impStr($v, 'vref');
            }
            $id = vmsNid();
            break;
        case 'crmco':
            $sts = $ctx['lists']['statuses'] ?? ['Active', 'Prospect'];
            $doc = array_merge(['n' => '', 'ty' => '', 'web' => '', 'loc' => '', 'ind' => '', 'notes' => '', 'src' => ''], $doc, [
                'st' => impStr($v, 'st') !== '' ? impStr($v, 'st') : (in_array('Prospect', $sts, true) ? 'Prospect' : (string) ($sts[0] ?? 'Prospect')),
                'own' => impStr($v, 'own') !== '' ? impStr($v, 'own') : $u['id'], 'e' => '', 'ph' => '', 'at' => $now, 'by' => $u['id'], 'u' => $now,
            ]);
            $id = rid(10);
            break;
        case 'crm':
            $acc = impCrmCompany($p, $ctx, $run, $u, $cache);
            $doc = array_merge(['n' => impStr($v, 'n') !== '' ? impStr($v, 'n') : impStr($v, 'e'), 'ti' => '', 'e' => '', 'ph' => '', 'rel' => '', 'notes' => '', 'src' => ''], $doc, ['acc' => $acc, 'at' => $now, 'by' => $u['id'], 'u' => $now]);
            if ($doc['n'] === '') {
                $doc['n'] = impStr($v, 'e');
            }
            $id = rid(10);
            break;
        case 'lead':
            $doc = array_merge(['n' => '', 'co' => '', 'ti' => '', 'e' => '', 'ph' => '', 'src' => '', 'need' => '', 'v' => null, 'ind' => '', 'loc' => '', 'notes' => ''], $doc, [
                'st' => impStr($v, 'st') !== '' ? impStr($v, 'st') : 'New', 'own' => impStr($v, 'own') !== '' ? impStr($v, 'own') : $u['id'],
                'at' => $now, 'by' => $u['id'], 'u' => $now,
            ]);
            $id = rid(10);
            break;
        default:
            return '';
    }
    $doc['imp'] = $run;
    $path = $T['col'] . '/' . $id;
    docSet($path, json_decode(json_encode($doc, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE)));
    impLogC($run, $p['i'], $tk === 'crm' ? 1 : 0, $path, impSeq($path));
    return $id;
}
/** The CRM company a contact row belongs to: found, created by an earlier row of this import, or created now. */
function impCrmCompany(array $p, array $ctx, string $run, array $u, array &$cache): string
{
    $co = $p['co'] ?? null;
    if (!$co) {
        return '';
    }
    if ($co['a'] === 'link') {
        return (string) $co['id'];
    }
    $k = (string) $co['k'];
    if (isset($cache['co'][$k])) {
        return $cache['co'][$k];
    }
    $s = impDb()->prepare("SELECT ref FROM imp_log WHERE run = ? AND act = 'c' AND prev = ? LIMIT 1");
    $s->execute([$run, 'co:' . $k]);
    $ref = $s->fetchColumn();
    if ($ref !== false && docRow((string) $ref)) {
        return $cache['co'][$k] = substr((string) $ref, strlen('crm/main/acc/'));
    }
    // an existing company with that name (added since the check, or by another import)
    foreach (colAll('crm/main/acc') as [$id, $a]) {
        if (impCoKey((string) ($a->n ?? '')) === $k) {
            return $cache['co'][$k] = (string) $id;
        }
    }
    $v = $p['v'];
    $now = now();
    $sts = $ctx['lists']['statuses'] ?? ['Prospect'];
    $id = rid(10);
    $path = 'crm/main/acc/' . $id;
    docSet($path, (object) ['n' => impStr($v, 'co'), 'ty' => impStr($v, 'cty'), 'st' => in_array('Prospect', $sts, true) ? 'Prospect' : (string) ($sts[0] ?? 'Prospect'), 'own' => $u['id'], 'ind' => '', 'web' => impStr($v, 'cweb'), 'loc' => impStr($v, 'cloc'), 'e' => '', 'ph' => '', 'notes' => '', 'src' => impStr($v, 'src'), 'at' => $now, 'by' => $u['id'], 'u' => $now, 'imp' => $run]);
    impLogC($run, $p['i'], 0, $path, impSeq($path), 'co:' . $k);
    return $cache['co'][$k] = $id;
}
/** Applies a row to a record that is already there (read again now, so a change made since the check is respected). */
function impUpdate(string $tk, array $T, string $id, array $p, array $ctx, string $run, array $u, string $pol, array &$cache): string
{
    $v = $p['v'];
    if ($tk === 'crm' && ($v['_acc'] ?? '') === '#new') {
        $v['_acc'] = impCrmCompany($p, $ctx, $run, $u, $cache);
    }
    $now = now();
    if ($tk === 'mail') {
        require_once __DIR__ . '/mail.php';
        $s = mdb()->prepare('SELECT * FROM mail_contacts WHERE id = ?');
        $s->execute([$id]);
        $r = $s->fetch();
        if (!$r) {
            return 'gone';
        }
        $cur = ['email' => (string) $r['email'], 'name' => (string) $r['name'], 'company' => (string) $r['company'], 'title' => (string) $r['title'], 'phone' => (string) $r['phone'], 'city' => (string) $r['city'], 'tags' => mailTagsList((string) $r['tags']), 'notes' => (string) $r['notes'], 'source' => (string) $r['source']];
        [$chg] = impDiff($tk, $T, $cur, $v, $pol);
        unset($chg['email'], $chg['source']);
        if (!$chg) {
            return 'same';
        }
        $new = impApplyChg($cur, $chg);
        mdb()->prepare('UPDATE mail_contacts SET name = ?, company = ?, title = ?, phone = ?, city = ?, tags = ?, notes = ?, updated = ? WHERE id = ?')->execute([
            mb_substr((string) $new['name'], 0, 190), mb_substr((string) $new['company'], 0, 190), mb_substr((string) $new['title'], 0, 190), mb_substr((string) $new['phone'], 0, 60), mb_substr((string) $new['city'], 0, 120), mailTagsNorm((array) $new['tags']), mb_substr((string) $new['notes'], 0, 2000), $now, $id,
        ]);
        $b = [];
        $a = [];
        foreach ($chg as $fk => [$from, $to]) {
            $b[$fk] = $fk === 'tags' ? mailTagsNorm((array) $from) : $from;
            $a[$fk] = $fk === 'tags' ? mailTagsNorm((array) $to) : $to;
        }
        impLogU($run, $p['i'], 0, 'mail:' . $id, $now, $b, $a);
        return 'upd';
    }
    $path = $T['col'] . '/' . $id;
    $d = docGet($path);
    if (!$d) {
        return 'gone';
    }
    $cur = impRecVals($tk, $T, $d);
    [$chg] = impDiff($tk, $T, $cur, $v, $pol);
    if (!$chg) {
        return 'same';
    }
    $before = [];
    $after = [];
    foreach ($chg as $fk => [, $to]) {
        $sv = impStoreVal($tk, (string) $fk, $to);
        $before[$fk] = property_exists($d, (string) $fk) ? $d->$fk : null;
        $after[$fk] = json_decode(json_encode($sv, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE), true);
        $d->$fk = json_decode(json_encode($sv, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE));
    }
    if ($tk === 'req' && array_intersect(array_keys($chg), ['ti', 'sk', 'd', 'loc'])) {
        require_once __DIR__ . '/vms.php';
        $d->skills = vmsReqProfile((array) $d)['skills'];
    }
    if ($tk === 'ats') {
        $log = (array) ($d->log ?? []);
        $log[] = (object) ['t' => $now, 'who' => (string) ($u['name'] ?? ''), 'ev' => 'Updated from an import'];
        $d->log = array_slice($log, -200);
    }
    if ($tk === 'cons') {
        $d->un = (string) ($u['name'] ?? '');
    }
    $d->u = $now;
    docSet($path, $d);
    impLogU($run, $p['i'], $tk === 'crm' ? 1 : 0, $path, impSeq($path), $before, $after);
    return 'upd';
}
/** One planned row written: 'new' | 'upd' | 'same' | 'gone' (the record was deleted meanwhile) | '' (nothing to do). */
function impWriteRow(string $tk, array $T, array $p, array $ctx, string $run, array $u, array $opts, array &$cache): string
{
    $pol = impPolicy($opts);
    switch ($p['a']) {
        case 'new':
            return impCreate($tk, $T, $p, $ctx, $run, $u, $opts, $cache) !== '' ? 'new' : '';
        case 'upd':
            return impUpdate($tk, $T, (string) $p['id'], $p, $ctx, $run, $u, $pol, $cache);
        case 'merge':
            // the record the earlier row of this file created
            $s = impDb()->prepare("SELECT ref FROM imp_log WHERE run = ? AND i = ? AND act = 'c' ORDER BY n DESC");
            $s->execute([$run, (int) $p['to']]);
            $pre = $tk === 'mail' ? 'mail:' : $T['col'] . '/';
            $id = '';
            foreach ($s->fetchAll(PDO::FETCH_COLUMN) as $ref) {
                if (str_starts_with((string) $ref, $pre)) {
                    $id = substr((string) $ref, strlen($pre));
                    break;
                }
            }
            if ($id === '') {
                // the row it repeats was not written: this one is written in its place
                return impCreate($tk, $T, $p, $ctx, $run, $u, $opts, $cache) !== '' ? 'new' : '';
            }
            $r = impUpdate($tk, $T, $id, $p, $ctx, $run, $u, $pol, $cache);
            return $r === 'upd' ? 'merge' : $r;
    }
    return '';
}

/* ---------------------------------------------------------------- undo */

/**
 * Undo an import: what it created is deleted unless it changed since (or has files, notes or records under it); the
 * values it replaced are put back field by field unless that field changed since. Newest first, 200 entries per
 * transaction; each entry done is crossed off, so a big undo on a slow host continues where it stopped ([counts, more]).
 */
function impUndo(array $run, array $T, array $u, int $budget = 20): array
{
    $p = impDb();
    $res = ['removed' => 0, 'restored' => 0, 'kept' => 0, 'gone' => 0];
    $until = microtime(true) + $budget;
    $next = $p->prepare('SELECT i, n, act, ref, seq, prev FROM imp_log WHERE run = ? ORDER BY i DESC, n DESC LIMIT 200');
    for (;;) {
        $next->execute([$run['id']]);
        $part = $next->fetchAll();
        $next->closeCursor();
        if (!$part) {
            return [$res, false];
        }
        if (microtime(true) > $until) {
            return [$res, true];
        }
        dbBatch(function () use ($part, &$res, $p, $run) {
            $done = $p->prepare('DELETE FROM imp_log WHERE run = ? AND i = ? AND n = ?');
            foreach ($part as $e) {
                $done->execute([$run['id'], $e['i'], $e['n']]);
                $ref = (string) $e['ref'];
                if (str_starts_with($ref, 'mail:')) {
                    require_once __DIR__ . '/mail.php';
                    $id = substr($ref, 5);
                    $q = mdb()->prepare('SELECT * FROM mail_contacts WHERE id = ?');
                    $q->execute([$id]);
                    $r = $q->fetch();
                    if (!$r) {
                        $res['gone']++;
                        continue;
                    }
                    if ($e['act'] === 'c') {
                        if ((int) $r['updated'] === (int) $e['seq']) {
                            mdb()->prepare('DELETE FROM mail_contacts WHERE id = ?')->execute([$id]);
                            $res['removed']++;
                        } else {
                            $res['kept']++;
                        }
                        continue;
                    }
                    $pv = (array) json_decode((string) $e['prev'], true);
                    if ((int) $r['updated'] !== (int) $e['seq']) {
                        $res['kept']++;
                        continue;
                    }
                    $set = [];
                    $args = [];
                    foreach ((array) ($pv['b'] ?? []) as $k => $v) {
                        if (in_array($k, ['name', 'company', 'title', 'phone', 'city', 'tags', 'notes'], true)) {
                            $set[] = $k . ' = ?';
                            $args[] = (string) $v;
                        }
                    }
                    if ($set) {
                        $args[] = now();
                        $args[] = $id;
                        mdb()->prepare('UPDATE mail_contacts SET ' . implode(', ', $set) . ', updated = ? WHERE id = ?')->execute($args);
                    }
                    $res['restored']++;
                    continue;
                }
                $row = docRow($ref);
                if (!$row) {
                    $res['gone']++;
                    continue;
                }
                if ($e['act'] === 'c') {
                    // records under it (files, notes): every path that starts with "<ref>/" sorts between "<ref>/" and "<ref>0"
                    $kids = $p->prepare('SELECT 1 FROM docs WHERE path > ? AND path < ? LIMIT 1');
                    $kids->execute([$ref . '/', $ref . '0']);
                    $used = false;
                    if (str_starts_with($ref, 'crm/main/acc/')) {
                        // a company someone linked a contact, an opportunity or a follow-up to stays
                        $aid = substr($ref, 13);
                        $q = $p->prepare("SELECT 1 FROM docs WHERE col IN ('crm/main/con', 'crm/main/deal', 'crm/main/act') AND data LIKE ? LIMIT 1");
                        $q->execute(['%"acc":"' . $aid . '"%']);
                        $used = (bool) $q->fetchColumn();
                    }
                    if ((int) $row['seq'] === (int) $e['seq'] && !$kids->fetchColumn() && !$used) {
                        docDelete($ref);
                        $res['removed']++;
                    } else {
                        $res['kept']++;
                    }
                    continue;
                }
                $pv = (array) json_decode((string) $e['prev'], true);
                $cur = json_decode((string) $row['data'], true);
                if (!is_array($cur)) {
                    $res['gone']++;
                    continue;
                }
                $put = 0;
                $skipped = 0;
                foreach ((array) ($pv['a'] ?? []) as $k => $after) {
                    if (json_encode($cur[$k] ?? null) === json_encode($after)) {
                        $b = ($pv['b'] ?? [])[$k] ?? null;
                        if ($b === null) {
                            unset($cur[$k]);
                        } else {
                            $cur[$k] = $b;
                        }
                        $put++;
                    } else {
                        $skipped++;
                    }
                }
                if ($put) {
                    $cur['u'] = now();
                    docSet($ref, json_decode(json_encode($cur, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)));
                    $res['restored']++;
                }
                if ($skipped) {
                    $res['kept']++;
                }
            }
        });
    }
}

/* ---------------------------------------------------------------- routes */

/** The person's view of a run: the file, its sheets and columns, the choices made so far, and how the import went. */
function impView(array $r, array $u, bool $full = true): array
{
    $D = $r['data'];
    $T = impTargets()[$r['tgt']];
    $sheet = (int) ($D['sheet'] ?? 0);
    $out = [
        'id' => $r['id'], 't' => $r['tgt'], 'tn' => $T['n'], 'st' => $r['st'], 'at' => (int) $r['at'], 'who' => (string) ($D['who'] ?? ''), 'mine' => $r['uid'] === $u['id'],
        'file' => (string) ($D['file'] ?? ''), 'paste' => !empty($D['paste']), 'sheets' => (array) ($D['sheets'] ?? []), 'sheet' => $sheet, 'hrow' => (int) ($D['hrow'] ?? 0),
        'map' => (object) ($D['map'] ?? []), 'opts' => (object) ($D['opts'] ?? []), 'fixes' => (object) ($D['fixes'] ?? []), 'acts' => (object) ($D['acts'] ?? []),
        'total' => (int) ($D['total'] ?? 0), 'cur' => (int) ($D['cur'] ?? 0), 'res' => (object) ($D['res'] ?? []), 'undo' => $D['undo'] ?? null, 'purged' => !empty($D['purged']),
        'n' => (int) ($D['n'] ?? 0), 'endAt' => (int) ($D['endAt'] ?? 0),
    ];
    $out['canUndo'] = in_array($r['st'], ['done', 'running', 'undoing'], true) && empty($D['purged']) && impMay($r['tgt'], $u);
    $out['canGo'] = $r['st'] === 'running' && (int) ($D['cur'] ?? 0) < (int) ($D['total'] ?? 0) && impMay($r['tgt'], $u);
    if ($full && $r['st'] === 'draft' && empty($D['purged'])) {
        $rows = impSheetRows($r['id'], $sheet);
        $out['cols'] = impColumns($rows, $out['hrow']);
        $out['rows'] = max(0, count($rows) - $out['hrow'] - 1);
        // the opening rows as they are in the file, to pick the row with the headings
        $out['top'] = array_map(fn($x) => array_map(fn($c) => mb_substr((string) $c, 0, 40), array_slice((array) $x, 0, 9)), array_slice($rows, 0, 8));
    }
    return $out;
}
function impLearned(string $tk): array
{
    $l = impRowsGet('learn', $tk, 0);
    return is_array($l) ? $l : [];
}
/** Remembers the headings this team matched (a next file with the same headings is matched the same way). */
function impLearn(string $tk, array $cols, array $map): void
{
    $l = impLearned($tk);
    foreach ($cols as $c) {
        if (!$c['hd']) {
            continue;
        }
        $h = impNormHead($c['h']);
        if ($h === '') {
            continue;
        }
        if (isset($map[$c['i']])) {
            $l[$h] = $map[$c['i']];
        } elseif (isset($l[$h])) {
            unset($l[$h]); // left out on purpose this time
        }
    }
    impRowsPut('learn', $tk, 0, array_slice($l, -400, null, true));
}
/** The choices the screens send, cleaned: column => field, options, corrections by row, decisions by row. */
function impChoices(array $b, array $T, array $cols, int $nrows, string $tk): array
{
    $valid = array_flip(array_column($cols, 'i'));
    $map = [];
    $used = [];
    foreach ((array) ($b['map'] ?? []) as $ci => $fk) {
        $ci = (int) $ci;
        $fk = (string) $fk;
        if (!isset($valid[$ci]) || !isset($T['f'][$fk])) {
            continue;
        }
        if (isset($used[$fk]) && empty($T['f'][$fk]['multi'])) {
            continue;
        }
        $map[$ci] = $fk;
        $used[$fk] = true;
    }
    $o = (array) ($b['opts'] ?? []);
    $opts = ['upd' => impPolicy($o), 'dates' => ($o['dates'] ?? '') === 'dmy' ? 'dmy' : 'mdy'];
    if (in_array('tags', $T['opts'], true)) {
        $opts['tags'] = mb_substr(trim((string) ($o['tags'] ?? '')), 0, 300);
    }
    if (in_array('job', $T['opts'], true)) {
        $opts['job'] = preg_match('/^[A-Za-z0-9_\-]{1,40}$/', (string) ($o['job'] ?? '')) ? (string) $o['job'] : '';
    }
    if (in_array('src', $T['opts'], true)) {
        $opts['src'] = mb_substr(trim((string) ($o['src'] ?? '')), 0, 60);
    }
    $fixes = [];
    foreach (array_slice((array) ($b['fixes'] ?? []), 0, 3000, true) as $i => $fx) {
        $i = (int) $i;
        if ($i < 0 || $i >= $nrows || !is_array($fx)) {
            continue;
        }
        foreach ($fx as $fk => $v) {
            if (isset($T['f'][$fk]) && is_scalar($v)) {
                $fixes[$i][$fk] = mb_substr((string) $v, 0, IMP_CELL);
            }
        }
    }
    $acts = [];
    foreach (array_slice((array) ($b['acts'] ?? []), 0, IMP_MAX_ROWS, true) as $i => $a) {
        $i = (int) $i;
        $a = (string) $a;
        if ($i >= 0 && $i < $nrows && preg_match('/^(new|skip|upd:[A-Za-z0-9_\-]{1,40})$/', $a)) {
            $acts[$i] = $a;
        }
    }
    return [$map, $opts, $fixes, $acts];
}
/** The data rows of a draft (under its heading row) and its columns. */
function impDraftRows(array $r): array
{
    $D = $r['data'];
    $all = impSheetRows($r['id'], (int) ($D['sheet'] ?? 0));
    $hrow = min((int) ($D['hrow'] ?? 0), max(0, count($all) - 1));
    $cols = impColumns($all, $hrow);
    return [array_slice($all, $hrow + 1, IMP_MAX_ROWS), $cols, $all];
}
function impCsvCell($v): string
{
    $v = (string) $v;
    return '"' . str_replace('"', '""', preg_match('/^[=+\-@\t\r]/', $v) ? "'" . $v : $v) . '"';
}
function impRoute(string $r, array $b): never
{
    $u = requireUser();
    switch ($r) {
        case 'imp_targets':
            $out = [];
            foreach (impAllowed($u) as $tk) {
                $T = impTargets()[$tk];
                $fields = [];
                foreach ($T['f'] as $fk => $f) {
                    $fields[] = ['k' => $fk, 'l' => $f['l'], 't' => $f['t'], 'multi' => !empty($f['multi']), 'h' => (string) ($f['h'] ?? ''), 'o' => isset($f['o']) ? array_values($f['o']) : []];
                }
                $out[] = ['k' => $tk, 'n' => $T['n'], 'one' => $T['one'], 'many' => $T['many'], 'hint' => $T['hint'], 'ico' => $T['ico'], 'page' => $T['page'], 'mpage' => (string) ($T['mpage'] ?? ''), 'need' => $T['need'], 'opts' => $T['opts'], 'f' => $fields];
            }
            $jobs = [];
            if (in_array('ats', impAllowed($u), true)) {
                foreach (impCtx('ats', [], $u)['jobs'] as $j) {
                    $jobs[] = $j;
                }
                usort($jobs, fn($a, $b) => ($b['open'] <=> $a['open']) ?: ($b['at'] <=> $a['at']));
            }
            ok(['targets' => $out, 'jobs' => array_slice($jobs, 0, 300), 'limits' => ['rows' => IMP_MAX_ROWS, 'mb' => 12, 'draft' => IMP_KEEP_DRAFT, 'keep' => IMP_KEEP_DONE]]);

        case 'imp_upload':
            // a file (multipart: t + file) or pasted rows (t + text)
            $tk = (string) ($_POST['t'] ?? ($b['t'] ?? ''));
            $T = impTarget($tk, $u);
            if (throttleHit('imp:' . $u['id'], 40, 3600)) {
                fail(429, 'rate_limited', 'That is a lot of imports in an hour. Try again a little later.');
            }
            impCleanup();
            $paste = false;
            if (!empty($_FILES['file']) && is_array($_FILES['file']) && !is_array($_FILES['file']['name'] ?? null)) {
                $f = $_FILES['file'];
                $name = mb_substr(basename((string) $f['name']), 0, 180);
                $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
                if (($f['error'] ?? 1) !== UPLOAD_ERR_OK || !is_file((string) $f['tmp_name'])) {
                    fail(400, 'invalid_argument', ($f['error'] ?? 0) === UPLOAD_ERR_INI_SIZE || ($f['error'] ?? 0) === UPLOAD_ERR_FORM_SIZE ? 'The file is larger than this server accepts (12 MB). Split it, or save it as CSV, which is smaller.' : 'The upload did not complete. Try again.');
                }
                if (in_array($ext, ['xls', 'ods', 'numbers'], true)) {
                    fail(400, 'invalid_argument', 'A .' . $ext . ' file cannot be read here. Open it and save it as Excel (.xlsx) or CSV.');
                }
                if (!in_array($ext, ['csv', 'tsv', 'txt', 'xlsx'], true)) {
                    fail(400, 'invalid_argument', 'Choose a spreadsheet: Excel (.xlsx), CSV or a tab-separated text file.');
                }
                if ((int) $f['size'] > 12 * 1048576) {
                    fail(400, 'invalid_argument', 'The file is larger than 12 MB. Split it into smaller files.');
                }
                $tmp = (string) $f['tmp_name'];
                require_once __DIR__ . '/guard.php';
                $check = $tmp;
                $conv = '';
                if ($ext !== 'xlsx') {
                    // text in UTF-16 (Excel's "Unicode text") is screened as the text it is
                    $raw = (string) file_get_contents($tmp);
                    $text = impUtf8($raw);
                    if ($text !== $raw) {
                        $conv = tempnam(sys_get_temp_dir(), 'imp');
                        file_put_contents($conv, $text);
                        $check = $conv;
                    }
                }
                $why = guardUpload($check, $ext === 'tsv' ? 'rows.txt' : $name);
                if ($why !== '') {
                    if ($conv !== '') {
                        @unlink($conv);
                    }
                    fail(400, 'invalid_argument', $why);
                }
                $sheets = $ext === 'xlsx' ? impXlsx($tmp) : [['n' => '', 'hidden' => false, 'rows' => impCsv(isset($text) ? $text : impUtf8((string) file_get_contents($tmp)), $ext === 'tsv' ? "\t" : ''), 'more' => false]];
                if ($conv !== '') {
                    @unlink($conv);
                }
                $size = (int) $f['size'];
            } else {
                $text = (string) ($b['text'] ?? '');
                if (trim($text) === '') {
                    fail(400, 'invalid_argument', 'Choose a file, or paste the rows (with their headings) first.');
                }
                if (strlen($text) > 3 * 1048576) {
                    fail(400, 'invalid_argument', 'That is more text than can be pasted (3 MB). Save it as a file and upload it instead.');
                }
                $paste = true;
                $name = 'Pasted rows';
                $size = strlen($text);
                $sheets = [['n' => '', 'hidden' => false, 'rows' => impCsv(impUtf8($text), str_contains(strtok($text, "\n") ?: '', "\t") ? "\t" : ''), 'more' => false]];
            }
            ok(impView(impRun(impRunFromSheets($u, $tk, $T, $sheets, $name, $size, $paste), $u), $u));

        case 'imp_get':
            ok(impView(impRun(str($b, 'id', 30), $u), $u));

        case 'imp_set':
            // another sheet, or another row for the headings: the columns are matched again
            $run = impRun(str($b, 'id', 30), $u);
            if ($run['st'] !== 'draft') {
                fail(409, 'conflict', 'This file was already imported.');
            }
            $T = impTarget($run['tgt'], $u);
            $D = $run['data'];
            $sheet = (int) ($b['sheet'] ?? $D['sheet'] ?? 0);
            if ($sheet < 0 || $sheet >= count((array) $D['sheets'])) {
                fail(400, 'invalid_argument', 'No such sheet.');
            }
            $all = impSheetRows($run['id'], $sheet);
            $hrow = array_key_exists('hrow', $b) && $sheet === (int) ($D['sheet'] ?? 0) ? max(-1, min((int) $b['hrow'], min(30, max(0, count($all) - 2)))) : impHeadRow($all);
            $cols = impColumns($all, $hrow);
            $D['sheet'] = $sheet;
            $D['hrow'] = $hrow;
            $D['map'] = (object) impGuess($run['tgt'], $T, $cols, array_slice($all, $hrow + 1, 80), impLearned($run['tgt']));
            $D['fixes'] = (object) [];
            $D['acts'] = (object) [];
            $D['n'] = max(0, count($all) - $hrow - 1);
            impRunSave($run['id'], $D);
            $run['data'] = $D;
            ok(impView($run, $u));

        case 'imp_check':
        case 'imp_go':
            $run = impRun(str($b, 'id', 30), $u);
            if ($run['st'] !== 'draft') {
                fail(409, 'conflict', 'This file was already imported. Open it under Past imports.');
            }
            $tk = $run['tgt'];
            $T = impTarget($tk, $u);
            [$rows, $cols] = impDraftRows($run);
            [$map, $opts, $fixes, $acts] = impChoices($b, $T, $cols, count($rows), $tk);
            $D = $run['data'];
            $D['map'] = (object) $map;
            $D['opts'] = (object) $opts;
            $D['fixes'] = (object) $fixes;
            $D['acts'] = (object) $acts;
            $ctx = impCtx($tk, $opts, $u);
            if ($tk === 'req') {
                $ctx['vendors'] = [];
                foreach (colAll('vms/vendor/items') as [$vid, $v]) {
                    $k = impCoKey((string) ($v->n ?? ''));
                    if ($k !== '') {
                        $ctx['vendors'][$k] ??= [(string) $vid, (string) ($v->n ?? '')];
                    }
                }
            }
            $ix = impIndex($tk, $T, $ctx);
            [$plan, $cnt] = impPlan($tk, $T, ['map' => $map, 'opts' => $opts, 'fixes' => $fixes, 'acts' => $acts], $rows, $ctx, $ix);
            // what a mapping still needs
            $need = '';
            $has = array_flip(array_values($map));
            $nf = $T['need'];
            if ($nf === 'n|e') {
                if (!isset($has['n']) && !isset($has['e']) && !isset($has['first']) && !isset($has['last'])) {
                    $need = 'Match a column to Contact name or Email.';
                }
            } elseif (!isset($has[$nf]) && !($nf === 'n' && (isset($has['first']) || isset($has['last'])))) {
                $need = 'Match a column to ' . $T['f'][$nf]['l'] . ($nf === 'n' && isset($T['f']['first']) ? ' (or to First name and Last name)' : '') . '.';
            }
            if ($r === 'imp_check') {
                impRunSave($run['id'], $D);
                $flt = str($b, 'f', 10) ?: 'all';
                $q = mb_strtolower(trim(str($b, 'q', 80)));
                $sel = array_values(array_filter($plan, function ($p) use ($flt, $q) {
                    $ok = match ($flt) {
                        'new' => $p['a'] === 'new',
                        'upd' => $p['a'] === 'upd' || $p['a'] === 'merge',
                        'same' => $p['a'] === 'same',
                        'skip' => $p['a'] === 'skip',
                        'err' => $p['a'] === 'err',
                        'likely' => in_array($p['a'], ['new', 'upd', 'same'], true) && (bool) array_filter($p['dup'], fn($d) => !$d['s']),
                        'warn' => (bool) array_filter($p['m'], fn($x) => $x[0] === 'w'),
                        'fixed' => (bool) $p['fx'],
                        default => true,
                    };
                    if (!$ok || $q === '') {
                        return $ok;
                    }
                    return str_contains(mb_strtolower(implode(' ', array_map(fn($v) => is_array($v) ? implode(' ', $v) : (string) $v, $p['raw']))), $q) || (string) $p['ln'] === $q;
                }));
                $per = 50;
                $pages = max(1, (int) ceil(count($sel) / $per));
                $pg = max(1, min($pages, (int) ($b['pg'] ?? 1)));
                $view = array_map(fn($p) => impRowView($tk, $T, $p, $plan, $ix, $ctx), array_slice($sel, ($pg - 1) * $per, $per));
                // the problems most rows share, to fix at once (in the file or with a mapping)
                $issues = [];
                foreach ($plan as $p) {
                    foreach ($p['m'] as [$k, $fk, $txt]) {
                        if ($k === 'n') {
                            continue;
                        }
                        $key = $k . '|' . $fk . '|' . preg_replace("/'[^']*'/", "'…'", $txt);
                        $issues[$key] ??= ['k' => $k, 'f' => $fk !== '' ? impLabelOf($T, $fk) : '', 't' => (string) preg_replace("/'[^']*' /", '', $txt), 'n' => 0, 'ln' => $p['ln']];
                        $issues[$key]['n']++;
                    }
                }
                usort($issues, fn($a, $b) => [$a['k'] === 'e' ? 0 : 1, -$a['n']] <=> [$b['k'] === 'e' ? 0 : 1, -$b['n']]);
                ok(['cnt' => $cnt, 'rows' => $view, 'n' => count($sel), 'pg' => $pg, 'pages' => $pages, 'need' => $need, 'issues' => array_slice(array_values($issues), 0, 8), 'pol' => $opts['upd']]);
            }
            // imp_go: the plan is fixed now and written in steps
            if ($need !== '') {
                fail(400, 'invalid_argument', $need);
            }
            $todo = $cnt['new'] + $cnt['upd'] + $cnt['merge'];
            if ($todo === 0) {
                fail(400, 'invalid_argument', 'Nothing to import: every row is skipped, has a problem or is already up to date.');
            }
            $taken = impDb()->prepare("UPDATE imp_runs SET st = 'running', lk = 0 WHERE id = ? AND st = 'draft'");
            $taken->execute([$run['id']]);
            if ($taken->rowCount() !== 1) {
                fail(409, 'conflict', 'This file is already being imported.');
            }
            $keep = [];
            $problems = [];
            foreach ($plan as $p) {
                if (in_array($p['a'], ['new', 'upd', 'merge'], true)) {
                    $keep[] = ['i' => $p['i'], 'ln' => $p['ln'], 'a' => $p['a'], 'id' => $p['id'], 'to' => $p['to'], 'v' => $p['v'], 'co' => $p['co'] ?? null];
                } elseif ($p['a'] === 'err' || $p['a'] === 'skip') {
                    $problems[] = [$p['i'], $p['why']];
                }
            }
            dbBatch(function () use ($run, $keep, $problems) {
                impDb()->prepare("DELETE FROM imp_rows WHERE run = ? AND kind IN ('p', 'x')")->execute([$run['id']]);
                foreach (array_chunk($keep, IMP_STEP) as $k => $part) {
                    impRowsPut($run['id'], 'p', $k, $part);
                }
                impRowsPut($run['id'], 'x', 0, $problems);
            });
            impLearn($tk, $cols, $map);
            $D['total'] = count($keep);
            $D['cur'] = 0;
            $D['plan'] = $cnt;
            $D['res'] = ['new' => 0, 'upd' => 0, 'merge' => 0, 'same' => 0, 'gone' => 0, 'fail' => 0, 'skip' => $cnt['skip'], 'err' => $cnt['err'], 'dup' => $cnt['same']];
            $D['startAt'] = now();
            impRunSave($run['id'], $D, 'running');
            ok(['total' => count($keep), 'cnt' => $cnt]);

        case 'imp_step':
            // the next 200 rows, in one transaction; a second window cannot run the same step
            $run = impRun(str($b, 'id', 30), $u);
            if ($run['st'] !== 'running') {
                ok(['done' => true, 'run' => impView($run, $u)]);
            }
            $tk = $run['tgt'];
            $T = impTarget($tk, $u);
            $now = now();
            $lock = impDb()->prepare("UPDATE imp_runs SET lk = ? WHERE id = ? AND st = 'running' AND lk < ?");
            $lock->execute([$now + 120000, $run['id'], $now]);
            if ($lock->rowCount() !== 1) {
                fail(409, 'busy', 'This import is being written in another window. Wait for it there.');
            }
            $D = $run['data'];
            $cur = (int) ($D['cur'] ?? 0);
            $k = intdiv($cur, IMP_STEP);
            $part = impRowsGet($run['id'], 'p', $k);
            $opts = (array) ($D['opts'] ?? []);
            $ctx = impCtx($tk, $opts, $u);
            $res = (array) ($D['res'] ?? []);
            $fails = [];
            $cache = [];
            if (function_exists('set_time_limit')) {
                @set_time_limit(120);
            }
            try {
                dbBatch(function () use ($part, $tk, $T, $ctx, $run, $u, $opts, &$res, &$fails, &$cache) {
                    foreach ($part as $p) {
                        try {
                            $got = impWriteRow($tk, $T, $p, $ctx, $run['id'], $u, $opts, $cache);
                        } catch (Throwable $e) {
                            if (db()->inTransaction() === false) {
                                throw $e;
                            }
                            @error_log(date('c') . ' import row failed: ' . $e->getMessage() . "\n", 3, storeDir() . '/error.log');
                            $got = 'fail';
                        }
                        if ($got === 'gone') {
                            $fails[] = [$p['i'], 'The record was deleted while the import ran'];
                        } elseif ($got === 'fail') {
                            $fails[] = [$p['i'], 'Could not be saved (see System health › error log)'];
                        }
                        $key = $got === '' ? 'same' : $got;
                        $res[$key] = (int) ($res[$key] ?? 0) + 1;
                    }
                });
            } catch (Throwable $e) {
                impDb()->prepare('UPDATE imp_runs SET lk = 0 WHERE id = ?')->execute([$run['id']]);
                @error_log(date('c') . ' import step failed: ' . $e->getMessage() . "\n", 3, storeDir() . '/error.log');
                fail(503, 'unavailable', 'This part of the import could not be saved (nothing of it was kept). Try again; the import continues where it stopped.');
            }
            if ($fails) {
                impRowsPut($run['id'], 'x', $k + 1, $fails);
            }
            $D['cur'] = min((int) $D['total'], $cur + count($part));
            if (!$part) {
                $D['cur'] = (int) $D['total'];
            }
            $D['res'] = $res;
            $done = $D['cur'] >= (int) $D['total'];
            if ($done) {
                $D['endAt'] = now();
                audit('data', 'Import finished', $T['n'], ['file' => mb_substr((string) $D['file'], 0, 80), 'run' => $run['id'], 'added' => (int) ($res['new'] ?? 0), 'updated' => (int) ($res['upd'] ?? 0) + (int) ($res['merge'] ?? 0), 'skipped' => (int) ($res['skip'] ?? 0) + (int) ($res['err'] ?? 0), 'failed' => (int) ($res['fail'] ?? 0) + (int) ($res['gone'] ?? 0)], $u);
            }
            impRunSave($run['id'], $D, $done ? 'done' : 'running');
            impDb()->prepare('UPDATE imp_runs SET lk = 0 WHERE id = ?')->execute([$run['id']]);
            $run['st'] = $done ? 'done' : 'running';
            $run['data'] = $D;
            ok(['done' => $done, 'cur' => $D['cur'], 'total' => $D['total'], 'res' => $res, 'run' => $done ? impView($run, $u) : null]);

        case 'imp_runs':
            impCleanup();
            $all = hasRole($u, 'admin') && !empty($b['all']);
            $s = impDb()->prepare('SELECT * FROM imp_runs' . ($all ? '' : ' WHERE uid = ?') . ' ORDER BY at DESC LIMIT 60');
            $s->execute($all ? [] : [$u['id']]);
            $out = [];
            foreach ($s->fetchAll() as $r) {
                if (!isset(impTargets()[$r['tgt']])) {
                    continue;
                }
                $r['data'] = (array) json_decode((string) $r['data'], true);
                $v = impView($r, $u, false);
                unset($v['map'], $v['fixes'], $v['acts']);
                $out[] = $v;
            }
            ok(['runs' => $out, 'admin' => hasRole($u, 'admin')]);

        case 'imp_undo':
            $run = impRun(str($b, 'id', 30), $u);
            $T = impTarget($run['tgt'], $u);
            if (!in_array($run['st'], ['done', 'running', 'undoing'], true) || !empty($run['data']['purged'])) {
                fail(409, 'conflict', $run['st'] === 'undone' || $run['st'] === 'partundone' ? 'This import was already undone.' : 'This import can no longer be undone.');
            }
            // one undo at a time (and not while a step is being written); an undo that stopped part way continues
            $lock = impDb()->prepare("UPDATE imp_runs SET st = 'undoing', lk = ? WHERE id = ? AND st IN ('done', 'running', 'undoing') AND lk < ?");
            $lock->execute([now() + 120000, $run['id'], now()]);
            if ($lock->rowCount() !== 1) {
                fail(409, 'busy', 'This import is being written or undone right now. Try again in a minute.');
            }
            $D = $run['data'];
            if (function_exists('set_time_limit')) {
                @set_time_limit(120);
            }
            try {
                [$part, $more] = impUndo($run, $T, $u);
            } catch (Throwable $e) {
                impDb()->prepare('UPDATE imp_runs SET lk = 0 WHERE id = ?')->execute([$run['id']]);
                throw $e;
            }
            $res = (array) ($D['undoing'] ?? ['removed' => 0, 'restored' => 0, 'kept' => 0, 'gone' => 0]);
            foreach ($part as $k => $n) {
                $res[$k] = (int) ($res[$k] ?? 0) + $n;
            }
            if ($more) {
                $D['undoing'] = $res;
                impRunSave($run['id'], $D, 'undoing');
                impDb()->prepare('UPDATE imp_runs SET lk = 0 WHERE id = ?')->execute([$run['id']]);
                ok(['more' => true, 'res' => $res]);
            }
            unset($D['undoing']);
            $D['undo'] = $res + ['at' => now(), 'by' => (string) $u['name']];
            impRunSave($run['id'], $D, $res['kept'] > 0 ? 'partundone' : 'undone');
            impDb()->prepare('UPDATE imp_runs SET lk = 0 WHERE id = ?')->execute([$run['id']]);
            audit('data', 'Import undone', $T['n'], ['run' => $run['id'], 'file' => mb_substr((string) ($D['file'] ?? ''), 0, 80)] + $res, $u);
            $run['st'] = $res['kept'] > 0 ? 'partundone' : 'undone';
            $run['data'] = $D;
            ok(['res' => $res, 'run' => impView($run, $u)]);

        case 'imp_problems':
            // the rows that were not imported, with why, as a CSV to fix and import again
            $run = impRun(str($b, 'id', 30), $u);
            if (!empty($run['data']['purged'])) {
                fail(410, 'gone', 'The file of this import was removed after ' . IMP_KEEP_DONE . ' days.');
            }
            $why = [];
            foreach (impRowsGet($run['id'], 'x') as [$i, $w]) {
                $why[(int) $i] = (string) $w;
            }
            $all = impSheetRows($run['id'], (int) ($run['data']['sheet'] ?? 0));
            $hrow = (int) ($run['data']['hrow'] ?? 0);
            $w = max(0, ...array_map(fn($x) => count($x) - 1, $all ?: [[0]]));
            $head = $hrow >= 0 ? array_slice($all[$hrow] ?? [0], 1) : array_map('impColName', range(0, max(0, $w - 1)));
            $lines = [implode(',', array_map('impCsvCell', array_merge(['Row'], array_pad($head, $w, ''), ['Not imported because'])))];
            foreach (array_slice($all, $hrow + 1) as $i => $row) {
                if (isset($why[$i])) {
                    $lines[] = implode(',', array_map('impCsvCell', array_merge([(string) $row[0]], array_pad(array_slice($row, 1), $w, ''), [$why[$i]])));
                }
            }
            ok(['csv' => "\u{FEFF}" . implode("\r\n", $lines) . "\r\n", 'name' => preg_replace('/\.[^.]+$/', '', (string) ($run['data']['file'] ?? 'import')) . '-not-imported.csv', 'n' => count($lines) - 1]);

        case 'imp_template':
            // the columns of a kind of record, with one example row, for people starting a spreadsheet from scratch
            $tk = str($b, 't', 12);
            $T = impTarget($tk, $u);
            $ex = [
                'ats' => ['n' => 'Priya Sharma', 'e' => 'priya.sharma@example.com', 'ph' => '(555) 123-4567', 'ti' => 'Senior Java Developer', 'sk' => 'Java, Spring Boot, AWS', 'loc' => 'Dallas, TX', 'auth' => 'H-1B', 'exp' => '8', 'li' => 'https://www.linkedin.com/in/example', 'src' => 'LinkedIn', 'tags' => 'Hot, Local', 'msg' => 'Available in 2 weeks', 'job' => ''],
                'cons' => ['n' => 'Rahul Verma', 'ti' => 'SAP FICO Consultant', 'e' => 'rahul.verma@example.com', 'ph' => '(555) 987-6543', 'li' => '', 'sk' => 'SAP FICO, S/4HANA', 'auth' => 'H-1B', 'exp' => '10', 'rate' => '$75/hr C2C', 'loc' => 'Edison, NJ', 'reloc' => 'Open', 'avail' => 'Immediately', 'emp' => '', 'src' => 'Referral', 'notes' => '', 'tags' => 'sap, bench', 'st' => 'Available'],
                'vendor' => ['n' => 'Example Staffing LLC', 'type' => 'Prime vendor', 'site' => 'example.com', 'loc' => 'Austin, TX', 'terms' => 'Net 30', 'pays' => 'Pays on time', 'rates' => '', 'notes' => '', 'cn' => 'Alex Kim', 'ce' => 'alex.kim@example.com', 'cp' => '(555) 222-3333', 'ct' => 'Account manager'],
                'client' => ['n' => 'Example Corp', 'ec' => '', 'loc' => 'Chicago, IL', 'site' => 'example.com', 'notes' => ''],
                'req' => ['ti' => 'Data Engineer', 'vref' => 'REQ-1042', 'cl' => 'Example Bank', 'ec' => '', 'vn' => 'Example Staffing LLC', 'loc' => 'Charlotte, NC', 'md' => 'Hybrid', 'ty' => 'C2C', 'rate' => '$70/hr', 'dur' => '12 months', 'n' => '2', 'sd' => '2026-11-02', 'sk' => 'Python, Spark, AWS', 'visa' => 'Any', 'd' => 'Builds data pipelines...', 'cn' => 'Alex Kim', 'ce' => 'alex.kim@example.com', 'cp' => '', 'st' => 'Open'],
                'crmco' => ['n' => 'Example Corp', 'ty' => 'End client', 'st' => 'Prospect', 'ind' => 'IT services', 'web' => 'https://example.com', 'loc' => 'Chicago, IL', 'own' => '', 'src' => 'Referral', 'notes' => ''],
                'crm' => ['n' => 'Jordan Lee', 'ti' => 'Director of Engineering', 'e' => 'jordan.lee@example.com', 'ph' => '(555) 444-5555', 'rel' => 'Hiring manager', 'co' => 'Example Corp', 'cweb' => 'https://example.com', 'cty' => 'End client', 'cloc' => 'Chicago, IL', 'src' => 'LinkedIn', 'notes' => ''],
                'lead' => ['n' => 'Sam Patel', 'co' => 'Example Health', 'ti' => 'VP Technology', 'e' => 'sam.patel@example.com', 'ph' => '', 'src' => 'Website', 'st' => 'New', 'own' => '', 'need' => '2 Salesforce developers, remote', 'v' => '120000', 'ind' => 'Healthcare', 'loc' => 'Boston, MA', 'notes' => ''],
                'mail' => ['email' => 'jordan.lee@example.com', 'name' => 'Jordan Lee', 'company' => 'Example Corp', 'title' => 'Director of Engineering', 'phone' => '', 'city' => 'Chicago', 'tags' => 'clients', 'notes' => '', 'source' => 'Conference'],
            ][$tk] ?? [];
            $head = [];
            $row = [];
            foreach ($T['f'] as $fk => $f) {
                if (in_array($fk, ['first', 'last'], true)) {
                    continue;
                }
                $head[] = $f['l'];
                $row[] = $ex[$fk] ?? '';
            }
            ok(['csv' => "\u{FEFF}" . implode(',', array_map('impCsvCell', $head)) . "\r\n" . implode(',', array_map('impCsvCell', $row)) . "\r\n", 'name' => strtolower(preg_replace('/[^A-Za-z]+/', '-', $T['many'])) . '-template.csv']);

        case 'imp_drop':
            // a file never imported is removed; for an import, its file rows and undo information are removed early
            $run = impRun(str($b, 'id', 30), $u);
            if ($run['st'] === 'running' || $run['st'] === 'undoing') {
                fail(409, 'conflict', $run['st'] === 'undoing' ? 'Finish the undo first (Undo again continues it).' : 'Finish or undo the import first.');
            }
            impDb()->prepare('DELETE FROM imp_rows WHERE run = ?')->execute([$run['id']]);
            impDb()->prepare('DELETE FROM imp_log WHERE run = ?')->execute([$run['id']]);
            if ($run['st'] === 'draft') {
                impDb()->prepare('DELETE FROM imp_runs WHERE id = ?')->execute([$run['id']]);
            } else {
                $D = $run['data'];
                $D['purged'] = true;
                impRunSave($run['id'], $D);
            }
            ok(['ok' => true]);
    }
    fail(404, 'not_found', 'Unknown action.');
}
