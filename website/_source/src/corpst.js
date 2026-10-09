/* ================= v67 Start-readiness and buyer dependency tracker (CC-13) =================
   The start plan of a selected candidate (StPlanModal), opened from the delivery desk's "Agreed starts" (client portal
   and staff tab): the planned date and who confirmed it, the checklist by side (StratEdge, the consultant, the company)
   with done / supplied-and-checked / blocked-with-a-recovery, revising the date with its reason, the first day and the
   30/90-day check-ins (StratEdge), the history. StCfg edits the account's template and required parties (staff). Lives
   in js/work.js. */
const ST_TONE = { planned: 'amber', confirmed: 'ok', started: 'ok', cancelled: '' };
const ST_ITEM_TONE = { open: '', supplied: 'new', done: 'ok', blocked: 'red' };
const stDay = s => s || '—';

function StPlanModal({ sl, staff, onClose, onChanged }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [act, setAct] = useState(null);
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  const load = () => api('cr_st_get', { sl }).then(x => (setD(x), setErr(null)), setErr);
  useEffect(() => {
    load();
  }, [sl]);
  const run = async (route, body, msg) => {
    setBusy(true);
    try {
      const r = await api(route, { sl, ...body });
      setD(r);
      setAct(null);
      setF({});
      if (msg) toast(msg);
      onChanged && onChanged();
      return true;
    } catch (e) {
      toast(errText(e), true);
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (err && !d) return html`<${Modal} wide title="Start plan" onClose=${onClose}><${LoadError} error=${err} onRetry=${load} /><//>`;
  if (!d) return html`<${Modal} wide title="Start plan" onClose=${onClose}><${Spinner} /><//>`;
  const p = d.plan;
  const can = p.can;
  const sides = ['stratedge', 'consultant', 'client'];
  const bySide = s => p.items.filter(it => it.side === s);
  const confRow = party => {
    const c = p.conf[party];
    const mayConfirm = party === 'stratedge' ? can.confirmStratedge : party === 'consultant' ? can.confirmConsultant : can.confirmClient;
    return html`<li key=${party}><div><div className="t">${p.parties[party]}${!p.req.includes(party) && html` <span className="muted small">(not required by this account)</span>`}</div><div className="m">${c ? `Confirmed ${c.date} · recorded by ${c.n}, ${fmtTs(c.at)}${c.note ? ' · ' + c.note : ''}` : p.st === 'planned' ? 'Not yet' : '—'}</div></div>${c ? html`<${Chip} s="ok">Confirmed<//>` : mayConfirm ? html`<button type="button" className="btn sm" disabled=${busy} onClick=${() => (setAct('confirm:' + party), setF({}))}>${party === 'client' ? 'Confirm the date' : party === 'consultant' ? 'Record the consultant\'s confirmation…' : 'Confirm for StratEdge…'}</button>` : p.req.includes(party) && p.st === 'planned' ? html`<${Chip} s="amber">Waiting<//>` : null}</li>`;
  };
  const itemRow = it => {
    const mine = staff || it.side === 'client';
    return html`<li key=${it.id} className=${'stitem' + (it.st === 'blocked' ? ' stblocked' : '')}><div>
      <div className=${'t' + (it.st === 'done' ? ' stdone' : '')}>${it.text}${it.blocking && html` <${Chip} s=${it.st === 'done' ? '' : 'amber'}>blocks the start<//>`}</div>
      <div className="m">${it.stN}${it.due ? ' · due ' + it.due : ''}${it.by && it.at ? ' · ' + it.by + ', ' + fmtTs(it.at) : ''}${it.note ? ' · ' + it.note : ''}${it.st === 'blocked' && it.recovery ? html`<div className="small"><b>Recovery:</b> ${it.recovery}${it.recoveryOwner ? ' (' + it.recoveryOwner + ')' : ''}</div>` : ''}</div>
    </div>
    ${can.item && act === null && html`<div className="actions stacts">
      ${it.st !== 'done' && it.st !== 'supplied' && mine && html`<button type="button" className="btn sm" disabled=${busy} onClick=${() => run('cr_st_item', { iid: it.id, act: 'done' }, it.review && !staff ? 'Supplied; StratEdge checks it.' : 'Done.')}>${it.review && !staff ? 'Supplied' : 'Done'}</button>`}
      ${it.st === 'supplied' && staff && html`<button type="button" className="btn sm" disabled=${busy} onClick=${() => run('cr_st_item', { iid: it.id, act: 'approve' }, 'Checked and done.')}>Checked, done</button><button type="button" className="btn ghost sm" onClick=${() => (setAct('return:' + it.id), setF({}))}>Return…</button>`}
      ${it.st !== 'blocked' && it.st !== 'done' && html`<button type="button" className="btn ghost sm" onClick=${() => (setAct('block:' + it.id), setF({}))}>Blocked…</button>`}
      ${(it.st === 'blocked' || (it.st === 'done' && mine)) && html`<button type="button" className="btn ghost sm" disabled=${busy} onClick=${() => run('cr_st_item', { iid: it.id, act: 'reopen' }, 'Reopened.')}>Reopen</button>`}
      ${it.st !== 'done' && html`<button type="button" className="btn ghost sm" onClick=${() => (setAct('note:' + it.id), setF({ due: it.due || '' }))}>Note…</button>`}
    </div>`}
    ${act && act.endsWith(':' + it.id) && html`<div className="form stack crform2 stform">
      ${act.startsWith('block:') && html`<div className="row2"><${Field} label="What blocks it"><input value=${f.note || ''} maxLength="1000" onInput=${e => setF({ ...f, note: e.target.value })} /><//><${Field} label="Recovery action (who does what by when)"><input value=${f.recovery || ''} maxLength="500" onInput=${e => setF({ ...f, recovery: e.target.value })} /><//></div><${Field} label="Recovery owner (optional)"><input value=${f.owner || ''} maxLength="120" onInput=${e => setF({ ...f, owner: e.target.value })} /><//>`}
      ${act.startsWith('return:') && html`<${Field} label="What is missing"><input value=${f.note || ''} maxLength="1000" onInput=${e => setF({ ...f, note: e.target.value })} /><//>`}
      ${act.startsWith('note:') && html`<div className="row2"><${Field} label="Note"><input value=${f.note || ''} maxLength="1000" onInput=${e => setF({ ...f, note: e.target.value })} /><//><${Field} label="Due (optional)"><input type="date" value=${f.due || ''} onInput=${e => setF({ ...f, due: e.target.value })} /><//></div>`}
      <div className="actions"><button type="button" className="btn sm" disabled=${busy || (act.startsWith('block:') && !((f.note || '').trim() && (f.recovery || '').trim())) || (act.startsWith('return:') && !(f.note || '').trim()) || (act.startsWith('note:') && !(f.note || '').trim() && (f.due || '') === (it.due || ''))} onClick=${async () => {
        if (act.startsWith('block:')) return run('cr_st_item', { iid: it.id, act: 'block', note: f.note, recovery: f.recovery, owner: f.owner || '' }, 'Flagged as blocked; the other side is told.');
        if (act.startsWith('return:')) return run('cr_st_item', { iid: it.id, act: 'return', note: f.note }, 'Returned.');
        if ((f.due || '') !== (it.due || '')) await run('cr_st_item', { iid: it.id, act: 'due', due: f.due || '' });
        if ((f.note || '').trim()) return run('cr_st_item', { iid: it.id, act: 'note', note: f.note }, 'Noted.');
        setAct(null);
      }}>${act.startsWith('block:') ? 'Flag as blocked' : act.startsWith('return:') ? 'Return' : 'Save'}</button><button type="button" className="btn ghost sm" onClick=${() => setAct(null)}>Cancel</button></div>
    </div>`}
  </li>`;
  };
  const foot = html`<button className="btn ghost" onClick=${onClose}>Close</button>${can.revise && act === null && html`<button className="btn ghost" onClick=${() => (setAct('revise'), setF({ date: p.planned, side: staff ? 'stratedge' : 'client' }))}>Move the date…</button>`}${can.started && act === null && html`<button className="btn" onClick=${() => (setAct('started'), setF({ date: p.confirmed }))}><${Icon} n="check" />Record the first day…</button>`}${can.cancel && act === null && html`<button className="btn ghost" onClick=${() => (setAct('cancel'), setF({}))}>Cancel the start…</button>`}`;
  return html`<${Modal} wide title=${'Start plan: ' + p.alias + ' · ' + p.reqTi} onClose=${onClose} foot=${foot}>
    <div className="stack stplan">
      <div className="ddgrid">
        <div><span className="lbl">Status</span><b><${Chip} s=${ST_TONE[p.st]}>${p.stN}<//></b>${p.st === 'planned' && html`<div className="small">${p.ready ? 'Ready: the confirmations are in and nothing blocks it.' : (p.missing.length ? 'Waiting for: ' + p.missing.map(x => p.parties[x]).join(', ') + '. ' : '') + (p.blocking.length ? p.blocking.length + ' blocking item' + (p.blocking.length === 1 ? '' : 's') + ' open.' : '')}</div>`}${p.cancel && html`<div className="small">${p.cancel.why} (${p.cancel.by})</div>`}</div>
        <div><span className="lbl">${p.st === 'started' ? 'First day' : p.confirmed ? 'Confirmed start' : 'Planned start'}</span><b>${p.st === 'started' ? p.actual : p.confirmed || stDay(p.planned)}</b>${p.st === 'started' && p.actual !== p.confirmed && html`<div className="small amber">Confirmed for ${p.confirmed}</div>`}${p.versions.length > 1 && html`<div className="small">${p.versions.length - 1} change${p.versions.length === 2 ? '' : 's'} of date</div>`}</div>
        <div><span className="lbl">Hiring manager</span><b>${p.hiringMgr || '—'}</b>${p.openIssues > 0 && html`<div className="small amber">${p.openIssues} open issue${p.openIssues === 1 ? '' : 's'} on the delivery desk about this request</div>`}</div>
      </div>
      ${act === 'revise' && html`<div className="form stack crform2"><div className="row3"><${Field} label="New start date"><input type="date" value=${f.date || ''} onInput=${e => setF({ ...f, date: e.target.value })} /><//><${Field} label="Whose side moves it">${staff ? html`<select value=${f.side} onChange=${e => setF({ ...f, side: e.target.value })}>${Object.entries(p.sides).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select>` : html`<input value="The company" disabled />`}<//><${Field} label="Why"><input value=${f.why || ''} maxLength="500" onInput=${e => setF({ ...f, why: e.target.value })} /><//></div><div className="actions"><button type="button" className="btn sm" disabled=${busy || !f.date || !(f.why || '').trim()} onClick=${() => run('cr_st_revise', { date: f.date, why: f.why, side: f.side }, 'Date moved; confirmations are asked again.')}>Move the date</button><button type="button" className="btn ghost sm" onClick=${() => setAct(null)}>Cancel</button></div></div>`}
      ${act === 'started' && html`<div className="form stack crform2"><div className="row2"><${Field} label="First day"><input type="date" value=${f.date || ''} onInput=${e => setF({ ...f, date: e.target.value })} /><//><${Field} label="Note (optional)"><input value=${f.note || ''} maxLength="500" onInput=${e => setF({ ...f, note: e.target.value })} /><//></div><div className="actions"><button type="button" className="btn sm" disabled=${busy || !f.date} onClick=${() => run('cr_st_started', { date: f.date, note: f.note || '' }, 'Started.')}>Record</button><button type="button" className="btn ghost sm" onClick=${() => setAct(null)}>Cancel</button></div></div>`}
      ${act === 'cancel' && html`<div className="form stack crform2"><${Field} label="Why the start is cancelled"><input value=${f.why || ''} maxLength="500" onInput=${e => setF({ ...f, why: e.target.value })} /><//><div className="actions"><button type="button" className="btn danger sm" disabled=${busy || !(f.why || '').trim()} onClick=${() => run('cr_st_cancel', { why: f.why }, 'Cancelled.')}>Cancel the start</button><button type="button" className="btn ghost sm" onClick=${() => setAct(null)}>Keep it</button></div></div>`}
      ${act && act.startsWith('confirm:') && html`<div className="form stack crform2"><${Field} label=${act === 'confirm:consultant' ? 'How the consultant confirmed (the evidence)' : 'Note (optional)'}><input value=${f.note || ''} maxLength="500" placeholder=${act === 'confirm:consultant' ? 'e.g. email of Oct 7, signed offer' : ''} onInput=${e => setF({ ...f, note: e.target.value })} /><//><div className="actions"><button type="button" className="btn sm" disabled=${busy || (act === 'confirm:consultant' && (f.note || '').trim().length < 5)} onClick=${() => run('cr_st_confirm', { party: act.slice(8), note: f.note || '' }, 'Confirmed.')}>Confirm ${p.planned}</button><button type="button" className="btn ghost sm" onClick=${() => setAct(null)}>Cancel</button></div></div>`}
      <section className="stack"><div className="ph-row"><h3 className="ph">Who confirms the start date</h3></div><ul className="list">${sides.map(confRow)}</ul></section>
      ${sides.map(s => html`<section key=${s} className="stack"><div className="ph-row"><h3 className="ph">${p.sides[s]}: ${bySide(s).filter(x => x.st === 'done').length} of ${bySide(s).length} done</h3>${can.addItem && (staff || s === 'client') && act === null && html`<button type="button" className="btn ghost sm" onClick=${() => (setAct('add:' + s), setF({}))}><${Icon} n="plus" />Add</button>`}</div>
        ${act === 'add:' + s && html`<div className="form stack crform2"><div className="row3"><${Field} label="What has to be done"><input value=${f.text || ''} maxLength="200" onInput=${e => setF({ ...f, text: e.target.value })} /><//><${Field} label="Due (optional)"><input type="date" value=${f.due || ''} onInput=${e => setF({ ...f, due: e.target.value })} /><//><label className="check" style=${{ alignSelf: 'end' }}><input type="checkbox" checked=${!!f.blocking} onChange=${e => setF({ ...f, blocking: e.target.checked })} /><span>Blocks the start</span></label></div><div className="actions"><button type="button" className="btn sm" disabled=${busy || (f.text || '').trim().length < 3} onClick=${() => run('cr_st_add', { text: f.text, side: s, due: f.due || '', blocking: f.blocking ? 1 : 0 }, 'Added.')}>Add the item</button><button type="button" className="btn ghost sm" onClick=${() => setAct(null)}>Cancel</button></div></div>`}
        ${bySide(s).length ? html`<ul className="list stlist">${bySide(s).map(itemRow)}</ul>` : html`<p className="muted small" style=${{ margin: 0 }}>Nothing for ${p.sides[s].toLowerCase()}.</p>`}
      </section>`)}
      ${p.st === 'started' && html`<section className="stack"><div className="ph-row"><h3 className="ph">Check-ins</h3></div><ul className="list">${[30, 90].map(day => { const c = p.checkins[String(day)]; return html`<li key=${day}><div><div className="t">${day} days</div><div className="m">${c ? (c.ok ? 'Still on assignment' : 'No longer on assignment') + ' · ' + c.by + ', ' + fmtTs(c.at) + (c.note ? ' · ' + c.note : '') : 'Not recorded yet'}</div></div>${can.checkin && !c && act === null && html`<div className="actions"><button type="button" className="btn sm" disabled=${busy} onClick=${() => run('cr_st_checkin', { day, ok: 1 }, 'Recorded.')}>Still on assignment</button><button type="button" className="btn ghost sm" onClick=${() => (setAct('checkin:' + day), setF({}))}>Ended…</button></div>`}${act === 'checkin:' + day && html`<div className="form stack crform2"><${Field} label="What happened"><input value=${f.note || ''} maxLength="500" onInput=${e => setF({ ...f, note: e.target.value })} /><//><div className="actions"><button type="button" className="btn sm" disabled=${busy || !(f.note || '').trim()} onClick=${() => run('cr_st_checkin', { day, ok: 0, note: f.note }, 'Recorded.')}>Record</button><button type="button" className="btn ghost sm" onClick=${() => setAct(null)}>Cancel</button></div></div>`}</li>`; })}</ul></section>`}
      ${p.versions.length > 1 && html`<details className="crcmp"><summary>Date history (${p.versions.length})</summary><ul className="list">${p.versions.map((v, i) => html`<li key=${i}><div><div className="t">${v.planned}${v.from ? ' (was ' + v.from + ')' : ''}</div><div className="m">${v.reason}${v.side ? ' · ' + p.sides[v.side] : ''} · ${v.by}, ${fmtTs(v.at)}</div></div></li>`)}</ul></details>`}
      ${d.evs && d.evs.length > 0 && html`<details className="crcmp"><summary>History (${d.evs.length})</summary><div className="crlog">${d.evs.map((e, i) => html`<div key=${i} className=${'crev ' + e.side}><span className="small muted">${fmtTs(e.at)} · ${e.byn}</span><div className="crpre small">${e.msg}</div></div>`)}</div></details>`}
    </div>
  <//>`;
}

/* ---------- staff: the account's checklist template and who confirms ---------- */
function StCfg({ cid, co }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [tpl, setTpl] = useState(null);
  const [req, setReq] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setD(null);
    api('cr_st_cfg', { cid }).then(x => (setD(x), setTpl(x.cfg.tpl.map(([text, side, blocking, review]) => ({ text, side, blocking, review }))), setReq(x.cfg.req)), e => toast(errText(e), true));
  }, [cid]);
  if (!d || !tpl) return html`<${Spinner} />`;
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('cr_st_cfg', { cid, tpl: tpl.filter(x => x.text.trim()), req });
      setD(r);
      toast('Saved for ' + co + '.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const up = (i, k, v) => setTpl(tpl.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return html`<details className="crcmp stcfg"><summary>Start checklist and who confirms a start (StratEdge)</summary>
    <div className="form stack" style=${{ marginTop: 8 }}>
      <p className="muted small" style=${{ margin: 0 }}>Every selected candidate gets this checklist as their start plan (the account's needs, not a universal list); items marked "checked" are supplied by the company and checked by StratEdge before they count. ${d.cfg.custom ? `Changed by ${d.cfg.by}, ${fmtTs(d.cfg.at)}.` : 'The default list is in place.'}</p>
      <div className="tblwrap"><table className="tbl sttpl"><thead><tr><th>Item</th><th>Whose</th><th>Blocks</th><th>Checked</th><th></th></tr></thead><tbody>${tpl.map((x, i) => html`<tr key=${i}><td><input value=${x.text} maxLength="200" aria-label=${'Item ' + (i + 1)} onInput=${e => up(i, 'text', e.target.value)} /></td><td><select value=${x.side} aria-label=${'Side ' + (i + 1)} onChange=${e => up(i, 'side', e.target.value)}>${Object.entries(d.sides).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select></td><td><input type="checkbox" checked=${!!x.blocking} aria-label=${'Blocks ' + (i + 1)} onChange=${e => up(i, 'blocking', e.target.checked)} /></td><td><input type="checkbox" checked=${!!x.review} aria-label=${'Checked ' + (i + 1)} onChange=${e => up(i, 'review', e.target.checked)} /></td><td className="r"><button type="button" className="btn ghost sm" onClick=${() => setTpl(tpl.filter((_, j) => j !== i))}>Remove</button></td></tr>`)}</tbody></table></div>
      <div className="actions"><button type="button" className="btn ghost sm" onClick=${() => setTpl([...tpl, { text: '', side: 'client', blocking: false, review: false }])}><${Icon} n="plus" />Add an item</button><button type="button" className="btn ghost sm" onClick=${() => setTpl(d.dflt.map(([text, side, blocking, review]) => ({ text, side, blocking, review })))}>Back to the default list</button></div>
      <span className="lbl">Who must confirm a start date</span>
      <div className="crpick">${Object.entries(d.parties).map(([k, n]) => html`<label key=${k} className="check"><input type="checkbox" checked=${req.includes(k)} onChange=${e => setReq(e.target.checked ? [...req, k] : req.filter(x => x !== k))} /><span>${n}</span></label>`)}</div>
      <div><button type="button" className="btn" disabled=${busy || !req.length || !tpl.some(x => x.text.trim())} onClick=${save}>Save</button></div>
    </div></details>`;
}
