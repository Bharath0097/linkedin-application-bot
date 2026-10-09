/* ================= v37.3 Updates for HR (Profile page): what HR asked for, and changes a person asks for =================
   api/hrq.php keeps the requests; a person reaches only their own. Every value starts as what is on file; HR sees
   each change next to it and approves it before anything is saved. Documents go to HR first and then into the
   person's Documents, marked verified. */
const HRQ_ST_NAME = { open: 'To fill in', returned: 'Sent back to you', submitted: 'With HR', approved: 'Approved', partial: 'Partly approved', rejected: 'Declined', cancelled: 'Cancelled' };
const hrqTone = st => ({ open: 'amber', returned: 'red', submitted: 'new', approved: 'ok', partial: 'ok', rejected: 'red' }[st] || '');
const hrqSecName = (meta, k) => ((meta.secs || []).find(s => s.k === k) || {}).n || k;
const hrqDocName = (meta, k) => ((meta.docs || []).find(d => d.k === k) || {}).n || k;
const hrqWhatOf = (r, meta) => [...(r.secs || []).map(k => hrqSecName(meta, k)), ...(r.docs || []).map(d => hrqDocName(meta, d.k))].join(', ');
const hrqDay = d => (d ? fmtDate(d, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
function HrqInput({ f, v, set, err }) {
  const common = { value: v || '', 'aria-label': f.n, 'aria-invalid': err ? 'true' : undefined };
  const input =
    f.t === 'select'
      ? html`<select ...${common} onChange=${e => set(e.target.value)}><option value="">Choose…</option>${(f.o || []).map(o => html`<option key=${o} value=${o}>${o}</option>`)}</select>`
      : f.t === 'dob'
        ? html`<input type="date" ...${common} max=${dkey()} onInput=${e => set(e.target.value)} />`
        : f.t === 'year'
          ? html`<input type="number" min="1950" max=${new Date().getFullYear() + 6} ...${common} onInput=${e => set(e.target.value)} />`
          : html`<input type=${f.t === 'email' ? 'email' : f.t === 'tel' ? 'tel' : 'text'} maxLength=${f.max || 120} ...${common} onInput=${e => set(e.target.value)} autoComplete=${{ name: 'name', phone: 'tel', pemail: 'email', addr1: 'address-line1', addr2: 'address-line2', city: 'address-level2', state: 'address-level1', zip: 'postal-code', country: 'country-name' }[f.k] || 'off'} />`;
  return html`<${Field} label=${f.n + (f.req ? ' *' : '')}>${input}${err ? html`<small className="err">${err}</small>` : null}<//>`;
}
function HrqMine({ q }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState(null);
  const [fill, setFill] = useState(null);
  const [asking, setAsking] = useState(false);
  const load = () =>
    api('hrq_mine', {})
      .then(r => setRows(r.rows))
      .catch(() => setRows([]));
  useEffect(() => {
    load();
    api('hrq_meta', {})
      .then(setMeta)
      .catch(() => setMeta(null));
  }, []);
  useEffect(() => {
    if (!(q && q.hrq) || !rows) return;
    const x = rows.find(r => r.id === q.hrq);
    if (x && ['open', 'returned'].includes(x.st)) setFill(x);
  }, [q && q.hrq, !!rows]);
  if (!rows || !meta) return null;
  const active = rows.filter(r => ['open', 'returned', 'submitted'].includes(r.st));
  const done = rows.filter(r => !['open', 'returned', 'submitted'].includes(r.st));
  const cancel = async r => {
    if (!confirm('Cancel this update? Nothing in it is sent to HR.')) return;
    try {
      await api('hrq_cancel', { id: r.id });
      toast('Cancelled.');
      load();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const late = r => r.due && r.due < dkey() && ['open', 'returned'].includes(r.st);
  const row = r => html`<li key=${r.id} className=${'hrqrow' + (r.st === 'returned' ? ' back' : '')}>
      <div>
        <b>${r.origin === 'self' ? 'Your update: ' : 'HR asked for: '}${hrqWhatOf(r, meta)}</b>
        <div className="muted small">${r.origin === 'self' ? 'Started ' + fmtDay(r.at) : 'From ' + (r.byn || 'HR') + ' · ' + fmtDay(r.at)}${r.due ? ' · due ' + hrqDay(r.due) : ''}${late(r) ? html` <span className="late">· past the date</span>` : null}</div>
        ${r.note ? html`<div className="small hrqnote">"${r.note}"</div>` : null}
        ${r.st === 'returned' && r.rev && r.rev.msg ? html`<div className="small hrqback">HR: ${r.rev.msg}</div>` : null}
        ${['approved', 'partial', 'rejected'].includes(r.st) && r.rev && r.rev.msg ? html`<div className="small muted">HR: ${r.rev.msg}</div>` : null}
      </div>
      <div className="actions">
        <${Chip} s=${hrqTone(r.st)}>${HRQ_ST_NAME[r.st] || r.st}<//>
        ${['open', 'returned'].includes(r.st) && html`<button type="button" className="btn sm" onClick=${() => setFill(r)}>${r.st === 'returned' ? 'Make the changes' : 'Fill in'}</button>`}
        ${r.origin === 'self' && ['open', 'returned', 'submitted'].includes(r.st) && html`<button type="button" className="btn ghost sm" onClick=${() => cancel(r)}>Cancel</button>`}
      </div>
    </li>`;
  return html`<section className="panel stack hrqmine">
      <div className="ph-row">
        <h2 className="ph">Updates for HR</h2>
        <button type="button" className="btn ghost sm" onClick=${() => setAsking(true)}><${Icon} n="pen" />Ask HR to change my details</button>
      </div>
      ${
        active.length
          ? html`<ul className="hrqlist">${active.map(row)}</ul>`
          : html`<p className="muted small" style=${{ margin: 0 }}>Nothing waiting. When HR needs your details or documents, it shows here. You can also ask HR to change details only HR can change (address, date of birth, emergency contact, education, work location) or send them a new document.</p>`
      }
      ${done.length > 0 && html`<details className="hrqdone"><summary className="small">Decided in the last 60 days (${done.length})</summary><ul className="hrqlist">${done.map(row)}</ul></details>`}
      ${fill && html`<${HrqFill} r=${fill} meta=${meta} onClose=${() => setFill(null)} onDone=${() => { setFill(null); load(); }} />`}
      ${asking && html`<${HrqAsk} meta=${meta} onClose=${() => setAsking(false)} onMade=${x => { setAsking(false); load(); setFill(x); }} />`}
    </section>`;
}
function HrqAsk({ meta, onClose, onMade }) {
  const toast = useToast();
  const [secs, setSecs] = useState([]);
  const [docs, setDocs] = useState([]);
  const [busy, setBusy] = useState(false);
  const flip = (list, set, k) => set(list.includes(k) ? list.filter(x => x !== k) : [...list, k]);
  const go = async () => {
    setBusy(true);
    try {
      const r = await api('hrq_self', { secs, docs });
      onMade(r.q);
    } catch (e) {
      toast(errText(e), true);
      setBusy(false);
    }
  };
  return html`<${Modal} title="Ask HR to change my details" onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy || (!secs.length && !docs.length)} onClick=${go}>${busy ? 'Starting…' : 'Next: fill it in'}</button>`}>
      <div className="stack">
        <p className="muted small" style=${{ margin: 0 }}>Choose what changed. You fill in the new details on the next step; HR reviews them before they are saved. Your name, work email and phone are changed under Your details on this page.</p>
        <b className="small">Details</b>
        <div className="portalpicks wide">${meta.secs.map(s => html`<label key=${s.k} className=${'pick' + (secs.includes(s.k) ? ' on' : '')}><input type="checkbox" checked=${secs.includes(s.k)} onChange=${() => flip(secs, setSecs, s.k)} /><span>${s.n}</span></label>`)}</div>
        <b className="small">Documents to send</b>
        <div className="portalpicks wide">${meta.docs.map(d => html`<label key=${d.k} className=${'pick' + (docs.includes(d.k) ? ' on' : '')}><input type="checkbox" checked=${docs.includes(d.k)} onChange=${() => flip(docs, setDocs, d.k)} /><span>${d.n}</span></label>`)}</div>
      </div>
    <//>`;
}
function HrqFill({ r, meta, onClose, onDone }) {
  const toast = useToast();
  const cur = r.cur || {};
  const fields = (r.secs || []).flatMap(k => ((meta.secs.find(s => s.k === k) || {}).f || []).map(f => ({ ...f, sec: k })));
  const start = {};
  fields.forEach(f => {
    const was = r.st === 'returned' && r.sub && r.sub.vals && r.sub.vals[f.k] != null ? r.sub.vals[f.k] : cur[f.k];
    start[f.k] = was || (f.k === 'country' ? 'United States' : '');
  });
  const [vals, setVals] = useState(start);
  const [files, setFiles] = useState(r.files || []);
  const [exp, setExp] = useState({});
  const [errs, setErrs] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const set = k => v => setVals(x => ({ ...x, [k]: v }));
  const changed = fields.filter(f => String(vals[f.k] || '') !== String(cur[f.k] || '')).length;
  const attach = async (d, list) => {
    const f = list && list[0];
    if (!f) return;
    if (d.exp && !exp[d.k]) return toast('Add the expiry date first.', true);
    const fd = new FormData();
    fd.append('id', r.id);
    fd.append('k', d.k);
    fd.append('exp', exp[d.k] || '');
    fd.append('file', f, f.name);
    setBusy('up' + d.k);
    try {
      const res = await upload('hrq_upload', fd);
      setFiles(x => [...x, res.file]);
      setErrs(e => ({ ...e, ['doc:' + d.k]: '' }));
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const unattach = async f => {
    try {
      await api('hrq_unfile', { id: r.id, fid: f.id });
      setFiles(x => x.filter(y => y.id !== f.id));
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const send = async () => {
    setBusy('send');
    setErrs({});
    try {
      const res = await api('hrq_submit', { id: r.id, vals, msg });
      toast('Sent to HR' + (res.changes ? ' with ' + plural0(res.changes, 'change') : '') + '. You will hear back here and by email.');
      onDone();
    } catch (e) {
      if (e && e.errs) setErrs(e.errs);
      toast(errText(e), true);
      setBusy('');
    }
  };
  return html`<${Modal} wide title=${r.origin === 'self' ? 'Your update for HR' : 'HR asked you to update your details'} onClose=${onClose} foot=${html`<button type="button" className="btn ghost" onClick=${onClose}>Close</button><button type="button" className="btn" disabled=${!!busy} onClick=${send}>${busy === 'send' ? 'Sending…' : 'Send to HR'}</button>`}>
      <div className="stack hrqfill">
        ${r.note ? html`<div className="note info"><span>From ${r.byn || 'HR'}: "${r.note}"${r.due ? ' · by ' + hrqDay(r.due) : ''}</span></div>` : r.due ? html`<p className="small" style=${{ margin: 0 }}>Due ${hrqDay(r.due)}.</p>` : null}
        ${r.st === 'returned' && r.rev && r.rev.msg ? html`<div className="note warn"><span>HR sent it back: ${r.rev.msg}</span></div>` : null}
        <p className="muted small" style=${{ margin: 0 }}>What is on file is filled in. Change what is out of date and leave the rest; HR sees each change next to the old value before anything is saved.${changed ? ' ' + plural0(changed, 'change') + ' so far.' : ''}</p>
        ${(r.secs || []).map(sk => {
          const s = meta.secs.find(x => x.k === sk);
          if (!s) return null;
          return html`<section key=${sk} className="hrqsec">
            <h3>${s.n}</h3>
            ${sk === 'emergency' && cur._emg && !cur.ecn ? html`<p className="muted small" style=${{ margin: '0 0 6px' }}>On file: ${cur._emg}</p>` : null}
            <div className="form hrqgrid">${s.f.map(f => html`<div key=${f.k} className=${String(vals[f.k] || '') !== String(cur[f.k] || '') ? 'hrqchg' : ''}><${HrqInput} f=${f} v=${vals[f.k]} set=${set(f.k)} err=${errs[f.k]} /></div>`)}</div>
          </section>`;
        })}
        ${(r.docs || []).map(d => {
          const mine = files.filter(f => f.k === d.k);
          return html`<section key=${d.k} className="hrqsec">
            <h3>${hrqDocName(meta, d.k)}</h3>
            ${d.note ? html`<p className="muted small" style=${{ margin: '0 0 6px' }}>${d.note}</p>` : null}
            ${mine.map(f => html`<div key=${f.id} className="hrqfile"><${Icon} n="file" /><span>${f.n}${f.exp ? ' · expires ' + hrqDay(f.exp) : ''}</span><button type="button" className="btn ghost sm" onClick=${() => unattach(f)}>Remove</button></div>`)}
            <div className="actions">
              ${d.exp ? html`<label className="small hrqexp">Expires on <input type="date" value=${exp[d.k] || ''} min=${dkey()} onInput=${e => setExp({ ...exp, [d.k]: e.target.value })} aria-label=${'Expiry date of the ' + hrqDocName(meta, d.k)} /></label>` : null}
              <label className=${'btn ghost sm' + (busy === 'up' + d.k || (d.exp && !exp[d.k]) ? ' disabled' : '')}><${Icon} n="up" />${busy === 'up' + d.k ? 'Attaching…' : mine.length ? 'Attach another' : 'Attach the file'}<input type="file" accept=${ACCEPT} hidden disabled=${!!busy || (d.exp && !exp[d.k])} onChange=${e => { attach(d, e.target.files); e.target.value = ''; }} aria-label=${'Attach the ' + hrqDocName(meta, d.k)} /></label>
            </div>
            ${errs['doc:' + d.k] ? html`<small className="err">${errs['doc:' + d.k]}</small>` : null}
          </section>`;
        })}
        <${Field} label="A note for HR (optional)"><textarea value=${msg} onInput=${e => setMsg(e.target.value)} maxLength="1000" placeholder="e.g. I moved in March; the new EAD came last week" /><//>
      </div>
    <//>`;
}
const plural0 = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
