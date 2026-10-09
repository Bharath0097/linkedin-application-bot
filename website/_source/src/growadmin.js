/* ================= v30 staff pages: Compliance & deadlines (HR), Learning platform administration ================= */

/* ---------- Compliance: everyone's deadlines, the rule library, reminders ---------- */
function RuleEditModal({ rule, cats, statuses, onClose, onSave }) {
  const [f, setF] = useState({ id: '', cat: 'all', who: 'all', t: '', dl: '', s: '', d: '', risk: '', src: [], ...rule });
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const whoMode = f.who === 'all' ? 'all' : f.who === 'nonciz' ? 'nonciz' : 'some';
  const whoList = Array.isArray(f.who) ? f.who : [];
  return html`<${Modal} title=${rule.id ? 'Edit rule' : 'New rule'} onClose=${onClose} wide foot=${html`<button className="btn ghost" onClick=${onClose}>Cancel</button><button className="btn" onClick=${() => { if (!f.t.trim()) return; onSave({ ...f, id: f.id || f.t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) }); }}>Save</button>`}>
      <div className="form">
        <div className="row3">
          <${Field} label="Title"><input value=${f.t} onChange=${e => set('t', e.target.value)} /><//>
          <${Field} label="Category"><select value=${f.cat} onChange=${e => set('cat', e.target.value)}>${Object.entries(cats).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
          <${Field} label="Deadline (short)"><input value=${f.dl} onChange=${e => set('dl', e.target.value)} placeholder="e.g. 10 days" /><//>
        </div>
        <${Field} label="Applies to">
          <select value=${whoMode} onChange=${e => set('who', e.target.value === 'some' ? [] : e.target.value)}>
            <option value="all">Everyone</option>
            <option value="nonciz">Everyone except U.S. citizens</option>
            <option value="some">Only these statuses…</option>
          </select>
        <//>
        ${whoMode === 'some' && html`<div className="checks">${Object.entries(statuses).map(([k, v]) => html`<label key=${k} className="check small"><input type="checkbox" checked=${whoList.includes(k)} onChange=${e => set('who', e.target.checked ? [...whoList, k] : whoList.filter(x => x !== k))} /> ${v}</label>`)}</div>`}
        <${Field} label="Summary (one or two sentences)"><textarea rows="2" value=${f.s} onChange=${e => set('s', e.target.value)} /><//>
        <${Field} label="Details" hint="Blank line between paragraphs, '- ' for bullets, **bold**, [text](https://link)"><textarea rows="6" value=${f.d} onChange=${e => set('d', e.target.value)} /><//>
        <${Field} label="If it is missed"><input value=${f.risk} onChange=${e => set('risk', e.target.value)} /><//>
        <div>
          <div className="ph-row"><b>Sources</b><button type="button" className="btn ghost sm" onClick=${() => set('src', [...(f.src || []), { l: '', u: '' }])}><${Icon} n="plus" />Add</button></div>
          ${(f.src || []).map((s, i) => html`<div key=${i} className="row2" style=${{ marginBottom: 8 }}><input value=${s.l} placeholder="Label" onChange=${e => set('src', f.src.map((x, j) => (j === i ? { ...x, l: e.target.value } : x)))} /><div className="actions"><input value=${s.u} placeholder="https://" onChange=${e => set('src', f.src.map((x, j) => (j === i ? { ...x, u: e.target.value } : x)))} /><button type="button" className="btn ghost icon" aria-label="Remove" onClick=${() => set('src', f.src.filter((_, j) => j !== i))}><${Icon} n="trash" /></button></div></div>`)}
        </div>
      </div>
    <//>`;
}
function ComplianceAdminPage({ q }) {
  const P = usePortal();
  const toast = useToast();
  const [tab, setTab] = useState((q && q.tab) || 'deadlines');
  const [ov, setOv] = useState(null);
  const [rules, setRules] = useState(null);
  const [person, setPerson] = useState(null);
  const [editRule, setEditRule] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => Promise.all([api('comp_overview'), api('comp_rules')]).then(([o, r]) => { setOv(o); setRules(r); }, e => toast(errText(e), true));
  useEffect(() => {
    load();
  }, []);
  if (!ov || !rules) return html`<${Spinner} />`;
  const name = uid => kitName(P, uid) || (ov.rows.find(r => r.uid === uid) || {}).n || uid;
  const saveRules = async items => {
    setBusy(true);
    try {
      const r = await api('comp_rules_save', { items });
      setRules({ ...rules, items: r.items });
      toast('Rules saved.');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const late = ov.rows.filter(r => r.late).length;
  const soon = ov.rows.filter(r => r.soon).length;
  const within = (d, n) => d && compDays(ov.today, d) <= n;
  return html`<div className="stack comp">
      <${KitStats} items=${[{ v: ov.rows.length, l: 'People with a status on file' }, { v: late, l: 'With overdue items', tone: late ? 'warn' : '' }, { v: soon, l: 'Due within 30 days', tone: soon ? 'warn' : '' }, { v: ov.rows.filter(r => within(r.workExp, 60)).length, l: 'Work authorization ending in 60 days' }, { v: ov.missing.length, l: 'No status set yet' }]} />
      <${KitTabs} tab=${tab} onTab=${setTab} tabs=${[['deadlines', 'Deadlines', late + soon || null], ['missing', 'Not set up', ov.missing.length || null], ['rules', 'Rule library', rules.items.length], ['reminders', 'Reminders']]} />
      ${
        tab === 'deadlines' &&
        html`<section className="panel" style=${{ padding: '6px 8px' }}>
          ${
            ov.rows.length
              ? html`<div className="tblwrap"><table className="tbl">
                  <thead><tr><th>Person</th><th>Status</th><th>Next deadline</th><th>Overdue</th><th>Soon</th><th>Work authorization</th><th>Passport</th><th>Unemployment</th><th>Green card</th></tr></thead>
                  <tbody>
                    ${ov.rows.map(r => html`<tr key=${r.uid} className="click" onClick=${() => setPerson(r.uid)}>
                      <td><b>${r.n}</b><div className="muted small">${r.role}</div></td>
                      <td>${r.stName || html`<span className="muted">—</span>`}</td>
                      <td>${r.next ? html`<b>${fmtDate(r.next.due, { month: 'short', day: 'numeric', year: 'numeric' })}</b><div className="muted small">${r.next.ti}</div>` : html`<span className="muted">—</span>`}</td>
                      <td>${r.late ? html`<span className="chip red">${r.late}</span>` : html`<span className="muted">0</span>`}</td>
                      <td>${r.soon ? html`<span className="chip amber">${r.soon}</span>` : html`<span className="muted">0</span>`}</td>
                      <td>${r.workExp ? html`<span className=${'chip ' + (within(r.workExp, 0) ? 'red' : within(r.workExp, 60) ? 'amber' : '')}>${fmtDate(r.workExp, { month: 'short', day: 'numeric', year: 'numeric' })}</span>` : html`<span className="muted">—</span>`}</td>
                      <td>${r.passExp ? html`<span className=${'chip ' + (within(r.passExp, 180) ? 'amber' : '')}>${fmtDate(r.passExp, { month: 'short', day: 'numeric', year: 'numeric' })}</span>` : html`<span className="muted">—</span>`}</td>
                      <td>${r.unemp ? html`<span className=${'chip ' + (r.unemp.left <= 30 ? 'red' : '')}>${r.unemp.used} / ${r.unemp.limit}</span>` : html`<span className="muted">—</span>`}</td>
                      <td>${{ none: '—', perm: 'PERM', i140: 'I-140', i485: 'I-485' }[r.gc] || '—'}</td>
                    </tr>`)}
                  </tbody>
                </table></div>`
              : html`<${Empty} title="Nobody has set a status yet">Consultants and employees set their status under USCIS compliance in their portal; their deadlines then appear here.<//>`
          }
        </section>`
      }
      ${
        tab === 'missing' &&
        html`<section className="panel">
          <h2 className="ph">People without a compliance status</h2>
          <p className="muted small">Ask them to open <b>USCIS compliance</b> in their portal and set their status; or open a person below and fill it in for them.</p>
          ${ov.missing.length ? html`<div className="chips" style=${{ marginTop: 10 }}>${ov.missing.map(m => html`<button key=${m.uid} type="button" className="chipbtn" onClick=${() => setPerson(m.uid)}>${m.n} <span className="muted">· ${m.role}</span></button>`)}</div>` : html`<p className="muted">Everyone active has a status on file.</p>`}
        </section>`
      }
      ${
        tab === 'rules' &&
        html`<div className="stack">
          <div className="ph-row">
            <p className="muted small" style=${{ margin: 0 }}>What consultants read under USCIS compliance › Rules & regulations, and what each checklist item links to. Built-in text reviewed ${rules.rev}; edit freely or restore the built-in library.</p>
            <div className="actions">
              <button type="button" className="btn ghost" disabled=${busy} onClick=${async () => { if (!confirm('Replace every rule with the built-in library?')) return; try { const r = await api('comp_rules_reset'); setRules({ ...rules, items: r.items }); toast('Built-in rules restored.'); } catch (e) { toast(errText(e), true); } }}>Restore built-in</button>
              <button type="button" className="btn" onClick=${() => setEditRule({})}><${Icon} n="plus" />New rule</button>
            </div>
          </div>
          <section className="panel" style=${{ padding: '6px 8px' }}>
            <div className="tblwrap"><table className="tbl">
              <thead><tr><th>Rule</th><th>Category</th><th>Applies to</th><th>Deadline</th><th className="r"><span className="sr">Actions</span></th></tr></thead>
              <tbody>
                ${rules.items.map((r, i) => html`<tr key=${r.id}>
                  <td><b>${r.t}</b><div className="muted small">${(r.s || '').slice(0, 120)}${(r.s || '').length > 120 ? '…' : ''}</div></td>
                  <td>${rules.cats[r.cat] || r.cat}</td>
                  <td className="small">${r.who === 'all' ? 'Everyone' : r.who === 'nonciz' ? 'All non-citizens' : (r.who || []).map(w => (rules.statuses[w] || w).split(' ')[0]).join(', ')}</td>
                  <td className="small">${r.dl}</td>
                  <td className="r"><div className="actions" style=${{ justifyContent: 'flex-end' }}>
                    <button type="button" className="btn ghost sm" onClick=${() => setEditRule(r)}>Edit</button>
                    <button type="button" className="btn ghost sm" disabled=${i === 0} onClick=${() => { const items = [...rules.items]; [items[i - 1], items[i]] = [items[i], items[i - 1]]; saveRules(items); }} aria-label="Move up"><${Icon} n="up" /></button>
                    <button type="button" className="btn ghost sm" onClick=${() => { if (confirm(`Delete "${r.t}"?`)) saveRules(rules.items.filter(x => x.id !== r.id)); }}>Delete</button>
                  </div></td>
                </tr>`)}
              </tbody>
            </table></div>
          </section>
        </div>`
      }
      ${
        tab === 'reminders' &&
        html`<section className="panel">
          <h2 className="ph">Reminders</h2>
          <p className="muted small">The cron job (api/cron.php, the same one that collects jobs and sends queued email) e-mails each person 14 days and 3 days before a deadline and the day after it is missed - once per item. HR items (I-9 reverification) show on the Deadlines tab; the person is reminded too.</p>
          <div className="actions" style=${{ marginTop: 10 }}>
            <button type="button" className="btn ghost" disabled=${busy} onClick=${async () => { setBusy(true); try { const r = await api('comp_cron'); toast(`Checked ${r.people} people, sent ${r.sent} reminder${r.sent === 1 ? '' : 's'}.`); } catch (e) { toast(errText(e), true); } setBusy(false); }}>Run the reminder check now</button>
          </div>
        </section>`
      }
      ${
        person &&
        html`<${Modal} title=${'Compliance · ' + name(person)} onClose=${() => { setPerson(null); load(); }} wide>
          <${CompliancePage} uid=${person} embedded />
        <//>`
      }
      ${editRule && html`<${RuleEditModal} rule=${editRule} cats=${rules.cats} statuses=${rules.statuses} onClose=${() => setEditRule(null)} onSave=${r => { let items; if (editRule.id) items = rules.items.map(x => (x.id === editRule.id ? { ...r, id: editRule.id } : x)); else { const base = r.id || 'rule'; let id = base, n = 2; while (rules.items.some(x => x.id === id)) id = base.slice(0, 36) + '-' + n++; items = [...rules.items, { ...r, id }]; } saveRules(items); setEditRule(null); }} />`}
    </div>`;
}

/* ---------- Learning: course editor, assignments, progress, project catalog ---------- */
const QUIZ_TYPES = [['mc', 'Multiple choice (one answer)'], ['multi', 'Multiple choice (several answers)'], ['tf', 'True / false'], ['fill', 'Fill in the blank'], ['num', 'A number'], ['order', 'Put the steps in order'], ['match', 'Match the pairs'], ['scramble', 'Unscramble a term']];
function QuizItemEditor({ q, onChange, onRemove }) {
  const set = (k, v) => onChange({ ...q, [k]: v });
  const lines = v => (Array.isArray(v) ? v.join('\n') : '');
  const fromLines = s => s.split('\n').map(x => x.trim()).filter(Boolean);
  return html`<div className="qedit">
      <div className="row2">
        <${Field} label="Type"><select value=${q.ty} onChange=${e => set('ty', e.target.value)}>${QUIZ_TYPES.map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select><//>
        <div className="actions" style=${{ alignSelf: 'end', justifyContent: 'flex-end' }}><button type="button" className="btn ghost sm" onClick=${onRemove}><${Icon} n="trash" />Remove</button></div>
      </div>
      <${Field} label="Question"><input value=${q.q || ''} onChange=${e => set('q', e.target.value)} /><//>
      ${['mc', 'multi'].includes(q.ty) && html`<${Field} label="Options (one per line)"><textarea rows="4" value=${lines(q.o)} onChange=${e => set('o', fromLines(e.target.value))} /><//>`}
      ${q.ty === 'mc' && html`<${Field} label="Correct option (1 = first)"><input type="number" min="1" value=${(q.a || 0) + 1} onChange=${e => set('a', Math.max(0, Number(e.target.value) - 1))} /><//>`}
      ${q.ty === 'multi' && html`<${Field} label="Correct options (numbers, comma separated; 1 = first)"><input value=${(q.a || []).map(x => x + 1).join(', ')} onChange=${e => set('a', e.target.value.split(',').map(x => Number(x.trim()) - 1).filter(x => x >= 0))} /><//>`}
      ${q.ty === 'tf' && html`<${Field} label="Correct answer"><select value=${q.a ? '1' : '0'} onChange=${e => set('a', e.target.value === '1')}><option value="1">True</option><option value="0">False</option></select><//>`}
      ${q.ty === 'fill' && html`<${Field} label="Accepted answers (one per line)"><textarea rows="2" value=${lines(q.a)} onChange=${e => set('a', fromLines(e.target.value))} /><//>`}
      ${q.ty === 'num' && html`<div className="row2"><${Field} label="Answer"><input type="number" step="any" value=${q.a == null ? '' : q.a} onChange=${e => set('a', Number(e.target.value))} /><//><${Field} label="Tolerance (±)"><input type="number" step="any" value=${q.tol || 0} onChange=${e => set('tol', Number(e.target.value))} /><//></div>`}
      ${q.ty === 'order' && html`<${Field} label="Steps in the correct order (one per line; shown shuffled)"><textarea rows="4" value=${lines(q.o)} onChange=${e => set('o', fromLines(e.target.value))} /><//>`}
      ${q.ty === 'match' && html`<${Field} label="Pairs, one per line as left = right"><textarea rows="4" value=${(q.pairs || []).map(p => p.join(' = ')).join('\n')} onChange=${e => set('pairs', fromLines(e.target.value).map(l => l.split('=').map(x => x.trim())).filter(p => p.length >= 2 && p[0] && p[1]).map(p => [p[0], p.slice(1).join('=')]))} /><//>`}
      ${q.ty === 'scramble' && html`<div className="row2"><${Field} label="The term"><input value=${q.a || ''} onChange=${e => set('a', e.target.value)} /><//><${Field} label="Hint"><input value=${q.hint || ''} onChange=${e => set('hint', e.target.value)} /><//></div>`}
      <${Field} label="Explanation shown after answering"><input value=${q.why || ''} onChange=${e => set('why', e.target.value)} /><//>
    </div>`;
}
/* ---------- Create a course with AI: topic -> editable outline -> lessons and quizzes written module by module ---------- */
const COURSE_FIELDS = ['IT & software', 'Healthcare', 'Business & finance', 'HR & recruiting', 'Compliance & immigration', 'Career & soft skills', 'Other'];
function CourseAiBuilder({ onClose, onDone }) {
  const toast = useToast();
  const [step, setStep] = useState('form');
  const [f, setF] = useState({ topic: '', field: 'Healthcare', audience: 'Consultants and employees', level: 'Essential', modules: 4, lessons: 3, quiz: 4, puzzles: true, cert: true, goals: '' });
  const [o, setO] = useState(null);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState({ i: 0, n: 0, failed: [] });
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const draft = async () => {
    if (f.topic.trim().length < 3) {
      toast('Say what the course is about.', true);
      return;
    }
    setBusy(true);
    try {
      const r = await api('learn_ai_outline', f, { timeout: 120000 });
      setO(r.outline);
      setStep('outline');
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const setMod = (mi, patch) => setO(x => ({ ...x, mods: x.mods.map((m, i) => (i === mi ? { ...m, ...patch } : m)) }));
  const write = async () => {
    const mods = o.mods.map(m => ({ ...m, ls: m.ls.filter(l => l.t.trim()) })).filter(m => m.t.trim() && m.ls.length);
    if (!mods.length) {
      toast('Keep at least one module with a lesson.', true);
      return;
    }
    setStep('writing');
    const done = [];
    const failed = [];
    for (let i = 0; i < mods.length; i++) {
      setProg({ i, n: mods.length, failed: [...failed] });
      let mod = null;
      for (let attempt = 0; attempt < 2 && !mod; attempt++) {
        try {
          const r = await api('learn_ai_module', { course: { t: o.t, desc: o.desc, level: o.level, audience: f.audience }, module: mods[i], quiz: f.quiz, puzzles: f.puzzles }, { timeout: 180000 });
          mod = r.module;
        } catch (e) {
          if (attempt === 1) failed.push(mods[i].t);
        }
      }
      // a module the assistant could not write keeps its planned lessons, empty, to fill in by hand
      done.push(mod || { id: 'm' + (i + 1), t: mods[i].t, ls: mods[i].ls.map(l => ({ id: 'l' + rid8(), t: l.t, body: (l.points || []).map(p => '- ' + p).join('\n'), quiz: [] })) });
    }
    setProg({ i: mods.length, n: mods.length, failed });
    const course = { t: o.t, desc: o.desc, cat: o.cat, level: o.level, min: o.min, pass: 70, cert: f.cert, req: [], pub: false, ord: 50, mods: done };
    if (failed.length) toast(`${failed.length} module${failed.length === 1 ? '' : 's'} could not be written (${failed.join(', ')}); their lessons are there to fill in.`, true);
    else toast('Course drafted. Review it, then save; it stays unpublished until you tick Published.');
    onDone(course);
  };
  const foot =
    step === 'form'
      ? html`<button type="button" className="btn ghost" onClick=${onClose}>Cancel</button><button type="button" className="btn" disabled=${busy} onClick=${draft}><${Icon} n="spark" />${busy ? 'Drafting the outline…' : 'Draft the outline'}</button>`
      : step === 'outline'
        ? html`<button type="button" className="btn ghost" onClick=${() => setStep('form')}>Back</button><button type="button" className="btn" onClick=${write}><${Icon} n="spark" />Write the lessons and quizzes</button>`
        : html`<span className="muted small">Writing module ${Math.min(prog.i + 1, prog.n)} of ${prog.n}…</span>`;
  return html`<${Modal} wide title="Create a course with AI" onClose=${step === 'writing' ? () => {} : onClose} foot=${foot}>
    ${
      step === 'form' &&
      html`<div className="form">
        <p className="muted small" style=${{ margin: 0 }}>Describe the course; the assistant drafts an outline you can edit, then writes every lesson with quizzes and puzzles. Nothing is published until you review it in the course editor.</p>
        <${Field} label="What is the course about?"><input value=${f.topic} onInput=${e => set('topic', e.target.value)} placeholder="e.g. HIPAA basics for consultants on hospital projects; Medical billing fundamentals; Excel for month-end close" /><//>
        <div className="row3">
          <${Field} label="Field"><select value=${f.field} onChange=${e => set('field', e.target.value)}>${COURSE_FIELDS.map(x => html`<option key=${x}>${x}</option>`)}</select><//>
          <${Field} label="For"><select value=${f.audience} onChange=${e => set('audience', e.target.value)}>${['Consultants and employees', 'Consultants', 'Employees', 'Recruiters and staff', 'New hires'].map(x => html`<option key=${x}>${x}</option>`)}</select><//>
          <${Field} label="Level"><select value=${f.level} onChange=${e => set('level', e.target.value)}>${['Starter', 'Essential', 'Advanced'].map(x => html`<option key=${x}>${x}</option>`)}</select><//>
        </div>
        <div className="row3">
          <${Field} label="Modules"><input type="number" min="1" max="10" value=${f.modules} onInput=${e => set('modules', Number(e.target.value))} /><//>
          <${Field} label="Lessons per module"><input type="number" min="1" max="6" value=${f.lessons} onInput=${e => set('lessons', Number(e.target.value))} /><//>
          <${Field} label="Quiz questions per lesson"><input type="number" min="0" max="8" value=${f.quiz} onInput=${e => set('quiz', Number(e.target.value))} /><//>
        </div>
        <div className="checks">
          <label className="check"><input type="checkbox" checked=${f.puzzles} onChange=${e => set('puzzles', e.target.checked)} /> Include puzzles (put in order, match the pairs, unscramble)</label>
          <label className="check"><input type="checkbox" checked=${f.cert} onChange=${e => set('cert', e.target.checked)} /> Issues a certificate</label>
        </div>
        <${Field} label="What should learners be able to do afterwards? (optional)"><textarea rows="3" value=${f.goals} onInput=${e => set('goals', e.target.value)} placeholder="e.g. Recognize PHI, follow minimum-necessary rules on client sites, report a suspected breach within the hour" /><//>
      </div>`
    }
    ${
      step === 'outline' &&
      o &&
      html`<div className="form">
        <div className="row2">
          <${Field} label="Course title"><input value=${o.t} onInput=${e => setO({ ...o, t: e.target.value })} /><//>
          <${Field} label="Category"><input value=${o.cat} onInput=${e => setO({ ...o, cat: e.target.value })} /><//>
        </div>
        <${Field} label="Description"><textarea rows="2" value=${o.desc} onInput=${e => setO({ ...o, desc: e.target.value })} /><//>
        <p className="muted small" style=${{ margin: 0 }}>Rename, remove or add modules and lessons; the lessons are written from these titles.</p>
        ${o.mods.map((m, mi) => html`<div key=${mi} className="panel" style=${{ background: 'var(--surface-2)', padding: '10px 12px' }}>
          <div className="actions" style=${{ flexWrap: 'nowrap' }}><b className="muted small">${mi + 1}.</b><input value=${m.t} onInput=${e => setMod(mi, { t: e.target.value })} style=${{ fontWeight: 600 }} /><button type="button" className="btn ghost icon sm" aria-label="Remove module" onClick=${() => setO({ ...o, mods: o.mods.filter((_, i) => i !== mi) })}><${Icon} n="trash" /></button></div>
          <div className="stack" style=${{ gap: 6, marginTop: 6, paddingLeft: 22 }}>
            ${m.ls.map((l, li) => html`<div key=${li} className="actions" style=${{ flexWrap: 'nowrap' }}><input value=${l.t} onInput=${e => setMod(mi, { ls: m.ls.map((x, j) => (j === li ? { ...x, t: e.target.value } : x)) })} /><button type="button" className="btn ghost icon sm" aria-label="Remove lesson" onClick=${() => setMod(mi, { ls: m.ls.filter((_, j) => j !== li) })}><${Icon} n="x" /></button></div>`)}
            <div><button type="button" className="btn link sm" onClick=${() => setMod(mi, { ls: [...m.ls, { t: 'New lesson', points: [] }] })}>+ lesson</button></div>
          </div>
        </div>`)}
        <div><button type="button" className="btn ghost sm" onClick=${() => setO({ ...o, mods: [...o.mods, { t: 'New module', ls: [{ t: 'New lesson', points: [] }] }] })}><${Icon} n="plus" />Module</button></div>
      </div>`
    }
    ${
      step === 'writing' &&
      html`<div className="stack" style=${{ gap: 10 }}>
        <p>Writing the lessons, quizzes${f.puzzles ? ' and puzzles' : ''} - about 20-60 seconds per module. Keep this window open.</p>
        <div className="bar"><span style=${{ width: Math.round((prog.n ? prog.i / prog.n : 0) * 100) + '%' }}></span></div>
        <div className="muted small">${prog.i} of ${prog.n} modules done${prog.failed.length ? ' · could not write: ' + prog.failed.join(', ') : ''}</div>
      </div>`
    }
  <//>`;
}
function CourseEditor({ course, ai, aiCourses, onClose, onSaved }) {
  const toast = useToast();
  const [aiMod, setAiMod] = useState(null);
  const [c, setC] = useState(() => JSON.parse(JSON.stringify({ t: '', desc: '', cat: '', level: '', min: 30, pass: 70, cert: false, req: [], pub: false, ord: 50, mods: [], ...course })));
  const [sel, setSel] = useState(() => (course.mods && course.mods[0] && course.mods[0].ls[0] ? [0, 0] : null));
  const [busy, setBusy] = useState(false);
  // v83: the AI calls below finish after the person may have kept editing, so their results are merged into the latest course (cRef / functional updates), never into the copy captured on click.
  const cRef = useRef(c);
  cRef.current = c;
  const set = (k, v) => setC(x => ({ ...x, [k]: v }));
  const setMod = (mi, patch) => setC(x => ({ ...x, mods: x.mods.map((m, i) => (i === mi ? { ...m, ...patch } : m)) }));
  const setLesson = (mi, li, patch) => setC(x => ({ ...x, mods: x.mods.map((m, i) => (i !== mi ? m : { ...m, ls: m.ls.map((l, j) => (j === li ? { ...l, ...(typeof patch === 'function' ? patch(l) : patch) } : l)) })) }));
  const lesson = sel ? ((c.mods[sel[0]] || {}).ls || [])[sel[1]] : null;
  const save = async () => {
    if (!c.t.trim()) {
      toast('The course needs a title.', true);
      return;
    }
    setBusy(true);
    try {
      const r = await api('learn_course_save', { course: c });
      toast('Course saved.');
      onSaved(r.course);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  const genQuiz = async () => {
    if (!lesson || !lesson.body) return;
    const [mi, li] = sel;
    const lid = lesson.id;
    setBusy(true);
    try {
      const r = await api('learn_ai_quiz', { text: lesson.body, n: 5 });
      // add the questions to the lesson the text came from, as it is now (it may have moved or been removed meanwhile)
      setC(x => {
        let at = x.mods[mi] && x.mods[mi].ls[li] && x.mods[mi].ls[li].id === lid ? [mi, li] : null;
        if (!at && lid) x.mods.some((m, i) => { const j = m.ls.findIndex(l => l.id === lid); if (j >= 0) at = [i, j]; return j >= 0; });
        if (!at) return x;
        return { ...x, mods: x.mods.map((m, i) => (i !== at[0] ? m : { ...m, ls: m.ls.map((l, j) => (j === at[1] ? { ...l, quiz: [...(l.quiz || []), ...r.items] } : l)) })) };
      });
      toast(`${r.items.length} questions added - review them before publishing.`);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} title=${course.id ? 'Edit course' : 'New course'} onClose=${onClose} wide foot=${html`<button className="btn ghost" onClick=${onClose}>Close</button><button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save course'}</button>`}>
      <div className="form">
        <div className="row2">
          <${Field} label="Title"><input value=${c.t} onChange=${e => set('t', e.target.value)} /><//>
          <${Field} label="Category"><input value=${c.cat} onChange=${e => set('cat', e.target.value)} placeholder="Compliance, Credentials, Career…" /><//>
        </div>
        <${Field} label="Description"><textarea rows="2" value=${c.desc} onChange=${e => set('desc', e.target.value)} /><//>
        <div className="row3">
          <${Field} label="Level"><input value=${c.level} onChange=${e => set('level', e.target.value)} placeholder="Starter, Essential…" /><//>
          <${Field} label="Minutes"><input type="number" value=${c.min} onChange=${e => set('min', Number(e.target.value))} /><//>
          <${Field} label="Pass mark %"><input type="number" min="0" max="100" value=${c.pass} onChange=${e => set('pass', Number(e.target.value))} /><//>
        </div>
        <div className="checks">
          <label className="check"><input type="checkbox" checked=${!!c.pub} onChange=${e => set('pub', e.target.checked)} /> Published (visible to learners)</label>
          <label className="check"><input type="checkbox" checked=${!!c.cert} onChange=${e => set('cert', e.target.checked)} /> Issues a certificate</label>
          ${[['consultant', 'Required for consultants'], ['employee', 'Required for employees'], ['staff', 'Required for all staff (yearly security course)']].map(([k, l]) => html`<label key=${k} className="check"><input type="checkbox" checked=${(c.req || []).includes(k)} onChange=${e => set('req', e.target.checked ? [...(c.req || []), k] : (c.req || []).filter(x => x !== k))} /> ${l}</label>`)}
        </div>
        <div className="coedit">
          <div className="coedit-tree">
            <div className="ph-row"><b>Modules</b><div className="actions">${aiCourses && html`<button type="button" className="btn ghost sm" disabled=${busy} onClick=${() => setAiMod({ t: '', n: 3 })}><${Icon} n="spark" />Module with AI</button>`}<button type="button" className="btn ghost sm" onClick=${() => { set('mods', [...c.mods, { id: 'm' + (c.mods.length + 1), t: 'New module', ls: [{ id: 'l' + rid8(), t: 'New lesson', body: '', quiz: [] }] }]); setSel([c.mods.length, 0]); }}><${Icon} n="plus" />Module</button></div></div>
            ${
              aiMod &&
              html`<div className="panel form" style=${{ background: 'var(--surface-2)', padding: 10 }}>
                <${Field} label="New module about"><input value=${aiMod.t} onInput=${e => setAiMod({ ...aiMod, t: e.target.value })} placeholder="e.g. Reporting a suspected breach" /><//>
                <div className="actions">
                  <input type="number" min="1" max="6" value=${aiMod.n} onInput=${e => setAiMod({ ...aiMod, n: Number(e.target.value) })} style=${{ width: 70 }} aria-label="Lessons" /><span className="muted small">lessons</span>
                  <button type="button" className="btn sm" disabled=${busy || !aiMod.t.trim()} onClick=${async () => { setBusy(true); try { const r = await api('learn_ai_module', { course: { t: c.t, desc: c.desc, level: c.level }, module: { t: aiMod.t, ls: [] }, lessons: aiMod.n, quiz: 4, puzzles: true }, { timeout: 180000 }); const at = cRef.current.mods.length; setC(x => ({ ...x, mods: [...x.mods, r.module] })); setSel([at, 0]); setAiMod(null); toast('Module written - review it before saving.'); } catch (e) { toast(errText(e), true); } setBusy(false); }}>${busy ? 'Writing…' : 'Write it'}</button>
                  <button type="button" className="btn ghost sm" onClick=${() => setAiMod(null)}>Cancel</button>
                </div>
              </div>`
            }
            ${c.mods.map((m, mi) => html`<div key=${mi} className="comod">
              <input className="modtitle" value=${m.t} onChange=${e => setMod(mi, { t: e.target.value })} />
              ${m.ls.map((l, li) => html`<button key=${li} type="button" className=${'coles' + (sel && sel[0] === mi && sel[1] === li ? ' on' : '')} onClick=${() => setSel([mi, li])}><${Icon} n=${l.quiz && l.quiz.length ? 'flask' : 'file'} />${l.t}</button>`)}
              <div className="actions"><button type="button" className="btn link sm" onClick=${() => { setMod(mi, { ls: [...m.ls, { id: 'l' + rid8(), t: 'New lesson', body: '', quiz: [] }] }); setSel([mi, m.ls.length]); }}>+ lesson</button><button type="button" className="btn link sm" onClick=${() => { if (confirm('Remove this module and its lessons?')) { set('mods', c.mods.filter((_, i) => i !== mi)); setSel(null); } }}>remove module</button></div>
            </div>`)}
          </div>
          <div className="coedit-main">
            ${
              lesson
                ? html`<div className="form">
                    <div className="row2" style=${{ alignItems: 'end' }}>
                      <${Field} label="Lesson title"><input value=${lesson.t} onChange=${e => setLesson(sel[0], sel[1], { t: e.target.value })} /><//>
                      <div className="actions" style=${{ justifyContent: 'flex-end' }}><button type="button" className="btn ghost sm" onClick=${() => { if (confirm('Remove this lesson?')) { setMod(sel[0], { ls: c.mods[sel[0]].ls.filter((_, j) => j !== sel[1]) }); setSel(null); } }}>Remove lesson</button></div>
                    </div>
                    <${Field} label="Lesson text" hint="Blank line between paragraphs; '## ' for a heading; '- ' for bullets; **bold**; [text](https://link)"><textarea rows="12" value=${lesson.body} onChange=${e => setLesson(sel[0], sel[1], { body: e.target.value })} /><//>
                    <div className="ph-row"><b>Questions & puzzles (${(lesson.quiz || []).length})</b><div className="actions">${ai && html`<button type="button" className="btn ghost sm" disabled=${busy || !lesson.body} onClick=${genQuiz}><${Icon} n="spark" />Generate with AI</button>`}<button type="button" className="btn ghost sm" onClick=${() => setLesson(sel[0], sel[1], { quiz: [...(lesson.quiz || []), { ty: 'mc', q: '', o: ['', ''], a: 0, why: '' }] })}><${Icon} n="plus" />Question</button></div></div>
                    ${(lesson.quiz || []).map((q, qi) => html`<${QuizItemEditor} key=${qi} q=${q} onChange=${nq => setLesson(sel[0], sel[1], { quiz: lesson.quiz.map((x, j) => (j === qi ? nq : x)) })} onRemove=${() => setLesson(sel[0], sel[1], { quiz: lesson.quiz.filter((_, j) => j !== qi) })} />`)}
                  </div>`
                : html`<p className="muted">Pick a lesson on the left, or add a module.</p>`
            }
          </div>
        </div>
      </div>
    <//>`;
}
function BriefEditor({ item, onClose, onSaved }) {
  const toast = useToast();
  const [b, setB] = useState(() => ({ t: '', domain: '', level: 'mid', hours: 60, weeks: 6, summary: '', problem: '', stack: [], users: [], features: [], arch: { overview: '', components: [], data: [] }, nfr: [], accept: [], milestones: [], stretch: [], talk: [], resume: [], ...JSON.parse(JSON.stringify(item)) }));
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setB(x => ({ ...x, [k]: v }));
  const L = (k, label, rows) => html`<${Field} label=${label + ' (one per line)'}><textarea rows=${rows || 3} value=${(b[k] || []).join('\n')} onChange=${e => set(k, e.target.value.split('\n').map(x => x.trim()).filter(Boolean))} /><//>`;
  const msText = (b.milestones || []).map(m => `${m.t} | ${m.d}\n${(m.tasks || []).map(t => '- ' + t).join('\n')}`).join('\n\n');
  const parseMs = s => s.split(/\n\s*\n/).map(block => { const lines = block.split('\n').map(x => x.trim()).filter(Boolean); if (!lines.length) return null; const [t, d] = lines[0].split('|').map(x => x.trim()); return { t, d: Number(d) || 7, tasks: lines.slice(1).map(l => l.replace(/^- /, '')) }; }).filter(Boolean);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('proj_catalog_save', { item: b });
      toast('Saved to the catalog.');
      onSaved(r);
    } catch (e) {
      toast(errText(e), true);
    }
    setBusy(false);
  };
  return html`<${Modal} title=${item.id ? 'Edit catalog project' : 'New catalog project'} onClose=${onClose} wide foot=${html`<button className="btn ghost" onClick=${onClose}>Close</button><button className="btn" disabled=${busy} onClick=${save}>${busy ? 'Saving…' : 'Save'}</button>`}>
      <div className="form">
        <div className="row3">
          <${Field} label="Title"><input value=${b.t} onChange=${e => set('t', e.target.value)} /><//>
          <${Field} label="Field and domain"><div style=${{ display: 'flex', gap: 6 }}><select value=${b.track || 'it'} onChange=${e => set('track', e.target.value)} style=${{ maxWidth: 150 }}><option value="it">IT & software</option><option value="health">Healthcare</option><option value="biz">Business (non-IT)</option></select><input value=${b.domain} onChange=${e => set('domain', e.target.value)} placeholder="Domain" /></div><//>
          <${Field} label="Level"><select value=${b.level} onChange=${e => set('level', e.target.value)}><option value="junior">Junior</option><option value="mid">Mid-level</option><option value="senior">Senior</option><option value="lead">Lead</option></select><//>
        </div>
        <div className="row3">
          <${Field} label="Hours"><input type="number" value=${b.hours} onChange=${e => set('hours', Number(e.target.value))} /><//>
          <${Field} label="Weeks"><input type="number" value=${b.weeks} onChange=${e => set('weeks', Number(e.target.value))} /><//>
          <${Field} label=${(b.track || 'it') === 'it' ? 'Stack (comma separated)' : 'Tools (comma separated)'}><input value=${(b.stack || []).join(', ')} onChange=${e => set('stack', e.target.value.split(',').map(x => x.trim()).filter(Boolean))} /><//>
        </div>
        <${Field} label="Summary"><textarea rows="2" value=${b.summary} onChange=${e => set('summary', e.target.value)} /><//>
        <${Field} label="The client's problem"><textarea rows="3" value=${b.problem} onChange=${e => set('problem', e.target.value)} /><//>
        <div className="row2">${L('users', 'Users')}${L('features', 'Features', 5)}</div>
        <${Field} label="Architecture overview"><textarea rows="2" value=${b.arch.overview} onChange=${e => set('arch', { ...b.arch, overview: e.target.value })} /><//>
        <div className="row2">
          <${Field} label="Components (one per line)"><textarea rows="4" value=${(b.arch.components || []).join('\n')} onChange=${e => set('arch', { ...b.arch, components: e.target.value.split('\n').map(x => x.trim()).filter(Boolean) })} /><//>
          <${Field} label="Data entities (one per line)"><textarea rows="4" value=${(b.arch.data || []).join('\n')} onChange=${e => set('arch', { ...b.arch, data: e.target.value.split('\n').map(x => x.trim()).filter(Boolean) })} /><//>
        </div>
        <div className="row2">${L('nfr', 'Non-functional requirements')}${L('accept', 'Acceptance criteria', 4)}</div>
        <${Field} label="Milestones" hint="Blocks separated by a blank line: first line 'Title | days', then '- task' lines"><textarea rows="8" defaultValue=${msText} onBlur=${e => set('milestones', parseMs(e.target.value))} /><//>
        <div className="row3">${L('stretch', 'Stretch goals')}${L('talk', 'Interview questions')}${L('resume', 'Resume bullets')}</div>
      </div>
    <//>`;
}
function LearningAdminPage({ q }) {
  const P = usePortal();
  const toast = useToast();
  const [tab, setTab] = useState((q && q.tab) || 'courses');
  const [data, setData] = useState(null);
  const [ov, setOv] = useState(null);
  const [cat, setCat] = useState(null);
  const [projOv, setProjOv] = useState(null);
  const [edit, setEdit] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [build, setBuild] = useState(false);
  const [busy, setBusy] = useState(false);
  const [assignUid, setAssignUid] = useState('');
  const assignRef = useRef(null);
  const assignQ = useRef(Promise.resolve());
  const load = () => api('learn_courses_admin').then(setData, e => toast(errText(e), true));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (tab === 'progress' && !ov) api('learn_overview').then(setOv, e => toast(errText(e), true));
    if (tab === 'catalog' && !cat) api('proj_catalog').then(r => setCat(r.items), e => toast(errText(e), true));
    if (tab === 'live' && !projOv) api('proj_overview').then(setProjOv, e => toast(errText(e), true));
  }, [tab]);
  if (!data) return html`<${Spinner} />`;
  const courses = data.courses;
  const assign = data.assign;
  // each change is applied to the latest record (including changes still being saved) and saves go out one after another,
  // because learn_assign_save replaces the whole record: a quick second change must not undo the first
  const saveAssign = mutate => {
    const next = mutate(assignRef.current || data.assign);
    assignRef.current = next;
    setData(d => ({ ...d, assign: next }));
    assignQ.current = assignQ.current.then(async () => {
      setBusy(true);
      try {
        const r = await api('learn_assign_save', next);
        if (assignRef.current === next) {
          assignRef.current = null;
          setData(d => ({ ...d, assign: r }));
        }
        toast('Assignments saved.');
      } catch (e) {
        assignRef.current = null;
        toast(errText(e), true);
        load();
      }
      setBusy(false);
    });
  };
  const people = kitPeople(P);
  return html`<div className="stack learn">
      <${KitStats} items=${[{ v: courses.length, l: 'Courses' }, { v: courses.filter(c => c.pub).length, l: 'Published' }, { v: courses.filter(c => (c.req || []).length).length, l: 'Required by role' }, { v: data.ai ? 'On' : 'Off', l: 'AI assistance (quiz generation, project briefs)' }]} />
      <${KitTabs} tab=${tab} onTab=${setTab} wrap tabs=${[['courses', 'Courses'], ['assign', 'Assignments'], ['progress', 'Progress'], ['catalog', 'Project catalog'], ['live', 'Live projects']]} />
      ${
        tab === 'courses' &&
        html`<div className="stack">
          <div className="ph-row"><p className="muted small" style=${{ margin: 0 }}>Six built-in courses come with the site (USCIS compliance, STEM OPT, CHEA credentials & accreditation, working through StratEdge, interviews, portfolio). Edit them, add your own, and restore a built-in course at any time.</p><div className="actions">${data.aiCourses && html`<button type="button" className="btn ghost" onClick=${() => setBuild(true)}><${Icon} n="spark" />Create with AI</button>`}<button type="button" className="btn" onClick=${() => setEdit({})}><${Icon} n="plus" />New course</button></div></div>
          <section className="panel" style=${{ padding: '6px 8px' }}>
            <div className="tblwrap"><table className="tbl">
              <thead><tr><th>Course</th><th>Category</th><th>Content</th><th>Required for</th><th>Status</th><th className="r"><span className="sr">Actions</span></th></tr></thead>
              <tbody>
                ${courses.map(c => { const n = c.mods.reduce((a, m) => a + m.ls.length, 0); const qn = c.mods.reduce((a, m) => a + m.ls.reduce((b, l) => b + (l.quiz || []).length, 0), 0); return html`<tr key=${c.id}>
                  <td><b>${c.t}</b><div className="muted small">${(c.desc || '').slice(0, 110)}${(c.desc || '').length > 110 ? '…' : ''}</div></td>
                  <td>${c.cat}${c.level && html`<div className="muted small">${c.level}</div>`}</td>
                  <td className="small">${c.mods.length} modules · ${n} lessons · ${qn} questions${c.cert ? ' · certificate' : ''}</td>
                  <td className="small">${(c.req || []).join(', ') || '—'}</td>
                  <td><span className=${'chip ' + (c.pub ? 'ok' : '')}>${c.pub ? 'Published' : 'Draft'}</span></td>
                  <td className="r"><div className="actions" style=${{ justifyContent: 'flex-end' }}>
                    <a className="btn ghost sm" href=${'#/portal/learn?c=' + c.id} target="_blank">Preview</a>
                    <button type="button" className="btn ghost sm" onClick=${() => setEdit(c)}>Edit</button>
                    ${data.defaults.some(d => d.id === c.id) && html`<button type="button" className="btn ghost sm" disabled=${busy} onClick=${async () => { if (!confirm('Replace this course with the built-in version?')) return; try { await api('learn_course_reset', { id: c.id }); toast('Built-in course restored.'); load(); } catch (e) { toast(errText(e), true); } }}>Restore</button>`}
                    <button type="button" className="btn ghost sm" onClick=${async () => { if (!confirm(`Delete "${c.t}"? Learners' progress stays but the course disappears.`)) return; try { await api('learn_course_delete', { id: c.id }); load(); } catch (e) { toast(errText(e), true); } }}>Delete</button>
                  </div></td>
                </tr>`; })}
              </tbody>
            </table></div>
          </section>
        </div>`
      }
      ${
        tab === 'assign' &&
        html`<div className="stack">
          <section className="panel">
            <h2 className="ph">Required by role</h2>
            <p className="muted small">A course's own "required for" setting (edit the course) plus anything ticked here. People see required courses first and HR sees who has not finished them.</p>
            <div className="tblwrap"><table className="tbl">
              <thead><tr><th>Course</th><th>Consultants</th><th>Employees</th><th>Due within (days)</th></tr></thead>
              <tbody>
                ${courses.map(c => html`<tr key=${c.id}>
                  <td><b>${c.t}</b></td>
                  ${['consultant', 'employee'].map(role => html`<td key=${role}><input type="checkbox" checked=${(c.req || []).includes(role) || ((assign.byRole || {})[role] || []).includes(c.id)} disabled=${(c.req || []).includes(role)} onChange=${e => { const on = e.target.checked; saveAssign(a => { const list = ((a.byRole || {})[role] || []).filter(x => x !== c.id); return { ...a, byRole: { ...(a.byRole || {}), [role]: on ? [...list, c.id] : list } }; }); }} /></td>`)}
                  <td><input type="number" min="0" style=${{ width: 90 }} defaultValue=${(assign.due || {})[c.id] || ''} onBlur=${e => { const v = Number(e.target.value) || 0; saveAssign(a => ({ ...a, due: { ...(a.due || {}), [c.id]: v } })); }} /></td>
                </tr>`)}
              </tbody>
            </table></div>
          </section>
          <section className="panel">
            <h2 className="ph">Required for one person</h2>
            <div className="form" style=${{ marginTop: 10 }}>
              <div className="row2">
                <${Field} label="Person"><select value=${assignUid} onChange=${e => setAssignUid(e.target.value)}><option value="">Choose…</option>${people.map(([id, n]) => html`<option key=${id} value=${id}>${n}</option>`)}</select><//>
                ${assignUid && html`<div className="checks" style=${{ alignSelf: 'end' }}>${courses.map(c => html`<label key=${c.id} className="check small"><input type="checkbox" checked=${((assign.byUid || {})[assignUid] || []).includes(c.id)} onChange=${e => { const on = e.target.checked, uid = assignUid; saveAssign(a => { const list = ((a.byUid || {})[uid] || []).filter(x => x !== c.id); return { ...a, byUid: { ...(a.byUid || {}), [uid]: on ? [...list, c.id] : list } }; }); }} /> ${c.t}</label>`)}</div>`}
              </div>
            </div>
          </section>
        </div>`
      }
      ${
        tab === 'progress' &&
        (!ov
          ? html`<${Spinner} />`
          : html`<div className="stack">
              <section className="panel" style=${{ padding: '6px 8px' }}>
                <div className="tblwrap"><table className="tbl">
                  <thead><tr><th>Course</th><th>Started</th><th>Completed</th></tr></thead>
                  <tbody>${ov.courses.map(c => html`<tr key=${c.id}><td><b>${c.t}</b></td><td>${(ov.stats[c.id] || {}).started || 0}</td><td>${(ov.stats[c.id] || {}).done || 0}</td></tr>`)}</tbody>
                </table></div>
              </section>
              <section className="panel" style=${{ padding: '6px 8px' }}>
                <div className="tblwrap"><table className="tbl">
                  <thead><tr><th>Person</th><th>Required</th><th>In progress</th><th>Completed</th></tr></thead>
                  <tbody>
                    ${ov.rows.map(r => { const byId = Object.fromEntries(ov.courses.map(c => [c.id, c.t])); const reqMissing = r.req.filter(id => !(r.p[id] && r.p[id].completedAt)); const prog = Object.entries(r.p).filter(([, x]) => !x.completedAt && x.pct > 0); const done = Object.entries(r.p).filter(([, x]) => x.completedAt); return html`<tr key=${r.uid}>
                      <td><b>${r.n}</b><div className="muted small">${r.role}</div></td>
                      <td>${reqMissing.length ? html`<span className="chip amber">${reqMissing.length} to do</span><div className="muted small">${reqMissing.map(id => byId[id] || id).join(', ')}</div>` : r.req.length ? html`<span className="chip ok">All done</span>` : html`<span className="muted">—</span>`}</td>
                      <td className="small">${prog.length ? prog.map(([id, x]) => `${byId[id] || id} (${x.pct}%)`).join(', ') : '—'}</td>
                      <td className="small">${done.length ? done.map(([id, x]) => `${byId[id] || id}${x.avg != null ? ' · ' + x.avg + '%' : ''}`).join(', ') : '—'}</td>
                    </tr>`; })}
                  </tbody>
                </table></div>
              </section>
            </div>`)
      }
      ${
        tab === 'catalog' &&
        (!cat
          ? html`<${Spinner} />`
          : html`<div className="stack">
              <div className="ph-row"><p className="muted small" style=${{ margin: 0 }}>Projects every consultant can start from Live projects › Catalog. Write one by hand, or let a consultant generate one and copy it here from the Live projects tab.</p><div className="actions"><button type="button" className="btn" onClick=${() => setEditItem({})}><${Icon} n="plus" />New project</button></div></div>
              <section className="panel" style=${{ padding: '6px 8px' }}>
                ${cat.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Project</th><th>Domain</th><th>Stack</th><th>Hours</th><th className="r"><span className="sr">Actions</span></th></tr></thead><tbody>
                  ${cat.map(it => html`<tr key=${it.id}><td><b>${it.t}</b><div className="muted small">${(it.summary || '').slice(0, 100)}</div></td><td>${it.domain}</td><td className="small">${(it.stack || []).join(', ')}</td><td>${it.hours}</td><td className="r"><div className="actions" style=${{ justifyContent: 'flex-end' }}><button type="button" className="btn ghost sm" onClick=${async () => { try { const r = await api('proj_catalog_item', { id: it.id }); setEditItem({ ...r.item, id: it.id }); } catch (e) { toast(errText(e), true); } }}>Edit</button><button type="button" className="btn ghost sm" onClick=${async () => { if (!confirm(`Remove "${it.t}" from the catalog?`)) return; try { await api('proj_catalog_delete', { id: it.id }); setCat(cat.filter(x => x.id !== it.id)); } catch (e) { toast(errText(e), true); } }}>Delete</button></div></td></tr>`)}
                </tbody></table></div>` : html`<${Empty} title="No catalog projects yet">Add one, or publish a consultant's generated project from the Live projects tab.<//>`}
              </section>
            </div>`)
      }
      ${
        tab === 'live' &&
        (!projOv
          ? html`<${Spinner} />`
          : html`<section className="panel" style=${{ padding: '6px 8px' }}>
              ${projOv.rows.length ? html`<div className="tblwrap"><table className="tbl"><thead><tr><th>Person</th><th>Project</th><th>Source</th><th>Status</th><th>Progress</th><th>Updated</th><th className="r"><span className="sr">Actions</span></th></tr></thead><tbody>
                ${projOv.rows.map(r => html`<tr key=${r.uid + r.id}><td><b>${r.n}</b></td><td><b>${r.t}</b><div className="muted small">${r.domain} · ${(r.stack || []).slice(0, 4).join(', ')}</div></td><td className="small">${r.src === 'ai' ? 'AI' : r.src}</td><td><span className=${'chip ' + ((PROJ_ST[r.st] || [])[1] || '')}>${(PROJ_ST[r.st] || ['?'])[0]}</span></td><td><div className="prog" style=${{ width: 90 }}><i style=${{ width: r.pct + '%' }} /></div><span className="muted small">${r.done}/${r.tasks}</span></td><td className="small">${fmtDay(r.u)}</td><td className="r"><button type="button" className="btn ghost sm" onClick=${async () => { try { const d = await dbGet(`proj/${r.uid}/items/${r.id}`); if (!d) throw { message: 'Not found' }; const s = await api('proj_catalog_save', { item: { ...d, id: '' } }); toast('Published to the catalog.'); setCat(null); } catch (e) { toast(errText(e), true); } }}>Publish to catalog</button></td></tr>`)}
              </tbody></table></div>` : html`<${Empty} title="No live projects yet">Consultants create them under Live projects in their portal.<//>`}
            </section>`)
      }
      ${edit && html`<${CourseEditor} course=${edit} ai=${data.ai} aiCourses=${data.aiCourses} onClose=${() => setEdit(null)} onSaved=${() => { setEdit(null); load(); }} />`}
      ${build && html`<${CourseAiBuilder} onClose=${() => setBuild(false)} onDone=${course => { setBuild(false); setEdit(course); }} />`}
      ${editItem && html`<${BriefEditor} item=${editItem} onClose=${() => setEditItem(null)} onSaved=${() => { setEditItem(null); setCat(null); api('proj_catalog').then(r => setCat(r.items)); }} />`}
    </div>`;
}
