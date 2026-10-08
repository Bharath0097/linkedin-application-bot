/* ================= v47 Corporate clients: talent requests and proposals (in js/work.js, fetched when opened) =================
   Client portal: Requirements › Talent requests (a structured brief, sent to StratEdge, approved by the company's
   approvers) and Proposals (scoped offers to accept, decline or ask about). StratEdge: Client requests & proposals
   (the queue, each request's actions, proposals and their versions, each company's approvers). Server: api/corp.php. */
const CR_TONE = { draft: '', review: 'info', questions: 'amber', approval: 'amber', returned: 'red', approved: 'ok', active: 'new', hold: '', filled: 'ok', cancelled: '' };
const CR_PTONE = { draft: '', shared: 'info', question: 'amber', accepted: 'ok', declined: 'red', withdrawn: '', expired: '' };
const CR_BLANK = { ti: '', obj: '', must: '', nice: '', resp: '', n: 1, loc: '', md: 'Onsite', sd: '', dur: '', eng: 'contract', bu: 'hour', bmin: '', bmax: '', cur: 'USD', mgr: '', mgre: '', cc: '', unit: '', intv: '', visa: '', ext: '' };
// the requirement's progress on StratEdge's desk, in the client's words
const CR_DESK = { new: 'Starting', open: 'Sourcing', working: 'Sourcing', submitted: 'Profiles sent', interview: 'Interviews', filled: 'Filled', closed: 'Closed', dismissed: 'Closed' };
const crMoney = (cur, v) => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: v % 1 ? 2 : 0 }).format(v);
  } catch (e) {
    return cur + ' ' + v;
  }
};
const crDay = k => fmtDate(k, { month: 'short', day: 'numeric', year: 'numeric' });
const crBudget = (d, home) => {
  if (!d || d.bu === 'tbd') return 'To be discussed';
  const f = v => (v === '' || v == null ? '' : Number(v).toLocaleString());
  const r = d.bmin !== '' && d.bmax !== '' ? f(d.bmin) + '–' + f(d.bmax) : d.bmin !== '' ? 'from ' + f(d.bmin) : 'up to ' + f(d.bmax);
  return d.cur + ' ' + r + ' ' + ((home && home.bu[d.bu]) || d.bu);
};
/* What a brief still needs before it is sent (the server checks the same: api/corp.php crBriefMissing) */
const crMissing = d => {
  const m = [];
  if (!String(d.ti || '').trim()) m.push('the role');
  if (!String(d.must || '').trim()) m.push('the must-have skills');
  if (!String(d.loc || '').trim()) m.push('the location');
  if (!String(d.obj || '').trim()) m.push('the business objective');
  if (d.bu !== 'tbd' && d.bmin === '' && d.bmax === '') m.push('the budget (or "to be discussed")');
  return m;
};
/* Each line's amount and the totals per currency, as the server works them out (api/corp.php crPropTotals) */
function crCalc(lines) {
  const tot = {};
  const apart = [];
  const amounts = (lines || []).map(l => {
    const rate = l.rate === '' || l.rate == null ? NaN : Number(l.rate);
    const qty = l.qty === '' || l.qty == null || !(Number(l.qty) > 0) ? null : Number(l.qty);
    if (!isFinite(rate)) return null;
    if (l.unit === 'pct') {
      apart.push(rate + '% of first-year salary' + (l.d ? ' (' + l.d + ')' : ''));
      return null;
    }
    let amt;
    if (['hour', 'day', 'month'].includes(l.unit)) amt = qty ? Math.round(rate * qty * 100) / 100 : null;
    else amt = Math.round(rate * (qty || 1) * 100) / 100;
    if (amt == null) apart.push(l.cur + ' ' + rate + ' ' + l.unit + (l.d ? ' (' + l.d + ')' : ''));
    else tot[l.cur] = Math.round(((tot[l.cur] || 0) + amt) * 100) / 100;
    return amt;
  });
  return { amounts, tot, apart };
}
const crTotText = tot => Object.entries(tot || {}).map(([c, v]) => crMoney(c, v)).join(' + ') || '—';
const crEsc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/* The proposal as a printable page (print, or save as PDF from the print dialog) */
function crPrint(id, title) {
  const el = document.getElementById(id);
  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w || !el) {
    window.print();
    return;
  }
  w.document.write(
    `<!doctype html><html><head><title>${crEsc(title)}</title><style>body{font:14px/1.5 Arial,sans-serif;color:#111;margin:32px}h2{font-size:22px;margin:0 0 4px}h3{font-size:13px;margin:20px 0 6px;text-transform:uppercase;letter-spacing:.05em;color:#444}ul{margin:0;padding-left:20px}table{width:100%;border-collapse:collapse;margin:6px 0 10px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #ddd;vertical-align:top}.r{text-align:right}.muted{color:#666}.small{font-size:12px}.crdochead{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #222;padding-bottom:10px}.crpre{white-space:pre-wrap}.crtot{margin-top:6px}.nw{white-space:nowrap}</style></head><body>${el.innerHTML}<p class="muted small" style="margin-top:28px">StratEdge IT Consulting Inc. · printed ${crEsc(new Date().toLocaleString())}</p></body></html>`
  );
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}
function useCrHome(cid) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    api('cr_home', cid ? { cid } : {}).then(setD, setErr);
  }, [cid, tick]);
  return [d, err, () => setTick(t => t + 1)];
}

/* ---------- the client portal ---------- */
function CrClientRequests({ q }) {
  const P = usePortal();
  const [home, err, reload] = useCrHome(P.cid);
  const [open, setOpen] = useState((q && q.r) || '');
  const [edit, setEdit] = useState(null);
  const [f, setF] = useState('open');
  if (err && !home) return html`<${LoadError} error=${err} onRetry=${reload} />`;
  if (!home) return html`<${Spinner} label="Loading talent requests…" />`;
  const closed = r => ['filled', 'cancelled'].includes(r.st);
  const rows = home.reqs.filter(r => (f === 'open' ? !closed(r) : f === 'mine' ? r.mine && !closed(r) : closed(r)));
  const waiting = home.reqs.filter(r => r.mine && !closed(r)).length;
  const cfg = home.cfg || { ownerN: '', apprN: [], rule: 'any' };
  const who = cfg.apprN.length ? cfg.apprN.join(cfg.rule === 'all' ? ' and ' : ' or ') : 'someone at ' + (home.co || 'your company');
  return html`<div className="stack crpage">
      ${home.acc && (!home.acc.write || (home.acc.units && home.acc.units.length > 0)) && html`<div className="note info"><span>${home.acc.write ? '' : 'Your role reads talent requests but does not write or change them. '}${home.acc.units && home.acc.units.length ? 'Your access covers ' + (home.acc.units.length === 1 ? 'the ' + home.acc.units[0] + ' business unit' : 'these business units: ' + home.acc.units.join(', ')) + '; requests of other units are not shown.' : ''}${home.acc.deleg ? ' You hold a colleague\'s approvals right now (see People & access).' : ''}</span></div>`}
      <div className="ph-row crintro2"><div className="muted small">Send StratEdge a brief for each role you need. Your account manager${cfg.ownerN ? ' (' + cfg.ownerN + ')' : ''} reviews it, ${who} ${cfg.rule === 'all' && cfg.apprN.length > 1 ? 'approve' : 'approves'} it, and sourcing starts. Each request shows who acts next; every change is kept as a version.</div>${!(home.acc && !home.acc.write) && html`<button className="btn" onClick=${() => setEdit({})}><${Icon} n="plus" />New talent request</button>`}</div>
      <div className="seg">${[['open', 'Open'], ['mine', 'Waiting for me' + (waiting ? ' · ' + waiting : '')], ['closed', 'Filled or closed']].map(([k, n]) => html`<button key=${k} type="button" className=${f === k ? 'on' : ''} onClick=${() => setF(k)}>${n}</button>`)}</div>
      ${rows.length ? html`<${CrReqTable} rows=${rows} home=${home} onOpen=${setOpen} />` : html`<${Empty} title=${f === 'open' ? 'No open talent requests' : 'Nothing here'}>${f === 'open' ? 'Start one with the role, the skills that matter, the budget and the dates. Save it as a draft until it is ready; only you see a draft.' : 'Try another filter.'}<//>`}
      ${open && html`<${CrReqDetail} id=${open} tab0=${q && q.r === open ? q.tab : ''} home=${home} onClose=${() => setOpen('')} onChanged=${reload} onEdit=${r => (setOpen(''), setEdit(r))} />`}
      ${edit && html`<${CrReqEditor} r=${edit.id ? edit : null} cid=${P.cid} home=${home} staff=${!!home.staff} onClose=${() => setEdit(null)} onSaved=${id => (setEdit(null), reload(), setOpen(id))} />`}
    </div>`;
}
function CrReqTable({ rows, home, onOpen, staff }) {
  return html`<div className="tblwrap"><table className="tbl crtbl"><thead><tr><th>Role</th>${staff && html`<th>Company</th>`}<th>Status</th><th>Next</th><th className="r">People</th><th>Updated</th></tr></thead><tbody>${rows.map(
    r => html`<tr key=${r.id} className="click" tabIndex="0" onClick=${() => onOpen(r.id)} onKeyDown=${e => e.key === 'Enter' && onOpen(r.id)}>
        <td><b>${r.ti}</b><div className="muted small">${[r.loc, home.eng[r.eng]].filter(Boolean).join(' · ')}${r.apvVer ? ' · approved v' + r.apvVer : ''}${r.ver > r.apvVer && r.apvVer ? ' · v' + r.ver + ' pending' : ''}</div></td>
        ${staff && html`<td>${r.co}</td>`}
        <td><${Chip} s=${CR_TONE[r.st]}>${home.st[r.st] || r.st}<//></td>
        <td className=${r.mine ? 'crmine' : ''}>${r.next ? (r.mine ? 'You' : r.next) : '—'}</td>
        <td className="r">${r.n}</td>
        <td className="nw small">${fmtTs(r.u)}</td>
      </tr>`
  )}</tbody></table></div>`;
}

function CrReqEditor({ r, cid, home, onClose, onSaved, staff }) {
  const toast = useToast();
  const [d, setD] = useState({ ...CR_BLANK, ...((r && r.data) || {}) });
  const [co, setCo] = useState(cid || '');
  const [sid, setSid] = useState((r && r.id) || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [miss, setMiss] = useState([]);
  const up = k => e => setD({ ...d, [k]: e.target.value });
  const isNew = !r;
  const st = r ? r.st : 'draft';
  const after = r && r.apvVer > 0 && ['approved', 'active', 'hold'].includes(st);
  const canSend = isNew || (staff ? st === 'draft' : ['draft', 'questions', 'returned'].includes(st));
  const go = async send => {
    setBusy(true);
    try {
      const s = await api('cr_req_save', { id: sid, cid: co, data: d, note });
      const id = s.id;
      setSid(id);
      if (send) {
        const m = crMissing(d);
        setMiss(m);
        if (m.length) {
          toast('Saved as a draft. Add ' + m.join(', ') + ' before sending it.', true);
          setBusy(false);
          return;
        }
        await api('cr_req_act', { id, act: staff ? 'confirm' : 'submit' });
      }
      toast(send ? (staff ? 'Sent for approval.' : 'Sent to StratEdge.') : s.reapprove ? 'Saved as version ' + s.ver + ': it needs approval again.' : s.ver ? 'Saved as version ' + s.ver + '.' : 'Saved.');
      onSaved(id);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const need = k => (miss.length && !String(d[k] || '').trim() ? 'crneed' : '');
  return html`<${Modal} wide title=${isNew ? 'New talent request' : 'Change: ' + r.ti} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn ghost" disabled=${busy || !d.ti.trim() || (isNew && !co)} onClick=${() => go(false)}>${st === 'draft' ? 'Save as draft' : 'Save changes'}</button>${canSend && html`<button className="btn" disabled=${busy || !d.ti.trim() || (isNew && !co)} onClick=${() => go(true)}>${staff ? 'Save and send for approval' : st === 'draft' ? 'Send to StratEdge' : 'Save and send back'}</button>`}`}>
      <div className="stack form crform">
        ${staff && isNew && html`<${Field} label="Client company"><select value=${co} onChange=${e => setCo(e.target.value)}><option value="">Choose…</option>${home.cos.map(c => html`<option key=${c.id} value=${c.id}>${c.n}</option>`)}</select><//>`}
        ${staff && isNew && html`<div className="note"><span>Entered for the client: you send it for the company's approval yourself (or record their approval when they gave it by email or on a call).</span></div>`}
        ${after && html`<div className="note amber"><span>This request is approved. A change to ${Object.values(home.ess).join(', ').toLowerCase()} becomes a new version that needs approval again; the approved version stays in force until then. Other changes take effect at once.</span></div>`}
        <span className="lbl">The role</span>
        <div className="row2"><div className=${need('ti')}><${Field} label="Role"><input value=${d.ti} onInput=${up('ti')} placeholder="e.g. Senior SAP PP/QM consultant" /><//></div><${Field} label="Headcount"><input type="number" min="1" max="99" value=${d.n} onInput=${up('n')} /><//></div>
        <div className=${need('obj')}><${Field} label="Business objective" hint="What this hire should achieve: the project, the problem, the deadline that matters."><textarea rows="2" value=${d.obj} onInput=${up('obj')} /><//></div>
        <${Field} label="What the person will do"><textarea rows="3" value=${d.resp} onInput=${up('resp')} placeholder="Responsibilities, the team, tools; paste a job description if you have one" /><//>
        <span className="lbl">Skills</span>
        <div className="row2"><div className=${need('must')}><${Field} label="Must-have skills"><input value=${d.must} onInput=${up('must')} placeholder="e.g. S/4HANA PP, QM, 8+ years" /><//></div><${Field} label="Nice-to-have skills"><input value=${d.nice} onInput=${up('nice')} /><//></div>
        <span className="lbl">Where and when</span>
        <div className="row3"><div className=${need('loc')}><${Field} label="Location"><input value=${d.loc} onInput=${up('loc')} placeholder="City, state" /><//></div><${Field} label="Work arrangement"><select value=${d.md} onChange=${up('md')}>${['Onsite', 'Hybrid', 'Remote'].map(x => html`<option key=${x}>${x}</option>`)}</select><//><${Field} label="Work authorization"><input value=${d.visa} onInput=${up('visa')} placeholder="e.g. US citizens and green card holders" /><//></div>
        <div className="row2"><${Field} label="Target start"><input type="date" value=${d.sd} onInput=${up('sd')} /><//><${Field} label="Duration"><input value=${d.dur} onInput=${up('dur')} placeholder="e.g. 6 months, extendable" /><//></div>
        <span className="lbl">Engagement and budget</span>
        <div className="row3"><${Field} label="Engagement"><select value=${d.eng} onChange=${up('eng')}>${Object.entries(home.eng).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//><${Field} label="Budget"><select value=${d.bu} onChange=${up('bu')}>${Object.entries(home.bu).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//><${Field} label="Currency"><select value=${d.cur} disabled=${d.bu === 'tbd'} onChange=${up('cur')}>${home.curs.map(c => html`<option key=${c}>${c}</option>`)}</select><//></div>
        ${d.bu !== 'tbd' && html`<div className=${'row2' + (miss.length && d.bmin === '' && d.bmax === '' ? ' crneed' : '')}><${Field} label="From"><input type="number" min="0" step="any" value=${d.bmin} onInput=${up('bmin')} /><//><${Field} label="To"><input type="number" min="0" step="any" value=${d.bmax} onInput=${up('bmax')} /><//></div>`}
        <span className="lbl">Who and how</span>
        <div className="row2"><${Field} label="Hiring owner"><input value=${d.mgr} onInput=${up('mgr')} placeholder="The hiring manager" /><//><${Field} label="Hiring owner email"><input type="email" value=${d.mgre} onInput=${up('mgre')} /><//></div>
        <div className="row3"><${Field} label="Cost center"><input value=${d.cc} onInput=${up('cc')} /><//>${!staff && home.acc && home.acc.units && home.acc.units.length ? html`<${Field} label="Business unit" hint="Your access covers these units"><select value=${d.unit} onChange=${up('unit')}><option value="">Choose…</option>${home.acc.units.map(u => html`<option key=${u} value=${u}>${u}</option>`)}</select><//>` : html`<${Field} label="Business unit"><input value=${d.unit} onInput=${up('unit')} list="crunits" /><datalist id="crunits">${(home.unitsKnown || []).map(u => html`<option key=${u} value=${u} />`)}</datalist><//>`}<${Field} label="Your requisition reference"><input value=${d.ext} onInput=${up('ext')} /><//></div>
        <${Field} label="Interview process"><textarea rows="2" value=${d.intv} onInput=${up('intv')} placeholder="Rounds, who interviews, how soon you can meet people" /><//>
        ${!isNew && st !== 'draft' && html`<${Field} label="Why the change (optional)"><input value=${note} onInput=${e => setNote(e.target.value)} /><//>`}
      </div>
    <//>`;
}

/* One talent request: the brief, the conversation, its versions and progress, and the actions the caller may take */
function CrReqDetail({ id, home, onClose, onChanged, onEdit, tab0 }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [tab, setTab] = useState(tab0 || 'brief');
  const [act, setAct] = useState(null);
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  const [cmp, setCmp] = useState(null);
  const load = () =>
    api('cr_req_get', { id }).then(setD, e => {
      toast(errText(e), true);
      onClose();
    });
  useEffect(() => {
    load();
  }, [id]);
  if (!d) return html`<${Modal} wide title="Talent request" onClose=${onClose}><${Spinner} /><//>`;
  const R = d.req;
  const staff = home.staff;
  const can = d.can;
  const run = async (a, extra, msg) => {
    setBusy(true);
    try {
      await api('cr_req_act', { id, act: a, ...(extra || {}) });
      toast(msg);
      setAct(null);
      setF({});
      load();
      onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const form = (title, a, label, ok, extra, msg) => html`<div className="crform2 form">
      <b>${title}</b>
      ${extra}
      <${Field} label=${label}><textarea rows="3" value=${f.msg || ''} onInput=${e => setF({ ...f, msg: e.target.value })} /><//>
      <div className="actions"><button type="button" className="btn ghost sm" onClick=${() => setAct(null)}>Cancel</button><button type="button" className="btn sm" disabled=${busy} onClick=${() => run(a, a === 'close' ? { to: 'filled', ...f } : f, msg)}>${ok}</button></div>
    </div>`;
  const vers = d.vers;
  const last = vers[vers.length - 1];
  const prevApproved = [...vers].reverse().find(v => v.apvAt && last && v.n < last.n);
  const pair = cmp || (prevApproved && last ? [prevApproved.n, last.n] : vers.length > 1 ? [vers[vers.length - 2].n, last.n] : null);
  const vA = pair && vers.find(v => v.n === pair[0]);
  const vB = pair && vers.find(v => v.n === pair[1]);
  const diffs = vA && vB ? Object.entries(home.fields).filter(([k]) => String(vA.data[k] == null ? '' : vA.data[k]) !== String(vB.data[k] == null ? '' : vB.data[k])) : [];
  const ess = Object.fromEntries((d.ess || []).map(k => [k, 1]));
  const msgs = d.evs;
  const show = (k, v) => (v === '' || v == null ? '—' : k === 'eng' ? home.eng[v] || v : k === 'bu' ? home.bu[v] || v : k === 'sd' ? crDay(v) : String(v));
  return html`<${Modal} wide title=${R.ti} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Close</button>${can.edit && html`<button className="btn ghost" onClick=${() => onEdit(R)}><${Icon} n="pen" />${R.st === 'draft' ? 'Edit' : 'Change'}</button>`}${can.submit && html`<button className="btn" disabled=${busy} onClick=${() => run('submit', {}, R.st === 'draft' ? 'Sent to StratEdge.' : 'Sent back to StratEdge.')}>${R.st === 'draft' ? 'Send to StratEdge' : 'Send back'}</button>`}${can.approve && html`<button className="btn" disabled=${busy} onClick=${() => run('approve', {}, 'Approved.')}><${Icon} n="check" />Approve version ${R.ver}</button>`}${can.confirm && html`<button className="btn" disabled=${busy} onClick=${() => run('confirm', {}, 'Sent for approval.')}>Confirm the brief</button>`}${can.start && html`<button className="btn" disabled=${busy} onClick=${() => run('start', {}, 'Sourcing started: the requirement is on the desk.')}><${Icon} n="search" />Start sourcing</button>`}`}>
      <div className="stack crdetail">
        <div className="toolbar" style=${{ gap: 8 }}>
          <${Chip} s=${CR_TONE[R.st]}>${home.st[R.st] || R.st}<//>
          <span className="muted small">${R.co} · version ${R.ver}${R.apvVer ? ' (approved: v' + R.apvVer + ')' : ''} · by ${R.byN}${R.ownerN ? ' · account manager ' + R.ownerN : ''}</span>
          ${R.next && html`<span className=${'small crright' + (R.mine ? ' crmine' : '')}>Next: <b>${R.mine ? 'you' : R.next}</b></span>`}
        </div>
        ${
          (can.ask || can.record || can.hold || can.resume || can.close || can.withdraw || can.approve) &&
          html`<div className="actions crbar">
            ${can.approve && html`<button type="button" className="btn ghost sm" onClick=${() => setAct('return')}>Return with questions</button>`}
            ${can.ask && html`<button type="button" className="btn ghost sm" onClick=${() => setAct('ask')}>Ask questions</button>`}
            ${can.record && html`<button type="button" className="btn ghost sm" onClick=${() => setAct('record')}>Record the client's approval</button>`}
            ${can.hold && html`<button type="button" className="btn ghost sm" onClick=${() => setAct('hold')}>Put on hold</button>`}
            ${can.resume && html`<button type="button" className="btn ghost sm" disabled=${busy} onClick=${() => run('resume', {}, 'Resumed.')}>Resume</button>`}
            ${can.close && html`<button type="button" className="btn ghost sm" onClick=${() => setAct('close')}>Close…</button>`}
            ${can.withdraw && html`<button type="button" className="btn ghost sm" onClick=${() => setAct('withdraw')}>Withdraw</button>`}
          </div>`
        }
        ${act === 'return' && form('Return it for changes', 'return', 'What needs to change', 'Return it', null, 'Returned for changes.')}
        ${act === 'ask' && form('Questions for ' + R.byN, 'ask', 'Your questions', 'Send the questions', null, 'Questions sent.')}
        ${act === 'hold' && form('Put it on hold', 'hold', 'Why', 'Put on hold', null, 'On hold.')}
        ${act === 'withdraw' && form('Withdraw the request', 'withdraw', 'Why (optional)', 'Withdraw it', null, 'Withdrawn.')}
        ${act === 'record' && form("Record the client's approval", 'record', 'The evidence (an email, a call: who, when, what was agreed)', 'Record it', html`<${Field} label="Who approved"><input value=${f.who || ''} onInput=${e => setF({ ...f, who: e.target.value })} /><//>`, 'Approval recorded.')}
        ${act === 'close' && form('Close it', 'close', 'Why', 'Close it', html`<div className="seg">${[['filled', 'Filled'], ['cancelled', 'Cancelled']].map(([k, n]) => html`<button key=${k} type="button" className=${(f.to || 'filled') === k ? 'on' : ''} onClick=${() => setF({ ...f, to: k })}>${n}</button>`)}</div>`, 'Closed.')}
        ${R.st === 'approval' && html`<div className="note"><span>Approvers: ${d.approvers.join(', ') || '—'}${d.named ? '' : ' (no approvers are named, so any contact at ' + R.co + ' may approve)'}${d.approvers.length > 1 ? (d.rule === 'all' ? ' · all must approve' : ' · one approval is enough') : ''}.${R.appr.length ? ' Approved so far: ' + R.appr.map(a => a.n).join(', ') + '.' : ''}</span></div>`}
        <${KitTabs} tabs=${[['brief', 'Brief'], ['talk', 'Conversation', msgs.filter(e => ['msg', 'questions', 'returned', 'note'].includes(e.ev)).length || null], ['vers', 'Versions', vers.length > 1 ? vers.length : null], ...(d.prog ? [['prog', 'Progress']] : []), ...((staff && ['approved', 'active', 'hold', 'filled'].includes(R.st)) || (d.sl && d.sl.n > 0) ? [['short', 'Shortlist', (staff ? d.sl.n : d.sl.wait) || null]] : [])]} tab=${tab} onTab=${setTab} />
        ${tab === 'short' && html`<${CrShortlist} R=${R} home=${home} onChanged=${() => (load(), onChanged())} />`}
        ${
          tab === 'brief' &&
          html`<dl className="kv crkv">${Object.entries(home.fields)
            .filter(([k]) => !['bu', 'bmin', 'bmax', 'cur'].includes(k) && String(R.data[k] == null ? '' : R.data[k]) !== '')
            .map(([k, n]) => html`<${Fragment} key=${k}><dt>${n}</dt><dd>${show(k, R.data[k])}</dd><//>`)}<dt>Budget</dt><dd>${crBudget(R.data, home)}</dd></dl>`
        }
        ${
          tab === 'talk' &&
          html`<div className="stack">
            <div className="crlog">${msgs.map(
              (e, i) => html`<div key=${i} className=${'crev ' + e.side + (e.vis ? '' : ' internal')}><div className="small"><b>${e.byn || 'StratEdge'}</b> <span className="muted">${fmtTs(e.at)}${e.vis ? '' : ' · internal note'}</span></div><div className="crmsg">${e.msg}</div></div>`
            )}</div>
            ${
              R.st !== 'draft' &&
              html`<${Field} label=${staff ? 'Message to ' + R.co : 'Message to StratEdge'}><textarea rows="2" value=${f.chat || ''} onInput=${e => setF({ ...f, chat: e.target.value })} /><//>
                <div className="actions">${staff && html`<button type="button" className="btn ghost sm" disabled=${busy || !(f.chat || '').trim()} onClick=${() => run('note', { msg: f.chat }, 'Note added (StratEdge only).')}>Add as an internal note</button>`}<button type="button" className="btn sm" disabled=${busy || !(f.chat || '').trim()} onClick=${() => run('msg', { msg: f.chat }, 'Message sent.')}>Send</button></div>`
            }
          </div>`
        }
        ${
          tab === 'vers' &&
          html`<div className="stack">
            <div className="tblwrap"><table className="tbl small"><thead><tr><th>Version</th><th>By</th><th>When</th><th>Approved</th><th>Why</th></tr></thead><tbody>${vers.map(v => html`<tr key=${v.n}><td className="nw">v${v.n}${v.n === R.apvVer ? html` <${Chip} s="ok">in force<//>` : ''}</td><td>${v.byn}</td><td className="nw">${fmtTs(v.at)}</td><td>${v.apvAt ? fmtTs(v.apvAt) + ' · ' + v.apvBy : '—'}</td><td>${v.note || ''}</td></tr>`)}</tbody></table></div>
            ${
              vers.length > 1 &&
              html`<div className="toolbar"><span className="small">Compare</span><select value=${pair[0]} aria-label="Compare from" onChange=${e => setCmp([+e.target.value, pair[1]])}>${vers.map(v => html`<option key=${v.n} value=${v.n}>v${v.n}</option>`)}</select><span className="small">with</span><select value=${pair[1]} aria-label="Compare with" onChange=${e => setCmp([pair[0], +e.target.value])}>${vers.map(v => html`<option key=${v.n} value=${v.n}>v${v.n}</option>`)}</select></div>
                ${diffs.length ? html`<div className="tblwrap"><table className="tbl small crdiff"><thead><tr><th>Field</th><th>v${pair[0]}</th><th>v${pair[1]}</th></tr></thead><tbody>${diffs.map(([k, n]) => html`<tr key=${k} className=${ess[k] ? 'ess' : ''}><td>${n}${ess[k] ? html` <${Chip} s="amber">needs approval<//>` : ''}</td><td>${show(k, vA.data[k])}</td><td>${show(k, vB.data[k])}</td></tr>`)}</tbody></table></div>` : html`<p className="muted small">These versions are the same.</p>`}`
            }
          </div>`
        }
        ${tab === 'prog' && d.prog && html`<div className="stack"><${KitStats} items=${[{ v: CR_DESK[d.prog.st] || d.prog.st || '—', l: 'On StratEdge’s desk' }, { v: d.prog.subs, l: 'Profiles sent to you' }, { v: 'v' + (d.prog.cver || R.apvVer), l: 'Version being sourced' }]} />${(d.prog.byVer || []).length > 0 && html`<p className="small crbyver">Profiles sent under each approved version (the one in force when they went out): ${d.prog.byVer.map(x => 'version ' + x.v + ': ' + x.n).join(' · ')}</p>`}${staff && R.vreq && html`<p className="small">Requirement <b>${R.vreq}</b> on the requirements desk.</p>`}</div>`}
      </div>
    <//>`;
}

function CrClientProposals({ q }) {
  const P = usePortal();
  const [home, err, reload] = useCrHome(P.cid);
  const [open, setOpen] = useState((q && q.p) || '');
  if (err && !home) return html`<${LoadError} error=${err} onRetry=${reload} />`;
  if (!home) return html`<${Spinner} label="Loading proposals…" />`;
  const waiting = home.props.filter(p => ['shared', 'question'].includes(p.st)).length;
  return html`<div className="stack crpage">
      <div className="muted small">Proposals from StratEdge for ${home.co || 'your company'}: the service, what is included and what is not, your part, and the prices. Ask a question, accept or decline each one; every version stays here.${waiting ? ' ' + waiting + (waiting === 1 ? ' is' : ' are') + ' waiting for your decision.' : ''}</div>
      ${home.props.length ? html`<${CrPropTable} rows=${home.props} home=${home} onOpen=${setOpen} />` : html`<${Empty} title="No proposals yet">When StratEdge shares a proposal with you, it shows here.<//>`}
      ${open && html`<${CrPropDetail} id=${open} home=${home} onClose=${() => setOpen('')} onChanged=${reload} />`}
    </div>`;
}
function CrPropTable({ rows, home, onOpen, staff }) {
  return html`<div className="tblwrap"><table className="tbl crtbl"><thead><tr><th>Proposal</th>${staff && html`<th>Company</th>`}<th>Status</th><th>Version</th><th>Valid until</th><th className="r">Total</th>${staff && html`<th>Opened</th>`}</tr></thead><tbody>${rows.map(
    p => html`<tr key=${p.id} className="click" tabIndex="0" onClick=${() => onOpen(p.id)} onKeyDown=${e => e.key === 'Enter' && onOpen(p.id)}>
        <td><b>${p.ti}</b><div className="muted small">${home.models[p.model] || ''}${staff && p.unshared ? ' · unshared changes' : ''}</div></td>
        ${staff && html`<td>${p.co}</td>`}
        <td><${Chip} s=${CR_PTONE[p.st]}>${home.pst[p.st] || p.st}<//></td>
        <td>${p.ver ? 'v' + p.ver : '—'}</td>
        <td className="nw">${p.valid ? crDay(p.valid) : '—'}</td>
        <td className="r nw">${crTotText(p.tot)}</td>
        ${staff && html`<td className="nw small">${p.viewed ? fmtTs(p.viewed) : '—'}</td>`}
      </tr>`
  )}</tbody></table></div>`;
}

/* A proposal as the client reads it (and StratEdge previews it) */
function CrPropDoc({ data, calc, home, prop, v, domId }) {
  const list = (t, a) => (a && a.length ? html`<section><h3>${t}</h3><ul>${a.map((x, i) => html`<li key=${i}>${x}</li>`)}</ul></section>` : null);
  return html`<div className="crdoc" id=${domId}>
      <div className="crdochead"><div><h2>${prop.ti}</h2><div className="muted">${prop.co} · ${home.models[data.model] || ''} · version ${v}</div></div><div className="small r">${data.valid ? 'Valid until ' + crDay(data.valid) : ''}${data.start ? html`<div>Proposed start ${crDay(data.start)}</div>` : ''}</div></div>
      ${data.intro && html`<p className="crintro crpre">${data.intro}</p>`}
      ${list('Scope', data.scope)}${list('Deliverables', data.deliver)}${list('Not included', data.excl)}${list('Your part', data.cresp)}
      ${
        (data.lines || []).length > 0 &&
        html`<section><h3>Prices</h3><div className="tblwrap"><table className="tbl small"><thead><tr><th>Item</th><th className="r">Rate</th><th>Unit</th><th className="r">Planned</th><th className="r">Amount</th></tr></thead><tbody>${data.lines.map(
          (l, i) => html`<tr key=${i}><td>${l.d}${l.note ? html`<div className="muted small">${l.note}</div>` : ''}</td><td className="r nw">${l.unit === 'pct' ? l.rate + '%' : crMoney(l.cur, l.rate)}</td><td className="nw">${home.units[l.unit]}</td><td className="r">${l.qty == null || l.qty === '' ? '—' : l.qty}</td><td className="r nw">${calc.amounts[i] == null ? '—' : crMoney(l.cur, calc.amounts[i])}</td></tr>`
        )}</tbody></table></div>
          <div className="crtot"><b>Total of the priced items: ${crTotText(calc.tot)}</b>${calc.apart.length ? html`<div className="muted small">Plus, as agreed for each use: ${calc.apart.join('; ')}.</div>` : ''}<div className="muted small">Amounts are the rate × the planned quantity shown. A share of salary depends on the salary agreed with each hire. Different currencies are not added together.</div></div></section>`
      }
      ${data.assume && html`<section><h3>Assumptions</h3><p className="crpre">${data.assume}</p></section>`}
      ${data.terms && html`<section><h3>Payment terms</h3><p className="crpre">${data.terms}</p></section>`}
    </div>`;
}

function CrPropDetail({ id, home, onClose, onChanged, onEdit }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [act, setAct] = useState(null);
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(0);
  const [cmp, setCmp] = useState(null);
  const load = () =>
    api('cr_prop_get', { id }).then(setD, e => {
      toast(errText(e), true);
      onClose();
    });
  useEffect(() => {
    load();
  }, [id]);
  if (!d) return html`<${Modal} wide title="Proposal" onClose=${onClose}><${Spinner} /><//>`;
  const Pp = d.prop;
  const staff = home.staff;
  const can = d.can;
  const shown = d.vers.find(v => v.n === (view || Pp.ver)) || d.vers[d.vers.length - 1];
  const run = async (a, extra, msg) => {
    setBusy(true);
    try {
      await api('cr_prop_act', { id, act: a, ...(extra || {}) });
      toast(msg);
      setAct(null);
      setF({});
      setView(0);
      load();
      onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const pair = cmp || (d.vers.length > 1 ? [d.vers[d.vers.length - 2].n, d.vers[d.vers.length - 1].n] : null);
  const A = pair && d.vers.find(v => v.n === pair[0]);
  const B = pair && d.vers.find(v => v.n === pair[1]);
  const changes = A && B ? crPropChanges(A.data, B.data, home) : [];
  const live = ['shared', 'question'].includes(Pp.st);
  const domId = 'crdoc-' + Pp.id;
  return html`<${Modal} wide title=${Pp.ti} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Close</button>${shown && html`<button className="btn ghost" onClick=${() => crPrint(domId, Pp.ti + ' (v' + shown.n + ')')}><${Icon} n="down" />Print or save as PDF</button>`}${can.edit && onEdit && html`<button className="btn ghost" onClick=${() => onEdit(d)}><${Icon} n="pen" />Edit</button>`}${can.share && html`<button className="btn" onClick=${() => setAct('share')}>${Pp.ver ? 'Share a new version…' : 'Share with the client…'}</button>`}${can.accept && html`<button className="btn" onClick=${() => setAct('accept')}><${Icon} n="check" />Accept…</button>`}`}>
      <div className="stack crdetail">
        <div className="toolbar" style=${{ gap: 8 }}>
          <${Chip} s=${CR_PTONE[Pp.st]}>${home.pst[Pp.st] || Pp.st}<//>
          <span className="muted small">${Pp.co}${Pp.ver ? ' · shared version ' + Pp.ver : ' · not shared yet'}${staff && Pp.ver ? ' · ' + (Pp.viewed ? 'first opened ' + fmtTs(Pp.viewed) : 'not opened yet') : ''}${Pp.ownerN ? ' · ' + Pp.ownerN : ''}</span>
          ${Pp.dec && Pp.dec.d && html`<span className="small crright">${(Pp.dec.d === 'accepted' ? 'Accepted' : 'Declined') + ' by ' + Pp.dec.n + ', ' + fmtTs(Pp.dec.at) + ' (v' + Pp.dec.ver + ')'}</span>`}
        </div>
        ${staff && Pp.unshared && html`<div className="note amber"><span>The draft has changes the client has not seen. Share a new version when it is ready.</span></div>`}
        ${!staff && live && view && view !== Pp.ver ? html`<div className="note amber"><span>You are looking at version ${view}. Version ${Pp.ver} is the current one: only it can be accepted.</span></div>` : null}
        ${(can.ask || can.decline || can.withdraw || (staff && live)) && html`<div className="actions crbar">${can.ask && html`<button type="button" className="btn ghost sm" onClick=${() => setAct('ask')}>Ask a question</button>`}${can.decline && html`<button type="button" className="btn ghost sm" onClick=${() => setAct('decline')}>Decline…</button>`}${staff && live && html`<button type="button" className="btn ghost sm" onClick=${() => setAct('answer')}>${Pp.st === 'question' ? 'Answer the question' : 'Message the client'}</button>`}${can.withdraw && html`<button type="button" className="btn ghost sm" disabled=${busy} onClick=${() => run('withdraw', {}, 'Withdrawn.')}>Withdraw</button>`}</div>`}
        ${
          act &&
          act !== 'share' &&
          html`<div className="crform2 form">
            <b>${{ ask: 'Your question', answer: Pp.st === 'question' ? 'Answer the client' : 'A message to the client', decline: 'Decline the proposal', accept: 'Accept version ' + Pp.ver }[act]}</b>
            ${act === 'accept' && html`<p className="small" style=${{ margin: 0 }}>Accepting records your typed name, the time and your network address with version ${Pp.ver} of this proposal. StratEdge then prepares the agreement for signature.</p><${Field} label="Your full name"><input value=${f.name || ''} onInput=${e => setF({ ...f, name: e.target.value })} /><//><label className="check"><input type="checkbox" checked=${!!f.auth} onChange=${e => setF({ ...f, auth: e.target.checked })} /><span>${'I may accept this on behalf of ' + Pp.co + '.'}</span></label>`}
            <${Field} label=${act === 'accept' ? 'A note (optional)' : act === 'decline' ? 'Why' : 'Message'}><textarea rows="3" value=${f.msg || ''} onInput=${e => setF({ ...f, msg: e.target.value })} /><//>
            <div className="actions"><button type="button" className="btn ghost sm" onClick=${() => setAct(null)}>Cancel</button><button type="button" className="btn sm" disabled=${busy || (act === 'accept' && (!f.auth || String(f.name || '').trim().length < 3))} onClick=${() => run(act, { ...f, ver: Pp.ver }, { ask: 'Question sent.', answer: 'Sent.', decline: 'Declined.', accept: 'Accepted. StratEdge will be in touch about the next steps.' }[act])}>${{ ask: 'Send', answer: 'Send', decline: 'Decline', accept: 'Accept version ' + Pp.ver }[act]}</button></div>
          </div>`
        }
        ${
          act === 'share' &&
          html`<div className="crform2 form">
            <b>${Pp.ver ? 'Share version ' + (Pp.ver + 1) : 'Share with ' + Pp.co}</b>
            <span className="small">Who receives it (an email with a link to the client portal; they see it under Proposals):</span>
            <div className="crpick">${(d.contacts || []).length ? d.contacts.map(c => html`<label key=${c.id} className="check"><input type="checkbox" checked=${(f.to || d.to || []).includes(c.id)} onChange=${e => {
              const cur = f.to || d.to || [];
              setF({ ...f, to: e.target.checked ? [...cur, c.id] : cur.filter(x => x !== c.id) });
            }} /><span>${c.n} <span className="muted small">${c.e}</span></span></label>`) : html`<p className="muted small">${Pp.co} has no contacts with a portal login yet. Add one under Clients first.</p>`}</div>
            <${Field} label="A note with it (optional)"><textarea rows="2" value=${f.msg || ''} onInput=${e => setF({ ...f, msg: e.target.value })} /><//>
            <div className="actions"><button type="button" className="btn ghost sm" onClick=${() => setAct(null)}>Cancel</button><button type="button" className="btn sm" disabled=${busy} onClick=${() => run('share', { msg: f.msg || '', to: f.to || d.to || [] }, 'Shared.')}>Share it</button></div>
          </div>`
        }
        ${
          d.vers.length > 0
            ? html`${d.vers.length > 1 && html`<div className="toolbar"><span className="small">Version</span><div className="seg">${d.vers.map(v => html`<button key=${v.n} type="button" className=${shown.n === v.n ? 'on' : ''} onClick=${() => setView(v.n)}>v${v.n}</button>`)}</div></div>`}
                <${CrPropDoc} data=${shown.data} calc=${shown.calc} home=${home} prop=${Pp} v=${shown.n} domId=${domId} />
                ${
                  d.vers.length > 1 &&
                  html`<details className="crcmp"><summary>What changed between versions</summary><div className="toolbar"><select value=${pair[0]} aria-label="Compare from" onChange=${e => setCmp([+e.target.value, pair[1]])}>${d.vers.map(v => html`<option key=${v.n} value=${v.n}>v${v.n}</option>`)}</select><span className="small">with</span><select value=${pair[1]} aria-label="Compare with" onChange=${e => setCmp([pair[0], +e.target.value])}>${d.vers.map(v => html`<option key=${v.n} value=${v.n}>v${v.n}</option>`)}</select></div>${changes.length ? html`<ul className="small">${changes.map((c, i) => html`<li key=${i}>${c}</li>`)}</ul>` : html`<p className="muted small">No differences.</p>`}</details>`
                }`
            : staff && html`<div className="note"><span>Not shared yet. This is the draft as the client will see it:</span></div><${CrPropDoc} data=${d.draft} calc=${d.draftCalc} home=${home} prop=${Pp} v=${1} domId=${domId} />`
        }
        ${
          d.evs.length > 0 &&
          html`<details className="crcmp" open=${Pp.st === 'question'}><summary>Questions and history (${d.evs.length})</summary><div className="crlog">${d.evs.map(
            (e, i) => html`<div key=${i} className=${'crev ' + e.side + (e.vis ? '' : ' internal')}><div className="small"><b>${e.byn || 'StratEdge'}</b> <span className="muted">${fmtTs(e.at)}${e.vis ? '' : ' · StratEdge only'}</span></div><div className="crmsg">${e.msg}</div></div>`
          )}</div></details>`
        }
      </div>
    <//>`;
}
/* What changed between two proposal versions, in words */
function crPropChanges(a, b, home) {
  const out = [];
  const money = l => (l.unit === 'pct' ? l.rate + '%' : crMoney(l.cur, l.rate)) + (l.qty ? ' × ' + l.qty : '');
  if (a.model !== b.model) out.push('Service: ' + home.models[a.model] + ' → ' + home.models[b.model]);
  for (const [k, n] of [['intro', 'Summary'], ['assume', 'Assumptions'], ['terms', 'Payment terms']]) if ((a[k] || '') !== (b[k] || '')) out.push(n + ' changed');
  for (const [k, n] of [['valid', 'Valid until'], ['start', 'Proposed start']]) if ((a[k] || '') !== (b[k] || '')) out.push(n + ': ' + (a[k] ? crDay(a[k]) : '—') + ' → ' + (b[k] ? crDay(b[k]) : '—'));
  for (const [k, n] of [['scope', 'Scope'], ['deliver', 'Deliverables'], ['excl', 'Not included'], ['cresp', 'Your part']]) {
    (b[k] || []).filter(x => !(a[k] || []).includes(x)).forEach(x => out.push(n + ' added: ' + x));
    (a[k] || []).filter(x => !(b[k] || []).includes(x)).forEach(x => out.push(n + ' removed: ' + x));
  }
  const key = l => l.d + '|' + l.unit;
  const am = Object.fromEntries((a.lines || []).map(l => [key(l), l]));
  const bm = Object.fromEntries((b.lines || []).map(l => [key(l), l]));
  for (const [k, l] of Object.entries(bm)) {
    const o = am[k];
    if (!o) out.push('Price added: ' + (l.d || home.units[l.unit]) + ' ' + money(l) + ' ' + home.units[l.unit]);
    else if (o.rate !== l.rate || o.qty !== l.qty || o.cur !== l.cur) out.push('Price changed: ' + (l.d || home.units[l.unit]) + ' ' + money(o) + ' → ' + money(l));
  }
  for (const [k, l] of Object.entries(am)) if (!bm[k]) out.push('Price removed: ' + (l.d || home.units[l.unit]));
  return out;
}

/* ---------- StratEdge: the desk ---------- */
const CR_PRESETS = {
  contract: { scope: ['Source and screen consultants for the role', 'Submit profiles with rates and each consultant’s approval to represent them', 'Coordinate interviews', 'Onboard the selected consultant', 'Weekly timesheets and invoicing'], deliver: ['Screened profiles for each opening', 'A placed consultant for each opening filled'], cresp: ['Interview feedback within the agreed time', 'Timesheet approval each week'], lines: [{ d: 'Bill rate', unit: 'hour', rate: '', qty: '', cur: 'USD' }] },
  c2h: { scope: ['Source and screen consultants for the role', 'Contract period with weekly timesheets', 'Conversion to your payroll when you decide'], deliver: ['A placed consultant for each opening filled'], cresp: ['Interview feedback within the agreed time', 'Timesheet approval each week', 'Notice before conversion'], lines: [{ d: 'Bill rate during the contract', unit: 'hour', rate: '', qty: '', cur: 'USD' }, { d: 'Conversion fee', unit: 'pct', rate: '', qty: '', cur: 'USD' }] },
  perm: { scope: ['Search and screen candidates', 'A shortlist with each candidate’s evidence', 'Interview coordination', 'Offer support'], deliver: ['A shortlist for each opening', 'A hire for each opening filled'], cresp: ['Interview feedback within the agreed time', 'Salary range and offer approvals'], lines: [{ d: 'Placement fee', unit: 'pct', rate: '', qty: '', cur: 'USD' }] },
  support: { scope: ['Recruiters working your open roles', 'Sourcing, screening and interview scheduling', 'A weekly progress report'], deliver: ['Screened candidates for your roles', 'A weekly report'], cresp: ['A named hiring contact for each role'], lines: [{ d: 'Recruitment support', unit: 'month', rate: '', qty: '', cur: 'USD' }] },
  sow: { scope: ['Deliver the work described in the statement of work', 'A named delivery lead'], deliver: ['Milestone 1', 'Milestone 2'], cresp: ['Access to the systems and people the work needs', 'Acceptance of each milestone within the agreed time'], lines: [{ d: 'Milestone 1', unit: 'milestone', rate: '', qty: '', cur: 'USD' }, { d: 'Milestone 2', unit: 'milestone', rate: '', qty: '', cur: 'USD' }] },
};
const crPreset = m => ({ scope: [...CR_PRESETS[m].scope], deliver: [...CR_PRESETS[m].deliver], cresp: [...CR_PRESETS[m].cresp], lines: CR_PRESETS[m].lines.map(l => ({ ...l })) });
function CrStaffDesk({ q }) {
  const [home, err, reload] = useCrHome('');
  const [tab, setTab] = useState((q && q.t) || 'reqs');
  const [open, setOpen] = useState((q && q.r) || '');
  const [openP, setOpenP] = useState((q && q.p) || '');
  const [edit, setEdit] = useState(null);
  const [editP, setEditP] = useState(null);
  const [co, setCo] = useState('');
  const [f, setF] = useState('us');
  if (err && !home) return html`<${LoadError} error=${err} onRetry=${reload} />`;
  if (!home) return html`<${Spinner} label="Loading client requests…" />`;
  const grp = {
    us: r => ['review', 'approved', 'draft'].includes(r.st),
    client: r => ['questions', 'approval', 'returned'].includes(r.st),
    active: r => r.st === 'active',
    hold: r => r.st === 'hold',
    done: r => ['filled', 'cancelled'].includes(r.st),
    all: () => true,
  };
  const inCo = r => !co || r.cid === co;
  const reqs = home.reqs.filter(r => inCo(r) && grp[f](r));
  const props = home.props.filter(inCo);
  const n = k => home.reqs.filter(r => inCo(r) && grp[k](r)).length;
  return html`<div className="stack crpage">
      <${KitTabs} tabs=${[['reqs', 'Talent requests', n('us') || null], ['props', 'Proposals', home.props.filter(p => p.st === 'question').length || null], ['cos', 'Approvers'], ['acc', 'People & access'], ['desk', 'Delivery desk'], ['rv', 'Business reviews']]} tab=${tab} onTab=${setTab} />
      ${
        tab !== 'cos' && tab !== 'acc' && tab !== 'desk' && tab !== 'rv' &&
        html`<div className="toolbar"><select value=${co} aria-label="Client company" onChange=${e => setCo(e.target.value)}><option value="">All client companies</option>${home.cos.map(c => html`<option key=${c.id} value=${c.id}>${c.n}</option>`)}</select>
          ${tab === 'reqs' && html`<div className="seg">${[['us', 'Needs us'], ['client', 'Waiting for the client'], ['active', 'Sourcing'], ['hold', 'On hold'], ['done', 'Closed'], ['all', 'All']].map(([k, nm]) => html`<button key=${k} type="button" className=${f === k ? 'on' : ''} onClick=${() => setF(k)}>${nm}${k !== 'all' && n(k) ? ' · ' + n(k) : ''}</button>`)}</div>`}
          <button className="btn push" onClick=${() => (tab === 'reqs' ? setEdit({}) : setEditP({}))}><${Icon} n="plus" />${tab === 'reqs' ? 'Request for a client' : 'New proposal'}</button></div>`
      }
      ${tab === 'reqs' && (reqs.length ? html`<${CrReqTable} rows=${reqs} home=${home} onOpen=${setOpen} staff=${true} />` : html`<${Empty} title="Nothing here">Client companies send talent requests from their portal (Requirements › Talent requests). You can also enter one for them.<//>`)}
      ${tab === 'props' && (props.length ? html`<${CrPropTable} rows=${props} home=${home} onOpen=${setOpenP} staff=${true} />` : html`<${Empty} title="No proposals yet">Write one for a client company: the service, scope, prices and how long it is valid. Share it when it is ready.<//>`)}
      ${tab === 'cos' && html`<${CrCfgPanel} home=${home} />`}
      ${tab === 'acc' && html`<${CrPeoplePanel} cid=${co || (q && q.c) || ''} staff=${true} cos=${home.cos} />`}
      ${tab === 'desk' && html`<${CrDeskTab} cos=${home.cos} cid0=${co} q=${q} />`}
      ${tab === 'rv' && html`<${CrReviewTab} cos=${home.cos} cid0=${co} q=${q} />`}
      ${open && html`<${CrReqDetail} id=${open} tab0=${q && q.r === open ? q.tab : ''} home=${home} onClose=${() => setOpen('')} onChanged=${reload} onEdit=${r => (setOpen(''), setEdit(r))} />`}
      ${edit && html`<${CrReqEditor} r=${edit.id ? edit : null} cid=${edit.cid || co} home=${home} staff=${true} onClose=${() => setEdit(null)} onSaved=${id => (setEdit(null), reload(), setOpen(id))} />`}
      ${openP && html`<${CrPropDetail} id=${openP} home=${home} onClose=${() => setOpenP('')} onChanged=${reload} onEdit=${dd => (setOpenP(''), setEditP(dd))} />`}
      ${editP && html`<${CrPropEditor} src=${editP.prop ? editP : null} cid=${co} home=${home} onClose=${() => setEditP(null)} onSaved=${id => (setEditP(null), reload(), setOpenP(id))} />`}
    </div>`;
}

function CrPropEditor({ src, cid, home, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !src;
  const [co, setCo] = useState(isNew ? cid : src.prop.cid);
  const [req, setReq] = useState(isNew ? '' : src.prop.req);
  const [ti, setTi] = useState(isNew ? '' : src.prop.ti);
  const [d, setD] = useState(() =>
    isNew
      ? { model: 'contract', intro: '', excl: [], assume: '', terms: 'Invoices monthly, payable within 30 days.', valid: '', start: '', ...crPreset('contract') }
      : { ...src.draft, lines: (src.draft.lines || []).map(l => ({ ...l, rate: l.rate == null ? '' : l.rate, qty: l.qty == null ? '' : l.qty })) }
  );
  const [offer, setOffer] = useState('');
  const [busy, setBusy] = useState(false);
  const txt = k => (d[k] || []).join('\n');
  const setList = k => e => setD({ ...d, [k]: e.target.value.split('\n') });
  const setLine = (i, patch) => setD({ ...d, lines: d.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const calc = crCalc(d.lines);
  const coReqs = home.reqs.filter(r => r.cid === co);
  // the starting text for a service: used as is when nothing was changed yet, else offered
  const pickModel = m => {
    const cur = JSON.stringify([d.scope, d.deliver, d.cresp, d.lines]);
    const was = crPreset(d.model);
    const untouched = cur === JSON.stringify([was.scope, was.deliver, was.cresp, was.lines]) || (!d.scope.filter(Boolean).length && !d.lines.length);
    setD(untouched ? { ...d, model: m, ...crPreset(m) } : { ...d, model: m });
    setOffer(untouched ? '' : m);
  };
  const save = async () => {
    setBusy(true);
    try {
      const clean = { ...d, scope: d.scope.map(s => s.trim()).filter(Boolean), deliver: d.deliver.map(s => s.trim()).filter(Boolean), excl: d.excl.map(s => s.trim()).filter(Boolean), cresp: d.cresp.map(s => s.trim()).filter(Boolean), lines: d.lines.filter(l => String(l.d || '').trim() || l.rate !== '') };
      const r = await api('cr_prop_save', { id: isNew ? '' : src.prop.id, cid: co, req, ti, data: clean });
      toast(isNew ? 'Proposal saved. Share it when it is ready.' : src.prop.ver ? 'Saved. The client sees it when you share a new version.' : 'Saved.');
      onSaved(r.id);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} wide title=${isNew ? 'New proposal' : 'Edit: ' + src.prop.ti} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy || !ti.trim() || !co} onClick=${save}>Save</button>`}>
      <div className="stack form crform">
        <div className="row3">
          <${Field} label="Client company"><select value=${co} disabled=${!isNew} onChange=${e => (setCo(e.target.value), setReq(''))}><option value="">Choose…</option>${home.cos.map(c => html`<option key=${c.id} value=${c.id}>${c.n}</option>`)}</select><//>
          <${Field} label="For their talent request (optional)"><select value=${req} disabled=${!isNew || !co} onChange=${e => {
            setReq(e.target.value);
            const r = coReqs.find(x => x.id === e.target.value);
            if (r && !ti) setTi('Proposal: ' + r.ti);
          }}><option value="">None</option>${coReqs.map(r => html`<option key=${r.id} value=${r.id}>${r.ti}</option>`)}</select><//>
          <${Field} label="Service"><select value=${d.model} onChange=${e => pickModel(e.target.value)}>${Object.entries(home.models).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//>
        </div>
        ${offer && html`<div className="note"><span>The scope and prices are yours, so they stayed. <button type="button" className="btn ghost sm" onClick=${() => (setD({ ...d, ...crPreset(offer) }), setOffer(''))}>Use the starting text for ${home.models[offer]}</button></span></div>`}
        <${Field} label="Title"><input value=${ti} onInput=${e => setTi(e.target.value)} placeholder="e.g. SAP PP/QM consultants for the S/4HANA rollout" /><//>
        <${Field} label="Summary"><textarea rows="3" value=${d.intro} onInput=${e => setD({ ...d, intro: e.target.value })} placeholder="The client's need in their words, and how StratEdge will meet it" /><//>
        <div className="row2">
          <${Field} label="Scope (one per line)"><textarea rows="5" value=${txt('scope')} onInput=${setList('scope')} /><//>
          <${Field} label="Deliverables (one per line)"><textarea rows="5" value=${txt('deliver')} onInput=${setList('deliver')} /><//>
        </div>
        <div className="row2">
          <${Field} label="Not included (one per line)"><textarea rows="3" value=${txt('excl')} onInput=${setList('excl')} /><//>
          <${Field} label="The client's part (one per line)"><textarea rows="3" value=${txt('cresp')} onInput=${setList('cresp')} /><//>
        </div>
        <span className="lbl">Prices</span>
        <p className="muted small" style=${{ margin: 0 }}>Each line keeps its own unit: an hourly or daily rate (with the planned hours or days for an amount), a monthly fee, a share of first-year salary, a fee, a milestone or a fixed price. Lines in different currencies are not added together.</p>
        <div className="tblwrap"><table className="tbl small crlines"><thead><tr><th>Item</th><th>Unit</th><th className="r">Rate</th><th className="r">Planned</th><th>Currency</th><th className="r">Amount</th><th></th></tr></thead><tbody>${d.lines.map(
          (l, i) => html`<tr key=${i}><td><input value=${l.d} aria-label=${'Line ' + (i + 1) + ' item'} onInput=${e => setLine(i, { d: e.target.value })} /></td><td><select value=${l.unit} aria-label=${'Line ' + (i + 1) + ' unit'} onChange=${e => setLine(i, { unit: e.target.value })}>${Object.entries(home.units).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select></td><td><input type="number" min="0" step="any" value=${l.rate} aria-label=${'Line ' + (i + 1) + ' rate'} onInput=${e => setLine(i, { rate: e.target.value })} /></td><td><input type="number" min="0" step="any" value=${l.qty} disabled=${l.unit === 'pct'} aria-label=${'Line ' + (i + 1) + ' planned quantity'} placeholder=${['hour', 'day', 'month'].includes(l.unit) ? 'e.g. 960' : '1'} onInput=${e => setLine(i, { qty: e.target.value })} /></td><td><select value=${l.cur} aria-label=${'Line ' + (i + 1) + ' currency'} onChange=${e => setLine(i, { cur: e.target.value })}>${home.curs.map(c => html`<option key=${c}>${c}</option>`)}</select></td><td className="r nw">${calc.amounts[i] == null ? '—' : crMoney(l.cur, calc.amounts[i])}</td><td><button type="button" className="btn ghost sm" aria-label=${'Remove line ' + (i + 1)} onClick=${() => setD({ ...d, lines: d.lines.filter((x, j) => j !== i) })}><${Icon} n="trash" /></button></td></tr>`
        )}</tbody></table></div>
        <div className="actions"><button type="button" className="btn ghost sm" onClick=${() => setD({ ...d, lines: [...d.lines, { d: '', unit: 'hour', rate: '', qty: '', cur: (d.lines[0] && d.lines[0].cur) || 'USD' }] })}><${Icon} n="plus" />Add a price line</button><span className="small crright crtotline"><b>Total of the priced items: ${crTotText(calc.tot)}</b>${calc.apart.length ? ' · plus ' + calc.apart.join('; ') : ''}</span></div>
        <div className="row2">
          <${Field} label="Assumptions"><textarea rows="3" value=${d.assume} onInput=${e => setD({ ...d, assume: e.target.value })} placeholder="e.g. 40 hours a week; the client provides equipment" /><//>
          <${Field} label="Payment terms"><textarea rows="3" value=${d.terms} onInput=${e => setD({ ...d, terms: e.target.value })} /><//>
        </div>
        <div className="row2"><${Field} label="Valid until" hint="Needed to share it. After this date the client can no longer accept it."><input type="date" value=${d.valid} onInput=${e => setD({ ...d, valid: e.target.value })} /><//><${Field} label="Proposed start (optional)"><input type="date" value=${d.start} onInput=${e => setD({ ...d, start: e.target.value })} /><//></div>
      </div>
    <//>`;
}

/* ---------- v64: People & access: each contact's role and business units, delegated approvals, access reviews ---------- */
const CA_ROLE_HELP = {
  full: 'Everything the company has on the portal, and this page.',
  hiring: 'Talent requests, shortlists and interviews, timesheets; reads consultants and reports.',
  procurement: 'Proposals and supplier documents; reads talent requests, invoices and reports.',
  finance: 'Timesheets; reads talent requests, proposals, supplier documents, invoices, consultants and reports.',
  exec: 'Reads everything, changes nothing.',
};
const caDayIn = ms => (ms ? new Date(ms).toISOString().slice(0, 10) : '');
const caDayOut = (s, endOfDay) => {
  if (!s) return 0;
  const d = new Date(s + 'T00:00:00');
  if (!validDate(d)) return 0;
  return d.getTime() + (endOfDay ? 86399000 : 0);
};
function CrPeoplePanel({ cid: cid0, staff, cos }) {
  const toast = useToast();
  const [cid, setCid] = useState(cid0 || (cos && cos[0] && cos[0].id) || '');
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState('');
  const [edit, setEdit] = useState({});
  const [deleg, setDeleg] = useState(null);
  const [revoke, setRevoke] = useState(null);
  const [review, setReview] = useState('');
  const [legend, setLegend] = useState(false);
  useEffect(() => {
    if (cid0) setCid(cid0);
  }, [cid0]);
  const load = () => api('cr_acc_get', { cid }).then(x => (setD(x), setErr(null), setEdit({})), setErr);
  useEffect(() => {
    setD(null);
    setEdit({});
    if (cid) load();
  }, [cid]);
  const run = async (route, body, done) => {
    setBusy(route + (body.uid || body.id || ''));
    try {
      const r = await api(route, { cid, ...body });
      if (r && r.people) {
        setD(r);
        setEdit({});
      } else await load();
      if (done) toast(done);
      return r || true;
    } catch (e) {
      toast(errText(e), true);
      return null;
    } finally {
      setBusy('');
    }
  };
  if (staff && cos && !cos.length) return html`<${Empty} title="No client companies">Add client companies under Clients first.<//>`;
  const pick = staff && cos ? html`<${Field} label="Client company"><select value=${cid} onChange=${e => setCid(e.target.value)}>${cos.map(x => html`<option key=${x.id} value=${x.id}>${x.n}</option>`)}</select><//>` : null;
  if (err && !d) return html`<div className="stack">${pick}<${LoadError} error=${err} onRetry=${load} /></div>`;
  if (!d) return html`<div className="stack">${pick}<${Spinner} label="Loading people & access…" /></div>`;
  const manage = d.manage;
  const roles = Object.entries(d.roles);
  const areas = Object.entries(d.areas);
  const unitsOf = p => (edit[p.id] && edit[p.id].units !== undefined ? edit[p.id].units : p.units.join(', '));
  const roleOf = p => (edit[p.id] && edit[p.id].role) || p.role;
  const changed = p => !!edit[p.id] && (roleOf(p) !== p.role || unitsOf(p).split(',').map(s => s.trim()).filter(Boolean).join('|') !== p.units.join('|'));
  const save = p => run('cr_acc_set', { uid: p.id, role: roleOf(p), units: unitsOf(p).split(',').map(s => s.trim()).filter(Boolean) }, firstName(p.n) + ': ' + d.roles[roleOf(p)] + '.');
  const active = d.deleg.filter(x => x.active);
  const past = d.deleg.filter(x => !x.active);
  const approvers = d.appr.length ? d.people.filter(p => d.appr.includes(p.id)) : d.people;
  const mayDelegate = manage || approvers.some(p => p.id === d.me);
  const startDeleg = () => setDeleg({ from: !staff && approvers.some(p => p.id === d.me) ? d.me : approvers[0] ? approvers[0].id : '', to: '', start: caDayIn(Date.now()), end: caDayIn(Date.now() + 14 * 86400000), note: '' });
  const sendDeleg = async () => {
    const r = await run('cr_acc_deleg', { from: deleg.from, to: deleg.to, start: caDayOut(deleg.start), end: caDayOut(deleg.end, true), note: deleg.note }, 'Delegated.');
    if (r) setDeleg(null);
  };
  return html`<div className="stack crpage capeople">
      ${pick}
      <div className="muted small">Each person's role says what they use at ${d.co} and whether they act or only read; business units limit a person to the talent requests of those units (a request outside them does not exist for them). ${manage ? 'Full-access people and StratEdge change roles and units, delegate approvals, end a colleague\'s access and record access reviews; everything is kept in the audit log.' : 'Full-access people at ' + d.co + ' and StratEdge change these.'} <a href="#" onClick=${e => (e.preventDefault(), setLegend(!legend))}>${legend ? 'Hide' : 'What each role may do'}</a></div>
      ${legend && html`<div className="tblwrap"><table className="tbl cagrid"><thead><tr><th>Role</th>${areas.map(([k, n]) => html`<th key=${k}>${n}</th>`)}</tr></thead><tbody>${roles.map(([rk, rn]) => html`<tr key=${rk}><td><b>${rn}</b><div className="muted small">${CA_ROLE_HELP[rk]}</div></td>${areas.map(([ak]) => html`<td key=${ak} className=${d.grid[rk][ak] || 'n'}>${d.grid[rk][ak] === 'w' ? 'Acts' : d.grid[rk][ak] === 'r' ? 'Reads' : '—'}</td>`)}</tr>`)}</tbody></table></div>`}
      <section className="panel stack">
        <div className="ph-row"><h2 className="ph">People at ${d.co}</h2><span className="muted small crright">${d.people.length} with a portal account</span></div>
        ${d.people.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Person</th><th>Role</th><th>Business units</th><th>Last sign-in</th><th></th></tr></thead><tbody>${d.people.map(p => html`<tr key=${p.id} className=${p.id === d.me ? 'came' : ''}>
            <td><b>${p.n}</b>${p.id === d.me ? ' (you)' : ''}<div className="muted small">${p.e}</div>${p.set && html`<div className="muted small">Set by ${p.setBy}, ${fmtTs(p.setAt)}</div>`}</td>
            <td>${manage ? html`<select value=${roleOf(p)} aria-label=${'Role of ' + p.n} onChange=${e => setEdit({ ...edit, [p.id]: { ...(edit[p.id] || {}), role: e.target.value } })}>${roles.map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select>` : html`<${Chip} s=${p.role === 'full' ? 'ok' : p.role === 'exec' ? '' : 'new'}>${d.roles[p.role]}<//>`}${!p.set && html`<div className="muted small">Role default (nothing set)</div>`}</td>
            <td>${manage ? html`<input value=${unitsOf(p)} list="caunits" aria-label=${'Business units of ' + p.n} placeholder="All business units" onInput=${e => setEdit({ ...edit, [p.id]: { ...(edit[p.id] || {}), units: e.target.value } })} />` : p.units.length ? p.units.join(', ') : html`<span className="muted">All</span>`}</td>
            <td className="nw small">${p.seen ? fmtTs(p.seen) : html`<span className="muted">Never</span>`}</td>
            <td className="r"><div className="actions" style=${{ justifyContent: 'flex-end' }}>${manage && changed(p) && html`<button type="button" className="btn sm" disabled=${!!busy} onClick=${() => save(p)}>Save</button>`}${manage && p.id !== d.me && html`<button type="button" className="btn ghost sm" onClick=${() => setRevoke({ p, msg: '' })}>End access…</button>`}</div></td>
          </tr>`)}</tbody></table></div><datalist id="caunits">${d.units.map(u => html`<option key=${u} value=${u} />`)}</datalist>` : html`<${Empty} title="No contacts with a portal account yet">${staff ? 'Invite the company\'s people from Team; they appear here with full access until a role is set.' : 'Ask StratEdge to invite your colleagues.'}<//>`}
        ${manage && html`<p className="muted small" style=${{ margin: 0 }}>Units are separated by commas and must match the "Business unit" written on talent requests (${d.units.length ? 'known so far: ' + d.units.join(', ') : 'none written yet'}). The company always keeps at least one person with full access to every unit.</p>`}
      </section>
      <section className="panel stack">
        <div className="ph-row"><h2 className="ph">Delegated approvals</h2>${mayDelegate && !deleg && html`<button type="button" className="btn sm" onClick=${startDeleg}><${Icon} n="plus" />Delegate approvals…</button>`}</div>
        <p className="muted small" style=${{ margin: 0 }}>An approver (${d.appr.length ? approvers.map(p => p.n).join(d.rule === 'all' ? ' and ' : ' or ') : 'anyone at ' + d.co + ', since nobody is named'}) hands their talent request approvals to a colleague for up to ${d.maxDays} days, for the requests the colleague may read. The delegate's approval is recorded under both names; the delegation ends by itself.</p>
        ${deleg && html`<div className="form stack crform2">
          <div className="row2"><${Field} label="Who delegates"><select value=${deleg.from} disabled=${!manage} onChange=${e => setDeleg({ ...deleg, from: e.target.value })}>${approvers.map(p => html`<option key=${p.id} value=${p.id}>${p.n}</option>`)}</select><//><${Field} label="To"><select value=${deleg.to} onChange=${e => setDeleg({ ...deleg, to: e.target.value })}><option value="">Choose a colleague…</option>${d.people.filter(p => p.id !== deleg.from).map(p => html`<option key=${p.id} value=${p.id}>${p.n} · ${d.roles[p.role]}</option>`)}</select><//></div>
          <div className="row3"><${Field} label="From"><input type="date" value=${deleg.start} onInput=${e => setDeleg({ ...deleg, start: e.target.value })} /><//><${Field} label="Until (inclusive)"><input type="date" value=${deleg.end} onInput=${e => setDeleg({ ...deleg, end: e.target.value })} /><//><${Field} label="Note (optional)"><input value=${deleg.note} maxLength="300" placeholder="e.g. on leave" onInput=${e => setDeleg({ ...deleg, note: e.target.value })} /><//></div>
          <div className="actions"><button type="button" className="btn" disabled=${!!busy || !deleg.to || !deleg.from} onClick=${sendDeleg}>Delegate</button><button type="button" className="btn ghost" onClick=${() => setDeleg(null)}>Cancel</button></div>
        </div>`}
        ${active.length ? html`<ul className="list">${active.map(x => html`<li key=${x.id}><div><div className="t">${x.fromN} → ${x.toN}</div><div className="m">Until ${fmtDay(x.end)}${x.note ? ' · ' + x.note : ''} · recorded by ${x.by}, ${fmtTs(x.at)}</div></div>${manage && html`<button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => run('cr_acc_deleg_end', { id: x.id }, 'Ended.')}>End now</button>`}</li>`)}</ul>` : html`<p className="muted small" style=${{ margin: 0 }}>No delegation in force.</p>`}
        ${past.length > 0 && html`<details className="crcmp"><summary>Past delegations (${past.length})</summary><ul className="list">${past.map(x => html`<li key=${x.id}><div><div className="t">${x.fromN} → ${x.toN}</div><div className="m">${fmtDay(x.start)} – ${fmtDay(x.end)}${x.ended ? ' · ended early by ' + x.ended : ''}${x.note ? ' · ' + x.note : ''}</div></div></li>`)}</ul></details>`}
      </section>
      <section className="panel stack">
        <div className="ph-row"><h2 className="ph">Access reviews</h2></div>
        <p className="muted small" style=${{ margin: 0 }}>Now and then someone with full access (or StratEdge) looks at who has access and what they may do, and records it here with the people and roles as they stood. Auditors ask for this.</p>
        ${manage && html`<div className="form stack"><textarea rows="2" value=${review} maxLength="2000" placeholder="e.g. Quarterly review: roles checked against the org chart; Priya moved to Finance; no other change." onInput=${e => setReview(e.target.value)}></textarea><div><button type="button" className="btn sm" disabled=${!!busy || review.trim().length < 5} onClick=${async () => { if (await run('cr_acc_review', { msg: review.trim() }, 'Review recorded.')) setReview(''); }}>Record the review</button></div></div>`}
        ${d.reviews.length ? html`<ul className="list">${d.reviews.map((x, i) => html`<li key=${i}><div><div className="t">${fmtTs(x.at)} · ${x.by}${x.staff ? ' (StratEdge)' : ''}</div><div className="m crpre">${x.note}</div><div className="muted small">${x.people.length} ${x.people.length === 1 ? 'person' : 'people'}: ${x.people.map(p => p.n + ' (' + (d.roles[p.role] || p.role) + (p.units.length ? ': ' + p.units.join(', ') : '') + ')').join('; ')}${x.deleg ? ' · ' + x.deleg + ' delegation' + (x.deleg === 1 ? '' : 's') + ' in force' : ''}</div></div></li>`)}</ul>` : html`<p className="muted small" style=${{ margin: 0 }}>No review recorded yet.</p>`}
      </section>
      ${revoke && html`<${Modal} title=${'End ' + revoke.p.n + '\'s access to ' + d.co} onClose=${() => setRevoke(null)} foot=${html`<button className="btn ghost" onClick=${() => setRevoke(null)}>Cancel</button><button className="btn danger" disabled=${!!busy} onClick=${async () => { const r = await run('cr_acc_revoke', { uid: revoke.p.id, msg: revoke.msg }, revoke.p.n + '\'s access ended.'); if (r) setRevoke(null); }}>End access</button>`}>
        <div className="stack form">
          <p className="muted small" style=${{ margin: 0 }}>${revoke.p.n} is signed out everywhere at once and can no longer open ${d.co}'s pages. If they belong to other companies on the portal, those are not affected; otherwise their account is paused. They are told by email. StratEdge can restore access later.</p>
          <${Field} label="Reason (optional, kept in the audit log)"><input value=${revoke.msg} maxLength="300" onInput=${e => setRevoke({ ...revoke, msg: e.target.value })} /><//>
        </div>
      <//>`}
    </div>`;
}

function CrCfgPanel({ home }) {
  const toast = useToast();
  const [cid, setCid] = useState((home.cos[0] && home.cos[0].id) || '');
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setD(null);
    if (cid) api('cr_cfg_get', { cid }).then(setD, e => toast(errText(e), true));
  }, [cid]);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('cr_cfg_save', { cid, ...d.cfg });
      setD(r);
      toast('Saved for ' + r.co + '.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  if (!home.cos.length) return html`<${Empty} title="No client companies">Add client companies under Clients first.<//>`;
  const c = d && d.cfg;
  return html`<div className="stack form crcfg">
      <${Field} label="Client company"><select value=${cid} onChange=${e => setCid(e.target.value)}>${home.cos.map(x => html`<option key=${x.id} value=${x.id}>${x.n}</option>`)}</select><//>
      ${
        !d
          ? html`<${Spinner} />`
          : html`<${Field} label="Account manager at StratEdge"><select value=${c.owner} onChange=${e => setD({ ...d, cfg: { ...c, owner: e.target.value } })}><option value="">Not named (HR and administrators hear about new requests)</option>${home.team.map(t => html`<option key=${t.id} value=${t.id}>${t.n}</option>`)}</select><//>
            <span className="lbl">Who approves talent requests at ${d.co}</span>
            ${d.contacts.length ? html`<div className="crpick">${d.contacts.map(x => html`<label key=${x.id} className="check"><input type="checkbox" checked=${c.appr.includes(x.id)} onChange=${e => setD({ ...d, cfg: { ...c, appr: e.target.checked ? [...c.appr, x.id] : c.appr.filter(y => y !== x.id) } })} /><span>${x.n} <span className="muted small">${x.e}</span></span></label>`)}</div>` : html`<p className="muted small">${d.co} has no contacts with a portal login yet.</p>`}
            <p className="muted small" style=${{ margin: 0 }}>With nobody ticked, any contact at ${d.co} may approve. The person who wrote a request does not approve it themselves when someone else can.</p>
            <div className="seg">${[['any', 'One approval is enough'], ['all', 'All must approve']].map(([k, n]) => html`<button key=${k} type="button" className=${c.rule === k ? 'on' : ''} onClick=${() => setD({ ...d, cfg: { ...c, rule: k } })}>${n}</button>`)}</div>
            <span className="lbl">Changes after approval that need approval again</span>
            <div className="crpick">${Object.entries(home.ess).map(([k, n]) => html`<label key=${k} className="check"><input type="checkbox" checked=${c.ess.includes(k)} onChange=${e => setD({ ...d, cfg: { ...c, ess: e.target.checked ? [...c.ess, k] : c.ess.filter(y => y !== k) } })} /><span>${n}</span></label>`)}</div>
            <div><button className="btn" disabled=${busy} onClick=${save}>Save</button></div>`
      }
    </div>`;
}
