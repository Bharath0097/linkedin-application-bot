/* ================= Website content ================= */
const SERVICES = [
  { s: 'staffing', n: 'Staffing services', d: 'Contract, contract-to-hire and direct-hire talent for IT and non-IT roles.',
    l: 'We place consultants with end clients directly and work as a dependable subcontractor to prime vendors. Every engagement is screened, onboarded and supported by our team, with attendance and timesheets tracked in one portal.',
    inc: ['Contract and C2C consultants', 'Contract-to-hire and direct hire', 'SOW-based project teams', 'Prime-vendor and subcontract partnerships', 'IT, healthcare, and finance & accounting roles', 'Onboarding and timesheet management'] },
  { s: 'web-development', n: 'Web development', d: 'SEO-friendly websites built on scalable frameworks.',
    l: 'Fast, accessible websites that are easy for your team to update and easy for search engines to understand.',
    inc: ['Corporate and marketing sites', 'E-commerce builds', 'CMS and headless platforms', 'Performance and technical SEO'] },
  { s: 'app-development', n: 'App development', d: 'Secure mobile and web apps with intuitive interfaces.',
    l: 'Native and cross-platform apps for phones, tablets, watches and TVs, built with security and maintainability in mind.',
    inc: ['iOS and Android apps', 'Cross-platform builds', 'Watch and TV apps', 'App modernization'] },
  { s: 'software-development', n: 'Software development', d: 'Custom software and SaaS products shaped around your workflows.',
    l: 'Business software and SaaS products designed around the way your organization actually operates, with integrations into the systems you already use.',
    inc: ['Custom business software', 'SaaS product development', 'APIs and system integration', 'QA, maintenance and support'] },
  { s: 'digital-marketing', n: 'Digital marketing', d: 'Search, social and paid campaigns that bring in qualified leads.',
    l: 'Campaigns planned around measurable outcomes, from organic search to paid social, with reporting you can act on.',
    inc: ['Search engine optimization', 'Social media marketing', 'Paid search and social', 'Content and analytics'] },
  { s: 'ui-ux', n: 'UI / UX design', d: 'Interfaces designed around how people actually work.',
    l: 'Research-led design that turns complex workflows into clear screens, backed by prototypes you can test before you build.',
    inc: ['User research', 'Wireframes and prototypes', 'Design systems', 'Usability testing'] },
  { s: 'it-consultancy', n: 'IT consultancy', d: 'Advice that lines up your IT strategy with business goals.',
    l: 'Independent guidance on architecture, tooling and delivery so technology spending maps directly to business results.',
    inc: ['IT strategy and roadmaps', 'Architecture reviews', 'Vendor and tool selection', 'IT project management'] },
  { s: 'erp-crm', n: 'ERP / CRM', d: 'Streamlined operations and stronger customer relationships.',
    l: 'Implementation, configuration and support for ERP and CRM platforms, including SAP, with clean data migration and integrations.',
    inc: ['SAP and ERP implementation', 'CRM setup and customization', 'Data migration', 'Integrations and support'] },
  { s: 'devops', n: 'DevOps', d: 'Faster, safer releases with automated pipelines and cloud infrastructure.',
    l: 'Automated build, test and deployment pipelines on modern cloud infrastructure, monitored around the clock.',
    inc: ['CI/CD pipelines', 'Cloud infrastructure on AWS, Azure and GCP', 'Containers and Kubernetes', 'Monitoring and incident response'] },
  { s: 'healthcare', n: 'Healthcare IT solutions', d: 'Compliant systems for hospitals, clinics and research teams.',
    l: 'Software for hospitals, clinics, diagnostic centers and research organizations, designed around HIPAA, HL7 and FHIR from day one.',
    inc: ['EHR and EMR implementation', 'HIPAA-compliant telemedicine apps', 'Remote patient monitoring and IoMT', 'Healthcare CRM and patient engagement', 'Medical portals and scheduling'] },
  { s: 'clinical-saas', n: 'Clinical SaaS development', d: 'Cloud software for clinical workflows, research and trials.',
    l: 'Secure, interoperable cloud products for clinical teams, from workflow tools to research and trial data platforms.',
    inc: ['Clinical workflow applications', 'Research and trial data platforms', 'HIPAA-ready hosting', 'HL7 and FHIR interoperability'] },
];
const SERVICE_EXTRA = {
  'staffing': { who: 'Hiring managers, procurement and prime vendors who need vetted people on a project quickly.', tech: ['Network engineering', 'SAP', 'React and front-end', 'Java', 'Python', '.NET', 'Cloud and DevOps', 'Healthcare IT', 'Finance and accounting'],
    deliver: ['Screened, interview-ready profiles with RTR', 'Rate, availability and work-authorization check', 'Agreements, onboarding and compliance paperwork', 'Timesheets, approvals and invoicing through the portal', 'Replacement guarantee on contract placements', 'A named account manager'],
    time: 'First profiles in 2 to 5 business days', team: 'Recruiter, account manager, compliance', models: 'C2C, W2, 1099, contract-to-hire, direct hire, SOW teams',
    faq: [['How fast can you present candidates?', 'For common roles we usually present screened profiles within a few business days. Niche roles take longer, and we tell you when that is the case rather than guess.'], ['Do you handle the paperwork?', 'Yes. Agreements, onboarding, timesheets and invoicing run through our team and the portal, so your managers only approve hours.'], ['What if a consultant does not work out?', 'Tell your account manager. We replace contract placements and re-screen against your feedback.']] },
  'web-development': { who: 'Companies that need a site that loads fast, ranks well and can be updated without a developer.', tech: ['HTML/CSS/JS', 'React', 'Next.js', 'WordPress', 'Shopify', 'Headless CMS'],
    deliver: ['Design system and responsive templates', 'CMS with editable pages and blog', 'Lead forms, analytics and SEO setup', 'Performance budget and accessibility pass', 'Launch, redirects and search console', 'Training and a maintenance plan'],
    time: '4 to 10 weeks for a marketing site', team: 'Designer, front-end developer, project lead', models: 'Fixed scope or monthly retainer',
    faq: [['Do you also host and maintain sites?', 'We can hand over a site for your own hosting or keep maintaining it under a support agreement.'], ['Can you redesign an existing site?', 'Yes. We start from your current content and analytics so nothing that works is lost.']] },
  'app-development': { who: 'Businesses launching a customer app or replacing an aging internal one.', tech: ['Swift', 'Kotlin', 'React Native', 'Flutter', 'watchOS and tvOS', 'Firebase and AWS'],
    deliver: ['Clickable prototype and user flows', 'iOS and Android builds from one codebase where it fits', 'Backend APIs, push notifications and analytics', 'App store listings and release management', 'Crash monitoring and update plan'],
    time: '8 to 16 weeks to a first release', team: 'Product designer, mobile engineers, backend engineer, QA', models: 'Fixed scope, then support retainer',
    faq: [['Native or cross-platform?', 'It depends on the app. We recommend cross-platform when one codebase can serve both stores well, and native when performance or device features demand it.'], ['Do you publish to the app stores?', 'Yes, including store listings, review feedback and updates after launch.']] },
  'software-development': { who: 'Teams whose spreadsheets and off-the-shelf tools no longer fit how they work.', tech: ['Java', 'Python', '.NET', 'Node.js', 'PostgreSQL and SQL Server', 'REST and GraphQL APIs'],
    deliver: ['Discovery report with scoped plan and estimate', 'Working software in two-week increments', 'Integrations with the systems you already use', 'Automated tests and documentation', 'Source code and deployment runbooks', 'Support and enhancement backlog'],
    time: 'Discovery in 2 weeks, first release in 6 to 12', team: 'Business analyst, tech lead, 2 to 4 engineers, QA', models: 'SOW team or dedicated engineers',
    faq: [['How do projects start?', 'With a short discovery phase that produces a scoped plan and estimate before any build work begins.'], ['Who owns the code?', 'You do. Source code and documentation are delivered with the product.']] },
  'digital-marketing': { who: 'Companies that want measurable leads from search and social, not just traffic.', tech: ['Google Ads', 'Meta and LinkedIn Ads', 'Technical SEO', 'Analytics and tag management', 'Email campaigns'],
    deliver: ['Keyword and competitor research', 'Campaign setup across search and social', 'Landing pages built to convert', 'Monthly reports on leads and cost per lead', 'Ongoing optimization'],
    time: 'Setup in 2 to 3 weeks, results compound over 3+ months', team: 'Marketing strategist, content writer, ads specialist', models: 'Monthly retainer',
    faq: [['How do you report results?', 'Monthly reports tied to the goals we agreed on: leads, cost per lead and conversion, not vanity metrics.'], ['Is there a minimum term?', 'Campaigns need a few months to optimize, so we recommend at least three.']] },
  'ui-ux': { who: 'Product teams that want interfaces tested with real users before engineering starts.', tech: ['Figma', 'Design systems', 'Prototyping', 'Usability testing', 'Accessibility (WCAG)'],
    deliver: ['User interviews and journey maps', 'Wireframes and interactive prototypes', 'Design system with reusable components', 'Usability test findings and fixes', 'Developer-ready specifications'],
    time: '3 to 8 weeks depending on scope', team: 'UX researcher, product designer', models: 'Fixed scope or embedded designer',
    faq: [['Can you work with our developers?', 'Yes. We deliver specs and components your team can implement directly.'], ['Do you do research?', 'User interviews, task analysis and usability tests are part of most engagements.']] },
  'it-consultancy': { who: 'Leadership teams making technology decisions that are hard to reverse.', tech: ['Architecture reviews', 'Cloud strategy', 'Vendor evaluation', 'Security posture', 'Project and program management'],
    deliver: ['Current-state assessment', 'Roadmap with options, costs and risks', 'Vendor shortlist and selection criteria', 'Architecture and security recommendations', 'Project governance and PMO support'],
    time: 'Assessment in 2 to 4 weeks', team: 'Principal consultant, solution architect', models: 'Fixed-fee assessment or advisory retainer',
    faq: [['Are you tied to specific vendors?', 'No. Recommendations are independent; we have no resale arrangements that influence them.'], ['Can you run the project after the plan?', 'Yes, with our project managers and delivery team or alongside yours.']] },
  'erp-crm': { who: 'Operations and finance teams that need their systems to talk to each other.', tech: ['SAP S/4HANA', 'SAP PP, QM, MM and FICO', 'Salesforce', 'Microsoft Dynamics', 'Data migration'],
    deliver: ['Process mapping and fit-gap analysis', 'Configuration and custom development', 'Cleansed and migrated data with rehearsals', 'Integration with finance, HR and plant systems', 'User training and hypercare after go-live'],
    time: '3 to 9 months by module and scope', team: 'Functional consultants, technical consultants, PM', models: 'SOW project or staffed consultants',
    faq: [['Do you staff SAP consultants as well as implement?', 'Both. Many clients start with a functional consultant on contract and grow into a project.'], ['How do you handle data migration?', 'With cleansing, mapping and rehearsal migrations before the final cutover.']] },
  'devops': { who: 'Engineering teams that ship too slowly or lose sleep over production.', tech: ['AWS, Azure and GCP', 'Kubernetes and Docker', 'Terraform', 'GitHub Actions and Jenkins', 'Observability tooling'],
    deliver: ['Pipeline and infrastructure audit', 'CI/CD with automated tests and approvals', 'Infrastructure as code and environments', 'Monitoring, alerting and runbooks', 'Cost optimization report', 'On-call support option'],
    time: 'Audit in 1 to 2 weeks, improvements in sprints', team: 'DevOps engineer, cloud architect', models: 'SOW or embedded engineers',
    faq: [['Can you take over an existing setup?', 'Yes. We start with an audit of the current pipelines and infrastructure, then improve in steps.'], ['Do you offer on-call support?', 'Monitoring and incident response can be part of a support agreement.']] },
  'healthcare': { who: 'Hospitals, clinics, diagnostic centers and research groups that must stay compliant while modernizing.', tech: ['HIPAA', 'HL7 and FHIR', 'EHR and EMR platforms', 'Telemedicine', 'Remote patient monitoring'],
    deliver: ['EHR/EMR implementation and integration', 'HIPAA-compliant telemedicine and patient portals', 'Remote monitoring and device (IoMT) integration', 'Healthcare CRM and scheduling', 'Compliance documentation for your auditors'],
    time: 'Scoped per program; portals in 8 to 14 weeks', team: 'Healthcare analyst, integration engineers, security lead', models: 'SOW project or staffed healthcare IT roles',
    faq: [['How do you handle protected health information?', 'With HIPAA-aligned design, access controls and encryption from the first day, documented for your compliance team.'], ['Can you integrate with our EHR?', 'Yes, through HL7 and FHIR interfaces.']] },
  'clinical-saas': { who: 'Clinical teams and research organizations that need secure, interoperable cloud software.', tech: ['HIPAA-ready hosting', 'FHIR APIs', 'Trial and research data platforms', 'Audit logging', 'Role-based access'],
    deliver: ['Multi-tenant SaaS architecture', 'Clinical workflow and research modules', 'FHIR interoperability layer', 'Audit trails and validation documentation', 'Hosting, monitoring and release management'],
    time: 'MVP in 12 to 20 weeks', team: 'Product lead, full-stack engineers, compliance specialist', models: 'SOW product build, then support',
    faq: [['Can the platform be white-labeled?', 'Yes. Multi-tenant SaaS with your branding is a common request.'], ['What about audit and validation?', 'Audit trails and validation documentation are built in for regulated environments.']] },
};
const INDUSTRIES = [
  ['Healthcare and life sciences', 'EHR, telemedicine and patient platforms, plus healthcare IT staffing.'],
  ['Banking, finance and accounting', 'Finance and accounting professionals, fintech engineering, compliance-aware delivery.'],
  ['Manufacturing and supply chain', 'SAP PP, QM and MM teams and plant-floor integrations.'],
  ['Telecom and networking', 'Network engineers, security specialists and NOC staffing.'],
  ['Technology and SaaS', 'Product engineering squads, DevOps and cloud specialists.'],
  ['Public sector and education', 'Compliant staffing and portals for institutions and agencies.'],
];
const FAQS = [
  ['How quickly can you place a consultant?', 'For common roles we typically present screened profiles within a few business days. Niche or senior roles can take longer, and we say so up front instead of promising a date we cannot keep.'],
  ['Which engagement models do you support?', 'Contract (C2C, W2 or 1099), contract-to-hire, direct hire and SOW-based project teams. The model follows what fits your organization and the consultant.'],
  ['Do you work through prime vendors?', 'Yes. We work directly with end clients and as a subcontractor to prime vendors and staffing partners, with the paperwork handled by our team.'],
  ['How do timesheets and approvals work?', 'Consultants clock in and submit weekly hours in the employee portal. The client manager approves them in the client portal, StratEdge gives final approval, and invoicing follows the approved hours.'],
  ['Where do you operate?', 'We are based in Somerset, New Jersey, and place consultants across the United States, onsite, hybrid or remote.'],
  ['What roles do you cover?', 'Network engineering, SAP functional and technical, front-end and React, Java, Python and .NET, cloud and DevOps, healthcare IT, and finance and accounting, among others.'],
  ['How do I get access to the portals?', 'Click Log in, create an account, choose consultant or client contact and fill in your profile. StratEdge approves access, usually within one business day.'],
  ['Do you build software as well as staff projects?', 'Yes. Our delivery team builds web and mobile apps, custom software and SaaS, ERP/CRM implementations, DevOps and healthcare IT systems.'],
  ['How is pricing determined?', 'Rates depend on the role, location, duration and engagement model. The first consultation is free and ends with a written quote.'],
  ['How do I apply for a role?', 'Open roles are on the Careers page with an Apply button. You can also send a general application or email your resume to info@stratedgeitconsulting.com.'],
];
const ROLES = ['Network engineering', 'SAP functional & technical', 'Front-end & React', 'Java, Python & .NET engineering', 'Cloud & DevOps', 'Healthcare IT', 'Finance & accounting'];
const POSTS = [
  { s: 'cloud-efficiency', d: 'Jul 5', t: 'Maximizing cloud efficiency: tools and tactics', c: 'Cloud solutions', body: [
    'Cloud bills grow quietly. Idle instances, oversized databases and forgotten storage buckets rarely show up as a single line item, which is why most teams discover them months late. The first fix is visibility: tag every resource by team and project, and review spend weekly rather than at month end.',
    'Once you can see the spend, the tactics are well understood. Right-size compute from actual utilization instead of launch-day guesses. Schedule non-production environments to shut down overnight and on weekends. Move cold data to cheaper storage tiers, and buy committed-use discounts only for workloads that have proven steady.',
    'The native tools cover most of this: AWS Cost Explorer, Azure Cost Management and Google Cloud Billing all surface anomalies and recommendations. Infrastructure as code keeps environments from drifting, and autoscaling ties capacity to demand. StratEdge runs these reviews with client teams and implements the changes without disrupting production.'] },
  { s: 'mobile-apps-ai', d: 'Jul 3', t: 'The future of mobile apps: innovation and AI', c: 'App development', body: [
    'Mobile apps are moving from screens full of forms toward assistants that anticipate what people need. Models that run on the device make personalization fast and private, the camera and microphone are becoming primary inputs, and offline-first design is expected rather than optional.',
    'Planning for that future means thinking about privacy-preserving inference, accessibility from the first wireframe, and the wider family of surfaces an app now lives on: watches, tablets and TVs. Cross-platform frameworks keep a single codebase viable across all of them.',
    'Our advice is to start with one AI feature tied to a real user problem, measure whether it helps, and keep people in control of the outcome. StratEdge builds iOS, Android and cross-platform apps on exactly these foundations.'] },
  { s: 'engagement-models', d: 'Sep 20', t: 'C2C, W2 or 1099: choosing an engagement model', c: 'Staffing', body: [
    'The three letters on a staffing contract decide who pays taxes, who carries insurance and how quickly an engagement can start. Corp-to-corp (C2C) means the consultant works through their own company and invoices for hours; W2 means they are employed and paid through payroll; 1099 means an independent contractor paid directly.',
    'Clients usually care about three things: compliance, speed and continuity. W2 keeps classification simple. C2C suits experienced consultants who already run a business and carry their own coverage. 1099 fits short, well-defined work by established independents.',
    'StratEdge supports all three, plus contract-to-hire and direct hire, and we recommend the model only after seeing the role. The right choice is the one your legal and finance teams are comfortable with on day one.'] },
  { s: 'clean-timesheet-process', d: 'Sep 12', t: 'What a clean timesheet process looks like', c: 'Operations', body: [
    'Most billing disputes between vendors and clients trace back to the same thing: hours recorded in one place, approved in another, and invoiced from a third. By the time anyone notices a mismatch, three people have to be chased.',
    'A clean process has one record. The consultant logs hours during the week, attaches the client-signed sheet if the client uses one, and submits once. The client manager approves or returns it with a note. The staffing firm checks it against clocked time, gives final approval, and invoices from that approved number.',
    'That is exactly how our portals work: employee, client and admin views of the same timesheet, each with the decisions that belong to them. It removes the Friday scramble for signatures and gives everyone the same number.'] },
  { s: 'scaling-enterprise-systems', d: 'Jul 1', t: 'Scaling software systems for enterprise growth', c: 'Software engineering', body: [
    'Systems that served a hundred users comfortably start to strain at ten thousand. The usual culprits are a single overloaded database, synchronous calls between every component, and deployments that still depend on one person.',
    'Scale in steps. Add observability first so decisions rest on data. Then introduce caching and read replicas, move heavy work to asynchronous queues, and split services only where ownership boundaries are already clear. Rewriting everything at once is the most expensive way to grow.',
    'Process matters as much as architecture: continuous integration and delivery, automated testing, and runbooks for the people on call. StratEdge\u2019s software and DevOps teams help enterprises grow capacity without re-platforming the business.'] },
];
const STATS = [['120+', 'happy clients'], ['150+', 'projects delivered'], ['40+', 'tech experts'], ['60+', 'global collaborations']];

/* ================= Shell ================= */
const Logo = ({ white }) => white
  ? html`<img src=${LOGO_D} alt="StratEdge IT Consulting" width="220" height="56" />`
  : html`<${Fragment}><img className="logo-l" src=${LOGO_L} alt="StratEdge IT Consulting" width="220" height="56" /><img className="logo-d" src=${LOGO_D} alt="StratEdge IT Consulting" width="220" height="56" /><//>`;

function SiteHeader({ path }) {
  const [dd, setDd] = useState(false);
  const [sheet, setSheet] = useState(false);
  const ddRef = useRef(null);
  useEffect(() => { setDd(false); setSheet(false); }, [path]);
  useEffect(() => {
    if (!dd) return;
    const f = e => { if (ddRef.current && !ddRef.current.contains(e.target)) setDd(false); };
    const k = e => { if (e.key === 'Escape') setDd(false); };
    addEventListener('mousedown', f); addEventListener('keydown', k);
    return () => { removeEventListener('mousedown', f); removeEventListener('keydown', k); };
  }, [dd]);
  const on = p => (p === '/' ? path === '/' : path.startsWith(p)) ? 'on' : '';
  return html`<${Fragment}>
    <div className="util"><div className="wrap">
      <a href=${'tel:' + CO.tel}>${CO.phone}</a>
      <a href=${'mailto:' + CO.email}>${CO.email}</a>
      <span className="hide-m">${CO.hours}</span>
      <a className="push hide-s" href=${CO.linkedin} target="_blank" rel="noopener">LinkedIn</a>
    </div></div>
    <header className="nav"><div className="wrap">
      <a className="brand" href="#/" aria-label="StratEdge IT Consulting home"><${Logo} /></a>
      <nav className="links" aria-label="Main">
        <a className=${on('/')} href="#/">Home</a>
        <a className=${on('/about')} href="#/about">About us</a>
        <div className="dd" ref=${ddRef} onMouseLeave=${() => setDd(false)}>
          <button aria-expanded=${dd} onClick=${() => setDd(v => !v)} onMouseEnter=${() => setDd(true)} className=${on('/services')}>Services <${Icon} n="chev" cls="sm" /></button>
          ${dd && html`<div className="dd-menu">${SERVICES.map(s => html`<a key=${s.s} href=${'#/services/' + s.s}>${s.n}<small>${s.d}</small></a>`)}</div>`}
        </div>
        <a className=${on('/blog')} href="#/blog">Blog</a>
        <a className=${on('/careers')} href="#/careers">Careers</a>
        <a className=${on('/contact')} href="#/contact">Contact us</a>
      </nav>
      <div className="nav-cta">
        <button className="askbtn hide-m" onClick=${() => dispatchEvent(new CustomEvent('edge-open'))} aria-label="Ask the StratEdge assistant" title="Ask the assistant"><span className="askbot"><${Bot} small /></span></button>
        <a className="btn ghost hide-m" href="#/request-talent">Request talent</a>
        <a className="btn" href=${LOGIN}>Log in</a>
        <button className="btn ghost icon burger" aria-label="Open menu" onClick=${() => setSheet(true)}><${Icon} n="menu" /></button>
      </div>
    </div></header>
    ${sheet && html`<div className="sheet" role="dialog" aria-modal="true" aria-label="Menu">
      <div className="top-row"><a className="brand" href="#/"><${Logo} /></a><button className="btn ghost icon" aria-label="Close menu" onClick=${() => setSheet(false)}><${Icon} n="x" /></button></div>
      <a href="#/">Home</a><a href="#/about">About us</a><a href="#/services">Services</a>
      <div className="sub">${SERVICES.map(s => html`<a key=${s.s} href=${'#/services/' + s.s}>${s.n}</a>`)}</div>
      <a href="#/blog">Blog</a><a href="#/careers">Careers</a><a href="#/faq">FAQ</a><a href="#/contact">Contact us</a>
      <div className="actions"><a className="btn lg" href=${LOGIN}>Log in to the portal</a><a className="btn ghost lg" href="#/request-talent">Request talent</a></div>
    </div>`}
  <//>`;
}

function SiteFooter() {
  return html`<footer className="foot">
    <div className="wrap">
      <div><${Logo} white /><p>IT staffing, consulting and software delivery from Somerset, New Jersey.</p></div>
      <div><h4>Company</h4><ul><li><a href="#/about">About us</a></li><li><a href="#/services">Services</a></li><li><a href="#/request-talent">Request talent</a></li><li><a href="#/blog">Blog</a></li><li><a href="#/careers">Careers</a></li><li><a href="#/faq">FAQ</a></li><li><a href="#/contact">Contact us</a></li></ul></div>
      <div><h4>Services</h4><ul>${SERVICES.slice(0, 6).map(s => html`<li key=${s.s}><a href=${'#/services/' + s.s}>${s.n}</a></li>`)}</ul></div>
      <div><h4>Get in touch</h4><ul>
        <li><a href=${'tel:' + CO.tel}>${CO.phone}</a></li><li><a href=${'mailto:' + CO.email}>${CO.email}</a></li>
        <li><a href=${CO.map} target="_blank" rel="noopener">${CO.addr1}, ${CO.addr2}</a></li>
        <li><a href=${CO.linkedin} target="_blank" rel="noopener">LinkedIn</a></li><li><a href=${LOGIN + '?as=consultant'}>Consultant portal</a></li><li><a href=${LOGIN + '?as=employee'}>Employee portal</a></li><li><a href=${LOGIN + '?as=client'}>Client portal</a></li>
        <li><button className="btn sm go" style=${{ marginTop: 8 }} onClick=${() => dispatchEvent(new CustomEvent('edge-open'))}><${Icon} n="chat" />Ask the StratEdge assistant</button></li></ul></div>
    </div>
    <div className="legal"><div className="wrap">
      <span>© ${new Date().getFullYear()} ${CO.legal}. All rights reserved. <${PortalStatus} /></span>
      <span><a href="#/terms">Terms of use</a><a style=${{ marginLeft: 18 }} href="#/privacy">Privacy policy</a></span>
    </div></div>
  </footer>`;
}

/* ================= Sections ================= */
const HERO_WORDS = ['network engineers', 'SAP consultants', 'React developers', 'DevOps engineers', 'healthcare IT teams', 'finance professionals'];
const EDGE_PROMPTS = ['Need SAP consultants by next month?', 'Ask me how timesheets work.', 'Want a quote for a project team?', 'Curious about C2C vs W2?'];
function Mascot({ size }) {
  return html`<div className="mascot" style=${{ width: size || 120, height: size || 120 }}><${Bot} big /></div>`;
}
function HeroVisual() {
  return html`<div className="hv" aria-hidden="true">
    <div className="hv-card hv-profile"><div className="hv-head"><span className="av">AK</span><div><b>Anirudh K.</b><span>SAP PP/QM Consultant · Edison, NJ</span></div></div><div className="hv-tags"><span>S/4HANA</span><span>PP</span><span>QM</span><span>H-1B</span></div><div className="hv-row"><span>RTR received</span><${Chip} s="ok">Verified<//></div></div>
    <div className="hv-card hv-ts"><div className="hv-title">Timesheet · week of Sep 28</div><div className="hv-bars">${[8, 8, 8, 8, 8].map((h, i) => html`<i key=${i} style=${{ height: h * 9 + 'px' }} />`)}</div><div className="hv-row"><b>40.0 h</b><${Chip} s="ok">Client approved<//></div></div>
    <div className="hv-card hv-report"><div className="hv-title">This week</div><div className="hv-nums"><div><b>14</b><span>submitted</span></div><div><b>6</b><span>interviews</span></div><div><b>2</b><span>offers</span></div></div></div>
    <div className="hv-mascot"><${Mascot} size=${96} /><span className="hv-bubble">Hi! Ask me anything</span></div>
  </div>`;
}
function Hero() {
  return html`<section className="hero"><div className="wrap">
    <div className="hero-copy">
      <div className="kicker">IT staffing · Software · Cloud · Healthcare IT</div>
      <h1>The right IT people, <em>on your project in days.</em></h1>
      <p className="lead">StratEdge places screened IT and business professionals with US clients and prime vendors, and builds the software, cloud and healthcare systems behind them. One consultant or a full project team, with the paperwork handled.</p>
      <div className="actions"><a className="btn lg" href="#/contact">Book a free consultation</a><a className="btn ghost lg" href="#/request-talent">Request talent</a></div>
      <ul className="hero-trust">${['Screened profiles with RTR in 2 to 5 days', 'Timesheets your managers approve online', 'C2C, W2, contract-to-hire or SOW teams'].map(x => html`<li key=${x}><${Icon} n="check" />${x}</li>`)}</ul>
    </div>
    <${HeroVisual} />
  </div></section>`;
}
const StatsBand = () => html`<section className="stats-band"><div className="wrap"><div className="stats-row">${STATS.map(([n, l]) => html`<${Counter} key=${l} n=${parseInt(n, 10)} suffix="+" label=${l} />`)}<div className="counter roles"><b>2–5</b><span>days to first profiles</span></div></div></div></section>`;
const PortalBand = () => html`<div className="band"><div className="wrap">
  <p><strong>Already working with StratEdge?</strong> Consultants upload a resume, see matched jobs and submit timesheets in the consultant portal. StratEdge staff use the employee portal. Clients approve hours and post requirements in the client portal.</p>
  <div className="actions"><a className="btn go" href=${LOGIN + '?as=consultant'}>Consultant portal</a><a className="btn ghost" href=${LOGIN + '?as=employee'}>Employee portal</a><a className="btn ghost" href=${LOGIN + '?as=client'}>Client portal</a></div></div></div>`;
const PORTALS = [
  { k: 'consultant', t: 'Consultant portal', d: 'For consultants placed by StratEdge, and those on the bench.', pts: ['Upload your resume and get matched to jobs collected from leading job boards every few hours', 'Save, track and apply to the roles that fit', 'Clock in, weekly timesheets, earnings and documents'] },
  { k: 'employee', t: 'Employee portal', d: 'For StratEdge staff: recruiters, delivery and office teams.', pts: ['Clock in and out from any device', 'Recruiting workspace: consultants, RTRs and submissions', 'Tasks, time off, onboarding and documents'] },
  { k: 'client', t: 'Client portal', d: 'For the managers our consultants work with.', pts: ['Approve or return consultant timesheets', 'See who is on site and hours clocked', 'Post requirements and review candidates'] },
  { k: 'hr', t: 'HR & Accounting', d: 'For StratEdge HR and accounting staff.', pts: ['Onboarding, e-signatures and the ATS', 'Invoices, bills, payroll runs and paystubs', 'US and India tax calculations and reports'] },
  { k: 'admin', t: 'Admin portal', d: 'For StratEdge account managers.', pts: ['Final approvals, team and client setup', 'Attendance across every engagement', 'Hours exports for payroll and invoicing'] },
];
const PortalsSec = () => html`<section className="sec alt"><div className="wrap">
  <div className="kicker">Portals</div><h2>Five portals, one login</h2>
  <p className="intro">Everyone signs in with their own account and lands in the portal built for them.</p>
  <div className="portals">${PORTALS.map(p => html`<div key=${p.k} className="portal"><h3>${p.t}</h3><p>${p.d}</p><ul>${p.pts.map(x => html`<li key=${x}>${x}</li>`)}</ul>
    <a className=${'btn ' + (p.k === 'admin' || p.k === 'hr' ? 'ghost' : '')} href=${LOGIN + '?as=' + p.k}>${p.k === 'admin' ? 'Admin sign-in' : p.k === 'hr' ? 'HR sign-in' : 'Open the ' + p.t.toLowerCase()}</a></div>`)}</div>
</div></section>`;

function StaffingFeature() {
  return html`<div className="staff">
    <div><h3>Staffing services</h3>
      <p>Contract, contract-to-hire and direct-hire placements across IT and non-IT roles. We work with end clients directly and as a trusted subcontractor to prime vendors.</p>
      <div className="models">${['C2C', 'W2', '1099', 'Contract-to-hire', 'Direct hire', 'SOW project teams'].map(m => html`<span key=${m}>${m}</span>`)}</div>
      <div className="actions" style=${{ marginTop: 26 }}><a className="btn" href="#/services/staffing">How staffing works</a><a className="btn ghost" href="#/contact">Request talent</a></div>
    </div>
    <div className="facts">
      <div><b>100,000+</b><span>professionals in our talent network</span></div>
      <div><b>IT and beyond</b><span>Including healthcare, and finance & accounting roles</span></div>
      <div><b>One portal</b><span>Attendance, timesheets and approvals for every consultant</span></div>
    </div>
  </div>`;
}
const PILLARS = [
  ['users', 'Staffing', 'Contract, contract-to-hire and direct-hire placements across IT, healthcare and finance. Screened, compliant and tracked in the portal.', '#/services/staffing'],
  ['code', 'Software, web and cloud', 'Custom software, websites, mobile apps, DevOps and ERP/CRM delivered by our own teams.', '#/services/software-development'],
  ['heart', 'Healthcare IT', 'HIPAA-aligned EHR integration, telemedicine, patient portals and clinical SaaS.', '#/services/healthcare'],
];
function ServicesSec({ full }) {
  return html`<section className="sec" id="services"><div className="wrap">
    <div className="head-row"><div><div className="kicker">What we do</div><h2>People when you need people, delivery when you need a product</h2></div>${!full && html`<a className="btn ghost" href="#/services">All services and models</a>`}</div>
    ${!full && html`<div className="pillars">${PILLARS.map(([ic, t, d, href]) => html`<a key=${t} className="pillar" href=${href}><span className="pillar-ico"><${Icon} n=${ic} /></span><h3>${t}</h3><p>${d}</p><span className="more">Learn more</span></a>`)}</div>`}
    ${full ? html`<${ServicesExplorer} />` : html`<div className="svc-grid">${SERVICES.map(s => html`<a key=${s.s} className="svc-card" href=${'#/services/' + s.s}><span className="svc-ico"><${Icon} n=${SERVICE_ICON[s.s]} /></span><div><b>${s.n}</b><span>${s.d}</span></div></a>`)}</div>`}
    ${full && html`<${Fragment}>
      <div className="head-row" style=${{ marginTop: 80 }}><div><div className="kicker">Engagement models</div><h2 style=${{ fontSize: 34 }}>Pick the model that fits your organization</h2><p className="intro">Every placement runs on one of these. We recommend one only after seeing the role.</p></div></div>
      <${ModelsTable} />
    <//>`}
  </div></section>`;
}
const PlansSec = () => html`<section className="sec alt"><div className="wrap">
  <div className="head-row"><div><div className="kicker">Engagement plans</div><h2>Choose how you want to work with us</h2><p className="intro">Every plan includes screened profiles, onboarding paperwork, the client portal and a weekly report. Pricing follows a free consultation; we don\u2019t publish rates because every role is different.</p></div></div>
  <${PlanCards} />
  <p className="muted small" style=${{ marginTop: 18 }}>Not sure which fits? <a href="#/contact">Book a free consultation</a> and an account manager will recommend one.</p>
</div></section>`;
const BenefitsSec = () => html`<section className="sec"><div className="wrap">
  <div className="kicker">What you get</div><h2>What working with StratEdge gives you</h2><p className="intro">The things that come with every engagement, whether you need one person or a team.</p>
  <${BenefitsGrid} />
</div></section>`;
const WalkSec = () => html`<section className="sec"><div className="wrap">
  <div className="head-row"><div><div className="kicker">How it works</div><h2>From request to delivery in five steps</h2><p className="intro">A 30-second tour of how an engagement runs. Hover to pause, or click a step.</p></div></div>
  <${Walkthrough} />
</div></section>`;
const CommitSec = () => html`<section className="sec alt"><div className="wrap">
  <div className="kicker">Our commitment</div><h2>What we commit to</h2><p className="intro">Clear work you can check every week.</p>
  <div className="commit">
    <div><h3>Every business day</h3><ul className="ticks"><li>Screening and submissions for open requirements</li><li>Follow-ups with consultants and your managers</li><li>Updates as soon as a candidate or client responds</li></ul></div>
    <div><h3>Every week</h3><ul className="ticks"><li>An engagement report with every submission and its status</li><li>Timesheets reviewed and approved hours confirmed</li><li>Adjustments to the search based on your feedback</li></ul></div>
    <div className="honest"><h3>What no one can honestly promise</h3><p>A perfect hire in a day, or a guaranteed placement. Clients make the hiring decision and consultants choose where to work. We commit to the screening, the paperwork and the follow-through that make good engagements likely, and we tell you early when a role is hard to fill.</p></div>
  </div>
</div></section>`;
const HomeFaqSec = () => html`<section className="sec"><div className="wrap">
  <div className="head-row"><div><div className="kicker">Questions</div><h2>Common questions</h2></div><a className="btn ghost" href="#/faq">All questions</a></div>
  <div className="faqs" style=${{ maxWidth: 820 }}>${FAQS.slice(0, 6).map(([q, a]) => html`<details key=${q} className="faq"><summary>${q}</summary><p>${a}</p></details>`)}</div>
</div></section>`;
const PlannerSec = () => html`<section className="sec alt"><div className="wrap">
  <div className="head-row"><div><div className="kicker">Build Your Team</div><h2>Assemble the team, send it in one click</h2><p className="intro">Pick roles and headcount. Your plan becomes a talent request, and a recruiter comes back with a timeline and a quote.</p></div></div>
  <${TeamPlanner} />
</div></section>`;
const IndustriesSec = () => html`<section className="sec"><div className="wrap">
  <div className="kicker">Industries</div><h2>Industries we serve</h2>
  <p className="intro">The same people and delivery methods, shaped by the rules and systems of each sector.</p>
  <div className="inds">${INDUSTRIES.map(([n, d]) => html`<div key=${n} className="ind"><h3>${n}</h3><p>${d}</p></div>`)}</div>
</div></section>`;
function HealthSec() {
  const s = SERVICES.find(x => x.s === 'healthcare');
  return html`<section className="sec alt"><div className="wrap hc">
    <div><div className="kicker">Healthcare</div><h2>Healthcare IT, built for compliance</h2>
      <p className="intro">We build and support systems for hospitals, clinics, diagnostic centers and medical research teams, with patient-centered design and the future of connected care in mind.</p>
      <ul>${s.inc.map(i => html`<li key=${i}>${i}</li>`)}</ul>
      <a className="btn" href="#/services/healthcare">Healthcare IT solutions</a>
    </div>
    <div className="stds" aria-label="Standards we build to"><span>Standards we build to</span><b>HIPAA</b><b>HL7</b><b>FHIR</b></div>
  </div></section>`;
}
function ProcessSec({ stats }) {
  return html`<section className="sec"><div className="wrap">
    <div className="kicker">Process</div><h2>How we work</h2>
    <p className="intro">Four steps from first call to delivery, whether you need one consultant or a full project team.</p>
    <div className="steps">
      <div className="step"><h3>Choose a service</h3><p>Tell us whether you need people, a product, or both.</p></div>
      <div className="step"><h3>Define requirements</h3><p>We map your goals, constraints and technical needs together.</p></div>
      <div className="step"><h3>Meet and plan</h3><p>Agree on scope, timeline and deliverables in a working session.</p></div>
      <div className="step"><h3>Deliver and support</h3><p>We place, build or launch, then stay on for ongoing support.</p></div>
    </div>

  </div></section>`;
}
function WhySec() {
  return html`<section className="sec"><div className="wrap why">
    <div><div className="kicker">Why Stratedge</div><h2>A partner that stays accountable</h2><p className="intro">Industry expertise paired with a client-first way of working, so every engagement is secure, scalable and built to last.</p></div>
    <dl>
      <div><dt>Custom web and app development</dt><dd>Built for your workflows instead of adapted from a template.</dd></div>
      <div><dt>UI/UX strategy</dt><dd>Interfaces designed around how your people actually work.</dd></div>
      <div><dt>Real-time monitoring and support</dt><dd>Systems watched and maintained long after launch.</dd></div>
      <div><dt>End-to-end digital transformation</dt><dd>From strategy and staffing through to delivery.</dd></div>
    </dl>
  </div></section>`;
}
function BlogSec({ title }) {
  return html`<section className="sec"><div className="wrap">
    ${title !== false && html`<div className="head-row"><div><div className="kicker">Insights</div><h2>Insights and updates</h2></div><a className="btn ghost" href="#/blog">All posts</a></div>`}
    <div className="posts">${POSTS.map(p => html`<a key=${p.s} className="post" href=${'#/blog/' + p.s}>
      <time>${p.d}</time><div><span className="cat">${p.c}</span><h3>${p.t}</h3></div><span className="muted small">Read article</span></a>`)}</div>
  </div></section>`;
}

/* ================= Contact & inquiries ================= */
async function submitInquiry(data, file) {
  const fd = new FormData();
  Object.entries(data).forEach(([k, v]) => fd.append(k, v == null ? '' : String(v)));
  if (file) fd.append('file', file, file.name);
  await upload('public_contact', fd);
  return true;
}
const mailtoFor = (subject, lines) => `mailto:${CO.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.filter(Boolean).join('\n'))}`;

function ContactForm() {
  const toast = useToast();
  const [f, setF] = useState({ n: '', e: '', ph: '', co: '', sv: '', msg: '' });
  const [ok, setOk] = useState(false);
  const [st, setSt] = useState('idle'); // idle | busy | sent | mail
  const [err, setErr] = useState('');
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const send = async e => {
    e.preventDefault();
    if (!f.n.trim() || !/^\S+@\S+\.\S+$/.test(f.e) || !f.msg.trim()) { setErr('Add your name, a valid email and a short message.'); return; }
    if (!ok) { setErr('Tick the box so we can contact you.'); return; }
    setErr(''); setSt('busy');
    try { await submitInquiry({ k: 'contact', ...f }); setSt('sent'); }
    catch (x) { setSt('mail'); toast(errText(x), true); }
  };
  if (st === 'sent') return html`<div className="cform"><h3>Thanks, ${firstName(f.n)}.</h3><p className="muted">Your message is with our team. We'll reply to ${f.e}.</p></div>`;
  if (st === 'mail') return html`<div className="cform"><h3>Send your message by email</h3>
    <p className="muted" style=${{ margin: '6px 0 18px' }}>The message couldn't be delivered through the site just now, so your details are ready in a new email to ${CO.email}.</p>
    <a className="btn lg" href=${mailtoFor('Consultation request: ' + (f.sv || 'General'), [`Name: ${f.n}`, `Email: ${f.e}`, f.ph && `Phone: ${f.ph}`, f.co && `Company: ${f.co}`, f.sv && `Service: ${f.sv}`, '', f.msg])}><${Icon} n="mail" />Open email</a></div>`;
  return html`<form className="cform form" onSubmit=${send} noValidate>
    <div><h3>Tell us about your need</h3><p className="muted small">Takes about a minute. The right person on our team gets back to you.</p></div>
    <div className="row2"><${Field} label="Full name"><input value=${f.n} onInput=${up('n')} autoComplete="name" required /><//><${Field} label="Work email"><input type="email" value=${f.e} onInput=${up('e')} autoComplete="email" required /><//></div>
    <div className="row2"><${Field} label="Phone"><input type="tel" value=${f.ph} onInput=${up('ph')} autoComplete="tel" /><//><${Field} label="Company"><input value=${f.co} onInput=${up('co')} autoComplete="organization" /><//></div>
    <${Field} label="What can we help with?"><select value=${f.sv} onChange=${up('sv')}><option value="">Choose a service</option>${SERVICES.map(s => html`<option key=${s.s}>${s.n}</option>`)}<option>Something else</option></select><//>
    <${Field} label="Message"><textarea value=${f.msg} onInput=${up('msg')} placeholder="Roles you're hiring for, or the project you have in mind" required /><//>
    <label className="check small"><input type="checkbox" checked=${ok} onChange=${e => setOk(e.target.checked)} /><span>I agree that StratEdge IT Consulting may contact me about its services by email, phone or text. Consent isn’t a condition of purchase.</span></label>
    ${err && html`<p className="err" role="alert">${err}</p>`}
    <div><button className="btn lg" disabled=${st === 'busy'}>${st === 'busy' ? 'Sending…' : 'Send request'}</button></div>
    <p className="muted small">We use these details as described in our <a href="#/privacy">privacy policy</a>.</p>
  </form>`;
}
function ContactSec() {
  return html`<section className="night"><div className="wrap contact">
    <div><div className="kicker">Contact</div><h2>Let's talk about your next hire or project</h2>
      <p className="muted" style=${{ marginTop: 16, fontSize: 18, maxWidth: '46ch' }}>Free consultation, no obligation. Here’s what happens after you send the form.</p>
      <ol className="next-steps"><li>An account manager calls or emails within one business day.</li><li>You walk through the role, timeline and engagement model together.</li><li>You get a plan and a written quote, with no obligation.</li></ol>
      <dl>
        <div><dt>Call us</dt><dd><a href=${'tel:' + CO.tel}>${CO.phone}</a></dd></div>
        <div><dt>Email</dt><dd><a href=${'mailto:' + CO.email}>${CO.email}</a></dd></div>
        <div><dt>Office</dt><dd><a href=${CO.map} target="_blank" rel="noopener">${CO.addr1}<br />${CO.addr2}</a></dd></div>
        <div><dt>Hours</dt><dd>${CO.hours}</dd></div>
      </dl>
    </div>
    <${ContactForm} />
  </div></section>`;
}

/* ================= Pages ================= */
const PageHead = ({ title, intro, crumb }) => html`<div className="phead"><div className="wrap">${crumb && html`<div className="crumb">${crumb}</div>`}<h1>${title}</h1>${intro && html`<p>${intro}</p>`}</div></div>`;
const Home = () => html`<${Fragment}><${Hero} /><${StatsBand} /><${ServicesSec} /><${WalkSec} /><${PlansSec} /><${BenefitsSec} /><${IndustriesSec} /><${HealthSec} /><${PlannerSec} /><${PortalsSec} /><${CommitSec} /><${AssistantSec} /><${HomeFaqSec} /><${BlogSec} /><${ContactSec} /><//>`;
const About = () => html`<${Fragment}>
  <${PageHead} title="About StratEdge" intro="We help organizations hire the right technical talent and build the systems that move their business forward." />
  <section className="sec"><div className="wrap"><div className="prose">
    <p>StratEdge IT Consulting was founded in 2024 and is based in Somerset, New Jersey. We work with end clients directly and alongside prime vendors, placing consultants across network engineering, SAP, software engineering, healthcare IT, and finance and accounting.</p>
    <p>Our delivery team covers web and mobile development, cloud and DevOps, ERP and CRM, and strategic IT consulting, so a staffing relationship can grow into a full project whenever you need it.</p>
    <p>However we work together, the goal is the same: technology that performs, stays secure and supports growth at every stage of your digital journey.</p>
  </div>
  <div className="counters" style=${{ marginTop: 56 }}>${STATS.map(([n, l]) => html`<${Counter} key=${l} n=${parseInt(n, 10)} suffix="+" label=${l} />`)}</div>
  <h2 style=${{ fontSize: 30, margin: '72px 0 24px' }}>What we stand for</h2>
  <div className="inds">${[['Accountable delivery', 'One team owns the outcome, from the first call to support after launch.'], ['Transparent terms', 'Engagement models, rates and timelines are explained before anything is signed.'], ['People first', 'Consultants get real support on assignment, and clients get people who stay.']].map(([n, d]) => html`<div key=${n} className="ind"><h3>${n}</h3><p>${d}</p></div>`)}</div>
  </div></section>
  <${IndustriesSec} /><${WhySec} /><${ProcessSec} /><${ContactSec} />
<//>`;
const ServicesPage = () => html`<${Fragment}><${PageHead} title="Services" intro="Staffing, software and consulting from one partner. Start with the people you need, and add delivery when you're ready." /><${ServicesSec} full /><${PlansSec} /><${PlannerSec} /><${WalkSec} /><${HealthSec} /><${CommitSec} /><${ContactSec} /><//>`;
function ServiceDetail({ slug }) {
  const s = SERVICES.find(x => x.s === slug); const x = SERVICE_EXTRA[slug] || {};
  if (!s) return html`<${NotFound} />`;
  return html`<${Fragment}>
    <${PageHead} crumb=${html`<a href="#/services">Services</a>`} title=${s.n} intro=${s.l} />
    <section className="sec"><div className="wrap">
      ${(x.time || x.team || x.models) && html`<div className="glance">${x.time && html`<div className="card"><span className="lbl2">Timeline</span><b>${x.time}</b></div>`}${x.team && html`<div className="card"><span className="lbl2">Typical team</span><b>${x.team}</b></div>`}${x.models && html`<div className="card"><span className="lbl2">Engagement</span><b>${x.models}</b></div>`}</div>`}
      <div className="g2" style=${{ gap: 48, alignItems: 'start' }}>
        <div><h2 style=${{ fontSize: 28, marginBottom: 24 }}>What we deliver</h2><ul className="incl">${(x.deliver || s.inc).map(i => html`<li key=${i}>${i}</li>`)}</ul></div>
        <div>${x.who && html`<${Fragment}><h2 style=${{ fontSize: 28, marginBottom: 12 }}>Who it's for</h2><p className="muted" style=${{ fontSize: 17, maxWidth: '48ch' }}>${x.who}</p><//>`}
          ${x.tech && html`<${Fragment}><h3 style=${{ fontSize: 18, margin: '28px 0 10px', fontStretch: '108%' }}>Technologies and specialties</h3><div className="models">${x.tech.map(t => html`<span key=${t}>${t}</span>`)}</div><//>`}</div>
      </div>
      ${x.faq && html`<div style=${{ marginTop: 56 }}><h2 style=${{ fontSize: 28, marginBottom: 16 }}>Common questions</h2><div className="faqs">${x.faq.map(([q, a]) => html`<details key=${q} className="faq"><summary>${q}</summary><p>${a}</p></details>`)}</div></div>`}
      <div className="actions" style=${{ marginTop: 36 }}><a className="btn lg" href="#/contact">Book a free consultation</a><a className="btn ghost lg" href=${'tel:' + CO.tel}>Call ${CO.phone}</a></div>
    </div></section>
    <${ProcessSec} />
    <section className="sec alt"><div className="wrap"><h2 style=${{ fontSize: 28, marginBottom: 20 }}>Other services</h2>
      <div className="svc-list">${SERVICES.filter(x => x.s !== s.s).map(x => html`<a key=${x.s} className="svc" href=${'#/services/' + x.s}><h3>${x.n}</h3><p>${x.d}</p></a>`)}</div></div></section>
  <//>`;
}
const BlogPage = () => html`<${Fragment}><${PageHead} title="Blog" intro="Notes from our team on cloud, apps and enterprise software." /><${BlogSec} title=${false} /><//>`;
function BlogPost({ slug }) {
  const p = POSTS.find(x => x.s === slug);
  if (!p) return html`<${NotFound} />`;
  return html`<${Fragment}>
    <${PageHead} crumb=${html`<a href="#/blog">Blog</a>`} title=${p.t} intro=${`${p.c}. Posted ${p.d}.`} />
    <section className="sec"><div className="wrap"><div className="prose">${p.body.map((t, i) => html`<p key=${i}>${t}</p>`)}</div>
      <div className="actions" style=${{ marginTop: 36 }}><a className="btn" href="#/contact">Talk to our team</a><a className="btn ghost" href="#/blog">More posts</a></div></div></section>
    <${BlogSec} />
  <//>`;
}
const LegalPage = ({ title, intro, sections }) => html`<${Fragment}>
  <${PageHead} title=${title} intro=${intro} />
  <section className="sec"><div className="wrap"><div className="prose">${sections.map(([h, t]) => html`<div key=${h}><h2 style=${{ fontSize: 24, marginBottom: 10 }}>${h}</h2><p>${t}</p></div>`)}
    <p className="muted small">Questions about these terms? Contact us at ${CO.email} or ${CO.phone}.</p></div></div></section><//>`;
const TermsPage = () => html`<${LegalPage} title="Terms of use" intro=${'These terms cover the use of this website and the StratEdge employee portal. Last updated ' + new Date().toLocaleDateString([], { month: 'long', year: 'numeric' }) + '.'} sections=${[
  ['Using this site', 'The content on this site describes StratEdge IT Consulting Inc. services and is provided for general information. It is not an offer, a quotation or professional advice, and engagements are governed by the agreement signed for each one.'],
  ['Accuracy', 'We keep the site current but make no guarantee that every detail is complete or error-free. Service descriptions, roles and figures may change without notice.'],
  ['Employee portal', 'Portal access is granted to StratEdge employees, consultants and approved staff. Each person is responsible for the accuracy of the attendance, timesheets and documents they submit, and for keeping their account to themselves. Access can be paused or withdrawn when an engagement ends.'],
  ['Intellectual property', 'The StratEdge name, logo and site content belong to StratEdge IT Consulting Inc. and may not be reused without written permission. Third-party names mentioned on this site belong to their respective owners.'],
  ['Changes', 'We may update these terms from time to time. Continued use of the site after an update means you accept the revised terms.'],
]} />`;
const PrivacyPage = () => html`<${LegalPage} title="Privacy policy" intro="How StratEdge IT Consulting Inc. collects and uses information through this website and the employee portal." sections=${[
  ['What we collect', 'When you contact us or apply for a role, we receive the details you send, such as your name, email, phone number, company and resume. In the employee portal, we collect the profile details you enter, clock-in and clock-out times, timesheets, time-off requests, task updates and the documents you upload.'],
  ['How we use it', 'Contact details are used to respond to your inquiry or application. Portal records are used to manage your engagement: approving timesheets, invoicing clients, running payroll, and keeping compliance documents on file.'],
  ['Who can see it', 'Portal records are visible to you and to StratEdge HR and management staff. Consultants cannot see one another\u2019s records. We share timesheet details with the client or vendor for the engagement they relate to, and with payroll and accounting providers as needed to pay you and bill clients.'],
  ['Retention and your choices', 'We keep engagement records for as long as required for accounting, tax and employment obligations, then remove them. You can review or update your profile in the portal at any time and ask us to correct or delete information by contacting us.'],
  ['Security', 'Portal data is stored on access-controlled infrastructure and protected by individual sign-in. Please report any concern about your account to us right away.'],
]} />`;

function ApplyModal({ job, onClose }) {
  const toast = useToast();
  const [f, setF] = useState({ n: '', e: '', ph: '', li: '', msg: '' });
  const [file, setFile] = useState(null);
  const [st, setSt] = useState('idle');
  const [err, setErr] = useState('');
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const send = async () => {
    if (!f.n.trim() || !/^\S+@\S+\.\S+$/.test(f.e)) { setErr('Add your name and a valid email.'); return; }
    setErr(''); setSt('busy');
    try { await submitInquiry({ k: 'apply', job: job ? job.id : '', jt: job ? job.ti : 'General application', ...f }, file); setSt('sent'); }
    catch (x) { setSt('mail'); toast(errText(x), true); }
  };
  const title = job ? 'Apply: ' + job.ti : 'Send your resume';
  if (st === 'sent') return html`<${Modal} title=${title} onClose=${onClose} foot=${html`<button className="btn" onClick=${onClose}>Done</button>`}><p>Application received. Our recruiting team will review it and contact you at ${f.e}.</p><//>`;
  if (st === 'mail') return html`<${Modal} title=${title} onClose=${onClose}>
    <p className="muted" style=${{ marginBottom: 16 }}>The application couldn't be sent through the site just now. Attach your resume to the email that opens instead.</p>
    <a className="btn lg" href=${mailtoFor('Application: ' + (job ? job.ti : 'General'), [`Name: ${f.n}`, `Email: ${f.e}`, f.ph && `Phone: ${f.ph}`, f.li && `LinkedIn: ${f.li}`, '', f.msg])}><${Icon} n="mail" />Open email</a><//>`;
  return html`<${Modal} title=${title} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${st === 'busy'} onClick=${send}>${st === 'busy' ? 'Sending…' : 'Submit application'}</button>`}>
    <div className="form">
      <div className="row2"><${Field} label="Full name"><input value=${f.n} onInput=${up('n')} autoComplete="name" /><//><${Field} label="Email"><input type="email" value=${f.e} onInput=${up('e')} autoComplete="email" /><//></div>
      <div className="row2"><${Field} label="Phone"><input type="tel" value=${f.ph} onInput=${up('ph')} /><//><${Field} label="LinkedIn or portfolio"><input value=${f.li} onInput=${up('li')} placeholder="https://" /><//></div>
      <${Field} label="Note to the recruiter"><textarea value=${f.msg} onInput=${up('msg')} placeholder="Availability, visa or work authorization, rate expectations" /><//>
      <div><span className="lbl">Resume</span>
        ${file ? html`<ul className="files" style=${{ marginTop: 8 }}><li><div className="fn"><b>${file.name}</b><span>${sizeLabel(file.size)}</span></div><button className="btn ghost sm" onClick=${() => setFile(null)}>Remove</button></li></ul>`
          : html`<div style=${{ marginTop: 8 }}><${FilePick} label="Add your resume." hint="PDF or Word (.docx), up to 5 MB." onFiles=${fs => setFile(fs[0])} /></div>`}
      </div>
      ${err && html`<p className="err" role="alert">${err}</p>`}
    </div><//>`;
}
function Careers() {
  const caps = useCaps();
  const jobs = useCol(caps && caps.db ? 'org/site/jobs' : null, 'at:desc');
  const [apply, setApply] = useState(undefined);
  const [q, setQ] = useState(''); const [fl, setFl] = useState({ loc: '', ty: '', md: '' });
  const all = jobs.docs.filter(j => j.open !== false);
  const opts = k => [...new Set(all.map(j => (j[k] || '').trim()).filter(Boolean))].sort();
  const ql = q.trim().toLowerCase();
  const open = all.filter(j => (!ql || [j.ti, j.loc, j.sk, j.d, j.ty, j.md].filter(Boolean).join(' ').toLowerCase().includes(ql)) && (!fl.loc || j.loc === fl.loc) && (!fl.ty || j.ty === fl.ty) && (!fl.md || j.md === fl.md));
  const isNew = j => j.at && Date.now() - j.at < 7 * 86400000;
  return html`<${Fragment}>
    <${PageHead} title="Careers" intro="Contract, contract-to-hire and full-time roles with StratEdge and our clients across the US." />
    <section className="sec"><div className="wrap">
      <div className="head-row"><h2 style=${{ fontSize: 30 }}>Open roles${all.length ? html` <span className="muted" style=${{ fontSize: 18, fontWeight: 500 }}>(${open.length === all.length ? all.length : open.length + ' of ' + all.length})</span>` : ''}</h2><button className="btn ghost" onClick=${() => setApply(null)}>Send a general application</button></div>
      ${all.length > 0 && html`<div className="jobs-filter"><input type="search" value=${q} onInput=${e => setQ(e.target.value)} placeholder="Search title, skills or location" aria-label="Search roles" />
        <select value=${fl.loc} onChange=${e => setFl({ ...fl, loc: e.target.value })} aria-label="Location"><option value="">All locations</option>${opts('loc').map(v => html`<option key=${v}>${v}</option>`)}</select>
        <select value=${fl.ty} onChange=${e => setFl({ ...fl, ty: e.target.value })} aria-label="Engagement"><option value="">All engagements</option>${opts('ty').map(v => html`<option key=${v}>${v}</option>`)}</select>
        <select value=${fl.md} onChange=${e => setFl({ ...fl, md: e.target.value })} aria-label="Work mode"><option value="">Any work mode</option>${opts('md').map(v => html`<option key=${v}>${v}</option>`)}</select></div>`}
      ${!caps || jobs.loading ? html`<${Spinner} label="Loading open roles…" />` : open.length ? html`<div className="jobs">${open.map(j => html`<div key=${j.id} className="job">
          <div><h3><a href=${'#/careers/' + j.id}>${j.ti}</a>${isNew(j) ? html` <span className="tag new">New</span>` : ''}</h3>${j.at ? html`<div className="muted small">Posted ${fmtDay(j.at)}</div>` : ''}${j.d && html`<p className="muted" style=${{ marginTop: 6, fontSize: 15.5, whiteSpace: 'pre-wrap' }}>${j.d.length > 320 ? j.d.slice(0, 320).replace(/\s+\S*$/, '') + '…' : j.d}</p>`}
            <div className="meta">${[j.loc, j.ty, j.md, j.sk].filter(Boolean).map(t => html`<span key=${t} className="tag">${t}</span>`)}</div></div>
          <div className="actions" style=${{ flexWrap: 'nowrap' }}><${ShareButton} job=${j} /><button className="btn" onClick=${() => setApply(j)}>Apply</button></div></div>`)}</div>`
        : all.length ? html`<div className="panel"><${Empty} title="No roles match that search" action=${html`<button className="btn ghost" onClick=${() => { setQ(''); setFl({ loc: '', ty: '', md: '' }); }}>Clear filters</button>`}>Try a broader search, or send a general application.<//></div>`
        : html`<div className="panel"><${Empty} title="No roles are posted right now">Send your resume and we'll match you with new positions as they open, or email it to ${CO.email}.<//></div>`}
    </div></section>
    <section className="sec alt"><div className="wrap"><h2 style=${{ fontSize: 30 }}>Working with StratEdge</h2>
      <div className="inds" style=${{ marginTop: 28 }}>${[['Your choice of engagement', 'C2C, W2, 1099, contract-to-hire or direct hire, explained before you sign.'], ['One portal for everything', 'Clock in, submit timesheets, request time off and keep documents in one place.'], ['A person to call', 'An account manager who knows your assignment and answers the phone.'], ['Room to grow', 'Short contracts often turn into longer ones and full-time offers with our clients.']].map(([n, d]) => html`<div key=${n} className="ind"><h3>${n}</h3><p>${d}</p></div>`)}</div>
    </div></section>
    <${PortalBand} />
    ${apply !== undefined && html`<${ApplyModal} job=${apply} onClose=${() => setApply(undefined)} />`}
  <//>`;
}
/* ---- share a particular job (link to its own page) ---- */
const jobLink = id => location.origin + location.pathname + '#/careers/' + id;
function ShareButton({ job, primary, small }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const url = jobLink(job.id); const title = `${job.ti} at ${CO.name}`;
  const text = `${job.ti}${job.loc ? ' in ' + job.loc : ''}${job.ty ? ' (' + job.ty + ')' : ''} at StratEdge IT Consulting`;
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast('Link copied.'); } catch (e) { prompt('Copy this link', url); } };
  const native = async () => { try { await navigator.share({ title, text, url }); setOpen(false); } catch (e) { /* cancelled */ } };
  const [f, setF] = useState({ to_n: '', to_e: '', from_n: '', from_e: '', msg: '' }); const [st, setSt] = useState('idle');
  const upf = k => e => setF({ ...f, [k]: e.target.value });
  const sendMailShare = async e => {
    e.preventDefault();
    if (!f.from_n.trim() || !/^\S+@\S+\.\S+$/.test(f.to_e)) { toast('Add your name and a valid email for the person.', true); return; }
    setSt('busy');
    try { const r = await api('public_share', { id: job.id, ...f }); setSt(r.mailed ? 'sent' : 'fail'); if (!r.mailed) toast('The email could not be sent right now. Copy the link instead.', true); }
    catch (x) { setSt('idle'); toast(errText(x), true); }
  };
  const links = [
    ['LinkedIn', 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url)],
    ['WhatsApp', 'https://wa.me/?text=' + encodeURIComponent(text + ' ' + url)],
    ['X', 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(url)],
    ['Facebook', 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url)],
    ['Email', 'mailto:?subject=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(text + '\n\n' + url)],
  ];
  return html`<${Fragment}>
    <button type="button" className=${'btn ' + (primary ? '' : 'ghost') + (small ? ' sm' : '')} onClick=${() => setOpen(true)} aria-haspopup="dialog"><${Icon} n="send" />Share</button>
    ${open && html`<${Modal} title=${'Share: ' + job.ti} onClose=${() => setOpen(false)}>
      <div className="stack" style=${{ gap: 14 }}>
        <p className="muted small" style=${{ margin: 0 }}>Send this role to someone who fits it. The link opens the job with its own Apply button.</p>
        <div style=${{ display: 'flex', gap: 8 }}><input readOnly value=${url} onFocus=${e => e.target.select()} aria-label="Job link" /><button type="button" className="btn" onClick=${copy}>Copy link</button></div>
        <div className="share-row">${typeof navigator.share === 'function' && html`<button type="button" className="btn ghost sm" onClick=${native}>Share…</button>`}${links.map(([n, h]) => html`<a key=${n} className="btn ghost sm" href=${h} target="_blank" rel="noopener noreferrer">${n}</a>`)}</div>
        ${st === 'sent' ? html`<div className="note ok"><span>Sent to ${f.to_e}. They get the job details and a View-and-apply link.</span></div>`
          : html`<form className="form share-mail" onSubmit=${sendMailShare} noValidate>
            <p className="lbl" style=${{ margin: 0 }}>Or email it to someone from here</p>
            <div className="row2"><${Field} label="Their name"><input value=${f.to_n} onInput=${upf('to_n')} /><//><${Field} label="Their email"><input type="email" value=${f.to_e} onInput=${upf('to_e')} /><//></div>
            <div className="row2"><${Field} label="Your name"><input value=${f.from_n} onInput=${upf('from_n')} autoComplete="name" /><//><${Field} label="Your email (for replies)"><input type="email" value=${f.from_e} onInput=${upf('from_e')} autoComplete="email" /><//></div>
            <${Field} label="Note (optional)"><input value=${f.msg} onInput=${upf('msg')} placeholder="e.g. This looks like your kind of project" maxLength="300" /><//>
            <div><button className="btn sm" disabled=${st === 'busy'}><${Icon} n="mail" />${st === 'busy' ? 'Sending…' : 'Email this job'}</button></div>
          </form>`}
      </div><//>`}
  <//>`;
}
function CareerJob({ id }) {
  const caps = useCaps();
  const job = useDoc(caps && caps.db ? `org/site/jobs/${id}` : null);
  const [apply, setApply] = useState(false);
  useEffect(() => { if (job.data) document.title = `${job.data.ti} | Careers | StratEdge IT Consulting`; }, [job.data]);
  if (!caps || job.loading) return html`<${PageHead} title="Careers" intro=${html`<${Spinner} label="Loading the role…" />`} />`;
  const j = job.data;
  if (!j || j.open === false) return html`<${Fragment}><${PageHead} crumb=${html`<a href="#/careers">Careers</a> / Role`} title="This role is no longer open" intro=${html`It may have been filled. <a href="#/careers">See the open roles</a> or send a general application.`} /><section className="sec"><div className="wrap"><a className="btn" href="#/careers">All open roles</a></div></section><//>`;
  return html`<${Fragment}>
    <${PageHead} crumb=${html`<a href="#/careers">Careers</a> / ${j.ti}`} title=${j.ti} intro=${[j.loc, j.ty, j.md].filter(Boolean).join(' · ')} />
    <section className="sec"><div className="wrap"><div className="g2" style=${{ gap: 48, alignItems: 'start' }}>
      <div className="prose">${j.d ? html`<p style=${{ whiteSpace: 'pre-wrap', fontSize: 17 }}>${j.d}</p>` : html`<p className="muted">Contact us for the full description.</p>`}
        ${j.sk && html`<div className="meta" style=${{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 20 }}>${j.sk.split(/,\s*/).filter(Boolean).map(t => html`<span key=${t} className="tag">${t}</span>`)}</div>`}
        ${j.src && j.src.credit && j.src.url && html`<p className="muted small" style=${{ marginTop: 16 }}>Originally listed on <a href=${j.src.url} target="_blank" rel="noopener">${j.src.portal || 'the job board'}</a>.</p>`}
        <div className="actions" style=${{ marginTop: 32 }}><button className="btn lg" onClick=${() => setApply(true)}>Apply for this role</button><${ShareButton} job=${j} /></div></div>
      <aside className="panel"><h3 style=${{ fontSize: 20, marginBottom: 12 }}>At a glance</h3>
        <dl className="kv">${j.loc && html`<dt>Location</dt><dd>${j.loc}</dd>`}${j.ty && html`<dt>Engagement</dt><dd>${j.ty}</dd>`}${j.md && html`<dt>Work mode</dt><dd>${j.md}</dd>`}<dt>Posted</dt><dd>${j.at ? fmtDay(j.at) : '—'}</dd><dt>Questions</dt><dd><a href=${'mailto:' + CO.email}>${CO.email}</a><br /><a href=${'tel:' + CO.tel}>${CO.phone}</a></dd></dl>
        <p className="muted small" style=${{ marginTop: 14 }}>Know someone who fits? Share the link; it opens this page with the Apply button.</p></aside>
    </div></div></section>
    <${PortalBand} />
    ${apply && html`<${ApplyModal} job=${{ ...j, id }} onClose=${() => setApply(false)} />`}
  <//>`;
}
const ContactPage = () => html`<${Fragment}><${PageHead} title="Contact us" intro="Hiring, a new project, or a question about an existing engagement? We're here Monday to Friday, 9 AM to 7 PM Eastern." /><${ContactSec} /><//>`;
const NotFound = () => html`<${PageHead} title="Page not found" intro=${html`That link doesn't match a page on this site. <a href="#/">Go to the home page</a>.`} />`;

function LoginPage({ q }) {
  const c = useCaps(); const toast = useToast();
  const as = q.as; const [mode, setMode] = useState(q.mode === 'register' ? 'register' : 'login');
  const [f, setF] = useState({ n: '', e: '', p: '', p2: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(q.expired ? 'Your session ended. Log in again to continue.' : '');
  const [wrong, setWrong] = useState('');
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const dest = '#/portal' + (as ? '?as=' + as : '');
  const LOGINS = [['consultant', 'Consultant'], ['employee', 'Employee'], ['client', 'Client']];
  const asName = { consultant: 'Consultant', employee: 'Employee', client: 'Client', admin: 'Admin', hr: 'HR and accounting' }[as] || '';
  const submit = async e => {
    e.preventDefault(); setErr(''); setWrong('');
    if (!/^\S+@\S+\.\S+$/.test(f.e)) { setErr('Enter a valid email address.'); return; }
    if (mode === 'register') {
      if (f.n.trim().length < 2) { setErr('Add your full name.'); return; }
      if (f.p.length < 8) { setErr('Use a password of at least 8 characters.'); return; }
      if (f.p !== f.p2) { setErr('The two passwords don\u2019t match.'); return; }
    } else if (!f.p) { setErr('Enter your password.'); return; }
    setBusy(true);
    try {
      startLoginLocation();
      const r = mode === 'register' ? await api('register', { name: f.n.trim(), email: f.e.trim(), password: f.p }) : await api('login', { email: f.e.trim(), password: f.p, as: as || '' });
      await reloadCaps(); shareLoginLocation();
      if (mode === 'register' && r.first) toast('Administrator account created. You manage everything from the Admin section.');
      const staff = r.user && ['admin', 'hr', 'acct'].includes(r.user.role);
      location.hash = staff && mode === 'login' && (!as || as === 'admin' || as === 'hr') ? (as === 'hr' && r.user.role !== 'admin' ? '#/portal/hr' : '#/portal/admin') : (mode === 'login' && r.portal ? '#/portal?as=' + portalKeyOf(r.portal) : dest);
    } catch (x) { if (x && x.code === 'wrong_portal') { setWrong(x.portal || ''); setErr(x.message); } else setErr(errText(x)); }
    setBusy(false);
  };
  const me = c && c.me;
  let body;
  if (!c) body = html`<${Spinner} label="Checking your sign-in…" />`;
  else if (c.state === 'ready') body = html`<${Fragment}>
      <div className="who"><img src=${me.avatarUrl} alt="" /><div><b>${me.name || 'Your account'}</b><span className="muted small">${c.roleName === 'admin' ? 'Admin access' : c.isHR ? 'HR access' : c.isAcct ? 'Accounting access' : me.email}</span></div></div>
      <p className="lbl" style=${{ marginBottom: 8 }}>Open your portal</p>
      <div className="stack" style=${{ gap: 8 }}>
        ${c.portal ? html`<a className="btn lg" href=${'#/portal?as=' + portalKeyOf(c.portal)}>${portalLabel(c.portal)}</a>`
          : c.isAdmin ? null : html`<${Fragment}><a className=${'btn lg' + (as === 'consultant' || !as ? '' : ' ghost')} href="#/portal?as=consultant">Consultant portal</a><a className=${'btn lg' + (as === 'employee' ? '' : ' ghost')} href="#/portal?as=employee">Employee portal</a><a className=${'btn lg' + (as === 'client' ? '' : ' ghost')} href="#/portal?as=client">Client portal</a><//>`}
        ${(c.isHR || c.roleName === 'admin') && html`<a className="btn lg soft" href="#/portal/hr">HR portal</a>`}
        ${(c.isAcct || c.roleName === 'admin') && html`<a className="btn lg soft" href="#/portal/acct">Accounting portal</a>`}
        ${c.roleName === 'admin' && html`<a className="btn lg soft" href="#/portal/admin">Admin portal</a>`}
      </div>
      <p className="muted small" style=${{ marginTop: 16 }}>Your account decides what you see: consultants get the consultant portal, StratEdge staff the employee portal, client contacts the client portal. <button className="btn link small" onClick=${logout}>Log out</button></p>
    <//>`;
  else if (c.state === 'none') body = html`<p className="muted">The portal server isn\u2019t reachable right now. Try again in a few minutes, or email ${CO.email}.</p>`;
  else body = html`<${Fragment}>
      ${as !== 'admin' && as !== 'hr' && html`<div className="seg logins" role="group" aria-label="Which login">${LOGINS.map(([k, v]) => html`<a key=${k} className=${(as || 'consultant') === k ? 'on' : ''} href=${'#/login?as=' + k + (mode === 'register' ? '&mode=register' : '')}>${v}</a>`)}</div>`}
      <div className="tabs" role="tablist">${[['login', 'Log in'], ['register', 'Create account']].map(([k, v]) => html`<button key=${k} type="button" role="tab" aria-selected=${mode === k} className=${mode === k ? 'on' : ''} onClick=${() => { setMode(k); setErr(''); }}>${v}</button>`)}</div>
      <form className="form" onSubmit=${submit} noValidate>
        ${mode === 'register' && html`<${Field} label="Full name"><input value=${f.n} onInput=${up('n')} autoComplete="name" /><//>`}
        <${Field} label="Email"><input type="email" value=${f.e} onInput=${up('e')} autoComplete=${mode === 'register' ? 'email' : 'username'} /><//>
        <${Field} label="Password" hint=${mode === 'register' ? 'At least 8 characters.' : null}><input type="password" value=${f.p} onInput=${up('p')} autoComplete=${mode === 'register' ? 'new-password' : 'current-password'} /><//>
        ${mode === 'register' && html`<${Field} label="Confirm password"><input type="password" value=${f.p2} onInput=${up('p2')} autoComplete="new-password" /><//>`}
        ${err && html`<p className="err" role="alert">${err}${wrong && html` <a href=${'#/login?as=' + wrong}>Go to the ${wrong} login</a>`}</p>`}
        <div><button className="btn lg" style=${{ width: '100%' }} disabled=${busy}>${busy ? 'Please wait…' : mode === 'register' ? 'Create ' + (asName && as !== 'admin' && as !== 'hr' ? asName.toLowerCase() + ' ' : '') + 'account' : asName ? asName + ' log in' : 'Log in'}</button></div>
        ${mode === 'login' ? html`<p className="muted small">Forgot your password? Contact StratEdge HR at <a href=${'mailto:' + CO.email}>${CO.email}</a> and they can reset it.<br />For security, the time, network address and approximate location of each sign-in are recorded; sharing your precise location when the browser asks is optional.</p>`
          : html`<p className="muted small">${as === 'consultant' ? 'After you create your account you\u2019ll fill in a short profile and upload your resume; StratEdge approves your access and matched jobs start appearing.' : as === 'employee' ? 'Employee accounts are for StratEdge staff. After you create yours, an administrator approves it.' : 'After you create your account you\u2019ll fill in a short profile, then StratEdge approves your access.'}</p>`}
      </form>
    <//>`;
  return html`<div className="login">
    <div className="blade"><h1>${as === 'client' ? 'Client portal' : as === 'admin' ? 'Admin portal' : as === 'hr' ? 'HR and accounting portal' : as === 'employee' ? 'Employee portal' : as === 'consultant' ? 'Consultant portal' : 'StratEdge portals'}</h1>
      <ul>${(PORTALS.find(p => p.k === (as || 'consultant')) || PORTALS[0]).pts.map((r, i) => html`<li key=${r} style=${{ animationDelay: (0.1 + i * 0.06) + 's' }}>${r}</li>`)}</ul></div>
    <div className="login-card"><h2>${mode === 'register' && !(c && c.state === 'ready') ? 'Create your ' + (asName && as !== 'admin' && as !== 'hr' ? asName.toLowerCase() + ' ' : '') + 'account' : asName && as !== 'admin' && as !== 'hr' ? asName + ' log in' : 'Log in'}</h2>${body}</div>
  </div>`;
}

const FaqPage = () => html`<${Fragment}>
  <${PageHead} title="Frequently asked questions" intro="Straight answers about how we staff, build and bill. Anything missing? Ask the assistant in the corner, or contact the team." />
  <section className="sec"><div className="wrap"><div className="faqs" style=${{ maxWidth: 820 }}>${FAQS.map(([q, a]) => html`<details key=${q} className="faq"><summary>${q}</summary><p>${a}</p></details>`)}</div>
    <div className="actions" style=${{ marginTop: 36 }}><a className="btn" href="#/contact">Contact us</a><button className="btn ghost" onClick=${() => dispatchEvent(new CustomEvent('edge-open'))}><${Icon} n="chat" />Ask the assistant</button></div></div></section>
<//>`;
function RequestTalent({ q }) {
  const toast = useToast();
  const plan = useMemo(() => { try { return q && q.plan ? JSON.parse(q.plan) : null; } catch (e) { return null; } }, [q && q.plan]);
  const [f, setF] = useState({ co: '', n: '', e: '', ph: '', jt: plan && plan.roles ? plan.roles.join(', ') : '', cnt: plan && plan.roles ? String(plan.roles.reduce((a, r) => a + (parseInt(r, 10) || 1), 0)) : '1', loc: (plan && plan.loc) || '', ty: (plan && plan.ty) || 'C2C', md: (plan && plan.md) || 'Onsite', sd: (plan && plan.sd) || '', sk: '', msg: plan && plan.roles ? 'Team plan from the website:\n' + plan.roles.join('\n') : '' });
  const [st, setSt] = useState('idle'); const [err, setErr] = useState('');
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const send = async e => {
    e.preventDefault();
    if (!f.n.trim() || !/^\S+@\S+\.\S+$/.test(f.e) || !f.jt.trim()) { setErr('Add your name, a valid email and the role you need.'); return; }
    setErr(''); setSt('busy');
    const details = [`Role: ${f.jt}`, `Headcount: ${f.cnt}`, f.loc && `Location: ${f.loc}`, `Engagement: ${f.ty}`, `Work mode: ${f.md}`, f.sd && `Target start: ${f.sd}`, f.sk && `Skills: ${f.sk}`, f.msg && `Notes: ${f.msg}`].filter(Boolean).join('\n');
    try { await submitInquiry({ k: 'talent', n: f.n, e: f.e, ph: f.ph, co: f.co, sv: 'Staffing services', jt: f.jt, msg: details }); setSt('sent'); }
    catch (x) { setSt('mail'); toast(errText(x), true); }
  };
  return html`<${Fragment}>
    <${PageHead} title="Request talent" intro=${plan ? 'Your team plan is filled in below. Add your details and send it; a recruiter comes back with a timeline and a quote.' : 'Tell us who you need. A recruiter reviews it and comes back with a plan, a timeline and a quote. The consultation is free.'} />
    <section className="sec"><div className="wrap"><div className="g2" style=${{ gap: 48, alignItems: 'start' }}>
      ${st === 'sent' ? html`<div className="panel"><h3 style=${{ fontSize: 24, marginBottom: 8 }}>Thanks, ${firstName(f.n)}.</h3><p className="muted">Your request for ${f.jt} is with our recruiting team. We'll reply to ${f.e}${f.ph ? ' or call ' + f.ph : ''}.</p></div>`
        : st === 'mail' ? html`<div className="panel"><h3 style=${{ fontSize: 22, marginBottom: 8 }}>Send it by email instead</h3><p className="muted" style=${{ marginBottom: 16 }}>The request couldn't be sent through the site just now. Your details are ready in a new email.</p>
          <a className="btn lg" href=${mailtoFor('Talent request: ' + f.jt, [`Company: ${f.co}`, `Name: ${f.n}`, `Email: ${f.e}`, `Phone: ${f.ph}`, '', `Role: ${f.jt}`, `Headcount: ${f.cnt}`, `Location: ${f.loc}`, `Engagement: ${f.ty}`, `Work mode: ${f.md}`, `Start: ${f.sd}`, `Skills: ${f.sk}`, '', f.msg])}><${Icon} n="mail" />Open email</a></div>`
        : html`<form className="panel form" onSubmit=${send} noValidate>
          <div className="row2"><${Field} label="Company"><input value=${f.co} onInput=${up('co')} autoComplete="organization" /><//><${Field} label="Your name"><input value=${f.n} onInput=${up('n')} autoComplete="name" /><//></div>
          <div className="row2"><${Field} label="Work email"><input type="email" value=${f.e} onInput=${up('e')} autoComplete="email" /><//><${Field} label="Phone"><input type="tel" value=${f.ph} onInput=${up('ph')} autoComplete="tel" /><//></div>
          <div className="row2"><${Field} label="Role you need"><input value=${f.jt} onInput=${up('jt')} placeholder="e.g. SAP PP/QM Analyst" /><//><${Field} label="How many"><input type="number" min="1" value=${f.cnt} onInput=${up('cnt')} /><//></div>
          <div className="row3"><${Field} label="Location"><input value=${f.loc} onInput=${up('loc')} placeholder="City, state" /><//>
            <${Field} label="Engagement"><select value=${f.ty} onChange=${up('ty')}>${['C2C', 'W2', '1099', 'Contract-to-hire', 'Direct hire', 'SOW project team', 'Not sure yet'].map(t => html`<option key=${t}>${t}</option>`)}</select><//>
            <${Field} label="Work mode"><select value=${f.md} onChange=${up('md')}>${['Onsite', 'Hybrid', 'Remote'].map(t => html`<option key=${t}>${t}</option>`)}</select><//></div>
          <div className="row2"><${Field} label="Target start"><input type="date" value=${f.sd} onInput=${up('sd')} /><//><${Field} label="Must-have skills"><input value=${f.sk} onInput=${up('sk')} placeholder="e.g. S/4HANA, PP, QM" /><//></div>
          <${Field} label="Anything else"><textarea value=${f.msg} onInput=${up('msg')} placeholder="Project, duration, interview process, budget range if you have one" /><//>
          ${err && html`<p className="err" role="alert">${err}</p>`}
          <div><button className="btn lg" disabled=${st === 'busy'}>${st === 'busy' ? 'Sending…' : 'Send request'}</button></div>
        </form>`}
      <div className="stack"><h2 style=${{ fontSize: 28 }}>What happens next</h2>
        <div className="steps" style=${{ gridTemplateColumns: '1fr', marginTop: 8 }}>
          <div className="step"><h3>We review it the same day</h3><p>A recruiter reads the requirement and calls or emails with any questions.</p></div>
          <div className="step"><h3>You get a plan and a quote</h3><p>Engagement model, rate range and a realistic timeline, in writing.</p></div>
          <div className="step"><h3>Screened candidates arrive</h3><p>Profiles land in your client portal, where you shortlist and request interviews.</p></div>
          <div className="step"><h3>Onboarding and timesheets run through us</h3><p>Paperwork, clock-ins and weekly approvals happen in the portal.</p></div>
        </div></div>
    </div></div></section>
  <//>`;
}
function ThemeToggle() {
  const [t, setT] = useState(themeNow());
  const flip = () => { const n = t === 'dark' ? 'light' : 'dark'; setTheme(n); setT(n); };
  return html`<button className="btn ghost icon" onClick=${flip} aria-label=${t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title=${t === 'dark' ? 'Light mode' : 'Dark mode'}><${Icon} n=${t === 'dark' ? 'sun' : 'moon'} /></button>`;
}

/* ================= Edge, the 3D assistant ================= */
function Bot({ small, talking }) {
  const ref = useRef(null);
  const move = e => { const el = ref.current; if (!el) return; const r = el.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5; el.style.setProperty('--ry', (x * 34) + 'deg'); el.style.setProperty('--rx', (-y * 22) + 'deg'); };
  const leave = () => { const el = ref.current; if (el) { el.style.removeProperty('--ry'); el.style.removeProperty('--rx'); } };
  return html`<div className=${'bot' + (small ? ' sm' : '') + (talking ? ' talking' : '')} onMouseMove=${move} onMouseLeave=${leave} aria-hidden="true">
    <div className="bot-scale"><div className="bot-body">
      <div className="bot-ant"><i /></div>
      <div className="bot-turn"><div className="bot-head" ref=${ref}>
        <div className="face front"><span className="eye l" /><span className="eye r" /><span className="cheek l" /><span className="cheek r" /><span className="mouth" /></div>
        <div className="face back" /><div className="face left" /><div className="face right" /><div className="face top" /><div className="face bottom" />
      </div></div>
      <div className="bot-ring" />
    </div><div className="bot-shadow" /></div>
  </div>`;
}
const EDGE_HELLO = { role: 'assistant', content: "Hi, I'm the StratEdge assistant. Ask me about our services, staffing, the portals, careers, or how to reach the team." };
const EDGE_SUGS = ['What services do you offer?', 'How do I submit a timesheet?', 'How do I request talent?', 'How do I get portal access?'];
function EdgeBot() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState(() => { try { return JSON.parse(sessionStorage.getItem('edge-chat') || 'null') || [EDGE_HELLO]; } catch (e) { return [EDGE_HELLO]; } });
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [talk, setTalk] = useState(false);
  const [tip, setTip] = useState(() => { try { return !sessionStorage.getItem('edge-tip'); } catch (e) { return true; } });
  const [tipI, setTipI] = useState(0);
  useEffect(() => { if (!tip || open || REDUCED()) return; const t = setInterval(() => setTipI(i => i + 1), 5000); return () => clearInterval(t); }, [tip, open]);
  const [sugs, setSugs] = useState(EDGE_SUGS);
  const box = useRef(null); const inp = useRef(null);
  const pendingQ = useRef('');
  useEffect(() => { const f = e => { setOpen(true); if (e.detail && e.detail.ask) pendingQ.current = e.detail.ask; }; addEventListener('edge-open', f); return () => removeEventListener('edge-open', f); }, []);
  useEffect(() => { if (open && pendingQ.current) { const q = pendingQ.current; pendingQ.current = ''; setTimeout(() => ask(q), 150); } }, [open]);
  useEffect(() => { try { sessionStorage.setItem('edge-chat', JSON.stringify(msgs.slice(-30))); } catch (e) {} if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [msgs, open, busy]);
  useEffect(() => { if (open) { setTip(false); try { sessionStorage.setItem('edge-tip', '1'); } catch (e) {} setTimeout(() => inp.current && inp.current.focus(), 50); } }, [open]);
  useEffect(() => { if (!tip) return; const t = setTimeout(() => setTip(false), 22000); return () => clearTimeout(t); }, [tip]);
  useEffect(() => { if (!open) return; const k = e => { if (e.key === 'Escape') setOpen(false); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [open]);
  const ask = async q => {
    const content = (q || text).trim(); if (!content || busy) return;
    const next = [...msgs, { role: 'user', content }]; setMsgs(next); setText(''); setBusy(true);
    try {
      const r = await api('chat', { messages: next.filter(m => m.content !== EDGE_HELLO.content).slice(-12) });
      setMsgs(m => [...m, { role: 'assistant', content: r.reply }]); if (r.suggestions) setSugs(r.suggestions);
      setTalk(true); setTimeout(() => setTalk(false), Math.min(6000, 1200 + r.reply.length * 25));
    } catch (e) { setMsgs(m => [...m, { role: 'assistant', content: e.code === 'rate_limited' ? e.message : `I can't reach the server right now. You can always reach the team at ${CO.phone} or ${CO.email}.` }]); }
    setBusy(false);
  };
  return html`<${Fragment}>
    ${open && html`<section className="edge" role="dialog" aria-label="Chat with the StratEdge assistant">
      <div className="edge-h"><${Bot} small talking=${busy || talk} /><div style=${{ flex: 1, minWidth: 0 }}><b>StratEdge</b><span>AI assistant</span></div>
        <button className="btn ghost icon" onClick=${() => { setMsgs([EDGE_HELLO]); setSugs(EDGE_SUGS); }} aria-label="Start over" title="Start over"><${Icon} n="trash" /></button>
        <button className="btn ghost icon" onClick=${() => setOpen(false)} aria-label="Close chat"><${Icon} n="x" /></button></div>
      <div className="edge-m" ref=${box} aria-live="polite">${msgs.map((m, i) => html`<div key=${i} className=${'msg ' + (m.role === 'user' ? 'u' : 'b')}>${m.content}</div>`)}
        ${busy && html`<div className="msg b typing"><i /><i /><i /></div>`}</div>
      ${!busy && html`<div className="sugs">${sugs.slice(0, 4).map(s => html`<button key=${s} type="button" onClick=${() => ask(s)}>${s}</button>`)}</div>`}
      <div className="quick"><a href="#/request-talent" onClick=${() => setOpen(false)}><${Icon} n="users" />Request talent</a><a href="#/login?as=consultant" onClick=${() => setOpen(false)}><${Icon} n="user" />Consultant portal</a><a href="#/login?as=employee" onClick=${() => setOpen(false)}><${Icon} n="users" />Employee portal</a><a href=${'tel:' + CO.tel}><${Icon} n="phone" />Call us</a></div>
      <form className="edge-f" onSubmit=${e => { e.preventDefault(); ask(); }}>
        <input ref=${inp} value=${text} onInput=${e => setText(e.target.value)} placeholder="Ask about services, timesheets, careers…" maxLength="1500" aria-label="Your question" />
        <button className="btn icon" aria-label="Send" disabled=${busy || !text.trim()}><${Icon} n="send" /></button></form>
      <p className="edge-note">The assistant can make mistakes. For anything important, call ${CO.phone}.</p>
    </section>`}
    <div className="edge-launch">
      ${tip && !open && html`<div className="edge-tip" role="status" key=${tipI}>${["Hi, I'm the StratEdge assistant. Ask me anything.", ...EDGE_PROMPTS][tipI % (EDGE_PROMPTS.length + 1)]}</div>`}
      <button className="edge-btn" onClick=${() => setOpen(o => !o)} aria-label=${open ? 'Close chat' : 'Chat with the StratEdge assistant'} aria-expanded=${open}><span className="sonar" /><${Bot} talking=${busy || talk} /></button>
    </div>
  <//>`;
}
