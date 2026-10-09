/* ================= v48 The shortlist room (CC-03), a tab of a talent request (in js/work.js) =================
   StratEdge presents candidates as consistent packets (each must-have skill with its evidence and how it is known,
   the screening, open questions, availability and when it was last confirmed, the rate, interviews); the client
   compares them side by side and decides on each. Server: api/corpsl.php. */
const SL_TONE = { draft: '', shared: 'info', question: 'amber', interview: 'new', hold: '', declined: 'red', selected: 'ok', withdrawn: '' };
const SL_KTONE = { claim: '', reviewed: 'info', verified: 'ok' };
const slRate = (r, units) => (!r || r.unit === 'tbd' ? 'To be discussed' : r.amt == null ? '—' : crMoney(r.cur, r.amt) + ' ' + (units[r.unit] || r.unit));
const slAgo = ms => {
  if (!ms) return 'never';
  const d = Math.floor((Date.now() - ms) / 86400000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago';
};
const slFileHref = (id, ver) => 'api/index.php?r=cr_sl_file&id=' + encodeURIComponent(id) + '&ver=' + ver;

function CrShortlist({ R, home, onChanged }) {
  const toast = useToast();
  const staff = home.staff;
  const [d, setD] = useState(null);
  const [view, setView] = useState('cards');
  const [edit, setEdit] = useState(null);
  const [act, setAct] = useState(null);
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  const [find, setFind] = useState('');
  const [hits, setHits] = useState(null);
  const load = () => api('cr_sl_list', { req: R.id }).then(setD, e => toast(errText(e), true));
  useEffect(() => {
    load();
  }, [R.id]);
  if (!d) return html`<${Spinner} label="Loading the shortlist…" />`;
  const run = async (route, body, msg) => {
    setBusy(true);
    try {
      const r = await api(route, body);
      toast(msg);
      setAct(null);
      setF({});
      load();
      onChanged && onChanged();
      setBusy(false);
      return r;
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
    return null;
  };
  const search = async () => {
    try {
      setHits((await api('cr_sl_find', { q: find })).hits);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const items = d.items.filter(it => staff || it.st !== 'withdrawn' || it.ver > 0);
  const live = items.filter(it => it.ver > 0 && it.st !== 'withdrawn');
  const m = d.measures;
  const canBuild = staff && ['approved', 'active', 'hold'].includes(R.st);
  return html`<div className="stack slroom">
      ${
        staff
          ? html`<div className="note"><span>${R.st === 'active' ? 'Add candidates from the submissions to this requirement (the name and resume can be shared once a submission was sent on the bench desk) or from the consultant database (an anonymized preview), fill in each packet, then share it. The client decides on the current version of each.' : 'Start sourcing first; then candidates can be shared.'}</span></div>
            ${m && m.shared > 0 && html`<div className="slmeasures small"><b>${m.shared}</b> shared · <b>${m.decided}</b> decided${m.firstMs ? html` · first decision after <b>${(m.firstMs / 86400000).toFixed(1)}</b> days on average` : ''} · interviews requested for <b>${m.ivReq}</b> of ${m.decided || 0} reviewed · <b>${m.ivDone}</b> completed · <b>${m.selected}</b> selected</div>`}`
          : html`<div className="muted small">Candidates StratEdge shortlisted for this role. Each packet shows the evidence for your must-have skills and how it is known: what the candidate says, what StratEdge reviewed, or what was verified. Ask for an interview, ask a question, hold, decline or select each one.</div>`
      }
      ${
        canBuild &&
        html`<details className="crcmp sladd" open=${items.length === 0}>
          <summary>Add a candidate</summary>
          <div className="stack">
            ${(d.subs || []).length ? html`<div className="tblwrap"><table className="tbl small"><thead><tr><th>Submission to this requirement</th><th>Stage</th><th></th></tr></thead><tbody>${d.subs.map(s => html`<tr key=${s.sid}><td>${s.cn}</td><td>${s.stN}${s.sent ? '' : html` <span className="muted">(not sent yet: an anonymized preview only)</span>`}</td><td className="r"><button type="button" className="btn ghost sm" disabled=${busy} onClick=${() => run('cr_sl_add', { req: R.id, sub: s.sid }, 'Added to the shortlist.')}><${Icon} n="plus" />Add</button></td></tr>`)}</tbody></table></div>` : html`<p className="muted small" style=${{ margin: 0 }}>${R.vreq ? 'No submissions to this requirement on the bench desk yet.' : 'The requirement is not on the desk yet.'}</p>`}
            <div className="toolbar" style=${{ marginBottom: 0 }}><input type="search" value=${find} placeholder="Find a consultant by name, title or skill" aria-label="Find a consultant" onInput=${e => setFind(e.target.value)} onKeyDown=${e => e.key === 'Enter' && search()} /><button type="button" className="btn ghost sm" onClick=${search}>Find</button></div>
            ${hits && (hits.length ? html`<div className="tblwrap"><table className="tbl small"><tbody>${hits.map(h => html`<tr key=${h.cand}><td><b>${h.n}</b><div className="muted">${[h.ti, h.loc].filter(Boolean).join(' · ')}</div></td><td className="r"><button type="button" className="btn ghost sm" disabled=${busy} onClick=${() => run('cr_sl_add', { req: R.id, cand: h.cand }, 'Added (an anonymized preview until a submission is sent).')}><${Icon} n="plus" />Add</button></td></tr>`)}</tbody></table></div>` : html`<p className="muted small">Nobody found.</p>`)}
          </div>
        </details>`
      }
      ${
        items.length > 0 &&
        html`<div className="toolbar" style=${{ marginBottom: 0 }}><div className="seg">${[['cards', 'Candidates'], ['compare', 'Side by side']].map(([k, n]) => html`<button key=${k} type="button" className=${view === k ? 'on' : ''} onClick=${() => setView(k)}>${n}</button>`)}</div><span className="muted small crright">${live.length} shared${staff && items.length > live.length ? ' · ' + (items.length - live.length) + ' not shared' : ''}</span></div>`
      }
      ${!items.length && !canBuild && html`<${Empty} title="No candidates yet">${staff ? 'Candidates can be added once the request is approved.' : 'StratEdge shares candidates here as soon as they are screened.'}<//>`}
      ${
        view === 'compare' && items.length > 0
          ? html`<${SlCompare} items=${staff ? items : live} d=${d} staff=${staff} />`
          : html`<div className="slgrid">${items.map(it => html`<${SlCard} key=${it.id} it=${it} d=${d} staff=${staff} home=${home} busy=${busy} act=${act && act.id === it.id ? act.act : null} f=${f} setF=${setF} onAct=${a => (setAct(a ? { id: it.id, act: a } : null), setF({}))} onEdit=${() => setEdit(it)} run=${run} />`)}</div>`
      }
      ${edit && html`<${SlEditor} it=${edit} d=${d} curs=${home.curs} onClose=${() => setEdit(null)} onSaved=${() => (setEdit(null), load())} />`}
    </div>`;
}

/* One candidate's packet, with the actions the caller may take */
function SlCard({ it, d, staff, busy, act, f, setF, onAct, onEdit, run }) {
  const p = staff && !it.ver ? it.draft : it.data;
  const live = ['shared', 'question', 'interview', 'hold'].includes(it.st);
  const open = ['draft', ...['shared', 'question', 'interview', 'hold']].includes(it.st);
  const showName = staff || !it.anon;
  // the name and resume can go out once the submission to this requirement was sent on the bench desk
  const canName = !!it.sub && !!it.subSt && !['shortlisted', 'approval', 'ready'].includes(it.subSt);
  const mode = f.mode || ((it.ver > 0 && !it.anon) || canName ? 'named' : 'anon');
  const body = { id: it.id, ver: it.ver };
  const warn = staff && !it.ver ? it.draftWarn : it.warn;
  const form = (title, label, ok, extra, onOk) => html`<div className="crform2 form">
      <b>${title}</b>
      ${extra}
      ${label && html`<${Field} label=${label}><textarea rows="2" value=${f.msg || ''} onInput=${e => setF({ ...f, msg: e.target.value })} /><//>`}
      <div className="actions"><button type="button" className="btn ghost sm" onClick=${() => onAct(null)}>Cancel</button><button type="button" className="btn sm" disabled=${busy} onClick=${onOk}>${ok}</button></div>
    </div>`;
  return html`<article className=${'slcard' + (it.st === 'declined' || it.st === 'withdrawn' ? ' done' : '')}>
      <header className="slhead">
        <div><b>${it.alias}</b>${showName && p.name ? html` <span className="slname">${p.name}</span>` : ''}${p.headline && html`<div className="muted small">${p.headline}</div>`}</div>
        <div className="slchips"><${Chip} s=${SL_TONE[it.st]}>${d.st[it.st] || it.st}<//>${it.ver > 0 && html`<${Chip}>v${it.ver}<//>`}${it.ver > 0 && it.anon && html`<${Chip}>Anonymized preview<//>`}${staff && it.unshared && html`<${Chip} s="amber">unshared changes<//>`}${staff && it.subStN && html`<${Chip} s="new">Submission: ${it.subStN}<//>`}</div>
      </header>
      ${warn && html`<div className="note amber slwarn"><span>${warn}</span></div>`}
      ${p.summary && html`<p className="crpre slsum">${p.summary}</p>`}
      ${
        (p.match || []).length > 0 &&
        html`<section><h4>Your must-have skills</h4><ul className="slev">${p.match.map((x, i) => html`<li key=${i}><div><b>${x.need}</b>${x.ev ? html`<div className="small">${x.ev}</div>` : html`<div className="small muted">No evidence yet</div>`}</div><${Chip} s=${SL_KTONE[x.kind]}>${d.kinds[x.kind]}<//></li>`)}</ul></section>`
      }
      ${(p.ev || []).length > 0 && html`<section><h4>Other evidence</h4><ul className="slev">${p.ev.map((x, i) => html`<li key=${i}><div className="small">${x.t}${x.src ? html` <span className="muted">(${x.src})</span>` : ''}</div><${Chip} s=${SL_KTONE[x.kind]}>${d.kinds[x.kind]}<//></li>`)}</ul></section>`}
      <dl className="kv slkv">
        ${p.screen && p.screen.date && html`<dt>Screened</dt><dd>${crDay(p.screen.date)}${p.screen.by ? ' by ' + p.screen.by : ''}${p.screen.notes ? html`<div className="small crpre">${p.screen.notes}</div>` : ''}</dd>`}
        <dt>Available</dt><dd>${[p.avail && p.avail.from ? 'from ' + crDay(p.avail.from) : '', p.avail && p.avail.note].filter(Boolean).join(' · ') || '—'}<div className="small muted">Last confirmed ${slAgo(p.avail && p.avail.conf)}</div></dd>
        <dt>Rate</dt><dd>${slRate(p.rate, d.units)}</dd>
        ${(p.loc || p.md) && html`<dt>Location</dt><dd>${[p.loc, p.md].filter(Boolean).join(' · ')}</dd>`}
        ${p.auth && html`<dt>Work authorization</dt><dd>${p.auth}</dd>`}
        ${(p.open || []).length > 0 && html`<dt>Open questions</dt><dd><ul className="slq">${p.open.map((x, i) => html`<li key=${i}>${x}</li>`)}</ul></dd>`}
        ${it.intv.length > 0 && html`<dt>Interviews</dt><dd><ul className="slq">${it.intv.map((x, i) => html`<li key=${i} className=${'iv-' + x.k}><b>${d.iv[x.k] || x.k}</b>${x.date ? ' · ' + crDay(x.date) : ''}${x.note ? ' · ' + x.note : ''} <span className="muted small">(${x.by}, ${fmtTs(x.at)})</span></li>`)}</ul></dd>`}
        ${it.dec && it.dec.d && it.dec.d !== 'interview' && html`<dt>Decision</dt><dd>${{ interview: 'Interview requested', decline: 'Declined', select: 'Selected' }[it.dec.d]} by ${it.dec.n}, ${fmtTs(it.dec.at)} (v${it.dec.ver})${it.dec.why ? ' · ' + d.why[it.dec.why] : ''}${it.dec.note ? html`<div className="small crpre">${it.dec.note}</div>` : ''}</dd>`}
      </dl>
      ${p.resume && !it.anon && it.ver > 0 && html`<a className="btn ghost sm slres" href=${slFileHref(it.id, it.ver)}><${Icon} n="down" />Resume (${p.resume.n})</a>`}
      ${!staff && live && d.ro && html`<div className="actions slacts"><button type="button" className="btn ghost sm" onClick=${() => onAct('ask')}>Ask a question</button><span className="muted small">Decisions are for hiring managers and full-access people.</span></div>`}
      ${
        !staff &&
        live &&
        !d.ro &&
        html`<div className="actions slacts">
          ${it.st !== 'interview' && html`<button type="button" className="btn sm" onClick=${() => onAct('interview')}>Request an interview</button>`}
          <button type="button" className="btn ghost sm" onClick=${() => onAct('ask')}>Ask a question</button>
          ${it.st === 'hold' ? html`<button type="button" className="btn ghost sm" disabled=${busy} onClick=${() => run('cr_sl_act', { ...body, act: 'resume' }, 'Back on the shortlist.')}>Take off hold</button>` : html`<button type="button" className="btn ghost sm" onClick=${() => onAct('hold')}>Hold</button>`}
          <button type="button" className="btn ghost sm" onClick=${() => onAct('decline')}>Decline…</button>
          <button type="button" className="btn ghost sm" onClick=${() => onAct('select')}>Select…</button>
        </div>`
      }
      ${
        staff &&
        html`<div className="actions slacts">
          ${open && html`<button type="button" className="btn ghost sm" onClick=${onEdit}><${Icon} n="pen" />Edit the packet</button>`}
          ${open && html`<button type="button" className="btn sm" onClick=${() => onAct('share')}>${it.ver ? 'Share a new version…' : 'Share…'}</button>`}
          ${it.ver > 0 && it.anon && open && canName && html`<button type="button" className="btn ghost sm" onClick=${() => onAct('reveal')}>Share the name and resume…</button>`}
          ${live && html`<button type="button" className="btn ghost sm" onClick=${() => onAct('answer')}>${it.st === 'question' ? 'Answer the question' : 'Message the client'}</button>`}
          ${it.ver > 0 && live && html`<button type="button" className="btn ghost sm" onClick=${() => onAct('iv')}>Interview…</button>`}
          ${open && html`<button type="button" className="btn ghost sm" onClick=${() => onAct('withdraw')}>Withdraw</button>`}
        </div>`
      }
      ${act === 'interview' && form('Ask for an interview with ' + it.alias, 'When suits you (days, times, who joins)', 'Ask for the interview', null, () => run('cr_sl_act', { ...body, act: 'interview', msg: f.msg || '' }, 'Interview requested. StratEdge arranges it.'))}
      ${act === 'ask' && form('A question about ' + it.alias, 'Your question', 'Send', null, () => run('cr_sl_act', { ...body, act: 'ask', msg: f.msg || '' }, 'Question sent.'))}
      ${act === 'hold' && form('Hold ' + it.alias, 'Why', 'Hold', null, () => run('cr_sl_act', { ...body, act: 'hold', msg: f.msg || '' }, 'On hold.'))}
      ${act === 'decline' && form('Decline ' + it.alias, 'A note for StratEdge (optional; needed for "Another reason")', 'Decline', html`<${Field} label="The reason"><select value=${f.why || ''} onChange=${e => setF({ ...f, why: e.target.value })}><option value="">Choose…</option>${Object.entries(d.why).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//>`, () => run('cr_sl_act', { ...body, act: 'decline', why: f.why || '', msg: f.msg || '' }, 'Declined.'))}
      ${act === 'select' && form('Select ' + it.alias, 'A note (optional): the start date you have in mind, next steps', 'Select', html`<p className="small" style=${{ margin: 0 }}>StratEdge then prepares the offer and the start with you.</p>`, () => run('cr_sl_act', { ...body, act: 'select', msg: f.msg || '' }, 'Selected. StratEdge will be in touch about the offer and the start.'))}
      ${act === 'share' && form(it.ver ? 'Share version ' + (it.ver + 1) : 'Share ' + it.alias, 'A note for the client (optional)', 'Share', html`<div className="seg">${[['anon', 'Anonymized preview'], ['named', 'With the name and resume']].map(([k, n]) => html`<button key=${k} type="button" disabled=${(k === 'anon' && it.ver > 0 && !it.anon) || (k === 'named' && !canName)} className=${mode === k ? 'on' : ''} onClick=${() => setF({ ...f, mode: k })}>${n}</button>`)}</div><p className="small muted" style=${{ margin: 0 }}>A preview shows no name, resume or contact details. The name and resume need a submission to this requirement that was sent on the bench desk${canName ? '' : ' (not yet for this candidate)'}. Contact details are never shown.</p>`, () => run('cr_sl_act', { ...body, act: 'share', anon: mode === 'anon' ? 1 : 0, msg: f.msg || '' }, 'Shared with the client.'))}
      ${act === 'reveal' && form('Share the name and resume of ' + it.alias, 'A note for the client (optional)', 'Share them', null, () => run('cr_sl_act', { ...body, act: 'reveal', msg: f.msg || '' }, 'Name and resume shared.'))}
      ${act === 'answer' && form(it.st === 'question' ? 'Answer about ' + it.alias : 'A message about ' + it.alias, 'Message', 'Send', null, () => run('cr_sl_act', { ...body, act: 'answer', msg: f.msg || '' }, 'Sent.'))}
      ${act === 'iv' && form('Interview with ' + it.alias, 'A note (optional)', 'Save', html`<div className="row2"><${Field} label="What happened"><select value=${f.k || 'scheduled'} onChange=${e => setF({ ...f, k: e.target.value })}>${['scheduled', 'completed', 'cancelled'].map(k => html`<option key=${k} value=${k}>${d.iv[k]}</option>`)}</select><//><${Field} label="Date"><input type="date" value=${f.date || ''} onInput=${e => setF({ ...f, date: e.target.value })} /><//></div>`, () => run('cr_sl_act', { ...body, act: 'iv', k: f.k || 'scheduled', date: f.date || '', msg: f.msg || '' }, 'Interview recorded.'))}
      ${act === 'withdraw' && form('Withdraw ' + it.alias, it.ver ? 'Why (the client reads it)' : 'Why (optional)', 'Withdraw', null, () => run('cr_sl_act', { ...body, act: 'withdraw', msg: f.msg || '' }, 'Withdrawn from the shortlist.'))}
    </article>`;
}

/* The shared candidates side by side: the same rows for each, the must-have skills first */
function SlCompare({ items, d, staff }) {
  const pk = it => (staff && !it.ver ? it.draft : it.data);
  const needs = [];
  items.forEach(it => (pk(it).match || []).forEach(x => !needs.includes(x.need) && needs.push(x.need)));
  const cell = (it, fn) => html`<td key=${it.id}>${fn(pk(it), it)}</td>`;
  const row = (label, fn, cls) => html`<tr className=${cls || ''}><th scope="row">${label}</th>${items.map(it => cell(it, fn))}</tr>`;
  return html`<div className="tblwrap"><table className="tbl small slcmp">
      <thead><tr><th></th>${items.map(it => html`<th key=${it.id}>${it.alias}${(!it.anon || (staff && !it.ver)) && pk(it).name ? html`<div className="muted">${pk(it).name}</div>` : ''}</th>`)}</tr></thead>
      <tbody>
        ${row('Status', (p, it) => html`<${Chip} s=${SL_TONE[it.st]}>${d.st[it.st] || it.st}<//>`)}
        ${row('Headline', p => p.headline || '—')}
        ${needs.map(n => row(n, p => {
          const x = (p.match || []).find(m => m.need === n);
          return x && x.ev ? html`<div>${x.ev}</div><${Chip} s=${SL_KTONE[x.kind]}>${d.kinds[x.kind]}<//>` : html`<span className="muted">—</span>`;
        }, 'slneed'))}
        ${row('Screened', p => (p.screen && p.screen.date ? crDay(p.screen.date) + (p.screen.by ? ' · ' + p.screen.by : '') : '—'))}
        ${row('Available', (p, it) => html`${[p.avail && p.avail.from ? 'from ' + crDay(p.avail.from) : '', p.avail && p.avail.note].filter(Boolean).join(' · ') || '—'}<div className=${'small ' + ((staff && !it.ver ? it.draftWarn : it.warn) ? 'slwarntxt' : 'muted')}>confirmed ${slAgo(p.avail && p.avail.conf)}</div>`)}
        ${row('Rate', p => slRate(p.rate, d.units))}
        ${row('Location', p => [p.loc, p.md].filter(Boolean).join(' · ') || '—')}
        ${row('Work authorization', p => p.auth || '—')}
        ${row('Open questions', p => ((p.open || []).length ? p.open.join('; ') : '—'))}
        ${row('Interviews', (p, it) => (it.intv.length ? it.intv.map(x => (d.iv[x.k] || x.k) + (x.date ? ' ' + crDay(x.date) : '')).join('; ') : '—'))}
      </tbody>
    </table></div>`;
}

/* StratEdge: the packet editor */
function SlEditor({ it, d, curs, onClose, onSaved }) {
  const toast = useToast();
  const [p, setP] = useState(() => JSON.parse(JSON.stringify(it.draft)));
  const [now, setNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const up = (k, v) => setP({ ...p, [k]: v });
  const sub = (k, i, patch) => setP({ ...p, [k]: p[k].map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('cr_sl_save', { id: it.id, data: { ...p, open: (p.openTxt != null ? p.openTxt.split('\n') : p.open || []).map(x => x.trim()).filter(Boolean) }, availNow: now ? 1 : 0 });
      toast(r.missing ? 'Saved. ' + r.missing : it.ver ? 'Saved. Share a new version when it is ready.' : 'Saved. Share it when it is ready.', !!r.missing);
      onSaved();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const kindSel = (k, i, v) => html`<select value=${v} aria-label="How it is known" onChange=${e => sub(k, i, { kind: e.target.value })}>${Object.entries(d.kinds).map(([kk, n]) => html`<option key=${kk} value=${kk}>${n}</option>`)}</select>`;
  return html`<${Modal} wide title=${'Packet: ' + it.alias} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy} onClick=${save}>Save</button>`}>
      <div className="stack form slform">
        <div className="row2"><${Field} label="Name" hint="Shown to the client only when the name is shared."><input value=${p.name} onInput=${e => up('name', e.target.value)} /><//><${Field} label="Headline"><input value=${p.headline} onInput=${e => up('headline', e.target.value)} placeholder="e.g. SAP PP/QM consultant, 9 years, two S/4HANA rollouts" /><//></div>
        <${Field} label="Summary"><textarea rows="3" value=${p.summary} onInput=${e => up('summary', e.target.value)} placeholder="Why this candidate fits this role, in a few lines" /><//>
        <span className="lbl">The request's must-have skills</span>
        <p className="muted small" style=${{ margin: 0 }}>For each: the evidence, and how it is known: what the candidate says, what StratEdge reviewed (a screening, a technical round, work samples) or what was verified independently (a certificate, a reference).</p>
        <div className="slrows">${p.match.map((x, i) => html`<div key=${i} className="slrow"><input value=${x.need} aria-label=${'Skill ' + (i + 1)} onInput=${e => sub('match', i, { need: e.target.value })} /><input value=${x.ev} aria-label=${'Evidence for skill ' + (i + 1)} placeholder="The evidence" onInput=${e => sub('match', i, { ev: e.target.value })} />${kindSel('match', i, x.kind)}<button type="button" className="btn ghost sm" aria-label=${'Remove skill ' + (i + 1)} onClick=${() => up('match', p.match.filter((y, j) => j !== i))}><${Icon} n="trash" /></button></div>`)}</div>
        <div><button type="button" className="btn ghost sm" onClick=${() => up('match', [...p.match, { need: '', ev: '', kind: 'claim' }])}><${Icon} n="plus" />Add a skill</button></div>
        <span className="lbl">Other evidence</span>
        <div className="slrows">${p.ev.map((x, i) => html`<div key=${i} className="slrow"><input value=${x.t} aria-label=${'Evidence ' + (i + 1)} onInput=${e => sub('ev', i, { t: e.target.value })} /><input value=${x.src} aria-label=${'Source of evidence ' + (i + 1)} placeholder="Source (optional)" onInput=${e => sub('ev', i, { src: e.target.value })} />${kindSel('ev', i, x.kind)}<button type="button" className="btn ghost sm" aria-label=${'Remove evidence ' + (i + 1)} onClick=${() => up('ev', p.ev.filter((y, j) => j !== i))}><${Icon} n="trash" /></button></div>`)}</div>
        <div><button type="button" className="btn ghost sm" onClick=${() => up('ev', [...p.ev, { t: '', kind: 'reviewed', src: '' }])}><${Icon} n="plus" />Add evidence</button></div>
        <span className="lbl">Screening</span>
        <div className="row2"><${Field} label="Screened on"><input type="date" value=${p.screen.date} onInput=${e => up('screen', { ...p.screen, date: e.target.value })} /><//><${Field} label="By"><input value=${p.screen.by} onInput=${e => up('screen', { ...p.screen, by: e.target.value })} /><//></div>
        <${Field} label="Screening notes"><textarea rows="2" value=${p.screen.notes} onInput=${e => up('screen', { ...p.screen, notes: e.target.value })} /><//>
        <${Field} label="Open questions (one per line)"><textarea rows="2" value=${p.openTxt != null ? p.openTxt : (p.open || []).join('\n')} onInput=${e => up('openTxt', e.target.value)} /><//>
        <span className="lbl">Availability, rate and place</span>
        <div className="row2"><${Field} label="Available from"><input type="date" value=${p.avail.from} onInput=${e => up('avail', { ...p.avail, from: e.target.value })} /><//><${Field} label="Availability note"><input value=${p.avail.note} onInput=${e => up('avail', { ...p.avail, note: e.target.value })} placeholder="e.g. two weeks' notice" /><//></div>
        <label className="check"><input type="checkbox" checked=${now} onChange=${e => setNow(e.target.checked)} /><span>Confirmed with the consultant today <span className="muted small">(last confirmed ${slAgo(p.avail.conf)}; older than ${d.availDays} days shows a warning)</span></span></label>
        <div className="row3"><${Field} label="Rate to the client"><input type="number" min="0" step="any" value=${p.rate.amt == null ? '' : p.rate.amt} disabled=${p.rate.unit === 'tbd'} onInput=${e => up('rate', { ...p.rate, amt: e.target.value === '' ? null : e.target.value })} /><//><${Field} label="Per"><select value=${p.rate.unit} onChange=${e => up('rate', { ...p.rate, unit: e.target.value })}>${Object.entries(d.units).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//><${Field} label="Currency"><select value=${p.rate.cur} onChange=${e => up('rate', { ...p.rate, cur: e.target.value })}>${curs.map(c => html`<option key=${c}>${c}</option>`)}</select><//></div>
        <p className="muted small" style=${{ margin: 0 }}>The rate the client pays. The consultant's own pay is never shown to the client.</p>
        <div className="row3"><${Field} label="Location"><input value=${p.loc} onInput=${e => up('loc', e.target.value)} /><//><${Field} label="Work arrangement"><select value=${p.md} onChange=${e => up('md', e.target.value)}><option value="">Not given</option>${['Onsite', 'Hybrid', 'Remote'].map(x => html`<option key=${x}>${x}</option>`)}</select><//><${Field} label="Work authorization"><input value=${p.auth} onInput=${e => up('auth', e.target.value)} /><//></div>
      </div>
    <//>`;
}
