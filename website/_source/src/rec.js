/* ================= Recruiting workspace (internal recruiters) ================= */
const candName = (cands, id) => { const c = cands.find(x => x.id === id); return c ? c.n : ''; };
function CandModal({ c, onClose }) {
  const P = usePortal(); const toast = useToast(); const subs = useCol(c ? 'rec/sub/items' : null, 'd:desc');
  const me = (P.prof && P.prof.n) || (Cap.me && Cap.me.name) || '';
  const [f, setF] = useState({ n: '', e: '', ph: '', ti: '', sk: '', auth: 'H-1B', loc: '', reloc: 'Open', rate: '', avail: '', exp: '', li: '', src: '', notes: '', st: 'active', emp: '', empw: '', spon: '', mn: '', mp: '', me: '', ...(c || {}) });
  const [busy, setBusy] = useState(false); const [prog, setProg] = useState(0);
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const mine = !c || c.by === P.uid || P.isAdmin;
  const save = async () => {
    if (!f.n.trim() || !f.ti.trim()) { toast('Add the consultant\u2019s name and title.', true); return; }
    setBusy(true);
    try {
      const id = c ? c.id : nid(); const now = Date.now();
      const { id: _i, ...rest } = f;
      await (c ? dbMerge : dbSet)(`rec/cand/items/${id}`, { ...rest, n: f.n.trim(), ti: f.ti.trim(), by: c ? c.by : P.uid, byn: c ? c.byn : me, at: c ? c.at : now, u: now, un: me });
      toast(c ? 'Consultant updated.' : 'Consultant added.'); onClose();
    } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const onFiles = async fs => {
    if (!c) { toast('Save the consultant first, then attach the resume.', true); return; }
    setBusy(true);
    try { setProg(0.03); const r = await storeFile(`rec/cand/items/${c.id}`, fs[0], { c: 'resume' }, setProg); await dbMerge(`rec/cand/items/${c.id}`, { rid: r.id, rn: r.n, u: Date.now() }); toast('Resume attached.'); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  return html`<${Modal} wide title=${c ? c.n : 'Add a consultant'} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Close</button>${mine && html`<button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : c ? 'Save changes' : 'Add consultant'}</button>`}`}>
    <div className="form">
      <div className="row3"><${Field} label="Full name"><input value=${f.n} onInput=${up('n')} disabled=${!mine} /><//><${Field} label="Title / role"><input value=${f.ti} onInput=${up('ti')} placeholder="e.g. SAP PP/QM Consultant" disabled=${!mine} /><//><${Field} label="Status"><select value=${f.st} onChange=${up('st')} disabled=${!mine}>${Object.entries(CAND_STATUS).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//></div>
      <div className="row3"><${Field} label="Email"><input type="email" value=${f.e} onInput=${up('e')} disabled=${!mine} /><//><${Field} label="Phone"><input type="tel" value=${f.ph} onInput=${up('ph')} disabled=${!mine} /><//><${Field} label="LinkedIn"><input value=${f.li} onInput=${up('li')} placeholder="https://" disabled=${!mine} /><//></div>
      <${Field} label="Key skills"><input value=${f.sk} onInput=${up('sk')} placeholder="e.g. S/4HANA, PP, QM, MM" disabled=${!mine} /><//>
      <div className="row3"><${Field} label="Work authorization"><select value=${f.auth} onChange=${up('auth')} disabled=${!mine}>${AUTH_TYPES.map(a => html`<option key=${a}>${a}</option>`)}</select><//>
        <${Field} label="Experience (years)"><input type="number" min="0" step="0.5" value=${f.exp} onInput=${up('exp')} disabled=${!mine} /><//>
        <${Field} label="Expected rate"><input value=${f.rate} onInput=${up('rate')} placeholder="e.g. $75/hr C2C" disabled=${!mine} /><//></div>
      <div className="row3"><${Field} label="Current location"><input value=${f.loc} onInput=${up('loc')} placeholder="City, state" disabled=${!mine} /><//>
        <${Field} label="Relocation"><select value=${f.reloc} onChange=${up('reloc')} disabled=${!mine}>${['Open', 'Remote only', 'Local only', 'Specific states'].map(x => html`<option key=${x}>${x}</option>`)}</select><//>
        <${Field} label="Available from"><input value=${f.avail} onInput=${up('avail')} placeholder="e.g. Immediately, 2 weeks" disabled=${!mine} /><//></div>
      <div className="row2"><${Field} label="Source"><input value=${f.src} onInput=${up('src')} placeholder="e.g. Dice, LinkedIn, referral" disabled=${!mine} /><//><${Field} label="Notes"><input value=${f.notes} onInput=${up('notes')} placeholder="Interview readiness, references, anything useful" disabled=${!mine} /><//></div>
      <div className="row3"><${Field} label="Current employer / vendor"><input value=${f.emp} onInput=${up('emp')} placeholder="Company the consultant works through" disabled=${!mine} /><//><${Field} label="Employer website"><input value=${f.empw} onInput=${up('empw')} placeholder="https://" disabled=${!mine} /><//><${Field} label="Visa sponsor (if different)"><input value=${f.spon} onInput=${up('spon')} disabled=${!mine} /><//></div>
      <div className="row3"><${Field} label="Manager / reference name"><input value=${f.mn} onInput=${up('mn')} placeholder="Current or previous manager" disabled=${!mine} /><//><${Field} label="Manager phone"><input type="tel" value=${f.mp} onInput=${up('mp')} disabled=${!mine} /><//><${Field} label="Manager email"><input type="email" value=${f.me} onInput=${up('me')} disabled=${!mine} /><//></div>
      <div><span className="lbl">Resume</span>
        ${c && c.rid ? html`<ul className="files" style=${{ marginTop: 8 }}><li><${Icon} n="file" /><div className="fn"><b>${c.rn || 'Resume'}</b></div><${FileActions} base=${'rec/cand/items/' + c.id} f=${{ id: c.rid, n: c.rn || 'resume', ty: '' }} /></li></ul>` : null}
        ${c && mine && html`<div style=${{ marginTop: 8 }}><${FilePick} busy=${busy} progress=${prog} onFiles=${onFiles} label=${c.rid ? 'Replace the resume.' : 'Attach the resume.'} hint="PDF or Word (.docx), up to 10 MB." /></div>`}
        ${!c && html`<p className="muted small" style=${{ marginTop: 6 }}>Save first, then attach the resume.</p>`}</div>
      ${c && html`<p className="muted small">Added by ${c.byn || 'a recruiter'} ${fmtDay(c.at)}${c.u ? ', updated ' + fmtDay(c.u) + (c.un ? ' by ' + c.un : '') : ''}.</p>`}
      ${c && html`<div><span className="lbl">Activity for this consultant</span>
        ${subs.loading ? html`<${Spinner} />` : subs.docs.filter(s => s.cid === c.id).length ? html`<div className="tblwrap" style=${{ marginTop: 8 }}><table className="tbl"><thead><tr><th>Date</th><th>By</th><th>Requirement</th><th>Vendor / client</th><th>RTR</th><th>Status</th></tr></thead>
          <tbody>${subs.docs.filter(s => s.cid === c.id).map(s => html`<tr key=${s.id}><td className="num nw">${fmtDate(s.d)}</td><td><b style=${{ fontWeight: 600 }}>${s.byn || '—'}</b></td><td>${s.req}${s.rate ? html`<div className="muted small">${s.rate}</div>` : ''}</td><td>${s.vn}${s.ec ? html`<div className="muted small">${s.ec}</div>` : ''}</td><td>${s.rtr ? html`<${Chip} s="ok">RTR ${fmtDate(s.rtrAt || s.d, { month: 'short', day: 'numeric' })}<//>` : html`<span className="muted small">No</span>`}</td><td><${Chip} s=${s.st === 'placed' ? 'ok' : s.st === 'rejected' || s.st === 'withdrawn' ? 'red' : s.st === 'interview' || s.st === 'offer' ? 'new' : 'amber'}>${SUB_ST[s.st] || s.st}<//></td></tr>`)}</tbody></table></div>`
          : html`<p className="muted small" style=${{ marginTop: 6 }}>No RTRs or submissions logged for this consultant yet. Anyone on the team can log one under RTRs & submissions.</p>`}</div>`}
    </div><//>`;
}
function RecConsultants() {
  const P = usePortal();
  const cands = useCol('rec/cand/items', 'u:desc'); const subs = useCol('rec/sub/items');
  const [q, setQ] = useState(''); const [mine, setMine] = useState(false); const [open, setOpen] = useState(undefined);
  const ql = q.trim().toLowerCase();
  const list = cands.docs.filter(c => (!mine || c.by === P.uid) && (!ql || [c.n, c.ti, c.sk, c.loc, c.auth, c.byn].filter(Boolean).join(' ').toLowerCase().includes(ql)));
  const cur = open && cands.docs.find(c => c.id === open);
  return html`<div className="stack">
    <div className="toolbar"><input type="search" style=${{ maxWidth: 320 }} placeholder="Search name, skills, location" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search consultants" />
      <label className="check" style=${{ fontSize: 14 }}><input type="checkbox" checked=${mine} onChange=${e => setMine(e.target.checked)} /><span>Only mine</span></label>
      <div className="push"><button className="btn" onClick=${() => setOpen(null)}><${Icon} n="plus" />Add consultant</button></div></div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${cands.loading ? html`<${Spinner} />` : list.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Consultant</th><th>Skills</th><th>Authorization</th><th>Location</th><th>Rate</th><th>Status</th><th>Activity</th><th>Added by</th></tr></thead>
        <tbody>${list.map(c => { const mine = subs.docs.filter(s => s.cid === c.id); const rtr = mine.filter(s => s.rtr).length; const who = [...new Set(mine.map(s => s.byn).filter(Boolean))]; return html`<tr key=${c.id} className="click" tabIndex="0" onClick=${() => setOpen(c.id)} onKeyDown=${e => { if (e.key === 'Enter') setOpen(c.id); }}>
          <td><b style=${{ fontWeight: 600 }}>${c.n}</b><div className="muted small">${c.ti}${c.exp ? `, ${c.exp} yrs` : ''}${c.emp ? ` · ${c.emp}` : ''}</div></td><td className="small">${c.sk || '—'}</td><td>${c.auth || '—'}</td><td>${c.loc || '—'}${c.reloc && c.reloc !== 'Open' ? html`<div className="muted small">${c.reloc}</div>` : ''}</td><td>${c.rate || '—'}</td>
          <td><${Chip} s=${c.st === 'placed' ? 'ok' : c.st === 'inactive' ? '' : c.st === 'working' ? 'new' : c.st === 'hold' ? 'amber' : 'ok'}>${CAND_STATUS[c.st] || c.st}<//></td>
          <td className="small">${mine.length ? html`<b>${rtr}</b> RTR · <b>${mine.length}</b> sub${who.length ? html`<div className="muted small">by ${who.join(', ')}</div>` : ''}` : html`<span className="muted">None yet</span>`}</td><td className="small">${c.byn || ''}</td></tr>`; })}</tbody></table></div>`
        : html`<${Empty} title=${ql ? 'No matches' : 'No consultants yet'} action=${html`<button className="btn" onClick=${() => setOpen(null)}>Add the first consultant</button>`}>Keep every consultant you work with here: skills, authorization, location, rate and resume, so submissions and RTRs can be verified against one record.<//>`}
    </section>
    ${open !== undefined && (open === null || cur) && html`<${CandModal} key=${open || 'new'} c=${cur || null} onClose=${() => setOpen(undefined)} />`}
  </div>`;
}

/* ---- RTRs and submissions ---- */
function SubModal({ s, cands, onClose }) {
  const P = usePortal(); const toast = useToast();
  const me = (P.prof && P.prof.n) || (Cap.me && Cap.me.name) || '';
  const [f, setF] = useState({ d: dkey(), cid: '', cn: '', req: '', vn: '', vw: '', rn: '', rp: '', re: '', ec: '', mn: '', mp: '', mem: '', rate: '', rtr: false, rtrAt: '', st: 'submitted', intv: '', notes: '', ...(s || {}) });
  const [busy, setBusy] = useState(false);
  const up = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const mine = !s || s.by === P.uid || P.isAdmin;
  const save = async () => {
    const cn = f.cid ? candName(cands, f.cid) : f.cn.trim();
    if (!cn || !f.req.trim() || !f.vn.trim()) { toast('Add the consultant, the requirement and the vendor or client.', true); return; }
    setBusy(true);
    try {
      const id = s ? s.id : nid(); const now = Date.now(); const { id: _i, ...rest } = f;
      await (s ? dbMerge : dbSet)(`rec/sub/items/${id}`, { ...rest, cn, req: f.req.trim(), vn: f.vn.trim(), rtr: !!f.rtr, rtrAt: f.rtr ? (f.rtrAt || f.d) : '', by: s ? s.by : P.uid, byn: s ? s.byn : me, at: s ? s.at : now, u: now, un: me });
      toast(s ? 'Entry updated.' : 'Submission logged.'); onClose();
    } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  return html`<${Modal} wide title=${s ? 'Edit submission' : 'Log a submission'} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Close</button>${mine && html`<button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : s ? 'Save' : 'Log it'}</button>`}`}>
    <div className="form">
      <div className="row2"><${Field} label="Date"><input type="date" value=${f.d} max=${dkey()} onInput=${up('d')} disabled=${!mine} /><//>
        <${Field} label="Consultant">${cands.length ? html`<select value=${f.cid} onChange=${up('cid')} disabled=${!mine}><option value="">Type a name below…</option>${cands.map(c => html`<option key=${c.id} value=${c.id}>${c.n}, ${c.ti}</option>`)}</select>` : html`<input value=${f.cn} onInput=${up('cn')} placeholder="Consultant name" disabled=${!mine} />`}<//></div>
      ${cands.length > 0 && !f.cid && html`<${Field} label="Consultant name (if not in the list)"><input value=${f.cn} onInput=${up('cn')} disabled=${!mine} /><//>`}
      <div className="row2"><${Field} label="Requirement / role"><input value=${f.req} onInput=${up('req')} placeholder="e.g. Network Engineer, Edison NJ" disabled=${!mine} /><//><${Field} label="Vendor or client"><input value=${f.vn} onInput=${up('vn')} placeholder="Who you submitted to" disabled=${!mine} /><//></div>
      <div className="row3"><${Field} label="End client"><input value=${f.ec} onInput=${up('ec')} disabled=${!mine} /><//><${Field} label="Rate submitted"><input value=${f.rate} onInput=${up('rate')} placeholder="e.g. $70/hr" disabled=${!mine} /><//>
        <${Field} label="Status"><select value=${f.st} onChange=${up('st')} disabled=${!mine}>${Object.entries(SUB_ST).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//></div>
      <div className="row3"><${Field} label="Vendor website"><input value=${f.vw} onInput=${up('vw')} placeholder="https://" disabled=${!mine} /><//><${Field} label="Vendor recruiter name"><input value=${f.rn} onInput=${up('rn')} disabled=${!mine} /><//><${Field} label="Recruiter phone"><input type="tel" value=${f.rp} onInput=${up('rp')} disabled=${!mine} /><//></div>
      <div className="row3"><${Field} label="Recruiter email"><input type="email" value=${f.re} onInput=${up('re')} disabled=${!mine} /><//><${Field} label="Hiring manager name"><input value=${f.mn} onInput=${up('mn')} disabled=${!mine} /><//><${Field} label="Manager phone"><input type="tel" value=${f.mp} onInput=${up('mp')} disabled=${!mine} /><//></div>
      <${Field} label="Manager email"><input type="email" value=${f.mem} onInput=${up('mem')} disabled=${!mine} /><//>
      <div className="row2"><label className="check" style=${{ alignSelf: 'end', paddingBottom: 12 }}><input type="checkbox" checked=${!!f.rtr} onChange=${up('rtr')} disabled=${!mine} /><span>RTR received from the consultant</span></label>
        ${f.rtr && html`<${Field} label="RTR date"><input type="date" value=${f.rtrAt || f.d} max=${dkey()} onInput=${up('rtrAt')} disabled=${!mine} /><//>`}</div>
      ${(f.st === 'interview' || f.intv) && html`<${Field} label="Interview date"><input type="date" value=${f.intv} onInput=${up('intv')} disabled=${!mine} /><//>`}
      <${Field} label="Notes"><input value=${f.notes} onInput=${up('notes')} placeholder="Feedback, next steps" disabled=${!mine} /><//>
    </div><//>`;
}
const inRange = (d, a, b) => d >= a && d <= b;
function recStats(subs, cands, uid, a, b) {
  const mine = x => !uid || x.by === uid;
  const s = subs.filter(x => mine(x) && inRange(x.d, a, b));
  return { subs: s.length, rtr: subs.filter(x => mine(x) && x.rtr && inRange(x.rtrAt || x.d, a, b)).length, intv: subs.filter(x => mine(x) && x.intv && inRange(x.intv, a, b)).length,
    cands: cands.filter(x => mine(x) && inRange(dkey(new Date(x.at || 0)), a, b)).length, placed: s.filter(x => x.st === 'placed').length };
}
function RecSubmissions() {
  const P = usePortal();
  const subs = useCol('rec/sub/items', 'd:desc'); const cands = useCol('rec/cand/items', 'n:asc');
  const [mine, setMine] = useState(true); const [open, setOpen] = useState(undefined); const [q, setQ] = useState('');
  const today = dkey(); const ws = weekStart(today); const mk = mkey(today);
  const t = recStats(subs.docs, cands.docs, P.uid, today, today), w = recStats(subs.docs, cands.docs, P.uid, ws, addDays(ws, 6)), m = recStats(subs.docs, cands.docs, P.uid, mk + '-01', mk + '-31');
  const ql = q.trim().toLowerCase();
  const list = subs.docs.filter(s => (!mine || s.by === P.uid) && (!ql || [s.cn, s.req, s.vn, s.ec, s.byn].filter(Boolean).join(' ').toLowerCase().includes(ql)));
  const cur = open && subs.docs.find(s => s.id === open);
  return html`<div className="stack">
    <div className="kpis" style=${{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
      <a><b>${t.rtr}<span style=${{ fontSize: 16, fontWeight: 600 }}> RTR / ${t.subs} sub</span></b><span>Today</span></a>
      <a><b>${w.rtr}<span style=${{ fontSize: 16, fontWeight: 600 }}> RTR / ${w.subs} sub</span></b><span>This week</span></a>
      <a><b>${m.rtr}<span style=${{ fontSize: 16, fontWeight: 600 }}> RTR / ${m.subs} sub</span></b><span>This month, ${m.intv} interview${m.intv === 1 ? '' : 's'}, ${m.placed} placed</span></a></div>
    <div className="toolbar"><input type="search" style=${{ maxWidth: 300 }} placeholder="Search consultant, role, vendor" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search submissions" />
      <label className="check" style=${{ fontSize: 14 }}><input type="checkbox" checked=${mine} onChange=${e => setMine(e.target.checked)} /><span>Only mine</span></label>
      <div className="push"><button className="btn" onClick=${() => setOpen(null)}><${Icon} n="plus" />Log submission</button></div></div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${subs.loading ? html`<${Spinner} />` : list.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Date</th><th>Consultant</th><th>Requirement</th><th>Vendor / client</th><th>RTR</th><th>Status</th><th>Recruiter</th></tr></thead>
        <tbody>${list.map(s => html`<tr key=${s.id} className="click" tabIndex="0" onClick=${() => setOpen(s.id)} onKeyDown=${e => { if (e.key === 'Enter') setOpen(s.id); }}>
          <td className="num nw">${fmtDate(s.d)}</td><td><b style=${{ fontWeight: 600 }}>${s.cn}</b></td><td>${s.req}${s.rate ? html`<div className="muted small">${s.rate}</div>` : ''}</td><td>${s.vn}${s.ec ? html`<div className="muted small">${s.ec}</div>` : ''}${s.rn || s.rp ? html`<div className="muted small">${[s.rn, s.rp].filter(Boolean).join(' · ')}</div>` : ''}</td>
          <td>${s.rtr ? html`<${Chip} s="ok">RTR ${fmtDate(s.rtrAt || s.d, { month: 'short', day: 'numeric' })}<//>` : html`<span className="muted small">No</span>`}</td>
          <td><${Chip} s=${s.st === 'placed' ? 'ok' : s.st === 'rejected' || s.st === 'withdrawn' ? 'red' : s.st === 'interview' || s.st === 'offer' ? 'new' : 'amber'}>${SUB_ST[s.st] || s.st}<//>${s.intv ? html`<div className="muted small">Interview ${fmtDate(s.intv)}</div>` : ''}</td><td className="small">${s.byn || ''}</td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title="No submissions logged" action=${html`<button className="btn" onClick=${() => setOpen(null)}>Log the first submission</button>`}>Log each submission with its requirement, vendor and whether the RTR was received. Counts roll up here and into your daily report.<//>`}
    </section>
    ${open !== undefined && (open === null || cur) && html`<${SubModal} key=${open || 'new'} s=${cur || null} cands=${cands.docs} onClose=${() => setOpen(undefined)} />`}
  </div>`;
}

/* ---- End-of-day report ---- */
function eodText(name, d, st, items, note) {
  const lines = [`End-of-day report: ${name}, ${fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`, '',
    `Consultants added: ${st.cands}`, `RTRs received: ${st.rtr}`, `Submissions: ${st.subs}`, `Interviews scheduled: ${st.intv}`, ''];
  if (items.length) { lines.push('Submissions today:'); items.forEach(s => lines.push(`- ${s.cn}: ${s.req} to ${s.vn}${s.ec ? ' (' + s.ec + ')' : ''}${s.rate ? ', ' + s.rate : ''}${s.rtr ? ', RTR received' : ''}, ${SUB_ST[s.st] || s.st}`)); lines.push(''); }
  if (note) lines.push('Highlights and blockers:', note);
  return lines.join('\n');
}
function RecEOD() {
  const P = usePortal(); const toast = useToast();
  const subs = useCol('rec/sub/items', 'd:desc'); const cands = useCol('rec/cand/items', 'n:asc');
  const mine = useCol('rec/eod/items', 'd:desc', 60);
  const [d, setD] = useState(dkey()); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const st = recStats(subs.docs, cands.docs, P.uid, d, d);
  const items = subs.docs.filter(s => s.by === P.uid && s.d === d);
  const reports = mine.docs.filter(r => r.uid === P.uid);
  const existing = reports.find(r => r.d === d);
  const send = async () => {
    setBusy(true);
    try {
      const text = eodText(P.prof.n, d, st, items, note.trim());
      await dbSet(`rec/eod/items/${P.uid}_${d}`, { uid: P.uid, n: P.prof.n, d, cands: st.cands, rtr: st.rtr, subs: st.subs, intv: st.intv, note: note.trim(), text, at: Date.now() });
      let mailed = false; try { const r = await api('eod_notify', { date: d, text }); mailed = !!r.mailed; } catch (e) { /* in-app copy is already saved */ }
      toast(mailed ? 'Report shared with HR and admin, and emailed.' : 'Report shared with HR and admin.'); setNote('');
    } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  if (!P.prof) return html`<${NeedProfile} />`;
  return html`<div className="g2" style=${{ alignItems: 'start' }}>
    <section className="panel stack">
      <div className="ph-row" style=${{ marginBottom: 0 }}><h2 className="ph">Today\u2019s report</h2><input type="date" value=${d} max=${dkey()} onInput=${e => e.target.value && setD(e.target.value)} style=${{ width: 170 }} aria-label="Report date" /></div>
      <div className="kpis" style=${{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
        <a href="#/portal/rec/consultants"><b>${st.cands}</b><span>Consultants added</span></a><a href="#/portal/rec/submissions"><b>${st.rtr}</b><span>RTRs received</span></a><a href="#/portal/rec/submissions"><b>${st.subs}</b><span>Submissions</span></a><a href="#/portal/rec/submissions"><b>${st.intv}</b><span>Interviews</span></a></div>
      ${items.length ? html`<ul className="list">${items.map(s => html`<li key=${s.id}><div><div className="t">${s.cn}: ${s.req}</div><div className="m">${s.vn}${s.ec ? ', ' + s.ec : ''}${s.rate ? ', ' + s.rate : ''}</div></div><div className="actions">${s.rtr && html`<${Chip} s="ok">RTR<//>`}<${Chip} s=${s.st === 'placed' ? 'ok' : 'amber'}>${SUB_ST[s.st]}<//></div></li>`)}</ul>`
        : html`<p className="muted small">No submissions logged for this day yet. Log them under RTRs & submissions and they appear here automatically.</p>`}
      <${Field} label="Highlights and blockers"><textarea value=${note} onInput=${e => setNote(e.target.value)} placeholder="Interviews lined up, vendors to chase tomorrow, anything HR should know" /><//>
      ${existing && html`<div className="note info"><span>You already sent a report for this day at ${fmtTime(existing.at)}. Sending again replaces it.</span></div>`}
      <div className="actions"><button className="btn lg go" disabled=${busy} onClick=${send}><${Icon} n="send" />${busy ? 'Sending…' : existing ? 'Send again' : 'Send to HR and admin'}</button><span className="muted small">One click: saved to the HR and admin portals${P.settings.eodMail ? ' and emailed' : ''}.</span></div>
    </section>
    <section className="panel"><h2 className="ph" style=${{ marginBottom: 8 }}>Your recent reports</h2>
      ${reports.length ? html`<ul className="list">${reports.slice(0, 20).map(r => html`<li key=${r.id}><div><div className="t">${fmtDate(r.d, { weekday: 'short', month: 'short', day: 'numeric' })}</div><div className="m">${r.rtr} RTR, ${r.subs} submissions, ${r.cands} consultants added${r.intv ? `, ${r.intv} interviews` : ''}${r.note ? '. ' + r.note.slice(0, 80) : ''}</div></div><span className="muted small num">${fmtTime(r.at)}</span></li>`)}</ul>`
        : html`<${Empty} title="No reports sent yet">Your daily reports are listed here after you send them.<//>`}
    </section>
  </div>`;
}
