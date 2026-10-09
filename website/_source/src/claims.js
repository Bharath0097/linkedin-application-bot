/* ================= v43 Expense claims (in js/work.js, fetched when opened) =================
   Everyone claims back what they paid for the company: lines with receipts, or miles at the IRS rate; the manager on
   their Team card approves (HR and administrators when there is none); accounting pays and the payment goes into
   Bills & expenses. Server: api/claims.php (routes xc_*). */
const XC_TONE = { draft: '', submitted: 'amber', returned: 'red', approved: 'info', rejected: 'red', paid: 'ok' };
const xcMoney = n => '$' + (+n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const xcDay = d => (d ? fmtDay(new Date(d + 'T12:00:00').getTime()) : '');
const XC_WARN = { receipt: 'receipt needed', old: 'older than the submission window', limit: 'over the category limit' };

function ClaimsApp({ q, staff }) {
  const [tab, setTab] = useState((q && q.t) || (staff ? 'queue' : 'mine'));
  const [open, setOpen] = useState((q && q.c) || '');
  const [edit, setEdit] = useState(null);
  const [tick, setTick] = useState(0);
  const [meta, setMeta] = useState(null);
  useEffect(() => {
    api('xc_settings')
      .then(setMeta)
      .catch(() => setMeta({ settings: null, payer: false }));
  }, [tick]);
  const tabs = staff ? [['queue', 'Claims'], ['mine', 'My claims'], ...(meta && meta.payer ? [['report', 'Report'], ['settings', 'Policy']] : [])] : null;
  const reload = () => setTick(t => t + 1);
  return html`<div className="stack xcpage">
      ${tabs && html`<${KitTabs} tabs=${tabs} tab=${tab} onTab=${setTab} />`}
      ${tab === 'queue' && html`<${XcQueue} key=${tick} onOpen=${setOpen} />`}
      ${tab === 'mine' && html`<${XcMine} key=${tick} onOpen=${setOpen} onNew=${() => setEdit({})} />`}
      ${tab === 'report' && html`<${XcReport} />`}
      ${tab === 'settings' && meta && html`<${XcPolicy} meta=${meta} onSaved=${reload} />`}
      ${open && html`<${XcClaim} id=${open} onClose=${() => setOpen('')} onEdit=${c => (setOpen(''), setEdit(c))} onChanged=${reload} />`}
      ${edit && html`<${XcEditor} c=${edit} onClose=${() => setEdit(null)} onChanged=${reload} />`}
    </div>`;
}
function XcList({ rows, onOpen, who }) {
  return html`<div className="tblwrap"><table className="tbl small"><thead><tr><th>Claim</th>${who && html`<th>Who</th>`}<th>Submitted</th><th className="r">Total</th><th>Status</th></tr></thead><tbody>${rows.map(
      c => html`<tr key=${c.id} className="xcrow" onClick=${() => onOpen(c.id)}><td><b>${c.num || 'Draft'}</b> ${c.title}<div className="muted">${c.lines.length} line${c.lines.length === 1 ? '' : 's'}</div></td>${who && html`<td>${c.n}${c.apprN ? html`<div className="muted">to ${c.apprN}</div>` : null}</td>`}<td className="nw">${c.sub ? fmtDay(c.sub) : '–'}</td><td className="r num">${xcMoney(c.total)}</td><td><${Chip} s=${XC_TONE[c.st]}>${c.st === 'submitted' ? 'waiting for approval' : c.st === 'approved' ? 'to be paid' : c.st}<//></td></tr>`
    )}</tbody></table></div>`;
}
function XcMine({ onOpen, onNew }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const load = () => api('xc_mine').then(setD).catch(setErr);
  useEffect(() => {
    load();
  }, []);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} />`;
  const S = d.settings;
  const open = d.claims.filter(c => ['submitted', 'approved'].includes(c.st));
  return html`<div className="stack">
      <div className="ph-row"><div className="muted small">Receipts are needed from ${xcMoney(S.receipt)}; claim within ${S.days} days; mileage is paid at ${xcMoney(S.rates[String(new Date().getFullYear())] || Object.values(S.rates).slice(-1)[0])} a mile this year.</div><button className="btn" onClick=${onNew}><${Icon} n="plus" />New claim</button></div>
      ${open.length > 0 && html`<${KitStats} items=${[{ v: xcMoney(open.reduce((t, c) => t + c.total, 0)), l: 'On their way to you' }, { v: open.length, l: open.length === 1 ? 'Claim open' : 'Claims open' }]} />`}
      ${d.claims.length ? html`<${XcList} rows=${d.claims} onOpen=${onOpen} />` : html`<${Empty} title="No expense claims yet">Paid for something for work (travel, a meal with a client, a certification, miles in your own car)? Start a claim, add the receipts and send it for approval.<//>`}
    </div>`;
}
function XcQueue({ onOpen }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [f, setF] = useState('todo');
  const load = () => api('xc_queue').then(setD).catch(setErr);
  useEffect(() => {
    load();
  }, []);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} />`;
  const todo = d.claims.filter(c => c.canDecide);
  const pay = d.claims.filter(c => c.canPay);
  const rows = f === 'todo' ? todo : f === 'pay' ? pay : d.claims;
  return html`<div className="stack">
      <div className="toolbar"><div className="seg"><button className=${f === 'todo' ? 'on' : ''} onClick=${() => setF('todo')}>To approve (${todo.length})</button>${d.payer && html`<button className=${f === 'pay' ? 'on' : ''} onClick=${() => setF('pay')}>To pay (${pay.length})</button>`}<button className=${f === 'all' ? 'on' : ''} onClick=${() => setF('all')}>All (${d.claims.length})</button></div>
      ${pay.length > 0 && d.payer && html`<span className="muted small">${xcMoney(pay.reduce((t, c) => t + c.total, 0))} approved and waiting to be paid</span>`}</div>
      ${rows.length ? html`<${XcList} rows=${rows} who onOpen=${onOpen} />` : html`<${Empty} title=${f === 'todo' ? 'Nothing to approve' : f === 'pay' ? 'Nothing to pay' : 'No claims yet'}>${f === 'todo' ? 'Claims from the people who report to you (and, for HR, from people without a manager) show here.' : 'Approved claims wait here until they are paid.'}<//>`}
    </div>`;
}

/* One claim, as the approver or accounting sees it (and its owner after sending it). */
function XcClaim({ id, onClose, onEdit, onChanged }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [why, setWhy] = useState('');
  const [pay, setPay] = useState({ m: 'bank', d: dkey ? dkey() : '', ref: '' });
  const [busy, setBusy] = useState('');
  const load = () =>
    api('xc_get', { id })
      .then(setD)
      .catch(e => {
        toast(errText(e), true);
        onClose();
      });
  useEffect(() => {
    load();
  }, [id]);
  if (!d) return html`<${Modal} title="Expense claim" onClose=${onClose}><${Spinner} /><//>`;
  const c = d.claim;
  const S = d.settings;
  const catN = k => (S.cats.find(x => x.k === k) || {}).n || k;
  const act = async (route, body, msg) => {
    setBusy(route);
    try {
      await api(route, { id: c.id, ...body });
      toast(msg);
      onChanged();
      onClose();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const files = l => (c.files || []).filter(f => f.c === l.id);
  return html`<${Modal} wide title=${(c.num || 'Draft') + ' · ' + c.title} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Close</button>${c.canEdit && html`<button className="btn" onClick=${() => onEdit(c)}>Edit</button>`}`}>
      <div className="stack">
        <div className="actions"><${Chip} s=${XC_TONE[c.st]}>${d.st[c.st]}<//><span className="small">${c.n}${c.sub ? ' · sent ' + fmtTs(c.sub) : ''}${c.apprN ? ' · approver: ' + c.apprN : ''}</span><b className="num" style=${{ marginLeft: 'auto' }}>${xcMoney(c.total)}</b></div>
        ${c.dec && c.dec.why && html`<div className=${'note ' + (c.dec.act === 'approve' ? 'ok' : 'amber')}><span><b>${c.dec.byn}:</b> ${c.dec.why}</span></div>`}
        <div className="tblwrap"><table className="tbl small"><thead><tr><th>Date</th><th>Category</th><th>Details</th><th className="r">Amount</th><th>Receipt</th></tr></thead><tbody>${c.lines.map(
          l => html`<tr key=${l.id}><td className="nw">${xcDay(l.d)}</td><td>${catN(l.cat)}</td><td>${l.cat === 'mileage' ? `${l.mi} miles × ${xcMoney(l.rate)}${l.from || l.to ? ' · ' + [l.from, l.to].filter(Boolean).join(' → ') : ''}` : l.m}${l.note ? html`<div className="muted">${l.note}</div>` : null}${(c.checks[l.id] || []).length ? html`<div className="xcwarn">${c.checks[l.id].map(w => XC_WARN[w]).join(' · ')}</div>` : null}</td><td className="r num">${xcMoney(l.a)}</td><td>${files(l).map(f => html`<a key=${f.id} className="small" href=${fileUrl('xc/' + c.id, f.id, false, c.tok)} target="_blank" rel="noopener">${f.n}</a>`)}${!files(l).length ? html`<span className="muted">${l.cat === 'mileage' ? '–' : 'none'}</span>` : null}</td></tr>`
        )}</tbody></table></div>
        ${
          c.canDecide &&
          html`<section className="panel stack form" style=${{ background: 'var(--surface-2)' }}>
            <b>Your decision</b>
            <${Field} label="Note (needed to return or reject)"><input value=${why} onInput=${e => setWhy(e.target.value)} placeholder="What to change, or why not" /><//>
            <div className="actions"><button className="btn" disabled=${!!busy} onClick=${() => act('xc_decide', { act: 'approve', why }, 'Approved: accounting pays it next.')}>Approve</button><button className="btn ghost" disabled=${!!busy || !why.trim()} onClick=${() => act('xc_decide', { act: 'return', why }, 'Returned for changes.')}>Return for changes</button><button className="btn ghost" disabled=${!!busy || !why.trim()} onClick=${() => act('xc_decide', { act: 'reject', why }, 'Rejected.')}>Reject</button></div>
          </section>`
        }
        ${
          c.canPay &&
          html`<section className="panel stack form" style=${{ background: 'var(--surface-2)' }}>
            <b>Pay ${xcMoney(c.total)}</b>
            <div className="row3">
              <${Field} label="How"><select value=${pay.m} onChange=${e => setPay({ ...pay, m: e.target.value })}>${Object.entries(d.pay).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//>
              <${Field} label="Date"><input type="date" value=${pay.d} onInput=${e => setPay({ ...pay, d: e.target.value })} /><//>
              <${Field} label="Reference (optional)"><input value=${pay.ref} onInput=${e => setPay({ ...pay, ref: e.target.value })} placeholder="Transfer or check number" /><//>
            </div>
            <p className="muted small" style=${{ margin: 0 }}>Recorded in Bills & expenses as paid, under each line's expense account, so the books show it. "With payroll" means you add it to the next paycheck as a non-taxable reimbursement.</p>
            <div><button className="btn" disabled=${!!busy} onClick=${() => act('xc_pay', pay, 'Marked paid and recorded in Bills & expenses.')}>Mark paid</button></div>
          </section>`
        }
        ${c.paid && html`<div className="note ok"><span><b>Paid</b> ${xcDay(c.paid.d)} · ${d.pay[c.paid.m] || c.paid.m}${c.paid.ref ? ' · ' + c.paid.ref : ''} · by ${c.paid.byn}</span></div>`}
        <details><summary className="small"><b>History</b></summary><ul className="list small">${(c.log || [])
          .slice()
          .reverse()
          .map((x, i) => html`<li key=${i}><div><div className="t">${x.ev}</div><div className="m">${x.who} · ${fmtTs(x.t)}</div></div></li>`)}</ul></details>
      </div>
    <//>`;
}

/* Writing a claim: lines (or miles), receipts per line, the policy checks, then send it for approval. */
function XcEditor({ c, onClose, onChanged }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState('');
  const [prog, setProg] = useState(0);
  const blank = () => ({ id: Math.random().toString(36).slice(2, 8).replace(/[^a-z0-9]/g, 'a'), d: dkey ? dkey() : '', cat: 'other', m: '', a: '', mi: '', from: '', to: '', note: '' });
  // xc_save answers with the claim only; keep the policy (settings) and the status names from the first load
  const take = r => {
    setD(x => ({ ...(x || {}), ...r, settings: r.settings || (x && x.settings), st: r.st || (x && x.st) }));
    setF({ title: r.claim.title, lines: r.claim.lines.map(l => ({ ...l, a: l.a, mi: l.mi || '' })) });
  };
  // v83: after a receipt is added or removed, reload only the saved claim (files, checks); the form keeps unsaved edits and lines
  const refresh = async id => {
    const r = await api('xc_get', { id });
    setD(x => ({ ...(x || {}), ...r, settings: r.settings || (x && x.settings), st: r.st || (x && x.st) }));
  };
  useEffect(() => {
    if (c && c.id)
      api('xc_get', { id: c.id })
        .then(take)
        .catch(e => toast(errText(e), true));
    else
      api('xc_settings').then(s => {
        setD({ claim: null, settings: s.settings, st: s.st });
        setF({ title: '', lines: [blank()] });
      });
  }, []);
  if (!f || !d) return html`<${Modal} title="Expense claim" onClose=${onClose}><${Spinner} /><//>`;
  const S = d.settings;
  const C = d.claim;
  const rate = dd => S.rates[String(dd || '').slice(0, 4)] || Object.values(S.rates).slice(-1)[0];
  const lineAmt = l => (l.cat === 'mileage' ? Math.round((+l.mi || 0) * rate(l.d) * 100) / 100 : +l.a || 0);
  const total = f.lines.reduce((t, l) => t + lineAmt(l), 0);
  const set = (i, patch) => setF({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const save = async () => {
    const r = await api('xc_save', { id: C ? C.id : '', title: f.title, lines: f.lines.map(l => ({ id: l.id, d: l.d, cat: l.cat, m: l.m, a: l.a, mi: l.mi, from: l.from, to: l.to, note: l.note })) });
    take(r);
    return r.claim;
  };
  const doSave = async () => {
    setBusy('save');
    try {
      await save();
      toast('Saved as a draft. Add receipts, then send it.');
      onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const submit = async () => {
    setBusy('send');
    try {
      const cl = await save();
      await api('xc_submit', { id: cl.id });
      toast('Sent for approval.');
      onChanged();
      onClose();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const upFile = async (l, file) => {
    setBusy('up' + l.id);
    setProg(0.05);
    try {
      const cl = C && C.lines.some(x => x.id === l.id) ? C : await save();
      const fd = new FormData();
      fd.append('id', cl.id);
      fd.append('line', l.id);
      fd.append('file', file, file.name);
      await upload('xc_upload', fd, setProg);
      await refresh(cl.id);
      toast('Receipt added.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
    setProg(0);
  };
  const unFile = async fid => {
    try {
      await api('xc_unfile', { id: C.id, fid });
      await refresh(C.id);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const del = async () => {
    if (!confirm('Delete this draft and its receipts?')) return;
    try {
      await api('xc_delete', { id: C.id });
      toast('Draft deleted.');
      onChanged();
      onClose();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const files = l => ((C && C.files) || []).filter(x => x.c === l.id);
  const needs = l => l.cat !== 'mileage' && lineAmt(l) >= S.receipt && !files(l).length;
  return html`<${Modal} wide title=${C && C.num ? C.num : 'New expense claim'} onClose=${onClose} foot=${html`${C && C.st === 'draft' && html`<button className="btn ghost" style=${{ marginRight: 'auto' }} onClick=${del}>Delete draft</button>`}<button className="btn ghost" onClick=${onClose}>Close</button><button className="btn ghost" disabled=${!!busy} onClick=${doSave}>${busy === 'save' ? 'Saving…' : 'Save draft'}</button><button className="btn" disabled=${!!busy || !f.lines.length} onClick=${submit}>${busy === 'send' ? 'Sending…' : 'Send for approval'}</button>`}>
      <div className="stack">
        ${C && C.st === 'returned' && C.dec && html`<div className="note amber"><span><b>Returned by ${C.dec.byn}:</b> ${C.dec.why}</span></div>`}
        <${Field} label="What it was for"><input value=${f.title} onInput=${e => setF({ ...f, title: e.target.value })} placeholder="Client visit to Edison, October" /><//>
        ${f.lines.map(
          (l, i) => html`<section key=${l.id} className="xcline">
            <div className="row3">
              <${Field} label="Date"><input type="date" value=${l.d} max=${dkey ? dkey() : ''} onInput=${e => set(i, { d: e.target.value })} /><//>
              <${Field} label="Category"><select value=${l.cat} onChange=${e => set(i, { cat: e.target.value })}>${S.cats.map(k => html`<option key=${k.k} value=${k.k}>${k.n}${k.limit ? ' (up to ' + xcMoney(k.limit) + ')' : ''}</option>`)}</select><//>
              ${
                l.cat === 'mileage'
                  ? html`<${Field} label=${'Miles (' + xcMoney(rate(l.d)) + ' a mile)'}><input type="number" min="0" step="0.1" value=${l.mi} onInput=${e => set(i, { mi: e.target.value })} /><//>`
                  : html`<${Field} label="Amount (USD)"><input type="number" min="0" step="0.01" value=${l.a} onInput=${e => set(i, { a: e.target.value })} /><//>`
              }
            </div>
            <div className="row3">
              ${
                l.cat === 'mileage'
                  ? html`<${Field} label="From"><input value=${l.from} onInput=${e => set(i, { from: e.target.value })} placeholder="Office" /><//><${Field} label="To"><input value=${l.to} onInput=${e => set(i, { to: e.target.value })} placeholder="Client site" /><//>`
                  : html`<${Field} label="Merchant"><input value=${l.m} onInput=${e => set(i, { m: e.target.value })} placeholder="Where you paid" /><//>`
              }
              <${Field} label="Note"><input value=${l.note} onInput=${e => set(i, { note: e.target.value })} placeholder="Who, why" /><//>
            </div>
            <div className="actions xclinefoot">
              <b className="num">${xcMoney(lineAmt(l))}</b>
              ${files(l).map(x => html`<span key=${x.id} className="chip">${x.n}<button type="button" className="btn ghost sm" aria-label="Remove receipt" onClick=${() => unFile(x.id)}><${Icon} n="x" /></button></span>`)}
              ${l.cat !== 'mileage' && html`<label className="btn ghost sm"><${Icon} n="up" />${busy === 'up' + l.id ? 'Uploading…' : 'Add receipt'}<input type="file" accept="image/*,.pdf" hidden onChange=${e => {
                const fl = e.target.files[0];
                e.target.value = '';
                if (fl) upFile(l, fl);
              }} /></label>`}
              ${needs(l) && html`<span className="xcwarn">Receipt needed (${xcMoney(S.receipt)} or more)</span>`}
              <button type="button" className="btn ghost sm" style=${{ marginLeft: 'auto' }} disabled=${f.lines.length === 1} onClick=${() => setF({ ...f, lines: f.lines.filter((x, j) => j !== i) })}>Remove line</button>
            </div>
          </section>`
        )}
        ${busy.startsWith('up') && html`<div className="prog"><i style=${{ width: Math.round((prog || 0.05) * 100) + '%' }} /></div>`}
        <div className="actions"><button type="button" className="btn ghost sm" onClick=${() => setF({ ...f, lines: [...f.lines, blank()] })}><${Icon} n="plus" />Add a line</button><span className="muted small">Total</span><b className="num">${xcMoney(total)}</b></div>
        <p className="muted small" style=${{ margin: 0 }}>Claim within ${S.days} days of spending; receipts from ${xcMoney(S.receipt)}. Your manager approves, then accounting pays you back. Reimbursed business expenses under this policy are not taxable pay.</p>
      </div>
    <//>`;
}

/* Accounting: the claims by month, category and person. */
function XcReport() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [d, setD] = useState(null);
  useEffect(() => {
    setD(null);
    api('xc_report', { year })
      .then(setD)
      .catch(() => setD({ month: {}, cat: {}, person: {}, settings: { cats: [] } }));
  }, [year]);
  if (!d) return html`<${Spinner} />`;
  const catN = k => ((d.settings.cats || []).find(x => x.k === k) || {}).n || k;
  const months = Object.entries(d.month);
  const total = months.reduce((t, [, v]) => t + v, 0);
  return html`<div className="stack">
      <div className="toolbar"><select value=${year} onChange=${e => setYear(+e.target.value)} aria-label="Year">${[0, 1, 2].map(k => html`<option key=${k} value=${new Date().getFullYear() - k}>${new Date().getFullYear() - k}</option>`)}</select><span className="muted small">Approved and paid claims, by the date of each expense: ${xcMoney(total)}</span></div>
      ${months.length ? html`<section className="panel"><${WkBars} rows=${months.map(([m, v]) => ({ l: m.slice(5), a: v }))} keys=${[['a', 'done', 'USD']]} max=${Math.max(1, ...months.map(([, v]) => v))} /></section>` : null}
      <div className="g2" style=${{ alignItems: 'start' }}>
        <section className="panel stack"><b>By category</b><table className="tbl small"><tbody>${Object.entries(d.cat).map(([k, v]) => html`<tr key=${k}><td>${catN(k)}</td><td className="r num">${xcMoney(v)}</td></tr>`)}</tbody></table></section>
        <section className="panel stack"><b>By person</b><table className="tbl small"><tbody>${Object.entries(d.person).map(([k, v]) => html`<tr key=${k}><td>${k}</td><td className="r num">${xcMoney(v)}</td></tr>`)}</tbody></table></section>
      </div>
    </div>`;
}
/* Accounting: the policy (mileage rate per year, the receipt threshold, the submission window, categories). */
function XcPolicy({ meta, onSaved }) {
  const toast = useToast();
  const S0 = meta.settings;
  const [f, setF] = useState({ rates: Object.entries(S0.rates).map(([y, v]) => ({ y, v })), receipt: S0.receipt, days: S0.days, cats: S0.cats.map(c => ({ ...c })) });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api('xc_settings_save', { rates: Object.fromEntries(f.rates.filter(r => r.y).map(r => [r.y, +r.v])), receipt: +f.receipt, days: +f.days, cats: f.cats });
      toast('Expense policy saved.');
      onSaved();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const setCat = (i, patch) => setF({ ...f, cats: f.cats.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  return html`<section className="panel stack form">
      <div className="row3">
        <${Field} label="Receipt needed from (USD)" hint="$75 is the IRS threshold for an accountable plan"><input type="number" min="0" step="1" value=${f.receipt} onInput=${e => setF({ ...f, receipt: e.target.value })} /><//>
        <${Field} label="Claim within (days)" hint="60 days is the IRS safe harbor"><input type="number" min="1" max="365" value=${f.days} onInput=${e => setF({ ...f, days: e.target.value })} /><//>
      </div>
      <span className="lbl">Mileage rate (USD a mile)</span>
      <div className="actions">${f.rates.map((r, i) => html`<span key=${i} className="actions"><input value=${r.y} onInput=${e => setF({ ...f, rates: f.rates.map((x, j) => (j === i ? { ...x, y: e.target.value } : x)) })} style=${{ width: 70 }} aria-label="Year" /><input type="number" step="0.005" value=${r.v} onInput=${e => setF({ ...f, rates: f.rates.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)) })} style=${{ width: 90 }} aria-label="Rate" /></span>`)}<button type="button" className="btn ghost sm" onClick=${() => setF({ ...f, rates: [...f.rates, { y: String(new Date().getFullYear() + 1), v: '' }] })}>Add a year</button></div>
      <p className="muted small" style=${{ margin: 0 }}>The IRS standard rate is 70 cents for 2025 and 72.5 cents for 2026; add next year's when the IRS announces it (usually in December).</p>
      <span className="lbl">Categories</span>
      <table className="tbl small"><thead><tr><th>Category</th><th>Limit per line (0 = none)</th><th>Expense account in the books</th></tr></thead><tbody>${f.cats.map(
        (c, i) => html`<tr key=${i}><td><input value=${c.n} onInput=${e => setCat(i, { n: e.target.value })} /></td><td><input type="number" min="0" value=${c.limit} onInput=${e => setCat(i, { limit: e.target.value })} style=${{ maxWidth: 110 }} /></td><td><input value=${c.acct} onInput=${e => setCat(i, { acct: e.target.value })} /></td></tr>`
      )}</tbody></table>
      <div className="actions"><button type="button" className="btn ghost sm" onClick=${() => setF({ ...f, cats: [...f.cats, { k: '', n: '', limit: 0, acct: 'Other expenses' }] })}><${Icon} n="plus" />Add a category</button><button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save policy'}</button></div>
    </section>`;
}
