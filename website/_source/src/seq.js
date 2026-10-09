/* ================= v46 Sequences (in js/work.js, fetched when opened) =================
   Follow-up emails and call/LinkedIn tasks that go out by themselves from the sender's own mailbox (My email), one
   person at a time, until the person replies, unsubscribes, bounces or their lead is closed. Each email goes out inside
   the sending hours of the person's own time zone (or the company's), on weekdays, not on US federal holidays. Replies
   are sorted (interested, not now, not interested, wrong person, asked to stop, out of office); an email step can test
   two versions (A/B); templates fill a step; website leads can join by themselves; people come from the CRM, pasted
   lines or a CSV file; many can be paused, stopped or moved at once; Analytics shows each step, sender and sequence.
   Server: api/seq.php (routes sq_*); the scheduled job sends what is due. */
const SQ_TONE = { active: 'info', task: 'amber', paused: '', replied: 'ok', finished: '', stopped: '', bounced: 'red', unsub: 'red', error: 'red' };
const SQ_CLS_TONE = { interested: 'ok', later: 'amber', no: '', wrong: 'amber', unsub: 'red', ooo: 'info', other: 'info' };
const sqWhen = t => (t ? fmtTs(t) : '–');
const sqBlankEmail = first => ({ id: '', kind: 'email', wait: first ? 0 : 3, subj: '', body: first ? 'Hi {first_name},\n\n\n\nBest,\n{my_name}' : 'Hi {first_name},\n\n\n\n{my_name}', thread: !first });
const sqHasB = x => !!x && x.kind === 'email' && (!!String(x.subjB || '').trim() || !!String(x.bodyB || '').trim());
const sqPct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const sqTzName = (home, tz) => (tz ? ((home.tzs || []).find(x => x[0] === tz) || [])[1] || tz : 'Company time');
/** A moment in someone's own time zone ("Wed 9:00 AM"), or '' when the browser cannot tell. */
const sqTheirTime = (ms, tz) => {
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(ms));
  } catch (e) {
    return '';
  }
};
/* My email in whichever portal the person is in (staff portals have their own), opened to someone */
const sqMailHref = to => {
  const m = location.hash.split('?')[0].match(/^#\/portal\/(admin|hr|acct|manager)(\/|$)/);
  return (m ? `#/portal/${m[1]}/mymail` : '#/portal/mymail') + (to ? '?to=' + encodeURIComponent(to) : '');
};
const sqCsvCell = v => {
  const s = String(v == null ? '' : v);
  return '"' + (/^\s*[=+@-]/.test(s) ? "'" + s : s).replace(/"/g, '""') + '"';
};
/** A CSV (or semicolon / tab separated) file as rows of cells. */
function sqCsvRows(text) {
  const first = (text.split(/\r?\n/)[0] || '').replace(/"[^"]*"/g, '');
  const counts = [',', ';', '\t'].map(d => [d, first.split(d).length]);
  const sep = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some(c => c.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some(c => c.trim() !== '')) rows.push(row);
  return rows;
}
/** People from a CSV file: the columns found by their headings (email, name or first and last name, company, time zone, location). */
function sqCsvPeople(text) {
  const rows = sqCsvRows(text.replace(/^﻿/, ''));
  if (!rows.length) return { people: [], cols: [], bad: 0 };
  const head = rows[0].map(h => h.trim().toLowerCase().replace(/[_]+/g, ' '));
  const find = re => head.findIndex(h => re.test(h));
  let ie = find(/^(e-?mail|email address|e-?mail address|work e-?mail|business e-?mail)$/);
  const hasHead = ie >= 0 || head.some(h => /^(name|full name|first name|company|time ?zone)$/.test(h));
  const body = hasHead ? rows.slice(1) : rows;
  if (ie < 0) ie = (body[0] || []).findIndex(c => /@/.test(c));
  const ix = {
    n: hasHead ? find(/^(name|full name|contact|contact name|person)$/) : -1,
    first: hasHead ? find(/^(first|first name|firstname|given name)$/) : -1,
    last: hasHead ? find(/^(last|last name|lastname|surname|family name)$/) : -1,
    co: hasHead ? find(/^(company|company name|organi[sz]ation|account|account name|employer|client)$/) : -1,
    tz: hasHead ? find(/^(time ?zone|tz)$/) : -1,
  };
  const locIx = hasHead ? head.map((h, i) => (/^(location|city|state|city, state|region|province)$/.test(h) ? i : -1)).filter(i => i >= 0) : [];
  let bad = 0;
  const people = [];
  for (const r of body.slice(0, 5000)) {
    const email = String(r[ie] || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      bad++;
      continue;
    }
    const cell = i => (i >= 0 ? String(r[i] || '').trim() : '');
    people.push({ email, n: cell(ix.n) || [cell(ix.first), cell(ix.last)].filter(Boolean).join(' '), co: cell(ix.co), tz: cell(ix.tz), loc: locIx.map(cell).filter(Boolean).join(', ') });
  }
  const cols = ['email', ix.n >= 0 || ix.first >= 0 ? 'name' : '', ix.co >= 0 ? 'company' : '', ix.tz >= 0 ? 'time zone' : '', locIx.length ? 'location' : ''].filter(Boolean);
  return { people, cols, bad };
}

function SqApp({ q }) {
  const [home, setHome] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState((q && q.t) || 'seqs');
  const [open, setOpen] = useState((q && q.s) || '');
  const [edit, setEdit] = useState(null);
  const [tick, setTick] = useState(0);
  const load = () =>
    api('sq_home')
      .then(setHome)
      .catch(setErr);
  useEffect(() => {
    load();
  }, [tick]);
  if (err && !home) return html`<${LoadError} error=${err} onRetry=${load} />`;
  if (!home) return html`<${Spinner} label="Loading sequences…" />`;
  const reload = () => setTick(t => t + 1);
  return html`<div className="stack sqpage">
      ${
        home.mailbox
          ? html`<div className="note"><span>Sequence emails go out from <b>${home.mailbox.email}</b> (My email)${home.mailbox.replies ? '; a reply there takes the person out of the sequence, sorted by what it says.' : '. Replies are only read from Gmail or Microsoft 365 mailboxes: mark replies by hand, or connect one of those.'}</span></div>`
          : html`<div className="note amber"><span>Connect your mailbox in My email first: sequence emails go out from it and replies come back to it.</span><a className="btn sm" href=${sqMailHref('')}>Open My email</a></div>`
      }
      <${KitTabs} tabs=${[['seqs', 'Sequences'], ['tasks', 'My tasks', home.tasks || null], ['tpls', 'Templates'], ['stats', 'Analytics']]} tab=${tab} onTab=${setTab} />
      ${tab === 'seqs' && html`<${SqList} home=${home} onOpen=${setOpen} onNew=${() => setEdit({})} />`}
      ${tab === 'tasks' && html`<${SqTasks} onChanged=${reload} />`}
      ${tab === 'tpls' && html`<${SqTemplates} home=${home} onUse=${t => setEdit({ n: t.n, steps: [{ ...sqBlankEmail(true), subj: t.subj, body: t.body }] })} />`}
      ${tab === 'stats' && html`<${SqAnalytics} home=${home} onOpen=${setOpen} />`}
      ${open && html`<${SqDetail} id=${open} home=${home} onClose=${() => setOpen('')} onEdit=${s => (setOpen(''), setEdit(s))} onChanged=${reload} />`}
      ${edit && html`<${SqEditor} s=${edit} home=${home} onClose=${() => setEdit(null)} onSaved=${s => (setEdit(null), reload(), setOpen(s.id))} />`}
    </div>`;
}

function SqList({ home, onOpen, onNew }) {
  return html`<div className="stack">
      <div className="ph-row"><div className="muted small">A sequence is a series of emails (and call or LinkedIn tasks), each some days after the one before. People you add get each step from your mailbox, in their own working hours, until they reply. Every email carries the company's postal address and an unsubscribe link.</div><button className="btn" onClick=${onNew}><${Icon} n="plus" />New sequence</button></div>
      ${
        home.seqs.length
          ? html`<div className="sqgrid">${home.seqs.map(s => {
              const emails = s.steps.filter(x => x.kind === 'email').length;
              return html`<button key=${s.id} type="button" className="sqcard" onClick=${() => onOpen(s.id)}>
                <div className="sqhead"><b>${s.n}</b>${s.st !== 'active' ? html`<${Chip}>${s.st}<//>` : null}${s.shared ? html`<${Chip} s="info">shared<//>` : null}${s.steps.some(sqHasB) ? html`<${Chip} s="new">A/B<//>` : null}${s.cfg && s.cfg.auto && s.cfg.auto.on ? html`<${Chip} s="ok">website leads<//>` : null}</div>
                <div className="muted small">${s.steps.length} step${s.steps.length === 1 ? '' : 's'} · ${emails} email${emails === 1 ? '' : 's'}${s.mine ? '' : ' · by ' + s.ownerN}</div>
                <div className="sqnums"><span><b>${(s.stats.by.active || 0) + (s.stats.by.task || 0)}</b> in progress</span><span><b>${s.stats.replied || s.stats.by.replied || 0}</b> replied</span><span><b>${s.stats.replyRate}%</b> reply rate</span>${(s.stats.cls || {}).interested ? html`<span><b>${s.stats.cls.interested}</b> interested</span>` : null}</div>
              </button>`;
            })}</div>`
          : html`<${Empty} title="No sequences yet">Write one for a kind of outreach you repeat, for example: introduce your bench to a hiring manager, a follow-up three days later in the same thread, a LinkedIn connection task, and a last note a week after that. Templates has a few to start from.<//>`
      }
    </div>`;
}

/* The template picker and "Save as a template" of one email step */
function SqStepTpl({ x, i, tpls, onPick, onSaved }) {
  const toast = useToast();
  const [save, setSave] = useState(null);
  const all = [...(tpls ? tpls.tpls : []), ...(tpls ? tpls.starters.map(t => ({ ...t, starter: true })) : [])];
  const pick = id => {
    const t = all.find(y => y.id === id);
    if (!t) return;
    onPick(t);
    if (!t.starter) api('sq_tpl_use', { id: t.id }).catch(() => {});
  };
  const go = async () => {
    try {
      const r = await api('sq_tpl_save', { n: save.n, cat: save.cat, subj: x.subj || '', body: x.body || '', shared: save.shared });
      toast('Saved as a template.');
      setSave(null);
      onSaved(r.tpl);
    } catch (e) {
      toast(errText(e), true);
    }
  };
  return html`<div className="sqtplrow">
      <select value="" aria-label=${'Step ' + (i + 1) + ' template'} onChange=${e => pick(e.target.value)} disabled=${!tpls}>
        <option value="">${tpls ? 'Fill from a template…' : 'Loading templates…'}</option>
        ${tpls && tpls.tpls.length > 0 && html`<optgroup label="Yours and the team's">${tpls.tpls.map(t => html`<option key=${t.id} value=${t.id}>${t.n}${t.cat ? ' · ' + t.cat : ''}</option>`)}</optgroup>`}
        ${tpls && html`<optgroup label="To start from">${tpls.starters.map(t => html`<option key=${t.id} value=${t.id}>${t.n}</option>`)}</optgroup>`}
      </select>
      ${save ? null : html`<button type="button" className="btn ghost sm" onClick=${() => setSave({ n: '', cat: '', shared: true })}><${Icon} n="file" />Save as a template</button>`}
      ${
        save &&
        html`<div className="sqtplsave">
          <input value=${save.n} placeholder="Template title" aria-label="Template title" onInput=${e => setSave({ ...save, n: e.target.value })} />
          <input value=${save.cat} placeholder="Kind (optional)" aria-label="Template kind" onInput=${e => setSave({ ...save, cat: e.target.value })} />
          <label className="check"><input type="checkbox" checked=${save.shared} onChange=${e => setSave({ ...save, shared: e.target.checked })} /><span>The team can use it</span></label>
          <button type="button" className="btn sm" disabled=${!save.n.trim() || !(x.body || '').trim()} onClick=${go}>Save it</button><button type="button" className="btn ghost sm" onClick=${() => setSave(null)}>Cancel</button>
        </div>`
      }
    </div>`;
}

function SqEditor({ s, home, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !s.id;
  const [f, setF] = useState({
    n: s.n || '',
    shared: !!s.shared,
    st: s.st || 'active',
    cfg: { ...home.cfg, ...(s.cfg || {}), auto: { ...home.cfg.auto, ...((s.cfg && s.cfg.auto) || {}) } },
    steps: (s.steps || [sqBlankEmail(true)]).map(x => ({ ...x, ab: sqHasB(x) })),
  });
  const [busy, setBusy] = useState(false);
  const [pv, setPv] = useState(null);
  const [tpls, setTpls] = useState(null);
  useEffect(() => {
    api('sq_tpls')
      .then(setTpls)
      .catch(() => setTpls({ tpls: [], starters: [] }));
  }, []);
  const setStep = (i, patch) => setF({ ...f, steps: f.steps.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const setCfg = patch => setF({ ...f, cfg: { ...f.cfg, ...patch } });
  const setAuto = patch => setCfg({ auto: { ...f.cfg.auto, ...patch } });
  const move = (i, d) => {
    const st = f.steps.slice();
    const [x] = st.splice(i, 1);
    st.splice(i + d, 0, x);
    setF({ ...f, steps: st });
  };
  const firstEmail = f.steps.findIndex(x => x.kind === 'email');
  const save = async () => {
    setBusy(true);
    try {
      const steps = f.steps.map(({ ab, ...x }) => (ab ? x : { ...x, subjB: '', bodyB: '', win: '' }));
      const r = await api('sq_save', { id: s.id || '', ...f, steps });
      toast(isNew ? 'Sequence saved. Add people to it next.' : 'Sequence saved.');
      onSaved(r.seq);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const preview = async (i, ab) => {
    try {
      const steps = f.steps.map(({ ab: _a, ...x }) => x);
      const r = await api('sq_preview', { seq: { steps }, step: i, ab: ab || 'a' });
      setPv({ i, v: ab || 'a', ...r.email });
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const ins = (i, k, tok) => setStep(i, { [k]: (f.steps[i][k] || '') + tok });
  const holOff = f.cfg.holOff || [];
  return html`<${Modal} wide title=${isNew ? 'New sequence' : 'Edit sequence'} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" disabled=${busy || !f.n.trim()} onClick=${save}>${busy ? 'Saving…' : 'Save'}</button>`}>
      <div className="stack form">
        <div className="row3">
          <${Field} label="Name"><input value=${f.n} onInput=${e => setF({ ...f, n: e.target.value })} placeholder="e.g. Bench intro to hiring managers" /><//>
          <${Field} label="Status"><select value=${f.st} onChange=${e => setF({ ...f, st: e.target.value })}><option value="active">Active</option><option value="paused">Paused (nothing goes out)</option></select><//>
          <label className="check" style=${{ alignSelf: 'end' }}><input type="checkbox" checked=${f.shared} onChange=${e => setF({ ...f, shared: e.target.checked })} /><span>Shared: colleagues may use it from their mailbox</span></label>
        </div>
        <span className="lbl">Steps</span>
        ${f.steps.map(
          (x, i) => html`<div key=${i} className="sqstep">
            <div className="sqstephead"><b>Step ${i + 1}</b>
              <select value=${x.kind} aria-label=${'Step ' + (i + 1) + ' kind'} onChange=${e => setStep(i, e.target.value === 'task' ? { kind: 'task', task: x.task || 'Call {first_name} at {company}' } : { ...sqBlankEmail(i === 0), kind: 'email', wait: x.wait })}><option value="email">Email</option><option value="task">Task (call, LinkedIn…)</option></select>
              <label className="sqwait">${i === 0 ? 'Days after being added' : 'Days after the step before'}<input type="number" min="0" max="60" value=${x.wait} onInput=${e => setStep(i, { wait: e.target.value })} aria-label=${'Step ' + (i + 1) + ' wait in days'} /></label>
              <span className="actions" style=${{ marginLeft: 'auto' }}><button type="button" className="btn ghost sm" disabled=${i === 0} aria-label="Move up" onClick=${() => move(i, -1)}><${Icon} n="up" /></button><button type="button" className="btn ghost sm" disabled=${i === f.steps.length - 1} aria-label="Move down" onClick=${() => move(i, 1)}><${Icon} n="down" /></button><button type="button" className="btn ghost sm" disabled=${f.steps.length === 1} aria-label=${'Remove step ' + (i + 1)} onClick=${() => setF({ ...f, steps: f.steps.filter((y, j) => j !== i) })}><${Icon} n="trash" /></button></span>
            </div>
            ${
              x.kind === 'email'
                ? html`<${SqStepTpl} x=${x} i=${i} tpls=${tpls} onPick=${t => setStep(i, x.thread && i > firstEmail ? { body: t.body } : { subj: t.subj || x.subj, body: t.body })} onSaved=${t => setTpls(tp => ({ ...tp, tpls: [...((tp && tp.tpls) || []), t] }))} />
                    ${i > firstEmail && html`<label className="check"><input type="checkbox" checked=${!!x.thread} onChange=${e => setStep(i, { thread: e.target.checked })} /><span>Reply in the same thread (subject "Re: …" of the first email)</span></label>`}
                    ${!(x.thread && i > firstEmail) && html`<${Field} label=${x.ab ? 'Subject A' : 'Subject'}><input value=${x.subj || ''} onInput=${e => setStep(i, { subj: e.target.value })} aria-label=${'Step ' + (i + 1) + ' subject'} /><//>`}
                    <${Field} label=${x.ab ? 'Message A' : 'Message'}><textarea rows="6" value=${x.body || ''} onInput=${e => setStep(i, { body: e.target.value })} aria-label=${'Step ' + (i + 1) + ' message'} /><//>
                    <label className="check"><input type="checkbox" checked=${!!x.ab} onChange=${e => setStep(i, { ab: e.target.checked, win: '' })} /><span>Test a second version (A/B): people get A or B in turn, and the numbers show which gets more replies</span></label>
                    ${
                      x.ab &&
                      html`<div className="sqab">
                        ${!(x.thread && i > firstEmail) && html`<${Field} label="Subject B"><input value=${x.subjB || ''} onInput=${e => setStep(i, { subjB: e.target.value })} aria-label=${'Step ' + (i + 1) + ' subject B'} placeholder="Leave empty to test the message only" /><//>`}
                        <${Field} label="Message B"><textarea rows="5" value=${x.bodyB || ''} onInput=${e => setStep(i, { bodyB: e.target.value })} aria-label=${'Step ' + (i + 1) + ' message B'} placeholder="Leave empty to test the subject only" /><//>
                        ${x.win && html`<div className="note ok"><span>Version ${x.win.toUpperCase()} goes to everyone now.</span><button type="button" className="btn ghost sm" onClick=${() => setStep(i, { win: '' })}>Test both again</button></div>`}
                      </div>`
                    }
                    <div className="actions sqfields"><span className="muted small">Insert:</span>${home.fields.map(k => html`<button key=${k} type="button" className="btn ghost sm" onClick=${() => ins(i, 'body', '{' + k + '}')}>{${k}}</button>`)}<span style=${{ marginLeft: 'auto' }} className="actions"><button type="button" className="btn ghost sm" onClick=${() => preview(i, 'a')}><${Icon} n="eye" />Preview</button>${x.ab && html`<button type="button" className="btn ghost sm" onClick=${() => preview(i, 'b')}><${Icon} n="eye" />Preview B</button>`}</span></div>
                    ${pv && pv.i === i && html`<div className="sqpv"><div className="small">${x.ab ? html`<${Chip} s="new">Version ${pv.v.toUpperCase()}<//> ` : null}<b>From</b> ${pv.from} · <b>Subject</b> ${pv.subj}</div><div className="sqpvbody">${pv.body}</div></div>`}`
                : html`<${Field} label="What to do"><input value=${x.task || ''} onInput=${e => setStep(i, { task: e.target.value })} aria-label=${'Step ' + (i + 1) + ' task'} /><//><p className="muted small" style=${{ margin: 0 }}>The task waits under My tasks; the sequence goes on when you mark it done or skip it.</p>`
            }
          </div>`
        )}
        ${f.steps.length < 10 && html`<div className="actions"><button type="button" className="btn ghost sm" onClick=${() => setF({ ...f, steps: [...f.steps, sqBlankEmail(false)] })}><${Icon} n="mail" />Add an email</button><button type="button" className="btn ghost sm" onClick=${() => setF({ ...f, steps: [...f.steps, { id: '', kind: 'task', wait: 2, task: 'Connect with {first_name} on LinkedIn' }] })}><${Icon} n="tasks" />Add a task</button></div>`}
        <span className="lbl">When emails go out</span>
        <div className="row3">
          <${Field} label="From (hour)"><input type="number" min="0" max="23" value=${f.cfg.from} onInput=${e => setCfg({ from: e.target.value })} /><//>
          <${Field} label="Until (hour)"><input type="number" min="1" max="24" value=${f.cfg.to} onInput=${e => setCfg({ to: e.target.value })} /><//>
          <${Field} label="At most a day from one mailbox"><input type="number" min="1" max="200" value=${f.cfg.cap} onInput=${e => setCfg({ cap: e.target.value })} /><//>
        </div>
        <${Field} label="Whose clock the hours follow"><select value=${f.cfg.tzMode} onChange=${e => setCfg({ tzMode: e.target.value })}><option value="person">Each person's own time zone, when it is known (else the company's)</option><option value="company">${'The company’s time zone (' + home.coTz + ')'}</option></select><//>
        <label className="check"><input type="checkbox" checked=${f.cfg.weekdays} onChange=${e => setCfg({ weekdays: e.target.checked })} /><span>Weekdays only</span></label>
        <label className="check"><input type="checkbox" checked=${f.cfg.hol} onChange=${e => setCfg({ hol: e.target.checked })} /><span>Not on US federal holidays (or the day after Thanksgiving), for people in US time zones</span></label>
        ${
          f.cfg.hol &&
          html`<div className="sqhol">
            <span className="muted small">Click one to send on it anyway:</span>
            ${Object.entries(home.hol).map(([k, n]) => html`<button key=${k} type="button" className=${'sqholk' + (holOff.includes(k) ? ' off' : '')} aria-pressed=${!holOff.includes(k)} onClick=${() => setCfg({ holOff: holOff.includes(k) ? holOff.filter(y => y !== k) : [...holOff, k] })}>${n}</button>`)}
            <span className="muted small">Next: ${home.holNext.filter(h => !holOff.includes(h[1])).slice(0, 3).map(h => fmtDate(h[0], { month: 'short', day: 'numeric' }) + ' ' + h[2]).join(' · ')}</span>
          </div>`
        }
        <label className="check"><input type="checkbox" checked=${f.cfg.stopLead} onChange=${e => setCfg({ stopLead: e.target.checked })} /><span>Stop when the person's lead is converted or marked unqualified</span></label>
        <span className="lbl">When someone replies</span>
        <p className="muted small" style=${{ margin: 0 }}>A reply takes the person out and is sorted by what it says: interested, not now, not interested, wrong person, asked to stop (they go on the do-not-email list) or out of office.</p>
        <div className="row3">
          <label className="check" style=${{ alignSelf: 'end' }}><input type="checkbox" checked=${f.cfg.oooKeep} onChange=${e => setCfg({ oooKeep: e.target.checked })} /><span>Out of office: keep them in, the next email waits until they are back</span></label>
          <${Field} label="Days to wait when no return date is given"><input type="number" min="1" max="30" value=${f.cfg.ooo} disabled=${!f.cfg.oooKeep} onInput=${e => setCfg({ ooo: e.target.value })} /><//>
          <${Field} label="Not now: remind me after (days, 0 for no reminder)"><input type="number" min="0" max="365" value=${f.cfg.later} onInput=${e => setCfg({ later: e.target.value })} /><//>
        </div>
        <label className="check"><input type="checkbox" checked=${f.cfg.replyTask} onChange=${e => setCfg({ replyTask: e.target.checked })} /><span>A task under My tasks to answer each reply (interested replies always get one)</span></label>
        <span className="lbl">Website leads</span>
        <label className="check"><input type="checkbox" checked=${f.cfg.auto.on} onChange=${e => setAuto({ on: e.target.checked })} /><span>New leads from the website join this sequence by themselves</span></label>
        ${
          f.cfg.auto.on &&
          html`<div className="row3">
            <label className="check"><input type="checkbox" checked=${f.cfg.auto.forms.includes('talent')} onChange=${e => setAuto({ forms: e.target.checked ? [...f.cfg.auto.forms, 'talent'] : f.cfg.auto.forms.filter(y => y !== 'talent') })} /><span>The Request talent form</span></label>
            <label className="check"><input type="checkbox" checked=${f.cfg.auto.forms.includes('contact')} onChange=${e => setAuto({ forms: e.target.checked ? [...f.cfg.auto.forms, 'contact'] : f.cfg.auto.forms.filter(y => y !== 'contact') })} /><span>The Contact form</span></label>
            <${Field} label="From whose mailbox"><select value=${f.cfg.auto.who} onChange=${e => setAuto({ who: e.target.value })}><option value="owner">The lead's owner (CRM assignment), when their mailbox is connected</option><option value="me">Always the sequence owner's</option></select><//>
          </div>
          <p className="muted small" style=${{ margin: 0 }}>A lead joins one sequence: the most recently changed active one that takes its form. The website records the visitor's time zone, so the first email arrives in their working hours.</p>`
        }
        <p className="muted small" style=${{ margin: 0 }}>Every email ends with ${home.brand} and an unsubscribe link (the law asks for both in commercial email, CAN-SPAM included). A reply, an unsubscribe or a bounce takes the person out at once.</p>
      </div>
    <//>`;
}

/* One step in the sequence window: emails, replies and, with two versions, each version's numbers */
function SqFunnelStep({ S, x, i, home, onWin }) {
  const st = (S.stats.steps || {})[i] || {};
  const ab = (S.stats.ab || {})[i];
  const sent = st.sent || 0;
  const rep = st.replied || 0;
  return html`<div className="sqfstep">
      <b>${i + 1}. ${x.kind === 'email' ? (x.thread ? 'Follow-up in thread' : x.subj) : 'Task: ' + x.task}</b>
      <span className="muted small">${i === 0 ? 'day ' + x.wait : '+' + x.wait + ' days'} · ${x.kind === 'email' ? sent + ' sent · ' + rep + ' repl' + (rep === 1 ? 'y' : 'ies') + (sent ? ' (' + sqPct(rep, sent) + '%)' : '') : (st.task || 0) + ' tasks'}</span>
      ${
        sqHasB(x) &&
        html`<div className="sqabnums">${['a', 'b'].map(v => {
          const n = (ab && ab[v]) || {};
          return html`<span key=${v} className=${x.win === v ? 'win' : ''}><b>${v.toUpperCase()}</b> ${n.sent || 0} sent · ${n.replied || 0} replied (${sqPct(n.replied || 0, n.sent || 0)}%)${x.win === v ? ' · to everyone' : ''}</span>`;
        })}
          ${S.mine && !x.win && html`<span className="actions"><button type="button" className="btn ghost sm" onClick=${() => onWin(i, 'a')}>Send A to everyone</button><button type="button" className="btn ghost sm" onClick=${() => onWin(i, 'b')}>Send B to everyone</button></span>`}
          ${S.mine && x.win && html`<button type="button" className="btn ghost sm" onClick=${() => onWin(i, '')}>Test both again</button>`}
        </div>`
      }
    </div>`;
}

function SqDetail({ id, home, onClose, onEdit, onChanged }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [add, setAdd] = useState(false);
  const [f, setF] = useState('live');
  const [cls, setCls] = useState('');
  const [qq, setQq] = useState('');
  const [sq, setSq] = useState(''); // a search across the whole sequence (the list holds the newest 2000)
  const [sel, setSel] = useState({});
  const [lim, setLim] = useState(200);
  const [bulkTz, setBulkTz] = useState('-');
  const [moveTo, setMoveTo] = useState('');
  const load = () =>
    api('sq_get', { id, q: sq })
      .then(setD)
      .catch(e => {
        toast(errText(e), true);
        onClose();
      });
  useEffect(() => {
    load();
  }, [id, sq]);
  if (!d) return html`<${Modal} wide title="Sequence" onClose=${onClose}><${Spinner} /><//>`;
  const S = d.seq;
  const act = async (enr, a, msg, extra) => {
    try {
      await api('sq_enr', { enr, act: a, ...(extra || {}) });
      toast(msg);
      load();
      onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const run = async () => {
    try {
      const r = await api('sq_run', {});
      toast(r.sent || r.tasks || r.stopped || r.ooo || r.replies ? `Sent ${r.sent}, tasks ${r.tasks}, left the sequence ${r.stopped}${r.replies ? ', ' + r.replies + (r.replies === 1 ? ' reply' : ' replies') + ' sorted' : ''}${r.ooo ? ', ' + r.ooo + ' out of office (waiting)' : ''}${r.held ? ', ' + r.held + ' held for their sending hours, a holiday or the daily limit' : ''}.` : r.held ? r.held + ' waiting for their sending hours, a holiday or the daily limit.' : 'Nothing is due right now.');
      load();
      onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const win = async (i, w) => {
    try {
      await api('sq_ab', { id: S.id, step: i, win: w });
      toast(w ? 'Version ' + w.toUpperCase() + ' goes to everyone from now on.' : 'Both versions are tested again.');
      load();
      onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const live = p => ['active', 'task', 'paused', 'error'].includes(p.st);
  const ql = qq.trim().toLowerCase();
  const rows = d.people.filter(
    p =>
      (f === 'live' ? live(p) : f === 'replied' ? !!p.cls && p.cls !== 'ooo' : f === 'done' ? !live(p) : true) &&
      (!cls || p.cls === cls) &&
      (!ql || [p.n, p.email, p.co].join(' ').toLowerCase().includes(ql))
  );
  const picked = rows.filter(p => sel[p.id]);
  const allOn = rows.length > 0 && rows.slice(0, lim).every(p => sel[p.id]);
  const bulk = async (a, extra, msg) => {
    try {
      const r = await api('sq_bulk', { enrs: picked.map(p => p.id), act: a, ...(extra || {}) });
      toast(msg(r.done) + (r.skipped.length ? ` ${r.skipped.length} skipped (${r.skipped[0].why}${r.skipped.length > 1 ? '…' : ''}).` : ''));
      setSel({});
      load();
      onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const csv = () => {
    const list = picked.length ? picked : rows;
    const head = ['Name', 'Email', 'Company', 'Status', 'Sorted as', 'Reply', 'Step', 'Version', 'Time zone', 'Last email', 'Added', 'Sender'];
    const lines = list.map(p => [p.n, p.email, p.co, home.st[p.st] || p.st, p.cls ? home.cls[p.cls] || p.cls : '', p.rep, (live(p) ? Math.min(p.step + 1, p.nSteps) : Math.min(p.step, p.nSteps)) + ' of ' + p.nSteps, (p.ab || '').toUpperCase(), p.tz || 'Company time', p.last ? new Date(p.last).toISOString().slice(0, 10) : '', new Date(p.at).toISOString().slice(0, 10), p.senderN]);
    saveDownload((S.n || 'sequence').replace(/[^\w.-]+/g, '-') + '.csv', new Blob([[head, ...lines].map(r => r.map(sqCsvCell).join(',')).join('\r\n')], { type: 'text/csv' }));
    if (d.more && !picked.length) toast('The file holds the newest ' + d.people.length + ' people only. Search to export the others.', true);
  };
  const by = S.stats.by;
  const cc = S.stats.cls || {};
  const others = home.seqs.filter(x => x.id !== S.id && x.st === 'active');
  return html`<${Modal} wide title=${S.n} onClose=${onClose} foot=${html`<button className="btn ghost" onClick=${onClose}>Close</button>${S.mine && html`<button className="btn ghost" onClick=${() => onEdit(S)}>Edit</button>`}<button className="btn ghost" onClick=${run}>Send what is due now</button><button className="btn" onClick=${() => setAdd(true)}><${Icon} n="plus" />Add people</button>`}>
      <div className="stack sqdetail">
        <${KitStats} items=${[{ v: S.stats.total, l: 'People added' }, { v: (by.active || 0) + (by.task || 0) + (by.paused || 0), l: 'In progress' }, { v: (S.stats.replied || by.replied || 0) + ' · ' + S.stats.replyRate + '%', l: 'Replied · reply rate', tone: S.stats.replied ? 'ok' : '' }, { v: cc.interested || 0, l: 'Interested', tone: cc.interested ? 'ok' : '' }, { v: (by.bounced || 0) + (by.unsub || 0), l: 'Bounced or unsubscribed' }]} />
        <div className="sqfunnel">${S.steps.map((x, i) => html`<${SqFunnelStep} key=${i} S=${S} x=${x} i=${i} home=${home} onWin=${win} />`)}</div>
        ${
          Object.keys(cc).length > 0 &&
          html`<div className="sqcls" role="group" aria-label="Replies by kind"><span className="muted small">Replies:</span>${Object.entries(home.cls)
            .filter(([k]) => cc[k])
            .map(([k, n]) => html`<button key=${k} type="button" className=${'chip ' + (SQ_CLS_TONE[k] || '') + (cls === k ? ' on' : '')} aria-pressed=${cls === k} onClick=${() => (setCls(cls === k ? '' : k), setF('all'))}>${n} · ${cc[k]}</button>`)}</div>`
        }
        <div className="toolbar"><div className="seg">${[['live', 'In progress'], ['replied', 'Replied'], ['done', 'Left the sequence'], ['all', 'Everyone']].map(([k, n]) => html`<button key=${k} type="button" className=${f === k ? 'on' : ''} onClick=${() => (setF(k), setCls(''))}>${n}</button>`)}</div><input type="search" className="sqfind" value=${qq} onInput=${e => (setQq(e.target.value), !e.target.value && sq && setSq(''))} onKeyDown=${e => e.key === 'Enter' && (d.more || sq) && setSq(qq.trim())} placeholder="Find a person" aria-label="Find a person in this sequence" /><button type="button" className="btn ghost sm push" onClick=${csv}><${Icon} n="down" />${picked.length ? 'Export ' + picked.length : 'Export CSV'}</button></div>
        ${(d.more || sq) && html`<p className="muted small">${sq ? 'Results for \u201c' + sq + '\u201d across the whole sequence' + (d.more ? ' (the newest ' + d.people.length + ')' : '') + '. Clear the box to see the list again.' : 'Showing the newest ' + d.people.length + ' of ' + S.stats.total + '. Type a name, company or address and press Enter to search everyone.'}</p>`}
        ${
          picked.length > 0 &&
          html`<div className="sqbulk" role="group" aria-label="With the people picked">
            <b>${picked.length} picked</b>
            <button type="button" className="btn ghost sm" onClick=${() => bulk('pause', {}, n => n + ' paused.')}>Pause</button>
            <button type="button" className="btn ghost sm" onClick=${() => bulk('resume', {}, n => n + ' resumed.')}>Resume</button>
            <button type="button" className="btn ghost sm" onClick=${() => bulk('replied', {}, n => n + ' marked as replied.')}>Mark replied</button>
            <button type="button" className="btn ghost sm" onClick=${() => bulk('stop', {}, n => n + ' stopped.')}>Stop</button>
            <select value=${bulkTz} aria-label="Set the time zone of the people picked" onChange=${e => {
              const v = e.target.value;
              setBulkTz('-');
              if (v !== '-') bulk('tz', { tz: v }, n => n + ' set to ' + sqTzName(home, v) + '.');
            }}><option value="-">Time zone…</option><option value="">Company time</option>${home.tzs.map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select>
            ${
              others.length > 0 &&
              html`<select value=${moveTo} aria-label="Move the people picked to another sequence" onChange=${e => {
                const v = e.target.value;
                setMoveTo('');
                if (v) bulk('move', { to: v }, n => n + ' moved to ' + (others.find(x => x.id === v) || {}).n + '.');
              }}><option value="">Move to…</option>${others.map(x => html`<option key=${x.id} value=${x.id}>${x.n}</option>`)}</select>`
            }
            <button type="button" className="btn ghost sm push" onClick=${() => setSel({})}>Clear</button>
          </div>`
        }
        ${
          rows.length
            ? html`<div className="tblwrap"><table className="tbl small"><thead><tr><th className="sqck"><input type="checkbox" aria-label="Pick everyone shown" checked=${allOn} onChange=${e => setSel(e.target.checked ? Object.fromEntries(rows.slice(0, lim).map(p => [p.id, true])) : {})} /></th><th>Person</th><th>Status</th><th>Step</th><th>Next</th><th>Last email</th><th></th></tr></thead><tbody>${rows.slice(0, lim).map(p => {
                const their = p.tz && p.st === 'active' && p.next ? sqTheirTime(p.next, p.tz) : '';
                return html`<tr key=${p.id} className="sqrow"><td className="sqck"><input type="checkbox" aria-label=${'Pick ' + (p.n || p.email)} checked=${!!sel[p.id]} onChange=${e => setSel({ ...sel, [p.id]: e.target.checked })} /></td><td><b>${p.n || p.email}</b><div className="muted">${p.email}${p.co ? ' · ' + p.co : ''}</div><div className="muted">${sqTzName(home, p.tz)}${p.src === 'auto' ? ' · website lead' : p.src === 'csv' ? ' · from a file' : p.src === 'move' ? ' · moved here' : ''}${S.mine && p.senderN && p.sender !== home.me ? ' · ' + p.senderN : ''}</div></td><td><${Chip} s=${SQ_TONE[p.st]}>${home.st[p.st] || p.st}<//>${p.cls ? html` <${Chip} s=${SQ_CLS_TONE[p.cls]}>${home.cls[p.cls] || p.cls}<//>` : null}${p.why && (!p.cls || p.cls === 'ooo' || !p.rep) ? html`<div className="muted">${p.why}</div>` : null}${p.rep ? html`<div className="sqrep">${p.repAt ? fmtDate(new Date(p.repAt).toISOString().slice(0, 10), { month: 'short', day: 'numeric' }) + ': ' : ''}“${p.rep}”</div>` : null}</td><td className="nw">${live(p) ? Math.min(p.step + 1, p.nSteps) : Math.min(p.step, p.nSteps)} of ${p.nSteps}${p.ab ? html` <${Chip} s="new">${p.ab.toUpperCase()}<//>` : null}</td><td className="nw">${p.st === 'active' && p.next ? sqWhen(p.next) : '–'}${their ? html`<div className="muted">${their} theirs</div>` : null}</td><td className="nw">${p.last ? sqWhen(p.last) : '–'}</td><td className="r nw">
                  ${['active', 'task', 'error'].includes(p.st) && html`<button type="button" className="btn ghost sm" onClick=${() => act(p.id, 'pause', 'Paused.')}>Pause</button>`}
                  ${['paused', 'error'].includes(p.st) && html`<button type="button" className="btn ghost sm" onClick=${() => act(p.id, 'resume', 'Resumed.')}>Resume</button>`}
                  ${live(p) && html`<button type="button" className="btn ghost sm" onClick=${() => act(p.id, 'replied', 'Marked as replied.')}>Replied</button><button type="button" className="btn ghost sm" onClick=${() => act(p.id, 'stop', 'Stopped.')}>Stop</button>`}
                  ${['replied', 'unsub'].includes(p.st) && p.cls && html`<select value=${p.cls} aria-label=${'Sort the reply of ' + (p.n || p.email)} onChange=${e => act(p.id, 'sort', 'Sorted as ' + home.cls[e.target.value] + '.', { cls: e.target.value })}>${Object.entries(home.cls).filter(([k]) => k !== 'ooo').map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select>`}
                </td></tr>`;
              })}</tbody></table></div>${rows.length > lim ? html`<div className="actions"><button type="button" className="btn ghost sm" onClick=${() => setLim(lim + 200)}>Show ${Math.min(200, rows.length - lim)} more of ${rows.length - lim}</button></div>` : null}`
            : html`<${Empty} title=${d.people.length ? 'Nobody in this view' : 'Nobody added yet'}>${d.people.length ? 'Try another filter.' : 'Add CRM leads and contacts, paste addresses or choose a CSV file. The first step goes out when it is due, inside their sending hours.'}<//>`
        }
      </div>
      ${add && html`<${SqEnroll} S=${S} home=${home} onClose=${() => setAdd(false)} onDone=${() => (setAdd(false), load(), onChanged())} />`}
    <//>`;
}

function SqEnroll({ S, home, onClose, onDone }) {
  const toast = useToast();
  const [qq, setQq] = useState('');
  const [list, setList] = useState(null);
  const [pick, setPick] = useState({});
  const [paste, setPaste] = useState('');
  const [file, setFile] = useState(null);
  const [tz, setTz] = useState('');
  const [start, setStart] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState('');
  useEffect(() => {
    const t = setTimeout(
      () =>
        api('sq_people', { q: qq })
          .then(r => setList(r.people))
          .catch(() => setList([])),
      250
    );
    return () => clearTimeout(t);
  }, [qq]);
  // "Name <email>, Company" or just an email, one per line
  const pasted = paste
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      const m = l.match(/^(.*?)<([^>]+)>\s*,?\s*(.*)$/);
      if (m) return { n: m[1].trim().replace(/,$/, ''), email: m[2].trim(), co: m[3].trim() };
      const [email, ...rest] = l.split(',').map(x => x.trim());
      return { n: '', email, co: rest.join(', ') };
    });
  const chosen = (list || []).filter(p => pick[p.ref]);
  const readFile = fl => {
    if (!fl) return setFile(null);
    if (fl.size > 3 * 1024 * 1024) return toast('That file is over 3 MB; split it into smaller files.', true);
    const r = new FileReader();
    r.onload = () => {
      const out = sqCsvPeople(String(r.result || ''));
      if (!out.people.length) toast('No email addresses were found in that file. The first row should name the columns (Email, Name, Company, Time zone).', true);
      setFile({ name: fl.name, ...out });
    };
    r.readAsText(fl);
  };
  const go = async () => {
    const first = [...chosen.map(p => ({ ref: p.ref, email: p.email })), ...pasted];
    const rest = file ? file.people : [];
    let added = 0;
    const skipped = [];
    try {
      for (let i = 0; i < first.length; i += 500) {
        setBusy(first.length > 500 ? 'Adding ' + Math.min(i + 500, first.length) + ' of ' + first.length + '…' : 'Adding…');
        const r = await api('sq_enroll', { id: S.id, start, tz, src: 'paste', people: first.slice(i, i + 500) });
        added += r.added;
        skipped.push(...r.skipped);
      }
      for (let i = 0; i < rest.length; i += 500) {
        setBusy('Adding ' + Math.min(i + 500, rest.length) + ' of ' + rest.length + '…');
        const r = await api('sq_enroll', { id: S.id, start, tz, src: 'csv', people: rest.slice(i, i + 500) });
        added += r.added;
        skipped.push(...r.skipped);
      }
      setRes({ added, skipped });
      toast(added + ' added' + (skipped.length ? ', ' + skipped.length + ' skipped' : '') + '.');
      if (!skipped.length) onDone();
    } catch (e) {
      if (added) setRes({ added, skipped });
      toast(errText(e), true);
    }
    setBusy('');
  };
  const n = chosen.length + pasted.length + (file ? file.people.length : 0);
  return html`<${Modal} wide title=${'Add people to ' + S.n} onClose=${res ? onDone : onClose} foot=${html`<button className="btn ghost" onClick=${res ? onDone : onClose}>${res ? 'Done' : 'Cancel'}</button>${!res && html`<button className="btn" disabled=${!!busy || !n} onClick=${go}>${busy || 'Add ' + n + (n === 1 ? ' person' : ' people')}</button>`}`}>
      ${
        res
          ? html`<div className="stack"><p><b>${res.added}</b> added.</p>${res.skipped.length > 0 && html`<div className="tblwrap"><table className="tbl small"><thead><tr><th>Skipped</th><th>Why</th></tr></thead><tbody>${res.skipped.slice(0, 300).map((x, i) => html`<tr key=${i}><td>${x.email || '–'}</td><td>${x.why}</td></tr>`)}</tbody></table></div>`}${res.skipped.length > 300 ? html`<p className="muted small">And ${res.skipped.length - 300} more.</p>` : null}</div>`
          : html`<div className="stack form">
          <${Field} label="From the CRM (leads and contacts with an email)"><input type="search" value=${qq} onInput=${e => setQq(e.target.value)} placeholder="Find by name, email or company" /><//>
          <div className="sqpick">${list === null ? html`<${Spinner} />` : list.length ? list.map(p => html`<label key=${p.ref} className=${'pick' + (pick[p.ref] ? ' on' : '')}><input type="checkbox" disabled=${p.busy || p.sup} checked=${!!pick[p.ref]} onChange=${e => setPick({ ...pick, [p.ref]: e.target.checked })} /><span><b>${p.n || p.email}</b> <span className="muted small">${p.kind === 'lead' ? 'lead' : 'contact'} · ${p.email}${p.co ? ' · ' + p.co : ''}${p.busy ? ' · already in a sequence' : ''}${p.sup ? ' · do not email' : ''}</span></span></label>`) : html`<p className="muted small" style=${{ margin: 0 }}>No leads or contacts with an email match.</p>`}</div>
          <${Field} label="Or paste addresses, one per line" hint="Name <email>, Company — or just the email"><textarea rows="3" value=${paste} onInput=${e => setPaste(e.target.value)} placeholder="Jordan Lee <jordan@acme.example>, Acme Corp" /><//>
          <div className="fld sqcsv">
            <span>Or a CSV file</span>
            <input type="file" accept=".csv,.txt,text/csv" aria-label="CSV file of people" onChange=${e => readFile(e.target.files && e.target.files[0])} />
            <small>The first row names the columns: Email (needed), Name or First name and Last name, Company, Time zone (ET, Pacific, America/Chicago…) and City / State to work out a time zone.</small>
            ${
              file &&
              html`<div className="sqcsvsum"><b>${file.people.length}</b> ${file.people.length === 1 ? 'person' : 'people'} in ${file.name} · columns: ${file.cols.join(', ')}${file.bad ? ' · ' + file.bad + (file.bad === 1 ? ' row' : ' rows') + ' without a valid email left out' : ''}
                ${file.people.length > 0 && html`<div className="tblwrap"><table className="tbl small"><thead><tr><th>Email</th><th>Name</th><th>Company</th><th>Time zone or place</th></tr></thead><tbody>${file.people.slice(0, 5).map((p, i) => html`<tr key=${i}><td>${p.email}</td><td>${p.n}</td><td>${p.co}</td><td>${p.tz || p.loc}</td></tr>`)}</tbody></table></div>`}</div>`
            }
          </div>
          <div className="row2">
            <${Field} label="Time zone for people whose own is not known"><select value=${tz} onChange=${e => setTz(e.target.value)}><option value="">Company time (${home.coTz})</option>${home.tzs.map(([k, l]) => html`<option key=${k} value=${k}>${l}</option>`)}</select><//>
            <${Field} label="Start on (optional)"><input type="date" value=${start} onInput=${e => setStart(e.target.value)} /><//>
          </div>
          <p className="muted small" style=${{ margin: 0 }}>People already in a sequence, on the do-not-email list or without a valid address are skipped. Emails go out from your mailbox, in each person's working hours when their time zone is known (from the CRM, the website form or the file).</p>
        </div>`
      }
    <//>`;
}

function SqTasks({ onChanged }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const load = () =>
    api('sq_tasks')
      .then(setD)
      .catch(() => setD({ tasks: [], now: Date.now() }));
  useEffect(() => {
    load();
  }, []);
  if (!d) return html`<${Spinner} />`;
  const act = async (t, a) => {
    try {
      await api('sq_task', { task: t.id, act: a });
      toast(a === 'skip' ? (t.reply ? 'Dismissed.' : 'Skipped.') : 'Done.');
      load();
      onChanged();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const now = d.now || Date.now();
  const due = d.tasks.filter(t => t.due <= now);
  const later = d.tasks.filter(t => t.due > now);
  const row = t => html`<div key=${t.id} className="sqtask"><div><b>${t.t}</b><div className="muted small">${t.n || t.email} · ${t.email}${t.co ? ' · ' + t.co : ''} · ${t.seqn} · ${t.due > now ? 'due ' + fmtDate(new Date(t.due).toISOString().slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' }) : 'since ' + sqWhen(t.due)}</div></div><div className="actions">${t.reply && html`<a className="btn ghost sm" href=${sqMailHref(t.email)}><${Icon} n="mail" />Write</a>`}<button type="button" className="btn ghost sm" onClick=${() => act(t, 'skip')}>${t.reply ? 'Dismiss' : 'Skip'}</button><button type="button" className="btn sm" onClick=${() => act(t, 'done')}>Done</button></div></div>`;
  return d.tasks.length
    ? html`<div className="stack">${due.map(row)}${later.length > 0 && html`<span className="lbl sqtaskgrp">Coming up</span>`}${later.map(row)}</div>`
    : html`<${Empty} title="No tasks waiting">Call and LinkedIn steps of your sequences show up here when they are due, with a task to answer each reply.<//>`;
}

function SqTemplates({ home, onUse }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [ed, setEd] = useState(null);
  const load = () =>
    api('sq_tpls')
      .then(setD)
      .catch(() => setD({ tpls: [], starters: [] }));
  useEffect(() => {
    load();
  }, []);
  if (!d) return html`<${Spinner} />`;
  const save = async () => {
    try {
      await api('sq_tpl_save', ed);
      toast('Template saved.');
      setEd(null);
      load();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const del = async t => {
    if (!confirm('Delete the template "' + t.n + '"? Sequences that used it keep their text.')) return;
    try {
      await api('sq_tpl_del', { id: t.id });
      toast('Template deleted.');
      load();
    } catch (e) {
      toast(errText(e), true);
    }
  };
  const card = (t, starter) => html`<div key=${t.id} className="sqtpl">
      <div className="sqhead"><b>${t.n}</b>${t.cat ? html`<${Chip}>${t.cat}<//>` : null}${!starter && t.shared ? html`<${Chip} s="info">team<//>` : null}</div>
      <div className="small"><b>${t.subj || 'Reply in the thread (no subject)'}</b></div>
      <div className="muted small sqtplbody">${t.body}</div>
      <div className="muted small">${starter ? 'To start from' : (t.mine ? 'Yours' : 'By ' + t.ownerN) + (t.uses ? ' · used ' + t.uses + ' time' + (t.uses === 1 ? '' : 's') : '')}</div>
      <div className="actions">
        <button type="button" className="btn ghost sm" onClick=${() => onUse(t)}>Use in a new sequence</button>
        ${starter && html`<button type="button" className="btn ghost sm" onClick=${() => setEd({ n: t.n, cat: t.cat, subj: t.subj, body: t.body, shared: true })}>Copy and change</button>`}
        ${!starter && t.mine && html`<button type="button" className="btn ghost sm" onClick=${() => setEd({ id: t.id, n: t.n, cat: t.cat, subj: t.subj, body: t.body, shared: t.shared })}>Edit</button><button type="button" className="btn ghost sm" onClick=${() => del(t)}>Delete</button>`}
      </div>
    </div>`;
  return html`<div className="stack">
      <div className="ph-row"><div className="muted small">Emails the team writes once and uses in any sequence. A template fills a step's subject and message; the step can still be changed. Fields like {first_name} and {company} are filled in for each person.</div><button className="btn" onClick=${() => setEd({ n: '', cat: '', subj: '', body: 'Hi {first_name},\n\n\n\n{my_name}', shared: true })}><${Icon} n="plus" />New template</button></div>
      ${d.tpls.length ? html`<span className="lbl">Yours and the team's</span><div className="sqtpls">${d.tpls.map(t => card(t, false))}</div>` : null}
      <span className="lbl">To start from</span>
      <div className="sqtpls">${d.starters.map(t => card(t, true))}</div>
      ${
        ed &&
        html`<${Modal} title=${ed.id ? 'Edit template' : 'New template'} onClose=${() => setEd(null)} foot=${html`<button className="btn ghost" onClick=${() => setEd(null)}>Cancel</button><button className="btn" disabled=${!ed.n.trim() || !ed.body.trim()} onClick=${save}>Save template</button>`}>
          <div className="stack form">
            <div className="row2"><${Field} label="Title"><input value=${ed.n} onInput=${e => setEd({ ...ed, n: e.target.value })} /><//><${Field} label="Kind (optional)"><input value=${ed.cat} list="sqtplcats" onInput=${e => setEd({ ...ed, cat: e.target.value })} placeholder="e.g. Recruiting" /><datalist id="sqtplcats">${[...new Set([...d.tpls, ...d.starters].map(t => t.cat).filter(Boolean))].map(c => html`<option key=${c} value=${c} />`)}</datalist><//></div>
            <${Field} label="Subject (empty for a reply in the thread)"><input value=${ed.subj} onInput=${e => setEd({ ...ed, subj: e.target.value })} /><//>
            <${Field} label="Message"><textarea rows="8" value=${ed.body} onInput=${e => setEd({ ...ed, body: e.target.value })} /><//>
            <div className="actions sqfields"><span className="muted small">Insert:</span>${home.fields.map(k => html`<button key=${k} type="button" className="btn ghost sm" onClick=${() => setEd({ ...ed, body: ed.body + '{' + k + '}' })}>{${k}}</button>`)}</div>
            <label className="check"><input type="checkbox" checked=${ed.shared} onChange=${e => setEd({ ...ed, shared: e.target.checked })} /><span>The team can use it</span></label>
          </div>
        <//>`
      }
    </div>`;
}

/* Sent and replied each day */
function SqDayBars({ days }) {
  const W = 640;
  const H = 180;
  const pad = 28;
  const max = Math.max(1, ...days.map(x => x.sent), ...days.map(x => x.replied));
  const bw = (W - pad - 8) / Math.max(1, days.length);
  const every = Math.ceil(days.length / 8);
  return html`<svg className="sqchart" viewBox=${'0 0 ' + W + ' ' + H} role="img" aria-label="Emails sent and replies each day">
      <line x1=${pad} y1=${H - pad} x2=${W - 8} y2=${H - pad} className="ax" />
      <text x="2" y="14" className="tk">${max}</text>
      ${days.map((x, i) => {
        const hs = (x.sent / max) * (H - pad - 16);
        const hr = (x.replied / max) * (H - pad - 16);
        const w = Math.max(1.5, bw * 0.38);
        return html`<g key=${x.d}><rect className="sent" x=${pad + i * bw + bw * 0.1} y=${H - pad - hs} width=${w} height=${hs}><title>${x.d}: ${x.sent} sent</title></rect><rect className="rep" x=${pad + i * bw + bw * 0.1 + w} y=${H - pad - hr} width=${w} height=${hr}><title>${x.d}: ${x.replied} replied</title></rect>${i % every === 0 ? html`<text x=${pad + i * bw + bw / 2} y=${H - 10} className="tk" textAnchor="middle">${x.d.slice(5)}</text>` : null}</g>`;
      })}
    </svg>`;
}

function SqAnalytics({ home, onOpen }) {
  const [seq, setSeq] = useState('');
  const [days, setDays] = useState(30);
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    // only the latest request shows (a slow answer for the days or sequence picked before is dropped)
    let on = true;
    setD(null);
    setErr(null);
    api('sq_stats', { id: seq, days })
      .then(x => on && setD(x))
      .catch(e => on && setErr(e));
    return () => {
      on = false;
    };
  }, [seq, days, tick]);
  if (err && !d) return html`<${LoadError} error=${err} onRetry=${() => setTick(t => t + 1)} />`;
  const t = d && d.tot;
  return html`<div className="stack sqstats">
      <div className="toolbar">
        <select value=${seq} aria-label="Which sequence" onChange=${e => setSeq(e.target.value)}><option value="">All sequences</option>${((d && d.list) || home.seqs).map(x => html`<option key=${x.id} value=${x.id}>${x.n}${x.st === 'archived' ? ' (archived)' : ''}</option>`)}</select>
        <div className="seg">${[[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, 'A year']].map(([k, n]) => html`<button key=${k} type="button" className=${days === k ? 'on' : ''} onClick=${() => setDays(k)}>${n}</button>`)}</div>
      </div>
      ${
        !d
          ? html`<${Spinner} />`
          : html`<${KitStats} items=${[{ v: t.added, l: 'People added' }, { v: t.sent, l: 'Emails sent, to ' + t.contacted + (t.contacted === 1 ? ' person' : ' people') }, { v: t.replied + ' · ' + t.rate + '%', l: 'Replied · reply rate', tone: t.replied ? 'ok' : '' }, { v: d.cls.interested || 0, l: 'Interested', tone: d.cls.interested ? 'ok' : '' }, { v: t.bounced + t.unsub, l: 'Bounced or unsubscribed' }]} />
            <section className="panel"><div className="sqlegend"><b>Each day</b><span><i className="sent" />Sent</span><span><i className="rep" />Replies</span></div><${SqDayBars} days=${d.days} /></section>
            <div className="sqcols">
              <section className="panel"><b>Replies by kind</b>${Object.values(d.cls).some(Boolean) ? html`<${ImHBars} rows=${Object.entries(home.cls).map(([k, n]) => ({ l: n, a: d.cls[k] || 0 }))} />` : html`<p className="muted small">No replies in this period yet.</p>`}</section>
              <section className="panel"><b>Each sender</b>${
                d.senders.length
                  ? html`<div className="tblwrap"><table className="tbl small"><thead><tr><th>Sender</th><th className="r">Sent</th><th className="r">Reached</th><th className="r">Replied</th><th className="r">Rate</th><th className="r">Bounced or unsub.</th><th className="r">Tasks done</th></tr></thead><tbody>${d.senders.map(x => html`<tr key=${x.id}><td>${x.n}</td><td className="r">${x.sent}</td><td className="r">${x.contacted}</td><td className="r">${x.replied}</td><td className="r">${x.rate}%</td><td className="r">${x.bounced + x.unsub}</td><td className="r">${x.taskdone}</td></tr>`)}</tbody></table></div>`
                  : html`<p className="muted small">Nothing sent in this period.</p>`
              }</section>
            </div>
            ${
              seq
                ? html`<section className="panel"><b>Each step</b><div className="tblwrap"><table className="tbl small"><thead><tr><th>Step</th><th className="r">Sent or tasks</th><th className="r">Replies</th><th className="r">Rate</th><th className="r">Out of office</th></tr></thead><tbody>${d.steps.map(x => html`<${Fragment} key=${x.i}><tr><td>${x.i + 1}. ${x.label}</td><td className="r">${x.kind === 'email' ? x.sent : x.task + (x.taskdone ? ' (' + x.taskdone + ' done)' : '')}</td><td className="r">${x.replied}</td><td className="r">${x.kind === 'email' ? x.rate + '%' : ''}</td><td className="r">${x.ooo || ''}</td></tr>${x.ab ? ['a', 'b'].map(v => html`<tr key=${v} className="sqabrow"><td>Version ${v.toUpperCase()}: ${x.ab[v].subj}${x.ab.win === v ? ' · goes to everyone' : ''}</td><td className="r">${x.ab[v].sent}</td><td className="r">${x.ab[v].replied}</td><td className="r">${x.ab[v].rate}%</td><td></td></tr>`) : null}<//>`)}</tbody></table></div></section>`
                : html`<section className="panel"><b>Each sequence</b>${
                    d.seqs.length
                      ? html`<div className="tblwrap"><table className="tbl small"><thead><tr><th>Sequence</th><th className="r">Added</th><th className="r">Sent</th><th className="r">Reached</th><th className="r">Replied</th><th className="r">Rate</th></tr></thead><tbody>${d.seqs.map(x => html`<tr key=${x.id} className="click" tabIndex="0" onClick=${() => onOpen(x.id)} onKeyDown=${e => e.key === 'Enter' && onOpen(x.id)}><td>${x.n}${x.st === 'archived' ? html` <${Chip}>archived<//>` : null}</td><td className="r">${x.added}</td><td className="r">${x.sent}</td><td className="r">${x.contacted}</td><td className="r">${x.replied}</td><td className="r">${x.rate}%</td></tr>`)}</tbody></table></div>`
                      : html`<p className="muted small">Nothing sent in this period.</p>`
                  }</section>`
            }`
      }
    </div>`;
}
