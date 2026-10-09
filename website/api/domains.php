<?php
declare(strict_types=1);
/*
 * v68 Domain recognition on resumes.
 *
 * Every resume the portal holds (ATS candidates, the consultant database, the consultants and employees in the
 * portals) is read for its technology domains (Java, .NET, SAP, Salesforce, data engineering, cloud, DevOps, QA,
 * mainframe, ...) and its industry domains (banking, capital markets, insurance, healthcare, pharma, retail, telecom,
 * manufacturing, government, ...): the terms found, how often, the years behind them (from the dated jobs the talent
 * index already reads) and a score. The result is kept on the index row and on the record itself (ats/<id>.dom,
 * rec/cand/items/<id>.dom, u/<uid>.dom), so every page that shows the person can show the domains; the talent search
 * filters by them. A domain is recognized from evidence on the resume only: a term named once is not a domain.
 */

/** Technology domains: key => [name, [terms]]. Terms are matched on the normalized text (tsNorm): lower case, symbols spelled out. */
const DOM_TECH = [
    'java' => ['Java', ['java', 'spring boot', 'springboot', 'spring framework', 'spring mvc', 'spring batch', 'spring security', 'spring cloud', 'hibernate', 'j2ee', 'jee', 'jpa', 'struts', 'maven', 'gradle', 'jsp', 'servlets', 'jvm', 'junit', 'mockito', 'java developer', 'java microservices']],
    'dotnet' => ['.NET', ['dotnet', 'csharp', 'aspdotnet', 'vbdotnet', 'dotnet core', 'entity framework', 'wcf', 'wpf', 'linq', 'blazor', 'xamarin', 'nuget', 'dotnet developer']],
    'sap' => ['SAP', ['sap', 'abap', 's 4hana', 's4hana', 'sap hana', 'sap fico', 'sap fi', 'sap co', 'sap mm', 'sap sd', 'sap pp', 'sap qm', 'sap wm', 'sap ewm', 'sap basis', 'sap pi', 'sap po', 'sap bw', 'sap bods', 'sap ariba', 'successfactors', 'sap crm', 'sap hcm', 'sap btp', 'fiori', 'sapui5', 'sap grc', 'sap tm', 'sap apo', 'sap ibp', 'sap consultant']],
    'salesforce' => ['Salesforce', ['salesforce', 'apex', 'visualforce', 'salesforce lightning', 'lightning web components', 'lwc', 'sfdc', 'service cloud', 'sales cloud', 'marketing cloud', 'salesforce cpq', 'salesforce developer', 'salesforce admin']],
    'oracle' => ['Oracle applications', ['oracle ebs', 'oracle apps', 'oracle fusion', 'oracle erp', 'oracle hcm', 'oracle scm', 'oracle financials', 'oracle cloud', 'oracle forms', 'oracle reports', 'oracle apex', 'pl sql', 'plsql', 'oracle e business', 'oracle applications']],
    'workday' => ['Workday', ['workday', 'workday hcm', 'workday integration', 'workday studio', 'workday prism', 'workday financials']],
    'servicenow' => ['ServiceNow', ['servicenow', 'service now', 'itsm', 'itom', 'now platform', 'servicenow developer']],
    'peoplesoft' => ['PeopleSoft', ['peoplesoft', 'peoplecode', 'people soft', 'peopletools']],
    'dynamics' => ['Microsoft Dynamics', ['dynamics 365', 'dynamics crm', 'dynamics ax', 'dynamics nav', 'power platform', 'power apps', 'powerapps', 'power automate', 'dataverse', 'business central']],
    'data' => ['Data engineering', ['spark', 'pyspark', 'hadoop', 'hive', 'kafka', 'airflow', 'databricks', 'snowflake', 'etl', 'informatica', 'data pipeline', 'data pipelines', 'data warehouse', 'data warehousing', 'redshift', 'bigquery', 'dbt', 'talend', 'ssis', 'data lake', 'datalake', 'aws glue', 'data engineer', 'data engineering', 'nifi', 'flink', 'data modeling']],
    'bi' => ['BI and analytics', ['tableau', 'power bi', 'powerbi', 'qlik', 'qlikview', 'qliksense', 'looker', 'ssrs', 'cognos', 'microstrategy', 'business intelligence', 'data visualization', 'dashboards', 'bi developer']],
    'ds' => ['Data science and AI', ['machine learning', 'deep learning', 'tensorflow', 'pytorch', 'scikit', 'sklearn', 'nlp', 'natural language processing', 'llm', 'large language', 'generative ai', 'genai', 'data scientist', 'data science', 'computer vision', 'xgboost', 'keras', 'langchain', 'openai', 'rag', 'predictive modeling']],
    'cloud' => ['Cloud', ['aws', 'amazon web services', 'azure', 'gcp', 'google cloud', 'ec2', 's3', 'aws lambda', 'cloudformation', 'azure devops', 'aks', 'eks', 'gke', 'cloud architect', 'cloud engineer', 'iam', 'vpc', 'cloudwatch', 'cloud migration', 'cloud native']],
    'devops' => ['DevOps and SRE', ['devops', 'kubernetes', 'k8s', 'docker', 'terraform', 'jenkins', 'ci cd', 'cicd', 'ansible', 'helm', 'gitlab ci', 'github actions', 'argocd', 'prometheus', 'grafana', 'sre', 'site reliability', 'puppet', 'chef', 'openshift', 'devops engineer']],
    'qa' => ['QA and test automation', ['selenium', 'qa', 'quality assurance', 'test automation', 'automation testing', 'cypress', 'playwright', 'testng', 'cucumber', 'appium', 'postman', 'jmeter', 'loadrunner', 'manual testing', 'test cases', 'uft', 'tosca', 'sdet', 'qa engineer', 'test plans']],
    'frontend' => ['Front-end and JavaScript', ['react', 'reactjs', 'angular', 'angularjs', 'vuejs', 'javascript', 'typescript', 'html', 'css', 'redux', 'nextjs', 'nodejs', 'expressjs', 'express js', 'webpack', 'front end', 'frontend', 'ui developer', 'responsive design']],
    'mobile' => ['Mobile', ['android', 'ios', 'swift', 'kotlin', 'react native', 'flutter', 'xcode', 'mobile app', 'mobile applications', 'objective c', 'swiftui', 'mobile developer']],
    'python' => ['Python', ['python', 'django', 'flask', 'fastapi', 'pandas', 'numpy', 'pytest', 'python developer']],
    'mainframe' => ['Mainframe', ['cobol', 'cics', 'jcl', 'db2', 'vsam', 'ims', 'mainframe', 'z os', 'zos', 'rexx', 'easytrieve']],
    'network' => ['Networking', ['cisco', 'ccna', 'ccnp', 'routing and switching', 'routing protocols', 'bgp', 'ospf', 'firewall', 'firewalls', 'palo alto', 'fortinet', 'juniper', 'network engineer', 'lan wan', 'sd wan', 'wan optimization', 'load balancer', 'f5', 'vpn', 'network security']],
    'security' => ['Cybersecurity', ['cybersecurity', 'cyber security', 'siem', 'splunk', 'soc analyst', 'penetration testing', 'pentest', 'vulnerability management', 'vulnerability assessment', 'iso 27001', 'nist', 'incident response', 'crowdstrike', 'qualys', 'nessus', 'identity and access', 'okta', 'sailpoint', 'cyberark', 'security engineer', 'cissp', 'threat detection']],
    'dba' => ['Databases', ['dba', 'sql server', 'mysql', 'postgresql', 'postgres', 'oracle dba', 'mongodb', 'cassandra', 'database administrator', 'database administration', 'replication', 'performance tuning', 't sql', 'tsql', 'stored procedures', 'database design']],
    'ba' => ['Business analysis', ['business analyst', 'business analysis', 'requirements gathering', 'user stories', 'uat', 'brd', 'frd', 'gap analysis', 'process mapping', 'stakeholder management', 'stakeholders', 'jira', 'confluence', 'functional requirements']],
    'pm' => ['Project and program management', ['project manager', 'program manager', 'pmp', 'scrum master', 'agile coach', 'pmo', 'prince2', 'safe agile', 'scaled agile', 'release train', 'project management', 'delivery manager', 'project plans']],
    'integration' => ['Integration and middleware', ['mulesoft', 'tibco', 'boomi', 'dell boomi', 'webmethods', 'ibm mq', 'esb', 'soa', 'api gateway', 'apigee', 'kong', 'integration developer', 'rest apis', 'soap', 'api integration']],
    'pega' => ['Pega', ['pega', 'pega prpc', 'pega cssa', 'pega csa', 'pega lsa']],
    'guidewire' => ['Guidewire', ['guidewire', 'policycenter', 'claimcenter', 'billingcenter', 'gosu']],
    'embedded' => ['Embedded', ['embedded c', 'embedded systems', 'embedded software', 'rtos', 'firmware', 'microcontroller', 'arm cortex', 'autosar', 'can bus', 'fpga', 'verilog', 'vhdl']],
    'erp' => ['Other ERP', ['netsuite', 'infor', 'jd edwards', 'jde', 'epicor', 'sage intacct', 'ifs erp', 'baan']],
    'healthit' => ['Healthcare IT', ['epic', 'cerner', 'hl7', 'fhir', 'meditech', 'allscripts', 'athenahealth', 'ehr', 'emr', 'hipaa', 'x12', 'edi 837', 'claims processing', 'facets', 'qnxt', 'epic certified']],
    'sysadmin' => ['Systems and infrastructure', ['linux administrator', 'linux administration', 'windows server', 'active directory', 'vmware', 'vsphere', 'hyper v', 'system administrator', 'sysadmin', 'citrix', 'storage administrator', 'netapp', 'backup and recovery', 'veeam', 'commvault', 'patching', 'red hat', 'rhel', 'infrastructure engineer']],
];
/** Industry domains: key => [name, [terms]]; client and product names count as evidence of the industry. */
const DOM_IND = [
    'banking' => ['Banking', ['bank', 'banking', 'core banking', 'loan', 'loans', 'mortgage', 'mortgages', 'lending', 'credit card', 'credit cards', 'payments', 'payment processing', 'kyc', 'aml', 'anti money laundering', 'fraud detection', 'swift payments', 'swift messages', 'ach', 'wire transfer', 'wire transfers', 'retail banking', 'commercial banking', 'treasury', 'finacle', 'temenos', 'fiserv', 'jack henry', 'jpmorgan', 'jp morgan', 'jpmorgan chase', 'chase bank', 'wells fargo', 'citibank', 'citigroup', 'bank of america', 'capital one', 'goldman sachs', 'morgan stanley', 'us bank', 'pnc', 'truist', 'hsbc', 'barclays', 'deutsche bank', 'td bank', 'bny mellon', 'american express', 'discover financial', 'synchrony', 'ally bank', 'fifth third', 'regions bank', 'citizens bank', 'bnp paribas', 'standard chartered', 'icici', 'hdfc', 'state bank of india', 'axis bank', 'kotak', 'financial services']],
    'capmarkets' => ['Capital markets and investments', ['capital markets', 'trading platform', 'trading systems', 'equity trading', 'trade settlement', 'trade finance', 'equities', 'fixed income', 'derivatives', 'asset management', 'wealth management', 'portfolio management', 'investment banking', 'investment management', 'hedge fund', 'bloomberg', 'murex', 'calypso', 'fix protocol', 'brokerage', 'fidelity investments', 'vanguard', 'blackrock', 'charles schwab', 'state street', 'northern trust', 'nasdaq', 'nyse', 'dtcc', 'mutual funds', 'etf']],
    'insurance' => ['Insurance', ['insurance', 'insurer', 'claims processing', 'claims management', 'claims adjudication', 'underwriting', 'policy administration', 'property and casualty', 'p and c', 'p c insurance', 'life insurance', 'annuities', 'actuarial', 'reinsurance', 'guidewire', 'duck creek', 'majesco', 'allstate', 'state farm', 'geico', 'progressive insurance', 'liberty mutual', 'travelers insurance', 'metlife', 'prudential', 'aig', 'chubb', 'nationwide', 'the hartford', 'usaa', 'aflac', 'cigna', 'humana', 'anthem', 'elevance', 'unitedhealth', 'aetna', 'health insurance']],
    'healthcare' => ['Healthcare', ['healthcare', 'health care', 'hospital', 'hospitals', 'clinical', 'patient', 'patients', 'ehr', 'emr', 'epic', 'cerner', 'hipaa', 'hl7', 'fhir', 'medicare', 'medicaid', 'care management', 'telehealth', 'nursing', 'physician', 'physicians', 'kaiser', 'mayo clinic', 'cleveland clinic', 'hca healthcare', 'optum', 'cvs health', 'walgreens', 'labcorp', 'quest diagnostics', 'medical devices', 'medical device', 'healthcare provider']],
    'pharma' => ['Pharma and life sciences', ['pharma', 'pharmaceutical', 'pharmaceuticals', 'life sciences', 'clinical trials', 'clinical trial', 'gxp', 'gmp', 'fda', '21 cfr part 11', 'computer system validation', 'biotech', 'drug safety', 'pharmacovigilance', 'regulatory affairs', 'veeva', 'pfizer', 'merck', 'johnson and johnson', 'johnson johnson', 'novartis', 'roche', 'astrazeneca', 'bristol myers', 'amgen', 'gilead', 'abbvie', 'eli lilly', 'sanofi', 'gsk', 'bayer', 'regeneron', 'moderna']],
    'retail' => ['Retail and e-commerce', ['retail', 'e commerce', 'ecommerce', 'omnichannel', 'point of sale', 'pos systems', 'merchandising', 'inventory management', 'order management', 'magento', 'shopify', 'hybris', 'commerce cloud', 'walmart', 'target corporation', 'target corp', 'amazon com', 'amazon retail', 'costco', 'home depot', 'lowes', 'kroger', 'best buy', 'macys', 'nordstrom', 'kohls', 'wayfair', 'ebay', 'etsy', 'nike', 'gap inc']],
    'telecom' => ['Telecom', ['telecom', 'telecommunications', 'telco', '5g', 'lte', 'oss bss', 'oss', 'bss', 'billing systems', 'verizon', 'at and t', 'at t', 't mobile', 'tmobile', 'sprint corporation', 'comcast', 'charter communications', 'spectrum enterprise', 'lumen', 'centurylink', 'ericsson', 'nokia', 'huawei', 'vodafone', 'airtel', 'jio', 'bt group', 'dish network']],
    'manufacturing' => ['Manufacturing and automotive', ['manufacturing', 'automotive', 'plant floor', 'manufacturing plant', 'shop floor', 'mes', 'plm', 'scada', 'industrial automation', 'ford motor', 'general motors', 'toyota', 'honda', 'tesla', 'stellantis', 'caterpillar', 'john deere', 'boeing', 'lockheed', 'raytheon', 'northrop', 'honeywell', 'siemens', 'general electric', 'ge healthcare', 'ge aviation', '3m company', 'whirlpool', 'bosch', 'cummins', 'aerospace', 'defense contractor']],
    'government' => ['Government and public sector', ['federal government', 'federal agency', 'state government', 'state agency', 'government agency', 'public sector', 'government', 'security clearance', 'clearance', 'dod', 'department of defense', 'dhs', 'veterans affairs', 'irs', 'centers for medicare', 'usda', 'fema', 'nasa', 'county government', 'city of', 'municipal', 'fedramp', 'public safety']],
    'education' => ['Education', ['higher education', 'school district', 'k 12', 'edtech', 'learning management', 'lms', 'canvas lms', 'blackboard', 'student information system', 'educational institution', 'university it', 'college it']],
    'energy' => ['Energy and utilities', ['energy company', 'energy sector', 'utility company', 'utilities', 'oil and gas', 'upstream', 'downstream', 'smart grid', 'smart meter', 'power generation', 'renewable energy', 'solar energy', 'wind energy', 'exxon', 'chevron', 'shell oil', 'royal dutch shell', 'bp plc', 'british petroleum', 'conocophillips', 'duke energy', 'southern company', 'pg and e', 'pg e', 'pge', 'exelon', 'dominion energy', 'schlumberger', 'halliburton', 'baker hughes']],
    'logistics' => ['Logistics and supply chain', ['logistics', 'supply chain', 'warehouse management', 'wms', 'tms', 'transportation management', 'freight', 'fleet management', 'fedex', 'united parcel', 'ups logistics', 'dhl', 'xpo', 'jb hunt', 'maersk', 'procurement', 'strategic sourcing', 'demand planning', 'ariba', 'coupa', 'blue yonder', 'manhattan associates']],
    'media' => ['Media and entertainment', ['media company', 'digital media', 'media and entertainment', 'entertainment', 'streaming', 'broadcast', 'publishing', 'advertising', 'ad tech', 'adtech', 'gaming', 'disney', 'netflix', 'warner', 'nbcuniversal', 'paramount', 'viacom', 'spotify', 'fox corporation', 'cbs', 'espn', 'new york times']],
    'travel' => ['Travel and hospitality', ['travel industry', 'travel company', 'travel booking', 'hospitality', 'airline', 'airlines', 'hotel', 'hotels', 'reservation system', 'reservations', 'booking engine', 'cruise', 'marriott', 'hilton', 'hyatt', 'delta air', 'united airlines', 'american airlines', 'southwest airlines', 'expedia', 'booking com', 'airbnb', 'sabre', 'amadeus']],
    'tech' => ['Technology and SaaS', ['saas', 'software company', 'software product', 'product company', 'startup', 'start up', 'microsoft corporation', 'google llc', 'apple inc', 'meta platforms', 'ibm corporation', 'intel corporation', 'nvidia corporation', 'adobe systems', 'servicenow inc', 'workday inc', 'salesforce com', 'uber', 'lyft', 'linkedin', 'snowflake inc']],
    'consulting' => ['IT services and consulting', ['tcs', 'tata consultancy', 'infosys', 'wipro', 'hcl', 'cognizant', 'accenture', 'capgemini', 'deloitte', 'ey', 'ernst and young', 'ernst young', 'kpmg', 'pwc', 'mindtree', 'ltimindtree', 'tech mahindra', 'mphasis', 'hexaware', 'virtusa', 'ust global', 'epam', 'globant', 'ntt data', 'dxc', 'cgi', 'booz allen', 'leidos', 'saic']],
];
const DOM_MAX_TECH = 4;
const DOM_MAX_IND = 3;

/** The recognized domains of a resume: ['tech' => [...], 'ind' => [...], 'at' => ms], each domain with its name, score, evidence terms and years. */
function domRecognize(string $text, array $skills = [], string $title = ''): array
{
    $padded = ' ' . tsNorm($text) . ' ';
    $ti = ' ' . tsNorm($title) . ' ';
    $short = mb_strlen($padded) < 400;
    $scan = function (array $cat, int $maxOut, int $min, bool $tech) use ($padded, $ti, $skills, $short): array {
        $out = [];
        foreach ($cat as $key => [$name, $terms]) {
            $score = 0;
            $hits = [];
            $years = 0.0;
            foreach ($terms as $t) {
                $n = substr_count($padded, ' ' . $t . ' ');
                if ($n === 0) {
                    continue;
                }
                $w = str_contains($t, ' ') ? 2 : 1; // a phrase is stronger evidence than a word
                $score += min(6, $n) * $w;
                if (substr_count($ti, ' ' . $t . ' ') > 0) {
                    $score += 4;
                }
                $hits[$t] = $n;
                // years behind the term, from the dated jobs the index read (canonical skill names are lower case there)
                foreach ($skills as $sk => $v) {
                    if (tsNorm((string) $sk) === $t) {
                        $years = max($years, (float) ($v['y'] ?? 0));
                    }
                }
            }
            // two different terms, or one term named often: a term named once (or one tool in passing) is not a domain
            if ($score >= $min && (count($hits) >= 2 || $score >= $min * 2)) {
                arsort($hits);
                $out[] = ['k' => $key, 'n' => $name, 'score' => $score, 'years' => round($years, 1), 'terms' => array_slice(array_keys($hits), 0, 6), 'hits' => array_sum($hits)];
            }
        }
        usort($out, fn($a, $b) => $b['score'] <=> $a['score']);
        return array_slice($out, 0, $maxOut);
    };
    $tech = $scan(DOM_TECH, DOM_MAX_TECH, $short ? 2 : 3, true);
    $ind = $scan(DOM_IND, DOM_MAX_IND, 4, false);
    return ['tech' => $tech, 'ind' => $ind, 'at' => now(), 'v' => 1];
}
/** One line: "Java · Cloud · Banking, Insurance". */
function domLine(?array $dom): string
{
    if (!$dom) {
        return '';
    }
    $t = implode(' · ', array_map(fn($x) => $x['n'], (array) ($dom['tech'] ?? [])));
    $i = implode(', ', array_map(fn($x) => $x['n'], (array) ($dom['ind'] ?? [])));
    return trim($t . ($t !== '' && $i !== '' ? ' — ' : '') . $i);
}
/** The catalogs for the pages (keys and names). */
function domCatalog(): array
{
    return ['tech' => array_map(fn($k, $v) => ['k' => $k, 'n' => $v[0]], array_keys(DOM_TECH), DOM_TECH), 'ind' => array_map(fn($k, $v) => ['k' => $k, 'n' => $v[0]], array_keys(DOM_IND), DOM_IND)];
}
/** The slim form kept on records and index rows: tech [{k, n, y, t}], ind [{k, n, t}], at. */
function domSlim(array $dom): array
{
    return ['tech' => array_values(array_map(fn($x) => ['k' => $x['k'], 'n' => $x['n'], 'y' => $x['years'], 't' => array_slice($x['terms'], 0, 4)], (array) ($dom['tech'] ?? []))), 'ind' => array_values(array_map(fn($x) => ['k' => $x['k'], 'n' => $x['n'], 't' => array_slice($x['terms'], 0, 4)], (array) ($dom['ind'] ?? []))), 'at' => (int) ($dom['at'] ?? 0)];
}
/** Keeps the recognized domains on the record itself (only when they changed), so the pages that show it have them. */
function domStore(string $kind, string $id, array $dom): void
{
    $path = $kind === 'ats' ? 'ats/' . $id : ($kind === 'cand' ? 'rec/cand/items/' . $id : ($kind === 'u' ? 'u/' . $id : ''));
    if ($path === '') {
        return;
    }
    $doc = docGet($path);
    if (!$doc) {
        return;
    }
    $slim = domSlim($dom);
    $cur = isset($doc->dom) ? json_decode(json_encode($doc->dom), true) : null;
    $same = $cur && json_encode(['tech' => $cur['tech'] ?? null, 'ind' => $cur['ind'] ?? null]) === json_encode(['tech' => $slim['tech'], 'ind' => $slim['ind']]);
    if ($same) {
        return;
    }
    $doc->dom = json_decode(json_encode($slim));
    docSet($path, $doc);
}
/** Does a recognized set carry the domain (a tech key or an industry key)? */
function domHas(?array $dom, string $tech, string $ind): bool
{
    if ($tech !== '' && !in_array($tech, array_map(fn($x) => $x['k'], (array) ($dom['tech'] ?? [])), true)) {
        return false;
    }
    if ($ind !== '' && !in_array($ind, array_map(fn($x) => $x['k'], (array) ($dom['ind'] ?? [])), true)) {
        return false;
    }
    return true;
}
