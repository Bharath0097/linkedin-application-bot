/* ================= Website effects ================= */
const REDUCED = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function FxLayer() {
  const cv = useRef(null);
  useEffect(() => {
    const c = cv.current; if (!c) return;
    const x = c.getContext('2d'); let raf = 0, live = true, w = 0, h = 0, pts = [];
    const dpr = Math.min(1.5, window.devicePixelRatio || 1); const mobile = innerWidth < 760;
    const resize = () => { w = innerWidth; h = innerHeight; c.width = w * dpr; c.height = h * dpr; c.style.width = w + 'px'; c.style.height = h + 'px'; x.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = mobile ? 34 : Math.min(90, Math.round(w * h / 22000)); pts = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - .5) * .22, vy: (Math.random() - .5) * .22, r: 1 + Math.random() * 1.6, t: Math.random() < .5 })); };
    const draw = () => {
      x.clearRect(0, 0, w, h);
      for (let i = 0; i < pts.length; i++) { const p = pts[i]; p.x += p.vx; p.y += p.vy; if (p.x < -10) p.x = w + 10; if (p.x > w + 10) p.x = -10; if (p.y < -10) p.y = h + 10; if (p.y > h + 10) p.y = -10; }
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) { const a = pts[i], b = pts[j]; const dx = a.x - b.x, dy = a.y - b.y; const d2 = dx * dx + dy * dy; if (d2 < 16900) { const al = (1 - Math.sqrt(d2) / 130) * .35; x.strokeStyle = `rgba(124,140,255,${al})`; x.lineWidth = 1; x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke(); } }
      for (const p of pts) { x.fillStyle = p.t ? 'rgba(34,229,216,.85)' : 'rgba(124,140,255,.85)'; x.beginPath(); x.arc(p.x, p.y, p.r, 0, Math.PI * 2); x.fill(); }
    };
    const loop = () => { if (!live) return; if (!document.hidden) draw(); raf = requestAnimationFrame(loop); };
    resize(); addEventListener('resize', resize);
    if (REDUCED()) draw(); else loop();
    const spot = document.querySelector('.fx-spot');
    const mm = e => { if (spot) { spot.style.setProperty('--mx', e.clientX + 'px'); spot.style.setProperty('--my', e.clientY + 'px'); } };
    if (!mobile && !REDUCED()) addEventListener('pointermove', mm, { passive: true });
    return () => { live = false; cancelAnimationFrame(raf); removeEventListener('resize', resize); removeEventListener('pointermove', mm); };
  }, []);
  return html`<div className="fx" aria-hidden="true"><div className="fx-aurora" /><canvas ref=${cv} className="fx-net" /><div className="fx-grid" /><div className="fx-spot" /></div>`;
}
/* scroll reveal + 3D tilt, installed once per route render */
function useFxBehaviors(dep) {
  useEffect(() => {
    const reduced = REDUCED();
    const els = [...document.querySelectorAll('.rv:not(.in)')];
    let io = null;
    if (reduced || !('IntersectionObserver' in window)) els.forEach(e => e.classList.add('in'));
    else { io = new IntersectionObserver(en => en.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12, rootMargin: '0px 0px -40px 0px' }); els.forEach(e => io.observe(e)); }
    const onMove = e => { const el = e.target.closest && e.target.closest('.tilt'); if (!el || reduced) return; const r = el.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width - .5, py = (e.clientY - r.top) / r.height - .5; el.style.setProperty('--ry', (px * 10) + 'deg'); el.style.setProperty('--rx', (-py * 10) + 'deg'); el.style.setProperty('--gx', ((px + .5) * 100) + '%'); el.style.setProperty('--gy', ((py + .5) * 100) + '%'); };
    const onOut = e => { const el = e.target.closest && e.target.closest('.tilt'); if (!el) return; el.style.removeProperty('--ry'); el.style.removeProperty('--rx'); };
    document.addEventListener('pointermove', onMove, { passive: true }); document.addEventListener('pointerout', onOut, { passive: true });
    return () => { io && io.disconnect(); document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerout', onOut); };
  }, [dep]);
}
function useCountUp(target, ms) {
  const [v, setV] = useState(0); const ref = useRef(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (REDUCED() || !('IntersectionObserver' in window)) { setV(target); return; }
    const io = new IntersectionObserver(en => { if (!en[0].isIntersecting) return; io.disconnect(); const t0 = performance.now(); const step = t => { const k = Math.min(1, (t - t0) / (ms || 1400)); setV(Math.round(target * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); }, { threshold: .4 });
    io.observe(el); return () => io.disconnect();
  }, [target]);
  return [v, ref];
}
function Counter({ n, suffix, label }) {
  const [v, ref] = useCountUp(n);
  return html`<div ref=${ref} className="counter"><b>${v.toLocaleString()}${suffix || ''}</b><span>${label}</span></div>`;
}
function Rotator({ words }) {
  const [i, setI] = useState(0);
  useEffect(() => { if (REDUCED()) return; const t = setInterval(() => setI(x => (x + 1) % words.length), 2400); return () => clearInterval(t); }, [words.length]);
  return html`<span className="rot" aria-live="polite"><span key=${i} className="rot-in">${words[i]}</span></span>`;
}
const SKILLS = ['SAP S/4HANA', 'React', 'Java', 'Python', '.NET', 'AWS', 'Azure', 'Kubernetes', 'Cisco', 'Palo Alto', 'HL7 / FHIR', 'Salesforce', 'Terraform', 'Snowflake', 'Node.js', 'Flutter', 'Power BI', 'ServiceNow'];
const Marquee = () => html`<div className="marquee" aria-hidden="true"><div className="marquee-track">${[...SKILLS, ...SKILLS].map((s, i) => html`<span key=${i}>${s}</span>`)}</div></div>`;

/* ================= Services explorer, models, planner ================= */
const SERVICE_ICON = { staffing: 'users', 'web-development': 'globe', 'app-development': 'phone', 'software-development': 'code', 'digital-marketing': 'mega', 'ui-ux': 'pen', 'it-consultancy': 'compass', 'erp-crm': 'layers', devops: 'cloud', healthcare: 'heart', 'clinical-saas': 'flask' };
function ServicesExplorer() {
  const [cur, setCur] = useState(SERVICES[0].s);
  const s = SERVICES.find(x => x.s === cur); const x = SERVICE_EXTRA[cur] || {};
  return html`<div className="xp">
    <div className="xp-list" role="tablist" aria-label="Services">${SERVICES.map(v => html`<button type="button" key=${v.s} role="tab" aria-selected=${cur === v.s} className=${cur === v.s ? 'on' : ''} onClick=${() => setCur(v.s)}><${Icon} n=${SERVICE_ICON[v.s]} /><span>${v.n}</span></button>`)}</div>
    <div className="xp-detail" key=${cur}>
      <div className="xp-head"><span className="xp-ico"><${Icon} n=${SERVICE_ICON[cur]} /></span><div><h3>${s.n}</h3><p>${s.l}</p></div></div>
      <div className="xp-grid">
        <div><h4>What we deliver</h4><ul className="ticks">${(x.deliver || s.inc).map(i => html`<li key=${i}>${i}</li>`)}</ul></div>
        <div className="xp-facts">
          ${x.time && html`<div><span className="lbl2">Timeline</span><b>${x.time}</b></div>`}
          ${x.team && html`<div><span className="lbl2">Typical team</span><b>${x.team}</b></div>`}
          ${x.models && html`<div><span className="lbl2">Engagement</span><b>${x.models}</b></div>`}
          ${x.who && html`<div><span className="lbl2">Built for</span><b>${x.who}</b></div>`}
        </div>
      </div>
      ${x.tech && html`<div className="models" style=${{ marginTop: 18 }}>${x.tech.map(t => html`<span key=${t}>${t}</span>`)}</div>`}
      <div className="actions" style=${{ marginTop: 24 }}><a className="btn" href=${'#/services/' + cur}>Full details</a><a className="btn ghost" href="#/contact">Book a free consultation</a></div>
    </div>
  </div>`;
}
const MODELS = [
  ['C2C', 'Experienced consultants who run their own company', 'The consultant\u2019s company', 'Hourly, invoiced', 'Months to years', 'StratEdge and the consultant\u2019s company'],
  ['W2', 'Clients who want simple classification', 'StratEdge', 'Hourly or salaried', 'Months to years', 'StratEdge'],
  ['1099', 'Short, well-defined work by independents', 'Self-employed', 'Hourly or fixed', 'Weeks to months', 'The contractor, with StratEdge paperwork'],
  ['Contract-to-hire', 'Try before converting to full-time', 'StratEdge, then you', 'Hourly, then salary', '3 to 6 months, then permanent', 'StratEdge, then your HR'],
  ['Direct hire', 'Permanent roles you want filled fast', 'You', 'Placement fee', 'Permanent', 'Your HR'],
  ['SOW team', 'A deliverable, not a headcount', 'StratEdge', 'Milestones or monthly', 'Project length', 'StratEdge'],
];
const ModelsTable = () => html`<div className="card tblwrap" style=${{ padding: 6 }}><table className="tbl models-tbl"><thead><tr><th>Model</th><th>Best for</th><th>Who employs</th><th>Billing</th><th>Typical duration</th><th>Compliance handled by</th></tr></thead>
  <tbody>${MODELS.map(r => html`<tr key=${r[0]}><td><b>${r[0]}</b></td>${r.slice(1).map((c, i) => html`<td key=${i}>${c}</td>`)}</tr>`)}</tbody></table></div>`;

const PLAN_ROLES = ['Network Engineer', 'SAP Functional Consultant', 'SAP Technical (ABAP)', 'React Developer', 'Java Developer', 'Python Developer', '.NET Developer', 'Cloud / DevOps Engineer', 'Data Engineer', 'QA Engineer', 'Healthcare IT Analyst', 'Project Manager', 'Business Analyst', 'Finance & Accounting'];
function TeamPlanner() {
  const [plan, setPlan] = useState({}); const [f, setF] = useState({ loc: '', ty: 'C2C', md: 'Onsite', sd: '' });
  const toggle = r => setPlan(p => { const n = { ...p }; if (n[r]) delete n[r]; else n[r] = 1; return n; });
  const bump = (r, d) => setPlan(p => ({ ...p, [r]: Math.max(1, (p[r] || 1) + d) }));
  const roles = Object.entries(plan); const total = roles.reduce((a, [, n]) => a + n, 0);
  const send = () => { const q = encodeURIComponent(JSON.stringify({ roles: roles.map(([r, n]) => `${n} × ${r}`), ...f })); location.hash = '#/request-talent?plan=' + q; };
  return html`<div className="planner">
    <div className="planner-roles">${PLAN_ROLES.map(r => html`<button key=${r} type="button" className=${'chipbtn' + (plan[r] ? ' on' : '')} aria-pressed=${!!plan[r]} onClick=${() => toggle(r)}>${r}${plan[r] ? html` <b>×${plan[r]}</b>` : ''}</button>`)}</div>
    <div className="planner-side">
      <h3>${total ? `${total} ${total === 1 ? 'person' : 'people'} across ${roles.length} role${roles.length === 1 ? '' : 's'}` : 'Pick the roles you need'}</h3>
      ${roles.length ? html`<ul className="list">${roles.map(([r, n]) => html`<li key=${r}><span>${r}</span><span className="qty"><button type="button" aria-label=${'Fewer ' + r} onClick=${() => bump(r, -1)}>−</button><b>${n}</b><button type="button" aria-label=${'More ' + r} onClick=${() => bump(r, 1)}>+</button></span></li>`)}</ul>` : html`<p className="muted small">Tap roles on the left. Add more than one person per role with the + button.</p>`}
      <div className="row2 form" style=${{ gap: 10 }}><${Field} label="Location"><input value=${f.loc} onInput=${e => setF({ ...f, loc: e.target.value })} placeholder="City, state or remote" /><//><${Field} label="Start"><input type="date" value=${f.sd} onInput=${e => setF({ ...f, sd: e.target.value })} /><//></div>
      <div className="row2 form" style=${{ gap: 10 }}><${Field} label="Engagement"><select value=${f.ty} onChange=${e => setF({ ...f, ty: e.target.value })}>${['C2C', 'W2', '1099', 'Contract-to-hire', 'Direct hire', 'SOW project team'].map(t => html`<option key=${t}>${t}</option>`)}</select><//><${Field} label="Work mode"><select value=${f.md} onChange=${e => setF({ ...f, md: e.target.value })}>${['Onsite', 'Hybrid', 'Remote'].map(t => html`<option key=${t}>${t}</option>`)}</select><//></div>
      <button type="button" className="btn lg" style=${{ width: '100%' }} disabled=${!roles.length} onClick=${send}><${Icon} n="send" />Send this plan to StratEdge</button>
    </div>
  </div>`;
}
function PortalStatus() {
  const c = useCaps();
  return html`<span className="status"><i className=${c && c.state !== 'none' ? 'ok' : ''} />${c && c.state !== 'none' ? 'Portal online' : c ? 'Portal unreachable' : 'Checking portal'}</span>`;
}

/* ================= Reference-style sections ================= */
const REPORT_BARS = [9, 12, 7, 14, 10];
function WeeklyReportCard() {
  const [on, setOn] = useState(false); const ref = useRef(null);
  useEffect(() => { const el = ref.current; if (!el || REDUCED() || !('IntersectionObserver' in window)) { setOn(true); return; } const io = new IntersectionObserver(en => { if (en[0].isIntersecting) { setOn(true); io.disconnect(); } }, { threshold: .3 }); io.observe(el); return () => io.disconnect(); }, []);
  return html`<div ref=${ref} className=${'report' + (on ? ' on' : '')}>
    <div className="report-head"><div><h3>Weekly engagement report</h3><p className="muted small">What every client receives each week</p></div><span className="tag">Sample</span></div>
    <div className="report-nums"><div><b>14</b><span>Profiles submitted</span></div><div><b>6</b><span>Interviews</span></div><div><b>2</b><span>Offers</span></div></div>
    <div className="report-bars" aria-hidden="true">${REPORT_BARS.map((v, i) => html`<div key=${i}><i style=${{ height: (v / 14 * 100) + '%' }} /><span>${DOW[i]}</span></div>`)}</div>
    <ul className="report-list">
      <li><span>SAP PP/QM Analyst, Edison NJ</span><${Chip} s="new">Interview<//></li>
      <li><span>Senior Network Engineer, remote</span><${Chip} s="amber">Submitted<//></li>
      <li><span>Java Developer, Dallas TX</span><${Chip} s="ok">Client round<//></li>
    </ul>
  </div>`;
}
const PLANS = [
  { k: 'C2C', t: 'Corp-to-corp', d: 'Consultants who run their own company and invoice for hours.', best: 'experienced consultants and clients who need speed', pts: ['Screened profiles with RTR in days', 'Consultant\u2019s company carries insurance and taxes', 'Weekly timesheets approved by your manager', 'Replacement on request'] },
  { k: 'W2', t: 'W2 contract', d: 'StratEdge employs the consultant and handles payroll and compliance.', best: 'clients who want simple classification', pts: ['Everything in C2C, plus:', 'StratEdge as employer of record', 'Payroll, benefits and tax handled', 'Convert to your payroll when you\u2019re ready'], rec: true },
  { k: 'Contract-to-hire', t: 'Contract-to-hire', d: 'Work together first, then bring the consultant onto your team.', best: 'roles you want to fill permanently with less risk', pts: ['3 to 6 months on contract', 'Conversion terms agreed up front', 'Onboarding support through the switch', 'No surprise fees'] },
  { k: 'SOW project team', t: 'SOW project team', d: 'A delivery team with an outcome, a timeline and milestones.', best: 'projects you\u2019d rather hand off than staff', pts: ['Scoped plan and estimate after discovery', 'Tech lead, engineers and QA', 'Milestone or monthly billing', 'Support after go-live'] },
];
function PlanCards() {
  const go = k => { location.hash = '#/request-talent?plan=' + encodeURIComponent(JSON.stringify({ roles: [], ty: k })); };
  return html`<div className="plans">${PLANS.map(p => html`<div key=${p.k} className=${'plan' + (p.rec ? ' rec' : '')}>
    ${p.rec && html`<span className="plan-tag">Most chosen</span>`}
    <h3>${p.t}</h3><p className="plan-price">Custom pricing <span>after a free consultation</span></p><p className="muted">${p.d}</p>
    <p className="small"><b>Best for:</b> ${p.best}</p>
    <ul className="ticks">${p.pts.map(x => html`<li key=${x}>${x}</li>`)}</ul>
    <button type="button" className=${'btn' + (p.rec ? '' : ' ghost')} style=${{ width: '100%' }} onClick=${() => go(p.k)}>Request ${p.t}</button>
  </div>`)}</div>`;
}
const BENEFITS = [
  ['Screened, interview-ready profiles', 'Every submission comes with an RTR, verified authorization and a rate check.'], ['A recruiter and an account manager', 'Two named people who know your requirement and answer the phone.'], ['Weekly engagement report', 'Submissions, interviews, offers and timesheet status, every week.'],
  ['Compliance handled', 'Agreements, insurance, onboarding paperwork and tax forms, collected and verified.'], ['Timesheets your managers approve online', 'Clock-ins, weekly timesheets and client approval in one portal.'], ['Vendor and client network', 'Direct clients and prime vendors across the US, onsite, hybrid or remote.'],
  ['Replacement on contract roles', 'If a consultant doesn\u2019t work out, we re-screen against your feedback and replace.'], ['Delivery when you need it', 'Web, mobile, cloud, ERP/CRM and healthcare IT from the same team.'], ['Support after the start date', 'A check-in in week one and a person to call for the length of the engagement.'],
];
const BenefitsGrid = () => html`<div className="benefits">${BENEFITS.map(([t, d]) => html`<div key=${t} className="benefit"><b>${t}</b><span>${d}</span></div>`)}</div>`;
const WALK = [
  ['Request', 'Send a requirement from the Request talent page, the team planner, or a call.', 'A recruiter calls or emails the same business day with questions.'],
  ['Shortlist', 'Screened profiles land in your client portal within days.', 'Rate, availability and authorization are checked before you see them.'],
  ['Interview', 'Shortlist, request interviews and leave feedback in the portal.', 'We prepare the consultant and schedule around your calendar.'],
  ['Onboard', 'Agreements, insurance and tax forms are collected and e-signed.', 'Your manager gets a client portal login for approvals.'],
  ['Deliver', 'Consultants clock in and submit weekly timesheets you approve online.', 'You get a weekly report; StratEdge invoices approved hours.'],
];
function Walkthrough() {
  const [i, setI] = useState(0); const [paused, setPaused] = useState(false);
  useEffect(() => { if (paused || REDUCED()) return; const t = setInterval(() => setI(x => (x + 1) % WALK.length), 4500); return () => clearInterval(t); }, [paused]);
  return html`<div className="walk" onMouseEnter=${() => setPaused(true)} onMouseLeave=${() => setPaused(false)}>
    <div className="walk-tabs" role="tablist">${WALK.map((w, k) => html`<button type="button" key=${w[0]} role="tab" aria-selected=${i === k} className=${i === k ? 'on' : ''} onClick=${() => { setI(k); setPaused(true); }}><span className="walk-n">${k + 1}</span>${w[0]}${i === k && !paused && html`<i className="walk-prog" />`}</button>`)}</div>
    <div className="walk-body" key=${i}>
      <div className="walk-stage"><div className="walk-num">0${i + 1}</div><div className="walk-orb" /><div className="walk-line" /></div>
      <div><h3>${WALK[i][0]}</h3><p>${WALK[i][1]}</p><p className="muted">${WALK[i][2]}</p></div>
    </div>
  </div>`;
}
const ASSISTANT_QS = ['What roles do you staff?', 'How does client timesheet approval work?', 'Can you build our customer portal?'];
function AssistantSec() {
  const ask = q => { dispatchEvent(new CustomEvent('edge-open', { detail: { ask: q } })); };
  return html`<section className="sec alt rv"><div className="wrap assist">
    <div><div className="kicker">Assistant</div><h2>Ask the StratEdge assistant</h2><p className="intro">It knows our services, engagement models, portals and timesheets, and answers in seconds. Try one of these, or type your own question in the corner.</p>
      <div className="assist-qs">${ASSISTANT_QS.map(q => html`<button type="button" key=${q} className="chipbtn" onClick=${() => ask(q)}>${q}</button>`)}</div></div>
    <div className="assist-demo"><${Mascot} size=${150} /><div className="assist-chat"><div className="msg b">Hi, I'm the StratEdge assistant. Ask me about services, timesheets or how to request talent.</div><div className="msg u">How fast can you send profiles?</div><div className="msg b">Usually within 2 to 5 business days for common roles. Want me to open the talent request form?</div></div></div>
  </div></section>`;
}
