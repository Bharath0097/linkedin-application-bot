/* ================= v44 Goals & reviews (in js/work.js, fetched when opened) =================
   Goals with key results and check-ins, aligned to team and company goals; review cycles (self review, the manager's
   review, shared, acknowledged) and HR's summary. Server: api/goals.php (routes pf_*). */
const PF_TONE = { on: 'ok', risk: 'amber', off: 'red' };
const PF_RTONE = { self: 'amber', mgr: 'info', shared: 'info', ack: 'ok' };
const pfDay = d => (d ? fmtDay(new Date(d + 'T12:00:00').getTime()) : '');
const pfYmd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const pfQuarter = () => {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3);
  return [pfYmd(new Date(d.getFullYear(), q * 3, 1)), pfYmd(new Date(d.getFullYear(), q * 3 + 3, 0))];
};
const pfAgo = t => {
  if (!t) return 'no check-in yet';
  const d = Math.floor((Date.now() - t) / 86400000);
  return d < 1 ? 'checked in today' : d === 1 ? 'checked in yesterday' : 'checked in ' + d + ' days ago';
};
const pfNum = v => (+v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const pfKrText = k => (k.t === 'done' ? (k.cur ? 'Done' : 'Not done yet') : pfNum(k.cur) + (k.unit === '%' ? '%' : '') + ' of ' + pfNum(k.to) + (k.unit && k.unit !== '%' ? ' ' + k.unit : k.unit === '%' ? '%' : '') + (+k.from ? ' (from ' + pfNum(k.from) + ')' : ''));

function PfBar({ p, h }) {
  return html`<div className="pfbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${p}><span className=${h || ''} style=${{ width: Math.max(0, Math.min(100, p)) + '%' }}></span></div>`;
}

function GoalsApp({ q, staff }) {
  const [tab, setTab] = useState((q && q.t) || 'mine');
  const [home, setHome] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState((q && q.g) || '');
  const [edit, setEdit] = useState(null);
  const [tick, setTick] = useState(0);
  const load = () =>
    api('pf_home')
      .then(setHome)
      .catch(setErr);
  useEffect(() => {
    load();
  }, [tick]);
  if (err && !home) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!home) return html`<${Spinner} label="Loading goals…" />`;
  const reload = () => setTick(t => t + 1);
  const waiting = home.todo.self + home.todo.mgr + home.todo.ack;
  const tabs = [['mine', 'My goals'], ...(home.team ? [['team', 'Team']] : []), ['company', 'Company & team'], ['reviews', 'Reviews', waiting || null]];
  return html`<div className="stack pfpage">
      <${KitTabs} tabs=${tabs} tab=${tab} onTab=${setTab} />
      ${tab === 'mine' && html`<${PfMine} home=${home} onOpen=${setOpen} onNew=${() => setEdit({ kind: 'mine', owner: home.me })} />`}
      ${tab === 'team' && html`<${PfTeam} tick=${tick} onOpen=${setOpen} onNew=${owner => setEdit({ kind: 'mine', owner })} />`}
      ${tab === 'company' && html`<${PfCompany} tick=${tick} home=${home} onOpen=${setOpen} onNew=${kind => setEdit({ kind, owner: kind === 'company' ? '' : home.me })} />`}
      ${tab === 'reviews' && html`<${PfReviews} tick=${tick} home=${home} onChanged=${reload} />`}
      ${open && html`<${PfGoal} id=${open} home=${home} onClose=${() => setOpen('')} onEdit=${g => (setOpen(''), setEdit(g))} onChanged=${reload} onOpen=${setOpen} />`}
      ${edit && html`<${PfEditor} g=${edit} home=${home} onClose=${() => setEdit(null)} onSaved=${g => (setEdit(null), reload(), setOpen(g.id))} />`}
    </div>`;
}

function PfCard({ g, onOpen, who }) {
  return html`<button type="button" className="pfgoal" onClick=${() => onOpen(g.id)}>
      <div className="pfhead"><b>${g.title}</b><span className="pfpct num">${g.prog}%</span></div>
      <${PfBar} p=${g.prog} h=${g.st === 'active' ? g.health : 'done'} />
      <div className="pfmeta">
        ${g.kind !== 'mine' && html`<${Chip} s="info">${g.kind === 'team' ? 'Team' : 'Company'}<//>`}
        ${g.st !== 'active' ? html`<${Chip} s=${g.st === 'done' ? 'ok' : ''}>${g.st === 'done' ? 'Achieved' : 'Dropped'}<//>` : g.health ? html`<${Chip} s=${PF_TONE[g.health]}>${{ on: 'On track', risk: 'At risk', off: 'Off track' }[g.health]}<//>` : null}
        ${who && html`<span>${g.ownerN}</span>`}
        ${g.due && html`<span>due ${pfDay(g.due)}</span>`}
        <span>${g.krs.length ? g.krs.length + ' key result' + (g.krs.length === 1 ? '' : 's') : 'progress by hand'}</span>
        ${g.st === 'active' && html`<span>${pfAgo(g.ciAt)}</span>`}
      </div>
    </button>`;
}

function PfMine({ home, onOpen, onNew }) {
  const act = home.mine.filter(g => g.st === 'active');
  const closed = home.mine.filter(g => g.st !== 'active');
  const avg = act.length ? Math.round(act.reduce((t, g) => t + g.prog, 0) / act.length) : 0;
  const todo = home.todo;
  return html`<div className="stack">
      ${(todo.self > 0 || todo.ack > 0 || todo.mgr > 0) &&
      html`<div className="note amber"><span>${[todo.self && 'Your self review is waiting for you', todo.mgr && todo.mgr + ' review' + (todo.mgr === 1 ? '' : 's') + ' to write for your team', todo.ack && 'A review was shared with you: read and acknowledge it'].filter(Boolean).join(' · ')}. Open the Reviews tab.</span></div>`}
      <div className="ph-row"><div className="muted small">Goals you are working toward, each with the results that show it is done. Check in every week or two: move the numbers and say whether it is on track.</div><button className="btn" onClick=${onNew}><${Icon} n="plus" />New goal</button></div>
      ${act.length > 0 && html`<${KitStats} items=${[{ v: act.length, l: act.length === 1 ? 'Active goal' : 'Active goals' }, { v: avg + '%', l: 'Average progress' }, { v: act.filter(g => g.health === 'risk' || g.health === 'off').length, l: 'At risk or off track', tone: act.some(g => g.health === 'off') ? 'red' : '' }]} />`}
      ${act.length ? html`<div className="pfgrid">${act.map(g => html`<${PfCard} key=${g.id} g=${g} onOpen=${onOpen} />`)}</div>` : html`<${Empty} title="No goals yet">Set a goal for this quarter: what you want to achieve, and two or three results that show it (a number to reach, a percentage, or something done). Your manager sees it and can help.<//>`}
      ${closed.length > 0 && html`<details className="panel"><summary>Achieved and dropped (${closed.length})</summary><div className="pfgrid" style=${{ marginTop: 10 }}>${closed.map(g => html`<${PfCard} key=${g.id} g=${g} onOpen=${onOpen} />`)}</div></details>`}
    </div>`;
}

function PfTeam({ tick, onOpen, onNew }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [show, setShow] = useState('');
  const [qq, setQq] = useState('');
  const load = () =>
    api('pf_team')
      .then(setD)
      .catch(setErr);
  useEffect(() => {
    load();
  }, [tick]);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} />`;
  const rows = d.people.filter(p => !qq || p.n.toLowerCase().includes(qq.toLowerCase()));
  const act = d.people.reduce((t, p) => t + p.active, 0);
  return html`<div className="stack">
      <${KitStats} items=${[{ v: d.people.length, l: 'People' }, { v: d.people.filter(p => !p.active).length, l: 'Without an active goal' }, { v: d.people.reduce((t, p) => t + p.risk, 0), l: 'Goals at risk or off track', tone: 'amber' }, { v: d.people.reduce((t, p) => t + p.stale, 0) + ' of ' + act, l: 'Not checked in for 30 days' }]} />
      ${d.people.length > 8 && html`<div className="toolbar"><input type="search" placeholder="Find a person" value=${qq} onInput=${e => setQq(e.target.value)} aria-label="Find a person" /></div>`}
      ${
        d.people.length
          ? html`<div className="tblwrap"><table className="tbl small"><thead><tr><th>Person</th><th>Active goals</th><th style=${{ minWidth: 160 }}>Average progress</th><th>Needs attention</th><th></th></tr></thead><tbody>${rows.map(
              p => html`<${Fragment} key=${p.id}><tr className="pfrow" onClick=${() => setShow(show === p.id ? '' : p.id)}><td><b>${p.n}</b>${!p.direct && p.mgrN ? html`<div className="muted">reports to ${p.mgrN}</div>` : null}</td><td>${p.active}</td><td>${p.avg === null ? html`<span className="muted">–</span>` : html`<div className="actions"><${PfBar} p=${p.avg} /><span className="num">${p.avg}%</span></div>`}</td><td>${p.risk ? html`<${Chip} s="amber">${p.risk} at risk<//>` : null} ${p.stale ? html`<span className="muted">${p.stale} not checked in</span>` : null}</td><td className="r"><button type="button" className="btn ghost sm" onClick=${e => (e.stopPropagation(), onNew(p.id))}>Set a goal</button></td></tr>
                ${show === p.id && html`<tr><td colSpan="5">${p.goals.length ? html`<div className="pfgrid">${p.goals.map(g => html`<${PfCard} key=${g.id} g=${g} onOpen=${onOpen} />`)}</div>` : html`<span className="muted">No goals yet.</span>`}</td></tr>`}<//>`
            )}</tbody></table></div>`
          : html`<${Empty} title="Nobody reports to you yet">People whose manager is you (Team › the person › Manager) show here with their goals.<//>`
      }
    </div>`;
}

function PfCompany({ tick, home, onOpen, onNew }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const load = () =>
    api('pf_company')
      .then(setD)
      .catch(setErr);
  useEffect(() => {
    load();
  }, [tick]);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} />`;
  const co = d.goals.filter(g => g.kind === 'company');
  const team = d.goals.filter(g => g.kind !== 'company');
  const group = (title, list) =>
    list.length > 0 &&
    html`<section className="stack"><h3 className="pfh">${title}</h3>${list.map(
      g => html`<div key=${g.id} className="panel pftree">
          <${PfCard} g=${g} onOpen=${onOpen} who=${g.kind !== 'company'} />
          ${g.kids.length > 0 && html`<ul className="pfkids">${g.kids.map(k => html`<li key=${k.id}><button type="button" className="linkbtn" onClick=${() => onOpen(k.id)}>${k.title}</button><span className="muted"> · ${k.ownerN}</span><span className="pfkp"><${PfBar} p=${k.prog} h=${k.st === 'active' ? k.health : 'done'} /><span className="num small">${k.prog}%</span></span></li>`)}</ul>`}
        </div>`
    )}</section>`;
  return html`<div className="stack">
      <div className="ph-row"><div className="muted small">The company's goals, the teams' goals and goals people share with everyone. Align your own goals to them (Edit › Supports) so everyone sees how the work adds up.</div>
        <div className="actions">${home.mayTeam && html`<button className="btn ghost" onClick=${() => onNew('team')}><${Icon} n="plus" />Team goal</button>`}${home.hr && html`<button className="btn" onClick=${() => onNew('company')}><${Icon} n="plus" />Company goal</button>`}</div></div>
      ${d.goals.length ? html`${group('Company goals', co)}${group('Team and shared goals', team)}` : html`<${Empty} title="No company or team goals yet">${home.hr ? 'Set the company goals for the year or quarter; managers then add team goals that support them, and people align theirs.' : 'When HR and managers set company and team goals they show here.'}<//>`}
    </div>`;
}

/* One goal: its key results, a check-in, history, comments and the goals aligned to it. */
function PfGoal({ id, home, onClose, onEdit, onChanged, onOpen }) {
  const toast = useToast();
  const [g, setG] = useState(null);
  const [ci, setCi] = useState(null);
  const [cm, setCm] = useState('');
  const [busy, setBusy] = useState('');
  const take = r => {
    setG(r.goal);
    setCi({ health: r.goal.health || 'on', note: '', prog: r.goal.prog, vals: Object.fromEntries(r.goal.krs.map(k => [k.id, k.t === 'done' ? !!k.cur : k.cur])) });
  };
  useEffect(() => {
    setG(null);
    api('pf_goal_get', { id })
      .then(take)
      .catch(e => {
        toast(errText(e), true);
        onClose();
      });
  }, [id]);
  if (!g || !ci) return html`<${Modal} title="Goal" onClose=${onClose}><${Spinner} /><//>`;
  const call = async (route, body, msg, close) => {
    setBusy(route);
    try {
      const r = await api(route, { id: g.id, ...body });
      if (r.goal) take(r);
      toast(msg);
      onChanged();
      if (close) onClose();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const setSt = st => call('pf_goal_save', { ...g, krs: g.krs, st }, st === 'done' ? 'Marked achieved.' : st === 'dropped' ? 'Marked dropped.' : 'Reopened.');
  const del = () => confirm('Delete this goal?') && call('pf_goal_delete', {}, 'Goal deleted.', true);
  return html`<${Modal} wide title=${g.title} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Close</button>
      ${g.canEdit && !g.ci.length && html`<button className="btn ghost" disabled=${!!busy} onClick=${del}>Delete</button>`}
      ${g.canEdit && g.st === 'active' && html`<button className="btn ghost" disabled=${!!busy} onClick=${() => setSt('dropped')}>Drop</button><button className="btn ghost" disabled=${!!busy} onClick=${() => setSt('done')}>Mark achieved</button>`}
      ${g.canEdit && g.st !== 'active' && html`<button className="btn ghost" disabled=${!!busy} onClick=${() => setSt('active')}>Reopen</button>`}
      ${g.canEdit && html`<button className="btn" onClick=${() => onEdit(g)}>Edit</button>`}`}>
      <div className="stack">
        <div className="actions"><${Chip} s="info">${{ mine: 'Personal', team: 'Team', company: 'Company' }[g.kind]}<//>${g.st !== 'active' ? html`<${Chip} s=${g.st === 'done' ? 'ok' : ''}>${g.st === 'done' ? 'Achieved' : 'Dropped'}<//>` : g.health ? html`<${Chip} s=${PF_TONE[g.health]}>${home.health[g.health]}<//>` : null}<span className="small">${g.ownerN}${g.start || g.due ? ' · ' + [pfDay(g.start), pfDay(g.due)].filter(Boolean).join(' – ') : ''}${g.kind === 'mine' ? (g.vis === 'all' ? ' · shared with everyone' : ' · seen by the owner, their managers and HR') : ''}</span><b className="num" style=${{ marginLeft: 'auto' }}>${g.prog}%</b></div>
        <${PfBar} p=${g.prog} h=${g.st === 'active' ? g.health : 'done'} />
        ${g.why && html`<p style=${{ margin: 0, whiteSpace: 'pre-wrap' }}>${g.why}</p>`}
        ${g.parent && html`<div className="small">Supports: <button type="button" className="linkbtn" onClick=${() => onOpen(g.parent)}>${g.parentT || 'a goal you cannot see'}</button></div>`}
        ${g.krs.length > 0 && html`<div className="tblwrap"><table className="tbl small"><thead><tr><th>Key result</th><th>Where it is</th><th style=${{ minWidth: 140 }}>Progress</th></tr></thead><tbody>${g.krs.map(k => html`<tr key=${k.id}><td>${k.n}</td><td>${pfKrText(k)}</td><td><div className="actions"><${PfBar} p=${k.p} /><span className="num">${k.p}%</span></div></td></tr>`)}</tbody></table></div>`}
        ${
          g.canEdit &&
          g.st === 'active' &&
          html`<section className="panel stack form pfci">
            <b>Check in</b>
            ${g.krs.map(
              k => html`<div key=${k.id} className="pfcirow"><span>${k.n}</span>${k.t === 'done' ? html`<label className="check"><input type="checkbox" checked=${!!ci.vals[k.id]} onChange=${e => setCi({ ...ci, vals: { ...ci.vals, [k.id]: e.target.checked } })} /><span>Done</span></label>` : html`<input type="number" step="any" value=${ci.vals[k.id]} onInput=${e => setCi({ ...ci, vals: { ...ci.vals, [k.id]: e.target.value } })} aria-label=${'Now: ' + k.n} style=${{ maxWidth: 140 }} /><span className="muted small">${k.unit === '%' ? '%' : k.unit} (target ${pfNum(k.to)})</span>`}</div>`
            )}
            ${!g.krs.length && html`<${Field} label=${'Progress: ' + ci.prog + '%'}><input type="range" min="0" max="100" step="5" value=${ci.prog} onInput=${e => setCi({ ...ci, prog: +e.target.value })} /><//>`}
            <div className="seg" role="radiogroup" aria-label="How it is going">${Object.entries(home.health).map(([k, n]) => html`<button key=${k} type="button" role="radio" aria-checked=${ci.health === k} className=${ci.health === k ? 'on' : ''} onClick=${() => setCi({ ...ci, health: k })}>${n}</button>`)}</div>
            <${Field} label="Note (optional)"><textarea rows="2" value=${ci.note} onInput=${e => setCi({ ...ci, note: e.target.value })} placeholder="What moved, what is in the way, what help you need" /><//>
            <div><button className="btn" disabled=${!!busy} onClick=${() => call('pf_checkin', { health: ci.health, note: ci.note, vals: ci.vals, prog: ci.prog }, 'Check-in saved.')}>${busy === 'pf_checkin' ? 'Saving…' : 'Save check-in'}</button></div>
          </section>`
        }
        ${g.kids && g.kids.length > 0 && html`<section className="stack"><b>Goals that support it (${g.kids.length})</b><ul className="pfkids">${g.kids.map(k => html`<li key=${k.id}><button type="button" className="linkbtn" onClick=${() => onOpen(k.id)}>${k.title}</button><span className="muted"> · ${k.ownerN}</span><span className="pfkp"><${PfBar} p=${k.prog} h=${k.st === 'active' ? k.health : 'done'} /><span className="num small">${k.prog}%</span></span></li>`)}</ul></section>`}
        ${g.ci.length > 0 && html`<section className="stack"><b>Check-ins</b><ul className="list small">${g.ci.slice(0, 20).map((c, i) => html`<li key=${i}><div><div className="t"><${Chip} s=${PF_TONE[c.health]}>${home.health[c.health]}<//> ${c.was !== c.prog ? c.was + '% → ' + c.prog + '%' : c.prog + '%'}${c.note ? ' · ' + c.note : ''}</div><div className="m">${c.who} · ${fmtTs(c.t)}</div></div></li>`)}</ul></section>`}
        <section className="stack"><b>Comments</b>
          ${g.cm.map((c, i) => html`<div key=${i} className="pfcm"><div className="small"><b>${c.who}</b> <span className="muted">${fmtTs(c.t)}</span></div><div style=${{ whiteSpace: 'pre-wrap' }}>${c.txt}</div></div>`)}
          <div className="actions"><input value=${cm} onInput=${e => setCm(e.target.value)} placeholder="Write a comment" aria-label="Comment" style=${{ flex: 1, minWidth: 0 }} /><button className="btn ghost" disabled=${!cm.trim() || !!busy} onClick=${() => call('pf_comment', { txt: cm }, 'Comment added.').then(() => setCm(''))}>Comment</button></div>
        </section>
        ${g.log.length > 0 && html`<details><summary className="small">History</summary><ul className="list small">${g.log.map((x, i) => html`<li key=${i}><div><div className="t">${x.ev}</div><div className="m">${x.who} · ${fmtTs(x.t)}</div></div></li>`)}</ul></details>`}
      </div>
    <//>`;
}

/* Setting or changing a goal: title, why, who it is for, dates, what it supports, who sees it, its key results. */
function PfEditor({ g, home, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !g.id;
  const [q0, q1] = pfQuarter();
  const [f, setF] = useState({
    kind: g.kind || 'mine',
    owner: g.owner === undefined ? home.me : g.owner,
    title: g.title || '',
    why: g.why || '',
    start: g.start || (isNew ? q0 : ''),
    due: g.due || (isNew ? q1 : ''),
    parent: g.parent || '',
    vis: g.vis || 'mgr',
    prog: g.prog || 0,
    krs: (g.krs || []).map(k => ({ ...k })),
  });
  const [people, setPeople] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (isNew)
      api('pf_people')
        .then(r => setPeople(r.people))
        .catch(() => setPeople([]));
  }, []);
  const parents = home.shared.filter(p => p.id !== g.id && p.st === 'active' && (f.kind !== 'company' || p.kind === 'company'));
  const setKr = (i, patch) => setF({ ...f, krs: f.krs.map((k, j) => (j === i ? { ...k, ...patch } : k)) });
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('pf_goal_save', { id: g.id || '', kind: f.kind, owner: f.kind === 'company' ? '' : f.owner, title: f.title, why: f.why, start: f.start, due: f.due, parent: f.parent, vis: f.vis, prog: f.prog, krs: f.krs, st: g.st || 'active' });
      toast(isNew ? 'Goal set.' : 'Goal saved.');
      onSaved(r.goal);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const kinds = [['mine', 'Personal'], ...(home.mayTeam ? [['team', 'Team']] : []), ...(home.hr ? [['company', 'Company']] : [])];
  return html`<${Modal} wide title=${isNew ? 'New goal' : 'Edit goal'} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy || !f.title.trim()} onClick=${save}>${busy ? 'Saving…' : isNew ? 'Set the goal' : 'Save'}</button>`}>
      <div className="stack form">
        ${isNew && kinds.length > 1 && html`<div className="seg" role="radiogroup" aria-label="Kind of goal">${kinds.map(([k, n]) => html`<button key=${k} type="button" role="radio" aria-checked=${f.kind === k} className=${f.kind === k ? 'on' : ''} onClick=${() => setF({ ...f, kind: k, owner: k === 'company' ? '' : f.owner || home.me })}>${n}</button>`)}</div>`}
        <${Field} label="Goal"><input value=${f.title} onInput=${e => setF({ ...f, title: e.target.value })} placeholder=${f.kind === 'company' ? 'e.g. Place 40 consultants this quarter' : 'e.g. Become the go-to recruiter for data roles'} /><//>
        <${Field} label="Why it matters (optional)"><textarea rows="2" value=${f.why} onInput=${e => setF({ ...f, why: e.target.value })} /><//>
        <div className="row3">
          ${isNew && f.kind !== 'company' && people && people.length > 1 && html`<${Field} label=${f.kind === 'team' ? 'Team lead' : 'Whose goal'}><select value=${f.owner} onChange=${e => setF({ ...f, owner: e.target.value })}>${people.map(p => html`<option key=${p.id} value=${p.id}>${p.id === home.me ? p.n + ' (me)' : p.n}</option>`)}</select><//>`}
          <${Field} label="Start"><input type="date" value=${f.start} onInput=${e => setF({ ...f, start: e.target.value })} /><//>
          <${Field} label="Due"><input type="date" value=${f.due} onInput=${e => setF({ ...f, due: e.target.value })} /><//>
        </div>
        <div className="row3">
          <${Field} label="Supports (optional)"><select value=${f.parent} onChange=${e => setF({ ...f, parent: e.target.value })}><option value="">Nothing in particular</option>${parents.map(p => html`<option key=${p.id} value=${p.id}>${p.kind === 'company' ? 'Company: ' : 'Team: '}${p.title}</option>`)}</select><//>
          ${f.kind === 'mine' && html`<${Field} label="Who sees it"><select value=${f.vis} onChange=${e => setF({ ...f, vis: e.target.value })}><option value="mgr">Me, my managers and HR</option><option value="all">Everyone in the company</option></select><//>`}
        </div>
        <span className="lbl">Key results: how you will know it is done</span>
        ${f.krs.map(
          (k, i) => html`<div key=${k.id || i} className="pfkr">
            <${Field} label="Key result"><input value=${k.n} onInput=${e => setKr(i, { n: e.target.value })} placeholder="e.g. Submittals that reach an interview" /><//>
            <${Field} label="Measured as"><select value=${k.t} onChange=${e => setKr(i, { t: e.target.value, unit: e.target.value === 'pct' ? '%' : k.unit === '%' ? '' : k.unit, from: e.target.value === 'done' ? 0 : k.from, to: e.target.value === 'done' ? 1 : e.target.value === 'pct' && !+k.to ? 100 : k.to })}><option value="num">A number</option><option value="pct">A percentage</option><option value="done">Done or not</option></select><//>
            ${k.t !== 'done' && html`<${Field} label="From"><input type="number" step="any" value=${k.from} onInput=${e => setKr(i, { from: e.target.value })} /><//><${Field} label="Target"><input type="number" step="any" value=${k.to} onInput=${e => setKr(i, { to: e.target.value })} /><//>`}
            ${k.t === 'num' && html`<${Field} label="Unit"><input value=${k.unit} onInput=${e => setKr(i, { unit: e.target.value })} placeholder="e.g. interviews" /><//>`}
            <button type="button" className="btn ghost sm" aria-label="Remove this key result" onClick=${() => setF({ ...f, krs: f.krs.filter((x, j) => j !== i) })}><${Icon} n="trash" /></button>
          </div>`
        )}
        ${f.krs.length < 8 && html`<div><button type="button" className="btn ghost sm" onClick=${() => setF({ ...f, krs: [...f.krs, { id: '', n: '', t: 'num', from: 0, to: 10, unit: '' }] })}><${Icon} n="plus" />Add a key result</button></div>`}
        ${!f.krs.length && html`<p className="muted small" style=${{ margin: 0 }}>Without key results, progress is moved by hand at each check-in. Two or three measurable results make a goal clearer.</p>`}
      </div>
    <//>`;
}

/* Reviews: mine, the ones I write as a manager, and (HR, administrators) the review cycles. */
function PfReviews({ tick, home, onChanged }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState('');
  const [cyc, setCyc] = useState('');
  const [newCyc, setNewCyc] = useState(null);
  const load = () =>
    api('pf_reviews')
      .then(setD)
      .catch(setErr);
  // (the page's tick changes after every save here too, so the lists and the Reviews badge reload together)
  useEffect(() => {
    load();
  }, [tick]);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} />`;
  const changed = () => onChanged && onChanged();
  const list = (rows, who) =>
    html`<div className="tblwrap"><table className="tbl small"><thead><tr><th>Review</th>${who && html`<th>Person</th>`}<th>Status</th><th>Due</th></tr></thead><tbody>${rows.map(
      r => html`<tr key=${r.id} className="pfrow" onClick=${() => setOpen(r.id)}><td><b>${r.cycN}</b>${r.closed ? html` <span className="muted">(closed)</span>` : null}</td>${who && html`<td>${r.n}</td>`}<td><${Chip} s=${PF_RTONE[r.st]}>${d.rst[r.st]}<//></td><td className="nw">${pfDay(r.st === 'self' ? r.selfDue : r.st === 'mgr' ? r.mgrDue : '') || '–'}</td></tr>`
    )}</tbody></table></div>`;
  return html`<div className="stack">
      <section className="stack"><h3 className="pfh">My reviews</h3>${d.mine.length ? list(d.mine) : html`<p className="muted small" style=${{ margin: 0 }}>When HR opens a review cycle your self review shows here.</p>`}</section>
      ${d.toDo.length > 0 && html`<section className="stack"><h3 className="pfh">Reviews I write</h3>${list(d.toDo, true)}</section>`}
      ${
        d.hr &&
        html`<section className="stack"><div className="ph-row"><h3 className="pfh">Review cycles</h3><button className="btn" onClick=${() => setNewCyc({})}><${Icon} n="plus" />New review cycle</button></div>
          ${d.cycles.length ? html`<div className="tblwrap"><table className="tbl small"><thead><tr><th>Cycle</th><th>Looks back on</th><th>People</th><th>Status</th></tr></thead><tbody>${d.cycles.map(c => html`<tr key=${c.id} className="pfrow" onClick=${() => setCyc(c.id)}><td><b>${c.n}</b></td><td className="nw">${pfDay(c.from)} – ${pfDay(c.to)}</td><td>${c.st === 'draft' ? '–' : c.n2}</td><td><${Chip} s=${c.st === 'open' ? 'info' : c.st === 'closed' ? 'ok' : 'amber'}>${c.st === 'draft' ? 'not started' : c.st}<//></td></tr>`)}</tbody></table></div>` : html`<${Empty} title="No review cycles yet">A cycle asks everyone (or the people you pick) for a self review; their manager then writes theirs and shares it; the person acknowledges it. Ratings run from 1 (below expectations) to 5 (outstanding).<//>`}
        </section>`
      }
      ${open && html`<${PfReview} id=${open} onClose=${() => setOpen('')} onChanged=${changed} />`}
      ${cyc && html`<${PfCycle} id=${cyc} onClose=${() => setCyc('')} onChanged=${changed} onReview=${setOpen} onEdit=${c => (setCyc(''), setNewCyc(c))} />`}
      ${newCyc && html`<${PfCycleEditor} c=${newCyc} onClose=${() => setNewCyc(null)} onSaved=${id => (setNewCyc(null), changed(), setCyc(id))} />`}
    </div>`;
}

function PfRating({ v, on, scale, label }) {
  return html`<select value=${v || ''} onChange=${e => on(e.target.value)} aria-label=${label}><option value="">–</option>${Object.entries(scale).map(([k, n]) => html`<option key=${k} value=${k}>${k} · ${n}</option>`)}</select>`;
}

function PfReview({ id, onClose, onChanged }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [mine, setMine] = useState(null);
  const [ack, setAck] = useState('');
  const [busy, setBusy] = useState('');
  // (the save and acknowledge answers carry the review only: keep the rating scale and status names from the first load)
  const take = r => {
    setD(x => ({ ...(x || {}), ...r }));
    const v = r.review;
    const part = v.mine && v.st === 'self' ? v.self : v.reviewer && v.st === 'mgr' ? v.mgrPart : null;
    setMine({ ans: { ...((part && part.ans) || {}) }, goals: { ...((part && part.goals) || {}) }, rating: (part && part.rating) || '' });
  };
  useEffect(() => {
    api('pf_review_get', { id })
      .then(take)
      .catch(e => {
        toast(errText(e), true);
        onClose();
      });
  }, [id]);
  if (!d || !mine) return html`<${Modal} title="Review" onClose=${onClose}><${Spinner} /><//>`;
  const v = d.review;
  const S = d.scale;
  const editSelf = v.mine && v.st === 'self' && !v.closed;
  const editMgr = v.reviewer && v.st === 'mgr' && !v.closed;
  const part = editSelf ? 'self' : editMgr ? 'mgr' : '';
  const save = async send => {
    setBusy(send ? 'send' : 'save');
    try {
      const r = await api('pf_review_save', { id: v.id, part, send, ans: mine.ans, goals: mine.goals, rating: mine.rating });
      take(r);
      toast(send ? (part === 'self' ? 'Sent to ' + v.mgrN + '.' : 'Shared with ' + v.n + '.') : 'Draft saved.');
      onChanged();
      if (send) onClose();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const act = async (route, body, msg) => {
    setBusy(route);
    try {
      take(await api(route, { id: v.id, ...body }));
      toast(msg);
      onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const sv = (side, key, q) => side && side[key] && side[key][q];
  const showSelf = v.self && (v.st !== 'self' || v.mine);
  return html`<${Modal} wide title=${v.cycN + ' · ' + v.n} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Close</button>
      ${part && html`<button className="btn ghost" disabled=${!!busy} onClick=${() => save(false)}>Save draft</button><button className="btn" disabled=${!!busy || !mine.rating} onClick=${() => save(true)}>${part === 'self' ? 'Send to ' + v.mgrN : 'Share with ' + v.n}</button>`}`}>
      <div className="stack pfreview">
        <div className="actions"><${Chip} s=${PF_RTONE[v.st]}>${d.rst[v.st]}<//><span className="small">${v.n} · reviewer: ${v.mgrN}${v.closed ? ' · the cycle is closed' : ''}</span></div>
        ${editSelf && html`<div className="note"><span>Look back on the period: rate your goals, answer the questions and give yourself an overall rating. ${v.mgrN} sees it once you send it${v.selfDue ? '; due ' + pfDay(v.selfDue) : ''}.</span></div>`}
        ${editMgr && html`<div className="note"><span>${v.n}'s self review is in. Write your part; ${v.n} sees it when you share it${v.mgrDue ? '; due ' + pfDay(v.mgrDue) : ''}.</span></div>`}
        ${
          v.goals.length > 0 &&
          html`<div className="tblwrap"><table className="tbl small"><thead><tr><th>Goal</th><th>Progress</th>${showSelf || editSelf ? html`<th>Self</th>` : null}${v.mgrPart || editMgr ? html`<th>Manager</th>` : null}</tr></thead><tbody>${v.goals.map(
            g => html`<tr key=${g.id}><td>${g.title}${g.st === 'done' ? html` <${Chip} s="ok">Achieved<//>` : null}</td><td className="num">${g.prog}%</td>
              ${editSelf ? html`<td><${PfRating} v=${mine.goals[g.id]} scale=${S} label=${'Self rating: ' + g.title} on=${x => setMine({ ...mine, goals: { ...mine.goals, [g.id]: x } })} /></td>` : showSelf ? html`<td>${sv(v.self, 'goals', g.id) ? sv(v.self, 'goals', g.id) + ' · ' + S[sv(v.self, 'goals', g.id)] : '–'}</td>` : null}
              ${editMgr ? html`<td><${PfRating} v=${mine.goals[g.id]} scale=${S} label=${'Manager rating: ' + g.title} on=${x => setMine({ ...mine, goals: { ...mine.goals, [g.id]: x } })} /></td>` : v.mgrPart ? html`<td>${sv(v.mgrPart, 'goals', g.id) ? sv(v.mgrPart, 'goals', g.id) + ' · ' + S[sv(v.mgrPart, 'goals', g.id)] : '–'}</td>` : null}</tr>`
          )}</tbody></table></div>`
        }
        ${v.qs.map(
          q => html`<section key=${q.id} className="stack pfq"><b>${q.q}</b>
            ${editSelf ? html`<textarea rows="3" value=${mine.ans[q.id] || ''} onInput=${e => setMine({ ...mine, ans: { ...mine.ans, [q.id]: e.target.value } })} aria-label=${q.q} />` : showSelf ? html`<div className="pfans"><span className="muted small">${v.n}:</span> ${sv(v.self, 'ans', q.id) || html`<span className="muted">no answer</span>`}</div>` : null}
            ${editMgr ? html`<textarea rows="3" value=${mine.ans[q.id] || ''} onInput=${e => setMine({ ...mine, ans: { ...mine.ans, [q.id]: e.target.value } })} aria-label=${'Manager: ' + q.q} placeholder=${'Your view, ' + v.mgrN} />` : v.mgrPart && v.mgrPart.at ? html`<div className="pfans"><span className="muted small">${v.mgrN}:</span> ${sv(v.mgrPart, 'ans', q.id) || html`<span className="muted">no answer</span>`}</div>` : null}
          </section>`
        )}
        <div className="row3">
          ${editSelf ? html`<${Field} label="Overall, I rate my period"><${PfRating} v=${mine.rating} scale=${S} label="Overall self rating" on=${x => setMine({ ...mine, rating: x })} /><//>` : showSelf && v.self.rating ? html`<div><span className="lbl">Self rating</span><div><b>${v.self.rating}</b> · ${S[v.self.rating]}</div></div>` : null}
          ${editMgr ? html`<${Field} label="Overall rating"><${PfRating} v=${mine.rating} scale=${S} label="Overall manager rating" on=${x => setMine({ ...mine, rating: x })} /><//>` : v.mgrPart && v.mgrPart.rating ? html`<div><span className="lbl">Manager rating</span><div><b>${v.mgrPart.rating}</b> · ${S[v.mgrPart.rating]}</div></div>` : null}
        </div>
        ${v.ack && html`<div className="note ok"><span>Acknowledged ${fmtTs(v.ack.t)}${v.ack.note ? ': ' + v.ack.note : ''}</span></div>`}
        ${
          v.mine &&
          v.st === 'shared' &&
          !v.closed &&
          html`<section className="panel stack form"><b>Acknowledge your review</b><${Field} label="Your comment (optional)"><textarea rows="2" value=${ack} onInput=${e => setAck(e.target.value)} /><//><div><button className="btn" disabled=${!!busy} onClick=${() => act('pf_review_ack', { note: ack }, 'Acknowledged.')}>Acknowledge</button></div><p className="muted small" style=${{ margin: 0 }}>Acknowledging says you have read it, not that you agree; your comment goes on record with it.</p></section>`
        }
        ${v.log.length > 0 && html`<details><summary className="small">History</summary><ul className="list small">${v.log.map((x, i) => html`<li key=${i}><div><div className="t">${x.ev}</div><div className="m">${x.who} · ${fmtTs(x.t)}</div></div></li>`)}</ul></details>`}
      </div>
    <//>`;
}

/* HR: a review cycle's progress, the spread of ratings, and each person's review. */
function PfCycle({ id, onClose, onChanged, onReview, onEdit }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState('');
  const load = () =>
    api('pf_cycle_get', { id })
      .then(setD)
      .catch(e => {
        toast(errText(e), true);
        onClose();
      });
  useEffect(() => {
    load();
  }, [id]);
  if (!d) return html`<${Modal} title="Review cycle" onClose=${onClose}><${Spinner} /><//>`;
  const c = d.cycle;
  const act = async (route, body, msg, close) => {
    setBusy(route);
    try {
      await api(route, { id: c.id, ...body });
      toast(msg);
      onChanged();
      if (close) onClose();
      else load();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const n = d.reviews.length;
  const sentSelf = n - (d.byst.self || 0);
  const shared = (d.byst.shared || 0) + (d.byst.ack || 0);
  const reopen = (r, to) => act('pf_review_reopen', { id: r.id, to }, 'Reopened.');
  return html`<${Modal} wide title=${c.n} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Close</button>
      ${c.st === 'draft' && html`<button className="btn ghost" disabled=${!!busy} onClick=${() => confirm('Delete this cycle?') && act('pf_cycle_close', {}, 'Cycle deleted.', true)}>Delete</button><button className="btn ghost" onClick=${() => onEdit(c)}>Edit</button><button className="btn" disabled=${!!busy} onClick=${() => confirm('Start the cycle? Everyone in it is emailed to write their self review.') && act('pf_cycle_launch', {}, 'Cycle started.')}>Start the cycle</button>`}
      ${c.st === 'open' && html`<button className="btn ghost" disabled=${!!busy} onClick=${() => confirm('Close the cycle? Reviews can no longer be changed.') && act('pf_cycle_close', {}, 'Cycle closed.')}>Close the cycle</button>`}`}>
      <div className="stack">
        <div className="small">Looks back on ${pfDay(c.from)} – ${pfDay(c.to)}${c.selfDue ? ' · self reviews due ' + pfDay(c.selfDue) : ''}${c.mgrDue ? ' · manager reviews due ' + pfDay(c.mgrDue) : ''} · ${c.who === 'pick' ? c.people.length + (c.people.length === 1 ? ' person' : ' people') + ' picked' : 'everyone in the company'}</div>
        ${
          c.st === 'draft'
            ? html`<div className="note amber"><span>Not started yet. Starting it opens a review for each person (with their goals for the period) and emails them.</span></div><ol className="small">${c.qs.map(q => html`<li key=${q.id}>${q.q}</li>`)}</ol>`
            : html`<${KitStats} items=${[{ v: n, l: 'People' }, { v: n ? Math.round((sentSelf / n) * 100) + '%' : '–', l: 'Self reviews in' }, { v: n ? Math.round((shared / n) * 100) + '%' : '–', l: 'Manager reviews shared' }, { v: d.byst.ack || 0, l: 'Acknowledged' }]} />
              ${shared > 0 && html`<section className="panel"><b className="small">How the manager ratings spread</b><${WkBars} rows=${Object.entries(d.dist).map(([k, x]) => ({ l: k, a: x }))} keys=${[['a', 'done', 'people']]} max=${Math.max(1, ...Object.values(d.dist))} /></section>`}
              <div className="tblwrap"><table className="tbl small"><thead><tr><th>Person</th><th>Reviewer</th><th>Status</th><th>Self</th><th>Manager</th><th></th></tr></thead><tbody>${d.reviews.map(
                r => html`<tr key=${r.id}><td><button type="button" className="linkbtn" onClick=${() => onReview(r.id)}>${r.n}</button></td><td>${r.mgrN}</td><td><${Chip} s=${PF_RTONE[r.st]}>${{ self: 'Self review', mgr: 'Manager review', shared: 'Shared', ack: 'Acknowledged' }[r.st]}<//></td><td>${r.selfRating || '–'}</td><td>${r.mgrRating || '–'}</td><td className="r">${c.st === 'open' && r.st !== 'self' && html`<button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => reopen(r, r.st === 'mgr' ? 'self' : 'mgr')}>${r.st === 'mgr' ? 'Back to the person' : 'Back to the reviewer'}</button>`}</td></tr>`
              )}</tbody></table></div>`
        }
      </div>
    <//>`;
}

function PfCycleEditor({ c, onClose, onSaved }) {
  const toast = useToast();
  const y = new Date().getFullYear();
  const half = new Date().getMonth() < 6;
  const [f, setF] = useState({
    n: c.n || (half ? y + ' H1' : y + ' H2'),
    from: c.from || (half ? y + '-01-01' : y + '-07-01'),
    to: c.to || (half ? y + '-06-30' : y + '-12-31'),
    selfDue: c.selfDue || '',
    mgrDue: c.mgrDue || '',
    qs: (c.qs || [
      { id: 'q1', q: 'What went well this period? Name the results you are proudest of.' },
      { id: 'q2', q: 'What was hard, or could have gone better?' },
      { id: 'q3', q: 'What should the focus be next period, and what support would help?' },
    ]).map(q => ({ ...q })),
    who: c.who || 'all',
    people: c.people || [],
  });
  const [people, setPeople] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('pf_people')
      .then(r => setPeople(r.people))
      .catch(() => setPeople([]));
  }, []);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('pf_cycle_save', { id: c.id || '', ...f });
      toast('Review cycle saved. Start it when you are ready.');
      onSaved(r.id);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const tog = id => setF({ ...f, people: f.people.includes(id) ? f.people.filter(x => x !== id) : [...f.people, id] });
  return html`<${Modal} wide title=${c.id ? 'Edit review cycle' : 'New review cycle'} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy || !f.n.trim()} onClick=${save}>${busy ? 'Saving…' : 'Save'}</button>`}>
      <div className="stack form">
        <div className="row3">
          <${Field} label="Name"><input value=${f.n} onInput=${e => setF({ ...f, n: e.target.value })} /><//>
          <${Field} label="Looks back from"><input type="date" value=${f.from} onInput=${e => setF({ ...f, from: e.target.value })} /><//>
          <${Field} label="to"><input type="date" value=${f.to} onInput=${e => setF({ ...f, to: e.target.value })} /><//>
        </div>
        <div className="row3">
          <${Field} label="Self reviews due"><input type="date" value=${f.selfDue} onInput=${e => setF({ ...f, selfDue: e.target.value })} /><//>
          <${Field} label="Manager reviews due"><input type="date" value=${f.mgrDue} onInput=${e => setF({ ...f, mgrDue: e.target.value })} /><//>
        </div>
        <span className="lbl">Questions (both the person and the manager answer them)</span>
        ${f.qs.map((q, i) => html`<div key=${i} className="actions"><input value=${q.q} onInput=${e => setF({ ...f, qs: f.qs.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)) })} aria-label=${'Question ' + (i + 1)} style=${{ flex: 1, minWidth: 0 }} /><button type="button" className="btn ghost sm" aria-label="Remove this question" onClick=${() => setF({ ...f, qs: f.qs.filter((x, j) => j !== i) })}><${Icon} n="trash" /></button></div>`)}
        ${f.qs.length < 10 && html`<div><button type="button" className="btn ghost sm" onClick=${() => setF({ ...f, qs: [...f.qs, { id: '', q: '' }] })}><${Icon} n="plus" />Add a question</button></div>`}
        <span className="lbl">Who it is for</span>
        <div className="seg" role="radiogroup" aria-label="Who it is for"><button type="button" role="radio" aria-checked=${f.who === 'all'} className=${f.who === 'all' ? 'on' : ''} onClick=${() => setF({ ...f, who: 'all' })}>Everyone in the company</button><button type="button" role="radio" aria-checked=${f.who === 'pick'} className=${f.who === 'pick' ? 'on' : ''} onClick=${() => setF({ ...f, who: 'pick' })}>People I pick</button></div>
        ${f.who === 'pick' && (people ? html`<div className="portalpicks wide pfpick">${people.map(p => html`<label key=${p.id} className=${'pick' + (f.people.includes(p.id) ? ' on' : '')}><input type="checkbox" checked=${f.people.includes(p.id)} onChange=${() => tog(p.id)} /><span>${p.n}</span></label>`)}</div>` : html`<${Spinner} />`)}
        <p className="muted small" style=${{ margin: 0 }}>Each person's reviewer is their manager on the Team card when the cycle starts (HR for people without one). Ratings: 1 below expectations, 2 partly meets, 3 meets, 4 exceeds, 5 outstanding.</p>
      </div>
    <//>`;
}
