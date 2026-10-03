/* ================= Invoices ================= */
const INV_ST = { draft: 'Draft', sent: 'Sent', viewed: 'Viewed', part: 'Partly paid', paid: 'Paid', void: 'Void' };
const invOverdue = d => ['sent', 'viewed', 'part'].includes(d.st) && d.due && d.due < dkey();
const invStatus = d => invOverdue(d) ? 'overdue' : d.st;
const invChip = d => { const s = invStatus(d); return s === 'paid' ? 'ok' : s === 'overdue' ? 'red' : s === 'draft' || s === 'void' ? '' : s === 'part' ? 'new' : 'amber'; };
const INV_LABEL = s => s === 'overdue' ? 'Overdue' : INV_ST[s] || s;
const invCalc = (lines, taxp, disc) => { const sub = r2((lines || []).reduce((a, l) => a + (+l.q || 0) * (+l.u || 0), 0)); const tax = r2(sub * (+taxp || 0) / 100); const total = r2(Math.max(0, sub + tax - (+disc || 0))); return { sub, tax, total }; };
const invBalance = d => r2((+d.total || 0) - (+d.paid || 0));
const addDaysStr = (k, n) => addDays(k, n);

async function buildInvoicePdf(d, org) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo = null; try { const r = await fetch(LOGO_L); if (r.ok) logo = await pdf.embedPng(new Uint8Array(await r.arrayBuffer())); } catch (e) { /* no logo */ }
  const navy = rgb(0.063, 0.106, 0.208), grey = rgb(0.42, 0.46, 0.55), teal = rgb(0.012, 0.63, 0.61), line = rgb(0.86, 0.89, 0.93);
  const M = n => ascii(fmtMoney(n, d.cur));
  let page = pdf.addPage([612, 792]); let y = 740;
  const text = (t, x, size, f, color, opts) => page.drawText(ascii(t), { x, y: (opts && opts.y) != null ? opts.y : y, size, font: f || font, color: color || navy, ...(opts || {}) });
  const wrap = (t, size, f, maxW) => { const words = ascii(t).split(/\s+/); const out = []; let cur = ''; words.forEach(w => { const test = cur ? cur + ' ' + w : w; if ((f || font).widthOfTextAtSize(test, size) > maxW && cur) { out.push(cur); cur = w; } else cur = test; }); if (cur) out.push(cur); return out; };
  const newPage = () => { page = pdf.addPage([612, 792]); y = 740; };
  if (logo) { const w = 150, h = w * logo.height / logo.width; page.drawImage(logo, { x: 50, y: y - h + 10, width: w, height: h }); }
  text('INVOICE', 440, 26, bold, navy); text(d.num, 440, 11, font, grey, { y: y - 22 }); y -= 54;
  const left = [org.co || 'StratEdge IT Consulting Inc.', ...(org.addr || '').split('\n'), org.email || CO.email, org.phone || CO.phone].filter(Boolean);
  left.forEach((l, i) => text(l, 50, i === 0 ? 11 : 9.5, i === 0 ? bold : font, i === 0 ? navy : grey, { y: y - i * 13 }));
  const meta = [['Issue date', fmtDate(d.issue, { month: 'short', day: 'numeric', year: 'numeric' })], ['Due date', d.due ? fmtDate(d.due, { month: 'short', day: 'numeric', year: 'numeric' }) : '-'], ['Terms', d.terms ? `Net ${d.terms}` : 'Due on receipt'], d.period && d.period.f ? ['Period', `${fmtDate(d.period.f, { month: 'short', day: 'numeric' })} - ${fmtDate(d.period.t || d.period.f, { month: 'short', day: 'numeric', year: 'numeric' })}`] : null].filter(Boolean);
  meta.forEach(([k, v], i) => { text(k, 380, 9, font, grey, { y: y - i * 14 }); text(v, 460, 9.5, bold, navy, { y: y - i * 14 }); });
  y -= Math.max(left.length, meta.length) * 14 + 22;
  text('BILL TO', 50, 8.5, bold, teal); y -= 14;
  [d.bill.co, d.bill.n, d.bill.e, ...(d.bill.addr || '').split('\n')].filter(Boolean).forEach((l, i) => text(l, 50, i === 0 ? 11 : 9.5, i === 0 ? bold : font, i === 0 ? navy : grey, { y: y - i * 13 }));
  y -= [d.bill.co, d.bill.n, d.bill.e, ...(d.bill.addr || '').split('\n')].filter(Boolean).length * 13 + 24;
  const head = () => { page.drawRectangle({ x: 50, y: y - 6, width: 512, height: 22, color: rgb(0.95, 0.96, 0.98) }); text('Description', 58, 9, bold, grey, { y: y + 1 }); text('Qty', 380, 9, bold, grey, { y: y + 1 }); text('Unit price', 430, 9, bold, grey, { y: y + 1 }); text('Amount', 505, 9, bold, grey, { y: y + 1 }); y -= 26; };
  head();
  (d.lines || []).forEach(l => {
    const ls = wrap(l.d || '', 9.5, font, 300); const h = Math.max(1, ls.length) * 12 + 8;
    if (y - h < 150) { newPage(); head(); }
    ls.forEach((t, i) => text(t, 58, 9.5, font, navy, { y: y - i * 12 }));
    text(String(+l.q || 0), 380, 9.5, font, navy); text(M(+l.u || 0), 430, 9.5, font, navy); text(M((+l.q || 0) * (+l.u || 0)), 505, 9.5, font, navy);
    y -= h; page.drawLine({ start: { x: 50, y: y + 4 }, end: { x: 562, y: y + 4 }, thickness: .5, color: line });
  });
  if (y < 190) { newPage(); }
  y -= 10; const tot = [['Subtotal', M(d.sub)], d.tax ? [`Tax (${d.taxp}%)`, M(d.tax)] : null, d.disc ? ['Discount', '-' + M(d.disc)] : null, ['Total', M(d.total)], d.paid ? ['Paid', '-' + M(d.paid)] : null, d.paid ? ['Balance due', M(invBalance(d))] : null].filter(Boolean);
  tot.forEach(([k, v], i) => { const big = k === 'Total' || k === 'Balance due'; text(k, 400, big ? 11 : 9.5, big ? bold : font, big ? navy : grey, { y }); text(v, 505, big ? 11 : 9.5, big ? bold : font, navy, { y }); y -= big ? 18 : 14; });
  y -= 14;
  if (d.notes) { text('Notes', 50, 8.5, bold, teal); y -= 13; wrap(d.notes, 9.5, font, 500).forEach(t => { text(t, 50, 9.5, font, navy); y -= 12; }); y -= 8; }
  if (d.pay) { text('Payment instructions', 50, 8.5, bold, teal); y -= 13; wrap(d.pay, 9.5, font, 500).forEach(t => { text(t, 50, 9.5, font, navy); y -= 12; }); }
  pdf.getPages().forEach((p, i, arr) => p.drawText(ascii(`${d.num}  ·  ${org.co || 'StratEdge IT Consulting Inc.'}  ·  Page ${i + 1} of ${arr.length}`), { x: 50, y: 30, size: 8, font, color: grey }));
  return await pdf.save();
}
function InvoiceView({ d }) {
  const M = n => fmtMoney(n, d.cur);
  return html`<div className="invdoc">
    <div className="invdoc-head"><div><div className="mono">INVOICE</div><h3>${d.num}</h3><${Chip} s=${invChip(d)}>${INV_LABEL(invStatus(d))}<//></div>
      <dl className="kv" style=${{ gridTemplateColumns: '110px auto' }}><dt>Issue date</dt><dd>${fmtDate(d.issue, { month: 'short', day: 'numeric', year: 'numeric' })}</dd><dt>Due</dt><dd>${d.due ? fmtDate(d.due, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}${d.terms ? ` (Net ${d.terms})` : ''}</dd>${d.period && d.period.f && html`<dt>Period</dt><dd>${fmtDate(d.period.f)} – ${fmtDate(d.period.t || d.period.f)}</dd>`}</dl></div>
    <div className="invdoc-bill"><span className="mono">BILL TO</span><b>${d.bill.co}</b>${d.bill.n && html`<div>${d.bill.n}</div>`}${d.bill.e && html`<div className="muted small">${d.bill.e}</div>`}${d.bill.addr && html`<div className="muted small" style=${{ whiteSpace: 'pre-wrap' }}>${d.bill.addr}</div>`}</div>
    <div className="tblwrap"><table className="tbl"><thead><tr><th>Description</th><th className="r">Qty</th><th className="r">Unit price</th><th className="r">Amount</th></tr></thead>
      <tbody>${(d.lines || []).map((l, i) => html`<tr key=${i}><td>${l.d}</td><td className="r num">${+l.q || 0}</td><td className="r num">${M(+l.u || 0)}</td><td className="r num">${M((+l.q || 0) * (+l.u || 0))}</td></tr>`)}
        <tr className="sum"><td colSpan="3" className="r">Subtotal</td><td className="r num">${M(d.sub)}</td></tr>
        ${d.tax > 0 && html`<tr><td colSpan="3" className="r">Tax (${d.taxp}%)</td><td className="r num">${M(d.tax)}</td></tr>`}
        ${d.disc > 0 && html`<tr><td colSpan="3" className="r">Discount</td><td className="r num">− ${M(d.disc)}</td></tr>`}
        <tr className="sum"><td colSpan="3" className="r"><b>Total</b></td><td className="r num"><b>${M(d.total)}</b></td></tr>
        ${d.paid > 0 && html`<tr><td colSpan="3" className="r">Paid</td><td className="r num">− ${M(d.paid)}</td></tr><tr className="sum"><td colSpan="3" className="r"><b>Balance due</b></td><td className="r num"><b>${M(invBalance(d))}</b></td></tr>`}
      </tbody></table></div>
    ${d.notes && html`<p className="small" style=${{ marginTop: 14, whiteSpace: 'pre-wrap' }}><b>Notes.</b> ${d.notes}</p>`}
    ${d.pay && html`<p className="small muted" style=${{ marginTop: 10, whiteSpace: 'pre-wrap' }}><b>Payment instructions.</b> ${d.pay}</p>`}
  </div>`;
}

/* ---- Editor ---- */
function InvoiceEditor({ inv, onClose, onSaved }) {
  const P = usePortal(); const A = P.admin; const toast = useToast(); const org = (P.settings && P.settings.inv) || {};
  const today = dkey();
  const [f, setF] = useState(inv ? { ...inv, lines: (inv.lines || []).map(l => ({ ...l })), bill: { ...inv.bill }, period: { ...(inv.period || {}) } } : { cur: 'USD', cid: '', bill: { co: '', n: '', e: '', addr: '' }, issue: today, terms: org.terms != null ? +org.terms : 30, due: addDaysStr(today, org.terms != null ? +org.terms : 30), period: { f: '', t: '' }, lines: [{ d: '', q: 1, u: '' }], taxp: org.taxp || 0, disc: 0, notes: '', pay: org.pay || '' });
  const [busy, setBusy] = useState(false);
  const up = k => e => { const v = e.target.value; setF(x => k === 'terms' ? { ...x, terms: v, due: x.issue && v !== '' ? addDaysStr(x.issue, +v) : x.due } : k === 'issue' ? { ...x, issue: v, due: v && x.terms !== '' ? addDaysStr(v, +x.terms) : x.due } : { ...x, [k]: v }); };
  const upB = k => e => setF(x => ({ ...x, bill: { ...x.bill, [k]: e.target.value } }));
  const setLine = (i, k, v) => setF(x => ({ ...x, lines: x.lines.map((l, j) => j === i ? { ...l, [k]: v } : l) }));
  const pickClient = e => { const cid = e.target.value; const c = A.clientsById[cid]; const contact = A.members.find(m => m.role === 'employer' && m.r && m.r.cid === cid);
    setF(x => ({ ...x, cid, bill: { ...x.bill, co: c ? c.n : x.bill.co, n: contact ? contact.u.p.n : x.bill.n, e: contact ? contact.u.p.e : x.bill.e, addr: c && c.loc ? c.loc : x.bill.addr } })); };
  const pull = () => {
    if (!f.cid) { toast('Choose a client first.', true); return; }
    if (!f.period.f || !f.period.t) { toast('Set the billing period first.', true); return; }
    const lines = [];
    A.members.filter(m => m.role !== 'employer' && m.r && m.r.cid === f.cid).forEach(m => {
      Object.entries(m.u.ts || {}).forEach(([w, s]) => { if (w < f.period.f || w > f.period.t) return; if (tsStatus(s, ((m.r || {}).rev || {})[w]) !== 'approved') return; if (!(s.t > 0)) return;
        lines.push({ d: `${m.u.p.n}, week of ${weekLabel(w)} (${h1(s.t)} h${m.r.ti ? ', ' + m.r.ti : ''})`, q: r2(s.t), u: m.r.br ? r2(m.r.br) : '' }); });
    });
    if (!lines.length) { toast('No approved timesheets for this client in that period.', true); return; }
    setF(x => ({ ...x, lines: [...x.lines.filter(l => l.d || l.u), ...lines] })); toast(`${lines.length} approved week${lines.length === 1 ? '' : 's'} added. Check the rates.`);
  };
  const calc = invCalc(f.lines, f.taxp, f.disc);
  const save = async () => {
    const lines = f.lines.filter(l => (l.d || '').trim() || +l.u).map(l => ({ d: (l.d || '').trim(), q: r2(l.q), u: r2(l.u) }));
    if (!f.bill.co.trim()) { toast('Add who the invoice is billed to.', true); return; }
    if (!lines.length) { toast('Add at least one line.', true); return; }
    setBusy(true);
    try {
      let num = f.num; if (!num) num = (await api('inv_next')).num;
      const id = f.id || nid(); const now = Date.now(); const c = invCalc(lines, f.taxp, f.disc);
      const doc = { num, cur: f.cur, cid: f.cid || '', bill: { co: f.bill.co.trim(), n: (f.bill.n || '').trim(), e: (f.bill.e || '').trim(), addr: (f.bill.addr || '').trim() }, issue: f.issue, terms: f.terms === '' ? 0 : +f.terms, due: f.due, period: { f: f.period.f || '', t: f.period.t || '' }, lines, taxp: r2(f.taxp), disc: r2(f.disc), sub: c.sub, tax: c.tax, total: c.total, paid: r2(inv ? inv.paid : 0), notes: (f.notes || '').trim(), pay: (f.pay || '').trim(),
        st: inv ? inv.st : 'draft', pays: inv ? inv.pays || [] : [], tok: inv ? inv.tok || '' : '', fid: inv ? inv.fid || '' : '', at: inv ? inv.at : now, by: inv ? inv.by : P.uid, byn: inv ? inv.byn : (P.prof ? P.prof.n : (Cap.me && Cap.me.name) || ''), u: now, log: inv ? [...(inv.log || []), { t: now, who: (P.prof && P.prof.n) || '', ev: 'Edited', ip: '' }] : [{ t: now, who: (P.prof && P.prof.n) || (Cap.me && Cap.me.name) || '', ev: 'Created', ip: '' }] };
      await dbSet(`inv/${id}`, doc); if (inv && inv.cid && inv.st !== 'draft') await dbSet(`pub/${inv.cid}/inv/${id}`, { ...doc, id, log: undefined });
      toast(inv ? 'Invoice updated.' : `Invoice ${num} saved as a draft.`); onSaved && onSaved(id); onClose();
    } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const M = n => fmtMoney(n, f.cur);
  return html`<${Modal} wide title=${inv ? 'Edit ' + inv.num : 'New invoice'} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : inv ? 'Save changes' : 'Save draft'}</button>`}>
    <div className="form">
      <div className="row3">
        <${Field} label="Client workspace (optional)" hint="Links the invoice to the client portal and lets you pull approved hours."><select value=${f.cid} onChange=${pickClient}><option value="">None (vendor or other)</option>${A.clients.map(c => html`<option key=${c.id} value=${c.id}>${c.n}</option>`)}</select><//>
        <${Field} label="Currency"><select value=${f.cur} onChange=${up('cur')}><option value="USD">US dollar ($)</option><option value="INR">Indian rupee (₹)</option></select><//>
        <${Field} label="Invoice number"><input value=${f.num || ''} disabled placeholder="Assigned when saved" /><//></div>
      <div className="row2"><${Field} label="Bill to (company)"><input value=${f.bill.co} onInput=${upB('co')} placeholder="Client or vendor name" /><//><${Field} label="Contact name"><input value=${f.bill.n} onInput=${upB('n')} /><//></div>
      <div className="row2"><${Field} label="Contact email" hint="Where the invoice is sent."><input type="email" value=${f.bill.e} onInput=${upB('e')} /><//><${Field} label="Billing address"><textarea value=${f.bill.addr} onInput=${upB('addr')} style=${{ minHeight: 60 }} /><//></div>
      <div className="row3"><${Field} label="Issue date"><input type="date" value=${f.issue} onInput=${up('issue')} /><//><${Field} label="Terms (days)"><input type="number" min="0" value=${f.terms} onInput=${up('terms')} /><//><${Field} label="Due date"><input type="date" value=${f.due} onInput=${up('due')} /><//></div>
      <div className="row3"><${Field} label="Billing period from"><input type="date" value=${f.period.f} onInput=${e => setF(x => ({ ...x, period: { ...x.period, f: e.target.value } }))} /><//><${Field} label="to"><input type="date" value=${f.period.t} onInput=${e => setF(x => ({ ...x, period: { ...x.period, t: e.target.value } }))} /><//>
        <div className="fld"><span>Approved hours</span><button type="button" className="btn ghost" onClick=${pull}><${Icon} n="sheet" />Add approved timesheets</button></div></div>
      <div><span className="lbl">Lines</span>
        <div className="invlines">${f.lines.map((l, i) => html`<div key=${i} className="invline"><input value=${l.d} onInput=${e => setLine(i, 'd', e.target.value)} placeholder="Description" aria-label="Description" /><input type="number" step="0.25" min="0" value=${l.q} onInput=${e => setLine(i, 'q', e.target.value)} aria-label="Quantity" /><input type="number" step="0.01" min="0" value=${l.u} onInput=${e => setLine(i, 'u', e.target.value)} placeholder="Unit price" aria-label="Unit price" /><span className="num r">${M((+l.q || 0) * (+l.u || 0))}</span><button type="button" className="btn ghost icon" aria-label="Remove line" onClick=${() => setF(x => ({ ...x, lines: x.lines.filter((_, j) => j !== i) }))}><${Icon} n="trash" /></button></div>`)}</div>
        <button type="button" className="btn ghost sm" style=${{ marginTop: 8 }} onClick=${() => setF(x => ({ ...x, lines: [...x.lines, { d: '', q: 1, u: '' }] }))}><${Icon} n="plus" />Add line</button></div>
      <div className="row3"><${Field} label="Tax %"><input type="number" step="0.01" min="0" value=${f.taxp} onInput=${up('taxp')} /><//><${Field} label="Discount (amount)"><input type="number" step="0.01" min="0" value=${f.disc} onInput=${up('disc')} /><//>
        <div className="fld"><span>Total</span><div className="bignum">${M(calc.total)}</div><small>Subtotal ${M(calc.sub)}${calc.tax ? `, tax ${M(calc.tax)}` : ''}</small></div></div>
      <div className="row2"><${Field} label="Notes (printed on the invoice)"><textarea value=${f.notes} onInput=${up('notes')} placeholder="PO number, project reference, thank you" /><//><${Field} label="Payment instructions"><textarea value=${f.pay} onInput=${up('pay')} placeholder="Bank name, account, routing, UPI, or a payment link" /><//></div>
    </div><//>`;
}

/* ---- Detail: preview, send, payments ---- */
function SendInvoice({ d, onClose }) {
  const P = usePortal(); const toast = useToast(); const org = (P.settings && P.settings.inv) || {};
  const [f, setF] = useState({ to: d.bill.e || '', cc: '', note: '' }); const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!/^\S+@\S+\.\S+$/.test(f.to)) { toast('Enter a valid email address.', true); return; }
    setBusy(true);
    try { const bytes = await buildInvoicePdf(d, org); const fd = new FormData(); fd.append('id', d.id); fd.append('to', f.to.trim()); fd.append('cc', f.cc.trim()); fd.append('note', f.note.trim()); fd.append('file', new Blob([bytes], { type: 'application/pdf' }), `${d.num}.pdf`);
      const r = await upload('inv_send', fd); Sync.kick(); toast(r.mailed ? `Invoice emailed to ${f.to}.` : 'The invoice was saved and marked sent, but the email could not be delivered. Check mail settings in api/config.php, or share the link.', !r.mailed); onClose(); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  return html`<${Modal} title=${'Email ' + d.num} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${send}><${Icon} n="send" />${busy ? 'Sending…' : 'Send invoice'}</button>`}>
    <div className="form">
      <${Field} label="To"><input type="email" value=${f.to} onInput=${e => setF({ ...f, to: e.target.value })} /><//>
      <${Field} label="Cc (optional, comma-separated)"><input value=${f.cc} onInput=${e => setF({ ...f, cc: e.target.value })} placeholder="accounts@client.com, you@stratedge.com" /><//>
      <${Field} label="Message"><textarea value=${f.note} onInput=${e => setF({ ...f, note: e.target.value })} placeholder="Optional note included in the email" /><//>
      <p className="muted small">The email includes the PDF and a secure link where they can view and download the invoice. Opening the link marks it as viewed here.</p>
    </div><//>`;
}
function RecordPayment({ d, onClose }) {
  const P = usePortal(); const toast = useToast();
  const [f, setF] = useState({ a: invBalance(d), dt: dkey(), m: 'Bank transfer', ref: '' }); const [busy, setBusy] = useState(false);
  const save = async () => {
    const a = r2(f.a); if (!(a > 0)) { toast('Enter the amount received.', true); return; }
    setBusy(true);
    try { const paid = r2((+d.paid || 0) + a); const st = paid >= d.total - 0.005 ? 'paid' : 'part'; const now = Date.now();
      await dbMerge(`inv/${d.id}`, { paid, st, pays: [...(d.pays || []), { a, dt: f.dt, m: f.m, ref: f.ref.trim(), at: now }], log: [...(d.log || []), { t: now, who: (P.prof && P.prof.n) || '', ev: `Payment recorded: ${fmtMoney(a, d.cur)}${f.ref ? ' (' + f.ref + ')' : ''}`, ip: '' }], u: now });
      if (d.cid && d.st !== 'draft') await dbMerge(`pub/${d.cid}/inv/${d.id}`, { paid, st, u: now });
      toast(st === 'paid' ? 'Invoice marked paid.' : 'Payment recorded.'); onClose(); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  return html`<${Modal} title=${'Record payment for ' + d.num} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn go" disabled=${busy} onClick=${save}>Record payment</button>`}>
    <div className="form"><div className="row2"><${Field} label=${'Amount received (' + d.cur + ')'}><input type="number" step="0.01" min="0" value=${f.a} onInput=${e => setF({ ...f, a: e.target.value })} /><//><${Field} label="Date"><input type="date" value=${f.dt} onInput=${e => setF({ ...f, dt: e.target.value })} /><//></div>
      <div className="row2"><${Field} label="Method"><select value=${f.m} onChange=${e => setF({ ...f, m: e.target.value })}>${['Bank transfer', 'ACH', 'Wire', 'Check', 'Card', 'UPI', 'Other'].map(x => html`<option key=${x}>${x}</option>`)}</select><//><${Field} label="Reference"><input value=${f.ref} onInput=${e => setF({ ...f, ref: e.target.value })} placeholder="Transaction or check number" /><//></div>
      <p className="muted small">Balance before this payment: ${fmtMoney(invBalance(d), d.cur)}.</p></div><//>`;
}
function InvoiceDetail({ d, onClose, onEdit }) {
  const P = usePortal(); const toast = useToast(); const org = (P.settings && P.settings.inv) || {};
  const [send, setSend] = useState(false); const [pay, setPay] = useState(false); const [busy, setBusy] = useState(false);
  const download = async () => { setBusy(true); try { const bytes = await buildInvoicePdf(d, org); await saveDownload(`${d.num}.pdf`, new Blob([bytes], { type: 'application/pdf' })); } catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); } setBusy(false); };
  const voidIt = async () => { try { const now = Date.now(); await dbMerge(`inv/${d.id}`, { st: 'void', u: now, log: [...(d.log || []), { t: now, who: (P.prof && P.prof.n) || '', ev: 'Voided', ip: '' }] }); if (d.cid && d.tok) await dbMerge(`pub/${d.cid}/inv/${d.id}`, { st: 'void', u: now }); toast('Invoice voided.'); onClose(); } catch (e) { toast(errText(e), true); } };
  const link = d.tok ? location.origin + location.pathname + '#/invoice/' + d.id + '/' + d.tok : '';
  const copy = async () => { try { await navigator.clipboard.writeText(link); toast('Invoice link copied.'); } catch (e) { prompt('Copy this invoice link', link); } };
  return html`<${Modal} wide title=${`${d.num}: ${d.bill.co}`} onClose=${onClose} foot=${html`
      ${d.st === 'draft' && html`<button type="button" className="btn ghost" onClick=${() => onEdit(d)}>Edit</button>`}
      ${d.st !== 'void' && d.st !== 'paid' && html`<button type="button" className="btn ghost" onClick=${voidIt}>Void</button>`}
      <button type="button" className="btn ghost" disabled=${busy} onClick=${download}><${Icon} n="down" />PDF</button>
      ${d.st !== 'void' && d.st !== 'paid' && html`<button type="button" className="btn ghost" onClick=${() => setPay(true)}>Record payment</button>`}
      ${d.st !== 'void' && html`<button type="button" className="btn" onClick=${() => setSend(true)}><${Icon} n="send" />${d.st === 'draft' ? 'Send by email' : 'Resend'}</button>`}`}>
    <div className="stack">
      <div className="actions"><${Chip} s=${invChip(d)}>${INV_LABEL(invStatus(d))}<//><span className="muted small">${d.sentAt ? 'Sent ' + fmtTs(d.sentAt) + (d.to ? ' to ' + d.to : '') : 'Not sent yet'}${d.viewedAt ? ', viewed ' + fmtTs(d.viewedAt) : ''}</span>${link && html`<button type="button" className="btn link small" onClick=${copy}>Copy view link</button>`}</div>
      <${InvoiceView} d=${d} />
      ${(d.pays || []).length > 0 && html`<div><h3 className="ph" style=${{ marginBottom: 8 }}>Payments</h3><ul className="list">${d.pays.map((p, i) => html`<li key=${i}><div><div className="t">${fmtMoney(p.a, d.cur)}</div><div className="m">${p.m}${p.ref ? ', ' + p.ref : ''}</div></div><span className="muted small num">${fmtDate(p.dt, { month: 'short', day: 'numeric', year: 'numeric' })}</span></li>`)}</ul></div>`}
      <div><h3 className="ph" style=${{ marginBottom: 8 }}>History</h3><ul className="list">${(d.log || []).slice().reverse().map((l, i) => html`<li key=${i}><div><div className="t">${l.ev}</div><div className="m">${l.who}</div></div><span className="muted small num">${fmtTs(l.t)}</span></li>`)}</ul></div>
    </div>
    ${send && html`<${SendInvoice} d=${d} onClose=${() => { setSend(false); onClose(); }} />`}
    ${pay && html`<${RecordPayment} d=${d} onClose=${() => { setPay(false); onClose(); }} />`}<//>`;
}
function BillingSettings({ onClose }) {
  const P = usePortal(); const toast = useToast(); const org = (P.settings && P.settings.inv) || {};
  const [f, setF] = useState({ co: org.co || CO.legal, addr: org.addr || `${CO.addr1}\n${CO.addr2}`, email: org.email || CO.email, phone: org.phone || CO.phone, pay: org.pay || '', taxp: org.taxp || 0, terms: org.terms != null ? org.terms : 30 });
  const [busy, setBusy] = useState(false); const up = k => e => setF({ ...f, [k]: e.target.value });
  const save = async () => { setBusy(true); try { await dbMerge('org/main/x/settings', { inv: { ...f, taxp: r2(f.taxp), terms: +f.terms || 0 } }); toast('Billing settings saved.'); onClose(); } catch (e) { toast(errText(e), true); } setBusy(false); };
  return html`<${Modal} title="Billing settings" onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${save}>Save</button>`}>
    <div className="form"><${Field} label="Company name on invoices"><input value=${f.co} onInput=${up('co')} /><//>
      <${Field} label="Address"><textarea value=${f.addr} onInput=${up('addr')} style=${{ minHeight: 70 }} /><//>
      <div className="row2"><${Field} label="Billing email"><input value=${f.email} onInput=${up('email')} /><//><${Field} label="Phone"><input value=${f.phone} onInput=${up('phone')} /><//></div>
      <div className="row2"><${Field} label="Default tax %"><input type="number" step="0.01" value=${f.taxp} onInput=${up('taxp')} /><//><${Field} label="Default terms (days)"><input type="number" value=${f.terms} onInput=${up('terms')} /><//></div>
      <${Field} label="Payment instructions (printed on every new invoice)"><textarea value=${f.pay} onInput=${up('pay')} placeholder="Bank name, account number, routing number, SWIFT, UPI ID or a payment link" /><//>
      <p className="muted small">Outgoing email settings (SMTP or the host\u2019s mail function) live in api/config.php.</p></div><//>`;
}
function InvoicesAdmin() {
  const P = usePortal(); const A = P.admin;
  const col = useCol('inv', 'u:desc');
  const [tab, setTab] = useState('open'); const [edit, setEdit] = useState(undefined); const [open, setOpen] = useState(null); const [cfgOpen, setCfgOpen] = useState(false); const [q, setQ] = useState('');
  if (A.loading) return html`<${Spinner} />`;
  const docs = col.docs; const ql = q.trim().toLowerCase();
  const list = docs.filter(d => { const s = invStatus(d); return (tab === 'all' || (tab === 'open' ? ['sent', 'viewed', 'part', 'overdue'].includes(s) : tab === 'overdue' ? s === 'overdue' : s === tab)) && (!ql || [d.num, d.bill.co, d.bill.n, d.bill.e].join(' ').toLowerCase().includes(ql)); });
  const out = {}; docs.filter(d => ['sent', 'viewed', 'part'].includes(d.st)).forEach(d => { out[d.cur] = (out[d.cur] || 0) + invBalance(d); });
  const overdue = docs.filter(invOverdue).length;
  const cur = open && docs.find(d => d.id === open);
  return html`<div className="stack">
    <div className="kpis" style=${{ gridTemplateColumns: `repeat(${Object.keys(out).length + 2},minmax(0,1fr))` }}>
      ${Object.entries(out).map(([c, v]) => html`<a key=${c}><b>${fmtMoney(v, c)}</b><span>Outstanding (${c})</span></a>`)}<a><b>${overdue}</b><span>Overdue</span></a><a><b>${docs.filter(d => d.st === 'draft').length}</b><span>Drafts</span></a></div>
    <div className="toolbar"><div className="tabs" role="tablist" style=${{ marginBottom: 0, border: 0 }}>${[['open', 'Open'], ['overdue', 'Overdue'], ['draft', 'Drafts'], ['paid', 'Paid'], ['all', 'All']].map(([k, v]) => html`<button type="button" key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}</button>`)}</div>
      <input type="search" style=${{ maxWidth: 220 }} placeholder="Search" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search invoices" />
      <div className="push"><button type="button" className="btn ghost" onClick=${() => setCfgOpen(true)}>Billing settings</button><button type="button" className="btn" onClick=${() => setEdit(null)}><${Icon} n="plus" />New invoice</button></div></div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${col.loading ? html`<${Spinner} />` : list.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Invoice</th><th>Billed to</th><th>Issued</th><th>Due</th><th className="r">Total</th><th className="r">Balance</th><th>Status</th></tr></thead>
        <tbody>${list.map(d => html`<tr key=${d.id} className="click" tabIndex="0" onClick=${() => setOpen(d.id)}><td><b style=${{ fontWeight: 600 }}>${d.num}</b></td><td>${d.bill.co}<div className="muted small">${d.bill.e || ''}</div></td><td className="num nw">${fmtDate(d.issue)}</td><td className="num nw">${d.due ? fmtDate(d.due) : '—'}</td>
          <td className="r num">${fmtMoney(d.total, d.cur)}</td><td className="r num">${['paid', 'void'].includes(d.st) ? '—' : fmtMoney(invBalance(d), d.cur)}</td><td><${Chip} s=${invChip(d)}>${INV_LABEL(invStatus(d))}<//></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title=${tab === 'open' ? 'No open invoices' : 'No invoices here yet'} action=${html`<button type="button" className="btn" onClick=${() => setEdit(null)}>Create an invoice</button>`}>Build an invoice from approved timesheet hours or your own lines, email it with the PDF attached, and track viewed, paid and overdue here. Clients also see their invoices in the client portal.<//>`}
    </section>
    ${edit !== undefined && html`<${InvoiceEditor} inv=${edit} onClose=${() => setEdit(undefined)} onSaved=${id => setOpen(id)} />`}
    ${cur && html`<${InvoiceDetail} key=${cur.id + cur.u} d=${cur} onClose=${() => setOpen(null)} onEdit=${d => { setOpen(null); setEdit(d); }} />`}
    ${cfgOpen && html`<${BillingSettings} onClose=${() => setCfgOpen(false)} />`}
  </div>`;
}
/* ---- Client portal ---- */
function ClientInvoices() {
  const P = usePortal(); const col = useCol(`pub/${P.cid}/inv`, 'u:desc');
  const docs = col.docs.filter(d => d.st !== 'draft');
  const out = docs.filter(d => ['sent', 'viewed', 'part'].includes(d.st)).reduce((a, d) => a + invBalance(d), 0);
  return html`<div className="stack">
    ${docs.length > 0 && html`<div className="kpis" style=${{ gridTemplateColumns: 'repeat(2,minmax(0,1fr))' }}><a><b>${fmtMoney(out, (docs[0] || {}).cur || 'USD')}</b><span>Balance outstanding</span></a><a><b>${docs.filter(invOverdue).length}</b><span>Overdue</span></a></div>`}
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${col.loading ? html`<${Spinner} />` : docs.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Invoice</th><th>Issued</th><th>Due</th><th className="r">Total</th><th className="r">Balance</th><th>Status</th><th /></tr></thead>
        <tbody>${docs.map(d => html`<tr key=${d.id}><td><b style=${{ fontWeight: 600 }}>${d.num}</b>${d.period && d.period.f ? html`<div className="muted small">${fmtDate(d.period.f)} – ${fmtDate(d.period.t)}</div>` : ''}</td><td className="num nw">${fmtDate(d.issue)}</td><td className="num nw">${d.due ? fmtDate(d.due) : '—'}</td><td className="r num">${fmtMoney(d.total, d.cur)}</td><td className="r num">${['paid', 'void'].includes(d.st) ? '—' : fmtMoney(invBalance(d), d.cur)}</td><td><${Chip} s=${invChip(d)}>${INV_LABEL(invStatus(d))}<//></td>
          <td className="r"><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>${d.tok && html`<a className="btn ghost sm" href=${'#/invoice/' + d.id + '/' + d.tok}>View</a>`}${d.fid && d.tok && html`<a className="btn ghost sm" href=${fileUrl('inv/' + d.id, d.fid, true, d.tok)}><${Icon} n="down" />PDF</a>`}</div></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title="No invoices yet">Invoices StratEdge sends your company appear here with their status and PDF.<//>`}
    </section>
  </div>`;
}
/* ---- Public page from the email link ---- */
function InvoicePublic({ id, tok }) {
  const [d, setD] = useState(undefined);
  useEffect(() => { api('inv_public_get&id=' + encodeURIComponent(id) + '&tok=' + encodeURIComponent(tok)).then(r => setD(r.d)).catch(() => setD(null)); }, [id, tok]);
  return html`<${Fragment}>
    <${PageHead} title=${d ? 'Invoice ' + d.num : 'Invoice'} intro=${d ? `From StratEdge IT Consulting to ${d.bill.co}.` : ''} />
    <section className="sec" style=${{ paddingTop: 48 }}><div className="wrap" style=${{ maxWidth: 900 }}>
      ${d === undefined ? html`<${Spinner} label="Loading the invoice…" />` : d === null ? html`<div className="panel"><${Empty} title="This invoice link isn\u2019t valid">Contact ${CO.email} and we\u2019ll resend it.<//></div>`
        : html`<div className="panel stack"><${InvoiceView} d=${d} /><div className="actions">${d.fid && html`<a className="btn" href=${fileUrl('inv/' + d.id, d.fid, true, tok)}><${Icon} n="down" />Download PDF</a>`}<a className="btn ghost" href=${'mailto:' + CO.email + '?subject=' + encodeURIComponent('Invoice ' + d.num)}>Question about this invoice</a></div></div>`}
    </div></section>
  <//>`;
}
