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

function JobRow({ j, onState, onPublish, busy }) {
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
        ${onPublish && (j.published ? html`<a className="btn ghost sm" href=${'#/careers/g' + j.id} target="_blank" rel="noopener"><${Icon} n="check" />On Careers</a><${SendJobButton} jobId=${'g' + j.id} small=${true} /><button className="btn ghost sm" type="button" disabled=${busy} onClick=${() => onPublish(j, false)}>Remove</button>` : html`<button className="btn sm" type="button" disabled=${busy} onClick=${() => onPublish(j, true)}><${Icon} n="mega" />Publish to Careers</button>`)}
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
  const sentToMe = useCol(P.prof ? `u/${P.uid}/jobs` : null, 'at:desc');
  const me = useJobsApi('jobs_me');
  const m = useJobsApi('jobs_matches&state=' + tab);
  if (!P.prof) return html`<${NeedProfile} />`;
  const sentPanel = html`<${SentToMe} docs=${sentToMe.docs} loading=${sentToMe.loading} />`;
  if (tab === 'sent') return html`<div className="stack"><${JobsTabs} tab=${tab} setTab=${setTab} counts=${{ sent: sentToMe.docs.length }} />${sentPanel}</div>`;
  if (me.error) return html`<div className="stack"><${JobsOffline} error=${me.error} />${sentToMe.docs.length ? html`<${JobsTabs} tab="sent" setTab=${setTab} counts=${{ sent: sentToMe.docs.length }} />${sentPanel}` : ''}</div>`;
  if (!me.data) return html`<${Spinner} label="Checking your matches…" />`;
  const c = me.data.consultant;
  if (!c || !c.has_resume) return html`<div className="stack">${sentToMe.docs.length ? html`<${JobsTabs} tab="sent" setTab=${setTab} counts=${{ sent: sentToMe.docs.length }} />${sentPanel}` : ''}<div className="panel"><${Empty} title="Upload your resume to see matched jobs" action=${html`<a className="btn" href="#/portal/resume">Upload resume</a>`}>
    Jobs from Dice, LinkedIn, Indeed and Monster are collected every few hours and ranked against the skills, titles and location in your resume.<//></div></div>`;
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
      <a href="#/portal/jobs" onClick=${e => { e.preventDefault(); setTab('sent'); }}><b>${sentToMe.docs.length}</b><span>Sent to you by StratEdge</span></a>
    </div>
    <div className="note info"><span>Matched from your resume <b>${c.resume_name}</b>${c.profile && c.profile.titles && c.profile.titles.length ? ` as ${c.profile.titles.slice(0, 2).join(' / ')}` : ''}${c.profile && c.profile.location ? ` near ${c.profile.location}` : ''}. ${last ? `Last job collection ${fmtTs(last.finished_at || last.started_at)}${last.jobs_new ? `, ${last.jobs_new} new jobs` : ''}.` : 'The first job collection has not run yet.'}</span>
      <div className="actions"><a className="btn ghost sm" href="#/portal/resume">Edit resume & preferences</a><button className="btn ghost sm" type="button" disabled=${busy} onClick=${refresh}><${Icon} n="refresh" />Refresh matches</button></div></div>
    <${JobsTabs} tab=${tab} setTab=${setTab} counts=${{ ...counts, sent: sentToMe.docs.length }} />
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
  if (!f) return html`<${Spinner} label="Loading your resume profile…" />`;
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
  const [tab, setTab] = useState('grab');
  const ov = useJobsApi('jobs_admin&op=overview');
  if (ov.error) return html`<div className="stack"><${JobsOffline} error=${ov.error} /><${JobServerHelp} /></div>`;
  if (!ov.data) return html`<${Spinner} label="Connecting to the job server…" />`;
  const o = ov.data; const last = o.last_run;
  return html`<div className="stack">
    <div className="kpis">
      <a href="#/portal/admin/jobs" onClick=${e => { e.preventDefault(); setTab('accounts'); }}><b>${o.accounts.filter(a => a.enabled).length}</b><span>Portal logins in use</span></a>
      <a href="#/portal/admin/jobs" onClick=${e => { e.preventDefault(); setTab('jobs'); }}><b>${o.jobs}</b><span>Jobs collected (${o.jobs_7d} this week)</span></a>
      <a href="#/portal/admin/jobs" onClick=${e => { e.preventDefault(); setTab('consultants'); }}><b>${o.consultants_with_resume}</b><span>Consultants with a resume</span></a>
      <a href="#/portal/admin/jobs" onClick=${e => { e.preventDefault(); setTab('runs'); }}><b>${o.running ? 'Running' : last ? ({ done: 'OK', done_with_errors: 'Errors', failed: 'Failed' }[last.status] || last.status) : '—'}</b><span>${last ? 'Last run ' + fmtTs(last.finished_at || last.started_at) : 'No run yet'}</span></a>
      <a href="#/portal/admin/jobs" onClick=${e => { e.preventDefault(); setTab('runs'); }}><b>${o.schedule_minutes ? 'Every ' + (o.schedule_minutes >= 60 ? Math.round(o.schedule_minutes / 60) + 'h' : o.schedule_minutes + 'm') : 'Manual'}</b><span>${o.next_run_at ? 'Next ' + fmtTs(o.next_run_at) : 'Schedule'}</span></a>
    </div>
    <div className="tabs" role="tablist">${[['grab', 'Job grabber'], ['accounts', 'Portal logins'], ['runs', 'Scrape runs'], ['jobs', 'Collected jobs'], ['consultants', 'Consultant matches']].map(([k, v]) => html`<button key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}</button>`)}</div>
    ${tab === 'grab' && html`<${JobGrabber} o=${o} reload=${ov.reload} />`}
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

function usePublish(reload) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const publish = async (j, on) => {
    setBusy(true);
    try { await api('jobs_admin', on ? { op: 'publish', job_id: j.id } : { op: 'unpublish', job_id: j.id }); toast(on ? 'Posted on the Careers page. Share it from there.' : 'Removed from the Careers page.'); reload && reload(); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  return { publish, busy };
}

function CollectedJobs({ o }) {
  const [q, setQ] = useState(''); const [portal, setPortal] = useState(''); const [qq, setQq] = useState('');
  useEffect(() => { const t = setTimeout(() => setQq(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  const r = useJobsApi('jobs_admin&op=jobs&q=' + encodeURIComponent(qq) + '&portal=' + encodeURIComponent(portal));
  const pub = usePublish(r.reload);
  return html`<${Fragment}>
    <div className="toolbar"><input style=${{ maxWidth: 340 }} type="search" placeholder="Search title, company, location or text" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search jobs" />
      <select value=${portal} onChange=${e => setPortal(e.target.value)} aria-label="Portal" style=${{ maxWidth: 180 }}><option value="">All portals</option>${(o.portals || []).map(p => html`<option key=${p.key} value=${p.key}>${p.name}</option>`)}</select>
      <span className="muted small">${r.data ? `${r.data.total} job${r.data.total === 1 ? '' : 's'}` : ''}</span></div>
    ${r.error ? html`<${JobsOffline} error=${r.error} />` : r.loading && !r.data ? html`<${Spinner} />` : r.data.jobs.length ? html`<div className="matches">${r.data.jobs.map(j => html`<${JobRow} key=${j.id} j=${j} onPublish=${pub.publish} busy=${pub.busy} />`)}</div>`
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

/* ---------- staff: Job grabber (log in through each portal, grab jobs by keyword, publish to Careers) ---------- */
const GRAB_DAYS = [[1, 'Past 24 hours'], [3, 'Past 3 days'], [7, 'Past week'], [14, 'Past 2 weeks'], [30, 'Past month']];
function JobGrabber({ o, reload }) {
  const toast = useToast();
  const st = useJobsApi('jobs_admin&op=status');
  const portals = (st.data && st.data.portals) || [];
  const [f, setF] = useState({ keywords: '', location: '', remote: 'any', posted_days: 7, portals: null });
  const [runId, setRunId] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = useJobsApi(runId ? 'jobs_admin&op=runs&limit=8' : 'jobs_admin&op=overview');
  const cur = runId && run.data && run.data.runs ? run.data.runs.find(x => x.id === runId) : null;
  const running = (st.data && st.data.running) || (cur && cur.status === 'running');
  const jobs = useJobsApi(cur && cur.status !== 'running' ? 'jobs_admin&op=run_jobs&id=' + runId : 'jobs_admin&op=overview');
  const pub = usePublish(jobs.reload);
  const loginBusy = portals.some(p => p.accounts.some(a => ['running', 'needs_code'].includes(a.login.state)));
  useEffect(() => { if (!running && !loginBusy) return; const t = setInterval(() => { st.reload(); if (runId) run.reload(); }, 3000); return () => clearInterval(t); }, [running, loginBusy, runId]);
  useEffect(() => { if (cur && cur.status !== 'running') { jobs.reload(); reload(); } }, [cur && cur.status]);
  const sel = f.portals || Object.fromEntries(portals.map(p => [p.key, true]));
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const grab = async e => {
    e.preventDefault();
    const kws = f.keywords.split(/[,\n;]/).map(x => x.trim()).filter(Boolean);
    if (!kws.length) { toast('Type at least one job title or keyword.', true); return; }
    const chosen = portals.filter(p => sel[p.key]).map(p => p.key);
    if (!chosen.length) { toast('Pick at least one portal.', true); return; }
    setBusy(true);
    try { const r = await api('jobs_admin', { op: 'grab', keywords: kws, location: f.location, remote: f.remote, posted_days: +f.posted_days, portals: chosen }); setRunId(r.run.id); toast('Grabbing jobs… results appear below as each portal answers.'); st.reload(); }
    catch (x) { toast(errText(x), true); }
    setBusy(false);
  };
  if (st.error) return html`<${JobsOffline} error=${st.error} />`;
  if (st.loading && !st.data) return html`<${Spinner} label="Checking portal logins…" />`;
  return html`<${Fragment}>
    <p className="muted small">Log in through each portal with the StratEdge account (the browser runs on the server; if the site emails a verification code you type it here), then grab jobs by title or keyword. Grabbed jobs are matched to every consultant's resume and can be published to the Careers page with one click.</p>
    <div className="portals-grid">${portals.map(p => html`<${PortalLoginCard} key=${p.key} p=${p} reload=${st.reload} />`)}</div>
    <form className="panel form" onSubmit=${grab}>
      <h2 className="ph">Grab jobs</h2>
      <${Field} label="Job titles or keywords" hint="Comma-separated. Each one is searched on every selected portal."><input value=${f.keywords} onInput=${up('keywords')} placeholder="e.g. SAP FICO Consultant, ServiceNow Developer, Epic Analyst" /><//>
      <div className="row3"><${Field} label="Location"><input value=${f.location} onInput=${up('location')} placeholder="City, state (empty = United States)" /><//>
        <${Field} label="Posted"><select value=${f.posted_days} onChange=${up('posted_days')}>${GRAB_DAYS.map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
        <${Field} label="Work mode"><select value=${f.remote} onChange=${up('remote')}>${REMOTE_OPTS.map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//></div>
      <div className="fld"><span>Portals</span><div className="meta" style=${{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>${portals.map(p => html`<label key=${p.key} className=${'pillbtn' + (sel[p.key] ? ' on' : '')}><input type="checkbox" hidden checked=${!!sel[p.key]} onChange=${() => setF({ ...f, portals: { ...sel, [p.key]: !sel[p.key] } })} />${p.name}${p.logged_in ? ' (logged in)' : p.needs_account ? '' : ' (public search)'}</label>`)}</div></div>
      <div className="actions"><button className="btn" disabled=${busy || running || loginBusy}><${Icon} n="search" />${running ? 'Grabbing…' : 'Grab jobs'}</button>${loginBusy && html`<span className="muted small">Finish the portal login first.</span>`}</div>
    </form>
    ${cur && html`<section className="panel stack" style=${{ gap: 10 }}>
      <div className="ph-row"><h2 className="ph">${cur.status === 'running' ? 'Grabbing jobs…' : `Grabbed ${cur.jobs_found} job${cur.jobs_found === 1 ? '' : 's'}, ${cur.jobs_new} new`}</h2><span className="muted small">${(cur.search || []).map(q => q.q).join(', ')}${cur.search && cur.search[0] ? ' in ' + cur.search[0].location : ''}</span></div>
      ${cur.status === 'running' && html`<${Spinner} label="Searching the portals. This takes a minute or two per portal." />`}
      ${cur.errors.length ? html`<div className="note amber"><span>${cur.errors.map((e, i) => html`<div key=${i}><b>${portalName(e.portal) || 'Run'}:</b> ${e.error}</div>`)}</span></div>` : ''}
      <details><summary className="muted small">Run log</summary><pre className="small" style=${{ whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto' }}>${cur.log || '…'}</pre></details>
      ${cur.status !== 'running' && (jobs.data && jobs.data.jobs ? (jobs.data.jobs.length ? html`<div className="matches">${jobs.data.jobs.map(j => html`<${JobRow} key=${j.id} j=${j} onPublish=${pub.publish} busy=${pub.busy} />`)}</div>` : html`<${Empty} title="Nothing new from this grab">Every job found was already collected earlier. Look under Collected jobs.<//>`) : html`<${Spinner} />`)}
    </section>`}
  <//>`;
}

function PortalLoginCard({ p, reload }) {
  const toast = useToast();
  const acct = p.accounts[0] || null;
  const login = acct ? acct.login : { state: 'idle', message: '' };
  const [form, setForm] = useState(false);
  const [f, setF] = useState({ username: '', password: '' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const call = async (body, okMsg) => { setBusy(true); try { const r = await api('jobs_admin', body); okMsg && toast(okMsg); reload(); return r; } catch (e) { toast(errText(e), true); } finally { setBusy(false); } };
  const start = async () => {
    if (!acct) {
      if (!f.username.trim() || !f.password) { toast('Enter the email and password for the ' + p.name + ' account.', true); return; }
      const r = await call({ op: 'account_add', portal: p.key, label: '', username: f.username, password: f.password, enabled: true });
      if (!r) return;
      setForm(false); setF({ username: '', password: '' });
      await call({ op: 'login_start', id: r.account.id }, 'Signing in to ' + p.name + ' on the server…');
    } else await call({ op: 'login_start', id: acct.id }, 'Signing in to ' + p.name + ' on the server…');
  };
  const sendCode = async e => { e.preventDefault(); if (!code.trim()) return; await call({ op: 'login_code', id: acct.id, code: code.trim() }, 'Code sent. Checking…'); setCode(''); };
  const logout = async () => { if (!confirm(`Log out of ${p.name} on the server? The saved session is removed; the login details stay.`)) return; await call({ op: 'logout', id: acct.id }, 'Logged out of ' + p.name + '.'); };
  const chip = login.state === 'running' ? html`<${Chip} s="new">Signing in…<//>` : login.state === 'needs_code' ? html`<${Chip} s="amber">Code needed<//>` : acct && acct.status === 'ok' && acct.enabled ? html`<${Chip} s="ok">Logged in<//>` : acct && acct.status === 'error' ? html`<${Chip} s="red">Login failed<//>` : acct ? html`<${Chip} s="amber">Not logged in<//>` : p.needs_account ? html`<${Chip}>No account<//>` : html`<${Chip}>Public search<//>`;
  return html`<div className="panel stack portal-card" style=${{ gap: 8 }}>
    <div className="ph-row"><h3 className="ph">${p.name}</h3>${chip}</div>
    <p className="muted small" style=${{ margin: 0 }}>${acct ? html`${acct.username}${acct.last_login_at ? html`<br />Last sign-in ${fmtTs(acct.last_login_at)}` : ''}` : p.notes}</p>
    ${login.state === 'running' && html`<p className="small"><span className="spin" style=${{ marginRight: 8, verticalAlign: 'middle' }} />${login.message}</p>`}
    ${login.state === 'needs_code' && html`<form className="form" onSubmit=${sendCode} style=${{ gap: 8 }}><p className="small" style=${{ margin: 0 }}>${login.message}</p>
      <div style=${{ display: 'flex', gap: 8 }}><input value=${code} onInput=${e => setCode(e.target.value)} placeholder="Verification code" inputMode="numeric" autoComplete="one-time-code" style=${{ maxWidth: 180 }} /><button className="btn sm" disabled=${busy}>Submit code</button></div></form>`}
    ${login.state === 'error' && html`<p className="err small" style=${{ margin: 0 }}>${login.message.length > 260 ? login.message.slice(0, 260) + '…' : login.message}</p>`}
    ${login.state === 'ok' && html`<p className="small" style=${{ margin: 0, color: 'var(--teal-ink)' }}>${login.message}</p>`}
    ${acct && acct.status === 'error' && login.state === 'idle' && acct.last_error && html`<p className="err small" style=${{ margin: 0 }}>${acct.last_error.length > 260 ? acct.last_error.slice(0, 260) + '…' : acct.last_error}</p>`}
    ${form && !acct && html`<div className="form" style=${{ gap: 8 }}><input value=${f.username} onInput=${e => setF({ ...f, username: e.target.value })} placeholder=${'Email or username on ' + p.name} autoComplete="off" /><input type="password" value=${f.password} onInput=${e => setF({ ...f, password: e.target.value })} placeholder="Password" autoComplete="new-password" /></div>`}
    <div className="actions">
      ${!acct ? (form ? html`<button className="btn sm" disabled=${busy} onClick=${start}>Save and log in</button><button className="btn ghost sm" onClick=${() => setForm(false)}>Cancel</button>` : html`<button className="btn sm" onClick=${() => setForm(true)}><${Icon} n="user" />Log in to ${p.name}</button>`)
        : login.state === 'running' || login.state === 'needs_code' ? html`<button className="btn ghost sm" disabled=${busy} onClick=${logout}>Cancel</button>`
        : html`<button className=${'btn sm' + (acct.status === 'ok' ? ' ghost' : '')} disabled=${busy} onClick=${start}>${acct.status === 'ok' ? 'Log in again' : 'Log in to ' + p.name}</button>${acct.status === 'ok' && html`<button className="btn ghost sm" disabled=${busy} onClick=${logout}>Log out</button>`}`}
    </div>
  </div>`;
}

/* ---------- consultant: jobs StratEdge sent directly ---------- */
const JobsTabs = ({ tab, setTab, counts }) => html`<div className="tabs" role="tablist">${[...Object.entries(MATCH_STATES), ['sent', 'Sent to you']].map(([k, v]) => html`<button key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}<span className=${'chip' + (k === 'sent' && counts.sent ? ' amber' : '')}>${counts[k] || 0}</span></button>`)}</div>`;
function SentToMe({ docs, loading }) {
  if (loading) return html`<${Spinner} />`;
  if (!docs.length) return html`<div className="panel"><${Empty} title="Nothing sent to you yet">When a StratEdge recruiter sends you a role, it appears here and in your email.<//></div>`;
  return html`<div className="matches">${docs.map(j => html`<div key=${j.id} className="match">
    <div style=${{ minWidth: 0 }}><h3><a href=${'#/careers/' + j.id}>${j.ti}</a></h3>
      <div className="muted">${[j.loc, j.ty, j.md].filter(Boolean).join(' · ')}</div>
      <div className="reasons">Sent by ${j.byn || 'StratEdge'} ${fmtTs(j.at)}${j.msg ? html`<br /><i>“${j.msg}”</i>` : ''}</div>
      ${j.sk && html`<div className="meta">${j.sk.split(/,\s*/).filter(Boolean).slice(0, 8).map(s => html`<${Chip} key=${s}>${s}<//>`)}</div>`}</div>
    <div className="actions" style=${{ justifyContent: 'flex-end' }}><a className="btn sm" href=${'#/careers/' + j.id}>View and apply</a><${ShareButton} job=${j} small=${true} /></div>
  </div>`)}</div>`;
}

/* ---------- staff: send a Careers job to people by email ---------- */
function SendJobButton({ jobId, job, small, label }) {
  const [open, setOpen] = useState(false);
  return html`<${Fragment}><button type="button" className=${'btn' + (small ? ' sm' : '')} onClick=${() => setOpen(true)}><${Icon} n="send" />${label || 'Send to people'}</button>
    ${open && html`<${SendJobModal} jobId=${jobId || job.id} onClose=${() => setOpen(false)} />`}<//>`;
}
const RECIP_GROUPS = [['portal', 'Portal consultants'], ['rec', 'Recruiting database'], ['ats', 'Candidates (ATS)'], ['other', 'Other emails']];
function SendJobModal({ jobId, onClose }) {
  const P = usePortal(); const toast = useToast();
  const jd = useDoc(`org/site/jobs/${jobId}`);
  const rec = useJobsApi('job_recipients');
  const [grp, setGrp] = useState('portal'); const [q, setQ] = useState('');
  const [picked, setPicked] = useState({}); const [other, setOther] = useState('');
  const [subject, setSubject] = useState(''); const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false); const [done, setDone] = useState(null);
  const job = jd.data;
  useEffect(() => { if (job && !subject) { setSubject(`Job opportunity: ${job.ti} at StratEdge IT Consulting`); setMsg(`We have an opening that looks like a fit for you: ${job.ti}${job.loc ? ' in ' + job.loc : ''}${job.ty ? ' (' + job.ty + ')' : ''}. Take a look and apply if you are interested, or reply to this email with any questions.`); } }, [job]);
  if (jd.loading) return html`<${Modal} title="Send job" onClose=${onClose}><${Spinner} /><//>`;
  if (!job) return html`<${Modal} title="Send job" onClose=${onClose}><p className="muted">This job is no longer on the Careers page.</p><//>`;
  const groups = rec.data || { portal: [], rec: [], ats: [] };
  const key = (g, x) => g + ':' + (x.uid || x.id || x.e);
  const list = (groups[grp] || []).filter(x => { const ql = q.trim().toLowerCase(); return !ql || [x.n, x.e, x.ti, x.loc, x.sk].filter(Boolean).join(' ').toLowerCase().includes(ql); });
  const toggle = (g, x) => setPicked(p => { const k = key(g, x); const n = { ...p }; if (n[k]) delete n[k]; else n[k] = { n: x.n, e: x.e, uid: x.uid || '' }; return n; });
  const allVisible = () => setPicked(p => { const n = { ...p }; list.forEach(x => { n[key(grp, x)] = { n: x.n, e: x.e, uid: x.uid || '' }; }); return n; });
  const extra = other.split(/[,;\s]+/).map(e => e.trim()).filter(e => /^\S+@\S+\.\S+$/.test(e)).map(e => ({ n: '', e }));
  const recipients = [...Object.values(picked), ...extra];
  const send = async () => {
    if (!recipients.length) { toast('Pick at least one person or type an email address.', true); return; }
    setBusy(true);
    try { const r = await api('job_send', { id: jobId, to: recipients, subject, message: msg }); setDone(r); toast(`Sent to ${r.sent} ${r.sent === 1 ? 'person' : 'people'}.`); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const sentLog = (job.sent || []).slice().reverse();
  const foot = done ? html`<button className="btn" onClick=${onClose}>Done</button>` : html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy || !recipients.length} onClick=${send}><${Icon} n="send" />${busy ? 'Sending…' : `Send to ${recipients.length || ''} ${recipients.length === 1 ? 'person' : 'people'}`}</button>`;
  return html`<${Modal} wide title=${'Send: ' + job.ti} onClose=${onClose} foot=${foot}>
    ${done ? html`<div className="stack">
        <div className="note ok"><span><b>Sent to ${done.sent} ${done.sent === 1 ? 'person' : 'people'}.</b> Each email has the job details and a "View and apply" button; replies come to ${P.caps.me.email}. Portal consultants also see it under Matched jobs › Sent to you.</span></div>
        ${done.failed.length ? html`<div className="note red"><span>Could not deliver to: ${done.failed.join(', ')}. Check the outgoing mail settings in api/config.php (storage/mail.log has details).</span></div>` : ''}
      </div>`
      : html`<div className="g2" style=${{ alignItems: 'start' }}>
      <div className="stack" style=${{ gap: 10 }}>
        <div className="tabs" role="tablist" style=${{ marginBottom: 0 }}>${RECIP_GROUPS.map(([k, v]) => html`<button key=${k} role="tab" aria-selected=${grp === k} className=${grp === k ? 'on' : ''} onClick=${() => setGrp(k)}>${v}${k !== 'other' ? html`<span className="chip">${(groups[k] || []).length}</span>` : ''}</button>`)}</div>
        ${grp === 'other' ? html`<${Field} label="Email addresses" hint="Comma- or line-separated. Anyone: vendors, referrals, past candidates."><textarea value=${other} onInput=${e => setOther(e.target.value)} rows="5" placeholder="name@example.com, other@example.com" /><//>`
          : html`<${Fragment}>
            <div className="toolbar" style=${{ margin: 0 }}><input type="search" placeholder="Search name, email, title, skills" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search people" />${list.length > 1 && html`<button className="btn ghost sm" type="button" onClick=${allVisible}>Select all ${list.length}</button>`}</div>
            <div className="picklist">${rec.loading && !rec.data ? html`<${Spinner} />` : list.length ? list.map(x => { const k = key(grp, x); return html`<label key=${k} className=${'pick' + (picked[k] ? ' on' : '')}><input type="checkbox" checked=${!!picked[k]} onChange=${() => toggle(grp, x)} /><span><b>${x.n || x.e}</b><small>${[x.e, x.ti, x.loc, x.st].filter(Boolean).join(' · ')}</small></span></label>`; })
              : html`<p className="muted small" style=${{ padding: 10 }}>${grp === 'portal' ? 'No approved consultants with an email yet.' : grp === 'rec' ? 'No consultants with an email in the recruiting database.' : 'No candidates with an email in the ATS.'}</p>`}</div>
          <//>`}
        ${recipients.length ? html`<div className="meta" style=${{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>${recipients.slice(0, 12).map(r => html`<${Chip} key=${r.e} s="ok">${r.n || r.e}<//>`)}${recipients.length > 12 ? html`<span className="muted small">+${recipients.length - 12} more</span>` : ''}</div>` : ''}
      </div>
      <div className="form">
        <${Field} label="Subject"><input value=${subject} onInput=${e => setSubject(e.target.value)} /><//>
        <${Field} label="Message" hint="The job title, location, engagement, skills, description and a View-and-apply link are added below your message."><textarea value=${msg} onInput=${e => setMsg(e.target.value)} rows="6" /><//>
        <dl className="kv small"><dt>Job</dt><dd>${job.ti}${job.loc ? ', ' + job.loc : ''}</dd><dt>Link</dt><dd><a href=${'#/careers/' + jobId} target="_blank" rel="noopener">${jobLink(jobId)}</a></dd><dt>Replies go to</dt><dd>${P.caps.me.email}</dd></dl>
        ${sentLog.length ? html`<details><summary className="muted small">Sent before (${job.sentN || 0} ${job.sentN === 1 ? 'person' : 'people'})</summary><ul className="list small">${sentLog.slice(0, 8).map((s, i) => html`<li key=${i}><div><div className="t">${s.n} by ${s.byn}, ${fmtTs(s.t)}</div><div className="m">${(s.to || []).join(', ')}</div></div></li>`)}</ul></details>` : ''}
      </div>
    </div>`}
  <//>`;
}
