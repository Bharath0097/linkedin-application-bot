/* ================= Accounting: settings, recurring invoices, reminders, bank import and matching =================
   Settings live in org/acct/x/settings, recurring invoices in org/acct/recur, bank rows in org/acct/bank.
   The server side (api/acct.php) creates due recurring invoices and sends scheduled reminders from cron. */
const ACCT_DEFAULTS = {
  prefix: 'INV',
  cur: 'USD',
  curs: ['USD', 'INR'],
  terms: [
    { n: 'Due on receipt', d: 0 },
    { n: 'Net 15', d: 15 },
    { n: 'Net 30', d: 30 },
    { n: 'Net 45', d: 45 },
    { n: 'Net 60', d: 60 },
  ],
  lateFee: 0,
  methods: ['Bank transfer', 'ACH', 'Wire', 'Check', 'Card', 'UPI', 'Other'],
  banks: [],
  taxes: [],
  remind: [-3, 1, 7, 14, 30],
  remindAuto: false,
  remindCc: '',
  budgets: {},
  cash: 0,
};
const acctNorm = raw => {
  const s = raw || {};
  const out = { ...ACCT_DEFAULTS };
  Object.keys(ACCT_DEFAULTS).forEach(k => {
    const v = s[k];
    if (v == null || v === '') return;
    if (Array.isArray(ACCT_DEFAULTS[k])) {
      if (Array.isArray(v) && v.length) out[k] = v;
    } else if (typeof ACCT_DEFAULTS[k] === 'object') {
      if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = v;
    } else out[k] = v;
  });
  out.terms = out.terms.map(t => (typeof t === 'string' ? { n: t, d: +(t.match(/\d+/) || [0])[0] } : { n: String(t.n || ''), d: +t.d || 0 }));
  out.remind = [...new Set(out.remind.map(x => parseInt(x, 10)).filter(x => !isNaN(x)))].sort((a, b) => a - b);
  return out;
};
const useAcctSettings = () => {
  const d = useDoc('org/acct/x/settings');
  const S = useMemo(() => acctNorm(d.data), [d.data]);
  return { S, loading: d.loading };
};
const fmtPct = n => rtrimZero((+n || 0).toFixed(2)) + '%';
const rtrimZero = s => s.replace(/\.?0+$/, '');
const remindLabel = n => (n < 0 ? `${-n} day${n === -1 ? '' : 's'} before due` : n === 0 ? 'On the due date' : `${n} day${n === 1 ? '' : 's'} after due`);

/* ---- Accounting settings ---- */
function AcctSettingsPage() {
  const P = usePortal();
  const toast = useToast();
  const { S, loading } = useAcctSettings();
  const coa = useCoa();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState(null);
  const [nextN, setNextN] = useState('');
  const [ran, setRan] = useState(null);
  const [remindNew, setRemindNew] = useState('');
  useEffect(() => {
    if (!loading && !f) setF(JSON.parse(JSON.stringify(S)));
  }, [loading]);
  useEffect(() => {
    api('acct_next_peek')
      .then(r => {
        setNext(r);
        setNextN(String(r.n));
      })
      .catch(() => {});
  }, []);
  if (!f) return html`<${Spinner} onRetry=${() => Sync.kick(0)} />`;
  const up = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const rows = (k, blank) => ({
    list: f[k],
    set: (i, patch) => setF({ ...f, [k]: f[k].map((x, j) => (j === i ? { ...x, ...patch } : x)) }),
    add: () => setF({ ...f, [k]: [...f[k], { ...blank }] }),
    del: i => setF({ ...f, [k]: f[k].filter((_, j) => j !== i) }),
  });
  const terms = rows('terms', { n: '', d: 30 });
  const taxes = rows('taxes', { n: '', p: '' });
  const banks = rows('banks', { n: '', bank: '', last4: '', cur: f.cur, note: '' });
  const expCats = coa.filter(c => c.t === 'expense');
  const save = async () => {
    setBusy(true);
    try {
      const out = {
        ...f,
        prefix: String(f.prefix || '').replace(/[^A-Za-z0-9-]/g, '') || 'INV',
        lateFee: r2(f.lateFee),
        cash: r2(f.cash),
        terms: f.terms.filter(t => String(t.n).trim()).map(t => ({ n: String(t.n).trim(), d: Math.max(0, +t.d || 0) })),
        taxes: f.taxes.filter(t => String(t.n).trim()).map(t => ({ n: String(t.n).trim(), p: r2(t.p) })),
        banks: f.banks.filter(b => String(b.n).trim()).map(b => ({ n: String(b.n).trim(), bank: String(b.bank || '').trim(), last4: String(b.last4 || '').replace(/\D/g, '').slice(-4), cur: b.cur || f.cur, note: String(b.note || '').trim() })),
        remind: [...new Set(f.remind.map(x => parseInt(x, 10)).filter(x => !isNaN(x)))].sort((a, b) => a - b),
        remindCc: String(f.remindCc || '').trim(),
        budgets: Object.fromEntries(
          Object.entries(f.budgets || {})
            .filter(([, v]) => +v > 0)
            .map(([k, v]) => [k, r2(v)])
        ),
        u: Date.now(),
      };
      await dbSet('org/acct/x/settings', out);
      if (next && nextN !== '' && +nextN !== next.n && P.isAdmin) {
        const r = await api('acct_next_num', { n: +nextN });
        setNext({ next: r.next, n: +nextN });
      }
      toast('Accounting settings saved.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const runNow = async () => {
    setRan('…');
    try {
      const r = await api('acct_cron', {});
      setRan(`${r.recurring} recurring invoice${r.recurring === 1 ? '' : 's'} created, ${r.reminders} reminder${r.reminders === 1 ? '' : 's'} sent${r.reminders_tried > r.reminders ? ` (${r.reminders_tried - r.reminders} could not be emailed; see the invoice log)` : ''}${r.reminders_error ? ' (' + r.reminders_error + ')' : ''}.`);
    } catch (e) {
      setRan(errText(e));
    }
  };
  const addRemind = () => {
    const n = parseInt(remindNew, 10);
    if (isNaN(n)) return;
    if (!f.remind.includes(n)) setF({ ...f, remind: [...f.remind, n].sort((a, b) => a - b) });
    setRemindNew('');
  };
  const smallTbl = (head, body, onAdd, addLabel) => html`<div className="stack" style=${{ gap: 8 }}>
      <div className="tblwrap"><table className="tbl"><thead><tr>${head.map((h, i) => html`<th key=${i}>${h}</th>`)}<th /></tr></thead><tbody>${body}</tbody></table></div>
      <div><button type="button" className="btn ghost sm" onClick=${onAdd}><${Icon} n="plus" />${addLabel}</button></div>
    </div>`;
  return html`<div className="stack">
      <p className="muted small" style=${{ margin: 0 }}>The constants every accounting page uses: numbering, currencies, terms, payment methods, bank accounts, tax presets, reminder schedule and budgets. Changes apply to new records; what is already saved keeps its values.</p>
      <div className="g2" style=${{ alignItems: 'start' }}>
        <section className="panel stack">
          <h2 className="ph">Invoice numbering and currency</h2>
          <div className="form">
            <div className="row2">
              <${Field} label="Invoice prefix" hint=${'Numbers look like ' + (f.prefix || 'INV') + '-' + new Date().getFullYear() + '-0001.'}><input value=${f.prefix} onInput=${up('prefix')} /><//>
              <${Field} label="Next invoice number" hint=${next ? 'The next one issued will be ' + (next.n === +nextN ? next.next : (f.prefix || 'INV') + '-' + new Date().getFullYear() + '-' + String(+nextN || 1).padStart(4, '0')) + '.' : 'Counted per year.'}><input type="number" min="1" value=${nextN} onInput=${e => setNextN(e.target.value)} disabled=${!P.isAdmin} /><//>
            </div>
            <div className="row2">
              <${Field} label="Default currency"><select value=${f.cur} onChange=${up('cur')}>${f.curs.map(c => html`<option key=${c}>${c}</option>`)}</select><//>
              <${Field} label="Late fee, % per month" hint="Mentioned on overdue reminders when above zero."><input type="number" step="0.01" min="0" value=${f.lateFee} onInput=${up('lateFee')} /><//>
            </div>
            <${Field} label="Currencies"><${ListEditor} items=${f.curs} onChange=${v => setF({ ...f, curs: v.map(x => x.toUpperCase().slice(0, 3)) })} placeholder="e.g. CAD" /><//>
            <${Field} label="Cash on hand today" hint="Starting point for the cash-flow forecast under Accounting reports."><input type="number" step="0.01" value=${f.cash} onInput=${up('cash')} /><//>
          </div>
        </section>
        <section className="panel stack">
          <h2 className="ph">Payment terms</h2>
          <p className="muted small" style=${{ margin: 0 }}>Offered when an invoice or a recurring invoice is made; the days set the due date.</p>
          ${smallTbl(
            ['Name', 'Days'],
            terms.list.map((t, i) => html`<tr key=${i}><td><input value=${t.n} onInput=${e => terms.set(i, { n: e.target.value })} aria-label="Term name" /></td><td style=${{ width: 110 }}><input type="number" min="0" value=${t.d} onInput=${e => terms.set(i, { d: e.target.value })} aria-label="Days" /></td><td className="r"><button type="button" className="btn ghost sm icon" aria-label="Remove" onClick=${() => terms.del(i)}><${Icon} n="trash" /></button></td></tr>`),
            terms.add,
            'Add a term'
          )}
          <h2 className="ph" style=${{ marginTop: 6 }}>Payment methods</h2>
          <${ListEditor} items=${f.methods} onChange=${v => setF({ ...f, methods: v })} placeholder="e.g. Zelle" />
        </section>
        <section className="panel stack">
          <h2 className="ph">Bank accounts</h2>
          <p className="muted small" style=${{ margin: 0 }}>Named here so bank imports and payments can say which account they went through. Keep full account numbers out; the last four digits are enough.</p>
          ${smallTbl(
            ['Name', 'Bank', 'Last 4', 'Currency', 'Note'],
            banks.list.map((b, i) => html`<tr key=${i}><td><input value=${b.n} onInput=${e => banks.set(i, { n: e.target.value })} placeholder="Operating" aria-label="Account name" /></td><td><input value=${b.bank || ''} onInput=${e => banks.set(i, { bank: e.target.value })} placeholder="Chase" aria-label="Bank" /></td><td style=${{ width: 80 }}><input value=${b.last4 || ''} maxLength="4" onInput=${e => banks.set(i, { last4: e.target.value })} aria-label="Last four digits" /></td><td style=${{ width: 90 }}><select value=${b.cur || f.cur} onChange=${e => banks.set(i, { cur: e.target.value })} aria-label="Currency">${f.curs.map(c => html`<option key=${c}>${c}</option>`)}</select></td><td><input value=${b.note || ''} onInput=${e => banks.set(i, { note: e.target.value })} aria-label="Note" /></td><td className="r"><button type="button" className="btn ghost sm icon" aria-label="Remove" onClick=${() => banks.del(i)}><${Icon} n="trash" /></button></td></tr>`),
            banks.add,
            'Add an account'
          )}
          <h2 className="ph" style=${{ marginTop: 6 }}>Sales-tax presets</h2>
          <p className="muted small" style=${{ margin: 0 }}>Picked with one click on an invoice, e.g. Texas 8.25%, GST 18%.</p>
          ${smallTbl(
            ['Name', 'Rate %'],
            taxes.list.map((t, i) => html`<tr key=${i}><td><input value=${t.n} onInput=${e => taxes.set(i, { n: e.target.value })} aria-label="Tax name" /></td><td style=${{ width: 110 }}><input type="number" step="0.01" min="0" value=${t.p} onInput=${e => taxes.set(i, { p: e.target.value })} aria-label="Rate" /></td><td className="r"><button type="button" className="btn ghost sm icon" aria-label="Remove" onClick=${() => taxes.del(i)}><${Icon} n="trash" /></button></td></tr>`),
            taxes.add,
            'Add a preset'
          )}
        </section>
        <section className="panel stack">
          <h2 className="ph">Payment reminders</h2>
          <p className="muted small" style=${{ margin: 0 }}>Open invoices that were emailed get a reminder at each step below, once per step, when the scheduled job runs (the same cron entry that collects jobs and sends campaigns). You can always send one by hand from the invoice.</p>
          <div className="chips">
            ${f.remind.map(n => html`<span key=${n} className="chip pick">${remindLabel(n)}<button type="button" aria-label="Remove" onClick=${() => setF({ ...f, remind: f.remind.filter(x => x !== n) })}>×</button></span>`)}
          </div>
          <div className="actions" style=${{ flexWrap: 'nowrap', maxWidth: 420 }}>
            <input type="number" value=${remindNew} placeholder="Days after due (negative = before)" onInput=${e => setRemindNew(e.target.value)} onKeyDown=${e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addRemind();
              }
            }} />
            <button type="button" className="btn ghost sm" onClick=${addRemind}>Add step</button>
          </div>
          <label className="kcheck"><input type="checkbox" checked=${!!f.remindAuto} onChange=${up('remindAuto')} /><span>Send reminders automatically on this schedule</span></label>
          <${Field} label="Copy reminders to" hint="Optional, e.g. accounts@stratedgeitconsulting.com"><input type="email" value=${f.remindCc} onInput=${up('remindCc')} /><//>
          <div className="actions">
            <button type="button" className="btn ghost sm" onClick=${runNow}>Run the scheduled jobs now</button>
            ${ran && html`<span className="small muted">${ran}</span>`}
          </div>
        </section>
        <section className="panel stack" style=${{ gridColumn: '1 / -1' }}>
          <h2 className="ph">Monthly budgets by category</h2>
          <p className="muted small" style=${{ margin: 0 }}>In ${f.cur}. Compared with bills and expenses under Accounting reports › Budget vs actual. Categories come from the chart of accounts.</p>
          <div className="budgetgrid">
            ${expCats.map(c => html`<label key=${c.id} className="fld"><span>${c.n}</span><input type="number" step="0.01" min="0" value=${(f.budgets || {})[c.n] || ''} onInput=${e => setF({ ...f, budgets: { ...(f.budgets || {}), [c.n]: e.target.value } })} placeholder="0" /></label>`)}
          </div>
        </section>
      </div>
      <div className="actions">
        <button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save settings'}</button>
      </div>
    </div>`;
}

/* ---- Recurring invoices ---- */
const RECUR_EVERY = [
  ['week', 'Every week'],
  ['month', 'Every month'],
  ['quarter', 'Every quarter'],
  ['year', 'Every year'],
];
function RecurringList({ onOpenInvoice }) {
  const toast = useToast();
  const col = useCol('org/acct/recur', 'next:asc');
  const [edit, setEdit] = useState(undefined);
  const [busy, setBusy] = useState('');
  const today = dkey();
  const run = async t => {
    if (!confirm(`Create the next invoice for "${t.t}" now, dated ${fmtDate(t.next || today)}?`)) return;
    setBusy(t.id);
    try {
      const r = await api('acct_recur_run', { id: t.id });
      toast(`Draft invoice created; the next one is due ${fmtDate(r.next)}.`);
      onOpenInvoice && onOpenInvoice(r.id);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const toggle = async t => {
    try {
      await dbMerge(`org/acct/recur/${t.id}`, { st: t.st === 'paused' ? 'active' : 'paused', u: Date.now() });
      toast(t.st === 'paused' ? 'Resumed.' : 'Paused.');
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const total = t => invCalc(t.lines || [], t.taxp, t.disc).total;
  const monthly = col.docs.filter(t => (t.st || 'active') === 'active').reduce((a, t) => a + ((t.cur || 'USD') === 'USD' ? total(t) * (t.every === 'week' ? 4.33 : t.every === 'quarter' ? 1 / 3 : t.every === 'year' ? 1 / 12 : 1) : 0), 0);
  return html`<div className="stack">
      <div className="toolbar">
        <div className="muted small">${col.docs.length ? `${col.docs.filter(t => (t.st || 'active') === 'active').length} active · about ${fmtMoney(Math.round(monthly), 'USD')} a month in USD` : 'Invoices that repeat: retainers, monthly staffing, subscriptions.'}</div>
        <div className="push"><button type="button" className="btn" onClick=${() => setEdit(null)}><${Icon} n="plus" />New recurring invoice</button></div>
      </div>
      <section className="panel" style=${{ padding: '6px 8px' }}>
        ${
          col.loading
            ? html`<${Spinner} />`
            : col.docs.length
              ? html`<div className="tblwrap"><table className="tbl click"><thead><tr><th>Name</th><th>Billed to</th><th>Repeats</th><th>Next</th><th className="r">Amount</th><th>Status</th><th /></tr></thead><tbody>
                  ${col.docs.map(
                    t => html`<tr key=${t.id} onClick=${() => setEdit(t)} tabIndex="0" onKeyDown=${e => e.key === 'Enter' && setEdit(t)}>
                        <td><b style=${{ fontWeight: 600 }}>${t.t}</b><div className="muted small">${t.made ? `${t.made} created` + (t.last ? ', last ' + fmtDate(t.last) : '') : 'None created yet'}</div></td>
                        <td>${(t.bill || {}).co || '—'}<div className="muted small">${(t.bill || {}).e || ''}</div></td>
                        <td className="small">${(RECUR_EVERY.find(x => x[0] === t.every) || ['', 'Every month'])[1]}${t.every !== 'week' && t.day ? ', day ' + t.day : ''}</td>
                        <td className=${'num nw' + ((t.st || 'active') === 'active' && t.next && t.next <= today ? ' late' : '')}>${t.next ? fmtDate(t.next) : '—'}</td>
                        <td className="r num">${fmtMoney(total(t), t.cur || 'USD')}</td>
                        <td><${Chip} s=${(t.st || 'active') === 'active' ? 'ok' : t.st === 'done' ? '' : 'amber'}>${(t.st || 'active') === 'active' ? 'Active' : t.st === 'done' ? 'Finished' : 'Paused'}<//></td>
                        <td className="r" onClick=${e => e.stopPropagation()}><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          ${t.st !== 'done' && html`<button type="button" className="btn ghost sm" disabled=${busy === t.id} onClick=${() => run(t)}>${busy === t.id ? 'Creating…' : 'Create now'}</button>`}
                          ${t.st !== 'done' && html`<button type="button" className="btn ghost sm" onClick=${() => toggle(t)}>${t.st === 'paused' ? 'Resume' : 'Pause'}</button>`}
                        </div></td>
                      </tr>`
                  )}
                </tbody></table></div>`
              : html`<${Empty} title="No recurring invoices yet" action=${html`<button type="button" className="btn" onClick=${() => setEdit(null)}>Set one up</button>`}>A recurring invoice is a template with a schedule. On each date a draft is created with the next number, ready to check and send. Write {month} in a line to have the billing month filled in.<//>`
        }
      </section>
      ${edit !== undefined && html`<${RecurringForm} t=${edit} onClose=${() => setEdit(undefined)} />`}
    </div>`;
}
function RecurringForm({ t, onClose }) {
  const P = usePortal();
  const A = P.admin;
  const toast = useToast();
  const { S } = useAcctSettings();
  const today = dkey();
  const [f, setF] = useState(
    t
      ? { ...t, bill: { ...(t.bill || {}) }, lines: (t.lines || []).map(l => ({ ...l })) }
      : {
          t: '',
          cid: '',
          bill: { co: '', n: '', e: '', addr: '' },
          cur: S.cur,
          terms: (S.terms.find(x => x.d === 30) || S.terms[0] || { d: 30 }).d,
          lines: [{ d: 'Consulting services, {month}', q: 1, u: '' }],
          taxp: 0,
          disc: 0,
          notes: '',
          pay: ((P.settings && P.settings.inv) || {}).pay || '',
          every: 'month',
          day: 1,
          next: addDays(today.slice(0, 8) + '01', 32).slice(0, 8) + '01',
          until: '',
          st: 'active',
        }
  );
  const [busy, setBusy] = useState(false);
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const upB = k => e => setF({ ...f, bill: { ...f.bill, [k]: e.target.value } });
  const setLine = (i, k, v) => setF({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) });
  const pickClient = e => {
    const cid = e.target.value;
    const c = A && A.clientsById[cid];
    const contact = A && A.members.find(m => m.role === 'employer' && m.r && m.r.cid === cid);
    setF({ ...f, cid, bill: { ...f.bill, co: c ? c.n : f.bill.co, n: contact ? contact.u.p.n : f.bill.n, e: contact ? contact.u.p.e : f.bill.e, addr: c && c.loc ? c.loc : f.bill.addr } });
  };
  const calc = invCalc(f.lines, f.taxp, f.disc);
  const save = async () => {
    const lines = f.lines.filter(l => (l.d || '').trim() || +l.u).map(l => ({ d: (l.d || '').trim(), q: r2(l.q), u: r2(l.u) }));
    if (!f.t.trim()) {
      toast('Give the recurring invoice a name.', true);
      return;
    }
    if (!f.bill.co.trim()) {
      toast('Add who it is billed to.', true);
      return;
    }
    if (!lines.length) {
      toast('Add at least one line.', true);
      return;
    }
    if (!f.next) {
      toast('Set the next invoice date.', true);
      return;
    }
    setBusy(true);
    try {
      const now = Date.now();
      const doc = {
        t: f.t.trim(),
        cid: f.cid || '',
        bill: { co: f.bill.co.trim(), n: (f.bill.n || '').trim(), e: (f.bill.e || '').trim(), addr: (f.bill.addr || '').trim() },
        cur: f.cur,
        terms: +f.terms || 0,
        lines,
        taxp: r2(f.taxp),
        disc: r2(f.disc),
        notes: (f.notes || '').trim(),
        pay: (f.pay || '').trim(),
        every: f.every,
        day: f.every === 'week' ? 0 : Math.max(1, Math.min(28, +f.day || 1)),
        next: f.next,
        until: f.until || '',
        st: f.st || 'active',
        made: t ? t.made || 0 : 0,
        last: t ? t.last || '' : '',
        lastInv: t ? t.lastInv || '' : '',
        at: t ? t.at : now,
        by: t ? t.by : P.uid,
        u: now,
      };
      await dbSet(`org/acct/recur/${t ? t.id : nid()}`, doc);
      toast(t ? 'Recurring invoice saved.' : 'Recurring invoice set up.');
      onClose();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const del = async () => {
    if (!confirm(`Delete "${t.t}"? Invoices already created from it stay.`)) return;
    try {
      await dbDel(`org/acct/recur/${t.id}`);
      toast('Deleted.');
      onClose();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const M = n => fmtMoney(n, f.cur);
  return html`<${Modal} wide title=${t ? 'Edit recurring invoice' : 'New recurring invoice'} onClose=${onClose} foot=${html`${t && html`<button type="button" className="btn ghost danger" style=${{ marginRight: 'auto' }} onClick=${del}>Delete</button>`}<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save'}</button>`}>
      <div className="form">
        <div className="row3">
          <${Field} label="Name" hint="For your own list, e.g. Acme monthly retainer."><input value=${f.t} onInput=${up('t')} /><//>
          <${Field} label="Client workspace (optional)"><select value=${f.cid} onChange=${pickClient}><option value="">None</option>${((A && A.clients) || []).map(c => html`<option key=${c.id} value=${c.id}>${c.n}</option>`)}</select><//>
          <${Field} label="Currency"><select value=${f.cur} onChange=${up('cur')}>${S.curs.map(c => html`<option key=${c}>${c}</option>`)}</select><//>
        </div>
        <div className="row2">
          <${Field} label="Bill to (company)"><input value=${f.bill.co} onInput=${upB('co')} /><//>
          <${Field} label="Contact name"><input value=${f.bill.n || ''} onInput=${upB('n')} /><//>
        </div>
        <div className="row2">
          <${Field} label="Contact email" hint="Where each invoice will be sent."><input type="email" value=${f.bill.e || ''} onInput=${upB('e')} /><//>
          <${Field} label="Billing address"><textarea value=${f.bill.addr || ''} onInput=${upB('addr')} style=${{ minHeight: 60 }} /><//>
        </div>
        <div className="row3">
          <${Field} label="Repeats"><select value=${f.every} onChange=${up('every')}>${RECUR_EVERY.map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//>
          ${f.every !== 'week' && html`<${Field} label="On day of the month" hint="1 to 28."><input type="number" min="1" max="28" value=${f.day} onInput=${up('day')} /><//>`}
          <${Field} label="Next invoice date"><input type="date" value=${f.next} onInput=${up('next')} /><//>
          <${Field} label="Stop after (optional)"><input type="date" value=${f.until} onInput=${up('until')} /><//>
        </div>
        <div className="row3">
          <${Field} label="Payment terms"><select value=${String(f.terms)} onChange=${up('terms')}>${S.terms.map(x => html`<option key=${x.n} value=${x.d}>${x.n}</option>`)}${!S.terms.some(x => x.d === +f.terms) && html`<option value=${f.terms}>${f.terms} days</option>`}</select><//>
          <${Field} label="Tax %"><div className="actions" style=${{ flexWrap: 'nowrap' }}><input type="number" step="0.01" min="0" value=${f.taxp} onInput=${up('taxp')} />${S.taxes.length > 0 && html`<select value="" onChange=${e => e.target.value !== '' && setF({ ...f, taxp: +e.target.value })} aria-label="Tax preset"><option value="">Preset…</option>${S.taxes.map(x => html`<option key=${x.n} value=${x.p}>${x.n} (${fmtPct(x.p)})</option>`)}</select>`}</div><//>
          <${Field} label="Discount (amount)"><input type="number" step="0.01" min="0" value=${f.disc} onInput=${up('disc')} /><//>
        </div>
        <div>
          <span className="lbl">Lines <span className="muted small">({month}, {year} and {date} are filled in on each invoice)</span></span>
          <div className="invlines">
            ${f.lines.map(
              (l, i) => html`<div key=${i} className="invline">
                  <input value=${l.d} onInput=${e => setLine(i, 'd', e.target.value)} placeholder="Description" aria-label="Description" />
                  <input type="number" step="0.25" min="0" value=${l.q} onInput=${e => setLine(i, 'q', e.target.value)} aria-label="Quantity" />
                  <input type="number" step="0.01" min="0" value=${l.u} onInput=${e => setLine(i, 'u', e.target.value)} placeholder="Unit price" aria-label="Unit price" />
                  <span className="num r">${M((+l.q || 0) * (+l.u || 0))}</span>
                  <button type="button" className="btn ghost icon" aria-label="Remove line" onClick=${() => setF({ ...f, lines: f.lines.filter((_, j) => j !== i) })}><${Icon} n="trash" /></button>
                </div>`
            )}
          </div>
          <button type="button" className="btn ghost sm" style=${{ marginTop: 8 }} onClick=${() => setF({ ...f, lines: [...f.lines, { d: '', q: 1, u: '' }] })}><${Icon} n="plus" />Add line</button>
        </div>
        <div className="row2">
          <${Field} label="Notes (printed on each invoice)"><textarea value=${f.notes} onInput=${up('notes')} /><//>
          <${Field} label="Payment instructions"><textarea value=${f.pay} onInput=${up('pay')} /><//>
        </div>
        <p className="muted small" style=${{ margin: 0 }}>Each invoice: ${M(calc.total)}${calc.tax ? ` including ${M(calc.tax)} tax` : ''}. Created as a draft on the date above; you check it and send it, or let it sit.</p>
      </div>
    <//>`;
}

/* ---- Bank statement import and matching ---- */
const bankNum = s => {
  if (s == null) return NaN;
  let t = String(s).trim();
  if (t === '') return NaN;
  const neg = /^\(.*\)$/.test(t) || /^-/.test(t) || /-$/.test(t) || /\bDR\b/i.test(t);
  t = t.replace(/[^0-9.,]/g, '');
  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (t.includes(',')) t = /,\d{2}$/.test(t) && !/,\d{3}$/.test(t) ? t.replace(',', '.') : t.replace(/,/g, '');
  const n = parseFloat(t);
  return isNaN(n) ? NaN : neg ? -Math.abs(n) : n;
};
const bankDate = (s, fmt) => {
  const t = String(s || '').trim();
  let m;
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/))) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return fmt === 'dmy' ? `${y}-${pad(m[2])}-${pad(m[1])}` : `${y}-${pad(m[1])}-${pad(m[2])}`;
  }
  const d = new Date(t);
  return isNaN(d) ? '' : dkey(d);
};
const BANK_GUESS = {
  dt: /^(date|posted|post date|transaction date|txn date|value date|booking date)$/i,
  desc: /^(description|narrative|details|memo|payee|name|transaction|particulars|remarks)$/i,
  a: /^(amount|transaction amount|amt)$/i,
  cr: /^(credit|deposit|deposits|credits|money in|paid in|inflow|cr)$/i,
  dr: /^(debit|withdrawal|withdrawals|debits|money out|paid out|outflow|dr)$/i,
  ref: /^(reference|ref|ref no|cheque no|check no|check number|transaction id|id|utr)$/i,
  bal: /^(balance|running balance|closing balance)$/i,
};
/* OFX / QFX / QBO statements (Open Financial Exchange, SGML or XML flavour): one <STMTTRN> per transaction with
   the bank's own id (FITID), so the same statement can be imported twice without duplicates. */
function parseOfx(text) {
  const t = String(text || '');
  const tag = (src, name) => {
    const m = src.match(new RegExp('<' + name + '>([^<\\r\\n]*)', 'i'));
    return m ? m[1].trim() : '';
  };
  const date = s => {
    const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
  };
  const cur = tag(t, 'CURDEF') || 'USD';
  const acctId = tag(t, 'ACCTID');
  const bankId = tag(t, 'BANKID');
  const acctType = tag(t, 'ACCTTYPE') || (/<CCSTMTRS>/i.test(t) ? 'CREDITCARD' : '');
  const org = tag(t, 'ORG');
  const ledger = (t.match(/<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]*)/i) || [])[1];
  const rows = [];
  const re = /<STMTTRN>([\s\S]*?)(?=<STMTTRN>|<\/STMTTRN>|<\/BANKTRANLIST>|<\/CCSTMTRS>|$)/gi;
  let m;
  while ((m = re.exec(t))) {
    const b = m[1];
    const a = parseFloat(String(tag(b, 'TRNAMT')).replace(/,/g, ''));
    const dt = date(tag(b, 'DTPOSTED')) || date(tag(b, 'DTUSER'));
    if (!dt || isNaN(a) || a === 0) continue;
    const name = tag(b, 'NAME') || tag(b, 'PAYEE');
    const memo = tag(b, 'MEMO');
    rows.push({ dt, a: r2(a), desc: [name, memo].filter(Boolean).join(' · ').slice(0, 300) || tag(b, 'TRNTYPE') || 'Transaction', payee: name.slice(0, 120), ref: (tag(b, 'CHECKNUM') || tag(b, 'REFNUM')).slice(0, 120), fitid: tag(b, 'FITID').slice(0, 120), type: tag(b, 'TRNTYPE'), cur });
  }
  rows.sort((x, y) => (x.dt < y.dt ? -1 : x.dt > y.dt ? 1 : 0));
  const label = [org, acctType === 'CREDITCARD' ? 'Credit card' : acctType ? acctType.charAt(0) + acctType.slice(1).toLowerCase() : '', acctId ? '••' + acctId.slice(-4) : ''].filter(Boolean).join(' ');
  return { rows, cur, acctId, bankId, acctType, org, label, ledger: ledger !== undefined ? parseFloat(ledger) : null, from: rows.length ? rows[0].dt : '', to: rows.length ? rows[rows.length - 1].dt : '' };
}
const isOfxFile = f => /\.(ofx|qfx|qbo)$/i.test(f.name) || /ofx|qfx|qbo/i.test(f.type || '');
function OfxImportModal({ file, acct, onClose, onDone }) {
  const toast = useToast();
  const [p, setP] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    file.text().then(text => {
      const parsed = parseOfx(text);
      if (!parsed.rows.length) {
        toast('No transactions were found in that file. Export the statement again as OFX, QFX or QBO.', true);
        onClose();
        return;
      }
      setP(parsed);
      setName(acct || parsed.label || file.name.replace(/\.[^.]+$/, ''));
    });
  }, []);
  if (!p) return html`<${Modal} title="Reading the file" onClose=${onClose}><${Spinner} /><//>`;
  const imp = async () => {
    setBusy(true);
    try {
      const r = await api('acct_bank_import', { rows: p.rows, acct: name.trim(), src: file.name });
      toast(`${r.added} transaction${r.added === 1 ? '' : 's'} imported${r.skipped ? `, ${r.skipped} already there` : ''}.`);
      onDone();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const inflow = p.rows.filter(r => r.a > 0).reduce((a, r) => a + r.a, 0);
  const outflow = p.rows.filter(r => r.a < 0).reduce((a, r) => a + r.a, 0);
  return html`<${Modal} wide title=${'Import ' + file.name} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy || !name.trim()} onClick=${imp}>${busy ? 'Importing…' : `Import ${p.rows.length} transaction${p.rows.length === 1 ? '' : 's'}`}</button>`}>
      <div className="form">
        <${KitStats} items=${[{ v: p.rows.length, l: `Transactions · ${fmtDate(p.from)} – ${fmtDate(p.to)}` }, { v: fmtMoney(inflow, p.cur), l: 'Money in' }, { v: fmtMoney(Math.abs(outflow), p.cur), l: 'Money out' }, { v: p.ledger != null ? fmtMoney(p.ledger, p.cur) : '—', l: 'Statement balance' }]} />
        <${Field} label="Bank account name" hint="Lines from the same account should always use the same name; Books > Settings maps it to a ledger account."><input value=${name} onInput=${e => setName(e.target.value)} list="ofx-accts" /><//>
        <p className="muted small" style=${{ margin: 0 }}>${p.org ? p.org + ' · ' : ''}${p.acctType ? p.acctType.toLowerCase() + ' · ' : ''}${p.cur}. Each transaction carries the bank’s own id, so importing this statement again adds nothing twice.</p>
        <div className="tblwrap"><table className="tbl small"><thead><tr><th>Date</th><th>Description</th><th>Type</th><th className="r">Amount</th></tr></thead><tbody>
          ${p.rows.slice(0, 8).map((x, i) => html`<tr key=${i}><td className="nw">${fmtDate(x.dt)}</td><td>${x.desc.slice(0, 80)}</td><td className="muted">${x.type}</td><td className=${'r num' + (x.a < 0 ? ' late' : '')}>${x.a.toFixed(2)}</td></tr>`)}
          ${p.rows.length > 8 && html`<tr><td colSpan="4" className="muted small">… and ${p.rows.length - 8} more</td></tr>`}
        </tbody></table></div>
      </div>
    <//>`;
}
function BankMapModal({ file, acct, onClose, onDone }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [map, setMap] = useState({ dt: '', desc: '', a: '', cr: '', dr: '', ref: '', bal: '', fmt: 'mdy', flip: false });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    file.text().then(text => {
      const all = parseCSV(text).filter(r => r.some(c => String(c).trim() !== ''));
      if (all.length < 2) {
        toast('That file has no rows.', true);
        onClose();
        return;
      }
      const head = all[0].map(h => String(h).trim());
      const m = { ...map };
      Object.entries(BANK_GUESS).forEach(([k, re]) => {
        const i = head.findIndex(h => re.test(h));
        if (i >= 0 && !Object.values(m).includes(String(i))) m[k] = String(i);
      });
      if (m.desc === '') m.desc = String(head.findIndex(h => /desc|memo|detail|narr/i.test(h)) >= 0 ? head.findIndex(h => /desc|memo|detail|narr/i.test(h)) : '');
      // dd/mm or mm/dd: look for a day above 12 in the first position
      const sample = all.slice(1, 40).map(r => String(r[+m.dt] || ''));
      if (sample.some(s => /^(1[3-9]|2\d|3[01])[\/.-]/.test(s))) m.fmt = 'dmy';
      setMap(m);
      setRows({ head, body: all.slice(1) });
    });
  }, []);
  if (!rows) return html`<${Modal} title="Reading the file" onClose=${onClose}><${Spinner} /><//>`;
  const col = (r, k) => (map[k] === '' ? '' : r[+map[k]]);
  const build = r => {
    let a = map.a !== '' ? bankNum(col(r, 'a')) : NaN;
    if (isNaN(a)) {
      const cr = map.cr !== '' ? bankNum(col(r, 'cr')) : NaN;
      const dr = map.dr !== '' ? bankNum(col(r, 'dr')) : NaN;
      a = !isNaN(cr) && cr !== 0 ? Math.abs(cr) : !isNaN(dr) && dr !== 0 ? -Math.abs(dr) : NaN;
    }
    if (map.flip && !isNaN(a)) a = -a;
    const bal = map.bal !== '' ? bankNum(col(r, 'bal')) : NaN;
    return { dt: bankDate(col(r, 'dt'), map.fmt), desc: String(col(r, 'desc') || '').trim(), a: isNaN(a) ? 0 : r2(a), ref: String(col(r, 'ref') || '').trim(), bal: isNaN(bal) ? undefined : r2(bal) };
  };
  const built = rows.body.map(build);
  const good = built.filter(x => x.dt && x.a);
  const imp = async () => {
    if (!good.length) {
      toast('No rows with a date and an amount; check the column choices.', true);
      return;
    }
    setBusy(true);
    try {
      const r = await api('acct_bank_import', { rows: good, acct, src: file.name });
      toast(`${r.added} row${r.added === 1 ? '' : 's'} imported${r.skipped ? `, ${r.skipped} already there or unreadable` : ''}.`);
      onDone();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const pick = (k, label, hint) => html`<${Field} label=${label} hint=${hint}><select value=${map[k]} onChange=${e => setMap({ ...map, [k]: e.target.value })}><option value="">—</option>${rows.head.map((h, i) => html`<option key=${i} value=${String(i)}>${h || 'Column ' + (i + 1)}</option>`)}</select><//>`;
  return html`<${Modal} wide title=${'Import ' + file.name} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy || !good.length} onClick=${imp}>${busy ? 'Importing…' : `Import ${good.length} row${good.length === 1 ? '' : 's'}`}</button>`}>
      <div className="form">
        <p className="muted small" style=${{ margin: 0 }}>${rows.body.length} rows found. Columns were guessed from the headings; fix any that are wrong. Money in should come out positive, money out negative.</p>
        <div className="row3">
          ${pick('dt', 'Date')}
          ${pick('desc', 'Description')}
          ${pick('ref', 'Reference (optional)')}
        </div>
        <div className="row3">
          ${pick('a', 'Amount (one signed column)')}
          ${pick('cr', 'Money in (if separate)')}
          ${pick('dr', 'Money out (if separate)')}
        </div>
        <div className="row3">
          ${pick('bal', 'Balance (optional)')}
          <${Field} label="Date format"><select value=${map.fmt} onChange=${e => setMap({ ...map, fmt: e.target.value })}><option value="mdy">Month/day/year (US)</option><option value="dmy">Day/month/year</option></select><//>
          <label className="kcheck" style=${{ alignSelf: 'end', paddingBottom: 10 }}><input type="checkbox" checked=${map.flip} onChange=${e => setMap({ ...map, flip: e.target.checked })} /><span>Signs are the other way round</span></label>
        </div>
        <div className="tblwrap"><table className="tbl"><thead><tr><th>Date</th><th>Description</th><th>Reference</th><th className="r">Amount</th></tr></thead><tbody>
          ${built.slice(0, 6).map((x, i) => html`<tr key=${i} className=${!x.dt || !x.a ? 'muted' : ''}><td className="nw">${x.dt || html`<span className="late">no date</span>`}</td><td className="small">${x.desc.slice(0, 70)}</td><td className="small">${x.ref}</td><td className=${'r num' + (x.a < 0 ? ' late' : '')}>${x.a ? x.a.toFixed(2) : html`<span className="late">no amount</span>`}</td></tr>`)}
        </tbody></table></div>
      </div>
    <//>`;
}
/* What a bank row most likely is: an invoice with that balance or number, or a bill with that amount or vendor. */
function bankSuggest(row, invs, exps) {
  const a = +row.a || 0;
  const desc = (row.desc + ' ' + row.ref).toLowerCase();
  const near = (x, y) => Math.abs(x - y) < 0.011;
  if (a > 0) {
    const open = invs.filter(d => ['sent', 'viewed', 'part'].includes(d.st) && (d.cur || 'USD') === (row.cur || 'USD'));
    const byNum = open.find(d => d.num && desc.includes(String(d.num).toLowerCase()));
    if (byNum) return { k: 'inv', d: byNum, why: 'invoice number in the description' };
    const byAmt = open.filter(d => near(invBalance(d), a) || near(+d.total || 0, a));
    if (byAmt.length === 1) return { k: 'inv', d: byAmt[0], why: 'same amount' };
    const byName = open.filter(d => d.bill && d.bill.co && desc.includes(String(d.bill.co).toLowerCase().split(/\s+/)[0]) && String(d.bill.co).length > 3);
    if (byAmt.length > 1) {
      const both = byAmt.filter(d => byName.includes(d));
      if (both.length === 1) return { k: 'inv', d: both[0], why: 'same amount and client name' };
      return { k: 'inv', d: byAmt[0], why: 'same amount (several match)', many: byAmt };
    }
    if (byName.length === 1) return { k: 'inv', d: byName[0], why: 'client name in the description', partial: !near(invBalance(byName[0]), a) };
    return null;
  }
  const unpaid = exps.filter(x => x.st === 'unpaid' && (x.cur || 'USD') === (row.cur || 'USD'));
  const byAmt = unpaid.filter(x => near(+x.a || 0, -a));
  const byVendor = unpaid.filter(x => x.v && String(x.v).length > 3 && desc.includes(String(x.v).toLowerCase().split(/\s+/)[0]));
  if (byAmt.length === 1) return { k: 'exp', d: byAmt[0], why: 'same amount' };
  if (byAmt.length > 1) {
    const both = byAmt.filter(x => byVendor.includes(x));
    return { k: 'exp', d: (both[0] || byAmt[0]), why: both.length ? 'same amount and vendor' : 'same amount (several match)', many: byAmt };
  }
  if (byVendor.length === 1) return { k: 'exp', d: byVendor[0], why: 'vendor name in the description', partial: true };
  return null;
}
function BankImportPage() {
  const P = usePortal();
  const toast = useToast();
  const { S } = useAcctSettings();
  const rows = useCol('org/acct/bank', 'dt:desc');
  const inv = useCol('inv', 'u:desc');
  const exp = useCol('exp', 'u:desc');
  const [acct, setAcct] = useState('');
  const [file, setFile] = useState(null);
  const [tab, setTab] = useState('open');
  const [q, setQ] = useState('');
  const [pick, setPick] = useState(null); // {row, k}
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();
  const today = dkey();
  const list = rows.docs.filter(r => (tab === 'all' || (tab === 'open' ? !r.m : !!r.m)) && (!acct || r.acct === acct) && (!q || (r.desc + ' ' + r.ref).toLowerCase().includes(q.toLowerCase())));
  const openCount = rows.docs.filter(r => !r.m).length;
  // v83: the server adds the payment under its write lock (two quick matches, or two people, no longer overwrite each other)
  const matchInv = async (row, d, note) => {
    const r = await api('acct_bank_match', { row: row.id, inv: d.id, note: note || '' });
    Sync.kick();
    toast(r.st === 'paid' ? `${r.num} marked paid.` : `Part payment recorded on ${r.num}.`);
  };
  const matchExp = async (row, x) => {
    const now = Date.now();
    await dbMerge(`exp/${x.id}`, { st: 'paid', paidAt: now, paidOn: row.dt, m: 'Bank transfer', ref: x.ref || row.ref || '', u: now });
    await dbMerge(`org/acct/bank/${row.id}`, { m: { k: 'exp', id: x.id, n: x.v, at: now }, u: now });
    toast(`${x.v} marked paid.`);
  };
  const matchOther = async (row, what) => {
    const now = Date.now();
    await dbMerge(`org/acct/bank/${row.id}`, { m: { k: 'other', n: what, at: now }, u: now });
  };
  const unmatch = async row => {
    if (!confirm('Forget this match? The invoice or bill keeps its payment; only the link is removed.')) return;
    await dbMerge(`org/acct/bank/${row.id}`, { m: null, u: Date.now() });
  };
  const del = async row => {
    if (!confirm('Delete this bank row?')) return;
    await dbDel(`org/acct/bank/${row.id}`);
  };
  // one match at a time: the buttons wait until the last one is saved
  const busyRef = useRef(false);
  const act = fn => async (...a) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await fn(...a);
    } catch (e) {
      toast(errText(e), true);
    }
    busyRef.current = false;
    setBusy(false);
  };
  const exportCsv = async () => {
    try {
      await saveDownload(`bank-rows-${today}.csv`, toCSV([['Date', 'Description', 'Reference', 'Amount', 'Currency', 'Account', 'Matched to'], ...list.map(r => [r.dt, r.desc, r.ref, r.a, r.cur, r.acct, r.m ? (r.m.k === 'inv' ? 'Invoice ' : r.m.k === 'exp' ? 'Bill ' : '') + (r.m.n || '') : ''])]));
    } catch (e) {
      if (!e || e.code !== 'declined') toast(errText(e), true);
    }
  };
  const accounts = [...new Set([...S.banks.map(b => b.n), ...rows.docs.map(r => r.acct).filter(Boolean)])];
  const sumIn = list.filter(r => r.a > 0).reduce((a, r) => a + r.a, 0);
  const sumOut = list.filter(r => r.a < 0).reduce((a, r) => a + r.a, 0);
  return html`<div className="stack">
      <${KitStats} items=${[
        { v: openCount, l: 'Rows to match', tone: openCount ? 'warn' : '', onClick: () => setTab('open') },
        { v: rows.docs.filter(r => r.m).length, l: 'Matched', onClick: () => setTab('done') },
        { v: fmtMoney(sumIn, 'USD'), l: 'Money in (rows shown)' },
        { v: fmtMoney(-sumOut, 'USD'), l: 'Money out (rows shown)' },
      ]} />
      <div className="toolbar">
        <${KitTabs} tab=${tab} onTab=${setTab} tabs=${[
          ['open', 'To match', openCount],
          ['done', 'Matched'],
          ['all', 'All'],
        ]} />
        <select value=${acct} onChange=${e => setAcct(e.target.value)} aria-label="Bank account"><option value="">All accounts</option>${accounts.map(a => html`<option key=${a}>${a}</option>`)}</select>
        <input type="search" style=${{ maxWidth: 220 }} placeholder="Search descriptions" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search" />
        <div className="push">
          <button type="button" className="btn ghost" disabled=${!list.length} onClick=${exportCsv}><${Icon} n="down" />CSV</button>
          <input ref=${fileRef} type="file" accept=".csv,.txt,.ofx,.qfx,.qbo,text/csv,application/x-ofx" style=${{ display: 'none' }} onChange=${e => {
            if (e.target.files[0]) setFile(e.target.files[0]);
            e.target.value = '';
          }} />
          <button type="button" className="btn" onClick=${() => fileRef.current.click()}><${Icon} n="up" />Import a statement</button>
          <a className="btn ghost" href="#/portal/admin/books?tab=connect" title="Connect a bank for an automatic feed">Connect a bank</a>
        </div>
      </div>
      <section className="panel" style=${{ padding: '6px 8px' }}>
        ${
          rows.loading
            ? html`<${Spinner} />`
            : list.length
              ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Date</th><th>Description</th><th className="r">Amount</th><th>Looks like</th><th /></tr></thead><tbody>
                  ${list.slice(0, 300).map(r => {
                    const s = r.m ? null : bankSuggest(r, inv.docs, exp.docs);
                    return html`<tr key=${r.id}>
                        <td className="nw small">${fmtDate(r.dt)}${r.acct ? html`<div className="muted small">${r.acct}</div>` : null}</td>
                        <td><div style=${{ fontWeight: 500 }}>${r.desc || '—'}</div>${r.ref && html`<div className="muted small">Ref ${r.ref}</div>`}</td>
                        <td className=${'r num nw' + (r.a < 0 ? ' late' : '')}>${r.a < 0 ? '−' : '+'}${fmtMoney(Math.abs(r.a), r.cur || 'USD')}</td>
                        <td className="small">
                          ${
                            r.m
                              ? html`<${Chip} s="ok">${r.m.k === 'inv' ? 'Invoice ' + r.m.n : r.m.k === 'exp' ? 'Bill: ' + r.m.n : r.m.n || 'Other'}<//>`
                              : s
                                ? html`<div>${s.k === 'inv' ? html`Invoice <b>${s.d.num}</b>, ${s.d.bill.co} · balance ${fmtMoney(invBalance(s.d), s.d.cur)}` : html`Bill from <b>${s.d.v}</b> · ${fmtMoney(s.d.a, s.d.cur)}${s.d.due ? ', due ' + fmtDate(s.d.due) : ''}`}<div className="muted small">${s.why}${s.partial ? ' · amount differs' : ''}</div></div>`
                                : html`<span className="muted">No open invoice or bill matches</span>`
                          }
                        </td>
                        <td className="r"><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          ${
                            r.m
                              ? html`<button type="button" className="btn ghost sm" disabled=${busy} onClick=${() => act(unmatch)(r)}>Unmatch</button>`
                              : html`${s && html`<button type="button" className="btn go sm" disabled=${busy} onClick=${() => (s.k === 'inv' ? act(matchInv)(r, s.d) : act(matchExp)(r, s.d))}>Match</button>`}
                                  <button type="button" className="btn ghost sm" onClick=${() => setPick({ row: r })}>Choose…</button>`
                          }
                          <button type="button" className="btn ghost sm icon" aria-label="Delete row" disabled=${busy} onClick=${() => act(del)(r)}><${Icon} n="trash" /></button>
                        </div></td>
                      </tr>`;
                  })}
                </tbody></table></div>`
              : html`<${Empty} title=${tab === 'open' ? (rows.docs.length ? 'Everything is matched' : 'No bank rows yet') : 'Nothing here'} action=${html`<button type="button" className="btn" onClick=${() => fileRef.current.click()}>Import a statement</button>`}>Download a CSV from your bank, import it here, and each deposit or payment is matched to an open invoice or bill. One click records the payment; the rest you can mark as other.<//>`
        }
      </section>
      ${file && html`<${isOfxFile(file) ? OfxImportModal : BankMapModal} file=${file} acct=${acct} onClose=${() => setFile(null)} onDone=${() => {
        setFile(null);
        setTab('open');
      }} />`}
      <datalist id="ofx-accts">${accounts.map(a => html`<option key=${a} value=${a} />`)}</datalist>
      ${pick && html`<${BankPick} row=${pick.row} invs=${inv.docs} exps=${exp.docs} onClose=${() => setPick(null)} onInv=${d => act(matchInv)(pick.row, d).then(() => setPick(null))} onExp=${x => act(matchExp)(pick.row, x).then(() => setPick(null))} onOther=${w => act(matchOther)(pick.row, w).then(() => setPick(null))} />`}
    </div>`;
}
function BankPick({ row, invs, exps, onClose, onInv, onExp, onOther }) {
  const [q, setQ] = useState('');
  const [other, setOther] = useState('');
  const ql = q.toLowerCase();
  const credit = row.a > 0;
  const cands = credit
    ? invs.filter(d => ['sent', 'viewed', 'part'].includes(d.st) && (!ql || (d.num + ' ' + d.bill.co).toLowerCase().includes(ql)))
    : exps.filter(x => x.st === 'unpaid' && (!ql || (x.v + ' ' + x.cat).toLowerCase().includes(ql)));
  const OTHERS = credit ? ['Transfer between accounts', 'Interest', 'Refund received', 'Owner contribution', 'Other income'] : ['Transfer between accounts', 'Payroll', 'Bank fee', 'Tax payment', 'Owner draw', 'Already recorded'];
  return html`<${Modal} title=${`${fmtDate(row.dt)} · ${row.a < 0 ? '−' : '+'}${fmtMoney(Math.abs(row.a), row.cur || 'USD')}`} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button>`}>
      <div className="stack">
        <p className="muted small" style=${{ margin: 0 }}>${row.desc}</p>
        <input type="search" placeholder=${credit ? 'Find an open invoice' : 'Find an unpaid bill'} value=${q} onInput=${e => setQ(e.target.value)} />
        <div className="tblwrap" style=${{ maxHeight: 280, overflow: 'auto' }}>
          ${
            cands.length
              ? html`<table className="tbl click"><tbody>
                  ${cands.slice(0, 40).map(
                    d => html`<tr key=${d.id} onClick=${() => (credit ? onInv(d) : onExp(d))} tabIndex="0">
                        <td>${credit ? html`<b style=${{ fontWeight: 600 }}>${d.num}</b> ${d.bill.co}` : html`<b style=${{ fontWeight: 600 }}>${d.v}</b> <span className="muted small">${d.cat}</span>`}</td>
                        <td className="r num nw">${credit ? fmtMoney(invBalance(d), d.cur) : fmtMoney(d.a, d.cur)}</td>
                      </tr>`
                  )}
                </tbody></table>`
              : html`<p className="muted small">${credit ? 'No open invoices.' : 'No unpaid bills.'}</p>`
          }
        </div>
        <div>
          <span className="lbl">Or mark it as</span>
          <div className="chips">${OTHERS.map(w => html`<button key=${w} type="button" className="chip pick" onClick=${() => onOther(w)}>${w}</button>`)}</div>
          <div className="actions" style=${{ marginTop: 8, flexWrap: 'nowrap' }}><input value=${other} placeholder="Something else" onInput=${e => setOther(e.target.value)} /><button type="button" className="btn ghost sm" disabled=${!other.trim()} onClick=${() => onOther(other.trim())}>Mark</button></div>
        </div>
      </div>
    <//>`;
}

/* ---- Extra reports: cash-flow forecast, budget vs actual, vendor yearly totals ---- */
function CashForecast({ inv, exp, runs, recur, S, cur }) {
  const today = dkey();
  const buckets = [
    ['Overdue / now', today, today],
    ['Next 30 days', addDays(today, 1), addDays(today, 30)],
    ['31 to 60 days', addDays(today, 31), addDays(today, 60)],
    ['61 to 90 days', addDays(today, 61), addDays(today, 90)],
  ];
  const inB = (d, [, a, b], first) => (first ? !d || d <= b : d >= a && d <= b);
  const open = inv.filter(d => ['sent', 'viewed', 'part'].includes(d.st) && (d.cur || 'USD') === cur);
  const bills = exp.filter(x => x.st === 'unpaid' && (x.cur || 'USD') === cur);
  const lastRuns = runs.filter(r => (r.totals || {})[cur]).sort((a, b) => (b.mk > a.mk ? 1 : -1)).slice(0, 3);
  const payrollMonthly = lastRuns.length ? lastRuns.reduce((a, r) => a + (r.totals[cur].cost || 0), 0) / lastRuns.length : 0;
  const recurIn = (a, b) => recur.filter(t => (t.st || 'active') === 'active' && (t.cur || 'USD') === cur && t.next && t.next >= a && t.next <= b).reduce((s, t) => s + invCalc(t.lines || [], t.taxp, t.disc).total, 0);
  let bal = +S.cash || 0;
  const rows = buckets.map((bk, i) => {
    const ar = open.filter(d => inB(d.due, bk, i === 0)).reduce((a, d) => a + invBalance(d), 0);
    const rec = i === 0 ? 0 : recurIn(bk[1], bk[2]);
    const ap = bills.filter(x => inB(x.due || x.d, bk, i === 0)).reduce((a, x) => a + (+x.a || 0), 0);
    const pay = i === 0 ? 0 : payrollMonthly;
    const net = ar + rec - ap - pay;
    bal += net;
    return { n: bk[0], ar, rec, ap, pay, net, bal, cnt: open.filter(d => inB(d.due, bk, i === 0)).length };
  });
  const M = n => fmtMoney(n, cur);
  return html`<section className="panel stack">
      <div>
        <h2 className="ph">Cash-flow forecast, next 90 days (${cur})</h2>
        <p className="muted small" style=${{ margin: 0 }}>Receivables by due date, recurring invoices on their next dates, unpaid bills, and payroll at the average of the last ${lastRuns.length || 'few'} run${lastRuns.length === 1 ? '' : 's'} (${M(payrollMonthly)} a month). Starts from the cash on hand set under Accounting settings (${M(+S.cash || 0)}).</p>
      </div>
      <div className="tblwrap"><table className="tbl"><thead><tr><th>Period</th><th className="r">Invoices due</th><th className="r">Recurring</th><th className="r">Bills due</th><th className="r">Payroll</th><th className="r">Net</th><th className="r">Cash after</th></tr></thead><tbody>
        ${rows.map(r => html`<tr key=${r.n}><td><b>${r.n}</b>${r.cnt ? html`<div className="muted small">${r.cnt} invoice${r.cnt === 1 ? '' : 's'}</div>` : null}</td><td className="r num">${M(r.ar)}</td><td className="r num">${r.rec ? M(r.rec) : '—'}</td><td className="r num late">${r.ap ? '−' + M(r.ap) : '—'}</td><td className="r num late">${r.pay ? '−' + M(r.pay) : '—'}</td><td className=${'r num' + (r.net < 0 ? ' late' : '')}><b>${(r.net < 0 ? '−' : '') + M(Math.abs(r.net))}</b></td><td className="r num"><b style=${{ color: r.bal < 0 ? 'var(--red-ink)' : 'inherit' }}>${(r.bal < 0 ? '−' : '') + M(Math.abs(r.bal))}</b></td></tr>`)}
      </tbody></table></div>
      ${rows.some(r => r.bal < 0) && html`<p className="note amber small" style=${{ margin: 0 }}>Cash goes negative in one of the periods. Chase the overdue invoices first, or push some bills out.</p>`}
    </section>`;
}
function BudgetReport({ exp, S, cur, a, b, coa }) {
  const months = Math.max(1, (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7)) + 1);
  const actual = {};
  exp.filter(x => (x.cur || 'USD') === cur && x.d >= a && x.d <= b).forEach(x => {
    actual[x.cat] = (actual[x.cat] || 0) + (+x.a || 0);
  });
  const cats = [...new Set([...coa.filter(c => c.t === 'expense').map(c => c.n), ...Object.keys(actual), ...Object.keys(S.budgets || {})])];
  const rows = cats
    .map(c => ({ c, budget: (+(S.budgets || {})[c] || 0) * months, actual: actual[c] || 0 }))
    .filter(r => r.budget || r.actual)
    .sort((x, y) => y.actual - x.actual);
  const tb = rows.reduce((s, r) => s + r.budget, 0);
  const ta = rows.reduce((s, r) => s + r.actual, 0);
  const M = n => fmtMoney(n, cur);
  return html`<section className="panel stack">
      <div>
        <h2 className="ph">Budget vs actual, ${fmtDate(a)} to ${fmtDate(b)} (${cur})</h2>
        <p className="muted small" style=${{ margin: 0 }}>Monthly budgets from Accounting settings × ${months} month${months === 1 ? '' : 's'}, against bills and expenses by category.</p>
      </div>
      ${
        rows.length
          ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Category</th><th className="r">Budget</th><th className="r">Actual</th><th className="r">Left</th><th style=${{ width: '30%' }}>Used</th></tr></thead><tbody>
              ${rows.map(r => {
                const pct = r.budget ? Math.min(100, Math.round((r.actual / r.budget) * 100)) : 100;
                const over = r.budget ? r.actual > r.budget : r.actual > 0;
                return html`<tr key=${r.c}><td>${r.c}</td><td className="r num">${r.budget ? M(r.budget) : '—'}</td><td className="r num">${M(r.actual)}</td><td className=${'r num' + (over ? ' late' : '')}>${r.budget ? (r.budget - r.actual < 0 ? '−' : '') + M(Math.abs(r.budget - r.actual)) : 'No budget'}</td><td><div className="bar"><span style=${{ width: pct + '%', background: over ? 'var(--red-ink)' : pct > 85 ? 'var(--amber-ink)' : 'var(--teal)' }} /></div></td></tr>`;
              })}
              <tr className="sum"><td><b>Total</b></td><td className="r num"><b>${M(tb)}</b></td><td className="r num"><b>${M(ta)}</b></td><td className=${'r num' + (ta > tb ? ' late' : '')}><b>${(tb - ta < 0 ? '−' : '') + M(Math.abs(tb - ta))}</b></td><td /></tr>
            </tbody></table></div>`
          : html`<${Empty} title="Nothing to compare yet">Set monthly budgets under Accounting settings and record bills and expenses; this report fills in on its own.<//>`
      }
    </section>`;
}
function VendorTotals({ exp, year, cur, onYear }) {
  const toast = useToast();
  const rows = {};
  exp.filter(x => x.st === 'paid' && (x.cur || 'USD') === cur && (x.paidOn || x.d || '').slice(0, 4) === String(year)).forEach(x => {
    const k = (x.v || 'Unknown').trim();
    rows[k] = rows[k] || { v: k, n: 0, a: 0, cats: new Set() };
    rows[k].n++;
    rows[k].a += +x.a || 0;
    rows[k].cats.add(x.cat);
  });
  const list = Object.values(rows).sort((x, y) => y.a - x.a);
  const threshold = cur === 'USD' ? 600 : 0;
  const M = n => fmtMoney(n, cur);
  return html`<section className="panel stack">
      <div className="ph-row" style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 className="ph">Paid to each vendor in ${year} (${cur})</h2>
          <p className="muted small" style=${{ margin: 0 }}>${cur === 'USD' ? 'For 1099-NEC filing: contractors and vendors paid $600 or more in the year are flagged. Check what applies to each payee with your accountant.' : 'Yearly totals per payee, for TDS and vendor reconciliation.'}</p>
        </div>
        <div className="actions" style=${{ flexWrap: 'nowrap' }}>
          <select value=${year} onChange=${e => onYear(e.target.value)} aria-label="Year">${[0, 1, 2, 3].map(i => { const y = new Date().getFullYear() - i; return html`<option key=${y} value=${y}>${y}</option>`; })}</select>
          <button type="button" className="btn ghost sm" disabled=${!list.length} onClick=${async () => {
            try {
              await saveDownload(`vendor-totals-${year}-${cur}.csv`, toCSV([['Vendor', 'Categories', 'Payments', 'Total paid', threshold ? '1099 likely' : ''], ...list.map(r => [r.v, [...r.cats].join('; '), r.n, r2(r.a), threshold && r.a >= threshold ? 'Yes' : ''])]));
            } catch (e) {
              if (!e || e.code !== 'declined') toast(errText(e), true);
            }
          }}><${Icon} n="down" />CSV</button>
        </div>
      </div>
      ${
        list.length
          ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Vendor</th><th>Categories</th><th className="r">Payments</th><th className="r">Total paid</th><th /></tr></thead><tbody>
              ${list.map(r => html`<tr key=${r.v}><td><b style=${{ fontWeight: 600 }}>${r.v}</b></td><td className="small">${[...r.cats].join(', ')}</td><td className="r num">${r.n}</td><td className="r num">${M(r.a)}</td><td>${threshold && r.a >= threshold ? html`<${Chip} s="amber">1099 likely<//>` : null}</td></tr>`)}
            </tbody></table></div>`
          : html`<${Empty} title=${'No paid bills in ' + year} />`
      }
    </section>`;
}
