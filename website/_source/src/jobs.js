/* ================= Jobs: resume matching for consultants, job-portal management for staff =================
   Everything here talks to the Python job server through api/index.php (jobs_* routes). */
const PORTAL_NAMES_UI = { dice: 'Dice', linkedin: 'LinkedIn', indeed: 'Indeed', monster: 'Monster' };
const portalName = k => PORTAL_NAMES_UI[k] || (k ? k[0].toUpperCase() + k.slice(1) : '');
const MATCH_STATES = { new: 'New', saved: 'Saved', applied: 'Applied', dismissed: 'Dismissed' };
const REMOTE_OPTS = [['any', 'Anywhere (remote, hybrid or on-site)'], ['remote', 'Remote only'], ['hybrid', 'Hybrid or remote'], ['onsite', 'On-site near me']];
const JOB_TYPES = ['Contract', 'C2C', 'W2', '1099', 'Contract-to-hire', 'Full-time', 'Part-time'];
const listStr = v => Array.isArray(v) ? v.join(', ') : (v || '');

function useJobsApi(route, deps) {
  const [st, setSt] = useState({ data: null, loading: true, error: null });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true; setSt(s => ({ ...s, loading: true }));
    api(route).then(d => live && setSt({ data: d, loading: false, error: null })).catch(e => live && setSt({ data: null, loading: false, error: e }));
    return () => { live = false; };
  }, [route, n, ...(deps || [])]);
  return { ...st, reload: () => setN(x => x + 1) };
}

function JobsOffline({ error }) {
  const P = usePortal();
  const code = error && error.code;
  return html`<div className=${'note ' + (code === 'jobs_offline' ? 'amber' : 'red')}><span><b>${code === 'jobs_offline' ? 'Job matching is not running right now.' : 'Job matching hit a problem.'}</b> ${error ? error.message : ''}${P.isAdmin ? html` Set <code>jobs_url</code> and <code>jobs_key</code> in api/config.php and start the job server with <code>python -m jobserver</code>.` : ' StratEdge has been notified; your timesheets and other pages work as usual.'}</span></div>`;
}

const ScoreMeter = ({ n }) => html`<span className="score" title=${'Match score ' + n + ' of 100'}><i style=${{ '--w': Math.max(4, n) + '%' }} /><b>${n}</b></span>`;

function JobRow({ j, onState, busy }) {
  const [open, setOpen] = useState(false);
  const chips = [j.portal && portalName(j.portal), j.remote, j.job_type, j.salary].filter(Boolean);
  return html`<div className="match">
    <div style=${{ minWidth: 0 }}>
      <h3><a href=${j.url} target="_blank" rel="noopener noreferrer">${j.title}</a></h3>
      <div className="muted">${[j.company, j.location].filter(Boolean).join(' · ')}${j.posted ? html` <span className="small">· ${j.posted}</span>` : ''}</div>
      <div className="meta">${chips.map(c => html`<${Chip} key=${c}>${c}<//>`)}${j.state && j.state !== 'new' ? html`<${Chip} s=${j.state === 'applied' ? 'ok' : j.state === 'saved' ? 'new' : 'inactive'}>${MATCH_STATES[j.state]}<//>` : ''}</div>
      ${j.reasons && j.reasons.length ? html`<div className="reasons">${j.reasons.join(' · ')}</div>` : ''}
      ${open && html`<div className="prose small" style=${{ marginTop: 10, whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto' }}><${JobDescription} id=${j.id} summary=${j.summary} /></div>`}
    </div>
    <div className="stack" style=${{ gap: 8, alignItems: 'flex-end' }}>
      ${typeof j.score === 'number' && html`<${ScoreMeter} n=${j.score} />`}
      <div className="actions" style=${{ justifyContent: 'flex-end' }}>
        <button className="btn ghost sm" type="button" onClick=${() => setOpen(o => !o)}>${open ? 'Hide' : 'Details'}</button>
        <a className="btn ghost sm" href=${j.url} target="_blank" rel="noopener noreferrer">Open on ${portalName(j.portal)}</a>
        ${onState && html`<${Fragment}>
          ${j.state !== 'saved' && j.state !== 'applied' && html`<button className="btn sm" type="button" disabled=${busy} onClick=${() => onState(j, 'saved')}><${Icon} n="star" />Save</button>`}
          ${j.state !== 'applied' && html`<button className="btn ghost sm" type="button" disabled=${busy} onClick=${() => onState(j, 'applied')}><${Icon} n="check" />Applied</button>`}
          ${j.state !== 'dismissed' ? html`<button className="btn ghost sm icon" type="button" aria-label="Dismiss" title="Not interested" disabled=${busy} onClick=${() => onState(j, 'dismissed')}><${Icon} n="x" /></button>`
            : html`<button className="btn ghost sm" type="button" disabled=${busy} onClick=${() => onState(j, 'new')}>Restore</button>`}
        <//>`}
      </div>
    </div>
  </div>`;
}

function JobDescription({ id, summary }) {
  const r = useJobsApi('jobs_job&id=' + id);
  if (r.loading) return html`<${Spinner} label="Loading the job post…" />`;
  const d = r.data && r.data.job && r.data.job.description;
  return d ? d : (summary || 'No description was captured for this job yet. Open it on the job board for the full post.');
}

/* ---------- consultant: matched jobs ---------- */
function JobsPage() {
  const P = usePortal(); const toast = useToast();
  const [tab, setTab] = useState('new');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const me = useJobsApi('jobs_me');
  const m = useJobsApi('jobs_matches&state=' + tab);
  if (!P.prof) return html`<${NeedProfile} />`;
  if (me.error) return html`<${JobsOffline} error=${me.error} />`;
  if (me.loading || !me.data) return html`<${Spinner} label="Checking your matches…" />`;
  const c = me.data.consultant;
  if (!c || !c.has_resume) return html`<div className="panel"><${Empty} title="Upload your resume to see matched jobs" action=${html`<a className="btn" href="#/portal/resume">Upload resume</a>`}>
    Jobs from Dice, LinkedIn, Indeed and Monster are collected every few hours and ranked against the skills, titles and location in your resume.<//></div>`;
  const setState = async (j, state) => {
    setBusy(true);
    try { await api('jobs_mark', { job_id: j.id, state }); toast(state === 'saved' ? 'Saved. Find it under Saved.' : state === 'applied' ? 'Marked as applied.' : state === 'dismissed' ? 'Dismissed.' : 'Restored.'); m.reload(); me.reload(); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const refresh = async () => { setBusy(true); try { await api('jobs_rematch', {}); toast('Matches refreshed against your latest resume and preferences.'); m.reload(); me.reload(); } catch (e) { toast(errText(e), true); } setBusy(false); };
  const counts = c.match_counts || {};
  const ql = q.trim().toLowerCase();
  const list = ((m.data && m.data.matches) || []).filter(j => !ql || [j.title, j.company, j.location, j.summary].filter(Boolean).join(' ').toLowerCase().includes(ql));
  const last = c.last_run;
  return html`<div className="stack">
    <div className="kpis" style=${{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
      <a href="#/portal/jobs" onClick=${e => { e.preventDefault(); setTab('new'); }}><b>${counts.new || 0}</b><span>New matches</span></a>
      <a href="#/portal/jobs" onClick=${e => { e.preventDefault(); setTab('saved'); }}><b>${counts.saved || 0}</b><span>Saved</span></a>
      <a href="#/portal/jobs" onClick=${e => { e.preventDefault(); setTab('applied'); }}><b>${counts.applied || 0}</b><span>Applied</span></a>
      <a href="#/portal/resume"><b>${(c.profile && c.profile.skills ? c.profile.skills.length : 0)}</b><span>Skills on your resume</span></a>
    </div>
    <div className="note info"><span>Matched from your resume <b>${c.resume_name}</b>${c.profile && c.profile.titles && c.profile.titles.length ? ` as ${c.profile.titles.slice(0, 2).join(' / ')}` : ''}${c.profile && c.profile.location ? ` near ${c.profile.location}` : ''}. ${last ? `Last job collection ${fmtTs(last.finished_at || last.started_at)}${last.jobs_new ? `, ${last.jobs_new} new jobs` : ''}.` : 'The first job collection has not run yet.'}</span>
      <div className="actions"><a className="btn ghost sm" href="#/portal/resume">Edit resume & preferences</a><button className="btn ghost sm" type="button" disabled=${busy} onClick=${refresh}><${Icon} n="refresh" />Refresh matches</button></div></div>
    <div className="tabs" role="tablist">${Object.entries(MATCH_STATES).map(([k, v]) => html`<button key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}<span className="chip">${counts[k] || 0}</span></button>`)}</div>
    <div className="toolbar"><input style=${{ maxWidth: 360 }} type="search" placeholder="Filter by title, company or location" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Filter jobs" /></div>
    ${m.error ? html`<${JobsOffline} error=${m.error} />` : m.loading ? html`<${Spinner} />` : list.length ? html`<div className="matches">${list.map(j => html`<${JobRow} key=${j.id} j=${j} onState=${setState} busy=${busy} />`)}</div>`
      : html`<div className="panel"><${Empty} title=${tab === 'new' ? (ql ? 'No matches for that filter' : 'No new matches yet') : `Nothing under ${MATCH_STATES[tab]}`}>${tab === 'new' && !ql ? 'Jobs are collected every few hours. Add more titles or locations under Resume & preferences to widen the search.' : ''}<//></div>`}
  </div>`;
}

function JobsCard() {
  const r = useJobsApi('jobs_matches&state=new');
  if (r.error || r.loading) return null;
  const list = ((r.data && r.data.matches) || []).slice(0, 3);
  return html`<section className="panel"><div className="ph-row"><h2 className="ph">Matched jobs</h2><a className="btn ghost sm" href="#/portal/jobs">${(r.data && r.data.counts && r.data.counts.new) || 0} new</a></div>
    ${list.length ? html`<ul className="list">${list.map(j => html`<li key=${j.id}><div style=${{ minWidth: 0 }}><div className="t"><a href=${j.url} target="_blank" rel="noopener noreferrer">${j.title}</a></div><div className="m">${[j.company, j.location, portalName(j.portal)].filter(Boolean).join(' · ')}</div></div><${ScoreMeter} n=${j.score} /></li>`)}</ul>`
      : html`<p className="muted small">No new matches yet. <a href="#/portal/resume">Upload or update your resume</a> to get jobs from Dice, LinkedIn, Indeed and Monster.</p>`}</section>`;
}

/* ---------- consultant: resume and preferences ---------- */
function ResumePage() {
  const P = usePortal(); const toast = useToast();
  const me = useJobsApi('jobs_me');
  const [busy, setBusy] = useState(false); const [prog, setProg] = useState(0);
  const [f, setF] = useState(null);
  const c = me.data && me.data.consultant;
  useEffect(() => { if (c && !f) { const p = c.prefs || {}; setF({ titles: listStr(p.titles), locations: listStr(p.locations), remote: p.remote || 'any', job_types: p.job_types || [], skills: listStr(p.skills), keywords: listStr(p.keywords), exclude: listStr(p.exclude) }); } if (me.data && !c && !f) setF({ titles: '', locations: '', remote: 'any', job_types: [], skills: '', keywords: '', exclude: '' }); }, [me.data]);
  if (!P.prof) return html`<${NeedProfile} />`;
  if (me.error) return html`<${JobsOffline} error=${me.error} />`;
  if (me.loading || !f) return html`<${Spinner} label="Loading your resume profile…" />`;
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const onFiles = async fs => {
    const file = fs[0]; const ext = extOf(file.name);
    if (!['pdf', 'docx', 'txt'].includes(ext)) { toast('Upload your resume as PDF, Word (.docx) or plain text.', true); return; }
    if (file.size > MAX_FILE) { toast(`That file is ${sizeLabel(file.size)}. The limit is 10 MB.`, true); return; }
    setBusy(true); setProg(0.05);
    try {
      const fd = new FormData(); fd.append('file', file, file.name);
      const r = await upload('jobs_resume', fd, setProg); Sync.kick();
      toast(`Resume read: ${r.consultant && r.consultant.profile ? r.consultant.profile.skills.length + ' skills found' : 'saved'}${r.matches ? `, ${r.matches} matching jobs` : ''}.`);
      me.reload();
    } catch (e) { toast(errText(e), true); }
    setBusy(false); setProg(0);
  };
  const save = async e => {
    e.preventDefault(); setBusy(true);
    try { await api('jobs_prefs', { prefs: f }); toast('Preferences saved. Matches are being refreshed.'); me.reload(); } catch (x) { toast(errText(x), true); }
    setBusy(false);
  };
  const toggleType = t => setF({ ...f, job_types: f.job_types.includes(t) ? f.job_types.filter(x => x !== t) : [...f.job_types, t] });
  const prof = (c && c.profile) || {};
  return html`<div className="g2" style=${{ alignItems: 'start' }}>
    <div className="stack">
      <section className="panel stack" style=${{ gap: 14 }}>
        <div><h2 className="ph">Your resume</h2><p className="muted small" style=${{ marginTop: 4 }}>${c && c.has_resume ? html`<b>${c.resume_name}</b>, uploaded ${fmtTs(c.resume_at)}. Upload a newer version any time; a copy is kept under Documents.` : 'Upload your current resume. We read the skills, titles and location from it to find matching jobs on Dice, LinkedIn, Indeed and Monster.'}</p></div>
        <${FilePick} busy=${busy} progress=${prog} onFiles=${onFiles} label=${c && c.has_resume ? 'Drop a newer resume here to replace it.' : 'Drop your resume here, or choose it from your device.'} hint="PDF, Word (.docx) or text, up to 10 MB." />
      </section>
      ${c && c.has_resume && html`<section className="panel stack" style=${{ gap: 10 }}><h2 className="ph">What we read from it</h2>
        <dl className="kv">
          <dt>Titles</dt><dd>${(prof.titles || []).join(', ') || '—'}</dd>
          <dt>Experience</dt><dd>${prof.years ? prof.years + ' years' : '—'}${prof.seniority ? ', ' + prof.seniority.toLowerCase() : ''}</dd>
          <dt>Location</dt><dd>${prof.location || '—'}</dd>
          <dt>Skills</dt><dd><div className="meta" style=${{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>${(prof.skills || []).slice(0, 30).map(s => html`<${Chip} key=${s}>${s}<//>`)}${(prof.skills || []).length > 30 ? html`<span className="muted small">+${prof.skills.length - 30} more</span>` : ''}</div></dd>
        </dl>
        <p className="muted small">Not quite right? Add the titles and skills you want to be matched on in the preferences; they take priority over what the resume says.</p></section>`}
    </div>
    <form className="panel form" onSubmit=${save}>
      <h2 className="ph">Job preferences</h2>
      <${Field} label="Titles to search for" hint="Comma-separated, e.g. SAP FICO Consultant, S/4HANA Finance Lead. Leave empty to use the titles from your resume."><input value=${f.titles} onInput=${up('titles')} /><//>
      <${Field} label="Locations" hint="Comma-separated cities or states, e.g. Edison, NJ; Remote. Your profile location is used when empty."><input value=${f.locations} onInput=${up('locations')} /><//>
      <${Field} label="Work mode"><select value=${f.remote} onChange=${up('remote')}>${REMOTE_OPTS.map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
      <div className="fld"><span>Engagement types</span><div className="meta" style=${{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>${JOB_TYPES.map(t => html`<label key=${t} className=${'pillbtn' + (f.job_types.includes(t) ? ' on' : '')}><input type="checkbox" hidden checked=${f.job_types.includes(t)} onChange=${() => toggleType(t)} />${t}</label>`)}</div><small>Leave all unticked to see every type.</small></div>
      <${Field} label="Extra skills" hint="Skills to match on that may be missing from the resume."><input value=${f.skills} onInput=${up('skills')} /><//>
      <${Field} label="Must-have words" hint="Jobs mentioning these rank higher, e.g. implementation, healthcare."><input value=${f.keywords} onInput=${up('keywords')} /><//>
      <${Field} label="Exclude words" hint="Jobs mentioning these are hidden, e.g. clearance, relocation."><input value=${f.exclude} onInput=${up('exclude')} /><//>
      <div className="actions"><button className="btn" disabled=${busy}>${busy ? 'Saving…' : 'Save preferences'}</button><a className="btn ghost" href="#/portal/jobs">See matched jobs</a></div>
    </form>
  </div>`;
}

/* ---------- staff: job portals, accounts, runs, jobs, consultants ---------- */
function JobPortalsAdmin() {
  const toast = useToast();
  const [tab, setTab] = useState('accounts');
  const ov = useJobsApi('jobs_admin&op=overview');
  if (ov.error) return html`<div className="stack"><${JobsOffline} error=${ov.error} /><${JobServerHelp} /></div>`;
  if (ov.loading || !ov.data) return html`<${Spinner} label="Connecting to the job server…" />`;
  const o = ov.data; const last = o.last_run;
  return html`<div className="stack">
    <div className="kpis">
      <a href="#/portal/admin/jobs" onClick=${e => { e.preventDefault(); setTab('accounts'); }}><b>${o.accounts.filter(a => a.enabled).length}</b><span>Portal logins in use</span></a>
      <a href="#/portal/admin/jobs" onClick=${e => { e.preventDefault(); setTab('jobs'); }}><b>${o.jobs}</b><span>Jobs collected (${o.jobs_7d} this week)</span></a>
      <a href="#/portal/admin/jobs" onClick=${e => { e.preventDefault(); setTab('consultants'); }}><b>${o.consultants_with_resume}</b><span>Consultants with a resume</span></a>
      <a href="#/portal/admin/jobs" onClick=${e => { e.preventDefault(); setTab('runs'); }}><b>${o.running ? 'Running' : last ? ({ done: 'OK', done_with_errors: 'Errors', failed: 'Failed' }[last.status] || last.status) : '—'}</b><span>${last ? 'Last run ' + fmtTs(last.finished_at || last.started_at) : 'No run yet'}</span></a>
      <a href="#/portal/admin/jobs" onClick=${e => { e.preventDefault(); setTab('runs'); }}><b>${o.schedule_minutes ? 'Every ' + (o.schedule_minutes >= 60 ? Math.round(o.schedule_minutes / 60) + 'h' : o.schedule_minutes + 'm') : 'Manual'}</b><span>${o.next_run_at ? 'Next ' + fmtTs(o.next_run_at) : 'Schedule'}</span></a>
    </div>
    <div className="tabs" role="tablist">${[['accounts', 'Portal logins'], ['runs', 'Scrape runs'], ['jobs', 'Collected jobs'], ['consultants', 'Consultant matches']].map(([k, v]) => html`<button key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}</button>`)}</div>
    ${tab === 'accounts' && html`<${PortalAccounts} o=${o} reload=${ov.reload} />`}
    ${tab === 'runs' && html`<${ScrapeRuns} o=${o} reload=${ov.reload} />`}
    ${tab === 'jobs' && html`<${CollectedJobs} o=${o} />`}
    ${tab === 'consultants' && html`<${ConsultantMatches} />`}
  </div>`;
}

const JobServerHelp = () => html`<section className="panel stack" style=${{ gap: 8 }}><h2 className="ph">How the job server works</h2>
  <p className="muted small">The job server is the Python service in the repository (<code>python -m jobserver</code>). It keeps the Dice, LinkedIn, Indeed and Monster logins encrypted on the server, signs in with a headless browser, collects jobs for every consultant's titles and locations every few hours, and ranks them against each uploaded resume. The website talks to it through <code>jobs_url</code> and <code>jobs_key</code> in api/config.php (the key must equal <code>JOBSERVER_API_KEY</code> on the server).</p></section>`;

function PortalAccounts({ o, reload }) {
  const toast = useToast();
  const [f, setF] = useState({ portal: 'dice', label: '', username: '', password: '' });
  const [busy, setBusy] = useState(null); const [edit, setEdit] = useState(null);
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const portals = o.portals || [];
  const sel = portals.find(p => p.key === f.portal) || {};
  const add = async e => {
    e.preventDefault(); if (!f.username.trim()) { toast('Enter the email or username for the portal account.', true); return; }
    setBusy('add');
    try { await api('jobs_admin', { op: 'account_add', ...f, enabled: true }); toast(`${portalName(f.portal)} login saved. Click "Test login" to check it.`); setF({ portal: f.portal, label: '', username: '', password: '' }); reload(); } catch (x) { toast(errText(x), true); }
    setBusy(null);
  };
  const test = async a => { setBusy('t' + a.id); try { const r = await api('jobs_admin', { op: 'account_test', id: a.id }); toast(r.ok ? `${portalName(a.portal)}: login works. The session is saved for the next run.` : `${portalName(a.portal)}: ${r.error}`, !r.ok); reload(); } catch (x) { toast(errText(x), true); } setBusy(null); };
  const toggle = async a => { setBusy('e' + a.id); try { await api('jobs_admin', { op: 'account_update', id: a.id, enabled: !a.enabled }); reload(); } catch (x) { toast(errText(x), true); } setBusy(null); };
  const del = async a => { if (!confirm(`Remove the ${portalName(a.portal)} login for ${a.username}?`)) return; setBusy('d' + a.id); try { await api('jobs_admin', { op: 'account_delete', id: a.id }); toast('Login removed.'); reload(); } catch (x) { toast(errText(x), true); } setBusy(null); };
  const stChip = a => a.status === 'ok' ? html`<${Chip} s="ok">Working<//>` : a.status === 'error' ? html`<${Chip} s="red">Error<//>` : html`<${Chip} s="amber">Not tested<//>`;
  return html`<${Fragment}>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${o.accounts.length ? html`<div className="tblwrap"><table className="tbl">
        <thead><tr><th>Portal</th><th>Account</th><th>Status</th><th>Last sign-in</th><th>Used in runs</th><th className="r"><span className="sr">Actions</span></th></tr></thead>
        <tbody>${o.accounts.map(a => html`<tr key=${a.id}>
          <td><b style=${{ fontWeight: 600 }}>${portalName(a.portal)}</b>${a.label ? html`<div className="muted small">${a.label}</div>` : ''}</td>
          <td>${a.username}</td>
          <td>${stChip(a)}${a.last_error ? html`<div className="small muted" style=${{ maxWidth: 320 }}>${a.last_error}</div>` : ''}</td>
          <td className="muted small">${a.last_login_at ? fmtTs(a.last_login_at) : 'Never'}</td>
          <td><label className="check" style=${{ margin: 0 }}><input type="checkbox" checked=${a.enabled} disabled=${busy === 'e' + a.id} onChange=${() => toggle(a)} /><span>${a.enabled ? 'Yes' : 'Paused'}</span></label></td>
          <td className="r"><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
            <button className="btn ghost sm" disabled=${!!busy} onClick=${() => test(a)}>${busy === 't' + a.id ? 'Signing in…' : 'Test login'}</button>
            <button className="btn ghost sm" disabled=${!!busy} onClick=${() => setEdit(a)}>Edit</button>
            <button className="btn ghost sm icon" aria-label="Remove" disabled=${!!busy} onClick=${() => del(a)}><${Icon} n="trash" /></button></div></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title="No portal logins yet">Add the StratEdge Dice, LinkedIn, Indeed or Monster account below. LinkedIn, Indeed and Monster public searches run even without an account; Dice and LinkedIn see more with one.<//>`}
    </section>
    <div className="g2" style=${{ alignItems: 'start' }}>
      <form className="panel form" onSubmit=${add}>
        <h2 className="ph">Add a portal login</h2>
        <div className="row2"><${Field} label="Job portal"><select value=${f.portal} onChange=${up('portal')}>${portals.map(p => html`<option key=${p.key} value=${p.key}>${p.name}</option>`)}</select><//>
          <${Field} label="Label (optional)"><input value=${f.label} onInput=${up('label')} placeholder="e.g. Recruiting team account" /><//></div>
        <div className="row2"><${Field} label="Email or username"><input value=${f.username} onInput=${up('username')} autoComplete="off" /><//>
          <${Field} label="Password"><input type="password" value=${f.password} onInput=${up('password')} autoComplete="new-password" /><//></div>
        ${sel.notes && html`<p className="muted small">${sel.notes}</p>`}
        <p className="muted small">Passwords are encrypted on the job server and never shown again. Use a dedicated StratEdge account for each portal, not a personal one.</p>
        <div><button className="btn" disabled=${busy === 'add'}>${busy === 'add' ? 'Saving…' : 'Save login'}</button></div>
      </form>
      <${JobServerHelp} />
    </div>
    ${edit && html`<${EditAccount} a=${edit} onClose=${() => setEdit(null)} onSaved=${() => { setEdit(null); reload(); }} />`}
  <//>`;
}

function EditAccount({ a, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ label: a.label || '', username: a.username || '', password: '' }); const [busy, setBusy] = useState(false);
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const save = async () => { setBusy(true); try { await api('jobs_admin', { op: 'account_update', id: a.id, ...f }); toast('Login updated.'); onSaved(); } catch (x) { toast(errText(x), true); } setBusy(false); };
  return html`<${Modal} title=${'Edit ' + portalName(a.portal) + ' login'} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy} onClick=${save}>Save</button>`}>
    <div className="form"><${Field} label="Label"><input value=${f.label} onInput=${up('label')} /><//><${Field} label="Email or username"><input value=${f.username} onInput=${up('username')} /><//>
      <${Field} label="New password" hint="Leave empty to keep the current one."><input type="password" value=${f.password} onInput=${up('password')} autoComplete="new-password" /><//></div><//>`;
}

function ScrapeRuns({ o, reload }) {
  const toast = useToast();
  const r = useJobsApi('jobs_admin&op=runs&limit=30');
  const [busy, setBusy] = useState(false); const [log, setLog] = useState(null);
  const running = (r.data && r.data.running) || o.running;
  useEffect(() => { if (!running) return; const t = setInterval(() => { r.reload(); reload(); }, 6000); return () => clearInterval(t); }, [running]);
  const start = async () => { setBusy(true); try { await api('jobs_admin', { op: 'run', portals: [] }); toast('Collection started. Results appear here as the run progresses.'); r.reload(); reload(); } catch (x) { toast(errText(x), true); } setBusy(false); };
  const stChip = s => html`<${Chip} s=${s === 'done' ? 'ok' : s === 'running' ? 'new' : s === 'done_with_errors' ? 'amber' : 'red'}>${{ done: 'Done', running: 'Running', done_with_errors: 'Done with errors', failed: 'Failed', queued: 'Queued' }[s] || s}<//>`;
  return html`<${Fragment}>
    <div className="note info"><span>Each run searches every enabled portal for each consultant's titles and locations, then refreshes everyone's matches. ${o.schedule_minutes ? `Runs happen automatically every ${o.schedule_minutes} minutes.` : 'Automatic runs are off (JOBSERVER_SCRAPE_EVERY_MIN).'}</span>
      <div className="actions"><button className="btn sm" disabled=${busy || running} onClick=${start}><${Icon} n="refresh" />${running ? 'Run in progress…' : 'Collect jobs now'}</button></div></div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${r.loading && !r.data ? html`<${Spinner} />` : r.data && r.data.runs.length ? html`<div className="tblwrap"><table className="tbl">
        <thead><tr><th>Started</th><th>Status</th><th>Started by</th><th className="r">Searches</th><th className="r">Jobs seen</th><th className="r">New</th><th>Problems</th><th className="r"><span className="sr">Log</span></th></tr></thead>
        <tbody>${r.data.runs.map(x => html`<tr key=${x.id}><td>${fmtTs(x.started_at)}${x.finished_at ? html`<div className="muted small">${Math.max(1, Math.round((x.finished_at - x.started_at) / 60000))} min</div>` : ''}</td><td>${stChip(x.status)}</td><td className="muted small">${x.trigger_by}</td>
          <td className="r">${x.queries}</td><td className="r">${x.jobs_found}</td><td className="r">${x.jobs_new}</td><td className="small">${x.errors.length ? x.errors.map((e, i) => html`<div key=${i}>${portalName(e.portal) || 'Run'}: ${e.error}</div>`) : html`<span className="muted">None</span>`}</td>
          <td className="r"><button className="btn ghost sm" onClick=${() => setLog(x)}>Log</button></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title="No runs yet">Click "Collect jobs now" after adding at least one consultant resume.<//>`}
    </section>
    ${log && html`<${Modal} wide title=${'Run ' + fmtTs(log.started_at)} onClose=${() => setLog(null)}><pre className="small" style=${{ whiteSpace: 'pre-wrap', maxHeight: '60vh', overflow: 'auto' }}>${log.log || 'No log lines.'}</pre><//>`}
  <//>`;
}

function CollectedJobs({ o }) {
  const [q, setQ] = useState(''); const [portal, setPortal] = useState(''); const [qq, setQq] = useState('');
  useEffect(() => { const t = setTimeout(() => setQq(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  const r = useJobsApi('jobs_admin&op=jobs&q=' + encodeURIComponent(qq) + '&portal=' + encodeURIComponent(portal));
  return html`<${Fragment}>
    <div className="toolbar"><input style=${{ maxWidth: 340 }} type="search" placeholder="Search title, company, location or text" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search jobs" />
      <select value=${portal} onChange=${e => setPortal(e.target.value)} aria-label="Portal" style=${{ maxWidth: 180 }}><option value="">All portals</option>${(o.portals || []).map(p => html`<option key=${p.key} value=${p.key}>${p.name}</option>`)}</select>
      <span className="muted small">${r.data ? `${r.data.total} job${r.data.total === 1 ? '' : 's'}` : ''}</span></div>
    ${r.error ? html`<${JobsOffline} error=${r.error} />` : r.loading && !r.data ? html`<${Spinner} />` : r.data.jobs.length ? html`<div className="matches">${r.data.jobs.map(j => html`<${JobRow} key=${j.id} j=${j} />`)}</div>`
      : html`<div className="panel"><${Empty} title="No jobs collected yet">Run a collection from the Scrape runs tab once a consultant has uploaded a resume.<//></div>`}
  <//>`;
}

function ConsultantMatches() {
  const P = usePortal();
  const r = useJobsApi('jobs_admin&op=consultants');
  const [open, setOpen] = useState(null);
  const m = useJobsApi(open ? 'jobs_admin&op=matches&uid=' + encodeURIComponent(open.uid) : 'jobs_admin&op=overview');
  if (r.error) return html`<${JobsOffline} error=${r.error} />`;
  if (r.loading && !r.data) return html`<${Spinner} />`;
  const list = r.data.consultants || [];
  const nameOfC = c => c.name || (P.people[c.uid] && P.people[c.uid].name) || c.uid;
  return html`<${Fragment}>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${list.length ? html`<div className="tblwrap"><table className="tbl">
        <thead><tr><th>Consultant</th><th>Resume</th><th>Matched as</th><th>Location</th><th className="r">New</th><th className="r">Saved</th><th className="r">Applied</th><th className="r"><span className="sr">Open</span></th></tr></thead>
        <tbody>${list.map(c => html`<tr key=${c.uid} className="click" tabIndex="0" onClick=${() => setOpen(c)} onKeyDown=${e => { if (e.key === 'Enter') setOpen(c); }}>
          <td><b style=${{ fontWeight: 600 }}>${nameOfC(c)}</b><div className="muted small">${c.email}</div></td>
          <td>${c.has_resume ? html`<${Chip} s="ok">${c.resume_name}<//><div className="muted small">${fmtTs(c.resume_at)}</div>` : html`<${Chip} s="amber">Not uploaded<//>`}</td>
          <td>${(c.profile.titles || []).slice(0, 2).join(', ') || '—'}</td><td>${c.profile.location || '—'}</td>
          <td className="r">${c.match_counts.new || 0}</td><td className="r">${c.match_counts.saved || 0}</td><td className="r">${c.match_counts.applied || 0}</td>
          <td className="r"><button className="btn ghost sm">View</button></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title="No consultants have set up job matching yet">Consultants upload their resume under "Resume & preferences" in the consultant portal.<//>`}
    </section>
    ${open && html`<${Modal} wide title=${'Matches for ' + nameOfC(open)} onClose=${() => setOpen(null)}>
      ${m.loading ? html`<${Spinner} />` : m.error ? html`<${JobsOffline} error=${m.error} />` : (m.data.matches || []).length ? html`<div className="matches">${m.data.matches.map(j => html`<${JobRow} key=${j.id} j=${j} />`)}</div>` : html`<${Empty} title="No matches yet" />`}<//>`}
  <//>`;
}
