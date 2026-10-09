/* ================= Website content ================= */
const SERVICES = [
  {
    s: 'staffing',
    n: 'Staffing services',
    d: 'Contract, contract-to-hire and direct-hire talent for IT and non-IT roles.',
    l: 'We place consultants with end clients directly and work as a dependable subcontractor to prime vendors. Every engagement is screened, onboarded and supported by our team, with attendance and timesheets tracked in one portal.',
    inc: [
      'Contract and C2C consultants',
      'Contract-to-hire and direct hire',
      'SOW-based project teams',
      'Prime-vendor and subcontract partnerships',
      'IT, healthcare, and finance & accounting roles',
      'Onboarding and timesheet management',
    ],
  },
  {
    s: 'full-time-hiring',
    n: 'Full-time hiring',
    d: 'Permanent employees, screened for you, with a 90-day replacement guarantee.',
    l: 'We find, screen and present candidates for permanent roles on your payroll. You pay a one-time fee when the person starts, and if they leave in the first 90 days we replace them at no extra cost.',
    inc: [
      'A search built around your job description and team',
      'Technical and culture screening before you see anyone',
      'Work authorization, references and background checks',
      'Interview scheduling and feedback in one place',
      'Salary guidance and help through the offer',
      '90-day replacement guarantee',
    ],
  },
  {
    s: 'web-development',
    n: 'Web development',
    d: 'SEO-friendly websites built on scalable frameworks.',
    l: 'Fast, accessible websites that are easy for your team to update and easy for search engines to understand.',
    inc: [
      'Corporate and marketing sites',
      'E-commerce builds',
      'CMS and headless platforms',
      'Performance and technical SEO',
    ],
  },
  {
    s: 'app-development',
    n: 'App development',
    d: 'Secure mobile and web apps with intuitive interfaces.',
    l: 'Native and cross-platform apps for phones, tablets, watches and TVs, built with security and maintainability in mind.',
    inc: ['iOS and Android apps', 'Cross-platform builds', 'Watch and TV apps', 'App modernization'],
  },
  {
    s: 'software-development',
    n: 'Software development',
    d: 'Custom software and SaaS products shaped around your workflows.',
    l: 'Business software and SaaS products designed around the way your organization actually operates, with integrations into the systems you already use.',
    inc: [
      'Custom business software',
      'SaaS product development',
      'APIs and system integration',
      'QA, maintenance and support',
    ],
  },
  {
    s: 'digital-marketing',
    n: 'Digital marketing',
    d: 'Search, social and paid campaigns that bring in qualified leads.',
    l: 'Campaigns planned around measurable outcomes, from organic search to paid social, with reporting you can act on.',
    inc: [
      'Search engine optimization',
      'Social media marketing',
      'Paid search and social',
      'Content and analytics',
    ],
  },
  {
    s: 'ui-ux',
    n: 'UI / UX design',
    d: 'Interfaces designed around how people actually work.',
    l: 'Research-led design that turns complex workflows into clear screens, backed by prototypes you can test before you build.',
    inc: ['User research', 'Wireframes and prototypes', 'Design systems', 'Usability testing'],
  },
  {
    s: 'it-consultancy',
    n: 'IT consultancy',
    d: 'Advice that lines up your IT strategy with business goals.',
    l: 'Independent guidance on architecture, tooling and delivery so technology spending maps directly to business results.',
    inc: [
      'IT strategy and roadmaps',
      'Architecture reviews',
      'Vendor and tool selection',
      'IT project management',
    ],
  },
  {
    s: 'erp-crm',
    n: 'ERP / CRM',
    d: 'Streamlined operations and stronger customer relationships.',
    l: 'Implementation, configuration and support for ERP and CRM platforms, including SAP, with clean data migration and integrations.',
    inc: [
      'SAP and ERP implementation',
      'CRM setup and customization',
      'Data migration',
      'Integrations and support',
    ],
  },
  {
    s: 'devops',
    n: 'DevOps',
    d: 'Faster, safer releases with automated pipelines and cloud infrastructure.',
    l: 'Automated build, test and deployment pipelines on modern cloud infrastructure, monitored around the clock.',
    inc: [
      'CI/CD pipelines',
      'Cloud infrastructure on AWS, Azure and GCP',
      'Containers and Kubernetes',
      'Monitoring and incident response',
    ],
  },
  {
    s: 'healthcare',
    n: 'Healthcare IT solutions',
    d: 'Compliant systems for hospitals, clinics and research teams.',
    l: 'Software for hospitals, clinics, diagnostic centers and research organizations, designed around HIPAA, HL7 and FHIR from day one.',
    inc: [
      'EHR and EMR implementation',
      'HIPAA-compliant telemedicine apps',
      'Remote patient monitoring and IoMT',
      'Healthcare CRM and patient engagement',
      'Medical portals and scheduling',
    ],
  },
  {
    s: 'clinical-saas',
    n: 'Clinical SaaS development',
    d: 'Cloud software for clinical workflows, research and trials.',
    l: 'Secure, interoperable cloud products for clinical teams, from workflow tools to research and trial data platforms.',
    inc: [
      'Clinical workflow applications',
      'Research and trial data platforms',
      'HIPAA-ready hosting',
      'HL7 and FHIR interoperability',
    ],
  },
];
const SERVICE_EXTRA = {
  'full-time-hiring': {
    who: 'Companies hiring permanent engineers, analysts, project managers and healthcare IT or finance staff who want fewer, better candidates and no fee unless someone starts.',
    tech: ['Software engineering', 'Cloud and DevOps', 'Data and AI', 'QA and automation', 'SAP and Salesforce', 'Healthcare IT', 'Project and product management', 'Finance and accounting'],
    deliver: [
      'An intake call to agree the role, the must-haves, the salary range and the interview steps',
      'A shortlist of three to five screened candidates, each with a written summary',
      'Technical screening and reference checks; work authorization confirmed',
      'Interview scheduling and candidate feedback through the client portal',
      'Salary guidance and help through the offer and the start date',
      '90-day replacement guarantee at no extra fee',
    ],
    price: 'A one-time fee of 15% of the first-year base salary, invoiced when the person starts, with a 90-day replacement guarantee.',
    time: 'First shortlist in 5 to 10 business days',
    team: 'Recruiter, technical screener, account manager',
    models: 'Direct hire, contract-to-hire',
    faq: [
      ['What does it cost?', 'A one-time fee of 15% of the first-year base salary, invoiced on the start date. There is no fee if you do not hire.'],
      ['What if the hire does not work out?', 'If the person resigns or is let go for performance within 90 days of starting, we find a replacement at no extra fee.'],
      ['Can we try someone on contract first?', 'Yes. Contract-to-hire lets the person work on your project at an hourly rate before you make the offer; the conversion terms are agreed up front.'],
      ['Do you hire for roles outside IT?', 'Yes: healthcare, finance and accounting, and business roles, as well as every IT specialty.'],
    ],
  },
  staffing: {
    who: 'Hiring managers, procurement and prime vendors who need vetted people on a project quickly.',
    tech: [
      'Network engineering',
      'SAP',
      'React and front-end',
      'Java',
      'Python',
      '.NET',
      'Cloud and DevOps',
      'Healthcare IT',
      'Finance and accounting',
    ],
    deliver: [
      'Screened, interview-ready profiles with RTR',
      'Rate, availability and work-authorization check',
      'Agreements, onboarding and compliance paperwork',
      'Timesheets, approvals and invoicing through the portal',
      'Replacement guarantee on contract placements',
      'A named account manager',
    ],
    time: 'First profiles in 2 to 5 business days',
    team: 'Recruiter, account manager, compliance',
    models: 'C2C, W2, 1099, contract-to-hire, direct hire, SOW teams',
    faq: [
      [
        'How fast can you present candidates?',
        'For common roles we usually present screened profiles within a few business days. Niche roles take longer, and we tell you when that is the case rather than guess.',
      ],
      [
        'Do you handle the paperwork?',
        'Yes. Agreements, onboarding, timesheets and invoicing run through our team and the portal, so your managers only approve hours.',
      ],
      [
        'What if a consultant does not work out?',
        'Tell your account manager. We replace contract placements and re-screen against your feedback.',
      ],
    ],
  },
  'web-development': {
    who: 'Companies that need a site that loads fast, ranks well and can be updated without a developer.',
    tech: ['HTML/CSS/JS', 'React', 'Next.js', 'WordPress', 'Shopify', 'Headless CMS'],
    deliver: [
      'Design system and responsive templates',
      'CMS with editable pages and blog',
      'Lead forms, analytics and SEO setup',
      'Performance budget and accessibility pass',
      'Launch, redirects and search console',
      'Training and a maintenance plan',
    ],
    time: '4 to 10 weeks for a marketing site',
    team: 'Designer, front-end developer, project lead',
    models: 'Fixed scope or monthly retainer',
    faq: [
      [
        'Do you also host and maintain sites?',
        'We can hand over a site for your own hosting or keep maintaining it under a support agreement.',
      ],
      [
        'Can you redesign an existing site?',
        'Yes. We start from your current content and analytics so nothing that works is lost.',
      ],
    ],
  },
  'app-development': {
    who: 'Businesses launching a customer app or replacing an aging internal one.',
    tech: ['Swift', 'Kotlin', 'React Native', 'Flutter', 'watchOS and tvOS', 'Firebase and AWS'],
    deliver: [
      'Clickable prototype and user flows',
      'iOS and Android builds from one codebase where it fits',
      'Backend APIs, push notifications and analytics',
      'App store listings and release management',
      'Crash monitoring and update plan',
    ],
    time: '8 to 16 weeks to a first release',
    team: 'Product designer, mobile engineers, backend engineer, QA',
    models: 'Fixed scope, then support retainer',
    faq: [
      [
        'Native or cross-platform?',
        'It depends on the app. We recommend cross-platform when one codebase can serve both stores well, and native when performance or device features demand it.',
      ],
      [
        'Do you publish to the app stores?',
        'Yes, including store listings, review feedback and updates after launch.',
      ],
    ],
  },
  'software-development': {
    who: 'Teams whose spreadsheets and off-the-shelf tools no longer fit how they work.',
    tech: ['Java', 'Python', '.NET', 'Node.js', 'PostgreSQL and SQL Server', 'REST and GraphQL APIs'],
    deliver: [
      'Discovery report with scoped plan and estimate',
      'Working software in two-week increments',
      'Integrations with the systems you already use',
      'Automated tests and documentation',
      'Source code and deployment runbooks',
      'Support and enhancement backlog',
    ],
    time: 'Discovery in 2 weeks, first release in 6 to 12',
    team: 'Business analyst, tech lead, 2 to 4 engineers, QA',
    models: 'SOW team or dedicated engineers',
    faq: [
      [
        'How do projects start?',
        'With a short discovery phase that produces a scoped plan and estimate before any build work begins.',
      ],
      ['Who owns the code?', 'You do. Source code and documentation are delivered with the product.'],
    ],
  },
  'digital-marketing': {
    who: 'Companies that want measurable leads from search and social, not just traffic.',
    tech: [
      'Google Ads',
      'Meta and LinkedIn Ads',
      'Technical SEO',
      'Analytics and tag management',
      'Email campaigns',
    ],
    deliver: [
      'Keyword and competitor research',
      'Campaign setup across search and social',
      'Landing pages built to convert',
      'Monthly reports on leads and cost per lead',
      'Ongoing optimization',
    ],
    time: 'Setup in 2 to 3 weeks, results compound over 3+ months',
    team: 'Marketing strategist, content writer, ads specialist',
    models: 'Monthly retainer',
    faq: [
      [
        'How do you report results?',
        'Monthly reports tied to the goals we agreed on: leads, cost per lead and conversion, not vanity metrics.',
      ],
      [
        'Is there a minimum term?',
        'Campaigns need a few months to optimize, so we recommend at least three.',
      ],
    ],
  },
  'ui-ux': {
    who: 'Product teams that want interfaces tested with real users before engineering starts.',
    tech: ['Figma', 'Design systems', 'Prototyping', 'Usability testing', 'Accessibility (WCAG)'],
    deliver: [
      'User interviews and journey maps',
      'Wireframes and interactive prototypes',
      'Design system with reusable components',
      'Usability test findings and fixes',
      'Developer-ready specifications',
    ],
    time: '3 to 8 weeks depending on scope',
    team: 'UX researcher, product designer',
    models: 'Fixed scope or embedded designer',
    faq: [
      [
        'Can you work with our developers?',
        'Yes. We deliver specs and components your team can implement directly.',
      ],
      [
        'Do you do research?',
        'User interviews, task analysis and usability tests are part of most engagements.',
      ],
    ],
  },
  'it-consultancy': {
    who: 'Leadership teams making technology decisions that are hard to reverse.',
    tech: [
      'Architecture reviews',
      'Cloud strategy',
      'Vendor evaluation',
      'Security posture',
      'Project and program management',
    ],
    deliver: [
      'Current-state assessment',
      'Roadmap with options, costs and risks',
      'Vendor shortlist and selection criteria',
      'Architecture and security recommendations',
      'Project governance and PMO support',
    ],
    time: 'Assessment in 2 to 4 weeks',
    team: 'Principal consultant, solution architect',
    models: 'Fixed-fee assessment or advisory retainer',
    faq: [
      [
        'Are you tied to specific vendors?',
        'No. Recommendations are independent; we have no resale arrangements that influence them.',
      ],
      [
        'Can you run the project after the plan?',
        'Yes, with our project managers and delivery team or alongside yours.',
      ],
    ],
  },
  'erp-crm': {
    who: 'Operations and finance teams that need their systems to talk to each other.',
    tech: ['SAP S/4HANA', 'SAP PP, QM, MM and FICO', 'Salesforce', 'Microsoft Dynamics', 'Data migration'],
    deliver: [
      'Process mapping and fit-gap analysis',
      'Configuration and custom development',
      'Cleansed and migrated data with rehearsals',
      'Integration with finance, HR and plant systems',
      'User training and hypercare after go-live',
    ],
    time: '3 to 9 months by module and scope',
    team: 'Functional consultants, technical consultants, PM',
    models: 'SOW project or staffed consultants',
    faq: [
      [
        'Do you staff SAP consultants as well as implement?',
        'Both. Many clients start with a functional consultant on contract and grow into a project.',
      ],
      [
        'How do you handle data migration?',
        'With cleansing, mapping and rehearsal migrations before the final cutover.',
      ],
    ],
  },
  devops: {
    who: 'Engineering teams that ship too slowly or lose sleep over production.',
    tech: [
      'AWS, Azure and GCP',
      'Kubernetes and Docker',
      'Terraform',
      'GitHub Actions and Jenkins',
      'Observability tooling',
    ],
    deliver: [
      'Pipeline and infrastructure audit',
      'CI/CD with automated tests and approvals',
      'Infrastructure as code and environments',
      'Monitoring, alerting and runbooks',
      'Cost optimization report',
      'On-call support option',
    ],
    time: 'Audit in 1 to 2 weeks, improvements in sprints',
    team: 'DevOps engineer, cloud architect',
    models: 'SOW or embedded engineers',
    faq: [
      [
        'Can you take over an existing setup?',
        'Yes. We start with an audit of the current pipelines and infrastructure, then improve in steps.',
      ],
      [
        'Do you offer on-call support?',
        'Monitoring and incident response can be part of a support agreement.',
      ],
    ],
  },
  healthcare: {
    who: 'Hospitals, clinics, diagnostic centers and research groups that must stay compliant while modernizing.',
    tech: ['HIPAA', 'HL7 and FHIR', 'EHR and EMR platforms', 'Telemedicine', 'Remote patient monitoring'],
    deliver: [
      'EHR/EMR implementation and integration',
      'HIPAA-compliant telemedicine and patient portals',
      'Remote monitoring and device (IoMT) integration',
      'Healthcare CRM and scheduling',
      'Compliance documentation for your auditors',
    ],
    time: 'Scoped per program; portals in 8 to 14 weeks',
    team: 'Healthcare analyst, integration engineers, security lead',
    models: 'SOW project or staffed healthcare IT roles',
    faq: [
      [
        'How do you handle protected health information?',
        'With HIPAA-aligned design, access controls and encryption from the first day, documented for your compliance team.',
      ],
      ['Can you integrate with our EHR?', 'Yes, through HL7 and FHIR interfaces.'],
    ],
  },
  'clinical-saas': {
    who: 'Clinical teams and research organizations that need secure, interoperable cloud software.',
    tech: [
      'HIPAA-ready hosting',
      'FHIR APIs',
      'Trial and research data platforms',
      'Audit logging',
      'Role-based access',
    ],
    deliver: [
      'Multi-tenant SaaS architecture',
      'Clinical workflow and research modules',
      'FHIR interoperability layer',
      'Audit trails and validation documentation',
      'Hosting, monitoring and release management',
    ],
    time: 'MVP in 12 to 20 weeks',
    team: 'Product lead, full-stack engineers, compliance specialist',
    models: 'SOW product build, then support',
    faq: [
      [
        'Can the platform be white-labeled?',
        'Yes. Multi-tenant SaaS with your branding is a common request.',
      ],
      [
        'What about audit and validation?',
        'Audit trails and validation documentation are built in for regulated environments.',
      ],
    ],
  },
};
const INDUSTRIES = [
  ['Healthcare and life sciences', 'EHR, telemedicine and patient platforms, plus healthcare IT staffing.'],
  [
    'Banking, finance and accounting',
    'Finance and accounting professionals, fintech engineering, compliance-aware delivery.',
  ],
  ['Manufacturing and supply chain', 'SAP PP, QM and MM teams and plant-floor integrations.'],
  ['Telecom and networking', 'Network engineers, security specialists and NOC staffing.'],
  ['Technology and SaaS', 'Product engineering squads, DevOps and cloud specialists.'],
  ['Public sector and education', 'Compliant staffing and portals for institutions and agencies.'],
];
const FAQS = [
  [
    'How quickly can you place a consultant?',
    'For common roles we typically present screened profiles within a few business days. Niche or senior roles can take longer, and we say so up front instead of promising a date we cannot keep.',
  ],
  [
    'Which engagement models do you support?',
    'Contract (C2C, W2 or 1099), contract-to-hire, direct hire and SOW-based project teams. The model follows what fits your organization and the consultant.',
  ],
  [
    'Do you work through prime vendors?',
    'Yes. We work directly with end clients and as a subcontractor to prime vendors and staffing partners, with the paperwork handled by our team.',
  ],
  [
    'How do timesheets and approvals work?',
    'Consultants clock in and submit weekly hours in the employee portal. The client manager approves them in the client portal, StratEdge gives final approval, and invoicing follows the approved hours.',
  ],
  [
    'Where do you operate?',
    'We are based in Somerset, New Jersey, and place consultants across the United States, onsite, hybrid or remote.',
  ],
  [
    'What roles do you cover?',
    'Network engineering, SAP functional and technical, front-end and React, Java, Python and .NET, cloud and DevOps, healthcare IT, and finance and accounting, among others.',
  ],
  [
    'How do I get access to the portals?',
    'Click Log in, create an account, choose consultant or client contact and fill in your profile. StratEdge approves access, usually within one business day.',
  ],
  [
    'Do you build software as well as staff projects?',
    'Yes. Our delivery team builds web and mobile apps, custom software and SaaS, ERP/CRM implementations, DevOps and healthcare IT systems.',
  ],
  [
    'How is pricing determined?',
    'Rates depend on the role, location, duration and engagement model. The first consultation is free and ends with a written quote.',
  ],
  [
    'How do I apply for a role?',
    'Open roles are on the Careers page with an Apply button. You can also send a general application or email your resume to info@stratedgeitconsulting.com.',
  ],
];
const ROLES = [
  'Network engineering',
  'SAP functional & technical',
  'Front-end & React',
  'Java, Python & .NET engineering',
  'Cloud & DevOps',
  'Healthcare IT',
  'Finance & accounting',
];
const POSTS = [
  {
    s: 'cloud-efficiency',
    d: 'Jul 5',
    t: 'Maximizing cloud efficiency: tools and tactics',
    c: 'Cloud solutions',
    body: [
      'Cloud bills grow quietly. Idle instances, oversized databases and forgotten storage buckets rarely show up as a single line item, which is why most teams discover them months late. The first fix is visibility: tag every resource by team and project, and review spend weekly rather than at month end.',
      'Once you can see the spend, the tactics are well understood. Right-size compute from actual utilization instead of launch-day guesses. Schedule non-production environments to shut down overnight and on weekends. Move cold data to cheaper storage tiers, and buy committed-use discounts only for workloads that have proven steady.',
      'The native tools cover most of this: AWS Cost Explorer, Azure Cost Management and Google Cloud Billing all surface anomalies and recommendations. Infrastructure as code keeps environments from drifting, and autoscaling ties capacity to demand. StratEdge runs these reviews with client teams and implements the changes without disrupting production.',
    ],
  },
  {
    s: 'mobile-apps-ai',
    d: 'Jul 3',
    t: 'The future of mobile apps: innovation and AI',
    c: 'App development',
    body: [
      'Mobile apps are moving from screens full of forms toward assistants that anticipate what people need. Models that run on the device make personalization fast and private, the camera and microphone are becoming primary inputs, and offline-first design is expected rather than optional.',
      'Planning for that future means thinking about privacy-preserving inference, accessibility from the first wireframe, and the wider family of surfaces an app now lives on: watches, tablets and TVs. Cross-platform frameworks keep a single codebase viable across all of them.',
      'Our advice is to start with one AI feature tied to a real user problem, measure whether it helps, and keep people in control of the outcome. StratEdge builds iOS, Android and cross-platform apps on exactly these foundations.',
    ],
  },
  {
    s: 'engagement-models',
    d: 'Sep 20',
    t: 'C2C, W2 or 1099: choosing an engagement model',
    c: 'Staffing',
    body: [
      'The three letters on a staffing contract decide who pays taxes, who carries insurance and how quickly an engagement can start. Corp-to-corp (C2C) means the consultant works through their own company and invoices for hours; W2 means they are employed and paid through payroll; 1099 means an independent contractor paid directly.',
      'Clients usually care about three things: compliance, speed and continuity. W2 keeps classification simple. C2C suits experienced consultants who already run a business and carry their own coverage. 1099 fits short, well-defined work by established independents.',
      'StratEdge supports all three, plus contract-to-hire and direct hire, and we recommend the model only after seeing the role. The right choice is the one your legal and finance teams are comfortable with on day one.',
    ],
  },
  {
    s: 'clean-timesheet-process',
    d: 'Sep 12',
    t: 'What a clean timesheet process looks like',
    c: 'Operations',
    body: [
      'Most billing disputes between vendors and clients trace back to the same thing: hours recorded in one place, approved in another, and invoiced from a third. By the time anyone notices a mismatch, three people have to be chased.',
      'A clean process has one record. The consultant logs hours during the week, attaches the client-signed sheet if the client uses one, and submits once. The client manager approves or returns it with a note. The staffing firm checks it against clocked time, gives final approval, and invoices from that approved number.',
      'That is exactly how our portals work: employee, client and admin views of the same timesheet, each with the decisions that belong to them. It removes the Friday scramble for signatures and gives everyone the same number.',
    ],
  },
  {
    s: 'scaling-enterprise-systems',
    d: 'Jul 1',
    t: 'Scaling software systems for enterprise growth',
    c: 'Software engineering',
    body: [
      'Systems that served a hundred users comfortably start to strain at ten thousand. The usual culprits are a single overloaded database, synchronous calls between every component, and deployments that still depend on one person.',
      'Scale in steps. Add observability first so decisions rest on data. Then introduce caching and read replicas, move heavy work to asynchronous queues, and split services only where ownership boundaries are already clear. Rewriting everything at once is the most expensive way to grow.',
      'Process matters as much as architecture: continuous integration and delivery, automated testing, and runbooks for the people on call. StratEdge\u2019s software and DevOps teams help enterprises grow capacity without re-platforming the business.',
    ],
  },
];
const STATS = [
  ['120+', 'happy clients'],
  ['150+', 'projects delivered'],
  ['40+', 'tech experts'],
  ['60+', 'global collaborations'],
];

/* ================= Shell ================= */
// v62: the workspace's logo (moved here from wsite.js: the portal's sidebar draws it before js/site2.js is in)
function WsLogo({ ws, white }) {
  const w = ws || Cap.ws || {};
  const b = w.brand || {};
  return b.logo
    ? html`<img className="wslogo" src=${b.logo} alt=${w.name || ''} height="44" />`
    : html`<span className=${'wslogo-t' + (white ? ' w' : '')} style=${b.color && !white ? { color: b.color } : null}>${w.name || ''}</span>`;
}
const Logo = ({ white }) =>
  wsOn()
    ? html`<${WsLogo} white=${white} />`
    : white
    ? html`<img src=${LOGO_D} alt="StratEdge IT Consulting" width="220" height="56" />`
    : html`<${Fragment}>
        <img className="logo-l" src=${LOGO_L} alt="StratEdge IT Consulting" width="220" height="56" loading="lazy" decoding="async" />
        <img className="logo-d" src=${LOGO_D} alt="StratEdge IT Consulting" width="220" height="56" loading="lazy" decoding="async" />
      <//>`;

function SiteHeader({ path }) {
  const [dd, setDd] = useState(false);
  const [sheet, setSheet] = useState(false);
  const ddRef = useRef(null);
  useEffect(() => {
    setDd(false);
    setSheet(false);
  }, [path]);
  useEffect(() => {
    if (!dd) return;
    const f = e => {
      if (ddRef.current && !ddRef.current.contains(e.target)) setDd(false);
    };
    const k = e => {
      if (e.key === 'Escape') setDd(false);
    };
    addEventListener('mousedown', f);
    addEventListener('keydown', k);
    return () => {
      removeEventListener('mousedown', f);
      removeEventListener('keydown', k);
    };
  }, [dd]);
  const on = p => ((p === '/' ? path === '/' : path.startsWith(p)) ? 'on' : '');
  return html`<${Fragment}>
      <div className="util">
        <div className="wrap">
          <a href=${'tel:' + CO.tel}>
            ${CO.phone}
          </a>
          <a href=${'mailto:' + CO.email}>
            ${CO.email}
          </a>
          <span className="hide-m">
            ${CO.hours}
          </span>
          <a className="push hide-s" href=${CO.linkedin} target="_blank" rel="noopener">LinkedIn</a>
        </div>
      </div>
      <header className="nav">
        <div className="wrap">
          <a className="brand" href="#/" aria-label="StratEdge IT Consulting home">
            <${Logo} />
          </a>
          <nav className="links" aria-label="Main">
            <a className=${on('/')} href="#/">Home</a>
            <a className=${on('/about')} href="#/about">About us</a>
            <div className="dd" ref=${ddRef} onMouseLeave=${() => setDd(false)}>
              <button aria-expanded=${dd} onClick=${() => setDd(v => !v)} onMouseEnter=${() => setDd(true)} className=${on('/services')}>Services <${Icon} n="chev" cls="sm" />
              </button>
              ${
                dd &&
                html`<div className="dd-menu">
                    ${SERVICES.map(s => html`<a key=${s.s} href=${'#/services/' + s.s}>${s.n}<small>${s.d}</small></a>`)}
                  </div>`
              }
            </div>
            <a className=${on('/blog')} href="#/blog">Blog</a>
            <a className=${on('/pricing')} href="#/pricing">Pricing</a>
            <a className=${on('/careers')} href="#/careers">Careers</a>
            <a className=${on('/contact')} href="#/contact">Contact us</a>
          </nav>
          <div className="nav-cta">
            <button className="askbtn hide-m" onClick=${() => dispatchEvent(new CustomEvent('edge-open'))} aria-label="Ask StratEdge AI" title="Ask StratEdge AI">
              <img className="askmark" src="assets/ai-mark.png" alt="" width="24" height="24" />
            </button>
            <a className="btn ghost hide-m" href="#/request-talent">Request talent</a>
            <a className="btn" href=${LOGIN}>Log in</a>
            <button className="btn ghost icon burger" aria-label="Open menu" onClick=${() => setSheet(true)}>
              <${Icon} n="menu" />
            </button>
          </div>
        </div>
      </header>
      ${
        sheet &&
        html`<div className="sheet" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="top-row">
              <a className="brand" href="#/">
                <${Logo} />
              </a>
              <button className="btn ghost icon" aria-label="Close menu" onClick=${() => setSheet(false)}>
                <${Icon} n="x" />
              </button>
            </div>
            <a href="#/">Home</a>
            <a href="#/about">About us</a>
            <a href="#/services">Services</a>
            <div className="sub">
              ${SERVICES.map(s => html`<a key=${s.s} href=${'#/services/' + s.s}>${s.n}</a>`)}
            </div>
            <a href="#/pricing">Pricing</a>
            <a href="#/blog">Blog</a>
            <a href="#/careers">Careers</a>
            <a href="#/faq">FAQ</a>
            <a href="#/support">Help & support</a>
            <a href="#/contact">Contact us</a>
            <div className="actions">
              <a className="btn lg" href=${LOGIN}>Log in to the portal</a>
              <a className="btn ghost lg" href="#/request-talent">Request talent</a>
            </div>
          </div>`
      }
    <//>`;
}

function SiteFooter() {
  return html`<footer className="foot">
      <div className="wrap">
        <div>
          <${Logo} white />
          <p>IT staffing, consulting and software delivery from Somerset, New Jersey.</p>
        </div>
        <div>
          <h4>Company</h4>
          <ul>
            <li>
              <a href="#/about">About us</a>
            </li>
            <li>
              <a href="#/services">Services</a>
            </li>
            <li>
              <a href="#/request-talent">Request talent</a>
            </li>
            <li>
              <a href="#/blog">Blog</a>
            </li>
            <li>
              <a href="#/careers">Careers</a>
            </li>
            <li>
              <a href="#/pricing">Pricing</a>
            </li>
            <li>
              <a href="#/plans">Plans for students & consultants</a>
            </li>
            <li>
              <a href="#/verify">Verify a certificate</a>
            </li>
            <li>
              <a href="#/faq">FAQ</a>
            </li>
            <li>
              <a href="#/support">Help & support</a>
            </li>
            <li>
              <a href="#/contact">Contact us</a>
            </li>
          </ul>
        </div>
        <div>
          <h4>Services</h4>
          <ul>
            ${SERVICES.slice(0, 6).map(s => html`<li key=${s.s}><a href=${'#/services/' + s.s}>${s.n}</a></li>`)}
          </ul>
        </div>
        <div>
          <h4>Get in touch</h4>
          <ul>
            <li>
              <a href=${'tel:' + CO.tel}>
                ${CO.phone}
              </a>
            </li>
            <li>
              <a href=${'mailto:' + CO.email}>
                ${CO.email}
              </a>
            </li>
            <li>
              <a href=${CO.map} target="_blank" rel="noopener">
                ${CO.addr1}, ${CO.addr2}
              </a>
            </li>
            <${FooterSocial} />
            <li>
              <a href=${LOGIN + '?as=consultant'}>Consultant portal</a>
            </li>
            <li>
              <a href=${LOGIN + '?as=employee'}>Employee portal</a>
            </li>
            <li>
              <a href=${LOGIN + '?as=client'}>Client portal</a>
            </li>
            <li>
              <a href=${LOGIN + '?as=student'}>Student portal</a>
            </li>
            <li>
              <button className="btn sm go" style=${{ marginTop: 8 }} onClick=${() => dispatchEvent(new CustomEvent('edge-open'))}>
                <img className="aimark" src="assets/ai-mark.png" alt="" width="18" height="18" />Ask StratEdge AI</button>
            </li>
            <li><${InstallAppButton} className="btn sm ghost" label="Install the StratEdge app" /></li>
          </ul>
        </div>
      </div>
      <div className="legal">
        <div className="wrap">
          <span>© ${new Date().getFullYear()} ${CO.legal}. All rights reserved. <${PortalStatus} />
          </span>
          <span>
            <a href="#/terms">Terms of use</a>
            <a style=${{ marginLeft: 18 }} href="#/privacy">Privacy policy</a>
            <a style=${{ marginLeft: 18 }} href="#/privacy?req=1">Your privacy choices</a>
            <a style=${{ marginLeft: 18 }} href="#/security">Security</a>
          </span>
        </div>
      </div>
    </footer>`;
}

/* ================= Sections ================= */
const HERO_WORDS = [
  'network engineers',
  'SAP consultants',
  'React developers',
  'DevOps engineers',
  'healthcare IT teams',
  'finance professionals',
];
const EDGE_PROMPTS = [
  'Need SAP consultants by next month?',
  'Ask me how timesheets work.',
  'Want a quote for a project team?',
  'Curious about C2C vs W2?',
];
/* v32: the assistant is "StratEdge AI" and wears the StratEdge "S" (it used to be a robot) */
function SMark({ small, big, talking }) {
  return html`<span className=${'smark' + (small ? ' sm' : '') + (big ? ' big' : '') + (talking ? ' talking' : '')} aria-hidden="true"><img src="assets/ai-mark.png" alt="" /></span>`;
}
function Mascot({ size }) {
  return html`<div className="mascot" style=${{ width: size || 120, height: size || 120 }}><${SMark} big /></div>`;
}
function HeroVisual() {
  return html`<div className="hv" aria-hidden="true">
      <div className="hv-card hv-profile">
        <div className="hv-head">
          <span className="av">AK</span>
          <div>
            <b>Anirudh K.</b>
            <span>SAP PP/QM Consultant · Edison, NJ</span>
          </div>
        </div>
        <div className="hv-tags">
          <span>S/4HANA</span>
          <span>PP</span>
          <span>QM</span>
          <span>H-1B</span>
        </div>
        <div className="hv-row">
          <span>RTR received</span>
          <${Chip} s="ok">Verified<//>
        </div>
      </div>
      <div className="hv-card hv-ts">
        <div className="hv-title">Timesheet · week of Sep 28</div>
        <div className="hv-bars">
          ${[8, 8, 8, 8, 8].map((h, i) => html`<i key=${i} style=${{ height: h * 9 + 'px' }} />`)}
        </div>
        <div className="hv-row">
          <b>40.0 h</b>
          <${Chip} s="ok">Client approved<//>
        </div>
      </div>
      <div className="hv-card hv-report">
        <div className="hv-title">This week</div>
        <div className="hv-nums">
          <div>
            <b>14</b>
            <span>submitted</span>
          </div>
          <div>
            <b>6</b>
            <span>interviews</span>
          </div>
          <div>
            <b>2</b>
            <span>offers</span>
          </div>
        </div>
      </div>
      <div className="hv-mascot">
        <${Mascot} size=${96} />
        <span className="hv-bubble">Hi! Ask me anything</span>
      </div>
    </div>`;
}
function Hero() {
  return html`<section className="hero">
      <div className="wrap">
        <div className="hero-copy">
          <div className="kicker">IT staffing · Software · Cloud · Healthcare IT</div>
          <h1>The right IT people, <em>on your project in days.</em>
          </h1>
          <p className="lead">StratEdge places screened IT and business professionals with US clients and prime vendors, and builds the software, cloud and healthcare systems behind them. One consultant or a full project team, with the paperwork handled.</p>
          <div className="actions">
            <a className="btn lg" href="#/contact">Book a free consultation</a>
            <a className="btn ghost lg" href="#/request-talent">Request talent</a>
          </div>
          <ul className="hero-trust">
            ${['Screened profiles with RTR in 2 to 5 days', 'Timesheets your managers approve online', 'C2C, W2, contract-to-hire or SOW teams'].map(x => html`<li key=${x}><${Icon} n="check" />${x}</li>`)}
          </ul>
        </div>
        <${HeroVisual} />
      </div>
    </section>`;
}
const StatsBand = () =>
  html`<section className="stats-band">
      <div className="wrap">
        <div className="stats-row">
          ${STATS.map(([n, l]) => html`<${Counter} key=${l} n=${parseInt(n, 10)} suffix="+" label=${l} />`)}
          <div className="counter roles">
            <b>2–5</b>
            <span>days to first profiles</span>
          </div>
        </div>
      </div>
    </section>`;
const PortalBand = () => html`<div className="band">
    <div className="wrap">
      <p>
        <strong>Already working with StratEdge?</strong> Consultants upload a resume, see matched jobs and submit timesheets in the consultant portal. StratEdge staff use the employee portal. Clients approve hours and post requirements in the client portal.</p>
      <div className="actions">
        <a className="btn go" href=${LOGIN + '?as=consultant'}>Consultant portal</a>
        <a className="btn ghost" href=${LOGIN + '?as=employee'}>Employee portal</a>
        <a className="btn ghost" href=${LOGIN + '?as=client'}>Client portal</a>
      </div>
    </div>
  </div>`;
const PORTALS = [
  {
    k: 'consultant',
    t: 'Consultant portal',
    d: 'For consultants placed by StratEdge, and those on the bench.',
    pts: [
      'Upload your resume and get matched to jobs collected from leading job boards every few hours',
      'Save, track and apply to the roles that fit',
      'Clock in, weekly timesheets, earnings and documents',
    ],
  },
  {
    k: 'employee',
    t: 'Employee portal',
    d: 'For StratEdge staff: recruiters, delivery and office teams.',
    pts: [
      'Clock in and out from any device',
      'Recruiting workspace: consultants, RTRs and submissions',
      'Tasks, time off, onboarding and documents',
    ],
  },
  {
    k: 'client',
    t: 'Client portal',
    d: 'For the managers our consultants work with.',
    pts: [
      'Approve or return consultant timesheets',
      'See who is on site and hours clocked',
      'Post requirements and review candidates',
    ],
  },
  {
    k: 'student',
    t: 'Student portal',
    d: 'For students and trainees learning with StratEdge.',
    pts: [
      'Courses, puzzles and StratEdge certifications you can verify',
      'Daily and weekly tests, live projects and a project vault',
      'A plan that fits, paid online or by bank transfer, and job help when you are ready',
    ],
  },
  {
    k: 'hr',
    t: 'HR & Accounting',
    d: 'For StratEdge HR and accounting staff.',
    pts: [
      'Onboarding, e-signatures and the ATS',
      'Invoices, bills, payroll runs and paystubs',
      'US and India tax calculations and reports',
    ],
  },
  {
    k: 'admin',
    t: 'Admin portal',
    d: 'For StratEdge account managers.',
    pts: [
      'Final approvals, team and client setup',
      'Attendance across every engagement',
      'Hours exports for payroll and invoicing',
    ],
  },
];
const PortalsSec = () => html`<section className="sec alt">
    <div className="wrap">
      <div className="kicker">Portals</div>
      <h2>Six portals, one login</h2>
      <p className="intro">Everyone signs in with their own account and lands in the portal built for them.</p>
      <div className="portals">
        ${PORTALS.map(
          p => html`<div key=${p.k} className="portal">
              <h3>
                ${p.t}
              </h3>
              <p>
                ${p.d}
              </p>
              <ul>
                ${p.pts.map(x => html`<li key=${x}>${x}</li>`)}
              </ul>
              <a className=${'btn ' + (p.k === 'admin' || p.k === 'hr' ? 'ghost' : '')} href=${LOGIN + '?as=' + p.k}>
                ${p.k === 'admin' ? 'Admin sign-in' : p.k === 'hr' ? 'HR sign-in' : 'Open the ' + p.t.toLowerCase()}
              </a>
            </div>`
        )}
      </div>
    </div>
  </section>`;

function StaffingFeature() {
  return html`<div className="staff">
      <div>
        <h3>Staffing services</h3>
        <p>Contract, contract-to-hire and direct-hire placements across IT and non-IT roles. We work with end clients directly and as a trusted subcontractor to prime vendors.</p>
        <div className="models">
          ${['C2C', 'W2', '1099', 'Contract-to-hire', 'Direct hire', 'SOW project teams'].map(m => html`<span key=${m}>${m}</span>`)}
        </div>
        <div className="actions" style=${{ marginTop: 26 }}>
          <a className="btn" href="#/services/staffing">How staffing works</a>
          <a className="btn ghost" href="#/contact">Request talent</a>
        </div>
      </div>
      <div className="facts">
        <div>
          <b>100,000+</b>
          <span>professionals in our talent network</span>
        </div>
        <div>
          <b>IT and beyond</b>
          <span>Including healthcare, and finance & accounting roles</span>
        </div>
        <div>
          <b>One portal</b>
          <span>Attendance, timesheets and approvals for every consultant</span>
        </div>
      </div>
    </div>`;
}
const PILLARS = [
  [
    'users',
    'Staffing',
    'Contract, contract-to-hire and direct-hire placements across IT, healthcare and finance. Screened, compliant and tracked in the portal.',
    '#/services/staffing',
  ],
  [
    'code',
    'Software, web and cloud',
    'Custom software, websites, mobile apps, DevOps and ERP/CRM delivered by our own teams.',
    '#/services/software-development',
  ],
  [
    'heart',
    'Healthcare IT',
    'HIPAA-aligned EHR integration, telemedicine, patient portals and clinical SaaS.',
    '#/services/healthcare',
  ],
];
function ServicesSec({ full }) {
  return html`<section className="sec" id="services">
      <div className="wrap">
        <div className="head-row">
          <div>
            <div className="kicker">What we do</div>
            <h2>People when you need people, delivery when you need a product</h2>
          </div>
          ${!full && html`<a className="btn ghost" href="#/services">All services and models</a>`}
        </div>
        ${
          !full &&
          html`<div className="pillars">
              ${PILLARS.map(
                ([ic, t, d, href]) => html`<a key=${t} className="pillar" href=${href}>
                    <span className="pillar-ico">
                      <${Icon} n=${ic} />
                    </span>
                    <h3>
                      ${t}
                    </h3>
                    <p>
                      ${d}
                    </p>
                    <span className="more">Learn more</span>
                  </a>`
              )}
            </div>`
        }
        ${
          full
            ? html`<${ServicesExplorer} />`
            : html`<div className="svc-grid">
                ${SERVICES.map(
                  s => html`<a key=${s.s} className="svc-card" href=${'#/services/' + s.s}>
                      <span className="svc-ico">
                        <${Icon} n=${SERVICE_ICON[s.s]} />
                      </span>
                      <div>
                        <b>
                          ${s.n}
                        </b>
                        <span>
                          ${s.d}
                        </span>
                      </div>
                    </a>`
                )}
              </div>`
        }
        ${
          full &&
          html`<${Fragment}>
              <div className="head-row" style=${{ marginTop: 80 }}>
                <div>
                  <div className="kicker">Engagement models</div>
                  <h2 style=${{ fontSize: 34 }}>Pick the model that fits your organization</h2>
                  <p className="intro">Every placement runs on one of these. We recommend one only after seeing the role.</p>
                </div>
              </div>
              <${ModelsTable} />
            <//>`
        }
      </div>
    </section>`;
}
const PlansSec = () => html`<section className="sec alt">
    <div className="wrap">
      <div className="head-row">
        <div>
          <div className="kicker">Engagement plans</div>
          <h2>Choose how you want to work with us</h2>
          <p className="intro">Every plan includes screened profiles, onboarding paperwork, the client portal and a weekly report. Pricing follows a free consultation; we don\u2019t publish rates because every role is different.</p>
        </div>
      </div>
      <${PlanCards} />
      <p className="muted small" style=${{ marginTop: 18 }}>Not sure which fits? <a href="#/contact">Book a free consultation</a> and an account manager will recommend one.</p>
    </div>
  </section>`;
const BenefitsSec = () => html`<section className="sec">
    <div className="wrap">
      <div className="kicker">What you get</div>
      <h2>What working with StratEdge gives you</h2>
      <p className="intro">The things that come with every engagement, whether you need one person or a team.</p>
      <${BenefitsGrid} />
    </div>
  </section>`;
const WalkSec = () => html`<section className="sec">
    <div className="wrap">
      <div className="head-row">
        <div>
          <div className="kicker">How it works</div>
          <h2>From request to delivery in five steps</h2>
          <p className="intro">A 30-second tour of how an engagement runs. Hover to pause, or click a step.</p>
        </div>
      </div>
      <${Walkthrough} />
    </div>
  </section>`;
const CommitSec = () => html`<section className="sec alt">
    <div className="wrap">
      <div className="kicker">Our commitment</div>
      <h2>What we commit to</h2>
      <p className="intro">Clear work you can check every week.</p>
      <div className="commit">
        <div>
          <h3>Every business day</h3>
          <ul className="ticks">
            <li>Screening and submissions for open requirements</li>
            <li>Follow-ups with consultants and your managers</li>
            <li>Updates as soon as a candidate or client responds</li>
          </ul>
        </div>
        <div>
          <h3>Every week</h3>
          <ul className="ticks">
            <li>An engagement report with every submission and its status</li>
            <li>Timesheets reviewed and approved hours confirmed</li>
            <li>Adjustments to the search based on your feedback</li>
          </ul>
        </div>
        <div className="honest">
          <h3>What no one can honestly promise</h3>
          <p>A perfect hire in a day, or a guaranteed placement. Clients make the hiring decision and consultants choose where to work. We commit to the screening, the paperwork and the follow-through that make good engagements likely, and we tell you early when a role is hard to fill.</p>
        </div>
      </div>
    </div>
  </section>`;
const HomeFaqSec = () => html`<section className="sec">
    <div className="wrap">
      <div className="head-row">
        <div>
          <div className="kicker">Questions</div>
          <h2>Common questions</h2>
        </div>
        <a className="btn ghost" href="#/faq">All questions</a>
      </div>
      <div className="faqs" style=${{ maxWidth: 820 }}>
        ${FAQS.slice(0, 6).map(([q, a]) => html`<details key=${q} className="faq"><summary>${q}</summary><p>${a}</p></details>`)}
      </div>
    </div>
  </section>`;
const PlannerSec = () => html`<section className="sec alt">
    <div className="wrap">
      <div className="head-row">
        <div>
          <div className="kicker">Build Your Team</div>
          <h2>Assemble the team, send it in one click</h2>
          <p className="intro">Pick roles and headcount. Your plan becomes a talent request, and a recruiter comes back with a timeline and a quote.</p>
        </div>
      </div>
      <${TeamPlanner} />
    </div>
  </section>`;
const IndustriesSec = () => html`<section className="sec">
    <div className="wrap">
      <div className="kicker">Industries</div>
      <h2>Industries we serve</h2>
      <p className="intro">The same people and delivery methods, shaped by the rules and systems of each sector.</p>
      <div className="inds">
        ${INDUSTRIES.map(([n, d]) => html`<div key=${n} className="ind"><h3>${n}</h3><p>${d}</p></div>`)}
      </div>
    </div>
  </section>`;
function HealthSec() {
  const s = SERVICES.find(x => x.s === 'healthcare');
  return html`<section className="sec alt">
      <div className="wrap hc">
        <div>
          <div className="kicker">Healthcare</div>
          <h2>Healthcare IT, built for compliance</h2>
          <p className="intro">We build and support systems for hospitals, clinics, diagnostic centers and medical research teams, with patient-centered design and the future of connected care in mind.</p>
          <ul>
            ${s.inc.map(i => html`<li key=${i}>${i}</li>`)}
          </ul>
          <a className="btn" href="#/services/healthcare">Healthcare IT solutions</a>
        </div>
        <div className="stds" aria-label="Standards we build to">
          <span>Standards we build to</span>
          <b>HIPAA</b>
          <b>HL7</b>
          <b>FHIR</b>
        </div>
      </div>
    </section>`;
}
function ProcessSec({ stats }) {
  return html`<section className="sec">
      <div className="wrap">
        <div className="kicker">Process</div>
        <h2>How we work</h2>
        <p className="intro">Four steps from first call to delivery, whether you need one consultant or a full project team.</p>
        <div className="steps">
          <div className="step">
            <h3>Choose a service</h3>
            <p>Tell us whether you need people, a product, or both.</p>
          </div>
          <div className="step">
            <h3>Define requirements</h3>
            <p>We map your goals, constraints and technical needs together.</p>
          </div>
          <div className="step">
            <h3>Meet and plan</h3>
            <p>Agree on scope, timeline and deliverables in a working session.</p>
          </div>
          <div className="step">
            <h3>Deliver and support</h3>
            <p>We place, build or launch, then stay on for ongoing support.</p>
          </div>
        </div>
      </div>
    </section>`;
}
function WhySec() {
  return html`<section className="sec">
      <div className="wrap why">
        <div>
          <div className="kicker">Why Stratedge</div>
          <h2>A partner that stays accountable</h2>
          <p className="intro">Industry expertise paired with a client-first way of working, so every engagement is secure, scalable and built to last.</p>
        </div>
        <dl>
          <div>
            <dt>Custom web and app development</dt>
            <dd>Built for your workflows instead of adapted from a template.</dd>
          </div>
          <div>
            <dt>UI/UX strategy</dt>
            <dd>Interfaces designed around how your people actually work.</dd>
          </div>
          <div>
            <dt>Real-time monitoring and support</dt>
            <dd>Systems watched and maintained long after launch.</dd>
          </div>
          <div>
            <dt>End-to-end digital transformation</dt>
            <dd>From strategy and staffing through to delivery.</dd>
          </div>
        </dl>
      </div>
    </section>`;
}
function BlogSec({ title }) {
  return html`<section className="sec">
      <div className="wrap">
        ${
          title !== false &&
          html`<div className="head-row">
              <div>
                <div className="kicker">Insights</div>
                <h2>Insights and updates</h2>
              </div>
              <a className="btn ghost" href="#/blog">All posts</a>
            </div>`
        }
        <div className="posts">
          ${POSTS.map(
            p => html`<a key=${p.s} className="post" href=${'#/blog/' + p.s}>
                <time>
                  ${p.d}
                </time>
                <div>
                  <span className="cat">
                    ${p.c}
                  </span>
                  <h3>
                    ${p.t}
                  </h3>
                </div>
                <span className="muted small">Read article</span>
              </a>`
          )}
        </div>
      </div>
    </section>`;
}

/* ================= Contact & inquiries ================= */
async function submitInquiry(data, file) {
  const fd = new FormData();
  Object.entries(data).forEach(([k, v]) => fd.append(k, v == null ? '' : String(v)));
  if (!('website' in data)) fd.append('website', botTrap.hp || '');
  if (!('t0' in data)) fd.append('t0', String(botTrap.t0));
  // v46: the visitor's time zone, so follow-up emails reach them in their working hours
  if (!('tz' in data)) {
    try {
      fd.append('tz', Intl.DateTimeFormat().resolvedOptions().timeZone || '');
    } catch (e) {
      // older browsers: the company's time zone is used
    }
  }
  if (file) fd.append('file', file, file.name);
  const r = await upload('public_contact', fd);
  return r && typeof r === 'object' ? r : { ok: true };
}
const mailtoFor = (subject, lines) =>
  `mailto:${CO.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.filter(Boolean).join('\n'))}`;

function ContactForm() {
  const toast = useToast();
  const [f, setF] = useState({ n: '', e: '', ph: '', co: '', sv: '', msg: '' });
  const [ok, setOk] = useState(false);
  const [st, setSt] = useState('idle'); // idle | busy | sent | mail
  const [err, setErr] = useState('');
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const send = async e => {
    e.preventDefault();
    if (!f.n.trim() || !/^\S+@\S+\.\S+$/.test(f.e) || !f.msg.trim()) {
      setErr('Add your name, a valid email and a short message.');
      return;
    }
    if (!ok) {
      setErr('Tick the box so we can contact you.');
      return;
    }
    setErr('');
    setSt('busy');
    try {
      await submitInquiry({ k: 'contact', ...f });
      setSt('sent');
    } catch (x) {
      setSt('mail');
      toast(errText(x), true);
    }
  };
  if (st === 'sent')
    return html`<div className="cform">
        <h3>Thanks, ${firstName(f.n)}.</h3>
        <p className="muted">Your message is with our team. We'll reply to ${f.e}.</p>
      </div>`;
  if (st === 'mail')
    return html`<div className="cform">
        <h3>Send your message by email</h3>
        <p className="muted" style=${{ margin: '6px 0 18px' }}>The message couldn't be delivered through the site just now, so your details are ready in a new email to ${CO.email}.</p>
        <a className="btn lg" href=${mailtoFor('Consultation request: ' + (f.sv || 'General'), [`Name: ${f.n}`, `Email: ${f.e}`, f.ph && `Phone: ${f.ph}`, f.co && `Company: ${f.co}`, f.sv && `Service: ${f.sv}`, '', f.msg])}>
          <${Icon} n="mail" />Open email</a>
      </div>`;
  return html`<form className="cform form" onSubmit=${send} noValidate>
      <div>
        <h3>Tell us about your need</h3>
        <p className="muted small">Takes about a minute. The right person on our team gets back to you.</p>
      </div>
      <div className="row2">
        <${Field} label="Full name">
          <input value=${f.n} onInput=${up('n')} autoComplete="name" required />
        <//>
        <${Field} label="Work email">
          <input type="email" value=${f.e} onInput=${up('e')} autoComplete="email" required />
        <//>
      </div>
      <div className="row2">
        <${Field} label="Phone">
          <input type="tel" value=${f.ph} onInput=${up('ph')} autoComplete="tel" />
        <//>
        <${Field} label="Company">
          <input value=${f.co} onInput=${up('co')} autoComplete="organization" />
        <//>
      </div>
      <${Field} label="What can we help with?">
        <select value=${f.sv} onChange=${up('sv')}>
          <option value="">Choose a service</option>
          ${SERVICES.map(s => html`<option key=${s.s}>${s.n}</option>`)}
          <option>Something else</option>
        </select>
      <//>
      <${Field} label="Message">
        <textarea value=${f.msg} onInput=${up('msg')} placeholder="Roles you're hiring for, or the project you have in mind" required />
      <//>
      <label className="check small">
        <input type="checkbox" checked=${ok} onChange=${e => setOk(e.target.checked)} />
        <span>I agree that StratEdge IT Consulting may contact me about its services by email, phone or text. Consent isn’t a condition of purchase.</span>
      </label>
      ${err && html`<p className="err" role="alert">${err}</p>`}
      <div>
        <button className="btn lg" disabled=${st === 'busy'}>
          ${st === 'busy' ? 'Sending…' : 'Send request'}
        </button>
      </div>
      <p className="muted small">We use these details as described in our <a href="#/privacy">privacy policy</a>.</p>
    </form>`;
}
function ContactSec() {
  return html`<section className="night">
      <div className="wrap contact">
        <div>
          <div className="kicker">Contact</div>
          <h2>Let's talk about your next hire or project</h2>
          <p className="muted" style=${{ marginTop: 16, fontSize: 18, maxWidth: '46ch' }}>Free consultation, no obligation. Here’s what happens after you send the form.</p>
          <ol className="next-steps">
            <li>An account manager calls or emails within one business day.</li>
            <li>You walk through the role, timeline and engagement model together.</li>
            <li>You get a plan and a written quote, with no obligation.</li>
          </ol>
          <dl>
            <div>
              <dt>Call us</dt>
              <dd>
                <a href=${'tel:' + CO.tel}>
                  ${CO.phone}
                </a>
              </dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>
                <a href=${'mailto:' + CO.email}>
                  ${CO.email}
                </a>
              </dd>
            </div>
            <div>
              <dt>Office</dt>
              <dd>
                <a href=${CO.map} target="_blank" rel="noopener">
                  ${CO.addr1}
                  <br />
                  ${CO.addr2}
                </a>
              </dd>
            </div>
            <div>
              <dt>Hours</dt>
              <dd>
                ${CO.hours}
              </dd>
            </div>
          </dl>
        </div>
        <${ContactForm} />
      </div>
    </section>`;
}

/* ================= Pages ================= */
const PageHead = ({ title, intro, crumb }) =>
  html`<div className="phead">
      <div className="wrap">
        ${crumb && html`<div className="crumb">${crumb}</div>`}
        <h1>
          ${title}
        </h1>
        ${intro && html`<p>${intro}</p>`}
      </div>
    </div>`;
const Home = () =>
  html`<${Fragment}>
      <${Hero} />
      <${StatsBand} />
      <${ServicesSec} />
      <${WalkSec} />
      <${PlansSec} />
      <${BenefitsSec} />
      <${IndustriesSec} />
      <${HealthSec} />
      <${PlannerSec} />
      <${PortalsSec} />
      <${CommitSec} />
      <${AssistantSec} />
      <${HomeFaqSec} />
      <${BlogSec} />
      <${ContactSec} />
    <//>`;
const About = () => html`<${Fragment}>
    <${PageHead} title="About StratEdge" intro="We help organizations hire the right technical talent and build the systems that move their business forward." />
    <section className="sec">
      <div className="wrap">
        <div className="prose">
          <p>StratEdge IT Consulting was founded in 2024 and is based in Somerset, New Jersey. We work with end clients directly and alongside prime vendors, placing consultants across network engineering, SAP, software engineering, healthcare IT, and finance and accounting.</p>
          <p>Our delivery team covers web and mobile development, cloud and DevOps, ERP and CRM, and strategic IT consulting, so a staffing relationship can grow into a full project whenever you need it.</p>
          <p>However we work together, the goal is the same: technology that performs, stays secure and supports growth at every stage of your digital journey.</p>
        </div>
        <div className="counters" style=${{ marginTop: 56 }}>
          ${STATS.map(([n, l]) => html`<${Counter} key=${l} n=${parseInt(n, 10)} suffix="+" label=${l} />`)}
        </div>
        <h2 style=${{ fontSize: 30, margin: '72px 0 24px' }}>What we stand for</h2>
        <div className="inds">
          ${[
            [
              'Accountable delivery',
              'One team owns the outcome, from the first call to support after launch.',
            ],
            [
              'Transparent terms',
              'Engagement models, rates and timelines are explained before anything is signed.',
            ],
            ['People first', 'Consultants get real support on assignment, and clients get people who stay.'],
          ].map(([n, d]) => html`<div key=${n} className="ind"><h3>${n}</h3><p>${d}</p></div>`)}
        </div>
      </div>
    </section>
    <${IndustriesSec} />
    <${WhySec} />
    <${ProcessSec} />
    <${ContactSec} />
  <//>`;
const ServicesPage = () =>
  html`<${Fragment}>
      <${PageHead} title="Services" intro="Staffing, software and consulting from one partner. Start with the people you need, and add delivery when you're ready." />
      <${ServicesSec} full />
      <${CwHireBand} />
      <${PlansSec} />
      <${PlannerSec} />
      <${WalkSec} />
      <${HealthSec} />
      <${CommitSec} />
      <${ContactSec} />
    <//>`;
function ServiceDetail({ slug }) {
  const s = SERVICES.find(x => x.s === slug);
  const x = SERVICE_EXTRA[slug] || {};
  if (!s) return html`<${NotFound} />`;
  return html`<${Fragment}>
      <${PageHead} crumb=${html`<a href="#/services">Services</a>`} title=${s.n} intro=${s.l} />
      <section className="sec">
        <div className="wrap">
          ${
            (x.time || x.team || x.models) &&
            html`<div className="glance">
                ${x.time && html`<div className="card"><span className="lbl2">Timeline</span><b>${x.time}</b></div>`}${x.team && html`<div className="card"><span className="lbl2">Typical team</span><b>${x.team}</b></div>`}${x.models && html`<div className="card"><span className="lbl2">Engagement</span><b>${x.models}</b></div>`}
              </div>`
          }
          <div className="g2" style=${{ gap: 48, alignItems: 'start' }}>
            <div>
              <h2 style=${{ fontSize: 28, marginBottom: 24 }}>What we deliver</h2>
              <ul className="incl">
                ${(x.deliver || s.inc).map(i => html`<li key=${i}>${i}</li>`)}
              </ul>
            </div>
            <div>
              ${
                x.who &&
                html`<${Fragment}>
                    <h2 style=${{ fontSize: 28, marginBottom: 12 }}>Who it's for</h2>
                    <p className="muted" style=${{ fontSize: 17, maxWidth: '48ch' }}>
                      ${x.who}
                    </p>
                  <//>`
              }
              ${
                x.tech &&
                html`<${Fragment}>
                    <h3 style=${{ fontSize: 18, margin: '28px 0 10px', fontStretch: '108%' }}>Technologies and specialties</h3>
                    <div className="models">
                      ${x.tech.map(t => html`<span key=${t}>${t}</span>`)}
                    </div>
                  <//>`
              }
            </div>
          </div>
          ${
            x.faq &&
            html`<div style=${{ marginTop: 56 }}>
                <h2 style=${{ fontSize: 28, marginBottom: 16 }}>Common questions</h2>
                <div className="faqs">
                  ${x.faq.map(([q, a]) => html`<details key=${q} className="faq"><summary>${q}</summary><p>${a}</p></details>`)}
                </div>
              </div>`
          }
          ${x.price && html`<div className="note ok" style=${{ marginTop: 36 }}><span><b>Pricing.</b> ${x.price}</span><div className="actions"><a className="btn sm" href="#/pricing">See all pricing</a></div></div>`}
          <div className="actions" style=${{ marginTop: 36 }}>
            <a className="btn lg" href="#/contact">Book a free consultation</a>
            <a className="btn ghost lg" href=${'tel:' + CO.tel}>Call ${CO.phone}
            </a>
          </div>
        </div>
      </section>
      <${ProcessSec} />
      <section className="sec alt">
        <div className="wrap">
          <h2 style=${{ fontSize: 28, marginBottom: 20 }}>Other services</h2>
          <div className="svc-list">
            ${SERVICES.filter(x => x.s !== s.s).map(x => html`<a key=${x.s} className="svc" href=${'#/services/' + x.s}><h3>${x.n}</h3><p>${x.d}</p></a>`)}
          </div>
        </div>
      </section>
    <//>`;
}
const BlogPage = () =>
  html`<${Fragment}>
      <${PageHead} title="Blog" intro="Notes from our team on cloud, apps and enterprise software." />
      <${BlogSec} title=${false} />
    <//>`;
function BlogPost({ slug }) {
  const p = POSTS.find(x => x.s === slug);
  if (!p) return html`<${NotFound} />`;
  return html`<${Fragment}>
      <${PageHead} crumb=${html`<a href="#/blog">Blog</a>`} title=${p.t} intro=${`${p.c}. Posted ${p.d}.`} />
      <section className="sec">
        <div className="wrap">
          <div className="prose">
            ${p.body.map((t, i) => html`<p key=${i}>${t}</p>`)}
          </div>
          <div className="actions" style=${{ marginTop: 36 }}>
            <a className="btn" href="#/contact">Talk to our team</a>
            <a className="btn ghost" href="#/blog">More posts</a>
          </div>
        </div>
      </section>
      <${BlogSec} />
    <//>`;
}
const LegalPage = ({ title, intro, sections }) => html`<${Fragment}>
    <${PageHead} title=${title} intro=${intro} />
    <section className="sec">
      <div className="wrap">
        <div className="prose">
          ${sections.map(([h, t]) => html`<div key=${h}><h2 style=${{ fontSize: 24, marginBottom: 10 }}>${h}</h2><p>${t}</p></div>`)}
          <p className="muted small">Questions about these terms? Contact us at ${CO.email} or ${CO.phone}.</p>
        </div>
      </div>
    </section>
  <//>`;
const TermsPage = () =>
  html`<${LegalPage} title="Terms of use" intro=${'These terms cover the use of this website and the StratEdge employee portal. Last updated ' + new Date().toLocaleDateString([], { month: 'long', year: 'numeric' }) + '.'} sections=${[
    [
      'Using this site',
      'The content on this site describes StratEdge IT Consulting Inc. services and is provided for general information. It is not an offer, a quotation or professional advice, and engagements are governed by the agreement signed for each one.',
    ],
    [
      'Accuracy',
      'We keep the site current but make no guarantee that every detail is complete or error-free. Service descriptions, roles and figures may change without notice.',
    ],
    [
      'Employee portal',
      'Portal access is granted to StratEdge employees, consultants and approved staff. Each person is responsible for the accuracy of the attendance, timesheets and documents they submit, and for keeping their account to themselves. Access can be paused or withdrawn when an engagement ends.',
    ],
    [
      'Intellectual property',
      'The StratEdge name, logo and site content belong to StratEdge IT Consulting Inc. and may not be reused without written permission. Third-party names mentioned on this site belong to their respective owners.',
    ],
    [
      'Changes',
      'We may update these terms from time to time. Continued use of the site after an update means you accept the revised terms.',
    ],
  ]} />`;
/* v34: the privacy notice (GDPR, UK GDPR, CCPA/CPRA and the other US state laws), with the data request form and
   the confirmation link it emails (#/privacy?confirm=...). PRIV_NOTICE_VER in api/privacy.php names this version. */
const PRIVACY_SECTIONS = [
  ['Who we are', 'StratEdge IT Consulting Inc. ("StratEdge", "we") runs this website, the careers pages and the StratEdge portals for consultants, employees, students, client contacts and staff. We decide how the personal information described here is used. Contact us at the address at the end of this notice.'],
  ['What we collect', 'From you: your name, email, phone, address, resume, work history, skills, work authorization details you choose to share, LinkedIn profile, answers to screening questions, messages, and documents you upload. In the portals: profile details, clock-ins, timesheets, time off, tasks, pay and tax details (employees), bank details for direct deposit, signed documents, course and test results, and the payment status of plans. Automatically: sign-in times, network address, approximate location, browser and device, and security logs. From others: job boards and professional networks where you made your profile available, references you name, and clients or vendors you were submitted to.'],
  ['Sensitive information', 'Some records are sensitive: Social Security or tax numbers, bank accounts, immigration documents, and the optional equal employment opportunity (EEO) answers. We use them only to pay you, meet tax, employment-eligibility and reporting duties, and to sign you in securely; never to profile you or for advertising. EEO answers are voluntary, kept apart from your application and never used in hiring decisions.'],
  ['Why we use it (and our legal bases)', 'To consider you for roles and submit you to clients with your agreement (steps you ask for, or our legitimate interest in staffing); to run an engagement: timesheets, payroll, invoicing and compliance (contract and legal obligation); to keep accounts secure and prevent fraud (legitimate interest and legal obligation); to send updates you asked for (consent, which you can withdraw at any time); and to improve our services. When an assistant feature helps tailor a resume or screen an application, a recruiter reviews the result; no decision with legal or similarly significant effect is made by automated means alone.'],
  ['Who we share it with', 'Clients and vendors you are submitted to (with your agreement), payroll, tax, banking and background-check providers when you are engaged, our email, hosting and payment providers acting on our instructions, and authorities when the law requires it. We do not sell personal information and do not share it for cross-context behavioral advertising.'],
  ['How long we keep it', 'Applications and candidate profiles of people we did not place are deleted after a period without activity (we tell recruiters first so they can keep someone they are working with). Payroll, tax and Form I-9 records are kept for the periods the law requires, generally four to seven years. Security logs are kept for one year. Backups are encrypted and expire on a rolling schedule.'],
  ['How we protect it', 'HTTPS everywhere, encryption at rest for documents and sensitive fields, two-step sign-in for staff, least-privilege access reviewed every quarter, encrypted backups kept off the server, monitoring and a tested incident response plan. If a breach affects your information we will tell you, and the regulators where required, within the legal deadlines. More on the security page.'],
  ['Your rights', 'Depending on where you live, you may ask to know and get a copy of your personal information, correct it, delete it, limit the use of sensitive information, opt out of any sale, sharing or targeted advertising (we do none), and object to or restrict processing (EU and UK). You can withdraw consent at any time. We will not discriminate against you for using these rights. You may use an authorized agent; we will ask the agent for your signed permission and may ask you to confirm your identity.'],
  ['How to make a request', 'Use the form below or email us. We confirm the request through your email address first, so that no one else can ask for your data. We answer within 45 days in the United States (extendable once by 45 days when we tell you why) and within one month in the EU and UK. If we decline a request, we explain why and how to appeal; in the EU and UK you can also complain to your data protection authority.'],
  ['International transfers', 'We are based in the United States and our service providers may process data in the United States and India. For transfers from the EU or UK we rely on the European Commission’s standard contractual clauses (and the UK addendum) or another lawful transfer mechanism.'],
  ['Children', 'Our services are for adults seeking work or training and are not directed to children under 16. We do not knowingly collect their information.'],
  ['Changes to this notice', 'We update this notice when our practices change; the version and date are shown above. When a change is significant we tell portal users when they next sign in.'],
];
const PrivacyPage = ({ q }) => html`<${Fragment}>
    <${PageHead} title="Privacy policy" intro="How StratEdge IT Consulting Inc. collects, uses and protects personal information on this website and in the StratEdge portals. Version 2026-10, effective October 2026." />
    <section className="sec">
      <div className="wrap g32" style=${{ alignItems: 'start', gap: 36 }}>
        <div className="prose">
          ${PRIVACY_SECTIONS.map(([h, t]) => html`<div key=${h}><h2 style=${{ fontSize: 24, marginBottom: 10 }}>${h}</h2><p>${t}</p></div>`)}
          <p>See also: <a href="#/security">Security at StratEdge</a> · <a href="#/terms">Terms of use</a></p>
          <p className="muted small">Contact: ${CO.legal}, ${CO.email}, ${CO.phone}. Please write "Privacy" in the subject.</p>
        </div>
        <div className="stickyside"><${PrivacyRequest} q=${q || {}} /></div>
      </div>
    </section>
  <//>`;

const EEO_Q = [
  ['gender', 'Gender', ['Female', 'Male', 'Non-binary', 'I prefer not to say']],
  ['race', 'Race / ethnicity', ['Hispanic or Latino', 'White', 'Black or African American', 'Asian', 'American Indian or Alaska Native', 'Native Hawaiian or Other Pacific Islander', 'Two or more races', 'I prefer not to say']],
  ['veteran', 'Veteran status', ['I am not a protected veteran', 'I am a protected veteran', 'I prefer not to say']],
  ['disability', 'Disability', ['Yes, I have a disability (or previously had one)', 'No, I do not have a disability', 'I prefer not to say']],
];
function ApplyModal({ job, onClose, prefill }) {
  const toast = useToast();
  const [f, setF] = useState({ n: (prefill && prefill.name) || '', e: (prefill && prefill.email) || '', ph: '', li: '', msg: '' });
  const [file, setFile] = useState(null);
  const [st, setSt] = useState('idle');
  const [err, setErr] = useState('');
  const [ans, setAns] = useState({});
  const [eeo, setEeo] = useState({});
  // v34: the applicant agrees to the privacy notice (the server records the time, version and address)
  const [agree, setAgree] = useState(false);
  // v36: one key per form, so sending it twice (a double click, a retry) gives back the same receipt
  const rk = useMemo(() => nid() + nid() + nid(), []);
  const [res, setRes] = useState(null);
  const qs = (job && Array.isArray(job.qs) ? job.qs : []).filter(q => q && q.id && q.q);
  const ref = (() => {
    const m = /[?&]ref=([A-Za-z0-9_-]{1,40})/.exec(location.hash);
    return m ? m[1] : '';
  })();
  // v33: a job board link (job.php?src=dice) names the board the applicant came from
  const srcTag = (() => {
    const m = /[?&]src=([a-z]{2,20})/.exec(location.hash);
    return m ? m[1] : '';
  })();
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const send = async () => {
    if (!f.n.trim() || !/^\S+@\S+\.\S+$/.test(f.e)) {
      setErr('Add your name and a valid email.');
      return;
    }
    const missing = qs.filter(q => q.req !== false && (ans[q.id] == null || String(ans[q.id]).trim() === ''));
    if (missing.length) {
      setErr('Please answer: ' + missing.map(q => q.q).join('; '));
      return;
    }
    if (!agree) {
      setErr('Tick the box to agree to the privacy notice, so we can keep your application.');
      return;
    }
    setErr('');
    setSt('busy');
    try {
      setRes(
        await submitInquiry(
          { k: 'apply', job: job ? job.id : '', jt: job ? job.ti : 'General application', ...f, answers: JSON.stringify(ans), eeo: job && job.eeo ? JSON.stringify(eeo) : '', ref, src: srcTag, consent: '1', rk },
          file
        )
      );
      setSt('sent');
    } catch (x) {
      if (x && ['consent', 'invalid_argument'].includes(x.code)) {
        setSt('idle');
        setErr(errText(x));
        return;
      }
      setSt('mail');
      toast(errText(x), true);
    }
  };
  const title = job ? 'Apply: ' + job.ti : 'Send your resume';
  if (st === 'sent')
    return html`<${Modal} title=${title} onClose=${onClose} foot=${html`<button className="btn" onClick=${onClose}>Done</button>`}>
        <div className="stack" style=${{ gap: 12 }}>
          ${
            res && res.again
              ? html`<p>You already applied${res.title ? ' for ' + res.title : ''}${res.first ? ' on ' + fmtDay(res.first) : ''}. We added this to your application, so there is still one for our recruiting team to review.</p>`
              : html`<p>Application received. Our recruiting team will review it and contact you at ${f.e}.</p>`
          }
          ${res && res.receipt && html`<p className="note info" style=${{ margin: 0 }}><span>Your receipt number is <b>${res.receipt}</b>. We emailed a copy to ${f.e}; mention it if you contact us about this application.</span></p>`}
          ${res && res.closed && html`<p className="note amber" style=${{ margin: 0 }}><span>This role closed before your application arrived. We kept your application and will contact you if a similar role opens. <a href="#/careers">See the open roles</a>.</span></p>`}
        </div>
      <//>`;
  if (st === 'mail')
    return html`<${Modal} title=${title} onClose=${onClose}>
        <p className="muted" style=${{ marginBottom: 16 }}>The application couldn't be sent through the site just now. Attach your resume to the email that opens instead.</p>
        <a className="btn lg" href=${mailtoFor('Application: ' + (job ? job.ti : 'General'), [`Name: ${f.n}`, `Email: ${f.e}`, f.ph && `Phone: ${f.ph}`, f.li && `LinkedIn: ${f.li}`, '', f.msg])}>
          <${Icon} n="mail" />Open email</a>
      <//>`;
  return html`<${Modal} title=${title} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button>
    <button className="btn" disabled=${st === 'busy'} onClick=${send}>
      ${st === 'busy' ? 'Sending…' : 'Submit application'}
    </button>`}>
      <div className="form">
        <${BotTrap} />
        <div className="row2">
          <${Field} label="Full name">
            <input value=${f.n} onInput=${up('n')} autoComplete="name" />
          <//>
          <${Field} label="Email">
            <input type="email" value=${f.e} onInput=${up('e')} autoComplete="email" />
          <//>
        </div>
        <div className="row2">
          <${Field} label="Phone">
            <input type="tel" value=${f.ph} onInput=${up('ph')} />
          <//>
          <${Field} label="LinkedIn or portfolio">
            <input value=${f.li} onInput=${up('li')} placeholder="https://" />
          <//>
        </div>
        ${
          qs.length > 0 &&
          html`<div className="stack" style=${{ gap: 10 }}>
              <span className="lbl">A few questions about this role</span>
              ${qs.map(q => html`<${Field} key=${q.id} label=${q.q + (q.req === false ? ' (optional)' : '')}>
                  ${q.type === 'yesno' ? html`<div className="seg">${[['yes', 'Yes'], ['no', 'No']].map(([v, n]) => html`<button key=${v} type="button" className=${ans[q.id] === v ? 'on' : ''} onClick=${() => setAns({ ...ans, [q.id]: v })}>${n}</button>`)}</div>` : q.type === 'select' ? html`<select value=${ans[q.id] || ''} onChange=${e => setAns({ ...ans, [q.id]: e.target.value })}><option value="">Choose…</option>${String(q.opts || '').split('|').map(o => o.trim()).filter(Boolean).map(o => html`<option key=${o}>${o}</option>`)}</select>` : q.type === 'number' ? html`<input type="number" value=${ans[q.id] || ''} onInput=${e => setAns({ ...ans, [q.id]: e.target.value })} />` : html`<input value=${ans[q.id] || ''} onInput=${e => setAns({ ...ans, [q.id]: e.target.value })} />`}
                <//>`)}
            </div>`
        }
        <${Field} label="Note to the recruiter">
          <textarea value=${f.msg} onInput=${up('msg')} placeholder="Availability, visa or work authorization, rate expectations" />
        <//>
        <div>
          <span className="lbl">Resume</span>
          ${
            file
              ? html`<ul className="files" style=${{ marginTop: 8 }}>
                  <li>
                    <div className="fn">
                      <b>
                        ${file.name}
                      </b>
                      <span>
                        ${sizeLabel(file.size)}
                      </span>
                    </div>
                    <button className="btn ghost sm" onClick=${() => setFile(null)}>Remove</button>
                  </li>
                </ul>`
              : html`<div style=${{ marginTop: 8 }}>
                  <${FilePick} label="Add your resume." hint="PDF or Word (.docx), up to 5 MB." onFiles=${fs => setFile(fs[0])} />
                </div>`
          }
        </div>
        ${
          job && job.eeo &&
          html`<details>
              <summary className="small">Voluntary self-identification (optional)</summary>
              <p className="muted small">StratEdge is an equal opportunity employer. These questions are voluntary, are kept separate from your application, are never seen by the people who decide on it, and are reported only in aggregate for government compliance.</p>
              <div className="form">${EEO_Q.map(([k, label, opts]) => html`<${Field} key=${k} label=${label}><select value=${eeo[k] || ''} onChange=${e => setEeo({ ...eeo, [k]: e.target.value })}><option value="">—</option>${opts.map(o => html`<option key=${o}>${o}</option>`)}</select><//>`)}</div>
            </details>`
        }
        ${ref && html`<p className="muted small">Referred by a StratEdge team member (code ${ref}).</p>`}
        <label className="check small"><input type="checkbox" checked=${agree} onChange=${e => setAgree(e.target.checked)} /><span>I agree that StratEdge may keep and use my application to consider me for this and similar roles, as described in the <a href="#/privacy" target="_blank" rel="noopener">privacy notice</a>. I can ask for it to be deleted at any time.</span></label>
        ${err && html`<p className="err" role="alert">${err}</p>`}
      </div>
    <//>`;
}
function Careers() {
  const caps = useCaps();
  const jobs = useCol(caps && caps.db ? 'org/site/jobs' : null, 'at:desc');
  const [apply, setApply] = useState(undefined);
  const [q, setQ] = useState('');
  const [fl, setFl] = useState({ loc: '', ty: '', md: '' });
  const all = jobs.docs.filter(j => j.open !== false && !j.internal); // internal-only postings open by direct link
  const opts = k => [...new Set(all.map(j => (j[k] || '').trim()).filter(Boolean))].sort();
  const ql = q.trim().toLowerCase();
  const open = all.filter(
    j =>
      (!ql || [j.code, j.ti, j.loc, j.sk, j.d, j.ty, j.md].filter(Boolean).join(' ').toLowerCase().includes(ql)) &&
      (!fl.loc || j.loc === fl.loc) &&
      (!fl.ty || j.ty === fl.ty) &&
      (!fl.md || j.md === fl.md)
  );
  const isNew = j => j.at && Date.now() - j.at < 7 * 86400000;
  return html`<${Fragment}>
      <${PageHead} title="Careers" intro="Contract, contract-to-hire and full-time roles with StratEdge and our clients across the US." />
      <section className="sec">
        <div className="wrap">
          <div className="head-row">
            <h2 style=${{ fontSize: 30 }}>Open roles${all.length ? html` <span className="muted" style=${{ fontSize: 18, fontWeight: 500 }}>(${open.length === all.length ? all.length : open.length + ' of ' + all.length})</span>` : ''}
            </h2>
            <button className="btn ghost" onClick=${() => setApply(null)}>Send a general application</button>
          </div>
          ${
            all.length > 0 &&
            html`<div className="jobs-filter">
                <input type="search" value=${q} onInput=${e => setQ(e.target.value)} placeholder="Search title, skills or location" aria-label="Search roles" />
                <select value=${fl.loc} onChange=${e => setFl({ ...fl, loc: e.target.value })} aria-label="Location">
                  <option value="">All locations</option>
                  ${opts('loc').map(v => html`<option key=${v}>${v}</option>`)}
                </select>
                <select value=${fl.ty} onChange=${e => setFl({ ...fl, ty: e.target.value })} aria-label="Engagement">
                  <option value="">All engagements</option>
                  ${opts('ty').map(v => html`<option key=${v}>${v}</option>`)}
                </select>
                <select value=${fl.md} onChange=${e => setFl({ ...fl, md: e.target.value })} aria-label="Work mode">
                  <option value="">Any work mode</option>
                  ${opts('md').map(v => html`<option key=${v}>${v}</option>`)}
                </select>
              </div>`
          }
          ${
            !caps || jobs.loading
              ? html`<${Spinner} label="Loading open roles…" />`
              : open.length
                ? html`<div className="jobs">
                    ${open.map(
                      j => html`<div key=${j.id} className="job">
                          <div>
                            <h3>
                              <a href=${'#/careers/' + j.id}>
                                ${j.ti}
                              </a>
                              ${isNew(j) ? html` <span className="tag new">New</span>` : ''}
                            </h3>
                            ${j.at ? html`<div className="muted small">Posted ${fmtDay(j.at)}</div>` : ''}${
                              j.d &&
                              html`<p className="muted" style=${{ marginTop: 6, fontSize: 15.5, whiteSpace: 'pre-wrap' }}>
                                  ${j.d.length > 320 ? j.d.slice(0, 320).replace(/\s+\S*$/, '') + '…' : j.d}
                                </p>`
                            }
                            <div className="meta">
                              ${[j.loc, j.ty, j.md, j.sk].filter(Boolean).map(t => html`<span key=${t} className="tag">${t}</span>`)}
                            </div>
                          </div>
                          <div className="actions" style=${{ flexWrap: 'nowrap' }}>
                            <${ShareButton} job=${j} />
                            <${EasyApply} job=${j} id=${j.id} />
                            <button className="btn ghost" onClick=${() => setApply(j)}>Apply with form</button>
                          </div>
                        </div>`
                    )}
                  </div>`
                : all.length
                  ? html`<div className="panel">
                      <${Empty} title="No roles match that search" action=${html`<button className="btn ghost" onClick=${() => {
                        setQ('');
                        setFl({ loc: '', ty: '', md: '' });
                      }}>Clear filters</button>`}>Try a broader search, or send a general application.<//>
                    </div>`
                  : html`<div className="panel">
                      <${Empty} title="No roles are posted right now">Send your resume and we'll match you with new positions as they open, or email it to ${CO.email}.<//>
                    </div>`
          }
        </div>
      </section>
      ${!wsOn() && html`<section className="sec alt">
        <div className="wrap">
          <h2 style=${{ fontSize: 30 }}>Working with StratEdge</h2>
          <div className="inds" style=${{ marginTop: 28 }}>
            ${[
              [
                'Your choice of engagement',
                'C2C, W2, 1099, contract-to-hire or direct hire, explained before you sign.',
              ],
              [
                'One portal for everything',
                'Clock in, submit timesheets, request time off and keep documents in one place.',
              ],
              ['A person to call', 'An account manager who knows your assignment and answers the phone.'],
              [
                'Room to grow',
                'Short contracts often turn into longer ones and full-time offers with our clients.',
              ],
            ].map(([n, d]) => html`<div key=${n} className="ind"><h3>${n}</h3><p>${d}</p></div>`)}
          </div>
        </div>
      </section>`}
      ${!wsOn() && html`<${PortalBand} />`}
      ${apply !== undefined && html`<${ApplyModal} job=${apply} onClose=${() => setApply(undefined)} />`}
    <//>`;
}
/* v31: the company's social pages (Admin › Website & messages › Social pages), in the footer */
const SOCIAL_NAMES = [
  ['linkedin', 'LinkedIn'],
  ['facebook', 'Facebook'],
  ['x', 'X'],
  ['instagram', 'Instagram'],
  ['youtube', 'YouTube'],
];
function FooterSocial() {
  const caps = useCaps();
  const d = useDoc(caps && caps.db ? 'org/site/x/social' : null);
  const set = d.data && typeof d.data === 'object' ? d.data : { linkedin: CO.linkedin };
  const list = SOCIAL_NAMES.filter(([k]) => /^https:\/\//i.test(String(set[k] || '')));
  return html`<${Fragment}>${(list.length ? list : [['linkedin', 'LinkedIn']]).map(([k, n]) => html`<li key=${k}><a href=${set[k] || CO.linkedin} target="_blank" rel="noopener">${n}</a></li>`)}<//>`;
}
/* ---- share a particular job (link to its own page) ---- */
const jobLink = id => location.origin + location.pathname + '#/careers/' + id;
// v31: the folder the site lives in, and share links through job.php, which shows LinkedIn, Facebook, X and chat apps
// the role's title and picture (they never run this script, so a #/careers link would only show the home page)
const siteBase = () => location.origin + location.pathname.replace(/[^/]*$/, '');
const jobShareLink = (id, src) => siteBase() + 'job.php' + (id ? '?id=' + encodeURIComponent(id) : '') + (src ? (id ? '&' : '?') + 'src=' + encodeURIComponent(src) : '');
function ShareButton({ job, primary, small }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const url = jobShareLink(job.id);
  const title = `${job.ti} at ${CO.name}`;
  const text = `${job.ti}${job.loc ? ' in ' + job.loc : ''}${job.ty ? ' (' + job.ty + ')' : ''} at StratEdge IT Consulting`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied.');
    } catch (e) {
      prompt('Copy this link', url);
    }
  };
  const native = async () => {
    try {
      await navigator.share({ title, text, url });
      setOpen(false);
    } catch (e) {
      /* cancelled */
    }
  };
  const [f, setF] = useState({ to_n: '', to_e: '', from_n: '', from_e: '', msg: '' });
  const [st, setSt] = useState('idle');
  const upf = k => e => setF({ ...f, [k]: e.target.value });
  const sendMailShare = async e => {
    e.preventDefault();
    if (!f.from_n.trim() || !/^\S+@\S+\.\S+$/.test(f.to_e)) {
      toast('Add your name and a valid email for the person.', true);
      return;
    }
    setSt('busy');
    try {
      const r = await api('public_share', { id: job.id, ...f, website: botTrap.hp, t0: botTrap.t0 });
      setSt(r.mailed ? 'sent' : 'fail');
      if (!r.mailed) toast('The email could not be sent right now. Copy the link instead.', true);
    } catch (x) {
      setSt('idle');
      toast(errText(x), true);
    }
  };
  const links = [
    ['LinkedIn', 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url)],
    ['WhatsApp', 'https://wa.me/?text=' + encodeURIComponent(text + ' ' + url)],
    [
      'X',
      'https://x.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(url),
    ],
    ['Facebook', 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url)],
    [
      'Email',
      'mailto:?subject=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(text + '\n\n' + url),
    ],
  ];
  return html`<${Fragment}>
      <button type="button" className=${'btn ' + (primary ? '' : 'ghost') + (small ? ' sm' : '')} onClick=${() => setOpen(true)} aria-haspopup="dialog">
        <${Icon} n="send" />Share</button>
      ${
        open &&
        html`<${Modal} title=${'Share: ' + job.ti} onClose=${() => setOpen(false)}>
            <div className="stack" style=${{ gap: 14 }}>
              <p className="muted small" style=${{ margin: 0 }}>Send this role to someone who fits it. The link opens the job with its own Apply button.</p>
              <div style=${{ display: 'flex', gap: 8 }}>
                <input readOnly value=${url} onFocus=${e => e.target.select()} aria-label="Job link" />
                <button type="button" className="btn" onClick=${copy}>Copy link</button>
              </div>
              <div className="share-row">
                ${typeof navigator.share === 'function' && html`<button type="button" className="btn ghost sm" onClick=${native}>Share…</button>`}${links.map(([n, h]) => html`<a key=${n} className="btn ghost sm" href=${h} target="_blank" rel="noopener noreferrer">${n}</a>`)}
              </div>
              ${
                st === 'sent'
                  ? html`<div className="note ok">
                      <span>Sent to ${f.to_e}. They get the job details and a View-and-apply link.</span>
                    </div>`
                  : html`<form className="form share-mail" onSubmit=${sendMailShare} noValidate>
                      <p className="lbl" style=${{ margin: 0 }}>Or email it to someone from here</p>
                      <div className="row2">
                        <${Field} label="Their name">
                          <input value=${f.to_n} onInput=${upf('to_n')} />
                        <//>
                        <${Field} label="Their email">
                          <input type="email" value=${f.to_e} onInput=${upf('to_e')} />
                        <//>
                      </div>
                      <div className="row2">
                        <${Field} label="Your name">
                          <input value=${f.from_n} onInput=${upf('from_n')} autoComplete="name" />
                        <//>
                        <${Field} label="Your email (for replies)">
                          <input type="email" value=${f.from_e} onInput=${upf('from_e')} autoComplete="email" />
                        <//>
                      </div>
                      <${Field} label="Note (optional)">
                        <input value=${f.msg} onInput=${upf('msg')} placeholder="e.g. This looks like your kind of project" maxLength="300" />
                      <//>
                      <div>
                        <button className="btn sm" disabled=${st === 'busy'}>
                          <${Icon} n="mail" />
                          ${st === 'busy' ? 'Sending…' : 'Email this job'}
                        </button>
                      </div>
                    </form>`
              }
            </div>
          <//>`
      }
    <//>`;
}
function QuickApply({ id, title }) {
  // logged-in consultants apply with a saved resume in one click
  const caps = useCaps();
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState(null);
  useEffect(() => {
    if (caps && caps.state === 'ready' && caps.portal === 'consultant')
      api('jobs_me')
        .then(r => setInfo(r))
        .catch(() => setInfo(null));
  }, [caps && caps.state, caps && caps.portal]);
  if (
    !caps ||
    caps.state !== 'ready' ||
    caps.portal !== 'consultant' ||
    !info ||
    !info.consultant ||
    !(info.consultant.resumes || []).length
  )
    return null;
  return html`<${Fragment}>
      <button className="btn lg ghost" type="button" onClick=${() => setOpen(true)}>
        <${Icon} n="send" />Apply with my saved resume</button>
      ${open && html`<${Lazy} load=${loadMember} get=${() => ApplyJobModal} props=${{ job: { careers_id: id, title }, onClose: () => setOpen(false), onDone: () => setOpen(false) }} />`}
    <//>`;
}
function CareerJob({ id, q }) {
  const caps = useCaps();
  const toast = useToast();
  const job = useDoc(caps && caps.db ? `org/site/jobs/${id}` : null);
  const [apply, setApply] = useState(false);
  useEffect(() => {
    if (job.data) document.title = `${job.data.ti} | Careers | ${wsName()}`;
  }, [job.data]);
  if (!caps || job.loading)
    return html`<${PageHead} title="Careers" intro=${html`<${Spinner} label="Loading the role…" />`} />`;
  const j = job.data;
  if (!j || j.open === false)
    return html`<${Fragment}>
        <${PageHead} crumb=${html`<a href="#/careers">Careers</a> / Role`} title="This role is no longer open" intro=${html`It may have been filled. <a href="#/careers">See the open roles</a> or send a general application.`} />
        <section className="sec">
          <div className="wrap">
            <a className="btn" href="#/careers">All open roles</a>
          </div>
        </section>
      <//>`;
  return html`<${Fragment}>
      <${PageHead} crumb=${html`<a href="#/careers">Careers</a> / ${j.ti}`} title=${j.ti} intro=${[j.loc, j.ty, j.md].filter(Boolean).join(' · ')} />
      <section className="sec">
        <div className="wrap">
          <div className="g2" style=${{ gap: 48, alignItems: 'start' }}>
            <div className="prose">
              ${j.d ? html`<p style=${{ whiteSpace: 'pre-wrap', fontSize: 17 }}>${j.d}</p>` : html`<p className="muted">Contact us for the full description.</p>`}
              ${
                j.sk &&
                html`<div className="meta" style=${{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 20 }}>${j.sk
                  .split(/,\s*/)
                  .filter(Boolean)
                  .map(t => html`<span key=${t} className="tag">${t}</span>`)}</div>`
              }
              ${
                j.src &&
                j.src.credit &&
                j.src.url &&
                html`<p className="muted small" style=${{ marginTop: 16 }}>Originally listed on <a href=${j.src.url} target="_blank" rel="noopener">
                      ${j.src.portal || 'the job board'}
                    </a>.</p>`
              }
              <div className="actions" style=${{ marginTop: 32 }}>
                <${EasyApply} job=${j} id=${id} lg auto=${!!(q && q.apply)} />
                <button className="btn lg ghost" onClick=${() => setApply(true)}>Apply with a form</button>
                <${ShareButton} job=${j} />
              </div>
            </div>
            <aside className="panel">
              <h3 style=${{ fontSize: 20, marginBottom: 12 }}>At a glance</h3>
              <dl className="kv">
                ${j.code && html`<dt>Job code</dt><dd>${j.code}</dd>`}${j.loc && html`<dt>Location</dt><dd>${j.loc}</dd>`}${j.ty && html`<dt>Engagement</dt><dd>${j.ty}</dd>`}${j.md && html`<dt>Work mode</dt><dd>${j.md}</dd>`}${j.rate && html`<dt>Rate</dt><dd>${j.rate}</dd>`}${j.dur && html`<dt>Duration</dt><dd>${j.dur}</dd>`}${j.sd && html`<dt>Start</dt><dd>${fmtDate(j.sd)}</dd>`}${j.n > 1 && html`<dt>Openings</dt><dd>${j.n}</dd>`}${j.visa && html`<dt>Work authorization</dt><dd>${j.visa}</dd>`}${j.cl && html`<dt>Client</dt><dd>${j.cl}</dd>`}
                <dt>Posted</dt>
                <dd>
                  ${j.at ? fmtDay(j.at) : '—'}
                </dd>
                <dt>Questions</dt>
                <dd>
                  <a href=${'mailto:' + CO.email}>
                    ${CO.email}
                  </a>
                  <br />
                  <a href=${'tel:' + CO.tel}>
                    ${CO.phone}
                  </a>
                </dd>
              </dl>
              ${
                caps && caps.state === 'ready' && caps.uid
                  ? html`<div style=${{ marginTop: 14 }}><p className="muted small" style=${{ margin: 0 }}>Know someone who fits? Share your referral link; applications through it are credited to you.</p><div className="actions" style=${{ marginTop: 6 }}><code style=${{ fontSize: 12 }}>${jobShareLink(id)}&ref=${String(caps.uid).slice(2, 8)}</code><button type="button" className="btn ghost sm" onClick=${() => (navigator.clipboard ? navigator.clipboard.writeText(jobShareLink(id) + '&ref=' + String(caps.uid).slice(2, 8)).then(() => toast('Referral link copied.')) : toast(jobShareLink(id) + '&ref=' + String(caps.uid).slice(2, 8)))}>Copy</button></div></div>`
                  : html`<p className="muted small" style=${{ marginTop: 14 }}>Know someone who fits? Share the link; it opens this page with the Apply button.</p>`
              }
            </aside>
          </div>
        </div>
      </section>
      ${!wsOn() && html`<${PortalBand} />`}
      ${apply && html`<${ApplyModal} job=${{ ...j, id }} onClose=${() => setApply(false)} />`}
    <//>`;
}
const ContactPage = () =>
  html`<${Fragment}>
      <${PageHead} title="Contact us" intro="Hiring, a new project, or a question about an existing engagement? We're here Monday to Friday, 9 AM to 7 PM Eastern." />
      <${ContactSec} />
    <//>`;
const NotFound = () =>
  html`<${PageHead} title="Page not found" intro=${html`That link doesn't match a page on this site. <a href="#/">Go to the home page</a>.`} />`;

const STAFF_LOGIN = {
  hr: {
    n: 'HR',
    t: 'HR portal',
    pts: ['Onboarding, document checks and policies', 'Candidates, job portals and e-signatures', 'Approvals, pay plans and attendance', 'HRMS: records, org chart, leave and reviews'],
  },
  acct: {
    n: 'Accounting',
    t: 'Accounting portal',
    pts: ['Invoices to clients and vendors', 'Bills, expenses and the chart of accounts', 'Payroll runs, paystubs and US / India taxes', 'Profit and loss, aging and payroll tax reports'],
  },
  manager: {
    n: 'Manager',
    t: 'Manager portal',
    pts: ['The people who report to you, in one place', 'Approve timesheets, time off and clock-ins', 'Team attendance and tasks', 'Pay and tax details stay with HR and accounting'],
  },
  admin: {
    n: 'Admin',
    t: 'Admin portal',
    pts: ['Every feature on its own page', 'Roles, access and separate logins', 'Security and the spam firewall', 'Website, email and integrations'],
  },
};
const LOGIN_KEY = { client: 'client', consultant: 'consultant', employee: 'employee', student: 'student', hr: 'hr', acct: 'acct', manager: 'manager', admin: 'admin' };
const LOGIN_NAME = { bench: 'employee', client: 'client', consultant: 'consultant', employee: 'employee', student: 'student', hr: 'HR', acct: 'accounting', manager: 'manager', admin: 'admin' };
/* Every login page is for one portal: its heading, who it is for, and where a successful login opens. The server
   refuses an account that does not have the portal (and says which ones it does have). */
const LOGIN_PAGES = {
  consultant: { n: 'Consultant', t: 'Consultant login', who: 'For consultants placed by StratEdge and those looking for their next role.', home: '#/portal/consultant', member: true },
  employee: { n: 'Employee', t: 'Employee login', who: 'For StratEdge employees: attendance, timesheets, pay, tasks, documents, email and campaigns, plus recruiting and the Bench desk.', home: '#/portal/employee', member: true },
  client: { n: 'Client', t: 'Client login', who: 'For client contacts: approve hours, see your consultants and invoices.', home: '#/portal/client', member: true },
  student: { n: 'Student', t: 'Student login', who: 'For students and trainees on a StratEdge plan: courses, certifications, daily tests, live projects and job help.', home: '#/portal/student', member: true },
  hr: { n: 'HR', t: 'HR login', who: 'For the HR team. Accounts are set up by an administrator.', home: '#/portal/hr' },
  acct: { n: 'Accounting', t: 'Accounting login', who: 'For the accounts team. Accounts are set up by an administrator.', home: '#/portal/acct' },
  manager: { n: 'Manager', t: 'Manager login', who: 'For managers approving their team. Accounts are set up by an administrator.', home: '#/portal/mgr' },
  admin: { n: 'Admin', t: 'Admin login', who: 'For administrators. Every page, every setting.', home: '#/portal/admin' },
};
const loginAsOf = v => (LOGIN_PAGES[v] ? v : v === 'employer' ? 'client' : v === 'mgr' ? 'manager' : v === 'bench' ? 'employee' : '');
// v37: a company workspace shows the logins of the parts it has (consultants and clients with recruiting or time,
// students with learning, accounting with the books or payroll); StratEdge's own site shows them all
const wsLoginOn = k =>
  !wsOn() ||
  (k === 'consultant' ? wsFeat('recruiting') : k === 'client' ? wsFeat('recruiting') || wsFeat('time') : k === 'student' ? wsFeat('learning') : k === 'acct' ? wsFeat('books') || wsFeat('payroll') : true);
const PORTAL_TO_LOGIN = { admin: 'admin', hr: 'hr', acct: 'acct', mgr: 'manager', employee: 'employee', consultant: 'consultant', bench: 'employee', client: 'client', student: 'student' };
const SSO_ERR = {
  expired: 'That sign-in took too long or was already used. Try again.',
  denied: 'The sign-in was cancelled.',
  token: 'The provider did not confirm the sign-in. Try again, or use your password.',
  profile: 'The provider did not share an email address, so the account could not be matched.',
  unverified: 'The provider has not confirmed that email address. Confirm it with the provider, or sign in with your password.',
  disabled: 'That account is paused. Contact StratEdge.',
  blocked: 'That sign-in could not be completed. Contact StratEdge at ' + CO.email + '.',
  locked: 'This account is locked for a while after too many failed sign-ins. Try again later, or reset your password.',
  network: 'Staff accounts sign in only from the office networks. Ask an administrator to add this network if you need to work from here.',
};
const safeNext = n => (typeof n === 'string' && /^\/[A-Za-z0-9/_\-?=&.%]*$/.test(n) && !n.startsWith('//') ? n : '');
const staffHome = role => ({ admin: '#/portal/admin', hr: '#/portal/hr', acct: '#/portal/acct', manager: '#/portal/mgr' })[role] || '';
function LoginPage({ q }) {
  const c = useCaps();
  const toast = useToast();
  // which login this page is: from the address, else the one last used on this device, else the consultant login
  const remembered = (() => {
    try {
      return loginAsOf(localStorage.getItem('se_login_as') || '');
    } catch (e) {
      return '';
    }
  })();
  const as0 = loginAsOf(q.as || '') || remembered || (wsLoginOn('consultant') ? 'consultant' : 'employee');
  const as = wsLoginOn(as0) ? as0 : 'employee';
  // v37: a company workspace whose first administrator has not set it up yet has no accounts to sign in to
  const wsWait = wsOn() && !Cap.ws.setup;
  const page = LOGIN_PAGES[as];
  const staffAs = STAFF_LOGIN[as] ? as : '';
  const next = safeNext(q.next);
  const [mode, setMode] = useState(q.mode === 'register' && !staffAs ? 'register' : 'login');
  const [f, setF] = useState({ n: '', e: '', p: '', p2: '' });
  const [busy, setBusy] = useState(false);
  // v34: the second step (authenticator app, passkey, email or backup code) after the password or a provider sign-in
  const [mfa, setMfa] = useState(null);
  const pend = mfa || (q.mfa && c && c.mfa) || null;
  const pol = usePwPolicy();
  // sso=provider carries the provider's own refusal (p = which one, d = its words), kept short and shown as text
  const provName = { google: 'Google', linkedin: 'LinkedIn', microsoft: 'Microsoft' }[q.p] || 'The provider';
  const ssoMsg = q.expired
    ? 'Your session ended. Log in again to continue.'
    : q.mfa && c && c.state !== 'loading' && !c.mfa && !(c.state === 'ready')
      ? 'That sign-in timed out. Sign in again.'
    : q.sso === 'provider'
      ? provName + ' did not allow the sign-in' + (q.d ? ' (' + String(q.d).slice(0, 200) + ')' : '') + '. Use your password or another sign-in for now; the site administrator has been shown the reason under Roles & access.'
      : q.sso && q.sso !== 'portal'
        ? SSO_ERR[q.sso] || 'That sign-in did not complete.'
        : '';
  const [err, setErr] = useState(ssoMsg);
  useEffect(() => {
    if (ssoMsg) setErr(ssoMsg);
  }, [ssoMsg]);
  // a refused login: the account is real but has no access to this portal; the server says which portals it has
  const [wrong, setWrong] = useState(
    q.sso === 'portal'
      ? { who: q.who || '', portals: (q.p || '').split(',').filter(k => LOGIN_PAGES[k]).map(k => ({ login: k, n: LOGIN_PAGES[k].n + ' portal' })), sso: true }
      : null
  );
  const up = k => e => setF({ ...f, [k]: e.target.value });
  // switching to another portal's login clears the messages of the previous one (not on the first render: that
  // would wipe the reason a sign-in came back with, sso=…)
  const firstAs = useRef(true);
  useEffect(() => {
    if (firstAs.current) {
      firstAs.current = false;
      return;
    }
    setWrong(w => (w && w.sso ? w : null));
    setErr('');
  }, [as]);
  const LOGINS = [
    ['consultant', 'Consultant'],
    ['employee', 'Employee'],
    ['client', 'Client'],
    ['student', 'Student'],
  ].filter(([k]) => wsLoginOn(k));
  const asName = page.n;
  const carry = (next ? '&next=' + encodeURIComponent(next) : '') + (mode === 'register' ? '&mode=register' : '') + (q.out ? '&out=1' : '');
  const asPortal = { manager: 'mgr' }[as] || as;
  const haveIt = c && c.state === 'ready' && (c.portals || []).includes(asPortal);
  useEffect(() => {
    // already signed in with an account that has this portal: straight in (or back to where they were going)
    if (c && c.state === 'ready' && (next || haveIt)) location.replace(next ? '#' + next : page.home);
  }, [c && c.state, next, haveIt]);
  const submit = async (e, asOverride) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!c) return;
    const useAs = asOverride || as;
    setErr('');
    setWrong(null);
    if (!/^\S+@\S+\.\S+$/.test(f.e)) {
      setErr('Enter a valid email address.');
      return;
    }
    if (mode === 'register') {
      if (f.n.trim().length < 2) {
        setErr('Add your full name.');
        return;
      }
      if (f.p.length < pol.minSolo) {
        setErr('Use a password of at least ' + pol.minSolo + ' characters. A passphrase of a few unrelated words is strong and easy to remember.');
        return;
      }
      if (f.p !== f.p2) {
        setErr('The two passwords don\u2019t match.');
        return;
      }
    } else if (!f.p) {
      setErr('Enter your password.');
      return;
    }
    setBusy(true);
    // v45.2: the portal's parts start downloading while the password is checked
    prefetchBundle('member');
    if (staffAs) prefetchBundle('staff');
    try {
      startLoginLocation();
      const r =
        mode === 'register'
          ? await api('register', { name: f.n.trim(), email: f.e.trim(), password: f.p, website: botTrap.hp, t0: botTrap.t0 })
          : await api('login', { email: f.e.trim(), password: f.p, as: useAs });
      try {
        localStorage.setItem('se_login_as', useAs);
      } catch (x) {
        /* fine */
      }
      if (r.mfa) {
        // the password was right; the second step comes next (the session opens after it)
        setF({ ...f, p: '', p2: '' });
        setMfa(r.mfa);
        setBusy(false);
        return;
      }
      await reloadCaps();
      shareLoginLocation();
      if (mode === 'register' && r.first) toast('Administrator account created. You manage everything from the Admin portal.');
      // straight into the portal this login is for (a new account sets up its profile for it first)
      if (next) location.hash = '#' + next;
      else if (mode === 'register') location.hash = '#/portal' + (!staffAs ? '?as=' + useAs + (q.out && useAs === 'consultant' ? '&out=1' : '') : '');
      else location.hash = r.go || LOGIN_PAGES[useAs].home;
    } catch (x) {
      if (x && x.code === 'wrong_portal') setWrong({ who: x.who || f.e.trim(), portals: Array.isArray(x.portals) ? x.portals : [], asked: x.askedName || page.t });
      else setErr(errText(x));
    }
    setBusy(false);
  };
  // Google's own button handed us an ID token: the server checks it with Google and opens the session
  const googleIn = async credential => {
    setErr('');
    setWrong(null);
    setBusy(true);
    try {
      const r = await api('sso_gis', { credential, as: as || '', next: next || '' });
      if (r.mfa) {
        setMfa(r.mfa);
        setBusy(false);
        return;
      }
      await reloadCaps();
      shareLoginLocation();
      location.hash = next ? '#' + next : r.go || (LOGIN_PAGES[as] || LOGIN_PAGES.consultant).home;
    } catch (x) {
      if (x && x.code === 'wrong_portal') setWrong({ who: x.who || '', portals: Array.isArray(x.portals) ? x.portals : [], asked: x.askedName || page.t, sso: true });
      else setErr(errText(x));
    }
    setBusy(false);
  };
  // "Open the Employee portal" on a refusal: switch this page to that login and sign in again with the same details
  const retryAs = k => {
    location.hash = '#/login?as=' + k + (next ? '&next=' + encodeURIComponent(next) : '');
    if (f.p) setTimeout(() => submit(null, k), 50);
  };
  const me = c && c.me;
  const myPortals = c && c.state === 'ready' ? (c.portals || []).filter(k => PORTAL_TO_LOGIN[k]) : [];
  let body;
  if (pend && !(c && c.state === 'ready'))
    body = html`<${SignInSecondStep} info=${pend} onRestart=${msg => {
      setMfa(null);
      Cap.mfa = null;
      if (q.mfa) location.replace('#/login?as=' + as + (next ? '&next=' + encodeURIComponent(next) : ''));
      setErr(msg || '');
    }} />`;
  else if (c && c.state === 'ready')
    body = haveIt || next
      ? html`<${Spinner} label=${'Opening the ' + page.n.toLowerCase() + ' portal…'} />`
      : html`<${Fragment}>
          <div className="who">
            <img src=${me.avatarUrl} alt="" />
            <div>
              <b>${me.name || 'Your account'}</b>
              <span className="muted small">${me.email}</span>
            </div>
          </div>
          <div className="refused" role="alert">
            <b>This is the ${page.t.toLowerCase()}.</b> ${me.name ? me.name.split(' ')[0] + "'s" : 'This'} account does not have access to the ${page.n} portal${myPortals.length ? '; it can open:' : '. Ask an administrator to set up your access.'}
          </div>
          ${
            myPortals.length > 0 &&
            html`<div className="stack" style=${{ gap: 8 }}>
                ${myPortals.map(k => html`<a key=${k} className="btn lg soft" href=${LOGIN_PAGES[PORTAL_TO_LOGIN[k]].home}>${LOGIN_PAGES[PORTAL_TO_LOGIN[k]].n} portal</a>`)}
              </div>`
          }
          <p className="muted small" style=${{ marginTop: 16 }}>Someone else's computer, or the wrong account? <button className="btn link small" onClick=${logout}>Log out and sign in with another account</button></p>
        <//>`;
  else if (c && c.state === 'none')
    body = html`<p className="muted">The portal server isn\u2019t reachable right now. Try again in a few minutes, or email ${CO.email}.</p>`;
  else
    body = html`<${Fragment}>
        <div className="seg logins" role="group" aria-label="Which login">
          ${LOGINS.map(([k, v]) => html`<a key=${k} className=${!staffAs && as === k ? 'on' : ''} href=${'#/login?as=' + k + carry}>${v}</a>`)}
        </div>
        <div className="stafflogins" role="group" aria-label="Staff logins">
          <span>Staff</span>
          ${Object.entries(STAFF_LOGIN)
            .filter(([k]) => wsLoginOn(k))
            .map(([k, x]) => html`<a key=${k} className=${staffAs === k ? 'on' : ''} href=${'#/login?as=' + k}>${x.n}</a>`)}
        </div>
        ${wsWait && html`<p className="note amber" role="status"><span><b>${Cap.ws.name} is being set up.</b> Its administrator signs in first, from the link in their email; everyone else can sign in once they are added.</span></p>`}
        <p className="loginwho">${page.who}</p>
        ${
          (Cap.sso || []).length > 0 &&
          html`<div className=${'ssobtns' + (Cap.sso.some(p => p.k === 'google' && p.cid && p.gis !== false) ? ' hasgsi' : '')}>
              ${Cap.sso.map(p => {
                const href = API + 'sso_start&p=' + p.k + (as ? '&as=' + as : '') + (next ? '&next=' + encodeURIComponent(next) : '');
                const label = (mode === 'register' ? 'Sign up with ' : 'Continue with ') + p.n;
                return p.k === 'google'
                  ? html`<${GoogleSignIn} key=${p.k + mode} p=${p} href=${href} label=${label} mode=${mode} onCredential=${googleIn} />`
                  : html`<${SsoBtn} key=${p.k} p=${p} href=${href} label=${label} />`;
              })}
              <span className="muted small">or with your email</span>
            </div>`
        }
        ${
          !staffAs &&
          !wsWait &&
          html`<div className="tabs" role="tablist">
              ${[
                ['login', 'Log in'],
                ['register', 'Create account'],
              ].map(
                ([k, v]) => html`<button key=${k} type="button" role="tab" aria-selected=${mode === k} className=${mode === k ? 'on' : ''} onClick=${() => {
                  setMode(k);
                  setErr('');
                }}>${v}</button>`
              )}
            </div>`
        }
        <form className="form" onSubmit=${submit} noValidate>
          ${mode === 'register' && html`<${BotTrap} />`}
          ${mode === 'register' && html`<${Field} label="Full name"><input value=${f.n} onInput=${up('n')} autoComplete="name" /><//>`}
          <${Field} label="Email">
            <input type="email" value=${f.e} onInput=${up('e')} autoComplete=${mode === 'register' ? 'email' : 'username'} />
          <//>
          <${Field} label="Password" hint=${mode === 'register' ? 'At least ' + pol.minSolo + ' characters (a passphrase works well).' : html`<a href=${'#/forgot' + (f.e && /^\S+@\S+\.\S+$/.test(f.e) ? '?e=' + encodeURIComponent(f.e.trim()) : '')}>Forgot your password?</a>`}>
            <input type="password" value=${f.p} onInput=${up('p')} autoComplete=${mode === 'register' ? 'new-password' : 'current-password webauthn'} />
          <//>
          ${mode === 'register' && f.p && html`<${PwHint} pw=${f.p} min=${pol.minSolo} />`}
          ${
            mode === 'register' &&
            html`<${Field} label="Confirm password"><input type="password" value=${f.p2} onInput=${up('p2')} autoComplete="new-password" /><//>`
          }
          ${err && html`<p className="err" role="alert">${err}</p>`}
          ${
            wrong &&
            html`<div className="refused" role="alert">
                <b>No access to the ${page.n} portal.</b>
                <span>${wrong.sso ? `${wrong.who || 'That account'} signed in, but it does not have the ${page.n} portal.` : `The password is right, but ${wrong.who ? wrong.who.split(' ')[0] + "'s" : 'this'} account does not have the ${page.n} portal.`}${wrong.portals.length ? ' It can open:' : ' Ask an administrator to give it access under Roles & access.'}</span>
                ${
                  wrong.portals.length > 0 &&
                  html`<div className="actions" style=${{ marginTop: 8 }}>
                      ${wrong.portals.map(x => (wrong.sso ? html`<a key=${x.login} className="btn sm" href=${'#/login?as=' + x.login}>${x.n}</a>` : html`<button key=${x.login} type="button" className="btn sm" onClick=${() => retryAs(x.login)}>Open the ${x.n}</button>`))}
                    </div>`
                }
              </div>`
          }
          <div>
            <button className="btn lg" style=${{ width: '100%' }} disabled=${busy || !c}>
              ${busy ? 'Please wait…' : mode === 'register' ? 'Create ' + asName.toLowerCase() + ' account' : 'Log in to the ' + asName + ' portal'}
            </button>
          </div>
          ${mode === 'login' && html`<${PasskeySignIn} as=${as} next=${next} onWrongPortal=${x => setWrong({ who: x.who || '', portals: Array.isArray(x.portals) ? x.portals : [], asked: x.askedName || page.t, sso: true })} />`}
          ${next && html`<p className="note ok small" style=${{ margin: 0 }}>Log in or create a free consultant account and you'll go straight back to finish your application.</p>`}
          ${
            mode === 'login'
              ? html`<p className="muted small">${staffAs ? html`Staff accounts are set up by an administrator and use two-step sign-in. If this login refuses your account, ask them to check your role under Roles & access. Lost your phone? <a href="#/support">Help & support</a>.` : html`Forgot your password? <a href="#/forgot">Reset it here</a>. Lost your phone or locked out? <a href="#/support">Help & support</a>.`}<br />For security, the time, network address and approximate location of each sign-in are recorded; sharing your precise location when the browser asks is optional.<br /><span className="muted" style=${{ opacity: 0.7 }}>Portal ${typeof APP_VERSION === 'string' ? APP_VERSION : ''} · ${APP_BUILD}</span></p>`
              : html`<p className="muted small">${as === 'employee' ? 'Employee accounts are for StratEdge staff. After you create yours, an administrator approves it.' : as === 'client' ? 'After you create your account you\u2019ll fill in a short profile, then StratEdge connects you to your company.' : as === 'student' ? 'After you create your account you\u2019ll fill in a short profile; your student portal opens right away and you choose a plan there. ' : q.out ? 'After you create your account you\u2019ll fill in a short profile as an outside consultant; your portal opens right away and the membership plans are under Membership & fees. ' : 'After you create your account you\u2019ll fill in a short profile and upload your resume; StratEdge approves your access and matched jobs start appearing.'}${as === 'student' || q.out ? html`<a href="#/plans">See the plans</a>.` : ''}</p>`
          }
        </form>
      <//>`;
  const blade = staffAs ? STAFF_LOGIN[staffAs] : null;
  const pts = blade ? blade.pts : (PORTALS.find(p => p.k === as) || (as === 'bench' ? { pts: ['Jobs and matches for the people on your bench', 'The requirements desk and vendor contacts', 'Your attendance, timesheets and earnings'] } : PORTALS[0])).pts;
  return html`<div className=${'login' + (staffAs ? ' staff' : '')}>
      <div className="blade">
        <h1>${blade ? blade.t : page.n + ' portal'}</h1>
        <ul>${pts.map((r, i) => html`<li key=${r} style=${{ animationDelay: 0.1 + i * 0.06 + 's' }}>${r}</li>`)}</ul>
      </div>
      <div className="login-card">
        <h2>${mode === 'register' && !(c && c.state === 'ready') ? 'Create your ' + asName.toLowerCase() + ' account' : page.t}</h2>
        ${body}
      </div>
    </div>`;
}

const FaqPage = () => html`<${Fragment}>
    <${PageHead} title="Frequently asked questions" intro="Straight answers about how we staff, build and bill. Anything missing? Ask the assistant in the corner, or contact the team." />
    <section className="sec">
      <div className="wrap">
        <div className="faqs" style=${{ maxWidth: 820 }}>
          ${FAQS.map(([q, a]) => html`<details key=${q} className="faq"><summary>${q}</summary><p>${a}</p></details>`)}
        </div>
        <div className="actions" style=${{ marginTop: 36 }}>
          <a className="btn" href="#/contact">Contact us</a>
          <button className="btn ghost" onClick=${() => dispatchEvent(new CustomEvent('edge-open'))}>
            <${Icon} n="chat" />Ask the assistant</button>
        </div>
      </div>
    </section>
  <//>`;
function RequestTalent({ q }) {
  const toast = useToast();
  const plan = useMemo(() => {
    try {
      return q && q.plan ? JSON.parse(q.plan) : null;
    } catch (e) {
      return null;
    }
  }, [q && q.plan]);
  const [f, setF] = useState({
    co: '',
    n: '',
    e: '',
    ph: '',
    jt: plan && plan.roles ? plan.roles.join(', ') : '',
    cnt: plan && plan.roles ? String(plan.roles.reduce((a, r) => a + (parseInt(r, 10) || 1), 0)) : '1',
    loc: (plan && plan.loc) || '',
    ty: (plan && plan.ty) || 'C2C',
    md: (plan && plan.md) || 'Onsite',
    sd: (plan && plan.sd) || '',
    sk: '',
    msg: plan && plan.roles ? 'Team plan from the website:\n' + plan.roles.join('\n') : '',
  });
  const [st, setSt] = useState('idle');
  const [err, setErr] = useState('');
  // v50: a request from a specialist service page names it; the receipt names the inquiry and who replies
  const pg = (q && q.pg) || '';
  const pgn = (q && q.pgn) || '';
  const [rc, setRc] = useState(null);
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const send = async e => {
    e.preventDefault();
    if (!f.n.trim() || !/^\S+@\S+\.\S+$/.test(f.e) || !f.jt.trim()) {
      setErr('Add your name, a valid email and the role you need.');
      return;
    }
    setErr('');
    setSt('busy');
    const details = [
      `Role: ${f.jt}`,
      `Headcount: ${f.cnt}`,
      f.loc && `Location: ${f.loc}`,
      `Engagement: ${f.ty}`,
      `Work mode: ${f.md}`,
      f.sd && `Target start: ${f.sd}`,
      f.sk && `Skills: ${f.sk}`,
      f.msg && `Notes: ${f.msg}`,
    ]
      .filter(Boolean)
      .join('\n');
    try {
      const r = await submitInquiry({
        k: 'talent',
        n: f.n,
        e: f.e,
        ph: f.ph,
        co: f.co,
        sv: 'Staffing services',
        jt: f.jt,
        msg: details,
        pg,
      });
      setRc(r && r.receipt ? r : null);
      setSt('sent');
    } catch (x) {
      setSt('mail');
      toast(errText(x), true);
    }
  };
  return html`<${Fragment}>
      <${PageHead} crumb=${pg ? html`<a href=${'#/hire/' + pg}>${pgn || 'Specialist talent'}</a>` : null} title="Request talent" intro=${plan ? 'Your team plan is filled in below. Add your details and send it; a recruiter comes back with a timeline and a quote.' : 'Tell us who you need. A recruiter reviews it and comes back with a plan, a timeline and a quote. The consultation is free.'} />
      <section className="sec">
        <div className="wrap">
          <div className="g2" style=${{ gap: 48, alignItems: 'start' }}>
            ${
              st === 'sent'
                ? html`<div className="panel">
                    <h3 style=${{ fontSize: 24, marginBottom: 8 }}>Thanks, ${firstName(f.n)}.</h3>
                    <p className="muted">Your request for ${f.jt}${pgn ? ' (' + pgn + ')' : ''} is with our recruiting team. ${rc && rc.owner ? rc.owner + ' will reply' : "We'll reply"} to ${f.e}${f.ph ? ' or call ' + f.ph : ''}.</p>
                    ${rc && rc.receipt && html`<p className="cwrcpt">Your reference: <b>${rc.receipt}</b></p>`}
                  </div>`
                : st === 'mail'
                  ? html`<div className="panel">
                      <h3 style=${{ fontSize: 22, marginBottom: 8 }}>Send it by email instead</h3>
                      <p className="muted" style=${{ marginBottom: 16 }}>The request couldn't be sent through the site just now. Your details are ready in a new email.</p>
                      <a className="btn lg" href=${mailtoFor('Talent request: ' + f.jt, [`Company: ${f.co}`, `Name: ${f.n}`, `Email: ${f.e}`, `Phone: ${f.ph}`, '', `Role: ${f.jt}`, `Headcount: ${f.cnt}`, `Location: ${f.loc}`, `Engagement: ${f.ty}`, `Work mode: ${f.md}`, `Start: ${f.sd}`, `Skills: ${f.sk}`, '', f.msg])}>
                        <${Icon} n="mail" />Open email</a>
                    </div>`
                  : html`<form className="panel form" onSubmit=${send} noValidate>
                      <div className="row2">
                        <${Field} label="Company">
                          <input value=${f.co} onInput=${up('co')} autoComplete="organization" />
                        <//>
                        <${Field} label="Your name">
                          <input value=${f.n} onInput=${up('n')} autoComplete="name" />
                        <//>
                      </div>
                      <div className="row2">
                        <${Field} label="Work email">
                          <input type="email" value=${f.e} onInput=${up('e')} autoComplete="email" />
                        <//>
                        <${Field} label="Phone">
                          <input type="tel" value=${f.ph} onInput=${up('ph')} autoComplete="tel" />
                        <//>
                      </div>
                      <div className="row2">
                        <${Field} label="Role you need">
                          <input value=${f.jt} onInput=${up('jt')} placeholder="e.g. SAP PP/QM Analyst" />
                        <//>
                        <${Field} label="How many">
                          <input type="number" min="1" value=${f.cnt} onInput=${up('cnt')} />
                        <//>
                      </div>
                      <div className="row3">
                        <${Field} label="Location">
                          <input value=${f.loc} onInput=${up('loc')} placeholder="City, state" />
                        <//>
                        <${Field} label="Engagement">
                          <select value=${f.ty} onChange=${up('ty')}>
                            ${['C2C', 'W2', '1099', 'Contract-to-hire', 'Direct hire', 'SOW project team', 'Not sure yet'].map(t => html`<option key=${t}>${t}</option>`)}
                          </select>
                        <//>
                        <${Field} label="Work mode">
                          <select value=${f.md} onChange=${up('md')}>
                            ${['Onsite', 'Hybrid', 'Remote'].map(t => html`<option key=${t}>${t}</option>`)}
                          </select>
                        <//>
                      </div>
                      <div className="row2">
                        <${Field} label="Target start">
                          <input type="date" value=${f.sd} onInput=${up('sd')} />
                        <//>
                        <${Field} label="Must-have skills">
                          <input value=${f.sk} onInput=${up('sk')} placeholder="e.g. S/4HANA, PP, QM" />
                        <//>
                      </div>
                      <${Field} label="Anything else">
                        <textarea value=${f.msg} onInput=${up('msg')} placeholder="Project, duration, interview process, budget range if you have one" />
                      <//>
                      ${err && html`<p className="err" role="alert">${err}</p>`}
                      <div>
                        <button className="btn lg" disabled=${st === 'busy'}>
                          ${st === 'busy' ? 'Sending…' : 'Send request'}
                        </button>
                      </div>
                    </form>`
            }
            <div className="stack">
              <h2 style=${{ fontSize: 28 }}>What happens next</h2>
              <div className="steps" style=${{ gridTemplateColumns: '1fr', marginTop: 8 }}>
                <div className="step">
                  <h3>We review it the same day</h3>
                  <p>A recruiter reads the requirement and calls or emails with any questions.</p>
                </div>
                <div className="step">
                  <h3>You get a plan and a quote</h3>
                  <p>Engagement model, rate range and a realistic timeline, in writing.</p>
                </div>
                <div className="step">
                  <h3>Screened candidates arrive</h3>
                  <p>Profiles land in your client portal, where you shortlist and request interviews.</p>
                </div>
                <div className="step">
                  <h3>Onboarding and timesheets run through us</h3>
                  <p>Paperwork, clock-ins and weekly approvals happen in the portal.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    <//>`;
}
function ThemeToggle() {
  const [t, setT] = useState(themeNow());
  const flip = () => {
    const n = t === 'dark' ? 'light' : 'dark';
    setTheme(n);
    setT(n);
  };
  return html`<button className="btn ghost icon" onClick=${flip} aria-label=${t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title=${t === 'dark' ? 'Light mode' : 'Dark mode'}>
      <${Icon} n=${t === 'dark' ? 'sun' : 'moon'} />
    </button>`;
}

/* ================= StratEdge AI on the website (the chat in the corner) ================= */
const EDGE_HELLO = {
  role: 'assistant',
  content:
    "Hi, I'm StratEdge AI. Ask me about our services, staffing, the portals, careers, or how to reach the team.",
};
const EDGE_SUGS = [
  'What services do you offer?',
  'How do I submit a timesheet?',
  'How do I request talent?',
  'How do I get portal access?',
];
function SiteAssistant() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem('edge-chat') || 'null') || [EDGE_HELLO];
    } catch (e) {
      return [EDGE_HELLO];
    }
  });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [talk, setTalk] = useState(false);
  const [tip, setTip] = useState(() => {
    try {
      return !sessionStorage.getItem('edge-tip');
    } catch (e) {
      return true;
    }
  });
  const [tipI, setTipI] = useState(0);
  useEffect(() => {
    if (!tip || open || REDUCED()) return;
    const t = setInterval(() => setTipI(i => i + 1), 5000);
    return () => clearInterval(t);
  }, [tip, open]);
  const [sugs, setSugs] = useState(EDGE_SUGS);
  const box = useRef(null);
  const inp = useRef(null);
  const pendingQ = useRef('');
  useEffect(() => {
    const f = e => {
      setOpen(true);
      if (e.detail && e.detail.ask) pendingQ.current = e.detail.ask;
    };
    addEventListener('edge-open', f);
    return () => removeEventListener('edge-open', f);
  }, []);
  useEffect(() => {
    if (open && pendingQ.current) {
      const q = pendingQ.current;
      pendingQ.current = '';
      setTimeout(() => ask(q), 150);
    }
  }, [open]);
  useEffect(() => {
    try {
      sessionStorage.setItem('edge-chat', JSON.stringify(msgs.slice(-30)));
    } catch (e) {}
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [msgs, open, busy]);
  useEffect(() => {
    if (open) {
      setTip(false);
      try {
        sessionStorage.setItem('edge-tip', '1');
      } catch (e) {}
      setTimeout(() => inp.current && inp.current.focus(), 50);
    }
  }, [open]);
  useEffect(() => {
    if (!tip) return;
    const t = setTimeout(() => setTip(false), 22000);
    return () => clearTimeout(t);
  }, [tip]);
  useEffect(() => {
    if (!open) return;
    const k = e => {
      if (e.key === 'Escape') setOpen(false);
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [open]);
  const ask = async q => {
    const content = (q || text).trim();
    if (!content || busy) return;
    const next = [...msgs, { role: 'user', content }];
    setMsgs(next);
    setText('');
    setBusy(true);
    try {
      const r = await api('ai_visitor', {
        messages: next.filter(m => m.content !== EDGE_HELLO.content).slice(-12),
        website: botTrap.hp,
      });
      setMsgs(m => [...m, { role: 'assistant', content: r.reply }]);
      if (r.suggestions) setSugs(r.suggestions);
      setTalk(true);
      setTimeout(() => setTalk(false), Math.min(6000, 1200 + r.reply.length * 25));
    } catch (e) {
      setMsgs(m => [
        ...m,
        {
          role: 'assistant',
          content:
            e.code === 'rate_limited'
              ? e.message
              : `I can't reach the server right now. You can always reach the team at ${CO.phone} or ${CO.email}.`,
        },
      ]);
    }
    setBusy(false);
  };
  return html`<${Fragment}>
      ${
        open &&
        html`<section className="edge" role="dialog" aria-label="Chat with StratEdge AI">
            <div className="edge-h">
              <${SMark} small talking=${busy || talk} />
              <div style=${{ flex: 1, minWidth: 0 }}>
                <b>StratEdge AI</b>
                <span>Services, staffing, careers and the portals</span>
              </div>
              <button className="btn ghost icon" onClick=${() => {
                setMsgs([EDGE_HELLO]);
                setSugs(EDGE_SUGS);
              }} aria-label="Start over" title="Start over">
                <${Icon} n="trash" />
              </button>
              <button className="btn ghost icon" onClick=${() => setOpen(false)} aria-label="Close chat">
                <${Icon} n="x" />
              </button>
            </div>
            <div className="edge-m" ref=${box} aria-live="polite">
              ${msgs.map((m, i) => html`<div key=${i} className=${'msg ' + (m.role === 'user' ? 'u' : 'b')}>${m.content}</div>`)}
              ${busy && html`<div className="msg b typing"><i /><i /><i /></div>`}
            </div>
            ${
              !busy &&
              html`<div className="sugs">
                  ${sugs.slice(0, 4).map(s => html`<button key=${s} type="button" onClick=${() => ask(s)}>${s}</button>`)}
                </div>`
            }
            <div className="quick">
              <a href="#/request-talent" onClick=${() => setOpen(false)}>
                <${Icon} n="users" />Request talent</a>
              <a href="#/login?as=consultant" onClick=${() => setOpen(false)}>
                <${Icon} n="user" />Consultant portal</a>
              <a href="#/login?as=employee" onClick=${() => setOpen(false)}>
                <${Icon} n="users" />Employee portal</a>
              <a href=${'tel:' + CO.tel}>
                <${Icon} n="phone" />Call us</a>
            </div>
            <form className="edge-f" onSubmit=${e => {
              e.preventDefault();
              ask();
            }}>
              <input ref=${inp} value=${text} onInput=${e => setText(e.target.value)} placeholder="Ask about services, timesheets, careers…" maxLength="1500" aria-label="Your question" />
              <button className="btn icon" aria-label="Send" disabled=${busy || !text.trim()}>
                <${Icon} n="send" />
              </button>
            </form>
            <p className="edge-note">StratEdge AI can make mistakes. For anything important, call ${CO.phone}.</p>
          </section>`
      }
      <div className="edge-launch">
        ${
          tip &&
          !open &&
          html`<div className="edge-tip" role="status" key=${tipI}>
              ${["Hi, I'm StratEdge AI. Ask me anything.", ...EDGE_PROMPTS][tipI % (EDGE_PROMPTS.length + 1)]}
            </div>`
        }
        <button className="edge-btn" onClick=${() => setOpen(o => !o)} aria-label=${open ? 'Close chat' : 'Chat with StratEdge AI'} aria-expanded=${open}>
          <span className="sonar" />
          <${SMark} talking=${busy || talk} />
        </button>
      </div>
    <//>`;
}

/* ---- Spam trap for public forms: a field people never see, and the time the form was opened ---- */
const botTrap = { t0: Date.now(), hp: '' };
function BotTrap() {
  useEffect(() => {
    botTrap.t0 = Date.now();
    botTrap.hp = '';
  }, []);
  return html`<div className="hp" aria-hidden="true">
      <label>Leave this empty<input type="text" name="website" tabIndex="-1" autoComplete="off" onInput=${e => (botTrap.hp = e.target.value)} /></label>
    </div>`;
}

/* ---- Easy apply: one click for a signed-in consultant with a saved resume. Anyone else goes to the
   consultant login (or sign-up) first and comes straight back to the role, where it applies for them. ---- */
function EasyApply({ job, id, lg, auto }) {
  const caps = useCaps();
  const toast = useToast();
  const [st, setSt] = useState('idle'); // idle | busy | done | form
  const [res, setRes] = useState(null);
  const ran = React.useRef(false);
  const go = async () => {
    if (!caps || st === 'busy') return;
    if (caps.state !== 'ready') {
      location.hash = '#/login?as=consultant&next=' + encodeURIComponent('/careers/' + id + '?apply=1');
      return;
    }
    if ((caps.portal !== 'consultant' && caps.portal !== 'student') || (Array.isArray(job.qs) && job.qs.length)) {
      // not a consultant or student, or the role asks screening questions: the form, prefilled
      setSt('form');
      return;
    }
    setSt('busy');
    try {
      const prep = await api('jobs_apply_prep&careers=' + encodeURIComponent(id));
      // v32: a role this person's type may not take, a plan without applications, or a placement fee to agree to
      if (prep && prep.blocked) {
        toast('This role is not open to you: ' + prep.blocked + '.', true);
        setSt('idle');
        return;
      }
      if (prep && prep.locked) {
        toast(prep.locked + ' See ' + (caps.ct === 'student' ? 'Plans & payments' : 'Membership & fees') + ' in your portal.', true);
        setSt('idle');
        return;
      }
      if (prep && prep.fee && prep.fee.fee) {
        setSt('modal');
        return;
      }
      const list = (prep && prep.resumes) || [];
      const pick = list.find(r => r.best) || list.find(r => r.active) || list[0];
      if (!pick) {
        toast('Add your resume once under Resume & preferences and Easy apply sends it for you from then on.');
        setSt('form');
        return;
      }
      const r = await api('jobs_apply', { job_id: 0, careers_id: id, resume_id: pick.id, note: (prep && prep.note) || '' });
      const name = pick.label || pick.name || 'your saved resume';
      setRes({ ...r, name });
      setSt('done');
      toast('Applied with ' + name + '.');
    } catch (e) {
      toast(errText(e), true);
      setSt('form');
    }
  };
  useEffect(() => {
    if (auto && caps && caps.state === 'ready' && !ran.current) {
      ran.current = true;
      go();
    }
  }, [auto, caps && caps.state]);
  if (st === 'done')
    return html`<span className="applied" role="status"><${Icon} n="check" />Applied with ${res.name}. <a href="#/portal/jobs">Track it in your portal</a></span>`;
  return html`<${Fragment}>
      <button type="button" className=${'btn easy' + (lg ? ' lg' : '')} disabled=${st === 'busy'} onClick=${go} title="Apply in one click with your saved resume">
        <${Icon} n="bolt" />${st === 'busy' ? 'Applying…' : 'Easy apply'}
      </button>
      ${(!caps || caps.state !== 'ready') && html`<button type="button" className=${'btn ghost' + (lg ? ' lg' : '')} onClick=${() => setSt('form')}>Apply without an account</button>`}
      ${st === 'form' && html`<${ApplyModal} job=${{ ...job, id }} prefill=${caps && caps.me} onClose=${() => setSt('idle')} />`}
      ${
        st === 'modal' &&
        html`<${Lazy} load=${loadMember} get=${() => ApplyJobModal} props=${{
          job: { careers_id: id, title: job.ti },
          onClose: () => setSt('idle'),
          onDone: () => {
            setRes({ name: 'your resume' });
            setSt('done');
          },
        }} />`
      }
    <//>`;
}
