/* ================= Client portal: data ================= */
const ClientCtx = createContext(null);
const useClient = () => useContext(ClientCtx);
const cdChip = s => s === 'approved' ? 'ok' : s === 'returned' ? 'red' : s === 'pending' ? 'amber' : '';
function ClientData({ children }) {
  const P = usePortal(); const cid = P.cid;
  const roster = useCol(`pub/${cid}/roster`);
  const ts = useCol(`pub/${cid}/ts`);
  const live = useCol(`pub/${cid}/live`);
  const reqs = useCol(`e/${P.uid}/req`, 'at:desc');
  const val = useMemo(() => {
    const sheets = ts.docs.map(d => ({ ...d, st: cdStatus(d) })).sort((a, b) => (b.sa || 0) - (a.sa || 0));
    const pending = sheets.filter(x => x.st === 'pending').sort((a, b) => (a.sa || 0) - (b.sa || 0));
    const active = roster.docs.filter(r => r.st !== 'inactive').sort((a, b) => (a.n || '').localeCompare(b.n || ''));
    const liveById = {}; live.docs.forEach(l => { liveById[l.id] = l; });
    return { cid, roster: roster.docs, active, sheets, pending, live: live.docs, liveById, onClock: live.docs.filter(l => l.on && active.some(a => a.id === l.id)),
      reqs: reqs.docs, openReqs: reqs.docs.filter(r => !['filled', 'closed'].includes(r.st || 'open')), loading: roster.loading || ts.loading };
  }, [roster.docs, ts.docs, live.docs, reqs.docs, roster.loading, ts.loading]);
  return html`<${ClientCtx.Provider} value=${val}>${children}<//>`;
}
const company = P => P.asg.cl || (P.prof && P.prof.co) || 'your company';

/* Timesheet review (client) */
function ClientTsReview({ d, onClose }) {
  const P = usePortal(); const C = useClient(); const toast = useToast();
  const [c, setC] = useState(''); const [busy, setBusy] = useState(false);
  const live = C.sheets.find(x => x.id === d.id) || d; const st = cdStatus(live);
  const decide = async s => {
    if (s === 'returned' && !c.trim()) { toast('Add a note so the consultant knows what to fix.', true); return; }
    setBusy(true);
    try { await dbMerge(`pub/${C.cid}/ts/${d.id}`, { cd: { s, c: c.trim(), at: Date.now(), by: P.uid, v: live.u } }); toast(s === 'approved' ? 'Hours approved. StratEdge has been notified.' : 'Timesheet returned to the consultant.'); onClose(); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const days = weekDays(live.w); const rows = live.rows || [];
  const dayT = DOW.map((_, i) => rows.reduce((a, r) => a + (r.h[i] || 0), 0));
  const foot = st === 'pending' ? html`<button type="button" className="btn danger" disabled=${busy} onClick=${() => decide('returned')}>Return with note</button><button type="button" className="btn go" disabled=${busy} onClick=${() => decide('approved')}>Approve hours</button>`
    : st === 'approved' ? html`<button type="button" className="btn ghost" disabled=${busy} onClick=${() => decide('returned')}>Undo and return</button><button type="button" className="btn ghost" onClick=${onClose}>Close</button>`
    : st === 'returned' ? html`<button type="button" className="btn go" disabled=${busy} onClick=${() => decide('approved')}>Approve after all</button><button type="button" className="btn ghost" onClick=${onClose}>Close</button>`
    : html`<button type="button" className="btn ghost" onClick=${onClose}>Close</button>`;
  return html`<${Modal} wide title=${`${live.n || 'Consultant'}: ${weekLabel(live.w)}`} onClose=${onClose} foot=${foot}>
    <div className="stack">
      <div className="actions"><${Chip} s=${cdChip(st)}>${CD_LABEL[st]}<//><span className="muted small">${live.sa ? 'Submitted ' + fmtTs(live.sa) : ''}</span></div>
      ${live.cd && st !== 'pending' && live.cd.c && html`<div className=${'note ' + (st === 'approved' ? 'ok' : 'red')}><span>${live.cd.c}</span></div>`}
      ${st === 'withdrawn' && html`<div className="note amber"><span>The consultant withdrew this timesheet to make changes. A new version will appear when they resubmit.</span></div>`}
      <div className="tblwrap"><table className="tbl">
        <thead><tr><th>Project</th><th>Task</th>${days.map((k, i) => html`<th key=${k} className="r">${DOW[i]} ${parseD(k).getDate()}</th>`)}<th className="r">Total</th></tr></thead>
        <tbody>${rows.map((r, i) => html`<tr key=${i}><td>${r.p}</td><td>${r.t}</td>${r.h.map((x, j) => html`<td key=${j} className="r num">${x ? h1(x) : ''}</td>`)}<td className="r num"><b>${h1(r.h.reduce((a, b) => a + b, 0))}</b></td></tr>`)}
          <tr><td colSpan="2"><b>Total</b></td>${dayT.map((t, i) => html`<td key=${i} className="r num"><b>${h1(t)}</b></td>`)}<td className="r num"><b>${h1(dayT.reduce((a, b) => a + b, 0))}</b></td></tr>
        </tbody></table></div>
      ${live.note && html`<div className="note info"><span><b>Note from ${firstName(live.n)}:</b> ${live.note}</span></div>`}
      ${(st === 'pending' || st === 'approved') && html`<${Field} label=${st === 'pending' ? 'Note to the consultant (required to return)' : 'Reason for returning'}><textarea value=${c} onInput=${e => setC(e.target.value)} placeholder="e.g. Thursday should be 6 hours, not 8" /><//>`}
    </div><//>`;
}

/* ================= Client: dashboard ================= */
function ClientDashboard() {
  const P = usePortal(); const C = useClient();
  const [rv, setRv] = useState(null);
  if (C.loading) return html`<${Spinner} />`;
  return html`<div className="stack">
    <div className="hello"><div><h2>${greeting()}${P.prof ? ', ' + firstName(P.prof.n) : ''}</h2><p className="muted">${company(P)}, ${new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p></div>
      <a className="btn" href="#/portal/requirements">Post a requirement</a></div>
    <div className="kpis" style=${{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
      <a href="#/portal/consultants"><b>${C.active.length}</b><span>Consultants on assignment</span></a>
      <a href="#/portal/attendance"><b>${C.onClock.length}</b><span>On the clock now</span></a>
      <a href="#/portal/timesheets"><b>${C.pending.length}</b><span>Timesheets to approve</span></a>
      <a href="#/portal/requirements"><b>${C.openReqs.length}</b><span>Open requirements</span></a>
    </div>
    <div className="g2" style=${{ alignItems: 'start' }}>
      <section className="panel"><div className="ph-row"><h2 className="ph">Timesheets waiting for you</h2><a className="small" href="#/portal/timesheets">All timesheets</a></div>
        ${C.pending.length ? html`<ul className="list">${C.pending.slice(0, 6).map(x => html`<li key=${x.id}><div><div className="t">${x.n}</div><div className="m">${weekLabel(x.w)}, ${h1(x.t)} hours</div></div><button type="button" className="btn sm" onClick=${() => setRv(x)}>Review</button></li>`)}</ul>`
          : html`<${Empty} title="Nothing to approve">Consultants' weekly hours appear here as soon as they submit.<//>`}</section>
      <section className="panel"><div className="ph-row"><h2 className="ph">On the clock now</h2><a className="small" href="#/portal/attendance">Attendance</a></div>
        ${C.onClock.length ? html`<ul className="list">${C.onClock.map(l => html`<li key=${l.id}><div><div className="t">${l.n}</div><div className="m">Since ${fmtTime(l.i)}${l.d !== dkey() ? ', ' + fmtDate(l.d) : ''}</div></div><${Chip} s="ok">${MODES[l.m] || 'Working'}<//></li>`)}</ul>`
          : html`<${Empty} title="Nobody is clocked in right now" />`}</section>
    </div>
    ${C.reqs.length > 0 && html`<section className="panel"><div className="ph-row"><h2 className="ph">Your requirements</h2><a className="small" href="#/portal/requirements">Manage</a></div>
      <ul className="list">${C.reqs.slice(0, 4).map(r => html`<li key=${r.id}><div><div className="t">${r.ti}</div><div className="m">${Object.keys(r.cands || {}).length} candidate${Object.keys(r.cands || {}).length === 1 ? '' : 's'} shared</div></div><${Chip} s=${r.st === 'filled' ? 'ok' : r.st === 'shared' ? 'new' : r.st === 'closed' ? '' : 'amber'}>${REQ_ST[r.st || 'open']}<//></li>`)}</ul></section>`}
    ${rv && html`<${ClientTsReview} d=${rv} onClose=${() => setRv(null)} />`}
  </div>`;
}

/* ================= Client: timesheets ================= */
function ClientTimesheets() {
  const C = useClient();
  const [tab, setTab] = useState('pending'); const [rv, setRv] = useState(null);
  if (C.loading) return html`<${Spinner} />`;
  const list = C.sheets.filter(x => tab === 'all' || x.st === tab);
  const counts = { pending: C.pending.length, approved: C.sheets.filter(x => x.st === 'approved').length, returned: C.sheets.filter(x => x.st === 'returned').length };
  return html`<div className="stack">
    <div className="tabs" role="tablist">${[['pending', 'To approve'], ['approved', 'Approved'], ['returned', 'Returned'], ['all', 'All']].map(([k, v]) => html`<button type="button" key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}${counts[k] != null && html`<span className=${'chip' + (k === 'pending' && counts[k] ? ' amber' : '')}>${counts[k]}</span>`}</button>`)}</div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${list.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Consultant</th><th>Week</th><th className="r">Hours</th><th>Status</th><th>Submitted</th><th /></tr></thead>
        <tbody>${list.map(x => html`<tr key=${x.id}><td><b style=${{ fontWeight: 600 }}>${x.n}</b></td><td className="nw">${weekLabel(x.w)}</td><td className="r num"><b>${h1(x.t)}</b></td><td><${Chip} s=${cdChip(x.st)}>${CD_LABEL[x.st]}<//></td><td className="num muted">${x.sa ? fmtTs(x.sa) : '—'}</td>
          <td className="r"><button type="button" className=${'btn sm' + (x.st === 'pending' ? '' : ' ghost')} onClick=${() => setRv(x)}>${x.st === 'pending' ? 'Review' : 'Open'}</button></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title=${tab === 'pending' ? 'No timesheets waiting' : 'Nothing here yet'}>Your consultants' weekly timesheets arrive here when they submit them. Approve them to confirm the hours before StratEdge invoices.<//>`}
    </section>
    ${rv && html`<${ClientTsReview} d=${rv} onClose=${() => setRv(null)} />`}
  </div>`;
}

/* ================= Client: consultants & attendance ================= */
function useWeekHours(C, ws) {
  const days = weekDays(ws); const months = [...new Set(days.map(mkey))];
  const [data, setData] = useState(null);
  const ids = C.active.map(r => r.id).join(',');
  useEffect(() => {
    let live = true; setData(null);
    const jobs = []; C.active.forEach(r => months.forEach(m => jobs.push({ id: r.id, m })));
    pMap(jobs, 4, j => dbGet(`pub/${C.cid}/att/${j.id}_${j.m}`).catch(() => null)).then(docs => {
      if (!live) return; const o = {};
      C.active.forEach(r => { o[r.id] = days.map(k => { const i = jobs.findIndex(j => j.id === r.id && j.m === mkey(k)); const d = docs[i]; return (d && d.days && d.days[k]) || 0; }); });
      setData(o);
    });
    return () => { live = false; };
  }, [ws, ids]);
  return { days, data };
}
function ClientConsultants() {
  const P = usePortal(); const C = useClient();
  const ws = weekStart(); const { data } = useWeekHours(C, ws);
  if (C.loading) return html`<${Spinner} />`;
  const list = C.roster.slice().sort((a, b) => (a.st === 'inactive') - (b.st === 'inactive') || (a.n || '').localeCompare(b.n || ''));
  return html`<div className="stack">
    <p className="muted small">Consultants StratEdge has placed with ${company(P)}. Hours shown are clocked in the portal this week (${weekLabel(ws)}).</p>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${list.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Consultant</th><th>Title</th><th>Start date</th><th>Right now</th><th className="r">Hours this week</th><th>Status</th></tr></thead>
        <tbody>${list.map(r => { const l = C.liveById[r.id]; const h = data && data[r.id] ? data[r.id].reduce((a, b) => a + b, 0) : null; return html`<tr key=${r.id}>
          <td><b style=${{ fontWeight: 600 }}>${r.n}</b></td><td>${r.ti || '—'}</td><td className="num">${r.sd ? fmtDate(r.sd, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
          <td>${l && l.on ? html`<${Chip} s="ok">In since ${fmtTime(l.i)}<//>` : l && l.at ? html`<span className="muted small">Last out ${fmtTs(l.at)}</span>` : html`<span className="muted small">—</span>`}</td>
          <td className="r num">${h == null ? '…' : hm(h)}</td><td><${Chip} s=${r.st === 'inactive' ? 'inactive' : 'active'}>${r.st === 'inactive' ? 'Ended' : 'Active'}<//></td></tr>`; })}</tbody></table></div>`
        : html`<${Empty} title="No consultants assigned yet">When StratEdge links a consultant to ${company(P)}, they appear here with their hours.<//>`}
    </section>
  </div>`;
}
function ClientAttendance() {
  const C = useClient(); const toast = useToast();
  const [ws, setWs] = useState(weekStart());
  const { days, data } = useWeekHours(C, ws);
  if (C.loading) return html`<${Spinner} />`;
  const exp = async () => {
    try { await saveDownload(`attendance_${ws}.csv`, toCSV([['Consultant', ...days, 'Total hours'], ...C.active.map(r => { const h = (data && data[r.id]) || [0, 0, 0, 0, 0, 0, 0]; return [r.n, ...h.map(m => hrs(m)), hrs(h.reduce((a, b) => a + b, 0))]; })])); }
    catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); }
  };
  return html`<div className="stack">
    <div className="toolbar">
      <div className="wknav"><button type="button" className="btn ghost icon" aria-label="Previous week" onClick=${() => setWs(addDays(ws, -7))}><${Icon} n="left" /></button><b>${weekLabel(ws)}</b>
        <button className="btn ghost icon" aria-label="Next week" disabled=${ws >= weekStart()} onClick=${() => setWs(addDays(ws, 7))}><${Icon} n="right" /></button></div>
      ${ws !== weekStart() && html`<button type="button" className="btn ghost sm" onClick=${() => setWs(weekStart())}>This week</button>`}
      <div className="push"><button type="button" className="btn ghost" disabled=${!data || !C.active.length} onClick=${exp}><${Icon} n="down" />Export week</button></div>
    </div>
    ${C.onClock.length > 0 && html`<div className="note ok"><span><b>On the clock now:</b> ${C.onClock.map(l => `${l.n} (since ${fmtTime(l.i)})`).join(', ')}</span></div>`}
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${!C.active.length ? html`<${Empty} title="No consultants assigned yet" />` : !data ? html`<${Spinner} />` : html`<div className="tblwrap"><table className="tbl">
        <thead><tr><th>Consultant</th>${days.map((k, i) => html`<th key=${k} className="r">${DOW[i]} ${parseD(k).getDate()}</th>`)}<th className="r">Total</th></tr></thead>
        <tbody>${C.active.map(r => { const h = data[r.id] || []; return html`<tr key=${r.id}><td><b style=${{ fontWeight: 600 }}>${r.n}</b></td>${h.map((m, i) => html`<td key=${i} className="r num">${m ? h1(m / 60) : ''}</td>`)}<td className="r num"><b>${hm(h.reduce((a, b) => a + b, 0))}</b></td></tr>`; })}</tbody></table></div>`}
    </section>
    <p className="muted small">Hours come from consultants' clock-ins and clock-outs in the employee portal. Submitted timesheets may differ; those are under Timesheets.</p>
  </div>`;
}

/* ================= Client: requirements ================= */
function ReqForm({ onClose }) {
  const P = usePortal(); const toast = useToast();
  const [f, setF] = useState({ ti: '', n: 1, loc: '', ty: 'C2C', md: 'Onsite', sk: '', d: '', sd: '' });
  const [busy, setBusy] = useState(false);
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (!f.ti.trim()) { toast('Add a title for the role.', true); return; }
    setBusy(true);
    try { await dbSet(`e/${P.uid}/req/${nid()}`, { ...f, ti: f.ti.trim(), n: Math.max(1, parseInt(f.n, 10) || 1), st: 'open', at: Date.now(), by: P.uid }); toast('Requirement sent to StratEdge.'); onClose(); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  return html`<${Modal} title="Post a staffing requirement" onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Sending…' : 'Send to StratEdge'}</button>`}>
    <div className="form">
      <div className="row2"><${Field} label="Role"><input value=${f.ti} onInput=${up('ti')} placeholder="e.g. SAP PP/QM Analyst" /><//><${Field} label="How many"><input type="number" min="1" value=${f.n} onInput=${up('n')} /><//></div>
      <div className="row3"><${Field} label="Location"><input value=${f.loc} onInput=${up('loc')} placeholder="City, state" /><//>
        <${Field} label="Engagement"><select value=${f.ty} onChange=${up('ty')}>${EMP_TYPES.map(t => html`<option key=${t}>${t}</option>`)}</select><//>
        <${Field} label="Work mode"><select value=${f.md} onChange=${up('md')}>${['Onsite', 'Hybrid', 'Remote'].map(t => html`<option key=${t}>${t}</option>`)}</select><//></div>
      <div className="row2"><${Field} label="Must-have skills"><input value=${f.sk} onInput=${up('sk')} placeholder="e.g. S/4HANA, PP, QM" /><//><${Field} label="Target start"><input type="date" value=${f.sd} onInput=${up('sd')} /><//></div>
      <${Field} label="Details"><textarea value=${f.d} onInput=${up('d')} placeholder="Project, duration, interview process, anything else that helps us match the right person" /><//>
    </div><//>`;
}
function ReqDetail({ r, onClose }) {
  const P = usePortal(); const C = useClient(); const toast = useToast();
  const live = C.reqs.find(x => x.id === r.id) || r;
  const [busy, setBusy] = useState(false);
  const path = `e/${P.uid}/req/${r.id}`;
  const setCand = async (id, st) => { setBusy(true); try { await dbMerge(path, { cands: { [id]: { st, cat: Date.now() } } }); toast(CAND_ST[st] + '. StratEdge will follow up.'); } catch (e) { toast(errText(e), true); } setBusy(false); };
  const setSt = async st => { setBusy(true); try { await dbMerge(path, { st, uat: Date.now() }); toast(st === 'closed' ? 'Requirement closed.' : 'Requirement reopened.'); } catch (e) { toast(errText(e), true); } setBusy(false); };
  const cands = Object.entries(live.cands || {}).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
  const closed = ['filled', 'closed'].includes(live.st);
  return html`<${Modal} wide title=${live.ti} onClose=${onClose} foot=${html`${closed ? html`<button type="button" className="btn ghost" disabled=${busy} onClick=${() => setSt('open')}>Reopen</button>` : html`<button type="button" className="btn ghost" disabled=${busy} onClick=${() => setSt('closed')}>Close requirement</button>`}<button type="button" className="btn" onClick=${onClose}>Done</button>`}>
    <div className="stack">
      <div className="actions"><${Chip} s=${live.st === 'filled' ? 'ok' : live.st === 'shared' ? 'new' : closed ? '' : 'amber'}>${REQ_ST[live.st || 'open']}<//><span className="muted small">Posted ${fmtDay(live.at)}</span></div>
      <dl className="kv"><dt>Need</dt><dd>${live.n || 1} ${(live.n || 1) > 1 ? 'people' : 'person'}${live.loc ? ', ' + live.loc : ''}${live.md ? ', ' + live.md : ''}${live.ty ? ', ' + live.ty : ''}${live.sd ? ', start ' + fmtDate(live.sd) : ''}</dd>
        ${live.sk && html`<dt>Skills</dt><dd>${live.sk}</dd>`}${live.d && html`<dt>Details</dt><dd style=${{ whiteSpace: 'pre-wrap' }}>${live.d}</dd>`}</dl>
      <div><h3 className="ph" style=${{ marginBottom: 8 }}>Candidates from StratEdge</h3>
        ${cands.length ? html`<div className="cands">${cands.map(([id, x]) => html`<div key=${id} className="cand">
          <div className="ph-row" style=${{ marginBottom: 0 }}><h4>${x.n}, ${x.ti}</h4><${Chip} s=${x.st === 'hired' ? 'ok' : x.st === 'rejected' ? 'red' : x.st === 'shared' ? '' : 'new'}>${CAND_ST[x.st] || x.st}<//></div>
          ${x.sum && html`<p className="muted small" style=${{ whiteSpace: 'pre-wrap' }}>${x.sum}</p>`}${x.av && html`<p className="muted small">Available ${x.av}</p>`}
          ${!closed && html`<div className="actions">${[['shortlist', 'Shortlist'], ['interview', 'Request interview'], ['hired', 'Hired'], ['rejected', 'Not a fit']].filter(([k]) => k !== x.st).map(([k, v]) => html`<button type="button" key=${k} className=${'btn sm ' + (k === 'rejected' ? 'danger' : k === 'hired' ? 'go' : 'ghost')} disabled=${busy} onClick=${() => setCand(id, k)}>${v}</button>`)}</div>`}
        </div>`)}</div>` : html`<p className="muted small">StratEdge is working on this. Candidates appear here as they're shared.</p>`}</div>
    </div><//>`;
}
function ClientRequirements() {
  const C = useClient();
  const [nw, setNw] = useState(false); const [open, setOpen] = useState(null); const [tab, setTab] = useState('open');
  if (C.loading) return html`<${Spinner} />`;
  const list = C.reqs.filter(r => tab === 'all' || (tab === 'open' ? !['filled', 'closed'].includes(r.st || 'open') : ['filled', 'closed'].includes(r.st)));
  const cur = open && C.reqs.find(r => r.id === open);
  return html`<div className="stack">
    <div className="toolbar"><div className="tabs" role="tablist" style=${{ marginBottom: 0, border: 0 }}>${[['open', 'Open'], ['done', 'Filled or closed'], ['all', 'All']].map(([k, v]) => html`<button type="button" key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}</button>`)}</div>
      <div className="push"><button type="button" className="btn" onClick=${() => setNw(true)}><${Icon} n="plus" />Post a requirement</button></div></div>
    ${list.length ? html`<div className="jobs">${list.map(r => { const n = Object.keys(r.cands || {}).length; return html`<div key=${r.id} className="job" style=${{ cursor: 'pointer' }} onClick=${() => setOpen(r.id)}>
      <div><h3>${r.ti}</h3><div className="meta">${[`${r.n || 1} ${(r.n || 1) > 1 ? 'people' : 'person'}`, r.loc, r.ty, r.md, r.sk].filter(Boolean).map(t => html`<span key=${t} className="tag">${t}</span>`)}</div>
        <p className="muted small" style=${{ marginTop: 8 }}>Posted ${fmtDay(r.at)}. ${n ? `${n} candidate${n === 1 ? '' : 's'} shared.` : 'No candidates yet.'}</p></div>
      <${Chip} s=${r.st === 'filled' ? 'ok' : r.st === 'shared' ? 'new' : ['closed'].includes(r.st) ? '' : 'amber'}>${REQ_ST[r.st || 'open']}<//></div>`; })}</div>`
      : html`<div className="panel"><${Empty} title=${tab === 'open' ? 'No open requirements' : 'Nothing here yet'} action=${html`<button type="button" className="btn" onClick=${() => setNw(true)}>Post a requirement</button>`}>Tell StratEdge who you need. Your account manager reviews it and shares matching candidates here for you to shortlist or interview.<//></div>`}
    ${nw && html`<${ReqForm} onClose=${() => setNw(false)} />`}
    ${cur && html`<${ReqDetail} key=${cur.id} r=${cur} onClose=${() => setOpen(null)} />`}
  </div>`;
}

/* ================= Client: reports ================= */
function ClientReports() {
  const C = useClient(); const toast = useToast();
  const [from, setFrom] = useState(addDays(weekStart(), -21)); const [to, setTo] = useState(weekStart());
  if (C.loading) return html`<${Spinner} />`;
  const f = weekStart(from), t = weekStart(to);
  const byC = {};
  C.sheets.forEach(x => { if (x.w < f || x.w > t || x.st === 'withdrawn') return; const r = byC[x.uid] || (byC[x.uid] = { n: x.n, weeks: 0, total: 0, appr: 0, pend: 0 }); r.weeks++; r.total += x.t || 0; if (x.st === 'approved') r.appr += x.t || 0; else if (x.st === 'pending') r.pend += x.t || 0; });
  const rows = Object.values(byC).sort((a, b) => a.n.localeCompare(b.n));
  const tot = rows.reduce((a, r) => ({ total: a.total + r.total, appr: a.appr + r.appr, pend: a.pend + r.pend }), { total: 0, appr: 0, pend: 0 });
  const exp = async () => {
    try { await saveDownload(`hours_${f}_to_${addDays(t, 6)}.csv`, toCSV([['Consultant', 'Weeks', 'Submitted hours', 'Approved by you', 'Awaiting your approval'], ...rows.map(r => [r.n, r.weeks, h1(r.total), h1(r.appr), h1(r.pend)])])); }
    catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); }
  };
  return html`<div className="stack">
    <div className="toolbar">
      <${Field} label="From week of"><input type="date" value=${from} onInput=${e => e.target.value && setFrom(e.target.value)} /><//>
      <${Field} label="To week of"><input type="date" value=${to} onInput=${e => e.target.value && setTo(e.target.value)} /><//>
      <div className="push" style=${{ alignSelf: 'flex-end' }}><button type="button" className="btn" disabled=${!rows.length} onClick=${exp}><${Icon} n="down" />Export CSV</button></div>
    </div>
    <p className="muted small">Submitted timesheet hours for weeks of ${weekLabel(f)} through ${weekLabel(t)}.</p>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${rows.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Consultant</th><th className="r">Weeks</th><th className="r">Submitted</th><th className="r">Approved by you</th><th className="r">Awaiting</th></tr></thead>
        <tbody>${rows.map(r => html`<tr key=${r.n}><td><b style=${{ fontWeight: 600 }}>${r.n}</b></td><td className="r num">${r.weeks}</td><td className="r num"><b>${h1(r.total)}</b></td><td className="r num">${h1(r.appr)}</td><td className="r num">${h1(r.pend)}</td></tr>`)}
          <tr><td><b>All consultants</b></td><td /><td className="r num"><b>${h1(tot.total)}</b></td><td className="r num"><b>${h1(tot.appr)}</b></td><td className="r num"><b>${h1(tot.pend)}</b></td></tr></tbody></table></div>`
        : html`<${Empty} title="No timesheets in this range">Widen the range, or check back after your consultants submit their weeks.<//>`}
    </section>
  </div>`;
}
