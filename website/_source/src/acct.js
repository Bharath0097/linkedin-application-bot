/* ================= Accounting portal ================= */
const useCoa = () => { const d = useDoc('org/acct/x/coa'); return (d.data && d.data.items && d.data.items.length) ? d.data.items : COA_DEFAULT; };
const useTaxSettings = () => { const d = useDoc('org/acct/x/tax'); const t = d.data || {}; return { us: { ...TAX_DEFAULT.us, ...(t.us || {}) }, in: { ...TAX_DEFAULT.in, ...(t.in || {}) }, loaded: !d.loading }; };
const EXP_ST = { unpaid: 'Unpaid', paid: 'Paid' };
const expOverdue = x => x.st === 'unpaid' && x.due && x.due < dkey();

/* ---- Overview ---- */
function AcctOverview() {
  const P = usePortal(); const inv = useCol('inv', 'u:desc'); const exp = useCol('exp', 'u:desc'); const runs = useCol('org/acct/runs', 'mk:desc', 3);
  const ar = {}; inv.docs.filter(d => ['sent', 'viewed', 'part'].includes(d.st)).forEach(d => { ar[d.cur] = (ar[d.cur] || 0) + invBalance(d); });
  const ap = {}; exp.docs.filter(x => x.st === 'unpaid').forEach(x => { ap[x.cur] = (ap[x.cur] || 0) + (+x.a || 0); });
  const run = runs.docs[0];
  return html`<div className="stack">
    <div className="kpis">
      ${Object.keys(ar).length ? Object.entries(ar).map(([c, v]) => html`<a key=${c} href="#/portal/admin/invoices"><b>${fmtMoney(v, c)}</b><span>Receivable (${c})</span></a>`) : html`<a href="#/portal/admin/invoices"><b>$0.00</b><span>Receivable</span></a>`}
      <a href="#/portal/admin/invoices"><b>${inv.docs.filter(invOverdue).length}</b><span>Overdue invoices</span></a>
      ${Object.keys(ap).length ? Object.entries(ap).map(([c, v]) => html`<a key=${c} href="#/portal/acct/expenses"><b>${fmtMoney(v, c)}</b><span>Bills to pay (${c})</span></a>`) : html`<a href="#/portal/acct/expenses"><b>$0.00</b><span>Bills to pay</span></a>`}
      <a href="#/portal/acct/payroll"><b>${run ? monthLabel(run.mk) : '—'}</b><span>${run ? `Last payroll run, ${run.st}` : 'No payroll run yet'}</span></a>
    </div>
    <div className="g2" style=${{ alignItems: 'start' }}>
      <section className="panel"><div className="ph-row"><h2 className="ph">Open invoices</h2><a className="small" href="#/portal/admin/invoices">All invoices</a></div>
        ${inv.docs.filter(d => ['sent', 'viewed', 'part'].includes(d.st)).length ? html`<ul className="list">${inv.docs.filter(d => ['sent', 'viewed', 'part'].includes(d.st)).slice(0, 6).map(d => html`<li key=${d.id}><div><div className="t">${d.num}, ${d.bill.co}</div><div className="m">Due ${fmtDate(d.due)}</div></div><div className="actions"><${Chip} s=${invChip(d)}>${INV_LABEL(invStatus(d))}<//><b className="num">${fmtMoney(invBalance(d), d.cur)}</b></div></li>`)}</ul>` : html`<${Empty} title="Nothing outstanding" />`}</section>
      <section className="panel"><div className="ph-row"><h2 className="ph">Bills to pay</h2><a className="small" href="#/portal/acct/expenses">All bills and expenses</a></div>
        ${exp.docs.filter(x => x.st === 'unpaid').length ? html`<ul className="list">${exp.docs.filter(x => x.st === 'unpaid').slice(0, 6).map(x => html`<li key=${x.id}><div><div className="t">${x.v}</div><div className="m">${x.cat}${x.due ? ', due ' + fmtDate(x.due) : ''}</div></div><div className="actions">${expOverdue(x) && html`<${Chip} s="red">Overdue<//>`}<b className="num">${fmtMoney(x.a, x.cur)}</b></div></li>`)}</ul>` : html`<${Empty} title="No unpaid bills" />`}</section>
    </div>
    <section className="panel"><h2 className="ph" style=${{ marginBottom: 10 }}>Quick actions</h2><div className="actions"><a className="btn" href="#/portal/admin/invoices">New invoice</a><a className="btn ghost" href="#/portal/acct/expenses">Record a bill or expense</a><a className="btn ghost" href="#/portal/acct/payroll">Run payroll</a><a className="btn ghost" href="#/portal/acct/reports">Reports</a><a className="btn ghost" href="#/portal/acct/taxes">Tax settings</a></div></section>
  </div>`;
}

/* ---- Bills and expenses ---- */
function ExpenseModal({ x, onClose }) {
  const P = usePortal(); const toast = useToast(); const coa = useCoa();
  const [f, setF] = useState(x ? { ...x } : { v: '', cat: (coa.find(c => c.t === 'expense') || {}).n || 'Other expenses', d: dkey(), due: '', a: '', cur: 'USD', ref: '', notes: '', st: 'unpaid', m: 'Bank transfer' });
  const [busy, setBusy] = useState(false); const [prog, setProg] = useState(0);
  const files = useCol(x ? `exp/${x.id}/f` : null, 'at:desc');
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const save = async (markPaid) => {
    if (!f.v.trim() || !(+f.a > 0)) { toast('Add the vendor and the amount.', true); return; }
    setBusy(true);
    try { const id = x ? x.id : nid(); const now = Date.now(); const st = markPaid ? 'paid' : f.st;
      await (x ? dbMerge : dbSet)(`exp/${id}`, { v: f.v.trim(), cat: f.cat, d: f.d, due: f.due, a: r2(f.a), cur: f.cur, ref: f.ref.trim(), notes: f.notes.trim(), st, m: f.m, ...(markPaid ? { paidAt: now, paidOn: dkey() } : {}), at: x ? x.at : now, by: x ? x.by : P.uid, byn: x ? x.byn : (P.prof ? P.prof.n : ''), u: now });
      toast(markPaid ? 'Marked paid.' : x ? 'Saved.' : 'Bill recorded.'); onClose(); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const onFiles = async fs => { if (!x) { toast('Save first, then attach the receipt.', true); return; } setBusy(true); try { setProg(0.03); await storeFile(`exp/${x.id}`, fs[0], { c: 'receipt' }, setProg); toast('Receipt attached.'); } catch (e) { toast(errText(e), true); } setBusy(false); };
  return html`<${Modal} title=${x ? x.v : 'Record a bill or expense'} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button>${f.st !== 'paid' && html`<button className="btn go" disabled=${busy} onClick=${() => save(true)}>Save and mark paid</button>`}<button className="btn" disabled=${busy} onClick=${() => save(false)}>${busy ? 'Saving…' : 'Save'}</button>`}>
    <div className="form">
      <div className="row2"><${Field} label="Vendor / payee"><input value=${f.v} onInput=${up('v')} placeholder="e.g. Dice, AWS, a C2C consultant's company" /><//><${Field} label="Category"><select value=${f.cat} onChange=${up('cat')}>${coa.filter(c => c.t === 'expense').map(c => html`<option key=${c.id}>${c.n}</option>`)}</select><//></div>
      <div className="row3"><${Field} label="Amount"><input type="number" step="0.01" min="0" value=${f.a} onInput=${up('a')} /><//><${Field} label="Currency"><select value=${f.cur} onChange=${up('cur')}><option value="USD">USD</option><option value="INR">INR</option></select><//><${Field} label="Status"><select value=${f.st} onChange=${up('st')}><option value="unpaid">Unpaid</option><option value="paid">Paid</option></select><//></div>
      <div className="row3"><${Field} label="Bill date"><input type="date" value=${f.d} onInput=${up('d')} /><//><${Field} label="Due date"><input type="date" value=${f.due} onInput=${up('due')} /><//><${Field} label="Payment method"><select value=${f.m} onChange=${up('m')}>${['Bank transfer', 'ACH', 'Wire', 'Card', 'Check', 'UPI', 'Cash'].map(v => html`<option key=${v}>${v}</option>`)}</select><//></div>
      <div className="row2"><${Field} label="Reference (invoice or receipt #)"><input value=${f.ref} onInput=${up('ref')} /><//><${Field} label="Notes"><input value=${f.notes} onInput=${up('notes')} /><//></div>
      <div><span className="lbl">Receipt or bill</span>${x && files.docs.length ? html`<ul className="files" style=${{ marginTop: 8 }}>${files.docs.map(r => html`<li key=${r.id}><${Icon} n="file" /><div className="fn"><b>${r.n}</b><span>${fmtDay(r.at)}</span></div><${FileActions} base=${'exp/' + x.id} f=${r} /></li>`)}</ul>` : null}
        <div style=${{ marginTop: 8 }}><${FilePick} busy=${busy} progress=${prog} onFiles=${onFiles} label=${x ? 'Attach the receipt or vendor invoice.' : 'Save first, then attach the receipt.'} /></div></div>
    </div><//>`;
}
function Expenses() {
  const col = useCol('exp', 'd:desc'); const [tab, setTab] = useState('unpaid'); const [open, setOpen] = useState(undefined); const [q, setQ] = useState(''); const toast = useToast();
  const ql = q.trim().toLowerCase();
  const list = col.docs.filter(x => (tab === 'all' || x.st === tab) && (!ql || [x.v, x.cat, x.ref, x.notes].join(' ').toLowerCase().includes(ql)));
  const tot = {}; col.docs.filter(x => x.st === 'unpaid').forEach(x => { tot[x.cur] = (tot[x.cur] || 0) + (+x.a || 0); });
  const cur = open && col.docs.find(x => x.id === open);
  const exp = async () => { try { await saveDownload('bills-expenses.csv', toCSV([['Date', 'Vendor', 'Category', 'Amount', 'Currency', 'Status', 'Due', 'Paid on', 'Reference', 'Notes'], ...col.docs.map(x => [x.d, x.v, x.cat, x.a, x.cur, x.st, x.due || '', x.paidOn || '', x.ref || '', x.notes || ''])])); } catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); } };
  return html`<div className="stack">
    <div className="kpis" style=${{ gridTemplateColumns: `repeat(${Math.max(1, Object.keys(tot).length) + 1},minmax(0,1fr))` }}>${Object.keys(tot).length ? Object.entries(tot).map(([c, v]) => html`<a key=${c}><b>${fmtMoney(v, c)}</b><span>Unpaid (${c})</span></a>`) : html`<a><b>$0.00</b><span>Unpaid</span></a>`}<a><b>${col.docs.filter(expOverdue).length}</b><span>Overdue bills</span></a></div>
    <div className="toolbar"><div className="tabs" role="tablist" style=${{ marginBottom: 0, border: 0 }}>${[['unpaid', 'Unpaid'], ['paid', 'Paid'], ['all', 'All']].map(([k, v]) => html`<button key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}</button>`)}</div>
      <input type="search" style=${{ maxWidth: 220 }} placeholder="Search" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search bills" /><div className="push"><button className="btn ghost" onClick=${exp}><${Icon} n="down" />CSV</button><button className="btn" onClick=${() => setOpen(null)}><${Icon} n="plus" />Record bill or expense</button></div></div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${col.loading ? html`<${Spinner} />` : list.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Date</th><th>Vendor</th><th>Category</th><th className="r">Amount</th><th>Due</th><th>Status</th></tr></thead>
        <tbody>${list.map(x => html`<tr key=${x.id} className="click" tabIndex="0" onClick=${() => setOpen(x.id)}><td className="num nw">${fmtDate(x.d)}</td><td><b style=${{ fontWeight: 600 }}>${x.v}</b>${x.ref ? html`<div className="muted small">${x.ref}</div>` : ''}</td><td>${x.cat}</td><td className="r num">${fmtMoney(x.a, x.cur)}</td><td className="num nw">${x.due ? fmtDate(x.due) : '—'}</td><td><${Chip} s=${x.st === 'paid' ? 'ok' : expOverdue(x) ? 'red' : 'amber'}>${x.st === 'paid' ? 'Paid' : expOverdue(x) ? 'Overdue' : 'Unpaid'}<//></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title=${tab === 'unpaid' ? 'No unpaid bills' : 'Nothing here yet'} action=${html`<button className="btn" onClick=${() => setOpen(null)}>Record the first bill</button>`}>Vendor bills, C2C contractor payments, software, travel and every other cost. Categories feed the profit and loss report.<//>`}
    </section>
    ${open !== undefined && (open === null || cur) && html`<${ExpenseModal} key=${open || 'new'} x=${cur || null} onClose=${() => setOpen(undefined)} />`}
  </div>`;
}

/* ---- Chart of accounts ---- */
function ChartOfAccounts() {
  const toast = useToast(); const d = useDoc('org/acct/x/coa'); const [items, setItems] = useState(null);
  const cur = items || ((d.data && d.data.items && d.data.items.length) ? d.data.items : COA_DEFAULT);
  const set = (i, patch) => setItems(cur.map((x, j) => j === i ? { ...x, ...patch } : x));
  const save = async () => { try { await dbMerge('org/acct/x/coa', { items: cur.filter(x => x.n.trim()).map(x => ({ id: x.id || nid(), n: x.n.trim(), t: x.t })) }); setItems(null); toast('Chart of accounts saved.'); } catch (e) { toast(errText(e), true); } };
  return html`<div className="stack">
    <section className="panel stack" style=${{ gap: 12 }}>
      <div className="ph-row"><div><h2 className="ph">Chart of accounts</h2><p className="muted small" style=${{ marginTop: 4 }}>Income and expense categories used by invoices, bills and the profit and loss report.</p></div><div className="actions"><button className="btn ghost sm" onClick=${() => setItems(COA_DEFAULT.map(x => ({ ...x })))}>Reset to defaults</button><button className="btn sm" onClick=${() => setItems([...cur, { id: nid(), n: '', t: 'expense' }])}><${Icon} n="plus" />Add account</button></div></div>
      <div className="stack" style=${{ gap: 8 }}>${cur.map((x, i) => html`<div key=${x.id || i} style=${{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) 160px auto', gap: 8, alignItems: 'center' }}><input value=${x.n} onInput=${e => set(i, { n: e.target.value })} aria-label="Account name" /><select value=${x.t} onChange=${e => set(i, { t: e.target.value })} aria-label="Type"><option value="income">Income</option><option value="expense">Expense</option></select><button className="btn ghost icon" aria-label="Remove" onClick=${() => setItems(cur.filter((_, j) => j !== i))}><${Icon} n="trash" /></button></div>`)}</div>
      <div className="actions"><button className="btn" disabled=${!items} onClick=${save}>Save</button></div>
    </section>
  </div>`;
}

/* ---- Tax settings ---- */
function TaxSettings() {
  const toast = useToast(); const d = useDoc('org/acct/x/tax'); const [f, setF] = useState(null);
  const cur = f || { us: { ...TAX_DEFAULT.us, ...((d.data || {}).us || {}) }, in: { ...TAX_DEFAULT.in, ...((d.data || {}).in || {}) } };
  const upUS = k => e => setF({ ...cur, us: { ...cur.us, [k]: e.target.type === 'checkbox' ? e.target.checked : +e.target.value } });
  const upIN = k => e => setF({ ...cur, in: { ...cur.in, [k]: e.target.type === 'checkbox' ? e.target.checked : (e.target.type === 'number' ? +e.target.value : e.target.value) } });
  const save = async () => { try { await dbMerge('org/acct/x/tax', { us: cur.us, in: cur.in }); setF(null); toast('Tax settings saved.'); } catch (e) { toast(errText(e), true); } };
  const F = (label, v, on, step) => html`<${Field} label=${label}><input type="number" step=${step || 'any'} value=${v} onInput=${on} /><//>`;
  return html`<div className="stack">
    <div className="note info"><span>These rates drive the paystub calculations. Defaults are the published ${cur.us.year} US figures and the FY ${cur.in.fy} India figures; update them each year and confirm with your CPA or CA. Paystubs are marked as estimates.</span></div>
    <section className="panel stack" style=${{ gap: 12 }}><h2 className="ph">United States (W2 payroll)</h2>
      <div className="row3">${F('Tax year', cur.us.year, upUS('year'), 1)}${F('Standard deduction, single', cur.us.std.single, e => setF({ ...cur, us: { ...cur.us, std: { ...cur.us.std, single: +e.target.value } } }))}${F('Standard deduction, married', cur.us.std.married, e => setF({ ...cur, us: { ...cur.us, std: { ...cur.us.std, married: +e.target.value } } }))}</div>
      <div className="row3">${F('Social Security %', cur.us.ss, upUS('ss'))}${F('Social Security wage base', cur.us.ssBase, upUS('ssBase'))}${F('Medicare %', cur.us.med, upUS('med'))}</div>
      <div className="row3">${F('Additional Medicare % (over threshold)', cur.us.medAdd, upUS('medAdd'))}${F('Additional Medicare threshold', cur.us.medAddOver, upUS('medAddOver'))}${F('FUTA % (employer)', cur.us.futa, upUS('futa'))}</div>
      <div className="row3">${F('FUTA wage base', cur.us.futaBase, upUS('futaBase'))}${F('SUTA % (employer, your state rate)', cur.us.suta, upUS('suta'))}${F('SUTA wage base (NJ 2025: 43,300)', cur.us.sutaBase, upUS('sutaBase'))}</div>
      <p className="muted small">Federal brackets follow the IRS percentage-method tables for the year above. State income tax is set per employee as a flat withholding percent on their Tax tab (NJ, for example, has its own tables; use the effective rate your CPA gives you).</p></section>
    <section className="panel stack" style=${{ gap: 12 }}><h2 className="ph">India (salary payroll)</h2>
      <div className="row3"><${Field} label="Financial year"><input value=${cur.in.fy} onInput=${upIN('fy')} /><//><${Field} label="Default regime"><select value=${cur.in.regime} onChange=${upIN('regime')}><option value="new">New regime</option><option value="old">Old regime</option></select><//>${F('Health and education cess %', cur.in.cess, upIN('cess'))}</div>
      <div className="row3">${F('Standard deduction (new regime)', cur.in.newStd, upIN('newStd'))}${F('87A rebate limit (new regime)', cur.in.newRebate, upIN('newRebate'))}${F('Standard deduction (old regime)', cur.in.oldStd, upIN('oldStd'))}</div>
      <div className="row3">${F('EPF employee %', cur.in.pf, upIN('pf'))}${F('EPF wage ceiling', cur.in.pfCapWage, upIN('pfCapWage'))}<label className="check" style=${{ alignSelf: 'end', paddingBottom: 12 }}><input type="checkbox" checked=${!!cur.in.pfCap} onChange=${upIN('pfCap')} /><span>Apply the EPF wage ceiling</span></label></div>
      <div className="row3">${F('Basic as % of gross (default)', cur.in.basicPct, upIN('basicPct'))}${F('ESI applies up to gross (monthly)', cur.in.esiLimit, upIN('esiLimit'))}${F('ESI employee % / employer %', cur.in.esiEmp, upIN('esiEmp'))}</div>
      <div className="row3">${F('ESI employer %', cur.in.esiEr, upIN('esiEr'))}${F('Professional tax per month (default)', cur.in.pt, upIN('pt'))}${F('No professional tax below gross', cur.in.ptMin, upIN('ptMin'))}</div>
      <p className="muted small">New-regime slabs for FY ${cur.in.fy}: nil to ₹4L, 5% to ₹8L, 10% to ₹12L, 15% to ₹16L, 20% to ₹20L, 25% to ₹24L, 30% above, with the 87A rebate making tax nil up to ₹12L taxable. Professional tax varies by state; set the per-person amount on their Tax tab where it differs.</p></section>
    <div className="actions"><button className="btn" disabled=${!f} onClick=${save}>Save tax settings</button><button className="btn ghost" onClick=${() => setF({ us: { ...TAX_DEFAULT.us }, in: { ...TAX_DEFAULT.in } })}>Reset to defaults</button></div>
  </div>`;
}

/* ---- Paystub PDF ---- */
async function buildPaystubPdf(s, org) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo = null; try { const r = await fetch(LOGO_L); if (r.ok) logo = await pdf.embedPng(new Uint8Array(await r.arrayBuffer())); } catch (e) { /* no logo */ }
  const navy = rgb(0.063, 0.106, 0.208), grey = rgb(0.42, 0.46, 0.55), teal = rgb(0.012, 0.63, 0.61), band = rgb(0.95, 0.96, 0.98);
  const page = pdf.addPage([612, 792]); const M = n => ascii(fmtMoney(n, s.cur));
  const T = (t, x, y, size, f, color) => page.drawText(ascii(t), { x, y, size, font: f || font, color: color || navy });
  let y = 740;
  if (logo) { const w = 140, h = w * logo.height / logo.width; page.drawImage(logo, { x: 50, y: y - h + 10, width: w, height: h }); }
  T('EARNINGS STATEMENT', 380, y, 16, bold); T(`Pay period: ${s.period || monthLabel(s.mk)}`, 380, y - 18, 9.5, font, grey); T(`Pay date: ${s.paidOn ? fmtDate(s.paidOn, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Pending'}`, 380, y - 31, 9.5, font, grey); y -= 56;
  [org.co || 'StratEdge IT Consulting Inc.', ...(org.addr || '').split('\n'), org.email || CO.email].filter(Boolean).forEach((l, i) => T(l, 50, y - i * 12, i ? 9 : 10.5, i ? font : bold, i ? grey : navy)); y -= 52;
  T('EMPLOYEE', 50, y, 8.5, bold, teal); T(s.n, 50, y - 14, 11, bold); T([s.ti, s.e].filter(Boolean).join('  ·  '), 50, y - 27, 9, font, grey);
  T('DETAILS', 330, y, 8.5, bold, teal); T(`${s.country === 'IN' ? 'India payroll' : 'US payroll'}${s.filing && s.country !== 'IN' ? ', filing: ' + s.filing : ''}${s.regime && s.country === 'IN' ? ', ' + s.regime + ' regime' : ''}`, 330, y - 14, 9.5); T(`Days worked: ${s.days} of ${s.workDays}   Hours: ${h1(s.reg)} regular, ${h1(s.ot)} overtime`, 330, y - 27, 9.5); T(`Payment: ${s.method}`, 330, y - 40, 9.5, font, grey); y -= 66;
  const col = (title, x, rows, w) => { page.drawRectangle({ x, y: y - 4, width: w, height: 18, color: band }); T(title, x + 6, y + 1, 9, bold, grey); T('Amount', x + w - 48, y + 1, 9, bold, grey); let yy = y - 20; rows.forEach(r => { T(r.n.length > 44 ? r.n.slice(0, 43) + '…' : r.n, x + 6, yy, 9.5); const v = M(r.v); T(v, x + w - 6 - font.widthOfTextAtSize(ascii(v), 9.5), yy, 9.5); yy -= 14; }); return yy; };
  const y1 = col('Earnings', 50, s.earnings, 250); const y2 = col('Taxes and deductions', 312, [...s.taxes, ...s.other], 250); y = Math.min(y1, y2) - 10;
  page.drawLine({ start: { x: 50, y }, end: { x: 562, y }, thickness: .6, color: rgb(0.85, 0.88, 0.92) }); y -= 18;
  const tot = [['Gross pay', s.gross], ['Taxes withheld', s.taxT], ...(s.otherT ? [['Other deductions', s.otherT]] : []), ['NET PAY', s.net]];
  tot.forEach(([k, v]) => { const big = k === 'NET PAY'; T(k, 312, y, big ? 12 : 10, big ? bold : font, big ? navy : grey); const t = M(v); T(t, 562 - (big ? bold : font).widthOfTextAtSize(ascii(t), big ? 12 : 10), y, big ? 12 : 10, big ? bold : font); y -= big ? 20 : 15; });
  y -= 6; T('YEAR TO DATE', 50, y, 8.5, bold, teal); T(`Gross ${M(s.ytd.gross)}   Taxes ${M(s.ytd.tax)}   Net ${M(s.ytd.net)}   (${s.yk})`, 50, y - 14, 9.5); y -= 36;
  if (s.employer && s.employer.length) { T('EMPLOYER CONTRIBUTIONS (not deducted from pay)', 50, y, 8.5, bold, teal); s.employer.forEach((r, i) => T(`${r.n}: ${M(r.v)}`, 50, y - 14 - i * 12, 9, font, grey)); y -= 14 + s.employer.length * 12 + 12; }
  T(s.note || '', 50, 54, 7.5, font, grey); T('This statement is computed by the StratEdge portal from recorded time and the pay plan on file; tax amounts are estimates until confirmed by your accountant.', 50, 42, 7.5, font, grey);
  return await pdf.save();
}
function StubView({ s }) {
  const M = n => fmtMoney(n, s.cur);
  return html`<div className="stub">
    <div className="g2" style=${{ gap: 16 }}>
      <div><h4>Earnings</h4><table className="tbl mini"><tbody>${s.earnings.map((r, i) => html`<tr key=${i}><td>${r.n}</td><td className="r num">${M(r.v)}</td></tr>`)}<tr className="sum"><td><b>Gross pay</b></td><td className="r num"><b>${M(s.gross)}</b></td></tr></tbody></table></div>
      <div><h4>Taxes and deductions</h4><table className="tbl mini"><tbody>${[...s.taxes, ...s.other].map((r, i) => html`<tr key=${i}><td>${r.n}</td><td className="r num">${M(r.v)}</td></tr>`)}<tr className="sum"><td><b>Total</b></td><td className="r num"><b>${M(r2(s.taxT + s.otherT))}</b></td></tr></tbody></table></div>
    </div>
    <div className="stub-net"><span>Net pay</span><b>${M(s.net)}</b><small>${s.period ? s.period + ' · ' : ''}${s.days} of ${s.workDays} approved days${s.pending ? ` (${s.pending} awaiting approval)` : ''} · ${h1(s.reg)} h regular, ${h1(s.ot)} h overtime · YTD gross ${M(s.ytd.gross)}, net ${M(s.ytd.net)}${s.conf ? ` · salary confirmed by ${s.conf.byn}` : ''}</small></div>
    ${s.employer.length > 0 && html`<p className="muted small">Employer contributions (not deducted): ${s.employer.map(r => `${r.n} ${M(r.v)}`).join(', ')}. Total cost to company ${M(s.cost)}.</p>`}
    <p className="muted small">${s.note}</p>
  </div>`;
}

/* ---- Payroll runs ---- */
function PayrollRuns() {
  const P = usePortal(); const A = P.admin; const toast = useToast(); const tax = useTaxSettings(); const org = (P.settings && P.settings.inv) || {};
  const ps = payStartOf(P.settings); const req = attApprovalOn(P.settings);
  const [mk, setMk] = useState(cycleFor(dkey(), ps)); const cyc = cycleRange(mk, ps); const [rows, setRows] = useState(null); const [open, setOpen] = useState(null); const [busy, setBusy] = useState('');
  const run = useDoc(`org/acct/runs/${mk}`); const runD = run.data && run.data.st && run.data.st !== 'open' ? run.data : null; const conf = (run.data && run.data.conf) || {};
  const me = (P.prof && P.prof.n) || (Cap.me && Cap.me.name) || 'Admin';
  const emps = A.members.filter(m => m.role !== 'employer' && m.st === 'active' && m.r && m.r.pay && +m.r.pay.amt);
  const ids = emps.map(m => m.id).join(',');
  useEffect(() => {
    if (A.loading || !tax.loaded) return; let live = true; setRows(null);
    pMap(emps, 4, async m => { const [att, prior, stub] = await Promise.all([loadCycleAtt(m.id, cyc), dbList(`pays/${m.id}/items`).catch(() => []), dbGet(`pays/${m.id}/items/${mk}`)]);
      const c = computePay(m.r.pay, att, mk, approvedLeaves(m.u, m.r), P.settings.hol || [], (m.r.payAdj || {})[mk] || [], { from: cyc.from, to: cyc.to, approvals: m.r.attA, requireApproval: req, breakMax: breakMaxOf(P.settings) }); const s = { ...buildStub(m, mk, c, m.r.tax, tax, prior), period: cyc.label, pending: c.pending }; return { m, s, saved: stub }; })
      .then(r => { if (live) setRows(r); });
    return () => { live = false; };
  }, [ids, mk, A.loading, tax.loaded, run.data && run.data.u]);
  const totals = {}; (rows || []).forEach(r => { const t = totals[r.s.cur] = totals[r.s.cur] || { gross: 0, tax: 0, net: 0, cost: 0, n: 0 }; t.gross += r.s.gross; t.tax += r.s.taxT; t.net += r.s.net; t.cost += r.s.cost; t.n++; });
  const confirmOne = async (r) => { try { await dbMerge(`org/acct/runs/${mk}`, { mk, st: run.data && run.data.st ? run.data.st : 'open', conf: { [r.m.id]: { by: P.uid, byn: me, at: Date.now(), net: r.s.net } }, u: Date.now() }); toast(`Salary confirmed for ${firstName(r.s.n)}.`); } catch (e) { toast(errText(e), true); } };
  const confirmAll = async () => { if (!rows) return; try { const c = {}; rows.forEach(r => { if (!conf[r.m.id]) c[r.m.id] = { by: P.uid, byn: me, at: Date.now(), net: r.s.net }; }); if (Object.keys(c).length) await dbMerge(`org/acct/runs/${mk}`, { mk, st: run.data && run.data.st ? run.data.st : 'open', conf: c, u: Date.now() }); toast('All salaries confirmed.'); } catch (e) { toast(errText(e), true); } };
  const unconfirmed = rows ? rows.filter(r => !conf[r.m.id]) : [];
  const pendingDays = rows ? rows.reduce((a, r) => a + (r.s.pending || 0), 0) : 0;
  const finalize = async () => {
    if (!rows || !rows.length) return;
    if (unconfirmed.length) { toast(`Confirm the salary for ${unconfirmed.map(r => firstName(r.s.n)).join(', ')} first.`, true); return; }
    if (pendingDays && !confirm(`${pendingDays} clocked day${pendingDays === 1 ? ' is' : 's are'} still awaiting attendance approval and will not be paid in this run. Finalize anyway?`)) return;
    if (!confirm(`Finalize payroll for ${cyc.label} for ${rows.length} ${rows.length === 1 ? 'person' : 'people'}? Paystubs become visible to employees.`)) return;
    setBusy('final');
    try { const now = Date.now(); for (const r of rows) await dbSet(`pays/${r.m.id}/items/${mk}`, { ...r.s, conf: conf[r.m.id] || null, st: 'final', at: now, by: P.uid, u: now });
      await dbMerge(`org/acct/runs/${mk}`, { mk, st: 'final', n: rows.length, totals: Object.fromEntries(Object.entries(totals).map(([c, t]) => [c, { gross: r2(t.gross), tax: r2(t.tax), net: r2(t.net), cost: r2(t.cost), n: t.n }])), at: now, by: P.uid, byn: me, u: now });
      toast('Payroll finalized. Paystubs are now in each employee\u2019s Earnings page.'); }
    catch (e) { toast(errText(e), true); }
    setBusy('');
  };
  const markPaid = async () => { const d = prompt('Pay date (YYYY-MM-DD)', dkey()); if (!d) return; setBusy('paid'); try { const now = Date.now(); for (const r of rows) await dbMerge(`pays/${r.m.id}/items/${mk}`, { st: 'paid', paidOn: d, u: now }); await dbMerge(`org/acct/runs/${mk}`, { st: 'paid', paidOn: d, u: now }); toast('Marked paid.'); } catch (e) { toast(errText(e), true); } setBusy(''); };
  const emailAll = async () => { setBusy('mail'); let n = 0; try { for (const r of rows) { const stub = (await dbGet(`pays/${r.m.id}/items/${mk}`)) || r.s; const bytes = await buildPaystubPdf(stub, org); const fd = new FormData(); fd.append('path', `pays/${r.m.id}/items/${mk}`); fd.append('file', new Blob([bytes], { type: 'application/pdf' }), `paystub-${mk}.pdf`); const x = await upload('pay_email', fd); if (x.mailed) n++; } toast(n === rows.length ? `Paystubs emailed to ${n} ${n === 1 ? 'person' : 'people'}.` : `${n} of ${rows.length} emailed; check storage/mail.log and the mail settings.`, n !== rows.length); } catch (e) { toast(errText(e), true); } setBusy(''); };
  const exp = async () => { try { await saveDownload(`payroll-${mk}.csv`, toCSV([['Employee', 'Country', 'Currency', 'Days', 'Regular h', 'OT h', 'Gross', ...['Taxes', 'Other deductions', 'Net', 'Employer contributions', 'Total cost']], ...rows.map(r => [r.s.n, r.s.country, r.s.cur, r.s.days, h1(r.s.reg), h1(r.s.ot), r.s.gross, r.s.taxT, r.s.otherT, r.s.net, r.s.employerT, r.s.cost])])); } catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); } };
  const download = async r => { try { const bytes = await buildPaystubPdf(r.saved || r.s, org); await saveDownload(`paystub-${r.s.n.replace(/\s+/g, '-')}-${mk}.pdf`, new Blob([bytes], { type: 'application/pdf' })); } catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); } };
  const cur = open && rows && rows.find(r => r.m.id === open);
  if (A.loading) return html`<${Spinner} />`;
  return html`<div className="stack">
    <div className="toolbar"><div className="wknav"><button className="btn ghost icon" aria-label="Previous pay period" onClick=${() => setMk(addMonths(mk, -1))}><${Icon} n="left" /></button><b>${cyc.label}</b><button className="btn ghost icon" aria-label="Next pay period" disabled=${mk >= cycleFor(dkey(), ps)} onClick=${() => setMk(addMonths(mk, 1))}><${Icon} n="right" /></button></div>
      ${runD && html`<${Chip} s=${runD.st === 'paid' ? 'ok' : 'new'}>${runD.st === 'paid' ? 'Paid ' + fmtDate(runD.paidOn) : 'Finalized ' + fmtDay(runD.at)}<//>`}
      <div className="push"><button className="btn ghost" disabled=${!rows || !rows.length} onClick=${exp}><${Icon} n="down" />CSV</button>
        ${!runD ? html`${unconfirmed.length > 0 && html`<button className="btn ghost" disabled=${!rows} onClick=${confirmAll}>Confirm all salaries</button>`}<button className="btn" disabled=${!rows || !rows.length || !!busy} onClick=${finalize}>${busy === 'final' ? 'Finalizing…' : 'Finalize run'}</button>`
          : html`${runD.st !== 'paid' && html`<button className="btn go" disabled=${!!busy} onClick=${markPaid}>Mark paid</button>`}<button className="btn" disabled=${!!busy} onClick=${emailAll}><${Icon} n="send" />${busy === 'mail' ? 'Emailing…' : 'Email paystubs'}</button>`}</div></div>
    ${!emps.length ? html`<div className="panel"><${Empty} title="No pay plans yet">Set a salary or hourly rate on each employee under Team › Pay, and their country and withholding details under Team › Tax. Then run payroll here.<//></div>`
      : rows === null ? html`<${Spinner} label="Computing pay from clock-ins…" />`
      : html`<${Fragment}>
        <div className="kpis" style=${{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>${Object.entries(totals).map(([c, t]) => html`<${Fragment} key=${c}><a><b>${fmtMoney(t.gross, c)}</b><span>Gross (${c}), ${t.n} people</span></a><a><b>${fmtMoney(t.net, c)}</b><span>Net pay (${c})</span></a><a><b>${fmtMoney(t.cost, c)}</b><span>Cost to company (${c})</span></a><//>`)}</div>
        <section className="panel" style=${{ padding: '6px 8px' }}><div className="tblwrap"><table className="tbl"><thead><tr><th>Employee</th><th>Payroll</th><th className="r">Days</th><th className="r">Hours</th><th className="r">Gross</th><th className="r">Taxes</th><th className="r">Net pay</th><th>Salary confirmed</th><th /></tr></thead>
          <tbody>${rows.map(r => html`<tr key=${r.m.id} className="click" tabIndex="0" onClick=${() => setOpen(r.m.id)}><td><${Person} uid=${r.m.id} root=${r.m.u} people=${P.people} sub=${r.s.ti} /></td><td>${r.s.country === 'IN' ? 'India' : 'US'}${r.saved ? html` <${Chip} s=${r.saved.st === 'paid' ? 'ok' : 'new'}>${r.saved.st}<//>` : ''}</td><td className="r num">${r.s.days}/${r.s.workDays}${r.s.pending ? html`<div className="small" style=${{ color: 'var(--amber-ink)' }}>${r.s.pending} awaiting approval</div>` : ''}</td><td className="r num">${h1(r.s.reg + r.s.ot)}</td><td className="r num">${fmtMoney(r.s.gross, r.s.cur)}</td><td className="r num">${fmtMoney(r.s.taxT, r.s.cur)}</td><td className="r num"><b>${fmtMoney(r.s.net, r.s.cur)}</b></td>
            <td>${(r.saved && r.saved.conf) || conf[r.m.id] ? html`<${Chip} s="ok">Confirmed<//><div className="muted small">${((r.saved && r.saved.conf) || conf[r.m.id]).byn}, ${fmtDay(((r.saved && r.saved.conf) || conf[r.m.id]).at)}</div>` : runD ? html`<span className="muted small">—</span>` : html`<button className="btn go sm" onClick=${e => { e.stopPropagation(); confirmOne(r); }}>Confirm</button>`}</td>
            <td className="r"><button className="btn ghost sm" onClick=${e => { e.stopPropagation(); download(r); }}><${Icon} n="down" />PDF</button></td></tr>`)}</tbody></table></div></section>
        ${!runD && html`<p className="muted small">Pay period ${cyc.label}, ${rows[0].s.workDays} standard working days. Figures update live from approved clock-ins until you finalize; confirm each salary (or all) before finalizing. If your pay plans already list PF, PT or TDS as deductions, remove them there so the tax engine doesn’t count them twice.</p>`}
      <//>`}
    ${cur && html`<${Modal} wide title=${`${cur.s.n}: ${cyc.label}`} onClose=${() => setOpen(null)} foot=${html`<button className="btn ghost" onClick=${() => download(cur)}><${Icon} n="down" />Download PDF</button><button className="btn" onClick=${() => setOpen(null)}>Close</button>`}><${StubView} s=${cur.saved || cur.s} /><//>`}
  </div>`;
}
/* employee's own paystubs */
function MyPaystubs() {
  const P = usePortal(); const toast = useToast(); const col = useCol(`pays/${P.uid}/items`, 'mk:desc'); const org = (P.settings && P.settings.inv) || {};
  const [open, setOpen] = useState(null);
  const download = async s => { try { const bytes = await buildPaystubPdf(s, org); await saveDownload(`paystub-${s.mk}.pdf`, new Blob([bytes], { type: 'application/pdf' })); } catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); } };
  const cur = open && col.docs.find(s => s.id === open);
  return html`<section className="panel"><div className="ph-row"><h2 className="ph">Paystubs</h2></div>
    ${col.loading ? html`<${Spinner} />` : col.docs.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Period</th><th className="r">Gross</th><th className="r">Taxes</th><th className="r">Net pay</th><th>Status</th><th /></tr></thead>
      <tbody>${col.docs.map(s => html`<tr key=${s.id}><td><b style=${{ fontWeight: 600 }}>${s.period || monthLabel(s.mk)}</b></td><td className="r num">${fmtMoney(s.gross, s.cur)}</td><td className="r num">${fmtMoney(s.taxT, s.cur)}</td><td className="r num"><b>${fmtMoney(s.net, s.cur)}</b></td><td><${Chip} s=${s.st === 'paid' ? 'ok' : 'new'}>${s.st === 'paid' ? 'Paid ' + fmtDate(s.paidOn) : 'Finalized'}<//></td><td className="r"><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}><button className="btn ghost sm" onClick=${() => setOpen(s.id)}>View</button><button className="btn ghost sm" onClick=${() => download(s)}><${Icon} n="down" />PDF</button></div></td></tr>`)}</tbody></table></div>`
      : html`<p className="muted small">Your paystubs appear here after each payroll run is finalized.</p>`}
    ${cur && html`<${Modal} wide title=${'Paystub: ' + monthLabel(cur.mk)} onClose=${() => setOpen(null)} foot=${html`<button className="btn ghost" onClick=${() => download(cur)}><${Icon} n="down" />Download PDF</button><button className="btn" onClick=${() => setOpen(null)}>Close</button>`}><${StubView} s=${cur} /><//>`}
  </section>`;
}

/* ---- Reports ---- */
function AcctReports() {
  const toast = useToast(); const inv = useCol('inv'); const exp = useCol('exp'); const runs = useCol('org/acct/runs'); const coa = useCoa();
  const today = dkey(); const [f, setF] = useState({ a: today.slice(0, 4) + '-01-01', b: today, basis: 'accrual', cur: 'USD', tab: 'pl' });
  const inR = (d, k) => d && d >= f.a && d <= f.b;
  const invs = inv.docs.filter(d => d.st !== 'void' && d.st !== 'draft' && d.cur === f.cur);
  const income = f.basis === 'accrual' ? invs.filter(d => inR(d.issue)).reduce((a, d) => a + (+d.total || 0), 0) : invs.reduce((a, d) => a + (d.pays || []).filter(p => inR(p.dt)).reduce((x, p) => x + (+p.a || 0), 0), 0);
  const exps = exp.docs.filter(x => x.cur === f.cur && (f.basis === 'accrual' ? inR(x.d) : (x.st === 'paid' && inR(x.paidOn || x.d))));
  const byCat = {}; exps.forEach(x => { byCat[x.cat] = (byCat[x.cat] || 0) + (+x.a || 0); });
  const payroll = runs.docs.filter(r => r.mk >= f.a.slice(0, 7) && r.mk <= f.b.slice(0, 7)).reduce((a, r) => { const t = (r.totals || {})[f.cur]; return t ? { gross: a.gross + t.gross, tax: a.tax + t.tax, net: a.net + t.net, cost: a.cost + t.cost } : a; }, { gross: 0, tax: 0, net: 0, cost: 0 });
  const expT = Object.values(byCat).reduce((a, v) => a + v, 0) + payroll.cost;
  const aging = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }; const open = inv.docs.filter(d => ['sent', 'viewed', 'part'].includes(d.st) && d.cur === f.cur);
  open.forEach(d => { const age = d.due ? Math.max(0, Math.round((new Date(today) - new Date(d.due)) / 86400000)) : 0; const k = age <= 30 ? '0-30' : age <= 60 ? '31-60' : age <= 90 ? '61-90' : '90+'; aging[k] += invBalance(d); });
  const ap = exp.docs.filter(x => x.st === 'unpaid' && x.cur === f.cur);
  const M = n => fmtMoney(n, f.cur);
  const csv = async () => { try { const rows = f.tab === 'pl' ? [['Line', 'Amount'], ['Income', r2(income)], ...Object.entries(byCat).map(([k, v]) => [k, r2(v)]), ['Payroll (gross + employer taxes)', r2(payroll.cost)], ['Total expenses', r2(expT)], ['Net profit', r2(income - expT)]] : f.tab === 'ar' ? [['Invoice', 'Client', 'Due', 'Balance'], ...open.map(d => [d.num, d.bill.co, d.due, invBalance(d)])] : f.tab === 'ap' ? [['Vendor', 'Category', 'Due', 'Amount'], ...ap.map(x => [x.v, x.cat, x.due || '', x.a])] : [['Month', 'People', 'Gross', 'Taxes withheld', 'Net', 'Cost to company'], ...runs.docs.filter(r => (r.totals || {})[f.cur]).map(r => [r.mk, r.totals[f.cur].n, r.totals[f.cur].gross, r.totals[f.cur].tax, r.totals[f.cur].net, r.totals[f.cur].cost])]; await saveDownload(`${f.tab}-report-${f.a}-to-${f.b}.csv`, toCSV(rows)); } catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); } };
  return html`<div className="stack">
    <div className="toolbar"><div className="tabs" role="tablist" style=${{ marginBottom: 0, border: 0 }}>${[['pl', 'Profit and loss'], ['ar', 'Receivables aging'], ['ap', 'Payables'], ['pay', 'Payroll and taxes']].map(([k, v]) => html`<button key=${k} role="tab" aria-selected=${f.tab === k} className=${f.tab === k ? 'on' : ''} onClick=${() => setF({ ...f, tab: k })}>${v}</button>`)}</div>
      <div className="push" style=${{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><input type="date" value=${f.a} onInput=${e => setF({ ...f, a: e.target.value })} aria-label="From" /><input type="date" value=${f.b} onInput=${e => setF({ ...f, b: e.target.value })} aria-label="To" /><select value=${f.cur} onChange=${e => setF({ ...f, cur: e.target.value })} aria-label="Currency"><option value="USD">USD</option><option value="INR">INR</option></select><select value=${f.basis} onChange=${e => setF({ ...f, basis: e.target.value })} aria-label="Basis"><option value="accrual">Accrual (by invoice date)</option><option value="cash">Cash (by payment date)</option></select><button className="btn ghost" onClick=${csv}><${Icon} n="down" />CSV</button></div></div>
    ${f.tab === 'pl' && html`<section className="panel"><h2 className="ph" style=${{ marginBottom: 12 }}>Profit and loss, ${fmtDate(f.a, { month: 'short', day: 'numeric', year: 'numeric' })} to ${fmtDate(f.b, { month: 'short', day: 'numeric', year: 'numeric' })} (${f.basis})</h2>
      <table className="tbl"><tbody>
        <tr className="sum"><td><b>Income</b></td><td className="r num"><b>${M(income)}</b></td></tr><tr><td className="muted">Invoices (${invs.filter(d => f.basis === 'accrual' ? inR(d.issue) : true).length})</td><td className="r num">${M(income)}</td></tr>
        <tr className="sum"><td><b>Expenses</b></td><td className="r num"><b>${M(expT)}</b></td></tr>${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => html`<tr key=${k}><td className="muted">${k}</td><td className="r num">${M(v)}</td></tr>`)}${payroll.cost > 0 && html`<tr><td className="muted">Payroll (gross ${M(payroll.gross)} + employer taxes)</td><td className="r num">${M(payroll.cost)}</td></tr>`}
        <tr className="sum"><td><b>Net profit</b></td><td className="r num"><b style=${{ color: income - expT >= 0 ? 'var(--ok-ink)' : 'var(--red-ink)' }}>${M(income - expT)}</b></td></tr>
      </tbody></table></section>`}
    ${f.tab === 'ar' && html`<section className="panel"><h2 className="ph" style=${{ marginBottom: 12 }}>Receivables aging (${f.cur})</h2>
      <div className="kpis" style=${{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))', marginBottom: 14 }}>${Object.entries(aging).map(([k, v]) => html`<a key=${k}><b>${M(v)}</b><span>${k === '0-30' ? 'Current to 30 days' : k + ' days past due'}</span></a>`)}</div>
      ${open.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Invoice</th><th>Client</th><th>Due</th><th className="r">Balance</th></tr></thead><tbody>${open.sort((a, b) => (a.due || '').localeCompare(b.due || '')).map(d => html`<tr key=${d.id}><td>${d.num}</td><td>${d.bill.co}</td><td className="num">${d.due ? fmtDate(d.due) : '—'}</td><td className="r num">${M(invBalance(d))}</td></tr>`)}</tbody></table></div>` : html`<${Empty} title="Nothing outstanding" />`}</section>`}
    ${f.tab === 'ap' && html`<section className="panel"><h2 className="ph" style=${{ marginBottom: 12 }}>Unpaid bills (${f.cur}): ${M(ap.reduce((a, x) => a + (+x.a || 0), 0))}</h2>
      ${ap.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Vendor</th><th>Category</th><th>Due</th><th className="r">Amount</th></tr></thead><tbody>${ap.sort((a, b) => (a.due || '').localeCompare(b.due || '')).map(x => html`<tr key=${x.id}><td>${x.v}</td><td>${x.cat}</td><td className="num">${x.due ? fmtDate(x.due) : '—'}${expOverdue(x) ? html` <${Chip} s="red">Overdue<//>` : ''}</td><td className="r num">${M(x.a)}</td></tr>`)}</tbody></table></div>` : html`<${Empty} title="No unpaid bills" />`}</section>`}
    ${f.tab === 'pay' && html`<section className="panel"><h2 className="ph" style=${{ marginBottom: 12 }}>Payroll and withheld taxes (${f.cur})</h2>
      <div className="kpis" style=${{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))', marginBottom: 14 }}><a><b>${M(payroll.gross)}</b><span>Gross pay in range</span></a><a><b>${M(payroll.tax)}</b><span>Taxes withheld</span></a><a><b>${M(payroll.net)}</b><span>Net paid</span></a><a><b>${M(payroll.cost - payroll.gross)}</b><span>Employer contributions</span></a></div>
      ${runs.docs.filter(r => (r.totals || {})[f.cur]).length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Month</th><th className="r">People</th><th className="r">Gross</th><th className="r">Taxes withheld</th><th className="r">Net</th><th className="r">Cost to company</th><th>Status</th></tr></thead><tbody>${runs.docs.filter(r => (r.totals || {})[f.cur]).sort((a, b) => b.mk.localeCompare(a.mk)).map(r => html`<tr key=${r.id}><td>${monthLabel(r.mk)}</td><td className="r num">${r.totals[f.cur].n}</td><td className="r num">${M(r.totals[f.cur].gross)}</td><td className="r num">${M(r.totals[f.cur].tax)}</td><td className="r num">${M(r.totals[f.cur].net)}</td><td className="r num">${M(r.totals[f.cur].cost)}</td><td><${Chip} s=${r.st === 'paid' ? 'ok' : 'new'}>${r.st}<//></td></tr>`)}</tbody></table></div>` : html`<${Empty} title="No payroll runs in this currency yet" />`}
      <p className="muted small" style=${{ marginTop: 12 }}>Use the withheld-tax totals for Form 941 deposits (US) and TDS, EPF and ESI remittances (India); the per-person breakdown is on each paystub and in the payroll CSV.</p></section>`}
  </div>`;
}
