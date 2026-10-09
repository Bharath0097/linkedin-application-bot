/* ================= v34: Pricing (#/pricing) =================
   For employers: contract and C2C starting rates by role, contract-to-hire, direct hire (a share of the first-year
   salary, with a replacement guarantee) and SOW projects. For students and consultants: the plans and fees from
   Admin > Plans & payments. Rates and terms are edited under Admin > Website & messages > Pricing (org/site/x/pricing);
   until then the defaults below are shown. */
const PRICING_DEFAULT = {
  rates: [
    { r: 'Software developer (Java, .NET, Python)', v: 70 },
    { r: 'Full-stack and front-end developer (React, Angular)', v: 65 },
    { r: 'QA and test automation engineer', v: 55 },
    { r: 'Business analyst', v: 60 },
    { r: 'Project manager or Scrum master', v: 70 },
    { r: 'Salesforce developer or administrator', v: 75 },
    { r: 'DevOps and cloud engineer (AWS, Azure, GCP)', v: 80 },
    { r: 'Data engineer', v: 85 },
    { r: 'Network and cybersecurity engineer', v: 85 },
    { r: 'Healthcare IT (Epic, Cerner, HL7/FHIR)', v: 85 },
    { r: 'SAP consultant', v: 90 },
    { r: 'AI and machine learning engineer', v: 110 },
  ],
  rateNote: 'Starting bill rates per hour for W2, 1099 and C2C contractors. The final rate depends on the skills, seniority, location, length of the engagement and the number of people; you get it in writing before any profile is submitted.',
  dhPct: 15,
  dhDays: 90,
  c2h: 'Start on contract at the hourly rate and move the person to your payroll when you are ready. The conversion terms are agreed in writing before the contract starts, so there are no surprises when you make the offer.',
  sow: 'A team that delivers a defined outcome (an app, a migration, an integration) for a fixed price or by milestones, quoted after a free scoping call.',
  show: { employers: true, students: true, consultants: true, place: true },
  // v34: the job placement programs (Basic, Elite, Premium, Custom): what each includes, as in the StratEdge brochure.
  // Columns are the plans with these ids in Plans & payments; 'yes' and 'no' show as marks, anything else as text.
  place: {
    title: 'Job placement programs',
    intro: 'We help you get hired wherever and whenever: applications sent for you every day, a resume that gets through applicant tracking systems, and training and interview preparation until you are placed. Pay once.',
    stats: [
      { v: '1,569+', t: 'clients helped to land their dream job' },
      { v: '8,000+', t: 'clients assisted with our resources' },
      { v: '6+', t: 'years of job placement consulting' },
      { v: '670+', t: 'students given technical training' },
    ],
    rows: [
      { s: 'Job application assistant' },
      { t: 'Job application assistant', v: { basic: 'yes', elite: 'yes', premium: 'yes' } },
      { t: 'Personalized recruiter support', v: { basic: 'no', elite: 'yes', premium: 'yes' } },
      { t: 'Internal job access (exclusive openings)', v: { basic: 'no', elite: 'yes', premium: 'yes' } },
      { t: 'Job applications a day', v: { basic: '60+', elite: '80+', premium: '150+' } },
      { t: "Resume sent to direct clients' requirements", v: { basic: 'no', elite: 'yes', premium: 'Top priority' } },
      { s: 'Resume enhancement' },
      { t: 'Resume preparation (standard format)', v: { basic: 'yes', elite: 'yes', premium: 'yes' } },
      { t: 'Cover letter preparation', v: { basic: 'no', elite: 'yes', premium: 'yes' } },
      { t: 'Resume consultation', v: { basic: 'PDF-based', elite: 'One-on-one', premium: 'One-on-one' } },
      { t: 'ATS keyword optimization', v: { basic: 'yes', elite: 'yes', premium: 'AI-powered' } },
      { t: 'LinkedIn optimization', v: { basic: 'yes', elite: 'yes', premium: 'yes' } },
      { s: 'Training and support for the job' },
      { t: 'Assessment and test support', v: { basic: 'no', elite: 'yes', premium: 'yes' } },
      { t: 'Interview support', v: { basic: 'no', elite: 'yes', premium: 'yes' } },
      { t: 'Interview preparation (every interview)', v: { basic: 'no', elite: 'yes', premium: 'VIP, personalized' } },
      { t: 'Technical training (industry-specific)', v: { basic: 'no', elite: 'yes', premium: 'yes' } },
      { s: 'Delivery' },
      { t: 'Job guarantee (conditional)', v: { basic: 'no', elite: 'yes', premium: 'yes' } },
      { t: 'Resume tailored for each job description', v: { basic: 'no', elite: 'no', premium: 'yes' } },
      { t: 'Automation tools for the job search', v: { basic: 'no', elite: 'no', premium: 'yes' } },
      { t: 'Certifications (worldwide approved)', v: { basic: 'no', elite: 'no', premium: 'yes' } },
      { t: 'Email and LinkedIn chat support', v: { basic: 'no', elite: 'no', premium: 'yes' } },
      { t: 'Onboarding support', v: { basic: 'yes', elite: 'yes', premium: 'yes' } },
    ],
    note: 'The job guarantee in Elite and Premium is conditional: the conditions are written in your enrollment agreement, and we go through them with you before you pay.',
  },
};
const pricingOf = d => {
  const x = d && typeof d === 'object' ? d : {};
  const pl = x.place && typeof x.place === 'object' ? x.place : {};
  return {
    ...PRICING_DEFAULT,
    ...x,
    rates: Array.isArray(x.rates) && x.rates.length ? x.rates.filter(r => r && r.r) : PRICING_DEFAULT.rates,
    show: { ...PRICING_DEFAULT.show, ...(x.show || {}) },
    place: {
      ...PRICING_DEFAULT.place,
      ...pl,
      stats: Array.isArray(pl.stats) ? pl.stats.filter(t => t && t.v) : PRICING_DEFAULT.place.stats,
      rows: Array.isArray(pl.rows) && pl.rows.length ? pl.rows.filter(r => r && (r.s || r.t)) : PRICING_DEFAULT.place.rows,
    },
  };
};
/** One cell of the comparison: a mark for yes / no, otherwise the text. */
const placeCell = v => {
  const x = String(v == null ? '' : v).trim();
  if (!x || /^(no|-|—|x)$/i.test(x)) return html`<span className="plno" title="Not included"><span className="sr">Not included</span>—</span>`;
  if (/^(yes|y|✓|included)$/i.test(x)) return html`<span className="plyes" title="Included"><${Icon} n="check" /><span className="sr">Included</span></span>`;
  return html`<span className="pltext">${x}</span>`;
};
/**
 * v34: the job placement programs: track record, the plans as cards (with the Custom plan), and what each includes.
 * plans: published plans of the placement line from Plans & payments; place: the website content (pricing doc).
 */
function PlacementPrograms({ plans, place, features, cta, current, compact }) {
  const fixed = plans.filter(x => !x.quote);
  const custom = plans.filter(x => x.quote);
  const cols = fixed.filter(c => place.rows.some(r => r.v && r.v[c.id] !== undefined));
  return html`<div className="stack placeprog" style=${{ gap: 18 }}>
      ${
        !compact &&
        html`<div className="stack" style=${{ gap: 8 }}>
          <h2 style=${{ margin: 0, fontSize: 28 }}>${place.title}</h2>
          <p className="muted" style=${{ margin: 0, maxWidth: '76ch' }}>${place.intro}</p>
        </div>`
      }
      ${!compact && place.stats.length > 0 && html`<div className="plstats">${place.stats.map((t, i) => html`<div key=${i}><b>${t.v}</b><span>${t.t}</span></div>`)}</div>`}
      <div className="plangrid plgrid">
        ${[...fixed, ...custom].map(
          p => html`<section key=${p.id} className=${'plancard' + (p.quote ? ' plcustom' : '') + (current === p.id ? ' on' : '')}>
            <div className="phead"><b>${p.t}</b>${current === p.id && html`<span className="chip ok">Your plan</span>`}</div>
            <div className="pprice">${p.quote ? 'Priced for you' : billPriceHead(p)}</div>
            <div className="muted small">${p.label}${p.months ? ` · ${p.months} months` : ''}</div>
            ${p.d && html`<p className="pdesc">${p.d}</p>`}
            <ul className="pfeat">${(p.perks || []).map(x => html`<li key=${x}><${Icon} n="check" /><span>${x}</span></li>`)}</ul>
            <div className="actions">${cta(p)}</div>
          </section>`
        )}
      </div>
      ${
        cols.length > 0 &&
        html`<details className="plcompare" open=${!compact}>
          <summary><b>Compare what each plan includes</b></summary>
          <div className="tblwrap"><table className="tbl pltable">
            <thead><tr><th>What you get</th>${cols.map(c => html`<th key=${c.id} className="c">${c.t}<div className="muted small">${billAmt0(c.price, c.cur)}</div></th>`)}</tr></thead>
            <tbody>
              ${place.rows.map((r, i) =>
                r.s
                  ? html`<tr key=${i} className="plsec"><th colSpan=${cols.length + 1}>${r.s}</th></tr>`
                  : html`<tr key=${i}><td>${r.t}</td>${cols.map(c => html`<td key=${c.id} className="c">${placeCell(r.v && r.v[c.id])}</td>`)}</tr>`
              )}
            </tbody>
          </table></div>
        </details>`
      }
      ${place.note && html`<p className="muted small" style=${{ margin: 0 }}>${place.note}</p>`}
    </div>`;
}
const usd0 = n => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

function PricingPage({ q }) {
  const caps = useCaps();
  const doc = useDoc(caps && caps.db ? 'org/site/x/pricing' : null);
  const [plans, setPlans] = useState(null);
  const [aud, setAud] = useState(q && (q.for === 'students' || q.for === 'jobseekers') ? 'students' : 'employers');
  const [salary, setSalary] = useState(100000);
  useEffect(() => {
    api('bill_plans', {}).then(setPlans, () => setPlans({ plans: [], features: {}, fees: {} }));
  }, []);
  const p = pricingOf(doc.data);
  const minRate = Math.min(...p.rates.map(r => +r.v || 0).filter(Boolean));
  const stu = plans ? plans.plans.filter(x => x.aud === 'student' && x.line !== 'placement') : [];
  const out = plans ? plans.plans.filter(x => x.aud === 'outside' && x.line !== 'placement') : [];
  const prog = plans ? plans.plans.filter(x => x.line === 'placement') : [];
  const fees = plans ? Object.entries(plans.fees && typeof plans.fees === 'object' ? plans.fees : {}) : [];
  const fee = Math.round(((+salary || 0) * (+p.dhPct || 0)) / 100);
  const MODELS = [
    {
      k: 'contract',
      t: 'Contract and C2C',
      price: 'from ' + usd0(minRate),
      unit: 'per hour',
      d: 'Skilled people on your project for weeks or months, billed weekly for the hours your manager approves.',
      helps: ['Start in days, not months: screened profiles in 2 to 5 business days', 'Scale up or down as the project changes', 'W2, 1099 or C2C, with every agreement and compliance check handled'],
      cta: html`<a className="btn" href="#/request-talent">Request talent</a>`,
    },
    {
      k: 'c2h',
      t: 'Contract-to-hire',
      price: 'Hourly',
      unit: 'then convert',
      d: p.c2h,
      helps: ['See the person do the real work before you commit', 'Lower risk for both sides', 'One partner from the first day to the offer'],
      cta: html`<a className="btn ghost" href="#/request-talent">Request talent</a>`,
    },
    {
      k: 'direct',
      t: 'Full-time hiring',
      price: p.dhPct + '%',
      unit: 'of the first-year salary, once',
      d: 'Permanent employees on your payroll. One fee, invoiced when the person starts, with a ' + p.dhDays + '-day replacement guarantee.',
      helps: ['You pay only when someone starts: nothing up front', p.dhDays + '-day guarantee: if they leave, we replace them free', 'Salary guidance and help through the offer and the start date'],
      cta: html`<a className="btn" href="#/services/full-time-hiring">How full-time hiring works</a>`,
      hot: true,
    },
    {
      k: 'sow',
      t: 'Project (SOW)',
      price: 'Quoted',
      unit: 'fixed price or milestones',
      d: p.sow,
      helps: ['One accountable team and one price', 'Milestones you approve before you pay', 'Web, mobile, cloud, data, ERP and healthcare IT'],
      cta: html`<a className="btn ghost" href="#/contact">Book a scoping call</a>`,
    },
  ];
  const STEPS = [
    ['Learn', 'Courses on the skills clients ask for, USCIS compliance for your status, and how to work through StratEdge.'],
    ['Practise', 'Daily and weekly tests show where you stand; live client-style projects give you real things to talk about in interviews.'],
    ['Prove', 'StratEdge certifications that employers can verify online, and a resume tailored to each role.'],
    ['Get placed', 'Apply through the portal; on Placement-ready a mentor runs mock interviews and the recruiting team markets you to clients.'],
  ];
  return html`<${Fragment}>
      <${PageHead} title="Pricing" intro="Clear prices for companies hiring with StratEdge and for the students and consultants who grow with us. You see every rate and fee before you agree to anything." />
      <section className="sec">
        <div className="wrap stack" style=${{ gap: 32 }}>
          <div className="seg prseg" role="tablist" aria-label="Pricing for">
            ${p.show.employers && html`<button type="button" role="tab" aria-selected=${aud === 'employers'} className=${aud === 'employers' ? 'on' : ''} onClick=${() => setAud('employers')}>Hiring with StratEdge</button>`}
            ${(p.show.students || p.show.consultants || p.show.place !== false) && html`<button type="button" role="tab" aria-selected=${aud === 'students'} className=${aud === 'students' ? 'on' : ''} onClick=${() => setAud('students')}>Getting hired</button>`}
          </div>
          ${
            aud === 'employers' && p.show.employers
              ? html`<${Fragment}>
                  <div className="prgrid">
                    ${MODELS.map(
                      m => html`<section key=${m.k} className=${'prcard' + (m.hot ? ' hot' : '')}>
                        ${m.hot && html`<span className="prtag">Full-time</span>`}
                        <h3>${m.t}</h3>
                        <div className="prprice"><b>${m.price}</b><span>${m.unit}</span></div>
                        <p className="muted">${m.d}</p>
                        <ul className="pfeat">${m.helps.map(h => html`<li key=${h}><${Icon} n="check" /><span>${h}</span></li>`)}</ul>
                        <div className="actions">${m.cta}</div>
                      </section>`
                    )}
                  </div>
                  <div className="g2" style=${{ gap: 28, alignItems: 'start' }}>
                    <section className="panel stack" style=${{ gap: 10 }}>
                      <h2 style=${{ margin: 0, fontSize: 24 }}>Contract rates by role</h2>
                      <div className="tblwrap"><table className="tbl prrates">
                        <thead><tr><th>Role</th><th className="r">Starting at</th></tr></thead>
                        <tbody>${p.rates.map(r => html`<tr key=${r.r}><td>${r.r}</td><td className="r nowrap"><b>${usd0(r.v)}</b> /hr</td></tr>`)}</tbody>
                      </table></div>
                      <p className="muted small" style=${{ margin: 0 }}>${p.rateNote}</p>
                    </section>
                    <section className="panel stack" style=${{ gap: 12 }}>
                      <h2 style=${{ margin: 0, fontSize: 24 }}>Full-time hiring: what it costs</h2>
                      <p className="muted" style=${{ margin: 0 }}>A one-time fee of <b>${p.dhPct}% of the first-year base salary</b>, invoiced on the day the person starts. Nothing is due if you do not hire.</p>
                      <${Field} label="First-year base salary (USD)">
                        <input type="number" min="0" step="1000" value=${salary} onInput=${e => setSalary(e.target.value)} />
                      <//>
                      <div className="prcalc"><span>One-time fee</span><b>${usd0(fee)}</b></div>
                      <div className="note ok" style=${{ margin: 0 }}><span><b>${p.dhDays}-day replacement guarantee.</b> If the person resigns or is let go for performance within ${p.dhDays} days of starting, we find a replacement at no extra fee.</span></div>
                      <a className="btn ghost" href="#/services/full-time-hiring">See how full-time hiring works</a>
                    </section>
                  </div>
                  <section className="panel">
                    <h2 style=${{ margin: '0 0 14px', fontSize: 24 }}>Included with every engagement</h2>
                    <div className="princ">
                      ${[
                        ['Screened profiles', 'Technical screening, references, and a right-to-represent (RTR) for every candidate we submit.'],
                        ['Compliance handled', 'Work authorization and I-9, agreements, onboarding paperwork, and background checks where your contract asks for them.'],
                        ['One portal', 'Timesheets, approvals, invoices and documents in one place, with your own client login.'],
                        ['A named account manager', 'One person who knows your team and answers for every placement.'],
                        ['Security built in', 'Two-step sign-in, documents encrypted at rest, and a security program organised along the SOC 2 criteria.'],
                        ['No hidden fees', 'The rate or fee you agree to is the one on the invoice.'],
                      ].map(([t, d]) => html`<div key=${t}><b>${t}</b><p className="muted small">${d}</p></div>`)}
                    </div>
                  </section>
                <//>`
              : html`<${Fragment}>
                  ${
                    p.show.place !== false && prog.length > 0 &&
                    html`<${PlacementPrograms} plans=${prog} place=${p.place} features=${plans.features} cta=${x =>
                      x.quote
                        ? html`<a className="btn ghost" href="#/contact">Talk to us</a>`
                        : html`<a className="btn" href="#/login?as=student&mode=register">Get started</a><a className="small" href="#/login?as=consultant&mode=register&out=1">or join as a consultant</a>`} />`
                  }
                  ${
                    p.show.students &&
                    html`<div className="stack" style=${{ gap: 14 }}>
                      <h2 style=${{ margin: 0, fontSize: 28 }}>Student plans</h2>
                      <p className="muted" style=${{ margin: 0, maxWidth: '70ch' }}>For students and career changers who want to be ready for client work: learn, practise, get certified and get placed. Pay once; your portal opens right away.</p>
                      ${plans ? html`<${BillPlanCards} plans=${stu} features=${plans.features} cta=${() => html`<a className="btn" href="#/login?as=student&mode=register">Create a student account</a>`} />` : html`<${Spinner} />`}
                      <div className="prsteps">${STEPS.map(([t, d], i) => html`<div key=${t}><span className="n">${i + 1}</span><b>${t}</b><p className="muted small">${d}</p></div>`)}</div>
                    </div>`
                  }
                  ${
                    p.show.consultants && out.length > 0 &&
                    html`<div className="stack" style=${{ gap: 12 }}>
                      <h2 style=${{ margin: 0, fontSize: 28 }}>Consultant membership</h2>
                      <p className="muted" style=${{ margin: 0 }}>For consultants who are not placed by StratEdge: apply to C2C, W2, contract-to-hire and full-time roles from your portal.</p>
                      <${BillPlanCards} plans=${out} features=${plans.features} cta=${() => html`<a className="btn" href="#/login?as=consultant&mode=register&out=1">Join as an outside consultant</a>`} />
                    </div>`
                  }
                  ${
                    p.show.consultants && fees.length > 0 &&
                    html`<section className="panel">
                      <h3 className="ph">Placement fees</h3>
                      <p className="muted small" style=${{ marginTop: 0 }}>Charged only when StratEdge places you; shown again, and agreed to, before you apply to a role.</p>
                      <dl className="kv">${fees.map(([k, v]) => html`<${Fragment} key=${k}><dt>${k}</dt><dd>${v}</dd><//>`)}</dl>
                    </section>`
                  }
                  <section className="panel">
                    <h3 className="ph">Paying</h3>
                    <p className="muted small" style=${{ margin: 0 }}>${plans && plans.stripe ? 'Pay by card through Stripe. ' : ''}Bank transfer, Zelle and checks are welcome too: report the payment in your portal and StratEdge confirms it. Consultants placed by StratEdge get the courses and tests in their portal at no cost.</p>
                  </section>
                <//>`
          }
          <div style=${{ marginTop: 8 }}>
            <h2 style=${{ fontSize: 28, marginBottom: 16 }}>Pricing questions</h2>
            <div className="faqs">
              ${[
                ['When do we pay for a full-time hire?', 'Only when the person starts. The fee is ' + p.dhPct + '% of the first-year base salary (bonuses and benefits not included), invoiced on the start date.'],
                ['What does the ' + p.dhDays + '-day guarantee cover?', 'If the person resigns or is let go for performance within ' + p.dhDays + ' days of starting, we search again and present a replacement at no extra fee.'],
                ['How are contract hours billed?', 'Weekly, for the hours your manager approves in the client portal. Overtime, travel and expenses are billed only when agreed in writing.'],
                ['Are the hourly rates fixed?', 'They are starting points. You get the exact rate for each profile, in writing, before anyone is submitted to you.'],
                ['Can a contractor become a full-time employee?', 'Yes. Contract-to-hire is designed for it, and the conversion terms are agreed before the contract starts.'],
                ['Is a student plan a job guarantee?', 'No. Student plans give you training, certifications, practice and placement support; hiring decisions are made by clients.'],
                ['What is the job guarantee in Elite and Premium?', 'It is conditional. The conditions are written in your enrollment agreement, and we go through them with you before you pay.'],
                ['How does a custom plan work?', 'Tell us what you need, for one role, one interview or a whole search. We agree the services and the price in writing, then set the plan up in your portal for you to pay.'],
              ].map(([qq, a]) => html`<details key=${qq} className="faq"><summary>${qq}</summary><p>${a}</p></details>`)}
            </div>
          </div>
          <div className="actions">
            <a className="btn lg" href="#/request-talent">Request talent</a>
            <a className="btn ghost lg" href="#/contact">Talk to us</a>
            <a className="btn ghost lg" href="#/login?as=student&mode=register">Start as a student</a>
          </div>
        </div>
      </section>
    <//>`;
}
