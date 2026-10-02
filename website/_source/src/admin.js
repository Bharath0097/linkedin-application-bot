/* ================= Admin: shared ================= */
function AdminKpis() {
  const A = usePortal().admin; const logs = useCol('log'); const online = logs.docs.filter(d => d.seen && Date.now() - d.seen < 10 * 60000).length;
  return html`<div className="kpis">
    <a href="#/portal/admin/logins"><b>${online}</b><span>Signed in now</span></a>
    <a href="#/portal/admin/attendance"><b>${A.onClock.length}</b><span>On the clock now</span></a>
    <a href="#/portal/admin/approvals"><b>${A.pendTs.length}</b><span>Timesheets to approve</span></a>
    <a href="#/portal/admin/approvals?tab=leave"><b>${A.pendLv.length}</b><span>Time-off requests</span></a>
    <a href="#/portal/admin/team?tab=new"><b>${A.requests.length}</b><span>Access requests</span></a>
    <a href="#/portal/admin/website?tab=inbox"><b>${A.unread}</b><span>New inquiries</span></a>
  </div>`;
}
const InviteSteps = () => html`<section className="panel"><h2 className="ph" style=${{ marginBottom: 10 }}>How people get access</h2>
  <ol style=${{ margin: 0, paddingLeft: 20, display: 'grid', gap: 8, color: 'var(--ink-2)' }}>
    <li>Send them to the website's <b>Log in</b> page. They create an account with their email and a password, choose "consultant" or "client contact", and fill in their profile.</li>
    <li>They appear here under Access requests. Approve them and set their client, projects and engagement type. Client contacts get linked to their company.</li>
    <li>Give StratEdge colleagues admin access from their member card. Reset a forgotten password from the same place.</li>
  </ol></section>`;
const tsRowsFor = d => (d && d.rows) || [];
const clientOf = (A, m) => (m.r && m.r.cid && A.clientsById[m.r.cid]) || null;
async function loadReqs(A) {
  const emps = A.members.filter(m => m.role === 'employer' && m.r && m.r.cid);
  const lists = await pMap(emps, 4, m => dbList(`e/${m.id}/req`).catch(() => []));
  const out = []; emps.forEach((m, i) => lists[i].forEach(r => out.push({ ...r, m, cl: (clientOf(A, m) || {}).n || m.r.cl || '' })));
  return out.sort((a, b) => (b.at || 0) - (a.at || 0));
}

/* Timesheet review (admin) */
function TsReview({ m, w, onClose }) {
  const P = usePortal(); const toast = useToast();
  const [d, setD] = useState(undefined); const [att, setAtt] = useState(null); const [pubd, setPubd] = useState(undefined);
  const [c, setC] = useState(''); const [busy, setBusy] = useState(false);
  const cid = m.r && m.r.cid;
  useEffect(() => {
    dbGet(`u/${m.id}/ts/${w}`).then(setD).catch(e => { toast(errText(e), true); setD(null); });
    if (cid) dbGet(`pub/${cid}/ts/${m.id}_${w}`).then(setPubd).catch(() => setPubd(null)); else setPubd(null);
    (async () => {
      const days = weekDays(w); const docs = {};
      for (const x of [...new Set(days.map(mkey))]) docs[x] = await dbGet(`u/${m.id}/att/${x}`);
      setAtt(days.map(k => ((((docs[mkey(k)] || {}).days || {})[k] || {}).s || []).reduce((a, s) => a + (s.o ? mins(s.i, s.o) : 0), 0)));
    })().catch(() => setAtt(null));
  }, []);
  const sum = (m.u.ts || {})[w]; const rev = ((m.r || {}).rev || {})[w]; const st = tsStatus(sum, rev);
  const cst = cid && sum && sum.s === 'submitted' ? cdStatus(pubd) : 'none';
  const decide = async s => {
    if ((s === 'rejected' || s === 'reopened') && !c.trim()) { toast('Add a note so the consultant knows what to change.', true); return; }
    setBusy(true);
    try {
      await dbMerge(`r/${m.id}`, { rev: { [w]: { s, c: c.trim(), at: Date.now(), by: P.uid, v: sum.u } } });
      toast(s === 'approved' ? 'Timesheet approved.' : s === 'rejected' ? 'Timesheet returned with your note.' : 'Timesheet reopened.'); onClose();
    } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const days = weekDays(w); const rows = tsRowsFor(d);
  const dayT = DOW.map((_, i) => rows.reduce((a, r) => a + (r.h[i] || 0), 0));
  const foot = st === 'pending' ? html`<button className="btn danger" disabled=${busy} onClick=${() => decide('rejected')}>Return with note</button><button className="btn go" disabled=${busy} onClick=${() => decide('approved')}>Approve timesheet</button>`
    : st === 'approved' ? html`<button className="btn ghost" disabled=${busy} onClick=${() => decide('reopened')}>Reopen for changes</button>` : html`<button className="btn ghost" onClick=${onClose}>Close</button>`;
  return html`<${Modal} wide title=${`${nameOf(m.id, m.u, P.people)}: ${weekLabel(w)}`} onClose=${onClose} foot=${foot}>
    ${d === undefined ? html`<${Spinner} />` : !d ? html`<${Empty} title="This timesheet isn't available">It may have been withdrawn.<//>` : html`<div className="stack">
      <div className="actions"><${Chip} s=${st}>${TS_LABEL[st]}<//>${cst !== 'none' && html`<${Chip} s=${cst === 'approved' ? 'ok' : cst === 'returned' ? 'red' : 'amber'}>${CD_LABEL[cst]}<//>`}<span className="muted small">${sum && sum.sa ? 'Submitted ' + fmtTs(sum.sa) : 'Not submitted'}${m.r && m.r.cl ? ', ' + m.r.cl : ''}${m.r && m.r.ec ? ' for ' + m.r.ec : ''}</span></div>
      ${pubd && pubd.cd && cst !== 'pending' && html`<div className=${'note ' + (cst === 'approved' ? 'ok' : 'red')}><span><b>Client ${cst === 'approved' ? 'approved' : 'returned'} ${fmtDay(pubd.cd.at)}.</b> ${pubd.cd.c || ''}</span></div>`}
      ${cid && pubd && pubd.t !== undefined && sum && pubd.u !== sum.u && pubd.s === 'submitted' && html`<div className="note amber"><span>The copy shared with the client differs from this submission. Ask the consultant to resubmit.</span></div>`}
      <div className="tblwrap"><table className="tbl">
        <thead><tr><th>Project</th><th>Task</th>${days.map((k, i) => html`<th key=${k} className="r">${DOW[i]} ${parseD(k).getDate()}</th>`)}<th className="r">Total</th></tr></thead>
        <tbody>${rows.map((r, i) => html`<tr key=${i}><td>${r.p}</td><td>${r.t}</td>${r.h.map((x, j) => html`<td key=${j} className="r num">${x ? h1(x) : ''}</td>`)}<td className="r num"><b>${h1(r.h.reduce((a, b) => a + b, 0))}</b></td></tr>`)}
          <tr><td colSpan="2"><b>Timesheet total</b></td>${dayT.map((t, i) => html`<td key=${i} className="r num"><b>${h1(t)}</b></td>`)}<td className="r num"><b>${h1(dayT.reduce((a, b) => a + b, 0))}</b></td></tr>
          ${att && html`<tr className="sub"><td colSpan="2">Clocked in the portal</td>${att.map((t, i) => html`<td key=${i} className="r num">${t ? h1(t / 60) : ''}</td>`)}<td className="r num">${h1(att.reduce((a, b) => a + b, 0) / 60)}</td></tr>`}
        </tbody></table></div>
      ${d.note && html`<div className="note info"><span><b>Note from consultant:</b> ${d.note}</span></div>`}
      <div><h3 className="ph" style=${{ marginBottom: 8 }}>Attachments</h3>
        ${(d.files || []).length ? html`<ul className="files">${d.files.map(f => html`<li key=${f.id}><${Icon} n="file" /><div className="fn"><b>${f.n}</b><span>${sizeLabel(f.sz || 0)}</span></div><${FileActions} base=${'u/' + m.id} f=${f} /></li>`)}</ul>`
          : html`<p className="muted small">No attachments.${m.r && m.r.na ? ' This consultant is set to require a signed timesheet.' : ''}</p>`}</div>
      ${(st === 'pending' || st === 'approved') && html`<${Field} label=${st === 'pending' ? 'Note to consultant (required to return)' : 'Reason for reopening'}><textarea value=${c} onInput=${e => setC(e.target.value)} placeholder=${st === 'pending' ? 'e.g. Thursday hours don\u2019t match the client-signed sheet' : 'What should they change?'} /><//>`}
    </div>`}<//>`;
}

/* ================= Admin: overview ================= */
function AdminOverview() {
  const P = usePortal(); const A = P.admin;
  const [reqs, setReqs] = useState(null);
  useEffect(() => { if (!A.loading) loadReqs(A).then(setReqs).catch(() => setReqs([])); }, [A.loading, A.employers.length]);
  if (A.loading) return html`<${Spinner} />`;
  const openReqs = (reqs || []).filter(r => !['filled', 'closed'].includes(r.st || 'open'));
  return html`<div className="stack">
    <${AdminKpis} />
    <div className="g2" style=${{ alignItems: 'start' }}>
      <section className="panel"><div className="ph-row"><h2 className="ph">On the clock now</h2><a className="small" href="#/portal/admin/attendance">Team attendance</a></div>
        ${A.onClock.length ? html`<ul className="list">${A.onClock.map(m => html`<li key=${m.id}><${Person} uid=${m.id} root=${m.u} people=${P.people} sub=${(m.r && m.r.cl) || m.u.p.ti} />
          <span className="muted small num">Since ${fmtTime(m.u.clock.i)}${m.u.clock.d !== dkey() ? ', ' + fmtDate(m.u.clock.d) : ''}<br />${MODES[m.u.clock.m] || ''}</span></li>`)}</ul>`
          : html`<${Empty} title="Nobody is clocked in right now" />`}</section>
      <section className="panel"><div className="ph-row"><h2 className="ph">Waiting on you</h2><a className="small" href="#/portal/admin/approvals">All approvals</a></div>
        ${A.pendTs.length + A.pendLv.length + A.requests.length + openReqs.length ? html`<ul className="list">
          ${A.requests.slice(0, 3).map(m => html`<li key=${'r' + m.id}><${Person} uid=${m.id} root=${m.u} people=${P.people} sub=${'Access request, ' + (m.role === 'employer' ? 'client contact' : m.role === 'employee' ? 'StratEdge employee' : 'consultant')} /><a className="btn ghost sm" href="#/portal/admin/team?tab=new">Review</a></li>`)}
          ${A.pendTs.slice(0, 5).map(x => html`<li key=${x.m.id + x.w}><${Person} uid=${x.m.id} root=${x.m.u} people=${P.people} sub=${`Timesheet, ${weekLabel(x.w)}, ${h1(x.s.t)} h`} /><a className="btn ghost sm" href="#/portal/admin/approvals">Review</a></li>`)}
          ${A.pendLv.slice(0, 3).map(x => html`<li key=${x.id}><${Person} uid=${x.m.id} root=${x.m.u} people=${P.people} sub=${`${LEAVE_K[x.l.k]}, ${fmtDate(x.l.f)}`} /><a className="btn ghost sm" href="#/portal/admin/approvals?tab=leave">Review</a></li>`)}
          ${openReqs.slice(0, 3).map(r => html`<li key=${r.m.id + r.id}><div><div className="t">${r.ti}</div><div className="m">Requirement from ${r.cl}, ${REQ_ST[r.st || 'open']}</div></div><a className="btn ghost sm" href="#/portal/admin/requirements">Open</a></li>`)}
        </ul>` : html`<${Empty} title="Nothing waiting">Timesheets, time off, access requests and client requirements that need a decision show up here.<//>`}</section>
    </div>
    ${A.members.length < 4 && html`<${InviteSteps} />`}
  </div>`;
}

/* ================= Admin: team ================= */
function MemberModal({ m, onClose }) {
  const P = usePortal(); const A = P.admin; const toast = useToast();
  const r = m.r || {};
  const [f, setF] = useState({ st: m.st === 'new' ? 'active' : m.st, role: m.role, cid: r.cid || '', ty: r.ty || 'C2C', cl: r.cl || (m.role === 'employer' ? m.u.p.co || '' : ''), ec: r.ec || '', pr: r.pr || '', mgr: r.mgr || '', sd: r.sd || '', na: !!r.na, norec: !!r.norec, br: r.br || '', brc: r.brc || 'USD' });
  const [newC, setNewC] = useState({ n: m.u.p.co || '', ec: '' });
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('ts');
  const [rv, setRv] = useState(null);
  const up = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const pickClient = e => {
    const v = e.target.value; const c = A.clientsById[v];
    setF({ ...f, cid: v, ...(c ? { cl: c.n, ec: c.ec || f.ec } : {}) });
  };
  const emp = f.role === 'employer';
  const save = async () => {
    if (emp && !f.cid) { toast('Choose the company this contact belongs to, or add it as a new client.', true); return; }
    if (f.cid === '__new' && !newC.n.trim()) { toast('Add the new client\u2019s name.', true); return; }
    setBusy(true);
    try {
      let cid = f.cid; let cl = f.cl, ec = f.ec;
      if (cid === '__new') { cid = token(); await dbSet(`org/admin/clients/${cid}`, { n: newC.n.trim(), ec: newC.ec.trim(), at: Date.now(), by: P.uid }); cl = newC.n.trim(); ec = newC.ec.trim() || ec; }
      const now = Date.now();
      await dbMerge(`r/${m.id}`, { st: f.st, role: f.role, cid: cid || null, ty: f.ty, cl, ec, pr: f.pr, mgr: f.mgr, sd: f.sd, na: f.na, norec: !emp && !!f.norec, br: r2(f.br), brc: f.brc || 'USD', at: now, by: P.uid });
      if (!m.self) { try { await api('admin_status', { uid: m.id, status: f.st === 'active' ? 'active' : 'disabled' }); } catch (e) { /* account status is secondary */ } A.loadAccounts(); }
      if (r.cid && r.role !== 'employer' && r.cid !== cid) await dbDel(`pub/${r.cid}/roster/${m.id}`).catch(() => {});
      if (!emp && cid) await dbSet(`pub/${cid}/roster/${m.id}`, { n: m.u.p.n, ti: m.u.p.ti || '', sd: f.sd || '', st: f.st === 'active' ? 'active' : 'inactive', at: now });
      if (emp && r.cid && r.role !== 'employer') await dbDel(`pub/${r.cid}/roster/${m.id}`).catch(() => {});
      toast(m.st === 'new' ? `${firstName(m.u.p.n)} is approved and can use the ${portalLabel(f.role).toLowerCase()}.` : 'Saved.'); if (m.st === 'new') onClose();
    } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const p = m.u.p; const acct = A.accounts[m.id];
  const [temp, setTemp] = useState('');
  const resetPw = async () => { setBusy(true); try { const r = await api('admin_reset', { uid: m.id }); setTemp(r.password); } catch (e) { toast(errText(e), true); } setBusy(false); };
  const toggleAdmin = async e => { const role = e.target.value; try { await api('admin_role', { uid: m.id, role }); A.loadAccounts(); toast(role === 'admin' ? `${firstName(p.n)} now has admin access.` : role === 'hr' ? `${firstName(p.n)} now has HR portal access.` : role === 'acct' ? `${firstName(p.n)} now has accounting portal access.` : 'Staff access removed.'); } catch (x) { toast(errText(x), true); } };
  const startOnb = async () => { setBusy(true); try { await dbMerge(`r/${m.id}`, { onb: { kind: 'onb', started: Date.now(), items: {}, by: P.uid } }); toast('Onboarding checklist started. They see it in their portal.'); } catch (x) { toast(errText(x), true); } setBusy(false); };
  return html`<${Modal} wide title=${p.n} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Close</button><button className=${'btn' + (m.st === 'new' ? ' go' : '')} disabled=${busy} onClick=${save}>${m.st === 'new' ? 'Approve access' : 'Save'}</button>`}>
    <div className="stack">
      <div className="g2">
        <dl className="kv"><dt>Requested</dt><dd>${portalLabel(p.role)}${p.co ? ', ' + p.co : ''}</dd><dt>Email</dt><dd><a href=${'mailto:' + p.e}>${p.e}</a></dd>${p.ph && html`<dt>Phone</dt><dd><a href=${'tel:' + p.ph}>${p.ph}</a></dd>`}
          ${p.ti && html`<dt>Title</dt><dd>${p.ti}</dd>`}${p.loc && html`<dt>Location</dt><dd>${p.loc}</dd>`}<dt>Joined portal</dt><dd>${m.u.joined ? fmtDay(m.u.joined) : '—'}</dd></dl>
        <div className="form">
          <div className="row2"><${Field} label="Status"><select value=${f.st} onChange=${up('st')}><option value="active">Active</option><option value="inactive">Inactive (access paused)</option></select><//>
            <${Field} label="Portal" hint="Consultants get resume matching and jobs; employees get the recruiting workspace."><select value=${f.role} onChange=${up('role')}><option value="consultant">Consultant portal</option><option value="employee">Employee portal (StratEdge staff)</option><option value="employer">Client portal (client contact)</option></select><//></div>
          <${Field} label=${emp ? 'Company' : 'Client company'} hint=${emp ? 'Their company\u2019s client workspace.' : 'Links this consultant to a client workspace so the client can approve their timesheets.'}>
            <select value=${f.cid} onChange=${pickClient}><option value="">${emp ? 'Choose a client' : 'No client workspace'}</option>${A.clients.map(c => html`<option key=${c.id} value=${c.id}>${c.n}${c.ec ? ' (' + c.ec + ')' : ''}</option>`)}<option value="__new">Add a new client…</option></select><//>
          ${f.cid === '__new' && html`<div className="row2"><${Field} label="New client name"><input value=${newC.n} onInput=${e => setNewC({ ...newC, n: e.target.value })} /><//><${Field} label="End client (optional)"><input value=${newC.ec} onInput=${e => setNewC({ ...newC, ec: e.target.value })} /><//></div>`}
          ${!emp && html`<${Fragment}>
            <div className="row2"><${Field} label="Engagement"><select value=${f.ty} onChange=${up('ty')}>${EMP_TYPES.map(t => html`<option key=${t}>${t}</option>`)}</select><//><${Field} label="Start date"><input type="date" value=${f.sd} onInput=${up('sd')} /><//></div>
            <div className="row2"><${Field} label="Billed to (client or vendor)"><input value=${f.cl} onInput=${up('cl')} placeholder="Who you invoice" /><//><${Field} label="End client"><input value=${f.ec} onInput=${up('ec')} /><//></div>
            <${Field} label="Projects" hint="Comma-separated. These become the project choices on their timesheet."><input value=${f.pr} onInput=${up('pr')} placeholder="e.g. Network refresh, SAP rollout" /><//>
            <div className="row2"><${Field} label="Timesheet approver"><input value=${f.mgr} onInput=${up('mgr')} placeholder="Client manager name" /><//>
              <${Field} label="Bill rate to client (per hour)" hint="Used when invoices pull approved hours."><div style=${{ display: 'flex', gap: 8 }}><input type="number" step="0.01" min="0" value=${f.br} onInput=${up('br')} placeholder="e.g. 85" /><select value=${f.brc} onChange=${up('brc')} style=${{ maxWidth: 110 }}><option value="USD">USD</option><option value="INR">INR</option></select></div><//></div>
            <label className="check"><input type="checkbox" checked=${f.na} onChange=${up('na')} /><span>Require a client-signed timesheet attachment before submitting</span></label>
          <//>`}
        </div>
      </div>
      <div className="panel" style=${{ background: 'var(--surface-2)', display: 'grid', gap: 10 }}><h3 className="ph">Account</h3>
        <p className="muted small">Signs in with ${acct ? acct.email : p.e}${acct && acct.status === 'disabled' ? '. Account paused.' : ''}</p>
        ${acct && !m.self && html`<div style=${{ maxWidth: 420 }}><${Field} label="Staff access" hint="HR: onboarding, documents, payroll, approvals. Admin: everything."><select value=${acct.role} onChange=${toggleAdmin}><option value="user">None (employee or client only)</option><option value="hr">HR portal</option><option value="acct">Accounting portal</option><option value="admin">Admin portal</option></select><//></div>`}
        ${f.role === 'employee' && html`<label className="check"><input type="checkbox" checked=${!!f.norec} onChange=${up('norec')} /><span>Hide the recruiting workspace (consultants, RTRs, submissions, daily reports) for this person. Every employee has it by default; consultants never see it.</span></label>`}
        ${!emp && m.st !== 'new' && html`<div className="actions">${m.r && m.r.onb && m.r.onb.kind !== 'done' ? html`<a className="btn ghost sm" href="#/portal/hr/onboarding">Onboarding in progress (${onbProgress(m.r.onb, P.tpl).done}/${onbProgress(m.r.onb, P.tpl).total})</a>` : html`<button className="btn ghost sm" disabled=${busy} onClick=${startOnb}>Start onboarding checklist</button>`}</div>`}
        <div className="actions"><button className="btn ghost sm" disabled=${busy} onClick=${resetPw}>Reset password</button>${temp && html`<span className="small">Temporary password: <b style=${{ fontFamily: 'inherit', fontSize: 16 }}>${temp}</b>. Share it privately; they can change it under Profile.</span>`}</div>
      </div>
      ${m.st !== 'new' && !emp && html`<${Fragment}>
        <div className="tabs" role="tablist">${[['ts', 'Timesheets'], ['pay', 'Pay'], ['tax', 'Tax'], ['att', 'Attendance'], ['docs', 'Documents'], ['lv', 'Time off']].map(([k, v]) => html`<button key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}</button>`)}</div>
        ${tab === 'pay' && html`<${PayForm} m=${m} />`}
      ${tab === 'tax' && html`<${TaxProfileForm} m=${m} />`}
        ${tab === 'ts' && (Object.keys(m.u.ts || {}).length ? html`<ul className="list">${Object.entries(m.u.ts).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 26).map(([w, s]) => { const x = tsStatus(s, (r.rev || {})[w]); return html`<li key=${w}>
            <div><div className="t">${weekLabel(w)}</div><div className="m">${h1(s.t)} hours${s.f ? `, ${s.f} attachment${s.f > 1 ? 's' : ''}` : ''}</div></div>
            <div className="actions"><${Chip} s=${x}>${TS_LABEL[x]}<//><button className="btn ghost sm" onClick=${() => setRv(w)}>Open</button></div></li>`; })}</ul>`
          : html`<${Empty} title="No timesheets yet" />`)}
        ${tab === 'att' && html`<${MemberAttendance} m=${m} />`}
        ${tab === 'docs' && html`<${MemberDocs} m=${m} />`}
        ${tab === 'lv' && (Object.keys(m.u.lv || {}).length ? html`<ul className="list">${Object.entries(m.u.lv).sort((a, b) => b[1].f.localeCompare(a[1].f)).map(([id, l]) => { const dec = (r.lvd || {})[id]; const s = l.x ? 'cancelled' : dec ? dec.s : 'pending'; return html`<li key=${id}>
            <div><div className="t">${LEAVE_K[l.k]}: ${fmtDate(l.f)}${l.t !== l.f ? ' to ' + fmtDate(l.t) : ''}</div><div className="m">${l.r || 'No note'}</div></div><${Chip} s=${s}>${s[0].toUpperCase() + s.slice(1)}<//></li>`; })}</ul>`
          : html`<${Empty} title="No time-off requests" />`)}
      <//>`}
    </div>
    ${rv && html`<${TsReview} m=${m} w=${rv} onClose=${() => setRv(null)} />`}<//>`;
}
function MemberAttendance({ m }) {
  const [mk, setMk] = useState(mkey(dkey()));
  const [d, setD] = useState(undefined);
  useEffect(() => { setD(undefined); dbGet(`u/${m.id}/att/${mk}`).then(x => setD(x || {})).catch(() => setD({})); }, [mk]);
  const rows = d ? attRows(d, m.u.clock && m.u.clock.on ? m.u.clock : null, Date.now()) : [];
  return html`<div className="stack" style=${{ gap: 10 }}>
    <div className="wknav"><button className="btn ghost icon" aria-label="Previous month" onClick=${() => setMk(addMonths(mk, -1))}><${Icon} n="left" /></button><b>${monthLabel(mk)}</b>
      <button className="btn ghost icon" aria-label="Next month" disabled=${mk >= mkey(dkey())} onClick=${() => setMk(addMonths(mk, 1))}><${Icon} n="right" /></button>
      <span className="muted small" style=${{ marginLeft: 8 }}>${hm(rows.reduce((a, x) => a + x.m, 0))} total</span></div>
    ${d === undefined ? html`<${Spinner} />` : rows.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Date</th><th>In</th><th>Out</th><th>Location</th><th className="r">Hours</th></tr></thead>
      <tbody>${rows.map(r => html`<tr key=${r.d + r.x.i}><td>${r.first ? fmtDate(r.d) : ''}</td><td className="num">${fmtTime(r.x.i)}${r.x.e ? html` <span className="chip amber" title=${r.x.n || 'Edited by consultant'}>Edited</span>` : ''}</td>
        <td className="num">${r.x.o ? fmtTime(r.x.o) : 'Working'}</td><td>${MODES[r.x.m] || ''}</td><td className="r num">${hm(r.m)}</td></tr>`)}</tbody></table></div>`
      : html`<${Empty} title=${'No attendance in ' + monthLabel(mk)} />`}
  </div>`;
}
function MemberDocs({ m }) {
  const files = useCol(`u/${m.id}/f`, 'at:desc');
  if (files.loading) return html`<${Spinner} />`;
  if (!files.docs.length) return html`<${Empty} title="No documents uploaded" />`;
  return html`<ul className="files">${files.docs.map(f => html`<li key=${f.id}><${Icon} n="file" /><div className="fn"><b>${f.n}</b><span>${DOC_CATS[f.c] || 'Other'}, ${fmtDay(f.at)}, ${sizeLabel(f.sz)}</span></div><${FileActions} base=${'u/' + m.id} f=${f} /></li>`)}</ul>`;
}
function AdminTeam({ q }) {
  const P = usePortal(); const A = P.admin;
  const [tab, setTab] = useState(q.tab || (A.requests.length ? 'new' : 'active'));
  const [s, setS] = useState(''); const [open, setOpen] = useState(null);
  if (A.loading) return html`<${Spinner} />`;
  const counts = { active: 0, new: 0, inactive: 0 }; A.members.forEach(m => { counts[m.st] = (counts[m.st] || 0) + 1; });
  const ql = s.trim().toLowerCase();
  const list = A.members.filter(m => m.st === tab && (!ql || [m.u.p.n, m.u.p.e, m.u.p.ti, m.u.p.co, m.r && m.r.cl, m.r && m.r.ec].filter(Boolean).join(' ').toLowerCase().includes(ql)));
  const cur = open && A.members.find(m => m.id === open);
  return html`<div className="stack">
    <div className="tabs" role="tablist">${[['active', 'Active'], ['new', 'Access requests'], ['inactive', 'Inactive']].map(([k, v]) => html`<button key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}<span className=${'chip' + (k === 'new' && counts.new ? ' amber' : '')}>${counts[k] || 0}</span></button>`)}</div>
    <div className="toolbar"><input style=${{ maxWidth: 340 }} type="search" placeholder="Search name, email, company" value=${s} onInput=${e => setS(e.target.value)} aria-label="Search team" /></div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${list.length ? html`<div className="tblwrap"><table className="tbl">
        <thead><tr><th>Person</th><th>Portal</th><th>Client</th><th>Engagement</th><th>Clock</th><th>Latest timesheet</th></tr></thead>
        <tbody>${list.map(m => { const lw = Object.keys(m.u.ts || {}).sort().pop(); const x = lw ? tsStatus(m.u.ts[lw], ((m.r || {}).rev || {})[lw]) : null; const emp = m.role === 'employer'; const c = clientOf(A, m);
          return html`<tr key=${m.id} className="click" tabIndex="0" onClick=${() => setOpen(m.id)} onKeyDown=${e => { if (e.key === 'Enter') setOpen(m.id); }}>
            <td><${Person} uid=${m.id} root=${m.u} people=${P.people} sub=${m.u.p.ti || m.u.p.e} /></td>
            <td><${Chip} s=${emp ? 'new' : m.role === 'consultant' ? 'ok' : ''}>${emp ? 'Client' : m.role === 'consultant' ? 'Consultant' : 'Employee'}<//>${A.accounts[m.id] && A.accounts[m.id].role === 'admin' ? html` <${Chip} s="ok">Admin<//>` : ''}${!emp && m.u.payReq && !(m.r && m.r.pay && +m.r.pay.amt) ? html` <${Chip} s="amber">Pay plan requested<//>` : ''}</td>
            <td>${(c && c.n) || (m.r && m.r.cl) || m.u.p.co || html`<span className="muted">Not set</span>`}${m.r && m.r.ec ? html`<div className="muted small">${m.r.ec}</div>` : ''}</td>
            <td>${emp ? '—' : (m.r && m.r.ty) || '—'}</td>
            <td>${emp ? '—' : m.u.clock && m.u.clock.on ? html`<${Chip} s="ok">In since ${fmtTime(m.u.clock.i)}<//>` : html`<span className="muted small">Out</span>`}</td>
            <td>${emp ? '—' : x ? html`<${Chip} s=${x}>${TS_LABEL[x]}<//><div className="muted small">${weekLabel(lw)}</div>` : html`<span className="muted small">None</span>`}</td></tr>`; })}</tbody></table></div>`
        : tab === 'new' ? html`<${Empty} title="No access requests">New people appear here after they open the portal and fill in their profile.<//>`
          : html`<${Empty} title=${ql ? 'No matches' : tab === 'active' ? 'No active team members yet' : 'No inactive team members'}>${!ql && tab === 'active' ? 'Approve access requests to add people here.' : ''}<//>`}
    </section>
    ${(() => { const orphans = Object.values(A.accounts).filter(a => !A.members.some(m => m.id === a.id) && a.id !== P.uid); return orphans.length ? html`<section className="panel"><h2 className="ph" style=${{ marginBottom: 8 }}>Accounts without a profile</h2>
      <p className="muted small" style=${{ marginBottom: 10 }}>These people created an account but haven't filled in their profile yet, so they can't be approved.</p>
      <ul className="list">${orphans.map(a => html`<li key=${a.id}><div><div className="t">${a.name}</div><div className="m">${a.email}, registered ${fmtDay(a.created)}</div></div></li>`)}</ul></section>` : null; })()}
    ${A.members.length < 4 && html`<${InviteSteps} />`}
    ${cur && html`<${MemberModal} key=${cur.id} m=${cur} onClose=${() => setOpen(null)} />`}
  </div>`;
}

/* ================= Admin: clients ================= */
function ClientModal({ c, onClose }) {
  const P = usePortal(); const toast = useToast();
  const [f, setF] = useState({ n: '', ec: '', loc: '', notes: '', ...(c || {}) });
  const [busy, setBusy] = useState(false);
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (!f.n.trim()) { toast('Add the client name.', true); return; }
    setBusy(true);
    try { await dbMerge(`org/admin/clients/${c ? c.id : token()}`, { n: f.n.trim(), ec: (f.ec || '').trim(), loc: (f.loc || '').trim(), notes: (f.notes || '').trim(), at: c ? c.at : Date.now(), by: P.uid }); toast(c ? 'Client updated.' : 'Client added.'); onClose(); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  return html`<${Modal} title=${c ? 'Edit client' : 'Add a client'} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy} onClick=${save}>${c ? 'Save' : 'Add client'}</button>`}>
    <div className="form">
      <${Field} label="Client name" hint="The company whose managers approve timesheets in the client portal."><input value=${f.n} onInput=${up('n')} /><//>
      <div className="row2"><${Field} label="End client (if different)"><input value=${f.ec} onInput=${up('ec')} /><//><${Field} label="Location"><input value=${f.loc} onInput=${up('loc')} placeholder="City, state" /><//></div>
      <${Field} label="Notes (admin only)"><textarea value=${f.notes} onInput=${up('notes')} placeholder="Billing contact, PO numbers, approval rules" /><//>
    </div><//>`;
}
function AdminClients() {
  const P = usePortal(); const A = P.admin;
  const [edit, setEdit] = useState(undefined);
  if (A.loading) return html`<${Spinner} />`;
  const rows = A.clients.map(c => ({ c, cons: A.members.filter(m => m.role !== 'employer' && m.st === 'active' && m.r && m.r.cid === c.id), cons2: A.members.filter(m => m.role === 'employer' && m.r && m.r.cid === c.id) }));
  return html`<div className="stack">
    <div className="toolbar"><p className="muted small">Each client gets its own workspace. Consultants linked to it appear there, and the client's contacts approve their hours.</p><div className="push"><button className="btn" onClick=${() => setEdit(null)}><${Icon} n="plus" />Add client</button></div></div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${rows.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Client</th><th>End client</th><th>Consultants</th><th>Client contacts</th><th /></tr></thead>
        <tbody>${rows.map(({ c, cons, cons2 }) => html`<tr key=${c.id}><td><b style=${{ fontWeight: 600 }}>${c.n}</b>${c.loc ? html`<div className="muted small">${c.loc}</div>` : ''}</td><td>${c.ec || '—'}</td>
          <td>${cons.length ? cons.map(m => m.u.p.n).join(', ') : html`<span className="muted">None yet</span>`}</td>
          <td>${cons2.length ? cons2.map(m => m.u.p.n).join(', ') : html`<span className="muted">None yet</span>`}</td>
          <td className="r"><button className="btn ghost sm" onClick=${() => setEdit(c)}>Edit</button></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title="No clients yet" action=${html`<button className="btn" onClick=${() => setEdit(null)}>Add your first client</button>`}>Add the companies your consultants work for. You can also create one while approving a consultant or client contact.<//>`}
    </section>
    ${edit !== undefined && html`<${ClientModal} c=${edit} onClose=${() => setEdit(undefined)} />`}
  </div>`;
}

/* ================= Admin: requirements ================= */
function ReqDetailAdmin({ r, onClose, onChanged }) {
  const P = usePortal(); const toast = useToast();
  const [st, setSt] = useState(r.st || 'open');
  const [c, setC] = useState({ n: '', ti: '', sum: '', av: '' });
  const [busy, setBusy] = useState(false);
  const path = `e/${r.m.id}/req/${r.id}`;
  const upC = k => e => setC({ ...c, [k]: e.target.value });
  const saveSt = async v => { setSt(v); try { await dbMerge(path, { st: v, uat: Date.now() }); onChanged(); toast('Status updated.'); } catch (e) { toast(errText(e), true); } };
  const share = async () => {
    if (!c.n.trim() || !c.ti.trim()) { toast('Add the candidate\u2019s name and title.', true); return; }
    setBusy(true);
    try { await dbMerge(path, { cands: { [nid()]: { n: c.n.trim(), ti: c.ti.trim(), sum: c.sum.trim(), av: c.av.trim(), st: 'shared', at: Date.now(), by: P.uid } }, st: st === 'open' || st === 'reviewing' ? 'shared' : st, uat: Date.now() }); setC({ n: '', ti: '', sum: '', av: '' }); if (st === 'open' || st === 'reviewing') setSt('shared'); onChanged(); toast('Candidate shared with the client.'); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const cands = Object.entries(r.cands || {}).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
  return html`<${Modal} wide title=${r.ti} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Close</button>`}>
    <div className="stack">
      <dl className="kv"><dt>Client</dt><dd>${r.cl}, posted by ${r.m.u.p.n} on ${fmtDay(r.at)}</dd><dt>Need</dt><dd>${r.n || 1} ${(r.n || 1) > 1 ? 'people' : 'person'}${r.loc ? ', ' + r.loc : ''}${r.md ? ', ' + r.md : ''}${r.ty ? ', ' + r.ty : ''}${r.sd ? ', start ' + fmtDate(r.sd) : ''}</dd>
        ${r.sk && html`<dt>Skills</dt><dd>${r.sk}</dd>`}${r.d && html`<dt>Details</dt><dd style=${{ whiteSpace: 'pre-wrap' }}>${r.d}</dd>`}</dl>
      <div style=${{ maxWidth: 320 }}><${Field} label="Status"><select value=${st} onChange=${e => saveSt(e.target.value)}>${Object.entries(REQ_ST).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//></div>
      <div><h3 className="ph" style=${{ marginBottom: 8 }}>Candidates shared</h3>
        ${cands.length ? html`<div className="cands">${cands.map(([id, x]) => html`<div key=${id} className="cand"><div className="ph-row" style=${{ marginBottom: 0 }}><h4>${x.n}, ${x.ti}</h4><${Chip} s=${x.st === 'hired' ? 'ok' : x.st === 'rejected' ? 'red' : x.st === 'shared' ? '' : 'new'}>${CAND_ST[x.st] || x.st}<//></div>
          ${x.sum && html`<p className="muted small" style=${{ whiteSpace: 'pre-wrap' }}>${x.sum}</p>`}<p className="muted small">${x.av ? 'Available ' + x.av + '. ' : ''}Shared ${fmtDay(x.at)}${x.fb ? '. Client: ' + x.fb : ''}</p></div>`)}</div>`
          : html`<p className="muted small">No candidates shared yet.</p>`}</div>
      <div className="panel form" style=${{ background: 'var(--surface-2)' }}><h3 className="ph">Share a candidate</h3>
        <div className="row2"><${Field} label="Name or initials"><input value=${c.n} onInput=${upC('n')} placeholder="e.g. R. Sharma" /><//><${Field} label="Title"><input value=${c.ti} onInput=${upC('ti')} placeholder="e.g. Senior Network Engineer" /><//></div>
        <${Field} label="Summary for the client"><textarea value=${c.sum} onInput=${upC('sum')} placeholder="Experience, certifications, highlights" /><//>
        <${Field} label="Availability"><input value=${c.av} onInput=${upC('av')} placeholder="e.g. 2 weeks notice, open to onsite" /><//>
        <div><button className="btn" disabled=${busy} onClick=${share}>${busy ? 'Sharing…' : 'Share with client'}</button></div></div>
    </div><//>`;
}
function AdminRequirements() {
  const P = usePortal(); const A = P.admin;
  const [reqs, setReqs] = useState(null); const [tick, setTick] = useState(0); const [open, setOpen] = useState(null); const [tab, setTab] = useState('open');
  useEffect(() => { if (!A.loading) loadReqs(A).then(setReqs).catch(() => setReqs([])); }, [A.loading, A.employers.length, tick]);
  if (A.loading || !reqs) return html`<${Spinner} />`;
  const list = reqs.filter(r => tab === 'all' || (tab === 'open' ? !['filled', 'closed'].includes(r.st || 'open') : ['filled', 'closed'].includes(r.st)));
  const cur = open && reqs.find(r => r.id === open.id && r.m.id === open.mid);
  return html`<div className="stack">
    <div className="toolbar"><div className="tabs" role="tablist" style=${{ marginBottom: 0, border: 0 }}>${[['open', 'Open'], ['done', 'Filled or closed'], ['all', 'All']].map(([k, v]) => html`<button key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}</button>`)}</div>
      <div className="push"><button className="btn ghost" onClick=${() => setTick(tick + 1)}>Refresh</button></div></div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${list.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Requirement</th><th>Client</th><th className="r">Need</th><th>Status</th><th className="r">Candidates</th><th>Posted</th><th /></tr></thead>
        <tbody>${list.map(r => html`<tr key=${r.m.id + r.id} className="click" tabIndex="0" onClick=${() => setOpen({ id: r.id, mid: r.m.id })} onKeyDown=${e => { if (e.key === 'Enter') setOpen({ id: r.id, mid: r.m.id }); }}>
          <td><b style=${{ fontWeight: 600 }}>${r.ti}</b>${r.sk ? html`<div className="muted small">${r.sk}</div>` : ''}</td><td>${r.cl}<div className="muted small">${r.m.u.p.n}</div></td><td className="r num">${r.n || 1}</td>
          <td><${Chip} s=${r.st === 'filled' ? 'ok' : r.st === 'closed' ? '' : r.st === 'shared' ? 'new' : 'amber'}>${REQ_ST[r.st || 'open']}<//></td><td className="r num">${Object.keys(r.cands || {}).length}</td><td className="num muted">${fmtDay(r.at)}</td><td className="r"><button className="btn ghost sm">Open</button></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title=${tab === 'open' ? 'No open requirements' : 'Nothing here yet'}>Client contacts post staffing requirements from their portal. They land here for you to work and share candidates.<//>`}
    </section>
    ${cur && html`<${ReqDetailAdmin} key=${cur.m.id + cur.id} r=${cur} onClose=${() => setOpen(null)} onChanged=${() => setTick(t => t + 1)} />`}
  </div>`;
}

/* ================= Admin: approvals ================= */
function LeaveDecide({ x, s, onClose }) {
  const P = usePortal(); const toast = useToast();
  const [c, setC] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await dbMerge(`r/${x.m.id}`, { lvd: { [x.id]: { s, c: c.trim(), at: Date.now(), by: P.uid } } }); toast(s === 'approved' ? 'Time off approved.' : 'Time off declined.'); onClose(); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  return html`<${Modal} title=${(s === 'approved' ? 'Approve' : 'Decline') + ' time off'} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className=${'btn ' + (s === 'approved' ? 'go' : 'danger')} disabled=${busy} onClick=${go}>${s === 'approved' ? 'Approve' : 'Decline'}</button>`}>
    <p style=${{ marginBottom: 14 }}><b>${x.m.u.p.n}</b>, ${LEAVE_K[x.l.k]}: ${fmtDate(x.l.f)}${x.l.t !== x.l.f ? ' to ' + fmtDate(x.l.t) : ''} (${bizDays(x.l.f, x.l.t)} business days)</p>
    <${Field} label="Note to the consultant (optional)"><textarea value=${c} onInput=${e => setC(e.target.value)} /><//><//>`;
}
function AdminApprovals({ q }) {
  const P = usePortal(); const A = P.admin;
  const [tab, setTab] = useState(q.tab === 'leave' ? 'leave' : q.tab === 'att' ? 'att' : 'ts');
  const [rv, setRv] = useState(null); const [ld, setLd] = useState(null);
  const [cs, setCs] = useState({});
  const pendKey = A.pendTs.map(x => x.m.id + x.w + (x.s.u || '') + ((x.m.r && x.m.r.cid) || '')).join(',');
  useEffect(() => {
    let live = true;
    pMap(A.pendTs.filter(x => x.m.r && x.m.r.cid), 4, x => dbGet(`pub/${x.m.r.cid}/ts/${x.m.id}_${x.w}`).catch(() => null)).then(docs => {
      if (!live) return; const o = {}; A.pendTs.filter(x => x.m.r && x.m.r.cid).forEach((x, i) => { o[x.m.id + x.w] = cdStatus(docs[i]); }); setCs(o);
    });
    return () => { live = false; };
  }, [pendKey]);
  if (A.loading) return html`<${Spinner} />`;
  const curM = rv && A.members.find(m => m.id === rv.mid);
  return html`<div className="stack">
    <div className="tabs" role="tablist">${[['ts', 'Timesheets', A.pendTs.length], ['att', 'Attendance (clock-ins)', null], ['leave', 'Time off', A.pendLv.length], ['done', 'Recently reviewed', null]].map(([k, v, n]) => html`<button key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}${n != null && html`<span className=${'chip' + (n ? ' amber' : '')}>${n}</span>`}</button>`)}</div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${tab === 'ts' && (A.pendTs.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Person</th><th>Week</th><th className="r">Hours</th><th>Client approval</th><th>Attachments</th><th>Submitted</th><th /></tr></thead>
        <tbody>${A.pendTs.map(x => { const k = cs[x.m.id + x.w]; return html`<tr key=${x.m.id + x.w}><td><${Person} uid=${x.m.id} root=${x.m.u} people=${P.people} sub=${x.m.r && x.m.r.cl} /></td><td className="nw">${weekLabel(x.w)}</td><td className="r num"><b>${h1(x.s.t)}</b></td>
          <td>${x.m.r && x.m.r.cid ? (k ? html`<${Chip} s=${k === 'approved' ? 'ok' : k === 'returned' ? 'red' : 'amber'}>${CD_LABEL[k]}<//>` : html`<span className="muted small">…</span>`) : html`<span className="muted small">No client workspace</span>`}</td>
          <td>${x.s.f ? x.s.f : html`<span className=${x.m.r && x.m.r.na ? 'chip red' : 'muted'}>${x.m.r && x.m.r.na ? 'Missing' : 'None'}</span>`}</td><td className="num muted">${fmtTs(x.s.sa)}</td>
          <td className="r"><button className="btn sm" onClick=${() => setRv({ mid: x.m.id, w: x.w })}>Review</button></td></tr>`; })}</tbody></table></div>`
        : html`<${Empty} title="No timesheets waiting">Submitted timesheets appear here, oldest first, with the client's decision alongside.<//>`)}
      ${tab === 'att' && html`<${AttApprovals} />`}
      ${tab === 'leave' && (A.pendLv.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Person</th><th>Type</th><th>Dates</th><th className="r">Days</th><th>Note</th><th /></tr></thead>
        <tbody>${A.pendLv.map(x => html`<tr key=${x.id}><td><${Person} uid=${x.m.id} root=${x.m.u} people=${P.people} /></td><td>${LEAVE_K[x.l.k]}</td><td className="num">${fmtDate(x.l.f)}${x.l.t !== x.l.f ? ' – ' + fmtDate(x.l.t) : ''}</td>
          <td className="r num">${bizDays(x.l.f, x.l.t)}</td><td className="muted">${x.l.r || ''}</td>
          <td className="r"><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}><button className="btn ghost sm" onClick=${() => setLd({ x, s: 'declined' })}>Decline</button><button className="btn go sm" onClick=${() => setLd({ x, s: 'approved' })}>Approve</button></div></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title="No time-off requests waiting" />`)}
      ${tab === 'done' && (A.reviewed.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Person</th><th>Week</th><th className="r">Hours</th><th>Decision</th><th>Reviewed</th><th /></tr></thead>
        <tbody>${A.reviewed.map(x => html`<tr key=${x.m.id + x.w}><td><${Person} uid=${x.m.id} root=${x.m.u} people=${P.people} /></td><td className="nw">${weekLabel(x.w)}</td><td className="r num">${h1(x.s.t)}</td>
          <td><${Chip} s=${x.st}>${TS_LABEL[x.st]}<//></td><td className="num muted">${fmtTs(x.rev.at)}</td><td className="r"><button className="btn ghost sm" onClick=${() => setRv({ mid: x.m.id, w: x.w })}>Open</button></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title="No reviews yet" />`)}
    </section>
    ${curM && html`<${TsReview} m=${curM} w=${rv.w} onClose=${() => setRv(null)} />`}
    ${ld && html`<${LeaveDecide} x=${ld.x} s=${ld.s} onClose=${() => setLd(null)} />`}
  </div>`;
}

/* ================= Admin: team attendance ================= */
function AdminAttendance() {
  const P = usePortal(); const A = P.admin; const toast = useToast();
  const [day, setDay] = useState(dkey());
  const [data, setData] = useState(null); const [tick, setTick] = useState(0); const [busy, setBusy] = useState(false);
  const active = A.members.filter(m => m.st === 'active' && m.role !== 'employer');
  const ids = active.map(m => m.id).join(',');
  useEffect(() => {
    let live = true; setData(null);
    pMap(active, 4, m => dbGet(`u/${m.id}/att/${mkey(day)}`).catch(() => null)).then(docs => { if (live) { const o = {}; active.forEach((m, i) => { o[m.id] = docs[i]; }); setData(o); } });
    return () => { live = false; };
  }, [mkey(day), ids, tick]);
  const now = Date.now();
  const rows = active.map(m => {
    const s = ((((data && data[m.id]) || {}).days || {})[day] || {}).s || []; const c = m.u.clock && m.u.clock.on ? m.u.clock : null;
    return { m, s, first: s.length ? Math.min(...s.map(x => x.i)) : null, last: s.length && s.every(x => x.o) ? Math.max(...s.map(x => x.o)) : null, open: s.some(x => !x.o), total: sessMins(s, c, now), edited: s.some(x => x.e), modes: [...new Set(s.map(x => MODES[x.m]).filter(Boolean))].join(', ') };
  }).sort((a, b) => (b.s.length ? 1 : 0) - (a.s.length ? 1 : 0) || (a.first || 0) - (b.first || 0));
  const exportMonth = async () => {
    setBusy(true);
    try {
      const mk = mkey(day); const docs = await pMap(active, 4, m => dbGet(`u/${m.id}/att/${mk}`).catch(() => null));
      const out = [['Name', 'Email', 'Client', 'Date', 'Clock in', 'Clock out', 'Hours', 'Location', 'Edited', 'Note']];
      active.forEach((m, i) => Object.keys((docs[i] && docs[i].days) || {}).sort().forEach(d => (docs[i].days[d].s || []).forEach(x => out.push([m.u.p.n, m.u.p.e, (m.r && m.r.cl) || '', d, fmtTime(x.i), x.o ? fmtTime(x.o) : '', x.o ? hrs(mins(x.i, x.o)) : '', MODES[x.m] || '', x.e ? 'Yes' : '', x.n || '']))));
      if (out.length === 1) throw { message: `No attendance recorded in ${monthLabel(mk)}.` };
      await saveDownload(`team-attendance-${mk}.csv`, toCSV(out));
    } catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); }
    setBusy(false);
  };
  return html`<div className="stack">
    <div className="toolbar">
      <div className="wknav"><button className="btn ghost icon" aria-label="Previous day" onClick=${() => setDay(addDays(day, -1))}><${Icon} n="left" /></button>
        <input type="date" value=${day} max=${dkey()} onInput=${e => e.target.value && setDay(e.target.value)} style=${{ width: 170 }} aria-label="Day" />
        <button className="btn ghost icon" aria-label="Next day" disabled=${day >= dkey()} onClick=${() => setDay(addDays(day, 1))}><${Icon} n="right" /></button></div>
      ${day !== dkey() && html`<button className="btn ghost sm" onClick=${() => setDay(dkey())}>Today</button>`}
      <div className="push"><button className="btn ghost" onClick=${() => setTick(tick + 1)}>Refresh</button><button className="btn ghost" disabled=${busy || !active.length} onClick=${exportMonth}><${Icon} n="down" />${busy ? 'Preparing…' : 'Export ' + monthLabel(mkey(day))}</button></div>
    </div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${!active.length ? html`<${Empty} title="No active consultants yet">Approve people under Team to see their attendance.<//>` : !data ? html`<${Spinner} />` : html`<div className="tblwrap"><table className="tbl">
        <thead><tr><th>Person</th><th>First in</th><th>Last out</th><th>Location</th><th className="r">Hours</th><th>Status</th></tr></thead>
        <tbody>${rows.map(r => html`<tr key=${r.m.id}><td><${Person} uid=${r.m.id} root=${r.m.u} people=${P.people} sub=${r.m.r && r.m.r.cl} /></td>
          <td className="num">${r.first ? fmtTime(r.first) : '—'}</td><td className="num">${r.last ? fmtTime(r.last) : '—'}</td><td>${r.modes || '—'}</td>
          <td className="r num">${r.s.length ? hm(r.total) : '—'}</td>
          <td>${r.open ? html`<${Chip} s="ok">Working<//>` : r.s.length ? html`<${Chip}>Done<//>` : html`<span className="muted small">No record</span>`}${r.edited ? html` <span className="chip amber">Edited</span>` : ''}</td></tr>`)}</tbody></table></div>`}
    </section>
  </div>`;
}

/* ================= Admin: tasks ================= */
function NewTask({ onClose }) {
  const P = usePortal(); const A = P.admin; const toast = useToast();
  const active = A.members.filter(m => m.st === 'active' && m.role !== 'employer');
  const [f, setF] = useState({ ti: '', d: '', due: '', p: 'normal' });
  const [who, setWho] = useState([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const create = async () => {
    if (!f.ti.trim()) { setErr('Give the task a title.'); return; }
    if (!who.length) { setErr('Choose at least one person.'); return; }
    setErr(''); setBusy(true);
    try {
      const id = nid(); const t = { ti: f.ti.trim(), d: f.d.trim(), due: f.due, p: f.p, at: Date.now(), by: P.uid };
      for (const uid of who) await dbMerge(`r/${uid}`, { tasks: { [id]: t } });
      toast(`Task assigned to ${who.length} ${who.length === 1 ? 'person' : 'people'}.`); onClose();
    } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  return html`<${Modal} title="New task" onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy} onClick=${create}>${busy ? 'Assigning…' : 'Assign task'}</button>`}>
    <div className="form">
      <${Field} label="Title"><input value=${f.ti} onInput=${up('ti')} placeholder="e.g. Upload your updated COI" /><//>
      <${Field} label="Details"><textarea value=${f.d} onInput=${up('d')} /><//>
      <div className="row2"><${Field} label="Due date"><input type="date" value=${f.due} onInput=${up('due')} /><//>
        <${Field} label="Priority"><select value=${f.p} onChange=${up('p')}><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select><//></div>
      <div><div className="ph-row" style=${{ marginBottom: 6 }}><span className="lbl">Assign to</span>${active.length > 1 && html`<button type="button" className="btn link small" onClick=${() => setWho(who.length === active.length ? [] : active.map(m => m.id))}>${who.length === active.length ? 'Clear' : 'Select everyone'}</button>`}</div>
        ${active.length ? html`<div style=${{ display: 'grid', gap: 8, maxHeight: 220, overflow: 'auto' }}>${active.map(m => html`<label key=${m.id} className="check"><input type="checkbox" checked=${who.includes(m.id)} onChange=${e => setWho(e.target.checked ? [...who, m.id] : who.filter(x => x !== m.id))} /><span>${m.u.p.n}${m.r && m.r.cl ? html` <span className="muted small">${m.r.cl}</span>` : ''}</span></label>`)}</div>`
          : html`<p className="muted small">Approve team members first, then assign them tasks.</p>`}</div>
      ${err && html`<p className="err" role="alert">${err}</p>`}
    </div><//>`;
}
function AdminTasks() {
  const P = usePortal(); const A = P.admin; const toast = useToast();
  const [tab, setTab] = useState('open'); const [nw, setNw] = useState(false);
  if (A.loading) return html`<${Spinner} />`;
  const all = [];
  A.members.forEach(m => Object.entries((m.r && m.r.tasks) || {}).forEach(([id, t]) => { if (!t.x) all.push({ id, t, m, pr: (m.u.tp || {})[id] || {} }); }));
  all.sort((a, b) => (a.t.due || '9999').localeCompare(b.t.due || '9999'));
  const list = all.filter(x => tab === 'all' || (tab === 'done' ? x.pr.s === 'done' : x.pr.s !== 'done'));
  const archive = async x => { try { await dbMerge(`r/${x.m.id}`, { tasks: { [x.id]: { x: 1 } } }); toast('Task archived.'); } catch (e) { toast(errText(e), true); } };
  return html`<div className="stack">
    <div className="toolbar"><div className="tabs" role="tablist" style=${{ marginBottom: 0, border: 0 }}>${[['open', 'Open'], ['done', 'Done'], ['all', 'All']].map(([k, v]) => html`<button key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}</button>`)}</div>
      <div className="push"><button className="btn" onClick=${() => setNw(true)}><${Icon} n="plus" />New task</button></div></div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${list.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Task</th><th>Assignee</th><th>Due</th><th>Priority</th><th>Progress</th><th /></tr></thead>
        <tbody>${list.map(x => html`<tr key=${x.m.id + x.id}><td><b style=${{ fontWeight: 600 }}>${x.t.ti}</b>${x.pr.n ? html`<div className="muted small">${x.pr.n}</div>` : ''}</td>
          <td><${Person} uid=${x.m.id} root=${x.m.u} people=${P.people} /></td>
          <td className=${'num' + (x.t.due && x.t.due < dkey() && x.pr.s !== 'done' ? ' err' : '')}>${x.t.due ? fmtDate(x.t.due) : '—'}</td>
          <td><span className=${'prio ' + x.t.p}>${x.t.p === 'high' ? 'High' : x.t.p === 'low' ? 'Low' : 'Normal'}</span></td>
          <td><${Chip} s=${x.pr.s || 'todo'}>${TASK_S[x.pr.s || 'todo']}<//></td>
          <td className="r"><button className="btn ghost sm" onClick=${() => archive(x)}>Archive</button></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title=${tab === 'done' ? 'No completed tasks' : 'No tasks yet'} action=${tab !== 'done' && html`<button className="btn" onClick=${() => setNw(true)}>Assign a task</button>`}>Assign onboarding steps, document requests or project to-dos to one person or the whole team.<//>`}
    </section>
    ${nw && html`<${NewTask} onClose=${() => setNw(false)} />`}
  </div>`;
}

/* ================= Admin: reports ================= */
function AdminReports() {
  const P = usePortal(); const A = P.admin; const toast = useToast();
  const [from, setFrom] = useState(addDays(weekStart(), -21)); const [to, setTo] = useState(weekStart());
  const [busy, setBusy] = useState(false);
  if (A.loading) return html`<${Spinner} />`;
  const f = weekStart(from), t = weekStart(to);
  const rows = A.members.filter(m => m.role !== 'employer').map(m => {
    const r = { m, weeks: 0, total: 0, appr: 0, pend: 0, draft: 0 };
    Object.entries(m.u.ts || {}).forEach(([w, s]) => {
      if (w < f || w > t) return; const x = tsStatus(s, ((m.r || {}).rev || {})[w]);
      r.weeks++; r.total += s.t || 0; if (x === 'approved') r.appr += s.t || 0; else if (x === 'pending') r.pend += s.t || 0; else r.draft += s.t || 0;
    });
    return r;
  }).filter(r => r.weeks);
  const tot = rows.reduce((a, r) => ({ total: a.total + r.total, appr: a.appr + r.appr, pend: a.pend + r.pend, draft: a.draft + r.draft }), { total: 0, appr: 0, pend: 0, draft: 0 });
  const fname = `${f}_to_${addDays(t, 6)}`;
  const expSummary = async () => {
    try { await saveDownload(`hours-summary_${fname}.csv`, toCSV([['Name', 'Email', 'Engagement', 'Client', 'End client', 'Weeks', 'Total hours', 'Approved', 'Awaiting approval', 'Draft or returned'],
      ...rows.map(r => [r.m.u.p.n, r.m.u.p.e, (r.m.r || {}).ty || '', (r.m.r || {}).cl || '', (r.m.r || {}).ec || '', r.weeks, h1(r.total), h1(r.appr), h1(r.pend), h1(r.draft)])])); }
    catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); }
  };
  const expLines = async () => {
    setBusy(true);
    try {
      const jobs = []; rows.forEach(r => Object.keys(r.m.u.ts || {}).forEach(w => { if (w >= f && w <= t) jobs.push({ m: r.m, w }); }));
      const docs = await pMap(jobs, 4, j => dbGet(`u/${j.m.id}/ts/${j.w}`).catch(() => null));
      const out = [['Name', 'Engagement', 'Client', 'End client', 'Week of', 'Status', 'Project', 'Task', ...DOW, 'Line total']];
      jobs.forEach((j, i) => { const d = docs[i]; if (!d) return; const x = TS_LABEL[tsStatus(j.m.u.ts[j.w], ((j.m.r || {}).rev || {})[j.w])];
        tsRowsFor(d).forEach(r => out.push([j.m.u.p.n, (j.m.r || {}).ty || '', (j.m.r || {}).cl || '', (j.m.r || {}).ec || '', j.w, x, r.p, r.t, ...r.h.map(v => v || 0), h1(r.h.reduce((a, b) => a + b, 0))])); });
      await saveDownload(`timesheet-lines_${fname}.csv`, toCSV(out));
    } catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); }
    setBusy(false);
  };
  return html`<div className="stack">
    <div className="toolbar">
      <${Field} label="From week of"><input type="date" value=${from} onInput=${e => e.target.value && setFrom(e.target.value)} /><//>
      <${Field} label="To week of"><input type="date" value=${to} onInput=${e => e.target.value && setTo(e.target.value)} /><//>
      <div className="push" style=${{ alignSelf: 'flex-end' }}><button className="btn ghost" disabled=${!rows.length} onClick=${expSummary}><${Icon} n="down" />Summary CSV</button><button className="btn" disabled=${!rows.length || busy} onClick=${expLines}><${Icon} n="down" />${busy ? 'Preparing…' : 'Timesheet lines CSV'}</button></div>
    </div>
    <p className="muted small">Weeks of ${weekLabel(f)} through ${weekLabel(t)}. Use the timesheet lines export for invoicing and payroll.</p>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${rows.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Person</th><th>Client</th><th className="r">Weeks</th><th className="r">Total h</th><th className="r">Approved</th><th className="r">Awaiting</th><th className="r">Draft or returned</th></tr></thead>
        <tbody>${rows.map(r => html`<tr key=${r.m.id}><td><${Person} uid=${r.m.id} root=${r.m.u} people=${P.people} sub=${(r.m.r || {}).ty} /></td><td>${(r.m.r || {}).cl || '—'}</td><td className="r num">${r.weeks}</td>
          <td className="r num"><b>${h1(r.total)}</b></td><td className="r num">${h1(r.appr)}</td><td className="r num">${h1(r.pend)}</td><td className="r num">${h1(r.draft)}</td></tr>`)}
          <tr><td colSpan="3"><b>All people</b></td><td className="r num"><b>${h1(tot.total)}</b></td><td className="r num"><b>${h1(tot.appr)}</b></td><td className="r num"><b>${h1(tot.pend)}</b></td><td className="r num"><b>${h1(tot.draft)}</b></td></tr></tbody></table></div>`
        : html`<${Empty} title="No timesheets in this range">Pick a wider range, or check back after people submit their weeks.<//>`}
    </section>
  </div>`;
}

/* ================= Admin: announcements ================= */
function AdminAnnouncements() {
  const P = usePortal(); const toast = useToast();
  const [f, setF] = useState({ ti: '', b: '', pin: false }); const [busy, setBusy] = useState(false);
  const post = async e => {
    e.preventDefault();
    if (!f.ti.trim() || !f.b.trim()) { toast('Add a title and a message.', true); return; }
    setBusy(true);
    try { await dbSet(`org/main/ann/${nid()}`, { ti: f.ti.trim(), b: f.b.trim(), pin: f.pin, at: Date.now(), by: P.uid }); setF({ ti: '', b: '', pin: false }); toast('Announcement posted to everyone.'); }
    catch (x) { toast(errText(x), true); }
    setBusy(false);
  };
  const del = async a => { try { await dbDel(`org/main/ann/${a.id}`); toast('Announcement deleted.'); } catch (x) { toast(errText(x), true); } };
  const pin = async a => { try { await dbMerge(`org/main/ann/${a.id}`, { pin: !a.pin }); } catch (x) { toast(errText(x), true); } };
  return html`<div className="g2" style=${{ alignItems: 'start' }}>
    <form className="panel form" onSubmit=${post}><h2 className="ph">Post an announcement</h2>
      <${Field} label="Title"><input value=${f.ti} onInput=${e => setF({ ...f, ti: e.target.value })} placeholder="e.g. Thanksgiving office closure" /><//>
      <${Field} label="Message"><textarea value=${f.b} onInput=${e => setF({ ...f, b: e.target.value })} /><//>
      <label className="check"><input type="checkbox" checked=${f.pin} onChange=${e => setF({ ...f, pin: e.target.checked })} /><span>Pin to the top of everyone's dashboard</span></label>
      <div><button className="btn" disabled=${busy}>${busy ? 'Posting…' : 'Post announcement'}</button></div></form>
    <section className="panel"><h2 className="ph" style=${{ marginBottom: 4 }}>Posted</h2>
      ${P.ann.length ? P.ann.map(a => html`<article key=${a.id} className="ann"><div className="ph-row" style=${{ marginBottom: 2 }}><h3>${a.ti}</h3>
          <div className="actions"><button className="btn ghost sm" onClick=${() => pin(a)}>${a.pin ? 'Unpin' : 'Pin'}</button><button className="btn ghost sm icon" aria-label=${'Delete ' + a.ti} onClick=${() => del(a)}><${Icon} n="trash" /></button></div></div>
        <time>${fmtDay(a.at)}${a.pin ? ', pinned' : ''}</time><p>${a.b}</p></article>`)
      : html`<${Empty} title="Nothing posted yet">Announcements show on every team member's dashboard.<//>`}
    </section>
  </div>`;
}

/* ================= Admin: website (inbox + jobs) ================= */
function JobModal({ job, onClose }) {
  const P = usePortal(); const toast = useToast();
  const [f, setF] = useState({ ti: '', loc: '', ty: 'C2C', md: 'Onsite', sk: '', d: '', open: true, ...(job || {}) });
  const [busy, setBusy] = useState(false);
  const up = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    if (!f.ti.trim()) { toast('Add a job title.', true); return; }
    setBusy(true);
    try { const { id, ...rest } = f; await dbSet(`org/site/jobs/${job ? job.id : nid()}`, { ...rest, ti: f.ti.trim(), at: job ? job.at : Date.now(), by: P.uid }); toast(job ? 'Job updated.' : 'Job posted to the Careers page.'); onClose(); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  return html`<${Modal} title=${job ? 'Edit job' : 'Post a job'} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy} onClick=${save}>${job ? 'Save job' : 'Post job'}</button>`}>
    <div className="form">
      <${Field} label="Job title"><input value=${f.ti} onInput=${up('ti')} placeholder="e.g. Senior Network Engineer" /><//>
      <div className="row3"><${Field} label="Location"><input value=${f.loc} onInput=${up('loc')} placeholder="City, state" /><//>
        <${Field} label="Engagement"><select value=${f.ty} onChange=${up('ty')}>${EMP_TYPES.map(t => html`<option key=${t}>${t}</option>`)}</select><//>
        <${Field} label="Work mode"><select value=${f.md} onChange=${up('md')}>${['Onsite', 'Hybrid', 'Remote'].map(t => html`<option key=${t}>${t}</option>`)}</select><//></div>
      <${Field} label="Key skills"><input value=${f.sk} onInput=${up('sk')} placeholder="e.g. Cisco, BGP, Palo Alto" /><//>
      <${Field} label="Description"><textarea value=${f.d} onInput=${up('d')} /><//>
      <label className="check"><input type="checkbox" checked=${f.open} onChange=${up('open')} /><span>Show on the Careers page</span></label>
    </div><//>`;
}
function AdminWebsite({ q }) {
  const P = usePortal(); const A = P.admin; const toast = useToast();
  const [tab, setTab] = useState(q.tab === 'jobs' ? 'jobs' : 'inbox');
  const jobs = useCol('org/site/jobs', 'at:desc');
  const [edit, setEdit] = useState(undefined);
  const toggle = async x => { try { await dbMerge(`inbox/${x.uid}`, { m: { [x.id]: { done: !x.done } } }); } catch (e) { toast(errText(e), true); } };
  const delJob = async j => { try { await dbDel(`org/site/jobs/${j.id}`); toast('Job removed.'); } catch (e) { toast(errText(e), true); } };
  return html`<div className="stack">
    <div className="tabs" role="tablist">${[['inbox', 'Inbox', A.unread], ['jobs', 'Job openings', jobs.docs.filter(j => j.open !== false).length]].map(([k, v, n]) => html`<button key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}<span className=${'chip' + (k === 'inbox' && n ? ' amber' : '')}>${n}</span></button>`)}</div>
    ${tab === 'inbox' && html`<section className="panel">
      <p className="muted small" style=${{ marginBottom: 8 }}>Messages from the Contact page, talent requests from employers, and job applications with resumes.</p>
      ${A.msgs.length ? html`<ul className="list">${A.msgs.map(x => html`<li key=${x.uid + x.id} style=${{ opacity: x.done ? 0.6 : 1 }}>
        <div style=${{ minWidth: 0 }}><div className="actions" style=${{ gap: 8 }}><${Chip} s=${x.k === 'apply' ? 'new' : x.k === 'talent' ? 'ok' : 'amber'}>${x.k === 'apply' ? 'Application' : x.k === 'talent' ? 'Talent request' : 'Inquiry'}<//><span className="t">${x.n}</span><span className="muted small">${fmtTs(x.at)}</span></div>
          <div className="m" style=${{ marginTop: 6 }}><a href=${'mailto:' + x.e}>${x.e}</a>${x.ph ? ', ' + x.ph : ''}${x.co ? ', ' + x.co : ''}${x.sv ? '. Service: ' + x.sv : ''}${x.jt ? '. Role: ' + x.jt : ''}${x.li ? html`. <a href=${x.li} target="_blank" rel="noopener">Profile link</a>` : ''}</div>
          ${x.msg && html`<p style=${{ marginTop: 6, fontSize: 15, whiteSpace: 'pre-wrap' }}>${x.msg}</p>`}
          ${x.fid && html`<div className="actions" style=${{ marginTop: 8 }}><${FileActions} base=${'inbox/' + x.uid} f=${{ id: x.fid, n: 'Resume', ty: '' }} /></div>`}</div>
        <button className="btn ghost sm" onClick=${() => toggle(x)}>${x.done ? 'Mark as new' : 'Mark handled'}</button></li>`)}</ul>`
        : html`<${Empty} title="Inbox is empty">Messages from the Contact and Careers pages land here.<//>`}
    </section>`}
    ${tab === 'jobs' && html`<${Fragment}>
      <div className="toolbar"><p className="muted small">Open jobs appear on the website's Careers page.</p><div className="push"><button className="btn" onClick=${() => setEdit(null)}><${Icon} n="plus" />Post a job</button></div></div>
      <section className="panel" style=${{ padding: '6px 8px' }}>
        ${jobs.loading ? html`<${Spinner} />` : jobs.docs.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Role</th><th>Location</th><th>Engagement</th><th>Status</th><th /></tr></thead>
          <tbody>${jobs.docs.map(j => html`<tr key=${j.id}><td><b style=${{ fontWeight: 600 }}>${j.ti}</b>${j.sk ? html`<div className="muted small">${j.sk}</div>` : ''}${j.src ? html`<div className="muted small">Grabbed from ${j.src.portal ? j.src.portal[0].toUpperCase() + j.src.portal.slice(1) : 'a portal'}${j.src.company ? ', ' + j.src.company : ''}</div>` : ''}</td><td>${j.loc || '—'}${j.md ? html`<div className="muted small">${j.md}</div>` : ''}</td><td>${j.ty}</td>
            <td>${j.open !== false ? html`<${Chip} s="ok">Open<//>` : html`<${Chip}>Closed<//>`}</td>
            <td className="r"><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>${j.open !== false && html`<${ShareButton} job=${j} small=${true} />`}<button className="btn ghost sm" onClick=${() => setEdit(j)}>Edit</button><button className="btn ghost sm icon" aria-label=${'Delete ' + j.ti} onClick=${() => delJob(j)}><${Icon} n="trash" /></button></div></td></tr>`)}</tbody></table></div>`
          : html`<${Empty} title="No jobs posted" action=${html`<button className="btn" onClick=${() => setEdit(null)}>Post your first job</button>`}>Roles you post here show on the Careers page with an Apply button.<//>`}
      </section>
    <//>`}
    ${edit !== undefined && html`<${JobModal} job=${edit} onClose=${() => setEdit(undefined)} />`}
  </div>`;
}

/* ================= Admin: pay plan & payroll ================= */
function ItemsEditor({ items, onChange, label, addLabel }) {
  const set = (i, k, v) => onChange(items.map((x, j) => j === i ? { ...x, [k]: v } : x));
  return html`<div className="stack" style=${{ gap: 8 }}>
    <span className="lbl">${label}</span>
    ${items.map((it, i) => html`<div key=${i} className="row3" style=${{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr) minmax(0,1fr) auto', gap: 8, alignItems: 'end' }}>
      <${Field} label="Name"><input value=${it.n || ''} onInput=${e => set(i, 'n', e.target.value)} placeholder="e.g. HRA, PF, Travel" /><//>
      <${Field} label="Amount"><input type="number" min="0" step="0.01" inputMode="decimal" value=${it.a || ''} onInput=${e => set(i, 'a', e.target.value)} disabled=${!!it.p} /><//>
      <${Field} label="or % of base"><input type="number" min="0" max="100" step="0.01" inputMode="decimal" value=${it.p || ''} onInput=${e => set(i, 'p', e.target.value)} /><//>
      <button type="button" className="btn ghost icon" aria-label="Remove" onClick=${() => onChange(items.filter((_, j) => j !== i))}><${Icon} n="trash" /></button></div>`)}
    <div><button type="button" className="btn ghost sm" onClick=${() => onChange([...items, { n: '', a: '', p: '' }])}><${Icon} n="plus" />${addLabel}</button></div>
  </div>`;
}
function PayForm({ m }) {
  const toast = useToast(); const P = usePortal();
  const conf = m.r && m.r.payConf; const plan = m.r && m.r.pay; const confOk = conf && plan && conf.amt === plan.amt && conf.type === plan.type && conf.cur === plan.cur;
  const confirmNow = async () => { try { await dbMerge(`r/${m.id}`, { payConf: { by: P.uid, byn: (P.prof && P.prof.n) || (Cap.me && Cap.me.name) || 'Admin', at: Date.now(), amt: plan.amt, type: plan.type, cur: plan.cur } }); toast('Salary confirmed.'); } catch (e) { toast(errText(e), true); } };
  const [f, setF] = useState({ ...PAY_DEFAULT, ...((m.r && m.r.pay) || {}) });
  const [busy, setBusy] = useState(false);
  const up = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    if (!(+f.amt > 0)) { toast('Enter the salary or hourly rate.', true); return; }
    setBusy(true);
    try {
      const pay = { cur: f.cur, type: f.type, amt: r2(f.amt), hrs: Math.max(1, +f.hrs || 8), days: f.days, wdm: Math.max(0, parseInt(f.wdm == null ? 20 : f.wdm, 10) || 0), ot: r2(f.ot), lop: !!f.lop, pl: !!f.pl, from: f.from || '',
        allow: (f.allow || []).filter(x => x.n && (+x.a || +x.p)).map(x => ({ n: x.n.trim(), a: r2(x.a), p: r2(x.p) })), ded: (f.ded || []).filter(x => x.n && (+x.a || +x.p)).map(x => ({ n: x.n.trim(), a: r2(x.a), p: r2(x.p) })) };
      await dbMerge(`r/${m.id}`, { pay, payAt: Date.now() }); toast(`Pay plan saved for ${firstName(m.u.p.n)}.`); if (P.roleName === 'admin') await dbMerge(`r/${m.id}`, { payConf: { by: P.uid, byn: (P.prof && P.prof.n) || (Cap.me && Cap.me.name) || 'Admin', at: Date.now(), amt: pay.amt, type: pay.type, cur: pay.cur } });
    } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const monthly = f.type !== 'hourly';
  return html`<div className="form">
      ${plan && +plan.amt ? html`<div className=${'note ' + (confOk ? 'ok' : 'amber')}><span>${confOk ? html`<b>Salary confirmed</b> by ${conf.byn} ${fmtDay(conf.at)}.` : html`<b>Salary not yet confirmed by an administrator.</b> ${conf ? 'The plan changed after the last confirmation.' : ''}`}</span>${P.roleName === 'admin' && !confOk ? html`<div className="actions"><button className="btn go sm" onClick=${confirmNow}>Confirm salary</button></div>` : ''}</div>` : ''}
    <div className="row3"><${Field} label="Pay plan"><select value=${f.type} onChange=${up('type')}><option value="monthly">Monthly salary</option><option value="hourly">Hourly rate</option></select><//>
      <${Field} label="Currency"><select value=${f.cur} onChange=${up('cur')}>${Object.entries(CURRENCIES).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
      <${Field} label=${monthly ? 'Monthly salary' : 'Rate per hour'}><input type="number" min="0" step="0.01" inputMode="decimal" value=${f.amt || ''} onInput=${up('amt')} placeholder=${monthly ? 'e.g. 60000' : 'e.g. 450'} /><//></div>
    <div className="row3"><${Field} label="Standard hours per day" hint="Time beyond this counts as overtime."><input type="number" min="1" max="16" step="0.5" value=${f.hrs} onInput=${up('hrs')} /><//>
      <${Field} label="Working days"><select value=${f.days} onChange=${up('days')}><option value="mon-fri">Monday to Friday</option><option value="mon-sat">Monday to Saturday</option><option value="all">All seven days</option></select><//>
      <${Field} label="Working days per month" hint="Fixed number used for salary ÷ days; 20 is standard."><select value=${String(f.wdm == null ? 20 : f.wdm)} onChange=${up('wdm')}><option value="20">20 days every month (standard)</option><option value="21">21 days</option><option value="22">22 days</option><option value="26">26 days (Mon–Sat)</option><option value="0">Count the calendar working days</option></select><//>
      <${Field} label="Overtime multiplier" hint=${monthly ? '0 means overtime is not paid.' : '0 means overtime is paid at the normal rate.'}><input type="number" min="0" step="0.25" value=${f.ot} onInput=${up('ot')} placeholder="e.g. 1.5" /><//></div>
    ${monthly && html`<div className="row2">
      <label className="check"><input type="checkbox" checked=${!!f.lop} onChange=${up('lop')} /><span>Loss of pay for absent working days (salary ÷ working days × days present)</span></label>
      <label className="check"><input type="checkbox" checked=${!!f.pl} onChange=${up('pl')} /><span>Approved time off counts as paid days</span></label></div>`}
    <${Field} label="Effective from"><input type="date" value=${f.from || ''} onInput=${up('from')} /><//>
    <${ItemsEditor} label="Allowances (added every month)" addLabel="Add allowance" items=${f.allow || []} onChange=${v => setF({ ...f, allow: v })} />
    <${ItemsEditor} label="Deductions (taken every month; % is of gross)" addLabel="Add deduction" items=${f.ded || []} onChange=${v => setF({ ...f, ded: v })} />
    <div className="actions"><button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save pay plan'}</button><span className="muted small">Employees see their earnings computed from clock-ins as soon as this is saved.</span></div>
  </div>`;
}
function PayrollDetail({ row, mk, onClose }) {
  const P = usePortal(); const toast = useToast();
  const [items, setItems] = useState(((row.m.r && row.m.r.payAdj) || {})[mk] || []);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await dbMerge(`r/${row.m.id}`, { payAdj: { [mk]: items.filter(x => x.n && +x.a).map(x => ({ n: x.n.trim(), a: r2(x.a) })) } }); toast('Adjustments saved.'); onClose(); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const c = row.c;
  return html`<${Modal} wide title=${`${row.m.u.p.n}: ${monthLabel(mk)}`} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Close</button><button className="btn" disabled=${busy} onClick=${save}>Save adjustments</button>`}>
    <div className="stack">
      <div className="kpis" style=${{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
        <a><b>${fmtMoney(c.net, c.p.cur)}</b><span>Net pay</span></a><a><b>${c.present} / ${c.workDays}</b><span>Present / working days</span></a><a><b>${hm(c.reg)}</b><span>Regular hours</span></a><a><b>${hm(c.ot)}</b><span>Overtime</span></a></div>
      <${PayBreakdown} c=${c} />
      <div className="panel" style=${{ background: 'var(--surface-2)' }}>
        <h3 className="ph" style=${{ marginBottom: 10 }}>Adjustments for ${monthLabel(mk)}</h3>
        <p className="muted small" style=${{ marginBottom: 10 }}>One-off additions or deductions: a bonus, an advance recovery, a reimbursement. Use a negative amount to deduct.</p>
        <div className="stack" style=${{ gap: 8 }}>${items.map((it, i) => html`<div key=${i} style=${{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) auto', gap: 8, alignItems: 'end' }}>
          <${Field} label="Name"><input value=${it.n || ''} onInput=${e => setItems(items.map((x, j) => j === i ? { ...x, n: e.target.value } : x))} placeholder="e.g. Diwali bonus, Advance recovery" /><//>
          <${Field} label="Amount (+ or −)"><input type="number" step="0.01" inputMode="decimal" value=${it.a || ''} onInput=${e => setItems(items.map((x, j) => j === i ? { ...x, a: e.target.value } : x))} /><//>
          <button type="button" className="btn ghost icon" aria-label="Remove" onClick=${() => setItems(items.filter((_, j) => j !== i))}><${Icon} n="trash" /></button></div>`)}
          <div><button type="button" className="btn ghost sm" onClick=${() => setItems([...items, { n: '', a: '' }])}><${Icon} n="plus" />Add adjustment</button></div></div>
      </div>
    </div><//>`;
}
function AdminPayroll() {
  const P = usePortal(); const A = P.admin; const toast = useToast(); const ps = payStartOf(P.settings); const req = attApprovalOn(P.settings);
  const [mk, setMk] = useState(cycleFor(dkey(), ps)); const cyc = cycleRange(mk, ps);
  const [data, setData] = useState(null); const [tick, setTick] = useState(0); const [open, setOpen] = useState(null);
  const [hol, setHol] = useState(((P.settings || {}).hol || []).join('\n')); const [editHol, setEditHol] = useState(false);
  const [cfg, setCfg] = useState({ payStart: ps, attApproval: req, breakMax: breakMaxOf(P.settings) });
  const saveCfg = async () => { try { await dbMerge('org/main/x/settings', { payStart: Math.max(1, Math.min(28, +cfg.payStart || 1)), attApproval: !!cfg.attApproval, breakMax: Math.max(0, +cfg.breakMax || 0) }); toast('Payroll settings saved.'); } catch (e) { toast(errText(e), true); } };
  const staff = A.members.filter(m => m.role !== 'employer' && m.st === 'active' && m.r && m.r.pay && +m.r.pay.amt > 0);
  const ids = staff.map(m => m.id).join(',');
  useEffect(() => {
    let live = true; setData(null);
    pMap(staff, 4, m => loadCycleAtt(m.id, cyc)).then(docs => { if (live) { const o = {}; staff.forEach((m, i) => { o[m.id] = docs[i]; }); setData(o); } });
    return () => { live = false; };
  }, [mk, ids, tick]);
  const holidays = (P.settings || {}).hol || [];
  const rows = data ? staff.map(m => ({ m, c: computePay(m.r.pay, data[m.id], mk, approvedLeaves(m.u, m.r), holidays, ((m.r.payAdj || {})[mk]) || [], { from: cyc.from, to: cyc.to, approvals: m.r.attA, requireApproval: req, breakMax: breakMaxOf(P.settings) }) })) : [];
  const totals = {}; rows.forEach(r => { totals[r.c.p.cur] = (totals[r.c.p.cur] || 0) + r.c.net; });
  const saveHol = async () => { try { const list = [...new Set(hol.split(/[\s,]+/).map(s => s.trim()).filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s)))].sort(); await dbMerge('org/main/x/settings', { hol: list }); setEditHol(false); toast('Holidays saved.'); } catch (e) { toast(errText(e), true); } };
  const exp = async () => {
    try {
      const out = [['Employee', 'Email', 'Currency', 'Pay plan', 'Rate', 'Working days', 'Present', 'Paid leave', 'Unpaid days', 'Regular hours', 'Overtime hours', 'Base pay', 'Overtime pay', 'Allowances', 'Gross', 'Deductions', 'Adjustments', 'Net pay']];
      rows.forEach(({ m, c }) => out.push([m.u.p.n, m.u.p.e, c.p.cur, c.p.type, r2(c.p.amt).toFixed(2), c.workDays, c.present, c.leaveDays, c.unpaidDays, hrs(c.reg), hrs(c.ot), c.base.toFixed(2), c.otPay.toFixed(2), r2(c.allow.reduce((s, a) => s + a.v, 0)).toFixed(2), c.gross.toFixed(2), c.dedT.toFixed(2), c.adjT.toFixed(2), c.net.toFixed(2)]));
      await saveDownload(`payroll-${mk}.csv`, toCSV(out));
    } catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); }
  };
  const cur = open && rows.find(r => r.m.id === open);
  return html`<div className="stack">
    <div className="toolbar">
      <div className="wknav"><button className="btn ghost icon" aria-label="Previous pay period" onClick=${() => setMk(addMonths(mk, -1))}><${Icon} n="left" /></button><b>${cyc.label}</b>
        <button className="btn ghost icon" aria-label="Next pay period" disabled=${mk >= cycleFor(dkey(), ps)} onClick=${() => setMk(addMonths(mk, 1))}><${Icon} n="right" /></button></div>
      <div className="push"><button className="btn ghost" onClick=${() => setEditHol(v => !v)}>Payroll settings</button><button className="btn ghost" onClick=${() => setTick(t => t + 1)}>Refresh</button><button className="btn" disabled=${!rows.length} onClick=${exp}><${Icon} n="down" />Payroll CSV</button></div>
    </div>
    ${editHol && html`<section className="panel form"><h2 className="ph">Payroll settings</h2>
      <div className="row2"><${Field} label="Pay period starts on day" hint="26 means each period runs from the 26th to the 25th of the next month and is paid as that month. 1 means calendar months."><input type="number" min="1" max="28" value=${cfg.payStart} onInput=${e => setCfg({ ...cfg, payStart: e.target.value })} /><//>
        <${Field} label="Break allowance per day (minutes)" hint="Break time beyond this is unpaid unless an admin approves the extended break."><input type="number" min="0" value=${cfg.breakMax} onInput=${e => setCfg({ ...cfg, breakMax: e.target.value })} /><//></div>
      <label className="check"><input type="checkbox" checked=${!!cfg.attApproval} onChange=${e => setCfg({ ...cfg, attApproval: e.target.checked })} /><span>Clock-ins need admin approval before they count as paid days (Approvals › Attendance)</span></label>
      <div className="actions"><button className="btn" onClick=${saveCfg}>Save settings</button></div>
      <h2 className="ph" style=${{ marginTop: 10 }}>Company holidays</h2><p className="muted small">One date per line (YYYY-MM-DD). Holidays are paid days and don't count as working days.</p>
      <textarea value=${hol} onInput=${e => setHol(e.target.value)} placeholder="2026-10-02\n2026-11-11" style=${{ minHeight: 120, maxWidth: 360, fontVariantNumeric: 'tabular-nums' }} />
      <div className="actions"><button className="btn" onClick=${saveHol}>Save holidays</button><button className="btn ghost" onClick=${() => setEditHol(false)}>Close</button></div></section>`}
    ${Object.keys(totals).length > 0 && html`<div className="kpis" style=${{ gridTemplateColumns: `repeat(${Object.keys(totals).length + 1},minmax(0,1fr))` }}>
      ${Object.entries(totals).map(([k, v]) => html`<a key=${k}><b>${fmtMoney(v, k)}</b><span>Total net pay (${k})</span></a>`)}<a><b>${rows.length}</b><span>People on payroll</span></a></div>`}
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${!staff.length ? html`<${Empty} title="No pay plans yet">Open a team member under Team and set their salary or hourly rate on the Pay tab. Their earnings are then computed from clock-ins.<//>`
        : !data ? html`<${Spinner} />` : html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Employee</th><th>Plan</th><th className="r">Present</th><th className="r">Hours</th><th className="r">OT</th><th className="r">Gross</th><th className="r">Deductions</th><th className="r">Net pay</th><th /></tr></thead>
        <tbody>${rows.map(({ m, c }) => html`<tr key=${m.id} className="click" tabIndex="0" onClick=${() => setOpen(m.id)} onKeyDown=${e => { if (e.key === 'Enter') setOpen(m.id); }}>
          <td><${Person} uid=${m.id} root=${m.u} people=${P.people} sub=${m.r.cl} /></td><td className="muted small">${payLabel(c.p)}</td>
          <td className="r num">${c.present}/${c.workDays}${c.leaveDays ? html`<div className="muted small">+${c.leaveDays} leave</div>` : ''}</td><td className="r num">${hm(c.reg)}</td><td className="r num">${c.ot ? hm(c.ot) : '—'}</td>
          <td className="r num">${fmtMoney(c.gross, c.p.cur)}</td><td className="r num">${c.dedT ? '− ' + fmtMoney(c.dedT, c.p.cur) : '—'}${c.adjT ? html`<div className="muted small">${c.adjT > 0 ? '+' : '−'} ${fmtMoney(Math.abs(c.adjT), c.p.cur)} adj.</div>` : ''}</td>
          <td className="r num"><b>${fmtMoney(c.net, c.p.cur)}</b></td><td className="r"><button className="btn ghost sm">Details</button></td></tr>`)}</tbody></table></div>`}
    </section>
    <p className="muted small">Figures come from completed clock-in sessions in this month. Monthly plans with loss of pay use salary ÷ working days × days present; approved time off and company holidays count as paid.</p>
    ${cur && html`<${PayrollDetail} key=${cur.m.id + mk} row=${cur} mk=${mk} onClose=${() => { setOpen(null); setTick(t => t + 1); }} />`}
  </div>`;
}

/* ---- Tax profile (per employee, used by payroll runs) ---- */
function TaxProfileForm({ m }) {
  const toast = useToast(); const [f, setF] = useState({ ...TAX_PROFILE_DEFAULT, ...((m.r && m.r.tax) || {}) }); const [busy, setBusy] = useState(false);
  const up = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => { setBusy(true); try { await dbMerge(`r/${m.id}`, { tax: { ...f, extra: r2(f.extra), state: r2(f.state), ded: r2(f.ded), basicPct: f.basicPct === '' ? '' : r2(f.basicPct), pt: f.pt === '' ? '' : r2(f.pt) } }); toast('Tax details saved.'); } catch (e) { toast(errText(e), true); } setBusy(false); };
  return html`<div className="form">
    <div className="row2"><${Field} label="Payroll country"><select value=${f.country} onChange=${up('country')}><option value="US">United States (W2)</option><option value="IN">India</option></select><//><${Field} label="Payment method"><select value=${f.method} onChange=${up('method')}>${['Direct deposit', 'Check', 'Bank transfer (NEFT/IMPS)', 'UPI'].map(x => html`<option key=${x}>${x}</option>`)}</select><//></div>
    ${f.country === 'US' ? html`<${Fragment}>
      <div className="row3"><${Field} label="Filing status (W-4)"><select value=${f.filing} onChange=${up('filing')}><option value="single">Single or married filing separately</option><option value="married">Married filing jointly</option><option value="head">Head of household</option></select><//><${Field} label="Extra withholding per pay (W-4 line 4c)"><input type="number" step="0.01" value=${f.extra} onInput=${up('extra')} /><//><label className="check" style=${{ alignSelf: 'end', paddingBottom: 12 }}><input type="checkbox" checked=${!!f.fica} onChange=${up('fica')} /><span>Withhold Social Security and Medicare (untick for FICA-exempt, e.g. F-1 OPT)</span></label></div>
      <div className="row2"><${Field} label="State income tax withholding %" hint="Effective rate from your CPA; 0 for no-tax states."><input type="number" step="0.01" value=${f.state} onInput=${up('state')} /><//><${Field} label="State name"><input value=${f.stateName} onInput=${up('stateName')} placeholder="e.g. NJ" /><//></div><//>`
    : html`<${Fragment}>
      <div className="row3"><${Field} label="Tax regime"><select value=${f.regime} onChange=${up('regime')}><option value="new">New regime</option><option value="old">Old regime</option></select><//>${f.regime === 'old' && html`<${Field} label="Annual deductions (80C, 80D, HRA exemption)"><input type="number" step="1" value=${f.ded} onInput=${up('ded')} /><//>`}<label className="check" style=${{ alignSelf: 'end', paddingBottom: 12 }}><input type="checkbox" checked=${!!f.pf} onChange=${up('pf')} /><span>EPF applies</span></label></div>
      <div className="row2"><${Field} label="Basic as % of gross" hint="Blank uses the default from Tax settings."><input type="number" step="1" value=${f.basicPct} onInput=${up('basicPct')} /><//><${Field} label="Professional tax per month" hint="Blank uses the default; set by state (e.g. 200)."><input type="number" step="1" value=${f.pt} onInput=${up('pt')} /><//></div><//>`}
    <div className="actions"><button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save tax details'}</button><span className="muted small">Used by Accounting › Payroll runs to compute withholdings on each paystub.</span></div>
  </div>`;
}

/* ================= Sign-in activity ================= */
function SignIns() {
  const P = usePortal(); const A = P.admin; const toast = useToast();
  const logs = useCol('log', 'seen:desc'); const [q, setQ] = useState(''); const [range, setRange] = useState('all'); const [open, setOpen] = useState(null); const [hist, setHist] = useState(null);
  const now = Date.now(); const since = range === 'today' ? new Date(dkey()).getTime() - new Date().getTimezoneOffset() * 60000 : range === '7d' ? now - 7 * 86400000 : range === '30d' ? now - 30 * 86400000 : 0;
  const byId = {}; A.members.forEach(m => { byId[m.id] = m; });
  const ql = q.trim().toLowerCase();
  const rows = logs.docs.filter(d => d.last && d.last.t >= since && (!ql || [d.name, d.email, d.last.ip, geoLabel(d.last)].join(' ').toLowerCase().includes(ql))).sort((a, b) => (b.seen || b.last.t) - (a.seen || a.last.t));
  const isOnline = d => d.seen && now - d.seen < 10 * 60000;
  useEffect(() => { if (!open) { setHist(null); return; } let live = true; dbList(`log/${open}/items`).then(l => { if (live) setHist(l.sort((a, b) => b.t - a.t)); }).catch(() => setHist([])); return () => { live = false; }; }, [open]);
  const exp = async () => { try { await saveDownload('sign-ins.csv', toCSV([['Name', 'Email', 'Role', 'Last sign-in', 'Online', 'Network address', 'Approximate location', 'Precise location', 'Device', 'Sign-ins'], ...rows.map(d => [d.name, d.email, roleOf(d), new Date(d.last.t).toISOString(), isOnline(d) ? 'yes' : 'no', d.last.ip, geoLabel(d.last), d.last.pos ? `${d.last.pos.lat}, ${d.last.pos.lng} (±${d.last.pos.acc} m)` : '', uaSummary(d.last.ua), d.n])])); } catch (e) { if (!e || e.code !== 'declined') toast(errText(e), true); } };
  const roleOf = d => { const m = byId[d.id]; return m ? (m.role === 'employer' ? 'Client contact' : m.r && m.r.cl ? `Employee, ${m.r.cl}` : 'Employee') : d.role === 'admin' ? 'Admin' : d.role === 'hr' ? 'HR' : d.role === 'acct' ? 'Accounting' : 'Account'; };
  const cur = open && logs.docs.find(d => d.id === open);
  const Loc = ({ r }) => html`<span>${geoLabel(r) || html`<span className="muted">Unknown</span>`}</span>`;
  const Exact = ({ r }) => r.pos ? html`<a href=${mapLink(r.pos)} target="_blank" rel="noopener">${r.pos.lat}, ${r.pos.lng}</a><div className="muted small">±${r.pos.acc} m · map</div>` : html`<span className="muted small">Not shared${r.posErr ? ' (' + (POS_ERR[r.posErr] || r.posErr) + ')' : ''}</span>`;
  return html`<div className="stack">
    <div className="kpis" style=${{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}><a><b>${logs.docs.filter(isOnline).length}</b><span>Signed in now (active in the last 10 minutes)</span></a><a><b>${logs.docs.filter(d => d.last && d.last.t >= now - 86400000).length}</b><span>Signed in within 24 hours</span></a><a><b>${logs.docs.reduce((a, d) => a + (+d.n || 0), 0)}</b><span>Sign-ins recorded</span></a></div>
    <div className="toolbar"><div className="seg" style=${{ marginBottom: 0 }}>${[['all', 'All'], ['today', 'Today'], ['7d', '7 days'], ['30d', '30 days']].map(([k, v]) => html`<button key=${k} className=${range === k ? 'on' : ''} onClick=${() => setRange(k)}>${v}</button>`)}</div>
      <input type="search" style=${{ maxWidth: 260 }} placeholder="Search name, email, address, city" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search sign-ins" /><div className="push"><button className="btn ghost" onClick=${exp}><${Icon} n="down" />CSV</button></div></div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${logs.loading ? html`<${Spinner} />` : rows.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Person</th><th>Status</th><th>Last sign-in</th><th>City (from address)</th><th>Exact location</th><th>Network address</th><th>Device</th><th className="r">Sign-ins</th></tr></thead>
        <tbody>${rows.map(d => { const m = byId[d.id]; return html`<tr key=${d.id} className="click" tabIndex="0" onClick=${() => setOpen(d.id)} onKeyDown=${e => { if (e.key === 'Enter') setOpen(d.id); }}>
          <td>${m ? html`<${Person} uid=${m.id} root=${m.u} people=${P.people} sub=${roleOf(d)} />` : html`<b style=${{ fontWeight: 600 }}>${d.name}</b><div className="muted small">${d.email}, ${roleOf(d)}</div>`}</td>
          <td>${isOnline(d) ? html`<${Chip} s="ok">Online<//>` : html`<span className="muted small">Last seen ${fmtTs(d.seen || d.last.t)}</span>`}</td>
          <td className="num nw">${fmtTs(d.last.t)}</td><td><${Loc} r=${d.last} /></td><td><${Exact} r=${d.last} /></td><td className="num small">${d.last.ip}</td><td className="small">${uaSummary(d.last.ua)}</td><td className="r num">${d.n}</td></tr>`; })}</tbody></table></div>`
        : html`<${Empty} title="No sign-ins yet">Every portal sign-in is recorded here with its time, network address, approximate location and device. Precise location appears when the person allows location sharing in their browser.<//>`}
    </section>
    ${cur && html`<${Modal} wide title=${`Sign-in history: ${cur.name}`} onClose=${() => setOpen(null)} foot=${html`<button className="btn" onClick=${() => setOpen(null)}>Close</button>`}>
      ${hist === null ? html`<${Spinner} />` : hist.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>When</th><th>Event</th><th>City (from address)</th><th>Exact location</th><th>Network address</th><th>Device</th></tr></thead>
        <tbody>${hist.slice(0, 200).map(r => html`<tr key=${r.id}><td className="num nw">${fmtTs(r.t)}</td><td>${r.how === 'punch' ? (EV_LABEL[r.ev] || r.ev) : (EV_LABEL[r.how] || 'Signed in')}</td><td><${Loc} r=${r} /></td><td><${Exact} r=${r} /></td><td className="num small">${r.ip}${r.geo && r.geo.isp ? html`<div className="muted small">${r.geo.isp}</div>` : ''}</td><td className="small">${uaSummary(r.ua)}<div className="muted small" style=${{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title=${r.ua}>${r.ua}</div></td></tr>`)}</tbody></table></div>` : html`<${Empty} title="No history" />`}
      <p className="muted small" style=${{ marginTop: 10 }}>Sign-ins, sign-outs, clock-ins, clock-outs and breaks are listed with the network address and the city it resolves to (VPNs and mobile carriers can place it elsewhere). Exact location is recorded when the person allows location sharing in their browser.</p><//>`}
  </div>`;
}

/* ================= Attendance approvals (clock-ins and clock-outs) ================= */
function AttApprovals() {
  const P = usePortal(); const A = P.admin; const toast = useToast(); const ps = payStartOf(P.settings); const req = attApprovalOn(P.settings);
  const [mk, setMk] = useState(cycleFor(dkey(), ps)); const cyc = cycleRange(mk, ps);
  const [data, setData] = useState(null); const [tick, setTick] = useState(0); const [show, setShow] = useState('pending');
  const staff = A.members.filter(m => m.role !== 'employer' && m.st === 'active'); const ids = staff.map(m => m.id).join(',');
  useEffect(() => { let live = true; setData(null); pMap(staff, 4, m => loadCycleAtt(m.id, cyc)).then(docs => { if (live) { const o = {}; staff.forEach((m, i) => { o[m.id] = docs[i]; }); setData(o); } }); return () => { live = false; }; }, [mk, ids, tick]);
  if (!req) return html`<div className="note info"><span>Attendance approval is switched off, so clock-ins count as soon as they are recorded. Turn it on under Pay plans › Payroll settings.</span></div>`;
  if (A.loading || !data) return html`<${Spinner} label="Loading clock-ins…" />`;
  const rows = [];
  const allow = breakMaxOf(P.settings);
  staff.forEach(m => { const days = (data[m.id] && data[m.id].days) || {}; Object.keys(days).sort().forEach(k => { if (k < cyc.from || k > cyc.to) return; const d = days[k]; const a = (m.r.attA || {})[k]; const extOk = a && a.bx === 'approved'; const mins = dayMins(d, allow, extOk); const open = (d.s || []).some(x => !x.o); if (!grossDayMins(d) && !open) return; const st = attStatus(k, m.r.attA, mins, true); const bm = breakMins(d); const over = excessBreak(d, allow); if (show === 'pending' ? (st === 'approved' || st === 'rejected') && !(over && !extOk && !(a && a.bx === 'unpaid')) : show === 'rejected' ? st !== 'rejected' : false) return; rows.push({ m, k, d, mins, open, st, a, bm, over, extOk }); }); });
  const decide = async (r, s, note, bx) => { try { const cur = r.a || {}; const extOk = bx === 'approved' || (bx == null && r.extOk); await dbMerge(`r/${r.m.id}`, { attA: { [r.k]: { s, m: dayMins(r.d, allow, extOk), by: P.uid, at: Date.now(), n: note || '', bx: bx || cur.bx || (r.over ? 'unpaid' : null) } } }); } catch (e) { toast(errText(e), true); throw e; } };
  const approveAll = async (uid) => { const list = rows.filter(r => (r.st === 'pending' || r.st === 'changed') && !r.open && (!uid || r.m.id === uid)); if (!list.length) return; const byUser = {}; list.forEach(r => { (byUser[r.m.id] = byUser[r.m.id] || {})[r.k] = { s: 'approved', m: r.mins, by: P.uid, at: Date.now(), n: '' }; }); try { for (const [id, attA] of Object.entries(byUser)) await dbMerge(`r/${id}`, { attA }); toast(`${list.length} day${list.length === 1 ? '' : 's'} approved.`); } catch (e) { toast(errText(e), true); } };
  const pendingCount = rows.filter(r => r.st === 'pending' || r.st === 'changed').length;
  return html`<div className="stack" style=${{ marginTop: 12 }}>
    <div className="toolbar"><div className="wknav"><button className="btn ghost icon" aria-label="Previous pay period" onClick=${() => setMk(addMonths(mk, -1))}><${Icon} n="left" /></button><b>${cyc.label}</b><button className="btn ghost icon" aria-label="Next pay period" disabled=${mk >= cycleFor(dkey(), ps)} onClick=${() => setMk(addMonths(mk, 1))}><${Icon} n="right" /></button></div>
      <div className="seg" style=${{ marginBottom: 0 }}>${[['pending', 'To approve'], ['rejected', 'Rejected'], ['all', 'All days']].map(([k, v]) => html`<button key=${k} className=${show === k ? 'on' : ''} onClick=${() => setShow(k)}>${v}</button>`)}</div>
      <div className="push"><button className="btn ghost" onClick=${() => setTick(t => t + 1)}>Refresh</button><button className="btn go" disabled=${!pendingCount} onClick=${() => approveAll()}>Approve all (${pendingCount})</button></div></div>
    ${rows.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Person</th><th>Date</th><th>Clock in → out</th><th className="r">Hours</th><th>Status</th><th /></tr></thead>
      <tbody>${rows.map(r => html`<tr key=${r.m.id + r.k}><td><${Person} uid=${r.m.id} root=${r.m.u} people=${P.people} sub=${(r.m.r && r.m.r.cl) || r.m.u.p.ti} /></td><td className="num nw">${fmtDate(r.k, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
        <td className="small">${(r.d.s || []).map((x, i) => html`<div key=${i}>${fmtTime(x.i)} → ${x.o ? fmtTime(x.o) : html`<span className="muted">still in</span>`}${x.m ? ' · ' + (MODES[x.m] || x.m) : ''}${x.e ? html` <${Chip} s="amber">Manual entry<//>` : ''}${x.n ? html`<div className="muted">${x.n}</div>` : ''}<${PunchLoc} m=${x.li} label="in" /><${PunchLoc} m=${x.lo} label="out" /></div>`)}
          ${(r.d.b || []).length > 0 && html`<div style=${{ marginTop: 4 }}><b>Breaks:</b> ${(r.d.b || []).map((x, i) => html`<span key=${i}>${i ? ', ' : ''}${fmtTime(x.i)}–${x.o ? fmtTime(x.o) : 'now'}</span>`)} (${hm(r.bm)})${r.over ? html` <${Chip} s=${r.extOk ? 'ok' : 'amber'}>${hm(r.over)} over allowance${r.extOk ? ', approved' : (r.a && r.a.bx === 'unpaid') ? ', unpaid' : ''}<//>` : ''}${(r.d.b || []).map((x, i) => html`<${PunchLoc} key=${'b' + i} m=${x.li} label=${'break ' + (i + 1) + ' start'} />`)}</div>`}</td>
        <td className="r num">${hm(r.mins)}</td><td><${Chip} s=${r.st === 'approved' ? 'ok' : r.st === 'rejected' ? 'red' : 'amber'}>${ATT_ST[r.st]}<//>${r.a && r.a.n ? html`<div className="muted small">${r.a.n}</div>` : ''}</td>
        <td className="r"><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>${r.open ? html`<span className="muted small">Waiting for clock-out</span>` : html`${r.over && !r.extOk && html`<button className="btn sm" onClick=${() => decide(r, 'approved', '', 'approved').then(() => toast('Day and extended break approved (paid).'))}>Approve with extra break</button>`}${(r.st !== 'approved' || (r.over && !r.extOk && !(r.a && r.a.bx === 'unpaid'))) && html`<button className="btn go sm" onClick=${() => decide(r, 'approved', '', r.over && !r.extOk ? 'unpaid' : null).then(() => toast(r.over && !r.extOk ? 'Approved; the extra break time is unpaid.' : 'Approved.'))}>${r.over && !r.extOk ? 'Approve (extra break unpaid)' : 'Approve'}</button>`}${r.st !== 'rejected' && html`<button className="btn ghost sm" onClick=${() => { const n = prompt('Why is this day rejected? (shown to the employee)'); if (n === null) return; decide(r, 'rejected', n).then(() => toast('Rejected.')); }}>Reject</button>`}`}</div></td></tr>`)}</tbody></table></div>`
      : html`<${Empty} title=${show === 'pending' ? 'Nothing to approve' : 'No days here'}>Each day an employee clocks in and out appears here. Approved days count toward their pay for the ${cyc.short} period; days edited after approval come back for review.<//>`}
  </div>`;
}

const PunchLoc = ({ m, label }) => !m ? null : html`<div className="muted small">${label}: ${m.g || (m.ip ? 'address ' + m.ip : 'no location')}${m.ip && m.g ? ` · ${m.ip}` : ''}${m.pos ? html` · <a href=${mapLink(m.pos)} target="_blank" rel="noopener">exact ${m.pos.lat}, ${m.pos.lng} (±${m.pos.acc} m)</a>` : html` · exact location ${POS_ERR[m.posErr || ''] || 'not shared'}`}</div>`;
