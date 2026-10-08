/* ================= StratEdge AI: the assistant across the portals (v31; renamed and widened in v32) =================
   AskAi: the "StratEdge AI" button in every portal header and its side panel (page-aware, never changes anything):
   explains and teaches the page, plans the day from the person's own tasks and deadlines, quick actions for email,
   learning, jobs and time. AiMailHelp: summary, action items, reply and follow-up on an open email.
   AiWrite: "Write with AI" next to an editor. AiFill: fills a form from pasted text or a resume.
   They only show when the server says the matching switch is on (Cap.ai, from Admin > Website & messages > Assistant). */
const aiOn = k => !!(Cap.ai && Cap.ai[k]);
const AI_TIMEOUT = 90000;
const AI_NAME = 'StratEdge AI';
/* the StratEdge "S", so the assistant looks like part of the site */
const AiMark = ({ size }) => html`<img className="aimark" src="assets/ai-mark.png" alt="" width=${size || 18} height=${size || 18} />`;

/* Answer text: paragraphs, "- " / "1. " lists (with or without blank lines around them), **bold** and links. */
function AiText({ text }) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];
  let para = [];
  let list = null;
  const flushPara = () => {
    if (para.length) out.push({ t: 'p', v: para.join(' ') });
    para = [];
  };
  const flushList = () => {
    if (list) out.push(list);
    list = null;
  };
  lines.forEach(raw => {
    const l = raw.trim();
    const m = l.match(/^(?:[-*•]|(\d+)[.)])\s+(.*)$/);
    if (!l) {
      flushPara();
      flushList();
    } else if (m) {
      flushPara();
      const ordered = !!m[1];
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { t: 'list', ordered, items: [] };
      }
      list.items.push(m[2]);
    } else {
      flushList();
      para.push(l.replace(/^#{1,6}\s+/, ''));
    }
  });
  flushPara();
  flushList();
  return html`<div className="md aitext">
    ${out.map((b, i) =>
      b.t === 'p'
        ? html`<p key=${i}>${mdInline(b.v, 'p' + i)}</p>`
        : b.ordered
          ? html`<ol key=${i}>${b.items.map((x, j) => html`<li key=${j}>${mdInline(x, 'o' + i + j)}</li>`)}</ol>`
          : html`<ul key=${i}>${b.items.map((x, j) => html`<li key=${j}>${mdInline(x, 'u' + i + j)}</li>`)}</ul>`
    )}
  </div>`;
}
const aiCopy = (toast, text) =>
  navigator.clipboard && navigator.clipboard.writeText
    ? navigator.clipboard.writeText(text).then(
        () => toast('Copied.'),
        () => toast('Copy it from the text above.', true)
      )
    : toast('Copy it from the text above.', true);

/* ---------- StratEdge AI ---------- */
// quick actions: [label, question, use my own records (tasks, timesheets, deadlines…)]
const ASK_STARTERS = [
  ['Explain this page', 'Teach me this page: what it is for, what each part of the screen shows, and how to do the two or three most common things here, step by step.'],
  ['Plan my day', 'Plan my day: what should I do first today and in what order, with rough times? Put anything overdue or due soon first.', true],
  ['What needs my attention?', 'What on this page needs my attention first, and why?'],
  ['How do I…', 'How do I '],
  ['Draft a message', 'Draft a short, professional email about '],
];
const ASK_BY_PAGE = [
  [/immigration-live|immnews/, [['What changed recently?', 'What are the most important recent USCIS or immigration updates on this page, and who could they affect? Use the official sources and dates shown.'], ['H-1B updates', 'What are the latest official H-1B or employer immigration updates, if any? Tell me when the sources were checked and link the official sources.'], ['OPT / F-1 updates', 'What are the latest official F-1, OPT, STEM OPT or EAD updates, if any? Tell me when the sources were checked and link the official sources.'], ['Green card / Visa Bulletin', 'Explain the current official green-card and Visa Bulletin updates at a high level. Do not decide my eligibility; link the official sources.']]],
  [/mymail|\/mail\b/, [['Summarize this email', 'Summarize the email open on screen: who it is from, what they want, any dates or deadlines, and the next step.'], ['Draft a reply', 'Draft a reply to the email open on screen, ready to paste.'], ['Write a follow-up', 'Write a short, polite follow-up for the email thread open on screen.']]],
  [/\/(learn|tests|certify|compliance)\b/, [['Explain it simply', 'Explain the lesson or topic on screen simply, with one real-world example.'], ['Quiz me', 'Quiz me on what is on screen: three questions, one at a time. Wait for my answer before giving the right one.'], ['Make flashcards', 'Make 6 flashcards (term - meaning) from what is on screen.'], ['Study plan', 'Make me a one-week study plan for what is on screen, 30 minutes a day.', true]]],
  [/\/(jobs|bench|vreqs|tailor|matches)\b/, [['Which fit me best?', 'Which of the jobs on screen fit me best, and why? Rank the top three.'], ['Note to the recruiter', 'Draft a short note to the recruiter for the best-fitting role on screen.']]],
  [/\/(timesheets|attendance|approvals|pay|timeoff|payruns)\b/, [['Check my week', 'Check my week: hours so far, days with nothing logged, and whether my timesheet is ready to submit.', true]]],
  [/\/(plan|membership|billing)\b/, [['Explain my plan', 'Explain the plan and payments on screen: what is paid, what is due next, and what the plan includes.']]],
  [/\/(ats|rec|interviews|placements|crm)\b/, [['Summarize this page', 'Summarize what is on this page for me in a few bullets.'], ['Who to follow up with', 'Who on this page should I follow up with first, and what should I say?']]],
];
const askStarters = () => {
  const h = location.hash || '';
  const hit = ASK_BY_PAGE.find(([re]) => re.test(h));
  const extra = hit ? hit[1] : [['Summarize this page', 'Summarize what is on this page for me in a few bullets.']];
  const seen = new Set();
  return [...extra, ...ASK_STARTERS].filter(([n, , me]) => !seen.has(n) && seen.add(n) && (!me || aiOn('work')));
};
/* ---------- StratEdge AI acting on your behalf: a card you confirm before anything happens (v78) ---------- */
const aiActOn = () => aiOn('act');
// which fields of a proposal the person can edit before confirming, and how to show them
const AI_PROP_FIELDS = {
  send_email: [['to', 'To', 'text'], ['subject', 'Subject', 'text'], ['body', 'Message', 'area']],
  create_task: [['title', 'Title', 'text'], ['due', 'Due date', 'date'], ['priority', 'Priority', 'pri'], ['details', 'Details', 'area']],
  approve_timesheet: [['note', 'Note', 'area']],
  approve_timeoff: [['note', 'Note', 'area']],
  add_candidate_note: [['note', 'Note', 'area']],
  post_announcement: [['title', 'Title', 'text'], ['body', 'Message', 'area'], ['pin', 'Pin to the top', 'bool']],
  block_address: [['ip', 'Address', 'text'], ['minutes', 'Minutes (0 = permanent)', 'num'], ['why', 'Reason', 'text']],
};
function ProposalCard({ p, onDone }) {
  const toast = useToast();
  const [args, setArgs] = useState(() => ({ ...(p.args || {}) }));
  const [edit, setEdit] = useState(false);
  const [state, setState] = useState('open'); // open | busy | done | dismissed
  const [msg, setMsg] = useState('');
  const fields = AI_PROP_FIELDS[p.tool] || [];
  const set = (k, v) => setArgs(a => ({ ...a, [k]: v }));
  const confirm = async () => {
    setState('busy');
    try {
      const r = await api('ai_act', { id: p.id, args });
      setMsg(r.done || 'Done.');
      setState('done');
      onDone && onDone(r.done || 'Done.');
    } catch (e) {
      toast(errText(e), true);
      setState('open');
    }
  };
  if (state === 'done') return html`<div className="ai-card done"><div className="ai-card-h"><${Icon} n="check" /><b>${msg}</b></div></div>`;
  if (state === 'dismissed') return html`<div className="ai-card dismissed"><span className="muted small">Dismissed — nothing was done.</span></div>`;
  return html`<div className=${'ai-card tool-' + p.tool}>
    <div className="ai-card-h"><span className="ai-card-badge"><${Icon} n="bolt" /></span><b>${p.title}</b></div>
    <div className="ai-card-sum">${p.summary}</div>
    ${p.effect && html`<div className="ai-card-eff muted small">${p.effect}</div>`}
    ${
      edit &&
      fields.length > 0 &&
      html`<div className="ai-card-edit form">
        ${fields.map(([k, label, ty]) =>
          ty === 'area'
            ? html`<${Field} key=${k} label=${label}><textarea rows="4" value=${args[k] || ''} onInput=${e => set(k, e.target.value)} /><//>`
            : ty === 'bool'
              ? html`<label key=${k} className="check"><input type="checkbox" checked=${!!args[k]} onChange=${e => set(k, e.target.checked)} /><span>${label}</span></label>`
              : ty === 'pri'
                ? html`<${Field} key=${k} label=${label}><select value=${args[k] || 'normal'} onChange=${e => set(k, e.target.value)}><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select><//>`
                : html`<${Field} key=${k} label=${label}><input type=${ty === 'date' ? 'date' : ty === 'num' ? 'number' : 'text'} value=${args[k] ?? ''} onInput=${e => set(k, ty === 'num' ? +e.target.value : e.target.value)} /><//>`
        )}
      </div>`
    }
    <div className="ai-card-act">
      <button type="button" className="btn sm go" disabled=${state === 'busy'} onClick=${confirm}>${state === 'busy' ? 'Working…' : p.confirm || 'Confirm'}</button>
      ${fields.length > 0 && html`<button type="button" className="btn ghost sm" disabled=${state === 'busy'} onClick=${() => setEdit(e => !e)}>${edit ? 'Done editing' : 'Edit'}</button>`}
      <button type="button" className="btn ghost sm" disabled=${state === 'busy'} onClick=${() => setState('dismissed')}>Dismiss</button>
    </div>
  </div>`;
}

function AskAi({ portalName, title }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [usePage, setUsePage] = useState(true);
  const [act, setAct] = useState(() => aiActOn());
  const box = useRef(null);
  const input = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onKey = e => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    setTimeout(() => input.current && input.current.focus(), 50);
    // v34: one side panel at a time (the Help & support panel uses the same place)
    window.dispatchEvent(new CustomEvent('se-panel', { detail: 'ai' }));
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  useEffect(() => {
    const other = e => e.detail !== 'ai' && setOpen(false);
    window.addEventListener('se-panel', other);
    return () => window.removeEventListener('se-panel', other);
  }, []);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [msgs, busy]);
  // a new page starts a new conversation (the old answers were about another page)
  useEffect(() => {
    setMsgs([]);
  }, [title]);
  const acting = act && aiActOn();
  const ask = async (text, me) => {
    const question = (text || q).trim();
    if (!question || busy) return;
    const content = document.querySelector('.app .content');
    const pageText = usePage && aiOn('page') && content ? content.innerText.replace(/\n{3,}/g, '\n\n').slice(0, 9000) : '';
    const nav = Array.from(document.querySelectorAll('.app .side a'))
      .map(a => (a.innerText || '').replace(/\s+\d+$/, '').trim())
      .filter(Boolean)
      .slice(0, 80);
    const hist = msgs.slice(-8).map(m => ({ role: m.role, content: m.text }));
    setMsgs(m => [...m, { role: 'user', text: question }]);
    setQ('');
    setBusy(true);
    try {
      if (acting) {
        // the agent: it may look things up and propose actions it shows as cards to confirm
        const r = await api('ai_agent', { q: question, page: title, portal: portalName, hist }, { timeout: AI_TIMEOUT });
        setMsgs(m => [...m, { role: 'assistant', text: r.answer, proposals: r.proposals || [], used: r.used || [] }]);
      } else {
        const r = await api('ai_ask', { q: question, page: title, portal: portalName, text: pageText, nav, hist, me: !!me }, { timeout: AI_TIMEOUT });
        setMsgs(m => [...m, { role: 'assistant', text: r.answer, page: r.page, work: r.work, live: r.live, liveAt: r.liveAsOf, liveStale: r.liveStale }]);
      }
    } catch (e) {
      setMsgs(m => [...m, { role: 'assistant', text: errText(e), err: true }]);
    }
    setBusy(false);
  };
  return html`<${Fragment}>
    <button type="button" className="btn ghost sm askai-btn" onClick=${() => setOpen(!open)} aria-expanded=${open} title=${AI_NAME + ': this page, your day, your email'}><${AiMark} /><span className="askai-label">${AI_NAME}</span></button>
    ${
      open &&
      html`<div className="askai" role="dialog" aria-label=${AI_NAME}>
        <div className="askai-head">
          <div style=${{ minWidth: 0 }}>
            <b className="askai-title"><${AiMark} size=${22} /> ${AI_NAME}</b>
            <div className="muted small">${title}${aiOn('page') ? (usePage ? ' · reads this page' : ' · page not shared') : ''}</div>
          </div>
          <div className="actions">
            ${msgs.length > 0 && html`<button type="button" className="btn ghost sm" onClick=${() => setMsgs([])}>New</button>`}
            <button type="button" className="btn ghost icon sm" aria-label="Close" onClick=${() => setOpen(false)}><${Icon} n="x" /></button>
          </div>
        </div>
        <div className="askai-body" ref=${box}>
          ${
            msgs.length === 0 &&
            html`<div className="askai-hello">
              <p>Hi${Cap.me && Cap.me.name ? ' ' + firstName(Cap.me.name) : ''}, I'm ${AI_NAME}. I can explain and teach this page, ${aiOn('work') ? 'plan your day from your tasks, timesheets and deadlines, ' : ''}help with your email and learning, and draft messages.${acting ? ' With "Do things for me" on, I can also look things up and get work done — I always show you a card to confirm before anything happens.' : aiActOn() ? ' I read your screen and never change anything (turn on "Do things for me" below to let me act, with your confirmation).' : ' I read what is on your screen and never change anything.'}</p>
              <div className="askai-starters">${(acting ? [['What can you do for me?', 'What can you do for me on this page — the things you can look up and the actions you can take for me?']] : []).concat(askStarters()).map(([n, t, me]) => html`<button key=${n} type="button" className="chip" onClick=${() => (t.endsWith(' ') ? (setQ(t), input.current && input.current.focus()) : ask(t, me))}>${n}</button>`)}</div>
            </div>`
          }
          ${msgs.map(
            (m, i) => html`<div key=${i} className=${'askai-msg ' + m.role + (m.err ? ' err' : '')}>
              ${m.role === 'assistant' && !m.err ? html`<${AiText} text=${m.text} />` : html`<p>${m.text}</p>`}
              ${
                m.role === 'assistant' && m.proposals && m.proposals.length > 0 &&
                html`<div className="ai-cards">${m.proposals.map(p => html`<${ProposalCard} key=${p.id} p=${p} onDone=${d => toast(d)} />`)}</div>`
              }
              ${m.role === 'assistant' && !m.err && html`<div className="askai-tools">
                <span>${m.work && html`<span className="muted small">Used your own tasks, timesheets and deadlines</span>`}${m.used && m.used.length ? html`<span className="muted small">Looked up: ${m.used.join(', ')}</span>` : ''}${m.live && html`<span className=${'chip ' + (m.liveStale ? 'warn' : 'ok')} title=${m.liveAt ? 'Official sources checked ' + m.liveAt : ''}>${m.liveStale ? 'Official immigration snapshot' : 'Live immigration sources'}</span>`}</span>
                <button type="button" className="btn ghost sm" onClick=${() => aiCopy(toast, m.text)}><${Icon} n="sheet" />Copy</button>
              </div>`}
            </div>`
          )}
          ${busy && html`<div className="askai-msg assistant"><span className="askai-typing"><i></i><i></i><i></i></span></div>`}
        </div>
        <form className="askai-foot" onSubmit=${e => { e.preventDefault(); ask(); }}>
          <textarea ref=${input} rows="2" value=${q} onInput=${e => setQ(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }} placeholder=${acting ? 'Ask ' + AI_NAME + ' to look something up or do something for you…' : 'Ask ' + AI_NAME + ' about this page, live immigration updates, your day…'} aria-label="Your question" />
          <div className="askai-row">
            <div className="askai-row-opts">
              ${aiActOn() ? html`<label className="check small" title="Let StratEdge AI look things up and propose actions; every change is a card you confirm."><input type="checkbox" checked=${act} onChange=${e => setAct(e.target.checked)} /><span>Do things for me</span></label>` : ''}
              ${!acting && aiOn('page') ? html`<label className="check small"><input type="checkbox" checked=${usePage} onChange=${e => setUsePage(e.target.checked)} /><span>Share this page</span></label>` : ''}
            </div>
            <button type="submit" className="btn sm" disabled=${busy || !q.trim()}>${busy ? (acting ? 'Working…' : 'Thinking…') : acting ? 'Go' : 'Ask'}</button>
          </div>
        </form>
      </div>`
    }
  <//>`;
}

/* ---------- Write with AI ---------- */
const AI_WRITE_HINT = {
  email: 'e.g. Follow up with the vendor about the interview feedback for Ravi, ask for a decision by Friday',
  campaign: 'e.g. This week’s new contract roles: Java (Newark, hybrid), SAP PP/QM (remote), Network engineer (Charlotte)',
  reply: 'e.g. Thank them, confirm Tuesday 2 PM works, attach the updated resume',
  job: 'e.g. Senior Network Engineer, Charlotte NC, onsite, 12 months C2C, Cisco/Palo Alto/BGP, 8+ years',
  announcement: 'e.g. Office closed for Thanksgiving Thursday and Friday; timesheets due Wednesday',
  task: 'e.g. Upload your renewed COI before the end of the month',
  esign: 'e.g. Please review the rate and the start date before signing',
  vendor: 'e.g. Available immediately, $75/h C2C, can interview Tue/Wed afternoons',
  eod: 'e.g. 4 submissions (2 Java, 2 SAP), 1 interview set for Thursday, waiting on 2 RTRs',
  note: 'e.g. Spoke to the client, they want two more profiles by Monday',
  post: 'e.g. We are hiring Java developers for a healthcare client in NJ',
  generic: 'What should it say?',
};
function AiWrite({ kind, value, onUse, ctx, vars, label, subject }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ brief: '', tone: 'professional', len: 'medium' });
  const [busy, setBusy] = useState('');
  const [res, setRes] = useState(null);
  if (!aiOn('write')) return null;
  const has = !!String(value || '').trim();
  const run = async op => {
    setBusy(op);
    try {
      const r = await api('ai_write', { kind, op, brief: f.brief, text: op === 'write' && !f.useDraft ? '' : value || '', tone: f.tone, len: f.len, ctx: ctx || {}, vars: vars || [] }, { timeout: AI_TIMEOUT });
      setRes(r);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const use = mode => {
    const text = mode === 'append' && has ? String(value).replace(/\s+$/, '') + '\n\n' + res.text : res.text;
    onUse(text, res.subject || '');
    setOpen(false);
    setRes(null);
    toast(mode === 'append' ? 'Added below your text.' : 'Done. Read it over before you send it.');
  };
  return html`<${Fragment}>
    <button type="button" className="btn ghost sm aiwrite-btn" onClick=${() => setOpen(true)} title=${'Draft or improve this with ' + AI_NAME}><${AiMark} size=${16} />${label || 'Write with AI'}</button>
    ${
      open &&
      html`<${Modal} wide title=${'Write with ' + AI_NAME} onClose=${() => { setOpen(false); setRes(null); }} foot=${
        res
          ? html`<button type="button" className="btn ghost" onClick=${() => setRes(null)}>Back</button>${has && html`<button type="button" className="btn ghost" onClick=${() => use('append')}>Add below mine</button>`}<button type="button" className="btn" onClick=${() => use('replace')}>${has ? 'Replace mine with this' : 'Use this'}</button>`
          : html`<button type="button" className="btn ghost" onClick=${() => setOpen(false)}>Cancel</button><button type="button" className="btn" disabled=${!!busy} onClick=${() => run('write')}>${busy === 'write' ? 'Writing…' : 'Write it'}</button>`
      }>
        ${
          res
            ? html`<div className="form">
                ${res.subject && html`<${Field} label="Subject"><input value=${res.subject} onInput=${e => setRes({ ...res, subject: e.target.value })} /><//>`}
                <${Field} label="Draft (edit it here or after)"><textarea rows="14" value=${res.text} onInput=${e => setRes({ ...res, text: e.target.value })} /><//>
                <p className="muted small" style=${{ margin: 0 }}>Bracketed parts like [date] are details the assistant did not have: fill them in.${subject !== undefined && res.subject ? ' The subject line is used too.' : ''}</p>
              </div>`
            : html`<div className="form">
                <${Field} label="What should it say?"><textarea rows="4" value=${f.brief} onInput=${e => setF({ ...f, brief: e.target.value })} placeholder=${AI_WRITE_HINT[kind] || AI_WRITE_HINT.generic} /><//>
                <div className="row2">
                  <${Field} label="Tone"><select value=${f.tone} onChange=${e => setF({ ...f, tone: e.target.value })}>${[['professional', 'Professional'], ['friendly', 'Friendly'], ['persuasive', 'Persuasive'], ['concise', 'Concise'], ['formal', 'Formal']].map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//>
                  <${Field} label="Length"><select value=${f.len} onChange=${e => setF({ ...f, len: e.target.value })}>${[['short', 'Short'], ['medium', 'Medium'], ['long', 'Long']].map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select><//>
                </div>
                ${has && html`<label className="check small"><input type="checkbox" checked=${!!f.useDraft} onChange=${e => setF({ ...f, useDraft: e.target.checked })} /><span>Use what I have written as a starting point</span></label>`}
                ${
                  has &&
                  html`<div className="actions">
                    <span className="muted small">Or work on what is there:</span>
                    ${[['improve', 'Improve it'], ['shorten', 'Shorten'], ['expand', 'Expand'], ['fix', 'Fix grammar']].map(([op, n]) => html`<button key=${op} type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => run(op)}>${busy === op ? 'Working…' : n}</button>`)}
                  </div>`
                }
              </div>`
        }
      <//>`
    }
  <//>`;
}

/* ---------- Fill with AI: a pasted requirement or a resume -> form fields (only empty fields are filled unless asked) ---------- */
function AiFill({ kind, getText, base, onFill, label, allowFile }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(false);
  const fileRef = useRef(null);
  if (!aiOn('extract')) return null;
  const run = async file => {
    setBusy(true);
    try {
      let r;
      if (file) {
        const fd = new FormData();
        fd.append('kind', kind);
        fd.append('file', file);
        r = await api('ai_extract', fd, { timeout: AI_TIMEOUT });
      } else {
        const text = getText ? getText() : '';
        if (!text && !base) {
          if (allowFile) {
            setPick(true);
            setBusy(false);
            return;
          }
          toast(kind === 'req' ? 'Paste the requirement into the job description first.' : 'Paste the text first.', true);
          setBusy(false);
          return;
        }
        r = await api('ai_extract', { kind, text: text || '', base: text ? '' : base || '' }, { timeout: AI_TIMEOUT });
      }
      const n = onFill(r.fields || {});
      toast(n ? `Filled ${n} field${n === 1 ? '' : 's'}. Check them before saving.` : 'Nothing new to fill: the fields already had values.');
      setPick(false);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<span className="aifill">
    <button type="button" className="btn ghost sm" disabled=${busy} onClick=${() => run(null)}><${AiMark} size=${16} />${busy ? 'Reading…' : label || 'Fill with AI'}</button>
    ${
      pick &&
      allowFile &&
      html`<span className="aifill-pick"><span className="muted small">Pick the resume file:</span><input ref=${fileRef} type="file" accept=".pdf,.docx,.txt" onChange=${e => e.target.files[0] && run(e.target.files[0])} /></span>`
    }
  </span>`;
}
/* Merges AI fields into a form: empty fields only (returns how many were set). */
const aiMerge = (f, fields, keys) => {
  const next = { ...f };
  let n = 0;
  (keys || Object.keys(fields)).forEach(k => {
    const v = fields[k];
    if (v === undefined || v === null || v === '') return;
    const cur = next[k];
    if (cur === undefined || cur === null || String(cur).trim() === '' || (k === 'n' && String(cur) === '1')) {
      next[k] = v;
      n++;
    }
  });
  return [next, n];
};

/* ---------- v32: email help on an open message (My email, the email inbox) ---------- */
function AiMailHelp({ from, subject, text, sent, onDraft }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [res, setRes] = useState(null);
  useEffect(() => {
    setRes(null);
  }, [subject, text]);
  if (!aiOn('mail') || !String(text || '').trim()) return null;
  const run = async op => {
    setBusy(op);
    try {
      const r = await api('ai_mail', { op, from: from || '', subject: subject || '', text: String(text || '').slice(0, 9000) }, { timeout: AI_TIMEOUT });
      if ((op === 'reply' || op === 'followup') && onDraft) {
        onDraft(r.text, op);
        toast('Draft ready. Read it over before you send it.');
      } else setRes({ op, text: r.text });
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy('');
  };
  const b = (op, n) => html`<button type="button" className="btn ghost sm" disabled=${!!busy} onClick=${() => run(op)}>${busy === op ? 'Working…' : n}</button>`;
  return html`<div className="aimail">
      <div className="aimail-bar">
        <span className="aimail-name"><${AiMark} size=${18} />${AI_NAME}</span>
        ${b('summary', 'Summarize')}${b('actions', 'Action items')}${onDraft && (sent ? b('followup', 'Write a follow-up') : b('reply', 'Draft a reply'))}
      </div>
      ${
        res &&
        html`<div className="aimail-out">
          <${AiText} text=${res.text} />
          <div className="actions"><button type="button" className="btn ghost sm" onClick=${() => aiCopy(toast, res.text)}><${Icon} n="sheet" />Copy</button><button type="button" className="btn ghost sm" onClick=${() => setRes(null)}>Close</button></div>
        </div>`
      }
    </div>`;
}
