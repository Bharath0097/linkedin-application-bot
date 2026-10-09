/* ================= v65 Client delivery and escalation desk (CC-10) =================
   The client portal's "Delivery desk" page (CrDeliveryPage) and the staff desk's tab (CrDeskTab): the account team
   (owner, backup, working hours, response targets proposed by StratEdge and agreed by the company), what waits for the
   company, the active requests with their next step, interviews, agreed starts, and the questions and issues the company
   raised: impact, acknowledgement, owner, planned action and target, progress, a proposed resolution with evidence, and
   the company's confirmation. Lives in js/work.js. */
const DD_TONE = { open: 'amber', reopened: 'red', ack: 'new', working: 'new', resolved: 'ok', closed: '' };
const DD_IMPACT_TONE = { low: '', medium: 'amber', high: 'red', critical: 'red' };
const DD_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ddDay = ms => (ms ? fmtDay(ms) : '');
const ddHm = min => (min == null ? '' : min < 60 ? min + ' min' : Math.round((min / 60) * 10) / 10 + ' h');
const ddImpactShort = s => (s || '').split(':')[0];

function useDdHome(cid, days) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setD(null);
  }, [cid, days]);
  useEffect(() => {
    // a reload keeps what is on the screen until the fresh answer arrives
    api('cr_dd_home', { ...(cid ? { cid } : {}), ...(days ? { days } : {}) }).then(x => (setD(x), setErr(null)), setErr);
  }, [cid, days, tick]);
  return [d, err, () => setTick(t => t + 1)];
}

/* ---------- the account team: owner, backup, hours, targets ---------- */
function DdTeamCard({ d, onChanged }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const t = d.team;
  const o = t.owner;
  const agree = async () => {
    setBusy(true);
    try {
      await api('cr_dd_agree', { cid: d.cid, ver: t.goalsVer });
      toast('Agreed. StratEdge works to these targets for ' + d.co + '.');
      onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const hours = t.hours.days.map(x => DD_DAYS[x]).join(', ') + ' ' + t.hours.from + '–' + t.hours.to + ' (' + t.hours.tz.replace(/_/g, ' ') + ')';
  return html`<section className="panel stack ddteam">
    <div className="ph-row"><h2 className="ph">Your account team at StratEdge</h2>${t.goalsSt === 'agreed' ? html`<${Chip} s="ok">Targets agreed<//>` : html`<${Chip} s="amber">Targets proposed, not yet agreed<//>`}</div>
    <div className="ddgrid">
      <div><span className="lbl">Account owner</span><b>${o.ownerN || 'Not named yet'}</b>${o.away && html`<div className="small amber">Away until ${ddDay(o.awayUntil)}${o.awayNote ? ' · ' + o.awayNote : ''}: ${o.backupN ? o.backupN + ' covers' : 'HR and administrators cover'}.</div>`}</div>
      <div><span className="lbl">Backup</span><b>${o.backupN || 'Not named yet'}</b>${o.away && o.backupN && html`<div className="small">Acting owner now.</div>`}</div>
      <div><span className="lbl">Working hours</span><b>${hours}</b><div className="small muted">Targets count working hours and days only.</div></div>
    </div>
    <div className="tblwrap"><table className="tbl ddgoals"><thead><tr><th>Impact</th><th>Acknowledged within</th><th>Resolved within</th></tr></thead><tbody>${Object.entries(d.impacts).map(([k, n]) => html`<tr key=${k}><td><${Chip} s=${DD_IMPACT_TONE[k]}>${ddImpactShort(n)}<//> <span className="muted small">${n.split(':').slice(1).join(':').trim()}</span></td><td>${t.goals[k][0]} working hour${t.goals[k][0] === 1 ? '' : 's'}</td><td>${t.goals[k][1]} working day${t.goals[k][1] === 1 ? '' : 's'}</td></tr>`)}</tbody></table></div>
    <p className="muted small" style=${{ margin: 0 }}>${t.goalsSt === 'agreed' ? `Agreed by ${t.goalsBy} on ${ddDay(t.goalsAt)} (version ${t.goalsVer}).` : `Proposed by StratEdge${t.proposedBy ? ' (' + t.proposedBy + ', ' + ddDay(t.proposedAt) + ')' : ''}. These are working targets, not a contractual service level, until someone with full access at ${d.co} agrees to them here.`}</p>
    ${!d.staff && t.goalsSt !== 'agreed' && d.acc && d.acc.manage && html`<div><button type="button" className="btn sm" disabled=${busy} onClick=${agree}><${Icon} n="check" />Agree to these targets</button></div>`}
  </section>`;
}

/* ---------- staff: the desk settings ---------- */
function DdSettings({ d, onChanged }) {
  const toast = useToast();
  const t = d.team;
  const [f, setF] = useState({ backup: t.backup || '', tz: t.hours.tz, days: t.hours.days, from: t.hours.from, to: t.hours.to, goals: t.goals, awayUntil: t.away.until ? new Date(t.away.until).toISOString().slice(0, 10) : '', awayNote: t.away.note || '' });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setF({ backup: t.backup || '', tz: t.hours.tz, days: t.hours.days, from: t.hours.from, to: t.hours.to, goals: t.goals, awayUntil: t.away.until ? new Date(t.away.until).toISOString().slice(0, 10) : '', awayNote: t.away.note || '' });
  }, [d.cid, t.goalsVer, t.goalsSt]);
  const save = async () => {
    setBusy(true);
    try {
      const until = f.awayUntil ? new Date(f.awayUntil + 'T23:59:00').getTime() : 0;
      await api('cr_dd_cfg', { cid: d.cid, backup: f.backup, hours: { tz: f.tz, days: f.days, from: f.from, to: f.to }, goals: f.goals, away: { until, note: f.awayNote } });
      toast('Saved for ' + d.co + '.');
      onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const setGoal = (k, i, v) => setF({ ...f, goals: { ...f.goals, [k]: f.goals[k].map((x, j) => (j === i ? Math.max(0, parseInt(v, 10) || 0) : x)) } });
  return html`<details className="crcmp ddset" open=${open} onToggle=${e => setOpen(e.target.open)}><summary>Account team, working hours and targets (StratEdge)</summary>
    <div className="form stack" style=${{ marginTop: 8 }}>
      <div className="row3">
        <${Field} label="Account manager" hint="Set under Approvers (the company's account manager)"><input value=${t.owner.ownerN || 'Not named'} disabled /><//>
        <${Field} label="Backup" hint="Covers when the account manager is away"><select value=${f.backup} onChange=${e => setF({ ...f, backup: e.target.value })}><option value="">Nobody (HR and administrators)</option>${(d.staffTeam || []).map(x => html`<option key=${x.id} value=${x.id}>${x.n}</option>`)}</select><//>
        <${Field} label="Account manager away until" hint="Work routes to the backup until then"><input type="date" value=${f.awayUntil} onInput=${e => setF({ ...f, awayUntil: e.target.value })} /><//>
      </div>
      <${Field} label="Away note (optional)"><input value=${f.awayNote} maxLength="200" placeholder="e.g. on leave; call the backup for anything urgent" onInput=${e => setF({ ...f, awayNote: e.target.value })} /><//>
      <div className="row3">
        <${Field} label="Time zone"><input value=${f.tz} list="ddtz" onInput=${e => setF({ ...f, tz: e.target.value })} /><datalist id="ddtz">${(d.tz || []).map(z => html`<option key=${z} value=${z} />`)}</datalist><//>
        <${Field} label="From"><input type="time" value=${f.from} onInput=${e => setF({ ...f, from: e.target.value })} /><//>
        <${Field} label="To"><input type="time" value=${f.to} onInput=${e => setF({ ...f, to: e.target.value })} /><//>
      </div>
      <div className="crpick">${DD_DAYS.map((n, i) => html`<label key=${i} className="check"><input type="checkbox" checked=${f.days.includes(i)} onChange=${e => setF({ ...f, days: e.target.checked ? [...f.days, i].sort() : f.days.filter(x => x !== i) })} /><span>${n}</span></label>`)}</div>
      <div className="tblwrap"><table className="tbl ddgoals"><thead><tr><th>Impact</th><th>Acknowledge within (working hours)</th><th>Resolve within (working days)</th></tr></thead><tbody>${Object.entries(d.impacts).map(([k, n]) => html`<tr key=${k}><td>${ddImpactShort(n)}</td><td><input type="number" min="1" max="240" value=${f.goals[k][0]} aria-label=${'Acknowledge ' + k} onInput=${e => setGoal(k, 0, e.target.value)} /></td><td><input type="number" min="1" max="60" value=${f.goals[k][1]} aria-label=${'Resolve ' + k} onInput=${e => setGoal(k, 1, e.target.value)} /></td></tr>`)}</tbody></table></div>
      <p className="muted small" style=${{ margin: 0 }}>Changed hours or targets go to the company as a proposal (its full-access people are emailed); they count as agreed only once someone there agrees on their delivery desk. ${t.goalsSt === 'agreed' ? `Version ${t.goalsVer} was agreed by ${t.goalsBy} on ${ddDay(t.goalsAt)}.` : 'Nothing agreed yet.'}</p>
      <div><button type="button" className="btn" disabled=${busy} onClick=${save}>Save${t.goalsSt === 'agreed' ? ' (changes become a new proposal)' : ' and propose'}</button></div>
    </div></details>`;
}

/* ---------- issues ---------- */
function DdRaiseForm({ d, onDone, onCancel }) {
  const toast = useToast();
  const [f, setF] = useState({ kind: 'question', impact: 'low', ti: '', details: '', req: '', start: false });
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const r = await api('cr_issue_add', { cid: d.cid, ...f });
      toast(d.staff ? 'Recorded for ' + d.co + '.' : 'Sent. StratEdge acknowledges it within ' + d.team.goals[f.impact][0] + ' working hour' + (d.team.goals[f.impact][0] === 1 ? '' : 's') + '.');
      onDone(r.issue.id);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<div className="form stack crform2 ddraise">
    <div className="row2"><${Field} label="What is it"><select value=${f.kind} onChange=${e => setF({ ...f, kind: e.target.value, start: e.target.value === 'change' ? true : f.start })}>${Object.entries(d.kinds).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//><${Field} label="Impact"><select value=${f.impact} onChange=${e => setF({ ...f, impact: e.target.value })}>${Object.entries(d.impacts).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//></div>
    <${Field} label="Title"><input value=${f.ti} maxLength="160" placeholder="e.g. Interview feedback for the Platform engineer is late" onInput=${e => setF({ ...f, ti: e.target.value })} /><//>
    <${Field} label="Details"><textarea rows="3" value=${f.details} maxLength="4000" placeholder="What happened, what you need, by when." onInput=${e => setF({ ...f, details: e.target.value })}></textarea><//>
    <div className="row2"><${Field} label="About a request (optional)"><select value=${f.req} onChange=${e => setF({ ...f, req: e.target.value })}><option value="">Not about one request</option>${(d.reqs_for || []).map(x => html`<option key=${x.id} value=${x.id}>${x.ti}</option>`)}</select><//><label className="check" style=${{ alignSelf: 'end' }}><input type="checkbox" checked=${f.start} disabled=${f.kind === 'change'} onChange=${e => setF({ ...f, start: e.target.checked })} /><span>This affects an agreed start</span></label></div>
    <div className="actions"><button type="button" className="btn" disabled=${busy || f.ti.trim().length < 5} onClick=${send}><${Icon} n="send" />${d.staff ? 'Record it' : 'Send to StratEdge'}</button><button type="button" className="btn ghost" onClick=${onCancel}>Cancel</button></div>
  </div>`;
}

function DdIssue({ it, d, onChanged, open0 }) {
  const toast = useToast();
  const [open, setOpen] = useState(!!open0);
  const [evs, setEvs] = useState(null);
  const [act, setAct] = useState(null);
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open && !evs) api('cr_issue_get', { id: it.id }).then(r => setEvs(r.evs), () => setEvs([]));
  }, [open]);
  const run = async (a, body, msg) => {
    setBusy(true);
    try {
      const r = await api('cr_issue_act', { id: it.id, act: a, ...body });
      setEvs(r.evs);
      setAct(null);
      setF({});
      toast(msg);
      onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const can = it.can;
  const late = it.ackLate || it.resLate;
  return html`<li className=${'ddissue' + (late ? ' ddlate' : '')}>
    <div className="ddhead" onClick=${() => setOpen(!open)} role="button" tabIndex="0" onKeyDown=${e => e.key === 'Enter' && setOpen(!open)}>
      <div><b>${it.ti}</b><div className="muted small">${d.kinds[it.kind]} · ${ddImpactShort(d.impacts[it.impact])} impact · raised by ${it.byN}, ${fmtTs(it.at)}${it.reqTi ? ' · ' + it.reqTi : ''}${it.start ? ' · affects a start' : ''}</div></div>
      <div className="ddst"><${Chip} s=${DD_TONE[it.st]}>${d.st[it.st]}<//>${it.ackLate && html`<${Chip} s="red">Not acknowledged in time<//>`}${!it.ackLate && it.resLate && html`<${Chip} s="red">Past the resolution target<//>`}${it.esc > 0 && html`<${Chip} s="amber">Escalated<//>`}</div>
    </div>
    ${open && html`<div className="ddbody stack">
      ${it.details && html`<div className="crpre small">${it.details}</div>`}
      <dl className="kv ddfacts">
        <dt>Owner</dt><dd>${it.ownerN || html`<span className="amber">Nobody yet</span>`}</dd>
        <dt>Acknowledge by</dt><dd>${fmtTs(it.ackBy)} (${it.ackH} working hour${it.ackH === 1 ? '' : 's'})${it.ackAt ? html` · <b>acknowledged</b> ${fmtTs(it.ackAt)} by ${it.ackN}${it.ackIn != null ? ' (' + ddHm(it.ackIn) + ' of working time)' : ''}` : ''}</dd>
        ${it.action && html`<dt>Planned</dt><dd>${it.action}${it.target ? ' · by ' + ddDay(it.target) : ''}</dd>`}
        <dt>Resolve by</dt><dd>${ddDay(it.resBy)} (${it.resD} working day${it.resD === 1 ? '' : 's'})${it.resAt ? html` · <b>resolution proposed</b> ${fmtTs(it.resAt)} by ${it.resN}${it.resIn != null ? ' (' + ddHm(it.resIn) + ' of working time)' : ''}` : ''}</dd>
        ${it.evidence && html`<dt>Resolution</dt><dd className="crpre">${it.evidence}</dd>`}
        ${it.closedAt > 0 && html`<dt>Confirmed</dt><dd>${fmtTs(it.closedAt)} by ${it.closedN}</dd>`}
      </dl>
      ${evs === null ? html`<${Spinner} />` : evs.length > 0 && html`<div className="crlog">${evs.map((e, i) => html`<div key=${i} className=${'crev ' + e.side}><span className="small muted">${fmtTs(e.at)} · ${e.byn}</span><div className="crpre small">${e.msg}</div></div>`)}</div>`}
      ${act === null && html`<div className="actions">
        ${can.ack && html`<button type="button" className="btn sm" onClick=${() => (setAct('ack'), setF({ owner: d.team.owner.acting || d.me, action: '', target: new Date(it.resBy).toISOString().slice(0, 10) }))}><${Icon} n="check" />Acknowledge…</button>`}
        ${can.resolve && html`<button type="button" className="btn sm" onClick=${() => setAct('resolve')}>Propose the resolution…</button>`}
        ${can.confirm && html`<button type="button" className="btn sm" onClick=${() => setAct('confirm')}><${Icon} n="check" />Confirm it is resolved…</button>`}
        ${can.reopen && html`<button type="button" className="btn ghost sm" onClick=${() => setAct('reopen')}>Not resolved…</button>`}
        ${can.note && html`<button type="button" className="btn ghost sm" onClick=${() => setAct('note')}>${d.staff ? 'Progress note…' : 'Add a note…'}</button>`}
        ${can.close && html`<button type="button" className="btn ghost sm" onClick=${() => setAct('close')}>Close…</button>`}
      </div>`}
      ${act === 'ack' && html`<div className="form stack crform2">
        <div className="row3"><${Field} label="Owner at StratEdge"><select value=${f.owner} onChange=${e => setF({ ...f, owner: e.target.value })}>${(d.staffTeam || []).map(x => html`<option key=${x.id} value=${x.id}>${x.n}</option>`)}</select><//><${Field} label="Target"><input type="date" value=${f.target} onInput=${e => setF({ ...f, target: e.target.value })} /><//></div>
        <${Field} label="Planned action"><textarea rows="2" value=${f.action || ''} maxLength="1000" placeholder="What will be done, by whom, by when." onInput=${e => setF({ ...f, action: e.target.value })}></textarea><//>
        <div className="actions"><button type="button" className="btn sm" disabled=${busy || !(f.action || '').trim()} onClick=${() => run('ack', { owner: f.owner, action: f.action, target: f.target ? new Date(f.target + 'T17:00:00').getTime() : 0 }, 'Acknowledged; the company is told.')}>Acknowledge</button><button type="button" className="btn ghost sm" onClick=${() => setAct(null)}>Cancel</button></div>
      </div>`}
      ${(act === 'note' || act === 'resolve' || act === 'confirm' || act === 'reopen' || act === 'close') && html`<div className="form stack crform2">
        <${Field} label=${act === 'resolve' ? 'The resolution and its evidence' : act === 'confirm' ? 'A word on the outcome (optional)' : act === 'reopen' ? 'What is still open' : act === 'close' ? 'Why (optional)' : 'Note'}><textarea rows="2" value=${f.msg || ''} maxLength="4000" onInput=${e => setF({ ...f, msg: e.target.value })}></textarea><//>
        <div className="actions"><button type="button" className="btn sm" disabled=${busy || ((act === 'note' || act === 'reopen') && !(f.msg || '').trim()) || (act === 'resolve' && (f.msg || '').trim().length < 10)} onClick=${() => run(act, { msg: f.msg || '' }, { note: 'Noted.', resolve: 'Resolution proposed; the company confirms it.', confirm: 'Confirmed. Thank you.', reopen: 'Reopened; StratEdge is told.', close: 'Closed.' }[act])}>${{ note: 'Add the note', resolve: 'Propose the resolution', confirm: 'Confirm resolved', reopen: 'Send it back', close: 'Close' }[act]}</button><button type="button" className="btn ghost sm" onClick=${() => setAct(null)}>Cancel</button></div>
      </div>`}
    </div>`}
  </li>`;
}

function DdIssues({ d, reload, q }) {
  const [raise, setRaise] = useState(false);
  const [f, setF] = useState('open');
  const [openId, setOpenId] = useState((q && q.i) || '');
  const rows = d.issues.filter(x => (f === 'open' ? x.st !== 'closed' : f === 'mine' ? x.mine || x.owner === d.me : true));
  const unowned = d.issues.filter(x => x.st !== 'closed' && !x.owner).length;
  return html`<section className="panel stack ddissues">
    <div className="ph-row"><h2 className="ph">Questions and issues</h2>${!raise && html`<button type="button" className="btn sm" onClick=${() => setRaise(true)}><${Icon} n="plus" />${d.staff ? 'Record one for ' + d.co : 'Raise a question or an issue'}</button>`}</div>
    ${raise && html`<${DdRaiseForm} d=${d} onDone=${id => (setRaise(false), setOpenId(id), reload())} onCancel=${() => setRaise(false)} />`}
    <div className="seg">${[['open', 'Open' + (d.issues.filter(x => x.st !== 'closed').length ? ' · ' + d.issues.filter(x => x.st !== 'closed').length : '')], ['mine', d.staff ? 'Mine' : 'Raised by me'], ['all', 'All']].map(([k, n]) => html`<button key=${k} type="button" className=${f === k ? 'on' : ''} onClick=${() => setF(k)}>${n}</button>`)}${d.staff && unowned > 0 && html`<span className="small amber crright">${unowned} without an owner</span>`}</div>
    ${rows.length ? html`<ul className="list ddlist">${rows.map(it => html`<${DdIssue} key=${it.id} it=${it} d=${d} onChanged=${reload} open0=${it.id === openId} />`)}</ul>` : html`<${Empty} title=${f === 'open' ? 'Nothing open' : 'Nothing here'}>${f === 'open' ? (d.staff ? 'Questions and issues the company raises land here with their acknowledgement target.' : 'Raise a question or an issue and see who owns it, what is planned and when it is resolved.') : 'Try another filter.'}<//>`}
  </section>`;
}

/* ---------- the client's page ---------- */
// v67: one line about a start plan: the date, what is confirmed, what blocks
const ddPlanLine = p => (p.st === 'started' ? 'started ' + p.actual : p.st === 'confirmed' ? 'start confirmed for ' + p.confirmed : p.st === 'cancelled' ? 'start cancelled' : 'planned ' + (p.planned || 'date to be agreed') + ' · ' + p.done + ' of ' + p.items + ' items done' + (p.blocking ? ' · ' + p.blocking + ' blocking' : '') + (p.missing ? ' · ' + p.missing + ' confirmation' + (p.missing === 1 ? '' : 's') + ' to come' : ''));
function CrDeliveryPage({ q }) {
  const P = usePortal();
  const [d, err, reload] = useDdHome(P.cid, 0);
  const [plan, setPlan] = useState((q && q.s) || '');
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${reload} />`;
  if (!d) return html`<${Spinner} label="Opening the delivery desk…" />`;
  const link = x => (x.k === 'req' ? '#/portal/requirements?t=hiring&r=' + x.id : x.k === 'prop' ? '#/portal/proposals?p=' + x.id : '#/portal/supplier');
  return html`<div className="stack crpage ddpage">
    <div className="muted small">One place for the engagement with StratEdge: who owns your account and covers for them, what waits for you, where each request stands, interviews and agreed starts, and the questions and issues you raised, each with its owner, next action and resolution.</div>
    <${DdTeamCard} d=${d} onChanged=${reload} />
    <div className="g2" style=${{ alignItems: 'start' }}>
      <section className="panel stack"><div className="ph-row"><h2 className="ph">Waiting for you</h2></div>
        ${d.decisions.length ? html`<ul className="list">${d.decisions.map(x => html`<li key=${x.k + x.id}><div><div className="t">${x.ti}</div><div className="m">${x.what} · since ${fmtTs(x.since)}</div></div><a className="btn sm" href=${link(x)}>Open</a></li>`)}</ul>` : html`<${Empty} title="Nothing waits for you" />`}
      </section>
      <section className="panel stack"><div className="ph-row"><h2 className="ph">Interviews in progress</h2></div>
        ${d.interviews.length ? html`<ul className="list">${d.interviews.map(x => html`<li key=${x.id}><div><div className="t">${x.alias}</div><div className="m">${x.reqTi} · ${x.stageN || (x.st === 'question' ? 'Question asked' : 'Interview requested')}${x.date ? ' · ' + x.date : ''}</div></div><a className="btn ghost sm" href=${'#/portal/requirements?t=hiring&r=' + x.req + '&tab=short'}>Shortlist</a></li>`)}</ul>` : html`<${Empty} title="No interview in progress" />`}
      </section>
    </div>
    <section className="panel stack"><div className="ph-row"><h2 className="ph">Active requests</h2><a className="small crright" href="#/portal/requirements?t=hiring">All talent requests</a></div>
      ${d.reqs.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Role</th><th>Status</th><th>Next</th><th>Start</th></tr></thead><tbody>${d.reqs.map(r => html`<tr key=${r.id} className="click" onClick=${() => (location.hash = '#/portal/requirements?t=hiring&r=' + r.id)}><td><b>${r.ti}</b></td><td><${Chip} s=${CR_TONE[r.st]}>${r.stN || r.st}<//></td><td className=${r.mine ? 'crmine' : ''}>${r.next ? (r.mine ? 'You' : r.next) : '—'}</td><td className="nw">${r.sd || '—'}${r.startChanged && html` <${Chip} s="amber">changed since approval<//>`}</td></tr>`)}</tbody></table></div>` : html`<${Empty} title="No active request" />`}
    </section>
    <section className="panel stack"><div className="ph-row"><h2 className="ph">Agreed starts</h2></div>
      ${d.starts.length ? html`<ul className="list">${d.starts.map(x => html`<li key=${x.id}><div><div className="t">${x.alias} · ${x.reqTi}</div><div className="m">Selected ${x.decAt ? fmtTs(x.decAt) : ''}${x.decN ? ' by ' + x.decN : ''}${x.plan ? ' · ' + ddPlanLine(x.plan) : ' · start ' + (x.sd || 'to be agreed')}${x.availFrom ? ' · available from ' + x.availFrom : ''}</div></div><div className="actions">${x.startChanged && html`<${Chip} s="amber">Start date changed since approval<//>`}${x.plan && html`<${Chip} s=${ST_TONE[x.plan.st]}>${x.plan.stN}<//>`}${x.plan && html`<button type="button" className="btn sm" onClick=${() => setPlan(x.id)}>Start plan</button>`}</div></li>`)}</ul>` : html`<${Empty} title="No agreed start yet">Selected candidates and their start dates appear here.<//>`}
      ${plan && html`<${StPlanModal} sl=${plan} staff=${false} onClose=${() => setPlan('')} onChanged=${reload} />`}
    </section>
    <${DdIssues} d=${d} reload=${reload} q=${q} />
  </div>`;
}

/* ---------- the staff desk tab ---------- */
function DdMeasures({ m }) {
  const pct = (a, b) => (b ? Math.round((100 * a) / b) + '%' : '—');
  const few = m.issues < 5;
  return html`<section className="panel stack ddmeasures"><div className="ph-row"><h2 className="ph">Measures, last ${m.days} days</h2><span className="muted small crright">Volume: ${m.volume.reqsNew} new request${m.volume.reqsNew === 1 ? '' : 's'}, ${m.volume.reqsOpen} open, ${m.volume.cands} candidate${m.volume.cands === 1 ? '' : 's'} shared, ${m.issues} issue${m.issues === 1 ? '' : 's'}</span></div>
    <div className="kpis" style=${{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
      <div><b className=${m.unowned ? 'amber' : ''}>${m.unowned}</b><span>Open without an owner</span></div>
      <div><b className=${m.lateNow ? 'red' : ''}>${m.lateNow}</b><span>Past a target right now</span></div>
      <div><b>${pct(m.ackOk, m.ackN)}</b><span>Acknowledged within target (${m.ackOk} of ${m.ackN})</span></div>
      <div><b>${pct(m.resOk, m.resN)}</b><span>Resolved within target (${m.resOk} of ${m.resN})</span></div>
      <div><b className=${m.overdueDecisions ? 'amber' : ''}>${m.overdueDecisions}</b><span>Buyer decisions overdue (> 5 days)</span></div>
      <div><b>${m.repeat}</b><span>Repeat issues</span></div>
      <div><b className=${m.startChanges ? 'amber' : ''}>${m.startChanges}</b><span>Start dates changed since approval</span></div>
      <div><b>${m.escalated}</b><span>Escalated</span></div>
    </div>
    ${m.starts && html`<div className="kpis ddstarts" style=${{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
      <div><b>${m.starts.confirmed}</b><span>Starts confirmed (of ${m.starts.plans} planned in the window)</span></div>
      <div><b>${m.starts.started ? pct(m.starts.onTime, m.starts.started) : '—'}</b><span>Started on time (${m.starts.onTime} of ${m.starts.started})</span></div>
      <div><b className=${m.starts.revised ? 'amber' : ''}>${m.starts.revised}</b><span>Dates moved${m.starts.revised ? ': StratEdge ' + m.starts.delaysBy.stratedge + ', consultant ' + m.starts.delaysBy.consultant + ', company ' + m.starts.delaysBy.client : ''}</span></div>
      <div><b className=${m.starts.firstDayIssues ? 'amber' : ''}>${m.starts.firstDayIssues}</b><span>Open issues on starting requests</span></div>
    </div>`}
    ${few && html`<p className="muted small" style=${{ margin: 0 }}>With ${m.issues} issue${m.issues === 1 ? '' : 's'} in the period these are counts, not a service rate: one case does not make a general failure or a general success.</p>`}
  </section>`;
}
function CrDeskTab({ cos, cid0, q }) {
  const [cid, setCid] = useState(cid0 || (q && q.c) || (cos[0] && cos[0].id) || '');
  const [days, setDays] = useState(90);
  const [d, err, reload] = useDdHome(cid, days);
  const [plan, setPlan] = useState((q && q.s) || '');
  useEffect(() => {
    if (cid0) setCid(cid0);
  }, [cid0]);
  if (!cos.length) return html`<${Empty} title="No client companies">Add client companies under Clients first.<//>`;
  const pick = html`<div className="toolbar"><select value=${cid} aria-label="Client company" onChange=${e => setCid(e.target.value)}>${cos.map(x => html`<option key=${x.id} value=${x.id}>${x.n}</option>`)}</select><div className="seg">${[[30, '30 days'], [90, '90 days'], [365, 'A year']].map(([k, n]) => html`<button key=${k} type="button" className=${days === k ? 'on' : ''} onClick=${() => setDays(k)}>${n}</button>`)}</div></div>`;
  if (err && !d) return html`<div className="stack">${pick}<${LoadError} error=${err} onRetry=${reload} /></div>`;
  if (!d) return html`<div className="stack">${pick}<${Spinner} label="Opening the delivery desk…" /></div>`;
  return html`<div className="stack ddpage">
    ${pick}
    <${DdMeasures} m=${d.measures} />
    <${DdTeamCard} d=${d} onChanged=${reload} />
    <${DdSettings} d=${d} onChanged=${reload} />
    <${StCfg} cid=${d.cid} co=${d.co} />
    <div className="g2" style=${{ alignItems: 'start' }}>
      <section className="panel stack"><div className="ph-row"><h2 className="ph">Active requests</h2></div>
        ${d.reqs.length ? html`<ul className="list">${d.reqs.map(r => html`<li key=${r.id}><div><div className="t">${r.ti}</div><div className="m">${r.stN || r.st} · next: ${r.next || '—'}${r.sd ? ' · start ' + r.sd : ''}${r.startChanged ? ' · start changed since approval' : ''}</div></div><a className="btn ghost sm" href=${'#/portal/' + (Cap.portals.includes('admin') ? 'admin' : Cap.portals.includes('hr') ? 'hr' : 'tools') + '/clientreq?r=' + r.id}>Open</a></li>`)}</ul>` : html`<${Empty} title="No active request" />`}
      </section>
      <section className="panel stack"><div className="ph-row"><h2 className="ph">Interviews and starts</h2></div>
        ${d.interviews.length + d.starts.length ? html`<ul className="list">${[...d.interviews, ...d.starts].map(x => html`<li key=${x.id}><div><div className="t">${x.alias} · ${x.reqTi}</div><div className="m">${x.st === 'selected' ? 'Selected · ' + (x.plan ? ddPlanLine(x.plan) : 'start ' + (x.sd || 'to be agreed')) + (x.startChanged ? ' (request start changed since approval)' : '') : x.stageN || 'Interview requested'}${x.date ? ' · ' + x.date : ''}</div></div>${x.plan && html`<div className="actions"><${Chip} s=${ST_TONE[x.plan.st]}>${x.plan.stN}<//><button type="button" className="btn sm" onClick=${() => setPlan(x.id)}>Start plan</button></div>`}</li>`)}</ul>` : html`<${Empty} title="No interview or start in progress" />`}
      </section>
      ${plan && html`<${StPlanModal} sl=${plan} staff=${true} onClose=${() => setPlan('')} onChanged=${reload} />`}
    </div>
    <${DdIssues} d=${d} reload=${reload} q=${q} />
  </div>`;
}
