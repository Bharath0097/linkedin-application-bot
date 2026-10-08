/* ================= v45 Immigration cases (in js/work.js, fetched when opened) =================
   HR runs each petition or application as a case: steps with due dates from a template per case type, receipts, the
   attorney, the decision and validity dates, documents and messages. The person sees their cases under USCIS
   compliance › My cases (ImMine). Server: api/imm.php (routes im_*). */
const IM_TONE = { open: 'amber', filed: 'info', rfe: 'red', approved: 'ok', denied: 'red', withdrawn: '', closed: '' };
const IM_DONE_ST = ['approved', 'denied', 'withdrawn', 'closed'];
const imDay = d => (d ? fmtDay(new Date(d + 'T12:00:00').getTime()) : '');
const imToday = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const imSoon = (d, days) => {
  if (!d) return false;
  const t = new Date(d + 'T12:00:00').getTime();
  return t - Date.now() <= days * 86400000;
};
const imCatN = (cats, c) => cats[String(c || '').split(':')[0]] || 'Other';
// the compliance profile fields a case can fill in, as people call them
const IM_VIS_N = { s: 'HR only', a: 'HR and the attorney', p: 'Everyone on the case' };
const IM_GC_N = { eb1: 'EB-1', eb2: 'EB-2', eb3: 'EB-3', ew: 'EB-3 other workers' };
const IM_CTY_N = { row: 'All chargeability', cn: 'China', in: 'India', mx: 'Mexico', ph: 'Philippines' };
const imCut = v => (v === 'C' ? 'Current' : v === 'U' ? 'Unavailable' : imDay(v));
const IM_SYNC_N = { st: 'status', h1bExp: 'H-1B approval until', h1bFirst: 'first day in H-1B', stemStart: 'STEM OPT start', stemEnd: 'STEM OPT end', stem: 'STEM degree', eadExp: 'EAD until', gc: 'green card stage', pd: 'priority date', i140At: 'I-140 approval', i485At: 'I-485 filing', receipt: 'receipt number', attorney: 'attorney', attorneyEmail: "attorney's email" };

function ImApp({ q, staff }) {
  const [view, setView] = useState((q && q.t) || 'cases');
  return html`<div className="stack impage">
      <${KitTabs} tabs=${[['cases', 'Cases'], ['queue', 'Green card queue'], ['clock', 'H-1B clock'], ['vb', 'Visa Bulletin'], ['report', 'Reports']]} tab=${view} onTab=${setView} />
      ${view === 'cases' && html`<${ImCases} q=${q} />`}
      ${view === 'queue' && html`<${ImQueue} onOpen=${() => setView('cases')} />`}
      ${view === 'clock' && html`<${ImClock} />`}
      ${view === 'vb' && html`<${ImVb} />`}
      ${view === 'report' && html`<${ImReport} />`}
    </div>`;
}
function ImCases({ q }) {
  const [meta, setMeta] = useState(null);
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [f, setF] = useState('open');
  const [qq, setQq] = useState('');
  const [open, setOpen] = useState((q && q.c) || '');
  const [neu, setNeu] = useState(false);
  const [tick, setTick] = useState(0);
  const load = () =>
    Promise.all([meta ? Promise.resolve(meta) : api('im_types'), api('im_list')])
      .then(([m, l]) => {
        setMeta(m);
        setD(l);
      })
      .catch(setErr);
  useEffect(() => {
    load();
  }, [tick]);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d || !meta) return html`<${Spinner} label="Loading immigration cases…" />`;
  const reload = () => setTick(t => t + 1);
  const live = d.cases.filter(c => !IM_DONE_ST.includes(c.st));
  const attn = live.filter(c => c.late > 0 || (c.next && imSoon(c.next.due, 14)));
  const pool = f === 'open' ? live : f === 'attn' ? attn : f === 'done' ? d.cases.filter(c => IM_DONE_ST.includes(c.st)) : d.cases;
  const rows = pool.filter(c => !qq || (c.n + ' ' + c.num + ' ' + c.typeN + ' ' + c.title).toLowerCase().includes(qq.toLowerCase()));
  return html`<div className="stack">
      <${KitStats} items=${[{ v: live.length, l: 'Open cases' }, { v: live.reduce((t, c) => t + c.late, 0), l: 'Overdue steps', tone: live.some(c => c.late) ? 'red' : '' }, { v: attn.length, l: 'Need attention in 14 days', tone: attn.length ? 'amber' : '' }, { v: live.filter(c => c.st === 'rfe').length, l: 'Requests for evidence' }]} />
      <div className="toolbar">
        <div className="seg">${[['open', 'Open'], ['attn', 'Needs attention'], ['done', 'Decided & closed'], ['all', 'All']].map(([k, n]) => html`<button key=${k} type="button" className=${f === k ? 'on' : ''} onClick=${() => setF(k)}>${n}</button>`)}</div>
        <input type="search" placeholder="Find a person or case" value=${qq} onInput=${e => setQq(e.target.value)} aria-label="Find a person or case" />
        <button className="btn" style=${{ marginLeft: 'auto' }} onClick=${() => setNeu(true)}><${Icon} n="plus" />New case</button>
      </div>
      ${
        rows.length
          ? html`<div className="tblwrap"><table className="tbl small"><thead><tr><th>Case</th><th>Person</th><th>Status</th><th>Next step</th><th>Attorney</th></tr></thead><tbody>${rows.map(
              c => html`<tr key=${c.id} className="imrow" onClick=${() => setOpen(c.id)}><td><b>${c.num}</b> ${c.typeN}${c.title ? html`<div className="muted">${c.title}</div>` : null}</td><td>${c.n}</td><td><${Chip} s=${IM_TONE[c.st]}>${meta.st[c.st]}<//></td><td>${c.next ? html`<div>${c.next.t}</div><div className=${c.late ? 'imlate' : 'muted'}>${c.next.due ? (c.late ? c.late + ' overdue · ' : '') + 'due ' + imDay(c.next.due) : 'no date'}</div>` : html`<span className="muted">–</span>`}</td><td>${c.atty && c.atty.n ? html`${c.atty.n}${c.atty.firm ? html`<div className="muted">${c.atty.firm}</div>` : null}` : html`<span className="muted">–</span>`}</td></tr>`
            )}</tbody></table></div>`
          : html`<${Empty} title=${d.cases.length ? 'No cases in this view' : 'No immigration cases yet'}>${d.cases.length ? 'Try another filter.' : 'Open a case for each petition or application (H-1B, STEM OPT, PERM, I-140, I-485, EAD renewals): its steps and due dates come from the case type, the person sees it in their portal, and the scheduled job reminds whoever has a step due.'}<//>`
      }
      <p className="muted small" style=${{ margin: 0 }}>The step templates follow USCIS, DOL and SEVP rules as of October 2026 and are a checklist to adapt per case, not legal advice. The person's own deadlines are in their compliance profile; approved dates can be copied there from the case.</p>
      ${neu && html`<${ImNew} meta=${meta} onClose=${() => setNeu(false)} onSaved=${c => (setNeu(false), reload(), setOpen(c.id))} />`}
      ${open && html`<${ImCase} id=${open} meta=${meta} onClose=${() => setOpen('')} onChanged=${reload} />`}
    </div>`;
}

function ImNew({ meta, onClose, onSaved }) {
  const toast = useToast();
  const [people, setPeople] = useState(null);
  const [f, setF] = useState({ type: 'h1bxfer', uid: '', base: '', title: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('im_people')
      .then(r => setPeople(r.people))
      .catch(() => setPeople([]));
  }, []);
  const T = meta.types.find(t => t.k === f.type) || meta.types[0];
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('im_save', f);
      toast('Case ' + r.case.num + ' opened. ' + r.case.n + ' can follow it in their portal.');
      onSaved(r.case);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} title="New immigration case" onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy || !f.uid} onClick=${save}>${busy ? 'Opening…' : 'Open the case'}</button>`}>
      <div className="stack form">
        <${Field} label="Kind of case"><select value=${f.type} onChange=${e => setF({ ...f, type: e.target.value })}>${meta.types.map(t => html`<option key=${t.k} value=${t.k}>${t.n}</option>`)}</select><//>
        <p className="muted small" style=${{ margin: 0 }}>${T.hint}${T.steps.length ? ' ' + T.steps.length + ' steps are added with due dates counted from the date below.' : ''}</p>
        <${Field} label="For"><select value=${f.uid} onChange=${e => setF({ ...f, uid: e.target.value })}><option value="">Choose a person</option>${(people || []).map(p => html`<option key=${p.id} value=${p.id}>${p.n} (${p.e})</option>`)}</select><//>
        <${Field} label=${T.base}><input type="date" value=${f.base} onInput=${e => setF({ ...f, base: e.target.value })} /><//>
        <${Field} label="Title (optional)"><input value=${f.title} onInput=${e => setF({ ...f, title: e.target.value })} placeholder="e.g. Transfer for the Acme project" /><//>
      </div>
    <//>`;
}

/* One case for HR: steps, documents, messages, details, history. */
function ImCase({ id, meta, onClose, onChanged }) {
  const toast = useToast();
  const [c, setC] = useState(null);
  const [tab, setTab] = useState('steps');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    api('im_get', { id })
      .then(r => setC(r.case))
      .catch(e => {
        toast(errText(e), true);
        onClose();
      });
  }, [id]);
  if (!c) return html`<${Modal} wide title="Immigration case" onClose=${onClose}><${Spinner} /><//>`;
  const call = async (route, body, msg) => {
    setBusy(route);
    try {
      const r = await api(route, { id: c.id, ...body });
      if (r.case) setC(r.case);
      if (msg) toast(msg);
      onChanged();
      return r;
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy('');
    }
  };
  const done = c.steps.filter(s => s.done).length;
  const openReqs = c.reqs.filter(q => q.st === 'open').length;
  return html`<${Modal} wide title=${c.num + ' · ' + c.typeN} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Close</button>`}>
      <div className="stack imcase">
        <div className="actions"><${Chip} s=${IM_TONE[c.st]}>${meta.st[c.st]}<//><span className="small"><b>${c.n}</b>${c.title ? ' · ' + c.title : ''} · ${c.baseN}: ${imDay(c.base) || 'not set'}${c.ownerN ? ' · owner ' + c.ownerN : ''}</span>
          <select style=${{ marginLeft: 'auto', maxWidth: 220 }} value=${c.st} aria-label="Status" onChange=${e => call('im_save', { st: e.target.value }, 'Status saved.')}>${Object.entries(meta.st).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select></div>
        <div className="imbar"><span style=${{ width: (c.steps.length ? Math.round((done / c.steps.length) * 100) : 0) + '%' }}></span></div>
        ${c.gcSt && c.gcSt.set && html`<${ImGcBanner} g=${c.gcSt} />`}
        <${KitTabs} tab=${tab} onTab=${setTab} wrap tabs=${[['steps', 'Steps', c.late || null], ['docs', 'Documents', openReqs || null], ['msgs', 'Messages', c.msgs.length || null], ...(c.paf ? [['paf', 'Public access file', c.paf.core.filter(k => !c.paf.items[k]).length || null]] : []), ['details', 'Details'], ['atty', 'Attorney access', c.grants.filter(g => g.live).length || null], ['log', 'History']]} />
        ${tab === 'steps' && html`<${ImSteps} c=${c} meta=${meta} staff call=${call} busy=${busy} />`}
        ${tab === 'docs' && html`<${ImDocs} c=${c} meta=${meta} staff call=${call} setC=${setC} onChanged=${onChanged} />`}
        ${tab === 'msgs' && html`<${ImMsgs} c=${c} staff call=${call} />`}
        ${tab === 'details' && html`<${ImDetails} c=${c} meta=${meta} call=${call} onDeleted=${() => (onChanged(), onClose())} />`}
        ${tab === 'paf' && c.paf && html`<${ImPaf} c=${c} call=${call} />`}
        ${tab === 'atty' && html`<${ImAttyAccess} c=${c} call=${call} />`}
        ${tab === 'log' && html`<ul className="list small">${c.log.map((x, i) => html`<li key=${i}><div><div className="t">${x.ev}</div><div className="m">${x.who} · ${fmtTs(x.t)}</div></div></li>`)}</ul>`}
      </div>
    <//>`;
}

function ImSteps({ c, meta, staff, call, busy }) {
  const [add, setAdd] = useState({ t: '', who: 'hr', due: '' });
  const today = imToday();
  return html`<div className="stack">
      <p className="muted small" style=${{ margin: 0 }}>${c.hint}</p>
      <div className="imsteps">${c.steps.map(s => {
        const mine = !staff && s.who === 'person';
        const late = !s.done && s.due && s.due < today;
        return html`<div key=${s.id} className=${'imstep' + (s.done ? ' done' : '') + (late ? ' late' : '')}>
          <input type="checkbox" checked=${!!s.done} disabled=${!staff && !mine} onChange=${e => call('im_step', { step: s.id, done: e.target.checked }, e.target.checked ? 'Step done.' : 'Step reopened.')} aria-label=${'Done: ' + s.t} />
          <div className="imstepbody">
            <div><b>${s.t}</b> <${Chip} s=${s.who === 'person' ? 'info' : s.who === 'atty' ? '' : 'ok'}>${meta.who[s.who] || s.who}<//>${late ? html` <${Chip} s="red">overdue<//>` : null}</div>
            <div className="muted small">${s.done ? 'Done' + (s.by ? ' by ' + s.by : '') + ' · ' + fmtTs(s.done) : s.due ? 'Due ' + imDay(s.due) : 'No date'}</div>
            ${staff && s.note ? html`<div className="small">${s.note}</div>` : null}
          </div>
          ${staff && html`<div className="imstepedit"><input type="date" value=${s.due || ''} aria-label=${'Due date: ' + s.t} onChange=${e => call('im_step', { step: s.id, due: e.target.value })} /><button type="button" className="btn ghost sm" aria-label=${'Note: ' + s.t} onClick=${() => {
            const n = prompt('Note for this step', s.note || '');
            if (n !== null) call('im_step', { step: s.id, note: n });
          }}><${Icon} n="pen" /></button><button type="button" className="btn ghost sm" aria-label=${'Remove: ' + s.t} onClick=${() => confirm('Remove this step?') && call('im_step', { step: s.id, remove: true }, 'Step removed.')}><${Icon} n="trash" /></button></div>`}
        </div>`;
      })}</div>
      ${
        staff &&
        html`<div className="actions imadd"><input value=${add.t} onInput=${e => setAdd({ ...add, t: e.target.value })} placeholder="Add a step" aria-label="New step" style=${{ flex: '1 1 220px', minWidth: 0 }} /><select value=${add.who} onChange=${e => setAdd({ ...add, who: e.target.value })} aria-label="Whose step">${Object.entries(meta.who).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><input type="date" value=${add.due} onInput=${e => setAdd({ ...add, due: e.target.value })} aria-label="Due" /><button className="btn ghost" disabled=${!add.t.trim() || !!busy} onClick=${() => call('im_step', { add: true, ...add }, 'Step added.').then(r => r && setAdd({ t: '', who: 'hr', due: '' }))}>Add</button></div>`
      }
    </div>`;
}

function ImDocs({ c, meta, staff, call, setC, onChanged }) {
  const toast = useToast();
  const [rq, setRq] = useState({ n: '', cat: 'passport', due: '' });
  const [up, setUp] = useState({ cat: 'other', vis: 's' });
  const [prog, setProg] = useState(0);
  const send = async (file, extra) => {
    setProg(0.05);
    try {
      const fd = new FormData();
      fd.append('id', c.id);
      Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
      fd.append('file', file, file.name);
      await upload('im_upload', fd, setProg);
      const r = await api(staff ? 'im_get' : 'im_mine', staff ? { id: c.id } : undefined);
      setC(staff ? r.case : r.cases.find(x => x.id === c.id));
      toast('Document added.');
      onChanged && onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setProg(0);
  };
  const fileOf = q => c.files.find(f => f.id === q.fid);
  return html`<div className="stack">
      <section className="stack"><b>${staff ? 'Documents asked of ' + c.n : 'Documents HR needs from you'}</b>
        ${c.reqs.length ? html`<div className="imreqs">${c.reqs.map(q => {
          const f = fileOf(q);
          return html`<div key=${q.id} className="imreq"><div><b>${q.n}</b> <span className="muted small">${imCatN(meta.cats, q.cat)}${q.due ? ' · by ' + imDay(q.due) : ''}</span></div>
            <div className="actions">${q.st === 'received' ? html`<${Chip} s="ok">received<//>${f ? html`<a className="small" href=${fileUrl('im/' + c.id, f.id, false, c.tok)} target="_blank" rel="noopener">${f.n}</a>` : null}` : q.st === 'closed' ? html`<${Chip}>closed<//>` : html`<${Chip} s="amber">waiting<//>`}
              ${!staff && q.st === 'open' && html`<label className="btn sm imup">Upload<input type="file" onChange=${e => e.target.files[0] && send(e.target.files[0], { cat: q.cat, req: q.id })} /></label>`}
              ${staff && q.st !== 'closed' && html`<button type="button" className="btn ghost sm" onClick=${() => call('im_req', { close: true, req: q.id }, 'Request closed.')}>Close</button>`}</div></div>`;
        })}</div>` : html`<p className="muted small" style=${{ margin: 0 }}>${staff ? 'Nothing asked yet.' : 'Nothing is needed from you right now.'}</p>`}
        ${staff && html`<div className="actions"><input value=${rq.n} onInput=${e => setRq({ ...rq, n: e.target.value })} placeholder="Ask for a document, e.g. Your latest I-94" aria-label="Document to ask for" style=${{ flex: '1 1 240px', minWidth: 0 }} /><select value=${rq.cat} onChange=${e => setRq({ ...rq, cat: e.target.value })} aria-label="Kind of document">${Object.entries(meta.cats).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><input type="date" value=${rq.due} onInput=${e => setRq({ ...rq, due: e.target.value })} aria-label="Needed by" /><button className="btn ghost" disabled=${!rq.n.trim()} onClick=${() => call('im_req', rq, 'Asked; ' + c.n + ' gets an email.').then(r => r && setRq({ n: '', cat: 'passport', due: '' }))}>Ask</button></div>`}
      </section>
      <section className="stack"><b>${staff ? 'Documents on the case' : 'Your documents on this case'}</b>
        ${c.files.length ? html`<div className="tblwrap"><table className="tbl small"><thead><tr><th>Document</th><th>Kind</th><th>Added</th>${staff && html`<th>Who sees it</th><th></th>`}</tr></thead><tbody>${c.files.map(
          f => html`<tr key=${f.id}><td><a href=${fileUrl('im/' + c.id, f.id, false, c.tok)} target="_blank" rel="noopener">${f.n}</a></td><td>${imCatN(meta.cats, f.c)}</td><td className="nw">${fmtDay(f.at)}</td>${staff && html`<td><select value=${f.w || 's'} aria-label=${'Who sees ' + f.n} onChange=${e => call('im_file', { fid: f.id, vis: e.target.value }, 'Saved: ' + IM_VIS_N[e.target.value].toLowerCase() + '.')}>${Object.entries(IM_VIS_N).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select></td><td className="r"><button type="button" className="btn ghost sm" aria-label=${'Delete ' + f.n} onClick=${() => confirm('Delete ' + f.n + '?') && call('im_file', { fid: f.id, delete: true }, 'Document deleted.')}><${Icon} n="trash" /></button></td>`}</tr>`
        )}</tbody></table></div>` : html`<p className="muted small" style=${{ margin: 0 }}>No documents yet.</p>`}
        ${staff && html`<div className="actions"><select value=${up.cat} onChange=${e => setUp({ ...up, cat: e.target.value })} aria-label="Kind of document to add">${Object.entries(meta.cats).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><select value=${up.vis} onChange=${e => setUp({ ...up, vis: e.target.value })} aria-label="Who sees the document to add">${Object.entries(IM_VIS_N).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><label className="btn ghost imup"><${Icon} n="up" />Add a document<input type="file" onChange=${e => e.target.files[0] && send(e.target.files[0], { cat: up.cat, vis: up.vis })} /></label></div>`}
        ${prog > 0 && html`<div className="imbar"><span style=${{ width: Math.round(prog * 100) + '%' }}></span></div>`}
        <p className="muted small" style=${{ margin: 0 }}>Files are encrypted at rest. ${staff ? 'HR only, HR and the attorney (through their link), or everyone on the case including ' + c.n + '; what the person uploads is always visible to them.' : 'Only you and StratEdge HR (and the attorney on your case) can open them.'}</p>
      </section>
    </div>`;
}

function ImMsgs({ c, staff, call }) {
  const [txt, setTxt] = useState('');
  const [vis, setVis] = useState('all');
  return html`<div className="stack">
      ${c.msgs.length ? html`<div className="immsgs">${c.msgs.map((m, i) => html`<div key=${i} className=${'immsg' + (m.staff ? ' hr' : '') + (m.vis === 'staff' ? ' note' : '') + (m.vis === 'atty' ? ' atty' : '')}><div className="small"><b>${m.who}</b> <span className="muted">${fmtTs(m.t)}</span>${m.vis === 'staff' ? html` <${Chip}>HR only<//>` : m.vis === 'atty' ? html` <${Chip} s="info">attorney thread<//>` : null}</div><div style=${{ whiteSpace: 'pre-wrap' }}>${m.txt}</div></div>`)}</div>` : html`<p className="muted small" style=${{ margin: 0 }}>No messages yet.</p>`}
      <textarea rows="3" value=${txt} onInput=${e => setTxt(e.target.value)} placeholder=${staff ? 'Write to ' + c.n + ', or a note for HR' : 'Write to StratEdge HR'} aria-label="Message" />
      <div className="actions">${staff && html`<div className="seg"><button type="button" className=${vis === 'all' ? 'on' : ''} onClick=${() => setVis('all')}>To ${c.n}</button><button type="button" className=${vis === 'atty' ? 'on' : ''} onClick=${() => setVis('atty')}>To the attorney</button><button type="button" className=${vis === 'staff' ? 'on' : ''} onClick=${() => setVis('staff')}>HR note</button></div>`}<button className="btn" disabled=${!txt.trim()} onClick=${() => call('im_msg', { txt, vis }, vis === 'staff' ? 'Note saved.' : 'Sent.').then(r => r && setTxt(''))}>${vis === 'staff' && staff ? 'Save note' : 'Send'}</button></div>
    </div>`;
}

function ImDetails({ c, meta, call, onDeleted }) {
  const toast = useToast();
  const [f, setF] = useState({
    title: c.title,
    base: c.base,
    filed: c.filed,
    pd: c.pd,
    from: c.from,
    to: c.to,
    decAt: c.decAt,
    premium: c.premium,
    rcpts: c.rcpts.map(x => ({ ...x })),
    atty: { n: '', firm: '', e: '', ph: '', ...c.atty },
    lca: { num: '', soc: '', level: '', wage: '', sites: '', ...c.lca },
    notes: c.notes,
    owner: c.owner,
    gc: { cat: '', cty: 'row', ...(c.gc || {}) },
  });
  const [people, setPeople] = useState(null);
  useEffect(() => {
    api('im_people')
      .then(r => setPeople(r.people))
      .catch(() => setPeople([]));
  }, []);
  const h1b = /^h1b/.test(c.type);
  const set = patch => setF({ ...f, ...patch });
  const save = () => call('im_save', f, 'Case saved.');
  const sync = async () => {
    const r = await call('im_comp_sync', {}, '');
    if (r && r.set) toast('Copied to ' + c.n + "'s compliance profile: " + Object.keys(r.set).map(k => IM_SYNC_N[k] || k).join(', ') + '.');
  };
  const del = async () => {
    if (!confirm('Delete this case? Only a case opened by mistake can be deleted.')) return;
    const r = await call('im_delete', {}, 'Case deleted.');
    if (r) onDeleted();
  };
  return html`<div className="stack form">
      <div className="row3">
        <${Field} label="Title"><input value=${f.title} onInput=${e => set({ title: e.target.value })} /><//>
        <${Field} label=${c.baseN} hint="Changing it moves the open steps with it"><input type="date" value=${f.base} onInput=${e => set({ base: e.target.value })} /><//>
        <${Field} label="Owner (HR)"><select value=${f.owner} onChange=${e => set({ owner: e.target.value })}><option value="">Everyone in HR</option>${(people || []).filter(p => p.staff).map(p => html`<option key=${p.id} value=${p.id}>${p.n}</option>`)}</select><//>
      </div>
      <div className="row3">
        <${Field} label="Filed on"><input type="date" value=${f.filed} onInput=${e => set({ filed: e.target.value })} /><//>
        <${Field} label="Priority date"><input type="date" value=${f.pd} onInput=${e => set({ pd: e.target.value })} /><//>
        <label className="check" style=${{ alignSelf: 'end' }}><input type="checkbox" checked=${f.premium} onChange=${e => set({ premium: e.target.checked })} /><span>Premium processing</span></label>
      </div>
      ${
        ['perm', 'i140', 'i485'].includes(c.type) &&
        html`<span className="lbl">Green card category (for the Visa Bulletin)</span>
        <div className="row3">
          <${Field} label="Category"><select value=${f.gc.cat} onChange=${e => set({ gc: { ...f.gc, cat: e.target.value } })}><option value="">–</option>${Object.entries(IM_GC_N).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//>
          <${Field} label="Country of chargeability"><select value=${f.gc.cty} onChange=${e => set({ gc: { ...f.gc, cty: e.target.value } })}>${Object.entries(IM_CTY_N).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//>
        </div>`
      }
      <span className="lbl">Receipt numbers</span>
      ${f.rcpts.map((x, i) => html`<div key=${i} className="actions"><input value=${x.form} onInput=${e => set({ rcpts: f.rcpts.map((y, j) => (j === i ? { ...y, form: e.target.value } : y)) })} placeholder="Form, e.g. I-129" aria-label="Form" style=${{ maxWidth: 120 }} /><input value=${x.num} onInput=${e => set({ rcpts: f.rcpts.map((y, j) => (j === i ? { ...y, num: e.target.value } : y)) })} placeholder="EAC2690012345" aria-label="Receipt number" style=${{ flex: '1 1 160px', minWidth: 0 }} /><input type="date" value=${x.at} onInput=${e => set({ rcpts: f.rcpts.map((y, j) => (j === i ? { ...y, at: e.target.value } : y)) })} aria-label="Receipt date" /><button type="button" className="btn ghost sm" aria-label="Remove this receipt" onClick=${() => set({ rcpts: f.rcpts.filter((y, j) => j !== i) })}><${Icon} n="trash" /></button></div>`)}
      <div><button type="button" className="btn ghost sm" onClick=${() => set({ rcpts: [...f.rcpts, { form: '', num: '', at: '' }] })}><${Icon} n="plus" />Add a receipt</button></div>
      <div className="row3">
        <${Field} label="Valid from"><input type="date" value=${f.from} onInput=${e => set({ from: e.target.value })} /><//>
        <${Field} label="Valid until"><input type="date" value=${f.to} onInput=${e => set({ to: e.target.value })} /><//>
        <${Field} label="Decided on"><input type="date" value=${f.decAt} onInput=${e => set({ decAt: e.target.value })} /><//>
      </div>
      <span className="lbl">Attorney</span>
      <div className="row3">
        <${Field} label="Name"><input value=${f.atty.n} onInput=${e => set({ atty: { ...f.atty, n: e.target.value } })} /><//>
        <${Field} label="Firm"><input value=${f.atty.firm} onInput=${e => set({ atty: { ...f.atty, firm: e.target.value } })} /><//>
        <${Field} label="Email"><input type="email" value=${f.atty.e} onInput=${e => set({ atty: { ...f.atty, e: e.target.value } })} /><//>
      </div>
      ${
        h1b &&
        html`<span className="lbl">LCA</span>
        <div className="row3">
          <${Field} label="LCA number"><input value=${f.lca.num} onInput=${e => set({ lca: { ...f.lca, num: e.target.value } })} placeholder="I-200-26xxx-xxxxxx" /><//>
          <${Field} label="SOC code"><input value=${f.lca.soc} onInput=${e => set({ lca: { ...f.lca, soc: e.target.value } })} placeholder="15-1252" /><//>
          <${Field} label="Wage level"><select value=${f.lca.level} onChange=${e => set({ lca: { ...f.lca, level: e.target.value } })}><option value="">–</option>${['I', 'II', 'III', 'IV'].map(l => html`<option key=${l} value=${l}>Level ${l}</option>`)}</select><//>
        </div>
        <div className="row3">
          <${Field} label="Wage on the LCA"><input value=${f.lca.wage} onInput=${e => set({ lca: { ...f.lca, wage: e.target.value } })} placeholder="$98,000 a year" /><//>
          <${Field} label="Worksites"><input value=${f.lca.sites} onInput=${e => set({ lca: { ...f.lca, sites: e.target.value } })} placeholder="Client site, city and state" /><//>
        </div>`
      }
      <${Field} label="Notes (HR only)"><textarea rows="3" value=${f.notes} onInput=${e => set({ notes: e.target.value })} /><//>
      <div className="actions"><button className="btn" onClick=${save}>Save</button><button type="button" className="btn ghost" onClick=${sync}>Copy dates to the compliance profile</button><button type="button" className="btn ghost" onClick=${del} style=${{ marginLeft: 'auto' }}>Delete case</button></div>
      <p className="muted small" style=${{ margin: 0 }}>Copying sets the status, approval or EAD dates, STEM OPT dates or the green card stage in ${c.n}'s compliance profile, so their deadline reminders follow the decision.</p>
    </div>`;
}

/* The person's own cases (USCIS compliance › My cases in the member portal). */
function ImMine() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const load = () =>
    api('im_mine')
      .then(setD)
      .catch(setErr);
  useEffect(() => {
    load();
  }, []);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} />`;
  if (!d.cases.length) return html`<div className="panel"><${Empty} title="No cases yet">When StratEdge HR files a petition or application for you (H-1B, STEM OPT, green card steps, EAD renewals), its steps, the documents HR needs and messages show here.<//></div>`;
  return html`<div className="stack">${d.cases.map(c => html`<${ImMineCase} key=${c.id} c0=${c} meta=${{ st: d.st, who: d.who, cats: d.cats }} onChanged=${load} />`)}</div>`;
}
function ImMineCase({ c0, meta, onChanged }) {
  const toast = useToast();
  const [c, setC] = useState(c0);
  const [tab, setTab] = useState('steps');
  useEffect(() => setC(c0), [c0]);
  const call = async (route, body, msg) => {
    try {
      const r = await api(route, { id: c.id, ...body });
      if (r.case) setC(r.case);
      if (msg) toast(msg);
      return r;
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const openReqs = c.reqs.filter(q => q.st === 'open').length;
  const mySteps = c.steps.filter(s => s.who === 'person' && !s.done).length;
  return html`<section className="panel stack imcase">
      <div className="ph-row"><div><b>${c.typeN}</b> <span className="muted small">${c.num}${c.title ? ' · ' + c.title : ''}</span><div className="muted small">${[c.filed && 'filed ' + imDay(c.filed), c.rcpts.length && 'receipt ' + c.rcpts[c.rcpts.length - 1].num, c.from && c.to && 'valid ' + imDay(c.from) + ' – ' + imDay(c.to), c.atty && c.atty.n && 'attorney ' + c.atty.n + (c.atty.firm ? ', ' + c.atty.firm : '')].filter(Boolean).join(' · ') || 'Being prepared'}</div></div><${Chip} s=${IM_TONE[c.st]}>${meta.st[c.st]}<//></div>
      ${c.gcSt && c.gcSt.set && html`<${ImGcBanner} g=${c.gcSt} mine />`}
      <${KitTabs} tab=${tab} onTab=${setTab} tabs=${[['steps', 'Steps', mySteps || null], ['docs', 'Documents', openReqs || null], ['msgs', 'Messages']]} />
      ${tab === 'steps' && html`<${ImSteps} c=${c} meta=${meta} call=${call} />`}
      ${tab === 'docs' && html`<${ImDocs} c=${c} meta=${meta} call=${call} setC=${setC} onChanged=${onChanged} />`}
      ${tab === 'msgs' && html`<${ImMsgs} c=${c} call=${call} />`}
    </section>`;
}

/* ================= v45.1: the Visa Bulletin, the H-1B clock, the public access file, reports, attorney access ================= */
/* A green card case against this month's Visa Bulletin. */
function ImGcBanner({ g, mine }) {
  const chartN = g.chart === 'filing' ? 'dates for filing' : 'final action dates';
  const far = m => (m === null || m === undefined ? 'not available this month' : m + ' month' + (m === 1 ? '' : 's') + ' to go');
  return html`<div className=${'note ' + (g.canFile ? 'ok' : '')}><span><b>${IM_GC_N[g.cat]} · ${IM_CTY_N[g.cty]} · priority date ${imDay(g.pd)}</b> — ${g.canFile ? (mine ? 'your date is current: the adjustment of status (I-485) can be filed this month' : 'current for filing this month (USCIS uses the ' + chartN + ')') : 'not current yet for filing (' + far(g.chart === 'filing' ? g.dffMonths : g.fadMonths) + ')'}. Final action: ${g.fadOk ? 'current' : far(g.fadMonths)} (cut-off ${imCut(g.fad)}). Bulletin ${g.month}.</span></div>`;
}

function ImQueue() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const load = () =>
    api('im_queue')
      .then(setD)
      .catch(setErr);
  useEffect(() => {
    load();
  }, []);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} />`;
  const ready = d.rows.filter(r => r.set && r.canFile);
  return html`<div className="stack">
      <p className="muted small" style=${{ margin: 0 }}>Green card cases (PERM, I-140, I-485) with a priority date, against the ${d.month} Visa Bulletin. USCIS takes the ${d.chart === 'filing' ? 'dates for filing' : 'final action dates'} chart for employment-based adjustment this month (Visa Bulletin tab).</p>
      <${KitStats} items=${[{ v: d.rows.length, l: 'Green card cases' }, { v: ready.length, l: 'Can file the I-485 now', tone: ready.length ? 'ok' : '' }, { v: d.rows.filter(r => !r.set).length, l: 'Missing category or priority date' }]} />
      ${
        d.rows.length
          ? html`<div className="tblwrap"><table className="tbl small"><thead><tr><th>Case</th><th>Person</th><th>Category</th><th>Priority date</th><th>Filing</th><th>Final action</th></tr></thead><tbody>${d.rows.map(
              r => html`<tr key=${r.id}><td><b>${r.num}</b> ${r.typeN}</td><td>${r.n}</td><td>${r.set ? IM_GC_N[r.cat] + ' · ' + IM_CTY_N[r.cty] : html`<span className="muted">set it under Details</span>`}</td><td className="nw">${r.set ? imDay(r.pd) : '–'}</td><td>${r.set ? (r.dffOk ? html`<${Chip} s="ok">current<//>` : html`<span className="muted">${r.dffMonths === null ? 'unavailable' : r.dffMonths + ' mo'}</span>`) : '–'}</td><td>${r.set ? (r.fadOk ? html`<${Chip} s="ok">current<//>` : html`<span className="muted">${r.fadMonths === null ? 'unavailable' : r.fadMonths + ' mo'}</span>`) : '–'}</td></tr>`
            )}</tbody></table></div>`
          : html`<${Empty} title="No green card cases yet">PERM, I-140 and I-485 cases show here with their priority date against the Visa Bulletin.<//>`
      }
    </div>`;
}

function ImClock() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const load = () =>
    api('im_clock')
      .then(setD)
      .catch(setErr);
  useEffect(() => {
    load();
  }, []);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} />`;
  const PATH = { '3y': ['ok', '3-year extensions (approved I-140)'], '1y': ['info', '1-year extensions (PERM or I-140 filed 365+ days before the limit)'], perm: ['amber', 'PERM in progress: file it soon enough'], none: ['red', 'No green card step yet'] };
  return html`<div className="stack">
      <p className="muted small" style=${{ margin: 0 }}>H-1B time is capped at six years from the first day in H-1B status; days spent outside the U.S. are added back (recaptured). Beyond six years AC21 allows extensions: three years at a time with an approved I-140, one year at a time with a PERM or I-140 filed at least 365 days before the limit. Dates come from each person's compliance profile.</p>
      <${KitStats} items=${[{ v: d.rows.length, l: 'People in H-1B' }, { v: d.rows.filter(r => r.risk).length, l: 'Within 18 months of the limit with no green card step', tone: d.rows.some(r => r.risk) ? 'red' : '' }, { v: d.rows.filter(r => r.path === '3y').length, l: 'With an approved I-140' }]} />
      ${
        d.rows.length
          ? html`<div className="tblwrap"><table className="tbl small"><thead><tr><th>Person</th><th>First day in H-1B</th><th>Days abroad</th><th>Six-year limit</th><th>Green card step</th><th>Beyond six years</th></tr></thead><tbody>${d.rows.map(
              r => html`<tr key=${r.uid} className=${r.risk ? 'imriskrow' : ''}><td><b>${r.n}</b>${r.h1bExp ? html`<div className="muted">approval until ${imDay(r.h1bExp)}</div>` : null}</td><td className="nw">${r.first ? imDay(r.first) : html`<span className="muted">not on file</span>`}</td><td>${r.abroad}</td><td className="nw">${r.limit ? html`${imDay(r.limit)}<div className=${r.daysLeft < 365 ? 'imlate' : 'muted'}>${r.daysLeft < 0 ? 'passed' : r.daysLeft + ' days left'}</div>` : '–'}</td><td>${{ none: 'none', perm: 'PERM', i140: 'I-140', i485: 'I-485' }[r.gc] || r.gc}${r.pdAt ? html`<div className="muted">filed ${imDay(r.pdAt)}</div>` : null}</td><td><${Chip} s=${PATH[r.path][0]}>${PATH[r.path][1]}<//>${r.path === 'none' && r.startBy ? html`<div className="muted">start PERM by ${imDay(r.startBy)}</div>` : null}</td></tr>`
            )}</tbody></table></div>`
          : html`<${Empty} title="Nobody in H-1B on file">People whose compliance profile says H-1B (or has a first day in H-1B) show here. Copying an approved H-1B case's dates fills it in.<//>`
      }
    </div>`;
}

function ImVb() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [f, setF] = useState(null);
  const [err, setErr] = useState(null);
  const load = () =>
    api('im_vb')
      .then(r => {
        setD(r);
        setF({ month: r.vb.month, chart: r.vb.chart, fad: JSON.parse(JSON.stringify(r.vb.fad)), dff: JSON.parse(JSON.stringify(r.vb.dff)) });
      })
      .catch(setErr);
  useEffect(() => {
    load();
  }, []);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d || !f) return html`<${Spinner} />`;
  const save = async () => {
    try {
      await api('im_vb_save', f);
      toast('Visa Bulletin saved: every green card case is measured against it now.');
      load();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const cell = (tbl, cat, cty) => html`<input className="imvbcell" value=${f[tbl][cat][cty]} aria-label=${(tbl === 'fad' ? 'Final action ' : 'Filing ') + IM_GC_N[cat] + ' ' + IM_CTY_N[cty]} onInput=${e => setF({ ...f, [tbl]: { ...f[tbl], [cat]: { ...f[tbl][cat], [cty]: e.target.value.toUpperCase() } } })} />`;
  const table = (tbl, title) => html`<section className="stack"><b>${title}</b><div className="tblwrap"><table className="tbl small imvb"><thead><tr><th>Category</th>${Object.values(d.cty).map(n => html`<th key=${n}>${n}</th>`)}</tr></thead><tbody>${Object.entries(d.cats).map(([cat, n]) => html`<tr key=${cat}><td><b>${n}</b></td>${Object.keys(d.cty).map(cty => html`<td key=${cty}>${cell(tbl, cat, cty)}</td>`)}</tr>`)}</tbody></table></div></section>`;
  return html`<div className="stack form">
      <p className="muted small" style=${{ margin: 0 }}>Copy the employment-based tables from each month's <a href=${d.vb.src} target="_blank" rel="noopener">Visa Bulletin</a> (U.S. Department of State, mid-month for the next month) and USCIS's choice of chart for adjustment of status. A date as YYYY-MM-DD, C for current, U for unavailable. Pre-filled with the October 2026 bulletin; last saved ${d.vb.u ? fmtTs(d.vb.u) : 'never (built-in October 2026 dates)'}.</p>
      <div className="row3">
        <${Field} label="Bulletin month"><input type="month" value=${f.month} onInput=${e => setF({ ...f, month: e.target.value })} /><//>
        <${Field} label="USCIS accepts for employment-based I-485"><select value=${f.chart} onChange=${e => setF({ ...f, chart: e.target.value })}><option value="filing">Dates for filing</option><option value="final">Final action dates</option></select><//>
      </div>
      ${table('fad', 'Final action dates')}
      ${table('dff', 'Dates for filing')}
      <div><button className="btn" onClick=${save}>Save the bulletin</button></div>
      ${
        d.vb.hist && d.vb.hist.length > 0 &&
        html`<details><summary className="small">Earlier months (${d.vb.hist.length})</summary><div className="tblwrap"><table className="tbl small"><thead><tr><th>Month</th><th>EB-2 India final action</th><th>EB-3 India final action</th><th>EB-2 all chargeability</th><th>EB-3 all chargeability</th></tr></thead><tbody>${d.vb.hist.map((h, i) => html`<tr key=${i}><td>${h.month}</td><td>${imCut(h.fad.eb2.in)}</td><td>${imCut(h.fad.eb3.in)}</td><td>${imCut(h.fad.eb2.row)}</td><td>${imCut(h.fad.eb3.row)}</td></tr>`)}</tbody></table></div></details>`
      }
    </div>`;
}

function ImReport() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const load = () =>
    api('im_report')
      .then(setD)
      .catch(setErr);
  useEffect(() => {
    load();
  }, []);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!d) return html`<${Spinner} />`;
  const kinds = Array.from(new Set([...Object.keys(d.toFile), ...Object.keys(d.toDecide)]));
  return html`<div className="stack">
      <${KitStats} items=${[{ v: d.dec.approved, l: 'Approved in ' + d.year, tone: 'ok' }, { v: d.dec.denied, l: 'Denied in ' + d.year, tone: d.dec.denied ? 'red' : '' }, { v: d.dec.rfe, l: 'Requests for evidence in ' + d.year }, { v: d.ending.length, l: 'Approvals ending within 180 days', tone: d.ending.length ? 'amber' : '' }]} />
      <div className="imrep">
        <section className="panel stack"><b>Open cases by kind</b>${Object.keys(d.byType).length ? html`<${ImHBars} rows=${Object.entries(d.byType).map(([l, a]) => ({ l, a }))} />` : html`<p className="muted small">No open cases.</p>`}</section>
        <section className="panel stack"><b>All cases by status</b><ul className="list small">${Object.entries(d.bySt).filter(([, n]) => n).map(([k, n]) => html`<li key=${k}><div><div className="t">${d.st[k]}</div></div><b>${n}</b></li>`)}</ul></section>
      </div>
      ${kinds.length > 0 && html`<section className="panel stack"><b>How long cases take</b><div className="tblwrap"><table className="tbl small"><thead><tr><th>Kind</th><th>Opened → filed</th><th>Filed → decided</th></tr></thead><tbody>${kinds.map(k => html`<tr key=${k}><td>${k}</td><td>${d.toFile[k] ? d.toFile[k].days + ' days (' + d.toFile[k].n + ')' : '–'}</td><td>${d.toDecide[k] ? d.toDecide[k].days + ' days (' + d.toDecide[k].n + ')' : '–'}</td></tr>`)}</tbody></table></div></section>`}
      ${d.ending.length > 0 && html`<section className="panel stack"><b>Approvals ending within 180 days (plan the extension)</b><ul className="list small">${d.ending.map(e => html`<li key=${e.id}><div><div className="t">${e.n} · ${e.typeN}</div><div className="m">${e.num}</div></div><b>${imDay(e.to)}</b></li>`)}</ul></section>`}
      ${Object.keys(d.overdue).length > 0 && html`<section className="panel stack"><b>Overdue steps by owner</b><ul className="list small">${Object.entries(d.overdue).map(([k, n]) => html`<li key=${k}><div><div className="t">${k}</div></div><b>${n}</b></li>`)}</ul></section>`}
    </div>`;
}

/* Horizontal bars with the full label (case kinds are long names) */
function ImHBars({ rows }) {
  const max = Math.max(1, ...rows.map(r => +r.a || 0));
  return html`<div className="imhbars">${rows.map(r => html`<div key=${r.l} className="imhbar"><span className="l">${r.l}</span><span className="b"><i style=${{ width: Math.round(((+r.a || 0) / max) * 100) + '%' }} /></span><b>${r.a}</b></div>`)}</div>`;
}

/* The LCA public access file of an H-1B case (20 CFR 655.760): the date each record went in. */
function ImPaf({ c, call }) {
  const [f, setF] = useState({ items: { ...c.paf.items }, note: c.paf.note });
  const core = c.paf.core.filter(k => f.items[k]).length;
  return html`<div className="stack form">
      <p className="muted small" style=${{ margin: 0 }}>The public access file must be ready within one working day after the LCA is filed and kept for one year after the last H-1B worker under the LCA leaves (or one year after the LCA ends if nobody was employed). Add each record's date as it goes in; put the documents under Documents with the kind "Public access file".</p>
      <div className=${'note ' + (core === c.paf.core.length ? 'ok' : 'amber')}><span>${core} of ${c.paf.core.length} required records in${c.lca && c.lca.num ? ' · LCA ' + c.lca.num : ''}.</span></div>
      ${Object.entries(c.paf.list).map(([k, n]) => html`<div key=${k} className="impafrow"><span className=${c.paf.core.includes(k) ? '' : 'muted'}>${n}</span><input type="date" value=${f.items[k] || ''} aria-label=${'In the file on: ' + n} onInput=${e => setF({ ...f, items: { ...f.items, [k]: e.target.value } })} /></div>`)}
      <${Field} label="Notes (where the file is kept, who keeps it)"><input value=${f.note} onInput=${e => setF({ ...f, note: e.target.value })} /><//>
      <div><button className="btn" onClick=${() => call('im_paf_save', f, 'Public access file saved.')}>Save</button></div>
    </div>`;
}

/* HR: the attorney's secure links for this case. */
function ImAttyAccess({ c, call }) {
  const [email, setEmail] = useState((c.atty && c.atty.e) || '');
  const [days, setDays] = useState(30);
  return html`<div className="stack form">
      <p className="muted small" style=${{ margin: 0 }}>Send the case's attorney a secure link instead of email attachments. Each visit asks for a one-time code sent to that address. Through it the attorney sees the steps and receipts, the documents you mark "HR and the attorney" or "Everyone on the case", and the attorney thread; ticks the attorney's steps, adds receipts, uploads documents and writes to you. Everything they do is in the history.</p>
      <div className="row3">
        <${Field} label="Attorney's email"><input type="email" value=${email} onInput=${e => setEmail(e.target.value)} /><//>
        <${Field} label="Open for (days)"><input type="number" min="1" max="90" value=${days} onInput=${e => setDays(e.target.value)} /><//>
        <div style=${{ alignSelf: 'end' }}><button className="btn" disabled=${!email} onClick=${() => call('im_atty_grant', { email, days }, 'Link sent to ' + email + '.')}><${Icon} n="send" />Send a secure link</button></div>
      </div>
      ${
        c.grants.length
          ? html`<div className="tblwrap"><table className="tbl small"><thead><tr><th>Attorney</th><th>Sent</th><th>Open until</th><th>Last visit</th><th></th></tr></thead><tbody>${c.grants
              .slice()
              .reverse()
              .map(g => html`<tr key=${g.id}><td>${g.email}</td><td className="nw">${fmtTs(g.at)}</td><td className="nw">${g.rev ? html`<${Chip}>closed<//>` : g.live ? fmtDay(g.exp) : html`<${Chip}>expired<//>`}</td><td className="nw">${g.used ? fmtTs(g.used) : '–'}</td><td className="r">${g.live && html`<button type="button" className="btn ghost sm" onClick=${() => confirm('Close this link? The attorney can no longer open the case with it.') && call('im_atty_revoke', { grant: g.id }, 'Link closed.')}>Close the link</button>`}</td></tr>`)}</tbody></table></div>`
          : html`<p className="muted small" style=${{ margin: 0 }}>No links sent yet.</p>`
      }
    </div>`;
}

/* The attorney's page (#/atty?t=…): a code emailed each visit, then the case. */
function ImAtty({ q }) {
  const toast = useToast();
  const t = (q && q.t) || '';
  const [st, setSt] = useState('start');
  const [info, setInfo] = useState(null);
  const [code, setCode] = useState('');
  const [c, setC] = useState(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('steps');
  const [txt, setTxt] = useState('');
  const [rc, setRc] = useState({ form: '', num: '', at: '' });
  const [cat, setCat] = useState('rfe');
  useEffect(() => {
    api('imx_case', { t })
      .then(r => (setC(r.case), setSt('case')))
      .catch(e => (e.code === 'code_needed' ? setSt('start') : (setErr(errText(e)), setSt('err'))));
  }, []);
  const call = async (route, body, msg) => {
    try {
      const r = await api(route, { t, ...body });
      if (r.case) setC(r.case);
      if (msg) toast(msg);
      return r;
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const sendCode = async () => {
    try {
      setInfo(await api('imx_start', { t }));
      setSt('code');
    } catch (e) {
      setErr(errText(e));
      setSt('err');
    }
  };
  const verify = async () => {
    try {
      const r = await api('imx_verify', { t, code });
      setC(r.case);
      setSt('case');
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const up = async file => {
    try {
      const fd = new FormData();
      fd.append('t', t);
      fd.append('cat', cat);
      fd.append('file', file, file.name);
      const r = await upload('imx_upload', fd, () => {});
      if (r && r.case) setC(r.case);
      else setC((await api('imx_case', { t })).case);
      toast('Document added.');
    } catch (e) {
      toast(errText(e), true);
    }
  };
  if (st === 'err') return html`<div className="gate"><div className="card"><h1>This link does not open</h1><p className="muted">${err}</p></div></div>`;
  if (st === 'start' || st === 'code')
    return html`<div className="gate"><div className="card stack form">
        <h1>An immigration case shared with you</h1>
        ${
          st === 'start'
            ? html`<p className="muted">StratEdge HR shared a case with you. To open it, we email a one-time code to the address the link was sent to.</p><div><button className="btn" onClick=${sendCode}>Email me a code</button></div>`
            : html`<p className="muted">We sent a 6-digit code to ${info && info.email} for case ${info && info.num}. It works for 10 minutes.</p><${Field} label="Code"><input inputMode="numeric" autoComplete="one-time-code" value=${code} onInput=${e => setCode(e.target.value)} /><//><div className="actions"><button className="btn" disabled=${code.replace(/\D/g, '').length !== 6} onClick=${verify}>Open the case</button><button type="button" className="btn ghost" onClick=${sendCode}>Send another code</button></div>`
        }
      </div></div>`;
  if (!c) return html`<div className="gate"><${Spinner} /></div>`;
  const today = imToday();
  return html`<div className="imatty stack">
      <div className="ph-row"><div><h1 style=${{ margin: 0 }}>${c.num} · ${c.typeN}</h1><div className="muted">${c.n}${c.title ? ' · ' + c.title : ''} · ${c.baseN}: ${imDay(c.base) || 'not set'} · shared with ${c.email} until ${fmtDay(c.exp)}</div></div><${Chip} s=${IM_TONE[c.st]}>${c.st0[c.st]}<//></div>
      ${c.gc && c.gc.set && html`<${ImGcBanner} g=${c.gc} />`}
      <${KitTabs} tab=${tab} onTab=${setTab} tabs=${[['steps', 'Steps'], ['docs', 'Documents', c.files.length || null], ['rcpt', 'Receipts'], ['msgs', 'Messages']]} />
      ${tab === 'steps' && html`<div className="imsteps">${c.steps.map(s => {
        const late = !s.done && s.due && s.due < today;
        return html`<div key=${s.id} className=${'imstep' + (s.done ? ' done' : '') + (late ? ' late' : '')}><input type="checkbox" checked=${!!s.done} disabled=${s.who !== 'atty'} aria-label=${'Done: ' + s.t} onChange=${e => call('imx_step', { step: s.id, done: e.target.checked }, e.target.checked ? 'Step done.' : 'Step reopened.')} /><div className="imstepbody"><div><b>${s.t}</b> <${Chip} s=${s.who === 'atty' ? 'info' : ''}>${c.who[s.who]}<//></div><div className="muted small">${s.done ? 'Done' + (s.by ? ' by ' + s.by : '') : s.due ? 'Due ' + imDay(s.due) : 'No date'}</div></div></div>`;
      })}</div>`}
      ${tab === 'docs' && html`<div className="stack">${c.files.length ? html`<div className="tblwrap"><table className="tbl small"><thead><tr><th>Document</th><th>Kind</th><th>Added</th></tr></thead><tbody>${c.files.map(f => html`<tr key=${f.id}><td><a href=${fileUrl('im/' + c.id, f.id, false, c.tok)} target="_blank" rel="noopener">${f.n}</a></td><td>${imCatN(c.cats, f.c)}</td><td className="nw">${fmtDay(f.at)}</td></tr>`)}</tbody></table></div>` : html`<p className="muted small">No documents shared with you yet.</p>`}<div className="actions"><select value=${cat} onChange=${e => setCat(e.target.value)} aria-label="Kind of document">${Object.entries(c.cats).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><label className="btn ghost imup"><${Icon} n="up" />Upload a document<input type="file" onChange=${e => e.target.files[0] && up(e.target.files[0])} /></label></div><p className="muted small" style=${{ margin: 0 }}>What you upload is seen by StratEdge HR and you.</p></div>`}
      ${tab === 'rcpt' && html`<div className="stack">${c.rcpts.length ? html`<ul className="list small">${c.rcpts.map((x, i) => html`<li key=${i}><div><div className="t">${x.num}</div><div className="m">${x.form}${x.at ? ' · ' + imDay(x.at) : ''}</div></div></li>`)}</ul>` : html`<p className="muted small">No receipts yet.</p>`}<div className="actions"><input value=${rc.form} onInput=${e => setRc({ ...rc, form: e.target.value })} placeholder="Form, e.g. I-129" aria-label="Form" style=${{ maxWidth: 130 }} /><input value=${rc.num} onInput=${e => setRc({ ...rc, num: e.target.value })} placeholder="EAC2690012345" aria-label="Receipt number" style=${{ flex: '1 1 160px', minWidth: 0 }} /><input type="date" value=${rc.at} onInput=${e => setRc({ ...rc, at: e.target.value })} aria-label="Receipt date" /><button className="btn" disabled=${!rc.num.trim()} onClick=${() => call('imx_rcpt', rc, 'Receipt added; HR gets an email.').then(r => r && setRc({ form: '', num: '', at: '' }))}>Add</button></div></div>`}
      ${tab === 'msgs' && html`<div className="stack">${c.msgs.length ? html`<div className="immsgs">${c.msgs.map((m, i) => html`<div key=${i} className=${'immsg' + (m.atty ? ' hr' : '')}><div className="small"><b>${m.who}</b> <span className="muted">${fmtTs(m.t)}</span></div><div style=${{ whiteSpace: 'pre-wrap' }}>${m.txt}</div></div>`)}</div>` : html`<p className="muted small">No messages yet.</p>`}<textarea rows="3" value=${txt} onInput=${e => setTxt(e.target.value)} placeholder="Write to StratEdge HR" aria-label="Message" /><div><button className="btn" disabled=${!txt.trim()} onClick=${() => call('imx_msg', { txt }, 'Sent to HR.').then(r => r && setTxt(''))}>Send</button></div></div>`}
    </div>`;
}
