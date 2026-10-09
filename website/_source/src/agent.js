/* ================= v33: StratEdge AI screening agent (Recruiting › Screening agent) =================
   Every new candidate is checked against the job and for signs of a fake profile, then asked (by email, with a secure
   link) to confirm their details, references, a few role questions and their work authorization. "Not a match"
   waits for a recruiter. This page is the agent's desk: what needs a person, who it is waiting on, the settings. */
const AG_TONE = { new: '', notfit: 'red', review: 'amber', verified: 'ok', asked: 'new', reminded: 'new', answered: 'new', noreply: '', closed: '', kept: '', fake: 'red', stopped: '', skipped: '' };
const AG_RISK_TONE = { high: 'red', medium: 'amber', low: 'ok' };
const AG_FIT = { qualified: ['Qualified', 'ok'], maybe: ['Possible match', 'amber'], not: ['Not a match', 'red'] };
const AG_ST = { new: 'Queued', notfit: 'Not a match: you decide', asked: 'Waiting for the candidate', reminded: 'Reminded', answered: 'Answered: checking', verified: 'Verified', review: 'Needs a recruiter', noreply: 'No reply', closed: 'Closed', kept: 'Kept in the pool', fake: 'Marked fake', stopped: 'Stopped', skipped: 'Not screened' };
const AG_VIA = { web: 'Applied online', inbox: 'Emailed in', staff: 'Added by the team' };
// why a candidate is "not a match": StratEdge AI's summary, the must-haves they miss, the fit score's gaps
const agWhyNot = fit => {
  if (!fit) return '';
  const miss = (fit.must || []).filter(m => m.met === 'no').map(m => m.req);
  const bad = (fit.why || []).filter(w => /^(Not listed|Only|Different|Visa|The job takes|Failed|No resume)/i.test(w));
  return [fit.summary, miss.length ? 'Missing: ' + miss.join(', ') + '.' : '', bad.join('; ')].filter(Boolean).join(' ');
};
function AgentChips({ ag, compact }) {
  if (!ag || !ag.st) return null;
  const fit = ag.fit && AG_FIT[ag.fit.level];
  const risk = ag.risk && ag.risk.level;
  return html`<span className="agchips">
    <span className=${'chip ' + (AG_TONE[ag.st] || '')}>${compact ? (AG_ST[ag.st] || ag.st).replace(': you decide', '') : AG_ST[ag.st] || ag.st}</span>
    ${fit && html`<span className=${'chip ' + fit[1]} title=${(ag.fit.why || []).join(' · ')}>${fit[0]}${ag.fit.v != null ? ' · ' + ag.fit.v : ''}</span>`}
    ${risk && html`<span className=${'chip ' + AG_RISK_TONE[risk]} title=${((ag.risk.flags || []).map(f => f.t) || []).join(' · ')}>${risk === 'low' ? 'Low risk' : risk === 'medium' ? 'Some risk' : 'High risk'}</span>`}
  </span>`;
}
/* One candidate as the agent sees them: fit, risk, the verification, what they answered, and the decisions. */
function AgentPanel({ id, onChanged }) {
  const toast = useToast();
  const [c, setC] = useState(null);
  const [busy, setBusy] = useState('');
  const [fake, setFake] = useState(null);
  const load = () => api('ag_get', { id }).then(r => setC(r.c), e => toast(errText(e), true));
  useEffect(() => {
    load();
  }, [id]);
  const decide = async (d, extra) => {
    setBusy(d);
    try {
      const r = await api('ag_decide', { id, d, ...(extra || {}) });
      setC(r.c);
      setFake(null);
      toast({ reject_email: 'Rejected; the "not a match" email went out.', reject: 'Rejected without an email.', keep: 'Kept in the talent pool.', ask: 'Asked for the details.', resend: 'A new link went out.', verified: 'Marked verified.', stop: 'Reminders stopped.', fake: 'Marked fake; their email, phone and LinkedIn are flagged from now on.' }[d] || 'Done.');
      onChanged && onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const screen = async () => {
    setBusy('screen');
    try {
      const r = await api('ag_screen', { id }, { timeout: 150000 });
      setC(r.c);
      toast('Screened.');
      onChanged && onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const copyLink = async () => {
    try {
      const r = await api('ag_link', { id });
      copyText(toast, r.url);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  if (!c) return html`<${Spinner} />`;
  const ag = c.ag || {};
  const fit = ag.fit || null;
  const risk = ag.risk || null;
  const ans = ag.ans || null;
  const docs = (c.files || []).filter(f => /^verify/.test(f.c || ''));
  const waiting = ['asked', 'reminded'].includes(ag.st);
  const agLog = (c.log || []).filter(l => l.who === 'StratEdge AI agent' || /agent/i.test(l.ev || '')).slice(-12).reverse();
  return html`<div className="stack agpanel">
    ${
      !ag.st
        ? html`<div className="note info"><span>The agent has not looked at ${c.n} yet${c.at ? ' (added ' + fmtDay(c.at) + ')' : ''}. It screens new candidates by itself once it is on; you can ask it now.</span></div>
          <div className="actions"><button type="button" className="btn" disabled=${!!busy} onClick=${screen}><${Icon} n="shield" />${busy === 'screen' ? 'Screening…' : 'Screen now'}</button></div>`
        : html`<div className="actions" style=${{ alignItems: 'center' }}><${AgentChips} ag=${ag} /><span className="muted small">${AG_VIA[c.via] || ''}${c.src ? ' · ' + c.src : ''}${c.vend && c.vend.e ? ' · from ' + (c.vend.n || c.vend.e) : ''}</span></div>`
    }
    ${ag.err && html`<div className="note amber"><span>${ag.err}.</span></div>`}
    ${
      ag.st === 'notfit' &&
      html`<div className="note red"><span><b>Not a match on paper: you decide.</b> ${agWhyNot(fit)} The agent never emails a "no" by itself.</span></div>
        <div className="actions">
          <button type="button" className="btn" disabled=${!!busy} onClick=${() => decide('reject_email')}>${busy === 'reject_email' ? 'Sending…' : 'Reject and send "not a match"'}</button>
          <button type="button" className="btn ghost" disabled=${!!busy} onClick=${() => decide('reject')}>Reject, no email</button>
          <button type="button" className="btn ghost" disabled=${!!busy} onClick=${() => decide('keep')}>Keep in the pool</button>
          <button type="button" className="btn ghost" disabled=${!!busy} onClick=${() => decide('ask')}>Ask for details anyway</button>
        </div>`
    }
    ${
      ag.st === 'review' &&
      html`<div className="note amber"><span><b>Needs a recruiter.</b> ${(risk && risk.flags ? risk.flags.slice(0, 3).map(f => f.t) : []).join('; ') || 'Check the details below.'}</span></div>
        <div className="actions">
          <button type="button" className="btn" disabled=${!!busy} onClick=${() => decide('verified')}>Looks fine: mark verified</button>
          <button type="button" className="btn ghost" disabled=${!!busy} onClick=${() => decide('resend')}>Send a new link</button>
          <button type="button" className="btn ghost danger" disabled=${!!busy} onClick=${() => setFake({ why: (risk && risk.flags && risk.flags[0] && risk.flags[0].t) || '' })}>Mark fake…</button>
        </div>`
    }
    ${ag.st === 'verified' && html`<div className="note ok"><span><b>Verified.</b> Details confirmed${ag.quiz != null ? ', role answers ' + ag.quiz + ' of 5' : ''}${risk ? ', ' + risk.level + ' risk' : ''}. Ready for you to submit.</span></div>`}
    ${
      waiting &&
      html`<div className="note info"><span>Waiting for ${ag.toVendor ? 'the vendor (' + ag.to + ')' : ag.to || c.e}: sent ${fmtTs(ag.sent)}${ag.rem ? ', ' + ag.rem + ' reminder' + (ag.rem === 1 ? '' : 's') : ''}${ag.opened ? ', opened ' + fmtTs(ag.opened) : ', not opened yet'}. The link works until ${fmtTs(ag.exp)}.</span></div>
        <div className="actions">
          <button type="button" className="btn ghost sm" onClick=${copyLink}><${Icon} n="send" />Copy their link</button>
          <button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => decide('resend')}>Send a new link</button>
          <button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => decide('stop')}>Stop reminders</button>
        </div>`
    }
    ${['noreply', 'stopped', 'kept', 'closed'].includes(ag.st) && html`<div className="actions"><button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => decide('resend')}>Send a new link</button><button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${screen}>Screen again</button></div>`}
    <div className="row2">
      ${
        fit &&
        html`<div className="panel agbox">
          <b>Fit for ${c.jt || (ag.best && ag.best.jt) || 'the talent pool'}</b>
          <div className="agscore"><span className=${'num ' + (fit.v >= 70 ? 'ok' : fit.v >= 45 ? 'amber' : 'red')}>${fit.v}</span><span className="muted small">${(AG_FIT[fit.level] || [fit.level])[0]} · ${fit.by === 'ai' ? 'StratEdge AI and the fit score' : 'fit score'}</span></div>
          ${fit.summary && html`<p className="small" style=${{ margin: '6px 0' }}>${fit.summary}</p>`}
          ${(fit.must || []).length ? html`<ul className="aglist">${fit.must.map((m, i) => html`<li key=${i}><span className=${'chip ' + (m.met === 'yes' ? 'ok' : m.met === 'partial' ? 'amber' : 'red')}>${m.met}</span> <b>${m.req}</b>${m.ev ? html`<span className="muted"> · ${m.ev}</span>` : ''}</li>`)}</ul>` : ''}
          ${(fit.why || []).length ? html`<div className="muted small">${fit.why.join(' · ')}</div>` : ''}
          ${ag.best && !c.job && html`<div className="small">Best open job: <b>${ag.best.jt}</b> (fit ${ag.best.v})</div>`}
        </div>`
      }
      ${
        risk &&
        html`<div className="panel agbox">
          <b>Fake-profile check</b>
          <div className="agscore"><span className=${'num ' + AG_RISK_TONE[risk.level]}>${risk.level === 'low' ? 'Low' : risk.level === 'medium' ? 'Some' : 'High'}</span><span className="muted small">risk${risk.v ? ' · ' + risk.v + ' points' : ''}</span></div>
          ${(risk.flags || []).length ? html`<ul className="aglist">${risk.flags.map((f, i) => html`<li key=${i}><span className=${'chip ' + (f.sev === 'high' ? 'red' : f.sev === 'medium' ? 'amber' : '')}>${f.sev}</span> ${f.t}</li>`)}</ul>` : html`<p className="muted small" style=${{ margin: '6px 0 0' }}>Nothing found: no shared phone, email, LinkedIn or resume, no throwaway email, the timeline adds up.</p>`}
        </div>`
      }
    </div>
    ${
      ans &&
      html`<div className="panel agbox">
        <b>What they sent${ans.via === 'email' ? ' (by email)' : ''}${ag.ansAt ? ' · ' + fmtTs(ag.ansAt) : ''}${ag.secs ? ' · took ' + Math.round(ag.secs / 60) + ' min' : ''}</b>
        <table className="tbl small" style=${{ marginTop: 6 }}><tbody>
          ${[['Phone', ans.ph], ['Lives in', ans.loc], ['Work authorization', ans.auth + (ans.authUntil ? ' until ' + ans.authUntil : '')], ['Available', ans.avail], ['Rate', ans.rate], ['Employer', ans.emp], ['Relocate', ans.reloc], ['LinkedIn', ans.li]].filter(([, v]) => v && String(v).trim()).map(([k, v]) => html`<tr key=${k}><td>${k}</td><td>${k === 'LinkedIn' ? html`<a href=${/^https?:/.test(v) ? v : 'https://' + v} target="_blank" rel="noopener noreferrer">${v}</a>` : v}</td></tr>`)}
        </tbody></table>
        ${(ans.refs || []).length ? html`<div className="small" style=${{ marginTop: 8 }}><b>References</b><ul className="aglist">${ans.refs.map((r, i) => html`<li key=${i}><b>${r.n}</b>${r.ti ? ', ' + r.ti : ''}${r.co ? ' at ' + r.co : ''}${r.rel ? ' (' + r.rel + ')' : ''} · ${[r.e, r.ph].filter(Boolean).join(' · ')}</li>`)}</ul></div>` : ''}
        ${(ag.qa || []).length ? html`<div className="small" style=${{ marginTop: 8 }}><b>Role questions${ag.quiz != null ? ' · ' + ag.quiz + ' of 5' : ''}</b>${ag.qa.map((x, i) => html`<div key=${i} className="agqa"><div><b>${i + 1}. ${x.q}</b> ${x.s != null && html`<span className=${'chip ' + (x.s >= 4 ? 'ok' : x.s >= 2 ? 'amber' : 'red')}>${x.s}/5</span>`}${x.paste ? html` <span className="chip" title="Pasted into the box">pasted</span>` : ''}</div><div style=${{ whiteSpace: 'pre-wrap' }}>${x.a}</div>${x.note && html`<div className="muted">${x.note}${x.look ? ' · looked for: ' + x.look : ''}</div>`}</div>`)}</div>` : ''}
        ${docs.length ? html`<div className="small" style=${{ marginTop: 8 }}><b>Documents</b> (deleted automatically after the days set in Settings)<ul className="files" style=${{ marginTop: 6 }}>${docs.map(f => html`<li key=${f.id}><${Icon} n="file" /><div className="fn"><b>${f.n}</b><span className="muted small"> · ${f.c === 'verify-id' ? 'photo ID' : 'work authorization'} · ${fmtDay(f.at)}</span></div><${FileActions} base=${'ats/' + c.id} f=${{ id: f.id, n: f.n, ty: '' }} /></li>`)}</ul></div>` : ''}
      </div>`
    }
    ${
      ag.st &&
      !['fake'].includes(ag.st) &&
      ag.st !== 'review' &&
      html`<div className="actions"><button type="button" className="btn ghost sm danger" disabled=${!!busy} onClick=${() => setFake({ why: (risk && risk.flags && risk.flags[0] && risk.flags[0].t) || '' })}>Mark fake…</button></div>`
    }
    ${agLog.length ? html`<details className="small"><summary>What the agent did</summary><ul className="list">${agLog.map((l, i) => html`<li key=${i}><div><div className="t">${l.ev}</div></div><span className="muted small num">${fmtTs(l.t)}</span></li>`)}</ul></details>` : ''}
    ${
      fake &&
      html`<${Modal} title=${'Mark ' + c.n + ' as fake'} onClose=${() => setFake(null)} foot=${html`<button type="button" className="btn ghost" onClick=${() => setFake(null)}>Cancel</button><button type="button" className="btn danger" disabled=${!!busy} onClick=${() => decide('fake', { why: fake.why })}>Mark fake</button>`}>
          <div className="form">
            <p className="small" style=${{ marginTop: 0 }}>The candidate moves to "not selected" (no email), and their email, phone and LinkedIn go on the blocklist: anyone who uses them again is flagged and never emailed by the agent.</p>
            <${Field} label="Why (for your team)"><input value=${fake.why} onInput=${e => setFake({ ...fake, why: e.target.value })} placeholder="Same phone as another candidate; references did not exist" /><//>
          </div>
        <//>`
    }
  </div>`;
}
function AgentSettings({ ov, onSaved }) {
  const P = usePortal();
  const toast = useToast();
  const [c, setC] = useState(JSON.parse(JSON.stringify(ov.cfg)));
  const [busy, setBusy] = useState(false);
  const [tpl, setTpl] = useState('ask');
  const people = kitPeople(P);
  const set = (k, v) => setC({ ...c, [k]: v });
  const sub = (k, kk, v) => setC({ ...c, [k]: { ...c[k], [kk]: v } });
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('ag_cfg_save', { cfg: c });
      setC(r.cfg);
      toast('Saved.');
      onSaved && onSaved();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const T = c.tpl[tpl] || { s: '', b: '' };
  return html`<div className="stack form">
    <section className="panel">
      <h3 className="ph">Who the agent screens</h3>
      <div className="portalpicks wide">
        ${[['web', 'Website and portal applications'], ['inbox', 'Resumes emailed to the company inbox (people, vendors, Dice and other boards)'], ['staff', 'Candidates your team adds, uploads or imports']].map(([k, n]) => html`<label key=${k} className=${'pick' + (c.src[k] ? ' on' : '')}><input type="checkbox" checked=${!!c.src[k]} onChange=${e => sub('src', k, e.target.checked)} /><span>${n}</span></label>`)}
      </div>
      <p className="muted small">Only candidates added after the agent is switched on are screened by themselves; for anyone older, open them and press "Screen now".</p>
    </section>
    <section className="panel">
      <h3 className="ph">What candidates are asked to confirm</h3>
      <div className="portalpicks wide">
        ${[['basics', 'Phone, location, work authorization and expiry, rate, availability, employer'], ['refs', 'LinkedIn and two references'], ['quiz', 'A few questions about the job (StratEdge AI writes them from the job and the resume)'], ['docs', 'A copy of their work authorization (and an optional photo ID)']].map(([k, n]) => html`<label key=${k} className=${'pick' + (c.ask[k] ? ' on' : '')}><input type="checkbox" checked=${!!c.ask[k]} onChange=${e => sub('ask', k, e.target.checked)} /><span>${n}</span></label>`)}
      </div>
      <div className="row3">
        <${Field} label="Keep document copies for (days)"><input type="number" min="7" max="365" value=${c.keepDocs} onInput=${e => set('keepDocs', e.target.value)} /><//>
        <${Field} label="Vendor submissions"><select value=${c.vendor ? '1' : ''} onChange=${e => set('vendor', !!e.target.value)}><option value="1">Ask the vendor who sent them</option><option value="">Ask the candidate directly</option></select><//>
        <${Field} label="Replies go to" hint="Leave empty for the company address (replies are read by the agent)."><input type="email" value=${c.replyTo} onInput=${e => set('replyTo', e.target.value)} placeholder="jobs@yourdomain.com" /><//>
      </div>
    </section>
    <section className="panel">
      <h3 className="ph">Qualified or not, reminders, limits</h3>
      <div className="row3">
        <${Field} label="Qualified from (fit score)"><input type="number" min="30" max="100" value=${c.qualify} onInput=${e => set('qualify', e.target.value)} /><//>
        <${Field} label="Possible match from" hint="Below this: not a match (a recruiter decides)."><input type="number" min="0" max="95" value=${c.maybe} onInput=${e => set('maybe', e.target.value)} /><//>
        <${Field} label="Automatic emails a day (most)"><input type="number" min="1" max="2000" value=${c.cap} onInput=${e => set('cap', e.target.value)} /><//>
      </div>
      <div className="row3">
        <${Field} label="Remind after (hours)"><input type="number" min="4" max="168" value=${c.remind} onInput=${e => set('remind', e.target.value)} /><//>
        <${Field} label="Reminders (most)"><input type="number" min="0" max="5" value=${c.reminders} onInput=${e => set('reminders', e.target.value)} /><//>
        <${Field} label="The link works for (days)"><input type="number" min="1" max="30" value=${c.expire} onInput=${e => set('expire', e.target.value)} /><//>
      </div>
      <label className="check"><input type="checkbox" checked=${!!c.move} onChange=${e => set('move', e.target.checked)} /><span>Move verified, qualified candidates to the job's screening stage</span></label>
      <${Field} label="Who gets the agent's tasks" hint="Nobody picked: the job's hiring team (recruiter, coordinator, hiring manager).">
        <div className="portalpicks wide">${people.map(([id, n]) => html`<label key=${id} className=${'pick' + (c.notify.includes(id) ? ' on' : '')}><input type="checkbox" checked=${c.notify.includes(id)} onChange=${e => set('notify', e.target.checked ? [...c.notify, id] : c.notify.filter(x => x !== id))} /><span>${n}</span></label>`)}</div>
      <//>
    </section>
    <section className="panel">
      <h3 className="ph">The emails</h3>
      <div className="seg">${[['ask', 'Request'], ['remind', 'Reminder'], ['vendor', 'To a vendor'], ['notfit', 'Not a match']].map(([k, n]) => html`<button key=${k} type="button" className=${tpl === k ? 'on' : ''} onClick=${() => setTpl(k)}>${n}</button>`)}</div>
      <${Field} label="Subject"><input value=${T.s} onInput=${e => setC({ ...c, tpl: { ...c.tpl, [tpl]: { ...T, s: e.target.value } } })} /><//>
      <${Field} label="Message" hint=${'Fill-ins: {first} {name} {job} {where} {expires} {ref} {sender}. The "Confirm my details" button is added below the message' + (tpl === 'notfit' ? ' (not for this one).' : '.') + ' Keep (Ref {ref}) in the subject: replies are matched by it.'}><textarea rows="8" value=${T.b} onInput=${e => setC({ ...c, tpl: { ...c.tpl, [tpl]: { ...T, b: e.target.value } } })} /><//>
    </section>
    <div className="actions"><button type="button" className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save settings'}</button></div>
  </div>`;
}
function AgentBlocklist() {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [f, setF] = useState({ k: 'email', v: '', why: '' });
  const load = () => api('ag_blocklist').then(r => setItems(r.items), e => toast(errText(e), true));
  useEffect(() => {
    load();
  }, []);
  const op = async (o, extra) => {
    try {
      const r = await api('ag_block', { op: o, ...extra });
      setItems(r.items);
      if (o === 'add') setF({ ...f, v: '', why: '' });
    } catch (e) {
      toast(errText(e), true);
    }
  };
  if (!items) return html`<${Spinner} />`;
  return html`<div className="stack">
    <p className="muted small" style=${{ margin: 0 }}>Anyone who applies with one of these is flagged as high risk and never emailed by the agent. "Mark fake" on a candidate adds their email, phone and LinkedIn here.</p>
    <div className="panel form"><div className="row3">
      <${Field} label="Block"><select value=${f.k} onChange=${e => setF({ ...f, k: e.target.value })}><option value="email">Email address</option><option value="phone">Phone number</option><option value="li">LinkedIn profile</option><option value="domain">Email domain</option></select><//>
      <${Field} label="Value"><input value=${f.v} onInput=${e => setF({ ...f, v: e.target.value })} /><//>
      <${Field} label="Why"><input value=${f.why} onInput=${e => setF({ ...f, why: e.target.value })} /><//>
    </div><div className="actions"><button type="button" className="btn" onClick=${() => op('add', f)}>Add to the blocklist</button></div></div>
    ${items.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>What</th><th>Value</th><th>Why</th><th>By</th><th></th></tr></thead><tbody>${items.map((x, i) => html`<tr key=${i}><td>${{ email: 'Email', phone: 'Phone', li: 'LinkedIn', domain: 'Domain' }[x.k] || x.k}</td><td>${x.v}</td><td className="small">${x.why}</td><td className="small">${x.by} · ${fmtDay(x.at)}</td><td><button type="button" className="btn ghost sm" onClick=${() => op('remove', { k: x.k, v: x.v, at: x.at })}>Remove</button></td></tr>`)}</tbody></table></div>` : html`<${Empty} title="Nothing blocked yet" />`}
  </div>`;
}
function AgentPage({ q }) {
  const toast = useToast();
  const [ov, setOv] = useState(null);
  const [tab, setTab] = useState((q && q.tab) || 'you');
  const [rows, setRows] = useState(null);
  const [log, setLog] = useState(null);
  const [open, setOpen] = useState((q && q.c) || null);
  const [busy, setBusy] = useState('');
  const [qs, setQs] = useState('');
  // v83: an answer for a tab that is no longer selected is dropped (a quick switch could show the wrong tab's rows)
  const tabNow = useRef(tab);
  tabNow.current = tab;
  const loadOv = () => api('ag_overview').then(setOv, e => toast(errText(e), true));
  const loadRows = t => {
    if (['you', 'wait', 'done', 'all'].includes(t)) api('ag_list', { tab: t }).then(r => { if (tabNow.current === t) setRows(r.rows); }, e => toast(errText(e), true));
    if (t === 'log') api('ag_log').then(r => { if (tabNow.current === t) setLog(r.rows); }, e => toast(errText(e), true));
  };
  useEffect(() => {
    loadOv();
  }, []);
  useEffect(() => {
    setRows(null);
    loadRows(tab);
  }, [tab]);
  const refresh = () => {
    loadOv();
    loadRows(tab);
  };
  const toggle = async on => {
    setBusy('on');
    try {
      await api('ag_cfg_save', { cfg: { on } });
      toast(on ? 'The agent is on: new candidates are screened from now on.' : 'The agent is off.');
      refresh();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const run = async () => {
    setBusy('run');
    try {
      const r = await api('ag_run', {}, { timeout: 180000 });
      const o = r.out || {};
      toast(o.busy ? 'The agent is already running; try again in a minute.' : `Done: ${o.screened || 0} screened, ${o.reminded || 0} reminded, ${o.inbox || 0} inbox messages read${o.left ? ', ' + o.left + ' still queued' : ''}.`);
      refresh();
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  if (!ov) return html`<div className="panel"><${Spinner} /></div>`;
  const n = ov.counts || {};
  const youN = (n.notfit || 0) + (n.review || 0) + (n.verified || 0);
  const waitN = (n.new || 0) + (n.asked || 0) + (n.reminded || 0) + (n.answered || 0);
  const shown = (rows || []).filter(r => !qs.trim() || [r.n, r.e, r.jt, r.src].join(' ').toLowerCase().includes(qs.trim().toLowerCase()));
  return html`<div className="stack">
    <section className=${'panel agtop' + (ov.cfg.on ? ' on' : '')}>
      <div className="agtophead">
        <div>
          <h3 style=${{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><img className="aimark" src="assets/ai-mark.png" alt="" width="22" height="22" />StratEdge AI screening agent <span className=${'chip ' + (ov.cfg.on ? 'ok' : '')}>${ov.cfg.on ? 'On' : 'Off'}</span></h3>
          <p className="muted small" style=${{ margin: '4px 0 0' }}>Checks every new candidate against the job and for signs of a fake profile, emails them a secure link to confirm their details, references, role questions and work authorization, reminds them, and files them as verified or "needs a recruiter". "Not a match" always waits for you.</p>
        </div>
        <div className="actions">
          ${ov.cfg.on ? html`<button type="button" className="btn ghost" disabled=${!!busy} onClick=${run}>${busy === 'run' ? 'Running…' : 'Run now'}</button>` : ''}
          <button type="button" className=${'btn' + (ov.cfg.on ? ' ghost' : '')} disabled=${!!busy} onClick=${() => toggle(!ov.cfg.on)}>${ov.cfg.on ? 'Switch off' : 'Switch the agent on'}</button>
        </div>
      </div>
      <div className="muted small agstatus">
        <span>${ov.ai ? '✓ StratEdge AI reads candidates and answers' : '○ StratEdge AI is not set up: the agent uses the fit score and its own checks'}</span>
        <span>${ov.mail ? '✓ Email is ready' : '✗ Email is not set up (Admin › Email): nothing can be sent'}</span>
        <span>${ov.ran ? 'Last run ' + fmtTs(ov.ran) : 'Has not run yet'} · ${ov.sentToday} emails today (most ${ov.cfg.cap})</span>
      </div>
    </section>
    <${KitStats} items=${[
      { v: youN, l: 'Need you', tone: youN ? 'amber' : '', onClick: () => setTab('you') },
      { v: waitN, l: 'Waiting on candidates', onClick: () => setTab('wait') },
      { v: n.verified || 0, l: 'Verified', tone: 'ok', onClick: () => setTab('you') },
      { v: (n.review || 0) + (n.fake || 0), l: 'Flagged or fake', tone: (n.review || 0) + (n.fake || 0) ? 'red' : '', onClick: () => setTab('all') },
    ]} />
    <${KitTabs} wrap tabs=${[['you', 'Needs you', youN || null], ['wait', 'Waiting', waitN || null], ['done', 'Closed'], ['all', 'All'], ['log', 'Activity'], ['cfg', 'Settings'], ['block', 'Blocklist']]} tab=${tab} onTab=${setTab} />
    ${
      ['you', 'wait', 'done', 'all'].includes(tab) &&
      (rows === null
        ? html`<div className="panel"><${Spinner} /></div>`
        : html`<section className="panel">
            <div className="actions" style=${{ marginBottom: 8 }}><input value=${qs} onInput=${e => setQs(e.target.value)} placeholder="Search name, email, job, source" style=${{ maxWidth: 320 }} aria-label="Search" /></div>
            ${
              shown.length
                ? html`<ul className="list aglistrows">${shown.map(r => html`<li key=${r.id} className="click" tabIndex="0" onClick=${() => setOpen(r.id)} onKeyDown=${e => { if (e.key === 'Enter') setOpen(r.id); }}>
                    <div style=${{ minWidth: 0 }}>
                      <div className="t"><b>${r.n}</b> <span className="muted small">${r.jt || (r.ag.best ? 'best fit: ' + r.ag.best.jt : 'no job')}</span></div>
                      <div className="m">${AG_VIA[r.via] || ''}${r.src ? ' · ' + r.src : ''}${r.ag.risk && (r.ag.risk.flags || []).length ? ' · ' + r.ag.risk.flags[0].t : ''}</div>
                    </div>
                    <div className="actions" style=${{ gap: 6, justifyContent: 'flex-end' }}><${AgentChips} ag=${r.ag} compact /><span className="muted small num">${fmtTs(r.ag.u || r.at)}</span></div>
                  </li>`)}</ul>`
                : html`<${Empty} title=${tab === 'you' ? 'Nothing needs you right now' : 'Nobody here'}>${!ov.cfg.on ? 'Switch the agent on to start screening new candidates.' : ''}<//>`
            }
          </section>`)
    }
    ${tab === 'log' && (log === null ? html`<${Spinner} />` : html`<section className="panel">${log.length ? html`<ul className="list">${log.map((l, i) => html`<li key=${i} className=${l.cid ? 'click' : ''} onClick=${() => l.cid && setOpen(l.cid)}><div><div className="t">${l.ev}</div><div className="m">${l.n}</div></div><span className="muted small num">${fmtTs(l.t)}</span></li>`)}</ul>` : html`<${Empty} title="No activity yet" />`}</section>`)}
    ${tab === 'cfg' && html`<${AgentSettings} ov=${ov} onSaved=${loadOv} />`}
    ${tab === 'block' && html`<${AgentBlocklist} />`}
    ${open && html`<${Modal} wide title="Candidate" onClose=${() => setOpen(null)} foot=${html`<a className="btn ghost" href=${'#/portal/' + ((location.hash.match(/#\/portal\/([a-z]+)/) || [])[1] || 'admin') + '/ats?c=' + encodeURIComponent(open)}>Open in the ATS</a><button type="button" className="btn" onClick=${() => setOpen(null)}>Close</button>`}><${AgentPanel} id=${open} onChanged=${refresh} /><//>`}
  </div>`;
}
