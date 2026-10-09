/* ================= Admin, HR & accounting: plans and payments (v32) =================
   People: every student and outside consultant with a plan, what they paid and owe, payments reported by hand to
   confirm, charges to add (a placement fee once someone is placed). Plans: what students and outside consultants
   can buy (once, in installments or monthly) and which features each unlocks. Placement fees: the terms per
   engagement type shown before applying. Settings: Stripe keys and webhook, currency, grace days, reminders and
   the instructions for paying by bank transfer, Zelle or check. */
const BILL_KIND_NAMES = { once: 'One payment', install: 'Installments', monthly: 'Monthly' };
const BILL_AUD_NAMES = { student: 'Students', outside: 'Outside consultants', all: 'Students and outside consultants' };
const BILL_FEE_KINDS = [['none', 'No fee'], ['flat', 'A flat amount'], ['pct', 'A % of the first months’ billing'], ['salary', 'A % of the first-year salary']];
const billCopy = async (text, toast) => {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied.');
  } catch (e) {
    toast('Copy it from the box.', true);
  }
};

function BillingAdminPage({ q }) {
  const [tab, setTab] = useState((q && q.tab) || 'people');
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const load = () =>
    api('bill_admin').then(
      r => {
        setErr(null);
        setD(r);
      },
      e => setErr(e)
    );
  useEffect(() => {
    load();
  }, []);
  if (err) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} />`;
  const cur = d.settings.cur;
  const reported = d.people.reduce((s, p) => s + p.reported, 0);
  const collected = d.people.reduce((s, p) => s + p.paid, 0);
  const owed = d.people.reduce((s, p) => s + p.due, 0);
  return html`<div className="stack billadmin">
      ${!d.settings.stripe && html`<div className="note info"><span><b>Online payments are off.</b> Add your Stripe keys under Settings to take cards; until then people pay by the instructions you write there and you mark payments received.</span><div className="actions"><button type="button" className="btn sm" onClick=${() => setTab('settings')}>Set up Stripe</button></div></div>`}
      <${KitStats} items=${[
        { v: d.people.filter(p => p.st === 'active').length, l: 'Active plans', onClick: () => setTab('people') },
        { v: reported, l: 'Payments reported to confirm', tone: reported ? 'warn' : '', onClick: () => setTab('people') },
        { v: billAmt(collected, cur), l: 'Collected' },
        { v: billAmt(owed, cur), l: 'Still due' },
      ]} />
      <${KitTabs} tab=${tab} onTab=${setTab} tabs=${[['people', 'People', reported || null], ['plans', 'Plans', d.plans.length || null], ['fees', 'Placement fees'], ['settings', 'Settings']]} />
      ${tab === 'people' && html`<${BillPeople} d=${d} setD=${setD} />`}
      ${tab === 'plans' && html`<${BillPlans} d=${d} onChanged=${load} />`}
      ${tab === 'fees' && html`<${BillFees} d=${d} setD=${setD} />`}
      ${tab === 'settings' && html`<${BillSettings} d=${d} setD=${setD} />`}
    </div>`;
}

/* ---- people ---- */
function BillPeople({ d, setD }) {
  const [open, setOpen] = useState(null);
  const [f, setF] = useState('');
  const cur = d.settings.cur;
  const list = d.people.filter(p => !f || (f === 'reported' ? p.reported > 0 : p.st === f));
  const person = open && d.people.find(p => p.id === open);
  return html`<div className="stack">
      <div className="toolbar"><select value=${f} onChange=${e => setF(e.target.value)} aria-label="Show"><option value="">Everyone with a plan</option><option value="reported">Payments to confirm</option>${Object.entries(BILL_ST).filter(([k]) => k !== 'none').map(([k, v]) => html`<option key=${k} value=${k}>${v[0]}</option>`)}</select></div>
      ${
        list.length
          ? html`<section className="panel" style=${{ padding: '6px 8px' }}><div className="tblwrap"><table className="tbl">
              <thead><tr><th>Person</th><th>Plan</th><th>Status</th><th className="r">Paid</th><th className="r">Due</th><th>Next payment</th><th className="r"><span className="sr">Open</span></th></tr></thead>
              <tbody>
                ${list.map(p => {
                  const st = BILL_ST[p.st] || [p.st, ''];
                  return html`<tr key=${p.id}>
                    <td><b>${p.n}</b><div className="muted small">${p.e} · ${CT_NAMES[p.ct] || 'No type'}</div></td>
                    <td>${p.pt || '—'}${p.auto && html`<div className="muted small">Card, charged automatically</div>`}</td>
                    <td><${Chip} s=${st[1]}>${st[0]}<//>${p.reported > 0 && html` <span className="chip info">${p.reported} to confirm</span>`}</td>
                    <td className="r">${billAmt(p.paid, cur)}</td>
                    <td className="r">${billAmt(p.due, cur)}</td>
                    <td className="small">${p.next ? fmtDate(p.next.due, { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + billAmt(p.next.amt, cur) : '—'}</td>
                    <td className="r"><button type="button" className="btn ghost sm" onClick=${() => setOpen(p.id)}>Open</button></td>
                  </tr>`;
                })}
              </tbody>
            </table></div></section>`
          : html`<section className="panel"><${Empty} title=${d.people.length ? 'Nobody matches' : 'No plans taken yet'}>${d.people.length ? 'Change the filter.' : 'Students and outside consultants appear here once they choose a plan. Publish plans under Plans first.'}<//></section>`
      }
      ${person && html`<${BillPersonModal} p=${person} cur=${cur} onClose=${() => setOpen(null)} onPeople=${people => setD({ ...d, people })} />`}
    </div>`;
}
function BillPersonModal({ p, cur, onClose, onPeople }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [add, setAdd] = useState(null);
  const [paying, setPaying] = useState(null); // { id, ref }: the payment being marked received
  const mark = async (it, st, ref) => {
    setBusy(it.id);
    try {
      const r = await api('bill_mark', { uid: p.id, item: it.id, st, ref: ref || '' });
      onPeople(r.people);
      setPaying(null);
      toast(st === 'paid' ? 'Marked received.' : 'Updated.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const addCharge = async () => {
    setBusy('add');
    try {
      const r = await api('bill_mark', { uid: p.id, add });
      onPeople(r.people);
      setAdd(null);
      toast('Charge added; they were emailed.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const reset = async () => {
    if (!confirm('Take ' + p.n + "'s plan off? Payments still due are kept on record; the card subscription, if any, stops.")) return;
    setBusy('reset');
    try {
      const r = await api('bill_reset', { uid: p.id });
      onPeople(r.people);
      toast('Plan taken off.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const st = BILL_ST[p.st] || [p.st, ''];
  return html`<${Modal} wide title=${p.n} onClose=${onClose} foot=${html`${!['cancelled', 'none'].includes(p.st) && html`<button className="btn ghost" style=${{ marginRight: 'auto' }} disabled=${!!busy} onClick=${reset}>Take the plan off</button>`}<button className="btn ghost" onClick=${onClose}>Close</button>`}>
      <div className="stack">
        <div className="ph-row"><span className="muted small">${p.e} · ${CT_NAMES[p.ct] || 'No type'} · ${p.pt || 'no plan'}</span><${Chip} s=${st[1]}>${st[0]}<//></div>
        <div className="tblwrap"><table className="tbl">
          <thead><tr><th>Payment</th><th>Due</th><th className="r">Amount</th><th>Status</th><th className="r"><span className="sr">Actions</span></th></tr></thead>
          <tbody>
            ${(p.items || []).map(it => {
              const s = BILL_ITEM_ST[it.st] || [it.st, ''];
              return html`<tr key=${it.id}>
                <td><b>${it.t}</b>${it.k === 'fee' && html` <span className="chip new">Charge</span>`}${it.rep && html`<div className="small">Reported ${fmtDay(it.rep.at)}: ${it.rep.how}${it.rep.ref ? ' · ' + it.rep.ref : ''}${it.rep.note ? ' · ' + it.rep.note : ''}</div>`}${it.st === 'paid' && html`<div className="muted small">${it.how === 'stripe' ? 'Stripe' : 'Marked received'}${it.paidAt ? ' ' + fmtDay(it.paidAt) : ''}${it.ref ? ' · ' + it.ref : ''}</div>`}</td>
                <td className="small">${fmtDate(it.due, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                <td className="r">${billAmt(it.amt, cur)}</td>
                <td><${Chip} s=${s[1]}>${s[0]}<//></td>
                <td className="r">${
                  paying && paying.id === it.id
                    ? html`<div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        <input style=${{ maxWidth: 190 }} value=${paying.ref} onInput=${e => setPaying({ ...paying, ref: e.target.value })} placeholder="Reference (optional)" aria-label="Payment reference" />
                        <button type="button" className="btn sm" disabled=${!!busy} onClick=${() => mark(it, 'paid', paying.ref)}>Save</button>
                        <button type="button" className="btn ghost sm" onClick=${() => setPaying(null)}>Cancel</button>
                      </div>`
                    : html`<div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        ${(it.st === 'due' || it.st === 'reported') && html`<button type="button" className="btn sm" disabled=${!!busy} onClick=${() => setPaying({ id: it.id, ref: (it.rep && it.rep.ref) || '' })}>${it.st === 'reported' ? 'Confirm received' : 'Mark received'}</button>`}
                        ${(it.st === 'due' || it.st === 'reported') && html`<button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => mark(it, 'waived')}>Waive</button>`}
                        ${['paid', 'waived', 'void', 'reported'].includes(it.st) && html`<button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => mark(it, 'due')}>Back to due</button>`}
                      </div>`
                }</td>
              </tr>`;
            })}
          </tbody>
        </table></div>
        ${
          add
            ? html`<div className="form panel" style=${{ background: 'var(--surface-2)' }}>
                <div className="row3">
                  <${Field} label="Charge"><input value=${add.t} onInput=${e => setAdd({ ...add, t: e.target.value })} placeholder="Placement fee: Acme Corp, Java developer (C2C)" /><//>
                  <${Field} label=${'Amount (' + String(cur).toUpperCase() + ')'}><input type="number" min="0" step="0.01" value=${add.amt} onInput=${e => setAdd({ ...add, amt: e.target.value })} /><//>
                  <${Field} label="Due"><input type="date" value=${add.due} onInput=${e => setAdd({ ...add, due: e.target.value })} /><//>
                </div>
                <div className="actions"><button type="button" className="btn ghost sm" onClick=${() => setAdd(null)}>Cancel</button><button type="button" className="btn sm" disabled=${busy === 'add'} onClick=${addCharge}>Add and email them</button></div>
              </div>`
            : html`<div><button type="button" className="btn ghost sm" onClick=${() => setAdd({ t: '', amt: '', due: dkey() })}><${Icon} n="plus" />Add a charge (e.g. a placement fee)</button></div>`
        }
        ${
          (p.agreed || []).length > 0 &&
          html`<div><h3 className="ph">Placement fees agreed when applying</h3><ul className="list">${p.agreed.map((a, i) => html`<li key=${i}><span><b>${a.job}</b>${a.co ? ' · ' + a.co : ''} <span className="muted small">${a.eng} · ${fmtDay(a.at)}</span><div className="muted small">${a.fee}</div></span></li>`)}</ul></div>`
        }
      </div>
    <//>`;
}

/* ---- plans ---- */
function BillPlans({ d, onChanged }) {
  const [edit, setEdit] = useState(null);
  const cur = d.settings.cur;
  return html`<div className="stack">
      <div className="ph-row">
        <p className="muted small" style=${{ margin: 0, maxWidth: 760 }}>Students see the student plans on the website (Pricing) and in their portal; outside consultants see the membership plans under Membership & fees; the job placement programs (Basic, Elite, Premium, Custom) are offered to both. A plan unlocks its features once the first payment is in; an installment unpaid past the grace days pauses it. What each program includes on the website is edited under Website & messages › Pricing.</p>
        <button type="button" className="btn" onClick=${() => setEdit({ t: '', aud: 'student', d: '', price: 0, kind: 'install', n: 3, every: 'month', feat: ['learn', 'cert', 'tests', 'projects'], perks: [], months: 0, pub: false, ord: 50 })}><${Icon} n="plus" />New plan</button>
      </div>
      ${
        d.plans.length
          ? html`<section className="panel" style=${{ padding: '6px 8px' }}><div className="tblwrap"><table className="tbl">
              <thead><tr><th>Plan</th><th>For</th><th>Price</th><th>Unlocks</th><th>Status</th><th className="r"><span className="sr">Edit</span></th></tr></thead>
              <tbody>${d.plans.map(p => html`<tr key=${p.id}><td><b>${p.t}</b>${p.line === 'placement' && html` <span className="chip new">Job placement program</span>`}${p.quote && html` <span className="chip">Custom</span>`}</td><td>${BILL_AUD_NAMES[p.aud]}</td><td className="small">${p.label}${p.months ? html`<br />${p.months} months of access` : ''}</td><td className="small">${p.feat.map(f => d.features[f] || f).join(', ') || '—'}</td><td>${p.pub ? html`<span className="chip ok">Published</span>` : html`<span className="chip">Draft</span>`}</td><td className="r"><button type="button" className="btn ghost sm" onClick=${() => setEdit({ ...p, price: p.price / 100 })}>Edit</button></td></tr>`)}</tbody>
            </table></div></section>`
          : html`<section className="panel"><${Empty} title="No plans yet">Create a student plan (for example "Career launch": courses, certifications, tests and live projects, 3 monthly installments) and a membership for outside consultants (job applications through the portal, monthly).<//></section>`
      }
      ${edit && html`<${BillPlanModal} key=${edit.id || 'new' + (edit.t || '')} p=${edit} d=${d} cur=${cur} onClose=${() => setEdit(null)} onSaved=${next => { onChanged(); setEdit(next && next.t !== undefined && !next.id ? next : null); }} />`}
    </div>`;
}
function BillPlanModal({ p, d, cur, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ line: '', quote: false, ...p, feat: [...(p.feat || [])], perks: (p.perks || []).join('\n') });
  const [busy, setBusy] = useState(false);
  const [who, setWho] = useState('');
  // v34: put someone on this plan (a custom plan agreed on a call, or a draft made just for them)
  const assign = async (replace) => {
    if (!who.trim()) return toast('Enter their portal email.', true);
    setBusy(true);
    try {
      const r = await api('bill_assign', { email: who.trim(), plan: p.id, replace: !!replace });
      toast(`${r.name} is on ${p.t} now; they were emailed to pay the first payment.`);
      setWho('');
      onSaved();
    } catch (e) {
      if (e && e.message && /already has an active plan/.test(e.message) && confirm(e.message.replace('Take it off first, or confirm the change.', 'Replace it with this plan?'))) {
        setBusy(false);
        return assign(true);
      }
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const copy = () => onSaved({ ...f, id: undefined, t: f.t + ' for ', quote: false, pub: false, perks: f.perks.split('\n').map(x => x.trim()).filter(Boolean) });
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const each = f.kind === 'install' ? Math.ceil(((+f.price || 0) * 100) / Math.max(1, +f.n || 1)) : (+f.price || 0) * 100;
  const save = async () => {
    setBusy(true);
    try {
      await api('bill_plan_save', { plan: { ...f, perks: f.perks.split('\n').map(x => x.trim()).filter(Boolean) } });
      toast(f.pub ? 'Saved and published.' : 'Saved as a draft.');
      onSaved();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const del = async () => {
    if (!confirm('Delete this plan? People already on it keep their schedule.')) return;
    setBusy(true);
    try {
      await api('bill_plan_delete', { id: p.id });
      toast('Deleted.');
      onSaved();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} wide title=${p.id ? 'Edit plan' : 'New plan'} onClose=${onClose} foot=${html`${p.id && html`<button className="btn ghost" style=${{ marginRight: 'auto' }} disabled=${busy} onClick=${del}><${Icon} n="trash" />Delete</button>`}${p.id && html`<button className="btn ghost" disabled=${busy} onClick=${copy} title="A new plan with the same services, e.g. a custom plan for one person">Copy as a new plan</button>`}<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save'}</button>`}>
      <div className="form">
        <div className="row2">
          <${Field} label="Name"><input value=${f.t} onInput=${e => set('t', e.target.value)} placeholder="Career launch" /><//>
          <${Field} label="For"><select value=${f.aud} onChange=${e => set('aud', e.target.value)}>${Object.entries(BILL_AUD_NAMES).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
        </div>
        <div className="row2">
          <${Field} label="Shown as" hint="Job placement programs are listed together on the pricing page, with the comparison table."><select value=${f.line || ''} onChange=${e => set('line', e.target.value)}><option value="">A plan or membership</option><option value="placement">A job placement program</option></select><//>
          <label className="check" style=${{ alignSelf: 'end' }}><input type="checkbox" checked=${!!f.quote} onChange=${e => set('quote', e.target.checked)} /><span><b>Custom: price agreed after a call</b> (shown with a Talk to us button instead of a price; it can't be bought online)</span></label>
        </div>
        <${Field} label="Description (optional)"><textarea rows="2" value=${f.d} onInput=${e => set('d', e.target.value)} /><//>
        <div className="row3">
          <${Field} label="How it is paid"><select value=${f.kind} onChange=${e => set('kind', e.target.value)}>${Object.entries(BILL_KIND_NAMES).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
          <${Field} label=${(f.kind === 'monthly' ? 'Price a month' : 'Total price') + ' (' + String(cur).toUpperCase() + ')'}><input type="number" min="0" step="0.01" value=${f.price} onInput=${e => set('price', e.target.value)} /><//>
          ${f.kind === 'install' && html`<${Field} label="Installments"><input type="number" min="2" max="36" value=${f.n} onInput=${e => set('n', e.target.value)} /><//>`}
          ${f.kind === 'monthly' && html`<${Field} label="Months (0 = until cancelled)" hint="Card payments renew each month; with a number, they stop after it."><input type="number" min="0" max="36" value=${f.n} onInput=${e => set('n', e.target.value)} /><//>`}
        </div>
        ${f.kind === 'install' && html`<div className="row2"><${Field} label="Installments every"><select value=${f.every} onChange=${e => set('every', e.target.value)}><option value="month">Month</option><option value="week">Week</option></select><//><p className="muted small" style=${{ alignSelf: 'end' }}>${f.n || 0} payments of about ${billAmt(each, cur)}; the first one unlocks the plan.</p></div>`}
        <div className="fld">
          <span>Unlocks</span>
          <div className="aifeat-grid">${Object.entries(d.features).map(([k, v]) => html`<label key=${k} className="check"><input type="checkbox" checked=${f.feat.includes(k)} onChange=${() => set('feat', f.feat.includes(k) ? f.feat.filter(x => x !== k) : [...f.feat, k])} /><span>${v}</span></label>`)}</div>
        </div>
        <${Field} label="Also included (one per line, shown on the plan)" hint="e.g. Two mock interviews, Resume review by a recruiter"><textarea rows="3" value=${f.perks} onInput=${e => set('perks', e.target.value)} /><//>
        <div className="row3">
          <${Field} label="Access (months, 0 = while paid)"><input type="number" min="0" max="60" value=${f.months} onInput=${e => set('months', e.target.value)} /><//>
          <${Field} label="Order"><input type="number" min="0" max="999" value=${f.ord} onInput=${e => set('ord', e.target.value)} /><//>
          <label className="check" style=${{ alignSelf: 'end' }}><input type="checkbox" checked=${f.pub} onChange=${e => set('pub', e.target.checked)} /><span><b>Published</b></span></label>
        </div>
        ${
          p.id &&
          html`<section className="panel stack" style=${{ gap: 8, background: 'var(--surface-2)' }}>
            <b>Put someone on this plan</b>
            <p className="muted small" style=${{ margin: 0 }}>${p.quote ? 'For a custom plan: use "Copy as a new plan", give the copy the agreed price and services (it can stay unpublished), save it, then put the person on the copy here.' : 'They get an email and pay the first payment in their portal; the plan does not need to be published.'}</p>
            ${!p.quote && html`<div className="actions"><input type="email" style=${{ maxWidth: 320 }} value=${who} onInput=${e => setWho(e.target.value)} placeholder="their portal email" aria-label="Their portal email" /><button type="button" className="btn sm" disabled=${busy} onClick=${() => assign(false)}>Put them on ${p.t}</button></div>`}
          </section>`
        }
      </div>
    <//>`;
}

/* ---- placement fees ---- */
function BillFees({ d, setD }) {
  const toast = useToast();
  const [f, setF] = useState(() => {
    const rules = {};
    d.eng.forEach(e => {
      const r = d.fees.rules[e] || { kind: 'none' };
      rules[e] = { ...r, amt: (r.amt || 0) / 100 };
    });
    return { rules, aud: [...d.fees.aud] };
  });
  const [busy, setBusy] = useState(false);
  const set = (e, k, v) => setF(x => ({ ...x, rules: { ...x.rules, [e]: { ...x.rules[e], [k]: v } } }));
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('bill_fees_save', { fees: f });
      setD({ ...d, fees: r.fees, feeText: r.feeText });
      toast('Saved.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<div className="stack">
      <p className="muted small" style=${{ margin: 0, maxWidth: 780 }}>The fee for each engagement type, charged when StratEdge places the person. They see it before applying and tick that they agree; the agreement is kept with the application and on their account. Add the actual charge on the person's account (People) once they start.</p>
      <section className="panel">
        <div className="fld"><span>Applies to</span><div className="actions">${Object.entries(BILL_AUD_NAMES).map(([k, v]) => html`<label key=${k} className="check"><input type="checkbox" checked=${f.aud.includes(k)} onChange=${() => setF({ ...f, aud: f.aud.includes(k) ? f.aud.filter(x => x !== k) : [...f.aud, k] })} /><span>${v}</span></label>`)}</div></div>
      </section>
      ${d.eng.map(e => {
        const r = f.rules[e];
        return html`<section key=${e} className="panel form">
          <div className="ph-row"><h3 className="ph" style=${{ margin: 0 }}>${e}</h3><span className="muted small">${(d.feeText || {})[e] || 'No fee'}</span></div>
          <div className="row3">
            <${Field} label="Fee"><select value=${r.kind} onChange=${ev => set(e, 'kind', ev.target.value)}>${BILL_FEE_KINDS.map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
            ${r.kind === 'flat' && html`<${Field} label=${'Amount (' + String(d.settings.cur).toUpperCase() + ')'}><input type="number" min="0" step="0.01" value=${r.amt} onInput=${ev => set(e, 'amt', ev.target.value)} /><//>`}
            ${(r.kind === 'pct' || r.kind === 'salary') && html`<${Field} label="Percent"><input type="number" min="0" max="100" step="0.1" value=${r.pct} onInput=${ev => set(e, 'pct', ev.target.value)} /><//>`}
            ${r.kind === 'pct' && html`<${Field} label="Of the first … months"><input type="number" min="1" max="24" value=${r.months} onInput=${ev => set(e, 'months', ev.target.value)} /><//>`}
          </div>
          ${r.kind !== 'none' && html`<${Field} label="Your own wording (optional)" hint="Replaces the automatic sentence shown to people."><input value=${r.text || ''} onInput=${ev => set(e, 'text', ev.target.value)} /><//>`}
        </section>`;
      })}
      <div className="actions"><button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save the fees'}</button></div>
    </div>`;
}

/* ---- settings ---- */
function BillSettings({ d, setD }) {
  const toast = useToast();
  const P = usePortal();
  const s = d.settings;
  const [f, setF] = useState({ sk: '', wh: '', cur: s.cur, grace: s.grace, unlock: s.unlock, remind: s.remind, manual: s.manual });
  const [busy, setBusy] = useState('');
  const [test, setTest] = useState(null);
  const admin = (P.roles || []).includes('admin');
  const save = async extra => {
    setBusy('save');
    try {
      const body = { cur: f.cur, grace: f.grace, unlock: f.unlock, remind: f.remind, manual: f.manual, ...(f.sk.trim() ? { sk: f.sk.trim() } : {}), ...(f.wh.trim() ? { wh: f.wh.trim() } : {}), ...(extra || {}) };
      const r = await api('bill_settings_save', body);
      setD({ ...d, settings: r.settings });
      setF({ ...f, sk: '', wh: '' });
      toast('Saved.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const runTest = async () => {
    setBusy('test');
    try {
      const r = await api('bill_test', {});
      setTest(r);
      if (r.settings) setD({ ...d, settings: r.settings });
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  return html`<div className="stack">
      ${!admin && html`<div className="note info"><span>Only administrators change these settings.</span></div>`}
      <section className="panel form">
        <div className="ph-row"><h3 className="ph" style=${{ margin: 0 }}>Stripe (card payments)</h3>${s.stripe ? html`<span className=${'chip ' + (s.mode === 'live' ? 'ok' : 'amber')}>${s.mode === 'live' ? 'Live' : 'Test mode'} · ${s.hint}</span>` : html`<span className="chip">Not set up</span>`}</div>
        <ol className="tllist small">
          <li>In the Stripe dashboard open <b>Developers > API keys</b> and copy the <b>Secret key</b> (sk_live_… or, to try it first, sk_test_…). A restricted key (rk_…) works too if it may write Checkout Sessions, Customers and Subscriptions and read Invoices.</li>
          <li>Open <b>Developers > Webhooks</b>, add an endpoint with the address below, and choose the events <code>checkout.session.completed</code>, <code>checkout.session.async_payment_succeeded</code>, <code>invoice.paid</code> and <code>invoice.payment_failed</code>. Copy its <b>Signing secret</b> (whsec_…).</li>
          <li>Paste both here, save, then press Test.</li>
        </ol>
        <div className="row2">
          <${Field} label=${s.stripe ? 'Secret key (leave empty to keep it)' : 'Secret key'}><input type="password" autoComplete="off" value=${f.sk} onInput=${e => setF({ ...f, sk: e.target.value })} placeholder=${s.stripe ? s.hint : 'sk_live_…'} disabled=${!admin} /><//>
          <${Field} label=${s.wh ? 'Webhook signing secret (saved; leave empty to keep it)' : 'Webhook signing secret'}><input type="password" autoComplete="off" value=${f.wh} onInput=${e => setF({ ...f, wh: e.target.value })} placeholder="whsec_…" disabled=${!admin} /><//>
        </div>
        <${Field} label="Webhook address"><div className="actions" style=${{ flexWrap: 'nowrap' }}><input readOnly value=${s.hook} onFocus=${e => e.target.select()} /><button type="button" className="btn ghost sm" onClick=${() => billCopy(s.hook, toast)}>Copy</button></div><//>
        <div className="actions">
          ${s.stripe && html`<button type="button" className="btn ghost" disabled=${!!busy || !admin} onClick=${runTest}>${busy === 'test' ? 'Testing…' : 'Test the key'}</button>`}
          ${s.stripe && html`<button type="button" className="btn ghost" disabled=${!!busy || !admin} onClick=${() => confirm('Remove the Stripe keys? Card payments stop until you add them again.') && save({ clear: true })}>Remove the keys</button>`}
          ${s.okAt > 0 && html`<span className="muted small">Last test ${fmtTs(s.okAt)}: ${s.okAcct}</span>`}
        </div>
        ${test && (test.ok ? html`<div className="note ok"><span><b>Stripe answered.</b> Account: ${test.account}.</span></div>` : html`<div className="note red"><span><b>${test.error}</b> ${test.hint || ''}</span></div>`)}
      </section>
      <section className="panel form">
        <h3 className="ph" style=${{ margin: 0 }}>Payments by hand and reminders</h3>
        <${Field} label="How to pay without a card" hint="Shown on the plans page in the portal: Zelle address, bank details for transfers, where to send checks."><textarea rows="4" value=${f.manual} onInput=${e => setF({ ...f, manual: e.target.value })} disabled=${!admin} placeholder=${'Zelle: payments@yourcompany.com\nBank transfer: …\nChecks payable to …'} /><//>
        <div className="row3">
          <${Field} label="Currency"><select value=${f.cur} onChange=${e => setF({ ...f, cur: e.target.value })} disabled=${!admin}>${['usd', 'cad', 'inr', 'eur', 'gbp', 'aud'].map(c => html`<option key=${c} value=${c}>${c.toUpperCase()}</option>`)}</select><//>
          <${Field} label="Grace days after a due date"><input type="number" min="0" max="60" value=${f.grace} onInput=${e => setF({ ...f, grace: e.target.value })} disabled=${!admin} /><//>
          <div />
        </div>
        <label className="check"><input type="checkbox" checked=${f.unlock} onChange=${e => setF({ ...f, unlock: e.target.checked })} disabled=${!admin} /><span>Unlock as soon as someone reports a payment by hand (before you confirm it)</span></label>
        <label className="check"><input type="checkbox" checked=${f.remind} onChange=${e => setF({ ...f, remind: e.target.checked })} disabled=${!admin} /><span>Email reminders 3 days before, on the day and the day after a payment that is not charged automatically</span></label>
        <div className="actions"><button type="button" className="btn" disabled=${!!busy || !admin} onClick=${() => save()}>${busy === 'save' ? 'Saving…' : 'Save settings'}</button></div>
      </section>
    </div>`;
}
