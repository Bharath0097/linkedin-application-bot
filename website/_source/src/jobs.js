/* ================= Jobs: resume matching for consultants, job sources and collections for staff =================
   Job matching runs inside the PHP backend (api/jobs.php). Nothing here talks to an outside service directly. */
const MATCH_STATES = { new: 'New', saved: 'Saved', applied: 'Applied', dismissed: 'Dismissed' };
const REMOTE_OPTS = [
  ['any', 'Anywhere (remote, hybrid or on-site)'],
  ['remote', 'Remote only'],
  ['hybrid', 'Hybrid or remote'],
  ['onsite', 'On-site near me'],
];
const JOB_TYPES = ['Contract', 'C2C', 'W2', '1099', 'Contract-to-hire', 'Full-time', 'Part-time'];
const RUN_STATUS = {
  done: 'Done',
  running: 'Running',
  queued: 'Queued',
  done_with_errors: 'Done with errors',
  failed: 'Failed',
  cancelled: 'Stopped',
};
const RUN_KINDS = { all: 'Scheduled collection', grab: 'Job grab', person: 'One consultant' };
const listStr = v => (Array.isArray(v) ? v.join(', ') : v || '');
const runLive = r => !!r && (r.status === 'running' || r.status === 'queued');

function useJobsApi(route, deps) {
  const [st, setSt] = useState({ data: null, loading: true, error: null });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setSt(s => ({ ...s, loading: true }));
    api(route)
      .then(d => live && setSt({ data: d, loading: false, error: null }))
      .catch(e => live && setSt({ data: null, loading: false, error: e }));
    return () => {
      live = false;
    };
  }, [route, n, ...(deps || [])]);
  return { ...st, reload: () => setN(x => x + 1) };
}

const JobsOffline = ({ error }) =>
  html`<div className="note red">
      <span>
        <b>Job matching hit a problem.</b> ${error ? error.message : ''} Your other pages work as usual.</span>
    </div>`;

/* Keeps a collection moving while someone has it on screen: each tick does a few seconds of work on the server. */
function useRunTicker(run, onRun) {
  const id = run && run.id;
  const live = runLive(run);
  useEffect(() => {
    if (!id || !live) return;
    let on = true;
    (async () => {
      while (on) {
        let r = null;
        try {
          r = await api('jobs_tick', { id });
        } catch (e) {
          await sleep(3000);
          continue;
        }
        if (!on) return;
        onRun(r.run);
        if (!runLive(r.run)) return;
        await sleep(1000);
      }
    })();
    return () => {
      on = false;
    };
  }, [id, live]);
}
function RunBanner({ run, setRun, admin, onDone }) {
  useRunTicker(run, r => {
    setRun(r);
    if (r && !runLive(r) && onDone) onDone(r);
  });
  if (!run) return null;
  const p = run.progress || { done: 0, total: 0 };
  const pct = p.total ? Math.round((100 * p.done) / p.total) : 0;
  if (!runLive(run))
    return html`<div className=${'note ' + (run.status === 'done' ? 'ok' : run.status === 'done_with_errors' ? 'amber' : 'red')}>
        <span>
          <b>
            ${RUN_STATUS[run.status] || run.status}.</b> ${run.jobs_found} job${run.jobs_found === 1 ? '' : 's'} found, ${run.jobs_new} new${run.errors && run.errors.length ? html`; ${run.errors.length} source${run.errors.length === 1 ? '' : 's'} had a problem (see Collection runs)` : ''}.</span>
      </div>`;
  return html`<div className="note info">
      <span style=${{ minWidth: 0, flex: 1 }}>
        <b>
          ${run.status === 'queued' ? 'Waiting for the current collection to finish…' : 'Collecting jobs…'}
        </b> step ${p.done} of ${p.total}${run.jobs_found ? `, ${run.jobs_found} jobs found (${run.jobs_new} new)` : ''}. Keep this page open; it finishes on its own.
        <i className="prog">
          <b style=${{ width: pct + '%' }} />
        </i>
        ${admin && run.log ? html`<pre className="small runlog">${run.log}</pre>` : ''}
      </span>
      ${
        admin &&
        html`<div className="actions"><button className="btn ghost sm" type="button" onClick=${async () => {
          try {
            const r = await api('jobs_admin', { op: 'stop', id: run.id });
            setRun(r.run);
          } catch (e) {
            /* shown by the next tick */
          }
        }}>Stop</button></div>`
      }
    </div>`;
}

const ScoreMeter = ({ n }) =>
  html`<span className="score" title=${'Match score ' + n + ' of 100'}>
      <i style=${{ '--w': Math.max(4, n) + '%' }} />
      <b>
        ${n}
      </b>
    </span>`;

function JobRow({ j, onState, onPublish, onApply, onBotQueue, onBotApply, busy, tailorHref }) {
  const [open, setOpen] = useState(false);
  const chips = [j.portal, j.remote, j.job_type, j.salary].filter(Boolean);
  // v83: only http(s) board links become href
  const also = (j.also || []).filter(a => a.portal && a.portal !== j.portal && /^https?:\/\//i.test(a.url || '')).slice(0, 4);
  return html`<div className="match">
      <div style=${{ minWidth: 0 }}>
        <h3>
          <a href=${j.url} target="_blank" rel="noopener noreferrer">
            ${j.title}
          </a>
        </h3>
        <div className="muted">
          ${[j.company, j.location].filter(Boolean).join(' · ')}${j.posted ? html` <span className="small">· ${j.posted}</span>` : ''}
        </div>
        <div className="meta">
          ${chips.map(c => html`<${Chip} key=${c}>${c}<//>`)}${
            j.state && j.state !== 'new'
              ? html`<${Chip} s=${j.state === 'applied' ? 'ok' : j.state === 'saved' ? 'new' : 'inactive'}>
                  ${MATCH_STATES[j.state]}
                <//>`
              : ''
          }${j.source_name && j.source_name !== j.portal ? html`<span className="muted small">via ${j.source_name}</span>` : ''}
        </div>
        ${
          also.length
            ? html`<div className="small muted" style=${{ marginTop: 6 }}>Also on ${also.map(
                (a, i) => html`<${Fragment} key=${a.url}>
                    ${i ? ', ' : ''}
                    <a href=${a.url} target="_blank" rel="noopener noreferrer">
                      ${a.portal}
                    </a>
                  <//>`
              )}
              </div>`
            : ''
        }
        ${j.reasons && j.reasons.length ? html`<div className="reasons">${j.reasons.join(' · ')}</div>` : ''}
        ${
          j.applied &&
          html`<div className="small" style=${{ marginTop: 6, color: 'var(--teal-ink)' }}>
              ${j.applied.how === 'email' ? `Resume "${j.applied.resume}" emailed to ${j.applied.to}` : j.applied.how === 'careers' ? `Applied with resume "${j.applied.resume}"` : `Sent to the StratEdge recruiting team with resume "${j.applied.resume}"`}${j.applied.status === 'submitted' ? ' · submitted by StratEdge' : ''} · ${fmtTs(j.applied.at)}
            </div>`
        }
        ${
          open &&
          html`<div className="prose small" style=${{ marginTop: 10, whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto' }}>
              <${JobDescription} id=${j.id} summary=${j.summary} />
            </div>`
        }
      </div>
      <div className="stack" style=${{ gap: 8, alignItems: 'flex-end' }}>
        ${typeof j.score === 'number' && html`<${ScoreMeter} n=${j.score} />`}
        <div className="actions" style=${{ justifyContent: 'flex-end' }}>
          <button className="btn ghost sm" type="button" onClick=${() => setOpen(o => !o)}>
            ${open ? 'Hide' : 'Details'}
          </button>
          <a className="btn ghost sm" href=${j.url} target="_blank" rel="noopener noreferrer">Open on ${j.portal || 'the job board'}
          </a>
          ${onBotApply && j.url && !abIsBoard(j.url) && html`<button className="btn sm" type="button" disabled=${busy} onClick=${() => onBotApply(j)} title="Queue, approve and run it with the application bot in one click"><${Icon} n="bolt" />Apply with bot</button>`}
          ${onBotQueue && html`<button className="btn ghost sm" type="button" disabled=${busy} onClick=${() => onBotQueue(j)}><${Icon} n="bolt" />Queue in application bot</button>`}
          ${
            onPublish &&
            (j.published
              ? html`<a className="btn ghost sm" href=${'#/careers/g' + j.id} target="_blank" rel="noopener">
                  <${Icon} n="check" />On Careers</a>
                <${SendJobButton} jobId=${'g' + j.id} small=${true} />
                <button className="btn ghost sm" type="button" disabled=${busy} onClick=${() => onPublish(j, false)}>Remove</button>`
              : html`<button className="btn sm" type="button" disabled=${busy} onClick=${() => onPublish(j, true)}>
                  <${Icon} n="mega" />Publish to Careers</button>`)
          }
          ${
            onState &&
            html`<${Fragment}>
                ${
                  onApply &&
                  j.state !== 'applied' &&
                  html`<button className="btn sm" type="button" disabled=${busy} onClick=${() => onApply(j)}>
                      <${Icon} n="send" />Apply</button>`
                }
                ${tailorHref && html`<a className="btn sm ghost" href=${tailorHref(j)} title="A version of your resume written for this job"><${Icon} n="bolt" />Tailor resume</a>`}
                ${
                  j.state !== 'saved' &&
                  j.state !== 'applied' &&
                  html`<button className=${'btn sm' + (onApply ? ' ghost' : '')} type="button" disabled=${busy} onClick=${() => onState(j, 'saved')}>
                      <${Icon} n="star" />Save</button>`
                }
                ${
                  j.state !== 'applied' &&
                  html`<button className="btn ghost sm" type="button" disabled=${busy} title="Mark as applied without sending anything" onClick=${() => onState(j, 'applied')}>
                      <${Icon} n="check" />Applied</button>`
                }
                ${
                  j.state !== 'dismissed'
                    ? html`<button className="btn ghost sm icon" type="button" aria-label="Dismiss" title="Not interested" disabled=${busy} onClick=${() => onState(j, 'dismissed')}>
                        <${Icon} n="x" />
                      </button>`
                    : html`<button className="btn ghost sm" type="button" disabled=${busy} onClick=${() => onState(j, 'new')}>Restore</button>`
                }
              <//>`
          }
        </div>
      </div>
    </div>`;
}

function JobDescription({ id, summary }) {
  const r = useJobsApi('jobs_job&id=' + id);
  if (r.loading) return html`<${Spinner} label="Loading the job post…" />`;
  const d = r.data && r.data.job && r.data.job.description;
  return d
    ? d
    : summary || 'No description was captured for this job. Open it on the job board for the full post.';
}

/* ---------- consultant: matched jobs ---------- */
function JobsPage() {
  const P = usePortal();
  const toast = useToast();
  const [tab, setTab] = useState('new');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState(null);
  const [applyTo, setApplyTo] = useState(null);
  const sentToMe = useCol(P.prof ? `u/${P.uid}/jobs` : null, 'at:desc');
  const me = useJobsApi('jobs_me');
  const m = useJobsApi('jobs_matches&state=' + tab);
  const applyModal =
    applyTo &&
    html`<${ApplyJobModal} job=${applyTo} onClose=${() => setApplyTo(null)} onDone=${() => {
      setApplyTo(null);
      m.reload();
      me.reload();
    }} />`;
  useEffect(() => {
    if (me.data) setRun(me.data.run || null);
  }, [me.data]);
  if (!P.prof) return html`<${NeedProfile} />`;
  const canApply = !!(
    me.data &&
    me.data.consultant &&
    me.data.consultant.resumes &&
    me.data.consultant.resumes.length
  );
  const sentPanel = html`<${SentToMe} docs=${sentToMe.docs} loading=${sentToMe.loading} onApply=${canApply ? j => setApplyTo({ careers_id: j.id, title: j.ti }) : null} />`;
  if (tab === 'sent')
    return html`<div className="stack">
        <${JobsTabs} tab=${tab} setTab=${setTab} counts=${{ ...((me.data && me.data.consultant && me.data.consultant.match_counts) || {}), sent: sentToMe.docs.length }} />
        ${sentPanel}${applyModal}
      </div>`;
  if (me.error)
    return html`<div className="stack">
        <${JobsOffline} error=${me.error} />
        ${sentToMe.docs.length ? html`<${JobsTabs} tab="sent" setTab=${setTab} counts=${{ sent: sentToMe.docs.length }} />${sentPanel}` : ''}
      </div>`;
  if (!me.data) return html`<${Spinner} label="Checking your matches…" />`;
  const c = me.data.consultant;
  const banner = html`<${RunBanner} run=${run} setRun=${setRun} onDone=${() => {
    m.reload();
    me.reload();
  }} />`;
  if (!c || (!c.has_resume && !((c.prefs || {}).titles || []).length))
    return html`<div className="stack">
        ${sentToMe.docs.length ? html`<${JobsTabs} tab="sent" setTab=${setTab} counts=${{ sent: sentToMe.docs.length }} />${sentPanel}` : ''}
        <div className="panel">
          <${Empty} title="Upload your resume to see matched jobs" action=${html`<a className="btn" href="#/portal/resume">Upload resume</a>`}>
            Jobs are collected from job boards every few hours and ranked against the skills, titles and location in your resume. You can also just type the titles you want under Resume & preferences.<//>
        </div>
      </div>`;
  const setState = async (j, state) => {
    setBusy(true);
    try {
      await api('jobs_mark', { job_id: j.id, state });
      toast(
        state === 'saved'
          ? 'Saved. Find it under Saved.'
          : state === 'applied'
            ? 'Marked as applied.'
            : state === 'dismissed'
              ? 'Dismissed.'
              : 'Restored.'
      );
      m.reload();
      me.reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const refresh = async () => {
    setBusy(true);
    try {
      const r = await api('jobs_rematch', {});
      toast(
        `Matches refreshed: ${r.matches} job${r.matches === 1 ? '' : 's'} fit your resume and preferences.`
      );
      m.reload();
      me.reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const counts = c.match_counts || {};
  const ql = q.trim().toLowerCase();
  const list = ((m.data && m.data.matches) || []).filter(
    j =>
      !ql || [j.title, j.company, j.location, j.summary].filter(Boolean).join(' ').toLowerCase().includes(ql)
  );
  const last = c.last_run;
  return html`<div className="stack">
      <div className="kpis" style=${{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
        <a href="#/portal/jobs" onClick=${e => {
          e.preventDefault();
          setTab('new');
        }}>
          <b>
            ${counts.new || 0}
          </b>
          <span>New matches</span>
        </a>
        <a href="#/portal/jobs" onClick=${e => {
          e.preventDefault();
          setTab('saved');
        }}>
          <b>
            ${counts.saved || 0}
          </b>
          <span>Saved</span>
        </a>
        <a href="#/portal/jobs" onClick=${e => {
          e.preventDefault();
          setTab('applied');
        }}>
          <b>
            ${counts.applied || 0}
          </b>
          <span>Applied</span>
        </a>
        <a href="#/portal/jobs" onClick=${e => {
          e.preventDefault();
          setTab('sent');
        }}>
          <b>
            ${sentToMe.docs.length}
          </b>
          <span>Sent to you by StratEdge</span>
        </a>
      </div>
      ${banner}
      <${PlanNote} feature="apply" />
      <div className="note info">
        <span>Matched ${c.has_resume ? html`from your resume <b>${c.resume_name}</b>` : 'from your preferences'}${c.dom && ((c.dom.tech || []).length || (c.dom.ind || []).length) ? html` (domains on it: <${DomChips} dom=${c.dom} line />)` : ''}${c.profile && c.profile.titles && c.profile.titles.length ? ` as ${c.profile.titles.slice(0, 2).join(' / ')}` : ''}${c.profile && c.profile.location ? ` near ${c.profile.location}` : ''}. ${last ? `Last job collection ${fmtTs(last.finished_at || last.started_at)}${last.jobs_new ? `, ${last.jobs_new} new jobs` : ''}.` : 'The first job collection has not run yet.'}
        </span>
        <div className="actions">
          <a className="btn ghost sm" href="#/portal/resume">Edit resume & preferences</a>
          <button className="btn ghost sm" type="button" disabled=${busy} onClick=${refresh}>
            <${Icon} n="refresh" />Refresh matches</button>
        </div>
      </div>
      <${JobsTabs} tab=${tab} setTab=${setTab} counts=${{ ...counts, sent: sentToMe.docs.length }} />
      ${m.data && m.data.hidden > 0 && html`<p className="muted small" style=${{ margin: '0 2px' }}>${m.data.hidden} matched role${m.data.hidden === 1 ? ' is' : 's are'} not shown: ${m.data.hidden === 1 ? 'its' : 'their'} engagement type is not open to your consultant type${CT_NAMES[m.data.ct] ? ' (' + CT_NAMES[m.data.ct] + ')' : ''}. Ask your StratEdge recruiter if you want to be considered for more types.</p>`}
      <div className="toolbar">
        <input style=${{ maxWidth: 360 }} type="search" placeholder="Filter by title, company or location" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Filter jobs" />
      </div>
      ${
        m.error
          ? html`<${JobsOffline} error=${m.error} />`
          : m.loading
            ? html`<${Spinner} />`
            : list.length
              ? html`<div className="matches">
                  ${list.map(j => html`<${JobRow} key=${j.id} j=${j} onState=${setState} onApply=${canApply ? x => setApplyTo({ job_id: x.id, title: x.title }) : null} onBotQueue=${async x => {
                    // v35: straight into the Application bot queue in the portal
                    try {
                      await api('ab_job_save', { url: x.url, title: x.title, company: x.company || x.portal || 'Employer', location: x.location || '', description: x.description || x.summary || '', approved: false, src: 'match' });
                      toast('Added to your application bot queue. Approve it there after reading it.');
                    } catch (e) {
                      toast(errText(e), true);
                    }
                  }} onBotApply=${async x => {
                    // v35: one click: queue it approved and open the bot, which runs it once the companion answers
                    try {
                      const r = await api('ab_job_save', { url: x.url, title: x.title, company: x.company || x.portal || 'Employer', location: x.location || '', description: x.description || x.summary || '', approved: true, src: 'match' });
                      location.hash = growHref(P, 'appbot') + '?run=' + r.job.id; // stay in the portal in use
                    } catch (e) {
                      if (/already in your queue/.test(e.message || '')) location.hash = growHref(P, 'appbot');
                      else toast(errText(e), true);
                    }
                  }} busy=${busy} tailorHref=${x => growHref(P, 'tailor') + '?job=' + x.id} />`)}
                </div>`
              : html`<div className="panel">
                  <${Empty} title=${tab === 'new' ? (ql ? 'No matches for that filter' : 'No new matches yet') : `Nothing under ${MATCH_STATES[tab]}`}>
                    ${tab === 'new' && !ql ? (runLive(run) ? 'A collection is running right now; matches appear when it finishes.' : 'Jobs are collected every few hours. Add more titles or locations under Resume & preferences to widen the search.') : ''}
                  <//>
                </div>`
      }
      ${applyModal}
    </div>`;
}

/* ---------- consultant: one-click apply ---------- */
function ApplyJobModal({ job, onClose, onDone }) {
  const toast = useToast();
  const prep = useJobsApi(
    job.careers_id
      ? 'jobs_apply_prep&careers=' + encodeURIComponent(job.careers_id)
      : 'jobs_apply_prep&id=' + job.job_id
  );
  const [rid, setRid] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  // v32: the placement fee an outside consultant or student agrees to, and what stops an application
  const [feeOk, setFeeOk] = useState(false);
  const [stop, setStop] = useState(null);
  useEffect(() => {
    if (prep.data) {
      const b =
        prep.data.resumes.find(r => r.best) || prep.data.resumes.find(r => r.active) || prep.data.resumes[0];
      setRid(b ? b.id : 0);
      setNote(prep.data.note || '');
    }
  }, [prep.data]);
  const send = async () => {
    setBusy(true);
    try {
      const r = await api('jobs_apply', {
        job_id: job.job_id || 0,
        careers_id: job.careers_id || '',
        resume_id: rid,
        note,
        feeOk,
      });
      setDone(r);
      toast(
        r.how === 'email'
          ? `Sent to ${r.to}.`
          : r.how === 'careers'
            ? r.again
              ? 'Added to your earlier application.'
              : 'Application sent to StratEdge.'
            : 'Sent to the StratEdge recruiting team.'
      );
    } catch (e) {
      if (e && ['blocked', 'membership', 'fee'].includes(e.code)) setStop({ code: e.code, msg: errText(e) });
      else toast(errText(e), true);
    }
    setBusy(false);
  };
  const d = prep.data;
  const fee = d && d.fee && d.fee.fee;
  const blocked = d && (d.blocked || (stop && stop.code === 'blocked' && stop.msg));
  const locked = d && (d.locked || (stop && stop.code === 'membership' && stop.msg));
  const foot = done
    ? html`<button className="btn" onClick=${onDone}>Done</button>`
    : html`<button className="btn ghost" onClick=${onClose}>Cancel</button>
      <button className="btn" disabled=${busy || !d || !rid || !!blocked || !!locked || (!!fee && !feeOk)} onClick=${send}>
        <${Icon} n="send" />
        ${busy ? 'Sending…' : 'Send application'}
      </button>`;
  return html`<${Modal} title=${'Apply: ' + job.title} onClose=${done ? onDone : onClose} foot=${foot}>
      ${
        prep.error
          ? html`<${JobsOffline} error=${prep.error} />`
          : !d
            ? html`<${Spinner} label="Preparing your application…" />`
            : done
              ? html`<div className="stack">
                  <div className="note ok">
                    <span>
                      ${
                        done.how === 'email'
                          ? html`<b>Sent.</b> Your resume "${done.resume}" was emailed to <b>
                              ${done.to}
                            </b>, the contact named in the posting${done.team ? ', with the StratEdge recruiting team in copy' : ''}. Replies go to your email.`
                          : done.how === 'careers'
                            ? done.again
                              ? html`<b>You had already applied for this role.</b> We added your resume "${done.resume}" to your application.`
                              : html`<b>Application received.</b> Your resume "${done.resume}" is with StratEdge's recruiting team.`
                            : html`<b>Sent to the StratEdge recruiting team.</b> They will submit you with your resume "${done.resume}" and keep you posted.${done.team ? '' : ' (No recruiting team address is set up yet; it is listed under Applications for the team.)'}`
                      }
                    </span>
                  </div>
                  ${done.how === 'queue' && d.job.url && !d.careers ? html`<p className="muted small">You can also apply on the job board yourself: <a href=${d.job.url} target="_blank" rel="noopener noreferrer">open the posting</a>.</p>` : ''}
                </div>`
              : html`<div className="form">
                  <div className="note info">
                    <span>
                      ${
                        d.careers
                          ? 'This is a StratEdge role: your application and resume go straight to our recruiting team.'
                          : d.email
                            ? html`The posting names a contact, <b>
                                ${d.email}
                              </b>. Your resume and note are emailed there from the StratEdge portal, with replies going to you${d.team ? ' and the recruiting team in copy' : ''}.`
                            : html`The posting has no contact address, so your resume and note go to StratEdge's recruiting team, who submit you to the vendor. ${d.job.url ? html`You can also <a href=${d.job.url} target="_blank" rel="noopener noreferrer">apply on the job board</a> yourself.` : ''}`
                      }
                    </span>
                  </div>
                  ${blocked && html`<div className="note red"><span><b>This role is not open to you.</b> ${d.blocked ? d.blocked + '.' : blocked} Your StratEdge recruiter can allow it for you if that is a mistake.</span></div>`}
                  ${locked && html`<div className="note amber"><span><b>${locked}</b> Choose or renew a plan to apply through StratEdge.</span><div className="actions"><a className="btn sm" href=${'#/portal/' + (Cap.ct === 'student' ? 'student/plan' : 'consultant/membership')}>${Cap.ct === 'student' ? 'Plans & payments' : 'Membership & fees'}</a></div></div>`}
                  ${
                    fee &&
                    html`<div className=${'feebox' + (feeOk ? ' ok' : '')}>
                      <b>Placement fee for ${d.fee.eng} roles</b>
                      <p>${fee}.</p>
                      <label className="check"><input type="checkbox" checked=${feeOk} onChange=${e => setFeeOk(e.target.checked)} /><span>I agree to this placement fee if StratEdge places me in this role.</span></label>
                    </div>`
                  }
                  ${
                    !d.resumes.length
                      ? html`<p className="err">Upload a resume under Resume & preferences first.</p>`
                      : html`<div className="fld">
                          <span>Resume to send</span>
                          <div className="picklist">
                            ${d.resumes.map(
                              r => html`<label key=${r.id} className=${'pick' + (rid === r.id ? ' on' : '')}>
                                  <input type="radio" name="rid" checked=${rid === r.id} onChange=${() => setRid(r.id)} />
                                  <span>
                                    <b>
                                      ${r.label}${r.best ? ' · best fit' : r.active ? ' · used for matching' : ''}
                                    </b>
                                    <small>
                                      ${[r.titles.slice(0, 2).join(', '), r.name].filter(Boolean).join(' · ')}
                                    </small>
                                  </span>
                                </label>`
                            )}
                          </div>
                        </div>`
                  }
                  <${Field} label="Note to the recruiter" hint="Sent with your resume. Edit it as you like.">
                    <textarea rows="7" value=${note} onInput=${e => setNote(e.target.value)} />
                  <//>
                </div>`
      }
    <//>`;
}

function JobsCard() {
  const r = useJobsApi('jobs_matches&state=new');
  if (r.error || r.loading) return null;
  const list = ((r.data && r.data.matches) || []).slice(0, 3);
  return html`<section className="panel">
      <div className="ph-row">
        <h2 className="ph">Matched jobs</h2>
        <a className="btn ghost sm" href="#/portal/jobs">
          ${(r.data && r.data.counts && r.data.counts.new) || 0} new</a>
      </div>
      ${
        list.length
          ? html`<ul className="list">
              ${list.map(
                j => html`<li key=${j.id}>
                    <div style=${{ minWidth: 0 }}>
                      <div className="t">
                        <a href=${j.url} target="_blank" rel="noopener noreferrer">
                          ${j.title}
                        </a>
                      </div>
                      <div className="m">
                        ${[j.company, j.location, j.portal].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <${ScoreMeter} n=${j.score} />
                  </li>`
              )}
            </ul>`
          : html`<p className="muted small">No new matches yet. <a href="#/portal/resume">Upload or update your resume</a> to get jobs matched from the job boards StratEdge collects from.</p>`
      }
    </section>`;
}

/* ---------- consultant: resume and preferences ---------- */
let pdfjsLoad = null;
function loadPdfJs() {
  // PDF.js is self-hosted under js/vendor/pdfjs and only loaded when a PDF resume is chosen
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!pdfjsLoad)
    pdfjsLoad = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/pdfjs/pdf.min.js';
      s.onload = () => {
        try {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdfjs/pdf.worker.min.js';
          res(window.pdfjsLib);
        } catch (e) {
          rej(e);
        }
      };
      s.onerror = () => {
        pdfjsLoad = null;
        rej(new Error('PDF reader did not load'));
      };
      document.head.appendChild(s);
    });
  return pdfjsLoad;
}
async function pdfTextOf(file) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
  let out = '';
  try {
    for (let i = 1; i <= Math.min(doc.numPages, 15); i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      let line = '',
        lastY = null,
        lastX = null;
      for (const it of tc.items) {
        if (typeof it.str !== 'string') continue;
        const x = it.transform[4],
          y = it.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 2.5) {
          out += line.trimEnd() + '\n';
          line = '';
        } else if (
          lastX !== null &&
          x - lastX > 1.5 &&
          line &&
          !line.endsWith(' ') &&
          !it.str.startsWith(' ')
        )
          line += ' ';
        line += it.str;
        lastY = y;
        lastX = x + (it.width || 0);
        if (it.hasEOL) {
          out += line.trimEnd() + '\n';
          line = '';
          lastY = null;
          lastX = null;
        }
      }
      out += line.trimEnd() + '\n\n';
    }
  } finally {
    try {
      doc.destroy();
    } catch (e) {
      /* ignore */
    }
  }
  return out;
}
function ResumePage() {
  const P = usePortal();
  const toast = useToast();
  const me = useJobsApi('jobs_me');
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);
  const [f, setF] = useState(null);
  const [run, setRun] = useState(null);
  const [label, setLabel] = useState('');
  const [makeActive, setMakeActive] = useState(false);
  const [edit, setEdit] = useState(null);
  const c = me.data && me.data.consultant;
  const resumes = (c && c.resumes) || [];
  useEffect(() => {
    if (c && !f) {
      const p = c.prefs || {};
      setF({
        titles: listStr(p.titles),
        locations: listStr(p.locations),
        remote: p.remote || 'any',
        job_types: p.job_types || [],
        skills: listStr(p.skills),
        keywords: listStr(p.keywords),
        exclude: listStr(p.exclude),
      });
    }
    if (me.data && !c && !f)
      setF({
        titles: '',
        locations: '',
        remote: 'any',
        job_types: [],
        skills: '',
        keywords: '',
        exclude: '',
      });
  }, [me.data]);
  if (!P.prof) return html`<${NeedProfile} />`;
  if (me.error) return html`<${JobsOffline} error=${me.error} />`;
  if (!f) return html`<${Spinner} label="Loading your resume profile…" />`;
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const onFiles = async fs => {
    const file = fs[0];
    const ext = extOf(file.name);
    if (!['pdf', 'docx', 'txt'].includes(ext)) {
      toast('Upload your resume as PDF, Word (.docx) or plain text.', true);
      return;
    }
    if (file.size > MAX_FILE) {
      toast(`That file is ${sizeLabel(file.size)}. The limit is 10 MB.`, true);
      return;
    }
    if (resumes.length >= 6) {
      toast('You can keep up to 6 resumes. Delete one first.', true);
      return;
    }
    setBusy(true);
    setProg(0.03);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      if (label.trim()) fd.append('label', label.trim());
      if (makeActive || !resumes.length) fd.append('active', '1');
      if (ext === 'pdf') {
        try {
          const text = await pdfTextOf(file);
          if (text.trim().length > 50) fd.append('text', text.slice(0, 200000));
        } catch (e) {
          /* the server reads it instead */
        }
      }
      const r = await upload('jobs_resume', fd, setProg);
      Sync.kick();
      const prof =
        r.consultant && r.consultant.resumes && r.consultant.resumes.find(x => x.id === r.resume_id);
      if (r.read && r.read.chars < 120)
        toast(
          'The file was saved, but no text could be read from it (a scanned image?). Add your titles and skills in the preferences so matching can work.',
          true
        );
      else
        toast(
          `Resume added${prof ? ': ' + prof.skills + ' skills' + (prof.titles.length ? ', ' + prof.titles[0] : '') : ''}${r.active ? '; it is now used for matching' : ''}.`
        );
      if (r.run) setRun(r.run);
      setLabel('');
      setMakeActive(false);
      me.reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
    setProg(0);
  };
  const act = async (id, op, extra) => {
    setBusy(true);
    try {
      const r = await api('jobs_resume_edit', { id, op, ...(extra || {}) });
      if (op === 'activate')
        toast(`Matching now uses that resume. ${r.matches} job${r.matches === 1 ? '' : 's'} match.`);
      if (op === 'delete') toast('Resume removed.');
      if (op === 'rename') toast('Renamed.');
      if (r.run) setRun(r.run);
      setEdit(null);
      me.reload();
      Sync.kick();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const save = async e => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api('jobs_prefs', { prefs: f });
      toast(`Preferences saved. ${r.matches} job${r.matches === 1 ? '' : 's'} match right now.`);
      if (r.run) setRun(r.run);
      me.reload();
    } catch (x) {
      toast(errText(x), true);
    }
    setBusy(false);
  };
  const toggleType = t =>
    setF({
      ...f,
      job_types: f.job_types.includes(t) ? f.job_types.filter(x => x !== t) : [...f.job_types, t],
    });
  const prof = (c && c.profile) || {};
  const activeR = resumes.find(r => r.active);
  return html`<div className="stack">
      <${RunBanner} run=${run} setRun=${setRun} onDone=${() => me.reload()} />
      <div className="g2" style=${{ alignItems: 'start' }}>
        <div className="stack">
          <section className="panel stack" style=${{ gap: 14 }}>
            <div>
              <h2 className="ph">Your resumes</h2>
              <p className="muted small" style=${{ marginTop: 4 }}>Keep up to 6 versions, for example one per role you target. One of them drives your job matching; when you apply, the best-fitting one is suggested and you can pick any.</p>
              ${c && c.dom && ((c.dom.tech || []).length || (c.dom.ind || []).length) ? html`<div className="small" style=${{ marginTop: 6 }}>Domains recognized on the resume used for matching (recruiters find you by these): <${DomChips} dom=${c.dom} small /></div>` : ''}
            </div>
            ${
              resumes.length
                ? html`<ul className="list resumes">
                    ${resumes.map(
                      r => html`<li key=${r.id}>
                          <div style=${{ minWidth: 0 }}>
                            ${
                              edit && edit.id === r.id
                                ? html`<div style=${{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    <input value=${edit.label} onInput=${e => setEdit({ ...edit, label: e.target.value })} style=${{ maxWidth: 260 }} />
                                    <button className="btn sm" type="button" disabled=${busy} onClick=${() => act(r.id, 'rename', { label: edit.label })}>Save</button>
                                    <button className="btn ghost sm" type="button" onClick=${() => setEdit(null)}>Cancel</button>
                                  </div>`
                                : html`<div className="t">${r.label} ${r.active ? html`<${Chip} s="ok">Used for matching<//>` : ''}</div>`
                            }
                            <div className="m">
                              ${[r.name, fmtTs(r.at), r.titles.length ? r.titles.slice(0, 2).join(', ') : '', r.skills ? r.skills + ' skills' : ''].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                          <div className="actions" style=${{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                            ${!r.active && html`<button className="btn ghost sm" type="button" disabled=${busy} onClick=${() => act(r.id, 'activate')}>Use for matching</button>`}
                            <button className="btn ghost sm" type="button" disabled=${busy} onClick=${() => setEdit({ id: r.id, label: r.label })}>Rename</button>
                            <button className="btn ghost sm" type="button" disabled=${busy} onClick=${() => downloadStored(`u/${P.uid}`, r.fid).catch(() => {})}>Download</button>
                            <button className="btn ghost sm icon" type="button" aria-label="Delete" disabled=${busy} onClick=${() => {
                              if (confirm(`Delete the resume "${r.label}"?`)) act(r.id, 'delete');
                            }}>
                              <${Icon} n="trash" />
                            </button>
                          </div>
                        </li>`
                    )}
                  </ul>`
                : ''
            }
            <div className="form" style=${{ gap: 8 }}>
              <div className="row2">
                <${Field} label=${resumes.length ? 'Name for the next resume (optional)' : 'Name for this resume (optional)'}>
                  <input value=${label} onInput=${e => setLabel(e.target.value)} placeholder="e.g. SAP FICO resume" />
                <//>
                ${
                  resumes.length
                    ? html`<label className="check" style=${{ alignSelf: 'end', paddingBottom: 12 }}>
                        <input type="checkbox" checked=${makeActive} onChange=${e => setMakeActive(e.target.checked)} />
                        <span>Use the new one for matching</span>
                      </label>`
                    : ''
                }
              </div>
              <${FilePick} busy=${busy} progress=${prog} onFiles=${onFiles} label=${resumes.length ? 'Drop another resume here, or choose it from your device.' : 'Drop your resume here, or choose it from your device.'} hint="PDF, Word (.docx) or text, up to 10 MB." />
            </div>
          </section>
          ${
            activeR &&
            html`<section className="panel stack" style=${{ gap: 10 }}>
                <h2 className="ph">What we read from "${activeR.label}"</h2>
                <dl className="kv">
                  <dt>Titles</dt>
                  <dd>
                    ${(prof.titles || []).join(', ') || '—'}
                  </dd>
                  <dt>Experience</dt>
                  <dd>
                    ${prof.years ? prof.years + ' years' : '—'}${prof.seniority ? ', ' + prof.seniority.toLowerCase() : ''}
                  </dd>
                  <dt>Location</dt>
                  <dd>
                    ${prof.location || '—'}
                  </dd>
                  <dt>Skills</dt>
                  <dd>
                    <div className="meta" style=${{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      ${(prof.skills || []).slice(0, 30).map(s => html`<${Chip} key=${s}>${s}<//>`)}${(prof.skills || []).length > 30 ? html`<span className="muted small">+${prof.skills.length - 30} more</span>` : ''}
                    </div>
                  </dd>
                </dl>
                <p className="muted small">Not quite right? Add the titles and skills you want to be matched on in the preferences; they take priority over what the resume says.</p>
              </section>`
          }
        </div>
        <form className="panel form" onSubmit=${save}>
          <h2 className="ph">Job preferences</h2>
          <${Field} label="Titles to search for" hint="Comma-separated, e.g. SAP FICO Consultant, S/4HANA Finance Lead. Leave empty to use the titles from your resume.">
            <input value=${f.titles} onInput=${up('titles')} />
          <//>
          <${Field} label="Locations" hint="Comma-separated cities or states, e.g. Edison, NJ; Remote. Your resume location is used when empty.">
            <input value=${f.locations} onInput=${up('locations')} />
          <//>
          <${Field} label="Work mode">
            <select value=${f.remote} onChange=${up('remote')}>
              ${REMOTE_OPTS.map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}
            </select>
          <//>
          <div className="fld">
            <span>Engagement types</span>
            <div className="meta" style=${{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              ${JOB_TYPES.map(
                t => html`<label key=${t} className=${'pillbtn' + (f.job_types.includes(t) ? ' on' : '')}>
                    <input type="checkbox" hidden checked=${f.job_types.includes(t)} onChange=${() => toggleType(t)} />
                    ${t}
                  </label>`
              )}
            </div>
            <small>Leave all unticked to see every type.</small>
          </div>
          <${Field} label="Extra skills" hint="Skills to match on that may be missing from the resume.">
            <input value=${f.skills} onInput=${up('skills')} />
          <//>
          <${Field} label="Must-have words" hint="Jobs mentioning these rank higher, e.g. implementation, healthcare.">
            <input value=${f.keywords} onInput=${up('keywords')} />
          <//>
          <${Field} label="Exclude words" hint="Jobs mentioning these are hidden, e.g. clearance, relocation.">
            <input value=${f.exclude} onInput=${up('exclude')} />
          <//>
          <div className="actions">
            <button className="btn" disabled=${busy}>
              ${busy ? 'Saving…' : 'Save preferences'}
            </button>
            <a className="btn ghost" href="#/portal/jobs">See matched jobs</a>
          </div>
        </form>
      </div>
    </div>`;
}

/* ---------- staff: Job portals (grabber, sources, runs, jobs, consultants) ---------- */
function JobPortalsAdmin({ initialTab }) {
  const [tab, setTab] = useState(initialTab || 'grab');
  const [run, setRun] = useState(null);
  const ov = useJobsApi('jobs_admin&op=overview');
  useEffect(() => {
    if (ov.data) setRun(ov.data.run || null);
  }, [ov.data]);
  if (ov.error) return html`<div className="stack"><${JobsOffline} error=${ov.error} /><${JobsHelp} /></div>`;
  if (!ov.data) return html`<${Spinner} label="Loading job matching…" />`;
  const o = ov.data;
  const last = o.last_run;
  const staff = o.staff !== false;
  const toSubmit = (o.apps && o.apps.new) || 0;
  const started = r => {
    setRun(r);
    ov.reload();
  };
  const tabs = [
    ['grab', 'Job grabber'],
    ['apps', 'Applications' + (toSubmit ? ` (${toSubmit})` : '')],
    ...(staff ? [['sources', 'Sources']] : []),
    ['runs', 'Collection runs'],
    ['jobs', 'Collected jobs'],
    ['consultants', 'Consultant matches'],
    ['profiles', 'Apply profiles'],
  ];
  return html`<div className="stack">
      <div className="kpis">
        <a href="#" onClick=${e => {
          e.preventDefault();
          setTab('apps');
        }}>
          <b>
            ${toSubmit}
          </b>
          <span>Applications to submit</span>
        </a>
        <a href="#" onClick=${e => {
          e.preventDefault();
          setTab('jobs');
        }}>
          <b>
            ${o.jobs}
          </b>
          <span>Jobs collected (${o.jobs_7d} this week)</span>
        </a>
        <a href="#" onClick=${e => {
          e.preventDefault();
          setTab('consultants');
        }}>
          <b>
            ${o.consultants_with_resume}
          </b>
          <span>Consultants with a resume</span>
        </a>
        <a href="#" onClick=${e => {
          e.preventDefault();
          setTab('runs');
        }}>
          <b>
            ${runLive(run) ? 'Running' : last ? RUN_STATUS[last.status] || last.status : '—'}
          </b>
          <span>
            ${last ? 'Last collection ' + fmtTs(last.finished_at || last.started_at) : 'No collection yet'}
          </span>
        </a>
        <a href="#" onClick=${e => {
          e.preventDefault();
          setTab(staff ? 'sources' : 'runs');
        }}>
          <b>
            ${o.sources_on}
          </b>
          <span>Job sources in use${o.schedule_hours > 0 ? ', every ' + (o.schedule_hours >= 1 ? o.schedule_hours + 'h' : Math.round(o.schedule_hours * 60) + 'm') : ''}
          </span>
        </a>
      </div>
      <${RunBanner} run=${run} setRun=${setRun} admin=${true} onDone=${() => ov.reload()} />
      <div className="tabs" role="tablist">
        ${tabs.map(
          ([
            k,
            v,
          ]) => html`<button key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>
              ${v}
            </button>`
        )}
      </div>
      ${tab === 'grab' && html`<${JobGrabber} o=${o} run=${run} onStart=${started} />`}
      ${tab === 'apps' && html`<${ApplicationsTab} reload=${ov.reload} />`}
      ${tab === 'sources' && staff && html`<${SourcesTab} reload=${ov.reload} />`}
      ${tab === 'runs' && html`<${RunsTab} o=${o} run=${run} onStart=${started} />`}
      ${tab === 'jobs' && html`<${CollectedJobs} o=${o} />`}
      ${tab === 'consultants' && html`<${ConsultantMatches} />`}
      ${tab === 'profiles' && html`<${ApplyProfilesTab} />`}
    </div>`;
}
const APP_STATUS = {
  new: 'To submit',
  sent: 'Emailed to recruiter',
  ats: 'StratEdge role (ATS)',
  submitted: 'Submitted',
  closed: 'Closed',
};
function ApplicationsTab({ reload }) {
  const toast = useToast();
  const [status, setStatus] = useState('new');
  const [busy, setBusy] = useState(0);
  const [open, setOpen] = useState(null);
  const r = useJobsApi('jobs_admin&op=apps&status=' + status);
  const set = async (a, st) => {
    setBusy(a.id);
    try {
      await api('jobs_admin', { op: 'app_set', id: a.id, status: st });
      toast(st === 'submitted' ? 'Marked as submitted.' : 'Updated.');
      r.reload();
      reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(0);
  };
  const counts = (r.data && r.data.counts) || {};
  return html`<${Fragment}>
      <div className="note info">
        <span>
          <b>One-click applications from consultants.</b> When a posting names a recruiter, the consultant's resume is emailed there directly (status "Emailed"). When it doesn't, the request lands here for recruiting team to submit. StratEdge roles go straight to the ATS.</span>
      </div>
      <div className="tabs" role="tablist">
        ${Object.entries(APP_STATUS).map(
          ([
            k,
            v,
          ]) => html`<button key=${k} role="tab" aria-selected=${status === k} className=${status === k ? 'on' : ''} onClick=${() => setStatus(k)}>
              ${v}
              <span className=${'chip' + (k === 'new' && counts.new ? ' amber' : '')}>
                ${counts[k] || 0}
              </span>
            </button>`
        )}
        <button role="tab" aria-selected=${status === ''} className=${status === '' ? 'on' : ''} onClick=${() => setStatus('')}>All</button>
      </div>
      <section className="panel" style=${{ padding: '6px 8px' }}>
        ${
          r.loading && !r.data
            ? html`<${Spinner} />`
            : r.error
              ? html`<${JobsOffline} error=${r.error} />`
              : r.data.apps.length
                ? html`<div className="tblwrap">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>When</th>
                          <th>Consultant</th>
                          <th>Job</th>
                          <th>Resume</th>
                          <th>How</th>
                          <th>Status</th>
                          <th className="r">
                            <span className="sr">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        ${r.data.apps.map(
                          a => html`<tr key=${a.id}>
                              <td className="small">
                                ${fmtTs(a.at)}
                              </td>
                              <td>
                                <b style=${{ fontWeight: 600 }}>
                                  ${a.name || a.uid}
                                </b>
                                <div className="muted small">
                                  ${a.email}
                                </div>
                              </td>
                              <td>
                                <a href=${a.url} target="_blank" rel="noopener noreferrer">
                                  ${a.title}
                                </a>
                                ${a.company ? html`<div className="muted small">${a.company}</div>` : ''}
                              </td>
                              <td className="small">
                                <a href=${'api/index.php?r=jobs_admin&op=app_resume&id=' + a.id} download>
                                  ${a.resume || 'Resume'}
                                </a>
                              </td>
                              <td className="small">
                                ${a.how === 'email' ? 'Emailed to ' + a.to : a.how === 'careers' ? 'StratEdge role, in the ATS' : 'Needs submission'}
                              </td>
                              <td>
                                <${Chip} s=${a.status === 'new' ? 'amber' : a.status === 'submitted' || a.status === 'sent' ? 'ok' : a.status === 'closed' ? 'inactive' : 'new'}>
                                  ${APP_STATUS[a.status] || a.status}
                                <//>
                                ${a.updated_by ? html`<div className="muted small">by ${a.updated_by}</div>` : ''}
                              </td>
                              <td className="r">
                                <div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                                  <button className="btn ghost sm" onClick=${() => setOpen(a)}>Note</button>
                                  ${a.status !== 'submitted' && a.status !== 'closed' && html`<button className="btn sm" disabled=${busy === a.id} onClick=${() => set(a, 'submitted')}>Mark submitted</button>`}${a.status !== 'closed' && html`<button className="btn ghost sm" disabled=${busy === a.id} onClick=${() => set(a, 'closed')}>Close</button>`}${a.status === 'closed' && html`<button className="btn ghost sm" disabled=${busy === a.id} onClick=${() => set(a, 'new')}>Reopen</button>`}
                                </div>
                              </td>
                            </tr>`
                        )}
                      </tbody>
                    </table>
                  </div>`
                : html`<${Empty} title=${status === 'new' ? 'Nothing waiting to be submitted' : 'No applications here'}>Consultants apply from their Matched jobs page with one click; applications appear here.<//>`
        }
      </section>
      ${
        open &&
        html`<${Modal} title=${open.title} onClose=${() => setOpen(null)}>
            <dl className="kv">
              <dt>Consultant</dt>
              <dd>
                ${open.name} · ${open.email}
              </dd>
              <dt>Resume</dt>
              <dd>
                <a href=${'api/index.php?r=jobs_admin&op=app_resume&id=' + open.id} download>
                  ${open.resume}
                </a>
              </dd>
              <dt>Job</dt>
              <dd>
                <a href=${open.url} target="_blank" rel="noopener noreferrer">
                  ${open.title}
                </a>
                ${open.company ? ' · ' + open.company : ''}
              </dd>
              ${open.to && html`<dt>Emailed to</dt><dd>${open.to}</dd>`}
              <dt>Their note</dt>
              <dd style=${{ whiteSpace: 'pre-wrap' }}>
                ${open.note}
              </dd>
            </dl>
          <//>`
      }
    <//>`;
}
function BenchCard() {
  const r = useJobsApi('jobs_admin&op=overview');
  if (r.error || !r.data) return null;
  const o = r.data;
  const n = (o.apps && o.apps.new) || 0;
  return html`<section className="panel">
      <div className="ph-row">
        <h2 className="ph">Recruiting queue</h2>
        <a className="btn ghost sm" href="#/portal/employee/bench">Open job grabber</a>
      </div>
      <div className="kpis" style=${{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
        <a href="#/portal/employee/bench">
          <b>
            ${n}
          </b>
          <span>Applications to submit</span>
        </a>
        <a href="#/portal/employee/bench">
          <b>
            ${o.consultants_with_resume}
          </b>
          <span>Consultants with a resume</span>
        </a>
        <a href="#/portal/employee/bench">
          <b>
            ${o.jobs_7d}
          </b>
          <span>Jobs collected this week</span>
        </a>
      </div>
    </section>`;
}
const JobsHelp = () => html`<section className="panel stack" style=${{ gap: 8 }}>
    <h2 className="ph">How job matching works</h2>
    <p className="muted small">Jobs are collected from the sources turned on under Sources (job-board APIs that publish listings for this purpose, plus any RSS/JSON feed you add), every few hours and whenever you grab jobs by keyword. Each posting is ranked against every consultant's resume and preferences. Nothing logs in to Dice, LinkedIn, Indeed or Monster with a password: those sites block automated logins and ban accounts; listings from them come through the JSearch (Google for Jobs) and Jooble sources instead.</p>
  </section>`;

function SourceCard({ s, reload }) {
  const toast = useToast();
  const [f, setF] = useState(() => Object.fromEntries(s.fields.map(x => [x.k, x.secret ? '' : x.value])));
  const [perRun, setPerRun] = useState(s.per_run);
  const [cap, setCap] = useState(s.month ? s.month.cap : 0);
  const [country, setCountry] = useState(s.country || 'us');
  const [busy, setBusy] = useState(null);
  const [test, setTest] = useState(null);
  const call = async (body, msg) => {
    setBusy(body.op);
    try {
      const r = await api('jobs_admin', { key: s.key, ...body });
      msg && toast(msg);
      reload();
      return r;
    } catch (e) {
      toast(errText(e), true);
      reload();
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    const fields = {};
    s.fields.forEach(x => {
      if (f[x.k] && f[x.k].trim()) fields[x.k] = f[x.k].trim();
    });
    const r = await call(
      { op: 'source_save', fields, per_run: perRun, month_cap: cap || undefined, country },
      null
    );
    if (r) {
      toast(`${s.name} saved.`);
      setF(Object.fromEntries(s.fields.map(x => [x.k, x.secret ? '' : fields[x.k] || f[x.k]])));
    }
  };
  const toggle = async () => {
    const r = await call({ op: 'source_save', on: !s.on }, null);
    if (r) toast(r.on ? `${s.name} is on. Click Test to check it.` : `${s.name} is off.`);
  };
  const runTest = async () => {
    setTest(null);
    setBusy('test');
    try {
      const r = await api('jobs_admin', { op: 'source_test', key: s.key });
      setTest(r);
      reload();
    } catch (e) {
      setTest({ ok: false, error: errText(e) });
    }
    setBusy(null);
  };
  const st = s.status;
  return html`<div className="panel stack srccard" style=${{ gap: 10 }}>
      <div className="ph-row" style=${{ marginBottom: 0 }}>
        <h3 className="ph" style=${{ margin: 0 }}>
          ${s.name}
        </h3>
        <div className="meta" style=${{ margin: 0, display: 'flex', gap: 6 }}>
          <${Chip}>
            ${s.cost}
          <//>
          ${s.remote && html`<${Chip}>Remote jobs<//>`}${s.on && s.ready ? html`<${Chip} s="ok">On<//>` : html`<${Chip} s="inactive">Off<//>`}
        </div>
      </div>
      <p className="muted small" style=${{ margin: 0 }}>
        ${s.about} ${s.link && html`<a href=${s.link} target="_blank" rel="noopener noreferrer">${s.fields.length ? 'Get a key' : 'Website'}</a>`}
      </p>
      ${
        s.fields.length
          ? html`<div className="form" style=${{ gap: 8 }}>
              ${s.fields.map(
                x => html`<${Field} key=${x.k} label=${x.label + (x.secret && x.set ? ' (saved: ' + x.value + ')' : '')}>
                    <input value=${f[x.k]} onInput=${e => setF({ ...f, [x.k]: e.target.value })} placeholder=${x.secret && x.set ? 'Leave empty to keep the saved key' : ''} autoComplete="off" />
                  <//>`
              )}
              <div className="row2">
                ${
                  s.kind === 'search' &&
                  html`<${Field} label="Searches per collection" hint="Each consultant title and location is one search.">
                      <input type="number" min="1" max="100" value=${perRun} onInput=${e => setPerRun(+e.target.value || 1)} />
                    <//>`
                }
                ${
                  s.month &&
                  html`<${Field} label="Monthly search limit" hint=${`Used this month: ${s.month.used}. Set it to your plan's limit.`}>
                      <input type="number" min="1" max="100000" value=${cap} onInput=${e => setCap(+e.target.value || 1)} />
                    <//>`
                }
                ${
                  s.key === 'adzuna' &&
                  html`<${Field} label="Country code">
                      <input value=${country} onInput=${e => setCountry(e.target.value)} maxLength="2" style=${{ maxWidth: 90 }} />
                    <//>`
                }
              </div>
            </div>`
          : s.kind === 'search'
            ? html`<div className="row2">
                <${Field} label="Searches per collection">
                  <input type="number" min="1" max="100" value=${perRun} onInput=${e => setPerRun(+e.target.value || 1)} />
                <//>
              </div>`
            : ''
      }
      ${st && (st.error ? html`<p className="err small" style=${{ margin: 0 }}>Last problem ${fmtTs(st.err_at)}: ${st.error}</p>` : st.ok_at ? html`<p className="small" style=${{ margin: 0, color: 'var(--teal-ink)' }}>Last worked ${fmtTs(st.ok_at)} (${st.n} jobs).</p>` : '')}
      ${
        test &&
        html`<div className=${'note ' + (test.ok ? 'ok' : 'red')}>
            <span>
              ${test.ok ? html`<b>Works.</b> ${test.n} job${test.n === 1 ? '' : 's'} for "software engineer"${test.sample && test.sample.length ? ': ' + test.sample.slice(0, 3).join('; ') : ''}` : html`<b>Not working.</b> ${test.error}`}
            </span>
          </div>`
      }
      <div className="actions">
        ${
          (s.fields.length || s.kind === 'search') &&
          html`<button className="btn sm" type="button" disabled=${!!busy} onClick=${save}>
              ${busy === 'source_save' ? 'Saving…' : 'Save'}
            </button>`
        }
        <button className=${'btn sm' + (s.on ? ' ghost' : '')} type="button" disabled=${!!busy} onClick=${toggle}>
          ${s.on ? 'Turn off' : 'Turn on'}
        </button>
        <button className="btn ghost sm" type="button" disabled=${!!busy || !s.ready} onClick=${runTest}>
          ${busy === 'test' ? 'Testing…' : 'Test'}
        </button>
      </div>
    </div>`;
}
function SourcesTab({ reload }) {
  const toast = useToast();
  const r = useJobsApi('jobs_admin&op=sources');
  const [st, setSt] = useState(null);
  const [feed, setFeed] = useState({ name: '', url: '' });
  const [busy, setBusy] = useState(false);
  const [ftest, setFtest] = useState({});
  useEffect(() => {
    if (r.data && !st) setSt(r.data.settings);
  }, [r.data]);
  if (r.error) return html`<${JobsOffline} error=${r.error} />`;
  if (!r.data || !st) return html`<${Spinner} />`;
  const both = () => {
    r.reload();
    reload();
  };
  const saveSettings = async e => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('jobs_admin', { op: 'settings_save', ...st });
      toast('Schedule saved.');
      both();
    } catch (x) {
      toast(errText(x), true);
    }
    setBusy(false);
  };
  const addFeed = async e => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('jobs_admin', { op: 'feed_save', ...feed, on: true });
      toast('Feed added.');
      setFeed({ name: '', url: '' });
      both();
    } catch (x) {
      toast(errText(x), true);
    }
    setBusy(false);
  };
  const feedToggle = async f => {
    try {
      await api('jobs_admin', { op: 'feed_toggle', id: f.id, on: !f.on });
      both();
    } catch (x) {
      toast(errText(x), true);
    }
  };
  const feedDel = async f => {
    if (!confirm(`Remove the feed "${f.name}"?`)) return;
    try {
      await api('jobs_admin', { op: 'feed_delete', id: f.id });
      both();
    } catch (x) {
      toast(errText(x), true);
    }
  };
  const feedTest = async f => {
    setFtest({ ...ftest, [f.id]: { busy: true } });
    try {
      const t = await api('jobs_admin', { op: 'source_test', key: 'feed:' + f.id });
      setFtest({ ...ftest, [f.id]: t });
    } catch (x) {
      setFtest({ ...ftest, [f.id]: { ok: false, error: errText(x) } });
    }
  };
  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(what + ' copied.');
    } catch (e) {
      prompt('Copy this:', text);
    }
  };
  const newKey = async () => {
    if (!confirm('Make a new cron key? Update your cron job with the new command afterwards.')) return;
    try {
      await api('jobs_admin', { op: 'cron_key' });
      toast('New cron key made.');
      both();
    } catch (x) {
      toast(errText(x), true);
    }
  };
  const cron = r.data.cron;
  const up = k => e => setSt({ ...st, [k]: e.target.value });
  return html`<div className="stack">
      <div className="note info">
        <span>
          <b>How this works.</b> Turn on the sources you want and add their keys. Every few hours (or whenever someone opens a job page, or on the cron schedule below) each consultant's titles and locations are searched on every source, and the results are matched to every resume. The free no-key sources list remote roles; for on-site and hybrid roles across the US add Adzuna (free key) and, for listings that appear on LinkedIn, Indeed, Dice and Monster, JSearch.</span>
      </div>
      <div className="portals-grid">
        ${r.data.sources.map(s => html`<${SourceCard} key=${s.key + (s.on ? 1 : 0) + (s.ready ? 1 : 0)} s=${s} reload=${both} />`)}
      </div>
      <div className="g2" style=${{ alignItems: 'start' }}>
        <section className="panel stack" style=${{ gap: 10 }}>
          <h2 className="ph">Your own feeds</h2>
          <p className="muted small" style=${{ margin: 0 }}>Any RSS, Atom or JSON job feed, for example from a C2C requirement board. If the address contains <code>{keywords}
            </code> (and optionally <code>{location}
            </code>) it is searched per consultant title; otherwise the whole feed is read and filtered by the consultants' titles.</p>
          ${
            r.data.feeds.length
              ? html`<ul className="list">
                  ${r.data.feeds.map(
                    f => html`<li key=${f.id}>
                        <div style=${{ minWidth: 0 }}>
                          <div className="t">
                            ${f.name} ${f.on ? html`<${Chip} s="ok">On<//>` : html`<${Chip} s="inactive">Off<//>`}
                          </div>
                          <div className="m" style=${{ wordBreak: 'break-all' }}>
                            ${f.url}
                          </div>
                          ${f.status && f.status.error ? html`<div className="err small">Last problem: ${f.status.error}</div>` : f.status && f.status.ok_at ? html`<div className="small muted">Last worked ${fmtTs(f.status.ok_at)} (${f.status.n} jobs)</div>` : ''}
                          ${
                            ftest[f.id] && !ftest[f.id].busy
                              ? html`<div className="small" style=${{ color: ftest[f.id].ok ? 'var(--teal-ink)' : 'var(--red-ink)' }}>
                                  ${ftest[f.id].ok ? `Works: ${ftest[f.id].n} items` + (ftest[f.id].sample && ftest[f.id].sample.length ? ' (' + ftest[f.id].sample[0] + ')' : '') : 'Not working: ' + ftest[f.id].error}
                                </div>`
                              : ''
                          }
                        </div>
                        <div className="actions" style=${{ flexWrap: 'nowrap' }}>
                          <button className="btn ghost sm" onClick=${() => feedTest(f)} disabled=${ftest[f.id] && ftest[f.id].busy}>Test</button>
                          <button className="btn ghost sm" onClick=${() => feedToggle(f)}>
                            ${f.on ? 'Turn off' : 'Turn on'}
                          </button>
                          <button className="btn ghost sm icon" aria-label="Remove" onClick=${() => feedDel(f)}>
                            <${Icon} n="trash" />
                          </button>
                        </div>
                      </li>`
                  )}
                </ul>`
              : ''
          }
          <form className="form" onSubmit=${addFeed} style=${{ gap: 8 }}>
            <div className="row2">
              <${Field} label="Name">
                <input value=${feed.name} onInput=${e => setFeed({ ...feed, name: e.target.value })} placeholder="e.g. C2C requirements board" />
              <//>
              <${Field} label="Feed address">
                <input value=${feed.url} onInput=${e => setFeed({ ...feed, url: e.target.value })} placeholder="https://…/feed" />
              <//>
            </div>
            <div>
              <button className="btn sm" disabled=${busy}>
                <${Icon} n="plus" />Add feed</button>
            </div>
          </form>
        </section>
        <div className="stack">
          <form className="panel form" onSubmit=${saveSettings}>
            <h2 className="ph">Schedule and limits</h2>
            <div className="row2">
              <${Field} label="Collect automatically every (hours)" hint="0 turns automatic collections off.">
                <input type="number" min="0" max="168" step="0.5" value=${st.schedule_hours} onInput=${up('schedule_hours')} />
              <//>
              <${Field} label="Look for jobs posted in the last (days)">
                <input type="number" min="1" max="60" value=${st.max_age_days} onInput=${up('max_age_days')} />
              <//>
            </div>
            <div className="row2">
              <${Field} label="Searches per collection" hint="Distinct title + location pairs across all consultants.">
                <input type="number" min="1" max="100" value=${st.max_searches} onInput=${up('max_searches')} />
              <//>
              <${Field} label="Keep jobs for (days)">
                <input type="number" min="7" max="180" value=${st.keep_days} onInput=${up('keep_days')} />
              <//>
            </div>
            <${Field} label="Minimum match score to show (10–90)" hint="Lower it to see more, looser matches.">
              <input type="number" min="10" max="90" value=${st.min_score} onInput=${up('min_score')} />
            <//>
            <${Field} label="Recruiting team emails" hint="Comma-separated. Copied on every resume a consultant emails to a recruiter, and told about applications that need a submission.">
              <input value=${st.apply_emails || ''} onInput=${up('apply_emails')} placeholder="recruiting@stratedgeitconsulting.com, recruiter@…" />
            <//>
            <div>
              <button className="btn" disabled=${busy}>Save</button>
            </div>
          </form>
          <section className="panel stack" style=${{ gap: 8 }}>
            <h2 className="ph">Hands-free collections (cron)</h2>
            <p className="muted small" style=${{ margin: 0 }}>Collections also run while anyone has a job page open. To run them without that, add a cron job in cPanel (Cron Jobs, every 10 or 15 minutes) with this command:</p>
            <pre className="small" style=${{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
              ${cron.cli}
            </pre>
            <div className="actions">
              <button className="btn ghost sm" onClick=${() => copy(cron.cli, 'Command')}>Copy command</button>
            </div>
            <p className="muted small" style=${{ margin: 0 }}>Or, if your host only offers web cron, call this address instead (keep it private):</p>
            <pre className="small" style=${{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
              ${cron.url}
            </pre>
            <div className="actions">
              <button className="btn ghost sm" onClick=${() => copy(cron.url, 'Address')}>Copy address</button>
              <button className="btn ghost sm" onClick=${newKey}>New key</button>
            </div>
            <p className="small" style=${{ margin: 0 }}>
              ${cron.last ? html`Cron last ran <b>${fmtTs(cron.last)}</b>.` : html`<span className="muted">The cron job has not run yet.</span>`}
            </p>
          </section>
        </div>
      </div>
    </div>`;
}

function RunsTab({ o, run, onStart }) {
  const toast = useToast();
  const r = useJobsApi('jobs_admin&op=runs&limit=40', [
    run && run.status,
    run && run.progress && run.progress.done,
  ]);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState(null);
  const start = async () => {
    setBusy(true);
    try {
      const x = await api('jobs_admin', { op: 'run' });
      toast(x.already ? 'A collection is already running.' : 'Collection started.');
      onStart(x.run);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const showLog = async x => {
    setLog({ ...x, log: 'Loading…' });
    try {
      const d = await api('jobs_admin&op=run_log&id=' + x.id);
      setLog(d.run);
    } catch (e) {
      setLog({ ...x, log: errText(e) });
    }
  };
  const stChip = s =>
    html`<${Chip} s=${s === 'done' ? 'ok' : s === 'running' || s === 'queued' ? 'new' : s === 'done_with_errors' ? 'amber' : 'red'}>
        ${RUN_STATUS[s] || s}
      <//>`;
  return html`<${Fragment}>
      <div className="note info">
        <span>A collection searches every source for each consultant's titles and locations, then refreshes everyone's matches. ${o.schedule_hours > 0 ? `One starts automatically every ${o.schedule_hours} hours when a job page is open or the cron job runs.` : 'Automatic collections are off (set the hours under Sources).'}
        </span>
        <div className="actions">
          <button className="btn sm" disabled=${busy || runLive(run)} onClick=${start}>
            <${Icon} n="refresh" />
            ${runLive(run) ? 'Collection in progress…' : 'Collect jobs now'}
          </button>
        </div>
      </div>
      <section className="panel" style=${{ padding: '6px 8px' }}>
        ${
          r.loading && !r.data
            ? html`<${Spinner} />`
            : r.data && r.data.runs.length
              ? html`<div className="tblwrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Started</th>
                        <th>Kind</th>
                        <th>Status</th>
                        <th>Started by</th>
                        <th className="r">Searches</th>
                        <th className="r">Jobs seen</th>
                        <th className="r">New</th>
                        <th>Problems</th>
                        <th className="r">
                          <span className="sr">Log</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      ${r.data.runs.map(
                        x => html`<tr key=${x.id}>
                            <td>
                              ${fmtTs(x.started_at)}${x.finished_at ? html`<div className="muted small">${Math.max(1, Math.round((x.finished_at - x.started_at) / 60000))} min</div>` : html`<div className="muted small">${x.progress.done}/${x.progress.total} steps</div>`}
                            </td>
                            <td>
                              ${RUN_KINDS[x.kind] || x.kind}
                            </td>
                            <td>
                              ${stChip(x.status)}
                            </td>
                            <td className="muted small">
                              ${x.trigger_by}
                            </td>
                            <td className="r">
                              ${x.searches}
                            </td>
                            <td className="r">
                              ${x.jobs_found}
                            </td>
                            <td className="r">
                              ${x.jobs_new}
                            </td>
                            <td className="small">
                              ${x.errors.length ? x.errors.slice(0, 4).map((e, i) => html`<div key=${i}><b>${e.source}:</b> ${e.error}</div>`) : html`<span className="muted">None</span>`}
                            </td>
                            <td className="r">
                              <button className="btn ghost sm" onClick=${() => showLog(x)}>Log</button>
                            </td>
                          </tr>`
                      )}
                    </tbody>
                  </table>
                </div>`
              : html`<${Empty} title="No collections yet">Click "Collect jobs now" once a consultant has uploaded a resume, or use the Job grabber.<//>`
        }
      </section>
      ${
        log &&
        html`<${Modal} wide title=${'Collection ' + fmtTs(log.started_at)} onClose=${() => setLog(null)}>
            <pre className="small" style=${{ whiteSpace: 'pre-wrap', maxHeight: '60vh', overflow: 'auto' }}>
              ${log.log || 'No log lines.'}
            </pre>
          <//>`
      }
    <//>`;
}

function usePublish(reload) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const publish = async (j, on) => {
    setBusy(true);
    try {
      await api('jobs_admin', on ? { op: 'publish', job_id: j.id } : { op: 'unpublish', job_id: j.id });
      toast(on ? 'Posted on the Careers page. Share it from there.' : 'Removed from the Careers page.');
      reload && reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return { publish, busy };
}

function CollectedJobs({ o }) {
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [qq, setQq] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQq(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  const r = useJobsApi(
    'jobs_admin&op=jobs&q=' + encodeURIComponent(qq) + '&source=' + encodeURIComponent(source)
  );
  const pub = usePublish(r.reload);
  return html`<${Fragment}>
      <div className="toolbar">
        <input style=${{ maxWidth: 340 }} type="search" placeholder="Search title, company, location, skills" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search jobs" />
        <select value=${source} onChange=${e => setSource(e.target.value)} aria-label="Source" style=${{ maxWidth: 220 }}>
          <option value="">All sources</option>
          ${(o.sources || []).map(s => html`<option key=${s.key} value=${s.key}>${s.name}</option>`)}
        </select>
        <span className="muted small">
          ${r.data ? `${r.data.total} job${r.data.total === 1 ? '' : 's'}` : ''}
        </span>
      </div>
      ${
        r.error
          ? html`<${JobsOffline} error=${r.error} />`
          : r.loading && !r.data
            ? html`<${Spinner} />`
            : r.data.jobs.length
              ? html`<div className="matches">
                  ${r.data.jobs.map(j => html`<${JobRow} key=${j.id} j=${j} onPublish=${pub.publish} busy=${pub.busy} />`)}
                </div>`
              : html`<div className="panel">
                  <${Empty} title="No jobs collected yet">Grab jobs by keyword, or start a collection from the Collection runs tab once a consultant has uploaded a resume.<//>
                </div>`
      }
    <//>`;
}

function ConsultantMatches() {
  const P = usePortal();
  const toast = useToast();
  const r = useJobsApi('jobs_admin&op=consultants');
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const m = useJobsApi(
    open ? 'jobs_admin&op=matches&uid=' + encodeURIComponent(open.uid) : 'jobs_admin&op=overview'
  );
  if (r.error) return html`<${JobsOffline} error=${r.error} />`;
  if (r.loading && !r.data) return html`<${Spinner} />`;
  const list = r.data.consultants || [];
  const nameOfC = c => c.name || (P.people[c.uid] && P.people[c.uid].name) || c.uid;
  const rematch = async () => {
    setBusy(true);
    try {
      const x = await api('jobs_admin', { op: 'rematch_all' });
      toast(`Matches refreshed for ${x.people} ${x.people === 1 ? 'person' : 'people'}.`);
      r.reload();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Fragment}>
      <div className="toolbar" style=${{ justifyContent: 'flex-end' }}>
        <button className="btn ghost sm" disabled=${busy} onClick=${rematch}>
          <${Icon} n="refresh" />
          ${busy ? 'Refreshing…' : 'Refresh all matches'}
        </button>
      </div>
      <section className="panel" style=${{ padding: '6px 8px' }}>
        ${
          list.length
            ? html`<div className="tblwrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Consultant</th>
                      <th>Resume</th>
                      <th>Matched as</th>
                      <th>Location</th>
                      <th className="r">New</th>
                      <th className="r">Saved</th>
                      <th className="r">Applied</th>
                      <th className="r">
                        <span className="sr">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    ${list.map(
                      c => html`<tr key=${c.uid} className="click" tabIndex="0" onClick=${() => setOpen(c)} onKeyDown=${e => {
                        if (e.key === 'Enter') setOpen(c);
                      }}>
                          <td>
                            <b style=${{ fontWeight: 600 }}>
                              ${nameOfC(c)}
                            </b>
                            <div className="muted small">
                              ${c.email}
                            </div>
                          </td>
                          <td>
                            ${c.has_resume ? html`<${Chip} s="ok">${c.resume_name}<//><div className="muted small">${fmtTs(c.resume_at)}</div>${c.dom ? html`<div className="small" style=${{ marginTop: 4 }}>Domains on it: <${DomChips} dom=${c.dom} small /></div>` : ''}` : html`<${Chip} s="amber">Not uploaded<//>`}
                          </td>
                          <td>
                            ${((c.prefs && c.prefs.titles && c.prefs.titles.length ? c.prefs.titles : c.profile.titles) || []).slice(0, 2).join(', ') || '—'}
                          </td>
                          <td>
                            ${(c.prefs && c.prefs.locations && c.prefs.locations[0]) || c.profile.location || '—'}
                          </td>
                          <td className="r">
                            ${c.match_counts.new || 0}
                          </td>
                          <td className="r">
                            ${c.match_counts.saved || 0}
                          </td>
                          <td className="r">
                            ${c.match_counts.applied || 0}
                          </td>
                          <td className="r">
                            <button className="btn ghost sm">View</button>
                          </td>
                        </tr>`
                    )}
                  </tbody>
                </table>
              </div>`
            : html`<${Empty} title="No consultants have set up job matching yet">Consultants upload their resume under "Resume & preferences" in the consultant portal.<//>`
        }
      </section>
      ${
        open &&
        html`<${Modal} wide title=${'Matches for ' + nameOfC(open)} onClose=${() => setOpen(null)}>
            ${m.loading ? html`<${Spinner} />` : m.error ? html`<${JobsOffline} error=${m.error} />` : (m.data.matches || []).length ? html`<div className="matches">${m.data.matches.map(j => html`<${JobRow} key=${j.id} j=${j} />`)}</div>` : html`<${Empty} title="No matches yet" />`}
          <//>`
      }
    <//>`;
}

/* ---------- staff: Job grabber (search the sources by keyword, publish to Careers) ---------- */
const GRAB_DAYS = [
  [1, 'Past 24 hours'],
  [3, 'Past 3 days'],
  [7, 'Past week'],
  [14, 'Past 2 weeks'],
  [30, 'Past month'],
];
function JobGrabber({ o, run, onStart }) {
  const toast = useToast();
  const sources = (o.sources || []).filter(s => s.on && s.ready);
  const [f, setF] = useState({ keywords: '', location: '', remote: 'any', posted_days: 7, sources: null });
  const [runId, setRunId] = useState(null);
  const [busy, setBusy] = useState(false);
  const mine = run && run.id === runId ? run : null;
  const finished = runId && (!run || run.id !== runId || !runLive(run));
  const jobs = useJobsApi(finished ? 'jobs_admin&op=run_jobs&id=' + runId : 'jobs_admin&op=overview');
  const pub = usePublish(jobs.reload);
  const sel = f.sources || Object.fromEntries(sources.map(s => [s.key, true]));
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const grab = async e => {
    e.preventDefault();
    const kws = f.keywords
      .split(/[,\n;]/)
      .map(x => x.trim())
      .filter(Boolean);
    if (!kws.length) {
      toast('Type at least one job title or keyword.', true);
      return;
    }
    const chosen = sources.filter(s => sel[s.key]).map(s => s.key);
    if (!chosen.length) {
      toast('Pick at least one source.', true);
      return;
    }
    setBusy(true);
    try {
      const r = await api('jobs_admin', {
        op: 'grab',
        keywords: kws,
        location: f.location,
        remote: f.remote,
        posted_days: +f.posted_days,
        sources: chosen,
      });
      setRunId(r.run.id);
      onStart(r.run);
      toast(
        r.run.status === 'queued'
          ? 'Queued behind the current collection.'
          : 'Grabbing jobs… results appear below as each source answers.'
      );
    } catch (x) {
      toast(errText(x), true);
    }
    setBusy(false);
  };
  return html`<${Fragment}>
      <p className="muted small">Type job titles or keywords, pick the sources, and grab. Results are stored, matched to every consultant's resume, and any of them can be published to the Careers page with one click.${sources.length ? '' : ' No source is on yet: turn some on under Sources.'}
      </p>
      <form className="panel form" onSubmit=${grab}>
        <h2 className="ph">Grab jobs</h2>
        <${Field} label="Job titles or keywords" hint="Comma-separated. Each one is searched on every selected source.">
          <input value=${f.keywords} onInput=${up('keywords')} placeholder="e.g. SAP FICO Consultant, ServiceNow Developer, Epic Analyst" />
        <//>
        <div className="row3">
          <${Field} label="Location">
            <input value=${f.location} onInput=${up('location')} placeholder="City, state (empty = United States)" />
          <//>
          <${Field} label="Posted">
            <select value=${f.posted_days} onChange=${up('posted_days')}>
              ${GRAB_DAYS.map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}
            </select>
          <//>
          <${Field} label="Work mode">
            <select value=${f.remote} onChange=${up('remote')}>
              ${REMOTE_OPTS.map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}
            </select>
          <//>
        </div>
        <div className="fld">
          <span>Sources</span>
          <div className="meta" style=${{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            ${sources.map(
              s => html`<label key=${s.key} className=${'pillbtn' + (sel[s.key] ? ' on' : '')}>
                  <input type="checkbox" hidden checked=${!!sel[s.key]} onChange=${() => setF({ ...f, sources: { ...sel, [s.key]: !sel[s.key] } })} />
                  ${s.name}${s.remote ? ' (remote)' : ''}
                </label>`
            )}${!sources.length && html`<span className="muted small">None on.</span>`}
          </div>
        </div>
        <div className="actions">
          <button className="btn" disabled=${busy || !sources.length}>
            <${Icon} n="search" />
            ${mine && runLive(mine) ? 'Grabbing…' : 'Grab jobs'}
          </button>
        </div>
      </form>
      ${
        runId &&
        (finished
          ? html`<section className="panel stack" style=${{ gap: 10 }}>
              <div className="ph-row">
                <h2 className="ph">
                  ${jobs.data && jobs.data.jobs ? `Grabbed ${jobs.data.jobs.length} job${jobs.data.jobs.length === 1 ? '' : 's'}` : 'Grabbed jobs'}
                </h2>
                <span className="muted small">
                  ${mine && mine.search ? mine.search.map(q => q.q).join(', ') + (mine.search[0] ? ' in ' + mine.search[0].location : '') : ''}
                </span>
              </div>
              ${
                mine && mine.errors && mine.errors.length
                  ? html`<div className="note amber">
                      <span>
                        ${mine.errors.map((e, i) => html`<div key=${i}><b>${e.source}:</b> ${e.error}</div>`)}
                      </span>
                    </div>`
                  : ''
              }
              ${
                jobs.data && jobs.data.jobs
                  ? jobs.data.jobs.length
                    ? html`<div className="matches">
                        ${jobs.data.jobs.map(j => html`<${JobRow} key=${j.id} j=${j} onPublish=${pub.publish} busy=${pub.busy} />`)}
                      </div>`
                    : html`<${Empty} title="Nothing found for that search">Try broader keywords, a longer "Posted" window, or more sources.<//>`
                  : html`<${Spinner} />`
              }
            </section>`
          : html`<section className="panel">
              <${Spinner} label="Searching the sources… results appear here when the grab finishes." />
            </section>`)
      }
    <//>`;
}

/* ---------- consultant: jobs StratEdge sent directly ---------- */
const JobsTabs = ({ tab, setTab, counts }) =>
  html`<div className="tabs" role="tablist">
      ${[...Object.entries(MATCH_STATES), ['sent', 'Sent to you']].map(
        ([
          k,
          v,
        ]) => html`<button key=${k} role="tab" aria-selected=${tab === k} className=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>
            ${v}
            <span className=${'chip' + (k === 'sent' && counts.sent ? ' amber' : '')}>
              ${counts[k] || 0}
            </span>
          </button>`
      )}
    </div>`;
function SentToMe({ docs, loading, onApply }) {
  if (loading) return html`<${Spinner} />`;
  if (!docs.length)
    return html`<div className="panel">
        <${Empty} title="Nothing sent to you yet">When a StratEdge recruiter sends you a role, it appears here and in your email.<//>
      </div>`;
  return html`<div className="matches">
      ${docs.map(
        j => html`<div key=${j.id} className="match">
            <div style=${{ minWidth: 0 }}>
              <h3>
                <a href=${'#/careers/' + j.id}>
                  ${j.ti}
                </a>
              </h3>
              <div className="muted">
                ${[j.loc, j.ty, j.md].filter(Boolean).join(' · ')}
              </div>
              <div className="reasons">Sent by ${j.byn || 'StratEdge'} ${fmtTs(j.at)}${j.msg ? html`<br /><i>“${j.msg}”</i>` : ''}
              </div>
              ${
                j.sk &&
                html`<div className="meta">${j.sk
                  .split(/,\s*/)
                  .filter(Boolean)
                  .slice(0, 8)
                  .map(s => html`<${Chip} key=${s}>${s}<//>`)}</div>`
              }
            </div>
            <div className="actions" style=${{ justifyContent: 'flex-end' }}>
              ${
                onApply
                  ? html`<button className="btn sm" type="button" onClick=${() => onApply(j)}>
                      <${Icon} n="send" />Apply with my resume</button>`
                  : ''
              }
              <a className=${'btn sm' + (onApply ? ' ghost' : '')} href=${'#/careers/' + j.id}>View${onApply ? '' : ' and apply'}
              </a>
              <${ShareButton} job=${j} small=${true} />
            </div>
          </div>`
      )}
    </div>`;
}

/* ---------- staff: send a Careers job to people by email ---------- */
function SendJobButton({ jobId, job, small, label }) {
  const [open, setOpen] = useState(false);
  return html`<${Fragment}>
      <button type="button" className=${'btn' + (small ? ' sm' : '')} onClick=${() => setOpen(true)}>
        <${Icon} n="send" />
        ${label || 'Send to people'}
      </button>
      ${open && html`<${SendJobModal} jobId=${jobId || job.id} onClose=${() => setOpen(false)} />`}
    <//>`;
}
const RECIP_GROUPS = [
  ['portal', 'Portal consultants'],
  ['rec', 'Recruiting database'],
  ['ats', 'Candidates (ATS)'],
  ['other', 'Other emails'],
];
function SendJobModal({ jobId, onClose }) {
  const P = usePortal();
  const toast = useToast();
  const jd = useDoc(`org/site/jobs/${jobId}`);
  const rec = useJobsApi('job_recipients');
  const [grp, setGrp] = useState('portal');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState({});
  const [other, setOther] = useState('');
  const [subject, setSubject] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const job = jd.data;
  useEffect(() => {
    if (job && !subject) {
      setSubject(`Job opportunity: ${job.ti} at StratEdge IT Consulting`);
      setMsg(
        `We have an opening that looks like a fit for you: ${job.ti}${job.loc ? ' in ' + job.loc : ''}${job.ty ? ' (' + job.ty + ')' : ''}. Take a look and apply if you are interested, or reply to this email with any questions.`
      );
    }
  }, [job]);
  if (jd.loading) return html`<${Modal} title="Send job" onClose=${onClose}><${Spinner} /><//>`;
  if (!job)
    return html`<${Modal} title="Send job" onClose=${onClose}>
        <p className="muted">This job is no longer on the Careers page.</p>
      <//>`;
  const groups = rec.data || { portal: [], rec: [], ats: [] };
  const key = (g, x) => g + ':' + (x.uid || x.id || x.e);
  const list = (groups[grp] || []).filter(x => {
    const ql = q.trim().toLowerCase();
    return !ql || [x.n, x.e, x.ti, x.loc, x.sk].filter(Boolean).join(' ').toLowerCase().includes(ql);
  });
  const toggle = (g, x) =>
    setPicked(p => {
      const k = key(g, x);
      const n = { ...p };
      if (n[k]) delete n[k];
      else n[k] = { n: x.n, e: x.e, uid: x.uid || '' };
      return n;
    });
  const allVisible = () =>
    setPicked(p => {
      const n = { ...p };
      list.forEach(x => {
        n[key(grp, x)] = { n: x.n, e: x.e, uid: x.uid || '' };
      });
      return n;
    });
  const extra = other
    .split(/[,;\s]+/)
    .map(e => e.trim())
    .filter(e => /^\S+@\S+\.\S+$/.test(e))
    .map(e => ({ n: '', e }));
  const recipients = [...Object.values(picked), ...extra];
  const send = async () => {
    if (!recipients.length) {
      toast('Pick at least one person or type an email address.', true);
      return;
    }
    setBusy(true);
    try {
      const r = await api('job_send', { id: jobId, to: recipients, subject, message: msg });
      setDone(r);
      toast(`Sent to ${r.sent} ${r.sent === 1 ? 'person' : 'people'}.`);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const sentLog = (job.sent || []).slice().reverse();
  const foot = done
    ? html`<button className="btn" onClick=${onClose}>Done</button>`
    : html`<button className="btn ghost" onClick=${onClose}>Cancel</button>
      <button className="btn" disabled=${busy || !recipients.length} onClick=${send}>
        <${Icon} n="send" />
        ${busy ? 'Sending…' : `Send to ${recipients.length || ''} ${recipients.length === 1 ? 'person' : 'people'}`}
      </button>`;
  return html`<${Modal} wide title=${'Send: ' + job.ti} onClose=${onClose} foot=${foot}>
      ${
        done
          ? html`<div className="stack">
              <div className="note ok">
                <span>
                  <b>Sent to ${done.sent} ${done.sent === 1 ? 'person' : 'people'}.</b> Each email has the job details and a "View and apply" button; replies come to ${P.caps.me.email}. Portal consultants also see it under Matched jobs › Sent to you.</span>
              </div>
              ${
                done.failed.length
                  ? html`<div className="note red">
                      <span>Could not deliver to: ${done.failed.join(', ')}. Check the outgoing mail settings in api/config.php (storage/mail.log has details).</span>
                    </div>`
                  : ''
              }
            </div>`
          : html`<div className="g2" style=${{ alignItems: 'start' }}>
              <div className="stack" style=${{ gap: 10 }}>
                <div className="tabs" role="tablist" style=${{ marginBottom: 0 }}>
                  ${RECIP_GROUPS.map(
                    ([
                      k,
                      v,
                    ]) => html`<button key=${k} role="tab" aria-selected=${grp === k} className=${grp === k ? 'on' : ''} onClick=${() => setGrp(k)}>
                        ${v}${k !== 'other' ? html`<span className="chip">${(groups[k] || []).length}</span>` : ''}
                      </button>`
                  )}
                </div>
                ${
                  grp === 'other'
                    ? html`<${Field} label="Email addresses" hint="Comma- or line-separated. Anyone: vendors, referrals, past candidates.">
                        <textarea value=${other} onInput=${e => setOther(e.target.value)} rows="5" placeholder="name@example.com, other@example.com" />
                      <//>`
                    : html`<${Fragment}>
                        <div className="toolbar" style=${{ margin: 0 }}>
                          <input type="search" placeholder="Search name, email, title, skills" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search people" />
                          ${list.length > 1 && html`<button className="btn ghost sm" type="button" onClick=${allVisible}>Select all ${list.length}</button>`}
                        </div>
                        <div className="picklist">
                          ${
                            rec.loading && !rec.data
                              ? html`<${Spinner} />`
                              : list.length
                                ? list.map(x => {
                                    const k = key(grp, x);
                                    return html`<label key=${k} className=${'pick' + (picked[k] ? ' on' : '')}>
                                        <input type="checkbox" checked=${!!picked[k]} onChange=${() => toggle(grp, x)} />
                                        <span>
                                          <b>
                                            ${x.n || x.e}
                                          </b>
                                          <small>
                                            ${[x.e, x.ti, x.loc, x.st].filter(Boolean).join(' · ')}
                                          </small>
                                        </span>
                                      </label>`;
                                  })
                                : html`<p className="muted small" style=${{ padding: 10 }}>
                                    ${grp === 'portal' ? 'No approved consultants with an email yet.' : grp === 'rec' ? 'No consultants with an email in the recruiting database.' : 'No candidates with an email in the ATS.'}
                                  </p>`
                          }
                        </div>
                      <//>`
                }
                ${
                  recipients.length
                    ? html`<div className="meta" style=${{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        ${recipients.slice(0, 12).map(r => html`<${Chip} key=${r.e} s="ok">${r.n || r.e}<//>`)}${recipients.length > 12 ? html`<span className="muted small">+${recipients.length - 12} more</span>` : ''}
                      </div>`
                    : ''
                }
              </div>
              <div className="form">
                <${Field} label="Subject">
                  <input value=${subject} onInput=${e => setSubject(e.target.value)} />
                <//>
                <${Field} label="Message" hint="The job title, location, engagement, skills, description and a View-and-apply link are added below your message.">
                  <textarea value=${msg} onInput=${e => setMsg(e.target.value)} rows="6" />
                <//>
                <dl className="kv small">
                  <dt>Job</dt>
                  <dd>
                    ${job.ti}${job.loc ? ', ' + job.loc : ''}
                  </dd>
                  <dt>Link</dt>
                  <dd>
                    <a href=${'#/careers/' + jobId} target="_blank" rel="noopener">
                      ${jobLink(jobId)}
                    </a>
                  </dd>
                  <dt>Replies go to</dt>
                  <dd>
                    ${P.caps.me.email}
                  </dd>
                </dl>
                ${
                  sentLog.length
                    ? html`<details>
                        <summary className="muted small">Sent before (${job.sentN || 0} ${job.sentN === 1 ? 'person' : 'people'})</summary>
                        <ul className="list small">
                          ${sentLog.slice(0, 8).map(
                            (s, i) => html`<li key=${i}>
                                <div>
                                  <div className="t">
                                    ${s.n} by ${s.byn}, ${fmtTs(s.t)}
                                  </div>
                                  <div className="m">
                                    ${(s.to || []).join(', ')}
                                  </div>
                                </div>
                              </li>`
                          )}
                        </ul>
                      </details>`
                    : ''
                }
              </div>
            </div>`
      }
    <//>`;
}
