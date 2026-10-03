/* ================= HR portal ================= */
const tplItems = (tpl, kind) => ((tpl && tpl[kind]) && tpl[kind].length ? tpl[kind] : (kind === 'off' ? OFF_DEFAULT : ONB_DEFAULT));
const onbProgress = (onb, tpl) => { const items = tplItems(tpl, onb.kind || 'onb'); const st = onb.items || {}; const done = items.filter(i => ['verified', 'na'].includes((st[i.id] || {}).s)).length; return { done, total: items.length, items }; };
function useAllFiles(members, tick) {
  const [files, setFiles] = useState(null);
  const ids = members.map(m => m.id).join(',');
  useEffect(() => { let live = true; setFiles(null); pMap(members, 4, m => dbList(`u/${m.id}/f`).catch(() => [])).then(lists => { if (!live) return; const out = []; members.forEach((m, i) => lists[i].forEach(f => out.push({ ...f, m }))); setFiles(out.sort((a, b) => (b.at || 0) - (a.at || 0))); }); return () => { live = false; }; }, [ids, tick]);
  return files;
}
const employeesOf = A => A.members.filter(m => m.role !== 'employer' && m.st !== 'new');

function HROverview() {
  const P = usePortal(); const A = P.admin;
  const eod = useCol('rec/eod/items', 'd:desc', 40);
  const emps = employeesOf(A);
  const onb = emps.filter(m => m.r && m.r.onb && m.r.onb.kind !== 'done');
  const today = dkey();
  if (A.loading) return html`<${Spinner} />`;
  const pending = onb.map(m => { const p = onbProgress(m.r.onb, P.tpl); return { m, p }; });
  const awaiting = pending.reduce((s, x) => s + Object.values(x.m.r.onb.items || {}).filter(i => i.s === 'received').length, 0);
  return html`<div className="stack">
    <div className="kpis">
      <a href="#/portal/hr/onboarding"><b>${pending.length}</b><span>Onboardings in progress</span></a>
      <a href="#/portal/hr/onboarding"><b>${awaiting}</b><span>Items to verify</span></a>
      <a href="#/portal/admin/approvals?tab=leave"><b>${A.pendLv.length}</b><span>Time-off requests</span></a>
      <a href="#/portal/hr/reports"><b>${eod.docs.filter(r => r.d === today).length}</b><span>Daily reports today</span></a>
      <a href="#/portal/admin/team?tab=new"><b>${A.requests.length}</b><span>Access requests</span></a>
    </div>
    <div className="g2" style=${{ alignItems: 'start' }}>
      <section className="panel"><div className="ph-row"><h2 className="ph">Onboarding in progress</h2><a className="small" href="#/portal/hr/onboarding">All onboarding</a></div>
        ${pending.length ? html`<ul className="list">${pending.slice(0, 6).map(({ m, p }) => html`<li key=${m.id}><${Person} uid=${m.id} root=${m.u} people=${P.people} sub=${(m.r.onb.kind === 'off' ? 'Offboarding' : 'Onboarding') + ', started ' + fmtDay(m.r.onb.started)} /><${Chip} s=${p.done === p.total ? 'ok' : 'amber'}>${p.done} / ${p.total}<//></li>`)}</ul>`
          : html`<${Empty} title="Nobody is being onboarded right now">Start a checklist from Onboarding, or from a person's card under Team.<//>`}</section>
      <section className="panel"><div className="ph-row"><h2 className="ph">Today\u2019s recruiting reports</h2><a className="small" href="#/portal/hr/reports">All reports</a></div>
        ${eod.docs.filter(r => r.d === today).length ? html`<ul className="list">${eod.docs.filter(r => r.d === today).map(r => html`<li key=${r.id}><div><div className="t">${r.n}</div><div className="m">${r.rtr} RTR, ${r.subs} submissions, ${r.cands} consultants added</div></div><span className="muted small num">${fmtTime(r.at)}</span></li>`)}</ul>`
          : html`<${Empty} title="No reports yet today">Recruiters send their end-of-day report with one click; it lands here and in the admin portal.<//>`}</section>
    </div>
  </div>`;
}

/* ---- Onboarding ---- */
function OnboardingModal({ m, onClose }) {
  const P = usePortal(); const toast = useToast();
  const onb = m.r.onb; const { items } = onbProgress(onb, P.tpl);
  const [st, setSt] = useState(onb.items || {}); const [busy, setBusy] = useState(false);
  const files = useCol(`u/${m.id}/f`, 'at:desc');
  const upFor = id => (m.u.onbUp || {})[id];
  const fileOf = fid => files.docs.find(f => f.id === fid);
  const set = (id, patch) => setSt({ ...st, [id]: { ...(st[id] || {}), ...patch, at: Date.now(), by: P.uid } });
  const save = async (finish) => {
    setBusy(true);
    try { await dbMerge(`r/${m.id}`, { onb: { items: st, ...(finish ? { kind: 'done', finished: Date.now(), was: onb.kind } : {}) } }); toast(finish ? 'Checklist completed.' : 'Checklist saved.'); if (finish) onClose(); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const done = items.filter(i => ['verified', 'na'].includes((st[i.id] || {}).s)).length;
  return html`<${Modal} wide title=${`${onb.kind === 'off' ? 'Offboarding' : 'Onboarding'}: ${m.u.p.n}`} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Close</button><button type="button" className="btn ghost" disabled=${busy} onClick=${() => save(false)}>Save</button><button type="button" className="btn go" disabled=${busy || done < items.length} onClick=${() => save(true)}>Mark complete</button>`}>
    <div className="stack">
      <div className="actions"><${Chip} s=${done === items.length ? 'ok' : 'amber'}>${done} of ${items.length} done<//><span className="muted small">Started ${fmtDay(onb.started)}. ${m.u.p.e}${m.u.p.ph ? ', ' + m.u.p.ph : ''}</span></div>
      <div className="tblwrap"><table className="tbl"><thead><tr><th>Item</th><th>Document</th><th>Status</th><th>Note</th></tr></thead>
        <tbody>${items.map(i => { const s = st[i.id] || {}; const fid = upFor(i.id); const f = fid && fileOf(fid); return html`<tr key=${i.id}>
          <td><b style=${{ fontWeight: 600 }}>${i.n}</b>${i.d && html`<div className="muted small">${i.d}</div>`}</td>
          <td>${i.doc ? (f ? html`<div className="actions" style=${{ flexWrap: 'nowrap' }}><span className="small">${f.n}</span><${FileActions} base=${'u/' + m.id} f=${f} /></div>` : fid ? html`<span className="muted small">Uploaded (loading…)</span>` : html`<span className="muted small">Not uploaded yet</span>`) : html`<span className="muted small">—</span>`}</td>
          <td><select value=${s.s || (f ? 'received' : 'pending')} onChange=${e => set(i.id, { s: e.target.value, fid: fid || s.fid || null })}>${Object.entries(ONB_ST).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select></td>
          <td><input value=${s.n || ''} onInput=${e => set(i.id, { n: e.target.value })} placeholder="Optional" /></td></tr>`; })}</tbody></table></div>
      <p className="muted small">Employees upload documents against each item from their Onboarding page. Mark an item Verified once you've checked it, or Not needed if it doesn't apply.</p>
    </div><//>`;
}
function HROnboarding() {
  const P = usePortal(); const A = P.admin; const toast = useToast();
  const [open, setOpen] = useState(null); const [start, setStart] = useState(false); const [who, setWho] = useState(''); const [kind, setKind] = useState('onb'); const [tab, setTab] = useState('active');
  if (A.loading) return html`<${Spinner} />`;
  const emps = employeesOf(A);
  const rows = emps.filter(m => m.r && m.r.onb).map(m => ({ m, p: onbProgress(m.r.onb, P.tpl), done: m.r.onb.kind === 'done' })).filter(r => tab === 'all' || (tab === 'done' ? r.done : !r.done));
  const startNow = async () => {
    if (!who) { toast('Choose a person.', true); return; }
    try { await dbMerge(`r/${who}`, { onb: { kind, started: Date.now(), items: {}, by: P.uid } }); toast('Checklist started. The employee sees it in their portal.'); setStart(false); setWho(''); }
    catch (e) { toast(errText(e), true); }
  };
  const cur = open && emps.find(m => m.id === open);
  return html`<div className="stack">
    <div className="toolbar"><div className="tabs" role="tablist" style=${{ marginBottom: 0, border: 0 }}>${[['active', 'In progress'], ['done', 'Completed'], ['all', 'All']].map(([k, v]) => html`<button type="button" key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}</button>`)}</div>
      <div className="push"><a className="btn ghost" href="#/portal/hr/policies">Edit checklist template</a><button type="button" className="btn" onClick=${() => setStart(true)}><${Icon} n="plus" />Start a checklist</button></div></div>
    ${start && html`<section className="panel form"><h2 className="ph">Start onboarding or offboarding</h2>
      <div className="row2"><${Field} label="Person"><select value=${who} onChange=${e => setWho(e.target.value)}><option value="">Choose…</option>${emps.map(m => html`<option key=${m.id} value=${m.id}>${m.u.p.n}${m.r && m.r.cl ? ' (' + m.r.cl + ')' : ''}</option>`)}</select><//>
        <${Field} label="Checklist"><select value=${kind} onChange=${e => setKind(e.target.value)}><option value="onb">Onboarding</option><option value="off">Offboarding</option></select><//></div>
      <div className="actions"><button type="button" className="btn" onClick=${startNow}>Start</button><button type="button" className="btn ghost" onClick=${() => setStart(false)}>Cancel</button></div></section>`}
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${rows.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Person</th><th>Checklist</th><th>Started</th><th>Progress</th><th /></tr></thead>
        <tbody>${rows.map(({ m, p, done }) => html`<tr key=${m.id} className="click" tabIndex="0" onClick=${() => !done && setOpen(m.id)}>
          <td><${Person} uid=${m.id} root=${m.u} people=${P.people} sub=${m.r.cl || m.u.p.ti} /></td><td>${done ? (m.r.onb.was === 'off' ? 'Offboarding' : 'Onboarding') + ', completed' : m.r.onb.kind === 'off' ? 'Offboarding' : 'Onboarding'}</td><td className="num">${fmtDay(m.r.onb.started)}</td>
          <td>${done ? html`<${Chip} s="ok">Complete<//>` : html`<${Chip} s=${p.done === p.total ? 'ok' : 'amber'}>${p.done} / ${p.total}<//>`}</td><td className="r">${!done && html`<button className="btn ghost sm">Open</button>`}</td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title=${tab === 'done' ? 'No completed checklists yet' : 'No checklists in progress'}>Start one for a new hire. They see the list of documents to upload in their portal, and you verify each item here.<//>`}
    </section>
    ${cur && cur.r.onb && html`<${OnboardingModal} key=${cur.id} m=${cur} onClose=${() => setOpen(null)} />`}
  </div>`;
}

/* ---- Document checks ---- */
function HRVerify() {
  const P = usePortal(); const A = P.admin; const toast = useToast();
  const [tick, setTick] = useState(0); const [tab, setTab] = useState('pending');
  const emps = employeesOf(A);
  const files = useAllFiles(emps, tick);
  const decide = async (f, s) => { const note = s === 'rejected' ? prompt('What should they fix?') : ''; if (s === 'rejected' && note === null) return; try { await dbMerge(`u/${f.m.id}/f/${f.id}`, { vf: { s, n: note || '', at: Date.now(), by: P.uid } }); setTick(t => t + 1); toast(s === 'verified' ? 'Marked verified.' : 'Sent back to the employee.'); } catch (e) { toast(errText(e), true); } };
  if (A.loading || !files) return html`<${Spinner} />`;
  const list = files.filter(f => !f.w).filter(f => tab === 'all' || (tab === 'pending' ? !f.vf : (f.vf && f.vf.s === tab)));
  return html`<div className="stack">
    <div className="tabs" role="tablist">${[['pending', 'To check', files.filter(f => !f.w && !f.vf).length], ['verified', 'Verified', null], ['rejected', 'Sent back', null], ['all', 'All', null]].map(([k, v, n]) => html`<button type="button" key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}${n != null && html`<span className=${'chip' + (n ? ' amber' : '')}>${n}</span>`}</button>`)}</div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${list.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Person</th><th>Document</th><th>Type</th><th>Uploaded</th><th>Status</th><th /></tr></thead>
        <tbody>${list.map(f => html`<tr key=${f.m.id + f.id}><td><${Person} uid=${f.m.id} root=${f.m.u} people=${P.people} /></td><td><b style=${{ fontWeight: 600 }}>${f.n}</b>${f.item && html`<div className="muted small">Onboarding item</div>`}</td><td>${DOC_CATS[f.c] || (f.c === 'onboarding' ? 'Onboarding' : 'Other')}</td><td className="num">${fmtDay(f.at)}</td>
          <td>${f.vf ? html`<${Chip} s=${f.vf.s === 'verified' ? 'ok' : 'red'}>${f.vf.s === 'verified' ? 'Verified' : 'Sent back'}<//>` : html`<${Chip} s="amber">To check<//>`}</td>
          <td className="r"><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}><${FileActions} base=${'u/' + f.m.id} f=${f} />${(!f.vf || f.vf.s !== 'verified') && html`<button type="button" className="btn go sm" onClick=${() => decide(f, 'verified')}>Verify</button>`}${(!f.vf || f.vf.s !== 'rejected') && html`<button type="button" className="btn ghost sm" onClick=${() => decide(f, 'rejected')}>Send back</button>`}</div></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title="Nothing to check">Documents employees upload (agreements, tax forms, insurance, onboarding items) appear here for verification.<//>`}
    </section>
  </div>`;
}

/* ---- Policies, templates and the checklist template ---- */
function HRPolicies() {
  const P = usePortal(); const toast = useToast();
  const files = useCol('org/hr/f', 'at:desc');
  const [cat, setCat] = useState('handbook'); const [busy, setBusy] = useState(false); const [prog, setProg] = useState(0);
  const [kind, setKind] = useState('onb'); const [items, setItems] = useState(null);
  const cur = items || tplItems(P.tpl, kind);
  const onFiles = async fs => { setBusy(true); try { for (const f of fs) { setProg(0.03); await storeFile('org/hr', f, { c: cat }, setProg); } toast('Document published to all employees.'); } catch (e) { toast(errText(e), true); } setBusy(false); };
  const del = async f => { try { await deleteStored('org/hr', f.id); toast('Removed.'); } catch (e) { toast(errText(e), true); } };
  const saveTpl = async () => { try { await dbMerge('org/hr/x/tpl', { [kind]: cur.filter(i => i.n && i.n.trim()).map((i, idx) => ({ id: i.id || nid(), n: i.n.trim(), d: (i.d || '').trim(), doc: !!i.doc })) }); setItems(null); toast('Checklist template saved. New checklists use it.'); } catch (e) { toast(errText(e), true); } };
  const setItem = (idx, patch) => setItems(cur.map((i, j) => j === idx ? { ...i, ...patch } : i));
  return html`<div className="stack">
    <section className="panel stack" style=${{ gap: 14 }}>
      <div><h2 className="ph">Policies, handbook and templates</h2><p className="muted small" style=${{ marginTop: 4 }}>Everything uploaded here is visible to all employees under Policies. Templates (offer letter, NDA, forms) can be downloaded and filled in.</p></div>
      <div style=${{ maxWidth: 360 }}><${Field} label="Document type"><select value=${cat} onChange=${e => setCat(e.target.value)}>${Object.entries(POLICY_CATS).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//></div>
      <${FilePick} busy=${busy} progress=${prog} onFiles=${onFiles} />
      ${files.docs.length ? html`<ul className="files">${files.docs.map(f => html`<li key=${f.id}><${Icon} n="file" /><div className="fn"><b>${f.n}</b><span>${POLICY_CATS[f.c] || 'Other'}, ${fmtDay(f.at)}, ${sizeLabel(f.sz)}</span></div><${FileActions} base="org/hr" f=${f} onDelete=${() => del(f)} /></li>`)}</ul>` : html`<p className="muted small">No documents published yet.</p>`}
    </section>
    <section className="panel stack" style=${{ gap: 14 }}>
      <div className="ph-row"><div><h2 className="ph">Checklist template</h2><p className="muted small" style=${{ marginTop: 4 }}>The items every new ${kind === 'off' ? 'offboarding' : 'onboarding'} checklist starts with.</p></div>
        <div className="seg" style=${{ marginBottom: 0 }}>${[['onb', 'Onboarding'], ['off', 'Offboarding']].map(([k, v]) => html`<button type="button" key=${k} className=${kind === k ? 'on' : ''} onClick=${() => { setKind(k); setItems(null); }}>${v}</button>`)}</div></div>
      <div className="stack" style=${{ gap: 8 }}>${cur.map((i, idx) => html`<div key=${i.id || idx} style=${{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,2fr) auto auto', gap: 8, alignItems: 'end' }}>
        <${Field} label="Item"><input value=${i.n} onInput=${e => setItem(idx, { n: e.target.value })} /><//><${Field} label="Description"><input value=${i.d || ''} onInput=${e => setItem(idx, { d: e.target.value })} /><//>
        <label className="check" style=${{ paddingBottom: 12, whiteSpace: 'nowrap' }}><input type="checkbox" checked=${!!i.doc} onChange=${e => setItem(idx, { doc: e.target.checked })} /><span>Needs a document</span></label>
        <button type="button" className="btn ghost icon" aria-label="Remove" onClick=${() => setItems(cur.filter((_, j) => j !== idx))}><${Icon} n="trash" /></button></div>`)}
        <div className="actions"><button type="button" className="btn ghost sm" onClick=${() => setItems([...cur, { id: nid(), n: '', d: '', doc: true }])}><${Icon} n="plus" />Add item</button><button type="button" className="btn" disabled=${!items} onClick=${saveTpl}>Save template</button></div></div>
    </section>
  </div>`;
}

/* ---- Directory ---- */
function HRDirectory() {
  const P = usePortal(); const A = P.admin; const toast = useToast();
  const [q, setQ] = useState('');
  if (A.loading) return html`<${Spinner} />`;
  const ql = q.trim().toLowerCase();
  const rows = A.members.filter(m => m.st !== 'new' && (!ql || [m.u.p.n, m.u.p.e, m.u.p.ti, m.u.p.loc, m.r && m.r.cl, m.u.p.co].filter(Boolean).join(' ').toLowerCase().includes(ql)));
  const exp = async () => { try { await saveDownload('directory.csv', toCSV([['Name', 'Email', 'Phone', 'Title', 'Portal', 'Status', 'Client', 'End client', 'Engagement', 'Start date', 'Location'], ...rows.map(m => [m.u.p.n, m.u.p.e, m.u.p.ph || '', m.u.p.ti || '', m.role === 'employer' ? 'Client' : m.role === 'bench' ? 'Bench sales' : m.role === 'consultant' ? 'Consultant' : 'Employee', m.st, (m.r && m.r.cl) || m.u.p.co || '', (m.r && m.r.ec) || '', (m.r && m.r.ty) || '', (m.r && m.r.sd) || '', m.u.p.loc || ''])])); } catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); } };
  return html`<div className="stack">
    <div className="toolbar"><input type="search" style=${{ maxWidth: 320 }} placeholder="Search people" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search directory" /><div className="push"><button type="button" className="btn ghost" onClick=${exp}><${Icon} n="down" />Export CSV</button></div></div>
    <section className="panel" style=${{ padding: '6px 8px' }}><div className="tblwrap"><table className="tbl"><thead><tr><th>Person</th><th>Contact</th><th>Portal</th><th>Client</th><th>Engagement</th><th>Start</th><th>Location</th></tr></thead>
      <tbody>${rows.map(m => html`<tr key=${m.id}><td><${Person} uid=${m.id} root=${m.u} people=${P.people} sub=${m.u.p.ti} /></td><td className="small"><a href=${'mailto:' + m.u.p.e}>${m.u.p.e}</a>${m.u.p.ph ? html`<div>${m.u.p.ph}</div>` : ''}</td><td>${m.role === 'employer' ? 'Client' : m.role === 'bench' ? 'Bench sales' : m.role === 'consultant' ? 'Consultant' : 'Employee'}${m.st === 'inactive' ? html` <${Chip} s="inactive">Inactive<//>` : ''}</td>
        <td>${(m.r && m.r.cl) || m.u.p.co || '—'}</td><td>${(m.r && m.r.ty) || '—'}</td><td className="num">${m.r && m.r.sd ? fmtDate(m.r.sd, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td><td>${m.u.p.loc || '—'}</td></tr>`)}</tbody></table></div></section>
  </div>`;
}

/* ---- Recruiting overview (HR and admin): counts, details, daily reports ---- */
function Recruiting() {
  const P = usePortal(); const A = P.admin; const toast = useToast();
  const subs = useCol('rec/sub/items', 'd:desc'); const cands = useCol('rec/cand/items', 'u:desc'); const eod = useCol('rec/eod/items', 'd:desc', 200);
  const [tab, setTab] = useState('overview'); const [range, setRange] = useState('week'); const [open, setOpen] = useState(undefined); const [openSub, setOpenSub] = useState(undefined); const [rep, setRep] = useState(null);
  const today = dkey(); const ws = weekStart(today); const mk = mkey(today);
  const [a, b] = range === 'today' ? [today, today] : range === 'week' ? [ws, addDays(ws, 6)] : [mk + '-01', mk + '-31'];
  const active = new Set([...subs.docs.map(s => s.by), ...cands.docs.map(c => c.by), ...eod.docs.map(r => r.uid)].filter(Boolean));
  const recruiters = A.members.filter(m => m.role !== 'employer' && m.st === 'active' && !(m.r && m.r.norec) || active.has(m.id));
  const names = {}; [...subs.docs, ...cands.docs].forEach(x => { if (x.by && x.byn) names[x.by] = x.byn; }); eod.docs.forEach(r => { if (r.uid && r.n) names[r.uid] = r.n; });
  const extra = [...active].filter(id => !recruiters.some(m => m.id === id)).map(id => ({ id, u: null, name: names[id] || 'Staff' }));
  const byRec = [...recruiters, ...extra].map(m => ({ m, s: recStats(subs.docs, cands.docs, m.id, a, b), last: eod.docs.find(r => r.uid === m.id) }));
  const tot = recStats(subs.docs, cands.docs, null, a, b);
  const exp = async () => { try { await saveDownload(`recruiting_${a}_to_${b}.csv`, toCSV([['Recruiter', 'Consultants added', 'RTRs', 'Submissions', 'Interviews', 'Placed'], ...byRec.map(r => [r.m.u.p.n, r.s.cands, r.s.rtr, r.s.subs, r.s.intv, r.s.placed]), ['All', tot.cands, tot.rtr, tot.subs, tot.intv, tot.placed]])); } catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); } };
  const curC = open && cands.docs.find(c => c.id === open); const curS = openSub && subs.docs.find(s => s.id === openSub);
  return html`<div className="stack">
    <div className="toolbar"><div className="tabs" role="tablist" style=${{ marginBottom: 0, border: 0 }}>${[['overview', 'Overview'], ['subs', 'Submissions'], ['cands', 'Consultants'], ['eod', 'Daily reports']].map(([k, v]) => html`<button type="button" key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}</button>`)}</div>
      <div className="push"><div className="seg" style=${{ marginBottom: 0 }}>${[['today', 'Today'], ['week', 'This week'], ['month', 'This month']].map(([k, v]) => html`<button type="button" key=${k} className=${range === k ? 'on' : ''} onClick=${() => setRange(k)}>${v}</button>`)}</div><button type="button" className="btn ghost" onClick=${exp}><${Icon} n="down" />CSV</button><button type="button" className="btn ghost" onClick=${() => setOpen(null)}><${Icon} n="plus" />Add consultant</button><button type="button" className="btn" onClick=${() => setOpenSub(null)}><${Icon} n="plus" />Log submission</button></div></div>
    <div className="kpis">
      <a><b>${tot.rtr}</b><span>RTRs received</span></a><a><b>${tot.subs}</b><span>Submissions</span></a><a><b>${tot.intv}</b><span>Interviews</span></a><a><b>${tot.placed}</b><span>Placed</span></a><a><b>${tot.cands}</b><span>Consultants added</span></a></div>
    ${tab === 'overview' && html`<section className="panel" style=${{ padding: '6px 8px' }}>
      ${recruiters.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Recruiter</th><th className="r">Consultants added</th><th className="r">RTRs</th><th className="r">Submissions</th><th className="r">Interviews</th><th className="r">Placed</th><th>Last daily report</th></tr></thead>
        <tbody>${byRec.map(r => html`<tr key=${r.m.id}><td>${r.m.u ? html`<${Person} uid=${r.m.id} root=${r.m.u} people=${P.people} />` : html`<b style=${{ fontWeight: 600 }}>${r.m.name}</b><div className="muted small">Staff account</div>`}</td><td className="r num">${r.s.cands}</td><td className="r num"><b>${r.s.rtr}</b></td><td className="r num"><b>${r.s.subs}</b></td><td className="r num">${r.s.intv}</td><td className="r num">${r.s.placed}</td>
          <td>${r.last ? html`<${Chip} s=${r.last.d === today ? 'ok' : 'amber'}>${fmtDate(r.last.d, { month: 'short', day: 'numeric' })}<//>` : html`<span className="muted small">None yet</span>`}</td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title="No activity yet">Everyone on the team can add consultants and log RTRs and submissions from their portal; you can add them here too. Each entry shows who added it.<//>`}</section>`}
    ${tab === 'subs' && html`<section className="panel" style=${{ padding: '6px 8px' }}>${subs.docs.filter(s => inRange(s.d, a, b)).length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Date</th><th>Consultant</th><th>Requirement</th><th>Vendor / client</th><th>RTR</th><th>Status</th><th>Recruiter</th></tr></thead>
      <tbody>${subs.docs.filter(s => inRange(s.d, a, b)).map(s => html`<tr key=${s.id} className="click" tabIndex="0" onClick=${() => setOpenSub(s.id)}><td className="num nw">${fmtDate(s.d)}</td><td><b style=${{ fontWeight: 600 }}>${s.cn}</b></td><td>${s.req}</td><td>${s.vn}${s.ec ? html`<div className="muted small">${s.ec}</div>` : ''}${s.rn || s.rp ? html`<div className="muted small">${[s.rn, s.rp].filter(Boolean).join(' · ')}</div>` : ''}</td><td>${s.rtr ? html`<${Chip} s="ok">Yes<//>` : html`<span className="muted small">No</span>`}</td><td><${Chip} s=${s.st === 'placed' ? 'ok' : s.st === 'rejected' ? 'red' : 'amber'}>${SUB_ST[s.st] || s.st}<//></td><td className="small">${s.byn}</td></tr>`)}</tbody></table></div>` : html`<${Empty} title="No submissions in this range" />`}</section>`}
    ${tab === 'cands' && html`<section className="panel" style=${{ padding: '6px 8px' }}>${cands.docs.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Consultant</th><th>Skills</th><th>Authorization</th><th>Location</th><th>Rate</th><th>Status</th><th>Recruiter</th></tr></thead>
      <tbody>${cands.docs.map(c => { const mine = subs.docs.filter(s => s.cid === c.id); const who = [...new Set(mine.map(s => s.byn).filter(Boolean))]; return html`<tr key=${c.id} className="click" tabIndex="0" onClick=${() => setOpen(c.id)}><td><b style=${{ fontWeight: 600 }}>${c.n}</b><div className="muted small">${c.ti}${c.emp ? ' · ' + c.emp : ''}</div></td><td className="small">${c.sk || '—'}</td><td>${c.auth || '—'}</td><td>${c.loc || '—'}</td><td>${c.rate || '—'}</td><td><${Chip} s=${c.st === 'placed' ? 'ok' : c.st === 'inactive' ? '' : 'new'}>${CAND_STATUS[c.st] || c.st}<//>${mine.length ? html`<div className="muted small">${mine.filter(s => s.rtr).length} RTR · ${mine.length} sub${who.length ? ' by ' + who.join(', ') : ''}</div>` : ''}</td><td className="small">${c.byn}</td></tr>`; })}</tbody></table></div>` : html`<${Empty} title="No consultants added yet" action=${html`<button type="button" className="btn" onClick=${() => setOpen(null)}>Add a consultant</button>`} />`}</section>`}
    ${tab === 'eod' && html`<section className="panel">${eod.docs.length ? html`<ul className="list">${eod.docs.map(r => html`<li key=${r.id}><div><div className="t">${r.n}, ${fmtDate(r.d, { weekday: 'short', month: 'short', day: 'numeric' })}</div><div className="m">${r.rtr} RTR, ${r.subs} submissions, ${r.cands} consultants added${r.intv ? `, ${r.intv} interviews` : ''}${r.note ? '. ' + r.note.slice(0, 120) : ''}</div></div><div className="actions"><span className="muted small num">${fmtTime(r.at)}</span><button type="button" className="btn ghost sm" onClick=${() => setRep(r)}>Open</button></div></li>`)}</ul>` : html`<${Empty} title="No daily reports yet">Recruiters send an end-of-day report with one click from their portal.<//>`}</section>`}
    ${open !== undefined && (open === null || curC) && html`<${CandModal} key=${open || 'new'} c=${curC || null} onClose=${() => setOpen(undefined)} />`}
    ${openSub !== undefined && (openSub === null || curS) && html`<${SubModal} key=${openSub || 'new'} s=${curS || null} cands=${cands.docs} onClose=${() => setOpenSub(undefined)} />`}
    ${rep && html`<${Modal} title=${`${rep.n}: ${fmtDate(rep.d, { weekday: 'long', month: 'long', day: 'numeric' })}`} onClose=${() => setRep(null)} foot=${html`<button type="button" className="btn ghost" onClick=${async () => { try { await saveDownload(`eod-${rep.d}-${rep.n.replace(/\s+/g, '-')}.txt`, rep.text || ''); } catch (e) {} }}><${Icon} n="down" />Download</button><button type="button" className="btn" onClick=${() => setRep(null)}>Close</button>`}><pre style=${{ whiteSpace: 'pre-wrap', font: 'inherit', margin: 0 }}>${rep.text}</pre><//>`}
  </div>`;
}
