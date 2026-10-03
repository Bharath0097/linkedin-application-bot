/* ================= Portal context & gates ================= */
const PortalCtx = createContext(null);
const usePortal = () => useContext(PortalCtx);
const accessMail = mailtoFor('Portal access request', ['Hi StratEdge HR,', '', 'Please help me with my portal access.', '', 'Name:', 'Company / client / project:']);

function Gate({ title, children, actions }) {
  return html`<div className="gate"><div className="card">
    <a href="#/" className="brand" aria-label="StratEdge home"><${Logo} /></a>
    <h1>${title}</h1>${children}
    <div className="actions">${actions || html`<a className="btn ghost" href="#/">Back to website</a>`}</div>
  </div></div>`;
}

function ProfileForm({ uid, initial, onSaved, submitLabel, as }) {
  const toast = useToast();
  const me = Cap.me || {};
  const [f, setF] = useState({ n: '', e: '', ph: '', ti: '', loc: '', co: '', role: as === 'client' ? 'employer' : as === 'employee' ? 'employee' : as === 'bench' ? 'bench' : 'consultant', ...(initial || {}), ...(!initial ? { n: me.name || '', e: me.email || '' } : {}) });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const emp = f.role === 'employer';
  const save = async e => {
    e.preventDefault();
    if (!f.n.trim() || !/^\S+@\S+\.\S+$/.test(f.e || '')) { setErr('Add your full name and a valid email.'); return; }
    if (emp && !(f.co || '').trim()) { setErr('Add your company name.'); return; }
    setErr(''); setBusy(true);
    try {
      const p = { n: f.n.trim(), e: f.e.trim(), ph: (f.ph || '').trim(), ti: (f.ti || '').trim(), loc: (f.loc || '').trim(), role: f.role, co: emp ? f.co.trim() : '' };
      await dbMerge(`u/${uid}`, initial ? { p } : { p, joined: Date.now() });
      toast('Profile saved.'); onSaved && onSaved();
    } catch (x) { toast(errText(x), true); }
    setBusy(false);
  };
  return html`<form className="form" onSubmit=${save} noValidate>
    <div className="rolepick" role="radiogroup" aria-label="I am">
      ${[['consultant', 'Consultant', 'I am placed by StratEdge or looking for my next role: resume, matched jobs, timesheets.'], ['employee', 'StratEdge employee', 'I work for StratEdge: recruiting, HR, delivery or office staff.'], ['bench', 'Bench sales recruiter', 'I market StratEdge consultants to vendors and clients: job grabber, submissions, RTRs.'], ['employer', 'Client or vendor contact', 'I approve timesheets and post requirements.']].map(([k, t, d]) => html`<label key=${k} className=${f.role === k ? 'on' : ''}>
        <input type="radio" name="role" value=${k} checked=${f.role === k} onChange=${() => setF({ ...f, role: k })} /><div><b>${t}</b><span>${d}</span></div></label>`)}
    </div>
    <div className="row2"><${Field} label=${emp ? 'Full name' : 'Full legal name'} hint=${emp ? null : 'As it should appear on timesheets.'}><input value=${f.n} onInput=${up('n')} autoComplete="name" /><//>
      <${Field} label="Work email"><input type="email" value=${f.e} onInput=${up('e')} autoComplete="email" /><//></div>
    ${emp && html`<${Field} label="Company"><input value=${f.co} onInput=${up('co')} placeholder="The company you approve timesheets for" autoComplete="organization" /><//>`}
    <div className="row2"><${Field} label="Phone"><input type="tel" value=${f.ph} onInput=${up('ph')} autoComplete="tel" /><//>
      <${Field} label=${emp ? 'Your title' : 'Job title'}><input value=${f.ti} onInput=${up('ti')} placeholder=${emp ? 'e.g. Engineering Manager' : 'e.g. Network Engineer'} /><//></div>
    <${Field} label="City and state"><input value=${f.loc} onInput=${up('loc')} placeholder="e.g. Edison, NJ" /><//>
    ${err && html`<p className="err" role="alert">${err}</p>`}
    <div><button className="btn" disabled=${busy}>${busy ? 'Saving…' : (submitLabel || 'Save profile')}</button></div>
  </form>`;
}

function Portal({ path, q }) {
  const caps = useCaps();
  if (!caps) return html`<div className="gate"><${Spinner} label="Connecting to the portal…" /></div>`;
  if (caps.state === 'none') return html`<${Gate} title="The portal isn't reachable right now"><p className="muted">The server didn't answer. Try again in a few minutes, or contact StratEdge at ${CO.email}.</p><//>`;
  if (caps.state !== 'ready') return html`<${Gate} title="Log in to use the portal"
      actions=${html`<a className="btn" href=${'#/login' + (q.as ? '?as=' + q.as : '')}>Log in</a><a className="btn ghost" href=${'#/login?mode=register' + (q.as ? '&as=' + q.as : '')}>Create an account</a>`}>
    <p className="muted">Consultants, client contacts and StratEdge staff each sign in with their own account.</p><//>`;
  return html`<${PortalData} caps=${caps} path=${path} q=${q} />`;
}

function PortalData({ caps, path, q }) {
  const uid = caps.uid, isAdmin = caps.isAdmin;
  const root = useDoc(`u/${uid}`);
  const asg = useDoc(`r/${uid}`);
  const ann = useCol('org/main/ann', 'at:desc', 30);
  const settings = useDoc('org/main/x/settings');
  const tpl = useDoc('org/hr/x/tpl');
  const sigs = useCol('sig');
  const allU = useCol(isAdmin ? 'u' : null);
  const allR = useCol(isAdmin ? 'r' : null);
  const inbox = useCol(isAdmin ? 'inbox' : null);
  const clients = useCol(isAdmin ? 'org/admin/clients' : null);
  const [editing, setEditing] = useState(false);
  const people = usePeople(isAdmin ? [uid, ...allU.docs.map(d => d.id)] : [uid]);
  const [accounts, setAccounts] = useState({});
  const loadAccounts = useCallback(() => { if (!isAdmin) return; api('admin_users').then(r => { const o = {}; (r.users || []).forEach(u => { o[u.id] = u; }); setAccounts(o); }).catch(() => {}); }, [isAdmin]);
  useEffect(() => { loadAccounts(); }, [loadAccounts, allU.docs.length]);

  const admin = useMemo(() => {
    if (!isAdmin) return null;
    const rMap = {}; allR.docs.forEach(d => { rMap[d.id] = d; });
    const members = allU.docs.filter(d => d.p).map(d => {
      const r = rMap[d.id] || null;
      return { id: d.id, u: d, r, st: (r && r.st) || (d.id === uid ? 'active' : 'new'), role: (r && r.role) || d.p.role || 'consultant', self: d.id === uid };
    }).sort((a, b) => a.u.p.n.localeCompare(b.u.p.n));
    const pendTs = [], pendLv = [], reviewed = [];
    members.forEach(m => {
      Object.entries(m.u.ts || {}).forEach(([w, s]) => {
        const rev = m.r && m.r.rev && m.r.rev[w]; const st = tsStatus(s, rev);
        if (st === 'pending') pendTs.push({ m, w, s }); else if (rev && rev.at && rev.v === s.u) reviewed.push({ m, w, s, rev, st });
      });
      Object.entries(m.u.lv || {}).forEach(([id, l]) => { if (!l.x && !(m.r && m.r.lvd && m.r.lvd[id])) pendLv.push({ m, id, l }); });
    });
    pendTs.sort((a, b) => (a.s.sa || 0) - (b.s.sa || 0));
    pendLv.sort((a, b) => (a.l.at || 0) - (b.l.at || 0));
    reviewed.sort((a, b) => b.rev.at - a.rev.at);
    const msgs = [];
    inbox.docs.forEach(d => Object.entries(d.m || {}).forEach(([id, x]) => msgs.push({ ...x, uid: d.id, id })));
    msgs.sort((a, b) => (b.at || 0) - (a.at || 0));
    const clientsById = {}; clients.docs.forEach(c => { clientsById[c.id] = c; });
    return { members, rMap, pendTs, pendLv, reviewed: reviewed.slice(0, 25), msgs, unread: msgs.filter(x => !x.done).length,
      onClock: members.filter(m => m.u.clock && m.u.clock.on), requests: members.filter(m => m.st === 'new'), clients: clients.docs.slice().sort((a, b) => (a.n || '').localeCompare(b.n || '')), clientsById,
      employers: members.filter(m => m.role === 'employer' && m.st === 'active'), accounts, loadAccounts, loading: allU.loading || allR.loading };
  }, [isAdmin, allU.docs, allR.docs, inbox.docs, clients.docs, accounts, loadAccounts]);

  if (root.loading || asg.loading) return html`<div className="gate"><${Spinner} label="Loading your workspace…" /></div>`;
  const prof = root.data && root.data.p;
  const a = asg.data || {};
  const role = isAdmin ? 'admin' : (a.role || (prof && prof.role) || 'consultant');
  if (!isAdmin) {
    if (!prof) return html`<${Gate} title="Set up your profile" actions=${html`<a className="btn ghost" href="#/">Back to website</a>`}>
      <p className="muted">Welcome to the StratEdge portal. Add your details once, and StratEdge will approve your access.</p>
      <${ProfileForm} uid=${uid} as=${q.as} submitLabel="Request access" /><//>`;
    if (!a.st) return html`<${Gate} title=${`Thanks, ${firstName(prof.n)}. Your access is being reviewed`}>
      <p className="muted">${prof.role === 'employer' ? `StratEdge will connect your account to ${prof.co || 'your company'}'s client workspace.` : prof.role === 'bench' ? 'An administrator approves your account and you get the bench sales portal.' : 'HR will approve your account and assign your client and project.'} This page opens your portal automatically as soon as that happens.</p>
      ${editing ? html`<${ProfileForm} uid=${uid} initial=${prof} onSaved=${() => setEditing(false)} />`
        : html`<dl className="kv"><dt>Name</dt><dd>${prof.n}</dd><dt>Email</dt><dd>${prof.e}</dd>${prof.co && html`<dt>Company</dt><dd>${prof.co}</dd>`}${prof.ph && html`<dt>Phone</dt><dd>${prof.ph}</dd>`}${prof.ti && html`<dt>Title</dt><dd>${prof.ti}</dd>`}<dt>Requested</dt><dd>${portalLabel(prof.role)}</dd></dl>
          <div><button type="button" className="btn ghost sm" onClick=${() => setEditing(true)}>Edit details</button></div>`}<//>`;
    if (a.st === 'inactive') return html`<${Gate} title="Your portal access is paused">
      <p className="muted">This usually means an engagement has ended. If you think it's a mistake, contact StratEdge at ${CO.email} or ${CO.phone}.</p><//>`;
    if (role === 'employer' && !a.cid) return html`<${Gate} title="Your client workspace isn't linked yet">
      <p className="muted">StratEdge needs to connect your account to your company before timesheets appear here. Contact your account manager at ${CO.email}.</p><//>`;
  }
  const ctx = { uid, caps, isAdmin, role, cid: a.cid || null, root: root.data || {}, prof, asg: a, ann: ann.docs, settings: settings.data || {}, tpl: tpl.data || {}, sigs: sigs.docs, people, admin, isHR: !!caps.isHR, roleName: caps.roleName };
  return html`<${PortalCtx.Provider} value=${ctx}><${Shell} path=${path} q=${q} /><//>`;
}

/* ================= Shell ================= */
const MEMBER_NAV = [
  ['', 'Dashboard', 'home'], ['attendance', 'Attendance', 'clock'], ['timesheets', 'Timesheets', 'sheet'], ['pay', 'Earnings', 'money'], ['tasks', 'Tasks', 'tasks'],
  ['timeoff', 'Time off', 'cal'], ['documents', 'Documents', 'folder'], ['profile', 'Profile', 'user'],
];
const CLIENT_NAV = [
  ['', 'Dashboard', 'home'], ['timesheets', 'Timesheets', 'sheet'], ['consultants', 'Consultants', 'users'], ['attendance', 'Attendance', 'clock'],
  ['requirements', 'Requirements', 'brief'], ['invoices', 'Invoices', 'money'], ['reports', 'Reports', 'chart'], ['sign', 'Sign documents', 'sheet'], ['profile', 'Profile', 'user'],
];
const ADMIN_NAV = [
  ['admin', 'Overview', 'grid'], ['admin/team', 'Team', 'users'], ['admin/clients', 'Clients', 'building'], ['admin/approvals', 'Approvals', 'approve'], ['admin/payroll', 'Pay plans', 'money'], ['admin/payruns', 'Payroll runs & salary confirmation', 'money'], ['admin/requirements', 'Requirements', 'brief'],
  ['admin/recruiting', 'Recruiting', 'users'], ['admin/jobs', 'Job portals', 'search'], ['admin/ats', 'Candidates (ATS)', 'users'], ['admin/esign', 'E-signatures', 'sheet'], ['admin/invoices', 'Invoices', 'money'], ['admin/attendance', 'Team attendance', 'clock'], ['admin/logins', 'Sign-in activity', 'globe'], ['admin/tasks', 'Assign tasks', 'tasks'], ['admin/reports', 'Reports', 'chart'], ['admin/announcements', 'Announcements', 'mega'], ['admin/website', 'Website', 'globe'],
];
const HR_NAV = [
  ['hr', 'HR overview', 'grid'], ['hr/ats', 'Candidates (ATS)', 'users'], ['hr/jobs', 'Job portals', 'search'], ['hr/onboarding', 'Onboarding', 'tasks'], ['hr/esign', 'E-signatures', 'sheet'], ['hr/invoices', 'Invoices', 'money'], ['hr/verify', 'Document checks', 'folder'], ['hr/policies', 'Policies & templates', 'sheet'], ['hr/directory', 'Directory', 'users'], ['hr/logins', 'Sign-in activity', 'globe'], ['hr/reports', 'Daily reports', 'chart'],
];
const ACCT_NAV = [
  ['acct', 'Accounting overview', 'grid'], ['admin/invoices', 'Invoices', 'money'], ['acct/expenses', 'Bills & expenses', 'sheet'], ['acct/payroll', 'Payroll runs & paystubs', 'money'], ['acct/reports', 'Reports', 'chart'], ['acct/taxes', 'Tax settings', 'approve'], ['acct/accounts', 'Chart of accounts', 'folder'],
];
const ACCT_SHARED_NAV = [['admin/team', 'Team', 'users'], ['admin/payroll', 'Pay plans', 'money'], ['admin/attendance', 'Team attendance', 'clock']];
const HR_SHARED_NAV = [['admin/team', 'Team', 'users'], ['admin/approvals', 'Approvals', 'approve'], ['admin/payroll', 'Payroll', 'money'], ['admin/attendance', 'Team attendance', 'clock'], ['admin/announcements', 'Announcements', 'mega']];
const REC_NAV = [['rec/consultants', 'Consultants', 'users'], ['rec/submissions', 'RTRs & submissions', 'send'], ['rec/eod', 'Daily report', 'mega']];
const CONSULTANT_NAV = [
  ['', 'Dashboard', 'home'], ['jobs', 'Matched jobs', 'search'], ['applications', 'Applications', 'check'], ['resume', 'Resume & preferences', 'star'], ['attendance', 'Attendance', 'clock'], ['timesheets', 'Timesheets', 'sheet'], ['pay', 'Earnings', 'money'], ['timeoff', 'Time off', 'cal'],
  ['tasks', 'Tasks', 'tasks'], ['documents', 'Documents', 'folder'], ['profile', 'Profile', 'user'],
];
// Bench sales recruiters: the job grabber and the recruiting workspace are inline in the primary nav (no separate Recruiting group).
const BENCH_NAV = [
  ['', 'Dashboard', 'home'], ['jobs/grab', 'Job grabber', 'search'], ['jobs/consultants', 'Consultant matches', 'users'], ['rec/consultants', 'Bench consultants', 'users'], ['rec/submissions', 'RTRs & submissions', 'send'], ['rec/eod', 'Daily report', 'mega'],
  ['attendance', 'Attendance', 'clock'], ['timesheets', 'Timesheets', 'sheet'], ['tasks', 'Tasks', 'tasks'], ['timeoff', 'Time off', 'cal'], ['documents', 'Documents', 'folder'], ['profile', 'Profile', 'user'],
];
function Shell({ path, q }) {
  const P = usePortal();
  const [more, setMore] = useState(false);
  const sub = path.replace(/^\/(portal|client)\/?/, '');
  useEffect(() => { setMore(false); }, [path]);
  const emp = P.role === 'employer'; const cons = P.role === 'consultant'; const bench = P.role === 'bench';
  const toSign = pendingSigs(P.sigs, P.uid).length;
  const openTasks = emp ? 0 : Object.entries(P.asg.tasks || {}).filter(([id, t]) => !t.x && (((P.root.tp || {})[id] || {}).s || 'todo') !== 'done').length;
  const A = P.admin;
  const badge = { tasks: openTasks, sign: toSign, 'admin/team': A && A.requests.length, 'admin/approvals': A && (A.pendTs.length + A.pendLv.length), 'admin/website': A && A.unread, 'admin/esign': toSign, 'hr/esign': toSign };
  const onbOpen = !emp && P.asg.onb && P.asg.onb.kind !== 'done';
  const benchNav = bench ? BENCH_NAV.filter(n => !(P.asg.norec && n[0].startsWith('rec/'))) : BENCH_NAV;
  const primary = emp ? CLIENT_NAV : cons ? [...CONSULTANT_NAV.slice(0, 8), ...(onbOpen ? [['onboarding', 'Onboarding', 'tasks']] : []), ['sign', 'Sign documents', 'sheet'], ['policies', 'Policies', 'sheet'], ...CONSULTANT_NAV.slice(8)] : bench ? [...benchNav.slice(0, -1), ...(onbOpen ? [['onboarding', 'Onboarding', 'tasks']] : []), ['sign', 'Sign documents', 'sheet'], ['policies', 'Policies', 'sheet'], benchNav[benchNav.length - 1]] : [...MEMBER_NAV.slice(0, 7), ...(onbOpen ? [['onboarding', 'Onboarding', 'tasks']] : []), ['sign', 'Sign documents', 'sheet'], ['policies', 'Policies', 'sheet'], MEMBER_NAV[7]];
  const rec = (!emp && !cons && !bench && P.prof && !P.asg.norec) || P.isAdmin ? REC_NAV : [];
  // Separate portals: the route prefix decides which portal is open; a switcher moves between the ones this person can use.
  const portals = [...(emp ? [['client', 'Client portal', '']] : cons ? [['consultant', 'Consultant portal', '']] : bench ? [['bench', 'Bench sales portal', '']] : [['employee', 'Employee portal', '']]), ...(P.isHR || P.roleName === 'admin' ? [['hr', 'HR portal', 'hr']] : []), ...(P.isAcct || P.roleName === 'admin' ? [['acct', 'Accounting portal', 'acct']] : []), ...(P.roleName === 'admin' ? [['admin', 'Admin portal', 'admin']] : [])];
  const portalKey = sub === 'admin' || sub.startsWith('admin/') ? 'admin' : sub === 'hr' || sub.startsWith('hr/') ? 'hr' : sub === 'acct' || sub.startsWith('acct/') ? 'acct' : emp ? 'client' : cons ? 'consultant' : bench ? 'bench' : 'employee';
  const inPortal = portals.some(x => x[0] === portalKey) ? portalKey : portals[0][0];
  const groups = inPortal === 'admin' ? [['', ADMIN_NAV], ['Recruiting', REC_NAV]] : inPortal === 'hr' ? [['', HR_NAV], ['Team', HR_SHARED_NAV], ['Recruiting', REC_NAV]] : inPortal === 'acct' ? [['', ACCT_NAV], ['Team', ACCT_SHARED_NAV]] : [['', primary], ...(rec.length ? [['Recruiting', rec]] : [])];
  const staff = [];
  const all = [...primary, ...rec, ...CONSULTANT_NAV, ...BENCH_NAV, ...ADMIN_NAV, ...HR_NAV, ...HR_SHARED_NAV, ...ACCT_NAV, ...ACCT_SHARED_NAV];
  const cur = all.find(n => n[0] === sub) || groups[0][1][0];
  const portalName = (portals.find(x => x[0] === inPortal) || portals[0])[1];
  const switchPortal = e => { const k = e.target.value; const p = portals.find(x => x[0] === k); if (p) location.hash = '#/portal' + (p[2] ? '/' + p[2] : ''); };
  const title = cur[1];
  const href = k => '#/portal' + (k ? '/' + k : '');
  const link = ([k, label, ic]) => html`<a key=${k} href=${href(k)} className=${cur[0] === k ? 'on' : ''} aria-current=${cur[0] === k ? 'page' : undefined}>
    <${Icon} n=${ic} />${label}${badge[k] ? html`<span className="badge">${badge[k]}</span>` : null}</a>`;
  const tabs = inPortal === 'client' ? ['', 'timesheets', 'consultants', 'requirements'] : inPortal === 'admin' ? ['admin', 'admin/approvals', 'admin/team', 'admin/payruns'] : inPortal === 'hr' ? ['hr', 'hr/onboarding', 'hr/verify', 'hr/reports'] : inPortal === 'acct' ? ['acct', 'admin/invoices', 'acct/expenses', 'acct/payroll'] : cons ? ['', 'jobs', 'applications', 'resume'] : bench ? (P.asg.norec ? ['', 'jobs/grab', 'jobs/consultants', 'timesheets'] : ['', 'jobs/grab', 'rec/submissions', 'rec/consultants']) : ['', 'attendance', 'timesheets', 'rec/submissions'];
  const page = (() => {
    if (emp) switch (sub) {
      case 'timesheets': return html`<${ClientTimesheets} />`;
      case 'consultants': return html`<${ClientConsultants} />`;
      case 'attendance': return html`<${ClientAttendance} />`;
      case 'requirements': return html`<${ClientRequirements} />`;
      case 'reports': return html`<${ClientReports} />`;
      case 'invoices': return html`<${ClientInvoices} />`;
      case 'sign': return html`<${SignDocsPage} />`;
      case 'profile': return html`<${Profile} />`;
      default: return html`<${ClientDashboard} />`;
    }
    switch (sub) {
      case 'attendance': return html`<${Attendance} />`;
      case 'timesheets': return html`<${Timesheets} q=${q} />`;
      case 'pay': return html`<${Earnings} />`;
      case 'tasks': return html`<${Tasks} />`;
      case 'timeoff': return html`<${TimeOff} />`;
      case 'documents': return html`<${Documents} />`;
      case 'profile': return html`<${Profile} />`;
      case 'onboarding': return html`<${OnboardingPage} />`;
      case 'policies': return html`<${PoliciesPage} />`;
      case 'sign': return html`<${SignDocsPage} />`;
      case 'jobs': return html`<${JobsPage} />`;
      case 'applications': return html`<${ApplicationsPage} />`;
      case 'resume': return html`<${ResumePage} />`;
    }
    // Job grabber: bench sales recruiters and admins only (consultants and clients fall through to the dashboard).
    if (bench || P.isAdmin) switch (sub) {
      case 'jobs/grab': return html`<${JobPortalsAdmin} bench=${!P.isAdmin} />`;
      case 'jobs/consultants': return html`<${JobPortalsAdmin} bench=${!P.isAdmin} tab="consultants" />`;
    }
    if ((!emp && !cons && !P.asg.norec) || P.isAdmin) switch (sub) {
      case 'rec/consultants': return html`<${RecConsultants} />`;
      case 'rec/submissions': return html`<${RecSubmissions} />`;
      case 'rec/eod': return html`<${RecEOD} />`;
    }
    if (P.isAdmin) switch (sub) {
      case 'hr': return html`<${HROverview} />`;
      case 'hr/onboarding': return html`<${HROnboarding} />`;
      case 'hr/verify': return html`<${HRVerify} />`;
      case 'hr/policies': return html`<${HRPolicies} />`;
      case 'hr/directory': return html`<${HRDirectory} />`;
      case 'hr/reports': return html`<${Recruiting} />`;
      case 'hr/esign': return html`<${ESignAdmin} />`;
      case 'admin/esign': return html`<${ESignAdmin} />`;
      case 'hr/invoices': return html`<${InvoicesAdmin} />`;
      case 'admin/invoices': return html`<${InvoicesAdmin} />`;
      case 'hr/ats': return html`<${ATSPage} />`;
      case 'admin/ats': return html`<${ATSPage} />`;
      case 'hr/logins': return html`<${SignIns} />`;
      case 'admin/logins': return html`<${SignIns} />`;
      case 'acct': return html`<${AcctOverview} />`;
      case 'acct/expenses': return html`<${Expenses} />`;
      case 'acct/payroll': return html`<${PayrollRuns} />`;
      case 'admin/payruns': return html`<${PayrollRuns} />`;
      case 'acct/reports': return html`<${AcctReports} />`;
      case 'acct/taxes': return html`<${TaxSettings} />`;
      case 'acct/accounts': return html`<${ChartOfAccounts} />`;
      case 'admin/recruiting': return html`<${Recruiting} />`;
      case 'admin/jobs': return html`<${JobPortalsAdmin} />`;
      case 'hr/jobs': return html`<${JobPortalsAdmin} />`;
      case 'admin': return html`<${AdminOverview} />`;
      case 'admin/team': return html`<${AdminTeam} q=${q} />`;
      case 'admin/clients': return html`<${AdminClients} />`;
      case 'admin/approvals': return html`<${AdminApprovals} q=${q} />`;
      case 'admin/payroll': return html`<${AdminPayroll} />`;
      case 'admin/requirements': return html`<${AdminRequirements} />`;
      case 'admin/attendance': return html`<${AdminAttendance} />`;
      case 'admin/tasks': return html`<${AdminTasks} />`;
      case 'admin/reports': return html`<${AdminReports} />`;
      case 'admin/announcements': return html`<${AdminAnnouncements} />`;
      case 'admin/website': return html`<${AdminWebsite} q=${q} />`;
    }
    if (sub === '' && !P.prof && P.isAdmin) return html`<${Fragment}>${P.roleName === 'admin' ? html`<${AdminOverview} />` : P.isHR ? html`<${HROverview} />` : html`<${AcctOverview} />`}<//>`;
    return html`<${Dashboard} />`;
  })();
  const me = P.people[P.uid] || Cap.me || {};
  const roleLine = P.roleName === 'admin' ? 'Admin' : P.isHR ? 'HR' : P.roleName === 'acct' ? 'Accounting' : emp ? (P.asg.cl || P.prof.co || 'Client contact') : cons ? (P.asg.ty ? P.asg.ty + ' consultant' : 'Consultant') : bench ? 'Bench sales recruiter' : 'StratEdge employee';
  const banner = toSign > 0 && sub !== 'sign' && !sub.endsWith('esign') ? html`<div className="note amber" style=${{ marginBottom: 18 }}><span><b>${toSign} document${toSign === 1 ? '' : 's'} waiting for your signature.</b></span><div className="actions"><a className="btn sm" href="#/portal/sign">Review and sign</a></div></div>` : null;
  const content = html`<${Fragment}>${banner}${emp ? html`<${ClientData}>${page}<//>` : page}<//>`;
  return html`<div className="app">
    <aside className="side" aria-label="Portal navigation">
      <a className="brand" href="#/" aria-label="StratEdge website"><${Logo} /></a>
      ${portals.length > 1 ? html`<label className="pswitch"><span className="plabel">${portalName}</span><select value=${inPortal} onChange=${switchPortal} aria-label="Switch portal">${portals.map(x => html`<option key=${x[0]} value=${x[0]}>${x[1]}</option>`)}</select></label>` : html`<div className="plabel">${portalName}</div>`}
      ${groups.map(([g, items], i) => html`<${Fragment} key=${g || i}>${g && html`<div className="grp">${g}</div>`}<nav>${items.map(link)}</nav><//>`)}
      <div className="me"><img src=${me.avatarUrl} alt="" /><div style=${{ minWidth: 0 }}><b>${(P.prof && P.prof.n) || me.name || 'You'}</b><span>${roleLine}</span></div></div>
    </aside>
    <div className="main">
      <header className="ptop">
        <a className="mlogo" href="#/" aria-label="StratEdge website"><${Logo} /></a>
        <h1>${title}</h1>
        <div className="push"><${ThemeToggle} /><a className="btn ghost sm" href="#/">Website</a><button type="button" className="btn ghost sm" onClick=${logout}><${Icon} n="exit" />Log out</button></div>
      </header>
      <main className="content">${content}</main>
    </div>
    <nav className="tabbar" aria-label="Portal sections">
      ${tabs.map(k => { const n = all.find(x => x[0] === k) || ['', 'Home', 'home']; return html`<a key=${k} href=${href(k)} className=${cur[0] === k ? 'on' : ''}><${Icon} n=${n[2]} />${k === '' || k === 'admin' || k === 'hr' || k === 'acct' ? 'Home' : n[1].replace('Team attendance', 'Attendance').replace('Payroll runs & salary confirmation', 'Payroll')}${badge[k] ? html`<span className="badge">${badge[k]}</span>` : null}</a>`; })}
      <button type="button" onClick=${() => setMore(true)}><${Icon} n="more" />More</button>
    </nav>
    ${more && html`<${Modal} title="Portal" onClose=${() => setMore(false)}>
      <div className="side" style=${{ display: 'flex', position: 'static', height: 'auto', border: 0, padding: 0 }}>
        ${portals.length > 1 && html`<label className="pswitch" style=${{ padding: '0 16px 10px' }}><span className="plabel">${portalName}</span><select value=${inPortal} onChange=${switchPortal} aria-label="Switch portal">${portals.map(x => html`<option key=${x[0]} value=${x[0]}>${x[1]}</option>`)}</select></label>`}
        ${groups.map(([g, items], i) => html`<${Fragment} key=${g || i}>${g && html`<div className="grp">${g}</div>`}<nav>${items.filter(n => !tabs.includes(n[0])).map(link)}</nav><//>`)}
        <div className="grp">Account</div><nav><a href="#/">Back to website</a><a href="#/" onClick=${e => { e.preventDefault(); logout(); }}><${Icon} n="exit" />Log out</a></nav>
      </div><//>`}
  </div>`;
}
const NeedProfile = () => html`<div className="panel"><${Empty} title="Set up your profile first" action=${html`<a className="btn" href="#/portal/profile">Set up profile</a>`}>Attendance, timesheets and time off are tied to your profile.<//></div>`;

/* ================= Clock in / out ================= */
const dayTotal = (s, b) => Math.max(0, Math.round(s.reduce((a, x) => a + (x.o ? mins(x.i, x.o) : 0), 0)) - excessBreak({ b: b || [] }, 60));
function useClockActions() {
  const P = usePortal(); const toast = useToast();
  const base = `u/${P.uid}`; const cid = P.cid; const nm = P.prof ? P.prof.n : '';
  const [busy, setBusy] = useState(false);
  const mirror = async (dk, s, bl) => { if (cid) await dbMerge(`pub/${cid}/att/${P.uid}_${mkey(dk)}`, { uid: P.uid, n: nm, m: mkey(dk), days: { [dk]: dayTotal(s, bl) } }); };
  const stamp = async ev => { const g = await getPosition(9000); const pos = g.pos || null; try { const r = await api('punch', { ev, pos, posErr: g.err || '' }); return { t: r.t, ip: r.ip, g: r.g || '', pos: r.pos || pos || null, posErr: pos ? '' : (g.err || '') }; } catch (e) { return { t: Date.now(), ip: '', g: '', pos, posErr: pos ? '' : (g.err || '') }; } };
  const clockIn = async mode => {
    if (busy) return; setBusy(true);
    try {
      const meta = await stamp('in'); const t = meta.t; const dk = dkey(new Date(t)); const path = `${base}/att/${mkey(dk)}`;
      const md = await dbGet(path);
      const s = (((md && md.days && md.days[dk]) || {}).s || []).map(x => ({ ...x }));
      s.push({ i: t, o: null, m: mode, li: meta });
      await dbMerge(path, { days: { [dk]: { s } } });
      await dbMerge(base, { clock: { on: true, i: t, d: dk, m: mode, brk: null }, lastMode: mode });
      if (cid) await dbMerge(`pub/${cid}/live/${P.uid}`, { n: nm, on: true, i: t, d: dk, m: mode, at: t });
      toast(`Clocked in at ${fmtTime(t)}.${meta.pos ? ` Location recorded (±${meta.pos.acc} m).` : ` Exact location ${POS_ERR[meta.posErr] || 'not shared'}; the network address was recorded.`}`);
    } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const breakStart = async () => {
    const c = P.root.clock; if (!c || !c.on || c.brk || busy) return; setBusy(true);
    try { const meta = await stamp('bi'); await dbMerge(base, { clock: { ...c, brk: { i: meta.t, li: meta } } }); toast(`Break started at ${fmtTime(meta.t)}.`); } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const breakEnd = async (silent) => {
    const c = P.root.clock; if (!c || !c.on || !c.brk) return null; if (!silent) setBusy(true);
    let out = null;
    try { const meta = await stamp('bo'); const path = `${base}/att/${mkey(c.d)}`; const md = await dbGet(path);
      const day = ((md && md.days && md.days[c.d]) || {}); const bl = (day.b || []).map(x => ({ ...x })); bl.push({ i: c.brk.i, o: meta.t, li: c.brk.li || null, lo: meta });
      await dbMerge(path, { days: { [c.d]: { b: bl } } }); await dbMerge(base, { clock: { ...c, brk: null } });
      const total = breakMins({ b: bl }); const allow = breakMaxOf(P.settings);
      if (!silent) toast(total > allow ? `Break ended. Breaks today total ${hm(total)}, over the ${hm(allow)} allowance; the extra time needs admin approval.` : `Break ended at ${fmtTime(meta.t)}. Breaks today: ${hm(total)} of ${hm(allow)}.`);
      out = bl;
    } catch (e) { toast(errText(e), true); }
    if (!silent) setBusy(false); return out;
  };
  const clockOut = async (at, edited) => {
    const c = P.root.clock; if (!c || !c.on || busy) return false; setBusy(true);
    let ok = false;
    try {
      if (c.brk) await breakEnd(true);
      const meta = edited ? null : await stamp('out'); const t = at || (meta ? meta.t : Date.now()); const path = `${base}/att/${mkey(c.d)}`;
      const md = await dbGet(path);
      const day = ((md && md.days && md.days[c.d]) || {}); const s = (day.s || []).map(x => ({ ...x }));
      const ix = s.findIndex(x => x.i === c.i && !x.o);
      if (ix >= 0) { s[ix].o = t; if (edited) s[ix].e = 1; if (meta) s[ix].lo = meta; } else s.push({ i: c.i, o: t, m: c.m, e: edited ? 1 : 0, lo: meta || null });
      await dbMerge(path, { days: { [c.d]: { s } } });
      await dbMerge(base, { clock: { on: false, i: null, d: null, m: null, brk: null }, lastOut: t });
      if (cid) { await dbMerge(`pub/${cid}/live/${P.uid}`, { n: nm, on: false, i: null, d: null, m: null, at: t }); await mirror(c.d, s, day.b || []); }
      toast(`Clocked out at ${fmtTime(t)}. This session: ${hm(mins(c.i, t))}.`); ok = true;
    } catch (e) { toast(errText(e), true); }
    setBusy(false); return ok;
  };
  return { busy, clockIn, clockOut, breakStart, breakEnd, mirror };
}
const sessMins = (s, c, now) => s.reduce((a, x) => a + mins(x.i, x.o != null ? x.o : (c && c.i === x.i ? now : x.i)), 0);
function timeParts(ts) {
  const parts = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).formatToParts(new Date(ts));
  return { main: parts.filter(p => p.type !== 'dayPeriod').map(p => p.value).join('').trim(), per: (parts.find(p => p.type === 'dayPeriod') || {}).value || '' };
}

function ClockCard() {
  const P = usePortal(); const now = useNow(1000);
  const c = P.root.clock && P.root.clock.on ? P.root.clock : null;
  const today = dkey(new Date(now));
  const month = useDoc(`u/${P.uid}/att/${mkey(today)}`);
  const dayD = (month.data && month.data.days && month.data.days[(c && c.d) || today]) || {}; const sess = dayD.s || [];
  const [mode, setMode] = useState(P.root.lastMode || 'remote');
  const { busy, clockIn, clockOut, breakStart, breakEnd } = useClockActions();
  const onBrk = c && c.brk; const allow = breakMaxOf(P.settings);
  const bUsed = breakMins({ b: [...(dayD.b || []), ...(onBrk ? [{ i: c.brk.i, o: null }] : [])] }, now); const over = Math.max(0, bUsed - allow);
  const el = c ? Math.max(0, Math.floor((now - c.i) / 1000)) : 0;
  const tp = timeParts(now);
  return html`<section className=${'clock' + (c ? ' on' : '')} aria-label="Attendance">
    <div className="state"><span className=${'dot' + (c ? ' live' : '')} />${c ? `Clocked in since ${fmtTime(c.i)}${c.d !== today ? ', ' + fmtDate(c.d) : ''}` : "You're clocked out"}</div>
    <div className="time" aria-live="off">${c ? `${Math.floor(el / 3600)}:${pad(Math.floor(el % 3600 / 60))}:${pad(el % 60)}` : html`${tp.main}<small>${tp.per}</small>`}</div>
    <div className="sub"><span>Today: <b className="num">${hm(Math.max(0, sessMins(sess, c, now) - over))}</b></span>${c && html`<span>${MODES[c.m] || ''}</span>`}${(c || bUsed > 0) && html`<span>Breaks: <b className="num">${hm(bUsed)}</b> of ${hm(allow)}</span>`}</div>
    ${onBrk && html`<div className="brk-live"><span className="dot live" />On break since ${fmtTime(c.brk.i)} (${hm(mins(c.brk.i, now))})</div>`}
    ${over > 0 && html`<div className="note amber" style=${{ marginBottom: 10 }}><span>Breaks are ${hm(over)} over today’s ${hm(allow)} allowance. The extra time is unpaid unless an admin approves the extended break.</span></div>`}
    <${LocationStatus} />
    ${!c && html`<div className="seg" role="radiogroup" aria-label="Where are you working?">${Object.entries(MODES).map(([k, v]) => html`<button type="button" key=${k} role="radio" aria-checked=${mode === k} className=${mode === k ? 'on' : ''} onClick=${() => setMode(k)}>${v}</button>`)}</div>`}
    ${c ? html`<div className="punches">${onBrk ? html`<button type="button" className="punch brk" disabled=${busy} onClick=${() => breakEnd()}>${busy ? 'Saving…' : 'End break'}</button>` : html`<button type="button" className="punch brk" disabled=${busy} onClick=${breakStart}>${busy ? 'Saving…' : 'Start break'}</button>`}<button type="button" className="punch out" disabled=${busy} onClick=${() => clockOut()}>${busy ? 'Saving…' : 'Clock out'}</button></div>`
      : html`<button type="button" className="punch in" disabled=${busy} onClick=${() => clockIn(mode)}>${busy ? 'Saving…' : 'Clock in'}</button>`}
    ${sess.length > 0 && html`<ul className="sess">${sess.slice().reverse().map(s => html`<li key=${s.i}><span><b>${fmtTime(s.i)} – ${s.o ? fmtTime(s.o) : 'now'}</b><span style=${{ marginLeft: 10 }}>${MODES[s.m] || ''}</span></span><span className="num">${hm(mins(s.i, s.o || (c && c.i === s.i ? now : s.i)))}</span></li>`)}</ul>`}
  </section>`;
}
function ClockOutAtModal({ onClose }) {
  const P = usePortal(); const c = P.root.clock;
  const { busy, clockOut } = useClockActions();
  const [v, setV] = useState(toLocalInput(Math.min(c.i + 8 * 3600000, Date.now())));
  const [err, setErr] = useState('');
  const save = async () => {
    const t = fromLocalInput(v);
    if (!(t > c.i)) { setErr('Clock-out has to be after your clock-in time.'); return; }
    if (t > Date.now()) { setErr("Clock-out can't be in the future."); return; }
    if (await clockOut(t, true)) onClose();
  };
  return html`<${Modal} title="Set your clock-out time" onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${save}>Save clock-out</button>`}>
    <p className="muted" style=${{ marginBottom: 16 }}>You clocked in ${fmtDate(c.d)} at ${fmtTime(c.i)}. Corrected times are marked as edited for your approver.</p>
    <${Field} label="Clocked out at"><input type="datetime-local" value=${v} min=${toLocalInput(c.i)} max=${toLocalInput(Date.now())} onInput=${e => setV(e.target.value)} /><//>
    ${err && html`<p className="err" role="alert" style=${{ marginTop: 10 }}>${err}</p>`}<//>`;
}
function ForgotBanner() {
  const P = usePortal(); const c = P.root.clock;
  const [open, setOpen] = useState(false);
  const { busy, clockOut } = useClockActions();
  if (!c || !c.on || c.d === dkey()) return null;
  return html`<div className="note amber" role="alert"><span>You're still clocked in from <b>${fmtDate(c.d)} at ${fmtTime(c.i)}</b>. Did you forget to clock out?</span>
    <div className="actions"><button type="button" className="btn sm" onClick=${() => setOpen(true)}>Set clock-out time</button><button type="button" className="btn ghost sm" disabled=${busy} onClick=${() => clockOut()}>Clock out now</button></div>
    ${open && html`<${ClockOutAtModal} onClose=${() => setOpen(false)} />`}</div>`;
}
function WeekCard() {
  const P = usePortal(); const now = useNow(30000);
  const today = dkey(new Date(now)); const ws = weekStart(today); const days = weekDays(ws);
  const m1 = mkey(days[0]), m2 = mkey(days[6]);
  const a = useDoc(`u/${P.uid}/att/${m1}`); const b = useDoc(m2 !== m1 ? `u/${P.uid}/att/${m2}` : null);
  const c = P.root.clock && P.root.clock.on ? P.root.clock : null;
  const per = days.map(k => { const md = mkey(k) === m1 ? a.data : b.data; return sessMins(((md && md.days && md.days[k]) || {}).s || [], c, now); });
  const tot = per.reduce((x, y) => x + y, 0); const max = Math.max(480, ...per);
  return html`<section className="panel">
    <div className="ph-row"><h2 className="ph">This week</h2><a className="small" href="#/portal/attendance">Attendance history</a></div>
    <div className="bignum">${hm(tot)}</div><p className="muted small">${weekLabel(ws)}</p>
    <div className="week" role="img" aria-label=${`Hours worked each day this week, ${hm(tot)} total`}>${days.map((k, i) => html`<div key=${k} className=${'d' + (k === today ? ' today' : '')}>
      <em>${per[i] ? h1(per[i] / 60) : ''}</em><div className="bar" style=${{ height: Math.max(4, Math.round(per[i] / max * 100)) + 'px' }} /><span>${DOW[i].slice(0, 2)}</span></div>`)}</div>
  </section>`;
}
function TsCard() {
  const P = usePortal(); const ws = weekStart(); const lw = addDays(ws, -7);
  const ts = P.root.ts || {}; const rev = P.asg.rev || {};
  const st = tsStatus(ts[ws], rev[ws]); const lst = tsStatus(ts[lw], rev[lw]);
  return html`<section className="panel stack" style=${{ gap: 12 }}>
    <div className="ph-row" style=${{ marginBottom: 0 }}><h2 className="ph">Timesheet</h2><${Chip} s=${st}>${TS_LABEL[st]}<//></div>
    <div><div className="bignum">${h1(ts[ws] ? ts[ws].t : 0)} h</div><p className="muted small">Week of ${weekLabel(ws)}</p></div>
    ${(['draft', 'rejected', 'reopened'].includes(lst) || (lst === 'none' && (P.root.joined || Infinity) < parseD(ws).getTime())) && html`<div className="note amber">Last week's timesheet hasn't been submitted.<div className="actions"><a className="btn sm" href=${'#/portal/timesheets?w=' + lw}>Finish last week</a></div></div>`}
    <div className="actions"><a className="btn" href=${'#/portal/timesheets?w=' + ws}>${st === 'none' ? 'Start timesheet' : 'Open timesheet'}</a></div>
  </section>`;
}
function myTasks(P) {
  return Object.entries(P.asg.tasks || {}).filter(([, t]) => !t.x).map(([id, t]) => ({ id, ...t, pr: (P.root.tp || {})[id] || {} }))
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
}
function TasksCard() {
  const P = usePortal();
  const open = myTasks(P).filter(t => t.pr.s !== 'done');
  return html`<section className="panel">
    <div className="ph-row"><h2 className="ph">Tasks</h2><a className="small" href="#/portal/tasks">All tasks</a></div>
    ${open.length ? html`<ul className="list">${open.slice(0, 4).map(t => html`<li key=${t.id}><div><div className="t">${t.ti}</div><div className="m">${t.due ? 'Due ' + fmtDate(t.due) : 'No due date'}</div></div><${Chip} s=${t.pr.s || 'todo'}>${TASK_S[t.pr.s || 'todo']}<//></li>`)}</ul>`
      : html`<${Empty} title="You're all caught up">New tasks from HR or your manager show up here.<//>`}
  </section>`;
}
function AnnCard() {
  const P = usePortal();
  const list = P.ann.slice().sort((a, b) => (b.pin ? 1 : 0) - (a.pin ? 1 : 0) || b.at - a.at).slice(0, 3);
  if (!list.length && !P.isAdmin) return null;
  return html`<section className="panel">
    <div className="ph-row" style=${{ marginBottom: 4 }}><h2 className="ph">Announcements</h2>${P.isAdmin && html`<a className="small" href="#/portal/admin/announcements">Manage</a>`}</div>
    ${list.length ? list.map(a => html`<article key=${a.id} className="ann"><h3>${a.ti}</h3><time>${fmtDay(a.at)}${a.pin ? ', pinned' : ''}</time><p>${a.b}</p></article>`)
      : html`<${Empty} title="No announcements yet">Post updates for the whole team, like holiday schedules or policy changes.<//>`}
  </section>`;
}
function Dashboard() {
  const P = usePortal();
  return html`<div className="stack">
    <div className="hello"><div><h2>${greeting()}${P.prof ? ', ' + firstName(P.prof.n) : ''}</h2>
      <p className="muted">${new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}${(P.asg.ec || P.asg.cl) ? ', on assignment with ' + (P.asg.ec || P.asg.cl) : ''}</p></div></div>
    ${P.isAdmin && html`<${AdminKpis} />`}
    ${P.prof ? html`<${Fragment}>
      <${ForgotBanner} />
      ${P.role === 'consultant' && html`<${JobsCard} />`}
      ${P.role === 'bench' && html`<${BenchCard} />`}
      <div className="g32"><${ClockCard} /><${WeekCard} /></div>
      <div className="g2"><${TsCard} /><${TasksCard} /></div>
      <${EarnCard} />
      <${AnnCard} />
    <//>` : html`<${Fragment}>${P.isAdmin && html`<div className="note info">To track your own time, set up your profile. Everything else in the admin section works without it.<div className="actions"><a className="btn sm" href="#/portal/profile">Set up profile</a></div></div>`}<${AnnCard} /><//>`}
  </div>`;
}

/* ================= Attendance ================= */
function MissedPunch({ onClose }) {
  const P = usePortal(); const toast = useToast(); const { mirror } = useClockActions();
  const [f, setF] = useState({ d: dkey(), i: '09:00', o: '17:00', m: P.root.lastMode || 'remote', n: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const ti = fromLocalInput(`${f.d}T${f.i}`); let to = fromLocalInput(`${f.d}T${f.o}`);
    if (!f.d || isNaN(ti) || isNaN(to)) { setErr('Add the date and both times.'); return; }
    if (to <= ti) { setErr('Clock-out has to be after clock-in.'); return; }
    if (to > Date.now()) { setErr("Times can't be in the future."); return; }
    if (!f.n.trim()) { setErr('Add a short reason for your approver.'); return; }
    setErr(''); setBusy(true);
    try {
      const path = `u/${P.uid}/att/${mkey(f.d)}`; const md = await dbGet(path);
      const s = (((md && md.days && md.days[f.d]) || {}).s || []).map(x => ({ ...x }));
      if (s.some(x => x.i < to && (x.o || Date.now()) > ti)) { setErr('Those times overlap a session you already have that day.'); setBusy(false); return; }
      s.push({ i: ti, o: to, m: f.m, e: 1, n: f.n.trim() }); s.sort((a, b) => a.i - b.i);
      await dbMerge(path, { days: { [f.d]: { s } } });
      await mirror(f.d, s);
      toast('Missed punch added. It is marked as edited for your approver.'); onClose();
    } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  return html`<${Modal} title="Add a missed punch" onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${save}>Add punch</button>`}>
    <div className="form">
      <div className="row3"><${Field} label="Date"><input type="date" max=${dkey()} value=${f.d} onInput=${up('d')} /><//><${Field} label="Clock in"><input type="time" value=${f.i} onInput=${up('i')} /><//><${Field} label="Clock out"><input type="time" value=${f.o} onInput=${up('o')} /><//></div>
      <${Field} label="Work location"><select value=${f.m} onChange=${up('m')}>${Object.entries(MODES).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
      <${Field} label="Reason"><input value=${f.n} onInput=${up('n')} placeholder="e.g. Forgot to clock in after client meeting" /><//>
      ${err && html`<p className="err" role="alert">${err}</p>`}
    </div><//>`;
}
function attRows(md, c, now) {
  const out = [];
  Object.keys((md && md.days) || {}).sort().reverse().forEach(d => {
    const s = (md.days[d].s || []).slice().sort((a, b) => a.i - b.i);
    const day = md.days[d]; const bm = breakMins(day, now); const over = excessBreak(day, 60, now);
    s.forEach((x, i) => out.push({ d, first: i === 0, n: s.length, dayMins: Math.max(0, sessMins(s, c, now) - over), gross: sessMins(s, c, now), bm, over, nb: (day.b || []).length, x, m: mins(x.i, x.o != null ? x.o : (c && c.i === x.i ? now : x.i)) }));
  });
  return out;
}
function Attendance() {
  const P = usePortal(); const toast = useToast(); const now = useNow(30000);
  const [mk, setMk] = useState(mkey(dkey()));
  const doc = useDoc(P.prof ? `u/${P.uid}/att/${mk}` : null);
  const [add, setAdd] = useState(false);
  if (!P.prof) return html`<${NeedProfile} />`;
  const c = P.root.clock && P.root.clock.on ? P.root.clock : null;
  const rows = attRows(doc.data, c, now);
  const total = rows.reduce((a, r) => a + r.m, 0); const daysWorked = new Set(rows.map(r => r.d)).size;
  const exp = async () => {
    try { await saveDownload(`attendance-${mk}.csv`, toCSV([['Date', 'Clock in', 'Clock out', 'Hours', 'Location', 'Edited', 'Note'],
      ...rows.slice().reverse().map(r => [r.d, fmtTime(r.x.i), r.x.o ? fmtTime(r.x.o) : '', hrs(r.m), MODES[r.x.m] || '', r.x.e ? 'Yes' : '', r.x.n || ''])])); }
    catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); }
  };
  return html`<div className="stack">
    <${ForgotBanner} />
    <div className="toolbar">
      <div className="wknav"><button type="button" className="btn ghost icon" aria-label="Previous month" onClick=${() => setMk(addMonths(mk, -1))}><${Icon} n="left" /></button><b>${monthLabel(mk)}</b>
        <button className="btn ghost icon" aria-label="Next month" disabled=${mk >= mkey(dkey())} onClick=${() => setMk(addMonths(mk, 1))}><${Icon} n="right" /></button></div>
      ${mk !== mkey(dkey()) && html`<button type="button" className="btn ghost sm" onClick=${() => setMk(mkey(dkey()))}>This month</button>`}
      <div className="push"><button type="button" className="btn ghost" onClick=${() => setAdd(true)}><${Icon} n="plus" />Add missed punch</button><button type="button" className="btn ghost" disabled=${!rows.length} onClick=${exp}><${Icon} n="down" />Export CSV</button></div>
    </div>
    <div className="kpis" style=${{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
      <a><b>${hm(total)}</b><span>Total this month</span></a><a><b>${daysWorked}</b><span>Days worked</span></a><a><b>${daysWorked ? hm(total / daysWorked) : '0h 00m'}</b><span>Average per day</span></a>
    </div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${doc.loading ? html`<${Spinner} />` : rows.length ? html`<div className="tblwrap"><table className="tbl">
        <thead><tr><th>Date</th><th>Clock in</th><th>Clock out</th><th>Location</th><th className="r">Hours</th><th>Breaks</th><th className="r">Day total</th><th>Approval</th></tr></thead>
        <tbody>${rows.map(r => html`<tr key=${r.d + r.x.i}>
          <td>${r.first ? html`<b>${fmtDate(r.d)}</b>` : ''}</td>
          <td className="num">${fmtTime(r.x.i)}${r.x.e ? html` <span className="chip amber" title=${r.x.n || 'Edited'}>Edited</span>` : ''}</td>
          <td className="num">${r.x.o ? fmtTime(r.x.o) : html`<${Chip} s="ok">Working<//>`}</td>
          <td>${MODES[r.x.m] || ''}</td><td className="r num">${hm(r.m)}</td><td className="small">${r.first ? (r.nb ? html`${r.nb} · ${hm(r.bm)}${r.over ? html`<div style=${{ color: 'var(--amber-ink)' }}>${hm(r.over)} over${((P.asg.attA || {})[r.d] || {}).bx === 'approved' ? ', approved' : ', awaiting approval'}</div>` : ''}` : html`<span className="muted">None</span>`) : ''}</td><td className="r num">${r.first ? html`<b>${hm(((P.asg.attA || {})[r.d] || {}).bx === 'approved' ? r.gross : r.dayMins)}</b>` : ''}</td><td>${r.first ? (() => { const a = (P.asg.attA || {})[r.d]; const st = attStatus(r.d, P.asg.attA, a && a.bx === 'approved' ? r.gross : r.dayMins, attApprovalOn(P.settings)); return html`<${Chip} s=${st === 'approved' ? 'ok' : st === 'rejected' ? 'red' : 'amber'}>${ATT_ST[st]}<//>${a && a.n && st !== 'approved' ? html`<div className="muted small">${a.n}</div>` : ''}`; })() : ''}</td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title=${'No attendance in ' + monthLabel(mk)}>Clock in from your dashboard and each session appears here.<//>`}
    </section>
    ${add && html`<${MissedPunch} onClose=${() => setAdd(false)} />`}
  </div>`;
}

/* ================= Timesheets ================= */
const numv = v => { const n = parseFloat(v); return isFinite(n) && n > 0 ? n : 0; };
const round2 = n => Math.round(n * 100) / 100;
function Timesheets({ q }) {
  const P = usePortal(); const toast = useToast();
  const base = `u/${P.uid}`; const cid = P.cid;
  const ws = q.w && /^\d{4}-\d{2}-\d{2}$/.test(q.w) && weekStart(q.w) === q.w ? q.w : weekStart();
  const doc = useDoc(P.prof ? `${base}/ts/${ws}` : null);
  const pub = useDoc(P.prof && cid ? `pub/${cid}/ts/${P.uid}_${ws}` : null);
  const sum = (P.root.ts || {})[ws]; const rev = (P.asg.rev || {})[ws];
  const st = tsStatus(sum, rev);
  const cst = cid && sum && sum.s === 'submitted' ? cdStatus(pub.data) : 'none';
  const editable = ['none', 'draft', 'rejected', 'reopened'].includes(st);
  const projects = (P.asg.pr || '').split(',').map(s => s.trim()).filter(Boolean);
  const blank = () => ({ p: projects[0] || '', t: '', h: ['', '', '', '', '', '', ''] });
  const [form, setForm] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [prog, setProg] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const loadedFor = useRef('');
  useEffect(() => {
    if (doc.loading) return;
    if (dirty && loadedFor.current === ws) return;
    loadedFor.current = ws;
    const d = doc.data;
    setForm(d ? { rows: d.rows && d.rows.length ? d.rows.map(r => ({ p: r.p || '', t: r.t || '', h: r.h.map(x => x ? String(x) : '') })) : [blank()], note: d.note || '', files: (d.files || []).map(f => ({ ...f })) }
      : { rows: [blank()], note: '', files: [] });
    setDirty(false);
  }, [ws, doc.loading, doc.data]);
  if (!P.prof) return html`<${NeedProfile} />`;
  const days = weekDays(ws);

  const persist = async (submit, f) => {
    f = f || form;
    const rows = f.rows.map(r => ({ p: (r.p || '').trim(), t: (r.t || '').trim(), h: r.h.map(x => round2(numv(x))) })).filter(r => r.t || r.h.some(x => x > 0) || (r.p && f.rows.length === 1));
    const dayT = DOW.map((_, d) => rows.reduce((a, r) => a + r.h[d], 0));
    if (dayT.some(x => x > 24)) throw { message: "A day can't have more than 24 hours." };
    const total = round2(dayT.reduce((a, b) => a + b, 0));
    if (submit && !total) throw { message: 'Add your hours before submitting.' };
    if (submit && P.asg.na && !f.files.length) throw { message: 'Attach your client-approved timesheet before submitting.' };
    const now = Date.now();
    const data = { w: ws, rows, note: (f.note || '').trim(), files: f.files, s: submit ? 'submitted' : 'draft', u: now, sa: submit ? now : null };
    await dbSet(`${base}/ts/${ws}`, data);
    await dbMerge(base, { ts: { [ws]: { t: total, s: data.s, u: now, sa: data.sa, f: f.files.length } } });
    if (cid && (submit || (pub.data && pub.data.s === 'submitted'))) {
      await dbSet(`pub/${cid}/ts/${P.uid}_${ws}`, { uid: P.uid, n: P.prof.n, w: ws, t: total, rows, note: data.note, s: submit ? 'submitted' : 'withdrawn', sa: data.sa, u: now, cd: (pub.data && pub.data.cd) || null });
    }
    setDirty(false);
  };
  const act = async (label, fn, okMsg) => {
    setBusy(label);
    try { await fn(); okMsg && toast(okMsg); } catch (e) { toast(errText(e), true); }
    setBusy('');
  };
  const goWeek = async n => {
    if (dirty && editable) { try { await persist(false); toast('Draft saved.'); } catch (e) { toast(errText(e), true); return; } }
    location.hash = '#/portal/timesheets?w=' + addDays(ws, n * 7);
  };
  const setRow = (ri, patch) => { setForm({ ...form, rows: form.rows.map((r, i) => i === ri ? { ...r, ...patch } : r) }); setDirty(true); };
  const setH = (ri, di, v) => setRow(ri, { h: form.rows[ri].h.map((x, j) => j === di ? v : x) });
  const fill = () => act('fill', async () => {
    const docs = {}; for (const m of [...new Set(days.map(mkey))]) docs[m] = await dbGet(`${base}/att/${m}`);
    const per = days.map(k => Math.round(((((docs[mkey(k)] || {}).days || {})[k] || {}).s || []).reduce((a, x) => a + (x.o ? mins(x.i, x.o) : 0), 0) / 15) / 4);
    if (!per.some(Boolean)) throw { message: 'No completed clock-in sessions found for this week.' };
    const rows = form.rows.slice(); rows[0] = { ...rows[0], h: per.map(x => x ? String(x) : '') };
    setForm({ ...form, rows }); setDirty(true);
  }, 'Filled from your attendance. Check the hours, then save.');
  const copyPrev = () => act('copy', async () => {
    const d = await dbGet(`${base}/ts/${addDays(ws, -7)}`);
    if (!d || !d.rows || !d.rows.length) throw { message: 'There is no timesheet for the previous week to copy.' };
    setForm({ ...form, rows: d.rows.map(r => ({ p: r.p || '', t: r.t || '', h: r.h.map(x => x ? String(x) : '') })) }); setDirty(true);
  }, 'Copied last week. Adjust anything that changed.');
  const onFiles = files => act('upload', async () => {
    let f2 = form;
    for (const file of files) {
      setProg(0.03);
      const r = await storeFile(base, file, { c: 'timesheet', w: ws }, setProg);
      f2 = { ...f2, files: [...f2.files, { id: r.id, n: r.n, sz: r.sz, ty: r.ty }] };
    }
    setForm(f2); await persist(false, f2);
  }, 'Attachment added and draft saved.');
  const removeFile = f => act('rm', async () => {
    await deleteStored(base, f.id);
    const f2 = { ...form, files: form.files.filter(x => x.id !== f.id) }; setForm(f2); await persist(false, f2);
  }, 'Attachment removed.');

  const totals = form ? DOW.map((_, d) => form.rows.reduce((a, r) => a + numv(r.h[d]), 0)) : [];
  const grand = totals.reduce((a, b) => a + b, 0);
  const hist = Object.entries(P.root.ts || {}).sort((a, b) => b[0].localeCompare(a[0]));
  const projOpts = (cur) => [...new Set([...projects, cur].filter(Boolean))];
  const cdNote = pub.data && pub.data.cd;
  return html`<div className="stack">
    <div className="toolbar">
      <div className="wknav"><button type="button" className="btn ghost icon" aria-label="Previous week" disabled=${!!busy} onClick=${() => goWeek(-1)}><${Icon} n="left" /></button><b>${weekLabel(ws)}</b>
        <button className="btn ghost icon" aria-label="Next week" disabled=${!!busy || ws >= weekStart()} onClick=${() => goWeek(1)}><${Icon} n="right" /></button></div>
      <${Chip} s=${st}>${TS_LABEL[st]}<//>
      ${cst !== 'none' && html`<${Chip} s=${cst === 'approved' ? 'ok' : cst === 'returned' ? 'red' : 'amber'}>${CD_LABEL[cst]}<//>`}
      ${editable && html`<div className="push"><button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${fill}>Fill from attendance</button><button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${copyPrev}>Copy previous week</button></div>`}
    </div>
    ${st === 'rejected' && html`<div className="note red"><span><b>Returned by StratEdge.</b> ${rev.c || 'Update your timesheet and submit it again.'}</span></div>`}
    ${st === 'reopened' && html`<div className="note info"><span><b>Reopened for changes.</b> ${rev.c || 'Make your updates and submit again.'}</span></div>`}
    ${cst === 'returned' && cdNote && html`<div className="note red"><span><b>Returned by your client.</b> ${cdNote.c || 'Review the hours with your client manager and resubmit.'}</span></div>`}
    ${cst === 'approved' && cdNote && html`<div className="note ok"><span>Your client approved these hours ${fmtDay(cdNote.at)}.${cdNote.c ? ' ' + cdNote.c : ''}</span></div>`}
    ${st === 'pending' && html`<div className="note amber"><span>Submitted ${fmtTs(sum.sa)}. ${cid ? 'Your client and StratEdge are reviewing it.' : 'Waiting for approval.'}</span><div className="actions"><button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => act('withdraw', () => persist(false), 'Withdrawn. You can edit and resubmit.')}>Withdraw to edit</button></div></div>`}
    ${st === 'approved' && html`<div className="note ok"><span>Approved by StratEdge ${fmtDay(rev.at)}${rev.c ? ': ' + rev.c : ''}. This timesheet is locked.</span></div>`}
    ${!form ? html`<${Spinner} />` : html`<${Fragment}>
      <div className="stack" style=${{ gap: 10 }}>
        ${form.rows.map((r, ri) => html`<div key=${ri} className="tsline">
          <div className="top">
            <${Field} label="Project">${projects.length ? html`<select disabled=${!editable} value=${r.p} onChange=${e => setRow(ri, { p: e.target.value })}>${projOpts(r.p).map(p => html`<option key=${p}>${p}</option>`)}</select>`
              : html`<input disabled=${!editable} value=${r.p} onInput=${e => setRow(ri, { p: e.target.value })} placeholder="Client or project" />`}<//>
            <${Field} label="Task or description"><input disabled=${!editable} value=${r.t} onInput=${e => setRow(ri, { t: e.target.value })} placeholder="What you worked on" /><//>
            ${editable && form.rows.length > 1 ? html`<button type="button" className="btn ghost icon" aria-label="Remove line" onClick=${() => { setForm({ ...form, rows: form.rows.filter((_, i) => i !== ri) }); setDirty(true); }}><${Icon} n="trash" /></button>` : html`<span />`}
          </div>
          <div className="days">${DOW.map((d, di) => html`<label key=${d} className=${di > 4 ? 'we' : ''}>${d} ${parseD(days[di]).getDate()}
            <input disabled=${!editable} inputMode="decimal" value=${r.h[di]} placeholder="0" aria-label=${`${d} hours, line ${ri + 1}`}
              onInput=${e => setH(ri, di, e.target.value.replace(/[^0-9.]/g, '').slice(0, 5))} /></label>`)}
            <div className="tot">${h1(r.h.reduce((a, x) => a + numv(x), 0))} h</div></div>
        </div>`)}
        <div className="days sum" aria-label="Daily totals">${totals.map((t, i) => html`<div key=${i} className=${t > 24 ? 'over' : ''}>${h1(t)}</div>`)}<div className="tot" style=${{ fontSize: 17 }}>${h1(grand)} h</div></div>
        ${editable && html`<div><button type="button" className="btn ghost sm" onClick=${() => { setForm({ ...form, rows: [...form.rows, blank()] }); setDirty(true); }}><${Icon} n="plus" />Add line</button></div>`}
      </div>
      <section className="panel stack" style=${{ gap: 14 }}>
        <div><h2 className="ph">Attachments</h2><p className="muted small" style=${{ marginTop: 4 }}>${P.asg.na ? 'Your client requires a signed timesheet. Attach it before submitting.' : 'Attach your client-approved timesheet if your client provides one.'}</p></div>
        ${form.files.length > 0 && html`<ul className="files">${form.files.map(f => html`<li key=${f.id}><${Icon} n="file" /><div className="fn"><b>${f.n}</b><span>${sizeLabel(f.sz || 0)}</span></div>
          <${FileActions} base=${base} f=${f} onDelete=${editable ? () => removeFile(f) : null} /></li>`)}</ul>`}
        ${editable && html`<${FilePick} busy=${busy === 'upload'} progress=${prog} onFiles=${onFiles} label="Drop your signed timesheet here, or choose a file." />`}
        <${Field} label="Notes for your approver"><textarea disabled=${!editable} value=${form.note} onInput=${e => { setForm({ ...form, note: e.target.value }); setDirty(true); }} placeholder="Overtime, holidays, anything your approver should know" /><//>
      </section>
      ${editable && html`<div className="actions">
        <button type="button" className="btn lg" disabled=${!!busy} onClick=${() => act('submit', () => persist(true), cid ? 'Submitted to your client and StratEdge for approval.' : 'Timesheet submitted for approval.')}>${busy === 'submit' ? 'Submitting…' : 'Submit for approval'}</button>
        <button type="button" className="btn ghost lg" disabled=${!!busy} onClick=${() => act('save', () => persist(false), 'Draft saved.')}>${busy === 'save' ? 'Saving…' : 'Save draft'}</button>
        ${dirty && html`<span className="muted small">Unsaved changes</span>`}</div>`}
    <//>`}
    <section className="panel">
      <h2 className="ph" style=${{ marginBottom: 8 }}>Timesheet history</h2>
      ${hist.length ? html`<ul className="list">${(showAll ? hist : hist.slice(0, 8)).map(([w, s]) => { const x = tsStatus(s, (P.asg.rev || {})[w]); return html`<li key=${w}>
        <a href=${'#/portal/timesheets?w=' + w} style=${{ textDecoration: 'none', color: 'inherit' }}><div className="t">${weekLabel(w)}</div><div className="m">${h1(s.t)} hours${s.f ? `, ${s.f} attachment${s.f > 1 ? 's' : ''}` : ''}</div></a>
        <${Chip} s=${x}>${TS_LABEL[x]}<//></li>`; })}</ul>
        ${hist.length > 8 && !showAll && html`<button type="button" className="btn link" style=${{ marginTop: 10 }} onClick=${() => setShowAll(true)}>Show all ${hist.length} weeks</button>`}`
      : html`<${Empty} title="No timesheets yet">Your submitted weeks will be listed here.<//>`}
    </section>
  </div>`;
}

/* ================= Tasks ================= */
function TaskItem({ t }) {
  const P = usePortal(); const toast = useToast();
  const [note, setNote] = useState(t.pr.n || '');
  const [busy, setBusy] = useState(false);
  const save = async (s, n) => {
    setBusy(true);
    try { await dbMerge(`u/${P.uid}`, { tp: { [t.id]: { s, n: (n != null ? n : note).trim(), at: Date.now() } } }); toast(s === 'done' ? 'Task marked done.' : 'Task updated.'); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const s = t.pr.s || 'todo'; const late = t.due && t.due < dkey() && s !== 'done';
  return html`<article className=${'task' + (s === 'done' ? ' isdone' : '')}>
    <div className="ph-row" style=${{ marginBottom: 0, alignItems: 'flex-start' }}><h3>${t.ti}</h3><span className=${'prio ' + (t.p || '')}>${t.p === 'high' ? 'High priority' : t.p === 'low' ? 'Low priority' : 'Normal'}</span></div>
    ${t.d && html`<p className="muted" style=${{ fontSize: 15, whiteSpace: 'pre-wrap' }}>${t.d}</p>`}
    <div className="meta"><span className=${late ? 'late' : ''}>${t.due ? (late ? 'Overdue, was due ' : 'Due ') + fmtDate(t.due) : 'No due date'}</span><span>Assigned ${fmtDay(t.at)}</span></div>
    <div className="row2 form" style=${{ gap: 10 }}>
      <${Field} label="Status"><select value=${s} disabled=${busy} onChange=${e => save(e.target.value)}>${Object.entries(TASK_S).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
      <${Field} label="Update for your manager"><div style=${{ display: 'flex', gap: 8 }}><input value=${note} onInput=${e => setNote(e.target.value)} placeholder="Progress, blockers, links" />
        <button type="button" className="btn ghost" disabled=${busy || note === (t.pr.n || '')} onClick=${() => save(s)}>Save</button></div><//>
    </div>
  </article>`;
}
function Tasks() {
  const P = usePortal();
  const [tab, setTab] = useState('open');
  const all = myTasks(P);
  const list = all.filter(t => tab === 'open' ? t.pr.s !== 'done' : t.pr.s === 'done');
  return html`<div className="stack">
    <div className="tabs" role="tablist">${[['open', 'Open'], ['done', 'Done']].map(([k, v]) => html`<button type="button" key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}<span className="chip">${all.filter(t => k === 'open' ? t.pr.s !== 'done' : t.pr.s === 'done').length}</span></button>`)}</div>
    ${list.length ? list.map(t => html`<${TaskItem} key=${t.id} t=${t} />`) : html`<div className="panel"><${Empty} title=${tab === 'open' ? 'No open tasks' : 'Nothing completed yet'}>Tasks assigned by HR or your manager appear here, along with due dates and priorities.<//></div>`}
  </div>`;
}

/* ================= Time off ================= */
function TimeOff() {
  const P = usePortal(); const toast = useToast();
  const [f, setF] = useState({ k: 'pto', f: '', t: '', r: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  if (!P.prof) return html`<${NeedProfile} />`;
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const submit = async e => {
    e.preventDefault();
    if (!f.f || !f.t) { setErr('Choose the first and last day off.'); return; }
    if (f.t < f.f) { setErr('The last day has to be on or after the first day.'); return; }
    setErr(''); setBusy(true);
    try { await dbMerge(`u/${P.uid}`, { lv: { [nid()]: { k: f.k, f: f.f, t: f.t, r: f.r.trim(), at: Date.now() } } }); setF({ k: 'pto', f: '', t: '', r: '' }); toast('Time-off request sent to HR.'); }
    catch (x) { toast(errText(x), true); }
    setBusy(false);
  };
  const cancel = async id => { try { await dbMerge(`u/${P.uid}`, { lv: { [id]: { x: 1 } } }); toast('Request cancelled.'); } catch (x) { toast(errText(x), true); } };
  const list = Object.entries(P.root.lv || {}).map(([id, l]) => ({ id, ...l, dec: (P.asg.lvd || {})[id] })).sort((a, b) => b.f.localeCompare(a.f));
  const n = bizDays(f.f, f.t);
  return html`<div className="g2" style=${{ alignItems: 'start' }}>
    <form className="panel form" onSubmit=${submit} noValidate>
      <h2 className="ph">Request time off</h2>
      <${Field} label="Type"><select value=${f.k} onChange=${up('k')}>${Object.entries(LEAVE_K).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
      <div className="row2"><${Field} label="First day off"><input type="date" value=${f.f} onInput=${up('f')} /><//><${Field} label="Last day off"><input type="date" min=${f.f} value=${f.t} onInput=${up('t')} /><//></div>
      ${n > 0 && html`<p className="muted small">${n} business day${n > 1 ? 's' : ''}</p>`}
      <${Field} label="Note for HR"><textarea value=${f.r} onInput=${up('r')} placeholder="Optional. Your client lead's approval, coverage plans, etc." /><//>
      ${err && html`<p className="err" role="alert">${err}</p>`}
      <div><button className="btn" disabled=${busy}>${busy ? 'Sending…' : 'Send request'}</button></div>
    </form>
    <section className="panel"><h2 className="ph" style=${{ marginBottom: 8 }}>Your requests</h2>
      ${list.length ? html`<ul className="list">${list.map(l => { const s = l.x ? 'cancelled' : l.dec ? l.dec.s : 'pending'; return html`<li key=${l.id}>
        <div><div className="t">${LEAVE_K[l.k]}: ${fmtDate(l.f)}${l.t !== l.f ? ' to ' + fmtDate(l.t) : ''}</div><div className="m">${bizDays(l.f, l.t)} business day${bizDays(l.f, l.t) === 1 ? '' : 's'}${l.dec && l.dec.c ? '. HR: ' + l.dec.c : ''}</div></div>
        <div className="actions"><${Chip} s=${s}>${s === 'pending' ? 'Pending' : s === 'approved' ? 'Approved' : s === 'declined' ? 'Declined' : 'Cancelled'}<//>${s === 'pending' && html`<button type="button" className="btn ghost sm" onClick=${() => cancel(l.id)}>Cancel</button>`}</div></li>`; })}</ul>`
        : html`<${Empty} title="No requests yet">Requests you send show their approval status here.<//>`}
    </section>
  </div>`;
}

/* ================= Documents ================= */
function Documents() {
  const P = usePortal(); const toast = useToast();
  const base = `u/${P.uid}`;
  const files = useCol(P.prof ? `${base}/f` : null, 'at:desc');
  const [cat, setCat] = useState('other'); const [busy, setBusy] = useState(false); const [prog, setProg] = useState(0);
  if (!P.prof) return html`<${NeedProfile} />`;
  const onFiles = async fs => {
    setBusy(true);
    try { for (const f of fs) { setProg(0.03); await storeFile(base, f, { c: cat }, setProg); } toast('Document uploaded.'); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const del = async f => { try { await deleteStored(base, f.id, f.np); toast('Document deleted.'); } catch (e) { toast(errText(e), true); } };
  return html`<div className="stack">
    <section className="panel stack" style=${{ gap: 14 }}>
      <div><h2 className="ph">Upload a document</h2><p className="muted small" style=${{ marginTop: 4 }}>Only you and StratEdge HR can open your documents.</p></div>
      <div style=${{ maxWidth: 320 }}><${Field} label="Document type"><select value=${cat} onChange=${e => setCat(e.target.value)}>${Object.entries(DOC_CATS).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//></div>
      <${FilePick} busy=${busy} progress=${prog} onFiles=${onFiles} />
    </section>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${files.loading ? html`<${Spinner} />` : files.docs.length ? html`<div className="tblwrap"><table className="tbl">
        <thead><tr><th>Name</th><th>Type</th><th>Uploaded</th><th className="r">Size</th><th className="r"><span className="sr">Actions</span></th></tr></thead>
        <tbody>${files.docs.map(f => html`<tr key=${f.id}><td><b style=${{ fontWeight: 600 }}>${f.n}</b>${f.w ? html`<div className="muted small">Week of ${fmtDate(f.w)}</div>` : ''}${f.vf ? html`<div className="small"><${Chip} s=${f.vf.s === 'verified' ? 'ok' : 'red'}>${f.vf.s === 'verified' ? 'Verified by HR' : 'Sent back'}<//>${f.vf.n ? html` <span className="muted">${f.vf.n}</span>` : ''}</div>` : ''}</td><td>${DOC_CATS[f.c] || (f.c === 'onboarding' ? 'Onboarding' : 'Other')}</td><td className="num">${fmtDay(f.at)}</td><td className="r num">${sizeLabel(f.sz)}</td>
          <td className="r"><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}><${FileActions} base=${base} f=${f} onDelete=${f.w ? null : () => del(f)} /></div></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title="No documents yet">Upload agreements, insurance certificates, tax forms or invoices so HR has them on file.<//>`}
    </section>
  </div>`;
}

/* ================= Profile ================= */
function Profile() {
  const P = usePortal(); const a = P.asg; const me = P.people[P.uid] || Cap.me || {};
  const emp = P.role === 'employer';
  return html`<div className="g2" style=${{ alignItems: 'start' }}>
    <section className="panel stack"><h2 className="ph">${P.prof ? 'Your details' : 'Set up your profile'}</h2>
      <${ProfileForm} uid=${P.uid} initial=${P.prof} /></section>
    <div className="stack">
      <section className="panel"><h2 className="ph" style=${{ marginBottom: 14 }}>Signed in as</h2>
        <div className="person"><${Avatar} p=${me} size=${44} /><div><b>${me.name || 'Your account'}</b><span>${me.email || ''}${me.email ? ', ' : ''}${P.isAdmin ? 'admin access' : portalLabel(P.role).toLowerCase()}</span></div></div></section>
      <${PasswordPanel} />
      <section className="panel"><h2 className="ph" style=${{ marginBottom: 14 }}>${emp ? 'Your company' : 'Assignment'}</h2>
        ${emp ? html`<dl className="kv"><dt>Company</dt><dd>${a.cl || (P.prof && P.prof.co) || '—'}</dd>${a.ec && html`<dt>End client</dt><dd>${a.ec}</dd>`}<dt>Access</dt><dd>Approve timesheets, see attendance, post requirements</dd></dl>`
          : a.cl || a.pr || a.ty ? html`<dl className="kv">
          ${a.ty && html`<dt>Engagement</dt><dd>${a.ty}</dd>`}${a.cl && html`<dt>Client or vendor</dt><dd>${a.cl}</dd>`}${a.ec && html`<dt>End client</dt><dd>${a.ec}</dd>`}
          ${a.pr && html`<dt>Projects</dt><dd>${a.pr}</dd>`}${a.mgr && html`<dt>Approver</dt><dd>${a.mgr}</dd>`}${a.sd && html`<dt>Start date</dt><dd>${fmtDate(a.sd, { month: 'long', day: 'numeric', year: 'numeric' })}</dd>`}</dl>`
          : html`<p className="muted">HR hasn't added assignment details yet.</p>`}</section>
    </div>
  </div>`;
}

function PasswordPanel() {
  const toast = useToast();
  const [f, setF] = useState({ c: '', n: '', n2: '' }); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const save = async e => {
    e.preventDefault();
    if (f.n.length < 8) { setErr('Use a new password of at least 8 characters.'); return; }
    if (f.n !== f.n2) { setErr('The new passwords don\u2019t match.'); return; }
    setErr(''); setBusy(true);
    try { await api('password', { current: f.c, new: f.n }); setF({ c: '', n: '', n2: '' }); toast('Password changed.'); } catch (x) { setErr(errText(x)); }
    setBusy(false);
  };
  return html`<form className="panel form" onSubmit=${save} noValidate><h2 className="ph">Change password</h2>
    <${Field} label="Current password"><input type="password" value=${f.c} onInput=${up('c')} autoComplete="current-password" /><//>
    <div className="row2"><${Field} label="New password"><input type="password" value=${f.n} onInput=${up('n')} autoComplete="new-password" /><//><${Field} label="Confirm new password"><input type="password" value=${f.n2} onInput=${up('n2')} autoComplete="new-password" /><//></div>
    ${err && html`<p className="err" role="alert">${err}</p>`}
    <div><button className="btn ghost" disabled=${busy}>${busy ? 'Saving…' : 'Update password'}</button></div></form>`;
}

/* ================= Earnings (computed from clock-ins) ================= */
const payLabel = p => p.type === 'hourly' ? `${fmtMoney(p.amt, p.cur)} per hour` : `${fmtMoney(p.amt, p.cur)} per month`;
function PayBreakdown({ c }) {
  const cur = c.p.cur; const M = n => fmtMoney(n, cur);
  const row = (label, note, v, cls) => html`<tr className=${cls || ''}><td><b style=${{ fontWeight: cls ? 750 : 600 }}>${label}</b>${note && html`<div className="muted small">${note}</div>`}</td><td className="r num">${v}</td></tr>`;
  return html`<div className="tblwrap"><table className="tbl">
    <tbody>
      ${row(c.p.type === 'hourly' ? 'Regular hours' : 'Base pay', c.p.type === 'hourly' ? `${hm(c.reg)} × ${M(c.hourRate)} per hour` : c.p.lop ? `${M(c.p.amt)} ÷ ${c.workDays} working days = ${M(c.dayRate)} per day × ${c.paidDays} paid day${c.paidDays === 1 ? '' : 's'}` : 'Fixed monthly salary', M(c.base))}
      ${(c.ot > 0 || c.otPay > 0) && row('Overtime', `${hm(c.ot)}${c.p.type === 'hourly' ? ` × ${M(c.hourRate)}` : ` × ${M(c.hourRate)} per hour`}${+c.p.ot ? ` × ${+c.p.ot}` : (c.p.type === 'monthly' ? ', not paid under this pay plan' : '')}`, M(c.otPay))}
      ${c.allow.map(a => row(a.n, a.note || 'Allowance', '+ ' + M(a.v)))}
      ${row('Gross pay', '', M(c.gross), 'sum')}
      ${c.ded.map(a => row(a.n, a.note || 'Deduction', '− ' + M(a.v)))}
      ${c.adj.map(a => row(a.n, 'This month only', (a.v < 0 ? '− ' : '+ ') + M(Math.abs(a.v))))}
      ${row('Net pay', c.unpaidDays ? `${c.unpaidDays} unpaid day${c.unpaidDays === 1 ? '' : 's'} (loss of pay)` : '', M(c.net), 'sum')}
    </tbody></table></div>`;
}
function payCsv(c, mk, name) {
  const M = n => r2(n).toFixed(2);
  const rows = [['Payslip', name, monthLabel(mk)], ['Currency', c.p.cur], ['Pay plan', c.p.type === 'hourly' ? 'Hourly' : 'Monthly', M(c.p.amt)], [],
    ['Working days', c.workDays], ['Present days', c.present], ['Paid leave days', c.leaveDays], ['Unpaid days', c.unpaidDays], ['Regular hours', hrs(c.reg)], ['Overtime hours', hrs(c.ot)], [],
    ['Base pay', M(c.base)], ['Overtime pay', M(c.otPay)], ...c.allow.map(a => [a.n, M(a.v)]), ['Gross pay', M(c.gross)], ...c.ded.map(a => [a.n, '-' + M(a.v)]), ...c.adj.map(a => [a.n, M(a.v)]), ['Net pay', M(c.net)], [],
    ['Date', 'Day type', 'Hours', 'Overtime'], ...c.days.map(d => [d.k, d.h ? 'Holiday' : !d.w ? 'Weekend' : d.lv ? 'Paid leave' : d.m ? 'Present' : 'Absent', hrs(d.m), hrs(d.ot)])];
  return toCSV(rows);
}
function Earnings() {
  const P = usePortal(); const toast = useToast(); const ps = payStartOf(P.settings);
  const [mk, setMk] = useState(cycleFor(dkey(), ps));
  const pay = P.asg.pay; const ready = !!(P.prof && pay && +pay.amt); const cyc = cycleRange(mk, ps);
  const md = useCycleAtt(P.uid, cyc, ready);
  if (!P.prof) return html`<${NeedProfile} />`;
  if (!ready) return html`<div className="stack"><${NoPayPlan} /><${MyPaystubs} /></div>`;
  const c = computePay(pay, md.data, mk, approvedLeaves(P.root, P.asg), P.settings.hol || [], (P.asg.payAdj || {})[mk] || [], { from: cyc.from, to: cyc.to, approvals: P.asg.attA, requireApproval: attApprovalOn(P.settings), breakMax: breakMaxOf(P.settings) });
  const M = n => fmtMoney(n, c.p.cur);
  const exp = async () => { try { await saveDownload(`payslip-${mk}.csv`, payCsv(c, mk, P.prof.n)); } catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); } };
  return html`<div className="stack">
    <div className="toolbar">
      <div className="wknav"><button type="button" className="btn ghost icon" aria-label="Previous pay period" onClick=${() => setMk(addMonths(mk, -1))}><${Icon} n="left" /></button><b>${cyc.label}</b>
        <button className="btn ghost icon" aria-label="Next pay period" disabled=${mk >= cycleFor(dkey(), ps)} onClick=${() => setMk(addMonths(mk, 1))}><${Icon} n="right" /></button></div>
      <span className="muted small">${payLabel(c.p)}${c.p.from ? ', from ' + fmtDate(c.p.from, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}${ps > 1 ? `. Pay period runs from the ${ps}${ps === 26 ? 'th' : ''} to the ${ps - 1}${ps - 1 === 25 ? 'th' : ''}.` : ''}</span>
      <div className="push"><button type="button" className="btn ghost" onClick=${exp}><${Icon} n="down" />Download payslip</button></div>
    </div>
    <div className="kpis" style=${{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
      <a><b>${M(c.net)}</b><span>Net pay${mk === mkey(dkey()) ? ' so far' : ''}</span></a>
      <a><b>${c.present}<span style=${{ fontSize: 16, fontWeight: 600 }}> / ${c.workDays}</span></b><span>Approved days / working days${+c.p.wdm > 0 ? ' (standard ' + c.p.wdm + ')' : ''}${c.pending ? `, ${c.pending} awaiting admin approval` : ''}</span></a>
      <a><b>${hm(c.reg)}</b><span>Regular hours</span></a>
      <a><b>${hm(c.ot)}</b><span>Overtime hours</span></a>
    </div>
    ${md.loading ? html`<${Spinner} />` : html`<${Fragment}>
      <section className="panel" style=${{ padding: '6px 8px' }}><h2 className="ph" style=${{ padding: '12px 12px 4px' }}>Breakdown</h2><${PayBreakdown} c=${c} /></section>
      <section className="panel" style=${{ padding: '6px 8px' }}><h2 className="ph" style=${{ padding: '12px 12px 4px' }}>Day by day</h2>
        <div className="tblwrap"><table className="tbl"><thead><tr><th>Date</th><th>Day</th><th className="r">Hours</th><th className="r">Overtime</th>${c.p.type === 'hourly' && html`<th className="r">Pay</th>`}</tr></thead>
          <tbody>${c.days.filter(d => d.m || d.w || d.h || d.lv).map(d => html`<tr key=${d.k}><td>${fmtDate(d.k)}</td>
            <td>${d.h ? html`<${Chip}>Holiday<//>` : !d.w ? html`<${Chip}>Weekend<//>` : d.lv ? html`<${Chip} s="new">Paid leave<//>` : d.m ? html`<${Chip} s="ok">Present<//>` : d.k > dkey() ? html`<span className="muted small">Upcoming</span>` : html`<${Chip} s="red">Absent<//>`}</td>
            <td className="r num">${d.m ? hm(d.m) : ''}</td><td className="r num">${d.ot ? hm(d.ot) : ''}</td>
            ${c.p.type === 'hourly' && html`<td className="r num">${d.m ? M(d.reg / 60 * c.hourRate + d.ot / 60 * c.hourRate * (+c.p.ot || 1)) : ''}</td>`}</tr>`)}</tbody></table></div></section>
    <//>`}
    <p className="muted small">Computed from your clock-ins and clock-outs${c.p.type === 'monthly' ? `, on a ${c.p.days === 'mon-sat' ? 'Monday to Saturday' : c.p.days === 'all' ? 'seven-day' : 'Monday to Friday'} basis` : ''}. A session counts after you clock out. Final payroll is confirmed by StratEdge.</p>
      <${MyPaystubs} />
  </div>`;
}
function EarnCard() {
  const P = usePortal(); const pay = P.asg.pay; const ps = payStartOf(P.settings); const mk = cycleFor(dkey(), ps); const cyc = cycleRange(mk, ps);
  const md = useCycleAtt(P.uid, cyc, !!(pay && +pay.amt));
  if (!pay || !+pay.amt) return null;
  const c = computePay(pay, md.data, mk, approvedLeaves(P.root, P.asg), P.settings.hol || [], (P.asg.payAdj || {})[mk] || [], { from: cyc.from, to: cyc.to, approvals: P.asg.attA, requireApproval: attApprovalOn(P.settings), breakMax: breakMaxOf(P.settings) });
  return html`<section className="panel"><div className="ph-row"><h2 className="ph">Earnings this pay period</h2><a className="small" href="#/portal/pay">Full breakdown</a></div>
    <div className="bignum">${fmtMoney(c.net, c.p.cur)}</div><p className="muted small">${cyc.short}: ${c.present} of ${c.workDays} approved days so far${c.pending ? `, ${c.pending} awaiting approval` : ''}, ${hm(c.reg + c.ot)} clocked. ${payLabel(c.p)}.</p></section>`;
}

/* ================= Onboarding (employee view) & policies ================= */
function OnboardingPage() {
  const P = usePortal(); const toast = useToast();
  const onb = P.asg.onb; const base = `u/${P.uid}`;
  const files = useCol(P.prof ? `${base}/f` : null, 'at:desc');
  const [busyId, setBusyId] = useState(''); const [prog, setProg] = useState(0);
  if (!P.prof) return html`<${NeedProfile} />`;
  if (!onb || onb.kind === 'done') return html`<div className="panel"><${Empty} title=${onb ? 'Your checklist is complete' : 'No checklist yet'}>${onb ? 'HR has verified everything. Your documents stay under Documents.' : 'When HR starts your onboarding, the documents and steps you need to complete appear here.'}<//></div>`;
  const items = tplItems(P.tpl, onb.kind); const st = onb.items || {}; const up = P.root.onbUp || {};
  const upload = async (item, fs) => {
    setBusyId(item.id);
    try { setProg(0.03); const r = await storeFile(base, fs[0], { c: 'onboarding', item: item.id }, setProg); await dbMerge(base, { onbUp: { [item.id]: r.id } }); toast(`${item.n}: uploaded. HR will verify it.`); }
    catch (e) { toast(errText(e), true); }
    setBusyId('');
  };
  const done = items.filter(i => ['verified', 'na'].includes((st[i.id] || {}).s)).length;
  return html`<div className="stack">
    <div className="note info"><span><b>${onb.kind === 'off' ? 'Offboarding' : 'Onboarding'} checklist.</b> Upload each document below; HR verifies it and ticks it off. ${done} of ${items.length} done.</span></div>
    ${items.map(i => { const s = st[i.id] || {}; const fid = up[i.id]; const f = fid && files.docs.find(x => x.id === fid); const status = s.s || (fid ? 'received' : 'pending'); return html`<section key=${i.id} className="panel stack" style=${{ gap: 10 }}>
      <div className="ph-row" style=${{ marginBottom: 0 }}><div><h2 className="ph">${i.n}</h2>${i.d && html`<p className="muted small" style=${{ marginTop: 4 }}>${i.d}</p>`}</div><${Chip} s=${status === 'verified' || status === 'na' ? 'ok' : status === 'received' ? 'amber' : ''}>${ONB_ST[status] || status}<//></div>
      ${s.n && html`<p className="small"><b>HR:</b> ${s.n}</p>`}
      ${i.doc && status !== 'verified' && status !== 'na' && html`<${Fragment}>
        ${f && html`<ul className="files"><li><${Icon} n="file" /><div className="fn"><b>${f.n}</b><span>Uploaded ${fmtDay(f.at)}</span></div><${FileActions} base=${base} f=${f} /></li></ul>`}
        <${FilePick} busy=${busyId === i.id} progress=${prog} onFiles=${fs => upload(i, fs)} label=${f ? 'Replace with a new file.' : 'Upload this document.'} />
      <//>`}
      ${i.doc && f && status === 'verified' && html`<ul className="files"><li><${Icon} n="file" /><div className="fn"><b>${f.n}</b><span>Verified by HR</span></div><${FileActions} base=${base} f=${f} /></li></ul>`}
    </section>`; })}
  </div>`;
}
function PoliciesPage() {
  const files = useCol('org/hr/f', 'at:desc');
  const groups = {}; files.docs.forEach(f => { (groups[f.c || 'other'] = groups[f.c || 'other'] || []).push(f); });
  return html`<div className="stack">
    ${files.loading ? html`<${Spinner} />` : files.docs.length ? Object.entries(POLICY_CATS).filter(([k]) => groups[k]).map(([k, v]) => html`<section key=${k} className="panel"><h2 className="ph" style=${{ marginBottom: 10 }}>${v}</h2>
      <ul className="files">${groups[k].map(f => html`<li key=${f.id}><${Icon} n="file" /><div className="fn"><b>${f.n}</b><span>Updated ${fmtDay(f.at)}, ${sizeLabel(f.sz)}</span></div><${FileActions} base="org/hr" f=${f} /></li>`)}</ul></section>`)
      : html`<div className="panel"><${Empty} title="No policies published yet">HR publishes the employee handbook, leave policy and templates here.<//></div>`}
  </div>`;
}

/* Earnings before a pay plan exists: admins set their own right here; employees can nudge HR */
function NoPayPlan() {
  const P = usePortal(); const toast = useToast(); const [busy, setBusy] = useState(false);
  if (P.isAdmin) return html`<section className="panel stack" style=${{ gap: 14 }}>
    <div><h2 className="ph">Set up your pay plan</h2><p className="muted small" style=${{ marginTop: 4 }}>No salary or hourly rate is on file for your account yet. As ${P.roleName === 'admin' ? 'an administrator' : 'staff'} you can set it here; it saves to your own record, the same as Team › your name › Pay.</p></div>
    <${PayForm} m=${{ id: P.uid, r: P.asg, u: P.root }} />
  </section>`;
  const asked = P.root && P.root.payReq;
  const ask = async () => { setBusy(true); try { await dbMerge(`u/${P.uid}`, { payReq: Date.now() }); toast('HR has been notified.'); } catch (e) { toast(errText(e), true); } setBusy(false); };
  return html`<div className="panel"><${Empty} title="Your pay plan isn't set up yet" action=${html`<button type="button" className="btn" disabled=${busy || !!asked} onClick=${ask}>${asked ? 'HR notified ' + fmtDay(asked) : 'Ask HR to set it up'}</button>`}>StratEdge HR adds your salary or hourly rate and any allowances under Team › your name › Pay. Once that's done, this page shows your earnings for each month, computed from your clock-ins.<//></div>`;
}

/* Location sharing status on the clock card, with a one-click way to allow it */
function LocationStatus() {
  const toast = useToast(); const [st, setSt] = useState('checking'); const [pos, setPos] = useState(null); const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; locPermission().then(s => { if (live) setSt(s); }); return () => { live = false; }; }, []);
  const share = async () => { setBusy(true); const r = await getPosition(12000); setBusy(false); if (r.pos) { setPos(r.pos); setSt('granted'); try { await api('login_geo', { ...r.pos }); } catch (e) { /* no login record to attach to */ } toast(`Location shared (±${r.pos.acc} m). Clock-ins and breaks will include it.`); } else { setSt(r.err); toast(`Exact location ${POS_ERR[r.err] || 'not available'}.`, true); } };
  const ok = st === 'granted' || !!pos;
  const text = ok ? `Exact location on${pos ? ` (±${pos.acc} m)` : ''}` : st === 'insecure' ? 'Exact location needs https on this site' : st === 'denied' ? 'Location blocked in your browser' : st === 'checking' ? 'Checking location…' : 'Share your location so clock-ins record where you are';
  return html`<div className=${'locstat ' + (ok ? 'ok' : st === 'insecure' || st === 'denied' ? 'bad' : '')}>
    <${Icon} n="globe" /><span>${text}</span>
    ${!ok && st !== 'insecure' && html`<button type="button" className="btn ghost sm" disabled=${busy} onClick=${share}>${busy ? 'Locating…' : st === 'denied' ? 'Try again' : 'Share my location'}</button>`}
    ${st === 'denied' && html`<div className="muted small" style=${{ flexBasis: '100%' }}>Allow it from the lock icon next to the address bar (Site settings › Location), then try again.</div>`}
    ${st === 'insecure' && html`<div className="muted small" style=${{ flexBasis: '100%' }}>Browsers only share exact location on https pages. Ask the admin to enable SSL for the site; the network address is still recorded.</div>`}
  </div>`;
}
