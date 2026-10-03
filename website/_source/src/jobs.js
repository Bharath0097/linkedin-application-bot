/* ================= Jobs: resume matching for consultants, job sources and collections for staff =================
   Job matching runs inside the PHP backend (api/jobs.php). Nothing here talks to an outside service directly. */
const MATCH_STATES = { new: 'New', saved: 'Saved', applied: 'Applied', dismissed: 'Dismissed' };
const REMOTE_OPTS = [['any', 'Anywhere (remote, hybrid or on-site)'], ['remote', 'Remote only'], ['hybrid', 'Hybrid or remote'], ['onsite', 'On-site near me']];
const JOB_TYPES = ['Contract', 'C2C', 'W2', '1099', 'Contract-to-hire', 'Full-time', 'Part-time'];
const RUN_STATUS = { done: 'Done', running: 'Running', queued: 'Queued', done_with_errors: 'Done with errors', failed: 'Failed', cancelled: 'Stopped' };
const RUN_KINDS = { all: 'Scheduled collection', grab: 'Job grab', person: 'One consultant' };
const listStr = v => Array.isArray(v) ? v.join(', ') : (v || '');
const runLive = r => !!r && (r.status === 'running' || r.status === 'queued');

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

const JobsOffline = ({ error }) => html`<div className="note red"><span><b>Job matching hit a problem.</b> ${error ? error.message : ''} Your other pages work as usual.</span></div>`;

/* Keeps a collection moving while someone has it on screen: each tick does a few seconds of work on the server. */
function useRunTicker(run, onRun) {
  const id = run && run.id; const live = runLive(run);
  useEffect(() => {
    if (!id || !live) return;
    let on = true;
    (async () => {
      while (on) {
        let r = null;
        try { r = await api('jobs_tick', { id }); } catch (e) { await sleep(3000); continue; }
        if (!on) return;
        onRun(r.run);
        if (!runLive(r.run)) return;
        await sleep(1000);
      }
    })();
    return () => { on = false; };
  }, [id, live]);
}
function RunBanner({ run, setRun, admin, onDone }) {
  useRunTicker(run, r => { setRun(r); if (r && !runLive(r) && onDone) onDone(r); });
  if (!run) return null;
  const p = run.progress || { done: 0, total: 0 }; const pct = p.total ? Math.round(100 * p.done / p.total) : 0;
  if (!runLive(run)) return html`<div className=${'note ' + (run.status === 'done' ? 'ok' : run.status === 'done_with_errors' ? 'amber' : 'red')}><span><b>${RUN_STATUS[run.status] || run.status}.</b> ${run.jobs_found} job${run.jobs_found === 1 ? '' : 's'} found, ${run.jobs_new} new${run.errors && run.errors.length ? html`; ${run.errors.length} source${run.errors.length === 1 ? '' : 's'} had a problem (see Collection runs)` : ''}.</span></div>`;
  return html`<div className="note info"><span style=${{ minWidth: 0, flex: 1 }}><b>${run.status === 'queued' ? 'Waiting for the current collection to finish…' : 'Collecting jobs…'}</b> step ${p.done} of ${p.total}${run.jobs_found ? `, ${run.jobs_found} jobs found (${run.jobs_new} new)` : ''}. Keep this page open; it finishes on its own.
    <i className="prog"><b style=${{ width: pct + '%' }} /></i>${admin && run.log ? html`<pre className="small runlog">${run.log}</pre>` : ''}</span>
    ${admin && html`<div className="actions"><button className="btn ghost sm" type="button" onClick=${async () => { try { const r = await api('jobs_admin', { op: 'stop', id: run.id }); setRun(r.run); } catch (e) { /* shown by the next tick */ } }}>Stop</button></div>`}</div>`;
}

const ScoreMeter = ({ n }) => html`<span className="score" title=${'Match score ' + n + ' of 100'}><i style=${{ '--w': Math.max(4, n) + '%' }} /><b>${n}</b></span>`;

/* Props: onState(j, state) marks a match; onPublish(j, on) for staff; onApply(j[, resume]) for consultants (with `resumes`: exactly one resume
   makes "Apply now" the anchor itself, so the job board opens and the application is logged in one click); onSubmit(j) for staff/bench. */
function JobRow({ j, onState, onPublish, onApply, onSubmit, resumes, busy }) {
  const [open, setOpen] = useState(false);
  const one = onApply && resumes && resumes.length === 1 ? resumes[0] : null;
  const chips = [j.portal, j.remote, j.job_type, j.salary].filter(Boolean);
  const also = (j.also || []).filter(a => a.portal && a.portal !== j.portal).slice(0, 4);
  return html`<div className="match">
    <div style=${{ minWidth: 0 }}>
      <h3><a href=${j.url} target="_blank" rel="noopener noreferrer">${j.title}</a></h3>
      <div className="muted">${[j.company, j.location].filter(Boolean).join(' · ')}${j.posted ? html` <span className="small">· ${j.posted}</span>` : ''}</div>
      <div className="meta">${chips.map(c => html`<${Chip} key=${c}>${c}<//>`)}${j.state && j.state !== 'new' ? html`<${Chip} s=${j.state === 'applied' ? 'ok' : j.state === 'saved' ? 'new' : 'inactive'}>${MATCH_STATES[j.state]}<//>` : ''}${j.source_name && j.source_name !== j.portal ? html`<span className="muted small">via ${j.source_name}</span>` : ''}</div>
      ${also.length ? html`<div className="small muted" style=${{ marginTop: 6 }}>Also on ${also.map((a, i) => html`<${Fragment} key=${a.url}>${i ? ', ' : ''}<a href=${a.url} target="_blank" rel="noopener noreferrer">${a.portal}</a><//>`)}</div>` : ''}
      ${j.reasons && j.reasons.length ? html`<div className="reasons">${j.reasons.join(' · ')}</div>` : ''}
      ${open && html`<div className="prose small" style=${{ marginTop: 10, whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto' }}><${JobDescription} id=${j.id} summary=${j.summary} /></div>`}
    </div>
    <div className="stack" style=${{ gap: 8, alignItems: 'flex-end' }}>
      ${typeof j.score === 'number' && html`<${ScoreMeter} n=${j.score} />`}
      <div className="actions" style=${{ justifyContent: 'flex-end' }}>
        <button className="btn ghost sm" type="button" onClick=${() => setOpen(o => !o)}>${open ? 'Hide' : 'Details'}</button>
        <a className="btn ghost sm" href=${j.url} target="_blank" rel="noopener noreferrer">Open on ${j.portal || 'the job board'}</a>
        ${onPublish && (j.published ? html`<a className="btn ghost sm" href=${'#/careers/g' + j.id} target="_blank" rel="noopener"><${Icon} n="check" />On Careers</a><${SendJobButton} jobId=${'g' + j.id} small=${true} /><button className="btn ghost sm" type="button" disabled=${busy} onClick=${() => onPublish(j, false)}>Remove</button>` : html`<button className="btn sm" type="button" disabled=${busy} onClick=${() => onPublish(j, true)}><${Icon} n="mega" />Publish to Careers</button>`)}
        ${onSubmit && html`<button className="btn sm" type="button" disabled=${busy} onClick=${() => onSubmit(j)}><${Icon} n="send" />Submit consultant</button>`}
        ${onApply && j.state !== 'applied' && (one ? html`<a className="btn sm go" href=${j.url} target="_blank" rel="noopener noreferrer" title=${'Opens the posting and sends your resume ' + (one.label || one.name)} onClick=${() => { onApply(j, one); }}><${Icon} n="send" />Apply now</a>`
          : html`<button className="btn sm go" type="button" disabled=${busy} onClick=${() => onApply(j)}><${Icon} n="send" />Apply now</button>`)}
        ${onState && html`<${Fragment}>
          ${j.state !== 'saved' && j.state !== 'applied' && html`<button className="btn sm" type="button" disabled=${busy} onClick=${() => onState(j, 'saved')}><${Icon} n="star" />Save</button>`}
          ${j.state !== 'applied' && html`<button className="btn ghost sm" type="button" disabled=${busy} onClick=${() => onState(j, 'applied')}><${Icon} n="check" />${onApply ? 'Mark applied' : 'Applied'}</button>`}
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
  return d ? d : (summary || 'No description was captured for this job. Open it on the job board for the full post.');
}

/* ---------- consultant: matched jobs ---------- */
function JobsPage() {
  const P = usePortal(); const toast = useToast();
  const [tab, setTab] = useState('new');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState(null);
  const [applying, setApplying] = useState(null);
  const sentToMe = useCol(P.prof ? `u/${P.uid}/jobs` : null, 'at:desc');
  const me = useJobsApi('jobs_me');
  const m = useJobsApi('jobs_matches&state=' + tab);
  useEffect(() => { if (me.data) setRun(me.data.run || null); }, [me.data]);
  if (!P.prof) return html`<${NeedProfile} />`;
  const sentPanel = html`<${SentToMe} docs=${sentToMe.docs} loading=${sentToMe.loading} />`;
  if (tab === 'sent') return html`<div className="stack"><${JobsTabs} tab=${tab} setTab=${setTab} counts=${{ ...((me.data && me.data.consultant && me.data.consultant.match_counts) || {}), sent: sentToMe.docs.length }} />${sentPanel}</div>`;
  if (me.error) return html`<div className="stack"><${JobsOffline} error=${me.error} />${sentToMe.docs.length ? html`<${JobsTabs} tab="sent" setTab=${setTab} counts=${{ sent: sentToMe.docs.length }} />${sentPanel}` : ''}</div>`;
  if (!me.data) return html`<${Spinner} label="Checking your matches…" />`;
  const c = me.data.consultant;
  const banner = html`<${RunBanner} run=${run} setRun=${setRun} onDone=${() => { m.reload(); me.reload(); }} />`;
  if (!c || (!c.has_resume && !((c.prefs || {}).titles || []).length)) return html`<div className="stack">${sentToMe.docs.length ? html`<${JobsTabs} tab="sent" setTab=${setTab} counts=${{ sent: sentToMe.docs.length }} />${sentPanel}` : ''}<div className="panel"><${Empty} title="Upload your resume to see matched jobs" action=${html`<a className="btn" href="#/portal/resume">Upload resume</a>`}>
    Jobs are collected from job boards every few hours and ranked against the skills, titles and location in your resume. You can also just type the titles you want under Resume & preferences.<//></div></div>`;
  const setState = async (j, state) => {
    setBusy(true);
    try { await api('jobs_mark', { job_id: j.id, state }); toast(state === 'saved' ? 'Saved. Find it under Saved.' : state === 'applied' ? 'Marked as applied.' : state === 'dismissed' ? 'Dismissed.' : 'Restored.'); m.reload(); me.reload(); }
    catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const resumes = c.resumes || [];
  /* One-click apply: the anchor that calls this opens the job board itself, so the request is fired without awaiting (Chrome blocks window.open after an await). */
  const fireApply = (j, resumeId, note) => {
    api('jobs_apply', { job_id: j.id, resume_id: resumeId, note: note || '' })
      .then(r => { toast(`Applied to ${j.title}. Logged under Applications${r.mailed ? ' and your resume was emailed to the contact in the posting' : ''}.`); m.reload(); me.reload(); })
      .catch(e => toast(errText(e), true));
  };
  const onApply = (j, one) => { if (one) fireApply(j, one.id, applyNote((c.prefs || {}).apply_note, j, c, P.prof)); else setApplying(j); };
  const refresh = async () => { setBusy(true); try { const r = await api('jobs_rematch', {}); toast(`Matches refreshed: ${r.matches} job${r.matches === 1 ? '' : 's'} fit your resume and preferences.`); m.reload(); me.reload(); } catch (e) { toast(errText(e), true); } setBusy(false); };
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
    ${banner}
    <div className="note info"><span>Matched ${c.has_resume ? html`from your resume <b>${c.resume_name}</b>` : 'from your preferences'}${c.profile && c.profile.titles && c.profile.titles.length ? ` as ${c.profile.titles.slice(0, 2).join(' / ')}` : ''}${c.profile && c.profile.location ? ` near ${c.profile.location}` : ''}. ${last ? `Last job collection ${fmtTs(last.finished_at || last.started_at)}${last.jobs_new ? `, ${last.jobs_new} new jobs` : ''}.` : 'The first job collection has not run yet.'}</span>
      <div className="actions"><a className="btn ghost sm" href="#/portal/resume">Edit resume & preferences</a><button className="btn ghost sm" type="button" disabled=${busy} onClick=${refresh}><${Icon} n="refresh" />Refresh matches</button></div></div>
    <${JobsTabs} tab=${tab} setTab=${setTab} counts=${{ ...counts, sent: sentToMe.docs.length }} />
    <div className="toolbar"><input style=${{ maxWidth: 360 }} type="search" placeholder="Filter by title, company or location" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Filter jobs" /></div>
    ${m.error ? html`<${JobsOffline} error=${m.error} />` : m.loading ? html`<${Spinner} />` : list.length ? html`<div className="matches">${list.map(j => html`<${JobRow} key=${j.id} j=${j} onState=${setState} onApply=${onApply} resumes=${resumes} busy=${busy} />`)}</div>`
      : html`<div className="panel"><${Empty} title=${tab === 'new' ? (ql ? 'No matches for that filter' : 'No new matches yet') : `Nothing under ${MATCH_STATES[tab]}`}>${tab === 'new' && !ql ? (runLive(run) ? 'A collection is running right now; matches appear when it finishes.' : 'Jobs are collected every few hours. Add more titles or locations under Resume & preferences to widen the search.') : ''}<//></div>`}
    ${applying && html`<${JobApplyModal} j=${applying} c=${c} onClose=${() => setApplying(null)} onApply=${(resumeId, note) => { fireApply(applying, resumeId, note); setTimeout(() => setApplying(null), 50); }} />`}
  </div>`;
}

/* ---------- one-click apply (consultant side) ---------- */
const APP_STATES = { applied: 'Applied', interview: 'Interview', offer: 'Offer', placed: 'Placed', rejected: 'Rejected', withdrawn: 'Withdrawn' };
const APPLY_TPL = 'Hello,\n\nPlease consider {name} for the {job} role{company}. {name} is a {title} with {years} of experience in {skills}, based in {location}, available for {types}.\n\nThe resume is attached. Reply to this email to schedule a call.\n\n{signature}';
const APPLY_VARS = '{name} {title} {job} {company} {years} {skills} {location} {phone} {email}';
/* Renders the cover note for a job client side (the server renders the same template when no note is sent). c = jobPersonOut, prof = the u/{uid}.p profile. */
function applyNote(tpl, j, c, prof) {
  const p = (c && c.profile) || {}; const pr = (c && c.prefs) || {}; prof = prof || {};
  const own = !!(tpl && tpl.trim()); tpl = own ? tpl : APPLY_TPL;
  const name = prof.n || (c && c.name) || 'the consultant';
  const vars = { name, job: j.title || 'this', company: j.company ? (own ? j.company : ' at ' + j.company) : '',
    title: (pr.titles && pr.titles[0]) || (p.titles && p.titles[0]) || prof.ti || 'consultant',
    years: p.years ? p.years + ' years' : 'several years', skills: (p.skills || []).slice(0, 6).join(', ') || (pr.skills || []).slice(0, 6).join(', ') || 'the required skills',
    location: (pr.locations && pr.locations[0]) || p.location || prof.loc || 'the United States', phone: prof.ph || '', email: prof.e || (c && c.email) || '',
    types: (pr.job_types || []).join(', ') || 'contract or full-time roles' };
  vars.signature = [name, vars.phone, vars.email].filter(Boolean).join('\n');
  return tpl.replace(/\{(\w+)\}/g, (m, k) => Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m);
}
function JobApplyModal({ j, c, onClose, onApply }) {
  const P = usePortal();
  const resumes = (c && c.resumes) || []; const prefs = (c && c.prefs) || {};
  const primary = resumes.find(r => r.primary) || resumes[0];
  const [rid, setRid] = useState(primary ? primary.id : 0);
  const [note, setNote] = useState(() => applyNote(prefs.apply_note, j, c, P.prof));
  const mails = j.contact_email && prefs.apply_email !== false;
  const foot = html`<button className="btn ghost" type="button" onClick=${onClose}>Cancel</button>
    ${resumes.length ? html`<a className="btn go" href=${j.url} target="_blank" rel="noopener noreferrer" onClick=${() => { onApply(+rid, note); }}><${Icon} n="send" />Apply with this resume</a>` : html`<a className="btn go" href="#/portal/resume" onClick=${onClose}>Upload a resume first</a>`}`;
  return html`<${Modal} title=${'Apply: ' + j.title} onClose=${onClose} foot=${foot}>
    <div className="form">
      <p className="muted small" style=${{ margin: 0 }}><b>${j.title}</b>${[j.company, j.location].filter(Boolean).length ? ' · ' + [j.company, j.location].filter(Boolean).join(' · ') : ''}${j.portal ? ' · ' + j.portal : ''}</p>
      <${Field} label="Resume to send" hint=${resumes.length ? 'The resume marked for matching is preselected.' : ''}>${resumes.length ? html`<select value=${rid} onChange=${e => setRid(e.target.value)}>${resumes.map(r => html`<option key=${r.id} value=${r.id}>${(r.label || r.name) + (r.primary ? ' (used for matching)' : '')}</option>`)}</select>`
        : html`<span className="muted small">You have no resume in the portal yet. <a href="#/portal/resume" onClick=${onClose}>Upload one first</a>.</span>`}<//>
      <${Field} label="Cover note" hint="Sent as the email body when the posting lists a contact address, and kept with the application."><textarea rows="8" value=${note} onInput=${e => setNote(e.target.value)} /><//>
      <div className="note info"><span>Opens the posting on ${j.portal || 'the job board'} in a new tab, logs the application under Applications${mails ? ', and emails your resume to the contact address in the posting' : ''}.</span></div>
    </div><//>`;
}
function ApplicationsPage() {
  const P = usePortal(); const toast = useToast();
  const r = useJobsApi('jobs_apps');
  const [busy, setBusy] = useState(0);
  if (!P.prof) return html`<${NeedProfile} />`;
  if (r.error) return html`<${JobsOffline} error=${r.error} />`;
  if (!r.data) return html`<${Spinner} label="Loading your applications…" />`;
  const apps = r.data.apps || []; const counts = r.data.counts || {};
  const setStatus = async (a, status) => { setBusy(a.id); try { await api('jobs_app_set', { id: a.id, status }); toast(`Marked as ${APP_STATES[status] || status}.`); r.reload(); } catch (e) { toast(errText(e), true); } setBusy(0); };
  return html`<div className="stack">
    <div className="kpis" style=${{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
      <a><b>${counts.applied || 0}</b><span>Applied</span></a>
      <a><b>${counts.interview || 0}</b><span>Interviews</span></a>
      <a><b>${counts.offer || 0}</b><span>Offers</span></a>
    </div>
    ${apps.length ? html`<section className="panel"><ul className="list">${apps.map(a => html`<li key=${a.id}><div style=${{ minWidth: 0 }}>
        <div className="t">${a.url ? html`<a href=${a.url} target="_blank" rel="noopener noreferrer">${a.title}</a>` : a.title}</div>
        <div className="m">${[a.company, a.location, a.portal].filter(Boolean).join(' · ')}</div>
        <div className="muted small" style=${{ marginTop: 4 }}>${a.resume_name ? html`Resume <b>${a.resume_name}</b> · ` : ''}${fmtTs(a.at)}${a.kind === 'bench' ? html` · Submitted by ${a.by_name || 'StratEdge'}` : ''}</div>
        ${a.mailed ? html`<div className="meta"><${Chip} s="ok">Emailed to the posting contact<//></div>` : ''}
      </div>
      <div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}><select aria-label="Status" value=${a.status} disabled=${busy === a.id} onChange=${e => setStatus(a, e.target.value)} style=${{ minWidth: 130 }}>${Object.entries(APP_STATES).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select></div></li>`)}</ul></section>`
      : html`<div className="panel"><${Empty} title="No applications yet" action=${html`<a className="btn" href="#/portal/jobs">See matched jobs</a>`}>Use "Apply now" on a matched job: it opens the posting, logs the application here and, when the posting lists a contact address, emails your resume.<//></div>`}
  </div>`;
}

function JobsCard() {
  const r = useJobsApi('jobs_matches&state=new');
  const a = useJobsApi('jobs_apps');
  if (r.error || r.loading) return null;
  const list = ((r.data && r.data.matches) || []).slice(0, 3);
  const nApps = (a.data && a.data.apps) ? a.data.apps.length : 0;
  return html`<section className="panel"><div className="ph-row"><h2 className="ph">Matched jobs</h2><div className="actions" style=${{ flexWrap: 'nowrap' }}><a className="small" href="#/portal/applications">${nApps} application${nApps === 1 ? '' : 's'}</a><a className="btn ghost sm" href="#/portal/jobs">${(r.data && r.data.counts && r.data.counts.new) || 0} new</a></div></div>
    ${list.length ? html`<ul className="list">${list.map(j => html`<li key=${j.id}><div style=${{ minWidth: 0 }}><div className="t"><a href=${j.url} target="_blank" rel="noopener noreferrer">${j.title}</a></div><div className="m">${[j.company, j.location, j.portal].filter(Boolean).join(' · ')}</div></div><${ScoreMeter} n=${j.score} /></li>`)}</ul>`
      : html`<p className="muted small">No new matches yet. <a href="#/portal/resume">Upload or update your resume</a> to get jobs matched from the job boards StratEdge collects from.</p>`}</section>`;
}

/* ---------- consultant: resume and preferences ---------- */
let pdfjsLoad = null;
function loadPdfJs() { // PDF.js is self-hosted under js/vendor/pdfjs and only loaded when a PDF resume is chosen
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!pdfjsLoad) pdfjsLoad = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'js/vendor/pdfjs/pdf.min.js'; s.onload = () => { try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdfjs/pdf.worker.min.js'; res(window.pdfjsLib); } catch (e) { rej(e); } }; s.onerror = () => { pdfjsLoad = null; rej(new Error('PDF reader did not load')); }; document.head.appendChild(s); });
  return pdfjsLoad;
}
async function pdfTextOf(file) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
  let out = '';
  try {
    for (let i = 1; i <= Math.min(doc.numPages, 15); i++) {
      const page = await doc.getPage(i); const tc = await page.getTextContent();
      let line = '', lastY = null, lastX = null;
      for (const it of tc.items) {
        if (typeof it.str !== 'string') continue;
        const x = it.transform[4], y = it.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 2.5) { out += line.trimEnd() + '\n'; line = ''; }
        else if (lastX !== null && x - lastX > 1.5 && line && !line.endsWith(' ') && !it.str.startsWith(' ')) line += ' ';
        line += it.str; lastY = y; lastX = x + (it.width || 0);
        if (it.hasEOL) { out += line.trimEnd() + '\n'; line = ''; lastY = null; lastX = null; }
      }
      out += line.trimEnd() + '\n\n';
    }
  } finally { try { doc.destroy(); } catch (e) { /* ignore */ } }
  return out;
}
function ResumePage() {
  const P = usePortal(); const toast = useToast();
  const me = useJobsApi('jobs_me');
  const [busy, setBusy] = useState(false); const [prog, setProg] = useState(0);
  const [f, setF] = useState(null); const [run, setRun] = useState(null);
  const [label, setLabel] = useState(''); const [asPrimary, setAsPrimary] = useState(null);
  const [renaming, setRenaming] = useState(null); const [newLabel, setNewLabel] = useState('');
  const addedRef = useRef(0); // uploads in this session, so a second quick upload is not treated as the first one while the list refreshes
  const c = me.data && me.data.consultant;
  const resumes = (c && c.resumes) || [];
  useEffect(() => { if (c && !f) { const p = c.prefs || {}; setF({ titles: listStr(p.titles), locations: listStr(p.locations), remote: p.remote || 'any', job_types: p.job_types || [], skills: listStr(p.skills), keywords: listStr(p.keywords), exclude: listStr(p.exclude), apply_note: p.apply_note || '', apply_email: p.apply_email !== false }); } if (me.data && !c && !f) setF({ titles: '', locations: '', remote: 'any', job_types: [], skills: '', keywords: '', exclude: '', apply_note: '', apply_email: true }); }, [me.data]);
  if (!P.prof) return html`<${NeedProfile} />`;
  if (me.error) return html`<${JobsOffline} error=${me.error} />`;
  if (!f) return html`<${Spinner} label="Loading your resume profile…" />`;
  const up = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const primaryOn = asPrimary === null ? !(resumes.length || addedRef.current) : asPrimary; // the first resume is always used for matching
  const onFiles = async fs => {
    const file = fs[0]; const ext = extOf(file.name);
    if (!['pdf', 'docx', 'txt'].includes(ext)) { toast('Upload your resume as PDF, Word (.docx) or plain text.', true); return; }
    if (file.size > MAX_FILE) { toast(`That file is ${sizeLabel(file.size)}. The limit is 10 MB.`, true); return; }
    if (resumes.length >= 10) { toast('Up to 10 resumes can be kept. Delete one first.', true); return; }
    setBusy(true); setProg(0.03);
    try {
      const fd = new FormData(); fd.append('file', file, file.name); fd.append('label', label.trim().slice(0, 80)); fd.append('primary', primaryOn ? '1' : '0');
      if (ext === 'pdf') { try { const text = await pdfTextOf(file); if (text.trim().length > 50) fd.append('text', text.slice(0, 200000)); } catch (e) { /* the server reads it instead */ } }
      const r = await upload('jobs_resume', fd, setProg); Sync.kick();
      const added = r.resume || {}; const isPrimary = !!added.primary; const prof = isPrimary && r.consultant && r.consultant.profile;
      const what = added.label || added.name || file.name;
      if (r.read && r.read.chars < 120) toast(`${what} was added, but no text could be read from it (a scanned image?). Add your titles and skills in the preferences so matching can work.`, true);
      else toast([`${what} added${isPrimary ? ' and used for job matching' : ''}.`, prof ? `Read: ${prof.skills.length} skills${prof.titles.length ? ', ' + prof.titles[0] : ''}${r.matches ? `; ${r.matches} matching jobs so far` : ''}.` : '', isPrimary ? '' : 'Pick "Use for matching" whenever you want it to drive your matches.'].filter(Boolean).join(' '));
      if (r.run) setRun(r.run);
      addedRef.current += 1; setLabel(''); setAsPrimary(null); me.reload();
    } catch (e) { toast(errText(e), true); }
    setBusy(false); setProg(0);
  };
  const makePrimary = async r => { setBusy(true); try { const x = await api('jobs_resume_set', { id: r.id, primary: true }); toast(`${r.label || r.name} is now used for matching${typeof x.matches === 'number' ? `: ${x.matches} job${x.matches === 1 ? '' : 's'} match` : ''}.`); me.reload(); } catch (e) { toast(errText(e), true); } setBusy(false); };
  const rename = async r => { const l = newLabel.trim().slice(0, 80); setBusy(true); try { await api('jobs_resume_set', { id: r.id, label: l }); toast('Renamed.'); setRenaming(null); me.reload(); } catch (e) { toast(errText(e), true); } setBusy(false); };
  const del = async r => { if (!confirm(`Delete "${r.label || r.name}"?${r.primary && resumes.length > 1 ? ' Your newest other resume will be used for matching.' : r.primary ? ' Your matches will come from your preferences only until you upload another one.' : ''}`)) return; setBusy(true); try { await api('jobs_resume_delete', { id: r.id }); toast('Resume deleted.'); me.reload(); } catch (e) { toast(errText(e), true); } setBusy(false); };
  const save = async e => {
    e.preventDefault(); setBusy(true);
    try { const r = await api('jobs_prefs', { prefs: f }); toast(`Preferences saved. ${r.matches} job${r.matches === 1 ? '' : 's'} match right now.`); if (r.run) setRun(r.run); me.reload(); } catch (x) { toast(errText(x), true); }
    setBusy(false);
  };
  const toggleType = t => setF({ ...f, job_types: f.job_types.includes(t) ? f.job_types.filter(x => x !== t) : [...f.job_types, t] });
  const prof = (c && c.profile) || {};
  const primary = resumes.find(r => r.primary);
  return html`<div className="stack">
    <${RunBanner} run=${run} setRun=${setRun} onDone=${() => me.reload()} />
    <div className="g2" style=${{ alignItems: 'start' }}>
    <div className="stack">
      <section className="panel stack" style=${{ gap: 14 }}>
        <div><h2 className="ph">Your resumes</h2><p className="muted small" style=${{ marginTop: 4 }}>${resumes.length ? html`Keep a version per skill set or role. The one marked <b>Primary</b> drives your job matches; any of them can be sent with one-click apply. A copy of each is kept under Documents.` : 'Upload your current resume. We read the titles, skills, experience and location from it and search the job boards for you. You can keep up to 10 versions, for example one per skill set.'}</p></div>
        ${resumes.length ? html`<ul className="files">${resumes.map(r => html`<li key=${r.id} style=${{ flexWrap: 'wrap' }}><${Icon} n="file" />
          <div className="fn" style=${{ minWidth: 0, flex: 1 }}>
            ${renaming === r.id ? html`<form className="actions" style=${{ flexWrap: 'nowrap' }} onSubmit=${e => { e.preventDefault(); rename(r); }}><input value=${newLabel} onInput=${e => setNewLabel(e.target.value)} maxLength="80" placeholder="e.g. SAP FICO resume" aria-label="Resume name" autoFocus /><button className="btn sm" disabled=${busy}>Save</button><button className="btn ghost sm" type="button" onClick=${() => setRenaming(null)}>Cancel</button></form>`
              : html`<b>${r.label || r.name}</b><span>${r.label ? r.name + ' · ' : ''}Uploaded ${fmtDay(r.at)}${r.size ? ', ' + sizeLabel(r.size) : ''}</span>`}
            <div className="meta" style=${{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>${r.primary ? html`<${Chip} s="ok">Primary · used for matching<//>` : ''}${r.profile && r.profile.titles && r.profile.titles.length ? html`<${Chip}>${r.profile.titles.slice(0, 2).join(' / ')}<//>` : ''}${r.profile && r.profile.skills_n ? html`<span className="muted small">${r.profile.skills_n} skills read</span>` : ''}</div>
          </div>
          <div className="actions" style=${{ justifyContent: 'flex-end' }}>
            ${!r.primary && html`<button className="btn ghost sm" type="button" disabled=${busy} onClick=${() => makePrimary(r)}><${Icon} n="star" />Use for matching</button>`}
            <button className="btn ghost sm" type="button" disabled=${busy} onClick=${() => { setRenaming(r.id); setNewLabel(r.label || ''); }}><${Icon} n="pen" />Rename</button>
            <a className="btn ghost sm" href=${fileUrl('u/' + P.uid, r.fid, true)} download=${r.name}><${Icon} n="down" />Download</a>
            <button className="btn ghost sm icon" type="button" aria-label="Delete" title="Delete this resume" disabled=${busy} onClick=${() => del(r)}><${Icon} n="trash" /></button>
          </div></li>`)}</ul>` : ''}
        ${resumes.length < 10 ? html`<div className="form" style=${{ gap: 10 }}>
          <div className="row2"><${Field} label="Name this resume (optional)"><input value=${label} onInput=${e => setLabel(e.target.value)} maxLength="80" placeholder="e.g. SAP FICO resume, Java resume" /><//>
            <label className="check" style=${{ alignSelf: 'end', paddingBottom: 12 }}><input type="checkbox" checked=${primaryOn} onChange=${e => setAsPrimary(e.target.checked)} /><span>Use this resume for job matching</span></label></div>
          <${FilePick} busy=${busy} progress=${prog} onFiles=${onFiles} label="Drop a resume here, or choose one. You can keep up to 10." hint="PDF, Word (.docx) or text, up to 10 MB." />
        </div>` : html`<p className="muted small" style=${{ margin: 0 }}>You have 10 resumes, the maximum. Delete one to add another.</p>`}
      </section>
      ${c && c.has_resume && html`<section className="panel stack" style=${{ gap: 10 }}><h2 className="ph">What we read from it</h2>
        ${primary ? html`<p className="muted small" style=${{ margin: 0 }}>From <b>${primary.label || primary.name}</b>, your primary resume.</p>` : ''}
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
      <${Field} label="Locations" hint="Comma-separated cities or states, e.g. Edison, NJ; Remote. Your resume location is used when empty."><input value=${f.locations} onInput=${up('locations')} /><//>
      <${Field} label="Work mode"><select value=${f.remote} onChange=${up('remote')}>${REMOTE_OPTS.map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
      <div className="fld"><span>Engagement types</span><div className="meta" style=${{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>${JOB_TYPES.map(t => html`<label key=${t} className=${'pillbtn' + (f.job_types.includes(t) ? ' on' : '')}><input type="checkbox" hidden checked=${f.job_types.includes(t)} onChange=${() => toggleType(t)} />${t}</label>`)}</div><small>Leave all unticked to see every type.</small></div>
      <${Field} label="Extra skills" hint="Skills to match on that may be missing from the resume."><input value=${f.skills} onInput=${up('skills')} /><//>
      <${Field} label="Must-have words" hint="Jobs mentioning these rank higher, e.g. implementation, healthcare."><input value=${f.keywords} onInput=${up('keywords')} /><//>
      <${Field} label="Exclude words" hint="Jobs mentioning these are hidden, e.g. clearance, relocation."><input value=${f.exclude} onInput=${up('exclude')} /><//>
      <h2 className="ph" style=${{ marginTop: 6 }}>One-click apply</h2>
      <${Field} label="Cover note for one-click apply" hint=${'Leave empty for the standard note. Placeholders: ' + APPLY_VARS + '.'}><textarea rows="5" value=${f.apply_note} onInput=${up('apply_note')} placeholder=${APPLY_TPL.split('\n\n')[1]} /><//>
      <label className="check"><input type="checkbox" checked=${!!f.apply_email} onChange=${up('apply_email')} /><span>Email my resume automatically when a posting lists a contact address</span></label>
      <div className="actions"><button className="btn" disabled=${busy}>${busy ? 'Saving…' : 'Save preferences'}</button><a className="btn ghost" href="#/portal/jobs">See matched jobs</a></div>
    </form>
  </div></div>`;
}

/* ---------- staff: Job portals (grabber, sources, runs, jobs, consultants) ---------- */
/* bench = a bench sales recruiter (no Sources tab, no schedule/cron, read-only runs); tab = the tab to open first. Staff and bench both get "Submit consultant". */
function JobPortalsAdmin({ bench, tab: tab0 }) {
  const [tab, setTab] = useState(tab0 || 'grab');
  const [run, setRun] = useState(null);
  const ov = useJobsApi('jobs_admin&op=overview');
  const sub = useSubmit();
  useEffect(() => { if (ov.data) setRun(ov.data.run || null); }, [ov.data]);
  useEffect(() => { setTab(tab0 || 'grab'); }, [tab0]);
  if (ov.error) return html`<div className="stack"><${JobsOffline} error=${ov.error} /><${JobsHelp} /></div>`;
  if (!ov.data) return html`<${Spinner} label="Loading job matching…" />`;
  const o = ov.data; const last = o.last_run;
  const started = r => { setRun(r); ov.reload(); };
  const here = location.hash || '#/portal/admin/jobs'; // the KPI anchors stay on the current page (#/portal/admin/jobs or #/portal/jobs/grab)
  const go = k => e => { e.preventDefault(); setTab(k); };
  const tabs = [['grab', 'Job grabber'], ['sources', 'Sources'], ['runs', 'Collection runs'], ['jobs', 'Collected jobs'], ['consultants', 'Consultant matches']].filter(([k]) => !bench || k !== 'sources');
  return html`<div className="stack">
    <div className="kpis" style=${bench ? { gridTemplateColumns: 'repeat(3,minmax(0,1fr))' } : null}>
      ${!bench && html`<a href=${here} onClick=${go('sources')}><b>${o.sources_on}</b><span>Job sources in use</span></a>`}
      <a href=${here} onClick=${go('jobs')}><b>${o.jobs}</b><span>Jobs collected (${o.jobs_7d} this week)</span></a>
      <a href=${here} onClick=${go('consultants')}><b>${o.consultants_with_resume}</b><span>Consultants with a resume</span></a>
      <a href=${here} onClick=${go('runs')}><b>${runLive(run) ? 'Running' : last ? (RUN_STATUS[last.status] || last.status) : '—'}</b><span>${last ? 'Last collection ' + fmtTs(last.finished_at || last.started_at) : 'No collection yet'}</span></a>
      ${!bench && html`<a href=${here} onClick=${go('sources')}><b>${o.schedule_hours > 0 ? 'Every ' + (o.schedule_hours >= 1 ? o.schedule_hours + 'h' : Math.round(o.schedule_hours * 60) + 'm') : 'Manual'}</b><span>${o.next_run_at ? 'Next due ' + fmtTs(o.next_run_at) : 'Schedule'}</span></a>`}
    </div>
    <${RunBanner} run=${run} setRun=${setRun} admin=${!bench} onDone=${() => ov.reload()} />
    <div className="tabs" role="tablist">${tabs.map(([k, v]) => html`<button key=${k} type="button" role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}</button>`)}</div>
    ${tab === 'grab' && html`<${JobGrabber} o=${o} run=${run} onStart=${started} bench=${bench} onSubmit=${sub.onSubmit} />`}
    ${tab === 'sources' && !bench && html`<${SourcesTab} reload=${ov.reload} />`}
    ${tab === 'runs' && html`<${RunsTab} o=${o} run=${run} onStart=${started} readOnly=${bench} />`}
    ${tab === 'jobs' && html`<${CollectedJobs} o=${o} onSubmit=${sub.onSubmit} bench=${bench} />`}
    ${tab === 'consultants' && html`<${ConsultantMatches} onSubmit=${sub.onSubmit} />`}
    ${sub.modal}
  </div>`;
}
const JobsHelp = () => html`<section className="panel stack" style=${{ gap: 8 }}><h2 className="ph">How job matching works</h2>
  <p className="muted small">Jobs are collected from the sources turned on under Sources (job-board APIs that publish listings for this purpose, plus any RSS/JSON feed you add), every few hours and whenever you grab jobs by keyword. Each posting is ranked against every consultant's resume and preferences. Nothing logs in to Dice, LinkedIn, Indeed or Monster with a password: those sites block automated logins and ban accounts; listings from them come through the JSearch (Google for Jobs) and Jooble sources instead.</p></section>`;

function SourceCard({ s, reload }) {
  const toast = useToast();
  const [f, setF] = useState(() => Object.fromEntries(s.fields.map(x => [x.k, x.secret ? '' : x.value])));
  const [perRun, setPerRun] = useState(s.per_run); const [cap, setCap] = useState(s.month ? s.month.cap : 0); const [country, setCountry] = useState(s.country || 'us');
  const [busy, setBusy] = useState(null); const [test, setTest] = useState(null);
  const call = async (body, msg) => { setBusy(body.op); try { const r = await api('jobs_admin', { key: s.key, ...body }); msg && toast(msg); reload(); return r; } catch (e) { toast(errText(e), true); reload(); } finally { setBusy(null); } };
  const save = async () => { const fields = {}; s.fields.forEach(x => { if (f[x.k] && f[x.k].trim()) fields[x.k] = f[x.k].trim(); }); const r = await call({ op: 'source_save', fields, per_run: perRun, month_cap: cap || undefined, country }, null); if (r) { toast(`${s.name} saved.`); setF(Object.fromEntries(s.fields.map(x => [x.k, x.secret ? '' : (fields[x.k] || f[x.k])]))); } };
  const toggle = async () => { const r = await call({ op: 'source_save', on: !s.on }, null); if (r) toast(r.on ? `${s.name} is on. Click Test to check it.` : `${s.name} is off.`); };
  const runTest = async () => { setTest(null); setBusy('test'); try { const r = await api('jobs_admin', { op: 'source_test', key: s.key }); setTest(r); reload(); } catch (e) { setTest({ ok: false, error: errText(e) }); } setBusy(null); };
  const st = s.status;
  return html`<div className="panel stack srccard" style=${{ gap: 10 }}>
    <div className="ph-row" style=${{ marginBottom: 0 }}><h3 className="ph" style=${{ margin: 0 }}>${s.name}</h3><div className="meta" style=${{ margin: 0, display: 'flex', gap: 6 }}><${Chip}>${s.cost}<//>${s.remote && html`<${Chip}>Remote jobs<//>`}${s.on && s.ready ? html`<${Chip} s="ok">On<//>` : html`<${Chip} s="inactive">Off<//>`}</div></div>
    <p className="muted small" style=${{ margin: 0 }}>${s.about} ${s.link && html`<a href=${s.link} target="_blank" rel="noopener noreferrer">${s.fields.length ? 'Get a key' : 'Website'}</a>`}</p>
    ${s.fields.length ? html`<div className="form" style=${{ gap: 8 }}>${s.fields.map(x => html`<${Field} key=${x.k} label=${x.label + (x.secret && x.set ? ' (saved: ' + x.value + ')' : '')}><input value=${f[x.k]} onInput=${e => setF({ ...f, [x.k]: e.target.value })} placeholder=${x.secret && x.set ? 'Leave empty to keep the saved key' : ''} autoComplete="off" /><//>`)}
      <div className="row2">${s.kind === 'search' && html`<${Field} label="Searches per collection" hint="Each consultant title and location is one search."><input type="number" min="1" max="100" value=${perRun} onInput=${e => setPerRun(+e.target.value || 1)} /><//>`}
        ${s.month && html`<${Field} label="Monthly search limit" hint=${`Used this month: ${s.month.used}. Set it to your plan's limit.`}><input type="number" min="1" max="100000" value=${cap} onInput=${e => setCap(+e.target.value || 1)} /><//>`}
        ${s.key === 'adzuna' && html`<${Field} label="Country code"><input value=${country} onInput=${e => setCountry(e.target.value)} maxLength="2" style=${{ maxWidth: 90 }} /><//>`}</div></div>`
      : s.kind === 'search' ? html`<div className="row2"><${Field} label="Searches per collection"><input type="number" min="1" max="100" value=${perRun} onInput=${e => setPerRun(+e.target.value || 1)} /><//></div>` : ''}
    ${st && (st.error ? html`<p className="err small" style=${{ margin: 0 }}>Last problem ${fmtTs(st.err_at)}: ${st.error}</p>` : st.ok_at ? html`<p className="small" style=${{ margin: 0, color: 'var(--teal-ink)' }}>Last worked ${fmtTs(st.ok_at)} (${st.n} jobs).</p>` : '')}
    ${test && html`<div className=${'note ' + (test.ok ? 'ok' : 'red')}><span>${test.ok ? html`<b>Works.</b> ${test.n} job${test.n === 1 ? '' : 's'} for "software engineer"${test.sample && test.sample.length ? ': ' + test.sample.slice(0, 3).join('; ') : ''}` : html`<b>Not working.</b> ${test.error}`}</span></div>`}
    <div className="actions">
      ${(s.fields.length || s.kind === 'search') && html`<button className="btn sm" type="button" disabled=${!!busy} onClick=${save}>${busy === 'source_save' ? 'Saving…' : 'Save'}</button>`}
      <button className=${'btn sm' + (s.on ? ' ghost' : '')} type="button" disabled=${!!busy} onClick=${toggle}>${s.on ? 'Turn off' : 'Turn on'}</button>
      <button className="btn ghost sm" type="button" disabled=${!!busy || !s.ready} onClick=${runTest}>${busy === 'test' ? 'Testing…' : 'Test'}</button>
    </div>
  </div>`;
}
function SourcesTab({ reload }) {
  const toast = useToast();
  const r = useJobsApi('jobs_admin&op=sources');
  const [st, setSt] = useState(null); const [feed, setFeed] = useState({ name: '', url: '' }); const [busy, setBusy] = useState(false); const [ftest, setFtest] = useState({});
  useEffect(() => { if (r.data && !st) setSt(r.data.settings); }, [r.data]);
  if (r.error) return html`<${JobsOffline} error=${r.error} />`;
  if (!r.data || !st) return html`<${Spinner} />`;
  const both = () => { r.reload(); reload(); };
  const saveSettings = async e => { e.preventDefault(); setBusy(true); try { await api('jobs_admin', { op: 'settings_save', ...st }); toast('Schedule saved.'); both(); } catch (x) { toast(errText(x), true); } setBusy(false); };
  const addFeed = async e => { e.preventDefault(); setBusy(true); try { await api('jobs_admin', { op: 'feed_save', ...feed, on: true }); toast('Feed added.'); setFeed({ name: '', url: '' }); both(); } catch (x) { toast(errText(x), true); } setBusy(false); };
  const feedToggle = async f => { try { await api('jobs_admin', { op: 'feed_toggle', id: f.id, on: !f.on }); both(); } catch (x) { toast(errText(x), true); } };
  const feedDel = async f => { if (!confirm(`Remove the feed "${f.name}"?`)) return; try { await api('jobs_admin', { op: 'feed_delete', id: f.id }); both(); } catch (x) { toast(errText(x), true); } };
  const feedTest = async f => { setFtest({ ...ftest, [f.id]: { busy: true } }); try { const t = await api('jobs_admin', { op: 'source_test', key: 'feed:' + f.id }); setFtest({ ...ftest, [f.id]: t }); } catch (x) { setFtest({ ...ftest, [f.id]: { ok: false, error: errText(x) } }); } };
  const copy = async (text, what) => { try { await navigator.clipboard.writeText(text); toast(what + ' copied.'); } catch (e) { prompt('Copy this:', text); } };
  const newKey = async () => { if (!confirm('Make a new cron key? Update your cron job with the new command afterwards.')) return; try { await api('jobs_admin', { op: 'cron_key' }); toast('New cron key made.'); both(); } catch (x) { toast(errText(x), true); } };
  const cron = r.data.cron; const up = k => e => setSt({ ...st, [k]: e.target.value });
  return html`<div className="stack">
    <div className="note info"><span><b>How this works.</b> Turn on the sources you want and add their keys. Every few hours (or whenever someone opens a job page, or on the cron schedule below) each consultant's titles and locations are searched on every source, and the results are matched to every resume. The free no-key sources list remote roles; for on-site and hybrid roles across the US add Adzuna (free key) and, for listings that appear on LinkedIn, Indeed, Dice and Monster, JSearch.</span></div>
    <div className="portals-grid">${r.data.sources.map(s => html`<${SourceCard} key=${s.key + (s.on ? 1 : 0) + (s.ready ? 1 : 0)} s=${s} reload=${both} />`)}</div>
    <div className="g2" style=${{ alignItems: 'start' }}>
      <section className="panel stack" style=${{ gap: 10 }}><h2 className="ph">Your own feeds</h2>
        <p className="muted small" style=${{ margin: 0 }}>Any RSS, Atom or JSON job feed, for example from a C2C requirement board. If the address contains <code>{keywords}</code> (and optionally <code>{location}</code>) it is searched per consultant title; otherwise the whole feed is read and filtered by the consultants' titles.</p>
        ${r.data.feeds.length ? html`<ul className="list">${r.data.feeds.map(f => html`<li key=${f.id}><div style=${{ minWidth: 0 }}><div className="t">${f.name} ${f.on ? html`<${Chip} s="ok">On<//>` : html`<${Chip} s="inactive">Off<//>`}</div><div className="m" style=${{ wordBreak: 'break-all' }}>${f.url}</div>
          ${f.status && f.status.error ? html`<div className="err small">Last problem: ${f.status.error}</div>` : f.status && f.status.ok_at ? html`<div className="small muted">Last worked ${fmtTs(f.status.ok_at)} (${f.status.n} jobs)</div>` : ''}
          ${ftest[f.id] && !ftest[f.id].busy ? html`<div className="small" style=${{ color: ftest[f.id].ok ? 'var(--teal-ink)' : 'var(--red-ink)' }}>${ftest[f.id].ok ? `Works: ${ftest[f.id].n} items` + (ftest[f.id].sample && ftest[f.id].sample.length ? ' (' + ftest[f.id].sample[0] + ')' : '') : 'Not working: ' + ftest[f.id].error}</div>` : ''}</div>
          <div className="actions" style=${{ flexWrap: 'nowrap' }}><button className="btn ghost sm" type="button" onClick=${() => feedTest(f)} disabled=${ftest[f.id] && ftest[f.id].busy}>Test</button><button className="btn ghost sm" type="button" onClick=${() => feedToggle(f)}>${f.on ? 'Turn off' : 'Turn on'}</button><button className="btn ghost sm icon" type="button" aria-label="Remove" onClick=${() => feedDel(f)}><${Icon} n="trash" /></button></div></li>`)}</ul>` : ''}
        <form className="form" onSubmit=${addFeed} style=${{ gap: 8 }}><div className="row2"><${Field} label="Name"><input value=${feed.name} onInput=${e => setFeed({ ...feed, name: e.target.value })} placeholder="e.g. C2C requirements board" /><//><${Field} label="Feed address"><input value=${feed.url} onInput=${e => setFeed({ ...feed, url: e.target.value })} placeholder="https://…/feed" /><//></div><div><button className="btn sm" disabled=${busy}><${Icon} n="plus" />Add feed</button></div></form>
      </section>
      <div className="stack">
        <form className="panel form" onSubmit=${saveSettings}><h2 className="ph">Schedule and limits</h2>
          <div className="row2"><${Field} label="Collect automatically every (hours)" hint="0 turns automatic collections off."><input type="number" min="0" max="168" step="0.5" value=${st.schedule_hours} onInput=${up('schedule_hours')} /><//><${Field} label="Look for jobs posted in the last (days)"><input type="number" min="1" max="60" value=${st.max_age_days} onInput=${up('max_age_days')} /><//></div>
          <div className="row2"><${Field} label="Searches per collection" hint="Distinct title + location pairs across all consultants."><input type="number" min="1" max="100" value=${st.max_searches} onInput=${up('max_searches')} /><//><${Field} label="Keep jobs for (days)"><input type="number" min="7" max="180" value=${st.keep_days} onInput=${up('keep_days')} /><//></div>
          <${Field} label="Minimum match score to show (10–90)" hint="Lower it to see more, looser matches."><input type="number" min="10" max="90" value=${st.min_score} onInput=${up('min_score')} /><//>
          <div><button className="btn" disabled=${busy}>Save</button></div></form>
        <section className="panel stack" style=${{ gap: 8 }}><h2 className="ph">Hands-free collections (cron)</h2>
          <p className="muted small" style=${{ margin: 0 }}>Collections also run while anyone has a job page open. To run them without that, add a cron job in cPanel (Cron Jobs, every 10 or 15 minutes) with this command:</p>
          <pre className="small" style=${{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>${cron.cli}</pre><div className="actions"><button className="btn ghost sm" type="button" onClick=${() => copy(cron.cli, 'Command')}>Copy command</button></div>
          <p className="muted small" style=${{ margin: 0 }}>Or, if your host only offers web cron, call this address instead (keep it private):</p>
          <pre className="small" style=${{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>${cron.url}</pre><div className="actions"><button className="btn ghost sm" type="button" onClick=${() => copy(cron.url, 'Address')}>Copy address</button><button className="btn ghost sm" type="button" onClick=${newKey}>New key</button></div>
          <p className="small" style=${{ margin: 0 }}>${cron.last ? html`Cron last ran <b>${fmtTs(cron.last)}</b>.` : html`<span className="muted">The cron job has not run yet.</span>`}</p>
        </section>
      </div>
    </div>
  </div>`;
}

function RunsTab({ o, run, onStart, readOnly }) {
  const toast = useToast();
  const r = useJobsApi('jobs_admin&op=runs&limit=40', [run && run.status, run && run.progress && run.progress.done]);
  const [busy, setBusy] = useState(false); const [log, setLog] = useState(null);
  const start = async () => { setBusy(true); try { const x = await api('jobs_admin', { op: 'run' }); toast(x.already ? 'A collection is already running.' : 'Collection started.'); onStart(x.run); } catch (e) { toast(errText(e), true); } setBusy(false); };
  const showLog = async x => { setLog({ ...x, log: 'Loading…' }); try { const d = await api('jobs_admin&op=run_log&id=' + x.id); setLog(d.run); } catch (e) { setLog({ ...x, log: errText(e) }); } };
  const stChip = s => html`<${Chip} s=${s === 'done' ? 'ok' : s === 'running' || s === 'queued' ? 'new' : s === 'done_with_errors' ? 'amber' : 'red'}>${RUN_STATUS[s] || s}<//>`;
  return html`<${Fragment}>
    <div className="note info"><span>A collection searches every source for each consultant's titles and locations, then refreshes everyone's matches. ${readOnly ? 'StratEdge staff schedule them; use the Job grabber to search right now.' : o.schedule_hours > 0 ? `One starts automatically every ${o.schedule_hours} hours when a job page is open or the cron job runs.` : 'Automatic collections are off (set the hours under Sources).'}</span>
      ${!readOnly && html`<div className="actions"><button className="btn sm" type="button" disabled=${busy || runLive(run)} onClick=${start}><${Icon} n="refresh" />${runLive(run) ? 'Collection in progress…' : 'Collect jobs now'}</button></div>`}</div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${r.loading && !r.data ? html`<${Spinner} />` : r.data && r.data.runs.length ? html`<div className="tblwrap"><table className="tbl">
        <thead><tr><th>Started</th><th>Kind</th><th>Status</th><th>Started by</th><th className="r">Searches</th><th className="r">Jobs seen</th><th className="r">New</th><th>Problems</th><th className="r"><span className="sr">Log</span></th></tr></thead>
        <tbody>${r.data.runs.map(x => html`<tr key=${x.id}><td>${fmtTs(x.started_at)}${x.finished_at ? html`<div className="muted small">${Math.max(1, Math.round((x.finished_at - x.started_at) / 60000))} min</div>` : html`<div className="muted small">${x.progress.done}/${x.progress.total} steps</div>`}</td><td>${RUN_KINDS[x.kind] || x.kind}</td><td>${stChip(x.status)}</td><td className="muted small">${x.trigger_by}</td>
          <td className="r">${x.searches}</td><td className="r">${x.jobs_found}</td><td className="r">${x.jobs_new}</td><td className="small">${x.errors.length ? x.errors.slice(0, 4).map((e, i) => html`<div key=${i}><b>${e.source}:</b> ${e.error}</div>`) : html`<span className="muted">None</span>`}</td>
          <td className="r"><button className="btn ghost sm" type="button" onClick=${() => showLog(x)}>Log</button></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title="No collections yet">${readOnly ? 'Use the Job grabber to search the sources by keyword.' : 'Click "Collect jobs now" once a consultant has uploaded a resume, or use the Job grabber.'}<//>`}
    </section>
    ${log && html`<${Modal} wide title=${'Collection ' + fmtTs(log.started_at)} onClose=${() => setLog(null)}><pre className="small" style=${{ whiteSpace: 'pre-wrap', maxHeight: '60vh', overflow: 'auto' }}>${log.log || 'No log lines.'}</pre><//>`}
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

function CollectedJobs({ o, onSubmit, bench }) {
  const [q, setQ] = useState(''); const [source, setSource] = useState(''); const [qq, setQq] = useState('');
  useEffect(() => { const t = setTimeout(() => setQq(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  const r = useJobsApi('jobs_admin&op=jobs&q=' + encodeURIComponent(qq) + '&source=' + encodeURIComponent(source));
  const pub = usePublish(r.reload);
  return html`<${Fragment}>
    <div className="toolbar"><input style=${{ maxWidth: 340 }} type="search" placeholder="Search title, company, location, skills" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search jobs" />
      ${(o.sources || []).some(s => s.key) && html`<select value=${source} onChange=${e => setSource(e.target.value)} aria-label="Source" style=${{ maxWidth: 220 }}><option value="">All sources</option>${(o.sources || []).filter(s => s.key).map(s => html`<option key=${s.key} value=${s.key}>${s.name}</option>`)}</select>`}
      <span className="muted small">${r.data ? `${r.data.total} job${r.data.total === 1 ? '' : 's'}` : ''}</span></div>
    ${r.error ? html`<${JobsOffline} error=${r.error} />` : r.loading && !r.data ? html`<${Spinner} />` : r.data.jobs.length ? html`<div className="matches">${r.data.jobs.map(j => html`<${JobRow} key=${j.id} j=${j} onPublish=${pub.publish} onSubmit=${onSubmit} busy=${pub.busy} />`)}</div>`
      : html`<div className="panel"><${Empty} title="No jobs collected yet">${bench ? 'Grab jobs by keyword from the Job grabber tab.' : 'Grab jobs by keyword, or start a collection from the Collection runs tab once a consultant has uploaded a resume.'}<//></div>`}
  <//>`;
}

function ConsultantMatches({ onSubmit }) {
  const P = usePortal(); const toast = useToast();
  const r = useJobsApi('jobs_admin&op=consultants');
  const [open, setOpen] = useState(null); const [busy, setBusy] = useState(false);
  const m = useJobsApi(open ? 'jobs_admin&op=matches&uid=' + encodeURIComponent(open.uid) : 'jobs_admin&op=overview');
  if (r.error) return html`<${JobsOffline} error=${r.error} />`;
  if (r.loading && !r.data) return html`<${Spinner} />`;
  const list = r.data.consultants || [];
  const nameOfC = c => c.name || (P.people[c.uid] && P.people[c.uid].name) || c.uid;
  const rematch = async () => { setBusy(true); try { const x = await api('jobs_admin', { op: 'rematch_all' }); toast(`Matches refreshed for ${x.people} ${x.people === 1 ? 'person' : 'people'}.`); r.reload(); } catch (e) { toast(errText(e), true); } setBusy(false); };
  return html`<${Fragment}>
    <div className="toolbar" style=${{ justifyContent: 'flex-end' }}><button className="btn ghost sm" type="button" disabled=${busy} onClick=${rematch}><${Icon} n="refresh" />${busy ? 'Refreshing…' : 'Refresh all matches'}</button></div>
    <section className="panel" style=${{ padding: '6px 8px' }}>
      ${list.length ? html`<div className="tblwrap"><table className="tbl">
        <thead><tr><th>Consultant</th><th>Resume</th><th>Matched as</th><th>Location</th><th className="r">New</th><th className="r">Saved</th><th className="r">Applied</th><th className="r"><span className="sr">Open</span></th></tr></thead>
        <tbody>${list.map(c => html`<tr key=${c.uid} className="click" tabIndex="0" onClick=${() => setOpen(c)} onKeyDown=${e => { if (e.key === 'Enter') setOpen(c); }}>
          <td><b style=${{ fontWeight: 600 }}>${nameOfC(c)}</b><div className="muted small">${c.email}</div></td>
          <td>${c.has_resume ? html`<${Chip} s="ok">${c.resume_count > 1 ? c.resume_count + ' resumes' : c.resume_name}<//><div className="muted small">${c.resume_count > 1 ? 'Matching on ' + c.resume_name : fmtTs(c.resume_at)}</div>` : html`<${Chip} s="amber">Not uploaded<//>`}</td>
          <td>${((c.prefs && c.prefs.titles && c.prefs.titles.length ? c.prefs.titles : c.profile.titles) || []).slice(0, 2).join(', ') || '—'}</td><td>${(c.prefs && c.prefs.locations && c.prefs.locations[0]) || c.profile.location || '—'}</td>
          <td className="r">${c.match_counts.new || 0}</td><td className="r">${c.match_counts.saved || 0}</td><td className="r">${c.match_counts.applied || 0}</td>
          <td className="r"><button className="btn ghost sm" type="button">View</button></td></tr>`)}</tbody></table></div>`
        : html`<${Empty} title="No consultants have set up job matching yet">Consultants upload their resume under "Resume & preferences" in the consultant portal.<//>`}
    </section>
    ${open && html`<${Modal} wide title=${'Matches for ' + nameOfC(open)} onClose=${() => setOpen(null)}>
      <div className="stack">
        <${ConsultantResumes} uid=${open.uid} />
        ${m.loading ? html`<${Spinner} />` : m.error ? html`<${JobsOffline} error=${m.error} />` : (m.data.matches || []).length ? html`<div className="matches">${m.data.matches.map(j => html`<${JobRow} key=${j.id} j=${j} onSubmit=${onSubmit} />`)}</div>` : html`<${Empty} title="No matches yet" />`}
      </div><//>`}
  <//>`;
}

/* ---------- staff: Job grabber (search the sources by keyword, publish to Careers) ---------- */
const GRAB_DAYS = [[1, 'Past 24 hours'], [3, 'Past 3 days'], [7, 'Past week'], [14, 'Past 2 weeks'], [30, 'Past month']];
function JobGrabber({ o, run, onStart, bench, onSubmit }) {
  const toast = useToast();
  const sources = (o.sources || []).filter(s => s.on && s.ready);
  const [f, setF] = useState({ keywords: '', location: '', remote: 'any', posted_days: 7, sources: null });
  const [runId, setRunId] = useState(null);
  const [busy, setBusy] = useState(false);
  const mine = run && run.id === runId ? run : null; const finished = runId && (!run || run.id !== runId || !runLive(run));
  const jobs = useJobsApi(finished ? 'jobs_admin&op=run_jobs&id=' + runId : 'jobs_admin&op=overview');
  const pub = usePublish(jobs.reload);
  const sel = f.sources || Object.fromEntries(sources.map(s => [s.key, true]));
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const grab = async e => {
    e.preventDefault();
    const kws = f.keywords.split(/[,\n;]/).map(x => x.trim()).filter(Boolean);
    if (!kws.length) { toast('Type at least one job title or keyword.', true); return; }
    const chosen = sources.filter(s => sel[s.key]).map(s => s.key);
    if (!chosen.length) { toast('Pick at least one source.', true); return; }
    setBusy(true);
    try { const r = await api('jobs_admin', { op: 'grab', keywords: kws, location: f.location, remote: f.remote, posted_days: +f.posted_days, sources: chosen }); setRunId(r.run.id); onStart(r.run); toast(r.run.status === 'queued' ? 'Queued behind the current collection.' : 'Grabbing jobs… results appear below as each source answers.'); }
    catch (x) { toast(errText(x), true); }
    setBusy(false);
  };
  return html`<${Fragment}>
    <p className="muted small">${bench ? 'Grabbed jobs are matched to every consultant\'s resume. Use Submit to send a consultant\'s resume to the posting in one click.' : `Type job titles or keywords, pick the sources, and grab. Results are stored, matched to every consultant's resume, and any of them can be published to the Careers page with one click.`}${sources.length ? '' : bench ? ' No job source is on yet: ask an administrator to turn some on.' : ' No source is on yet: turn some on under Sources.'}</p>
    <form className="panel form" onSubmit=${grab}>
      <h2 className="ph">Grab jobs</h2>
      <${Field} label="Job titles or keywords" hint="Comma-separated. Each one is searched on every selected source."><input value=${f.keywords} onInput=${up('keywords')} placeholder="e.g. SAP FICO Consultant, ServiceNow Developer, Epic Analyst" /><//>
      <div className="row3"><${Field} label="Location"><input value=${f.location} onInput=${up('location')} placeholder="City, state (empty = United States)" /><//>
        <${Field} label="Posted"><select value=${f.posted_days} onChange=${up('posted_days')}>${GRAB_DAYS.map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
        <${Field} label="Work mode"><select value=${f.remote} onChange=${up('remote')}>${REMOTE_OPTS.map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//></div>
      <div className="fld"><span>Sources</span><div className="meta" style=${{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>${sources.map(s => html`<label key=${s.key} className=${'pillbtn' + (sel[s.key] ? ' on' : '')}><input type="checkbox" hidden checked=${!!sel[s.key]} onChange=${() => setF({ ...f, sources: { ...sel, [s.key]: !sel[s.key] } })} />${s.name}${s.remote ? ' (remote)' : ''}</label>`)}${!sources.length && html`<span className="muted small">None on.</span>`}</div></div>
      <div className="actions"><button className="btn" disabled=${busy || !sources.length}><${Icon} n="search" />${mine && runLive(mine) ? 'Grabbing…' : 'Grab jobs'}</button></div>
    </form>
    ${runId && (finished ? html`<section className="panel stack" style=${{ gap: 10 }}>
      <div className="ph-row"><h2 className="ph">${jobs.data && jobs.data.jobs ? `Grabbed ${jobs.data.jobs.length} job${jobs.data.jobs.length === 1 ? '' : 's'}` : 'Grabbed jobs'}</h2><span className="muted small">${mine && mine.search ? mine.search.map(q => q.q).join(', ') + (mine.search[0] ? ' in ' + mine.search[0].location : '') : ''}</span></div>
      ${mine && mine.errors && mine.errors.length ? html`<div className="note amber"><span>${mine.errors.map((e, i) => html`<div key=${i}><b>${e.source}:</b> ${e.error}</div>`)}</span></div>` : ''}
      ${jobs.data && jobs.data.jobs ? (jobs.data.jobs.length ? html`<div className="matches">${jobs.data.jobs.map(j => html`<${JobRow} key=${j.id} j=${j} onPublish=${pub.publish} onSubmit=${onSubmit} busy=${pub.busy} />`)}</div>` : html`<${Empty} title="Nothing found for that search">Try broader keywords, a longer "Posted" window, or more sources.<//>`) : html`<${Spinner} />`}
    </section>` : html`<section className="panel"><${Spinner} label="Searching the sources… results appear here when the grab finishes." /></section>`)}
  <//>`;
}

/* ---------- staff / bench: submit a consultant to a posting in one click ---------- */
function useSubmit() {
  const [j, setJ] = useState(null);
  const modal = j ? html`<${SubmitModal} j=${j} onClose=${() => setJ(null)} onDone=${() => setJ(null)} />` : null;
  return { onSubmit: setJ, modal };
}
function ConsultantResumes({ uid }) {
  const r = useJobsApi('jobs_admin&op=resumes&uid=' + encodeURIComponent(uid));
  if (r.loading && !r.data) return html`<p className="muted small" style=${{ margin: 0 }}>Loading resumes…</p>`;
  const list = (r.data && r.data.resumes) || [];
  if (r.error || !list.length) return html`<p className="muted small" style=${{ margin: 0 }}><b>Resumes:</b> none uploaded yet.</p>`;
  return html`<div className="small" style=${{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}><b>Resumes:</b>${list.map(x => html`<a key=${x.id} className="chip" href=${fileUrl('u/' + uid, x.fid, true)} download=${x.name} title=${x.name + ' · ' + fmtDay(x.at)}><${Icon} n="down" />${x.label || x.name}${x.primary ? ' (primary)' : ''}</a>`)}</div>`;
}
function SubmitModal({ j, onClose, onDone }) {
  const P = usePortal(); const toast = useToast();
  const cons = useJobsApi('jobs_admin&op=consultants');
  const jd = useJobsApi('jobs_job&id=' + j.id);
  const [q, setQ] = useState(''); const [uid, setUid] = useState('');
  const [res, setRes] = useState({ uid: '', list: null, error: null }); const [rid, setRid] = useState(0);
  const [to, setTo] = useState(''); const [toTouched, setToTouched] = useState(false);
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { // the posting's contact address is suggested once, unless the recruiter already typed one
    const ct = jd.data && jd.data.job && jd.data.job.contact; if (ct && !toTouched && !to) setTo(ct);
  }, [jd.data]);
  useEffect(() => {
    if (!uid) { setRes({ uid: '', list: null, error: null }); setRid(0); return; }
    let live = true; setRes({ uid, list: null, error: null });
    api('jobs_admin&op=resumes&uid=' + encodeURIComponent(uid)).then(d => { if (!live) return; const l = d.resumes || []; const p = l.find(x => x.primary) || l[0]; setRes({ uid, list: l, error: null }); setRid(p ? p.id : 0); })
      .catch(e => live && setRes({ uid, list: [], error: e }));
    return () => { live = false; };
  }, [uid]);
  const all = ((cons.data && cons.data.consultants) || []).filter(c => (c.resume_count || 0) > 0 || c.has_resume);
  const ql = q.trim().toLowerCase();
  const list = all.filter(c => !ql || [c.name, c.email, listStr(c.profile && c.profile.titles), c.profile && c.profile.location, listStr(c.prefs && c.prefs.titles)].filter(Boolean).join(' ').toLowerCase().includes(ql));
  const picked = all.find(c => c.uid === uid);
  const nameOfC = c => c.name || (P.people[c.uid] && P.people[c.uid].name) || c.email || c.uid;
  const emailOk = !to.trim() || /^\S+@\S+\.\S+$/.test(to.trim());
  const ready = !!picked && !!rid && emailOk; // the anchor below must stay rendered while busy, or the click that opens the posting loses its target
  const body = () => ({ job_id: j.id, uid, resume_id: +rid, to: to.trim(), note: note.trim() });
  const after = r => { toast(`Submitted ${nameOfC(picked)} for ${j.title}. Logged under RTRs & submissions${r.mailed ? ' and emailed to ' + (r.to || to.trim()) : ''}.`); onDone(r); };
  const fire = () => { if (!ready || busy) return; setBusy(true); api('jobs_apply', body()).then(after).catch(e => { toast(errText(e), true); setBusy(false); }); }; // not awaited: the anchor opens the posting meanwhile
  const quiet = async () => { if (!ready || busy) return; setBusy(true); try { after(await api('jobs_apply', body())); } catch (e) { toast(errText(e), true); setBusy(false); } };
  const foot = html`<button className="btn ghost" type="button" onClick=${onClose}>Cancel</button>
    <button className="btn" type="button" disabled=${!ready || busy} onClick=${quiet}>${busy ? 'Submitting…' : 'Submit without opening'}</button>
    ${ready ? html`<a className="btn go" href=${j.url} target="_blank" rel="noopener noreferrer" onClick=${fire}><${Icon} n="send" />Submit and open posting</a>` : html`<button className="btn go" type="button" disabled><${Icon} n="send" />Submit and open posting</button>`}`;
  return html`<${Modal} wide title=${'Submit a consultant: ' + j.title} onClose=${onClose} foot=${foot}>
    <div className="g2" style=${{ alignItems: 'start' }}>
      <div className="stack" style=${{ gap: 10 }}>
        <p className="muted small" style=${{ margin: 0 }}><b>${j.title}</b>${[j.company, j.location, j.portal].filter(Boolean).length ? ' · ' + [j.company, j.location, j.portal].filter(Boolean).join(' · ') : ''}</p>
        <div className="toolbar" style=${{ margin: 0 }}><input type="search" placeholder="Search consultants by name, title, location" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search consultants" /></div>
        <div className="picklist">${cons.loading && !cons.data ? html`<${Spinner} />` : cons.error ? html`<p className="err small" style=${{ padding: 10 }}>${errText(cons.error)}</p>` : list.length ? list.map(c => html`<label key=${c.uid} className=${'pick' + (uid === c.uid ? ' on' : '')}><input type="radio" name="sub-uid" checked=${uid === c.uid} onChange=${() => setUid(c.uid)} /><span><b>${nameOfC(c)}</b><small>${[listStr(((c.prefs && c.prefs.titles && c.prefs.titles.length ? c.prefs.titles : (c.profile && c.profile.titles)) || []).slice(0, 2)), (c.prefs && c.prefs.locations && c.prefs.locations[0]) || (c.profile && c.profile.location), (c.resume_count || 1) + (c.resume_count === 1 || !c.resume_count ? ' resume' : ' resumes')].filter(Boolean).join(' · ')}</small></span></label>`)
          : html`<p className="muted small" style=${{ padding: 10 }}>${all.length ? 'No consultant matches that search.' : 'No portal consultant has uploaded a resume yet.'}</p>`}</div>
      </div>
      <div className="form">
        <${Field} label="Resume to send" hint=${picked ? 'The resume the consultant marked for matching is preselected.' : 'Pick a consultant first.'}>${!picked ? html`<select disabled><option>Pick a consultant</option></select>` : res.list === null ? html`<select disabled><option>Loading resumes…</option></select>` : res.list.length ? html`<select value=${rid} onChange=${e => setRid(e.target.value)}>${res.list.map(x => html`<option key=${x.id} value=${x.id}>${(x.label || x.name) + (x.primary ? ' (primary)' : '')}</option>`)}</select>` : html`<span className="err small">This consultant has no resume in the portal yet.</span>`}<//>
        <${Field} label="Send to" hint="Found in the posting. Change it if you know the vendor recruiter's address; leave empty to just log the submission."><input type="email" value=${to} onInput=${e => { setTo(e.target.value); setToTouched(true); }} placeholder=${jd.loading ? 'Looking for a contact address in the posting…' : 'recruiter@vendor.com'} /><//>
        ${!emailOk && html`<p className="err small" style=${{ margin: 0 }}>That does not look like an email address.</p>`}
        <${Field} label="Note (optional)" hint="Goes into the RTR & submissions log entry."><input value=${note} onInput=${e => setNote(e.target.value)} maxLength="300" placeholder="e.g. Rate $70/hr C2C, available in 2 weeks" /><//>
        <div className="note info"><span>The submission is logged under RTRs & submissions and the application appears under the consultant's Applications${to.trim() ? html`; the resume is emailed to <b>${to.trim()}</b> with replies going to ${P.caps.me.email}` : ''}.</span></div>
      </div>
    </div><//>`;
}

/* ---------- bench sales dashboard card ---------- */
function BenchCard() {
  const P = usePortal();
  const ov = useJobsApi('jobs_admin&op=overview');
  const subs = useCol('rec/sub/items', 'd:desc');
  const today = dkey(); const ws = weekStart(today);
  const t = recStats(subs.docs, [], P.uid, today, today), w = recStats(subs.docs, [], P.uid, ws, addDays(ws, 6));
  const o = ov.data || {};
  return html`<section className="panel stack" style=${{ gap: 12 }}>
    <div className="ph-row"><h2 className="ph">Bench sales</h2><div className="actions" style=${{ flexWrap: 'nowrap' }}><a className="btn sm" href="#/portal/jobs/grab"><${Icon} n="search" />Grab jobs</a><a className="btn ghost sm" href="#/portal/rec/submissions"><${Icon} n="send" />Log submission</a></div></div>
    <div className="kpis" style=${{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
      <a href="#/portal/jobs/grab"><b>${ov.error ? '—' : ov.data ? o.jobs : '…'}</b><span>Jobs collected${o.jobs_7d ? ` (${o.jobs_7d} this week)` : ''}</span></a>
      <a href="#/portal/jobs/consultants"><b>${ov.error ? '—' : ov.data ? o.consultants_with_resume : '…'}</b><span>Consultants with a resume</span></a>
      <a href="#/portal/rec/submissions"><b>${t.rtr}<span style=${{ fontSize: 16, fontWeight: 600 }}> RTR / ${t.subs} sub</span></b><span>Today</span></a>
      <a href="#/portal/rec/submissions"><b>${w.rtr}<span style=${{ fontSize: 16, fontWeight: 600 }}> RTR / ${w.subs} sub</span></b><span>This week${w.intv ? `, ${w.intv} interview${w.intv === 1 ? '' : 's'}` : ''}</span></a>
    </div>
    <p className="muted small" style=${{ margin: 0 }}>Grab jobs by keyword, then use <b>Submit consultant</b> on any posting to send the right resume and log the submission in one click. ${o.last_run ? `Last job collection ${fmtTs(o.last_run.finished_at || o.last_run.started_at)}.` : ''}</p>
  </section>`;
}

/* ---------- consultant: jobs StratEdge sent directly ---------- */
const JobsTabs = ({ tab, setTab, counts }) => html`<div className="tabs" role="tablist">${[...Object.entries(MATCH_STATES), ['sent', 'Sent to you']].map(([k, v]) => html`<button key=${k} type="button" role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${v}<span className=${'chip' + (k === 'sent' && counts.sent ? ' amber' : '')}>${counts[k] || 0}</span></button>`)}</div>`;
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
  const foot = done ? html`<button className="btn" type="button" onClick=${onClose}>Done</button>` : html`<button className="btn ghost" type="button" onClick=${onClose}>Cancel</button><button className="btn" type="button" disabled=${busy || !recipients.length} onClick=${send}><${Icon} n="send" />${busy ? 'Sending…' : `Send to ${recipients.length || ''} ${recipients.length === 1 ? 'person' : 'people'}`}</button>`;
  return html`<${Modal} wide title=${'Send: ' + job.ti} onClose=${onClose} foot=${foot}>
    ${done ? html`<div className="stack">
        <div className="note ok"><span><b>Sent to ${done.sent} ${done.sent === 1 ? 'person' : 'people'}.</b> Each email has the job details and a "View and apply" button; replies come to ${P.caps.me.email}. Portal consultants also see it under Matched jobs › Sent to you.</span></div>
        ${done.failed.length ? html`<div className="note red"><span>Could not deliver to: ${done.failed.join(', ')}. Check the outgoing mail settings in api/config.php (storage/mail.log has details).</span></div>` : ''}
      </div>`
      : html`<div className="g2" style=${{ alignItems: 'start' }}>
      <div className="stack" style=${{ gap: 10 }}>
        <div className="tabs" role="tablist" style=${{ marginBottom: 0 }}>${RECIP_GROUPS.map(([k, v]) => html`<button key=${k} type="button" role="tab" aria-selected=${grp === k} className=${grp === k ? 'on' : ''} onClick=${() => setGrp(k)}>${v}${k !== 'other' ? html`<span className="chip">${(groups[k] || []).length}</span>` : ''}</button>`)}</div>
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
