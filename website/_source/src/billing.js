/* ================= Plans & payments for students and outside consultants (v32) =================
   Students (student portal > Plans & payments) and outside consultants (consultant portal > Membership & fees) choose
   a plan and pay online through Stripe Checkout (installments and monthly plans run as a subscription that stops
   after the last payment), or report a payment made another way, which StratEdge confirms. The placement fees per
   engagement type are listed here and agreed to when applying. The website shows the published plans at #/plans. */
const billAmt = (cents, cur) => fmtMoney((+cents || 0) / 100, String(cur || 'usd').toUpperCase());
// v34: plan prices without ".00" when they are whole ($1,500 rather than $1,500.00)
const billAmt0 = (cents, cur) => {
  const s = billAmt(cents, cur);
  return (+cents || 0) % 100 === 0 ? s.replace(/[.,]00(?=\D*$)/, '') : s;
};
const BILL_ST = {
  active: ['Active', 'ok'],
  pending: ['Waiting for the first payment', 'amber'],
  past_due: ['Payment overdue', 'red'],
  cancelled: ['Cancelled', ''],
  ended: ['Ended', ''],
  none: ['No plan yet', ''],
};
const BILL_ITEM_ST = { paid: ['Paid', 'ok'], due: ['Due', 'amber'], reported: ['Reported, being checked', 'info'], waived: ['Waived', ''], void: ['Cancelled', ''] };
const BILL_HOW = ['Zelle', 'Bank transfer (ACH or wire)', 'Check', 'Cash', 'Other'];
// lower-case names for "Unlock … with a plan"
const BILL_FEAT_NAMES = {
  learn: 'courses',
  cert: 'StratEdge certifications',
  tests: 'the daily and weekly tests',
  projects: 'live projects',
  tailor: 'resume tailoring',
  apply: 'job applications through the portal',
  mentor: 'mentoring, mock interviews and practice calls',
  market: 'marketing to clients',
};
const billHref = P => '#' + ((P && P.base) || '/portal') + '/' + (Cap.ct === 'outside' ? 'membership' : 'plan');
const billPageName = () => (Cap.ct === 'outside' ? 'Membership & fees' : 'Plans & payments');
const billPriceHead = p =>
  p.kind === 'install'
    ? html`${billAmt0(p.each, p.cur)}<small> × ${p.n}</small>`
    : p.kind === 'monthly'
      ? html`${billAmt0(p.price, p.cur)}<small> a month</small>`
      : billAmt0(p.price, p.cur);
const billWhyLocked = () => {
  const b = Cap.billing || {};
  return b.active ? 'Your plan does not include this.' : b.st === 'past_due' ? 'A payment is overdue, so your plan is paused until it is paid.' : b.st === 'pending' ? 'Pay the first payment of your plan to start.' : 'Choose a plan to start.';
};

/* A banner on a page whose feature this person's plan does not unlock (yet). */
function PlanNote({ feature }) {
  const P = usePortal();
  if (!planLocked(feature)) return null;
  return html`<div className="note amber">
      <span><b>Unlock ${BILL_FEAT_NAMES[feature] || 'this'} with a plan.</b> ${billWhyLocked()}</span>
      <div className="actions"><a className="btn sm" href=${billHref(P)}><${Icon} n="money" />${billPageName()}</a></div>
    </div>`;
}
/* The whole page is part of a plan the person does not have: one panel instead of the page. */
function PlanGate({ feature }) {
  const P = usePortal();
  const name = BILL_FEAT_NAMES[feature] || 'this';
  return html`<section className="panel">
      <${Empty} title=${'Unlock ' + name + ' with a plan'}>${billWhyLocked()}<//>
      <div className="actions" style=${{ justifyContent: 'center', marginTop: 12 }}><a className="btn" href=${billHref(P)}><${Icon} n="money" />See the plans</a></div>
    </section>`;
}

function BillPlanCards({ plans, features, cta, current }) {
  if (!plans.length) return html`<section className="panel"><${Empty} title="No plans published yet">StratEdge publishes its plans here. Questions? Write to ${CO.email}.<//></section>`;
  return html`<div className="plangrid">
      ${plans.map(
        p => html`<section key=${p.id} className=${'plancard' + (current === p.id ? ' on' : '')}>
          <div className="phead"><b>${p.t}</b>${current === p.id && html`<span className="chip ok">Your plan</span>`}</div>
          <div className="pprice">${billPriceHead(p)}</div>
          <div className="muted small">${p.label}${p.months ? ` · ${p.months} months of access` : ''}</div>
          ${p.d && html`<p className="pdesc">${p.d}</p>`}
          <ul className="pfeat">
            ${p.feat.map(f => html`<li key=${f}><${Icon} n="check" /><span>${(features || {})[f] || f}</span></li>`)}
            ${(p.perks || []).map(x => html`<li key=${'x' + x}><${Icon} n="star" /><span>${x}</span></li>`)}
          </ul>
          <div className="actions">${cta(p)}</div>
        </section>`
      )}
    </div>`;
}

function ManualPayModal({ item, cur, manual, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ how: BILL_HOW[0], ref: '', note: '' });
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const r = await api('bill_manual', { item: item.id, how: f.how, ref: f.ref.trim(), note: f.note.trim() });
      toast('Thanks. StratEdge checks the payment and marks it received.');
      onDone(r);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} title="I paid another way" onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy} onClick=${send}>${busy ? 'Sending…' : 'Tell StratEdge'}</button>`}>
      <div className="form">
        <p className="muted small" style=${{ margin: 0 }}><b>${item.t}</b>: ${billAmt(item.amt, cur)}, due ${fmtDate(item.due, { month: 'short', day: 'numeric', year: 'numeric' })}.</p>
        ${manual && html`<div className="note info"><span style=${{ whiteSpace: 'pre-wrap' }}>${manual}</span></div>`}
        <div className="row2">
          <${Field} label="How you paid"><select value=${f.how} onChange=${e => setF({ ...f, how: e.target.value })}>${BILL_HOW.map(h => html`<option key=${h}>${h}</option>`)}</select><//>
          <${Field} label="Reference" hint="Confirmation number, check number or the last digits of the account."><input value=${f.ref} onInput=${e => setF({ ...f, ref: e.target.value })} /><//>
        </div>
        <${Field} label="Note (optional)"><textarea rows="2" value=${f.note} onInput=${e => setF({ ...f, note: e.target.value })} /><//>
      </div>
    <//>`;
}

/* ---- Plans & payments (students) / Membership & fees (outside consultants) ---- */
function BillingPage({ q }) {
  const P = usePortal();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState('');
  const [rep, setRep] = useState(null);
  const [ask, setAsk] = useState(false);
  const [more, setMore] = useState(false);
  const pdoc = useDoc('org/site/x/pricing'); // v34: what each job placement program includes
  const outside = Cap.ct === 'outside';
  const ret = (P.base || '/portal') + (outside ? '/membership' : '/plan');
  const took = async r => {
    setD(r);
    await reloadCaps();
  };
  const load = async () => {
    setErr(null);
    // back from Stripe: the session is looked up on the server and the payment recorded
    if (q && q.paid) {
      try {
        const r = await api('bill_confirm', { session: q.paid });
        toast(r.paid ? 'Payment received. Thank you!' : 'Stripe has not confirmed this payment yet; it shows here as soon as it does.');
      } catch (e) {
        toast(errText(e), true);
      }
    } else if (q && q.cancelled) toast('Payment cancelled. Nothing was charged.');
    if (q && (q.paid || q.cancelled)) {
      try {
        history.replaceState(null, '', '#' + ret);
      } catch (e) {
        /* fine */
      }
    }
    try {
      await took(await api('bill_me', { sync: 1 }));
    } catch (e) {
      setErr(e);
    }
  };
  useEffect(() => {
    load();
  }, []);
  if (err) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} />`;
  const st = BILL_ST[d.st] || BILL_ST.none;
  const has = !!d.plan && !['cancelled', 'ended', 'none'].includes(d.st);
  const items = d.items || [];
  const feeTerms = Object.entries(d.fees && typeof d.fees === 'object' ? d.fees : {});
  const feat = (d.access && d.access.feat) || [];
  const paid = items.filter(x => x.st === 'paid').reduce((s, x) => s + (x.amt || 0), 0);
  const left = items.filter(x => x.st === 'due' || x.st === 'reported').reduce((s, x) => s + (x.amt || 0), 0);
  const next = d.next;
  const choose = async p => {
    setBusy('choose:' + p.id);
    try {
      await took(await api('bill_choose', { plan: p.id }));
      setMore(false);
      toast('Plan chosen. The first payment starts it.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const pay = async it => {
    setBusy('pay:' + it.id);
    try {
      const r = await api('bill_checkout', { item: it.id, ret });
      if (r.url) {
        location.href = r.url;
        return;
      }
      toast('Stripe did not return a payment page. Try again in a moment.', true);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const cancel = async () => {
    setBusy('cancel');
    try {
      await took(await api('bill_cancel', {}));
      setAsk(false);
      toast('Your plan is cancelled. Nothing more will be charged.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const showPlans = !has || d.st === 'pending' || more;
  return html`<div className="stack billing">
      <section className="panel billhead">
        <div className="ph-row">
          <div style=${{ minWidth: 0 }}>
            <h2 className="ph" style=${{ margin: 0 }}>${has ? d.plan.t : outside ? 'Membership' : 'Choose your plan'}</h2>
            <p className="muted small" style=${{ margin: '4px 0 0' }}>${has ? d.plan.label || '' : outside ? 'Apply to C2C, W2, contract-to-hire and full-time roles through StratEdge with a membership.' : 'Courses, StratEdge certifications, daily tests, live projects and job help, with a plan that fits.'}</p>
          </div>
          <${Chip} s=${st[1]}>${st[0]}<//>
        </div>
        ${
          has &&
          html`<div className="billfeat">${feat.length ? feat.map(f => html`<span key=${f} className="chip ok"><${Icon} n="check" />${(d.features || {})[f] || f}</span>`) : html`<span className="muted small">Your plan unlocks its features with the first payment.</span>`}</div>`
        }
        ${has && d.until > 0 && html`<p className="muted small" style=${{ margin: '8px 0 0' }}>Access until ${fmtDay(d.until)}.</p>`}
      </section>
      ${d.st === 'past_due' && html`<div className="note red"><span><b>A payment is overdue.</b> Your plan's features are paused until it is paid. Pay it below, or tell us if you paid another way.</span></div>`}
      ${d.st === 'pending' && html`<div className="note amber"><span><b>One step left:</b> pay the first payment to unlock your plan.</span></div>`}
      ${
        has &&
        html`<${KitStats} items=${[
          { v: billAmt(paid, d.cur), l: 'Paid so far', tone: paid ? 'ok' : '' },
          { v: billAmt(left, d.cur), l: 'Still to pay' },
          { v: next ? fmtDate(next.due, { month: 'short', day: 'numeric' }) : '—', l: next ? 'Next payment · ' + billAmt(next.amt, d.cur) : 'Nothing due', tone: d.st === 'past_due' ? 'warn' : '' },
          { v: d.auto ? 'Automatic' : d.stripe ? 'Online or manual' : 'Manual', l: 'How you pay' },
        ]} />`
      }
      ${
        items.length > 0 &&
        html`<section className="panel" style=${{ padding: '6px 8px' }}>
          <div className="tblwrap"><table className="tbl">
            <thead><tr><th>Payment</th><th>Due</th><th className="r">Amount</th><th>Status</th><th className="r"><span className="sr">Pay</span></th></tr></thead>
            <tbody>
              ${items.map(it => {
                const s = BILL_ITEM_ST[it.st] || [it.st, ''];
                return html`<tr key=${it.id}>
                  <td><b>${it.t}</b>${it.k === 'fee' && html` <span className="chip new">Placement fee</span>`}${it.how && html`<div className="muted small">${it.how === 'stripe' ? 'Card, through Stripe' : 'Recorded by StratEdge'}${it.paidAt ? ' · ' + fmtDay(it.paidAt) : ''}</div>`}${it.rep && html`<div className="muted small">You reported: ${it.rep.how}${it.rep.ref ? ' · ' + it.rep.ref : ''}</div>`}</td>
                  <td>${fmtDate(it.due, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  <td className="r">${billAmt(it.amt, d.cur)}</td>
                  <td><${Chip} s=${s[1]}>${s[0]}<//></td>
                  <td className="r">${
                    it.st === 'due' &&
                    html`<div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                      ${d.stripe && !(d.auto && it.k === 'plan' && it.id !== 'p1') && html`<button type="button" className="btn sm" disabled=${!!busy} onClick=${() => pay(it)}>${busy === 'pay:' + it.id ? 'Opening Stripe…' : 'Pay now'}</button>`}
                      <button type="button" className="btn ghost sm" onClick=${() => setRep(it)}>I paid another way</button>
                    </div>`
                  }</td>
                </tr>`;
              })}
            </tbody>
          </table></div>
          ${d.auto && html`<p className="muted small" style=${{ margin: '8px 10px' }}>The remaining installments are charged to your card automatically on their due dates; the subscription stops after the last one.</p>`}
        </section>`
      }
      ${
        d.manual &&
        html`<section className="panel">
          <h3 className="ph">${d.stripe ? 'Other ways to pay' : 'How to pay'}</h3>
          <p className="small" style=${{ whiteSpace: 'pre-wrap', margin: 0 }}>${d.manual}</p>
          <p className="muted small" style=${{ margin: '8px 0 0' }}>After paying, use "I paid another way" on the payment so StratEdge can match it.</p>
        </section>`
      }
      ${
        showPlans &&
        (d.plans || []).some(p => p.line !== 'placement') &&
        html`<div className="stack" style=${{ gap: 10 }}>
          <h3 className="ph" style=${{ margin: '6px 2px 0' }}>${has ? (d.st === 'pending' ? 'Or pick another plan' : 'Other plans') : outside ? 'Membership plans' : 'Student plans'}</h3>
          <${BillPlanCards}
            plans=${(d.plans || []).filter(p => p.line !== 'placement')}
            features=${d.features}
            current=${has ? d.plan.id : ''}
            cta=${p =>
              has && d.st !== 'pending'
                ? p.id === d.plan.id
                  ? html`<span className="muted small">Your current plan</span>`
                  : html`<span className="muted small">Ask StratEdge to switch you to this plan.</span>`
                : p.id === (d.plan && d.plan.id) && d.st === 'pending'
                  ? html`<span className="muted small">Chosen: pay the first payment above</span>`
                  : html`<button type="button" className="btn" disabled=${!!busy} onClick=${() => choose(p)}>${busy === 'choose:' + p.id ? 'Choosing…' : has ? 'Switch to this plan' : 'Choose this plan'}</button>`}
          />
        </div>`
      }
      ${
        showPlans &&
        (d.plans || []).some(p => p.line === 'placement') &&
        html`<div className="stack" style=${{ gap: 10 }}>
          <h3 className="ph" style=${{ margin: '6px 2px 0' }}>${pricingOf(pdoc.data).place.title}</h3>
          <p className="muted small" style=${{ margin: '0 2px' }}>Applications sent for you every day, resume and LinkedIn work, training and interview preparation until you are placed.</p>
          <${PlacementPrograms}
            compact
            plans=${(d.plans || []).filter(p => p.line === 'placement')}
            place=${pricingOf(pdoc.data).place}
            features=${d.features}
            current=${has ? d.plan.id : ''}
            cta=${p =>
              p.quote
                ? html`<a className="btn ghost" href=${'mailto:' + CO.email + '?subject=' + encodeURIComponent('Custom plan')}>Talk to us</a>`
                : has && d.st !== 'pending'
                  ? p.id === d.plan.id
                    ? html`<span className="muted small">Your current plan</span>`
                    : html`<span className="muted small">Ask StratEdge to switch you to this plan.</span>`
                  : p.id === (d.plan && d.plan.id) && d.st === 'pending'
                    ? html`<span className="muted small">Chosen: pay the first payment above</span>`
                    : html`<button type="button" className="btn" disabled=${!!busy} onClick=${() => choose(p)}>${busy === 'choose:' + p.id ? 'Choosing…' : has ? 'Switch to this plan' : 'Choose this plan'}</button>`}
          />
        </div>`
      }
      ${has && !more && d.st !== 'pending' && (d.plans || []).length > 1 && html`<div><button type="button" className="btn link sm" onClick=${() => setMore(true)}>See the other plans</button></div>`}
      ${
        feeTerms.length > 0 &&
        html`<section className="panel">
          <h3 className="ph">Placement fees</h3>
          <p className="muted small" style=${{ marginTop: 0 }}>Only when StratEdge places you in a role. You see the fee for a role's engagement type and agree to it before you apply.</p>
          <dl className="kv">${feeTerms.map(([k, v]) => html`<${Fragment} key=${k}><dt>${k}</dt><dd>${v}</dd><//>`)}</dl>
        </section>`
      }
      ${
        (d.agreed || []).length > 0 &&
        html`<section className="panel" style=${{ padding: '6px 8px' }}>
          <h3 className="ph" style=${{ margin: '8px 10px' }}>Fees you agreed to when applying</h3>
          <div className="tblwrap"><table className="tbl">
            <thead><tr><th>Role</th><th>Type</th><th>Fee</th><th>Date</th></tr></thead>
            <tbody>${d.agreed.map((a, i) => html`<tr key=${i}><td><b>${a.job}</b>${a.co && html`<div className="muted small">${a.co}</div>`}</td><td>${a.eng}</td><td className="small">${a.fee}</td><td>${fmtDay(a.at)}</td></tr>`)}</tbody>
          </table></div>
        </section>`
      }
      ${has && html`<div className="actions"><button type="button" className="btn ghost sm" onClick=${() => setAsk(true)}>Cancel my plan</button></div>`}
      ${rep && html`<${ManualPayModal} item=${rep} cur=${d.cur} manual=${d.manual} onClose=${() => setRep(null)} onDone=${r => { setRep(null); took(r); }} />`}
      ${
        ask &&
        html`<${Modal} title="Cancel your plan?" onClose=${() => setAsk(false)} foot=${html`<button className="btn ghost" onClick=${() => setAsk(false)}>Keep my plan</button><button className="btn" disabled=${busy === 'cancel'} onClick=${cancel}>${busy === 'cancel' ? 'Cancelling…' : 'Cancel the plan'}</button>`}>
          <p>Payments still due are cancelled${d.auto ? ' and the card subscription stops' : ''}. The plan's features close; payments already made are not refunded automatically (write to ${CO.email} about a refund).</p>
        <//>`
      }
    </div>`;
}

/* ---- the outside consultant's dashboard card ---- */
function PlanCard() {
  const P = usePortal();
  const b = Cap.billing;
  if (!b) return null;
  const st = BILL_ST[b.st] || BILL_ST.none;
  return html`<section className=${'panel plansum' + (b.st === 'past_due' ? ' bad' : '')}>
      <div className="ph-row">
        <div style=${{ minWidth: 0 }}>
          <h2 className="ph" style=${{ margin: 0 }}>${b.pt || (Cap.ct === 'student' ? 'Your plan' : 'Membership')}</h2>
          <p className="muted small" style=${{ margin: '4px 0 0' }}>${b.active ? `Unlocked: ${(b.feat || []).map(f => BILL_FEAT_NAMES[f] || f).join(', ') || 'nothing yet'}.` : b.st === 'pending' ? 'Pay the first payment to unlock your plan.' : b.st === 'past_due' ? 'A payment is overdue; your plan is paused.' : b.plans ? 'Choose a plan to apply to jobs, take courses and more.' : 'StratEdge has not published plans yet.'}</p>
        </div>
        <${Chip} s=${st[1]}>${st[0]}<//>
      </div>
      <div className="actions" style=${{ marginTop: 10 }}><a className="btn sm" href=${billHref(P)}><${Icon} n="money" />${b.active ? billPageName() : b.st === 'none' || b.st === 'cancelled' || b.st === 'ended' ? 'See the plans' : 'Pay now'}</a></div>
    </section>`;
}

/* ---- the student portal's home ---- */
function StudentHome() {
  const P = usePortal();
  const [d, setD] = useState(null);
  useEffect(() => {
    let live = true;
    Promise.all([api('learn_catalog').catch(() => null), api('ex_home').catch(() => null), api('tl_status').catch(() => null)]).then(([l, e, t]) => live && setD({ l, e, t }));
    return () => {
      live = false;
    };
  }, []);
  const mine = useCol(`proj/${P.uid}/items`, 'u:desc', 3);
  const b = Cap.billing || { st: 'none', feat: [] };
  const l = d && d.l;
  const e = d && d.e;
  const inProg = l ? l.courses.filter(c => c.started && !c.completedAt) : [];
  const courseCerts = l ? l.certs.filter(c => c.kind !== 'prog').length : 0;
  const progCerts = e ? (e.certs || []).filter(c => c.kind === 'prog') : [];
  const active = mine.docs.find(p => p.st === 'active' || p.st === 'planned');
  const pr = active ? projProgress(active) : null;
  const steps = [
    ['Choose a plan and make the first payment', b.active, billHref(P)],
    ['Upload your resume and set what you are looking for', !!(d && d.t && (d.t.resumes || []).length), '#' + (P.base || '/portal') + '/resume'],
    ['Start a course', !!(l && l.courses.some(c => c.started)), growHref(P, 'learn')],
    ["Take today's test", !!(e && e.daily && e.daily.done), growHref(P, 'tests')],
    ['Earn a StratEdge certification', progCerts.length > 0, growHref(P, 'certify')],
  ];
  const doneN = steps.filter(s => s[1]).length;
  return html`<div className="stack student">
      <div className="hello">
        <div>
          <h2>${greeting()}${P.prof ? ', ' + firstName(P.prof.n) : ''}</h2>
          <p className="muted">${new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })} · Student portal</p>
        </div>
      </div>
      <${PlanCard} />
      <section className="panel">
        <div className="ph-row"><h2 className="ph" style=${{ margin: 0 }}>Getting started</h2><span className="muted small">${doneN} of ${steps.length} done</span></div>
        <div className="prog" style=${{ margin: '10px 0 12px' }}><i style=${{ width: Math.round((doneN * 100) / steps.length) + '%' }} /></div>
        <ol className="ssteps">${steps.map(([t, ok, href], i) => html`<li key=${i} className=${ok ? 'ok' : ''}><span className="snum">${ok ? html`<${Icon} n="check" />` : i + 1}</span><a href=${href}>${t}</a></li>`)}</ol>
      </section>
      <div className="growrow">
        <a className="growtile" href=${growHref(P, 'learn')}>
          <span className="hubicon"><${Icon} n="compass" /></span>
          <span><b>${inProg.length ? `${inProg.length} course${inProg.length === 1 ? '' : 's'} in progress` : 'Courses and puzzles'}</b><em>${inProg.length ? inProg[0].t + ' · ' + (inProg[0].pct || 0) + '%' : courseCerts ? `${courseCerts} course certificate${courseCerts === 1 ? '' : 's'}` : 'Lessons, quizzes and certificates.'}</em></span>
        </a>
        <a className="growtile" href=${growHref(P, 'certify')}>
          <span className="hubicon"><${Icon} n="flag" /></span>
          <span><b>${progCerts.length ? `${progCerts.length} StratEdge certification${progCerts.length === 1 ? '' : 's'}` : 'StratEdge certifications'}</b><em>${e && e.progs ? `${e.progs.length} available · timed exams, verifiable certificates` : 'Timed exams and verifiable certificates.'}</em></span>
        </a>
        <a className="growtile" href=${growHref(P, 'tests')}>
          <span className="hubicon"><${Icon} n="target" /></span>
          <span><b>${e && e.daily && e.daily.done ? `Today's test: ${e.daily.pct}%` : "Today's test"}</b><em>${e ? (e.streak ? `${e.streak}-day streak · ` : '') + 'a few minutes a day' : 'A few minutes a day keeps you sharp.'}</em></span>
        </a>
        <a className="growtile" href=${growHref(P, active ? 'projects?p=' + encodeURIComponent(active.id) : 'projects')}>
          <span className="hubicon"><${Icon} n="flask" /></span>
          <span><b>${active ? active.t : 'Start a live project'}</b><em>${pr ? `${pr.d} of ${pr.n} tasks · ${pr.pct}%` : 'A realistic client brief for your target role.'}</em></span>
        </a>
      </div>
      <${AnnCard} />
    </div>`;
}

/* ---- the website's plans page (#/plans) ---- */
function PlansPage() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api('bill_plans', {}).then(setD, e => setErr(errText(e)));
  }, []);
  const caps = useCaps();
  const pdoc = useDoc(caps && caps.db ? 'org/site/x/pricing' : null);
  const stu = d ? d.plans.filter(p => p.aud === 'student' && p.line !== 'placement') : [];
  const out = d ? d.plans.filter(p => p.aud === 'outside' && p.line !== 'placement') : [];
  const prog = d ? d.plans.filter(p => p.line === 'placement') : [];
  const fees = d ? Object.entries(d.fees && typeof d.fees === 'object' ? d.fees : {}) : [];
  return html`<${Fragment}>
      <${PageHead} title="Plans for students and consultants" intro="Learn, get certified and get placed: student plans with courses, StratEdge certifications, daily tests and live projects, and memberships for consultants who apply to roles through StratEdge." />
      <section className="sec">
        <div className="wrap stack" style=${{ gap: 28 }}>
          ${err && html`<p className="err">${err}</p>`}
          ${!d && !err && html`<${Spinner} />`}
          ${
            d &&
            html`<${Fragment}>
              ${
                prog.length > 0 &&
                html`<${PlacementPrograms} plans=${prog} place=${pricingOf(pdoc.data).place} features=${d.features} cta=${x =>
                  x.quote
                    ? html`<a className="btn ghost" href="#/contact">Talk to us</a>`
                    : html`<a className="btn" href="#/login?as=student&mode=register">Get started</a><a className="small" href="#/login?as=consultant&mode=register&out=1">or join as a consultant</a>`} />`
              }
              <div className="stack" style=${{ gap: 12 }}>
                <h2 style=${{ margin: 0 }}>Student plans</h2>
                <${BillPlanCards} plans=${stu} features=${d.features} cta=${() => html`<a className="btn" href="#/login?as=student&mode=register">Create a student account</a>`} />
              </div>
              <div className="stack" style=${{ gap: 12 }}>
                <h2 style=${{ margin: 0 }}>Consultant membership</h2>
                <p className="muted" style=${{ margin: 0 }}>For consultants who are not placed by StratEdge: apply to C2C, W2, contract-to-hire and full-time roles from your portal.</p>
                <${BillPlanCards} plans=${out} features=${d.features} cta=${() => html`<a className="btn" href="#/login?as=consultant&mode=register&out=1">Join as an outside consultant</a>`} />
              </div>
              ${
                fees.length > 0 &&
                html`<div className="panel">
                  <h3 className="ph">Placement fees</h3>
                  <p className="muted small" style=${{ marginTop: 0 }}>Charged only when StratEdge places you; shown again, and agreed to, before you apply to a role.</p>
                  <dl className="kv">${fees.map(([k, v]) => html`<${Fragment} key=${k}><dt>${k}</dt><dd>${v}</dd><//>`)}</dl>
                </div>`
              }
              <div className="panel">
                <h3 className="ph">Paying</h3>
                <p className="muted small" style=${{ margin: 0 }}>${d.stripe ? 'Pay by card through Stripe; installment and monthly plans are charged automatically and stop after the last payment. ' : ''}Bank transfer, Zelle and checks are welcome too: report the payment in your portal and StratEdge confirms it. Certificates can be checked by anyone on the <a href="#/verify">verification page</a>.</p>
              </div>
            <//>`
          }
        </div>
      </section>
    <//>`;
}
