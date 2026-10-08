/* ================= v37.2 the Jobs module: a page per requisition, templates, the job boards desk =================
   JobPage reads api/atsreq.php (ats_req_view): the funnel, what needs doing, the activity, recruiter assignments
   with a submission target, insights from similar jobs, matching people from the talent index, Boolean searches
   built from the job, and share links that carry the job code (short link, QR code, per-channel clicks and
   applicants). PostingsTab is the job boards desk: which boards' feeds carry each job, refresh, the Dice record. */
const JOB_ST_NAME = { draft: 'Draft', open: 'Open', hold: 'On hold', filled: 'Filled', closed: 'Closed' };
// filled, then a draft or on hold (whatever the careers page shows), then closed (by status, or no longer listed), else open
const jobState = r => {
  const s = r.job.status || 'open';
  if (s === 'filled' || (r.job.openings && r.job.filled >= r.job.openings)) return 'filled';
  if (s === 'draft') return 'draft';
  if (s === 'hold') return 'on hold';
  return s === 'closed' || r.pub.open === false ? 'closed' : 'open';
};
const jobStTone = s => (s === 'open' ? 'ok' : s === 'filled' ? 'new' : s === 'on hold' || s === 'draft' ? 'amber' : '');
const JOB_BOARDS = [['indeed', 'Indeed'], ['dice', 'Dice'], ['ziprecruiter', 'ZipRecruiter'], ['jooble', 'Jooble'], ['linkedin', 'LinkedIn'], ['glassdoor', 'Glassdoor'], ['talent', 'Talent.com'], ['adzuna', 'Adzuna']];
// share channels: the key goes into the link (letters only, so the careers page keeps it); net is the share window
const JOB_SHARE = [
  { k: 'linkedin', n: 'LinkedIn', net: 'linkedin' },
  { k: 'facebook', n: 'Facebook', net: 'facebook' },
  { k: 'xcom', n: 'X', net: 'x' },
  { k: 'whatsapp', n: 'WhatsApp', net: 'whatsapp' },
  { k: 'telegram', n: 'Telegram', net: 'telegram' },
  { k: 'email', n: 'Email', net: 'mailto' },
];
const jobShort = (code, ch) => siteBase() + 'job.php?j=' + encodeURIComponent(code) + (ch ? '&s=' + ch : '');
const jobLinkFor = (id, code, ch) => (code ? jobShort(code, ch) : jobShareLink(id, ch));
const jobPortalKey = () => (location.hash.match(/#\/portal\/([a-z]+)/) || [])[1] || 'admin';
const hourly = v => (v == null ? '—' : '$' + (Math.round(v * 100) / 100).toLocaleString() + '/hr');
// (plural() is the one in mail.js)
/* Boolean searches from the job's titles and skills (the person picks which terms go in). */
function jobBool(need, pick, withLoc) {
  const q = s => (/[\s/&+#.-]/.test(s) ? '"' + s + '"' : s);
  const titles = (need.titles || []).filter(t => pick[t] !== false);
  const must = (need.words || need.must || []).filter(s => pick[s] !== false);
  const nice = (need.nice || []).filter(s => pick[s] === true);
  const tPart = titles.length ? '(' + titles.map(t => '"' + t + '"').join(' OR ') + ')' : '';
  const mPart = must.map(q).join(' AND ');
  const nPart = nice.length ? '(' + nice.map(q).join(' OR ') + ')' : '';
  const city = String(need.loc || '').split(',')[0].trim();
  const where = withLoc && city && !need.remote ? '"' + city + '"' : '';
  const generic = [tPart, mPart, nPart].filter(Boolean).join(' AND ');
  return {
    generic,
    xli: ['site:linkedin.com/in', tPart, ...must.map(s => '"' + s + '"'), nPart, where, '-jobs'].filter(Boolean).join(' '),
    xgh: ['site:github.com', ...must.slice(0, 4).map(s => '"' + s + '"'), where].filter(Boolean).join(' '),
  };
}
function JobQr({ text, name }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let on = true;
    setSrc('');
    loadQr()
      .then(qr => {
        const c = qr(0, 'M');
        c.addData(text);
        c.make();
        if (on) setSrc(c.createDataURL(8, 16));
      })
      .catch(() => {});
    return () => (on = false);
  }, [text]);
  return html`<div className="jqr">
      ${src ? html`<img src=${src} alt=${'QR code that opens ' + name} width="168" height="168" />` : html`<${Spinner} label="Drawing the code…" />`}
      ${src && html`<a className="btn ghost sm" href=${src} download=${String(name || 'job').replace(/[^A-Za-z0-9-]+/g, '-') + '-qr.gif'}><${Icon} n="down" />Download</a>`}
    </div>`;
}
/* ---------------- the requisition page ---------------- */
function JobPage({ id, ver, rows, docs, S, onBack, onOpenCand, onNav, onPipeline, onEdit, onAdd, reloadJobs }) {
  const P = usePortal();
  const A = P.admin;
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState('overview');
  const [tick, setTick] = useState(0);
  const [tplFor, setTplFor] = useState(false);
  // a quick move to another requisition: only the answer for the one on screen is kept
  const cur = useRef(id);
  cur.current = id;
  const load = () => {
    const want = id;
    return api('ats_req_view', { id: want })
      .then(r => {
        if (cur.current !== want) return;
        setD(r);
        setErr(null);
      })
      .catch(e => {
        if (cur.current === want) setErr(e);
      });
  };
  useEffect(() => {
    load();
  }, [id, tick, ver]);
  useEffect(() => {
    setD(null);
  }, [id]);
  const refresh = () => {
    setTick(t => t + 1);
    reloadJobs && reloadJobs();
  };
  const list = (rows || []).filter(r => !['closed', 'filled'].includes(jobState(r)) || r.id === id);
  const at = list.findIndex(r => r.id === id);
  const prev = at > 0 ? list[at - 1] : null;
  const next = at >= 0 && at < list.length - 1 ? list[at + 1] : null;
  const row = (rows || []).find(r => r.id === id);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} label="Opening the requisition…" />`;
  const pub = d.pub;
  const job = d.job;
  const st = jobState({ pub, job });
  const mine = (docs || []).filter(c => c.job === id);
  const clone = async () => {
    try {
      const r = await api('ats_req_clone', { id });
      toast('Copied as ' + r.code + ': a draft, not on the careers page until you open it.');
      reloadJobs && reloadJobs();
      onNav(r.id);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const fun = d.funnel;
  const kpis = [
    { v: fun[0].n, l: 'Applied' },
    { v: fun[1].n, l: 'Screened' + (fun[1].conv != null ? ' · ' + fun[1].conv + '%' : '') },
    { v: fun[2].n, l: 'Interview / submitted' + (fun[2].conv != null ? ' · ' + fun[2].conv + '%' : '') },
    { v: fun[3].n, l: 'Offer' + (fun[3].conv != null ? ' · ' + fun[3].conv + '%' : '') },
    { v: fun[4].n + ' / ' + (job.openings || 1), l: 'Hired of the openings', tone: fun[4].n ? 'ok' : undefined },
  ];
  const tabs = [
    ['overview', 'Overview', d.todo.length || null],
    ['cands', 'Candidates', mine.length || null],
    ['match', 'Matching people'],
    ['assign', 'Assignments', d.assign.length || null],
    ['share', 'Share and job boards'],
    ['insights', 'Insights'],
    ['activity', 'Activity'],
  ];
  const meta = [pub.loc, pub.ty, pub.md, job.client && A ? (A.clientsById[job.client] || {}).n : '', job.dept].filter(Boolean).join(' · ');
  return html`<div className="stack jobpage">
      <div className="jobhead">
        <div className="jobhead-t">
          <div className="actions jobhead-crumbs">
            <button type="button" className="btn ghost sm" onClick=${onBack}><${Icon} n="left" />Requisitions</button>
            <code className="jcode">${d.code}</code>
            <${Chip} s=${jobStTone(st)}>${st}<//>
            ${job.priority === 'urgent' || job.priority === 'high' ? html`<${Chip} s=${job.priority === 'urgent' ? 'red' : 'amber'}>${job.priority}<//>` : null}
            ${pub.internal ? html`<${Chip}>internal only<//>` : null}
            ${(job.tags || []).map(t => html`<span key=${t} className="chip">${t}</span>`)}
          </div>
          <h2 className="ph jobtitle">${pub.ti}</h2>
          <div className="muted small">${meta}${meta ? ' · ' : ''}posted ${fmtDay(pub.at)} (${d.insights.time.age ? plural(d.insights.time.age, 'day') + ' ago' : 'today'})${job.team && job.team.rec ? ' · recruiter ' + nameIn(A, job.team.rec) : ''}${job.team && job.team.hm ? ' · hiring manager ' + nameIn(A, job.team.hm) : ''}</div>
        </div>
        <div className="actions jobhead-act">
          <button type="button" className="btn ghost sm" disabled=${!prev} onClick=${() => prev && onNav(prev.id)} title=${prev ? 'Previous: ' + prev.pub.ti : 'No previous open requisition'} aria-label="Previous requisition"><${Icon} n="left" /></button>
          <button type="button" className="btn ghost sm" disabled=${!next} onClick=${() => next && onNav(next.id)} title=${next ? 'Next: ' + next.pub.ti : 'No next open requisition'} aria-label="Next requisition"><${Icon} n="right" /></button>
          <button type="button" className="btn ghost sm" onClick=${() => onPipeline(id)}><${Icon} n="layers" />Pipeline</button>
          <button type="button" className="btn ghost sm" onClick=${() => row && onEdit(row)} disabled=${!row}><${Icon} n="pen" />Edit</button>
          <button type="button" className="btn ghost sm" onClick=${clone}><${Icon} n="file" />Copy</button>
          <button type="button" className="btn ghost sm" onClick=${() => setTplFor(true)}><${Icon} n="star" />Save as template</button>
          <a className="btn ghost sm" href=${'#/careers/' + id} target="_blank" rel="noopener" title="The public posting"><${Icon} n="globe" /></a>
        </div>
      </div>
      <${KitStats} items=${kpis} />
      <${KitTabs} tabs=${tabs} tab=${tab} onTab=${setTab} wrap />
      ${tab === 'overview' && html`<${JobOverview} d=${d} id=${id} onOpenCand=${onOpenCand} onTab=${setTab} />`}
      ${tab === 'cands' && html`<${JobCands} cands=${mine} job=${job} S=${S} onOpenCand=${onOpenCand} onAdd=${onAdd} />`}
      ${tab === 'match' && html`<${JobMatch} id=${id} onAdded=${refresh} />`}
      ${tab === 'assign' && html`<${JobAssign} id=${id} d=${d} onSaved=${refresh} />`}
      ${tab === 'share' && html`<${JobShare} id=${id} d=${d} onChanged=${refresh} />`}
      ${tab === 'insights' && html`<${JobInsights} d=${d} onNav=${onNav} />`}
      ${tab === 'activity' && html`<${JobActivity} id=${id} d=${d} onOpenCand=${onOpenCand} onSaved=${refresh} />`}
      ${tplFor && html`<${AtsSaveTpl} id=${id} ti=${pub.ti} onClose=${() => setTplFor(false)} />`}
    </div>`;
}
function JobOverview({ d, id, onOpenCand, onTab }) {
  const P = usePortal();
  const A = P.admin;
  const toast = useToast();
  const pub = d.pub;
  const job = d.job;
  const [pick, setPick] = useState({});
  const [withLoc, setWithLoc] = useState(true);
  const need = d.need;
  const b = jobBool(need, pick, withLoc);
  const toggle = (t, on) => setPick({ ...pick, [t]: on });
  const pay = job.pay || {};
  const ins = d.insights;
  const appr = (job.approvals || []).filter(a => a.uid);
  const ICON = { sla: 'clock', intv: 'cal', card: 'pen', offer: 'money', new: 'inbox', appr: 'approve', assign: 'target', stale: 'flag' };
  return html`<div className="stack">
      <div className="g2" style=${{ alignItems: 'start' }}>
        <section className="panel stack">
          <h2 className="ph">To do</h2>
          ${
            d.todo.length
              ? html`<ul className="jtodo">${d.todo.map(
                  (t, i) => html`<li key=${i}>
                    <${Icon} n=${ICON[t.t] || 'check'} />
                    <span>${t.msg}${t.at ? html` <span className="muted">· ${fmtTs(new Date(t.at).getTime())}</span>` : null}</span>
                    ${t.cid ? html`<button type="button" className="btn ghost sm" onClick=${() => onOpenCand(t.cid)}>Open</button>` : t.t === 'assign' ? html`<button type="button" className="btn ghost sm" onClick=${() => onTab('assign')}>Assignments</button>` : t.t === 'stale' ? html`<button type="button" className="btn ghost sm" onClick=${() => onTab('match')}>Matching people</button>` : null}
                  </li>`
                )}</ul>`
              : html`<p className="muted small" style=${{ margin: 0 }}>Nothing needs attention right now.</p>`
          }
        </section>
        <section className="panel stack">
          <h2 className="ph">At a glance</h2>
          <dl className="kv small">
            <dt>Openings</dt><dd>${job.filled || 0} of ${job.openings || 1} filled</dd>
            <dt>Candidates</dt><dd>${d.active} active · ${d.total} in all · ${d.rejected} not moving on</dd>
            <dt>Stages now</dt><dd>${d.stages.filter(s => s.now).map(s => s.n + ' ' + s.now).join(' · ') || '—'}</dd>
            <dt>Pay range</dt><dd>${pay.min || pay.max ? [pay.min, pay.max].filter(Boolean).join('–') + ' ' + (pay.cur || 'USD') + (pay.per === 'year' ? '/yr' : '/hr') : '—'}</dd>
            ${job.bill && job.bill.rate ? html`<dt>Bill rate</dt><dd>${job.bill.rate}${job.bill.per === 'year' ? '/yr' : '/hr'}${ins.pay.margin ? html` · margin ${hourly(ins.pay.margin.amt)}${ins.pay.margin.pct != null ? ' (' + ins.pay.margin.pct + '%)' : ''}` : null}</dd>` : null}
            <dt>Careers page</dt><dd>${pub.open === false ? 'not listed' : pub.internal ? 'internal only (direct link)' : 'listed'}</dd>
            <dt>Job boards</dt><dd>${d.boards.length ? (d.boards.length === JOB_BOARDS.length ? 'every board' : d.boards.map(k => (JOB_BOARDS.find(x => x[0] === k) || [k, k])[1]).join(', ')) : 'none'}${pub.dice && pub.dice.st === 'live' ? ' · live on Dice' : ''}</dd>
            <dt>Link visits</dt><dd>${d.clicks.n}${d.clicks.last ? html` <span className="muted">(last ${fmtTs(d.clicks.last)})</span>` : null}</dd>
            ${appr.length ? html`<dt>Approvals</dt><dd>${appr.map(a => nameIn(A, a.uid) + ': ' + (a.st || 'pending')).join(' · ')}</dd>` : null}
          </dl>
        </section>
      </div>
      <section className="panel stack">
        <div className="ph-row"><h2 className="ph">Boolean searches</h2><span className="muted small">Built from the job's title and skills. Click a term to leave it out or put it in.</span></div>
        <div className="jterms">
          ${need.titles.map(t => html`<button key=${'t' + t} type="button" className=${'jterm' + (pick[t] !== false ? ' on' : '')} aria-pressed=${pick[t] !== false} onClick=${() => toggle(t, pick[t] === false)}>${t}</button>`)}
          ${(need.words || need.must).map(s => html`<button key=${'m' + s} type="button" className=${'jterm must' + (pick[s] !== false ? ' on' : '')} aria-pressed=${pick[s] !== false} onClick=${() => toggle(s, pick[s] === false)} title="Must have">${s}</button>`)}
          ${need.nice.map(s => html`<button key=${'n' + s} type="button" className=${'jterm nice' + (pick[s] === true ? ' on' : '')} aria-pressed=${pick[s] === true} onClick=${() => toggle(s, pick[s] !== true)} title="Nice to have (any of them)">${s}</button>`)}
          ${need.loc && !need.remote ? html`<label className="check small"><input type="checkbox" checked=${withLoc} onChange=${e => setWithLoc(e.target.checked)} /><span>City in the X-ray searches</span></label>` : null}
        </div>
        ${!need.titles.length && !need.must.length ? html`<p className="muted small">Add a title and must-have skills to the requisition to build searches.</p>` : html`<div className="jbool">
            ${[['generic', 'Job boards and LinkedIn Recruiter (Boolean)', b.generic], ['xli', 'Google X-ray: LinkedIn profiles', b.xli], ['xgh', 'Google X-ray: GitHub', b.xgh]].map(
              ([k, n, v]) => html`<div key=${k} className="jboolrow">
                <b className="small">${n}</b>
                <code>${v}</code>
                <div className="actions">
                  <button type="button" className="btn ghost sm" onClick=${() => copyText(toast, v)}>Copy</button>
                  ${k !== 'generic' && html`<a className="btn ghost sm" href=${'https://www.google.com/search?q=' + encodeURIComponent(v)} target="_blank" rel="noopener noreferrer"><${Icon} n="search" />Google</a>`}
                </div>
              </div>`
            )}
            <div className="actions"><a className="btn ghost sm" href=${'#/portal/' + jobPortalKey() + '/search?job=' + encodeURIComponent(id)}><${Icon} n="users" />Search our own resumes (Talent search)</a></div>
          </div>`}
      </section>
      ${
        pub.d &&
        html`<details className="panel jdesc"><summary><b>Description</b></summary><p className="small" style=${{ whiteSpace: 'pre-wrap' }}>${pub.d}</p>${pub.sk ? html`<p className="small"><b>Skills:</b> ${pub.sk}</p>` : null}</details>`
      }
    </div>`;
}
function JobCands({ cands, job, S, onOpenCand, onAdd }) {
  const [kind, setKind] = useState('active');
  const list = cands
    .filter(c => {
      const k = kindOf(job, c.st);
      return kind === 'all' || (kind === 'active' ? activeKind(k) : k === kind);
    })
    .sort((a, b) => (b.u || b.at || 0) - (a.u || a.at || 0));
  const P = usePortal();
  const A = P.admin;
  return html`<div className="stack">
      <div className="toolbar">
        <div className="seg">${[['active', 'Active'], ['hired', 'Hired'], ['rejected', 'Not moving on'], ['all', 'All']].map(([k, n]) => html`<button key=${k} type="button" className=${kind === k ? 'on' : ''} onClick=${() => setKind(k)}>${n}</button>`)}</div>
        <div className="push"><button type="button" className="btn" onClick=${onAdd}><${Icon} n="plus" />Add candidate</button></div>
      </div>
      ${
        list.length
          ? html`<div className="tblwrap"><table className="tbl">
              <thead><tr><th>Candidate</th><th>Stage</th><th className="r">Days in stage</th><th>Fit</th><th>Source</th><th>Added</th></tr></thead>
              <tbody>${list.map(c => {
                const s = stageOf(job, c.st);
                const days = daysSince(c.stAt || c.at);
                const goal = (job.sla && job.sla[s.kind]) || (S.sla && S.sla[s.kind]);
                return html`<tr key=${c.id} className="click" tabIndex="0" onClick=${() => onOpenCand(c.id)} onKeyDown=${e => { if (e.key === 'Enter') onOpenCand(c.id); }}>
                  <td><b>${c.n}</b><div className="muted small">${[c.ti, c.loc, c.auth].filter(Boolean).join(' · ')}</div></td>
                  <td><${Chip} s=${atsChip(s.kind)}>${s.n}<//></td>
                  <td className=${'r num' + (activeKind(s.kind) && goal && days > goal ? ' late' : '')}>${days}</td>
                  <td><${ScoreChip} s=${c.score} /></td>
                  <td className="small">${c.src || '—'}</td>
                  <td className="small nw">${fmtDay(c.at)}${c.by ? html`<div className="muted">${nameIn(A, c.by)}</div>` : null}</td>
                </tr>`;
              })}</tbody>
            </table></div>`
          : html`<${Empty} title=${kind === 'active' ? 'No active candidates' : 'Nobody here'}>Add candidates, or look at Matching people for those in your database who fit.<//>`
      }
    </div>`;
}
function JobMatch({ id, onAdded }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState({});
  const [min, setMin] = useState(50);
  const load = () => {
    setD(null);
    api('ats_req_match', { id }, { timeout: 100000 })
      .then(setD)
      .catch(e => {
        setD({ rows: [], err: errText(e), buckets: {}, total: 0, need: { must: [], nice: [] } });
      });
  };
  useEffect(load, [id]);
  if (!d) return html`<${Spinner} label="Looking through the resumes…" />`;
  const rows = d.rows.filter(r => r.score >= min);
  const keys = Object.keys(sel).filter(k => sel[k]);
  const add = async () => {
    setBusy(true);
    try {
      const r = await api('ts_tojob', { job: id, keys });
      toast(r.added.length ? 'Added to the job: ' + r.added.join(', ') + '.' + (r.skipped.length ? ' ' + r.skipped.join('; ') : '') : r.skipped.length ? r.skipped.join('; ') : 'Nobody new was added.');
      setSel({});
      onAdded && onAdded();
      load();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<div className="stack">
      ${d.err ? html`<div className="note warn"><span>${d.err}</span></div>` : null}
      <${KitStats} items=${[{ v: d.buckets.strong || 0, l: 'Strong fit (80+)', tone: 'ok', onClick: () => setMin(80) }, { v: d.buckets.good || 0, l: 'Good fit (50–79)', onClick: () => setMin(50) }, { v: d.buckets.possible || 0, l: 'Possible (25–49)', onClick: () => setMin(25) }]} />
      <div className="toolbar">
        <span className="small">Must have: ${d.need.must.length ? d.need.must.join(', ') : 'add skills to the requisition'}${d.need.nice.length ? html` <span className="muted">· nice to have: ${d.need.nice.join(', ')}</span>` : null}</span>
        <div className="push">
          <select value=${min} onChange=${e => setMin(+e.target.value)} aria-label="Show from this fit"><option value="80">Strong fit only</option><option value="50">Good fit and better</option><option value="25">Everyone who fits a little</option></select>
          <button type="button" className="btn" disabled=${!keys.length || busy} onClick=${add}><${Icon} n="plus" />${busy ? 'Adding…' : keys.length ? 'Add ' + plural(keys.length, 'person', 'people') + ' to this job' : 'Add to this job'}</button>
        </div>
      </div>
      ${
        rows.length
          ? html`<div className="tblwrap"><table className="tbl">
              <thead><tr><th><input type="checkbox" aria-label="Choose everyone shown" checked=${rows.every(r => sel[r.k])} onChange=${e => setSel(e.target.checked ? Object.fromEntries(rows.map(r => [r.k, true])) : {})} /></th><th>Person</th><th>Fit</th><th>Skills that match</th><th>Where they are</th><th>Updated</th></tr></thead>
              <tbody>${rows.map(
                r => html`<tr key=${r.k}>
                  <td><input type="checkbox" checked=${!!sel[r.k]} onChange=${e => setSel({ ...sel, [r.k]: e.target.checked })} aria-label=${'Choose ' + r.n} /></td>
                  <td><b>${r.n}</b><div className="muted small">${[r.ti, r.years ? r.years + ' yrs' : '', r.auth].filter(Boolean).join(' · ')}</div></td>
                  <td><span className=${'chip ' + (r.score >= 80 ? 'ok' : r.score >= 50 ? 'amber' : '')}>${r.score}</span>${r.near ? html` <span className="chip" title="Near the job's location">near</span>` : null}</td>
                  <td className="small">${r.hits.map(h => html`<span key=${h.s} className=${'chip' + (h.nice ? '' : ' new')} style=${{ marginRight: 4 }}>${h.s}${h.y ? ' ' + h.y + 'y' : ''}</span>`)}${r.miss.length ? html`<div className="muted">missing ${r.miss.join(', ')}</div>` : null}</td>
                  <td className="small">${r.loc || '—'}<div className="muted">${r.src}</div></td>
                  <td className="small nw">${r.upd ? fmtDay(r.upd) : '—'}</td>
                </tr>`
              )}</tbody>
            </table></div>`
          : html`<${Empty} title="Nobody fits yet">${d.total ? 'Show everyone who fits a little, or ' : ''}Try the Boolean searches on the Overview tab, or add more resumes to the database. The index holds ${(d.index && d.index.n) || 0} people.<//>`
      }
      <p className="muted small" style=${{ margin: 0 }}>From the talent index: ATS candidates, the consultant database and the portals' resumes, with the years per skill read from their dated jobs. People already on this job are left out. Adding someone from the database or a portal makes their ATS record (with the resume).</p>
    </div>`;
}
function JobAssign({ id, d, onSaved }) {
  const P = usePortal();
  const A = P.admin;
  const toast = useToast();
  const staff = staffOf(A);
  const [rows, setRows] = useState(d.assign.map(a => ({ uid: a.uid, target: a.target || '', due: a.due || '', note: a.note || '' })));
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const prog = Object.fromEntries(d.assign.map(a => [a.uid, a]));
  const up = (i, patch) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const dirty = JSON.stringify(rows) !== JSON.stringify(d.assign.map(a => ({ uid: a.uid, target: a.target || '', due: a.due || '', note: a.note || '' })));
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('ats_req_assign', { id, rows: rows.filter(x => x.uid).map(x => ({ ...x, target: +x.target || 0 })), notify });
      toast('Assignments saved.' + (r.added ? ' ' + plural(r.added, 'new person', 'new people') + ' got a task' + (r.mailed ? ' and an email' : '') + '.' : ''));
      onSaved();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const remind = async uid => {
    try {
      await api('ats_req_remind', { id, uid });
      toast('Reminder sent: a task and an email.');
      onSaved();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return html`<div className="stack">
      <p className="muted small" style=${{ margin: 0 }}>Who works this job and how many submissions each should make by when. Progress counts the candidates each person moved to an interview stage or beyond (Submitted to client counts), the ones they added, and hires. Someone behind a day before the date gets a reminder by itself; you can send one any time.</p>
      ${
        rows.length
          ? html`<div className="tblwrap"><table className="tbl">
              <thead><tr><th>Recruiter</th><th>Target</th><th>Due</th><th>Progress</th><th>Note</th><th /></tr></thead>
              <tbody>${rows.map((r, i) => {
                const p = prog[r.uid];
                return html`<tr key=${i}>
                  <td><select value=${r.uid} onChange=${e => up(i, { uid: e.target.value })} aria-label="Recruiter"><option value="">Choose…</option>${staff.map(m => html`<option key=${m.id} value=${m.id} disabled=${m.id !== r.uid && rows.some(x => x.uid === m.id)}>${m.u.p.n}</option>`)}</select></td>
                  <td><input type="number" min="0" max="999" value=${r.target} onInput=${e => up(i, { target: e.target.value })} style=${{ width: 80 }} aria-label="Submission target" /></td>
                  <td><input type="date" value=${r.due} onInput=${e => up(i, { due: e.target.value })} aria-label="Due date" /></td>
                  <td style=${{ minWidth: 200 }}>${p ? html`<${Fragment}><${Bar} v=${p.sub} max=${Math.max(p.target || 0, p.sub, 1)} label=${p.sub + (p.target ? ' of ' + p.target : '') + ' submitted'} tone=${p.behind ? 'var(--red, #b42318)' : undefined} /><div className="muted small">${p.src} added · ${p.hired} hired${p.left != null ? ' · ' + (p.left < 0 ? Math.abs(p.left) + ' days late' : p.left === 0 ? 'due today' : p.left + ' days left') : ''}${p.rem ? ' · reminded ' + fmtDay(p.rem) : ''}</div><//>` : html`<span className="muted small">Saved assignments show progress</span>`}</td>
                  <td><input value=${r.note} onInput=${e => up(i, { note: e.target.value })} placeholder="e.g. local candidates first" maxLength="200" /></td>
                  <td className="r"><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>${p && html`<button type="button" className="btn ghost sm" onClick=${() => remind(r.uid)} title="A task and an email to them">Remind</button>`}<button type="button" className="btn ghost icon sm" onClick=${() => setRows(rows.filter((x, k) => k !== i))} aria-label="Remove"><${Icon} n="x" /></button></div></td>
                </tr>`;
              })}</tbody>
            </table></div>`
          : html`<${Empty} title="Nobody is assigned">Assign recruiters with a target to keep the job moving.<//>`
      }
      <div className="actions">
        <button type="button" className="btn ghost sm" onClick=${() => setRows([...rows, { uid: '', target: 3, due: '', note: '' }])}><${Icon} n="plus" />Assign a recruiter</button>
        <label className="check small"><input type="checkbox" checked=${notify} onChange=${e => setNotify(e.target.checked)} /><span>Email the people newly assigned (they always get a task)</span></label>
        <div className="push"><button type="button" className="btn" disabled=${busy || !dirty} onClick=${save}>${busy ? 'Saving…' : 'Save assignments'}</button></div>
      </div>
    </div>`;
}
function JobShare({ id, d, onChanged }) {
  const P = usePortal();
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const pub = d.pub;
  const code = d.code;
  const listed = pub.open !== false;
  const link = ch => jobLinkFor(id, code, ch);
  const item = [{ pub }];
  const refLink = jobShareLink(id, 'referral') + '&ref=' + String(P.uid || '').slice(2, 8);
  const act = async (a, board) => {
    setBusy(a + (board || ''));
    try {
      const r = await api('ats_posting_act', { ids: [id], act: a, board });
      if (r.skipped.length) toast(r.skipped.map(s => s.why).join('; '), true);
      else toast(a === 'refresh' ? 'Refreshed: the job boards see a new date when they next read the feed.' : 'Job boards updated.');
      if (r.diceLive.length) toast('It is still live on Dice: the Dice automation closes it at its next run, or close it under Sourcing › Jobs on Dice.');
      onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const cfg = d.boardsCfg || [];
  const lastU = pub.u || pub.at;
  const canRefresh = listed && d.boards.length && Date.now() - lastU > 72 * 3600000;
  return html`<div className="stack">
      ${!listed ? html`<div className="note warn"><span>This requisition is not open on the careers page, so links show "This role has been filled" and the job boards do not list it. Open it (Edit › Open) to share it.</span></div>` : null}
      <div className="g2" style=${{ alignItems: 'start' }}>
        <section className="panel stack">
          <h2 className="ph">Share links</h2>
          <p className="muted small" style=${{ margin: 0 }}>Each link carries its channel, so visits and applications are counted per channel. The short link uses the job code.</p>
          <div className="jlinkrow"><b className="small">Short link</b><input readOnly value=${link('')} onFocus=${e => e.target.select()} aria-label="Short link" /><button type="button" className="btn ghost sm" onClick=${() => copyText(toast, link(''))}>Copy</button></div>
          <div className="jlinkrow"><b className="small">Your referral link</b><input readOnly value=${refLink} onFocus=${e => e.target.select()} aria-label="Your referral link" /><button type="button" className="btn ghost sm" onClick=${() => copyText(toast, refLink)}>Copy</button></div>
          <div className="tblwrap"><table className="tbl small">
            <thead><tr><th>Channel</th><th className="r">Visits</th><th className="r">Applied</th><th /></tr></thead>
            <tbody>${JOB_SHARE.map(c => {
              const net = (typeof RS_NETS !== 'undefined' ? RS_NETS : []).find(n => n.k === c.net);
              const l = link(c.k);
              const href = net && net.url ? net.url(l, rsPostText(item, l), rsShortText(item), pub.ti + ' at ' + wsName()) : '';
              return html`<tr key=${c.k}><td>${c.n}</td><td className="r num">${(d.clicks.ch || {})[c.k] || 0}</td><td className="r num">${(d.apps.ch || {})[c.k] || 0}</td><td className="r"><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}><button type="button" className="btn ghost sm" onClick=${() => copyText(toast, l)}>Copy link</button>${href && listed ? html`<a className="btn ghost sm" href=${href} target="_blank" rel="noopener noreferrer"><${Icon} n="send" />Share</a>` : null}</div></td></tr>`;
            })}
            ${['careers', 'qr', 'referral', 'direct'].map(k => html`<tr key=${k}><td>${d.channels[k] || k}</td><td className="r num">${(d.clicks.ch || {})[k] || 0}</td><td className="r num">${(d.apps.ch || {})[k] || 0}</td><td /></tr>`)}
            </tbody>
          </table></div>
          <p className="muted small" style=${{ margin: 0 }}>${plural(d.clicks.n, 'visit')} in all · ${plural(d.apps.n, 'application')}. Visits are people only (link previews are not counted), once per address and hour.</p>
        </section>
        <section className="panel stack">
          <h2 className="ph">QR code</h2>
          <p className="muted small" style=${{ margin: 0 }}>For flyers, job fairs and the office door: it opens ${code} on the careers page and counts as the QR channel.</p>
          <${JobQr} text=${link('qr')} name=${code || 'job'} />
          <code className="small">${link('qr')}</code>
        </section>
      </div>
      <section className="panel stack">
        <div className="ph-row"><h2 className="ph">Job boards</h2><span className="muted small">The boards read the job feeds (Admin › Sourcing connections). Switch a board off and the job leaves its feed.</span></div>
        ${pub.internal ? html`<div className="note info"><span>Internal only: shared by its link, never sent to job boards.</span></div>` : null}
        <div className="jboards">${JOB_BOARDS.map(([k, n]) => {
          const on = cfg.includes(k);
          return html`<button key=${k} type="button" className=${'jbp' + (on ? ' on' : '')} aria-pressed=${on} disabled=${!!busy || pub.internal} onClick=${() => act(on ? 'board_off' : 'board_on', k)} title=${on ? 'On ' + n + ': click to take it off' : 'Not on ' + n + ': click to put it on'}>${on ? html`<${Icon} n="check" />` : null}${n}</button>`;
        })}</div>
        <div className="actions">
          <button type="button" className="btn ghost sm" disabled=${!!busy || pub.internal || cfg.length === JOB_BOARDS.length} onClick=${() => act('boards_all')}>Every board</button>
          <button type="button" className="btn ghost sm" disabled=${!!busy || pub.internal || !cfg.length} onClick=${() => act('boards_none')}>No boards (careers page only)</button>
          <button type="button" className="btn ghost sm" disabled=${!!busy || !canRefresh} onClick=${() => act('refresh')} title="Gives the job a new date in the feeds, at most once every 3 days"><${Icon} n="refresh" />Refresh on the boards</button>
          <span className="muted small">Last dated ${fmtTs(lastU)}</span>
        </div>
        <p className="small" style=${{ margin: 0 }}><b>Dice:</b> ${pub.dice && pub.dice.st ? html`${pub.dice.st === 'live' ? 'live' : pub.dice.st}${pub.dice.id ? ' · posting ' + pub.dice.id : pub.dice.noId ? ' · ID unknown' : ''}${pub.dice.postedAt ? ' · sent ' + fmtDay(pub.dice.postedAt) : ''}` : 'not posted through the Dice connection'}${P.isAdmin ? html` · <a href="#/portal/admin/sources">Jobs on Dice</a>` : null}</p>
      </section>
    </div>`;
}
function JobInsights({ d, onNav }) {
  const ins = d.insights;
  const p = ins.pay;
  const stat = s => (s ? hourly(s.min) + ' – ' + hourly(s.max) + ' (median ' + hourly(s.med) + ', ' + s.n + ')' : 'not enough data yet');
  return html`<div className="stack">
      <div className="g2" style=${{ alignItems: 'start' }}>
        <section className="panel stack">
          <h2 className="ph">Time</h2>
          <dl className="kv small">
            <dt>Open for</dt><dd>${ins.time.age ? plural(ins.time.age, 'day') : 'less than a day'}</dd>
            <dt>First applicant</dt><dd>${ins.time.first == null ? 'none yet' : ins.time.first === 0 ? 'the same day' : 'after ' + plural(ins.time.first, 'day')}</dd>
            <dt>Similar jobs filled in</dt><dd>${ins.time.fill ? Math.round(ins.time.fill.med) + ' days (median of ' + plural(ins.time.fill.n, 'hire') + ')' : 'no hires on similar jobs yet'}</dd>
          </dl>
          ${ins.client ? html`<p className="small" style=${{ margin: 0 }}><b>${ins.client.n || 'This client'}:</b> ${ins.client.open} other open, ${ins.client.filled} filled, ${ins.client.all} in all.</p>` : null}
        </section>
        <section className="panel stack">
          <h2 className="ph">Pay and rates (per hour)</h2>
          <dl className="kv small">
            <dt>Offers made</dt><dd>${stat(p.offers)}</dd>
            <dt>Candidates asked</dt><dd>${stat(p.asks)}</dd>
            <dt>This job pays</dt><dd>${p.ours.min != null || p.ours.max != null ? hourly(p.ours.min) + ' – ' + hourly(p.ours.max) : 'no pay range set'}</dd>
            <dt>Bill rate</dt><dd>${p.bill != null ? hourly(p.bill) + (p.margin ? ' · margin ' + hourly(p.margin.amt) + (p.margin.pct != null ? ' (' + p.margin.pct + '%)' : '') : '') : 'not set'}</dd>
          </dl>
          <p className="muted small" style=${{ margin: 0 }}>From this job and similar ones; yearly figures are divided by 2,080 hours.${p.asks && p.ours.max != null && p.asks.med > p.ours.max ? ' Candidates are asking more than this job pays.' : ''}</p>
        </section>
      </div>
      <div className="g2" style=${{ alignItems: 'start' }}>
        <section className="panel stack">
          <h2 className="ph">Where this job's candidates come from</h2>
          ${ins.sources.length ? html`<table className="tbl small"><thead><tr><th>Source</th><th className="r">Candidates</th><th className="r">Hired</th></tr></thead><tbody>${ins.sources.map(s => html`<tr key=${s.src}><td>${s.src}</td><td className="r num">${s.n}</td><td className="r num">${s.hired}</td></tr>`)}</tbody></table>` : html`<p className="muted small" style=${{ margin: 0 }}>No candidates yet.</p>`}
          ${ins.best.length ? html`<${Fragment}><b className="small">What worked on similar jobs</b><table className="tbl small"><thead><tr><th>Source</th><th className="r">Candidates</th><th className="r">Hired</th><th className="r">Hire rate</th></tr></thead><tbody>${ins.best.map(s => html`<tr key=${s.src}><td>${s.src}</td><td className="r num">${s.n}</td><td className="r num">${s.hired}</td><td className="r num">${s.rate}%</td></tr>`)}</tbody></table><//>` : null}
        </section>
        <section className="panel stack">
          <h2 className="ph">Similar requisitions</h2>
          ${
            ins.similar.length
              ? html`<table className="tbl small"><thead><tr><th>Job</th><th className="r">Candidates</th><th className="r">Hired</th><th className="r">Days to fill</th></tr></thead><tbody>${ins.similar.map(
                  s => html`<tr key=${s.id} className="click" tabIndex="0" onClick=${() => onNav(s.id)} onKeyDown=${e => { if (e.key === 'Enter') onNav(s.id); }}><td><code>${s.code}</code> ${s.ti}<div className="muted">${[s.loc, s.open ? 'open' : 'closed', fmtDay(s.at)].filter(Boolean).join(' · ')}</div></td><td className="r num">${s.n}</td><td className="r num">${s.hired}</td><td className="r num">${s.days != null ? s.days : '—'}</td></tr>`
                )}</tbody></table>`
              : html`<p className="muted small" style=${{ margin: 0 }}>No similar requisitions yet.</p>`
          }
        </section>
      </div>
    </div>`;
}
function JobActivity({ id, d, onOpenCand, onSaved }) {
  const P = usePortal();
  const A = P.admin;
  const toast = useToast();
  const [text, setText] = useState('');
  const [to, setTo] = useState([]);
  const [busy, setBusy] = useState(false);
  const [only, setOnly] = useState('');
  const staff = staffOf(A).filter(m => m.id !== P.uid);
  const add = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r = await api('ats_req_note', { id, text, to });
      toast('Note added.' + (r.tasks ? ' ' + plural(r.tasks, 'person', 'people') + ' got a task.' : ''));
      setText('');
      setTo([]);
      onSaved();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const list = d.activity.filter(a => !only || (only === 'job' ? a.kind !== 'cand' : a.kind === only));
  return html`<div className="stack">
      <section className="panel stack">
        <textarea value=${text} onInput=${e => setText(e.target.value)} placeholder="A note about this job: what the client said, a change in the plan…" maxLength="2000" aria-label="Note" />
        <div className="actions">
          <span className="small muted">Tell:</span>
          <div className="portalpicks">${staff.slice(0, 30).map(m => html`<label key=${m.id} className=${'pick' + (to.includes(m.id) ? ' on' : '')}><input type="checkbox" checked=${to.includes(m.id)} onChange=${e => setTo(e.target.checked ? [...to, m.id] : to.filter(x => x !== m.id))} /><span>${m.u.p.n}</span></label>`)}</div>
          <div className="push"><button type="button" className="btn" disabled=${busy || !text.trim()} onClick=${add}>${busy ? 'Adding…' : 'Add note'}</button></div>
        </div>
      </section>
      <div className="seg">${[['', 'Everything'], ['job', 'The requisition'], ['note', 'Notes'], ['cand', 'Candidates']].map(([k, n]) => html`<button key=${k} type="button" className=${only === k ? 'on' : ''} onClick=${() => setOnly(k)}>${n}</button>`)}</div>
      ${
        list.length
          ? html`<ul className="jtimeline">${list.map(
              (a, i) => html`<li key=${i} className=${a.kind}>
                <span className="muted small nw">${fmtTs(a.t)}</span>
                <div><b className="small">${a.who || 'System'}</b>${a.kind === 'cand' ? html` <span className="small">on <a href="#" onClick=${e => { e.preventDefault(); onOpenCand(a.cid); }}>${a.n}</a></span>` : null}<div className="small">${a.ev}</div>${a.text ? html`<div className="small jnote">${a.text}</div>` : null}</div>
              </li>`
            )}</ul>`
          : html`<p className="muted small">Nothing yet.</p>`
      }
    </div>`;
}
/* ---------------- templates ---------------- */
function AtsTplPicker({ onPick, onClose, manage }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [ren, setRen] = useState(null);
  const load = () => api('ats_tpl_list', {}).then(r => setRows(r.rows)).catch(e => { toast(errText(e), true); setRows([]); });
  useEffect(() => {
    load();
  }, []);
  const del = async t => {
    if (!confirm('Delete the template "' + t.n + '"? Requisitions made from it stay as they are.')) return;
    try {
      await api('ats_tpl_delete', { id: t.id });
      load();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const rename = async () => {
    try {
      await api('ats_tpl_save', { id: ren.id, n: ren.n });
      setRen(null);
      load();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return html`<${Modal} title=${manage ? 'Requisition templates' : 'New requisition'} onClose=${onClose} wide>
      <div className="stack">
        ${!manage && html`<button type="button" className="btn" onClick=${() => onPick(null)}><${Icon} n="plus" />Blank requisition</button>`}
        ${
          !rows
            ? html`<${Spinner} />`
            : rows.length
              ? html`<div className="tblwrap"><table className="tbl">
                  <thead><tr><th>Template</th><th>Starts with</th><th className="r">Used</th><th /></tr></thead>
                  <tbody>${rows.map(
                    t => html`<tr key=${t.id}>
                      <td>${ren && ren.id === t.id ? html`<div className="actions"><input value=${ren.n} onInput=${e => setRen({ ...ren, n: e.target.value })} maxLength="80" aria-label="Template name" /><button type="button" className="btn sm" onClick=${rename}>Save</button></div>` : html`<b>${t.n}</b>`}<div className="muted small">${t.by ? 'by ' + t.by + ' · ' : ''}${fmtDay(t.at)}</div></td>
                      <td className="small">${[t.pub.ti, t.pub.ty, t.pub.md, t.job.dept].filter(Boolean).join(' · ') || '—'}${(t.job.stages || []).length ? html`<div className="muted">${t.job.stages.length} stages${(t.pub.qs || []).length ? ' · ' + plural(t.pub.qs.length, 'screening question') : ''}</div>` : null}</td>
                      <td className="r num">${t.uses}</td>
                      <td className="r"><div className="actions" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>${!manage && html`<button type="button" className="btn sm" onClick=${() => onPick(t)}>Use</button>`}<button type="button" className="btn ghost sm" onClick=${() => setRen({ id: t.id, n: t.n })}>Rename</button><button type="button" className="btn ghost icon sm" onClick=${() => del(t)} aria-label=${'Delete ' + t.n}><${Icon} n="trash" /></button></div></td>
                    </tr>`
                  )}</tbody>
                </table></div>`
              : html`<p className="muted small" style=${{ margin: 0 }}>No templates yet. Open a requisition and choose "Save as template" to reuse its posting, screening questions, pipeline and pay range.</p>`
        }
      </div>
    <//>`;
}
function AtsSaveTpl({ id, ti, onClose }) {
  const toast = useToast();
  const [n, setN] = useState(ti || '');
  const [parts, setParts] = useState({ post: true, qs: true, pipe: true, pay: false });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!n.trim()) return toast('Name the template.', true);
    setBusy(true);
    try {
      await api('ats_tpl_save', { from: id, n: n.trim(), parts });
      toast('Template saved. Use it from New requisition.');
      onClose();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const box = (k, label) => html`<label className="check"><input type="checkbox" checked=${!!parts[k]} onChange=${e => setParts({ ...parts, [k]: e.target.checked })} /><span>${label}</span></label>`;
  return html`<${Modal} title="Save as template" onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save template'}</button>`}>
      <div className="form">
        <${Field} label="Template name"><input value=${n} onInput=${e => setN(e.target.value)} maxLength="80" /><//>
        ${box('post', 'The posting: title, type, work mode, skills, location and description')}
        ${box('qs', 'Screening questions and knockouts')}
        ${box('pipe', 'Pipeline stages, scorecard and interview kits')}
        ${box('pay', 'Pay range and bill rate')}
        <p className="muted small" style=${{ margin: 0 }}>The hiring team, client, approvals and candidates are never part of a template.</p>
      </div>
    <//>`;
}
/* ---------------- the job boards desk ---------------- */
function PostingsTab({ onOpenReq }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [all, setAll] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState({});
  const [busy, setBusy] = useState('');
  const load = () =>
    api('ats_postings', { all })
      .then(setD)
      .catch(e => {
        toast(errText(e), true);
        setD({ rows: [], boards: [], dice: {} });
      });
  useEffect(() => {
    load();
  }, [all]);
  if (!d) return html`<${Spinner} />`;
  const ql = q.trim().toLowerCase();
  const rows = d.rows.filter(r => !ql || [r.code, r.ti, r.loc].join(' ').toLowerCase().includes(ql));
  const ids = Object.keys(sel).filter(k => sel[k]);
  const act = async (a, board, only) => {
    const use = only || ids;
    if (!use.length) return;
    setBusy(a + (board || '') + (only ? only[0] : ''));
    try {
      const r = await api('ats_posting_act', { ids: use, act: a, board });
      const msg = r.done.length ? (a === 'refresh' ? 'Refreshed ' + plural(r.done.length, 'job') + '.' : 'Updated ' + plural(r.done.length, 'job') + '.') : 'Nothing changed.';
      toast(msg + (r.skipped.length ? ' ' + r.skipped.map(s => s.why).join('; ') : ''), !r.done.length && r.skipped.length > 0);
      if (r.diceLive.length) toast(r.diceLive.map(x => (x.code || x.ti)).join(', ') + ': still live on Dice until the Dice automation closes ' + (r.diceLive.length === 1 ? 'it' : 'them') + ' (or close it under Sourcing › Jobs on Dice).');
      load();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const exportCsv = () => {
    const head = ['Code', 'Title', 'Location', 'Open', 'Internal', 'Boards', 'Dice', 'Dice ID', 'Posted', 'Last dated', 'Applicants', 'Visits', 'Top sources'];
    const out = rows.map(r => [r.code, r.ti, r.loc, r.open ? 'yes' : 'no', r.internal ? 'yes' : 'no', r.on.length === JOB_BOARDS.length ? 'every board' : r.on.join(' '), r.dice ? r.dice.st + (r.dice.noId ? ' (ID unknown)' : '') : '', r.dice ? r.dice.id : '', fmtDay(r.at), fmtDay(r.u), r.apps, r.clicks, Object.entries(r.src).slice(0, 3).map(([s, n]) => s + ' ' + n).join('; ')]);
    saveDownload('job-postings-' + dkey() + '.csv', toCSV([head, ...out]));
  };
  const gap = d.gap || 72 * 3600000;
  return html`<div className="stack">
      <div className="toolbar">
        <input type="search" value=${q} onInput=${e => setQ(e.target.value)} placeholder="Code, title or place" style=${{ maxWidth: 260 }} aria-label="Find a job" />
        <label className="check small"><input type="checkbox" checked=${all} onChange=${e => setAll(e.target.checked)} /><span>Show closed jobs too</span></label>
        <div className="push">
          <button type="button" className="btn ghost sm" disabled=${!ids.length || !!busy} onClick=${() => act('refresh')}><${Icon} n="refresh" />Refresh${ids.length ? ' ' + ids.length : ''}</button>
          <button type="button" className="btn ghost sm" disabled=${!ids.length || !!busy} onClick=${() => act('boards_all')}>Every board</button>
          <button type="button" className="btn ghost sm" disabled=${!ids.length || !!busy} onClick=${() => act('boards_none')}>No boards</button>
          <button type="button" className="btn ghost sm" onClick=${exportCsv}><${Icon} n="down" />CSV</button>
        </div>
      </div>
      ${
        rows.length
          ? html`<div className="tblwrap"><table className="tbl jposts">
              <thead><tr><th><input type="checkbox" aria-label="Choose every job shown" checked=${rows.length > 0 && rows.every(r => sel[r.id])} onChange=${e => setSel(e.target.checked ? Object.fromEntries(rows.map(r => [r.id, true])) : {})} /></th><th>Job</th><th>Job boards</th><th>Dice</th><th>Dated</th><th className="r">Applied</th><th className="r">Visits</th></tr></thead>
              <tbody>${rows.map(r => {
                const off = !r.open || r.internal;
                const due = r.open && r.on.length && Date.now() - r.u > gap;
                return html`<tr key=${r.id}>
                  <td><input type="checkbox" checked=${!!sel[r.id]} onChange=${e => setSel({ ...sel, [r.id]: e.target.checked })} aria-label=${'Choose ' + r.ti} /></td>
                  <td><a href="#" className="jlink" onClick=${e => { e.preventDefault(); onOpenReq(r.id); }}><code>${r.code}</code> <b>${r.ti}</b></a><div className="muted small">${[r.loc, !r.open ? 'closed' : '', r.internal ? 'internal only' : '', r.offBoards ? 'careers page only' : ''].filter(Boolean).join(' · ')}</div></td>
                  <td><div className="jboards sm">${JOB_BOARDS.map(([k, n]) => {
                    const on = r.cfg.includes(k);
                    return html`<button key=${k} type="button" className=${'jbp sm' + (on ? ' on' : '') + (on && off ? ' idle' : '')} aria-pressed=${on} disabled=${!!busy || r.internal} title=${(on ? n + ': on' : n + ': off') + (off && on ? ' (the job is not open, so no feed lists it)' : '')} onClick=${() => act(on ? 'board_off' : 'board_on', k, [r.id])}>${n}</button>`;
                  })}</div></td>
                  <td className="small">${r.dice ? html`<${Chip} s=${r.dice.st === 'live' ? (r.dice.noId ? 'amber' : 'ok') : ''}>${r.dice.st === 'live' ? (r.dice.noId ? 'live · ID unknown' : 'live') : r.dice.st}<//>${r.dice.id ? html`<div className="muted">${r.dice.url ? html`<a href=${r.dice.url} target="_blank" rel="noopener noreferrer">${r.dice.id}</a>` : r.dice.id}</div>` : null}${r.dice.st === 'live' && !r.on.includes('dice') ? html`<div className="late">Dice is off for this job: it closes there at the next run</div>` : null}` : html`<span className="muted">—</span>`}</td>
                  <td className="small nw">${fmtDay(r.u)}${due ? html`<div><button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => act('refresh', '', [r.id])}>Refresh</button></div>` : null}</td>
                  <td className="r num">${r.apps}${Object.keys(r.src).length ? html`<div className="muted small">${Object.entries(r.src).slice(0, 2).map(([s, n]) => s + ' ' + n).join(', ')}</div>` : null}</td>
                  <td className="r num">${r.clicks}</td>
                </tr>`;
              })}</tbody>
            </table></div>`
          : html`<${Empty} title="No postings">Open requisitions show here with the job boards that list them.<//>`
      }
      <details className="panel">
        <summary><b>Job feeds</b> <span className="muted small">(give each board its address once; jobs follow by themselves)</span></summary>
        <div className="stack" style=${{ marginTop: 10 }}>
          ${d.boards.map(b => html`<div key=${b.k} className="jlinkrow"><b className="small">${b.n}</b><input readOnly value=${b.url} onFocus=${e => e.target.select()} aria-label=${b.n + ' feed'} /><button type="button" className="btn ghost sm" onClick=${() => copyText(toast, b.url)}>Copy</button></div>`)}
          <p className="muted small" style=${{ margin: 0 }}>A board lists a job when the job is open, not internal only, and that board is switched on for it. Refreshing gives a job a new date in the feeds (at most once every 3 days; boards treat frequent reposting as spam). Dice through its API: ${d.dice.ready ? (d.dice.auto ? 'kept in step by itself' : 'posted by hand under Sourcing › Jobs on Dice') : 'not set up'}.</p>
        </div>
      </details>
    </div>`;
}
